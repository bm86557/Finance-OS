import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { employeeService } from '@/services/employeeService';
import { toast } from 'sonner';
import {
  Sparkles,
  DollarSign,
  FileText,
  CheckCircle2,
  AlertCircle,
  Split,
  Plus,
  RefreshCw,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  XCircle,
  Check,
} from 'lucide-react';

interface EmployeeSplitItem {
  userId: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  fixedSalary: number;
  gross: number;
  deductionAmount: number;
  isAlreadyPaid?: boolean;
  alreadyPaidAmount?: number;
}

type TxnFilterMode = 'salary' | 'debit' | 'credit' | 'all';

const normalizePeriodKey = (p: string | null | undefined): string => {
  if (!p) return '';
  return String(p).toLowerCase().replace(/[^a-z0-9]/g, '');
};

const extractPeriodFromTxn = (txn: any, fallback?: string): string => {
  if (!txn) return fallback || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const text = `${txn.description || ''} ${txn.narration || ''}`.toLowerCase();
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let foundMonth: string | null = null;
  for (let i = 0; i < 12; i++) {
    if (text.includes(months[i]) || new RegExp(`\\b${monthShort[i]}\\b`, 'i').test(text)) {
      foundMonth = months[i].charAt(0).toUpperCase() + months[i].slice(1);
      break;
    }
  }
  const yearMatch = text.match(/\b(202\d)\b/);
  let year = yearMatch ? yearMatch[1] : null;
  if (txn.date) {
    const d = new Date(txn.date);
    if (!Number.isNaN(d.getTime())) {
      if (!foundMonth) {
        foundMonth = d.toLocaleDateString('en-US', { month: 'long' });
      }
      if (!year) {
        year = String(d.getFullYear());
      }
    }
  }
  if (foundMonth && year) {
    return `${foundMonth} ${year}`;
  }
  return fallback || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export function PayrollPayslipsAI() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';
  const currency = currentOrganization?.currency || 'USD';

  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [members, setMembers] = useState<any[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [filterMode, setFilterMode] = useState<TxnFilterMode>('salary');
  const [adminExpenses, setAdminExpenses] = useState<any[]>([]);
  const [expenseFilter, setExpenseFilter] = useState<'all' | 'submitted' | 'approved' | 'rejected' | 'reimbursed'>('all');
  const [reviewingExpense, setReviewingExpense] = useState(false);

  // Simple Modal State for Splitting / Issuing Payslips
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTxn, setActiveTxn] = useState<any | null>(null);
  const [period, setPeriod] = useState<string>(() =>
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );
  const [issueDate, setIssueDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [employeeSplits, setEmployeeSplits] = useState<EmployeeSplitItem[]>([]);

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const overviewRes = await employeeService.getPayrollOverview(orgId);
      if (overviewRes.success && overviewRes.data) {
        const d = overviewRes.data;
        const onlyEmployees = (d.members || []).filter((m: any) => {
          const role = String(m.role || '').toLowerCase();
          return role !== 'owner' && role !== 'admin' && role !== 'org_admin';
        });
        setMembers(onlyEmployees);
        setAllTransactions(d.debitTransactions || []);
        setPayslips(d.payslips || []);
        setAiSuggestions(d.aiSuggestions || []);
      }

      const expQueueRes = await employeeService.getAdminExpenseQueue(orgId);
      if (expQueueRes.success && expQueueRes.data) {
        setAdminExpenses(expQueueRes.data);
      }
    } catch (err) {
      console.error('[PayrollPayslipsAI] Error loading overview:', err);
      toast.error('Failed to load salary transactions');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter transactions based on selected pill
  const displayedTransactions = useMemo(() => {
    return allTransactions.filter(t => {
      const type = t.type || 'debit';
      if (filterMode === 'salary') {
        return Boolean(t.isPayrollCandidate || t.isPayrollCredit);
      }
      if (filterMode === 'debit') {
        return type === 'debit';
      }
      if (filterMode === 'credit') {
        return type === 'credit';
      }
      return true;
    });
  }, [allTransactions, filterMode]);

  // Map transactionId -> AI Suggestion for easy inline display
  const suggestionByTxnId = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of aiSuggestions) {
      map.set(s.transactionId, s);
    }
    return map;
  }, [aiSuggestions]);

  // Open the clean Split & Issue Modal for a specific debit transaction (or standalone)
  const openSplitModal = (txn: any | null, prefillSuggestion?: any) => {
    setActiveTxn(txn);
    const targetPeriod = prefillSuggestion?.period || extractPeriodFromTxn(txn);
    setPeriod(targetPeriod);

    const normPeriod = normalizePeriodKey(targetPeriod);

    const suggestedMap = new Map<string, number>();
    if (prefillSuggestion?.suggestedAllocations) {
      for (const a of prefillSuggestion.suggestedAllocations) {
        suggestedMap.set(a.userId, Number(a.gross || 0));
      }
    }

    const pool = txn ? txn.remainingAmount : 0;

    // Check each member's paid status for targetPeriod
    const memberStatuses = members.map(m => {
      const memberPayslips = payslips.filter(
        p => p.userId === m.userId && normalizePeriodKey(p.period) === normPeriod
      );
      const payslipPaid = memberPayslips.reduce((s, p) => s + Number(p.gross || p.net || 0), 0);
      const txnAlloc = (txn?.allocations || []).find((a: any) => a.userId === m.userId && (normalizePeriodKey(a.period) === normPeriod || !a.period));
      const allocPaid = Number(txnAlloc?.gross || 0);
      const totalPaid = Math.max(payslipPaid, allocPaid);
      const isAlreadyPaid = totalPaid > 0 && (
        m.fixedSalary > 0 ? totalPaid >= m.fixedSalary * 0.9 : true
      );

      return {
        member: m,
        isAlreadyPaid,
        alreadyPaidAmount: totalPaid,
      };
    });

    const unpaidCount = memberStatuses.filter(s => !s.isAlreadyPaid).length;

    const rows: EmployeeSplitItem[] = memberStatuses.map(({ member: m, isAlreadyPaid, alreadyPaidAmount }, idx) => {
      let defaultGross = 0;
      if (suggestedMap.has(m.userId)) {
        defaultGross = suggestedMap.get(m.userId)!;
      } else if (isAlreadyPaid) {
        defaultGross = 0;
      } else if (!txn) {
        defaultGross = idx === 0 ? Number(m.fixedSalary || 0) : 0;
      } else if (unpaidCount === 1) {
        defaultGross = pool;
      } else if (unpaidCount > 1) {
        defaultGross = Math.round((pool / unpaidCount) * 100) / 100;
      }

      return {
        userId: m.userId,
        employeeName: m.name,
        departmentId: m.departmentId,
        departmentName: m.departmentName,
        fixedSalary: Number(m.fixedSalary || 0),
        gross: defaultGross,
        deductionAmount: 0,
        isAlreadyPaid,
        alreadyPaidAmount,
      };
    });

    setEmployeeSplits(rows);
    setModalOpen(true);
  };

  // One-click quick issue when AI matches a single employee
  const handleQuickIssueSingle = async (txn: any, suggestion: any) => {
    const alloc = suggestion.suggestedAllocations?.[0];
    if (!alloc) return;
    setIssuing(true);
    try {
      let txnPeriod = suggestion.period || period;
      if (txn?.date) {
        const d = new Date(txn.date);
        if (!Number.isNaN(d.getTime())) {
          txnPeriod = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
      }
      const res = await employeeService.issuePayslips(orgId, {
        sourceTransactionId: txn.id,
        period: txnPeriod,
        issueDate,
        allocations: [
          {
            userId: alloc.userId,
            employeeName: alloc.employeeName,
            departmentId: alloc.departmentId,
            gross: Number(alloc.gross || txn.remainingAmount),
            deductions: [],
            currency,
          },
        ],
      });
      if (!res.success) {
        toast.error(res.error || 'Failed to issue payslip');
        return;
      }
      toast.success(`Issued payslip of $${Number(alloc.gross || txn.remainingAmount).toLocaleString()} to ${alloc.employeeName}!`);
      await loadData();
    } catch {
      toast.error('Failed to issue payslip');
    } finally {
      setIssuing(false);
    }
  };

  const handleAutoDetect = async () => {
    if (!orgId) return;
    setDetecting(true);
    try {
      const res = await employeeService.autoDetectPayroll(orgId);
      if (res.success && res.data) {
        const count = res.data.autoIssuedCount ?? 0;
        if (count > 0) {
          toast.success(`Auto-detected and issued ${count} payslip(s)!`);
        } else {
          toast.info('No new unallocated salary transactions found to auto-issue.');
        }
        await loadData();
      } else {
        toast.error(res.error || 'Auto-detection failed');
      }
    } catch {
      toast.error('Auto-detection error');
    } finally {
      setDetecting(false);
    }
  };

  const handleVoidPayslip = async (payslipId: string) => {
    if (!orgId || !payslipId) return;
    if (!confirm('Are you sure you want to void this payslip? This will return the transaction amount to the unallocated pool.')) {
      return;
    }
    try {
      const res = await employeeService.voidPayslip(orgId, payslipId);
      if (res.success) {
        toast.success('Payslip voided successfully. Funds restored to transaction pool.');
        await loadData();
      } else {
        toast.error(res.error || 'Failed to void payslip');
      }
    } catch {
      toast.error('Error voiding payslip');
    }
  };

  const handleReviewExpense = async (expenseId: string, action: 'approve' | 'reject') => {
    let reason = '';
    if (action === 'reject') {
      const input = prompt('Please enter the reason for rejecting this claim:');
      if (input === null) return;
      reason = input.trim();
    }
    setReviewingExpense(true);
    try {
      const res = await employeeService.reviewExpense(orgId, expenseId, action, reason);
      if (res.success) {
        toast.success(action === 'approve' ? 'Expense claim approved!' : 'Expense claim rejected.');
        await loadData();
      } else {
        toast.error(res.error || `Failed to ${action} expense`);
      }
    } catch {
      toast.error(`Error trying to ${action} expense`);
    } finally {
      setReviewingExpense(false);
    }
  };

  const handleSettleExpense = async (expenseId: string) => {
    if (!confirm('Mark this expense claim as settled/reimbursed to the employee?')) return;
    setReviewingExpense(true);
    try {
      const res = await employeeService.settleExpense(orgId, expenseId);
      if (res.success) {
        toast.success('Expense marked as reimbursed!');
        await loadData();
      } else {
        toast.error(res.error || 'Failed to settle expense');
      }
    } catch {
      toast.error('Error settling expense');
    } finally {
      setReviewingExpense(false);
    }
  };

  const splitSum = useMemo(
    () => Math.round(employeeSplits.reduce((s, r) => s + Number(r.gross || 0), 0) * 100) / 100,
    [employeeSplits]
  );

  const isOverLimit = activeTxn !== null && splitSum > activeTxn.remainingAmount + 0.01;

  const handleSplitEqually = () => {
    if (!activeTxn || employeeSplits.length === 0) return;
    const pool = activeTxn.remainingAmount;

    // Only split among employees who are NOT already fully paid for this period
    const eligibleIndices: number[] = [];
    employeeSplits.forEach((r, idx) => {
      if (!r.isAlreadyPaid) {
        eligibleIndices.push(idx);
      }
    });

    const targets = eligibleIndices.length > 0 ? eligibleIndices : employeeSplits.map((_, i) => i);
    const perEmp = Math.round((pool / targets.length) * 100) / 100;
    let running = 0;

    setEmployeeSplits(prev =>
      prev.map((row, idx) => {
        if (!targets.includes(idx)) {
          return { ...row, gross: 0 };
        }
        const isLast = idx === targets[targets.length - 1];
        const g = isLast ? Math.max(0, Math.round((pool - running) * 100) / 100) : perEmp;
        running += g;
        return { ...row, gross: g };
      })
    );
  };

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    const norm = normalizePeriodKey(newPeriod);
    setEmployeeSplits(prev =>
      prev.map(row => {
        const memberPayslips = payslips.filter(
          p => p.userId === row.userId && normalizePeriodKey(p.period) === norm
        );
        const payslipPaid = memberPayslips.reduce((s, p) => s + Number(p.gross || p.net || 0), 0);
        const isPaid = payslipPaid > 0 && (
          row.fixedSalary > 0 ? payslipPaid >= row.fixedSalary * 0.9 : true
        );
        return {
          ...row,
          isAlreadyPaid: isPaid,
          alreadyPaidAmount: payslipPaid,
        };
      })
    );
  };

  const handleConfirmModalIssue = async () => {
    const activeAllocations = employeeSplits.filter(r => Number(r.gross) > 0);
    if (activeAllocations.length === 0) {
      toast.error('Please enter a pay amount greater than $0 for at least one employee.');
      return;
    }
    if (isOverLimit) {
      toast.error('Total split amount cannot exceed the transaction remaining balance.');
      return;
    }

    setIssuing(true);
    try {
      const res = await employeeService.issuePayslips(orgId, {
        sourceTransactionId: activeTxn?.id,
        period: period.trim(),
        issueDate,
        allocations: activeAllocations.map(r => ({
          userId: r.userId,
          employeeName: r.employeeName,
          departmentId: r.departmentId,
          gross: Number(r.gross),
          deductions:
            Number(r.deductionAmount) > 0
              ? [{ label: 'Deductions', amount: Number(r.deductionAmount) }]
              : [],
          currency,
        })),
      });

      if (!res.success) {
        toast.error(res.error || 'Failed to issue payslips');
        return;
      }

      toast.success(`Issued ${activeAllocations.length} payslip(s) for ${period.trim()}!`);
      setModalOpen(false);
      await loadData();
    } catch {
      toast.error('Failed to issue payslips');
    } finally {
      setIssuing(false);
    }
  };

  const salaryDebitTxns = useMemo(
    () => allTransactions.filter(t => (t.type || 'debit') === 'debit' && t.isPayrollCandidate),
    [allTransactions]
  );

  const salaryCreditTxns = useMemo(
    () => allTransactions.filter(t => t.type === 'credit' && t.isPayrollCredit),
    [allTransactions]
  );

  const totalSalaryDebits = useMemo(
    () => salaryDebitTxns.reduce((s, t) => s + t.amount, 0),
    [salaryDebitTxns]
  );

  const totalSalaryCredits = useMemo(
    () => salaryCreditTxns.reduce((s, t) => s + t.amount, 0),
    [salaryCreditTxns]
  );

  const totalIssuedPayslips = useMemo(
    () => payslips.reduce((s, p) => s + Number(p.gross || 0), 0),
    [payslips]
  );

  const totalPendingSalary = useMemo(
    () => salaryDebitTxns.reduce((s, t) => s + t.remainingAmount, 0),
    [salaryDebitTxns]
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Clean Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <DollarSign className="w-7 h-7 text-purple-400" />
            Employee Salary & Payslips
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Issue monthly payslips from Debit salary outflows or split lump-sum payments across employees ({members.length} active employee{members.length === 1 ? '' : 's'})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={loadData}
            disabled={loading}
            className="border-white/15 text-gray-300 hover:bg-white/10"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={handleAutoDetect}
            disabled={loading || detecting}
            className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
          >
            <Sparkles className={`w-4 h-4 mr-2 ${detecting ? 'animate-spin' : ''}`} />
            Auto-Detect
          </Button>
          <Button
            onClick={() => openSplitModal(null)}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Issue Manual Payslip
          </Button>
        </div>
      </div>

      {/* Clear 4-Card Summary Row showing Debit vs Credit */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 bg-[#0f172a]/90 border-red-500/25">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-gray-400">Salary Debits (Outflow)</span>
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">DEBIT</Badge>
          </div>
          <div className="text-2xl font-bold text-red-400 mt-1">
            -${totalSalaryDebits.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {salaryDebitTxns.length} debit salary transaction(s)
          </div>
        </Card>

        <Card className="p-5 bg-[#0f172a]/90 border-emerald-500/25">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-gray-400">Payroll Credits (Inflow)</span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">CREDIT</Badge>
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            +${totalSalaryCredits.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {salaryCreditTxns.length} credit deposit transaction(s)
          </div>
        </Card>

        <Card className="p-5 bg-[#0f172a]/90 border-cyan-500/25">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-gray-400">Payslips Issued</span>
            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[10px]">PAID</Badge>
          </div>
          <div className="text-2xl font-bold text-cyan-400 mt-1">
            ${totalIssuedPayslips.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {payslips.length} payslip(s) in Employee Portal
          </div>
        </Card>

        <Card className="p-5 bg-[#0f172a]/90 border-amber-500/25">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-gray-400">Pending Debit to Split</span>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">UNALLOCATED</Badge>
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            ${totalPendingSalary.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Available from salary debit outflows
          </div>
        </Card>
      </div>

      {/* Section 1: Salary Transactions Table with Clear DEBIT / CREDIT Badges */}
      <Card className="p-6 bg-[#0f172a]/90 border-white/10 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              Salary Transactions & AI Suggestions
            </h2>
            <p className="text-xs text-gray-400">
              Clearly distinguishes <strong className="text-red-400">DEBIT (Money Out)</strong> vs <strong className="text-emerald-400">CREDIT (Money In)</strong>. Payslips are issued from Debit outflows without double-counting in the ledger.
            </p>
          </div>

          {/* Filter Pills for Salary / Debit / Credit / All */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={filterMode === 'salary' ? 'default' : 'outline'}
              onClick={() => setFilterMode('salary')}
              className={
                filterMode === 'salary'
                  ? 'bg-purple-600 hover:bg-purple-700 text-white text-xs h-8'
                  : 'border-white/15 text-gray-300 text-xs h-8'
              }
            >
              Salary Only ({salaryDebitTxns.length + salaryCreditTxns.length})
            </Button>
            <Button
              size="sm"
              variant={filterMode === 'debit' ? 'default' : 'outline'}
              onClick={() => setFilterMode('debit')}
              className={
                filterMode === 'debit'
                  ? 'bg-red-600 hover:bg-red-700 text-white text-xs h-8'
                  : 'border-red-500/30 text-red-300 hover:bg-red-500/10 text-xs h-8'
              }
            >
              All Debits ({allTransactions.filter(t => (t.type || 'debit') === 'debit').length})
            </Button>
            <Button
              size="sm"
              variant={filterMode === 'credit' ? 'default' : 'outline'}
              onClick={() => setFilterMode('credit')}
              className={
                filterMode === 'credit'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8'
                  : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 text-xs h-8'
              }
            >
              All Credits ({allTransactions.filter(t => t.type === 'credit').length})
            </Button>
            <Button
              size="sm"
              variant={filterMode === 'all' ? 'default' : 'outline'}
              onClick={() => setFilterMode('all')}
              className={
                filterMode === 'all'
                  ? 'bg-slate-700 text-white text-xs h-8'
                  : 'border-white/15 text-gray-300 text-xs h-8'
              }
            >
              All ({allTransactions.length})
            </Button>
          </div>
        </div>

        {displayedTransactions.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">
            No transactions match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase text-gray-400">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Transaction Description</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                  <th className="py-3 px-3 text-right">Remaining to Allocate</th>
                  <th className="py-3 px-3">AI Suggestion</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {displayedTransactions.map(txn => {
                  const isCredit = txn.type === 'credit';
                  const sug = suggestionByTxnId.get(txn.id);
                  const singleMatch = sug?.type === 'single_match' ? sug.suggestedAllocations?.[0] : null;
                  const isDone = !isCredit && txn.remainingAmount <= 0.01 && txn.allocatedAmount > 0;

                  return (
                    <tr key={txn.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-3 text-gray-300 whitespace-nowrap">{txn.date}</td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {isCredit ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold px-2.5 py-0.5 flex items-center gap-1 w-fit">
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                            CREDIT
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-300 border-red-500/40 font-semibold px-2.5 py-0.5 flex items-center gap-1 w-fit">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            DEBIT
                          </Badge>
                        )}
                      </td>
                      <td className="py-3.5 px-3 font-medium text-white">
                        <div>{txn.description}</div>
                        {/* Live Breakdown of amounts paid from this slip and to which employee */}
                        {Array.isArray(txn.allocations) && txn.allocations.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-gray-400 font-medium">Allocated:</span>
                            {txn.allocations.map((a: any, aIdx: number) => {
                              const emp = members.find(m => m.userId === a.userId);
                              const empName = a.employeeName || emp?.name || a.employeeEmail || 'Employee';
                              return (
                                <span
                                  key={a.payslipId || `${a.userId}-${aIdx}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px]"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                  ${Number(a.gross || 0).toLocaleString()} to {empName}
                                  {a.period ? ` (${a.period})` : ''}
                                </span>
                              );
                            })}
                            {txn.remainingAmount > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
                                ${txn.remainingAmount.toLocaleString()} remaining
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] font-medium">
                                ✓ Fully Allocated
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td
                        className={`py-3.5 px-3 text-right font-bold whitespace-nowrap ${
                          isCredit ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {isCredit ? '+' : '-'}${txn.amount.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 text-right font-medium whitespace-nowrap">
                        {isCredit ? (
                          <span className="text-xs text-gray-500">N/A (Inflow)</span>
                        ) : isDone ? (
                          <span className="text-emerald-400 font-bold">$0 (Done)</span>
                        ) : (
                          <span className="text-amber-300 font-bold">${txn.remainingAmount.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        {isCredit ? (
                          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 text-xs">
                            Credit Inflow (Deposit)
                          </Badge>
                        ) : isDone ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                            ✓ Fully Allocated ({txn.allocations?.length || 0} staff)
                          </Badge>
                        ) : singleMatch ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                            AI Match: {singleMatch.employeeName} (${Number(singleMatch.gross || 0).toLocaleString()})
                          </Badge>
                        ) : txn.isPayrollCandidate ? (
                          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                            Lump-Sum Payroll — Split across employees
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-500">Debit Expense</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        {isCredit ? (
                          <span className="text-xs text-gray-500 italic">Credit Deposit</span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            {!isDone && singleMatch && (
                              <Button
                                size="sm"
                                disabled={issuing}
                                onClick={() => handleQuickIssueSingle(txn, sug)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                                Issue to {singleMatch.employeeName}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSplitModal(txn, sug)}
                              className="border-purple-500/40 text-purple-300 hover:bg-purple-500/10 text-xs h-8"
                            >
                              <Split className="w-3.5 h-3.5 mr-1.5" />
                              {isDone ? 'Edit Split' : singleMatch ? 'Split / Edit' : 'Split & Pay'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section 2: Issued Monthly Payslips History */}
      <Card className="p-6 bg-[#0f172a]/90 border-white/10 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Issued Monthly Payslips ({payslips.length})
          </h2>
          <p className="text-xs text-gray-400">
            All payslips listed below are automatically visible to the respective employee in their Employee Portal.
          </p>
        </div>

        {payslips.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">
            No payslips issued yet. Click "Issue" or "Split & Pay" on any Debit salary transaction above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase text-gray-400">
                  <th className="py-3 px-3">Employee</th>
                  <th className="py-3 px-3">Department</th>
                  <th className="py-3 px-3">Month / Period</th>
                  <th className="py-3 px-3">Issue Date</th>
                  <th className="py-3 px-3 text-right">Gross</th>
                  <th className="py-3 px-3 text-right">Deductions</th>
                  <th className="py-3 px-3 text-right">Net Paid</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {payslips.map(p => {
                  const ded = Array.isArray(p.deductions)
                    ? p.deductions.reduce((s: number, d: any) => s + Number(d?.amount || 0), 0)
                    : 0;
                  return (
                    <tr key={p.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-3">
                        <div className="text-white font-medium">{p.employeeName}</div>
                        <div className="text-xs text-gray-400">{p.employeeEmail}</div>
                      </td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="border-purple-500/30 text-purple-300">
                          {p.departmentName}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-white font-medium">{p.period}</td>
                      <td className="py-3 px-3 text-gray-400">{p.issueDate}</td>
                      <td className="py-3 px-3 text-right text-white">${Number(p.gross || 0).toLocaleString()}</td>
                      <td className="py-3 px-3 text-right text-red-400">-${ded.toLocaleString()}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-400">
                        ${Number(p.net || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-3">
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 uppercase text-[10px]">
                          {p.status || 'paid'}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleVoidPayslip(p.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs h-7 px-2"
                        >
                          Void
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section 3: Employee Expense Claims & Reimbursements Review Queue (§13, §14) */}
      <Card className="p-6 bg-[#0f172a]/90 border-white/10 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Receipt className="w-5 h-5 text-amber-400" />
              Employee Expense Claims & Reimbursements ({adminExpenses.length})
            </h2>
            <p className="text-xs text-gray-400">
              Review and authorize employee expense claims, inspect attached receipts, and track reimbursement payouts.
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'submitted', 'approved', 'rejected', 'reimbursed'] as const).map(f => (
              <Button
                key={f}
                size="sm"
                variant={expenseFilter === f ? 'default' : 'outline'}
                onClick={() => setExpenseFilter(f)}
                className={
                  expenseFilter === f
                    ? 'bg-amber-600 hover:bg-amber-700 text-white text-xs h-8 capitalize'
                    : 'border-white/15 text-gray-300 text-xs h-8 capitalize'
                }
              >
                {f}
              </Button>
            ))}
          </div>
        </div>

        {(() => {
          const filteredClaims = adminExpenses.filter(e => expenseFilter === 'all' || e.status === expenseFilter);
          if (filteredClaims.length === 0) {
            return (
              <div className="py-8 text-center text-gray-400 text-sm">
                No expense claims match the selected filter.
              </div>
            );
          }
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase text-gray-400">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Employee</th>
                    <th className="py-3 px-3">Description & Category</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3">Receipt</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredClaims.map(claim => {
                    const isSubmitted = claim.status === 'submitted';
                    const isApproved = claim.status === 'approved';
                    const isRejected = claim.status === 'rejected';
                    const isReimbursed = claim.status === 'reimbursed';

                    return (
                      <tr key={claim.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{claim.date}</td>
                        <td className="py-3 px-3">
                          <div className="text-white font-medium">{claim.employeeName || 'Employee'}</div>
                          <div className="text-xs text-gray-400">{claim.employeeEmail || ''}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-white font-medium">{claim.description}</div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                            <span className="text-slate-300">{claim.category}</span>
                            {claim.projectId && (
                              <span className="text-purple-300 font-mono">Project: {claim.projectId}</span>
                            )}
                            {claim.notes && (
                              <span className="text-slate-500 italic truncate max-w-xs">{claim.notes}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white whitespace-nowrap">
                          ${Number(claim.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {claim.currency || 'USD'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {claim.receiptUrl ? (
                            <a
                              href={claim.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              View
                            </a>
                          ) : (
                            <span className="text-xs text-gray-500">None</span>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {isSubmitted && (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 uppercase text-[10px]">
                              Pending Review
                            </Badge>
                          )}
                          {isApproved && (
                            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 uppercase text-[10px]">
                              Approved (Payable)
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge className="bg-red-500/20 text-red-300 border-red-500/30 uppercase text-[10px]">
                              Rejected
                            </Badge>
                          )}
                          {isReimbursed && (
                            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 uppercase text-[10px]">
                              Reimbursed
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {isSubmitted && (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                disabled={reviewingExpense}
                                onClick={() => handleReviewExpense(claim.id, 'approve')}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7 px-2.5"
                              >
                                <Check className="w-3 h-3 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reviewingExpense}
                                onClick={() => handleReviewExpense(claim.id, 'reject')}
                                className="border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs h-7 px-2.5"
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                Reject
                              </Button>
                            </div>
                          )}
                          {isApproved && (
                            <Button
                              size="sm"
                              disabled={reviewingExpense}
                              onClick={() => handleSettleExpense(claim.id)}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-7 px-2.5"
                            >
                              <DollarSign className="w-3 h-3 mr-1" />
                              Mark Reimbursed
                            </Button>
                          )}
                          {(isRejected || isReimbursed) && (
                            <span className="text-xs text-gray-500">Settled</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>

      {/* Clean Modal for Splitting a Lump-Sum Debit Transaction or Issuing Payslips */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-xl bg-[#0f172a] border-white/15 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Split className="w-5 h-5 text-purple-400" />
              {activeTxn ? 'Split Debit Salary Transaction & Issue Payslips' : 'Issue Monthly Payslip'}
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-xs">
              {activeTxn
                ? `DEBIT Transaction: "${activeTxn.description}" — Available to allocate: $${activeTxn.remainingAmount.toLocaleString()}`
                : 'Enter the pay amount for one or more employees below.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Period & Issue Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-300">Pay Period (Month)</Label>
                <Input
                  value={period}
                  onChange={e => handlePeriodChange(e.target.value)}
                  placeholder="e.g. October 2026"
                  className="bg-slate-900 border-white/15 text-white h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-300">Issue Date</Label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={e => setIssueDate(e.target.value)}
                  className="bg-slate-900 border-white/15 text-white h-9 text-sm"
                />
              </div>
            </div>

            {/* Quick Split Helper if linked to a transaction */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-purple-400" />
                Employees ({employeeSplits.length})
              </span>
              {activeTxn && employeeSplits.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleSplitEqually}
                  className="h-7 text-xs border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
                >
                  {employeeSplits.some(r => r.isAlreadyPaid)
                    ? `Split $${activeTxn.remainingAmount.toLocaleString()} to Unpaid Staff`
                    : `Split $${activeTxn.remainingAmount.toLocaleString()} Equally`}
                </Button>
              )}
            </div>

            {/* Clean List of Employees with Amount Input */}
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {employeeSplits.map((emp, idx) => (
                <div
                  key={emp.userId}
                  className={`p-3.5 rounded-xl border transition-all ${
                    emp.isAlreadyPaid
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : 'bg-white/[0.03] border-white/10'
                  } flex items-center justify-between gap-3`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate">{emp.employeeName}</span>
                      {emp.isAlreadyPaid && (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] px-1.5 py-0.2">
                          ✓ Paid ${emp.alreadyPaidAmount?.toLocaleString()} for {period}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {emp.departmentName}
                      {emp.fixedSalary > 0 && (
                        <span className="text-gray-500 ml-2">Monthly: ${emp.fixedSalary.toLocaleString()}</span>
                      )}
                    </div>
                    {emp.isAlreadyPaid && (
                      <div className="text-[11px] text-emerald-400/80 mt-1">
                        Payslip already issued for this month. Set to $0 to prevent duplicate payment.
                      </div>
                    )}
                  </div>

                  <div className="w-32 space-y-1">
                    <Label className="text-[10px] text-gray-400">Pay Amount ($)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={emp.gross === 0 && emp.isAlreadyPaid ? 0 : emp.gross || ''}
                      placeholder="0"
                      onChange={e => {
                        const val = Number(e.target.value);
                        setEmployeeSplits(prev =>
                          prev.map((r, i) => (i === idx ? { ...r, gross: val } : r))
                        );
                      }}
                      className={`h-8 bg-slate-900 border-white/15 text-white text-sm text-right ${
                        emp.isAlreadyPaid && (emp.gross === 0 || !emp.gross)
                          ? 'text-gray-400 font-normal'
                          : 'text-emerald-400 font-semibold'
                      }`}
                    />
                  </div>

                  <div className="w-24 space-y-1">
                    <Label className="text-[10px] text-gray-400">Deduction ($)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={emp.deductionAmount || ''}
                      placeholder="0"
                      onChange={e => {
                        const val = Number(e.target.value);
                        setEmployeeSplits(prev =>
                          prev.map((r, i) => (i === idx ? { ...r, deductionAmount: val } : r))
                        );
                      }}
                      className="h-8 bg-slate-900 border-white/15 text-white text-sm text-right"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Summary Bar */}
            <div className="p-3 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-between text-xs">
              <span className="text-gray-400">
                Total Allocated:{' '}
                <strong className={isOverLimit ? 'text-red-400 text-sm' : 'text-emerald-400 text-sm'}>
                  ${splitSum.toLocaleString()}
                </strong>
              </span>
              {activeTxn && (
                <span className="text-gray-400">
                  Remaining from Transaction:{' '}
                  <strong className="text-white">
                    ${Math.max(0, Math.round((activeTxn.remainingAmount - splitSum) * 100) / 100).toLocaleString()}
                  </strong>
                </span>
              )}
            </div>

            {isOverLimit && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Total split (${splitSum.toLocaleString()}) cannot exceed transaction balance (${activeTxn.remainingAmount.toLocaleString()}).
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              className="text-gray-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={issuing || isOverLimit || splitSum <= 0}
              onClick={handleConfirmModalIssue}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {issuing ? 'Issuing...' : 'Confirm & Issue Payslip(s)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
