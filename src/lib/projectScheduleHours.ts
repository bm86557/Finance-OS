/**
 * Shared Schedule-Driven Business Hours Utility (Mon–Fri, 8h/day, 40h/week, 160h/month)
 * ====================================================================================
 * Pure TypeScript calendar engine shared identically by frontend previews/fallbacks
 * and the authoritative backend projectScheduleCostEngine.ts.
 *
 * Rules:
 *  - Working days: Monday–Friday (Saturday & Sunday = 0h).
 *  - Standard daily rate: 8h/day (5 weekdays = exact 40h/week).
 *  - Standard monthly cap: 160h/month per FTE (so 1 full calendar month = exact 1.0x monthly salary).
 *  - Timezone-safe: All YMD arithmetic runs in UTC midnight to eliminate DST / local offset drift.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN_DAYS = 3660; // 10-year safety bound

export function normalizeYmd(input?: string | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export function ymdToUtcMs(ymd: string): number | null {
  const norm = normalizeYmd(ymd);
  if (!norm) return null;
  const [y, m, d] = norm.split('-').map(Number);
  if (!y || !m || !d) return null;
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

export function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayYmdCalendar(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWeekdayUtcMs(ms: number): boolean {
  const dow = new Date(ms).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Returns every Mon–Fri business date (`YYYY-MM-DD`) inclusively in `[startYmd, endYmd]`.
 */
export function listBusinessDays(startYmd?: string | null, endYmd?: string | null): string[] {
  const startMs = startYmd ? ymdToUtcMs(startYmd) : null;
  const endMs = endYmd ? ymdToUtcMs(endYmd) : null;
  if (startMs == null || endMs == null || startMs > endMs) return [];

  const result: string[] = [];
  let steps = 0;
  for (let cur = startMs; cur <= endMs && steps < MAX_SCAN_DAYS; cur += DAY_MS, steps++) {
    if (isWeekdayUtcMs(cur)) {
      result.push(utcMsToYmd(cur));
    }
  }
  return result;
}

/**
 * Counts Mon–Fri business days inclusively in `[startYmd, endYmd]`.
 */
export function countBusinessDaysInclusive(startYmd?: string | null, endYmd?: string | null): number {
  return listBusinessDays(startYmd, endYmd).length;
}

/**
 * Returns the exact Mon–Fri calendar date when `businessDaysToInclude` working days
 * starting on (or right after, if start is weekend) `startYmd` complete.
 * Example: start = Mon Nov 2, businessDaysToInclude = 5 -> Fri Nov 6 (40h week).
 */
export function addBusinessDaysYmd(startYmd?: string | null, businessDaysToInclude = 1): string | null {
  const startMs = startYmd ? ymdToUtcMs(startYmd) : null;
  if (startMs == null) return null;
  const target = Math.max(1, Math.floor(businessDaysToInclude));

  let count = 0;
  let steps = 0;
  let cur = startMs;
  while (steps < MAX_SCAN_DAYS) {
    if (isWeekdayUtcMs(cur)) {
      count++;
      if (count >= target) {
        return utcMsToYmd(cur);
      }
    }
    cur += DAY_MS;
    steps++;
  }
  return utcMsToYmd(cur);
}

/**
 * Returns the next calendar day (`YYYY-MM-DD`) after `ymd`.
 */
export function nextCalendarDayYmd(ymd: string): string | null {
  const ms = ymdToUtcMs(ymd);
  if (ms == null) return null;
  return utcMsToYmd(ms + DAY_MS);
}

export interface MonthlyHourSlice {
  month: string; // YYYY-MM
  weekdays: number;
  rawHours: number;
  cappedHours: number;
}

export interface MonFriHoursResult {
  businessDays: number;
  effectiveBusinessDays: number;
  hours: number;
  months: MonthlyHourSlice[];
}

/**
 * Computes exact Mon–Fri sequence hours for a single FTE across `[startYmd, endYmd]`:
 *  - 1 Mon–Fri weekday = `hoursPerDay` (default 8h)
 *  - 1 full Mon–Fri week = 40h
 *  - 1 calendar month = capped at `monthlyCap` (default 160h) so full months equal 1.0x monthly salary
 *  - Excludes `pausedBusinessDays` (when project was placed on hold)
 */
