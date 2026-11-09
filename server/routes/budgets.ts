/**
 * §12 — Budgets. Mounted at `/organizations/:organizationId/budgets` (mergeParams).
 *
 * Exclusively backed by Supabase PostgreSQL database.
 *
 * Security:
 *  - All routes sit behind requireAuth + requireOrgMembership middleware (apiV1.ts)
 *  - Supabase service-role client enforces org-scoped access
 *  - Input validation (amounts, dates, enums) prevents invalid data
 *  - spent_amount is computed dynamically and via database triggers from transactions
 */

import { Router, type Request, type Response } from 'express';
import type { Budget } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';

// ── Validation ──────────────────────────────────────────────────────────────

const VALID_PERIODS = new Set(['monthly', 'quarterly', 'yearly']);
const VALID_STATUSES = new Set(['active', 'exceeded', 'completed', 'warning', 'on-track']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LEN = 200;
const MAX_AMOUNT = 999_999_999_999; // ~1 trillion cap

function validateBudgetInput(
  body: Record<string, unknown>,
  requireAll: boolean,
): string | null {
  if (requireAll) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return 'name is required';
    }
    if (!body.period || !VALID_PERIODS.has(body.period as string)) {
      return 'period must be monthly, quarterly, or yearly';
    }
    if (!body.startDate || !ISO_DATE.test(body.startDate as string)) {
      return 'startDate is required (YYYY-MM-DD)';
    }
    if (!body.endDate || !ISO_DATE.test(body.endDate as string)) {
      return 'endDate is required (YYYY-MM-DD)';
    }
    if ((body.startDate as string) > (body.endDate as string)) {
      return 'startDate must be before or equal to endDate';
    }
    if (body.budgetedAmount == null || typeof body.budgetedAmount !== 'number' || body.budgetedAmount < 0) {
      return 'budgetedAmount must be a non-negative number';
    }
  }

  // Bounds checks (apply to both create and update)
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || (body.name as string).length > MAX_NAME_LEN) {
      return `name must be a string under ${MAX_NAME_LEN} characters`;
    }
  }
  if (body.budgetedAmount !== undefined) {
    const amt = Number(body.budgetedAmount);
    if (isNaN(amt) || amt < 0 || amt > MAX_AMOUNT) {
      return `budgetedAmount must be between 0 and ${MAX_AMOUNT}`;
    }
  }
  if (body.period !== undefined && !VALID_PERIODS.has(body.period as string)) {
    return 'period must be monthly, quarterly, or yearly';
  }
  if (body.status !== undefined && !VALID_STATUSES.has(body.status as string)) {
    return 'status must be active, exceeded, or completed';
  }
  if (body.alertThreshold !== undefined) {
    const t = Number(body.alertThreshold);
    if (isNaN(t) || t < 1 || t > 100) {
      return 'alertThreshold must be between 1 and 100';
    }
  }
  if (body.startDate !== undefined && !ISO_DATE.test(body.startDate as string)) {
    return 'startDate must be YYYY-MM-DD';
  }
  if (body.endDate !== undefined && !ISO_DATE.test(body.endDate as string)) {
    return 'endDate must be YYYY-MM-DD';
  }
  return null;
}

// ── DB ↔ Domain mapping ────────────────────────────────────────────────────

function computeBudgetStatus(
  budgeted: number,
  spent: number,
  alertThreshold: number = 80,
): 'on-track' | 'warning' | 'exceeded' {
  if (budgeted <= 0) return 'on-track';
  const utilization = (spent / budgeted) * 100;
  if (spent >= budgeted || utilization >= 100) return 'exceeded';
  if (utilization >= alertThreshold) return 'warning';
  return 'on-track';
}

function mapDbToDomain(row: Record<string, any>): Budget {
  const budgeted = Number(row.budgeted_amount ?? 0);
  const spent = Number(row.spent_amount ?? 0);
  const threshold = row.alert_threshold != null ? Number(row.alert_threshold) : 80;
  const status = computeBudgetStatus(budgeted, spent, threshold);

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    period: row.period as Budget['period'],
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    categoryId: row.category_id ? String(row.category_id) : undefined,
    departmentId: row.department_id ? String(row.department_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    clientId: row.client_id ? String(row.client_id) : undefined,
    budgetedAmount: budgeted,
    spentAmount: spent,
    currency: String(row.currency ?? 'USD'),
    status,
    lifecycleStatus: (row.lifecycle_status as Budget['lifecycleStatus']) || 'draft',
    version: row.version != null ? Number(row.version) : 1,
    isCurrent: row.is_current !== false,
    parentBudgetId: row.parent_budget_id ? String(row.parent_budget_id) : undefined,
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    alertThreshold: threshold,
    scope: (row.scope as Budget['scope']) || 'business',
    rolledFromId: row.rolled_from_id ? String(row.rolled_from_id) : undefined,
  };
}

