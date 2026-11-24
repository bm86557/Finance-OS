/**
 * Authoritative Schedule-Driven Project Costing & Loss Detection Engine
 * =====================================================================
 * Finance OS Master Backend Handoff v1.2 (§§12.1–12.7, §29 X-08/X-11, §33 #1/#5/#6/#9/#10)
 *
 * Single source of truth consumed by:
 *  - server/routes/projects.ts        (Project Profitability & Details)
 *  - server/routes/profitIntelligence.ts (Client Profitability)
 *  - server/routes/departments.ts     (Department Multi-Dept Split & Overhead Driver)
 *  - server/routes/reports.ts         (Client/Department Profitability & Capacity Forecast)
 *  - server/routes/simulator.ts       (Baseline Utilization)
 *
 * Hardened Invariants Implemented:
 *  1. Pure Mon–Fri automatic schedule hours (8h/day, 40h/week, 160h/month cap) — ZERO timesheet_entries dependency.
 *  2. Day-by-day concurrency splitting + per-member assignedFrom/assignedTo effective dates (zero retroactive drift).
 *  3. Employee-level 160h/month proportional normalization (1 full month = exact 100% salary across all concurrent projects).
 *  4. Auto equal split (1/N) with optional per-member custom allocationPct override.
 *  5. Editable completed_at freeze & on_hold paused_business_days exclusion.
 *  6. Open-ended projects (no end_date) never falsely flagged OVERTIME; still tracked for break-even & IN LOSS.
 *  7. Multi-currency FX conversion (salary_currency -> project.currency) + explicit missingSalaryMembers alert flags.
 *  8. Strict <= 100% department overhead pool conservation (Hamilton-Hare deterministic cent allocation).
 *  9. Quoted projects strictly burn 0h until explicitly activated.
 */

import { convertCurrency } from '../lib/fxConverter.js';
import {
  isValidProjectTransaction,
  isDirectProjectDebit,
} from '../../src/lib/projectTransactionFilter.js';
import {
  normalizeYmd,
  todayYmdCalendar,
  listBusinessDays,
  countBusinessDaysInclusive,
  addBusinessDaysYmd,
  nextCalendarDayYmd,
  calculateMonFriSequenceHours,
} from '../../src/lib/projectScheduleHours.js';
import {
  allocateOverheadPools,
  isEligibleBusinessCostingTransaction,
  type DepartmentDriverStats,
} from './costingEngine.js';

export type ProjectHealthStatus =
  | 'in_loss'
  | 'overtime'
  | 'at_risk'
  | 'on_track'
  | 'quoted'
  | 'on_hold'
  | 'completed_profit'
  | 'completed_loss'
  | 'cancelled';

export interface MemberAssignmentRecord {
  userId: string;
  assignedFrom?: string;
  assignedTo?: string;
  allocationPct?: number | null;
}

export interface ProjectTeamAllocation {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  departmentId?: string;
  departmentName?: string;
  role?: string;
  assignedFrom: string;
  assignedTo?: string;
  allocationSharePct: number;
  isCustomAllocation: boolean;
  isOverAllocated: boolean;
  salaryMissing: boolean;
  hourlyRate: number;
  ratePerMinute: number;
  plannedHours: number;
  elapsedHours: number;
  overrunHours: number;
  laborCost: number;
  overrunLaborCost: number;
}

export interface ProjectOverheadSlice {
  departmentId: string;
  departmentName: string;
  headcount: number;
  departmentOverheadPool: number;
  departmentCapacityHours: number | null;
  overheadRatePerHour: number;
  scheduledHours: number;
  allocatedOverhead: number;
  absorptionPercent: number;
}

export interface ComputedProjectProfitability {
  projectId: string;
  projectName: string;
  code: string;
  clientName: string;
  departmentId: string;
  status: 'quoted' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  currency: string;
  startDate: string;
  endDate?: string;
  completedAt?: string;
  pausedAt?: string;
  pausedBusinessDays: number;
  plannedTeamSize: number;
  budgetedHours?: number | null;
  capacityBasis: 'scheduled_mon_fri_40h_160h';
  hoursPerDay: number;
  monthlyCapacityHours: number;

  // Schedule & Auto-Detected Hours (Mon–Fri)
  plannedBusinessDays: number;
  elapsedBusinessDays: number;
  remainingBusinessDays: number;
  overdueBusinessDays: number;
  /** Overall 1× project timeline hours from startDate → endDate (Mon–Fri 8h/d, 160h/mo cap — NOT multiplied by team size) */
  projectSchedulePlannedHours: number;
  projectScheduleElapsedHours: number;
  projectScheduleRemainingHours: number;
  projectScheduleOverrunHours: number;
  /** Collective team-member hours summed across all assigned staff (with concurrency splitting & 160h/mo cap) */
  plannedHours: number;
  elapsedHours: number;
  remainingHours: number;
  overrunHours: number;
  weeklyScheduledHours: number;
  exactCompletionHours: number | null;
  scheduleProgressPct: number;
  isOverdue: boolean;
  isOpenEnded: boolean;

  // Financial Costing (§12.4)
  quotedAmount: number;
  initialBaselineCost: number;
  directCost: number;
  laborCost: number;
  overrunLaborCost: number;
  assignedOverhead: number;
  actualCost: number;
  consumedBurn: number;
  hourlyBurnRate: number;
  burnRatePerDay: number;
  plannedDailyBudget: number;
  committedRemainingWork: number;
  costToComplete: number;
  projectedAtCompletion: number;
  marginAtRisk: number;

  // Dual Profit Views (§12.4 & §33 #9)
  revenue: number; // Recognized ledger credit revenue
  quoteProfit: number; // Quoted - Actual Cost
  quoteMarginPct: number | null;
  operatingProfit: number; // Recognized Revenue - Actual Cost
  profit: number; // Alias for operatingProfit (legacy compat)
  /** Strictly null (undefined) when recognized revenue <= 0 (§12.4 L666, §33 #9) */
  profitMargin: number | null;
  operatingMarginPct: number | null; // Strictly null when rev <= 0 (§33 #9)
  projectContribution: number; // Recognized Revenue - (Direct + Labor)
  targetProfit: number;
  targetMargin: number;
  budgetVariance: number;

  // Loss & Break-Even Intelligence
  maxProfitableHours: number | null;
  breakEvenDate: string | null;
  daysUntilLoss: number | null;
  healthStatus: ProjectHealthStatus;
  lossAmount: number;
  alertMessage: string | null;

  // Team & Governance Metadata
  isUsingDeptFallback: boolean;
  missingSalaryMembers: string[];
  contributorCount: number;
  teamAllocations: ProjectTeamAllocation[];
  overheadBreakdown: ProjectOverheadSlice[];

  // Backwards-compatible aliases (zero timesheets — mapped cleanly to scheduled hours)
  loggedHours: number;
  approvedHours: number;
  pendingHours: number;
  billableHours: number;
  nonBillableHours: number;
  pendingLaborCost: number;
  daysElapsed: number;
  daysRemaining: number;
  totalSpanDays: number;
  completionPct: number;
  contributors: Array<{
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    hours: number;
    approvedHours: number;
    laborCost: number;
    allocationSharePct: number;
    hourlyRate: number;
    overrunHours: number;
  }>;
  deptScheduledHours: Record<string, number>;
}

export interface OrgProjectsProfitabilityResult {
  projects: ComputedProjectProfitability[];
  deptScheduledHoursTotal: Map<string, number>;
  /** Scheduled hours strictly from active members belonging to each department (never leaks unassigned/inactive staff into 0-headcount depts) */
  deptActiveStaffScheduledHours: Map<string, number>;
  projectDeptScheduledHours: Map<string, Map<string, number>>;
  reconciliationTrace: {
    activeMonthsSpan: number;
    totalOrgPayrollExpense: number;
    totalOrgAllocatedLabor: number;
    unallocatedPayrollBench: number;
    overAllocatedPayroll: number;
    totalOrgOverheadPool: number;
    totalOrgAbsorbedOverhead: number;
    unallocatedBenchOverhead: number;
    reconciliationEquation: string;
    status: 'balanced' | 'over_allocated';
  };
}

