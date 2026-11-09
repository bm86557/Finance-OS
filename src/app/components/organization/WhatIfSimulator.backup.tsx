import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Slider } from '../ui/slider';
import { formatCurrency } from '@/lib/formatters';
import { Zap, TrendingUp, RefreshCw, Save, Target } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';

interface Scenario {
  name: string;
  revenueChange: number; // percentage
  expenseChange: number; // percentage
  newHires: number;
  avgSalary: number;
  priceIncrease: number; // percentage
  utilizationRate: number; // percentage
}

const baseMetrics = {
  monthlyRevenue: 2850000,
  monthlyExpense: 1900000,
  currentTeam: 20,
  avgSalary: 45000,
  avgProjectValue: 500000,
  utilizationRate: 75,
  billableRate: 3500
};

function safeDiv(n: number, d: number, fallback = 0): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || Math.abs(d) < 1e-9) return fallback;
  const q = n / d;
  return Number.isFinite(q) ? q : fallback;
}

export function WhatIfSimulator() {
  const svc = useOrgServices();

  // Service-backed: pull dashboard summary for real baseline metrics
  const { data: dashSummary } = useService(
    () => svc.reports.getDashboardSummary(),
    [svc.orgId]
  );

  const effectiveBase = useMemo(() => {
    const d = dashSummary;
    if (!d || (d.totalRevenue <= 0 && d.totalExpenses <= 0)) {
      return baseMetrics;
    }
    const monthlyRev =
      d.totalRevenue > 0 ? Math.max(d.totalRevenue / 12, 1) : baseMetrics.monthlyRevenue;
    const monthlyExp =
      d.totalExpenses > 0 ? Math.max(d.totalExpenses / 12, 1) : baseMetrics.monthlyExpense;
    return { ...baseMetrics, monthlyRevenue: monthlyRev, monthlyExpense: monthlyExp };
  }, [dashSummary]);

  const [scenario, setScenario] = useState<Scenario>({
    name: 'Current State',
    revenueChange: 0,
    expenseChange: 0,
    newHires: 0,
    avgSalary: baseMetrics.avgSalary,
    priceIncrease: 0,
    utilizationRate: baseMetrics.utilizationRate
  });

  const [savedScenarios, setSavedScenarios] = useState<Scenario[]>([]);

  // Calculate scenario impact
  const calculateImpact = (s: Scenario) => {
    // Revenue calculation
    const revenueFromChange = effectiveBase.monthlyRevenue * (1 + s.revenueChange / 100);
    const revenueFromPrice = revenueFromChange * (1 + s.priceIncrease / 100);
    const revenueFromUtilization = revenueFromPrice * (s.utilizationRate / effectiveBase.utilizationRate);
    const projectedRevenue = revenueFromUtilization;

    // Expense calculation
    const baseExpense = effectiveBase.monthlyExpense * (1 + s.expenseChange / 100);
    const newHireCost = s.newHires * s.avgSalary;
    const projectedExpense = baseExpense + newHireCost;

    // Metrics
    const projectedProfit = projectedRevenue - projectedExpense;
    const currentProfit = effectiveBase.monthlyRevenue - effectiveBase.monthlyExpense;
    const profitChange = projectedProfit - currentProfit;
    const profitChangePercent = (profitChange / currentProfit) * 100;
    const margin = (projectedProfit / projectedRevenue) * 100;

    // Team metrics
    const totalTeam = effectiveBase.currentTeam + s.newHires;
    const revenuePerHead = projectedRevenue / totalTeam;
    const profitPerHead = projectedProfit / totalTeam;

    // Breakeven
    const breakEvenRevenue = projectedExpense;
    const revenueGap = projectedRevenue - breakEvenRevenue;

    return {
      revenue: projectedRevenue,
      expense: projectedExpense,
      profit: projectedProfit,
      profitChange,
      profitChangePercent,
      margin,
      totalTeam,
      revenuePerHead,
      profitPerHead,
      breakEvenRevenue,
      revenueGap
    };
  };

  const currentImpact = calculateImpact(scenario);
  const baselineImpact = calculateImpact({
    name: 'Baseline',
    revenueChange: 0,
    expenseChange: 0,
    newHires: 0,
    avgSalary: effectiveBase.avgSalary,
    priceIncrease: 0,
    utilizationRate: effectiveBase.utilizationRate
  });

  // Generate 12-month projection
  const generateProjection = (s: Scenario) => {
    const impact = calculateImpact(s);
    const data = [];
    
    for (let i = 0; i < 12; i++) {
      // Add growth trend
      const growthFactor = 1 + (i * 0.02); // 2% monthly compound
      data.push({
        month: `M${i + 1}`,
        revenue: Math.round(impact.revenue * growthFactor),
        expense: Math.round(impact.expense * (1 + i * 0.01)), // 1% expense growth
        profit: Math.round((impact.revenue * growthFactor) - (impact.expense * (1 + i * 0.01)))
      });
    }
    
    return data;
  };

  const projectionData = generateProjection(scenario);
  const baselineData = generateProjection({
    name: 'Baseline',
    revenueChange: 0,
    expenseChange: 0,
    newHires: 0,
    avgSalary: baseMetrics.avgSalary,
    priceIncrease: 0,
    utilizationRate: baseMetrics.utilizationRate
  });

  /** Single dataset for Recharts — `data` belongs on LineChart, not on each Line. */
  const projectionChartData = projectionData.map((row, i) => ({
    ...row,
    baselineProfit: baselineData[i]?.profit ?? row.profit,
  }));

  const handleReset = () => {
    setScenario({
      name: 'Current State',
      revenueChange: 0,
      expenseChange: 0,
      newHires: 0,
      avgSalary: effectiveBase.avgSalary,
      priceIncrease: 0,
      utilizationRate: effectiveBase.utilizationRate
    });
    toast.success('Reset to baseline');
  };

  const handleSave = () => {
    const name = prompt('Enter scenario name:');
    if (name) {
      setSavedScenarios([...savedScenarios, { ...scenario, name }]);
      toast.success(`Saved scenario: ${name}`);
    }
  };

  const loadScenario = (s: Scenario) => {
    setScenario(s);
    toast.success(`Loaded scenario: ${s.name}`);
  };

  // Quick scenarios
  const applyQuickScenario = (type: 'aggressive' | 'conservative' | 'team-expansion') => {
    switch (type) {
      case 'aggressive':
        setScenario({
          name: 'Aggressive Growth',
          revenueChange: 30,
          expenseChange: 15,
          newHires: 5,
          avgSalary: baseMetrics.avgSalary,
          priceIncrease: 15,
          utilizationRate: 85
        });
        break;
      case 'conservative':
        setScenario({
          name: 'Conservative Growth',
          revenueChange: 10,
          expenseChange: 5,
          newHires: 2,
          avgSalary: baseMetrics.avgSalary,
          priceIncrease: 5,
          utilizationRate: 80
        });
        break;
      case 'team-expansion':
        setScenario({
          name: 'Team Expansion',
          revenueChange: 25,
          expenseChange: 20,
          newHires: 8,
          avgSalary: baseMetrics.avgSalary,
          priceIncrease: 0,
          utilizationRate: 75
        });
        break;
    }
    toast.success('Quick scenario applied');
  };

  const coverageRatio = safeDiv(
    currentImpact.revenue,
    currentImpact.breakEvenRevenue,
    0
  );

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
            >
              <Save className="size-4" />
              Save Scenario
            </motion.button>
          </div>
        </div>
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
            {formatCurrency(currentImpact.revenue, 'PKR')}
          </p>
          <p className="text-xs text-emerald-400 mt-1">
            +{formatCurrency(currentImpact.revenue - baselineImpact.revenue, 'PKR')} vs baseline
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
            {formatCurrency(currentImpact.expense, 'PKR')}
          </p>
          <p className="text-xs text-red-400 mt-1">
            +{formatCurrency(currentImpact.expense - baselineImpact.expense, 'PKR')} vs baseline
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
            {formatCurrency(currentImpact.profit, 'PKR')}
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
                {scenario.revenueChange >= 0 ? '+' : ''}{scenario.revenueChange}%
              </span>
            </div>
            <Slider
              value={[scenario.revenueChange]}
              onValueChange={(value) => setScenario({ ...scenario, revenueChange: value[0] })}
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
                {scenario.expenseChange >= 0 ? '+' : ''}{scenario.expenseChange}%
              </span>
            </div>
            <Slider
              value={[scenario.expenseChange]}
              onValueChange={(value) => setScenario({ ...scenario, expenseChange: value[0] })}
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
                {scenario.priceIncrease >= 0 ? '+' : ''}{scenario.priceIncrease}%
              </span>
            </div>
            <Slider
              value={[scenario.priceIncrease]}
              onValueChange={(value) => setScenario({ ...scenario, priceIncrease: value[0] })}
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
                {scenario.utilizationRate}%
              </span>
            </div>
            <Slider
              value={[scenario.utilizationRate]}
              onValueChange={(value) => setScenario({ ...scenario, utilizationRate: value[0] })}
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
                value={scenario.newHires}
                onChange={(e) => setScenario({ ...scenario, newHires: parseInt(e.target.value) || 0 })}
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
                value={scenario.avgSalary}
                onChange={(e) => setScenario({ ...scenario, avgSalary: parseInt(e.target.value) || 0 })}
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
                {formatCurrency(currentImpact.revenuePerHead, 'PKR')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Profit/Head</span>
              <span className="text-sm text-cyan-400 font-medium">
                {formatCurrency(currentImpact.profitPerHead, 'PKR')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Team Size</span>
              <span className="text-sm text-white font-medium">
                {currentImpact.totalTeam} (+{scenario.newHires})
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
                {formatCurrency(currentImpact.breakEvenRevenue, 'PKR')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Revenue Gap</span>
              <span className={`text-sm font-medium ${currentImpact.revenueGap >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(currentImpact.revenueGap, 'PKR')}
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
                {formatCurrency(scenario.newHires * scenario.avgSalary, 'PKR')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Base Expense Change</span>
              <span className="text-sm text-red-400 font-medium">
                {formatCurrency(effectiveBase.monthlyExpense * (scenario.expenseChange / 100), 'PKR')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Total New Expense</span>
              <span className="text-sm text-red-400 font-medium">
                {formatCurrency(currentImpact.expense - baselineImpact.expense, 'PKR')}
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 12-Month Projection */}
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
          <LineChart data={projectionChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
            <XAxis dataKey="month" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" tickFormatter={(value) => `${value / 1000}K`} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0a0a0f',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '12px',
                color: '#fff'
              }}
              formatter={(value: any) => formatCurrency(value, 'PKR')}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              strokeWidth={3}
              name="Scenario Revenue"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="expense"
              stroke="#ef4444"
              strokeWidth={3}
              name="Scenario Expense"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="profit"
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
          </LineChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Saved Scenarios */}
      {savedScenarios.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <h3 className="text-xl font-bold text-white mb-4">Saved Scenarios</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {savedScenarios.map((s, index) => {
              const impact = calculateImpact(s);
              return (
                <motion.div
                  key={index}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => loadScenario(s)}
                  className="p-3 rounded-xl cursor-pointer"
                  style={AXIOM.containers.item}
                >
                  <h3 className="text-white font-semibold mb-2">{s.name}</h3>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Profit:</span>
                      <span className={impact.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {formatCurrency(impact.profit, 'PKR')}
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
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* AI Insights */}
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
            <p className="text-lg font-bold text-white mb-3">AI Insights</p>
            <div className="space-y-2 text-sm text-slate-300">
              {currentImpact.profit > baselineImpact.profit ? (
                <p>✓ This scenario increases monthly profit by {formatCurrency(currentImpact.profitChange, 'PKR')} ({currentImpact.profitChangePercent.toFixed(1)}%)</p>
              ) : (
                <p>⚠ This scenario decreases monthly profit by {formatCurrency(Math.abs(currentImpact.profitChange), 'PKR')} ({Math.abs(currentImpact.profitChangePercent).toFixed(1)}%)</p>
              )}
              
              {currentImpact.margin > 30 ? (
                <p>✓ Profit margin of {currentImpact.margin.toFixed(1)}% is healthy for an agency</p>
              ) : currentImpact.margin > 20 ? (
                <p>→ Profit margin of {currentImpact.margin.toFixed(1)}% is acceptable but could be improved</p>
              ) : (
                <p>⚠ Profit margin of {currentImpact.margin.toFixed(1)}% is below industry standard (20-30%)</p>
              )}
              
              {scenario.newHires > 0 && (
                <p>→ Adding {scenario.newHires} team members increases monthly expense by {formatCurrency(scenario.newHires * scenario.avgSalary, 'PKR')}</p>
              )}
              
              {currentImpact.revenuePerHead > 140000 && (
                <p>✓ Revenue per head of {formatCurrency(currentImpact.revenuePerHead, 'PKR')} is excellent</p>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}