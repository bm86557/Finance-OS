import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import type { Category, Transaction } from '@/services/types';
import { useNotifications } from '@/contexts/NotificationContext';
import { matrixToQuickAddRows, parseSpreadsheetToMatrix } from '@/lib/quickAddBulkImport';
import { convertCurrency, getEstimatedFxRate } from '@/lib/currencyUtils';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import {
  Plus,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Zap,
  FileSpreadsheet,
  ListPlus,
  ArrowLeftRight,
  ArrowRight,
  ArrowDown,
  AlertCircle,
  CheckCircle,
  Building2,
  FolderKanban,
  Check,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';

export interface QuickAddBulkRowItem {
  id: string;
  type: 'income' | 'expense';
  amount: string;
  narration: string;
  categoryId?: string;
  departmentId?: string;
  projectId?: string;
  aiSuggestedCategoryName?: string;
  aiConfidence?: number;
  isAiClassified?: boolean;
}

function newBulkRowId(): string {
  return `qar-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveCategoryIdFromSuggestion(
  suggested: string | null,
  incomeOrExpense: 'income' | 'expense',
  categories: Category[],
): string | undefined {
  if (!suggested?.trim()) return undefined;
  const pool = categories.filter((c) => c.type === incomeOrExpense);
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(suggested);
  const exact = pool.find((c) => norm(c.name) === target);
  if (exact) return exact.id;
  const partial = pool.find(
    (c) => norm(c.name).includes(target) || target.includes(norm(c.name)),
  );
  return partial?.id;
}

function buildQuickAddMetaTags(params: {
  txnType: 'income' | 'expense';
  counterparty: string;
  currency: string;
  fxRateToPkr: string;
  amount: number;
}): string[] {
  const { txnType, counterparty, currency, fxRateToPkr, amount } = params;
  const out: string[] = [];
  const cp = counterparty.trim().replace(/\|/g, ' ').slice(0, 120);
  if (cp) {
    out.push(txnType === 'income' ? `client:${cp}` : `payee:${cp}`);
  }
  const rate = Number.parseFloat(fxRateToPkr.replace(/,/g, ''));
  if (currency !== 'PKR' && Number.isFinite(rate) && rate > 0) {
    out.push(`fx-to-pkr:${rate}`);
    out.push(`pkr-approx:${Math.round(amount * rate)}`);
  }
  return out;
}

function buildFullNarration(
  narr: string,
  txnType: 'income' | 'expense',
  counterparty: string,
  settlementNotes: string,
  currency: string,
  fxRateToPkr: string,
  amount: number,
): string {
  let text = narr.trim();
  const cp = counterparty.trim();
  if (cp) {
    text += `\n\n${txnType === 'income' ? 'Client or payer' : 'Payee'}: ${cp}`;
  }
  const rate = Number.parseFloat(fxRateToPkr.replace(/,/g, ''));
  if (
    currency !== 'PKR' &&
    Number.isFinite(rate) &&
    rate > 0 &&
    Number.isFinite(amount) &&
    amount > 0
  ) {
    text += `\n\nFX (for your records): 1 ${currency} ≈ ${rate} PKR → about PKR ${Math.round(amount * rate).toLocaleString()} on this amount`;
  }
  const sn = settlementNotes.trim();
  if (sn) {
    text += `\n\nSettlement / routing:\n${sn}`;
  }
  return text.slice(0, 4000);
}

function buildShortDescription(
  narr: string,
  txnType: 'income' | 'expense',
  counterparty: string,
): string {
  const cp = counterparty.trim();
  const head = txnType === 'income' ? 'Income' : 'Expense';
  const base = narr.trim().slice(0, 120);
  if (!cp) return `${head} · ${base}`.slice(0, 200);
  return `${head} · ${cp.slice(0, 40)}${cp.length > 40 ? '…' : ''} · ${base}`.slice(0, 200);
}

export function QuickAdd({
  embedded = false,
  onClose,
}: {
  /** Compact layout for dashboard modal */
  embedded?: boolean;
  /** Called after a successful add (e.g. close modal) */
  onClose?: () => void;
} = {}) {
  const { addNotification } = useNotifications();
  const { accessRole, currentOrganization } = useAuth();
  const { getSelectableCurrencyCodes, featureFlags: globalFeatureFlags } = usePlatformSettings();
  const selectableCurrencies = getSelectableCurrencyCodes(currentOrganization?.currency || 'USD');
  const isPersonalFinanceEnabled = currentOrganization?.settings?.features?.personal_finance ?? true;
  const isAutoCategorizationEnabled =
    (currentOrganization?.settings?.features?.auto_categorization ?? true) &&
    globalFeatureFlags.ai_category_suggestions;
  const isViewer = accessRole === 'viewer';
  const [entryMode, setEntryMode] = useState<'single' | 'bulk' | 'transfer'>('single');

  // Transfer Mode State (§1, §8, §23 F-01)
  const [transferFromAccount, setTransferFromAccount] = useState<string>('');
  const [transferToAccount, setTransferToAccount] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [transferCurrency, setTransferCurrency] = useState<string>('USD');
  const [transferDate, setTransferDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [transferDescription, setTransferDescription] = useState<string>('Internal transfer between accounts');
  const [transferType, setTransferType] = useState<'bank_to_bank' | 'atm_withdrawal' | 'cash_deposit' | 'wallet_transfer'>('bank_to_bank');
  const [transferScope, setTransferScope] = useState<'business' | 'personal'>('business');
  const [transferSubmitting, setTransferSubmitting] = useState<boolean>(false);
  const [bulkRows, setBulkRows] = useState<QuickAddBulkRowItem[]>(() => [
    { id: newBulkRowId(), type: 'expense', amount: '', narration: '' },
    { id: newBulkRowId(), type: 'expense', amount: '', narration: '' },
  ]);
  const sheetInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [scope, setScope] = useState<'business' | 'personal'>('business');
  const [method, setMethod] = useState<'cash' | 'bank' | 'card'>('bank');
  const [currency, setCurrency] = useState('USD');
  const [account, setAccount] = useState('');
  const [suggestedCategory, setSuggestedCategory] = useState<string | null>(null);
  const [suggestedCategoryId, setSuggestedCategoryId] = useState<string | null>(null);
  const [suggestionConfidence, setSuggestionConfidence] = useState<number | null>(null);
  const [suggestionReasoning, setSuggestionReasoning] = useState<string | null>(null);
  const [alternativeSuggestions, setAlternativeSuggestions] = useState<
    Array<{ categoryId: string; categoryName: string; confidence: number }>
  >([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [isClassifying, setIsClassifying] = useState(false);
  const [isBulkClassifying, setIsBulkClassifying] = useState(false);
  const classificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [txnDate, setTxnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lastSavedLine, setLastSavedLine] = useState<string | null>(null);
  const [counterparty, setCounterparty] = useState('');
  const [fxRateToPkr, setFxRateToPkr] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [selectedBulkDepartmentId, setSelectedBulkDepartmentId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedBulkProjectId, setSelectedBulkProjectId] = useState<string>('');
  const embeddedCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Success/failure modal state
  const [resultModal, setResultModal] = useState<{
    open: boolean;
    success: boolean;
    title: string;
    message: string;
    details?: string;
  }>({ open: false, success: true, title: '', message: '' });
  const resultModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const svc = useOrgServices();
  const {
    data: bankAccounts,
    loading: accountsLoading,
    error: accountsError,
  } = useServiceArray(() => svc.accounts.getBankAccounts(), [svc.orgId], ['bankAccounts']);

  const { data: categories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );

  const { data: departments } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );

  const { data: projects } = useServiceArray(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects'],
  );

  const { data: recentPage, loading: recentLoading, refetch: refetchRecent } = useService(
    () => svc.transactions.getAll({ pageSize: 5, sortBy: 'date', sortOrder: 'desc' }),
    [svc.orgId],
    ['transactions'],
  );
  const recentTransactions = recentPage?.items ?? [];

  const estimatedPkr = useMemo(() => {
    if (currency === 'PKR') return null;
    const amt = Number.parseFloat(amount.replace(/,/g, ''));
    const rate = Number.parseFloat(fxRateToPkr.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
    return Math.round(amt * rate);
  }, [amount, currency, fxRateToPkr]);

  const selectableAccounts = useMemo(() => {
    if (!bankAccounts.length) return [];
    const byMethod = bankAccounts.filter((acc) => {
      if (method === 'card') return acc.accountType === 'credit_card';
      if (method === 'cash') {
        return acc.accountType === 'cash' || acc.accountType === 'checking' || acc.accountType === 'savings';
      }
      return (
        acc.accountType === 'checking' ||
        acc.accountType === 'savings' ||
        acc.accountType === 'line_of_credit' ||
        acc.accountType === 'online_wallet'
      );
    });
    return byMethod.length > 0 ? byMethod : bankAccounts;
  }, [bankAccounts, method]);

  // Detect selected bank account and compute FX conversion when currencies differ
  const selectedBankAccount = useMemo(
    () => selectableAccounts.find((a) => a.id === account) ?? null,
    [selectableAccounts, account],
  );

  const bankAccountCurrency = selectedBankAccount?.currency || 'USD';

  const fxConversion = useMemo(() => {
    const amt = Number.parseFloat(amount.replace?.(/,/g, '') ?? amount);
    if (!Number.isFinite(amt) || amt <= 0) return null;
    if (!bankAccountCurrency || currency === bankAccountCurrency) return null;
    const converted = convertCurrency(amt, currency, bankAccountCurrency);
    const rate = getEstimatedFxRate(currency, bankAccountCurrency);
    return { converted, rate, bankCurrency: bankAccountCurrency };
  }, [amount, currency, bankAccountCurrency]);

  useEffect(() => {
    if (!selectableAccounts.length) {
      setAccount('');
      return;
    }
    setAccount((prev) => {
      const newAccId = prev && selectableAccounts.some((a) => a.id === prev) ? prev : selectableAccounts[0].id;
      // Auto-set currency to the selected bank account's currency
      const newAcc = selectableAccounts.find((a) => a.id === newAccId);
      if (newAcc?.currency) {
        setCurrency(newAcc.currency);
      }
      return newAccId;
    });
  }, [selectableAccounts]);

  // Auto-initialize source and destination transfer accounts
  useEffect(() => {
    if (bankAccounts && bankAccounts.length > 0) {
      if (!transferFromAccount) {
        setTransferFromAccount(bankAccounts[0].id);
        if (bankAccounts[0].currency) {
          setTransferCurrency(bankAccounts[0].currency);
        }
      }
      if (!transferToAccount) {
        const diffAcc = bankAccounts.find((a) => a.id !== (transferFromAccount || bankAccounts[0].id));
        setTransferToAccount(diffAcc ? diffAcc.id : (bankAccounts[1]?.id ?? ''));
      }
    }
  }, [bankAccounts, transferFromAccount, transferToAccount]);

  const transferSourceAccount = useMemo(
    () => bankAccounts.find((a) => a.id === transferFromAccount) ?? null,
    [bankAccounts, transferFromAccount],
  );

  const transferDestAccount = useMemo(
    () => bankAccounts.find((a) => a.id === transferToAccount) ?? null,
    [bankAccounts, transferToAccount],
  );

  const transferFromCurrency = transferCurrency || transferSourceAccount?.currency || 'USD';
  const transferToCurrency = transferDestAccount?.currency || transferFromCurrency;

  const transferFxConversion = useMemo(() => {
    const amt = Number.parseFloat(transferAmount.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) return null;
    if (!transferFromCurrency || !transferToCurrency || transferFromCurrency === transferToCurrency) return null;
    const converted = convertCurrency(amt, transferFromCurrency, transferToCurrency);
    const rate = getEstimatedFxRate(transferFromCurrency, transferToCurrency);
    return {
      converted,
      rate,
      fromCurrency: transferFromCurrency,
      toCurrency: transferToCurrency,
    };
  }, [transferAmount, transferFromCurrency, transferToCurrency]);

  const handleSelectTransferType = (tType: 'bank_to_bank' | 'atm_withdrawal' | 'cash_deposit' | 'wallet_transfer') => {
    setTransferType(tType);
    if (tType === 'atm_withdrawal') {
      setTransferDescription('ATM Cash Withdrawal');
      const bankAcc = bankAccounts.find((a) => a.accountType === 'checking' || a.accountType === 'savings');
      const cashAcc = bankAccounts.find((a) => a.accountType === 'cash');
      if (bankAcc) {
        setTransferFromAccount(bankAcc.id);
        if (bankAcc.currency) setTransferCurrency(bankAcc.currency);
      }
      if (cashAcc) setTransferToAccount(cashAcc.id);
    } else if (tType === 'cash_deposit') {
      setTransferDescription('Cash Deposit to Bank Account');
      const cashAcc = bankAccounts.find((a) => a.accountType === 'cash');
      const bankAcc = bankAccounts.find((a) => a.accountType === 'checking' || a.accountType === 'savings');
      if (cashAcc) {
        setTransferFromAccount(cashAcc.id);
        if (cashAcc.currency) setTransferCurrency(cashAcc.currency);
      }
      if (bankAcc) setTransferToAccount(bankAcc.id);
    } else if (tType === 'wallet_transfer') {
      setTransferDescription('Online Wallet Transfer');
    } else {
      setTransferDescription('Internal transfer between accounts');
    }
  };

  useEffect(() => {
    return () => {
      if (embeddedCloseTimerRef.current) {
        clearTimeout(embeddedCloseTimerRef.current);
        embeddedCloseTimerRef.current = null;
      }
      if (classificationTimerRef.current) {
        clearTimeout(classificationTimerRef.current);
        classificationTimerRef.current = null;
      }
    };
  }, []);

  const triggerClassification = (narrText: string, amtText: string, currentType: 'income' | 'expense') => {
    if (classificationTimerRef.current) {
      clearTimeout(classificationTimerRef.current);
      classificationTimerRef.current = null;
    }

    if (!isAutoCategorizationEnabled) {
      setSuggestedCategory(null);
      setSuggestedCategoryId(null);
      setSuggestionConfidence(null);
      setSuggestionReasoning(null);
      setAlternativeSuggestions([]);
      setIsClassifying(false);
      return;
    }

    const trimmed = narrText.trim();
    if (!trimmed) {
      setSuggestedCategory(null);
      setSuggestedCategoryId(null);
      setSuggestionConfidence(null);
      setSuggestionReasoning(null);
      setAlternativeSuggestions([]);
      setIsClassifying(false);
      return;
    }

    setIsClassifying(true);
    classificationTimerRef.current = setTimeout(async () => {
      try {
        const amt = Number.parseFloat(amtText.replace(/,/g, '')) || 0;
        const res = await Promise.race([
          svc.classification.classify(
            trimmed,
            amt,
            currentType === 'income' ? 'credit' : 'debit',
          ),
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
        ]);
        if (res.success && res.data) {
          setSuggestedCategory(res.data.categoryName);
          setSuggestedCategoryId(res.data.categoryId);
          setSuggestionConfidence(res.data.confidence);
          setSuggestionReasoning(res.data.reasoning);
          setAlternativeSuggestions(res.data.alternativeSuggestions ?? []);
        } else {
          setSuggestedCategory(null);
          setSuggestedCategoryId(null);
          setSuggestionConfidence(null);
          setSuggestionReasoning(null);
          setAlternativeSuggestions([]);
        }
      } catch {
        // Fallback: rule-based local classification if API timed out or errored
        const localMatched = resolveCategoryIdFromSuggestion(trimmed, currentType, categories);
        if (localMatched) {
          const matchedCat = categories.find(c => c.id === localMatched);
          setSuggestedCategory(matchedCat?.name || null);
          setSuggestedCategoryId(localMatched);
          setSuggestionConfidence(75);
          setSuggestionReasoning('Keyword pattern match');
        } else {
          setSuggestedCategory(null);
          setSuggestedCategoryId(null);
          setSuggestionConfidence(null);
          setSuggestionReasoning(null);
          setAlternativeSuggestions([]);
        }
      } finally {
        setIsClassifying(false);
      }
    }, 250);
  };

  const handleNarrationChange = (value: string) => {
    setLastSavedLine(null);
    setNarration(value);
    triggerClassification(value, amount, type);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (txnTypeOverride?: 'income' | 'expense') => {
    if (submitting) return;
    if (isViewer) {
      toast.error('Viewer role has read-only access. You cannot create transactions.');
      return;
    }
    const txnType = txnTypeOverride ?? type;
    const narr = narration.trim();
    if (!narr) {
      toast.error('Add a short description for this transaction.');
      return;
    }

    const amt = Number.parseFloat(amount.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount greater than zero.');
      return;
    }

    if (!account) {
      toast.error('Choose an account. Add a bank account under Accounts if this list is empty.');
      return;
    }

    setSubmitting(true);
    try {
      let finalCategoryId = selectedCategoryId || suggestedCategoryId || resolveCategoryIdFromSuggestion(
        suggestedCategory,
        txnType,
        categories,
      );

      // If user typed and immediately saved without waiting for debounce, classify on the fly
      if (!finalCategoryId) {
        try {
          const classRes = await svc.classification.classify(
            narr,
            amt,
            txnType === 'income' ? 'credit' : 'debit'
          );
          if (classRes.success && classRes.data?.categoryId) {
            finalCategoryId = classRes.data.categoryId;
          }
        } catch (e) {
          console.warn('[QuickAdd] On-the-fly classification failed:', e);
        }
      }

      const isClassified = Boolean(finalCategoryId);
      const idempotencyKey = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const fullNarration = buildFullNarration(
        narr,
        txnType,
        counterparty,
        settlementNotes,
        currency,
        fxRateToPkr,
        amt,
      );
      const metaTags = buildQuickAddMetaTags({
        txnType,
        counterparty,
        currency,
        fxRateToPkr,
        amount: amt,
      });

      const rateVal = Number.parseFloat(fxRateToPkr.replace(/,/g, ''));
      const hasFxToPkr = currency !== 'PKR' && Number.isFinite(rateVal) && rateVal > 0;

      // Determine the bank account's currency and convert if necessary
      const selBankAcc = selectableAccounts.find((a) => a.id === account);
      const targetCurrency = selBankAcc?.currency || currency;
      const needsConversion = currency !== targetCurrency;
      const convertedAmt = needsConversion
        ? convertCurrency(amt, currency, targetCurrency)
        : amt;
      const fxRate = needsConversion ? getEstimatedFxRate(currency, targetCurrency) : 1;

      const targetDate = txnDate?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(txnDate.trim())
        ? txnDate.trim()
        : new Date().toISOString().slice(0, 10);

      const res = await svc.transactions.create({
        bankAccountId: account,
        date: targetDate,
        valueDate: targetDate,
        source: 'quick_add',
        originalNarration: fullNarration,
        normalizedNarration: buildShortDescription(narr, txnType, counterparty),
        description: buildShortDescription(narr, txnType, counterparty),
        narration: fullNarration,
        // Store the converted amount in bank account's currency
        amount: convertedAmt,
        currency: targetCurrency,
        type: txnType === 'income' ? 'credit' : 'debit',
        status: isClassified ? 'classified' : 'pending',
        worldScope: (scope === 'business' ? 'business' : 'personal') as 'business' | 'personal',
        ...(counterparty.trim() ? { counterpartyName: counterparty.trim() } : {}),
        tags: [
          scope === 'business' ? 'business' : 'personal',
          'quick-add',
          ...metaTags,
        ],
        attachments: [],
        ...(finalCategoryId ? {
          categoryId: finalCategoryId,
          classifiedAt: new Date().toISOString(),
          // If user manually selected, mark as 'user'; if AI suggested and user accepted, mark as 'auto'
          classifiedBy: selectedCategoryId ? 'user' : (suggestedCategoryId ? 'auto' : 'user'),
          confidence: suggestionConfidence ?? (selectedCategoryId ? 100 : 80),
          // Store AI suggestion for review/learning
          suggestedCategoryId: suggestedCategoryId || undefined,
          suggestedConfidence: suggestionConfidence || undefined,
          aiReasoning: suggestionReasoning || undefined,
        } : {}),
        ...((selectedDepartmentId || (selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.departmentId : undefined)) ? {
          departmentId: selectedDepartmentId || projects.find(p => p.id === selectedProjectId)?.departmentId,
        } : {}),
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        // Always record original amount/currency when conversion happened
        ...(needsConversion ? {
          originalAmount: amt,
          originalCurrency: currency,
          fxRateToBase: fxRate,
          baseCurrency: targetCurrency,
        } : hasFxToPkr ? {
          originalAmount: amt,
          originalCurrency: currency,
          fxRateToBase: rateVal,
          baseCurrency: 'PKR',
        } : {}),
      }, { idempotencyKey });

      if (!res.success) {
        setResultModal({
          open: true,
          success: false,
          title: 'Transaction Failed',
          message: res.error || 'Could not save the transaction. Check database permissions.',
          details: `${currency} ${amt.toLocaleString()} — ${narr}`,
        });
        toast.error('Transaction Failed to Save', {
          description: res.error || 'Could not save the transaction to Supabase. Check database permissions.',
          duration: 6000,
        });
        return;
      }

      // Show success modal
      setResultModal({
        open: true,
        success: true,
        title: `${txnType === 'income' ? 'Income' : 'Expense'} Added Successfully!`,
        message: `${currency} ${amt.toLocaleString()} — ${narr}`,
        details: finalCategoryId ? 'Categorized & posted to ledger' : 'Marked pending for review',
      });
      // Auto-close modal after 4 seconds
      if (resultModalTimerRef.current) clearTimeout(resultModalTimerRef.current);
      resultModalTimerRef.current = setTimeout(() => {
        setResultModal(prev => ({ ...prev, open: false }));
        resultModalTimerRef.current = null;
      }, 4000);

      toast.success(`${txnType === 'income' ? 'Income' : 'Expense'} saved`, {
        description: `${currency} ${amt.toLocaleString()} — ${narr}${!finalCategoryId ? ' · marked pending for review' : ''}`,
      });

      void refetchRecent();
      addNotification({
        title: txnType === 'income' ? 'Income recorded' : 'Expense recorded',
        message: `${currency} ${amt.toLocaleString()} — ${narr.slice(0, 140)}${narr.length > 140 ? '…' : ''}`,
        type: 'success',
        category: 'system',
      });

      const summary = `${currency} ${amt.toLocaleString()} — ${narr.length > 80 ? `${narr.slice(0, 80)}…` : narr}`;
      setAmount('');
      setNarration('');
      setSuggestedCategory(null);
      setSuggestedCategoryId(null);
      setSuggestionConfidence(null);
      setSuggestionReasoning(null);
      setAlternativeSuggestions([]);
      setSelectedCategoryId('');
      setCounterparty('');
      setFxRateToPkr('');
      setSettlementNotes('');
      setSelectedDepartmentId('');
      setSelectedProjectId('');

      if (embedded) {
        setLastSavedLine(`Last saved · ${txnType === 'income' ? 'Income' : 'Expense'} · ${summary}`);
        if (embeddedCloseTimerRef.current) clearTimeout(embeddedCloseTimerRef.current);
        embeddedCloseTimerRef.current = setTimeout(() => {
          embeddedCloseTimerRef.current = null;
          onClose?.();
        }, 2500);
      } else {
        setLastSavedLine(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransferSubmit = async () => {
    if (isViewer) {
      toast.error('Viewers have read-only access.');
      return;
    }
    const amt = Number.parseFloat(transferAmount.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid transfer amount greater than zero.');
      return;
    }
    if (!transferFromAccount || !transferToAccount) {
      toast.error('Select both source and destination accounts.');
      return;
    }
    if (transferFromAccount === transferToAccount) {
      toast.error('Source and Destination accounts must be different.');
      return;
    }

    setTransferSubmitting(true);
    try {
      const fromCurr = transferFromCurrency;
      const toCurr = transferToCurrency;
      const needsConversion = fromCurr !== toCurr;
      const rate = needsConversion ? getEstimatedFxRate(fromCurr, toCurr) : 1.0;
      const converted = needsConversion ? convertCurrency(amt, fromCurr, toCurr) : amt;

      const res = await svc.transactions.createTransfer({
        fromBankAccountId: transferFromAccount,
        toBankAccountId: transferToAccount,
        amount: amt,
        currency: fromCurr,
        toCurrency: toCurr,
        fxRate: rate,
        convertedAmount: converted,
        date: transferDate?.trim() || new Date().toISOString().slice(0, 10),
        description: transferDescription.trim() || 'Internal Account Transfer',
        transferType,
        ...(transferScope ? { worldScope: transferScope } : {}) as any,
      });

      if (res.success && res.data) {
        const fromName = transferSourceAccount?.bankName ?? 'Source Account';
        const toName = transferDestAccount?.bankName ?? 'Destination Account';
        toast.success('Two-legged transfer completed successfully', {
          description: `Transferred ${fromCurr} ${amt.toLocaleString()} from ${fromName} to ${toName} (Zero net P&L impact).`,
        });

        setResultModal({
          open: true,
          success: true,
          title: 'Transfer Completed',
          message: 'Two-legged transfer posted successfully with balanced double-entry accounting (F-01 Transfer Neutrality enforced).',
          details: `${fromCurr} ${amt.toLocaleString()} (${fromName}) → ${toCurr} ${converted.toLocaleString()} (${toName})`,
        });

        setTransferAmount('');
        void refetchRecent();
        if (embedded) {
          setLastSavedLine(`Last saved · Transfer · ${fromCurr} ${amt.toLocaleString()} → ${toCurr} ${converted.toLocaleString()}`);
          if (embeddedCloseTimerRef.current) clearTimeout(embeddedCloseTimerRef.current);
          embeddedCloseTimerRef.current = setTimeout(() => {
            embeddedCloseTimerRef.current = null;
            onClose?.();
          }, 2000);
        }
      } else {
        toast.error('Transfer failed', {
          description: res.error || 'Could not complete the transfer on the backend.',
        });
        setResultModal({
          open: true,
          success: false,
          title: 'Transfer Failed',
          message: res.error || 'Could not complete the transfer.',
          details: `${fromCurr} ${amt.toLocaleString()} from ${transferFromAccount} to ${transferToAccount}`,
        });
      }
    } catch (err: any) {
      toast.error('Transfer failed', { description: err?.message || 'Error executing transfer.' });
    } finally {
      setTransferSubmitting(false);
    }
  };

  const runAiClassificationOnRows = async (rows: QuickAddBulkRowItem[]): Promise<QuickAddBulkRowItem[]> => {
    const validIndices: number[] = [];
    const classifyInputs = rows.map((r, i) => {
      if (r.narration.trim()) validIndices.push(i);
      return {
        narration: r.narration.trim() || 'Expense',
        amount: Number.parseFloat(r.amount.replace(/,/g, '')) || 0,
        type: (r.type === 'income' ? 'credit' : 'debit') as 'credit' | 'debit',
      };
    });

    if (validIndices.length === 0) {
      toast.info('Enter a description for rows before auto-classifying.');
      return rows;
    }

    setIsBulkClassifying(true);
    try {
      const batchRes = await svc.classification.batchClassify(classifyInputs, true);
      const resultMap = batchRes.success && batchRes.data ? batchRes.data : new Map();

      const updated = rows.map((row, idx) => {
        if (!row.narration.trim()) return row;
        const suggestion = resultMap.get(idx);
        if (!suggestion) return row;

        const resolvedCatId = suggestion.categoryId || resolveCategoryIdFromSuggestion(
          suggestion.categoryName,
          row.type,
          categories,
        );

        return {
          ...row,
          categoryId: resolvedCatId || row.categoryId,
          aiSuggestedCategoryName: suggestion.categoryName,
          aiConfidence: suggestion.confidence,
          isAiClassified: Boolean(resolvedCatId),
        };
      });

      const classifiedCount = updated.filter((r) => r.isAiClassified).length;
      toast.success(`✨ AI Auto-Classified ${classifiedCount} of ${validIndices.length} lines!`, {
        description: 'Categories, confidence scores, and rule matchings assigned.',
      });
      return updated;
    } catch (err: any) {
      toast.error('AI Auto-Classification error: ' + (err.message || 'Failed'));
      return rows;
    } finally {
      setIsBulkClassifying(false);
    }
  };

  const handleAutoClassifyAllBulk = async () => {
    const updated = await runAiClassificationOnRows(bulkRows);
    setBulkRows(updated);
  };

  const handleBulkSave = async () => {
    if (submitting) return;
    if (isViewer) {
      toast.error('Viewer role has read-only access. You cannot create transactions.');
      return;
    }
    if (!account) {
      toast.error('Choose an account.');
      return;
    }
    const lines = bulkRows.filter((r) => {
      const amt = Number.parseFloat(r.amount.replace(/,/g, ''));
      return r.narration.trim() && Number.isFinite(amt) && amt > 0;
    });
    if (!lines.length) {
      toast.error('Add at least one line with amount and description.');
      return;
    }
    if (lines.length > 100) {
      toast.error('Save up to 100 lines at a time.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Auto-classify any rows that still haven't been categorized
      let activeRows = [...bulkRows];
      const hasUncategorized = activeRows.some((r) => r.narration.trim() && !r.categoryId);
      if (hasUncategorized) {
        activeRows = await runAiClassificationOnRows(activeRows);
        setBulkRows(activeRows);
      }

      // 2. Prepare transaction payloads
      const selBankAcc = selectableAccounts.find((a) => a.id === account);
      const targetCurrency = selBankAcc?.currency || currency;
      const bulkNeedsConversion = currency !== targetCurrency;
      const targetDate = txnDate?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(txnDate.trim())
        ? txnDate.trim()
        : new Date().toISOString().slice(0, 10);

      const payloadRows = lines.map((row) => {
        const amt = Number.parseFloat(row.amount.replace(/,/g, ''));
        const narr = row.narration.trim();
        const txnType = row.type;
        const resolvedCatId = row.categoryId || resolveCategoryIdFromSuggestion(
          row.aiSuggestedCategoryName || null,
          txnType,
          categories,
        );

        const isClassified = Boolean(resolvedCatId);
        const convertedAmt = bulkNeedsConversion
          ? convertCurrency(amt, currency, targetCurrency)
          : amt;
        const fxRate = bulkNeedsConversion ? getEstimatedFxRate(currency, targetCurrency) : 1;

        return {
          bankAccountId: account,
          date: targetDate,
          valueDate: targetDate,
          source: 'quick_add' as const,
          originalNarration: narr,
          normalizedNarration: narr.slice(0, 200),
          description: narr.slice(0, 200),
          narration: narr,
          amount: convertedAmt,
          currency: targetCurrency,
          type: (txnType === 'income' ? 'credit' : 'debit') as 'credit' | 'debit',
          status: (isClassified ? 'classified' : 'pending') as Transaction['status'],
          worldScope: (scope === 'business' ? 'business' : 'personal') as 'business' | 'personal',
          tags: [scope === 'business' ? 'business' : 'personal', 'quick-add', 'bulk'],
          attachments: [],
          ...(resolvedCatId ? {
            categoryId: resolvedCatId,
            classifiedAt: new Date().toISOString(),
            classifiedBy: row.isAiClassified ? 'auto' : 'user',
            confidence: row.aiConfidence ?? 85,
            suggestedCategoryId: resolvedCatId,
            suggestedConfidence: row.aiConfidence,
          } : {}),
          ...((row.departmentId || selectedBulkDepartmentId || ((row.projectId || selectedBulkProjectId) ? projects.find(p => p.id === (row.projectId || selectedBulkProjectId))?.departmentId : undefined)) ? {
            departmentId: row.departmentId || selectedBulkDepartmentId || projects.find(p => p.id === (row.projectId || selectedBulkProjectId))?.departmentId,
          } : {}),
          ...(row.projectId || selectedBulkProjectId ? {
            projectId: row.projectId || selectedBulkProjectId,
          } : {}),
          ...(bulkNeedsConversion ? {
            originalAmount: amt,
            originalCurrency: currency,
            fxRateToBase: fxRate,
            baseCurrency: targetCurrency,
          } : {}),
        };
      });

      // 3. Batch API creation
      const res = await svc.transactions.bulkCreate(payloadRows);

      if (!res.success || !res.data || res.data.inserted === 0) {
        setResultModal({
          open: true,
          success: false,
          title: 'Bulk Save Failed',
          message: res.error || (res.data?.errors?.[0]?.error) || 'Could not save bulk transactions.',
          details: `${lines.length} transactions attempted`,
        });
        toast.error('Bulk Save Failed', {
          description: res.error || (res.data?.errors?.[0]?.error) || 'Could not save bulk transactions to Supabase.',
          duration: 6000,
        });
        return;
      }

      const { inserted, failed, errors } = res.data;
      if (failed > 0) {
        setResultModal({
          open: true,
          success: true,
          title: `${inserted} Transaction${inserted === 1 ? '' : 's'} Saved`,
          message: `${failed} transaction${failed === 1 ? '' : 's'} failed to save.`,
          details: errors?.[0]?.error || 'Check transaction inputs.',
        });
        toast.warning(`Saved ${inserted} transactions with ${failed} failure(s).`, {
          description: errors?.[0]?.error || 'Check transaction inputs.',
        });
      } else {
        setResultModal({
          open: true,
          success: true,
          title: `🎉 ${inserted} Transaction${inserted === 1 ? '' : 's'} Added Successfully!`,
          message: 'All transactions posted to ledger & balances recalculated.',
        });
        toast.success(`🎉 ${inserted} transaction${inserted === 1 ? '' : 's'} saved and calculated!`);
      }
      // Auto-close modal after 4 seconds
      if (resultModalTimerRef.current) clearTimeout(resultModalTimerRef.current);
      resultModalTimerRef.current = setTimeout(() => {
        setResultModal(prev => ({ ...prev, open: false }));
        resultModalTimerRef.current = null;
      }, 4000);

      void refetchRecent();
      addNotification({
        title: `${inserted} transaction${inserted === 1 ? '' : 's'} recorded`,
        message: `Quick Add bulk · batch posted to ledger & recalculated in Supabase`,
        type: 'success',
        category: 'system',
      });

      setBulkRows([
        { id: newBulkRowId(), type: 'expense', amount: '', narration: '' },
        { id: newBulkRowId(), type: 'expense', amount: '', narration: '' },
      ]);
      setSelectedBulkProjectId('');
      setSelectedBulkDepartmentId('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSpreadsheetFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const matrix = await parseSpreadsheetToMatrix(file);
      const parsed = matrixToQuickAddRows(matrix);
      if (!parsed.length) {
        toast.error('No valid rows. Use a header row: Type, Amount, Narration (or three columns without a header).');
        return;
      }
      setEntryMode('bulk');
      const loadedRows: QuickAddBulkRowItem[] = parsed.map((r) => ({
        id: newBulkRowId(),
        type: r.type,
        amount: String(r.amount),
        narration: r.narration,
      }));
      if (parsed[0].currency) setCurrency(parsed[0].currency);
      toast.info(`Loaded ${parsed.length} rows from ${file.name}. Running AI auto-classification...`);
      const classified = await runAiClassificationOnRows(loadedRows);
      setBulkRows(classified);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read file');
    }
  };

  return (
    <div
      className={
        embedded
          ? 'min-w-0 space-y-3 sm:space-y-4'
          : 'min-h-screen min-w-0 space-y-4 p-4 sm:p-6 md:p-8 sm:space-y-6'
      }
      style={embedded ? undefined : { background: AXIOM.backgrounds.main }}
    >
      {/* Header with AXIOM Gradient */}
      {!embedded && (
        <motion.div {...AXIOM.animations.fadeInTop}>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Zap className="size-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl md:text-4xl" style={AXIOM.text.titleStyle}>
              Quick Add
            </h1>
          </div>
          <p className="text-slate-400 text-xs">Fast entry for income and expenses</p>
        </motion.div>
      )}

      <div
        className={
          embedded
            ? 'grid min-w-0 grid-cols-1 gap-3 sm:gap-4'
            : 'grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6'
        }
      >
        {/* Main Form - AXIOM Style */}
        <motion.div
          className={embedded ? '' : 'lg:col-span-2'}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div
            className="min-w-0 rounded-2xl p-4 sm:rounded-3xl sm:p-6 md:p-8"
            style={AXIOM.containers.list}
          >
            <div className="mb-5 flex min-w-0 flex-col gap-4 sm:mb-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-2 sm:gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12"
                  style={{
                    background: AXIOM.iconBoxes.purple,
                    boxShadow: AXIOM.shadows.iconPurple,
                  }}
                >
                  <DollarSign className="size-5 text-white sm:size-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-white sm:text-xl md:text-2xl">
                    {entryMode === 'transfer' ? 'Two-Legged Transfer' : 'Transaction Details'}
                  </h2>
                  <p className="text-slate-400 text-xs sm:text-sm">
                    {entryMode === 'transfer'
                      ? 'Two-legged account transfer (zero P&L impact)'
                      : entryMode === 'bulk'
                        ? 'Bulk matrix spreadsheet entry'
                        : `Enter ${type}`}
                  </p>
                </div>
              </div>
              <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:max-w-[min(100%,32rem)]">
                <div
                  className="flex w-full shrink-0 rounded-lg gap-0.5 p-0.5 sm:w-auto"
                  style={{ background: 'rgba(0,0,0,0.25)', border: AXIOM.inputs.border }}
                  role="group"
                  aria-label="Entry mode"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setEntryMode('single');
                      setType('expense');
                    }}
                    className="min-h-10 flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:px-3 flex items-center justify-center gap-1.5"
                    style={
                      entryMode === 'single' && type === 'expense'
                        ? AXIOM.buttons.danger
                        : { color: 'rgba(148, 163, 184, 0.85)' }
                    }
                  >
                    <TrendingDown className="size-3.5" />
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEntryMode('single');
                      setType('income');
                    }}
                    className="min-h-10 flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:px-3 flex items-center justify-center gap-1.5"
                    style={
                      entryMode === 'single' && type === 'income'
                        ? AXIOM.buttons.success
                        : { color: 'rgba(148, 163, 184, 0.85)' }
                    }
                  >
                    <TrendingUp className="size-3.5" />
                    Income
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode('transfer')}
                    className="min-h-10 flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:px-3 flex items-center justify-center gap-1.5"
                    style={
                      entryMode === 'transfer'
                        ? {
                            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                            border: '1px solid rgba(6, 182, 212, 0.6)',
                            color: '#ffffff',
                            boxShadow: '0 0 12px rgba(6, 182, 212, 0.35)',
                          }
                        : { color: 'rgba(148, 163, 184, 0.85)' }
                    }
                  >
                    <ArrowLeftRight className="size-3.5 text-cyan-400" />
                    Transfer
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode('bulk')}
                    className="min-h-10 flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:px-3 flex items-center justify-center gap-1.5"
                    style={
                      entryMode === 'bulk'
                        ? { background: 'rgba(168, 85, 247, 0.35)', border: '1px solid rgba(168, 85, 247, 0.5)', color: '#fff' }
                        : { color: 'rgba(148, 163, 184, 0.85)' }
                    }
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Matrix
                  </button>
                </div>
                {entryMode === 'bulk' && (
                  <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                    <motion.button
                      {...AXIOM.animations.hoverScale}
                      type="button"
                      disabled={submitting}
                      aria-label="Set all lines to Expense"
                      title="Set all bulk lines to Expense"
                      onClick={() => {
                        setBulkRows((prev) => prev.map((r) => ({ ...r, type: 'expense' })));
                        toast.info('All lines set to Expense');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                      style={
                        bulkRows.every((r) => r.type === 'expense')
                          ? AXIOM.buttons.danger
                          : AXIOM.buttons.outline
                      }
                    >
                      <TrendingDown className="size-3.5" />
                      All Expense
                    </motion.button>
                    <motion.button
                      {...AXIOM.animations.hoverScale}
                      type="button"
                      disabled={submitting}
                      aria-label="Set all lines to Income"
                      title="Set all bulk lines to Income"
                      onClick={() => {
                        setBulkRows((prev) => prev.map((r) => ({ ...r, type: 'income' })));
                        toast.info('All lines set to Income');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                      style={
                        bulkRows.every((r) => r.type === 'income')
                          ? AXIOM.buttons.success
                          : AXIOM.buttons.outline
                      }
                    >
                      <TrendingUp className="size-3.5" />
                      All Income
                    </motion.button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-5">
              {accountsError && (
                <p className="text-sm text-amber-200/90 font-mono border border-amber-500/30 rounded-xl px-3 py-2" role="alert">
                  {accountsError}
                </p>
              )}
              {accountsLoading && bankAccounts.length === 0 && (
                <p className="text-xs text-slate-500 font-mono" aria-live="polite">
                  Loading accounts…
                </p>
              )}
              {!accountsLoading && bankAccounts.length === 0 && (
                <p className="text-sm text-slate-400 border border-dashed border-slate-600 rounded-xl px-3 py-2">
                  No bank accounts yet. Add one under Accounts so Quick Add can post to a wallet.
                </p>
              )}

              {/* Transfer Mode Form (R3, §1, §8, §23 F-01) */}
              {entryMode === 'transfer' && (
                <div className="space-y-5">
                  {/* F-01 Neutrality Banner */}
                  <div
                    className="rounded-xl p-4 flex items-start gap-3"
                    style={{
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                    }}
                  >
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                      <Sparkles className="size-4 text-amber-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                        Transfer Neutrality Invariant (F-01)
                      </p>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        Internal account transfers are balance sheet movements between accounts. Transfers have <strong className="text-white font-semibold">zero net impact</strong> on Revenue, Expenses, or Operating Profit figures.
                      </p>
                    </div>
                  </div>

                  {/* Transfer Type Selector */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                      Transfer Type
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { id: 'bank_to_bank' as const, label: 'Bank to Bank', desc: 'Operating accounts' },
                        { id: 'atm_withdrawal' as const, label: 'ATM Withdrawal', desc: 'Bank → Cash on Hand' },
                        { id: 'cash_deposit' as const, label: 'Cash Deposit', desc: 'Cash → Bank account' },
                        { id: 'wallet_transfer' as const, label: 'Wallet Transfer', desc: 'Online / e-wallet' },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectTransferType(t.id)}
                          className="rounded-xl p-2.5 text-left transition-all"
                          style={
                            transferType === t.id
                              ? {
                                  background: 'rgba(6, 182, 212, 0.15)',
                                  border: '1px solid rgba(6, 182, 212, 0.4)',
                                  boxShadow: '0 0 12px rgba(6, 182, 212, 0.2)',
                                }
                              : {
                                  background: 'rgba(0, 0, 0, 0.2)',
                                  border: AXIOM.inputs.border,
                                }
                          }
                        >
                          <p
                            className="text-xs font-semibold"
                            style={{ color: transferType === t.id ? '#22d3ee' : '#cbd5e1' }}
                          >
                            {t.label}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{t.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Source & Destination Account Pickers */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Source Account (From) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                          Source Account (Outflow)
                        </label>
                        {transferSourceAccount && (
                          <span className="text-xs font-mono text-cyan-400">
                            Bal: {transferSourceAccount.currency} {Number(transferSourceAccount.balance ?? 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <select
                        value={transferFromAccount}
                        onChange={(e) => {
                          const newId = e.target.value;
                          setTransferFromAccount(newId);
                          const acc = bankAccounts.find((a) => a.id === newId);
                          if (acc?.currency) {
                            setTransferCurrency(acc.currency);
                          }
                        }}
                        className="w-full h-12 px-4 rounded-xl text-sm"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        <option value="">Select source account…</option>
                        {bankAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.bankName} · {acc.accountNumber?.slice(-4) ?? '----'} ({acc.currency}) [{acc.accountType}]
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500">Account from which funds will be debited.</p>
                    </div>

                    {/* Destination Account (To) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                          Destination Account (Inflow)
                        </label>
                        {transferDestAccount && (
                          <span className="text-xs font-mono text-emerald-400">
                            Bal: {transferDestAccount.currency} {Number(transferDestAccount.balance ?? 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <select
                        value={transferToAccount}
                        onChange={(e) => setTransferToAccount(e.target.value)}
                        className="w-full h-12 px-4 rounded-xl text-sm"
                        style={{
                          background: AXIOM.inputs.background,
                          border:
                            transferFromAccount && transferToAccount && transferFromAccount === transferToAccount
                              ? '1px solid rgba(239, 68, 68, 0.6)'
                              : AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        <option value="">Select destination account…</option>
                        {bankAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.bankName} · {acc.accountNumber?.slice(-4) ?? '----'} ({acc.currency}) [{acc.accountType}]
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500">Account to which funds will be credited.</p>
                    </div>
                  </div>

                  {/* Validation Error if Source == Destination */}
                  {transferFromAccount && transferToAccount && transferFromAccount === transferToAccount && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl px-4 py-2.5 flex items-center gap-2 border border-red-500/30 bg-red-500/10 text-red-300 text-xs"
                    >
                      <AlertCircle className="size-4 text-red-400 shrink-0" />
                      <span>Source and destination accounts must be different. Select two distinct accounts.</span>
                    </motion.div>
                  )}

                  {/* Amount & Currency */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                      Transfer Amount
                    </label>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch">
                      <select
                        value={transferFromCurrency}
                        onChange={(e) => setTransferCurrency(e.target.value)}
                        className="h-12 w-full shrink-0 rounded-xl px-4 font-medium sm:w-auto sm:min-w-[5.75rem]"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        {selectableCurrencies.map((code) => (
                          <option key={code} value={code}>{code}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        placeholder="0.00"
                        min="0.01"
                        step="any"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        className="h-12 min-w-0 flex-1 rounded-xl px-3 text-xl font-bold sm:px-4 sm:text-2xl"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      />
                    </div>
                  </div>

                  {/* Live FX Conversion Preview if Currencies Differ */}
                  {transferFxConversion && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                      style={{
                        background: 'rgba(6, 182, 212, 0.08)',
                        border: '1px solid rgba(6, 182, 212, 0.3)',
                      }}
                    >
                      <ArrowLeftRight className="size-4 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold text-cyan-300">
                          Destination Credit: {transferFxConversion.toCurrency} {transferFxConversion.converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-slate-400 mt-0.5">
                          Exchange rate: 1 {transferFxConversion.fromCurrency} ≈ {transferFxConversion.rate.toFixed(4)} {transferFxConversion.toCurrency}. Funds will be credited in destination account currency.
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {/* Date & Value Date */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                        Transfer Date / Value Date
                      </label>
                      <button
                        type="button"
                        onClick={() => setTransferDate(new Date().toISOString().slice(0, 10))}
                        className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        Today
                      </button>
                    </div>
                    <input
                      type="date"
                      value={transferDate}
                      onChange={(e) => setTransferDate(e.target.value)}
                      className="w-full h-12 px-4 rounded-xl font-medium"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />
                  </div>

                  {/* Description / Reference */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                        Description / Reference
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {[
                          'Transfer between accounts',
                          'ATM Cash Withdrawal',
                          'Cash Deposit to Bank Account',
                          'Payroll funding',
                          'Tax reserve',
                        ].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setTransferDescription(preset)}
                            className="px-2 py-0.5 rounded text-[10px] text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-colors"
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g., Transfer to local operations account"
                      value={transferDescription}
                      onChange={(e) => setTransferDescription(e.target.value)}
                      className="w-full h-12 px-4 rounded-xl text-sm"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />
                  </div>

                  {/* World Scope (Business vs Personal) */}
                  {isPersonalFinanceEnabled && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                        World Scope
                      </label>
                      <div className="flex min-w-0 gap-2">
                        <button
                          type="button"
                          onClick={() => setTransferScope('business')}
                          className="touch-manipulation flex-1 rounded-xl px-3 py-2.5 text-sm font-medium"
                          style={
                            transferScope === 'business'
                              ? {
                                  background: 'rgba(168, 85, 247, 0.3)',
                                  border: '1px solid rgba(168, 85, 247, 0.5)',
                                  color: '#ffffff',
                                }
                              : {
                                  background: 'rgba(0, 0, 0, 0.2)',
                                  border: 'none',
                                  color: 'rgba(148, 163, 184, 0.7)',
                                }
                          }
                        >
                          Business
                        </button>
                        <button
                          type="button"
                          onClick={() => setTransferScope('personal')}
                          className="touch-manipulation flex-1 rounded-xl px-3 py-2.5 text-sm font-medium"
                          style={
                            transferScope === 'personal'
                              ? {
                                  background: 'rgba(168, 85, 247, 0.3)',
                                  border: '1px solid rgba(168, 85, 247, 0.5)',
                                  color: '#ffffff',
                                }
                              : {
                                  background: 'rgba(0, 0, 0, 0.2)',
                                  border: 'none',
                                  color: 'rgba(148, 163, 184, 0.7)',
                                }
                          }
                        >
                          Personal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Amount + narration — single */}
              {entryMode === 'single' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                      {type === 'income' ? 'Client or payer' : 'Payee (vendor or person)'}
                    </label>
                    <input
                      type="text"
                      placeholder={type === 'income' ? 'e.g. Acme Studio' : 'e.g. contractor name'}
                      value={counterparty}
                      onChange={(e) => {
                        setLastSavedLine(null);
                        setCounterparty(e.target.value);
                      }}
                      className="w-full h-12 px-4 rounded-xl"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />
                    <p className="text-xs text-slate-500">
                      {type === 'income'
                        ? 'Which client or company this payment is from.'
                        : 'Who receives this payment (matches USD expert payouts, tools, etc.).'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>Amount</label>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch">
                      <select
                        value={currency}
                        onChange={(e) => {
                          setCurrency(e.target.value);
                        }}
                        className="h-12 w-full shrink-0 rounded-xl px-4 font-medium sm:w-auto sm:min-w-[5.75rem]"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        {selectableCurrencies.map((code) => (
                          <option key={code} value={code}>{code}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => {
                          setLastSavedLine(null);
                          setAmount(e.target.value);
                        }}
                        className="h-12 min-w-0 flex-1 rounded-xl px-3 text-xl font-bold sm:px-4 sm:text-2xl"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                        Date
                      </label>
                      <button
                        type="button"
                        onClick={() => setTxnDate(new Date().toISOString().slice(0, 10))}
                        className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        Today
                      </button>
                    </div>
                    <input
                      type="date"
                      value={txnDate}
                      onChange={(e) => {
                        setLastSavedLine(null);
                        setTxnDate(e.target.value);
                      }}
                      className="w-full h-12 px-4 rounded-xl font-medium"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>Narration / Description</label>
                      <div className="flex items-center gap-2">
                        {isClassifying && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Sparkles className="size-3 text-cyan-400 animate-spin" />
                            <span>Classifying…</span>
                          </div>
                        )}
                        {!isClassifying && suggestedCategory && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-1"
                          >
                            <Sparkles className="size-3 text-cyan-400" />
                            <span className="text-xs text-cyan-400 font-medium">
                              AI Suggestion {suggestionConfidence != null ? `(${suggestionConfidence}%)` : ''}
                            </span>
                          </motion.div>
                        )}
                        {!isClassifying && !suggestedCategory && narration.trim().length > 0 && (
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => triggerClassification(narration, amount, type)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                            style={{
                              background: 'rgba(6, 182, 212, 0.15)',
                              border: '1px solid rgba(6, 182, 212, 0.35)',
                              color: '#22d3ee',
                            }}
                          >
                            <Sparkles className="size-3" />
                            AI Classify
                          </motion.button>
                        )}
                      </div>
                    </div>
                    <textarea
                      placeholder="e.g., AWS hosting services, Client payment for website, Team lunch..."
                      value={narration}
                      onChange={(e) => handleNarrationChange(e.target.value)}
                      className="w-full min-h-24 px-4 py-3 rounded-xl"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />

                    {/* AI Suggestion + Alternatives Rail */}
                    {suggestedCategory && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-2 pt-1"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold"
                            style={AXIOM.badges.cyan}
                          >
                            <Sparkles className="size-3" />
                            Suggested: {suggestedCategory} {suggestionConfidence ? `· ${suggestionConfidence}%` : ''}
                          </span>

                          {suggestionReasoning && (
                            <span className="text-xs text-slate-400 italic">
                              ({suggestionReasoning})
                            </span>
                          )}
                        </div>

                        {alternativeSuggestions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-xs text-slate-500">Or choose alternative:</span>
                            {alternativeSuggestions.slice(0, 3).map((alt) => (
                              <button
                                key={alt.categoryId}
                                type="button"
                                onClick={() => {
                                  setSelectedCategoryId(alt.categoryId);
                                  setSuggestedCategory(alt.categoryName);
                                  setSuggestedCategoryId(alt.categoryId);
                                  setSuggestionConfidence(alt.confidence);
                                }}
                                className="px-2 py-0.5 rounded-md text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-colors"
                              >
                                {alt.categoryName} ({alt.confidence}%)
                              </button>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* Category Selection Override */}
                    <div className="pt-2">
                      <label className="text-xs text-slate-400 block mb-1">
                        Category {selectedCategoryId ? '(Manually specified)' : suggestedCategory ? '(AI Suggestion active)' : '(Optional — unassigned goes to review queue)'}
                      </label>
                      <select
                        value={selectedCategoryId || suggestedCategoryId || ''}
                        onChange={(e) => {
                          setSelectedCategoryId(e.target.value);
                          if (e.target.value) {
                            const match = categories.find((c) => c.id === e.target.value);
                            if (match) setSuggestedCategory(match.name);
                          }
                        }}
                        className="w-full h-11 px-3 rounded-xl text-sm"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        <option value="">
                          {suggestedCategory ? `[AI Recommended] ${suggestedCategory}` : 'No Category · Send to Pending Review'}
                        </option>
                        {categories
                          .filter((c) => c.type === type)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Live FX conversion hint when transaction currency differs from bank account currency */}
                  {fxConversion && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2 rounded-xl px-4 py-3"
                      style={{
                        background: 'rgba(6, 182, 212, 0.08)',
                        border: '1px solid rgba(6, 182, 212, 0.25)',
                      }}
                    >
                      <ArrowLeftRight className="size-4 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-cyan-300">
                          Will be saved as {fxConversion.bankCurrency} {fxConversion.converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {currency} {Number.parseFloat(amount || '0').toLocaleString()} converted at est. rate 1 {currency} = {fxConversion.rate.toFixed(6)} {fxConversion.bankCurrency}. Original amount recorded separately.
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {currency !== 'PKR' && !fxConversion && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                        PKR rate (optional)
                      </label>
                      <p className="text-xs text-slate-500">
                        How many PKR for 1 {currency}, for reporting when the bank converts later.
                      </p>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 278.5"
                        value={fxRateToPkr}
                        onChange={(e) => {
                          setLastSavedLine(null);
                          setFxRateToPkr(e.target.value);
                        }}
                        className="w-full max-w-xs h-12 px-4 rounded-xl"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      />
                      {estimatedPkr != null && (
                        <p className="text-sm text-slate-300" aria-live="polite">
                          About PKR {estimatedPkr.toLocaleString()} at this rate
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                      Settlement / routing (optional)
                    </label>
                    <p className="text-xs text-slate-500">
                      Use this when money lands in one place first and moves later—for example Pioneer first, then your local bank days after—or paying experts in USD from Pioneer.
                    </p>
                    <textarea
                      placeholder="e.g. USD received in Pioneer on Mar 1; transfer to HBL when rate improves."
                      value={settlementNotes}
                      onChange={(e) => {
                        setLastSavedLine(null);
                        setSettlementNotes(e.target.value);
                      }}
                      className="w-full min-h-[4.5rem] px-4 py-3 rounded-xl text-sm"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />
                  </div>
                </>
              )}

              {/* Bulk lines + spreadsheet */}
              {entryMode === 'bulk' && (
                <div className="space-y-3">
                  <input
                    ref={sheetInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => void handleSpreadsheetFile(e)}
                  />
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                        Lines
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                        Import CSV or Excel with columns: Type, Amount, Narration (optional: Currency). Or add rows below.
                      </p>
                    </div>
                    <div className="flex min-w-0 w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => sheetInputRef.current?.click()}
                        disabled={submitting}
                        className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 sm:w-auto"
                        style={AXIOM.buttons.outline}
                      >
                        <FileSpreadsheet className="size-3.5 shrink-0" />
                        Import sheet
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => void handleAutoClassifyAllBulk()}
                        disabled={submitting || isBulkClassifying || bulkRows.every((r) => !r.narration.trim())}
                        className="flex w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 sm:w-auto"
                        style={{
                          background: 'rgba(6, 182, 212, 0.15)',
                          border: '1px solid rgba(6, 182, 212, 0.4)',
                          color: '#22d3ee',
                        }}
                      >
                        <Sparkles className={`size-3.5 shrink-0 ${isBulkClassifying ? 'animate-spin' : ''}`} />
                        {isBulkClassifying ? 'Classifying…' : '✨ AI Auto-Classify'}
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          if (bulkRows.length >= 50) {
                            toast.error('Maximum 50 lines per batch.');
                            return;
                          }
                          setBulkRows((prev) => [
                            ...prev,
                            { id: newBulkRowId(), type: 'expense', amount: '', narration: '' },
                          ]);
                        }}
                        disabled={submitting || bulkRows.length >= 50}
                        className="flex w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 sm:w-auto"
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#f87171',
                        }}
                      >
                        <TrendingDown className="size-3.5 shrink-0" />
                        + Expense line
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          if (bulkRows.length >= 50) {
                            toast.error('Maximum 50 lines per batch.');
                            return;
                          }
                          setBulkRows((prev) => [
                            ...prev,
                            { id: newBulkRowId(), type: 'income', amount: '', narration: '' },
                          ]);
                        }}
                        disabled={submitting || bulkRows.length >= 50}
                        className="flex w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 sm:w-auto"
                        style={{
                          background: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          color: '#34d399',
                        }}
                      >
                        <TrendingUp className="size-3.5 shrink-0" />
                        + Income line
                      </motion.button>
                    </div>
                  </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {bulkRows.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-col gap-1.5 rounded-xl p-2.5 transition-all"
                          style={{ background: 'rgba(0,0,0,0.25)', border: AXIOM.inputs.border }}
                        >
                          {/* Row Inputs Line */}
                          <div className="flex items-center gap-2 w-full">
                            {/* Type Toggle */}
                            <div
                              className="flex shrink-0 rounded-lg p-0.5 gap-0.5 w-32 sm:w-40"
                              style={{ background: 'rgba(0,0,0,0.3)', border: AXIOM.inputs.border }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setBulkRows((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, type: 'expense' } : r)),
                                  )
                                }
                                className="flex-1 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1 transition-all"
                                style={
                                  row.type === 'expense'
                                    ? {
                                        background: 'rgba(239, 68, 68, 0.25)',
                                        color: '#f87171',
                                        border: '1px solid rgba(239, 68, 68, 0.4)',
                                        boxShadow: '0 0 10px rgba(239, 68, 68, 0.2)',
                                      }
                                    : { color: 'rgba(148, 163, 184, 0.6)', border: '1px solid transparent' }
                                }
                              >
                                <TrendingDown className="size-3" />
                                Expense
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setBulkRows((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, type: 'income' } : r)),
                                  )
                                }
                                className="flex-1 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1 transition-all"
                                style={
                                  row.type === 'income'
                                    ? {
                                        background: 'rgba(16, 185, 129, 0.25)',
                                        color: '#34d399',
                                        border: '1px solid rgba(16, 185, 129, 0.4)',
                                        boxShadow: '0 0 10px rgba(16, 185, 129, 0.2)',
                                      }
                                    : { color: 'rgba(148, 163, 184, 0.6)', border: '1px solid transparent' }
                                }
                              >
                                <TrendingUp className="size-3" />
                                Income
                              </button>
                            </div>

                            {/* Amount Input */}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Amount"
                              value={row.amount}
                              onChange={(e) =>
                                setBulkRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, amount: e.target.value } : r)),
                                )
                              }
                              className="h-10 px-3 rounded-lg text-sm w-24 sm:w-28 shrink-0 font-medium"
                              style={{
                                background: AXIOM.inputs.background,
                                border: AXIOM.inputs.border,
                                color: AXIOM.inputs.color,
                              }}
                            />

                            {/* Description Input — fully flexible with guaranteed minimum width */}
                            <input
                              type="text"
                              placeholder="Description / Narration (e.g. AWS, Figma, Upwork)"
                              value={row.narration}
                              onChange={(e) =>
                                setBulkRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, narration: e.target.value } : r)),
                                )
                              }
                              className="h-10 px-3 rounded-lg text-sm flex-1 min-w-[140px]"
                              style={{
                                background: AXIOM.inputs.background,
                                border: AXIOM.inputs.border,
                                color: AXIOM.inputs.color,
                              }}
                            />

                            {/* Remove Button */}
                            <button
                              type="button"
                              onClick={() => {
                                if (bulkRows.length <= 1) return;
                                setBulkRows((prev) => prev.filter((r) => r.id !== row.id));
                              }}
                              disabled={bulkRows.length <= 1}
                              className="h-10 px-2.5 rounded-lg text-slate-400 hover:text-rose-400 text-xs font-medium disabled:opacity-30 shrink-0 transition-colors"
                              aria-label="Remove line"
                            >
                              Remove
                            </button>
                          </div>

                          {/* Secondary Line: AI Classification & Category Indicator */}
                          {row.isAiClassified && row.aiSuggestedCategoryName ? (
                            <div className="flex items-center justify-between text-xs px-1 pt-0.5">
                              <div className="flex items-center gap-1.5">
                                <Sparkles className="size-3 text-cyan-400" />
                                <span className="text-slate-400">Category:</span>
                                <span className="text-cyan-300 font-semibold">
                                  {row.aiSuggestedCategoryName}
                                </span>
                                {row.aiConfidence != null && (
                                  <span className="text-slate-500 text-[11px]">
                                    ({row.aiConfidence}% confidence)
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                                <CheckCircle className="size-3 text-emerald-400" />
                                Ready to save
                              </span>
                            </div>
                          ) : row.narration.trim() ? (
                            <div className="flex items-center justify-between text-xs px-1 pt-0.5 text-slate-500">
                              <div className="flex items-center gap-1 text-amber-400/80 text-[11px]">
                                <AlertCircle className="size-3 shrink-0" />
                                <span>Uncategorized · Will auto-classify when saving or click <strong>✨ AI Auto-Classify</strong></span>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>Currency (all lines)</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="h-12 px-4 rounded-xl font-medium max-w-xs"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    >
                      <option value="USD">USD</option>
                      <option value="PKR">PKR</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="AED">AED</option>
                      <option value="SAR">SAR</option>
                      <option value="INR">INR</option>
                      <option value="CAD">CAD</option>
                      <option value="AUD">AUD</option>
                    </select>
                    {bankAccountCurrency && currency !== bankAccountCurrency && (
                      <p className="text-xs text-cyan-400">
                        ⚡ Amounts will be auto-converted from {currency} → {bankAccountCurrency} at estimated market rates before saving.
                      </p>
                    )}
                  </div>
                  {departments.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-1.5" style={{ color: AXIOM.text.slate300 }}>
                        <Building2 className="size-3.5" />
                        Department (all lines)
                      </label>
                      <select
                        value={selectedBulkDepartmentId}
                        onChange={(e) => setSelectedBulkDepartmentId(e.target.value)}
                        className="h-12 px-4 rounded-xl font-medium w-full max-w-md"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        <option value="">No Department</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {projects.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-1.5" style={{ color: AXIOM.text.slate300 }}>
                        <FolderKanban className="size-3.5" />
                        Project allocation (all lines)
                      </label>
                      <select
                        value={selectedBulkProjectId}
                        onChange={(e) => setSelectedBulkProjectId(e.target.value)}
                        className="h-12 px-4 rounded-xl font-medium w-full max-w-md"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                          color: AXIOM.inputs.color,
                        }}
                      >
                        <option value="">No Project (General overhead / unallocated)</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.clientName ? `(${p.clientName})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Scope (Only if Personal Finance feature is enabled in Organization Settings) */}
              {isPersonalFinanceEnabled && entryMode !== 'transfer' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>Scope</label>
                  <div className="flex min-w-0 gap-2">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => setScope('business')}
                      className="touch-manipulation flex-1 rounded-xl px-3 py-2.5 text-sm font-medium sm:px-4 sm:py-3"
                      style={scope === 'business' ? {
                        background: 'rgba(168, 85, 247, 0.3)',
                        border: '1px solid rgba(168, 85, 247, 0.5)',
                        color: '#ffffff',
                      } : {
                        background: 'rgba(0, 0, 0, 0.2)',
                        border: 'none',
                        color: 'rgba(148, 163, 184, 0.7)',
                      }}
                    >
                      Business
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => setScope('personal')}
                      className="touch-manipulation flex-1 rounded-xl px-3 py-2.5 text-sm font-medium sm:px-4 sm:py-3"
                      style={scope === 'personal' ? {
                        background: 'rgba(168, 85, 247, 0.3)',
                        border: '1px solid rgba(168, 85, 247, 0.5)',
                        color: '#ffffff',
                      } : {
                        background: 'rgba(0, 0, 0, 0.2)',
                        border: 'none',
                        color: 'rgba(148, 163, 184, 0.7)',
                      }}
                    >
                      Personal
                    </motion.button>
                  </div>
                </div>
              )}

              {/* Department Selection (Single Entry) */}
              {entryMode === 'single' && departments.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-1.5" style={{ color: AXIOM.text.slate300 }}>
                      <Building2 className="size-3.5" />
                      Department
                    </label>
                    {selectedDepartmentId ? (
                      <span className="text-xs text-cyan-400 font-medium">
                        Assigned to department
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Optional</span>
                    )}
                  </div>
                  <select
                    value={selectedDepartmentId}
                    onChange={(e) => setSelectedDepartmentId(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    <option value="">No Department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    Links this transaction to a department's budget for spend tracking.
                  </p>
                </div>
              )}

              {/* Project Selection (Single Entry) */}
              {entryMode === 'single' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-1.5" style={{ color: AXIOM.text.slate300 }}>
                      <FolderKanban className="size-3.5" />
                      Project
                    </label>
                    {selectedProjectId ? (
                      <span className="text-xs text-cyan-400 font-medium">
                        Linked to Project
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Optional</span>
                    )}
                  </div>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl text-sm"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    <option value="">No Project (General overhead / unallocated)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.clientName ? `— ${p.clientName}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    Assigning a project updates project actual cost, revenue, and margin calculations in real time.
                  </p>
                </div>
              )}

              {/* Payment Method & Account Selection (Single & Bulk) */}
              {entryMode !== 'transfer' && (
                <>
                  {/* Payment Method */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>Payment Method</label>
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      {(['cash', 'bank', 'card'] as const).map((m) => (
                        <motion.button
                          key={m}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() => setMethod(m)}
                          className="touch-manipulation rounded-xl px-2 py-2.5 text-xs font-medium sm:px-4 sm:py-3 sm:text-sm"
                          style={method === m ? {
                            background: 'rgba(168, 85, 247, 0.3)',
                            border: '1px solid rgba(168, 85, 247, 0.5)',
                            color: '#ffffff',
                          } : {
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: 'none',
                            color: 'rgba(148, 163, 184, 0.7)',
                          }}
                        >
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {/* Account Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: AXIOM.text.slate300 }}>
                      {entryMode === 'single' && type === 'income'
                        ? 'Deposit to account'
                        : entryMode === 'single' && type === 'expense'
                          ? 'Pay from account'
                          : 'Account'}
                    </label>
                    <select
                      value={account}
                      onChange={(e) => {
                        const newAccId = e.target.value;
                        setAccount(newAccId);
                        // Auto-switch currency to match the selected bank account
                        const newAcc = selectableAccounts.find((a) => a.id === newAccId);
                        if (newAcc?.currency) {
                          setCurrency(newAcc.currency);
                        }
                      }}
                      disabled={!selectableAccounts.length || accountsLoading}
                      className="w-full h-12 px-4 rounded-xl disabled:opacity-50"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    >
                      <option value="">Select account…</option>
                      {selectableAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.bankName} · {acc.accountNumber?.slice(-4) ?? '----'} ({acc.currency})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">
                      {entryMode === 'single' && type === 'income'
                        ? 'Where this payment is recorded (e.g. Pioneer wallet or local bank). A second transfer can be a separate entry when it moves.'
                        : entryMode === 'single' && type === 'expense'
                          ? 'Wallet or card this payment leaves from.'
                          : method === 'card'
                            ? 'Credit card accounts'
                            : method === 'cash'
                              ? 'Checking or savings (cash-style entry)'
                              : 'Bank / operating accounts'}
                    </p>
                  </div>
                </>
              )}

              {/* Submit */}
              <motion.button
                {...AXIOM.animations.hoverScaleSmall}
                type="button"
                className="mt-6 flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold sm:text-base disabled:opacity-50"
                onClick={() =>
                  entryMode === 'transfer'
                    ? void handleTransferSubmit()
                    : entryMode === 'bulk'
                      ? void handleBulkSave()
                      : void handleSubmit()
                }
                disabled={
                  entryMode === 'transfer'
                    ? transferSubmitting || !transferFromAccount || !transferToAccount || transferFromAccount === transferToAccount || !transferAmount || Number(transferAmount) <= 0
                    : submitting || accountsLoading || !selectableAccounts.length || !account
                }
                style={
                  entryMode === 'transfer'
                    ? {
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.9), rgba(59, 130, 246, 0.9))',
                        color: '#ffffff',
                        boxShadow: '0 4px 20px rgba(6, 182, 212, 0.4)',
                      }
                    : AXIOM.buttons.action
                }
              >
                {entryMode === 'transfer' ? (
                  <ArrowLeftRight className="size-5" />
                ) : (
                  <Plus className="size-5" />
                )}
                {entryMode === 'transfer'
                  ? transferSubmitting
                    ? 'Processing Transfer…'
                    : 'Execute Transfer'
                  : submitting
                    ? 'Saving…'
                    : entryMode === 'bulk'
                      ? 'Save all lines'
                      : `Add ${type === 'income' ? 'Income' : 'Expense'}`}
              </motion.button>
              {embedded && lastSavedLine && (
                <p
                  className="mt-3 break-words rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-200/90"
                  aria-live="polite"
                >
                  {lastSavedLine}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Sidebar — hidden in dashboard modal */}
        {!embedded && (
        <div className="min-w-0 space-y-6">
          {/* Recent Transactions - AXIOM Style */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="min-w-0 rounded-2xl p-4 sm:rounded-3xl sm:p-6"
            style={AXIOM.containers.list}
          >
            <h3 className="mb-3 text-base font-bold text-white sm:mb-4 sm:text-lg">Recent entries</h3>
            <div className="space-y-2">
              {recentLoading && recentTransactions.length === 0 && (
                <p className="text-xs text-slate-500 font-mono" aria-live="polite">
                  Loading…
                </p>
              )}
              {!recentLoading && recentTransactions.length === 0 && (
                <p className="text-sm text-slate-500">No transactions yet. Saved Quick Add rows appear here.</p>
              )}
              {recentTransactions.map((txn, idx) => {
                const isIncome = txn.type === 'credit';
                return (
                  <motion.div
                    key={txn.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + idx * 0.05 }}
                    className="p-3 rounded-xl"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <p className="line-clamp-2 min-w-0 break-words text-sm font-medium text-white">{txn.narration}</p>
                      <div
                        className="px-2 py-1 rounded text-xs font-bold shrink-0"
                        style={isIncome ? AXIOM.badges.success : AXIOM.badges.danger}
                      >
                        {isIncome ? '+' : '−'}
                        {txn.currency} {Math.abs(txn.amount).toLocaleString()}
                      </div>
                    </div>
                    <p className="text-xs" style={{ color: AXIOM.text.slate400 }}>
                      {txn.date} · {(txn.tags ?? []).includes('quick-add') ? 'Quick add' : txn.status}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Pro Tips - AXIOM Style */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="relative min-w-0 overflow-hidden rounded-2xl p-4 sm:rounded-3xl sm:p-6"
            style={AXIOM.containers.chartCyan}
          >
            <div 
              className="absolute inset-0"
              style={{ background: AXIOM.radialOverlays.cyan }}
            />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="size-5 text-cyan-400" />
                <h3 className="text-lg font-bold text-white">Pro Tips</h3>
              </div>
              <div className="space-y-2 text-sm" style={{ color: AXIOM.text.slate300 }}>
                <p className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-0.5">•</span>
                  <span>Be descriptive in narration for better AI categorization</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-0.5">•</span>
                  <span>The system learns from your corrections</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-0.5">•</span>
                  <span>Date/time is auto-filled if not specified</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-0.5">•</span>
                  <span>Cash withdrawals auto-update Cash in Hand</span>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
        )}
      </div>

      {/* ── Result Modal (Success / Failure) ── */}
      {resultModal.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative w-full max-w-md rounded-2xl p-6 sm:p-8"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.98))',
              border: resultModal.success
                ? '1px solid rgba(16, 185, 129, 0.4)'
                : '1px solid rgba(239, 68, 68, 0.4)',
              boxShadow: resultModal.success
                ? '0 0 40px rgba(16, 185, 129, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                : '0 0 40px rgba(239, 68, 68, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <button
              type="button"
              onClick={() => setResultModal(prev => ({ ...prev, open: false }))}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="size-4" />
            </button>

            <div className="flex flex-col items-center text-center gap-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                className="flex items-center justify-center w-16 h-16 rounded-full"
                style={{
                  background: resultModal.success
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  border: resultModal.success
                    ? '2px solid rgba(16, 185, 129, 0.3)'
                    : '2px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                {resultModal.success ? (
                  <CheckCircle className="size-8 text-emerald-400" />
                ) : (
                  <AlertCircle className="size-8 text-red-400" />
                )}
              </motion.div>

              <div>
                <h3 className="text-xl font-bold text-white mb-1">{resultModal.title}</h3>
                <p className="text-sm text-slate-300">{resultModal.message}</p>
                {resultModal.details && (
                  <p className="text-xs text-slate-500 mt-1">{resultModal.details}</p>
                )}
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setResultModal(prev => ({ ...prev, open: false }))}
                className="mt-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{
                  background: resultModal.success
                    ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.6), rgba(5, 150, 105, 0.6))'
                    : 'linear-gradient(135deg, rgba(239, 68, 68, 0.6), rgba(220, 38, 38, 0.6))',
                  border: resultModal.success
                    ? '1px solid rgba(16, 185, 129, 0.3)'
                    : '1px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                {resultModal.success ? 'Continue' : 'Try Again'}
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}