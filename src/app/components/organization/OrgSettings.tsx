import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  Crown,
  Sparkles,
  Database,
  DollarSign,
  Edit2,
  FileDown,
  FileText,
  FolderKanban,
  Globe,
  Layers,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Tag,
  Trash2,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { organizationService } from '@/services/organizationService';
import { departmentService } from '@/services/departmentService';
import { projectService } from '@/services/projectService';
import { useMutation, useServiceArray, useService } from '@/hooks/useService';
import type { Organization, Department as OrgDepartment, Project } from '@/services/types';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';

import { ActiveSessionsView } from './ActiveSessionsView';
import { AuditLogView } from './AuditLogView';
import { DataExportCenter } from './DataExportCenter';
import { OrganizationBillingSection } from './OrganizationBillingSection';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { calculateSubscriptionCycle } from '@/utils/subscriptionCycle';

type SettingsView = 'general' | 'financial' | 'team' | 'notifications' | 'security' | 'audit' | 'data' | 'billing';

interface Currency {
  code: string;
  name: string;
  symbol: string;
  enabled: boolean;
}

interface Department {
  id: string;
  name: string;
  color: string;
}

interface FeatureToggle {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  icon: any;
  category: 'financial' | 'automation' | 'team' | 'reporting';
}

// Mock data
const currencies: Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', enabled: true },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', enabled: true },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', enabled: true },
  { code: 'EUR', name: 'Euro', symbol: '€', enabled: false },
  { code: 'GBP', name: 'British Pound', symbol: '£', enabled: false },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', enabled: false },
];

const featureToggles: FeatureToggle[] = [
  {
    id: 'personal_finance',
    name: 'Personal Finance',
    description: 'Track personal and business transactions separately',
    enabled: true,
    icon: DollarSign,
    category: 'financial',
  },
  {
    id: 'auto_categorization',
    name: 'Auto-Categorization',
    description: 'Automatically categorize transactions using AI',
    enabled: true,
    icon: Zap,
    category: 'automation',
  },
  {
    id: 'profit_intelligence',
    name: 'Profit Intelligence',
    description: 'Advanced profit analysis and insights',
    enabled: true,
    icon: BarChart3,
    category: 'financial',
  },
  {
    id: 'multi_currency',
    name: 'Multi-Currency Support',
    description: 'Handle transactions in multiple currencies',
    enabled: true,
    icon: Globe,
    category: 'financial',
  },
  {
    id: 'team_collaboration',
    name: 'Team Collaboration',
    description: 'Enable team members to collaborate on transactions',
    enabled: true,
    icon: Users,
    category: 'team',
  },
  {
    id: 'automated_reports',
    name: 'Automated Reports',
    description: 'Schedule and receive automated financial reports',
    enabled: false,
    icon: FileText,
    category: 'reporting',
  },
  {
    id: 'budget_alerts',
    name: 'Budget Alerts',
    description: 'Get notified when approaching budget limits',
    enabled: true,
    icon: Bell,
    category: 'automation',
  },
  {
    id: 'recurring_transactions',
    name: 'Recurring Transactions',
    description: 'Automatically create recurring transactions',
    enabled: true,
    icon: RefreshCw,
    category: 'automation',
  },
];

const COLORS = {
  purple: '#a855f7',
  cyan: '#06b6d4',
  pink: '#ec4899',
  green: '#10b981',
  amber: '#f59e0b',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f97316',
};

const DEPT_DOT_KEYS = ['purple', 'cyan', 'pink', 'green', 'amber', 'blue'] as const;

