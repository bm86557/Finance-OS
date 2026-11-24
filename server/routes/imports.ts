/**
 * §16 — Statement import (Supabase-backed). Mounted at `/organizations/:organizationId/imports` (mergeParams).
 * All endpoints now use Supabase RPC functions for proper duplicate detection, idempotency, and real-time updates.
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { ok, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { postTransactionToJournal } from '../lib/ledgerService.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { recomputeServerBankBalance } from './transactions.js';
import { detectAndIssuePayslipsForTransactions } from '../lib/aiPayrollDetector.js';
import {
  classifyTransaction,
  detectRiskFlags,
  inferWorldScope,
  type ProposedNewCategory,
} from '../../src/lib/classificationEngine.js';
import { getGlobalPlatformSettings } from './platformSettings.js';
import { resolveOrgAIConfig } from '../lib/aiGateway.js';
import {
  findOrCreateCategoryForOrg,
  loadFullRules,
  loadTenantPolicy,
  loadOrgPersonalWorldEnabled,
  loadLearningPromptContext,
  recordClassificationEvidence,
  recordRuleMatchUsage,
} from '../services/learningEngineService.js';

interface ImportedRow {
  date: string;
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  usage?: 'personal' | 'business';
  worldScope?: 'personal' | 'business';
  importCategoryId?: string;
  suggestedCategoryId?: string;
  proposedNewCategory?: ProposedNewCategory | null;
  confidence?: number;
  classificationSource?: 'ai' | 'rules';
  classifiedBy?: string;
  needsReview?: boolean;
  riskFlags?: string[];
  reasoning?: string;
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

      // Enforce Plan Statements, Storage & Transactions Quotas (§32)
      const { checkOrgQuota } = await import('../services/planEntitlementService.js');
      const statementsQuota = await checkOrgQuota(sb, orgId, 'statements', 1);
      if (!statementsQuota.allowed) {
        return fail(res, 403, statementsQuota.reason || 'Monthly statement import quota reached.');
      }

      const estimatedMb = fileContent ? Math.ceil(Buffer.byteLength(fileContent, 'utf-8') / (1024 * 1024)) : 0;
      if (estimatedMb > 0) {
        const storageQuota = await checkOrgQuota(sb, orgId, 'storage', estimatedMb);
        if (!storageQuota.allowed) {
          return fail(res, 403, storageQuota.reason || 'Storage quota exceeded.');
        }
      }

      const txQuota = await checkOrgQuota(sb, orgId, 'transactions', rows.length);
      if (!txQuota.allowed) {
        return fail(res, 403, txQuota.reason || 'Monthly transaction quota exceeded.');
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
      
      // Resolve organization personal_world_enabled policy (§5)
      const personalWorldEnabled = await loadOrgPersonalWorldEnabled(sb, orgId);
      const actorUserId = (req as any).authUser?.id || null;

      // Normalize world_scope and auto-create any approved missing categories before commit (§5, §9, §11)
      const createdCatCache = new Map<string, string>();
      const categoriesCreatedOnImport: Array<{ id: string; name: string }> = [];

      const finalRows: ImportedRow[] = [];
      for (const r of rows) {
        const rawWorld = r.usage || r.worldScope;
        let resolvedWorld: 'business' | 'personal' =
          rawWorld === 'personal' ? 'personal' : (rawWorld === 'business' ? 'business' : inferWorldScope(r.narration, r.type, [], { personalWorldEnabled }).world);
        if (!personalWorldEnabled) {
          resolvedWorld = 'business';
        }

        let catId = r.importCategoryId || (r as any).categoryId || (r as any).category_id || '';
        if (!catId && r.proposedNewCategory?.name) {
          const cacheKey = `${r.proposedNewCategory.type}:${r.proposedNewCategory.name.toLowerCase()}`;
          if (createdCatCache.has(cacheKey)) {
            catId = createdCatCache.get(cacheKey)!;
          } else {
            try {
              const resCat = await findOrCreateCategoryForOrg(sb, orgId, {
                ...r.proposedNewCategory,
                world: resolvedWorld,
              }, actorUserId);
              catId = resCat.category.id;
              createdCatCache.set(cacheKey, catId);
              if (resCat.created) {
                categoriesCreatedOnImport.push({ id: resCat.category.id, name: resCat.category.name });
              }
            } catch (catErr) {
              console.warn('[imports] Failed to auto-create proposed category:', catErr);
            }
          }
        }

        const riskFlags = Array.isArray(r.riskFlags) ? r.riskFlags : [];
        const hasHardRisk = riskFlags.includes('RULE_CONFLICT') || riskFlags.includes('TRANSFER_CANDIDATE');
        const needsReview = Boolean(r.needsReview) || !catId || hasHardRisk;

        finalRows.push({
          ...r,
          usage: resolvedWorld,
          worldScope: resolvedWorld,
          importCategoryId: catId,
          suggestedCategoryId: r.suggestedCategoryId || catId || undefined,
          needsReview,
          riskFlags,
        });
      }

      // Call the import_commit RPC function (with handoff-compliant chunked server fallback if RPC fails on legacy DB)
      let data: any = null;
      const rpcRes = await sb.rpc('import_commit', {
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

      if (!rpcRes.error) {
        data = rpcRes.data;
      } else {
        const rpcErr = rpcRes.error;
        console.warn('[imports] import_commit RPC error, evaluating fallback:', rpcErr.code, rpcErr.message);

        // Hard business/validation errors should still return immediately
        if (rpcErr.code === '42704' || rpcErr.message?.includes('Bank account not found')) {
          return fail(res, 404, 'Bank account not found in this organization');
        }
        if (rpcErr.code === '22000' || rpcErr.message?.includes('mixing currencies')) {
          return fail(res, 400, rpcErr.message || 'Currency mismatch');
        }

        // Check if this batch was already completed (true idempotent replay)
        const { data: existingHistory } = await sb
          .from('import_history_records')
          .select('*')
          .eq('organization_id', orgId)
          .eq('id', idempotencyKey)
          .maybeSingle();

        if (existingHistory && existingHistory.status === 'completed') {
          return fail(res, 409, 'This exact statement was already imported');
        }

        // Handoff §10: Resumable, chunked, per-row idempotent commit using service_role
        const accountDisplayName = `${bankRow.bank_name || bankRow.account_name || 'Bank Account'} (${targetCurr})`;
        await sb.from('import_history_records').upsert({
          id: idempotencyKey,
          organization_id: orgId,
          file_name: safeName,
          imported_at: new Date().toISOString(),
          transaction_count: 0,
          status: 'processing',
          account_name: accountDisplayName,
          auto_placed: 0,
          needs_review: 0,
          duplicates_found: 0,
          file_url: fileUrl,
          file_path: filePath,
          file_size: fileSize,
          file_type: detectedFileType,
        }, { onConflict: 'id' });

        let importedCount = 0;
        let skippedCount = 0;
        let duplicateCount = 0;
        let autoClassifiedCount = 0;
        let needsReviewCount = 0;
        let totalIncome = 0;
        let totalExpenses = 0;
        const chunkErrors: string[] = [];

        const rowsToInsert: any[] = [];
        finalRows.forEach((row, idx) => {
          const isDup = Boolean((row as any).isDuplicate);
          if (isDup) {
            duplicateCount++;
            if (skipDuplicates) {
              skippedCount++;
              return;
            }
          }

          const absAmt = Math.abs(Number(row.amount || 0));
          const catId = row.importCategoryId ? String(row.importCategoryId).trim() : '';
          const projId = (row as any).projectId ? String((row as any).projectId).trim() : '';
          const isClassified = Boolean(catId) && !row.needsReview;
          const worldScope = (row.usage || row.worldScope) === 'personal' ? 'personal' : 'business';
          const tags = Array.from(new Set(['imported', `import:${safeName}`, worldScope]));
          const confidenceVal = typeof row.confidence === 'number' ? Math.min(100, Math.max(0, row.confidence)) : (isClassified ? 85 : null);
          const classifiedByVal = isClassified ? (row.classifiedBy || (row.classificationSource === 'ai' ? 'ai' : 'auto')) : null;

          if (isClassified) {
            autoClassifiedCount++;
          } else {
            needsReviewCount++;
          }

          if (row.type === 'credit') {
            totalIncome += absAmt;
          } else {
            totalExpenses += absAmt;
          }

          rowsToInsert.push({
            id: `txn-${crypto.randomUUID()}`,
            organization_id: orgId,
            bank_account_id: bankAccountId,
            date: row.date,
            description: String(row.narration || 'Imported').slice(0, 120),
            narration: String(row.narration || 'Imported'),
            amount: absAmt,
            currency: statementCurr,
            type: row.type === 'credit' ? 'credit' : 'debit',
            category_id: isClassified ? (catId || null) : null,
            suggested_category_id: row.suggestedCategoryId || catId || null,
            project_id: projId || null,
            world_scope: worldScope,
            status: isClassified ? 'classified' : 'pending',
            confidence: confidenceVal,
            risk_flags: Array.isArray(row.riskFlags) ? row.riskFlags : [],
            tags,
            attachments: [],
            idempotency_key: `${idempotencyKey}:row:${idx + 1}`,
            classified_at: isClassified ? new Date().toISOString() : null,
            classified_by: classifiedByVal,
            source_import_id: idempotencyKey,
          });
        });

        const CHUNK_SIZE = 100;
        for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
          const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
          const chunkKeys = chunk.map((r) => r.idempotency_key).filter(Boolean);

          // Avoid PostgREST partial-index ON CONFLICT 42P10 by checking existing keys first
          const { data: existingRows } = await sb
            .from('transactions')
            .select('idempotency_key')
            .eq('organization_id', orgId)
            .in('idempotency_key', chunkKeys);

          const existingKeySet = new Set((existingRows || []).map((r: any) => r.idempotency_key));
          const newChunk = chunk.filter((r) => !existingKeySet.has(r.idempotency_key));

          if (newChunk.length === 0) {
            continue;
          }

          const { data: insertedRows, error: insertErr } = await sb
            .from('transactions')
            .insert(newChunk)
            .select('id');

          if (insertErr) {
            console.error(`[imports] Fallback chunk ${Math.floor(i / CHUNK_SIZE) + 1} insert error:`, insertErr);
            chunkErrors.push(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${insertErr.message}`);
          } else {
            importedCount += insertedRows ? insertedRows.length : newChunk.length;
          }
        }

        const finalStatus = chunkErrors.length > 0
          ? (importedCount > 0 ? 'partially_committed' : 'failed')
          : 'completed';

        await sb
          .from('import_history_records')
          .update({
            transaction_count: importedCount,
            status: finalStatus,
            auto_placed: autoClassifiedCount,
            needs_review: needsReviewCount,
            duplicates_found: duplicateCount,
          })
          .eq('id', idempotencyKey)
          .eq('organization_id', orgId);

        if (finalStatus === 'failed') {
          return fail(res, 500, `Import failed: ${chunkErrors[0] || rpcErr.message}`);
        }

        data = {
          imported: importedCount,
          skipped: skippedCount,
          duplicates: duplicateCount,
          errors: chunkErrors,
          status: finalStatus,
          summary: {
            totalIncome,
            totalExpenses,
            netAmount: totalIncome - totalExpenses,
            autoClassified: autoClassifiedCount,
            needsReview: needsReviewCount,
          },
          historyId: idempotencyKey,
        };
      }

      const batchId = (data as any)?.historyId || (data as any)?.import_id || (data as any)?.batch_id || idempotencyKey;

      // Post-import: Apply pre-classified categories from the batch classification
      // The frontend already ran batchClassify with AI before import and set importCategoryId on each row
      if (data) {
        try {
          // Get the newly imported transactions scoped strictly to this batch
          const { data: newTxns, error: fetchErr } = await sb
            .from('transactions')
            .select('id, description, narration, amount, type, world_scope, tags, status, category_id')
            .eq('organization_id', orgId)
            .eq('bank_account_id', bankAccountId)
            .eq('source_import_id', batchId)
            .is('category_id', null)
            .order('created_at', { ascending: false })
            .limit(rows.length + 5);

          // Ensure personal world_scope column is synced even on legacy DBs before migration 0049
          try {
            const { data: personalTagged } = await sb
              .from('transactions')
              .select('id, tags, world_scope')
              .eq('organization_id', orgId)
              .eq('source_import_id', batchId);
            const personalIds = (personalTagged || [])
              .filter((t: any) => Array.isArray(t.tags) && t.tags.includes('personal') && t.world_scope !== 'personal')
              .map((t: any) => t.id);
            if (personalIds.length > 0) {
              await sb.from('transactions').update({ world_scope: 'personal' }).in('id', personalIds).eq('organization_id', orgId);
            }
          } catch {
            /* graceful if world_scope column missing */
          }

          if (!fetchErr && newTxns && newTxns.length > 0) {
            let classified = 0;

            // Only backfill rows that were ALREADY approved for auto-placement (!row.needsReview)
            // on legacy DBs before Migration 0049. NEVER overwrite needsReview=true rows into 'classified' (§10, §11)!
            for (const row of finalRows) {
              if (!row.importCategoryId || row.needsReview) continue;

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
                    world_scope: row.worldScope || row.usage || 'business',
                    status: 'classified',
                    classified_by: row.classifiedBy || (row.classificationSource === 'ai' ? 'ai' : 'auto'),
                    classified_at: new Date().toISOString(),
                    confidence: typeof row.confidence === 'number' ? row.confidence : 85,
                  })
                  .eq('id', matchedTxn.id);

                if (!updateErr) {
                  matchedTxn.category_id = row.importCategoryId;
                  classified++;
                }
              }
            }

            // Build lookup of narrations already explicitly flagged needsReview during import preview
            const explicitlyPendingNarrations = new Set(
              finalRows
                .filter(r => r.needsReview)
                .map(r => (r.narration || '').toLowerCase().trim())
            );

            // For genuinely uncategorized rows (not explicitly queued for manual review by preview),
            // run §11 rules-first cascade -> org-resolved AI gateway fallback using tenant policy
            const stillPending = newTxns.filter(t => {
              if (t.category_id) return false;
              const desc = (t.narration || t.description || '').toLowerCase().trim();
              if (explicitlyPendingNarrations.has(desc)) return false;
              return true;
            });

            if (stillPending.length > 0 && autoClassify) {
              try {
                const [{ data: cats }, fullRules, tenantPolicy, platformSettings] = await Promise.all([
                  sb.from('categories').select('id, name, type, patterns, account_id, color, icon').eq('organization_id', orgId),
                  loadFullRules(sb, orgId),
                  loadTenantPolicy(sb, orgId),
                  getGlobalPlatformSettings(),
                ]);

                if (cats && cats.length > 0) {
                  const domainCats = cats.map((c: any) => ({
                    id: String(c.id),
                    organizationId: orgId,
                    name: String(c.name),
                    type: c.type,
                    accountId: String(c.account_id || ''),
                    color: String(c.color || '#38bdf8'),
                    icon: String(c.icon || 'tag'),
                    patterns: Array.isArray(c.patterns) ? c.patterns : [],
                  }));

                  const needsAIForPost: any[] = [];
                  const matchedRuleIds: string[] = [];

                  // PHASE 1 (§11): Deterministic org rules & patterns FIRST
                  for (const txn of stillPending as any[]) {
                    const narr = txn.narration || txn.description || '';
                    const ruleRes = classifyTransaction(
                      narr,
                      Math.abs(Number(txn.amount || 0)),
                      txn.type === 'credit' ? 'credit' : 'debit',
                      domainCats,
                      [],
                      fullRules,
                      {
                        organizationId: orgId,
                        accountId: bankAccountId,
                        world: txn.world_scope === 'personal' ? 'personal' : 'business',
                        personalWorldEnabled,
                        tenantPolicy,
                      }
                    );

                    if (ruleRes.matchedRuleId) matchedRuleIds.push(ruleRes.matchedRuleId);

                    if (
                      ruleRes.placement === 'auto_approved' &&
                      ruleRes.categoryId &&
                      (!ruleRes.riskFlags || ruleRes.riskFlags.length === 0)
                    ) {
                      await sb.from('transactions').update({
                        category_id: ruleRes.categoryId,
                        suggested_category_id: ruleRes.categoryId,
                        world_scope: personalWorldEnabled && ruleRes.world === 'personal' ? 'personal' : 'business',
                        status: 'classified',
                        classified_by: 'auto',
                        classified_at: new Date().toISOString(),
                        confidence: ruleRes.confidence,
                        risk_flags: [],
                      }).eq('id', txn.id);
                      classified++;

                      await recordClassificationEvidence(sb, orgId, {
                        transactionId: txn.id,
                        rawNarration: narr,
                        normalizedTokens: ruleRes.normalizedTokens,
                        candidateRules: ruleRes.candidateRules,
                        selectedRuleId: ruleRes.matchedRuleId || null,
                        selectedRuleVersion: ruleRes.matchedRuleVersion || null,
                        confidence: ruleRes.confidence,
                        confidenceBand: ruleRes.confidenceBand || 'high',
                        riskFlags: ruleRes.riskFlags || [],
                        decisionReason: ruleRes.reasoning,
                        placement: 'auto_approved',
                        finalDecision: { categoryId: ruleRes.categoryId, world: ruleRes.world || 'business' },
                        actorId: actorUserId,
                      });
                    } else {
                      needsAIForPost.push({ txn, ruleRes });
                    }
                  }

                  if (matchedRuleIds.length > 0) {
                    void recordRuleMatchUsage(sb, orgId, matchedRuleIds);
                  }

                  // PHASE 2 (§11): Resolve org AI config (BYOK / Platform Gateway) only for unresolved rows
                  if (needsAIForPost.length > 0 && platformSettings.feature_flags.ai_category_suggestions) {
                    const { classifyBatchWithAI } = await import('../lib/aiClient.js');
                    const { getDefaultAIConfig } = await import('../config/aiConfig.js');
                    let aiConfig: any = null;
                    try {
                      const resolved = await resolveOrgAIConfig(orgId);
                      if (resolved.source !== 'none' && resolved.apiKey) {
                        aiConfig = {
                          provider: resolved.provider,
                          modelName: resolved.modelName,
                          apiKey: resolved.apiKey,
                          baseUrl: resolved.baseUrl,
                          temperature: resolved.temperature,
                          maxTokens: resolved.maxTokens,
                          organizationId: orgId,
                        };
                      }
                    } catch {
                      /* fallback below */
                    }
                    if (!aiConfig) {
                      const def = getDefaultAIConfig();
                      if (def) aiConfig = { ...def, organizationId: orgId };
                    }

                    if (aiConfig) {
                      try {
                        const learningContext = await loadLearningPromptContext(sb, orgId, domainCats, fullRules);
                        const batchInput = needsAIForPost.map(({ txn }) => ({
                          narration: txn.narration || txn.description || '',
                          amount: Math.abs(Number(txn.amount || 0)),
                          type: (txn.type === 'credit' ? 'credit' : 'debit') as 'debit' | 'credit',
                        }));

                        const aiBatchMap = await classifyBatchWithAI(
                          {
                            transactions: batchInput,
                            availableCategories: domainCats.map(c => ({
                              id: c.id,
                              name: c.name,
                              type: c.type,
                            })),
                            learningContext,
                          },
                          aiConfig
                        );

                        for (let aiIdx = 0; aiIdx < needsAIForPost.length; aiIdx++) {
                          const { txn, ruleRes } = needsAIForPost[aiIdx];
                          const aiResult = aiBatchMap.get(aiIdx);
                          if (!aiResult) continue;

                          const inferredWorld: 'business' | 'personal' =
                            personalWorldEnabled && (aiResult.world === 'personal' || ruleRes.world === 'personal')
                              ? 'personal'
                              : (txn.world_scope === 'personal' && personalWorldEnabled ? 'personal' : 'business');

                          let cat = domainCats.find(c =>
                            c.name.toLowerCase() === aiResult.suggestedCategory.toLowerCase()
                          );
                          if (!cat && aiResult.createNewCategory && (aiResult.newCategoryName || aiResult.suggestedCategory)) {
                            try {
                              const expectedType = txn.type === 'credit' ? 'income' : 'expense';
                              const resCat = await findOrCreateCategoryForOrg(sb, orgId, {
                                name: aiResult.newCategoryName || aiResult.suggestedCategory,
                                type: expectedType,
                                world: inferredWorld,
                                color: inferredWorld === 'personal' ? '#f59e0b' : '#38bdf8',
                                icon: inferredWorld === 'personal' ? 'user' : 'tag',
                                reason: aiResult.reasoning || 'Proposed during statement import',
                              }, actorUserId);
                              cat = resCat.category;
                              domainCats.push(cat);
                            } catch {
                              /* non-fatal */
                            }
                          }

                          if (cat) {
                            const riskFlags = Array.from(new Set([
                              ...(ruleRes.riskFlags || []),
                              ...detectRiskFlags(
                                txn.narration || txn.description || '',
                                Math.abs(Number(txn.amount || 0)),
                                txn.type === 'credit' ? 'credit' : 'debit',
                                [],
                                {
                                  highValueThreshold: tenantPolicy.highValueThreshold,
                                  duplicateWindowDays: tenantPolicy.duplicateWindowDays,
                                  world: inferredWorld,
                                }
                              ),
                            ]));
                            const canAutoApprove =
                              tenantPolicy.allowsAutoApproval &&
                              aiResult.confidence >= tenantPolicy.highThreshold &&
                              riskFlags.length === 0 &&
                              !aiResult.createNewCategory;

                            if (canAutoApprove) {
                              await sb.from('transactions').update({
                                category_id: cat.id,
                                suggested_category_id: cat.id,
                                world_scope: inferredWorld,
                                status: 'classified',
                                classified_by: 'ai',
                                classified_at: new Date().toISOString(),
                                confidence: aiResult.confidence,
                                risk_flags: [],
                              }).eq('id', txn.id);
                              classified++;
                            } else {
                              await sb.from('transactions').update({
                                suggested_category_id: cat.id,
                                world_scope: inferredWorld,
                                status: 'pending',
                                confidence: aiResult.confidence,
                                risk_flags: riskFlags,
                              }).eq('id', txn.id);
                            }

                            await recordClassificationEvidence(sb, orgId, {
                              transactionId: txn.id,
                              rawNarration: txn.narration || txn.description || '',
                              normalizedTokens: ruleRes.normalizedTokens,
                              candidateRules: ruleRes.candidateRules,
                              modelVersion: aiConfig.modelName || null,
                              confidence: aiResult.confidence,
                              confidenceBand: aiResult.confidence >= tenantPolicy.highThreshold ? 'high' : aiResult.confidence >= tenantPolicy.mediumThreshold ? 'medium' : 'low',
                              riskFlags,
                              decisionReason: aiResult.reasoning || 'AI post-import classification',
                              placement: canAutoApprove ? 'auto_approved' : 'manual_review',
                              finalDecision: { categoryId: cat.id, world: inferredWorld },
                              actorId: actorUserId,
                            });
                          }
                        }
                      } catch (aiErr) {
                        console.warn('[import] AI batch classification failed for remaining txns:', aiErr);
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
              if (data.summary) {
                data.summary.autoClassified = (Number(data.summary.autoClassified) || 0) + classified;
                data.summary.needsReview = Math.max(0, (Number(data.summary.needsReview) || newTxns.length) - classified);
              }
            }
          }
        } catch (classifyErr) {
          console.warn('[import] Post-import classification error (non-fatal):', classifyErr);
        }
      }

      // ── Post-Commit Operations (Slice 1: Scoped to this batch only, §10, §33 #2, #7) ──
      try {
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

          // Reconcile newly imported transactions with active recurring schedules (§10, §33 #1, #7)
          // so an imported monthly charge marks that recurring period settled and never double-counts.
          try {
            const { data: activeSchedules } = await sb
              .from('recurring_transactions')
              .select('*')
              .eq('organization_id', orgId)
              .eq('is_active', true);

            if (activeSchedules && activeSchedules.length > 0) {
              const { matchTransactionsToRecurringSchedules } = await import('../services/recurringEngine.js');
              const recMatches = matchTransactionsToRecurringSchedules({
                importedTransactions: batchRows,
                activeSchedules,
              });

              for (const m of recMatches) {
                const sched = activeSchedules.find((s: any) => String(s.id) === m.scheduleId);
                if (!sched) continue;

                // Record matched_import occurrence (idempotent per template + period)
                try {
                  await sb.from('recurring_occurrences').upsert(
                    {
                      id: `rocc-${m.scheduleId}-${m.periodKey}`,
                      organization_id: orgId,
                      template_id: m.scheduleId,
                      scheduled_period_key: m.periodKey,
                      scheduled_date: m.scheduledDate,
                      amount: m.transactionAmount,
                      currency: sched.currency || 'USD',
                      status: 'matched_import',
                      transaction_id: m.transactionId,
                      source: 'import_match',
                      posted_at: new Date().toISOString(),
                      notes: `Matched imported statement transaction ${m.transactionId} (${m.confidence}% confidence)`,
                    },
                    { onConflict: 'template_id,scheduled_period_key', ignoreDuplicates: true },
                  );
                } catch {
                  /* graceful if migration 0048 not yet applied */
                }

                // Advance next_occurrence & increment generated_occurrence_count so the period isn't re-generated
                await sb
                  .from('recurring_transactions')
                  .update({
                    next_occurrence: m.nextOccurrenceAfterMatch,
                    generated_occurrence_count: Number(sched.generated_occurrence_count || 0) + 1,
                  })
                  .eq('id', m.scheduleId)
                  .eq('organization_id', orgId);
              }
            }
          } catch (recMatchErr) {
            console.warn('[imports] Post-commit recurring reconciliation warning (non-fatal):', recMatchErr);
          }
        }
      } catch (postCommitErr) {
        console.warn('[imports] Post-commit ledger/ATM processing error:', postCommitErr);
      }

      // §13 & §11: Automated AI Payroll & Salary Detection from Statement Ingestion
      try {
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
