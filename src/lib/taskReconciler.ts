import type { ProjectTask, TaskCompletionStatus } from '../services/types';

const AUTO_CLOSE_REGEX = /\[Auto-Closed[^\]]*\]:\s*(.+)$/i;

export function todayYmdLocal(ref: Date = new Date()): string {
  const y = ref.getFullYear();
  const m = String(ref.getMonth() + 1).padStart(2, '0');
  const d = String(ref.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentWeekWeekdays(ref: Date = new Date()): Array<{ day: string; date: string; label: string }> {
  const d = new Date(ref);
  const dow = d.getDay();
  const diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return dayNames.map((day, idx) => {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + idx);
    const date = todayYmdLocal(cur);
    const label = cur.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { day, date, label };
  });
}

export function parseAutoCloseNote(description?: string): { cleanDescription: string; completionNote?: string } {
  const raw = String(description || '').trim();
  if (!raw) return { cleanDescription: '' };
  const match = raw.match(AUTO_CLOSE_REGEX);
  if (!match) return { cleanDescription: raw };
  const cleanDescription = raw.replace(AUTO_CLOSE_REGEX, '').trim();
  return {
    cleanDescription,
    completionNote: match[1]?.trim() || undefined,
  };
}

export function buildAutoCloseDescription(existingDesc: string | undefined, note: string): string {
  const { cleanDescription } = parseAutoCloseNote(existingDesc);
  const prefix = cleanDescription ? `${cleanDescription} ` : '';
  return `${prefix}[Auto-Closed]: ${note}`.trim();
}

export function doesEntryMatchTask(entry: any, task: any): boolean {
  if (!entry || !task) return false;
  const entryTaskId = entry.taskId ?? entry.task_id;
  if (entryTaskId && task.id && String(entryTaskId) === String(task.id)) {
    return true;
  }
  const entryProjId = entry.projectId ?? entry.project_id;
  const taskProjId = task.projectId ?? task.project_id;
  if (entryProjId && taskProjId && String(entryProjId) !== String(taskProjId)) {
    return false;
  }
  const entryDesc = String(entry.description || '').trim().toLowerCase();
  const taskTitle = String(task.title || '').trim().toLowerCase();
  return Boolean(entryDesc && taskTitle && entryDesc === taskTitle);
}

export function reconcileTask(
  rawTask: any,
  timesheets: any[],
  todayStr: string = todayYmdLocal(),
): ProjectTask {
  const taskId = String(rawTask.id);
  const orgId = String(rawTask.organizationId ?? rawTask.organization_id ?? '');
  const projectId = String(rawTask.projectId ?? rawTask.project_id ?? '');
  const estimatedHours = Number(rawTask.estimatedHours ?? rawTask.estimated_hours ?? 0);
  const dueDate = rawTask.dueDate ?? rawTask.due_date ?? undefined;
  const startDate = rawTask.startDate ?? rawTask.start_date ?? undefined;
  const status = (rawTask.status || 'todo') as ProjectTask['status'];

  const matchingEntries = (timesheets || []).filter((e) => doesEntryMatchTask(e, {
    id: taskId,
    projectId,
    title: rawTask.title,
  }));

  const loggedHours = Math.round(
    matchingEntries.reduce((sum, e) => sum + Number(e.hours || 0), 0) * 100,
  ) / 100;

  const approvedEntries = matchingEntries.filter((e) => e.status === 'approved');
  const approvedHours = Math.round(
    approvedEntries.reduce((sum, e) => sum + Number(e.hours || 0), 0) * 100,
  ) / 100;

  const { cleanDescription, completionNote: parsedNote } = parseAutoCloseNote(rawTask.description);

  let incompleteHours = 0;
  if (estimatedHours > 0) {
    incompleteHours = status === 'completed'
      ? Math.max(0, Math.round((estimatedHours - approvedHours) * 100) / 100)
      : Math.max(0, Math.round((estimatedHours - loggedHours) * 100) / 100);
  }

  const lastApprovedDate = approvedEntries
    .map((e) => String(e.date || ''))
    .filter(Boolean)
    .sort()
    .pop();

  let completionStatus: TaskCompletionStatus = 'scheduled';
  if (status === 'completed') {
    if (estimatedHours > 0 && approvedHours < estimatedHours - 0.001) {
      completionStatus = 'closed_partial';
    } else if (dueDate && lastApprovedDate && lastApprovedDate > dueDate) {
      completionStatus = 'completed_late';
    } else {
      completionStatus = 'completed_on_time';
    }
  } else if (dueDate && dueDate < todayStr) {
    completionStatus = 'overdue';
  } else if (loggedHours > 0 || status === 'in_progress') {
    completionStatus = 'in_progress';
  }

  let completionNote = parsedNote;
  if (!completionNote && status === 'completed') {
    if (completionStatus === 'closed_partial') {
      completionNote = `Logged ${approvedHours.toFixed(1)}h of ${estimatedHours.toFixed(1)}h allocated (${incompleteHours.toFixed(1)}h incomplete)`;
    } else if (completionStatus === 'completed_late') {
      completionNote = `Completed late (${approvedHours.toFixed(1)}h approved after due date ${dueDate})`;
    } else {
      completionNote = `Completed on time (${approvedHours.toFixed(1)}h approved)`;
    }
  }

  return {
    id: taskId,
    organizationId: orgId,
    projectId,
    projectName: rawTask.projectName ?? rawTask.project_name ?? undefined,
    title: String(rawTask.title ?? ''),
    description: cleanDescription,
    assignedTo: (rawTask.assignedTo ?? rawTask.assigned_to) ? String(rawTask.assignedTo ?? rawTask.assigned_to) : undefined,
    assignedToName: (rawTask.assignedToName ?? rawTask.assigned_to_name) ? String(rawTask.assignedToName ?? rawTask.assigned_to_name) : undefined,
    status,
    priority: (rawTask.priority || 'medium') as ProjectTask['priority'],
    estimatedHours,
    loggedHours: matchingEntries.length > 0 ? loggedHours : Number(rawTask.loggedHours ?? rawTask.logged_hours ?? 0),
    approvedHours,
    incompleteHours,
    completionNote,
    completionStatus,
    closedAt: rawTask.closedAt ?? rawTask.updatedAt ?? rawTask.updated_at ?? undefined,
    startDate: startDate ? String(startDate) : undefined,
    dueDate: dueDate ? String(dueDate) : undefined,
    createdAt: (rawTask.createdAt ?? rawTask.created_at) ? String(rawTask.createdAt ?? rawTask.created_at) : undefined,
    updatedAt: (rawTask.updatedAt ?? rawTask.updated_at) ? String(rawTask.updatedAt ?? rawTask.updated_at) : undefined,
  };
}

export function validateTaskHoursAllocation(
  task: any,
  allTimesheets: any[],
  newHours: number,
): { ok: true; remainingHours: number; existingHours: number } | { ok: false; error: string; remainingHours: number; existingHours: number } {
  const estHours = Number(task.estimatedHours ?? task.estimated_hours ?? 0);
  const matching = (allTimesheets || []).filter((e) => doesEntryMatchTask(e, task));
  const existingHours = Math.round(
    matching.reduce((sum, e) => sum + Number(e.hours || 0), 0) * 100,
  ) / 100;
  const remainingHours = estHours > 0 ? Math.max(0, Math.round((estHours - existingHours) * 100) / 100) : Infinity;

  if (task.status === 'completed') {
    return {
      ok: false,
      existingHours,
      remainingHours: 0,
      error: `Task "${task.title}" is already closed/completed and cannot accept additional hours.`,
    };
  }

  if (estHours > 0 && existingHours + newHours > estHours + 0.001) {
    return {
      ok: false,
      existingHours,
      remainingHours,
      error: `Cannot log ${newHours}h on "${task.title}". Allocated: ${estHours}h, Already logged: ${existingHours.toFixed(2)}h, Remaining allowed: ${remainingHours.toFixed(2)}h.`,
    };
  }

  return { ok: true, remainingHours, existingHours };
}
