import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { OrganizationLayout, ROLE_ALLOWED_VIEWS } from './OrganizationLayout';
import { OrgWorkspaceNavContext } from './OrgWorkspaceNavContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import { Sparkles, CreditCard } from 'lucide-react';
import type { MemberAccessRole } from '@/services/types';
import { Lock } from 'lucide-react';
import { FinanceOSView } from './FinanceOSView';
import { OrgDashboard } from './OrgDashboard';
import { QuickAdd } from './QuickAdd';
import { TransactionsLedger } from './TransactionsLedger';
import { AccountsWallets } from './AccountsWallets';
import { PaymentMethods } from './PaymentMethods';
import { EnhancedStatementImport } from './EnhancedStatementImport';
import { EnhancedLogicLearning } from './EnhancedLogicLearning';
import { AIFinancialAssistant } from './AIFinancialAssistant';
import { CostingPricing } from './CostingPricing';
import { ReportsView } from './ReportsView';
import { LoansView } from './LoansView';
import { TeamPermissions } from './TeamPermissions';

import { OrgSettings } from './OrgSettings';
import { IntegrationsSettings } from './IntegrationsSettings';
import { RecurringTransactions } from './RecurringTransactions';
import { BudgetPlanning } from './BudgetPlanning';
import { CashFlowForecast } from './CashFlowForecast';
import { ProjectProfitability } from './ProjectProfitability';
import { ProjectTransactionsView } from './ProjectTransactionsView';
import { ProjectProfitDetailView } from './ProjectProfitDetailView';
import { WhatIfSimulator } from './WhatIfSimulator';
import { ProfitIntelligenceView } from './ProfitIntelligenceView';
import { AssetsDepreciationView } from './AssetsDepreciationView';
import { InventoryManagementView } from './InventoryManagementView';
import { ActiveSessionsView } from './ActiveSessionsView';
import { AuditLogView } from './AuditLogView';
import { PayrollPayslipsAI } from './PayrollPayslipsAI';

export type OrgView = 
  | 'finance-os'
  | 'dashboard' 
  | 'quick-add'
  | 'transactions' 
  | 'recurring'
  | 'accounts'
  | 'payment-methods'
  | 'import' 
  | 'logic'
  | 'ai-assistant'
  | 'profit-intelligence'
  | 'budgets'
  | 'forecast'
  | 'projects'
  | 'project-transactions'
  | 'project-detail'
  | 'simulator'
  | 'costing' 
  | 'reports' 
  | 'loans' 
  | 'assets'
  | 'inventory'

  | 'team' 
  | 'payroll' 
  | 'settings'
  | 'integrations'
  | 'active-sessions'
  | 'audit-log';

const ALL_ORG_VIEWS: readonly OrgView[] = [
  'finance-os', 'dashboard', 'quick-add', 'transactions', 'recurring', 'accounts', 'payment-methods',
  'import', 'logic', 'ai-assistant', 'profit-intelligence', 'budgets', 'forecast', 'projects', 'project-transactions', 'project-detail', 'simulator',
  'costing', 'reports', 'loans', 'assets', 'inventory', 'team', 'payroll', 'settings', 'integrations',
  'active-sessions', 'audit-log',
];

function isOrgView(v: unknown): v is OrgView {
  return typeof v === 'string' && (ALL_ORG_VIEWS as readonly string[]).includes(v);
}

/** `?view=` wins; `/dashboard` with no param opens the sidebar **Dashboard** (ORG-P02), not Finance OS. */
function initialViewFromPathAndSearch(pathname: string): OrgView {
  if (typeof window === 'undefined') return 'finance-os';
  const v = new URLSearchParams(window.location.search).get('view');
  if (v === 'payroll') return 'payroll';
  if (v && isOrgView(v)) return v;
  if (pathname === '/dashboard') return 'dashboard';
  return 'finance-os';
}

