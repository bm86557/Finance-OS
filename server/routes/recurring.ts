/**
 * §9 — Recurring transactions. Mounted at `/organizations/:organizationId/recurring-transactions`.
 * 
 * CRITICAL: This route creates SCHEDULES, not transactions. Balances are NOT affected
 * until POST /generate is called to run `recurring_generate_due()` SQL function.
 * 
 * See: supabase/migrations/0003_recurring_transactions_generator.sql for:
 * - recurring_generate_due() function (creates transactions from due schedules)
 * - update_bank_account_balance() trigger (updates balances when transactions are inserted)
 */

import { Router, type Request, type Response } from 'express';
import type { RecurringTransaction } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { postTransactionToJournal } from '../lib/ledgerService.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { getEstimatedFxRate } from '../lib/fxConverter.js';

// Server-side balance recomputation function
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
      const bankCurrency = bankRow.currency || 'USD';
      const rawOpening = bankRow.opening_balance;
      const openingBal = rawOpening != null
        ? Number(rawOpening)
        : 0;

      const { data: txns } = await sb
        .from('transactions')
        .select('amount, type, currency, status')
        .eq('bank_account_id', bankAccountId)
        .eq('organization_id', orgId)
        .not('status', 'in', '("draft","pending","rejected","reversed","cancelled")');

      const eligibleTxns = (txns || []).filter(
        (t: any) => !['draft', 'pending', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
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

      console.log('[recomputeServerBankBalance] Updated balance for', bankAccountId, ':', rounded);
    }
  } catch (err) {
    console.error('[recomputeServerBankBalance] Error:', err);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateRecurringDateOrder(startDate: string, nextOccurrence: string): string | null {
  const s = startDate.trim().slice(0, 10);
  const n = nextOccurrence.trim().slice(0, 10);
  if (!ISO_DATE.test(s) || !ISO_DATE.test(n)) return 'Use valid start and next dates.';
  if (n < s) return 'Next occurrence must be on or after the start date.';
  return null;
}

function mapDbToDomain(row: Record<string, any>): RecurringTransaction {
  const result: RecurringTransaction = {
    id: String(row.id),
    organizationId: String(row.organization_id),
    description: String(row.description ?? ''),
    amount: Number(row.amount),
    currency: String(row.currency ?? 'USD'),
    type: (row.type === 'credit' ? 'credit' : 'debit') as 'credit' | 'debit',
    categoryId: row.category_id ? String(row.category_id) : '',
    bankAccountId: String(row.bank_account_id),
    frequency: row.frequency as RecurringTransaction['frequency'],
    startDate: String(row.start_date),
    endDate: row.end_date ? String(row.end_date) : undefined,
    nextOccurrence: String(row.next_occurrence),
    isActive: Boolean(row.is_active),
    departmentId: row.department_id ? String(row.department_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    generatedOccurrenceCount: row.generated_occurrence_count != null 
      ? Number(row.generated_occurrence_count) 
      : undefined,
    totalOccurrencesExpected: row.total_occurrences_expected != null 
      ? Number(row.total_occurrences_expected) 
      : undefined,
    isPaidForCurrentPeriod: row.is_paid_for_current_period ?? false,
  };
  
  console.log('[mapDbToDomain] Mapped recurring transaction:', {
    id: result.id,
    nextOccurrence: result.nextOccurrence,
    isActive: result.isActive,
    isPaidForCurrentPeriod: result.isPaidForCurrentPeriod,
    raw_next_occurrence: row.next_occurrence,
  });
  
  return result;
}

function mapDomainToDb(item: Partial<RecurringTransaction>): Record<string, unknown> {
  return {
    id: item.id,
    organization_id: item.organizationId,
    description: item.description ?? '',
    amount: item.amount,
    currency: item.currency ?? 'USD',
    type: item.type,
    category_id: item.categoryId && item.categoryId.trim() ? item.categoryId : null,
    bank_account_id: item.bankAccountId,
    frequency: item.frequency,
    start_date: item.startDate,
    end_date: item.endDate ?? null,
    next_occurrence: item.nextOccurrence,
    is_active: item.isActive ?? true,
    department_id: item.departmentId ?? null,
    project_id: item.projectId ?? null,
    generated_occurrence_count: item.generatedOccurrenceCount ?? 0,
    total_occurrences_expected: item.totalOccurrencesExpected ?? null,
  };
}

export function createRecurringRouter(): Router {
  const r = Router({ mergeParams: true });

  function getOrgId(req: Request): string {
    const p = req.params.organizationId;
    return Array.isArray(p) ? p[0] : (p ?? '');
  }

  // Middleware to ensure Supabase admin client is initialized
  r.use((_req: Request, res: Response, next) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase admin client not configured');
    }
    next();
  });

  // GET / — list all recurring transactions for organization with payment status
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient()!;
    
    // Get all recurring transactions
    const { data: recurring, error } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('organization_id', orgId);
    
    if (error) return fail(res, 500, error.message);
    
    // For each recurring transaction, check if it's been paid for current period
    const today = new Date().toISOString().split('T')[0];
    const enrichedData = await Promise.all(
      (recurring || []).map(async (rec) => {
        // Logic: If next_occurrence is in the future AND we've generated at least once,
        // then current period is paid. If next_occurrence <= today, it's due/unpaid.
        const hasGenerated = rec.generated_occurrence_count && rec.generated_occurrence_count > 0;
        const isPaidForPeriod = rec.next_occurrence > today && hasGenerated;
        
        console.log(`[RecurringTransactions] ${rec.description}:`, {
          nextOccurrence: rec.next_occurrence,
          today,
          generatedCount: rec.generated_occurrence_count,
          hasGenerated,
          isPaidForPeriod,
          comparison: `${rec.next_occurrence} > ${today} = ${rec.next_occurrence > today}`
        });
        
        return {
          ...rec,
          is_paid_for_current_period: isPaidForPeriod,
        };
      })
    );
    
    ok(res, enrichedData.map(mapDbToDomain));
  });

  // POST / — create new recurring transaction
  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<RecurringTransaction, 'id' | 'organizationId'>;
    
    console.log('[recurring] POST /', { orgId, data });
    
    const dateErr = validateRecurringDateOrder(data.startDate, data.nextOccurrence);
    if (dateErr) {
      console.error('[recurring] Date validation failed:', dateErr);
      return fail(res, 400, dateErr);
    }
    
    const item: RecurringTransaction = { 
      ...data, 
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      organizationId: orgId 
    };
    
    const sb = getSupabaseAdminClient()!;
    console.log('[recurring] Inserting:', mapDomainToDb(item));
    
    const { data: inserted, error } = await sb
      .from('recurring_transactions')
      .insert(mapDomainToDb(item))
      .select()
      .single();
    
    if (error) {
      console.error('[recurring] Supabase insert error:', error);
      return fail(res, 500, error.message);
    }
    
    console.log('[recurring] Insert success:', inserted);
    
    // DO NOT auto-generate - user must click generate button manually
    
    created(res, mapDbToDomain(inserted), 'Recurring transaction created');
  });

  // PATCH /:id — update existing recurring transaction
  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    
    const sb = getSupabaseAdminClient()!;
    
    // Fetch existing record
    const { data: existing, error: fetchError } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();
    
    if (fetchError || !existing) return notFound(res);
    
    const merged: RecurringTransaction = { 
      ...mapDbToDomain(existing), 
      ...(req.body as Partial<RecurringTransaction>) 
    };
    
    const dateErr = validateRecurringDateOrder(merged.startDate, merged.nextOccurrence);
    if (dateErr) return fail(res, 400, dateErr);
    
    const { data: updated, error } = await sb
      .from('recurring_transactions')
      .update(mapDomainToDb(merged))
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();
    
    if (error) return fail(res, 500, error.message);
    if (!updated) return notFound(res);
    
    ok(res, mapDbToDomain(updated));
  });

  // DELETE /:id — delete recurring transaction
  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    
    const sb = getSupabaseAdminClient()!;
    const { error } = await sb
      .from('recurring_transactions')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    
    if (error) return fail(res, 500, error.message);
    ok(res, null, 'Deleted');
  });

  // POST /:id/toggle — toggle isActive status
  r.post('/:id/toggle', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    
    const sb = getSupabaseAdminClient()!;
    
    // Fetch current record
    const { data: existing, error: fetchError } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();
    
    if (fetchError || !existing) return notFound(res);
    
    // Toggle is_active
    const { data: updated, error } = await sb
      .from('recurring_transactions')
      .update({ is_active: !existing.is_active })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();
    
    if (error) return fail(res, 500, error.message);
    ok(res, mapDbToDomain(updated));
  });

  // GET /totals — get KPI totals from recurring_totals RPC
  r.get('/totals', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient()!;
    
    console.log('[recurring] GET /totals', { orgId });
    
    const { data, error } = await sb.rpc('recurring_totals', { p_org: orgId });
    
    if (error) {
      console.error('[recurring] Totals RPC error:', error);
      return fail(res, 500, error.message);
    }
    
    console.log('[recurring] Totals result:', data);
    ok(res, data);
  });

  // POST /generate — generate transactions for due recurring schedules
  r.post('/generate', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const asOfDate = req.body?.asOfDate || new Date().toISOString().split('T')[0];
    
    const sb = getSupabaseAdminClient()!;
    
    const { data, error } = await sb.rpc('recurring_generate_due', { 
      p_org: orgId, 
      p_as_of: asOfDate 
    });
    
    if (error) return fail(res, 500, error.message);
    
    // Recompute bank account balances for all affected accounts
    if (Array.isArray(data) && data.length > 0) {
      // Get unique bank account IDs from generated transactions
      const { data: schedules } = await sb
        .from('recurring_transactions')
        .select('id, bank_account_id, category_id, department_id, project_id, amount, currency, type, description')
        .eq('organization_id', orgId)
        .in('id', data.map((d: any) => d.schedule_id));
      
      if (schedules) {
        const uniqueBankAccountIds = [...new Set(schedules.map((s: any) => s.bank_account_id))];
        await Promise.all(
          uniqueBankAccountIds.map(bankAccountId => 
            recomputeServerBankBalance(orgId, bankAccountId)
          )
        );
        console.log('[recurring] Recomputed balances for accounts:', uniqueBankAccountIds);
        // Lookup generated recurring transactions by date and id prefix for GL posting (§9, §10, §33 #7)
        const { data: genTxns } = await sb
          .from('transactions')
          .select('*')
          .eq('organization_id', orgId)
          .eq('date', asOfDate)
          .ilike('id', 'txn-rec-%');

        if (genTxns && genTxns.length > 0) {
          for (const tx of genTxns) {
            void postTransactionToJournal(sb, {
              id: tx.id,
              organization_id: orgId,
              bank_account_id: tx.bank_account_id,
              category_id: tx.category_id,
              department_id: tx.department_id,
              project_id: tx.project_id,
              date: tx.date,
              amount: tx.amount,
              base_amount: tx.base_amount ?? tx.amount,
              currency: tx.currency,
              type: tx.type,
              description: tx.description || tx.narration,
              world_scope: tx.world_scope || 'business',
            }, (req as any).authUser?.id);
          }
        }
        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'generate_recurring_transactions_batch',
          entityType: 'recurring_transaction',
          entityId: orgId,
          description: `Batch generated ${data.length} recurring transaction occurrences as of ${asOfDate}`,
        });
      }
    }
    
    const count = Array.isArray(data) ? data.length : 0;
    ok(res, data, `Generated ${count} transaction${count !== 1 ? 's' : ''}`);
  });

  // POST /:id/generate — generate transaction for a single recurring schedule
  r.post('/:id/generate', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    
    const sb = getSupabaseAdminClient()!;
    
    console.log('[recurring] POST /:id/generate', { orgId, id });
    
    // Fetch the recurring schedule
    const { data: schedule, error: fetchError } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();
    
    if (fetchError || !schedule) {
      console.error('[recurring] Schedule not found:', fetchError);
      return notFound(res);
    }
    
    console.log('[recurring] Found schedule:', schedule);
    
    // Use the schedule's next_occurrence as the transaction date (pay date)
    const payDate = schedule.next_occurrence;
    const t_id = `txn-rec-${id}-${payDate}`;
    
    // Build narration with both dates
    const generatedDate = new Date().toISOString().split('T')[0];
    const narration = `Recurring: ${schedule.description} | Pay Date: ${payDate} | Generated: ${generatedDate}`;
    let baseCurrency = 'USD';
    try {
      const { data: orgRow } = await sb.from('organizations').select('currency').eq('id', orgId).maybeSingle();
      if (orgRow?.currency) baseCurrency = orgRow.currency;
    } catch {}
    const txnCurrency = schedule.currency || 'USD';
    const fxRate = txnCurrency === baseCurrency ? 1 : getEstimatedFxRate(txnCurrency, baseCurrency);
    const baseAmount = Math.round(Number(schedule.amount) * fxRate * 100) / 100;
    
    // Insert transaction
    const { data: inserted, error: insertError } = await sb
      .from('transactions')
      .insert({
        id: t_id,
        organization_id: orgId,
        bank_account_id: schedule.bank_account_id,
        date: payDate,  // Use the pay date as the transaction date
        description: schedule.description,  // Use the actual recurring transaction name
        narration: narration,
        amount: schedule.amount,
        currency: schedule.currency,
        type: schedule.type,
        status: 'classified',
        category_id: schedule.category_id,
        department_id: schedule.department_id,
        project_id: schedule.project_id,
        tags: ['recurring', `schedule:${id}`],
        source: 'recurring',
        original_amount: schedule.amount,
        original_currency: txnCurrency,
        fx_rate_to_base: fxRate,
        base_currency: baseCurrency,
        base_amount: baseAmount,
        world_scope: (schedule as any).world_scope || 'business',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[recurring] Transaction insert error:', insertError);
      return fail(res, 500, insertError.message);
    }
    
    console.log('[recurring] Transaction created:', inserted);
    
    // Update next occurrence FIRST (before balance recomputation) to ensure counter is updated
    const nextOccurrence = calculateNextOccurrence(schedule.next_occurrence, schedule.frequency);
    
    console.log('[recurring] Updating recurring schedule:', {
      id,
      current: schedule.next_occurrence,
      frequency: schedule.frequency,
      next: nextOccurrence,
      currentCount: schedule.generated_occurrence_count,
      newCount: (schedule.generated_occurrence_count || 0) + 1,
    });
    
    const { data: updated, error: updateError } = await sb
      .from('recurring_transactions')
      .update({
        next_occurrence: nextOccurrence,
        generated_occurrence_count: (schedule.generated_occurrence_count || 0) + 1,
      })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();
    
    if (updateError) {
      console.error('[recurring] CRITICAL: Failed to update recurring schedule after creating transaction:', updateError);
      console.error('[recurring] Transaction ID:', inserted.id);
      console.error('[recurring] Recurring schedule ID:', id);
      // Return error to user so they know something went wrong
      return fail(res, 500, `Transaction created but failed to update schedule: ${updateError.message}`);
    }
    
    if (!updated) {
      console.error('[recurring] CRITICAL: No data returned after update. Schedule may not exist or RLS policy blocked it.');
      return fail(res, 500, 'Transaction created but failed to verify schedule update');
    }
    
    console.log('[recurring] Successfully updated recurring schedule:', {
      id: updated.id,
      next_occurrence: updated.next_occurrence,
      generated_occurrence_count: updated.generated_occurrence_count,
    });
    
    // Recompute bank account balance after creating transaction
    await recomputeServerBankBalance(orgId, schedule.bank_account_id);
    console.log('[recurring] Bank account balance recomputed for:', schedule.bank_account_id);

    // Post to General Ledger for double-entry bookkeeping compliance
    void postTransactionToJournal(sb, {
      id: inserted.id,
      organization_id: orgId,
      bank_account_id: inserted.bank_account_id,
      category_id: inserted.category_id,
      department_id: inserted.department_id,
      project_id: inserted.project_id,
      date: inserted.date,
      amount: inserted.amount,
      base_amount: inserted.base_amount ?? inserted.amount,
      currency: inserted.currency,
      type: inserted.type,
      description: inserted.description || inserted.narration,
      world_scope: (inserted as any).world_scope || 'business',
    }, (req as any).authUser?.id);

    // Audit log occurrence generation (§33)
    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'generate_recurring_transaction',
      entityType: 'transaction',
      entityId: inserted.id,
      description: `Generated recurring occurrence: ${inserted.description} (${inserted.amount} ${inserted.currency})`,
      afterState: inserted,
    });
    
    ok(res, inserted, 'Transaction generated and added to ledger');
  });

  return r;
}

