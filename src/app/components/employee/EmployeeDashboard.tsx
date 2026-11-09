import { useState } from 'react';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { PageShell, PageHeader } from '../layout';
import { 
  DollarSign, Clock, Briefcase, TrendingUp,
  AlertCircle, FileText, Bell, ChevronRight, Activity, CheckCircle, CheckSquare, Layers
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { useService } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';

function KPICard({ title, value, subtitle, icon: Icon, color, delay }: {
  title: string; value: string; subtitle: string; icon: any; color: string; delay: number;
}) {
  const colorMap: Record<string, { bg: string; border: string; shadow: string; text: string; iconBg: string }> = {
    blue: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.2)', shadow: 'rgba(59, 130, 246, 0.3)', text: '#60a5fa', iconBg: 'linear-gradient(to bottom right, #3b82f6, #2563eb)' },
    green: { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.2)', shadow: 'rgba(16, 185, 129, 0.3)', text: '#34d399', iconBg: 'linear-gradient(to bottom right, #10b981, #059669)' },
    purple: { bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.2)', shadow: 'rgba(168, 85, 247, 0.3)', text: '#c084fc', iconBg: 'linear-gradient(to bottom right, #a855f7, #7c3aed)' },
    amber: { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.2)', shadow: 'rgba(245, 158, 11, 0.3)', text: '#fbbf24', iconBg: 'linear-gradient(to bottom right, #f59e0b, #d97706)' },
    cyan: { bg: 'rgba(6, 182, 212, 0.1)', border: 'rgba(6, 182, 212, 0.2)', shadow: 'rgba(6, 182, 212, 0.3)', text: '#22d3ee', iconBg: 'linear-gradient(to bottom right, #06b6d4, #0891b2)' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="rounded-2xl p-6 relative overflow-hidden"
      style={{
        background: AXIOM.backgrounds.chartContainer,
        border: `1px solid ${c.border}`,
        boxShadow: `0 20px 60px -20px ${c.shadow}`,
      }}
    >
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none" style={{
        background: `radial-gradient(circle at 100% 0%, ${c.bg}, transparent 70%)`
      }} />
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-xs text-slate-400 font-mono mb-2">{title}</p>
          <p className="text-3xl font-bold text-white mb-1">{value}</p>
          <p className="text-sm font-mono" style={{ color: c.text }}>{subtitle}</p>
        </div>
        <div className="size-12 rounded-xl flex items-center justify-center" style={{
          background: c.iconBg,
          boxShadow: `0 10px 30px -10px ${c.shadow}`,
        }}>
          <Icon className="size-6 text-white" />
        </div>
      </div>
    </motion.div>
  );
}