export function OrganizationWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentView, setCurrentView] = useState<OrgView>(() => initialViewFromPathAndSearch(location.pathname));

  /** Single handler: state + `?view=` so CTAs work even if context is missed, and URL is bookmarkable. */
  const applyView = useCallback(
    (view: OrgView, extraParams?: Record<string, string | null | undefined>) => {
      setCurrentView(view);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', view);
          if (extraParams) {
            Object.entries(extraParams).forEach(([k, v]) => {
              if (v === null || v === undefined) {
                next.delete(k);
              } else {
                next.set(k, v);
              }
            });
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** Keep state in sync with browser back/forward and direct URL edits. */
  useEffect(() => {
    const v = searchParams.get('view');
    if (v === 'payroll-legacy-redirect') {
      applyView('dashboard', { projectId: null });
      return;
    }
    if (v && isOrgView(v)) setCurrentView(v);
  }, [searchParams, applyView]);

  /** Deep links from routes without nav context (e.g. legacy `/organization` dashboard CTAs). */
  useEffect(() => {
    const raw = (location.state as { orgView?: unknown } | null)?.orgView;
    if (!isOrgView(raw)) return;
    applyView(raw);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate, applyView]);

  const { userRole, accessRole, membership } = useAuth();
  const activeRole: MemberAccessRole =
    accessRole ||
    membership?.accessRole ||
    (userRole === 'owner' || userRole === 'admin' ? 'org_admin' : 'team_member');

  const { canAccessView } = usePermissions();
  const { isViewAllowedByPlan, currentPlan, getRequiredFeature } = usePlanEntitlements();
  const isPlanPermitted = isViewAllowedByPlan(currentView);
  const allowedViews = ROLE_ALLOWED_VIEWS[activeRole] || ROLE_ALLOWED_VIEWS.team_member;
  const isViewPermitted =
    canAccessView(currentView) &&
    (allowedViews.includes(currentView) ||
      ((currentView === 'project-transactions' || currentView === 'project-detail') && allowedViews.includes('projects')));

  const renderView = () => {
    if (!isPlanPermitted) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-8">
          <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900/90 border border-amber-500/30 text-center space-y-5 shadow-2xl">
            <div className="size-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sparkles className="size-8" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                Plan Entitlement Required
              </span>
              <h2 className="text-xl font-bold text-white mt-3">Feature Locked by Subscription Plan</h2>
              <p className="text-xs text-slate-400 mt-2 font-mono leading-relaxed">
                The <strong>{currentView}</strong> module is not included in your organization's active{' '}
                <strong className="text-white">{currentPlan?.name || 'Basic'} Plan</strong>.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs font-mono text-left space-y-1">
              <p className="text-slate-400">Required Capability:</p>
              <p className="text-cyan-300 font-bold capitalize">
                {getRequiredFeature(currentView)?.label || currentView.replace(/-/g, ' ')}
              </p>
            </div>
            <button
              onClick={() => {
                navigate('/dashboard?view=settings&tab=billing');
                applyView('settings');
              }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-mono text-xs font-bold shadow-lg hover:brightness-110 transition-all cursor-pointer"
            >
              <CreditCard className="size-4" />
              Upgrade Plan in Settings → Billing
            </button>
          </div>
        </div>
      );
    }

    if (!isViewPermitted) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-8">
          <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900/90 border border-red-500/30 text-center space-y-4 shadow-2xl">
            <div className="size-14 mx-auto rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
              <Lock className="size-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Access Restricted</h2>
              <p className="text-sm text-slate-400 mt-2 font-mono">
                Your role (<strong>{activeRole.replace('_', ' ').toUpperCase()}</strong>) does not have permission to access the <strong>{currentView}</strong> section.
              </p>
            </div>
            <button
              onClick={() => applyView('finance-os')}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-mono text-xs font-bold hover:brightness-110 transition-all cursor-pointer"
            >
              Return to Allowed Dashboard
            </button>
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'finance-os':
        return <OrgDashboard />;
      case 'dashboard':
        return <FinanceOSView />;
      case 'quick-add':
        return <QuickAdd />;
      case 'transactions':
        return <TransactionsLedger />;
      case 'recurring':
        return <RecurringTransactions />;
      case 'accounts':
        return <AccountsWallets />;
      case 'payment-methods':
        return <PaymentMethods />;
      case 'import':
        return <EnhancedStatementImport />;
      case 'logic':
        return <EnhancedLogicLearning />;
      case 'ai-assistant':
        return <AIFinancialAssistant />;
      case 'profit-intelligence':
        return <ProfitIntelligenceView />;
      case 'budgets':
        return <BudgetPlanning />;
      case 'forecast':
        return <CashFlowForecast />;
      case 'projects':
        return <ProjectProfitability />;
      case 'project-transactions': return <ProjectTransactionsView />;

      case 'project-detail': return <ProjectProfitDetailView />;

      case 'simulator':
        return <WhatIfSimulator />;
      case 'costing':
        return <CostingPricing />;
      case 'reports':
        return <ReportsView />;
      case 'loans':
        return <LoansView />;
      case 'assets':
        return <AssetsDepreciationView />;
      case 'inventory':
        return <InventoryManagementView />;


      case 'team':
        return <TeamPermissions />;
      case 'payroll':
        return <PayrollPayslipsAI />;
      case 'settings':
        return <OrgSettings />;
      case 'integrations':
        return <IntegrationsSettings />;
      case 'active-sessions':
        return <ActiveSessionsView />;
      case 'audit-log':
        return <AuditLogView />;
      default:
        return <OrgDashboard />;
    }
  };

  return (
    <OrgWorkspaceNavContext.Provider value={applyView as (view: string) => void}>
      <OrganizationLayout currentView={currentView} onViewChange={applyView}>
        {renderView()}
      </OrganizationLayout>
    </OrgWorkspaceNavContext.Provider>
  );
}