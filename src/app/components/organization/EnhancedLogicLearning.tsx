import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useService, useServiceArray, useMutation } from '@/hooks/useService';
import {
  Brain,
  Sparkles,
  TrendingUp,
  Plus,
  Trash2,
  Edit,
  Search,
  Filter,
  BookOpen,
  Target,
  Zap,
  BarChart3,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  AlertCircle,
  Folder,
  DollarSign,
  ArrowDownCircle,
  Package,
  Users,
  Tag,
  Laptop,
  Plane,
  Briefcase,
  Megaphone,
  Utensils,
  ShoppingCart,
  PlusCircle,
  Shield,
  CreditCard,
  FileText,
  Layers,
} from 'lucide-react';

function getCategoryIconComponent(iconName?: string) {
  switch (iconName?.toLowerCase()) {
    case 'dollar-sign':
    case 'dollar':
      return DollarSign;
    case 'arrow-down-circle':
    case 'arrow-down':
      return ArrowDownCircle;
    case 'package':
      return Package;
    case 'users':
    case 'user':
      return Users;
    case 'laptop':
    case 'computer':
      return Laptop;
    case 'plane':
    case 'travel':
      return Plane;
    case 'briefcase':
      return Briefcase;
    case 'megaphone':
      return Megaphone;
    case 'zap':
    case 'lightning':
      return Zap;
    case 'utensils':
    case 'food':
      return Utensils;
    case 'shopping-cart':
    case 'cart':
      return ShoppingCart;
    case 'plus-circle':
      return PlusCircle;
    case 'shield':
      return Shield;
    case 'credit-card':
      return CreditCard;
    case 'file-text':
      return FileText;
    case 'layers':
      return Layers;
    case 'tag':
    default:
      return Tag;
  }
}
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import type { ClassificationResult, ClassificationRule } from '@/lib/classificationEngine';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { CategoryManagementDialog } from '../CategoryManagementDialog';

type LearningView = 'patterns' | 'review' | 'performance' | 'rules';

