/**
 * §4 — Transactions. Mounted at `/organizations/:organizationId/transactions` (mergeParams).
 * Supports Supabase DB persistence when configured + fallback to in-memory store.
 */

import { Router, type Request, type Response } from 'express';
import type { Transaction } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { postTransactionToJournal, reverseTransactionJournal } from '../lib/ledgerService.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { detectAndIssuePayslipsForTransactions } from '../lib/aiPayrollDetector.js';
import { isCurrencyEnabledGlobally } from './platformSettings.js';

function parseTags(q: unknown): string[] | undefined {
  if (q == null) return undefined;
  if (Array.isArray(q)) return q.map(String);
  return [String(q)];
}

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

async function isPeriodLocked(sb: any, orgId: string, date: string): Promise<boolean> {
  if (!sb || !orgId || !date) return false;
  try {
    const { data } = await sb
      .from('accounting_periods')
      .select('id, status')
      .eq('organization_id', orgId)
      .lte('start_date', date)
      .gte('end_date', date)
      .in('status', ['soft_closed', 'locked'])
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.warn('[transactions] Period lock check error:', err);
    return false;
  }
}

export function mapDbToDomainTransaction(row: Record<string, any>): Transaction {
  const tags: string[] = Array.isArray(row.tags) ? row.tags : [];
  let originalAmount = row.original_amount != null ? Number(row.original_amount) : undefined;
  let originalCurrency = row.original_currency ? String(row.original_currency) : undefined;
  let fxRateToBase = row.fx_rate_to_base != null ? Number(row.fx_rate_to_base) : undefined;
  let baseCurrency = row.base_currency ? String(row.base_currency) : undefined;

  for (const tag of tags) {
    if (originalAmount === undefined && tag.startsWith('fx:orig_amount:')) {
      const v = Number(tag.slice(15));
      if (Number.isFinite(v)) originalAmount = v;
    } else if (!originalCurrency && tag.startsWith('fx:orig_currency:')) {
      originalCurrency = tag.slice(17);
    } else if (fxRateToBase === undefined && tag.startsWith('fx:rate:')) {
      const v = Number(tag.slice(8));
      if (Number.isFinite(v)) fxRateToBase = v;
    } else if (!baseCurrency && tag.startsWith('fx:base_currency:')) {
      baseCurrency = tag.slice(17);
    }
  }

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    bankAccountId: String(row.bank_account_id),
    date: String(row.date),
    valueDate: row.value_date ? String(row.value_date) : String(row.date),
    description: String(row.description ?? ''),
    narration: String(row.narration ?? ''),
    originalNarration: row.original_narration ? String(row.original_narration) : String(row.narration ?? row.description ?? ''),
    normalizedNarration: row.normalized_narration ? String(row.normalized_narration) : String(row.description ?? row.narration ?? ''),
    amount: Number(row.amount),
    currency: String(row.currency ?? 'USD'),
    type: row.type === 'credit' ? 'credit' : 'debit',
    source: (row.source as any) || 'manual',
    categoryId: row.category_id ? String(row.category_id) : undefined,
    departmentId: row.department_id ? String(row.department_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    counterpartyId: row.counterparty_id ? String(row.counterparty_id) : undefined,
    clientId: row.client_id ? String(row.client_id) : undefined,
    costCenterId: row.cost_center_id ? String(row.cost_center_id) : undefined,
    status: row.status as Transaction['status'],
    confidence: row.confidence != null ? Number(row.confidence) : undefined,
    tags,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    originalAmount,
    originalCurrency,
    fxRateToBase,
    baseCurrency,
    baseAmount: row.base_amount != null ? Number(row.base_amount) : Number(row.amount),
    worldScope: row.world_scope || (tags.includes('personal') ? 'personal' : 'business'),
    isTransfer: Boolean(row.is_transfer || tags.includes('transfer')),
    transferGroupId: row.transfer_group_id ? String(row.transfer_group_id) : undefined,
    classificationResultId: row.classification_result_id ? String(row.classification_result_id) : undefined,
    approvalRequestId: row.approval_request_id ? String(row.approval_request_id) : undefined,
    postedJournalId: row.journal_entry_id ? String(row.journal_entry_id) : undefined,
    journalEntryId: row.journal_entry_id ? String(row.journal_entry_id) : undefined,
    sourceImportRowId: row.source_import_row_id ? String(row.source_import_row_id) : undefined,
    sourceImportId: row.source_import_id ? String(row.source_import_id) : undefined,
    reversalOfTransactionId: row.reversal_of_transaction_id ? String(row.reversal_of_transaction_id) : undefined,
    reversedByTransactionId: row.reversed_by_transaction_id ? String(row.reversed_by_transaction_id) : undefined,
    version: row.version != null ? Number(row.version) : 1,
    correctionReason: row.correction_reason ? String(row.correction_reason) : undefined,
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
    createdBy: row.created_by ? String(row.created_by) : undefined,
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    postedAt: row.posted_at ? String(row.posted_at) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    classifiedAt: row.classified_at ? String(row.classified_at) : undefined,
    classifiedBy: row.classified_by ? String(row.classified_by) : undefined,
  };
}

