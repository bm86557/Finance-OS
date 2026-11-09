/**
 * Platform console — organization management backed by Supabase.
 *
 * The platform console is the only screen that must see EVERY tenant, so it cannot rely on the
 * browser's anon-key queries (RLS on `public.organizations` only exposes rows the caller is a
 * member of, and platform staff are deliberately not members of any tenant) and it must not use
 * the local SQLite bundle either — that bundle still carries the demo seed ("Creative Agency
 * Co.", "Digital Solutions Ltd", "Tech Innovations Inc"), which is the mock data this route
 * replaces.
 *
 * Everything here therefore reads/writes `public.organizations` with the service-role key and
 * enriches each row with usage counters aggregated from the tenant's own rows:
 *   users      → active rows in `organization_members`
 *   statements → imported statement files in `import_history_records`
 *   currencies → distinct currencies across `accounts` (+ the org's own currency)
 *
 * Plan/status live inside the `settings` jsonb (the table has no dedicated columns yet), so a
 * tenant's plan can be changed without a schema migration.
 */

import { Router, type Request, type Response } from 'express';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import { env } from '../config/env.js';

type Sb = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

/** Channel used to tell the platform console that a tenant changed. */
const PLATFORM_ORG_CHANNEL = 'platform-organizations';

export type PlatformOrgStatus = 'active' | 'trial' | 'suspended' | 'churn_risk';

export interface PlatformOrgLimits {
  users: number;
  usersUsed: number;
  statements: number;
  statementsUsed: number;
  currencies: number;
  currenciesUsed: number;
}

export interface PlatformOrganization {
  id: string;
  slug: string | null;
  name: string;
  logo: string | null;
  currency: string;
  fiscalYearStart: string;
  createdAt: string;
  settings: Record<string, unknown>;
  plan: string;
  status: PlatformOrgStatus;
  limits: PlatformOrgLimits;
  billing: { 
    amount: number;
    nextBillingDate?: string | null;
    daysRemaining?: number | null;
  };
}

/** Plan catalogue — the platform's own pricing, not tenant data. */
const PLAN_CATALOGUE: Record<string, { name: string; price: number; limits: Omit<PlatformOrgLimits, 'usersUsed' | 'statementsUsed' | 'currenciesUsed'> }> = {
  free: { name: 'Free', price: 0, limits: { users: 2, statements: 20, currencies: 1 } },
  starter: { name: 'Starter', price: 1900, limits: { users: 3, statements: 50, currencies: 1 } },
  basic: { name: 'Basic', price: 2900, limits: { users: 5, statements: 100, currencies: 2 } },
  professional: { name: 'Professional', price: 4900, limits: { users: 10, statements: 500, currencies: 5 } },
  business: { name: 'Business', price: 9900, limits: { users: 25, statements: 1000, currencies: 8 } },
  enterprise: { name: 'Enterprise', price: 19900, limits: { users: 100, statements: 5000, currencies: 20 } },
};

/** A tenant stays in trial for this long after signup unless a status is stored explicitly. */
const TRIAL_PERIOD_DAYS = 14;

function normalizePlanKey(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return 'basic';
  if (key.startsWith('prof')) return 'professional';
  if (key.startsWith('ent')) return 'enterprise';
  return key in PLAN_CATALOGUE ? key : 'basic';
}

