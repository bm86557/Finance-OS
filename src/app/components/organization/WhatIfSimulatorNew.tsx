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
import { Zap, TrendingUp, RefreshCw, Save, Target, Trash2, AlertCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';
import { createSimulatorService } from '@/services/simulatorService';
import type { WhatIfScenario, SimulatorBaseline, ProjectionPoint } from '@/services/simulatorService';

interface ScenarioInput {
  name: string;
  revenueChangePct: number;
  expenseChangePct: number;
  newHires: number;
  avgSalary: number;
  priceIncreasePct: number;
  utilizationRatePct: number;
}

function safeDiv(n: number, d: number, fallback = 0): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || Math.abs(d) < 1e-9) return fallback;
  const q = n / d;
  return Number.isFinite(q) ? q : fallback;
}

export function WhatIfSimulator() {
  const svc = useOrgServices();
  const simulatorSvc = useMemo(() => createSimulatorService(svc.orgId), [svc.orgId]);

  // Fetch baseline metrics from backend
  const { data: baseline, loading: baselineLoading, error: baselineError } = useService(
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

  const handleSave = async () => {
    const name = prompt('Enter scenario name:');
    if (!name || !name.trim()) return;

    setSavingScenario(true);
    try {
      const result = await simulatorSvc.createScenario({
        ...currentScenario,
        name: name.trim(),
        isPreset: false,
        lastResult: currentImpact ?? undefined,
      });

      if (result.success) {
        toast.success(`Saved scenario: ${name}`);
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

  // Loading state
  if (baselineLoading || !baseline) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: AXIOM.backgrounds.main }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading simulator data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (baselineError) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: AXIOM.backgrounds.main }}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-white text-lg font-semibold mb-2">Failed to load simulator data</p>
          <p className="text-slate-400">{baselineError}</p>
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
              onClick={handleSave}
              disabled={savingScenario}
            >
              <Save className="size-4" />
              {savingScenario ? 'Saving...' : 'Save Scenario'}
            </motion.button>
          </div>
        </div>

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

      {/* AI Insights */}
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
              <Zap className="size-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white mb-2">AI Insights</h3>
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
    </div>
  );
}
