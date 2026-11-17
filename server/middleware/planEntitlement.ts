import type { Request, Response, NextFunction } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { fail } from '../lib/http.js';
import { normalizeFeatureKey } from '../../src/config/planFeatures.js';
import { resolveAuthoritativeOrgPlan } from '../services/planEntitlementService.js';

export function requirePlanFeature(featureKey: string) {
  const normalizedRequired = normalizeFeatureKey(featureKey);

  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId =
      (req.params as any).organizationId ||
      (req.params as any).orgId ||
      (req.query as any).organizationId ||
      (req.body as any)?.organizationId;

    // If no org ID in route params or query, permit or skip (global routes)
    if (!orgId) {
      return next();
    }

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return next(); // Fail-open in dev if DB is offline
    }

    try {
      const { plan, orgSettings } = await resolveAuthoritativeOrgPlan(sb, String(orgId));

      // Prefer authoritative plan.features; fall back to orgSettings.planFeatures if present
      const grantedFeatures: string[] =
        Array.isArray(plan?.features) && plan.features.length > 0
          ? plan.features
          : Array.isArray(orgSettings?.planFeatures)
            ? orgSettings.planFeatures
            : ['statement_import'];

      const normalizedGranted = grantedFeatures.map(normalizeFeatureKey);

      if (!normalizedGranted.includes(normalizedRequired)) {
        return fail(
          res,
          403,
          `PLAN_FEATURE_RESTRICTED: Access to ${featureKey} is restricted. Your organization's ${plan?.name || 'current'} plan does not include this feature. Upgrade in Settings → Billing to unlock it.`,
        );
      }

      return next();
    } catch (err: any) {
      console.warn('[PlanEntitlement] Error checking feature entitlement:', err.message);
      return next();
    }
  };
}