export function calculateMonFriSequenceHours(
  startYmd?: string | null,
  endYmd?: string | null,
  pausedBusinessDays = 0,
  hoursPerDay = 8,
  monthlyCap = 160,
): MonFriHoursResult {
  const days = listBusinessDays(startYmd, endYmd);
  if (days.length === 0) {
    return { businessDays: 0, effectiveBusinessDays: 0, hours: 0, months: [] };
  }

  const byMonth = new Map<string, number>();
  for (const d of days) {
    const m = d.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }

  const hDay = hoursPerDay > 0 ? hoursPerDay : 8;
  const mCap = monthlyCap > 0 ? monthlyCap : 160;

  const months: MonthlyHourSlice[] = [];
  let totalCappedHours = 0;

  for (const [month, weekdays] of byMonth.entries()) {
    const rawHours = weekdays * hDay;
    const cappedHours = Math.min(mCap, rawHours);
    totalCappedHours += cappedHours;
    months.push({ month, weekdays, rawHours, cappedHours });
  }

  const paused = Math.max(0, Math.floor(pausedBusinessDays || 0));
  const effectiveBusinessDays = Math.max(0, days.length - paused);
  const pauseFactor = days.length > 0 ? effectiveBusinessDays / days.length : 0;
  const hours = Math.max(0, Math.round(totalCappedHours * pauseFactor * 100) / 100);

  return {
    businessDays: days.length,
    effectiveBusinessDays,
    hours,
    months,
  };
}

export interface ProjectSchedulePreviewInput {
  startDate?: string | null;
  endDate?: string | null;
  status?: 'quoted' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  completedAt?: string | null;
  pausedAt?: string | null;
  pausedBusinessDays?: number;
  quotedAmount?: number;
  initialBaselineCost?: number;
  budgetedHours?: number | null;
  memberCount?: number;
  combinedHourlyRate?: number;
  hoursPerDay?: number;
  monthlyCap?: number;
  todayYmd?: string;
}

export interface ProjectSchedulePreviewResult {
  plannedBusinessDays: number;
  /** 1× calendar timeline hours from startDate → endDate (Mon–Fri 8h/d, 160h/mo cap) */
  projectSchedulePlannedHours: number;
  projectScheduleElapsedHours: number;
  projectScheduleRemainingHours: number;
  projectScheduleOverrunHours: number;
  /** Collective team-member hours (multiplied by FTE count or explicit hours cap) */
  plannedHours: number;
  elapsedBusinessDays: number;
  elapsedHours: number;
  remainingBusinessDays: number;
  remainingHours: number;
  overdueBusinessDays: number;
  overrunHours: number;
  estimatedPlannedLaborCost: number;
  estimatedElapsedLaborCost: number;
  projectedMarginPct: number | null;
  breakEvenDate: string | null;
}

/**
 * Lightweight live preview calculator used in New/Edit Project modals and client fallbacks.
 */
