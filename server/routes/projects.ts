/**
 * §8 & §12.4 & §13 — Projects & Profitability Engine.
 * Mounted at `/organizations/:organizationId/projects` (mergeParams).
 * Persists exclusively to Supabase PostgreSQL with rigorous financial correctness.
 */

import { Router, type Request, type Response } from 'express';
import type { Project, TimesheetEntry, ProjectTask } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';
import {
  reconcileTask,
  buildAutoCloseDescription,
  doesEntryMatchTask,
  todayYmdLocal,
} from '../../src/lib/taskReconciler.js';
import {
  isValidProjectTransaction,
  isDirectProjectDebit,
} from '../../src/lib/projectTransactionFilter.js';
import {
  computeOrgProjectsProfitability,
  type ComputedProjectProfitability,
} from '../services/projectScheduleCostEngine.js';
import {
  countBusinessDaysInclusive,
  todayYmdCalendar,
  normalizeYmd,
} from '../../src/lib/projectScheduleHours.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function callerId(req: Request): string {
  return (req as any).user?.id || (req as any).userId || (req.headers['x-user-id'] as string) || '';
}

function mapDbToDomainProject(row: Record<string, any>): Project {
  const rawAssignments = Array.isArray(row.member_assignments)
    ? row.member_assignments
    : (typeof row.member_assignments === 'string'
      ? (() => { try { const p = JSON.parse(row.member_assignments); return Array.isArray(p) ? p : []; } catch { return []; } })()
      : []);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    clientName: String(row.client_name ?? ''),
    departmentId: String(row.department_id ?? ''),
    status: row.status as Project['status'],
    startDate: String(row.start_date ?? ''),
    endDate: row.end_date ? String(row.end_date) : undefined,
    completedAt: row.completed_at ? String(row.completed_at).slice(0, 10) : undefined,
    pausedAt: row.paused_at ? String(row.paused_at).slice(0, 10) : undefined,
    pausedBusinessDays: Number(row.paused_business_days ?? 0),
    plannedTeamSize: Number(row.planned_team_size ?? 1),
    budgetedHours: row.budgeted_hours != null ? Number(row.budgeted_hours) : null,
    hoursPerDay: Number(row.hours_per_day ?? 8),
    monthlyCapacityHours: Number(row.monthly_capacity_hours ?? 160),
    memberAssignments: rawAssignments,
    quotedAmount: Number(row.quoted_amount ?? 0),
    actualCost: Number(row.actual_cost ?? 0),
    currency: String(row.currency ?? 'USD'),
    initialBaselineCost: Number(row.initial_baseline_cost ?? 0),
    committedRemainingWork: Number(row.committed_remaining_work ?? 0),
  };
}

const OPTIONAL_SCHEDULE_COLUMNS = [
  'completed_at',
  'paused_at',
  'paused_business_days',
  'planned_team_size',
  'budgeted_hours',
  'hours_per_day',
  'monthly_capacity_hours',
  'member_assignments',
];

function stripOptionalScheduleColumns(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  for (const col of OPTIONAL_SCHEDULE_COLUMNS) {
    delete copy[col];
  }
  return copy;
}

function isMissingColumnError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '42703' || code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache');
}

function mapDomainToDbProject(proj: Project): Record<string, unknown> {
  return {
    id: proj.id,
    organization_id: proj.organizationId,
    name: proj.name,
    code: proj.code || '',
    client_name: proj.clientName || '',
    department_id: proj.departmentId || null,
    status: proj.status || 'quoted',
    start_date: proj.startDate || todayYmdCalendar(),
    end_date: proj.endDate || null,
    completed_at: proj.completedAt || (proj.status === 'completed' ? todayYmdCalendar() : null),
    paused_at: proj.pausedAt || (proj.status === 'on_hold' ? todayYmdCalendar() : null),
    paused_business_days: Number(proj.pausedBusinessDays ?? 0),
    planned_team_size: Math.max(1, Number(proj.plannedTeamSize ?? 1)),
    budgeted_hours: proj.budgetedHours != null && Number(proj.budgetedHours) > 0 ? Number(proj.budgetedHours) : null,
    hours_per_day: Number(proj.hoursPerDay ?? 8),
    monthly_capacity_hours: Number(proj.monthlyCapacityHours ?? 160),
    member_assignments: Array.isArray(proj.memberAssignments) ? proj.memberAssignments : [],
    quoted_amount: proj.quotedAmount || 0,
    actual_cost: proj.actualCost || 0,
    currency: proj.currency || 'USD',
    initial_baseline_cost: proj.initialBaselineCost ?? 0,
    committed_remaining_work: proj.committedRemainingWork ?? 0,
  };
}

/**
 * Bidirectionally syncs project team roster into `organization_members.assigned_projects`
 * so Team & Permissions and Employee Portal `My Projects` remain 100% consistent.
 */
async function syncProjectMembersToOrgMembers(
  sb: any,
  orgId: string,
  projectId: string,
  targetUserIds: string[],
): Promise<void> {
  try {
    const targetSet = new Set(targetUserIds.map(String).filter(Boolean));
    const { data: orgMembers } = await sb
      .from('organization_members')
      .select('id, user_id, assigned_projects')
      .eq('organization_id', orgId);

    if (!Array.isArray(orgMembers)) return;

    const updates: Promise<any>[] = [];
    for (const m of orgMembers) {
      const uid = String(m.user_id || '');
      if (!uid) continue;
      const current: string[] = Array.isArray(m.assigned_projects)
        ? m.assigned_projects.map(String)
        : [];
      const hasProject = current.includes(projectId);
      const shouldHave = targetSet.has(uid);

      if (shouldHave && !hasProject) {
        const next = [...current, projectId];
        updates.push(
          sb.from('organization_members')
            .update({ assigned_projects: next })
            .eq('id', m.id)
            .eq('organization_id', orgId),
        );
      } else if (!shouldHave && hasProject) {
        const next = current.filter((pid) => pid !== projectId);
        updates.push(
          sb.from('organization_members')
            .update({ assigned_projects: next })
            .eq('id', m.id)
            .eq('organization_id', orgId),
        );
      }
    }
    if (updates.length > 0) {
      await Promise.allSettled(updates);
    }
  } catch (err: any) {
    console.warn('[projects.syncMembers] Non-fatal sync warning:', err?.message);
  }
}