function calculateNextOccurrence(currentDate: string, frequency: string): string {
  // Parse date properly to avoid timezone issues
  const [year, month, day] = currentDate.split('-').map(Number);
  const date = new Date(year, month - 1, day); // Month is 0-indexed
  
  console.log('[calculateNextOccurrence] Input:', { currentDate, frequency });
  console.log('[calculateNextOccurrence] Parsed date:', date.toISOString());
  
  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  
  // Format back to YYYY-MM-DD
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getDate()).padStart(2, '0');
  const result = `${nextYear}-${nextMonth}-${nextDay}`;
  
  console.log('[calculateNextOccurrence] Result:', result);
  
  return result;
}

function calculatePeriodStart(currentDate: string, frequency: string): string {
  const [year, month, day] = currentDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  
  switch (frequency) {
    case 'daily':
      // Today only
      return currentDate;
    case 'weekly':
      // Start of current week (Monday)
      const dayOfWeek = date.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Sunday
      date.setDate(date.getDate() + diff);
      break;
    case 'monthly':
      // Start of current month
      date.setDate(1);
      break;
    case 'quarterly':
      // Start of current quarter
      const currentMonth = date.getMonth();
      const quarterStartMonth = Math.floor(currentMonth / 3) * 3;
      date.setMonth(quarterStartMonth);
      date.setDate(1);
      break;
    case 'yearly':
      // Start of current year
      date.setMonth(0);
      date.setDate(1);
      break;
  }
  
  const periodYear = date.getFullYear();
  const periodMonth = String(date.getMonth() + 1).padStart(2, '0');
  const periodDay = String(date.getDate()).padStart(2, '0');
  
  return `${periodYear}-${periodMonth}-${periodDay}`;
}
