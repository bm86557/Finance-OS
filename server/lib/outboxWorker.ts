/**
 * Transactional Outbox Worker (§19).
 * Background processor with lease locks, retries, and dead-letter handling.
 */

import { getSupabaseAdminClient } from './supabaseAdmin.js';
import {
  claimPendingOutboxEvents,
  completeOutboxEvent,
  failOutboxEvent,
} from './outboxService.js';

const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

async function processEvent(sb: any, event: any): Promise<void> {
  console.log(`[outboxWorker] Processing event ${event.event_type} (${event.id}) for org ${event.organization_id}`);

  switch (event.event_type) {
    case 'transaction.posted':
    case 'transaction.reversed':
      // Downstream triggers: cache invalidation, profit refresh
      break;

    case 'invoice.issued':
    case 'invoice.paid':
      // Downstream triggers: accounts receivable refresh
      break;

    case 'import.review.completed':
    case 'import.row.posted':
      // Downstream triggers: batch completion notification
      break;

    default:
      // General durable event logged
      break;
  }
}

export async function runOutboxWorkerTick(): Promise<number> {
  const sb = getSupabaseAdminClient();
  if (!sb) return 0;

  try {
    const events = await claimPendingOutboxEvents(sb, WORKER_ID, 10, 30000);
    if (!events || events.length === 0) return 0;

    for (const evt of events) {
      try {
        await processEvent(sb, evt);
        await completeOutboxEvent(sb, evt.id);
      } catch (err: any) {
        console.error(`[outboxWorker] Failed to process event ${evt.id}:`, err);
        await failOutboxEvent(sb, evt.id, err?.message || String(err), evt.retry_count || 0, evt.max_retries || 5);
      }
    }

    return events.length;
  } catch (err) {
    console.error('[outboxWorker] Error during worker tick:', err);
    return 0;
  }
}

export function startOutboxWorker(pollIntervalMs: number = 10000): void {
  if (isRunning) return;
  isRunning = true;
  console.log(`[outboxWorker] Starting outbox background worker (${WORKER_ID}) polling every ${pollIntervalMs}ms`);

  pollTimer = setInterval(async () => {
    try {
      await runOutboxWorkerTick();
    } catch (err) {
      console.warn('[outboxWorker] Poll cycle error:', err);
    }
  }, pollIntervalMs);
}

export function stopOutboxWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  console.log(`[outboxWorker] Outbox worker (${WORKER_ID}) stopped`);
}

