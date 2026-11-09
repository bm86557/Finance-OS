import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
// ── Phase 8: Wired to platformService ───────────────────────────────────────
import { platformService } from '@/services/platformService';
import type { PlatformStats } from '@/services/platformService';
import { useService } from '@/hooks/useService';
import { TrendingUp, Building2, Users, FileText, DollarSign, AlertCircle, Database, Activity, ChevronRight, Loader2 } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function KPICard({ title, value, subtitle, icon: Icon, color, delay }: {
  title: string; value: string; subtitle: string; icon: any; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="rounded-2xl p-6 relative overflow-hidden"
      style={{
        background: AXIOM.backgrounds.chartContainer,
        border: AXIOM.borders[color as keyof typeof AXIOM.borders] || AXIOM.borders.default,
        boxShadow: AXIOM.shadows[color as keyof typeof AXIOM.shadows] || AXIOM.shadows.default,
      }}
    >
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none" style={{
        background: `radial-gradient(circle at 100% 0%, ${AXIOM.radialOverlays[color as keyof typeof AXIOM.radialOverlays] ? `rgba(168, 85, 247, 0.1)` : 'transparent'}, transparent 70%)`
      }} />
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-xs text-slate-400 font-mono mb-2">{title}</p>
          <p className="text-3xl font-bold text-white mb-1">{value}</p>
          <p className="text-sm font-mono" style={{ color: AXIOM.charts.colors[color as keyof typeof AXIOM.charts.colors] || '#60a5fa' }}>{subtitle}</p>
        </div>
        <div className="size-12 rounded-xl flex items-center justify-center" style={{
          background: AXIOM.iconBoxes[color as keyof typeof AXIOM.iconBoxes] || AXIOM.iconBoxes.purple,
          boxShadow: AXIOM.shadows[`icon${color.charAt(0).toUpperCase() + color.slice(1)}` as keyof typeof AXIOM.shadows] || AXIOM.shadows.iconPurple,
        }}>
          <Icon className="size-6 text-white" />
        </div>
      </div>
    </motion.div>
  );
}

