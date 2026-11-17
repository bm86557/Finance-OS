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

const ENTITLEMENTS_CACHE_TTL_MS = 30_000;

let cachedPlans: { data: PlatformPlan[]; fetchedAt: number } | null = null;
let inFlightPlans: { reqId: number; promise: Promise<PlatformPlan[] | null> } | null = null;
let plansRequestSeq = 0;

const cachedBillingSummaries = new Map<string, { data: BillingSummary; fetchedAt: number }>();
const inFlightBillingSummaries = new Map<string, { reqId: number; promise: Promise<BillingSummary | null> }>();
let billingSummarySeq = 0;

function getPlansCached(force = false): Promise<PlatformPlan[] | null> {
  if (!force && cachedPlans && Date.now() - cachedPlans.fetchedAt < ENTITLEMENTS_CACHE_TTL_MS) {
    return Promise.resolve(cachedPlans.data);
  }
  if (!force && inFlightPlans) {
    return inFlightPlans.promise;
  }

  const reqId = ++plansRequestSeq;
  const promise = (async (): Promise<PlatformPlan[] | null> => {
    try {
      const res = await platformService.getPlans();
      if (res.success && res.data) {
        cachedPlans = { data: res.data, fetchedAt: Date.now() };
        return res.data;
      }
      return cachedPlans?.data ?? null;
    } catch {
      return cachedPlans?.data ?? null;
    } finally {
      if (inFlightPlans?.reqId === reqId) {
        inFlightPlans = null;
      }
    }
  })();

  inFlightPlans = { reqId, promise };
  return promise;
}

function getBillingSummaryCached(orgId: string, force = false): Promise<BillingSummary | null> {
  if (!orgId) return Promise.resolve(null);

  const existing = cachedBillingSummaries.get(orgId);
  if (!force && existing && Date.now() - existing.fetchedAt < ENTITLEMENTS_CACHE_TTL_MS) {
    return Promise.resolve(existing.data);
  }
  if (!force) {
    const inFlight = inFlightBillingSummaries.get(orgId);
    if (inFlight) return inFlight.promise;
  }

  const reqId = ++billingSummarySeq;
  const promise = (async (): Promise<BillingSummary | null> => {
    try {
      const res = await billingService.getBillingSummary(orgId);
      if (res.success && res.data) {
        cachedBillingSummaries.set(orgId, { data: res.data, fetchedAt: Date.now() });
        return res.data;
      }
      return existing?.data ?? null;
    } catch {
      return existing?.data ?? null;
    } finally {
      if (inFlightBillingSummaries.get(orgId)?.reqId === reqId) {
        inFlightBillingSummaries.delete(orgId);
      }
    }
  })();

  inFlightBillingSummaries.set(orgId, { reqId, promise });
  return promise;
}

export function usePlanEntitlements(): UsePlanEntitlementsResult {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';
  const { featureFlags } = usePlatformSettings();
  const [plans, setPlans] = useState<PlatformPlan[]>(() => cachedPlans?.data ?? []);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(() =>
    orgId ? (cachedBillingSummaries.get(orgId)?.data ?? null) : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !(cachedPlans && (!orgId || cachedBillingSummaries.has(orgId)))
  );

  // Load plans catalogue and authoritative subscription summary
  const loadEntitlements = useCallback(async (force = false) => {
    try {
      const [plansData, summaryData] = await Promise.all([
        getPlansCached(force),
        orgId ? getBillingSummaryCached(orgId, force) : Promise.resolve(null),
      ]);
      if (plansData) {
        setPlans(plansData);
      }
      setBillingSummary(summaryData);
    } catch (err) {
      console.warn('[usePlanEntitlements] Error loading entitlements:', err);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadEntitlements(false);
  }, [loadEntitlements]);

  const refreshPlanEntitlements = useCallback(() => loadEntitlements(true), [loadEntitlements]);

  // Resolve current plan (prioritize live authoritative subscription)
  const currentPlan = useMemo<PlatformPlan | null>(() => {
    if (billingSummary?.currentPlan) {
      return billingSummary.currentPlan;
    }

    if (!currentOrganization) return null;
    const planSlug = currentOrganization.settings?.plan || 'free';
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
    refreshPlanEntitlements,
    billingSummary,
    subscription: billingSummary?.subscription || null,
  };
}
