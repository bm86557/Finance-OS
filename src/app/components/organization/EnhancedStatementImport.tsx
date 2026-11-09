import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { useTheme } from '@/contexts/ThemeContext';
import { AXIOM } from '@/styles/axiom-tokens';
import { apiPostJson } from '@/lib/apiClient';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Trash2,
  ArrowRight,
  Sparkles,
  Loader2,
  FileSpreadsheet,
  Building2,
  Database,
  Download,
  Search,
  HardDrive,
  RefreshCw,
  FolderArchive,
  Calendar,
  Layers,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Check,
  Tag,
  Filter,
  CheckSquare,
  Square,
  BookmarkPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ImportHistoryRecord } from '@/services/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  parseCSVFile,
  autoDetectColumnMapping,
  processCSVData,
  findDuplicates,
  calculateImportStats,
  type ImportedTransaction,
  type ColumnMapping,
  columnKeyFromIndex,
} from '@/lib/importUtils';
import {
  parsePdfFileToGrid,
  extractPdfPlainTextPreview,
  pdfTextStats,
} from '@/lib/pdfStatementImport';

/** Sample CSV for instant smoke testing and demo */
const SAMPLE_STATEMENT_CSV = `Date,Description,Debit,Credit,Balance
2026-03-01,STRIPE PAYOUT - CLIENT RETAINER,,12500.00,12500.00
2026-03-02,AWS CLOUD HOSTING SERVICES,450.00,,12050.00
2026-03-04,GITHUB ENTERPRISE SUBSCRIPTION,84.00,,11966.00
2026-03-05,ACME CORP CONSULTING INVOICE #1092,,8200.00,20166.00
2026-03-08,GOOGLE WORKSPACE APPS,72.00,,20094.00
2026-03-10,OFFICE RENT LEASE MARCH 2026,2400.00,,17694.00
2026-03-12,SLACK BUSINESS+ ANNUAL,360.00,,17334.00
2026-03-15,DIRECT DEPOSIT PAYROLL BATCH,7500.00,,9834.00
2026-03-18,CLIENT INVOICE WIRE TRANSFER,,15000.00,24834.00
2026-03-20,DELTA AIRLINES - TEAM RETREAT,1240.00,,23594.00
2026-03-22,ZOOM VIDEO COMMUNICATIONS,35.00,,23559.00
2026-03-25,APPLE STORE HARDWARE UPGRADE,2899.00,,20660.00
2026-03-28,INTERNET FIBER UTILITIES,150.00,,20510.00
2026-03-30,TAX REFUND DEPOSIT,,1420.00,21930.00`;

const IMPORT_CURRENCY_OPTIONS = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'] as const;

type ImportStep = 'upload' | 'mapping' | 'review' | 'complete';
type MainTab = 'wizard' | 'records';
export type ReviewTier = 'all' | 'tier1' | 'tier2' | 'tier3';

export interface GroupedExceptionState {
  vendorToken: string;
  selectedCategoryId: string;
  createRule: boolean;
  isConfirmed: boolean;
}