function mapDomainToDb(
  item: Partial<Budget> & { alertThreshold?: number },
  orgId?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (item.id !== undefined) result.id = item.id;
  if (orgId !== undefined) result.organization_id = orgId;
  if (item.name !== undefined) result.name = item.name.trim();
  if (item.period !== undefined) result.period = item.period;
  if (item.startDate !== undefined) result.start_date = item.startDate;
  if (item.endDate !== undefined) result.end_date = item.endDate;
  if (item.categoryId !== undefined) result.category_id = item.categoryId && item.categoryId.trim() ? item.categoryId : null;
  if (item.departmentId !== undefined) result.department_id = item.departmentId && item.departmentId.trim() ? item.departmentId : null;
  if (item.projectId !== undefined) result.project_id = item.projectId && item.projectId.trim() ? item.projectId : null;
  if (item.clientId !== undefined) result.client_id = item.clientId && item.clientId.trim() ? item.clientId : null;
  if (item.budgetedAmount !== undefined) result.budgeted_amount = item.budgetedAmount;
  if (item.spentAmount !== undefined) result.spent_amount = item.spentAmount;
  if (item.currency !== undefined) result.currency = item.currency;
  if (item.status !== undefined) {
    const s = String(item.status);
    result.status = s === 'warning' || s === 'on-track' ? 'active' : item.status;
  }
  if (item.lifecycleStatus !== undefined) result.lifecycle_status = item.lifecycleStatus;
  if (item.version !== undefined) result.version = item.version;
  if (item.isCurrent !== undefined) result.is_current = item.isCurrent;
  if (item.parentBudgetId !== undefined) result.parent_budget_id = item.parentBudgetId || null;
  if (item.approvedBy !== undefined) result.approved_by = item.approvedBy || null;
  if (item.approvedAt !== undefined) result.approved_at = item.approvedAt || null;
  if (item.alertThreshold !== undefined) result.alert_threshold = item.alertThreshold;
  if (item.scope !== undefined) result.scope = item.scope;
  if (item.rolledFromId !== undefined) result.rolled_from_id = item.rolledFromId || null;
  return result;
}

// ── Helper to ensure fresh spent calculation ───────────────────────────────


export async function ensureFreshSpend(sb: ReturnType<typeof getSupabaseAdminClient>, orgId: string): Promise<void> {
  if (!sb) return;
  let rpcSucceeded = false;
  try {
    const { error: rpcErr } = await sb.rpc('budget_recompute_all_for_org', { p_org_id: orgId });
    if (!rpcErr) {
      rpcSucceeded = true;
    }
  } catch {
    // continue to fallback
  }

  // Direct calculation fallback or refinement
  try {
    const [{ data: budgets }, { data: txns }, { data: projects }] = await Promise.all([
      sb.from('budgets').select('*').eq('organization_id', orgId),
      sb.from('transactions').select('*').eq('organization_id', orgId).eq('type', 'debit'),
      sb.from('projects').select('id, department_id').eq('organization_id', orgId),
    ]);

    const projectDeptMap = new Map((projects || []).map((p: any) => [p.id, p.department_id]));

    if (budgets && txns) {
      for (const b of budgets) {
        const bCurrency = b.currency || 'USD';
        const spent = txns.filter(t => {
          if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())) return false;
          const tags: string[] = Array.isArray(t.tags) ? t.tags : [];
          if (t.is_transfer || t.transfer_group_id || tags.includes('transfer')) return false;
          if (tags.includes('loan-principal') || /loan repayment/i.test(String(t.narration || t.description || ''))) return false;

          const tDate = String(t.date || '').slice(0, 10);
          if (b.start_date && tDate < b.start_date) return false;
          if (b.end_date && tDate > b.end_date) return false;
          if (b.category_id && t.category_id !== b.category_id) return false;
          if (b.department_id) {
            const effectiveDept = t.department_id || (t.project_id ? projectDeptMap.get(t.project_id) : undefined);
            if (effectiveDept !== b.department_id) return false;
          }
          if (b.project_id && t.project_id !== b.project_id) return false;
          const tScope = (t as any).scope || (tags.includes('personal') ? 'personal' : tags.includes('business') ? 'business' : undefined);
          if (b.scope && tScope && tScope !== b.scope) return false;
          return true;
        }).reduce((sum, t) => {
          const rawAmt = Math.abs(Number(t.amount || 0));
          return sum + convertCurrency(rawAmt, t.currency || bCurrency, bCurrency);
        }, 0);

        const rounded = Math.round(spent * 100) / 100;
        const threshold = b.alert_threshold != null ? Number(b.alert_threshold) : 80;
        const budgeted = Number(b.budgeted_amount || 0);
        const utilization = budgeted > 0 ? (rounded / budgeted) * 100 : 0;
        const newDbStatus = budgeted > 0 && (rounded >= budgeted || utilization >= 100) ? 'exceeded' : 'active';

        if (Number(b.spent_amount) !== rounded || b.status !== newDbStatus) {
          b.spent_amount = rounded;
          b.status = newDbStatus;
          try {
            await sb.from('budgets').update({
              spent_amount: rounded,
              status: newDbStatus,
              updated_at: new Date().toISOString(),
            }).eq('id', b.id).eq('organization_id', orgId);
          } catch {
            // ignore column or constraint issues
          }
        }
      }
    }
  } catch (err) {
    console.warn('[budgets.ensureFreshSpend] direct calculation error:', err);
  }

}

