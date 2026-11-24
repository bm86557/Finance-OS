/**
 * §4, §7, §9, §11, §16, §19, §33 — Recurring Transactions Router.
 * Mounted at `/organizations/:organizationId/recurring-transactions`.
 *
 * Handoff v1.2 Compliance:
 *  - Templates do NOT affect bank balances until occurrences are approved & posted.
 *  - Unique occurrence per `(template_id, scheduled_period_key)` in `recurring_occurrences`.
 *  - Approval gate (`requires_approval` / `approval_threshold`) routes due runs to `pending_approval`.
 *  - Locked accounting period checks (`accounting_periods`) block backdated/closed posting.
 *  - Multi-currency totals strictly normalized to organization base currency (never sum USD + PKR raw).
 *  - Automatic monthly/periodic pattern detection (`GET /suggestions`) with human promotion (`POST /suggestions/promote`).
 *  - Full immutable audit trail on every create/update/delete/toggle/generate/approve/reject action.
 */

import { Router, type Request, type Response } from 'express';
import type { RecurringTransaction } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { postTransactionToJournal } from '../lib/ledgerService.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { getEstimatedFxRate } from '../lib/fxConverter.js';
import { filterAccessibleBanks, type WorldFilter } from '../services/financialTruthService.js';
import { requirePermission } from '../middleware/auth.js';

async function isPersonalWorldEnabled(sb: any, orgId: string): Promise<boolean> {
  if (!sb || !orgId) return true;
  try {
    const { data: orgRow } = await sb
      .from('organizations')
      .select('personal_world_enabled, settings')
      .eq('id', orgId)
      .maybeSingle();
    const enabled =
      orgRow?.personal_world_enabled ??
      orgRow?.settings?.personal_world_enabled ??
      orgRow?.settings?.features?.personal_finance ??
      true;
    return enabled !== false;
  } catch {
    return true;
  }
}
import {
  computeExpectedOccurrencesCount,
  computeMultiCurrencyRecurringTotals,
  computeNextOccurrenceIso,
  computeScheduledPeriodKey,
  detectRecurringPatterns,
  normalizeIsoDate,
  validateRecurringScheduleDates,
} from '../services/recurringEngine.js';

async function recomputeServerBankBalance(orgId: string, bankAccountId: string): Promise<void> {
  if (!orgId || !bankAccountId) return;
  const sb = getSupabaseAdminClient();
  if (!sb) return;

  try {
    const { data: bankRow } = await sb
      .from('bank_accounts')
      .select('opening_balance, balance, currency')
      .eq('id', bankAccountId)
      .eq('organization_id', orgId)
      .single();

    if (bankRow) {
      const openingBal = bankRow.opening_balance != null ? Number(bankRow.opening_balance) : 0;

      const { data: txns } = await sb
        .from('transactions')
        .select('amount, type, currency, status')
        .eq('bank_account_id', bankAccountId)
        .eq('organization_id', orgId)
        .not('status', 'in', '("draft","pending","rejected","reversed","cancelled")');

      const eligibleTxns = (txns || []).filter(
        (t: any) => !['draft', 'pending', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase()),
      );

      const newBalance = eligibleTxns.reduce((sum: number, t: any) => {
        const rawAmt = Number(t.amount || 0);
        return t.type === 'credit' ? sum + rawAmt : sum - Math.abs(rawAmt);
      }, openingBal);

      const rounded = Math.round(newBalance * 100) / 100;

      await sb
        .from('bank_accounts')
        .update({ balance: rounded, current_balance: rounded, last_synced_at: new Date().toISOString() })
        .eq('id', bankAccountId)
        .eq('organization_id', orgId);
    }
  } catch (err) {
    console.error('[recurring.recomputeServerBankBalance] Error:', err);
  }
}

