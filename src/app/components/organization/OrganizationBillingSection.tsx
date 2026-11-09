import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useAuth } from '@/contexts/AuthContext';
import { billingService, type BillingSummary, type BillingInvoice } from '@/services/billingService';
import type { PlatformPlan } from '@/services/platformService';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import { calculateSubscriptionCycle } from '@/utils/subscriptionCycle';
import {
  CreditCard,
  Check,
  Star,
  Download,
  AlertCircle,
  ExternalLink,
  Shield,
  Zap,
  Sparkles,
  Lock,
  Loader2,
  CheckCircle2,
  Clock,
  Calendar,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

export function OrganizationBillingSection() {
  const { currentOrganization, applyOrganizationUpdate } = useAuth();
  const { currentPlan, refreshPlanEntitlements } = usePlanEntitlements();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  // Sandbox Test Checkout Modal state
  const [sandboxModalPlan, setSandboxModalPlan] = useState<PlatformPlan | null>(null);
  const [sandboxSessionId, setSandboxSessionId] = useState<string | null>(null);
  const [isProcessingSandboxPay, setIsProcessingSandboxPay] = useState<boolean>(false);

  const orgId = currentOrganization?.id;

  const loadBillingSummary = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await billingService.getBillingSummary(orgId);
      if (res.success && res.data) {
        setSummary(res.data);
      }
    } catch (err) {
      console.warn('[OrganizationBillingSection] Error fetching summary:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadBillingSummary();
  }, [loadBillingSummary]);

  // Handle return from Stripe Checkout (e.g. ?session_id=cs_...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId && orgId) {
      const verifySession = async () => {
        try {
          const res = await billingService.verifyCheckoutSession(orgId, sessionId);
          if (res.success && res.data) {
            toast.success(res.data.message || 'Subscription successfully updated!');
            await refreshPlanEntitlements();
            await loadBillingSummary();
            // Clean up query param
            window.history.replaceState({}, '', window.location.pathname + '?view=settings&tab=billing');
          }
        } catch (err: any) {
          toast.error(err.message || 'Could not verify checkout session');
        }
      };
      verifySession();
    }
  }, [orgId, loadBillingSummary, refreshPlanEntitlements]);

  // Initiate Upgrade / Switch Plan
  const handleUpgradePlan = async (targetPlan: PlatformPlan) => {
    if (!orgId) return;
    setCheckoutLoading(targetPlan.id);

    try {
      const res = await billingService.createCheckoutSession(orgId, targetPlan.id, targetPlan.slug);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to initiate checkout session');
      }

      const checkoutData = res.data;

      // If Stripe test mode returned a real hosted checkout URL, redirect
      if (checkoutData.mode === 'stripe_hosted' && checkoutData.checkoutUrl.startsWith('http')) {
        window.location.href = checkoutData.checkoutUrl;
        return;
      }

      // Built-in Sandbox Simulator Modal
      setSandboxModalPlan(targetPlan);
      setSandboxSessionId(checkoutData.sessionId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate upgrade');
    } finally {
      setCheckoutLoading(null);
    }
  };

  // Complete Sandbox Payment
  const handleCompleteSandboxPayment = async () => {
    if (!orgId || !sandboxSessionId || !sandboxModalPlan) return;
    setIsProcessingSandboxPay(true);

    try {
      const res = await billingService.verifyCheckoutSession(orgId, sandboxSessionId);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to verify sandbox payment');
      }

      toast.success(`Upgraded to ${sandboxModalPlan.name} Plan! Features are now unlocked.`);
      setSandboxModalPlan(null);
      setSandboxSessionId(null);

      // Refresh application state
      if (currentOrganization) {
        applyOrganizationUpdate({
          ...currentOrganization,
          settings: {
            ...currentOrganization.settings,
            plan: sandboxModalPlan.slug || sandboxModalPlan.name.toLowerCase(),
            planId: sandboxModalPlan.id,
            planName: sandboxModalPlan.name,
            planFeatures: sandboxModalPlan.features,
          },
        });
      }

      await refreshPlanEntitlements();
      await loadBillingSummary();
    } catch (err: any) {
      toast.error(err.message || 'Payment processing failed');
    } finally {
      setIsProcessingSandboxPay(false);
    }
  };

  const activePlan = summary?.currentPlan || currentPlan;
  const usage = summary?.usage;
  const availablePlans = summary?.availablePlans || [];
  const invoices = summary?.invoices || [];
  const subscription = summary?.subscription;

  const cycle = useMemo(() => {
    return calculateSubscriptionCycle(subscription, activePlan?.price, activePlan?.slug);
  }, [subscription, activePlan?.price, activePlan?.slug]);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="size-8 text-cyan-400 animate-spin" />
        <span className="ml-3 text-slate-400 font-mono">Loading billing & subscription details...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Active Subscription Header Card ─────────────────────────────────── */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: AXIOM.backgrounds.chartContainer,
          border: AXIOM.borders.cyan,
          boxShadow: AXIOM.shadows.cyan,
        }}
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono uppercase text-cyan-400 tracking-wider">CURRENT SUBSCRIPTION</span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="size-3" /> Active
              </span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                Stripe Sandbox
              </span>
            </div>
            <h2 className="text-3xl font-bold text-white flex items-baseline gap-2">
              {activePlan?.name || 'Basic'} Plan
              <span className="text-lg font-mono text-slate-400 font-normal">
                {activePlan?.price === 0 ? '— Free Tier' : `— Rs ${Number(activePlan?.price || 0).toLocaleString()} / month`}
              </span>
            </h2>
            <p className="text-sm text-slate-400 font-mono">
              Access to {activePlan?.features?.length || 1} enterprise features with dedicated sandbox billing.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className="text-xs text-slate-400 font-mono">Next billing cycle</p>
              <p className="text-sm font-mono text-white font-medium flex items-center justify-end gap-1.5">
                <Clock className="size-3.5 text-cyan-400" />
                <span>{cycle.nextBillingText}</span>
              </p>
              {cycle.hasActiveSubscription && (
                <div className="mt-1 flex items-center justify-end gap-2 text-[11px] font-mono">
                  <span className="text-slate-400">Day {cycle.daysPassed} of {cycle.totalCycleDays}</span>
                  <span className="text-slate-600">•</span>
                  <span className={cycle.isExpiringSoon ? 'text-amber-400 font-semibold' : 'text-cyan-400 font-semibold'}>
                    {cycle.daysRemaining} {cycle.daysRemaining === 1 ? 'day' : 'days'} remaining
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Subscription Cycle & Term Metadata */}
        {cycle.hasActiveSubscription && (
          <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <Calendar className="size-3.5 text-cyan-400" />
              <span>
                Term: <strong className="text-white">{cycle.startDateFormatted}</strong> to <strong className="text-cyan-400">{cycle.renewalDateFormatted}</strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>Billing Cycle: <strong className="text-white">Monthly ({cycle.totalCycleDays} Days)</strong></span>
              <span className="text-slate-600">|</span>
              <span>Remaining: <strong className="text-emerald-400">{cycle.daysRemaining} Days</strong></span>
              <span className="text-slate-600">|</span>
              <span>Elapsed: <strong className="text-slate-300">{Math.round(cycle.progressPercent)}%</strong></span>
            </div>
          </div>
        )}

        {/* Live Usage Progress Meters */}
        {usage && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-400">Team Seats</span>
                <span className="text-white font-medium">{usage.usersUsed} / {usage.users}</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 rounded-full"
                  style={{ width: `${Math.min(100, (usage.usersUsed / usage.users) * 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-400">Statements / Mo</span>
                <span className="text-white font-medium">{usage.statementsUsed} / {usage.statements}</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 rounded-full"
                  style={{ width: `${Math.min(100, (usage.statementsUsed / usage.statements) * 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-400">Currencies</span>
                <span className="text-white font-medium">{usage.currenciesUsed} / {usage.currencies}</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-400 rounded-full"
                  style={{ width: `${Math.min(100, (usage.currenciesUsed / usage.currencies) * 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-400">Storage</span>
                <span className="text-white font-medium">{usage.storageUsed} / {usage.storage} MB</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full"
                  style={{ width: `${Math.min(100, (usage.storageUsed / usage.storage) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Plans Upgrade / Comparison Grid ─────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Subscription Plans & Feature Tiers</h3>
          <p className="text-sm text-slate-400 font-mono">
            Upgrade your plan using Stripe Sandbox to instantly unlock advanced intelligence, costing, and simulation tools.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {availablePlans.map((plan) => {
            const isCurrent =
              activePlan?.id === plan.id ||
              activePlan?.slug === plan.slug ||
              (activePlan?.name && plan.name && activePlan.name.toLowerCase() === plan.name.toLowerCase());

            const isPopular = plan.is_popular || plan.name === 'Professional';
            const isProcessing = checkoutLoading === plan.id;

            return (
              <div
                key={plan.id || plan.slug}
                className={`rounded-2xl p-6 relative flex flex-col justify-between transition-all ${
                  isCurrent
                    ? 'border-2 border-cyan-400 bg-cyan-950/20 shadow-lg shadow-cyan-500/10'
                    : isPopular
                    ? 'border-2 border-blue-500/40 bg-white/[0.02]'
                    : 'border border-white/10 bg-white/[0.02]'
                }`}
              >
                {/* Popular or Current Badge */}
                {isCurrent ? (
                  <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
                    <Check className="size-3" /> Current Plan
                  </div>
                ) : isPopular ? (
                  <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono bg-blue-500/20 text-blue-400 border border-blue-500/40">
                    <Star className="size-3" /> Popular
                  </div>
                ) : null}

                <div>
                  <h4 className="text-xl font-bold text-white mb-1">{plan.name}</h4>
                  <p className="text-xs text-slate-400 font-mono mb-4 line-clamp-2">
                    {plan.description || `${plan.name} financial management tier`}
                  </p>

                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">
                      {plan.price === 0 ? 'Free' : `Rs ${Number(plan.price).toLocaleString()}`}
                    </span>
                    {plan.price > 0 && <span className="text-xs text-slate-400 font-mono"> /month</span>}
                  </div>

                  {/* Limits summary */}
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1.5 mb-6 text-xs font-mono">
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-400">Team Seats</span>
                      <span>{plan.limits?.users ?? 5}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-400">Statements/mo</span>
                      <span>{plan.limits?.statements ?? 100}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-400">Currencies</span>
                      <span>{plan.limits?.currencies ?? 2}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-400">Storage</span>
                      <span>{plan.limits?.storage ?? 2048} MB</span>
                    </div>
                  </div>

                  {/* Features list */}
                  <div className="space-y-2 mb-6">
                    <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">FEATURES INCLUDED</p>
                    {(plan.features || []).map((feat, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Check className="size-3.5 text-cyan-400 shrink-0" />
                        <span className="text-xs text-slate-300 capitalize font-mono">
                          {feat.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-2.5 rounded-xl font-mono text-sm bg-white/5 text-slate-400 border border-white/10 cursor-default flex items-center justify-center gap-2"
                    >
                      <Check className="size-4" /> Active Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpgradePlan(plan)}
                      disabled={Boolean(checkoutLoading)}
                      className="w-full py-2.5 rounded-xl font-mono text-sm font-medium text-white transition-all shadow-md hover:brightness-110 active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      style={AXIOM.buttons.action}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span>Preparing Checkout...</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className="size-4" />
                          <span>{plan.price === 0 ? 'Downgrade to Free' : 'Upgrade with Stripe'}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Billing & Invoices History Table ─────────────────────────────────── */}
      <div className="space-y-4 pt-4">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Billing & Invoices History</h3>
          <p className="text-sm text-slate-400 font-mono">
            Authoritative statement records and Stripe sandbox receipts
          </p>
        </div>

        <div
          className="rounded-2xl overflow-hidden border border-white/10"
          style={{ background: AXIOM.backgrounds.chartContainer }}
        >
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-slate-400 font-mono text-sm">
              No previous invoices recorded yet. Invoices appear automatically upon subscription checkout.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-white/5 text-slate-400 uppercase tracking-wider border-b border-white/10">
                  <tr>
                    <th className="p-4">Invoice #</th>
                    <th className="p-4">Plan</th>
                    <th className="p-4">Date</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 font-medium text-white">{inv.invoice_number}</td>
                      <td className="p-4">{inv.plan_name || 'Finance OS Subscription'}</td>
                      <td className="p-4 text-slate-400">
                        {new Date(inv.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="p-4 font-bold text-white">
                        {inv.currency} {Number(inv.amount).toLocaleString()}
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => toast.info(`Receipt for ${inv.invoice_number} is stored in audit records.`)}
                          className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-cyan-400 border border-white/10 transition-colors inline-flex items-center gap-1.5"
                        >
                          <Download className="size-3" /> Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Stripe Sandbox Test Payment Modal ───────────────────────────────── */}
      <AnimatePresence>
        {sandboxModalPlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6"
              style={{
                background: '#0d111c',
                border: AXIOM.borders.cyan,
                boxShadow: AXIOM.shadows.cyan,
              }}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="size-9 rounded-xl flex items-center justify-center bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    <CreditCard className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Stripe Sandbox Checkout</h3>
                    <p className="text-xs text-slate-400 font-mono">Test Mode Payment Simulator</p>
                  </div>
                </div>
                <button
                  onClick={() => setSandboxModalPlan(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Order Summary */}
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2 text-xs font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Selected Tier:</span>
                  <span className="text-white font-medium">{sandboxModalPlan.name} Plan</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Amount to bill:</span>
                  <span className="text-cyan-400 font-bold text-sm">
                    {sandboxModalPlan.currency || 'PKR'} {Number(sandboxModalPlan.price).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Billing Interval:</span>
                  <span className="text-slate-300">Monthly</span>
                </div>
              </div>

              {/* Stripe Test Card Info */}
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-xs font-mono space-y-2">
                  <div className="flex items-center gap-2 text-cyan-300 font-medium">
                    <Sparkles className="size-4" />
                    <span>Official Stripe Sandbox Test Card</span>
                  </div>
                  <div className="space-y-1 text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Card Number:</span>
                      <span className="font-bold tracking-wider text-white">4242 •••• •••• 4242</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Exp / CVC:</span>
                      <span>12/28 • 123</span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  This simulates official Stripe subscription payment. Upon confirmation, your organization's plan will update immediately and unlock all {sandboxModalPlan.features?.length} features.
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSandboxModalPlan(null)}
                  disabled={isProcessingSandboxPay}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-mono text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCompleteSandboxPayment}
                  disabled={isProcessingSandboxPay}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-medium text-xs shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  style={AXIOM.buttons.action}
                >
                  {isProcessingSandboxPay ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Authorizing Payment...</span>
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5" />
                      <span>Confirm & Activate Plan</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