// ── Router ──────────────────────────────────────────────────────────────────

export function createBudgetsRouter(): Router {
  const r = Router({ mergeParams: true });

  function getOrgId(req: Request): string {
    const p = req.params.organizationId;
    return Array.isArray(p) ? p[0] : (p ?? '');
  }

  // ── GET /variance — budget vs actual analysis ───────────────────────────
  r.get('/variance', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      await ensureFreshSpend(sb, orgId);

      const [{ data: budgets, error }, { data: categories }] = await Promise.all([
        sb.from('budgets').select('*').eq('organization_id', orgId),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
      ]);

      if (error) return fail(res, 500, error.message);

      const catMap = new Map((categories || []).map((c: any) => [c.id, c.name]));

      const analysis = (budgets || []).map((row: Record<string, any>) => {
        const budget = mapDbToDomain(row);
        const variance = budget.budgetedAmount - budget.spentAmount; // Positive = remaining, Negative = over
        const variancePercent = budget.budgetedAmount > 0
          ? (variance / budget.budgetedAmount) * 100
          : 0;
        const utilizationPercent = budget.budgetedAmount > 0
          ? (budget.spentAmount / budget.budgetedAmount) * 100
          : 0;
        const threshold = budget.alertThreshold ?? 80;
        const isOverBudget = budget.spentAmount > budget.budgetedAmount;
        const status = isOverBudget
          ? 'exceeded'
          : utilizationPercent >= threshold
            ? 'warning'
            : 'on-track';

        return {
          budgetId: budget.id,
          name: budget.name,
          category: (budget.categoryId && catMap.get(budget.categoryId)) || 'General',
          categoryId: budget.categoryId,
          budgeted: budget.budgetedAmount,
          actual: budget.spentAmount,
          variance,
          variancePercent: Math.round(variancePercent * 10) / 10,
          utilizationPercent: Math.round(utilizationPercent * 10) / 10,
          threshold,
          status,
          isOverBudget,
        };
      });
      return ok(res, analysis);
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  // ── GET /alerts — budgets reaching or exceeding alert threshold ──────────
  r.get('/alerts', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      await ensureFreshSpend(sb, orgId);

      const [{ data: budgets, error }, { data: categories }, { data: existingAlerts }] = await Promise.all([
        sb.from('budgets').select('*').eq('organization_id', orgId).eq('is_current', true),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('budget_alerts').select('*').eq('organization_id', orgId),
      ]);

      if (error) return fail(res, 500, error.message);

      const catMap = new Map((categories || []).map((c: any) => [c.id, c.name]));
      const existingAlertMap = new Map((existingAlerts || []).map((a: any) => [a.dedup_key, a]));

      const candidateAlerts = (budgets || [])
        .map((row: Record<string, any>) => mapDbToDomain(row))
        .filter(b => {
          const threshold = b.alertThreshold ?? 80;
          const utilization = b.budgetedAmount > 0 ? (b.spentAmount / b.budgetedAmount) * 100 : 0;
          return utilization >= threshold;
        });

      const alertsToReturn = [];

      for (const b of candidateAlerts) {
        const threshold = b.alertThreshold ?? 80;
        const utilization = b.budgetedAmount > 0 ? (b.spentAmount / b.budgetedAmount) * 100 : 0;
        const isOver = b.spentAmount > b.budgetedAmount;
        const severity = isOver ? 'exceeded' : 'warning';
        const dedupKey = `${orgId}:${b.id}:${b.period || 'monthly'}:${severity}`;
        const existingAlert = existingAlertMap.get(dedupKey);

        let deliveryStatus = existingAlert ? existingAlert.delivery_status : 'delivered';
        let alertId = existingAlert ? existingAlert.id : `balert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        let deliveredAt = existingAlert ? existingAlert.delivered_at : new Date().toISOString();

        if (!existingAlert) {
          try {
            await sb.from('budget_alerts').insert({
              id: alertId,
              organization_id: orgId,
              budget_id: b.id,
              period: b.period || 'monthly',
              threshold_percent: threshold,
              utilization_percent: Math.round(utilization * 10) / 10,
              severity,
              dedup_key: dedupKey,
              delivery_status: 'delivered',
              delivered_at: deliveredAt,
            });
          } catch {
            // Ignore if already written concurrently
          }
        }

        alertsToReturn.push({
          id: alertId,
          budgetId: b.id,
          name: b.name,
          category: (b.categoryId && catMap.get(b.categoryId)) || 'General',
          budgeted: b.budgetedAmount,
          actual: b.spentAmount,
          utilizationPercent: Math.round(utilization * 10) / 10,
          threshold,
          severity,
          dedupKey,
          deliveryStatus,
          deliveredAt,
          message: isOver
            ? `Budget exceeded by ${(b.spentAmount - b.budgetedAmount).toFixed(2)} ${b.currency}`
            : `At ${Math.round(utilization)}% of limit (${threshold}% threshold)`,
        });
      }

      return ok(res, alertsToReturn);
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  // ── POST /alerts/:alertId/acknowledge — acknowledge alert delivery ────────
  r.post('/alerts/:alertId/acknowledge', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('budget_alerts')
      .update({ delivery_status: 'acknowledged' })
      .eq('id', req.params.alertId)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    return ok(res, data, 'Alert acknowledged');
  });

  // ── GET /summary — aggregate budget stats for the org ───────────────────
  r.get('/summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      await ensureFreshSpend(sb, orgId);

      const [{ data: rows, error }, { data: categories }] = await Promise.all([
        sb.from('budgets').select('budgeted_amount, spent_amount, status, category_id, alert_threshold').eq('organization_id', orgId),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
      ]);

      if (error) return fail(res, 500, error.message);

      const catMap = new Map((categories || []).map((c: any) => [c.id, c.name]));
      const dataRows = rows || [];
      const totalBudgeted = dataRows.reduce((s: number, r: any) => s + Number(r.budgeted_amount || 0), 0);
      const totalSpent = dataRows.reduce((s: number, r: any) => s + Number(r.spent_amount || 0), 0);

      let onTrackCount = 0;
      let warningCount = 0;
      let exceededCount = 0;

      const categoryBreakdown: Record<string, { budgeted: number; spent: number; count: number; name: string }> = {};

      for (const row of dataRows) {
        const budgeted = Number(row.budgeted_amount || 0);
        const spent = Number(row.spent_amount || 0);
        const threshold = Number(row.alert_threshold ?? 80);
        const utilization = budgeted > 0 ? (spent / budgeted) * 100 : 0;

        if (budgeted > 0 && spent >= budgeted) {
          exceededCount++;
        } else if (utilization >= threshold) {
          warningCount++;
        } else {
          onTrackCount++;
        }

        const catId = row.category_id || 'uncategorized';
        const catName = (row.category_id && catMap.get(row.category_id)) || 'General';
        const existing = categoryBreakdown[catId] || { budgeted: 0, spent: 0, count: 0, name: catName };
        existing.budgeted += budgeted;
        existing.spent += spent;
        existing.count += 1;
        categoryBreakdown[catId] = existing;
      }

      return ok(res, {
        totalBudgeted,
        totalSpent,
        remaining: totalBudgeted - totalSpent,
        utilizationPct: totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 1000) / 10 : 0,
        activeCount: onTrackCount,
        warningCount,
        exceededCount,
        totalCount: dataRows.length,
        byCategory: categoryBreakdown,
      });
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  // ── GET / — list all budgets for organization ───────────────────────────
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    const { clientId, lifecycleStatus, allVersions } = req.query as {
      clientId?: string;
      lifecycleStatus?: string;
      allVersions?: string;
    };

    if (sb) {
      await ensureFreshSpend(sb, orgId);

      let query = sb
        .from('budgets')
        .select('*')
        .eq('organization_id', orgId);

      if (allVersions !== 'true') {
        query = query.eq('is_current', true);
      }
      if (clientId) {
        query = query.eq('client_id', clientId);
      }
      if (lifecycleStatus) {
        query = query.eq('lifecycle_status', lifecycleStatus);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) return fail(res, 500, error.message);
      return ok(res, (data || []).map(mapDbToDomain));
    }

    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');
    return fail(res, 500, 'Failed to fetch budgets');
  });

  // ── GET /:id — single budget ────────────────────────────────────────────
  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      await ensureFreshSpend(sb, orgId);

      const { data, error } = await sb
        .from('budgets')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (error) return fail(res, 500, error.message);
      if (!data) return notFound(res, 'Budget');
      return ok(res, mapDbToDomain(data));
    }

    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');
    return notFound(res, 'Budget');
  });

  // ── GET /:id/history — version history of this budget ──────────────────
  r.get('/:id/history', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: target, error: targetErr } = await sb
      .from('budgets')
      .select('id, parent_budget_id')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (targetErr) return fail(res, 500, targetErr.message);
    if (!target) return notFound(res, 'Budget');

    const rootParentId = target.parent_budget_id || target.id;
    const { data: versions, error: histErr } = await sb
      .from('budgets')
      .select('*')
      .eq('organization_id', orgId)
      .or(`id.eq.${rootParentId},parent_budget_id.eq.${rootParentId}`)
      .order('version', { ascending: false });

    if (histErr) return fail(res, 500, histErr.message);
    return ok(res, (versions || []).map(mapDbToDomain));
  });

  // ── POST /:id/approve — approve budget ──────────────────────────────────
  r.post('/:id/approve', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const user = (req as any).user;
    const approverName = user?.name || user?.email || 'admin';

    const { data, error } = await sb
      .from('budgets')
      .update({
        lifecycle_status: 'approved',
        approved_by: approverName,
        approved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Budget');
    return ok(res, mapDbToDomain(data), 'Budget approved');
  });

  // ── POST /:id/lock — lock budget ────────────────────────────────────────
  r.post('/:id/lock', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('budgets')
      .update({ lifecycle_status: 'locked' })
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Budget');
    return ok(res, mapDbToDomain(data), 'Budget locked');
  });

  // ── POST / — create budget ──────────────────────────────────────────────
  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as Record<string, unknown>;

    const validationErr = validateBudgetInput(body, true);
    if (validationErr) return fail(res, 400, validationErr);

    const sb = getSupabaseAdminClient();

    // Enforce department budget limits
    const targetDeptId = (body.departmentId as string) || (body.department_id as string);
    if (targetDeptId && targetDeptId !== 'none' && targetDeptId.trim()) {
      let deptBudget: number | null = null;
      let deptName = 'Department';
      if (sb) {
        const { data: dRow } = await sb
          .from('departments')
          .select('id, name, budget')
          .eq('id', targetDeptId)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (dRow && dRow.budget != null) {
          deptBudget = Number(dRow.budget);
          deptName = dRow.name || 'Department';
        }
      }

      if (deptBudget != null && deptBudget > 0) {
        const plannedAmt = Number(body.budgetedAmount);
        if (plannedAmt > deptBudget) {
          return fail(res, 400, `Budget amount (${plannedAmt}) exceeds ${deptName} budget limit (${deptBudget})`);
        }
        if (!sb) return fail(res, 503, 'Supabase client is unconfigured');
        const { data: existingBudgets } = await sb
          .from('budgets')
          .select('budgeted_amount')
          .eq('organization_id', orgId)
          .eq('department_id', targetDeptId);
        const otherTotal = (existingBudgets || []).reduce((sum, b) => sum + Number(b.budgeted_amount || 0), 0);
        if (otherTotal + plannedAmt > deptBudget) {
          const available = Math.max(0, deptBudget - otherTotal);
          return fail(
            res,
            400,
            `Total planned budgets (${otherTotal + plannedAmt}) exceed ${deptName} budget limit (${deptBudget}). Available to allocate: ${available}`,
          );
        }
      }
    }

    if (sb) {
      const budgetId = `budget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const dbPayload = mapDomainToDb(
        {
          id: budgetId,
          name: (body.name as string).trim(),
          period: body.period as Budget['period'],
          startDate: body.startDate as string,
          endDate: body.endDate as string,
          categoryId: (body.categoryId as string) || undefined,
          departmentId: (body.departmentId as string) || undefined,
          projectId: (body.projectId as string) || undefined,
          budgetedAmount: Number(body.budgetedAmount),
          spentAmount: 0,
          currency: (body.currency as string) || 'USD',
          status: 'active',
          alertThreshold: Number(body.alertThreshold ?? 80),
        },
        orgId,
      );

      const { data, error } = await sb
        .from('budgets')
        .insert(dbPayload)
        .select()
        .single();

      if (error) {
        console.error('[budgets] create error:', error);
        return fail(res, 500, error.message);
      }

      // Recompute spent from existing transactions
      await ensureFreshSpend(sb, orgId);

      // Re-fetch created row to return accurate spent amount and status
      const { data: refreshed } = await sb
        .from('budgets')
        .select('*')
        .eq('id', budgetId)
        .single();

      return created(res, mapDbToDomain(refreshed || data), 'Budget created');
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  // ── POST /from-template — bulk-create budgets from template ─────────────
  r.post('/from-template', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { templateName, totalAmount, categories, period, startDate, endDate, currency } = req.body as {
      templateName: string;
      totalAmount: number;
      categories: { category: string; percentage: number }[];
      period?: string;
      startDate?: string;
      endDate?: string;
      currency?: string;
    };

    if (!templateName || !totalAmount || !Array.isArray(categories) || categories.length === 0) {
      return fail(res, 400, 'templateName, totalAmount, and categories[] are required');
    }
    if (totalAmount <= 0 || totalAmount > MAX_AMOUNT) {
      return fail(res, 400, `totalAmount must be between 0 and ${MAX_AMOUNT}`);
    }

    // Validate percentages sum
    const pctSum = categories.reduce((s, c) => s + (c.percentage || 0), 0);
    if (Math.abs(pctSum - 100) > 0.5) {
      return fail(res, 400, `Category percentages must sum to 100 (got ${pctSum})`);
    }

    const sb = getSupabaseAdminClient();
    const today = new Date();
    const defaultStart = startDate || today.toISOString().split('T')[0];
    const budgetPeriod = (period as Budget['period']) || 'monthly';
    const defaultEnd = endDate || (() => {
      const d = new Date(defaultStart);
      if (budgetPeriod === 'monthly') d.setMonth(d.getMonth() + 1);
      else if (budgetPeriod === 'quarterly') d.setMonth(d.getMonth() + 3);
      else d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().split('T')[0];
    })();

    // Resolve org currency, category IDs, and default expense account
    let resolvedCurrency = currency || 'USD';
    const categoryLookup = new Map<string, string>(); // lowercase name -> id
    let defaultExpenseAccountId: string | null = null;

    if (sb) {
      const [{ data: orgRow }, { data: catRows }, { data: accRows }] = await Promise.all([
        sb.from('organizations').select('currency').eq('id', orgId).single(),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('accounts').select('id').eq('organization_id', orgId).eq('type', 'expense').limit(1),
      ]);
      if (orgRow?.currency && !currency) {
        resolvedCurrency = orgRow.currency;
      }
      if (Array.isArray(catRows)) {
        for (const c of catRows) {
          if (c.name && c.id) {
            categoryLookup.set(String(c.name).toLowerCase().trim(), String(c.id));
          }
        }
      }
      if (accRows && accRows.length > 0) {
        defaultExpenseAccountId = accRows[0].id;
      }
    }

    // Intelligent category matcher with aliases
    function findMatchingCategoryId(templateCatName: string): string | null {
      const target = templateCatName.toLowerCase().trim();
      if (categoryLookup.has(target)) return categoryLookup.get(target)!;

      for (const [name, id] of categoryLookup.entries()) {
        if (name.includes(target) || target.includes(name)) return id;
      }

      const aliases: Record<string, string[]> = {
        payroll: ['salaries', 'wages', 'people', 'team'],
        people: ['payroll', 'salaries', 'wages'],
        facilities: ['maintenance', 'office maintenance', 'rent', 'utilities'],
        infrastructure: ['office maintenance', 'maintenance', 'hosting', 'tools'],
        software: ['tools', 'software & tools', 'subscriptions'],
        tools: ['software', 'software & tools', 'subscriptions'],
        operations: ['office supplies', 'operating', 'supplies', 'maintenance'],
        admin: ['office supplies', 'administration', 'general'],
        delivery: ['direct costs', 'contractor', 'cogs'],
        sales: ['revenue', 'sales', 'marketing'],
        growth: ['marketing', 'sales', 'advertising'],
        buffer: ['general', 'miscellaneous', 'operating'],
      };

      const syns = aliases[target] || [];
      for (const syn of syns) {
        for (const [name, id] of categoryLookup.entries()) {
          if (name.includes(syn) || syn.includes(name)) return id;
        }
      }

      return null;
    }

    const createdBudgets: Budget[] = [];

    for (const cat of categories) {
      const budgetId = `budget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const amount = Math.round((totalAmount * cat.percentage) / 100 * 100) / 100;
      let matchedCatId = findMatchingCategoryId(cat.category);

      // Auto-create category if missing so foreign key is always satisfied
      if (!matchedCatId && defaultExpenseAccountId && sb) {
        try {
          const newCatId = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const { data: newCat } = await sb.from('categories').insert({
            id: newCatId,
            organization_id: orgId,
            name: cat.category,
            type: 'expense',
            account_id: defaultExpenseAccountId,
            color: '#06b6d4',
            icon: 'folder',
          }).select().single();

          if (newCat && newCat.id) {
            const newId = String(newCat.id);
            matchedCatId = newId;
            categoryLookup.set(cat.category.toLowerCase().trim(), newId);
          }
        } catch {
          // If creation fails, proceed with null
        }
      }

      if (sb) {
        const dbPayload = {
          id: budgetId,
          organization_id: orgId,
          name: `${cat.category} - ${templateName}`,
          period: budgetPeriod,
          start_date: defaultStart,
          end_date: defaultEnd,
          category_id: matchedCatId,
          budgeted_amount: amount,
          spent_amount: 0,
          currency: resolvedCurrency,
          status: 'active',
          alert_threshold: 80,
        };

        const { data, error } = await sb
          .from('budgets')
          .insert(dbPayload)
          .select()
          .single();

        if (error) {
          console.error('[budgets] template create error:', error);
          return fail(res, 500, `Failed creating budget for ${cat.category}: ${error.message}`);
        }

        createdBudgets.push(mapDbToDomain(data));
      }
    }



    // Recompute spent amounts
    if (sb) {
      await ensureFreshSpend(sb, orgId);
      // Fetch fresh created items
      const { data: freshList } = await sb
        .from('budgets')
        .select('*')
        .in('id', createdBudgets.map(b => b.id));

      if (freshList && freshList.length > 0) {
        return ok(res, freshList.map(mapDbToDomain), `${createdBudgets.length} budgets created from ${templateName} template`);
      }
    }

    ok(res, createdBudgets, `${createdBudgets.length} budgets created from ${templateName} template`);
  });

  // ── POST /:id/roll-forward — roll budget forward to next period ──────────
  r.post('/:id/roll-forward', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    let existing: Budget | null = null;
    if (sb) {
      const { data, error } = await sb
        .from('budgets')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) return fail(res, 500, error.message);
      if (!data) return notFound(res, 'Budget');
      existing = mapDbToDomain(data);
    } else {
      existing = null;
      if (!existing) return notFound(res, 'Budget');
    }

    // Next period calculation
    const oldEndDate = new Date(existing.endDate);
    const today = new Date();
    let nextStart = new Date(oldEndDate);
    nextStart.setDate(nextStart.getDate() + 1);
    if (isNaN(nextStart.getTime()) || nextStart < today) {
      nextStart = today;
    }
    const nextStartStr = nextStart.toISOString().split('T')[0];

    const nextEnd = new Date(nextStart);
    if (existing.period === 'monthly') {
      nextEnd.setMonth(nextEnd.getMonth() + 1);
    } else if (existing.period === 'quarterly') {
      nextEnd.setMonth(nextEnd.getMonth() + 3);
    } else {
      nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    }
    const nextEndStr = nextEnd.toISOString().split('T')[0];

    const newBudgetId = `budget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (sb) {
      const dbPayload = {
        id: newBudgetId,
        organization_id: orgId,
        name: existing.name,
        period: existing.period,
        start_date: nextStartStr,
        end_date: nextEndStr,
        category_id: existing.categoryId || null,
        department_id: existing.departmentId || null,
        project_id: existing.projectId || null,
        budgeted_amount: existing.budgetedAmount,
        spent_amount: 0,
        currency: existing.currency,
        status: 'active',
        alert_threshold: existing.alertThreshold ?? 80,
      };

      const { data: createdRow, error: insertErr } = await sb
        .from('budgets')
        .insert(dbPayload)
        .select()
        .single();

      if (insertErr) return fail(res, 500, insertErr.message);

      await ensureFreshSpend(sb, orgId);

      const { data: refreshed } = await sb
        .from('budgets')
        .select('*')
        .eq('id', newBudgetId)
        .single();

      return created(res, mapDbToDomain(refreshed || createdRow), 'Budget rolled forward successfully');
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  // ── PATCH /:id — update budget ──────────────────────────────────────────
  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as Record<string, unknown>;

    const validationErr = validateBudgetInput(body, false);
    if (validationErr) return fail(res, 400, validationErr);

    const sb = getSupabaseAdminClient();

    if (sb) {
      const { data: existing, error: fetchErr } = await sb
        .from('budgets')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (fetchErr) return fail(res, 500, fetchErr.message);
      if (!existing) return notFound(res, 'Budget');

      const targetDeptId = body.departmentId !== undefined ? (body.departmentId as string) : existing.department_id;
      const targetAmount = body.budgetedAmount !== undefined ? Number(body.budgetedAmount) : Number(existing.budgeted_amount);

      if (targetDeptId && targetDeptId !== 'none' && targetDeptId.trim() && targetAmount > 0) {
        const { data: dRow } = await sb
          .from('departments')
          .select('id, name, budget')
          .eq('id', targetDeptId)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (dRow && dRow.budget != null && Number(dRow.budget) > 0) {
          const deptBudget = Number(dRow.budget);
          if (targetAmount > deptBudget) {
            return fail(res, 400, `Budget amount (${targetAmount}) exceeds ${dRow.name} budget limit (${deptBudget})`);
          }
          const { data: existingBudgets } = await sb
            .from('budgets')
            .select('id, budgeted_amount')
            .eq('organization_id', orgId)
            .eq('department_id', targetDeptId);
          const otherTotal = (existingBudgets || [])
            .filter((b: any) => b.id !== req.params.id)
            .reduce((sum: number, b: any) => sum + Number(b.budgeted_amount || 0), 0);

          if (otherTotal + targetAmount > deptBudget) {
            const available = Math.max(0, deptBudget - otherTotal);
            return fail(
              res,
              400,
              `Total planned budgets (${otherTotal + targetAmount}) exceed ${dRow.name} budget limit (${deptBudget}). Available to allocate: ${available}`,
            );
          }
        }
      }

      const dbUpdates = mapDomainToDb(body as Partial<Budget>);
      delete dbUpdates.spent_amount;
      delete dbUpdates.organization_id;
      delete dbUpdates.id;

      if (Object.keys(dbUpdates).length === 0) {
        return fail(res, 400, 'No valid fields to update');
      }

      // Non-destructive versioning for locked or approved budgets, or when createNewVersion is requested
      const isLockedOrApproved = existing.lifecycle_status === 'locked' || existing.lifecycle_status === 'approved';
      const shouldCreateNewVersion = Boolean(body.createNewVersion) || isLockedOrApproved;

      if (shouldCreateNewVersion) {
        // Mark existing version as no longer current
        await sb.from('budgets').update({ is_current: false }).eq('id', existing.id);

        const newVersionId = `budget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const rootParentId = existing.parent_budget_id || existing.id;
        const newVersionNum = Number(existing.version || 1) + 1;

        const mergedBudget: any = {
          ...existing,
          ...dbUpdates,
          id: newVersionId,
          organization_id: orgId,
          parent_budget_id: rootParentId,
          version: newVersionNum,
          is_current: true,
          lifecycle_status: 'draft',
          approved_by: null,
          approved_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: createdRow, error: createErr } = await sb
          .from('budgets')
          .insert(mergedBudget)
          .select()
          .single();

        if (createErr) {
          return fail(res, 500, createErr.message);
        }

        await ensureFreshSpend(sb, orgId);
        const { data: refreshed } = await sb.from('budgets').select('*').eq('id', newVersionId).single();
        return created(res, mapDbToDomain(refreshed || createdRow), `Created new budget version (v${newVersionNum})`);
      }

      const { data, error } = await sb
        .from('budgets')
        .update(dbUpdates)
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) {
        console.error('[budgets] update error:', error);
        return fail(res, 500, error.message);
      }

      // Recompute spent after changes
      await ensureFreshSpend(sb, orgId);

      const { data: refreshed } = await sb
        .from('budgets')
        .select('*')
        .eq('id', req.params.id)
        .single();

      return ok(res, mapDbToDomain(refreshed || data));
    }

    // Fallback
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');
    return notFound(res, 'Budget');
  });

  // ── DELETE /:id — delete budget ─────────────────────────────────────────
  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      const { data: existing, error: fetchErr } = await sb
        .from('budgets')
        .select('id')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (fetchErr) return fail(res, 500, fetchErr.message);
      if (!existing) return notFound(res, 'Budget');

      const { error } = await sb
        .from('budgets')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', orgId);

      if (error) {
        console.error('[budgets] delete error:', error);
        return fail(res, 500, error.message);
      }

      return ok(res, null, 'Budget deleted');
    }

    // Fallback

    ok(res, null, 'Budget deleted');
  });

  return r;
}
