import type { Request, Response, NextFunction } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { fail } from '../lib/http.js';
import { normalizeFeatureKey } from '../../src/config/planFeatures.js';

export function requirePlanFeature(featureKey: string) {
  const normalizedRequired = normalizeFeatureKey(featureKey);

  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = (req.params as any).organizationId || (req.params as any).orgId || (req.query as any).organizationId || (req.body as any)?.organizationId;

    // If no org ID in route params or query, permit or skip (global routes)
    if (!orgId) {
      return next();
    }

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return next(); // Fail-open in dev if DB is offline, or next
    }

    try {
      const { data: org, error } = await sb
        .from('organizations')
        .select('id, name, settings')
        .eq('id', orgId)
        .single();

      if (error || !org) {
        return next();
      }

      // Check features array in settings.planFeatures or look up plan
      let grantedFeatures: string[] = org.settings?.planFeatures || [];

      if (!grantedFeatures || grantedFeatures.length === 0) {
        // Look up plan directly
        const planSlug = org.settings?.plan || 'basic';
        const planId = org.settings?.planId;

        const { data: planData } = await sb
          .from('platform_plans')
          .select('features')
          .or(`id.eq.${planId || ''},slug.eq.${planSlug}`)
          .single();

        if (planData && Array.isArray(planData.features)) {
          grantedFeatures = planData.features;
        } else if (planSlug === 'basic') {
          grantedFeatures = ['statement_import'];
        } else if (planSlug === 'professional') {
          grantedFeatures = [
            'personal_finance',
            'statement_import',
            'profit_intelligence',
            'team_management',
            'costing_engine',
            'ai_assistant',
            'recurring_transactions',
            'budget_alerts',
          ];
        } else if (planSlug === 'enterprise') {
          return next(); // Enterprise has all features
        }
      }

      const normalizedGranted = (grantedFeatures || []).map(normalizeFeatureKey);

      if (!normalizedGranted.includes(normalizedRequired)) {
        return fail(
          res,
          `Access to ${featureKey} is restricted. Your organization's current plan does not include this feature. Upgrade in Settings → Billing to unlock it.`,
          403
        );
      }

      return next();
    } catch (err: any) {
      console.warn('[PlanEntitlement] Error checking feature entitlement:', err.message);
      return next();
    }
  };
}