/**
 * Emits a deduplicated server-owned alert in `organization_notifications` (§29 X-11)
 * when an active project enters `in_loss` or `overtime`.
 */
async function emitProjectHealthNotifications(
  sb: any,
  orgId: string,
  computedProjects: ComputedProjectProfitability[],
): Promise<void> {
  try {
    const alertProjects = computedProjects.filter(
      (p) => p.healthStatus === 'in_loss' || p.healthStatus === 'overtime',
    );
    if (alertProjects.length === 0) return;

    const { data: existingNotifs } = await sb
      .from('organization_notifications')
      .select('id, title, type')
      .eq('organization_id', orgId)
      .in('type', ['project_loss', 'project_overtime'])
      .limit(100);

    const existingTitles = new Set((existingNotifs || []).map((n: any) => String(n.title || '')));
    const inserts: any[] = [];

    for (const p of alertProjects) {
      const notifType = p.healthStatus === 'in_loss' ? 'project_loss' : 'project_overtime';
      const title = p.healthStatus === 'in_loss'
        ? `Project In Loss: ${p.projectName}`
        : `Project Overtime Alert: ${p.projectName}`;
      if (existingTitles.has(title)) continue;
      existingTitles.add(title);
      inserts.push({
        id: `notif-proj-${p.projectId}-${p.healthStatus}-${Date.now()}`,
        organization_id: orgId,
        type: notifType,
        title,
        message: p.alertMessage || `${p.projectName} requires attention.`,
        priority: p.healthStatus === 'in_loss' ? 'high' : 'medium',
        read: false,
        action_url: `/dashboard?view=projects&projectId=${encodeURIComponent(p.projectId)}`,
        created_at: new Date().toISOString(),
      });
    }

    if (inserts.length > 0) {
      await sb.from('organization_notifications').insert(inserts);
    }
  } catch {
    /* Non-fatal if organization_notifications table/schema differs */
  }
}


