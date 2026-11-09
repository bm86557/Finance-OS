import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Repeat, Plus, Edit, Trash2, Pause, Play, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from '../../../contexts/ThemeContext';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import type { RecurringTransaction as ServiceRT } from '@/services/types';
import { validateRecurringDateOrder } from '@/services/recurringTransactionService';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

type UiType = 'income' | 'expense';

interface RecurringRowVM extends Omit<ServiceRT, 'type'> {
  name: string;
  accountName: string;
  category: string;
  type: UiType;
  nextDue: string;
  status: 'active' | 'paused';
  /** null when the record has no run tracking (default for new schedules). */
  runsProgress: { done: number; of: number } | null;
  autoGenerate: boolean;
  scopeLabel: string;
}

function toRowVM(
  r: ServiceRT,
  categoryMap: Map<string, string>,
  bankMap: Map<string, string>,
  deptMap: Map<string, string>,
  projectMap: Map<string, string>,
): RecurringRowVM {
  const g = r.generatedOccurrenceCount;
  const t = r.totalOccurrencesExpected;
  const runsProgress =
    typeof g === 'number' &&
    typeof t === 'number' &&
    t > 0 &&
    Number.isFinite(g) &&
    Number.isFinite(t)
      ? { done: Math.max(0, Math.floor(g)), of: Math.floor(t) }
      : null;

  let scopeLabel = 'Whole organization';
  if (r.projectId) {
    scopeLabel = projectMap.get(r.projectId) ?? 'Project';
  } else if (r.departmentId) {
    scopeLabel = deptMap.get(r.departmentId) ?? 'Department';
  }

  return {
    ...r,
    name: r.description,
    type: r.type === 'credit' ? 'income' : 'expense',
    category: categoryMap.get(r.categoryId) ?? 'Uncategorised',
    accountName:
      bankMap.get(r.bankAccountId) ??
      (r.bankAccountId ? `…${String(r.bankAccountId).slice(-6)}` : '—'),
    nextDue: r.nextOccurrence,
    status: r.isActive ? 'active' : 'paused',
    runsProgress,
    autoGenerate: true,
    scopeLabel,
  };
}

