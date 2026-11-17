import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformPlan, PlanLimits } from './stripeService.js';

export type QuotaDimension =
  | 'users'
  | 'organizations'
  | 'bank_accounts'
  | 'statements'
  | 'transactions'
  | 'ai_credits'
  | 'exports'
  | 'storage'
  | 'currencies';

export const CANONICAL_DEFAULT_PLANS: PlatformPlan[] = [
  {
    id: 'plan-free',
    slug: 'free',
    name: 'Free/Trial',
    description: '14-day trial & essential ledger access for small agency exploration',
    price: 0,
    currency: 'PKR',
    billing_interval: 'month',
    features: ['statement_import'],
    limits: {
      users: 2,
      organizations: 1,
      bank_accounts: 2,
      statements: 50,
      transactions: 500,
      ai_credits: 50,
      exports: 5,
      storage: 1024,
      audit_retention: 14,
      currencies: 2,
    },
    is_popular: false,
    active: true,
    sort_order: 1,
  },
  {
    id: 'plan-starter',
    slug: 'starter',
    name: 'Starter',
    description: 'Core accounting, narration learning and bank statement import for growing studios',
    price: 19900,
    currency: 'PKR',
    billing_interval: 'month',
    features: [
      'statement_import',
      'personal_finance',
      'recurring_transactions',
      'budget_alerts',
    ],
    limits: {
      users: 5,
      organizations: 1,
      bank_accounts: 5,
      statements: 250,
      transactions: 2500,
      ai_credits: 250,
      exports: 25,
      storage: 5120,
      audit_retention: 60,
      currencies: 3,
    },
    is_popular: false,
    active: true,
    sort_order: 2,
  },
  {
    id: 'plan-professional',
    slug: 'professional',
    name: 'Professional',
    description: 'Unit economics, team management, AI financial analyst, and profit intelligence',
    price: 49900,
    currency: 'PKR',
    billing_interval: 'month',
    features: [
      'statement_import',
      'personal_finance',
      'recurring_transactions',
      'budget_alerts',
      'profit_intelligence',
      'team_management',
      'costing_engine',
      'ai_assistant',
    ],
    limits: {
      users: 15,
      organizations: 3,
      bank_accounts: 15,
      statements: 1000,
      transactions: 10000,
      ai_credits: 1000,
      exports: 100,
      storage: 20480,
      audit_retention: 180,
      currencies: 5,
    },
    is_popular: true,
    active: true,
    sort_order: 3,
  },
  {
    id: 'plan-business',
    slug: 'business',
    name: 'Business',
    description: 'Multi-entity support, fixed assets, debt schedules, and predictive cash flow runway',
    price: 79900,
    currency: 'PKR',
    billing_interval: 'month',
    features: [
      'statement_import',
      'personal_finance',
      'recurring_transactions',
      'budget_alerts',
      'profit_intelligence',
      'team_management',
      'costing_engine',
      'ai_assistant',
      'forecast_modeling',
      'projects',
      'assets',
      'loans',
      'reports',
    ],
    limits: {
      users: 35,
      organizations: 10,
      bank_accounts: 50,
      statements: 5000,
      transactions: 50000,
      ai_credits: 3000,
      exports: 500,
      storage: 51200,
      audit_retention: 365,
      currencies: 10,
    },
    is_popular: false,
    active: true,
    sort_order: 4,
  },
  {
    id: 'plan-enterprise',
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Full-suite agency OS: what-if simulator, inventory valuation, payroll GL, custom domain & white labeling',
    price: 99900,
    currency: 'PKR',
    billing_interval: 'month',
    features: [
      'statement_import',
      'personal_finance',
      'recurring_transactions',
      'budget_alerts',
      'profit_intelligence',
      'team_management',
      'costing_engine',
      'ai_assistant',
      'forecast_modeling',
      'projects',
      'simulator',
      'assets',
      'inventory',
      'loans',
      'reports',
      'payroll',
      'integrations',
      'api_access',
      'white_label',
    ],
    limits: {
      users: 100,
      organizations: 50,
      bank_accounts: 200,
      statements: 25000,
      transactions: 250000,
      ai_credits: 10000,
      exports: 2500,
      storage: 204800,
      audit_retention: 1825,
      currencies: 25,
    },
    is_popular: false,
    active: true,
    sort_order: 5,
  },
];