export function mapDomainToDbTransaction(txn: Transaction, ownerUserId?: string): Record<string, unknown> {
  const tags = Array.isArray(txn.tags) ? [...txn.tags] : [];
  if (txn.originalAmount != null && !tags.some(t => t.startsWith('fx:orig_amount:'))) {
    tags.push(`fx:orig_amount:${txn.originalAmount}`);
  }
  if (txn.originalCurrency && !tags.some(t => t.startsWith('fx:orig_currency:'))) {
    tags.push(`fx:orig_currency:${txn.originalCurrency}`);
  }
  if (txn.fxRateToBase != null && !tags.some(t => t.startsWith('fx:rate:'))) {
    tags.push(`fx:rate:${txn.fxRateToBase}`);
  }
  if (txn.baseCurrency && !tags.some(t => t.startsWith('fx:base_currency:'))) {
    tags.push(`fx:base_currency:${txn.baseCurrency}`);
  }

  const isTransfer = Boolean(txn.isTransfer || tags.includes('transfer'));
  const worldScope = txn.worldScope || (tags.includes('personal') ? 'personal' : 'business');

  return {
    id: txn.id,
    organization_id: txn.organizationId,
    bank_account_id: txn.bankAccountId,
    date: txn.date,
    value_date: txn.valueDate || txn.date,
    description: txn.description || '',
    narration: txn.narration || '',
    original_narration: txn.originalNarration || txn.narration || txn.description || '',
    normalized_narration: txn.normalizedNarration || txn.description || txn.narration || '',
    amount: txn.amount,
    currency: txn.currency || 'USD',
    type: txn.type,
    source: txn.source || 'manual',
    category_id: txn.categoryId || null,
    department_id: txn.departmentId || null,
    project_id: txn.projectId || null,
    counterparty_id: txn.counterpartyId || null,
    client_id: txn.clientId || null,
    cost_center_id: txn.costCenterId || null,
    status: txn.status,
    confidence: txn.confidence != null ? txn.confidence : null,
    tags,
    attachments: Array.isArray(txn.attachments) ? txn.attachments : [],
    idempotency_key: txn.idempotencyKey || null,
    original_amount: txn.originalAmount ?? txn.amount,
    original_currency: txn.originalCurrency || txn.currency || 'USD',
    fx_rate_to_base: txn.fxRateToBase ?? 1,
    base_currency: txn.baseCurrency || txn.currency || 'USD',
    base_amount: txn.baseAmount ?? txn.amount,
    world_scope: worldScope,
    is_transfer: isTransfer,
    transfer_group_id: txn.transferGroupId || null,
    classification_result_id: txn.classificationResultId || null,
    approval_request_id: txn.approvalRequestId || null,
    journal_entry_id: txn.journalEntryId || txn.postedJournalId || null,
    source_import_row_id: txn.sourceImportRowId || null,
    source_import_id: txn.sourceImportId || null,
    reversal_of_transaction_id: txn.reversalOfTransactionId || null,
    reversed_by_transaction_id: txn.reversedByTransactionId || null,
    version: txn.version ?? 1,
    correction_reason: txn.correctionReason || null,
    owner_user_id: ownerUserId || txn.ownerUserId || null,
    created_by: txn.createdBy || null,
    approved_by: txn.approvedBy || null,
    approved_at: txn.approvedAt || null,
    posted_at: txn.postedAt || null,
    created_at: txn.createdAt || new Date().toISOString(),
    updated_at: txn.updatedAt || new Date().toISOString(),
    classified_at: txn.classifiedAt || null,
    classified_by: txn.classifiedBy || null,
  };
}

import { convertCurrency } from './bankAccounts.js';

