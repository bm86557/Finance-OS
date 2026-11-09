/**
 * §3 (list/create half) — `GET/POST /api/v1/organizations`
 *
 * Exclusively backed by Supabase public.organizations.
 */

import { Router, type Request, type Response } from 'express';
import type { Organization } from '../../src/services/types.js';
import { ok, created, fail } from '../lib/http.js';
import { requireAuth, requirePlatformRole } from '../middleware/auth.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

interface OrgRow {
  id: string;
  slug: string | null;
  name: string;
  logo: string | null;
  currency: string;
  fiscal_year_start: string;
  created_at: string;
  settings: Record<string, unknown> | null;
}

function rowToOrganization(row: OrgRow): Organization {
  return {
    id: row.id,
    slug: row.slug ?? undefined,
    name: row.name,
    logo: row.logo ?? undefined,
    currency: row.currency,
    fiscalYearStart: row.fiscal_year_start,
    createdAt: row.created_at,
    settings: (row.settings ?? { theme: 'dark', notifications: true }) as Organization['settings'],
  };
}

export function createOrganizationsListRouter(): Router {
  const r = Router();

  r.get('/', requireAuth, requirePlatformRole('platform_admin', 'platform_manager'), async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Number(req.query.pageSize ?? 20) || 20;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const start = (page - 1) * pageSize;
    const { data, error, count } = await sb
      .from('organizations')
      .select('id, slug, name, logo, currency, fiscal_year_start, created_at, settings', { count: 'exact' })
      .range(start, start + pageSize - 1)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[organizations] Supabase list error:', error.message);
      return fail(res, 500, error.message);
    }

    const rows = (data ?? []) as unknown as OrgRow[];
    const items = rows.map(rowToOrganization);
    const total = count ?? items.length;
    return ok(res, {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasMore: start + items.length < total,
    });
  });

  r.post('/', requireAuth, requirePlatformRole('platform_admin', 'platform_manager'), async (req: Request, res: Response) => {
    const data = req.body as Omit<Organization, 'id' | 'createdAt'>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const id = `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: inserted, error } = await sb
      .from('organizations')
      .insert({
        id,
        slug: data.slug ?? null,
        name: data.name,
        logo: data.logo ?? null,
        currency: data.currency ?? 'USD',
        fiscal_year_start: data.fiscalYearStart ?? '01-01',
        settings: data.settings ?? { theme: 'dark', notifications: true },
      })
      .select('id, slug, name, logo, currency, fiscal_year_start, created_at, settings')
      .single();

    if (error) {
      console.error('[organizations] Supabase insert error:', error.message);
      return fail(res, 500, error.message);
    }

    return created(res, rowToOrganization(inserted as unknown as OrgRow), 'Organization created');
  });

  return r;
}
