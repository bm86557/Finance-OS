import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import {
  CANONICAL_PLAN_FEATURES,
  normalizeFeatureKey,
  type PlanFeatureDefinition,
} from '@/config/planFeatures';
import { platformService, type PlatformPlan, type CreatePlatformPlanInput, type UpdatePlatformPlanInput } from '@/services/platformService';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { X, Check, Plus, Trash2, Layers, DollarSign, Shield, Zap, Database, Loader2 } from 'lucide-react';

interface PlanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (savedPlan: PlatformPlan) => void;
  initialPlan?: PlatformPlan | null;
}

export function PlanFormModal({ isOpen, onClose, onSaved, initialPlan }: PlanFormModalProps) {
  const isEditing = Boolean(initialPlan && initialPlan.id);
  const { getSelectableCurrencyCodes } = usePlatformSettings();
  const selectableCurrencies = getSelectableCurrencyCodes(initialPlan?.currency || 'PKR');

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [currency, setCurrency] = useState('PKR');
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [isPopular, setIsPopular] = useState(false);
  const [active, setActive] = useState(true);

  // Limits
  const [usersLimit, setUsersLimit] = useState(5);
  const [statementsLimit, setStatementsLimit] = useState(100);
  const [currenciesLimit, setCurrenciesLimit] = useState(2);
  const [storageLimit, setStorageLimit] = useState(2048);
  const [transactionsLimit, setTransactionsLimit] = useState(1000);
  const [aiCreditsLimit, setAiCreditsLimit] = useState(100);

  // Selected features array
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [customFeatureInput, setCustomFeatureInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Populate initial values when modal opens
  useEffect(() => {
    if (initialPlan) {
      setName(initialPlan.name || '');
      setDescription(initialPlan.description || '');
      setPrice(initialPlan.price ?? 0);
      setCurrency(initialPlan.currency || 'PKR');
      setBillingInterval(initialPlan.billing_interval || 'month');
      setIsPopular(Boolean(initialPlan.is_popular));
      setActive(initialPlan.active !== false);

      setUsersLimit(initialPlan.limits?.users ?? 5);
      setStatementsLimit(initialPlan.limits?.statements ?? 100);
      setCurrenciesLimit(initialPlan.limits?.currencies ?? 2);
      setStorageLimit(initialPlan.limits?.storage ?? 2048);
      setTransactionsLimit(initialPlan.limits?.transactions ?? 1000);
      setAiCreditsLimit(initialPlan.limits?.ai_credits ?? 100);

      setSelectedFeatures(Array.isArray(initialPlan.features) ? [...initialPlan.features] : []);
    } else {
      // Defaults for Create mode
      setName('');
      setDescription('');
      setPrice(29900);
      setCurrency('PKR');
      setBillingInterval('month');
      setIsPopular(false);
      setActive(true);

      setUsersLimit(10);
      setStatementsLimit(300);
      setCurrenciesLimit(3);
      setStorageLimit(5120);
      setTransactionsLimit(2500);
      setAiCreditsLimit(250);

      setSelectedFeatures(['statement_import', 'personal_finance', 'profit_intelligence']);
    }
    setErrorMsg(null);
  }, [initialPlan, isOpen]);

  if (!isOpen) return null;

  const toggleFeature = (featureId: string) => {
    const normalized = normalizeFeatureKey(featureId);
    setSelectedFeatures((prev) => {
      const exists = prev.some((f) => normalizeFeatureKey(f) === normalized);
      if (exists) {
        return prev.filter((f) => normalizeFeatureKey(f) !== normalized);
      } else {
        return [...prev, featureId];
      }
    });
  };

  const isFeatureSelected = (featureId: string) => {
    const normalized = normalizeFeatureKey(featureId);
    return selectedFeatures.some((f) => normalizeFeatureKey(f) === normalized);
  };

  const handleAddCustomFeature = () => {
    const trimmed = customFeatureInput.trim();
    if (!trimmed) return;
    const key = normalizeFeatureKey(trimmed);
    if (!selectedFeatures.includes(key) && !selectedFeatures.includes(trimmed)) {
      setSelectedFeatures((prev) => [...prev, trimmed]);
    }
    setCustomFeatureInput('');
  };

  const handleSelectAll = () => {
    const allIds = CANONICAL_PLAN_FEATURES.map((f) => f.id);
    setSelectedFeatures(Array.from(new Set([...selectedFeatures, ...allIds])));
  };

  const handleClearAll = () => {
    setSelectedFeatures([]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Plan name is required.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    const limitsPayload = {
      users: Number(usersLimit) || 1,
      statements: Number(statementsLimit) || 10,
      currencies: Number(currenciesLimit) || 1,
      storage: Number(storageLimit) || 512,
      transactions: Number(transactionsLimit) || 500,
      ai_credits: Number(aiCreditsLimit) || 0,
    };

    try {
      if (isEditing && initialPlan?.id) {
        const updatePayload: UpdatePlatformPlanInput = {
          name: name.trim(),
          description: description.trim() || null,
          price: Number(price) || 0,
          currency,
          billing_interval: billingInterval,
          is_popular: isPopular,
          active,
          features: selectedFeatures,
          limits: limitsPayload,
        };

        const res = await platformService.updatePlan(initialPlan.id, updatePayload);
        if (!res.success || !res.data) {
          throw new Error(res.error || 'Failed to update plan');
        }
        onSaved(res.data);
      } else {
        const createPayload: CreatePlatformPlanInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          price: Number(price) || 0,
          currency,
          billing_interval: billingInterval,
          is_popular: isPopular,
          active,
          features: selectedFeatures,
          limits: limitsPayload,
        };

        const res = await platformService.createPlan(createPayload);
        if (!res.success || !res.data) {
          throw new Error(res.error || 'Failed to create plan');
        }
        onSaved(res.data);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while saving the plan.');
    } finally {
      setIsSaving(false);
    }
  };

  // Group features by category
  const categories: { key: PlanFeatureDefinition['category']; label: string }[] = [
    { key: 'core', label: 'Core Financials & Ledger' },
    { key: 'intelligence', label: 'AI & Profit Intelligence' },
    { key: 'operations', label: 'Operations & Costing' },
    { key: 'compliance', label: 'Compliance, Assets & Loans' },
    { key: 'enterprise', label: 'Enterprise & Integrations' },
  ];

  // Custom features added that are not in the canonical list
  const canonicalIds = new Set(CANONICAL_PLAN_FEATURES.map((f) => f.id));
  const customFeatures = selectedFeatures.filter(
    (f) => !canonicalIds.has(normalizeFeatureKey(f))
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-3xl my-8 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          style={{
            background: '#0d111c',
            border: AXIOM.borders.cyan,
            boxShadow: AXIOM.shadows.cyan,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl flex items-center justify-center bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Layers className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-wide">
                  {isEditing ? `Edit Plan: ${initialPlan?.name}` : 'Create Subscription Plan'}
                </h2>
                <p className="text-xs text-slate-400 font-mono">
                  Configure tier pricing, resource quotas, and allowed organization features
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors hover:bg-white/5"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-mono flex items-center gap-2">
                <span>{errorMsg}</span>
              </div>
            )}

            {/* General Info */}
            <div className="space-y-4">
              <h3 className="text-xs font-mono uppercase text-cyan-400 tracking-wider flex items-center gap-2">
                <DollarSign className="size-3.5" /> Plan Overview & Pricing
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1.5">Plan Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Growth, Professional, VIP"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-cyan-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1.5">Price & Currency *</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={price}
                      onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
                      placeholder="0"
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-cyan-400 transition-colors"
                    />
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-24 px-2 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-cyan-400"
                    >
                      {selectableCurrencies.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short summary of target audience and features"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-cyan-400 transition-colors"
                />
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPopular}
                    onChange={(e) => setIsPopular(e.target.checked)}
                    className="size-4 rounded accent-cyan-400 bg-white/5"
                  />
                  <span className="text-xs font-mono text-slate-300">Highlight as "Popular" Plan</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="size-4 rounded accent-cyan-400 bg-white/5"
                  />
                  <span className="text-xs font-mono text-slate-300">Active (available for organizations)</span>
                </label>
              </div>
            </div>

            {/* Quotas & Limits */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <h3 className="text-xs font-mono uppercase text-cyan-400 tracking-wider flex items-center gap-2">
                <Database className="size-3.5" /> Resource Quotas & Usage Limits
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Max Users / Seats</label>
                  <input
                    type="number"
                    min="1"
                    value={usersLimit}
                    onChange={(e) => setUsersLimit(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm"
                  />
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Statements / Mo</label>
                  <input
                    type="number"
                    min="1"
                    value={statementsLimit}
                    onChange={(e) => setStatementsLimit(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm"
                  />
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Currencies Allowed</label>
                  <input
                    type="number"
                    min="1"
                    value={currenciesLimit}
                    onChange={(e) => setCurrenciesLimit(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm"
                  />
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Storage (MB)</label>
                  <input
                    type="number"
                    min="100"
                    step="512"
                    value={storageLimit}
                    onChange={(e) => setStorageLimit(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm"
                  />
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Monthly Transactions</label>
                  <input
                    type="number"
                    min="100"
                    step="500"
                    value={transactionsLimit}
                    onChange={(e) => setTransactionsLimit(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm"
                  />
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                  <label className="block text-xs font-mono text-slate-400 mb-1">AI Analyst Credits</label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={aiCreditsLimit}
                    onChange={(e) => setAiCreditsLimit(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Features Entitlements Checkbox Matrix */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-mono uppercase text-cyan-400 tracking-wider flex items-center gap-2">
                    <Shield className="size-3.5" /> Features Included ({selectedFeatures.length} selected)
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Organizations on this plan can ONLY access checked features
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="px-2.5 py-1 rounded text-xs font-mono text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/30 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="px-2.5 py-1 rounded text-xs font-mono text-slate-400 hover:bg-white/5 border border-white/10 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Categorized Features */}
              <div className="space-y-4">
                {categories.map((cat) => {
                  const catFeatures = CANONICAL_PLAN_FEATURES.filter((f) => f.category === cat.key);
                  return (
                    <div key={cat.key} className="space-y-2">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 bg-white/[0.02] px-3 py-1.5 rounded-lg border border-white/5">
                        {cat.label}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {catFeatures.map((feat) => {
                          const checked = isFeatureSelected(feat.id);
                          return (
                            <label
                              key={feat.id}
                              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                                checked
                                  ? 'bg-cyan-500/10 border-cyan-500/40 text-white'
                                  : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/[0.04]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleFeature(feat.id)}
                                className="mt-0.5 size-4 rounded accent-cyan-400 bg-white/5"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-mono font-medium text-white">{feat.label}</p>
                                <p className="text-[11px] text-slate-400 leading-tight mt-0.5 line-clamp-2">
                                  {feat.description}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Custom Features List */}
                {customFeatures.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 bg-white/[0.02] px-3 py-1.5 rounded-lg border border-white/5">
                      Custom Features
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {customFeatures.map((cf) => (
                        <div
                          key={cf}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 text-xs font-mono"
                        >
                          <span>{cf}</span>
                          <button
                            type="button"
                            onClick={() => toggleFeature(cf)}
                            className="text-slate-400 hover:text-red-400"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Custom Feature */}
                <div className="flex gap-2 pt-2">
                  <input
                    type="text"
                    value={customFeatureInput}
                    onChange={(e) => setCustomFeatureInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomFeature();
                      }
                    }}
                    placeholder="+ Add custom feature key or capability name..."
                    className="flex-1 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomFeature}
                    className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-400 border border-cyan-500/30 text-xs font-mono flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="size-3.5" /> Add
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-5 py-2.5 rounded-xl text-slate-400 hover:text-white font-mono text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white font-medium text-sm transition-transform active:scale-95 disabled:opacity-50"
                style={AXIOM.buttons.action}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Saving Plan...</span>
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    <span>{isEditing ? 'Save Changes' : 'Create Plan'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
