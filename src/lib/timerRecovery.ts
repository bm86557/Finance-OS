import type { ActiveTimerSession, TimesheetEntry } from '../services/types';

export interface TimerSnapshot {
  sessionId: string;
  organizationId: string;
  userId: string;
  projectId: string;
  projectName: string;
  taskId?: string;
  description: string;
  billable: boolean;
  startedAt: string;
  pausedAt?: string;
  accumulatedSeconds: number;
  status: 'running' | 'paused';
  clientEventId: string;
  lastUpdatedAt: string;
}

export interface OfflineTimerOutboxItem {
  clientEventId: string;
  organizationId: string;
  userId: string;
  queuedAt: string;
  entry: Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'> & {
    clientEventId: string;
    source: 'live_timer' | 'offline_recovered';
  };
}

function snapshotKey(orgId: string, userId: string): string {
  return `finance_os_timer_snapshot_${orgId}_${userId}`;
}

function outboxKey(orgId: string, userId: string): string {
  return `finance_os_timer_outbox_${orgId}_${userId}`;
}

export function generateClientEventId(prefix = 'evt_ts'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Computes exact wall-clock elapsed seconds from `startedAt` + `accumulatedSeconds`.
 * Immune to browser tab throttling or laptop sleep.
 */
export function computeElapsedSeconds(
  session: Pick<TimerSnapshot | ActiveTimerSession, 'status' | 'startedAt' | 'accumulatedSeconds'>,
  nowMs: number = Date.now(),
): number {
  const base = Math.max(0, Math.floor(Number(session.accumulatedSeconds || 0)));
  if (session.status !== 'running') {
    return base;
  }
  const startedMs = Date.parse(session.startedAt);
  if (Number.isNaN(startedMs)) {
    return base;
  }
  const deltaSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  return base + deltaSec;
}

/**
 * Converts exact elapsed seconds into saved duration fields.
 * Never discards sub-minute runs (> 0s): minimum 0.01h / 1m so every stopped timer saves accurately.
 */
export function computeLoggedDuration(totalSeconds: number): {
  durationSeconds: number;
  durationMinutes: number;
  hours: number;
} {
  const cleanSec = Math.max(1, Math.round(totalSeconds));
  const durationMinutes = Math.max(1, Math.round(cleanSec / 60));
  const hours = Math.max(0.01, Math.round((cleanSec / 3600) * 100) / 100);
  return {
    durationSeconds: cleanSec,
    durationMinutes,
    hours,
  };
}

export function saveTimerSnapshot(snapshot: TimerSnapshot): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(snapshotKey(snapshot.organizationId, snapshot.userId), JSON.stringify(snapshot));
  } catch {
    /* ignore storage quota errors */
  }
}

export function loadTimerSnapshot(orgId: string, userId: string): TimerSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage || !orgId || !userId) return null;
  try {
    const raw = window.localStorage.getItem(snapshotKey(orgId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimerSnapshot;
    if (!parsed || !parsed.startedAt || !parsed.clientEventId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearTimerSnapshot(orgId: string, userId: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !orgId || !userId) return;
  try {
    window.localStorage.removeItem(snapshotKey(orgId, userId));
  } catch {
    /* ignore */
  }
}

export function getOfflineOutbox(orgId: string, userId: string): OfflineTimerOutboxItem[] {
  if (typeof window === 'undefined' || !window.localStorage || !orgId || !userId) return [];
  try {
    const raw = window.localStorage.getItem(outboxKey(orgId, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineTimeEntry(item: OfflineTimerOutboxItem): OfflineTimerOutboxItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [item];
  const current = getOfflineOutbox(item.organizationId, item.userId);
  if (current.some((x) => x.clientEventId === item.clientEventId)) {
    return current;
  }
  const next = [...current, item];
  try {
    window.localStorage.setItem(outboxKey(item.organizationId, item.userId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function removeOfflineOutboxItem(orgId: string, userId: string, clientEventId: string): OfflineTimerOutboxItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const current = getOfflineOutbox(orgId, userId);
  const next = current.filter((x) => x.clientEventId !== clientEventId);
  try {
    window.localStorage.setItem(outboxKey(orgId, userId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
