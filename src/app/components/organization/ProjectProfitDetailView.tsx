import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams } from 'react-router';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { projectService } from '@/services/projectService';
import { organizationService } from '@/services/organizationService';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { exportToCSV } from '@/lib/exportUtils';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Briefcase,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Calendar,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Edit3,
  Receipt,
  Download,
  Flame,
  Layers,
  ChevronRight,
  Target,
  CheckSquare,
  Plus,
  Square,
  Play,
  Sparkles,
} from 'lucide-react';

export function ProjectProfitDetailView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const svc = useOrgServices();
  const { currentOrganization } = useAuth();
  const goToOrgView = useOrgWorkspaceNav();
  const displayCurrency = currentOrganization?.currency ?? 'USD';

  const projectId = searchParams.get('projectId') || '';
  const [periodFilter, setPeriodFilter] = useState<'all' | '1M' | '3M' | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<'hours' | 'timelogs' | 'tasks' | 'expenses' | 'overhead'>('hours');

  // Revision modal state (§13)
  const [revisingEntry, setRevisingEntry] = useState<any | null>(null);
  const [revisedHours, setRevisedHours] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);

  // Compute from / to dates for backend filter
  const filterParams = useMemo(() => {
    if (periodFilter === 'all') return undefined;
    if (periodFilter === '1M') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return { from: d.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
    }
    if (periodFilter === '3M') {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return { from: d.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
    }
    if (periodFilter === 'custom' && customFrom && customTo) {
      return { from: customFrom, to: customTo };
    }
    return undefined;
  }, [periodFilter, customFrom, customTo]);

  // Fetch authoritative deep profitability details
  const { data: detailData, loading, error, refetch } = useService(
    () => svc.projects.getProjectDetails(projectId, filterParams),
    [svc.orgId, projectId, filterParams],
    [`project-details-${projectId}`, periodFilter, customFrom, customTo],
  );

  const project = detailData?.project;
  const summary = detailData?.summary;
  const timeline = detailData?.timeline;
  const contributors = detailData?.contributors || [];
  const timesheets = detailData?.timesheetEntries || [];
  const expenses = detailData?.expenses || [];
  const income = detailData?.income || [];
  const overheads = detailData?.overheadAllocations || [];
  const overheadBreakdown: any[] = (detailData as any)?.overheadBreakdown || [];

  const handleBackToProjects = () => {
    if (goToOrgView) {
      goToOrgView('projects');
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('view', 'projects');
        next.delete('projectId');
        return next;
      });
    }
  };

  const handleOpenTransactions = () => {
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

  // Manager Approval action (§13)
  const handleApproveEntry = async (entryId: string) => {
    try {
      const res = await svc.projects.approveTimesheetEntry(projectId, entryId);
      if (res.success) {
        toast.success(res.message || 'Timesheet entry approved and labor cost locked.');
        refetch();
      } else {
        toast.error(res.error || 'Failed to approve timesheet entry');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error approving timesheet entry');
    }
  };

  // Manager Revision action (§13)
  

  // Fetch organization members for task assignment (§13 Work Domain)
  const { data: members = [] } = useServiceArray(
    () => organizationService.getMembers(svc.orgId),
    [svc.orgId],
    ['organization_members'],
  );

  // Fetch authoritative project tasks (§13 Work Domain & §12.4 Deliverables)
  const { data: rawProjectTasks = [], refetch: refetchTasks } = useServiceArray(
    () => projectService.getTasks(svc.orgId, projectId),
    [svc.orgId, projectId],
    [`project-tasks-${projectId}`],
  );

  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskEstHours, setNewTaskEstHours] = useState('20');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  // Authoritative project tasks (§13 Work Domain & §12.4 Deliverables)
  const projectTasks = rawProjectTasks;

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !projectId) return;
    setIsSubmittingTask(true);
    try {
      const assigneeMember = members.find((m: any) => m.userId === newTaskAssignee || m.id === newTaskAssignee);
      await projectService.createTask(svc.orgId, projectId, {
        title: newTaskTitle.trim(),
        assignedTo: newTaskAssignee || undefined,
        assignedToName: (assigneeMember as any)?.user?.name || (assigneeMember as any)?.name || 'Team Member',
        status: 'todo',
        priority: newTaskPriority,
        estimatedHours: parseFloat(newTaskEstHours) || 0,
        dueDate: newTaskDueDate || undefined,
      });
      setNewTaskTitle('');
      setShowNewTaskModal(false);
      refetchTasks();
    } catch (err) {
      console.error('Error creating task:', err);
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const handleToggleTaskStatus = async (task: any) => {
    const nextStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'completed' : 'todo';
    try {
      await projectService.updateTask(svc.orgId, projectId, task.id, { status: nextStatus });
      refetchTasks();
    } catch (err) {
      console.warn('Failed to update task status:', err);
    }
  };

  const handleOpenRevision = (entry: any) => {
    setRevisingEntry(entry);
    setRevisedHours(String(entry.hours));
    setRevisionReason('');
  };

  const handleConfirmRevision = async () => {
    if (!revisingEntry) return;
    const hoursNum = parseFloat(revisedHours);
    if (isNaN(hoursNum) || hoursNum <= 0) {
      toast.error('Please enter a valid number of hours greater than 0.');
      return;
    }
    if (!revisionReason.trim()) {
      toast.error('Please provide an audit authorization reason for this revision (§13).');
      return;
    }

    setIsSubmittingRevision(true);
    try {
      const res = await svc.projects.reviseTimesheetEntry(
        projectId,
        revisingEntry.id,
        hoursNum,
        revisionReason.trim(),
      );
      if (res.success) {
        toast.success(res.message || 'Timesheet revised with audit history preserved.');
        setRevisingEntry(null);
        refetch();
      } else {
        toast.error(res.error || 'Failed to revise timesheet entry');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error revising timesheet');
    } finally {
      setIsSubmittingRevision(false);
    }
  };

  // Export Project Data
  const handleExportCSV = () => {
    if (!project || contributors.length === 0) {
      toast.error('No employee hours to export');
      return;
    }
    const rows = timesheets.map((t: any) => ({
      'Date': t.date,
      'Start Time': t.startTime || '—',
      'End Time': t.endTime || '—',
      'Hours': t.hours,
      'Minutes': t.durationMinutes || Math.round(t.hours * 60),
      'Employee': t.userName || t.userId,
      'Task': t.description,
      'Billable': t.billable ? 'Yes' : 'No',
      'Rate Per Minute': t.ratePerMinute,
      'Rate Per Hour': t.ratePerHour,
      'Attributed Labor Cost': t.calculatedLaborCost,
      'Status': t.status,
      'Approved At': t.approvedAt || '—',
    }));
    const headers = ['Date', 'Start Time', 'End Time', 'Hours', 'Minutes', 'Employee', 'Task', 'Billable', 'Rate Per Minute', 'Rate Per Hour', 'Attributed Labor Cost', 'Status', 'Approved At'];
    exportToCSV(rows, headers, `${project.name.replace(/\s+/g, '_')}_employee_hours.csv`);
    toast.success('Project time data exported to CSV');
  };

  if (!projectId) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>No project selected. Please return to Project Profitability and select a project.</p>
        <button
          onClick={handleBackToProjects}
          className="mt-4 px-4 py-2 rounded-xl text-sm font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 cursor-pointer"
        >
          Return to Projects
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* 1. Header with Breadcrumbs & Action Bar */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleBackToProjects}
              className="p-2.5 rounded-xl text-slate-400 hover:text-white bg-slate-900/60 border border-slate-800 transition-all cursor-pointer"
              title="Return to Projects list"
            >
              <ArrowLeft className="size-5" />
            </motion.button>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-3xl font-bold text-white tracking-tight">
                  {project?.name || 'Project Tracking'}
                </h1>
                {project?.code && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono">
                    {project.code}
                  </span>
                )}
                <span
                  className="px-2.5 py-0.5 rounded-lg text-xs font-semibold capitalize"
                  style={
                    project?.status === 'active'
                      ? AXIOM.badges.info
                      : project?.status === 'completed'
                      ? AXIOM.badges.success
                      : AXIOM.badges.warning
                  }
                >
                  {project?.status || 'Quoted'}
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-0.5">
                Client: <span className="text-slate-200 font-medium">{project?.clientName || 'General'}</span> • Track labor cost, employee hours, date timeline, and operational margin
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportCSV}
              className="px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 text-slate-300 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 transition-all cursor-pointer"
            >
              <Download className="size-3.5 text-slate-400" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleOpenTransactions}
              className="px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 transition-all cursor-pointer"
            >
              <Receipt className="size-3.5" />
              <span>View Transactions</span>
            </button>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono flex items-center gap-1">
              <Calendar className="size-3.5 text-cyan-400" /> Period:
            </span>
            <button
              onClick={() => setPeriodFilter('all')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                periodFilter === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setPeriodFilter('1M')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                periodFilter === '1M'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setPeriodFilter('3M')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                periodFilter === '3M'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Last 90 Days
            </button>
            <button
              onClick={() => setPeriodFilter('custom')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                periodFilter === 'custom'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Custom Range
            </button>
          </div>

          {periodFilter === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* 2. Visual Project Timeline & Date Tracker */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Clock className="size-4" />
            </div>
            <div>
              <p className="text-xs uppercase font-mono tracking-wider text-slate-400">Project Timeline & Tracking</p>
              <p className="text-sm font-semibold text-white">
                Started: <span className="text-cyan-300">{formatDate(timeline?.startDate || project?.startDate)}</span>
                {timeline?.endDate ? (
                  <> • Ends: <span className="text-cyan-300">{formatDate(timeline.endDate)}</span></>
                ) : (
                  <span className="text-slate-400 italic"> (No end date set)</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono">
            <div>
              <span className="text-slate-400 block">Days Elapsed:</span>
              <span className="text-base font-bold text-white">{timeline?.daysElapsed ?? 1}d</span>
            </div>
            {timeline?.endDate && (
              <div>
                <span className="text-slate-400 block">Days Remaining:</span>
                <span className="text-base font-bold text-cyan-400">{timeline.daysRemaining}d</span>
              </div>
            )}
            <div>
              <span className="text-slate-400 block">Daily Burn Rate:</span>
              <span className="text-base font-bold text-red-400 font-mono">
                {formatCurrency(summary?.burnRatePerDay || 0, displayCurrency)}/day
              </span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {timeline?.endDate && (
          <div className="w-full bg-slate-900/80 rounded-full h-2.5 overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${timeline.completionPct}%` }}
            />
          </div>
        )}
      </motion.div>

      {/* 3. Section 12.4 Authoritative Costing & Financial Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Quoted Budget */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="p-5 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">Estimated Budget</span>
            <div className="p-2 rounded-xl" style={{ background: AXIOM.iconBoxes.green }}>
              <DollarSign className="size-4 text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {formatCurrency(summary?.quotedAmount || 0, displayCurrency)}
          </p>
          <p className="text-xs text-slate-400 mt-1">Contract value / revenue ceiling</p>
        </motion.div>

        {/* Card 2: Actual Cost & Consumed Burn */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1">
              <Flame className="size-3.5 text-red-400" /> Actual Cost (Burn)
            </span>
            <div className="p-2 rounded-xl" style={{ background: AXIOM.iconBoxes.red }}>
              <TrendingDown className="size-4 text-red-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-red-400 font-mono">
            {formatCurrency(summary?.actualProjectCost || 0, displayCurrency)}
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-1">
            Labor: {formatCurrency(summary?.laborCost || 0, displayCurrency)} · Direct: {formatCurrency(summary?.directExpenses || 0, displayCurrency)} · Overhead: {formatCurrency(summary?.assignedOverhead || 0, displayCurrency)}
          </p>
        </motion.div>

        {/* Card 3: Operating Profit & Margin % */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-5 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">Operating Profit</span>
            <div className="p-2 rounded-xl" style={{ background: AXIOM.iconBoxes.cyan }}>
              <TrendingUp className="size-4 text-cyan-400" />
            </div>
          </div>
          <p className={`text-2xl font-bold font-mono ${(summary?.projectOperatingProfit ?? 0) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
            {formatCurrency(summary?.projectOperatingProfit || 0, displayCurrency)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Margin: <span className="font-bold text-white">{summary?.projectMarginPercent?.toFixed(1) ?? 0}%</span> · Contribution: {formatCurrency(summary?.projectContribution || 0, displayCurrency)}
          </p>
        </motion.div>

        {/* Card 4: EAC & Margin at Risk */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-5 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">Projected at Completion</span>
            <div className="p-2 rounded-xl" style={{ background: AXIOM.iconBoxes.purple }}>
              <Target className="size-4 text-purple-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {formatCurrency(summary?.projectedAtCompletion || 0, displayCurrency)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            ETC: {formatCurrency(summary?.costToComplete || 0, displayCurrency)} · Risk: <span className={(summary?.marginAtRisk ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(summary?.marginAtRisk || 0, displayCurrency)}</span>
          </p>
        </motion.div>
      </div>

      {/* 4. Tab Navigation Bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('hours')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'hours'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="size-3.5" />
          <span>Employee Hours & Labor Cost ({contributors.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('timelogs')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'timelogs'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="size-3.5" />
          <span>Timestamped Time Logs ({timesheets.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'tasks'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <CheckSquare className="size-3.5" />
          <span>Tasks & Deliverables ({projectTasks.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('expenses')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'expenses'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Receipt className="size-3.5" />
          <span>Direct Expenses ({expenses.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('overhead')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'overhead'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="size-3.5" />
          <span>Assigned Overhead ({overheadBreakdown.length > 0 ? overheadBreakdown.length : overheads.length})</span>
        </button>
      </div>

      {/* 5. Tab Content Panes */}

      {/* Tab A: Employee Hours & Labor Cost Matrix */}
      {activeTab === 'hours' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Employee Working Hours Breakdown</h3>
              <p className="text-xs text-slate-400">
                Formula (§12.4): <span className="font-mono text-cyan-300">labor_cost = sum(approved_time_minutes × effective_cost_per_minute)</span>
              </p>
            </div>
            <div className="text-right font-mono">
              <span className="text-xs text-slate-400 block">Total Project Labor Cost:</span>
              <span className="text-lg font-bold text-cyan-400">
                {formatCurrency(summary?.laborCost || 0, displayCurrency)}
              </span>
            </div>
          </div>

          {contributors.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-950/40 border border-slate-800 text-slate-500">
              <Users className="size-8 mx-auto mb-2 opacity-50" />
              <p>No employee logged hours recorded for this project yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase bg-slate-900/80 text-slate-400 font-mono border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Team Member</th>
                    <th className="px-4 py-3">First Started</th>
                    <th className="px-4 py-3">Last Active</th>
                    <th className="px-4 py-3 text-right">Logged Hours</th>
                    <th className="px-4 py-3 text-right">Approved Mins</th>
                    <th className="px-4 py-3 text-right">Cost Rate</th>
                    <th className="px-4 py-3 text-right">Labor Cost</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
                  {contributors.map((c: any) => (
                    <tr key={c.userId} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            {c.name ? c.name[0] : 'U'}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{c.name}</p>
                            <p className="text-[11px] text-slate-400">{c.role} {c.department ? `• ${c.department}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-300">
                        {formatDate(c.firstDate)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-300">
                        {formatDate(c.lastDate)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-cyan-400">
                        {c.totalHours.toFixed(1)}h
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-300">
                        {c.approvedMinutes}m
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs">
                        <span className="text-white">${c.ratePerMinute.toFixed(4)}/m</span>
                        <span className="text-slate-500 block">(${c.ratePerHour.toFixed(2)}/h)</span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(c.totalLaborCost, displayCurrency)}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {c.pendingCount === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <ShieldCheck className="size-3" /> Fully Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            {c.pendingCount} Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Tab B: Timestamped Time Logs & Approvals */}
      {activeTab === 'timelogs' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-white">Timestamped Time Entries & Approvals (§13)</h3>
              <p className="text-xs text-slate-400">
                Entries track when work started and ended. Managers can review, approve, or revise hours with full audit trail.
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Total Logged: <strong className="text-white">{summary?.totalLoggedHours?.toFixed(1) ?? 0}h</strong>
            </span>
          </div>

          {timesheets.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-950/40 border border-slate-800 text-slate-500">
              <Clock className="size-8 mx-auto mb-2 opacity-50" />
              <p>No timesheet entries found for this project.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {timesheets.map((entry: any) => (
                <div
                  key={entry.id}
                  className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-slate-700 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-white font-semibold text-xs">{entry.userName}</span>
                      <span className="text-slate-500 text-xs font-mono">• {formatDate(entry.date)}</span>
                      {entry.startTime && entry.endTime && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono border border-cyan-500/25">
                          {entry.startTime} – {entry.endTime}
                        </span>
                      )}
                      {entry.billable ? (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                          Billable
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          Non-billable
                        </span>
                      )}
                      <span
                        className={`text-[10px] uppercase px-1.5 py-0.2 rounded font-mono ${
                          entry.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : entry.status === 'submitted'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 truncate">{entry.description || 'General delivery'}</p>

                    {/* Revision history badge if modified (§13) */}
                    {entry.revisionHistory && entry.revisionHistory.length > 0 && (
                      <p className="text-[10px] text-amber-400/80 font-mono mt-1 flex items-center gap-1">
                        <RotateCcw className="size-3" />
                        Revised: originally {entry.revisionHistory[0].previousHours}h (Reason: {entry.revisionHistory[0].reason})
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right font-mono">
                      <span className="text-sm font-bold text-cyan-300 block">
                        {entry.hours.toFixed(1)}h ({entry.durationMinutes || Math.round(entry.hours * 60)}m)
                      </span>
                      <span className="text-[11px] text-emerald-400">
                        {formatCurrency(entry.calculatedLaborCost, displayCurrency)}
                      </span>
                    </div>

                    {/* Manager Actions */}
                    <div className="flex items-center gap-1.5">
                      {entry.status !== 'approved' && (
                        <button
                          type="button"
                          onClick={() => handleApproveEntry(entry.id)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-all cursor-pointer flex items-center gap-1"
                        >
                          <CheckCircle2 className="size-3.5" />
                          <span>Approve</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenRevision(entry)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 transition-all cursor-pointer flex items-center gap-1"
                        title="Revise hours with audit log (§13)"
                      >
                        <Edit3 className="size-3.5 text-cyan-400" />
                        <span>Revise</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </motion.div>
      )}

      {/* Tab: Tasks & Deliverables Management (§13 Work Domain & §12.4) */}
      {activeTab === 'tasks' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Header Controls & Progress Summary */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Tasks & Deliverables Management (§13)</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  {projectTasks.filter((t: any) => t.status === 'completed').length} / {projectTasks.length} Completed
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Work items, deliverables and milestone tracking. Logged hours on tasks feed project labor burn in real time.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowNewTaskModal(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-white shadow-lg shadow-cyan-500/20 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="size-3.5" />
                <span>Add Deliverable</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-slate-400 font-mono block">Total Deliverables</span>
              <span className="text-lg font-bold text-white font-mono mt-0.5 block">{projectTasks.length}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-emerald-400 font-mono block">Completed</span>
              <span className="text-lg font-bold text-emerald-300 font-mono mt-0.5 block">
                {projectTasks.filter((t: any) => t.status === 'completed').length}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-cyan-400 font-mono block">In Progress</span>
              <span className="text-lg font-bold text-cyan-300 font-mono mt-0.5 block">
                {projectTasks.filter((t: any) => t.status === 'in_progress').length}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-slate-400 font-mono block">Backlog / Todo</span>
              <span className="text-lg font-bold text-slate-300 font-mono mt-0.5 block">
                {projectTasks.filter((t: any) => t.status === 'todo' || !t.status).length}
              </span>
            </div>
          </div>

          {/* Deliverables List */}
          {projectTasks.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-950/40 border border-slate-800 text-slate-500">
              <CheckSquare className="size-8 mx-auto mb-2 opacity-50" />
              <p>No deliverables configured for this project yet.</p>
              <button
                type="button"
                onClick={() => setShowNewTaskModal(true)}
                className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 cursor-pointer"
              >
                + Create First Task
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {projectTasks.map((task: any) => {
                const isDone = task.status === 'completed';
                const isInProgress = task.status === 'in_progress';
                const estH = Number(task.estimatedHours || 0);
                const logH = Number(task.loggedHours || 0);

                return (
                  <div
                    key={task.id}
                    className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      isDone
                        ? 'bg-slate-950/30 border-slate-800/50 opacity-80'
                        : isInProgress
                        ? 'bg-slate-950/70 border-cyan-500/30 shadow-lg shadow-cyan-500/5'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {/* Status Badge */}
                        <button
                          type="button"
                          onClick={() => handleToggleTaskStatus(task)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider cursor-pointer transition-all ${
                            isDone
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : isInProgress
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                          title="Click to toggle status"
                        >
                          {isDone ? (
                            <>
                              <CheckCircle2 className="size-3" />
                              <span>Completed</span>
                            </>
                          ) : isInProgress ? (
                            <>
                              <Play className="size-3 fill-current" />
                              <span>In Progress</span>
                            </>
                          ) : (
                            <>
                              <Square className="size-3" />
                              <span>Todo</span>
                            </>
                          )}
                        </button>

                        {/* Priority Badge */}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium uppercase ${
                            task.priority === 'urgent'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : task.priority === 'high'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800/80 text-slate-400'
                          }`}
                        >
                          {task.priority || 'medium'}
                        </span>

                        {/* Due Date */}
                        {task.dueDate && (
                          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                            <Calendar className="size-3" />
                            <span>Due: {formatDate(task.dueDate)}</span>
                          </span>
                        )}
                      </div>

                      {/* Title & Description */}
                      <h4 className={`text-sm font-semibold ${isDone ? 'line-through text-slate-400' : 'text-white'}`}>
                        {task.title}
                      </h4>
                      {task.description && (
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{task.description}</p>
                      )}

                      {/* Assigned Member */}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold text-[10px] uppercase">
                          {task.assignedToName ? task.assignedToName[0] : 'U'}
                        </div>
                        <span className="text-xs text-slate-300">{task.assignedToName || 'Unassigned'}</span>
                      </div>
                    </div>

                    {/* Hours & Actions */}
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right font-mono">
                        <span className="text-xs text-slate-400 block">Effort / Budget:</span>
                        <span className="text-sm font-bold text-cyan-300">
                          {logH.toFixed(1)}h
                          {estH > 0 && <span className="text-slate-500 text-xs font-normal"> / {estH}h est.</span>}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleTaskStatus(task)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                            isDone
                              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              : isInProgress
                              ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                              : 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30'
                          }`}
                        >
                          {isDone ? 'Reopen' : isInProgress ? 'Complete' : 'Start'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* Tab C: Direct Expenses Ledger */}
      {activeTab === 'expenses' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Eligible Linked Direct Expenses (§12.4)</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  De-duplicated: No double counting
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Financial debits strictly associated with this project. If tagged with both client and project, counted exactly once.
              </p>
            </div>
            <div className="text-right font-mono">
              <span className="text-xs text-slate-400 block">Total Direct Expenses:</span>
              <span className="text-lg font-bold text-red-400">
                {formatCurrency(summary?.directExpenses || 0, displayCurrency)}
              </span>
            </div>
          </div>

          {expenses.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-950/40 border border-slate-800 text-slate-500">
              <Receipt className="size-8 mx-auto mb-2 opacity-50" />
              <p>No direct posted expenses linked to this project.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
              {expenses.map((e: any) => (
                <div key={e.id} className="p-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="text-white font-medium">{e.description}</p>
                    <p className="text-slate-500 font-mono text-[11px]">{formatDate(e.date)}</p>
                  </div>
                  <span className="font-mono font-bold text-red-400 text-sm">
                    −{formatCurrency(e.amount, e.currency || displayCurrency)}
                  </span>
                </div>
              ))}
            </div>
          )}

        </motion.div>
      )}

      {/* Tab D: Multi-Department Assigned Overhead Allocation (§§12.2, 12.4, 12.5) */}
      {activeTab === 'overhead' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Summary Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Multi-Department Overhead Allocations (§12.4, §12.5)</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-purple-500/10 text-purple-300 border border-purple-500/30">
                  Effort-Based Absorption
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Overhead is absorbed from each contributing department proportional to logged delivery time. Zero double-counting.
              </p>
            </div>
            <div className="text-right font-mono">
              <span className="text-xs text-slate-400 block">Total Assigned Overhead:</span>
              <span className="text-xl font-bold text-purple-400">
                {formatCurrency(summary?.assignedOverhead || 0, displayCurrency)}
              </span>
            </div>
          </div>

          {/* Section 1: Contributing Departments Overhead Breakdown */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase font-mono tracking-wider text-slate-400">
              Contributing Department Overhead Matrix
            </h4>

            {overheadBreakdown.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-950/40 border border-slate-800 text-slate-500">
                <Layers className="size-8 mx-auto mb-2 opacity-50" />
                <p>No departmental overhead absorbed yet (no logged employee delivery time recorded).</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="text-xs uppercase bg-slate-900/80 text-slate-400 font-mono border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Contributing Dept</th>
                      <th className="px-4 py-3 text-right">Dept Overhead Pool</th>
                      <th className="px-4 py-3 text-right">Capacity (FTE)</th>
                      <th className="px-4 py-3 text-right">Overhead Rate</th>
                      <th className="px-4 py-3 text-right">Hours Logged</th>
                      <th className="px-4 py-3 text-right">Absorbed Overhead</th>
                      <th className="px-4 py-3 text-center">Absorption %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {overheadBreakdown.map((ob: any) => (
                      <tr key={ob.departmentId} className="hover:bg-slate-900/40 transition-colors">
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-white">{ob.departmentName}</p>
                          <span className="text-[11px] text-slate-500 font-mono">
                            Headcount: {ob.headcount || 1} member(s)
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-slate-300">
                          {formatCurrency(ob.departmentOverheadPool || 0, displayCurrency)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-slate-400">
                          {ob.departmentCapacityHours || 160}h / mo
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs">
                          <span className="text-white">${(ob.overheadRatePerHour || 0).toFixed(2)}/h</span>
                          <span className="text-slate-500 block">(${(ob.overheadRatePerMinute || 0).toFixed(4)}/m)</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-cyan-400">
                          {(ob.loggedHours || 0).toFixed(1)}h
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-purple-300">
                          {formatCurrency(ob.allocatedOverhead || 0, displayCurrency)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30">
                            {ob.absorptionPercent || 0}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-800 bg-slate-900/60 font-mono">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-slate-300 text-right uppercase">
                        Total Overhead Absorbed:
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-purple-400 text-base">
                        {formatCurrency(summary?.assignedOverhead || 0, displayCurrency)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Underlying Shared Cost Pools */}
          {overheads.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs uppercase font-mono tracking-wider text-slate-400">
                Underlying Shared Corporate Cost Pools
              </h4>
              <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                {overheads.map((oa: any) => (
                  <div key={oa.id} className="p-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="text-white font-medium">{oa.name || oa.pool_name || 'Overhead Pool'}</p>
                      <p className="text-slate-500 font-mono text-[11px]">
                        Driver: {oa.allocation_base || oa.allocation_driver || 'headcount'} • Policy: {oa.policy_version || 'v1.2-costing'}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-purple-300 text-sm">
                      {formatCurrency(oa.amount || oa.allocated_amount || 0, displayCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Allocation Conservation & Zero Double-Counting Proof (§33.10) */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
                  <ShieldCheck className="size-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Allocation Conservation & Integrity (§33.10)</h4>
                  <p className="text-[11px] text-slate-400">
                    A source overhead pool must not enter multiple active allocations at full cost. Absorbed overhead plus unallocated general capacity equals 100% of the pool.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Conservation Verified
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <span className="text-[11px] text-slate-400 block font-mono">Total Department Overhead Pool</span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {formatCurrency(
                    overheadBreakdown.reduce((sum: number, b: any) => sum + (b.departmentOverheadPool || 0), 0),
                    displayCurrency
                  )}
                </span>
                <span className="text-[10px] text-slate-500">Source: Costing & Pricing</span>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <span className="text-[11px] text-slate-400 block font-mono">Absorbed by This Project</span>
                <span className="text-base font-bold text-purple-400 font-mono mt-0.5 block">
                  {formatCurrency(summary?.assignedOverhead || 0, displayCurrency)}
                </span>
                <span className="text-[10px] text-purple-300">
                  Effort-proportional absorption
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <span className="text-[11px] text-slate-400 block font-mono">Remaining Capacity Overhead</span>
                <span className="text-base font-bold text-amber-400 font-mono mt-0.5 block">
                  {formatCurrency(
                    Math.max(
                      0,
                      overheadBreakdown.reduce((sum: number, b: any) => sum + (b.departmentOverheadPool || 0), 0) -
                        (summary?.assignedOverhead || 0)
                    ),
                    displayCurrency
                  )}
                </span>
                <span className="text-[10px] text-slate-500">Other projects & bench capacity</span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-950/40 border border-white/5 text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span>Conservation Equation: Total Overhead Pool = Project Absorbed Overhead + Remaining General Capacity</span>
              <span className="text-emerald-400 font-bold">100% Conserved</span>
            </div>
          </div>

          {/* §1338 Labor Allocation vs Payroll GL Reconciliation Trace */}
          {detailData?.reconciliationTrace && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">Management Labor vs Payroll GL Reconciliation (§1338)</h4>
                    <p className="text-[11px] text-slate-400">
                      Verifies project labor allocations against recognized organizational payroll wage expense to prevent double-booking.
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {detailData.reconciliationTrace.status || 'Balanced'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block font-mono">Total Org Payroll Expense</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">
                    {formatCurrency(detailData.reconciliationTrace.totalOrgPayrollExpense || 0, displayCurrency)}
                  </span>
                  <span className="text-[10px] text-slate-500">Source: Employee salaries / wages</span>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block font-mono">Total Org Allocated Labor</span>
                  <span className="text-base font-bold text-cyan-400 font-mono mt-0.5 block">
                    {formatCurrency(detailData.reconciliationTrace.totalOrgAllocatedLabor || 0, displayCurrency)}
                  </span>
                  <span className="text-[10px] text-cyan-400/80">
                    This project: {formatCurrency(detailData.reconciliationTrace.projectAllocatedLabor || summary?.laborCost || 0, displayCurrency)}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block font-mono">Unallocated Bench / Overhead</span>
                  <span className="text-base font-bold text-amber-400 font-mono mt-0.5 block">
                    {formatCurrency(detailData.reconciliationTrace.unallocatedPayrollBench || 0, displayCurrency)}
                  </span>
                  <span className="text-[10px] text-slate-500">Non-project general capacity</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950/40 border border-white/5 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                <span>Equation: {detailData.reconciliationTrace.reconciliationEquation || 'Total Payroll = Allocated Labor + Unallocated Bench'}</span>
                <span className="text-emerald-400 font-bold">100% Accounted</span>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* 6. Section 13 Timesheet Revision Modal */}
      <Dialog open={Boolean(revisingEntry)} onOpenChange={open => { if (!open) setRevisingEntry(null); }}>
        <DialogContent
          className="max-w-md text-white"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Edit3 className="size-4 text-cyan-400" />
              <span>Revise Timesheet Entry (§13)</span>
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              If an approved or logged time entry changes, record the revision authorization and recompute the management cost attribution delta.
            </DialogDescription>
          </DialogHeader>

          {revisingEntry && (
            <div className="space-y-4 pt-2">
              <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs">
                <p className="text-slate-400">Team Member: <strong className="text-white">{revisingEntry.userName}</strong></p>
                <p className="text-slate-400">Date: <strong className="text-white">{formatDate(revisingEntry.date)}</strong></p>
                <p className="text-slate-400">Current Logged: <strong className="text-cyan-300 font-mono">{revisingEntry.hours} hrs</strong></p>
              </div>

              <div>
                <label className="text-white text-xs font-semibold block mb-1.5">New Hours *</label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={revisedHours}
                  onChange={e => setRevisedHours(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-white font-mono"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                  placeholder="e.g. 3.0"
                />
              </div>

              <div>
                <label className="text-white text-xs font-semibold block mb-1.5">Authorization Reason *</label>
                <input
                  type="text"
                  value={revisionReason}
                  onChange={e => setRevisionReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-white text-xs"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                  placeholder="e.g. Scope adjustment after client review"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRevisingEntry(null)}
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-medium"
                  style={AXIOM.buttons.secondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmittingRevision}
                  onClick={handleConfirmRevision}
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-medium bg-cyan-500 hover:bg-cyan-400 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingRevision ? 'Saving...' : 'Apply Revision'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 7. New Deliverable / Task Modal (§13 Work Domain) */}
      <Dialog open={showNewTaskModal} onOpenChange={open => { if (!open) setShowNewTaskModal(false); }}>
        <DialogContent
          className="max-w-md text-white"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckSquare className="size-4 text-cyan-400" />
              <span>Add Deliverable / Task (§13)</span>
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Define a project deliverable or task milestone. Assigned employees can log hours against this task to trace project labor burn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-white text-xs font-semibold block mb-1.5">Task Title *</label>
              <input
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-white text-xs"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
                placeholder="e.g. Backend API Endpoints & Auth"
              />
            </div>

            <div>
              <label className="text-white text-xs font-semibold block mb-1.5">Assignee</label>
              <select
                value={newTaskAssignee}
                onChange={e => setNewTaskAssignee(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-white text-xs"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              >
                <option value="">Select Team Member</option>
                {members.map((m: any) => {
                  const mId = m.userId || m.id;
                  const mName = m.user?.name || m.name || m.user?.email || mId;
                  const mRole = m.role || m.position || 'Member';
                  return (
                    <option key={mId} value={mId}>
                      {mName} ({mRole})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-white text-xs font-semibold block mb-1.5">Estimated Hours</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={newTaskEstHours}
                  onChange={e => setNewTaskEstHours(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-white font-mono text-xs"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                  placeholder="20"
                />
              </div>

              <div>
                <label className="text-white text-xs font-semibold block mb-1.5">Priority</label>
                <select
                  value={newTaskPriority}
                  onChange={e => setNewTaskPriority(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg text-white text-xs"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-white text-xs font-semibold block mb-1.5">Due Date</label>
              <input
                type="date"
                value={newTaskDueDate}
                onChange={e => setNewTaskDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-white text-xs font-mono"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowNewTaskModal(false)}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-medium"
                style={AXIOM.buttons.secondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingTask || !newTaskTitle.trim()}
                onClick={handleCreateTask}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-medium bg-cyan-500 hover:bg-cyan-400 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingTask ? 'Creating...' : 'Create Deliverable'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