export interface ComputeOrgProjectsInput {
  projects: any[];
  transactions: any[];
  members: any[];
  departments: any[];
  overheadAllocations: any[];
  agencyTeams?: any[];
  agencyTeamMembers?: any[];
  bankAccounts?: any[];
  profiles?: any[];
  orgCurrency?: string;
  fromDate?: string;
  toDate?: string;
  todayYmd?: string;
  /**
   * Whether fixed employee salaries are included in project KPI costs.
   * Defaults to `false` (project KPIs = Direct Expenses + Shared Overhead; fixed salaries stay at department/payroll level).
   */
  includeLaborInProjectCost?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function resolveMemberDepartmentId(member: any, departments: any[]): string {
  const raw = String(member?.department_id || member?.departmentId || member?.department || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  for (const d of departments || []) {
    const dId = String(d.id || '');
    const dName = String(d.name || '').toLowerCase();
    const dCode = String(d.code || '').toLowerCase();
    if (
      dId.toLowerCase() === low ||
      (dName && dName === low) ||
      (dCode && dCode === low) ||
      (dName.length >= 3 && (low.includes(dName) || dName.includes(low)))
    ) {
      return dId;
    }
  }
  return raw;
}

/**
 * Multi-Driver Department Overhead Pool Calculator (§12.3 & §33 #10)
 * Delegates to the single authoritative `allocateOverheadPools` engine in costingEngine.ts
 * so Department Cost Rates and Project Costing ALWAYS conserve and split overhead identically.
 * Per §12.1 L620: 0 headcount => capacityHours is null (never phantom 160h).
 */
function computeDepartmentOverheadPools(
  departments: any[],
  allocations: any[],
  activeMembers: any[],
  transactions: any[],
  deptScheduledHours: Map<string, number>,
  projectDeptScheduledHours: Map<string, Map<string, number>>,
  projects: any[],
  bankAccounts: any[] = [],
  orgCurrency = 'USD',
  fromDate?: string,
  toDate?: string,
) {
  const deptHeadcounts = new Map<string, number>();
  const deptDirectCosts = new Map<string, number>();
  const deptRevenues = new Map<string, number>();
  const userDeptMap = new Map<string, string>();
  const projectMap = new Map<string, any>();

  for (const p of projects || []) {
    projectMap.set(String(p.id), p);
  }

  for (const d of departments || []) {
    const dId = String(d.id);
    deptDirectCosts.set(dId, 0);
    deptRevenues.set(dId, 0);

    const dMembers = (activeMembers || []).filter((m: any) => resolveMemberDepartmentId(m, departments) === dId);
    for (const m of dMembers) {
      const uid = String(m.user_id || m.userId || m.id || '');
      if (uid) userDeptMap.set(uid, dId);
    }
    deptHeadcounts.set(dId, dMembers.length);
  }

  // Aggregate department revenues & direct costs identically to departments.ts
  for (const t of transactions || []) {
    if (!isEligibleBusinessCostingTransaction(t, fromDate, toDate)) continue;
    const rawAmt = Math.abs(Number(t.amount || 0));
    if (rawAmt <= 0) continue;
    const amt = convertCurrency(rawAmt, t.currency || orgCurrency, orgCurrency);
    const explicitDeptId = resolveMemberDepartmentId({ department: t.department_id || t.departmentId }, departments);
    const projId = String(t.project_id || t.projectId || '');
    const proj = projId ? projectMap.get(projId) : null;
    const projDeptId = proj ? resolveMemberDepartmentId({ department: proj.department_id || proj.departmentId }, departments) : '';

    if (t.type === 'credit') {
      const pHoursMap = projId ? projectDeptScheduledHours.get(projId) : undefined;
      const totalProjHours = pHoursMap ? Array.from(pHoursMap.values()).reduce((s, h) => s + h, 0) : 0;
      if (projId && pHoursMap && totalProjHours > 0) {
        for (const [dId, hrs] of pHoursMap.entries()) {
          if (deptRevenues.has(dId)) {
            deptRevenues.set(dId, (deptRevenues.get(dId) || 0) + amt * (hrs / totalProjHours));
          }
        }
      } else {
        const target = explicitDeptId || projDeptId;
        if (target && deptRevenues.has(target)) {
          deptRevenues.set(target, (deptRevenues.get(target) || 0) + amt);
        }
      }
    } else if (t.type === 'debit') {
      const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
      const allocTags = tags.filter(tag => tag.startsWith('payslip_alloc:'));
      let allocatedSum = 0;

      for (const aTag of allocTags) {
        const parts = aTag.split(':');
        const tagUserId = parts[2] || '';
        const tagDeptRaw = parts[3] || '';
        const tagGross = convertCurrency(Number(parts[4] || 0), t.currency || orgCurrency, orgCurrency);
        if (tagGross <= 0) continue;
        const resolvedDept =
          resolveMemberDepartmentId({ department: tagDeptRaw }, departments) ||
          userDeptMap.get(tagUserId) ||
          explicitDeptId ||
          projDeptId;
        const eff = Math.min(tagGross, Math.max(0, amt - allocatedSum));
        if (eff > 0 && resolvedDept && deptDirectCosts.has(resolvedDept)) {
          deptDirectCosts.set(resolvedDept, (deptDirectCosts.get(resolvedDept) || 0) + eff);
          allocatedSum += eff;
        }
      }

      const rem = Math.max(0, amt - allocatedSum);
      if (rem > 0) {
        const target = explicitDeptId || projDeptId;
        if (target && deptDirectCosts.has(target)) {
          deptDirectCosts.set(target, (deptDirectCosts.get(target) || 0) + rem);
        }
      }
    }
  }

  const driverStats: DepartmentDriverStats[] = (departments || []).map((d: any) => {
    const dId = String(d.id);
    return {
      departmentId: dId,
      departmentName: String(d.name || 'Department'),
      headcount: deptHeadcounts.get(dId) || 0,
      revenue: Math.round((deptRevenues.get(dId) || 0) * 100) / 100,
      directCosts: Math.round((deptDirectCosts.get(dId) || 0) * 100) / 100,
      scheduledHours: Math.round((deptScheduledHours.get(dId) || 0) * 100) / 100,
      squareFootage: Number(d.square_footage || d.squareFootage || 0),
      customWeight: Number(d.custom_weight || d.customWeight || 1),
    };
  });

  const allocResult = allocateOverheadPools({
    departments: driverStats,
    allocations,
    accounts: bankAccounts,
    periodMonths: 1,
    orgCurrency,
  });

  const deptPools = allocResult.deptPoolTotals;
  const deptCapacities = new Map<string, number | null>();
  const deptRatesPerHour = new Map<string, number>();

  for (const d of departments || []) {
    const dId = String(d.id);
    const hc = deptHeadcounts.get(dId) || 0;
    // Per Handoff v1.2 §12.1 L620: 0 headcount => null capacity (never fabricate 160h)
    const cap = hc > 0 ? hc * 160 : null;
    const pool = deptPools.get(dId) || 0;
    deptCapacities.set(dId, cap);
    deptRatesPerHour.set(dId, cap != null && cap > 0 ? pool / cap : 0);
  }

  return { deptPools, deptCapacities, deptRatesPerHour, deptHeadcounts };
}

export function computeOrgProjectsProfitability(input: ComputeOrgProjectsInput): OrgProjectsProfitabilityResult {
  const {
    projects = [],
    transactions = [],
    members = [],
    departments = [],
    overheadAllocations = [],
    agencyTeams = [],
    agencyTeamMembers = [],
    bankAccounts = [],
    profiles = [],
    orgCurrency = 'USD',
    fromDate,
    toDate,
    includeLaborInProjectCost = false,
  } = input;

  const today = normalizeYmd(input.todayYmd) || todayYmdCalendar();
  const filterFrom = normalizeYmd(fromDate);
  const filterTo = normalizeYmd(toDate);

  const profileMap = new Map<string, { name: string; email: string; avatarUrl?: string | null }>();
  for (const p of profiles || []) {
    profileMap.set(String(p.id), {
      name: p.full_name || p.email?.split('@')[0] || 'Team Member',
      email: p.email || '',
      avatarUrl: p.avatar_url || null,
    });
  }

  const deptNameMap = new Map<string, string>();
  for (const d of departments || []) {
    deptNameMap.set(String(d.id), String(d.name || 'Department'));
  }

  const activeMembers = (members || []).filter((m: any) => String(m.status || 'active').toLowerCase() === 'active');
  const activeUserIdSet = new Set<string>();
  const memberByUserId = new Map<string, any>();
  const userDeptMap = new Map<string, string>();
  const activeUserDeptMap = new Map<string, string>();
  for (const m of members || []) {
    const uid = String(m.user_id || m.userId || m.id || '');
    if (!uid) continue;
    memberByUserId.set(uid, m);
    const dId = resolveMemberDepartmentId(m, departments);
    if (dId) userDeptMap.set(uid, dId);
    if (String(m.status || 'active').toLowerCase() === 'active') {
      activeUserIdSet.add(uid);
      if (dId) activeUserDeptMap.set(uid, dId);
    }
  }

  // Compute Department Average Hourly Rate in orgCurrency (from salaried active members, then cost_per_hour, then budget/capacity; never fabricate $50/hr)
  const deptAvgHourlyOrgMap = new Map<string, number>();
  for (const d of departments || []) {
    const dId = String(d.id);
    const dMembers = activeMembers.filter((m: any) => resolveMemberDepartmentId(m, departments) === dId);
    const salariedRates: number[] = [];
    for (const m of dMembers) {
      const sal = Number(m.fixed_salary || m.salary || 0);
      const hr = Number(m.hourly_rate || 0);
      const sCurr = String(m.salary_currency || orgCurrency).toUpperCase();
      const rawCap = Number(m.hours_per_day || 8) * Number(m.working_days_per_month || 20);
      // Enforce consistent 160h/month FTE cap (§12.1, aligns with 40h/wk · 160h/mo & hc*160 overhead)
      const cap = rawCap > 0 ? Math.min(160, rawCap) : 160;
      if (sal > 0) {
        salariedRates.push(convertCurrency(sal, sCurr, orgCurrency) / cap);
      } else if (hr > 0) {
        salariedRates.push(convertCurrency(hr, sCurr, orgCurrency));
      }
    }
    if (salariedRates.length > 0) {
      const avg = salariedRates.reduce((s, v) => s + v, 0) / salariedRates.length;
      deptAvgHourlyOrgMap.set(dId, avg);
    } else if (Number(d.cost_per_hour || 0) > 0) {
      deptAvgHourlyOrgMap.set(dId, Number(d.cost_per_hour));
    } else if (Number(d.budget || 0) > 0 && dMembers.length > 0) {
      deptAvgHourlyOrgMap.set(dId, Number(d.budget) / (dMembers.length * 160));
    } else {
      deptAvgHourlyOrgMap.set(dId, 0);
    }
  }

  function getDeptHourlyRate(deptId: string, targetCurrency: string): number {
    const inOrg = deptAvgHourlyOrgMap.get(deptId) ?? 0;
    return inOrg > 0 ? convertCurrency(inOrg, orgCurrency, targetCurrency) : 0;
  }

  function getMemberHourlyRate(
    userId: string,
    projectDeptId: string,
    targetCurrency: string,
  ): { hourlyRate: number; monthlyCap: number; salaryMissing: boolean } {
    const mem = memberByUserId.get(userId);
    const hoursPerDay = Number(mem?.hours_per_day || 8);
    const daysPerMonth = Number(mem?.working_days_per_month || 20);
    const rawCap = hoursPerDay > 0 && daysPerMonth > 0 ? hoursPerDay * daysPerMonth : 160;
    // Enforce consistent 160h/month FTE cap (prevents legacy working_days_per_month=22 from drifting to 176h/mo)
    const monthlyCap = Math.min(160, rawCap);

    if (!mem) {
      return { hourlyRate: getDeptHourlyRate(projectDeptId, targetCurrency), monthlyCap: 160, salaryMissing: true };
    }

    const sCurr = String(mem.salary_currency || orgCurrency).toUpperCase();
    const fixedSal = Number(mem.fixed_salary || mem.salary || 0);
    if (fixedSal > 0) {
      const convertedSal = convertCurrency(fixedSal, sCurr, targetCurrency);
      return { hourlyRate: convertedSal / monthlyCap, monthlyCap, salaryMissing: false };
    }

    const explicitHourly = Number(mem.hourly_rate || 0);
    if (explicitHourly > 0) {
      return { hourlyRate: convertCurrency(explicitHourly, sCurr, targetCurrency), monthlyCap, salaryMissing: false };
    }

    const memDept = userDeptMap.get(userId) || projectDeptId;
    return {
      hourlyRate: getDeptHourlyRate(memDept, targetCurrency),
      monthlyCap,
      salaryMissing: true,
    };
  }

  // Step 1: Build effective windows & resolved member assignments for EVERY project
  interface ProjectContext {
    raw: any;
    id: string;
    status: 'quoted' | 'active' | 'on_hold' | 'completed' | 'cancelled';
    currency: string;
    startDate: string;
    endDate?: string;
    completedAt?: string;
    pausedAt?: string;
    pausedBusinessDays: number;
    hoursPerDay: number;
    monthlyCap: number;
    plannedTeamSize: number;
    budgetedHours: number | null;
    elapsedStart: string | null;
    elapsedEnd: string | null;
    elapsedDays: string[];
    pauseFactor: number;
    roster: Array<{
      userId: string;
      assignedFrom: string;
      assignedTo?: string;
      allocationPct: number | null;
    }>;
  }

  // Index squad teams by project_id
  const squadMembersByProject = new Map<string, Set<string>>();
  const teamsById = new Map<string, any>();
  for (const t of agencyTeams || []) {
    if (String(t.status || 'active') === 'archived') continue;
    teamsById.set(String(t.id), t);
    if (t.project_id) {
      if (!squadMembersByProject.has(String(t.project_id))) {
        squadMembersByProject.set(String(t.project_id), new Set());
      }
    }
  }
  for (const tm of agencyTeamMembers || []) {
    const team = teamsById.get(String(tm.team_id));
    if (team?.project_id && tm.user_id) {
      const set = squadMembersByProject.get(String(team.project_id)) || new Set<string>();
      set.add(String(tm.user_id));
      squadMembersByProject.set(String(team.project_id), set);
    }
  }

  const contexts: ProjectContext[] = projects.map((proj: any) => {
    const id = String(proj.id);
    const rawStatus = (proj.status || 'quoted') as ProjectContext['status'];
    const startDate = normalizeYmd(proj.start_date || proj.startDate) || '';
    const endDate = normalizeYmd(proj.end_date || proj.endDate) || undefined;
    const completedAt = normalizeYmd(proj.completed_at || proj.completedAt) || undefined;
    const pausedAt = normalizeYmd(proj.paused_at || proj.pausedAt) || undefined;
    const pausedBusinessDays = Math.max(0, Number(proj.paused_business_days ?? proj.pausedBusinessDays ?? 0));
    const hoursPerDay = Number(proj.hours_per_day ?? proj.hoursPerDay ?? 8) || 8;
    const monthlyCap = Number(proj.monthly_capacity_hours ?? proj.monthlyCapacityHours ?? 160) || 160;
    const plannedTeamSize = Math.max(1, Number(proj.planned_team_size ?? proj.plannedTeamSize ?? 1));
    const rawBudgetedHours = proj.budgeted_hours ?? proj.budgetedHours;
    const budgetedHours = rawBudgetedHours != null && Number(rawBudgetedHours) > 0 ? Number(rawBudgetedHours) : null;

    // Auto-start quoted projects automatically once their start_date is reached (today >= startDate)
    const status: ProjectContext['status'] =
      rawStatus === 'quoted' && startDate && today >= startDate
        ? 'active'
        : rawStatus;

    // Resolve roster: explicit member_assignments > organization_members.assigned_projects > agency_teams
    const rosterMap = new Map<string, { userId: string; assignedFrom: string; assignedTo?: string; allocationPct: number | null }>();

    const explicitAssignments = parseJsonArray(proj.member_assignments ?? proj.memberAssignments);
    for (const item of explicitAssignments) {
      const uid = String(item?.userId || item?.user_id || '').trim();
      if (!uid) continue;
      const pct = item?.allocationPct ?? item?.allocation_pct;
      rosterMap.set(uid, {
        userId: uid,
        assignedFrom: normalizeYmd(item?.assignedFrom || item?.assigned_from) || startDate || today,
        assignedTo: normalizeYmd(item?.assignedTo || item?.assigned_to) || undefined,
        allocationPct: pct != null && Number(pct) > 0 ? Math.min(100, Number(pct)) : null,
      });
    }

    for (const m of activeMembers) {
      const uid = String(m.user_id || m.userId || '');
      if (!uid || rosterMap.has(uid)) continue;
      const ap = parseJsonArray(m.assigned_projects ?? m.assignedProjects);
      if (ap.includes(id)) {
        rosterMap.set(uid, {
          userId: uid,
          assignedFrom: startDate || today,
          assignedTo: undefined,
          allocationPct: null,
        });
      }
    }

    const squadSet = squadMembersByProject.get(id);
    if (squadSet) {
      for (const uid of squadSet) {
        if (!rosterMap.has(uid) && activeUserIdSet.has(uid)) {
          rosterMap.set(uid, {
            userId: uid,
            assignedFrom: startDate || today,
            assignedTo: undefined,
            allocationPct: null,
          });
        }
      }
    }

    // Determine elapsed window — Quoted projects STRICTLY burn 0h (Flaw #8)
    let elapsedStart: string | null = null;
    let elapsedEnd: string | null = null;

    if (status !== 'quoted' && startDate && today >= startDate) {
      let rawEnd: string;
      if (status === 'completed') {
        rawEnd = completedAt || endDate || normalizeYmd(proj.updated_at) || today;
      } else if (status === 'on_hold') {
        rawEnd = pausedAt || today;
      } else if (status === 'cancelled') {
        rawEnd = completedAt || normalizeYmd(proj.updated_at) || today;
      } else {
        rawEnd = today;
      }

      const clampedStart = filterFrom && filterFrom > startDate ? filterFrom : startDate;
      const clampedEnd = filterTo && filterTo < rawEnd ? filterTo : rawEnd;

      if (clampedStart <= clampedEnd) {
        elapsedStart = clampedStart;
        elapsedEnd = clampedEnd;
      }
    }

    const elapsedDays = elapsedStart && elapsedEnd ? listBusinessDays(elapsedStart, elapsedEnd) : [];
    const totalRawDays = elapsedDays.length;
    const effectiveDays = Math.max(0, totalRawDays - pausedBusinessDays);
    const pauseFactor = totalRawDays > 0 ? effectiveDays / totalRawDays : 0;

    return {
      raw: proj,
      id,
      status,
      currency: String(proj.currency || orgCurrency || 'USD').toUpperCase(),
      startDate,
      endDate,
      completedAt,
      pausedAt,
      pausedBusinessDays,
      hoursPerDay,
      monthlyCap,
      plannedTeamSize,
      budgetedHours,
      elapsedStart,
      elapsedEnd,
      elapsedDays,
      pauseFactor,
      roster: Array.from(rosterMap.values()),
    };
  });

  // Step 2: Day-by-Day Concurrency Split Across All Active/Elapsed Projects (Flaw #1 & #4)
  // Index: userId -> dayYmd -> list of { projectId, allocationPct, hoursPerDay, pauseFactor, isOverrunDay }
  interface DailyAssignmentSlot {
    projectId: string;
    allocationPct: number | null;
    hoursPerDay: number;
    pauseFactor: number;
    isOverrunDay: boolean;
  }

  const userDailySlots = new Map<string, Map<string, DailyAssignmentSlot[]>>();

  for (const ctx of contexts) {
    if (ctx.roster.length === 0 || ctx.elapsedDays.length === 0 || ctx.pauseFactor <= 0) continue;

    for (const assign of ctx.roster) {
      let dayMap = userDailySlots.get(assign.userId);
      if (!dayMap) {
        dayMap = new Map();
        userDailySlots.set(assign.userId, dayMap);
      }

      for (const d of ctx.elapsedDays) {
        if (assign.assignedFrom && d < assign.assignedFrom) continue;
        if (assign.assignedTo && d > assign.assignedTo) continue;
        const isOverrunDay = Boolean(ctx.endDate && d > ctx.endDate);
        let slots = dayMap.get(d);
        if (!slots) {
          slots = [];
          dayMap.set(d, slots);
        }
        slots.push({
          projectId: ctx.id,
          allocationPct: assign.allocationPct,
          hoursPerDay: ctx.hoursPerDay,
          pauseFactor: ctx.pauseFactor,
          isOverrunDay,
        });
      }
    }
  }

  // Accumulate raw unpaused hours per (userId, month, projectId) separating in-schedule vs overrun hours
  // Applying `pauseFactor` AFTER monthly 160h cap guarantees paused days are never silently erased in 21–23 weekday months.
  interface UserProjectMonthAcc {
    inScheduleHours: number;
    overrunHours: number;
    pauseFactor: number;
    shareSum: number;
    activeDayCount: number;
    overAllocated: boolean;
  }

  const userMonthProjectHours = new Map<string, Map<string, Map<string, UserProjectMonthAcc>>>();

  for (const [userId, dayMap] of userDailySlots.entries()) {
    const monthMap = new Map<string, Map<string, UserProjectMonthAcc>>();
    userMonthProjectHours.set(userId, monthMap);

    for (const [dayYmd, slots] of dayMap.entries()) {
      const month = dayYmd.slice(0, 7);
      let projMap = monthMap.get(month);
      if (!projMap) {
        projMap = new Map();
        monthMap.set(month, projMap);
      }

      const explicitSlots = slots.filter(s => s.allocationPct != null && s.allocationPct > 0);
      const autoSlots = slots.filter(s => s.allocationPct == null || s.allocationPct <= 0);
      const explicitSumPct = explicitSlots.reduce((sum, s) => sum + Number(s.allocationPct || 0), 0);
      const isOverAllocated = explicitSumPct > 100.01;

      for (const slot of slots) {
        let share = 0;
        if (explicitSlots.length === 0) {
          share = 1 / slots.length;
        } else if (autoSlots.length === 0) {
          share = explicitSumPct > 100
            ? Number(slot.allocationPct!) / explicitSumPct
            : Number(slot.allocationPct!) / 100;
        } else {
          if (explicitSumPct >= 100) {
            const totalWeight = explicitSumPct + autoSlots.length * (100 / slots.length);
            share = slot.allocationPct != null
              ? Number(slot.allocationPct) / totalWeight
              : (100 / slots.length) / totalWeight;
          } else {
            const remainingFrac = (100 - explicitSumPct) / 100;
            share = slot.allocationPct != null
              ? Number(slot.allocationPct) / 100
              : remainingFrac / autoSlots.length;
          }
        }

        const rawHrs = slot.hoursPerDay * share;
        let acc = projMap.get(slot.projectId);
        if (!acc) {
          acc = { inScheduleHours: 0, overrunHours: 0, pauseFactor: slot.pauseFactor, shareSum: 0, activeDayCount: 0, overAllocated: false };
          projMap.set(slot.projectId, acc);
        }
        if (slot.isOverrunDay) acc.overrunHours += rawHrs;
        else acc.inScheduleHours += rawHrs;
        acc.pauseFactor = slot.pauseFactor;
        acc.shareSum += share;
        acc.activeDayCount += 1;
        if (isOverAllocated) acc.overAllocated = true;
      }
    }
  }

  // Step 3: Employee-Level 160h/month Proportional Normalization (Flaw #2 — §33 #1 Payroll Conservation)
  // projectUserTotals: projectId -> userId -> { elapsedHours, overrunHours, avgSharePct, overAllocated }
  const projectUserTotals = new Map<
    string,
    Map<string, { elapsedHours: number; overrunHours: number; shareSum: number; activeDayCount: number; overAllocated: boolean }>
  >();

  for (const [userId, monthMap] of userMonthProjectHours.entries()) {
    const mem = memberByUserId.get(userId);
    const hDay = Number(mem?.hours_per_day || 8);
    const dMo = Number(mem?.working_days_per_month || 20);
    const rawCap = hDay > 0 && dMo > 0 ? hDay * dMo : 160;
    const empCap = Math.min(160, rawCap);

    for (const [, projMap] of monthMap.entries()) {
      let totalMonthRaw = 0;
      for (const acc of projMap.values()) {
        totalMonthRaw += acc.inScheduleHours + acc.overrunHours;
      }
      const scale = totalMonthRaw > empCap ? empCap / totalMonthRaw : 1;

      for (const [projectId, acc] of projMap.entries()) {
        let uMap = projectUserTotals.get(projectId);
        if (!uMap) {
          uMap = new Map();
          projectUserTotals.set(projectId, uMap);
        }
        const cur = uMap.get(userId) || { elapsedHours: 0, overrunHours: 0, shareSum: 0, activeDayCount: 0, overAllocated: false };
        cur.elapsedHours += (acc.inScheduleHours + acc.overrunHours) * scale * acc.pauseFactor;
        cur.overrunHours += acc.overrunHours * scale * acc.pauseFactor;
        cur.shareSum += acc.shareSum;
        cur.activeDayCount += acc.activeDayCount;
        if (acc.overAllocated) cur.overAllocated = true;
        uMap.set(userId, cur);
      }
    }
  }

  // Step 3B: Exact Day-by-Day Planned Concurrency Hours across [startDate, endDate]
  // Prevents inflating plannedHours by applying an early elapsed average split (e.g. 64.3%) to future months where a member is 50% split.
  const plannedDailySlots = new Map<string, Map<string, Array<{ projectId: string; allocationPct: number | null; hoursPerDay: number }>>>();
  for (const ctx of contexts) {
    if (ctx.roster.length === 0 || !ctx.startDate || !ctx.endDate || ctx.startDate > ctx.endDate) continue;
    if (ctx.status === 'cancelled') continue;
    const planDays = listBusinessDays(ctx.startDate, ctx.endDate);
    for (const assign of ctx.roster) {
      let dayMap = plannedDailySlots.get(assign.userId);
      if (!dayMap) {
        dayMap = new Map();
        plannedDailySlots.set(assign.userId, dayMap);
      }
      for (const d of planDays) {
        if (assign.assignedFrom && d < assign.assignedFrom) continue;
        if (assign.assignedTo && d > assign.assignedTo) continue;
        let slots = dayMap.get(d);
        if (!slots) {
          slots = [];
          dayMap.set(d, slots);
        }
        slots.push({
          projectId: ctx.id,
          allocationPct: assign.allocationPct,
          hoursPerDay: ctx.hoursPerDay,
        });
      }
    }
  }

  const projectUserPlannedTotals = new Map<string, Map<string, number>>();
  // Track each user's current ongoing share per project as of `today` (for accurate weekly hours & break-even projection)
  const projectUserCurrentShare = new Map<string, Map<string, number>>();

  for (const [userId, dayMap] of plannedDailySlots.entries()) {
    const mem = memberByUserId.get(userId);
    const hDay = Number(mem?.hours_per_day || 8);
    const dMo = Number(mem?.working_days_per_month || 20);
    const rawCap = hDay > 0 && dMo > 0 ? hDay * dMo : 160;
    const empCap = Math.min(160, rawCap);

    const monthProjRaw = new Map<string, Map<string, number>>();

    for (const [dayYmd, slots] of dayMap.entries()) {
      const month = dayYmd.slice(0, 7);
      let projMap = monthProjRaw.get(month);
      if (!projMap) {
        projMap = new Map();
        monthProjRaw.set(month, projMap);
      }

      const explicitSlots = slots.filter(s => s.allocationPct != null && s.allocationPct > 0);
      const autoSlots = slots.filter(s => s.allocationPct == null || s.allocationPct <= 0);
      const explicitSumPct = explicitSlots.reduce((sum, s) => sum + Number(s.allocationPct || 0), 0);

      for (const slot of slots) {
        let share = 0;
        if (explicitSlots.length === 0) {
          share = 1 / slots.length;
        } else if (autoSlots.length === 0) {
          share = explicitSumPct > 100
            ? Number(slot.allocationPct!) / explicitSumPct
            : Number(slot.allocationPct!) / 100;
        } else if (explicitSumPct >= 100) {
          const totalWeight = explicitSumPct + autoSlots.length * (100 / slots.length);
          share = slot.allocationPct != null
            ? Number(slot.allocationPct) / totalWeight
            : (100 / slots.length) / totalWeight;
        } else {
          const remainingFrac = (100 - explicitSumPct) / 100;
          share = slot.allocationPct != null
            ? Number(slot.allocationPct) / 100
            : remainingFrac / autoSlots.length;
        }

        projMap.set(slot.projectId, (projMap.get(slot.projectId) || 0) + slot.hoursPerDay * share);

        if (dayYmd === today) {
          let curMap = projectUserCurrentShare.get(slot.projectId);
          if (!curMap) {
            curMap = new Map();
            projectUserCurrentShare.set(slot.projectId, curMap);
          }
          curMap.set(userId, share);
        }
      }
    }

    for (const [, projMap] of monthProjRaw.entries()) {
      let totalMonthRaw = 0;
      for (const h of projMap.values()) totalMonthRaw += h;
      const scale = totalMonthRaw > empCap ? empCap / totalMonthRaw : 1;

      for (const [projectId, rawHrs] of projMap.entries()) {
        let uMap = projectUserPlannedTotals.get(projectId);
        if (!uMap) {
          uMap = new Map();
          projectUserPlannedTotals.set(projectId, uMap);
        }
        uMap.set(userId, (uMap.get(userId) || 0) + rawHrs * scale);
      }
    }
  }

  // Step 4: Pre-aggregate scheduled project hours by department (for overhead engine & multi-dept split)
  const deptScheduledHoursTotal = new Map<string, number>();
  const deptActiveStaffScheduledHours = new Map<string, number>();
  const projectDeptScheduledHours = new Map<string, Map<string, number>>();

  for (const ctx of contexts) {
    const dMap = new Map<string, number>();
    projectDeptScheduledHours.set(ctx.id, dMap);

    if (ctx.roster.length > 0) {
      const uMap = projectUserTotals.get(ctx.id);
      if (uMap) {
        for (const [uid, stats] of uMap.entries()) {
          const activeDeptId = activeUserDeptMap.get(uid) || '';
          const dId = activeDeptId || userDeptMap.get(uid) || String(ctx.raw.department_id || '');
          if (!dId) continue;
          dMap.set(dId, (dMap.get(dId) || 0) + stats.elapsedHours);
          deptScheduledHoursTotal.set(dId, (deptScheduledHoursTotal.get(dId) || 0) + stats.elapsedHours);
          // Only credit real active department staff to department capacity utilization
          // (prevents unassigned/dept-less staff from showing phantom 72h utilization on 0-staff depts)
          if (activeDeptId) {
            deptActiveStaffScheduledHours.set(
              activeDeptId,
              (deptActiveStaffScheduledHours.get(activeDeptId) || 0) + stats.elapsedHours,
            );
          }
        }
      }
    } else if (ctx.elapsedStart && ctx.elapsedEnd) {
      const seq = calculateMonFriSequenceHours(
        ctx.elapsedStart,
        ctx.elapsedEnd,
        ctx.pausedBusinessDays,
        ctx.hoursPerDay,
        ctx.monthlyCap,
      );
      const hrs = seq.hours * ctx.plannedTeamSize;
      const dId = String(ctx.raw.department_id || '');
      if (dId && hrs > 0) {
        dMap.set(dId, (dMap.get(dId) || 0) + hrs);
        deptScheduledHoursTotal.set(dId, (deptScheduledHoursTotal.get(dId) || 0) + hrs);
      }
    }
  }

  // Step 5: Compute Department Overhead Pools & Conservation Scaling (Flaw #7 — §33 #10)
  const overheadEngine = computeDepartmentOverheadPools(
    departments,
    overheadAllocations,
    activeMembers,
    transactions,
    deptActiveStaffScheduledHours.size > 0 ? deptActiveStaffScheduledHours : deptScheduledHoursTotal,
    projectDeptScheduledHours,
    projects,
    bankAccounts,
    orgCurrency,
    filterFrom || undefined,
    filterTo || undefined,
  );

  // Conservation check: across active org projects, determine active months span per department
  // so absorbed overhead never exceeds eligible pool × active months for each department.
  const deptActiveMonths = new Map<string, Set<string>>();
  for (const ctx of contexts) {
    if (ctx.elapsedDays.length === 0) continue;
    const monthsInProj = new Set(ctx.elapsedDays.map(d => d.slice(0, 7)));
    const pDeptMap = projectDeptScheduledHours.get(ctx.id);
    if (pDeptMap) {
      for (const [dId, hrs] of pDeptMap.entries()) {
        if (hrs <= 0) continue;
        let set = deptActiveMonths.get(dId);
        if (!set) {
          set = new Set();
          deptActiveMonths.set(dId, set);
        }
        for (const m of monthsInProj) set.add(m);
      }
    }
  }

  // Compute raw overhead demand per department to enforce <= 100% pool cap
  const deptRawAbsorbedTotal = new Map<string, number>();
  for (const [, pDeptMap] of projectDeptScheduledHours.entries()) {
    for (const [dId, hrs] of pDeptMap.entries()) {
      const rate = overheadEngine.deptRatesPerHour.get(dId) || 0;
      deptRawAbsorbedTotal.set(dId, (deptRawAbsorbedTotal.get(dId) || 0) + hrs * rate);
    }
  }

  const deptConservationScale = new Map<string, number>();
  let totalOrgOverheadPool = 0;
  let totalOrgAbsorbedOverhead = 0;
  for (const d of departments || []) {
    const dId = String(d.id);
    const monthlyPool = overheadEngine.deptPools.get(dId) || 0;
    const monthCount = Math.max(1, deptActiveMonths.get(dId)?.size || 1);
    const eligiblePoolForSpan = monthlyPool * monthCount;
    const rawAbsorbed = deptRawAbsorbedTotal.get(dId) || 0;
    const scale = rawAbsorbed > eligiblePoolForSpan && rawAbsorbed > 0
      ? eligiblePoolForSpan / rawAbsorbed
      : 1;
    deptConservationScale.set(dId, scale);
    totalOrgOverheadPool += eligiblePoolForSpan;
    totalOrgAbsorbedOverhead += rawAbsorbed * scale;
  }

  // Step 6: Build Final Authoritative Profitability Object Per Project
  let totalOrgAllocatedLaborOrgCurr = 0;

  const computedProjects: ComputedProjectProfitability[] = contexts.map((ctx) => {
    const proj = ctx.raw;
    const projCurrency = ctx.currency;
    const quotedAmount = Number(proj.quoted_amount || 0);
    const initialBaseline = Number(proj.initial_baseline_cost || 0);
    const committedRemainingWork = Number(proj.committed_remaining_work || 0);
    const projDeptId = String(proj.department_id || '');

    // Direct ledger transactions (§5, §8, §12.4)
    const projTxnMap = new Map<string, any>();
    for (const t of transactions || []) {
      if (String(t.project_id || t.projectId || '') === ctx.id && isValidProjectTransaction(t, filterFrom || undefined, filterTo || undefined)) {
        projTxnMap.set(t.id, t);
      }
    }
    const projTxns = Array.from(projTxnMap.values());

    const directCost = round2(
      projTxns
        .filter((t: any) => isDirectProjectDebit(t))
        .reduce((sum: number, t: any) => {
          const amt = Math.abs(Number(t.amount || 0));
          return sum + convertCurrency(amt, t.currency || projCurrency, projCurrency);
        }, 0),
    );

    const recognizedRevenue = round2(
      projTxns
        .filter((t: any) => t.type === 'credit')
        .reduce((sum: number, t: any) => {
          const amt = Number(t.amount || 0);
          return sum + convertCurrency(amt, t.currency || projCurrency, projCurrency);
        }, 0),
    );

    // Planned timeline calculations (1× overall project schedule from start → end date)
    const plannedSeq = ctx.startDate && ctx.endDate && ctx.startDate <= ctx.endDate
      ? calculateMonFriSequenceHours(ctx.startDate, ctx.endDate, 0, ctx.hoursPerDay, ctx.monthlyCap)
      : { businessDays: 0, effectiveBusinessDays: 0, hours: 0, months: [] };
    const plannedBusinessDays = plannedSeq.businessDays;
    const projectSchedulePlannedHours = round2(plannedSeq.hours);

    const elapsedSeq = ctx.elapsedStart && ctx.elapsedEnd && ctx.elapsedStart <= ctx.elapsedEnd
      ? calculateMonFriSequenceHours(ctx.elapsedStart, ctx.elapsedEnd, ctx.pausedBusinessDays, ctx.hoursPerDay, ctx.monthlyCap)
      : { businessDays: 0, effectiveBusinessDays: 0, hours: 0, months: [] };
    const projectScheduleElapsedHours = round2(elapsedSeq.hours);
    const projectScheduleRemainingHours = projectSchedulePlannedHours > 0
      ? round2(Math.max(0, projectSchedulePlannedHours - projectScheduleElapsedHours))
      : 0;
    let projectScheduleOverrunHours = 0;
    if (ctx.endDate && ctx.elapsedEnd && ctx.elapsedEnd > ctx.endDate && ctx.status !== 'quoted') {
      const nextAfterEnd = nextCalendarDayYmd(ctx.endDate);
      if (nextAfterEnd) {
        const ovSeq = calculateMonFriSequenceHours(nextAfterEnd, ctx.elapsedEnd, 0, ctx.hoursPerDay, ctx.monthlyCap);
        projectScheduleOverrunHours = round2(ovSeq.hours);
      }
    }

    const elapsedBusinessDays = Math.max(0, ctx.elapsedDays.length - ctx.pausedBusinessDays);
    const isOpenEnded = !ctx.endDate;

    let remainingBusinessDays = 0;
    let overdueBusinessDays = 0;
    if (ctx.endDate) {
      const refDate = ctx.status === 'completed'
        ? (ctx.completedAt || ctx.endDate)
        : ctx.status === 'on_hold'
          ? (ctx.pausedAt || today)
          : today;
      if (refDate < ctx.endDate) {
        const nextAfterRef = nextCalendarDayYmd(refDate);
        const effRemStart = ctx.startDate && nextAfterRef && nextAfterRef < ctx.startDate ? ctx.startDate : nextAfterRef;
        remainingBusinessDays = effRemStart ? countBusinessDaysInclusive(effRemStart, ctx.endDate) : 0;
      } else if (refDate > ctx.endDate && ctx.status !== 'quoted') {
        const nextAfterEnd = nextCalendarDayYmd(ctx.endDate);
        overdueBusinessDays = nextAfterEnd ? countBusinessDaysInclusive(nextAfterEnd, refDate) : 0;
      }
    }
    const isOverdue = ctx.status === 'active' && overdueBusinessDays > 0;

    // Team & Labor Cost
    const isUsingDeptFallback = ctx.roster.length === 0;
    const missingSalaryMembers: string[] = [];
    const teamAllocations: ProjectTeamAllocation[] = [];

    let plannedHours = 0;
    let elapsedHours = 0;
    let overrunHours = 0;
    let laborCost = 0;
    let overrunLaborCost = 0;
    let activeDailyFte = 0;
    let ongoingDailyFte = 0;
    let weightedHourlyLaborRateSum = 0;

    if (!isUsingDeptFallback) {
      const uMap = projectUserTotals.get(ctx.id);
      const uPlanMap = projectUserPlannedTotals.get(ctx.id);
      const uCurShareMap = projectUserCurrentShare.get(ctx.id);
      for (const assign of ctx.roster) {
        const uid = assign.userId;
        const mem = memberByUserId.get(uid);
        const prof = profileMap.get(uid);
        const memName = prof?.name || mem?.user?.name || mem?.name || mem?.email?.split('@')[0] || 'Team Member';
        const memEmail = prof?.email || mem?.email || '';
        const memDeptId = userDeptMap.get(uid) || projDeptId;

        const { hourlyRate, monthlyCap, salaryMissing } = getMemberHourlyRate(uid, projDeptId, projCurrency);
        if (includeLaborInProjectCost && salaryMissing) missingSalaryMembers.push(memName);

        const uStats = uMap?.get(uid);
        const memElapsed = round2(uStats?.elapsedHours || 0);
        const memOverrun = round2(uStats?.overrunHours || 0);

        const shareFrac = uStats && uStats.activeDayCount > 0
          ? uStats.shareSum / uStats.activeDayCount
          : (assign.allocationPct != null ? assign.allocationPct / 100 : 1);

        const ongoingShare = uCurShareMap?.get(uid) ?? shareFrac;

        // Exact day-by-day planned hours across [startDate, endDate] with concurrency & 160h/mo cap
        let memPlanned = 0;
        if (ctx.endDate) {
          if (uPlanMap && uPlanMap.has(uid)) {
            memPlanned = round2(uPlanMap.get(uid)!);
          } else {
            const pStart = assign.assignedFrom && assign.assignedFrom > ctx.startDate ? assign.assignedFrom : ctx.startDate;
            const pEnd = assign.assignedTo && assign.assignedTo < ctx.endDate ? assign.assignedTo : ctx.endDate;
            if (pStart && pEnd && pStart <= pEnd) {
              const pSeq = calculateMonFriSequenceHours(pStart, pEnd, 0, ctx.hoursPerDay, monthlyCap);
              memPlanned = round2(pSeq.hours * shareFrac);
            }
          }
        }

        const effectiveHourlyRate = includeLaborInProjectCost ? hourlyRate : 0;
        const memLaborCost = includeLaborInProjectCost ? round2(memElapsed * hourlyRate) : 0;
        const memOverrunCost = includeLaborInProjectCost ? round2(memOverrun * hourlyRate) : 0;

        plannedHours += memPlanned;
        elapsedHours += memElapsed;
        overrunHours += memOverrun;
        laborCost += memLaborCost;
        overrunLaborCost += memOverrunCost;
        activeDailyFte += shareFrac;
        ongoingDailyFte += ongoingShare;
        weightedHourlyLaborRateSum += effectiveHourlyRate * ongoingShare;

        teamAllocations.push({
          userId: uid,
          name: memName,
          email: memEmail,
          avatarUrl: prof?.avatarUrl || null,
          departmentId: memDeptId || undefined,
          departmentName: memDeptId ? (deptNameMap.get(memDeptId) || memDeptId) : undefined,
          role: mem?.position || mem?.role || 'Team Member',
          assignedFrom: assign.assignedFrom,
          assignedTo: assign.assignedTo,
          allocationSharePct: round1(shareFrac * 100),
          isCustomAllocation: assign.allocationPct != null,
          isOverAllocated: Boolean(uStats?.overAllocated),
          salaryMissing: includeLaborInProjectCost ? salaryMissing : false,
          hourlyRate: round2(effectiveHourlyRate),
          ratePerMinute: Math.round((effectiveHourlyRate / 60) * 10000) / 10000,
          plannedHours: memPlanned,
          elapsedHours: memElapsed,
          overrunHours: memOverrun,
          laborCost: memLaborCost,
          overrunLaborCost: memOverrunCost,
        });
      }
      if (ctx.budgetedHours && ctx.budgetedHours > 0) {
        plannedHours = ctx.budgetedHours;
      }
    } else {
      // Zero-config Department FTE Fallback
      const fte = ctx.plannedTeamSize;
      const deptHourly = getDeptHourlyRate(projDeptId, projCurrency);
      plannedHours = ctx.budgetedHours && ctx.budgetedHours > 0
        ? ctx.budgetedHours
        : round2(plannedSeq.hours * fte);

      if (ctx.elapsedStart && ctx.elapsedEnd) {
        const fullSeq = calculateMonFriSequenceHours(
          ctx.elapsedStart,
          ctx.elapsedEnd,
          ctx.pausedBusinessDays,
          ctx.hoursPerDay,
          ctx.monthlyCap,
        );
        elapsedHours = round2(fullSeq.hours * fte);

        if (ctx.endDate && ctx.elapsedEnd > ctx.endDate) {
          const nextAfterEnd = nextCalendarDayYmd(ctx.endDate);
          if (nextAfterEnd) {
            const ovSeq = calculateMonFriSequenceHours(nextAfterEnd, ctx.elapsedEnd, 0, ctx.hoursPerDay, ctx.monthlyCap);
            overrunHours = round2(ovSeq.hours * fte);
          }
        }
      }

      const effectiveDeptHourly = includeLaborInProjectCost ? deptHourly : 0;
      laborCost = includeLaborInProjectCost ? round2(elapsedHours * deptHourly) : 0;
      overrunLaborCost = includeLaborInProjectCost ? round2(overrunHours * deptHourly) : 0;
      activeDailyFte = fte;
      ongoingDailyFte = fte;
      weightedHourlyLaborRateSum = effectiveDeptHourly * fte;
    }

    // Budgeted-hours overrun for open-ended projects with explicit budgetedHours cap (Flaw #5)
    if (isOpenEnded && ctx.budgetedHours && ctx.budgetedHours > 0 && elapsedHours > ctx.budgetedHours) {
      overrunHours = round2(elapsedHours - ctx.budgetedHours);
      const effRate = elapsedHours > 0 ? laborCost / elapsedHours : 0;
      overrunLaborCost = round2(overrunHours * effRate);
    }

    plannedHours = round2(plannedHours);
    elapsedHours = round2(elapsedHours);
    overrunHours = round2(overrunHours);
    laborCost = round2(laborCost);
    overrunLaborCost = round2(overrunLaborCost);
    totalOrgAllocatedLaborOrgCurr += convertCurrency(laborCost, projCurrency, orgCurrency);

    const remainingHours = plannedHours > 0 ? round2(Math.max(0, plannedHours - elapsedHours)) : 0;
    const exactCompletionHours = ctx.status === 'completed' ? elapsedHours : null;
    const scheduleProgressPct = plannedHours > 0
      ? Math.min(200, Math.round((elapsedHours / plannedHours) * 100))
      : 0;

    // Overhead Absorption (with strict <= 100% conservation — compute from unrounded hours to prevent drift)
    const pDeptMap = projectDeptScheduledHours.get(ctx.id) || new Map<string, number>();
    const overheadBreakdown: ProjectOverheadSlice[] = [];
    let assignedOverheadOrg = 0;

    for (const d of departments || []) {
      const dId = String(d.id);
      const rawSchedHrs = pDeptMap.get(dId) || 0;
      const schedHrs = round1(rawSchedHrs);
      if (rawSchedHrs <= 0 && dId !== projDeptId) continue;

      const ratePerHourOrg = overheadEngine.deptRatesPerHour.get(dId) || 0;
      const scale = deptConservationScale.get(dId) ?? 1;
      const absorbedOrg = rawSchedHrs * ratePerHourOrg * scale;
      assignedOverheadOrg += absorbedOrg;

      const poolOrg = overheadEngine.deptPools.get(dId) || 0;
      const cap = overheadEngine.deptCapacities.get(dId) ?? null;

      overheadBreakdown.push({
        departmentId: dId,
        departmentName: String(d.name || 'Department'),
        headcount: overheadEngine.deptHeadcounts.get(dId) || 0,
        departmentOverheadPool: round2(convertCurrency(poolOrg, orgCurrency, projCurrency)),
        departmentCapacityHours: cap,
        overheadRatePerHour: round2(convertCurrency(ratePerHourOrg * scale, orgCurrency, projCurrency)),
        scheduledHours: schedHrs,
        allocatedOverhead: round2(convertCurrency(absorbedOrg, orgCurrency, projCurrency)),
        absorptionPercent: poolOrg > 0 ? round1((absorbedOrg / poolOrg) * 100) : 0,
      });
    }

    const assignedOverhead = round2(convertCurrency(assignedOverheadOrg, orgCurrency, projCurrency));

    // §12.4 Financial Metrics
    const actualCost = round2(initialBaseline + directCost + laborCost + assignedOverhead);
    const directCosts = round2(directCost + laborCost);
    const quoteProfit = round2(quotedAmount - actualCost);
    const quoteMarginPct = quotedAmount > 0 ? round1((quoteProfit / quotedAmount) * 100) : null;
    const operatingProfit = round2(recognizedRevenue - actualCost);
    const operatingMarginPct = recognizedRevenue > 0 ? round1((operatingProfit / recognizedRevenue) * 100) : null;
    const projectContribution = round2(recognizedRevenue - directCosts);
    const budgetVariance = quotedAmount > 0 ? round1(((actualCost - quotedAmount) / quotedAmount) * 100) : 0;

    const targetProfit = round2(quotedAmount - initialBaseline);
    const targetMargin = quotedAmount > 0 ? round1((targetProfit / quotedAmount) * 100) : 0;

    // Blended hourly burn rate (labor + overhead per project-hour)
    const effectiveFte = Math.max(0.01, ongoingDailyFte || activeDailyFte || 1);
    const avgLaborRatePerHour = weightedHourlyLaborRateSum / effectiveFte;
    const projDeptOvhOrg = (overheadEngine.deptRatesPerHour.get(projDeptId) || 0) * (deptConservationScale.get(projDeptId) ?? 1);
    const avgOvhRatePerHour = elapsedHours > 0
      ? assignedOverhead / elapsedHours
      : convertCurrency(projDeptOvhOrg, orgCurrency, projCurrency);
    const hourlyBurnRate = round2(avgLaborRatePerHour + avgOvhRatePerHour);

    // Cost-to-Complete (ETC), Projected at Completion (EAC), Margin-at-Risk (§12.4)
    let costToComplete = 0;
    if (ctx.status === 'completed' || ctx.status === 'cancelled') {
      costToComplete = 0;
    } else if (committedRemainingWork > 0) {
      costToComplete = committedRemainingWork;
    } else if (remainingHours > 0 && hourlyBurnRate > 0) {
      costToComplete = round2(remainingHours * hourlyBurnRate);
    } else {
      costToComplete = 0;
    }
    const projectedAtCompletion = round2(actualCost + costToComplete);
    const marginAtRisk = round2(quotedAmount - projectedAtCompletion);

    // Break-Even Hours, Break-Even Date & Days Until Loss (projected forward from today at ongoing burn rate)
    const remainingBudgetForTime = quotedAmount - initialBaseline - directCost;
    const maxProfitableHours = quotedAmount > 0 && hourlyBurnRate > 0
      ? round1(Math.max(0, remainingBudgetForTime / hourlyBurnRate))
      : null;

    const dailyProjectHours = effectiveFte * ctx.hoursPerDay;
    const weeklyScheduledHours = round1(dailyProjectHours * 5);
    let breakEvenDate: string | null = null;
    let daysUntilLoss: number | null = null;

    if (maxProfitableHours != null && dailyProjectHours > 0) {
      const remainingProfitableHours = maxProfitableHours - elapsedHours;
      daysUntilLoss = Math.floor(remainingProfitableHours / dailyProjectHours);
      if (elapsedHours >= maxProfitableHours) {
        daysUntilLoss = 0;
        breakEvenDate = today;
      } else if (ctx.startDate && today < ctx.startDate) {
        const maxBizDays = Math.max(1, Math.floor(maxProfitableHours / dailyProjectHours));
        breakEvenDate = addBusinessDaysYmd(ctx.startDate, maxBizDays + ctx.pausedBusinessDays);
      } else {
        const nextDay = nextCalendarDayYmd(today) || today;
        breakEvenDate = daysUntilLoss > 0
          ? addBusinessDaysYmd(nextDay, daysUntilLoss)
          : today;
      }
    }

    // Burn Rate Per Business Day
    const consumedBurn = actualCost;
    const burnRatePerDay = elapsedBusinessDays > 0
      ? round2(consumedBurn / elapsedBusinessDays)
      : round2(dailyProjectHours * hourlyBurnRate);
    const plannedDailyBudget = plannedBusinessDays > 0 ? round2(quotedAmount / plannedBusinessDays) : 0;

    // Health Status & Actionable Alert Message
    let healthStatus: ProjectHealthStatus = 'on_track';
    let lossAmount = 0;
    let alertMessage: string | null = null;

    if (ctx.status === 'quoted') {
      healthStatus = 'quoted';
    } else if (ctx.status === 'cancelled') {
      healthStatus = 'cancelled';
    } else if (ctx.status === 'on_hold') {
      healthStatus = 'on_hold';
    } else if (ctx.status === 'completed') {
      const contractLoss = quotedAmount > 0 && actualCost > quotedAmount;
      const revLoss = recognizedRevenue > 0 && actualCost > recognizedRevenue;
      if (contractLoss || revLoss) {
        healthStatus = 'completed_loss';
        lossAmount = round2(contractLoss ? actualCost - quotedAmount : actualCost - recognizedRevenue);
        alertMessage = `Completed in loss by ${lossAmount.toLocaleString()} ${projCurrency} (${elapsedHours.toFixed(1)}h used${overrunHours > 0 ? `, +${overrunHours.toFixed(1)}h overrun` : ''}).`;
      } else {
        healthStatus = 'completed_profit';
      }
    } else {
      // Active project
      if (quotedAmount > 0 && actualCost > quotedAmount) {
        healthStatus = 'in_loss';
        lossAmount = round2(actualCost - quotedAmount);
        alertMessage = overrunHours > 0
          ? `Project is IN LOSS by ${lossAmount.toLocaleString()} ${projCurrency}. Out of time by +${overdueBusinessDays} business days (+${overrunHours.toFixed(1)}h overrun${includeLaborInProjectCost && overrunLaborCost > 0 ? ` = +${overrunLaborCost.toLocaleString()} ${projCurrency} extra labor` : ''}).`
          : `Project is IN LOSS by ${lossAmount.toLocaleString()} ${projCurrency} — actual spend (${actualCost.toLocaleString()}) exceeds quoted budget (${quotedAmount.toLocaleString()}).`;
      } else if (isOverdue || (ctx.budgetedHours && elapsedHours > ctx.budgetedHours)) {
        healthStatus = 'overtime';
        const countdown = daysUntilLoss != null && daysUntilLoss > 0
          ? ` At ${hourlyBurnRate.toFixed(2)} ${projCurrency}/hr burn, enters LOSS in ${daysUntilLoss} business day${daysUntilLoss === 1 ? '' : 's'}${breakEvenDate ? ` (${breakEvenDate})` : ''}.`
          : ' Budget ceiling nearly exhausted.';
        alertMessage = isOverdue
          ? `Out of time by +${overdueBusinessDays} business day${overdueBusinessDays === 1 ? '' : 's'} (+${overrunHours.toFixed(1)}h overrun).${countdown}`
          : `Exceeded budgeted cap of ${ctx.budgetedHours}h by +${overrunHours.toFixed(1)}h.${countdown}`;
      } else if (
        (quotedAmount > 0 && marginAtRisk < 0) ||
        (maxProfitableHours != null && maxProfitableHours > 0 && elapsedHours >= maxProfitableHours * 0.85)
      ) {
        healthStatus = 'at_risk';
        const projectedOverrun = marginAtRisk < 0 ? Math.abs(marginAtRisk) : 0;
        alertMessage = projectedOverrun > 0
          ? `Projected cost at completion (EAC) exceeds quote by ${projectedOverrun.toLocaleString()} ${projCurrency}${breakEvenDate ? ` — break-even date: ${breakEvenDate}` : ''}.`
          : `Approaching break-even threshold (${elapsedHours.toFixed(1)}h of ${maxProfitableHours?.toFixed(1)}h max profitable hours).`;
      } else {
        healthStatus = 'on_track';
      }
    }

    const deptScheduledHoursObj: Record<string, number> = {};
    for (const [dId, hrs] of pDeptMap.entries()) {
      deptScheduledHoursObj[dId] = round2(hrs);
    }

    return {
      projectId: ctx.id,
      projectName: String(proj.name || ''),
      code: String(proj.code || ''),
      clientName: String(proj.client_name || ''),
      departmentId: projDeptId,
      status: ctx.status,
      currency: projCurrency,
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      completedAt: ctx.completedAt,
      pausedAt: ctx.pausedAt,
      pausedBusinessDays: ctx.pausedBusinessDays,
      plannedTeamSize: ctx.plannedTeamSize,
      budgetedHours: ctx.budgetedHours,
      capacityBasis: 'scheduled_mon_fri_40h_160h',
      hoursPerDay: ctx.hoursPerDay,
      monthlyCapacityHours: ctx.monthlyCap,

      plannedBusinessDays,
      elapsedBusinessDays,
      remainingBusinessDays,
      overdueBusinessDays,
      projectSchedulePlannedHours,
      projectScheduleElapsedHours,
      projectScheduleRemainingHours,
      projectScheduleOverrunHours,
      plannedHours,
      elapsedHours,
      remainingHours,
      overrunHours,
      weeklyScheduledHours,
      exactCompletionHours,
      scheduleProgressPct,
      isOverdue,
      isOpenEnded,

      quotedAmount,
      initialBaselineCost: initialBaseline,
      directCost,
      laborCost,
      overrunLaborCost,
      assignedOverhead,
      actualCost,
      consumedBurn,
      hourlyBurnRate,
      burnRatePerDay,
      plannedDailyBudget,
      committedRemainingWork,
      costToComplete,
      projectedAtCompletion,
      marginAtRisk,

      revenue: recognizedRevenue,
      quoteProfit,
      quoteMarginPct,
      operatingProfit,
      profit: operatingProfit,
      profitMargin: operatingMarginPct,
      operatingMarginPct,
      projectContribution,
      targetProfit,
      targetMargin,
      budgetVariance,

      maxProfitableHours,
      breakEvenDate,
      daysUntilLoss,
      healthStatus,
      lossAmount,
      alertMessage,

      isUsingDeptFallback,
      missingSalaryMembers,
      contributorCount: teamAllocations.length,
      teamAllocations,
      overheadBreakdown,

      // Backwards-compatible aliases
      loggedHours: elapsedHours,
      approvedHours: elapsedHours,
      pendingHours: 0,
      billableHours: elapsedHours,
      nonBillableHours: 0,
      pendingLaborCost: 0,
      daysElapsed: elapsedBusinessDays,
      daysRemaining: remainingBusinessDays,
      totalSpanDays: plannedBusinessDays,
      completionPct: Math.min(100, scheduleProgressPct),
      contributors: teamAllocations.map(t => ({
        userId: t.userId,
        name: t.name,
        email: t.email,
        avatarUrl: t.avatarUrl || null,
        hours: t.elapsedHours,
        approvedHours: t.elapsedHours,
        laborCost: t.laborCost,
        allocationSharePct: t.allocationSharePct,
        hourlyRate: t.hourlyRate,
        overrunHours: t.overrunHours,
      })),
      deptScheduledHours: deptScheduledHoursObj,
    };
  });

  // Payroll GL vs Management Allocation Reconciliation (§33 #1)
  // Scale monthly payroll by the exact distinct active months covered by elapsed projects so
  // multi-month project labor is never compared against a single month's payroll.
  const allActiveMonths = new Set<string>();
  for (const ctx of contexts) {
    for (const d of ctx.elapsedDays) {
      allActiveMonths.add(d.slice(0, 7));
    }
  }
  const activeMonthsSpan = Math.max(1, allActiveMonths.size);

  const monthlyOrgPayroll = activeMembers.reduce((sum: number, m: any) => {
    const sCurr = String(m.salary_currency || orgCurrency).toUpperCase();
    const fix = Number(m.fixed_salary || m.salary || 0);
    if (fix > 0) return sum + convertCurrency(fix, sCurr, orgCurrency);
    const hr = Number(m.hourly_rate || 0);
    return sum + (hr > 0 ? convertCurrency(hr * 160, sCurr, orgCurrency) : 0);
  }, 0);
  const totalOrgPayrollExpense = round2(monthlyOrgPayroll * activeMonthsSpan);
  const totalOrgAllocatedLabor = round2(totalOrgAllocatedLaborOrgCurr);
  const unallocatedPayrollBench = round2(Math.max(0, totalOrgPayrollExpense - totalOrgAllocatedLabor));
  const overAllocatedPayroll = round2(Math.max(0, totalOrgAllocatedLabor - totalOrgPayrollExpense));
  const reconStatus: 'balanced' | 'over_allocated' = overAllocatedPayroll > 0.01 ? 'over_allocated' : 'balanced';

  return {
    projects: computedProjects,
    deptScheduledHoursTotal,
    deptActiveStaffScheduledHours,
    projectDeptScheduledHours,
    reconciliationTrace: {
      activeMonthsSpan,
      totalOrgPayrollExpense,
      totalOrgAllocatedLabor,
      unallocatedPayrollBench,
      overAllocatedPayroll,
      totalOrgOverheadPool: round2(totalOrgOverheadPool),
      totalOrgAbsorbedOverhead: round2(totalOrgAbsorbedOverhead),
      unallocatedBenchOverhead: round2(Math.max(0, totalOrgOverheadPool - totalOrgAbsorbedOverhead)),
      reconciliationEquation: 'Period Payroll Expense = Schedule-Allocated Project Labor + Unallocated Bench Capacity',
      status: reconStatus,
    },
  };
}
