import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { PageShell, PageHeader } from '../layout';
import {
  Clock, Plus, ChevronLeft, ChevronRight, Play, Pause, RotateCcw,
  Check, Calendar, Send, X, CheckCircle, AlertCircle,
  Zap, DollarSign,
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { projectService } from '@/services/projectService';
import { organizationService } from '@/services/organizationService';
import type { TimesheetEntry } from '@/services/employeeService';
import { useService, useMutation } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';

// ── Fallback Constants ──────────────────────────────────────────────────

const TIMER_PROJECTS: { id: string; name: string; isAssigned: boolean }[] = [];

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// ── View-model type (for component rendering) ──────────────────────────

interface TimesheetVM {
  id: string;
  date: string;
  project: string;
  task: string;
  hours: number;
  status: 'logged' | 'submitted' | 'approved';
  billable?: boolean;
}

function mondayOfWeek(ref: Date): Date {
  const d = new Date(ref);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ── Main Component ──────────────────────────────────────────────────────

export function MyTimesheet() {
  const { user, currentOrganization, membership } = useAuth();
  const orgId = currentOrganization?.id || '';
  const userId = user?.id ?? '';

  // Fetch assigned tasks for datalist autocomplete (§13 Work Domain)
  const { data: rawAssignedTasks, refetch: refetchTasks } = useService(
    () => (orgId && userId ? employeeService.getMyTasks(orgId, userId) : Promise.resolve({ success: true, data: [] })),
    [orgId, userId],
    ['project_tasks'],
  );
  const myAssignedTasks = useMemo(
    () => (Array.isArray(rawAssignedTasks) ? rawAssignedTasks : []),
    [rawAssignedTasks],
  );

  // ── Service data ──
  const { data: svcTimesheets, loading, error, refetch } = useService(
    () => (orgId && userId ? employeeService.getTimesheets(orgId, userId) : Promise.resolve({ success: true, data: [] })),
    [orgId, userId],
    ['timesheets'],
  );

  // ── Real Organization Projects ──
  const { data: dbProjects = [] } = useService(
    () => (orgId ? projectService.getAll(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId],
    ['projects'],
  );

  // ── Organization Members (authoritative source for assigned projects) ──
  const { data: orgMembers = [] } = useService(
    () => (orgId ? organizationService.getMembers(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId],
    ['organization_members'],
  );

  const currentMember = useMemo(() => {
    const list = Array.isArray(orgMembers) ? (orgMembers as any[]) : [];
    return list.find(m => 
      m.userId === userId || 
      m.userId === user?.id || 
      (user?.email && m.user?.email?.toLowerCase() === user.email.toLowerCase())
    ) || membership;
  }, [orgMembers, userId, user, membership]);

  const assignedProjectIds: string[] = useMemo(() => {
    const fromMember = currentMember?.assignedProjects ?? (currentMember as any)?.assignedProjectIds;
    if (Array.isArray(fromMember) && fromMember.length > 0) return fromMember;
    if (typeof fromMember === 'string' && fromMember) {
      try {
        const parsed = JSON.parse(fromMember);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
      return [fromMember];
    }
    const meta = (user as any)?.user_metadata || {};
    const metaIds = meta.assignedProjectIds || meta.assigned_projects;
    if (Array.isArray(metaIds) && metaIds.length > 0) return metaIds;
    const fromMembership = (membership as any)?.assignedProjects || (membership as any)?.assigned_projects;
    if (Array.isArray(fromMembership) && fromMembership.length > 0) return fromMembership;
    return [];
  }, [currentMember, user, membership]);

  const availableProjects = useMemo(() => {
    const list = Array.isArray(dbProjects) ? dbProjects : [];
    if (list.length > 0) {
      // Strictly filter to ONLY projects assigned to this employee
      const assigned = list.filter(p => assignedProjectIds.includes(p.id));
      return assigned.map(p => ({
        id: p.id,
        name: p.name + (p.clientName ? ` - ${p.clientName}` : ''),
        isAssigned: true,
        startDate: p.startDate,
        endDate: p.endDate,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }, [dbProjects, assignedProjectIds]);

  // ── Mutations ──
  const createMutation = useMutation(
    (data: Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>) =>
      employeeService.createTimesheetEntry(orgId, userId, data),
  );
  const submitWeekMutation = useMutation(
    (ids: string[]) => employeeService.submitTimesheet(ids, orgId),
  );

  // ── Timer state ──
  const [isTimerRunning, setIsTimerRunning]   = useState(false);
  const [elapsedSeconds, setElapsedSeconds]   = useState(0);
  const [timerProjectId, setTimerProjectId]   = useState('');
  const [timerTask,      setTimerTask]         = useState('');
  const [timerBillable,  setTimerBillable]     = useState(true);
  const [timerTaskId,    setTimerTaskId]       = useState('');
  const [manualTaskId,   setManualTaskId]      = useState('');
  const [isAutoFilling,  setIsAutoFilling]     = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timesheetActionLockRef = useRef(false);
  const toastDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerStartTimeRef = useRef<Date | null>(null);

  // ── Week navigation state ──
  const [weekOffset, setWeekOffset] = useState(0);

  // ── Manual entry form ──
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: todayDate(),
    projectId: '',
    task: '',
    hours: '',
    billable: true,
  });

  const selectedTimerProject = useMemo(
    () => availableProjects.find(p => p.id === timerProjectId),
    [availableProjects, timerProjectId]
  );
  const isTodayInTimerTimeline = useMemo(() => {
    if (!selectedTimerProject) return true;
    const today = todayDate();
    if (selectedTimerProject.startDate && today < selectedTimerProject.startDate) return false;
    if (selectedTimerProject.endDate && today > selectedTimerProject.endDate) return false;
    return true;
  }, [selectedTimerProject]);

  const selectedManualProject = useMemo(
    () => availableProjects.find(p => p.id === manualForm.projectId),
    [availableProjects, manualForm.projectId]
  );

  const timerAssignedTasks = useMemo(() => {
    if (!myAssignedTasks.length) return [];
    return timerProjectId
      ? myAssignedTasks.filter(t => t.projectId === timerProjectId)
      : myAssignedTasks;
  }, [myAssignedTasks, timerProjectId]);

  const manualAssignedTasks = useMemo(() => {
    if (!myAssignedTasks.length) return [];
    return manualForm.projectId
      ? myAssignedTasks.filter(t => t.projectId === manualForm.projectId)
      : myAssignedTasks;
  }, [myAssignedTasks, manualForm.projectId]);

  // Keep timerProjectId and manualForm.projectId aligned with availableProjects
  useEffect(() => {
    if (availableProjects.length > 0) {
      if (!timerProjectId || !availableProjects.some(p => p.id === timerProjectId)) {
        setTimerProjectId(availableProjects[0].id);
      }
      if (!manualForm.projectId || !availableProjects.some(p => p.id === manualForm.projectId)) {
        setManualForm(f => ({ ...f, projectId: availableProjects[0].id }));
      }
    } else {
      setTimerProjectId('');
      setManualForm(f => ({ ...f, projectId: '' }));
    }
  }, [availableProjects, timerProjectId, manualForm.projectId]);

  // ── Toast ──
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    if (toastDismissRef.current) clearTimeout(toastDismissRef.current);
    setToast(msg);
    toastDismissRef.current = setTimeout(() => {
      setToast('');
      toastDismissRef.current = null;
    }, 3000);
  };

  // ── Cleanup interval + toast timer on unmount ──
  useEffect(
    () => () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (toastDismissRef.current) clearTimeout(toastDismissRef.current);
    },
    [],
  );

  // ── Timer control ──
  const startTimer = () => {
    if (selectedTimerProject?.startDate && todayDate() < selectedTimerProject.startDate) {
      showToast(`Cannot log time: ${selectedTimerProject.name} starts on ${selectedTimerProject.startDate}`);
      return;
    }
    if (selectedTimerProject?.endDate && todayDate() > selectedTimerProject.endDate) {
      showToast(`Cannot log time: ${selectedTimerProject.name} ended on ${selectedTimerProject.endDate}`);
      return;
    }
    timerStartTimeRef.current = new Date();
    setIsTimerRunning(true);
    intervalRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = async () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setIsTimerRunning(false);

    if (elapsedSeconds < 60) {
      // Less than a minute — discard silently
      setElapsedSeconds(0);
      return;
    }

    if (timesheetActionLockRef.current) return;
    timesheetActionLockRef.current = true;
    try {
      const hours = Math.round((elapsedSeconds / 3600) * 100) / 100;
      const endDt = new Date();
      const startDt = timerStartTimeRef.current || new Date(endDt.getTime() - elapsedSeconds * 1000);
      const startTimeStr = startDt.toTimeString().slice(0, 5);
      const endTimeStr = endDt.toTimeString().slice(0, 5);
      const durationMins = Math.round(elapsedSeconds / 60);
      const project = availableProjects.find(p => p.id === timerProjectId) || { id: timerProjectId, name: 'Project' };
      const today = todayDate();
      if ((project as any)?.startDate && today < (project as any).startDate) {
        showToast(`Cannot log time: ${project.name} starts on ${(project as any).startDate}`);
        return;
      }
      if ((project as any)?.endDate && today > (project as any).endDate) {
        showToast(`Cannot log time: ${project.name} ended on ${(project as any).endDate}`);
        return;
      }

      const matchedTask = myAssignedTasks.find(t => (t.title || '').toLowerCase() === timerTask.trim().toLowerCase());
      const result = await createMutation.execute({
        date: todayDate(),
        projectId: timerProjectId,
        projectName: project.name,
        hours,
        description: timerTask.trim() || 'Timer entry',
        taskId: timerTaskId || matchedTask?.id || undefined,
        billable: timerBillable,
        status: 'draft',
        startTime: startTimeStr,
        endTime: endTimeStr,
        durationMinutes: durationMins,
      });

      if (result.success) {
        await Promise.all([refetch(), refetchTasks()]);
        setElapsedSeconds(0);
        setTimerTask('');
        setTimerTaskId('');
        showToast(`Logged ${hours}h on ${project.name}`);
      } else {
        showToast(result.error || 'Failed to log hours');
      }
    } finally {
      timesheetActionLockRef.current = false;
    }
  };

  // ── Auto-Fill Week Tasks (§13 Work Domain Batch Schedule) ──
  const handleAutoFillWeek = async () => {
    if (!orgId || !userId) {
      showToast('Organization or user not loaded');
      return;
    }
    if (availableProjects.length === 0) {
      showToast('No assigned projects found to log time against');
      return;
    }
    if (myAssignedTasks.length === 0) {
      showToast('No assigned tasks found. Please assign tasks in Project details first.');
      return;
    }

    setIsAutoFilling(true);
    try {
      // Prioritize active/in-progress tasks, fallback to all assigned tasks
      const activeTasks = myAssignedTasks.filter((t: any) => t.status !== 'completed');
      const candidateTasks = activeTasks.length > 0 ? activeTasks : myAssignedTasks;

      const entriesToCreate: Array<Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>> = [];
      let totalAssignedHours = 0;

      for (const day of weekData) {
        const dayDate = day.date;
        const alreadyLogged = timesheetData
          .filter(e => e.date === dayDate)
          .reduce((sum, e) => sum + e.hours, 0);

        let dailyCapacity = Math.max(0, 8 - alreadyLogged);
        if (dailyCapacity <= 0) continue;

        // Specific tasks with matching due dates for this day, or rotate candidate tasks
        const dueToday = candidateTasks.filter((t: any) => t.dueDate === dayDate);
        const tasksForDay = dueToday.length > 0 ? dueToday : candidateTasks;

        for (const task of tasksForDay) {
          if (dailyCapacity <= 0) break;

          const proj = availableProjects.find(p => p.id === (task as any).projectId) || availableProjects[0];
          if (proj.startDate && dayDate < proj.startDate) continue;
          if (proj.endDate && dayDate > proj.endDate) continue;

          const estHours = Number((task as any).estimatedHours || 8);
          const logHours = Number((task as any).loggedHours || 0);
          const remainingEffort = Math.max(1, estHours - logHours);
          const hoursToLog = Math.min(dailyCapacity, Math.min(4, remainingEffort));

          if (hoursToLog <= 0) continue;

          entriesToCreate.push({
            date: dayDate,
            projectId: proj.id,
            projectName: proj.name,
            hours: hoursToLog,
            description: (task as any).title,
            taskId: (task as any).id,
            billable: true,
            status: 'draft',
          });

          dailyCapacity -= hoursToLog;
          totalAssignedHours += hoursToLog;
        }
      }

      if (entriesToCreate.length === 0) {
        showToast('No unallocated weekday hours available (week is already at target).');
        return;
      }

      const res = await employeeService.batchCreateTimesheetEntries(orgId, userId, entriesToCreate);
      if (res.success) {
        await Promise.all([refetch(), refetchTasks()]);
        showToast(`Auto-assigned ${entriesToCreate.length} tasks (${totalAssignedHours}h) for the week!`);
      } else {
        showToast(res.error || 'Failed to auto-fill timesheet');
      }
    } catch (err: any) {
      showToast(err.message || 'Auto-fill error');
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleToggleTimer = () => {
    if (isTimerRunning) stopTimer();
    else startTimer();
  };

  // ── Manual entry ──
  const handleAddManual = async () => {
    const hrs = parseFloat(manualForm.hours);
    if (!manualForm.task.trim() || isNaN(hrs) || hrs <= 0) return;
    if (timesheetActionLockRef.current) return;

    const project = availableProjects.find(p => p.id === manualForm.projectId) || { id: manualForm.projectId, name: 'Project' };
    if ((project as any)?.startDate && manualForm.date < (project as any).startDate) {
      showToast(`Cannot log time: ${project.name} starts on ${(project as any).startDate}`);
      return;
    }
    if ((project as any)?.endDate && manualForm.date > (project as any).endDate) {
      showToast(`Cannot log time: ${project.name} ended on ${(project as any).endDate}`);
      return;
    }

    timesheetActionLockRef.current = true;
    try {
      const durationMins = Math.round(hrs * 60);
      const startTimeStr = undefined;
      const endTimeStr = undefined;

      const matchedTask = myAssignedTasks.find(t => (t.title || '').toLowerCase() === manualForm.task.trim().toLowerCase());
      const result = await createMutation.execute({
        date: manualForm.date,
        projectId: manualForm.projectId,
        projectName: project.name,
        hours: hrs,
        description: manualForm.task.trim(),
        taskId: manualTaskId || matchedTask?.id || undefined,
        billable: manualForm.billable,
        status: 'draft',
        startTime: startTimeStr,
        endTime: endTimeStr,
        durationMinutes: durationMins,
      });

      if (result.success) {
        await Promise.all([refetch(), refetchTasks()]);
        setShowManualForm(false);
        setManualForm(f => ({ ...f, date: todayDate(), task: '', hours: '', billable: true }));
        setManualTaskId('');
        showToast(`Logged ${hrs}h on ${project.name}`);
      } else {
        showToast(result.error || 'Failed to log hours');
      }
    } finally {
      timesheetActionLockRef.current = false;
    }
  };

  // ── Submit week ──
  const handleSubmitWeek = async () => {
    const draftEntries = (svcTimesheets ?? []).filter(t => t.status === 'draft');
    if (draftEntries.length === 0) { showToast('No draft entries to submit'); return; }

    // Validate that all draft entries are within their project timelines
    const invalidEntry = draftEntries.find(t => {
      const proj = availableProjects.find(p => p.id === t.projectId) || (Array.isArray(dbProjects) ? dbProjects.find(p => p.id === t.projectId) : undefined);
      if (!proj) return false;
      if (proj.startDate && t.date < proj.startDate) return true;
      if (proj.endDate && t.date > proj.endDate) return true;
      return false;
    });

    if (invalidEntry) {
      const proj = availableProjects.find(p => p.id === invalidEntry.projectId) || (Array.isArray(dbProjects) ? dbProjects.find(p => p.id === invalidEntry.projectId) : undefined);
      showToast(`Cannot submit: Date ${invalidEntry.date} is outside ${proj?.name || 'project'} timeline (${proj?.startDate || ''} to ${proj?.endDate || 'end'}).`);
      return;
    }

    const draftIds = draftEntries.map(t => t.id);
    if (timesheetActionLockRef.current) return;

    timesheetActionLockRef.current = true;
    try {
      const result = await submitWeekMutation.execute(draftIds);
      if (result.success) {
        await refetch();
        showToast(`${draftIds.length} entr${draftIds.length === 1 ? 'y' : 'ies'} submitted for approval`);
      }
    } finally {
      timesheetActionLockRef.current = false;
    }
  };

  const isTimesheetMutating = createMutation.loading || submitWeekMutation.loading;

  // ── View model ──
  const timesheetData: TimesheetVM[] = useMemo(
    () =>
      (svcTimesheets ?? []).map(t => ({
        id: t.id,
        date: t.date,
        project: t.projectName,
        task: t.description,
        hours: t.hours,
        status: t.status === 'draft' ? 'logged' as const : t.status as TimesheetVM['status'],
        billable: t.billable,
      })),
    [svcTimesheets],
  );

  const activeMonday = useMemo(() => {
    const d = mondayOfWeek(new Date());
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const weekData = useMemo(() => {
    return weekDays.map((day, i) => {
      const d = new Date(activeMonday);
      d.setDate(activeMonday.getDate() + i);
      const date = toYMD(d);
      const entries = timesheetData.filter(e => e.date === date);
      return { day, date, hours: entries.reduce((s, e) => s + e.hours, 0), entries };
    });
  }, [activeMonday, timesheetData]);

  const weekStartDate = weekData.length > 0 ? weekData[0].date : '';
  const weekEndDate   = weekData.length > 0 ? weekData[weekData.length - 1].date : '';

  const activeWeekEntries = useMemo(() => {
    return timesheetData.filter(e => e.date >= weekStartDate && e.date <= weekEndDate);
  }, [timesheetData, weekStartDate, weekEndDate]);

  const todayEntries = timesheetData.filter(e => e.date === todayDate());
  const todayTotal   = todayEntries.reduce((s, e) => s + e.hours, 0);
  const weekTotal    = activeWeekEntries.reduce((s, e) => s + e.hours, 0);
  const draftCount   = timesheetData.filter(e => e.status === 'logged').length;

  const groupedEntries = useMemo(() => {
    const map = new Map<string, TimesheetVM[]>();
    for (const entry of timesheetData) {
      const list = map.get(entry.date) || [];
      list.push(entry);
      map.set(entry.date, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [timesheetData]);

  const manualFormDayLogged = useMemo(() => {
    return timesheetData
      .filter(e => e.date === manualForm.date)
      .reduce((sum, e) => sum + e.hours, 0);
  }, [timesheetData, manualForm.date]);

  const weekLabel = useMemo(() => {
    if (!weekData.length) return 'This week';
    const first = weekData[0].date;
    const last = weekData[weekData.length - 1].date;
    const a = new Date(first + 'T12:00:00');
    const b = new Date(last + 'T12:00:00');
    const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${a.toLocaleDateString(undefined, fmt)} – ${b.toLocaleDateString(undefined, { ...fmt, year: 'numeric' })}`;
  }, [weekData]);

  const inputStyle = { background: AXIOM.inputs.background, border: AXIOM.inputs.border, color: '#fff' };

  return (
    <PageShell>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl"
            style={{
              background: 'rgba(16,185,129,0.15)',
              border: '1px solid rgba(16,185,129,0.4)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 10px 40px -10px rgba(16,185,129,0.4)',
            }}
          >
            <CheckCircle className="size-5 text-green-400 shrink-0" />
            <span className="text-white text-sm font-mono">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <PageHeader
          title="My Timesheet"
          description="Track your working hours and project time"
          actions={
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto justify-start sm:justify-end">
          <button
            type="button"
            onClick={() => setWeekOffset(w => w - 1)}
            className="flex items-center gap-2 min-h-10 px-4 py-2 rounded-lg text-sm touch-manipulation hover:bg-white/10 transition-colors"
            style={AXIOM.buttons.outline}
            title="Previous week"
          >
            <ChevronLeft className="size-4" /> Prev Week
          </button>
          <span className="text-white font-mono text-sm px-3 sm:px-4 py-2 rounded-lg min-h-10 inline-flex items-center" style={{
            background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
          }}>
            <Calendar className="size-4 inline mr-2 shrink-0 text-blue-400" />{weekLabel}
          </span>
          <button
            type="button"
            onClick={() => setWeekOffset(w => w + 1)}
            className="flex items-center gap-2 min-h-10 px-4 py-2 rounded-lg text-sm touch-manipulation hover:bg-white/10 transition-colors"
            style={AXIOM.buttons.outline}
            title="Next week"
          >
            Next Week <ChevronRight className="size-4" />
          </button>
          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="flex items-center gap-1.5 min-h-10 px-3 py-2 rounded-lg text-xs font-mono text-blue-400 hover:text-blue-300 border border-blue-500/30 bg-blue-500/10 transition-colors"
              title="Return to current week"
            >
              <RotateCcw className="size-3.5" /> Today's Week
            </button>
          )}
          {draftCount > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              onClick={handleSubmitWeek}
              disabled={isTimesheetMutating}
              className="flex items-center gap-2 min-h-10 px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-all touch-manipulation"
              style={AXIOM.buttons.success}
            >
              {isTimesheetMutating
                ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Send className="size-4" />}
              Submit Week ({draftCount})
            </motion.button>
          )}
            </div>
          }
        />
      </motion.div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-amber-200 text-sm font-mono border border-amber-500/30"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}
        >
          {error}
        </div>
      )}
      {svcTimesheets === null && loading && (
        <p className="text-slate-400 font-mono text-sm">Loading timesheet…</p>
      )}

      {/* Timer + Summary Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Live Timer ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-6"
          style={{ ...AXIOM.containers.chartBlue, borderRadius: '1rem' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock className="size-5 text-blue-400" />
            <h3 className="text-white font-bold">Live Timer</h3>
          </div>

          {/* Project selector */}
          <div className="mb-3">
            <label className="text-[10px] text-slate-400 font-mono tracking-widest block mb-1.5">PROJECT</label>
            <select
              value={timerProjectId}
              onChange={e => setTimerProjectId(e.target.value)}
              disabled={isTimerRunning || availableProjects.length === 0}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono disabled:opacity-50"
              style={inputStyle}
            >
              {availableProjects.length === 0 ? (
                <option value="" disabled className="bg-slate-900 text-slate-400">
                  No projects assigned to you
                </option>
              ) : (
                availableProjects.map(p => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name}
                  </option>
                ))
              )}
            </select>
            {selectedTimerProject?.startDate && (
              <p className={`text-[10px] font-mono mt-1.5 ${isTodayInTimerTimeline ? 'text-slate-400' : 'text-amber-400'}`}>
                Timeline: {selectedTimerProject.startDate} {selectedTimerProject.endDate ? `– ${selectedTimerProject.endDate}` : '(ongoing)'}
                {!isTodayInTimerTimeline && ' • Cannot log time before kickoff'}
              </p>
            )}
          </div>

          {/* Task input */}
          <div className="mb-4">
            <label className="text-[10px] text-slate-400 font-mono tracking-widest block mb-1.5">TASK DESCRIPTION</label>
            <input
              type="text"
              placeholder="What are you working on?"
              list="project-tasks-list"
              value={timerTask}
              onChange={e => {
                setTimerTask(e.target.value);
                const matched = myAssignedTasks.find(t => t.title.toLowerCase() === e.target.value.trim().toLowerCase());
                setTimerTaskId(matched ? matched.id : '');
              }}
              disabled={isTimerRunning}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono disabled:opacity-50"
              style={inputStyle}
            />
            {timerAssignedTasks.length > 0 && (
              <div className="mt-2.5">
                <p className="text-[9px] text-blue-400 font-mono tracking-wider mb-1.5">ASSIGNED PROJECT TASKS (§13)</p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {timerAssignedTasks.map((t: any) => {
                    const isSelected = timerTaskId === t.id || timerTask === t.title;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTimerTask(t.title);
                          setTimerTaskId(t.id);
                          if (t.projectId && t.projectId !== timerProjectId) {
                            setTimerProjectId(t.projectId);
                          }
                        }}
                        disabled={isTimerRunning}
                        className={`text-[10px] font-mono px-2 py-1 rounded-md transition-all text-left flex items-center gap-1 ${
                          isSelected
                            ? 'bg-blue-500/30 text-blue-200 border border-blue-400/50 shadow-sm'
                            : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <span className="truncate max-w-[120px]">{t.title}</span>
                        <span className="text-[9px] text-slate-400 shrink-0">
                          {t.loggedHours || 0}/{t.estimatedHours || 8}h
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Billable toggle */}
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => !isTimerRunning && setTimerBillable(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
              style={timerBillable ? AXIOM.buttons.action : AXIOM.buttons.outline}
            >
              <DollarSign className="size-3" />
              {timerBillable ? 'Billable' : 'Non-billable'}
            </button>
          </div>

          {/* Elapsed display */}
          <div className="text-center mb-5">
            <motion.p
              className="text-5xl font-bold font-mono text-white mb-1"
              animate={isTimerRunning ? { opacity: [1, 0.6, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              {formatElapsed(elapsedSeconds)}
            </motion.p>
            <p className="text-xs text-blue-400/70 font-mono">
              {isTimerRunning ? 'Recording…' : 'Ready to start'}
            </p>
          </div>

          {/* Start / Stop */}
          <div className="flex gap-3">
            <button
              onClick={handleToggleTimer}
              disabled={isTimesheetMutating || (availableProjects.length === 0 && !isTimerRunning) || (!isTimerRunning && !isTodayInTimerTimeline)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white font-medium disabled:opacity-50 transition-all"
              style={isTimerRunning ? AXIOM.buttons.danger : AXIOM.buttons.success}
            >
              {isTimesheetMutating
                ? <div className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : isTimerRunning ? <Pause className="size-5" /> : <Play className="size-5" />}
              {isTimesheetMutating ? 'Saving…' : isTimerRunning ? 'Stop & Save' : availableProjects.length === 0 ? 'No Assigned Projects' : !isTodayInTimerTimeline ? 'Outside Timeline' : 'Start Timer'}
            </button>

            {/* Manual entry toggle */}
            <button
              onClick={() => setShowManualForm(v => !v)}
              disabled={availableProjects.length === 0}
              title={availableProjects.length === 0 ? 'No projects assigned' : 'Log time manually'}
              className="px-4 py-3 rounded-xl transition-all disabled:opacity-40"
              style={showManualForm ? AXIOM.buttons.primary : AXIOM.buttons.outline}
            >
              <Plus className="size-5 text-slate-400" />
            </button>
          </div>
        </motion.div>

        {/* Today Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl p-6"
          style={{ ...AXIOM.containers.chartGreen, borderRadius: '1rem' }}
        >
          <p className="text-xs text-slate-400 font-mono mb-2">TODAY</p>
          <p className="text-4xl font-bold text-white mb-1">{todayTotal}h</p>
          <p className="text-sm text-green-400 font-mono mb-4">{todayEntries.length} entries logged</p>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((todayTotal / 8) * 100, 100)}%` }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(to right, #10b981, #06b6d4)' }}
            />
          </div>
          <p className="text-xs text-slate-400 font-mono mt-2">{todayTotal}/8h target</p>

          {/* Today entries preview */}
          {todayEntries.length > 0 && (
            <div className="mt-4 space-y-2">
              {todayEntries.slice(0, 3).map(e => (
                <div key={e.id} className="flex items-center justify-between text-xs font-mono" style={{ color: 'rgba(148,163,184,0.8)' }}>
                  <span className="truncate max-w-28">{e.task}</span>
                  <span className="text-green-400 shrink-0 ml-2">{e.hours}h</span>
                </div>
              ))}
              {todayEntries.length > 3 && (
                <p className="text-xs text-slate-500 font-mono">+{todayEntries.length - 3} more</p>
              )}
            </div>
          )}
        </motion.div>

        {/* Week Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl p-6"
          style={{ ...AXIOM.containers.chartPurple, borderRadius: '1rem' }}
        >
          <p className="text-xs text-slate-400 font-mono mb-2">THIS WEEK</p>
          <p className="text-4xl font-bold text-white mb-1">{weekTotal}h</p>
          <p className="text-sm text-purple-400 font-mono mb-4">{activeWeekEntries.length} entries this week</p>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((weekTotal / 40) * 100, 100)}%` }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(to right, #a855f7, #ec4899)' }}
            />
          </div>
          <p className="text-xs text-slate-400 font-mono mt-2">{weekTotal}/40h target</p>

          {/* Draft count badge */}
          {draftCount > 0 && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg" style={{
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
            }}>
              <AlertCircle className="size-4 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-400 font-mono">{draftCount} draft{draftCount !== 1 ? 's' : ''} not submitted</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Manual Entry Form ── */}
      <AnimatePresence>
        {showManualForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl p-6" style={{
              background: AXIOM.backgrounds.chartContainer,
              border: '1px solid rgba(168,85,247,0.3)',
              boxShadow: '0 20px 60px -20px rgba(168,85,247,0.3)',
            }}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-white font-bold flex items-center gap-2">
                  <Zap className="size-4 text-purple-400" />
                  Log Time Manually
                </h3>
                <button onClick={() => setShowManualForm(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                  <X className="size-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-mono tracking-widest">DATE</label>
                  <input type="date" value={manualForm.date}
                    min={selectedManualProject?.startDate || undefined}
                    max={selectedManualProject?.endDate || undefined}
                    onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono"
                    style={{ ...inputStyle, colorScheme: 'dark' }} />
                  {selectedManualProject?.startDate && (
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                      Timeline: {selectedManualProject.startDate} {selectedManualProject.endDate ? `– ${selectedManualProject.endDate}` : ''}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-mono tracking-widest">PROJECT</label>
                  <select value={manualForm.projectId}
                    onChange={e => setManualForm(f => ({ ...f, projectId: e.target.value }))}
                    disabled={availableProjects.length === 0}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono disabled:opacity-50" style={inputStyle}>
                    {availableProjects.length === 0 ? (
                      <option value="" disabled className="bg-slate-900 text-slate-400">
                        No projects assigned to you
                      </option>
                    ) : (
                      availableProjects.map(p => (
                        <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                          {p.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-mono tracking-widest">HOURS</label>
                  <input type="number" placeholder="e.g. 2.5" min="0.25" step="0.25"
                    value={manualForm.hours}
                    onChange={e => setManualForm(f => ({ ...f, hours: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono" style={inputStyle} />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-mono tracking-widest">BILLABLE</label>
                  <button
                    onClick={() => setManualForm(f => ({ ...f, billable: !f.billable }))}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono flex items-center justify-center gap-2 transition-all"
                    style={manualForm.billable ? AXIOM.buttons.action : AXIOM.buttons.outline}
                  >
                    <DollarSign className="size-4" />
                    {manualForm.billable ? 'Billable' : 'Non-billable'}
                  </button>
                </div>

                {manualAssignedTasks.length > 0 && (
                  <div className="md:col-span-2 lg:col-span-4 space-y-1.5">
                    <label className="text-[10px] text-purple-400 font-mono tracking-widest block">QUICK SELECT ASSIGNED TASK (§13)</label>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {manualAssignedTasks.map((t: any) => {
                        const isSelected = manualTaskId === t.id || manualForm.task === t.title;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setManualForm(f => ({
                                ...f,
                                task: t.title,
                                projectId: t.projectId || f.projectId,
                                hours: f.hours || (t.estimatedHours ? String(Math.min(4, Math.max(1, (t.estimatedHours || 0) - (t.loggedHours || 0)))) : '4'),
                              }));
                              setManualTaskId(t.id);
                            }}
                            className={`text-[11px] font-mono px-2.5 py-1.5 rounded-md transition-all text-left flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-purple-500/30 text-purple-200 border border-purple-400/50'
                                : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                            }`}
                          >
                            <span className="truncate max-w-[140px]">{t.title}</span>
                            <span className="text-[9px] text-slate-400 shrink-0">
                              {t.loggedHours || 0}/{t.estimatedHours || 8}h
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="md:col-span-2 lg:col-span-4 space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-mono tracking-widest">TASK DESCRIPTION *</label>
                  <input type="text" placeholder="What did you work on?"
                    list="project-tasks-list"
                    value={manualForm.task}
                    onChange={e => {
                      setManualForm(f => ({ ...f, task: e.target.value }));
                      const matched = myAssignedTasks.find(t => t.title.toLowerCase() === e.target.value.trim().toLowerCase());
                      setManualTaskId(matched ? matched.id : '');
                    }}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono" style={inputStyle} />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleAddManual}
                  disabled={isTimesheetMutating || !manualForm.task.trim() || !manualForm.hours}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition-all"
                  style={AXIOM.buttons.success}
                >
                  {isTimesheetMutating
                    ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <Check className="size-4" />}
                  Log Entry
                </button>
                <button onClick={() => setShowManualForm(false)}
                  className="px-4 py-2.5 rounded-lg text-slate-400 text-sm" style={AXIOM.buttons.secondary}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Week Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-2xl p-6"
        style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}
      >
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Calendar className="size-5 text-blue-400" />
          Weekly Overview
        </h3>
        <div className="grid grid-cols-5 gap-4">
          {weekData.map((day, i) => (
            <motion.div
              key={day.day}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className="rounded-xl p-4"
              style={{
                background: day.hours >= 8 ? 'rgba(16,185,129,0.08)' : 'rgba(0,0,0,0.3)',
                border: day.date === todayDate()
                  ? '1px solid rgba(59,130,246,0.4)'
                  : day.hours >= 8
                    ? '1px solid rgba(16,185,129,0.2)'
                    : AXIOM.borders.default,
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400 font-mono">{day.day}</span>
                {day.date === todayDate() && (
                  <span className="text-[10px] text-blue-400 font-mono px-1.5 py-0.5 rounded" style={{
                    background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                  }}>TODAY</span>
                )}
              </div>
              <p className="text-2xl font-bold text-white font-mono mb-2">{day.hours}h</p>
              <div className="space-y-1">
                {day.entries.map(entry => (
                  <div key={entry.id} className="text-[10px] text-slate-400 font-mono truncate">
                    {entry.hours}h – {entry.task}
                  </div>
                ))}
              </div>

              {/* Tasks due or scheduled for this date */}
              {(() => {
                const dayTasks = myAssignedTasks.filter((t: any) => t.dueDate === day.date);
                if (dayTasks.length === 0) return null;
                return (
                  <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                    <p className="text-[9px] text-purple-400 font-mono tracking-wider">DUE TODAY</p>
                    {dayTasks.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between text-[10px] text-slate-300 font-mono bg-white/5 px-2 py-1 rounded">
                        <span className="truncate max-w-[80px]" title={t.title}>{t.title}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setManualForm({
                              date: day.date,
                              projectId: t.projectId || (availableProjects[0]?.id || ''),
                              task: t.title,
                              hours: '4',
                              billable: true,
                            });
                            setManualTaskId(t.id);
                            setShowManualForm(true);
                          }}
                          className="text-[9px] text-blue-400 hover:text-blue-300 ml-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30"
                          title="Log time for this task"
                        >
                          + Log
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {day.hours < 8 && (
                <button
                  type="button"
                  onClick={() => {
                    setManualForm(f => ({ ...f, date: day.date }));
                    setShowManualForm(true);
                  }}
                  className="mt-2 w-full text-center py-1 rounded text-[9px] font-mono text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  + Add Entry
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Time Entries List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="rounded-2xl overflow-hidden"
        style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}
      >
        <div className="p-6 pb-4 flex items-center justify-between">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Clock className="size-5 text-blue-400" />
            Time Entries
          </h3>
          {draftCount > 0 && (
            <button
              onClick={handleSubmitWeek}
              disabled={isTimesheetMutating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono disabled:opacity-50 transition-all"
              style={AXIOM.buttons.success}
            >
              {isTimesheetMutating
                ? <div className="size-3 border border-white/30 border-t-white rounded-full animate-spin" />
                : <Send className="size-3" />}
              Submit {draftCount} Draft{draftCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        <div className="divide-y" style={{ borderColor: 'rgba(148,163,184,0.1)' }}>
          {error ? (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">
              Could not load time entries. Try refreshing the page.
            </div>
          ) : svcTimesheets === null && loading ? (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">Loading entries…</div>
          ) : timesheetData.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="size-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 font-mono">No time entries yet</p>
              <p className="text-slate-500 font-mono text-xs mt-1">Start the timer or log manually</p>
            </div>
          ) : (
            timesheetData.map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.03 }}
                className="flex items-center gap-4 px-6 py-4 hover:bg-white/5 transition-colors"
              >
                <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{
                  background: entry.status === 'approved'  ? 'rgba(16,185,129,0.15)'  :
                              entry.status === 'submitted' ? 'rgba(245,158,11,0.15)'  : 'rgba(59,130,246,0.15)',
                  border: `1px solid ${
                    entry.status === 'approved'  ? 'rgba(16,185,129,0.3)'  :
                    entry.status === 'submitted' ? 'rgba(245,158,11,0.3)'  : 'rgba(59,130,246,0.3)'
                  }`,
                }}>
                  {entry.status === 'approved'
                    ? <Check  className="size-5 text-green-400" />
                    : entry.status === 'submitted'
                      ? <Clock  className="size-5 text-amber-400" />
                      : <Play   className="size-5 text-blue-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{entry.task}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs text-slate-400 font-mono">{entry.project}</p>
                    <p className="text-xs text-slate-500 font-mono">{entry.date}</p>
                    {entry.billable === false && (
                      <span className="text-[10px] text-slate-500 font-mono">non-billable</span>
                    )}
                  </div>
                </div>

                <span className="text-lg font-bold text-white font-mono shrink-0">{entry.hours}h</span>

                <span className="text-xs font-mono px-2 py-1 rounded capitalize shrink-0" style={{
                  background: entry.status === 'approved'  ? 'rgba(16,185,129,0.1)'  :
                              entry.status === 'submitted' ? 'rgba(245,158,11,0.1)'  : 'rgba(59,130,246,0.1)',
                  border: `1px solid ${
                    entry.status === 'approved'  ? 'rgba(16,185,129,0.2)'  :
                    entry.status === 'submitted' ? 'rgba(245,158,11,0.2)'  : 'rgba(59,130,246,0.2)'
                  }`,
                  color: entry.status === 'approved'  ? '#34d399' :
                         entry.status === 'submitted' ? '#fbbf24' : '#60a5fa',
                }}>
                  {entry.status}
                </span>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    
      {/* Autocomplete Datalist for Project Deliverables (§13 Work Domain) */}
      <datalist id="project-tasks-list">
        {(myAssignedTasks ?? []).map((t: any) => (
          <option key={t.id} value={t.title}>
            {t.projectName ? `${t.projectName} • ` : ''}{t.status} (${t.loggedHours || 0}h / ${t.estimatedHours || 0}h)
          </option>
        ))}
      </datalist>

    </PageShell>
  );
}