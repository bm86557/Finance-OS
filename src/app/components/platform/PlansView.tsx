import { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { platformService } from '@/services/platformService';
import type { PlatformPlan, BillingStats } from '@/services/platformService';
import { PlanFormModal } from './PlanFormModal';
import { Check, Plus, Edit, Star, DollarSign, CreditCard, AlertCircle, Loader2, Sparkles } from 'lucide-react';

export function PlansView() {
  const planColors = ['cyan', 'blue', 'purple', 'emerald', 'amber'];

  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [billingStats, setBillingStats] = useState<BillingStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlatformPlan | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, statsRes] = await Promise.all([
        platformService.getPlans(),
        platformService.getBillingStats(),
      ]);

      if (plansRes.success && plansRes.data) {
        setPlans(plansRes.data);
      }
      if (statsRes.success && statsRes.data) {
        setBillingStats(statsRes.data);
      }
    } catch (err) {
      console.warn('[PlansView] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreatePlan = () => {
    setEditingPlan(null);
    setIsModalOpen(true);
  };

  const handleEditPlan = (plan: PlatformPlan) => {
    setEditingPlan(plan);
    setIsModalOpen(true);
  };

  const handlePlanSaved = (savedPlan: PlatformPlan) => {
    setPlans((prev) => {
      const idx = prev.findIndex((p) => p.id === savedPlan.id || (p.slug && p.slug === savedPlan.slug));
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = savedPlan;
        return copy;
      }
      return [...prev, savedPlan];
    });
    loadData(); // also refresh backend stats
  };

  if (loading && plans.length === 0) {
    return (
      <div className="flex items-center justify-center p-20" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
        <Loader2 className="size-8 text-blue-400 animate-spin" />
        <span className="ml-3 text-slate-400 font-mono">Loading subscription plans...</span>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>Plans & Billing</h1>
          <p className="text-slate-400 font-mono">Manage subscription plans and pricing tiers</p>
        </div>
        <button
          onClick={handleCreatePlan}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-medium shadow-lg hover:brightness-110 transition-all active:scale-95 cursor-pointer"
          style={AXIOM.buttons.action}
        >
          <Plus className="size-5" />
          Create Plan
        </button>
      </motion.div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan, i) => {
          const color = planColors[i % planColors.length];
          const isPopular = plan.is_popular || plan.name === 'Professional';
          return (
            <motion.div
              key={plan.id || plan.slug || i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
              className="rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: isPopular
                  ? `2px solid ${AXIOM.charts.colors[color as keyof typeof AXIOM.charts.colors] || '#06b6d4'}`
                  : AXIOM.borders[color as keyof typeof AXIOM.borders] || AXIOM.borders.default,
                boxShadow: AXIOM.shadows[color as keyof typeof AXIOM.shadows] || 'none',
              }}
            >
              {/* Popular badge */}
              {isPopular && (
                <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono" style={AXIOM.badges.info}>
                  <Star className="size-3" />
                  Popular
                </div>
              )}

              {/* Corner glow */}
              <div
                className="absolute top-0 right-0 w-40 h-40 pointer-events-none"
                style={{
                  background: `radial-gradient(circle at 100% 0%, ${AXIOM.charts.colors[color as keyof typeof AXIOM.charts.colors] || '#06b6d4'}20, transparent 70%)`,
                }}
              />

              <div className="relative z-10 flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl text-white font-bold">{plan.name}</h3>
                  {plan.stripe_price_id && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Stripe Ready
                    </span>
                  )}
                </div>
                {plan.description && (
                  <p className="text-xs text-slate-400 font-mono mb-3 line-clamp-1">{plan.description}</p>
                )}

                <div className="mb-6">
                  <span className="text-4xl font-bold text-white">
                    {plan.price === 0 ? 'Free' : `Rs ${Number(plan.price).toLocaleString()}`}
                  </span>
                  {plan.price > 0 && <span className="text-sm text-slate-400 font-mono">/month</span>}
                </div>

                {/* Limits */}
                <div className="p-4 rounded-lg mb-6" style={AXIOM.containers.item}>
                  {[
                    { label: 'Users', value: plan.limits?.users ?? 5 },
                    { label: 'Statements/month', value: plan.limits?.statements ?? 100 },
                    { label: 'Currencies', value: plan.limits?.currencies ?? 2 },
                    { label: 'Storage', value: `${plan.limits?.storage ?? 2048} MB` },
                  ].map((limit) => (
                    <div key={limit.label} className="flex justify-between py-2" style={{ borderBottom: AXIOM.borders.default }}>
                      <span className="text-sm text-slate-400 font-mono">{limit.label}</span>
                      <span className="text-sm text-white font-mono font-medium">{limit.value}</span>
                    </div>
                  ))}
                </div>

                {/* Features Included */}
                <div className="mb-6 flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-slate-400 font-mono">FEATURES INCLUDED</p>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                      {plan.features?.length || 0} features
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(plan.features || []).map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div
                          className="size-5 rounded flex items-center justify-center shrink-0"
                          style={{
                            background: `${AXIOM.charts.colors[color as keyof typeof AXIOM.charts.colors] || '#06b6d4'}20`,
                          }}
                        >
                          <Check
                            className="size-3"
                            style={{ color: AXIOM.charts.colors[color as keyof typeof AXIOM.charts.colors] || '#06b6d4' }}
                          />
                        </div>
                        <span className="text-sm text-slate-300 capitalize font-mono text-left">
                          {feature.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2 pt-4 mt-auto">
                  <button
                    onClick={() => handleEditPlan(plan)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-mono hover:bg-white/5 transition-colors cursor-pointer"
                    style={AXIOM.buttons.outline}
                  >
                    <Edit className="size-4" />
                    Edit Plan
                  </button>
                  <div className="text-center">
                    <span
                      className="text-xs font-mono px-3 py-1 rounded inline-block"
                      style={plan.active ? AXIOM.badges.success : AXIOM.badges.warning}
                    >
                      {plan.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Billing Stats */}
      {billingStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              label: 'TOTAL MONTHLY REVENUE',
              value: `Rs ${billingStats.totalMonthlyRevenue.toLocaleString()}`,
              sub: `+${billingStats.revenueGrowthPct}% from last month`,
              icon: DollarSign,
              color: 'green',
            },
            {
              label: 'ACTIVE SUBSCRIPTIONS',
              value: `${billingStats.activeSubscriptions}`,
              sub: 'Across all plans',
              icon: CreditCard,
              color: 'blue',
            },
            {
              label: 'OVERDUE INVOICES',
              value: `${billingStats.overdueInvoices}`,
              sub: 'Requires attention',
              icon: AlertCircle,
              color: 'red',
            },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
              className="rounded-xl p-5"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: AXIOM.borders[item.color as keyof typeof AXIOM.borders],
                boxShadow: AXIOM.shadows[item.color as keyof typeof AXIOM.shadows],
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 font-mono mb-1">{item.label}</p>
                  <p className="text-2xl font-bold text-white">{item.value}</p>
                  <p
                    className="text-xs font-mono mt-1"
                    style={{
                      color: AXIOM.charts.colors[item.color as keyof typeof AXIOM.charts.colors] || '#94a3b8',
                    }}
                  >
                    {item.sub}
                  </p>
                </div>
                <div
                  className="size-10 rounded-lg flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes[item.color as keyof typeof AXIOM.iconBoxes],
                  }}
                >
                  <item.icon className="size-5 text-white" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create & Edit Plan Modal */}
      <PlanFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={handlePlanSaved}
        initialPlan={editingPlan}
      />
    </div>
  );
}