export async function recomputeServerBankBalance(orgId: string, bankAccountId: string): Promise<void> {
  if (!orgId || !bankAccountId) return;
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      const { data: bankRow } = await sb
        .from('bank_accounts')
        .select('*')
        .eq('id', bankAccountId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (bankRow) {
        const bankCurrency = bankRow.currency || 'USD';
        const rawOpening = bankRow.opening_balance;
        const openingBal = rawOpening != null
          ? Number(rawOpening)
          : 0;

        const { data: txns } = await sb
          .from('transactions')
          .select('*')
          .eq('bank_account_id', bankAccountId)
          .eq('organization_id', orgId)
          .not('status', 'in', '("draft","pending","rejected","reversed","cancelled")');

        const eligibleTxns = (txns || []).filter(
          (t: any) => !['draft', 'pending', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
        );

        const newBal = eligibleTxns.reduce((sum: number, t: any) => {
          const rawAmt = Number(t.amount || 0);
          const txnCurrency = t.currency || bankCurrency;
          let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
          if (!fxRate && Array.isArray(t.tags)) {
            const rTag = t.tags.find((tag: string) => tag.startsWith('fx:rate:'));
            if (rTag) fxRate = Number(rTag.slice(8));
          }
          const convertedAmt = convertCurrency(rawAmt, txnCurrency, bankCurrency, fxRate);
          return t.type === 'credit' ? sum + Math.abs(convertedAmt) : sum - Math.abs(convertedAmt);
        }, openingBal);

        const rounded = Math.round(newBal * 100) / 100;
        await sb
          .from('bank_accounts')
          .update({ balance: rounded, current_balance: rounded, last_synced_at: new Date().toISOString() })
          .eq('id', bankAccountId)
          .eq('organization_id', orgId);

        if (bankRow.account_id) {
          await sb
            .from('accounts')
            .update({ balance: rounded })
            .eq('id', bankRow.account_id)
            .eq('organization_id', orgId);
        }
      }
    } catch (err) {
      console.error('[transactions.recomputeServerBankBalance] Error:', err);
    }
  }

}

import { ensureFreshSpend } from './budgets.js';

async function recomputeBudgetsIfSupabase(orgId: string): Promise<void> {
  if (!orgId) return;
  const sb = getSupabaseAdminClient();
  try {
    await ensureFreshSpend(sb, orgId);
  } catch (err) {
    console.warn('[transactions.recomputeBudgetsIfSupabase] Error refreshing spend:', err);
  }
}

