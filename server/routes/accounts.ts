/**
 * §5 — Chart of accounts. Mounted at `/organizations/:organizationId/accounts` (mergeParams).
 * Exclusively backed by Supabase PostgreSQL.
 */

import { Router, type Request, type Response } from 'express';
import type { Account } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomainAccount(row: Record<string, any>): Account {
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

function mapDomainToDbAccount(acc: Account): Record<string, unknown> {
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

export function buildDefaultChartAccounts(organizationId: string, currency = 'USD'): Account[] {
  const now = new Date().toISOString();
  return [
    {
      id: `acc-${organizationId}-cash-bank`,
      organizationId,
      code: '1010',
      name: 'Cash at bank',
      type: 'asset',
      subtype: 'bank_account',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-petty-cash`,
      organizationId,
      code: '1020',
      name: 'Petty Cash & Cash on Hand',
      type: 'asset',
      subtype: 'cash',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-online-wallets`,
      organizationId,
      code: '1030',
      name: 'Online Wallets & Payment Processors',
      type: 'asset',
      subtype: 'online_wallet',
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
      subtype: 'accounts_receivable',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-inventory`,
      organizationId,
      code: '1300',
      name: 'Inventory Asset',
      type: 'asset',
      subtype: 'inventory',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-fixed-assets`,
      organizationId,
      code: '1500',
      name: 'Fixed Assets (Property, Plant, Equip)',
      type: 'asset',
      subtype: 'fixed_asset',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-accum-depr`,
      organizationId,
      code: '1590',
      name: 'Accumulated Depreciation',
      type: 'asset',
      subtype: 'accumulated_depreciation',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-payables`,
      organizationId,
      code: '2010',
      name: 'Accounts Payable (Trade Creditors)',
      type: 'liability',
      subtype: 'accounts_payable',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-accrued`,
      organizationId,
      code: '2020',
      name: 'Accrued Liabilities & Payroll',
      type: 'liability',
      subtype: 'accrued_liability',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-loans-payable`,
      organizationId,
      code: '2500',
      name: 'Loans & Notes Payable',
      type: 'liability',
      subtype: 'notes_payable',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-common-stock`,
      organizationId,
      code: '3010',
      name: "Common Stock / Owner's Capital",
      type: 'equity',
      subtype: 'common_stock',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-retained-earnings`,
      organizationId,
      code: '3020',
      name: 'Retained Earnings',
      type: 'equity',
      subtype: 'retained_earnings',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-sales-rev`,
      organizationId,
      code: '4010',
      name: 'Sales Revenue (Product)',
      type: 'income',
      subtype: 'operating_revenue',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-service-rev`,
      organizationId,
      code: '4020',
      name: 'Service & Professional Fees',
      type: 'income',
      subtype: 'operating_revenue',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-other-income`,
      organizationId,
      code: '4900',
      name: 'Other Income & Interest',
      type: 'income',
      subtype: 'other_income',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-cogs`,
      organizationId,
      code: '5010',
      name: 'Cost of Goods Sold (Materials & Freight)',
      type: 'expense',
      subtype: 'cost_of_goods_sold',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-salaries`,
      organizationId,
      code: '6010',
      name: 'Salaries & Wages',
      type: 'expense',
      subtype: 'operating_expense',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-rent`,
      organizationId,
      code: '6020',
      name: 'Rent & Occupancy',
      type: 'expense',
      subtype: 'operating_expense',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-depr-exp`,
      organizationId,
      code: '6030',
      name: 'Depreciation & Amortization Expense',
      type: 'expense',
      subtype: 'operating_expense',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-marketing`,
      organizationId,
      code: '6040',
      name: 'Marketing & Advertising',
      type: 'expense',
      subtype: 'operating_expense',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
    {
      id: `acc-${organizationId}-software`,
      organizationId,
      code: '6050',
      name: 'Software & Technology Subscriptions',
      type: 'expense',
      subtype: 'operating_expense',
      currency,
      balance: 0,
      isActive: true,
      createdAt: now,
    },
  ];
}

export async function ensureDefaultAccounts(organizationId: string, currency = 'USD'): Promise<Account[]> {
  const sb = getSupabaseAdminClient();
  const defaults = buildDefaultChartAccounts(organizationId, currency);
  if (!sb) return defaults;

  const dbRows = defaults.map(mapDomainToDbAccount);
  try {
    await sb.from('accounts').upsert(dbRows, { onConflict: 'id' });
  } catch (err) {
    console.error('[accounts.ensureDefaultAccounts] Supabase upsert error:', err);
  }

  return defaults;
}

export function createAccountsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/tree', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('accounts')
      .select('*')
      .eq('organization_id', orgId)
      .order('code', { ascending: true });

    if (error) {
      console.error('[accounts.tree] Supabase query error:', error.message);
      return fail(res, 500, error.message);
    }

    let accounts: Account[] = (data || []).map(mapDbToDomainAccount);
    if (accounts.length === 0 && orgId) {
      accounts = await ensureDefaultAccounts(orgId);
    }

    return ok(res, {
      assets: accounts.filter(a => a.type === 'asset'),
      liabilities: accounts.filter(a => a.type === 'liability'),
      equity: accounts.filter(a => a.type === 'equity'),
      income: accounts.filter(a => a.type === 'income'),
      expenses: accounts.filter(a => a.type === 'expense'),
    });
  });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('accounts')
      .select('*')
      .eq('organization_id', orgId)
      .order('code', { ascending: true });

    if (error) {
      console.error('[accounts.get] Supabase query error:', error.message);
      return fail(res, 500, error.message);
    }

    let accounts = (data || []).map(mapDbToDomainAccount);
    if (accounts.length === 0 && orgId) {
      accounts = await ensureDefaultAccounts(orgId);
    }

    return ok(res, accounts);
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) {
      console.error('[accounts.getById] Supabase error:', error.message);
      return fail(res, 500, error.message);
    }

    if (!data) return notFound(res, 'Account');
    return ok(res, mapDbToDomainAccount(data));
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Account, 'id' | 'organizationId' | 'createdAt'>;
    if (!data.name?.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'Account name is required' });
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = (data as any).id || ('acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newAcc: Account = {
      ...data,
      id: newId,
      organizationId: orgId,
      createdAt: new Date().toISOString(),
      balance: Number.isFinite(data.balance) ? Number(data.balance) : 0,
      isActive: data.isActive ?? true,
    };

    const dbRow = mapDomainToDbAccount(newAcc);
    const { data: inserted, error } = await sb.from('accounts').insert(dbRow).select().single();
    if (error) {
      console.error('[accounts.post] Supabase insert error:', error.message);
      return fail(res, 500, error.message);
    }

    return created(res, mapDbToDomainAccount(inserted), 'Account created');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<Account>;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.subtype !== undefined) dbUpdates.subtype = updates.subtype;
    if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
    if (updates.balance !== undefined) dbUpdates.balance = Number(updates.balance);
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    if (updates.parentAccountId !== undefined) dbUpdates.parent_account_id = updates.parentAccountId || null;

    const { data, error } = await sb
      .from('accounts')
      .update(dbUpdates)
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[accounts.patch] Supabase update error:', error.message);
      return fail(res, 500, error.message);
    }

    if (!data) return notFound(res, 'Account');
    return ok(res, mapDbToDomainAccount(data));
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: linkedBanks } = await sb
      .from('bank_accounts')
      .select('id')
      .eq('account_id', req.params.id)
      .limit(1);

    if (linkedBanks && linkedBanks.length > 0) {
      return res.status(409).json({ success: false, data: null, error: 'Cannot delete chart account linked to active bank accounts.' });
    }

    const { error } = await sb
      .from('accounts')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) {
      console.error('[accounts.delete] Supabase delete error:', error.message);
      return fail(res, 500, error.message);
    }

    return ok(res, null, 'Account deleted');
  });

  return r;
}
