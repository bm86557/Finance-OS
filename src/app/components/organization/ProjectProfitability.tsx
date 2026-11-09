import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Briefcase, Plus, Target, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Loader2, FolderOpen, Receipt, Clock, Users, Calculator, ChevronRight, CheckCircle2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';
import { employeeService } from '@/services/employeeService';
import { organizationService } from '@/services/organizationService';
import type { Project as ServiceProject, TimesheetEntry, OrganizationMember, ProjectProfitability as DomainProjectProfitability } from '@/services/types';

function profitFor(p: ServiceProject) {
  return p.quotedAmount - p.actualCost;
}

function marginPct(p: ServiceProject) {
  if (p.quotedAmount <= 0) return 0;
  return (profitFor(p) / p.quotedAmount) * 100;
}

function budgetVariancePct(p: ServiceProject) {
  if (p.quotedAmount <= 0) return 0;
  return ((p.actualCost - p.quotedAmount) / p.quotedAmount) * 100;
}

function statusBadgeStyle(status: ServiceProject['status']) {
  switch (status) {
    case 'active':
      return AXIOM.badges.info;
    case 'completed':
      return AXIOM.badges.success;
    case 'quoted':
      return AXIOM.badges.warning;
    case 'on_hold':
      return AXIOM.badges.purple;
    case 'cancelled':
      return AXIOM.badges.danger;
    default:
      return AXIOM.badges.info;
  }
}

function statusLabel(status: ServiceProject['status']) {
  switch (status) {
    case 'on_hold':
      return 'On hold';
    case 'quoted':
      return 'Quoted';
    default:
      return status;
  }
}

