import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { convertCurrency } from '@/lib/currencyUtils';
import { dashboardFallbackAnalytics } from '@/lib/dashboardFallbackAnalytics';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  CreditCard,
  Building2,
  Calendar,
  ArrowRight,
  TrendingDown as TrendDown,
  BarChart3,
  Wallet,
  Banknote,
  Smartphone,
  X,
  PanelRightClose,
} from 'lucide-react';
import { SmartCategorizationPrompts } from './SmartCategorizationPrompts';
import { ModernKPICard } from '../ModernKPICard';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Area, 
  AreaChart,
  ComposedChart,
  Bar,
  Legend
} from 'recharts';
import { useTheme } from '../../../contexts/ThemeContext';
import { AXIOM } from '../../../styles/axiom-tokens';
import { PageHeader } from '../layout';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';

type ProfitPeriod = 'weekly' | 'monthly' | 'yearly';
type TimePeriod = '1W' | '1M' | '3M' | '6M' | '1Y';
type ProfitDimension = 'Departments' | 'Projects' | 'Clients' | 'Overhead' | 'What If' | 'Business vs Personal' | 'Per Sq Ft';

// Horizontal Progress Bar with Icon
function HorizontalProgressBar({
  icon: Icon,
  label,
  value,
  maxValue,
  currency,
  color,
  delay = 0,
  theme = 'dark'
}: {
  icon: any;
  label: string;
  value: number;
  maxValue: number;
  currency: string;
  color: string;
  delay?: number;
  theme?: 'light' | 'dark';
}) {
  const percent = Math.min((value / maxValue) * 100, 100);
  
  const colorMap: Record<string, string> = {
    purple: 'from-purple-500 via-purple-400 to-purple-500',
    cyan: 'from-cyan-500 via-cyan-400 to-cyan-500',
    pink: 'from-pink-500 via-pink-400 to-pink-500',
    green: 'from-emerald-500 via-emerald-400 to-emerald-500',
    yellow: 'from-amber-500 via-amber-400 to-amber-500',
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.6 }}
      className="flex items-center gap-4 p-4 rounded-2xl"
      style={{
        background: theme === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.5)',
        border: theme === 'dark' ? '1px solid rgba(148, 163, 184, 0.1)' : '1px solid rgba(148, 163, 184, 0.2)',
      }}
    >
      {/* Icon */}
      <div 
        className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colorMap[color] || colorMap.purple} flex items-center justify-center flex-shrink-0`}
        style={{
          boxShadow: `0 8px 20px -8px ${color === 'purple' ? 'rgba(168, 85, 247, 0.6)' : 'rgba(0, 0, 0, 0.4)'}`,
        }}
      >
        <Icon className="w-6 h-6 text-white" />
      </div>
      
      {/* Progress bar */}
      <div className="flex-1">
        <div className="flex items-center justify-between mb-2">
          <span className={`font-medium text-sm ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{label}</span>
          <span className="text-slate-400 text-xs">{currency}</span>
        </div>
        
        <div 
          className="h-3 rounded-full overflow-hidden"
          style={{
            background: theme === 'dark' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(148, 163, 184, 0.2)',
          }}
        >
          <motion.div
            className={`h-full bg-gradient-to-r ${colorMap[color]}`}
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 1.5, delay: delay + 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{
              boxShadow: `0 0 20px ${color === 'purple' ? 'rgba(168, 85, 247, 0.6)' : 'rgba(0, 0, 0, 0.4)'}`,
            }}
          />
        </div>
      </div>
      
      {/* Value */}
      <div className="text-right flex-shrink-0 w-32">
        <p className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
          {formatCurrency(value, currency, { compact: true })}
        </p>
        <p className="text-slate-500 text-xs">
          {percent.toFixed(0)}%
        </p>
      </div>
    </motion.div>
  );
}

// Expandable KPI Card Component
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