export function EmployeeDashboard() {
  const { user, currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';
  const userId = user?.id ?? '';

  const { data: dashData, loading, error } = useService(
    () => (orgId && userId ? employeeService.getDashboardSummary(orgId, userId) : Promise.resolve({ success: true, data: null })),
    [orgId, userId],
    ['expenses', 'timesheets', 'payslips', 'announcements'],
  );

  const data = {
    name: user?.name ?? 'there',
    department: dashData?.department ?? 'Team',
    position: dashData?.position ?? 'Member',
    hoursThisWeek: dashData?.hoursThisWeek ?? 0,
    hoursTarget: dashData?.hoursTarget ?? 40,
    pendingExpenses: dashData?.pendingExpenses ?? 0,
    pendingExpenseAmount: dashData?.pendingExpenseAmount ?? 0,
    activeProjects: dashData?.activeProjects ?? 0,
    completedTasks: dashData?.completedTasks ?? 0,
    totalTasks: dashData?.totalTasks ?? 0,
    salary: dashData?.salary ?? { gross: 0, net: 0, currency: 'USD' },
    lastPayPeriod: dashData?.lastPayPeriod ?? '',
    recentActivity: dashData?.recentActivity ?? [],
    weeklyHours: dashData?.weeklyHours ?? [],
    announcements: dashData?.announcements ?? [],
    projectNotifications: dashData?.projectNotifications ?? [],
  };
  const [notifFilter, setNotifFilter] = useState<'all' | 'projects' | 'announcements'>('all');
  const hoursPercent = data.hoursTarget > 0 ? (data.hoursThisWeek / data.hoursTarget) * 100 : 0;
  const taskPercent = data.totalTasks > 0 ? (data.completedTasks / data.totalTasks) * 100 : 0;
  const hoursRemaining = Math.max(0, data.hoursTarget - data.hoursThisWeek);
  const hoursSubtitle =
    data.hoursThisWeek >= data.hoursTarget && data.hoursTarget > 0
      ? 'Target met for this week'
      : `${hoursRemaining.toFixed(1)}h remaining`;

  const workWeekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const displayWeeklyHours = workWeekDays.map(dayName => {
    const found = data.weeklyHours.find(d => d.day.toLowerCase() === dayName.toLowerCase());
    return { day: dayName, hours: found ? found.hours : 0 };
  });

  if (error && !dashData) {
    return (
      <PageShell className="space-y-4">
        <PageHeader title="Dashboard" />
        <p className="text-amber-200 font-mono text-sm border border-amber-500/30 rounded-xl px-4 py-3" style={{ background: 'rgba(245, 158, 11, 0.08)' }}>
          {error}
        </p>
      </PageShell>
    );
  }

  if (loading && !dashData) {
    return (
      <PageShell>
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-white/10 rounded-lg w-2/3 max-w-md" />
          <div className="h-4 bg-white/5 rounded w-1/3" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {error && (
        <p className="text-amber-200 font-mono text-sm border border-amber-500/30 rounded-xl px-4 py-3" style={{ background: 'rgba(245, 158, 11, 0.08)' }}>
          {error}
        </p>
      )}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <PageHeader
          title={<>Welcome back, {data.name}</>}
          description={`${data.position} — ${data.department}`}
        />
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <KPICard title="HOURS THIS WEEK" value={`${data.hoursThisWeek}h`} subtitle={hoursSubtitle} icon={Clock} color="blue" delay={0.1} />
        <KPICard title="PENDING EXPENSES" value={`$${data.pendingExpenseAmount.toFixed(2)}`} subtitle={`${data.pendingExpenses} claims pending`} icon={DollarSign} color="amber" delay={0.15} />
        <KPICard
          title="ACTIVE PROJECTS"
          value={`${data.activeProjects}`}
          subtitle={data.totalTasks > 0 ? `${data.completedTasks}/${data.totalTasks} tasks done` : 'From your logged time'}
          icon={Briefcase}
          color="purple"
          delay={0.2}
        />
        <KPICard title="LAST NET PAY" value={`${data.salary.net.toLocaleString()}`} subtitle={data.lastPayPeriod || 'No payslip issued yet'} icon={TrendingUp} color="green" delay={0.25} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Weekly Hours Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="xl:col-span-2 rounded-2xl p-6"
          style={{
            ...AXIOM.containers.chartBlue,
            borderRadius: '1rem',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className={AXIOM.typography.sectionTitle}>Weekly Hours</h3>
              <p className={AXIOM.typography.monoMuted}>This week (Mon–Fri)</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 rounded-lg text-xs font-mono" style={{
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: '#60a5fa',
              }}>
                {hoursPercent.toFixed(0)}% of target
              </div>
            </div>
          </div>

          <div className="flex items-end gap-3 h-48">
            {displayWeeklyHours.map((day, i) => {
              const maxVal = Math.max(8.5, ...displayWeeklyHours.map(d => d.hours));
              const pct = Math.min((day.hours / maxVal) * 100, 100);
              return (
                <motion.div
                  key={day.day}
                  initial={{ height: 0 }}
                  animate={{ height: `${pct}%` }}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                  className="flex-1 relative group"
                >
                  <div className="absolute inset-0 rounded-t-lg" style={{
                    background: day.hours >= 8 
                      ? 'linear-gradient(to top, rgba(59, 130, 246, 0.4), rgba(59, 130, 246, 0.7))' 
                      : 'linear-gradient(to top, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.4))',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderBottom: 'none',
                  }} />
                  {/* Tooltip */}
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded text-xs text-white font-mono whitespace-nowrap" style={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                  }}>
                    {day.hours}h
                  </div>
                </motion.div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-3">
            {displayWeeklyHours.map((day) => (
              <div key={day.day} className="flex-1 text-center text-xs text-slate-400 font-mono">{day.day}</div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 font-mono">Weekly Progress</span>
              <span className="text-xs text-blue-400 font-mono">{data.hoursThisWeek}h / {data.hoursTarget}h</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0, 0, 0, 0.3)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(hoursPercent, 100)}%` }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(to right, #3b82f6, #06b6d4)' }}
              />
            </div>
          </div>
        </motion.div>

        {/* Notifications & Project Updates */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-2xl p-6"
          style={{
            ...AXIOM.containers.chartPurple,
            borderRadius: '1rem',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell className="size-5 text-purple-400" />
              <h3 className="text-white font-bold">Notifications</h3>
            </div>
            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/5 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setNotifFilter('all')}
                className={`px-2 py-0.5 rounded transition-colors ${notifFilter === 'all' ? 'bg-purple-500/30 text-purple-200 border border-purple-500/40' : 'text-slate-400 hover:text-white'}`}
              >
                All ({data.projectNotifications.length + data.announcements.length})
              </button>
              <button
                type="button"
                onClick={() => setNotifFilter('projects')}
                className={`px-2 py-0.5 rounded transition-colors ${notifFilter === 'projects' ? 'bg-blue-500/30 text-blue-200 border border-blue-500/40' : 'text-slate-400 hover:text-white'}`}
              >
                Projects ({data.projectNotifications.length})
              </button>
              <button
                type="button"
                onClick={() => setNotifFilter('announcements')}
                className={`px-2 py-0.5 rounded transition-colors ${notifFilter === 'announcements' ? 'bg-amber-500/30 text-amber-200 border border-amber-500/40' : 'text-slate-400 hover:text-white'}`}
              >
                News ({data.announcements.length})
              </button>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {/* Unified Notification List */}
            {(() => {
              const items: Array<{
                id: string;
                title: string;
                subtitle?: string;
                date: string;
                category: 'project' | 'announcement';
                urgent?: boolean;
                link?: string;
              }> = [];

              if (notifFilter === 'all' || notifFilter === 'projects') {
                for (const pn of data.projectNotifications) {
                  items.push({
                    id: pn.id,
                    title: pn.title,
                    subtitle: pn.projectName ? `${pn.projectName} • ${pn.message}` : pn.message,
                    date: pn.date,
                    category: 'project',
                    urgent: pn.urgent,
                    link: pn.link || '/employee?tab=timesheet',
                  });
                }
              }

              if (notifFilter === 'all' || notifFilter === 'announcements') {
                for (const a of data.announcements) {
                  items.push({
                    id: a.id,
                    title: a.title,
                    subtitle: 'Company Announcement',
                    date: a.date,
                    category: 'announcement',
                    urgent: a.urgent,
                    link: '/employee?tab=announcements',
                  });
                }
              }

              if (items.length === 0) {
                return (
                  <p className="text-sm text-slate-500 font-mono py-4 text-center">
                    No notifications in this view.
                  </p>
                );
              }

              return items.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.05 }}
                  onClick={() => {
                    if (item.link) window.location.href = item.link;
                  }}
                  className="p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-colors group"
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: item.urgent
                      ? '1px solid rgba(245, 158, 11, 0.3)'
                      : item.category === 'project'
                        ? '1px solid rgba(59, 130, 246, 0.2)'
                        : '1px solid rgba(148, 163, 184, 0.1)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    {item.urgent ? (
                      <AlertCircle className="size-4 text-amber-400 mt-0.5 shrink-0" />
                    ) : item.category === 'project' ? (
                      <Briefcase className="size-4 text-blue-400 mt-0.5 shrink-0" />
                    ) : (
                      <Bell className="size-4 text-purple-400 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                          item.category === 'project'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        }`}>
                          {item.category === 'project' ? 'PROJECT' : 'ANNOUNCEMENT'}
                        </span>
                        <p className="text-sm text-white truncate font-medium">{item.title}</p>
                      </div>
                      {item.subtitle && (
                        <p className="text-xs text-slate-400 font-mono mt-1 truncate">{item.subtitle}</p>
                      )}
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">{item.date}</p>
                    </div>
                    <ChevronRight className="size-4 text-slate-500 group-hover:text-white transition-colors shrink-0" />
                  </div>
                </motion.div>
              ));
            })()}
          </div>

          {data.totalTasks > 0 && (
            <div className="mt-6 p-4 rounded-lg" style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(168, 85, 247, 0.2)',
            }}>
              <p className="text-xs text-slate-400 font-mono mb-3">TASK COMPLETION</p>
              <div className="flex items-center gap-4">
                <div className="relative size-16">
                  <svg className="size-16 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(148, 163, 184, 0.1)" strokeWidth="3" />
                    <motion.circle
                      cx="18" cy="18" r="15.5" fill="none"
                      stroke="url(#taskGradDash)" strokeWidth="3"
                      strokeDasharray={`${taskPercent} ${100 - taskPercent}`}
                      strokeLinecap="round"
                      initial={{ strokeDasharray: '0 100' }}
                      animate={{ strokeDasharray: `${taskPercent} ${100 - taskPercent}` }}
                      transition={{ delay: 0.6, duration: 1 }}
                    />
                    <defs>
                      <linearGradient id="taskGradDash" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-white">{taskPercent.toFixed(0)}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-white font-bold">{data.completedTasks}/{data.totalTasks}</p>
                  <p className="text-xs text-slate-400 font-mono">Tasks completed</p>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-2xl p-6"
        style={{
          ...AXIOM.containers.list,
          borderRadius: '1rem',
        }}
      >
        <div className="flex items-center gap-2 mb-6">
          <Activity className="size-5 text-blue-400" />
          <h3 className="text-white font-bold">Recent Activity</h3>
        </div>

        <div className="space-y-3">
          {data.recentActivity.length === 0 && (
            <p className="text-sm text-slate-500 font-mono py-4">No recent activity yet.</p>
          )}
          {data.recentActivity.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.05 }}
              className="flex items-center gap-4 p-4 rounded-lg hover:bg-white/5 transition-colors"
              style={{
                background: AXIOM.backgrounds.innerCard,
                border: AXIOM.borders.default,
              }}
            >
              <div className="size-10 rounded-lg flex items-center justify-center" style={{
                background: item.type === 'expense' ? 'rgba(245, 158, 11, 0.15)' :
                  item.type === 'timesheet' ? 'rgba(59, 130, 246, 0.15)' :
                  item.type === 'project' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                border: `1px solid ${item.type === 'expense' ? 'rgba(245, 158, 11, 0.3)' :
                  item.type === 'timesheet' ? 'rgba(59, 130, 246, 0.3)' :
                  item.type === 'project' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
              }}>
                {item.type === 'expense' && <DollarSign className="size-5 text-amber-400" />}
                {item.type === 'timesheet' && <Clock className="size-5 text-blue-400" />}
                {item.type === 'project' && <Briefcase className="size-5 text-purple-400" />}
                {item.type === 'payslip' && <FileText className="size-5 text-green-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.text}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{item.time}</p>
              </div>
              {!!item.amount && (
                <span className="text-sm font-mono text-amber-400">${item.amount.toFixed(2)}</span>
              )}
              <span className={`text-xs font-mono px-2 py-1 rounded ${
                item.status === 'approved' ? 'text-green-400 bg-green-400/10 border border-green-400/20' :
                item.status === 'pending' ? 'text-amber-400 bg-amber-400/10 border border-amber-400/20' :
                item.status === 'completed' ? 'text-blue-400 bg-blue-400/10 border border-blue-400/20' :
                'text-slate-400 bg-slate-400/10 border border-slate-400/20'
              }`}>
                {item.status}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </PageShell>
  );
}