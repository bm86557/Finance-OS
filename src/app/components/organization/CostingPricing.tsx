import { useState, useMemo, useEffect, useCallback } from 'react';
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
  CheckCircle2,
  Clock,
  Save,
  Download,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import type {
  DepartmentProfitability,
  OverheadAllocation,
  OverheadAllocationBase,
  CommissionStructure,
  Quote,
  QuoteCalculationResult,
} from '@/services/types';
import { useAuth } from '@/contexts/AuthContext';

type CostingPeriodKey = '1M' | '3M' | '1Y' | 'ALL';

const DEC2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

interface DepartmentRow {
  id: string;
  name: string;
  costPerHour: number | null;
  directCostPerHour: number | null;
  directCostPerMinute: number | null;
  costPerMinute: number | null;
  allocatedStaffLabor?: number;
  directDepartmentExpenses?: number;
  headcount: number;
  monthlyRevenue: number;
  monthlyCost: number;
  directCosts: number;
  allocatedOverhead: number;
  profit: number;
  /** Strictly null (Undefined) when revenue <= 0 (§33 #9) */
  margin: number | null;
  /** Strictly null (Undefined) when headcount === 0 (§12.1 L620) */
  utilization: number | null;
  totalHours: number | null;
  billableHours: number;
  budget?: number;
  budgetSpent?: number;
  budgetRemaining?: number;
  budgetUtilization?: number;
  standardRate?: number | null;
  capacityBasis: string;
  policyVersion: string;
  periodLabel: string;
  periodMonths: number;
  laborCostSource?: string;
}

/**
 * Pure mapper from authoritative backend `DepartmentProfitability` payload.
 * Never recomputes or fabricates margins / capacity denominators client-side (§6 L231, §33 #9).
 */
function mapDepartmentProfitability(dp: DepartmentProfitability): DepartmentRow {
  const directCosts = Number(dp.directCosts ?? 0);
  const allocatedOverhead = Number(dp.allocatedOverhead ?? 0);
  const monthlyCost = dp.fullDepartmentCost != null ? Number(dp.fullDepartmentCost) : directCosts + allocatedOverhead;
  const revenue = Number(dp.revenue ?? 0);
  const netProfit = dp.netProfit != null ? Number(dp.netProfit) : revenue - monthlyCost;
  const headcount = Number(dp.headcount ?? 0);
  const totalHours = dp.totalHours != null ? Number(dp.totalHours) : null;
  const billableHours = Number(dp.billableHours ?? 0);
  const budget = dp.budget != null ? Number(dp.budget) : undefined;
  const budgetSpent = dp.budgetSpent != null ? Number(dp.budgetSpent) : directCosts;
  const budgetRemaining = dp.budgetRemaining != null
    ? Number(dp.budgetRemaining)
    : (budget != null ? Math.max(0, budget - budgetSpent) : undefined);
  const budgetUtilization = dp.budgetUtilization != null
    ? Number(dp.budgetUtilization)
    : (budget != null && budget > 0 ? (budgetSpent / budget) * 100 : 0);

  return {
    id: dp.departmentId,
    name: dp.departmentName,
    costPerHour: dp.costPerHour != null ? Number(dp.costPerHour) : null,
    directCostPerHour: dp.directCostPerHour != null ? Number(dp.directCostPerHour) : null,
    directCostPerMinute: dp.directCostPerMinute != null ? Number(dp.directCostPerMinute) : null,
    costPerMinute: dp.costPerMinute != null ? Number(dp.costPerMinute) : null,
    allocatedStaffLabor: dp.allocatedStaffLabor,
    directDepartmentExpenses: dp.directDepartmentExpenses,
    headcount,
    monthlyRevenue: revenue,
    monthlyCost,
    directCosts,
    allocatedOverhead,
    profit: netProfit,
    margin: dp.profitMargin != null ? Number(dp.profitMargin) : null,
    utilization: dp.utilization != null ? Number(dp.utilization) : null,
    totalHours,
    billableHours,
    budget,
    budgetSpent,
    budgetRemaining,
    budgetUtilization,
    standardRate: dp.standardRate ?? null,
    capacityBasis: dp.costMatrixMeta?.selectedCapacityBasis ?? dp.capacityBasis ?? (totalHours != null ? 'fte_160h' : 'none'),
    policyVersion: dp.costMatrixMeta?.policyVersion ?? 'v1.2-costing',
    periodLabel: dp.costMatrixMeta?.period ?? 'Current Month',
    periodMonths: dp.costMatrixMeta?.periodMonths ?? 1,
    laborCostSource: dp.costMatrixMeta?.laborCostSource,
  };
}

