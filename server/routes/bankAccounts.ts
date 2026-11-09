/**
 * §5 (bank accounts half). Mounted at `/organizations/:organizationId/bank-accounts` (mergeParams).
 * Supports Supabase DB persistence when configured + fallback to in-memory store.
 * Includes FX currency conversion for accurate bank balance tracking.
 */

import { Router, type Request, type Response } from 'express';
import type { BankAccount } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { DEFAULT_RATES_TO_USD, convertCurrency, getEstimatedFxRate } from '../lib/fxConverter.js';
export { DEFAULT_RATES_TO_USD, convertCurrency, getEstimatedFxRate };
import { logAuditEvent } from '../lib/auditLogger.js';
import { isCurrencyEnabledGlobally } from './platformSettings.js';

import { ensureDefaultAccounts } from './accounts.js';

function getOrgId(req: Request): string {
  return req.orgMembership?.organizationId ?? (Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? ''));
}

function mapDbToDomainBankAccount(row: Record<string, any>): BankAccount {
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

function mapDomainToDbBankAccount(b: BankAccount, ownerUserId?: string): Record<string, unknown> {
  const bal = Number.isFinite(b.balance) ? b.balance : 0;
  return {
    id: b.id,
    organization_id: b.organizationId,
    account_id: b.accountId,
    account_name: b.bankName || '',
    bank_name: b.bankName || '',
    institution: b.bankName || '',
    account_number: b.accountNumber || '',
    account_type: b.accountType,
    currency: b.currency || 'USD',
    balance: bal,
    opening_balance: b.openingBalance != null ? b.openingBalance : bal,
    current_balance: bal,
    last_synced_at: b.lastSyncedAt || null,
    is_active: b.isActive ?? true,
    iban: b.iban || null,
    swift_code: b.swiftCode || null,
    routing_number: b.routingNumber || null,
    usage: b.usage || 'business',
    owner_user_id: ownerUserId || (b as any).ownerUserId || null,
    updated_at: new Date().toISOString(),
  };
}

export function createBankAccountsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const rawWorld = String(req.query.world || 'business').toLowerCase();
    const worldFilter: 'business' | 'personal' | 'all' =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    try {
      let q = sb
        .from('bank_accounts')
        .select('*')
        .eq('organization_id', orgId)
        .order('bank_name', { ascending: true });

      const { data, error } = await q;
      if (error) {
        return fail(res, 500, error.message);
      }

      const { data: txns } = await sb
        .from('transactions')
        .select('*')
        .eq('organization_id', orgId);

      const filteredData = (data || []).filter((row: any) => {
        const usage = row.usage === 'personal' ? 'personal' : 'business';
        if (usage === 'personal' && row.owner_user_id && row.owner_user_id !== callerUserId && !isOrgOwner) {
          return false;
        }
        if (worldFilter === 'all') return true;
        return usage === worldFilter;
      });

      const now = new Date();
      const accounts = filteredData.map((row: any) => {
        const domain = mapDbToDomainBankAccount(row);
        const bankCurrency = domain.currency || 'USD';
        const accountTxns = (txns || []).filter(
          (t: any) =>
            t.bank_account_id === domain.id &&
            !['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
        );

        const rawOpening = row.opening_balance;
        const openingBal = rawOpening != null
          ? Number(rawOpening)
          : (accountTxns.length > 0 ? 0 : Number(row.balance ?? 0));

        let liveBalance = openingBal;
        if (accountTxns.length > 0) {
          liveBalance = accountTxns.reduce((sum: number, t: any) => {
            const rawAmt = Number(t.amount || 0);
            const txnCurrency = t.currency || bankCurrency;
            let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
            if (!fxRate && Array.isArray(t.tags)) {
              const rTag = t.tags.find((tag: string) => tag.startsWith('fx:rate:'));
              if (rTag) fxRate = Number(rTag.slice(8));
            }
            const convertedAmt = convertCurrency(rawAmt, txnCurrency, bankCurrency, fxRate);
            return t.type === 'credit' ? sum + convertedAmt : sum - Math.abs(convertedAmt);
          }, openingBal);

          domain.balance = Math.round(liveBalance * 100) / 100;
        }

        // Generate 7 trailing periodic points for real account sparklines (§21, §30)
        const balanceHistory: number[] = [];
        for (let p = 6; p >= 0; p--) {
          const pointDate = new Date(now.getTime() - p * 5 * 24 * 60 * 60 * 1000);
          const txnsUpToPoint = accountTxns.filter((t: any) => t.date && new Date(t.date) <= pointDate);
          const pointBal = txnsUpToPoint.reduce((sum: number, t: any) => {
            const rawAmt = Number(t.amount || 0);
            const txnCurrency = t.currency || bankCurrency;
            let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
            const convertedAmt = convertCurrency(rawAmt, txnCurrency, bankCurrency, fxRate);
            return t.type === 'credit' ? sum + convertedAmt : sum - Math.abs(convertedAmt);
          }, openingBal);
          balanceHistory.push(Math.round(pointBal * 100) / 100);
        }
        (domain as any).balanceHistory = balanceHistory;

        return domain;
      });

      return ok(res, accounts);
    } catch (err: any) {
      console.error('[bankAccounts.get] Supabase query error:', err);
      return fail(res, 500, err?.message || 'Failed to fetch bank accounts');
    }
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }
    const { data, error } = await sb
      .from('bank_accounts')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error) {
      return fail(res, 500, error.message);
    }
    if (!data) {
      return notFound(res, 'Bank account');
    }
    return ok(res, mapDbToDomainBankAccount(data));
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<BankAccount, 'id' | 'organizationId'>;
    if (!data.bankName?.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'Bank/Account name is required' });
    }

    const requestedCurrency = (data.currency || 'USD').toUpperCase().trim();
    const currencyAllowed = await isCurrencyEnabledGlobally(requestedCurrency);
    if (!currencyAllowed) {
      return fail(res, 400, `Currency ${requestedCurrency} is currently disabled system-wide in Platform Settings`);
    }

    // Ensure chart of accounts exist so foreign keys in Supabase public.bank_accounts succeed
    const chartAccounts = await ensureDefaultAccounts(orgId, data.currency || 'USD');

    let resolvedAccountId = data.accountId?.trim();
    if (!resolvedAccountId || !chartAccounts.some(a => a.id === resolvedAccountId)) {
      const isCard = data.accountType === 'credit_card' || data.accountType === 'line_of_credit';
      const isCash = data.accountType === 'cash';
      const isWallet = data.accountType === 'online_wallet';

      const match = chartAccounts.find(a => {
        if (isCard) return a.type === 'liability' || a.subtype === 'credit_card';
        if (isCash) return a.subtype === 'cash' || a.id.includes('cash');
        if (isWallet) return a.subtype === 'online_wallet' || a.id.includes('wallet');
        return a.type === 'asset' || a.subtype === 'bank_account';
      }) || chartAccounts[0];

      resolvedAccountId = match?.id || `acc-${orgId}-cash-bank`;
    }

    const bal = Number.isFinite(data.balance) ? Number(data.balance) : 0;
    const newBank: BankAccount = {
      ...data,
      id: (data as any).id || `bank-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      organizationId: orgId,
      accountId: resolvedAccountId,
      balance: bal,
      openingBalance: bal,
      isActive: data.isActive ?? true,
    };

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const dbRow = mapDomainToDbBankAccount(newBank);
        const { error: upsertErr } = await sb.from('bank_accounts').upsert(dbRow, { onConflict: 'id' });
        if (upsertErr) {
          console.error('[bankAccounts.post] Supabase upsert error:', upsertErr);
          if (upsertErr.code === 'PGRST204' || upsertErr.message?.includes('opening_balance')) {
            const { opening_balance, ...fallbackRow } = dbRow as any;
            await sb.from('bank_accounts').upsert(fallbackRow, { onConflict: 'id' });
          }
        }

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'create_bank_account',
          entityType: 'bank_account',
          entityId: newBank.id,
          description: `Created payment method ${newBank.bankName} (${newBank.currency}) with initial balance ${newBank.balance}`,
          afterState: newBank as any,
        });
        return created(res, newBank, 'Payment method added successfully');
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Failed to create bank account');
      }
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<BankAccount> & { setAsBaseCurrency?: boolean };

    const sb = getSupabaseAdminClient();
    if (sb) {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.accountId !== undefined) dbUpdates.account_id = updates.accountId;
      if (updates.bankName !== undefined) dbUpdates.bank_name = updates.bankName;
      if (updates.accountNumber !== undefined) dbUpdates.account_number = updates.accountNumber;
      if (updates.accountType !== undefined) dbUpdates.account_type = updates.accountType;
      if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
      if (updates.balance !== undefined) dbUpdates.balance = Number(updates.balance);
      if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
      if (updates.iban !== undefined) dbUpdates.iban = updates.iban;
      if (updates.swiftCode !== undefined) dbUpdates.swift_code = updates.swiftCode;
      if (updates.routingNumber !== undefined) dbUpdates.routing_number = updates.routingNumber;
      if (updates.usage !== undefined) dbUpdates.usage = updates.usage;

      const { data: updatedRow } = await sb
        .from('bank_accounts')
        .update(dbUpdates)
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();

      // Ensure live balance is synchronized with transactions
      const { data: accTxns } = await sb
        .from('transactions')
        .select('*')
        .eq('bank_account_id', req.params.id)
        .eq('organization_id', orgId)
        .not('status', 'in', '("draft","pending","rejected","reversed","cancelled")');

      const eligibleTxns = (accTxns || []).filter(
        (t: any) => !['draft', 'pending', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
      );

      if (eligibleTxns.length > 0) {
        const targetCurrency = updates.currency || (updatedRow as any)?.currency || 'USD';
        const rawOpening = (updatedRow as any)?.opening_balance;
        const openingBal = rawOpening != null ? Number(rawOpening) : 0;
        const liveBal = eligibleTxns.reduce((sum: number, t: any) => {
          const rawAmt = Number(t.amount || 0);
          const txnCurrency = t.currency || targetCurrency;
          let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
          if (!fxRate && Array.isArray(t.tags)) {
            const rTag = t.tags.find((tag: string) => tag.startsWith('fx:rate:'));
            if (rTag) fxRate = Number(rTag.slice(8));
          }
          const convertedAmt = convertCurrency(rawAmt, txnCurrency, targetCurrency, fxRate);
          return t.type === 'credit' ? sum + Math.abs(convertedAmt) : sum - Math.abs(convertedAmt);
        }, openingBal);

        const rounded = Math.round(liveBal * 100) / 100;
        await sb
          .from('bank_accounts')
          .update({ balance: rounded, current_balance: rounded, last_synced_at: new Date().toISOString() })
          .eq('id', req.params.id)
          .eq('organization_id', orgId);
        if (updatedRow) (updatedRow as any).balance = rounded;
      }

      if (updates.currency) {
        const shouldSetBase = updates.setAsBaseCurrency === true;
        const { count } = await sb.from('bank_accounts').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
        const totalAccounts = count ?? 0;
        if (shouldSetBase || totalAccounts <= 1) {
          await sb.from('organizations').update({ currency: updates.currency }).eq('id', orgId);
        }
      }

      const { data, error } = await sb
        .from('bank_accounts')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (error) {
        return fail(res, 500, error.message);
      }
      if (!data) {
        return notFound(res, 'Bank account');
      }

      const domain = mapDbToDomainBankAccount(data);
      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'update_bank_account',
        entityType: 'bank_account',
        entityId: String(req.params.id),
        description: `Updated bank account ${req.params.id}`,
        afterState: domain as any,
      });
      return ok(res, domain);
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { error } = await sb
      .from('bank_accounts')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) {
      return fail(res, 500, error.message);
    }

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'delete_bank_account',
      entityType: 'bank_account',
      entityId: String(req.params.id),
      description: `Deleted bank account ${req.params.id}`,
    });
    return ok(res, null, 'Payment method removed');
  });

  return r;
}
