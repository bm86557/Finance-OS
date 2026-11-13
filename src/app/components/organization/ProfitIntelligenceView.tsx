import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
// ── Phase 9B: Real data integration with Profit Intelligence ─────────────────
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';
import type { DepartmentProfitability, SquareFootProfitability } from '@/services/types';
import { profitIntelligenceService } from '@/services/profitIntelligenceService';
import { overheadAllocationService } from '@/services/overheadAllocationService';

interface ProjectDetailsModalData {
  project?: {
    id: string;
    name: string;
    clientName?: string;
    status: string;
    quotedAmount?: number;
    budget?: number;
  };
  summary?: {
    totalRevenue: number;
    totalCosts: number;
    directCosts?: number;
    laborCost?: number;
    actualCost?: number;
    netProfit: number;
    marginPct?: number;
    margin?: number;
    variancePct: number;
    loggedHours?: number;
  };
  income?: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    category?: string;
    narration?: string;
  }>;
  expenses?: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    category?: string;
    narration?: string;
  }>;
  laborEntries?: Array<{
    id: string;
    userId: string;
    userName: string;
    date: string;
    hours: number;
    effectiveHourlyRate: number;
    cost: number;
    description?: string;
    billable?: boolean;
    status?: string;
  }>;
}

/** Maps service DepartmentProfitability → local rendering shape */
function mapDeptProfitability(dp: DepartmentProfitability): Department {
  return {
    id: dp.departmentId,
    name: dp.departmentName,
    costPerHour: dp.costPerHour ?? 0,
    teamMembers: dp.headcount,
    monthlyRevenue: dp.revenue,
    monthlyCost: dp.directCosts,
    monthlyProfit: dp.netProfit,
    profitMargin: dp.profitMargin ?? 0,
    overheadAllocation: dp.allocatedOverhead,
    billableHours: dp.billableHours,
    totalHours: dp.totalHours ?? 0,
    utilization: dp.utilization ?? 0,
  };
}

interface Department {
  id: string; name: string; costPerHour: number; teamMembers: number;
  monthlyRevenue: number; monthlyCost: number; monthlyProfit: number;
  profitMargin: number; overheadAllocation: number; billableHours: number;
  totalHours: number; utilization: number;
}
interface Project {
  id: string; name: string; client: string; department: string;
  quotedAmount: number; actualCost: number; actualProfit: number;
  profitMargin: number; status: 'quoted' | 'in-progress' | 'completed';
  hoursQuoted: number; hoursActual: number; startDate: string; endDate?: string;
}
interface OverheadExpense {
  id: string; category: string; amount: number;
  frequency: 'monthly' | 'yearly';
  allocationType: 'equal' | 'revenue-based' | 'headcount-based';
  departments: string[];
}

// Mock data removed - now using real data from services

import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Plus,
  Calculator,
  Building2,
  Briefcase,
  UserCircle,
  Layers,
  Zap,
  Home,
  Maximize2,
  BarChart3,
  PieChart as PieChartIcon,
  Clock,
  Edit2
} from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';