export function normalizeCanonicalPlanLimits(
  rawLimits: Partial<PlanLimits> | null | undefined,
  fallbackSlug = 'free',
): PlanLimits {
  const fallback =
    CANONICAL_DEFAULT_PLANS.find((p) => p.slug === fallbackSlug)?.limits ??
    CANONICAL_DEFAULT_PLANS[0].limits;

  return {
    users: Number(rawLimits?.users ?? fallback.users),
    organizations: Number((rawLimits as any)?.organizations ?? (fallback as any).organizations ?? 1),
    bank_accounts: Number((rawLimits as any)?.bank_accounts ?? (fallback as any).bank_accounts ?? 2),
    statements: Number(rawLimits?.statements ?? fallback.statements),
    transactions: Number(rawLimits?.transactions ?? fallback.transactions ?? 500),
    ai_credits: Number(rawLimits?.ai_credits ?? fallback.ai_credits ?? 50),
    exports: Number((rawLimits as any)?.exports ?? (fallback as any).exports ?? 5),
    storage: Number(rawLimits?.storage ?? fallback.storage),
    audit_retention: Number(rawLimits?.audit_retention ?? fallback.audit_retention ?? 14),
    currencies: Number(rawLimits?.currencies ?? fallback.currencies ?? 2),
  };
}

export async function getFreePlan(sb: SupabaseClient): Promise<PlatformPlan> {
  try {
    const { data } = await sb
      .from('platform_plans')
      .select('*')
      .or('id.eq.plan-free,slug.eq.free')
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        ...(data as PlatformPlan),
        limits: normalizeCanonicalPlanLimits((data as any).limits, 'free'),
      };
    }
  } catch {
    /* fallback below */
  }
  return CANONICAL_DEFAULT_PLANS[0];
}

export async function resolvePlanByKeyOrId(
  sb: SupabaseClient,
  keyOrId: string | null | undefined,
): Promise<PlatformPlan> {
  const raw = String(keyOrId || '').trim();
  const normalizedSlug = raw.toLowerCase().replace(/^plan-/, '');

  if (raw) {
    try {
      const { data } = await sb
        .from('platform_plans')
        .select('*')
        .or(`id.eq.${raw},slug.eq.${normalizedSlug},slug.eq.${raw.toLowerCase()}`)
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          ...(data as PlatformPlan),
          limits: normalizeCanonicalPlanLimits((data as any).limits, (data as any).slug || 'free'),
        };
      }
    } catch {
      /* fallback below */
    }
  }

  const defaultMatch = CANONICAL_DEFAULT_PLANS.find(
    (p) => p.id === raw || p.slug === normalizedSlug || p.name.toLowerCase() === raw.toLowerCase(),
  );
  if (defaultMatch) return defaultMatch;

  return getFreePlan(sb);
}

/**
 * Checks if a subscription's period has elapsed and should automatically downgrade to Free tier.
 * Permanent Free tier (`plan_slug === 'free' && status === 'active' && !cancel_at_period_end`)
 * does not expire again.
 */
export function isSubscriptionExpiredForDowngrade(sub: any): boolean {
  if (!sub || !sub.current_period_end) return false;
  const endMs = new Date(sub.current_period_end).getTime();
  if (!Number.isFinite(endMs) || endMs > Date.now()) return false;

  const isPermanentFree =
    sub.plan_slug === 'free' &&
    sub.status === 'active' &&
    !sub.cancel_at_period_end;

  return !isPermanentFree;
}

export interface AuthoritativeOrgPlanResult {
  plan: PlatformPlan;
  subscription: any | null;
  wasDowngraded: boolean;
  orgSettings: Record<string, any>;
}

/**
 * Resolves the authoritative plan for an organization and automatically downgrades
 * expired trials or expired paid subscriptions to the Free tier (`plan-free`).
 */