export function createTransactionsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/stats', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

    let txns: Transaction[] = [];
    let orgCurrency = 'USD';
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data: orgRow } = await sb.from('organizations').select('currency').eq('id', orgId).maybeSingle();
        if (orgRow?.currency) orgCurrency = orgRow.currency;
      } catch {}

      let q = sb.from('transactions').select('*').eq('organization_id', orgId);
      if (dateFrom) q = q.gte('date', dateFrom);
      if (dateTo) q = q.lte('date', dateTo);
      const { data, error } = await q;
      if (!error && data && data.length > 0) {
        txns = data.map(mapDbToDomainTransaction);
      }
    }

    const nonEligibleStatuses = new Set(['draft', 'pending', 'rejected', 'reversed', 'cancelled']);
    const eligibleTxns = txns.filter(t => {
      const st = String(t.status || 'classified').toLowerCase();
      if (nonEligibleStatuses.has(st)) return false;
      const isTransfer = (t as any).isTransfer || (t as any).is_transfer || (t.tags || []).includes('transfer') || (t.tags || []).includes('pending-transfer');
      if (isTransfer) return false;
      if ((t.tags || []).includes('loan-principal')) return false;
      return true;
    });

    const totalIncome = Math.round(
      eligibleTxns
        .filter(t => t.type === 'credit')
        .reduce((s, t) => s + convertCurrency(Math.abs(Number(t.amount || 0)), t.currency || orgCurrency, orgCurrency), 0) * 100
    ) / 100;

    const totalExpenses = Math.round(
      eligibleTxns
        .filter(t => t.type === 'debit')
        .reduce((s, t) => s + convertCurrency(Math.abs(Number(t.amount || 0)), t.currency || orgCurrency, orgCurrency), 0) * 100
    ) / 100;

    const pendingCount = txns.filter(t => t.status === 'pending').length;
    const classifiedCount = txns.filter(t => t.status !== 'pending').length;
    const confidences = txns.filter(t => t.confidence !== undefined).map(t => t.confidence as number);
    const avgConfidence = confidences.length > 0 ? confidences.reduce((s, c) => s + c, 0) / confidences.length : 0;

    ok(res, {
      totalIncome,
      totalExpenses,
      netAmount: Math.round((totalIncome - totalExpenses) * 100) / 100,
      currency: orgCurrency,
      transactionCount: txns.length,
      pendingCount,
      classifiedCount,
      avgConfidence: Math.round(avgConfidence),
    });
  });

  r.post('/bulk-categorize', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { ids, categoryId, classifiedBy = 'user' } = req.body as {
      ids: string[]; categoryId: string; classifiedBy?: string;
    };

    if (!Array.isArray(ids) || ids.length === 0 || !categoryId) {
      return fail(res, 400, 'ids array and categoryId are required');
    }

    let succeeded = 0;
    let skippedPosted = 0;
    const errors: { id: string; error: string }[] = [];

    const sb = getSupabaseAdminClient();
    if (sb) {
      const now = new Date().toISOString();
      const { data: existingRows } = await sb
        .from('transactions')
        .select('id, status')
        .in('id', ids)
        .eq('organization_id', orgId);

      const modifiableIds = (existingRows || [])
        .filter((r: any) => !['posted', 'reconciled'].includes(r.status))
        .map((r: any) => r.id);

      skippedPosted = ids.length - modifiableIds.length;

      if (modifiableIds.length > 0) {
        const { error } = await sb
          .from('transactions')
          .update({
            category_id: categoryId,
            status: 'classified',
            classified_at: now,
            classified_by: classifiedBy,
            updated_at: now,
          })
          .in('id', modifiableIds)
          .eq('organization_id', orgId);

        if (error) {
          errors.push({ id: 'batch', error: error.message });
        } else {
          succeeded = modifiableIds.length;
        }
      }
    }


    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'bulk_categorize_transactions',
      entityType: 'transaction',
      description: `Bulk categorized ${succeeded} transactions to category ${categoryId}${skippedPosted > 0 ? ` (skipped ${skippedPosted} posted entries)` : ''}`,
      metadata: { ids, categoryId, succeeded, skippedPosted },
    });

    ok(res, { succeeded, skippedPosted, failed: errors.length, errors },
      `${succeeded} transactions categorized${skippedPosted > 0 ? ` (${skippedPosted} posted entries protected)` : ''}`);
  });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const q = req.query as Record<string, string | undefined>;
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Number(q.pageSize ?? 20) || 20;
    const sortBy = q.sortBy || 'date';
    const sortOrder = (q.sortOrder as 'asc' | 'desc') || 'desc';

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        let query = sb
          .from('transactions')
          .select('*', { count: 'exact' })
          .eq('organization_id', orgId);

        if (q.categoryId) query = query.eq('category_id', q.categoryId);
        if (q.departmentId) query = query.eq('department_id', q.departmentId);
        if (q.projectId) query = query.eq('project_id', q.projectId);
        if (q.bankAccountId) query = query.eq('bank_account_id', q.bankAccountId);
        if (q.status) query = query.eq('status', q.status);
        if (q.type) query = query.eq('type', q.type);
        if (q.minAmount !== undefined) query = query.gte('amount', Number(q.minAmount));
        if (q.maxAmount !== undefined) query = query.lte('amount', Number(q.maxAmount));
        if (q.dateFrom) query = query.gte('date', q.dateFrom);
        if (q.dateTo) query = query.lte('date', q.dateTo);
        if (q.counterpartyId) query = query.eq('counterparty_id', q.counterpartyId);
        if (q.clientId) query = query.eq('client_id', q.clientId);
        if (q.costCenterId) query = query.eq('cost_center_id', q.costCenterId);
        if (q.source) query = query.eq('source', q.source);
        if (q.sourceImportId) query = query.eq('source_import_id', q.sourceImportId);
        if (q.worldScope || q.world || q.scope) query = query.eq('world_scope', q.worldScope || q.world || q.scope);
        if (q.currency) query = query.eq('currency', q.currency);
        if (q.createdBy) query = query.eq('created_by', q.createdBy);
        if (q.valueDateFrom) query = query.gte('value_date', q.valueDateFrom);
        if (q.valueDateTo) query = query.lte('value_date', q.valueDateTo);
        if (q.minConfidence !== undefined) query = query.gte('confidence', Number(q.minConfidence));
        if (q.maxConfidence !== undefined) query = query.lte('confidence', Number(q.maxConfidence));

        const dbSortColumn = sortBy === 'createdAt' ? 'created_at' : sortBy === 'bankAccountId' ? 'bank_account_id' : sortBy === 'categoryId' ? 'category_id' : sortBy;
        query = query.order(dbSortColumn, { ascending: sortOrder === 'asc' });

        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, count, error } = await query;
        if (error) {
          console.error('[transactions.get] Supabase query error:', error);
          return fail(res, 500, error.message);
        }

        let mappedItems = (data || []).map(mapDbToDomainTransaction);

        if (q.search) {
          const s = q.search.toLowerCase();
          mappedItems = mappedItems.filter(t =>
            t.description.toLowerCase().includes(s) ||
            t.narration.toLowerCase().includes(s) ||
            t.tags.some(tag => tag.toLowerCase().includes(s))
          );
        }

        const total = count ?? mappedItems.length;
        const totalPages = Math.ceil(total / pageSize);
        return ok(res, {
          items: mappedItems,
          total,
          page,
          pageSize,
          totalPages,
          hasMore: page < totalPages,
        });
      } catch (err: any) {
        console.error('[transactions.get] Supabase query failed:', err);
        return fail(res, 500, err?.message || 'Failed to fetch transactions');
      }
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (sb) {
      const { data, error } = await sb
        .from('transactions')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!error && data) {
        return ok(res, mapDbToDomainTransaction(data));
      }
    }

    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }
    return notFound(res, 'Transaction');
  });

  r.post('/bulk', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as { lines?: Array<Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>>; transactions?: Array<Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>> };
    const rawList = body.transactions || body.lines;

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return fail(res, 400, 'Transactions array is required and must not be empty');
    }

    const inserted: Transaction[] = [];
    const errors: Array<{ index: number; line: any; error: string }> = [];

    rawList.forEach((data, index) => {
      const amt = Number(data.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        errors.push({ index, line: data, error: 'Amount must be a number greater than 0' });
        return;
      }
      if (!data.bankAccountId) {
        errors.push({ index, line: data, error: 'A pay-from bank account is required' });
        return;
      }
      const desc = data.description?.trim() || data.narration?.trim();
      if (!desc) {
        errors.push({ index, line: data, error: 'Description or narration is required' });
        return;
      }

      const resolvedStatus = (data.status === 'classified' && !data.categoryId)
        ? 'pending'
        : (data.status || (data.categoryId ? 'classified' : 'pending'));

      const newTxn: Transaction = {
        ...data,
        id: (data as any).id || ('txn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
        organizationId: orgId,
        amount: amt,
        currency: data.currency || 'USD',
        type: data.type === 'credit' ? 'credit' : 'debit',
        status: resolvedStatus as Transaction['status'],
        tags: Array.isArray(data.tags) ? data.tags : ['quick-add', 'bulk'],
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        createdAt: new Date().toISOString(),
        ...(resolvedStatus === 'classified' && data.categoryId ? {
          classifiedAt: data.classifiedAt || new Date().toISOString(),
          classifiedBy: data.classifiedBy || 'user',
        } : {}),
      };

      inserted.push(newTxn);
    });

    // Sync to Supabase if connected
    const sb = getSupabaseAdminClient();
    if (sb && inserted.length > 0) {
      try {
        const dbRows = inserted.map(t => mapDomainToDbTransaction(t));
        const { error: sbError } = await sb.from('transactions').upsert(dbRows, { onConflict: 'id' });
        if (sbError) {
          console.warn('[transactions.bulk] Supabase upsert error, attempting fallback without department/project:', sbError);
          const strippedRows = dbRows.map(r => {
            const copy = { ...r };
            delete (copy as any).department_id;
            delete (copy as any).project_id;
            return copy;
          });
          await sb.from('transactions').upsert(strippedRows, { onConflict: 'id' });
        }
      } catch (err) {
        console.error('[transactions.bulk] Supabase sync error:', err);
      }
    }

    // Recompute bank balances for all touched accounts
    const bankIds = Array.from(new Set(inserted.map(t => t.bankAccountId).filter(Boolean)));
    for (const bId of bankIds) {
      void recomputeServerBankBalance(orgId, bId);
    }
    void recomputeBudgetsIfSupabase(orgId);

    ok(res, {
      inserted: inserted.length,
      failed: errors.length,
      items: inserted,
      errors,
    });
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Transaction, 'id' | 'organizationId' | 'createdAt'> & { idempotencyKey?: string };

    const idempotencyKey = (req.headers['idempotency-key'] as string | undefined) || data.idempotencyKey;


    const amt = Number(data.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return fail(res, 400, 'Amount must be a number greater than 0');
    }
    if (!data.bankAccountId) {
      return fail(res, 400, 'A pay-from bank account is required');
    }
    if (data.currency) {
      const currencyAllowed = await isCurrencyEnabledGlobally(data.currency, data.baseCurrency);
      if (!currencyAllowed) {
        return fail(res, 400, `Currency ${data.currency.toUpperCase()} is currently disabled system-wide in Platform Settings`);
      }
    }
    if (data.originalCurrency) {
      const origAllowed = await isCurrencyEnabledGlobally(data.originalCurrency, data.baseCurrency);
      if (!origAllowed) {
        return fail(res, 400, `Currency ${data.originalCurrency.toUpperCase()} is currently disabled system-wide in Platform Settings`);
      }
    }
    if (data.date && !/^\d{4}-\d{2}-\d{2}/.test(data.date)) {
      return fail(res, 400, 'Date must be formatted as YYYY-MM-DD');
    }
    if (data.status === 'classified' && !data.categoryId) {
      return fail(res, 400, 'Cannot mark a transaction classified without a category');
    }

    const resolvedStatus = (data.status === 'classified' && !data.categoryId)
      ? 'pending'
      : (data.status || (data.categoryId ? 'classified' : 'pending'));

    const sb = getSupabaseAdminClient();
    let resolvedCounterpartyId = data.counterpartyId;
    const cpName = (data as any).counterpartyName || (data as any).counterparty || (data as any).payee;

    if (sb && !resolvedCounterpartyId && cpName && typeof cpName === 'string' && cpName.trim()) {
      try {
        const trimmed = cpName.trim();
        const { data: cpData } = await sb
          .from('counterparties')
          .select('id')
          .eq('organization_id', orgId)
          .ilike('name', trimmed)
          .limit(1)
          .maybeSingle();

        if (cpData?.id) {
          resolvedCounterpartyId = cpData.id;
        } else {
          const newCpId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const { data: createdCp } = await sb
            .from('counterparties')
            .insert({
              id: newCpId,
              organization_id: orgId,
              name: trimmed,
              type: data.type === 'credit' ? 'customer' : 'vendor',
              status: 'active',
              currency: data.currency || 'USD',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .maybeSingle();
          if (createdCp?.id) {
            resolvedCounterpartyId = createdCp.id;
          }
        }
      } catch (cpErr) {
        console.warn('[transactions.create] Counterparty auto-link error:', cpErr);
      }
    }

    const newTxn: Transaction = {
      ...data,
      id: (data as any).id || ('txn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
      organizationId: orgId,
      amount: amt,
      counterpartyId: resolvedCounterpartyId || data.counterpartyId,
      status: resolvedStatus as Transaction['status'],
      createdAt: new Date().toISOString(),
      ...(idempotencyKey ? { idempotencyKey } as any : {}),
      ...(resolvedStatus === 'classified' && data.categoryId ? {
        classifiedAt: data.classifiedAt || new Date().toISOString(),
        classifiedBy: data.classifiedBy || 'user',
      } : {}),
    };
    if (sb) {
      try {
        const dbRow = mapDomainToDbTransaction(newTxn);
        const { error: sbErr } = await sb.from('transactions').upsert(dbRow, { onConflict: 'id' });
        if (sbErr) {
          console.warn('[transactions.create] Supabase upsert failed, retrying without auxiliary columns:', sbErr);
          const stripped = { ...dbRow };
          delete (stripped as any).department_id;
          delete (stripped as any).project_id;
          await sb.from('transactions').upsert(stripped, { onConflict: 'id' });
        }
      } catch (err) {
        console.error('[transactions.create] Supabase upsert error:', err);
      }
    }


    void recomputeServerBankBalance(orgId, newTxn.bankAccountId);
    void recomputeBudgetsIfSupabase(orgId);

    if (sb && (newTxn.status === 'posted' as any || newTxn.status === 'classified')) {
      void postTransactionToJournal(sb, {
        id: newTxn.id,
        organization_id: orgId,
        bank_account_id: newTxn.bankAccountId,
        category_id: newTxn.categoryId,
        department_id: newTxn.departmentId,
        project_id: newTxn.projectId,
        date: newTxn.date,
        amount: newTxn.amount,
        base_amount: (newTxn as any).baseAmount ?? newTxn.amount,
        currency: newTxn.currency,
        type: newTxn.type,
        description: newTxn.description || newTxn.narration,
        world_scope: (newTxn as any).worldScope || 'business',
      }, req.authUser?.id);
    }

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'create_transaction',
      entityType: 'transaction',
      entityId: newTxn.id,
      description: `Created transaction: ${newTxn.type.toUpperCase()} ${newTxn.amount} ${newTxn.currency} (${newTxn.description || newTxn.narration})`,
      afterState: newTxn as any,
    });

    if (sb && newTxn.type === 'debit' && !(newTxn as any).isTransfer && !(newTxn as any).is_transfer) {
      void detectAndIssuePayslipsForTransactions(sb, orgId, [mapDomainToDbTransaction(newTxn)])
        .catch(err => console.warn('[transactions.create] Auto-payroll detection error:', err));
    }

    created(res, newTxn, 'Transaction created');
  });

  // ── First-Class Two-Legged Transfers (§1, §8, §23 F-01) ─────────────────
  r.post('/transfers', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const {
      fromBankAccountId,
      toBankAccountId,
      amount,
      currency = 'USD',
      toCurrency,
      fxRate = 1.0,
      convertedAmount,
      date = new Date().toISOString().split('T')[0],
      description = 'Account Transfer',
      transferType = 'bank_to_bank',
    } = req.body;

    const numAmount = Number(amount);
    if (!fromBankAccountId || !toBankAccountId || !numAmount || numAmount <= 0) {
      return fail(res, 400, 'fromBankAccountId, toBankAccountId, and positive amount are required');
    }
    if (fromBankAccountId === toBankAccountId) {
      return fail(res, 400, 'Source and destination accounts must be different');
    }

    const sb = getSupabaseAdminClient();
    const transferGroupId = `trf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const effectiveConvertedAmount = Number(convertedAmount || numAmount * fxRate);
    const targetCurrency = toCurrency || currency;

    // 1. Outflow leg (debit from source account)
    const outflowTxn: Transaction = {
      id: `txn-out-${transferGroupId}`,
      organizationId: orgId,
      bankAccountId: fromBankAccountId,
      date,
      description: `Transfer to account: ${description}`,
      narration: `Internal transfer (Outflow) [${transferGroupId}]`,
      amount: numAmount,
      currency,
      type: 'debit',
      status: 'reconciled',
      tags: ['transfer', 'internal-transfer', transferType],
      attachments: [],
      createdAt: new Date().toISOString(),
    };
    (outflowTxn as any).isTransfer = true;
    (outflowTxn as any).transferGroupId = transferGroupId;

    // 2. Inflow leg (credit to destination account)
    const inflowTxn: Transaction = {
      id: `txn-in-${transferGroupId}`,
      organizationId: orgId,
      bankAccountId: toBankAccountId,
      date,
      description: `Transfer from account: ${description}`,
      narration: `Internal transfer (Inflow) [${transferGroupId}]`,
      amount: effectiveConvertedAmount,
      currency: targetCurrency,
      type: 'credit',
      status: 'reconciled',
      tags: ['transfer', 'internal-transfer', transferType],
      attachments: [],
      createdAt: new Date().toISOString(),
    };
    (inflowTxn as any).isTransfer = true;
    (inflowTxn as any).transferGroupId = transferGroupId;

    if (sb) {
      try {
        const outRow = mapDomainToDbTransaction(outflowTxn, req.authUser?.id);
        const inRow = mapDomainToDbTransaction(inflowTxn, req.authUser?.id);
        await sb.from('transactions').upsert([outRow, inRow], { onConflict: 'id' });

        await sb.from('transfers').insert({
          id: transferGroupId,
          organization_id: orgId,
          transfer_type: transferType,
          from_bank_account_id: fromBankAccountId,
          to_bank_account_id: toBankAccountId,
          outflow_transaction_id: outflowTxn.id,
          inflow_transaction_id: inflowTxn.id,
          amount: numAmount,
          from_currency: currency,
          to_currency: targetCurrency,
          fx_rate: fxRate,
          converted_amount: effectiveConvertedAmount,
          date,
          description,
          status: 'posted',
          created_by: req.authUser?.id || null,
        });
      } catch (err) {
        console.warn('[transactions.transfers] Supabase transfer insert warning:', err);
      }
    }


    void recomputeServerBankBalance(orgId, fromBankAccountId);
    void recomputeServerBankBalance(orgId, toBankAccountId);

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'create_transfer',
      entityType: 'transfer',
      entityId: transferGroupId,
      description: `Transfer ${numAmount} ${currency} from ${fromBankAccountId} to ${toBankAccountId} (${transferType})`,
      metadata: { transferGroupId, outflowTxnId: outflowTxn.id, inflowTxnId: inflowTxn.id },
    });

    created(res, {
      transferId: transferGroupId,
      outflow: outflowTxn,
      inflow: inflowTxn,
    }, 'Transfer processed successfully');
  });

  // ── Post / Approve Transaction to General Ledger (§7, §8, §33) ─────────
  r.post('/:id/post', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const txnId = req.params.id;
    const sb = getSupabaseAdminClient();

    let targetTxn: any = null;
    if (sb) {
      const { data } = await sb.from('transactions').select('*').eq('id', txnId).eq('organization_id', orgId).maybeSingle();
      if (data) targetTxn = mapDbToDomainTransaction(data);
    }

    if (!targetTxn) return notFound(res, 'Transaction');

    if (sb && await isPeriodLocked(sb, orgId, targetTxn.date)) {
      return fail(res, 409, `Cannot post transaction to closed or locked accounting period for date ${targetTxn.date}`);
    }

    if (sb) {
      const posting = await postTransactionToJournal(sb, {
        id: targetTxn.id,
        organization_id: orgId,
        bank_account_id: targetTxn.bankAccountId,
        category_id: targetTxn.categoryId,
        department_id: targetTxn.departmentId,
        project_id: targetTxn.projectId,
        date: targetTxn.date,
        amount: targetTxn.amount,
        base_amount: targetTxn.baseAmount ?? targetTxn.amount,
        currency: targetTxn.currency,
        type: targetTxn.type,
        description: targetTxn.description || targetTxn.narration,
        world_scope: targetTxn.worldScope || 'business',
      }, req.authUser?.id);

      if (!posting.success) {
        return fail(res, 500, posting.error || 'Failed to post transaction to journal');
      }

      await sb.from('transactions').update({
        status: 'posted',
        approved_by: req.authUser?.id || null,
        approved_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
      }).eq('id', txnId).eq('organization_id', orgId);
    }

    targetTxn.status = 'posted';

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'post_transaction_to_ledger',
      entityType: 'transaction',
      entityId: String(txnId),
      description: `Posted transaction ${txnId} to double-entry general ledger`,
    });

    ok(res, targetTxn, 'Transaction posted to general ledger');
  });

  // ── Immutable Reversal of Transaction (§7, §8, §33) ─────────────────────
  r.post('/:id/reverse', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const txnId = req.params.id;
    const { reason = 'Transaction reversed by user' } = req.body;
    const sb = getSupabaseAdminClient();

    if (sb) {
      const { data: existingTxn } = await sb
        .from('transactions')
        .select('bank_account_id')
        .eq('id', txnId)
        .eq('organization_id', orgId)
        .maybeSingle();

      const reversal = await reverseTransactionJournal(sb, String(txnId), orgId, reason, req.authUser?.id);
      if (!reversal.success) {
        return fail(res, 500, reversal.error || 'Failed to reverse transaction');
      }

      if (existingTxn?.bank_account_id) {
        void recomputeServerBankBalance(orgId, existingTxn.bank_account_id);
      }
      void recomputeBudgetsIfSupabase(orgId);
    }



    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'reverse_transaction',
      entityType: 'transaction',
      entityId: String(txnId),
      description: `Reversed transaction ${txnId}: ${reason}`,
      metadata: { reason },
    });

    ok(res, { id: txnId, status: 'reversed', reason }, 'Transaction reversed successfully');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<Transaction>;

    const sb = getSupabaseAdminClient();
    if (sb) {
      const { data: existing, error: existErr } = await sb
        .from('transactions')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (existErr) {
        return fail(res, 500, existErr.message);
      }
      if (!existing) {
        return notFound(res, 'Transaction');
      }

      const isFinancialMutation = updates.amount !== undefined ||
        updates.currency !== undefined ||
        updates.type !== undefined ||
        updates.date !== undefined ||
        (updates as any).bankAccountId !== undefined ||
        (updates as any).bank_account_id !== undefined;

      if (existing.status === 'posted' && isFinancialMutation) {
        return fail(res, 400, 'Posted transactions are immutable. Financial corrections must be performed via transaction reversal (POST /transactions/:id/reverse).');
      }

      if (updates.date && await isPeriodLocked(sb, orgId, updates.date)) {
        return fail(res, 400, 'Cannot move transaction into a locked accounting period');
      }
      if (existing.date && isFinancialMutation && await isPeriodLocked(sb, orgId, existing.date)) {
        return fail(res, 400, 'Cannot mutate a transaction in a locked accounting period');
      }

      const dbUpdates: Record<string, unknown> = {};
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.narration !== undefined) dbUpdates.narration = updates.narration;
      if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
      if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
      if (updates.type !== undefined) dbUpdates.type = updates.type;
      if (updates.categoryId !== undefined) {
        dbUpdates.category_id = updates.categoryId && updates.categoryId !== '__none__' ? updates.categoryId : null;
      }
      if (updates.departmentId !== undefined) {
        dbUpdates.department_id = updates.departmentId && updates.departmentId !== '__none__' ? updates.departmentId : null;
      }
      if (updates.projectId !== undefined) {
        dbUpdates.project_id = updates.projectId && updates.projectId !== '__none__' ? updates.projectId : null;
      }
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.date !== undefined) dbUpdates.date = updates.date;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;

      if (Object.keys(dbUpdates).length > 0) {
        const { error: updateError } = await sb
          .from('transactions')
          .update(dbUpdates)
          .eq('id', req.params.id)
          .eq('organization_id', orgId);

        if (updateError) {
          console.error('[PATCH transactions/:id] Supabase update error:', updateError);
          return fail(res, 500, updateError.message);
        }
      }
    }



    if (sb) {
      const { data, error: fetchErr } = await sb
        .from('transactions')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (fetchErr) {
        console.error('[PATCH transactions/:id] Supabase fetch error:', fetchErr);
        return fail(res, 500, fetchErr.message);
      }
      if (data) {
        const domain = mapDbToDomainTransaction(data);
        if (domain.bankAccountId) {
          void recomputeServerBankBalance(orgId, domain.bankAccountId);
        }
        void recomputeBudgetsIfSupabase(orgId);
        return ok(res, domain, 'Transaction updated');
      }
    }



    notFound(res, 'Transaction');
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    let bankAccountId: string | undefined;



    if (sb) {
      const { data: existing } = await sb
        .from('transactions')
        .select('bank_account_id, status')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (existing) {
        if (['posted', 'reconciled'].includes(existing.status)) {
          return fail(res, 400, 'Cannot delete a posted or reconciled transaction. Use POST /api/transactions/:id/reverse instead.');
        }
        bankAccountId = existing.bank_account_id;
      }

      await sb
        .from('transactions')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', orgId);
    }

    if (bankAccountId) {
      void recomputeServerBankBalance(orgId, bankAccountId);
    }

    ok(res, null, 'Transaction deleted');
  });

  return r;
}