export function PlatformHome({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { data: stats, loading } = useService(
    () => platformService.getStats(),
    []
  );

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center p-20" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
        <Loader2 className="size-8 text-blue-400 animate-spin" />
        <span className="ml-3 text-slate-400 font-mono">Loading platform stats...</span>
      </div>
    );
  }

  const mrrSubtitle = stats.mrrGrowthPct !== undefined
    ? `${stats.mrrGrowthPct >= 0 ? '+' : ''}${stats.mrrGrowthPct}% from last month`
    : '+12% from last month';

  const usersSubtitle = stats.newUsersThisMonth !== undefined
    ? `+${stats.newUsersThisMonth} this month`
    : `Across ${stats.activeOrgs} organizations`;

  const profitMarginSub = stats.mrr > 0 && stats.platformProfit > 0
    ? `${Math.round((stats.platformProfit / stats.mrr) * 100)}% net margin`
    : 'Monthly profit';

  return (
    <div className="p-8 space-y-8" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>
          Platform Dashboard
        </h1>
        <p className="text-slate-400 font-mono">Monitor SaaS performance and organization health</p>
      </motion.div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <KPICard title="MONTHLY RECURRING REVENUE" value={`Rs ${stats.mrr.toLocaleString()}`} subtitle={mrrSubtitle} icon={DollarSign} color="green" delay={0.1} />
        <KPICard title="ANNUAL RECURRING REVENUE" value={`Rs ${stats.arr.toLocaleString()}`} subtitle="On track for target" icon={TrendingUp} color="blue" delay={0.15} />
        <KPICard title="ACTIVE ORGANIZATIONS" value={`${stats.activeOrgs}`} subtitle={`${stats.paidOrgs ?? 0} paid, ${stats.freeOrgs ?? stats.activeOrgs} free tier`} icon={Building2} color="cyan" delay={0.2} />
        <KPICard title="TOTAL USERS" value={`${stats.totalUsers}`} subtitle={usersSubtitle} icon={Users} color="purple" delay={0.25} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl p-6"
          style={{ ...AXIOM.containers.chartBlue, borderRadius: '1rem' }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-white font-bold">Revenue Growth</h3>
              <p className="text-xs text-slate-400 font-mono">Monthly trend</p>
            </div>
            <div className="px-3 py-1.5 rounded-lg text-xs font-mono" style={{
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: '#60a5fa',
            }}>
              LIVE
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.revenueGrowth} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray={AXIOM.charts.grid.strokeDasharray} stroke={AXIOM.charts.grid.stroke} vertical={false} />
              <XAxis dataKey="month" stroke={AXIOM.charts.axis.stroke} tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                stroke={AXIOM.charts.axis.stroke}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val: number) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                  border: AXIOM.charts.tooltip.border,
                  borderRadius: AXIOM.charts.tooltip.borderRadius,
                  boxShadow: AXIOM.charts.tooltip.boxShadow,
                }}
                labelStyle={{ color: AXIOM.charts.tooltip.labelColor }}
                itemStyle={{ color: AXIOM.charts.tooltip.itemColor }}
                formatter={(value: any) => [`Rs ${Number(value || 0).toLocaleString()}`, 'Revenue']}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke={AXIOM.charts.colors.blue}
                strokeWidth={2}
                dot={{ fill: AXIOM.charts.colors.blue, r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: AXIOM.charts.colors.blue, stroke: 'rgba(59, 130, 246, 0.3)', strokeWidth: 8 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-2xl p-6"
          style={{ ...AXIOM.containers.chartPurple, borderRadius: '1rem' }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-white font-bold">Organization Status</h3>
              <p className="text-xs text-slate-400 font-mono">Distribution by status</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={[
                { status: 'Active', count: stats.activeOrgs },
                { status: 'Trial', count: stats.trialOrgs },
                { status: 'Suspended', count: stats.suspendedOrgs },
                { status: 'At Risk', count: stats.churnRiskOrgs },
              ]}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray={AXIOM.charts.grid.strokeDasharray} stroke={AXIOM.charts.grid.stroke} vertical={false} />
              <XAxis dataKey="status" stroke={AXIOM.charts.axis.stroke} tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                stroke={AXIOM.charts.axis.stroke}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                  border: AXIOM.charts.tooltip.border,
                  borderRadius: AXIOM.charts.tooltip.borderRadius,
                  boxShadow: AXIOM.charts.tooltip.boxShadow,
                }}
                labelStyle={{ color: AXIOM.charts.tooltip.labelColor }}
                itemStyle={{ color: AXIOM.charts.tooltip.itemColor }}
                formatter={(value: any) => [value, 'Organizations']}
              />
              <Bar dataKey="count" fill={AXIOM.charts.colors.purple} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'STATEMENTS PROCESSED', value: stats.statementsProcessed.toLocaleString(), sub: 'Total lifetime', icon: FileText, color: 'amber' },
          { label: 'PLATFORM PROFIT', value: `Rs ${stats.platformProfit.toLocaleString()}`, sub: profitMarginSub, icon: TrendingUp, color: 'green' },
          { label: 'STORAGE USED', value: `${((stats.storageUsed / stats.storageLimit) * 100).toFixed(1)}%`, sub: `${stats.storageUsed.toLocaleString()} / ${stats.storageLimit.toLocaleString()} MB`, icon: Database, color: 'blue' },
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
                <p className="text-xs text-slate-400 font-mono mt-1">{item.sub}</p>
              </div>
              <div className="size-10 rounded-lg flex items-center justify-center" style={{
                background: AXIOM.iconBoxes[item.color as keyof typeof AXIOM.iconBoxes],
              }}>
                <item.icon className="size-5 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Dynamic Attention Required / System Health */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="rounded-2xl p-6"
        style={{ ...AXIOM.containers.chartAmber, borderRadius: '1rem' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="size-5 text-amber-400" />
          <h3 className="text-white font-bold">Attention Required</h3>
        </div>
        <div className="space-y-3">
          {(stats.alerts && stats.alerts.length > 0 ? stats.alerts : [
            { id: '1', title: '5 organizations at churn risk', sub: 'Review billing status and engagement', type: 'warning', action: 'Review' },
            { id: '2', title: '3 organizations with overdue payments', sub: 'Send payment reminders', type: 'warning', action: 'Review' },
          ]).map((alert: any, i: number) => (
            <motion.div
              key={alert.id || i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.55 + i * 0.05 }}
              onClick={() => onNavigate?.('organizations')}
              className="flex items-center justify-between p-4 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              style={{
                background: AXIOM.backgrounds.innerCard,
                border: AXIOM.borders.default,
              }}
            >
              <div>
                <p className="text-sm text-white font-medium">{alert.title}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{alert.sub}</p>
              </div>
              <div className="flex items-center gap-2 text-amber-400 text-xs font-mono">
                <span>{alert.action || 'Review'}</span>
                <ChevronRight className="size-4" />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}