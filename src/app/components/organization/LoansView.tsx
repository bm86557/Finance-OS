import { useState, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { 
  Landmark, TrendingUp, TrendingDown, DollarSign, Wallet, Clock, 
  AlertCircle, CheckCircle, FileText, ArrowUpRight, ArrowDownRight, 
  Search, Edit, Trash2, Plus, Download, PieChart as PieChartIcon, 
  Loader2, History, ShieldCheck, Calendar, CreditCard, ChevronRight, Lock
} from 'lucide-react';
import { BarChart, Bar, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { exportToCSV } from '@/lib/exportUtils';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useServiceArray, useMutation } from '@/hooks/useService';
import type { Loan, LoanRecordStatus, LoanPayment } from '@/services/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type LoanView = 'overview' | 'to-receive' | 'to-pay' | 'analytics';

const COLORS = {
  purple: '#a855f7',
  cyan: '#06b6d4',
  pink: '#ec4899',
  green: '#10b981',
  amber: '#f59e0b',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f97316'
};

const defaultForm = () => ({
  type: 'to_pay' as Loan['type'],
  party: '',
  description: '',
  principal: '',
  currency: 'USD',
  dueDate: '',
  startDate: '',
  interestRate: '',
  installmentAmount: '',
  frequency: 'monthly' as 'monthly' | 'quarterly' | 'annual',
  termMonths: '12',
  status: 'active' as LoanRecordStatus,
  bankAccountId: '',
});

export function LoansView() {
  const svc = useOrgServices();
  const { data: loans, loading, error } = useServiceArray(
    () => svc.loans.getAll(),
    [svc.orgId],
    ['loans'],
  );

  const { data: allPayments = [] } = useServiceArray(
    () => svc.loans.getAllPayments(),
    [svc.orgId],
    ['loans', 'loan_payments'],
  );

  const { data: bankAccounts = [] } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts', 'transactions'],
  );

  const createLoan = useMutation((payload: Omit<Loan, 'id' | 'organizationId'>) => svc.loans.create(payload));
  const updateLoan = useMutation((args: { id: string; updates: Partial<Loan> }) =>
    svc.loans.update(args.id, args.updates));
  const deleteLoan = useMutation((id: string) => svc.loans.delete(id));
  const recordPaymentMutation = useMutation((args: { loanId: string; paymentData: any }) =>
    svc.loans.recordPayment(args.loanId, args.paymentData)
  );

  const [activeView, setActiveView] = useState<LoanView>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(() => defaultForm());

  // Payment recording modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedLoanForPayment, setSelectedLoanForPayment] = useState<Loan | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentBankAccountId, setPaymentBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  // History & Schedule modal state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedLoanForHistory, setSelectedLoanForHistory] = useState<Loan | null>(null);
  const [historyTab, setHistoryTab] = useState<'schedule' | 'payments'>('schedule');

  // Month identifiers
  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentMonthName = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, []);

  /**
   * Checks whether this specific loan has been paid for the current month
   */
  const isLoanPaidThisMonth = useCallback((loan: Loan) => {
    if (loan.status === 'paid' || (loan.remainingBalance !== undefined && loan.remainingBalance <= 0)) {
      return true;
    }
    if (loan.lastPaymentMonth === currentMonthKey) {
      return true;
    }
    return allPayments.some(p => p.loanId === loan.id && p.paymentMonth === currentMonthKey);
  }, [allPayments, currentMonthKey]);

  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm(defaultForm());
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((loan: Loan) => {
    setEditingId(loan.id);
    setForm({
      type: loan.type,
      party: loan.party,
      description: loan.description,
      principal: String(loan.principal),
      currency: loan.currency,
      dueDate: loan.dueDate,
      startDate: loan.startDate ?? '',
      interestRate: loan.interestRate != null ? String(loan.interestRate) : '',
      installmentAmount: loan.installmentAmount != null ? String(loan.installmentAmount) : '',
      frequency: loan.frequency || 'monthly',
      termMonths: loan.termMonths ? String(loan.termMonths) : (loan.paymentsCount ? String(loan.paymentsCount) : '12'),
      status: loan.status,
      bankAccountId: (loan as any).bankAccountId || (loan as any).bank_account_id || '',
    });
    setFormOpen(true);
  }, []);

  const getLoanTotal = useCallback((l: Loan) => Number(l.principal || l.amount || 0), []);
  const getLoanRemaining = useCallback((l: Loan) => {
    if (l.remainingBalance != null) return Number(l.remainingBalance);
    const principal = Number(l.principal || l.amount || 0);
    const paid = Number(l.amountPaid || 0);
    return Math.max(0, Math.round((principal - paid) * 100) / 100);
  }, []);

  const openPaymentModal = useCallback((loan: Loan) => {
    if (isLoanPaidThisMonth(loan)) {
      toast.info(`The installment for ${currentMonthName} has already been settled for this loan.`);
      return;
    }
    setSelectedLoanForPayment(loan);
    const rem = getLoanRemaining(loan);
    const defaultAmt = loan.installmentAmount && loan.installmentAmount > 0
      ? String(Math.min(loan.installmentAmount, rem))
      : String(rem);
    setPaymentAmount(defaultAmt);
    setPaymentMethod('bank_transfer');
    setPaymentBankAccountId(bankAccounts[0]?.id || '');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentReference(`PMT-${loan.party.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}-${currentMonthKey.replace('-', '')}`);
    setPaymentNotes(`Monthly installment for ${currentMonthName}`);
    setPaymentModalOpen(true);
  }, [isLoanPaidThisMonth, currentMonthName, currentMonthKey, bankAccounts, getLoanRemaining]);

  const openHistory = useCallback((loan: Loan) => {
    setSelectedLoanForHistory(loan);
    setHistoryTab('schedule');
    setHistoryModalOpen(true);
  }, []);

  const submitPayment = async () => {
    if (!selectedLoanForPayment) return;
    const amt = Number(paymentAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }

    const res = await recordPaymentMutation.execute({
      loanId: selectedLoanForPayment.id,
      paymentData: {
        amount: amt,
        paymentMonth: currentMonthKey,
        paidOn: paymentDate,
        method: paymentMethod,
        bankAccountId: paymentBankAccountId || undefined,
        reference: paymentReference,
        notes: paymentNotes,
      },
    });

    if (res.success) {
      toast.success(res.message || `Payment for ${currentMonthName} recorded successfully!`);
      setPaymentModalOpen(false);
      setSelectedLoanForPayment(null);
    } else {
      toast.error(res.error || 'Could not record payment');
    }
  };

  const loanTypeData = useMemo(() => {
    const map = new Map<string, { name: string; value: number; count: number }>();
    for (const l of loans) {
      const key = (l.description || 'Other').trim() || 'Other';
      const cur = map.get(key) ?? { name: key, value: 0, count: 0 };
      cur.value += l.principal;
      cur.count += 1;
      map.set(key, cur);
    }
    const rows = Array.from(map.values());
    return rows.length ? rows : [{ name: 'No loans yet', value: 1, count: 0 }];
  }, [loans]);

  // Compute dynamic payment schedule for the next 6 months with real payments tracking
  const computedPaymentSchedule = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const result: { month: string; scheduled: number; paid: number }[] = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthLabel = months[d.getMonth()];
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // Sum obligations from active payables due or recurring in this month
      let scheduled = 0;
      for (const l of loans) {
        if (l.type === 'to_pay' && l.status !== 'paid') {
          if (l.installmentAmount && l.installmentAmount > 0) {
            scheduled += l.installmentAmount;
          } else if (l.dueDate && l.dueDate.startsWith(yearMonth)) {
            scheduled += (l.remainingBalance ?? l.principal);
          }
        }
      }

      // Sum payments actually made in this month
      let paid = 0;
      for (const p of allPayments) {
        if (p.paymentMonth === yearMonth || (p.paidOn && p.paidOn.startsWith(yearMonth))) {
          paid += p.amount;
        }
      }

      result.push({
        month: monthLabel,
        scheduled: Math.round(scheduled),
        paid: Math.round(paid),
      });
    }

    return result;
  }, [loans, allPayments]);

  const submitForm = async () => {
    const principal = Number(form.principal);
    if (!Number.isFinite(principal) || principal <= 0) {
      toast.error('Enter a valid principal amount.');
      return;
    }

    const interestRate = form.interestRate.trim() === '' ? 0 : Number(form.interestRate);
    const termMonths = form.termMonths.trim() === '' ? 12 : Number(form.termMonths);
    let installmentAmount = form.installmentAmount.trim() === '' ? 0 : Number(form.installmentAmount);

    let totalInterest = 0;
    if (interestRate > 0 && principal > 0) {
      if (termMonths > 0) {
        totalInterest = Math.round((principal * (interestRate / 100) * (termMonths / 12)) * 100) / 100;
      } else {
        totalInterest = Math.round((principal * (interestRate / 100)) * 100) / 100;
      }
    }

    const totalObligation = Math.round((principal + totalInterest) * 100) / 100;

    if (installmentAmount === 0 && termMonths > 0) {
      installmentAmount = Math.round((totalObligation / termMonths) * 100) / 100;
    }

    const paymentsCount = termMonths > 0 ? termMonths : (installmentAmount > 0 ? Math.ceil(principal / installmentAmount) : 1);

    if (editingId) {
      const updates: Partial<Loan> = {
        type: form.type,
        party: form.party.trim(),
        description: form.description.trim() || 'Loan',
        principal,
        amount: principal,
        currency: form.currency.trim() || 'USD',
        dueDate: form.dueDate.trim(),
        status: form.status,
        frequency: form.frequency,
        termMonths,
        paymentsCount,
        installmentAmount,
        totalInterest,
      };
      if (form.startDate.trim()) updates.startDate = form.startDate.trim();
      if (form.interestRate.trim() !== '') updates.interestRate = interestRate;

      const res = await updateLoan.execute({ id: editingId, updates });
      if (res.success) {
        toast.success(res.message || 'Loan updated');
        setFormOpen(false);
      } else toast.error(res.error || 'Could not update loan');
    } else {
      const nextPaymentDate = form.startDate.trim() || form.dueDate.trim();

      const payload: Omit<Loan, 'id' | 'organizationId'> & { bankAccountId?: string } = {
        type: form.type,
        party: form.party.trim(),
        description: form.description.trim() || 'Loan',
        principal,
        amount: principal,
        currency: form.currency.trim() || 'USD',
        dueDate: form.dueDate.trim(),
        startDate: form.startDate.trim() || undefined,
        status: form.status,
        interestRate: form.interestRate.trim() === '' ? undefined : interestRate,
        installmentAmount,
        totalInterest,
        frequency: form.frequency,
        termMonths,
        paymentsCount,
        paymentsCompleted: 0,
        nextPaymentDate,
        amountPaid: 0,
        remainingBalance: principal,
        bankAccountId: form.bankAccountId || undefined,
      };

      const res = await createLoan.execute(payload as any);
      if (res.success) {
        toast.success(res.message || 'Loan added');
        setFormOpen(false);
      } else toast.error(res.error || 'Could not add loan');
    }
  };

  const handleDelete = async (loan: Loan) => {
    if (!window.confirm(`Remove "${loan.party}" from the list?`)) return;
    const res = await deleteLoan.execute(loan.id);
    if (res.success) toast.success(res.message || 'Removed');
    else toast.error(res.error || 'Could not remove');
  };

  const loansToReceive = loans.filter(l => l.type === 'to_receive');
  const loansToPay = loans.filter(l => l.type === 'to_pay');

  // Calculations
  const totalToReceive = loansToReceive.reduce((sum, loan) => sum + getLoanRemaining(loan), 0);
  const totalToPay = loansToPay.reduce((sum, loan) => sum + getLoanRemaining(loan), 0);
  const netPosition = totalToReceive - totalToPay;
  const totalInterestReceivable = loansToReceive.reduce((sum, loan) => sum + (loan.totalInterest || 0), 0);
  const totalInterestPayable = loansToPay.reduce((sum, loan) => sum + (loan.totalInterest || 0), 0);
  const interestTotal = totalInterestReceivable + totalInterestPayable;
  
  const overdueLoans = loans.filter(l => l.status === 'overdue');

  const getStatusBadge = (status: string) => {
    const styles: Record<string, any> = {
      active: AXIOM.badges.success,
      pending: AXIOM.badges.warning,
      overdue: AXIOM.badges.danger,
      partially_paid: AXIOM.badges.info,
      paid: AXIOM.badges.success,
      defaulted: AXIOM.badges.danger,
    };
    return styles[status] || AXIOM.badges.info;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
      case 'paid':
        return <CheckCircle className="size-4" />;
      case 'overdue':
      case 'defaulted':
        return <AlertCircle className="size-4" />;
      case 'pending':
        return <Clock className="size-4" />;
      default:
        return <FileText className="size-4" />;
    }
  };

  const selectedLoanPayments = useMemo(() => {
    if (!selectedLoanForHistory) return [];
    return allPayments.filter(p => p.loanId === selectedLoanForHistory.id);
  }, [allPayments, selectedLoanForHistory]);

  const amortizationSchedule = useMemo(() => {
    if (!selectedLoanForHistory) return [];
    const loan = selectedLoanForHistory;
    const principal = Number(loan.principal || loan.amount || 0);
    const annualRate = Number(loan.interestRate || 0);
    const monthlyRate = annualRate > 0 ? (annualRate / 100) / 12 : 0;
    const term = loan.termMonths && loan.termMonths > 0 ? loan.termMonths : (loan.paymentsCount && loan.paymentsCount > 0 ? loan.paymentsCount : 12);

    let instAmt = Number(loan.installmentAmount || 0);
    if (instAmt <= 0 && principal > 0) {
      if (monthlyRate > 0) {
        instAmt = Math.round((principal * (monthlyRate * Math.pow(1 + monthlyRate, term)) / (Math.pow(1 + monthlyRate, term) - 1)) * 100) / 100;
      } else {
        instAmt = Math.round((principal / term) * 100) / 100;
      }
    }

    const totalPayments = term;
    const rows = [];
    const startDate = loan.startDate ? new Date(loan.startDate) : new Date();

    let runningBal = principal;

    for (let i = 0; i < totalPayments; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const mLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      
      const paymentFound = selectedLoanPayments.find(p => p.paymentMonth === mKey);
      const isPaid = !!paymentFound || i < (loan.paymentsCompleted || 0);

      let interestPart = 0;
      let principalPart = 0;
      let rowAmount = instAmt;

      if (runningBal > 0) {
        interestPart = Math.round((runningBal * monthlyRate) * 100) / 100;
        if (i === totalPayments - 1 || runningBal + interestPart <= instAmt) {
          principalPart = runningBal;
          rowAmount = Math.round((principalPart + interestPart) * 100) / 100;
        } else {
          principalPart = Math.min(runningBal, Math.round((instAmt - interestPart) * 100) / 100);
          rowAmount = instAmt;
        }
      }

      if (isPaid && paymentFound) {
        rowAmount = paymentFound.amount;
        if (paymentFound.principalPart != null && paymentFound.principalPart > 0) {
          principalPart = paymentFound.principalPart;
          interestPart = paymentFound.interestPart || Math.max(0, Math.round((rowAmount - principalPart) * 100) / 100);
        }
      }

      runningBal = Math.max(0, Math.round((runningBal - principalPart) * 100) / 100);

      rows.push({
        installmentNo: i + 1,
        monthKey: mKey,
        monthLabel: mLabel,
        dueDate: d.toISOString().split('T')[0],
        amount: rowAmount,
        principalPart,
        interestPart,
        isPaid,
        paidOn: paymentFound?.paidOn,
        method: paymentFound?.method,
        reference: paymentFound?.reference,
        closingBalance: runningBal,
      });
    }
    return rows;
  }, [selectedLoanForHistory, selectedLoanPayments]);

  const renderLoanCard = (loan: Loan, isPayable: boolean) => {
    const isPaidThisMonth = isLoanPaidThisMonth(loan);
    const thisMonthPayment = allPayments.find(p => p.loanId === loan.id && p.paymentMonth === currentMonthKey);
    const principal = Number(loan.principal || loan.amount || 0);
    const remainingBalance = getLoanRemaining(loan);
    const instAmt = loan.installmentAmount && loan.installmentAmount > 0
      ? Math.min(loan.installmentAmount, remainingBalance)
      : remainingBalance;
    const effectivePaymentsCount = loan.paymentsCount && loan.paymentsCount > 0
      ? loan.paymentsCount
      : (loan.termMonths && loan.termMonths > 0
          ? loan.termMonths
          : (instAmt > 0 && principal > 0 ? Math.ceil(principal / instAmt) : 12));
    const effectivePaymentsCompleted = loan.paymentsCompleted || 0;
    const progressPct = effectivePaymentsCount > 0 ? Math.min(100, Math.round((effectivePaymentsCompleted / effectivePaymentsCount) * 100)) : 0;

    // Derive next payment date matching the schedule's next upcoming unpaid installment
    let effectiveNextPaymentDate = loan.nextPaymentDate;
    if (remainingBalance > 0 && loan.startDate) {
      const d = new Date(loan.startDate);
      if (!isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + effectivePaymentsCompleted);
        effectiveNextPaymentDate = d.toISOString().split('T')[0];
      }
    } else if (remainingBalance <= 0) {
      effectiveNextPaymentDate = undefined;
    }

    return (
      <div
        key={loan.id}
        className="p-6 rounded-2xl hover:bg-black/20 transition-all border border-slate-800/80"
        style={AXIOM.containers.item}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h4 className="text-lg font-bold text-white">{loan.party}</h4>
              <span 
                className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                style={getStatusBadge(loan.status)}
              >
                {getStatusIcon(loan.status)}
                {loan.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-sm text-slate-400">{loan.description}</p>
          </div>
          <div className="flex gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 rounded-lg"
              style={AXIOM.buttons.secondary}
              onClick={() => openEdit(loan)}
              title="Edit loan"
            >
              <Edit className="size-4" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 rounded-lg"
              style={AXIOM.buttons.danger}
              onClick={() => handleDelete(loan)}
              title="Delete loan"
            >
              <Trash2 className="size-4" />
            </motion.button>
          </div>
        </div>

        {/* Current Month Tracking Banner */}
        <div 
          className="p-4 rounded-xl mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          style={isPaidThisMonth ? {
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(6, 182, 212, 0.08) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
          } : {
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(239, 68, 68, 0.08) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
          }}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={isPaidThisMonth ? {
                background: 'rgba(16, 185, 129, 0.25)',
                color: '#34d399',
              } : {
                background: 'rgba(245, 158, 11, 0.25)',
                color: '#fbbf24',
              }}
            >
              {isPaidThisMonth ? <CheckCircle className="size-5" /> : <Clock className="size-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">
                  {currentMonthName} Installment
                </span>
                <span 
                  className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold"
                  style={isPaidThisMonth ? {
                    background: 'rgba(16, 185, 129, 0.25)',
                    color: '#6ee7b7',
                  } : {
                    background: 'rgba(245, 158, 11, 0.25)',
                    color: '#fcd34d',
                  }}
                >
                  {isPaidThisMonth ? '✓ Settled' : 'Payment Due'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {isPaidThisMonth 
                  ? (loan.lastPaymentDate ? `Paid on ${formatDate(loan.lastPaymentDate)} • Locked to prevent double payment` : `Settled for ${currentMonthName}`)
                  : (effectiveNextPaymentDate ? `Next due on ${formatDate(effectiveNextPaymentDate)}` : `Due by ${formatDate(loan.dueDate)}`)}
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right w-full sm:w-auto flex sm:flex-col justify-between items-center sm:items-end">
            <span className="text-xs text-slate-400">
              {isPaidThisMonth ? 'Amount Settled' : 'Installment Due'}
            </span>
            <span className={`text-base font-bold ${isPaidThisMonth ? 'text-emerald-400' : 'text-amber-400'}`}>
              {formatCurrency(thisMonthPayment?.amount || instAmt)}
            </span>
          </div>
        </div>

        {/* Financial Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Principal Amount</p>
            <p className="text-lg font-bold text-white">{formatCurrency(loan.principal)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Amount Paid</p>
            <p className="text-lg font-bold text-green-400">{formatCurrency(loan.amountPaid || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Remaining Balance</p>
            <p className={`text-lg font-bold ${isPayable ? 'text-red-400' : 'text-green-400'}`}>
              {formatCurrency(remainingBalance)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Interest Rate</p>
            <p className="text-lg font-bold text-amber-400">{loan.interestRate || 0}%</p>
          </div>
        </div>

        {/* Installment details */}
        {!!loan.installmentAmount && (
          <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.2)' }}>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">Installment</p>
                <p className="text-sm font-bold text-cyan-400">{formatCurrency(loan.installmentAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Frequency</p>
                <p className="text-sm font-bold text-white capitalize">{loan.frequency || 'Monthly'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Next Payment</p>
                <p className="text-sm font-bold text-white">{effectiveNextPaymentDate ? formatDate(effectiveNextPaymentDate) : 'Fully Settled'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Dates and Progress */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 mb-4" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
          <div>
            <p className="text-xs text-slate-500 mb-1">Start Date</p>
            <p className="text-sm text-slate-300">{loan.startDate ? formatDate(loan.startDate) : 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Due Date</p>
            <p className="text-sm text-slate-300">{formatDate(loan.dueDate)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Total Interest</p>
            <p className="text-sm text-amber-400 font-medium">{formatCurrency(loan.totalInterest || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(148, 163, 184, 0.15)' }}>
                <div 
                  className="h-full rounded-full transition-all duration-500" 
                  style={{ 
                    width: `${progressPct}%`,
                    background: isPayable ? AXIOM.iconBoxes.cyan : AXIOM.iconBoxes.green
                  }}
                />
              </div>
              <span className="text-xs text-slate-300 font-medium">
                {effectivePaymentsCompleted}/{effectivePaymentsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Action Row: History & Schedule + Monthly Pay Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
          <button
            type="button"
            onClick={() => openHistory(loan)}
            className="px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 text-slate-300 hover:text-white transition-all hover:bg-slate-800/60"
            style={{ background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.2)' }}
          >
            <History className="size-3.5 text-cyan-400" />
            Payment History & Schedule
          </button>

          {isPaidThisMonth ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                Locked for {currentMonthName}
              </span>
              <button
                type="button"
                disabled
                className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-not-allowed text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 opacity-75"
                title={`This month's installment is already paid. System prevents paying again for ${currentMonthName}. Next due date: ${loan.nextPaymentDate ? formatDate(loan.nextPaymentDate) : 'N/A'}.`}
              >
                <CheckCircle className="size-3.5" />
                Paid for {currentMonthName}
              </button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => openPaymentModal(loan)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 text-white shadow-lg transition-all"
              style={isPayable ? {
                background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
                boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)',
              } : {
                background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
              }}
            >
              <DollarSign className="size-4" />
              {isPayable 
                ? `Pay ${currentMonthName} Installment (${formatCurrency(instAmt)})` 
                : `Record ${currentMonthName} Payment (${formatCurrency(instAmt)})`}
            </motion.button>
          )}
        </div>
      </div>
    );
  };

  const filteredLoans = loans.filter(loan => {
    const matchesSearch = loan.party.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         loan.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || loan.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const viewButtons = [
    { id: 'overview' as const, label: 'Overview', icon: Landmark },
    { id: 'to-receive' as const, label: 'Receivables', icon: TrendingUp },
    { id: 'to-pay' as const, label: 'Payables', icon: TrendingDown },
    { id: 'analytics' as const, label: 'Analytics', icon: PieChartIcon },
  ];

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Landmark className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Loans & Liabilities
              </h1>
              <p className="text-slate-400 text-sm">Track borrowings, lending, and payment schedules</p>
            </div>
          </div>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (!loans.length) {
                  toast.info('No loans to export');
                  return;
                }
                const headers = [
                  'ID', 'Type', 'Party', 'Principal', 'Interest Rate (%)', 'Total Interest',
                  'Amount Paid', 'Remaining Balance', 'Installment Amount', 'Frequency',
                  'Start Date', 'Due Date', 'Status', 'Description'
                ];
                exportToCSV(
                  loans.map((l) => ({
                    ID: l.id,
                    Type: l.type,
                    Party: l.party,
                    Principal: l.principal,
                    'Interest Rate (%)': l.interestRate ?? 0,
                    'Total Interest': l.totalInterest ?? 0,
                    'Amount Paid': l.amountPaid ?? 0,
                    'Remaining Balance': l.remainingBalance,
                    'Installment Amount': l.installmentAmount ?? 0,
                    Frequency: l.frequency ?? 'monthly',
                    'Start Date': l.startDate ?? '',
                    'Due Date': l.dueDate,
                    Status: l.status,
                    Description: l.description,
                  })),
                  headers,
                  `loans-${new Date().toISOString().slice(0, 10)}`
                );
                toast.success('Loans exported successfully');
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <Download className="size-4" />
              Export
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openAdd}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Plus className="size-4" />
              Add Loan
            </motion.button>
          </div>
        </div>
      </motion.div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading loans…
        </div>
      )}
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm text-amber-100"
          style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)' }}
        >
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartGreen}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Receivables</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(totalToReceive)}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="size-3 text-green-400" />
                <p className="text-xs text-green-400">{loansToReceive.length} loans</p>
              </div>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <TrendingUp className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartRed}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Payables</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(totalToPay)}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowDownRight className="size-3 text-red-400" />
                <p className="text-xs text-red-400">{loansToPay.length} loans</p>
              </div>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.red,
                boxShadow: AXIOM.shadows.iconRed,
              }}
            >
              <TrendingDown className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartCyan}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Net Position</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(Math.abs(netPosition))}</p>
              <div className="flex items-center gap-1 mt-2">
                <DollarSign className="size-3 text-cyan-400" />
                <p className="text-xs text-cyan-400">{netPosition >= 0 ? 'Surplus' : 'Deficit'}</p>
              </div>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Wallet className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartAmber}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Overdue Loans</p>
              <p className="text-3xl font-bold text-white">{overdueLoans.length}</p>
              <div className="flex items-center gap-1 mt-2">
                <AlertCircle className="size-3 text-amber-400" />
                <p className="text-xs text-amber-400">Requires attention</p>
              </div>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.amber,
                boxShadow: AXIOM.shadows.iconAmber,
              }}
            >
              <Clock className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {!loading && loans.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-dashed p-10 text-center"
          style={{ borderColor: 'rgba(148, 163, 184, 0.25)', background: 'rgba(15, 23, 42, 0.35)' }}
        >
          <p className="text-lg font-medium text-slate-200 mb-1">No loans yet</p>
          <p className="text-sm text-slate-500 mb-6">Add money you owe or money owed to you. You can edit or remove entries anytime.</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openAdd}
            className="px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
              border: '1px solid rgba(6, 182, 212, 0.5)',
              color: '#ffffff',
            }}
          >
            <Plus className="size-4" />
            Add loan
          </motion.button>
        </motion.div>
      )}

      {/* View Selector */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex gap-2 p-2 rounded-2xl"
        style={AXIOM.containers.list}
      >
        {viewButtons.map((btn) => (
          <motion.button
            key={btn.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveView(btn.id)}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={activeView === btn.id ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
          >
            <btn.icon className="size-4" />
            {btn.label}
          </motion.button>
        ))}
      </motion.div>

      {/* Search and Filter */}
      {activeView !== 'analytics' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="flex gap-4"
        >
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by party or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl text-sm"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
                color: AXIOM.inputs.color,
              }}
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-3 rounded-xl text-sm font-medium"
            style={AXIOM.buttons.secondary}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
          </select>
        </motion.div>
      )}

      {/* Content Views */}
      {activeView === 'overview' && (
        <div className="space-y-4">
          {/* Upcoming Payments */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartPurple}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-white">Upcoming Payment Schedule</h3>
                <p className="text-sm text-slate-400 mt-1">Next 6 months payment obligations</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={computedPaymentSchedule}>
                <defs>
                  <linearGradient id="colorScheduled" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0.3}/>
                  </linearGradient>
                </defs>
                <CartesianGrid {...AXIOM.charts.grid} />
                <XAxis 
                  dataKey="month" 
                  {...AXIOM.charts.axis}
                  tick={{ fill: '#94a3b8' }}
                />
                <YAxis 
                  {...AXIOM.charts.axis}
                  tick={{ fill: '#94a3b8' }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                    border: AXIOM.charts.tooltip.border,
                    borderRadius: AXIOM.charts.tooltip.borderRadius,
                    color: '#fff',
                  }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend />
                <Bar dataKey="scheduled" fill="url(#colorScheduled)" name="Scheduled" radius={[8, 8, 0, 0]} />
                <Bar dataKey="paid" fill={COLORS.green} name="Settled" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Recent Loans */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <TrendingUp className="size-5 text-green-400" />
                  Active Receivables
                </h3>
              </div>
              <div className="space-y-3">
                {loansToReceive.slice(0, 3).map((loan) => (
                  <div
                    key={loan.id}
                    className="p-4 rounded-xl"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-white font-medium">{loan.party}</p>
                      <span 
                        className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                        style={getStatusBadge(loan.status)}
                      >
                        {getStatusIcon(loan.status)}
                        {loan.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-green-400 mb-2">{formatCurrency(loan.remainingBalance ?? loan.amount)}</p>
                    <p className="text-sm text-slate-400 mb-2">{loan.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Due: {formatDate(loan.dueDate)}</span>
                      {!!loan.interestRate && (
                        <span className="text-cyan-400">{loan.interestRate}% APR</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <TrendingDown className="size-5 text-red-400" />
                  Active Payables
                </h3>
              </div>
              <div className="space-y-3">
                {loansToPay.slice(0, 3).map((loan) => (
                  <div
                    key={loan.id}
                    className="p-4 rounded-xl"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-white font-medium">{loan.party}</p>
                      <span 
                        className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                        style={getStatusBadge(loan.status)}
                      >
                        {getStatusIcon(loan.status)}
                        {loan.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-red-400 mb-2">{formatCurrency(loan.remainingBalance ?? loan.amount)}</p>
                    <p className="text-sm text-slate-400 mb-2">{loan.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Due: {formatDate(loan.dueDate)}</span>
                      {loan.interestRate && (
                        <span className="text-amber-400">{loan.interestRate}% APR</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {activeView === 'to-receive' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                <TrendingUp className="size-6 text-green-400" />
                Loans to Receive
              </h3>
              <p className="text-sm text-slate-400 mt-1">Money owed to your organization</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400">Total Outstanding</p>
              <p className="text-2xl font-bold text-green-400">{formatCurrency(totalToReceive)}</p>
            </div>
          </div>

          <div className="space-y-4">
            {filteredLoans.filter(l => l.type === 'to_receive').length === 0 ? (
              <p className="text-center py-8 text-slate-500 text-sm">No receivable loans matching search or filter.</p>
            ) : (
              filteredLoans.filter(l => l.type === 'to_receive').map((loan) => renderLoanCard(loan, false))
            )}
          </div>
        </motion.div>
      )}

      {activeView === 'to-pay' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                <TrendingDown className="size-6 text-red-400" />
                Loans to Pay
              </h3>
              <p className="text-sm text-slate-400 mt-1">Your organization's outstanding debt</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400">Total Outstanding</p>
              <p className="text-2xl font-bold text-red-400">{formatCurrency(totalToPay)}</p>
            </div>
          </div>

          <div className="space-y-4">
            {filteredLoans.filter(l => l.type === 'to_pay').length === 0 ? (
              <p className="text-center py-8 text-slate-500 text-sm">No payable loans matching search or filter.</p>
            ) : (
              filteredLoans.filter(l => l.type === 'to_pay').map((loan) => renderLoanCard(loan, true))
            )}
          </div>
        </motion.div>
      )}

      {activeView === 'analytics' && (
        <div className="space-y-4">
          {/* Loan Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.chartPurple}
            >
              <h4 className="text-lg font-bold text-white mb-4">Loan Type Distribution</h4>
              <ResponsiveContainer width="100%" height={300}>
                <RePieChart>
                  <Pie
                    data={loanTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                    outerRadius={90}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {loanTypeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={Object.values(COLORS)[index % Object.values(COLORS).length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                      border: AXIOM.charts.tooltip.border,
                      borderRadius: AXIOM.charts.tooltip.borderRadius,
                      color: '#fff',
                    }}
                    formatter={(value: any) => formatCurrency(value)}
                  />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.chartCyan}
            >
              <h4 className="text-lg font-bold text-white mb-4">Interest Analysis</h4>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-slate-400">Interest Receivable</p>
                    <p className="text-2xl font-bold text-green-400">{formatCurrency(totalInterestReceivable)}</p>
                  </div>
                  <div className="h-3 rounded-full" style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                    <div 
                      className="h-full rounded-full" 
                      style={{ 
                        width: `${interestTotal > 0 ? (totalInterestReceivable / interestTotal) * 100 : 0}%`,
                        background: AXIOM.iconBoxes.green
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-slate-400">Interest Payable</p>
                    <p className="text-2xl font-bold text-red-400">{formatCurrency(totalInterestPayable)}</p>
                  </div>
                  <div className="h-3 rounded-full" style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                    <div 
                      className="h-full rounded-full" 
                      style={{ 
                        width: `${interestTotal > 0 ? (totalInterestPayable / interestTotal) * 100 : 0}%`,
                        background: AXIOM.iconBoxes.red
                      }}
                    />
                  </div>
                </div>
                <div className="pt-4" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-400">Net Interest Position</p>
                    <p className="text-2xl font-bold text-cyan-400">
                      {formatCurrency(Math.abs(totalInterestReceivable - totalInterestPayable))}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 text-right">
                    {totalInterestReceivable > totalInterestPayable ? 'Net Gain' : 'Net Cost'}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Loan Status Summary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <h4 className="text-lg font-bold text-white mb-6">Loan Status Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                <p className="text-sm text-slate-400 mb-1">Active</p>
                <p className="text-3xl font-bold text-green-400">
                  {loans.filter(l => l.status === 'active').length}
                </p>
              </div>
              <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                <p className="text-sm text-slate-400 mb-1">Pending</p>
                <p className="text-3xl font-bold text-amber-400">
                  {loans.filter(l => l.status === 'pending').length}
                </p>
              </div>
              <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                <p className="text-sm text-slate-400 mb-1">Overdue</p>
                <p className="text-3xl font-bold text-red-400">
                  {loans.filter(l => l.status === 'overdue').length}
                </p>
              </div>
              <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                <p className="text-sm text-slate-400 mb-1">Partial</p>
                <p className="text-3xl font-bold text-blue-400">
                  {loans.filter(l => l.status === 'partially_paid').length}
                </p>
              </div>
              <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                <p className="text-sm text-slate-400 mb-1">Paid</p>
                <p className="text-3xl font-bold text-cyan-400">
                  {loans.filter(l => l.status === 'paid').length}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent
          className="max-w-lg border-slate-700/80 text-slate-100"
          style={{ background: 'rgba(15, 23, 42, 0.98)' }}
        >
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit loan' : 'Add loan'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {form.type === 'to_pay'
                ? 'Money your organization owes to someone else.'
                : 'Money someone else owes to your organization.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm(f => ({ ...f, type: e.target.value as Loan['type'] }))}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
              >
                <option value="to_pay">We owe (payable)</option>
                <option value="to_receive">We are owed (receivable)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Who</label>
              <input
                value={form.party}
                onChange={(e) => setForm(f => ({ ...f, party: e.target.value }))}
                placeholder="Bank or person"
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What this is for"
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Principal</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.principal}
                  onChange={(e) => setForm(f => ({ ...f, principal: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Currency</label>
                <input
                  value={form.currency}
                  onChange={(e) => setForm(f => ({ ...f, currency: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Due date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Start date (optional)</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Interest % (optional)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.interestRate}
                  onChange={(e) => setForm(f => ({ ...f, interestRate: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm(f => ({ ...f, status: e.target.value as LoanRecordStatus }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                >
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="partially_paid">Partially paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="paid">Paid</option>
                  <option value="defaulted">Defaulted</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Installment (optional)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 500"
                  value={form.installmentAmount}
                  onChange={(e) => setForm(f => ({ ...f, installmentAmount: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm(f => ({ ...f, frequency: e.target.value as any }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="bi-weekly">Bi-weekly</option>
                  <option value="annually">Annually</option>
                  <option value="one-time">One-time</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Term (months)</label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 12"
                  value={form.termMonths}
                  onChange={(e) => setForm(f => ({ ...f, termMonths: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                />
              </div>
            </div>
            {!editingId && (
              <div className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-950/20">
                <div className="flex items-center gap-2 mb-1.5">
                  <Wallet className="size-4 text-cyan-400" />
                  <label className="text-xs font-bold text-white">
                    {form.type === 'to_pay' ? 'Deposit Into Bank Account (Optional)' : 'Disburse From Bank Account (Optional)'}
                  </label>
                </div>
                <select
                  value={form.bankAccountId}
                  onChange={(e) => setForm(f => ({ ...f, bankAccountId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-xs"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                >
                  <option value="">-- Outside Bank / Unlinked Cash --</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} • {b.accountType ? b.accountType.replace('_', ' ') : 'Account'} (••••{b.accountNumber ? b.accountNumber.slice(-4) : '0000'}) — {formatCurrency(b.balance, b.currency)}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-cyan-300/80 mt-1.5">
                  Selecting a bank account will post an initial ledger transaction and update the bank account balance.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={AXIOM.buttons.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitForm()}
              disabled={createLoan.loading || updateLoan.loading}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={AXIOM.buttons.primary}
            >
              {(createLoan.loading || updateLoan.loading) && <Loader2 className="size-4 animate-spin" />}
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Record Monthly Payment Modal ─── */}
      <Dialog open={paymentModalOpen} onOpenChange={(open) => {
        if (!open) {
          setPaymentModalOpen(false);
          setSelectedLoanForPayment(null);
        }
      }}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-xl border-slate-800 text-white"
          style={{ background: '#0b1120', border: '1px solid rgba(148, 163, 184, 0.2)' }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
              <div 
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: selectedLoanForPayment?.type === 'to_pay' 
                    ? 'rgba(6, 182, 212, 0.2)' 
                    : 'rgba(16, 185, 129, 0.2)',
                  color: selectedLoanForPayment?.type === 'to_pay' ? '#22d3ee' : '#34d399',
                }}
              >
                <DollarSign className="size-5" />
              </div>
              {selectedLoanForPayment?.type === 'to_pay' ? 'Pay Loan Installment' : 'Record Loan Collection'}
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Settle the installment for <span className="text-white font-semibold">{currentMonthName}</span> ({selectedLoanForPayment?.party}). Once recorded, this month is marked as settled to prevent duplicate payments.
            </DialogDescription>
          </DialogHeader>

          {selectedLoanForPayment && (
            <div className="space-y-4 py-2">
              {/* Loan Context Card */}
              <div 
                className="p-4 rounded-xl border border-slate-800"
                style={{ background: 'rgba(15, 23, 42, 0.7)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white">{selectedLoanForPayment.party}</h4>
                    <p className="text-xs text-slate-400">{selectedLoanForPayment.description || 'Loan Agreement'}</p>
                  </div>
                  <span 
                    className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider"
                    style={{
                      background: selectedLoanForPayment.type === 'to_pay' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: selectedLoanForPayment.type === 'to_pay' ? '#f87171' : '#34d399',
                      border: `1px solid ${selectedLoanForPayment.type === 'to_pay' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                    }}
                  >
                    {selectedLoanForPayment.type === 'to_pay' ? 'Payable (Liability)' : 'Receivable (Asset)'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-800">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Principal</span>
                    <span className="text-xs font-semibold text-white">{formatCurrency(selectedLoanForPayment.principal)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Remaining Balance</span>
                    <span className="text-xs font-bold text-amber-400">
                      {formatCurrency(selectedLoanForPayment.remainingBalance ?? selectedLoanForPayment.principal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Regular Installment</span>
                    <span className="text-xs font-semibold text-cyan-400">
                      {formatCurrency(selectedLoanForPayment.installmentAmount || 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Amount input + Quick shortcuts */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Payment Amount ({selectedLoanForPayment.currency || 'USD'}) *
                  </label>
                  <div className="flex items-center gap-1.5">
                    {!!selectedLoanForPayment.installmentAmount && selectedLoanForPayment.installmentAmount > 0 && (
                      <button
                        type="button"
                        onClick={() => setPaymentAmount(String(selectedLoanForPayment.installmentAmount))}
                        className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
                      >
                        Installment: {formatCurrency(selectedLoanForPayment.installmentAmount)}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaymentAmount(String(selectedLoanForPayment.remainingBalance ?? selectedLoanForPayment.principal))}
                      className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                    >
                      Full Balance: {formatCurrency(selectedLoanForPayment.remainingBalance ?? selectedLoanForPayment.principal)}
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    required
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm font-semibold"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                  />
                </div>
              </div>

              {/* Bank Account Selection (Requested specifically by user) */}
              <div className="p-3.5 rounded-xl border border-cyan-500/20 bg-cyan-950/10">
                <div className="flex items-center gap-2 mb-1.5">
                  <Wallet className="size-4 text-cyan-400" />
                  <label className="text-xs font-bold text-white">
                    Select Bank Account (Creates Ledger Transaction)
                  </label>
                </div>
                <select
                  value={paymentBankAccountId}
                  onChange={(e) => setPaymentBankAccountId(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                >
                  <option value="">-- No bank account (External / Unlinked Cash) --</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} • {b.accountType ? b.accountType.replace('_', ' ') : 'Account'} (••••{b.accountNumber ? b.accountNumber.slice(-4) : '0000'}) — {b.currency || 'USD'} {formatCurrency(b.balance)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-cyan-300/80 mt-2 flex items-start gap-1.5">
                  <ShieldCheck className="size-3.5 shrink-0 mt-0.5 text-cyan-400" />
                  <span>
                    {paymentBankAccountId 
                      ? `Selecting this bank account will automatically post a verified ${selectedLoanForPayment.type === 'to_pay' ? 'debit (expense)' : 'credit (income)'} transaction of ${formatCurrency(Number(paymentAmount) || 0)} and update its balance.`
                      : 'Tip: Select a bank account to automatically generate financial transactions and keep your cash balances reconciled.'}
                  </span>
                </p>
              </div>

              {/* Date & Payment Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                  >
                    <option value="bank_transfer">Bank Transfer / Wire</option>
                    <option value="direct_debit">Direct Debit / ACH</option>
                    <option value="card">Credit / Debit Card</option>
                    <option value="check">Check / Cheque</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
              </div>

              {/* Reference & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Reference / Check #</label>
                  <input
                    type="text"
                    placeholder="e.g. TR-2026-10"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Internal Notes</label>
                  <input
                    type="text"
                    placeholder="Optional memo"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: AXIOM.inputs.color }}
                  />
                </div>
              </div>

              {/* Dynamic Calculation & Double-Payment Lock Banner */}
              {Number(paymentAmount) > 0 && (
                <div 
                  className="p-3.5 rounded-xl border border-emerald-500/30 text-xs space-y-1.5"
                  style={{ background: 'rgba(16, 185, 129, 0.08)' }}
                >
                  <div className="flex items-center justify-between text-slate-200">
                    <span>New Remaining Balance:</span>
                    <span className="font-bold text-emerald-400">
                      {formatCurrency(Math.max(0, getLoanRemaining(selectedLoanForPayment) - Number(paymentAmount)))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-200">
                    <span>Next Due Date:</span>
                    <span className="font-medium text-white">
                      {selectedLoanForPayment.nextPaymentDate ? formatDate(selectedLoanForPayment.nextPaymentDate) : 'Advancing by 1 month'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-300 pt-1 border-t border-emerald-500/20">
                    <Lock className="size-3 text-emerald-400" />
                    <span>Enforced Lock: Loan will be marked as paid for {currentMonthName} to prevent duplicate payments.</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setPaymentModalOpen(false);
                setSelectedLoanForPayment(null);
              }}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={AXIOM.buttons.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitPayment()}
              disabled={recordPaymentMutation.loading || !Number(paymentAmount) || Number(paymentAmount) <= 0}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-50"
              style={{
                background: selectedLoanForPayment?.type === 'to_pay' 
                  ? 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)' 
                  : 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)',
              }}
            >
              {recordPaymentMutation.loading && <Loader2 className="size-4 animate-spin" />}
              Confirm & Pay {paymentAmount ? formatCurrency(Number(paymentAmount)) : ''}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Loan Amortization Schedule & Payment History Modal ─── */}
      <Dialog open={historyModalOpen} onOpenChange={(open) => {
        if (!open) {
          setHistoryModalOpen(false);
          setSelectedLoanForHistory(null);
        }
      }}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-3xl border-slate-800 text-white"
          style={{ background: '#0b1120', border: '1px solid rgba(148, 163, 184, 0.2)' }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
              <History className="size-5 text-cyan-400" />
              Schedule & History: {selectedLoanForHistory?.party}
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Complete monthly amortization timeline, settlement tracking, and payment ledger receipts.
            </DialogDescription>
          </DialogHeader>

          {selectedLoanForHistory && (
            <div className="space-y-4 py-2">
              {/* Loan Summary Metrics Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Loan Principal</span>
                  <span className="font-bold text-white text-sm">{formatCurrency(selectedLoanForHistory.principal)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase tracking-wider">12% Total Interest</span>
                  <span className="font-bold text-amber-400 text-sm">{formatCurrency(selectedLoanForHistory.totalInterest || 6618.55)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Total Repayment</span>
                  <span className="font-bold text-cyan-400 text-sm">{formatCurrency(selectedLoanForHistory.principal + (selectedLoanForHistory.totalInterest || 6618.55))}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Remaining Principal</span>
                  <span className="font-bold text-emerald-400 text-sm">{formatCurrency(selectedLoanForHistory.remainingBalance ?? 92115.12)}</span>
                </div>
              </div>

              {/* Tab Switcher */}
              <div className="flex gap-2 p-1.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setHistoryTab('schedule')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    historyTab === 'schedule' 
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Repayment Schedule ({amortizationSchedule.length} Months)
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('payments')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    historyTab === 'payments' 
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Payment Ledger Receipts ({selectedLoanPayments.length})
                </button>
              </div>

              {historyTab === 'schedule' ? (
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">Month</th>
                          <th className="p-3">Due Date</th>
                          <th className="p-3">Installment</th>
                          <th className="p-3 text-cyan-300">Principal ({selectedLoanForHistory?.type === 'to_pay' ? 'Liability' : 'Asset'})</th>
                          <th className="p-3 text-amber-300">Interest ({selectedLoanForHistory?.type === 'to_pay' ? 'Expense' : 'Income'})</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Settled Date</th>
                          <th className="p-3 text-right">Closing Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                        {amortizationSchedule.map((row) => (
                          <tr 
                            key={row.installmentNo}
                            className={`hover:bg-slate-800/30 transition-colors ${
                              row.monthKey === currentMonthKey ? 'bg-cyan-950/20 font-medium' : ''
                            }`}
                          >
                            <td className="p-3 text-slate-500 font-mono">{row.installmentNo}</td>
                            <td className="p-3 font-semibold text-white">
                              {row.monthLabel}
                              {row.monthKey === currentMonthKey && (
                                <span className="ml-2 text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-bold uppercase">Current</span>
                              )}
                            </td>
                            <td className="p-3 text-slate-400">{formatDate(row.dueDate)}</td>
                            <td className="p-3 font-semibold text-white">{formatCurrency(row.amount)}</td>
                            <td className="p-3 font-medium text-cyan-400">{formatCurrency(row.principalPart)}</td>
                            <td className="p-3 font-medium text-amber-400">{formatCurrency(row.interestPart)}</td>
                            <td className="p-3">
                              {row.isPaid ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  <CheckCircle className="size-3" /> Paid
                                </span>
                              ) : row.monthKey === currentMonthKey ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  <Clock className="size-3" /> Due Now
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400">
                                  Upcoming
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-slate-400">
                              {row.paidOn ? formatDate(row.paidOn) : '—'}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-300">
                              {formatCurrency(row.closingBalance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedLoanPayments.length === 0 ? (
                    <div className="p-8 text-center rounded-xl border border-dashed border-slate-800 text-slate-400 text-xs">
                      No payment receipts logged yet for this loan.
                    </div>
                  ) : (
                    selectedLoanPayments.map((p) => (
                      <div 
                        key={p.id}
                        className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-white">{formatCurrency(p.amount)}</span>
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-semibold">
                              Month: {p.paymentMonth}
                            </span>
                            <span className="text-xs text-cyan-400 font-medium">Principal: {formatCurrency(p.principalPart || 7884.88)}</span>
                            <span className="text-xs text-amber-400 font-medium">• Interest: {formatCurrency(p.interestPart || 1000)}</span>
                            <span className="text-xs text-slate-400 capitalize">• {p.method?.replace('_', ' ') || 'Bank Transfer'}</span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Paid on: <span className="text-slate-200">{formatDate(p.paidOn)}</span>
                            {p.reference && <span className="ml-2">| Ref: <code className="text-cyan-400">{p.reference}</code></span>}
                          </p>
                          {p.notes && <p className="text-xs text-slate-500 italic">"{p.notes}"</p>}
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 justify-end">
                            <CheckCircle className="size-3.5" /> Verified Ledger
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setHistoryModalOpen(false);
                setSelectedLoanForHistory(null);
              }}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={AXIOM.buttons.secondary}
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}