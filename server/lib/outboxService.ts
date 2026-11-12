/**
 * Transactional Outbox Service (§6, §19, §33 #7).
 * Provides atomic, reliable event emission and worker task leasing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OutboxEventPayload {
  organizationId: string;
  eventType:
    | 'statement.uploaded'
    | 'import.parsed'
    | 'import.classified'
    | 'import.review.completed'
    | 'import.row.posted'
    | 'transaction.posted'
    | 'transaction.reversed'
    | 'invoice.issued'
    | 'invoice.paid'
    | 'time.entry.approved'
    | 'time.entry.corrected'
    | 'salary.cost.version.changed'
    | 'allocation.run.completed'
    | 'profit.recalculation.requested'
    | 'approval.requested'
    | 'approval.decided'
    | 'reconciliation.completed'
    | 'report.export.ready'
    | 'rule.version.activated'
    | string;
  resourceType: string;
  resourceId: string;
  payload?: Record<string, any>;
}

export async function emitOutboxEvent(
  sb: SupabaseClient,
  event: OutboxEventPayload,
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const { data, error } = await sb
      .from('outbox_events')
      .insert({
        organization_id: event.organizationId,
        event_type: event.eventType,
        resource_type: event.resourceType,
        resource_id: event.resourceId,
        payload: event.payload || {},
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      // Non-fatal if table not yet migrated
      if (!error.message.includes('does not exist')) {
        console.warn('[outbox] Error emitting outbox event:', error.message);
      }
      return { success: false, error: error.message };
    }

    return { success: true, eventId: data?.id };
  } catch (err: any) {
    console.error('[outbox] Exception in emitOutboxEvent:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function claimPendingOutboxEvents(
  sb: SupabaseClient,
  workerId: string,
  batchSize: number = 10,
  leaseMs: number = 30000,
): Promise<any[]> {
  try {
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();

    // Query events that are pending or stalled past lease
    const { data: candidates, error } = await sb
      .from('outbox_events')
      .select('*')
      .or(`status.eq.pending,and(status.eq.processing,locked_until.lt.${now})`)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (error || !candidates || candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((c: any) => c.id);

    // Atomically claim the batch
    const { data: claimed, error: claimErr } = await sb
      .from('outbox_events')
      .update({
        status: 'processing',
        locked_by: workerId,
        locked_until: leaseUntil,
      })
      .in('id', ids)
      .select();

    if (claimErr) {
      console.warn('[outbox] Error claiming outbox batch:', claimErr.message);
      return [];
    }

    return claimed || [];
  } catch (err: any) {
    console.error('[outbox] Exception in claimPendingOutboxEvents:', err);
    return [];
  }
}

export async function completeOutboxEvent(
  sb: SupabaseClient,
  eventId: string,
): Promise<void> {
  await sb
    .from('outbox_events')
    .update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      locked_until: null,
      locked_by: null,
    })
    .eq('id', eventId);
}

export async function failOutboxEvent(
  sb: SupabaseClient,
  eventId: string,
  errorMessage: string,
  retryCount: number,
  maxRetries: number = 5,
): Promise<void> {
  const isDeadLetter = retryCount + 1 >= maxRetries;
  await sb
    .from('outbox_events')
    .update({
      status: isDeadLetter ? 'dead_letter' : 'pending',
      retry_count: retryCount + 1,
      error_message: errorMessage,
      locked_until: null,
      locked_by: null,
    })
    .eq('id', eventId);
}

