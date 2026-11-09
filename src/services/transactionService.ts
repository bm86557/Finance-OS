/**
 * Transaction Service
 * ====================
 * Full CRUD + filtering, pagination, bulk ops for transactions.
 *
 * MIGRATION:
 * - When `VITE_API_BASE_URL` is set, calls org-scoped REST routes.
 * - When Supabase is configured (`isSupabaseConfigured()`), reads/writes directly to Supabase table `public.transactions`.
 * - Maintains in-memory `dataStore` for high responsiveness, offline fallback, and reactive updates.
 */

import { Transaction } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabaseClient';
import { logUnexpectedError } from '@/lib/diagnostics';
import { dataStore, generateId, simulateDelay } from './dataStore';
import { recomputeBankAccountBalance } from './accountService';
import type { ServiceResponse, PaginatedResult, TransactionFilters, BulkOperationResult } from './types';

const TXN_BASE = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/transactions`;

/** Serialize filters to query string for GET list / stats. */
export function transactionFiltersQuery(filters: TransactionFilters = {}): string {
  const qs = new URLSearchParams();
  const {
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    categoryId,
    departmentId,
    projectId,
    bankAccountId,
    counterpartyId,
    clientId,
    costCenterId,
    source,
    sourceImportId,
    status,
    type,
    worldScope,
    currency,
    createdBy,
    minAmount,
    maxAmount,
    dateFrom,
    dateTo,
    valueDateFrom,
    valueDateTo,
    minConfidence,
    maxConfidence,
    tags,
  } = filters;
  if (page != null) qs.set('page', String(page));
  if (pageSize != null) qs.set('pageSize', String(pageSize));
  if (sortBy) qs.set('sortBy', sortBy);
  if (sortOrder) qs.set('sortOrder', sortOrder);
  if (search) qs.set('search', search);
  if (categoryId) qs.set('categoryId', categoryId);
  if (departmentId) qs.set('departmentId', departmentId);
  if (projectId) qs.set('projectId', projectId);
  if (bankAccountId) qs.set('bankAccountId', bankAccountId);
  if (counterpartyId) qs.set('counterpartyId', counterpartyId);
  if (clientId) qs.set('clientId', clientId);
  if (costCenterId) qs.set('costCenterId', costCenterId);
  if (source) qs.set('source', source);
  if (sourceImportId) qs.set('sourceImportId', sourceImportId);
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (worldScope) qs.set('worldScope', worldScope);
  if (currency) qs.set('currency', currency);
  if (createdBy) qs.set('createdBy', createdBy);
  if (minAmount !== undefined) qs.set('minAmount', String(minAmount));
  if (maxAmount !== undefined) qs.set('maxAmount', String(maxAmount));
  if (dateFrom) qs.set('dateFrom', dateFrom);
  if (dateTo) qs.set('dateTo', dateTo);
  if (valueDateFrom) qs.set('valueDateFrom', valueDateFrom);
  if (valueDateTo) qs.set('valueDateTo', valueDateTo);
  if (minConfidence !== undefined) qs.set('minConfidence', String(minConfidence));
  if (maxConfidence !== undefined) qs.set('maxConfidence', String(maxConfidence));
  if (tags?.length) tags.forEach(t => qs.append('tags', t));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function mapDomainToDbTransaction(txn: Transaction): Record<string, unknown> {
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
    owner_user_id: txn.ownerUserId || null,
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

  const sourceFileName = row.source_file_name || row.import_history_records?.file_name || undefined;
  const sourceFileType = row.source_file_type || row.import_history_records?.file_type || undefined;
  const sourceImportedAt = row.source_imported_at || row.import_history_records?.imported_at || undefined;

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
    sourceFileName,
    sourceFileType,
    sourceImportedAt,
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

export async function ensureSupabaseDependencies(
  organizationId: string,
  bankAccountId?: string,
  categoryId?: string,
  projectId?: string,
  departmentId?: string,
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;

  try {
    // 1. Ensure Organization exists
    const org = dataStore.organizations.find(o => o.id === organizationId);
    if (org) {
      await sb.from('organizations').upsert(
        {
          id: org.id,
          name: org.name,
          slug: org.slug || org.name.toLowerCase().replace(/\s+/g, '-'),
          logo: org.logo || null,
          currency: org.currency || 'USD',
          fiscal_year_start: org.fiscalYearStart || '01-01',
          settings: org.settings || { theme: 'dark', notifications: true },
        },
        { onConflict: 'id' },
      );
    }

    // 2. Ensure Bank Account (and its linked Chart of Account) exists
    if (bankAccountId) {
      const bankAcc = dataStore.bankAccounts.find(b => b.id === bankAccountId);
      if (bankAcc) {
        const linkedAcc = dataStore.accounts.find(a => a.id === bankAcc.accountId);
        if (linkedAcc) {
          await sb.from('accounts').upsert(
            {
              id: linkedAcc.id,
              organization_id: linkedAcc.organizationId,
              code: linkedAcc.code,
              name: linkedAcc.name,
              type: linkedAcc.type,
              subtype: linkedAcc.subtype || '',
              currency: linkedAcc.currency || 'USD',
              balance: linkedAcc.balance || 0,
              is_active: linkedAcc.isActive !== false,
            },
            { onConflict: 'id' },
          );
        }
        await sb.from('bank_accounts').upsert(
          {
            id: bankAcc.id,
            organization_id: bankAcc.organizationId,
            account_id: bankAcc.accountId,
            bank_name: bankAcc.bankName || '',
            account_number: bankAcc.accountNumber || '',
            account_type: bankAcc.accountType || 'checking',
            currency: bankAcc.currency || 'USD',
            balance: bankAcc.balance || 0,
            is_active: bankAcc.isActive !== false,
            usage: bankAcc.usage || 'business',
          },
          { onConflict: 'id' },
        );
      }
    }

    // 3. Ensure Category (and its linked Chart of Account) exists
    if (categoryId) {
      const cat = dataStore.categories.find(c => c.id === categoryId);
      if (cat) {
        const catAcc = dataStore.accounts.find(a => a.id === cat.accountId);
        if (catAcc) {
          await sb.from('accounts').upsert(
            {
              id: catAcc.id,
              organization_id: catAcc.organizationId,
              code: catAcc.code,
              name: catAcc.name,
              type: catAcc.type,
              subtype: catAcc.subtype || '',
              currency: catAcc.currency || 'USD',
              balance: catAcc.balance || 0,
              is_active: catAcc.isActive !== false,
            },
            { onConflict: 'id' },
          );
        }
        await sb.from('categories').upsert(
          {
            id: cat.id,
            organization_id: cat.organizationId,
            name: cat.name,
            type: cat.type,
            account_id: cat.accountId,
            color: cat.color || '#888888',
            icon: cat.icon || 'folder',
            patterns: cat.patterns || [],
          },
          { onConflict: 'id' },
        );
      }
    }

    // 4. Ensure Department exists if referenced
    if (departmentId) {
      const dept = dataStore.departments.find(d => d.id === departmentId);
      if (dept) {
        await sb.from('departments').upsert(
          {
            id: dept.id,
            organization_id: dept.organizationId,
            name: dept.name,
            code: dept.code || '',
            budget: dept.budget || null,
            cost_center: dept.costCenter || '',
            is_active: dept.isActive !== false,
          },
          { onConflict: 'id' },
        );
      }
    }

    // 5. Ensure Project exists if referenced
    if (projectId) {
      const proj = dataStore.projects.find(p => p.id === projectId);
      if (proj) {
        if (proj.departmentId) {
          const dept = dataStore.departments.find(d => d.id === proj.departmentId);
          if (dept) {
            await sb.from('departments').upsert(
              {
                id: dept.id,
                organization_id: dept.organizationId,
                name: dept.name,
                code: dept.code || '',
                budget: dept.budget || null,
                cost_center: dept.costCenter || '',
                is_active: dept.isActive !== false,
              },
              { onConflict: 'id' },
            );
          }
        }
        await sb.from('projects').upsert(
          {
            id: proj.id,
            organization_id: proj.organizationId,
            name: proj.name,
            code: proj.code || '',
            client_name: proj.clientName || '',
            department_id: proj.departmentId || null,
            status: proj.status || 'active',
            start_date: proj.startDate || new Date().toISOString().slice(0, 10),
            end_date: proj.endDate || null,
            quoted_amount: proj.quotedAmount || 0,
            actual_cost: proj.actualCost || 0,
            currency: proj.currency || 'USD',
          },
          { onConflict: 'id' },
        );
      }
    }
  } catch (err) {
    logUnexpectedError('transactionService.ensureSupabaseDependencies', err);
  }
}

export const transactionService = {
  /**
   * Get transactions with filtering and pagination
   */
  async getAll(
    organizationId: string,
    filters: TransactionFilters = {},
  ): Promise<ServiceResponse<PaginatedResult<Transaction>>> {
    if (!organizationId || !organizationId.trim()) {
      return {
        success: false,
        data: null as unknown as PaginatedResult<Transaction>,
        error: 'organizationId required',
      };
    }

    if (isHttpBackendConfigured()) {
      return apiGet<PaginatedResult<Transaction>>(
        `${TXN_BASE(organizationId)}${transactionFiltersQuery(filters)}`,
      );
    }

    const {
      page = 1, pageSize = 20, sortBy = 'date', sortOrder = 'desc',
      search, categoryId, departmentId, projectId, bankAccountId,
      status, type, minAmount, maxAmount, dateFrom, dateTo, tags,
    } = filters;

    // Check direct Supabase query if configured
    if (isSupabaseConfigured() && organizationId.trim()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          // Query transactions
          let query = sb
            .from('transactions')
            .select('*', { count: 'exact' })
            .eq('organization_id', organizationId);

          if (categoryId) query = query.eq('category_id', categoryId);
          if (departmentId) query = query.eq('department_id', departmentId);
          if (projectId) query = query.eq('project_id', projectId);
          if (bankAccountId) query = query.eq('bank_account_id', bankAccountId);
          if (status) query = query.eq('status', status);
          if (type) query = query.eq('type', type);
          if (minAmount !== undefined) query = query.gte('amount', minAmount);
          if (maxAmount !== undefined) query = query.lte('amount', maxAmount);
          if (dateFrom) query = query.gte('date', dateFrom);
          if (dateTo) query = query.lte('date', dateTo);

          const dbSortColumn = sortBy === 'createdAt' ? 'created_at' : sortBy === 'bankAccountId' ? 'bank_account_id' : sortBy === 'categoryId' ? 'category_id' : sortBy;
          query = query.order(dbSortColumn, { ascending: sortOrder === 'asc' });

          const from = (page - 1) * pageSize;
          const to = from + pageSize - 1;
          query = query.range(from, to);

          const { data: transactions, count, error: txnError } = await query;
          
          if (txnError || !transactions) {
            console.error('Transaction query error:', txnError);
            throw txnError;
          }

          // Get all unique source_import_ids from transactions
          const importIds = [...new Set(
            transactions
              .map(t => t.source_import_id)
              .filter(Boolean)
          )];

          // Fetch import history records for these IDs
          let importRecords: Record<string, any> = {};
          if (importIds.length > 0) {
            const { data: imports, error: importError } = await sb
              .from('import_history_records')
              .select('id, file_name, file_type, imported_at')
              .in('id', importIds);

            if (!importError && imports) {
              importRecords = Object.fromEntries(
                imports.map(i => [i.id, i])
              );
            }
          }

          // Merge import data into transactions
          const enrichedTransactions = transactions.map(txn => ({
            ...txn,
            source_file_name: txn.source_import_id ? importRecords[txn.source_import_id]?.file_name : undefined,
            source_file_type: txn.source_import_id ? importRecords[txn.source_import_id]?.file_type : undefined,
            source_imported_at: txn.source_import_id ? importRecords[txn.source_import_id]?.imported_at : undefined,
          }));

          // DEBUG: Log enriched data
          if (enrichedTransactions.length > 0) {
            console.log('🔍 Enriched transaction (first item):', {
              id: enrichedTransactions[0].id,
              source_import_id: enrichedTransactions[0].source_import_id,
              source_file_name: enrichedTransactions[0].source_file_name,
              source_file_type: enrichedTransactions[0].source_file_type,
            });
          }

          let mappedItems = enrichedTransactions.map(mapDbToDomainTransaction);

          if (search) {
            const q = search.toLowerCase();
            mappedItems = mappedItems.filter(t =>
              t.description.toLowerCase().includes(q) ||
              t.narration.toLowerCase().includes(q) ||
              t.tags.some(tag => tag.toLowerCase().includes(q))
            );
          }

          // Sync into local dataStore transactions cache
          for (const item of mappedItems) {
            const localIdx = dataStore.transactions.findIndex(t => t.id === item.id);
            if (localIdx === -1) {
              dataStore.transactions.push(item);
            } else {
              dataStore.transactions[localIdx] = item;
            }
          }

          const total = count ?? mappedItems.length;
          const totalPages = Math.ceil(total / pageSize);

          return {
            success: true,
            data: {
              items: mappedItems,
              total,
              page,
              pageSize,
              totalPages,
              hasMore: page < totalPages,
            },
          };
        } catch (err) {
          logUnexpectedError('transactionService.getAll.supabase', err);
        }
      }
    }

    await simulateDelay();

    let items = dataStore.transactions.filter(t => t.organizationId === organizationId);

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.narration.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (categoryId) items = items.filter(t => t.categoryId === categoryId);
    if (departmentId) items = items.filter(t => t.departmentId === departmentId);
    if (projectId) items = items.filter(t => t.projectId === projectId);
    if (bankAccountId) items = items.filter(t => t.bankAccountId === bankAccountId);
    if (status) items = items.filter(t => t.status === status);
    if (type) items = items.filter(t => t.type === type);
    if (minAmount !== undefined) items = items.filter(t => Math.abs(t.amount) >= minAmount);
    if (maxAmount !== undefined) items = items.filter(t => Math.abs(t.amount) <= maxAmount);
    if (dateFrom) items = items.filter(t => t.date >= dateFrom);
    if (dateTo) items = items.filter(t => t.date <= dateTo);
    if (tags && tags.length > 0) {
      items = items.filter(t => tags.some(tag => t.tags.includes(tag)));
    }

    items.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const an = Number(aVal);
      const bn = Number(bVal);
      return sortOrder === 'asc' ? an - bn : bn - an;
    });

    const total = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const paginatedItems = items.slice(start, start + pageSize);

    return {
      success: true,
      data: {
        items: paginatedItems,
        total,
        page,
        pageSize,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  },

  /**
   * Get single transaction by ID.
   */
  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Transaction | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${TXN_BASE(organizationId)}/${encodeURIComponent(id)}`
        : `/transactions/${encodeURIComponent(id)}`;
      return apiGet<Transaction | null>(path);
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          let q = sb.from('transactions').select('*').eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { data, error } = await q.maybeSingle();
          if (!error && data) {
            const domainTxn = mapDbToDomainTransaction(data);
            return { success: true, data: domainTxn };
          }
        } catch (err) {
          logUnexpectedError('transactionService.getById.supabase', err);
        }
      }
    }

    await simulateDelay(100);
    const txn = dataStore.transactions.find(t => t.id === id && (!organizationId || t.organizationId === organizationId)) || null;
    return { success: !!txn, data: txn, error: txn ? undefined : 'Transaction not found' };
  },

  async create(
    organizationId: string,
    data: Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>,
    options?: { idempotencyKey?: string },
  ): Promise<ServiceResponse<Transaction>> {
    if (!organizationId || !organizationId.trim()) {
      return { success: false, data: null as unknown as Transaction, error: 'organizationId required' };
    }

    const payload = {
      ...data,
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    };

    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<typeof payload, Transaction>(
        TXN_BASE(organizationId),
        payload,
      );
      if (res.success && res.data) {
        const item = res.data;
        const idx = dataStore.transactions.findIndex(t => t.id === item.id);
        if (idx === -1) {
          dataStore.transactions.unshift(item);
        } else {
          dataStore.transactions[idx] = item;
        }
        if (item.bankAccountId) {
          void recomputeBankAccountBalance(organizationId, item.bankAccountId);
        }
        dataStore.notify('transactions');
        dataStore.notify('bankAccounts');
        dataStore.notify('budgets');
        dataStore.notify('departments');
        dataStore.notify('projects');
        dataStore.notify('accounts');
      }
      return res;
    }

    await simulateDelay(150);

    const amt = Number(data.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { success: false, data: null as unknown as Transaction, error: 'Amount must be greater than 0' };
    }
    if (!data.bankAccountId) {
      return { success: false, data: null as unknown as Transaction, error: 'A pay-from bank account is required' };
    }

    // Status integrity: classified requires category
    const resolvedStatus = (data.status === 'classified' && !data.categoryId)
      ? 'pending'
      : (data.status || (data.categoryId ? 'classified' : 'pending'));

    const newTxn: Transaction = {
      ...data,
      id: generateId('txn'),
      organizationId,
      amount: amt,
      status: resolvedStatus as Transaction['status'],
      tags: data.tags && data.tags.length > 0 ? data.tags : ['business'],  // Default to business tag
      createdAt: new Date().toISOString(),
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(resolvedStatus === 'classified' && data.categoryId ? {
        classifiedAt: data.classifiedAt || new Date().toISOString(),
        classifiedBy: data.classifiedBy || 'user',
      } : {}),
    };

    // 1. Reactive optimistic update to local store
    dataStore.transactions.unshift(newTxn);
    dataStore.notify('transactions');

    // 2. Direct persistence to Supabase DB table
    if (isSupabaseConfigured()) {
      try {
        await ensureSupabaseDependencies(
          organizationId,
          newTxn.bankAccountId,
          newTxn.categoryId,
          newTxn.projectId,
          newTxn.departmentId,
        );
        const sb = getSupabaseClient();
        if (sb) {
          const dbRow = mapDomainToDbTransaction(newTxn);
          let { error } = await sb.from('transactions').upsert(dbRow, { onConflict: 'id' });
          if (error && (error.message?.includes('department_id') || error.message?.includes('project_id'))) {
            const stripped = { ...dbRow };
            delete (stripped as any).department_id;
            delete (stripped as any).project_id;
            const retryRes = await sb.from('transactions').upsert(stripped, { onConflict: 'id' });
            error = retryRes.error;
          }
          if (error) {
            logUnexpectedError('transactionService.create.supabase', error);
            const rollbackIdx = dataStore.transactions.findIndex(t => t.id === newTxn.id);
            if (rollbackIdx !== -1) {
              dataStore.transactions.splice(rollbackIdx, 1);
              dataStore.notify('transactions');
            }
            return {
              success: false,
              data: null as unknown as Transaction,
              error: `Supabase DB (${error.code || 'Error'}): ${error.message}${error.hint ? ` · Hint: ${error.hint}` : ''}`,
            };
          }
        }
      } catch (err: any) {
        logUnexpectedError('transactionService.create.supabase', err);
        const rollbackIdx = dataStore.transactions.findIndex(t => t.id === newTxn.id);
        if (rollbackIdx !== -1) {
          dataStore.transactions.splice(rollbackIdx, 1);
          dataStore.notify('transactions');
        }
        return {
          success: false,
          data: null as unknown as Transaction,
          error: `Supabase connection error: ${err?.message || String(err)}`,
        };
      }
    }

    // Recompute the bank account balance from real transaction history
    void recomputeBankAccountBalance(organizationId, newTxn.bankAccountId);

    return { success: true, data: newTxn, message: 'Transaction created' };
  },

  /**
   * Bulk create transactions in a single batch
   */
  async bulkCreate(
    organizationId: string,
    transactions: Array<Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>>,
  ): Promise<ServiceResponse<{
    inserted: number;
    failed: number;
    items: Transaction[];
    errors: Array<{ index: number; line: any; error: string }>;
  }>> {
    if (!organizationId || !organizationId.trim()) {
      return {
        success: false,
        data: { inserted: 0, failed: transactions.length, items: [], errors: [] },
        error: 'organizationId required',
      };
    }

    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<
        { transactions: Array<Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>> },
        { inserted: number; failed: number; items: Transaction[]; errors: Array<{ index: number; line: any; error: string }> }
      >(`${TXN_BASE(organizationId)}/bulk`, { transactions });

      if (res.success && res.data) {
        if (Array.isArray(res.data.items)) {
          for (const item of res.data.items) {
            const idx = dataStore.transactions.findIndex(t => t.id === item.id);
            if (idx === -1) {
              dataStore.transactions.unshift(item);
            } else {
              dataStore.transactions[idx] = item;
            }
          }
          const bankIds = Array.from(new Set(res.data.items.map(t => t.bankAccountId).filter(Boolean)));
          for (const bId of bankIds) {
            void recomputeBankAccountBalance(organizationId, bId);
          }
        }
        dataStore.notify('transactions');
        dataStore.notify('bankAccounts');
        dataStore.notify('budgets');
        dataStore.notify('departments');
        dataStore.notify('projects');
        dataStore.notify('accounts');
      }
      return res;
    }

    await simulateDelay(200);

    const inserted: Transaction[] = [];
    const errors: Array<{ index: number; line: any; error: string }> = [];

    transactions.forEach((line, index) => {
      const amt = Number(line.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        errors.push({ index, line, error: 'Amount must be a number greater than 0' });
        return;
      }
      if (!line.bankAccountId) {
        errors.push({ index, line, error: 'Pay-from bank account is required' });
        return;
      }
      const desc = line.description?.trim() || line.narration?.trim();
      if (!desc) {
        errors.push({ index, line, error: 'Description or narration is required' });
        return;
      }

      const resolvedStatus = (line.status === 'classified' && !line.categoryId)
        ? 'pending'
        : (line.status || (line.categoryId ? 'classified' : 'pending'));

      const newTxn: Transaction = {
        ...line,
        id: generateId('txn'),
        organizationId,
        amount: amt,
        currency: line.currency || 'USD',
        type: line.type === 'credit' ? 'credit' : 'debit',
        status: resolvedStatus as Transaction['status'],
        tags: Array.isArray(line.tags) && line.tags.length > 0 ? line.tags : ['business'],  // Default to business tag
        attachments: Array.isArray(line.attachments) ? line.attachments : [],
        createdAt: new Date().toISOString(),
        ...(resolvedStatus === 'classified' && line.categoryId ? {
          classifiedAt: line.classifiedAt || new Date().toISOString(),
          classifiedBy: line.classifiedBy || 'user',
        } : {}),
      };

      dataStore.transactions.unshift(newTxn);
      inserted.push(newTxn);
    });

    dataStore.notify('transactions');

    // Sync batch to Supabase DB table
    if (isSupabaseConfigured() && inserted.length > 0) {
      try {
        const uniqueBankAccs = Array.from(new Set(inserted.map(t => t.bankAccountId).filter(Boolean)));
        const uniqueCats = Array.from(new Set(inserted.map(t => t.categoryId).filter(Boolean))) as string[];
        const uniqueProjs = Array.from(new Set(inserted.map(t => t.projectId).filter(Boolean))) as string[];
        const uniqueDepts = Array.from(new Set(inserted.map(t => t.departmentId).filter(Boolean))) as string[];

        for (const ba of uniqueBankAccs) {
          await ensureSupabaseDependencies(organizationId, ba);
        }
        for (const c of uniqueCats) {
          await ensureSupabaseDependencies(organizationId, undefined, c);
        }
        for (const d of uniqueDepts) {
          await ensureSupabaseDependencies(organizationId, undefined, undefined, undefined, d);
        }
        for (const p of uniqueProjs) {
          await ensureSupabaseDependencies(organizationId, undefined, undefined, p);
        }

        const sb = getSupabaseClient();
        if (sb) {
          const dbRows = inserted.map(mapDomainToDbTransaction);
          let { error } = await sb.from('transactions').upsert(dbRows, { onConflict: 'id' });
          if (error && (error.message?.includes('department_id') || error.message?.includes('project_id'))) {
            const strippedRows = dbRows.map(r => {
              const copy = { ...r };
              delete (copy as any).department_id;
              delete (copy as any).project_id;
              return copy;
            });
            const retryRes = await sb.from('transactions').upsert(strippedRows, { onConflict: 'id' });
            error = retryRes.error;
          }
          if (error) {
            logUnexpectedError('transactionService.bulkCreate.supabase', error);
            const insertedIds = new Set(inserted.map(t => t.id));
            dataStore.transactions = dataStore.transactions.filter(t => !insertedIds.has(t.id));
            dataStore.notify('transactions');
            return {
              success: false,
              data: {
                inserted: 0,
                failed: transactions.length,
                items: [],
                errors: transactions.map((line, idx) => ({ index: idx, line, error: error.message })),
              },
              error: `Supabase DB (${error.code || 'Error'}): ${error.message}${error.hint ? ` · Hint: ${error.hint}` : ''}`,
            };
          }
        }
      } catch (err: any) {
        logUnexpectedError('transactionService.bulkCreate.supabase', err);
        const insertedIds = new Set(inserted.map(t => t.id));
        dataStore.transactions = dataStore.transactions.filter(t => !insertedIds.has(t.id));
        dataStore.notify('transactions');
        return {
          success: false,
          data: {
            inserted: 0,
            failed: transactions.length,
            items: [],
            errors: transactions.map((line, idx) => ({ index: idx, line, error: err?.message || String(err) })),
          },
          error: `Supabase connection error: ${err?.message || String(err)}`,
        };
      }
    }

    // Recompute balances for all affected bank accounts
    const bankAccountsAffected = Array.from(new Set(inserted.map(t => t.bankAccountId).filter(Boolean)));
    for (const bankId of bankAccountsAffected) {
      void recomputeBankAccountBalance(organizationId, bankId);
    }

    return {
      success: true,
      data: {
        inserted: inserted.length,
        failed: errors.length,
        items: inserted,
        errors,
      },
      message: `${inserted.length} transactions created${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
    };
  },

  /**
   * PATCH transaction. Pass `organizationId` when using HTTP (org-scoped route).
   */
  async update(
    id: string,
    updates: Partial<Transaction>,
    organizationId?: string,
  ): Promise<ServiceResponse<Transaction>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${TXN_BASE(organizationId)}/${encodeURIComponent(id)}`
        : `/transactions/${encodeURIComponent(id)}`;
      return apiRequest<Transaction>(path, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    }

    await simulateDelay(100);

    const idx = dataStore.transactions.findIndex(t => t.id === id && (!organizationId || t.organizationId === organizationId));
    if (idx === -1) {
      return { success: false, data: null as any, error: 'Transaction not found' };
    }

    const orgId = organizationId || dataStore.transactions[idx].organizationId;
    // Capture original bank account id BEFORE the merge (needed if bankAccountId is being changed)
    const oldBankAccountId = dataStore.transactions[idx].bankAccountId;
    dataStore.transactions[idx] = { ...dataStore.transactions[idx], ...updates };
    dataStore.notify('transactions');

    if (isSupabaseConfigured()) {
      try {
        const dbUpdates: Record<string, any> = {};
        if (updates.bankAccountId !== undefined) dbUpdates.bank_account_id = updates.bankAccountId;
        if (updates.date !== undefined) dbUpdates.date = updates.date;
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
        if (updates.confidence !== undefined) dbUpdates.confidence = updates.confidence;
        if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
        if (updates.attachments !== undefined) dbUpdates.attachments = updates.attachments;
        if (updates.classifiedAt !== undefined) dbUpdates.classified_at = updates.classifiedAt;
        if (updates.classifiedBy !== undefined) dbUpdates.classified_by = updates.classifiedBy;

        const sb = getSupabaseClient();
        if (sb) {
          let q = sb.from('transactions').update(dbUpdates).eq('id', id);
          if (orgId) q = q.eq('organization_id', orgId);
          const { error } = await q;
          if (error) logUnexpectedError('transactionService.update.supabase', error);
        }
      } catch (err) {
        logUnexpectedError('transactionService.update.supabase', err);
      }
    }

    // Recompute balance for the affected bank account(s)
    const newBankAccountId = dataStore.transactions[idx]?.bankAccountId;
    if (newBankAccountId) {
      void recomputeBankAccountBalance(orgId, newBankAccountId);
    }
    // If bankAccountId changed, also recompute the old account
    if (oldBankAccountId && oldBankAccountId !== newBankAccountId) {
      void recomputeBankAccountBalance(orgId, oldBankAccountId);
    }

    return { success: true, data: dataStore.transactions[idx], message: 'Transaction updated' };
  },

  async createTransfer(
    organizationId: string,
    params: {
      fromBankAccountId: string;
      toBankAccountId: string;
      amount: number;
      currency?: string;
      toCurrency?: string;
      fxRate?: number;
      convertedAmount?: number;
      date?: string;
      description?: string;
      transferType?: 'bank_to_bank' | 'atm_withdrawal' | 'cash_deposit' | 'wallet_transfer';
    },
  ): Promise<ServiceResponse<{ transferId: string; outflow: Transaction; inflow: Transaction }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<typeof params, { transferId: string; outflow: Transaction; inflow: Transaction }>(
        `${TXN_BASE(organizationId)}/transfers`,
        params,
      );
    }
    return { success: false, data: null as any, error: 'Transfer requires backend connection' };
  },

  async postToLedger(
    id: string,
    organizationId: string,
  ): Promise<ServiceResponse<Transaction>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<Transaction>(`${TXN_BASE(organizationId)}/${encodeURIComponent(id)}/post`, { method: 'POST' });
    }
    return { success: false, data: null as any, error: 'Ledger posting requires backend connection' };
  },

  async reverseTransaction(
    id: string,
    organizationId: string,
    reason?: string,
  ): Promise<ServiceResponse<{ id: string; status: string; reason: string }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ reason?: string }, { id: string; status: string; reason: string }>(
        `${TXN_BASE(organizationId)}/${encodeURIComponent(id)}/reverse`,
        { reason },
      );
    }
    return { success: false, data: null as any, error: 'Transaction reversal requires backend connection' };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${TXN_BASE(organizationId)}/${encodeURIComponent(id)}`
        : `/transactions/${encodeURIComponent(id)}`;
      return apiRequest<null>(path, { method: 'DELETE' });
    }

    await simulateDelay(100);

    const idx = dataStore.transactions.findIndex(t => t.id === id && (!organizationId || t.organizationId === organizationId));
    if (idx === -1) {
      return { success: false, data: null, error: 'Transaction not found' };
    }

    const orgId = organizationId || dataStore.transactions[idx].organizationId;

    // Capture bank account info before deleting from the local store
    const deletedTxn = dataStore.transactions[idx];
    const deletedBankId = deletedTxn?.bankAccountId;
    const deletedOrgId = deletedTxn?.organizationId || orgId;

    dataStore.transactions.splice(idx, 1);
    dataStore.notify('transactions');

    if (isSupabaseConfigured()) {
      try {
        const sb = getSupabaseClient();
        if (sb) {
          let q = sb.from('transactions').delete().eq('id', id);
          if (orgId) q = q.eq('organization_id', orgId);
          const { error } = await q;
          if (error) logUnexpectedError('transactionService.delete.supabase', error);
        }
      } catch (err) {
        logUnexpectedError('transactionService.delete.supabase', err);
      }
    }

    // Recompute balance of the bank account that held this transaction
    if (deletedBankId) {
      void recomputeBankAccountBalance(deletedOrgId, deletedBankId);
    }

    return { success: true, data: null, message: 'Transaction deleted' };
  },

  async bulkCategorize(
    organizationId: string,
    ids: string[],
    categoryId: string,
    classifiedBy: string = 'user',
  ): Promise<ServiceResponse<BulkOperationResult>> {
    if (!organizationId || !organizationId.trim()) {
      return {
        success: false,
        data: { succeeded: 0, failed: ids.length, errors: [] },
        error: 'organizationId required',
      };
    }

    if (isHttpBackendConfigured()) {
      return apiPostJson<
        { ids: string[]; categoryId: string; classifiedBy: string },
        BulkOperationResult
      >(`${TXN_BASE(organizationId)}/bulk-categorize`, { ids, categoryId, classifiedBy });
    }

    await simulateDelay(200);

    let succeeded = 0;
    const errors: { id: string; error: string }[] = [];
    const now = new Date().toISOString();

    for (const id of ids) {
      const idx = dataStore.transactions.findIndex(t => t.id === id && t.organizationId === organizationId);
      if (idx === -1) {
        errors.push({ id, error: 'Not found' });
      } else {
        dataStore.transactions[idx] = {
          ...dataStore.transactions[idx],
          categoryId,
          status: 'classified',
          classifiedAt: now,
          classifiedBy,
        };
        succeeded++;
      }
    }

    dataStore.notify('transactions');

    if (isSupabaseConfigured() && succeeded > 0) {
      try {
        await ensureSupabaseDependencies(organizationId, undefined, categoryId);
        const sb = getSupabaseClient();
        if (sb) {
          const { error } = await sb
            .from('transactions')
            .update({
              category_id: categoryId,
              status: 'classified',
              classified_at: now,
              classified_by: classifiedBy,
            })
            .in('id', ids)
            .eq('organization_id', organizationId);
          if (error) logUnexpectedError('transactionService.bulkCategorize.supabase', error);
        }
      } catch (err) {
        logUnexpectedError('transactionService.bulkCategorize.supabase', err);
      }
    }

    return {
      success: true,
      data: { succeeded, failed: errors.length, errors },
      message: `${succeeded} transactions categorized`,
    };
  },

  async bulkDelete(organizationId: string, ids: string[]): Promise<ServiceResponse<BulkOperationResult>> {
    if (!organizationId || !organizationId.trim()) {
      return {
        success: false,
        data: { succeeded: 0, failed: ids.length, errors: [] },
        error: 'organizationId required',
      };
    }

    if (isHttpBackendConfigured()) {
      return apiPostJson<{ ids: string[] }, BulkOperationResult>(
        `${TXN_BASE(organizationId)}/bulk-delete`,
        { ids },
      );
    }

    await simulateDelay(150);

    let succeeded = 0;
    const errors: { id: string; error: string }[] = [];
    const affectedBankIds = new Set<string>();

    for (const id of ids) {
      const idx = dataStore.transactions.findIndex(t => t.id === id && t.organizationId === organizationId);
      if (idx === -1) {
        errors.push({ id, error: 'Not found' });
      } else {
        const t = dataStore.transactions[idx];
        if (t?.bankAccountId) affectedBankIds.add(t.bankAccountId);
        dataStore.transactions.splice(idx, 1);
        succeeded++;
      }
    }

    dataStore.notify('transactions');

    if (isSupabaseConfigured() && succeeded > 0) {
      try {
        const sb = getSupabaseClient();
        if (sb) {
          const { error } = await sb
            .from('transactions')
            .delete()
            .in('id', ids)
            .eq('organization_id', organizationId);
          if (error) logUnexpectedError('transactionService.bulkDelete.supabase', error);
        }
      } catch (err) {
        logUnexpectedError('transactionService.bulkDelete.supabase', err);
      }
    }

    // Recompute balances for all affected bank accounts
    for (const bankId of affectedBankIds) {
      void recomputeBankAccountBalance(organizationId, bankId);
    }

    return {
      success: true,
      data: { succeeded, failed: errors.length, errors },
      message: `${succeeded} transactions deleted`,
    };
  },

  async getStats(organizationId: string, dateFrom?: string, dateTo?: string): Promise<ServiceResponse<{
    totalIncome: number;
    totalExpenses: number;
    netAmount: number;
    transactionCount: number;
    pendingCount: number;
    classifiedCount: number;
    avgConfidence: number;
  }>> {
    if (isHttpBackendConfigured()) {
      if (!organizationId.trim()) {
        return {
          success: false,
          data: null as unknown as {
            totalIncome: number;
            totalExpenses: number;
            netAmount: number;
            transactionCount: number;
            pendingCount: number;
            classifiedCount: number;
            avgConfidence: number;
          },
          error: 'organizationId required',
        };
      }
      const q = new URLSearchParams();
      if (dateFrom) q.set('dateFrom', dateFrom);
      if (dateTo) q.set('dateTo', dateTo);
      const qs = q.toString();
      return apiGet<{
        totalIncome: number;
        totalExpenses: number;
        netAmount: number;
        transactionCount: number;
        pendingCount: number;
        classifiedCount: number;
        avgConfidence: number;
      }>(`${TXN_BASE(organizationId)}/stats${qs ? `?${qs}` : ''}`);
    }

    await simulateDelay();

    let txns = dataStore.transactions.filter(t => t.organizationId === organizationId);
    if (dateFrom) txns = txns.filter(t => t.date >= dateFrom);
    if (dateTo) txns = txns.filter(t => t.date <= dateTo);

    const totalIncome = txns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = txns.filter(t => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0);
    const pendingCount = txns.filter(t => t.status === 'pending').length;
    const classifiedCount = txns.filter(t => t.status !== 'pending').length;
    const confidences = txns.filter(t => t.confidence !== undefined).map(t => t.confidence!);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0;

    return {
      success: true,
      data: {
        totalIncome,
        totalExpenses,
        netAmount: totalIncome - totalExpenses,
        transactionCount: txns.length,
        pendingCount,
        classifiedCount,
        avgConfidence: Math.round(avgConfidence),
      },
    };
  },
};
