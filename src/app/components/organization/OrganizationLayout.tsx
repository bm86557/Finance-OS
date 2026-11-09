import { ReactNode, useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import { calculateSubscriptionCycle } from '@/utils/subscriptionCycle';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Button } from '../ui/button';
import { useTheme } from '../../../contexts/ThemeContext';
import { 
  LayoutDashboard, 
  Plus, 
  Receipt, 
  Wallet, 
  Upload, 
  Brain, 
  Calculator, 
  FileText, 
  CreditCard, 
  Users, 
  Settings, 
  LogOut,
  Building2,
  Sparkles,
  Repeat,
  Target,
  TrendingUp,
  Briefcase,
  Zap,
  LineChart,
  User,
  Plug,
  Cpu,
  Radio,
  ChevronRight,
  Laptop,
  Package,
  Menu,
  X,
  Crown,
  DollarSign,
  Eye,
  Shield,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { OrganizationSwitcher } from '../OrganizationSwitcher';
import { NotificationCenter } from '../notifications/NotificationCenter';
import type { OrgView } from './OrganizationWorkspace';
import type { MemberAccessRole } from '@/services/types';

interface OrganizationLayoutProps {
  children: ReactNode;
  currentView: OrgView;
  onViewChange: (view: OrgView) => void;
}

export const ROLE_ALLOWED_VIEWS: Record<MemberAccessRole, readonly OrgView[]> = {
  org_admin: [
    'finance-os', 'dashboard', 'profit-intelligence', 'ai-assistant', 'quick-add',
    'transactions', 'recurring', 'accounts', 'payment-methods', 'import', 'logic',
    'integrations', 'budgets', 'forecast', 'projects', 'simulator', 'costing',
    'assets', 'inventory', 'reports', 'loans', 'team', 'payroll', 'settings',
  ],
  accountant: [
    'finance-os', 'dashboard', 'profit-intelligence', 'ai-assistant', 'quick-add',
    'transactions', 'recurring', 'accounts', 'payment-methods', 'import', 'logic',
    'budgets', 'forecast', 'projects', 'costing', 'assets', 'inventory', 'reports', 'loans', 'payroll',
  ],
  team_member: [
    'finance-os', 'dashboard', 'quick-add', 'transactions', 'reports',
  ],
  viewer: [
    'finance-os', 'dashboard', 'reports',
  ],
};

export function OrganizationLayout({ children, currentView, onViewChange }: OrganizationLayoutProps) {
  const { user, logout, currentOrganization, userRole, accessRole, membership } = useAuth();
  const { theme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = () => setMobileNavOpen(false);
  const selectView = (view: OrgView) => {
    onViewChange(view);
    closeMobileNav();
  };
  
  // Use the live org from AuthContext instead of static mock data
  const organization = currentOrganization;

  // Derive active role from session
  const activeRole: MemberAccessRole =
    accessRole ||
    membership?.accessRole ||
    (userRole === 'owner' || userRole === 'admin' ? 'org_admin' : 'team_member');

  const getRoleBadge = (role: MemberAccessRole) => {
    switch (role) {
      case 'org_admin':
        return {
          label: 'ORG ADMIN',
          description: 'Full Access',
          icon: Crown,
          badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        };
      case 'accountant':
        return {
          label: 'ACCOUNTANT',
          description: 'Financial Access',
          icon: DollarSign,
          badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        };
      case 'team_member':
        return {
          label: 'TEAM MEMBER',
          description: 'Add & View Access',
          icon: Users,
          badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        };
      case 'viewer':
        return {
          label: 'VIEWER',
          description: 'View-Only Access',
          icon: Eye,
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        };
    }
  };

  const roleBadge = getRoleBadge(activeRole);

  const allNavItems: { id: OrgView; label: string; icon: any }[] = [
    { id: 'finance-os', label: 'Finance OS', icon: Cpu },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'profit-intelligence', label: 'Profit Intelligence', icon: LineChart },
    { id: 'ai-assistant', label: 'AI Assistant', icon: Brain },
    { id: 'quick-add', label: 'Quick Add', icon: Plus },
    { id: 'transactions', label: 'Transactions', icon: Receipt },
    { id: 'recurring', label: 'Recurring', icon: Repeat },
    { id: 'accounts', label: 'Accounts & Wallets', icon: Wallet },
    { id: 'payment-methods', label: 'Payment Methods', icon: CreditCard },
    { id: 'import', label: 'Import Statements', icon: Upload },
    { id: 'logic', label: 'Logic & Learning', icon: Sparkles },
    { id: 'integrations', label: 'Integrations', icon: Plug },
    { id: 'budgets', label: 'Budget Planning', icon: Target },
    { id: 'forecast', label: 'Cash Flow Forecast', icon: TrendingUp },
    { id: 'projects', label: 'Project Profitability', icon: Briefcase },
    { id: 'simulator', label: 'What-If Simulator', icon: Zap },
    { id: 'costing', label: 'Costing & Pricing', icon: Calculator },
    { id: 'assets', label: 'Assets & Depreciation', icon: Laptop },
    { id: 'inventory', label: 'Inventory Management', icon: Package },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'loans', label: 'Loans & Liabilities', icon: Building2 },
    { id: 'team', label: 'Team & Permissions', icon: Users },
    { id: 'payroll', label: 'Payroll & Payslips', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const { canAccessView, can } = usePermissions();
  const { isViewAllowedByPlan, currentPlan, subscription } = usePlanEntitlements();
  const cycle = useMemo(() => {
    return calculateSubscriptionCycle(subscription, currentPlan?.price, currentPlan?.slug);
  }, [subscription, currentPlan?.price, currentPlan?.slug]);
  const allowedViews = ROLE_ALLOWED_VIEWS[activeRole] || ROLE_ALLOWED_VIEWS.team_member;
  const featureSettings = (currentOrganization?.settings as { features?: Record<string, boolean> } | undefined)?.features;
  const isFeatureEnabled = (viewId: OrgView): boolean => {
    if (!featureSettings) return true;
    if (viewId === 'profit-intelligence' && featureSettings.profit_intelligence === false) return false;
    if (viewId === 'recurring' && featureSettings.recurring_transactions === false) return false;
    if (viewId === 'budgets' && featureSettings.budget_alerts === false) return false;
    return true;
  };

  const { featureFlags: platformFeatureFlags } = usePlatformSettings();
  const [whiteLabelTick, setWhiteLabelTick] = useState(0);
  useEffect(() => {
    const onWlUpdate = () => setWhiteLabelTick(t => t + 1);
    window.addEventListener('org-whitelabel-updated', onWlUpdate);
    return () => window.removeEventListener('org-whitelabel-updated', onWlUpdate);
  }, []);

  const resolvedBranding = (() => {
    void whiteLabelTick;
    if (!platformFeatureFlags.white_label_mode) {
      return { title: 'Finance OS', subtitle: 'Multi-Tenant System' };
    }
    let wl = (currentOrganization?.settings as any)?.whiteLabel;
    if (!wl && currentOrganization?.id) {
      try {
        const raw = localStorage.getItem(`finance_os_whitelabel_${currentOrganization.id}`);
        if (raw) wl = JSON.parse(raw);
      } catch {}
    }
    const customTitle = wl?.brandName?.trim() || (wl?.hideDefaultBranding ? currentOrganization?.name : '') || 'Finance OS';
    const customSubtitle = wl?.subtitle?.trim() || (wl?.hideDefaultBranding ? 'Enterprise Workspace' : 'Multi-Tenant System');
    return { title: customTitle, subtitle: customSubtitle };
  })();

  const navItems = allNavItems.filter((item) => allowedViews.includes(item.id) && canAccessView(item.id) && isFeatureEnabled(item.id) && isViewAllowedByPlan(item.id));

  return (
    <div className={`size-full flex flex-col ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} relative overflow-hidden`}>
      {/* Subtle Background Grid */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-5' : 'opacity-3'} pointer-events-none`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px'
      }}></div>

      {/* Top Header Bar */}
      <div className={`min-h-16 sm:min-h-20 ${theme === 'dark' ? 'bg-slate-900/80' : 'bg-white/80'} backdrop-blur-xl border-b ${theme === 'dark' ? 'border-cyan-500/30' : 'border-cyan-400/30'} flex flex-wrap items-center justify-between gap-y-2 gap-x-2 px-3 sm:px-5 lg:px-8 py-2 sm:py-0 shrink-0 relative z-30`}>
        {/* Glowing Top Border */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>

        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1 lg:flex-initial">
          <button
            type="button"
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileNavOpen(o => !o)}
            className={`lg:hidden shrink-0 p-2.5 rounded-xl border ${theme === 'dark' ? 'border-cyan-500/30 bg-slate-950/50 text-cyan-300' : 'border-cyan-400/40 bg-slate-50 text-cyan-700'}`}
          >
            {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          {/* Logo */}
          <div className="relative shrink-0">
            <div className="size-10 sm:size-12 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 flex items-center justify-center relative">
              <Cpu className="size-5 sm:size-6 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-500 blur-lg opacity-50"></div>
            </div>
          </div>

          <div className="min-w-0 hidden min-[400px]:block sm:block">
            <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent truncate">
              {resolvedBranding.title}
            </h1>
            <div className="hidden md:flex items-center gap-2">
              <div className="size-2 rounded-full bg-green-400 shadow-lg shadow-green-400/50"></div>
              <p className="text-xs text-cyan-400/70 font-mono">{resolvedBranding.subtitle}</p>
            </div>
          </div>

          {/* Organization Switcher */}
          <div className="ml-auto sm:ml-2 md:ml-6 min-w-0 max-w-[min(100%,11rem)] sm:max-w-none">
            <OrganizationSwitcher />
          </div>

          {/* Plan Tier & Upgrade Pill */}
          {(!currentPlan || currentPlan.slug === 'basic' || currentPlan.price === 0) ? (
            <button
              type="button"
              onClick={() => onViewChange('settings')}
              title="You are on the Free Plan. Click to upgrade features and limits."
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/35 hover:bg-amber-500/25 hover:border-amber-400 transition-all cursor-pointer shadow-sm shadow-amber-500/10"
            >
              <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Free Tier • Upgrade</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onViewChange('settings')}
              title={cycle.hasActiveSubscription 
                ? `Active subscription: ${currentPlan.name}. Renews on ${cycle.renewalDateFormatted} (${cycle.daysRemaining} days remaining). Click to manage.`
                : `Active subscription: ${currentPlan.name}. Click to view details.`}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/35 hover:bg-cyan-500/25 transition-all cursor-pointer"
            >
              <span className="size-1.5 rounded-full bg-cyan-400" />
              <span>{currentPlan.name} Plan{cycle.hasActiveSubscription ? ` • ${cycle.daysRemaining}d left` : ''}</span>
            </button>
          )}
        </div>
        
        {/* User Info and Logout */}
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-end">
          {/* Notification Center */}
          <NotificationCenter />

          {/* Active Role Badge in Top Header */}
          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-mono font-bold shadow-sm ${roleBadge.badgeClass}`}>
            <roleBadge.icon className="size-3.5" />
            <span>{roleBadge.label}</span>
          </div>
          
          <div className={`hidden sm:flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2 max-w-[200px] md:max-w-xs ${theme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100'} backdrop-blur-xl rounded-xl border ${theme === 'dark' ? 'border-cyan-500/20' : 'border-cyan-400/30'} min-w-0`}>
            <User className="size-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <p className={`text-sm ${theme === 'dark' ? 'text-white' : 'text-slate-900'} font-medium truncate`}>{user?.name}</p>
              <p className="text-xs text-cyan-400/70 font-mono truncate">{user?.email}</p>
            </div>
          </div>
          
          <Button
            onClick={logout}
            title="Log out"
            className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-3 sm:px-6"
          >
            <LogOut className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {/* Mobile overlay */}
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={closeMobileNav}
          />
        )}

        {/* Sidebar */}
        <div
          className={cn(
            `w-72 ${theme === 'dark' ? 'bg-slate-900/50' : 'bg-white/70'} backdrop-blur-xl border-r ${theme === 'dark' ? 'border-cyan-500/20' : 'border-cyan-400/30'} flex flex-col shrink-0 relative`,
            'fixed z-50 top-[4.75rem] sm:top-20 bottom-0 left-0 lg:static lg:z-0 lg:top-auto lg:bottom-auto transition-transform duration-200 ease-out',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          {/* Glowing Edge */}
          <div className="absolute top-0 bottom-0 right-0 w-px bg-gradient-to-b from-transparent via-cyan-400/30 to-transparent"></div>

          {/* Active Role Scope Banner */}
          <div className={`mx-4 mt-4 p-2.5 rounded-lg border ${roleBadge.badgeClass} flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <roleBadge.icon className="size-4 shrink-0" />
              <div>
                <p className="text-[11px] font-bold font-mono tracking-wider">{roleBadge.label}</p>
                <p className="text-[10px] text-slate-400 font-mono">{roleBadge.description}</p>
              </div>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 font-mono">RBAC</span>
          </div>

          {/* Status Indicator */}
          <div className={`p-4 border-b ${theme === 'dark' ? 'border-cyan-500/20' : 'border-cyan-400/30'}`}>
            <div className={`p-3 ${theme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-50'} rounded-lg border ${theme === 'dark' ? 'border-cyan-500/30' : 'border-cyan-400/40'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-cyan-400 font-mono">SYSTEM STATUS</span>
                <Radio className="size-3 text-green-400" />
              </div>
              <div className={`h-1 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'} rounded-full overflow-hidden`}>
                <div className="h-full bg-gradient-to-r from-cyan-500 to-green-500 w-full"></div>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-auto">
            {navItems.map((item) => {
              const isActive = currentView === item.id || (item.id === 'projects' && currentView === 'project-transactions');
              return (
                <button
                  key={item.id}
                  onClick={() => selectView(item.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors cursor-pointer',
                    isActive
                      ? `bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-${theme === 'dark' ? '400' : '600'} font-medium border border-cyan-500/30`
                      : `${theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-slate-800/30' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'} border border-transparent`
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1 text-left font-mono">{item.label}</span>
                  {isActive && (
                    <ChevronRight className={`size-4 text-cyan-${theme === 'dark' ? '400' : '600'}`} />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer with AI Status */}
          {can('ai_assistant') && (
            <div className={`p-4 border-t ${theme === 'dark' ? 'border-cyan-500/20' : 'border-cyan-400/30'}`}>
              <div className={`p-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/30`}>
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="size-4 text-purple-400" />
                  <span className="text-xs text-purple-400 font-mono">AI ENGINE</span>
                </div>
                <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>Neural Network Active</p>
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto relative">
          {children}
        </div>
      </div>
    </div>
  );
}