export async function resolveAuthoritativeOrgPlan(
  sb: SupabaseClient,
  orgId: string,
): Promise<AuthoritativeOrgPlanResult> {
  const [orgRes, subRes] = await Promise.all([
    sb.from('organizations').select('id, name, currency, settings').eq('id', orgId).maybeSingle(),
    sb.from('organization_subscriptions').select('*').eq('organization_id', orgId).maybeSingle(),
  ]);

  const org = orgRes.data as { id: string; name?: string; currency?: string; settings?: Record<string, any> } | null;
  let sub = subRes.data as any | null;
  let orgSettings: Record<string, any> = { ...(org?.settings || {}) };
  let wasDowngraded = false;

  if (sub && isSubscriptionExpiredForDowngrade(sub)) {
    const freePlan = await getFreePlan(sb);
    const previousPlan = sub.plan_slug || orgSettings.plan || 'unknown';
    const nowIso = new Date().toISOString();
    // Permanent free tier non-expiring horizon (10 years) to satisfy NOT NULL current_period_end
    const freeHorizonIso = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000).toISOString();

    const { data: updatedSub } = await sb
      .from('organization_subscriptions')
      .update({
        plan_id: freePlan.id,
        plan_slug: freePlan.slug || 'free',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: nowIso,
        current_period_end: freeHorizonIso,
        updated_at: nowIso,
      })
      .eq('id', sub.id)
      .select('*')
      .maybeSingle();

    if (updatedSub) {
      sub = updatedSub;
    } else {
      sub = {
        ...sub,
        plan_id: freePlan.id,
        plan_slug: 'free',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: nowIso,
        current_period_end: freeHorizonIso,
      };
    }

    orgSettings = {
      ...orgSettings,
      plan: 'free',
      planId: freePlan.id,
      planName: freePlan.name,
      planFeatures: freePlan.features,
      limits: freePlan.limits,
      status: 'active',
      downgradedFromPlan: previousPlan,
      downgradedAt: nowIso,
    };

    await sb
      .from('organizations')
      .update({ settings: orgSettings, updated_at: nowIso })
      .eq('id', orgId);

    // Best-effort audit log + org notification
    try {
      await sb.from('audit_logs').insert({
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        organization_id: orgId,
        action: 'subscription.auto_downgraded',
        entity_type: 'organization_subscription',
        entity_id: sub.id,
        details: {
          previous_plan: previousPlan,
          new_plan: 'free',
          reason: 'plan_period_completed',
          downgraded_at: nowIso,
        },
        created_at: nowIso,
      });
    } catch {
      /* non-critical */
    }

    try {
      await sb.from('organization_notifications').insert({
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        organization_id: orgId,
        type: 'warning',
        title: 'Plan Switched to Free Tier',
        message: `Your ${previousPlan} plan period ended and your organization was automatically switched to the Free/Trial tier to maintain continuity and security.`,
        is_read: false,
        created_at: nowIso,
      });
    } catch {
      /* non-critical */
    }

    wasDowngraded = true;
    return { plan: freePlan, subscription: sub, wasDowngraded, orgSettings };
  }

  // Normalize legacy 'basic' references to 'free'
  const rawPlanKey = sub?.plan_id || sub?.plan_slug || orgSettings.planId || orgSettings.plan || 'free';
  const normalizedKey = rawPlanKey === 'basic' || rawPlanKey === 'plan-basic' ? 'free' : rawPlanKey;
  const plan = await resolvePlanByKeyOrId(sb, normalizedKey);

  return { plan, subscription: sub, wasDowngraded, orgSettings };
}

/**
 * Batch sweep for Platform Admin views so all expired organizations are
 * automatically downgraded to Free tier before listing.
 */
export async function sweepExpiredSubscriptions(sb: SupabaseClient): Promise<number> {
  try {
    const nowIso = new Date().toISOString();
    const { data: expiredSubs } = await sb
      .from('organization_subscriptions')
      .select('organization_id, plan_slug, status, cancel_at_period_end, current_period_end')
      .lte('current_period_end', nowIso);

    if (!expiredSubs || expiredSubs.length === 0) return 0;

    let count = 0;
    for (const sub of expiredSubs) {
      if (isSubscriptionExpiredForDowngrade(sub)) {
        const res = await resolveAuthoritativeOrgPlan(sb, sub.organization_id);
        if (res.wasDowngraded) count += 1;
      }
    }
    return count;
  } catch (err: any) {
    console.warn('[PlanEntitlementService] sweepExpiredSubscriptions error:', err?.message);
    return 0;
  }
}

/**
 * Creates or updates an organization_subscriptions row when an org is created or
 * assigned a plan from Platform Admin.
 */
