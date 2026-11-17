import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { PageShell, PageHeader } from '../layout';
import {
  Clock, Plus, ChevronLeft, ChevronRight, Play, Pause, RotateCcw,
  Check, Calendar, Send, X, CheckCircle, AlertCircle,
  Zap, DollarSign, Wifi, WifiOff, Square,
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { projectService } from '@/services/projectService';
import { organizationService } from '@/services/organizationService';
import type { TimesheetEntry } from '@/services/employeeService';
import { useService, useMutation } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import {
  reconcileTask,
  validateTaskHoursAllocation,
  todayYmdLocal,
} from '@/lib/taskReconciler';
import {
  computeElapsedSeconds,
  computeLoggedDuration,
  generateClientEventId,
  saveTimerSnapshot,
  loadTimerSnapshot,
  clearTimerSnapshot,
  enqueueOfflineTimeEntry,
  getOfflineOutbox,
  type TimerSnapshot,
} from '@/lib/timerRecovery';

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
  return todayYmdLocal();
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

  // Live system clock for automatic date & time display (no manual date entry)
  const [nowClock, setNowClock] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const liveTodayStr = todayYmdLocal(nowClock);
  const liveTimeStr = nowClock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ── Service data ──
  const { data: svcTimesheets, loading, error, refetch } = useService(
    () => (orgId && userId ? employeeService.getTimesheets(orgId, userId) : Promise.resolve({ success: true, data: [] })),
    [orgId, userId],
    ['timesheets'],
  );

  // Reconcile assigned tasks with live timesheet entries so logged/approved/incomplete hours are always accurate
  const reconciledTasks = useMemo(
    () => myAssignedTasks.map((t) => reconcileTask(t, svcTimesheets ?? [], liveTodayStr)),
    [myAssignedTasks, svcTimesheets, liveTodayStr],
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
      } catch { }
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
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerProjectId, setTimerProjectId] = useState('');
  const [timerTask, setTimerTask] = useState('');
  const [timerBillable, setTimerBillable] = useState(true);
  const [timerTaskId, setTimerTaskId] = useState('');
  const [manualTaskId, setManualTaskId] = useState('');
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isSavingTimer, setIsSavingTimer] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [recoveredNotice, setRecoveredNotice] = useState<string | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<TimerSnapshot | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timesheetActionLockRef = useRef(false);
  const toastDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerStartTimeRef = useRef<Date | null>(null);
  const activeSnapshotRef = useRef<TimerSnapshot | null>(null);
  activeSnapshotRef.current = activeSnapshot;

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
    if (!reconciledTasks.length) return [];
    return timerProjectId
      ? reconciledTasks.filter(t => t.projectId === timerProjectId)
      : reconciledTasks;
  }, [reconciledTasks, timerProjectId]);

  const manualAssignedTasks = useMemo(() => {
    if (!reconciledTasks.length) return [];
    return manualForm.projectId
      ? reconciledTasks.filter(t => t.projectId === manualForm.projectId)
      : reconciledTasks;
  }, [reconciledTasks, manualForm.projectId]);

  const selectedManualTask = useMemo(() => {
    return (
      reconciledTasks.find(t => t.id === manualTaskId) ||
      reconciledTasks.find(t => t.title.trim().toLowerCase() === manualForm.task.trim().toLowerCase()) ||
      null
    );
  }, [reconciledTasks, manualTaskId, manualForm.task]);

  const selectedTimerTask = useMemo(() => {
    return (
      reconciledTasks.find(t => t.id === timerTaskId) ||
      reconciledTasks.find(t => t.title.trim().toLowerCase() === timerTask.trim().toLowerCase()) ||
      null
    );
  }, [reconciledTasks, timerTaskId, timerTask]);

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

  // ── Connectivity listener & offline outbox auto-sync ──
  useEffect(() => {
    if (!orgId || !userId) return;
    setPendingOutboxCount(getOfflineOutbox(orgId, userId).length);

    const syncOutbox = async () => {
      const pending = getOfflineOutbox(orgId, userId);
      if (pending.length === 0) return;
      const { syncedCount } = await employeeService.flushOfflineTimerOutbox(orgId, userId);
      setPendingOutboxCount(getOfflineOutbox(orgId, userId).length);
      if (syncedCount > 0) {
        await Promise.all([refetch(), refetchTasks()]);
        showToast(`Recovered & synced ${syncedCount} offline timer entr${syncedCount === 1 ? 'y' : 'ies'}.`);
      }
    };

    const onOnline = () => {
      setIsOnline(true);
      void syncOutbox();
    };
    const onOffline = () => {
      setIsOnline(false);
      showToast('Connection lost — Live Timer continues locally and will auto-sync.');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (navigator.onLine) {
      void syncOutbox();
    }
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [orgId, userId]);

  // ── Restore running/paused timer session from server or local snapshot on mount ──
  useEffect(() => {
    if (!orgId || !userId) return;
    let cancelled = false;

    const restoreSession = async () => {
      let restored: TimerSnapshot | null = loadTimerSnapshot(orgId, userId);

      if (!restored && navigator.onLine) {
        const res = await employeeService.getActiveTimer(orgId, userId);
        if (res.success && res.data && (res.data.status === 'running' || res.data.status === 'paused')) {
          restored = {
            sessionId: res.data.id,
            organizationId: res.data.organizationId,
            userId: res.data.userId,
            projectId: res.data.projectId,
            projectName: res.data.projectName || '',
            taskId: res.data.taskId,
            description: res.data.description,
            billable: res.data.billable,
            startedAt: res.data.startedAt,
            pausedAt: res.data.pausedAt,
            accumulatedSeconds: res.data.accumulatedSeconds,
            status: res.data.status,
            clientEventId: res.data.clientEventId,
            lastUpdatedAt: new Date().toISOString(),
          };
          saveTimerSnapshot(restored);
        }
      }

      if (cancelled || !restored) return;

      const computed = computeElapsedSeconds(restored, Date.now());
      setActiveSnapshot(restored);
      setTimerProjectId(restored.projectId);
      setTimerTask(restored.description);
      setTimerTaskId(restored.taskId || '');
      setTimerBillable(restored.billable);
      setElapsedSeconds(computed);
      timerStartTimeRef.current = new Date(restored.startedAt);
      setIsTimerRunning(restored.status === 'running');
      setIsTimerPaused(restored.status === 'paused');
      setRecoveredNotice(
        `Recovered ${restored.status} timer (${formatElapsed(computed)}) started at ${new Date(restored.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
      );
    };

    void restoreSession();
    return () => { cancelled = true; };
  }, [orgId, userId]);

  // ── Wall-clock ticker (zero drift on tab sleep/backgrounding) ──
  useEffect(() => {
    if (!isTimerRunning || !activeSnapshot || activeSnapshot.status !== 'running') {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }

    const syncWallClock = () => {
      const snap = activeSnapshotRef.current;
      if (!snap || snap.status !== 'running') return;
      const secs = computeElapsedSeconds(snap, Date.now());
      setElapsedSeconds(secs);
    };

    syncWallClock();
    intervalRef.current = setInterval(syncWallClock, 1000);
    window.addEventListener('visibilitychange', syncWallClock);
    window.addEventListener('focus', syncWallClock);

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      window.removeEventListener('visibilitychange', syncWallClock);
      window.removeEventListener('focus', syncWallClock);
    };
  }, [isTimerRunning, activeSnapshot]);

  // ── Timer control ──
  const startTimer = async () => {
    if (selectedTimerProject?.startDate && todayDate() < selectedTimerProject.startDate) {
      showToast(`Cannot log time: ${selectedTimerProject.name} starts on ${selectedTimerProject.startDate}`);
      return;
    }
    if (selectedTimerProject?.endDate && todayDate() > selectedTimerProject.endDate) {
      showToast(`Cannot log time: ${selectedTimerProject.name} ended on ${selectedTimerProject.endDate}`);
      return;
    }
    if (!timerTask.trim()) {
      showToast('Please select an assigned task or enter a task description first.');
      return;
    }
    const matchedTimerTask =
      reconciledTasks.find(t => t.id === timerTaskId) ||
      reconciledTasks.find(t => t.title.trim().toLowerCase() === timerTask.trim().toLowerCase());
    if (matchedTimerTask) {
      const check = validateTaskHoursAllocation(matchedTimerTask, svcTimesheets ?? [], 0.01);
      if (!check.ok) {
        showToast(check.error);
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const isResuming = isTimerPaused && activeSnapshot;
    const clientEventId = isResuming ? activeSnapshot.clientEventId : generateClientEventId('evt_ts');
    const sessionId = isResuming ? activeSnapshot.sessionId : `tmr_${Date.now()}`;
    const accumulatedSeconds = isResuming ? activeSnapshot.accumulatedSeconds : 0;

    const snap: TimerSnapshot = {
      sessionId,
      organizationId: orgId,
      userId,
      projectId: timerProjectId,
      projectName: selectedTimerProject?.name || 'Project',
      taskId: timerTaskId || matchedTimerTask?.id || undefined,
      description: timerTask.trim(),
      billable: timerBillable,
      startedAt: nowIso,
      accumulatedSeconds,
      status: 'running',
      clientEventId,
      lastUpdatedAt: nowIso,
    };

    timerStartTimeRef.current = new Date(nowIso);
    saveTimerSnapshot(snap);
    setActiveSnapshot(snap);
    setIsTimerRunning(true);
    setIsTimerPaused(false);
    setRecoveredNotice(null);

    if (navigator.onLine) {
      void employeeService.startTimerSession(orgId, userId, {
        projectId: snap.projectId,
        projectName: snap.projectName,
        taskId: snap.taskId,
        description: snap.description,
        billable: snap.billable,
        startedAt: snap.startedAt,
        accumulatedSeconds: snap.accumulatedSeconds,
        clientEventId: snap.clientEventId,
        sessionId: snap.sessionId,
      });
    }
  };

  const pauseTimer = async () => {
    const snap = activeSnapshotRef.current;
    if (!snap || !isTimerRunning) return;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const currentElapsed = computeElapsedSeconds(snap, nowMs);

    const pausedSnap: TimerSnapshot = {
      ...snap,
      status: 'paused',
      pausedAt: nowIso,
      accumulatedSeconds: currentElapsed,
      lastUpdatedAt: nowIso,
    };

    saveTimerSnapshot(pausedSnap);
    setActiveSnapshot(pausedSnap);
    setElapsedSeconds(currentElapsed);
    setIsTimerRunning(false);
    setIsTimerPaused(true);

    if (navigator.onLine) {
      void employeeService.pauseTimerSession(orgId, userId, {
        clientEventId: snap.clientEventId,
        pausedAt: nowIso,
        accumulatedSeconds: currentElapsed,
      });
    }
    showToast(`Timer paused at ${formatElapsed(currentElapsed)}`);
  };

  const stopTimer = async () => {
    if (timesheetActionLockRef.current) return;
    timesheetActionLockRef.current = true;
    setIsSavingTimer(true);

    try {
      const snap = activeSnapshotRef.current;
      const stopDt = new Date();
      const stopIso = stopDt.toISOString();
      const exactSeconds = snap ? Math.max(1, computeElapsedSeconds(snap, stopDt.getTime())) : Math.max(1, elapsedSeconds);
      const startDt = snap ? new Date(snap.startedAt) : (timerStartTimeRef.current || new Date(stopDt.getTime() - exactSeconds * 1000));

      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setIsTimerRunning(false);
      setIsTimerPaused(false);
      setElapsedSeconds(exactSeconds);

      const projId = snap?.projectId || timerProjectId;
      const project = availableProjects.find(p => p.id === projId) || { id: projId, name: snap?.projectName || 'Project' };
      const today = todayDate();
      if ((project as any)?.startDate && today < (project as any).startDate) {
        showToast(`Cannot log time: ${project.name} starts on ${(project as any).startDate}`);
        return;
      }
      if ((project as any)?.endDate && today > (project as any).endDate) {
        showToast(`Cannot log time: ${project.name} ended on ${(project as any).endDate}`);
        return;
      }

      const taskDesc = (snap?.description || timerTask).trim() || 'Timer entry';
      const resolvedTaskId = snap?.taskId || timerTaskId || undefined;
      const matchedTask =
        reconciledTasks.find(t => t.id === resolvedTaskId) ||
        reconciledTasks.find(t => (t.title || '').toLowerCase() === taskDesc.toLowerCase());

      const { durationSeconds, durationMinutes, hours } = computeLoggedDuration(exactSeconds);

      if (matchedTask) {
        const check = validateTaskHoursAllocation(matchedTask, svcTimesheets ?? [], hours);
        if (!check.ok) {
          showToast(check.error);
          clearTimerSnapshot(orgId, userId);
          setActiveSnapshot(null);
          setElapsedSeconds(0);
          return;
        }
      }

      const clientEventId = snap?.clientEventId || generateClientEventId('evt_ts');
      const startTimeStr = startDt.toTimeString().slice(0, 5);
      const endTimeStr = stopDt.toTimeString().slice(0, 5);

      const queueOffline = () => {
        enqueueOfflineTimeEntry({
          clientEventId,
          organizationId: orgId,
          userId,
          queuedAt: stopIso,
          entry: {
            date: today,
            projectId: projId,
            projectName: project.name,
            hours,
            description: taskDesc,
            taskId: resolvedTaskId || matchedTask?.id,
            billable: snap?.billable ?? timerBillable,
            status: 'draft',
            startTime: startTimeStr,
            endTime: endTimeStr,
            durationMinutes,
            durationSeconds,
            clientEventId,
            source: 'offline_recovered',
          },
        });
        setPendingOutboxCount(getOfflineOutbox(orgId, userId).length);
        clearTimerSnapshot(orgId, userId);
        setActiveSnapshot(null);
        setElapsedSeconds(0);
        setTimerTask('');
        setTimerTaskId('');
        setRecoveredNotice(null);
        showToast(`Offline: Saved ${formatElapsed(exactSeconds)} (${hours}h) to recovery queue. Will sync automatically.`);
      };

      if (!navigator.onLine) {
        queueOffline();
        return;
      }

      const result = await employeeService.stopTimerSession(orgId, userId, {
        clientEventId,
        projectId: projId,
        projectName: project.name,
        taskId: resolvedTaskId || matchedTask?.id,
        description: taskDesc,
        billable: snap?.billable ?? timerBillable,
        startedAt: startDt.toISOString(),
        stoppedAt: stopIso,
        elapsedSeconds: exactSeconds,
        source: recoveredNotice ? 'offline_recovered' : 'live_timer',
      });

      if (result.success) {
        clearTimerSnapshot(orgId, userId);
        setActiveSnapshot(null);
        setRecoveredNotice(null);
        await Promise.all([refetch(), refetchTasks()]);
        setElapsedSeconds(0);
        setTimerTask('');
        setTimerTaskId('');
        showToast(`Stopped at ${endTimeStr} — Saved ${formatElapsed(exactSeconds)} (${hours}h) on ${project.name}`);
      } else if (result.error && /network|fetch|timed out|offline/i.test(result.error)) {
        queueOffline();
      } else {
        showToast(result.error || 'Failed to save timer hours');
      }
    } finally {
      setIsSavingTimer(false);
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
    if (isTimerRunning) void stopTimer();
    else void startTimer();
  };

  const handleDiscardRecoveredTimer = () => {
    clearTimerSnapshot(orgId, userId);
    setActiveSnapshot(null);
    setIsTimerRunning(false);
    setIsTimerPaused(false);
    setElapsedSeconds(0);
    setRecoveredNotice(null);
    showToast('Timer session discarded.');
  };

  // ── Manual entry ──
  const handleAddManual = async () => {
    const hrs = parseFloat(manualForm.hours);
    if (!manualForm.task.trim() || isNaN(hrs) || hrs <= 0) return;
    if (timesheetActionLockRef.current) return;

    const autoToday = todayDate();
    const project = availableProjects.find(p => p.id === manualForm.projectId) || { id: manualForm.projectId, name: 'Project' };
    if ((project as any)?.startDate && autoToday < (project as any).startDate) {
      showToast(`Cannot log time: ${project.name} starts on ${(project as any).startDate}`);
      return;
    }
    if ((project as any)?.endDate && autoToday > (project as any).endDate) {
      showToast(`Cannot log time: ${project.name} ended on ${(project as any).endDate}`);
      return;
    }

    const matchedTask =
      reconciledTasks.find(t => t.id === manualTaskId) ||
      reconciledTasks.find(t => (t.title || '').toLowerCase() === manualForm.task.trim().toLowerCase());

    if (matchedTask) {
      const check = validateTaskHoursAllocation(matchedTask, svcTimesheets ?? [], hrs);
      if (!check.ok) {
        showToast(check.error);
        return;
      }
    }

    timesheetActionLockRef.current = true;
    try {
      const durationMins = Math.round(hrs * 60);
      const endDt = new Date();
      const startDt = new Date(endDt.getTime() - durationMins * 60 * 1000);
      const startTimeStr = startDt.toTimeString().slice(0, 5);
      const endTimeStr = endDt.toTimeString().slice(0, 5);

      const result = await createMutation.execute({
        date: autoToday,
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
        showToast(`Logged ${hrs}h on ${project.name} (${autoToday})`);
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
  const weekEndDate = weekData.length > 0 ? weekData[weekData.length - 1].date : '';

  const activeWeekEntries = useMemo(() => {
    return timesheetData.filter(e => e.date >= weekStartDate && e.date <= weekEndDate);
  }, [timesheetData, weekStartDate, weekEndDate]);

  const todayEntries = timesheetData.filter(e => e.date === todayDate());
  const todayTotal = todayEntries.reduce((s, e) => s + e.hours, 0);
  const weekTotal = activeWeekEntries.reduce((s, e) => s + e.hours, 0);
  const draftCount = timesheetData.filter(e => e.status === 'logged').length;

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
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-2">
              <Clock className="size-5 text-blue-400" />
              <h3 className="text-white font-bold">Live Timer</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {pendingOutboxCount > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {pendingOutboxCount} queued
                </span>
              )}
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1 border ${isOnline
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}>
                {isOnline ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                {isOnline ? 'Synced' : 'Offline Recovery'}
              </span>
            </div>
          </div>

          {recoveredNotice && (
            <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-amber-200">{recoveredNotice}</span>
              <button
                type="button"
                onClick={handleDiscardRecoveredTimer}
                className="text-[10px] font-mono text-slate-400 hover:text-white shrink-0 underline"
              >
                Discard
              </button>
            </div>
          )}

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
                    const estH = Number(t.estimatedHours || 0);
                    const logH = Number(t.loggedHours || 0);
                    const isClosedOrFull = t.status === 'completed' || (estH > 0 && logH >= estH);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          if (isClosedOrFull) {
                            showToast(`Task "${t.title}" is closed (${logH}/${estH || logH}h).`);
                            return;
                          }
                          setTimerTask(t.title);
                          setTimerTaskId(t.id);
                          if (t.projectId && t.projectId !== timerProjectId) {
                            setTimerProjectId(t.projectId);
                          }
                        }}
                        disabled={isTimerRunning || isClosedOrFull}
                        title={isClosedOrFull ? `Closed (${logH}/${estH}h)` : `Click to select (${logH}/${estH}h)`}
                        className={`text-[10px] font-mono px-2 py-1 rounded-md transition-all text-left flex items-center gap-1 ${isClosedOrFull
                          ? 'bg-emerald-500/10 text-emerald-300/60 border border-emerald-500/20 opacity-70 cursor-not-allowed'
                          : isSelected
                            ? 'bg-blue-500/30 text-blue-200 border border-blue-400/50 shadow-sm'
                            : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                          }`}
                      >
                        <span className="truncate max-w-[120px]">{t.title}</span>
                        <span className="text-[9px] text-slate-400 shrink-0">
                          {logH}/{estH || 8}h{isClosedOrFull ? ' ✓' : ''}
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
              {isTimerRunning
                ? `Recording since ${activeSnapshot?.startedAt ? new Date(activeSnapshot.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
                : isTimerPaused
                  ? `Paused at ${formatElapsed(elapsedSeconds)} — Resume or Stop & Save`
                  : 'Ready to start'}
            </p>
            {selectedTimerTask && (
              <p className="text-[11px] font-mono text-cyan-300/90 mt-1.5">
                Task Total: {Number(selectedTimerTask.loggedHours || 0).toFixed(2)}h
                {(selectedTimerTask.estimatedHours || 0) > 0 && (
                  <> / {selectedTimerTask.estimatedHours}h ({Math.max(0, Number(selectedTimerTask.estimatedHours || 0) - Number(selectedTimerTask.loggedHours || 0)).toFixed(2)}h left)</>
                )}
              </p>
            )}
          </div>

          {/* Start / Pause / Stop & Save */}
          <div className="flex gap-2">
            {(isTimerRunning || isTimerPaused) ? (
              <>
                <button
                  type="button"
                  onClick={() => (isTimerRunning ? void pauseTimer() : void startTimer())}
                  disabled={isSavingTimer}
                  className="px-4 py-3 rounded-xl text-white font-medium disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  style={isTimerRunning ? AXIOM.buttons.outline : AXIOM.buttons.action}
                  title={isTimerRunning ? 'Pause timer without saving yet' : 'Resume timer'}
                >
                  {isTimerRunning ? <Pause className="size-4" /> : <Play className="size-4" />}
                  <span className="text-xs font-mono">{isTimerRunning ? 'Pause' : 'Resume'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void stopTimer()}
                  disabled={isSavingTimer || isTimesheetMutating}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white font-medium disabled:opacity-50 transition-all"
                  style={AXIOM.buttons.danger}
                >
                  {(isSavingTimer || isTimesheetMutating)
                    ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <Square className="size-4 fill-current" />}
                  {(isSavingTimer || isTimesheetMutating) ? 'Saving…' : 'Stop & Save'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleToggleTimer}
                disabled={isTimesheetMutating || availableProjects.length === 0 || !isTodayInTimerTimeline}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white font-medium disabled:opacity-50 transition-all"
                style={AXIOM.buttons.success}
              >
                {isTimesheetMutating
                  ? <div className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Play className="size-5" />}
                {isTimesheetMutating ? 'Saving…' : availableProjects.length === 0 ? 'No Assigned Projects' : !isTodayInTimerTimeline ? 'Outside Timeline' : 'Start Timer'}
              </button>
            )}

            {/* Manual entry toggle */}
            <button
              onClick={() => setShowManualForm(v => !v)}
              disabled={availableProjects.length === 0 || isTimerRunning}
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
                  <label className="text-[10px] text-slate-400 font-mono tracking-widest">AUTO DATE & TIME</label>
                  <div
                    className="w-full px-3 py-2.5 rounded-lg text-xs font-mono flex items-center justify-between"
                    style={{ ...inputStyle, border: '1px solid rgba(59,130,246,0.35)' }}
                    title="Automatically stamped from current system date and time"
                  >
                    <span className="text-cyan-300 font-semibold">{liveTodayStr}</span>
                    <span className="text-slate-400">{liveTimeStr}</span>
                  </div>
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
                  {(() => {
                    const dailyRem = Math.max(0, Math.round((8 - manualFormDayLogged) * 100) / 100);
                    const taskRem = selectedManualTask && (selectedManualTask.estimatedHours || 0) > 0
                      ? Math.max(0, Math.round(((selectedManualTask.estimatedHours || 0) - (selectedManualTask.loggedHours || 0)) * 100) / 100)
                      : dailyRem;
                    const maxAllowed = Math.min(dailyRem, taskRem);
                    return (
                      <>
                        <input
                          type="number"
                          placeholder="e.g. 2.5"
                          min="0.25"
                          max={maxAllowed > 0 ? maxAllowed : undefined}
                          step="0.25"
                          value={manualForm.hours}
                          onChange={e => setManualForm(f => ({ ...f, hours: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg text-sm font-mono"
                          style={inputStyle}
                        />
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Today left: {dailyRem.toFixed(1)}h
                          {selectedManualTask && (selectedManualTask.estimatedHours || 0) > 0 && (
                            <span className="text-purple-300"> • Task left: {taskRem.toFixed(1)}h/{selectedManualTask.estimatedHours}h</span>
                          )}
                        </p>
                      </>
                    );
                  })()}
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
                        const estH = Number(t.estimatedHours || 0);
                        const logH = Number(t.loggedHours || 0);
                        const isClosedOrFull = t.status === 'completed' || (estH > 0 && logH >= estH);
                        const remH = estH > 0 ? Math.max(0, estH - logH) : 4;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={isClosedOrFull}
                            title={isClosedOrFull ? `Task closed (${logH}/${estH}h)` : `Select task (${remH}h remaining)`}
                            onClick={() => {
                              if (isClosedOrFull) return;
                              setManualForm(f => ({
                                ...f,
                                date: liveTodayStr,
                                task: t.title,
                                projectId: t.projectId || f.projectId,
                                hours: String(Math.min(4, Math.max(0.25, remH))),
                              }));
                              setManualTaskId(t.id);
                            }}
                            className={`text-[11px] font-mono px-2.5 py-1.5 rounded-md transition-all text-left flex items-center gap-1.5 ${isClosedOrFull
                              ? 'bg-emerald-500/10 text-emerald-300/60 border border-emerald-500/20 opacity-70 cursor-not-allowed'
                              : isSelected
                                ? 'bg-purple-500/30 text-purple-200 border border-purple-400/50'
                                : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                              }`}
                          >
                            <span className="truncate max-w-[140px]">{t.title}</span>
                            <span className="text-[9px] text-slate-400 shrink-0">
                              {logH}/{estH || 8}h{isClosedOrFull ? ' ✓ Closed' : ''}
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
                const dayTasks = reconciledTasks.filter((t: any) => t.dueDate === day.date || t.startDate === day.date);
                if (dayTasks.length === 0) return null;
                return (
                  <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
                    <p className="text-[9px] text-purple-400 font-mono tracking-wider">ASSIGNED TASKS</p>
                    {dayTasks.map((t: any) => {
                      const estH = Number(t.estimatedHours || 0);
                      const logH = Number(t.loggedHours || 0);
                      const isClosed = t.status === 'completed';
                      const isPartial = t.completionStatus === 'closed_partial';
                      const isOnTime = t.completionStatus === 'completed_on_time';
                      const isOverdue = t.completionStatus === 'overdue' || t.completionStatus === 'completed_late';
                      const remH = estH > 0 ? Math.max(0, estH - logH) : 4;
                      return (
                        <div key={t.id} className="text-[10px] text-slate-300 font-mono bg-white/5 px-2 py-1.5 rounded space-y-0.5">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate max-w-[90px]" title={t.title}>{t.title}</span>
                            <span className={`text-[9px] px-1 rounded ${isOnTime ? 'bg-emerald-500/20 text-emerald-300' :
                              isPartial ? 'bg-amber-500/20 text-amber-300' :
                                isOverdue ? 'bg-rose-500/20 text-rose-300' :
                                  'bg-blue-500/20 text-blue-300'
                              }`}>
                              {isOnTime ? 'On Time' : isPartial ? 'Partial' : isOverdue ? 'Late' : `${logH}/${estH || 8}h`}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-slate-400">
                            <span>{logH}h / {estH || 8}h</span>
                            {!isClosed && remH > 0 && day.date === liveTodayStr && (
                              <button
                                type="button"
                                onClick={() => {
                                  setManualForm({
                                    date: liveTodayStr,
                                    projectId: t.projectId || (availableProjects[0]?.id || ''),
                                    task: t.title,
                                    hours: String(Math.min(4, remH)),
                                    billable: true,
                                  });
                                  setManualTaskId(t.id);
                                  setShowManualForm(true);
                                }}
                                className="text-[9px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30"
                                title="Log time for this task"
                              >
                                + Log
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                  background: entry.status === 'approved' ? 'rgba(16,185,129,0.15)' :
                    entry.status === 'submitted' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                  border: `1px solid ${entry.status === 'approved' ? 'rgba(16,185,129,0.3)' :
                    entry.status === 'submitted' ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)'
                    }`,
                }}>
                  {entry.status === 'approved'
                    ? <Check className="size-5 text-green-400" />
                    : entry.status === 'submitted'
                      ? <Clock className="size-5 text-amber-400" />
                      : <Play className="size-5 text-blue-400" />}
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
                  background: entry.status === 'approved' ? 'rgba(16,185,129,0.1)' :
                    entry.status === 'submitted' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)',
                  border: `1px solid ${entry.status === 'approved' ? 'rgba(16,185,129,0.2)' :
                    entry.status === 'submitted' ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'
                    }`,
                  color: entry.status === 'approved' ? '#34d399' :
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