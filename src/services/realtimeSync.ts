/**
 * Realtime Synchronization Service
 * =================================
 * Listens for postgres_changes across Supabase tables (transactions, bank_accounts,
 * import_history_records, accounts) and triggers dataStore.notify() so that all
 * React components using useService / useServiceArray re-render automatically
 * with fresh data in real-time without requiring a page refresh.
 * 
 * IMPORTANT: Realtime must be enabled in Supabase Dashboard → Database → Replication
 * for the following tables: transactions, bank_accounts, import_history_records, accounts
 * 
 * NOTE: This service fails silently when Supabase is not configured. The app works
 * perfectly fine without real-time sync - data still updates on manual refresh.
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore } from './dataStore';

let activeChannel: RealtimeChannel | null = null;
let currentOrgId: string | null = null;
let subscriptionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;

export function setupSupabaseRealtimeSync(organizationId?: string): void {
  // Skip entirely if Supabase is not configured
  if (!isSupabaseConfigured()) {
    return; // Silent skip - no logs needed
  }
  
  const sb = getSupabaseClient();
  if (!sb) {
    return; // Silent skip
  }

  const targetOrg = organizationId?.trim() || null;
  
  // Don't recreate if already subscribed to same org
  if (activeChannel && currentOrgId === targetOrg) {
    return; // Already subscribed
  }

  // Clean up existing channel before creating new one
  if (activeChannel) {
    try {
      sb.removeChannel(activeChannel);
    } catch (err) {
      // Silent cleanup failure
    }
    activeChannel = null;
  }

  currentOrgId = targetOrg;
  const channelName = targetOrg ? `org_realtime_${targetOrg}_${Date.now()}` : 'finance_os_global_realtime';

  try {
    activeChannel = sb
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');
          dataStore.notify('accounts');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bank_accounts',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('bankAccounts');
          dataStore.notify('accounts');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'import_history_records',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('importHistory');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'accounts',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('accounts');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loans',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('loans');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loan_payments',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('loans');
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'categories',
          ...(targetOrg ? { filter: `organization_id=eq.${targetOrg}` } : {}),
        },
        (payload) => {
          dataStore.notify('categories');
          dataStore.notify('transactions');
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          subscriptionAttempts = 0;
          // Trigger initial refresh
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');
          dataStore.notify('importHistory');
          dataStore.notify('accounts');
          dataStore.notify('loans');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscriptionAttempts++;
          // Silent fail - realtime is optional, app works without it
          if (subscriptionAttempts >= MAX_RETRY_ATTEMPTS) {
            // Clean up after max retries
            if (activeChannel) {
              try {
                sb.removeChannel(activeChannel);
              } catch {}
              activeChannel = null;
            }
          }
        }
        // Don't log anything - keeps console clean
      });
  } catch (err) {
    // Silent failure - realtime is optional
    activeChannel = null;
  }
}

export function teardownSupabaseRealtimeSync(): void {
  if (activeChannel) {
    const sb = getSupabaseClient();
    if (sb) {
      try {
        sb.removeChannel(activeChannel);
      } catch (err) {
        // Silent cleanup
      }
    }
    activeChannel = null;
    currentOrgId = null;
  }
}

// Get current subscription status
export function getRealtimeStatus(): { connected: boolean; channelName: string | null } {
  return {
    connected: activeChannel?.state === 'joined',
    channelName: currentOrgId ? `org_realtime_${currentOrgId}` : null,
  };
}