export async function createOrUpdateOrgSubscription(
  sb: SupabaseClient,
  params: {
    orgId: string;
    plan: PlatformPlan;
    status?: 'active' | 'trialing';
    durationDays?: number;
  },
): Promise<any | null> {
  const { orgId, plan } = params;
  const slug = (plan.slug || 'free').toLowerCase();
  const isFree = slug === 'free' || Number(plan.price) === 0;
  const durationDays =
    params.durationDays ??
    (isFree ? 14 : plan.billing_interval === 'year' ? 365 : 30);

  const now = new Date();
  const end = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const status = params.status ?? (isFree ? 'trialing' : 'active');

  const { data: existing } = await sb
    .from('organization_subscriptions')
    .select('id')
    .eq('organization_id', orgId)
    .maybeSingle();

  const payload = {
    organization_id: orgId,
    plan_id: plan.id,
    plan_slug: slug,
    status,
    payment_provider: 'platform_admin',
    current_period_start: now.toISOString(),
    current_period_end: end.toISOString(),
    cancel_at_period_end: false,
    updated_at: now.toISOString(),
  };

  if (existing?.id) {
    const { data } = await sb
      .from('organization_subscriptions')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    return data;
  }

  const { data } = await sb
    .from('organization_subscriptions')
    .insert({
      id: `sub-${orgId}-${Date.now().toString(36)}`,
      ...payload,
      created_at: now.toISOString(),
    })
    .select('*')
    .maybeSingle();

  return data;
}

export interface QuotaCheckResult {
  allowed: boolean;
  dimension: QuotaDimension;
  used: number;
  limit: number;
  planName: string;
  planSlug: string;
  reason?: string;
}

/**
 * Enforces plan resource quotas server-side from authoritative platform_plans.limits.
 */
export async function checkOrgQuota(
  sb: SupabaseClient,
  orgId: string,
  dimension: QuotaDimension,
  increment = 1,
): Promise<QuotaCheckResult> {
  const { plan } = await resolveAuthoritativeOrgPlan(sb, orgId);
  const limits = normalizeCanonicalPlanLimits(plan.limits, plan.slug || 'free');
  const limit = Number((limits as any)[dimension] ?? 0);
  const planName = plan.name || 'Free/Trial';
  const planSlug = plan.slug || 'free';

  // 0 or negative means unlimited only if explicitly < 0; 0 means 0 allowed
  if (limit < 0) {
    return { allowed: true, dimension, used: 0, limit, planName, planSlug };
  }

  let used = 0;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  if (dimension === 'users') {
    const { count } = await sb
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['active', 'pending']);
    used = count ?? 0;
  } else if (dimension === 'statements') {
    const { count } = await sb
      .from('import_history_records')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', monthStartIso);
    used = count ?? 0;
  } else if (dimension === 'transactions') {
    const { count } = await sb
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', monthStartIso);
    used = count ?? 0;
  } else if (dimension === 'bank_accounts') {
    const { count } = await sb
      .from('bank_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', true);
    used = count ?? 0;
  } else if (dimension === 'ai_credits') {
    const { data: statusRow } = await sb
      .from('org_ai_status')
      .select('platform_requests_this_month')
      .eq('organization_id', orgId)
      .maybeSingle();
    used = Number(statusRow?.platform_requests_this_month ?? 0);
  } else if (dimension === 'storage') {
    const { data: importRows } = await sb
      .from('import_history_records')
      .select('file_size')
      .eq('organization_id', orgId);
    const totalBytes = (importRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.file_size) || 0), 0);
    used = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
  } else if (dimension === 'exports') {
    const { count } = await sb
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .ilike('action', '%export%')
      .gte('created_at', monthStartIso);
    used = count ?? 0;
  } else if (dimension === 'currencies') {
    const { data: accounts } = await sb
      .from('bank_accounts')
      .select('currency')
      .eq('organization_id', orgId)
      .eq('is_active', true);
    const distinct = new Set((accounts ?? []).map((a: any) => String(a.currency || 'USD').toUpperCase()));
    used = distinct.size;
  }

  const allowed = used + increment <= limit;
  return {
    allowed,
    dimension,
    used,
    limit,
    planName,
    planSlug,
    reason: allowed
      ? undefined
      : `${planName} plan limit reached for ${dimension.replace(/_/g, ' ')} (${used}/${limit}). Upgrade your plan in Settings → Billing.`,
  };
}
