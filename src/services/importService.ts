/**
 * Statement Import Service
 * =========================
 * Handles multi-currency bank statement imports with format detection,
 * column mapping, duplicate detection, and auto-classification.
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore`.
 */

import { Transaction } from '@/services/types';
import type { ImportedTransaction } from '@/lib/importUtils';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { isSupabaseConfigured, getSupabaseClient } from '@/lib/supabaseClient';
import { logUnexpectedError } from '@/lib/diagnostics';
import { dataStore, generateId, simulateDelay } from './dataStore';
import { classificationService } from './classificationService';
import { mapDomainToDbTransaction, ensureSupabaseDependencies } from './transactionService';
import { recomputeBankAccountBalance } from './accountService';
import type { ServiceResponse, ImportPreview, ImportResult, ImportHistoryRecord } from './types';

const IMP = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/imports`;

const STORAGE_KEY_PREFIX = 'finance_os_import_file_';

function readLocalFileMeta(id: string): { fileSize?: number; fileContent?: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as { fileSize?: number; fileContent?: string }) : null;
  } catch {
    return null;
  }
}

function normalizeHistoryRecord(
  row: ImportHistoryRecord | Record<string, unknown>,
  organizationId: string,
): ImportHistoryRecord {
  const r = row as Record<string, unknown>;
  const id = String(r.id ?? '');
  const fileName = String(r.fileName ?? r.file_name ?? 'statement.csv');
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const localMeta = readLocalFileMeta(id);
  const fileTypeRaw = r.fileType ?? r.file_type;
  const fileType: 'csv' | 'pdf' =
    fileTypeRaw === 'pdf' || fileTypeRaw === 'csv'
      ? fileTypeRaw
      : isPdf
        ? 'pdf'
        : 'csv';

  return {
    id,
    organizationId: String(r.organizationId ?? r.organization_id ?? organizationId),
    fileName,
    importedAt: String(r.importedAt ?? r.imported_at ?? new Date().toISOString()),
    transactionCount: Number(r.transactionCount ?? r.transaction_count ?? 0),
    status: String(r.status ?? 'completed'),
    accountName: String(r.accountName ?? r.account_name ?? 'Bank Account'),
    autoPlaced: Number(r.autoPlaced ?? r.auto_placed ?? 0),
    needsReview: Number(r.needsReview ?? r.needs_review ?? 0),
    duplicatesFound: Number(r.duplicatesFound ?? r.duplicates_found ?? 0),
    fileType,
    fileUrl: (r.fileUrl ?? r.file_url) ? String(r.fileUrl ?? r.file_url) : undefined,
    filePath: (r.filePath ?? r.file_path) ? String(r.filePath ?? r.file_path) : undefined,
    fileSize: Number(r.fileSize ?? r.file_size ?? localMeta?.fileSize ?? 0) || localMeta?.fileSize,
    fileContent: localMeta?.fileContent,
    bankAccountId: (r.bankAccountId ?? r.bank_account_id)
      ? String(r.bankAccountId ?? r.bank_account_id)
      : undefined,
  };
}

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export const importService = {
  /**
   * Parse and preview a bank statement file (multipart upload when HTTP).
   */
  async previewFile(organizationId: string, file: File): Promise<ServiceResponse<ImportPreview>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ImportPreview>(organizationId);
      if (err) return err;
      const form = new FormData();
      form.append('file', file);
      return apiRequest<ImportPreview>(`${IMP(organizationId)}/preview`, {
        method: 'POST',
        body: form,
      });
    }

    await simulateDelay(800);

    const fileName = file.name;
    const isCSV = fileName.endsWith('.csv');

    return {
      success: true,
      data: {
        uploadId: generateId('upload'),
        fileName,
        totalRows: 247,
        columns: isCSV
          ? [
              { name: 'Date', type: 'date', sampleValues: ['2026-01-13', '2026-01-12', '2026-01-11'] },
              { name: 'Description', type: 'string', sampleValues: ['ACH CREDIT ACME CORP', 'ADOBE CREATIVE CLOUD', 'GOOGLE ADS'] },
              { name: 'Debit', type: 'number', sampleValues: ['', '79.99', '2850.00'] },
              { name: 'Credit', type: 'number', sampleValues: ['15000.00', '', ''] },
              { name: 'Balance', type: 'number', sampleValues: ['85000.00', '84920.01', '82070.01'] },
            ]
          : [
              { name: 'Transaction Date', type: 'date', sampleValues: ['13/01/2026', '12/01/2026'] },
              { name: 'Narration', type: 'string', sampleValues: ['Payment received', 'Monthly subscription'] },
              { name: 'Amount', type: 'number', sampleValues: ['15000.00', '-79.99'] },
            ],
        suggestedMapping: isCSV
          ? { date: 'Date', description: 'Description', amountOut: 'Debit', amountIn: 'Credit', balance: 'Balance' }
          : { date: 'Transaction Date', description: 'Narration', amount: 'Amount' },
        duplicatesDetected: 3,
      },
    };
  },

  async executeImport(
    organizationId: string,
    uploadId: string,
    bankAccountId: string,
    columnMapping: Record<string, string>,
    options: {
      skipDuplicates?: boolean;
      autoClassify?: boolean;
      currency?: string;
    } = {},
  ): Promise<ServiceResponse<ImportResult>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ImportResult>(organizationId);
      if (err) return err;
      return apiPostJson<
        {
          uploadId: string;
          bankAccountId: string;
          columnMapping: Record<string, string>;
          skipDuplicates?: boolean;
          autoClassify?: boolean;
          currency?: string;
        },
        ImportResult
      >(`${IMP(organizationId)}/execute`, {
        uploadId,
        bankAccountId,
        columnMapping,
        skipDuplicates: options.skipDuplicates,
        autoClassify: options.autoClassify,
        currency: options.currency,
      });
    }

    await simulateDelay(2000);

    const { skipDuplicates = true, autoClassify = true, currency = 'USD' } = options;

    const mockImportedTxns: Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>[] = [
      {
        bankAccountId,
        date: '2026-01-14',
        description: 'DEPOSIT - NEW CLIENT ONBOARDING',
        narration: 'Onboarding fee from new client StartupXYZ',
        amount: 8500,
        currency,
        type: 'credit',
        status: 'pending',
        tags: ['imported'],
        attachments: [],
      },
      {
        bankAccountId,
        date: '2026-01-14',
        description: 'SLACK TECHNOLOGIES',
        narration: 'Monthly Slack Business+ subscription',
        amount: -12.50,
        currency,
        type: 'debit',
        status: 'pending',
        tags: ['imported'],
        attachments: [],
      },
      {
        bankAccountId,
        date: '2026-01-13',
        description: 'UBER FOR BUSINESS',
        narration: 'Team transportation for client meeting',
        amount: -45.80,
        currency,
        type: 'debit',
        status: 'pending',
        tags: ['imported'],
        attachments: [],
      },
    ];

    let autoClassified = 0;
    let needsReview = 0;

    if (autoClassify) {
      for (const txn of mockImportedTxns) {
        const classResult = await classificationService.classify(
          organizationId,
          txn.narration,
          txn.amount,
          txn.type,
        );
        if (classResult.success && classResult.data.confidence >= 60) {
          txn.categoryId = classResult.data.categoryId;
          txn.status = 'classified';
          txn.confidence = classResult.data.confidence;
          txn.classifiedBy = 'auto';
          txn.classifiedAt = new Date().toISOString();
          autoClassified++;
        } else {
          needsReview++;
        }
      }
    } else {
      needsReview = mockImportedTxns.length;
    }

    const imported: Transaction[] = [];
    for (const txn of mockImportedTxns) {
      const newTxn: Transaction = {
        ...txn,
        id: generateId('txn'),
        organizationId,
        createdAt: new Date().toISOString(),
      };
      dataStore.transactions.unshift(newTxn);
      imported.push(newTxn);
    }

    dataStore.notify('transactions');

    const totalIncome = imported.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = imported.filter(t => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0);

    return {
      success: true,
      data: {
        imported: imported.length,
        skipped: skipDuplicates ? 3 : 0,
        duplicates: 3,
        errors: [],
        summary: {
          totalIncome,
          totalExpenses,
          netAmount: totalIncome - totalExpenses,
          autoClassified,
          needsReview,
        },
      },
      message: `${imported.length} transactions imported successfully`,
    };
  },

  /**
   * Commit rows parsed client-side (CSV mapping/review) into the ledger.
   * Directly persists into Supabase database (transactions + import_history_records).
   */
  async commitParsedImport(
    organizationId: string,
    bankAccountId: string,
    currency: string,
    fileName: string,
    rows: ImportedTransaction[],
    options: {
      skipDuplicates?: boolean;
      autoClassify?: boolean;
      fileSize?: number;
      fileContent?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<ServiceResponse<ImportResult>> {
    const err = requireOrg<ImportResult>(organizationId);
    if (err) return err;

    const { skipDuplicates = true, autoClassify = true, idempotencyKey } = options;
    const safeName = fileName.slice(0, 80) || 'statement.csv';

    // Generate idempotency key if not provided
    const importKey = idempotencyKey || `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Use HTTP backend if configured (RECOMMENDED - uses service role)
    if (isHttpBackendConfigured()) {
      try {
        // Detect file type from filename
        const fileType: 'csv' | 'pdf' = safeName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv';
        
        // Explicitly structure the payload to avoid any scoping issues
        const payload = {
          bankAccountId: bankAccountId,
          currency: currency,
          fileName: fileName,
          rows: rows,
          skipDuplicates: skipDuplicates,
          autoClassify: autoClassify,
          idempotencyKey: importKey,
          fileContent: options.fileContent,
          fileType: fileType,
        };
        
        console.log('=== HTTP PAYLOAD DEBUG [' + new Date().toISOString() + '] ===');
        console.log('Function parameters received:');
        console.log('  organizationId:', organizationId);
        console.log('  bankAccountId:', bankAccountId);
        console.log('  currency:', currency);
        console.log('  fileName:', fileName);
        console.log('  rows.length:', rows.length);
        console.log('  rows[0]:', rows[0]);
        console.log('  fileContent:', options.fileContent ? `${options.fileContent.length} chars` : 'not provided');
        console.log('  fileType:', fileType);
        console.log('Constructing payload object...');
        console.log('Payload being sent:', { ...payload, fileContent: payload.fileContent ? `[${payload.fileContent.length} chars]` : undefined });
        console.log('============================================');
        
        const result = await apiPostJson<
          {
            bankAccountId: string;
            currency: string;
            fileName: string;
            rows: ImportedTransaction[];
            skipDuplicates?: boolean;
            autoClassify?: boolean;
            idempotencyKey?: string;
            fileContent?: string;
            fileType?: 'csv' | 'pdf';
          },
          ImportResult
        >(`${IMP(organizationId)}/commit-parsed`, payload);

        if (result.success) {
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');
          dataStore.notify('importHistory');
          dataStore.notify('accounts');
        }

        return result;
      } catch (err: any) {
        logUnexpectedError('importService.commitParsedImport.http', err);
        return {
          success: false,
          data: {
            imported: 0,
            skipped: 0,
            duplicates: 0,
            errors: [err.message || 'Failed to commit import'],
            summary: {
              totalIncome: 0,
              totalExpenses: 0,
              netAmount: 0,
              autoClassified: 0,
              needsReview: 0,
            },
          },
          error: err.message || 'Failed to commit import',
        };
      }
    }

    // For Supabase direct, use RPC function (fallback)
    if (isSupabaseConfigured() && organizationId.trim()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          // Call the import_commit RPC function
          const { data, error } = await sb.rpc('import_commit', {
            p_org_id: organizationId,
            p_bank_account_id: bankAccountId,
            p_currency: currency,
            p_file_name: safeName,
            p_rows: rows,
            p_idempotency_key: importKey,
            p_skip_duplicates: skipDuplicates,
            p_auto_classify: autoClassify,
          });

          if (error) {
            console.error('Import commit error:', error);
            
            // Handle specific error codes
            if (error.code === '23505' || error.message?.includes('already imported')) {
              return {
                success: false,
                data: {
                  imported: 0,
                  skipped: 0,
                  duplicates: 0,
                  errors: [{ row: 0, error: 'This exact statement was already imported' }],
                  summary: {
                    totalIncome: 0,
                    totalExpenses: 0,
                    netAmount: 0,
                    autoClassified: 0,
                    needsReview: 0,
                  },
                },
                error: 'This exact statement was already imported',
              };
            } else if (error.code === '42704' || error.message?.includes('not found')) {
              return {
                success: false,
                data: {
                  imported: 0,
                  skipped: 0,
                  duplicates: 0,
                  errors: [{ row: 0, error: 'Bank account not found in this organization' }],
                  summary: {
                    totalIncome: 0,
                    totalExpenses: 0,
                    netAmount: 0,
                    autoClassified: 0,
                    needsReview: 0,
                  },
                },
                error: 'Bank account not found in this organization',
              };
            } else if (error.code === '22000' || error.message?.includes('currency')) {
              return {
                success: false,
                data: {
                  imported: 0,
                  skipped: 0,
                  duplicates: 0,
                  errors: [{ row: 0, error: error.message || 'Currency mismatch' }],
                  summary: {
                    totalIncome: 0,
                    totalExpenses: 0,
                    netAmount: 0,
                    autoClassified: 0,
                    needsReview: 0,
                  },
                },
                error: error.message || 'Currency mismatch',
              };
            }
            
            return {
              success: false,
              data: {
                imported: 0,
                skipped: 0,
                duplicates: 0,
                errors: [{ row: 0, error: error.message || 'Import failed' }],
                summary: {
                  totalIncome: 0,
                  totalExpenses: 0,
                  netAmount: 0,
                  autoClassified: 0,
                  needsReview: 0,
                },
              },
              error: error.message || 'Import failed',
            };
          }

          // Notify all real-time listeners across UI components
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');
          dataStore.notify('importHistory');
          dataStore.notify('accounts');

          return {
            success: true,
            data: data as ImportResult,
            message: `${data.imported} transactions imported successfully`,
          };
        } catch (err: any) {
          console.error('Error committing import:', err);
          return {
            success: false,
            data: {
              imported: 0,
              skipped: 0,
              duplicates: 0,
              errors: [err.message || 'Failed to commit import'],
              summary: {
                totalIncome: 0,
                totalExpenses: 0,
                netAmount: 0,
                autoClassified: 0,
                needsReview: 0,
              },
            },
            error: err.message || 'Failed to commit import',
          };
        }
      }
    }

    // Local fallback logic (legacy - not recommended for production)
    const isPdf = fileName.toLowerCase().endsWith('.pdf');
    const tagFile = `import:${safeName}`;

    const toImport = rows.filter(r => !(skipDuplicates && r.isDuplicate));

    if (toImport.length === 0) {
      return {
        success: false,
        data: {
          imported: 0,
          skipped: rows.length,
          duplicates: rows.filter(r => r.isDuplicate).length,
          errors: [],
          summary: {
            totalIncome: 0,
            totalExpenses: 0,
            netAmount: 0,
            autoClassified: 0,
            needsReview: 0,
          },
        },
        error: 'No rows to import. Try turning off “Hide duplicates” or fix your column mapping.',
      };
    }

    let autoClassified = 0;
    let needsReview = 0;
    const imported: Transaction[] = [];

    for (const row of toImport) {
      const signedAmount = row.type === 'credit' ? row.amount : -row.amount;
      const tags = ['imported', tagFile] as string[];
      if (row.usage === 'personal') tags.push('personal');
      if (row.usage === 'business') tags.push('business');

      const base: Omit<Transaction, 'id' | 'organizationId' | 'createdAt'> = {
        bankAccountId,
        date: row.date,
        description: (row.narration || 'Imported').slice(0, 120),
        narration: row.narration || 'Imported',
        amount: signedAmount,
        currency,
        type: row.type,
        status: 'pending',
        tags,
        attachments: [],
        ...(row.projectId ? { projectId: row.projectId } : {}),
      };

      if (row.importCategoryId) {
        base.categoryId = row.importCategoryId;
        base.status = 'classified';
        base.classifiedBy = 'user';
        base.classifiedAt = new Date().toISOString();
        autoClassified++;
      } else if (autoClassify) {
        const classResult = await classificationService.classify(
          organizationId,
          row.narration,
          row.amount,
          row.type,
        );
        if (classResult.success && classResult.data.confidence >= 60) {
          base.categoryId = classResult.data.categoryId;
          base.status = 'classified';
          base.confidence = classResult.data.confidence;
          base.classifiedBy = 'auto';
          base.classifiedAt = new Date().toISOString();
          autoClassified++;
        } else {
          needsReview++;
        }
      } else {
        needsReview++;
      }

      const newTxn: Transaction = {
        ...base,
        id: generateId('txn'),
        organizationId,
        createdAt: new Date().toISOString(),
      };
      dataStore.transactions.unshift(newTxn);
      imported.push(newTxn);
    }

    const bankAccount = dataStore.bankAccounts.find(a => a.id === bankAccountId);
    const importId = generateId('import');
    const accountDisplay = bankAccount?.bankName
      ? `${bankAccount.bankName} (${bankAccount.currency || currency})`
      : 'Bank Account';
    const dupCount = rows.filter(r => r.isDuplicate).length;

    const historyRecord: ImportHistoryRecord = {
      id: importId,
      organizationId,
      fileName,
      importedAt: new Date().toISOString(),
      transactionCount: imported.length,
      status: 'completed',
      accountName: accountDisplay,
      autoPlaced: autoClassified,
      needsReview,
      duplicatesFound: dupCount,
      fileType: isPdf ? 'pdf' : 'csv',
      fileSize: options.fileSize,
      fileContent: options.fileContent,
      bankAccountId,
    };

    // ── Supabase direct sync ──────────────────────────────────────────
    if (isSupabaseConfigured() && organizationId.trim()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          // 0. Ensure Organization & Bank Account exist in Supabase
          await ensureSupabaseDependencies(organizationId, bankAccountId);

          // Ensure any referenced categories exist in Supabase
          const uniqueCategoryIds = Array.from(
            new Set(imported.map(t => t.categoryId).filter((c): c is string => Boolean(c)))
          );
          for (const catId of uniqueCategoryIds) {
            await ensureSupabaseDependencies(organizationId, undefined, catId);
          }

          // 1. Insert imported transactions in chunks
          const dbTxns = imported.map(mapDomainToDbTransaction);
          const chunkSize = 50;
          for (let i = 0; i < dbTxns.length; i += chunkSize) {
            const chunk = dbTxns.slice(i, i + chunkSize);
            const { error: txnErr } = await sb.from('transactions').upsert(chunk, { onConflict: 'id' });
            if (txnErr) {
              logUnexpectedError('importService.commitParsedImport.transactions', txnErr);
              // Fallback: If foreign key on category failed, retry with category_id = null
              const fallbackChunk = chunk.map(c => ({ ...c, category_id: null }));
              await sb.from('transactions').upsert(fallbackChunk, { onConflict: 'id' });
            }
          }

          // 2. Insert into import_history_records
          const dbHistoryPayload: Record<string, unknown> = {
            id: importId,
            organization_id: organizationId,
            file_name: fileName,
            imported_at: historyRecord.importedAt,
            transaction_count: historyRecord.transactionCount,
            status: historyRecord.status,
            account_name: historyRecord.accountName,
            auto_placed: historyRecord.autoPlaced,
            needs_review: historyRecord.needsReview,
            duplicates_found: historyRecord.duplicatesFound,
          };
          const { error: histErr } = await sb.from('import_history_records').upsert(dbHistoryPayload, { onConflict: 'id' });
          if (histErr) {
            logUnexpectedError('importService.commitParsedImport.import_history_records', histErr);
          }

          // 3. Accurately recompute live bank account balance in Supabase
          await recomputeBankAccountBalance(organizationId, bankAccountId);
        } catch (err) {
          logUnexpectedError('importService.commitParsedImport.supabase', err);
        }
      }
    } else if (isHttpBackendConfigured()) {
      try {
        await apiPostJson<
          {
            bankAccountId: string;
            currency: string;
            fileName: string;
            rows: ImportedTransaction[];
            skipDuplicates?: boolean;
            autoClassify?: boolean;
            fileSize?: number;
            fileContent?: string;
          },
          ImportResult
        >(`${IMP(organizationId)}/commit-parsed`, {
          bankAccountId,
          currency,
          fileName,
          rows,
          skipDuplicates: options.skipDuplicates,
          autoClassify: options.autoClassify,
          fileSize: options.fileSize,
          fileContent: options.fileContent,
        });
      } catch (err) {
        logUnexpectedError('importService.commitParsedImport.http', err);
      }
    }

    // Persist file content locally for preview/download if provided
    if (options.fileContent && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${importId}`, JSON.stringify({
          id: importId,
          fileName,
          fileContent: options.fileContent,
          fileType: isPdf ? 'pdf' : 'csv',
          fileSize: options.fileSize,
        }));
      } catch {
        /* ignore localStorage quota */
      }
    }

    // Notify all real-time listeners across UI components
    dataStore.notify('transactions');
    dataStore.notify('bankAccounts');
    dataStore.notify('importHistory');
    dataStore.notify('accounts');

    const totalIncome = imported.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = imported
      .filter(t => t.type === 'debit')
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    return {
      success: true,
      data: {
        imported: imported.length,
        skipped: rows.length - toImport.length,
        duplicates: dupCount,
        errors: [],
        summary: {
          totalIncome,
          totalExpenses,
          netAmount: totalIncome - totalExpenses,
          autoClassified,
          needsReview,
        },
      },
      message: `${imported.length} transactions imported and saved to database`,
    };
  },

  async getHistory(organizationId: string): Promise<ServiceResponse<ImportHistoryRecord[]>> {
    if (!organizationId || !organizationId.trim()) {
      return { success: false, data: [], error: 'organizationId required' };
    }

    // Writes already go through the Express service-role API. Reads must use the
    // same path: a browser anon-key SELECT is RLS-filtered to [] even when
    // import_history_records rows exist (Table Editor uses the postgres role).
    if (isHttpBackendConfigured()) {
      const httpRes = await apiGet<ImportHistoryRecord[]>(`${IMP(organizationId)}/history`);
      if (httpRes.success && Array.isArray(httpRes.data)) {
        return { success: true, data: httpRes.data.map(row => normalizeHistoryRecord(row, organizationId)) };
      }
      if (!httpRes.success) {
        logUnexpectedError('importService.getHistory.http', httpRes.error);
      }
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb
            .from('import_history_records')
            .select('*')
            .eq('organization_id', organizationId)
            .order('imported_at', { ascending: false });

          if (error) {
            logUnexpectedError('importService.getHistory.supabase', error);
          } else if (Array.isArray(data)) {
            return {
              success: true,
              data: data.map((row: Record<string, unknown>) =>
                normalizeHistoryRecord(row, organizationId),
              ),
            };
          }
        } catch (err) {
          logUnexpectedError('importService.getHistory.supabase', err);
        }
      }
    }

    return { success: true, data: [] };
  },

  async deleteHistory(organizationId: string, id: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      try {
        await apiRequest<null>(`${IMP(organizationId)}/history/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      } catch (err) {
        logUnexpectedError('importService.deleteHistory.http', err);
      }
    } else if (isSupabaseConfigured() && organizationId.trim()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          await sb
            .from('import_history_records')
            .delete()
            .eq('id', id)
            .eq('organization_id', organizationId);
        } catch (err) {
          logUnexpectedError('importService.deleteHistory.supabase', err);
        }
      }
    }

    // 3. Remove from localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${id}`);
      } catch {
        /* ignore */
      }
    }

    dataStore.notify('transactions');
    dataStore.notify('importHistory');
    return { success: true, data: null, message: 'Statement record deleted' };
  },
};
