import type { Request, Response, NextFunction } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { fail } from '../lib/http.js';
import { normalizeFeatureKey } from '../../src/config/planFeatures.js';
import { resolveAuthoritativeOrgPlan } from '../services/planEntitlementService.js';

export function requireAnyPlanFeature(...featureKeys: string[]) {
  const normalizedRequired = featureKeys.map(normalizeFeatureKey);

  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId =
      (req.params as any).organizationId ||
      (req.params as any).orgId ||
      (req.query as any).organizationId ||
      (req.body as any)?.organizationId;

    if (!orgId) {
      return next();
    }

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return next();
    }

    try {
      const { plan, orgSettings } = await resolveAuthoritativeOrgPlan(sb, String(orgId));

      const grantedFeatures: string[] =
        Array.isArray(plan?.features) && plan.features.length > 0
          ? plan.features
          : Array.isArray(orgSettings?.planFeatures)
            ? orgSettings.planFeatures
            : ['statement_import'];

      const normalizedGranted = grantedFeatures.map(normalizeFeatureKey);

      const allowed = normalizedRequired.some(reqKey => normalizedGranted.includes(reqKey));
      if (!allowed) {
        return fail(
          res,
          403,
          `PLAN_FEATURE_RESTRICTED: Access to ${featureKeys.join(' or ')} is restricted. Your organization's ${plan?.name || 'current'} plan does not include this feature. Upgrade in Settings → Billing to unlock it.`,
        );
      }

      return next();
    } catch (err: any) {
      console.warn('[PlanEntitlement] Error checking feature entitlement:', err.message);
      return next();
    }
  };
}

export function requirePlanFeature(featureKey: string) {
  return requireAnyPlanFeature(featureKey);
}
