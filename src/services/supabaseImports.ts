/**
 * Supabase-backed Import Statements Service
 * Handles bank statement imports with real-time duplicate detection and balance updates
 */

import { getSupabaseClient } from '@/lib/supabaseClient';
import type { ImportHistoryRecord } from './types';

export interface ImportRow {
  date: string;
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  usage?: 'personal' | 'business';
  importCategoryId?: string;
  isDuplicate?: boolean;
  projectId?: string;
}

export interface ImportSummary {
  totalIncome: number;
  totalExpenses: number;
  netAmount: number;
  autoClassified: number;
  needsReview: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
  summary: ImportSummary;
  historyId?: string;
}

export interface DuplicateCheckResult {
  rowIndex: number;
  isDuplicate: boolean;
  existingTxnId: string | null;
}

/**
 * Check for duplicate transactions before import
 */
export async function checkDuplicates(
  organizationId: string,
  bankAccountId: string,
  rows: ImportRow[],
): Promise<DuplicateCheckResult[]> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase client not initialized');
  }

  try {
    const { data, error } = await sb.rpc('import_find_duplicates', {
      p_org_id: organizationId,
      p_bank_account_id: bankAccountId,
      p_rows: rows,
    });

    if (error) {
      console.error('Duplicate check error:', error);
      throw new Error(`Duplicate check failed: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      rowIndex: row.row_index,
      isDuplicate: row.is_duplicate,
      existingTxnId: row.existing_txn_id,
    }));
  } catch (err) {
    console.error('Error checking duplicates:', err);
    throw err;
  }
}

/**
 * Check if an import has already been processed (idempotency check)
 */
export async function checkImportIdempotency(
  organizationId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase client not initialized');
  }

  try {
    const { data, error } = await sb.rpc('import_check_idempotency', {
      p_org_id: organizationId,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error('Idempotency check error:', error);
      return false;
    }

    return data === true;
  } catch (err) {
    console.error('Error checking idempotency:', err);
    return false;
  }
}

/**
 * Commit parsed import transactions to the database
 */
export async function commitImport(
  organizationId: string,
  bankAccountId: string,
  currency: string,
  fileName: string,
  rows: ImportRow[],
  idempotencyKey: string,
  skipDuplicates: boolean = true,
  autoClassify: boolean = true,
): Promise<ImportResult> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase client not initialized');
  }

  try {
    // Check idempotency first
    const alreadyImported = await checkImportIdempotency(organizationId, idempotencyKey);
    if (alreadyImported) {
      throw new Error('This exact statement was already imported. Please refresh to see the latest data.');
    }

    const { data, error } = await sb.rpc('import_commit', {
      p_org_id: organizationId,
      p_bank_account_id: bankAccountId,
      p_currency: currency,
      p_file_name: fileName,
      p_rows: rows,
      p_idempotency_key: idempotencyKey,
      p_skip_duplicates: skipDuplicates,
      p_auto_classify: autoClassify,
    });

    if (error) {
      console.error('Import commit error:', error);
      
      // Handle specific error codes
      if (error.code === '23505') {
        throw new Error('This statement was already imported');
      } else if (error.code === '42704') {
        throw new Error('Bank account not found in this organization');
      } else if (error.code === '22000') {
        throw new Error(error.message || 'Currency mismatch error');
      }
      
      throw new Error(`Import failed: ${error.message}`);
    }

    return data as ImportResult;
  } catch (err: any) {
    console.error('Error committing import:', err);
    throw err;
  }
}

/**
 * Get import history for an organization
 */
export async function getImportHistory(
  organizationId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<ImportHistoryRecord[]> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase client not initialized');
  }

  try {
    const { data, error } = await sb.rpc('import_get_history', {
      p_org_id: organizationId,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error('Get history error:', error);
      throw new Error(`Failed to fetch import history: ${error.message}`);
    }

    return (data || []).map((record: any) => ({
      id: record.id,
      organizationId: organizationId,
      fileName: record.file_name,
      importedAt: record.imported_at,
      transactionCount: record.transaction_count,
      status: record.status,
      accountName: record.account_name,
      autoPlaced: record.auto_placed,
      needsReview: record.needs_review,
      duplicatesFound: record.duplicates_found,
      fileType: record.file_name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv',
    }));
  } catch (err) {
    console.error('Error fetching import history:', err);
    throw err;
  }
}

/**
 * Delete an import history record
 */
export async function deleteImportHistory(
  organizationId: string,
  importId: string,
): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase client not initialized');
  }

  try {
    const { data, error } = await sb.rpc('import_delete_history', {
      p_org_id: organizationId,
      p_import_id: importId,
    });

    if (error) {
      console.error('Delete history error:', error);
      throw new Error(`Failed to delete import record: ${error.message}`);
    }

    return data === true;
  } catch (err) {
    console.error('Error deleting import history:', err);
    throw err;
  }
}

/**
 * Subscribe to import history changes (real-time)
 */
export function subscribeToImportHistory(
  organizationId: string,
  callback: (records: ImportHistoryRecord[]) => void,
) {
  const sb = getSupabaseClient();
  if (!sb) {
    console.error('Supabase client not initialized');
    return () => {};
  }

  const channel = sb
    .channel('import-history-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'import_history_records',
        filter: `organization_id=eq.${organizationId}`,
      },
      async () => {
        // Refetch data when changes occur
        try {
          const records = await getImportHistory(organizationId);
          callback(records);
        } catch (err) {
          console.error('Error refetching import history:', err);
        }
      },
    )
    .subscribe();

  // Return cleanup function
  return () => {
    sb.removeChannel(channel);
  };
}

/**
 * Subscribe to transaction changes for a specific bank account (real-time balance updates)
 */
export function subscribeToTransactions(
  organizationId: string,
  bankAccountId: string,
  callback: () => void,
) {
  const sb = getSupabaseClient();
  if (!sb) {
    console.error('Supabase client not initialized');
    return () => {};
  }

  const channel = sb
    .channel(`transactions-${bankAccountId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `organization_id=eq.${organizationId}`,
      },
      (payload) => {
        // Only trigger callback if the change is for the selected bank account
        const record = payload.new as any;
        if (record && record.bank_account_id === bankAccountId) {
          callback();
        }
      },
    )
    .subscribe();

  // Return cleanup function
  return () => {
    sb.removeChannel(channel);
  };
}

/**
 * Generate idempotency key for import
 */
export function generateImportIdempotencyKey(
  fileName: string,
  bankAccountId: string,
  rowCount: number,
  firstDate: string,
): string {
  const data = `${fileName}|${bankAccountId}|${rowCount}|${firstDate}`;
  // Simple hash function for deterministic key generation
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `import-${Math.abs(hash)}-${Date.now()}`;
}
