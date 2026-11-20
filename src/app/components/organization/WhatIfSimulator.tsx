/**
 * What-If Simulator — Production-Ready Implementation
 * ====================================================
 * Financial scenario modeling with real backend data.
 * Replaces hardcoded metrics with actual org data and persists scenarios.
 */

import { useMemo, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Slider } from '../ui/slider';
import { formatCurrency } from '@/lib/formatters';
import { Zap, TrendingUp, RefreshCw, Save, Target, Trash2, AlertCircle, Sparkles, Send, ShieldAlert, CheckCircle2, Building2, X } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { NeonSkeleton, SkeletonCard, SkeletonChart } from '../ui/NeonSkeleton';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';
import { createSimulatorService } from '@/services/simulatorService';
import type { WhatIfScenario, SimulatorBaseline, ProjectionPoint, SimulatorAIAnalysis } from '@/services/simulatorService';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

interface ScenarioInput {
  name: string;
  revenueChangePct: number;
  expenseChangePct: number;
  newHires: number;
  avgSalary: number;
  priceIncreasePct: number;
  utilizationRatePct: number;
  salaryChangePct?: number;
  vendorCostChangePct?: number;
  fxSensitivityPct?: number;
}

function safeDiv(n: number, d: number, fallback = 0): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || Math.abs(d) < 1e-9) return fallback;
  const q = n / d;
  return Number.isFinite(q) ? q : fallback;
}

