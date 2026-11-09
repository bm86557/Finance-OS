/**
 * §4 — Categories. Mounted at `/organizations/:organizationId/categories` (mergeParams).
 * Exclusively backed by Supabase PostgreSQL.
 */

import { Router, type Request, type Response } from 'express';
import type { Category } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomainCategory(row: Record<string, any>): Category {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    type: row.type as Category['type'],
    color: String(row.color ?? '#64748b'),
    icon: String(row.icon ?? 'folder'),
    patterns: Array.isArray(row.patterns) ? row.patterns : [],
    accountId: row.account_id ? String(row.account_id) : '',
  };
}

function mapDomainToDbCategory(cat: Category): Record<string, unknown> {
  return {
    id: cat.id,
    organization_id: cat.organizationId,
    name: cat.name,
    type: cat.type,
    color: cat.color || '#64748b',
    icon: cat.icon || 'folder',
    patterns: cat.patterns || [],
    account_id: cat.accountId || null,
  };
}

export function createCategoriesRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/usage-stats', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const [{ data: catData, error: catErr }, { data: txnData, error: txnErr }] = await Promise.all([
      sb.from('categories').select('*').eq('organization_id', orgId),
      sb.from('transactions').select('category_id, amount').eq('organization_id', orgId),
    ]);

    if (catErr) return fail(res, 500, catErr.message);
    if (txnErr) return fail(res, 500, txnErr.message);

    const categories = (catData || []).map(mapDbToDomainCategory);
    const orgTxns = txnData || [];

    const stats = categories.map(cat => {
      const catTxns = orgTxns.filter(t => (t.category_id || (t as any).categoryId) === cat.id);
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        transactionCount: catTxns.length,
        totalAmount: catTxns.reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0),
        type: cat.type,
      };
    });
    return ok(res, stats);
  });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('categories')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[categories.get] Supabase query error:', error.message);
      return fail(res, 500, error.message);
    }
    return ok(res, (data || []).map(mapDbToDomainCategory));
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('categories')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) {
      console.error('[categories.getById] Supabase error:', error.message);
      return fail(res, 500, error.message);
    }
    if (!data) return notFound(res, 'Category');
    return ok(res, mapDbToDomainCategory(data));
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Category, 'id' | 'organizationId'>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    let accountId = data.accountId;
    if (!accountId || accountId === 'default') {
      try {
        const accountType = data.type === 'income' ? 'revenue' : 'expense';
        const { data: existingAccount } = await sb
          .from('accounts')
          .select('id')
          .eq('organization_id', orgId)
          .eq('type', accountType)
          .limit(1)
          .maybeSingle();

        if (existingAccount) {
          accountId = existingAccount.id;
        } else {
          const defaultAccountId = 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          const defaultAccount = {
            id: defaultAccountId,
            organization_id: orgId,
            name: data.type === 'income' ? 'Other Income' : 'Other Expenses',
            code: data.type === 'income' ? '4999' : '5999',
            type: accountType,
            is_active: true,
          };
          const { data: newAccount } = await sb
            .from('accounts')
            .insert(defaultAccount)
            .select('id')
            .single();

          if (newAccount) {
            accountId = newAccount.id;
          }
        }
      } catch (err) {
        console.error('[categories.post] Error resolving account:', err);
      }
    }

    const newId = (data as any).id || ('cat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newCat: Category = { ...data, id: newId, organizationId: orgId, accountId };

    const dbRow = mapDomainToDbCategory(newCat);
    const { data: insertedData, error } = await sb.from('categories').insert(dbRow).select().single();
    if (error) {
      console.error('[categories.post] Supabase insert error:', error.message);
      return fail(res, 500, `Failed to create category: ${error.message}`);
    }

    return created(res, mapDbToDomainCategory(insertedData), 'Category created');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<Category>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.accountId !== undefined) dbUpdates.account_id = updates.accountId;
    if (updates.color !== undefined) dbUpdates.color = updates.color;
    if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
    if (updates.patterns !== undefined) dbUpdates.patterns = updates.patterns;

    const { data, error } = await sb
      .from('categories')
      .update(dbUpdates)
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[categories.patch] Supabase error:', error.message);
      return fail(res, 500, error.message);
    }
    if (!data) return notFound(res, 'Category');
    return ok(res, mapDbToDomainCategory(data));
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      await sb
        .from('transactions')
        .update({ category_id: null, status: 'pending' })
        .eq('category_id', req.params.id)
        .eq('organization_id', orgId);
    } catch {
      // ignore
    }

    const { error } = await sb
      .from('categories')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) {
      console.error('[categories.delete] Supabase error:', error.message);
      return fail(res, 500, error.message);
    }

    return ok(res, null, 'Category deleted');
  });

  r.post('/:id/patterns', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { pattern } = req.body as { pattern: string };
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: existing, error: fetchErr } = await sb
      .from('categories')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!existing) return notFound(res, 'Category');

    const currentPatterns: string[] = Array.isArray(existing.patterns) ? existing.patterns : [];
    if (!currentPatterns.includes(pattern)) {
      currentPatterns.push(pattern);
    }

    const { data: updated, error: updateErr } = await sb
      .from('categories')
      .update({ patterns: currentPatterns })
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (updateErr) return fail(res, 500, updateErr.message);
    return ok(res, mapDbToDomainCategory(updated));
  });

  r.delete('/:id/patterns', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const pattern = String(req.query.pattern ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: existing, error: fetchErr } = await sb
      .from('categories')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!existing) return notFound(res, 'Category');

    const currentPatterns: string[] = (Array.isArray(existing.patterns) ? existing.patterns : []).filter((p: string) => p !== pattern);

    const { data: updated, error: updateErr } = await sb
      .from('categories')
      .update({ patterns: currentPatterns })
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (updateErr) return fail(res, 500, updateErr.message);
    return ok(res, mapDbToDomainCategory(updated));
  });

  return r;
}
