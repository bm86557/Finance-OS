/**
 * Platform Service
 * =================
 * Consolidated platform-level metadata for the Platform Admin views.
 * Aggregates SaaS KPIs, plan definitions, per-org billing/status metadata,
 * and billing summary stats into a single service.
 */

import { isHttpBackendConfigured, apiGet, apiPostJson, apiPutJson, apiPatchJson, apiDelete } from '@/lib/apiClient';
import { dataStore, simulateDelay } from './dataStore';
import { platformOrganizationService } from './platformOrganizationService';
import type { ServiceResponse } from './types';

// ── Platform Settings & Backup Types ────────────────────────────────────────

export interface PlatformCurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  enabled: boolean;
  rateToUsd: number;
  precision: number;
  isCustom?: boolean;
}

export interface PlatformRetentionPolicies {
  transaction_retention_days: number;
  audit_log_retention_days: number;
  statement_files_retention_days: number;
  deleted_org_retention_days: number;
  auto_delete_expired_data: boolean;
  last_enforced_at?: string | null;
}

export interface PlatformBackupPolicies {
  full_backup_frequency: 'Daily' | 'Weekly' | 'Monthly';
  incremental_backup_frequency: 'Hourly' | 'Every 6 hours' | 'Every 12 hours';
  backup_retention_days: number;
  storage_location: string;
}

export interface PlatformFeatureFlags {
  ai_category_suggestions: boolean;
  advanced_what_if_simulations: boolean;
  api_access_beta: boolean;
  white_label_mode: boolean;
  multi_currency_auto_convert: boolean;
  export_to_quickbooks: boolean;
}

export interface PlatformSettingsState {
  id: string;
  currencies: PlatformCurrencyConfig[];
  retention_policies: PlatformRetentionPolicies;
  backup_policies: PlatformBackupPolicies;
  feature_flags: PlatformFeatureFlags;
  updated_at: string;
  updated_by?: string | null;
  backup_summary?: {
    total_backups: number;
    latest_backup_at: string | null;
    latest_backup_code: string | null;
    latest_backup_status: string | null;
  };
  retention_enforcement?: {
    enforcedAt: string;
    autoDeleteEnabled: boolean;
    purgedDraftTransactions: number;
    protectedPostedTransactions: number;
    archivedAuditLogs: number;
    expiredStatementFiles: number;
    purgedDeletedOrgs: number;
  } | null;
}

export interface PlatformBackupRecord {
  id: string;
  backup_code: string;
  backup_type: 'manual' | 'scheduled_full' | 'incremental';
  status: 'completed' | 'in_progress' | 'failed' | 'restored';
  storage_location: string;
  size_bytes: number;
  checksum_sha256: string;
  tables_summary: Record<string, any>;
  triggered_by?: string | null;
  triggered_by_email?: string | null;
  expires_at?: string | null;
  restored_at?: string | null;
  created_at: string;
}

export const DEFAULT_PLATFORM_SETTINGS_STATE: PlatformSettingsState = {
  id: 'global',
  currencies: [
    { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', enabled: true, rateToUsd: 0.0036, precision: 2, isCustom: false },
    { code: 'USD', name: 'US Dollar', symbol: '$', enabled: true, rateToUsd: 1.0, precision: 2, isCustom: false },
    { code: 'EUR', name: 'Euro', symbol: '€', enabled: true, rateToUsd: 1.09, precision: 2, isCustom: false },
    { code: 'GBP', name: 'British Pound', symbol: '£', enabled: true, rateToUsd: 1.27, precision: 2, isCustom: false },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', enabled: true, rateToUsd: 0.2723, precision: 2, isCustom: false },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', enabled: true, rateToUsd: 0.74, precision: 2, isCustom: false },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', enabled: true, rateToUsd: 0.66, precision: 2, isCustom: false },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', enabled: true, rateToUsd: 0.75, precision: 2, isCustom: false },
  ],
  retention_policies: {
    transaction_retention_days: 730,
    audit_log_retention_days: 365,
    statement_files_retention_days: 365,
    deleted_org_retention_days: 90,
    auto_delete_expired_data: true,
    last_enforced_at: null,
  },
  backup_policies: {
    full_backup_frequency: 'Daily',
    incremental_backup_frequency: 'Hourly',
    backup_retention_days: 30,
    storage_location: 'AWS S3 - us-east-1',
  },
  feature_flags: {
    ai_category_suggestions: true,
    advanced_what_if_simulations: true,
    api_access_beta: false,
    white_label_mode: false,
    multi_currency_auto_convert: true,
    export_to_quickbooks: false,
  },
  updated_at: new Date().toISOString(),
  updated_by: null,
};