const COLORS = ['#a855f7', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6'];

export function ProfitIntelligenceView() {
  const { theme } = useTheme();
  const svc = useOrgServices();

  // ── Phase 9B: Real data from Profit Intelligence services ────────────────
  const { currentOrganization } = useAuth();
  const currency = currentOrganization?.currency ?? 'USD';

  const [period, setPeriod] = useState<'1M' | '3M' | '1Y' | 'ALL'>('ALL');  // Default to ALL to show all dates
  const [projectPeriod, setProjectPeriod] = useState<'1M' | '3M' | '12M'>('3M');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSpaceConfigOpen, setIsSpaceConfigOpen] = useState(false);
  const [spaceAllocInputs, setSpaceAllocInputs] = useState<Record<string, string>>({});
  const [isSavingSpace, setIsSavingSpace] = useState(false);

  // Calculate date range from period
  const dateRange = useMemo(() => {
    if (period === 'ALL') {
      // ALL: use very wide date range to capture all transactions (including future-dated ones)
      return { from: '2000-01-01', to: '2099-12-31' };
    }
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10);
    const daysBack = period === '1M' ? 30 : period === '3M' ? 90 : 365;
    const fromDateObj = new Date(now);
    fromDateObj.setDate(fromDateObj.getDate() - daysBack);
    return { from: fromDateObj.toISOString().slice(0, 10), to: toDate };
  }, [period]);

  // Department profitability with date range
  const {
    data: rawDeptProfit,
    loading: deptProfitLoading,
    error: deptProfitError,
    refetch: refetchDeptProfit,
  } = useService(
    () => svc.departments.getProfitability({ from: dateRange.from, to: dateRange.to }),
    [svc.orgId, dateRange]
  );
  const liveDepartments: Department[] = (rawDeptProfit || []).map(mapDeptProfitability);

  // Project profitability
  const {
    data: rawProjectProfit,
    loading: projectProfitLoading,
  } = useService(
    () => svc.projects.getProfitability({ period: projectPeriod }),
    [svc.orgId, projectPeriod]
  );

  // Client profitability
  const {
    data: clientRows,
    loading: clientLoading,
  } = useService(
    () => svc.profitIntelligence.getClientProfitability({ from: dateRange.from, to: dateRange.to }),
    [svc.orgId, dateRange]
  );

  // Overhead summary
  const {
    data: overheadData,
    loading: overheadLoading,
  } = useService(
    () => svc.profitIntelligence.getOverheadSummary(),
    [svc.orgId]
  );

  // Business vs Personal
  const {
    data: businessPersonalData,
    loading: bvpLoading,
  } = useService(
    () => svc.profitIntelligence.getBusinessVsPersonal({ from: dateRange.from, to: dateRange.to }),
    [svc.orgId, dateRange]
  );

  // Simulator scenarios
  const {
    data: whatIfScenarios,
    loading: scenariosLoading,
  } = useService(
    () => svc.simulator.getAllScenarios(),
    [svc.orgId]
  );

  // Project details (for modal)
  const {
    data: projectDetails,
    loading: projectDetailsLoading,
  } = useService<ProjectDetailsModalData | null>(
    () => selectedProjectId
      ? svc.projects.getProjectDetails(selectedProjectId)
      : Promise.resolve({ success: true, data: null as any }),
    [selectedProjectId, svc.orgId]
  );

  // Organization-level summary (includes ALL transactions, even unassigned)
  const {
    data: orgSummary,
    loading: summaryLoading,
  } = useService(
    () => svc.profitIntelligence.getSummary({ from: dateRange.from, to: dateRange.to }),
    [svc.orgId, dateRange]
  );

  // Space profitability and floor efficiency metrics (§12.5)
  const {
    data: spaceMetrics = [],
    refetch: refetchSpaceMetrics,
  } = useService(
    () => profitIntelligenceService.getSpaceProfitability(svc.orgId, { from: dateRange.from, to: dateRange.to }),
    [svc.orgId, dateRange]
  );

  const openSpaceConfigModal = () => {
    const initial: Record<string, string> = {};
    (spaceMetrics || []).forEach((sm) => {
      initial[sm.departmentId] = sm.squareFootage > 0 ? String(sm.squareFootage) : '';
    });
    setSpaceAllocInputs(initial);
    setIsSpaceConfigOpen(true);
  };

  const handleSaveSpaceAllocations = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!svc.orgId) return;
    setIsSavingSpace(true);
    try {
      const allocations = Object.entries(spaceAllocInputs).map(([deptId, sqftStr]) => ({
        departmentId: deptId,
        squareFootage: sqftStr ? Math.max(0, Number(sqftStr)) : 0,
      }));
      const res = await profitIntelligenceService.updateSpaceAllocations(svc.orgId, allocations);
      if (res.success) {
        toast.success('Department space allocations updated successfully');
        setIsSpaceConfigOpen(false);
        await Promise.all([refetchSpaceMetrics(), refetchDeptProfit?.()]);
      } else {
        toast.error(res.error || 'Failed to update space allocations');
      }
    } catch {
      toast.error('An error occurred while saving space allocations');
    } finally {
      setIsSavingSpace(false);
    }
  };

  const hasLiveDeptData = liveDepartments.length > 0;

  const liveOverall = useMemo(() => {
    // Prioritize organization summary (includes ALL transactions)
    if (orgSummary) {
      const rawRev = orgSummary.totalRevenue ?? (orgSummary as any).revenue ?? 0;
      const rawExp = orgSummary.totalExpense ?? (orgSummary as any).expenses ?? 0;
      const rawOverhead = orgSummary.totalOverhead ?? (orgSummary as any).overhead ?? 0;
      const totalRevenue = Number(rawRev || 0);
      const totalExpense = Number(rawExp || 0);
      const totalOverhead = Number(rawOverhead || 0);
      const totalDirectCost = Number(orgSummary.totalDirectCost ?? (orgSummary as any).direct_cost ?? Math.max(0, totalExpense - totalOverhead));
      const grossProfit = Number(orgSummary.grossProfit ?? (orgSummary as any).gross_profit ?? (totalRevenue - totalDirectCost));
      const netProfit = Number(orgSummary.netProfit ?? (orgSummary as any).net_profit ?? (totalRevenue - totalExpense));
      const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
      const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      return {
        totalRevenue,
        totalDirectCost,
        totalOverhead,
        grossProfit,
        netProfit,
        grossMargin,
        netMargin,
      };
    }
    // Fallback: sum from departments (only shows assigned transactions)
    if (liveDepartments.length === 0) return null;
    let tr = 0;
    let td = 0;
    let to = 0;
    let tn = 0;
    for (const d of liveDepartments) {
      tr += d.monthlyRevenue;
      td += d.monthlyCost;
      to += d.overheadAllocation;
      tn += d.monthlyProfit;
    }
    const grossProfit = tr - td;
    const grossMargin = tr > 0 ? (grossProfit / tr) * 100 : 0;
    const netMargin = tr > 0 ? (tn / tr) * 100 : 0;
    return {
      totalRevenue: tr,
      totalDirectCost: td,
      totalOverhead: to,
      grossProfit,
      netProfit: tn,
      grossMargin,
      netMargin,
    };
  }, [orgSummary, liveDepartments]);

  const displayOverall = liveOverall ?? {
    totalRevenue: 0,
    totalDirectCost: 0,
    totalOverhead: 0,
    grossProfit: 0,
    netProfit: 0,
    grossMargin: 0,
    netMargin: 0,
  };

  const overheadSharePct = useMemo(() => {
    const rev = displayOverall.totalRevenue;
    return rev > 0 ? (displayOverall.totalOverhead / rev) * 100 : 0;
  }, [displayOverall.totalRevenue, displayOverall.totalOverhead]);

  const deptBreakdownRows = useMemo(() => {
    if (!liveDepartments || liveDepartments.length === 0) return [];
    return liveDepartments.map((d: Department) => ({
      department: d.name,
      revenue: d.monthlyRevenue,
      directCost: d.monthlyCost,
      allocatedOverhead: d.overheadAllocation,
      netProfit: d.monthlyProfit,
      profitMargin: d.profitMargin,
    }));
  }, [liveDepartments]);

  const hasDeptBreakdown = deptBreakdownRows.length > 0;
  const hasClientRows = (clientRows || []).length > 0;

  const totalSpaceSqft = useMemo(() => {
    return (spaceMetrics || []).reduce((sum, s) => sum + Number(s.squareFootage || 0), 0);
  }, [spaceMetrics]);

  const avgRevPerSqft = useMemo(() => {
    const totRev = (spaceMetrics || []).reduce((sum, s) => sum + Number(s.revenue || 0), 0);
    return totalSpaceSqft > 0 ? totRev / totalSpaceSqft : 0;
  }, [spaceMetrics, totalSpaceSqft]);

  const avgCostPerSqft = useMemo(() => {
    const totCost = (spaceMetrics || []).reduce((sum, s) => sum + Number(s.cost || 0), 0);
    return totalSpaceSqft > 0 ? totCost / totalSpaceSqft : 0;
  }, [spaceMetrics, totalSpaceSqft]);

  const periodLabel = !hasLiveDeptData
    ? 'Sample data'
    : period === '1M'
      ? 'This month'
      : period === '3M'
        ? 'Last 3 months (monthly × 3)'
        : period === '1Y'
          ? 'Last 12 months (monthly × 12)'
          : 'All Time (all transactions)';

  return (
    <div 
      className="min-h-screen p-8" 
      style={{ 
        background: theme === 'dark' ? AXIOM.backgrounds.main : '#f8fafc',
      }}
    >
      {/* Ambient gradient orbs - ONLY IN DARK MODE */}
      {theme === 'dark' && (
        <>
          <div className="fixed top-20 left-20 w-96 h-96 bg-gradient-to-br from-indigo-600/10 to-purple-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
          <div className="fixed bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-cyan-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-violet-600/5 to-fuchsia-600/5 rounded-full blur-[140px] animate-pulse pointer-events-none" style={{ animationDelay: '0.5s' }} />
        </>
      )}

      {/* Header with AXIOM Icon Box */}
      <motion.div {...AXIOM.animations.fadeInTop} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div 
            className="p-3 rounded-xl flex items-center justify-center"
            style={{
              background: AXIOM.iconBoxes.purple,
              boxShadow: AXIOM.shadows.iconPurple,
            }}
          >
            <Target className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
              Profit Intelligence
            </h1>
          </div>
        </div>
        <p className="text-slate-400 text-sm ml-[60px]">Agency-Specific Profitability Analysis • Real-time Metrics</p>
        <div className="mt-4 ml-0 sm:ml-[60px] flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Period</span>
            {(['1M', '3M', '1Y', 'ALL'] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={!hasLiveDeptData && p !== 'ALL'}
                title={
                  p === 'ALL'
                    ? 'Show all transactions (including future-dated)'
                    : hasLiveDeptData
                    ? 'Scale monthly department figures by this range (totals and department charts).'
                    : 'Available when your org has at least one department with profitability data.'
                }
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors min-h-9 touch-manipulation ${
                  (!hasLiveDeptData && p !== 'ALL')
                    ? 'cursor-not-allowed opacity-45 bg-slate-800/30 text-slate-500'
                    : period === p
                      ? 'bg-purple-500/30 text-white ring-1 ring-purple-400/40'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {p === '1M' ? '1 month' : p === '3M' ? '3 months' : p === '1Y' ? '1 year' : 'All Time'}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 max-w-xl">
            Totals and department metrics reflect transactions and overhead allocations within the selected period.
          </p>
        </div>
        {deptProfitLoading && (
          <p className="mt-2 text-xs text-slate-500 font-mono" aria-live="polite">
            Loading department metrics…
          </p>
        )}
        {deptProfitError && (
          <p className="mt-2 text-xs text-amber-200/90 font-mono" role="alert">
            {deptProfitError} — department list and charts may be incomplete.
          </p>
        )}
      </motion.div>

      {/* Overall Metrics - Dashboard Style with Dark Cards + Colored Top Borders */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="group relative"
        >
          <div 
            className="relative overflow-hidden rounded-2xl p-6 border transition-all duration-300"
            style={{
              background: theme === 'dark' 
                ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
              border: theme === 'dark' ? AXIOM.borders.cyan : '1px solid rgba(6, 182, 212, 0.3)',
              boxShadow: theme === 'dark' 
                ? '0 4px 24px -4px rgba(59, 130, 246, 0.3), 0 0 48px -12px rgba(6, 182, 212, 0.2)'
                : '0 4px 12px -2px rgba(59, 130, 246, 0.1)',
            }}
          >
            <div 
              className="absolute top-0 left-0 right-0 h-[2px] opacity-60"
              style={{
                background: 'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(59, 130, 246))',
              }}
            />
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div 
                  className="p-2.5 rounded-xl border shadow-lg"
                  style={{
                    background: theme === 'dark'
                      ? 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.2), rgba(6, 182, 212, 0.2))'
                      : 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.1), rgba(6, 182, 212, 0.1))',
                    borderColor: theme === 'dark' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)',
                    boxShadow: theme === 'dark' ? '0 4px 12px rgba(59, 130, 246, 0.2)' : '0 2px 8px rgba(59, 130, 246, 0.1)',
                  }}
                >
                  <DollarSign className="w-5 h-5" style={{ color: theme === 'dark' ? 'rgb(147, 197, 253)' : 'rgb(59, 130, 246)' }} />
                </div>
              </div>
              <p className="text-sm font-medium mb-2" style={{ color: theme === 'dark' ? '#cbd5e1' : '#475569' }}>Total Revenue</p>
              <p 
                className="text-3xl font-bold"
                style={{
                  background: theme === 'dark'
                    ? 'linear-gradient(to right, #ffffff, rgb(147, 197, 253), rgb(103, 232, 249))'
                    : 'linear-gradient(to right, #1e293b, rgb(59, 130, 246), rgb(6, 182, 212))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {currency} {Math.round(displayOverall.totalRevenue / 1000)}K
              </p>
              <p className="text-xs mt-1" style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}>{periodLabel}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="group relative"
        >
          <div 
            className="relative overflow-hidden rounded-2xl p-6 border transition-all duration-300"
            style={{
              background: theme === 'dark' 
                ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
              border: theme === 'dark' ? AXIOM.borders.green : '1px solid rgba(16, 185, 129, 0.3)',
              boxShadow: theme === 'dark' 
                ? '0 4px 24px -4px rgba(16, 185, 129, 0.3), 0 0 48px -12px rgba(52, 211, 153, 0.2)'
                : '0 4px 12px -2px rgba(16, 185, 129, 0.1)',
            }}
          >
            <div 
              className="absolute top-0 left-0 right-0 h-[2px] opacity-60"
              style={{
                background: 'linear-gradient(to right, rgb(16, 185, 129), rgb(5, 150, 105), rgb(16, 185, 129))',
              }}
            />
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div 
                  className="p-2.5 rounded-xl border shadow-lg"
                  style={{
                    background: theme === 'dark'
                      ? 'linear-gradient(to bottom right, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2))'
                      : 'linear-gradient(to bottom right, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1))',
                    borderColor: theme === 'dark' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.2)',
                    boxShadow: theme === 'dark' ? '0 4px 12px rgba(16, 185, 129, 0.2)' : '0 2px 8px rgba(16, 185, 129, 0.1)',
                  }}
                >
                  <TrendingUp className="w-5 h-5" style={{ color: theme === 'dark' ? 'rgb(52, 211, 153)' : 'rgb(16, 185, 129)' }} />
                </div>
              </div>
              <p className="text-sm font-medium mb-2" style={{ color: theme === 'dark' ? '#cbd5e1' : '#475569' }}>Gross Profit</p>
              <p 
                className="text-3xl font-bold"
                style={{
                  background: theme === 'dark'
                    ? 'linear-gradient(to right, #ffffff, rgb(52, 211, 153), rgb(16, 185, 129))'
                    : 'linear-gradient(to right, #1e293b, rgb(52, 211, 153), rgb(16, 185, 129))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {currency} {Math.round(displayOverall.grossProfit / 1000)}K
              </p>
              <p className="text-xs mt-1" style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}>
                Margin: {displayOverall.grossMargin.toFixed(1)}% · {periodLabel}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="group relative"
        >
          <div 
            className="relative overflow-hidden rounded-2xl p-6 border transition-all duration-300"
            style={{
              background: theme === 'dark' 
                ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
              border: theme === 'dark' ? AXIOM.borders.purple : '1px solid rgba(168, 85, 247, 0.3)',
              boxShadow: theme === 'dark' 
                ? '0 4px 24px -4px rgba(168, 85, 247, 0.3), 0 0 48px -12px rgba(139, 92, 246, 0.2)'
                : '0 4px 12px -2px rgba(168, 85, 247, 0.1)',
            }}
          >
            <div 
              className="absolute top-0 left-0 right-0 h-[2px] opacity-60"
              style={{
                background: 'linear-gradient(to right, rgb(168, 85, 247), rgb(139, 92, 246), rgb(168, 85, 247))',
              }}
            />
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div 
                  className="p-2.5 rounded-xl border shadow-lg"
                  style={{
                    background: theme === 'dark'
                      ? 'linear-gradient(to bottom right, rgba(168, 85, 247, 0.2), rgba(139, 92, 246, 0.2))'
                      : 'linear-gradient(to bottom right, rgba(168, 85, 247, 0.1), rgba(139, 92, 246, 0.1))',
                    borderColor: theme === 'dark' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(168, 85, 247, 0.2)',
                    boxShadow: theme === 'dark' ? '0 4px 12px rgba(168, 85, 247, 0.2)' : '0 2px 8px rgba(168, 85, 247, 0.1)',
                  }}
                >
                  <Target className="w-5 h-5" style={{ color: theme === 'dark' ? 'rgb(216, 180, 254)' : 'rgb(168, 85, 247)' }} />
                </div>
              </div>
              <p className="text-sm font-medium mb-2" style={{ color: theme === 'dark' ? '#cbd5e1' : '#475569' }}>Operating Profit</p>
              <p 
                className="text-3xl font-bold"
                style={{
                  background: theme === 'dark'
                    ? 'linear-gradient(to right, #ffffff, rgb(216, 180, 254), rgb(168, 85, 247))'
                    : 'linear-gradient(to right, #1e293b, rgb(216, 180, 254), rgb(168, 85, 247))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {currency} {Math.round(displayOverall.netProfit / 1000)}K
              </p>
              <p className="text-xs mt-1" style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}>
                Margin: {displayOverall.netMargin.toFixed(1)}% · {periodLabel}
                {orgSummary?.profitVelocity && (
                  <span className="ml-2 font-medium" style={{ color: 'rgb(216, 180, 254)' }}>
                    · Velocity: {currency}{orgSummary.profitVelocity.velocityAmount.toFixed(0)}/day
                  </span>
                )}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="group relative"
        >
          <div 
            className="relative overflow-hidden rounded-2xl p-6 border transition-all duration-300"
            style={{
              background: theme === 'dark' 
                ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
              border: theme === 'dark' ? AXIOM.borders.amber : '1px solid rgba(245, 158, 11, 0.3)',
              boxShadow: theme === 'dark' 
                ? '0 4px 24px -4px rgba(245, 158, 11, 0.3), 0 0 48px -12px rgba(251, 146, 60, 0.2)'
                : '0 4px 12px -2px rgba(245, 158, 11, 0.1)',
            }}
          >
            <div 
              className="absolute top-0 left-0 right-0 h-[2px] opacity-60"
              style={{
                background: 'linear-gradient(to right, rgb(245, 158, 11), rgb(251, 146, 60), rgb(245, 158, 11))',
              }}
            />
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div 
                  className="p-2.5 rounded-xl border shadow-lg"
                  style={{
                    background: theme === 'dark'
                      ? 'linear-gradient(to bottom right, rgba(245, 158, 11, 0.2), rgba(251, 146, 60, 0.2))'
                      : 'linear-gradient(to bottom right, rgba(245, 158, 11, 0.1), rgba(251, 146, 60, 0.1))',
                    borderColor: theme === 'dark' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.2)',
                    boxShadow: theme === 'dark' ? '0 4px 12px rgba(245, 158, 11, 0.2)' : '0 2px 8px rgba(245, 158, 11, 0.1)',
                  }}
                >
                  <Calculator className="w-5 h-5" style={{ color: theme === 'dark' ? 'rgb(253, 186, 116)' : 'rgb(245, 158, 11)' }} />
                </div>
              </div>
              <p className="text-sm font-medium mb-2" style={{ color: theme === 'dark' ? '#cbd5e1' : '#475569' }}>Total Overhead</p>
              <p 
                className="text-3xl font-bold"
                style={{
                  background: theme === 'dark'
                    ? 'linear-gradient(to right, #ffffff, rgb(253, 186, 116), rgb(245, 158, 11))'
                    : 'linear-gradient(to right, #1e293b, rgb(253, 186, 116), rgb(245, 158, 11))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {currency} {Math.round(displayOverall.totalOverhead / 1000)}K
              </p>
              <p className="text-xs mt-1" style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}>
                {overheadSharePct.toFixed(1)}% of revenue · {periodLabel}
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Main Tabs - Dashboard Style */}
      <Tabs defaultValue="departments" className="space-y-6">
        <TabsList className="bg-slate-900/50 border border-slate-800/50 backdrop-blur-sm p-1">
          <TabsTrigger value="departments" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <Building2 className="size-4 mr-2" />
            Departments
          </TabsTrigger>
          <TabsTrigger value="projects" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <Briefcase className="size-4 mr-2" />
            Projects
          </TabsTrigger>
          <TabsTrigger value="clients" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <UserCircle className="size-4 mr-2" />
            Clients
          </TabsTrigger>
          <TabsTrigger value="overhead" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <Layers className="size-4 mr-2" />
            Overhead
          </TabsTrigger>
          <TabsTrigger value="whatif" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <Zap className="size-4 mr-2" />
            What If
          </TabsTrigger>
          <TabsTrigger value="bvp" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <Home className="size-4 mr-2" />
            Business vs Personal
          </TabsTrigger>
          <TabsTrigger value="sqft" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-white">
            <Maximize2 className="size-4 mr-2" />
            Per Sq Ft
          </TabsTrigger>
        </TabsList>

        {/* Departments Tab */}
        <TabsContent value="departments" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Department Profit Chart - Dashboard Style with Purple Gradient Background */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-8 rounded-3xl relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                boxShadow: '0 20px 60px -20px rgba(168, 85, 247, 0.5)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.3), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
                    style={{ boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)' }}
                  >
                    <BarChart3 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Department Profitability</h2>
                    <p className="text-slate-400 text-sm">
                      Revenue, Cost & Net Profit
                      {hasLiveDeptData ? ' · from your org, scaled by period' : ''}
                    </p>
                  </div>
                </div>

                {hasDeptBreakdown ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={deptBreakdownRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.08)" vertical={false} />
                      <XAxis
                        dataKey="department"
                        stroke="rgba(148, 163, 184, 0.5)"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="rgba(148, 163, 184, 0.5)"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.98)',
                          border: '1px solid rgba(168, 85, 247, 0.3)',
                          backdropFilter: 'blur(20px)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
                        }}
                        labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '8px', fontSize: '13px' }}
                        itemStyle={{ color: '#94a3b8', fontSize: '12px' }}
                      />
                      <Legend />
                      <Bar dataKey="revenue" fill="#a855f7" name="Revenue" />
                      <Bar dataKey="directCost" fill="#f59e0b" name="Direct Cost" />
                      <Bar dataKey="netProfit" fill="#10b981" name="Net Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-slate-400 text-sm py-12 text-center">No department breakdown for this period.</p>
                )}
              </div>
            </motion.div>

            {/* Profit Margin Distribution - Dashboard Style */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="p-8 rounded-3xl relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
                border: '1px solid rgba(236, 72, 153, 0.2)',
                boxShadow: '0 20px 60px -20px rgba(236, 72, 153, 0.5)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.3), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center"
                    style={{ boxShadow: '0 10px 30px -10px rgba(236, 72, 153, 0.6)' }}
                  >
                    <PieChartIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Profit Margin by Department</h2>
                    <p className="text-slate-400 text-sm">
                      After overhead allocation
                      {hasLiveDeptData ? ' · from your org' : ''}
                    </p>
                  </div>
                </div>

                {hasDeptBreakdown ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={deptBreakdownRows}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry: { department?: string; profitMargin?: number }) =>
                          `${entry.department ?? '—'}: ${(entry.profitMargin ?? 0).toFixed(1)}%`
                        }
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="netProfit"
                      >
                        {deptBreakdownRows.map((entry: any, index: number) => (
                          <Cell key={`cell-${entry.department}-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.98)',
                          border: '1px solid rgba(236, 72, 153, 0.3)',
                          backdropFilter: 'blur(20px)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-slate-400 text-sm py-12 text-center">No margin data for this period.</p>
                )}
              </div>
            </motion.div>
          </div>

          {/* Department Details Table - Dashboard Style */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="p-8 rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
              border: '1px solid rgba(148, 163, 184, 0.1)',
              boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div 
                className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"
                style={{ boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)' }}
              >
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Department Details</h2>
                <p className="text-slate-400 text-sm">Cost per hour, utilization & profitability</p>
              </div>
            </div>

            <div className="space-y-4">
              {liveDepartments.length === 0 && (
                <p className="text-slate-400 text-sm py-6 text-center border border-dashed border-slate-600/50 rounded-2xl">
                  No department profitability rows yet. Add departments and post transactions tagged to a department — charts
                  above stay empty until then (top KPIs may show sample figures).
                </p>
              )}
              {liveDepartments.map((dept, idx) => (
                <motion.div
                  key={dept.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + idx * 0.1 }}
                  className="p-5 rounded-2xl"
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-white">{dept.name}</h3>
                      <p className="text-sm text-slate-400">👥 {dept.teamMembers} members · ⚡ {dept.utilization.toFixed(1)}% utilization</p>
                    </div>
                    <div className={`px-3 py-1 rounded-lg text-xs font-medium ${
                      (dept.profitMargin || 0) >= 15 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' 
                        : (dept.profitMargin || 0) >= 10 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30' 
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {(dept.profitMargin || 0).toFixed(1)}% margin
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Cost/Hour</p>
                      <p className="font-bold text-white">{currency} {(dept.costPerHour || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Revenue</p>
                      <p className="font-bold text-green-400">{currency} {((dept.monthlyRevenue || 0) / 1000).toFixed(0)}K</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Direct Cost</p>
                      <p className="font-bold text-orange-400">{currency} {((dept.monthlyCost || 0) / 1000).toFixed(0)}K</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Overhead</p>
                      <p className="font-bold text-purple-400">{currency} {((dept.overheadAllocation || 0) / 1000).toFixed(0)}K</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Net Profit</p>
                      <p className="font-bold text-cyan-400">{currency} {((dept.monthlyProfit || 0) / 1000).toFixed(0)}K</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Billable Hours: {dept.billableHours || 0} / {dept.totalHours || 0}</span>
                      <span>Avg Rate: {currency} {(dept.billableHours || 0) > 0 ? Math.round((dept.monthlyRevenue || 0) / (dept.billableHours || 1)) : 0}/hr</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        {/* Projects Tab */}
        <TabsContent value="projects" className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-8 rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
              border: '1px solid rgba(148, 163, 184, 0.1)',
              boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
                  style={{ boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)' }}
                >
                  <Briefcase className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Project Profitability</h2>
                  <p className="text-slate-400 text-sm">Direct expense & timesheet labor burn analysis</p>
                </div>
              </div>
              
              {/* Period filter buttons */}
              <div className="flex gap-2">
                {(['1M', '3M', '12M'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setProjectPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      projectPeriod === p 
                        ? 'bg-purple-600 text-white shadow-lg' 
                        : 'bg-white/10 text-gray-400 hover:bg-white/20'
                    }`}
                  >
                    {p === '1M' ? 'Last Month' : p === '3M' ? 'Last 3 Months' : 'Last Year'}
                  </button>
                ))}
              </div>
            </div>

            {projectProfitLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-slate-400">Loading project data...</div>
              </div>
            ) : !rawProjectProfit || rawProjectProfit.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Briefcase className="w-12 h-12 text-slate-600 mb-4" />
                <p className="text-slate-400 text-center">No project data yet</p>
                <p className="text-slate-500 text-sm text-center mt-2">
                  Create projects and tag transactions to see profitability analysis
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {rawProjectProfit.map((profitData, idx) => {
                  // Map API response to local rendering shape
                  const project = {
                    id: profitData.projectId,
                    name: profitData.projectName,
                    client: profitData.clientName,
                    quotedAmount: profitData.quotedAmount,
                    actualCost: profitData.actualCost,
                    directCost: profitData.directCost ?? 0,
                    laborCost: profitData.laborCost ?? 0,
                    actualProfit: profitData.profit,
                    profitMargin: profitData.profitMargin,
                    status: profitData.status === 'active' ? 'in-progress' as const : profitData.status as 'quoted' | 'in-progress' | 'completed',
                    budgetVariance: profitData.budgetVariance,
                    revenue: profitData.revenue || 0,
                    loggedHours: profitData.loggedHours || 0,
                    contributorCount: profitData.contributorCount || 0,
                  };

                  return (
                    <motion.div
                      key={project.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + idx * 0.05 }}
                      className="p-5 rounded-2xl"
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(148, 163, 184, 0.1)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-bold text-white">{project.name}</h3>
                          <p className="text-sm text-slate-400">{project.client}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className={`px-3 py-1 rounded-lg text-xs font-medium ${
                            project.status === 'completed' 
                              ? 'bg-green-500/20 text-green-300 border border-green-400/30' 
                              : project.status === 'in-progress' 
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30' 
                              : 'bg-slate-500/20 text-slate-300 border border-slate-400/30'
                          }`}>
                            {project.status}
                          </div>
                          <div className={`px-3 py-1 rounded-lg text-xs font-medium ${
                            project.profitMargin >= 20 
                              ? 'bg-green-500/20 text-green-300 border border-green-400/30' 
                              : project.profitMargin >= 10 
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30' 
                              : 'bg-red-500/20 text-red-300 border border-red-400/30'
                          }`}>
                            {project.profitMargin.toFixed(1)}%
                          </div>
                          {/* Budget variance indicator */}
                          {project.budgetVariance !== 0 && (
                            <div className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                              project.budgetVariance > 0 
                                ? 'bg-red-500/20 text-red-300 border border-red-400/30' 
                                : 'bg-green-500/20 text-green-300 border border-green-400/30'
                            }`}>
                              {project.budgetVariance > 0 ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                              {Math.abs(project.budgetVariance).toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Quoted Amount</p>
                          <p className="font-bold text-blue-400">{currency} {(project.quotedAmount / 1000).toFixed(0)}K</p>
                          <p className="text-[11px] text-slate-400">
                            {project.loggedHours > 0 ? `${project.loggedHours.toFixed(1)}h logged` : '0h logged'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Actual Cost</p>
                          <p className="font-bold text-orange-400">
                            {currency} {project.actualCost >= 1000 ? `${(project.actualCost / 1000).toFixed(1)}K` : project.actualCost.toFixed(0)}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            Direct: {currency} {project.directCost >= 1000 ? `${(project.directCost / 1000).toFixed(1)}K` : project.directCost.toFixed(0)} · Labor: {currency} {project.laborCost.toFixed(0)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Revenue</p>
                          <p className="font-bold text-cyan-400">{currency} {(project.revenue / 1000).toFixed(0)}K</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Operating Profit</p>
                          <p className={`font-bold ${project.actualProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {currency} {(project.actualProfit / 1000).toFixed(0)}K
                          </p>
                          <p className="text-[11px] text-slate-400">{project.profitMargin.toFixed(1)}% margin</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setIsProjectModalOpen(true);
                        }}
                        className="mt-3 text-sm text-purple-400 hover:text-purple-300 underline transition-colors"
                      >
                        View Details & Attributions
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </TabsContent>

        {/* Clients Tab */}
        <TabsContent value="clients" className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-8 rounded-3xl relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              boxShadow: '0 20px 60px -20px rgba(6, 182, 212, 0.5)',
            }}
          >
            <div 
              className="absolute inset-0 opacity-40"
              style={{
                background: 'radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.3), transparent 70%)',
              }}
            />
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div 
                  className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"
                  style={{ boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)' }}
                >
                  <UserCircle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Client Profitability</h2>
                  <p className="text-slate-400 text-sm">Revenue and margin by client</p>
                </div>
              </div>

              {hasClientRows ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={clientRows || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.08)" vertical={false} />
                    <XAxis
                      dataKey="clientName"
                      stroke="rgba(148, 163, 184, 0.5)"
                      style={{ fontSize: '12px', fontWeight: 500 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="rgba(148, 163, 184, 0.5)"
                      style={{ fontSize: '12px', fontWeight: 500 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                        border: '1px solid rgba(6, 182, 212, 0.3)',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '12px',
                        padding: '12px 16px',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
                      }}
                      labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '8px', fontSize: '13px' }}
                      itemStyle={{ color: '#94a3b8', fontSize: '12px' }}
                    />
                    <Legend />
                    <Bar dataKey="revenue" fill="#06b6d4" name="Revenue" />
                    <Bar dataKey="profit" fill="#10b981" name="Net Profit" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-400 text-sm py-12 text-center">No client profitability data for this period.</p>
              )}
            </div>
          </motion.div>
        </TabsContent>

        {/* Overhead Tab */}
        <TabsContent value="overhead" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-8 rounded-3xl relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                boxShadow: '0 20px 60px -20px rgba(245, 158, 11, 0.5)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.3), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center"
                    style={{ boxShadow: '0 10px 30px -10px rgba(245, 158, 11, 0.6)' }}
                  >
                    <PieChartIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Overhead Breakdown</h2>
                    <p className="text-slate-400 text-sm">Monthly expenses</p>
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={300}>
                  {overheadData && overheadData.items && overheadData.items.length > 0 ? (
                    <PieChart>
                      <Pie
                        data={(overheadData.items || []).map(item => ({
                          category: item.name,
                          amount: item.pool
                        }))}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry) => `${entry.category}: ${currency} ${(entry.amount / 1000).toFixed(0)}K`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="amount"
                      >
                        {(overheadData.items || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(15, 23, 42, 0.98)', 
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          backdropFilter: 'blur(20px)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
                        }}
                      />
                    </PieChart>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center bg-slate-900/50 border border-slate-700 rounded-2xl">
                      <p className="text-slate-400">Loading overhead data...</p>
                    </div>
                  )}
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="p-8 rounded-3xl"
              style={{
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
                boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
              }}
            >
              <div className="flex items-center gap-3 mb-6">
                <div 
                  className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
                  style={{ boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)' }}
                >
                  <Layers className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Overhead Allocation</h2>
                  <p className="text-slate-400 text-sm">Distribution across departments</p>
                </div>
              </div>

              <div className="space-y-4">
                {(overheadData?.items || []).map((overhead, idx) => (
                  <motion.div 
                    key={overhead.id} 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + idx * 0.1 }}
                    className="p-4 rounded-2xl"
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(148, 163, 184, 0.1)',
                    }}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-bold text-white">{overhead.name}</h4>
                      <p className="font-bold text-orange-400">{currency} {(overhead.pool / 1000).toFixed(0)}K</p>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400 capitalize">{overhead.allocationBase.replace('_', ' ')}</span>
                      <span className="text-slate-400">{overhead.allocationType || 'Direct'}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Allocated to: {overhead.departments.join(', ')}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </TabsContent>

        {/* What-If Tab */}
        <TabsContent value="whatif" className="space-y-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-2xl font-bold text-white">What-If Scenarios</h2>
              <p className="text-slate-400 text-sm">Test different pricing and cost scenarios (demo)</p>
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-6 py-3 rounded-xl text-sm font-medium text-white flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.3))',
                border: '1px solid rgba(168, 85, 247, 0.5)',
              }}
            >
              <Plus className="size-4" />
              New Scenario
            </motion.button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {scenariosLoading ? (
              <div className="col-span-2 flex items-center justify-center py-12">
                <div className="text-slate-400">Loading scenarios...</div>
              </div>
            ) : (whatIfScenarios || []).length === 0 ? (
              <div className="col-span-2 p-12 text-center rounded-3xl" style={{
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}>
                <Zap className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                <h3 className="text-xl font-bold text-white mb-2">No Scenarios Yet</h3>
                <p className="text-slate-400 mb-6">Create what-if scenarios to model different business outcomes</p>
                <button className="px-6 py-3 rounded-xl text-sm font-medium text-white" style={{
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.3))',
                  border: '1px solid rgba(168, 85, 247, 0.5)',
                }}>
                  <Plus className="size-4 inline mr-2" />
                  Create Your First Scenario
                </button>
              </div>
            ) : (whatIfScenarios || []).map((scenarioItem, idx) => {
              const scenario = scenarioItem as any;
              const impact = scenarioItem.lastResult?.profitChange ?? scenario.impact ?? 0;
              const projectedProfit = scenarioItem.lastResult?.profit ?? scenario.projectedProfit ?? 0;
              const projectedMargin = scenarioItem.lastResult?.margin ?? scenario.projectedMargin ?? 0;
              const description = scenario.description || (scenarioItem.isPreset ? 'Preset scenario' : 'Custom what-if model');
              const adjustments = scenario.adjustments || [
                ...(scenarioItem.revenueChangePct ? [{ label: 'Revenue change', value: scenarioItem.revenueChangePct }] : []),
                ...(scenarioItem.expenseChangePct ? [{ label: 'Expense change', value: scenarioItem.expenseChangePct }] : []),
                ...(scenarioItem.priceIncreasePct ? [{ label: 'Price increase', value: scenarioItem.priceIncreasePct }] : []),
                ...(scenarioItem.utilizationRatePct ? [{ label: 'Utilization', value: scenarioItem.utilizationRatePct }] : []),
                ...(scenarioItem.newHires ? [{ label: `New hires (${scenarioItem.newHires})`, value: scenarioItem.newHires }] : []),
              ];

              return (
                <motion.div
                  key={scenarioItem.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + idx * 0.1 }}
                  className="p-6 rounded-3xl"
                  style={{
                    background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                    boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
                  }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-white mb-1">{scenarioItem.name}</h3>
                      <p className="text-slate-400 text-sm">{description}</p>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-lg text-xs font-medium ${
                        impact >= 0
                          ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                          : 'bg-red-500/20 text-red-300 border border-red-400/30'
                      }`}
                    >
                      Impact {currency} {(impact / 1000).toFixed(0)}K
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Projected profit</p>
                      <p className="font-bold text-white">{currency} {(projectedProfit / 1000).toFixed(0)}K</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Projected margin</p>
                      <p className="font-bold text-green-400">{projectedMargin.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">vs baseline</p>
                      <p className="font-bold text-cyan-400">
                        {projectedProfit >= displayOverall.netProfit ? '+' : ''}
                        {currency} {((projectedProfit - displayOverall.netProfit) / 1000).toFixed(0)}K
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {adjustments.map((adjustment: any, cidx: number) => (
                      <div key={cidx} className="flex justify-between text-sm">
                        <span className="text-slate-400 capitalize">
                          {adjustment.label || adjustment.type || 'Adjustment'}
                        </span>
                        <span className="text-white font-medium">
                          {adjustment.value != null ? `${adjustment.value > 0 ? '+' : ''}${adjustment.value}%` : 'N/A'}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        {/* Business vs Personal Tab */}
        <TabsContent value="bvp" className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-8 rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
              border: '1px solid rgba(148, 163, 184, 0.1)',
              boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div 
                className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"
                style={{ boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.6)' }}
              >
                <Home className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Business vs Personal Expenses</h2>
                <p className="text-slate-400 text-sm">Categorization and tax optimization</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                {businessPersonalData && businessPersonalData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Business', value: (businessPersonalData?.find(d => d.scope === 'business')?.income || 0), fill: '#3b82f6' },
                            { name: 'Personal', value: (businessPersonalData?.find(d => d.scope === 'personal')?.income || 0), fill: '#10b981' },
                          ].filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={(entry) => `${entry.name}: ${currency} ${(entry.value / 1000).toFixed(0)}K`}
                          outerRadius={100}
                          dataKey="value"
                        >
                          <Cell fill="#3b82f6" />
                          <Cell fill="#10b981" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(15, 23, 42, 0.98)', 
                            border: '1px solid rgba(148, 163, 184, 0.3)',
                            backdropFilter: 'blur(20px)',
                            borderRadius: '12px',
                            padding: '12px 16px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <div className="h-[300px] flex items-center justify-center bg-slate-900/50 border border-slate-700 rounded-2xl">
                    <p className="text-slate-400">Loading business vs personal data...</p>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="p-5 bg-blue-600/20 border border-blue-500/30 rounded-lg">
                  <h3 className="text-lg font-bold text-white mb-2">Business Income</h3>
                  <p className="text-3xl font-bold text-blue-400 mb-2">{currency} {((businessPersonalData?.find(d => d.scope === 'business')?.income || 0) / 1000).toFixed(0)}K</p>
                  <p className="text-sm text-blue-200">
                    {businessPersonalData ? 
                      `${(((businessPersonalData.find(d => d.scope === 'business')?.income || 0) / 
                        ((businessPersonalData.find(d => d.scope === 'business')?.income || 0) + 
                         (businessPersonalData.find(d => d.scope === 'personal')?.income || 0))) * 100).toFixed(1)}% of total income` 
                      : '0% of total income'}
                  </p>
                  <div className="mt-3 space-y-1 text-sm text-blue-100">
                    <div className="flex justify-between">
                      <span>Expenses</span>
                      <span>{currency} {((businessPersonalData?.find(d => d.scope === 'business')?.expense || 0) / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Net</span>
                      <span>{currency} {((businessPersonalData?.find(d => d.scope === 'business')?.net || 0) / 1000).toFixed(0)}K</span>
                    </div>
                  </div>
                </div>
                <div className="p-5 bg-green-600/20 border border-green-500/30 rounded-lg">
                  <h3 className="text-lg font-bold text-white mb-2">Personal Income</h3>
                  <p className="text-3xl font-bold text-green-400 mb-2">{currency} {((businessPersonalData?.find(d => d.scope === 'personal')?.income || 0) / 1000).toFixed(0)}K</p>
                  <p className="text-sm text-green-200">
                    {businessPersonalData ? 
                      `${(((businessPersonalData.find(d => d.scope === 'personal')?.income || 0) / 
                        ((businessPersonalData.find(d => d.scope === 'business')?.income || 0) + 
                         (businessPersonalData.find(d => d.scope === 'personal')?.income || 0))) * 100).toFixed(1)}% of total income` 
                      : '0% of total income'}
                  </p>
                  <div className="mt-3 space-y-1 text-sm text-green-100">
                    <div className="flex justify-between">
                      <span>Expenses</span>
                      <span>{currency} {((businessPersonalData?.find(d => d.scope === 'personal')?.expense || 0) / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Net</span>
                      <span>{currency} {((businessPersonalData?.find(d => d.scope === 'personal')?.net || 0) / 1000).toFixed(0)}K</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </TabsContent>

        {/* Per Sq Ft Tab — §12.5 Space Efficiency & Square Foot Profitability */}
        <TabsContent value="sqft" className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-8 rounded-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
              border: '1px solid rgba(168, 85, 247, 0.2)',
              boxShadow: '0 20px 60px -20px rgba(168, 85, 247, 0.5)',
            }}
          >
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0"
                  style={{ boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)' }}
                >
                  <Maximize2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Square-Foot Profitability & Space Efficiency (§12.5)</h3>
                  <p className="text-sm text-slate-400">
                    Floor area productivity and operating cost density across departmental office allocations
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openSpaceConfigModal}
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 transition-all shadow-lg shadow-purple-900/30 border border-purple-400/30 cursor-pointer"
              >
                <Edit2 className="w-4 h-4" />
                Configure Space
              </button>
            </div>

            {/* Unconfigured Space Guidance Banner */}
            {totalSpaceSqft === 0 && (
              <div className="mb-6 p-4 rounded-2xl bg-purple-950/40 border border-purple-500/30 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center font-bold shrink-0">
                    ℹ️
                  </div>
                  <div>
                    <p className="text-xs text-purple-200 font-medium">
                      Department floor areas have not been configured yet.
                    </p>
                    <p className="text-[11px] text-purple-400">
                      Assign square footage to departments to compute revenue density, operating cost density, and space efficiency (§12.5).
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openSpaceConfigModal}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer"
                >
                  Set Floor Areas
                </button>
              </div>
            )}

            {/* Space Metrics KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-700/60">
                <p className="text-xs text-slate-400 mb-1">Total Assigned Space</p>
                <p className="text-2xl font-bold text-white">
                  {totalSpaceSqft > 0 ? `${totalSpaceSqft.toLocaleString()} sqft` : 'Not configured'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Active Department Area</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-700/60">
                <p className="text-xs text-slate-400 mb-1">Average Revenue / Sq Ft</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {currency} {avgRevPerSqft.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Per square foot</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-700/60">
                <p className="text-xs text-slate-400 mb-1">Average Cost / Sq Ft</p>
                <p className="text-2xl font-bold text-amber-400">
                  {currency} {avgCostPerSqft.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Direct + allocated OH</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-700/60">
                <p className="text-xs text-slate-400 mb-1">Operating Profit / Sq Ft</p>
                <p className={`text-2xl font-bold ${avgRevPerSqft >= avgCostPerSqft ? 'text-purple-300' : 'text-red-400'}`}>
                  {currency} {(avgRevPerSqft - avgCostPerSqft).toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Net space productivity</p>
              </div>
            </div>

            {/* Department Space Breakdown Table */}
            {spaceMetrics && spaceMetrics.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-700/60 bg-slate-900/40">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-800/60 text-xs uppercase text-slate-400 border-b border-slate-700/60">
                    <tr>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4 text-right">Floor Area</th>
                      <th className="py-3 px-4 text-right">Space Share</th>
                      <th className="py-3 px-4 text-right">Revenue</th>
                      <th className="py-3 px-4 text-right">Full Cost</th>
                      <th className="py-3 px-4 text-right">Rev / Sqft</th>
                      <th className="py-3 px-4 text-right">Cost / Sqft</th>
                      <th className="py-3 px-4 text-right">Profit / Sqft</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {spaceMetrics.map((sm) => (
                      <tr key={sm.departmentId} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-medium text-white">{sm.departmentName}</td>
                        <td className="py-3.5 px-4 text-right text-slate-200">
                          {sm.squareFootage > 0 ? `${sm.squareFootage.toLocaleString()} sqft` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right text-cyan-400">
                          {sm.spaceSharePct > 0 ? `${sm.spaceSharePct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right text-emerald-400 font-medium">
                          {currency} {sm.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3.5 px-4 text-right text-amber-400 font-medium">
                          {currency} {sm.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3.5 px-4 text-right text-white">
                          {sm.squareFootage > 0 ? `${currency} ${sm.revPerSqft.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right text-white">
                          {sm.squareFootage > 0 ? `${currency} ${sm.costPerSqft.toFixed(2)}` : '—'}
                        </td>
                        <td className={`py-3.5 px-4 text-right font-bold ${sm.profit >= 0 ? 'text-purple-300' : 'text-red-400'}`}>
                          {sm.squareFootage > 0 ? `${currency} ${sm.profitPerSqft.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800">
                <p className="text-slate-400 text-sm">No departments available to compute space metrics.</p>
              </div>
            )}

            {/* Policy Disclosure Footer (§12.5) */}
            <div className="mt-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-between text-xs text-slate-400">
              <span>Policy version: <strong className="text-slate-200">v1.2-costing</strong></span>
              <span>Calculation: <strong className="text-slate-200">Occupied departmental space excluding common core</strong></span>
              <span>Freshness: <strong className="text-emerald-400">Real-time DB query</strong></span>
            </div>
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* Project Transactions Modal */}
      <Dialog open={isProjectModalOpen} onOpenChange={setIsProjectModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-white">
              {projectDetails?.project?.name || 'Project Transactions'}
            </DialogTitle>
            {projectDetails?.project && (
              <div className="flex items-center gap-3 mt-2">
                <p className="text-slate-400">{projectDetails.project.clientName}</p>
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  projectDetails.project.status === 'completed' 
                    ? 'bg-green-500/20 text-green-300' 
                    : projectDetails.project.status === 'active' 
                    ? 'bg-blue-500/20 text-blue-300' 
                    : 'bg-slate-500/20 text-slate-300'
                }`}>
                  {projectDetails.project.status}
                </div>
              </div>
            )}
          </DialogHeader>

          {projectDetailsLoading ? (
            <div className="py-8 text-center text-slate-400">Loading transaction details...</div>
          ) : projectDetails?.summary ? (
            <div className="space-y-6 mt-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">Revenue</p>
                  <p className="text-lg font-bold text-cyan-400">
                    {currency} {(projectDetails.summary.totalRevenue / 1000).toFixed(1)}K
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">Costs</p>
                  <p className="text-lg font-bold text-orange-400">
                    {currency} {((projectDetails.summary.actualCost ?? projectDetails.summary.totalCosts) / 1000).toFixed(1)}K
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                    Direct: {currency} {((projectDetails.summary.directCosts ?? projectDetails.summary.totalCosts) / 1000).toFixed(1)}K · Labor: {currency} {Math.round(projectDetails.summary.laborCost || 0)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">Operating Profit</p>
                  <p className={`text-lg font-bold ${
                    projectDetails.summary.netProfit >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {currency} {(projectDetails.summary.netProfit / 1000).toFixed(1)}K
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">vs Quoted</p>
                  <p className={`text-lg font-bold ${
                    projectDetails.summary.variancePct <= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {projectDetails.summary.variancePct > 0 ? '+' : ''}
                    {projectDetails.summary.variancePct.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Income Transactions */}
              {projectDetails.income && projectDetails.income.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                    Income Transactions
                  </h3>
                  <div className="space-y-2">
                    {projectDetails.income.map((txn: any) => (
                      <div 
                        key={txn.id} 
                        className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 flex justify-between items-center"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-white">{txn.description}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(txn.date).toLocaleDateString()} {txn.narration && `• ${txn.narration}`}
                          </p>
                        </div>
                        <p className="font-bold text-green-400">
                          {currency} {txn.amount.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Expense Transactions */}
              {projectDetails.expenses && projectDetails.expenses.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-red-400" />
                    Expense Transactions
                  </h3>
                  <div className="space-y-2">
                    {projectDetails.expenses.map((txn: any) => (
                      <div 
                        key={txn.id} 
                        className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 flex justify-between items-center"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-white">{txn.description}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(txn.date).toLocaleDateString()} {txn.narration && `• ${txn.narration}`}
                          </p>
                        </div>
                        <p className="font-bold text-red-400">
                          {currency} {Math.abs(txn.amount).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attributed Timesheet Labor Entries */}
              {projectDetails.laborEntries && projectDetails.laborEntries.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-cyan-400" />
                      Attributed Timesheet Labor ({projectDetails.summary.loggedHours?.toFixed(1) || '0.0'} hrs)
                    </span>
                    <span className="text-sm font-mono text-cyan-400 font-normal">
                      Total: {currency} {Math.round(projectDetails.summary.laborCost || 0).toLocaleString()}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {projectDetails.laborEntries.map((l: any) => (
                      <div 
                        key={l.id} 
                        className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 flex justify-between items-center"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-white">{l.userName || 'Employee'}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(l.date).toLocaleDateString()} • {l.hours.toFixed(1)} hrs @ {currency} {l.effectiveHourlyRate.toFixed(2)}/hr
                          </p>
                        </div>
                        <p className="font-bold text-cyan-400 font-mono">
                          {currency} {l.cost.toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!projectDetails.income || projectDetails.income.length === 0) && 
               (!projectDetails.expenses || projectDetails.expenses.length === 0) && 
               (!projectDetails.laborEntries || projectDetails.laborEntries.length === 0) && (
                <div className="py-8 text-center text-slate-400">
                  No transactions or labor entries found for this project
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400">
              No data available
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Space Allocation Configuration Modal (§12.5) */}
      <Dialog open={isSpaceConfigOpen} onOpenChange={setIsSpaceConfigOpen}>
        <DialogContent className="max-w-lg bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Maximize2 className="w-5 h-5 text-purple-400" />
              Configure Department Floor Areas (§12.5)
            </DialogTitle>
            <p className="text-xs text-slate-400 mt-1">
              Specify occupied office area in square feet for each active department. Used for space productivity calculations and spatial overhead allocation (§12.3).
            </p>
          </DialogHeader>

          <form onSubmit={handleSaveSpaceAllocations} className="space-y-4 mt-2">
            <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
              {spaceMetrics && spaceMetrics.length > 0 ? (
                spaceMetrics.map((sm) => (
                  <div
                    key={sm.departmentId}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{sm.departmentName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Revenue: {currency} {sm.revenue.toLocaleString()} • Cost: {currency} {sm.cost.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={spaceAllocInputs[sm.departmentId] ?? ''}
                        onChange={(e) =>
                          setSpaceAllocInputs((prev) => ({
                            ...prev,
                            [sm.departmentId]: e.target.value,
                          }))
                        }
                        className="w-24 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-right text-sm font-mono focus:border-purple-500 focus:outline-none"
                      />
                      <span className="text-xs text-slate-400 font-mono">sqft</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-400 text-sm">
                  No active departments available to configure.
                </div>
              )}
            </div>

            {/* Total Assigned Space Dynamic Counter */}
            <div className="p-3.5 rounded-xl bg-purple-950/40 border border-purple-800/50 flex items-center justify-between text-xs">
              <span className="text-purple-300 font-medium">Total Assigned Office Space:</span>
              <span className="text-white font-bold font-mono text-sm">
                {Object.values(spaceAllocInputs)
                  .reduce((sum, val) => sum + Math.max(0, Number(val || 0)), 0)
                  .toLocaleString()}{' '}
                sqft
              </span>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsSpaceConfigOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingSpace || !spaceMetrics || spaceMetrics.length === 0}
                className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-purple-900/30"
              >
                {isSavingSpace ? 'Saving...' : 'Save Space Allocations'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}