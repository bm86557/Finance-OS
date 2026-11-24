/**
 * Background Recurring Transactions Scheduler Worker (§6, §9, §19, §33 #7)
 * =======================================================================
 * Runs periodically to process active schedules explicitly marked `auto_generate = true`
 * whose `next_occurrence <= today`.
 *
 * Guarantees per Handoff v1.2:
 *  - Idempotent per `(template_id, scheduled_period_key)` — safe across restarts/retries
 *  - Respects `end_date`, `total_occurrences_expected`, and `accounting_periods` locks
 *  - Never silently posts schedules that require approval (`requires_approval = true`
 *    or `amount >= approval_threshold`) — queues `pending_approval` in `recurring_occurrences`
 *    and dispatches an in-app notification to org approvers
 */

import { getSupabaseAdminClient } from './supabaseAdmin.js';
import { postTransactionToJournal } from './ledgerService.js';
import { getEstimatedFxRate } from './fxConverter.js';
import {
  computeNextOccurrenceIso,
  computeScheduledPeriodKey,
  normalizeIsoDate,
} from '../services/recurringEngine.js';

let isRunning = false;
let schedulerTimer: NodeJS.Timeout | null = null;

async function isDateInLockedPeriod(sb: any, orgId: string, isoDate: string): Promise<boolean> {
  try {
    const { data } = await sb
      .from('accounting_periods')
      .select('id')
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

export async function runRecurringSchedulerTick(asOfDate?: string): Promise<{
  processed: number;
  posted: number;
  queuedForApproval: number;
  skipped: number;
}> {
  const sb = getSupabaseAdminClient();
  const stats = { processed: 0, posted: 0, queuedForApproval: 0, skipped: 0 };
  if (!sb) return stats;

  const todayIso = normalizeIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);

  try {
    // Only pick up schedules explicitly opted into auto_generate = true
    const { data: dueSchedules, error } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('is_active', true)
      .eq('auto_generate', true)
      .lte('next_occurrence', todayIso);

    if (error) {
      // Graceful skip if migration 0048 hasn't added `auto_generate` yet
      if (error.message?.includes('auto_generate')) return stats;
      console.warn('[recurringWorker] Query warning:', error.message);
      return stats;
    }

    for (const sched of dueSchedules || []) {
      const orgId = String(sched.organization_id);
      const payDate = normalizeIsoDate(sched.next_occurrence);
      if (!payDate) {
        stats.skipped++;
        continue;
      }

      const endIso = normalizeIsoDate(sched.end_date);
      if (endIso && payDate > endIso) {
        stats.skipped++;
        continue;
      }

      const genCount = Number(sched.generated_occurrence_count || 0);
      const expected = sched.total_occurrences_expected != null ? Number(sched.total_occurrences_expected) : null;
      if (expected != null && Number.isFinite(expected) && genCount >= expected) {
        stats.skipped++;
        continue;
      }

      if (await isDateInLockedPeriod(sb, orgId, payDate)) {
        stats.skipped++;
        continue;
      }

      const periodKey = computeScheduledPeriodKey(payDate, sched.frequency);
      const occId = `rocc-${sched.id}-${periodKey}`;
      const amt = Math.abs(Number(sched.amount || 0));
      if (amt <= 0) {
        stats.skipped++;
        continue;
      }

      // Idempotency check against recurring_occurrences
      const { data: existingOcc } = await sb
        .from('recurring_occurrences')
        .select('id, status')
        .eq('template_id', sched.id)
        .eq('scheduled_period_key', periodKey)
        .maybeSingle();

      if (existingOcc) {
        stats.skipped++;
        continue;
      }

      const threshold = sched.approval_threshold != null ? Number(sched.approval_threshold) : null;
      const needsApproval = Boolean(sched.requires_approval) || (threshold != null && threshold > 0 && amt >= threshold);
      const nextOccurrence = computeNextOccurrenceIso(payDate, sched.frequency);

      if (needsApproval) {
        // §9 L410: Queue candidate occurrence for human approval without posting to ledger
        const { error: occErr } = await sb.from('recurring_occurrences').insert({
          id: occId,
          organization_id: orgId,
          template_id: sched.id,
          scheduled_period_key: periodKey,
          scheduled_date: payDate,
          amount: amt,
          currency: sched.currency || 'USD',
          status: 'pending_approval',
          source: 'scheduler',
          notes: `Awaiting approval for recurring period ${periodKey}`,
        });

        if (!occErr) {
          stats.processed++;
          stats.queuedForApproval++;
          // Notify org admins/owners
          try {
            const { data: approvers } = await sb
              .from('organization_members')
              .select('user_id')
              .eq('organization_id', orgId)
              .eq('status', 'active')
              .in('role', ['owner', 'admin', 'accountant']);
            for (const app of approvers || []) {
              if (!app.user_id) continue;
              await sb.from('notifications').insert({
                id: `notif-rec-app-${sched.id}-${periodKey}-${String(app.user_id).slice(0, 6)}`,
                organization_id: orgId,
                user_id: app.user_id,
                title: 'Recurring Transaction Awaiting Approval',
                message: `"${sched.description}" (${sched.currency || 'USD'} ${amt.toLocaleString()}) for ${payDate} requires approval before posting.`,
                type: 'warning',
                action_url: '/dashboard?view=recurring',
                is_read: false,
                created_at: new Date().toISOString(),
              });
            }
          } catch {
            // Non-fatal notification failure
          }
        }
        continue;
      }

      // Auto-post safe occurrence (idempotent transaction ID)
      const txnId = `txn-rec-${sched.id}-${payDate}`;
      const { data: orgRow } = await sb
        .from('organizations')
        .select('currency, base_currency')
        .eq('id', orgId)
        .maybeSingle();
      const baseCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      const txnCurrency = String(sched.currency || baseCurrency).toUpperCase();
      const fxRate = txnCurrency === baseCurrency ? 1 : getEstimatedFxRate(txnCurrency, baseCurrency);
      const baseAmount = Math.round(amt * fxRate * 100) / 100;

      const { data: insertedTxn, error: txnErr } = await sb
        .from('transactions')
        .upsert(
          {
            id: txnId,
            organization_id: orgId,
            bank_account_id: sched.bank_account_id,
            date: payDate,
            description: sched.description,
            narration: `Recurring: ${sched.description} | Pay Date: ${payDate} | Generated: ${todayIso}`,
            amount: amt,
            currency: txnCurrency,
            type: sched.type,
            status: 'classified',
            category_id: sched.category_id,
            department_id: sched.department_id,
            project_id: sched.project_id,
            tags: ['recurring', `schedule:${sched.id}`, sched.world_scope || 'business'],
            source: 'recurring',
            original_amount: amt,
            original_currency: txnCurrency,
            fx_rate_to_base: fxRate,
            base_currency: baseCurrency,
            base_amount: baseAmount,
            world_scope: sched.world_scope || 'business',
            created_at: new Date().toISOString(),
          },
          { onConflict: 'id', ignoreDuplicates: true },
        )
        .select()
        .maybeSingle();

      if (txnErr) {
        console.warn(`[recurringWorker] Transaction upsert failed for ${sched.id}:`, txnErr.message);
        stats.skipped++;
        continue;
      }

      const jeRes = await postTransactionToJournal(sb, {
        id: txnId,
        organization_id: orgId,
        bank_account_id: sched.bank_account_id,
        category_id: sched.category_id,
        department_id: sched.department_id,
        project_id: sched.project_id,
        date: payDate,
        amount: amt,
        base_amount: baseAmount,
        currency: txnCurrency,
        type: sched.type,
        description: sched.description,
        world_scope: sched.world_scope || 'business',
      });

      await sb.from('recurring_occurrences').upsert(
        {
          id: occId,
          organization_id: orgId,
          template_id: sched.id,
          scheduled_period_key: periodKey,
          scheduled_date: payDate,
          amount: amt,
          currency: txnCurrency,
          status: 'posted',
          transaction_id: insertedTxn?.id || txnId,
          journal_entry_id: jeRes.journalEntryId || null,
          source: 'scheduler',
          posted_at: new Date().toISOString(),
        },
        { onConflict: 'template_id,scheduled_period_key', ignoreDuplicates: true },
      );

      await sb
        .from('recurring_transactions')
        .update({
          next_occurrence: nextOccurrence,
          generated_occurrence_count: genCount + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sched.id)
        .eq('organization_id', orgId);

      stats.processed++;
      stats.posted++;
    }
  } catch (err) {
    console.warn('[recurringWorker] Tick error:', err);
  }

  return stats;
}

export function startRecurringWorker(intervalMs: number = 60 * 60 * 1000): void {
  if (isRunning) return;
  isRunning = true;
  console.log(`[recurringWorker] Starting recurring scheduler worker (interval ${Math.round(intervalMs / 60000)}m)`);

  // Initial check 15s after startup so DB pool warms cleanly
  setTimeout(() => {
    void runRecurringSchedulerTick();
  }, 15_000);

  schedulerTimer = setInterval(() => {
    void runRecurringSchedulerTick();
  }, intervalMs);
}

export function stopRecurringWorker(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  isRunning = false;
}
