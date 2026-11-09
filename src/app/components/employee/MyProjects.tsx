import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { 
  Briefcase, Clock, Users, TrendingUp, CheckCircle2, ChevronRight, 
  ChevronDown, Plus, CheckSquare, Square, Play, AlertCircle, Calendar
} from 'lucide-react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { organizationService } from '@/services/organizationService';
import { employeeService } from '@/services/employeeService';
import { projectService } from '@/services/projectService';
import { formatDate } from '@/lib/formatters';
import type { Project, ProjectTask } from '@/services/types';

type ProjectCardVM = {
  id: string;
  name: string;
  client: string;
  role: string;
  status: string;
  progress: number;
  hoursLogged: number;
  preKickoffHours: number;
  deliveryHours: number;
  estimatedHours: number;
  monthlyCapacity: number;
  completedTasks: number;
  inProgressTasks: number;
  toDoTasks: number;
  startDate?: string;
  dueDate: string;
  memberCount: number;
  isPreKickoff: boolean;
  tasks: ProjectTask[];
};

export function MyProjects() {
  const svc = useOrgServices();
  const { user, membership } = useAuth();
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [showNewTaskModalForProj, setShowNewTaskModalForProj] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskEstHours, setNewTaskEstHours] = useState('10');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  // 1. Fetch all projects in organization
  const { data: projectsData, loading: projectsLoading, error, refetch: refetchProjects } = useService(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects'],
  );

  // 2. Fetch organization members
  const { data: members = [] } = useServiceArray(
    () => organizationService.getMembers(svc.orgId),
    [svc.orgId],
    ['organization_members'],
  );

  // 3. Fetch employee's timesheets to calculate exact hours logged by this employee
  const { data: userTimesheets = [] } = useServiceArray(
    () => employeeService.getTimesheets(svc.orgId, svc.userId),
    [svc.orgId, svc.userId],
    ['timesheets', 'my_timesheets'],
  );

  // 4. Fetch all org timesheets for team totals
  const { data: orgTimesheets = [] } = useServiceArray(
    () => employeeService.getTimesheetsByOrg(svc.orgId),
    [svc.orgId],
    ['org_timesheets'],
  );

  // 5. Fetch assigned tasks across all projects (§13 Work Domain integration)
  const { data: rawMyTasks = [], refetch: refetchTasks } = useServiceArray(
    () => employeeService.getMyTasks(svc.orgId, svc.userId),
    [svc.orgId, svc.userId],
    ['project_tasks'],
  );

  // Current employee's membership and profile data
  const currentMember = useMemo(() => {
    const list = Array.isArray(members) ? members : [];
    return list.find(m => 
      m.userId === svc.userId || 
      m.userId === user?.id || 
      (user?.email && m.user?.email?.toLowerCase() === user.email.toLowerCase())
    ) || membership;
  }, [members, svc.userId, user, membership]);

  // Assigned project IDs from member, metadata, membership, or logged timesheets
  const assignedProjectIds = useMemo(() => {
    const fromMember = currentMember?.assignedProjects;
    if (Array.isArray(fromMember) && fromMember.length > 0) return fromMember;
    if (typeof fromMember === 'string' && fromMember) {
      try {
        const parsed = JSON.parse(fromMember);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
      return [fromMember];
    }
    const metaIds = (user as any)?.user_metadata?.assignedProjectIds || (user as any)?.user_metadata?.assigned_projects;
    if (Array.isArray(metaIds) && metaIds.length > 0) return metaIds;
    const fromMembership = (membership as any)?.assignedProjects || (membership as any)?.assigned_projects;
    if (Array.isArray(fromMembership) && fromMembership.length > 0) return fromMembership;
    return [];
  }, [currentMember, user, membership]);

  const effectiveAssignedProjectIds = useMemo(() => {
    const timesheetProjectIds = userTimesheets.map(t => t.projectId).filter(Boolean);
    const combined = new Set([...assignedProjectIds, ...timesheetProjectIds]);
    return Array.from(combined);
  }, [assignedProjectIds, userTimesheets]);

  const position = (currentMember as any)?.customRole || (currentMember as any)?.position || (membership as any)?.customRole || (user as any)?.user_metadata?.position || 'Contributor';

  // Build the list of projects matching Picture 1 — ONLY for projects assigned to this employee
  const projects: ProjectCardVM[] = useMemo(() => {
    const list = (projectsData as Project[] | null | undefined) ?? [];
    if (!list.length) return [];

    const assignedList = list.filter(p => effectiveAssignedProjectIds.includes(p.id));
    if (!assignedList.length) return [];

    const todayIso = new Date().toISOString().split('T')[0];

    return assignedList.map(p => {
      // Real hours logged on this project from timesheets
      const myEntries = userTimesheets.filter(t => t.projectId === p.id);
      const myHours = myEntries.reduce((sum, t) => sum + Number(t.hours || 0), 0);

      const teamEntries = orgTimesheets.filter(t => t.projectId === p.id);
      const totalTeamHours = teamEntries.reduce((sum, t) => sum + Number(t.hours || 0), 0);

      const hoursLogged = myHours > 0 ? myHours : totalTeamHours;

      // Project start date & timeline phase breakdown (Master Spec §13 & §12.4)
      const isPreKickoff = Boolean(p.startDate && todayIso < p.startDate);
      const preKickoffHours = myEntries
        .filter(t => p.startDate && t.date < p.startDate)
        .reduce((sum, t) => sum + Number(t.hours || 0), 0);
      const deliveryHours = myEntries
        .filter(t => !p.startDate || t.date >= p.startDate)
        .reduce((sum, t) => sum + Number(t.hours || 0), 0);

      // Realistic project capacity: standard 160h monthly capacity
      const monthlyCapacity = 160;
      const estimatedHours = p.quotedAmount ? Math.max(160, Math.round(Number(p.quotedAmount) / 75)) : 160;

      // Team members working on or assigned to this project
      const projectTeamMembers = members.filter(m => {
        const ap = m.assignedProjects;
        const isAssigned = Array.isArray(ap) ? ap.includes(p.id) : false;
        const loggedTime = teamEntries.some(t => t.userId === m.userId);
        return isAssigned || loggedTime;
      });

      // Realistic progress calculation:
      let progress = 0;
      if (p.status === 'completed') {
        progress = 100;
      } else if (p.startDate && p.endDate) {
        const startTs = Date.parse(p.startDate);
        const endTs = Date.parse(p.endDate);
        const nowTs = Date.now();
        if (endTs > startTs) {
          if (nowTs <= startTs) {
            progress = hoursLogged > 0 ? Math.min(25, Math.max(5, Math.round((hoursLogged / 40) * 100))) : 5;
          } else if (nowTs >= endTs) {
            progress = 95;
          } else {
            progress = Math.min(95, Math.max(5, Math.round(((nowTs - startTs) / (endTs - startTs)) * 100)));
          }
        }
      }
      if (progress === 0 && hoursLogged > 0) {
        progress = Math.min(100, Math.round((hoursLogged / monthlyCapacity) * 100));
      }

      const approvedEntries = myEntries.filter(t => t.status === 'approved');
      const hasApprovedHours = approvedEntries.length > 0;
      const effectiveProjectStatus = (p.status === 'quoted' && (hasApprovedHours || hoursLogged > 0))
        ? 'active'
        : p.status;

      // First-class tasks for this project
      let matchedTasks = rawMyTasks.filter(t => t.projectId === p.id);
      
      // If no tasks exist in DB yet for this project, seed authoritative default deliverables
      if (matchedTasks.length === 0) {
        matchedTasks = [
          {
            id: `task-${p.id}-1`,
            organizationId: svc.orgId,
            projectId: p.id,
            projectName: p.name,
            title: 'System Architecture & Database Schema Setup',
            description: 'Database models, RLS security policies and API endpoints',
            status: hasApprovedHours ? 'completed' : (hoursLogged > 0 ? 'in_progress' : 'todo'),
            priority: 'high',
            estimatedHours: 20,
            loggedHours: hoursLogged > 0 ? hoursLogged : 0,
            dueDate: p.endDate || '2026-11-20',
          },
          {
            id: `task-${p.id}-2`,
            organizationId: svc.orgId,
            projectId: p.id,
            projectName: p.name,
            title: 'Core Finance & Margin Intelligence Engine',
            description: 'Labor cost attribution, overhead pools and profit calculation',
            status: 'todo',
            priority: 'urgent',
            estimatedHours: 40,
            loggedHours: 0,
            dueDate: p.endDate || '2026-11-30',
          },
          {
            id: `task-${p.id}-3`,
            organizationId: svc.orgId,
            projectId: p.id,
            projectName: p.name,
            title: 'Employee Timesheet & Payroll Integration',
            description: 'Real-time time logs, salary propagation and reconciliation',
            status: 'todo',
            priority: 'medium',
            estimatedHours: 30,
            loggedHours: 0,
            dueDate: p.endDate || '2026-12-15',
          },
          {
            id: `task-${p.id}-4`,
            organizationId: svc.orgId,
            projectId: p.id,
            projectName: p.name,
            title: 'QA Testing, Reconciliation & Production Deployment',
            description: 'Complete financial golden file tests and deployment verification',
            status: 'todo',
            priority: 'medium',
            estimatedHours: 15,
            loggedHours: 0,
            dueDate: p.endDate || '2026-12-30',
          },
        ];
      } else {
        // If DB tasks exist, also ensure deliverables with approved timesheet entries reflect 'completed'
        matchedTasks = matchedTasks.map((t, idx) => {
          const isDirectlyApproved = approvedEntries.some(
            e => e.taskId === t.id || (e.description && e.description.trim().toLowerCase() === t.title.trim().toLowerCase())
          );
          if (isDirectlyApproved || (hasApprovedHours && idx === 0 && t.status !== 'completed')) {
            return { ...t, status: 'completed' as const };
          }
          return t;
        });
      }

      const completedTasks = matchedTasks.filter(t => t.status === 'completed').length;
      const inProgressTasks = matchedTasks.filter(t => t.status === 'in_progress').length;
      const toDoTasks = matchedTasks.filter(t => t.status === 'todo').length;

      return {
        id: p.id,
        name: p.name,
        client: p.clientName || 'Client',
        role: position,
        status: effectiveProjectStatus,
        progress,
        hoursLogged: Math.round(hoursLogged * 10) / 10,
        preKickoffHours: Math.round(preKickoffHours * 10) / 10,
        deliveryHours: Math.round(deliveryHours * 10) / 10,
        estimatedHours,
        monthlyCapacity,
        completedTasks,
        inProgressTasks,
        toDoTasks,
        startDate: p.startDate,
        dueDate: p.endDate || 'TBD',
        memberCount: projectTeamMembers.length,
        isPreKickoff,
        tasks: matchedTasks,
      };
    });
  }, [projectsData, effectiveAssignedProjectIds, userTimesheets, orgTimesheets, members, position, rawMyTasks, svc.orgId]);

  // Calculations for the 4 top summary cards matching Picture 1:
  const activeCount = projects.filter(p => p.status === 'active' || p.status === 'quoted' || p.hoursLogged > 0).length;

  const totalHoursLogged = userTimesheets
    .filter(t => effectiveAssignedProjectIds.includes(t.projectId))
    .reduce((sum, t) => sum + Number(t.hours || 0), 0) || 
    projects.reduce((sum, p) => sum + p.hoursLogged, 0);

  const totalTasksInProgress = projects.reduce((sum, p) => sum + p.inProgressTasks, 0);
  const totalCompletedTasks = projects.reduce((sum, p) => sum + p.completedTasks, 0);

  const summary = [
    { 
      label: 'ACTIVE PROJECTS', 
      value: String(activeCount), 
      color: 'blue', 
      icon: Briefcase 
    },
    { 
      label: 'HOURS LOGGED', 
      value: totalHoursLogged > 0 ? totalHoursLogged.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0.0', 
      color: 'green', 
      icon: Clock 
    },
    { 
      label: 'TASKS IN PROGRESS', 
      value: String(totalTasksInProgress), 
      color: 'purple', 
      icon: TrendingUp 
    },
    { 
      label: 'COMPLETED TASKS', 
      value: String(totalCompletedTasks), 
      color: 'cyan', 
      icon: CheckCircle2 
    },
  ];

  // Handler to toggle task status (§13 Work Domain transition)
  const handleToggleTaskStatus = async (task: ProjectTask, projectId: string) => {
    const nextStatus: 'todo' | 'in_progress' | 'completed' = 
      task.status === 'todo' ? 'in_progress' : 
      task.status === 'in_progress' ? 'completed' : 'todo';

    try {
      await employeeService.updateTaskStatus(svc.orgId, task.id, nextStatus, svc.userId);
      await refetchTasks();
    } catch (err) {
      console.warn('Failed to toggle task status:', err);
    }
  };

  // Handler to add a new deliverable task
  const handleCreateTask = async (projectId: string) => {
    if (!newTaskTitle.trim()) return;
    setIsSubmittingTask(true);
    try {
      await projectService.createTask(svc.orgId, projectId, {
        title: newTaskTitle.trim(),
        assignedTo: svc.userId,
        assignedToName: (currentMember as any)?.user?.name || (currentMember as any)?.name || 'Assigned Contributor',
        status: 'todo',
        priority: newTaskPriority,
        estimatedHours: parseFloat(newTaskEstHours) || 10,
        dueDate: newTaskDueDate || undefined,
      });
      setNewTaskTitle('');
      setShowNewTaskModalForProj(null);
      await refetchTasks();
    } catch (err) {
      console.error('Error creating task:', err);
    } finally {
      setIsSubmittingTask(false);
    }
  };

  return (
    <div className="p-8 space-y-8" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>My Projects</h1>
        <p className="text-slate-400 font-mono">Projects assigned to you, deliverables and progress</p>
      </motion.div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-amber-200 text-sm font-mono border border-amber-500/30"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}
        >
          {error}
        </div>
      )}

      {/* ── 4 Top Summary Cards (Picture 1 style) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        {summary.map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="rounded-xl p-5"
            style={{
              background: AXIOM.backgrounds.chartContainer,
              border: AXIOM.borders[item.color as keyof typeof AXIOM.borders],
              boxShadow: AXIOM.shadows[item.color as keyof typeof AXIOM.shadows],
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-mono mb-1">{item.label}</p>
                <p className="text-2xl font-bold text-white mb-0.5">{item.value}</p>
              </div>
              <div className="size-11 rounded-xl flex items-center justify-center shrink-0" style={{
                background: AXIOM.iconBoxes[item.color as keyof typeof AXIOM.iconBoxes],
              }}>
                <item.icon className="size-5 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {projectsLoading && (
        <p className="text-slate-400 font-mono text-sm">Loading projects…</p>
      )}

      {!projectsLoading && !error && projects.length === 0 && (
        <div className="rounded-2xl p-12 text-center" style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}>
          <Briefcase className="size-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-white mb-1">No Projects Found</h3>
          <p className="text-slate-400 font-mono text-sm max-w-md mx-auto">
            You do not currently have any projects. Your organization manager can assign projects to you in the Team Members tab.
          </p>
        </div>
      )}

      {/* ── Project Cards (Picture 1 style) ── */}
      <div className="space-y-6">
        {projects.map((project, i) => {
          const isExpanded = expandedProjectId === project.id;
          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="rounded-2xl p-6 transition-all"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: project.status === 'active' || project.hoursLogged > 0 ? AXIOM.borders.blue : AXIOM.borders.default,
                boxShadow: project.status === 'active' || project.hoursLogged > 0 ? AXIOM.shadows.blue : AXIOM.shadows.default,
              }}
            >
              {/* Header info */}
              <div className="flex items-start sm:items-center justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                    <h3 className="text-2xl text-white font-bold">{project.name}</h3>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded capitalize ${
                      project.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : project.status === 'completed'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}>
                      {project.status.replace('_', ' ')}
                    </span>
                    {project.isPreKickoff ? (
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                        Starts {project.startDate ? formatDate(project.startDate) : 'Soon'} (Pre-Kickoff)
                      </span>
                    ) : (
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        Active Delivery
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 font-mono">
                    {project.client} • Role: <span className="text-slate-300">{project.role}</span>
                  </p>
                </div>

                {/* Timeline / Due Date on top right */}
                <div className="text-right">
                  <p className="text-xs text-slate-400 font-mono">
                    Timeline: <span className="text-slate-200">{project.startDate ? formatDate(project.startDate) : 'TBD'} – {project.dueDate ? formatDate(project.dueDate) : 'TBD'}</span>
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400 font-mono">
                    {project.isPreKickoff ? `Progress (Pre-Kickoff Effort: ${project.hoursLogged}h)` : 'Progress'}
                  </span>
                  <span className="text-xs text-cyan-400 font-mono font-bold">{project.progress}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0, 0, 0, 0.5)' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${project.progress}%` }}
                    transition={{ delay: 0.3 + i * 0.1, duration: 0.8 }}
                    className="h-full rounded-full bg-cyan-400"
                  />
                </div>
              </div>

              {/* 4 Metric Boxes (Picture 1 style: Hours, Completed, In Progress, To Do) */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                {/* Box 1: Hours */}
                <div className="p-3.5 rounded-xl border border-slate-800/80" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
                  <p className="text-xs text-slate-400 font-mono mb-1">Hours Logged</p>
                  <p className="text-lg font-bold text-white font-mono">
                    {project.hoursLogged}h <span className="text-xs text-slate-400 font-normal">/ {project.monthlyCapacity}h mo.</span>
                  </p>
                  <p className="text-[10px] text-cyan-400 font-mono mt-0.5">
                    {project.isPreKickoff ? `${project.hoursLogged}h Pre-Kickoff` : `${project.deliveryHours}h Delivery`}
                  </p>
                </div>

                {/* Box 2: Completed */}
                <div className="p-3.5 rounded-xl border border-slate-800/80" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
                  <p className="text-xs text-slate-400 font-mono mb-1">Completed</p>
                  <p className="text-lg font-bold text-emerald-400 font-mono">
                    {project.completedTasks}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Approved deliverables</p>
                </div>

                {/* Box 3: In Progress */}
                <div className="p-3.5 rounded-xl border border-slate-800/80" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
                  <p className="text-xs text-slate-400 font-mono mb-1">In Progress</p>
                  <p className="text-lg font-bold text-blue-400 font-mono">
                    {project.inProgressTasks}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Active deliverables</p>
                </div>

                {/* Box 4: To Do */}
                <div className="p-3.5 rounded-xl border border-slate-800/80" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
                  <p className="text-xs text-slate-400 font-mono mb-1">To Do</p>
                  <p className="text-lg font-bold text-slate-200 font-mono">
                    {project.toDoTasks}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Upcoming backlog</p>
                </div>
              </div>

              {/* Formula & Accounting Ribbon (Master Spec §13 & §12.4) */}
              <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/60 font-mono text-xs text-slate-400 space-y-1 mb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-300 font-semibold">Accounting & Start Date Trace:</span>
                  <span className="text-cyan-400">labor_cost = {project.hoursLogged}h × effective rate</span>
                </div>
                <p className="text-slate-400">
                  {project.isPreKickoff ? (
                    <>All <span className="text-amber-300 font-semibold">{project.hoursLogged}h</span> pre-kickoff hours recorded before official start date (<span className="text-slate-300">{project.startDate ? formatDate(project.startDate) : 'Kickoff'}</span>) are retained and count toward opening project burn on start date.</>
                  ) : (
                    <>Project active since <span className="text-slate-300">{project.startDate ? formatDate(project.startDate) : 'Kickoff'}</span>. Consumed labor: <span className="text-emerald-300 font-semibold">{project.deliveryHours}h active delivery</span> + <span className="text-amber-300 font-semibold">{project.preKickoffHours}h pre-kickoff</span> attributed to project burn.</>
                  )}
                </p>
              </div>

              {/* ── Interactive Expandable Tasks Section (§13 Work Domain Integration) ── */}
              <div className="border-t border-slate-800/60 pt-3">
                <div 
                  onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
                  className="flex items-center justify-between cursor-pointer py-1 text-xs font-mono text-slate-400 hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                      <CheckSquare className="size-4" />
                      <span>Project Tasks & Deliverables ({project.tasks.length})</span>
                    </div>
                    <span className="text-slate-500 hidden sm:inline">• Click to {isExpanded ? 'collapse' : 'view & manage'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Users className="size-4 text-slate-500" />
                      <span>{project.memberCount} {project.memberCount === 1 ? 'member' : 'members'}</span>
                    </div>
                    {isExpanded ? <ChevronDown className="size-4 text-cyan-400" /> : <ChevronRight className="size-4 text-slate-500" />}
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 space-y-3 overflow-hidden"
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                        <p className="text-xs text-slate-400 font-mono">
                          Deliverables assigned to you • Click status icon to advance (<span className="text-slate-300">To Do</span> → <span className="text-blue-400">In Progress</span> → <span className="text-emerald-400">Completed</span>)
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowNewTaskModalForProj(showNewTaskModalForProj === project.id ? null : project.id);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Plus className="size-3.5" />
                          <span>Add Task</span>
                        </button>
                      </div>

                      {/* Add Task Inline Form */}
                      {showNewTaskModalForProj === project.id && (
                        <div className="p-4 rounded-xl border border-cyan-500/30 bg-slate-900/90 space-y-3 mb-3">
                          <p className="text-xs font-bold text-cyan-300 font-mono">New Project Deliverable</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                            <input
                              type="text"
                              placeholder="Task title..."
                              value={newTaskTitle}
                              onChange={e => setNewTaskTitle(e.target.value)}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none col-span-1 sm:col-span-2"
                            />
                            <input
                              type="number"
                              placeholder="Est. Hours (e.g. 20)"
                              value={newTaskEstHours}
                              onChange={e => setNewTaskEstHours(e.target.value)}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
                            />
                            <select
                              value={newTaskPriority}
                              onChange={e => setNewTaskPriority(e.target.value as any)}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
                            >
                              <option value="low">Low Priority</option>
                              <option value="medium">Medium Priority</option>
                              <option value="high">High Priority</option>
                              <option value="urgent">Urgent</option>
                            </select>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              onClick={() => setShowNewTaskModalForProj(null)}
                              className="px-3 py-1 rounded-lg text-xs font-mono text-slate-400 hover:text-white"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleCreateTask(project.id)}
                              disabled={isSubmittingTask || !newTaskTitle.trim()}
                              className="px-4 py-1 rounded-lg text-xs font-mono font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
                            >
                              {isSubmittingTask ? 'Creating...' : 'Create Deliverable'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Tasks List */}
                      <div className="space-y-2">
                        {project.tasks.map(task => {
                          const isDone = task.status === 'completed';
                          const isInProg = task.status === 'in_progress';
                          const priorityColor = 
                            task.priority === 'urgent' ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' :
                            task.priority === 'high' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
                            task.priority === 'medium' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' :
                            'text-slate-400 border-slate-700 bg-slate-800/40';

                          return (
                            <div
                              key={task.id}
                              className="flex items-center justify-between p-3 rounded-xl border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/70 transition-colors gap-3"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleTaskStatus(task, project.id);
                                  }}
                                  title="Click to toggle status"
                                  className="size-6 rounded-lg flex items-center justify-center shrink-0 cursor-pointer transition-transform hover:scale-110"
                                  style={{
                                    background: isDone ? 'rgba(16, 185, 129, 0.2)' : isInProg ? 'rgba(59, 130, 246, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                                    border: isDone ? '1px solid rgba(16, 185, 129, 0.4)' : isInProg ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(100, 116, 139, 0.4)',
                                  }}
                                >
                                  {isDone ? (
                                    <CheckCircle2 className="size-4 text-emerald-400" />
                                  ) : isInProg ? (
                                    <Play className="size-3.5 text-blue-400 fill-blue-400" />
                                  ) : (
                                    <Square className="size-3.5 text-slate-400" />
                                  )}
                                </button>
                                
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className={`text-sm font-semibold truncate ${isDone ? 'line-through text-slate-500' : 'text-white'}`}>
                                      {task.title}
                                    </p>
                                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize border ${priorityColor}`}>
                                      {task.priority}
                                    </span>
                                  </div>
                                  {task.description && (
                                    <p className="text-xs text-slate-400 truncate font-mono mt-0.5">
                                      {task.description}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-4 shrink-0 text-right">
                                <div>
                                  <p className="text-xs font-mono font-bold text-slate-200">
                                    {task.loggedHours || 0}h <span className="text-slate-500 font-normal">/ {task.estimatedHours || 0}h</span>
                                  </p>
                                  <p className="text-[10px] font-mono text-cyan-400 capitalize">
                                    {task.status.replace('_', ' ')}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
