import { Router, type Request, type Response } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { stripeService, type PlatformPlan } from '../services/stripeService.js';

export function createPlatformPlansRouter(): Router {
  const router = Router();

  const DEFAULT_SEEDED_PLANS: PlatformPlan[] = [
    {
      id: 'plan-basic',
      slug: 'basic',
      name: 'Basic',
      description: 'Essential financial ledger & statement import for emerging agencies',
      price: 0,
      currency: 'PKR',
      billing_interval: 'month',
      features: ['statement_import'],
      limits: {
        users: 5,
        statements: 100,
        currencies: 2,
        storage: 2048,
        transactions: 1000,
        ai_credits: 100,
        audit_retention: 30,
      },
      is_popular: false,
      active: true,
      sort_order: 1,
    },
    {
      id: 'plan-professional',
      slug: 'professional',
      name: 'Professional',
      description: 'Complete intelligence, unit costing and team collaboration engine',
      price: 49900,
      currency: 'PKR',
      billing_interval: 'month',
      features: [
        'personal_finance',
        'statement_import',
        'profit_intelligence',
        'team_management',
        'costing_engine',
        'ai_assistant',
        'recurring_transactions',
        'budget_alerts',
      ],
      limits: {
        users: 10,
        statements: 500,
        currencies: 5,
        storage: 10240,
        transactions: 5000,
        ai_credits: 500,
        audit_retention: 90,
      },
      is_popular: true,
      active: true,
      sort_order: 2,
    },
    {
      id: 'plan-enterprise',
      slug: 'enterprise',
      name: 'Enterprise',
      description: 'Full-suite agency operating system with custom modeling, simulator, assets & white labeling',
      price: 99900,
      currency: 'PKR',
      billing_interval: 'month',
      features: [
        'personal_finance',
        'statement_import',
        'profit_intelligence',
        'team_management',
        'costing_engine',
        'ai_assistant',
        'recurring_transactions',
        'budget_alerts',
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
        users: 50,
        statements: 2000,
        currencies: 10,
        storage: 51200,
        transactions: 50000,
        ai_credits: 2500,
        audit_retention: 365,
      },
      is_popular: false,
      active: true,
      sort_order: 3,
    },
  ];

  /**
   * Helper to ensure plans exist in database or return memory defaults
   */
  async function ensureAndFetchPlans(): Promise<PlatformPlan[]> {
    const sb = getSupabaseAdminClient();
    if (!sb) return DEFAULT_SEEDED_PLANS;

    try {
      const { data, error } = await sb
        .from('platform_plans')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) {
        console.warn('[PlatformPlans] Failed to query platform_plans table, using defaults:', error.message);
        return DEFAULT_SEEDED_PLANS;
      }

      if (!data || data.length === 0) {
        // Auto-seed table
        await sb.from('platform_plans').upsert(DEFAULT_SEEDED_PLANS);
        return DEFAULT_SEEDED_PLANS;
      }

      return data as PlatformPlan[];
    } catch (err: any) {
      console.warn('[PlatformPlans] Error fetching plans:', err.message);
      return DEFAULT_SEEDED_PLANS;
    }
  }

  // GET /api/v1/platform/plans
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const plans = await ensureAndFetchPlans();
      return ok(res, plans);
    } catch (err: any) {
      return fail(res, err.message || 'Failed to list platform plans');
    }
  });

  // GET /api/v1/platform/plans/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const plans = await ensureAndFetchPlans();
      const plan = plans.find((p) => p.id === id || p.slug === id);
      if (!plan) {
        return notFound(res, 'Plan not found');
      }
      return ok(res, plan);
    } catch (err: any) {
      return fail(res, err.message || 'Failed to fetch plan');
    }
  });

  // POST /api/v1/platform/plans (Create a new plan)
  router.post('/', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable');

    try {
      const body = req.body;
      const name = String(body.name || '').trim();
      if (!name) {
        return fail(res, 'Plan name is required', 400);
      }

      const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).trim();
      const price = Math.max(0, Number(body.price ?? 0));
      const currency = String(body.currency || 'PKR').toUpperCase();
      const billingInterval = body.billing_interval === 'year' ? 'year' : 'month';
      const features = Array.isArray(body.features) ? body.features : [];
      const limits = {
        users: Number(body.limits?.users ?? 5),
        statements: Number(body.limits?.statements ?? 100),
        currencies: Number(body.limits?.currencies ?? 2),
        storage: Number(body.limits?.storage ?? 2048),
        transactions: Number(body.limits?.transactions ?? 1000),
        ai_credits: Number(body.limits?.ai_credits ?? 100),
        audit_retention: Number(body.limits?.audit_retention ?? 30),
      };
      const isPopular = Boolean(body.is_popular);
      const active = body.active !== undefined ? Boolean(body.active) : true;
      const sortOrder = Number(body.sort_order ?? 10);

      const planId = body.id || `plan-${slug}-${Date.now().toString(36)}`;

      const newPlan: PlatformPlan = {
        id: planId,
        slug,
        name,
        description: body.description ? String(body.description).trim() : null,
        price,
        currency,
        billing_interval: billingInterval,
        features,
        limits,
        is_popular: isPopular,
        active,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Sync with Stripe Sandbox
      const stripeSync = await stripeService.syncPlanWithStripe(newPlan);
      if (stripeSync) {
        newPlan.stripe_product_id = stripeSync.productId;
        newPlan.stripe_price_id = stripeSync.priceId;
      }

      // Insert into Supabase
      const { data, error } = await sb
        .from('platform_plans')
        .insert(newPlan)
        .select('*')
        .single();

      if (error) {
        return fail(res, `Failed to create plan in database: ${error.message}`, 500);
      }

      return created(res, data);
    } catch (err: any) {
      return fail(res, err.message || 'Failed to create plan', 500);
    }
  });

  // PATCH /api/v1/platform/plans/:id (Edit an existing plan)
  router.patch('/:id', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable');

    try {
      const { id } = req.params;
      const body = req.body;

      // Check existing plan
      const { data: existingPlan, error: findErr } = await sb
        .from('platform_plans')
        .select('*')
        .or(`id.eq.${id},slug.eq.${id}`)
        .single();

      if (findErr || !existingPlan) {
        return notFound(res, 'Plan not found');
      }

      const updates: Partial<PlatformPlan> = {
        updated_at: new Date().toISOString(),
      };

      if (body.name !== undefined) updates.name = String(body.name).trim();
      if (body.description !== undefined) updates.description = body.description ? String(body.description).trim() : null;
      if (body.price !== undefined) updates.price = Math.max(0, Number(body.price));
      if (body.currency !== undefined) updates.currency = String(body.currency).toUpperCase();
      if (body.billing_interval !== undefined) updates.billing_interval = body.billing_interval === 'year' ? 'year' : 'month';
      if (body.is_popular !== undefined) updates.is_popular = Boolean(body.is_popular);
      if (body.active !== undefined) updates.active = Boolean(body.active);
      if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);

      if (Array.isArray(body.features)) {
        updates.features = body.features;
      }

      if (body.limits && typeof body.limits === 'object') {
        updates.limits = {
          ...existingPlan.limits,
          ...body.limits,
        };
      }

      // Sync updated price/product with Stripe Sandbox if price or currency changed
      const mergedPlan: PlatformPlan = { ...existingPlan, ...updates } as PlatformPlan;
      if (body.price !== undefined || body.currency !== undefined || !mergedPlan.stripe_price_id) {
        const stripeSync = await stripeService.syncPlanWithStripe(mergedPlan);
        if (stripeSync) {
          updates.stripe_product_id = stripeSync.productId;
          updates.stripe_price_id = stripeSync.priceId;
        }
      }

      // Update in Supabase
      const { data: updatedPlan, error: updateErr } = await sb
        .from('platform_plans')
        .update(updates)
        .eq('id', existingPlan.id)
        .select('*')
        .single();

      if (updateErr) {
        return fail(res, `Failed to update plan: ${updateErr.message}`, 500);
      }

      // CRITICAL REQUIREMENT: Propagate updated features and limits to all organizations on this plan!
      if (updates.features || updates.limits) {
        try {
          // Fetch all organizations currently assigned to this plan slug or plan ID
          const { data: orgs } = await sb
            .from('organizations')
            .select('id, settings');

          if (orgs && orgs.length > 0) {
            for (const org of orgs) {
              const currentPlanSlug = org.settings?.plan;
              const currentPlanId = org.settings?.planId;

              if (currentPlanSlug === existingPlan.slug || currentPlanId === existingPlan.id) {
                const newSettings = {
                  ...org.settings,
                  planFeatures: updatedPlan.features,
                  planName: updatedPlan.name,
                  limits: {
                    ...(org.settings?.limits || {}),
                    users: updatedPlan.limits.users,
                    statements: updatedPlan.limits.statements,
                    currencies: updatedPlan.limits.currencies,
                    storage: updatedPlan.limits.storage,
                  },
                };

                await sb
                  .from('organizations')
                  .update({
                    settings: newSettings,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', org.id);
              }
            }
          }
        } catch (propagateErr: any) {
          console.warn('[PlatformPlans] Org feature propagation notice:', propagateErr.message);
        }
      }

      return ok(res, updatedPlan);
    } catch (err: any) {
      return fail(res, err.message || 'Failed to update plan', 500);
    }
  });

  // DELETE /api/v1/platform/plans/:id (Soft-deactivate or delete)
  router.delete('/:id', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 'Database unavailable');

    try {
      const { id } = req.params;
      const { data: existingPlan } = await sb
        .from('platform_plans')
        .select('*')
        .or(`id.eq.${id},slug.eq.${id}`)
        .single();

      if (!existingPlan) return notFound(res, 'Plan not found');

      // Soft deactivate so existing organizations aren't stranded
      const { error } = await sb
        .from('platform_plans')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', existingPlan.id);

      if (error) return fail(res, error.message, 500);
      return ok(res, { success: true, message: 'Plan deactivated successfully' });
    } catch (err: any) {
      return fail(res, err.message || 'Failed to delete plan', 500);
    }
  });

  return router;
}

