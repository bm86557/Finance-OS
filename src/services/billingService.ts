import { isHttpBackendConfigured, apiGet, apiPostJson } from '@/lib/apiClient';
import type { ServiceResponse } from './types';
import type { PlatformPlan } from './platformService';

export interface SubscriptionInfo {
  id: string;
  organization_id: string;
  plan_id: string;
  plan_slug: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  payment_provider: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

export interface BillingInvoice {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  plan_name: string | null;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'failed';
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  hosted_invoice_url: string | null;
  billing_reason: string;
  paid_at: string | null;
  created_at: string;
}

export interface BillingUsage {
  users: number;
  usersUsed: number;
  statements: number;
  statementsUsed: number;
  currencies: number;
  currenciesUsed: number;
  storage: number;
  storageUsed: number;
}

export interface BillingSummary {
  organization: {
    id: string;
    name: string;
    currency: string;
    plan: string;
    planFeatures: string[];
  };
  currentPlan: PlatformPlan;
  subscription: SubscriptionInfo | null;
  usage: BillingUsage;
  availablePlans: PlatformPlan[];
  invoices: BillingInvoice[];
  stripeConfig: {
    mode: 'stripe_test' | 'sandbox_simulator';
    publishableKey: string;
    isConfigured: boolean;
  };
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  mode: 'stripe_hosted' | 'sandbox_simulator';
  plan: PlatformPlan;
}

export const billingService = {
  /**
   * Retrieves billing summary, current subscription, usage vs limits, and active plans
   */
  async getBillingSummary(organizationId: string): Promise<ServiceResponse<BillingSummary>> {
    if (isHttpBackendConfigured()) {
      return apiGet<BillingSummary>(`/organizations/${encodeURIComponent(organizationId)}/billing/summary`);
    }

    // Offline / fallback mock summary
    const defaultPlan: PlatformPlan = {
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

    return {
      success: true,
      data: {
        organization: {
          id: organizationId,
          name: 'Current Organization',
          currency: 'PKR',
          plan: 'basic',
          planFeatures: ['statement_import'],
        },
        currentPlan: defaultPlan,
        subscription: null,
        usage: {
          users: 5,
          usersUsed: 1,
          statements: 100,
          statementsUsed: 3,
          currencies: 2,
          currenciesUsed: 1,
          storage: 2048,
          storageUsed: 64,
        },
        availablePlans: [defaultPlan],
        invoices: [],
        stripeConfig: {
          mode: 'sandbox_simulator',
          publishableKey: '',
          isConfigured: false,
        },
      },
    };
  },

  /** Alias for getBillingSummary */
  async getSummary(organizationId: string): Promise<ServiceResponse<BillingSummary>> {
    return this.getBillingSummary(organizationId);
  },


  /**
   * Initiates a Stripe Sandbox Checkout Session
   */
  async createCheckoutSession(
    organizationId: string,
    planId: string,
    planSlug?: string
  ): Promise<ServiceResponse<CheckoutSessionResult>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ planId: string; planSlug?: string }, CheckoutSessionResult>(
        `/organizations/${encodeURIComponent(organizationId)}/billing/checkout-session`,
        { planId, planSlug }
      );
    }

    const simSessionId = `cs_sim_${Date.now()}`;
    return {
      success: true,
      data: {
        sessionId: simSessionId,
        checkoutUrl: `/dashboard?view=settings&tab=billing&session_id=${simSessionId}`,
        mode: 'sandbox_simulator',
        plan: {
          id: planId,
          slug: planSlug || 'professional',
          name: 'Professional',
          price: 49900,
          currency: 'PKR',
          features: ['statement_import', 'profit_intelligence', 'costing_engine'],
          limits: { users: 10, statements: 500, currencies: 5, storage: 10240 },
          active: true,
        },
      },
    };
  },


  /**
   * Verifies and fulfills a completed checkout session
   */
  async verifyCheckoutSession(
    organizationId: string,
    sessionId: string
  ): Promise<ServiceResponse<{ success: boolean; message: string; plan: PlatformPlan }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ sessionId: string }, { success: boolean; message: string; plan: PlatformPlan }>(
        `/organizations/${encodeURIComponent(organizationId)}/billing/verify-session`,
        { sessionId }
      );
    }

    return {
      success: true,
      data: {
        success: true,
        message: 'Plan activated successfully',
        plan: {
          id: 'plan-professional',
          slug: 'professional',
          name: 'Professional',
          price: 49900,
          currency: 'PKR',
          features: ['statement_import', 'profit_intelligence', 'costing_engine'],
          limits: { users: 10, statements: 500, currencies: 5, storage: 10240 },
          active: true,
        },
      },
    };
  },


  /**
   * Cancels active subscription at period end
   */
  async cancelSubscription(organizationId: string): Promise<ServiceResponse<{ success: boolean; message: string }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, { success: boolean; message: string }>(
        `/organizations/${encodeURIComponent(organizationId)}/billing/cancel`,
        {}
      );
    }

    return {
      success: true,
      data: {
        success: true,
        message: 'Subscription set to cancel at end of billing cycle.',
      },
    };
  },

  /**
   * Fetches real invoices list
   */
  async getInvoices(organizationId: string): Promise<ServiceResponse<BillingInvoice[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<BillingInvoice[]>(`/organizations/${encodeURIComponent(organizationId)}/billing/invoices`);
    }
    return { success: true, data: [] };
  },
};