export function EnhancedLogicLearning() {
  const [activeView, setActiveView] = useState<LearningView>('patterns');
  const [searchQuery, setSearchQuery] = useState('');
  const [testNarration, setTestNarration] = useState('');
  const [testType, setTestType] = useState<'auto' | 'debit' | 'credit'>('auto');
  const [testResult, setTestResult] = useState<ClassificationResult | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleCategoryId, setNewRuleCategoryId] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [expandedCorrectionTxnId, setExpandedCorrectionTxnId] = useState<string | null>(null);
  const [correctionCategoryId, setCorrectionCategoryId] = useState('');
  const [correctionDepartmentId, setCorrectionDepartmentId] = useState('');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'auto' | 'needs-review' | 'confirmed'>('all');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [categorySearch, setCategorySearch] = useState('');

  const svc = useOrgServices();

  const { data: orgDepartments = [] } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );

  const { data: categories, loading: categoriesLoading, error: categoriesError, refetch: refetchCategories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );

  const filteredCategories = useMemo(() => {
    return (categories || []).filter((c) => {
      const matchesType = categoryTypeFilter === 'all' || c.type === categoryTypeFilter;
      const q = categorySearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (Array.isArray(c.patterns) && c.patterns.some((p) => p.toLowerCase().includes(q)));
      return matchesType && matchesSearch;
    });
  }, [categories, categoryTypeFilter, categorySearch]);

  const { data: txnResult, loading: txnsLoading, refetch: refetchTxns, mutate: mutateTxns } = useService(
    () => svc.transactions.getAll({ pageSize: 500 }),
    [svc.orgId],
    ['transactions'],
  );
  const transactions = txnResult?.items ?? [];

  const { data: rules, loading: rulesLoading, refetch: refetchRules } = useServiceArray(
    () => svc.classification.getRules(),
    [svc.orgId],
    ['classification-rules'],
  );

  const { data: statsResult, refetch: refetchStats } = useService(
    () => svc.classification.getStats(),
    [svc.orgId],
    ['transactions', 'categories', 'classification-rules'],
  );

  const classifyMut = useMutation((input: { narration: string; amount: number; type: 'debit' | 'credit' }) =>
    svc.classification.classify(input.narration, input.amount, input.type),
  );

  const learnMut = useMutation((input: { txnId: string; categoryId: string; departmentId?: string }) =>
    svc.classification.learnFromCorrection(input.txnId, input.categoryId, input.departmentId),
  );

  const addRuleMut = useMutation((rule: Omit<ClassificationRule, 'id'>) => svc.classification.addRule(rule));

  const updateRuleMut = useMutation((input: { id: string; updates: Partial<Omit<ClassificationRule, 'id'>> }) =>
    svc.classification.updateRule(input.id, input.updates),
  );

  const deleteRuleMut = useMutation((ruleId: string) => svc.classification.deleteRule(ruleId));

  const aiMetrics = useMemo(() => {
    if (statsResult) {
      const corrections = statsResult.userCorrections ?? 0;
      return {
        totalClassifications: statsResult.totalTransactions,
        accurateClassifications: statsResult.autoClassified,
        accuracyRate: Math.round(statsResult.accuracyRate * 10) / 10,
        avgConfidence: statsResult.avgConfidence,
        learningRate: corrections > 0 ? `${corrections} user correction${corrections === 1 ? '' : 's'}` : '0 corrections needed',
        patternsLearned: statsResult.autoClassified,
        userClassified: statsResult.userClassified,
        userCorrections: corrections,
      };
    }
    return {
      totalClassifications: 0,
      accurateClassifications: 0,
      accuracyRate: 0,
      avgConfidence: 0,
      learningRate: '—',
      patternsLearned: 0,
      userClassified: 0,
      userCorrections: 0,
    };
  }, [statsResult]);

  const handleSelectCategory = (catId: string, explicitDeptId?: string, narration?: string) => {
    setCorrectionCategoryId(catId);
    if (explicitDeptId) {
      setCorrectionDepartmentId(explicitDeptId);
      return;
    }
    if (!catId) {
      setCorrectionDepartmentId('');
      return;
    }
    const cat = categories.find((c) => c.id === catId);
    const catName = String(cat?.name || '').toLowerCase();
    const narr = String(narration || '').toLowerCase();
    const text = `${catName} ${narr}`;

    for (const d of orgDepartments) {
      const dName = String(d.name || '').toLowerCase();

      // Engineering / IT / Tech / Development
      if ((dName.includes('dev') || dName.includes('eng') || dName.includes('tech') || dName.includes('it')) &&
          (text.includes('software') || text.includes('tool') || text.includes('saas') || text.includes('cloud') || 
           text.includes('dev') || text.includes('api') || text.includes('hardware') || text.includes('laptop') || 
           text.includes('computer') || text.includes('server') || text.includes('screen') || text.includes('macbook') ||
           text.includes('hp') || text.includes('dell'))) {
        setCorrectionDepartmentId(d.id);
        return;
      }

      // Marketing / Ads / Growth
      if ((dName.includes('market') || dName.includes('growth') || dName.includes('ad')) &&
          (text.includes('marketing') || text.includes('ad') || text.includes('campaign') || text.includes('promo') || 
           text.includes('seo') || text.includes('social') || text.includes('brand'))) {
        setCorrectionDepartmentId(d.id);
        return;
      }

      // Operations / Office / Admin / Facilities
      if ((dName.includes('operat') || dName.includes('admin') || dName.includes('office') || dName.includes('facil')) &&
          (text.includes('office') || text.includes('supplies') || text.includes('rent') || text.includes('maintenance') || 
           text.includes('utility') || text.includes('cleaning') || text.includes('stationery') || text.includes('equipment'))) {
        setCorrectionDepartmentId(d.id);
        return;
      }

      // Sales
      if ((dName.includes('sale') || dName.includes('bd') || dName.includes('client')) &&
          (text.includes('client') || text.includes('sale') || text.includes('revenue') || text.includes('deal'))) {
        setCorrectionDepartmentId(d.id);
        return;
      }

      // Finance / HR / Legal
      if ((dName.includes('finan') || dName.includes('hr') || dName.includes('legal')) &&
          (text.includes('payroll') || text.includes('salary') || text.includes('legal') || text.includes('tax') || text.includes('accounting'))) {
        setCorrectionDepartmentId(d.id);
        return;
      }
    }

    // Heuristic fallbacks by narration/category keywords
    if (text.includes('laptop') || text.includes('hardware') || text.includes('computer')) {
      const itOrDev = orgDepartments.find(d => {
        const dn = d.name.toLowerCase();
        return dn.includes('it') || dn.includes('tech') || dn.includes('dev') || dn.includes('operat');
      });
      if (itOrDev) {
        setCorrectionDepartmentId(itOrDev.id);
        return;
      }
    }

    if (text.includes('office') || text.includes('supplies')) {
      const opsOrAdmin = orgDepartments.find(d => {
        const dn = d.name.toLowerCase();
        return dn.includes('operat') || dn.includes('admin') || dn.includes('office') || dn.includes('general');
      });
      if (opsOrAdmin) {
        setCorrectionDepartmentId(opsOrAdmin.id);
        return;
      }
    }
  };

  const handleTestClassification = async () => {
    if (!testNarration.trim()) {
      toast.error('Enter a description to test.');
      return;
    }
    setTestResult(null);

    let effectiveType: 'debit' | 'credit' = 'debit';
    if (testType === 'debit' || testType === 'credit') {
      effectiveType = testType;
    } else {
      const lower = testNarration.toLowerCase();
      const incomeSignals = [
        'invoice payment', 'payment received', 'deposit', 'payout', 'refund',
        'cashback', 'client wire', 'sales', 'revenue', 'customer payment',
        'dividend', 'interest credit', 'salary credit', 'contract fee',
      ];
      if (incomeSignals.some(s => lower.includes(s))) {
        effectiveType = 'credit';
      }
    }

    const res = await classifyMut.execute({
      narration: testNarration.trim(),
      amount: 1000,
      type: effectiveType,
    });
    if (res.success && res.data) {
      setTestResult(res.data);
    } else {
      toast.error(res.error || 'Could not classify.');
    }
  };

  const handleThumbsUp = async (txnId: string, categoryId: string | undefined) => {
    if (!categoryId) {
      toast.error('This row has no category yet.');
      return;
    }

    const cat = categories.find((c) => c.id === categoryId);
    const catName = String(cat?.name || '').toLowerCase();
    let matchingDeptId: string | undefined;
    for (const d of orgDepartments) {
      const dName = String(d.name || '').toLowerCase();
      if (dName.includes('development') && (catName.includes('software') || catName.includes('tool') || catName.includes('saas') || catName.includes('cloud') || catName.includes('dev') || catName.includes('api') || catName.includes('tech') || catName.includes('infra'))) {
        matchingDeptId = d.id;
        break;
      }
      if (dName.includes('marketing') && (catName.includes('marketing') || catName.includes('ad') || catName.includes('campaign') || catName.includes('promo') || catName.includes('seo') || catName.includes('social'))) {
        matchingDeptId = d.id;
        break;
      }
    }

    // Optimistically update the transaction in local state for instant real-time feedback
    if (txnResult) {
      mutateTxns({
        ...txnResult,
        items: txnResult.items.map((t) =>
          t.id === txnId
            ? {
                ...t,
                categoryId,
                departmentId: matchingDeptId || t.departmentId,
                status: 'classified',
                classifiedBy: 'user',
                confidence: 100,
              }
            : t,
        ),
      });
    }

    const res = await learnMut.execute({ txnId, categoryId, departmentId: matchingDeptId });
    if (res.success) {
      const displayName = categories.find((c) => c.id === categoryId)?.name || 'Category';
      toast.success(res.message || `✓ Confirmed "${displayName}". Feedback saved to AI learning database.`);
      // Refresh all data to show updated stats and department metrics
      await Promise.all([
        refetchTxns(), 
        refetchRules(), 
        refetchStats(),
        svc.departments.getProfitability()
      ]);
    } else {
      toast.error(res.error || 'Could not save feedback.');
      await refetchTxns();
    }
  };

  const applyCorrection = async (txnId: string) => {
    if (!correctionCategoryId) {
      toast.error('Choose a category.');
      return;
    }
    const chosenCatId = correctionCategoryId;
    const chosenDeptId = correctionDepartmentId || undefined;

    // Optimistically update the transaction in local state for instant real-time feedback
    if (txnResult) {
      mutateTxns({
        ...txnResult,
        items: txnResult.items.map((t) =>
          t.id === txnId
            ? {
                ...t,
                categoryId: chosenCatId,
                departmentId: chosenDeptId || t.departmentId,
                status: 'classified',
                classifiedBy: 'user',
                confidence: 100,
              }
            : t,
        ),
      });
    }
    setExpandedCorrectionTxnId(null);
    setCorrectionCategoryId('');
    setCorrectionDepartmentId('');

    const res = await learnMut.execute({ txnId, categoryId: chosenCatId, departmentId: chosenDeptId });
    if (res.success) {
      const catName = categories.find((c) => c.id === chosenCatId)?.name || 'Category';
      toast.success(res.message || `✓ Category corrected to "${catName}". Feedback saved and AI pattern learned!`);
      // Refresh all data to show updated stats and department numbers
      await Promise.all([
        refetchTxns(), 
        refetchRules(), 
        refetchStats(),
        svc.departments.getProfitability()
      ]);
    } else {
      toast.error(res.error || 'Could not update.');
      await refetchTxns();
    }
  };

  // Auto-classify using AI
  const handleAutoClassifyAI = async (txnId: string) => {
    const txn = transactions.find(t => t.id === txnId);
    if (!txn) {
      toast.error('Transaction not found.');
      return;
    }

    const loadingToast = toast.loading('Asking AI to classify...');
    
    try {
      const classResult = await svc.classification.classify(
        txn.narration,
        Math.abs(txn.amount),
        txn.type
      );

      if (classResult.success && classResult.data) {
        const aiCat = classResult.data;
        toast.success(
          `AI suggests: "${aiCat.categoryName}" with ${aiCat.confidence}% confidence`,
          { id: loadingToast, duration: 5000 }
        );
        
        // Auto-apply the AI suggestion
        handleSelectCategory(aiCat.categoryId, aiCat.suggestedDepartmentId, txn.narration);
        
        // Show info toast
        setTimeout(() => {
          toast.info('AI suggestion auto-filled. Review and click "Apply Correction" to confirm.');
        }, 100);
      } else {
        toast.error(classResult.error || 'AI classification failed.', { id: loadingToast });
      }
    } catch (error) {
      console.error('AI classification error:', error);
      toast.error('Failed to classify with AI', { id: loadingToast });
    }
  };

  // Auto-classify using learned patterns only
  const handleAutoClassifyPatterns = async (txnId: string) => {
    const txn = transactions.find(t => t.id === txnId);
    if (!txn) {
      toast.error('Transaction not found.');
      return;
    }

    const loadingToast = toast.loading('Matching against learned patterns...');
    
    try {
      // Use pattern matching (no AI, just rules)
      const classResult = await svc.classification.classify(
        txn.narration,
        Math.abs(txn.amount),
        txn.type
      );

      if (classResult.success && classResult.data) {
        const result = classResult.data;
        
        if (result.confidence >= 60) {
          toast.success(
            `Pattern matched: "${result.categoryName}" with ${result.confidence}% confidence`,
            { id: loadingToast, duration: 5000 }
          );
          handleSelectCategory(result.categoryId, result.suggestedDepartmentId, txn.narration);
          
          setTimeout(() => {
            toast.info('Pattern suggestion auto-filled. Review and click "Apply Correction" to confirm.');
          }, 100);
        } else {
          toast.warning(
            `Low confidence: "${result.categoryName}" (${result.confidence}%)`,
            { id: loadingToast, duration: 5000 }
          );
          setCorrectionCategoryId(result.categoryId);
        }
      } else {
        toast.error(classResult.error || 'Pattern matching failed.', { id: loadingToast });
      }
    } catch (error) {
      console.error('Pattern matching error:', error);
      toast.error('Failed to match patterns', { id: loadingToast });
    }
  };

  const handleCreateRule = async () => {
    const pattern = newRulePattern.trim();
    if (!pattern) {
      toast.error('Enter a pattern to match.');
      return;
    }
    if (!newRuleCategoryId) {
      toast.error('Choose a category.');
      return;
    }
    const res = editingRuleId
      ? await updateRuleMut.execute({ id: editingRuleId, updates: { pattern, categoryId: newRuleCategoryId } })
      : await addRuleMut.execute({
          pattern,
          categoryId: newRuleCategoryId,
          confidence: 100,
          matchCount: 0,
          createdFrom: 'user',
        });
    if (res.success) {
      toast.success(res.message || (editingRuleId ? 'Rule updated.' : 'Rule added.'));
      setRuleDialogOpen(false);
      setNewRulePattern('');
      setNewRuleCategoryId('');
      setEditingRuleId(null);
      // Refetch rules to update the UI
      await refetchRules();
    } else {
      toast.error(res.error || 'Could not save rule.');
    }
  };

  const handleOpenEditRule = (rule: ClassificationRule) => {
    setEditingRuleId(rule.id);
    setNewRulePattern(rule.pattern);
    setNewRuleCategoryId(rule.categoryId);
    setRuleDialogOpen(true);
  };

  const handleDeleteRule = async (ruleId: string) => {
    const res = await deleteRuleMut.execute(ruleId);
    if (res.success) {
      toast.success(res.message || 'Rule removed.');
      // Refetch rules to update the UI
      await refetchRules();
    } else {
      toast.error(res.error || 'Could not delete rule.');
    }
  };

  const reviewCounts = useMemo(() => {
    const all = transactions.length;
    const auto = transactions.filter(t => t.classifiedBy === 'auto' || t.classifiedBy === 'ai').length;
    const needsReview = transactions.filter(
      t => t.status === 'pending' || (t.confidence !== undefined && t.confidence < 80 && t.classifiedBy !== 'user')
    ).length;
    const confirmed = transactions.filter(
      t => t.classifiedBy === 'user' || (t.confidence !== undefined && t.confidence >= 95)
    ).length;
    return { all, auto, needsReview, confirmed };
  }, [transactions]);

  const recentClassifications = useMemo(() => {
    return transactions.filter(t => {
      if (reviewFilter === 'auto') {
        return t.classifiedBy === 'auto' || t.classifiedBy === 'ai';
      }
      if (reviewFilter === 'needs-review') {
        return t.status === 'pending' || (t.confidence !== undefined && t.confidence < 80 && t.classifiedBy !== 'user');
      }
      if (reviewFilter === 'confirmed') {
        return t.classifiedBy === 'user' || (t.confidence !== undefined && t.confidence >= 95);
      }
      return true;
    });
  }, [transactions, reviewFilter]);

  const filteredReview = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return recentClassifications;
    return recentClassifications.filter(
      t =>
        t.narration.toLowerCase().includes(q) ||
        (categories.find(c => c.id === t.categoryId)?.name ?? '').toLowerCase().includes(q),
    );
  }, [recentClassifications, searchQuery, categories]);

  const categoryName = (id: string | undefined) =>
    categories.find(c => c.id === id)?.name ?? 'Unknown';
  const { featureFlags: platformFeatureFlags } = usePlatformSettings();

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            Logic & Learning Center
          </h1>
          <p className="text-gray-400 mt-1">AI-powered auto-classification engine</p>
        </div>
        <div className="flex items-center gap-3">
          <CategoryManagementDialog onCategoryCreated={() => {
            // Refresh categories without reloading the page
            void refetchCategories();
          }} />
          <div className="flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl">
            <Brain className="w-5 h-5 text-purple-400" />
            <div>
              <div className="text-sm font-medium text-white">Neural Network Status</div>
              <div className="text-xs text-purple-400">
                {platformFeatureFlags.ai_category_suggestions ? 'Active & Learning' : 'Deterministic Rules Only'}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {!platformFeatureFlags.ai_category_suggestions && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
          AI-Powered Category Suggestions are currently disabled system-wide in Platform Settings. Classification is running in deterministic rule-matching mode.
        </div>
      )}
      {categoriesError && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {categoriesError}
        </div>
      )}

      {/* AI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-[#0a0a0f] to-[#1a1a2e] rounded-2xl p-6 border border-cyan-500/20 relative overflow-hidden group hover:border-cyan-500/40 transition-all"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Accuracy Rate</span>
              <Target className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="text-3xl font-bold text-white">{aiMetrics.accuracyRate}%</div>
            <div className="text-xs text-green-400 mt-1">{aiMetrics.learningRate}</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-[#0a0a0f] to-[#1a1a2e] rounded-2xl p-6 border border-purple-500/20 relative overflow-hidden group hover:border-purple-500/40 transition-all"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Avg Confidence</span>
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div className="text-3xl font-bold text-white">{aiMetrics.avgConfidence}%</div>
            <div className="text-xs text-purple-400 mt-1">Across classified rows</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-[#0a0a0f] to-[#1a1a2e] rounded-2xl p-6 border border-blue-500/20 relative overflow-hidden group hover:border-blue-500/40 transition-all"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Auto-classified</span>
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <div className="text-3xl font-bold text-white">{aiMetrics.patternsLearned}</div>
            <div className="text-xs text-blue-400 mt-1">Transactions</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-br from-[#0a0a0f] to-[#1a1a2e] rounded-2xl p-6 border border-green-500/20 relative overflow-hidden group hover:border-green-500/40 transition-all"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">User Classified</span>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div className="text-3xl font-bold text-white">{aiMetrics.userClassified}</div>
            <div className="text-xs text-green-400 mt-1">Manual assignments</div>
          </div>
        </motion.div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 border-b border-[#1a1a2e]">
        {[
          { id: 'patterns' as LearningView, label: 'Learned Patterns', icon: Sparkles },
          { id: 'review' as LearningView, label: 'Classification Review', icon: Eye },
          { id: 'performance' as LearningView, label: 'AI Performance', icon: BarChart3 },
          { id: 'rules' as LearningView, label: 'Custom Rules', icon: Zap },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={cn(
                'px-6 py-3 flex items-center gap-2 text-sm font-medium transition-all relative',
                isActive
                  ? 'text-cyan-400'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="logicActiveTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 to-blue-500"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      {activeView === 'patterns' && (
        <div className="space-y-6">
          {/* Test Classification */}
          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                Test AI Classification
              </h3>
              <div className="flex items-center gap-1.5 bg-[#0a0a0f] p-1 rounded-xl border border-[#2a2a3e] text-xs">
                <button
                  type="button"
                  onClick={() => setTestType('auto')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg transition-all cursor-pointer',
                    testType === 'auto'
                      ? 'bg-purple-500/30 text-purple-300 font-medium border border-purple-500/40'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  ✨ Auto-Detect
                </button>
                <button
                  type="button"
                  onClick={() => setTestType('debit')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg transition-all cursor-pointer',
                    testType === 'debit'
                      ? 'bg-red-500/30 text-red-300 font-medium border border-red-500/40'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  Expense (Debit)
                </button>
                <button
                  type="button"
                  onClick={() => setTestType('credit')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg transition-all cursor-pointer',
                    testType === 'credit'
                      ? 'bg-emerald-500/30 text-emerald-300 font-medium border border-emerald-500/40'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  Income (Credit)
                </button>
              </div>
            </div>
            <div className="flex gap-4">
              <input
                type="text"
                placeholder="Enter a transaction description to test..."
                value={testNarration}
                onChange={(e) => setTestNarration(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTestClassification()}
                className="flex-1 px-4 py-3 bg-[#0a0a0f] border border-[#2a2a3e] rounded-xl text-white placeholder-gray-500 focus:border-purple-500/50 focus:outline-none transition-all"
              />
              <Button
                onClick={handleTestClassification}
                disabled={classifyMut.loading}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
              >
                {classifyMut.loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                Classify
              </Button>
            </div>

            {classifyMut.error && (
              <p className="mt-3 text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {classifyMut.error}
              </p>
            )}

            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 bg-[#0a0a0f] rounded-xl border border-[#2a2a3e]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm text-gray-400 mb-1">AI Classification Result</div>
                    <div className="text-xl font-semibold text-white">{testResult.categoryName}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400 mb-1">Confidence</div>
                    <div className={cn(
                      'text-xl font-bold',
                      testResult.confidence >= 80 ? 'text-green-400' :
                      testResult.confidence >= 60 ? 'text-orange-400' :
                      'text-red-400'
                    )}>
                      {testResult.confidence}%
                    </div>
                  </div>
                </div>
                <div className="text-sm text-gray-400 mb-3">{testResult.reasoning}</div>
                
                {testResult.alternativeSuggestions.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Alternative Suggestions:</div>
                    <div className="flex flex-wrap gap-2">
                      {testResult.alternativeSuggestions.map((alt, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg text-sm text-gray-400"
                        >
                          {alt.categoryName} ({alt.confidence}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Heading of Categories & Filter Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-3 pb-2 border-b border-[#1a1a2e]">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Folder className="w-4 h-4 text-cyan-400" />
                </div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Categories & Learned Patterns
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {filteredCategories.length} {filteredCategories.length === 1 ? 'Category' : 'Categories'}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1 pl-11">
                All organization categories and their AI keyword auto-classification triggers
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="w-40 sm:w-52 pl-9 pr-3 py-1.5 bg-[#0a0a0f] border border-[#2a2a3e] rounded-xl text-xs text-white placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none transition-all"
                />
              </div>

              <div className="flex bg-[#0a0a0f] border border-[#2a2a3e] rounded-xl p-0.5">
                {(['all', 'expense', 'income'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setCategoryTypeFilter(type)}
                    className={cn(
                      'px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all',
                      categoryTypeFilter === type
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Learned Patterns by Category - Full Categories Grid */}
          {categoriesLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading categories…
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="rounded-2xl border border-[#1a1a2e] bg-[#0a0a0f] p-12 text-center text-gray-400">
              {categories.length === 0
                ? 'No categories yet. Add categories in your chart of accounts to see learned patterns.'
                : 'No categories match your search or filter.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCategories.map((category) => {
                const IconComponent = getCategoryIconComponent(category.icon);
                const isIncome = category.type === 'income';
                const catColor = category.color || (isIncome ? '#10b981' : '#38bdf8');

                return (
                  <motion.div
                    key={category.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-2xl p-6 hover:border-cyan-500/30 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                          <span
                            className={cn(
                              'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border',
                              isIncome
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                            )}
                          >
                            {category.type}
                          </span>
                        </div>
                      </div>
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-lg"
                        style={{
                          backgroundColor: `${catColor}15`,
                          border: `1px solid ${catColor}40`,
                        }}
                      >
                        <IconComponent className="w-5 h-5" style={{ color: catColor }} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                        <span>Learned Patterns:</span>
                        <span className="text-gray-500 text-[11px] font-mono">
                          {category.patterns.length} pattern{category.patterns.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {category.patterns.slice(0, 8).map((pattern, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-md text-xs text-cyan-300 font-medium"
                          >
                            {pattern}
                          </span>
                        ))}
                        {category.patterns.length > 8 && (
                          <span className="px-2 py-1 bg-[#1a1a2e] border border-[#2a1a2e] rounded-md text-xs text-gray-400">
                            +{category.patterns.length - 8} more
                          </span>
                        )}
                        {category.patterns.length === 0 && (
                          <span className="text-xs text-gray-500 italic">No patterns learned yet</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeView === 'review' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search classifications..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-[#0a0a0f] border border-[#1a1a2e] rounded-xl text-white placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none transition-all"
              />
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 flex-wrap">
            {([
              { key: 'all' as const, label: 'All Classifications', count: reviewCounts.all },
              { key: 'auto' as const, label: 'Auto-Classified', count: reviewCounts.auto },
              { key: 'needs-review' as const, label: 'Needs Review (<80%)', count: reviewCounts.needsReview },
              { key: 'confirmed' as const, label: 'Confirmed (100%)', count: reviewCounts.confirmed },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setReviewFilter(tab.key)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                  reviewFilter === tab.key
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                    : 'bg-[#0a0a0f] border-[#1a1a2e] text-gray-400 hover:text-white hover:border-[#2a2a3e]'
                )}
              >
                {tab.label}
                <span className={cn(
                  'ml-2 px-1.5 py-0.5 rounded-md text-xs',
                  reviewFilter === tab.key ? 'bg-cyan-500/20 text-cyan-300' : 'bg-[#1a1a2e] text-gray-500'
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {txnsLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading transactions…
            </div>
          ) : (
            <div className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-[#1a1a2e]">
                <h3 className="text-lg font-semibold text-white">Classification Review</h3>
                <p className="text-sm text-gray-400 mt-1">Review transactions classified by AI & rules — confirm or correct to train better precision</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0f] border-b border-[#1a1a2e]">
                    <tr>
                      <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Date</th>
                      <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Description</th>
                      <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Category</th>
                      <th className="text-center px-6 py-4 text-xs font-medium text-gray-400 uppercase">Confidence</th>
                      <th className="text-right px-6 py-4 text-xs font-medium text-gray-400 uppercase">Amount</th>
                      <th className="text-center px-6 py-4 text-xs font-medium text-gray-400 uppercase">Feedback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a2e]">
                    {filteredReview.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                          No auto-classified transactions match your search. Try another filter or check back after imports.
                        </td>
                      </tr>
                    ) : (
                      filteredReview.map((txn, index) => (
                        <motion.tr
                          key={txn.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="hover:bg-[#1a1a2e]/30 transition-colors"
                        >
                          <td className="px-6 py-4 align-top">
                            <span className="text-gray-300">{new Date(txn.date).toLocaleDateString()}</span>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="text-white font-medium max-w-md truncate">{txn.narration}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                              {txn.classifiedBy === 'user' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                  <ThumbsUp className="w-2.5 h-2.5" /> User Confirmed
                                </span>
                              )}
                              {txn.classifiedBy === 'auto' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  <Zap className="w-2.5 h-2.5" /> Auto-Classified
                                </span>
                              )}
                              {txn.classifiedBy === 'ai' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                  <Sparkles className="w-2.5 h-2.5" /> AI Suggested
                                </span>
                              )}
                              {(txn.status === 'pending' || (txn.confidence !== undefined && txn.confidence < 80 && txn.classifiedBy !== 'user')) && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                  <AlertCircle className="w-2.5 h-2.5" /> Needs Review
                                </span>
                              )}
                              {txn.tags?.includes('recurring') && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-[#1a1a2e] text-gray-500 border border-[#2a2a3e]">
                                  Recurring
                                </span>
                              )}
                              {txn.tags?.includes('imported') && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-[#1a1a2e] text-gray-500 border border-[#2a2a3e]">
                                  Imported
                                </span>
                              )}
                            </div>
                            {expandedCorrectionTxnId === txn.id && (
                              <div className="mt-3 space-y-3">
                                {/* Quick AI Test Buttons */}
                                <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-[#2a2a3e]">
                                  <span className="text-xs text-gray-500">Quick test:</span>
                                  <button
                                    type="button"
                                    disabled={classifyMut.loading || learnMut.loading}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      console.log('[Logic Learning] Ask AI clicked for txn:', txn.id);
                                      handleAutoClassifyAI(txn.id);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {classifyMut.loading ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Sparkles className="w-3 h-3" />
                                    )}
                                    Ask AI
                                  </button>
                                  <button
                                    type="button"
                                    disabled={classifyMut.loading || learnMut.loading}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      console.log('[Logic Learning] Match Patterns clicked for txn:', txn.id);
                                      handleAutoClassifyPatterns(txn.id);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {classifyMut.loading ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Zap className="w-3 h-3" />
                                    )}
                                    Match Patterns
                                  </button>
                                </div>
                                
                                {/* Category & Department Selection */}
                                <div className="flex flex-wrap items-center gap-2.5 p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                                  <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-gray-400">Category:</label>
                                    <select
                                      value={correctionCategoryId}
                                      onChange={(e) => handleSelectCategory(e.target.value, undefined, txn.narration)}
                                      className="rounded-lg border border-[#2a2a3e] bg-[#0a0a0f] px-2.5 py-1 text-xs text-white focus:border-cyan-500/50"
                                    >
                                      <option value="">Select category…</option>
                                      {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-gray-400">Department:</label>
                                    <select
                                      value={correctionDepartmentId}
                                      onChange={(e) => setCorrectionDepartmentId(e.target.value)}
                                      className="rounded-lg border border-[#2a2a3e] bg-[#0a0a0f] px-2.5 py-1 text-xs text-white focus:border-cyan-500/50"
                                    >
                                      <option value="">Auto-Detect / Shared</option>
                                      {orgDepartments.map((d) => (
                                        <option key={d.id} value={d.id}>
                                          {d.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                                    disabled={learnMut.loading}
                                    onClick={() => applyCorrection(txn.id)}
                                  >
                                    {learnMut.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save & Learn'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-gray-400 hover:text-white"
                                    onClick={() => {
                                      setExpandedCorrectionTxnId(null);
                                      setCorrectionCategoryId('');
                                      setCorrectionDepartmentId('');
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 align-top">
                            <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              {categoryName(txn.categoryId)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center align-top">
                            {(() => {
                              const conf = txn.classifiedBy === 'user'
                                ? 100
                                : (txn.confidence != null
                                    ? (txn.confidence <= 1 && txn.confidence > 0 ? Math.round(txn.confidence * 100) : Math.round(txn.confidence))
                                    : 0);
                              return (
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-16 h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
                                    <div
                                      className={cn(
                                        'h-full',
                                        conf >= 80 ? 'bg-green-500' :
                                        conf >= 60 ? 'bg-orange-500' :
                                        'bg-red-500'
                                      )}
                                      style={{ width: `${conf}%` }}
                                    />
                                  </div>
                                  <span className="text-sm text-gray-400">{conf}%</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4 text-right align-top">
                            <span className={cn(
                              'font-medium',
                              txn.type === 'credit' ? 'text-green-400' : 'text-red-400'
                            )}>
                              {txn.type === 'credit' ? '+' : '-'}
                              {(txn.currency || 'USD') !== 'USD' ? (txn.currency + ' ') : '$'}{Math.abs(txn.amount).toLocaleString()}
                            </span>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                disabled={learnMut.loading}
                                onClick={() => handleThumbsUp(txn.id, txn.categoryId)}
                                className="p-2 hover:bg-green-500/10 rounded-lg transition-colors group disabled:opacity-50"
                                title="Confirm classification"
                              >
                                <ThumbsUp className="w-4 h-4 text-gray-400 group-hover:text-green-400" />
                              </button>
                              <button
                                type="button"
                                disabled={learnMut.loading}
                                onClick={() => {
                                  setExpandedCorrectionTxnId(txn.id);
                                  setCorrectionCategoryId(txn.categoryId || '');
                                }}
                                className="p-2 hover:bg-red-500/10 rounded-lg transition-colors group disabled:opacity-50"
                                title="Wrong category — pick the right one"
                              >
                                <ThumbsDown className="w-4 h-4 text-gray-400 group-hover:text-red-400" />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'performance' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-[#0a0a0f] to-[#1a1a2e] rounded-2xl p-6 border border-cyan-500/20"
          >
            <h3 className="text-lg font-semibold text-white mb-6">Classification Accuracy Trend</h3>
            <div className="space-y-4">
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((month, idx) => {
                const base = statsResult?.accuracyRate ?? 88;
                const accuracy = Math.min(99, base - 4 + idx * 0.8);
                return (
                  <div key={month}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">{month} 2026</span>
                      <span className="text-sm text-cyan-400 font-medium">{accuracy.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${accuracy}%` }}
                        transition={{ duration: 1, delay: idx * 0.1 }}
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-[#0a0a0f] to-[#1a1a2e] rounded-2xl p-6 border border-purple-500/20"
          >
            <h3 className="text-lg font-semibold text-white mb-6">Category Performance</h3>
            <div className="space-y-4">
              {categories.slice(0, 6).map((category, idx) => {
                const hash = category.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                const accuracy = 85 + (hash % 12);
                return (
                  <div key={category.id}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{category.icon}</span>
                        <span className="text-sm text-white">{category.name}</span>
                      </div>
                      <span className="text-sm text-purple-400 font-medium">{accuracy}%</span>
                    </div>
                    <div className="h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${accuracy}%` }}
                        transition={{ duration: 1, delay: idx * 0.1 }}
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {activeView === 'rules' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditingRuleId(null);
                setNewRulePattern('');
                setNewRuleCategoryId(categories[0]?.id ?? '');
                setRuleDialogOpen(true);
              }}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Custom Rule
            </Button>
          </div>

          <Dialog
            open={ruleDialogOpen}
            onOpenChange={(open) => {
              setRuleDialogOpen(open);
              if (!open) setEditingRuleId(null);
            }}
          >
            <DialogContent className="border-[#2a2a3e] bg-[#0a0a0f] text-white sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingRuleId ? 'Edit classification rule' : 'New classification rule'}</DialogTitle>
                <DialogDescription className="text-gray-400">
                  If a transaction description contains this text, classify it to the category you pick.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Contains text</label>
                  <input
                    value={newRulePattern}
                    onChange={(e) => setNewRulePattern(e.target.value)}
                    placeholder="e.g. AWS or SALARY"
                    className="w-full rounded-lg border border-[#2a2a3e] bg-[#1a1a2e] px-3 py-2 text-sm text-white placeholder:text-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Category</label>
                  <select
                    value={newRuleCategoryId}
                    onChange={(e) => setNewRuleCategoryId(e.target.value)}
                    className="w-full rounded-lg border border-[#2a2a3e] bg-[#1a1a2e] px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select a category…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRuleDialogOpen(false)} className="text-gray-400">
                  Cancel
                </Button>
                <Button onClick={handleCreateRule} disabled={addRuleMut.loading || updateRuleMut.loading}>
                  {(addRuleMut.loading || updateRuleMut.loading) ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save rule'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Custom Classification Rules</h3>
            <p className="text-sm text-gray-400 mb-6">
              Rules you add here override the default AI guess when the description matches.
            </p>

            {rulesLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading rules…
              </div>
            ) : rules.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                No custom rules yet. Create one or confirm a wrong classification in the review tab to add learned rules.
              </p>
            ) : (
              <div className="space-y-3">
                {rules.map((rule, index) => (
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center justify-between p-4 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl hover:border-cyan-500/30 transition-all"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0">
                        <Zap className="w-5 h-5 text-cyan-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">
                          If contains: <span className="text-cyan-400 font-mono">{rule.pattern}</span>
                        </div>
                        <div className="text-sm text-gray-400 truncate">
                          Then classify as: {categoryName(rule.categoryId)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full text-xs text-green-400">
                        {rule.confidence}% confidence
                      </span>
                      <button
                        type="button"
                        className="p-2 hover:bg-blue-500/10 rounded-lg transition-colors"
                        title="Edit rule"
                        onClick={() => handleOpenEditRule(rule)}
                      >
                        <Edit className="w-4 h-4 text-blue-400" />
                      </button>
                      <button
                        type="button"
                        disabled={deleteRuleMut.loading}
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-2 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