function resolveStatus(settings: Record<string, unknown>, createdAt: string): PlatformOrgStatus {
  const raw = String(settings.status ?? '').trim().toLowerCase();
  if (raw === 'active' || raw === 'trial' || raw === 'suspended' || raw === 'churn_risk') return raw;
  if (settings.suspended === true) return 'suspended';
  const created = new Date(createdAt).getTime();
  if (Number.isFinite(created)) {
    const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
    if (ageDays <= TRIAL_PERIOD_DAYS) return 'trial';
  }
  return 'active';
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function buildOrgId(): string {
  const suffix = `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  return `org-${Date.now()}-${suffix}`;
}

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

interface UsageStats {
  usersUsed: Map<string, number>;
  statementsUsed: Map<string, number>;
  currenciesUsed: Map<string, Set<string>>;
}

async function loadUsageStats(sb: Sb, orgIds: string[]): Promise<UsageStats> {
  const stats: UsageStats = {
    usersUsed: new Map(),
    statementsUsed: new Map(),
    currenciesUsed: new Map(),
  };
  if (orgIds.length === 0) return stats;

  const [membersRes, importsRes, accountsRes] = await Promise.all([
    sb.from('organization_members').select('organization_id, status').in('organization_id', orgIds),
    sb.from('import_history_records').select('organization_id').in('organization_id', orgIds),
    sb.from('accounts').select('organization_id, currency').in('organization_id', orgIds),
  ]);

  for (const m of (membersRes.data ?? []) as Array<{ organization_id: string; status: string }>) {
    if (m.status !== 'active') continue;
    stats.usersUsed.set(m.organization_id, (stats.usersUsed.get(m.organization_id) ?? 0) + 1);
  }

  for (const i of (importsRes.data ?? []) as Array<{ organization_id: string }>) {
    stats.statementsUsed.set(i.organization_id, (stats.statementsUsed.get(i.organization_id) ?? 0) + 1);
  }

  for (const a of (accountsRes.data ?? []) as Array<{ organization_id: string; currency: string }>) {
    const set = stats.currenciesUsed.get(a.organization_id) ?? new Set<string>();
    if (a.currency) set.add(a.currency);
    stats.currenciesUsed.set(a.organization_id, set);
  }

  return stats;
}

function toPlatformOrganization(row: OrgRow, stats: UsageStats, sub?: any): PlatformOrganization {
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const planKey = normalizePlanKey(settings.plan);
  const plan = PLAN_CATALOGUE[planKey];
  const currencies = stats.currenciesUsed.get(row.id) ?? new Set<string>();
  if (row.currency) currencies.add(row.currency);

  let nextBillingDate: string | null = null;
  let daysRemaining: number | null = null;
  if (sub && sub.current_period_end) {
    nextBillingDate = sub.current_period_end;
    const diffMs = new Date(sub.current_period_end).getTime() - Date.now();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  return {
    id: row.id,
    slug: row.slug ?? null,
    name: row.name,
    logo: row.logo ?? null,
    currency: row.currency,
    fiscalYearStart: row.fiscal_year_start,
    createdAt: row.created_at,
    settings,
    plan: plan.name,
    status: resolveStatus(settings, row.created_at),
    limits: {
      users: plan.limits.users,
      usersUsed: stats.usersUsed.get(row.id) ?? 0,
      statements: plan.limits.statements,
      statementsUsed: stats.statementsUsed.get(row.id) ?? 0,
      currencies: plan.limits.currencies,
      currenciesUsed: currencies.size,
    },
    billing: { 
      amount: plan.price,
      nextBillingDate,
      daysRemaining,
    },
  };
}

/** Reads every tenant row from Supabase and enriches it with real usage counters and active subscriptions. */
export async function loadPlatformOrganizations(sb?: Sb): Promise<PlatformOrganization[] | null> {
  const client = sb ?? getSupabaseAdminClient();
  if (!client) return null;

  const [orgsRes, subsRes] = await Promise.all([
    client
      .from('organizations')
      .select('id, slug, name, logo, currency, fiscal_year_start, created_at, settings')
      .order('created_at', { ascending: false }),
    client.from('organization_subscriptions').select('organization_id, current_period_end, status'),
  ]);

  if (orgsRes.error) {
    console.error('[platform-orgs] organizations query failed:', orgsRes.error.message);
    return null;
  }

  const subsMap = new Map<string, any>();
  for (const s of (subsRes.data ?? [])) {
    if (s.organization_id) subsMap.set(s.organization_id, s);
  }

  const rows = (orgsRes.data ?? []) as unknown as OrgRow[];
  const stats = await loadUsageStats(client, rows.map((r) => r.id));
  return rows.map((row) => toPlatformOrganization(row, stats, subsMap.get(row.id)));
}

/** Merges a patch into the `settings` jsonb without dropping theme/notifications. */
function mergeSettings(existing: Record<string, unknown> | null, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(existing ?? {}), ...patch };
}

let broadcastChannel: RealtimeChannel | null = null;

/**
 * Pushes a "a tenant changed" event to the platform console.
 *
 * Postgres changes (`postgres_changes`) only reach the browser once `organizations` is part of the
 * `supabase_realtime` publication (supabase/migrations/0009_platform_organizations_realtime.sql).
 * This broadcast covers the console's own writes in the meantime, so a create/edit shows up in the
 * list immediately instead of waiting for the next poll.
 *
 * The payload deliberately carries no tenant data — only the id and the event name.
 */
async function broadcastOrganizationChange(event: 'created' | 'updated' | 'deleted', orgId: string): Promise<void> {
  const sb = getSupabaseAdminClient();
  if (!sb) return;

  try {
    if (!broadcastChannel) {
      const channel = sb.channel(PLATFORM_ORG_CHANNEL, { config: { broadcast: { self: false } } });
      broadcastChannel = channel;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }

    await broadcastChannel.send({
      type: 'broadcast',
      event: 'org-changed',
      payload: { event, id: orgId },
    });
  } catch (err) {
    console.warn('[platform-orgs] broadcast failed:', err);
  }
}

async function findAuthUserIdByEmail(sb: Sb, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const match = data.users.find(
      (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Creates the tenant's first admin: an auth user plus the owner membership + profile rows.
 * Returns a warning instead of throwing — the organization row itself is already saved, and the
 * platform admin can still attach an admin later.
 */
async function attachOrgAdmin(
  sb: Sb,
  args: { email: string; name?: string; orgId: string; orgName: string },
): Promise<{ ok: boolean; warning?: string }> {
  const email = args.email.trim().toLowerCase();
  if (!email) return { ok: true };

  let userId: string | null = null;
  let invited = false;

  const { data: invitedUser, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email, {
    data: {
      full_name: args.name?.trim() || email.split('@')[0],
      platform_role: 'organization_user',
      organization_id: args.orgId,
      organization_name: args.orgName,
    },
    redirectTo: `${env.corsOrigin}/login`,
  });

  if (invitedUser?.user) {
    userId = invitedUser.user.id;
    invited = true;
  } else {
    // The user may already exist — reuse the account instead of failing the whole creation.
    userId = await findAuthUserIdByEmail(sb, email);
    if (!userId) {
      return { ok: false, warning: inviteError?.message || `Could not create an admin account for ${email}` };
    }
  }

  const { error: memberError } = await sb.from('organization_members').upsert(
    {
      organization_id: args.orgId,
      user_id: userId,
      role: 'owner',
      portal_type: 'organization_admin',
      status: invited ? 'pending' : 'active',
      email,
      joined_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,organization_id' },
  );

  if (memberError) {
    console.error('[platform-orgs] membership upsert failed:', memberError.message);
  }

  const { error: profileError } = await sb.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: args.name?.trim() || email.split('@')[0],
      platform_role: 'organization_user',
    },
    { onConflict: 'id' },
  );

  if (profileError) {
    console.error('[platform-orgs] profile upsert failed:', profileError.message);
  }

  return { ok: true };
}

export function createPlatformOrganizationsRouter(): Router {
  const r = Router();

  // GET /platform/organizations — every tenant, straight from Supabase.
  r.get('/', async (_req: Request, res: Response) => {
    if (!isSupabaseAdminConfigured()) {
      fail(res, 503, 'Supabase is not configured on the server.');
      return;
    }
    const sb = getSupabaseAdminClient();
    if (!sb) {
      fail(res, 503, 'Supabase is not configured on the server.');
      return;
    }

    const orgs = await loadPlatformOrganizations(sb);
    if (!orgs) {
      fail(res, 500, 'Could not load organizations from the database.');
      return;
    }
    ok(res, orgs);
  });

  // POST /platform/organizations — create a tenant row + its first admin.
  r.post('/', async (req: Request, res: Response) => {
    if (!isSupabaseAdminConfigured()) {
      fail(res, 503, 'Supabase is not configured on the server.');
      return;
    }
    const sb = getSupabaseAdminClient();
    if (!sb) {
      fail(res, 503, 'Supabase is not configured on the server.');
      return;
    }

    const body = req.body as {
      name?: string;
      adminEmail?: string;
      adminName?: string;
      currency?: string;
      fiscalYearStart?: string;
      plan?: string;
    };

    const name = (body.name ?? '').trim();
    if (!name) {
      fail(res, 400, 'Organization name is required.');
      return;
    }

    const { data: existingRows } = await sb.from('organizations').select('slug');
    const takenSlugs = new Set(
      ((existingRows ?? []) as Array<{ slug: string | null }>)
        .map((r) => (r.slug ?? '').toLowerCase())
        .filter(Boolean),
    );

    let slug = slugify(name) || `org-${Date.now()}`;
    if (takenSlugs.has(slug)) {
      let n = 2;
      while (takenSlugs.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }

    const id = buildOrgId();
    const planKey = normalizePlanKey(body.plan);
    const settings = {
      theme: 'dark',
      notifications: true,
      plan: planKey,
      status: 'trial',
    };

    const { data: inserted, error } = await sb
      .from('organizations')
      .insert({
        id,
        slug,
        name,
        logo: null,
        currency: (body.currency ?? 'USD').trim().toUpperCase() || 'USD',
        fiscal_year_start: (body.fiscalYearStart ?? '01-01').trim() || '01-01',
        settings,
      })
      .select('id, slug, name, logo, currency, fiscal_year_start, created_at, settings')
      .single();

    if (error || !inserted) {
      console.error('[platform-orgs] insert failed:', error?.message);
      fail(res, 500, error?.message || 'Could not create the organization.');
      return;
    }

    let warning: string | undefined;
    const email = (body.adminEmail ?? '').trim();
    if (email) {
      const attach = await attachOrgAdmin(sb, {
        email,
        name: body.adminName,
        orgId: id,
        orgName: name,
      });
      if (!attach.ok) warning = attach.warning;
    }

    const orgs = await loadPlatformOrganizations(sb);
    const created0 = (orgs ?? []).find((o) => o.id === id) ?? null;

    await broadcastOrganizationChange('created', id);

    if (warning) {
      created(res, created0, `Organization created. ${warning}`);
      return;
    }
    created(res, created0, 'Organization created');
  });

  // PATCH /platform/organizations/:id — edit a tenant row.
  r.patch('/:organizationId', async (req: Request, res: Response) => {
    if (!isSupabaseAdminConfigured()) {
      fail(res, 503, 'Supabase is not configured on the server.');
      return;
    }
    const sb = getSupabaseAdminClient();
    if (!sb) {
      fail(res, 503, 'Supabase is not configured on the server.');
      return;
    }

    const orgId = Array.isArray(req.params.organizationId)
      ? req.params.organizationId[0]
      : (req.params.organizationId ?? '');
    const body = req.body as {
      name?: string;
      slug?: string;
      logo?: string | null;
      currency?: string;
      fiscalYearStart?: string;
      plan?: string;
      status?: PlatformOrgStatus;
      settings?: Record<string, unknown>;
    };

    const { data: current, error: currentError } = await sb
      .from('organizations')
      .select('id, slug, name, logo, currency, fiscal_year_start, created_at, settings')
      .eq('id', orgId)
      .maybeSingle();

    if (currentError) {
      fail(res, 500, currentError.message);
      return;
    }
    if (!current) {
      notFound(res, 'Organization');
      return;
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.slug !== undefined) updates.slug = String(body.slug).trim();
    if (body.logo !== undefined) updates.logo = body.logo;
    if (body.currency !== undefined) updates.currency = String(body.currency).trim().toUpperCase();
    if (body.fiscalYearStart !== undefined) updates.fiscal_year_start = String(body.fiscalYearStart).trim();

    const settingsPatch: Record<string, unknown> = {};
    if (body.plan !== undefined) {
      const planKey = normalizePlanKey(body.plan);
      settingsPatch.plan = planKey;

      // Look up authoritative features from public.platform_plans
      try {
        const { data: pData } = await sb
          .from('platform_plans')
          .select('id, name, features, limits')
          .or(`id.eq.${body.plan},slug.eq.${planKey}`)
          .single();
        if (pData) {
          settingsPatch.planId = pData.id;
          settingsPatch.planName = pData.name;
          settingsPatch.planFeatures = pData.features;
          if (pData.limits) {
            settingsPatch.limits = pData.limits;
          }
        }
      } catch (err) {
        console.warn('[platform-orgs] Could not enrich plan features on update:', err);
      }
    }
    if (body.status !== undefined) settingsPatch.status = body.status;
    if (body.settings !== undefined) Object.assign(settingsPatch, body.settings);

    if (Object.keys(settingsPatch).length > 0) {
      updates.settings = mergeSettings(
        (current.settings ?? {}) as Record<string, unknown>,
        settingsPatch,
      );
    }

    if (Object.keys(updates).length === 0) {
      ok(res, null, 'Nothing to update');
      return;
    }

    const { error } = await sb.from('organizations').update(updates).eq('id', orgId);
    if (error) {
      console.error('[platform-orgs] update failed:', error.message);
      fail(res, 500, error.message);
      return;
    }

    const orgs = await loadPlatformOrganizations(sb);
    const updated = (orgs ?? []).find((o) => o.id === orgId) ?? null;

    await broadcastOrganizationChange('updated', orgId);

    ok(res, updated, 'Organization updated');
  });

  return r;
}
