/**
 * Platform Organization Service
 * =============================
 * The platform console's view of every tenant.
 *
 * Source of truth: the `public.organizations` table in Supabase. The previous implementation
 * read the platform console's tenant list from the local mock bundle (demo orgs: "Creative
 * Agency Co.", "Digital Solutions Ltd", "Tech Innovations Inc") and its per-org plan/status/
 * limits from a hardcoded map — both are replaced here by live rows.
 *
 * Reads go through the API (`/api/v1/platform/organizations`), which queries Supabase with the
 * service-role key and aggregates real usage counters per tenant. If the API is unreachable the
 * service falls back to a direct anon-key read of `organizations` (RLS lets platform staff read
 * every tenant — see migration 0008).
 *
 * Live updates: `subscribeToOrganizations` opens a Supabase Realtime channel on
 * `public.organizations`; any INSERT/UPDATE/DELETE refreshes the console.
 */

import { apiGet, apiPostJson, apiRequest, isHttpBackendConfigured } from '@/lib/apiClient';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { Organization } from './types';
import type { ServiceResponse } from './types';

export type PlatformOrgStatus = 'active' | 'trial' | 'suspended' | 'churn_risk';

export interface PlatformOrgLimits {
  users: number;
  usersUsed: number;
  statements: number;
  statementsUsed: number;
  currencies: number;
  currenciesUsed: number;
}

export interface PlatformOrganization extends Organization {
  plan: string;
  status: PlatformOrgStatus;
  limits: PlatformOrgLimits;
  billing: { 
    amount: number;
    nextBillingDate?: string | null;
    daysRemaining?: number | null;
  };
}

export interface CreatePlatformOrganizationInput {
  name: string;
  adminEmail?: string;
  adminName?: string;
  currency?: string;
  fiscalYearStart?: string;
  plan?: string;
}

export interface UpdatePlatformOrganizationInput {
  name?: string;
  slug?: string;
  logo?: string | null;
  currency?: string;
  fiscalYearStart?: string;
  plan?: string;
  status?: PlatformOrgStatus;
}

export interface OrganizationChangeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  id?: string;
}

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

const EMPTY_LIMITS: PlatformOrgLimits = {
  users: 5,
  usersUsed: 0,
  statements: 100,
  statementsUsed: 0,
  currencies: 2,
  currenciesUsed: 0,
};

function normalizePlanKey(value: unknown, catalogue: Record<string, any> = PLAN_CATALOGUE): string {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return 'basic';
  if (key in catalogue) return key;
  if (key.startsWith('prof')) return 'professional';
  if (key.startsWith('ent')) return 'enterprise';
  if (key.startsWith('basic') || key === 'free') return 'basic';
  return 'basic';
}

const PLAN_CATALOGUE: Record<string, { name: string; price: number; limits: Omit<PlatformOrgLimits, 'usersUsed' | 'statementsUsed' | 'currenciesUsed'> }> = {
  basic: { name: 'Basic', price: 0, limits: { users: 5, statements: 100, currencies: 2 } },
  professional: { name: 'Professional', price: 49900, limits: { users: 10, statements: 500, currencies: 5 } },
  enterprise: { name: 'Enterprise', price: 99900, limits: { users: 50, statements: 2000, currencies: 10 } },
};

