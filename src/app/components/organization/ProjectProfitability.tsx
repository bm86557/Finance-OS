import { useMemo, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useSearchParams } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { isValidProjectTransaction, isDirectProjectDebit } from '@/lib/projectTransactionFilter';
import {
  calculateMonFriSequenceHours,
  computeProjectSchedulePreview,
  nextCalendarDayYmd,
  todayYmdCalendar,
} from '@/lib/projectScheduleHours';
import {
  Briefcase,
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FolderOpen,
  Receipt,
  Edit3,
  Eye,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  ShieldAlert,
  Users,
  Clock,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { SkeletonLine } from '../loading/LoadingStates';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';
import { organizationService } from '@/services/organizationService';
import type {
  Project as ServiceProject,
  ProjectMemberAssignment,
  ProjectProfitability as DomainProjectProfitability,
} from '@/services/types';

function budgetVariancePct(quoted: number, actual: number) {
  if (quoted <= 0) return 0;
  return ((actual - quoted) / quoted) * 100;
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
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    case 'on_hold':
      return 'On hold';
    case 'quoted':
      return 'Quoted';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function healthBadgeMeta(health?: DomainProjectProfitability['healthStatus']) {
  switch (health) {
    case 'in_loss':
      return {
        label: 'IN LOSS',
        className: 'bg-rose-500/20 text-rose-300 border border-rose-500/50',
      };
    case 'completed_loss':
      return {
        label: 'CLOSED IN LOSS',
        className: 'bg-rose-500/20 text-rose-300 border border-rose-500/40',
      };
    case 'overtime':
      return {
        label: 'OVERDUE',
        className: 'bg-orange-500/20 text-orange-300 border border-orange-500/50',
      };
    case 'at_risk':
      return {
        label: 'AT RISK',
        className: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
      };
    case 'completed_profit':
      return {
        label: 'COMPLETED',
        className: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
      };
    case 'on_hold':
      return {
        label: 'PAUSED',
        className: 'bg-purple-500/20 text-purple-300 border border-purple-500/40',
      };
    case 'quoted':
      return {
        label: 'QUOTED',
        className: 'bg-slate-700/60 text-slate-300 border border-slate-600/50',
      };
    case 'cancelled':
      return {
        label: 'CANCELLED',
        className: 'bg-slate-800 text-slate-400 border border-slate-700',
      };
    default:
      return {
        label: 'ON TRACK',
        className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35',
      };
  }
}

interface MemberDraftAssignment {
  userId: string;
  assignedFrom: string;
  allocationPct: string; // empty = automatic equal split (1/N)
}

export function ProjectProfitability() {
  const svc = useOrgServices();
  const { currentOrganization } = useAuth();
  const goToOrgView = useOrgWorkspaceNav();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedProjectId = searchParams.get('projectId');
  const displayCurrency = currentOrganization?.currency ?? 'USD';

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

  const { data: orgMembers = [] } = useServiceArray(
    () => organizationService.getMembers(svc.orgId),
    [svc.orgId],
    ['organization_members'],
  );

  const deptNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) {
      m.set(d.id, d.name);
    }
    return m;
  }, [departments]);

  const activeOrgMembers = useMemo(
    () => orgMembers.filter((m: any) => (m.status || 'active') === 'active'),
    [orgMembers],
  );

  const memberInfoById = useMemo(() => {
    const m = new Map<string, { name: string; email: string; department?: string }>();
    for (const mem of orgMembers as any[]) {
      const uid = String(mem.userId || mem.user_id || mem.id);
      const name =
        mem.user?.name ||
        mem.name ||
        mem.user?.email?.split('@')[0] ||
        mem.email?.split('@')[0] ||
        'Team Member';
      m.set(uid, {
        name,
        email: mem.user?.email || mem.email || '',
        department: mem.department,
      });
    }
    return m;
  }, [orgMembers]);

  // Shared overhead rate per hour by department (derived from authoritative backend profitability engine)
  const deptOverheadRateById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of profitMap.values()) {
      for (const ovh of p.overheadBreakdown || []) {
        if (ovh.departmentId && ovh.overheadRatePerHour > 0) {
          map.set(ovh.departmentId, ovh.overheadRatePerHour);
        }
      }
    }
    return map;
  }, [profitMap]);

  const projectTxnStats = useMemo(() => {
    const map = new Map<string, { directCost: number; directIncome: number; count: number; txns: typeof transactions }>();
    for (const t of transactions) {
      if (!t.projectId) continue;
      if (!isValidProjectTransaction(t)) continue;

      const cur = map.get(t.projectId) ?? { directCost: 0, directIncome: 0, count: 0, txns: [] };
      if (t.type === 'debit') {
        if (isDirectProjectDebit(t)) {
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

  // Combine project records with backend Direct Expenses + Shared Overhead + Deadline/Overrun Loss Engine (fixed salaries excluded)
  const enrichedProjects = useMemo(() => {
    return projects.map(p => {
      const stats = projectTxnStats.get(p.id);
      const bProf = profitMap.get(p.id);

      const quotedAmount = Number(p.quotedAmount || 0);
      const initialBaselineCost = bProf?.initialBaselineCost ?? Number(p.initialBaselineCost || 0);
      const directCost = bProf?.directCost ?? (stats?.directCost ?? 0);
      const assignedOverhead = bProf?.assignedOverhead ?? 0;
      const actualCost = bProf
        ? bProf.actualCost
        : Math.round((initialBaselineCost + directCost + assignedOverhead) * 100) / 100;

      const revenue = bProf?.revenue ?? (stats?.directIncome ?? 0);
      const profit = bProf?.quoteProfit ?? Math.round((quotedAmount - actualCost) * 100) / 100;
      const margin = quotedAmount > 0 ? Math.round(((profit / quotedAmount) * 100) * 10) / 10 : 0;

      const plannedHours = bProf?.plannedHours ?? 0;
      const elapsedHours = bProf?.elapsedHours ?? 0;
      const remainingHours = bProf?.remainingHours ?? Math.max(0, Math.round((plannedHours - elapsedHours) * 100) / 100);
      const overrunHours = bProf?.overrunHours ?? 0;
      const plannedBusinessDays = bProf?.plannedBusinessDays ?? 0;
      const elapsedBusinessDays = bProf?.elapsedBusinessDays ?? 0;
      const remainingBusinessDays = bProf?.remainingBusinessDays ?? Math.max(0, plannedBusinessDays - elapsedBusinessDays);
      const overdueBusinessDays = bProf?.overdueBusinessDays ?? 0;

      // 1× Overall Project Calendar Schedule Hours (start → end date, Mon–Fri 8h/d · 160h/mo cap)
      const fallbackPlanSeq =
        bProf?.projectSchedulePlannedHours == null && p.startDate && p.endDate
          ? calculateMonFriSequenceHours(p.startDate, p.endDate, 0, p.hoursPerDay ?? 8, p.monthlyCapacityHours ?? 160)
          : null;
      const projectSchedulePlannedHours =
        bProf?.projectSchedulePlannedHours ?? (fallbackPlanSeq ? fallbackPlanSeq.hours : 0);

      const fallbackElapsedEnd =
        p.status === 'completed'
          ? (p.completedAt || p.endDate || todayYmdCalendar())
          : p.status === 'on_hold'
            ? (p.pausedAt || todayYmdCalendar())
            : todayYmdCalendar();
      const fallbackElapsedSeq =
        bProf?.projectScheduleElapsedHours == null && p.startDate && p.status !== 'quoted'
          ? calculateMonFriSequenceHours(
              p.startDate,
              fallbackElapsedEnd,
              p.pausedBusinessDays ?? 0,
              p.hoursPerDay ?? 8,
              p.monthlyCapacityHours ?? 160,
            )
          : null;
      const projectScheduleElapsedHours =
        bProf?.projectScheduleElapsedHours ?? (fallbackElapsedSeq ? fallbackElapsedSeq.hours : 0);

      const projectScheduleRemainingHours =
        bProf?.projectScheduleRemainingHours ??
        (projectSchedulePlannedHours > 0
          ? Math.max(0, Math.round((projectSchedulePlannedHours - projectScheduleElapsedHours) * 100) / 100)
          : 0);

      let projectScheduleOverrunHours = bProf?.projectScheduleOverrunHours ?? 0;
      if (bProf?.projectScheduleOverrunHours == null && p.endDate && fallbackElapsedEnd > p.endDate && p.status !== 'quoted') {
        const nextAfterEnd = nextCalendarDayYmd(p.endDate);
        if (nextAfterEnd) {
          projectScheduleOverrunHours = calculateMonFriSequenceHours(
            nextAfterEnd,
            fallbackElapsedEnd,
            0,
            p.hoursPerDay ?? 8,
            p.monthlyCapacityHours ?? 160,
          ).hours;
        }
      }
      const hourlyBurnRate = bProf?.hourlyBurnRate ?? 0;
      const costToComplete = bProf?.costToComplete ?? 0;
      const projectedAtCompletion = bProf?.projectedAtCompletion ?? actualCost;
      const marginAtRisk = bProf?.marginAtRisk ?? Math.round((quotedAmount - projectedAtCompletion) * 100) / 100;
      const breakEvenDate = bProf?.breakEvenDate ?? null;
      const daysUntilLoss = bProf?.daysUntilLoss ?? null;
      const lossAmount = bProf?.lossAmount ?? (quotedAmount > 0 && actualCost > quotedAmount ? Math.round((actualCost - quotedAmount) * 100) / 100 : 0);
      const isOverdue = bProf?.isOverdue ?? false;
      const healthStatus: DomainProjectProfitability['healthStatus'] =
        bProf?.healthStatus ??
        (p.status === 'completed'
          ? (quotedAmount > 0 && actualCost > quotedAmount ? 'completed_loss' : 'completed_profit')
          : p.status === 'on_hold'
            ? 'on_hold'
            : p.status === 'quoted'
              ? 'quoted'
              : p.status === 'cancelled'
                ? 'cancelled'
                : quotedAmount > 0 && actualCost > quotedAmount
                  ? 'in_loss'
                  : 'on_track');

      const alertMessage = bProf?.alertMessage ?? null;
      const teamAllocations = bProf?.teamAllocations ?? [];
      const committedRemainingWork = bProf?.committedRemainingWork ?? Number(p.committedRemainingWork || 0);
      const plannedTeamSize = bProf?.plannedTeamSize ?? Number(p.plannedTeamSize || 1);
      const budgetedHours = bProf?.budgetedHours ?? (p.budgetedHours != null ? Number(p.budgetedHours) : null);

      return {
        ...p,
        quotedAmount,
        initialBaselineCost,
        directCost,
        assignedOverhead,
        actualCost,
        revenue,
        profit,
        margin,
        plannedHours,
        elapsedHours,
        remainingHours,
        overrunHours,
        plannedBusinessDays,
        elapsedBusinessDays,
        remainingBusinessDays,
        overdueBusinessDays,
        projectSchedulePlannedHours,
        projectScheduleElapsedHours,
        projectScheduleRemainingHours,
        projectScheduleOverrunHours,
        hourlyBurnRate,
        costToComplete,
        projectedAtCompletion,
        marginAtRisk,
        breakEvenDate,
        daysUntilLoss,
        lossAmount,
        isOverdue,
        healthStatus,
        alertMessage,
        teamAllocations,
        committedRemainingWork,
        plannedTeamSize,
        budgetedHours,
        transactionCount: stats?.count ?? 0,
        transactions: stats?.txns ?? [],
      };
    });
  }, [projects, projectTxnStats, profitMap]);

  // Filter & Modal states
  const [filterStatus, setFilterStatus] = useState<'all' | ServiceProject['status']>('all');
  const [filterDepartmentId, setFilterDepartmentId] = useState('all');

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [isSavingForm, setIsSavingForm] = useState(false);

  const [selectedProject, setSelectedProject] = useState<(typeof enrichedProjects)[0] | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const [completingProject, setCompletingProject] = useState<(typeof enrichedProjects)[0] | null>(null);
  const [completionDateInput, setCompletionDateInput] = useState(todayYmdCalendar());
  const [isCompleting, setIsCompleting] = useState(false);

  const [projectForm, setProjectForm] = useState({
    name: '',
    clientName: '',
    code: '',
    departmentId: '',
    status: 'active' as ServiceProject['status'],
    quotedAmount: '0',
    actualCost: '0',
    committedRemainingWork: '',
    plannedTeamSize: '1',
    budgetedHours: '',
    startDate: todayYmdCalendar(),
    endDate: '',
    completedAt: '',
  });
  const [draftAssignments, setDraftAssignments] = useState<MemberDraftAssignment[]>([]);

  useEffect(() => {
    if (!formDialogOpen || departments.length === 0) return;
    setProjectForm(prev => {
      if (prev.departmentId) return prev;
      return { ...prev, departmentId: departments[0].id };
    });
  }, [formDialogOpen, departments]);

  // Live schedule, overhead & deadline loss preview (Direct + Shared Overhead only; fixed salaries excluded)
  const liveFormPreview = useMemo(() => {
    const memberCount = draftAssignments.length > 0
      ? draftAssignments.length
      : Math.max(1, parseInt(projectForm.plannedTeamSize || '1', 10) || 1);

    const effectiveFte = draftAssignments.length > 0
      ? draftAssignments.reduce((sum, a) => {
          const pct = a.allocationPct.trim() ? Math.min(100, Math.max(1, parseFloat(a.allocationPct))) / 100 : 1;
          return sum + pct;
        }, 0)
      : memberCount;

    const fallbackOvhRate = deptOverheadRateById.values().next().value || 0;
    const deptOvhRate = deptOverheadRateById.get(projectForm.departmentId) ?? fallbackOvhRate;
    const combinedRate = deptOvhRate * effectiveFte;

    return computeProjectSchedulePreview({
      startDate: projectForm.startDate,
      endDate: projectForm.endDate || null,
      status: projectForm.status,
      completedAt: projectForm.completedAt || null,
      quotedAmount: parseFloat(projectForm.quotedAmount) || 0,
      initialBaselineCost: parseFloat(projectForm.actualCost) || 0,
      budgetedHours: projectForm.budgetedHours.trim() ? parseFloat(projectForm.budgetedHours) : null,
      memberCount,
      combinedHourlyRate: combinedRate,
    });
  }, [projectForm, draftAssignments, deptOverheadRateById]);

  // Live preview inside Complete Project modal
  const completePreview = useMemo(() => {
    if (!completingProject) return null;
    const memberCount = completingProject.teamAllocations.length > 0
      ? completingProject.teamAllocations.length
      : Math.max(1, completingProject.plannedTeamSize || 1);
    return computeProjectSchedulePreview({
      startDate: completingProject.startDate,
      endDate: completingProject.endDate || null,
      status: 'completed',
      completedAt: completionDateInput || todayYmdCalendar(),
      quotedAmount: completingProject.quotedAmount,
      initialBaselineCost: completingProject.initialBaselineCost,
      budgetedHours: completingProject.budgetedHours,
      memberCount,
      combinedHourlyRate: completingProject.hourlyBurnRate,
    });
  }, [completingProject, completionDateInput]);

  const filteredProjects = useMemo(() => {
    return enrichedProjects.filter(project => {
      const matchesStatus = filterStatus === 'all' || project.status === filterStatus;
      const matchesDept = filterDepartmentId === 'all' || project.departmentId === filterDepartmentId;
      return matchesStatus && matchesDept;
    });
  }, [enrichedProjects, filterStatus, filterDepartmentId]);

  // 4 Simple Top KPIs
  const totalQuoted = filteredProjects.reduce((sum, p) => sum + p.quotedAmount, 0);
  const totalDirect = filteredProjects.reduce((sum, p) => sum + p.initialBaselineCost + p.directCost, 0);
  const totalOverhead = filteredProjects.reduce((sum, p) => sum + p.assignedOverhead, 0);
  const totalCost = filteredProjects.reduce((sum, p) => sum + p.actualCost, 0);
  const totalProfit = totalQuoted - totalCost;
  const avgMargin = totalQuoted > 0 ? (totalProfit / totalQuoted) * 100 : 0;
  const activeProjects = enrichedProjects.filter(p => p.status === 'active').length;
  const completedProjects = enrichedProjects.filter(p => p.status === 'completed').length;
  const inLossCount = enrichedProjects.filter(p => p.healthStatus === 'in_loss' || p.healthStatus === 'completed_loss').length;
  const overdueCount = enrichedProjects.filter(p => p.isOverdue || p.healthStatus === 'overtime').length;

  const deptPerformance = useMemo(() => {
    const keys = [...new Set(filteredProjects.map(p => p.departmentId))];
    return keys.map(deptId => {
      const deptProjects = filteredProjects.filter(p => p.departmentId === deptId);
      const quoted = deptProjects.reduce((sum, p) => sum + p.quotedAmount, 0);
      const cost = deptProjects.reduce((sum, p) => sum + p.actualCost, 0);
      const profit = quoted - cost;
      return {
        department: deptNameById.get(deptId) ?? 'General',
        quoted,
        cost,
        profit,
      };
    });
  }, [filteredProjects, deptNameById]);

  const openCreateModal = () => {
    setEditingProjectId(null);
    setProjectForm({
      name: '',
      clientName: '',
      code: '',
      departmentId: departments[0]?.id ?? '',
      status: 'active',
      quotedAmount: '0',
      actualCost: '0',
      committedRemainingWork: '',
      plannedTeamSize: '1',
      budgetedHours: '',
      startDate: todayYmdCalendar(),
      endDate: '',
      completedAt: '',
    });
    setDraftAssignments([]);
    setFormDialogOpen(true);
  };

  const openEditModal = (project: (typeof enrichedProjects)[0]) => {
    setEditingProjectId(project.id);
    setProjectForm({
      name: project.name,
      clientName: project.clientName || '',
      code: project.code || '',
      departmentId: project.departmentId || departments[0]?.id || '',
      status: project.status,
      quotedAmount: String(project.quotedAmount ?? 0),
      actualCost: String(project.initialBaselineCost ?? 0),
      committedRemainingWork: project.committedRemainingWork ? String(project.committedRemainingWork) : '',
      plannedTeamSize: String(project.plannedTeamSize || 1),
      budgetedHours: project.budgetedHours ? String(project.budgetedHours) : '',
      startDate: project.startDate ? project.startDate.slice(0, 10) : todayYmdCalendar(),
      endDate: project.endDate ? project.endDate.slice(0, 10) : '',
      completedAt: project.completedAt ? project.completedAt.slice(0, 10) : '',
    });

    const existingList: MemberDraftAssignment[] =
      project.teamAllocations && project.teamAllocations.length > 0
        ? project.teamAllocations.map(t => ({
            userId: t.userId,
            assignedFrom: t.assignedFrom || project.startDate || todayYmdCalendar(),
            allocationPct: t.isCustomAllocation ? String(t.allocationSharePct) : '',
          }))
        : (project.memberAssignments || []).map(a => ({
            userId: a.userId,
            assignedFrom: a.assignedFrom || project.startDate || todayYmdCalendar(),
            allocationPct: a.allocationPct != null ? String(a.allocationPct) : '',
          }));

    setDraftAssignments(existingList);
    setFormDialogOpen(true);
  };

  const toggleMemberAssignment = (userId: string) => {
    setDraftAssignments(prev => {
      const exists = prev.some(a => a.userId === userId);
      if (exists) return prev.filter(a => a.userId !== userId);
      const defaultFrom =
        editingProjectId && projectForm.status === 'active'
          ? todayYmdCalendar()
          : (projectForm.startDate || todayYmdCalendar());
      return [...prev, { userId, assignedFrom: defaultFrom, allocationPct: '' }];
    });
  };

  const updateDraftAssignment = (userId: string, patch: Partial<MemberDraftAssignment>) => {
    setDraftAssignments(prev => prev.map(a => (a.userId === userId ? { ...a, ...patch } : a)));
  };

  const handleSaveProject = async () => {
    if (!projectForm.name.trim() || !projectForm.clientName.trim() || !projectForm.startDate) {
      toast.error('Please fill in project name, client, and start date.');
      return;
    }
    if (!projectForm.departmentId) {
      toast.error('Please select a department.');
      return;
    }
    const quoted = parseFloat(projectForm.quotedAmount);
    if (Number.isNaN(quoted) || quoted < 0) {
      toast.error('Quoted amount must be a valid number.');
      return;
    }
    const baseline = parseFloat(projectForm.actualCost || '0');
    if (Number.isNaN(baseline) || baseline < 0) {
      toast.error('Opening baseline cost must be a valid number.');
      return;
    }
    if (projectForm.endDate && projectForm.endDate < projectForm.startDate) {
      toast.error('End date cannot be earlier than start date.');
      return;
    }

    const committedRemaining = projectForm.committedRemainingWork.trim()
      ? parseFloat(projectForm.committedRemainingWork)
      : 0;
    const budgetedHrs = projectForm.budgetedHours.trim() ? parseFloat(projectForm.budgetedHours) : null;
    const teamSize = Math.max(1, parseInt(projectForm.plannedTeamSize || '1', 10) || 1);
    const code =
      projectForm.code.trim() ||
      projectForm.name.trim().slice(0, 8).toUpperCase().replace(/\s+/g, '-');

    const memberAssignments: ProjectMemberAssignment[] = draftAssignments.map(a => ({
      userId: a.userId,
      assignedFrom: a.assignedFrom || projectForm.startDate,
      allocationPct: a.allocationPct.trim() ? Math.min(100, Math.max(1, parseFloat(a.allocationPct))) : null,
    }));

    setIsSavingForm(true);
    try {
      if (editingProjectId) {
        const res = await svc.projects.update(editingProjectId, {
          name: projectForm.name.trim(),
          clientName: projectForm.clientName.trim(),
          code,
          departmentId: projectForm.departmentId,
          status: projectForm.status,
          quotedAmount: quoted,
          initialBaselineCost: baseline,
          committedRemainingWork: Number.isNaN(committedRemaining) ? 0 : committedRemaining,
          plannedTeamSize: teamSize,
          budgetedHours: budgetedHrs && budgetedHrs > 0 ? budgetedHrs : null,
          memberAssignments,
          assignedMemberIds: memberAssignments.map(m => m.userId),
          startDate: projectForm.startDate,
          endDate: projectForm.endDate.trim() || undefined,
          completedAt: projectForm.status === 'completed' ? (projectForm.completedAt || todayYmdCalendar()) : undefined,
        });
        if (!res.success) {
          toast.error(res.error || 'Could not update project');
          return;
        }
        toast.success('Project updated');
      } else {
        const res = await svc.projects.create({
          name: projectForm.name.trim(),
          clientName: projectForm.clientName.trim(),
          code,
          departmentId: projectForm.departmentId,
          status: projectForm.status,
          quotedAmount: quoted,
          actualCost: baseline,
          initialBaselineCost: baseline,
          committedRemainingWork: Number.isNaN(committedRemaining) ? 0 : committedRemaining,
          plannedTeamSize: teamSize,
          budgetedHours: budgetedHrs && budgetedHrs > 0 ? budgetedHrs : null,
          memberAssignments,
          assignedMemberIds: memberAssignments.map(m => m.userId),
          startDate: projectForm.startDate,
          endDate: projectForm.endDate.trim() || undefined,
          completedAt: projectForm.status === 'completed' ? (projectForm.completedAt || todayYmdCalendar()) : undefined,
          currency: displayCurrency,
        });
        if (!res.success) {
          toast.error(res.error || 'Could not create project');
          return;
        }
        if (res.data) {
          mutateProjects([res.data, ...projects]);
        }
        toast.success('Project created');
      }

      await Promise.all([refetchProjects(), refetchProfitability()]);
      setFormDialogOpen(false);
      setEditingProjectId(null);
    } finally {
      setIsSavingForm(false);
    }
  };

  const handleQuickStatusChange = async (project: (typeof enrichedProjects)[0], nextStatus: ServiceProject['status']) => {
    const res = await svc.projects.update(project.id, { status: nextStatus });
    if (!res.success) {
      toast.error(res.error || 'Could not update project status');
      return;
    }
    toast.success(
      nextStatus === 'active'
        ? `${project.name} resumed — deadline & cost tracking active.`
        : nextStatus === 'on_hold'
          ? `${project.name} paused — schedule clock frozen until resumed.`
          : `${project.name} updated.`,
    );
    await Promise.all([refetchProjects(), refetchProfitability()]);
  };

  const openCompleteModal = (project: (typeof enrichedProjects)[0]) => {
    setCompletingProject(project);
    setCompletionDateInput(project.completedAt?.slice(0, 10) || todayYmdCalendar());
  };

  const handleConfirmComplete = async () => {
    if (!completingProject) return;
    if (!completionDateInput) {
      toast.error('Please select the actual completion date.');
      return;
    }
    if (completingProject.startDate && completionDateInput < completingProject.startDate.slice(0, 10)) {
      toast.error('Completion date cannot be earlier than project start date.');
      return;
    }
    setIsCompleting(true);
    try {
      const res = await svc.projects.update(completingProject.id, {
        status: 'completed',
        completedAt: completionDateInput,
      });
      if (!res.success) {
        toast.error(res.error || 'Could not complete project');
        return;
      }
      toast.success(`${completingProject.name} completed & locked on ${formatDate(completionDateInput)}`);
      setCompletingProject(null);
      await Promise.all([refetchProjects(), refetchProfitability()]);
    } finally {
      setIsCompleting(false);
    }
  };

  if (loading && projects.length === 0) {
    return (
      <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
        {/* Header Skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SkeletonLine width="48px" height="48px" className="rounded-xl shrink-0" />
            <div className="space-y-2">
              <SkeletonLine width="260px" height="32px" />
              <SkeletonLine width="340px" height="14px" />
            </div>
          </div>
          <SkeletonLine width="132px" height="40px" className="rounded-xl" />
        </div>

        {/* 4 Top KPI Card Skeletons */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="p-5 rounded-2xl" style={AXIOM.containers.list}>
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2.5 flex-1">
                  <SkeletonLine width="45%" height="12px" />
                  <SkeletonLine width="65%" height="28px" />
                  <SkeletonLine width="75%" height="12px" />
                </div>
                <SkeletonLine width="44px" height="44px" className="rounded-xl shrink-0" />
              </div>
            </div>
          ))}
        </div>

        {/* Filter Bar Skeleton */}
        <div className="p-4 rounded-2xl flex flex-wrap items-center gap-3" style={AXIOM.containers.list}>
          <SkeletonLine width="170px" height="38px" className="rounded-lg" />
          <SkeletonLine width="210px" height="38px" className="rounded-lg" />
        </div>

        {/* Project Card Skeletons */}
        <div className="space-y-4">
          {[0, 1].map(i => (
            <div key={i} className="p-6 rounded-2xl space-y-5" style={AXIOM.containers.list}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <SkeletonLine width="180px" height="24px" />
                    <SkeletonLine width="64px" height="22px" className="rounded-md" />
                  </div>
                  <SkeletonLine width="220px" height="14px" />
                </div>
                <div className="flex items-center gap-2">
                  <SkeletonLine width="84px" height="32px" className="rounded-lg" />
                  <SkeletonLine width="68px" height="32px" className="rounded-lg" />
                  <SkeletonLine width="108px" height="32px" className="rounded-lg" />
                  <SkeletonLine width="32px" height="32px" className="rounded-lg" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[0, 1, 2, 3].map(col => (
                  <div key={col} className="space-y-2">
                    <SkeletonLine width="40%" height="12px" />
                    <SkeletonLine width="70%" height="28px" />
                    <SkeletonLine width="85%" height="12px" />
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-800/80 space-y-2">
                <SkeletonLine width="100%" height="8px" className="rounded-full" />
                <div className="flex items-center justify-between">
                  <SkeletonLine width="220px" height="12px" />
                  <SkeletonLine width="140px" height="12px" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
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
              <p className="text-slate-400 text-sm">
                Track quoted value, direct costs, shared overhead, deadline overruns, and loss alerts
              </p>
            </div>
          </div>

          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={openCreateModal}
            className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 cursor-pointer"
            style={AXIOM.buttons.primary}
          >
            <Plus className="size-4" />
            New project
          </motion.button>
        </div>

        {/* 4 Clean Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0 }}
            className="p-5 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-400 text-xs mb-1">Quoted total</p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {formatCurrency(totalQuoted, displayCurrency)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'} in view
                </p>
              </div>
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: AXIOM.iconBoxes.green, boxShadow: AXIOM.shadows.iconGreen }}
              >
                <DollarSign className="size-5 text-white" />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="p-5 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-400 text-xs mb-1">Actual cost</p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {formatCurrency(totalCost, displayCurrency)}
                </p>
                <p className="text-xs text-slate-400 mt-1 tabular-nums">
                  Direct {formatCurrency(totalDirect, displayCurrency)} + Overhead {formatCurrency(totalOverhead, displayCurrency)}
                </p>
              </div>
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: AXIOM.iconBoxes.red, boxShadow: AXIOM.shadows.iconRed }}
              >
                <TrendingDown className="size-5 text-white" />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-5 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-400 text-xs mb-1">Profit (quoted − cost)</p>
                <p className={`text-2xl font-bold tabular-nums ${totalProfit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                  {formatCurrency(totalProfit, displayCurrency)}
                </p>
                <p className={`text-xs mt-1 tabular-nums ${totalProfit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                  {avgMargin.toFixed(1)}% of quoted
                </p>
              </div>
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: AXIOM.iconBoxes.blue, boxShadow: AXIOM.shadows.iconBlue }}
              >
                <TrendingUp className="size-5 text-white" />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="p-5 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-400 text-xs mb-1">Active projects</p>
                <p className="text-2xl font-bold text-white tabular-nums">{activeProjects}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {completedProjects} completed
                  {inLossCount > 0 ? (
                    <span className="text-rose-400 font-semibold"> · {inLossCount} in loss</span>
                  ) : overdueCount > 0 ? (
                    <span className="text-orange-400 font-semibold"> · {overdueCount} overdue</span>
                  ) : null}
                </p>
              </div>
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: AXIOM.iconBoxes.purple, boxShadow: AXIOM.shadows.iconPurple }}
              >
                <Briefcase className="size-5 text-white" />
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {error && (
        <div
          className="p-4 rounded-xl text-sm text-red-300"
          style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
        >
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="p-4 rounded-2xl flex flex-wrap items-center gap-3" style={AXIOM.containers.list}>
        <Select value={filterStatus} onValueChange={v => setFilterStatus(v as typeof filterStatus)}>
          <SelectTrigger className="w-[170px] text-white" style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent style={{ background: '#0f172a', border: AXIOM.containers.list.border }}>
            <SelectItem value="all" className="text-white">All statuses</SelectItem>
            <SelectItem value="quoted" className="text-white">Quoted</SelectItem>
            <SelectItem value="active" className="text-white">Active</SelectItem>
            <SelectItem value="on_hold" className="text-white">On hold</SelectItem>
            <SelectItem value="completed" className="text-white">Completed</SelectItem>
            <SelectItem value="cancelled" className="text-white">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterDepartmentId} onValueChange={setFilterDepartmentId}>
          <SelectTrigger className="w-[210px] text-white" style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}>
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent style={{ background: '#0f172a', border: AXIOM.containers.list.border }}>
            <SelectItem value="all" className="text-white">All departments</SelectItem>
            {departments.map(d => (
              <SelectItem key={d.id} value={d.id} className="text-white">
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty State */}
      {filteredProjects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-12 rounded-2xl text-center space-y-4"
          style={AXIOM.containers.list}
        >
          <FolderOpen className="size-12 text-slate-500 mx-auto" />
          <div>
            <h3 className="text-lg font-semibold text-white">No projects yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto mt-1">
              {projects.length === 0
                ? 'Create your first project to track quoted value, direct expenses, shared overhead, and deadline loss alerts.'
                : 'No projects match the current filters.'}
            </p>
          </div>
          {projects.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
              style={AXIOM.buttons.primary}
            >
              <Plus className="size-4" />
              Create project
            </button>
          )}
        </motion.div>
      ) : (
        <>
          {/* Clean Project Cards with Automatic Overrun & Loss Detection */}
          <div className="space-y-4">
            {filteredProjects.map((project, index) => {
              const deptName = deptNameById.get(project.departmentId) ?? 'General';
              const variance = budgetVariancePct(project.quotedAmount, project.actualCost);
              const isLoss = project.healthStatus === 'in_loss' || project.healthStatus === 'completed_loss';
              const isOvertime = project.healthStatus === 'overtime' || project.isOverdue;
              const isAtRisk = project.healthStatus === 'at_risk';
              const badge = healthBadgeMeta(project.healthStatus);
              const isHighlighted = highlightedProjectId === project.id;
              const usedPct = project.quotedAmount > 0
                ? Math.min(100, (project.actualCost / project.quotedAmount) * 100)
                : 0;
              const directTotal = project.initialBaselineCost + project.directCost;
              const directPct = project.quotedAmount > 0
                ? Math.min(100, (directTotal / project.quotedAmount) * 100)
                : 0;
              const overheadPct = project.quotedAmount > 0
                ? Math.min(Math.max(0, 100 - directPct), (project.assignedOverhead / project.quotedAmount) * 100)
                : 0;

              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.04, 0.25) }}
                  className="p-6 rounded-2xl"
                  style={{
                    ...AXIOM.containers.list,
                    ...(isHighlighted
                      ? {
                          border: '1px solid rgba(6, 182, 212, 0.65)',
                          boxShadow: '0 0 24px -8px rgba(6, 182, 212, 0.45)',
                        }
                      : isLoss
                        ? { border: '1px solid rgba(244, 63, 94, 0.5)' }
                        : isOvertime
                          ? { border: '1px solid rgba(249, 115, 22, 0.45)' }
                          : {}),
                  }}
                >
                  {/* Card Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-bold text-white">{project.name}</h3>
                        <span
                          className="px-2.5 py-0.5 rounded-md text-xs font-medium"
                          style={statusBadgeStyle(project.status)}
                        >
                          {statusLabel(project.status)}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                        {project.code && (
                          <span className="text-xs font-mono text-slate-400">{project.code}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 mt-0.5">
                        {project.clientName || 'Client'} • {deptName}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {project.status === 'active' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openCompleteModal(project)}
                            className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-all cursor-pointer"
                            title="Lock completion date so deadline overrun stops"
                          >
                            <CheckCircle2 className="size-3.5" />
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickStatusChange(project, 'on_hold')}
                            className="px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 transition-all cursor-pointer"
                          >
                            <PauseCircle className="size-3.5" />
                            Pause
                          </button>
                        </>
                      )}
                      {project.status === 'on_hold' && (
                        <button
                          type="button"
                          onClick={() => void handleQuickStatusChange(project, 'active')}
                          className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 transition-all cursor-pointer"
                        >
                          <PlayCircle className="size-3.5" />
                          Resume
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditModal(project)}
                        className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-all cursor-pointer"
                      >
                        <Edit3 className="size-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenTransactions(project.id)}
                        className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/30 transition-all cursor-pointer"
                      >
                        <Receipt className="size-3.5" />
                        Transactions
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProject(project);
                          setDetailsDialogOpen(true);
                        }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/60 transition-all cursor-pointer"
                        title="View cost & deadline breakdown"
                      >
                        <Eye className="size-4" />
                      </button>
                    </div>
                  </div>

                  {/* 4 Clean Readable Columns */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Quoted</p>
                      <p className="text-2xl font-bold text-emerald-400 tabular-nums">
                        {formatCurrency(project.quotedAmount, displayCurrency)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 tabular-nums">
                        {project.revenue > 0
                          ? `Client paid: ${formatCurrency(project.revenue, displayCurrency)}`
                          : 'No client payments yet'}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400 mb-1">Actual cost</p>
                      <p className="text-2xl font-bold text-rose-400 tabular-nums">
                        {formatCurrency(project.actualCost, displayCurrency)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 tabular-nums">
                        Direct {formatCurrency(directTotal, displayCurrency)} + Overhead {formatCurrency(project.assignedOverhead, displayCurrency)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400 mb-1">Profit</p>
                      <p className={`text-2xl font-bold tabular-nums ${project.profit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                        {formatCurrency(project.profit, displayCurrency)}
                      </p>
                      <p className={`text-xs mt-1 tabular-nums ${project.profit >= 0 ? 'text-cyan-400/90' : 'text-rose-400'}`}>
                        {project.margin.toFixed(1)}% margin ({variance >= 0 ? '+' : ''}{variance.toFixed(1)}% vs quoted)
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400 mb-1">Timeline &amp; Deadline</p>
                      <p className="text-base font-semibold text-white">
                        {project.startDate ? formatDate(project.startDate) : '—'}
                        {project.endDate ? ` → ${formatDate(project.endDate)}` : ''}
                      </p>
                      <p className={`text-xs mt-1 tabular-nums ${project.overdueBusinessDays > 0 ? 'text-orange-400 font-semibold' : 'text-slate-400'}`}>
                        {project.status === 'completed' && project.completedAt
                          ? `Completed ${formatDate(project.completedAt)}`
                          : project.overdueBusinessDays > 0
                            ? `Overdue +${project.overdueBusinessDays}d (${project.projectScheduleOverrunHours.toFixed(0)}h schedule · ${project.overrunHours.toFixed(0)}h team)`
                            : project.breakEvenDate
                              ? `Budget runs out: ${formatDate(project.breakEvenDate)}`
                              : project.endDate
                                ? `${project.elapsedBusinessDays}/${project.plannedBusinessDays} workdays (${project.projectScheduleElapsedHours.toFixed(0)}h/${project.projectSchedulePlannedHours.toFixed(0)}h)`
                                : 'Ongoing (no deadline)'}
                      </p>
                    </div>
                  </div>

                  {/* Single Clean Budget Bar */}
                  {project.quotedAmount > 0 && (
                    <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-2">
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                        {isLoss ? (
                          <div className="h-full w-full bg-gradient-to-r from-rose-600 to-red-400" />
                        ) : (
                          <>
                            {directPct > 0 && <div style={{ width: `${directPct}%` }} className="h-full bg-rose-500" />}
                            {overheadPct > 0 && <div style={{ width: `${overheadPct}%` }} className="h-full bg-purple-500" />}
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                        <div className="flex flex-wrap items-center gap-4">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            Direct ({directPct.toFixed(1)}%)
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-purple-500" />
                            Shared Overhead ({overheadPct.toFixed(1)}%)
                          </span>
                          {project.status === 'active' && project.projectedAtCompletion > project.actualCost && (
                            <span className="tabular-nums text-slate-300">
                              Est. Final Cost: <strong className={project.marginAtRisk < 0 ? 'text-rose-400' : 'text-white'}>{formatCurrency(project.projectedAtCompletion, displayCurrency)}</strong>
                            </span>
                          )}
                        </div>
                        <span className="tabular-nums font-medium text-slate-300">
                          {usedPct.toFixed(1)}% of quoted budget used
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Automatic Overdue / Loss / At-Risk Alert Banner */}
                  {project.alertMessage && (isLoss || isOvertime || isAtRisk) && (
                    <div
                      className="mt-4 p-3.5 rounded-xl flex items-start gap-2.5"
                      style={
                        isLoss
                          ? { background: 'rgba(244, 63, 94, 0.14)', border: '1px solid rgba(244, 63, 94, 0.45)' }
                          : isOvertime
                            ? { background: 'rgba(249, 115, 22, 0.14)', border: '1px solid rgba(249, 115, 22, 0.4)' }
                            : { background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)' }
                      }
                    >
                      {isLoss ? (
                        <ShieldAlert className="size-4 text-rose-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className={`size-4 shrink-0 mt-0.5 ${isOvertime ? 'text-orange-400' : 'text-amber-400'}`} />
                      )}
                      <p className={`text-xs font-medium ${isLoss ? 'text-rose-200' : isOvertime ? 'text-orange-200' : 'text-amber-200'}`}>
                        {project.alertMessage}
                      </p>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* By Department Chart */}
          {deptPerformance.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.chartBlue}
            >
              <h3 className="text-xl font-bold text-white mb-4">By department</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={deptPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
                  <XAxis dataKey="department" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" tickFormatter={value => `${(value / 1000).toFixed(0)}K`} />
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
                  <Bar dataKey="quoted" fill="#10b981" name="Quoted" />
                  <Bar dataKey="cost" fill="#ef4444" name="Actual Cost" />
                  <Bar dataKey="profit" fill="#06b6d4" name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </>
      )}

      {/* Project Details Modal */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent
          className="sm:max-w-2xl text-white max-h-[88vh] overflow-y-auto"
          style={{ background: '#0b1120', border: AXIOM.containers.list.border }}
        >
          <DialogHeader>
            <DialogTitle className="text-white">{selectedProject?.name || 'Project Details'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedProject
                ? `${selectedProject.clientName || 'Client'} • ${deptNameById.get(selectedProject.departmentId) ?? 'General'}${selectedProject.code ? ` • ${selectedProject.code}` : ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedProject && (
            <div className="space-y-4">
              {selectedProject.alertMessage && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
                  <ShieldAlert className="size-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{selectedProject.alertMessage}</span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Quoted</p>
                  <p className="text-lg font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(selectedProject.quotedAmount, displayCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Actual cost</p>
                  <p className="text-lg font-bold text-rose-400 tabular-nums">
                    {formatCurrency(selectedProject.actualCost, displayCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Profit</p>
                  <p className={`text-lg font-bold tabular-nums ${selectedProject.profit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                    {formatCurrency(selectedProject.profit, displayCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Est. Final Cost</p>
                  <p className={`text-lg font-bold tabular-nums ${selectedProject.marginAtRisk < 0 ? 'text-rose-400' : 'text-white'}`}>
                    {formatCurrency(selectedProject.projectedAtCompletion, displayCurrency)}
                  </p>
                </div>
              </div>

              {/* 1. Overall Project Schedule Hours (Start → End Date, 1× calendar timeline) */}
              <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Clock className="size-3.5 text-cyan-400" />
                    Overall Project Hours (Start → End Date)
                  </p>
                  <span className="text-[11px] font-mono text-slate-400">
                    {selectedProject.startDate ? formatDate(selectedProject.startDate) : '—'}
                    {selectedProject.endDate ? ` → ${formatDate(selectedProject.endDate)}` : ' · Open-ended'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block">Project Planned</span>
                    <strong className="text-white tabular-nums block">
                      {selectedProject.projectSchedulePlannedHours > 0
                        ? `${selectedProject.projectSchedulePlannedHours.toFixed(0)}h`
                        : 'Open'}
                    </strong>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {selectedProject.plannedBusinessDays > 0 ? `${selectedProject.plannedBusinessDays} workdays` : 'No deadline'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Project Elapsed</span>
                    <strong className="text-cyan-300 tabular-nums block">
                      {selectedProject.projectScheduleElapsedHours.toFixed(0)}h
                    </strong>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {selectedProject.elapsedBusinessDays} workdays
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">
                      {selectedProject.overdueBusinessDays > 0 ? 'Schedule Overdue' : 'Time Remaining'}
                    </span>
                    <strong className={`tabular-nums block ${selectedProject.overdueBusinessDays > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedProject.overdueBusinessDays > 0
                        ? `+${selectedProject.projectScheduleOverrunHours.toFixed(0)}h`
                        : selectedProject.endDate
                          ? `${selectedProject.projectScheduleRemainingHours.toFixed(0)}h`
                          : 'On schedule'}
                    </strong>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {selectedProject.overdueBusinessDays > 0
                        ? `+${selectedProject.overdueBusinessDays} workdays past deadline`
                        : selectedProject.endDate
                          ? `${selectedProject.remainingBusinessDays} workdays left`
                          : 'No fixed deadline'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Budget Runs Out</span>
                    <strong className="text-amber-300 tabular-nums block">
                      {selectedProject.breakEvenDate ? formatDate(selectedProject.breakEvenDate) : '—'}
                    </strong>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {selectedProject.daysUntilLoss != null
                        ? selectedProject.daysUntilLoss > 0
                          ? `${selectedProject.daysUntilLoss} workdays left`
                          : 'Break-even reached'
                        : 'Based on burn rate'}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Single-timeline Mon–Fri calendar duration (8h/workday, capped at 160h/month) independent of team size.
                </p>
              </div>

              {/* 2. Collective Team Members Hours (All assigned staff combined with concurrency split) */}
              <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Users className="size-3.5 text-purple-400" />
                    Collective Team Hours ({selectedProject.teamAllocations.length > 0 ? `${selectedProject.teamAllocations.length} Members` : `${selectedProject.plannedTeamSize} FTE`})
                  </p>
                  <span className="text-[11px] font-mono text-purple-300/90">
                    {selectedProject.hourlyBurnRate > 0
                      ? `${formatCurrency(selectedProject.hourlyBurnRate, displayCurrency)}/hr overhead burn`
                      : 'Concurrency-split effort'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block">Team Planned</span>
                    <strong className="text-white tabular-nums block">
                      {selectedProject.plannedHours > 0 ? `${selectedProject.plannedHours.toFixed(0)}h` : 'Open'}
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      {selectedProject.budgetedHours ? 'Manual hours cap' : 'All members combined'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Team Used So Far</span>
                    <strong className="text-purple-300 tabular-nums block">
                      {selectedProject.elapsedHours.toFixed(1)}h
                    </strong>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {selectedProject.plannedHours > 0
                        ? `${Math.round((selectedProject.elapsedHours / selectedProject.plannedHours) * 100)}% of team plan`
                        : 'Cumulative effort'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Team Remaining</span>
                    <strong className="text-slate-200 tabular-nums block">
                      {selectedProject.plannedHours > 0 ? `${selectedProject.remainingHours.toFixed(0)}h` : '—'}
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      Est. remaining effort
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Team Overrun</span>
                    <strong className={`tabular-nums block ${selectedProject.overrunHours > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedProject.overrunHours > 0 ? `+${selectedProject.overrunHours.toFixed(1)}h` : '0h'}
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      {selectedProject.overrunHours > 0 ? 'Past deadline' : 'Within plan'}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Sum of all assigned members&apos; scheduled hours (automatically split across concurrent projects, capped at 160h/month per person).
                </p>
              </div>

              {/* Cost Breakdown */}
              <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cost Breakdown</p>
                {selectedProject.initialBaselineCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-300">Opening baseline cost</span>
                    <span className="text-white font-medium tabular-nums">
                      {formatCurrency(selectedProject.initialBaselineCost, displayCurrency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-300">Direct project expenses</span>
                  <span className="text-white font-medium tabular-nums">
                    {formatCurrency(selectedProject.directCost, displayCurrency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Shared department overhead</span>
                  <span className="text-white font-medium tabular-nums">
                    {formatCurrency(selectedProject.assignedOverhead, displayCurrency)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-800 font-semibold">
                  <span className="text-white">Total Actual Cost</span>
                  <span className="text-rose-400 tabular-nums">
                    {formatCurrency(selectedProject.actualCost, displayCurrency)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 pt-1">
                  Fixed employee salaries remain under Department Payroll and are excluded from project cost.
                </p>
              </div>

              {/* Assigned Team */}
              {selectedProject.teamAllocations.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Assigned Team Breakdown ({selectedProject.teamAllocations.length})
                    </p>
                    <span className="text-[11px] font-mono text-purple-300">
                      Total: {selectedProject.elapsedHours.toFixed(1)}h used
                      {selectedProject.plannedHours > 0 ? ` / ${selectedProject.plannedHours.toFixed(0)}h planned` : ''}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedProject.teamAllocations.map(member => (
                      <div
                        key={member.userId}
                        className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-white font-medium flex items-center gap-2">
                            {member.name}
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono text-[10px]">
                              {member.allocationSharePct}%
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {member.departmentName || 'Department'} · Assigned from {formatDate(member.assignedFrom)}
                          </p>
                        </div>
                        <div className="text-right font-mono shrink-0">
                          <span className="text-purple-300 font-bold block">
                            {member.elapsedHours.toFixed(1)}h
                            {member.plannedHours > 0 && (
                              <span className="text-slate-400 font-normal"> / {member.plannedHours.toFixed(0)}h</span>
                            )}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {member.overrunHours > 0
                              ? `+${member.overrunHours.toFixed(1)}h overrun · Dept salary`
                              : 'Used / Planned · Dept salary'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Linked Transactions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Linked Transactions ({selectedProject.transactionCount})
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailsDialogOpen(false);
                      handleOpenTransactions(selectedProject.id);
                    }}
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                  >
                    View all transactions
                  </button>
                </div>
                {selectedProject.transactions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">No direct transactions tagged to this project yet.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {selectedProject.transactions.map(t => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg flex items-center justify-between text-xs bg-slate-900/60 border border-slate-800"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="text-white font-medium truncate">{t.narration || t.description}</p>
                          <p className="text-[11px] text-slate-400">{formatDate(t.date)}</p>
                        </div>
                        <span className={`font-mono font-bold shrink-0 ${t.type === 'credit' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.type === 'credit' ? '+' : '−'}
                          {formatCurrency(Math.abs(t.amount), t.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDetailsDialogOpen(false);
                    handleOpenTransactions(selectedProject.id);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 cursor-pointer"
                >
                  <Receipt className="size-4" />
                  Open Transactions
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsDialogOpen(false)}
                  className="px-6 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
                  style={AXIOM.buttons.secondary}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Complete Project Modal (Locks exact completion date so overdue clock stops) */}
      <Dialog open={Boolean(completingProject)} onOpenChange={open => { if (!open) setCompletingProject(null); }}>
        <DialogContent
          className="sm:max-w-md text-white"
          style={{ background: '#0b1120', border: AXIOM.containers.list.border }}
        >
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-400" />
              Complete Project &amp; Lock Deadline
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Lock the actual completion date so schedule hours and overhead stop accruing immediately.
            </DialogDescription>
          </DialogHeader>

          {completingProject && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                <p className="text-sm font-semibold text-white">{completingProject.name}</p>
                <p className="text-xs text-slate-400">
                  Started {formatDate(completingProject.startDate)}
                  {completingProject.endDate ? ` · Deadline ${formatDate(completingProject.endDate)}` : ''}
                </p>
              </div>

              <div>
                <label className="text-white text-sm font-medium mb-1.5 block">Actual Completion Date *</label>
                <input
                  type="date"
                  value={completionDateInput}
                  min={completingProject.startDate?.slice(0, 10)}
                  onChange={e => setCompletionDateInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                />
                {completingProject.endDate && (
                  <button
                    type="button"
                    onClick={() => setCompletionDateInput(completingProject.endDate!.slice(0, 10))}
                    className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                  >
                    Use planned deadline ({formatDate(completingProject.endDate)})
                  </button>
                )}
              </div>

              {completePreview && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs font-mono space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-300">Project Schedule Elapsed:</span>
                    <strong className="text-cyan-300">
                      {completePreview.projectScheduleElapsedHours.toFixed(0)}h ({completePreview.elapsedBusinessDays} workdays)
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-300">Collective Team Hours:</span>
                    <strong className="text-emerald-300">
                      {completePreview.elapsedHours.toFixed(0)}h total
                    </strong>
                  </div>
                  {completePreview.projectSchedulePlannedHours > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-300">vs Deadline ({completePreview.projectSchedulePlannedHours.toFixed(0)}h / {completePreview.plannedBusinessDays}d):</span>
                      <strong className={completePreview.projectScheduleOverrunHours > 0 ? 'text-rose-400' : 'text-emerald-300'}>
                        {completePreview.projectScheduleOverrunHours > 0
                          ? `+${completePreview.projectScheduleOverrunHours.toFixed(0)}h overdue`
                          : `Finished ${Math.max(0, completePreview.projectSchedulePlannedHours - completePreview.projectScheduleElapsedHours).toFixed(0)}h early`}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCompletingProject(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
                  style={AXIOM.buttons.secondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isCompleting}
                  onClick={() => void handleConfirmComplete()}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isCompleting ? 'Locking…' : 'Lock & Complete'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New / Edit Project Modal (With Deadline Tracking, Hours Cap, Opening Cost, Committed Cost Left, Assign Team & Live Preview) */}
      <Dialog open={formDialogOpen} onOpenChange={setFormDialogOpen}>
        <DialogContent
          className="sm:max-w-2xl text-white max-h-[90vh] overflow-y-auto"
          style={{ background: '#0b1120', border: AXIOM.containers.list.border }}
        >
          <DialogHeader>
            <DialogTitle className="text-white">
              {editingProjectId ? 'Edit project' : 'New project'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Set the deadline and budget so the system automatically calculates overdue costs and alerts you if the project enters loss.
            </DialogDescription>
          </DialogHeader>

          {departments.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">
              You need at least one department before creating a project. Add departments in your organization setup, then try again.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Row 1: Name & Client */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Project name *</label>
                  <input
                    value={projectForm.name}
                    onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Client website rebuild"
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Client *</label>
                  <input
                    value={projectForm.clientName}
                    onChange={e => setProjectForm(f => ({ ...f, clientName: e.target.value }))}
                    placeholder="Client name"
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
              </div>

              {/* Row 2: Code, Department, Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Code (optional)</label>
                  <input
                    value={projectForm.code}
                    onChange={e => setProjectForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="Auto-filled"
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Department *</label>
                  <Select value={projectForm.departmentId} onValueChange={v => setProjectForm(f => ({ ...f, departmentId: v }))}>
                    <SelectTrigger className="w-full text-white" style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent style={{ background: '#0f172a', border: AXIOM.containers.list.border }}>
                      {departments.map(d => (
                        <SelectItem key={d.id} value={d.id} className="text-white">
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Status</label>
                  <Select value={projectForm.status} onValueChange={v => setProjectForm(f => ({ ...f, status: v as ServiceProject['status'] }))}>
                    <SelectTrigger className="w-full text-white" style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: '#0f172a', border: AXIOM.containers.list.border }}>
                      <SelectItem value="quoted" className="text-white">Quoted</SelectItem>
                      <SelectItem value="active" className="text-white">Active</SelectItem>
                      <SelectItem value="on_hold" className="text-white">On hold</SelectItem>
                      <SelectItem value="completed" className="text-white">Completed</SelectItem>
                      <SelectItem value="cancelled" className="text-white">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 3: Start Date, Deadline, Hours Cap */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Start Date *</label>
                  <input
                    type="date"
                    value={projectForm.startDate}
                    onChange={e => setProjectForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">End Date (Deadline)</label>
                  <input
                    type="date"
                    value={projectForm.endDate}
                    onChange={e => setProjectForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                {projectForm.status === 'completed' ? (
                  <div>
                    <label className="text-slate-200 text-xs font-medium mb-1.5 block">Completed Date</label>
                    <input
                      type="date"
                      value={projectForm.completedAt || todayYmdCalendar()}
                      onChange={e => setProjectForm(f => ({ ...f, completedAt: e.target.value }))}
                      className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-slate-200 text-xs font-medium mb-1.5 block">Hours Cap (Optional)</label>
                    <input
                      type="number"
                      min={0}
                      value={projectForm.budgetedHours}
                      onChange={e => setProjectForm(f => ({ ...f, budgetedHours: e.target.value }))}
                      placeholder="Auto from dates"
                      className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm font-mono"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                )}
              </div>

              {/* Row 4: Quoted Amount, Opening Baseline Cost, Committed Cost Left */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Quoted Amount *</label>
                  <input
                    type="number"
                    min={0}
                    value={projectForm.quotedAmount}
                    onChange={e => setProjectForm(f => ({ ...f, quotedAmount: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm font-mono"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Opening Baseline Cost</label>
                  <input
                    type="number"
                    min={0}
                    value={projectForm.actualCost}
                    onChange={e => setProjectForm(f => ({ ...f, actualCost: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm font-mono"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="text-slate-200 text-xs font-medium mb-1.5 block">Committed Cost Left</label>
                  <input
                    type="number"
                    min={0}
                    value={projectForm.committedRemainingWork}
                    onChange={e => setProjectForm(f => ({ ...f, committedRemainingWork: e.target.value }))}
                    placeholder="Optional remaining cost"
                    className="w-full px-3.5 py-2.5 rounded-xl text-white text-sm font-mono"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
              </div>

              {/* Assign Team Members (tracks deadline hours & shared overhead; fixed salaries excluded) */}
              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-white flex items-center gap-1.5">
                      <Users className="size-4 text-cyan-400" />
                      Assign Team Members (Schedule &amp; Deadline Tracking)
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Used to track Mon–Fri deadline hours &amp; shared overhead. Fixed salaries stay in Dept Payroll.
                    </p>
                  </div>
                  {draftAssignments.length === 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">Fallback FTEs:</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={projectForm.plannedTeamSize}
                        onChange={e => setProjectForm(f => ({ ...f, plannedTeamSize: e.target.value }))}
                        className="w-16 px-2 py-1 rounded-lg text-white text-xs font-mono text-center"
                        style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                      />
                    </div>
                  )}
                </div>

                {activeOrgMembers.length === 0 ? (
                  <p className="text-xs text-slate-500">No active members found. Using department baseline FTE.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                    {activeOrgMembers.map((mem: any) => {
                      const uid = String(mem.userId || mem.user_id || mem.id);
                      const info = memberInfoById.get(uid);
                      const selected = draftAssignments.find(a => a.userId === uid);
                      return (
                        <div
                          key={uid}
                          className={`p-2.5 rounded-lg border transition-colors ${
                            selected ? 'bg-cyan-500/10 border-cyan-500/35' : 'bg-slate-950/50 border-slate-800/80'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <label className="flex items-center gap-2.5 text-xs text-white cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={Boolean(selected)}
                                onChange={() => toggleMemberAssignment(uid)}
                                className="rounded accent-cyan-500"
                              />
                              <span className="font-medium truncate">{info?.name || 'Member'}</span>
                              <span className="text-[11px] text-slate-400 truncate">
                                {info?.department ? `· ${info.department}` : '· Department Staff'}
                              </span>
                            </label>
                            {selected && (
                              <div className="flex items-center gap-2 text-[11px]">
                                <input
                                  type="date"
                                  value={selected.assignedFrom}
                                  onChange={e => updateDraftAssignment(uid, { assignedFrom: e.target.value })}
                                  title="Assignment start date"
                                  className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px]"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={selected.allocationPct}
                                  onChange={e => updateDraftAssignment(uid, { allocationPct: e.target.value })}
                                  placeholder="Auto %"
                                  title="Optional allocation % (blank = automatic equal split)"
                                  className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px] font-mono"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Live Schedule, Overhead & Loss Preview */}
              <div
                className={`p-4 rounded-xl border text-xs space-y-2.5 ${
                  (liveFormPreview.projectedMarginPct ?? 0) < 0
                    ? 'bg-rose-500/10 border-rose-500/35'
                    : 'bg-cyan-500/10 border-cyan-500/30'
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className={(liveFormPreview.projectedMarginPct ?? 0) < 0 ? 'text-rose-300' : 'text-cyan-300'}>
                    Live Schedule, Overhead &amp; Loss Preview
                  </span>
                  <span className="font-mono text-[11px] text-slate-300">
                    {draftAssignments.length > 0 ? `${draftAssignments.length} staff assigned` : `${projectForm.plannedTeamSize || 1} FTE baseline`}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Project Schedule</span>
                    <strong className="text-white tabular-nums block">
                      {liveFormPreview.projectSchedulePlannedHours > 0 ? `${liveFormPreview.projectSchedulePlannedHours.toFixed(0)}h` : 'Open'}
                    </strong>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {liveFormPreview.plannedBusinessDays > 0 ? `${liveFormPreview.plannedBusinessDays} workdays` : 'No deadline'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Collective Team</span>
                    <strong className="text-purple-300 tabular-nums block">
                      {liveFormPreview.plannedHours > 0 ? `${liveFormPreview.plannedHours.toFixed(0)}h` : 'Open'}
                    </strong>
                    <span className="text-[10px] text-slate-400">
                      {draftAssignments.length > 0 ? `${draftAssignments.length} members` : `${projectForm.plannedTeamSize || 1} FTE`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Est. Shared Overhead</span>
                    <strong className="text-white tabular-nums">{formatCurrency(liveFormPreview.estimatedPlannedLaborCost, displayCurrency)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Est. Margin</span>
                    <strong className={`tabular-nums ${(liveFormPreview.projectedMarginPct ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {liveFormPreview.projectedMarginPct != null ? `${liveFormPreview.projectedMarginPct.toFixed(1)}%` : '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Budget Runs Out</span>
                    <strong className="text-amber-300 tabular-nums">
                      {liveFormPreview.breakEvenDate ? formatDate(liveFormPreview.breakEvenDate) : '—'}
                    </strong>
                  </div>
                </div>
                {(liveFormPreview.projectedMarginPct ?? 0) < 0 && (
                  <p className="text-[11px] text-rose-300 font-medium flex items-center gap-1.5 pt-1">
                    <ShieldAlert className="size-3.5 shrink-0" />
                    Warning: Based on this deadline and overhead rate, this project is projected to finish in loss.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setFormDialogOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
                  style={AXIOM.buttons.secondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingForm}
                  onClick={() => void handleSaveProject()}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.55), rgba(59, 130, 246, 0.55))',
                    border: '1px solid rgba(6, 182, 212, 0.6)',
                  }}
                >
                  {isSavingForm ? 'Saving…' : editingProjectId ? 'Save changes' : 'Create project'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
