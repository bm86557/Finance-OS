/**
 * Recurring Transaction Service
 * ==============================
 * CRUD for recurring/scheduled transactions.
 * 
 * IMPORTANT: Recurring schedules are TEMPLATES, not active transactions.
 * They do NOT affect bank balances until transactions are generated.
 * 
 * Workflow:
 * 1. User creates recurring schedule via UI → POST /recurring-transactions
 * 2. Schedule saved to `recurring_transactions` table in Supabase
 * 3. User clicks "Generate Due" or cron job runs daily → POST /recurring-transactions/generate
 * 4. `recurring_generate_due()` SQL function creates rows in `transactions` table
 * 5. Trigger `trg_update_bank_balance` fires on INSERT → updates `bank_accounts.balance`
 * 6. Bank balance reflects the generated transaction
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore`.
 */

import { RecurringTransaction } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const REC = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/recurring-transactions`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

/** Returns an error message if next occurrence is before start, or null if valid. */
export function validateRecurringDateOrder(startDate: string, nextOccurrence: string): string | null {
  const s = startDate.trim().slice(0, 10);
  const n = nextOccurrence.trim().slice(0, 10);
  if (!ISO_DATE.test(s) || !ISO_DATE.test(n)) {
    return 'Use valid start and next dates.';
  }
  if (n < s) {
    return 'Next occurrence must be on or after the start date.';
  }
  return null;
}

export const recurringTransactionService = {
  async getAll(organizationId: string): Promise<ServiceResponse<RecurringTransaction[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<RecurringTransaction[]>(organizationId);
      if (err) return err;
      return apiGet<RecurringTransaction[]>(REC(organizationId));
    }

    await simulateDelay();
    return { success: true, data: dataStore.recurringTransactions.filter(r => r.organizationId === organizationId) };
  },

  async create(
    organizationId: string,
    data: Omit<RecurringTransaction, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<RecurringTransaction>> {
    const dateErr = validateRecurringDateOrder(data.startDate, data.nextOccurrence);
    if (dateErr) {
      return { success: false, data: null as any, error: dateErr };
    }

    if (isHttpBackendConfigured()) {
      const err = requireOrg<RecurringTransaction>(organizationId);
      if (err) return err;
      const result = await apiPostJson<Omit<RecurringTransaction, 'id' | 'organizationId'>, RecurringTransaction>(
        REC(organizationId),
        data,
      );
      if (result.success) {
        dataStore.notify('recurringTransactions');
      }
      return result;
    }

    await simulateDelay(200);
    const item: RecurringTransaction = { ...data, id: generateId('rec'), organizationId };
    dataStore.recurringTransactions.push(item);
    dataStore.notify('recurringTransactions');
    return { success: true, data: item, message: 'Recurring transaction created' };
  },

  async update(
    id: string,
    updates: Partial<RecurringTransaction>,
    organizationId?: string,
  ): Promise<ServiceResponse<RecurringTransaction>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${REC(organizationId)}/${encodeURIComponent(id)}`
        : `/recurring-transactions/${encodeURIComponent(id)}`;
      const result = await apiRequest<RecurringTransaction>(path, { method: 'PATCH', body: JSON.stringify(updates) });
      if (result.success) {
        dataStore.notify('recurringTransactions');
      }
      return result;
    }

    await simulateDelay(150);
    const idx = dataStore.recurringTransactions.findIndex(r => r.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Not found' };
    const merged: RecurringTransaction = { ...dataStore.recurringTransactions[idx], ...updates };
    const dateErr = validateRecurringDateOrder(merged.startDate, merged.nextOccurrence);
    if (dateErr) {
      return { success: false, data: null as any, error: dateErr };
    }
    dataStore.recurringTransactions[idx] = merged;
    dataStore.notify('recurringTransactions');
    return { success: true, data: dataStore.recurringTransactions[idx] };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${REC(organizationId)}/${encodeURIComponent(id)}`
        : `/recurring-transactions/${encodeURIComponent(id)}`;
      const result = await apiRequest<null>(path, { method: 'DELETE' });
      if (result.success) {
        dataStore.notify('recurringTransactions');
      }
      return result;
    }

    await simulateDelay(150);
    const idx = dataStore.recurringTransactions.findIndex(r => r.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Not found' };
    dataStore.recurringTransactions.splice(idx, 1);
    dataStore.notify('recurringTransactions');
    return { success: true, data: null, message: 'Deleted' };
  },

  async toggle(id: string, organizationId?: string): Promise<ServiceResponse<RecurringTransaction>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${REC(organizationId)}/${encodeURIComponent(id)}/toggle`
        : `/recurring-transactions/${encodeURIComponent(id)}/toggle`;
      const result = await apiRequest<RecurringTransaction>(path, { method: 'POST', body: '{}' });
      if (result.success) {
        dataStore.notify('recurringTransactions');
      }
      return result;
    }

    await simulateDelay(100);
    const idx = dataStore.recurringTransactions.findIndex(r => r.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Not found' };
    dataStore.recurringTransactions[idx].isActive = !dataStore.recurringTransactions[idx].isActive;
    dataStore.notify('recurringTransactions');
    return { success: true, data: dataStore.recurringTransactions[idx] };
  },

  async generate(organizationId: string, asOfDate?: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiPostJson<{ asOfDate?: string }, any>(
        `${REC(organizationId)}/generate`,
        { asOfDate: asOfDate || new Date().toISOString().split('T')[0] },
      );
    }
    
    // Local dataStore mode: not implemented (requires SQL logic)
    return { success: false, data: null as any, error: 'Generation only works with Supabase backend' };
  },

  async generateSingle(recurringId: string, organizationId?: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${REC(organizationId)}/${encodeURIComponent(recurringId)}/generate`
        : `/recurring-transactions/${encodeURIComponent(recurringId)}/generate`;
      const result = await apiRequest<any>(path, { method: 'POST', body: '{}' });
      if (result.success) {
        dataStore.notify('recurringTransactions');
        dataStore.notify('transactions');
      }
      return result;
    }
    
    // Local dataStore mode: not implemented (requires SQL logic)
    return { success: false, data: null as any, error: 'Generation only works with Supabase backend' };
  },

  async getTotals(organizationId: string): Promise<ServiceResponse<{
    active: number;
    monthlyIncome: number;
    monthlyExpense: number;
    dueSoon: number;
    overdue: number;
    byCurrency: Record<string, number>;
  }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${REC(organizationId)}/totals`);
    }
    
    // Local dataStore mode: calculate manually (simplified, no normalization)
    await simulateDelay();
    const all = dataStore.recurringTransactions.filter(r => r.organizationId === organizationId);
    const active = all.filter(r => r.isActive).length;
    return { 
      success: true, 
      data: { 
        active, 
        monthlyIncome: 0, 
        monthlyExpense: 0, 
        dueSoon: 0, 
        overdue: 0, 
        byCurrency: {} 
      } 
    };
  },
};