export function WhatIfSimulator() {
  const svc = useOrgServices();
  const { featureFlags } = usePlatformSettings();
  const simulatorSvc = useMemo(() => createSimulatorService(svc.orgId), [svc.orgId]);

  // Fetch baseline metrics from backend
  const { data: baseline, loading: baselineLoading, error: baselineError, refetch: refetchBaseline } = useService(
    () => simulatorSvc.getBaseline(),
    [svc.orgId]
  );

  // Fetch projection data from backend
  const { data: projectionData, loading: projectionLoading } = useService(
    () => simulatorSvc.getProjection(12),
    [svc.orgId]
  );

  // Fetch saved scenarios from backend
  const { data: savedScenarios, loading: scenariosLoading, refetch: refetchScenarios } = useService(
    () => simulatorSvc.getAllScenarios(),
    [svc.orgId]
  );

  const [currentScenario, setCurrentScenario] = useState<ScenarioInput>({
    name: 'Current State',
    revenueChangePct: 0,
    expenseChangePct: 0,
    newHires: 0,
    avgSalary: baseline?.avgSalary ?? 45000,
    priceIncreasePct: 0,
    utilizationRatePct: baseline?.utilizationRate ?? 75
  });

  const [savingScenario, setSavingScenario] = useState(false);
  const [deletingScenarioId, setDeletingScenarioId] = useState<string | null>(null);

  // Save Scenario Modal state (§14 ownership & visibility policy)
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveScenarioName, setSaveScenarioName] = useState('');
  const [saveVisibility, setSaveVisibility] = useState<'organization' | 'management' | 'private'>('organization');

  // AI Scenario Copilot state (§13, §14)
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<SimulatorAIAnalysis | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // Update scenario defaults when baseline loads
  useEffect(() => {
    if (baseline) {
      setCurrentScenario(prev => ({
        ...prev,
        avgSalary: baseline.avgSalary || prev.avgSalary,
        utilizationRatePct: baseline.utilizationRate || prev.utilizationRatePct,
      }));
    }
  }, [baseline]);

  // Calculate impact using the service
  const currentImpact = useMemo(() => {
    if (!baseline) return null;
    return simulatorSvc.calculateImpact(baseline, currentScenario);
  }, [baseline, currentScenario, simulatorSvc]);

  const baselineImpact = useMemo(() => {
    if (!baseline) return null;
    return simulatorSvc.calculateImpact(baseline, {
      revenueChangePct: 0,
      expenseChangePct: 0,
      priceIncreasePct: 0,
      utilizationRatePct: baseline.utilizationRate,
      newHires: 0,
      avgSalary: baseline.avgSalary,
    });
  }, [baseline, simulatorSvc]);

  // Generate client-side projection based on scenario
  const generateScenarioProjection = (scenario: ScenarioInput): ProjectionPoint[] => {
    if (!baseline || !projectionData) return [];
    
    const impact = simulatorSvc.calculateImpact(baseline, scenario);
    
    return projectionData.map((point, index) => {
      // Apply growth trend from backend projection
      const growthMultiplier = projectionData[0]?.revenue > 0 
        ? point.revenue / projectionData[0].revenue 
        : 1 + (index * 0.02);
      
      return {
        month: point.month,
        revenue: Math.round(impact.revenue * growthMultiplier),
        expense: Math.round(impact.expense * (1 + index * 0.01)),
        profit: Math.round((impact.revenue * growthMultiplier) - (impact.expense * (1 + index * 0.01)))
      };
    });
  };

  const scenarioProjection = useMemo(() => {
    return generateScenarioProjection(currentScenario);
  }, [currentScenario, baseline, projectionData, simulatorSvc]);

  // Merge baseline and scenario projections for chart
  const chartData = useMemo(() => {
    if (!projectionData || !scenarioProjection) return [];
    
    return scenarioProjection.map((point, index) => ({
      month: `M${point.month}`,
      scenarioRevenue: point.revenue,
      scenarioExpense: point.expense,
      scenarioProfit: point.profit,
      baselineRevenue: projectionData[index]?.revenue ?? 0,
      baselineExpense: projectionData[index]?.expense ?? 0,
      baselineProfit: projectionData[index]?.profit ?? 0,
    }));
  }, [projectionData, scenarioProjection]);

  const handleReset = () => {
    setCurrentScenario({
      name: 'Current State',
      revenueChangePct: 0,
      expenseChangePct: 0,
      newHires: 0,
      avgSalary: baseline?.avgSalary ?? 45000,
      priceIncreasePct: 0,
      utilizationRatePct: baseline?.utilizationRate ?? 75,
    });
    toast.success('Reset to baseline');
  };

  const handleOpenSaveModal = () => {
    setSaveScenarioName(
      currentScenario.name && currentScenario.name !== 'Current State'
        ? currentScenario.name
        : `Scenario ${new Date().toLocaleDateString()}`
    );
    setSaveModalOpen(true);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = saveScenarioName.trim();
    if (!name) {
      toast.error('Please enter a scenario name');
      return;
    }

    setSavingScenario(true);
    try {
      const result = await simulatorSvc.createScenario({
        ...currentScenario,
        name,
        visibility: saveVisibility,
        baselineSnapshotId: baseline?.snapshotId || 'live_90d',
        aiAnalysis: aiAnalysis ?? undefined,
        isPreset: false,
        lastResult: currentImpact ?? undefined,
      });

      if (result.success) {
        toast.success(`Saved scenario "${name}" to Supabase`);
        setSaveModalOpen(false);
        await refetchScenarios();
      } else {
        toast.error(result.error || 'Failed to save scenario');
      }
    } catch (error) {
      toast.error('Failed to save scenario');
      console.error('Save scenario error:', error);
    } finally {
      setSavingScenario(false);
    }
  };

  const handleAIParse = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!baseline || !aiPrompt.trim()) return;
    setAiParsing(true);
    setAiRationale(null);
    try {
      const res = await simulatorSvc.parseScenarioWithAI(aiPrompt.trim(), baseline);
      if (res.success && res.data?.scenario) {
        const s = res.data.scenario;
        setCurrentScenario({
          name: s.name,
          revenueChangePct: s.revenueChangePct,
          expenseChangePct: s.expenseChangePct,
          priceIncreasePct: s.priceIncreasePct,
          utilizationRatePct: s.utilizationRatePct,
          newHires: s.newHires,
          avgSalary: s.avgSalary || baseline.avgSalary,
          salaryChangePct: s.salaryChangePct,
          vendorCostChangePct: s.vendorCostChangePct,
          fxSensitivityPct: s.fxSensitivityPct,
        });
        setAiRationale(res.data.rationale);
        toast.success(
          res.data.aiPowered
            ? `AI modeled "${s.name}" (${res.data.model})`
            : `Modeled "${s.name}"`
        );
      } else {
        toast.error(res.error || 'Could not parse scenario prompt');
      }
    } catch {
      toast.error('AI scenario modeling failed');
    } finally {
      setAiParsing(false);
    }
  };

  const handleAIAnalyze = async () => {
    if (!baseline || !currentImpact) return;
    setAiAnalyzing(true);
    try {
      const res = await simulatorSvc.analyzeScenarioWithAI(baseline, currentScenario, currentImpact);
      if (res.success && res.data) {
        setAiAnalysis(res.data);
        toast.success(
          res.data.aiPowered
            ? `AI CFO Analysis ready (${res.data.model})`
            : 'CFO Analysis generated'
        );
      } else {
        toast.error(res.error || 'Failed to run AI CFO analysis');
      }
    } catch {
      toast.error('AI CFO analysis failed');
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleLoadScenario = (scenario: WhatIfScenario) => {
    setCurrentScenario({
      name: scenario.name,
      revenueChangePct: scenario.revenueChangePct,
      expenseChangePct: scenario.expenseChangePct,
      newHires: scenario.newHires,
      avgSalary: scenario.avgSalary,
      priceIncreasePct: scenario.priceIncreasePct,
      utilizationRatePct: scenario.utilizationRatePct,
    });
    toast.success(`Loaded scenario: ${scenario.name}`);
  };

  const handleDeleteScenario = async (scenarioId: string, scenarioName: string) => {
    if (!confirm(`Delete scenario "${scenarioName}"?`)) return;

    setDeletingScenarioId(scenarioId);
    try {
      const result = await simulatorSvc.deleteScenario(scenarioId);
      if (result.success) {
        toast.success('Scenario deleted');
        await refetchScenarios();
      } else {
        toast.error(result.error || 'Failed to delete scenario');
      }
    } catch (error) {
      toast.error('Failed to delete scenario');
      console.error('Delete scenario error:', error);
    } finally {
      setDeletingScenarioId(null);
    }
  };

  const applyQuickScenario = (type: 'aggressive' | 'conservative' | 'team-expansion') => {
    const avgSalary = baseline?.avgSalary ?? 45000;
    
    switch (type) {
      case 'aggressive':
        setCurrentScenario({
          name: 'Aggressive Growth',
          revenueChangePct: 30,
          expenseChangePct: 15,
          newHires: 5,
          avgSalary,
          priceIncreasePct: 15,
          utilizationRatePct: 85,
        });
        break;
      case 'conservative':
        setCurrentScenario({
          name: 'Conservative Growth',
          revenueChangePct: 10,
          expenseChangePct: 5,
          newHires: 2,
          avgSalary,
          priceIncreasePct: 5,
          utilizationRatePct: 80,
        });
        break;
      case 'team-expansion':
        setCurrentScenario({
          name: 'Team Expansion',
          revenueChangePct: 25,
          expenseChangePct: 20,
          newHires: 8,
          avgSalary,
          priceIncreasePct: 0,
          utilizationRatePct: 75,
        });
        break;
    }
    toast.success('Quick scenario applied');
  };

  if (!featureFlags.advanced_what_if_simulations) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: AXIOM.backgrounds.main }}>
        <div className="max-w-md text-center p-8 rounded-2xl border border-amber-500/30 bg-slate-900/80">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <p className="text-white text-xl font-bold mb-2">Advanced What-If Simulations Disabled</p>
          <p className="text-slate-400 text-sm">
            The Advanced What-If Simulations feature flag is currently turned off system-wide in Platform Settings. Enable it in the Platform Admin Portal to run financial scenario models.
          </p>
        </div>
      </div>
    );
  }

  // Loading state (consistent skeleton loading across the app)
  if (baselineLoading) {
    return (
      <div className="min-h-screen p-4 sm:p-6 lg:p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <NeonSkeleton width="48px" height="48px" color="#a855f7" />
            <div className="space-y-2">
              <NeonSkeleton width="240px" height="28px" color="#a855f7" />
              <NeonSkeleton width="320px" height="14px" color="#a855f7" />
            </div>
          </div>
          <div className="flex gap-2">
            <NeonSkeleton width="90px" height="38px" color="#2dd4ff" />
            <NeonSkeleton width="130px" height="38px" color="#2dd4ff" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <SkeletonCard key={idx} color="#a855f7" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <SkeletonCard key={idx} color="#2dd4ff" />
          ))}
        </div>
        <SkeletonChart color="#2dd4ff" />
      </div>
    );
  }

  // Error or empty baseline state (never stuck on loading!)
  if (baselineError || !baseline) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: AXIOM.backgrounds.main }}>
        <div className="max-w-md text-center p-8 rounded-2xl border border-red-500/30 bg-slate-900/80 space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <p className="text-white text-lg font-semibold">Failed to load simulator baseline</p>
          <p className="text-slate-400 text-sm">
            {baselineError || 'Unable to retrieve organization financial baseline from the server.'}
          </p>
          <button
            type="button"
            onClick={() => refetchBaseline()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white cursor-pointer"
            style={AXIOM.buttons.primary}
          >
            Retry Loading Simulator
          </button>
        </div>
      </div>
    );
  }

  const currency = baseline.currency || 'PKR';
  const thresholds = baseline.thresholds;
  const coverageRatio = currentImpact ? safeDiv(currentImpact.revenue, currentImpact.breakEvenRevenue, 0) : 0;

  // Insufficient history warning
  const showDataWarning = !baseline.hasSufficientHistory && baseline.historyDays < 60;

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Zap className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                What-If Simulator
              </h1>
              <p className="text-slate-400 text-sm">Model different business scenarios and their financial impact</p>
            </div>
          </div>
          <div className="flex gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
              onClick={handleReset}
            >
              <RefreshCw className="size-4" />
              Reset
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
              onClick={handleOpenSaveModal}
              disabled={savingScenario}
            >
              <Save className="size-4" />
              {savingScenario ? 'Saving...' : 'Save Scenario'}
            </motion.button>
          </div>
        </div>

        {/* AI Scenario Copilot (§13, §14 — Non-Posting Sandbox) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 sm:p-5 rounded-2xl mb-4"
          style={{
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.14), rgba(6, 182, 212, 0.12))',
            border: '1px solid rgba(168, 85, 247, 0.35)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-purple-400" />
              <span className="text-sm font-bold text-white">AI Scenario Copilot</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Non-Posting Sandbox (§14)
              </span>
            </div>
            <button
              type="button"
              onClick={handleAIAnalyze}
              disabled={aiAnalyzing || !currentImpact}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
              }}
            >
              <Sparkles className="size-3.5" />
              {aiAnalyzing ? 'Analyzing Scenario…' : 'Run AI CFO Analysis'}
            </button>
          </div>
          <form onSubmit={handleAIParse} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder='Ask AI to model a scenario, e.g. "Hire 2 devs at $5000/mo, increase prices 15%, cut expenses 10%"'
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-400"
            />
            <button
              type="submit"
              disabled={aiParsing || !aiPrompt.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              style={AXIOM.buttons.primary}
            >
              <Send className="size-4" />
              {aiParsing ? 'Modeling…' : 'Model with AI'}
            </button>
          </form>
          {aiRationale && (
            <p className="text-xs text-cyan-300 mt-2.5">
              ✨ {aiRationale}
            </p>
          )}
        </motion.div>

        {/* Data Warning */}
        {showDataWarning && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl flex items-start gap-3 mb-4"
            style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
            }}
          >
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-400 font-semibold text-sm">Limited Historical Data</p>
              <p className="text-amber-300 text-xs mt-1">
                Based on {baseline.historyDays} days of data. Projections are illustrative. 
                Add more transaction history for accurate forecasts.
              </p>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Quick Scenarios */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => applyQuickScenario('aggressive')}
          className="p-4 rounded-2xl cursor-pointer"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <TrendingUp className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Aggressive Growth</h3>
              <p className="text-xs text-slate-400">+30% revenue, +5 hires</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => applyQuickScenario('conservative')}
          className="p-4 rounded-2xl cursor-pointer"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.blue,
                boxShadow: AXIOM.shadows.iconBlue,
              }}
            >
              <Target className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Conservative Growth</h3>
              <p className="text-xs text-slate-400">+10% revenue, +2 hires</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => applyQuickScenario('team-expansion')}
          className="p-4 rounded-2xl cursor-pointer"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Team Expansion</h3>
              <p className="text-xs text-slate-400">+25% revenue, +8 hires</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Impact Summary */}
      {currentImpact && baselineImpact && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-slate-400 text-sm mb-1">Projected Revenue</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(currentImpact.revenue, currency)}
            </p>
            <p className="text-xs text-emerald-400 mt-1">
              +{formatCurrency(currentImpact.revenue - baselineImpact.revenue, currency)} vs baseline
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-slate-400 text-sm mb-1">Projected Expense</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(currentImpact.expense, currency)}
            </p>
            <p className="text-xs text-red-400 mt-1">
              +{formatCurrency(currentImpact.expense - baselineImpact.expense, currency)} vs baseline
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-slate-400 text-sm mb-1">Projected Profit</p>
            <p className={`text-2xl font-bold ${currentImpact.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(currentImpact.profit, currency)}
            </p>
            <p className={`text-xs mt-1 ${currentImpact.profitChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {currentImpact.profitChangePercent >= 0 ? '+' : ''}{currentImpact.profitChangePercent.toFixed(1)}% vs baseline
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-slate-400 text-sm mb-1">Profit Margin</p>
            <p className="text-2xl font-bold text-cyan-400">
              {currentImpact.margin.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {currentImpact.totalTeam} team members
            </p>
          </motion.div>
        </div>
      )}

      {/* Scenario Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <h3 className="text-xl font-bold text-white mb-6">Scenario Variables</h3>
        <div className="space-y-6">
          {/* Revenue Change */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-white font-medium">Revenue Change</label>
              <span className="px-3 py-1 rounded-lg text-sm font-medium" style={AXIOM.badges.info}>
                {currentScenario.revenueChangePct >= 0 ? '+' : ''}{currentScenario.revenueChangePct}%
              </span>
            </div>
            <Slider
              value={[currentScenario.revenueChangePct]}
              onValueChange={(value) => setCurrentScenario({ ...currentScenario, revenueChangePct: value[0] })}
              min={-50}
              max={100}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-2">
              <span>-50%</span>
              <span>+100%</span>
            </div>
          </div>

          {/* Expense Change */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-white font-medium">Expense Change (excluding new hires)</label>
              <span className="px-3 py-1 rounded-lg text-sm font-medium" style={AXIOM.badges.danger}>
                {currentScenario.expenseChangePct >= 0 ? '+' : ''}{currentScenario.expenseChangePct}%
              </span>
            </div>
            <Slider
              value={[currentScenario.expenseChangePct]}
              onValueChange={(value) => setCurrentScenario({ ...currentScenario, expenseChangePct: value[0] })}
              min={-30}
              max={50}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-2">
              <span>-30%</span>
              <span>+50%</span>
            </div>
          </div>

          {/* Price Increase */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-white font-medium">Price Increase</label>
              <span className="px-3 py-1 rounded-lg text-sm font-medium" style={AXIOM.badges.success}>
                {currentScenario.priceIncreasePct >= 0 ? '+' : ''}{currentScenario.priceIncreasePct}%
              </span>
            </div>
            <Slider
              value={[currentScenario.priceIncreasePct]}
              onValueChange={(value) => setCurrentScenario({ ...currentScenario, priceIncreasePct: value[0] })}
              min={0}
              max={50}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-2">
              <span>0%</span>
              <span>+50%</span>
            </div>
          </div>

          {/* Utilization Rate */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-white font-medium">Team Utilization Rate</label>
              <span className="px-3 py-1 rounded-lg text-sm font-medium" style={{ ...AXIOM.badges.neutral, color: '#a855f7' }}>
                {currentScenario.utilizationRatePct}%
              </span>
            </div>
            <Slider
              value={[currentScenario.utilizationRatePct]}
              onValueChange={(value) => setCurrentScenario({ ...currentScenario, utilizationRatePct: value[0] })}
              min={50}
              max={95}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-2">
              <span>50%</span>
              <span>95%</span>
            </div>
          </div>

          {/* New Hires */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-white font-medium mb-2 block">New Hires</label>
              <input
                type="number"
                value={currentScenario.newHires}
                onChange={(e) => setCurrentScenario({ ...currentScenario, newHires: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-4 py-3 rounded-xl text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>
            <div>
              <label className="text-white font-medium mb-2 block">Avg Salary (Monthly)</label>
              <input
                type="number"
                value={currentScenario.avgSalary}
                onChange={(e) => setCurrentScenario({ ...currentScenario, avgSalary: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-3 rounded-xl text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Detailed Metrics */}
      {currentImpact && baselineImpact && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="p-4 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-sm text-slate-400 mb-3 font-semibold">Per-Head Metrics</p>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Revenue/Head</span>
                <span className="text-sm text-white font-medium">
                  {formatCurrency(currentImpact.revenuePerHead, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Profit/Head</span>
                <span className="text-sm text-cyan-400 font-medium">
                  {formatCurrency(currentImpact.profitPerHead, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Team Size</span>
                <span className="text-sm text-white font-medium">
                  {currentImpact.totalTeam} (+{currentScenario.newHires})
                </span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="p-4 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-sm text-slate-400 mb-3 font-semibold">Break-Even Analysis</p>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Break-Even Revenue</span>
                <span className="text-sm text-white font-medium">
                  {formatCurrency(currentImpact.breakEvenRevenue, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Revenue Gap</span>
                <span className={`text-sm font-medium ${currentImpact.revenueGap >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatCurrency(currentImpact.revenueGap, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Coverage Ratio</span>
                <span className="text-sm text-white font-medium">
                  {coverageRatio > 0 ? `${coverageRatio.toFixed(2)}x` : '—'}
                </span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="p-4 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <p className="text-sm text-slate-400 mb-3 font-semibold">Additional Costs</p>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">New Hire Salaries</span>
                <span className="text-sm text-red-400 font-medium">
                  {formatCurrency(currentScenario.newHires * currentScenario.avgSalary, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Base Expense Change</span>
                <span className="text-sm text-red-400 font-medium">
                  {formatCurrency(baseline.monthlyExpense * (currentScenario.expenseChangePct / 100), currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Total New Expense</span>
                <span className="text-sm text-red-400 font-medium">
                  {formatCurrency(currentImpact.expense - baselineImpact.expense, currency)}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* 12-Month Projection */}
      {chartData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartBlue}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-white">12-Month Projection</h3>
            <div className="flex gap-2">
              <span className="px-2 py-1 rounded-lg text-xs font-medium" style={AXIOM.badges.info}>
                Scenario
              </span>
              <span className="px-2 py-1 rounded-lg text-xs font-medium" style={AXIOM.badges.neutral}>
                Baseline
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '12px',
                  color: '#fff'
                }}
                formatter={(value: any) => formatCurrency(value, currency)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="scenarioProfit"
                stroke="#06b6d4"
                strokeWidth={3}
                name="Scenario Profit"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="baselineProfit"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="5 5"
                name="Baseline Profit"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="scenarioRevenue"
                stroke="#10b981"
                strokeWidth={2}
                name="Scenario Revenue"
                dot={false}
                opacity={0.6}
              />
              <Line
                type="monotone"
                dataKey="scenarioExpense"
                stroke="#ef4444"
                strokeWidth={2}
                name="Scenario Expense"
                dot={false}
                opacity={0.6}
              />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Saved Scenarios */}
      {savedScenarios && savedScenarios.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <h3 className="text-xl font-bold text-white mb-4">Saved Scenarios</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {savedScenarios.map((scenario) => {
              const impact = simulatorSvc.calculateImpact(baseline, scenario);
              return (
                <motion.div
                  key={scenario.id}
                  whileHover={{ scale: 1.02 }}
                  className="p-3 rounded-xl relative group"
                  style={AXIOM.containers.item}
                >
                  <div className="cursor-pointer" onClick={() => handleLoadScenario(scenario)}>
                    <h3 className="text-white font-semibold mb-2">{scenario.name}</h3>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Profit:</span>
                        <span className={impact.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {formatCurrency(impact.profit, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Margin:</span>
                        <span className="text-cyan-400">{impact.margin.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Team:</span>
                        <span className="text-white">{impact.totalTeam}</span>
                      </div>
                    </div>
                  </div>
                  {!scenario.isPreset && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteScenario(scenario.id, scenario.name);
                      }}
                      disabled={deletingScenarioId === scenario.id}
                      className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        background: 'rgba(239, 68, 68, 0.2)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                      }}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* §14 Uncertainty Envelope & Real Department Impact */}
      {currentImpact && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Uncertainty Envelope + Burn/Runway */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl space-y-4"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Uncertainty & Cash Runway (§14)</h3>
              <span className="text-xs px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                {currentImpact.monthlyBurnRate > 0
                  ? `Burn: ${formatCurrency(currentImpact.monthlyBurnRate, currency)}/mo · ${currentImpact.runwayMonths} mo runway`
                  : 'Cash Generative (Net Positive)'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { key: 'stress', c: currentImpact.uncertainty.stressCase, accent: 'border-red-500/30 bg-red-500/5', text: 'text-red-400' },
                { key: 'expected', c: currentImpact.uncertainty.expectedCase, accent: 'border-cyan-500/30 bg-cyan-500/5', text: 'text-cyan-400' },
                { key: 'bull', c: currentImpact.uncertainty.bullCase, accent: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-400' },
              ].map(({ key, c, accent, text }) => (
                <div key={key} className={`p-3 rounded-xl border ${accent} space-y-1`}>
                  <p className="text-[11px] font-semibold text-slate-300">{c.label}</p>
                  <p className={`text-base font-bold ${text}`}>{formatCurrency(c.profit, currency)}</p>
                  <p className="text-[11px] text-slate-400">
                    Margin: {c.margin.toFixed(1)}% · {c.runwayMonths >= 999 ? 'Cash Gen.' : `${c.runwayMonths} mo`}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Real Organization Department Impact */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl space-y-3"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-purple-400" />
              <h3 className="text-lg font-bold text-white">Department Impact Breakdown</h3>
            </div>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {currentImpact.departmentImpact.map((d) => (
                <div
                  key={d.departmentId}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{d.departmentName}</p>
                    <p className="text-slate-400">
                      Cost: {formatCurrency(d.scenarioCost, currency)} ({d.costDelta >= 0 ? '+' : ''}{formatCurrency(d.costDelta, currency)})
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold ${d.scenarioProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(d.scenarioProfit, currency)}
                    </p>
                    <p className="text-slate-400">
                      {d.scenarioMargin.toFixed(1)}% margin
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* AI CFO Analysis & Real-Time Insights */}
      {currentImpact && thresholds && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartBlue}
        >
          <div className="flex items-start gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Sparkles className="size-5 text-white" />
            </div>
            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold text-white">AI CFO Scenario Intelligence</h3>
                {aiAnalysis && (
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                      aiAnalysis.riskLevel === 'high'
                        ? 'bg-red-500/15 text-red-300 border-red-500/30'
                        : aiAnalysis.riskLevel === 'moderate'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    Risk: {aiAnalysis.riskLevel.toUpperCase()} · {aiAnalysis.aiPowered ? `${aiAnalysis.provider}/${aiAnalysis.model}` : 'Deterministic Fallback'}
                  </span>
                )}
              </div>

              {aiAnalysis && (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-purple-500/25 space-y-3 text-sm">
                  <p className="text-slate-100 leading-relaxed">{aiAnalysis.executiveSummary}</p>
                  {aiAnalysis.keyRisks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-400 mb-1 flex items-center gap-1">
                        <ShieldAlert className="size-3.5" /> Key Risks
                      </p>
                      <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                        {aiAnalysis.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                  {aiAnalysis.optimizationLevers.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-emerald-400 mb-1 flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" /> Optimization Levers
                      </p>
                      <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                        {aiAnalysis.optimizationLevers.map((l, i) => <li key={i}>{l}</li>)}
                      </ul>
                    </div>
                  )}
                  {aiAnalysis.recommendedAction && (
                    <p className="text-xs text-cyan-300 pt-1 border-t border-slate-800">
                      <strong>Recommended Next Step:</strong> {aiAnalysis.recommendedAction}
                    </p>
                  )}
                  {aiAnalysis.disclaimer && (
                    <p className="text-[11px] text-slate-500">{aiAnalysis.disclaimer}</p>
                  )}
                </div>
              )}

              <div className="space-y-2 text-sm text-slate-300">
                {currentImpact.margin > thresholds.healthy_margin_pct && (
                  <p>✅ Excellent margin ({currentImpact.margin.toFixed(1)}%) — well above the {thresholds.healthy_margin_pct}% healthy threshold.</p>
                )}
                {currentImpact.margin <= thresholds.healthy_margin_pct && currentImpact.margin > thresholds.minimum_margin_pct && (
                  <p>⚠️ Moderate margin ({currentImpact.margin.toFixed(1)}%) — between minimum ({thresholds.minimum_margin_pct}%) and healthy ({thresholds.healthy_margin_pct}%).</p>
                )}
                {currentImpact.margin <= thresholds.minimum_margin_pct && (
                  <p>🚨 Low margin ({currentImpact.margin.toFixed(1)}%) — below minimum threshold of {thresholds.minimum_margin_pct}%. Consider reducing expenses or increasing prices.</p>
                )}
                {currentImpact.revenuePerHead > thresholds.good_revenue_per_head && (
                  <p>✅ Strong revenue per team member ({formatCurrency(currentImpact.revenuePerHead, currency)}) — exceeds target of {formatCurrency(thresholds.good_revenue_per_head, currency)}.</p>
                )}
                {currentImpact.revenuePerHead <= thresholds.good_revenue_per_head && (
                  <p>⚠️ Revenue per team member ({formatCurrency(currentImpact.revenuePerHead, currency)}) below target ({formatCurrency(thresholds.good_revenue_per_head, currency)}). Focus on productivity or pricing.</p>
                )}
                {coverageRatio < 1.2 && coverageRatio > 0 && (
                  <p>🚨 Low safety margin — revenue is only {coverageRatio.toFixed(2)}x expenses. Aim for at least 1.5x coverage.</p>
                )}
                {currentScenario.newHires > 0 && (
                  <p>💡 Adding {currentScenario.newHires} team members will increase monthly costs by {formatCurrency(currentScenario.newHires * currentScenario.avgSalary, currency)}.</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Save Scenario Modal (§14 Ownership & Visibility Policy) */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-950 border border-slate-700 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Save What-If Scenario</h3>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Scenario Name *</label>
                <input
                  type="text"
                  value={saveScenarioName}
                  onChange={(e) => setSaveScenarioName(e.target.value)}
                  placeholder="e.g. Q4 Expansion + 10% Pricing"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Visibility Policy (§14)</label>
                <select
                  value={saveVisibility}
                  onChange={(e) => setSaveVisibility(e.target.value as 'organization' | 'management' | 'private')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-cyan-400"
                >
                  <option value="organization">Organization (All authorized finance users)</option>
                  <option value="management">Management Only</option>
                  <option value="private">Private (Owner only)</option>
                </select>
              </div>
              <p className="text-[11px] text-slate-400">
                Saves hypothetical inputs, computed KPIs, and AI analysis to Supabase without modifying posted ledger records.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSaveModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingScenario}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-50"
                  style={AXIOM.buttons.primary}
                >
                  {savingScenario ? 'Saving…' : 'Save to Supabase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