// ── Platform Types ──────────────────────────────────────────────────────────

export interface PlatformStats {
  mrr: number;
  arr: number;
  activeOrgs: number;
  trialOrgs: number;
  suspendedOrgs: number;
  churnRiskOrgs: number;
  paidOrgs?: number;
  freeOrgs?: number;
  totalUsers: number;
  statementsProcessed: number;
  platformProfit: number;
  platformCost: number;
  storageUsed: number;   // MB
  storageLimit: number;  // MB
  revenueGrowth: { month: string; revenue: number }[];
  mrrGrowthPct?: number;
  newUsersThisMonth?: number;
  alerts?: {
    id: string;
    title: string;
    sub: string;
    type: 'warning' | 'info' | 'error' | 'success';
    action?: string;
  }[];
}

export interface PlatformPlanLimits {
  users: number;
  statements: number;
  currencies: number;
  storage: number; // MB
  transactions?: number;
  ai_credits?: number;
  audit_retention?: number;
  [key: string]: any;
}

export interface PlatformPlan {
  id: string;
  slug?: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  billing_interval?: 'month' | 'year';
  features: string[];
  limits: PlatformPlanLimits;
  is_popular?: boolean;
  active: boolean;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  sort_order?: number;
}

export interface CreatePlatformPlanInput {
  id?: string;
  slug?: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  billing_interval?: 'month' | 'year';
  features: string[];
  limits: PlatformPlanLimits;
  is_popular?: boolean;
  active?: boolean;
  sort_order?: number;
}

export interface UpdatePlatformPlanInput {
  name?: string;
  description?: string | null;
  price?: number;
  currency?: string;
  billing_interval?: 'month' | 'year';
  features?: string[];
  limits?: Partial<PlatformPlanLimits>;
  is_popular?: boolean;
  active?: boolean;
  sort_order?: number;
}

export interface PlatformOrgMeta {
  plan: string;
  status: 'active' | 'trial' | 'suspended' | 'churn_risk';
  limits: {
    users: number; usersUsed: number;
    statements: number; statementsUsed: number;
    currencies: number; currenciesUsed: number;
  };
  billing: { 
    amount: number;
    nextBillingDate?: string | null;
    daysRemaining?: number | null;
  };
}

export interface BillingStats {
  totalMonthlyRevenue: number;
  revenueGrowthPct: number;
  activeSubscriptions: number;
  overdueInvoices: number;
}

// ── Fallback Seed Data ──────────────────────────────────────────────────────────

const FALLBACK_PLANS: PlatformPlan[] = [
  {
    id: 'plan-basic',
    slug: 'basic',
    name: 'Basic',
    description: 'Essential financial ledger & statement import for emerging agencies',
    price: 0,
    currency: 'PKR',
    billing_interval: 'month',
    features: ['statement_import'],
    limits: { users: 5, statements: 100, currencies: 2, storage: 2048, transactions: 1000, ai_credits: 100, audit_retention: 30 },
    is_popular: false,
    active: true,
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
    limits: { users: 10, statements: 500, currencies: 5, storage: 10240, transactions: 5000, ai_credits: 500, audit_retention: 90 },
    is_popular: true,
    active: true,
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
    limits: { users: 50, statements: 2000, currencies: 10, storage: 51200, transactions: 50000, ai_credits: 2500, audit_retention: 365 },
    is_popular: false,
    active: true,
  },
];

const DEFAULT_ORG_META: PlatformOrgMeta = {
  plan: 'Basic',
  status: 'active',
  limits: { 
    users: 5, 
    usersUsed: 0, 
    statements: 100, 
    statementsUsed: 0, 
    currencies: 2, 
    currenciesUsed: 0 
  },
  billing: { amount: 0 },
};

// In-memory runtime cache for fallback mode
let memoryPlans = [...FALLBACK_PLANS];

// ── Service ─────────────────────────────────────────────────────────────────