/** Direct anon-key read — used when the API is unavailable. */
async function getAllFromSupabase(): Promise<ServiceResponse<PlatformOrganization[]>> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { success: false, data: [], error: 'Supabase is not configured' };
  }

  try {
    const [orgsRes, subsRes, membersRes, importsRes, accountsRes, plansRes] = await Promise.all([
      sb.from('organizations').select('id, slug, name, logo, currency, fiscal_year_start, created_at, settings').order('created_at', { ascending: false }),
      sb.from('organization_subscriptions').select('organization_id, plan_slug, current_period_end, status'),
      sb.from('organization_members').select('organization_id, status'),
      sb.from('import_history_records').select('organization_id'),
      sb.from('accounts').select('organization_id, currency'),
      sb.from('platform_plans').select('*').eq('active', true),
    ]);

    if (orgsRes.error) {
      return { success: false, data: [], error: orgsRes.error.message };
    }

    const catalogue: Record<string, any> = { ...PLAN_CATALOGUE };
    if (plansRes.data && plansRes.data.length > 0) {
      for (const p of plansRes.data) {
        const key = (p.slug || p.name || '').trim().toLowerCase();
        catalogue[key] = {
          name: p.name,
          price: Number(p.price) || 0,
          limits: {
            users: p.limits?.users ?? 5,
            statements: p.limits?.statements ?? 100,
            currencies: p.limits?.currencies ?? 2,
          },
        };
      }
    }

    const subsMap = new Map<string, any>();
    for (const s of (subsRes.data ?? [])) {
      if (s.organization_id) subsMap.set(s.organization_id, s);
    }

    const usersMap = new Map<string, number>();
    for (const m of (membersRes.data ?? [])) {
      if (m.status && m.status !== 'active' && m.status !== 'pending') continue;
      usersMap.set(m.organization_id, (usersMap.get(m.organization_id) ?? 0) + 1);
    }

    const importsMap = new Map<string, number>();
    for (const i of (importsRes.data ?? [])) {
      importsMap.set(i.organization_id, (importsMap.get(i.organization_id) ?? 0) + 1);
    }

    const currenciesMap = new Map<string, Set<string>>();
    for (const a of (accountsRes.data ?? [])) {
      const set = currenciesMap.get(a.organization_id) ?? new Set<string>();
      if (a.currency) set.add(a.currency);
      currenciesMap.set(a.organization_id, set);
    }

    const items: PlatformOrganization[] = ((orgsRes.data ?? []) as any[]).map((row) => {
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const sub = subsMap.get(row.id);
      const rawPlanKey = sub?.plan_slug || settings.plan;
      const planKey = normalizePlanKey(rawPlanKey, catalogue);
      const plan = catalogue[planKey] || PLAN_CATALOGUE.basic;

      let resolvedStatus: PlatformOrgStatus = 'active';
      if (sub?.status === 'canceled') resolvedStatus = 'suspended';
      else if (sub?.status === 'past_due') resolvedStatus = 'churn_risk';
      else if (sub?.status === 'trialing') resolvedStatus = 'trial';
      else {
        const raw = String(settings.status ?? '').trim().toLowerCase();
        if (raw === 'active' || raw === 'trial' || raw === 'suspended' || raw === 'churn_risk') {
          resolvedStatus = raw as PlatformOrgStatus;
        } else if (settings.suspended === true) {
          resolvedStatus = 'suspended';
        } else if (settings.is_trial === true) {
          resolvedStatus = 'trial';
        }
      }

      let nextBillingDate: string | null = null;
      let daysRemaining: number | null = null;
      if (sub && sub.current_period_end) {
        nextBillingDate = sub.current_period_end;
        const diffMs = new Date(sub.current_period_end).getTime() - Date.now();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      }

      const orgCurrencies = currenciesMap.get(row.id) ?? new Set<string>();
      if (row.currency) orgCurrencies.add(row.currency);

      return {
        id: row.id,
        slug: row.slug ?? undefined,
        name: row.name,
        logo: row.logo ?? undefined,
        currency: row.currency,
        fiscalYearStart: row.fiscal_year_start,
        createdAt: row.created_at,
        settings: settings as Organization['settings'],
        plan: plan.name,
        status: resolvedStatus,
        limits: {
          users: plan.limits?.users ?? 5,
          usersUsed: usersMap.get(row.id) ?? 0,
          statements: plan.limits?.statements ?? 100,
          statementsUsed: importsMap.get(row.id) ?? 0,
          currencies: plan.limits?.currencies ?? 2,
          currenciesUsed: orgCurrencies.size,
        },
        billing: { 
          amount: plan.price,
          nextBillingDate,
          daysRemaining,
        },
      };
    });

    return { success: true, data: items };
  } catch (e) {
    return {
      success: false,
      data: [],
      error: e instanceof Error ? e.message : 'Could not load organizations',
    };
  }
}

export const platformOrganizationService = {
  /**
   * Every tenant, straight from Supabase.
   */
  async getAll(): Promise<ServiceResponse<PlatformOrganization[]>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<PlatformOrganization[]>('/platform/organizations');
      if (res.success) return res;
      // Server unreachable or running an older build — read the table directly instead.
      const fallback = await getAllFromSupabase();
      if (fallback.success) return fallback;
      return { success: false, data: [], error: res.error || fallback.error };
    }

    return getAllFromSupabase();
  },

  /**
   * Creates a tenant row in `organizations` (and its first admin) on the server.
   */
  async create(input: CreatePlatformOrganizationInput): Promise<ServiceResponse<PlatformOrganization>> {
    if (!isHttpBackendConfigured()) {
      return { success: false, data: null as any, error: 'HTTP backend not configured' };
    }
    return apiPostJson<CreatePlatformOrganizationInput, PlatformOrganization>(
      '/platform/organizations',
      input,
    );
  },

  /**
   * Updates a tenant row in `organizations`.
   */
  async update(
    id: string,
    updates: UpdatePlatformOrganizationInput,
  ): Promise<ServiceResponse<PlatformOrganization>> {
    if (!isHttpBackendConfigured()) {
      return { success: false, data: null as any, error: 'HTTP backend not configured' };
    }
    return apiRequest<PlatformOrganization>(
      `/platform/organizations/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );
  },

  /**
   * Opens a Realtime channel on `public.organizations`.
   *
   * Two signals are listened for:
   *   • `postgres_changes` — every INSERT/UPDATE/DELETE on the table, including edits made
   *     directly in the Supabase dashboard. Requires `organizations` to be part of the
   *     `supabase_realtime` publication (supabase/migrations/0009_platform_organizations_realtime.sql).
   *   • `broadcast` — "org-changed" pushed by the API right after the console creates/edits a
   *     tenant, so the list updates instantly even before the publication is enabled.
   *
   * Returns an unsubscribe function. `onStatus` reports whether the live channel is connected —
   * the console shows a "Live" badge only when it is.
   */
  subscribeToOrganizations(
    onChange: (event: OrganizationChangeEvent) => void,
    onStatus?: (status: RealtimeStatus) => void,
  ): () => void {
    const sb = getSupabaseClient();
    if (!sb) {
      onStatus?.('offline');
      return () => {};
    }

    onStatus?.('connecting');

    const channel = sb
      .channel('platform-organizations', { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'organizations' },
        (payload: any) => {
          onChange({
            eventType: payload.eventType as OrganizationChangeEvent['eventType'],
            id: payload.new?.id ?? payload.old?.id,
          });
        },
      )
      .on('broadcast', { event: 'org-changed' }, (payload: any) => {
        const event = payload?.payload?.event;
        onChange({
          eventType: event === 'deleted' ? 'DELETE' : event === 'created' ? 'INSERT' : 'UPDATE',
          id: payload?.payload?.id,
        });
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') onStatus?.('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onStatus?.('offline');
        }
      });

    return () => {
      try {
        sb.removeChannel(channel);
      } catch {
        /* channel already gone */
      }
    };
  },
};
