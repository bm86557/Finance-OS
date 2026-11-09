import { formatCurrency } from '@/lib/formatters';
import { TrendingUp, Wallet, DollarSign, Plus, Upload, Settings, Users, BarChart3, LayoutDashboard, Activity, Target, Zap, TrendingDown, Calendar, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

// ── Local inline mock data ─────────────────────────────────────────────────
// NOTE: OrganizationDashboard.tsx is the LEGACY dashboard (not routed in App.tsx).
// The active dashboard is OrganizationDashboardModern.tsx.
// Mock data is inlined here to remove the mockData.ts dependency.
// This file should be deleted once OrganizationDashboardModern fully covers all use-cases.
const legacyAnalytics = {
  netWorth: 2940000,
  cashInHand: 125000,
  cashFlow: 450000,
  monthlyProfit: 450000,
  weeklyProfit: 125000,
  yearlyProfit: 4800000,
};
const legacyAccounts = [
  { id: 'acc-1', balance: 850000,  currency: 'PKR' },
  { id: 'acc-2', balance: 12500,   currency: 'USD' },
  { id: 'acc-3', balance: 320000,  currency: 'PKR' },
];
// ──────────────────────────────────────────────────────────────────────────────

import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { QuickAddTransaction } from './QuickAddTransaction';
import { useState } from 'react';
import { NeuralBackground } from './ui/NeuralBackground';
import { HolographicCard } from './ui/HolographicCard';
import { GlassCard } from './ui/GlassCard';
import { DataStreamingEffect } from './ui/DataStreamingEffect';
import { LiquidOrb } from './ui/LiquidOrb';
import { useTheme } from '../../contexts/ThemeContext';

// Timeline Event Component - Same as Dashboard
function TimelineEvent({
  date,
  title,
  amount,
  currency,
  type,
  delay = 0,
  theme = 'light'
}: {
  date: string;
  title: string;
  amount: number;
  currency: string;
  type: 'income' | 'expense';
  delay?: number;
  theme?: 'light' | 'dark';
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5 }}
      className={`relative pl-6 pb-6 border-l-2 ${theme === 'dark' ? 'border-slate-700/50' : 'border-slate-300/50'} last:border-0 last:pb-0`}
    >
      {/* Timeline dot */}
      <div 
        className="absolute left-0 top-0 -translate-x-[9px] w-4 h-4 rounded-full"
        style={{
          background: type === 'income' 
            ? 'linear-gradient(135deg, #10b981, #059669)' 
            : 'linear-gradient(135deg, #ec4899, #db2777)',
          boxShadow: type === 'income'
            ? '0 0 15px rgba(16, 185, 129, 0.6)'
            : '0 0 15px rgba(236, 72, 153, 0.6)',
        }}
      />
      
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'} text-xs mb-1`}>{date}</p>
          <p className={`${theme === 'dark' ? 'text-white' : 'text-slate-900'} font-medium text-sm mb-1`}>{title}</p>
          <p className={`text-xs font-mono ${type === 'income' ? 'text-emerald-400' : 'text-pink-400'}`}>
            {type === 'income' ? '+' : '-'}{formatCurrency(amount, currency)}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// Expandable KPI Card Component - Same as Dashboard
function ExpandableKPICard({
  icon: Icon,
  label,
  value,
  currency,
  percentage,
  trend,
  color,
  sparklineData,
  delay = 0,
  theme = 'dark'
}: {
  icon: any;
  label: string;
  value: number;
  currency: string;
  percentage: string;
  trend: 'up' | 'down';
  color: { from: string; to: string; rgb: string };
  sparklineData: { day: string; value: number; amount: number }[];
  delay?: number;
  theme?: 'light' | 'dark';
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="cursor-pointer"
    >
      {/* Main Card Container - Expands naturally in the flow */}
      <motion.div
        animate={{
          height: isHovered ? '240px' : '120px',
        }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-b-2xl px-6 py-6 overflow-hidden"
        style={{
          background: isHovered 
            ? `linear-gradient(135deg, ${color.rgb}0.15), ${theme === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)'})`
            : theme === 'dark' 
              ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(10, 10, 10, 0.8))'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 252, 0.9))',
          border: `1px solid ${isHovered ? color.from + '40' : theme === 'dark' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.3)'}`,
          boxShadow: isHovered 
            ? `0 20px 60px -20px ${color.from}60`
            : theme === 'dark' ? '0 10px 30px -10px rgba(0, 0, 0, 0.5)' : '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Top Section - Always Visible */}
        <div className="mb-3">
          <p className={`text-xs uppercase tracking-wider mb-3 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</p>
          <p 
            className="text-5xl font-bold"
            style={{
              background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {formatCurrency(value, currency, { compact: true })}
          </p>
        </div>

        {/* Expanded Section - Shows on Hover */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3, delay: isHovered ? 0.1 : 0 }}
        >
          {/* Percentage Change */}
          <div className="flex items-center gap-2 mb-4">
            {trend === 'up' ? (
              <TrendingUp className="w-4 h-4" style={{ color: color.from }} />
            ) : (
              <TrendingDown className="w-4 h-4" style={{ color: color.from }} />
            )}
            <span className="text-sm font-bold" style={{ color: color.from }}>
              {trend === 'up' ? '+' : ''}{percentage}
            </span>
            <span className="text-slate-500 text-xs">vs last week</span>
          </div>

          {/* Sparkline Chart with Real Data - Only render when hovered */}
          {isHovered && (
            <div className="h-20 -mx-2" style={{ minHeight: '80px' }}>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={sparklineData}>
                  <defs>
                    <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color.from} stopOpacity={0.4}/>
                      <stop offset="95%" stopColor={color.from} stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="day" 
                    stroke="rgba(148, 163, 184, 0.3)"
                    style={{ fontSize: '10px' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(0, 0, 0, 0.9)', 
                      border: `1px solid ${color.from}`,
                      borderRadius: '8px',
                      padding: '8px 12px',
                    }}
                    labelStyle={{ color: '#e2e8f0', fontSize: '11px', fontWeight: 600 }}
                    itemStyle={{ color: color.from, fontSize: '11px' }}
                    formatter={(value: any) => formatCurrency(value, currency)}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="amount" 
                    stroke={color.from} 
                    strokeWidth={3}
                    fill={`url(#gradient-${label})`}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function OrganizationDashboard() {
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [visibleProfitLines, setVisibleProfitLines] = useState(new Set(['Revenue', 'Expenses', 'Profit']));
  const [visibleDeptLines, setVisibleDeptLines] = useState(new Set(['Development', 'Design', 'Marketing', 'Sales']));

  const analytics = legacyAnalytics;

  const getProfitByPeriod = () => {
    return analytics.monthlyProfit;
  };

  const totalBalance = legacyAccounts.reduce((sum, acc) => {
    if (acc.currency === 'PKR') return sum + acc.balance;
    if (acc.currency === 'USD') return sum + (acc.balance * 280);
    return sum;
  }, 0);

  // Neon glow profit data
  const profitTrendData = Array.from({ length: 12 }, (_, i) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
    Revenue: 2000000 + Math.sin(i * 0.5) * 300000 + i * 150000,
    Expenses: 1200000 + Math.cos(i * 0.7) * 200000 + i * 100000,
    Profit: 800000 + Math.sin(i * 0.3) * 250000 + i * 80000,
  }));

  const deptPerformanceData = Array.from({ length: 12 }, (_, i) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
    Development: 1800000 + Math.sin(i * 0.4) * 400000 + i * 120000,
    Design: 1400000 + Math.cos(i * 0.6) * 300000 + i * 90000,
    Marketing: 1100000 + Math.sin(i * 0.5) * 250000 + i * 70000,
    Sales: 2100000 + Math.cos(i * 0.3) * 450000 + i * 140000,
  }));

  const profitLines = { lines: ['Revenue', 'Expenses', 'Profit'], colors: ['#10b981', '#f59e0b', '#3b82f6'] };
  const deptLines = { lines: ['Development', 'Design', 'Marketing', 'Sales'], colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981'] };

  // Mock upcoming transactions
  const upcomingPayments = [
    { date: 'Jan 10', title: 'Client Payment - ABC Corp', amount: 850000, currency: 'PKR' },
    { date: 'Jan 15', title: 'Project Milestone - XYZ Ltd', amount: 650000, currency: 'PKR' },
    { date: 'Jan 20', title: 'Consulting Revenue', amount: 320000, currency: 'PKR' },
  ];
  
  const upcomingExpenses = [
    { date: 'Jan 12', title: 'Payroll Processing', amount: 1200000, currency: 'PKR' },
    { date: 'Jan 18', title: 'Software Subscriptions', amount: 45000, currency: 'PKR' },
    { date: 'Jan 25', title: 'Office Rent', amount: 180000, currency: 'PKR' },
  ];
  
  const totalUpcomingPayments = upcomingPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalUpcomingExpenses = upcomingExpenses.reduce((sum, e) => sum + e.amount, 0);

  const { theme } = useTheme();

  return (
    <div 
      className="size-full overflow-auto"
      style={{
        background: theme === 'dark' ? '#0a0a0a' : '#f8fafc',
      }}
    >
      <div className="flex h-full">
        
        {/* Main Content Area */}
        <div className="flex-1 overflow-auto">
          
          {/* Header with Attached Expandable KPI Cards */}
          <div className="sticky top-0 z-20">
            {/* Top Bar */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-8 py-6"
              style={{
                background: theme === 'dark' 
                  ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 10, 10, 0.9) 100%)'
                  : 'linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.9) 100%)',
                borderBottom: `1px solid ${theme === 'dark' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(148, 163, 184, 0.2)'}`,
                backdropFilter: 'blur(20px)',
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h1 
                    className="text-4xl font-bold"
                    style={{
                      background: theme === 'dark' 
                        ? 'linear-gradient(135deg, #ffffff 0%, #a855f7 100%)'
                        : 'linear-gradient(135deg, #1e293b 0%, #a855f7 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    Finance OS
                  </h1>
                  <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} text-xs mt-1`}>Acme Digital Agency • Financial Cockpit</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <div 
                    className="flex items-center gap-2 px-4 py-2 rounded-full"
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    <motion.div 
                      className="w-2 h-2 rounded-full bg-emerald-400"
                      animate={{
                        boxShadow: [
                          '0 0 10px rgba(16, 185, 129, 0.8)',
                          '0 0 20px rgba(16, 185, 129, 1)',
                          '0 0 10px rgba(16, 185, 129, 0.8)',
                        ]
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    <span className="text-emerald-400 text-xs font-medium">LIVE</span>
                  </div>
                  <Button 
                    variant="outline" 
                    className={`${theme === 'dark' ? 'border-white/20 text-white hover:bg-white/10' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                    style={{
                      background: theme === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.5)',
                    }}
                  >
                    <Users className="size-4 mr-2" />
                    Team
                  </Button>
                  <Button 
                    variant="outline" 
                    className={`${theme === 'dark' ? 'border-white/20 text-white hover:bg-white/10' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                    style={{
                      background: theme === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.5)',
                    }}
                  >
                    <Settings className="size-4 mr-2" />
                    Settings
                  </Button>
                </div>
              </div>
            </motion.div>

            {/* Expandable KPI Cards - Same as Dashboard */}
            <div className="grid grid-cols-4 gap-6 px-8 pb-6"
              style={{
                background: theme === 'dark' 
                  ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 10, 10, 0.9) 100%)'
                  : 'linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.9) 100%)',
              }}
            >
              <ExpandableKPICard
                icon={TrendingUp}
                label="Total Balance"
                value={totalBalance}
                currency="PKR"
                percentage="12.5%"
                trend="up"
                color={{ from: '#3b82f6', to: '#2563eb', rgb: 'rgba(59, 130, 246, ' }}
                sparklineData={[
                  { day: 'MON', value: 82, amount: totalBalance * 0.82 },
                  { day: 'TUE', value: 88, amount: totalBalance * 0.88 },
                  { day: 'WED', value: 85, amount: totalBalance * 0.85 },
                  { day: 'THU', value: 92, amount: totalBalance * 0.92 },
                  { day: 'FRI', value: 97, amount: totalBalance * 0.97 },
                  { day: 'SAT', value: 95, amount: totalBalance * 0.95 },
                  { day: 'SUN', value: 100, amount: totalBalance },
                ]}
                delay={0.1}
                theme={theme}
              />
              
              <ExpandableKPICard
                icon={Wallet}
                label="Cash in Hand"
                value={legacyAnalytics.cashInHand}
                currency="PKR"
                percentage="8.2%"
                trend="up"
                color={{ from: '#0ea5e9', to: '#0284c7', rgb: 'rgba(14, 165, 233, ' }}
                sparklineData={[
                  { day: 'MON', value: 65, amount: legacyAnalytics.cashInHand * 0.65 },
                  { day: 'TUE', value: 72, amount: legacyAnalytics.cashInHand * 0.72 },
                  { day: 'WED', value: 70, amount: legacyAnalytics.cashInHand * 0.70 },
                  { day: 'THU', value: 82, amount: legacyAnalytics.cashInHand * 0.82 },
                  { day: 'FRI', value: 88, amount: legacyAnalytics.cashInHand * 0.88 },
                  { day: 'SAT', value: 92, amount: legacyAnalytics.cashInHand * 0.92 },
                  { day: 'SUN', value: 100, amount: legacyAnalytics.cashInHand },
                ]}
                delay={0.2}
                theme={theme}
              />
              
              <ExpandableKPICard
                icon={DollarSign}
                label="Monthly Profit"
                value={getProfitByPeriod()}
                currency="PKR"
                percentage="15.7%"
                trend="up"
                color={{ from: '#60a5fa', to: '#3b82f6', rgb: 'rgba(96, 165, 250, ' }}
                sparklineData={[
                  { day: 'MON', value: 60, amount: getProfitByPeriod() * 0.60 },
                  { day: 'TUE', value: 65, amount: getProfitByPeriod() * 0.65 },
                  { day: 'WED', value: 68, amount: getProfitByPeriod() * 0.68 },
                  { day: 'THU', value: 75, amount: getProfitByPeriod() * 0.75 },
                  { day: 'FRI', value: 85, amount: getProfitByPeriod() * 0.85 },
                  { day: 'SAT', value: 95, amount: getProfitByPeriod() * 0.95 },
                  { day: 'SUN', value: 100, amount: getProfitByPeriod() },
                ]}
                delay={0.3}
                theme={theme}
              />
              
              <ExpandableKPICard
                icon={BarChart3}
                label="Net Worth"
                value={legacyAnalytics.netWorth}
                currency="PKR"
                percentage="12.5%"
                trend="up"
                color={{ from: '#1d4ed8', to: '#1e40af', rgb: 'rgba(29, 78, 216, ' }}
                sparklineData={[
                  { day: 'MON', value: 50, amount: legacyAnalytics.netWorth * 0.50 },
                  { day: 'TUE', value: 62, amount: legacyAnalytics.netWorth * 0.62 },
                  { day: 'WED', value: 70, amount: legacyAnalytics.netWorth * 0.70 },
                  { day: 'THU', value: 78, amount: legacyAnalytics.netWorth * 0.78 },
                  { day: 'FRI', value: 88, amount: legacyAnalytics.netWorth * 0.88 },
                  { day: 'SAT', value: 95, amount: legacyAnalytics.netWorth * 0.95 },
                  { day: 'SUN', value: 100, amount: legacyAnalytics.netWorth },
                ]}
                delay={0.4}
                theme={theme}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 px-8 pt-8">
            <Button 
              onClick={() => setQuickAddOpen(true)}
              className="h-16 bg-blue-600 hover:bg-blue-700 text-white justify-start px-6"
            >
              <Plus className="size-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Quick Add</div>
                <div className="text-xs opacity-90">Add expense or income</div>
              </div>
            </Button>
            
            <Button 
              onClick={() => navigate('/organization/workspace')}
              className="h-16 bg-purple-600 hover:bg-purple-700 text-white justify-start px-6"
            >
              <Upload className="size-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Import Statement</div>
                <div className="text-xs opacity-90">Upload bank statement</div>
              </div>
            </Button>

            <Button 
              onClick={() => navigate('/profit-intelligence')}
              className="h-16 bg-green-600 hover:bg-green-700 text-white justify-start px-6"
            >
              <BarChart3 className="size-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Profit Intelligence</div>
                <div className="text-xs opacity-90">Analyze profitability</div>
              </div>
            </Button>
          </div>

          {/* Neon Glow Charts - CONSISTENT DESIGN */}
          <div className="px-8 pb-8 space-y-6">
            {/* Profit Trend - Neon Glow Lines */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="mb-8">
                  <h3 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} mb-1`}>Profit Trend</h3>
                  <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} text-sm`}>Revenue, Expenses & Profit Analysis</p>
                </div>
                
                <div className="h-96 mb-6" style={{ minHeight: '384px' }}>
                  <ResponsiveContainer width="100%" height={384}>
                    <LineChart data={profitTrendData}>
                      <defs>
                        {profitLines.lines.map((line, idx) => (
                          <filter key={`glow-${line}`} id={`neon-glow-${line}`}>
                            <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
                            <feMerge>
                              <feMergeNode in="coloredBlur"/>
                              <feMergeNode in="coloredBlur"/>
                              <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                          </filter>
                        ))}
                      </defs>
                      
                      <CartesianGrid 
                        strokeDasharray="3 3" 
                        stroke="rgba(148, 163, 184, 0.05)" 
                        vertical={false}
                      />
                      <XAxis 
                        dataKey="month" 
                        stroke="rgba(148, 163, 184, 0.3)"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="rgba(148, 163, 184, 0.3)"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(10, 5, 20, 0.95)', 
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          backdropFilter: 'blur(20px)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
                        }}
                        labelStyle={{ 
                          color: '#e2e8f0', 
                          fontWeight: 600, 
                          marginBottom: '8px',
                          fontSize: '13px'
                        }}
                        itemStyle={{
                          color: '#94a3b8',
                          fontSize: '12px'
                        }}
                      />
                      
                      {profitLines.lines.map((line, idx) => (
                        <Line
                          key={line}
                          type="monotone"
                          dataKey={line}
                          stroke={profitLines.colors[idx]}
                          strokeWidth={visibleProfitLines.has(line) ? 4 : 0}
                          dot={false}
                          filter={`url(#neon-glow-${line})`}
                          animationDuration={2000}
                          style={{
                            opacity: visibleProfitLines.has(line) ? 1 : 0,
                            transition: 'all 0.5s ease',
                          }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-wrap gap-3">
                  {profitLines.lines.map((line, idx) => (
                    <motion.button
                      key={line}
                      onClick={() => {
                        const newVisible = new Set(visibleProfitLines);
                        if (newVisible.has(line)) {
                          newVisible.delete(line);
                        } else {
                          newVisible.add(line);
                        }
                        setVisibleProfitLines(newVisible);
                      }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2"
                      style={{
                        background: visibleProfitLines.has(line) 
                          ? `linear-gradient(135deg, ${profitLines.colors[idx]}30, ${profitLines.colors[idx]}20)`
                          : 'rgba(0, 0, 0, 0.3)',
                        border: `1px solid ${visibleProfitLines.has(line) ? profitLines.colors[idx] : 'rgba(148, 163, 184, 0.2)'}`,
                        color: visibleProfitLines.has(line) ? '#ffffff' : '#64748b',
                      }}
                    >
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{
                          background: profitLines.colors[idx],
                          boxShadow: visibleProfitLines.has(line) ? `0 0 10px ${profitLines.colors[idx]}` : 'none',
                        }}
                      />
                      {line}
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Department Performance - Neon Glow Lines */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(16, 185, 129, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark'
                  ? '0 20px 60px -20px rgba(16, 185, 129, 0.5)'
                  : '0 10px 30px -10px rgba(16, 185, 129, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="mb-8">
                  <h3 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} mb-1`}>Department Performance</h3>
                  <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} text-sm`}>Revenue by department over time</p>
                </div>
                
                <div className="h-96 mb-6">
                  <ResponsiveContainer width="100%" height={384}>
                    <LineChart data={deptPerformanceData}>
                      <defs>
                        {deptLines.lines.map((line, idx) => (
                          <filter key={`glow-${line}`} id={`neon-glow-dept-${line}`}>
                            <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
                            <feMerge>
                              <feMergeNode in="coloredBlur"/>
                              <feMergeNode in="coloredBlur"/>
                              <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                          </filter>
                        ))}
                      </defs>
                      
                      <CartesianGrid 
                        strokeDasharray="3 3" 
                        stroke="rgba(148, 163, 184, 0.05)" 
                        vertical={false}
                      />
                      <XAxis 
                        dataKey="month" 
                        stroke="rgba(148, 163, 184, 0.3)"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="rgba(148, 163, 184, 0.3)"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(10, 5, 20, 0.95)', 
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          backdropFilter: 'blur(20px)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
                        }}
                        labelStyle={{ 
                          color: '#e2e8f0', 
                          fontWeight: 600, 
                          marginBottom: '8px',
                          fontSize: '13px'
                        }}
                        itemStyle={{
                          color: '#94a3b8',
                          fontSize: '12px'
                        }}
                      />
                      
                      {deptLines.lines.map((line, idx) => (
                        <Line
                          key={line}
                          type="monotone"
                          dataKey={line}
                          stroke={deptLines.colors[idx]}
                          strokeWidth={visibleDeptLines.has(line) ? 4 : 0}
                          dot={false}
                          filter={`url(#neon-glow-dept-${line})`}
                          animationDuration={2000}
                          style={{
                            opacity: visibleDeptLines.has(line) ? 1 : 0,
                            transition: 'all 0.5s ease',
                          }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-wrap gap-3">
                  {deptLines.lines.map((line, idx) => (
                    <motion.button
                      key={line}
                      onClick={() => {
                        const newVisible = new Set(visibleDeptLines);
                        if (newVisible.has(line)) {
                          newVisible.delete(line);
                        } else {
                          newVisible.add(line);
                        }
                        setVisibleDeptLines(newVisible);
                      }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2"
                      style={{
                        background: visibleDeptLines.has(line) 
                          ? `linear-gradient(135deg, ${deptLines.colors[idx]}30, ${deptLines.colors[idx]}20)`
                          : 'rgba(0, 0, 0, 0.3)',
                        border: `1px solid ${visibleDeptLines.has(line) ? deptLines.colors[idx] : 'rgba(148, 163, 184, 0.2)'}`,
                        color: visibleDeptLines.has(line) ? '#ffffff' : '#64748b',
                      }}
                    >
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{
                          background: deptLines.colors[idx],
                          boxShadow: visibleDeptLines.has(line) ? `0 0 10px ${deptLines.colors[idx]}` : 'none',
                        }}
                      />
                      {line}
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Timeline Sidebar - CONSISTENT ACROSS ALL PAGES */}
        <motion.div
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="w-96 p-8 overflow-auto"
          style={{
            background: theme === 'dark'
              ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(0, 0, 0, 0.5) 100%)'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(248, 250, 252, 0.95) 100%)',
            borderLeft: theme === 'dark' 
              ? '1px solid rgba(148, 163, 184, 0.1)'
              : '1px solid rgba(148, 163, 184, 0.2)',
          }}
        >
          {/* Timeline Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div 
                className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center"
                style={{
                  boxShadow: '0 10px 30px -10px rgba(236, 72, 153, 0.6)',
                }}
              >
                <Calendar className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Upcoming</h2>
                <p className="text-slate-400 text-sm">Next 30 days</p>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div 
                className="p-4 rounded-xl"
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                }}
              >
                <p className="text-emerald-400 text-xs mb-1 uppercase tracking-wider">Payments</p>
                <p className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{formatCurrency(totalUpcomingPayments, 'PKR', { compact: true })}</p>
              </div>
              <div 
                className="p-4 rounded-xl"
                style={{
                  background: 'rgba(236, 72, 153, 0.1)',
                  border: '1px solid rgba(236, 72, 153, 0.2)',
                }}
              >
                <p className="text-pink-400 text-xs mb-1 uppercase tracking-wider">Expenses</p>
                <p className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{formatCurrency(totalUpcomingExpenses, 'PKR', { compact: true })}</p>
              </div>
            </div>
          </div>

          {/* Upcoming Payments Section */}
          <div className="mb-8">
            <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              <div className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 10px rgba(16, 185, 129, 0.6)' }} />
              Upcoming Payments
            </h3>
            <div className="space-y-0">
              {upcomingPayments.map((event, idx) => (
                <TimelineEvent
                  key={idx}
                  date={event.date}
                  title={event.title}
                  amount={event.amount}
                  currency={event.currency}
                  type="income"
                  delay={0.6 + idx * 0.05}
                  theme={theme}
                />
              ))}
            </div>
          </div>

          {/* Upcoming Expenses Section */}
          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-pink-400" style={{ boxShadow: '0 0 10px rgba(236, 72, 153, 0.6)' }} />
              Upcoming Expenses
            </h3>
            <div className="space-y-0">
              {upcomingExpenses.map((event, idx) => (
                <TimelineEvent
                  key={idx}
                  date={event.date}
                  title={event.title}
                  amount={event.amount}
                  currency={event.currency}
                  type="expense"
                  delay={0.75 + idx * 0.05}
                  theme={theme}
                />
              ))}
            </div>
          </div>

          {/* View All Button */}
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="w-full mt-6 px-6 py-4 rounded-xl text-white font-medium flex items-center justify-center gap-2 group"
            style={{
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))',
              border: '1px solid rgba(168, 85, 247, 0.3)',
            }}
          >
            View All Transactions
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </motion.button>
        </motion.div>

      </div>
      {quickAddOpen && <QuickAddTransaction open={quickAddOpen} onOpenChange={setQuickAddOpen} />}
    </div>
  );
}