function mapDbToDomainTask(row: Record<string, any>): ProjectTask {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    assignedTo: row.assigned_to ? String(row.assigned_to) : undefined,
    assignedToName: row.assigned_to_name ? String(row.assigned_to_name) : undefined,
    status: (row.status || 'todo') as ProjectTask['status'],
    priority: (row.priority || 'medium') as ProjectTask['priority'],
    estimatedHours: Number(row.estimated_hours ?? 0),
    loggedHours: Number(row.logged_hours ?? 0),
    startDate: row.start_date ? String(row.start_date) : undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function createProjectsRouter(): Router {
  const r = Router({ mergeParams: true });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /profitability - Schedule-Driven Mon–Fri 40h/wk, 160h/mo Engine (§12.4)
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/profitability', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { from, to, period } = req.query;

    let fromDate: string | undefined = undefined;
    let toDate: string | undefined = undefined;

    if (period && typeof period === 'string') {
      const daysBack = period === '1M' ? 30 : period === '3M' ? 90 : 365;
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      fromDate = d.toISOString().slice(0, 10);
      toDate = todayYmdCalendar();
    } else {
      if (typeof from === 'string' && from) fromDate = from;
      if (typeof to === 'string' && to) toDate = to;
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const [
        { data: pData },
        { data: tData },
        { data: mData },
        { data: dData },
        { data: oaData },
        { data: profData },
        { data: bankAccountsData },
        { data: teamsData },
        { data: teamMembersData },
        { data: orgRow },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('organization_id', orgId).order('name', { ascending: true }),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('profiles').select('id, full_name, email, avatar_url'),
        sb.from('bank_accounts').select('id, balance, currency').eq('organization_id', orgId),
        sb.from('agency_teams').select('*').eq('organization_id', orgId),
        sb.from('agency_team_members').select('*').eq('organization_id', orgId),
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
      ]);

      if (!pData || pData.length === 0) {
        return ok(res, []);
      }

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();

      const engineResult = computeOrgProjectsProfitability({
        projects: pData,
        transactions: tData || [],
        members: mData || [],
        departments: dData || [],
        overheadAllocations: oaData || [],
        agencyTeams: teamsData || [],
        agencyTeamMembers: teamMembersData || [],
        bankAccounts: bankAccountsData || [],
        profiles: profData || [],
        orgCurrency,
        fromDate,
        toDate,
      });

      // Strictly read-only GET handler (Handoff §14 L739 & §16: never mutate DB state on GET)
      // Emit deduplicated server-side alerts for IN LOSS / OVERTIME projects (§29 X-11)
      void emitProjectHealthNotifications(sb, orgId, engineResult.projects);

      return ok(res, engineResult.projects);
    } catch (err) {
      console.error('[projects.profitability] Supabase error:', err);
      return fail(res, 500, 'Failed to compute project profitability');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /:id/profitability-details - Schedule & Cost Breakdown (No Timesheets)
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/:id/profitability-details', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = String(req.params.id);
    const { from, to } = req.query;

    const fromDate = typeof from === 'string' && from ? from : undefined;
    const toDate = typeof to === 'string' && to ? to : undefined;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const [
        { data: allProjects },
        { data: txnData },
        { data: memData },
        { data: deptData },
        { data: oaData },
        { data: profData },
        { data: tasksData },
        { data: bankAccountsData },
        { data: teamsData },
        { data: teamMembersData },
        { data: orgRow },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('profiles').select('id, full_name, email, avatar_url'),
        sb.from('project_tasks').select('*').eq('organization_id', orgId).eq('project_id', projectId),
        sb.from('bank_accounts').select('id, balance, currency').eq('organization_id', orgId),
        sb.from('agency_teams').select('*').eq('organization_id', orgId),
        sb.from('agency_team_members').select('*').eq('organization_id', orgId),
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
      ]);

      const projectData = (allProjects || []).find((p: any) => String(p.id) === projectId);
      if (!projectData) {
        return notFound(res, 'Project');
      }

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      const projCurrency = String(projectData.currency || orgCurrency).toUpperCase();

      const engineResult = computeOrgProjectsProfitability({
        projects: allProjects || [],
        transactions: txnData || [],
        members: memData || [],
        departments: deptData || [],
        overheadAllocations: oaData || [],
        agencyTeams: teamsData || [],
        agencyTeamMembers: teamMembersData || [],
        bankAccounts: bankAccountsData || [],
        profiles: profData || [],
        orgCurrency,
        fromDate,
        toDate,
      });

      const computed = engineResult.projects.find((p) => p.projectId === projectId);
      if (!computed) {
        return notFound(res, 'Project');
      }

      // Direct ledger transactions for drill-down
      const txnMap = new Map<string, any>();
      for (const t of (txnData || [])) {
        if (String(t.project_id || '') === projectId && isValidProjectTransaction(t, fromDate, toDate)) {
          txnMap.set(t.id, t);
        }
      }
      const projectTxns = Array.from(txnMap.values());

      const income = projectTxns
        .filter((t: any) => t.type === 'credit')
        .map((t: any) => ({
          id: t.id,
          date: t.date,
          description: t.description || t.narration || 'Project credit',
          narration: t.narration || undefined,
          amount: convertCurrency(Number(t.amount || 0), t.currency || projCurrency, projCurrency),
          type: t.type,
          categoryId: t.category_id,
          status: t.status,
          currency: projCurrency,
        }));

      const expenses = projectTxns
        .filter((t: any) => isDirectProjectDebit(t))
        .map((t: any) => ({
          id: t.id,
          date: t.date,
          description: t.description || t.narration || 'Direct expense',
          narration: t.narration || undefined,
          amount: convertCurrency(Math.abs(Number(t.amount || 0)), t.currency || projCurrency, projCurrency),
          type: t.type,
          categoryId: t.category_id,
          status: t.status,
          currency: projCurrency,
        }));

      // Schedule-allocated labor entries (backwards-compatible shape for ProfitIntelligenceView drilldown)
      const laborEntries = computed.teamAllocations.map((ta) => ({
        id: `sched-${projectId}-${ta.userId}`,
        userId: ta.userId,
        userName: ta.name,
        departmentName: ta.departmentName,
        date: ta.assignedFrom || computed.startDate,
        hours: ta.elapsedHours,
        plannedHours: ta.plannedHours,
        overrunHours: ta.overrunHours,
        allocationSharePct: ta.allocationSharePct,
        effectiveHourlyRate: ta.hourlyRate,
        cost: ta.laborCost,
        salaryMissing: ta.salaryMissing,
      }));

      return ok(res, {
        project: mapDbToDomainProject(projectData),
        summary: {
          quotedAmount: computed.quotedAmount,
          initialBaselineCost: computed.initialBaselineCost,
          committedRemainingWork: computed.committedRemainingWork,
          directExpenses: computed.directCost,
          directCosts: computed.directCost,
          laborCost: computed.laborCost,
          overrunLaborCost: computed.overrunLaborCost,
          pendingLaborCost: 0,
          assignedOverhead: computed.assignedOverhead,
          actualProjectCost: computed.actualCost,
          actualCost: computed.actualCost,
          totalCosts: computed.actualCost,
          consumedBurn: computed.consumedBurn,
          hourlyBurnRate: computed.hourlyBurnRate,
          burnRatePerDay: computed.burnRatePerDay,
          recognizedRevenue: computed.revenue,
          totalRevenue: computed.revenue,
          quoteProfit: computed.quoteProfit,
          quoteMarginPct: computed.quoteMarginPct,
          targetProfit: computed.targetProfit,
          targetMarginPercent: computed.targetMargin,
          projectContribution: computed.projectContribution,
          projectOperatingProfit: computed.operatingProfit,
          netProfit: computed.operatingProfit,
          projectMarginPercent: computed.profitMargin,
          operatingMarginPct: computed.operatingMarginPct,
          variancePct: computed.budgetVariance,
          costToComplete: computed.costToComplete,
          projectedAtCompletion: computed.projectedAtCompletion,
          marginAtRisk: computed.marginAtRisk,
          plannedHours: computed.plannedHours,
          elapsedHours: computed.elapsedHours,
          remainingHours: computed.remainingHours,
          overrunHours: computed.overrunHours,
          exactCompletionHours: computed.exactCompletionHours,
          maxProfitableHours: computed.maxProfitableHours,
          breakEvenDate: computed.breakEvenDate,
          daysUntilLoss: computed.daysUntilLoss,
          healthStatus: computed.healthStatus,
          lossAmount: computed.lossAmount,
          alertMessage: computed.alertMessage,
          capacityBasis: computed.capacityBasis,
          isUsingDeptFallback: computed.isUsingDeptFallback,
          missingSalaryMembers: computed.missingSalaryMembers,
          loggedHours: computed.elapsedHours,
          totalLoggedHours: computed.elapsedHours,
          totalApprovedHours: computed.elapsedHours,
          totalBillableHours: computed.elapsedHours,
          totalNonBillableHours: 0,
          contributorCount: computed.contributorCount,
        },
        reconciliationTrace: {
          ...engineResult.reconciliationTrace,
          projectAllocatedLabor: computed.laborCost,
        },
        timeline: {
          startDate: computed.startDate,
          endDate: computed.endDate,
          completedAt: computed.completedAt,
          pausedAt: computed.pausedAt,
          pausedBusinessDays: computed.pausedBusinessDays,
          plannedBusinessDays: computed.plannedBusinessDays,
          elapsedBusinessDays: computed.elapsedBusinessDays,
          remainingBusinessDays: computed.remainingBusinessDays,
          overdueBusinessDays: computed.overdueBusinessDays,
          daysElapsed: computed.elapsedBusinessDays,
          daysRemaining: computed.remainingBusinessDays,
          totalSpanDays: computed.plannedBusinessDays,
          completionPct: computed.completionPct,
          scheduleProgressPct: computed.scheduleProgressPct,
          plannedDailyBudget: computed.plannedDailyBudget,
          isOverdue: computed.isOverdue,
          isOpenEnded: computed.isOpenEnded,
        },
        teamAllocations: computed.teamAllocations,
        contributors: computed.contributors,
        laborEntries,
        timesheetEntries: [],
        tasks: (tasksData || []).map(mapDbToDomainTask),
        income,
        expenses,
        overheadAllocations: oaData || [],
        overheadBreakdown: computed.overheadBreakdown,
      });
    } catch (err: any) {
      console.error('[projects.profitability-details] Exception:', err);
      return fail(res, 500, err?.message || 'Error calculating project profitability details');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /:id/timesheets/:entryId/approve - §13 Manager Approval & Rate Lock
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/:id/timesheets/:entryId/approve', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const entryId = req.params.entryId;
    const approverUserId = callerId(req);
    const role = req.orgMembership?.role;
    const isApprover = role === 'owner' || role === 'admin' || role === 'accountant' || role === 'manager';
    if (!isApprover) {
      return fail(res, 403, 'Forbidden: Approver permission required to approve timesheets');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: entry, error: fetchErr } = await sb
        .from('timesheet_entries')
        .select('*')
        .eq('id', entryId)
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (fetchErr || !entry) {
        return notFound(res, 'Timesheet entry');
      }

      if (entry.status !== 'submitted') {
        if (entry.status === 'approved') {
          return ok(res, entry, 'Timesheet entry is already approved.');
        }
        return fail(res, 400, 'Only submitted timesheet entries can be approved. This entry is still in draft.');
      }

      // Self-approval guard (§33 Invariant #11): Non-owner cannot approve their own timesheet
      if (entry.user_id === approverUserId && role !== 'owner') {
        return fail(res, 403, 'Self-approval of timesheet entries is strictly prohibited');
      }

      // Lookup member salary or hourly rate to lock effective cost
      const { data: mem } = await sb
        .from('organization_members')
        .select('fixed_salary, hourly_rate, hours_per_day, working_days_per_month')
        .eq('organization_id', orgId)
        .eq('user_id', entry.user_id)
        .maybeSingle();

      const hours = Number(entry.hours || 0);
      const durationMinutes = Number(entry.duration_minutes || Math.round(hours * 60));
      const hPerDay = Number(mem?.hours_per_day || 8);
      const dPerMonth = Number(mem?.working_days_per_month || 20);
      const capHours = hPerDay > 0 && dPerMonth > 0 ? hPerDay * dPerMonth : 160;
      const baseSalary = Number(mem?.fixed_salary || 0);
      const explicitHourly = Number(mem?.hourly_rate || 0);
      const exactCostPerHour = explicitHourly > 0
        ? explicitHourly
        : baseSalary > 0
          ? baseSalary / capHours
          : 0;
      const costPerHour = Math.round(exactCostPerHour * 100) / 100;
      const costPerMinute = Math.round((exactCostPerHour / 60) * 10000) / 10000;
      // Compute total from exact unrounded per-minute rate to avoid F-04 cent drift
      const calculatedLaborCost = Math.round(durationMinutes * (exactCostPerHour / 60) * 100) / 100;

      const { data: updated, error: updateErr } = await sb
        .from('timesheet_entries')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: approverUserId || null,
          effective_cost_per_hour: costPerHour,
          effective_cost_per_minute: costPerMinute,
          calculated_labor_cost: calculatedLaborCost,
        })
        .eq('id', entryId)
        .select()
        .single();

      if (updateErr) {
        return fail(res, 500, updateErr.message);
      }

      // Auto-advance quoted project to active once time has been approved
      try {
        await sb
          .from('projects')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', projectId)
          .eq('organization_id', orgId)
          .eq('status', 'quoted');
      } catch (pErr) {
        console.warn('[projects.timesheetApprove] Could not advance project status:', pErr);
      }

      // Auto-advance & close associated task/deliverable with partial/full hour verification
      let autoClosedTask: any = null;
      let completionMsg = 'Timesheet entry approved and labor cost locked.';
      try {
        let targetTask: any = null;
        if (entry.task_id) {
          const { data: tById } = await sb
            .from('project_tasks')
            .select('*')
            .eq('id', entry.task_id)
            .eq('organization_id', orgId)
            .maybeSingle();
          targetTask = tById;
        }
        if (!targetTask && entry.description) {
          const { data: tByTitle } = await sb
            .from('project_tasks')
            .select('*')
            .eq('project_id', projectId)
            .eq('organization_id', orgId)
            .ilike('title', entry.description.trim())
            .maybeSingle();
          targetTask = tByTitle;
        }

        if (targetTask) {
          const { data: projTs } = await sb
            .from('timesheet_entries')
            .select('*')
            .eq('project_id', projectId)
            .eq('organization_id', orgId);

          const allTs = (projTs || []).map((r: any) => (r.id === entryId ? updated : r));
          const reconciled = reconcileTask({ ...targetTask, status: 'completed' }, allTs);
          const estH = Number(targetTask.estimated_hours || 0);
          const appH = Number(reconciled.approvedHours || 0);
          const incH = Number(reconciled.incompleteHours || 0);
          const entryDate = entry.date || todayYmdLocal();

          let noteText = '';
          if (estH > 0 && appH < estH - 0.001) {
            noteText = `Logged ${appH.toFixed(1)}h of ${estH.toFixed(1)}h allocated (${incH.toFixed(1)}h incomplete on ${entryDate})`;
            completionMsg = `Timesheet approved. Task "${targetTask.title}" auto-closed with note: ${appH.toFixed(1)}h / ${estH.toFixed(1)}h logged (${incH.toFixed(1)}h incomplete).`;
          } else if (targetTask.due_date && entryDate > targetTask.due_date) {
            noteText = `Completed late (${appH.toFixed(1)}h approved on ${entryDate}; due ${targetTask.due_date})`;
            completionMsg = `Timesheet approved. Task "${targetTask.title}" auto-closed (Completed Late).`;
          } else {
            noteText = `Completed on time (${appH.toFixed(1)}h${estH > 0 ? ` / ${estH.toFixed(1)}h` : ''} approved on ${entryDate})`;
            completionMsg = `Timesheet approved. Task "${targetTask.title}" auto-closed (Completed On Time).`;
          }

          const updatedDesc = buildAutoCloseDescription(targetTask.description, noteText);
          const { data: closedTask } = await sb
            .from('project_tasks')
            .update({
              status: 'completed',
              logged_hours: reconciled.loggedHours ?? appH,
              description: updatedDesc,
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetTask.id)
            .eq('organization_id', orgId)
            .select()
            .maybeSingle();

          autoClosedTask = closedTask ? reconcileTask(closedTask, allTs) : reconciled;
        }
      } catch (tErr) {
        console.warn('[projects.timesheetApprove] Could not auto-close task status:', tErr);
      }

      // Emit timesheet approval notification (gated by employee notification preferences)
      try {
        const { emitEmployeeTimesheetApprovalNotification } = await import('./employee.js');
        await emitEmployeeTimesheetApprovalNotification(sb, orgId, entry, approverUserId);
      } catch (notifErr) {
        console.warn('[projects.timesheetApprove] Notification emit warning:', notifErr);
      }

      return ok(res, { ...updated, autoClosedTask }, completionMsg);
    } catch (err: any) {
      console.error('[projects.timesheetApprove] Error:', err);
      return fail(res, 500, err?.message || 'Error approving timesheet');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /:id/timesheets/:entryId/revise - §13 Time Revision with Audit Delta
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/:id/timesheets/:entryId/revise', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const entryId = req.params.entryId;
    const modifierId = callerId(req);
    const { newHours, reason } = req.body as { newHours: number; reason?: string };

    if (newHours == null || isNaN(newHours) || newHours <= 0) {
      return fail(res, 400, 'Valid newHours greater than 0 required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: entry, error: fetchErr } = await sb
        .from('timesheet_entries')
        .select('*')
        .eq('id', entryId)
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (fetchErr || !entry) {
        return notFound(res, 'Timesheet entry');
      }

      if (entry.status !== 'submitted') {
        if (entry.status === 'approved') {
          return ok(res, entry, 'Timesheet entry is already approved.');
        }
        return fail(res, 400, 'Only submitted timesheet entries can be approved. This entry is still in draft.');
      }

      const prevHours = Number(entry.hours || 0);
      const newDurationMinutes = Math.round(newHours * 60);
      const costPerMinute = Number(entry.effective_cost_per_minute || 50 / 60);
      const newLaborCost = Math.round(newDurationMinutes * costPerMinute * 100) / 100;

      const history = Array.isArray(entry.revision_history) ? [...entry.revision_history] : [];
      history.push({
        previousHours: prevHours,
        newHours,
        revisedAt: new Date().toISOString(),
        revisedBy: modifierId || 'Manager',
        reason: reason || 'Manager revision',
      });

      const { data: updated, error: updateErr } = await sb
        .from('timesheet_entries')
        .update({
          hours: newHours,
          duration_minutes: newDurationMinutes,
          calculated_labor_cost: newLaborCost,
          revision_history: history,
        })
        .eq('id', entryId)
        .select()
        .single();

      if (updateErr) {
        return fail(res, 500, updateErr.message);
      }

      return ok(res, updated, `Timesheet revised from ${prevHours}h to ${newHours}h with audit record preserved.`);
    } catch (err: any) {
      console.error('[projects.timesheetRevise] Error:', err);
      return fail(res, 500, err?.message || 'Error revising timesheet');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /:id/timesheets/:entryId/reject - Reject timesheet
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/:id/timesheets/:entryId/reject', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const entryId = req.params.entryId;
    const { reason } = req.body as { reason?: string };

    const role = req.orgMembership?.role;
    const isApprover = role === 'owner' || role === 'admin' || role === 'accountant' || role === 'manager';
    if (!isApprover) {
      return fail(res, 403, 'Forbidden: Approver permission required to reject timesheets');
    }

    if (!reason || !String(reason).trim()) {
      return fail(res, 400, 'A non-empty rejection reason is required when rejecting a timesheet');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const trimmedReason = String(reason).trim();
      const { data: updated, error } = await sb
        .from('timesheet_entries')
        .update({
          status: 'draft',
          rejection_reason: trimmedReason,
        })
        .eq('id', entryId)
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) return fail(res, 500, error.message);
      return ok(res, updated, 'Timesheet returned to draft status.');
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Error rejecting timesheet');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Core REST CRUD routes for projects
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('projects')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[projects.get] Supabase query error:', error);
      return fail(res, 500, error.message);
    }
    return ok(res, (data || []).map(mapDbToDomainProject));
  });

  r.get('/:id/transactions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('transactions')
      .select('*')
      .eq('project_id', req.params.id)
      .eq('organization_id', orgId);

    if (error) return fail(res, 500, error.message);
    return ok(res, data || []);
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Project');
    return ok(res, mapDbToDomainProject(data));
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Project, 'id' | 'organizationId'>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = (data as any).id || ('proj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const startDate = normalizeYmd(data.startDate) || todayYmdCalendar();

    // Normalize memberAssignments from either explicit array or assignedMemberIds
    const explicitAssignments = Array.isArray(data.memberAssignments) && data.memberAssignments.length > 0
      ? data.memberAssignments.map((a) => ({
        userId: String(a.userId),
        assignedFrom: normalizeYmd(a.assignedFrom) || startDate,
        assignedTo: normalizeYmd(a.assignedTo) || undefined,
        allocationPct: a.allocationPct != null && Number(a.allocationPct) > 0 ? Math.min(100, Number(a.allocationPct)) : null,
      }))
      : (Array.isArray(data.assignedMemberIds)
        ? data.assignedMemberIds.filter(Boolean).map((uid) => ({
          userId: String(uid),
          assignedFrom: startDate,
          allocationPct: null,
        }))
        : []);

    const newProject: Project = {
      ...data,
      id: newId,
      organizationId: orgId,
      startDate,
      memberAssignments: explicitAssignments,
    };

    const dbRow = mapDomainToDbProject(newProject);
    let { data: insertedData, error } = await sb
      .from('projects')
      .insert(dbRow)
      .select()
      .single();

    if (error && isMissingColumnError(error)) {
      const retry = await sb
        .from('projects')
        .insert(stripOptionalScheduleColumns(dbRow))
        .select()
        .single();
      insertedData = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('[projects.post] Supabase insert error:', error);
      return fail(res, 500, error.message);
    }

    if (explicitAssignments.length > 0) {
      await syncProjectMembersToOrgMembers(
        sb,
        orgId,
        newId,
        explicitAssignments.map((a) => a.userId),
      );
    }

    return created(res, mapDbToDomainProject(insertedData), 'Project created');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = String(req.params.id);
    const updates = req.body as Partial<Project>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    // Fetch current row for lifecycle transitions (pause/resume/complete)
    const { data: existingRow } = await sb
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!existingRow) return notFound(res, 'Project');

    const today = todayYmdCalendar();
    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.clientName !== undefined) dbUpdates.client_name = updates.clientName;
    if (updates.departmentId !== undefined) dbUpdates.department_id = updates.departmentId;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate;
    if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate || null;
    if (updates.quotedAmount !== undefined) dbUpdates.quoted_amount = updates.quotedAmount;
    if (updates.actualCost !== undefined) dbUpdates.actual_cost = updates.actualCost;
    if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
    if (updates.initialBaselineCost !== undefined) dbUpdates.initial_baseline_cost = updates.initialBaselineCost;
    if (updates.committedRemainingWork !== undefined) dbUpdates.committed_remaining_work = updates.committedRemainingWork;
    if (updates.plannedTeamSize !== undefined) dbUpdates.planned_team_size = Math.max(1, Number(updates.plannedTeamSize || 1));
    if (updates.budgetedHours !== undefined) dbUpdates.budgeted_hours = updates.budgetedHours != null && Number(updates.budgetedHours) > 0 ? Number(updates.budgetedHours) : null;
    if (updates.hoursPerDay !== undefined) dbUpdates.hours_per_day = Number(updates.hoursPerDay || 8);
    if (updates.monthlyCapacityHours !== undefined) dbUpdates.monthly_capacity_hours = Number(updates.monthlyCapacityHours || 160);
    if (updates.pausedBusinessDays !== undefined) dbUpdates.paused_business_days = Math.max(0, Number(updates.pausedBusinessDays || 0));

    // Lifecycle transitions: Completed / On Hold / Resume
    const prevStatus = String(existingRow.status || 'quoted');
    const nextStatus = updates.status || prevStatus;

    if (updates.completedAt !== undefined) {
      dbUpdates.completed_at = normalizeYmd(updates.completedAt) || null;
    } else if (nextStatus === 'completed' && prevStatus !== 'completed') {
      dbUpdates.completed_at = today;
    } else if (nextStatus === 'active' && prevStatus === 'completed') {
      dbUpdates.completed_at = null;
    }

    if (nextStatus === 'on_hold' && prevStatus !== 'on_hold') {
      dbUpdates.paused_at = normalizeYmd(updates.pausedAt) || today;
    } else if (prevStatus === 'on_hold' && nextStatus === 'active') {
      const pausedStart = normalizeYmd(existingRow.paused_at);
      const prevPaused = Math.max(0, Number(existingRow.paused_business_days || 0));
      const addedPaused = pausedStart && pausedStart < today
        ? Math.max(0, countBusinessDaysInclusive(pausedStart, today) - 1)
        : 0;
      dbUpdates.paused_business_days = prevPaused + addedPaused;
      dbUpdates.paused_at = null;
    } else if (updates.pausedAt !== undefined) {
      dbUpdates.paused_at = normalizeYmd(updates.pausedAt) || null;
    }

    // Member assignments & bidirectional organization_members.assigned_projects sync
    let syncedMemberIds: string[] | null = null;
    if (updates.memberAssignments !== undefined) {
      const normalized = (updates.memberAssignments || []).map((a) => ({
        userId: String(a.userId),
        assignedFrom: normalizeYmd(a.assignedFrom) || normalizeYmd(existingRow.start_date) || today,
        assignedTo: normalizeYmd(a.assignedTo) || undefined,
        allocationPct: a.allocationPct != null && Number(a.allocationPct) > 0 ? Math.min(100, Number(a.allocationPct)) : null,
      }));
      dbUpdates.member_assignments = normalized;
      syncedMemberIds = normalized.map((a) => a.userId);
    } else if (updates.assignedMemberIds !== undefined) {
      const prevMap = new Map<string, any>();
      const prevList = Array.isArray(existingRow.member_assignments) ? existingRow.member_assignments : [];
      for (const item of prevList) {
        if (item?.userId) prevMap.set(String(item.userId), item);
      }
      const nextList = (updates.assignedMemberIds || []).filter(Boolean).map((uid) => {
        const key = String(uid);
        const existing = prevMap.get(key);
        return existing || {
          userId: key,
          assignedFrom: prevStatus === 'quoted' ? (normalizeYmd(existingRow.start_date) || today) : today,
          allocationPct: null,
        };
      });
      dbUpdates.member_assignments = nextList;
      syncedMemberIds = nextList.map((a) => a.userId);
    }

    let { data, error } = await sb
      .from('projects')
      .update(dbUpdates)
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await sb
        .from('projects')
        .update(stripOptionalScheduleColumns(dbUpdates))
        .eq('id', projectId)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('[projects.patch] Supabase update error:', error);
      return fail(res, 500, error.message);
    }
    if (!data) return notFound(res, 'Project');

    if (syncedMemberIds !== null) {
      await syncProjectMembersToOrgMembers(sb, orgId, projectId, syncedMemberIds);
    }

    return ok(res, mapDbToDomainProject(data));
  });

  // POST /:id/complete — Lock exact completion date & freeze Mon–Fri hours permanently
  r.post('/:id/complete', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = String(req.params.id);
    const body = (req.body || {}) as { completedAt?: string };
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const completedAt = normalizeYmd(body.completedAt) || todayYmdCalendar();
    const dbUpdates: Record<string, unknown> = {
      status: 'completed',
      completed_at: completedAt,
      paused_at: null,
      updated_at: new Date().toISOString(),
    };

    let { data, error } = await sb
      .from('projects')
      .update(dbUpdates)
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await sb
        .from('projects')
        .update(stripOptionalScheduleColumns(dbUpdates))
        .eq('id', projectId)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Project');

    return ok(res, mapDbToDomainProject(data), `Project marked completed on ${completedAt}. Hours are now frozen.`);
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { error } = await sb
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) {
      console.error('[projects.delete] Supabase delete error:', error);
      return fail(res, 500, error.message);
    }
    return ok(res, null, 'Project deleted');
  });


  // ─────────────────────────────────────────────────────────────────────────────
  // Project Tasks Endpoints (§13 Work Domain & §12.4 Deliverables)
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/:id/tasks', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const [
          { data, error },
          { data: tsData },
        ] = await Promise.all([
          sb.from('project_tasks')
            .select('*')
            .eq('organization_id', orgId)
            .eq('project_id', projectId)
            .order('created_at', { ascending: true }),
          sb.from('timesheet_entries')
            .select('*')
            .eq('organization_id', orgId)
            .eq('project_id', projectId),
        ]);

        if (!error && data) {
          return ok(res, data.map((row: any) => reconcileTask(row, tsData || [])));
        }
      } catch (err) {
        console.warn('[projects.tasks.get] Supabase query error, fallback:', err);
      }
    }

    return ok(res, []);
  });

  // Batch create whole-week tasks (Mon–Fri) at once with auto-validated dates
  r.post('/:id/tasks/batch', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const { tasks } = req.body as { tasks: Array<Partial<ProjectTask>> };
    const sb = getSupabaseAdminClient();

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return fail(res, 400, 'Tasks array is required');
    }

    const nowIso = new Date().toISOString();
    const todayStr = todayYmdLocal();
    const dbRows = tasks
      .filter((t) => t && t.title?.trim())
      .map((t, idx) => ({
        id: t.id || `task-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        organization_id: orgId,
        project_id: projectId,
        title: t.title!.trim(),
        description: t.description?.trim() || '',
        assigned_to: t.assignedTo || null,
        assigned_to_name: t.assignedToName?.trim() || '',
        status: t.status || 'todo',
        priority: t.priority || 'medium',
        estimated_hours: Number(t.estimatedHours || 0),
        logged_hours: Number(t.loggedHours || 0),
        start_date: t.startDate || t.dueDate || todayStr,
        due_date: t.dueDate || t.startDate || todayStr,
        created_at: nowIso,
        updated_at: nowIso,
      }));

    if (dbRows.length === 0) {
      return fail(res, 400, 'At least one task with a title is required');
    }

    if (sb) {
      try {
        // §0.3 & §33.2: Backend-authoritative duplicate/idempotency check per day & assignee
        const { data: existingTasks, error: existingErr } = await sb
          .from('project_tasks')
          .select('id, title, assigned_to, start_date, due_date')
          .eq('organization_id', orgId)
          .eq('project_id', projectId);

        if (existingErr) {
          console.warn('[projects.tasks.batch] Existing task lookup warning:', existingErr.message);
        }

        const existingList = existingTasks || [];
        const seenBatchKeys = new Set<string>();
        const rowsToInsert: typeof dbRows = [];
        const skippedDays: string[] = [];

        for (const row of dbRows) {
          const rowDate = row.start_date || row.due_date;
          const rowTitleKey = row.title.trim().toLowerCase();
          const batchKey = `${rowDate}::${row.assigned_to || 'unassigned'}::${row.assigned_to ? '' : rowTitleKey}`;

          const alreadyExists = seenBatchKeys.has(batchKey) || existingList.some((ex: any) => {
            const sameDay = ex.start_date === rowDate || ex.due_date === rowDate;
            if (!sameDay) return false;
            if (row.assigned_to) {
              return String(ex.assigned_to || '') === String(row.assigned_to);
            }
            return String(ex.title || '').trim().toLowerCase() === rowTitleKey;
          });

          if (alreadyExists) {
            skippedDays.push(rowDate);
            continue;
          }
          seenBatchKeys.add(batchKey);
          rowsToInsert.push(row);
        }

        if (rowsToInsert.length === 0) {
          return ok(
            res,
            [],
            `No new tasks created — task(s) already exist for ${skippedDays.join(', ')}.`,
          );
        }

        const { data, error } = await sb
          .from('project_tasks')
          .insert(rowsToInsert)
          .select();

        if (error) {
          console.warn('[projects.tasks.batch] Supabase insert error:', error.message);
          return fail(res, 500, error.message);
        }

        const firstAssigned = (data || []).find((d: any) => d.assigned_to);
        if (firstAssigned) {
          try {
            const { emitEmployeeTaskAssignmentNotification } = await import('./employee.js');
            await emitEmployeeTaskAssignmentNotification(sb, orgId, {
              ...firstAssigned,
              title: `${rowsToInsert.length} Weekly Task(s) Assigned (starting ${firstAssigned.title})`,
            }, callerId(req));
          } catch (notifErr) {
            console.warn('[projects.tasks.batch] Notification warning:', notifErr);
          }
        }

        const msg = skippedDays.length > 0
          ? `Assigned ${rowsToInsert.length} task(s); skipped ${skippedDays.length} existing day(s) (${skippedDays.join(', ')}).`
          : `Assigned ${rowsToInsert.length} weekly tasks (Mon–Fri).`;

        return created(res, (data || []).map((row: any) => reconcileTask(row, [])), msg);
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return created(res, dbRows.map((row) => reconcileTask(row, [])));
  });

  r.post('/:id/tasks', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const body = req.body as Partial<ProjectTask>;
    const sb = getSupabaseAdminClient();

    if (!body.title?.trim()) {
      return fail(res, 400, 'Task title is required');
    }

    const taskId = body.id || `task-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const dbRow = {
      id: taskId,
      organization_id: orgId,
      project_id: projectId,
      title: body.title.trim(),
      description: body.description?.trim() || '',
      assigned_to: body.assignedTo || null,
      assigned_to_name: body.assignedToName?.trim() || '',
      status: body.status || 'todo',
      priority: body.priority || 'medium',
      estimated_hours: Number(body.estimatedHours || 0),
      logged_hours: Number(body.loggedHours || 0),
      start_date: body.startDate || null,
      due_date: body.dueDate || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    if (sb) {
      try {
        const { data, error } = await sb
          .from('project_tasks')
          .insert(dbRow)
          .select()
          .single();

        if (error) {
          console.warn('[projects.tasks.post] Supabase insert error:', error.message);
          return fail(res, 500, error.message);
        }
        if (data?.assigned_to) {
          try {
            const { emitEmployeeTaskAssignmentNotification } = await import('./employee.js');
            await emitEmployeeTaskAssignmentNotification(sb, orgId, data, callerId(req));
          } catch (notifErr) {
            console.warn('[projects.tasks.post] Task assignment notification warning:', notifErr);
          }
        }
        return created(res, mapDbToDomainTask(data));
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return created(res, mapDbToDomainTask(dbRow));
  });

  r.patch('/:id/tasks/:taskId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id: projectId, taskId } = req.params;
    const updates = req.body as Partial<ProjectTask>;
    const sb = getSupabaseAdminClient();

    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
    if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
    if (updates.assignedTo !== undefined) dbUpdates.assigned_to = updates.assignedTo || null;
    if (updates.assignedToName !== undefined) dbUpdates.assigned_to_name = updates.assignedToName.trim();
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
    if (updates.estimatedHours !== undefined) dbUpdates.estimated_hours = Number(updates.estimatedHours);
    if (updates.loggedHours !== undefined) dbUpdates.logged_hours = Number(updates.loggedHours);
    if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate;
    if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;

    if (sb) {
      try {
        const { data, error } = await sb
          .from('project_tasks')
          .update(dbUpdates)
          .eq('id', taskId)
          .eq('project_id', projectId)
          .eq('organization_id', orgId)
          .select()
          .maybeSingle();

        if (error) return fail(res, 500, error.message);
        if (!data) return notFound(res, 'Task');
        if (data?.assigned_to && updates.assignedTo) {
          try {
            const { emitEmployeeTaskAssignmentNotification } = await import('./employee.js');
            await emitEmployeeTaskAssignmentNotification(sb, orgId, data, callerId(req));
          } catch (notifErr) {
            console.warn('[projects.tasks.patch] Task assignment notification warning:', notifErr);
          }
        }
        return ok(res, mapDbToDomainTask(data));
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return ok(res, { id: taskId, projectId, organizationId: orgId, ...updates });
  });

  r.delete('/:id/tasks/:taskId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id: projectId, taskId } = req.params;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { error } = await sb
          .from('project_tasks')
          .delete()
          .eq('id', taskId)
          .eq('project_id', projectId)
          .eq('organization_id', orgId);

        if (error) return fail(res, 500, error.message);
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return ok(res, null, 'Task deleted');
  });

  return r;
}
