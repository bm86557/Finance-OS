/**
 * Counterparties & Vendor Directory Router
 * Mounted at `/organizations/:organizationId/counterparties` (mergeParams).
 * Operates strictly on Supabase PostgreSQL with explicit error propagation.
 */

import { Router, type Request, type Response } from 'express';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

export function createCounterpartiesRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { data, error } = await sb
      .from('counterparties')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      return fail(res, 500, error.message);
    }

    return ok(res, data || []);
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { name, type = 'vendor', tax_id, default_category_id, payment_terms_days = 30, currency = 'USD', notes } = req.body;

    if (!name || !name.trim()) {
      return fail(res, 400, 'Counterparty name is required');
    }

    const id = `cp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const row = {
      id,
      organization_id: orgId,
      name: name.trim(),
      type,
      tax_id: tax_id || null,
      default_category_id: default_category_id || null,
      payment_terms_days: Number(payment_terms_days) || 30,
      currency: currency || 'USD',
      notes: notes || null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb.from('counterparties').insert(row).select().single();
    if (error) {
      return fail(res, 500, error.message);
    }

    return created(res, data);
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.organization_id;

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { data, error } = await sb
      .from('counterparties')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      return fail(res, 500, error.message);
    }
    if (!data) {
      return notFound(res, 'Counterparty');
    }

    return ok(res, data);
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { error } = await sb
      .from('counterparties')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) {
      return fail(res, 500, error.message);
    }

    return ok(res, { deleted: true });
  });

  return r;
}
