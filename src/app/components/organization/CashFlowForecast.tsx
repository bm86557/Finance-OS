import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Calendar, DollarSign, AlertTriangle, Target, Waves, Loader2, RefreshCw } from 'lucide-react';
import { Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart, ComposedChart, ReferenceLine } from 'recharts';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useAuth } from '@/contexts/AuthContext';

interface ForecastData {
  date: string;
  income: number;
  expense: number;
  netFlow: number;
  balance: number;
  type: 'actual' | 'projected';
  confidence?: number;
}

interface Scenario {
  name: string;
  multiplier: number;
  description: string;
  color: string;
}

export function CashFlowForecast() {
  const svc = useOrgServices();
  const { currentOrganization } = useAuth();
  const orgCurrency = currentOrganization?.currency || 'USD';
  const [timeRange, setTimeRange] = useState<'30' | '60' | '90' | '180'>('90');
  const [selectedScenario, setSelectedScenario] = useState<'realistic' | 'best' | 'worst'>('realistic');
  const [viewType, setViewType] = useState<'flow' | 'balance'>('flow');

  const scenarios: Record<'realistic' | 'best' | 'worst', Scenario> = {
    realistic: {
      name: 'Realistic',
      multiplier: 1.0,
      description: 'Based on current trends, verified debits & credits, and confirmed recurring items',
      color: '#3b82f6',
    },
    best: {
      name: 'Best Case',
      multiplier: 1.3,
      description: 'Optimistic scenario (+30% income, -20% operating spend, zero collection delays)',
      color: '#10b981',
    },
    worst: {
      name: 'Worst Case',
      multiplier: 0.7,
      description: 'Conservative stress test (-30% income, +30% expenses, 14-day collection delay)',
      color: '#ef4444',
    },
  };

  // Live Supabase DB Forecast State
  const [forecastData, setForecastData] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const fetchForecast = useCallback(async (forceRegenerate: boolean = false) => {
    if (!svc.orgId) return;

    setForecastLoading(true);
    setForecastError(null);
    try {
      const { getCashFlowForecast, generateCashFlowForecast } = await import('@/services/supabaseCashFlowService');
      const horizonDays = parseInt(timeRange, 10);

      const result = forceRegenerate
        ? await generateCashFlowForecast(svc.orgId, horizonDays, selectedScenario)
        : await getCashFlowForecast(svc.orgId, horizonDays, selectedScenario);

      if (result.success && result.data) {
        setForecastData(result.data);
      } else {
        setForecastError(result.error || 'Failed to retrieve forecast from Supabase DB');
      }
    } catch (err) {
      console.error('[CashFlowForecast] Error fetching forecast from Supabase DB:', err);
      setForecastError(err instanceof Error ? err.message : 'Error fetching forecast');
    } finally {
      setForecastLoading(false);
    }
  }, [svc.orgId, timeRange, selectedScenario]);

  // Fetch forecast whenever timeRange or scenario changes
  useEffect(() => {
    fetchForecast(false);
  }, [fetchForecast]);

  const chartSeries = useMemo((): ForecastData[] => {
    if (forecastData?.forecasts && forecastData.forecasts.length > 0) {
      return forecastData.forecasts.map((f: any) => ({
        date: f.date,
        income: Number(f.income || 0),
        expense: Number(f.expenses ?? f.expense ?? 0),
        netFlow: Number(f.net ?? f.netFlow ?? 0),
        balance: Number(f.balance || 0),
        type: (f.type as any) || 'projected',
        confidence: f.confidence,
      }));
    }
    return [];
  }, [forecastData]);

  // Derived KPIs straight from Supabase DB forecast
  const currentBalance = forecastData?.currentCash ?? 0;
  const finalBalance = forecastData?.projectedCash ?? (chartSeries.length > 0 ? chartSeries[chartSeries.length - 1].balance : currentBalance);
  const netChange = finalBalance - currentBalance;

  const totalIncome = chartSeries.reduce((sum, d) => sum + d.income, 0);
  const totalExpense = chartSeries.reduce((sum, d) => sum + d.expense, 0);

  const lowestBalance = chartSeries.length > 0 ? Math.min(...chartSeries.map(d => d.balance)) : currentBalance;
  const highestBalance = chartSeries.length > 0 ? Math.max(...chartSeries.map(d => d.balance)) : currentBalance;

  const burnRateDisplay = forecastData?.burnRate ?? (chartSeries.length > 0 ? Math.round(totalExpense / chartSeries.length * 30) : 0);
  const dailyBurnDisplay = forecastData?.dailyBurn ?? Math.round(burnRateDisplay / 30);
  const runwayMonths = forecastData?.runway ?? null;
  const runwayStatus = forecastData?.runwayStatus ?? (runwayMonths === null && currentBalance > 0 ? 'cash_generative' : 'burning');

  const cashCrunchThreshold = forecastData?.cashCrunchThreshold ?? Math.max(10000, Math.round(currentBalance * 0.2));
  const cashCrunches = chartSeries.filter(d => d.balance < cashCrunchThreshold);
  const cashCrunchDays = forecastData?.cashCrunchDays ?? cashCrunches.length;

  const loading = forecastLoading;
  const error = forecastError;
  const runwayDays = runwayMonths != null ? runwayMonths * 30 : Number.POSITIVE_INFINITY;

  const monthlyData = useMemo(() => {
    // Use pre-computed monthly breakdown from engine when available
    if (forecastData?.monthlyBreakdown && Array.isArray(forecastData.monthlyBreakdown) && forecastData.monthlyBreakdown.length > 0) {
      return forecastData.monthlyBreakdown.map((mb: any) => ({
        month: mb.month,
        income: Math.round(Number(mb.income || 0)),
        expense: Math.round(Number(mb.expense || 0)),
        netFlow: Math.round(Number(mb.net || 0)),
        days: mb.daysInMonth || 30,
        type: mb.type || 'projected',
      }));
    }

    // Fallback: aggregate daily projections into months (legacy behavior)
    const months = new Map<string, { income: number, expense: number, count: number }>();
    
    chartSeries.forEach(d => {
      const month = d.date.substring(0, 7); // YYYY-MM
      const existing = months.get(month) || { income: 0, expense: 0, count: 0 };
      months.set(month, {
        income: existing.income + d.income,
        expense: existing.expense + d.expense,
        count: existing.count + 1
      });
    });

    return Array.from(months.entries()).map(([month, data]) => ({
      month,
      income: Math.round(data.income),
      expense: Math.round(data.expense),
      netFlow: Math.round(data.income - data.expense),
      days: data.count,
      type: 'projected' as const,
    }));
  }, [chartSeries, forecastData?.monthlyBreakdown]);

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Waves className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Cash Flow Forecast
              </h1>
              <p className="text-slate-400 text-sm">Predict future cash position and plan ahead</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(loading || forecastLoading) && (
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {forecastLoading ? 'Generating forecast…' : 'Updating…'}
              </span>
            )}
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as '30' | '60' | '90' | '180')}
              className="px-4 py-2 rounded-xl text-white text-sm"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
              }}
            >
              <option value="30">30 Days</option>
              <option value="60">60 Days</option>
              <option value="90">90 Days</option>
              <option value="180">180 Days</option>
            </select>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => fetchForecast(true)}
              disabled={forecastLoading}
              className="px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 text-slate-300 hover:text-white"
              style={AXIOM.buttons.secondary}
              title="Force regenerate forecast from live Supabase DB"
            >
              <RefreshCw className={`size-3.5 ${forecastLoading ? 'animate-spin text-cyan-400' : ''}`} />
              Regenerate
            </motion.button>
          </div>
        </div>
      </motion.div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm text-amber-200/90"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
          }}
          role="status"
        >
          Could not load live balances ({error}). The chart below uses a model projection from your last known cash position.
        </div>
      )}

      {/* Scenario Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.keys(scenarios) as Array<keyof typeof scenarios>).map((key, idx) => {
          const scenario = scenarios[key];
          const isSelected = selectedScenario === key;
          
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + idx * 0.05 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedScenario(key)}
              className="p-4 rounded-2xl cursor-pointer transition-all"
              style={{
                background: isSelected 
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))'
                  : AXIOM.containers.list.background,
                border: isSelected
                  ? '2px solid rgba(6, 182, 212, 0.5)'
                  : AXIOM.containers.list.border,
              }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: scenario.color }}
                />
                <h3 className="text-white font-semibold">{scenario.name}</h3>
                {isSelected && (
                  <span className="ml-auto px-2 py-1 rounded-lg text-xs font-medium" style={AXIOM.badges.info}>
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">{scenario.description}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Current Balance</p>
              <p className="text-2xl font-bold text-white">
                {formatCurrency(currentBalance, orgCurrency)}
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.blue,
                boxShadow: AXIOM.shadows.iconBlue,
              }}
            >
              <DollarSign className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Projected Balance</p>
              <p className={`text-2xl font-bold ${netChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(finalBalance, orgCurrency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {netChange > 0 ? '+' : ''}{formatCurrency(netChange, orgCurrency)} change
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: netChange > 0 ? AXIOM.iconBoxes.green : AXIOM.iconBoxes.red,
                boxShadow: netChange > 0 ? AXIOM.shadows.iconGreen : AXIOM.shadows.iconRed,
              }}
            >
              {netChange > 0 ? (
                <TrendingUp className="size-6 text-white" />
              ) : (
                <TrendingDown className="size-6 text-white" />
              )}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Burn Rate</p>
              <p className="text-2xl font-bold text-cyan-400">
                {formatCurrency(burnRateDisplay, orgCurrency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">per month ({formatCurrency(dailyBurnDisplay, orgCurrency)}/day)</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Waves className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Runway</p>
              <p className="text-2xl font-bold">
                {runwayStatus === 'cash_generative' || (runwayMonths == null && currentBalance > 0) ? (
                  <span className="text-emerald-400 text-xl font-bold">Cash Generative</span>
                ) : currentBalance <= 0 ? (
                  <span className="text-amber-400 text-xl font-bold">0 mo</span>
                ) : runwayMonths != null && Number.isFinite(runwayMonths) ? (
                  <span className="text-purple-400 text-2xl font-bold">~{runwayMonths} mo</span>
                ) : (
                  <span className="text-slate-400 text-2xl font-bold">—</span>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {runwayStatus === 'cash_generative' || (runwayMonths == null && currentBalance > 0)
                  ? 'Net positive cash flow'
                  : 'Months until depletion'}
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Calendar className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Alerts */}
      {cashCrunches.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl"
          style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-white font-semibold mb-1">Cash Flow Alert</p>
              <p className="text-xs text-slate-400">
                Your balance may drop below {formatCurrency(cashCrunchThreshold, orgCurrency)} on {cashCrunches.length} day(s) 
                in the next {timeRange} days. Consider:
              </p>
              <ul className="text-xs text-slate-400 mt-2 space-y-1 ml-4">
                <li>• Following up on pending invoices</li>
                <li>• Negotiating payment terms with vendors</li>
                <li>• Building a cash reserve</li>
              </ul>
            </div>
          </div>
        </motion.div>
      )}

      {/* View Toggle */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex gap-2"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setViewType('flow')}
          className="px-4 py-2 rounded-xl text-sm font-medium"
          style={viewType === 'flow' ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
        >
          Cash Flow
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setViewType('balance')}
          className="px-4 py-2 rounded-xl text-sm font-medium"
          style={viewType === 'balance' ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
        >
          Balance Trend
        </motion.button>
      </motion.div>

      {/* Empty State */}
      {chartSeries.length === 0 && !loading && !forecastLoading && (
        <motion.div
          {...AXIOM.animations.fadeInTop}
          className="rounded-2xl p-8 text-center"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <div 
              className="p-4 rounded-xl"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Waves className="size-8 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-2">
                No Forecast Data Available
              </h3>
              <p className="text-slate-400 text-sm max-w-md">
                Cash flow forecasts require transaction history. Add transactions or import 
                bank statements to generate accurate projections.
              </p>
            </div>
            <div className="mt-4 text-xs text-slate-500">
              {error && <p className="text-red-400">{error}</p>}
            </div>
          </div>
        </motion.div>
      )}

      {/* Charts - Only show if we have data */}
      {chartSeries.length > 0 && (<>

      <AnimatePresence mode="wait">
        {viewType === 'flow' ? (
          <motion.div
            key="flow"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartBlue}
          >
            <h3 className="text-xl font-bold text-white mb-4">Daily Cash Flow</h3>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
                <XAxis 
                  dataKey="date" 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => `${value / 1000}K`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '12px',
                    color: '#fff'
                  }}
                  formatter={(value: any) => formatCurrency(value, orgCurrency)}
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                />
                <Legend />
                <Bar dataKey="income" fill="#10b981" name="Income" opacity={0.8} />
                <Bar dataKey="expense" fill="#ef4444" name="Expense" opacity={0.8} />
                <Line 
                  type="monotone" 
                  dataKey="netFlow" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  name="Net Flow"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>
        ) : (
          <motion.div
            key="balance"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartBlue}
          >
            <h3 className="text-xl font-bold text-white mb-4">Balance Projection</h3>
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartSeries}>
                <defs>
                  <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={scenarios[selectedScenario].color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={scenarios[selectedScenario].color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
                <XAxis 
                  dataKey="date" 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => `${value / 1000}K`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '12px',
                    color: '#fff'
                  }}
                  formatter={(value: any) => formatCurrency(value, orgCurrency)}
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke={scenarios[selectedScenario].color}
                  strokeWidth={3}
                  fill="url(#balanceGradient)"
                  name="Balance"
                />
                <Legend />
                <ReferenceLine
                  y={cashCrunchThreshold}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{
                    value: `Alert Threshold: ${formatCurrency(cashCrunchThreshold, orgCurrency)}`,
                    fill: '#f59e0b',
                    fontSize: 12,
                    position: 'insideTopLeft',
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monthly Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <h3 className="text-xl font-bold text-white mb-4">Monthly Breakdown</h3>
        <div className="space-y-3">
          {monthlyData.map((month: any, idx: number) => (
            <motion.div
              key={month.month}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.55 + idx * 0.05 }}
              className="p-4 rounded-xl"
              style={AXIOM.containers.item}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-semibold">
                      {new Date(month.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </h3>
                    {month.type === 'actual' && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={AXIOM.badges.info}>
                        Actual
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{month.days} days</p>
                </div>
                <span 
                  className="px-3 py-1 rounded-lg text-sm font-medium"
                  style={month.netFlow > 0 ? AXIOM.badges.success : AXIOM.badges.danger}
                >
                  {month.netFlow > 0 ? '+' : ''}{formatCurrency(month.netFlow, orgCurrency)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Income</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatCurrency(month.income, orgCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Expense</p>
                  <p className="text-lg font-bold text-red-400">
                    {formatCurrency(month.expense, orgCurrency)}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
      </>)}

      {/* AI Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.chartBlue}
      >
        <div className="flex items-start gap-3">
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: AXIOM.iconBoxes.blue,
              boxShadow: AXIOM.shadows.iconBlue,
            }}
          >
            <Target className="size-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-white mb-3">AI Insights</p>
            <div className="space-y-2 text-sm text-slate-300">
              {netChange > 0 ? (
                <p>✓ Your cash position is projected to improve by {formatCurrency(netChange, orgCurrency)} over the next {timeRange} days.</p>
              ) : (
                <p>⚠ Your cash position may decrease by {formatCurrency(Math.abs(netChange), orgCurrency)} over the next {timeRange} days.</p>
              )}
              
              {((Number.isFinite(runwayDays) && runwayDays < 90) ||
                (runwayMonths != null && Number.isFinite(runwayMonths) && runwayMonths < 3)) && (
                <p>
                  ⚠ Runway looks tight
                  {Number.isFinite(runwayDays) && runwayDays < 90
                    ? ` (~${Math.round(runwayDays)} days at this burn).`
                    : runwayMonths != null && Number.isFinite(runwayMonths)
                      ? ` (~${runwayMonths} months at monthly burn).`
                      : '.'}{' '}
                  Consider slowing spend or bringing forward income.
                </p>
              )}

              {currentBalance > 0 && lowestBalance < currentBalance * 0.5 && (
                <p>⚠ Your balance may drop to {formatCurrency(lowestBalance, orgCurrency)} (50% of current). Plan for this dip.</p>
              )}
              
              <p>→ Average daily income: {formatCurrency(chartSeries.length ? totalIncome / chartSeries.length : 0, orgCurrency)}</p>
              <p>→ Average daily expense: {formatCurrency(chartSeries.length ? totalExpense / chartSeries.length : 0, orgCurrency)}</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}