const FREQUENCIES: ServiceRT['frequency'][] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecurringTransactions() {
  const { theme } = useTheme();
  const svc = useOrgServices();

  const { data: rawList, loading, error, refetch: refetchRecurring } = useServiceArray(
    () => svc.recurring.getAll(),
    [svc.orgId],
    ['recurringTransactions'],
  );

  const { data: totals, refetch: refetchTotals } = useService(
    () => svc.recurring.getTotals(),
    [svc.orgId],
    ['recurringTransactions'],
  );

  const { data: categories } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );

  const { data: bankAccounts } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts'],
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

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
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

  const deptMap = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const rows = useMemo(
    () => {
      const result = rawList.map((r) => toRowVM(r, categoryMap, bankMap, deptMap, projectMap));
      
      // Debug: Log to check dates
      const today = new Date().toISOString().split('T')[0];
      console.log('[RecurringTransactions] Today:', today);
      console.log('[RecurringTransactions] System date check:', {
        jsDate: new Date().toString(),
        isoDate: new Date().toISOString(),
        localDate: new Date().toLocaleDateString(),
      });
      
      result.forEach(row => {
        const isDue = row.nextDue <= today && row.status === 'active';
        console.log(`[RecurringTransactions] ${row.name}: nextDue=${row.nextDue}, today=${today}, isDue=${isDue}, status=${row.status}`);
      });
      
      return result;
    },
    [rawList, categoryMap, bankMap, deptMap, projectMap],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState('PKR');
  const [formType, setFormType] = useState<UiType>('expense');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formBankId, setFormBankId] = useState('');
  const [formFrequency, setFormFrequency] = useState<ServiceRT['frequency']>('monthly');
  const [formStart, setFormStart] = useState(todayISODate());
  const [formNext, setFormNext] = useState(todayISODate());
  const [formEnd, setFormEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'paused'>('all');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');

  const filtered = rows.filter((txn) => {
    const okStatus = filterStatus === 'all' || txn.status === filterStatus;
    const okType = filterType === 'all' || txn.type === filterType;
    return okStatus && okType;
  });

  const resetForm = () => {
    setFormDescription('');
    setFormAmount('');
    setFormCurrency('PKR');
    setFormType('expense');
    setFormCategoryId(categories[0]?.id ?? '');
    setFormBankId(bankAccounts[0]?.id ?? '');
    setFormFrequency('monthly');
    const t = todayISODate();
    setFormStart(t);
    setFormNext(t);
    setFormEnd('');
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEdit = (txn: RecurringRowVM) => {
    setEditingId(txn.id);
    setFormDescription(txn.description);
    setFormAmount(String(txn.amount));
    setFormCurrency(txn.currency);
    setFormType(txn.type);
    setFormCategoryId(txn.categoryId || categories[0]?.id || '');
    setFormBankId(txn.bankAccountId);
    setFormFrequency(txn.frequency);
    setFormStart(txn.startDate.slice(0, 10));
    setFormNext(txn.nextOccurrence.slice(0, 10));
    setFormEnd(txn.endDate ? txn.endDate.slice(0, 10) : '');
    setEditOpen(true);
  };

  const submitCreate = async () => {
    const desc = formDescription.trim();
    const amt = Number.parseFloat(formAmount.replace(/,/g, ''));
    if (!desc) {
      toast.error('Add a short name or description.');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount.');
      return;
    }
    if (!formBankId) {
      toast.error('Choose an account.');
      return;
    }
    const dateErr = validateRecurringDateOrder(formStart, formNext);
    if (dateErr) {
      toast.error(dateErr);
      return;
    }
    setSaving(true);
    try {
      const res = await svc.recurring.create({
        description: desc,
        amount: amt,
        currency: formCurrency,
        type: formType === 'income' ? 'credit' : 'debit',
        categoryId: formCategoryId || '',
        bankAccountId: formBankId,
        frequency: formFrequency,
        startDate: formStart,
        nextOccurrence: formNext,
        endDate: formEnd || undefined,
        isActive: true,
      });
      if (res.success) {
        toast.success('Recurring schedule saved');
        setCreateOpen(false);
        resetForm();
      } else {
        toast.error(res.error ?? 'Could not create.');
      }
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editingId) return;
    const desc = formDescription.trim();
    const amt = Number.parseFloat(formAmount.replace(/,/g, ''));
    if (!desc || !Number.isFinite(amt) || amt <= 0) {
      toast.error('Check description and amount.');
      return;
    }
    if (!formBankId) {
      toast.error('Choose an account.');
      return;
    }
    const dateErr = validateRecurringDateOrder(formStart, formNext);
    if (dateErr) {
      toast.error(dateErr);
      return;
    }
    setSaving(true);
    try {
      const res = await svc.recurring.update(editingId, {
        description: desc,
        amount: amt,
        currency: formCurrency,
        type: formType === 'income' ? 'credit' : 'debit',
        categoryId: formCategoryId || '',
        bankAccountId: formBankId,
        frequency: formFrequency,
        startDate: formStart,
        nextOccurrence: formNext,
        endDate: formEnd || undefined,
      });
      if (res.success) {
        toast.success('Schedule updated');
        setEditOpen(false);
        resetForm();
      } else {
        toast.error(res.error ?? 'Could not update.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    const res = await svc.recurring.toggle(id);
    if (res.success) {
      toast.success(res.data?.isActive ? 'Resumed' : 'Paused');
    } else {
      toast.error(res.error ?? 'Could not update status.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this recurring schedule?')) return;
    const res = await svc.recurring.delete(id);
    if (res.success) {
      toast.success('Removed');
    } else {
      toast.error(res.error ?? 'Could not delete.');
    }
  };

  const handleGenerate = async () => {
    if (!window.confirm('Generate transactions for all due recurring schedules up to today?')) return;
    const res = await svc.recurring.generate(svc.orgId);
    if (res.success) {
      toast.success(res.message || 'Transactions generated');
      // Refetch data to update Period Status and Runs for all affected schedules
      await Promise.all([refetchRecurring(), refetchTotals()]);
    } else {
      toast.error(res.error || 'Could not generate.');
    }
  };

  const handleGenerateSingle = async (recurringId: string) => {
    const res = await svc.recurring.generateSingle(recurringId);
    if (res.success) {
      toast.success('Transaction generated and added to ledger');
      // Refetch data to update: next occurrence, generated count, period status, and runs progress
      await Promise.all([refetchRecurring(), refetchTotals()]);
    } else {
      toast.error(res.error || 'Could not generate transaction.');
    }
  };

  const activeRows = rows.filter((t) => t.status === 'active');
  const totalMonthlyIncome = totals?.monthlyIncome ?? 0;
  const totalMonthlyExpense = totals?.monthlyExpense ?? 0;

  const dialogSurface =
    theme === 'light'
      ? 'border-slate-200 bg-white text-slate-900'
      : 'border-slate-700 bg-slate-950 text-slate-100';

  const FormFields = (
    <div className="space-y-3 pt-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
        <input
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          placeholder="e.g. Rent, SaaS subscription"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Amount</label>
          <input
            type="text"
            inputMode="decimal"
            value={formAmount}
            onChange={(e) => setFormAmount(e.target.value)}
            className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Currency</label>
          <select
            value={formCurrency}
            onChange={(e) => setFormCurrency(e.target.value)}
            className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          >
            <option value="PKR">PKR</option>
            <option value="USD">USD</option>
            <option value="AED">AED</option>
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Type</label>
        <select
          value={formType}
          onChange={(e) => setFormType(e.target.value as UiType)}
          className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Category</label>
        <select
          value={formCategoryId}
          onChange={(e) => setFormCategoryId(e.target.value)}
          className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
        >
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Account</label>
        <select
          value={formBankId}
          onChange={(e) => setFormBankId(e.target.value)}
          disabled={!bankAccounts.length}
          className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white disabled:opacity-50"
        >
          <option value="">Select account…</option>
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {bankMap.get(b.id)}
            </option>
          ))}
        </select>
        {!bankAccounts.length && (
          <p className="mt-1 text-xs text-amber-200/90">Add a bank account under Accounts first.</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Frequency</label>
        <select
          value={formFrequency}
          onChange={(e) => setFormFrequency(e.target.value as ServiceRT['frequency'])}
          className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Start date</label>
          <input
            type="date"
            value={formStart}
            onChange={(e) => setFormStart(e.target.value)}
            className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Next occurrence</label>
          <input
            type="date"
            value={formNext}
            onChange={(e) => setFormNext(e.target.value)}
            className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          End date <span className="text-slate-500">(optional — leave blank for ongoing)</span>
        </label>
        <input
          type="date"
          value={formEnd}
          onChange={(e) => setFormEnd(e.target.value)}
          className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          placeholder="Leave blank for ongoing"
        />
        {formEnd && formStart && (
          <p className="mt-1 text-xs text-blue-300">
            {(() => {
              const start = new Date(formStart);
              const end = new Date(formEnd);
              const diffDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              const approxOccurrences = 
                formFrequency === 'daily' ? diffDays :
                formFrequency === 'weekly' ? Math.floor(diffDays / 7) :
                formFrequency === 'monthly' ? Math.floor(diffDays / 30.4375) :
                formFrequency === 'quarterly' ? Math.floor(diffDays / 91.3125) :
                formFrequency === 'yearly' ? Math.floor(diffDays / 365.25) : 0;
              return `≈ ${Math.max(0, approxOccurrences)} ${formFrequency} occurrences`;
            })()}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="min-h-screen space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8"
      style={{ background: AXIOM.backgrounds.main }}
    >
      {error && (
        <p className="rounded-xl border border-amber-500/40 px-4 py-3 text-sm text-amber-100" role="alert">
          {error}
        </p>
      )}

      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Repeat className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl md:text-4xl" style={AXIOM.text.titleStyle}>
                Recurring Transactions
              </h1>
              <p className="text-xs text-slate-400 sm:text-sm">Automate regular income and expenses</p>
            </div>
          </div>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
              style={{
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(236, 72, 153, 0.4))',
                border: '1px solid rgba(168, 85, 247, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)',
                color: '#ffffff',
              }}
              onClick={handleGenerate}
            >
              <Clock className="size-4" />
              Generate Due
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
              onClick={openCreate}
            >
              <Plus className="size-4" />
              New recurring
            </motion.button>
          </div>
        </div>

        {/* Info banner explaining how recurring transactions work */}
        <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          <p className="font-medium">💡 How recurring transactions work:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-blue-200">
            <li>Recurring schedules are <strong>templates</strong> for future transactions</li>
            <li>They do <strong>not affect</strong> your current bank balance</li>
            <li>When the due date arrives, click <strong>"Generate Due"</strong> to create actual transactions</li>
            <li>Only generated transactions update your bank balance</li>
          </ul>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Active</p>
              <p className="text-2xl font-bold text-white">{activeRows.length}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.blue,
                boxShadow: AXIOM.shadows.iconBlue,
              }}
            >
              <Repeat className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Monthly income</p>
              <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalMonthlyIncome, 'PKR')}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
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
          transition={{ delay: 0.2 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Monthly expense</p>
              <p className="text-2xl font-bold text-red-400">{formatCurrency(totalMonthlyExpense, 'PKR')}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
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
          transition={{ delay: 0.25 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Net monthly</p>
              <p
                className={`text-2xl font-bold ${
                  totalMonthlyIncome - totalMonthlyExpense >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatCurrency(totalMonthlyIncome - totalMonthlyExpense, 'PKR')}
              </p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Clock className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl p-6"
        style={AXIOM.containers.list}
      >
        <div className="flex flex-wrap gap-3">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'active' | 'paused')}
            className="h-10 rounded-xl px-3"
            style={{
              background: AXIOM.inputs.background,
              border: AXIOM.inputs.border,
              color: AXIOM.inputs.color,
            }}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | 'income' | 'expense')}
            className="h-10 rounded-xl px-3"
            style={{
              background: AXIOM.inputs.background,
              border: AXIOM.inputs.border,
              color: AXIOM.inputs.color,
            }}
          >
            <option value="all">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="overflow-hidden rounded-2xl"
        style={AXIOM.containers.list}
      >
        {/* Mobile/Tablet: Enable horizontal scroll for table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                <th className="px-3 py-4 text-left text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Name
                </th>
                <th className="px-3 py-4 text-left text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Category
                </th>
                <th className="hidden px-3 py-4 text-left text-xs font-medium sm:table-cell lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Scope
                </th>
                <th className="px-3 py-4 text-left text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Frequency
                </th>
                <th className="px-3 py-4 text-left text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Period Status
                </th>
                <th className="px-3 py-4 text-left text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Next due
                </th>
                <th className="px-3 py-4 text-right text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Amount
                </th>
                <th className="hidden px-3 py-4 text-center text-xs font-medium md:table-cell lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Auto
                </th>
                <th className="px-3 py-4 text-center text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Status
                </th>
                <th className="px-3 py-4 text-center text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Runs
                </th>
                <th className="px-3 py-4 text-right text-xs font-medium lg:px-4" style={{ color: AXIOM.text.slate400 }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && rawList.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
                    Loading…
                  </td>
                </tr>
              ) : !loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center">
                    <p className="text-base font-medium text-white">No recurring schedules yet</p>
                    <p className="mt-2 text-sm" style={{ color: AXIOM.text.slate400 }}>
                      Create rent, subscriptions, or payroll so they appear here.
                    </p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
                    Nothing matches these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((txn, idx) => {
                  const rp = txn.runsProgress;
                  const pct =
                    rp && rp.of > 0 ? Math.min(100, Math.round((rp.done / rp.of) * 100)) : 0;
                  return (
                    <motion.tr
                      key={txn.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 + idx * 0.03 }}
                      className="group"
                      style={{
                        borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                      }}
                    >
                      <td className="px-3 py-4 lg:px-4">
                        <p className="text-sm font-medium text-white">{txn.name}</p>
                      </td>
                      <td className="px-3 py-4 text-sm lg:px-4" style={{ color: AXIOM.text.slate300 }}>
                        {txn.category}
                      </td>
                      <td className="hidden px-3 py-4 text-sm sm:table-cell lg:px-4" style={{ color: AXIOM.text.slate300 }}>
                        {txn.scopeLabel}
                      </td>
                      <td className="px-3 py-4 lg:px-4">
                        <span className="rounded-lg px-2 py-1 text-xs font-medium capitalize" style={AXIOM.badges.purple}>
                          {txn.frequency}
                        </span>
                      </td>
                      <td className="px-3 py-4 lg:px-4">
                        <div className="flex flex-col gap-1">
                          {txn.isPaidForCurrentPeriod ? (
                            <>
                              <span className="whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>
                                ✓ PAID
                              </span>
                              <span className="text-xs" style={{ color: AXIOM.text.slate400 }}>
                                Next: {formatDate(txn.nextDue)}
                              </span>
                            </>
                          ) : (
                            <span className="whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                              ✗ UNPAID - {txn.frequency === 'monthly' ? new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 
                               txn.frequency === 'weekly' ? `Week ${Math.ceil(new Date().getDate() / 7)}` :
                               txn.frequency === 'quarterly' ? `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}` :
                               txn.frequency === 'yearly' ? new Date().getFullYear().toString() :
                               'Today'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 lg:px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm" style={{ color: AXIOM.text.slate300 }}>
                            {formatDate(txn.nextDue)}
                          </span>
                          {!txn.isPaidForCurrentPeriod && txn.status === 'active' && (
                            <span className="whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                              DUE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right lg:px-4">
                        <span
                          className="whitespace-nowrap font-mono text-sm font-bold"
                          style={{ color: txn.type === 'income' ? '#10b981' : '#ef4444' }}
                        >
                          {txn.type === 'income' ? '+' : '-'}
                          {formatCurrency(Math.abs(txn.amount), txn.currency)}
                        </span>
                      </td>
                      <td className="hidden px-3 py-4 text-center md:table-cell lg:px-4">
                        {txn.autoGenerate ? (
                          <span className="rounded-lg px-2 py-1 text-xs font-medium" style={AXIOM.badges.success}>
                            Auto
                          </span>
                        ) : (
                          <span className="rounded-lg px-2 py-1 text-xs font-medium" style={AXIOM.badges.warning}>
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-4 text-center lg:px-4">
                        <span
                          className="rounded-lg px-2 py-1 text-xs font-medium capitalize"
                          style={
                            txn.status === 'active'
                              ? AXIOM.badges.success
                              : txn.status === 'paused'
                                ? AXIOM.badges.warning
                                : AXIOM.badges.info
                          }
                        >
                          {txn.status}
                        </span>
                      </td>
                      <td className="px-3 py-4 lg:px-4">
                        {rp ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-2 w-20 rounded-full lg:w-24" style={{ background: 'rgba(148, 163, 184, 0.2)' }}>
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${pct}%`,
                                  background: 'linear-gradient(to right, rgb(168, 85, 247), rgb(236, 72, 153))',
                                }}
                              />
                            </div>
                            <span className="text-xs tabular-nums" style={{ color: AXIOM.text.slate400 }}>
                              {rp.done}/{rp.of}
                            </span>
                          </div>
                        ) : (
                          <p className="whitespace-nowrap text-center text-xs" style={{ color: AXIOM.text.slate400 }}>
                            Not tracked
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-4 lg:px-4">
                        <div className="flex items-center justify-end gap-1 opacity-100 pointer-fine:lg:opacity-0 pointer-fine:lg:group-hover:opacity-100">
                          {/* Show Generate button if NOT paid for current period */}
                          {!txn.isPaidForCurrentPeriod && txn.status === 'active' && (
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              className="flex h-8 w-8 items-center justify-center rounded-lg"
                              style={{
                                background: 'rgba(168, 85, 247, 0.3)',
                                color: '#a855f7',
                              }}
                              title="Generate transaction now"
                              onClick={() => void handleGenerateSingle(txn.id)}
                            >
                              <Clock className="size-3" />
                            </motion.button>
                          )}
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg"
                            style={{
                              background: 'rgba(0, 0, 0, 0.2)',
                              color: AXIOM.text.slate400,
                            }}
                            onClick={() => void handleToggle(txn.id)}
                          >
                            {txn.status === 'active' ? <Pause className="size-3" /> : <Play className="size-3" />}
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg"
                            style={{
                              background: 'rgba(0, 0, 0, 0.2)',
                              color: AXIOM.text.slate400,
                            }}
                            onClick={() => openEdit(txn)}
                          >
                            <Edit className="size-3" />
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg"
                            style={{ background: 'rgba(0, 0, 0, 0.2)', color: '#ef4444' }}
                            onClick={() => void handleDelete(txn.id)}
                          >
                            <Trash2 className="size-3" />
                          </motion.button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={`${dialogSurface} max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>New recurring schedule</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Saves to your organization. Uses the same accounts as Quick Add.
            </DialogDescription>
          </DialogHeader>
          {FormFields}
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !bankAccounts.length}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              onClick={() => void submitCreate()}
            >
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className={`${dialogSurface} max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>Edit schedule</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Changes apply to this recurring rule only.
            </DialogDescription>
          </DialogHeader>
          {FormFields}
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              onClick={() => void submitEdit()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
