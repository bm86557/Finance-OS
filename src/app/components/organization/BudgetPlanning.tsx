import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { formatCurrency } from '@/lib/formatters';
import { Target, TrendingUp, AlertTriangle, AlertCircle, Plus, Edit, Trash2, DollarSign, CheckCircle, Loader2, Sparkles, Building2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import type { Budget as ServiceBudget } from '@/services/types';

// ── View-model extends service Budget with computed UI fields ───────────
interface Budget extends Omit<ServiceBudget, 'status'> {
  /** Computed: UI status */
  status: 'exceeded' | 'warning' | 'on-track' | 'active' | 'completed';
  /** Computed: human-readable category label */
  category: string;
  /** Category color token */
  categoryColor?: string;
  /** Computed: optional department label */
  department?: string;
  /** Computed: amount alias for budgetedAmount */
  amount: number;
  /** Computed: spent alias for spentAmount */
  spent: number;
  /** Computed: scope */
  scope: 'business' | 'personal';
  /** Computed: alert threshold (default 80) */
  alertThreshold: number;
}

function calculateDefaultEndDate(startDateStr: string, period: Budget['period']): string {
  if (!startDateStr) return '';
  const parts = startDateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '';
  const [year, month, day] = parts;
  
  if (period === 'monthly') {
    const finalYear = month === 12 ? year + 1 : year;
    const finalMonth = month === 12 ? 1 : month + 1;
    const daysInTarget = new Date(finalYear, finalMonth, 0).getDate();
    const finalDay = Math.min(day, daysInTarget);
    return `${finalYear}-${String(finalMonth).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
  } else if (period === 'quarterly') {
    let finalMonth = month + 3;
    let finalYear = year;
    if (finalMonth > 12) {
      finalYear += Math.floor((finalMonth - 1) / 12);
      finalMonth = ((finalMonth - 1) % 12) + 1;
    }
    const daysInTarget = new Date(finalYear, finalMonth, 0).getDate();
    const finalDay = Math.min(day, daysInTarget);
    return `${finalYear}-${String(finalMonth).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
  } else {
    const finalYear = year + 1;
    const daysInTarget = new Date(finalYear, month, 0).getDate();
    const finalDay = Math.min(day, daysInTarget);
    return `${finalYear}-${String(month).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
  }
}

/** Pre-built splits for “Use template”; percentages sum to 100 per template. */
interface BudgetTemplate {
  name: string;
  categories: { category: string; percentage: number }[];
}

const budgetTemplates: BudgetTemplate[] = [
  {
    name: 'Creative agency',
    categories: [
      { category: 'Payroll', percentage: 45 },
      { category: 'Facilities', percentage: 10 },
      { category: 'Marketing', percentage: 15 },
      { category: 'Software', percentage: 12 },
      { category: 'Operations', percentage: 18 },
    ],
  },
  {
    name: 'Lean team',
    categories: [
      { category: 'People', percentage: 55 },
      { category: 'Infrastructure', percentage: 15 },
      { category: 'Growth', percentage: 30 },
    ],
  },
  {
    name: 'Services business',
    categories: [
      { category: 'Delivery', percentage: 40 },
      { category: 'Sales', percentage: 12 },
      { category: 'Admin', percentage: 18 },
      { category: 'Tools', percentage: 15 },
      { category: 'Buffer', percentage: 15 },
    ],
  },
];

export function BudgetPlanning() {
  const { currentOrganization } = useAuth();
  const orgCurrency = currentOrganization?.currency || 'USD';
  const svc = useOrgServices();

  // Load budgets, categories, and departments from the active organization
  const { data: rawBudgets, loading, refetch: refetchBudgets } = useServiceArray(
    () => svc.budgets.getAll(),
    [svc.orgId],
    ['budgets'],
  );

  const { data: rawCategories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );

  const { data: rawDepartments } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );

  const { data: rawProjects } = useServiceArray(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects'],
  );

  const { data: txnPage } = useService(
    () => svc.transactions.getAll({ pageSize: 1000 }),
    [svc.orgId],
    ['transactions'],
  );
  const rawTxns = txnPage?.items ?? [];

  // Filter only expense categories for budget planning (budgets track spending)
  const expenseCategories = useMemo(() => {
    return (rawCategories || []).filter(c => c.type === 'expense');
  }, [rawCategories]);

  // Category, department & project lookup maps
  const categoryMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    (rawCategories || []).forEach(c => {
      map.set(c.id, { name: c.name, color: c.color || '#38bdf8' });
    });
    return map;
  }, [rawCategories]);

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    (rawDepartments || []).forEach(d => {
      map.set(d.id, d.name);
    });
    return map;
  }, [rawDepartments]);

  const projectDeptMap = useMemo(() => {
    const map = new Map<string, string>();
    (rawProjects || []).forEach(p => {
      if (p.departmentId) map.set(p.id, p.departmentId);
    });
    return map;
  }, [rawProjects]);

  // Convert raw service budget to view model with resolved category & department names
  const toViewModel = (b: ServiceBudget): Budget => {
    const threshold = b.alertThreshold != null ? b.alertThreshold : 80;
    
    // Live spend calculation from debit transactions matching budget scope
    const matchingSpent = (rawTxns || [])
      .filter(t => {
        if (t.type !== 'debit') return false;
        if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())) return false;
        const tDate = String(t.date || '').slice(0, 10);
        if (b.startDate && tDate < b.startDate) return false;
        if (b.endDate && tDate > b.endDate) return false;
        
        // Category matching: by ID or resolved name
        if (b.categoryId) {
          const tCatName = t.categoryId ? categoryMap.get(t.categoryId)?.name : undefined;
          const bCatName = categoryMap.get(b.categoryId)?.name;
          const matchesCat = t.categoryId === b.categoryId || (bCatName && tCatName && bCatName.toLowerCase() === tCatName.toLowerCase());
          if (!matchesCat) return false;
        }

        // Department matching: direct department on transaction or inherited via project
        if (b.departmentId) {
          const effectiveDept = t.departmentId || (t.projectId ? projectDeptMap.get(t.projectId) : undefined);
          if (effectiveDept !== b.departmentId) return false;
        }

        if (b.projectId && t.projectId !== b.projectId) return false;

        // Scope matching
        const tScope = (t as any).scope || ((t.tags || []).includes('personal') ? 'personal' : (t.tags || []).includes('business') ? 'business' : undefined);
        if (b.scope && tScope && tScope !== b.scope) return false;

        return true;
      })
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);

    const serverSpent = b.spentAmount != null && !isNaN(Number(b.spentAmount)) ? Number(b.spentAmount) : 0;
    const computedSpent = Math.round(matchingSpent * 100) / 100;
    const actualSpent = computedSpent > 0 ? computedSpent : serverSpent;
    const pct = b.budgetedAmount > 0 ? (actualSpent / b.budgetedAmount) * 100 : 0;
    const catInfo = b.categoryId ? categoryMap.get(b.categoryId) : undefined;
    const deptName = b.departmentId ? departmentMap.get(b.departmentId) : undefined;

    return {
      ...b,
      category: catInfo?.name || b.categoryId || 'General',
      categoryColor: catInfo?.color,
      department: deptName || b.departmentId,
      amount: b.budgetedAmount,
      spent: actualSpent,
      scope: b.scope || 'business',
      alertThreshold: threshold,
      status: pct >= 100 ? 'exceeded' : pct >= threshold ? 'warning' : 'on-track',
    };
  };

  const budgets: Budget[] = useMemo(() => {
    return rawBudgets.map(toViewModel);
  }, [rawBudgets, rawTxns, categoryMap, departmentMap, projectDeptMap]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateTotalAmount, setTemplateTotalAmount] = useState<string>('500000');
  const [templatePeriod, setTemplatePeriod] = useState<Budget['period']>('monthly');
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'monthly' | 'quarterly' | 'yearly'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'on-track' | 'warning' | 'exceeded'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'summary'>('list');

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [formData, setFormData] = useState({
    name: '',
    category: '',
    amount: '',
    period: 'monthly' as Budget['period'],
    startDate: todayStr,
    endDate: calculateDefaultEndDate(todayStr, 'monthly'),
    scope: 'business' as 'business' | 'personal',
    department: '',
    alertThreshold: 80,
  });

  const filteredBudgets = budgets.filter(budget => {
    const matchesPeriod = filterPeriod === 'all' || budget.period === filterPeriod;
    const matchesStatus = filterStatus === 'all' || budget.status === filterStatus;
    return matchesPeriod && matchesStatus;
  });

  const resetForm = () => {
    const end = calculateDefaultEndDate(todayStr, 'monthly');
    setFormData({
      name: '',
      category: '',
      amount: '',
      period: 'monthly',
      startDate: todayStr,
      endDate: end,
      scope: 'business',
      department: '',
      alertThreshold: 80,
    });
    setSelectedBudget(null);
  };

  const handleOpenCreate = () => {
    const end = calculateDefaultEndDate(todayStr, 'monthly');
    setFormData({
      name: '',
      category: '',
      amount: '',
      period: 'monthly',
      startDate: todayStr,
      endDate: end,
      scope: 'business',
      department: '',
      alertThreshold: 80,
    });
    setCreateDialogOpen(true);
  };

  const handleNameChange = (name: string) => {
    setFormData(prev => {
      let cat = prev.category;
      if (!cat) {
        const lower = name.toLowerCase();
        if (lower.includes('soft') || lower.includes('subscr') || lower.includes('tool') || lower.includes('app') || lower.includes('cloud')) {
          const match = expenseCategories.find(c => {
            const n = c.name.toLowerCase();
            return n.includes('soft') || n.includes('tool') || n.includes('subscr');
          });
          if (match) cat = match.id;
        } else if (lower.includes('office') || lower.includes('suppl') || lower.includes('station') || lower.includes('maint')) {
          const match = expenseCategories.find(c => c.name.toLowerCase().includes('office'));
          if (match) cat = match.id;
        } else if (lower.includes('travel') || lower.includes('transport') || lower.includes('flight') || lower.includes('hotel')) {
          const match = expenseCategories.find(c => c.name.toLowerCase().includes('travel'));
          if (match) cat = match.id;
        } else if (lower.includes('salary') || lower.includes('payroll') || lower.includes('wage')) {
          const match = expenseCategories.find(c => c.name.toLowerCase().includes('payroll') || c.name.toLowerCase().includes('salar'));
          if (match) cat = match.id;
        }
      }
      return { ...prev, name, category: cat };
    });
  };

  const selectedDeptObj = useMemo(() => {
    if (!formData.department || formData.department === 'none') return null;
    return (rawDepartments || []).find(d => d.id === formData.department) || null;
  }, [formData.department, rawDepartments]);

  const selectedDeptBudgetInfo = useMemo(() => {
    if (!selectedDeptObj || selectedDeptObj.budget == null || selectedDeptObj.budget <= 0) return null;
    const totalDeptBudget = Number(selectedDeptObj.budget);
    const otherBudgetsTotal = (rawBudgets || [])
      .filter(b => b.departmentId === selectedDeptObj.id && b.id !== selectedBudget?.id)
      .reduce((sum, b) => sum + (Number(b.budgetedAmount) || 0), 0);
    const available = Math.max(0, totalDeptBudget - otherBudgetsTotal);
    const entered = parseFloat(formData.amount) || 0;
    const exceedsLimit = entered > totalDeptBudget;
    const exceedsAvailable = (otherBudgetsTotal + entered) > totalDeptBudget;

    return {
      totalDeptBudget,
      otherBudgetsTotal,
      available,
      entered,
      exceedsLimit,
      exceedsAvailable,
    };
  }, [selectedDeptObj, rawBudgets, selectedBudget, formData.amount]);

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.amount || !formData.startDate || !formData.endDate) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (new Date(formData.startDate) > new Date(formData.endDate)) {
      toast.error('Start date cannot be after end date');
      return;
    }

    const enteredAmount = parseFloat(formData.amount);
    if (isNaN(enteredAmount) || enteredAmount <= 0) {
      toast.error('Please enter a valid budget amount');
      return;
    }

    if (selectedDeptBudgetInfo) {
      if (selectedDeptBudgetInfo.exceedsLimit) {
        toast.error(`Budget amount (${formatCurrency(enteredAmount, orgCurrency)}) cannot exceed department budget (${formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)})`);
        return;
      }
      if (selectedDeptBudgetInfo.exceedsAvailable) {
        toast.error(`Total planned budgets for ${selectedDeptObj?.name} (${formatCurrency(selectedDeptBudgetInfo.otherBudgetsTotal + enteredAmount, orgCurrency)}) exceeds department budget (${formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)}). Only ${formatCurrency(selectedDeptBudgetInfo.available, orgCurrency)} available.`);
        return;
      }
    }

    const res = await svc.budgets.create({
      name: formData.name.trim(),
      period: formData.period,
      startDate: formData.startDate,
      endDate: formData.endDate,
      categoryId: formData.category || undefined,
      departmentId: formData.department || undefined,
      budgetedAmount: enteredAmount,
      spentAmount: 0,
      currency: orgCurrency,
      status: 'active',
      alertThreshold: Number(formData.alertThreshold) || 80,
      scope: formData.scope,
    });

    if (!res.success) {
      toast.error(res.error || 'Could not create budget');
      return;
    }

    toast.success('Budget created successfully');
    setCreateDialogOpen(false);
    resetForm();
    refetchBudgets();
  };

  const handleEdit = (budget: Budget) => {
    setSelectedBudget(budget);
    setFormData({
      name: budget.name,
      category: budget.categoryId || '',
      amount: budget.amount.toString(),
      period: budget.period,
      startDate: budget.startDate,
      endDate: budget.endDate,
      scope: budget.scope,
      department: budget.departmentId || '',
      alertThreshold: budget.alertThreshold,
    });
    setEditDialogOpen(true);
  };

  const handleUpdate = async () => {
    if (!selectedBudget) return;
    if (!formData.name.trim() || !formData.amount || !formData.startDate || !formData.endDate) {
      toast.error('Please fill in all required fields');
      return;
    }

    const enteredAmount = parseFloat(formData.amount);
    if (isNaN(enteredAmount) || enteredAmount <= 0) {
      toast.error('Please enter a valid budget amount');
      return;
    }

    if (selectedDeptBudgetInfo) {
      if (selectedDeptBudgetInfo.exceedsLimit) {
        toast.error(`Budget amount (${formatCurrency(enteredAmount, orgCurrency)}) cannot exceed department budget (${formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)})`);
        return;
      }
      if (selectedDeptBudgetInfo.exceedsAvailable) {
        toast.error(`Total planned budgets for ${selectedDeptObj?.name} (${formatCurrency(selectedDeptBudgetInfo.otherBudgetsTotal + enteredAmount, orgCurrency)}) exceeds department budget (${formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)}). Only ${formatCurrency(selectedDeptBudgetInfo.available, orgCurrency)} available.`);
        return;
      }
    }

    const res = await svc.budgets.update(selectedBudget.id, {
      name: formData.name.trim(),
      categoryId: formData.category || undefined,
      budgetedAmount: enteredAmount,
      period: formData.period,
      startDate: formData.startDate,
      endDate: formData.endDate,
      departmentId: formData.department || undefined,
      alertThreshold: Number(formData.alertThreshold) || 80,
      scope: formData.scope,
    });

    if (!res.success) {
      toast.error(res.error || 'Could not update budget');
      return;
    }

    toast.success('Budget updated successfully');
    setEditDialogOpen(false);
    resetForm();
    refetchBudgets();
  };

  const handleDelete = async (id: string) => {
    const res = await svc.budgets.delete(id);
    if (!res.success) {
      toast.error(res.error || 'Could not delete budget');
      return;
    }
    toast.success('Budget deleted');
    refetchBudgets();
  };

  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const handleRefreshBudget = async (budgetId: string) => {
    setRefreshingId(budgetId);
    await refetchBudgets();
    toast.success('Budget data refreshed');
    setRefreshingId(null);
  };

  const handleRollForward = async (budget: Budget) => {
    const res = await svc.budgets.rollForward(budget.id);
    if (!res.success) {
      toast.error(res.error || 'Could not roll forward budget');
      return;
    }
    toast.success(`Budget "${budget.name}" rolled forward to next period!`);
    refetchBudgets();
  };

  const applyTemplate = async (template: BudgetTemplate, totalBudget: number) => {
    const res = await svc.budgets.createFromTemplate(
      template.name,
      totalBudget,
      template.categories,
      {
        period: templatePeriod,
        startDate: todayStr,
        currency: orgCurrency,
      },
    );
    if (!res.success) {
      toast.error(res.error || 'Template apply failed');
      return;
    }

    toast.success(`Applied ${template.name} template`);
    setTemplateDialogOpen(false);
    refetchBudgets();
  };

  const getPercentageUsed = (budget: Budget) => {
    return budget.amount > 0 ? (budget.spent / budget.amount) * 100 : 0;
  };

  // Standard variance: positive = remaining funds, negative = exceeded budget
  const getRemainingBalance = (budget: Budget) => {
    return budget.amount - budget.spent;
  };

  const totalBudgeted = filteredBudgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = filteredBudgets.reduce((sum, b) => sum + b.spent, 0);
  const remainingTotal = totalBudgeted - totalSpent;
  const onTrackCount = budgets.filter(b => b.status === 'on-track').length;
  const warningCount = budgets.filter(b => b.status === 'warning').length;
  const exceededCount = budgets.filter(b => b.status === 'exceeded').length;

  // Category summary calculation
  const categorySummaryMap = useMemo(() => {
    const map = new Map<string, { budgeted: number; spent: number; color?: string; count: number }>();
    filteredBudgets.forEach(b => {
      const catName = b.category || 'General';
      const existing = map.get(catName) || { budgeted: 0, spent: 0, color: b.categoryColor, count: 0 };
      map.set(catName, {
        budgeted: existing.budgeted + b.amount,
        spent: existing.spent + b.spent,
        color: b.categoryColor || existing.color,
        count: existing.count + 1,
      });
    });
    return map;
  }, [filteredBudgets]);

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.blue,
                boxShadow: AXIOM.shadows.iconBlue,
              }}
            >
              <Target className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Budget Planning
              </h1>
              <p className="text-slate-400 text-sm">Plan, track, and optimize your organization budgets</p>
            </div>
          </div>
          <div className="flex gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
              onClick={() => setTemplateDialogOpen(true)}
            >
              <Sparkles className="size-4 text-cyan-400" />
              Use Template
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
              onClick={handleOpenCreate}
            >
              <Plus className="size-4" />
              Create Budget
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Budgeted</p>
              <p className="text-2xl font-bold text-white">
                {formatCurrency(totalBudgeted, orgCurrency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">{filteredBudgets.length} active budget(s)</p>
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
          transition={{ delay: 0.15 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Spent</p>
              <p className="text-2xl font-bold text-cyan-400">
                {formatCurrency(totalSpent, orgCurrency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {totalBudgeted > 0 ? ((totalSpent / totalBudgeted) * 100).toFixed(1) : '0.0'}% used
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <TrendingUp className="size-6 text-white" />
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
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Remaining</p>
              <p className={`text-2xl font-bold ${remainingTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(Math.abs(remainingTotal), orgCurrency)}
              </p>
              <p className={`text-xs mt-1 ${remainingTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {remainingTotal >= 0 ? 'under budget' : 'over budget limit'}
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: remainingTotal >= 0 ? AXIOM.iconBoxes.green : 'linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.3))',
                boxShadow: remainingTotal >= 0 ? AXIOM.shadows.iconGreen : '0 10px 30px -10px rgba(239, 68, 68, 0.5)',
              }}
            >
              <CheckCircle className="size-6 text-white" />
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
              <p className="text-slate-400 text-sm mb-1">Status</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-2 py-1 rounded-lg text-xs font-medium" style={AXIOM.badges.success}>
                  {onTrackCount} On Track
                </span>
                {warningCount > 0 && (
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={AXIOM.badges.warning}>
                    {warningCount} Warning
                  </span>
                )}
                {exceededCount > 0 && (
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={AXIOM.badges.danger}>
                    {exceededCount} Over
                  </span>
                )}
              </div>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Target className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* View Toggle & Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="p-4 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value as any)}
              className="px-4 py-2 rounded-xl text-white text-sm"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
              }}
            >
              <option value="all">All Periods</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-4 py-2 rounded-xl text-white text-sm"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
              }}
            >
              <option value="all">All Status</option>
              <option value="on-track">On Track</option>
              <option value="warning">Warning</option>
              <option value="exceeded">Exceeded</option>
            </select>
          </div>

          <div className="flex gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setViewMode('list')}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={viewMode === 'list' ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
            >
              List View
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setViewMode('summary')}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={viewMode === 'summary' ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
            >
              Category Summary
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {viewMode === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-3"
          >
            {loading && rawBudgets.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-slate-400"
                style={AXIOM.containers.list}
              >
                <Loader2 className="size-8 animate-spin text-cyan-400" aria-hidden />
                <p className="text-sm">Loading budgets from database…</p>
              </div>
            ) : !loading && filteredBudgets.length === 0 ? (
              <div className="rounded-2xl py-16 text-center" style={AXIOM.containers.list}>
                <p className="text-base font-medium text-white">No budgets yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  Create a budget or apply a template to see it here.
                </p>
              </div>
            ) : (
              filteredBudgets.map((budget, idx) => {
                const percentageUsed = getPercentageUsed(budget);
                const remaining = getRemainingBalance(budget);
                const isOver = remaining < 0;

                return (
                  <motion.div
                    key={budget.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="p-6 rounded-2xl"
                    style={AXIOM.containers.list}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-white font-semibold text-lg">{budget.name}</h3>
                          <span 
                            className="px-2.5 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider"
                            style={
                              budget.status === 'on-track' ? AXIOM.badges.success :
                              budget.status === 'warning' ? AXIOM.badges.warning :
                              AXIOM.badges.danger
                            }
                          >
                            {budget.status}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg text-xs font-medium capitalize" style={AXIOM.badges.info}>
                            {budget.period}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg text-xs font-medium text-slate-300" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
                            {budget.scope}
                          </span>
                          {new Date(budget.endDate) < new Date() && (
                            <span className="px-2 py-0.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Expired
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <span className="inline-flex items-center gap-1.5">
                            <span 
                              className="size-2.5 rounded-full inline-block"
                              style={{ backgroundColor: budget.categoryColor || '#38bdf8' }}
                            />
                            {budget.category}
                          </span>
                          {budget.department && (
                            <>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="size-3 text-slate-400" />
                                {budget.department}
                              </span>
                            </>
                          )}
                          <span>•</span>
                          <span className="text-xs text-slate-500">
                            {budget.startDate} to {budget.endDate}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {new Date(budget.endDate) < new Date() && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors mr-1"
                            onClick={() => handleRollForward(budget)}
                            title="Roll forward to next period"
                          >
                            Roll Forward
                          </motion.button>
                        )}
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-400 transition-colors"
                          style={{ background: 'rgba(148, 163, 184, 0.1)' }}
                          onClick={() => handleRefreshBudget(budget.id)}
                          title="Refresh Budget"
                        >
                          <RotateCw className={`size-3.5 ${refreshingId === budget.id ? 'animate-spin text-cyan-400' : ''}`} />
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white"
                          style={{ background: 'rgba(148, 163, 184, 0.1)' }}
                          onClick={() => handleEdit(budget)}
                          title="Edit Budget"
                        >
                          <Edit className="size-3.5" />
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400 hover:text-red-300"
                          style={{ background: 'rgba(239, 68, 68, 0.1)' }}
                          onClick={() => handleDelete(budget.id)}
                          title="Delete Budget"
                        >
                          <Trash2 className="size-3.5" />
                        </motion.button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Budget Limit</span>
                        <span className="text-white font-medium">
                          {formatCurrency(budget.amount, budget.currency || orgCurrency)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Total Spent</span>
                        <span className="text-cyan-400 font-medium">
                          {formatCurrency(budget.spent, budget.currency || orgCurrency)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Remaining</span>
                        <span className={isOver ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                          {formatCurrency(Math.abs(remaining), budget.currency || orgCurrency)}
                          {isOver ? ' over budget' : ' remaining'}
                        </span>
                      </div>

                      <div className="pt-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                          <span>Spend Utilization</span>
                          <span className={isOver ? 'text-red-400 font-bold' : percentageUsed >= budget.alertThreshold ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                            {percentageUsed.toFixed(1)}% (Threshold: {budget.alertThreshold}%)
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(percentageUsed, 100)}%` }}
                            transition={{ duration: 0.8, delay: 0.1 }}
                            className="h-full"
                            style={{
                              background: percentageUsed >= 100 
                                ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                                : percentageUsed >= budget.alertThreshold
                                ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                                : 'linear-gradient(90deg, #10b981, #059669)',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {percentageUsed >= budget.alertThreshold && (
                      <div 
                        className="mt-4 p-3 rounded-xl flex items-start gap-2"
                        style={{
                          background: percentageUsed >= 100 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          border: percentageUsed >= 100 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
                        }}
                      >
                        <AlertTriangle className={`size-4 flex-shrink-0 mt-0.5 ${percentageUsed >= 100 ? 'text-red-400' : 'text-amber-400'}`} />
                        <p className={`text-xs ${percentageUsed >= 100 ? 'text-red-400' : 'text-amber-400'}`}>
                          {percentageUsed >= 100
                            ? `Budget limit exceeded by ${formatCurrency(budget.spent - budget.amount, budget.currency || orgCurrency)}!`
                            : `Approaching budget limit: ${percentageUsed.toFixed(1)}% utilized (${budget.alertThreshold}% alert threshold reached)`
                          }
                        </p>
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </motion.div>
        ) : (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-3"
          >
            {Array.from(categorySummaryMap.entries()).map(([category, data], idx) => {
              const percentageUsed = data.budgeted > 0 ? (data.spent / data.budgeted) * 100 : 0;
              const remaining = data.budgeted - data.spent;
              const isOver = remaining < 0;

              return (
                <motion.div
                  key={category}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="p-6 rounded-2xl"
                  style={AXIOM.containers.list}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span 
                          className="size-3 rounded-full inline-block"
                          style={{ backgroundColor: data.color || '#38bdf8' }}
                        />
                        <h3 className="text-white font-semibold text-lg">{category}</h3>
                      </div>
                      <p className="text-sm text-slate-400 mt-1">
                        {data.count} budget(s) in this category
                      </p>
                    </div>
                    <span 
                      className="px-3 py-1 rounded-lg text-sm font-semibold"
                      style={
                        percentageUsed < 80 ? AXIOM.badges.success :
                        percentageUsed < 100 ? AXIOM.badges.warning :
                        AXIOM.badges.danger
                      }
                    >
                      {percentageUsed.toFixed(1)}% used
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Total Budgeted</p>
                      <p className="text-lg font-bold text-white">
                        {formatCurrency(data.budgeted, orgCurrency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Total Spent</p>
                      <p className="text-lg font-bold text-cyan-400">
                        {formatCurrency(data.spent, orgCurrency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Remaining</p>
                      <p className={`text-lg font-bold ${isOver ? 'text-red-400' : 'text-emerald-400'}`}>
                        {formatCurrency(Math.abs(remaining), orgCurrency)}
                        {isOver ? ' over' : ' left'}
                      </p>
                    </div>
                  </div>

                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(percentageUsed, 100)}%` }}
                      transition={{ duration: 0.8, delay: 0.1 }}
                      className="h-full"
                      style={{
                        background: percentageUsed >= 100 
                          ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                          : percentageUsed >= 80
                          ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                          : 'linear-gradient(90deg, #10b981, #059669)',
                      }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create/Edit Budget Dialog */}
      <Dialog open={createDialogOpen || editDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setCreateDialogOpen(false);
          setEditDialogOpen(false);
          resetForm();
        }
      }}>
        <DialogContent 
          className="max-w-2xl text-white"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold">
              {editDialogOpen ? 'Edit Budget' : 'Create Budget'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {editDialogOpen ? 'Update budget parameters and limits' : 'Set up a new spending limit linked directly to your organization transactions'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-white text-sm font-medium mb-2 block">Budget Name *</label>
              <input
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., Software Subscriptions, Office Supplies, Marketing Q1"
                className="w-full px-4 py-3 rounded-xl text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white text-sm font-medium mb-2 block">Category *</label>
                <Select 
                  value={formData.category || 'general'} 
                  onValueChange={(v) => setFormData({ ...formData, category: v === 'general' ? '' : v })}
                >
                  <SelectTrigger 
                    className="w-full text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent 
                    style={{
                      background: AXIOM.containers.list.background,
                      border: AXIOM.containers.list.border,
                    }}
                  >
                    <SelectItem value="general" className="text-white">
                      General / All Expense Categories
                    </SelectItem>
                    {expenseCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-white">
                        <div className="flex items-center gap-2">
                          <span 
                            className="size-2.5 rounded-full inline-block"
                            style={{ backgroundColor: c.color || '#38bdf8' }}
                          />
                          <span>{c.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-white text-sm font-medium mb-2 block">Budget Amount ({orgCurrency}) *</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0"
                  min="0"
                  step="any"
                  className="w-full px-4 py-3 rounded-xl text-white"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white text-sm font-medium mb-2 block">Period *</label>
                <Select 
                  value={formData.period} 
                  onValueChange={(v: any) => {
                    const newEnd = calculateDefaultEndDate(formData.startDate, v);
                    setFormData({ ...formData, period: v, endDate: newEnd });
                  }}
                >
                  <SelectTrigger 
                    className="w-full text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent 
                    style={{
                      background: AXIOM.containers.list.background,
                      border: AXIOM.containers.list.border,
                    }}
                  >
                    <SelectItem value="monthly" className="text-white">Monthly (+1 Month)</SelectItem>
                    <SelectItem value="quarterly" className="text-white">Quarterly (+3 Months)</SelectItem>
                    <SelectItem value="yearly" className="text-white">Yearly (+1 Year)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-white text-sm font-medium mb-2 block">Scope *</label>
                <Select value={formData.scope} onValueChange={(v: any) => setFormData({ ...formData, scope: v })}>
                  <SelectTrigger 
                    className="w-full text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent 
                    style={{
                      background: AXIOM.containers.list.background,
                      border: AXIOM.containers.list.border,
                    }}
                  >
                    <SelectItem value="business" className="text-white">Business</SelectItem>
                    <SelectItem value="personal" className="text-white">Personal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white text-sm font-medium mb-2 block">Start Date *</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    const newEnd = calculateDefaultEndDate(newStart, formData.period);
                    setFormData({ ...formData, startDate: newStart, endDate: newEnd });
                  }}
                  className="w-full px-4 py-3 rounded-xl text-white"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                />
              </div>

              <div>
                <label className="text-white text-sm font-medium mb-2 block">End Date *</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl text-white"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white text-sm font-medium mb-2 block">Department (Optional)</label>
                <Select 
                  value={formData.department || 'none'} 
                  onValueChange={(v) => setFormData({ ...formData, department: v === 'none' ? '' : v })}
                >
                  <SelectTrigger 
                    className="w-full text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent 
                    style={{
                      background: AXIOM.containers.list.background,
                      border: AXIOM.containers.list.border,
                    }}
                  >
                    <SelectItem value="none" className="text-white">All Departments (No restriction)</SelectItem>
                    {rawDepartments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id} className="text-white">
                        <div className="flex items-center justify-between gap-4 w-full">
                          <span>{dept.name}</span>
                          {dept.budget != null && dept.budget > 0 ? (
                            <span className="text-emerald-400 font-medium text-xs">
                              Budget: {formatCurrency(dept.budget, orgCurrency)}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-xs">No budget limit</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-white text-sm font-medium mb-2 block">
                  Alert Threshold ({formData.alertThreshold}%)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={formData.alertThreshold}
                    onChange={(e) => setFormData({ ...formData, alertThreshold: parseInt(e.target.value) || 80 })}
                    className="flex-1 accent-cyan-400"
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formData.alertThreshold}
                    onChange={(e) => setFormData({ ...formData, alertThreshold: parseInt(e.target.value) || 80 })}
                    className="w-16 px-2 py-2 rounded-lg text-white text-center text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>
              </div>
            </div>

            {selectedDeptBudgetInfo && (
              <div
                className="p-3.5 rounded-xl text-xs space-y-1.5"
                style={{
                  background: selectedDeptBudgetInfo.exceedsLimit || selectedDeptBudgetInfo.exceedsAvailable
                    ? 'rgba(239, 68, 68, 0.12)'
                    : 'rgba(16, 185, 129, 0.08)',
                  border: selectedDeptBudgetInfo.exceedsLimit || selectedDeptBudgetInfo.exceedsAvailable
                    ? '1px solid rgba(239, 68, 68, 0.4)'
                    : '1px solid rgba(16, 185, 129, 0.3)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <AlertCircle className={`size-3.5 ${selectedDeptBudgetInfo.exceedsLimit || selectedDeptBudgetInfo.exceedsAvailable ? 'text-red-400' : 'text-emerald-400'}`} />
                    {selectedDeptObj?.name} Total Budget
                  </span>
                  <span className="font-bold text-white">
                    {formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>Other planned items: {formatCurrency(selectedDeptBudgetInfo.otherBudgetsTotal, orgCurrency)}</span>
                  <span className={`font-semibold ${selectedDeptBudgetInfo.available > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Available to allocate: {formatCurrency(selectedDeptBudgetInfo.available, orgCurrency)}
                  </span>
                </div>
                {(selectedDeptBudgetInfo.exceedsLimit || selectedDeptBudgetInfo.exceedsAvailable) && (
                  <p className="text-red-400 font-semibold text-xs pt-1 border-t border-red-500/30">
                    ⚠️ {selectedDeptBudgetInfo.exceedsLimit
                      ? `Budget amount (${formatCurrency(selectedDeptBudgetInfo.entered, orgCurrency)}) cannot exceed department budget (${formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)})!`
                      : `Total planned for department (${formatCurrency(selectedDeptBudgetInfo.otherBudgetsTotal + selectedDeptBudgetInfo.entered, orgCurrency)}) exceeds department budget (${formatCurrency(selectedDeptBudgetInfo.totalDeptBudget, orgCurrency)}). Only ${formatCurrency(selectedDeptBudgetInfo.available, orgCurrency)} available!`
                    }
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-4 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.2)' }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 py-3 rounded-xl font-medium"
                style={AXIOM.buttons.secondary}
                onClick={() => {
                  setCreateDialogOpen(false);
                  setEditDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </motion.button>
              <motion.button
                whileHover={selectedDeptBudgetInfo?.exceedsLimit || selectedDeptBudgetInfo?.exceedsAvailable ? {} : { scale: 1.02 }}
                whileTap={selectedDeptBudgetInfo?.exceedsLimit || selectedDeptBudgetInfo?.exceedsAvailable ? {} : { scale: 0.98 }}
                disabled={Boolean(selectedDeptBudgetInfo?.exceedsLimit || selectedDeptBudgetInfo?.exceedsAvailable)}
                className="flex-1 py-3 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: selectedDeptBudgetInfo?.exceedsLimit || selectedDeptBudgetInfo?.exceedsAvailable
                    ? 'rgba(239, 68, 68, 0.4)'
                    : 'linear-gradient(135deg, rgba(6, 182, 212, 0.6), rgba(59, 130, 246, 0.6))',
                  border: selectedDeptBudgetInfo?.exceedsLimit || selectedDeptBudgetInfo?.exceedsAvailable
                    ? '1px solid rgba(239, 68, 68, 0.5)'
                    : '1px solid rgba(6, 182, 212, 0.5)',
                  boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                }}
                onClick={editDialogOpen ? handleUpdate : handleCreate}
              >
                {selectedDeptBudgetInfo?.exceedsLimit
                  ? 'Exceeds Department Budget'
                  : selectedDeptBudgetInfo?.exceedsAvailable
                  ? 'Exceeds Available Budget'
                  : editDialogOpen
                  ? 'Save Changes'
                  : 'Create Budget'}
              </motion.button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent 
          className="max-w-2xl text-white"
          style={{
            background: AXIOM.containers.list.background,
            border: AXIOM.containers.list.border,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold flex items-center gap-2">
              <Sparkles className="size-5 text-cyan-400" />
              Apply Budget Template
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Apply industry-standard splits across your organization categories in one click.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white text-sm font-medium mb-2 block">
                  Total Budget Amount ({orgCurrency}) *
                </label>
                <input
                  type="number"
                  value={templateTotalAmount}
                  onChange={(e) => setTemplateTotalAmount(e.target.value)}
                  placeholder="e.g., 500000"
                  min="1"
                  className="w-full px-4 py-3 rounded-xl text-white"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                />
              </div>

              <div>
                <label className="text-white text-sm font-medium mb-2 block">
                  Budget Period
                </label>
                <Select 
                  value={templatePeriod} 
                  onValueChange={(v: any) => setTemplatePeriod(v)}
                >
                  <SelectTrigger 
                    className="w-full text-white"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent 
                    style={{
                      background: AXIOM.containers.list.background,
                      border: AXIOM.containers.list.border,
                    }}
                  >
                    <SelectItem value="monthly" className="text-white">Monthly</SelectItem>
                    <SelectItem value="quarterly" className="text-white">Quarterly</SelectItem>
                    <SelectItem value="yearly" className="text-white">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {budgetTemplates.map((template) => {
                const totalNum = parseFloat(templateTotalAmount) || 0;

                return (
                  <div 
                    key={template.name} 
                    className="p-4 rounded-xl"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-white font-semibold mb-1 text-base">{template.name}</h3>
                        <p className="text-xs text-slate-400">{template.categories.length} categories (100% total allocation)</p>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-white"
                        style={{
                          background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.5), rgba(59, 130, 246, 0.5))',
                          border: '1px solid rgba(6, 182, 212, 0.5)',
                        }}
                        onClick={() => {
                          if (totalNum && totalNum > 0) {
                            applyTemplate(template, totalNum);
                          } else {
                            toast.error('Please enter a valid total budget amount');
                          }
                        }}
                      >
                        Apply Template
                      </motion.button>
                    </div>

                    <div className="space-y-1.5">
                      {template.categories.map(cat => {
                        const calculatedAmt = totalNum > 0 ? (totalNum * cat.percentage) / 100 : 0;
                        return (
                          <div key={cat.category} className="flex items-center justify-between text-sm">
                            <span className="text-slate-300 font-medium">{cat.category}</span>
                            <div className="flex items-center gap-3">
                              {totalNum > 0 && (
                                <span className="text-xs text-cyan-400 font-medium">
                                  {formatCurrency(calculatedAmt, orgCurrency)}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-lg text-xs font-medium" style={AXIOM.badges.info}>
                                {cat.percentage}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}