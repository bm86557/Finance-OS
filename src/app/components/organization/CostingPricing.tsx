import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency } from '@/lib/formatters';
import {
  Calculator,
  TrendingUp,
  Users,
  DollarSign,
  AlertCircle,
  Zap,
  Plus,
  Trash2,
  Edit2,
  Briefcase,
  Layers,
  Settings2,
  CheckCircle2,
  Clock,
  ArrowRight,
  PieChart,
} from 'lucide-react';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import type { DepartmentProfitability, OverheadAllocation, CommissionStructure, ExchangeRate } from '@/services/types';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';

interface DepartmentRow {
  id: string;
  name: string;
  costPerHour: number;
  directCostPerHour?: number | null;
  directCostPerMinute?: number | null;
  costPerMinute?: number | null;
  allocatedStaffLabor?: number;
  directDepartmentExpenses?: number;
  headcount: number;
  monthlyRevenue: number;
  monthlyCost: number;
  directCosts: number;
  allocatedOverhead: number;
  profit: number;
  margin: number;
  utilization: number | null;
  totalHours: number;
  billableHours: number;
  budget?: number;
  budgetSpent?: number;
  budgetRemaining?: number;
  budgetUtilization?: number;
  standardRate?: number;
}

function mapDepartmentProfitability(dp: DepartmentProfitability): DepartmentRow {
  const directCosts = Number(dp.directCosts ?? (dp as any).expenses ?? 0);
  const allocatedOverhead = Number(dp.allocatedOverhead ?? 0);
  const monthlyCost = directCosts + allocatedOverhead;
  const revenue = Number(dp.revenue ?? 0);
  const netProfit = revenue - monthlyCost;
  const margin = revenue > 0
    ? (netProfit / revenue) * 100
    : monthlyCost > 0
    ? -100
    : 0;

  const headcount = Number(dp.headcount ?? 0);
  const totalHours = Number(dp.totalHours || (headcount > 0 ? headcount * 160 : 160));
  const billableHours = Number(dp.billableHours ?? 0);
  const utilization = dp.utilization != null 
    ? Number(dp.utilization) 
    : (billableHours > 0 && totalHours > 0 ? Math.round((billableHours / totalHours) * 1000) / 10 : null);
  const costPerHour = Number(dp.costPerHour || (totalHours > 0 ? Math.round(monthlyCost / totalHours) : 0));
  const budget = dp.budget != null ? Number(dp.budget) : undefined;
  const budgetSpent = dp.budgetSpent != null ? Number(dp.budgetSpent) : directCosts;
  const budgetRemaining = budget != null ? Math.max(0, budget - budgetSpent) : undefined;
  const budgetUtilization = budget != null && budget > 0 ? (budgetSpent / budget) * 100 : 0;

  return {
    id: dp.departmentId,
    name: dp.departmentName,
    costPerHour,
    directCostPerHour: dp.directCostPerHour,
    directCostPerMinute: dp.directCostPerMinute,
    costPerMinute: dp.costPerMinute,
    allocatedStaffLabor: dp.allocatedStaffLabor,
    directDepartmentExpenses: dp.directDepartmentExpenses,
    headcount,
    monthlyRevenue: revenue,
    monthlyCost,
    directCosts,
    allocatedOverhead,
    profit: netProfit,
    margin,
    utilization,
    totalHours,
    billableHours,
    budget,
    budgetSpent,
    budgetRemaining,
    budgetUtilization,
    standardRate: dp.standardRate ?? (budget && budget > 0 ? Math.round(budget / totalHours) : costPerHour),
  };
}

