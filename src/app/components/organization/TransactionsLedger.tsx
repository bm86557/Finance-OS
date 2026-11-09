import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import type { Transaction } from '@/services/types';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { convertCurrency } from '@/lib/currencyUtils';
import { exportTransactions } from '../../../lib/exportUtils';
import {
  Search,
  Filter,
  Download,
  Edit,
  Split,
  CheckSquare,
  X,
  DollarSign,
  History,
  TrendingUp,
  TrendingDown,
  Receipt,
  RefreshCw,
  ArrowUpDown,
  RotateCcw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { TransactionHistoryModal } from './TransactionHistoryModal';
import { useTheme } from '../../../contexts/ThemeContext';
import { AXIOM } from '../../../styles/axiom-tokens';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

// ── Type adapter ───────────────────────────────────────────────────────────────
// Bridges the NEW Transaction type (debit/credit, categoryId) to the
// shape the existing UI expects (income/expense, category string, scope).
// When a real backend arrives, remove this adapter and update the JSX directly.
function adaptTransaction(
  txn: Transaction,
  categoryMap: Map<string, string>,
  bankMap: Map<string, string>,
  projectMap: Map<string, string>,
) {
  const tags = txn.tags ?? [];
  const scope: 'business' | 'personal' = tags.includes('personal') ? 'personal' : 'business';
  const bankLabel =
    bankMap.get(txn.bankAccountId) ??
    (txn.bankAccountId ? `Account ${String(txn.bankAccountId).slice(-6)}` : '—');
  const projectName = txn.projectId ? (projectMap.get(txn.projectId) ?? 'Project') : '';
  
  // Extract source file name from tags if not in txn.sourceFileName
  let sourceFileName = txn.sourceFileName;
  let sourceFileType = txn.sourceFileType;
  
  if (!sourceFileName) {
    // Look for "import:filename" tag
    const importTag = tags.find(t => t.startsWith('import:'));
    if (importTag) {
      sourceFileName = importTag.substring(7); // Remove "import:" prefix
      // Determine file type from extension
      if (sourceFileName.toLowerCase().endsWith('.pdf')) {
        sourceFileType = 'pdf';
      } else if (sourceFileName.toLowerCase().endsWith('.csv')) {
        sourceFileType = 'csv';
      }
    }
  }
  
  return {
    ...txn,
    type: txn.type === 'credit' ? ('income' as const) : ('expense' as const),
    category: categoryMap.get(txn.categoryId ?? '') ?? 'Uncategorised',
    projectName,
    scope,
    account: txn.bankAccountId ?? '',
    accountName: bankLabel,
    narration: txn.narration ?? txn.description ?? '',
    sourceFileName,
    sourceFileType,
    sourceImportedAt: txn.sourceImportedAt,
  };
}

function statusLabel(status: string): string {
  const m: Record<string, string> = {
    pending: 'Pending',
    classified: 'Classified',
    reviewed: 'Reviewed',
    reconciled: 'Reconciled',
    posted: 'Posted',
    reversed: 'Reversed',
    draft: 'Draft',
    approved: 'Approved',
    rejected: 'Rejected',
  };
  return m[status] ?? status;
}

export function TransactionsLedger() {
  const { theme } = useTheme();
  const { currentOrganization } = useAuth();
  const isPersonalFinanceEnabled = currentOrganization?.settings?.features?.personal_finance ?? true;
  const { can } = usePermissions();
  const canEdit = can('edit_transaction');
  const canDelete = can('delete_transaction');
  const canExport = can('export_data');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterScope, setFilterScope] = useState<'all' | 'business' | 'personal'>('all');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSource, setFilterSource] = useState<'all' | 'manual' | 'import' | 'recurring'>('all');
  const [sortBy, setSortBy] = useState<'created_desc' | 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('created_desc');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountFrom, setAmountFrom] = useState('');
  const [amountTo, setAmountTo] = useState('');
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [editNarration, setEditNarration] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkProjectId, setBulkProjectId] = useState('');

  // ── Reversal Workflow States (Financial Immutability §8, §33) ───────────────
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false);
  const [reversalTargetTxn, setReversalTargetTxn] = useState<any>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  const [bulkReversalDialogOpen, setBulkReversalDialogOpen] = useState(false);
  const [bulkReversalReason, setBulkReversalReason] = useState('');
  const [isBulkReversing, setIsBulkReversing] = useState(false);

  // ── Service wiring ───────────────────────────────────────────────────────
  const svc = useOrgServices();

  const { data: txnResult, loading: txnLoading, error: txnError, refetch } = useService(
    () => svc.transactions.getAll({ pageSize: 500 }),
    [svc.orgId],
    ['transactions'],
  );

  const { data: categories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );

  const { data: projects } = useServiceArray(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects'],
  );

  const { data: bankAccounts } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts'],
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const bankMap = useMemo(
    () =>
      new Map(
        bankAccounts.map((b) => [
          b.id,
          `${b.bankName} · ${b.accountNumber?.slice(-4) ?? '----'}`,
        ]),
      ),
    [bankAccounts],
  );

  const allTransactions = useMemo(
    () => {
      const mapped = (txnResult?.items ?? []).map((t) => adaptTransaction(t, categoryMap, bankMap, projectMap));
      // Sort descending by date, tie-broken by createdAt desc so newly added transactions always show at the top
      return mapped.sort((a, b) => {
        const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
    },
    [txnResult, categoryMap, bankMap, projectMap],
  );

  /** Names from chart categories plus any labels seen on transactions (empty ledger still has filter options). */
  const categoryList = useMemo(() => {
    const fromSvc = categories.map((c) => c.name);
    const fromTxns = allTransactions.map((t) => t.category);
    return Array.from(new Set([...fromSvc, ...fromTxns]))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [allTransactions, categories]);

  useEffect(() => {
    if (categories.length && !bulkCategoryId) {
      setBulkCategoryId(categories[0].id);
    }
  }, [categories, bulkCategoryId]);

  useEffect(() => {
    if (editDialogOpen && selectedTransaction) {
      setEditNarration(String(selectedTransaction.narration ?? ''));
      setEditProjectId(String(selectedTransaction.projectId ?? ''));
    }
  }, [editDialogOpen, selectedTransaction]);

  const filteredTransactions = allTransactions.filter((txn) => {
    const narr = String(txn.narration ?? '').toLowerCase();
    const cat = String(txn.category ?? '').toLowerCase();
    const projName = String(txn.projectName ?? '').toLowerCase();
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q || narr.includes(q) || cat.includes(q) || projName.includes(q);
    const matchesScope = !isPersonalFinanceEnabled
      ? txn.scope === 'business'
      : (filterScope === 'all' || txn.scope === filterScope);
    const matchesType = filterType === 'all' || txn.type === filterType;
    const matchesCategory = filterCategory === 'all' || txn.category === filterCategory;
    const matchesProject =
      filterProject === 'all' ||
      (filterProject === 'unassigned' ? !txn.projectId : txn.projectId === filterProject);
    const matchesStatus = filterStatus === 'all' || txn.status === filterStatus;

    const matchesSource =
      filterSource === 'all' ||
      (filterSource === 'manual' && !txn.sourceFileName && !(txn.tags ?? []).includes('recurring')) ||
      (filterSource === 'import' && Boolean(txn.sourceFileName)) ||
      (filterSource === 'recurring' && (txn.tags ?? []).includes('recurring'));

    const txnDateStr = String(txn.date || '').slice(0, 10);
    const matchesDateFrom = !dateFrom || txnDateStr >= dateFrom;
    const matchesDateTo = !dateTo || txnDateStr <= dateTo;

    const af = amountFrom ? Number.parseFloat(amountFrom) : NaN;
    const at = amountTo ? Number.parseFloat(amountTo) : NaN;
    const magnitude = Math.abs(Number(txn.amount));
    const matchesAmountFrom = !amountFrom || (Number.isFinite(af) && magnitude >= af);
    const matchesAmountTo = !amountTo || (Number.isFinite(at) && magnitude <= at);

    return (
      matchesSearch &&
      matchesScope &&
      matchesType &&
      matchesCategory &&
      matchesProject &&
      matchesStatus &&
      matchesSource &&
      matchesDateFrom &&
      matchesDateTo &&
      matchesAmountFrom &&
      matchesAmountTo
    );
  });

  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      if (sortBy === 'created_desc') {
        const cComp = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        if (cComp !== 0) return cComp;
        return String(b.date || '').localeCompare(String(a.date || ''));
      }
      if (sortBy === 'date_desc') {
        const dComp = String(b.date || '').localeCompare(String(a.date || ''));
        if (dComp !== 0) return dComp;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      }
      if (sortBy === 'date_asc') {
        const dComp = String(a.date || '').localeCompare(String(b.date || ''));
        if (dComp !== 0) return dComp;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      }
      if (sortBy === 'amount_desc') {
        return Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0));
      }
      if (sortBy === 'amount_asc') {
        return Math.abs(Number(a.amount || 0)) - Math.abs(Number(b.amount || 0));
      }
      return 0;
    });
  }, [filteredTransactions, sortBy]);

  const toggleSelectAll = () => {
    if (selectedTransactions.length === filteredTransactions.length) {
      setSelectedTransactions([]);
    } else {
      setSelectedTransactions(filteredTransactions.map(t => t.id));
    }
  };

  const toggleSelectTransaction = (id: string) => {
    setSelectedTransactions(prev => 
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const handleApplyBulkCategory = async () => {
    if (!bulkCategoryId || selectedTransactions.length === 0) {
      toast.error('Choose a category.');
      return;
    }
    const res = await svc.transactions.bulkCategorize(
      selectedTransactions,
      bulkCategoryId,
      'user',
    );
    if (res.success && res.data) {
      await refetch();
      toast.success(`Updated ${res.data.succeeded} transaction(s)`);
      setSelectedTransactions([]);
      setBulkEditDialogOpen(false);
    } else {
      toast.error(res.error ?? 'Could not update categories.');
    }
  };

  // ── Financial Immutability & Reversals (§8, §33) ───────────────────────────
  const handleInitiateReverse = (txn: any) => {
    setReversalTargetTxn(txn);
    setReversalReason('');
    setReversalDialogOpen(true);
  };

  const handleConfirmReverse = async () => {
    if (!reversalTargetTxn) return;
    const trimmedReason = reversalReason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      toast.error('A mandatory correction reason is required to reverse a posted transaction.');
      return;
    }
    setIsReversing(true);
    try {
      const res = await svc.transactions.reverse(reversalTargetTxn.id, trimmedReason);
      if (res.success) {
        toast.success('Transaction reversed. Offsetting journal entry recorded in GL.');
        setReversalDialogOpen(false);
        setReversalTargetTxn(null);
        setReversalReason('');
        await refetch();
      } else {
        toast.error(res.error || 'Failed to reverse transaction.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Unexpected error while reversing transaction.');
    } finally {
      setIsReversing(false);
    }
  };

  const handleDeleteDraft = async (txn: any) => {
    if (!window.confirm(`Purge unposted draft transaction "${txn.narration || txn.description || 'entry'}"?`)) {
      return;
    }
    try {
      const res = await svc.transactions.delete(txn.id);
      if (res.success) {
        toast.success('Draft transaction purged.');
        await refetch();
      } else {
        toast.error(res.error || 'Failed to delete draft.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error deleting draft.');
    }
  };

  const handleBulkAction = () => {
    if (selectedTransactions.length === 0) return;
    const selectedObjs = allTransactions.filter(t => selectedTransactions.includes(t.id));
    const postedOrReconciled = selectedObjs.filter(t =>
      ['posted', 'reconciled', 'classified', 'reviewed'].includes(t.status)
    );
    const alreadyReversed = selectedObjs.filter(t => t.status === 'reversed');

    if (alreadyReversed.length === selectedObjs.length) {
      toast.info('All selected transactions are already reversed.');
      return;
    }

    if (postedOrReconciled.length > 0) {
      // Per §8 & §33, posted items cannot be deleted — prompt for reversal reason
      setBulkReversalReason('');
      setBulkReversalDialogOpen(true);
    } else {
      // Only unposted drafts/pending items
      if (window.confirm(`Permanently purge ${selectedObjs.length} unposted draft transaction(s)?`)) {
        void executeBulkPurge(selectedTransactions);
      }
    }
  };

  const executeBulkPurge = async (ids: string[]) => {
    const res = await svc.transactions.bulkDelete(ids);
    if (res.success && res.data) {
      await refetch();
      toast.success(`Purged ${res.data.succeeded} draft transaction(s)`);
      setSelectedTransactions([]);
      setBulkEditDialogOpen(false);
    } else {
      toast.error(res.error ?? 'Could not purge drafts.');
    }
  };

  const handleConfirmBulkReverse = async () => {
    const trimmedReason = bulkReversalReason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      toast.error('A mandatory correction reason is required for bulk reversal.');
      return;
    }
    setIsBulkReversing(true);
    try {
      const selectedObjs = allTransactions.filter(t => selectedTransactions.includes(t.id));
      const toReverse = selectedObjs.filter(t =>
        ['posted', 'reconciled', 'classified', 'reviewed'].includes(t.status)
      );
      const toPurge = selectedObjs.filter(t =>
        ['draft', 'pending'].includes(t.status) || !t.status
      );

      let reversedCount = 0;
      let purgeCount = 0;
      const errors: string[] = [];

      for (const txn of toReverse) {
        const res = await svc.transactions.reverse(txn.id, trimmedReason);
        if (res.success) {
          reversedCount++;
        } else {
          errors.push(res.error || `Failed to reverse #${txn.id.slice(-6)}`);
        }
      }

      if (toPurge.length > 0) {
        const purgeRes = await svc.transactions.bulkDelete(toPurge.map(t => t.id));
        if (purgeRes.success && purgeRes.data) {
          purgeCount = purgeRes.data.succeeded;
        }
      }

      await refetch();
      setSelectedTransactions([]);
      setBulkReversalDialogOpen(false);
      setBulkEditDialogOpen(false);
      setBulkReversalReason('');

      if (errors.length > 0) {
        toast.warning(`Reversed ${reversedCount} transaction(s), but ${errors.length} failed.`);
      } else {
        toast.success(`Processed ${reversedCount} reversal(s) and ${purgeCount} purge(s).`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error processing bulk reversals.');
    } finally {
      setIsBulkReversing(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedTransaction?.id) return;
    const text = editNarration.trim();
    if (!text) {
      toast.error('Description cannot be empty.');
      return;
    }
    const res = await svc.transactions.update(selectedTransaction.id, {
      narration: text,
      description: text.slice(0, 200),
      projectId: editProjectId ? editProjectId : (null as any),
    });
    if (res.success) {
      await refetch();
      toast.success('Transaction updated');
      setEditDialogOpen(false);
      setSelectedTransaction(null);
    } else {
      toast.error(res.error ?? 'Could not save.');
    }
  };

  const handleApplyBulkProject = async () => {
    if (selectedTransactions.length === 0) {
      toast.error('Choose at least one transaction.');
      return;
    }
    let count = 0;
    for (const id of selectedTransactions) {
      const res = await svc.transactions.update(id, {
        projectId: bulkProjectId === '__none__' || !bulkProjectId ? (null as any) : bulkProjectId,
      });
      if (res.success) count++;
    }
    await refetch();
    toast.success(`Updated project for ${count} transaction(s)`);
    setSelectedTransactions([]);
    setBulkEditDialogOpen(false);
  };

  const handleEditTransaction = (txn: any) => {
    setSelectedTransaction(txn);
    setEditDialogOpen(true);
  };

  const handleSplitTransaction = () => {
    toast.info('Split is not available in this build. Duplicate the line in Quick Add if you need to break it apart.');
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterScope('all');
    setFilterType('all');
    setFilterCategory('all');
    setFilterProject('all');
    setFilterStatus('all');
    setFilterSource('all');
    setSortBy('created_desc');
    setDateFrom('');
    setDateTo('');
    setAmountFrom('');
    setAmountTo('');
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('Transactions refreshed from database');
    } catch {
      toast.error('Could not refresh transactions');
    } finally {
      setIsRefreshing(false);
    }
  };

  const orgCurrency = currentOrganization?.currency || 'USD';

  const isLoanPrincipalTxn = (t: any) => {
    const cat = String(t.category || '').toLowerCase();
    const narr = String(t.narration || '').toLowerCase();
    const tags = Array.isArray(t.tags) ? t.tags : [];
    return (
      cat.includes('loan repayment') ||
      tags.includes('loan-principal') ||
      (narr.includes('monthly installment') && narr.includes('loan')) ||
      narr.includes('loan repayment')
    );
  };

  const isTransferTxn = (t: any) => {
    if (t.isTransfer || t.transferGroupId) return true;
    const tags = Array.isArray(t.tags) ? t.tags : [];
    if (tags.includes('transfer')) return true;
    const cat = String(t.category || '').toLowerCase();
    return cat === 'transfer' || cat === 'internal transfer';
  };

  const totalIncome = useMemo(() => {
    return allTransactions
      .filter((t) =>
        t.type === 'income' &&
        !['reversed', 'cancelled', 'draft', 'pending', 'rejected'].includes(String(t.status || '').toLowerCase()) &&
        !isTransferTxn(t)
      )
      .reduce((sum, t) => {
        const raw = Math.abs(Number(t.amount || 0));
        const txnCur = t.currency || orgCurrency;
        return sum + convertCurrency(raw, txnCur, orgCurrency, t.fxRateToBase);
      }, 0);
  }, [allTransactions, orgCurrency]);

  const totalExpense = useMemo(() => {
    return allTransactions
      .filter((t) =>
        t.type === 'expense' &&
        !['reversed', 'cancelled', 'draft', 'pending', 'rejected'].includes(String(t.status || '').toLowerCase()) &&
        !isTransferTxn(t) &&
        !isLoanPrincipalTxn(t)
      )
      .reduce((sum, t) => {
        const raw = Math.abs(Number(t.amount || 0));
        const txnCur = t.currency || orgCurrency;
        return sum + convertCurrency(raw, txnCur, orgCurrency, t.fxRateToBase);
      }, 0);
  }, [allTransactions, orgCurrency]);

  const netTotal = totalIncome - totalExpense;

  const exportCsv = () => {
    try {
      exportTransactions(filteredTransactions);
      toast.success('Export started');
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <div
      className="min-h-screen space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8"
      style={{ background: AXIOM.backgrounds.main }}
    >
      {txnError && (
        <p
          className="rounded-xl border border-amber-500/40 px-4 py-3 text-sm text-amber-100"
          role="alert"
        >
          {txnError}
        </p>
      )}
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Receipt className="size-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold sm:text-3xl md:text-4xl" style={AXIOM.text.titleStyle}>
                Transactions Ledger
              </h1>
              <p className="text-slate-400 text-xs sm:text-sm">All income and expenses in one unified view ({orgCurrency})</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && selectedTransactions.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  background: 'rgba(168, 85, 247, 0.3)',
                  border: '1px solid rgba(168, 85, 247, 0.5)',
                  color: '#ffffff',
                }}
                onClick={() => setBulkEditDialogOpen(true)}
              >
                <CheckSquare className="size-4" />
                Bulk Edit ({selectedTransactions.length})
              </motion.button>
            )}
            {(canDelete || canEdit) && selectedTransactions.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  background: 'rgba(239, 68, 68, 0.25)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: '#ffffff',
                }}
                onClick={handleBulkAction}
              >
                <RotateCcw className="size-4" />
                Reverse / Purge ({selectedTransactions.length})
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={isRefreshing}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'rgba(168, 85, 247, 0.25)',
                border: '1px solid rgba(168, 85, 247, 0.5)',
                color: '#ffffff',
              }}
              onClick={handleRefresh}
            >
              <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
            {canExport && (
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
                onClick={exportCsv}
              >
                <Download className="size-4" />
                Export
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Income ({orgCurrency})</p>
              <p className="text-2xl font-bold text-emerald-400">+{formatCurrency(totalIncome, orgCurrency)}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <TrendingUp className="size-6 text-white" />
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
              <p className="text-slate-400 text-sm mb-1">Total Expense ({orgCurrency})</p>
              <p className="text-2xl font-bold text-red-400">-{formatCurrency(totalExpense, orgCurrency)}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.red,
                boxShadow: AXIOM.shadows.iconRed,
              }}
            >
              <TrendingDown className="size-6 text-white" />
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
              <p className="text-slate-400 text-sm mb-1">Net ({orgCurrency})</p>
              <p className={`text-2xl font-bold ${netTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {netTotal >= 0 ? '+' : ''}{formatCurrency(netTotal, orgCurrency)}
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <DollarSign className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.list}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="flex-1 min-w-64 relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search narration or category..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                  color: AXIOM.inputs.color,
                }}
              />
            </div>

            {/* Quick Filters */}
            {isPersonalFinanceEnabled && (
              <select 
                value={filterScope}
                onChange={(e) => setFilterScope(e.target.value as any)}
                className="h-10 px-3 rounded-xl"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                  color: AXIOM.inputs.color,
                }}
              >
                <option value="all">All Scopes</option>
                <option value="business">Business Only</option>
                <option value="personal">Personal Only</option>
              </select>
            )}

            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="h-10 px-3 rounded-xl"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
                color: AXIOM.inputs.color,
              }}
            >
              <option value="all">All Types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>

            <select 
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="h-10 px-3 rounded-xl"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
                color: AXIOM.inputs.color,
              }}
            >
              <option value="all">All Categories</option>
              {categoryList.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            {projects.length > 0 && (
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="h-10 px-3 rounded-xl"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                  color: AXIOM.inputs.color,
                }}
              >
                <option value="all">All Projects</option>
                <option value="unassigned">Unassigned (No Project)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-10 rounded-xl px-3"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
                color: AXIOM.inputs.color,
              }}
            >
              <option value="all">All statuses</option>
              <option value="posted">Posted</option>
              <option value="reconciled">Reconciled</option>
              <option value="classified">Classified</option>
              <option value="reviewed">Reviewed</option>
              <option value="pending">Pending</option>
              <option value="reversed">Reversed</option>
              <option value="draft">Draft</option>
            </select>

            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as any)}
              className="h-10 rounded-xl px-3"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
                color: AXIOM.inputs.color,
              }}
            >
              <option value="all">All Sources</option>
              <option value="manual">Manual Entry Only</option>
              <option value="import">Statement Imports</option>
              <option value="recurring">Recurring Schedules</option>
            </select>

            <div className="flex items-center gap-1.5 h-10 px-3 rounded-xl" style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}>
              <ArrowUpDown className="size-3.5 text-purple-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-xs sm:text-sm font-medium outline-none text-white cursor-pointer"
              >
                <option value="created_desc" className="bg-slate-900 text-white">Recently Added (Newest First)</option>
                <option value="date_desc" className="bg-slate-900 text-white">Transaction Date (Newest First)</option>
                <option value="date_asc" className="bg-slate-900 text-white">Transaction Date (Oldest First)</option>
                <option value="amount_desc" className="bg-slate-900 text-white">Amount (High to Low)</option>
                <option value="amount_asc" className="bg-slate-900 text-white">Amount (Low to High)</option>
              </select>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="h-10 px-4 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'rgba(168, 85, 247, 0.3)',
                border: '1px solid rgba(168, 85, 247, 0.5)',
                color: '#ffffff',
              }}
              onClick={() => setAdvancedFiltersOpen(!advancedFiltersOpen)}
            >
              <Filter className="size-4" />
              Advanced
            </motion.button>
          </div>

          {/* Advanced Filters */}
          {advancedFiltersOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="pt-4 border-t grid grid-cols-2 md:grid-cols-5 gap-3"
              style={{ borderColor: 'rgba(148, 163, 184, 0.1)' }}
            >
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: AXIOM.text.slate400 }}>Date From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: AXIOM.text.slate400 }}>Date To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: AXIOM.text.slate400 }}>Amount From</label>
                <input
                  type="number"
                  placeholder="0"
                  value={amountFrom}
                  onChange={(e) => setAmountFrom(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: AXIOM.text.slate400 }}>Amount To</label>
                <input
                  type="number"
                  placeholder="999999"
                  value={amountTo}
                  onChange={(e) => setAmountTo(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                    color: AXIOM.inputs.color,
                  }}
                />
              </div>
              <div className="flex items-end">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="w-full h-10 rounded-xl text-sm font-medium"
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: 'none',
                    color: 'rgba(148, 163, 184, 0.7)',
                  }}
                  onClick={clearFilters}
                >
                  Clear Filters
                </motion.button>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Results Info */}
      {(searchTerm ||
        filterScope !== 'all' ||
        filterType !== 'all' ||
        filterCategory !== 'all' ||
        filterProject !== 'all' ||
        filterStatus !== 'all' ||
        dateFrom ||
        dateTo ||
        amountFrom ||
        amountTo) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between px-4 py-3 rounded-xl"
          style={AXIOM.containers.item}
        >
          <p className="text-sm" style={{ color: AXIOM.text.slate300 }}>
            Showing {filteredTransactions.length} of {allTransactions.length} transactions
          </p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="text-sm flex items-center gap-1"
            style={{ color: AXIOM.text.slate400 }}
            onClick={clearFilters}
          >
            <X className="size-4" />
            Clear all
          </motion.button>
        </motion.div>
      )}

      {/* Transactions Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl overflow-hidden"
        style={AXIOM.containers.list}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                <th className="px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    checked={selectedTransactions.length === sortedTransactions.length && sortedTransactions.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded"
                    style={{
                      accentColor: '#a855f7',
                    }}
                  />
                </th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Date</th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Narration</th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Category</th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Source File</th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Project</th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Account</th>
                <th className="px-4 py-4 text-left text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Scope</th>
                <th className="px-4 py-4 text-right text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Amount</th>
                <th className="px-4 py-4 text-center text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Status</th>
                <th className="px-4 py-4 text-right text-xs font-medium" style={{ color: AXIOM.text.slate400 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {txnLoading && allTransactions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
                    Loading transactions…
                  </td>
                </tr>
              ) : !txnLoading && allTransactions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center">
                    <p className="text-base font-medium text-white">No transactions yet</p>
                    <p className="mt-2 text-sm" style={{ color: AXIOM.text.slate400 }}>
                      Use Quick Add or import a statement to add your first entries.
                    </p>
                  </td>
                </tr>
              ) : sortedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
                    No transactions match these filters. Try clearing or widening the date range.
                  </td>
                </tr>
              ) : (
                sortedTransactions.map((txn, idx) => (
                  <motion.tr
                    key={txn.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 + idx * 0.02 }}
                    className="group"
                    style={{
                      borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                      background: selectedTransactions.includes(txn.id) ? 'rgba(168, 85, 247, 0.05)' : 'transparent',
                    }}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedTransactions.includes(txn.id)}
                        onChange={() => toggleSelectTransaction(txn.id)}
                        className="w-4 h-4 rounded"
                        style={{
                          accentColor: '#a855f7',
                        }}
                      />
                    </td>
                    <td className="px-4 py-4 text-sm" style={{ color: AXIOM.text.slate300 }}>
                      {formatDate(txn.date)}
                    </td>
                    <td className="px-4 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium ${txn.status === 'reversed' ? 'text-slate-400 line-through' : 'text-white'}`}>
                            {txn.narration}
                          </p>
                          {txn.status === 'reversed' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/25 text-red-300 border border-red-500/40 shrink-0">
                              Reversed
                            </span>
                          )}
                          {txn.createdAt && (Date.now() - new Date(txn.createdAt).getTime() < 24 * 3600 * 1000) && txn.status !== 'reversed' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/25 text-purple-300 border border-purple-500/40 shrink-0">
                              New
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {txn.departmentId && (
                            <span className="text-xs" style={{ color: AXIOM.text.slate400 }}>{txn.departmentId}</span>
                          )}
                          {(txn.postedJournalId || txn.journalEntryId) && (
                            <span
                              className="text-[10px] font-mono text-cyan-400/90 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20"
                              title={`General Ledger Journal #${txn.postedJournalId || txn.journalEntryId}`}
                            >
                              GL #{(txn.postedJournalId || txn.journalEntryId)?.slice(-6)}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm" style={{ color: AXIOM.text.slate300 }}>{txn.category}</td>
                    <td className="px-4 py-4">
                      {txn.sourceFileName ? (
                        <div className="flex items-center gap-2">
                          <span 
                            className="px-2 py-1 rounded-lg text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 max-w-xs truncate"
                            title={txn.sourceFileName}
                          >
                            📄 {txn.sourceFileName}
                          </span>
                          {txn.sourceFileType && (
                            <span className="text-xs text-slate-500 uppercase">{txn.sourceFileType}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Manual Entry</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm">
                      {txn.projectName ? (
                        <span className="px-2 py-1 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          {txn.projectName}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm" style={{ color: AXIOM.text.slate300 }}>{txn.accountName}</td>
                    <td className="px-4 py-4">
                      <span 
                        className="px-2 py-1 rounded-lg text-xs font-medium"
                        style={txn.scope === 'business' ? AXIOM.badges.cyan : AXIOM.badges.purple}
                      >
                        {txn.scope}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span 
                        className={`text-sm font-bold font-mono ${txn.status === 'reversed' ? 'line-through opacity-50' : ''}`}
                        style={{
                          color: txn.status === 'reversed'
                            ? '#94a3b8'
                            : txn.type === 'income'
                              ? '#10b981'
                              : '#ef4444'
                        }}
                      >
                        {txn.type === 'income' ? '+' : '-'}
                        {formatCurrency(Math.abs(Number(txn.amount)), txn.currency)}
                      </span>
                      {txn.status === 'reversed' && (
                        <div className="mt-0.5">
                          <span className="text-[10px] font-mono text-red-400 font-medium">
                            [REVERSED]
                          </span>
                          {txn.correctionReason && (
                            <p className="text-[10px] text-slate-400 truncate max-w-[140px] ml-auto italic" title={txn.correctionReason}>
                              {txn.correctionReason}
                            </p>
                          )}
                        </div>
                      )}
                      {txn.status !== 'reversed' && txn.currency && txn.currency !== orgCurrency && (
                        <p className="text-xs text-emerald-400/80 mt-0.5 font-mono">
                          ≈ {formatCurrency(convertCurrency(Math.abs(Number(txn.amount)), txn.currency, orgCurrency, txn.fxRateToBase), orgCurrency)}
                        </p>
                      )}
                      {txn.status !== 'reversed' && txn.originalAmount != null && txn.originalCurrency && txn.originalCurrency !== txn.currency && (
                        <p className="text-xs text-slate-500 mt-0.5 font-mono">
                          orig. {txn.originalCurrency} {Math.abs(Number(txn.originalAmount)).toLocaleString()}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className="rounded-lg px-2 py-1 text-xs font-medium"
                        style={
                          txn.status === 'reversed'
                            ? AXIOM.badges.danger
                            : txn.status === 'posted'
                              ? AXIOM.badges.success
                              : txn.status === 'reconciled'
                                ? AXIOM.badges.success
                                : txn.status === 'reviewed'
                                  ? AXIOM.badges.info
                                  : txn.status === 'classified'
                                    ? AXIOM.badges.cyan
                                    : AXIOM.badges.warning
                        }
                      >
                        {statusLabel(txn.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity pointer-fine:lg:opacity-0 pointer-fine:lg:group-hover:opacity-100">
                        {canEdit && txn.status !== 'reversed' && (
                          <>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              title="Edit Transaction"
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{
                                background: 'rgba(0, 0, 0, 0.2)',
                                color: AXIOM.text.slate400,
                              }}
                              onClick={() => handleEditTransaction(txn)}
                            >
                              <Edit className="size-3" />
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              title="Split Transaction"
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{
                                background: 'rgba(0, 0, 0, 0.2)',
                                color: AXIOM.text.slate400,
                              }}
                              onClick={handleSplitTransaction}
                            >
                              <Split className="size-3" />
                            </motion.button>
                          </>
                        )}
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          title="View History / Audit Trail"
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{
                            background: 'rgba(0, 0, 0, 0.2)',
                            color: AXIOM.text.slate400,
                          }}
                          onClick={() => {
                            setSelectedTransaction(txn);
                            setHistoryDialogOpen(true);
                          }}
                        >
                          <History className="size-3" />
                        </motion.button>

                        {/* Immutability Actions: Reverse for posted; Purge for draft; Indicator for reversed */}
                        {txn.status === 'reversed' ? (
                          <span
                            title={txn.correctionReason ? `Reversed: ${txn.correctionReason}` : 'Transaction already reversed'}
                            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-not-allowed opacity-40 text-slate-500"
                          >
                            <RotateCcw className="size-3" />
                          </span>
                        ) : ['draft', 'pending'].includes(txn.status) ? (
                          canDelete && (
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              title="Purge draft transaction"
                              className="w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-400"
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: 'rgba(239, 68, 68, 0.7)',
                              }}
                              onClick={() => void handleDeleteDraft(txn)}
                            >
                              <Trash2 className="size-3" />
                            </motion.button>
                          )
                        ) : (
                          (canDelete || canEdit) && (
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              title="Reverse transaction (Financial Immutability §8)"
                              className="w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-300"
                              style={{
                                background: 'rgba(239, 68, 68, 0.15)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                color: '#f87171',
                              }}
                              onClick={() => handleInitiateReverse(txn)}
                            >
                              <RotateCcw className="size-3" />
                            </motion.button>
                          )
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent
          className={
            theme === 'light'
              ? 'max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-slate-900'
              : 'max-h-[90vh] overflow-y-auto border-slate-700 bg-slate-950 text-slate-100'
          }
        >
          <DialogHeader>
            <DialogTitle>Edit transaction</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Updates description and project allocation for this transaction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">Description / Narration</label>
              <textarea
                value={editNarration}
                onChange={(e) => setEditNarration(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500/40"
              />
            </div>
            {projects.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Project Allocation</label>
                <select
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
                  className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none"
                >
                  <option value="">No Project (General overhead / unallocated)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.clientName ? `— ${p.clientName}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white"
              onClick={() => setEditDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
              onClick={() => void handleSaveEdit()}
            >
              Save
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditDialogOpen} onOpenChange={setBulkEditDialogOpen}>
        <DialogContent
          className={
            theme === 'light'
              ? 'border-slate-200 bg-white text-slate-900'
              : 'border-slate-700 bg-slate-950 text-slate-100'
          }
        >
          <DialogHeader>
            <DialogTitle>Bulk update</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              {selectedTransactions.length} transaction(s) selected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Category</label>
              <div className="flex gap-2">
                <select
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                  disabled={!categories.length}
                  className="h-11 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white disabled:opacity-50"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50 shrink-0"
                  disabled={!categories.length}
                  onClick={() => void handleApplyBulkCategory()}
                >
                  Apply Category
                </button>
              </div>
            </div>

            {projects.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="text-sm font-medium text-slate-300">Project</label>
                <div className="flex gap-2">
                  <select
                    value={bulkProjectId}
                    onChange={(e) => setBulkProjectId(e.target.value)}
                    className="h-11 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
                  >
                    <option value="">Choose Project…</option>
                    <option value="__none__">Clear Project (Unassign)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.clientName ? `— ${p.clientName}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50 shrink-0"
                    disabled={!bulkProjectId}
                    onClick={() => void handleApplyBulkProject()}
                  >
                    Apply Project
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-4 border-t border-slate-800 sm:flex-row sm:justify-between items-center">
              {(canDelete || canEdit) && (
                <button
                  type="button"
                  className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40 flex items-center gap-1.5"
                  onClick={() => handleBulkAction()}
                >
                  <RotateCcw className="size-3.5" />
                  Reverse / Purge selected
                </button>
              )}
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                onClick={() => setBulkEditDialogOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {historyDialogOpen && selectedTransaction && (
        <TransactionHistoryModal
          transaction={selectedTransaction}
          open={historyDialogOpen}
          onOpenChange={setHistoryDialogOpen}
        />
      )}

      {/* Single Transaction Reversal Modal (Financial Immutability §8, §33) */}
      <Dialog open={reversalDialogOpen} onOpenChange={setReversalDialogOpen}>
        <DialogContent
          className={
            theme === 'light'
              ? 'max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-slate-900 sm:max-w-md'
              : 'max-h-[90vh] overflow-y-auto border-red-500/30 bg-slate-950 text-slate-100 sm:max-w-md'
          }
          style={{
            boxShadow: '0 25px 50px -12px rgba(239, 68, 68, 0.25)',
          }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/20 text-red-400 border border-red-500/40">
                <RotateCcw className="size-4" />
              </div>
              <DialogTitle className="text-lg font-bold text-white">Reverse Transaction</DialogTitle>
            </div>
            <DialogDescription className="text-slate-400 text-xs">
              General Ledger Immutability Protocol (§8, §33). Posted transactions cannot be deleted.
            </DialogDescription>
          </DialogHeader>

          {reversalTargetTxn && (
            <div className="space-y-4">
              {/* Transaction Summary Card */}
              <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Date:</span>
                  <span className="text-white font-mono">{formatDate(reversalTargetTxn.date)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Description:</span>
                  <span className="text-white font-medium truncate max-w-[200px]" title={reversalTargetTxn.narration}>
                    {reversalTargetTxn.narration || reversalTargetTxn.description}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Amount:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {formatCurrency(Math.abs(Number(reversalTargetTxn.amount)), reversalTargetTxn.currency || orgCurrency)} ({reversalTargetTxn.type})
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Current Status:</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">
                    {statusLabel(reversalTargetTxn.status)}
                  </span>
                </div>
                {(reversalTargetTxn.postedJournalId || reversalTargetTxn.journalEntryId) && (
                  <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                    <span className="text-slate-400">GL Journal Entry:</span>
                    <span className="text-cyan-400 font-mono">
                      #{(reversalTargetTxn.postedJournalId || reversalTargetTxn.journalEntryId).slice(-8)}
                    </span>
                  </div>
                )}
              </div>

              {/* Immutability Callout */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex gap-2.5">
                <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                <p>
                  Reversing will mark this transaction as <strong>Reversed</strong> and generate an offsetting counter-entry in the General Ledger. The audit trail remains permanently immutable.
                </p>
              </div>

              {/* Mandatory Reason Input */}
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">
                  Correction Reason <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="e.g. Duplicate statement entry; incorrect payee allocation; customer refund issued..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/40"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Required for compliance (§33 audit log and GAAP/IFRS ledger integrity).
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isReversing}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                  onClick={() => setReversalDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isReversing || !reversalReason.trim()}
                  className="rounded-lg px-4 py-2 text-xs font-bold text-white flex items-center gap-1.5 transition-all disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(185, 28, 28, 0.9))',
                    border: '1px solid rgba(239, 68, 68, 0.6)',
                    boxShadow: '0 4px 15px -3px rgba(239, 68, 68, 0.4)',
                  }}
                  onClick={() => void handleConfirmReverse()}
                >
                  <RotateCcw className={`size-3.5 ${isReversing ? 'animate-spin' : ''}`} />
                  {isReversing ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Reversal & Purge Modal (Financial Immutability §8, §33) */}
      <Dialog open={bulkReversalDialogOpen} onOpenChange={setBulkReversalDialogOpen}>
        <DialogContent
          className={
            theme === 'light'
              ? 'max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-slate-900 sm:max-w-md'
              : 'max-h-[90vh] overflow-y-auto border-red-500/30 bg-slate-950 text-slate-100 sm:max-w-md'
          }
          style={{
            boxShadow: '0 25px 50px -12px rgba(239, 68, 68, 0.25)',
          }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/20 text-red-400 border border-red-500/40">
                <RotateCcw className="size-4" />
              </div>
              <DialogTitle className="text-lg font-bold text-white">Bulk Reversal & Purge</DialogTitle>
            </div>
            <DialogDescription className="text-slate-400 text-xs">
              Reversing {selectedTransactions.length} selected transaction(s) under Financial Immutability (§8, §33).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex gap-2.5">
              <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">Strict Immutability Rule:</p>
                <p>
                  Posted and reconciled transactions cannot be deleted. They will be marked as <strong>Reversed</strong> and offsetting reversal entries will be created in the General Ledger. Any unposted drafts will be cleanly purged.
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1.5">
                Bulk Correction Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={3}
                value={bulkReversalReason}
                onChange={(e) => setBulkReversalReason(e.target.value)}
                placeholder="e.g. Batch statement reversal; imported wrong bank account file; reconciliation adjustments..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/40"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isBulkReversing}
                className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                onClick={() => setBulkReversalDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBulkReversing || !bulkReversalReason.trim()}
                className="rounded-lg px-4 py-2 text-xs font-bold text-white flex items-center gap-1.5 transition-all disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(185, 28, 28, 0.9))',
                  border: '1px solid rgba(239, 68, 68, 0.6)',
                  boxShadow: '0 4px 15px -3px rgba(239, 68, 68, 0.4)',
                }}
                onClick={() => void handleConfirmBulkReverse()}
              >
                <RotateCcw className={`size-3.5 ${isBulkReversing ? 'animate-spin' : ''}`} />
                {isBulkReversing ? 'Reversing...' : `Reverse & Purge (${selectedTransactions.length})`}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}