export function extractVendorToken(narration: string): string {
  if (!narration) return 'UNKNOWN';
  const clean = narration
    .replace(/\b(POS|PURCHASE|DEBIT|CREDIT|CARD|RECURRING|PAYMENT|TRANSFER|DIRECT DEPOSIT|ACH|WIRE|ATM|WITHDRAWAL|TXN|REF#?[\d\w]+)\b/gi, '')
    .replace(/[0-9]{2,}/g, '')
    .replace(/[*#\-_/:.]+/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) {
    const fallback = narration.split(/[\s,*\-_/]+/)[0] || 'UNKNOWN';
    return fallback.slice(0, 20).toUpperCase();
  }
  return words.slice(0, 2).join(' ').toUpperCase();
}

export function EnhancedStatementImport({
  embedded = false,
}: {
  /** Compact layout for dashboard modal */
  embedded?: boolean;
} = {}) {
  const { theme } = useTheme();
  const [mainTab, setMainTab] = useState<MainTab>('wizard');
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  /** Empty = use selected bank account currency */
  const [importCurrencyOverride, setImportCurrencyOverride] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    date: '',
    amount: '',
    narration: '',
    amountMode: 'single',
  });
  const [parsedTransactions, setParsedTransactions] = useState<ImportedTransaction[]>([]);
  const [filterDuplicates, setFilterDuplicates] = useState(false); // Changed to false so duplicates show by default
  const [searchQuery, setSearchQuery] = useState('');
  const [lastImportedCount, setLastImportedCount] = useState(0);
  const [reviewMode, setReviewMode] = useState<'tiers' | 'step' | 'list'>('tiers');
  const [reviewStepIndex, setReviewStepIndex] = useState(0);

  // 3-Tier Exception Review Queue state
  const [selectedTier, setSelectedTier] = useState<ReviewTier>('all');
  const [groupOverrides, setGroupOverrides] = useState<Record<string, GroupedExceptionState>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewCompleted, setReviewCompleted] = useState(false);

  // Stored Records & History states
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'csv' | 'pdf'>('all');
  const [historyAccountFilter, setHistoryAccountFilter] = useState<string>('all');
  const [selectedRecordDetails, setSelectedRecordDetails] = useState<ImportHistoryRecord | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const svc = useOrgServices();

  // Bank accounts for account selector
  const { data: bankAccounts } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts', 'transactions']
  );

  const { data: categories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories']
  );

  const { data: projects } = useServiceArray(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects']
  );

  // Stored statement records from Supabase
  const { data: importHistory, refetch: refetchHistory, loading: loadingHistory, error: historyError } = useServiceArray(
    () => svc.imports.getHistory(),
    [svc.orgId],
    ['importHistory', 'transactions']
  );

  // Existing transactions for duplicate detection
  const { data: txnResult, refetch: refetchTransactions } = useService(
    () => svc.transactions.getAll({ pageSize: 1000 }),
    [svc.orgId],
    ['transactions']
  );
  const existingTransactions = txnResult?.items ?? [];

  useEffect(() => {
    if (bankAccounts.length > 0 && !selectedAccount) {
      setSelectedAccount(bankAccounts[0].id);
    }
  }, [bankAccounts, selectedAccount]);

  // Drag and drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleFileSelected = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith('.csv');
    const isPdf = name.endsWith('.pdf');
    if (!isCsv && !isPdf) {
      toast.error('Please use a CSV or PDF bank statement');
      return;
    }

    setSelectedFile(file);
    setProcessing(true);

    try {
      let data: string[][];

      if (isPdf) {
        data = await parsePdfFileToGrid(file);
        if (!data.length || data.length < 2) {
          let stats = { lineCount: 0, charCount: 0 };
          try {
            stats = await pdfTextStats(file);
            const preview = await extractPdfPlainTextPreview(file, 500);
            console.warn('[Statement import] PDF read stats:', stats, '\nPreview:\n', preview);
          } catch {
            /* ignore */
          }
          const noText = stats.charCount < 20;
          toast.error('No transactions found in this PDF', {
            description: noText
              ? 'This file has almost no selectable text — it may be a scanned image. Export CSV from your bank, or use a PDF with copy-pasteable text.'
              : `We extracted about ${stats.lineCount} lines but could not match date + amount rows. Try CSV export, or another PDF from your bank.`,
          });
          setProcessing(false);
          return;
        }
      } else {
        data = await parseCSVFile(file);
        if (!data.length) {
          toast.error('This file looks empty. Export again as CSV (UTF-8) from your bank or Excel.');
          setProcessing(false);
          return;
        }
      }

      const headers = data[0];
      if (!headers?.length) {
        toast.error(
          isPdf
            ? 'Could not build columns from this PDF. Try CSV instead.'
            : 'Could not read column headers. Check the file is a comma or semicolon CSV.'
        );
        setProcessing(false);
        return;
      }

      setCsvHeaders(headers);
      setCsvData(data);

      const detectedMapping = autoDetectColumnMapping(headers);
      setColumnMapping(detectedMapping);

      setCurrentStep('mapping');
      toast.success(isPdf ? 'PDF text extracted — review column mapping' : 'File parsed successfully!');
    } catch (error) {
      console.error('Error parsing file:', error);
      toast.error(
        name.endsWith('.pdf')
          ? 'Could not read this PDF. Try another file or export CSV from your bank.'
          : 'Failed to parse file. Try UTF-8 CSV with a header row.'
      );
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const files = Array.from(e.dataTransfer.files);
      const file = files[0];

      const n = file?.name.toLowerCase() ?? '';
      if (file && (n.endsWith('.csv') || n.endsWith('.pdf'))) {
        await handleFileSelected(file);
      } else {
        toast.error('Please upload a CSV or PDF file');
      }
    },
    [handleFileSelected]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void handleFileSelected(file);
    }
  };

  const mappingIsComplete = useMemo(() => {
    if (!columnMapping.date?.trim() || !columnMapping.narration?.trim()) return false;
    if (columnMapping.amountMode === 'debit_credit') {
      return !!(columnMapping.debit?.trim() && columnMapping.credit?.trim());
    }
    return !!columnMapping.amount?.trim();
  }, [columnMapping]);

  const selectedBankAccount = useMemo(
    () => bankAccounts.find(a => a.id === selectedAccount),
    [bankAccounts, selectedAccount]
  );

  const resolvedImportCurrency = useMemo(() => {
    const o = importCurrencyOverride.trim().toUpperCase();
    if (o) return o;
    return (selectedBankAccount?.currency || 'USD').toUpperCase();
  }, [importCurrencyOverride, selectedBankAccount?.currency]);

  const handleProceedToReview = async () => {
    if (bankAccounts.length === 0) {
      toast.error('Add a bank account or wallet before importing.');
      return;
    }
    if (!selectedAccount) {
      toast.error('Choose which bank account this statement is for');
      return;
    }
    if (!mappingIsComplete) {
      toast.error(
        columnMapping.amountMode === 'debit_credit'
          ? 'Please map date, description, debit column, and credit column'
          : 'Please map date, amount, and description columns'
      );
      return;
    }

    setProcessing(true);

    try {
      // Process CSV data
      const transactions = processCSVData(csvData, columnMapping, csvHeaders);

      // Detect duplicates (ledger rows may omit fields — handled in importUtils)
      findDuplicates(transactions, existingTransactions);

      // Try to classify with AI (don't fail import if this fails)
      try {
        const batchPayload = transactions.map(t => ({
          narration: t.narration,
          amount: t.amount,
          type: t.type,
        }));
        
        console.log('[import] Batch payload:', batchPayload.length, 'transactions');
        console.log('[import] First transaction:', batchPayload[0]);
        console.log('[import] Calling batchClassify with useAI: true');
        
        // Don't pass orgId - the wrapper already adds it!
        const classRes = await svc.classification.batchClassify(batchPayload, true);
        
        console.log('[import] Batch classification result:', classRes.success ? 'success' : 'failed', classRes.error);
        
        if (classRes.success && classRes.data) {
          console.log('[import] Batch classification succeeded, applying suggestions to all rows');
          transactions.forEach((txn, i) => {
            const r = classRes.data!.get(i);
            if (r) {
              txn.confidence = r.confidence;
              txn.suggestedCategory = r.categoryName;
              txn.category = r.categoryName;
              txn.classificationSource = r.source === 'ai' ? 'ai' : 'rules'; // Store the source
              
              // Always auto-apply category if available so no transaction remains uncategorized
              if (r.categoryId) {
                txn.importCategoryId = r.categoryId;
                console.log(`[import] Auto-applied category "${r.categoryName}" (${r.confidence}%) via ${r.source || 'ai'} to: ${txn.narration.substring(0, 50)}`);
              }
            }
          });
        } else {
          console.warn('[import] Batch classification failed:', classRes.error);
        }
      } catch (classError) {
        console.error('[import] Classification error (continuing without it):', classError);
        // Continue without classification
      }

      setParsedTransactions(
        transactions.map(t => ({ ...t, usage: t.usage ?? 'business' }))
      );
      setReviewStepIndex(0);
      setReviewMode('tiers');
      setCurrentStep('review');
      toast.success(`Parsed ${transactions.length} rows — review each below`);
    } catch (e) {
      console.error(e);
      toast.error('Could not prepare review step');
    } finally {
      setProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!selectedAccount || !selectedFile) {
      toast.error('Choose a bank account and file first');
      return;
    }

    const account = bankAccounts.find(a => a.id === selectedAccount);
    if (!account) {
      toast.error('Bank account not found');
      return;
    }

    const rowsToCommit = parsedTransactions
      .filter(txn => {
        if (filterDuplicates && txn.isDuplicate) return false;
        if (searchQuery && !txn.narration.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        return true;
      })
      .map(t => {
        let catId = t.importCategoryId;
        if (!catId && (t.suggestedCategory || t.category)) {
          const catName = (t.suggestedCategory || t.category || '').trim().toLowerCase();
          const match = categories.find(c => c.name.trim().toLowerCase() === catName)
            || categories.find(c => c.name.toLowerCase().includes(catName) || catName.includes(c.name.toLowerCase()));
          if (match) catId = match.id;
        }
        return {
          ...t,
          importCategoryId: catId,
        };
      });

    if (rowsToCommit.length === 0) {
      toast.error('No rows to import. Adjust filters or mapping.');
      return;
    }

    // Ensure 3-tier exception review decisions and rule learning are submitted prior to final commit
    if (!reviewCompleted) {
      await handleSubmitBulkReview(false);
    }

    setProcessing(true);

    // Read file contents for database record storage
    let fileContent: string | undefined = undefined;
    try {
      if (selectedFile.size < 5 * 1024 * 1024) {
        if (selectedFile.name.toLowerCase().endsWith('.csv')) {
          fileContent = await selectedFile.text();
        } else {
          const buffer = await selectedFile.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          fileContent = `data:application/pdf;base64,${btoa(binary)}`;
        }
      }
    } catch {
      /* ignore file reading errors */
    }

    let statementAccountHint: string | undefined = undefined;
    if (fileContent && typeof fileContent === 'string') {
      const snippet = fileContent.slice(0, 3000);
      const m = snippet.match(/(?:account\s*(?:no|number|#)?|a\/c\s*(?:no|#)?|acct|iban)\s*[:#-]?\s*([A-Za-z0-9_-]{4,34})/i);
      if (m && m[1]) {
        statementAccountHint = m[1].trim();
      }
    }

    // Generate idempotency key to prevent duplicate imports
    const firstDate = rowsToCommit[0]?.date || new Date().toISOString().split('T')[0];
    const idempotencyKey = `import-${selectedAccount}-${selectedFile.name}-${rowsToCommit.length}-${firstDate}-${Date.now()}`;

    // DEBUG: Log what we're sending
    console.log('=== IMPORT DEBUG ===');
    console.log('svc.orgId:', svc.orgId);
    console.log('selectedAccount:', selectedAccount);
    console.log('selectedAccount type:', typeof selectedAccount);
    console.log('resolvedImportCurrency:', resolvedImportCurrency);
    console.log('selectedFile.name:', selectedFile.name);
    console.log('rowsToCommit length:', rowsToCommit.length);
    console.log('rowsToCommit[0]:', rowsToCommit[0]);
    console.log('Arguments in order will be:');
    console.log('1. organizationId:', svc.orgId);
    console.log('2. bankAccountId:', selectedAccount);
    console.log('3. currency:', resolvedImportCurrency);
    console.log('4. fileName:', selectedFile.name);
    console.log('5. rows (array of', rowsToCommit.length, ')');
    console.log('===================');

    // The wrapper already adds orgId, so we don't pass it!
    const res = await svc.imports.commitParsedImport(
      selectedAccount,  // bankAccountId (wrapper adds orgId first)
      resolvedImportCurrency,  // currency
      selectedFile.name,  // fileName
      rowsToCommit,  // rows
{
      skipDuplicates: false,
      autoClassify: true,
      fileSize: selectedFile.size,
      fileContent,
      statementAccountHint,
      idempotencyKey,
    } as {
      skipDuplicates?: boolean;
      autoClassify?: boolean;
      fileSize?: number;
      fileContent?: string;
      idempotencyKey?: string;
    }
    );

    setProcessing(false);

    if (!res.success || !res.data) {
      if (res.error?.includes('ACCOUNT_MISMATCH')) {
        const proceed = window.confirm(`${res.error}\n\nDo you want to proceed and import into this account anyway?`);
        if (proceed) {
          setProcessing(true);
          const retryRes = await svc.imports.commitParsedImport(
            selectedAccount,
            resolvedImportCurrency,
            selectedFile.name,
            rowsToCommit,
            {
              skipDuplicates: false,
              autoClassify: true,
              fileSize: selectedFile.size,
              fileContent,
              statementAccountHint,
              confirmAccountMismatch: true,
              idempotencyKey: `${idempotencyKey}-override`,
            } as any
          );
          setProcessing(false);
          if (retryRes.success && retryRes.data) {
            setLastImportedCount(retryRes.data.imported || rowsToCommit.length);
            setCurrentStep('complete');
            await refetchTransactions();
            await refetchHistory();
            toast.success(retryRes.message || 'Import completed and saved');
            return;
          }
        }
      }
      toast.error(res.error || 'Import failed');
      return;
    }

    setLastImportedCount(res.data.imported);
    setCurrentStep('complete');
    await refetchTransactions();
    await refetchHistory();
    toast.success(res.message || 'Import completed and saved to Supabase database');
  };

  const triggerDownload = (href: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  const handleDownloadStoredFile = async (rec: ImportHistoryRecord) => {
    if (rec.fileUrl) {
      triggerDownload(rec.fileUrl, rec.fileName);
      toast.success(`Downloading ${rec.fileName}`);
      return;
    }

    if (rec.fileContent) {
      if (rec.fileContent.startsWith('data:')) {
        triggerDownload(rec.fileContent, rec.fileName);
        toast.success(`Downloaded ${rec.fileName}`);
        return;
      }
      const blob = new Blob([rec.fileContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, rec.fileName);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${rec.fileName}`);
      return;
    }

    try {
      const { apiGet } = await import('@/lib/apiClient');
      const fileRes = await apiGet<{ url: string; fileName: string }>(
        `/organizations/${encodeURIComponent(svc.orgId)}/imports/history/${encodeURIComponent(rec.id)}/file`,
      );
      if (fileRes.success && fileRes.data?.url) {
        triggerDownload(fileRes.data.url, fileRes.data.fileName || rec.fileName);
        toast.success(`Downloading ${rec.fileName}`);
        return;
      }
    } catch {
      /* fall through to ledger export */
    }

    const safeTag = `import:${rec.fileName.slice(0, 80)}`;
    const matchedTxns = existingTransactions.filter(t => t.tags.includes(safeTag) || t.tags.includes(`import:${rec.fileName}`));
    if (matchedTxns.length > 0) {
      const header = 'Date,Description,Amount,Type,Currency,Status';
      const rows = matchedTxns.map(t => `"${t.date}","${(t.narration || t.description).replace(/"/g, '""')}",${t.amount},"${t.type}","${t.currency}","${t.status}"`);
      const csvStr = [header, ...rows].join('\n');
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, rec.fileName.endsWith('.csv') ? rec.fileName : `${rec.fileName}.csv`);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${matchedTxns.length} records for ${rec.fileName}`);
      return;
    }

    toast.error('Original statement file could not be retrieved from storage.');
  };

  const handleDeleteHistoryRecord = async (id: string) => {
    if (!window.confirm('Delete this statement import record from database? (Existing transactions will remain in ledger)')) return;
    setDeletingRecordId(id);
    try {
      const res = await svc.imports.deleteHistory(id);
      if (res.success) {
        toast.success('Statement record deleted from database');
        await refetchHistory();
      } else {
        toast.error(res.error || 'Could not delete record');
      }
    } finally {
      setDeletingRecordId(null);
    }
  };

  const loadSampleCsv = async () => {
    if (bankAccounts.length > 0 && !selectedAccount) {
      setSelectedAccount(bankAccounts[0].id);
    }

    const blob = new Blob([SAMPLE_STATEMENT_CSV], { type: 'text/csv' });
    const file = new File([blob], 'sample-statement.csv', { type: 'text/csv' });
    await handleFileSelected(file);
  };

  const stats = calculateImportStats(parsedTransactions);

  const patchTransaction = useCallback((id: string, patch: Partial<ImportedTransaction>) => {
    setParsedTransactions(prev =>
      prev.map(t => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  const filteredTransactions = parsedTransactions.filter(txn => {
    if (filterDuplicates && txn.isDuplicate) return false;
    if (searchQuery && !txn.narration.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (filteredTransactions.length === 0) {
      setReviewStepIndex(0);
      return;
    }
    setReviewStepIndex(i => (i >= filteredTransactions.length ? filteredTransactions.length - 1 : i));
  }, [filteredTransactions.length]);

  const focusedTxn = filteredTransactions[reviewStepIndex] ?? null;

  // ── 3-Tier Exception Review Queue Partitioning ──────────────────────────────
  const { tier1List, tier2Groups, tier3List, allVendorTokens } = useMemo(() => {
    const t1: ImportedTransaction[] = [];
    const t2Candidates: ImportedTransaction[] = [];
    const t3: ImportedTransaction[] = [];

    // Grouping map for Tier 2 candidates
    const vendorMap: Record<string, {
      groupKey: string;
      vendorToken: string;
      transactions: ImportedTransaction[];
      suggestedCategoryId: string;
      suggestedCategoryName: string;
      confidence: number;
    }> = {};

    for (const t of filteredTransactions) {
      const conf = t.confidence ?? (t.classificationSource === 'rules' ? 95 : t.classificationSource === 'ai' ? 85 : 0);
      const hasAssignedCategory = Boolean(t.importCategoryId || t.suggestedCategory || t.category);

      // Tier 1: High confidence auto-accepted (confidence >= 80)
      if (conf >= 80 && hasAssignedCategory) {
        t1.push(t);
      } else if (conf >= 40 || t.suggestedCategory) {
        // Tier 2: Grouped exceptions (common vendor tokens, medium confidence 40-79%)
        t2Candidates.push(t);
      } else {
        // Tier 3: Low-confidence / manual review (< 40% or completely missing category)
        t3.push(t);
      }
    }

    // Organize Tier 2 candidates into grouped exceptions by normalized vendor token
    for (const t of t2Candidates) {
      const token = extractVendorToken(t.narration);
      if (!vendorMap[token]) {
        let catId = t.importCategoryId || '';
        let catName = t.suggestedCategory || t.category || '';
        if (!catId && catName) {
          const match = categories.find(c => c.name.toLowerCase() === catName.toLowerCase())
            || categories.find(c => c.name.toLowerCase().includes(catName.toLowerCase()));
          if (match) catId = match.id;
        }
        if (!catId && categories.length > 0) {
          const expectedType = t.type === 'credit' ? 'income' : 'expense';
          const match = categories.find(c => c.type === expectedType) || categories[0];
          catId = match.id;
          catName = match.name;
        }

        vendorMap[token] = {
          groupKey: token,
          vendorToken: token,
          transactions: [],
          suggestedCategoryId: catId,
          suggestedCategoryName: catName,
          confidence: t.confidence ?? 65,
        };
      }
      vendorMap[token].transactions.push(t);
    }

    return {
      tier1List: t1,
      tier2Groups: Object.values(vendorMap),
      tier3List: t3,
      allVendorTokens: Object.keys(vendorMap),
    };
  }, [filteredTransactions, categories]);

  // Group confirmation / override handlers
  const handleGroupCategoryChange = useCallback((token: string, categoryId: string) => {
    setGroupOverrides(prev => ({
      ...prev,
      [token]: {
        vendorToken: token,
        selectedCategoryId: categoryId,
        createRule: prev[token]?.createRule ?? true,
        isConfirmed: true,
      },
    }));

    // Update matching transactions in parsedTransactions
    setParsedTransactions(prev =>
      prev.map(t => {
        if (extractVendorToken(t.narration) === token) {
          const cat = categories.find(c => c.id === categoryId);
          return {
            ...t,
            importCategoryId: categoryId,
            suggestedCategory: cat?.name || t.suggestedCategory,
            category: cat?.name || t.category,
          };
        }
        return t;
      })
    );
  }, [categories]);

  const handleGroupRuleToggle = useCallback((token: string, createRule: boolean) => {
    setGroupOverrides(prev => ({
      ...prev,
      [token]: {
        vendorToken: token,
        selectedCategoryId: prev[token]?.selectedCategoryId || '',
        createRule,
        isConfirmed: prev[token]?.isConfirmed ?? false,
      },
    }));
  }, []);

  const handleConfirmGroup = useCallback((token: string) => {
    const group = tier2Groups.find(g => g.vendorToken === token);
    const chosenCatId = groupOverrides[token]?.selectedCategoryId || group?.suggestedCategoryId || categories[0]?.id || '';
    
    setGroupOverrides(prev => ({
      ...prev,
      [token]: {
        vendorToken: token,
        selectedCategoryId: chosenCatId,
        createRule: prev[token]?.createRule ?? true,
        isConfirmed: true,
      },
    }));

    // Apply category to all transactions in group
    setParsedTransactions(prev =>
      prev.map(t => {
        if (extractVendorToken(t.narration) === token) {
          const cat = categories.find(c => c.id === chosenCatId);
          return {
            ...t,
            importCategoryId: chosenCatId,
            category: cat?.name || t.category,
          };
        }
        return t;
      })
    );
    toast.success(`Group "${token}" confirmed with category`);
  }, [tier2Groups, groupOverrides, categories]);

  const toggleGroupExpanded = useCallback((token: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [token]: !prev[token],
    }));
  }, []);

  // Submit bulk review decisions to POST /api/v1/organizations/:organizationId/classification/bulk-review
  const handleSubmitBulkReview = useCallback(async (notify: boolean = true) => {
    if (reviewSubmitting) return;
    setReviewSubmitting(true);

    try {
      const decisions: Array<{
        transactionId: string;
        action: 'accept' | 'override';
        categoryId: string;
        createRule: boolean;
      }> = [];

      // 1. Tier 1 decisions
      for (const t of tier1List) {
        decisions.push({
          transactionId: t.id,
          action: 'accept',
          categoryId: t.importCategoryId || '',
          createRule: false,
        });
      }

      // 2. Tier 2 decisions and rule creation
      for (const group of tier2Groups) {
        const state = groupOverrides[group.vendorToken];
        const categoryId = state?.selectedCategoryId || group.suggestedCategoryId;
        const createRule = state?.createRule ?? true;
        const isOverride = categoryId !== group.suggestedCategoryId;

        for (const t of group.transactions) {
          decisions.push({
            transactionId: t.id,
            action: isOverride ? 'override' : 'accept',
            categoryId,
            createRule,
          });
        }

        // If createRule is true, persist rule to organization classification rules
        if (createRule && categoryId) {
          try {
            await svc.classification.addRule({
              pattern: group.vendorToken,
              categoryId,
              confidence: 95,
              matchCount: group.transactions.length,
              createdFrom: 'user',
              lastUsed: new Date().toISOString(),
            });
          } catch (ruleErr) {
            console.warn('[bulk-review] Failed to create rule for token:', group.vendorToken, ruleErr);
          }
        }
      }

      // 3. Tier 3 decisions
      for (const t of tier3List) {
        decisions.push({
          transactionId: t.id,
          action: 'override',
          categoryId: t.importCategoryId || categories[0]?.id || '',
          createRule: false,
        });
      }

      // 4. Submit to POST /api/v1/organizations/:organizationId/classification/bulk-review
      if (svc.orgId) {
        try {
          const res = await apiPostJson<{ decisions: typeof decisions }, { processedCount: number; rulesCreated: number }>(
            `/organizations/${encodeURIComponent(svc.orgId)}/classification/bulk-review`,
            { decisions }
          );
          if (res.success) {
            console.log('[bulk-review] Server bulk-review succeeded:', res.data);
          } else {
            console.warn('[bulk-review] Server bulk-review route response:', res.error);
          }
        } catch (apiErr) {
          console.warn('[bulk-review] Server bulk-review call caught:', apiErr);
        }
      }

      // Ensure all group decisions are applied to parsedTransactions
      setParsedTransactions(prev =>
        prev.map(t => {
          const token = extractVendorToken(t.narration);
          const state = groupOverrides[token];
          if (state?.selectedCategoryId) {
            return {
              ...t,
              importCategoryId: state.selectedCategoryId,
            };
          }
          return t;
        })
      );

      setReviewCompleted(true);
      if (notify) {
        toast.success(`Reviewed ${decisions.length} transactions across 3 tiers. Ready to commit.`);
      }
    } catch (e: any) {
      console.error('[bulk-review] Error submitting bulk review:', e);
      if (notify) {
        toast.error('Failed to submit review decisions: ' + (e.message || 'Unknown error'));
      }
    } finally {
      setReviewSubmitting(false);
    }
  }, [reviewSubmitting, tier1List, tier2Groups, tier3List, groupOverrides, svc.orgId, svc.classification, categories]);

  const stepIndex = ['upload', 'mapping', 'review', 'complete'].indexOf(currentStep);

  const resetImport = useCallback(() => {
    setCurrentStep('upload');
    setSelectedFile(null);
    setParsedTransactions([]);
    setSelectedAccount('');
    setLastImportedCount(0);
    setCsvHeaders([]);
    setCsvData([]);
    setColumnMapping({ date: '', amount: '', narration: '', amountMode: 'single' });
    setImportCurrencyOverride('');
    setSearchQuery('');
    setFilterDuplicates(true);
  }, []);

  const handleNewImport = useCallback(() => {
    resetImport();
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }, [resetImport]);

  const canNavigateTo = useCallback(
    (step: ImportStep): boolean => {
      switch (step) {
        case 'upload':
          return true;
        case 'mapping':
          return csvData.length > 0 && csvHeaders.length > 0;
        case 'review':
          return parsedTransactions.length > 0;
        case 'complete':
          return currentStep === 'complete' || lastImportedCount > 0;
        default:
          return false;
      }
    },
    [csvData.length, csvHeaders.length, parsedTransactions.length, currentStep, lastImportedCount]
  );

  const goToStep = useCallback(
    (step: ImportStep) => {
      if (!canNavigateTo(step)) return;
      setCurrentStep(step);
    },
    [canNavigateTo]
  );

  /** Upload step: go to upload screen and open the same file dialog as the drop zone */
  const handleUploadStepClick = useCallback(() => {
    setCurrentStep('upload');
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }, []);

  const filteredHistory = useMemo(() => {
    return importHistory.filter((rec) => {
      if (historyTypeFilter !== 'all') {
        const isPdf = rec.fileName.toLowerCase().endsWith('.pdf');
        if (historyTypeFilter === 'pdf' && !isPdf) return false;
        if (historyTypeFilter === 'csv' && isPdf) return false;
      }
      if (historyAccountFilter !== 'all') {
        if (rec.accountName !== historyAccountFilter && rec.bankAccountId !== historyAccountFilter) {
          return false;
        }
      }
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase();
        return (
          rec.fileName.toLowerCase().includes(q) ||
          rec.accountName.toLowerCase().includes(q) ||
          rec.status.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [importHistory, historyTypeFilter, historyAccountFilter, historySearch]);

  const historyStats = useMemo(() => {
    const totalStatements = importHistory.length;
    const csvCount = importHistory.filter(r => !r.fileName.toLowerCase().endsWith('.pdf')).length;
    const pdfCount = importHistory.filter(r => r.fileName.toLowerCase().endsWith('.pdf')).length;
    const totalTransactions = importHistory.reduce((s, r) => s + (r.transactionCount || 0), 0);
    const totalAutoClassified = importHistory.reduce((s, r) => s + (r.autoPlaced || 0), 0);
    return { totalStatements, csvCount, pdfCount, totalTransactions, totalAutoClassified };
  }, [importHistory]);

  return (
    <div
      className={embedded ? 'space-y-4' : 'min-h-screen p-8 space-y-6'}
      style={embedded ? undefined : { background: AXIOM.backgrounds.main }}
    >
      {/* Header */}
      {!embedded && (
        <motion.div {...AXIOM.animations.fadeInTop}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                className="p-3 rounded-xl flex items-center justify-center"
                style={{
                  background: AXIOM.iconBoxes.cyan,
                  boxShadow: AXIOM.shadows.iconCyan,
                }}
              >
                <FileSpreadsheet className="size-6 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                  Enhanced Statement Import
                </h1>
                <p className="text-slate-400 text-sm">
                  Import and auto-classify bank statements with smart detection
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMainTab('records')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  mainTab === 'records'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-300 hover:text-white bg-slate-900 border border-slate-700'
                }`}
              >
                <Database className="size-4 text-emerald-400" />
                Stored Statements &amp; Records ({importHistory.length})
              </button>
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
                type="button"
                onClick={() => {
                  setMainTab('wizard');
                  handleNewImport();
                }}
              >
                <Upload className="size-4" />
                New Import
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Main Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-900/80 border border-slate-800">
          <button
            type="button"
            onClick={() => setMainTab('wizard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mainTab === 'wizard'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Sparkles className="size-4 text-cyan-400" />
            Import Wizard
          </button>
          <button
            type="button"
            onClick={() => setMainTab('records')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mainTab === 'records'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Database className="size-4 text-emerald-400" />
            Stored Statements &amp; Records
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {importHistory.length}
            </span>
          </button>
        </div>

        {mainTab === 'records' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Synced with Supabase database (import_history_records)
            </span>
          </div>
        )}
      </div>

      {mainTab === 'wizard' ? (
        <>
      {embedded && (
        <div className="flex justify-end">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border border-slate-600 text-slate-200 hover:bg-slate-800/80"
            onClick={handleNewImport}
          >
            <Upload className="size-3.5" />
            Start over
          </motion.button>
        </div>
      )}

      {/* Progress Steps */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={`flex items-center gap-3 ${embedded ? 'overflow-x-auto pb-1 -mx-1 px-1' : ''}`}
      >
        {[
          { id: 'upload', label: 'Upload File', icon: Upload },
          { id: 'mapping', label: 'Column Mapping', icon: FileText },
          { id: 'review', label: 'Review & Classify', icon: Eye },
          { id: 'complete', label: 'Complete', icon: CheckCircle2 },
        ].map((step, index) => {
          const Icon = step.icon;
          const stepId = step.id as ImportStep;
          const isActive = currentStep === step.id;
          const isCompleted = stepIndex > index;
          const navigable = canNavigateTo(stepId);
          const isUpload = step.id === 'upload';

          return (
            <div key={step.id} className="flex items-center flex-1">
              <motion.button
                type="button"
                whileHover={navigable || isUpload ? { scale: 1.02 } : undefined}
                onClick={() => {
                  if (isUpload) {
                    handleUploadStepClick();
                  } else {
                    goToStep(stepId);
                  }
                }}
                disabled={!isUpload && !navigable}
                title={
                  isUpload
                    ? 'Choose CSV or PDF'
                    : !navigable
                      ? 'Complete the previous step first'
                      : `Go to ${step.label}`
                }
                className="flex items-center gap-3 px-4 py-3 rounded-xl flex-1 transition-all text-left w-full disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
                style={{
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))'
                    : isCompleted
                      ? 'rgba(16, 185, 129, 0.1)'
                      : AXIOM.containers.item.background,
                  border: isActive
                    ? '1px solid rgba(6, 182, 212, 0.5)'
                    : isCompleted
                      ? '1px solid rgba(16, 185, 129, 0.3)'
                      : AXIOM.containers.item.border,
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: isActive
                      ? AXIOM.iconBoxes.cyan
                      : isCompleted
                        ? AXIOM.iconBoxes.green
                        : 'rgba(0, 0, 0, 0.3)',
                    boxShadow: isActive
                      ? AXIOM.shadows.iconCyan
                      : isCompleted
                        ? AXIOM.shadows.iconGreen
                        : 'none',
                  }}
                >
                  <Icon className="size-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div
                    className="text-sm font-semibold"
                    style={{
                      color: isActive ? '#22d3ee' : isCompleted ? '#34d399' : AXIOM.text.slate400,
                    }}
                  >
                    {step.label}
                  </div>
                </div>
              </motion.button>
              {index < 3 && (
                <ArrowRight className="size-5 mx-2 shrink-0" style={{ color: AXIOM.text.slate400 }} />
              )}
            </div>
          );
        })}
      </motion.div>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        {currentStep === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Account Selection */}
            <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
              <h3 className="text-xl font-bold text-white mb-4">Select bank account</h3>
              <p className="text-sm text-slate-400 mb-4">
                Statement lines are saved to this wallet so reports and future matching stay aligned.
              </p>
              {bankAccounts.length === 0 ? (
                <p className="text-slate-400 text-sm">
                  No bank accounts yet. Add one under Accounts &amp; wallets or Payment methods first.
                </p>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {bankAccounts.map((account) => (
                  <motion.button
                    key={account.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedAccount(account.id)}
                    className="p-4 rounded-xl transition-all text-left"
                    style={{
                      background: selectedAccount === account.id
                        ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))'
                        : AXIOM.containers.item.background,
                      border: selectedAccount === account.id
                        ? '1px solid rgba(6, 182, 212, 0.5)'
                        : AXIOM.containers.item.border,
                    }}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div 
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{
                          background: AXIOM.iconBoxes.blue,
                          boxShadow: AXIOM.shadows.iconBlue,
                        }}
                      >
                        <Building2 className="size-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="text-white font-semibold">{account.bankName}</div>
                        <div className="text-xs" style={{ color: AXIOM.text.slate400 }}>
                          {account.accountNumber}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-lg font-bold text-cyan-400">
                        {formatCurrency(account.balance, account.currency)}
                      </div>
                      <span className="text-xs font-medium uppercase text-slate-500">{account.currency}</span>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* File upload — entire dashed area is clickable (label fills box) */}
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className="rounded-2xl border-2 border-dashed text-center transition-all"
              style={{
                background: dragActive
                  ? 'rgba(6, 182, 212, 0.1)'
                  : AXIOM.containers.list.background,
                borderColor: dragActive ? 'rgba(6, 182, 212, 0.5)' : 'rgba(148, 163, 184, 0.2)',
              }}
            >
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center min-h-[220px] cursor-pointer p-12"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  id="file-upload"
                  className="sr-only"
                  accept=".csv,.pdf,text/csv,application/pdf"
                  onChange={handleFileInputChange}
                />
                <div
                  className="w-24 h-24 mx-auto mb-6 rounded-2xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.cyan,
                    boxShadow: AXIOM.shadows.iconCyan,
                  }}
                >
                  <Upload className="size-12 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">
                  {selectedFile ? selectedFile.name : 'Drop your statement file here'}
                </h3>
                <p className="text-slate-400 mb-6">or click anywhere in this box</p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <span className="px-4 py-2 rounded-lg text-sm" style={AXIOM.badges.info}>
                    CSV or PDF
                  </span>
                </div>
              </label>
            </div>

            <div className="flex justify-center">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => void loadSampleCsv()}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-600 text-slate-200 hover:bg-slate-800/80"
              >
                Try sample CSV
              </motion.button>
            </div>

            {selectedFile && !processing && (
              <div className="flex justify-end">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => selectedFile && void handleFileSelected(selectedFile)}
                  className="px-6 py-3 rounded-xl text-sm font-medium flex items-center gap-2"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                    border: '1px solid rgba(6, 182, 212, 0.5)',
                    boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                    color: '#ffffff',
                  }}
                >
                  Parse again / proceed to mapping
                  <ArrowRight className="size-4" />
                </motion.button>
              </div>
            )}

            {processing && (
              <div className="flex items-center justify-center gap-3 py-8">
                <Loader2 className="size-6 text-cyan-400 animate-spin" />
                <span className="text-slate-400">Processing file...</span>
              </div>
            )}
          </motion.div>
        )}

        {currentStep === 'mapping' && (
          <motion.div
            key="mapping"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
              <h3 className="text-xl font-bold text-white mb-2">Import settings</h3>
              <p className="text-sm text-slate-400 mb-4">
                Choose the wallet and currency for these lines. Default is the wallet&apos;s currency; override
                if the statement is in another currency (e.g. Payoneer in USD).
              </p>
              {bankAccounts.length === 0 ? (
                <p className="text-sm text-amber-400/90">
                  Add a bank account or wallet under Accounts first, then run this import again.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Bank account</label>
                    <select
                      value={selectedAccount}
                      onChange={e => setSelectedAccount(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    >
                      <option value="">Select account…</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.bankName} · {a.accountNumber} ({a.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Currency</label>
                    <select
                      value={importCurrencyOverride}
                      onChange={e => setImportCurrencyOverride(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    >
                      <option value="">
                        Same as account ({selectedBankAccount?.currency?.toUpperCase() ?? '—'})
                      </option>
                      {IMPORT_CURRENCY_OPTIONS.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-2">
                      Stored as{' '}
                      <span className="text-slate-300 font-medium">{resolvedImportCurrency}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
              <h3 className="text-xl font-bold text-white mb-2">Map CSV Columns</h3>
              <p className="text-sm text-slate-400 mb-4">
                Choose which <span className="text-slate-300">column number</span> (left to right) matches each
                field — works even when bank headers differ. Common layouts: Date, Description, Debit, Credit,
                Balance.
              </p>

              <div className="mb-6 p-4 rounded-xl border border-slate-600/60 bg-slate-900/40">
                <p className="text-sm font-medium text-slate-300 mb-3">How amounts appear in this file</p>
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                    <input
                      type="radio"
                      name="amountMode"
                      className="accent-cyan-500"
                      checked={columnMapping.amountMode !== 'debit_credit'}
                      onChange={() =>
                        setColumnMapping({
                          ...columnMapping,
                          amountMode: 'single',
                          debit: undefined,
                          credit: undefined,
                        })
                      }
                    />
                    One amount column
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                    <input
                      type="radio"
                      name="amountMode"
                      className="accent-cyan-500"
                      checked={columnMapping.amountMode === 'debit_credit'}
                      onChange={() =>
                        setColumnMapping({
                          ...columnMapping,
                          amountMode: 'debit_credit',
                          amount: '',
                        })
                      }
                    />
                    Separate Debit and Credit columns
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(
                  [
                    { key: 'date', label: 'Date', required: true },
                    { key: 'narration', label: 'Description / narration', required: true },
                  ] as const
                ).map(field => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      {field.label}
                      {field.required && <span className="text-red-400 ml-1">*</span>}
                    </label>
                    <select
                      value={columnMapping[field.key] || ''}
                      onChange={e =>
                        setColumnMapping({ ...columnMapping, [field.key]: e.target.value })
                      }
                      className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    >
                      <option value="">Select column…</option>
                      {csvHeaders.map((header, idx) => (
                        <option key={idx} value={columnKeyFromIndex(idx)}>
                          Column {idx + 1} — {header || '(empty)'}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {columnMapping.amountMode === 'debit_credit' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">
                        Debit (outflow) <span className="text-red-400 ml-1">*</span>
                      </label>
                      <select
                        value={columnMapping.debit || ''}
                        onChange={e =>
                          setColumnMapping({ ...columnMapping, debit: e.target.value || undefined })
                        }
                        className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                        }}
                      >
                        <option value="">Select column…</option>
                        {csvHeaders.map((header, idx) => (
                          <option key={idx} value={columnKeyFromIndex(idx)}>
                            Column {idx + 1} — {header || '(empty)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">
                        Credit (inflow) <span className="text-red-400 ml-1">*</span>
                      </label>
                      <select
                        value={columnMapping.credit || ''}
                        onChange={e =>
                          setColumnMapping({ ...columnMapping, credit: e.target.value || undefined })
                        }
                        className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                        style={{
                          background: AXIOM.inputs.background,
                          border: AXIOM.inputs.border,
                        }}
                      >
                        <option value="">Select column…</option>
                        {csvHeaders.map((header, idx) => (
                          <option key={idx} value={columnKeyFromIndex(idx)}>
                            Column {idx + 1} — {header || '(empty)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Amount <span className="text-red-400 ml-1">*</span>
                    </label>
                    <select
                      value={columnMapping.amount || ''}
                      onChange={e => setColumnMapping({ ...columnMapping, amount: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                      }}
                    >
                      <option value="">Select column…</option>
                      {csvHeaders.map((header, idx) => (
                        <option key={idx} value={columnKeyFromIndex(idx)}>
                          Column {idx + 1} — {header || '(empty)'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <details className="md:col-span-2 mt-1 rounded-xl border border-slate-600/50 bg-slate-900/30">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-300 [&::-webkit-details-marker]:hidden flex items-center gap-2">
                    <span className="text-cyan-400/90">▸</span>
                    More column roles (optional — balance, reference, Dr/Cr)
                  </summary>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-4 pb-4 pt-0 border-t border-slate-700/50">
                    {(
                      [
                        { key: 'balance', label: 'Balance (optional)', required: false },
                        { key: 'reference', label: 'Reference (optional)', required: false },
                        { key: 'type', label: 'Type Dr/Cr (optional)', required: false },
                      ] as const
                    ).map(field => (
                      <div key={field.key} className={field.key === 'type' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-slate-400 mb-2">{field.label}</label>
                        <select
                          value={columnMapping[field.key] || ''}
                          onChange={e =>
                            setColumnMapping({
                              ...columnMapping,
                              [field.key]: e.target.value || undefined,
                            })
                          }
                          className="w-full px-4 py-3 rounded-xl text-white focus:outline-none transition-all"
                          style={{
                            background: AXIOM.inputs.background,
                            border: AXIOM.inputs.border,
                          }}
                        >
                          <option value="">Select column…</option>
                          {csvHeaders.map((header, idx) => (
                            <option key={idx} value={columnKeyFromIndex(idx)}>
                              Column {idx + 1} — {header || '(empty)'}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              <div 
                className="mt-6 p-4 rounded-xl"
                style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="size-5 text-blue-400 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-1">Smart detection</h4>
                    <p className="text-xs text-slate-400">
                      We guess mappings from header names when we can. Always match by column number if your
                      bank uses unusual labels — e.g. Column 1 = date, Column 2 = description, Column 3 = debit.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCurrentStep('upload')}
                className="px-6 py-3 rounded-xl text-sm font-medium"
                style={AXIOM.buttons.secondary}
              >
                Back
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleProceedToReview}
                disabled={
                  processing ||
                  !mappingIsComplete ||
                  bankAccounts.length === 0 ||
                  !selectedAccount
                }
                className="px-6 py-3 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  ...(mappingIsComplete &&
                    !processing &&
                    bankAccounts.length > 0 &&
                    !!selectedAccount
                    ? {
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                        border: '1px solid rgba(6, 182, 212, 0.5)',
                        boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                        color: '#ffffff',
                      }
                    : {
                        background: 'rgba(148, 163, 184, 0.1)',
                        border: '1px solid rgba(148, 163, 184, 0.2)',
                        color: AXIOM.text.slate400,
                        opacity: 0.5,
                        cursor: 'not-allowed',
                      }),
                }}
              >
                {processing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Preparing…
                  </>
                ) : (
                  <>
                    Proceed to Review
                    <ArrowRight className="size-4" />
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}

        {currentStep === 'review' && (
          <motion.div
            key="review"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm mb-1">Total</p>
                    <p className="text-2xl font-bold text-white">{stats.total}</p>
                  </div>
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.purple,
                      boxShadow: AXIOM.shadows.iconPurple,
                    }}
                  >
                    <FileText className="size-6 text-white" />
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-slate-400 text-sm mb-1">Auto-Classified</p>
                    <p className="text-2xl font-bold text-emerald-400">{stats.classified}</p>
                  </div>
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.green,
                      boxShadow: AXIOM.shadows.iconGreen,
                    }}
                  >
                    <CheckCircle2 className="size-6 text-white" />
                  </div>
                </div>
                {(stats.classifiedByAI > 0 || stats.classifiedByRules > 0) && (
                  <div className="flex items-center gap-3 text-xs pt-3 border-t border-slate-700/50">
                    {stats.classifiedByAI > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                        <span className="text-slate-400">AI: <span className="text-purple-300 font-semibold">{stats.classifiedByAI}</span></span>
                      </div>
                    )}
                    {stats.classifiedByRules > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                        <span className="text-slate-400">Rules: <span className="text-blue-300 font-semibold">{stats.classifiedByRules}</span></span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm mb-1">Duplicates</p>
                    <p className="text-2xl font-bold text-amber-400">{stats.duplicates}</p>
                  </div>
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.orange,
                      boxShadow: AXIOM.shadows.iconOrange,
                    }}
                  >
                    <AlertTriangle className="size-6 text-white" />
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-2xl" style={AXIOM.containers.list}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm mb-1">To Import</p>
                    <p className="text-2xl font-bold text-cyan-400">{filteredTransactions.length}</p>
                  </div>
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.cyan,
                      boxShadow: AXIOM.shadows.iconCyan,
                    }}
                  >
                    <Sparkles className="size-6 text-white" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 px-1">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterDuplicates}
                  onChange={e => setFilterDuplicates(e.target.checked)}
                  className="rounded border-slate-600"
                />
                Hide likely duplicates
              </label>
            </div>

            {/* Review Mode & 3-Tier Queue Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-400">Review Mode:</span>
                <button
                  type="button"
                  onClick={() => setReviewMode('tiers')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    reviewMode === 'tiers'
                      ? 'border-cyan-500 text-cyan-300 bg-cyan-950/60 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800/80'
                  }`}
                >
                  <Layers className="size-3.5" />
                  3-Tier Exception Queue
                </button>
                <button
                  type="button"
                  onClick={() => setReviewMode('step')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    reviewMode === 'step'
                      ? 'border-cyan-500 text-cyan-300 bg-cyan-950/40'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800/80'
                  }`}
                >
                  One by one
                </button>
                <button
                  type="button"
                  onClick={() => setReviewMode('list')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    reviewMode === 'list'
                      ? 'border-cyan-500 text-cyan-300 bg-cyan-950/40'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800/80'
                  }`}
                >
                  All rows
                </button>
              </div>

              {reviewMode === 'tiers' && (
                <div className="flex items-center gap-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSubmitBulkReview(true)}
                    disabled={reviewSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2"
                    style={{
                      background: reviewCompleted
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                      border: reviewCompleted
                        ? '1px solid rgba(16, 185, 129, 0.5)'
                        : '1px solid rgba(6, 182, 212, 0.5)',
                      color: reviewCompleted ? '#34d399' : '#ffffff',
                    }}
                  >
                    {reviewSubmitting ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Submitting decisions…
                      </>
                    ) : reviewCompleted ? (
                      <>
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                        Decisions Submitted & Learned
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-3.5 text-cyan-300" />
                        Submit Review Decisions
                      </>
                    )}
                  </motion.button>
                </div>
              )}
            </div>

            {/* 3-Tier Exception Review Queue View */}
            {reviewMode === 'tiers' && (
              <div className="space-y-6">
                {/* Tier Filter Tabs */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedTier('all')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      selectedTier === 'all'
                        ? 'border-cyan-500 bg-cyan-950/30 ring-1 ring-cyan-500/50'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-300">All Queue Rows</span>
                      <span className="text-xs font-mono font-bold text-white bg-slate-800 px-2 py-0.5 rounded-full">
                        {filteredTransactions.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">Complete statement batch</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTier('tier1')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      selectedTier === 'tier1'
                        ? 'border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/50'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span className="text-xs font-bold text-emerald-300">Tier 1: Auto-Accepted</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        {tier1List.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">High confidence (≥80%)</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTier('tier2')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      selectedTier === 'tier2'
                        ? 'border-amber-500 bg-amber-950/30 ring-1 ring-amber-500/50'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                        <span className="text-xs font-bold text-amber-300">Tier 2: Grouped</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-500/30">
                        {tier2Groups.length} groups
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {tier2Groups.reduce((s, g) => s + g.transactions.length, 0)} transactions with token rules
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTier('tier3')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      selectedTier === 'tier3'
                        ? 'border-purple-500 bg-purple-950/30 ring-1 ring-purple-500/50'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                        <span className="text-xs font-bold text-purple-300">Tier 3: Manual</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded-full border border-purple-500/30">
                        {tier3List.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">Low confidence / unmapped</p>
                  </button>
                </div>

                {/* Queue Explainer Banner */}
                <div
                  className="p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  style={{
                    background: 'linear-gradient(135deg, rgba(15, 30, 60, 0.4) 0%, rgba(10, 20, 45, 0.6) 100%)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="size-4 text-cyan-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-200">
                        3-Tier Exception Review Queue prior to Final Commit
                      </p>
                      <p className="text-slate-400 mt-0.5">
                        Review grouped exception tokens and low-confidence rows. Confirming rules applies decisions to the classification engine (`/classification/bulk-review`) before final commit.
                      </p>
                    </div>
                  </div>
                  {tier2Groups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        tier2Groups.forEach(g => handleConfirmGroup(g.vendorToken));
                        toast.success(`Confirmed all ${tier2Groups.length} exception groups`);
                      }}
                      className="px-3 py-1.5 rounded-lg font-medium text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 shrink-0 self-start sm:self-center"
                    >
                      Confirm All Groups
                    </button>
                  )}
                </div>

                {/* ── TIER 2: GROUPED EXCEPTIONS ─────────────────────────────────────── */}
                {(selectedTier === 'all' || selectedTier === 'tier2') && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"></div>
                        <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                          Tier 2: Grouped Exceptions ({tier2Groups.length} groups)
                        </h4>
                      </div>
                      <span className="text-xs text-slate-400">
                        Common vendor/narration tokens requiring category confirmation &amp; rule generation
                      </span>
                    </div>

                    {tier2Groups.length === 0 ? (
                      <div className="p-6 rounded-xl text-center border border-slate-800 bg-slate-900/30">
                        <CheckCircle2 className="size-6 text-emerald-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-slate-300">No Grouped Exceptions</p>
                        <p className="text-xs text-slate-500 mt-1">All multi-row vendor transactions met high-confidence automated criteria.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {tier2Groups.map((group) => {
                          const state = groupOverrides[group.vendorToken];
                          const selectedCatId = state?.selectedCategoryId || group.suggestedCategoryId;
                          const createRule = state?.createRule ?? true;
                          const isConfirmed = state?.isConfirmed ?? false;
                          const isExpanded = expandedGroups[group.vendorToken] ?? false;
                          const totalAmount = group.transactions.reduce((s, t) => s + Number(t.amount || 0), 0);

                          return (
                            <div
                              key={group.groupKey}
                              className="p-4 rounded-xl border transition-all"
                              style={{
                                background: isConfirmed
                                  ? 'rgba(16, 185, 129, 0.05)'
                                  : 'rgba(15, 23, 42, 0.65)',
                                borderColor: isConfirmed
                                  ? 'rgba(16, 185, 129, 0.3)'
                                  : 'rgba(245, 158, 11, 0.3)',
                              }}
                            >
                              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                {/* Left Info */}
                                <div className="space-y-1.5 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                                      <Tag className="size-3" />
                                      {group.vendorToken}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                      {group.transactions.length} transaction{group.transactions.length === 1 ? '' : 's'}
                                    </span>
                                    <span className="text-xs font-semibold text-white">
                                      · {formatCurrency(totalAmount, resolvedImportCurrency)}
                                    </span>
                                    <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-400">
                                      {group.confidence}% confidence
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400 truncate max-w-xl">
                                    Sample: "{group.transactions[0]?.narration}"
                                  </p>
                                </div>

                                {/* Middle / Right Controls */}
                                <div className="flex flex-wrap items-center gap-3">
                                  {/* Category Picker */}
                                  <div className="min-w-[180px]">
                                    <select
                                      value={selectedCatId}
                                      onChange={e => handleGroupCategoryChange(group.vendorToken, e.target.value)}
                                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-slate-900 border border-slate-700 focus:border-cyan-500 focus:outline-none"
                                    >
                                      <option value="" disabled>Select category…</option>
                                      {categories.map(c => (
                                        <option key={c.id} value={c.id}>
                                          {c.name} ({c.type})
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Create Rule Checkbox */}
                                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={createRule}
                                      onChange={e => handleGroupRuleToggle(group.vendorToken, e.target.checked)}
                                      className="rounded border-slate-700 text-cyan-500 focus:ring-0 bg-slate-900 size-3.5"
                                    />
                                    <span>Create rule</span>
                                  </label>

                                  {/* Confirm Button */}
                                  {isConfirmed ? (
                                    <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                                      <Check className="size-3.5" />
                                      Confirmed
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmGroup(group.vendorToken)}
                                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
                                    >
                                      Confirm Group
                                    </button>
                                  )}

                                  {/* Expand Button */}
                                  <button
                                    type="button"
                                    onClick={() => toggleGroupExpanded(group.vendorToken)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-xs flex items-center gap-1"
                                    title="Inspect group transactions"
                                  >
                                    {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                    <span className="hidden sm:inline">{isExpanded ? 'Hide' : 'Rows'}</span>
                                  </button>
                                </div>
                              </div>

                              {/* Expanded Row Inspection */}
                              {isExpanded && (
                                <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5 max-h-48 overflow-y-auto">
                                  {group.transactions.map((txn, tIdx) => (
                                    <div
                                      key={txn.id || tIdx}
                                      className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-slate-900/60 border border-slate-800/80"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-slate-400 font-mono shrink-0">{txn.date}</span>
                                        <span className="text-slate-300 truncate">{txn.narration}</span>
                                      </div>
                                      <span
                                        className={`font-mono font-semibold shrink-0 ml-2 ${
                                          txn.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                                        }`}
                                      >
                                        {txn.type === 'credit' ? '+' : '−'}
                                        {formatCurrency(txn.amount, resolvedImportCurrency)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── TIER 3: MANUAL REVIEW ─────────────────────────────────────────── */}
                {(selectedTier === 'all' || selectedTier === 'tier3') && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.6)]"></div>
                        <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                          Tier 3: Low-Confidence &amp; Manual Review ({tier3List.length} transactions)
                        </h4>
                      </div>
                      <span className="text-xs text-slate-400">
                        Ambiguous or unclassified transactions needing direct category selection
                      </span>
                    </div>

                    {tier3List.length === 0 ? (
                      <div className="p-6 rounded-xl text-center border border-slate-800 bg-slate-900/30">
                        <CheckCircle2 className="size-6 text-emerald-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-slate-300">No Manual Transactions Pending</p>
                        <p className="text-xs text-slate-500 mt-1">All transactions matched automated rules or grouped vendor patterns.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {tier3List.map((txn, idx) => (
                          <div
                            key={txn.id || idx}
                            className="p-4 rounded-xl border border-purple-500/25 bg-slate-900/50 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-white">{txn.narration}</p>
                                <p className="text-xs text-slate-400 mt-0.5 font-mono">{txn.date}</p>
                              </div>
                              <div className="text-right">
                                <p
                                  className={`text-base font-bold font-mono ${
                                    txn.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                                  }`}
                                >
                                  {txn.type === 'credit' ? '+' : '−'}
                                  {formatCurrency(txn.amount, resolvedImportCurrency)}
                                </p>
                                <span className="text-[10px] text-purple-300 font-mono bg-purple-950/60 px-2 py-0.5 rounded border border-purple-500/30">
                                  {txn.confidence ? `${txn.confidence}% confidence` : 'Unclassified'}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
                              <div>
                                <label className="block text-[11px] font-medium text-slate-400 mb-1">Category</label>
                                <select
                                  value={txn.importCategoryId || ''}
                                  onChange={e =>
                                    patchTransaction(txn.id, {
                                      importCategoryId: e.target.value || undefined,
                                      category: categories.find(c => c.id === e.target.value)?.name,
                                    })
                                  }
                                  className="w-full px-3 py-1.5 rounded-lg text-xs text-white bg-slate-900 border border-slate-700 focus:outline-none"
                                >
                                  <option value="">Select category…</option>
                                  {categories.map(c => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} ({c.type})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-[11px] font-medium text-slate-400 mb-1">Project (optional)</label>
                                <select
                                  value={txn.projectId || ''}
                                  onChange={e =>
                                    patchTransaction(txn.id, {
                                      projectId: e.target.value || undefined,
                                    })
                                  }
                                  className="w-full px-3 py-1.5 rounded-lg text-xs text-white bg-slate-900 border border-slate-700 focus:outline-none"
                                >
                                  <option value="">Unallocated</option>
                                  {projects.map(p => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-[11px] font-medium text-slate-400 mb-1">Spend Type</label>
                                <div className="flex items-center gap-3 h-8">
                                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`tier3-usage-${txn.id}`}
                                      checked={txn.usage === 'business'}
                                      onChange={() => patchTransaction(txn.id, { usage: 'business' })}
                                      className="rounded-full border-slate-700 bg-slate-900"
                                    />
                                    Business
                                  </label>
                                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`tier3-usage-${txn.id}`}
                                      checked={txn.usage === 'personal'}
                                      onChange={() => patchTransaction(txn.id, { usage: 'personal' })}
                                      className="rounded-full border-slate-700 bg-slate-900"
                                    />
                                    Personal
                                  </label>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── TIER 1: AUTO-ACCEPTED ─────────────────────────────────────────── */}
                {(selectedTier === 'all' || selectedTier === 'tier1') && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
                        <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                          Tier 1: Auto-Accepted ({tier1List.length} transactions)
                        </h4>
                      </div>
                      <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                        <ShieldCheck className="size-3.5" /> High confidence (≥80%)
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-slate-900/40 max-h-72 overflow-y-auto space-y-2">
                      {tier1List.length === 0 ? (
                        <p className="text-xs text-slate-500 italic py-2 text-center">No auto-accepted rows.</p>
                      ) : (
                        tier1List.slice(0, 20).map((txn, idx) => (
                          <div
                            key={txn.id || idx}
                            className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-slate-400 font-mono shrink-0">{txn.date}</span>
                              <span className="text-slate-200 truncate">{txn.narration}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 shrink-0">
                                {txn.suggestedCategory || txn.category || 'Classified'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-3">
                              <span className="text-[10px] font-mono text-slate-400">
                                {txn.confidence}%
                              </span>
                              <span
                                className={`font-mono font-bold ${
                                  txn.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {txn.type === 'credit' ? '+' : '−'}
                                {formatCurrency(txn.amount, resolvedImportCurrency)}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                      {tier1List.length > 20 && (
                        <p className="text-xs text-slate-500 text-center pt-2">
                          + {tier1List.length - 20} additional auto-accepted rows verified
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {reviewMode === 'step' && focusedTxn && (
              <div className="p-6 rounded-2xl space-y-4" style={AXIOM.containers.list}>
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Transaction {reviewStepIndex + 1} of {filteredTransactions.length}
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                      {formatDate(focusedTxn.date)} ·{' '}
                      <span
                        className={
                          focusedTxn.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                        }
                      >
                        {formatCurrency(focusedTxn.amount, resolvedImportCurrency)}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={reviewStepIndex <= 0}
                      onClick={() => setReviewStepIndex(i => Math.max(0, i - 1))}
                      className="px-3 py-2 rounded-lg text-sm border border-slate-600 text-slate-200 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={reviewStepIndex >= filteredTransactions.length - 1}
                      onClick={() =>
                        setReviewStepIndex(i => Math.min(filteredTransactions.length - 1, i + 1))
                      }
                      className="px-3 py-2 rounded-lg text-sm border border-slate-600 text-slate-200 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Description / narration
                  </label>
                  <textarea
                    value={focusedTxn.narration}
                    onChange={e =>
                      patchTransaction(focusedTxn.id, { narration: e.target.value })
                    }
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl text-white placeholder:text-slate-500 focus:outline-none resize-y min-h-[80px]"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Category (salary, software, etc.)
                  </label>
                  <select
                    value={focusedTxn.importCategoryId ?? ''}
                    onChange={e =>
                      patchTransaction(focusedTxn.id, {
                        importCategoryId: e.target.value || undefined,
                      })
                    }
                    className="w-full max-w-lg px-4 py-3 rounded-xl text-white focus:outline-none"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <option value="">Let auto-classify decide</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-400">
                      Project allocation (optional)
                    </label>
                    {focusedTxn.projectId ? (
                      <span className="text-xs text-cyan-400 font-medium">
                        Allocated to Project
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Unallocated</span>
                    )}
                  </div>
                  <select
                    value={focusedTxn.projectId ?? ''}
                    onChange={e =>
                      patchTransaction(focusedTxn.id, {
                        projectId: e.target.value || undefined,
                      })
                    }
                    className="w-full max-w-lg px-4 py-3 rounded-xl text-white focus:outline-none"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    <option value="">No Project (General overhead / unallocated)</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.clientName ? `— ${p.clientName}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Directly count this transaction towards project costs/revenue for profit &amp; margin calculations.
                  </p>
                </div>

                <div>
                  <span className="block text-sm font-medium text-slate-400 mb-2">Spend type</span>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name={`usage-${focusedTxn.id}`}
                        checked={focusedTxn.usage === 'business'}
                        onChange={() => patchTransaction(focusedTxn.id, { usage: 'business' })}
                        className="rounded-full border-slate-600"
                      />
                      Business
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name={`usage-${focusedTxn.id}`}
                        checked={focusedTxn.usage === 'personal'}
                        onChange={() => patchTransaction(focusedTxn.id, { usage: 'personal' })}
                        className="rounded-full border-slate-600"
                      />
                      Personal
                    </label>
                  </div>
                </div>
              </div>
            )}

            {bankAccounts.length > 0 && (
              <div className="p-4 rounded-xl" style={AXIOM.containers.list}>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Import into bank account
                </label>
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  className="w-full max-w-md px-4 py-3 rounded-xl text-white focus:outline-none"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                >
                  <option value="">Select account…</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.bankName} · {a.accountNumber} ({a.currency})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-2">
                  Amounts import in <span className="text-slate-300">{resolvedImportCurrency}</span>
                  {importCurrencyOverride ? ' (override from mapping step)' : ''}
                </p>
              </div>
            )}

            {/* Transaction List */}
            <div className="p-6 rounded-2xl space-y-4" style={AXIOM.containers.list}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-xl font-bold text-white">
                  Transactions to Import
                  {reviewMode === 'list' ? ' (All rows with project assignment)' : ' (Summary)'}
                </h3>
                {reviewMode === 'list' && projects.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Set project for all:</span>
                    <select
                      defaultValue=""
                      onChange={e => {
                        const val = e.target.value;
                        if (!val) return;
                        setParsedTransactions(prev =>
                          prev.map(t => ({
                            ...t,
                            projectId: val === '__none__' ? undefined : val,
                          }))
                        );
                        toast.success(
                          val === '__none__'
                            ? 'Removed project from all rows'
                            : 'Assigned project to all rows'
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs text-white bg-slate-900 border border-slate-700 focus:outline-none"
                    >
                      <option value="" disabled>Choose project…</option>
                      <option value="__none__">None (Clear project on all)</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.clientName ? `(${p.clientName})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                {(reviewMode === 'list'
                  ? filteredTransactions
                  : reviewMode === 'tiers'
                    ? (selectedTier === 'tier1'
                        ? tier1List
                        : selectedTier === 'tier2'
                          ? tier2Groups.flatMap(g => g.transactions)
                          : selectedTier === 'tier3'
                            ? tier3List
                            : filteredTransactions.slice(0, 20))
                    : filteredTransactions.slice(0, 15)
                ).map((txn, idx) => (
                  <motion.div
                    key={txn.id || idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-white font-semibold break-words">{txn.narration}</p>
                        {txn.isDuplicate && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Duplicate
                          </span>
                        )}
                        {txn.classificationSource && (
                          <span 
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              txn.classificationSource === 'ai' 
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            }`}
                            title={txn.classificationSource === 'ai' ? 'Classified by AI' : 'Classified by Rules Engine'}
                          >
                            {txn.classificationSource === 'ai' ? '🤖 AI' : '⚙️ Rules'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        {formatDate(txn.date)} · <span className="text-slate-300">{txn.usage ?? 'business'}</span>
                      </p>
                    </div>

                    {/* Inline Project & Category Selectors in List Mode */}
                    {reviewMode === 'list' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={txn.projectId ?? ''}
                          onChange={e =>
                            patchTransaction(txn.id, {
                              projectId: e.target.value || undefined,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg text-xs text-white bg-slate-900/90 border border-slate-700 focus:border-cyan-500 max-w-[180px]"
                          title="Assign project"
                        >
                          <option value="">No Project</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>

                        <select
                          value={txn.importCategoryId ?? ''}
                          onChange={e =>
                            patchTransaction(txn.id, {
                              importCategoryId: e.target.value || undefined,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg text-xs text-white bg-slate-900/90 border border-slate-700 focus:border-cyan-500 max-w-[160px]"
                          title="Assign category"
                        >
                          <option value="">Auto-classify</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="text-right shrink-0">
                      <p
                        className={`text-base sm:text-lg font-bold ${
                          txn.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {txn.type === 'credit' ? '+' : '−'}
                        {formatCurrency(txn.amount, resolvedImportCurrency)}
                      </p>
                      {!!txn.confidence && (
                        <p className="text-[11px] text-slate-400">
                          {txn.confidence}% confidence
                        </p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCurrentStep('mapping')}
                className="px-6 py-3 rounded-xl text-sm font-medium w-full sm:w-auto"
                style={AXIOM.buttons.secondary}
              >
                Back
              </motion.button>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                {!reviewCompleted && (tier2Groups.length > 0 || tier3List.length > 0) && (
                  <button
                    type="button"
                    onClick={() => handleSubmitBulkReview(true)}
                    disabled={reviewSubmitting}
                    className="px-5 py-3 rounded-xl text-sm font-semibold border border-amber-500/40 text-amber-300 bg-amber-950/30 hover:bg-amber-950/50 flex items-center gap-2"
                  >
                    {reviewSubmitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Submit Review Decisions
                  </button>
                )}

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleImport}
                  disabled={
                    processing ||
                    filteredTransactions.length === 0 ||
                    (bankAccounts.length > 0 && !selectedAccount)
                  }
                  className="px-6 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 w-full sm:w-auto"
                  style={{
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                    border: '1px solid rgba(6, 182, 212, 0.5)',
                    boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                    color: '#ffffff',
                  }}
                >
                  {processing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      Commit Import ({filteredTransactions.length})
                      <CheckCircle2 className="size-4" />
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {currentStep === 'complete' && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="p-12 rounded-2xl text-center"
            style={AXIOM.containers.list}
          >
            <div 
              className="w-24 h-24 mx-auto mb-6 rounded-2xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <CheckCircle2 className="size-12 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">Import Complete!</h2>
            <p className="text-slate-400 mb-8">
              Successfully imported {lastImportedCount} transaction{lastImportedCount === 1 ? '' : 's'}
            </p>
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleNewImport}
              className="px-6 py-3 rounded-xl text-sm font-medium"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              Import another file
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      </>
      ) : (
        /* ═══════════════════════════════════════════════════════════════════════════
           STORED STATEMENTS & DATABASE RECORDS VIEW
           ═══════════════════════════════════════════════════════════════════════════ */
        <motion.div
          key="records-view"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Top Summary Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl" style={AXIOM.containers.list}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Stored Statements</p>
                  <p className="text-2xl font-bold text-white">{historyStats.totalStatements}</p>
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.cyan,
                    boxShadow: AXIOM.shadows.iconCyan,
                  }}
                >
                  <Database className="size-5 text-white" />
                </div>
              </div>
              <p className="text-[11px] text-emerald-400 mt-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Persisted in Supabase
              </p>
            </div>

            <div className="p-5 rounded-2xl" style={AXIOM.containers.list}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">CSV Statements</p>
                  <p className="text-2xl font-bold text-cyan-300">{historyStats.csvCount}</p>
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.blue,
                    boxShadow: AXIOM.shadows.iconBlue,
                  }}
                >
                  <FileSpreadsheet className="size-5 text-white" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">Comma-separated spreadsheets</p>
            </div>

            <div className="p-5 rounded-2xl" style={AXIOM.containers.list}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">PDF Statements</p>
                  <p className="text-2xl font-bold text-amber-300">{historyStats.pdfCount}</p>
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.orange,
                    boxShadow: AXIOM.shadows.iconOrange,
                  }}
                >
                  <FileText className="size-5 text-white" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">Extracted &amp; OCR parsed</p>
            </div>

            <div className="p-5 rounded-2xl" style={AXIOM.containers.list}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Total Transactions</p>
                  <p className="text-2xl font-bold text-emerald-300">{historyStats.totalTransactions}</p>
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: AXIOM.iconBoxes.green,
                    boxShadow: AXIOM.shadows.iconGreen,
                  }}
                >
                  <CheckCircle2 className="size-5 text-white" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">
                {historyStats.totalAutoClassified} auto-categorized
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4" style={AXIOM.containers.list}>
            <div className="flex flex-1 items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="Search file name, bank account, or status…"
                  className="w-full pl-10 pr-4 py-2 rounded-xl text-sm text-white focus:outline-none placeholder:text-slate-500"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                />
              </div>

              {/* Format Filter Pills */}
              <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setHistoryTypeFilter('all')}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    historyTypeFilter === 'all'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTypeFilter('csv')}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    historyTypeFilter === 'csv'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTypeFilter('pdf')}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    historyTypeFilter === 'pdf'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refetchHistory()}
                className="p-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Refresh from Supabase"
              >
                <RefreshCw className={`size-4 ${loadingHistory ? 'animate-spin text-cyan-400' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMainTab('wizard');
                  handleNewImport();
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 transition-all shadow-md"
              >
                <Upload className="size-3.5" />
                Upload File
              </button>
            </div>
          </div>

          {/* Records Table / List */}
          <div className="rounded-2xl overflow-hidden p-6 space-y-4" style={AXIOM.containers.list}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FolderArchive className="size-5 text-cyan-400" />
                  Stored Bank Statements in Database
                </h3>
                <p className="text-xs text-slate-400">
                  All CSV &amp; PDF files uploaded for audit trails and statement records
                </p>
              </div>
              <span className="text-xs text-slate-400">
                Showing {filteredHistory.length} of {importHistory.length} files
              </span>
            </div>

            {loadingHistory && importHistory.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <Loader2 className="size-6 animate-spin mx-auto mb-2 text-cyan-400" />
                <p className="text-sm">Loading stored statements from Supabase...</p>
              </div>
            ) : historyError && importHistory.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-3">
                <AlertTriangle className="size-6 mx-auto text-amber-400" />
                <p className="text-base font-semibold text-white">Could not load statement records</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">{historyError}</p>
                <button
                  type="button"
                  onClick={() => void refetchHistory()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 transition-all inline-flex items-center gap-2"
                >
                  <RefreshCw className="size-3.5" />
                  Retry
                </button>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-3">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
                  style={{
                    background: AXIOM.iconBoxes.blue,
                    boxShadow: AXIOM.shadows.iconBlue,
                  }}
                >
                  <FileText className="size-6 text-white" />
                </div>
                <p className="text-base font-semibold text-white">No statement records found</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {historySearch || historyTypeFilter !== 'all'
                    ? 'No stored statements matched your search criteria.'
                    : 'Upload your first CSV or PDF statement to auto-classify transactions and store the statement file in database.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMainTab('wizard');
                    handleNewImport();
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 transition-all inline-flex items-center gap-2"
                >
                  <Upload className="size-3.5" />
                  Import Statement Now
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHistory.map((rec, idx) => {
                  const isPdf = rec.fileName.toLowerCase().endsWith('.pdf');
                  return (
                    <motion.div
                      key={rec.id || idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className="p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 border border-slate-800/80 hover:border-cyan-500/40 transition-all group"
                      style={AXIOM.containers.item}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            background: isPdf ? AXIOM.iconBoxes.orange : AXIOM.iconBoxes.cyan,
                            boxShadow: isPdf ? AXIOM.shadows.iconOrange : AXIOM.shadows.iconCyan,
                          }}
                        >
                          {isPdf ? (
                            <FileText className="size-5 text-white" />
                          ) : (
                            <FileSpreadsheet className="size-5 text-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="font-semibold text-white text-sm truncate max-w-xs sm:max-w-md">
                              {rec.fileName}
                            </p>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                isPdf
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              }`}
                            >
                              {isPdf ? 'PDF Statement' : 'CSV Spreadsheet'}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Database Saved
                            </span>
                            {(rec.fileUrl || rec.filePath) && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                File in Storage
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                            <span>{rec.accountName || 'Bank Wallet'}</span>
                            <span>•</span>
                            <span>{formatDate(rec.importedAt)}</span>
                            {rec.fileSize ? (
                              <>
                                <span>•</span>
                                <span>{(rec.fileSize / 1024).toFixed(1)} KB</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
                        <div className="text-left md:text-right">
                          <p className="text-sm font-bold text-white">
                            {rec.transactionCount} {rec.transactionCount === 1 ? 'transaction' : 'transactions'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            <span className="text-emerald-400 font-medium">{rec.autoPlaced} auto</span>
                            {rec.needsReview > 0 && (
                              <span className="text-amber-400 font-medium ml-1.5">• {rec.needsReview} review</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
                          <button
                            type="button"
                            onClick={() => void handleDownloadStoredFile(rec)}
                            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            title="Download original file / CSV export"
                          >
                            <Download className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedRecordDetails(rec)}
                            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            title="View statement details"
                          >
                            <Eye className="size-4" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingRecordId === rec.id}
                            onClick={() => void handleDeleteHistoryRecord(rec.id)}
                            className="p-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            title="Delete record from database"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Record Details Dialog */}
      <Dialog
        open={!!selectedRecordDetails}
        onOpenChange={(open) => !open && setSelectedRecordDetails(null)}
      >
        <DialogContent
          className={`${
            theme === 'light'
              ? 'border-slate-200 bg-white text-slate-900'
              : 'border-slate-700 bg-slate-950 text-slate-100'
          } max-w-lg`}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="size-5 text-cyan-400" />
              Statement Record Details
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Stored statement metadata from Supabase database (import_history_records)
            </DialogDescription>
          </DialogHeader>

          {selectedRecordDetails && (
            <div className="space-y-4 pt-2 text-sm">
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">File Name</span>
                  <span className="text-white font-mono font-semibold">{selectedRecordDetails.fileName}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Format</span>
                  <span className="text-cyan-300 uppercase font-semibold">
                    {selectedRecordDetails.fileName.toLowerCase().endsWith('.pdf') ? 'PDF' : 'CSV'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Import Date</span>
                  <span className="text-slate-200">{new Date(selectedRecordDetails.importedAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Target Bank Account</span>
                  <span className="text-slate-200">{selectedRecordDetails.accountName}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Database Record ID</span>
                  <span className="text-slate-400 font-mono text-[11px]">{selectedRecordDetails.id}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <p className="text-xs text-slate-400 mb-1">Imported</p>
                  <p className="text-lg font-bold text-white">{selectedRecordDetails.transactionCount}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <p className="text-xs text-slate-400 mb-1">Auto-Placed</p>
                  <p className="text-lg font-bold text-emerald-400">{selectedRecordDetails.autoPlaced}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <p className="text-xs text-slate-400 mb-1">Review</p>
                  <p className="text-lg font-bold text-amber-400">{selectedRecordDetails.needsReview}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    const idToDelete = selectedRecordDetails.id;
                    setSelectedRecordDetails(null);
                    void handleDeleteHistoryRecord(idToDelete);
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors inline-flex items-center gap-1.5"
                >
                  <Trash2 className="size-3.5" />
                  Delete Record
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRecordDetails(null)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDownloadStoredFile(selectedRecordDetails);
                      setSelectedRecordDetails(null);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 inline-flex items-center gap-1.5"
                  >
                    <Download className="size-3.5" />
                    Download File
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}