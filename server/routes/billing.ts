import { Router, type Request, type Response } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ok, fail, notFound } from '../lib/http.js';
import { env } from '../config/env.js';
import { stripeService, type PlatformPlan, type OrganizationSubscription, type BillingInvoice } from '../services/stripeService.js';

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

      // 2. Fetch active plans catalogue
      const { data: plansData } = await sb
        .from('platform_plans')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      const plans: PlatformPlan[] = (plansData as PlatformPlan[]) || [];

      // 3. Resolve active plan
      const currentPlanSlug = org.settings?.plan || 'basic';
      const currentPlanId = org.settings?.planId;
      let currentPlan = plans.find((p) => p.id === currentPlanId || p.slug === currentPlanSlug);

      if (!currentPlan) {
        currentPlan = plans.find((p) => p.slug === 'basic') || {
          id: 'plan-basic',
          slug: 'basic',
          name: 'Basic',
          description: 'Essential financial ledger',
          price: 0,
          currency: 'PKR',
          billing_interval: 'month',
          features: ['statement_import'],
          limits: { users: 5, statements: 100, currencies: 2, storage: 2048 },
          is_popular: false,
          active: true,
        };
      }

      // 4. Fetch subscription record
      const { data: subData } = await sb
        .from('organization_subscriptions')
        .select('*')
        .eq('organization_id', orgId)
        .single();

      const subscription: OrganizationSubscription | null = (subData as OrganizationSubscription) || null;

      // 5. Fetch real usage counters
      const [membersCountRes, statementsCountRes, accountsRes] = await Promise.all([
        sb.from('organization_members').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
        sb.from('import_history_records').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
        sb.from('accounts').select('currency').eq('organization_id', orgId),
      ]);

      const distinctCurrencies = new Set<string>();
      if (org.currency) distinctCurrencies.add(org.currency.toUpperCase());
      (accountsRes.data || []).forEach((a: any) => {
        if (a.currency) distinctCurrencies.add(a.currency.toUpperCase());
      });

      const usage = {
        users: currentPlan.limits.users,
        usersUsed: membersCountRes.count ?? 1,
        statements: currentPlan.limits.statements,
        statementsUsed: statementsCountRes.count ?? 0,
        currencies: currentPlan.limits.currencies,
        currenciesUsed: distinctCurrencies.size || 1,
        storage: currentPlan.limits.storage,
        storageUsed: Math.min(currentPlan.limits.storage, (statementsCountRes.count ?? 0) * 12 + 45), // Estimated MB
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

