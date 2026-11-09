/**
 * Debug endpoint to analyze forecast calculation discrepancies.
 * Operates strictly and exclusively on Supabase PostgreSQL.
 */
import { Router, type Request, type Response } from 'express';
import { ok, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

export function createDebugForecastRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/transactions-by-month', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const targetMonth = req.query.month as string; // e.g., "2026-03"

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { data: dbTxns, error } = await sb
      .from('transactions')
      .select('*')
      .eq('organization_id', orgId);

    if (error) {
      return fail(res, 500, error.message);
    }

    const allTransactions = (dbTxns || []).map((t: any) => ({
      id: String(t.id),
      date: String(t.date || ''),
      amount: Number(t.amount || 0),
      type: t.type === 'credit' ? 'credit' : 'debit',
      description: String(t.description || t.narration || ''),
      category: t.category_id || undefined,
    }));

    // Filter by month if specified
    const transactions = targetMonth
      ? allTransactions.filter(t => t.date.substring(0, 7) === targetMonth)
      : allTransactions;

    // Aggregate by month
    const monthlyData: Record<string, {
      income: number;
      expense: number;
      transactions: Array<{ id: string; date: string; amount: number; type: string; description: string; category?: string }>;
    }> = {};

    transactions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!monthlyData[month]) {
        monthlyData[month] = { income: 0, expense: 0, transactions: [] };
      }

      const amount = Number(t.amount || 0);
      const txnType = t.type; // 'credit' or 'debit'

      monthlyData[month].transactions.push({
        id: t.id,
        date: t.date,
        amount,
        type: txnType,
        description: t.description,
        category: t.category,
      });

      if (txnType === 'credit') {
        monthlyData[month].income += Math.abs(amount);
      } else if (txnType === 'debit') {
        monthlyData[month].expense += Math.abs(amount);
      } else if (amount > 0) {
        monthlyData[month].income += amount;
      } else if (amount < 0) {
        monthlyData[month].expense += Math.abs(amount);
      }
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    const result = sortedMonths.map(month => ({
      month,
      income: Math.round(monthlyData[month].income * 100) / 100,
      expense: Math.round(monthlyData[month].expense * 100) / 100,
      net: Math.round((monthlyData[month].income - monthlyData[month].expense) * 100) / 100,
      transactionCount: monthlyData[month].transactions.length,
      transactions: monthlyData[month].transactions,
    }));

    ok(res, {
      organizationId: orgId,
      targetMonth: targetMonth || 'all',
      totalTransactions: transactions.length,
      monthlyBreakdown: result,
    });
  });

  r.get('/recurring-by-month', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { data: dbRecurring, error } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (error) {
      return fail(res, 500, error.message);
    }

    const recurring = (dbRecurring || []).map((r: any) => ({
      id: String(r.id),
      description: String(r.description || ''),
      amount: Number(r.amount || 0),
      type: r.type || 'debit',
      frequency: r.frequency || 'monthly',
      nextOccurrence: r.next_occurrence || r.nextOccurrence || '',
    }));

    ok(res, {
      organizationId: orgId,
      recurringCount: recurring.length,
      recurring,
    });
  });

  // Full transaction audit - shows all transactions with detailed info
  r.get('/transaction-audit', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const targetMonth = req.query.month as string;

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { data: dbTxns, error } = await sb
      .from('transactions')
      .select('*')
      .eq('organization_id', orgId);

    if (error) {
      return fail(res, 500, error.message);
    }

    const allTransactions = (dbTxns || []).map((t: any) => ({
      id: String(t.id),
      date: String(t.date || ''),
      amount: Number(t.amount || 0),
      type: t.type === 'credit' ? 'credit' : 'debit',
      description: String(t.description || t.narration || ''),
      category: t.category_id || '',
      account: t.bank_account_id || '',
      reference: t.reference_number || t.id,
    }));

    const transactions = targetMonth
      ? allTransactions.filter(t => t.date.substring(0, 7) === targetMonth)
      : allTransactions;

    const byMonth: Record<string, {
      credits: Array<any>;
      debits: Array<any>;
      totalCredit: number;
      totalDebit: number;
    }> = {};

    transactions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (!byMonth[month]) {
        byMonth[month] = { credits: [], debits: [], totalCredit: 0, totalDebit: 0 };
      }

      if (t.type === 'credit') {
        byMonth[month].credits.push(t);
        byMonth[month].totalCredit += Math.abs(t.amount);
      } else if (t.type === 'debit') {
        byMonth[month].debits.push(t);
        byMonth[month].totalDebit += Math.abs(t.amount);
      }
    });

    const sortedMonths = Object.keys(byMonth).sort();
    const result = sortedMonths.map(month => ({
      month,
      creditCount: byMonth[month].credits.length,
      debitCount: byMonth[month].debits.length,
      totalCredit: Math.round(byMonth[month].totalCredit * 100) / 100,
      totalDebit: Math.round(byMonth[month].totalDebit * 100) / 100,
      netFlow: Math.round((byMonth[month].totalCredit - byMonth[month].totalDebit) * 100) / 100,
      credits: byMonth[month].credits.sort((a, b) => a.date.localeCompare(b.date)),
      debits: byMonth[month].debits.sort((a, b) => a.date.localeCompare(b.date)),
    }));

    ok(res, {
      organizationId: orgId,
      targetMonth: targetMonth || 'all',
      totalTransactions: transactions.length,
      monthlyAudit: result,
    });
  });

  return r;
}