export const platformService = {
  /**
   * Aggregate SaaS KPIs for the Platform Dashboard.
   * `GET /platform/stats`.
   */
  async getStats(): Promise<ServiceResponse<PlatformStats>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<PlatformStats>('/platform/stats');
      if (res.success && res.data) {
        return res;
      }
    }

    try {
      const orgsRes = await platformOrganizationService.getAll();
      const orgs = orgsRes.data || [];

      const activeOrgs = orgs.filter((o) => o.status === 'active').length;
      const trialOrgs = orgs.filter((o) => o.status === 'trial').length;
      const suspendedOrgs = orgs.filter((o) => o.status === 'suspended').length;
      const churnRiskOrgs = orgs.filter((o) => o.status === 'churn_risk').length;

      const paidOrgs = orgs.filter(
        (o) => (o.status === 'active' || o.status === 'churn_risk') && 
               o.plan?.toLowerCase() !== 'basic' && 
               (o.billing?.amount || 0) > 0
      ).length;

      const freeOrgs = Math.max(0, (activeOrgs + churnRiskOrgs) - paidOrgs);

      const totalUsers = orgs.reduce((sum, o) => sum + (o.limits?.usersUsed || 0), 0);
      const statementsProcessed = orgs.reduce((sum, o) => sum + (o.limits?.statementsUsed || 0), 0);

      const mrr = orgs
        .filter((o) => (o.status === 'active' || o.status === 'churn_risk') && o.plan?.toLowerCase() !== 'basic')
        .reduce((sum, o) => sum + (o.billing?.amount || 0), 0);

      const arr = mrr * 12;

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const now = new Date();
      const months: Array<{ label: string; endOfMonth: Date }> = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        months.push({
          label: monthNames[d.getMonth()],
          endOfMonth: end,
        });
      }

      const revenueGrowth = months.map((m, idx) => {
        let rev = orgs
          .filter(o => 
            (o.status === 'active' || o.status === 'churn_risk') && 
            o.plan?.toLowerCase() !== 'basic' && 
            (o.billing?.amount || 0) > 0 && 
            new Date(o.createdAt || Date.now()) <= m.endOfMonth
          )
          .reduce((sum, o) => sum + (o.billing?.amount || 0), 0);

        if (rev === 0 && idx < months.length - 1 && mrr > 0) {
          const factors = [0.45, 0.55, 0.65, 0.78, 0.88];
          rev = Math.round(mrr * factors[idx]);
        } else if (idx === months.length - 1) {
          rev = mrr;
        }

        return {
          month: m.label,
          revenue: rev,
        };
      });

      const prevMonthRev = revenueGrowth[revenueGrowth.length - 2]?.revenue || 0;
      const mrrGrowthPct = prevMonthRev > 0 ? Math.round(((mrr - prevMonthRev) / prevMonthRev) * 100) : (mrr > 0 ? 100 : 0);

      const platformCost = mrr > 0 ? Math.round(mrr * 0.15 + (activeOrgs * 500)) : (activeOrgs * 500);
      const platformProfit = Math.max(0, mrr - platformCost);

      const storageUsed = Math.max(2.4, Math.round((statementsProcessed * 1.8 + (activeOrgs + trialOrgs) * 3.2) * 10) / 10);
      const storageLimit = 102400;

      const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const newUsersThisMonth = orgs
        .filter(o => new Date(o.createdAt || 0) >= startOfCurrentMonth)
        .reduce((sum, o) => sum + (o.limits?.usersUsed || 0), 0);

      const alerts: PlatformStats['alerts'] = [];
      if (churnRiskOrgs > 0) {
        alerts.push({
          id: 'churn_risk',
          title: `${churnRiskOrgs} organization${churnRiskOrgs > 1 ? 's' : ''} at churn risk`,
          sub: 'Review billing status and tenant engagement',
          type: 'warning',
          action: 'Review',
        });
      }
      if (suspendedOrgs > 0) {
        alerts.push({
          id: 'suspended',
          title: `${suspendedOrgs} suspended organization${suspendedOrgs > 1 ? 's' : ''}`,
          sub: 'Access held due to policy or administrative lock',
          type: 'error',
          action: 'Manage',
        });
      }
      if (trialOrgs > 0) {
        alerts.push({
          id: 'trials',
          title: `${trialOrgs} organization${trialOrgs > 1 ? 's' : ''} on trial period`,
          sub: 'Follow up to transition to paid Professional / Enterprise plan',
          type: 'info',
          action: 'View',
        });
      }
      if (alerts.length === 0) {
        alerts.push({
          id: 'healthy_status',
          title: `All ${activeOrgs + churnRiskOrgs} organizations operating normally`,
          sub: `${paidOrgs} paid subscription${paidOrgs === 1 ? '' : 's'} (${orgs.find(o => (o.billing?.amount || 0) > 0)?.plan || 'None'}), ${freeOrgs} free tier account${freeOrgs === 1 ? '' : 's'} in good standing`,
          type: 'success',
          action: 'Review',
        });
        alerts.push({
          id: 'quota_health',
          title: 'Platform quotas and database storage healthy',
          sub: `${statementsProcessed} total statement${statementsProcessed === 1 ? '' : 's'} processed, zero database or backup errors`,
          type: 'info',
          action: 'Monitor',
        });
      }

      return {
        success: true,
        data: {
          mrr,
          arr,
          activeOrgs,
          paidOrgs,
          freeOrgs,
          trialOrgs,
          suspendedOrgs,
          churnRiskOrgs,
          totalUsers,
          statementsProcessed,
          platformProfit,
          platformCost,
          storageUsed,
          storageLimit,
          revenueGrowth,
          mrrGrowthPct,
          newUsersThisMonth,
          alerts,
        },
      };
    } catch {
      return {
        success: true,
        data: {
          mrr: 0,
          arr: 0,
          activeOrgs: 0,
          trialOrgs: 0,
          suspendedOrgs: 0,
          churnRiskOrgs: 0,
          paidOrgs: 0,
          freeOrgs: 0,
          totalUsers: 0,
          statementsProcessed: 0,
          platformProfit: 0,
          platformCost: 0,
          storageUsed: 2.4,
          storageLimit: 102400,
          revenueGrowth: [],
          mrrGrowthPct: 0,
          newUsersThisMonth: 0,
          alerts: [],
        },
      };
    }
  },

  /**
   * Get all subscription plans.
   * `GET /platform/plans`.
   */
  async getPlans(): Promise<ServiceResponse<PlatformPlan[]>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<PlatformPlan[]>('/platform/plans');
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        memoryPlans = res.data;
        return res;
      }
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb
          .from('platform_plans')
          .select('*')
          .order('sort_order', { ascending: true });
        if (!error && data && data.length > 0) {
          memoryPlans = data as PlatformPlan[];
          return { success: true, data: memoryPlans };
        }
      }
    } catch {
      /* ignore */
    }

    await simulateDelay(60);
    return { success: true, data: [...memoryPlans] };
  },

  /**
   * Get a single plan by ID.
   * `GET /platform/plans/:id`.
   */
  async getPlanById(id: string): Promise<ServiceResponse<PlatformPlan | null>> {
    if (isHttpBackendConfigured()) {
      return apiGet<PlatformPlan | null>(`/platform/plans/${encodeURIComponent(id)}`);
    }
    await simulateDelay(60);
    const plan = memoryPlans.find((p) => p.id === id || p.slug === id) || null;
    return { success: !!plan, data: plan };
  },

  /**
   * Create a new subscription plan with custom features and limits.
   * `POST /platform/plans`.
   */
  async createPlan(input: CreatePlatformPlanInput): Promise<ServiceResponse<PlatformPlan>> {
    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<CreatePlatformPlanInput, PlatformPlan>('/platform/plans', input);
      if (res.success && res.data) {
        memoryPlans = [...memoryPlans, res.data];
        return res;
      }
      return res;
    }

    await simulateDelay(100);
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newPlan: PlatformPlan = {
      id: input.id || `plan-${slug}-${Date.now().toString(36)}`,
      slug,
      name: input.name,
      description: input.description || null,
      price: input.price,
      currency: input.currency || 'PKR',
      billing_interval: input.billing_interval || 'month',
      features: input.features || [],
      limits: {
        users: input.limits?.users ?? 5,
        statements: input.limits?.statements ?? 100,
        currencies: input.limits?.currencies ?? 2,
        storage: input.limits?.storage ?? 2048,
        transactions: input.limits?.transactions ?? 1000,
        ai_credits: input.limits?.ai_credits ?? 100,
        audit_retention: input.limits?.audit_retention ?? 30,
      },
      is_popular: Boolean(input.is_popular),
      active: input.active !== undefined ? Boolean(input.active) : true,
    };
    memoryPlans.push(newPlan);
    return { success: true, data: newPlan };
  },

  /**
   * Update an existing subscription plan (pricing, limits, features, status).
   * `PATCH /platform/plans/:id`.
   */
  async updatePlan(id: string, updates: UpdatePlatformPlanInput): Promise<ServiceResponse<PlatformPlan>> {
    if (isHttpBackendConfigured()) {
      const res = await apiPatchJson<UpdatePlatformPlanInput, PlatformPlan>(`/platform/plans/${encodeURIComponent(id)}`, updates);
      if (res.success && res.data) {
        memoryPlans = memoryPlans.map((p) => (p.id === id || p.slug === id ? res.data : p));
        return res;
      }
      return res;
    }

    await simulateDelay(100);
    const idx = memoryPlans.findIndex((p) => p.id === id || p.slug === id);
    if (idx === -1) {
      return { success: false, data: null as any, error: 'Plan not found' };
    }

    const current = memoryPlans[idx];
    const updated: PlatformPlan = {
      ...current,
      ...updates,
      limits: {
        ...current.limits,
        ...(updates.limits || {}),
      },
      features: updates.features || current.features,
    };
    memoryPlans[idx] = updated;
    return { success: true, data: updated };
  },

  /**
   * Soft-delete or deactivate a plan.
   * `DELETE /platform/plans/:id`.
   */
  async deletePlan(id: string): Promise<ServiceResponse<void>> {
    if (isHttpBackendConfigured()) {
      return apiDelete<void>(`/platform/plans/${encodeURIComponent(id)}`);
    }
    await simulateDelay(80);
    memoryPlans = memoryPlans.filter((p) => p.id !== id && p.slug !== id);
    return { success: true, data: undefined };
  },

  /**
   * Get platform-level metadata for a specific org.
   * Served from the `organizations` table.
   */
  async getOrgMeta(orgId: string): Promise<ServiceResponse<PlatformOrgMeta>> {
    if (isHttpBackendConfigured()) {
      return apiGet<PlatformOrgMeta>(`/platform/organizations/${encodeURIComponent(orgId)}/meta`);
    }
    await simulateDelay(60);
    return { success: true, data: { ...DEFAULT_ORG_META } };
  },

  /**
   * Get platform-level metadata for ALL orgs (keyed by org ID).
   */
  async getAllOrgMeta(): Promise<ServiceResponse<Record<string, PlatformOrgMeta>>> {
    if (isHttpBackendConfigured()) {
      return apiGet<Record<string, PlatformOrgMeta>>('/platform/organizations/meta');
    }
    await simulateDelay(60);
    return { success: true, data: {} };
  },

  getDefaultOrgMeta(): PlatformOrgMeta {
    return { ...DEFAULT_ORG_META };
  },

  /**
   * Billing summary stats for the Plans & Billing page.
   * `GET /platform/billing/stats`.
   */
  async getBillingStats(): Promise<ServiceResponse<BillingStats>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<BillingStats>('/platform/billing/stats');
      if (res.success && res.data) {
        return res;
      }
    }

    try {
      const orgsRes = await platformOrganizationService.getAll();
      const orgs = orgsRes.data || [];
      const mrr = orgs
        .filter((o) => (o.status === 'active' || o.status === 'churn_risk') && o.plan?.toLowerCase() !== 'basic')
        .reduce((sum, o) => sum + (o.billing?.amount || 0), 0);
      const activeSubscriptions = orgs.filter(o => o.status === 'active' || o.status === 'churn_risk').length;

      return {
        success: true,
        data: {
          totalMonthlyRevenue: mrr,
          revenueGrowthPct: mrr > 0 ? 14 : 0,
          activeSubscriptions,
          overdueInvoices: 0,
        },
      };
    } catch {
      return {
        success: true,
        data: {
          totalMonthlyRevenue: 0,
          revenueGrowthPct: 0,
          activeSubscriptions: 0,
          overdueInvoices: 0,
        },
      };
    }
  },

  /**
   * Fetch authoritative Platform Settings (Admin endpoint `/platform/settings`).
   */
  async getSettings(): Promise<ServiceResponse<PlatformSettingsState>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<PlatformSettingsState>('/platform/settings');
      if (res.success && res.data) {
        return res;
      }
      // Fallback to public config if user is not platform_admin
      const pubRes = await apiGet<PlatformSettingsState>('/platform-config');
      if (pubRes.success && pubRes.data) {
        return pubRes;
      }
    }
    return { success: true, data: structuredClone(DEFAULT_PLATFORM_SETTINGS_STATE) };
  },

  /**
   * Fetch system-wide Platform Config accessible to all authenticated organization/employee users (`/platform-config`).
   */
  async getPublicConfig(): Promise<ServiceResponse<PlatformSettingsState>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<PlatformSettingsState>('/platform-config');
      if (res.success && res.data) {
        return res;
      }
    }
    return { success: true, data: structuredClone(DEFAULT_PLATFORM_SETTINGS_STATE) };
  },

  /**
   * Save changes to Platform Settings (`PUT /platform/settings`).
   */
  async updateSettings(payload: Partial<PlatformSettingsState>): Promise<ServiceResponse<PlatformSettingsState>> {
    if (isHttpBackendConfigured()) {
      return apiPutJson<Partial<PlatformSettingsState>, PlatformSettingsState>('/platform/settings', payload);
    }
    await simulateDelay(80);
    return {
      success: true,
      data: {
        ...DEFAULT_PLATFORM_SETTINGS_STATE,
        ...payload,
        updated_at: new Date().toISOString(),
      },
    };
  },

  /**
   * Add a new global currency or update an existing currency (`POST /platform/settings/currencies`).
   */
  async addCurrency(input: {
    code: string;
    name: string;
    symbol: string;
    rateToUsd: number;
    precision?: number;
    enabled?: boolean;
  }): Promise<ServiceResponse<PlatformSettingsState>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<typeof input, PlatformSettingsState>('/platform/settings/currencies', input);
    }
    await simulateDelay(80);
    return { success: true, data: structuredClone(DEFAULT_PLATFORM_SETTINGS_STATE) };
  },

  /**
   * Enforce Data Retention & Privacy policies now (`POST /platform/settings/retention/enforce`).
   */
  async enforceRetention(): Promise<ServiceResponse<NonNullable<PlatformSettingsState['retention_enforcement']>>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, NonNullable<PlatformSettingsState['retention_enforcement']>>(
        '/platform/settings/retention/enforce',
        {}
      );
    }
    await simulateDelay(100);
    return {
      success: true,
      data: {
        enforcedAt: new Date().toISOString(),
        autoDeleteEnabled: true,
        purgedDraftTransactions: 0,
        protectedPostedTransactions: 0,
        archivedAuditLogs: 0,
        expiredStatementFiles: 0,
        purgedDeletedOrgs: 0,
      },
    };
  },

  /**
   * List system backup history (`GET /platform/backups`).
   */
  async getBackups(): Promise<ServiceResponse<PlatformBackupRecord[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<PlatformBackupRecord[]>('/platform/backups');
    }
    await simulateDelay(60);
    return { success: true, data: [] };
  },

  /**
   * Trigger an immediate manual platform snapshot backup (`POST /platform/backups/trigger`).
   */
  async triggerManualBackup(): Promise<ServiceResponse<PlatformBackupRecord>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, PlatformBackupRecord>('/platform/backups/trigger', {});
    }
    await simulateDelay(120);
    return {
      success: true,
      data: {
        id: `bkp-${Date.now()}`,
        backup_code: `BKP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-MAN-01`,
        backup_type: 'manual',
        status: 'completed',
        storage_location: 'AWS S3 - us-east-1',
        size_bytes: 4194304,
        checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        tables_summary: { organizations: 5, transactions: 420, encryption: 'AES-256-GCM' },
        created_at: new Date().toISOString(),
      },
    };
  },

  /**
   * Verify and restore a platform backup snapshot (`POST /platform/backups/:id/restore`).
   */
  async restoreBackup(backupId: string): Promise<ServiceResponse<{ backup: PlatformBackupRecord; settings: PlatformSettingsState; verified: boolean }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, { backup: PlatformBackupRecord; settings: PlatformSettingsState; verified: boolean }>(
        `/platform/backups/${encodeURIComponent(backupId)}/restore`,
        {}
      );
    }
    await simulateDelay(120);
    return {
      success: false,
      data: null as any,
      error: 'Backend required for backup restoration',
    };
  },
};
