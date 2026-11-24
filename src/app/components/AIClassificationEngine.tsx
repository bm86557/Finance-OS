import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Brain,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Search,
  ChevronRight,
  Zap,
  TrendingUp,
  BarChart3,
  Target,
  BookOpen,
  Edit3,
  MessageSquare,
  RefreshCw,
  Layers,
  GitBranch,
  Clock,
  Check,
  X,
  Lightbulb,
  Shield,
  Activity,
  Plus,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { AXIOM } from '../../styles/axiom-tokens';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Area,
  AreaChart,
} from 'recharts';
import { toast } from 'sonner';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';

interface QueueItem {
  id: string;
  date: string;
  narration: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';
  account: string;
  world: 'business' | 'personal';
  riskFlags: string[];
  source: string;
  aiSuggestion: {
    categoryId: string;
    category: string;
    confidence: number; // 0..1 for ConfidenceBar
    reasoning: string;
    proposedNewCategory?: any;
    alternativeSuggestions?: { categoryId: string; category: string; confidence: number }[];
  };
  status: 'pending' | 'confirmed' | 'rejected' | 'needs_clarification';
}

const CHART_PALETTE = ['#3b82f6', '#06b6d4', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#64748b'];

function ConfidenceBar({ confidence, size = 'md' }: { confidence: number; size?: 'sm' | 'md' | 'lg' }) {
  const norm = confidence > 1 ? confidence / 100 : confidence;
  const clamped = Math.max(0, Math.min(1, norm));
  const getColor = (c: number) => {
    if (c >= 0.9) return '#10b981';
    if (c >= 0.7) return '#3b82f6';
    if (c >= 0.5) return '#f59e0b';
    return '#ef4444';
  };
  const color = getColor(clamped);
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';

  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 ${h} rounded-full overflow-hidden`} style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clamped * 100}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`${h} rounded-full`}
          style={{ background: color, boxShadow: `0 0 8px ${color}80` }}
        />
      </div>
      <span className="text-xs font-mono" style={{ color, minWidth: '36px', textAlign: 'right' }}>
        {(clamped * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function GlowContainer({
  children,
  color = 'blue',
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  color?: 'blue' | 'cyan' | 'purple' | 'green' | 'amber' | 'pink' | 'red';
  className?: string;
  delay?: number;
}) {
  const containerKey = `chart${color.charAt(0).toUpperCase() + color.slice(1)}` as keyof typeof AXIOM.containers;
  const containerStyle = AXIOM.containers[containerKey] || AXIOM.containers.chartBlue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className={`rounded-2xl p-6 relative overflow-hidden ${className}`}
      style={containerStyle}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: AXIOM.radialOverlays[color] || AXIOM.radialOverlays.blue, opacity: 0.15 }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
  color = '#3b82f6',
}: {
  icon: any;
  title: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div
        className="p-2.5 rounded-xl"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 8px 20px -6px ${color}80` }}
      >
        <Icon className="size-5 text-white" />
      </div>
      <div>
        <h3 className="text-white text-lg">{title}</h3>
        {subtitle && (
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

export function AIClassificationEngine() {
  const navigate = useNavigate();
  const svc = useOrgServices();

  const [activeTab, setActiveTab] = useState<'queue' | 'rules' | 'insights'>('queue');
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'low' | 'medium' | 'high'>('all');
  const [rulesSearch, setRulesSearch] = useState('');
  const [classificationMap, setClassificationMap] = useState<Map<string, any>>(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedOverrides, setSelectedOverrides] = useState<
    Record<string, { categoryId: string; world: 'business' | 'personal'; scope: 'row' | 'batch' | 'future' }>
  >({});

  // Add Rule inline modal state
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleCategoryId, setNewRuleCategoryId] = useState('');
  const [newRuleWorld, setNewRuleWorld] = useState<'business' | 'personal'>('business');

  const { data: txnResult, loading: txnsLoading, refetch: refetchTxns } = useService(
    () => svc.transactions.getAll({ pageSize: 200 }),
    [svc.orgId],
    ['transactions'],
  );
  const { data: categories = [], refetch: refetchCategories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );
  const { data: bankAccounts = [] } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['accounts'],
  );
  const { data: rules = [], refetch: refetchRules } = useServiceArray(
    () => svc.classification.getRules(true),
    [svc.orgId],
    ['classification-rules'],
  );
  const { data: statsData, refetch: refetchStats } = useService(
    () => svc.classification.getStats(),
    [svc.orgId],
    ['transactions', 'classification-rules', 'categories'],
  );
  const { data: performanceData, refetch: refetchPerf } = useService(
    () => svc.classification.getPerformance(),
    [svc.orgId],
    ['transactions', 'classification-rules', 'categories'],
  );

  const allTransactions = txnResult?.items ?? [];

  const bankAccountMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of bankAccounts || []) {
      const name = (acc as any).bankName || (acc as any).accountName || (acc as any).name || 'Bank Account';
      map.set(acc.id, name);
    }
    return map;
  }, [bankAccounts]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const runLiveAnalysis = useCallback(async () => {
    const pending = allTransactions.filter(
      t =>
        !['posted', 'reconciled', 'reversed', 'cancelled'].includes(String(t.status || '')) &&
        (t.status === 'pending' || !t.categoryId || (t.confidence != null && t.confidence < 85 && t.classifiedBy !== 'user')),
    );
    if (pending.length === 0 || !svc.classification?.batchClassify) {
      setClassificationMap(new Map());
      return;
    }
    setAnalyzing(true);
    try {
      const slice = pending.slice(0, 30);
      const payload = slice.map(t => ({
        id: t.id,
        narration: t.narration || t.description || 'Transaction',
        amount: Math.abs(t.amount),
        type: t.type === 'credit' ? ('credit' as const) : ('debit' as const),
        accountId: t.bankAccountId,
      }));
      const res = await svc.classification.batchClassify(payload, true);
      if (res.success && res.data) {
        const nextMap = new Map<string, any>();
        slice.forEach((t, idx) => {
          const item = res.data.get(idx);
          if (item) nextMap.set(t.id, item);
        });
        setClassificationMap(nextMap);
      }
    } catch (err) {
      console.warn('[AIClassificationEngine] batchClassify warning:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [allTransactions, svc.classification]);

  useEffect(() => {
    if (allTransactions.length > 0 && classificationMap.size === 0) {
      void runLiveAnalysis();
    }
  }, [allTransactions.length, classificationMap.size, runLiveAnalysis]);

  const queueItems: QueueItem[] = useMemo(() => {
    return allTransactions
      .filter(
        t =>
          !['posted', 'reconciled', 'reversed', 'cancelled'].includes(String(t.status || '')) &&
          (t.status === 'pending' || !t.categoryId || (t.confidence != null && t.confidence < 85 && t.classifiedBy !== 'user')),
      )
      .map(t => {
        const ai = classificationMap.get(t.id);
        const rawConf =
          ai?.confidence != null
            ? Number(ai.confidence)
            : t.confidence != null
              ? Number(t.confidence)
              : 0;
        const conf01 = rawConf > 1 ? rawConf / 100 : rawConf;
        const suggestedCatId = ai?.categoryId || t.suggestedCategoryId || t.categoryId || '';
        const suggestedCatName =
          ai?.categoryName ||
          ai?.proposedNewCategory?.name ||
          (suggestedCatId ? categoryMap.get(suggestedCatId) : '') ||
          'Uncategorized';
        const world: 'business' | 'personal' =
          ai?.world === 'personal' || (t as any).worldScope === 'personal' || t.tags?.includes('personal')
            ? 'personal'
            : 'business';
        const riskFlags: string[] = Array.from(
          new Set([
            ...(Array.isArray((t as any).riskFlags) ? (t as any).riskFlags : []),
            ...(Array.isArray(ai?.riskFlags) ? ai.riskFlags : []),
          ]),
        );

        const alts = Array.isArray(ai?.alternativeSuggestions)
          ? ai.alternativeSuggestions.map((a: any) => ({
              categoryId: a.categoryId || '',
              category: a.categoryName || a.category || '',
              confidence: Number(a.confidence || 0) > 1 ? Number(a.confidence) / 100 : Number(a.confidence || 0),
            }))
          : [];

        const itemStatus: QueueItem['status'] =
          t.classifiedBy === 'user' && t.categoryId
            ? 'confirmed'
            : conf01 < 0.6 || riskFlags.length > 0
              ? 'needs_clarification'
              : 'pending';

        return {
          id: t.id,
          date: t.date,
          narration: t.narration || t.description || 'Transaction',
          amount: Math.abs(t.amount),
          currency: t.currency || 'USD',
          type: t.type === 'credit' ? 'credit' : 'debit',
          account: (t.bankAccountId && bankAccountMap.get(t.bankAccountId)) || 'Bank Account',
          world,
          riskFlags,
          source: ai?.source || t.classifiedBy || 'pending',
          aiSuggestion: {
            categoryId: suggestedCatId,
            category: suggestedCatName,
            confidence: conf01,
            reasoning: ai?.reasoning || (t as any).aiReasoning || 'Awaiting rules/AI review',
            proposedNewCategory: ai?.proposedNewCategory || null,
            alternativeSuggestions: alts,
          },
          status: itemStatus,
        };
      });
  }, [allTransactions, classificationMap, categoryMap, bankAccountMap]);

  const stats = useMemo(() => {
    const total = queueItems.length;
    const needsClarification = queueItems.filter(t => t.status === 'needs_clarification').length;
    const highConfidence = queueItems.filter(
      t => t.aiSuggestion.confidence >= 0.85 && t.riskFlags.length === 0 && Boolean(t.aiSuggestion.categoryId),
    ).length;
    const confirmed = statsData?.userClassified ?? 0;
    const totalTxns = statsData?.totalTransactions ?? allTransactions.length;
    const autoPct = totalTxns > 0 ? Math.round(((statsData?.autoClassified ?? 0) / totalTxns) * 100) : 0;
    return {
      total,
      needsClarification,
      highConfidence,
      confirmed,
      accuracyRate: statsData?.accuracyRate ?? 0,
      autoPct,
      rulesCount: statsData?.rulesCount ?? rules.filter(r => r.status !== 'archived').length,
    };
  }, [queueItems, statsData, allTransactions.length, rules]);

  const filteredTransactions = useMemo(() => {
    let filtered = queueItems;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        t => t.narration.toLowerCase().includes(q) || t.aiSuggestion.category.toLowerCase().includes(q),
      );
    }
    if (filterConfidence === 'low') filtered = filtered.filter(t => t.aiSuggestion.confidence < 0.6);
    else if (filterConfidence === 'medium')
      filtered = filtered.filter(t => t.aiSuggestion.confidence >= 0.6 && t.aiSuggestion.confidence < 0.85);
    else if (filterConfidence === 'high') filtered = filtered.filter(t => t.aiSuggestion.confidence >= 0.85);
    return filtered;
  }, [queueItems, searchQuery, filterConfidence]);

  const filteredRules = useMemo(() => {
    const visible = rules.filter(r => r.status !== 'archived');
    if (!rulesSearch) return visible;
    const q = rulesSearch.toLowerCase();
    return visible.filter(
      r =>
        r.pattern.toLowerCase().includes(q) ||
        (categoryMap.get(r.categoryId) || '').toLowerCase().includes(q),
    );
  }, [rules, rulesSearch, categoryMap]);

  // Live Learning Insights charts derived from real Supabase data
  const learningTrendData = useMemo(() => {
    return (performanceData?.monthlyTrend || []).map(row => ({
      date: row.label,
      accuracy: row.accuracy ?? 0,
      accepted: row.accepted,
      manualOverrides: row.corrected,
      total: row.total,
    }));
  }, [performanceData]);

  const categoryDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTransactions) {
      if (!t.categoryId) continue;
      const name = categoryMap.get(t.categoryId) || 'Other';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0) || 1;
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count], idx) => ({
        name,
        value: Math.round((count / total) * 100),
        count,
        color: CHART_PALETTE[idx % CHART_PALETTE.length],
      }));
  }, [allTransactions, categoryMap]);

  const confidenceDistribution = useMemo(() => {
    const buckets = [
      { range: '0-50%', count: 0, color: '#ef4444' },
      { range: '50-70%', count: 0, color: '#f59e0b' },
      { range: '70-85%', count: 0, color: '#06b6d4' },
      { range: '85-95%', count: 0, color: '#3b82f6' },
      { range: '95-100%', count: 0, color: '#10b981' },
    ];
    for (const t of allTransactions) {
      if (t.confidence == null) continue;
      const c = Number(t.confidence) <= 1 && Number(t.confidence) > 0 ? Number(t.confidence) * 100 : Number(t.confidence);
      if (c < 50) buckets[0].count++;
      else if (c < 70) buckets[1].count++;
      else if (c < 85) buckets[2].count++;
      else if (c < 95) buckets[3].count++;
      else buckets[4].count++;
    }
    return buckets;
  }, [allTransactions]);

  const recentActivity = useMemo(() => {
    return allTransactions
      .filter(t => t.classifiedAt || t.classifiedBy)
      .slice(0, 8)
      .map(t => ({
        id: t.id,
        action:
          t.classifiedBy === 'user'
            ? 'User confirmed'
            : t.classifiedBy === 'ai'
              ? 'AI classified'
              : t.classifiedBy === 'bulk_review'
                ? 'Bulk approved'
                : 'Auto-classified',
        narration: t.narration || t.description || 'Transaction',
        category: (t.categoryId && categoryMap.get(t.categoryId)) || 'Pending',
        time: t.classifiedAt ? new Date(t.classifiedAt).toLocaleDateString() : t.date,
      }));
  }, [allTransactions, categoryMap]);

  const refreshAll = async () => {
    await Promise.all([refetchTxns(), refetchRules(), refetchStats(), refetchPerf(), refetchCategories()]);
  };

  const handleConfirm = async (tx: QueueItem) => {
    const override = selectedOverrides[tx.id];
    const targetCatId = override?.categoryId || tx.aiSuggestion.categoryId;
    const targetWorld = override?.world || tx.world;
    const targetScope = override?.scope || 'future';

    if (!targetCatId && !tx.aiSuggestion.proposedNewCategory) {
      toast.error('Expand this row and select a category first.');
      setExpandedTx(tx.id);
      return;
    }

    setBusyId(tx.id);
    try {
      const res = await svc.classification.recordHumanOverride({
        transactionId: tx.id,
        correctCategoryId: targetCatId || undefined,
        proposedNewCategory: !targetCatId ? tx.aiSuggestion.proposedNewCategory : undefined,
        world: targetWorld,
        scope: targetScope,
        rationale: `Confirmed in AI Classification Engine (${targetScope})`,
      });
      if (!res.success) {
        toast.error(res.error || 'Could not confirm transaction');
        return;
      }
      toast.success(res.message || 'Classification confirmed');
      await refreshAll();
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (tx: QueueItem) => {
    setBusyId(tx.id);
    try {
      const res = await svc.classification.rejectSuggestion(tx.id, {
        suggestedCategoryId: tx.aiSuggestion.categoryId || undefined,
        suggestedConfidence: Math.round(tx.aiSuggestion.confidence * 100),
        reason: 'Rejected in AI Classification Engine queue',
      });
      if (!res.success) {
        toast.error(res.error || 'Could not record rejection');
        return;
      }
      toast.info('Suggestion rejected and logged');
      await refreshAll();
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkConfirmHigh = async () => {
    const highItems = queueItems.filter(
      t => t.aiSuggestion.confidence >= 0.85 && t.riskFlags.length === 0 && Boolean(t.aiSuggestion.categoryId),
    );
    if (highItems.length === 0) {
      toast.info('No risk-free high-confidence items available to bulk confirm.');
      return;
    }
    setAnalyzing(true);
    try {
      let okCount = 0;
      for (const item of highItems) {
        const res = await svc.classification.recordHumanOverride({
          transactionId: item.id,
          correctCategoryId: item.aiSuggestion.categoryId,
          world: item.world,
          scope: 'row',
          rationale: 'Bulk confirmed high-confidence risk-free suggestion',
        });
        if (res.success) okCount++;
      }
      toast.success(`Confirmed ${okCount} high-confidence transaction(s)`);
      await refreshAll();
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddRule = async () => {
    if (!newRulePattern.trim() || !newRuleCategoryId) {
      toast.error('Pattern and category are required.');
      return;
    }
    const res = await svc.classification.addRule({
      pattern: newRulePattern.trim(),
      categoryId: newRuleCategoryId,
      confidence: 90,
      matchCount: 0,
      createdFrom: 'user',
      world: newRuleWorld,
      scope: { world: newRuleWorld },
    });
    if (res.success) {
      toast.success(res.message || 'Rule added');
      setShowAddRule(false);
      setNewRulePattern('');
      setNewRuleCategoryId('');
      await refreshAll();
    } else {
      toast.error(res.error || 'Could not add rule');
    }
  };

  const handleArchiveRule = async (ruleId: string) => {
    const res = await svc.classification.deleteRule(ruleId);
    if (res.success) {
      toast.success('Rule archived (evidence preserved)');
      await refreshAll();
    } else {
      toast.error(res.error || 'Could not archive rule');
    }
  };

  const handleRevertRule = async (ruleId: string, version: number) => {
    const res = await svc.classification.revertRuleVersion(ruleId, version - 1, 'Reverted from AI Classification Engine');
    if (res.success) {
      toast.success(res.message || `Reverted to v${version - 1}`);
      await refreshAll();
    } else {
      toast.error(res.error || 'Could not revert rule');
    }
  };

  const kpiCards = [
    { icon: Brain, label: 'Live AI Accuracy', value: `${stats.accuracyRate}%`, delta: 'Real feedback', color: '#3b82f6' },
    { icon: Zap, label: 'Auto-Classified', value: `${stats.autoPct}%`, delta: `${statsData?.autoClassified ?? 0} txns`, color: '#10b981' },
    { icon: HelpCircle, label: 'Needs Review', value: String(stats.needsClarification), delta: `${stats.total} queued`, color: '#f59e0b' },
    { icon: BookOpen, label: 'Active Rules', value: String(stats.rulesCount), delta: 'Versioned', color: '#a855f7' },
  ];

  return (
    <div className="min-h-screen" style={{ background: AXIOM.backgrounds.main }}>
      {/* Ambient gradient orbs */}
      <div className="fixed top-20 left-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-cyan-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
      <div
        className="fixed bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-indigo-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none"
        style={{ animationDelay: '1s' }}
      />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-50 backdrop-blur-lg border-b px-8 py-6"
        style={{
          background: AXIOM.backgrounds.topBar,
          borderBottom: AXIOM.borders.topBar,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05, x: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/organization')}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <ArrowLeft className="size-4" />
              Back
            </motion.button>
            <div className="flex items-center gap-3">
              <div
                className="p-3 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <Brain className="size-6 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                  AI Classification Engine
                </h1>
                <p className="text-sm" style={{ color: '#94a3b8' }}>
                  Live Rules-First + AI Narration Classification with Versioned Learning
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={analyzing || stats.highConfidence === 0}
              onClick={handleBulkConfirmHigh}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={AXIOM.buttons.success}
            >
              <CheckCircle2 className="size-4" />
              Confirm All High ({stats.highConfidence})
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={analyzing}
              onClick={() => void runLiveAnalysis()}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={AXIOM.buttons.action}
            >
              <RefreshCw className={`size-4 ${analyzing ? 'animate-spin' : ''}`} />
              {analyzing ? 'Analyzing…' : 'Re-Analyze'}
            </motion.button>
          </div>
        </div>
      </motion.div>

      <div className="relative z-10 p-8 space-y-8">
        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {kpiCards.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-2xl p-5 relative overflow-hidden"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: `1px solid ${kpi.color}33`,
                boxShadow: `0 15px 40px -15px ${kpi.color}40`,
              }}
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 rounded-lg" style={{ background: `${kpi.color}20` }}>
                    <kpi.icon className="size-4" style={{ color: kpi.color }} />
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full text-slate-300" style={{ background: 'rgba(148,163,184,0.12)' }}>
                    {kpi.delta}
                  </span>
                </div>
                <p className="text-3xl font-bold text-white mb-1">{kpi.value}</p>
                <p className="text-xs" style={{ color: '#94a3b8' }}>
                  {kpi.label}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 p-1.5 rounded-xl w-fit" style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(148, 163, 184, 0.1)' }}>
          {[
            { key: 'queue', label: 'Classification Queue', icon: Layers, count: stats.total },
            { key: 'rules', label: 'Learned Rules', icon: GitBranch, count: filteredRules.length },
            { key: 'insights', label: 'Learning Insights', icon: TrendingUp },
          ].map(tab => (
            <motion.button
              key={tab.key}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className="px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
              style={activeTab === tab.key ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
            >
              <tab.icon className="size-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
                  style={{ background: activeTab === tab.key ? 'rgba(255,255,255,0.2)' : 'rgba(148, 163, 184, 0.15)' }}
                >
                  {tab.count}
                </span>
              )}
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* TAB 1: LIVE CLASSIFICATION QUEUE */}
          {activeTab === 'queue' && (
            <motion.div key="queue" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: '#64748b' }} />
                  <input
                    type="text"
                    placeholder="Search narrations, categories..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    style={{ ...AXIOM.inputs, border: AXIOM.inputs.border }}
                  />
                </div>
                <div className="flex gap-2">
                  {(['all', 'low', 'medium', 'high'] as const).map(f => (
                    <motion.button
                      key={f}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setFilterConfidence(f)}
                      className="px-3 py-2 rounded-lg text-xs font-medium capitalize"
                      style={filterConfidence === f ? AXIOM.buttons.info : AXIOM.buttons.secondary}
                    >
                      {f === 'all' ? 'All' : `${f} conf.`}
                    </motion.button>
                  ))}
                </div>
              </div>

              {txnsLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
                  <Loader2 className="size-5 animate-spin" />
                  Loading live classification queue…
                </div>
              ) : filteredTransactions.length === 0 ? (
                <GlowContainer color="green">
                  <div className="py-10 text-center">
                    <CheckCircle2 className="size-10 text-emerald-400 mx-auto mb-3" />
                    <h3 className="text-white text-lg font-medium mb-1">Queue Clear</h3>
                    <p className="text-sm text-slate-400">No pending or low-confidence transactions match your filter.</p>
                  </div>
                </GlowContainer>
              ) : (
                <div className="space-y-4">
                  {filteredTransactions.map((tx, i) => {
                    const isExpanded = expandedTx === tx.id;
                    const override = selectedOverrides[tx.id] || {
                      categoryId: tx.aiSuggestion.categoryId,
                      world: tx.world,
                      scope: 'future' as const,
                    };

                    return (
                      <motion.div key={tx.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} layout>
                        <GlowContainer color={tx.status === 'needs_clarification' ? 'amber' : tx.aiSuggestion.confidence >= 0.85 ? 'blue' : 'cyan'}>
                          <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpandedTx(isExpanded ? null : tx.id)}>
                            <div className="flex-shrink-0">
                              {tx.status === 'needs_clarification' ? (
                                <div className="p-2 rounded-lg" style={{ background: 'rgba(245, 158, 11, 0.15)' }}>
                                  <MessageSquare className="size-5 text-amber-400" />
                                </div>
                              ) : (
                                <div className="p-2 rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                                  <Sparkles className="size-5 text-blue-400" />
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <p className="text-white text-sm font-medium truncate">{tx.narration}</p>
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold"
                                  style={tx.world === 'personal' ? AXIOM.badges.warning : AXIOM.badges.cyan}
                                >
                                  {tx.world}
                                </span>
                                {tx.riskFlags.map(rf => (
                                  <span key={rf} className="px-2 py-0.5 rounded-full text-[10px] font-mono" style={AXIOM.badges.warning}>
                                    {rf.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                              <div className="flex items-center gap-3 text-xs" style={{ color: '#94a3b8' }}>
                                <span>{tx.date}</span>
                                <span>·</span>
                                <span>{tx.account}</span>
                                <span>·</span>
                                <span className="font-mono text-cyan-300">{tx.aiSuggestion.category}</span>
                                <span>·</span>
                                <span className="font-mono text-slate-400">{tx.source}</span>
                              </div>
                            </div>

                            <div className="w-32 flex-shrink-0">
                              <ConfidenceBar confidence={tx.aiSuggestion.confidence} size="sm" />
                            </div>

                            <div className="text-right flex-shrink-0">
                              <p className={`text-sm font-mono ${tx.type === 'credit' ? 'text-emerald-400' : 'text-white'}`}>
                                {tx.type === 'credit' ? '+' : '-'}${tx.amount.toLocaleString()}
                              </p>
                              <p className="text-xs" style={{ color: '#64748b' }}>
                                {tx.currency}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                disabled={busyId === tx.id}
                                onClick={e => {
                                  e.stopPropagation();
                                  void handleConfirm(tx);
                                }}
                                className="p-1.5 rounded-lg disabled:opacity-50"
                                style={{ background: 'rgba(16, 185, 129, 0.15)' }}
                                title="Confirm & save"
                              >
                                <Check className="size-4 text-emerald-400" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                disabled={busyId === tx.id}
                                onClick={e => {
                                  e.stopPropagation();
                                  void handleReject(tx);
                                }}
                                className="p-1.5 rounded-lg disabled:opacity-50"
                                style={{ background: 'rgba(239, 68, 68, 0.15)' }}
                                title="Reject suggestion"
                              >
                                <X className="size-4 text-red-400" />
                              </motion.button>
                            </div>

                            <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} className="flex-shrink-0">
                              <ChevronRight className="size-4" style={{ color: '#64748b' }} />
                            </motion.div>
                          </div>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-4 pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                                  <div>
                                    <div className="flex items-center gap-2 mb-2">
                                      <Lightbulb className="size-4 text-blue-400" />
                                      <span className="text-sm text-white">Engine Reasoning</span>
                                    </div>
                                    <p className="text-sm text-slate-400">{tx.aiSuggestion.reasoning}</p>
                                    {tx.aiSuggestion.alternativeSuggestions && tx.aiSuggestion.alternativeSuggestions.length > 0 && (
                                      <div className="mt-4 space-y-2">
                                        <p className="text-xs text-slate-500">Alternative Suggestions:</p>
                                        {tx.aiSuggestion.alternativeSuggestions.map((alt, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center justify-between px-3 py-2 rounded-lg"
                                            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.08)' }}
                                          >
                                            <span className="text-xs text-white">{alt.category}</span>
                                            <div className="w-28">
                                              <ConfidenceBar confidence={alt.confidence} size="sm" />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                      <Shield className="size-4 text-cyan-400" />
                                      <span className="text-sm text-white">Human Override &amp; Learning Scope</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <select
                                        value={override.categoryId}
                                        onChange={e =>
                                          setSelectedOverrides(prev => ({
                                            ...prev,
                                            [tx.id]: { ...override, categoryId: e.target.value },
                                          }))
                                        }
                                        className="px-3 py-2 rounded-lg text-xs text-white bg-slate-950 border border-slate-800"
                                      >
                                        <option value="">Select category…</option>
                                        {categories.map(c => (
                                          <option key={c.id} value={c.id}>
                                            {c.name} ({c.type})
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        value={override.world}
                                        onChange={e =>
                                          setSelectedOverrides(prev => ({
                                            ...prev,
                                            [tx.id]: { ...override, world: e.target.value as 'business' | 'personal' },
                                          }))
                                        }
                                        className="px-3 py-2 rounded-lg text-xs text-white bg-slate-950 border border-slate-800"
                                      >
                                        <option value="business">Business</option>
                                        <option value="personal">Personal</option>
                                      </select>
                                      <select
                                        value={override.scope}
                                        onChange={e =>
                                          setSelectedOverrides(prev => ({
                                            ...prev,
                                            [tx.id]: { ...override, scope: e.target.value as 'row' | 'batch' | 'future' },
                                          }))
                                        }
                                        className="px-3 py-2 rounded-lg text-xs text-white bg-slate-950 border border-slate-800"
                                      >
                                        <option value="row">This row only</option>
                                        <option value="batch">Matching pending</option>
                                        <option value="future">Learn rule (future)</option>
                                      </select>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={busyId === tx.id}
                                      onClick={() => void handleConfirm(tx)}
                                      className="px-4 py-2 rounded-lg text-xs font-medium text-white"
                                      style={AXIOM.buttons.action}
                                    >
                                      {busyId === tx.id ? 'Saving…' : 'Apply Decision'}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </GlowContainer>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 2: LIVE LEARNED RULES */}
          {activeTab === 'rules' && (
            <motion.div key="rules" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: '#64748b' }} />
                  <input
                    type="text"
                    placeholder="Search rules by pattern or category..."
                    value={rulesSearch}
                    onChange={e => setRulesSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    style={{ ...AXIOM.inputs, border: AXIOM.inputs.border }}
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowAddRule(v => !v)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2"
                  style={AXIOM.buttons.action}
                >
                  <Plus className="size-4" />
                  Add Rule
                </motion.button>
              </div>

              {showAddRule && (
                <GlowContainer color="cyan">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                    <input
                      type="text"
                      placeholder="Merchant / pattern (e.g. adobe)"
                      value={newRulePattern}
                      onChange={e => setNewRulePattern(e.target.value)}
                      className="px-3 py-2 rounded-lg text-sm text-white bg-slate-950 border border-slate-800"
                    />
                    <select
                      value={newRuleCategoryId}
                      onChange={e => setNewRuleCategoryId(e.target.value)}
                      className="px-3 py-2 rounded-lg text-sm text-white bg-slate-950 border border-slate-800"
                    >
                      <option value="">Select category…</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={newRuleWorld}
                      onChange={e => setNewRuleWorld(e.target.value as 'business' | 'personal')}
                      className="px-3 py-2 rounded-lg text-sm text-white bg-slate-950 border border-slate-800"
                    >
                      <option value="business">Business</option>
                      <option value="personal">Personal</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleAddRule()}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                      style={AXIOM.buttons.success}
                    >
                      Save Rule
                    </button>
                  </div>
                </GlowContainer>
              )}

              <GlowContainer color="purple">
                <SectionTitle icon={GitBranch} title="Classification Rules" subtitle={`${filteredRules.length} organization-isolated versioned rules`} color="#a855f7" />
                {filteredRules.length === 0 ? (
                  <p className="text-sm text-slate-400 py-8 text-center">No classification rules yet. Confirm transactions or add a custom rule above.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          {['Pattern', 'Category', 'Scope', 'Confidence', 'Matches', 'Version', 'Actions'].map(h => (
                            <th key={h} className="text-left py-3 px-3 text-xs font-medium" style={{ color: '#64748b' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRules.map(rule => {
                          const world = rule.scope?.world || rule.prediction?.world || 'business';
                          return (
                            <tr
                              key={rule.id}
                              className="group hover:bg-white/[0.02] transition-colors"
                              style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.05)' }}
                            >
                              <td className="py-3 px-3">
                                <code className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa' }}>
                                  {rule.pattern}
                                </code>
                              </td>
                              <td className="py-3 px-3 text-sm text-white">{categoryMap.get(rule.categoryId) || 'Unmapped'}</td>
                              <td className="py-3 px-3">
                                <span
                                  className="text-xs px-2 py-0.5 rounded-full uppercase"
                                  style={world === 'personal' ? AXIOM.badges.warning : AXIOM.badges.cyan}
                                >
                                  {world}
                                </span>
                              </td>
                              <td className="py-3 px-3 w-32">
                                <ConfidenceBar confidence={rule.confidence} size="sm" />
                              </td>
                              <td className="py-3 px-3 text-sm font-mono text-white">{rule.matchCount || 0}</td>
                              <td className="py-3 px-3 text-xs font-mono text-slate-400">
                                v{rule.version || 1} ({rule.status || 'active'})
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1.5">
                                  {(rule.version || 1) > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRevertRule(rule.id, rule.version || 1)}
                                      className="p-1.5 rounded-lg"
                                      style={{ background: 'rgba(245, 158, 11, 0.15)' }}
                                      title={`Revert to v${(rule.version || 1) - 1}`}
                                    >
                                      <RotateCcw className="size-3.5 text-amber-400" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void handleArchiveRule(rule.id)}
                                    className="p-1.5 rounded-lg"
                                    style={{ background: 'rgba(239, 68, 68, 0.12)' }}
                                    title="Archive rule (preserves evidence)"
                                  >
                                    <X className="size-3.5 text-red-400" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlowContainer>
            </motion.div>
          )}

          {/* TAB 3: LIVE LEARNING INSIGHTS */}
          {activeTab === 'insights' && (
            <motion.div key="insights" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <GlowContainer color="blue">
                  <SectionTitle icon={TrendingUp} title="Live Accuracy Trend" subtitle="Monthly acceptance rate from real Supabase feedback" color="#3b82f6" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={learningTrendData}>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Area type="monotone" dataKey="accuracy" stroke="#3b82f6" fill="#3b82f633" strokeWidth={2} name="Accuracy %" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                <GlowContainer color="amber">
                  <SectionTitle icon={Activity} title="Human Overrides Over Time" subtitle="Real corrections recorded in classification_feedback" color="#f59e0b" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={learningTrendData}>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Area type="monotone" dataKey="manualOverrides" stroke="#f59e0b" fill="#f59e0b33" strokeWidth={2} name="Corrections" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                <GlowContainer color="purple">
                  <SectionTitle icon={BarChart3} title="Category Distribution" subtitle="Real categorized transaction share" color="#a855f7" />
                  <div className="h-64">
                    {categoryDistribution.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-20">No categorized transactions yet.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={categoryDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                            {categoryDistribution.map((entry, idx) => (
                              <Cell key={`cell-${idx}`} fill={entry.color} stroke="transparent" />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={AXIOM.charts.tooltip} formatter={(value: any) => [`${value}%`, 'Share']} />
                          <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </GlowContainer>

                <GlowContainer color="cyan">
                  <SectionTitle icon={Target} title="Confidence Distribution" subtitle="Live confidence histogram across organization transactions" color="#06b6d4" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={confidenceDistribution}>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="range" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '11px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Transactions">
                          {confidenceDistribution.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                <GlowContainer color="blue" className="lg:col-span-2">
                  <SectionTitle icon={Clock} title="Recent Classification Activity" subtitle="Latest live persisted classification events" color="#3b82f6" />
                  {recentActivity.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-8">No classification activity recorded yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {recentActivity.map(activity => (
                        <div
                          key={activity.id}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl"
                          style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(148, 163, 184, 0.08)' }}
                        >
                          <div className="flex-shrink-0">
                            {activity.action === 'User confirmed' ? (
                              <CheckCircle2 className="size-4 text-emerald-400" />
                            ) : activity.action === 'AI classified' ? (
                              <Sparkles className="size-4 text-purple-400" />
                            ) : (
                              <Zap className="size-4 text-blue-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white truncate">{activity.narration}</p>
                            <p className="text-xs" style={{ color: '#64748b' }}>
                              {activity.action} · {activity.category}
                            </p>
                          </div>
                          <span className="text-xs flex-shrink-0" style={{ color: '#64748b' }}>
                            {activity.time}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </GlowContainer>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