// Timeline Event Component
function TimelineEvent({
  date,
  title,
  amount,
  currency,
  type,
  delay = 0,
  theme = 'dark',
  isMasked = false
}: {
  date: string;
  title: string;
  amount: number;
  currency: string;
  type: 'income' | 'expense';
  delay?: number;
  theme?: 'light' | 'dark';
  isMasked?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="relative pl-6 pb-6 last:border-0 last:pb-0"
      style={{
        borderLeft: '2px solid rgba(59, 130, 246, 0.3)',
      }}
    >
      {/* Timeline dot */}
      <div 
        className="absolute left-0 top-0 -translate-x-[9px] w-4 h-4 rounded-full"
        style={{
          background: type === 'income' 
            ? 'linear-gradient(135deg, #10b981, #059669)' 
            : 'linear-gradient(135deg, #ef4444, #dc2626)',
          boxShadow: type === 'income'
            ? '0 0 15px rgba(16, 185, 129, 0.6)'
            : '0 0 15px rgba(239, 68, 68, 0.6)',
        }}
      />
      
      <div className="flex items-start justify-between gap-4">
        <div>
          <p 
            className="text-xs mb-1 font-medium"
            style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}
          >
            {date}
          </p>
          <p className={`font-medium text-sm mb-1 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{title}</p>
          <p className={`text-xs font-mono font-semibold ${type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
            {isMasked ? '•••••• (Confidential)' : `${type === 'income' ? '+' : '-'}${formatCurrency(amount, currency)}`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

type UpcomingLine = { date: string; title: string; amount: number; currency: string; isMasked?: boolean };

function upcomingPanelSurface(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? 'linear-gradient(135deg, rgba(15, 30, 60, 0.3) 0%, rgba(10, 10, 10, 0.5) 100%)'
    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)';
}

/** Shared Upcoming (payments / expenses) panel — desktop column or mobile drawer */
function UpcomingPanelContent({
  theme,
  totalUpcomingPayments,
  totalUpcomingExpenses,
  upcomingPayments,
  upcomingExpenses,
  goToOrgView,
  onDismiss,
  dismissStyle = 'close',
  currency = 'USD',
}: {
  theme: 'light' | 'dark';
  totalUpcomingPayments: number;
  totalUpcomingExpenses: number;
  upcomingPayments: UpcomingLine[];
  upcomingExpenses: UpcomingLine[];
  goToOrgView?: (view: string) => void;
  onDismiss?: () => void;
  dismissStyle?: 'close' | 'collapse';
  currency?: string;
}) {
  return (
    <>
      <div className="mb-8 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
            }}
          >
            <Calendar className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Upcoming</h2>
            <p className="text-sm" style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}>
              Next 30 days
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={`shrink-0 rounded-xl p-2.5 min-h-11 min-w-11 flex items-center justify-center border transition-colors touch-manipulation ${
              theme === 'dark'
                ? 'border-slate-600/60 text-slate-300 hover:bg-slate-800/80'
                : 'border-slate-300/80 text-slate-600 hover:bg-slate-100'
            }`}
            aria-label={dismissStyle === 'collapse' ? 'Hide upcoming panel' : 'Close upcoming panel'}
          >
            {dismissStyle === 'collapse' ? (
              <PanelRightClose className="w-5 h-5" />
            ) : (
              <X className="w-5 h-5" />
            )}
          </button>
        )}
      </div>

      <div className="mb-8">
        <div className="grid grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
            whileHover={{ scale: 1.02, y: -2 }}
            className="p-4 rounded-xl"
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '2px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            <p className="text-emerald-400 text-xs mb-1 uppercase tracking-wider font-bold">Payments</p>
            <p className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              {formatCurrency(totalUpcomingPayments, currency, { compact: true })}
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.08 }}
            whileHover={{ scale: 1.02, y: -2 }}
            className="p-4 rounded-xl"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '2px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <p className="text-red-400 text-xs mb-1 uppercase tracking-wider font-bold">Expenses</p>
            <p className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              {formatCurrency(totalUpcomingExpenses, currency, { compact: true })}
            </p>
          </motion.div>
        </div>
      </div>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: '0 8px 20px -8px rgba(16, 185, 129, 0.8)',
            }}
          >
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              Upcoming Payments
            </h3>
            <p className="text-xs" style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}>
              Expected incoming revenue
            </p>
          </div>
        </div>
        <div className="space-y-0">
          {upcomingPayments.length > 0 ? (
            upcomingPayments.map((event, idx) => (
              <TimelineEvent
                key={`pay-${idx}`}
                date={event.date}
                title={event.title}
                amount={event.amount}
                currency={event.currency}
                type="income"
                delay={0.05 + idx * 0.05}
                theme={theme}
              />
            ))
          ) : (
            <p className="text-xs text-slate-500 italic py-2 pl-2">No incoming payments scheduled for next 30 days.</p>
          )}
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              boxShadow: '0 8px 20px -8px rgba(239, 68, 68, 0.8)',
            }}
          >
            <TrendDown className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              Upcoming Expenses
            </h3>
            <p className="text-xs" style={{ color: theme === 'dark' ? '#64748b' : '#94a3b8' }}>
              Scheduled outgoing payments
            </p>
          </div>
        </div>
        <div className="space-y-0">
          {upcomingExpenses.length > 0 ? (
            upcomingExpenses.map((event, idx) => (
              <TimelineEvent
                key={`exp-${idx}`}
                date={event.date}
                title={event.title}
                amount={event.amount}
                currency={event.currency}
                type="expense"
                delay={0.1 + idx * 0.05}
                theme={theme}
                isMasked={event.isMasked}
              />
            ))
          ) : (
            <p className="text-xs text-slate-500 italic py-2 pl-2">No outgoing expenses scheduled for next 30 days.</p>
          )}
        </div>
      </div>

      <motion.button
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        className="w-full mt-6 px-6 py-4 rounded-xl font-bold flex items-center justify-center gap-2 group min-h-11 touch-manipulation"
        style={{
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
          border: '2px solid rgba(59, 130, 246, 0.5)',
          color: '#ffffff',
          boxShadow: '0 8px 24px -8px rgba(59, 130, 246, 0.6)',
        }}
        onClick={() => {
          goToOrgView?.('transactions');
        }}
      >
        View All Transactions
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </motion.button>
    </>
  );
}