export function OrgSettings() {
  const { currentOrganization, applyOrganizationUpdate, hasPermission } = useAuth();
  const orgId = currentOrganization?.id ?? '';
  const canWrite = hasPermission('write');

  const { data: orgRecord, loading: orgLoading, error: orgLoadError, refetch: refetchOrg } = useService(
    () =>
      orgId
        ? organizationService.getById(orgId)
        : Promise.resolve({ success: true as const, data: null }),
    [orgId],
    orgId ? (['organizations'] as const) : undefined,
  );

  const { data: deptRows, loading: deptsLoading, refetch: refetchDepts, mutate: mutateDepts } = useServiceArray(
    () =>
      orgId
        ? departmentService.getAll(orgId)
        : Promise.resolve({ success: true as const, data: [] }),
    [orgId],
    orgId ? (['departments'] as const) : undefined,
  );

  const { data: projectRows, loading: projectsLoading, refetch: refetchProjects, mutate: mutateProjects } = useServiceArray(
    () =>
      orgId
        ? projectService.getAll(orgId)
        : Promise.resolve({ success: true as const, data: [] }),
    [orgId],
    orgId ? (['projects'] as const) : undefined,
  );

  const { execute: executeUpdate } = useMutation((updates: Partial<Organization>) =>
    organizationService.update(orgId, updates),
  );

  const { hasPlanFeature, currentPlan, allowedFeatures = [], subscription } = usePlanEntitlements();
  const cycle = useMemo(() => {
    return calculateSubscriptionCycle(subscription, currentPlan?.price, currentPlan?.slug);
  }, [subscription, currentPlan?.price, currentPlan?.slug]);
  const { enabledCurrencies: globalEnabledCurrencies, featureFlags: globalFeatureFlags } = usePlatformSettings();
  const availablePlatformCurrencies: Currency[] = globalEnabledCurrencies.map(c => ({
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    enabled: c.enabled,
  }));
  const [whiteLabelBrandName, setWhiteLabelBrandName] = useState('');
  const [whiteLabelSubtitle, setWhiteLabelSubtitle] = useState('');
  const [whiteLabelHideDefault, setWhiteLabelHideDefault] = useState(false);
  const [activeView, setActiveView] = useState<SettingsView>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'billing') return 'billing';
      if (tab === 'financial') return 'financial';
      if (tab === 'team') return 'team';
      if (tab === 'security') return 'security';
    } catch { }
    return 'general';
  });
  const [orgName, setOrgName] = useState('');
  const [fiscalYearStart, setFiscalYearStart] = useState('01-01');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [enabledCurrencies, setEnabledCurrencies] = useState(currencies.filter(c => c.enabled));
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [timezone, setTimezone] = useState('UTC+05:00 - Pakistan Standard Time');
  const [dateFormat, setDateFormat] = useState('MM/DD/YYYY');
  const [features, setFeatures] = useState(featureToggles);
  const [savePending, setSavePending] = useState(false);
  const [teamRequireApproval, setTeamRequireApproval] = useState(true);
  const [teamComments, setTeamComments] = useState(true);
  const [teamActivityNotify, setTeamActivityNotify] = useState(true);
  const [notifTransaction, setNotifTransaction] = useState(true);
  const [notifBudget, setNotifBudget] = useState(true);
  const [notifReport, setNotifReport] = useState(false);
  const [defaultTaxRate, setDefaultTaxRate] = useState<number>(18);
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState('');
  const [accountingBasis, setAccountingBasis] = useState<'cash' | 'accrual'>('accrual');

  // Initialize state from currentOrganization when available
  useEffect(() => {
    if (currentOrganization) {
      setOrgName(currentOrganization.name || '');
      setFiscalYearStart(currentOrganization.fiscalYearStart || '01-01');
      setDefaultCurrency(currentOrganization.currency || 'USD');
      setEmailNotifications(currentOrganization.settings?.notifications ?? true);
      setDefaultTaxRate(currentOrganization.defaultTaxRate ?? currentOrganization.settings?.defaultTaxRate ?? 18);
      setTaxRegistrationNumber(currentOrganization.taxId ?? currentOrganization.settings?.taxRegistrationNumber ?? '');
      setAccountingBasis(currentOrganization.accountingBasis ?? currentOrganization.settings?.accountingBasis ?? 'accrual');
    }
  }, [currentOrganization]);

  useEffect(() => {
    if (!orgRecord) return;
    setOrgName(orgRecord.name || '');
    setFiscalYearStart(orgRecord.fiscalYearStart || '01-01');
    setDefaultCurrency(orgRecord.currency || 'USD');
    setEmailNotifications(orgRecord.settings?.notifications ?? true);
    setDefaultTaxRate(orgRecord.defaultTaxRate ?? orgRecord.settings?.defaultTaxRate ?? 18);
    setTaxRegistrationNumber(orgRecord.taxId ?? orgRecord.settings?.taxRegistrationNumber ?? '');
    setAccountingBasis(orgRecord.accountingBasis ?? orgRecord.settings?.accountingBasis ?? 'accrual');

    // Hydrate workspace features
    if (orgRecord.settings?.features) {
      const fMap = orgRecord.settings.features as Record<string, boolean>;
      setFeatures(featureToggles.map((f) => ({
        ...f,
        enabled: fMap[f.id] !== undefined ? !!fMap[f.id] : f.enabled,
      })));
    }

    // Hydrate timezone & date format
    if (orgRecord.settings?.timezone) {
      setTimezone(orgRecord.settings.timezone);
    }
    if (orgRecord.settings?.dateFormat) {
      setDateFormat(orgRecord.settings.dateFormat);
    }

    // Hydrate team settings
    if (orgRecord.settings?.teamSettings) {
      const ts = orgRecord.settings.teamSettings;
      if (typeof ts.requireApproval === 'boolean') setTeamRequireApproval(ts.requireApproval);
      if (typeof ts.allowComments === 'boolean') setTeamComments(ts.allowComments);
      if (typeof ts.activityNotify === 'boolean') setTeamActivityNotify(ts.activityNotify);
    }

    // Hydrate notification preferences
    if (orgRecord.settings?.notificationPreferences) {
      const np = orgRecord.settings.notificationPreferences;
      if (typeof np.transactionAlerts === 'boolean') setNotifTransaction(np.transactionAlerts);
      if (typeof np.budgetAlerts === 'boolean') setNotifBudget(np.budgetAlerts);
      if (typeof np.reportAlerts === 'boolean') setNotifReport(np.reportAlerts);
    }

    // Hydrate white label settings
    const wl = (orgRecord.settings as any)?.whiteLabel;
    if (wl) {
      setWhiteLabelBrandName(wl.brandName || '');
      setWhiteLabelSubtitle(wl.subtitle || '');
      setWhiteLabelHideDefault(Boolean(wl.hideDefaultBranding));
    } else if (orgRecord.id) {
      try {
        const localWl = localStorage.getItem(`finance_os_whitelabel_${orgRecord.id}`);
        if (localWl) {
          const parsedWl = JSON.parse(localWl);
          setWhiteLabelBrandName(parsedWl.brandName || '');
          setWhiteLabelSubtitle(parsedWl.subtitle || '');
          setWhiteLabelHideDefault(Boolean(parsedWl.hideDefaultBranding));
        }
      } catch { }
    }

    // Hydrate enabled currencies from global platform currencies
    if (Array.isArray(orgRecord.settings?.enabledCurrencies) && orgRecord.settings.enabledCurrencies.length > 0) {
      const savedCodes = new Set(orgRecord.settings.enabledCurrencies);
      savedCodes.add(orgRecord.currency || 'USD');
      setEnabledCurrencies(availablePlatformCurrencies.filter((c) => savedCodes.has(c.code)));
    } else {
      const base = availablePlatformCurrencies.filter((c) => c.enabled);
      const code = orgRecord.currency || 'USD';
      if (!base.some((c) => c.code === code)) {
        const extra = availablePlatformCurrencies.find((c) => c.code === code) || currencies.find((c) => c.code === code);
        if (extra) base.push(extra);
      }
      setEnabledCurrencies(base);
    }
  }, [orgRecord, globalEnabledCurrencies]);

  const resetFromSaved = useCallback(async () => {
    await refetchOrg();
    toast.message('Restored saved values');
  }, [refetchOrg]);

  const saveSettings = useCallback(async () => {
    if (!orgId || !orgRecord) {
      toast.error('Organization not loaded');
      return;
    }
    if (!canWrite) {
      toast.error('You do not have permission to change organization settings');
      return;
    }
    setSavePending(true);

    const featuresMap = features.reduce((acc, f) => {
      acc[f.id] = f.enabled;
      return acc;
    }, {} as Record<string, boolean>);

    const res = await executeUpdate({
      name: orgName.trim() || orgRecord.name,
      fiscalYearStart,
      currency: defaultCurrency,
      baseCurrency: defaultCurrency,
      taxId: taxRegistrationNumber.trim(),
      defaultTaxRate: Number(defaultTaxRate) || 0,
      accountingBasis,
      settings: {
        ...orgRecord.settings,
        features: featuresMap,
        enabledCurrencies: enabledCurrencies.map((c) => c.code),
        timezone,
        dateFormat,
        defaultTaxRate: Number(defaultTaxRate) || 0,
        taxRegistrationNumber: taxRegistrationNumber.trim(),
        accountingBasis,
        teamSettings: {
          requireApproval: teamRequireApproval,
          allowComments: teamComments,
          activityNotify: teamActivityNotify,
        },
        notificationPreferences: {
          email: emailNotifications,
          transactionAlerts: notifTransaction,
          budgetAlerts: notifBudget,
          reportAlerts: notifReport,
        },
        whiteLabel: {
          brandName: whiteLabelBrandName.trim(),
          subtitle: whiteLabelSubtitle.trim(),
          hideDefaultBranding: whiteLabelHideDefault,
        },
        notifications: emailNotifications,
      } as any,
    });
    try {
      localStorage.setItem(
        `finance_os_whitelabel_${orgId}`,
        JSON.stringify({
          brandName: whiteLabelBrandName.trim(),
          subtitle: whiteLabelSubtitle.trim(),
          hideDefaultBranding: whiteLabelHideDefault,
        })
      );
      window.dispatchEvent(new CustomEvent('org-whitelabel-updated'));
    } catch { }
    setSavePending(false);
    if (res.success && res.data) {
      applyOrganizationUpdate(res.data);
      toast.success(res.message || 'Settings saved');
    } else {
      toast.error(res.error || 'Could not save settings');
    }
  }, [
    orgId,
    orgRecord,
    canWrite,
    orgName,
    fiscalYearStart,
    defaultCurrency,
    defaultTaxRate,
    taxRegistrationNumber,
    accountingBasis,
    emailNotifications,
    features,
    enabledCurrencies,
    timezone,
    dateFormat,
    teamRequireApproval,
    teamComments,
    teamActivityNotify,
    notifTransaction,
    notifBudget,
    notifReport,
    whiteLabelBrandName,
    whiteLabelSubtitle,
    whiteLabelHideDefault,
    executeUpdate,
    applyOrganizationUpdate,
  ]);

  const viewButtons = [
    { id: 'general' as const, label: 'General', icon: Building2 },
    { id: 'financial' as const, label: 'Financial', icon: DollarSign },
    { id: 'team' as const, label: 'Team', icon: Users },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'security' as const, label: 'Security', icon: Shield },
    { id: 'audit' as const, label: 'Audit Log', icon: FileText },
    { id: 'data' as const, label: 'Data & Export', icon: Database },
    { id: 'billing' as const, label: 'Billing', icon: CreditCard },
  ];

  const toggleFeature = (featureId: string) => {
    setFeatures((prev) =>
      prev.map((f) => (f.id === featureId ? { ...f, enabled: !f.enabled } : f)),
    );
    toast.success('Feature updated');
  };

  const addCurrency = (currency: Currency) => {
    setEnabledCurrencies([...enabledCurrencies, currency]);
    toast.success(`${currency.code} enabled`);
  };

  const removeCurrency = (code: string) => {
    setEnabledCurrencies(enabledCurrencies.filter(c => c.code !== code));
    toast.success('Currency removed');
  };

  // Department Modal State
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<OrgDepartment | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptBudget, setDeptBudget] = useState('');
  const [deptCostCenter, setDeptCostCenter] = useState('MAIN');
  const [deptIsActive, setDeptIsActive] = useState(true);
  const [deptSubmitting, setDeptSubmitting] = useState(false);

  // Project Modal State
  const [isProjModalOpen, setIsProjModalOpen] = useState(false);
  const [editingProj, setEditingProj] = useState<Project | null>(null);
  const [projName, setProjName] = useState('');
  const [projCode, setProjCode] = useState('');
  const [projClientName, setProjClientName] = useState('');
  const [projDepartmentId, setProjDepartmentId] = useState('');
  const [projStatus, setProjStatus] = useState<Project['status']>('active');
  const [projQuotedAmount, setProjQuotedAmount] = useState('');
  const [projCurrency, setProjCurrency] = useState('USD');
  const [projStartDate, setProjStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [projEndDate, setProjEndDate] = useState('');
  const [projSubmitting, setProjSubmitting] = useState(false);

  const openAddDepartmentModal = () => {
    setEditingDept(null);
    setDeptName('');
    setDeptCode(`D-${Date.now().toString(36).slice(-4).toUpperCase()}`);
    setDeptBudget('');
    setDeptCostCenter('MAIN');
    setDeptIsActive(true);
    setIsDeptModalOpen(true);
  };

  const openEditDepartmentModal = (dept: OrgDepartment) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setDeptCode(dept.code || '');
    setDeptBudget(dept.budget !== undefined && dept.budget !== null ? String(dept.budget) : '');
    setDeptCostCenter(dept.costCenter || 'MAIN');
    setDeptIsActive(dept.isActive ?? true);
    setIsDeptModalOpen(true);
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (!deptName.trim()) {
      toast.error('Department name is required');
      return;
    }
    setDeptSubmitting(true);
    try {
      const payload = {
        name: deptName.trim(),
        code: deptCode.trim() || `D-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        costCenter: deptCostCenter.trim() || 'MAIN',
        budget: deptBudget ? Number(deptBudget) : undefined,
        isActive: deptIsActive,
      };

      if (editingDept) {
        const res = await departmentService.update(editingDept.id, payload, orgId);
        if (res.success) {
          toast.success('Department updated successfully');
          setIsDeptModalOpen(false);
          mutateDepts(deptRows.map((d) => (d.id === editingDept.id ? (res.data || { ...d, ...payload }) : d)));
          await refetchDepts();
        } else {
          toast.error(res.error || 'Failed to update department');
        }
      } else {
        const res = await departmentService.create(orgId, payload);
        if (res.success) {
          toast.success('Department created successfully');
          setIsDeptModalOpen(false);
          if (res.data) mutateDepts([res.data, ...deptRows]);
          await refetchDepts();
        } else {
          toast.error(res.error || 'Failed to create department');
        }
      }
    } catch {
      toast.error('An error occurred while saving department');
    } finally {
      setDeptSubmitting(false);
    }
  };

  const removeDepartment = async (id: string) => {
    if (!orgId) return;
    const linkedProjects = projectRows.filter((p) => p.departmentId === id);
    if (linkedProjects.length > 0) {
      toast.error(
        `Cannot delete department: ${linkedProjects.length} project(s) are assigned to it. Reassign or delete those projects first.`,
      );
      return;
    }
    mutateDepts(deptRows.filter((d) => d.id !== id));
    const res = await departmentService.delete(id, orgId);
    if (res.success) {
      toast.success('Department removed');
      await refetchDepts();
    } else {
      toast.error(res.error || 'Could not remove department');
      await refetchDepts();
    }
  };

  const openAddProjectModal = () => {
    if (deptRows.length === 0) {
      toast.error('Please create at least one department first before creating projects.');
      return;
    }
    setEditingProj(null);
    setProjName('');
    setProjCode(`PRJ-${Date.now().toString(36).slice(-4).toUpperCase()}`);
    setProjClientName('');
    setProjDepartmentId(deptRows[0]?.id || '');
    setProjStatus('active');
    setProjQuotedAmount('');
    setProjCurrency(defaultCurrency || 'USD');
    setProjStartDate(new Date().toISOString().slice(0, 10));
    setProjEndDate('');
    setIsProjModalOpen(true);
  };

  const openEditProjectModal = (proj: Project) => {
    setEditingProj(proj);
    setProjName(proj.name);
    setProjCode(proj.code || '');
    setProjClientName(proj.clientName || '');
    setProjDepartmentId(proj.departmentId || deptRows[0]?.id || '');
    setProjStatus(proj.status || 'active');
    setProjQuotedAmount(proj.quotedAmount ? String(proj.quotedAmount) : '');
    setProjCurrency(proj.currency || defaultCurrency || 'USD');
    setProjStartDate(proj.startDate || new Date().toISOString().slice(0, 10));
    setProjEndDate(proj.endDate || '');
    setIsProjModalOpen(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (!projName.trim()) {
      toast.error('Project name is required');
      return;
    }
    if (!projDepartmentId) {
      toast.error('Please select a department for this project');
      return;
    }
    setProjSubmitting(true);
    try {
      const payload = {
        name: projName.trim(),
        code: projCode.trim() || `PRJ-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        clientName: projClientName.trim(),
        departmentId: projDepartmentId,
        status: projStatus,
        quotedAmount: projQuotedAmount ? Number(projQuotedAmount) : 0,
        actualCost: editingProj ? editingProj.actualCost : 0,
        currency: projCurrency || defaultCurrency || 'USD',
        startDate: projStartDate || new Date().toISOString().slice(0, 10),
        endDate: projEndDate.trim() || undefined,
      };

      if (editingProj) {
        const res = await projectService.update(editingProj.id, payload, orgId);
        if (res.success) {
          toast.success('Project updated successfully');
          setIsProjModalOpen(false);
          mutateProjects(projectRows.map((p) => (p.id === editingProj.id ? (res.data || { ...p, ...payload }) : p)));
          await refetchProjects();
        } else {
          toast.error(res.error || 'Failed to update project');
        }
      } else {
        const res = await projectService.create(orgId, payload);
        if (res.success) {
          toast.success('Project created successfully');
          setIsProjModalOpen(false);
          if (res.data) mutateProjects([res.data, ...projectRows]);
          await refetchProjects();
        } else {
          toast.error(res.error || 'Failed to create project');
        }
      }
    } catch {
      toast.error('An error occurred while saving project');
    } finally {
      setProjSubmitting(false);
    }
  };

  const removeProject = async (id: string) => {
    if (!orgId) return;
    mutateProjects(projectRows.filter((p) => p.id !== id));
    const res = await projectService.delete(id, orgId);
    if (res.success) {
      toast.success('Project deleted');
      await refetchProjects();
    } else {
      toast.error(res.error || 'Could not delete project');
      await refetchProjects();
    }
  };


  if (!orgId) {
    return (
      <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
        <div className="flex items-center gap-3">
          <div
            className="p-3 rounded-xl flex items-center justify-center"
            style={{
              background: AXIOM.iconBoxes.purple,
              boxShadow: AXIOM.shadows.iconPurple,
            }}
          >
            <Settings className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={AXIOM.text.titleStyle}>
              Organization Settings
            </h1>
            <p className="text-slate-400 text-sm">Select an organization to manage settings.</p>
          </div>
        </div>
      </div>
    );
  }

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
              <Settings className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Organization Settings
              </h1>
              <p className="text-slate-400 text-sm">Configure your organization preferences and features</p>
            </div>
          </div>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => void resetFromSaved()}
              disabled={orgLoading || !orgId}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={AXIOM.buttons.secondary}
            >
              <RefreshCw className="size-4" />
              Reset
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => void saveSettings()}
              disabled={savePending || orgLoading || !orgId || !!orgLoadError || !canWrite}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Save className="size-4" />
              {savePending ? 'Saving…' : 'Save Changes'}
            </motion.button>
          </div>
        </div>
      </motion.div>

      {orgId && orgLoading && (
        <p className="text-sm text-slate-400" role="status">
          Loading organization…
        </p>
      )}
      {orgId && orgLoadError && (
        <p className="text-sm text-amber-400/90" role="alert">
          {orgLoadError}. Some fields may be out of date until this loads.
        </p>
      )}

      {/* View Selector */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-4 gap-2 p-2 rounded-2xl"
        style={AXIOM.containers.list}
      >
        {viewButtons.map((btn) => (
          <motion.button
            key={btn.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveView(btn.id)}
            className="px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={activeView === btn.id ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
          >
            <btn.icon className="size-4" />
            {btn.label}
          </motion.button>
        ))}
      </motion.div>

      {/* General Settings */}
      {activeView === 'general' && (
        <div className="space-y-4">
          {/* Active Subscription & Upgrade Banner */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.8) 100%)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              boxShadow: '0 20px 40px -15px rgba(6, 182, 212, 0.15)',
            }}
          >
            <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl -z-10" />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="size-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
                    boxShadow: '0 10px 25px -5px rgba(6, 182, 212, 0.4)',
                  }}
                >
                  <Crown className="size-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-white">
                      {currentPlan?.name || 'Basic'} Plan
                    </h3>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${(!currentPlan || currentPlan.slug === 'basic' || currentPlan.price === 0)
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      }`}>
                      {(!currentPlan || currentPlan.slug === 'basic' || currentPlan.price === 0) ? 'Free Tier' : 'Active Subscription'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    {currentPlan?.description || 'Essential financial ledger and statement import for your organization.'}
                  </p>
                  <div className="flex items-center gap-4 mt-3 text-xs font-mono text-slate-400 flex-wrap">
                    <span>Seats: <strong className="text-white">{currentOrganization?.settings?.limits?.usersUsed ?? 1}/{currentPlan?.limits?.users ?? 5}</strong></span>
                    <span>Next Invoice: <strong className="text-white">Rs {currentPlan?.price ? currentPlan.price.toLocaleString() : '0'}</strong></span>
                    {cycle.hasActiveSubscription && (
                      <span>Renewal: <strong className="text-cyan-400">{cycle.renewalDateFormatted} ({cycle.daysRemaining}d left)</strong></span>
                    )}
                    <span>Features: <strong className="text-cyan-400">{allowedFeatures.length} active</strong></span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveView('billing')}
                  className="px-5 py-2.5 rounded-xl font-mono text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 via-blue-600 to-purple-600 hover:from-cyan-500 hover:via-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className="size-3.5" />
                  <span>View Upgrade Options</span>
                </button>
              </div>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: AXIOM.iconBoxes.cyan,
                  boxShadow: AXIOM.shadows.iconCyan,
                }}
              >
                <Building2 className="size-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Organization Information</h3>
                <p className="text-sm text-slate-400">Basic details about your organization</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm text-slate-400 block mb-2">Organization Name</label>
                <input
                  type="text"
                  value={orgName || ''}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-2">Fiscal Year Start (MM-DD)</label>
                <input
                  type="text"
                  value={fiscalYearStart || '01-01'}
                  onChange={(e) => setFiscalYearStart(e.target.value)}
                  placeholder="01-01"
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-2">Time Zone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                >
                  <option>UTC+05:00 - Pakistan Standard Time</option>
                  <option>UTC+04:00 - Gulf Standard Time</option>
                  <option>UTC+00:00 - Coordinated Universal Time</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-2">Date Format</label>
                <select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                >
                  <option>MM/DD/YYYY</option>
                  <option>DD/MM/YYYY</option>
                  <option>YYYY-MM-DD</option>
                </select>
              </div>
            </div>
          </motion.div>

          {/* Departments Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.purple,
                    boxShadow: AXIOM.shadows.iconPurple,
                  }}
                >
                  <Layers className="size-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Departments</h3>
                  <p className="text-sm text-slate-400">Organize your team and track project allocations into departments</p>
                </div>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openAddDepartmentModal()}
                disabled={!canWrite || !orgId}
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(59, 130, 246, 0.4))',
                  border: '1px solid rgba(168, 85, 247, 0.5)',
                  boxShadow: '0 10px 25px -10px rgba(168, 85, 247, 0.5)',
                  color: '#ffffff',
                }}
              >
                <Plus className="size-4" />
                Add Department
              </motion.button>
            </div>

            {deptsLoading && (
              <p className="text-xs text-slate-400 mb-3" role="status">
                Loading departments…
              </p>
            )}

            {deptRows.length === 0 && !deptsLoading ? (
              <div className="text-center py-8 rounded-xl border border-dashed border-slate-700/60 p-6">
                <Layers className="size-10 text-slate-500 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium text-slate-300">No departments configured yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  Create departments (e.g. Engineering, Marketing, Operations) to assign projects and budgets.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {deptRows.map((dept: OrgDepartment, i: number) => (
                  <div
                    key={dept.id}
                    className="p-4 rounded-xl flex items-center justify-between group transition-all"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                        style={{
                          background: COLORS[DEPT_DOT_KEYS[i % DEPT_DOT_KEYS.length]],
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white truncate">{dept.name}</span>
                          {dept.code && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/50 shrink-0">
                              {dept.code}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                          {dept.budget !== undefined && dept.budget !== null && dept.budget > 0 ? (
                            <span className="text-emerald-400 font-medium">
                              Budget: {formatCurrency(dept.budget, defaultCurrency)}
                            </span>
                          ) : (
                            <span className="text-slate-500">No budget limit</span>
                          )}
                          {dept.costCenter && (
                            <span className="text-slate-500 text-[11px]">• {dept.costCenter}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => openEditDepartmentModal(dept)}
                        disabled={!canWrite}
                        className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
                        title="Edit Department"
                      >
                        <Edit2 className="size-3.5 text-cyan-400" />
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => void removeDepartment(dept.id)}
                        disabled={!canWrite}
                        className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-30"
                        title="Delete Department"
                      >
                        <Trash2 className="size-3.5 text-rose-400" />
                      </motion.button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Projects Section (Linked to Departments) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.27 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.blue,
                    boxShadow: AXIOM.shadows.iconBlue,
                  }}
                >
                  <FolderKanban className="size-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Projects</h3>
                  <p className="text-sm text-slate-400">Manage client and internal projects assigned to departments</p>
                </div>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openAddProjectModal()}
                disabled={!canWrite || !orgId}
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4), rgba(6, 182, 212, 0.4))',
                  border: '1px solid rgba(59, 130, 246, 0.5)',
                  boxShadow: '0 10px 25px -10px rgba(59, 130, 246, 0.5)',
                  color: '#ffffff',
                }}
              >
                <Plus className="size-4" />
                Add Project
              </motion.button>
            </div>

            {projectsLoading && (
              <p className="text-xs text-slate-400 mb-3" role="status">
                Loading projects…
              </p>
            )}

            {projectRows.length === 0 && !projectsLoading ? (
              <div className="text-center py-8 rounded-xl border border-dashed border-slate-700/60 p-6">
                <FolderKanban className="size-10 text-slate-500 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium text-slate-300">No projects added yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  {deptRows.length === 0
                    ? 'Add a department above first, then you can create projects linked to that department.'
                    : 'Click "Add Project" to create a new project linked to one of your departments.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projectRows.map((proj: Project) => {
                  const linkedDeptIndex = deptRows.findIndex((d) => d.id === proj.departmentId);
                  const linkedDept = linkedDeptIndex !== -1 ? deptRows[linkedDeptIndex] : null;
                  const deptColor =
                    linkedDeptIndex !== -1
                      ? COLORS[DEPT_DOT_KEYS[linkedDeptIndex % DEPT_DOT_KEYS.length]]
                      : '#3b82f6';

                  const statusBadgeStyle =
                    proj.status === 'active'
                      ? AXIOM.badges.success
                      : proj.status === 'completed'
                        ? AXIOM.badges.purple
                        : proj.status === 'on_hold'
                          ? AXIOM.badges.warning
                          : proj.status === 'cancelled'
                            ? AXIOM.badges.danger
                            : AXIOM.badges.info;

                  return (
                    <div
                      key={proj.id}
                      className="p-5 rounded-xl flex flex-col justify-between group transition-all border border-slate-800/80 hover:border-slate-700/80"
                      style={AXIOM.containers.item}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <h4 className="text-base font-bold text-white truncate">{proj.name}</h4>
                            {proj.code && (
                              <span className="text-[11px] font-mono text-cyan-400/90">
                                {proj.code}
                              </span>
                            )}
                          </div>
                          <span
                            className="text-[11px] font-medium px-2 py-0.5 rounded-full capitalize shrink-0"
                            style={statusBadgeStyle}
                          >
                            {proj.status?.replace('_', ' ') || 'Active'}
                          </span>
                        </div>

                        {/* Department Badge */}
                        <div className="flex items-center gap-1.5 mb-3">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: deptColor }}
                          />
                          <span className="text-xs text-slate-300 font-medium truncate">
                            {linkedDept ? linkedDept.name : 'Unassigned Dept'}
                          </span>
                        </div>

                        {/* Client & Budget */}
                        <div className="space-y-1.5 text-xs text-slate-400">
                          {proj.clientName && (
                            <div className="flex items-center gap-1.5 text-slate-300">
                              <User className="size-3.5 text-slate-500 shrink-0" />
                              <span className="truncate">{proj.clientName}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                            <span className="text-slate-500">Quoted Amount:</span>
                            <span className="text-sm font-bold text-white">
                              {formatCurrency(proj.quotedAmount || 0, proj.currency || defaultCurrency)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-500">
                        <span>{proj.startDate || 'No date'}</span>
                        <div className="flex items-center gap-1">
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => openEditProjectModal(proj)}
                            disabled={!canWrite}
                            className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
                            title="Edit Project"
                          >
                            <Edit2 className="size-3.5 text-cyan-400" />
                          </motion.button>
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => void removeProject(proj.id)}
                            disabled={!canWrite}
                            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-30"
                            title="Delete Project"
                          >
                            <Trash2 className="size-3.5 text-rose-400" />
                          </motion.button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>


          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: AXIOM.iconBoxes.amber,
                  boxShadow: AXIOM.shadows.iconAmber,
                }}
              >
                <Zap className="size-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Workspace features</h3>
                <p className="text-sm text-slate-400">Enable or disable workspace features. All selections save permanently to your organization configuration.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {features.map((f) => (
                <div
                  key={f.id}
                  className="p-4 rounded-xl flex items-start justify-between gap-3"
                  style={AXIOM.containers.item}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-slate-700/50">
                      <f.icon className="size-5 text-cyan-300" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{f.name}</p>
                      <p className="text-sm text-slate-400">{f.description}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={f.enabled}
                      onChange={() => toggleFeature(f.id)}
                    />
                    <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                  </label>
                </div>
              ))}
            </div>
          </motion.div>

          {/* White Label Mode Branding Section (Controlled by Platform Global Feature Flag) */}
          {globalFeatureFlags.white_label_mode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.purple,
                    boxShadow: AXIOM.shadows.iconPurple,
                  }}
                >
                  <Crown className="size-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-white">White Label Portal Branding</h3>
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      Platform Enabled
                    </span>
                  </div>
                  <p className="text-sm text-slate-400">
                    Customize portal header brand name, subtitle, and hide default "Finance OS" branding
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm text-slate-400 block mb-2">Custom Portal Brand Title</label>
                  <input
                    type="text"
                    placeholder={orgName || 'e.g. Acme Capital Portal'}
                    value={whiteLabelBrandName}
                    onChange={(e) => setWhiteLabelBrandName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-400 block mb-2">Custom Header Subtitle</label>
                  <input
                    type="text"
                    placeholder="e.g. Enterprise Financial Operations"
                    value={whiteLabelSubtitle}
                    onChange={(e) => setWhiteLabelSubtitle(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
              </div>
              <div className="mt-4 p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
                <div>
                  <p className="text-white font-medium text-sm">Hide "Finance OS" System Branding</p>
                  <p className="text-xs text-slate-400">Replace default platform branding in the organization workspace header</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={whiteLabelHideDefault}
                    onChange={(e) => setWhiteLabelHideDefault(e.target.checked)}
                  />
                  <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                </label>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Financial Settings */}
      {activeView === 'financial' && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: AXIOM.iconBoxes.green,
                  boxShadow: AXIOM.shadows.iconGreen,
                }}
              >
                <Globe className="size-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Currency Settings</h3>
                <p className="text-sm text-slate-400">Manage enabled currencies and default currency</p>
              </div>
            </div>

            <div className="mb-6">
              <label className="text-sm text-slate-400 block mb-2">Default Currency</label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                className="w-full md:w-1/2 px-4 py-3 rounded-xl text-sm"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                  color: AXIOM.inputs.color,
                }}
              >
                {enabledCurrencies.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code} - {curr.name} ({curr.symbol})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-slate-400 block mb-3">Enabled Currencies</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {enabledCurrencies.map((curr) => (
                  <div
                    key={curr.code}
                    className="p-4 rounded-xl flex items-center justify-between"
                    style={AXIOM.containers.item}
                  >
                    <div>
                      <p className="text-white font-medium">{curr.code}</p>
                      <p className="text-xs text-slate-400">{curr.name}</p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => removeCurrency(curr.code)}
                      className="text-red-400"
                    >
                      <X className="size-4" />
                    </motion.button>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="text-sm text-slate-400 block mb-3">
                  Available Global Currencies (Managed by Platform Settings)
                </label>
                <div className="flex flex-wrap gap-2">
                  {availablePlatformCurrencies.filter(c => !enabledCurrencies.find(ec => ec.code === c.code)).map((curr) => (
                    <motion.button
                      key={curr.code}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => addCurrency(curr)}
                      className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                      style={AXIOM.buttons.secondary}
                    >
                      <Plus className="size-3" />
                      {curr.code} ({curr.symbol})
                    </motion.button>
                  ))}
                </div>
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
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: AXIOM.iconBoxes.amber,
                  boxShadow: AXIOM.shadows.iconAmber,
                }}
              >
                <Tag className="size-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Tax & Compliance</h3>
                <p className="text-sm text-slate-400">Configure tax rates and compliance settings</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="text-sm text-slate-400 block mb-2">Default Tax Rate (%)</label>
                <input
                  type="number"
                  value={defaultTaxRate}
                  onChange={(e) => setDefaultTaxRate(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-2">Tax Registration Number</label>
                <input
                  type="text"
                  placeholder="Enter tax ID"
                  value={taxRegistrationNumber}
                  onChange={(e) => setTaxRegistrationNumber(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-2">Accounting Basis</label>
                <select
                  value={accountingBasis}
                  onChange={(e) => setAccountingBasis(e.target.value as 'cash' | 'accrual')}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                >
                  <option value="accrual">Accrual Basis</option>
                  <option value="cash">Cash Basis</option>
                </select>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Team Settings */}
      {activeView === 'team' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Users className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Team Preferences</h3>
              <p className="text-sm text-slate-400">Configure team collaboration settings</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div>
                <p className="text-white font-medium">Require Approval for Transactions</p>
                <p className="text-sm text-slate-400 mt-1">Team members need admin approval for new transactions</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={teamRequireApproval}
                  onChange={(e) => setTeamRequireApproval(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>

            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div>
                <p className="text-white font-medium">Enable Team Comments</p>
                <p className="text-sm text-slate-400 mt-1">Allow team members to add comments on transactions</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={teamComments}
                  onChange={(e) => setTeamComments(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>

            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div>
                <p className="text-white font-medium">Activity Notifications</p>
                <p className="text-sm text-slate-400 mt-1">Notify admins of team member activities</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={teamActivityNotify}
                  onChange={(e) => setTeamActivityNotify(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>
          </div>
        </motion.div>
      )}

      {/* Notifications */}
      {activeView === 'notifications' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.amber,
                boxShadow: AXIOM.shadows.iconAmber,
              }}
            >
              <Bell className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Notification Preferences</h3>
              <p className="text-sm text-slate-400">Control how and when you receive notifications</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: AXIOM.iconBoxes.cyan }}>
                  <Mail className="size-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-medium">Email Notifications</p>
                  <p className="text-sm text-slate-400">Receive updates via email (included when you save)</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>

            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: AXIOM.iconBoxes.green }}>
                  <DollarSign className="size-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-medium">Transaction Alerts</p>
                  <p className="text-sm text-slate-400">Notify on new transactions</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={notifTransaction}
                  onChange={(e) => setNotifTransaction(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>

            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: AXIOM.iconBoxes.amber }}>
                  <AlertCircle className="size-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-medium">Budget Warnings</p>
                  <p className="text-sm text-slate-400">Alert when approaching budget limits</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={notifBudget}
                  onChange={(e) => setNotifBudget(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>

            <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: AXIOM.iconBoxes.blue }}>
                  <FileText className="size-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-medium">Report Reminders</p>
                  <p className="text-sm text-slate-400">Weekly/monthly report summaries</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={notifReport}
                  onChange={(e) => setNotifReport(e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full peer bg-slate-700 peer-checked:after:translate-x-full peer-checked:bg-purple-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
              </label>
            </div>
          </div>
        </motion.div>
      )}

      {/* Security Settings */}
      {activeView === 'security' && <ActiveSessionsView />}

      {/* Audit Log */}
      {activeView === 'audit' && <AuditLogView />}

      {/* Data & Export */}
      {activeView === 'data' && <DataExportCenter />}

      {/* Billing */}
      {activeView === 'billing' && <OrganizationBillingSection />}

      {/* Department Modal */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl p-6 border border-slate-700/80 shadow-2xl space-y-4"
            style={{ background: '#0f172a' }}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.purple,
                    boxShadow: AXIOM.shadows.iconPurple,
                  }}
                >
                  <Layers className="size-4 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {editingDept ? 'Edit Department' : 'Add Department'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingDept ? 'Update department details' : 'Create a new department for your team'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDeptModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDepartment} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Department Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Engineering, Creative & Design"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ENG"
                    value={deptCode}
                    onChange={(e) => setDeptCode(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Cost Center
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. MAIN"
                    value={deptCostCenter}
                    onChange={(e) => setDeptCostCenter(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Monthly / Allocation Budget ({defaultCurrency})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 50000"
                  value={deptBudget}
                  onChange={(e) => setDeptBudget(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="deptActiveCheck"
                  checked={deptIsActive}
                  onChange={(e) => setDeptIsActive(e.target.checked)}
                  className="rounded border-slate-700 text-purple-600 focus:ring-purple-500 bg-slate-900 size-4"
                />
                <label htmlFor="deptActiveCheck" className="text-xs text-slate-300 font-medium cursor-pointer">
                  Active Department
                </label>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deptSubmitting}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white flex items-center gap-2 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(59, 130, 246, 0.5))',
                    border: '1px solid rgba(168, 85, 247, 0.6)',
                    boxShadow: '0 10px 25px -10px rgba(168, 85, 247, 0.5)',
                  }}
                >
                  <Save className="size-4" />
                  {deptSubmitting ? 'Saving…' : editingDept ? 'Update Department' : 'Create Department'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Project Modal */}
      {isProjModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-2xl p-6 border border-slate-700/80 shadow-2xl space-y-4"
            style={{ background: '#0f172a' }}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.blue,
                    boxShadow: AXIOM.shadows.iconBlue,
                  }}
                >
                  <FolderKanban className="size-4 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {editingProj ? 'Edit Project' : 'Add Project'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingProj ? 'Update project details and department assignment' : 'Create a project linked to a department'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsProjModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProject} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Website Redesign, Mobile App MVP"
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Project Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PRJ-001"
                    value={projCode}
                    onChange={(e) => setProjCode(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Client Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Acme Corp"
                    value={projClientName}
                    onChange={(e) => setProjClientName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Department * (Required)
                  </label>
                  <select
                    required
                    value={projDepartmentId}
                    onChange={(e) => setProjDepartmentId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    {deptRows.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.code ? `(${d.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Status
                  </label>
                  <select
                    value={projStatus}
                    onChange={(e) => setProjStatus(e.target.value as Project['status'])}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    <option value="active">Active</option>
                    <option value="quoted">Quoted</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Quoted Amount / Budget
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 25000"
                    value={projQuotedAmount}
                    onChange={(e) => setProjQuotedAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Currency
                  </label>
                  <select
                    value={projCurrency}
                    onChange={(e) => setProjCurrency(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    {enabledCurrencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={projStartDate}
                    onChange={(e) => setProjStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    End Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={projEndDate}
                    onChange={(e) => setProjEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsProjModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={projSubmitting}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white flex items-center gap-2 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.5), rgba(6, 182, 212, 0.5))',
                    border: '1px solid rgba(59, 130, 246, 0.6)',
                    boxShadow: '0 10px 25px -10px rgba(59, 130, 246, 0.5)',
                  }}
                >
                  <Save className="size-4" />
                  {projSubmitting ? 'Saving…' : editingProj ? 'Update Project' : 'Create Project'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}