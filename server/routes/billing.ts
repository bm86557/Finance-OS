import { Router, type Request, type Response } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ok, fail, notFound } from '../lib/http.js';
import { env } from '../config/env.js';
import { stripeService, type PlatformPlan, type OrganizationSubscription, type BillingInvoice } from '../services/stripeService.js';
import {
  resolveAuthoritativeOrgPlan,
  normalizeCanonicalPlanLimits,
} from '../services/planEntitlementService.js';

export function createBillingRouter(): Router {
  const router = Router({ mergeParams: true });

  // Helper to resolve orgId from params
  function getOrgId(req: Request): string | null {
    return (req.params as any).organizationId || (req.params as any).orgId || null;
  }

  // GET /api/v1/organizations/:organizationId/billing/summary
  router.get('/summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) return fail(res, 'Missing organization ID', 400);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable', 500);

    try {
      // 1. Fetch organization
      const { data: org, error: orgErr } = await sb
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (orgErr || !org) return notFound(res, 'Organization not found');

      // 2. Fetch active plans catalogue (excluding legacy basic)
      const { data: plansData } = await sb
        .from('platform_plans')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      const plans: PlatformPlan[] = ((plansData as PlatformPlan[]) || [])
        .filter((p) => p.id !== 'plan-basic' && p.slug !== 'basic')
        .map((p) => ({
          ...p,
          limits: normalizeCanonicalPlanLimits(p.limits, p.slug || 'free'),
        }));

      // 3. Resolve authoritative plan & auto-downgrade if expired
      const authResult = await resolveAuthoritativeOrgPlan(sb, orgId);
      const currentPlan: PlatformPlan = {
        ...authResult.plan,
        limits: normalizeCanonicalPlanLimits(authResult.plan.limits, authResult.plan.slug || 'free'),
      };
      const subscription: OrganizationSubscription | null =
        (authResult.subscription as OrganizationSubscription) || null;

      // 4. Fetch real usage counters
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthStartIso = monthStart.toISOString();

      const [
        membersCountRes,
        statementsCountRes,
        accountsRes,
        bankAccountsRes,
        aiStatusRes,
        txCountRes,
        exportsCountRes,
        importSizeRes,
      ] = await Promise.all([
        sb.from('organization_members').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['active', 'pending']),
        sb.from('import_history_records').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', monthStartIso),
        sb.from('accounts').select('currency').eq('organization_id', orgId),
        sb.from('bank_accounts').select('currency').eq('organization_id', orgId).eq('is_active', true),
        sb.from('org_ai_status').select('platform_requests_this_month').eq('organization_id', orgId).maybeSingle(),
        sb.from('transactions').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', monthStartIso),
        sb.from('audit_logs').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).ilike('action', '%export%').gte('created_at', monthStartIso),
        sb.from('import_history_records').select('file_size').eq('organization_id', orgId),
      ]);

      const distinctCurrencies = new Set<string>();
      if (org.currency) distinctCurrencies.add(org.currency.toUpperCase());
      (accountsRes.data || []).forEach((a: any) => {
        if (a.currency) distinctCurrencies.add(a.currency.toUpperCase());
      });
      (bankAccountsRes.data || []).forEach((a: any) => {
        if (a.currency) distinctCurrencies.add(a.currency.toUpperCase());
      });

      const totalImportBytes = (importSizeRes.data || []).reduce(
        (sum: number, r: any) => sum + (Number(r.file_size) || 0),
        0,
      );
      const realStorageUsedMb = Math.round((totalImportBytes / (1024 * 1024)) * 100) / 100;

      const limits = normalizeCanonicalPlanLimits(currentPlan.limits, currentPlan.slug || 'free');
      const usage = {
        users: limits.users,
        usersUsed: membersCountRes.count ?? 1,
        statements: limits.statements,
        statementsUsed: statementsCountRes.count ?? 0,
        currencies: limits.currencies ?? 2,
        currenciesUsed: distinctCurrencies.size || 1,
        storage: limits.storage,
        storageUsed: realStorageUsedMb,
        aiCredits: limits.ai_credits ?? 50,
        aiCreditsUsed: Number(aiStatusRes.data?.platform_requests_this_month ?? 0),
        transactions: limits.transactions ?? 500,
        transactionsUsed: txCountRes.count ?? 0,
        bankAccounts: limits.bank_accounts ?? 2,
        bankAccountsUsed: (bankAccountsRes.data || []).length,
        exports: limits.exports ?? 5,
        exportsUsed: exportsCountRes.count ?? 0,
      };

      // 6. Fetch recent invoices
      const { data: invoicesData } = await sb
        .from('billing_invoices')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);

      const invoices: BillingInvoice[] = (invoicesData as BillingInvoice[]) || [];

      return ok(res, {
        organization: {
          id: org.id,
          name: org.name,
          currency: org.currency,
          plan: currentPlan.slug,
          planFeatures: org.settings?.planFeatures || currentPlan.features,
        },
        currentPlan,
        subscription,
        usage,
        availablePlans: plans,
        invoices,
        stripeConfig: {
          mode: env.stripeMode,
          publishableKey: env.stripePublishableKey,
          isConfigured: Boolean(env.stripeSecretKey),
        },
      });
    } catch (err: any) {
      return fail(res, err.message || 'Failed to fetch billing summary', 500);
    }
  });

  // POST /api/v1/organizations/:organizationId/billing/checkout-session
  router.post('/checkout-session', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) return fail(res, 'Missing organization ID', 400);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable', 500);

    try {
      const { planId, planSlug, successUrl, cancelUrl, customerEmail } = req.body;
      if (!planId && !planSlug) {
        return fail(res, 'planId or planSlug is required', 400);
      }

      // Fetch org
      const { data: org, error: orgErr } = await sb
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();
      if (orgErr || !org) return notFound(res, 'Organization not found');

      // Fetch plan
      const { data: planData, error: planErr } = await sb
        .from('platform_plans')
        .select('*')
        .or(`id.eq.${planId || ''},slug.eq.${planSlug || planId || ''}`)
        .single();

      if (planErr || !planData) {
        return notFound(res, 'Target plan not found');
      }

      const plan = planData as PlatformPlan;

      // Track pending plan in org settings for seamless fallback/verification
      await sb
        .from('organizations')
        .update({
          settings: {
            ...org.settings,
            pendingPlanId: plan.id,
            pendingPlanSlug: plan.slug,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', orgId);

      const appOrigin = req.headers.origin || 'http://localhost:5173';
      const resolvedSuccessUrl = successUrl || `${appOrigin}/dashboard?view=settings&tab=billing&session_id={CHECKOUT_SESSION_ID}`;
      const resolvedCancelUrl = cancelUrl || `${appOrigin}/dashboard?view=settings&tab=billing&checkout_cancelled=true`;

      const session = await stripeService.createCheckoutSession({
        orgId,
        orgName: org.name,
        plan,
        successUrl: resolvedSuccessUrl,
        cancelUrl: resolvedCancelUrl,
        customerEmail: customerEmail || (req as any).user?.email,
      });

      return ok(res, {
        ...session,
        plan,
      });
    } catch (err: any) {
      return fail(res, err.message || 'Failed to create checkout session', 500);
    }
  });

  // POST /api/v1/organizations/:organizationId/billing/verify-session
  router.post('/verify-session', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) return fail(res, 'Missing organization ID', 400);

    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return fail(res, 'sessionId is required', 400);
      }

      const fulfillment = await stripeService.verifyAndFulfillSession(sessionId, orgId);
      return ok(res, {
        success: true,
        message: `Plan upgraded to ${fulfillment.plan.name} successfully`,
        ...fulfillment,
      });
    } catch (err: any) {
      return fail(res, err.message || 'Failed to verify checkout session', 500);
    }
  });

  // POST /api/v1/organizations/:organizationId/billing/cancel
  router.post('/cancel', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) return fail(res, 'Missing organization ID', 400);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable', 500);

    try {
      const { data: sub } = await sb
        .from('organization_subscriptions')
        .select('*')
        .eq('organization_id', orgId)
        .single();

      if (!sub) {
        return notFound(res, 'Active subscription not found');
      }

      const { data: updatedSub, error } = await sb
        .from('organization_subscriptions')
        .update({
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id)
        .select('*')
        .single();

      if (error) return fail(res, error.message, 500);

      return ok(res, {
        success: true,
        message: 'Subscription will cancel at the end of the current billing cycle.',
        subscription: updatedSub,
      });
    } catch (err: any) {
      return fail(res, err.message || 'Failed to cancel subscription', 500);
    }
  });

  // GET /api/v1/organizations/:organizationId/billing/invoices
  router.get('/invoices', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) return fail(res, 'Missing organization ID', 400);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable', 500);

    try {
      const { data: invoices, error } = await sb
        .from('billing_invoices')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) return fail(res, error.message, 500);
      return ok(res, invoices || []);
    } catch (err: any) {
      return fail(res, err.message || 'Failed to fetch invoices', 500);
    }
  });

  return router;
}