export function CostingPricing() {
  const { currentOrganization } = useAuth();
  const svc = useOrgServices();

  // Authoritative Organization Base Currency matching backend calculations (§8 L382, L386)
  const currency = useMemo(() => {
    return (currentOrganization?.baseCurrency || currentOrganization?.currency || 'USD').toUpperCase();
  }, [currentOrganization]);

  // Period window selector for Department Cost Rates (defaults to Current Calendar Month = 1M)
  const [costingPeriod, setCostingPeriod] = useState<CostingPeriodKey>('1M');

  // ── 1. Departments & Department Profitability ─────────────────────────────
  const {
    data: allDepartments = [],
    refetch: refetchAllDepts,
  } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );

  const {
    data: deptProfit,
    loading: deptLoading,
    error: deptError,
    refetch: refetchDept,
  } = useService(
    () => svc.departments.getProfitability({ period: costingPeriod }),
    [svc.orgId, costingPeriod],
    ['departments', 'budgets', 'transactions', 'projects', 'overheadAllocations'],
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
          mapped.budget = Number(d.budget) * mapped.periodMonths;
          const spent = mapped.budgetSpent ?? mapped.directCosts;
          mapped.budgetRemaining = Math.max(0, mapped.budget - spent);
          mapped.budgetUtilization = mapped.budget > 0 ? (spent / mapped.budget) * 100 : 0;
        }
        rows.push(mapped);
      } else {
        const b = d.budget != null ? Number(d.budget) : undefined;
        rows.push({
          id: d.id,
          name: d.name,
          costPerHour: null,
          directCostPerHour: null,
          directCostPerMinute: null,
          costPerMinute: null,
          headcount: 0,
          monthlyRevenue: 0,
          monthlyCost: 0,
          directCosts: 0,
          allocatedOverhead: 0,
          profit: 0,
          margin: null,
          utilization: null,
          totalHours: null,
          billableHours: 0,
          budget: b,
          budgetSpent: 0,
          budgetRemaining: b,
          budgetUtilization: 0,
          standardRate: null,
          capacityBasis: 'none',
          policyVersion: 'v1.2-costing',
          periodLabel: 'Current Month',
          periodMonths: 1,
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

  const activePeriodLabel = billableDepartments[0]?.periodLabel || 'Current Month';

  // ── 2. Project Profitability ────────────────────────────────────────────
  const {
    data: projectProfit,
    loading: projectsLoading,
    refetch: refetchProjects,
  } = useServiceArray(
    () => svc.projects.getProfitability(),
    [svc.orgId],
  );

  // ── 3. Overhead Allocations & Frozen Allocation Runs ────────────────────
  const {
    data: allocations,
    loading: allocLoading,
    refetch: refetchAlloc,
  } = useServiceArray(
    () => svc.costing.getOverheadAllocations(),
    [svc.orgId],
  );

  const {
    data: allocationRuns,
    refetch: refetchRuns,
  } = useServiceArray(
    () => svc.costing.getAllocationRuns(),
    [svc.orgId],
  );

  const [freezingRun, setFreezingRun] = useState(false);

  // ── 4. Saved Quotes (§14) ───────────────────────────────────────────────
  const {
    data: savedQuotes,
    refetch: refetchQuotes,
  } = useServiceArray(
    () => svc.costing.getQuotes(),
    [svc.orgId],
  );

  // ── 5. Commission Structures ────────────────────────────────────────────
  const {
    data: commissions,
    error: commError,
    refetch: refetchComm,
  } = useServiceArray(
    () => svc.costing.getCommissionStructures(),
    [svc.orgId],
  );

  // ── 6. Exchange Rates (Org overrides merged with DB baselines) ──────────
  const { data: exchangeRates } = useServiceArray(
    () => svc.costing.getExchangeRates(),
    [svc.orgId],
  );

  // ── Quote Profitability Checker State (§14) ─────────────────────────────
  const [quoteName, setQuoteName] = useState('');
  const [quoteClient, setQuoteClient] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('100000');
  const [estimatedHours, setEstimatedHours] = useState('120');
  const [directPurchasesAmt, setDirectPurchasesAmt] = useState('0');
  const [contingencyPct, setContingencyPct] = useState('0');
  const [targetMarginPct, setTargetMarginPct] = useState('25');
  const [selectedDept, setSelectedDept] = useState('');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [remoteQuoteCalc, setRemoteQuoteCalc] = useState<QuoteCalculationResult | null>(null);

  // Auto-select first department WITH a defined loaded costPerHour (fallback to first dept only if none have rates)
  useEffect(() => {
    if (billableDepartments.length > 0) {
      const hasCurrent = billableDepartments.some(d => d.id === selectedDept);
      if (!selectedDept || !hasCurrent) {
        const firstDefined = billableDepartments.find(d => d.costPerHour != null);
        setSelectedDept(firstDefined ? firstDefined.id : billableDepartments[0].id);
      }
    }
  }, [billableDepartments, selectedDept]);

  const selectedDeptObj = useMemo(
    () => billableDepartments.find(d => d.id === selectedDept) || null,
    [billableDepartments, selectedDept],
  );

  // Build canonical §14 Quote Input payload
  const quotePayload = useMemo(() => {
    if (!selectedDeptObj || selectedDeptObj.costPerHour == null) return null;
    const hours = parseFloat(estimatedHours);
    const revenue = parseFloat(quoteAmount);
    const purchases = Math.max(0, parseFloat(directPurchasesAmt) || 0);
    const contPct = Math.max(0, parseFloat(contingencyPct) || 0);
    const tMargin = parseFloat(targetMarginPct);

    if (!Number.isFinite(hours) || hours <= 0) return null;
    if (!Number.isFinite(revenue) || revenue < 0) return null;

    return {
      roleEstimates: [
        {
          id: 'dept-primary',
          roleName: selectedDeptObj.name,
          departmentId: selectedDeptObj.id,
          estimatedHours: hours,
          costRate: selectedDeptObj.costPerHour,
        },
      ],
      directPurchases: purchases > 0
        ? [{ id: 'dp-1', description: 'Direct external purchases', amount: purchases, currency }]
        : [],
      overheadAmount: 0, // Already embedded in dept's loaded costPerHour — zero double-counting (§12.1)
      contingencyPercent: contPct,
      proposedPrice: revenue,
      targetMarginPercent: Number.isFinite(tMargin) ? tMargin : 25,
      targetMarkupPercent: Number.isFinite(tMargin) && tMargin >= 0 && tMargin < 100
        ? Math.round(((tMargin / (100 - tMargin)) * 100) * 100) / 100
        : 33.33,
    };
  }, [selectedDeptObj, estimatedHours, quoteAmount, directPurchasesAmt, contingencyPct, targetMarginPct, currency]);

  // Immediate preview from service engine + authoritative reconciliation from backend POST /quotes/calculate
  const localQuoteCalc = useMemo(() => {
    if (!quotePayload) return null;
    return svc.costing.calculateQuote(quotePayload);
  }, [quotePayload, svc.costing]);

  useEffect(() => {
    if (!quotePayload || !svc.isReady) {
      setRemoteQuoteCalc(null);
      return;
    }
    const targetM = quotePayload.targetMarginPercent;
    if (!Number.isFinite(targetM) || targetM < 0 || targetM >= 100) {
      setRemoteQuoteCalc(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await svc.costing.calculateQuoteRemote(quotePayload);
        if (!cancelled && res.success && res.data) {
          setRemoteQuoteCalc(res.data);
        }
      } catch {
        /* local preview already matches server formula */
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quotePayload, svc]);

  const activeQuoteCalc = remoteQuoteCalc ?? localQuoteCalc;

  const handleSaveQuote = async () => {
    if (!quotePayload || !selectedDeptObj || !activeQuoteCalc) {
      toast.error('Select a department with a valid cost rate and enter valid quote parameters.');
      return;
    }
    if (!activeQuoteCalc.isTargetMarginValid) {
      toast.error('Target margin must be between 0% and 99.99%.');
      return;
    }
    const projectName = quoteName.trim() || `${selectedDeptObj.name} Quote (${estimatedHours}h)`;
    setQuoteSaving(true);
    try {
      const res = await svc.costing.saveQuote({
        id: editingQuoteId || undefined,
        departmentId: selectedDeptObj.id,
        clientName: quoteClient.trim() || 'Prospective Client',
        projectName,
        currency,
        overheadMethod: currentAllocationMethod,
        ...quotePayload,
        versionNotes: editingQuoteId ? 'Updated quote parameters' : 'Initial baseline quote',
      });
      if (res.success && res.data) {
        toast.success(editingQuoteId ? `Saved new quote version ${res.data.currentVersion}` : `Quote saved (${res.data.currentVersion})`);
        setEditingQuoteId(res.data.id);
        setQuoteName(res.data.projectName);
        await refetchQuotes();
      } else {
        toast.error(res.error || 'Failed to save quote');
      }
    } catch {
      toast.error('Failed to save quote');
    } finally {
      setQuoteSaving(false);
    }
  };

  const handleLoadQuote = (q: Quote) => {
    setEditingQuoteId(q.id);
    setQuoteName(q.projectName);
    setQuoteClient(q.clientName);
    setQuoteAmount(String(q.proposedPrice));
    const firstRole = q.roleEstimates?.[0];
    if (firstRole?.estimatedHours) setEstimatedHours(String(firstRole.estimatedHours));
    if (q.departmentId && billableDepartments.some(d => d.id === q.departmentId)) {
      setSelectedDept(q.departmentId);
    }
    const purchTotal = (q.directPurchases || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    setDirectPurchasesAmt(String(purchTotal));
    setContingencyPct(String(q.contingencyPercent || 0));
    setTargetMarginPct(String(q.targetMarginPercent ?? 25));
    toast.info(`Loaded quote "${q.projectName}" (${q.currentVersion})`);
  };

  const handleDeleteQuote = async (id: string) => {
    if (!confirm('Delete this saved quote and its version history?')) return;
    const res = await svc.costing.deleteQuote(id);
    if (res.success) {
      toast.success('Quote deleted');
      if (editingQuoteId === id) setEditingQuoteId(null);
      await refetchQuotes();
    } else {
      toast.error(res.error || 'Failed to delete quote');
    }
  };

  const handleExportQuoteCsv = (q: Quote) => {
    const rows = [
      ['Field', 'Value'],
      ['Quote ID', q.id],
      ['Version', q.currentVersion],
      ['Client', q.clientName],
      ['Project / Quote Name', q.projectName],
      ['Currency', q.currency],
      ['Estimated Direct Labor', q.estimatedDirectLabor.toFixed(2)],
      ['Direct Purchases', (q.directPurchasesTotal ?? 0).toFixed(2)],
      ['Contingency', `${q.contingencyAmount.toFixed(2)} (${q.contingencyPercent}%)`],
      ['Estimated Total Cost', q.estimatedTotalCost.toFixed(2)],
      ['Proposed Price', q.proposedPrice.toFixed(2)],
      ['Expected Profit', q.profitAmount.toFixed(2)],
      ['Margin %', q.marginPercent != null ? `${q.marginPercent.toFixed(2)}%` : 'Undefined'],
      ['Markup %', q.markupPercent != null ? `${q.markupPercent.toFixed(2)}%` : 'Undefined'],
      ['Target Margin %', `${q.targetMarginPercent}%`],
      ['Required Price for Target Margin', q.requiredPriceForTargetMargin != null ? q.requiredPriceForTargetMargin.toFixed(2) : 'Undefined'],
      ['Revenue Recognized', 'false (Non-posting Quote)'],
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${q.projectName.replace(/[^a-z0-9_-]+/gi, '_')}_${q.currentVersion}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Commission Calculator State ─────────────────────────────────────────
  const [selectedCommissionId, setSelectedCommissionId] = useState<string>('');
  const [dealAmount, setDealAmount] = useState('10000');
  const [customFxRate, setCustomFxRate] = useState<number | null>(null);

  useEffect(() => {
    if (commissions.length > 0 && !selectedCommissionId) {
      setSelectedCommissionId(commissions[0].id);
    }
  }, [commissions, selectedCommissionId]);

  const selectedCommission = useMemo(() => {
    return commissions.find(c => c.id === selectedCommissionId) || commissions[0] || null;
  }, [commissions, selectedCommissionId]);

  // Resolve FX Rate with explicit provenance (never mislabel manual or fallback rates as "Live")
  const fxResolution = useMemo((): { rate: number; sourceLabel: string } => {
    if (customFxRate != null) {
      return { rate: Math.max(0, customFxRate), sourceLabel: 'Manual Override' };
    }
    if (!selectedCommission) return { rate: 1, sourceLabel: 'Identity' };
    const from = selectedCommission.currency.toUpperCase();
    const to = currency.toUpperCase();
    if (from === to) return { rate: 1, sourceLabel: 'Same Currency' };

    const direct = exchangeRates.find(r => r.base.toUpperCase() === from && r.quote.toUpperCase() === to);
    if (direct && direct.rate > 0) {
      const label = direct.organizationId
        ? 'Org Override'
        : direct.source === 'system_baseline'
          ? 'Baseline'
          : 'DB Rate';
      return { rate: direct.rate, sourceLabel: label };
    }

    const inverse = exchangeRates.find(r => r.base.toUpperCase() === to && r.quote.toUpperCase() === from);
    if (inverse && inverse.rate > 0) {
      const label = inverse.organizationId ? 'Org Inverse' : 'DB Inverse';
      return { rate: Math.round((1 / inverse.rate) * 10000) / 10000, sourceLabel: label };
    }

    // Cross-convert via USD through available DB rates
    const fromToUsd = exchangeRates.find(r => r.base.toUpperCase() === from && r.quote.toUpperCase() === 'USD')?.rate
      ?? (() => {
        const inv = exchangeRates.find(r => r.base.toUpperCase() === 'USD' && r.quote.toUpperCase() === from)?.rate;
        return inv && inv > 0 ? 1 / inv : null;
      })();
    const usdToTarget = to === 'USD'
      ? 1
      : exchangeRates.find(r => r.base.toUpperCase() === 'USD' && r.quote.toUpperCase() === to)?.rate
        ?? (() => {
          const inv = exchangeRates.find(r => r.base.toUpperCase() === to && r.quote.toUpperCase() === 'USD')?.rate;
          return inv && inv > 0 ? 1 / inv : null;
        })();

    if (fromToUsd && usdToTarget) {
      return { rate: Math.round(fromToUsd * usdToTarget * 10000) / 10000, sourceLabel: 'Cross Rate' };
    }

    return { rate: 1, sourceLabel: 'Unconfigured (1.0)' };
  }, [customFxRate, selectedCommission, exchangeRates, currency]);

  const activeFxRate = fxResolution.rate;

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
  const [allocForm, setAllocForm] = useState<{
    name: string;
    amount: string;
    allocationBase: OverheadAllocationBase;
    isOperating: boolean;
    deptWeights: Record<string, string>;
  }>({
    name: '',
    amount: '30000',
    allocationBase: 'headcount',
    isOperating: true,
    deptWeights: {},
  });
  const [allocSubmitting, setAllocSubmitting] = useState(false);

  // Commission breakdown (multiplicative: Middleman % deducted from your gross share)
  const commissionBreakdown = useMemo(() => {
    if (!selectedCommission || !dealAmount) return null;
    const amount = parseFloat(dealAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const yourSplitPct = selectedCommission.yourProfitPercentage;
    const middlemanPct = selectedCommission.middlemanPercentage;
    const safeFx = Math.max(0, activeFxRate);

    const yourGrossShare = Math.round(((amount * yourSplitPct) / 100) * 100) / 100;
    const middlemanCut = Math.round(((yourGrossShare * middlemanPct) / 100) * 100) / 100;
    const yourNetShare = Math.round((yourGrossShare - middlemanCut) * 100) / 100;
    const inBaseCurrency = Math.round((yourNetShare * safeFx) * 100) / 100;

    return {
      dealAmount: amount,
      currency: selectedCommission.currency,
      yourSplitPct,
      middlemanPct,
      yourGrossShare,
      middlemanCut,
      yourNetShare,
      inBaseCurrency,
      effectiveMarginPct: amount > 0 ? (yourNetShare / amount) * 100 : null,
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

    // Multiplicative model: Net = Deal × (yourSplit/100) × (1 - middleman/100)
    // Both percentages are independently valid in [0%, 100%].
    if (!Number.isFinite(yourSplit) || yourSplit < 0 || yourSplit > 100) {
      toast.error('Your split percentage must be between 0% and 100%');
      return;
    }
    if (!Number.isFinite(middleman) || middleman < 0 || middleman > 100) {
      toast.error('Middleman cut must be between 0% and 100%');
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
    } catch {
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
  const handleApplyMethod = async (method: OverheadAllocationBase) => {
    try {
      const res = await svc.costing.setAllocationMethod(method);
      if (res.success) {
        toast.success(`Overhead allocation method updated to By ${method.replace(/_/g, ' ')}`);
        setShowMethodModal(false);
        await Promise.all([refetchAlloc(), refetchDept(), refetchProjects()]);
      } else {
        toast.error(res.error || 'Failed to update allocation method');
      }
    } catch {
      toast.error('Failed to update allocation method');
    }
  };

  const handleFreezeAllocationRun = async () => {
    setFreezingRun(true);
    try {
      const res = await svc.costing.freezeAllocationRun({ period: costingPeriod });
      if (res.success && res.data) {
        toast.success(`Frozen allocation snapshot (${res.data.periodStart} to ${res.data.periodEnd})`);
        await refetchRuns();
      } else {
        toast.error(res.error || 'Failed to freeze allocation run');
      }
    } catch {
      toast.error('Failed to freeze allocation run');
    } finally {
      setFreezingRun(false);
    }
  };

  const buildInitialDeptWeights = useCallback(
    (existing?: OverheadAllocation['departments']): Record<string, string> => {
      const map: Record<string, string> = {};
      const count = Math.max(1, billableDepartments.length);
      const defaultPct = (100 / count).toFixed(1);
      for (const d of billableDepartments) {
        const match = existing?.find(x => x.departmentId === d.id);
        map[d.id] = match != null ? String(match.percentage ?? match.weight ?? 0) : defaultPct;
      }
      return map;
    },
    [billableDepartments],
  );

  const openNewAllocModal = () => {
    setEditingAllocId(null);
    setAllocForm({
      name: '',
      amount: '35000',
      allocationBase: allocations[0]?.allocationBase || 'headcount',
      isOperating: true,
      deptWeights: buildInitialDeptWeights(),
    });
    setShowAllocModal(true);
  };

  const openEditAllocModal = (alloc: OverheadAllocation) => {
    setEditingAllocId(alloc.id);
    setAllocForm({
      name: alloc.name,
      amount: (alloc.amount || 0).toString(),
      allocationBase: alloc.allocationBase || 'headcount',
      isOperating: alloc.isOperating !== false,
      deptWeights: buildInitialDeptWeights(alloc.departments),
    });
    setShowAllocModal(true);
  };

  const needsDepartmentWeights =
    allocForm.allocationBase === 'manual_weight' ||
    allocForm.allocationBase === 'department_ratio' ||
    allocForm.allocationBase === 'custom';

  const customWeightsTotal = useMemo(() => {
    return Object.values(allocForm.deptWeights).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }, [allocForm.deptWeights]);

  const handleSaveAlloc = async () => {
    const name = allocForm.name.trim();
    if (!name) {
      toast.error('Allocation name is required');
      return;
    }
    const amt = parseFloat(allocForm.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error('Amount must be a non-negative number');
      return;
    }

    const departmentsPayload = needsDepartmentWeights
      ? billableDepartments.map(d => ({
          departmentId: d.id,
          percentage: Math.max(0, parseFloat(allocForm.deptWeights[d.id] || '0') || 0),
        }))
      : [];

    if (allocForm.allocationBase === 'custom' && departmentsPayload.length > 0 && Math.abs(customWeightsTotal - 100) > 0.05) {
      toast.error(`Custom department percentages must total 100% (currently ${customWeightsTotal.toFixed(1)}%)`);
      return;
    }

    setAllocSubmitting(true);
    try {
      if (editingAllocId) {
        const res = await svc.costing.updateOverheadAllocation(editingAllocId, {
          name,
          amount: amt,
          allocationBase: allocForm.allocationBase,
          isOperating: allocForm.isOperating,
          departments: departmentsPayload,
        });
        if (res.success) {
          toast.success('Overhead pool updated');
          setShowAllocModal(false);
          await Promise.all([refetchAlloc(), refetchDept(), refetchProjects()]);
        } else {
          toast.error(res.error || 'Failed to update allocation');
        }
      } else {
        const res = await svc.costing.createOverheadAllocation({
          name,
          amount: amt,
          allocationBase: allocForm.allocationBase,
          isOperating: allocForm.isOperating,
          accountIds: [],
          departments: departmentsPayload,
        });
        if (res.success) {
          toast.success('New overhead pool created');
          setShowAllocModal(false);
          await Promise.all([refetchAlloc(), refetchDept(), refetchProjects()]);
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
        await Promise.all([refetchAlloc(), refetchDept(), refetchProjects()]);
      } else {
        toast.error(res.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete overhead pool');
    }
  };

  const getMarginBadge = (margin: number | null) => {
    if (margin == null) {
      return {
        background: 'rgba(148, 163, 184, 0.15)',
        color: '#94a3b8',
        border: '1px solid rgba(148, 163, 184, 0.3)',
      };
    }
    if (margin > 30) return AXIOM.badges.success;
    if (margin > 20) return AXIOM.badges.info;
    if (margin > 0) return AXIOM.badges.warning;
    return AXIOM.badges.danger;
  };

  const operatingAllocations = useMemo(
    () => allocations.filter(a => a.isOperating !== false),
    [allocations],
  );

  const uniqueBases = useMemo(() => {
    const set = new Set(operatingAllocations.map(a => a.allocationBase || 'headcount'));
    return Array.from(set);
  }, [operatingAllocations]);

  const currentAllocationMethod: OverheadAllocationBase = (uniqueBases[0] as OverheadAllocationBase) || 'headcount';
  const activeDistributionLabel =
    uniqueBases.length === 0
      ? 'No active pools'
      : uniqueBases.length === 1
        ? `By ${uniqueBases[0].replace(/_/g, ' ')}`
        : `Mixed (${uniqueBases.map(b => b.replace(/_/g, ' ')).join(', ')})`;

  const totalMonthlyOperatingPools = useMemo(
    () => operatingAllocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0),
    [operatingAllocations],
  );

  const latestFrozenRun = allocationRuns[0] || null;

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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Department cost rates</h2>
            <p className="text-xs text-slate-400">
              Computed from direct costs + allocated operating overhead across fixed 160h/mo FTE capacity · Period:{' '}
              <span className="text-cyan-300 font-medium">{activePeriodLabel}</span> ({currency})
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-700/70 bg-slate-900/60 p-0.5 text-xs">
              {(
                [
                  { id: '1M', label: 'Current Month' },
                  { id: '3M', label: '3M' },
                  { id: '1Y', label: '1Y' },
                  { id: 'ALL', label: 'All Time' },
                ] as Array<{ id: CostingPeriodKey; label: string }>
              ).map(p => (
                <button
                  key={p.id}
                  onClick={() => setCostingPeriod(p.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    costingPeriod === p.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => Promise.all([refetchDept(), refetchAllDepts()])}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium px-3 py-1.5 rounded-lg border border-cyan-500/30 hover:border-cyan-500/50"
            >
              Refresh Rates
            </button>
          </div>
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
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={getMarginBadge(dept.margin)}>
                    {dept.margin != null ? `${dept.margin.toFixed(1)}% margin` : 'N/A margin'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Cost / Hour (Loaded)</p>
                    {dept.costPerHour != null ? (
                      <>
                        <p className="text-xl font-bold text-white">
                          {formatCurrency(dept.costPerHour, currency, DEC2)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {dept.costPerMinute != null ? `${formatCurrency(dept.costPerMinute, currency, DEC2)}/min` : ''}
                          {dept.directCostPerHour != null ? ` · Direct ${formatCurrency(dept.directCostPerHour, currency, DEC2)}/hr` : ''}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-semibold text-slate-400">Undefined</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {dept.headcount === 0 ? 'No active staff (0h)' : 'No costs recorded'}
                        </p>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Active Headcount</p>
                    <p className="text-xl font-bold text-white flex items-center gap-1.5">
                      <Users className="size-4 text-cyan-400" />
                      {dept.headcount}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {dept.headcount > 0 ? '160 hrs/mo per FTE' : 'Assign staff to compute rate'}
                    </p>
                  </div>
                </div>

                <div className="mb-4 p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/50 flex flex-wrap items-center justify-between gap-1.5 text-xs">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Clock className="size-3.5 text-slate-400" />
                    Capacity
                  </span>
                  <span className="text-slate-200 font-medium">
                    {dept.totalHours != null && dept.headcount > 0
                      ? dept.periodMonths > 1
                        ? `${dept.totalHours} hrs (${dept.headcount} × 160h × ${dept.periodMonths}mo)`
                        : `${dept.totalHours} hrs/mo (${dept.headcount} × 160h)`
                      : '0 hrs/mo (No staff)'}
                  </span>
                  <span className="text-slate-400">|</span>
                  <span className="text-slate-400">Scheduled Allocation:</span>
                  <span className="text-cyan-300 font-medium">
                    {dept.utilization != null
                      ? `${dept.billableHours}h (${dept.utilization}% utilized)`
                      : dept.billableHours > 0
                        ? `${dept.billableHours}h (N/A — no staff)`
                        : '0h allocated'}
                  </span>
                </div>

                {/* Department Budget Tracking */}
                <div className="mb-4 p-3 rounded-xl bg-slate-900/60 border border-slate-700/60">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">
                      Department Budget{dept.periodMonths > 1 ? ` (${dept.periodMonths}mo)` : ''}
                    </span>
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
                            (dept.budgetSpent ?? dept.directCosts) > dept.budget
                              ? 'bg-red-500'
                              : (dept.budgetSpent ?? dept.directCosts) > dept.budget * 0.8
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, dept.budget > 0 ? (((dept.budgetSpent ?? dept.directCosts) / dept.budget) * 100) : 0),
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className={(dept.budgetSpent ?? dept.directCosts) > dept.budget ? 'text-red-400 font-medium' : 'text-slate-400'}>
                          {formatCurrency(dept.budgetSpent ?? dept.directCosts, currency)} spent (
                          {dept.budget > 0 ? (((dept.budgetSpent ?? dept.directCosts) / dept.budget) * 100).toFixed(0) : '0'}%)
                        </span>
                        <span className={(dept.budgetSpent ?? dept.directCosts) > dept.budget ? 'text-red-400 font-semibold' : 'text-emerald-400 font-medium'}>
                          {(dept.budgetSpent ?? dept.directCosts) > dept.budget
                            ? `Exceeded by ${formatCurrency((dept.budgetSpent ?? dept.directCosts) - dept.budget, currency)}`
                            : `${formatCurrency(dept.budget - (dept.budgetSpent ?? dept.directCosts), currency)} remaining`}
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
                <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
                  <span>
                    Basis: {dept.capacityBasis}
                    {dept.laborCostSource && dept.laborCostSource !== 'none' ? ` · ${dept.laborCostSource}` : ''}
                  </span>
                  <span>{dept.policyVersion}</span>
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
              <p className="text-sm text-slate-400">Quoted vs actual margin (and operating margin on recognized revenue)</p>
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
                  <th className="py-2.5 pr-4 font-medium text-right">Scheduled Hours</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Quote / Op. Margin</th>
                  <th className="py-2.5 pr-4 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {projectProfit.map(p => {
                  const pCurr = (p as any).currency || currency;
                  const quoteMargin = p.quoteMarginPct ?? (p.quotedAmount > 0 ? Math.round(((p.quotedAmount - p.actualCost) / p.quotedAmount) * 1000) / 10 : null);
                  const opMargin = p.operatingMarginPct !== undefined ? p.operatingMarginPct : p.profitMargin;
                  const recognizedRev = Number(p.revenue ?? 0);
                  const schedHours = p.elapsedHours ?? p.loggedHours ?? 0;

                  return (
                    <tr key={p.projectId} className="border-b border-slate-800/80 text-slate-200 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 pr-4 font-medium text-white">{p.projectName}</td>
                      <td className="py-3.5 pr-4 text-slate-400">{p.clientName || 'Direct'}</td>
                      <td className="py-3.5 pr-4 text-right tabular-nums font-medium">
                        {formatCurrency(p.quotedAmount, pCurr)}
                      </td>
                      <td className="py-3.5 pr-4 text-right tabular-nums text-amber-300 font-medium">
                        {formatCurrency(p.actualCost, pCurr)}
                      </td>
                      <td className="py-3.5 pr-4 text-right tabular-nums">
                        <span className="font-semibold text-cyan-400 font-mono">
                          {schedHours.toFixed(1)} hrs
                        </span>
                        {p.contributorCount ? (
                          <span className="block text-[11px] text-slate-400">
                            {p.contributorCount} {p.contributorCount === 1 ? 'member' : 'members'}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3.5 pr-4 text-right tabular-nums">
                        <span
                          className={`font-bold ${
                            quoteMargin == null
                              ? 'text-slate-400'
                              : quoteMargin >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                          }`}
                        >
                          {quoteMargin != null ? `${quoteMargin.toFixed(1)}%` : 'N/A'}
                        </span>
                        <span
                          className={`block text-[11px] ${
                            opMargin == null
                              ? 'text-slate-500'
                              : opMargin >= 0
                                ? 'text-emerald-400/80'
                                : 'text-red-400/80'
                          }`}
                        >
                          Op: {opMargin != null ? `${opMargin.toFixed(1)}%` : 'N/A'} ({formatCurrency(recognizedRev, pCurr)} rev)
                        </span>
                      </td>
                      <td className="py-3.5 pr-4 text-center">
                        <span className="px-2 py-0.5 rounded text-xs capitalize bg-slate-800 text-slate-300 border border-slate-700">
                          {p.status || 'Active'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* ── 3. Quote Profitability Checker (§14 Backend-Backed) ─────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.chartBlue}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
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
                Simulate expected margin &amp; markup against loaded department cost rates before committing
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-400/30">
            Sandbox Quote · Not Recognized Revenue
          </span>
        </div>

        <div className="space-y-4 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-white font-medium mb-2 block text-sm">Quote Amount ({currency})</label>
              <input
                type="number"
                min="0"
                placeholder="100000"
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
                min="1"
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
                    {dept.name} ({dept.costPerHour != null ? `${formatCurrency(dept.costPerHour, currency, DEC2)}/hr` : 'Rate undefined'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* §14 Additional Costing Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-slate-300 font-medium mb-1.5 block text-xs">Direct Purchases ({currency})</label>
              <input
                type="number"
                min="0"
                value={directPurchasesAmt}
                onChange={e => setDirectPurchasesAmt(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium mb-1.5 block text-xs">Contingency (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={contingencyPct}
                onChange={e => setContingencyPct(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium mb-1.5 block text-xs">Target Margin (%)</label>
              <input
                type="number"
                min="0"
                max="99"
                value={targetMarginPct}
                onChange={e => setTargetMarginPct(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium mb-1.5 block text-xs">Quote / Project Name (to save)</label>
              <input
                type="text"
                placeholder="e.g. Mobile App Redesign"
                value={quoteName}
                onChange={e => setQuoteName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
          </div>

          {selectedDeptObj && selectedDeptObj.costPerHour == null && (
            <div
              className="p-4 rounded-xl flex items-start gap-3"
              style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)' }}
            >
              <AlertCircle className="size-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-200">
                <p className="font-semibold">Rate Undefined for {selectedDeptObj.name}</p>
                <p className="text-xs text-amber-300/80 mt-0.5">
                  This department has {selectedDeptObj.headcount === 0 ? '0 active staff (0h capacity)' : 'no recorded period costs'}.
                  Assign active staff or select another department to simulate quote profitability.
                </p>
              </div>
            </div>
          )}

          {activeQuoteCalc && selectedDeptObj && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 rounded-2xl"
              style={{
                background: activeQuoteCalc.meetsTargetMargin && !activeQuoteCalc.isBelowCost
                  ? 'rgba(16, 185, 129, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)',
                border: activeQuoteCalc.meetsTargetMargin && !activeQuoteCalc.isBelowCost
                  ? '2px solid rgba(16, 185, 129, 0.3)'
                  : '2px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div className="flex items-start gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: activeQuoteCalc.meetsTargetMargin && !activeQuoteCalc.isBelowCost ? AXIOM.iconBoxes.green : AXIOM.iconBoxes.red,
                      boxShadow: activeQuoteCalc.meetsTargetMargin && !activeQuoteCalc.isBelowCost ? AXIOM.shadows.iconGreen : AXIOM.shadows.iconRed,
                    }}
                  >
                    {activeQuoteCalc.meetsTargetMargin && !activeQuoteCalc.isBelowCost ? (
                      <TrendingUp className="size-6 text-white" />
                    ) : (
                      <AlertCircle className="size-6 text-white" />
                    )}
                  </div>
                  <div>
                    <h4
                      className={`text-xl font-bold mb-1 ${
                        activeQuoteCalc.meetsTargetMargin && !activeQuoteCalc.isBelowCost ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {activeQuoteCalc.isBelowCost
                        ? 'Sell-Below-Cost Warning (Approval Required)'
                        : activeQuoteCalc.meetsTargetMargin
                          ? 'Profitable Quote'
                          : 'Below Target Margin Warning'}
                    </h4>
                    <p className="text-sm text-slate-300">
                      {activeQuoteCalc.marginPercent != null
                        ? `Yields ${activeQuoteCalc.marginPercent.toFixed(1)}% margin (${activeQuoteCalc.markupPercent != null ? `${activeQuoteCalc.markupPercent.toFixed(1)}% markup` : 'N/A markup'}) using ${selectedDeptObj.name}'s loaded rate (${formatCurrency(selectedDeptObj.costPerHour || 0, currency, DEC2)}/hr).`
                        : 'Proposed price must be greater than 0 to compute margin.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Client name"
                    value={quoteClient}
                    onChange={e => setQuoteClient(e.target.value)}
                    className="px-3 py-2 rounded-xl text-white text-xs w-36"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                  <button
                    onClick={handleSaveQuote}
                    disabled={quoteSaving || !activeQuoteCalc.isTargetMarginValid}
                    className="px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5"
                    style={AXIOM.buttons.primary}
                  >
                    <Save className="size-3.5" />
                    {quoteSaving ? 'Saving…' : editingQuoteId ? 'Save New Version' : 'Save Quote'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Quote Price</p>
                  <p className="text-xl font-bold text-white">{formatCurrency(activeQuoteCalc.proposedPrice, currency, DEC2)}</p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Estimated Cost ({estimatedHours}h)</p>
                  <p className="text-xl font-bold text-amber-400">{formatCurrency(activeQuoteCalc.estimatedTotalCost, currency, DEC2)}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Labor {formatCurrency(activeQuoteCalc.estimatedDirectLabor, currency)}
                    {activeQuoteCalc.directPurchasesTotal > 0 ? ` + Purch ${formatCurrency(activeQuoteCalc.directPurchasesTotal, currency)}` : ''}
                    {activeQuoteCalc.contingencyAmount > 0 ? ` + Cont ${formatCurrency(activeQuoteCalc.contingencyAmount, currency)}` : ''}
                  </p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Expected Profit</p>
                  <p className={`text-xl font-bold ${activeQuoteCalc.profitAmount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(activeQuoteCalc.profitAmount, currency, DEC2)}
                  </p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Projected Margin</p>
                  <p className={`text-xl font-bold ${activeQuoteCalc.meetsTargetMargin ? 'text-emerald-400' : 'text-red-400'}`}>
                    {activeQuoteCalc.marginPercent != null ? `${activeQuoteCalc.marginPercent.toFixed(2)}%` : 'N/A'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Profit ÷ Price</p>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <p className="text-xs text-slate-400 mb-1">Projected Markup</p>
                  <p className="text-xl font-bold text-cyan-300">
                    {activeQuoteCalc.markupPercent != null ? `${activeQuoteCalc.markupPercent.toFixed(2)}%` : 'N/A'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Profit ÷ Cost</p>
                </div>
              </div>

              {!activeQuoteCalc.isTargetMarginValid && (
                <div
                  className="mt-4 p-3 rounded-xl"
                  style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)' }}
                >
                  <p className="text-sm text-red-300 font-medium">
                    Invalid target margin ({targetMarginPct}%). Target margin must be between 0% and 99.99%.
                  </p>
                </div>
              )}

              {activeQuoteCalc.isTargetMarginValid && !activeQuoteCalc.meetsTargetMargin && activeQuoteCalc.requiredPriceForTargetMargin != null && (
                <div
                  className="mt-4 p-3 rounded-xl"
                  style={{
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                >
                  <p className="text-sm text-amber-400 font-medium">
                    Recommendation: increase quote to at least{' '}
                    {formatCurrency(activeQuoteCalc.requiredPriceForTargetMargin, currency, DEC2)} to hit your{' '}
                    {targetMarginPct}% target margin.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Saved Versioned Quotes List (§14) */}
          {savedQuotes.length > 0 && (
            <div className="pt-4 border-t border-slate-700/40">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white">Saved Quote Versions ({savedQuotes.length})</h4>
                {editingQuoteId && (
                  <button
                    onClick={() => {
                      setEditingQuoteId(null);
                      setQuoteName('');
                      setQuoteClient('');
                    }}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    + Start New Quote
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {savedQuotes.map(q => (
                  <div
                    key={q.id}
                    className={`p-3.5 rounded-xl flex flex-col justify-between ${
                      editingQuoteId === q.id ? 'ring-2 ring-cyan-400' : ''
                    }`}
                    style={AXIOM.containers.item}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-white truncate">{q.projectName}</p>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-400/30">
                          {q.currentVersion}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">{q.clientName}</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-500 block text-[10px]">Proposed</span>
                          <span className="text-white font-semibold">{formatCurrency(q.proposedPrice, q.currency, DEC2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Margin / Markup</span>
                          <span className="text-emerald-400 font-semibold">
                            {q.marginPercent != null ? `${q.marginPercent.toFixed(1)}%` : 'N/A'} /{' '}
                            {q.markupPercent != null ? `${q.markupPercent.toFixed(1)}%` : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/40 flex items-center justify-between text-xs">
                      <button
                        onClick={() => handleLoadQuote(q)}
                        className="text-cyan-400 hover:text-cyan-300 font-medium"
                      >
                        Load / Revise
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleExportQuoteCsv(q)}
                          className="text-slate-400 hover:text-white"
                          title="Export Quote CSV"
                        >
                          <Download className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteQuote(q.id)}
                          className="text-slate-400 hover:text-red-400"
                          title="Delete Quote"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold text-white mb-1">Overhead Allocation Settings</h3>
            <p className="text-sm text-slate-400">
              Shared operating costs distributed across departments with cent-exact Hamilton-Hare conservation
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleFreezeAllocationRun}
              disabled={freezingRun || operatingAllocations.length === 0}
              className="px-3.5 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors"
              style={AXIOM.buttons.secondary}
              title="Record an immutable frozen allocation run snapshot (§12.7)"
            >
              <Lock className="size-3.5" /> {freezingRun ? 'Freezing…' : 'Freeze Snapshot'}
            </button>
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
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl" style={AXIOM.containers.item}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Layers className="size-5" />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Active Distribution Base</p>
                <p className="text-xs text-slate-400 capitalize">
                  Current: {activeDistributionLabel}
                  {allocations.length > operatingAllocations.length
                    ? ` · ${allocations.length - operatingAllocations.length} non-operating excluded`
                    : ''}
                </p>
                {latestFrozenRun && (
                  <p className="text-[11px] text-emerald-400/90 mt-0.5">
                    Last Frozen Run: {latestFrozenRun.periodStart} to {latestFrozenRun.periodEnd} (
                    {formatCurrency(latestFrozenRun.allocatedAmount, latestFrozenRun.currency, DEC2)} conserved)
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400">Total Monthly Operating Pools:</span>
              <p className="text-lg font-bold text-white">
                {formatCurrency(totalMonthlyOperatingPools, currency)}
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
                    Basis: {(alloc.allocationBase || 'headcount').replace(/_/g, ' ')}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-700/40 text-[11px] text-slate-400 flex justify-between">
                  <span>Monthly Pool</span>
                  <span className={alloc.isOperating !== false ? 'text-emerald-400' : 'text-amber-400'}>
                    {alloc.isOperating !== false ? 'Operating (Active)' : 'Non-Operating (Excluded)'}
                  </span>
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
              Calculate partner deal splits &amp; middleman cuts with tenant-scoped exchange rates
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
          {commError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>Failed to load commission structures: {commError}</span>
            </div>
          )}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-slate-400 mr-1">Partner:</span>
            {commissions.length === 0 && (
              <span className="text-xs text-slate-500">No saved partner commission structures yet. Add one to calculate deal splits.</span>
            )}
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
                      min="0"
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
                    Exchange Rate to {currency} ({fxResolution.sourceLabel}: {activeFxRate})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={activeFxRate}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      setCustomFxRate(Number.isFinite(val) ? Math.max(0, val) : 0);
                    }}
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
                  <p className="text-xs text-slate-500 mt-1">% deducted from your gross share</p>
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
                      Effective Return: {commissionBreakdown.effectiveMarginPct != null ? `${commissionBreakdown.effectiveMarginPct.toFixed(1)}%` : 'N/A'}
                    </span>
                  </h4>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">Total Deal Size</span>
                      <span className="text-white font-semibold">
                        {commissionBreakdown.currency} {commissionBreakdown.dealAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">
                        Your {commissionBreakdown.yourSplitPct}% Split
                      </span>
                      <span className="text-cyan-400 font-semibold">
                        {commissionBreakdown.currency} {commissionBreakdown.yourGrossShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">
                        Middleman Cut ({commissionBreakdown.middlemanPct}% of your share)
                      </span>
                      <span className="text-red-400 font-semibold">
                        -{commissionBreakdown.currency} {commissionBreakdown.middlemanCut.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="h-px my-2" style={{ background: 'rgba(148, 163, 184, 0.2)' }} />

                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium">Your Final Net Takehome</span>
                      <span className="text-emerald-400 font-bold text-lg">
                        {commissionBreakdown.currency} {commissionBreakdown.yourNetShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">
                        Equivalent in {currency} (@ {activeFxRate} · {fxResolution.sourceLabel})
                      </span>
                      <span className="text-emerald-300 font-bold text-lg">
                        {formatCurrency(commissionBreakdown.inBaseCurrency, currency, DEC2)}
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

      {/* ── Modal: Change Allocation Method (All 8 Org Drivers Supported) ──── */}
      <AnimatePresence>
        {showMethodModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md max-h-[85vh] overflow-y-auto p-6 rounded-2xl space-y-4"
              style={AXIOM.containers.modal}
            >
              <h3 className="text-xl font-bold text-white">Change Overhead Allocation Method</h3>
              <p className="text-xs text-slate-400">
                Applies the selected distribution driver across all organization overhead pools
              </p>

              <div className="space-y-2 pt-2">
                {(
                  [
                    { id: 'headcount', title: 'By Headcount', desc: 'Distribute proportionally to active FTE count in each department' },
                    { id: 'revenue', title: 'By Revenue', desc: 'Distribute proportionally to period revenue attributed to each department' },
                    { id: 'direct_cost', title: 'By Direct Costs', desc: 'Distribute proportionally to period direct costs of each department' },
                    { id: 'square_footage', title: 'By Square Footage', desc: 'Distribute proportionally to assigned office square footage' },
                    { id: 'time_utilization', title: 'By Time Utilization (Scheduled Hours)', desc: 'Distribute proportionally to scheduled 160h/mo project hours per department' },
                    { id: 'manual_weight', title: 'Manual Weight', desc: 'Distribute using normalized per-department manual weights' },
                    { id: 'department_ratio', title: 'Department Ratio', desc: 'Distribute using configured stable per-department ratios' },
                    { id: 'equal', title: 'Equal Split', desc: 'Divide overhead equally across all departments' },
                  ] as Array<{ id: OverheadAllocationBase; title: string; desc: string }>
                ).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => handleApplyMethod(opt.id)}
                    className="w-full text-left p-3.5 rounded-xl border border-slate-700/60 hover:border-cyan-500/50 hover:bg-slate-800/60 transition-all flex items-start gap-3"
                  >
                    <CheckCircle2
                      className={`size-5 mt-0.5 shrink-0 ${
                        uniqueBases.length === 1 && currentAllocationMethod === opt.id ? 'text-cyan-400' : 'text-slate-600'
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
              className="w-full max-w-md max-h-[85vh] overflow-y-auto p-6 rounded-2xl space-y-4"
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
                    min="0"
                    placeholder="35000"
                    value={allocForm.amount}
                    onChange={e => setAllocForm({ ...allocForm, amount: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">Allocation Basis</label>
                  <select
                    value={allocForm.allocationBase}
                    onChange={e => setAllocForm({ ...allocForm, allocationBase: e.target.value as OverheadAllocationBase })}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  >
                    <option value="headcount" className="bg-slate-900 text-white">By Headcount</option>
                    <option value="revenue" className="bg-slate-900 text-white">By Revenue</option>
                    <option value="direct_cost" className="bg-slate-900 text-white">By Direct Cost</option>
                    <option value="square_footage" className="bg-slate-900 text-white">By Square Footage</option>
                    <option value="time_utilization" className="bg-slate-900 text-white">By Time Utilization (Scheduled Hours)</option>
                    <option value="manual_weight" className="bg-slate-900 text-white">Manual Weight</option>
                    <option value="department_ratio" className="bg-slate-900 text-white">Department Ratio</option>
                    <option value="custom" className="bg-slate-900 text-white">Custom Percentage Split (100%)</option>
                    <option value="equal" className="bg-slate-900 text-white">Equal Split</option>
                  </select>
                </div>

                {needsDepartmentWeights && billableDepartments.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-700/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">
                        {allocForm.allocationBase === 'custom' ? 'Department Percentages (must sum to 100%)' : 'Department Weights (auto-normalized)'}
                      </span>
                      <span className={allocForm.allocationBase === 'custom' && Math.abs(customWeightsTotal - 100) > 0.05 ? 'text-red-400 font-semibold' : 'text-cyan-400'}>
                        Total: {customWeightsTotal.toFixed(1)}{allocForm.allocationBase === 'custom' ? '%' : ''}
                      </span>
                    </div>
                    {billableDepartments.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-300 truncate">{d.name}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={allocForm.deptWeights[d.id] ?? '0'}
                          onChange={e =>
                            setAllocForm({
                              ...allocForm,
                              deptWeights: { ...allocForm.deptWeights, [d.id]: e.target.value },
                            })
                          }
                          className="w-24 px-2.5 py-1.5 rounded-lg text-white text-xs text-right"
                          style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs text-slate-300 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allocForm.isOperating}
                    onChange={e => setAllocForm({ ...allocForm, isOperating: e.target.checked })}
                    className="rounded border-slate-600"
                  />
                  Operating overhead pool (uncheck to exclude non-operating/capital costs per §12.3)
                </label>
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
                Configure your gross deal split (0–100%) and middleman cut deducted from your share (0–100%).
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

                {Number.isFinite(parseFloat(commissionForm.yourProfitPercentage)) &&
                  Number.isFinite(parseFloat(commissionForm.middlemanPercentage)) && (
                    <p className="text-xs text-cyan-300/90">
                      Effective Net Return:{' '}
                      {(
                        Math.min(100, Math.max(0, parseFloat(commissionForm.yourProfitPercentage))) *
                        (1 - Math.min(100, Math.max(0, parseFloat(commissionForm.middlemanPercentage))) / 100)
                      ).toFixed(2)}
                      % of total deal value
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