export function computeProjectSchedulePreview(input: ProjectSchedulePreviewInput): ProjectSchedulePreviewResult {
  const today = normalizeYmd(input.todayYmd) || todayYmdCalendar();
  const start = normalizeYmd(input.startDate);
  const end = normalizeYmd(input.endDate);
  const rawStatus = input.status || 'quoted';
  // Auto-start quoted projects automatically once startDate is reached
  const status = rawStatus === 'quoted' && start && today >= start ? 'active' : rawStatus;
  const fte = Math.max(1, Number(input.memberCount || 1));
  const hDay = input.hoursPerDay && input.hoursPerDay > 0 ? input.hoursPerDay : 8;
  const mCap = input.monthlyCap && input.monthlyCap > 0 ? input.monthlyCap : 160;
  const paused = Math.max(0, Number(input.pausedBusinessDays || 0));
  const rate = Math.max(0, Number(input.combinedHourlyRate || 0));

  const plannedSeq = start && end && start <= end
    ? calculateMonFriSequenceHours(start, end, 0, hDay, mCap)
    : { businessDays: 0, effectiveBusinessDays: 0, hours: 0, months: [] };

  const plannedBusinessDays = plannedSeq.businessDays;
  const plannedHours = input.budgetedHours && input.budgetedHours > 0
    ? Number(input.budgetedHours)
    : Math.round(plannedSeq.hours * fte * 100) / 100;

  let elapsedEnd: string | null = null;
  if (status !== 'quoted' && start && today >= start) {
    if (status === 'completed') {
      elapsedEnd = normalizeYmd(input.completedAt) || end || today;
    } else if (status === 'on_hold') {
      elapsedEnd = normalizeYmd(input.pausedAt) || today;
    } else if (status === 'cancelled') {
      elapsedEnd = normalizeYmd(input.completedAt) || today;
    } else {
      elapsedEnd = today;
    }
  }

  const elapsedSeq = start && elapsedEnd && start <= elapsedEnd
    ? calculateMonFriSequenceHours(start, elapsedEnd, paused, hDay, mCap)
    : { businessDays: 0, effectiveBusinessDays: 0, hours: 0, months: [] };

  const elapsedBusinessDays = elapsedSeq.effectiveBusinessDays;
  const elapsedHours = Math.round(elapsedSeq.hours * fte * 100) / 100;

  let remainingBusinessDays = 0;
  let overdueBusinessDays = 0;
  if (end) {
    const refDate = status === 'completed'
      ? (normalizeYmd(input.completedAt) || end)
      : status === 'on_hold'
        ? (normalizeYmd(input.pausedAt) || today)
        : today;
    if (refDate < end) {
      const nextAfterRef = nextCalendarDayYmd(refDate);
      const effectiveRemStart = start && nextAfterRef && nextAfterRef < start ? start : nextAfterRef;
      remainingBusinessDays = effectiveRemStart ? countBusinessDaysInclusive(effectiveRemStart, end) : 0;
    } else if (refDate > end && status !== 'quoted') {
      const nextAfterEnd = nextCalendarDayYmd(end);
      overdueBusinessDays = nextAfterEnd ? countBusinessDaysInclusive(nextAfterEnd, refDate) : 0;
    }
  }

  const remainingHours = plannedHours > 0 ? Math.max(0, Math.round((plannedHours - elapsedHours) * 100) / 100) : 0;
  const overrunHours = plannedHours > 0 ? Math.max(0, Math.round((elapsedHours - plannedHours) * 100) / 100) : 0;

  const estimatedPlannedLaborCost = Math.round(plannedHours * (rate / fte) * 100) / 100;
  const estimatedElapsedLaborCost = Math.round(elapsedHours * (rate / fte) * 100) / 100;

  const quoted = Number(input.quotedAmount || 0);
  const baseline = Number(input.initialBaselineCost || 0);
  const projectedTotal = baseline + estimatedPlannedLaborCost;
  const projectedMarginPct = quoted > 0
    ? Math.round(((quoted - projectedTotal) / quoted) * 1000) / 10
    : null;

  let breakEvenDate: string | null = null;
  if (start && quoted > 0 && rate > 0) {
    const remainingBudgetForTime = Math.max(0, quoted - baseline);
    const maxHours = remainingBudgetForTime / (rate / fte);
    const maxBizDays = Math.max(1, Math.floor(maxHours / (fte * hDay)));
    breakEvenDate = addBusinessDaysYmd(start, maxBizDays + paused);
  }

  const projectSchedulePlannedHours = Math.round(plannedSeq.hours * 100) / 100;
  const projectScheduleElapsedHours = Math.round(elapsedSeq.hours * 100) / 100;
  const projectScheduleRemainingHours = projectSchedulePlannedHours > 0
    ? Math.max(0, Math.round((projectSchedulePlannedHours - projectScheduleElapsedHours) * 100) / 100)
    : 0;
  let projectScheduleOverrunHours = 0;
  if (end && elapsedEnd && elapsedEnd > end && status !== 'quoted') {
    const nextAfterEnd = nextCalendarDayYmd(end);
    if (nextAfterEnd) {
      const ovSeq = calculateMonFriSequenceHours(nextAfterEnd, elapsedEnd, 0, hDay, mCap);
      projectScheduleOverrunHours = Math.round(ovSeq.hours * 100) / 100;
    }
  }

  return {
    plannedBusinessDays,
    projectSchedulePlannedHours,
    projectScheduleElapsedHours,
    projectScheduleRemainingHours,
    projectScheduleOverrunHours,
    plannedHours,
    elapsedBusinessDays,
    elapsedHours,
    remainingBusinessDays,
    remainingHours,
    overdueBusinessDays,
    overrunHours,
    estimatedPlannedLaborCost,
    estimatedElapsedLaborCost,
    projectedMarginPct,
    breakEvenDate,
  };
}
