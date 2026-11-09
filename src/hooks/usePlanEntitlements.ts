import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { platformService, type PlatformPlan } from '@/services/platformService';
import { billingService, type BillingSummary, type SubscriptionInfo } from '@/services/billingService';
import {
  isViewAllowedByPlanFeatures,
  normalizeFeatureKey,
  getRequiredFeatureForView,
  type PlanFeatureDefinition,
} from '@/config/planFeatures';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

export interface UsePlanEntitlementsResult {
  currentPlan: PlatformPlan | null;
  allowedFeatures: string[];
  isLoading: boolean;
  hasPlanFeature: (featureKey: string) => boolean;
  isViewAllowedByPlan: (viewId: string) => boolean;
  getRequiredFeature: (viewId: string) => PlanFeatureDefinition | undefined;
  plans: PlatformPlan[];
  refreshPlanEntitlements: () => Promise<void>;
  billingSummary: BillingSummary | null;
  subscription: SubscriptionInfo | null;
}

export function usePlanEntitlements(): UsePlanEntitlementsResult {
  const { currentOrganization } = useAuth();
  const { featureFlags } = usePlatformSettings();
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load plans catalogue and authoritative subscription summary
  const loadEntitlements = useCallback(async () => {
    try {
      const orgId = currentOrganization?.id;
      const [plansRes, summaryRes] = await Promise.all([
        platformService.getPlans(),
        orgId ? billingService.getBillingSummary(orgId) : Promise.resolve(null),
      ]);
      if (plansRes.success && plansRes.data) {
        setPlans(plansRes.data);
      }
      if (summaryRes && summaryRes.success && summaryRes.data) {
        setBillingSummary(summaryRes.data);
      }
    } catch (err) {
      console.warn('[usePlanEntitlements] Error loading entitlements:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    loadEntitlements();
  }, [loadEntitlements]);

  // Resolve current plan (prioritize live authoritative subscription)
  const currentPlan = useMemo<PlatformPlan | null>(() => {
    if (billingSummary?.currentPlan) {
      return billingSummary.currentPlan;
    }

    if (!currentOrganization) return null;
    const planSlug = currentOrganization.settings?.plan || 'basic';
    const planId = currentOrganization.settings?.planId;

    const matched = plans.find((p) => p.id === planId || p.slug === planSlug || p.name.toLowerCase() === planSlug.toLowerCase());
    if (matched) return matched;

    // Fallback based on slug if plans not yet loaded
    if (planSlug === 'professional') {
      return {
        id: 'plan-professional',
        slug: 'professional',
        name: 'Professional',
        price: 49900,
        currency: 'PKR',
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
        limits: { users: 10, statements: 500, currencies: 5, storage: 10240 },
        active: true,
      };
    }
    if (planSlug === 'enterprise') {
      return {
        id: 'plan-enterprise',
        slug: 'enterprise',
        name: 'Enterprise',
        price: 99900,
        currency: 'PKR',
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
        limits: { users: 50, statements: 2000, currencies: 10, storage: 51200 },
        active: true,
      };
    }

    // Default Basic
    return {
      id: 'plan-basic',
      slug: 'basic',
      name: 'Basic',
      price: 0,
      currency: 'PKR',
      features: ['statement_import'],
      limits: { users: 5, statements: 100, currencies: 2, storage: 2048 },
      active: true,
    };
  }, [billingSummary, currentOrganization, plans]);

  // Resolve granted features
  const allowedFeatures = useMemo<string[]>(() => {
    // 1. Authoritative subscription features from billing summary
    if (billingSummary?.organization?.planFeatures && Array.isArray(billingSummary.organization.planFeatures) && billingSummary.organization.planFeatures.length > 0) {
      return billingSummary.organization.planFeatures;
    }
    if (billingSummary?.currentPlan?.features && Array.isArray(billingSummary.currentPlan.features) && billingSummary.currentPlan.features.length > 0) {
      return billingSummary.currentPlan.features;
    }
    // 2. Direct org overrides in settings.planFeatures
    if (Array.isArray(currentOrganization?.settings?.planFeatures) && currentOrganization.settings.planFeatures.length > 0) {
      return currentOrganization.settings.planFeatures;
    }
    // 3. Otherwise features defined on currentPlan
    if (currentPlan && Array.isArray(currentPlan.features)) {
      return currentPlan.features;
    }
    return ['statement_import'];
  }, [billingSummary, currentOrganization, currentPlan]);

  // Check if a specific feature key is permitted (respecting both Plan Entitlements & Global Platform Feature Flags)
  const hasPlanFeature = useCallback(
    (featureKey: string): boolean => {
      const normalized = normalizeFeatureKey(featureKey);
      if (normalized === 'simulator' && !featureFlags.advanced_what_if_simulations) {
        return false;
      }
      if (normalized === 'api_access' && !featureFlags.api_access_beta) {
        return false;
      }
      if (normalized === 'white_label' && !featureFlags.white_label_mode) {
        return false;
      }
      const normalizedAllowed = allowedFeatures.map(normalizeFeatureKey);
      return normalizedAllowed.includes(normalized);
    },
    [allowedFeatures, featureFlags]
  );

  // Check if a workspace view is allowed
  const isViewAllowedByPlan = useCallback(
    (viewId: string): boolean => {
      if ((viewId === 'simulator' || viewId === 'what-if-simulator') && !featureFlags.advanced_what_if_simulations) {
        return false;
      }
      return isViewAllowedByPlanFeatures(viewId, allowedFeatures);
    },
    [allowedFeatures, featureFlags]
  );

  return {
    currentPlan,
    allowedFeatures,
    isLoading,
    hasPlanFeature,
    isViewAllowedByPlan,
    getRequiredFeature: getRequiredFeatureForView,
    plans,
    refreshPlanEntitlements: loadEntitlements,
    billingSummary,
    subscription: billingSummary?.subscription || null,
  };
}
