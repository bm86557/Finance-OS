import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import {
  Brain,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sparkles,
  TrendingUp,
  Calendar,
  DollarSign,
  AlertCircle,
  ArrowRight,
  Zap,
  Loader2,
  ShieldAlert,
  RefreshCw,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';

interface SuggestionItem {
  categoryId: string;
  category: string;
  scope: 'business' | 'personal';
  confidence: number;
  reasoning: string;
  source?: string;
  modelUsed?: string;
  proposedNewCategory?: any;
}

interface LowConfidenceTransaction {
  id: string;
  date: string;
  narration: string;
  amount: number;
  currency: string;
  type: 'income' | 'expense';
  currentCategory: string;
  confidence: number;
  inferredWorld: 'business' | 'personal';
  worldReason?: string;
  suggestedDepartmentId?: string;
  riskFlags: string[];
  source: string;
  modelUsed?: string;
  suggestions: SuggestionItem[];
  questions: {
    id: string;
    question: string;
    options: string[];
  }[];
  accountName: string;
}

export function SmartCategorizationPrompts() {
  const svc = useOrgServices();
  const { data: txnResult, refetch: refetchTxns } = useService(
    () => svc.transactions.getAll({ pageSize: 100 }),
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
  const { data: departments = [] } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );
  const { data: statsResult, refetch: refetchStats } = useService(
    () => svc.classification.getStats(),
    [svc.orgId],
    ['transactions', 'classification-rules', 'categories'],
  );

  const [classificationMap, setClassificationMap] = useState<Map<string, any>>(new Map());
  const [isClassifying, setIsClassifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [learningScope, setLearningScope] = useState<'row' | 'batch' | 'future'>('future');
  const [manualCategoryId, setManualCategoryId] = useState('');
  const [manualDepartmentId, setManualDepartmentId] = useState('');

  const uncategorizedRaw = useMemo(() => {
    const raw = txnResult?.items || [];
    return raw.filter(
      t =>
        !['posted', 'reconciled', 'reversed', 'cancelled'].includes(String(t.status || '')) &&
        (!t.categoryId || t.categoryId === 'uncategorized' || t.status === 'pending'),
    );
  }, [txnResult?.items]);

  const lastBatchKeyRef = useRef<string>('');
  const inFlightKeyRef = useRef<string>('');

  const runBatchAI = useCallback(async (force: boolean = false) => {
    if (uncategorizedRaw.length === 0 || !svc.classification?.batchClassify) {
      lastBatchKeyRef.current = '';
      setClassificationMap(new Map());
      return;
    }

    const slice = uncategorizedRaw.slice(0, 30);
    const batchKey = slice.map(t => t.id).join(',');
    if (!force && (batchKey === lastBatchKeyRef.current || batchKey === inFlightKeyRef.current)) {
      return;
    }

    inFlightKeyRef.current = batchKey;
    setIsClassifying(true);
    try {
      const toClassify = slice.map(t => ({
        id: t.id,
        narration: t.narration || t.description || 'Transaction',
        amount: Math.abs(t.amount),
        type: t.type === 'credit' ? ('credit' as const) : ('debit' as const),
        accountId: t.bankAccountId,
      }));

      const res = await svc.classification.batchClassify(toClassify, true, force);
      if (res?.success && res.data) {
        const map = new Map<string, any>();
        slice.forEach((t, idx) => {
          const item = res.data.get(idx);
          if (item) map.set(t.id, item);
        });
        lastBatchKeyRef.current = batchKey;
        setClassificationMap(map);
      }
    } catch (err) {
      console.warn('[SmartCategorization] Batch classify notice:', err);
    } finally {
      if (inFlightKeyRef.current === batchKey) inFlightKeyRef.current = '';
      setIsClassifying(false);
    }
  }, [uncategorizedRaw, svc.classification]);

  useEffect(() => {
    void runBatchAI(false);
  }, [runBatchAI]);

  const bankAccountMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of bankAccounts || []) {
      const name = (acc as any).bankName || (acc as any).accountName || (acc as any).name || 'Bank Account';
      const curr = (acc as any).currency ? ` (${(acc as any).currency})` : '';
      map.set(acc.id, `${name}${curr}`);
    }
    return map;
  }, [bankAccounts]);

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments || []) {
      map.set(d.id, d.name);
    }
    return map;
  }, [departments]);

  const realTransactions: LowConfidenceTransaction[] = useMemo(() => {
    return uncategorizedRaw.map(t => {
      const aiResult = classificationMap.get(t.id);
      const expectedCatType = t.type === 'credit' ? 'income' : 'expense';
      const typedCats = categories.filter(c => c.type === expectedCatType);

      const storedConf =
        t.confidence != null
          ? Math.round(Number(t.confidence) <= 1 && Number(t.confidence) > 0 ? Number(t.confidence) * 100 : Number(t.confidence))
          : 0;
      const aiConf =
        aiResult?.confidence != null
          ? Math.round(Number(aiResult.confidence) <= 1 && Number(aiResult.confidence) > 0 ? Number(aiResult.confidence) * 100 : Number(aiResult.confidence))
          : storedConf;

      const inferredWorld: 'business' | 'personal' =
        aiResult?.world === 'personal' || (t as any).worldScope === 'personal' || t.tags?.includes('personal')
          ? 'personal'
          : 'business';

      const riskFlags: string[] = Array.from(
        new Set([
          ...(Array.isArray((t as any).riskFlags) ? (t as any).riskFlags : []),
          ...(Array.isArray(aiResult?.riskFlags) ? aiResult.riskFlags : []),
        ]),
      );

      const suggestions: SuggestionItem[] = [];

      // 1. Primary suggestion from backend AI / Rules engine (or stored suggestedCategoryId)
      if (aiResult && (aiResult.categoryId || aiResult.categoryName || aiResult.proposedNewCategory?.name)) {
        const primaryCatName =
          aiResult.categoryName ||
          aiResult.proposedNewCategory?.name ||
          categories.find(c => c.id === aiResult.categoryId)?.name ||
          'Uncategorized';
        suggestions.push({
          categoryId: aiResult.categoryId || '',
          category: primaryCatName,
          scope: inferredWorld,
          confidence: aiConf,
          reasoning: aiResult.reasoning || aiResult.explanation || 'Suggested by classification engine',
          source: aiResult.source || 'rules',
          modelUsed: aiResult.modelUsed,
          proposedNewCategory: aiResult.proposedNewCategory || null,
        });
      } else if (t.suggestedCategoryId) {
        const suggestedCat = categories.find(c => c.id === t.suggestedCategoryId);
        if (suggestedCat) {
          suggestions.push({
            categoryId: suggestedCat.id,
            category: suggestedCat.name,
            scope: inferredWorld,
            confidence: storedConf,
            reasoning: (t as any).aiReasoning || 'Previously suggested during statement ingestion',
            source: 'saved',
          });
        }
      }

      // 2. Real alternative suggestions returned by backend AI / rules engine
      const alts = Array.isArray(aiResult?.alternativeSuggestions) ? aiResult.alternativeSuggestions : [];
      for (const alt of alts) {
        const altName = alt.categoryName || alt.category || '';
        if (!altName || suggestions.some(s => s.category.toLowerCase() === altName.toLowerCase())) continue;
        const matchedCat = categories.find(
          c => (alt.categoryId && c.id === alt.categoryId) || c.name.toLowerCase() === altName.toLowerCase(),
        );
        const altConf =
          alt.confidence != null
            ? Math.round(Number(alt.confidence) <= 1 && Number(alt.confidence) > 0 ? Number(alt.confidence) * 100 : Number(alt.confidence))
            : 0;
        suggestions.push({
          categoryId: matchedCat?.id || alt.categoryId || '',
          category: matchedCat?.name || altName,
          scope: inferredWorld,
          confidence: altConf,
          reasoning: alt.reasoning || `Alternative match (${altConf}% confidence)`,
          source: aiResult?.source || 'rules',
          modelUsed: aiResult?.modelUsed,
        });
      }

      // 3. If no backend suggestions available yet, offer top real org categories of matching type
      if (suggestions.length === 0 && typedCats.length > 0) {
        typedCats.slice(0, 2).forEach(cat => {
          suggestions.push({
            categoryId: cat.id,
            category: cat.name,
            scope: inferredWorld,
            confidence: 0,
            reasoning: 'Select from your organization chart of accounts',
            source: 'manual',
          });
        });
      }

      const accountLabel =
        (t.bankAccountId && bankAccountMap.get(t.bankAccountId)) ||
        (t as any).accountName ||
        'Unassigned Account';

      return {
        id: t.id,
        date: t.date,
        narration: t.narration || t.description || 'Transaction',
        amount: Math.abs(t.amount),
        currency: t.currency || 'USD',
        type: t.type === 'credit' ? ('income' as const) : ('expense' as const),
        currentCategory: t.categoryId ? categories.find(c => c.id === t.categoryId)?.name || 'Uncategorized' : 'Uncategorized',
        confidence: aiConf,
        inferredWorld,
        worldReason: aiResult?.worldReason,
        suggestedDepartmentId: aiResult?.suggestedDepartmentId || t.departmentId || undefined,
        riskFlags,
        source: aiResult?.source || 'pending',
        modelUsed: aiResult?.modelUsed,
        suggestions,
        questions: [
          {
            id: 'q1',
            question: 'Is this an operational business transaction for this organization?',
            options: ['Yes, business operational cost', 'No, personal expense', 'Client project reimbursable'],
          },
        ],
        accountName: accountLabel,
      };
    });
  }, [uncategorizedRaw, categories, classificationMap, bankAccountMap]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sessionLearnedCount, setSessionLearnedCount] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const activeTransactions = realTransactions.filter(t => !dismissedIds.has(t.id));
  const safeIndex = activeTransactions.length > 0 ? Math.min(currentIndex, activeTransactions.length - 1) : 0;
  const currentTransaction = activeTransactions[safeIndex];
  const progress =
    activeTransactions.length > 0
      ? Math.round((sessionLearnedCount / Math.max(1, sessionLearnedCount + activeTransactions.length)) * 100)
      : 100;
  const remaining = activeTransactions.length;

  // Reset manual pickers whenever moving to a different transaction
  useEffect(() => {
    setManualCategoryId('');
    setManualDepartmentId(currentTransaction?.suggestedDepartmentId || '');
  }, [currentTransaction?.id, currentTransaction?.suggestedDepartmentId]);

  // Resolve effective world scope from user's explicit question answer (or engine inference if unanswered)
  const selectedQuestionAnswer = currentTransaction ? answers[`${currentTransaction.id}_q1`] : undefined;
  const resolvedWorld: 'business' | 'personal' =
    selectedQuestionAnswer === 'No, personal expense'
      ? 'personal'
      : selectedQuestionAnswer
        ? 'business'
        : currentTransaction?.inferredWorld || 'business';

  const handleAnswer = (questionId: string, answer: string) => {
    if (!currentTransaction) return;
    setAnswers(prev => ({ ...prev, [`${currentTransaction.id}_${questionId}`]: answer }));
  };

  const handleConfirm = async (suggestion: SuggestionItem) => {
    if (!currentTransaction || submitting) return;
    setSubmitting(true);
    try {
      const targetCat =
        (suggestion.categoryId && categories.find(c => c.id === suggestion.categoryId)) ||
        categories.find(c => c.name.toLowerCase() === suggestion.category.toLowerCase());

      if (!targetCat && !suggestion.proposedNewCategory) {
        toast.error(`Category "${suggestion.category}" was not found in your Chart of Accounts.`);
        return;
      }

      const rationaleParts: string[] = [];
      if (selectedQuestionAnswer) rationaleParts.push(`Reviewer scope: ${selectedQuestionAnswer}`);
      if (suggestion.reasoning) rationaleParts.push(suggestion.reasoning);
      const rationale = rationaleParts.join(' | ');
      const chosenDeptId = manualDepartmentId || currentTransaction.suggestedDepartmentId || undefined;

      const res = await svc.classification.recordHumanOverride({
        transactionId: currentTransaction.id,
        correctCategoryId: targetCat?.id || '',
        departmentId: chosenDeptId,
        proposedNewCategory: !targetCat ? suggestion.proposedNewCategory : undefined,
        world: resolvedWorld,
        scope: learningScope,
        rationale,
      });

      if (!res.success) {
        toast.error(res.error || 'Failed to save categorization');
        return;
      }

      const scopeLabel =
        learningScope === 'row'
          ? 'this transaction only'
          : learningScope === 'batch'
            ? `batch (+${res.data?.batchUpdatedCount ?? 0} matching)`
            : 'rule learned for future';

      toast.success(
        `Saved: "${currentTransaction.narration.slice(0, 48)}" → ${suggestion.category} [${resolvedWorld}] (${scopeLabel})`,
      );
      if (res.data?.collisionWarning) {
        toast.warning(res.data.collisionWarning);
      }

      setSessionLearnedCount(prev => prev + 1);
      setDismissedIds(prev => new Set(prev).add(currentTransaction.id));
      await Promise.all([refetchTxns(), refetchStats(), refetchCategories()]);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update category');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualAssign = async () => {
    if (!currentTransaction || !manualCategoryId) {
      toast.error('Choose a category from the list first.');
      return;
    }
    const cat = categories.find(c => c.id === manualCategoryId);
    if (!cat) return;
    await handleConfirm({
      categoryId: cat.id,
      category: cat.name,
      scope: resolvedWorld,
      confidence: 100,
      reasoning: 'Manually selected by reviewer',
      source: 'user',
    });
  };

  const handleSkip = () => {
    if (!currentTransaction) return;
    toast.info('Transaction skipped for this session');
    setDismissedIds(prev => new Set(prev).add(currentTransaction.id));
  };

  const handleReject = async () => {
    if (!currentTransaction || submitting) return;
    setSubmitting(true);
    try {
      const topSuggestion = currentTransaction.suggestions[0];
      const res = await svc.classification.rejectSuggestion(currentTransaction.id, {
        suggestedCategoryId: topSuggestion?.categoryId || undefined,
        suggestedConfidence: topSuggestion?.confidence ?? currentTransaction.confidence,
        reason: selectedQuestionAnswer
          ? `Rejected all suggestions (scope note: ${selectedQuestionAnswer})`
          : 'Rejected all suggestions in Smart Categorization',
      });
      if (!res.success) {
        toast.error(res.error || 'Could not record rejection');
        return;
      }
      toast.info('Suggestion rejected and logged — transaction stays pending for manual review');
      setDismissedIds(prev => new Set(prev).add(currentTransaction.id));
      await refetchStats();
    } catch {
      toast.error('Failed to record rejection');
    } finally {
      setSubmitting(false);
    }
  };

  const totalLearnedRules = statsResult?.rulesCount ?? sessionLearnedCount;
  const realAccuracyRate = statsResult?.accuracyRate ?? 0;

  if (!currentTransaction || activeTransactions.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"
            style={{
              boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.6)',
            }}
          >
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Smart Categorization</h2>
            <p className="text-slate-400 text-sm">Help the system learn from your transactions</p>
          </div>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-16 text-center">
            <div className="inline-flex items-center justify-center size-16 bg-green-500/20 rounded-full mb-4">
              <CheckCircle2 className="size-8 text-green-400" />
            </div>
            <h3 className="text-xl font-medium text-white mb-2">All Caught Up!</h3>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              No pending transactions need your attention right now. All active transactions are categorized.
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <Brain className="size-4 text-blue-400" />
              <span className="text-sm text-blue-400">
                {totalLearnedRules} active rules • {realAccuracyRate}% live accuracy
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const matchingTypeCategories = categories.filter(
    c => c.type === (currentTransaction.type === 'income' ? 'income' : 'expense'),
  );
  const selectableCategories = matchingTypeCategories.length > 0 ? matchingTypeCategories : categories;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"
            style={{
              boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.6)',
            }}
          >
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Smart Categorization</h2>
            <p className="text-slate-400 text-sm">Help improve categorization accuracy</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isClassifying && (
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
              <Loader2 className="size-3 mr-1 animate-spin" />
              AI Analyzing…
            </Badge>
          )}
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Brain className="size-3 mr-1" />
            {totalLearnedRules} rules
          </Badge>
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
            {remaining} remaining
          </Badge>
        </div>
      </div>

      {/* Progress */}
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Overall Progress</span>
            <span className="text-sm text-white font-medium">
              {safeIndex + 1} of {activeTransactions.length}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </CardContent>
      </Card>

      {/* Current Transaction */}
      <Card className="bg-gradient-to-br from-blue-950/20 to-purple-950/20 border-blue-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500/20 rounded-lg">
                <HelpCircle className="size-6 text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-white">Review Transaction</CardTitle>
                <CardDescription className="text-slate-400">
                  {currentTransaction.confidence > 0
                    ? `Engine confidence: ${currentTransaction.confidence}% (${currentTransaction.source}${currentTransaction.modelUsed ? ` · ${currentTransaction.modelUsed}` : ''})`
                    : 'Unclassified — awaiting review'}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className={
                  resolvedWorld === 'personal'
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30 uppercase'
                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 uppercase'
                }
              >
                {resolvedWorld}
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                Needs Attention
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Transaction Details */}
          <div className="p-4 bg-slate-950 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                  <Calendar className="size-3" />
                  Date
                </div>
                <p className="text-white font-medium">{formatDate(currentTransaction.date)}</p>
              </div>
              <div className="col-span-2">
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                  <Sparkles className="size-3" />
                  Description
                </div>
                <p className="text-white font-medium">{currentTransaction.narration}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                  <DollarSign className="size-3" />
                  Amount
                </div>
                <p className={`font-bold ${currentTransaction.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                  {currentTransaction.type === 'income' ? '+' : '-'}
                  {formatCurrency(currentTransaction.amount, currentTransaction.currency)}
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>Account: {currentTransaction.accountName}</span>
                {currentTransaction.suggestedDepartmentId && departmentMap.get(currentTransaction.suggestedDepartmentId) && (
                  <span className="inline-flex items-center gap-1 text-cyan-400">
                    <Building2 className="size-3" />
                    Suggested Dept: {departmentMap.get(currentTransaction.suggestedDepartmentId)}
                  </span>
                )}
              </div>
              {currentTransaction.worldReason && (
                <p className="text-xs text-slate-400">Scope signal: {currentTransaction.worldReason}</p>
              )}
            </div>
            {currentTransaction.riskFlags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {currentTransaction.riskFlags.map(flag => (
                  <Badge key={flag} className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px] font-mono">
                    <ShieldAlert className="size-3 mr-1" />
                    {flag.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Questions */}
          {currentTransaction.questions.map(question => (
            <div key={question.id} className="space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="size-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <h4 className="text-white font-medium">{question.question}</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {question.options.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleAnswer(question.id, option)}
                    className={`p-3 rounded-lg border transition-all text-left ${
                      answers[`${currentTransaction.id}_${question.id}`] === option
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-sm">{option}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* AI Suggestions */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Brain className="size-5 text-purple-400" />
                <h4 className="text-white font-medium">AI &amp; Rule Suggestions</h4>
                <button
                  type="button"
                  disabled={isClassifying}
                  onClick={() => void runBatchAI(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-900 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-50"
                  title="Re-run AI analysis"
                >
                  <RefreshCw className={`size-3 ${isClassifying ? 'animate-spin' : ''}`} />
                  Re-analyze
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 mr-1">Apply to:</span>
                {(
                  [
                    { id: 'row', label: 'This row only' },
                    { id: 'batch', label: 'Matching pending' },
                    { id: 'future', label: 'Learn rule (future)' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLearningScope(opt.id)}
                    className={`px-2.5 py-1 rounded-md border transition-colors ${
                      learningScope === opt.id
                        ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {currentTransaction.suggestions.map((suggestion, idx) => (
                <div
                  key={`${suggestion.categoryId || suggestion.category}-${idx}`}
                  className="p-4 bg-slate-950 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2 gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h5 className="text-white font-medium">{suggestion.category}</h5>
                        <Badge
                          className={
                            resolvedWorld === 'business'
                              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                              : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                          }
                        >
                          {resolvedWorld}
                        </Badge>
                        {suggestion.source && (
                          <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px] font-mono">
                            {suggestion.source === 'ai' && suggestion.modelUsed
                              ? `ai · ${suggestion.modelUsed}`
                              : suggestion.source}
                          </Badge>
                        )}
                        {suggestion.proposedNewCategory?.name && !suggestion.categoryId && (
                          <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">
                            + Create New Category
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{suggestion.reasoning}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="size-3 text-green-400" />
                        <span className="text-xs text-green-400 font-medium">
                          {suggestion.confidence}% confident
                        </span>
                      </div>
                      <Button
                        size="sm"
                        disabled={submitting}
                        onClick={() => handleConfirm(suggestion)}
                        className="bg-gradient-to-r from-green-600 to-emerald-600 h-8"
                      >
                        <CheckCircle2 className="size-3 mr-1" />
                        Use This
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Manual Override Picker (Any Category + Department) */}
            <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800/80 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">Or assign manually:</span>
              <select
                value={manualCategoryId}
                onChange={e => setManualCategoryId(e.target.value)}
                className="flex-1 min-w-[160px] rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-cyan-500/50 focus:outline-none"
              >
                <option value="">Choose category…</option>
                {selectableCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {departments.length > 0 && (
                <select
                  value={manualDepartmentId}
                  onChange={e => setManualDepartmentId(e.target.value)}
                  className="min-w-[150px] rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-cyan-500/50 focus:outline-none"
                >
                  <option value="">Department (Auto)</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || !manualCategoryId}
                onClick={() => void handleManualAssign()}
                className="h-8 text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
              >
                Assign &amp; Learn
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t border-slate-800">
            <Button
              variant="outline"
              disabled={submitting}
              onClick={handleReject}
              className="flex-1 border-red-900/50 text-red-400 hover:bg-red-950/20"
            >
              <XCircle className="size-4 mr-2" />
              Reject All
            </Button>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={handleSkip}
              className="flex-1 border-slate-700 hover:bg-slate-800"
            >
              Skip for Now
            </Button>
            <Button
              onClick={() => currentTransaction.suggestions[0] && handleConfirm(currentTransaction.suggestions[0])}
              className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600"
              disabled={
                submitting ||
                !currentTransaction.suggestions[0] ||
                !answers[`${currentTransaction.id}_${currentTransaction.questions[0].id}`]
              }
            >
              {submitting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <>
                  Confirm &amp; Learn
                  <ArrowRight className="size-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Learning Stats (Real Supabase Metrics — §11) */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <CheckCircle2 className="size-5 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{totalLearnedRules}</div>
                <div className="text-xs text-slate-400">Active Rules Learned</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Brain className="size-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{realAccuracyRate}%</div>
                <div className="text-xs text-slate-400">Live Feedback Accuracy</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Zap className="size-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{remaining}</div>
                <div className="text-xs text-slate-400">To Review</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tips */}
      <Card className="bg-blue-950/20 border-blue-900/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Sparkles className="size-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-200 mb-1">Learning Tip</h4>
              <p className="text-xs text-blue-300/80">
                Choose &ldquo;This row only&rdquo; for one-off expenses, or &ldquo;Learn rule (future)&rdquo; to create a
                versioned, organization-isolated rule that classifies similar narrations automatically on future imports.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
