/**
 * Account (Chart of Accounts & Bank Accounts) Service
 * ====================================================
 * Comprehensive CRUD, hierarchy, and financial summary for chart of accounts
 * and physical bank accounts / wallets.
 *
 * PERSISTENCE:
 * - Direct Supabase queries and mutations against `public.accounts` and `public.bank_accounts`.
 * - Automatically ensures baseline chart of accounts exist in Supabase for new organizations.
 * - Synchronizes in-memory cache and UI listeners upon successful Supabase mutations.
 */

import type { Account, BankAccount } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabaseClient';
import { convertCurrency } from '@/lib/currencyUtils';
import { dataStore, generateId } from './dataStore';
import type { ServiceResponse, BalanceSheetReport } from './types';

const ACC = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/accounts`;

const BANK = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/bank-accounts`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId?.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export function mapDomainToDbAccount(acc: Account): Record<string, unknown> {
  return {
    id: acc.id,
    organization_id: acc.organizationId,
    code: acc.code,
    name: acc.name,
    type: acc.type,
    subtype: acc.subtype ?? '',
    currency: acc.currency || 'USD',
    balance: Number.isFinite(acc.balance) ? acc.balance : 0,
    is_active: acc.isActive ?? true,
    parent_account_id: acc.parentAccountId || null,
    created_at: acc.createdAt || new Date().toISOString(),
  };
}

export function mapDbToDomainAccount(row: Record<string, any>): Account {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    type: row.type as Account['type'],
    subtype: String(row.subtype ?? ''),
    currency: String(row.currency ?? 'USD'),
    balance: Number(row.balance ?? 0),
    isActive: Boolean(row.is_active ?? true),
    parentAccountId: row.parent_account_id ? String(row.parent_account_id) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

export function mapDomainToDbBankAccount(b: BankAccount, isNew = false): Record<string, unknown> {
  const bal = Number.isFinite(b.balance) ? b.balance : 0;
  return {
    id: b.id,
    organization_id: b.organizationId,
    account_id: b.accountId,
    bank_name: b.bankName || '',
    account_number: b.accountNumber || '',
    account_type: b.accountType,
    currency: b.currency || 'USD',
    balance: bal,
    // Store the initial balance as opening_balance on first insert so
    // recomputeBankAccountBalance can use it as the baseline.
    ...(isNew ? { opening_balance: bal } : {}),
    last_synced_at: b.lastSyncedAt || null,
    is_active: b.isActive ?? true,
    iban: b.iban || null,
    swift_code: b.swiftCode || null,
    routing_number: b.routingNumber || null,
    usage: b.usage || null,
  };
}

export function mapDbToDomainBankAccount(row: Record<string, any>): BankAccount {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    accountId: String(row.account_id),
    bankName: String(row.bank_name ?? ''),
    accountNumber: String(row.account_number ?? ''),
    accountType: row.account_type as BankAccount['accountType'],
    currency: String(row.currency ?? 'USD'),
    balance: Number(row.balance ?? 0),
    openingBalance: row.opening_balance != null ? Number(row.opening_balance) : undefined,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : undefined,
    isActive: Boolean(row.is_active ?? true),
    iban: row.iban ? String(row.iban) : undefined,
    swiftCode: row.swift_code ? String(row.swift_code) : undefined,
    routingNumber: row.routing_number ? String(row.routing_number) : undefined,
    usage: (row.usage === 'personal' || row.usage === 'business') ? row.usage : undefined,
  };
}

/**
 * Recomputes a bank account's balance from its transactions in Supabase:
 *   balance = opening_balance + SUM(credits) − SUM(debits)
 *
 * Should be called after every transaction create / update / delete that
 * affects the given bank account so the stored `balance` column stays fresh.
 *
 * Works silently — never throws; errors are swallowed so callers don't fail.
 */