export function ProjectProfitability() {
  const svc = useOrgServices();
  const { currentOrganization } = useAuth();
  const goToOrgView = useOrgWorkspaceNav();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedProjectId = searchParams.get('projectId');
  const displayCurrency = currentOrganization?.currency ?? 'PKR';
  const [expandedTraceProjectIds, setExpandedTraceProjectIds] = useState<Set<string>>(new Set());

  const toggleTrace = (projectId: string) => {
    setExpandedTraceProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleOpenTransactions = (projectId: string) => {
    if (goToOrgView) {
      goToOrgView('project-transactions', { projectId });
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('view', 'project-transactions');
        next.set('projectId', projectId);
        return next;
      });
    }
  };

  const handleOpenDetail = (projectId: string) => {
    if (goToOrgView) {
      goToOrgView('project-detail', { projectId });
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('view', 'project-detail');
        next.set('projectId', projectId);
        return next;
      });
    }
  };

  const { data: projects, loading, error, refetch: refetchProjects, mutate: mutateProjects } = useServiceArray(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects'],
  );

  const { data: backendProfitability = [], refetch: refetchProfitability } = useServiceArray(
    () => svc.projects.getProfitability(),
    [svc.orgId],
    ['projects', 'profitability'],
  );

  const profitMap = useMemo(() => {
    const map = new Map<string, DomainProjectProfitability>();
    for (const p of backendProfitability) {
      map.set(p.projectId, p);
    }
    return map;
  }, [backendProfitability]);

  const { data: txnResult } = useService(
    () => svc.transactions.getAll({ pageSize: 1000 }),
    [svc.orgId],
    ['transactions'],
  );
  const transactions = txnResult?.items ?? [];

  const { data: departments } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );

  const deptNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) {
      m.set(d.id, d.name);
    }
    return m;
  }, [departments]);

  const projectTxnStats = useMemo(() => {
    const map = new Map<string, { directCost: number; directIncome: number; count: number; txns: typeof transactions }>();
    for (const t of transactions) {
      if (!t.projectId) continue;
      const status = String(t.status || 'classified').toLowerCase();
      if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) continue;
      if (t.worldScope === 'personal' || (Array.isArray(t.tags) && t.tags.includes('personal'))) continue;

      const desc = String(t.description || '').toLowerCase();
      const tags = Array.isArray(t.tags) ? t.tags : [];
      const isReimbursementOrPayroll = tags.some((tag: string) => ['reimbursement_settlement', 'payroll_payout', 'salary', 'payroll'].includes(tag))
        || desc.includes('reimbursement settlement')
        || desc.includes('payroll payout')
        || desc.includes('salary payout');

      const cur = map.get(t.projectId) ?? { directCost: 0, directIncome: 0, count: 0, txns: [] };
      if (t.type === 'debit') {
        if (!isReimbursementOrPayroll) {
          cur.directCost += Math.abs(t.amount);
        }
      } else if (t.type === 'credit') {
        cur.directIncome += t.amount;
      }
      cur.count += 1;
      cur.txns.push(t);
      map.set(t.projectId, cur);
    }
    return map;
  }, [transactions]);

  const { data: timesheets = [] } = useServiceArray(
    () => employeeService.getTimesheetsByOrg(svc.orgId),
    [svc.orgId],
    ['timesheets'],
  );

  const { data: orgMembers = [] } = useServiceArray(
    () => organizationService.getMembers(svc.orgId),
    [svc.orgId],
    ['organization_members'],
  );

  const memberNameById = useMemo(() => {
    const m = new Map<string, { name: string; email: string; avatar?: string }>();
    for (const mem of orgMembers) {
      const name = mem.user?.name || mem.user?.email?.split('@')[0] || mem.userId;
      m.set(mem.userId, {
        name,
        email: mem.user?.email || '',
        avatar: mem.user?.avatar,
      });
    }
    return m;
  }, [orgMembers]);

  const memberRateMap = useMemo(() => {
    const deptRateMap = new Map<string, number>();
    for (const d of departments) {
      if ((d as any).cost_per_hour && Number((d as any).cost_per_hour) > 0) {
        deptRateMap.set(d.id, Number((d as any).cost_per_hour));
      }
    }

    const map = new Map<string, number>();
    for (const m of orgMembers) {
      const fixedSal = Number((m as any).fixedSalary || (m as any).fixed_salary || 0);
      let rate = 0;
      if (fixedSal > 0) {
        rate = fixedSal / 160.0;
      } else if ((m as any).hourlyRate || (m as any).hourly_rate) {
        rate = Number((m as any).hourlyRate || (m as any).hourly_rate);
      } else if (m.department && deptRateMap.has(m.department)) {
        rate = deptRateMap.get(m.department)!;
      } else {
        rate = 50.0;
      }
      map.set(m.userId, rate);
    }
    return map;
  }, [orgMembers, departments]);

  const projectTimesheetStats = useMemo(() => {
    const map = new Map<
      string,
      {
        totalHours: number;
        billableHours: number;
        laborCost: number;
        contributors: Set<string>;
        employeeHours: Map<string, number>;
        employeeLaborCost: Map<string, number>;
        entries: TimesheetEntry[];
      }
    >();

    for (const entry of timesheets) {
      if (!entry.projectId) continue;
      const cur = map.get(entry.projectId) ?? {
        totalHours: 0,
        billableHours: 0,
        laborCost: 0,
        contributors: new Set<string>(),
        employeeHours: new Map<string, number>(),
        employeeLaborCost: new Map<string, number>(),
        entries: [],
      };
      const h = Number(entry.hours || 0);
      const rate = (entry.userId && memberRateMap.get(entry.userId)) || 50.0;
      const cost = h * rate;
      cur.totalHours += h;
      cur.laborCost += cost;
      if (entry.billable) cur.billableHours += h;
      if (entry.userId) {
        cur.contributors.add(entry.userId);
        const prevH = cur.employeeHours.get(entry.userId) || 0;
        cur.employeeHours.set(entry.userId, prevH + h);
        const prevCost = cur.employeeLaborCost.get(entry.userId) || 0;
        cur.employeeLaborCost.set(entry.userId, prevCost + cost);
      }
      cur.entries.push(entry);
      map.set(entry.projectId, cur);
    }
    return map;
  }, [timesheets, memberRateMap]);

  const enrichedProjects = useMemo(() => {
    return projects.map(p => {
      const stats = projectTxnStats.get(p.id);
      const tsStats = projectTimesheetStats.get(p.id);
      const bProf = profitMap.get(p.id);

      const localDirectCost = stats?.directCost ?? 0;
      const localDirectIncome = stats?.directIncome ?? 0;
      const localLaborCost = tsStats?.laborCost ?? 0;
      const localActualCost = Math.round((localDirectCost + localLaborCost) * 100) / 100;

      // Authoritative backend values take priority (§0.3, §0.5, §12.4)
      const directCost = bProf?.directCost ?? localDirectCost;
      const laborCost = bProf?.laborCost ?? localLaborCost;
      const assignedOverhead = bProf?.assignedOverhead ?? 0;
      const initialBaselineCost = bProf?.initialBaselineCost ?? Number(p.initialBaselineCost || 0);
      const actualCost = bProf ? bProf.actualCost : localActualCost;

      const loggedHours = bProf?.loggedHours ?? (tsStats?.totalHours ?? 0);
      const billableHours = bProf?.billableHours ?? (tsStats?.billableHours ?? 0);
      const nonBillableHours = bProf?.nonBillableHours ?? Math.max(0, loggedHours - billableHours);
      const contributorCount = bProf?.contributorCount ?? (tsStats?.contributors.size ?? 0);

      const quotedAmount = Number(p.quotedAmount || 0);
      const effectiveRevenue = bProf?.revenue ?? localDirectIncome;
      const isQuotedWithNoRevenue = (p.status === 'quoted' || (bProf?.status === 'quoted')) && effectiveRevenue === 0;
      const operatingProfit = bProf?.operatingProfit ?? (isQuotedWithNoRevenue ? 0 : effectiveRevenue - actualCost);
      const directCosts = Math.round((directCost + laborCost) * 100) / 100;
      const projectContribution = bProf?.projectContribution ?? (effectiveRevenue - directCosts);
      const profitMargin = bProf?.profitMargin ?? (effectiveRevenue > 0 ? (operatingProfit / effectiveRevenue) * 100 : 0);

      const consumedBurn = bProf?.consumedBurn ?? actualCost;
      const burnRatePerDay = bProf?.burnRatePerDay ?? 0;
      const committedRemainingWork = bProf?.committedRemainingWork ?? Number(p.committedRemainingWork || 0);
      const costToComplete = bProf?.costToComplete ?? (committedRemainingWork > 0 ? committedRemainingWork : Math.max(0, quotedAmount - actualCost));
      const projectedAtCompletion = bProf?.projectedAtCompletion ?? (actualCost + costToComplete);
      const marginAtRisk = bProf?.marginAtRisk ?? (quotedAmount - projectedAtCompletion);

      return {
        ...p,
        status: (bProf?.status || ((laborCost > 0 || loggedHours > 0) ? 'active' : p.status)) as ServiceProject['status'],
        actualCost,
        directCost: Math.round(directCost * 100) / 100,
        laborCost: Math.round(laborCost * 100) / 100,
        assignedOverhead: Math.round(assignedOverhead * 100) / 100,
        initialBaselineCost,
        consumedBurn,
        burnRatePerDay,
        committedRemainingWork,
        costToComplete: Math.round(costToComplete * 100) / 100,
        projectedAtCompletion: Math.round(projectedAtCompletion * 100) / 100,
        marginAtRisk: Math.round(marginAtRisk * 100) / 100,
        directIncome: localDirectIncome,
        revenue: effectiveRevenue,
        operatingProfit: Math.round(operatingProfit * 100) / 100,
        projectContribution: Math.round(projectContribution * 100) / 100,
        profitMargin: Math.round(profitMargin * 10) / 10,
        transactionCount: stats?.count ?? 0,
        transactions: stats?.txns ?? [],
        loggedHours,
        billableHours,
        nonBillableHours,
        contributorCount,
        timesheets: tsStats?.entries ?? [],
        employeeHours: tsStats?.employeeHours ?? new Map<string, number>(),
        employeeLaborCost: tsStats?.employeeLaborCost ?? new Map<string, number>(),
        contributors: bProf?.contributors || [],
      };
    });
  }, [projects, projectTxnStats, projectTimesheetStats, profitMap]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<(typeof enrichedProjects)[0] | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | ServiceProject['status']>('all');
  const [filterDepartmentId, setFilterDepartmentId] = useState('all');

  const [createForm, setCreateForm] = useState({
    name: '',
    code: '',
    clientName: '',
    departmentId: '',
    status: 'quoted' as ServiceProject['status'],
    startDate: '',
    endDate: '',
    quotedAmount: '',
    actualCost: '0',
    committedRemainingWork: '',
  });

  useEffect(() => {
    if (!createDialogOpen || departments.length === 0) return;
    setCreateForm(prev => {
      if (prev.departmentId) return prev;
      return { ...prev, departmentId: departments[0].id };
    });
  }, [createDialogOpen, departments]);

  const filteredProjects = enrichedProjects.filter(project => {
    const matchesStatus = filterStatus === 'all' || project.status === filterStatus;
    const matchesDept = filterDepartmentId === 'all' || project.departmentId === filterDepartmentId;
    return matchesStatus && matchesDept;
  });

  const totalQuoted = filteredProjects.reduce((sum, p) => sum + p.quotedAmount, 0);
  const totalCost = filteredProjects.reduce((sum, p) => sum + p.actualCost, 0);
  const totalProfit = totalQuoted - totalCost;
  const avgMargin = totalQuoted > 0 ? (totalProfit / totalQuoted) * 100 : 0;
  const activeProjects = enrichedProjects.filter(p => p.status === 'active').length;
  const completedProjects = enrichedProjects.filter(p => p.status === 'completed').length;

  // §12.4 Burn, EAC, Margin-at-Risk & Billable Time Aggregates (Gap 2)
  const totalBurn = filteredProjects.reduce((sum, p: any) => sum + (p.consumedBurn ?? p.actualCost), 0);
  const totalBurnRate = filteredProjects.reduce((sum, p: any) => sum + (p.burnRatePerDay ?? 0), 0);
  const totalEAC = filteredProjects.reduce((sum, p: any) => sum + (p.projectedAtCompletion ?? (p.actualCost + Math.max(0, p.quotedAmount - p.actualCost))), 0);
  const totalETC = filteredProjects.reduce((sum, p: any) => sum + (p.costToComplete ?? Math.max(0, p.quotedAmount - p.actualCost)), 0);
  const totalMarginAtRisk = filteredProjects.reduce((sum, p: any) => sum + (p.marginAtRisk ?? (p.quotedAmount - (p.projectedAtCompletion ?? (p.actualCost + Math.max(0, p.quotedAmount - p.actualCost))))), 0);
  const totalLoggedHours = filteredProjects.reduce((sum, p: any) => sum + (p.loggedHours ?? 0), 0);
  const totalBillableHours = filteredProjects.reduce((sum, p: any) => sum + (p.billableHours ?? 0), 0);

  const deptPerformance = useMemo(() => {
    const keys = [...new Set(enrichedProjects.map(p => p.departmentId))];
    return keys.map(deptId => {
      const deptProjects = filteredProjects.filter(p => p.departmentId === deptId);
      const revenue = deptProjects.reduce((sum, p) => sum + p.quotedAmount, 0);
      const cost = deptProjects.reduce((sum, p) => sum + p.actualCost, 0);
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        department: deptNameById.get(deptId) ?? 'Unknown',
        revenue,
        cost,
        profit,
        margin,
        projectCount: deptProjects.length,
      };
    });
  }, [enrichedProjects, filteredProjects, deptNameById]);

  const handleViewDetails = (project: (typeof enrichedProjects)[0]) => {
    setSelectedProject(project);
    setDetailsDialogOpen(true);
  };

  const resetCreateForm = () => {
    setCreateForm({
      name: '',
      code: '',
      clientName: '',
      departmentId: departments[0]?.id ?? '',
      status: 'quoted',
      startDate: '',
      endDate: '',
      quotedAmount: '',
      actualCost: '0',
      committedRemainingWork: '',
    });
  };

  const handleCreateProject = async () => {
    if (!createForm.name.trim() || !createForm.clientName.trim() || !createForm.startDate || !createForm.quotedAmount) {
      toast.error('Please fill in name, client, start date, and quoted amount.');
      return;
    }
    if (!createForm.departmentId) {
      toast.error('Add a department first, or pick one from the list.');
      return;
    }
    const quoted = parseFloat(createForm.quotedAmount);
    if (Number.isNaN(quoted)) {
      toast.error('Quoted amount must be a number.');
      return;
    }
    const actual = parseFloat(createForm.actualCost);
    const code =
      createForm.code.trim() ||
      createForm.name
        .trim()
        .slice(0, 8)
        .toUpperCase()
        .replace(/\s+/g, '-');

    const committedRemaining = createForm.committedRemainingWork.trim() ? parseFloat(createForm.committedRemainingWork) : 0;
    const res = await svc.projects.create({
      name: createForm.name.trim(),
      code,
      clientName: createForm.clientName.trim(),
      departmentId: createForm.departmentId,
      status: createForm.status,
      startDate: createForm.startDate,
      endDate: createForm.endDate.trim() || undefined,
      quotedAmount: quoted,
      actualCost: Number.isNaN(actual) ? 0 : actual,
      initialBaselineCost: Number.isNaN(actual) ? 0 : actual,
      committedRemainingWork: Number.isNaN(committedRemaining) ? 0 : committedRemaining,
      currency: displayCurrency,
    });

    if (!res.success) {
      toast.error(res.error || 'Could not create project');
      return;
    }
    if (res.data) {
      mutateProjects([res.data, ...projects]);
    }
    await Promise.all([refetchProjects(), refetchProfitability()]);
    toast.success('Project created');
    setCreateDialogOpen(false);
    resetCreateForm();
  };

  const isOverBudget = (p: ServiceProject) => p.actualCost > p.quotedAmount;

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
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
              <Briefcase className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Project Profitability
              </h1>
              <p className="text-slate-400 text-sm">Track quoted value, costs, and margin per project</p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
              border: '1px solid rgba(6, 182, 212, 0.5)',
              boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
              color: '#ffffff',
            }}
            onClick={() => {
              resetCreateForm();
              setCreateDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            New project
          </motion.button>
        </div>
      </motion.div>

      {error && (
        <div
          className="p-4 rounded-xl text-sm text-amber-200"
          style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)' }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading projects…
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Quoted total</p>
              <p className="text-2xl font-bold text-white">{formatCurrency(totalQuoted, displayCurrency)}</p>
              <p className="text-xs text-slate-400 mt-1">{filteredProjects.length} in view</p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <DollarSign className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Actual cost</p>
              <p className="text-2xl font-bold text-white">{formatCurrency(totalCost, displayCurrency)}</p>
              <p className="text-xs text-slate-400 mt-1">Recorded spend</p>
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
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Profit (quoted − cost)</p>
              <p className="text-2xl font-bold text-cyan-400">{formatCurrency(totalProfit, displayCurrency)}</p>
              <p className="text-xs text-cyan-400 mt-1">{avgMargin.toFixed(1)}% of quoted</p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <TrendingUp className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Projects In View</p>
              <p className="text-2xl font-bold text-white">{filteredProjects.length}</p>
              <p className="text-xs text-slate-400 mt-1">
                {activeProjects} active · {filteredProjects.filter(p => p.status === 'quoted').length} quoted · {completedProjects} completed
              </p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Briefcase className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* §12.4 Executive Project Health, Burn & Capacity Strip (Gap 2) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">Consumed Burn</p>
            <p className="text-base font-bold text-white mt-0.5">{formatCurrency(totalBurn, displayCurrency)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
              Spent: {formatCurrency(totalBurn, displayCurrency)} ({totalQuoted > 0 ? ((totalBurn / totalQuoted) * 100).toFixed(1) : 0}% of quote)
            </p>
          </div>
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
            <Receipt className="size-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">Projected at Completion (EAC)</p>
            <p className="text-base font-bold text-cyan-400 mt-0.5">{formatCurrency(totalEAC, displayCurrency)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
              Spend ({formatCurrency(totalBurn, displayCurrency)}) + ETC ({formatCurrency(totalETC, displayCurrency)})
            </p>
          </div>
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
            <Target className="size-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">Margin-at-Risk</p>
            <p className={`text-base font-bold mt-0.5 ${totalMarginAtRisk < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {formatCurrency(totalMarginAtRisk, displayCurrency)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {totalMarginAtRisk < 0 ? 'Cost overrun projected' : 'On target (EAC matches quote)'}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
            <AlertTriangle className="size-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">Logged & Billable Time</p>
            <p className="text-base font-bold text-white mt-0.5">{totalLoggedHours.toFixed(1)}h</p>
            <p className="text-[11px] text-emerald-400 mt-0.5 font-mono">
              {totalBillableHours.toFixed(1)}h billable ({totalLoggedHours > 0 ? Math.round((totalBillableHours / totalLoggedHours) * 100) : 0}%) · {formatCurrency(filteredProjects.reduce((s, p: any) => s + (p.laborCost || 0), 0), displayCurrency)}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Clock className="size-4" />
          </div>
        </div>
      </div>

      {!loading && projects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-16 px-6 rounded-2xl text-center"
          style={AXIOM.containers.list}
        >
          <FolderOpen className="size-12 text-slate-500 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-1">No projects yet</h2>
          <p className="text-slate-400 text-sm max-w-md mb-6">
            When you add projects, they show up here with quoted amounts, costs, and margin. Your list is stored with this organization.
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.35), rgba(59, 130, 246, 0.35))',
              border: '1px solid rgba(6, 182, 212, 0.45)',
              color: '#fff',
            }}
            onClick={() => {
              resetCreateForm();
              setCreateDialogOpen(true);
            }}
          >
            Add your first project
          </motion.button>
        </motion.div>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-4 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex flex-wrap gap-3">
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
                className="px-4 py-2 rounded-xl text-white text-sm"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              >
                <option value="all">All statuses</option>
                <option value="quoted">Quoted</option>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={filterDepartmentId}
                onChange={e => setFilterDepartmentId(e.target.value)}
                className="px-4 py-2 rounded-xl text-white text-sm"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              >
                <option value="all">All departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </motion.div>

          <div className="space-y-3">
            {filteredProjects.map((project, idx) => {
              const profit = project.operatingProfit ?? (project.revenue - project.actualCost);
              const margin = project.profitMargin ?? (project.revenue > 0 ? (profit / project.revenue) * 100 : 0);
              const variancePct = budgetVariancePct(project);

              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + idx * 0.05 }}
                  className="p-6 rounded-2xl transition-all"
                  style={
                    highlightedProjectId === project.id
                      ? {
                          ...AXIOM.containers.list,
                          border: '1px solid rgba(6, 182, 212, 0.6)',
                          boxShadow: '0 0 25px rgba(6, 182, 212, 0.15)',
                        }
                      : AXIOM.containers.list
                  }
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 onClick={() => handleOpenDetail(project.id)} className="text-white font-semibold text-lg cursor-pointer hover:text-cyan-300 transition-colors" title="Open detailed profit & employee time tracking">
                          {project.name}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize" style={statusBadgeStyle(project.status)}>
                          {statusLabel(project.status)}
                        </span>
                        {project.code && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800/90 text-slate-300 border border-slate-700/60">
                            {project.code}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400">
                        {project.clientName} • {deptNameById.get(project.departmentId) ?? 'Department'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 transition-all cursor-pointer shadow-lg shadow-emerald-500/10"
                        onClick={() => handleOpenDetail(project.id)}
                        title={`Track profit & employee hours for ${project.name}`}
                      >
                        <Clock className="size-3.5 text-emerald-400" />
                        <span>Track Profit & Hours</span>
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/30 transition-all cursor-pointer"
                        onClick={() => handleOpenTransactions(project.id)}
                        title={`View transactions for ${project.name}`}
                      >
                        <Receipt className="size-3.5" />
                        <span>View transactions</span>
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white"
                        style={{ background: 'rgba(148, 163, 184, 0.1)' }}
                        onClick={() => handleViewDetails(project)}
                        aria-label="View project details"
                      >
                        <Target className="size-4" />
                      </motion.button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Quoted Value</p>
                      <p className="text-lg font-bold text-emerald-400">{formatCurrency(project.quotedAmount, displayCurrency)}</p>
                      <p className="text-[11px] text-slate-400 font-mono">Target baseline</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Actual Spend</p>
                      <p className="text-lg font-bold text-red-400">{formatCurrency(project.actualCost, displayCurrency)}</p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Direct: {formatCurrency(project.directCost || 0, displayCurrency)} + Labor: {formatCurrency(project.laborCost || 0, displayCurrency)}
                        {project.assignedOverhead ? ` + Overhead: ${formatCurrency(project.assignedOverhead, displayCurrency)}` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Operating Profit</p>
                      <p className={`text-lg font-bold ${profit >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                        {formatCurrency(profit, displayCurrency)}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">
                        {project.status === 'quoted' && (project.revenue || 0) === 0 ? (
                          `Target: ${formatCurrency(project.quotedAmount - (project.initialBaselineCost || 0), displayCurrency)} (plan)`
                        ) : (
                          `${margin.toFixed(1)}% margin (${formatCurrency(project.revenue || 0, displayCurrency)} − ${formatCurrency(project.actualCost, displayCurrency)})`
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                        <Clock className="size-3 text-cyan-400" />
                        Logged Hours
                      </p>
                      <p className="text-lg font-bold text-cyan-400 font-mono">
                        {(project.loggedHours || 0).toFixed(1)}h
                        <span className="text-xs font-normal text-slate-400 ml-1.5">
                          ({formatCurrency(project.laborCost || 0, displayCurrency)})
                        </span>
                      </p>
                      <p className="text-xs text-slate-400 font-mono">
                        {(project.billableHours ?? project.loggedHours ?? 0).toFixed(1)}h billable · @ {project.loggedHours > 0 ? formatCurrency((project.laborCost || 0) / project.loggedHours, displayCurrency) : '$0'}/hr
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Timeline & Budget</p>
                      <p className="text-sm text-white">{formatDate(project.startDate)}</p>
                      <p className="text-xs text-slate-400 font-mono">
                        {project.endDate ? `to ${formatDate(project.endDate)}` : 'Open timeline'}
                        {(project as any).plannedDailyBudget ? ` · ${formatCurrency((project as any).plannedDailyBudget, displayCurrency)}/day planned` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Visual Cost Composition & Burn Progress Bar */}
                  {(() => {
                    const totalBudget = project.quotedAmount > 0 ? project.quotedAmount : Math.max(1, project.actualCost);
                    const directPct = Math.min(100, Math.round(((project.directCost || 0) / totalBudget) * 1000) / 10);
                    const laborPct = Math.min(100 - directPct, Math.round(((project.laborCost || 0) / totalBudget) * 1000) / 10);
                    const overheadPct = Math.min(100 - directPct - laborPct, Math.round(((project.assignedOverhead || 0) / totalBudget) * 1000) / 10);
                    const remainingPct = Math.max(0, Math.round((100 - directPct - laborPct - overheadPct) * 10) / 10);

                    return (
                      <div className="mt-3 p-3 rounded-xl bg-slate-900/50 border border-white/5 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 font-medium">Budget Consumption & Margin Breakdown</span>
                          <span className="font-mono text-slate-300">
                            Consumed <strong className="text-white">{formatCurrency(project.actualCost, displayCurrency)}</strong> of {formatCurrency(project.quotedAmount, displayCurrency)} ({((project.actualCost / totalBudget) * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                          {directPct > 0 && (
                            <div
                              style={{ width: `${directPct}%` }}
                              className="h-full bg-rose-500 transition-all"
                              title={`Direct Spend: ${formatCurrency(project.directCost || 0, displayCurrency)} (${directPct}%)`}
                            />
                          )}
                          {laborPct > 0 && (
                            <div
                              style={{ width: `${laborPct}%` }}
                              className="h-full bg-emerald-400 transition-all"
                              title={`Labor Cost: ${formatCurrency(project.laborCost || 0, displayCurrency)} (${laborPct}%)`}
                            />
                          )}
                          {overheadPct > 0 && (
                            <div
                              style={{ width: `${overheadPct}%` }}
                              className="h-full bg-purple-500 transition-all"
                              title={`Allocated Overhead: ${formatCurrency(project.assignedOverhead || 0, displayCurrency)} (${overheadPct}%)`}
                            />
                          )}
                          {remainingPct > 0 && (
                            <div
                              style={{ width: `${remainingPct}%` }}
                              className="h-full bg-cyan-500/25 transition-all"
                              title={`Remaining Margin: ${formatCurrency(profit, displayCurrency)} (${remainingPct}%)`}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400 pt-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            Direct: <strong className="text-slate-200">{formatCurrency(project.directCost || 0, displayCurrency)}</strong> ({directPct}%)
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            Labor: <strong className="text-slate-200">{formatCurrency(project.laborCost || 0, displayCurrency)}</strong> ({laborPct}%)
                          </span>
                          {project.assignedOverhead ? (
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-purple-500" />
                              Overhead: <strong className="text-slate-200">{formatCurrency(project.assignedOverhead, displayCurrency)}</strong> ({overheadPct}%)
                            </span>
                          ) : null}
                          <span className="flex items-center gap-1.5 ml-auto text-cyan-400">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            Remaining Margin: <strong>{formatCurrency(profit, displayCurrency)}</strong> ({remainingPct}%)
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Team Members & Logged Hours Breakdown */}
                  {project.contributors && project.contributors.length > 0 ? (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 mr-1">
                          <Users className="size-3 text-cyan-400" /> Team hours:
                        </span>
                        {project.contributors.map((c: any) => {
                          const fallbackMem = memberNameById.get(c.userId);
                          let displayName = c.name;
                          if (!displayName || displayName.includes('-') || displayName.length > 25) {
                            displayName = fallbackMem?.name && !fallbackMem.name.includes('-')
                              ? fallbackMem.name
                              : (fallbackMem?.email ? fallbackMem.email.split('@')[0] : 'Team Member');
                          }
                          const initial = (displayName || 'M')[0].toUpperCase();

                          return (
                            <span
                              key={c.userId}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/25"
                            >
                              <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-[10px] font-bold flex items-center justify-center text-cyan-200">
                                {initial}
                              </span>
                              <span className="truncate max-w-[130px] font-medium text-slate-200">{displayName}</span>
                              <span className="font-bold text-white bg-black/40 px-1.5 py-0.5 rounded text-[11px]">
                                {c.hours.toFixed(1)}h ({formatCurrency(c.laborCost, displayCurrency)})
                              </span>
                            </span>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleTrace(project.id)}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 font-medium transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-slate-700/50"
                      >
                        <Calculator className="size-3.5 text-cyan-400" />
                        <span>{expandedTraceProjectIds.has(project.id) ? 'Hide Audit Trace' : 'Audit Trace (§12.4)'}</span>
                        <ChevronRight className={`size-3 text-slate-500 transition-transform ${expandedTraceProjectIds.has(project.id) ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  ) : project.employeeHours && project.employeeHours.size > 0 ? (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 mr-1">
                          <Users className="size-3 text-cyan-400" /> Team hours:
                        </span>
                        {Array.from(project.employeeHours.entries()).map(([uId, h]) => {
                          const m = memberNameById.get(uId);
                          let empName = m?.name;
                          if (!empName || empName.includes('-') || empName.length > 25) {
                            empName = m?.email ? m.email.split('@')[0] : 'Team Member';
                          }
                          const initial = (empName || 'M')[0].toUpperCase();
                          const empLaborCost = project.employeeLaborCost?.get(uId) ?? 0;
                          return (
                            <span
                              key={uId}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/25"
                            >
                              <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-[10px] font-bold flex items-center justify-center text-cyan-200">
                                {initial}
                              </span>
                              <span className="truncate max-w-[130px] font-medium text-slate-200">{empName}</span>
                              <span className="font-bold text-white bg-black/40 px-1.5 py-0.5 rounded text-[11px]">
                                {h.toFixed(1)}h ({formatCurrency(empLaborCost, displayCurrency)})
                              </span>
                            </span>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleTrace(project.id)}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 font-medium transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-slate-700/50"
                      >
                        <Calculator className="size-3.5 text-cyan-400" />
                        <span>{expandedTraceProjectIds.has(project.id) ? 'Hide Audit Trace' : 'Audit Trace (§12.4)'}</span>
                        <ChevronRight className={`size-3 text-slate-500 transition-transform ${expandedTraceProjectIds.has(project.id) ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500 font-mono">
                      <div className="flex items-center gap-2">
                        <Users className="size-3 text-slate-600" />
                        <span>No employee logged hours yet for this project</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleTrace(project.id)}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 font-medium transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-slate-700/50"
                      >
                        <Calculator className="size-3.5 text-cyan-400" />
                        <span>{expandedTraceProjectIds.has(project.id) ? 'Hide Audit Trace' : 'Audit Trace (§12.4)'}</span>
                        <ChevronRight className={`size-3 text-slate-500 transition-transform ${expandedTraceProjectIds.has(project.id) ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  )}

                  {/* §12.4 Mathematical Attribution & Calculation Formula Bar (Collapsible) */}
                  <AnimatePresence>
                    {expandedTraceProjectIds.has(project.id) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden mt-3 p-3.5 rounded-xl bg-slate-900/80 border border-cyan-500/20 text-xs font-mono space-y-2.5"
                      >
                        <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                          <span className="flex items-center gap-1.5 text-cyan-400">
                            <Calculator className="size-3.5" />
                            Attribution & Calculation Formula Trace (§12.4)
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-normal bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            <CheckCircle2 className="size-3" />
                            100% Mathematically Reconciled
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5 text-slate-400 text-[11px] pt-1">
                          <div>
                            <span className="text-slate-500 block mb-0.5">Actual Cost Equation:</span>
                            <span className="text-white">
                              Direct ({formatCurrency(project.directCost || 0, displayCurrency)}) + Labor ({formatCurrency(project.laborCost || 0, displayCurrency)}) + Overhead ({formatCurrency(project.assignedOverhead || 0, displayCurrency)}) = <strong className="text-red-400">{formatCurrency(project.actualCost, displayCurrency)}</strong>
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-0.5">Operating Profit Equation:</span>
                            <span className="text-white">
                              Quoted ({formatCurrency(project.quotedAmount, displayCurrency)}) − Actual Cost ({formatCurrency(project.actualCost, displayCurrency)}) = <strong className="text-cyan-400">{formatCurrency(profit, displayCurrency)}</strong> ({margin.toFixed(1)}% margin)
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-0.5">Labor Attribution Equation:</span>
                            <span className="text-white">
                              {(project.loggedHours || 0).toFixed(1)} hrs ({((project.loggedHours || 0) * 60).toFixed(0)} mins) × {project.loggedHours > 0 ? `$${(((project.laborCost || 0) / project.loggedHours) / 60).toFixed(4)}/min ($${((project.laborCost || 0) / project.loggedHours).toFixed(2)}/hr)` : '$0.0000/min ($0.00/hr)'} = <strong className="text-emerald-400">{formatCurrency(project.laborCost || 0, displayCurrency)}</strong>
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-0.5">Projected at Completion (EAC):</span>
                            <span className="text-white">
                              Spent ({formatCurrency(project.actualCost, displayCurrency)}) + ETC ({formatCurrency(project.costToComplete ?? Math.max(0, project.quotedAmount - project.actualCost), displayCurrency)}) = <strong className="text-purple-400">{formatCurrency(project.projectedAtCompletion ?? project.quotedAmount, displayCurrency)}</strong> (Risk: {formatCurrency(project.marginAtRisk ?? 0, displayCurrency)})
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isOverBudget(project) && project.status === 'active' && (
                    <div
                      className="mt-4 p-3 rounded-xl flex items-start gap-2"
                      style={{
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      <AlertTriangle className="size-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-400">
                        Cost is above quoted amount by {formatCurrency(project.actualCost - project.quotedAmount, displayCurrency)}
                      </p>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {deptPerformance.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.chartBlue}
            >
              <h3 className="text-xl font-bold text-white mb-4">By department</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={deptPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
                  <XAxis dataKey="department" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" tickFormatter={value => `${value / 1000}K`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0a0a0f',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                      borderRadius: '12px',
                      color: '#fff',
                    }}
                    formatter={(value: number) => formatCurrency(value, displayCurrency)}
                  />
                  <Legend />
                  <Bar dataKey="revenue" fill="#10b981" name="Quoted" />
                  <Bar dataKey="cost" fill="#ef4444" name="Cost" />
                  <Bar dataKey="profit" fill="#06b6d4" name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </>
      )}

      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent
          className="max-w-3xl text-white"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white">Project details</DialogTitle>
          </DialogHeader>

          {selectedProject && (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">{selectedProject.name}</h2>
                <p className="text-slate-400">{selectedProject.clientName}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Status</label>
                  <span className="inline-block px-2 py-1 rounded-lg text-xs font-medium capitalize" style={statusBadgeStyle(selectedProject.status)}>
                    {statusLabel(selectedProject.status)}
                  </span>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Code</label>
                  <p className="text-white text-sm">{selectedProject.code}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 p-4 rounded-xl" style={AXIOM.containers.item}>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Quoted</p>
                  <p className="text-xl font-bold text-white">{formatCurrency(selectedProject.quotedAmount, displayCurrency)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Actual cost</p>
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(selectedProject.actualCost, displayCurrency)}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Direct: {formatCurrency(selectedProject.directCost || 0, displayCurrency)} · Labor: {formatCurrency(selectedProject.laborCost || 0, displayCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Operating Profit</p>
                  <p className={`text-xl font-bold ${((selectedProject as any).operatingProfit ?? profitFor(selectedProject)) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                    {formatCurrency((selectedProject as any).operatingProfit ?? profitFor(selectedProject), displayCurrency)}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl" style={AXIOM.containers.item}>
                <p className="text-sm text-slate-400 mb-2">Cost vs quote</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Variance</span>
                  <span className={isOverBudget(selectedProject) ? 'text-red-400' : 'text-emerald-400'}>
                    {budgetVariancePct(selectedProject) >= 0 ? '+' : ''}
                    {budgetVariancePct(selectedProject).toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Department</label>
                  <p className="text-white">{deptNameById.get(selectedProject.departmentId) ?? selectedProject.departmentId}</p>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Currency</label>
                  <p className="text-white">{selectedProject.currency}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Start</label>
                  <p className="text-white">{formatDate(selectedProject.startDate)}</p>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">End</label>
                  <p className="text-white">{selectedProject.endDate ? formatDate(selectedProject.endDate) : '—'}</p>
                </div>
              </div>

              {/* Linked Ledger Transactions */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 text-xs font-semibold uppercase tracking-wider block">
                    Linked Transactions ({selectedProject.transactionCount ?? 0})
                  </label>
                  <div className="flex items-center gap-3">
                    {selectedProject.transactionCount > 0 && (
                      <span className="text-xs text-slate-400 font-mono">
                        Cost: {formatCurrency(selectedProject.directCost, displayCurrency)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDetailsDialogOpen(false);
                        handleOpenTransactions(selectedProject.id);
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 flex items-center gap-1 cursor-pointer"
                    >
                      <Receipt className="size-3" />
                      View all transactions
                    </button>
                  </div>
                </div>

                {(!selectedProject.transactions || selectedProject.transactions.length === 0) ? (
                  <p className="text-xs text-slate-500 py-2">
                    No transactions allocated to this project yet. Use Quick Add or Import Statements to allocate transactions.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {selectedProject.transactions.map(t => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg flex items-center justify-between text-xs bg-slate-900/60 border border-slate-800"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="text-white font-medium truncate">{t.narration || t.description}</p>
                          <p className="text-[11px] text-slate-400">{formatDate(t.date)}</p>
                        </div>
                        <span
                          className={`font-mono font-bold shrink-0 ${
                            t.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {t.type === 'credit' ? '+' : '−'}
                          {formatCurrency(Math.abs(t.amount), t.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Employee Logged Hours & Timesheet Breakdown */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="size-3.5 text-cyan-400" />
                    <span>Employee Timesheets & Hours ({selectedProject.loggedHours != null ? selectedProject.loggedHours.toFixed(1) : '0.0'} hrs total)</span>
                  </label>
                  <span className="text-xs text-slate-400 font-mono">
                    {selectedProject.contributorCount || 0} {selectedProject.contributorCount === 1 ? 'contributor' : 'contributors'}
                  </span>
                </div>

                {(!selectedProject.timesheets || selectedProject.timesheets.length === 0) ? (
                  <p className="text-xs text-slate-500 py-2">
                    No employee timesheet hours logged for this project yet. Employees can log hours via the Employee Timesheet tool.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* Employee Hours Breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Array.from(selectedProject.employeeHours.entries()).map(([userId, hours]) => {
                        const member = memberNameById.get(userId);
                        const empName = member?.name || userId;
                        const pct = selectedProject.loggedHours && selectedProject.loggedHours > 0
                          ? Math.round((hours / selectedProject.loggedHours) * 100)
                          : 0;
                        return (
                          <div
                            key={userId}
                            className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs font-bold uppercase shrink-0">
                                {empName.slice(0, 2)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-white truncate">{empName}</p>
                                <p className="text-[10px] text-slate-400">{pct}% of project hours</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono font-bold text-cyan-400 block">
                                {hours.toFixed(1)}h
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                {formatCurrency(selectedProject.employeeLaborCost?.get(userId) ?? 0, displayCurrency)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Recent Timesheet Logs Table */}
                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {selectedProject.timesheets.map(entry => {
                        const member = memberNameById.get(entry.userId);
                        const empName = member?.name || entry.userId;
                        return (
                          <div
                            key={entry.id}
                            className="p-2 rounded-lg flex items-center justify-between text-xs bg-slate-950/40 border border-slate-800"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-white font-medium truncate">{empName}</span>
                                <span className="text-[10px] text-slate-400">{formatDate(entry.date)}</span>
                                {entry.billable ? (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Billable</span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">Non-billable</span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 truncate">{entry.description || 'Logged time'}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-mono font-bold text-cyan-400 block">{entry.hours}h</span>
                              <span className="text-[10px] uppercase font-mono text-slate-500">{entry.status}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-4" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 cursor-pointer"
                  onClick={() => {
                    setDetailsDialogOpen(false);
                    handleOpenTransactions(selectedProject.id);
                  }}
                >
                  <Receipt className="size-4" />
                  <span>Open in Dedicated Transactions Page</span>
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-6 py-3 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  onClick={() => setDetailsDialogOpen(false)}
                >
                  Close
                </motion.button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={open => { setCreateDialogOpen(open); if (open) resetCreateForm(); }}>
        <DialogContent
          className="max-w-2xl text-white max-h-[90vh] overflow-y-auto"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white">New project</DialogTitle>
            <DialogDescription className="text-slate-400">
              Projects are saved for this organization and used in profitability views.
            </DialogDescription>
          </DialogHeader>

          {departments.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">
              You need at least one department before creating a project. Add departments in your organization setup, then try again.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Project name *</label>
                  <input
                    value={createForm.name}
                    onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Client website rebuild"
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Client *</label>
                  <input
                    value={createForm.clientName}
                    onChange={e => setCreateForm(f => ({ ...f, clientName: e.target.value }))}
                    placeholder="Client name"
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Code (optional)</label>
                  <input
                    value={createForm.code}
                    onChange={e => setCreateForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="Auto-filled if empty"
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Department *</label>
                  <Select value={createForm.departmentId} onValueChange={v => setCreateForm(f => ({ ...f, departmentId: v }))}>
                    <SelectTrigger
                      className="w-full text-white"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    >
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent
                      style={{
                        background: AXIOM.containers.list.background,
                        border: AXIOM.containers.list.border,
                      }}
                    >
                      {departments.map(d => (
                        <SelectItem key={d.id} value={d.id} className="text-white">
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Status</label>
                  <Select value={createForm.status} onValueChange={v => setCreateForm(f => ({ ...f, status: v as ServiceProject['status'] }))}>
                    <SelectTrigger
                      className="w-full text-white"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      style={{
                        background: AXIOM.containers.list.background,
                        border: AXIOM.containers.list.border,
                      }}
                    >
                      <SelectItem value="quoted" className="text-white">
                        Quoted
                      </SelectItem>
                      <SelectItem value="active" className="text-white">
                        Active
                      </SelectItem>
                      <SelectItem value="on_hold" className="text-white">
                        On hold
                      </SelectItem>
                      <SelectItem value="completed" className="text-white">
                        Completed
                      </SelectItem>
                      <SelectItem value="cancelled" className="text-white">
                        Cancelled
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Quoted amount *</label>
                  <input
                    type="number"
                    min={0}
                    value={createForm.quotedAmount}
                    onChange={e => setCreateForm(f => ({ ...f, quotedAmount: e.target.value }))}
                    placeholder="0"
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
                <div>
                  <label className="text-white text-sm font-medium mb-1 block">Opening Baseline Cost (Optional)</label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Actual cost is tracked dynamically from employee logged hours + direct transactions + overhead. Enter opening baseline only if migrating an in-progress project.
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={createForm.actualCost}
                    onChange={e => setCreateForm(f => ({ ...f, actualCost: e.target.value }))}
                    placeholder="0"
                    className="w-full px-4 py-3 rounded-xl text-white font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
                <div>
                  <label className="text-white text-sm font-medium mb-1 block">Committed Remaining Work (Optional)</label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Explicit cost required to finish project work (§12.4). Used in dynamic Projected at Completion (EAC) calculations.
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={createForm.committedRemainingWork}
                    onChange={e => setCreateForm(f => ({ ...f, committedRemainingWork: e.target.value }))}
                    placeholder="0"
                    className="w-full px-4 py-3 rounded-xl text-white font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">Start date *</label>
                  <input
                    type="date"
                    value={createForm.startDate}
                    onChange={e => setCreateForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
                <div>
                  <label className="text-white text-sm font-medium mb-2 block">End date</label>
                  <input
                    type="date"
                    value={createForm.endDate}
                    onChange={e => setCreateForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Cancel
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-medium"
                  style={{
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                    border: '1px solid rgba(6, 182, 212, 0.5)',
                    color: '#ffffff',
                  }}
                  onClick={() => void handleCreateProject()}
                >
                  Create project
                </motion.button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