export function CostingPricing() {
  const { currentOrganization } = useAuth();
  const { theme } = useTheme();
  const svc = useOrgServices();

  // ── 0. Accounts & Organization Active Currency ─────────────────────────
  const { data: accounts } = useServiceArray(
    () => svc.accounts.getAll(),
    [svc.orgId]
  );

  const currency = useMemo(() => {
    const bankAcc = (accounts ?? []).find(a => (a.subtype === 'bank_account' || a.type === 'asset') && a.currency);
    return bankAcc?.currency || currentOrganization?.currency || 'USD';
  }, [accounts, currentOrganization]);

  // ── 1. Departments & Department Profitability ─────────────────────────────
  const {
    data: allDepartments = [],
    refetch: refetchAllDepts,
  } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments']
  );

  const {
    data: deptProfit,
    loading: deptLoading,
    error: deptError,
    refetch: refetchDept,
  } = useService(
    () => svc.departments.getProfitability(),
    [svc.orgId],
    ['departments', 'budgets', 'transactions', 'projects']
  );

  const billableDepartments = useMemo(() => {
    const profMap = new Map((deptProfit ?? []).map(dp => [dp.departmentId, dp]));
    const rows: DepartmentRow[] = [];
    const seenIds = new Set<string>();

    for (const d of allDepartments) {
      seenIds.add(d.id);
      const dp = profMap.get(d.id);
      if (dp) {
        const mapped = mapDepartmentProfitability(dp);
        if (d.budget != null && (mapped.budget == null || mapped.budget === 0)) {
          mapped.budget = Number(d.budget);
          const spent = mapped.budgetSpent || mapped.directCosts;
          mapped.budgetRemaining = Math.max(0, mapped.budget - spent);
          mapped.budgetUtilization = mapped.budget > 0 ? (spent / mapped.budget) * 100 : 0;
        }
        rows.push(mapped);
      } else {
        const b = d.budget != null ? Number(d.budget) : undefined;
        rows.push({
          id: d.id,
          name: d.name,
          costPerHour: b && b > 0 ? Math.round(b / 160) : 0,
          headcount: 0,
          monthlyRevenue: 0,
          monthlyCost: 0,
          directCosts: 0,
          allocatedOverhead: 0,
          profit: 0,
          margin: 0,
          utilization: null,
          totalHours: 160,
          billableHours: 0,
          budget: b,
          budgetSpent: 0,
          budgetRemaining: b,
          budgetUtilization: 0,
          standardRate: b && b > 0 ? Math.round(b / 160) : 0,
        });
      }
    }

    for (const dp of deptProfit ?? []) {
      if (!seenIds.has(dp.departmentId)) {
        rows.push(mapDepartmentProfitability(dp));
      }
    }

    return rows;
  }, [allDepartments, deptProfit]);

  // ── 2. Project Profitability ────────────────────────────────────────────
  const {
    data: projectProfit,
    loading: projectsLoading,
    refetch: refetchProjects,
  } = useServiceArray(
    () => svc.projects.getProfitability(),
    [svc.orgId]
  );

  // ── 3. Overhead Allocations ─────────────────────────────────────────────
  const {
    data: allocations,
    loading: allocLoading,
    refetch: refetchAlloc,
  } = useServiceArray(
    () => svc.costing.getOverheadAllocations(),
    [svc.orgId]
  );

  // ── 4. Commission Structures ───────────────────────────────────────────
  const {
    data: commissions,
    loading: commLoading,
    refetch: refetchComm,
  } = useServiceArray(
    () => svc.costing.getCommissionStructures(),
    [svc.orgId]
  );

  // ── 5. Exchange Rates ───────────────────────────────────────────────────
  const { data: exchangeRates } = useServiceArray(
    () => svc.costing.getExchangeRates(),
    [svc.orgId]
  );

  // ── Quote Profitability Checker State ───────────────────────────────────
  const [quoteAmount, setQuoteAmount] = useState('100000');
  const [estimatedHours, setEstimatedHours] = useState('120');
  const [selectedDept, setSelectedDept] = useState('');

  // Auto-select first billable department when loaded
  useEffect(() => {
    if (billableDepartments.length > 0) {
      if (!selectedDept || !billableDepartments.some(d => d.id === selectedDept)) {
        setSelectedDept(billableDepartments[0].id);
      }
    }
  }, [billableDepartments, selectedDept]);

  // ── Commission Calculator State ─────────────────────────────────────────
  const [selectedCommissionId, setSelectedCommissionId] = useState<string>('');
  const [dealAmount, setDealAmount] = useState('10000');
  const [customFxRate, setCustomFxRate] = useState<number | null>(null);

  // Auto-select first commission structure when loaded
  useEffect(() => {
    if (commissions.length > 0 && !selectedCommissionId) {
      setSelectedCommissionId(commissions[0].id);
    }
  }, [commissions, selectedCommissionId]);

  const selectedCommission = useMemo(() => {
    return commissions.find(c => c.id === selectedCommissionId) || commissions[0] || null;
  }, [commissions, selectedCommissionId]);

  // Resolve FX Rate from exchange_rates table against active bank account currency
  const activeFxRate = useMemo(() => {
    if (customFxRate != null) return customFxRate;
    if (!selectedCommission) return 1;
    const from = selectedCommission.currency.toUpperCase();
    const to = currency.toUpperCase();
    if (from === to) return 1;

    // 1. Direct match in exchangeRates table
    const direct = exchangeRates.find(r => r.base.toUpperCase() === from && r.quote.toUpperCase() === to);
    if (direct && direct.rate > 0) return direct.rate;

    // 2. Inverse match in exchangeRates table
    const inverse = exchangeRates.find(r => r.base.toUpperCase() === to && r.quote.toUpperCase() === from);
    if (inverse && inverse.rate > 0) return Math.round((1 / inverse.rate) * 10000) / 10000;

    // 3. Standard fallback cross rates to USD
    if (to === 'USD') {
      if (from === 'AED') return 0.2723;
      if (from === 'EUR') return 1.086;
      if (from === 'GBP') return 1.28;
      if (from === 'PKR') return 0.0036;
    }
    // 4. Standard fallback cross rates to PKR
    if (to === 'PKR') {
      if (from === 'USD') return 278;
      if (from === 'AED') return 76;
      if (from === 'EUR') return 302;
      if (from === 'GBP') return 355;
    }

    return 1;
  }, [customFxRate, selectedCommission, exchangeRates, currency]);

  // Reset custom FX rate when selected commission changes
  useEffect(() => {
    setCustomFxRate(null);
  }, [selectedCommissionId]);

  // Commission Form States
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [editingCommissionId, setEditingCommissionId] = useState<string | null>(null);
  const [commissionForm, setCommissionForm] = useState({
    companyName: '',
    country: '',
    currency: 'USD',
    yourProfitPercentage: '50',
    middlemanPercentage: '25',
  });
  const [commissionSubmitting, setCommissionSubmitting] = useState(false);

  // Overhead Allocation Management States
  const [showMethodModal, setShowMethodModal] = useState(false);
  const [showAllocModal, setShowAllocModal] = useState(false);
  const [editingAllocId, setEditingAllocId] = useState<string | null>(null);
  const [allocForm, setAllocForm] = useState({
    name: '',
    amount: '30000',
    allocationBase: 'headcount' as OverheadAllocation['allocationBase'],
  });
  const [allocSubmitting, setAllocSubmitting] = useState(false);

  // Calculate quote profit
  const quoteAnalysis = useMemo(() => {
    if (!quoteAmount || !estimatedHours) return null;
    const dept = billableDepartments.find(d => d.id === selectedDept);
    if (!dept) return null;

    const hours = parseFloat(estimatedHours);
    const revenue = parseFloat(quoteAmount);
    if (!Number.isFinite(hours) || !Number.isFinite(revenue) || revenue <= 0 || hours <= 0) return null;

    const cost = dept.costPerHour * hours;
    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      cost,
      revenue,
      profit,
      margin,
      isProfitable: margin > 20,
      deptName: dept.name,
      costPerHour: dept.costPerHour,
    };
  }, [quoteAmount, estimatedHours, selectedDept, billableDepartments]);

  // Calculate commission breakdown
  const commissionBreakdown = useMemo(() => {
    if (!selectedCommission || !dealAmount) return null;
    const amount = parseFloat(dealAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const yourSplitPct = selectedCommission.yourProfitPercentage;
    const middlemanPct = selectedCommission.middlemanPercentage;

    const yourGrossShare = (amount * yourSplitPct) / 100;
    const middlemanCut = (yourGrossShare * middlemanPct) / 100;
    const yourNetShare = yourGrossShare - middlemanCut;
    const inBaseCurrency = yourNetShare * activeFxRate;

    return {
      dealAmount: amount,
      currency: selectedCommission.currency,
      yourSplitPct,
      middlemanPct,
      yourGrossShare,
      middlemanCut,
      yourNetShare,
      inBaseCurrency,
      effectiveMarginPct: amount > 0 ? (yourNetShare / amount) * 100 : 0,
    };
  }, [selectedCommission, dealAmount, activeFxRate]);

  // Commission handlers
  const openNewCommissionModal = () => {
    setEditingCommissionId(null);
    setCommissionForm({
      companyName: '',
      country: '',
      currency: 'USD',
      yourProfitPercentage: '50',
      middlemanPercentage: '20',
    });
    setShowCommissionModal(true);
  };

  const openEditCommissionModal = (comm: CommissionStructure) => {
    setEditingCommissionId(comm.id);
    setCommissionForm({
      companyName: comm.companyName,
      country: comm.country || '',
      currency: comm.currency,
      yourProfitPercentage: comm.yourProfitPercentage.toString(),
      middlemanPercentage: comm.middlemanPercentage.toString(),
    });
    setShowCommissionModal(true);
  };

  const handleSaveCommission = async () => {
    const name = commissionForm.companyName.trim();
    if (!name) {
      toast.error('Company name is required');
      return;
    }
    const yourSplit = parseFloat(commissionForm.yourProfitPercentage);
    const middleman = parseFloat(commissionForm.middlemanPercentage);

    if (isNaN(yourSplit) || yourSplit < 0 || yourSplit > 100) {
      toast.error('Your split percentage must be between 0% and 100%');
      return;
    }
    if (isNaN(middleman) || middleman < 0 || middleman > 100) {
      toast.error('Middleman cut must be between 0% and 100%');
      return;
    }
    // Validation constraint
    if (yourSplit + middleman > 100) {
      toast.error(
        `Total split cannot exceed 100% (Your split: ${yourSplit}%, Middleman cut: ${middleman}%, Sum: ${yourSplit + middleman}%)`
      );
      return;
    }

    setCommissionSubmitting(true);
    try {
      if (editingCommissionId) {
        const res = await svc.costing.updateCommissionStructure(editingCommissionId, {
          companyName: name,
          country: commissionForm.country.trim() || undefined,
          currency: commissionForm.currency,
          yourProfitPercentage: yourSplit,
          middlemanPercentage: middleman,
        });
        if (res.success) {
          toast.success('Commission structure updated');
          setShowCommissionModal(false);
          await refetchComm();
        } else {
          toast.error(res.error || 'Failed to update commission structure');
        }
      } else {
        const res = await svc.costing.createCommissionStructure({
          companyName: name,
          country: commissionForm.country.trim() || undefined,
          currency: commissionForm.currency,
          yourProfitPercentage: yourSplit,
          middlemanPercentage: middleman,
        });
        if (res.success) {
          toast.success('Commission structure saved');
          setShowCommissionModal(false);
          await refetchComm();
          if (res.data?.id) setSelectedCommissionId(res.data.id);
        } else {
          toast.error(res.error || 'Failed to create commission structure');
        }
      }
    } catch (err) {
      toast.error('Failed to save commission structure');
    } finally {
      setCommissionSubmitting(false);
    }
  };

  const handleDeleteCommission = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this commission structure?')) return;
    try {
      const res = await svc.costing.deleteCommissionStructure(id);
      if (res.success) {
        toast.success('Commission structure deleted');
        await refetchComm();
        if (selectedCommissionId === id) {
          const remaining = commissions.filter(c => c.id !== id);
          if (remaining.length > 0) setSelectedCommissionId(remaining[0].id);
        }
      } else {
        toast.error(res.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete commission structure');
    }
  };

  // Overhead Allocation Handlers
  const handleApplyMethod = async (method: OverheadAllocation['allocationBase']) => {
    try {
      const res = await svc.costing.setAllocationMethod(method);
      if (res.success) {
        toast.success(`Overhead allocation method updated to By ${method.replace('_', ' ')}`);
        setShowMethodModal(false);
        await Promise.all([refetchAlloc(), refetchDept()]);
      } else {
        toast.error(res.error || 'Failed to update allocation method');
      }
    } catch {
      toast.error('Failed to update allocation method');
    }
  };

  const openNewAllocModal = () => {
    setEditingAllocId(null);
    setAllocForm({
      name: '',
      amount: '35000',
      allocationBase: allocations[0]?.allocationBase || 'headcount',
    });
    setShowAllocModal(true);
  };

  const openEditAllocModal = (alloc: OverheadAllocation) => {
    setEditingAllocId(alloc.id);
    setAllocForm({
      name: alloc.name,
      amount: (alloc.amount || 0).toString(),
      allocationBase: alloc.allocationBase || 'headcount',
    });
    setShowAllocModal(true);
  };

  const handleSaveAlloc = async () => {
    const name = allocForm.name.trim();
    if (!name) {
      toast.error('Allocation name is required');
      return;
    }
    const amt = parseFloat(allocForm.amount);
    if (isNaN(amt) || amt < 0) {
      toast.error('Amount must be a positive number');
      return;
    }

    setAllocSubmitting(true);
    try {
      if (editingAllocId) {
        const res = await svc.costing.updateOverheadAllocation(editingAllocId, {
          name,
          amount: amt,
          allocationBase: allocForm.allocationBase,
        });
        if (res.success) {
          toast.success('Overhead pool updated');
          setShowAllocModal(false);
          await Promise.all([refetchAlloc(), refetchDept()]);
        } else {
          toast.error(res.error || 'Failed to update allocation');
        }
      } else {
        const res = await svc.costing.createOverheadAllocation({
          name,
          amount: amt,
          allocationBase: allocForm.allocationBase,
          accountIds: [],
          departments: [],
        });
        if (res.success) {
          toast.success('New overhead pool created');
          setShowAllocModal(false);
          await Promise.all([refetchAlloc(), refetchDept()]);
        } else {
          toast.error(res.error || 'Failed to create allocation');
        }
      }
    } catch {
      toast.error('Failed to save overhead allocation');
    } finally {
      setAllocSubmitting(false);
    }
  };

  const handleDeleteAlloc = async (id: string) => {
    if (!confirm('Are you sure you want to delete this overhead pool?')) return;
    try {
      const res = await svc.costing.deleteOverheadAllocation(id);
      if (res.success) {
        toast.success('Overhead pool deleted');
        await Promise.all([refetchAlloc(), refetchDept()]);
      } else {
        toast.error(res.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete overhead pool');
    }
  };

  const getMarginBadge = (margin: number, cost = 0) => {
    if (margin > 30) return AXIOM.badges.success;
    if (margin > 20) return AXIOM.badges.info;
    if (margin > 0) return AXIOM.badges.warning;
    if (margin === 0 && cost === 0) {
      return {
        background: 'rgba(148, 163, 184, 0.15)',
        color: '#94a3b8',
        border: '1px solid rgba(148, 163, 184, 0.3)',
      };
    }
    return AXIOM.badges.danger;
  };

  const currentAllocationMethod = allocations[0]?.allocationBase || 'headcount';

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
              <Calculator className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Costing & Pricing Intelligence
              </h1>
              <p className="text-slate-400 text-sm">
                Department cost rates, overhead allocation, hourly profitability, and deal commission models
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── 1. Department Cost Rates ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Department cost rates</h2>
            <p className="text-xs text-slate-400">
              Computed from direct debits + allocated overhead across active team capacity
            </p>
          </div>
          <button
            onClick={() => Promise.all([refetchDept(), refetchAllDepts()])}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium px-3 py-1.5 rounded-lg border border-cyan-500/30 hover:border-cyan-500/50"
          >
            Refresh Rates
          </button>
        </div>

        {deptError && (
          <p className="text-sm text-amber-400 mb-4" role="alert">
            Could not load department rates. {deptError}
          </p>
        )}
        {deptLoading && (
          <div className="p-8 rounded-2xl text-center" style={AXIOM.containers.list}>
            <p className="text-sm text-slate-400">Calculating real department capacity and cost rates…</p>
          </div>
        )}
        {!deptLoading && !deptError && billableDepartments.length === 0 && (
          <div className="p-8 rounded-2xl text-center" style={AXIOM.containers.list}>
            <p className="text-slate-300 mb-1">No departments yet</p>
            <p className="text-sm text-slate-500">
              Add departments under team or settings to see cost rates and quote against them.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {billableDepartments.map((dept, idx) => (
            <motion.div
              key={dept.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + idx * 0.05 }}
              className="p-6 rounded-2xl flex flex-col justify-between"
              style={AXIOM.containers.list}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold text-lg">{dept.name}</h3>
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={getMarginBadge(dept.margin, dept.monthlyCost)}>
                    {dept.margin.toFixed(1)}% margin
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Cost / Hour</p>
                    <p className="text-xl font-bold text-white">
                      {formatCurrency(dept.costPerHour, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Active Headcount</p>
                    <p className="text-xl font-bold text-white flex items-center gap-1.5">
                      <Users className="size-4 text-cyan-400" />
                      {dept.headcount}
                    </p>
                  </div>
                </div>

                <div className="mb-4 p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-between text-xs">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Clock className="size-3.5 text-slate-400" />
                    Capacity
                  </span>
                  <span className="text-slate-200 font-medium">
                    {dept.totalHours} hrs / mo
                  </span>
                  <span className="text-slate-400">|</span>
                  <span className="text-slate-400">Timesheets:</span>
                  <span className="text-cyan-300 font-medium">
                    {dept.billableHours > 0 
                      ? `${dept.billableHours}h (${dept.utilization ?? 0}% billable)` 
                      : dept.utilization != null 
                      ? `${dept.utilization}% billable` 
                      : 'No timesheet yet'}
                  </span>
                </div>

                {/* Department Budget Tracking */}
                <div className="mb-4 p-3 rounded-xl bg-slate-900/60 border border-slate-700/60">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">Department Budget</span>
                    <span className="text-white font-semibold">
                      {dept.budget != null && dept.budget > 0
                        ? formatCurrency(dept.budget, currency)
                        : 'No budget set'}
                    </span>
                  </div>
                  {dept.budget != null && dept.budget > 0 && (
                    <>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mb-1.5">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (dept.budgetSpent ?? dept.monthlyCost) > dept.budget
                              ? 'bg-red-500'
                              : (dept.budgetSpent ?? dept.monthlyCost) > dept.budget * 0.8
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, !isNaN(dept.budgetSpent ?? dept.monthlyCost) && dept.budget > 0 ? (((dept.budgetSpent ?? dept.monthlyCost) / dept.budget) * 100) : 0))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className={(dept.budgetSpent ?? dept.monthlyCost) > dept.budget ? 'text-red-400 font-medium' : 'text-slate-400'}>
                          {formatCurrency(dept.budgetSpent ?? dept.monthlyCost, currency)} spent ({!isNaN(dept.budgetSpent ?? dept.monthlyCost) && dept.budget > 0 ? (((dept.budgetSpent ?? dept.monthlyCost) / dept.budget) * 100).toFixed(0) : '0'}%)
                        </span>
                        <span className={(dept.budgetSpent ?? dept.monthlyCost) > dept.budget ? 'text-red-400 font-semibold' : 'text-emerald-400 font-medium'}>
                          {(dept.budgetSpent ?? dept.monthlyCost) > dept.budget
                            ? `Exceeded by ${formatCurrency((dept.budgetSpent ?? dept.monthlyCost) - dept.budget, currency)}`
                            : `${formatCurrency(dept.budget - (dept.budgetSpent ?? dept.monthlyCost), currency)} remaining`}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-3 space-y-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Revenue</span>
                  <span className="text-sm text-emerald-400 font-medium">
                    {formatCurrency(dept.monthlyRevenue, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Direct Costs</span>
                  <span className="text-sm text-amber-400 font-medium">
                    {formatCurrency(dept.directCosts, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Allocated Overhead</span>
                  <span className="text-sm text-indigo-300 font-medium">
                    {formatCurrency(dept.allocatedOverhead, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                  <span className="text-xs text-slate-300 font-semibold">Net Profit</span>
                  <span className={`text-sm font-bold ${dept.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(dept.profit, currency)}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── 2. Projects Table ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Briefcase className="size-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Projects</h2>
              <p className="text-sm text-slate-400">Quoted vs actual margin from your project list</p>
            </div>
          </div>
          <button
            onClick={() => refetchProjects()}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
          >
            Refresh Projects
          </button>
        </div>

        {projectsLoading && <p className="text-sm text-slate-400">Loading projects…</p>}
        {!projectsLoading && projectProfit.length === 0 && (
          <p className="text-sm text-slate-500">No projects in this organization yet.</p>
        )}
        {!projectsLoading && projectProfit.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/50">
                  <th className="py-2.5 pr-4 font-medium">Project</th>
                  <th className="py-2.5 pr-4 font-medium">Client</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Quoted Amount</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Actual Cost</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Logged Hours</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Profit Margin</th>
                  <th className="py-2.5 pr-4 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {projectProfit.map(p => (
                  <tr key={p.projectId} className="border-b border-slate-800/80 text-slate-200 hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 pr-4 font-medium text-white">{p.projectName}</td>
                    <td className="py-3.5 pr-4 text-slate-400">{p.clientName || 'Direct'}</td>
                    <td className="py-3.5 pr-4 text-right tabular-nums font-medium">
                      {formatCurrency(p.quotedAmount, currency)}
                    </td>
                    <td className="py-3.5 pr-4 text-right tabular-nums text-amber-300 font-medium">
                      {formatCurrency(p.actualCost, currency)}
                    </td>
                    <td className="py-3.5 pr-4 text-right tabular-nums">
                      <span className="font-semibold text-cyan-400 font-mono">
                        {p.loggedHours != null ? `${p.loggedHours.toFixed(1)} hrs` : '0.0 hrs'}
                      </span>
                      {p.contributorCount ? (
                        <span className="block text-[11px] text-slate-400">
                          {p.contributorCount} {p.contributorCount === 1 ? 'member' : 'members'}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`py-3.5 pr-4 text-right tabular-nums font-bold ${
                        p.profitMargin >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {p.profitMargin.toFixed(1)}%
                    </td>
                    <td className="py-3.5 pr-4 text-center">
                      <span className="px-2 py-0.5 rounded text-xs capitalize bg-slate-800 text-slate-300 border border-slate-700">
                        {p.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* ── 3. Quote Profitability Checker ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.chartBlue}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: AXIOM.iconBoxes.purple,
              boxShadow: AXIOM.shadows.iconPurple,
            }}
          >
            <Zap className="size-5 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Quote Profitability Checker</h3>
            <p className="text-sm text-slate-400">
              Simulate expected margin against current department cost rates before committing
            </p>
          </div>
        </div>

        <div className="space-y-6 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-white font-medium mb-2 block text-sm">Quote Amount ({currency})</label>
              <input
                type="number"
                placeholder="350000"
                value={quoteAmount}
                onChange={e => setQuoteAmount(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>
            <div>
              <label className="text-white font-medium mb-2 block text-sm">Estimated Hours</label>
              <input
                type="number"
                placeholder="120"
                value={estimatedHours}
                onChange={e => setEstimatedHours(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>
            <div>
              <label className="text-white font-medium mb-2 block text-sm">Target Department</label>
              <select
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              >
                {billableDepartments.map(dept => (
                  <option key={dept.id} value={dept.id} className="bg-slate-900 text-white">
                    {dept.name} ({formatCurrency(dept.costPerHour, currency)}/hr)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {quoteAnalysis && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 rounded-2xl"
              style={{
                background: quoteAnalysis.isProfitable
                  ? 'rgba(16, 185, 129, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)',
                border: quoteAnalysis.isProfitable
                  ? '2px solid rgba(16, 185, 129, 0.3)'
                  : '2px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <div className="flex items-start gap-4 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: quoteAnalysis.isProfitable ? AXIOM.iconBoxes.green : AXIOM.iconBoxes.red,
                    boxShadow: quoteAnalysis.isProfitable ? AXIOM.shadows.iconGreen : AXIOM.shadows.iconRed,
                  }}
                >
                  {quoteAnalysis.isProfitable ? (
                    <TrendingUp className="size-6 text-white" />
                  ) : (
                    <AlertCircle className="size-6 text-white" />
                  )}
                </div>
                <div className="flex-1">
                  <h4
                    className={`text-xl font-bold mb-1 ${
                      quoteAnalysis.isProfitable ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {quoteAnalysis.isProfitable ? 'Profitable Quote' : 'Low Margin Warning'}
                  </h4>
                  <p className="text-sm text-slate-300">
                    {quoteAnalysis.isProfitable
                      ? `This quote yields a healthy ${quoteAnalysis.margin.toFixed(1)}% margin using ${quoteAnalysis.deptName}'s cost rate.`
                      : `Produces ${quoteAnalysis.margin.toFixed(1)}% margin, below target operating threshold (20%).`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Quote Revenue</p>
                  <p className="text-xl font-bold text-white">{formatCurrency(quoteAnalysis.revenue, currency)}</p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Estimated Cost ({estimatedHours}h)</p>
                  <p className="text-xl font-bold text-amber-400">{formatCurrency(quoteAnalysis.cost, currency)}</p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Expected Profit</p>
                  <p className={`text-xl font-bold ${quoteAnalysis.profit > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(quoteAnalysis.profit, currency)}
                  </p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Projected Margin</p>
                  <p className={`text-xl font-bold ${quoteAnalysis.isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                    {quoteAnalysis.margin.toFixed(1)}%
                  </p>
                </div>
              </div>

              {!quoteAnalysis.isProfitable && (
                <div
                  className="mt-4 p-3 rounded-xl"
                  style={{
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                >
                  <p className="text-sm text-amber-400 font-medium">
                    Recommendation: consider increasing the quote to at least{' '}
                    {formatCurrency(quoteAnalysis.cost / 0.75, currency)} to hit a healthy 25% target margin.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ── 4. Overhead Allocation Settings ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white mb-1">Overhead Allocation Settings</h3>
            <p className="text-sm text-slate-400">
              Shared business costs distributed across departments for honest gross & net margins
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMethodModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={AXIOM.buttons.secondary}
            >
              Change Method
            </button>
            <button
              onClick={openNewAllocModal}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5"
              style={AXIOM.buttons.primary}
            >
              <Plus className="size-4" /> Add Overhead Pool
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl" style={AXIOM.containers.item}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Layers className="size-5" />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Active Distribution Base</p>
                <p className="text-xs text-slate-400 capitalize">
                  Current: By {currentAllocationMethod.replace('_', ' ')}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400">Total Monthly Pools:</span>
              <p className="text-lg font-bold text-white">
                {formatCurrency(
                  allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0),
                  currency
                )}
              </p>
            </div>
          </div>

          {allocLoading && <p className="text-sm text-slate-400">Loading overhead allocation pools…</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {allocations.map(alloc => (
              <div
                key={alloc.id}
                className="p-4 rounded-xl relative group flex flex-col justify-between"
                style={AXIOM.containers.item}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-white">{alloc.name}</p>
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditAllocModal(alloc)}
                        className="p-1 hover:text-cyan-400 text-slate-400"
                        title="Edit Pool"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteAlloc(alloc.id)}
                        className="p-1 hover:text-red-400 text-slate-400"
                        title="Delete Pool"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xl font-bold text-white mb-1">
                    {formatCurrency(alloc.amount || 0, currency)}
                  </p>
                  <p className="text-xs text-slate-400 capitalize">
                    Basis: {alloc.allocationBase?.replace('_', ' ')}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-700/40 text-[11px] text-slate-400 flex justify-between">
                  <span>Monthly Pool</span>
                  <span className="text-emerald-400">Active</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── 5. Commission Calculator ───────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.chartBlue}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: AXIOM.iconBoxes.cyan,
                  boxShadow: AXIOM.shadows.iconCyan,
                }}
              >
                <DollarSign className="size-5 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">Commission Calculator</h3>
            </div>
            <p className="text-sm text-slate-400">
              Calculate Dubai splits & USA partner commission structures with live exchange rates
            </p>
          </div>
          <button
            onClick={openNewCommissionModal}
            className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5"
            style={AXIOM.buttons.secondary}
          >
            <Plus className="size-4" /> Add Partner Structure
          </button>
        </div>

        <div className="space-y-6">
          {/* Partner Structure Selection Pills */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-slate-400 mr-1">Partner:</span>
            {commissions.map(commission => (
              <button
                key={commission.id}
                onClick={() => setSelectedCommissionId(commission.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  selectedCommissionId === commission.id ? 'ring-2 ring-cyan-400' : ''
                }`}
                style={
                  selectedCommissionId === commission.id ? AXIOM.buttons.primary : AXIOM.buttons.secondary
                }
              >
                {commission.companyName} ({commission.currency})
              </button>
            ))}
          </div>

          {/* Calculator Inputs */}
          {selectedCommission && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-white font-medium mb-2 block text-sm">
                    Deal Amount ({selectedCommission.currency})
                  </label>
                  <div className="flex gap-2">
                    <span
                      className="px-4 py-3 rounded-xl text-white font-semibold flex items-center"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    >
                      {selectedCommission.currency}
                    </span>
                    <input
                      type="number"
                      placeholder="10000"
                      value={dealAmount}
                      onChange={e => setDealAmount(e.target.value)}
                      className="flex-1 px-4 py-3 rounded-xl text-white"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-white font-medium mb-2 block text-sm">
                    Exchange Rate to {currency} (Live: {activeFxRate})
                  </label>
                  <input
                    type="number"
                    value={activeFxRate}
                    onChange={e => setCustomFxRate(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Your Split</p>
                  <p className="text-xl font-bold text-cyan-400">
                    {selectedCommission.yourProfitPercentage}%
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Company gross share of deal</p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Middleman Cut</p>
                  <p className="text-xl font-bold text-red-400">
                    {selectedCommission.middlemanPercentage}%
                  </p>
                  <p className="text-xs text-slate-500 mt-1">% deducted from your share</p>
                </div>
              </div>

              {commissionBreakdown && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 rounded-xl"
                  style={AXIOM.containers.item}
                >
                  <h4 className="text-white font-semibold mb-4 text-base flex items-center justify-between">
                    <span>Financial Deal Breakdown</span>
                    <span className="text-xs text-cyan-400 font-normal">
                      Effective Return: {commissionBreakdown.effectiveMarginPct.toFixed(1)}%
                    </span>
                  </h4>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">Total Deal Size</span>
                      <span className="text-white font-semibold">
                        {commissionBreakdown.currency} {commissionBreakdown.dealAmount.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">
                        Your {commissionBreakdown.yourSplitPct}% Split
                      </span>
                      <span className="text-cyan-400 font-semibold">
                        {commissionBreakdown.currency} {commissionBreakdown.yourGrossShare.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">
                        Middleman Cut ({commissionBreakdown.middlemanPct}%)
                      </span>
                      <span className="text-red-400 font-semibold">
                        -{commissionBreakdown.currency} {commissionBreakdown.middlemanCut.toLocaleString()}
                      </span>
                    </div>

                    <div className="h-px my-2" style={{ background: 'rgba(148, 163, 184, 0.2)' }} />

                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium">Your Final Net Takehome</span>
                      <span className="text-emerald-400 font-bold text-lg">
                        {commissionBreakdown.currency} {commissionBreakdown.yourNetShare.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">
                        Equivalent in {currency} (@ {activeFxRate})
                      </span>
                      <span className="text-emerald-300 font-bold text-lg">
                        {formatCurrency(commissionBreakdown.inBaseCurrency, currency)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* Saved Commission Structures Cards */}
          <div className="mt-8">
            <h4 className="text-xl font-bold text-white mb-4">Saved Commission Structures</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {commissions.map((comm, idx) => (
                <motion.div
                  key={comm.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + idx * 0.05 }}
                  className={`p-4 rounded-xl cursor-pointer transition-all ${
                    selectedCommissionId === comm.id ? 'ring-2 ring-cyan-400' : ''
                  }`}
                  style={AXIOM.containers.item}
                  onClick={() => setSelectedCommissionId(comm.id)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-white font-semibold">{comm.companyName}</h5>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openEditCommissionModal(comm);
                        }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white"
                        style={{ background: 'rgba(148, 163, 184, 0.1)' }}
                        title="Edit Structure"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                      <button
                        onClick={e => handleDeleteCommission(comm.id, e)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-400"
                        style={{ background: 'rgba(148, 163, 184, 0.1)' }}
                        title="Delete Structure"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Currency</p>
                      <p className="font-bold text-white">{comm.currency}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Country</p>
                      <p className="font-bold text-white">{comm.country || 'International'}</p>
                    </div>
                  </div>

                  <div className="pt-2 space-y-1" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Your Split</span>
                      <span className="text-cyan-400 font-semibold">{comm.yourProfitPercentage}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Middleman Cut</span>
                      <span className="text-red-400 font-semibold">{comm.middlemanPercentage}%</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Modal: Change Allocation Method ───────────────────────────────── */}
      <AnimatePresence>
        {showMethodModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md p-6 rounded-2xl space-y-4"
              style={AXIOM.containers.modal}
            >
              <h3 className="text-xl font-bold text-white">Change Overhead Allocation Method</h3>
              <p className="text-xs text-slate-400">
                Determines how shared monthly overhead is divided across active departments
              </p>

              <div className="space-y-2 pt-2">
                {[
                  {
                    id: 'headcount',
                    title: 'By Headcount',
                    desc: 'Distribute based on number of active team members in each department',
                  },
                  {
                    id: 'revenue',
                    title: 'By Revenue',
                    desc: 'Distribute based on client revenue credits generated by each department',
                  },
                  {
                    id: 'direct_cost',
                    title: 'By Direct Costs',
                    desc: 'Distribute proportionally to direct expense debits of each department',
                  },
                  {
                    id: 'equal',
                    title: 'Equal Split',
                    desc: 'Divide all overhead equally across all departments',
                  },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => handleApplyMethod(opt.id as any)}
                    className="w-full text-left p-3.5 rounded-xl border border-slate-700/60 hover:border-cyan-500/50 hover:bg-slate-800/60 transition-all flex items-start gap-3"
                  >
                    <CheckCircle2
                      className={`size-5 mt-0.5 shrink-0 ${
                        currentAllocationMethod === opt.id ? 'text-cyan-400' : 'text-slate-600'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-white">{opt.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  onClick={() => setShowMethodModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal: Add / Edit Overhead Pool ───────────────────────────────── */}
      <AnimatePresence>
        {showAllocModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md p-6 rounded-2xl space-y-4"
              style={AXIOM.containers.modal}
            >
              <h3 className="text-xl font-bold text-white">
                {editingAllocId ? 'Edit Overhead Pool' : 'Add Overhead Pool'}
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Pool Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Cloud Hosting & Servers"
                    value={allocForm.name}
                    onChange={e => setAllocForm({ ...allocForm, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">
                    Monthly Pool Amount ({currency})
                  </label>
                  <input
                    type="number"
                    placeholder="35000"
                    value={allocForm.amount}
                    onChange={e => setAllocForm({ ...allocForm, amount: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">
                    Allocation Basis
                  </label>
                  <select
                    value={allocForm.allocationBase}
                    onChange={e => setAllocForm({ ...allocForm, allocationBase: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  >
                    <option value="headcount" className="bg-slate-900 text-white">By Headcount</option>
                    <option value="revenue" className="bg-slate-900 text-white">By Revenue</option>
                    <option value="direct_cost" className="bg-slate-900 text-white">By Direct Cost</option>
                    <option value="square_footage" className="bg-slate-900 text-white">By Square Footage</option>
                    <option value="time_utilization" className="bg-slate-900 text-white">By Time Utilization (Logged Hours)</option>
                    <option value="manual_weight" className="bg-slate-900 text-white">Manual Weight</option>
                    <option value="department_ratio" className="bg-slate-900 text-white">Department Ratio</option>
                    <option value="equal" className="bg-slate-900 text-white">Equal Split</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowAllocModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAlloc}
                  disabled={allocSubmitting}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                >
                  {allocSubmitting ? 'Saving…' : 'Save Overhead Pool'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal: Add / Edit Commission Structure ────────────────────────── */}
      <AnimatePresence>
        {showCommissionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg p-6 rounded-2xl space-y-4"
              style={AXIOM.containers.modal}
            >
              <h3 className="text-xl font-bold text-white">
                {editingCommissionId ? 'Edit Partner Structure' : 'New Partner Commission Structure'}
              </h3>
              <p className="text-xs text-slate-400">
                Configure partner percentage split and middleman cut. Splits cannot exceed 100%.
              </p>

              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-300 font-medium block mb-1">Company / Partner Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Dubai Tech Partners"
                      value={commissionForm.companyName}
                      onChange={e => setCommissionForm({ ...commissionForm, companyName: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 font-medium block mb-1">Country / Region</label>
                    <input
                      type="text"
                      placeholder="e.g. UAE"
                      value={commissionForm.country}
                      onChange={e => setCommissionForm({ ...commissionForm, country: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Currency</label>
                  <select
                    value={commissionForm.currency}
                    onChange={e => setCommissionForm({ ...commissionForm, currency: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  >
                    <option value="AED" className="bg-slate-900 text-white">AED (UAE Dirham)</option>
                    <option value="USD" className="bg-slate-900 text-white">USD (US Dollar)</option>
                    <option value="EUR" className="bg-slate-900 text-white">EUR (Euro)</option>
                    <option value="GBP" className="bg-slate-900 text-white">GBP (British Pound)</option>
                    <option value="PKR" className="bg-slate-900 text-white">PKR (Pakistani Rupee)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-300 font-medium block mb-1">Your Split (%)</label>
                    <input
                      type="number"
                      placeholder="50"
                      min="0"
                      max="100"
                      value={commissionForm.yourProfitPercentage}
                      onChange={e => setCommissionForm({ ...commissionForm, yourProfitPercentage: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 font-medium block mb-1">
                      Middleman Cut (% of your share)
                    </label>
                    <input
                      type="number"
                      placeholder="20"
                      min="0"
                      max="100"
                      value={commissionForm.middlemanPercentage}
                      onChange={e => setCommissionForm({ ...commissionForm, middlemanPercentage: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                </div>

                {parseFloat(commissionForm.yourProfitPercentage) + parseFloat(commissionForm.middlemanPercentage) > 100 && (
                  <p className="text-xs text-red-400 font-medium">
                    ⚠️ Split validation error: Your split + Middleman cut cannot exceed 100%!
                  </p>
                )}
              </div>

              <div className="pt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowCommissionModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCommission}
                  disabled={commissionSubmitting}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                >
                  {commissionSubmitting ? 'Saving…' : 'Save Structure'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}