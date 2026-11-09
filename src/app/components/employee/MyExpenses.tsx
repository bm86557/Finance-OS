import { useState, useMemo, useRef, useEffect, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { PageShell, PageHeader } from '../layout';
import {
  DollarSign, Plus, Search, CheckCircle, Clock,
  XCircle, Upload, Receipt, Send, X, AlertCircle,
  FileText, Pencil, Sparkles,
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import type { Expense } from '@/services/employeeService';
import { useService, useMutation } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import {
  suggestCategoryFromNarration,
  findLikelyDuplicates,
  policyNotesForDraft,
  confidenceLabel,
} from '@/lib/expenseAiAssistant';

// ── Types ──────────────────────────────────────────────────────────────

interface ExpenseClaim {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'reimbursed';
  receipt: boolean;
  project?: string;
  notes?: string;
  rejectionReason?: string;
}

interface ExpenseFormData {
  description: string;
  category: string;
  amount: string;
  currency: string;
  date: string;
  project: string;
  notes: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  'Meals & Entertainment', 'Transportation', 'Travel',
  'Software', 'Hardware', 'Office Supplies', 'Training',
  'Marketing', 'Utilities', 'Other',
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD'];

/** Keeps receipts small enough for local demo persistence (data URL in store). */
const MAX_RECEIPT_FILE_BYTES = 1024 * 1024 * 1024;

const EMPTY_FORM_BASE: Omit<ExpenseFormData, 'date'> = {
  description: '',
  category: 'Meals & Entertainment',
  amount: '',
  currency: 'USD',
  project: '',
  notes: '',
};

function freshExpenseForm(): ExpenseFormData {
  return {
    ...EMPTY_FORM_BASE,
    date: new Date().toISOString().split('T')[0],
  };
}

const statusConfig: Record<string, { color: string; bg: string; border: string; icon: any }> = {
  draft:      { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', icon: FileText },
  pending:    { color: '#fbbf24', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.2)',  icon: Clock },
  approved:   { color: '#34d399', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)',  icon: CheckCircle },
  rejected:   { color: '#f87171', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.2)',   icon: XCircle },
  reimbursed: { color: '#60a5fa', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)',  icon: DollarSign },
};

// ── Input component ──────────────────────────────────────────────────────

function FormInput({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-slate-400 font-mono tracking-widest">
        {label}{required && <span className="text-blue-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  background: AXIOM.inputs.background,
  border: AXIOM.inputs.border,
  color: '#ffffff',
  outline: 'none',
};

function formatExpenseCurrency(currency: string, amount: number): string {
  const code = (currency || 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

// ── Main Component ──────────────────────────────────────────────────────

export function MyExpenses() {
  const { user, currentOrganization } = useAuth();
  const { getSelectableCurrencyCodes, featureFlags: globalFeatureFlags } = usePlatformSettings();
  const selectableCurrencies = getSelectableCurrencyCodes(currentOrganization?.currency || 'USD');
  const orgId = currentOrganization?.id || '';
  const userId = user?.id ?? '';

  // ── Data ──
  const { data: serviceExpenses, loading, error, refetch } = useService(
    () => (orgId && userId ? employeeService.getExpenses(orgId, userId) : Promise.resolve({ success: true, data: [] })),
    [orgId, userId],
    ['expenses'],
  );

  // ── Mutations ──
  const createMutation = useMutation(
    (data: Omit<Expense, 'id' | 'organizationId' | 'userId'>) =>
      employeeService.createExpense(orgId, userId, data),
  );
  const submitMutation = useMutation(
    (id: string) => employeeService.submitExpense(id, orgId),
  );

  // ── Local state ──
  const [filter,      setFilter]      = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm,    setShowForm]    = useState(false);
  const [formData,    setFormData]    = useState<ExpenseFormData>(() => freshExpenseForm());
  const [formError,   setFormError]   = useState('');
  const [toast,       setToast]       = useState<{ text: string; variant: 'success' | 'error' } | null>(null);
  const expenseActionLockRef = useRef(false);
  const toastDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [attachedReceipt, setAttachedReceipt] = useState<{ dataUrl: string; fileName: string } | null>(null);

  useEffect(
    () => () => {
      if (toastDismissRef.current) clearTimeout(toastDismissRef.current);
    },
    [],
  );

  // ── Derived data ──
  const expenses: ExpenseClaim[] = useMemo(
    () =>
      (serviceExpenses ?? []).map(e => ({
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        status: e.status === 'submitted' ? 'pending' as const : e.status as ExpenseClaim['status'],
        receipt: !!e.receiptUrl,
        project: e.projectId,
        notes: e.notes,
        rejectionReason: e.rejectionReason,
      })),
    [serviceExpenses],
  );

  const filtered = expenses.filter(e => {
    if (filter !== 'all' && e.status !== filter) return false;
    if (searchQuery && !e.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const totals = {
    pending:    expenses.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0),
    approved:   expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0),
    reimbursed: expenses.filter(e => e.status === 'reimbursed').reduce((s, e) => s + e.amount, 0),
  };

  const expenseAi = useMemo(() => {
    const amt = parseFloat(formData.amount);
    const amount = !formData.amount || Number.isNaN(amt) ? 0 : amt;
    const narrationSuggestion = globalFeatureFlags.ai_category_suggestions ? suggestCategoryFromNarration(formData.description) : null;
    const duplicates =
      amount > 0 && formData.description.trim().length >= 3 && serviceExpenses
        ? findLikelyDuplicates(
            {
              description: formData.description,
              amount,
              date: formData.date,
              currency: formData.currency,
            },
            serviceExpenses,
          )
        : [];
    const policy =
      amount > 0
        ? policyNotesForDraft({
            category: formData.category,
            amount,
            currency: formData.currency,
          })
        : [];
    return { narrationSuggestion, duplicates, policy };
  }, [formData, serviceExpenses]);

  // ── Helpers ──
  const showToast = (text: string, variant: 'success' | 'error' = 'success') => {
    if (toastDismissRef.current) clearTimeout(toastDismissRef.current);
    setToast({ text, variant });
    toastDismissRef.current = setTimeout(() => {
      setToast(null);
      toastDismissRef.current = null;
    }, 3000);
  };

  const handleChange = (field: keyof ExpenseFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formError) setFormError('');
  };

  const validate = (): boolean => {
    if (!formData.description.trim()) { setFormError('Description is required'); return false; }
    const amt = parseFloat(formData.amount);
    if (!formData.amount || isNaN(amt) || amt <= 0) {
      setFormError('Enter a valid amount greater than 0');
      return false;
    }
    const d = formData.date?.trim() ?? '';
    if (!d) {
      setFormError('Date is required');
      return false;
    }
    return true;
  };

  const clearReceiptAttachment = () => {
    setAttachedReceipt(null);
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  };

  const resetForm = () => {
    setFormData(freshExpenseForm());
    setFormError('');
    setShowForm(false);
    clearReceiptAttachment();
  };

  const handleReceiptFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_RECEIPT_FILE_BYTES) {
      setFormError(`Receipt must be ${Math.round(MAX_RECEIPT_FILE_BYTES / (1024 * 1024 * 1024))} GB or smaller (image).`);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:')) {
        setFormError('Could not read receipt');
        return;
      }
      setAttachedReceipt({ dataUrl, fileName: file.name });
      setFormError('');
    };
    reader.onerror = () => {
      setFormError('Could not read receipt');
    };
    reader.readAsDataURL(file);
  };

  const buildExpensePayload = (status: Expense['status']): Omit<Expense, 'id' | 'organizationId' | 'userId'> => ({
    date: formData.date,
    description: formData.description.trim(),
    amount: parseFloat(formData.amount),
    currency: formData.currency,
    category: formData.category,
    status,
    notes: formData.notes || undefined,
    projectId: formData.project || undefined,
    receiptUrl: attachedReceipt?.dataUrl,
    submittedAt: status === 'submitted' ? new Date().toISOString() : undefined,
  });

  // ── Handlers ──
  const handleSubmitClaim = async () => {
    if (!validate()) return;
    if (expenseActionLockRef.current) return;
    expenseActionLockRef.current = true;
    try {
      const result = await createMutation.execute(buildExpensePayload('submitted'));
      if (result.success) {
        await refetch();
        resetForm();
        showToast('Expense claim submitted successfully');
      } else {
        setFormError(result.error ?? 'Submission failed');
      }
    } finally {
      expenseActionLockRef.current = false;
    }
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    if (expenseActionLockRef.current) return;
    expenseActionLockRef.current = true;
    try {
      const result = await createMutation.execute(buildExpensePayload('draft'));
      if (result.success) {
        await refetch();
        resetForm();
        showToast('Draft saved');
      } else {
        setFormError(result.error ?? 'Could not save draft');
      }
    } finally {
      expenseActionLockRef.current = false;
    }
  };

  const handleSubmitDraft = async (id: string) => {
    if (expenseActionLockRef.current) return;
    expenseActionLockRef.current = true;
    try {
      const result = await submitMutation.execute(id);
      if (result.success) {
        await refetch();
        showToast(
          result.message?.trim()
            ? result.message
            : 'Expense submitted for review',
        );
      } else {
        showToast(result.error ?? 'Could not submit expense', 'error');
      }
    } finally {
      expenseActionLockRef.current = false;
    }
  };

  const isMutating = createMutation.loading || submitMutation.loading;

  // ── Render ──
  return (
    <PageShell>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl"
            style={
              toast.variant === 'error'
                ? {
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.35)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 10px 40px -10px rgba(239,68,68,0.35)',
                  }
                : {
                    background: 'rgba(16,185,129,0.15)',
                    border: '1px solid rgba(16,185,129,0.4)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 10px 40px -10px rgba(16,185,129,0.4)',
                  }
            }
          >
            {toast.variant === 'error' ? (
              <AlertCircle className="size-5 text-red-400 shrink-0" />
            ) : (
              <CheckCircle className="size-5 text-green-400 shrink-0" />
            )}
            <span className="text-white text-sm font-mono">{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <PageHeader
          title="My Expenses"
          description="Submit and track your expense claims"
          actions={
            <button
              type="button"
              onClick={() => {
                setShowForm(v => !v);
                setFormError('');
                setFormData(freshExpenseForm());
                clearReceiptAttachment();
              }}
              className="flex items-center gap-2 min-h-10 px-5 sm:px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-all touch-manipulation"
              style={AXIOM.buttons.action}
            >
              <Plus className="size-5 shrink-0" />
              New Expense
            </button>
          }
        />
      </motion.div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-amber-200 text-sm font-mono border border-amber-500/30 flex flex-wrap items-center justify-between gap-3"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono border border-amber-500/40 text-amber-100 hover:bg-amber-500/10 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Pending',    amount: totals.pending,    color: 'amber', icon: Clock },
          { label: 'Approved',   amount: totals.approved,   color: 'green', icon: CheckCircle },
          { label: 'Reimbursed', amount: totals.reimbursed, color: 'blue',  icon: DollarSign },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="rounded-xl p-5"
            style={{
              background: AXIOM.backgrounds.chartContainer,
              border:    AXIOM.borders[item.color as keyof typeof AXIOM.borders]  || AXIOM.borders.default,
              boxShadow: AXIOM.shadows[item.color as keyof typeof AXIOM.shadows] || AXIOM.shadows.default,
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-mono mb-1">{item.label.toUpperCase()}</p>
                <p className="text-2xl font-bold text-white">${item.amount.toFixed(2)}</p>
              </div>
              <item.icon className={`size-8 opacity-50`} style={{ color: statusConfig[item.label.toLowerCase()]?.color }} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── New Expense Form ── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-2xl p-6"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: '1px solid rgba(59,130,246,0.3)',
                boxShadow: '0 20px 60px -20px rgba(59,130,246,0.3)',
              }}
            >
              {/* Form header */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-white font-bold flex items-center gap-2">
                  <Pencil className="size-4 text-blue-400" />
                  New Expense Claim
                </h3>
                <button onClick={resetForm} className="text-slate-500 hover:text-slate-300 transition-colors">
                  <X className="size-5" />
                </button>
              </div>

              {/* Form grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">

                <FormInput label="DESCRIPTION" required>
                  <input
                    type="text"
                    placeholder="e.g. Client Dinner – Acme Corp"
                    value={formData.description}
                    onChange={e => handleChange('description', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono lg:col-span-2"
                    style={inputStyle}
                  />
                </FormInput>

                <FormInput label="DATE" required>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => handleChange('date', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                    style={{ ...inputStyle, colorScheme: 'dark' }}
                  />
                </FormInput>

                <FormInput label="CATEGORY" required>
                  <select
                    value={formData.category}
                    onChange={e => handleChange('category', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                    style={inputStyle}
                  >
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormInput>

                <FormInput label="AMOUNT" required>
                  <input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={formData.amount}
                    onChange={e => handleChange('amount', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                    style={inputStyle}
                  />
                </FormInput>

                <FormInput label="CURRENCY">
                  <select
                    value={formData.currency}
                    onChange={e => handleChange('currency', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                    style={inputStyle}
                  >
                    {selectableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormInput>

                <FormInput label="PROJECT / CLIENT (OPTIONAL)">
                  <input
                    type="text"
                    placeholder="Project or client name"
                    value={formData.project}
                    onChange={e => handleChange('project', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                    style={inputStyle}
                  />
                </FormInput>

                <div className="md:col-span-2 lg:col-span-3">
                  <FormInput label="NOTES (OPTIONAL)">
                    <textarea
                      placeholder="Justification, context, or policy reference…"
                      value={formData.notes}
                      onChange={e => handleChange('notes', e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 rounded-lg text-sm font-mono resize-none"
                      style={inputStyle}
                    />
                  </FormInput>
                </div>
              </div>

              {/* Expenses AI — calm, optional guidance (no blocking) */}
              {showForm && (expenseAi.narrationSuggestion || expenseAi.duplicates.length > 0 || expenseAi.policy.length > 0) && (
                <div
                  className="mb-4 rounded-xl p-4 space-y-3"
                  style={{
                    background: 'rgba(148, 163, 184, 0.06)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                  }}
                >
                  <div className="flex items-center gap-2 text-slate-400">
                    <Sparkles className="size-4 shrink-0 text-slate-500" />
                    <span className="text-[10px] font-mono tracking-widest uppercase">Assistant</span>
                  </div>

                  {expenseAi.narrationSuggestion &&
                    expenseAi.narrationSuggestion.category !== formData.category && (
                    <div className="text-sm text-slate-300 space-y-2">
                      <p>
                        <span className="text-slate-500 font-mono text-xs">{confidenceLabel(expenseAi.narrationSuggestion.confidence)}</span>
                        {' — '}
                        Suggested category: <span className="text-white">{expenseAi.narrationSuggestion.category}</span>
                      </p>
                      <p className="text-xs text-slate-500 font-mono leading-relaxed">{expenseAi.narrationSuggestion.reason}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setFormData(f => ({ ...f, category: expenseAi.narrationSuggestion!.category }))
                        }
                        className="text-xs font-mono px-3 py-1.5 rounded-lg transition-colors"
                        style={AXIOM.buttons.outline}
                      >
                        Use suggestion
                      </button>
                    </div>
                  )}

                  {expenseAi.duplicates.length > 0 && (
                    <div className="pt-1 border-t border-slate-700/50 space-y-2">
                      <p className="text-xs text-amber-200/90 font-mono flex items-center gap-2">
                        <AlertCircle className="size-3.5 shrink-0 text-amber-400/80" />
                        Possible duplicate{expenseAi.duplicates.length > 1 ? 's' : ''} — review before submitting.
                      </p>
                      <ul className="space-y-1.5 text-xs text-slate-400 font-mono">
                        {expenseAi.duplicates.map(d => (
                          <li key={d.id} className="pl-1">
                            <span className="text-slate-500">{confidenceLabel(d.confidence)}:</span>{' '}
                            {d.description} (${d.amount.toFixed(2)}, {d.date}) — {d.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {expenseAi.policy.map((note, i) => (
                    <div
                      key={i}
                      className={`text-xs font-mono leading-relaxed ${
                        i > 0 || (i === 0 && (!!expenseAi.narrationSuggestion || expenseAi.duplicates.length > 0))
                          ? 'border-t border-slate-700/50 pt-2 mt-2'
                          : ''
                      }`}
                    >
                      <p className={note.severity === 'warning' ? 'text-amber-200/85' : 'text-slate-400'}>
                        <span className="text-slate-500">{confidenceLabel(note.confidence)}</span>
                        {' — '}
                        {note.message}
                      </p>
                      <p className="text-slate-500 mt-1">{note.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Error */}
              <AnimatePresence>
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg overflow-hidden"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    <AlertCircle className="size-4 text-red-400 shrink-0" />
                    <p className="text-red-400 text-sm font-mono">{formError}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div className="flex flex-col gap-3">
                <input
                  ref={receiptInputRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleReceiptFileChange}
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => receiptInputRef.current?.click()}
                    disabled={isMutating}
                    title="Attach an image of your receipt (max 1 GB)"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm disabled:opacity-50 transition-all"
                    style={AXIOM.buttons.outline}
                  >
                    <Upload className="size-4" />
                    {attachedReceipt ? 'Change receipt' : 'Attach receipt'}
                  </button>
                  {attachedReceipt && (
                    <div className="flex items-center gap-2 min-w-0 text-xs font-mono text-slate-400">
                      <CheckCircle className="size-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate max-w-[12rem]" title={attachedReceipt.fileName}>
                        {attachedReceipt.fileName}
                      </span>
                      <button
                        type="button"
                        onClick={clearReceiptAttachment}
                        disabled={isMutating}
                        className="text-slate-500 hover:text-slate-300 shrink-0 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 font-mono">
                  Images only (JPEG, PNG, GIF, WebP), up to 1 GB — stored on this device for the demo.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleSubmitClaim}
                    disabled={isMutating}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition-all"
                    style={AXIOM.buttons.success}
                  >
                    {createMutation.loading
                      ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Send className="size-4" />}
                    Submit Claim
                  </button>

                  <button
                    onClick={handleSaveDraft}
                    disabled={isMutating}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm disabled:opacity-50 transition-all"
                    style={AXIOM.buttons.outline}
                  >
                    <Receipt className="size-4" />
                    Save Draft
                  </button>

                  <button
                    onClick={resetForm}
                    className="ml-auto px-4 py-2.5 rounded-lg text-slate-400 text-sm transition-all"
                    style={AXIOM.buttons.secondary}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter & Search */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search expenses…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-lg text-white font-mono text-sm"
            style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'draft', 'pending', 'approved', 'rejected', 'reimbursed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-4 py-2.5 rounded-lg text-xs font-mono capitalize transition-all"
              style={filter === f ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
            >
              {f}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Expense List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl overflow-hidden"
        style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}
      >
        <div className="divide-y" style={{ borderColor: 'rgba(148,163,184,0.1)' }}>
          {error ? (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">
              Could not load expenses. Try refreshing the page.
            </div>
          ) : serviceExpenses === null && loading ? (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">Loading expenses…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Receipt className="size-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 font-mono">No expenses found</p>
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="mt-3 text-xs text-blue-400 font-mono hover:text-blue-300">
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            filtered.map((expense, i) => {
            const sc = statusConfig[expense.status];
            const StatusIcon = sc.icon;
            const isDraft = expense.status === 'draft';

            return (
              <motion.div
                key={expense.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.03 }}
                className="flex items-center gap-4 p-5 hover:bg-white/5 transition-colors group"
              >
                {/* Status icon */}
                <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{
                  background: sc.bg,
                  border: `1px solid ${sc.border}`,
                }}>
                  <StatusIcon className="size-5" style={{ color: sc.color }} />
                </div>

                {/* Description + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{expense.description}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-slate-400 font-mono">{expense.date}</span>
                    <span className="text-xs text-slate-500 font-mono">{expense.category}</span>
                    {expense.project && (
                      <span className="text-xs text-purple-400/70 font-mono">{expense.project}</span>
                    )}
                    {(expense.rejectionReason || expense.notes) && (
                      <span className="text-xs text-slate-400 font-mono italic truncate max-w-40">
                        {expense.status === 'rejected' ? `Rejected: ${expense.rejectionReason || expense.notes?.replace(/^REJECTED:\s*/, '')}` : expense.notes}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right side */}
                <div className="flex items-center gap-3 shrink-0">
                  {expense.receipt && <Receipt className="size-4 text-green-400/50" />}

                  <span className="text-lg font-bold text-white font-mono tabular-nums">
                    {formatExpenseCurrency(expense.currency, expense.amount)}
                  </span>

                  <span className="text-xs font-mono px-2 py-1 rounded capitalize" style={{
                    background: sc.bg,
                    border: `1px solid ${sc.border}`,
                    color: sc.color,
                  }}>
                    {expense.status}
                  </span>

                  {/* Submit draft button */}
                  {isDraft && (
                    <button
                      type="button"
                      onClick={() => handleSubmitDraft(expense.id)}
                      disabled={isMutating}
                      title="Submit for review"
                      className="flex items-center justify-center gap-1.5 min-h-10 min-w-10 px-3.5 py-2 rounded-lg text-xs font-mono touch-manipulation disabled:opacity-30 transition-all"
                      style={AXIOM.buttons.action}
                    >
                      {submitMutation.loading
                        ? <div className="size-3 border border-white/30 border-t-white rounded-full animate-spin" />
                        : <Send className="size-3" />}
                      Submit
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })
          )}
        </div>
      </motion.div>
    </PageShell>
  );
}