async function isPeriodLocked(sb: any, orgId: string, isoDate: string): Promise<boolean> {
  if (!sb || !orgId || !isoDate) return false;
  try {
    const { data } = await sb
      .from('accounting_periods')
      .select('id, status')
      .eq('organization_id', orgId)
      .lte('start_date', isoDate)
      .gte('end_date', isoDate)
      .in('status', ['soft_closed', 'locked'])
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

function mapDbToDomain(row: Record<string, any>): RecurringTransaction {
  const startIso = normalizeIsoDate(row.start_date) || String(row.start_date ?? '');
  const endIso = row.end_date ? (normalizeIsoDate(row.end_date) || String(row.end_date)) : undefined;
  const freq = String(row.frequency || 'monthly');
  const computedExpected =
    endIso && startIso
      ? computeExpectedOccurrencesCount(freq, startIso, endIso)
      : row.total_occurrences_expected != null
        ? Number(row.total_occurrences_expected)
        : undefined;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    description: String(row.description ?? ''),
    amount: Number(row.amount),
    currency: String(row.currency ?? 'USD').toUpperCase(),
    type: (row.type === 'credit' ? 'credit' : 'debit') as 'credit' | 'debit',
    categoryId: row.category_id ? String(row.category_id) : '',
    bankAccountId: String(row.bank_account_id),
    frequency: row.frequency as RecurringTransaction['frequency'],
    startDate: startIso,
    endDate: endIso,
    nextOccurrence: normalizeIsoDate(row.next_occurrence) || String(row.next_occurrence ?? ''),
    isActive: Boolean(row.is_active),
    departmentId: row.department_id ? String(row.department_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    generatedOccurrenceCount:
      row.generated_occurrence_count != null ? Number(row.generated_occurrence_count) : 0,
    totalOccurrencesExpected: computedExpected ?? undefined,
    isPaidForCurrentPeriod: row.is_paid_for_current_period ?? false,
    timezone: row.timezone ? String(row.timezone) : 'UTC',
    worldScope: (row.world_scope === 'personal' ? 'personal' : 'business') as 'business' | 'personal',
    autoGenerate: Boolean(row.auto_generate ?? false),
    requiresApproval: Boolean(row.requires_approval ?? false),
    approvalThreshold: row.approval_threshold != null ? Number(row.approval_threshold) : undefined,
  };
}

function mapDomainToDb(item: Partial<RecurringTransaction>, includeExtendedCols = true): Record<string, unknown> {
  const startIso = normalizeIsoDate(item.startDate) || item.startDate;
  const endIso = item.endDate ? (normalizeIsoDate(item.endDate) || item.endDate) : null;
  const expected =
    endIso && startIso
      ? computeExpectedOccurrencesCount(String(item.frequency || 'monthly'), startIso, endIso)
      : item.totalOccurrencesExpected ?? null;

  const base: Record<string, unknown> = {
    id: item.id,
    organization_id: item.organizationId,
    description: (item.description ?? '').trim(),
    amount: Math.abs(Number(item.amount || 0)),
    currency: String(item.currency ?? 'USD').toUpperCase().trim(),
    type: item.type === 'credit' ? 'credit' : 'debit',
    category_id: item.categoryId && item.categoryId.trim() ? item.categoryId : null,
    bank_account_id: item.bankAccountId,
    frequency: item.frequency || 'monthly',
    start_date: startIso,
    end_date: endIso,
    next_occurrence: normalizeIsoDate(item.nextOccurrence) || item.nextOccurrence,
    is_active: item.isActive ?? true,
    department_id: item.departmentId || null,
    project_id: item.projectId || null,
    generated_occurrence_count: item.generatedOccurrenceCount ?? 0,
    total_occurrences_expected: expected,
  };

  if (includeExtendedCols) {
    base.timezone = item.timezone || 'UTC';
    base.world_scope = item.worldScope === 'personal' ? 'personal' : 'business';
    base.auto_generate = Boolean(item.autoGenerate ?? false);
    base.requires_approval = Boolean(item.requiresApproval ?? false);
    base.approval_threshold = item.approvalThreshold != null && Number(item.approvalThreshold) > 0
      ? Number(item.approvalThreshold)
      : null;
  }

  return base;
}

/**
 * Generates or queues a single due occurrence for a recurring schedule.
 * Enforces: active status, end_date, occurrence cap, period lock, approval gate,
 * `(template_id, scheduled_period_key)` idempotency, GL posting, and bank balance sync.
 */
async function executeScheduleOccurrence(params: {
  sb: any;
  orgId: string;
  schedule: Record<string, any>;
  actorUserId?: string | null;
  source: 'manual' | 'scheduler';
  bypassApproval?: boolean;
}): Promise<{
  outcome: 'posted' | 'pending_approval' | 'already_exists' | 'skipped';
  reason?: string;
  transaction?: any;
  occurrence?: any;
  schedule?: any;
}> {
  const { sb, orgId, schedule, actorUserId, source, bypassApproval = false } = params;

  if (schedule.is_active === false) {
    return { outcome: 'skipped', reason: 'Schedule is paused/inactive.' };
  }

  const payDate = normalizeIsoDate(schedule.next_occurrence);
  if (!payDate) {
    return { outcome: 'skipped', reason: 'Schedule has no valid next_occurrence date.' };
  }

  const endIso = normalizeIsoDate(schedule.end_date);
  if (endIso && payDate > endIso) {
    return { outcome: 'skipped', reason: `Schedule ended on ${endIso}.` };
  }

  const genCount = Number(schedule.generated_occurrence_count || 0);
  const expected =
    endIso && schedule.start_date
      ? computeExpectedOccurrencesCount(schedule.frequency || 'monthly', schedule.start_date, endIso)
      : schedule.total_occurrences_expected != null
        ? Number(schedule.total_occurrences_expected)
        : null;
  if (expected != null && Number.isFinite(expected) && genCount >= expected) {
    return { outcome: 'skipped', reason: `Schedule already completed (${genCount}/${expected} runs).` };
  }

  if (await isPeriodLocked(sb, orgId, payDate)) {
    return { outcome: 'skipped', reason: `Accounting period for ${payDate} is closed or locked.` };
  }

  const amt = Math.abs(Number(schedule.amount || 0));
  if (!Number.isFinite(amt) || amt <= 0) {
    return { outcome: 'skipped', reason: 'Schedule amount must be greater than zero.' };
  }

  const freq = String(schedule.frequency || 'monthly');
  const periodKey = computeScheduledPeriodKey(payDate, freq);
  const occId = `rocc-${schedule.id}-${periodKey}`;
  const txnId = `txn-rec-${schedule.id}-${payDate}`;

  // 1. Idempotency check against recurring_occurrences (if table exists) and deterministic transaction ID
  try {
    const { data: existingOcc } = await sb
      .from('recurring_occurrences')
      .select('*')
      .eq('template_id', schedule.id)
      .eq('scheduled_period_key', periodKey)
      .maybeSingle();

    if (existingOcc) {
      return {
        outcome: 'already_exists',
        reason: `Occurrence for period ${periodKey} already exists (status: ${existingOcc.status}).`,
        occurrence: existingOcc,
      };
    }
  } catch {
    // Table may not exist on pre-0048 DB; fall through to transaction-id idempotency check
  }

  const { data: existingTxn } = await sb
    .from('transactions')
    .select('*')
    .eq('id', txnId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (existingTxn) {
    return {
      outcome: 'already_exists',
      reason: `Transaction for ${payDate} was already generated.`,
      transaction: existingTxn,
    };
  }

  // 2. Approval policy check (§9 L410, §16, §33 #3)
  const threshold = schedule.approval_threshold != null ? Number(schedule.approval_threshold) : null;
  const needsApproval =
    !bypassApproval &&
    (Boolean(schedule.requires_approval) || (threshold != null && threshold > 0 && amt >= threshold));

  if (needsApproval) {
    const { data: occRow, error: occErr } = await sb
      .from('recurring_occurrences')
      .insert({
        id: occId,
        organization_id: orgId,
        template_id: schedule.id,
        scheduled_period_key: periodKey,
        scheduled_date: payDate,
        amount: amt,
        currency: String(schedule.currency || 'USD').toUpperCase(),
        status: 'pending_approval',
        source,
        notes: `Queued for approval (${periodKey})`,
      })
      .select()
      .single();

    if (occErr) {
      return { outcome: 'skipped', reason: `Could not queue approval occurrence: ${occErr.message}` };
    }

    return {
      outcome: 'pending_approval',
      reason: `Queued for approval (${periodKey}) before posting to ledger.`,
      occurrence: occRow,
    };
  }

  // 3. Resolve org base currency & FX snapshot (§8, §33 #6)
  let baseCurrency = 'USD';
  try {
    const { data: orgRow } = await sb
      .from('organizations')
      .select('currency, base_currency')
      .eq('id', orgId)
      .maybeSingle();
    if (orgRow?.base_currency || orgRow?.currency) {
      baseCurrency = String(orgRow.base_currency || orgRow.currency).toUpperCase();
    }
  } catch {
    /* default USD */
  }

  const txnCurrency = String(schedule.currency || baseCurrency).toUpperCase();
  const fxRate = txnCurrency === baseCurrency ? 1 : getEstimatedFxRate(txnCurrency, baseCurrency);
  const baseAmount = Math.round(amt * fxRate * 100) / 100;
  const generatedDate = new Date().toISOString().slice(0, 10);
  const worldScope = schedule.world_scope === 'personal' ? 'personal' : 'business';
  const narration = `Recurring: ${schedule.description} | Pay Date: ${payDate} | Generated: ${generatedDate}`;

  const { data: insertedTxn, error: insertErr } = await sb
    .from('transactions')
    .insert({
      id: txnId,
      organization_id: orgId,
      bank_account_id: schedule.bank_account_id,
      date: payDate,
      description: schedule.description,
      narration,
      amount: amt,
      currency: txnCurrency,
      type: schedule.type,
      status: 'classified',
      category_id: schedule.category_id,
      department_id: schedule.department_id,
      project_id: schedule.project_id,
      tags: ['recurring', `schedule:${schedule.id}`, `period:${periodKey}`, worldScope],
      source: 'recurring',
      original_amount: amt,
      original_currency: txnCurrency,
      fx_rate_to_base: fxRate,
      base_currency: baseCurrency,
      base_amount: baseAmount,
      world_scope: worldScope,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return { outcome: 'already_exists', reason: `Occurrence for ${payDate} already generated.` };
    }
    throw new Error(insertErr.message);
  }

  // 4. Advance schedule next_occurrence (UTC end-of-month clamped) & increment run counter
  const nextOccurrence = computeNextOccurrenceIso(payDate, freq);
  const { data: updatedSched } = await sb
    .from('recurring_transactions')
    .update({
      next_occurrence: nextOccurrence,
      generated_occurrence_count: genCount + 1,
    })
    .eq('id', schedule.id)
    .eq('organization_id', orgId)
    .select()
    .single();

  // 5. Post balanced double-entry GL journal (idempotent via ledgerService)
  const jeRes = await postTransactionToJournal(
    sb,
    {
      id: insertedTxn.id,
      organization_id: orgId,
      bank_account_id: insertedTxn.bank_account_id,
      category_id: insertedTxn.category_id,
      department_id: insertedTxn.department_id,
      project_id: insertedTxn.project_id,
      date: insertedTxn.date,
      amount: insertedTxn.amount,
      base_amount: insertedTxn.base_amount ?? insertedTxn.amount,
      currency: insertedTxn.currency,
      type: insertedTxn.type,
      description: insertedTxn.description || insertedTxn.narration,
      world_scope: worldScope,
    },
    actorUserId,
  );

  // 6. Record posted occurrence row (gracefully skipped if pre-0048)
  let occurrenceRow: any = null;
  try {
    const { data: occ } = await sb
      .from('recurring_occurrences')
      .upsert(
        {
          id: occId,
          organization_id: orgId,
          template_id: schedule.id,
          scheduled_period_key: periodKey,
          scheduled_date: payDate,
          amount: amt,
          currency: txnCurrency,
          status: 'posted',
          transaction_id: insertedTxn.id,
          journal_entry_id: jeRes.journalEntryId || null,
          source,
          approved_by: actorUserId || null,
          approved_at: new Date().toISOString(),
          posted_at: new Date().toISOString(),
        },
        { onConflict: 'template_id,scheduled_period_key' },
      )
      .select()
      .maybeSingle();
    occurrenceRow = occ;
  } catch {
    /* ignore if migration 0048 not yet applied */
  }

  // 7. Recompute authoritative bank balance
  await recomputeServerBankBalance(orgId, schedule.bank_account_id);

  return {
    outcome: 'posted',
    transaction: insertedTxn,
    occurrence: occurrenceRow,
    schedule: updatedSched,
  };
}

export function createRecurringRouter(): Router {
  const r = Router({ mergeParams: true });

  function getOrgId(req: Request): string {
    return (
      req.orgMembership?.organizationId ??
      (Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? ''))
    );
  }

  r.use((_req: Request, res: Response, next) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase admin client not configured');
    }
    next();
  });

  // GET / — list all recurring schedules for organization with accurate current-period status
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient()!;

    const { data: recurring, error } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('organization_id', orgId)
      .order('next_occurrence', { ascending: true });

    if (error) return fail(res, 500, error.message);

    const today = new Date().toISOString().slice(0, 10);
    const enriched = (recurring || []).map((rec) => {
      const nextIso = normalizeIsoDate(rec.next_occurrence) || '';
      const hasGenerated = Number(rec.generated_occurrence_count || 0) > 0;
      const isPaidForPeriod = Boolean(nextIso && nextIso > today && hasGenerated);
      return {
        ...rec,
        is_paid_for_current_period: isPaidForPeriod,
      };
    });

    ok(res, enriched.map(mapDbToDomain));
  });

  // GET /totals — Multi-currency normalized KPI totals in organization base currency (§33 #6)
  r.get('/totals', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient()!;

    const [{ data: orgRow }, { data: schedules, error }, pendingOccRes] = await Promise.all([
      sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
      sb.from('recurring_transactions').select('*').eq('organization_id', orgId),
      sb
        .from('recurring_occurrences')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'pending_approval'),
    ]);

    if (error) return fail(res, 500, error.message);

    const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();
    const pendingApprovalCount = !pendingOccRes.error && pendingOccRes.count != null ? pendingOccRes.count : 0;

    const totals = computeMultiCurrencyRecurringTotals({
      schedules: schedules || [],
      orgCurrency,
      asOfDate: new Date(),
      pendingApprovalCount,
    });

    ok(res, totals);
  });

  // GET /suggestions — Auto-detect monthly/weekly/quarterly/yearly recurring patterns from real posted transactions (§1, §11)
  r.get('/suggestions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const rawWorld = String(req.query.world || 'business').toLowerCase();
    const worldFilter: WorldFilter =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';
    const sb = getSupabaseAdminClient()!;

    const [
      { data: orgRow },
      { data: txns, error: txnErr },
      { data: bankAccounts },
      { data: catRows },
      { data: existingRecurring },
      { data: existingLoans },
    ] = await Promise.all([
      sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
      sb.from('transactions').select('*').eq('organization_id', orgId),
      sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('categories').select('id, name').eq('organization_id', orgId),
      sb.from('recurring_transactions').select('*').eq('organization_id', orgId),
      sb.from('loans').select('id, type, party, description, status').eq('organization_id', orgId),
    ]);

    if (txnErr) return fail(res, 500, txnErr.message);

    const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();
    const catMap = new Map<string, string>();
    for (const c of catRows || []) catMap.set(String(c.id), String(c.name));
    const { bankWorldMap } = filterAccessibleBanks(bankAccounts ?? [], worldFilter, callerUserId, isOrgOwner);

    const candidates = detectRecurringPatterns({
      transactions: txns || [],
      existingRecurring: existingRecurring || [],
      existingLoans: existingLoans || [],
      catMap,
      bankWorldMap,
      worldFilter,
      orgCurrency,
      asOfDate: new Date(),
    });

    ok(res, candidates);
  });

  // POST /suggestions/promote — Confirm a detected recurring candidate into a saved recurring template
  r.post('/suggestions/promote', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient()!;
    const body = req.body || {};
    if (body.worldScope === 'personal' && !(await isPersonalWorldEnabled(sb, orgId))) {
      return fail(res, 400, 'WORLD_DISABLED: Personal finance tracking is disabled for this organization.');
    }

    const description = String(body.suggestedTitle || body.description || '').trim();
    const amount = Math.abs(Number(body.suggestedAmount ?? body.amount ?? 0));
    const currency = String(body.currency || 'USD').toUpperCase().trim();
    const type: 'credit' | 'debit' = (body.direction || body.type) === 'credit' ? 'credit' : 'debit';
    const frequency = (body.frequency || 'monthly') as RecurringTransaction['frequency'];
    const bankAccountId = String(body.bankAccountId || '').trim();
    const startDate = normalizeIsoDate(body.lastSeenDate || body.startDate) || new Date().toISOString().slice(0, 10);
    const nextOccurrence =
      normalizeIsoDate(body.suggestedNextOccurrence || body.nextOccurrence) ||
      computeNextOccurrenceIso(startDate, frequency);

    if (!description) return fail(res, 400, 'Description is required to create a recurring schedule.');
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, 'Amount must be greater than zero.');
    if (!bankAccountId) return fail(res, 400, 'Bank account is required.');

    const item: RecurringTransaction = {
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      organizationId: orgId,
      description,
      amount,
      currency,
      type,
      categoryId: body.categoryId || '',
      bankAccountId,
      frequency,
      startDate,
      nextOccurrence,
      isActive: true,
      departmentId: body.departmentId || undefined,
      projectId: body.projectId || undefined,
      generatedOccurrenceCount: 0,
      worldScope: body.worldScope === 'personal' ? 'personal' : 'business',
      timezone: body.timezone || 'UTC',
      autoGenerate: Boolean(body.autoGenerate ?? false),
      requiresApproval: Boolean(body.requiresApproval ?? true),
    };

    let { data: inserted, error } = await sb
      .from('recurring_transactions')
      .insert(mapDomainToDb(item, true))
      .select()
      .single();

    if (error && /column .* does not exist/i.test(error.message)) {
      const retry = await sb
        .from('recurring_transactions')
        .insert(mapDomainToDb(item, false))
        .select()
        .single();
      inserted = retry.data;
      error = retry.error;
    }

    if (error) return fail(res, 500, error.message);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'promote_detected_recurring_pattern',
      entityType: 'recurring_transaction',
      entityId: inserted.id,
      description: `Promoted detected ${frequency} recurring pattern: ${description} (${currency} ${amount})`,
      afterState: inserted,
    });

    created(res, mapDbToDomain(inserted), 'Recurring schedule created from detected pattern');
  });

  // GET /occurrences — List recurring occurrences (filterable by status, e.g. pending_approval)
  r.get('/occurrences', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const statusFilter = req.query.status ? String(req.query.status).trim() : null;
    const sb = getSupabaseAdminClient()!;

    let q = sb
      .from('recurring_occurrences')
      .select('*, recurring_transactions:template_id(id, description, type, frequency, bank_account_id, category_id)')
      .eq('organization_id', orgId)
      .order('scheduled_date', { ascending: false })
      .limit(100);

    if (statusFilter) q = q.eq('status', statusFilter);

    const { data, error } = await q;
    if (error) {
      // Graceful empty array if migration 0048 has not created recurring_occurrences yet
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return ok(res, []);
      }
      return fail(res, 500, error.message);
    }

    ok(
      res,
      (data || []).map((row: any) => ({
        id: row.id,
        organizationId: row.organization_id,
        templateId: row.template_id,
        templateDescription: row.recurring_transactions?.description || 'Recurring Schedule',
        templateType: row.recurring_transactions?.type || 'debit',
        frequency: row.recurring_transactions?.frequency || 'monthly',
        scheduledPeriodKey: row.scheduled_period_key,
        scheduledDate: row.scheduled_date,
        amount: Number(row.amount || 0),
        currency: row.currency || 'USD',
        status: row.status,
        transactionId: row.transaction_id || null,
        journalEntryId: row.journal_entry_id || null,
        source: row.source,
        notes: row.notes || null,
        createdAt: row.created_at,
      })),
    );
  });

  // POST /occurrences/:occurrenceId/approve — Approve & post a pending recurring occurrence (§9, §16, §33 #3)
  r.post('/occurrences/:occurrenceId/approve', requirePermission('finance:approve'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const occId = String(req.params.occurrenceId);
    const sb = getSupabaseAdminClient()!;

    const { data: occ, error: occErr } = await sb
      .from('recurring_occurrences')
      .select('*')
      .eq('id', occId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (occErr) return fail(res, 500, occErr.message);
    if (!occ) return notFound(res, 'Recurring occurrence');
    if (occ.status !== 'pending_approval' && occ.status !== 'preview') {
      return fail(res, 400, `Occurrence is already in '${occ.status}' state.`);
    }

    const { data: sched, error: schedErr } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', occ.template_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (schedErr || !sched) return notFound(res, 'Recurring schedule');

    const payDate = normalizeIsoDate(occ.scheduled_date);
    if (!payDate) return fail(res, 400, 'Invalid scheduled date.');
    if (await isPeriodLocked(sb, orgId, payDate)) {
      return fail(res, 400, `Cannot post to closed or locked accounting period (${payDate}).`);
    }

    const txnId = `txn-rec-${sched.id}-${payDate}`;
    const amt = Math.abs(Number(occ.amount || sched.amount || 0));
    const { data: orgRow } = await sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle();
    const baseCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
    const txnCurrency = String(occ.currency || sched.currency || baseCurrency).toUpperCase();
    const fxRate = txnCurrency === baseCurrency ? 1 : getEstimatedFxRate(txnCurrency, baseCurrency);
    const baseAmount = Math.round(amt * fxRate * 100) / 100;
    const worldScope = sched.world_scope === 'personal' ? 'personal' : 'business';

    const { data: insertedTxn, error: txnErr } = await sb
      .from('transactions')
      .upsert(
        {
          id: txnId,
          organization_id: orgId,
          bank_account_id: sched.bank_account_id,
          date: payDate,
          description: sched.description,
          narration: `Recurring (Approved): ${sched.description} | Pay Date: ${payDate} | Period: ${occ.scheduled_period_key}`,
          amount: amt,
          currency: txnCurrency,
          type: sched.type,
          status: 'classified',
          category_id: sched.category_id,
          department_id: sched.department_id,
          project_id: sched.project_id,
          tags: ['recurring', `schedule:${sched.id}`, `period:${occ.scheduled_period_key}`, worldScope],
          source: 'recurring',
          original_amount: amt,
          original_currency: txnCurrency,
          fx_rate_to_base: fxRate,
          base_currency: baseCurrency,
          base_amount: baseAmount,
          world_scope: worldScope,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select()
      .single();

    if (txnErr) return fail(res, 500, txnErr.message);

    const jeRes = await postTransactionToJournal(
      sb,
      {
        id: insertedTxn.id,
        organization_id: orgId,
        bank_account_id: insertedTxn.bank_account_id,
        category_id: insertedTxn.category_id,
        department_id: insertedTxn.department_id,
        project_id: insertedTxn.project_id,
        date: insertedTxn.date,
        amount: insertedTxn.amount,
        base_amount: insertedTxn.base_amount ?? insertedTxn.amount,
        currency: insertedTxn.currency,
        type: insertedTxn.type,
        description: insertedTxn.description,
        world_scope: worldScope,
      },
      req.authUser?.id,
    );

    const nextOccurrence = computeNextOccurrenceIso(payDate, sched.frequency);
    await sb
      .from('recurring_transactions')
      .update({
        next_occurrence: nextOccurrence,
        generated_occurrence_count: Number(sched.generated_occurrence_count || 0) + 1,
      })
      .eq('id', sched.id)
      .eq('organization_id', orgId);

    const { data: updatedOcc } = await sb
      .from('recurring_occurrences')
      .update({
        status: 'posted',
        transaction_id: insertedTxn.id,
        journal_entry_id: jeRes.journalEntryId || null,
        approved_by: req.authUser?.id || null,
        approved_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', occId)
      .select()
      .single();

    await recomputeServerBankBalance(orgId, sched.bank_account_id);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'approve_recurring_occurrence',
      entityType: 'recurring_occurrence',
      entityId: occId,
      description: `Approved and posted recurring occurrence ${sched.description} (${occ.scheduled_period_key})`,
      afterState: { occurrence: updatedOcc, transactionId: insertedTxn.id, journalEntryId: jeRes.journalEntryId },
    });

    ok(res, { occurrence: updatedOcc, transaction: insertedTxn }, 'Recurring occurrence approved and posted to ledger');
  });

  // POST /occurrences/:occurrenceId/reject — Reject/skip a pending recurring occurrence (zero ledger impact)
  r.post('/occurrences/:occurrenceId/reject', requirePermission('finance:approve'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const occId = String(req.params.occurrenceId);
    const reason = String(req.body?.reason || 'Skipped by reviewer').trim();
    const sb = getSupabaseAdminClient()!;

    const { data: occ, error: fetchErr } = await sb
      .from('recurring_occurrences')
      .select('*')
      .eq('id', occId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!occ) return notFound(res, 'Recurring occurrence');
    if (occ.status !== 'pending_approval' && occ.status !== 'preview') {
      return fail(res, 400, `Cannot reject occurrence in '${occ.status}' state.`);
    }

    const { data: updatedOcc, error: updErr } = await sb
      .from('recurring_occurrences')
      .update({
        status: 'skipped',
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', occId)
      .select()
      .single();

    if (updErr) return fail(res, 500, updErr.message);

    // Advance template past skipped period so scheduler does not re-queue the exact same period
    const { data: sched } = await sb
      .from('recurring_transactions')
      .select('id, frequency, next_occurrence')
      .eq('id', occ.template_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (sched && normalizeIsoDate(sched.next_occurrence) === normalizeIsoDate(occ.scheduled_date)) {
      await sb
        .from('recurring_transactions')
        .update({ next_occurrence: computeNextOccurrenceIso(occ.scheduled_date, sched.frequency) })
        .eq('id', sched.id)
        .eq('organization_id', orgId);
    }

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'skip_recurring_occurrence',
      entityType: 'recurring_occurrence',
      entityId: occId,
      description: `Skipped recurring occurrence (${occ.scheduled_period_key}): ${reason}`,
      afterState: updatedOcc,
    });

    ok(res, updatedOcc, 'Recurring occurrence skipped');
  });

  // POST / — create new recurring schedule
  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<RecurringTransaction, 'id' | 'organizationId'>;

    const dateErr = validateRecurringScheduleDates({
      startDate: data.startDate,
      nextOccurrence: data.nextOccurrence,
      endDate: data.endDate,
    });
    if (dateErr) return fail(res, 400, dateErr);

    const amt = Math.abs(Number(data.amount || 0));
    if (!Number.isFinite(amt) || amt <= 0) return fail(res, 400, 'Amount must be greater than zero.');
    if (!data.description?.trim()) return fail(res, 400, 'Description is required.');
    if (!data.bankAccountId?.trim()) return fail(res, 400, 'Bank account is required.');

    const sb = getSupabaseAdminClient()!;

    // Derive worldScope from linked bank account if not explicitly passed
    let resolvedWorld: 'business' | 'personal' = data.worldScope === 'personal' ? 'personal' : 'business';
    if (!data.worldScope && data.bankAccountId) {
      const { data: bankRow } = await sb
        .from('bank_accounts')
        .select('usage')
        .eq('id', data.bankAccountId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (bankRow?.usage === 'personal') resolvedWorld = 'personal';
    }
    if (resolvedWorld === 'personal' && !(await isPersonalWorldEnabled(sb, orgId))) {
      return fail(res, 400, 'WORLD_DISABLED: Personal finance tracking is disabled for this organization.');
    }

    const item: RecurringTransaction = {
      ...data,
      amount: amt,
      worldScope: resolvedWorld,
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      organizationId: orgId,
    };

    let { data: inserted, error } = await sb
      .from('recurring_transactions')
      .insert(mapDomainToDb(item, true))
      .select()
      .single();

    if (error && /column .* does not exist/i.test(error.message)) {
      const retry = await sb
        .from('recurring_transactions')
        .insert(mapDomainToDb(item, false))
        .select()
        .single();
      inserted = retry.data;
      error = retry.error;
    }

    if (error) return fail(res, 500, error.message);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'create_recurring_transaction',
      entityType: 'recurring_transaction',
      entityId: inserted.id,
      description: `Created recurring schedule: ${inserted.description} (${inserted.currency} ${inserted.amount}, ${inserted.frequency})`,
      afterState: inserted,
    });

    created(res, mapDbToDomain(inserted), 'Recurring transaction created');
  });

  // PATCH /:id — update existing recurring schedule
  r.patch('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = String(req.params.id);
    const sb = getSupabaseAdminClient()!;

    const { data: existing, error: fetchError } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) return notFound(res);

    const merged: RecurringTransaction = {
      ...mapDbToDomain(existing),
      ...(req.body as Partial<RecurringTransaction>),
    };
    if (merged.worldScope === 'personal' && !(await isPersonalWorldEnabled(sb, orgId))) {
      return fail(res, 400, 'WORLD_DISABLED: Personal finance tracking is disabled for this organization.');
    }

    const dateErr = validateRecurringScheduleDates({
      startDate: merged.startDate,
      nextOccurrence: merged.nextOccurrence,
      endDate: merged.endDate,
    });
    if (dateErr) return fail(res, 400, dateErr);

    let { data: updated, error } = await sb
      .from('recurring_transactions')
      .update(mapDomainToDb(merged, true))
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error && /column .* does not exist/i.test(error.message)) {
      const retry = await sb
        .from('recurring_transactions')
        .update(mapDomainToDb(merged, false))
        .eq('id', id)
        .eq('organization_id', orgId)
        .select()
        .single();
      updated = retry.data;
      error = retry.error;
    }

    if (error) return fail(res, 500, error.message);
    if (!updated) return notFound(res);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'update_recurring_transaction',
      entityType: 'recurring_transaction',
      entityId: id,
      description: `Updated recurring schedule: ${updated.description}`,
      beforeState: existing,
      afterState: updated,
    });

    ok(res, mapDbToDomain(updated));
  });

  // DELETE /:id — delete recurring schedule
  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = String(req.params.id);
    const sb = getSupabaseAdminClient()!;

    const { data: existing } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle();

    const { error } = await sb
      .from('recurring_transactions')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) return fail(res, 500, error.message);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'delete_recurring_transaction',
      entityType: 'recurring_transaction',
      entityId: id,
      description: `Deleted recurring schedule: ${existing?.description || id}`,
      beforeState: existing || undefined,
    });

    ok(res, null, 'Deleted');
  });

  // POST /:id/toggle — toggle isActive status
  r.post('/:id/toggle', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = String(req.params.id);
    const sb = getSupabaseAdminClient()!;

    const { data: existing, error: fetchError } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !existing) return notFound(res);

    const { data: updated, error } = await sb
      .from('recurring_transactions')
      .update({ is_active: !existing.is_active })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) return fail(res, 500, error.message);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'toggle_recurring_transaction',
      entityType: 'recurring_transaction',
      entityId: id,
      description: `${updated.is_active ? 'Resumed' : 'Paused'} recurring schedule: ${updated.description}`,
      beforeState: { is_active: existing.is_active },
      afterState: { is_active: updated.is_active },
    });

    ok(res, mapDbToDomain(updated));
  });

  // POST /generate — generate due occurrences up to asOfDate (Handoff v1.2 safe, idempotent, approval-aware, GL-posted)
  r.post('/generate', requirePermission('finance:post_ledger'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const rawAsOf = req.body?.asOfDate;
    const asOfDate = normalizeIsoDate(rawAsOf) || new Date().toISOString().slice(0, 10);
    const sb = getSupabaseAdminClient()!;

    const { data: dueSchedules, error } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .lte('next_occurrence', asOfDate);

    if (error) return fail(res, 500, error.message);

    const results: Array<{
      scheduleId: string;
      description: string;
      outcome: string;
      transactionId?: string;
      occurrenceId?: string;
      reason?: string;
    }> = [];

    for (const sched of dueSchedules || []) {
      try {
        const exec = await executeScheduleOccurrence({
          sb,
          orgId,
          schedule: sched,
          actorUserId: req.authUser?.id,
          source: 'manual',
        });
        results.push({
          scheduleId: sched.id,
          description: sched.description,
          outcome: exec.outcome,
          transactionId: exec.transaction?.id,
          occurrenceId: exec.occurrence?.id,
          reason: exec.reason,
        });
      } catch (err: any) {
        results.push({
          scheduleId: sched.id,
          description: sched.description,
          outcome: 'error',
          reason: err?.message || 'Failed to generate occurrence',
        });
      }
    }

    const postedCount = results.filter((x) => x.outcome === 'posted').length;
    const queuedCount = results.filter((x) => x.outcome === 'pending_approval').length;

    if (postedCount > 0 || queuedCount > 0) {
      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'generate_recurring_transactions_batch',
        entityType: 'recurring_transaction',
        entityId: orgId,
        description: `Batch recurring run as of ${asOfDate}: ${postedCount} posted, ${queuedCount} queued for approval`,
        afterState: { asOfDate, postedCount, queuedCount, results },
      });
    }

    const summaryMsg =
      postedCount > 0 && queuedCount > 0
        ? `Posted ${postedCount} and queued ${queuedCount} for approval`
        : queuedCount > 0
          ? `Queued ${queuedCount} recurring occurrence${queuedCount !== 1 ? 's' : ''} for approval`
          : `Generated ${postedCount} transaction${postedCount !== 1 ? 's' : ''}`;

    ok(res, results, summaryMsg);
  });

  // POST /:id/generate — generate single recurring occurrence (strictly validated + idempotent + GL-posted)
  r.post('/:id/generate', requirePermission('finance:post_ledger'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = String(req.params.id);
    const sb = getSupabaseAdminClient()!;

    const { data: schedule, error: fetchError } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !schedule) return notFound(res);

    try {
      const exec = await executeScheduleOccurrence({
        sb,
        orgId,
        schedule,
        actorUserId: req.authUser?.id,
        source: 'manual',
      });

      if (exec.outcome === 'skipped') {
        return fail(res, 400, exec.reason || 'Schedule is not eligible to generate.');
      }

      if (exec.outcome === 'already_exists') {
        return ok(res, exec.transaction || exec.occurrence, exec.reason || 'Occurrence already exists (idempotent replay)');
      }

      if (exec.outcome === 'pending_approval') {
        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'queue_recurring_occurrence_approval',
          entityType: 'recurring_occurrence',
          entityId: exec.occurrence?.id || id,
          description: `Queued recurring occurrence for approval: ${schedule.description}`,
          afterState: exec.occurrence,
        });
        return ok(res, exec.occurrence, exec.reason || 'Queued for approval before posting');
      }

      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'generate_recurring_transaction',
        entityType: 'transaction',
        entityId: exec.transaction.id,
        description: `Generated recurring occurrence: ${exec.transaction.description} (${exec.transaction.amount} ${exec.transaction.currency})`,
        afterState: exec.transaction,
      });

      return ok(res, exec.transaction, 'Transaction generated and posted to ledger');
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to generate recurring transaction');
    }
  });

  return r;
}
