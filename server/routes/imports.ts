/**
 * §16 — Statement import (Supabase-backed). Mounted at `/organizations/:organizationId/imports` (mergeParams).
 * All endpoints now use Supabase RPC functions for proper duplicate detection, idempotency, and real-time updates.
 */

import { Router, type Request, type Response } from 'express';
import { ok, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { postTransactionToJournal } from '../lib/ledgerService.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { recomputeServerBankBalance } from './transactions.js';
import { detectAndIssuePayslipsForTransactions } from '../lib/aiPayrollDetector.js';
import { detectRiskFlags } from '../../src/lib/classificationEngine.js';
import { getGlobalPlatformSettings } from './platformSettings.js';

interface ImportedRow {
  date: string;
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  usage?: 'personal' | 'business';
  importCategoryId?: string;
  isDuplicate?: boolean;
  projectId?: string;
}

const STATEMENTS_BUCKET = 'statements';
const SIGNED_URL_TTL_SEC = 60 * 60;

type HistoryRow = Record<string, unknown>;

function mapHistoryRow(orgId: string, record: HistoryRow) {
  const fileName = String(record.file_name ?? record.fileName ?? 'statement.csv');
  return {
    id: String(record.id ?? ''),
    organizationId: orgId,
    fileName,
    importedAt: String(record.imported_at ?? record.importedAt ?? new Date().toISOString()),
    transactionCount: Number(record.transaction_count ?? record.transactionCount ?? 0),
    status: String(record.status ?? 'completed'),
    accountName: String(record.account_name ?? record.accountName ?? 'Bank Account'),
    autoPlaced: Number(record.auto_placed ?? record.autoPlaced ?? 0),
    needsReview: Number(record.needs_review ?? record.needsReview ?? 0),
    duplicatesFound: Number(record.duplicates_found ?? record.duplicatesFound ?? 0),
    fileType:
      record.file_type ||
      record.fileType ||
      (fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv'),
    fileUrl: (record.file_url ?? record.fileUrl) as string | null | undefined,
    filePath: (record.file_path ?? record.filePath) as string | null | undefined,
    fileSize: record.file_size ?? record.fileSize ?? null,
  };
}

async function attachStorageFiles(
  sb: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  orgId: string,
  records: ReturnType<typeof mapHistoryRow>[],
) {
  const storageByName = new Map<string, { path: string; size?: number }>();
  try {
    const { data: objects, error } = await sb.storage.from(STATEMENTS_BUCKET).list(orgId, {
      limit: 200,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (!error && Array.isArray(objects)) {
      for (const obj of objects) {
        if (!obj?.name) continue;
        storageByName.set(obj.name.toLowerCase(), {
          path: `${orgId}/${obj.name}`,
          size: typeof obj.metadata?.size === 'number' ? obj.metadata.size : undefined,
        });
      }
    }
  } catch (err) {
    console.warn('Could not list statement files in storage:', err);
  }

  const enriched = await Promise.all(
    records.map(async record => {
      let filePath = record.filePath || null;
      if (!filePath) {
        const safeName = record.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
        const match = [...storageByName.values()].find(item =>
          item.path.toLowerCase().includes(safeName) || item.path.toLowerCase().endsWith(record.fileName.toLowerCase()),
        );
        if (match) {
          filePath = match.path;
          if (!record.fileSize && match.size) record.fileSize = match.size;
        }
      }

      if (!filePath) return record;

      try {
        const { data: signed, error: signErr } = await sb.storage
          .from(STATEMENTS_BUCKET)
          .createSignedUrl(filePath, SIGNED_URL_TTL_SEC);
        if (!signErr && signed?.signedUrl) {
          return { ...record, filePath, fileUrl: signed.signedUrl };
        }
      } catch (err) {
        console.warn('Could not sign statement URL:', filePath, err);
      }

      return { ...record, filePath };
    }),
  );

  return enriched;
}

export function createImportsRouter(): Router {
  const r = Router({ mergeParams: true });

  // Check for duplicate transactions before import
  r.post('/check-duplicates', async (req: Request, res: Response) => {
    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    const { bankAccountId, rows } = req.body as { bankAccountId: string; rows: ImportedRow[] };

    if (!bankAccountId || !rows || !Array.isArray(rows)) {
      return fail(res, 400, 'Missing required fields: bankAccountId and rows');
    }

    try {
      const sb = getSupabaseAdminClient();
      if (!sb) {
        return fail(res, 500, 'Supabase not configured');
      }
      const { data, error } = await sb.rpc('import_find_duplicates', {
        p_org_id: orgId,
        p_bank_account_id: bankAccountId,
        p_rows: rows,
      });

      if (error) {
        console.error('Duplicate check error:', error);
        return fail(res, 500, `Duplicate check failed: ${error.message}`);
      }

      ok(res, data || []);
    } catch (err: any) {
      console.error('Error checking duplicates:', err);
      return fail(res, 500, err.message || 'Failed to check duplicates');
    }
  });

  r.post('/commit-parsed', async (req: Request, res: Response) => {
    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    
    const {
      bankAccountId, currency, fileName, rows, skipDuplicates = true, autoClassify = true, idempotencyKey,
      fileContent, fileType,
    } = req.body as {
      bankAccountId: string; currency: string; fileName: string; rows: ImportedRow[];
      skipDuplicates?: boolean; autoClassify?: boolean; idempotencyKey?: string;
      fileContent?: string; fileType?: 'csv' | 'pdf';
    };

    if (!bankAccountId || !currency || !fileName || !rows || !Array.isArray(rows)) {
      console.error('Missing fields:', { bankAccountId, currency, fileName, rowsIsArray: Array.isArray(rows) });
      return fail(res, 400, 'Missing required fields: bankAccountId, currency, fileName, rows');
    }

    if (!idempotencyKey) {
      return fail(res, 400, 'Missing idempotency key');
    }

    const safeName = fileName.slice(0, 80) || 'statement.csv';
    const detectedFileType = fileType || (safeName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv');

    if (rows.length === 0) {
      return fail(res, 400, 'No rows to import');
    }

    try {
      const sb = getSupabaseAdminClient();
      if (!sb) {
        return fail(res, 500, 'Supabase not configured');
      }

      // Slice 2: Fetch and verify target bank account (§10, §17, §33 #6, #8)
      const { data: bankRow, error: bankErr } = await sb
        .from('bank_accounts')
        .select('id, currency, bank_name, account_name, account_number, iban')
        .eq('id', bankAccountId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (bankErr || !bankRow) {
        return fail(res, 404, 'Selected bank account not found in this organization');
      }

      const targetCurr = String(bankRow.currency || 'USD').toUpperCase().trim();
      const statementCurr = String(currency || '').toUpperCase().trim();
      if (targetCurr !== statementCurr) {
        return fail(
          res,
          400,
          `CURRENCY_MISMATCH: Selected account (${bankRow.bank_name || bankRow.account_name}) operates in ${targetCurr}, but statement is in ${statementCurr}. Cannot import across different currencies.`
        );
      }

      const statementAccountHint = (req.body as any)?.statementAccountHint;
      const confirmAccountMismatch = Boolean((req.body as any)?.confirmAccountMismatch);
      if (statementAccountHint && !confirmAccountMismatch) {
        const hintClean = String(statementAccountHint).replace(/[^a-zA-Z0-9]/g, '');
        const acctClean = String(bankRow.account_number || '').replace(/[^a-zA-Z0-9]/g, '');
        const ibanClean = String(bankRow.iban || '').replace(/[^a-zA-Z0-9]/g, '');

        if (hintClean.length >= 4 && (acctClean.length >= 4 || ibanClean.length >= 4)) {
          const matchAcct = acctClean.length >= 4 && (hintClean.endsWith(acctClean.slice(-4)) || acctClean.endsWith(hintClean.slice(-4)));
          const matchIban = ibanClean.length >= 4 && (hintClean.endsWith(ibanClean.slice(-4)) || ibanClean.endsWith(hintClean.slice(-4)));

          if (!matchAcct && !matchIban) {
            return fail(
              res,
              409,
              `ACCOUNT_MISMATCH: The statement appears to be for account ending in ...${hintClean.slice(-4)}, but the selected account is ${bankRow.bank_name || bankRow.account_name} (...${(acctClean || ibanClean).slice(-4)}). If you are sure, re-submit with confirmAccountMismatch.`
            );
          }
        }
      }

      // Upload file to Supabase storage if fileContent is provided
      let fileUrl: string | null = null;
      let filePath: string | null = null;
      let fileSize: number | null = null;

      if (fileContent) {
        try {
          // Generate storage path: statements/{org_id}/{timestamp}_{filename}
          const timestamp = Date.now();
          const sanitizedFileName = safeName.replace(/[^a-zA-Z0-9._-]/g, '_');
          filePath = `${orgId}/${timestamp}_${sanitizedFileName}`;

          // Convert base64 to buffer if needed
          const fileBuffer = fileContent.startsWith('data:')
            ? Buffer.from(fileContent.split(',')[1], 'base64')
            : Buffer.from(fileContent, 'utf-8');

          fileSize = fileBuffer.length;

          // Upload to storage
          const { data: uploadData, error: uploadError } = await sb.storage
            .from('statements')
            .upload(filePath, fileBuffer, {
              contentType: detectedFileType === 'pdf' ? 'application/pdf' : 'text/csv',
              upsert: false,
            });

          if (uploadError) {
            console.warn('File upload warning (continuing with import):', uploadError);
            // Continue with import even if file upload fails
          } else {
            // Get public URL
            const { data: urlData } = sb.storage
              .from('statements')
              .getPublicUrl(filePath);

            fileUrl = urlData.publicUrl;
            console.log('File uploaded successfully:', filePath);
          }
        } catch (uploadErr) {
          console.warn('File upload error (continuing with import):', uploadErr);
          // Continue with import even if file upload fails
        }
      }
      
      // Ensure all rows have importCategoryId set so none are left uncategorized in DB
      let finalRows = rows.map(r => ({
        ...r,
        importCategoryId: r.importCategoryId || (r as any).categoryId || (r as any).category_id || '',
      }));

      // If autoClassify is requested and some rows lack importCategoryId, auto-assign from categories
      const missingCatRows = finalRows.filter(r => !r.importCategoryId);
      if (missingCatRows.length > 0) {
        try {
          const { data: catRows } = await sb
            .from('categories')
            .select('id, name, type')
            .eq('organization_id', orgId);

          if (catRows && catRows.length > 0) {
            finalRows = finalRows.map(r => {
              if (r.importCategoryId) return r;
              const expectedType = r.type === 'credit' ? 'income' : 'expense';
              const typeCats = catRows.filter((c: any) => c.type === expectedType);
              const fallback = typeCats.find((c: any) => 
                c.name.toLowerCase().includes('general') || 
                c.name.toLowerCase().includes('operating') ||
                c.name.toLowerCase().includes('other')
              ) || typeCats[0] || catRows[0];
              return {
                ...r,
                importCategoryId: fallback ? fallback.id : '',
              };
            });
          }
        } catch (catErr) {
          console.warn('[imports] Failed to fetch fallback categories:', catErr);
        }
      }

      // Call the import_commit RPC function
      const { data, error } = await sb.rpc('import_commit', {
        p_org_id: orgId,
        p_bank_account_id: bankAccountId,
        p_currency: currency,
        p_file_name: safeName,
        p_rows: finalRows,
        p_idempotency_key: idempotencyKey,
        p_skip_duplicates: skipDuplicates,
        p_auto_classify: autoClassify,
        p_file_url: fileUrl,
        p_file_path: filePath,
        p_file_size: fileSize,
        p_file_type: detectedFileType,
      });

      if (error) {
        console.error('Import commit error:', error);
        
        // Handle specific error codes
        if (error.code === '23505' || error.message?.includes('already imported')) {
          return fail(res, 409, 'This exact statement was already imported');
        } else if (error.code === '42704' || error.message?.includes('not found')) {
          return fail(res, 404, 'Bank account not found in this organization');
        } else if (error.code === '22000' || error.message?.includes('currency')) {
          return fail(res, 400, error.message || 'Currency mismatch');
        }
        
        return fail(res, 500, `Import failed: ${error.message}`);
      }

      // Post-import: Apply pre-classified categories from the batch classification
      // The frontend already ran batchClassify with AI before import and set importCategoryId on each row
      if (data) {
        try {
          // Get the newly imported transactions
          const { data: newTxns, error: fetchErr } = await sb
            .from('transactions')
            .select('id, description, narration, status, category_id')
            .eq('organization_id', orgId)
            .eq('bank_account_id', bankAccountId)
            .is('category_id', null)
            .order('created_at', { ascending: false })
            .limit(rows.length + 5);

          if (!fetchErr && newTxns && newTxns.length > 0) {
            let classified = 0;

            // Match newly inserted transactions to rows by narration/description
            for (const row of rows) {
              if (!row.importCategoryId) continue;

              // Find the matching transaction (by narration match)
              const matchedTxn = newTxns.find(t => {
                const txnDesc = (t.narration || t.description || '').toLowerCase().trim();
                const rowDesc = (row.narration || '').toLowerCase().trim();
                return txnDesc === rowDesc && !t.category_id;
              });

              if (matchedTxn) {
                const { error: updateErr } = await sb
                  .from('transactions')
                  .update({
                    category_id: row.importCategoryId,
                    status: 'classified',
                    classified_by: 'auto',
                    classified_at: new Date().toISOString(),
                    confidence: 85,
                  })
                  .eq('id', matchedTxn.id);

                if (!updateErr) {
                  matchedTxn.category_id = row.importCategoryId; // Mark as done
                  classified++;
                }
              }
            }

            // For any remaining unclassified transactions, try rule-based + AI batch classification
            const stillPending = newTxns.filter(t => !t.category_id);
            if (stillPending.length > 0 && autoClassify) {
              try {
                // Load categories and rules from Supabase
                const { data: cats } = await sb
                  .from('categories')
                  .select('id, name, type, patterns')
                  .eq('organization_id', orgId);

                const { data: rules } = await sb
                  .from('classification_rules')
                  .select('*')
                  .eq('organization_id', orgId)
                  .eq('is_active', true);

                if (cats && cats.length > 0) {
                  // Try AI batch classification for remaining
                  const { classifyBatchWithAI } = await import('../lib/aiClient.js');
                  const { getDefaultAIConfig } = await import('../config/aiConfig.js');
                  const aiConfig = getDefaultAIConfig();
                  if (aiConfig) {
                    (aiConfig as any).organizationId = orgId;
                  }

                  if (aiConfig) {
                    try {
                      const batchInput = stillPending.map(t => ({
                        narration: t.narration || t.description || '',
                        amount: 0,
                        type: 'debit' as const,
                      }));

                      const aiBatchMap = await classifyBatchWithAI(
                        {
                          transactions: batchInput,
                          availableCategories: cats.map(c => ({
                            id: c.id,
                            name: c.name,
                            type: c.type,
                          })),
                        },
                        aiConfig
                      );

                      let aiIdx = 0;
                      for (const txn of stillPending) {
                        const aiResult = aiBatchMap.get(aiIdx);
                        if (aiResult) {
                          const cat = cats.find(c =>
                            c.name.toLowerCase() === aiResult.suggestedCategory.toLowerCase()
                          );
                          if (cat) {
                            const riskFlags = detectRiskFlags(
                              txn.narration || txn.description || '',
                              Number((txn as any).amount || 0),
                              (txn as any).type || 'debit'
                            );
                            const canAutoApprove = aiResult.confidence >= 80 && riskFlags.length === 0;

                            if (canAutoApprove) {
                              await sb.from('transactions').update({
                                category_id: cat.id,
                                status: 'classified',
                                classified_by: 'auto',
                                classified_at: new Date().toISOString(),
                                confidence: aiResult.confidence,
                              }).eq('id', txn.id);
                              classified++;
                            } else {
                              // Queue for Review per Handoff v1.2 §11 (Never auto-approve with risks or medium/low confidence)
                              await sb.from('transactions').update({
                                suggested_category_id: cat.id,
                                status: 'pending',
                                confidence: aiResult.confidence,
                                risk_flags: riskFlags,
                              }).eq('id', txn.id);
                            }
                          }
                        }
                        aiIdx++;
                      }
                    } catch (aiErr) {
                      console.warn('[import] AI batch classification failed for remaining txns:', aiErr);
                      
                      // Fallback: simple keyword matching from category patterns
                      for (const txn of stillPending) {
                        const desc = (txn.narration || txn.description || '').toLowerCase();
                        for (const cat of cats) {
                          const patterns = Array.isArray(cat.patterns) ? cat.patterns : [];
                          const matched = patterns.some((p: string) => desc.includes(p.toLowerCase()));
                          if (matched) {
                            await sb.from('transactions').update({
                              category_id: cat.id,
                              status: 'classified',
                              classified_by: 'auto',
                              classified_at: new Date().toISOString(),
                              confidence: 75,
                            }).eq('id', txn.id);
                            classified++;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              } catch (classErr) {
                console.warn('[import] Post-import classification error:', classErr);
              }
            }

            if (classified > 0) {
              console.log(`[import] Auto-classified ${classified}/${newTxns.length} imported transactions`);
              // Update the response data
              if (data.summary) {
                data.summary.autoClassified = classified;
                data.summary.needsReview = Math.max(0, newTxns.length - classified);
              }
            }
          }
        } catch (classifyErr) {
          console.warn('[import] Post-import classification error (non-fatal):', classifyErr);
        }
      }

      // ── Post-Commit Operations (Slice 1: Scoped to this batch only, §10, §33 #2, #7) ──
      try {
        const batchId = data?.import_id || data?.batch_id || idempotencyKey;
        const { data: batchRows } = await sb
          .from('transactions')
          .select('*')
          .eq('organization_id', orgId)
          .eq('source_import_id', batchId)
          .is('journal_entry_id', null);

        if (batchRows && batchRows.length > 0) {
          for (const txn of batchRows) {
            const narr = (txn.narration || txn.description || '').toLowerCase();
            const isAtm = /\b(atm|cash wdl|cash withdrawal|atm w\/d)\b/i.test(narr);

            // Per §33 #2: A bank debit without confirmed destination must be a pending transfer, keeping type='debit'
            if (isAtm && !txn.is_transfer && txn.type === 'debit') {
              const transferGroupId = `trg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              const existingTags = Array.isArray(txn.tags) ? txn.tags : [];
              await sb.from('transactions').update({
                is_transfer: true,
                transfer_group_id: transferGroupId,
                tags: Array.from(new Set([...existingTags, 'transfer', 'atm-withdrawal', 'pending-transfer'])),
              }).eq('id', txn.id);
            }

            // Post classified transactions to General Ledger (§10, idempotent via ledgerService)
            if (txn.status === 'classified' || txn.category_id) {
              void postTransactionToJournal(sb, {
                id: txn.id,
                organization_id: orgId,
                bank_account_id: txn.bank_account_id,
                category_id: txn.category_id,
                department_id: txn.department_id,
                project_id: txn.project_id,
                date: txn.date,
                amount: txn.amount,
                base_amount: txn.base_amount ?? txn.amount,
                currency: txn.currency,
                type: txn.type,
                description: txn.description || txn.narration,
                world_scope: txn.world_scope || 'business',
              }, (req as any).authUser?.id);
            }
          }
        }
      } catch (postCommitErr) {
        console.warn('[imports] Post-commit ledger/ATM processing error:', postCommitErr);
      }

      // §13 & §11: Automated AI Payroll & Salary Detection from Statement Ingestion
      try {
        const batchId = (data as any)?.import_id || (data as any)?.batch_id || idempotencyKey;
        const { data: allBatchTxns } = await sb
          .from('transactions')
          .select('*')
          .eq('organization_id', orgId)
          .eq('source_import_id', batchId);

        if (allBatchTxns && allBatchTxns.length > 0) {
          const detectionRes = await detectAndIssuePayslipsForTransactions(sb, orgId, allBatchTxns);
          if (detectionRes.autoIssuedCount > 0) {
            console.log(`[imports] Auto-issued ${detectionRes.autoIssuedCount} payslip(s) for org ${orgId}`);
          }
        }
      } catch (payrollErr) {
        console.warn('[imports] Automated payroll detection error:', payrollErr);
      }

      // Recompute bank account balance
      void recomputeServerBankBalance(orgId, bankAccountId);

      // Log batch import commit audit event (§33)
      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'commit_statement_import',
        entityType: 'import_batch',
        entityId: (data as any)?.import_id || (data as any)?.batch_id || idempotencyKey,
        description: `Committed statement import: ${safeName} (${(data as any)?.inserted_count ?? (data as any)?.imported ?? rows.length} transactions)`,
        afterState: data,
      });

      ok(res, data, `${data.imported ?? (data as any)?.inserted_count ?? rows.length} transactions imported successfully`);
    } catch (err: any) {
      console.error('Error committing import:', err);
      return fail(res, 500, err.message || 'Failed to commit import');
    }
  });

  r.get('/history', async (req: Request, res: Response) => {
    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
      const sb = getSupabaseAdminClient();
      if (!sb) {
        return fail(res, 500, 'Supabase not configured');
      }

      const platformSettings = await getGlobalPlatformSettings();
      const retentionDays = platformSettings.retention_policies.statement_files_retention_days || 365;
      const statementCutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();

      // Service-role table read — do not depend on RLS or import_get_history RPC.
      let historyQuery = sb
        .from('import_history_records')
        .select('*')
        .eq('organization_id', orgId);

      if (platformSettings.retention_policies.auto_delete_expired_data && req.query.includeExpired !== 'true') {
        historyQuery = historyQuery.gte('imported_at', statementCutoff);
      }

      const { data, error } = await historyQuery
        .order('imported_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Get history error:', error);
        return fail(res, 500, `Failed to fetch import history: ${error.message}`);
      }

      const records = await attachStorageFiles(
        sb,
        orgId,
        (data || []).map((record: HistoryRow) => mapHistoryRow(orgId, record)),
      );

      ok(res, records);
    } catch (err: any) {
      console.error('Error fetching import history:', err);
      return fail(res, 500, err.message || 'Failed to fetch import history');
    }
  });

  r.get('/history/:id/file', async (req: Request, res: Response) => {
    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');

    try {
      const sb = getSupabaseAdminClient();
      if (!sb) {
        return fail(res, 500, 'Supabase not configured');
      }

      const { data, error } = await sb
        .from('import_history_records')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (error) {
        return fail(res, 500, error.message);
      }
      if (!data) {
        return fail(res, 404, 'Import record not found');
      }

      const [enriched] = await attachStorageFiles(sb, orgId, [mapHistoryRow(orgId, data as HistoryRow)]);
      if (!enriched.fileUrl) {
        return fail(res, 404, 'Original statement file is not in storage');
      }

      ok(res, { url: enriched.fileUrl, fileName: enriched.fileName, filePath: enriched.filePath });
    } catch (err: any) {
      console.error('Error signing import file:', err);
      return fail(res, 500, err.message || 'Failed to fetch statement file');
    }
  });

  r.delete('/history/:id', async (req: Request, res: Response) => {
    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');
    
    if (!id) {
      return fail(res, 400, 'Import ID is required');
    }

    try {
      const sb = getSupabaseAdminClient();
      if (!sb) {
        return fail(res, 500, 'Supabase not configured');
      }
      const { data: existing } = await sb
        .from('import_history_records')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();

      const { data, error } = await sb
        .from('import_history_records')
        .delete()
        .eq('id', id)
        .eq('organization_id', orgId)
        .select('id');

      if (error) {
        console.error('Delete history error:', error);
        return fail(res, 500, `Failed to delete import record: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return fail(res, 404, 'Import record not found');
      }

      const filePath = (existing as HistoryRow | null)?.file_path;
      if (typeof filePath === 'string' && filePath) {
        await sb.storage.from(STATEMENTS_BUCKET).remove([filePath]);
      }

      ok(res, null, 'Statement record deleted');
    } catch (err: any) {
      console.error('Error deleting import history:', err);
      return fail(res, 500, err.message || 'Failed to delete import record');
    }
  });

  return r;
}
