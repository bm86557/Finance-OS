import { env } from '../config/env.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

export interface PlanLimits {
  users: number;
  statements: number;
  currencies: number;
  storage: number; // in MB
  transactions?: number;
  ai_credits?: number;
  audit_retention?: number;
  [key: string]: any;
}

export interface PlatformPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billing_interval: 'month' | 'year';
  features: string[];
  limits: PlanLimits;
  is_popular: boolean;
  active: boolean;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationSubscription {
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
  created_at?: string;
  updated_at?: string;
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

/**
 * Helper to call Stripe REST API directly using standard fetch
 */
async function callStripeApi(endpoint: string, method = 'POST', bodyParams?: Record<string, string>): Promise<any> {
  if (!env.stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured on server.');
  }

  const url = `https://api.stripe.com/v1/${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  let body: string | undefined;
  if (bodyParams && method !== 'GET') {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(bodyParams)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, value);
      }
    }
    body = searchParams.toString();
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  const json = await res.json();
  if (!res.ok) {
    const message = json?.error?.message || `Stripe API error (${res.status})`;
    throw new Error(message);
  }

  return json;
}

export class StripeService {
  /**
   * Syncs a platform plan with Stripe (creates/updates Product and Price)
   */
  async syncPlanWithStripe(plan: PlatformPlan): Promise<{ productId: string; priceId: string } | null> {
    if (!env.stripeSecretKey) {
      // In simulator sandbox mode, generate deterministic mock IDs
      return {
        productId: `prod_sandbox_${plan.slug}`,
        priceId: `price_sandbox_${plan.slug}_${plan.price}`,
      };
    }

    try {
      // 1. Create or retrieve Product
      let productId = plan.stripe_product_id;
      if (!productId) {
        const prod = await callStripeApi('products', 'POST', {
          name: `Finance OS ${plan.name} Plan`,
          description: plan.description || `Finance OS subscription tier: ${plan.name}`,
          'metadata[plan_slug]': plan.slug,
          'metadata[plan_id]': plan.id,
        });
        productId = prod.id;
      }

      // 2. Create Price in cents (or unit currency)
      // Note: Stripe currency must be lowercase, e.g. pkr, usd
      const currency = (plan.currency || 'PKR').toLowerCase();
      const unitAmount = Math.round(Number(plan.price) * 100);

      const price = await callStripeApi('prices', 'POST', {
        product: productId!,
        unit_amount: unitAmount.toString(),
        currency: currency,
        'recurring[interval]': plan.billing_interval || 'month',
        'metadata[plan_id]': plan.id,
        'metadata[plan_slug]': plan.slug,
      });

      return {
        productId: productId!,
        priceId: price.id,
      };
    } catch (err: any) {
      console.warn('[StripeService] syncPlanWithStripe error (falling back to sandbox IDs):', err.message);
      return {
        productId: `prod_sandbox_${plan.slug}`,
        priceId: `price_sandbox_${plan.slug}_${plan.price}`,
      };
    }
  }

  /**
   * Creates a checkout session (Stripe Hosted Checkout or Sandbox Simulator)
   */
  async createCheckoutSession(params: {
    orgId: string;
    orgName: string;
    plan: PlatformPlan;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  }): Promise<{
    sessionId: string;
    checkoutUrl: string;
    mode: 'stripe_hosted' | 'sandbox_simulator';
  }> {
    const { orgId, orgName, plan, successUrl, cancelUrl, customerEmail } = params;

    // Zero-dollar (free) plans don't need real Stripe payment
    if (Number(plan.price) <= 0) {
      const freeSessionId = `cs_free_${orgId}_${Date.now()}`;
      return {
        sessionId: freeSessionId,
        checkoutUrl: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id=${freeSessionId}`,
        mode: 'sandbox_simulator',
      };
    }

    // If Stripe Secret Key is available, create official Stripe Checkout Session
    if (env.stripeSecretKey) {
      try {
        const currency = (plan.currency || 'PKR').toLowerCase();
        const unitAmount = Math.round(Number(plan.price) * 100);

        const sessionPayload: Record<string, string> = {
          mode: 'subscription',
          success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: cancelUrl,
          'line_items[0][price_data][currency]': currency,
          'line_items[0][price_data][product_data][name]': `Finance OS ${plan.name} Plan`,
          'line_items[0][price_data][product_data][description]': plan.description || `${plan.name} Tier Subscription`,
          'line_items[0][price_data][unit_amount]': unitAmount.toString(),
          'line_items[0][price_data][recurring][interval]': plan.billing_interval || 'month',
          'line_items[0][quantity]': '1',
          'metadata[organization_id]': orgId,
          'metadata[organization_name]': orgName,
          'metadata[plan_id]': plan.id,
          'metadata[plan_slug]': plan.slug,
          'subscription_data[metadata][organization_id]': orgId,
          'subscription_data[metadata][plan_id]': plan.id,
        };

        if (customerEmail) {
          sessionPayload.customer_email = customerEmail;
        }

        const stripeSession = await callStripeApi('checkout/sessions', 'POST', sessionPayload);

        return {
          sessionId: stripeSession.id,
          checkoutUrl: stripeSession.url,
          mode: 'stripe_hosted',
        };
      } catch (err: any) {
        console.warn('[StripeService] Stripe API checkout failed, falling back to Sandbox Simulator:', err.message);
      }
    }

    // Built-in Sandbox Simulator Session
    const simSessionId = `cs_test_sandbox_${orgId}_${Date.now()}`;
    return {
      sessionId: simSessionId,
      checkoutUrl: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id=${simSessionId}&sandbox_sim=true`,
      mode: 'sandbox_simulator',
    };
  }

  /**
   * Verifies and fulfills a completed checkout session
   */
  async verifyAndFulfillSession(
    sessionId: string,
    organizationId: string
  ): Promise<{
    subscription: OrganizationSubscription;
    invoice: BillingInvoice;
    plan: PlatformPlan;
  }> {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      throw new Error('Supabase admin client not initialized.');
    }

    // 1. Fetch organization to get current settings
    const { data: org, error: orgErr } = await sb
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single();

    if (orgErr || !org) {
      throw new Error(`Organization ${organizationId} not found.`);
    }

    // 2. Identify target plan from session or query
    let targetPlanId: string | null = null;
    let targetPlanSlug: string | null = null;
    let stripeCustomerId: string | null = null;
    let stripeSubId: string | null = null;

    if (sessionId.startsWith('cs_free_') || sessionId.startsWith('cs_test_sandbox_')) {
      // In simulator mode, look at pending checkout metadata in org settings, or default to plan passed
      targetPlanId = org.settings?.pendingPlanId || org.settings?.planId || 'plan-professional';
      targetPlanSlug = org.settings?.pendingPlanSlug || org.settings?.plan || 'professional';
    } else if (env.stripeSecretKey) {
      try {
        const session = await callStripeApi(`checkout/sessions/${sessionId}`, 'GET');
        targetPlanId = session.metadata?.plan_id;
        targetPlanSlug = session.metadata?.plan_slug;
        stripeCustomerId = session.customer;
        stripeSubId = session.subscription;
      } catch (err: any) {
        console.warn('[StripeService] Could not retrieve session from Stripe API:', err.message);
      }
    }

    // 3. Load full target plan from public.platform_plans (or fallback)
    let plan: PlatformPlan | null = null;
    if (targetPlanId) {
      const { data: pData } = await sb
        .from('platform_plans')
        .select('*')
        .eq('id', targetPlanId)
        .single();
      if (pData) plan = pData as PlatformPlan;
    }

    if (!plan && targetPlanSlug) {
      const { data: pData } = await sb
        .from('platform_plans')
        .select('*')
        .eq('slug', targetPlanSlug)
        .single();
      if (pData) plan = pData as PlatformPlan;
    }

    if (!plan) {
      // Default fallback to Professional if not found
      plan = {
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
      };
    }

    // 4. Upsert organization subscription (Idempotent by organization_id)
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subId = `sub_${organizationId.replace(/-/g, '').slice(0, 16)}_${Date.now().toString(36)}`;
    const subscriptionPayload: Partial<OrganizationSubscription> = {
      id: subId,
      organization_id: organizationId,
      plan_id: plan.id,
      plan_slug: plan.slug,
      status: 'active',
      payment_provider: env.stripeSecretKey ? 'stripe' : 'stripe_sandbox',
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubId,
      stripe_checkout_session_id: sessionId,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: false,
    };

    const { data: existingSub } = await sb
      .from('organization_subscriptions')
      .select('*')
      .eq('organization_id', organizationId)
      .single();

    let subscription: OrganizationSubscription;
    if (existingSub) {
      const { data: updatedSub, error: updateErr } = await sb
        .from('organization_subscriptions')
        .update({
          plan_id: plan.id,
          plan_slug: plan.slug,
          status: 'active',
          payment_provider: subscriptionPayload.payment_provider,
          stripe_customer_id: stripeCustomerId || existingSub.stripe_customer_id,
          stripe_subscription_id: stripeSubId || existingSub.stripe_subscription_id,
          stripe_checkout_session_id: sessionId,
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
          updated_at: now.toISOString(),
        })
        .eq('id', existingSub.id)
        .select('*')
        .single();

      if (updateErr) throw new Error(`Failed to update subscription: ${updateErr.message}`);
      subscription = updatedSub as OrganizationSubscription;
    } else {
      const { data: newSub, error: insertErr } = await sb
        .from('organization_subscriptions')
        .insert(subscriptionPayload)
        .select('*')
        .single();

      if (insertErr) throw new Error(`Failed to insert subscription: ${insertErr.message}`);
      subscription = newSub as OrganizationSubscription;
    }

    // 5. Generate and record Billing Invoice
    const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const invoicePayload: Partial<BillingInvoice> = {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      organization_id: organizationId,
      subscription_id: subscription.id,
      plan_id: plan.id,
      plan_name: plan.name,
      invoice_number: invoiceNumber,
      amount: plan.price,
      currency: plan.currency || 'PKR',
      status: 'paid',
      stripe_invoice_id: `in_sim_${Date.now()}`,
      stripe_payment_intent_id: `pi_sim_${Date.now()}`,
      billing_reason: 'subscription_create',
      paid_at: now.toISOString(),
      created_at: now.toISOString(),
    };

    const { data: invoice, error: invErr } = await sb
      .from('billing_invoices')
      .insert(invoicePayload)
      .select('*')
      .single();

    if (invErr) {
      console.warn('[StripeService] Invoice recording note:', invErr.message);
    }

    // 6. Update Organization settings jsonb for real-time entitlement synchronization
    const currentSettings = org.settings || {};
    const updatedSettings = {
      ...currentSettings,
      plan: plan.slug,
      planId: plan.id,
      planName: plan.name,
      status: 'active',
      planFeatures: plan.features, // Authority list of granted features
      limits: {
        ...(currentSettings.limits || {}),
        users: plan.limits.users,
        statements: plan.limits.statements,
        currencies: plan.limits.currencies,
        storage: plan.limits.storage,
      },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        paymentProvider: subscription.payment_provider,
        planSlug: plan.slug,
        planName: plan.name,
      },
    };

    // Clean up temporary pending fields
    delete updatedSettings.pendingPlanId;
    delete updatedSettings.pendingPlanSlug;

    await sb
      .from('organizations')
      .update({
        settings: updatedSettings,
        updated_at: now.toISOString(),
      })
      .eq('id', organizationId);

    return {
      subscription,
      invoice: (invoice as BillingInvoice) || (invoicePayload as BillingInvoice),
      plan,
    };
  }

  /**
   * Generates a Customer Billing Portal session or simulation link
   */
  async createCustomerPortalSession(stripeCustomerId: string | null, returnUrl: string): Promise<string> {
    if (env.stripeSecretKey && stripeCustomerId) {
      try {
        const portal = await callStripeApi('billing_portal/sessions', 'POST', {
          customer: stripeCustomerId,
          return_url: returnUrl,
        });
        return portal.url;
      } catch (err: any) {
        console.warn('[StripeService] Customer Portal creation failed:', err.message);
      }
    }

    // Fallback URL for sandbox simulator
    return returnUrl;
  }
}

export const stripeService = new StripeService();