// Profit Intelligence Neon Graph Component
function ProfitIntelligenceGraph({ currency, chartData }: { currency?: string; chartData?: any }) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1Y');
  const [visibleLines, setVisibleLines] = useState<Set<string>>(
    new Set(['Net Profit', 'Revenue', 'Expenses'])
  );
  const { theme } = useTheme();
  const { currentOrganization } = useAuth();
  const orgCurrency = currency || currentOrganization?.currency || 'USD';
  
  const defaultMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const profitDimensions = useMemo(() => {
    const profitList = chartData?.profitData || [];
    const deptList = chartData?.departmentData || [];
    
    // Extract unique department names from departmentData
    const deptKeys: string[] = [];
    if (Array.isArray(deptList) && deptList.length > 0) {
      Object.keys(deptList[0]).forEach(k => {
        if (k !== 'name' && !deptKeys.includes(k)) deptKeys.push(k);
      });
    }

    const lines = ['Net Profit', 'Revenue', 'Expenses', ...deptKeys];
    const colors = ['#3b82f6', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899'];

    const listToMap = Array.isArray(profitList) && profitList.length > 0 ? profitList : defaultMonths.map(m => ({ name: m }));
    const data = listToMap.map((p: any, i: number) => {
      const m = p.name || p.month || defaultMonths[i] || `M${i + 1}`;
      const d = deptList[i] || {};
      const row: Record<string, any> = {
        month: m,
        'Net Profit': p.Profit ?? p['Net Profit'] ?? 0,
        Revenue: p.Revenue ?? 0,
        Expenses: p.Expenses ?? 0,
      };
      deptKeys.forEach(dk => {
        row[dk] = d[dk] ?? 0;
      });
      return row;
    });

    return { lines, colors, data };
  }, [chartData]);

  const displayedData = useMemo(() => {
    const full = profitDimensions.data;
    const tail = (n: number) => full.slice(Math.max(0, full.length - n));
    switch (timePeriod) {
      case '1W': {
        const weekly = (chartData as any)?.weeklyProfitData;
        if (Array.isArray(weekly) && weekly.length > 0) {
          return weekly.map((w: any) => ({
            month: w.name || w.month || '',
            'Net Profit': w['Net Profit'] ?? w.Profit ?? 0,
            Revenue: w.Revenue ?? 0,
            Expenses: w.Expenses ?? 0,
          }));
        }
        return tail(2);
      }
      case '1M':
        return tail(1);
      case '3M':
        return tail(3);
      case '6M':
        return tail(6);
      case '1Y':
      default:
        return full;
    }
  }, [profitDimensions.data, timePeriod, chartData]);

  const toggleLine = (line: string) => {
    const newVisible = new Set(visibleLines);
    if (newVisible.has(line)) {
      if (newVisible.size > 1) {
        newVisible.delete(line);
      }
    } else {
      newVisible.add(line);
    }
    setVisibleLines(newVisible);
  };
  
  const showAll = () => {
    setVisibleLines(new Set(profitDimensions.lines));
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl relative overflow-hidden"
      style={{
        background: theme === 'dark' 
          ? 'linear-gradient(135deg, rgba(15, 30, 60, 0.4) 0%, rgba(5, 10, 30, 0.6) 100%)'
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
        border: theme === 'dark' 
          ? '1px solid rgba(59, 130, 246, 0.2)'
          : '1px solid rgba(59, 130, 246, 0.15)',
        boxShadow: theme === 'dark'
          ? '0 20px 60px -20px rgba(59, 130, 246, 0.4)'
          : '0 10px 40px -10px rgba(59, 130, 246, 0.15)',
      }}
    >
      {/* Animated gradient orbs */}
      <motion.div 
        className="pointer-events-none absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl opacity-20"
        style={{
          background: 'radial-gradient(circle, #3b82f6, transparent 70%)',
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.2, 0.3, 0.2],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div 
        className="pointer-events-none absolute bottom-0 left-0 w-96 h-96 rounded-full blur-3xl opacity-20"
        style={{
          background: 'radial-gradient(circle, #06b6d4, transparent 70%)',
        }}
        animate={{
          scale: [1.2, 1, 1.2],
          opacity: [0.3, 0.2, 0.3],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
      
      <div className="relative z-10">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-6 lg:mb-8">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div 
              className="p-3 rounded-xl flex items-center justify-center relative overflow-hidden group"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
              }}
            >
              <div 
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-30 transform -skew-x-12 group-hover:translate-x-full transition-all duration-1000"
              />
              <BarChart3 className="w-6 h-6 text-white relative z-10" />
            </div>
            <div>
              <h2 
                className="text-lg sm:text-2xl font-bold mb-1"
                style={{
                  color: theme === 'dark' ? '#ffffff' : '#1e293b',
                }}
              >
                Profit Intelligence
              </h2>
              <p 
                className="text-sm"
                style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
              >
                Multi-dimensional profit analysis • Real-time insights
              </p>
            </div>
          </div>
          
          {/* Time Period Toggles */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-2 p-1 rounded-xl w-full lg:w-auto justify-start lg:justify-end" style={{
            background: theme === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.5)',
            border: theme === 'dark' ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(148, 163, 184, 0.2)',
          }}>
            {(['1W', '1M', '3M', '6M', '1Y'] as TimePeriod[]).map((period) => (
              <motion.button
                key={period}
                onClick={() => setTimePeriod(period)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold transition-all"
                style={{
                  background: timePeriod === period
                    ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                    : 'transparent',
                  color: timePeriod === period 
                    ? '#ffffff'
                    : theme === 'dark' ? '#94a3b8' : '#64748b',
                  boxShadow: timePeriod === period
                    ? '0 4px 12px -2px rgba(59, 130, 246, 0.5)'
                    : 'none',
                }}
              >
                {period}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Modern Graph with Gradient Background */}
        <div 
          className="relative p-3 sm:p-6 rounded-xl sm:rounded-2xl mb-4 sm:mb-6 h-[240px] sm:h-[300px] md:h-[360px] lg:h-[400px]"
          style={{ 
            background: theme === 'dark' 
              ? 'rgba(0, 0, 0, 0.2)'
              : 'rgba(255, 255, 255, 0.5)',
            border: theme === 'dark'
              ? '1px solid rgba(148, 163, 184, 0.1)'
              : '1px solid rgba(148, 163, 184, 0.15)',
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayedData}>
              <defs>
                {profitDimensions.lines.map((line: string, idx: number) => {
                  const clr = profitDimensions.colors[idx % profitDimensions.colors.length];
                  return (
                    <linearGradient key={`gradient-${line}`} id={`area-gradient-${line}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={clr} stopOpacity={0.6}/>
                      <stop offset="95%" stopColor={clr} stopOpacity={0.02}/>
                    </linearGradient>
                  );
                })}
              </defs>
              
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.14)'}
                vertical={false}
              />
              <XAxis 
                dataKey="month" 
                stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'}
                style={{ fontSize: '12px', fontWeight: 600 }}
                tickLine={false}
                axisLine={{ stroke: theme === 'dark' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.3)' }}
              />
              <YAxis 
                stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'}
                style={{ fontSize: '12px', fontWeight: 600 }}
                tickLine={false}
                axisLine={{ stroke: theme === 'dark' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.3)' }}
                tickFormatter={(value) => formatCurrency(value, orgCurrency, { compact: true })}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: theme === 'dark' ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)', 
                  border: `2px solid ${theme === 'dark' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.3)'}`,
                  backdropFilter: 'blur(20px)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
                }}
                labelStyle={{ 
                  color: theme === 'dark' ? '#ffffff' : '#1e293b', 
                  fontWeight: 700, 
                  marginBottom: '8px',
                  fontSize: '13px'
                }}
                itemStyle={{
                  color: theme === 'dark' ? '#94a3b8' : '#64748b',
                  fontSize: '12px',
                  fontWeight: 600
                }}
                formatter={(value: any) => [formatCurrency(Number(value) || 0, orgCurrency, { compact: true }), '']}
              />
              
              {profitDimensions.lines.map((line: string, idx: number) => {
                const clr = profitDimensions.colors[idx % profitDimensions.colors.length];
                return visibleLines.has(line) && (
                  <Area
                    key={line}
                    type="monotone"
                    dataKey={line}
                    stroke={clr}
                    strokeWidth={3}
                    fill={`url(#area-gradient-${line})`}
                    dot={{ 
                      fill: clr, 
                      r: 4,
                      strokeWidth: 2,
                      stroke: theme === 'dark' ? '#0a0a0a' : '#ffffff'
                    }}
                    activeDot={{ 
                      r: 6, 
                      fill: clr,
                      stroke: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                      strokeWidth: 3
                    }}
                    animationDuration={1500}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Line Toggles - Modern Pill Design */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {profitDimensions.lines.map((line: string, idx: number) => {
              const clr = profitDimensions.colors[idx % profitDimensions.colors.length];
              return (
                <motion.button
                  key={line}
                  onClick={() => toggleLine(line)}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2.5"
                  style={{
                    background: visibleLines.has(line) 
                      ? `linear-gradient(135deg, ${clr}, ${clr}dd)`
                      : theme === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.6)',
                    border: `2px solid ${visibleLines.has(line) ? clr : theme === 'dark' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.25)'}`,
                    color: visibleLines.has(line) ? '#ffffff' : theme === 'dark' ? '#64748b' : '#94a3b8',
                    boxShadow: visibleLines.has(line) ? `0 4px 16px -4px ${clr}80` : 'none',
                  }}
                >
                  <div 
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                      background: clr,
                      boxShadow: visibleLines.has(line) ? `0 0 8px ${clr}` : 'none',
                    }}
                  />
                  {line}
                </motion.button>
              );
            })}
          </div>
          
          <motion.button
            onClick={showAll}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-6 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              border: '2px solid rgba(59, 130, 246, 0.5)',
              color: '#ffffff',
              boxShadow: '0 4px 16px -4px rgba(59, 130, 246, 0.6)',
            }}
          >
            Show All
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function safeFinite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function OrgDashboard() {
  const [profitPeriod, setProfitPeriod] = useState<ProfitPeriod>('monthly');
  const [desktopUpcomingOpen, setDesktopUpcomingOpen] = useState(true);
  const [mobileUpcomingOpen, setMobileUpcomingOpen] = useState(false);
  const analytics = dashboardFallbackAnalytics;
  const { theme } = useTheme();
  const { currentOrganization, userRole, accessRole } = useAuth();
  const canViewPayroll = userRole === 'owner' || userRole === 'admin' || accessRole === 'org_admin';
  const orgCurrency = currentOrganization?.currency || 'USD';
  const goToOrgView = useOrgWorkspaceNav();

  useEffect(() => {
    if (!mobileUpcomingOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileUpcomingOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileUpcomingOpen]);

  useEffect(() => {
    if (!mobileUpcomingOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileUpcomingOpen]);

  // ── Service wiring (ORG-P01: never assume non-null; empty-safe arrays via useServiceArray) ──
  const svc = useOrgServices();
  const {
    data: bankAccounts,
    loading: accountsLoading,
    error: accountsError,
    refetch: refetchAccounts,
  } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts', 'transactions'],
  );
  const {
    data: dashboardKPIs,
    loading: kpisLoading,
    error: kpisError,
    refetch: refetchKpis,
  } = useService(
    () => svc.reports.getDashboardSummary(),
    [svc.orgId],
    ['bankAccounts', 'transactions', 'budgets', 'recurringTransactions'],
  );

  const refreshDashboardData = () => {
    void refetchAccounts();
    void refetchKpis();
  };

  const getProfitByPeriod = (): number => {
    switch (profitPeriod) {
      case 'weekly':
        return safeFinite(dashboardKPIs?.weeklyProfit, 0);
      case 'monthly':
        return safeFinite(dashboardKPIs?.monthlyProfit, 0);
      case 'yearly':
        return safeFinite(dashboardKPIs?.yearlyProfit ?? dashboardKPIs?.netProfit, 0);
    }
  };

  const getProfitPercentageByPeriod = (): string => {
    let change: number | null | undefined = null;
    switch (profitPeriod) {
      case 'weekly':
        change = dashboardKPIs?.weeklyProfitChange;
        break;
      case 'monthly':
        change = dashboardKPIs?.monthlyProfitChange ?? dashboardKPIs?.profitChange;
        break;
      case 'yearly':
        change = dashboardKPIs?.yearlyProfitChange;
        break;
    }
    if (change == null) return '—';
    return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  };

  // Separate physical cash accounts from digital bank/wallet accounts
  const physicalCashAccounts = bankAccounts.filter(acc => acc.accountType === 'cash');
  const digitalBankAccounts = bankAccounts.filter(
    acc => acc.accountType !== 'cash' && acc.accountType !== 'credit_card' && acc.accountType !== 'line_of_credit'
  );

  // Normalize balances against organization base currency
  const physicalCashBalanceBase = physicalCashAccounts.reduce(
    (sum, acc) => sum + convertCurrency(safeFinite(acc.balance, 0), acc.currency || orgCurrency, orgCurrency),
    0
  );
  const digitalBankBalanceBase = digitalBankAccounts.reduce(
    (sum, acc) => sum + convertCurrency(safeFinite(acc.balance, 0), acc.currency || orgCurrency, orgCurrency),
    0
  );
  const creditLiabilities = bankAccounts
    .filter(acc => acc.accountType === 'credit_card' || acc.accountType === 'line_of_credit')
    .reduce((sum, acc) => sum + Math.abs(convertCurrency(safeFinite(acc.balance, 0), acc.currency || orgCurrency, orgCurrency)), 0);

  const netAccountBalance = digitalBankBalanceBase + physicalCashBalanceBase - creditLiabilities;

  const totalBalance =
    dashboardKPIs?.totalBankBalanceBase != null
      ? safeFinite(dashboardKPIs.totalBankBalanceBase, 0)
      : bankAccounts.length > 0
      ? safeFinite(netAccountBalance, analytics.netWorth)
      : analytics.netWorth;

  const netWorthDisplay =
    dashboardKPIs?.netWorth != null
      ? safeFinite(dashboardKPIs.netWorth, totalBalance)
      : dashboardKPIs != null
        ? safeFinite(
            safeFinite(dashboardKPIs.cashOnHand, 0) +
              safeFinite(dashboardKPIs.accountsReceivable, 0) -
              Math.abs(safeFinite(dashboardKPIs.accountsPayable, 0)),
            analytics.netWorth,
          )
        : totalBalance;

  const cashOnHand =
    dashboardKPIs?.cashOnHand != null
      ? safeFinite(dashboardKPIs.cashOnHand, 0)
      : physicalCashBalanceBase;
  const monthlyProfitDisplay = safeFinite(getProfitByPeriod(), analytics.monthlyProfit);

  const profitLabel =
    profitPeriod === 'weekly'
      ? 'Weekly Profit'
      : profitPeriod === 'yearly'
        ? 'Yearly Profit'
        : 'Monthly Profit';

  // Real upcoming transactions with RBAC payroll confidentiality
  const upcomingPayments = useMemo(() => {
    if (!dashboardKPIs?.upcomingPayments || dashboardKPIs.upcomingPayments.length === 0) {
      return [];
    }
    return dashboardKPIs.upcomingPayments.map((p: any) => {
      const isPayroll =
        /payroll|salary|wage/i.test(p.title || '') ||
        /payroll|salary|wage/i.test(p.category || '');
      if (isPayroll && !canViewPayroll) {
        return {
          ...p,
          title: 'Team Payroll (Confidential)',
          amount: 0,
          isMasked: true,
        };
      }
      return p;
    });
  }, [dashboardKPIs?.upcomingPayments, canViewPayroll]);

  const upcomingExpenses = useMemo(() => {
    if (!dashboardKPIs?.upcomingExpenses || dashboardKPIs.upcomingExpenses.length === 0) {
      return [];
    }
    return dashboardKPIs.upcomingExpenses.map((e: any) => {
      const isPayroll =
        /payroll|salary|wage/i.test(e.title || '') ||
        /payroll|salary|wage/i.test(e.category || '');
      if (isPayroll && !canViewPayroll) {
        return {
          ...e,
          title: 'Team Payroll (Confidential)',
          amount: 0,
          isMasked: true,
        };
      }
      return e;
    });
  }, [dashboardKPIs?.upcomingExpenses, canViewPayroll]);

  const totalUpcomingPayments = useMemo(() => {
    if (!canViewPayroll) {
      return upcomingPayments
        .filter((p: any) => !p.isMasked)
        .reduce((sum: number, p: any) => sum + convertCurrency(Number(p.amount || 0), p.currency || orgCurrency, orgCurrency), 0);
    }
    return dashboardKPIs?.totalUpcomingPayments ?? upcomingPayments.reduce((sum: number, p: any) => sum + convertCurrency(Number(p.amount || 0), p.currency || orgCurrency, orgCurrency), 0);
  }, [canViewPayroll, dashboardKPIs?.totalUpcomingPayments, upcomingPayments, orgCurrency]);

  const totalUpcomingExpenses = useMemo(() => {
    if (!canViewPayroll) {
      return upcomingExpenses
        .filter((e: any) => !e.isMasked)
        .reduce((sum: number, e: any) => sum + convertCurrency(Number(e.amount || 0), e.currency || orgCurrency, orgCurrency), 0);
    }
    return dashboardKPIs?.totalUpcomingExpenses ?? upcomingExpenses.reduce((sum: number, e: any) => sum + convertCurrency(Number(e.amount || 0), e.currency || orgCurrency, orgCurrency), 0);
  }, [canViewPayroll, dashboardKPIs?.totalUpcomingExpenses, upcomingExpenses, orgCurrency]);

  return (
    <div
      className="w-full min-h-full"
      style={{
        background: theme === 'dark' ? '#0a0a0a' : '#f8fafc',
      }}
    >
      <div className="flex flex-col xl:flex-row xl:items-start">
        {/* Main scrolls; upcoming (xl+) is sticky in the workspace so it stays on-screen (see screenshots) */}
        <div className="flex-1 min-w-0">
          {(accountsError || kpisError) && (
            <div
              className="mx-4 sm:mx-6 lg:mx-8 mt-3 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-amber-100 text-sm font-mono border border-amber-500/35"
              style={{ background: 'rgba(245, 158, 11, 0.08)' }}
              role="alert"
            >
              <span>{accountsError || kpisError}</span>
              <button
                type="button"
                onClick={refreshDashboardData}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-amber-500/50 hover:bg-amber-500/15 transition-colors"
              >
                Try again
              </button>
            </div>
          )}
          {Boolean(dashboardKPIs?.pendingTransactions && dashboardKPIs.pendingTransactions > 0) && (
            <div
              className="mx-4 sm:mx-6 lg:mx-8 mt-3 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-blue-200 text-sm font-mono border border-blue-500/35"
              style={{ background: 'rgba(59, 130, 246, 0.08)' }}
              role="status"
            >
              <span>
                {dashboardKPIs?.pendingTransactions} transaction{dashboardKPIs?.pendingTransactions === 1 ? '' : 's'} pending review ({formatCurrency(dashboardKPIs?.pendingReviewAmount ?? 0, orgCurrency)}). Operating analytics reflect posted transactions.
              </span>
            </div>
          )}
          {(accountsLoading || kpisLoading) && (
            <p className="mx-4 sm:mx-6 lg:mx-8 mt-2 text-xs text-slate-500 font-mono" aria-live="polite">
              Updating figures…
            </p>
          )}
          
          {/* Header - NO LONGER STICKY */}
          <div>
            {/* Top Bar - UNIFIED BLUE THEME */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6"
              style={{
                background: theme === 'dark' 
                  ? 'rgba(10, 10, 10, 1)'
                  : 'rgba(255, 255, 255, 1)',
              }}
            >
              <div className="flex items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div 
                  className="p-3 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.6)',
                  }}
                >
                  <BarChart3 className="size-6 text-white" />
                </div>
                <PageHeader
                  className="flex-1 min-w-0"
                  title="Finance OS"
                  description="Agency Profit Intelligence • Real-time Analytics"
                  badge={
                    <div 
                      className="flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full shrink-0"
                      style={{
                        background: theme === 'dark' 
                          ? 'rgba(59, 130, 246, 0.15)'
                          : 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                      }}
                    >
                      <motion.div 
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: '#3b82f6' }}
                        animate={{
                          boxShadow: [
                            '0 0 10px rgba(59, 130, 246, 0.8)',
                            '0 0 20px rgba(59, 130, 246, 1)',
                            '0 0 10px rgba(59, 130, 246, 0.8)',
                          ]
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <span className="text-xs font-medium" style={{ color: '#60a5fa' }}>LIVE</span>
                    </div>
                  }
                />
              </div>
            </motion.div>

            {/* Modern KPI Cards - BLUE THEME WITH TOP SPACING */}
            <div
              className="px-4 sm:px-6 lg:px-8 pb-2 flex flex-wrap items-center justify-end gap-2"
              style={{
                background: theme === 'dark' ? 'rgba(10, 10, 10, 1)' : 'rgba(255, 255, 255, 1)',
              }}
            >
              <span
                className={`text-xs font-mono mr-auto sm:mr-0 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600'}`}
              >
                Profit period
              </span>
              {(['weekly', 'monthly', 'yearly'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProfitPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors min-h-11 touch-manipulation ${
                    profitPeriod === p
                      ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                      : theme === 'dark'
                        ? 'border-slate-600/50 text-slate-400 hover:bg-slate-800/80'
                        : 'border-slate-300/80 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {p === 'weekly' ? 'Week' : p === 'monthly' ? 'Month' : 'Year'}
                </button>
              ))}
            </div>
            <div 
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6 px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6"
              style={{
                background: theme === 'dark' 
                  ? 'rgba(10, 10, 10, 1)'
                  : 'rgba(255, 255, 255, 1)',
              }}
            >
              <ModernKPICard
                icon={TrendingUp}
                label="Total Balance"
                value={totalBalance}
                currency={orgCurrency}
                percentage={dashboardKPIs?.totalBalanceChange != null ? `${dashboardKPIs.totalBalanceChange >= 0 ? '+' : ''}${dashboardKPIs.totalBalanceChange.toFixed(1)}%` : '—'}
                trend={(dashboardKPIs?.totalBalanceChange ?? 0) >= 0 ? 'up' : 'down'}
                delay={0.1}
              />
              
              <ModernKPICard
                icon={Wallet}
                label="Cash in Hand"
                value={cashOnHand}
                currency={orgCurrency}
                percentage={dashboardKPIs?.cashOnHandChange != null ? `${dashboardKPIs.cashOnHandChange >= 0 ? '+' : ''}${dashboardKPIs.cashOnHandChange.toFixed(1)}%` : '—'}
                trend={(dashboardKPIs?.cashOnHandChange ?? 0) >= 0 ? 'up' : 'down'}
                delay={0.2}
              />
              
              <ModernKPICard
                icon={DollarSign}
                label={profitLabel}
                value={monthlyProfitDisplay}
                currency={orgCurrency}
                percentage={getProfitPercentageByPeriod()}
                trend={(profitPeriod === 'weekly' ? (dashboardKPIs?.weeklyProfit ?? 0) : profitPeriod === 'yearly' ? (dashboardKPIs?.yearlyProfit ?? 0) : (dashboardKPIs?.monthlyProfit ?? 0)) >= 0 ? 'up' : 'down'}
                delay={0.3}
                subtitle={
                  profitPeriod === 'weekly'
                    ? (dashboardKPIs?.weeklyRevenue != null && dashboardKPIs?.weeklyExpenses != null
                        ? `Rev ${formatCurrency(dashboardKPIs.weeklyRevenue, orgCurrency, { compact: true })} • Exp ${formatCurrency(dashboardKPIs.weeklyExpenses, orgCurrency, { compact: true })}`
                        : undefined)
                    : profitPeriod === 'yearly'
                      ? (dashboardKPIs?.yearlyRevenue != null && dashboardKPIs?.yearlyExpenses != null
                          ? `Rev ${formatCurrency(dashboardKPIs.yearlyRevenue, orgCurrency, { compact: true })} • Exp ${formatCurrency(dashboardKPIs.yearlyExpenses, orgCurrency, { compact: true })}`
                          : `Cumulative: ${formatCurrency(dashboardKPIs?.netProfit ?? 0, orgCurrency, { compact: true })}`)
                      : (dashboardKPIs?.monthlyRevenue != null && dashboardKPIs?.monthlyExpenses != null
                          ? `Rev ${formatCurrency(dashboardKPIs.monthlyRevenue, orgCurrency, { compact: true })} • Exp ${formatCurrency(dashboardKPIs.monthlyExpenses, orgCurrency, { compact: true })}`
                          : `Cumulative: ${formatCurrency(dashboardKPIs?.netProfit ?? 0, orgCurrency, { compact: true })}`)
                }
              />
              
              <ModernKPICard
                icon={BarChart3}
                label="Net Worth"
                value={netWorthDisplay}
                currency={orgCurrency}
                percentage={dashboardKPIs?.netWorthChange != null ? `${dashboardKPIs.netWorthChange >= 0 ? '+' : ''}${dashboardKPIs.netWorthChange.toFixed(1)}%` : 'Assets − Liab'}
                trend={(dashboardKPIs?.netWorthChange ?? 0) >= 0 ? 'up' : 'down'}
                delay={0.4}
                subtitle={dashboardKPIs?.totalAssets != null && dashboardKPIs?.totalLiabilities != null ? `Assets ${formatCurrency(dashboardKPIs.totalAssets, orgCurrency, { compact: true })} · Liab ${formatCurrency(dashboardKPIs.totalLiabilities, orgCurrency, { compact: true })}` : undefined}
              />
            </div>
          </div>

          {/* Content Area */}
          <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">

          {/* Profit Intelligence Graph */}
          <ProfitIntelligenceGraph currency={orgCurrency} chartData={dashboardKPIs?.chartData} />

          {/* Account Progress Bars - UNIFIED BLUE THEME */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="rounded-3xl relative overflow-hidden"
          >
            {/* Grid of Account Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {accountsLoading && bankAccounts.length === 0 && (
                <>
                  <p
                    className="md:col-span-2 lg:col-span-3 text-sm font-mono text-slate-500 mb-1"
                    aria-live="polite"
                  >
                    Loading accounts…
                  </p>
                  {[0, 1, 2].map((sk) => (
                    <div
                      key={`acct-skel-${sk}`}
                      className="p-6 rounded-2xl border border-slate-600/30 animate-pulse"
                      style={{
                        background:
                          theme === 'dark'
                            ? 'linear-gradient(135deg, rgba(15, 30, 60, 0.35) 0%, rgba(5, 10, 30, 0.5) 100%)'
                            : 'linear-gradient(135deg, rgba(248, 250, 252, 0.95) 0%, rgba(241, 245, 249, 0.9) 100%)',
                      }}
                      aria-hidden
                    >
                      <div className="flex justify-between mb-6">
                        <div className="h-12 w-12 rounded-xl bg-slate-600/40" />
                        <div className="h-6 w-16 rounded-lg bg-slate-600/30" />
                      </div>
                      <div className="h-4 w-3/5 max-w-[200px] rounded bg-slate-600/35 mb-3" />
                      <div className="h-8 w-2/5 max-w-[140px] rounded bg-slate-600/40 mb-4" />
                      <div className="h-2 w-full rounded-full bg-slate-600/25" />
                    </div>
                  ))}
                </>
              )}
              {!accountsLoading && bankAccounts.length === 0 && (
                <div
                  className="md:col-span-2 lg:col-span-3 rounded-2xl p-8 text-center border border-dashed border-slate-600/50"
                  style={{
                    background: theme === 'dark' ? 'rgba(15, 23, 42, 0.35)' : 'rgba(248, 250, 252, 0.9)',
                  }}
                >
                  <p className={`text-sm font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                    No accounts yet. Connect or add accounts under <span className="text-blue-400">Accounts &amp; Wallets</span> in the sidebar.
                  </p>
                </div>
              )}
              {bankAccounts.map((account, idx) => {
                const colors = [
                  { from: '#3b82f6', to: '#2563eb', light: 'rgba(59, 130, 246, 0.1)' },
                  { from: '#06b6d4', to: '#0891b2', light: 'rgba(6, 182, 212, 0.1)' },
                  { from: '#8b5cf6', to: '#7c3aed', light: 'rgba(139, 92, 246, 0.1)' },
                  { from: '#10b981', to: '#059669', light: 'rgba(16, 185, 129, 0.1)' },
                  { from: '#f59e0b', to: '#d97706', light: 'rgba(245, 158, 11, 0.1)' },
                ];
                const color = colors[idx % colors.length];
                const Icon =
                  account.accountType === 'online_wallet'
                    ? Smartphone
                    : account.accountType === 'credit_card' || account.accountType === 'line_of_credit'
                      ? CreditCard
                      : account.accountType === 'cash'
                        ? Banknote
                        : Building2;
                
                return (
                  <motion.div
                    key={account.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.9 + idx * 0.1 }}
                    whileHover={{ y: -8, scale: 1.02 }}
                    className="p-6 rounded-2xl relative overflow-hidden group cursor-pointer"
                    style={{
                      background: theme === 'dark'
                        ? 'linear-gradient(135deg, rgba(15, 30, 60, 0.5) 0%, rgba(5, 10, 30, 0.7) 100%)'
                        : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                      border: `2px solid ${color.from}40`,
                      boxShadow: `0 8px 24px -8px ${color.from}40`,
                    }}
                  >
                    {/* Gradient orb on hover */}
                    <div 
                      className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-0 group-hover:opacity-30 transition-opacity duration-500"
                      style={{
                        background: `radial-gradient(circle, ${color.from}, transparent 70%)`,
                      }}
                    />
                    
                    <div className="relative z-10">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-6">
                        <div 
                          className="p-3 rounded-xl"
                          style={{
                            background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                            boxShadow: `0 8px 20px -8px ${color.from}80`,
                          }}
                        >
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        
                        <div 
                          className="px-3 py-1 rounded-lg text-xs font-bold"
                          style={{
                            background: color.light,
                            color: color.from,
                            border: `1px solid ${color.from}40`,
                          }}
                        >
                          {account.accountType.toUpperCase()}
                        </div>
                      </div>
                      
                      {/* Account Name */}
                      <h4 
                        className="text-lg font-bold mb-1"
                        style={{
                          color: theme === 'dark' ? '#ffffff' : '#1e293b',
                        }}
                      >
                        {account.bankName}
                      </h4>
                      
                      {/* Account Number */}
                      <p 
                        className="text-xs mb-4 font-mono"
                        style={{
                          color: theme === 'dark' ? '#64748b' : '#94a3b8',
                        }}
                      >
                        •••• {account.accountNumber?.slice(-4) || '0000'}
                      </p>
                      
                      {/* Balance */}
                      <div className="flex items-end justify-between">
                        <div>
                          <p 
                            className="text-xs uppercase tracking-wider mb-1"
                            style={{
                              color: theme === 'dark' ? '#64748b' : '#94a3b8',
                            }}
                          >
                            Balance
                          </p>
                          <p 
                            className="text-2xl font-bold"
                            style={{
                              background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                              WebkitBackgroundClip: 'text',
                              WebkitTextFillColor: 'transparent',
                            }}
                          >
                            {formatCurrency(account.balance, account.currency, { compact: true })}
                          </p>
                        </div>
                        
                        <div 
                          className="px-2.5 py-1 rounded text-xs font-semibold"
                          style={{
                            background: color.light,
                            color: color.from,
                          }}
                        >
                          {account.currency}
                        </div>
                      </div>
                      
                      {/* Hover indicator */}
                      <div 
                        className="absolute bottom-0 left-0 right-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{
                          background: `linear-gradient(90deg, transparent, ${color.from}, transparent)`,
                        }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* AI Intelligence Section */}
          <div className="grid grid-cols-1 gap-6 mb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 }}
            >
              <SmartCategorizationPrompts />
            </motion.div>
          </div>

          </div>
        </div>

        {/* Desktop (xl+): sticky wrapper (no overflow here — inner aside scrolls if content is very tall) */}
        <div className="hidden xl:block xl:sticky xl:top-4 xl:z-20 xl:self-start xl:shrink-0">
          {desktopUpcomingOpen ? (
            <aside
              className="w-96 max-w-md border-l border-cyan-500/20 p-4 sm:p-6 lg:p-8 rounded-l-xl shadow-sm"
              style={{ background: upcomingPanelSurface(theme) }}
            >
              <UpcomingPanelContent
                theme={theme}
                totalUpcomingPayments={totalUpcomingPayments}
                totalUpcomingExpenses={totalUpcomingExpenses}
                upcomingPayments={upcomingPayments}
                upcomingExpenses={upcomingExpenses}
                goToOrgView={goToOrgView ?? undefined}
                onDismiss={() => setDesktopUpcomingOpen(false)}
                dismissStyle="collapse"
                currency={orgCurrency}
              />
            </aside>
          ) : (
            <div className="flex justify-end pr-1 pt-1">
              <button
                type="button"
                onClick={() => setDesktopUpcomingOpen(true)}
                className="flex flex-col items-center gap-2 rounded-l-xl border border-cyan-500/25 px-2.5 py-5 min-h-11 min-w-[3.25rem] touch-manipulation shadow-lg transition-colors"
                style={{
                  background: theme === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                  color: theme === 'dark' ? '#94a3b8' : '#64748b',
                }}
                aria-expanded={false}
                aria-label="Show upcoming payments and expenses"
              >
                <Calendar className="w-5 h-5 text-blue-400 shrink-0" />
                <span className="text-[10px] font-mono uppercase tracking-wide text-center max-w-[4.5rem] leading-snug">
                  Upcoming
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile / tablet: FAB opens slide-over (panel hidden by default to save space) */}
      {!mobileUpcomingOpen && (
        <button
          type="button"
          onClick={() => setMobileUpcomingOpen(true)}
          className="xl:hidden fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-cyan-500/30 pl-4 pr-5 py-3 min-h-11 shadow-xl touch-manipulation"
          style={{
            background: theme === 'dark' ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            color: theme === 'dark' ? '#e2e8f0' : '#1e293b',
            boxShadow: '0 12px 40px -8px rgba(59, 130, 246, 0.45)',
          }}
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-label="Open upcoming payments and expenses"
        >
          <Calendar className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="text-sm font-semibold">Upcoming</span>
        </button>
      )}

      {mobileUpcomingOpen && (
        <div className="xl:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Upcoming">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            aria-label="Close upcoming panel"
            onClick={() => setMobileUpcomingOpen(false)}
          />
          {/* Single scroll surface for the sheet (no nested overflow inside UpcomingPanelContent) */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="absolute inset-y-0 right-0 z-50 flex w-[min(100%,22rem)] flex-col overflow-y-auto overscroll-contain border-l border-cyan-500/25 p-4 sm:p-6 shadow-2xl"
            style={{ background: upcomingPanelSurface(theme) }}
          >
            <UpcomingPanelContent
              theme={theme}
              totalUpcomingPayments={totalUpcomingPayments}
              totalUpcomingExpenses={totalUpcomingExpenses}
              upcomingPayments={upcomingPayments}
              upcomingExpenses={upcomingExpenses}
              goToOrgView={(v) => {
                setMobileUpcomingOpen(false);
                goToOrgView?.(v);
              }}
              onDismiss={() => setMobileUpcomingOpen(false)}
              dismissStyle="close"
              currency={orgCurrency}
            />
          </motion.div>
        </div>
      )}
    </div>
  );
}