export async function recomputeBankAccountBalance(
  organizationId: string,
  bankAccountId: string,
): Promise<void> {
  if (!organizationId || !bankAccountId) return;

  const sb = getSupabaseClient();
  if (!isSupabaseConfigured() || !sb) {
    // Fallback: compute from in-memory dataStore
    const bankAcc = dataStore.bankAccounts.find(
      b => b.id === bankAccountId && b.organizationId === organizationId,
    );
    if (!bankAcc) return;
    const base = bankAcc.openingBalance ?? bankAcc.balance ?? 0;
    const txns = dataStore.transactions.filter(
      t => t.bankAccountId === bankAccountId && t.organizationId === organizationId,
    );
    const newBalance = base + txns.reduce(
      (sum, t) => (t.type === 'credit' ? sum + Math.abs(Number(t.amount || 0)) : sum - Math.abs(Number(t.amount || 0))),
      0,
    );
    const idx = dataStore.bankAccounts.findIndex(b => b.id === bankAccountId);
    if (idx !== -1) {
      dataStore.bankAccounts[idx] = { ...dataStore.bankAccounts[idx], balance: newBalance };
      dataStore.notify('bankAccounts');
    }
    return;
  }

  try {
    // 1. Fetch opening_balance, balance & currency from bank_accounts row
    const { data: bankRow, error: bankErr } = await sb
      .from('bank_accounts')
      .select('opening_balance, balance, currency')
      .eq('id', bankAccountId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (bankErr || !bankRow) return;

    const bankCurrency = (bankRow as any)?.currency || 'USD';

    // Determine the baseline opening balance
    const rawOpening = (bankRow as any)?.opening_balance;
    const openingBalance = rawOpening != null
      ? Number(rawOpening)
      : 0;

    // 2. Sum ALL eligible transactions for this bank account with FX conversion
    const { data: txns, error: txnErr } = await sb
      .from('transactions')
      .select('*')
      .eq('bank_account_id', bankAccountId)
      .eq('organization_id', organizationId)
      .not('status', 'in', '("draft","pending","rejected","reversed","cancelled")');

    if (txnErr) return;

    const eligibleTxns = (txns || []).filter(
      (t: any) => !['draft', 'pending', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
    );

    const newBalance = eligibleTxns.reduce((sum: number, t: any) => {
      const rawAmt = Number(t.amount || 0);
      const txnCurrency = t.currency || bankCurrency;
      let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
      if (!fxRate && Array.isArray(t.tags)) {
        const rTag = t.tags.find((tag: string) => tag.startsWith('fx:rate:'));
        if (rTag) fxRate = Number(rTag.slice(8));
      }
      const convertedAmt = convertCurrency(
        rawAmt,
        txnCurrency,
        bankCurrency,
        fxRate,
      );
      return t.type === 'credit' ? sum + Math.abs(convertedAmt) : sum - Math.abs(convertedAmt);
    }, openingBalance);

    const roundedBalance = Math.round(newBalance * 100) / 100;

    // 3. Persist computed balance back to Supabase
    await sb
      .from('bank_accounts')
      .update({ balance: roundedBalance, last_synced_at: new Date().toISOString() })
      .eq('id', bankAccountId)
      .eq('organization_id', organizationId);

    if ((bankRow as any)?.account_id) {
      await sb
        .from('accounts')
        .update({ balance: roundedBalance })
        .eq('id', (bankRow as any).account_id)
        .eq('organization_id', organizationId);
    }

    // 4. Update in-memory cache so UI re-renders immediately
    const idx = dataStore.bankAccounts.findIndex(b => b.id === bankAccountId);
    if (idx !== -1) {
      dataStore.bankAccounts[idx] = {
        ...dataStore.bankAccounts[idx],
        balance: newBalance,
        openingBalance,
      };
      dataStore.notify('bankAccounts');
    }
  } catch {
    // Silent — balance recompute is a best-effort background operation
  }
}

/**
 * Standard baseline Chart of Accounts to seed in Supabase for any new organization.
 */
function buildDefaultChartAccounts(organizationId: string, currency = 'USD'): Account[] {
  const now = new Date().toISOString();
  return [
    {
      id: `acc-${organizationId}-cash-bank`,
      organizationId,
      code: '1010',
      name: 'Cash at bank',
      type: 'asset',
      subtype: 'current_asset',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-petty-cash`,
      organizationId,
      code: '1020',
      name: 'Petty Cash & Online Wallets',
      type: 'asset',
      subtype: 'current_asset',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-receivables`,
      organizationId,
      code: '1200',
      name: 'Accounts Receivable',
      type: 'asset',
      subtype: 'current_asset',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-payables`,
      organizationId,
      code: '2000',
      name: 'Accounts Payable & Credit Lines',
      type: 'liability',
      subtype: 'current_liability',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-equity`,
      organizationId,
      code: '3000',
      name: "Owner's Equity & Retained Earnings",
      type: 'equity',
      subtype: 'equity',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-revenue`,
      organizationId,
      code: '4000',
      name: 'Client Revenue & Sales',
      type: 'income',
      subtype: 'revenue',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-cogs`,
      organizationId,
      code: '5000',
      name: 'Contractor & Service Direct Costs',
      type: 'expense',
      subtype: 'cogs',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-operating-expense`,
      organizationId,
      code: '6000',
      name: 'General & Operating Expenses',
      type: 'expense',
      subtype: 'operating_expense',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
  ];
}

/**
 * Ensures an organization record exists in Supabase before foreign key operations.
 */
async function ensureOrganizationInSupabase(organizationId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;

  try {
    const org = dataStore.organizations.find(o => o.id === organizationId);
    await sb.from('organizations').upsert(
      {
        id: organizationId,
        name: org?.name || 'My Organization',
        slug: org?.slug || organizationId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        currency: org?.currency || 'USD',
        fiscal_year_start: org?.fiscalYearStart || '01-01',
        settings: org?.settings || { theme: 'dark', notifications: true },
      },
      { onConflict: 'id' },
    );
  } catch {
    /* ignore upsert error if already present */
  }
}

export const accountService = {
  /**
   * Ensures default baseline chart of accounts exist in Supabase for the organization.
   */
  async ensureDefaultChartAccounts(organizationId: string, currency?: string): Promise<Account[]> {
    if (!organizationId) return [];
    const defaults = buildDefaultChartAccounts(organizationId, currency || 'USD');

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          await ensureOrganizationInSupabase(organizationId);
          const dbRows = defaults.map(mapDomainToDbAccount);
          const { error } = await sb.from('accounts').upsert(dbRows, { onConflict: 'id' });
          if (!error) {
            dataStore.accounts = [
              ...dataStore.accounts.filter(a => a.organizationId !== organizationId),
              ...defaults,
            ];
            dataStore.notify('accounts');
            return defaults;
          }
        } catch {
          /* fallback */
        }
      }
    }

    // Sync in-memory cache
    for (const acc of defaults) {
      const exists = dataStore.accounts.some(a => a.id === acc.id || (a.organizationId === organizationId && a.code === acc.code));
      if (!exists) {
        dataStore.accounts.push(acc);
      }
    }
    dataStore.notify('accounts');

    return defaults;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Chart of Accounts (accounts)
  // ═══════════════════════════════════════════════════════════════════════════

  async getAll(organizationId: string): Promise<ServiceResponse<Account[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Account[]>(organizationId);
      if (err) return err;
      return apiGet<Account[]>(ACC(organizationId));
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb && organizationId) {
        try {
          const { data, error } = await sb
            .from('accounts')
            .select('*')
            .eq('organization_id', organizationId)
            .order('code', { ascending: true });

          if (error) {
            return { success: false, data: [], error: error.message };
          }

          if (data && data.length === 0) {
            // Provision standard Chart of Accounts into Supabase if organization is fresh
            const seeded = await this.ensureDefaultChartAccounts(organizationId);
            return { success: true, data: seeded };
          }

          const accounts = (data || []).map(mapDbToDomainAccount);
          dataStore.accounts = [
            ...dataStore.accounts.filter(a => a.organizationId !== organizationId),
            ...accounts,
          ];
          return { success: true, data: accounts };
        } catch (err: any) {
          return { success: false, data: [], error: err?.message || 'Failed to fetch accounts from Supabase' };
        }
      }
    }

    let accounts = dataStore.accounts.filter(a => a.organizationId === organizationId);
    if (accounts.length === 0 && organizationId) {
      accounts = await this.ensureDefaultChartAccounts(organizationId);
    }
    return { success: true, data: accounts };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Account | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ACC(organizationId)}/${encodeURIComponent(id)}`
        : `/accounts/${encodeURIComponent(id)}`;
      return apiGet<Account | null>(path);
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          let q = sb.from('accounts').select('*').eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { data, error } = await q.maybeSingle();
          if (error) {
            return { success: false, data: null, error: error.message };
          }
          if (data) {
            return { success: true, data: mapDbToDomainAccount(data) };
          }
          return { success: false, data: null, error: 'Account not found' };
        } catch (err: any) {
          return { success: false, data: null, error: err?.message || 'Supabase query error' };
        }
      }
    }

    const account = dataStore.accounts.find(a => a.id === id && (!organizationId || a.organizationId === organizationId)) || null;
    return { success: !!account, data: account };
  },

  async create(
    organizationId: string,
    data: Omit<Account, 'id' | 'organizationId' | 'createdAt'>,
  ): Promise<ServiceResponse<Account>> {
    const err = requireOrg<Account>(organizationId);
    if (err) return err;

    if (!data.name?.trim()) {
      return { success: false, data: null as unknown as Account, error: 'Account name is required' };
    }
    if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(data.type)) {
      return { success: false, data: null as unknown as Account, error: `Invalid account type: ${data.type}` };
    }

    if (isHttpBackendConfigured()) {
      return apiPostJson<Omit<Account, 'id' | 'organizationId' | 'createdAt'>, Account>(
        ACC(organizationId),
        data,
      );
    }

    const newAcc: Account = {
      ...data,
      id: generateId('acc'),
      organizationId,
      createdAt: new Date().toISOString(),
      balance: Number.isFinite(data.balance) ? Number(data.balance) : 0,
      isActive: data.isActive ?? true,
    };

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          await ensureOrganizationInSupabase(organizationId);
          const { data: dbData, error } = await sb
            .from('accounts')
            .insert(mapDomainToDbAccount(newAcc))
            .select()
            .single();

          if (error) {
            return { success: false, data: null as unknown as Account, error: error.message };
          }

          if (dbData) {
            const domain = mapDbToDomainAccount(dbData);
            dataStore.accounts.push(domain);
            dataStore.notify('accounts');
            return { success: true, data: domain, message: 'Account created' };
          }
        } catch (err: any) {
          return { success: false, data: null as unknown as Account, error: err?.message || 'Failed to create account in Supabase' };
        }
      }
    }

    dataStore.accounts.push(newAcc);
    dataStore.notify('accounts');
    return { success: true, data: newAcc, message: 'Account created' };
  },

  async update(
    id: string,
    updates: Partial<Account>,
    organizationId?: string,
  ): Promise<ServiceResponse<Account>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ACC(organizationId)}/${encodeURIComponent(id)}`
        : `/accounts/${encodeURIComponent(id)}`;
      return apiRequest<Account>(path, { method: 'PATCH', body: JSON.stringify(updates) });
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const dbUpdates: Record<string, unknown> = {};
          if (updates.name !== undefined) dbUpdates.name = updates.name;
          if (updates.code !== undefined) dbUpdates.code = updates.code;
          if (updates.type !== undefined) dbUpdates.type = updates.type;
          if (updates.subtype !== undefined) dbUpdates.subtype = updates.subtype;
          if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
          if (updates.balance !== undefined) dbUpdates.balance = Number(updates.balance);
          if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
          if (updates.parentAccountId !== undefined) dbUpdates.parent_account_id = updates.parentAccountId || null;

          let q = sb.from('accounts').update(dbUpdates).eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { data, error } = await q.select().single();
          if (error) {
            return { success: false, data: null as unknown as Account, error: error.message };
          }
          if (data) {
            const domain = mapDbToDomainAccount(data);
            const idx = dataStore.accounts.findIndex(a => a.id === id);
            if (idx !== -1) dataStore.accounts[idx] = domain;
            else dataStore.accounts.push(domain);
            dataStore.notify('accounts');
            return { success: true, data: domain, message: 'Account updated' };
          }
        } catch (err: any) {
          return { success: false, data: null as unknown as Account, error: err?.message || 'Failed to update account' };
        }
      }
    }

    const idx = dataStore.accounts.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null as unknown as Account, error: 'Account not found' };
    dataStore.accounts[idx] = { ...dataStore.accounts[idx], ...updates };
    dataStore.notify('accounts');
    return { success: true, data: dataStore.accounts[idx], message: 'Account updated' };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ACC(organizationId)}/${encodeURIComponent(id)}`
        : `/accounts/${encodeURIComponent(id)}`;
      return apiRequest<null>(path, { method: 'DELETE' });
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          // Check if any bank accounts or transactions reference this account
          const { data: linkedBanks } = await sb
            .from('bank_accounts')
            .select('id')
            .eq('account_id', id)
            .limit(1);

          if (linkedBanks && linkedBanks.length > 0) {
            return {
              success: false,
              data: null,
              error: 'Cannot delete chart account linked to active bank accounts / payment methods. Deactivate it instead.',
            };
          }

          let q = sb.from('accounts').delete().eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { error } = await q;
          if (error) {
            return { success: false, data: null, error: error.message };
          }

          const idx = dataStore.accounts.findIndex(a => a.id === id);
          if (idx !== -1) dataStore.accounts.splice(idx, 1);
          dataStore.notify('accounts');
          return { success: true, data: null, message: 'Account deleted' };
        } catch (err: any) {
          return { success: false, data: null, error: err?.message || 'Failed to delete account in Supabase' };
        }
      }
    }

    const idx = dataStore.accounts.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Account not found' };
    dataStore.accounts.splice(idx, 1);
    dataStore.notify('accounts');
    return { success: true, data: null, message: 'Account deleted' };
  },

  async getAccountTree(organizationId: string): Promise<ServiceResponse<{
    assets: Account[];
    liabilities: Account[];
    equity: Account[];
    income: Account[];
    expenses: Account[];
  }>> {
    const res = await this.getAll(organizationId);
    if (!res.success || !res.data) {
      return { success: false, data: null as any, error: res.error };
    }
    const accounts = res.data;
    return {
      success: true,
      data: {
        assets: accounts.filter(a => a.type === 'asset'),
        liabilities: accounts.filter(a => a.type === 'liability'),
        equity: accounts.filter(a => a.type === 'equity'),
        income: accounts.filter(a => a.type === 'income'),
        expenses: accounts.filter(a => a.type === 'expense'),
      },
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Bank Accounts / Payment Methods (bank_accounts)
  // ═══════════════════════════════════════════════════════════════════════════

  async getBankAccounts(organizationId: string): Promise<ServiceResponse<BankAccount[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<BankAccount[]>(organizationId);
      if (err) return err;
      return apiGet<BankAccount[]>(BANK(organizationId));
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb && organizationId) {
        try {
          // Ensure baseline chart accounts exist in Supabase first
          await this.getAll(organizationId);

          const { data, error } = await sb
            .from('bank_accounts')
            .select('*')
            .eq('organization_id', organizationId)
            .order('bank_name', { ascending: true });

          if (error) {
            return { success: false, data: [], error: error.message };
          }

          // Fetch all transactions for the organization to compute live balances with FX conversion
          const { data: txns } = await sb
            .from('transactions')
            .select('*')
            .eq('organization_id', organizationId);

          const bankAccounts = (data || []).map((row: any) => {
            const domain = mapDbToDomainBankAccount(row);
            const bankCurrency = domain.currency || 'USD';
            const accountTxns = (txns || []).filter(
              (t: any) =>
                t.bank_account_id === domain.id &&
                !['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
            );

            if (accountTxns.length > 0) {
              const rawOpening = row.opening_balance;
              const openingBal = rawOpening != null
                ? Number(rawOpening)
                : 0;

              const liveBalance = accountTxns.reduce((sum: number, t: any) => {
                const rawAmt = Number(t.amount || 0);
                const txnCurrency = t.currency || bankCurrency;
                let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
                if (!fxRate && Array.isArray(t.tags)) {
                  const rTag = t.tags.find((tag: string) => tag.startsWith('fx:rate:'));
                  if (rTag) fxRate = Number(rTag.slice(8));
                }
                const convertedAmt = convertCurrency(
                  rawAmt,
                  txnCurrency,
                  bankCurrency,
                  fxRate,
                );
                return t.type === 'credit' ? sum + convertedAmt : sum - Math.abs(convertedAmt);
              }, openingBal);

              domain.balance = Math.round(liveBalance * 100) / 100;
            }
            return domain;
          });

          dataStore.bankAccounts = [
            ...dataStore.bankAccounts.filter(b => b.organizationId !== organizationId),
            ...bankAccounts,
          ];
          return { success: true, data: bankAccounts };
        } catch (err: any) {
          return { success: false, data: [], error: err?.message || 'Failed to fetch bank accounts from Supabase' };
        }
      }
    }

    const accounts = dataStore.bankAccounts.filter(b => b.organizationId === organizationId);
    return { success: true, data: accounts };
  },

  async createBankAccount(
    organizationId: string,
    data: Omit<BankAccount, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<BankAccount>> {
    const err = requireOrg<BankAccount>(organizationId);
    if (err) return err;

    if (!data.bankName?.trim()) {
      return { success: false, data: null as unknown as BankAccount, error: 'Account/bank name is required' };
    }

    if (isHttpBackendConfigured()) {
      return apiPostJson<Omit<BankAccount, 'id' | 'organizationId'>, BankAccount>(
        BANK(organizationId),
        data,
      );
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          await ensureOrganizationInSupabase(organizationId);
          // Ensure chart accounts are available in Supabase
          const chartRes = await this.getAll(organizationId);

          let chartAccountId = data.accountId?.trim();
          if (!chartAccountId) {
            const isCard = data.accountType === 'credit_card' || data.accountType === 'line_of_credit';
            const match = chartRes.data?.find(a => (isCard ? a.type === 'liability' : a.type === 'asset') && a.isActive)
              ?? chartRes.data?.find(a => a.type === 'asset')
              ?? chartRes.data?.[0];
            chartAccountId = match?.id ?? `acc-${organizationId}-cash-bank`;
          }

          const newBank: BankAccount = {
            ...data,
            id: generateId('bank'),
            organizationId,
            accountId: chartAccountId,
            balance: Number.isFinite(data.balance) ? Number(data.balance) : 0,
            isActive: data.isActive ?? true,
          };

          let { data: dbData, error } = await sb
            .from('bank_accounts')
            .insert(mapDomainToDbBankAccount(newBank, true))
            .select()
            .single();

          if (error && (error.code === 'PGRST204' || error.message?.includes('opening_balance'))) {
            const fallbackRes = await sb
              .from('bank_accounts')
              .insert(mapDomainToDbBankAccount(newBank, false))
              .select()
              .single();
            dbData = fallbackRes.data;
            error = fallbackRes.error;
          }

          if (error) {
            return { success: false, data: null as unknown as BankAccount, error: error.message };
          }

          if (dbData) {
            const domain = mapDbToDomainBankAccount(dbData);
            dataStore.bankAccounts.push(domain);
            dataStore.notify('bankAccounts');
            return { success: true, data: domain, message: 'Account added successfully' };
          }
        } catch (err: any) {
          return { success: false, data: null as unknown as BankAccount, error: err?.message || 'Failed to insert bank account in Supabase' };
        }
      }
    }

    const newBank: BankAccount = {
      ...data,
      id: generateId('bank'),
      organizationId,
      accountId: data.accountId || `acc-${organizationId}-cash-bank`,
      balance: Number.isFinite(data.balance) ? Number(data.balance) : 0,
      isActive: data.isActive ?? true,
    };
    dataStore.bankAccounts.push(newBank);
    dataStore.notify('bankAccounts');
    return { success: true, data: newBank, message: 'Account added successfully' };
  },

  async updateBankAccount(
    id: string,
    updates: Partial<BankAccount>,
    organizationId?: string,
  ): Promise<ServiceResponse<BankAccount>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${BANK(organizationId)}/${encodeURIComponent(id)}`
        : `/bank-accounts/${encodeURIComponent(id)}`;
      return apiRequest<BankAccount>(path, { method: 'PATCH', body: JSON.stringify(updates) });
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const dbUpdates: Record<string, unknown> = {};
          if (updates.bankName !== undefined) dbUpdates.bank_name = updates.bankName;
          if (updates.accountNumber !== undefined) dbUpdates.account_number = updates.accountNumber;
          if (updates.accountType !== undefined) dbUpdates.account_type = updates.accountType;
          if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
          if (updates.balance !== undefined) dbUpdates.balance = Number(updates.balance);
          if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
          if (updates.accountId !== undefined) dbUpdates.account_id = updates.accountId;
          if (updates.iban !== undefined) dbUpdates.iban = updates.iban || null;
          if (updates.swiftCode !== undefined) dbUpdates.swift_code = updates.swiftCode || null;
          if (updates.routingNumber !== undefined) dbUpdates.routing_number = updates.routingNumber || null;
          if (updates.usage !== undefined) dbUpdates.usage = updates.usage || null;

          let q = sb.from('bank_accounts').update(dbUpdates).eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { data, error } = await q.select().single();
          if (error) {
            return { success: false, data: null as unknown as BankAccount, error: error.message };
          }
          if (data) {
            const domain = mapDbToDomainBankAccount(data);
            const idx = dataStore.bankAccounts.findIndex(b => b.id === id);
            if (idx !== -1) dataStore.bankAccounts[idx] = domain;
            else dataStore.bankAccounts.push(domain);
            dataStore.notify('bankAccounts');
            return { success: true, data: domain, message: 'Account updated' };
          }
        } catch (err: any) {
          return { success: false, data: null as unknown as BankAccount, error: err?.message || 'Failed to update bank account in Supabase' };
        }
      }
    }

    const idx = dataStore.bankAccounts.findIndex(b => b.id === id);
    if (idx === -1) return { success: false, data: null as unknown as BankAccount, error: 'Bank account not found' };
    dataStore.bankAccounts[idx] = { ...dataStore.bankAccounts[idx], ...updates };
    dataStore.notify('bankAccounts');
    return { success: true, data: dataStore.bankAccounts[idx], message: 'Account updated' };
  },

  async deleteBankAccount(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${BANK(organizationId)}/${encodeURIComponent(id)}`
        : `/bank-accounts/${encodeURIComponent(id)}`;
      return apiRequest<null>(path, { method: 'DELETE' });
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          let q = sb.from('bank_accounts').delete().eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { error } = await q;
          if (error) {
            return { success: false, data: null, error: error.message };
          }

          const idx = dataStore.bankAccounts.findIndex(b => b.id === id);
          if (idx !== -1) dataStore.bankAccounts.splice(idx, 1);
          dataStore.notify('bankAccounts');
          return { success: true, data: null, message: 'Payment method removed' };
        } catch (err: any) {
          return { success: false, data: null, error: err?.message || 'Failed to delete bank account in Supabase' };
        }
      }
    }

    const idx = dataStore.bankAccounts.findIndex(b => b.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Bank account not found' };
    dataStore.bankAccounts.splice(idx, 1);
    dataStore.notify('bankAccounts');
    return { success: true, data: null, message: 'Payment method removed' };
  },

  async getBalanceSheet(organizationId: string, asOfDate?: string): Promise<ServiceResponse<BalanceSheetReport>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<BalanceSheetReport>(organizationId);
      if (err) return err;
      const q = new URLSearchParams();
      if (asOfDate) q.set('asOfDate', asOfDate);
      const qs = q.toString();
      return apiGet<BalanceSheetReport>(
        `/organizations/${encodeURIComponent(organizationId)}/reports/balance-sheet${qs ? `?${qs}` : ''}`,
      );
    }

    const accountsRes = await this.getAll(organizationId);
    const accounts = (accountsRes.data ?? []).filter(a => a.isActive);
    const banks = (dataStore.bankAccounts || []).filter(b => b.organizationId === organizationId && b.isActive);
    const loans = (dataStore.loans || []).filter(l => l.organizationId === organizationId && l.status !== 'paid');

    const assets: { accountId: string; name: string; balance: number; type: string }[] = [];
    const liabilities: { accountId: string; name: string; balance: number; type: string }[] = [];
    const equity: { accountId: string; name: string; balance: number; type: string }[] = [];

    for (const b of banks) {
      const bal = Number(b.balance || 0);
      if (['credit_card', 'line_of_credit'].includes(b.accountType)) {
        liabilities.push({ accountId: b.id, name: `${b.bankName} (${b.accountType})`, balance: Math.abs(bal), type: b.accountType === 'credit_card' ? 'current' : 'longTerm' });
      } else {
        assets.push({ accountId: b.id, name: `${b.bankName} · ${b.accountNumber ? b.accountNumber.slice(-4) : 'Cash'}`, balance: bal, type: 'current' });
      }
    }

    for (const l of loans) {
      const rem = Number(l.remainingBalance ?? l.amount ?? l.principal ?? 0);
      if (rem <= 0) continue;
      if (l.type === 'to_receive') {
        assets.push({ accountId: l.id, name: `Loan Receivable: ${l.description || l.party}`, balance: rem, type: 'current' });
      } else {
        const isLong = (l.termMonths && l.termMonths > 12) || l.frequency === 'annual';
        liabilities.push({ accountId: l.id, name: `Loan Payable: ${l.description || l.party}`, balance: rem, type: isLong ? 'longTerm' : 'current' });
      }
    }

    const bankIds = new Set(banks.map(b => b.accountId).filter(Boolean));
    for (const a of accounts) {
      if (banks.length > 0 && (bankIds.has(a.id) || a.subtype === 'bank_account')) continue;
      if (a.subtype === 'accounts_payable' && loans.length > 0) continue;
      const bal = Number(a.balance || 0);
      if (a.type === 'asset') {
        assets.push({ accountId: a.id, name: a.name, balance: bal, type: a.subtype === 'fixed_asset' ? 'fixed' : 'current' });
      } else if (a.type === 'liability') {
        liabilities.push({ accountId: a.id, name: a.name, balance: bal, type: a.subtype === 'long_term' ? 'longTerm' : 'current' });
      }
    }

    // Include Inventory valuation in Current Assets
    const invItems = ((dataStore as any).inventoryItems || []).filter((i: any) => i.organizationId === organizationId && i.isActive !== false);
    for (const item of invItems) {
      const stock = Number(item.currentStock || item.quantity || 0);
      const cost = Number(item.averageCost || item.unitPrice || 0);
      const val = stock * cost;
      if (val > 0) {
        assets.push({ accountId: item.id, name: `Inventory: ${item.name}`, balance: val, type: 'current' });
      }
    }

    // Include Fixed Assets Net Book Value
    const fixedAssetList = ((dataStore as any).assets || []).filter((a: any) => a.organizationId === organizationId && a.status !== 'disposed');
    for (const a of fixedAssetList) {
      const p = Number(a.purchasePrice || a.cost || 0);
      const acc = Number(a.accumulatedDepreciation || 0);
      const salv = Number(a.salvageValue || 0);
      const cur = a.currentValue != null ? Number(a.currentValue) : Math.max(salv, p - acc);
      if (cur > 0) {
        assets.push({ accountId: a.id, name: `Fixed Asset: ${a.name || a.assetName || 'Equipment'}`, balance: cur, type: 'fixed' });
      }
    }

    const currentAssets = assets.filter(a => a.type === 'current').reduce((s, a) => s + a.balance, 0);
    const fixedAssets = assets.filter(a => a.type === 'fixed').reduce((s, a) => s + a.balance, 0);
    const totalAssets = currentAssets + fixedAssets;

    const currentLiabilities = liabilities.filter(l => l.type === 'current').reduce((s, l) => s + l.balance, 0);
    const longTermLiabilities = liabilities.filter(l => l.type === 'longTerm').reduce((s, l) => s + l.balance, 0);
    const totalLiabilities = currentLiabilities + longTermLiabilities;

    const netWorth = totalAssets - totalLiabilities;
    equity.push({ accountId: 'retained-earnings', name: "Owner's Equity & Retained Earnings", balance: netWorth, type: 'equity' });
    const totalEquity = netWorth;

    return {
      success: true,
      data: {
        asOfDate: asOfDate || new Date().toISOString().split('T')[0],
        assets,
        liabilities,
        equity,
        totalAssets,
        totalLiabilities,
        totalEquity,
        currentAssets,
        fixedAssets,
        currentLiabilities,
        longTermLiabilities,
      },
    };
  },
};
