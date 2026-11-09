import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CreditCard,
  Building2,
  Plus,
  Trash2,
  Wallet,
  Info,
} from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { AXIOM } from '../../../styles/axiom-tokens';
import { toast } from 'sonner';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useServiceArray } from '@/hooks/useService';
import type { BankAccount } from '@/services/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';

function isCardAccountType(t: BankAccount['accountType']): boolean {
  return t === 'credit_card' || t === 'line_of_credit' || t === 'debit_card' || t === 'prepaid_card';
}

function maskAccountRef(num: string): string {
  const s = num.trim();
  if (!s || s === '—' || s === '(see IBAN)') return '—';
  if (s.length <= 4) return s;
  return `•••• ${s.slice(-4)}`;
}

export function PaymentMethods() {
  const { theme } = useTheme();
  const { currentOrganization } = useAuth();
  const baseCurrency = currentOrganization?.currency || 'USD';
  const svc = useOrgServices();
  const goToOrgView = useOrgWorkspaceNav();

  const { data: allAccounts, loading, error, refetch } = useServiceArray(
    () => (svc.isReady ? svc.accounts.getBankAccounts() : Promise.resolve({ success: true as const, data: [] })),
    [svc.orgId, svc.isReady],
    ['bankAccounts', 'transactions'],
  );

  const { data: chartAccounts } = useServiceArray(
    () => (svc.isReady ? svc.accounts.getAll() : Promise.resolve({ success: true as const, data: [] })),
    [svc.orgId, svc.isReady],
    ['accounts'],
  );

  const assetChartOptions = useMemo(
    () => chartAccounts.filter((a) => (a.type === 'asset' || a.type === 'liability') && a.isActive),
    [chartAccounts],
  );

  const cardAccounts = useMemo(
    () => allAccounts.filter((a) => isCardAccountType(a.accountType)),
    [allAccounts],
  );

  const bankMethodAccounts = useMemo(
    () => allAccounts.filter((a) => !isCardAccountType(a.accountType)),
    [allAccounts],
  );

  const [addCardOpen, setAddCardOpen] = useState(false);
  const [addBankOpen, setAddBankOpen] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

  const [cardName, setCardName] = useState('');
  const [cardLastFour, setCardLastFour] = useState('');
  const [cardSubtype, setCardSubtype] = useState<
    'credit_card' | 'line_of_credit' | 'debit_card' | 'prepaid_card'
  >('credit_card');
  const [cardCurrency, setCardCurrency] = useState(baseCurrency);
  const [cardUsage, setCardUsage] = useState<'personal' | 'business'>('business');
  const [cardChartId, setCardChartId] = useState('');

  const [bankLabel, setBankLabel] = useState('');
  const [bankNumber, setBankNumber] = useState('');
  const [bankSubtype, setBankSubtype] = useState<'checking' | 'savings'>('checking');
  const [bankCurrency, setBankCurrency] = useState(baseCurrency);
  const [bankUsage, setBankUsage] = useState<'personal' | 'business'>('business');
  const [bankChartId, setBankChartId] = useState('');

  const resetCardForm = () => {
    setCardName('');
    setCardLastFour('');
    setCardSubtype('credit_card');
    setCardCurrency(baseCurrency);
    setCardUsage('business');
    setCardChartId(assetChartOptions[0]?.id ?? '');
  };

  const resetBankForm = () => {
    setBankLabel('');
    setBankNumber('');
    setBankSubtype('checking');
    setBankCurrency(baseCurrency);
    setBankUsage('business');
    setBankChartId(assetChartOptions[0]?.id ?? '');
  };

  const openAddCard = () => {
    resetCardForm();
    setCardChartId(assetChartOptions[0]?.id ?? '');
    setAddCardOpen(true);
  };

  const openAddBank = () => {
    resetBankForm();
    setBankChartId(assetChartOptions[0]?.id ?? '');
    setAddBankOpen(true);
  };

  const submitCard = async () => {
    const name = cardName.trim();
    const four = cardLastFour.replace(/\D/g, '').slice(0, 8);
    if (!name) {
      toast.error('Enter a name for this card.');
      return;
    }
    if (four.length < 4) {
      toast.error('Enter at least the last four digits.');
      return;
    }
    const chartId = cardChartId || assetChartOptions[0]?.id || '';
    
    console.log('[PaymentMethods] Creating card:', { name, four, cardSubtype, cardCurrency, chartId });
    
    setSavingCard(true);
    try {
      const res = await svc.accounts.createBankAccount({
        accountId: chartId,
        bankName: name,
        accountNumber: four,
        accountType: cardSubtype,
        currency: cardCurrency,
        balance: 0,
        isActive: true,
        usage: cardUsage,
      });
      
      console.log('[PaymentMethods] Create card result:', res);
      
      if (res.success) {
        toast.success(res.message ?? 'Card added');
        setAddCardOpen(false);
        resetCardForm();
        // Explicitly refetch to ensure we have latest data
        console.log('[PaymentMethods] Refetching accounts...');
        await refetch();
        console.log('[PaymentMethods] Refetch complete');
      } else {
        console.error('[PaymentMethods] Failed to create card:', res.error);
        toast.error(res.error ?? 'Could not add card.');
      }
    } catch (error) {
      console.error('[PaymentMethods] Exception creating card:', error);
      toast.error('An error occurred while adding the card');
    } finally {
      setSavingCard(false);
    }
  };

  const submitBank = async () => {
    const name = bankLabel.trim();
    const num = bankNumber.trim();
    if (!name) {
      toast.error('Enter an account name.');
      return;
    }
    if (!num) {
      toast.error('Enter an account number.');
      return;
    }
    const chartId = bankChartId || assetChartOptions[0]?.id || '';
    setSavingBank(true);
    try {
      const res = await svc.accounts.createBankAccount({
        accountId: chartId,
        bankName: name,
        accountNumber: num,
        accountType: bankSubtype,
        currency: bankCurrency,
        balance: 0,
        isActive: true,
        usage: bankUsage,
      });
      if (res.success) {
        toast.success(res.message ?? 'Bank method added');
        setAddBankOpen(false);
        resetBankForm();
        // Explicitly refetch to ensure we have latest data
        await refetch();
      } else {
        toast.error(res.error ?? 'Could not add bank method.');
      }
    } finally {
      setSavingBank(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remove this payment method? It will disappear from checkout and expense picks.')) return;
    const res = await svc.accounts.deleteBankAccount(id);
    if (res.success) {
      toast.success(res.message ?? 'Removed');
    } else {
      toast.error(res.error ?? 'Could not remove.');
    }
  };

  const dialogSurface =
    theme === 'light'
      ? 'border-slate-200 bg-white text-slate-900'
      : 'border-slate-700 bg-slate-950 text-slate-100';

  const fieldClass =
    'h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white';

  const totalMethods = cardAccounts.length + bankMethodAccounts.length;

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
              className="flex h-12 w-12 items-center justify-center rounded-xl p-3"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <CreditCard className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl md:text-4xl" style={AXIOM.text.titleStyle}>
                Payment methods
              </h1>
              <p className="text-xs text-slate-400 sm:text-sm">
                Cards and bank accounts you can use for expenses and payouts (same list as Accounts &amp; Wallets).
              </p>
            </div>
          </div>
          <button
            type="button"
            className="text-sm text-cyan-400/90 hover:text-cyan-300"
            onClick={() => goToOrgView?.('accounts')}
          >
            Open full account setup
          </button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Cards</p>
              <p className="text-2xl font-bold text-white">{cardAccounts.length}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <CreditCard className="size-6 text-white" />
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
              <p className="mb-1 text-sm text-slate-400">Bank &amp; other</p>
              <p className="text-2xl font-bold text-white">{bankMethodAccounts.length}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.blue,
                boxShadow: AXIOM.shadows.iconBlue,
              }}
            >
              <Building2 className="size-6 text-white" />
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
              <p className="mb-1 text-sm text-slate-400">Total methods</p>
              <p className="text-2xl font-bold text-white">{totalMethods}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Wallet className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-2xl p-6"
        style={AXIOM.containers.list}
      >
        <div className="mb-6 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mb-1 text-xl font-bold text-white">Cards</h2>
              <p className="text-sm" style={{ color: AXIOM.text.slate400 }}>
                Credit and charge cards (stored as card-type bank wallets)
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={savingCard}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                color: '#ffffff',
              }}
              onClick={openAddCard}
            >
              <Plus className="size-4" />
              Add card
            </motion.button>
          </div>
        </div>

        {loading && allAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
            Loading…
          </p>
        ) : cardAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
            No cards yet. Add one or create a full account under Accounts &amp; Wallets.
          </p>
        ) : (
          <div className="space-y-3">
            {cardAccounts.map((a, idx) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 * idx }}
                className="group flex items-center justify-between rounded-xl p-4"
                style={AXIOM.containers.item}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: AXIOM.iconBoxes.cyan,
                      boxShadow: AXIOM.shadows.iconCyan,
                    }}
                  >
                    <CreditCard className="size-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{a.bankName}</h3>
                      {(a.usage ?? 'business') === 'business' ? (
                        <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={AXIOM.badges.info}>
                          Business
                        </span>
                      ) : (
                        <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={AXIOM.badges.cyan}>
                          Personal
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-sm" style={{ color: AXIOM.text.slate400 }}>
                      {a.accountType.replace(/_/g, ' ')} • {maskAccountRef(a.accountNumber)} • {a.currency}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-400 opacity-100 transition-opacity hover:bg-red-500/10 pointer-fine:lg:opacity-0 pointer-fine:lg:group-hover:opacity-100"
                  aria-label="Remove card"
                  onClick={() => void handleRemove(a.id)}
                >
                  <Trash2 className="size-4" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Bank & other */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl p-6"
        style={AXIOM.containers.list}
      >
        <div className="mb-6 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mb-1 text-xl font-bold text-white">Bank &amp; other accounts</h2>
              <p className="text-sm" style={{ color: AXIOM.text.slate400 }}>
                Checking, savings, cash, and online wallets
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={savingBank}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                color: '#ffffff',
              }}
              onClick={openAddBank}
            >
              <Plus className="size-4" />
              Add bank account
            </motion.button>
          </div>
        </div>

        {loading && allAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
            Loading…
          </p>
        ) : bankMethodAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: AXIOM.text.slate400 }}>
            No bank methods yet. Add one here or under Accounts &amp; Wallets.
          </p>
        ) : (
          <div className="space-y-3">
            {bankMethodAccounts.map((a, idx) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 * idx }}
                className="group flex items-center justify-between rounded-xl p-4"
                style={AXIOM.containers.item}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: AXIOM.iconBoxes.blue,
                      boxShadow: AXIOM.shadows.iconBlue,
                    }}
                  >
                    <Building2 className="size-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{a.bankName}</h3>
                      {(a.usage ?? 'business') === 'business' ? (
                        <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={AXIOM.badges.info}>
                          Business
                        </span>
                      ) : (
                        <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={AXIOM.badges.cyan}>
                          Personal
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-sm" style={{ color: AXIOM.text.slate400 }}>
                      {a.accountType.replace(/_/g, ' ')} • {maskAccountRef(a.accountNumber)} • {a.currency}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-400 opacity-100 transition-opacity hover:bg-red-500/10 pointer-fine:lg:opacity-0 pointer-fine:lg:group-hover:opacity-100"
                  aria-label="Remove bank method"
                  onClick={() => void handleRemove(a.id)}
                >
                  <Trash2 className="size-4" />
                </button>
              </motion.div>
            ))}
          </div>
        )}

        <div
          className="mt-4 flex gap-2 rounded-xl p-4 text-sm text-blue-300/90"
          style={{
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}
        >
          <Info className="mt-0.5 size-4 shrink-0 text-blue-400" aria-hidden />
          <span>
            Integrations for automatic feeds are under Integration settings. Removing a method here deletes that bank
            wallet from your organization data.
          </span>
        </div>
      </motion.div>

      <Dialog open={addCardOpen} onOpenChange={setAddCardOpen}>
        <DialogContent className={`${dialogSurface} max-h-[90vh] max-w-md overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>Add card</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Creates a card-type wallet linked to your chart of accounts. Balance starts at zero.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
              <input
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                className={fieldClass}
                placeholder="e.g. Business Visa"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Last four digits</label>
              <input
                value={cardLastFour}
                onChange={(e) => setCardLastFour(e.target.value.replace(/\D/g, '').slice(0, 8))}
                className={fieldClass}
                inputMode="numeric"
                placeholder="4532"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Type</label>
              <select
                value={cardSubtype}
                onChange={(e) =>
                  setCardSubtype(
                    e.target.value as 'credit_card' | 'line_of_credit' | 'debit_card' | 'prepaid_card',
                  )
                }
                className={fieldClass}
              >
                <option value="credit_card">Credit card</option>
                <option value="debit_card">Debit card</option>
                <option value="prepaid_card">Prepaid card</option>
                <option value="line_of_credit">Line of credit</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Currency</label>
                <select
                  value={cardCurrency}
                  onChange={(e) => setCardCurrency(e.target.value)}
                  className={fieldClass}
                >
                  <option value="PKR">PKR</option>
                  <option value="USD">USD</option>
                  <option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Use</label>
                <select
                  value={cardUsage}
                  onChange={(e) => setCardUsage(e.target.value as 'personal' | 'business')}
                  className={fieldClass}
                >
                  <option value="business">Business</option>
                  <option value="personal">Personal</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Linked chart account</label>
              <select
                value={cardChartId}
                onChange={(e) => setCardChartId(e.target.value)}
                className={fieldClass}
              >
                <option value="">Auto-link standard chart account</option>
                {assetChartOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-50"
              disabled={savingCard}
              onClick={() => setAddCardOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingCard}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              onClick={() => void submitCard()}
            >
              {savingCard ? 'Saving…' : 'Add card'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addBankOpen} onOpenChange={setAddBankOpen}>
        <DialogContent className={`${dialogSurface} max-h-[90vh] max-w-md overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>Add bank account</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Quick add for checking or savings. For IBAN, online wallets, or cash, use Accounts &amp; Wallets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Account name</label>
              <input
                value={bankLabel}
                onChange={(e) => setBankLabel(e.target.value)}
                className={fieldClass}
                placeholder="e.g. Main operating"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Account number</label>
              <input
                value={bankNumber}
                onChange={(e) => setBankNumber(e.target.value)}
                className={fieldClass}
                placeholder="Digits from your statement"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Account type</label>
              <select
                value={bankSubtype}
                onChange={(e) => setBankSubtype(e.target.value as 'checking' | 'savings')}
                className={fieldClass}
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Currency</label>
                <select
                  value={bankCurrency}
                  onChange={(e) => setBankCurrency(e.target.value)}
                  className={fieldClass}
                >
                  <option value="PKR">PKR</option>
                  <option value="USD">USD</option>
                  <option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Use</label>
                <select
                  value={bankUsage}
                  onChange={(e) => setBankUsage(e.target.value as 'personal' | 'business')}
                  className={fieldClass}
                >
                  <option value="business">Business</option>
                  <option value="personal">Personal</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Linked chart account</label>
              <select
                value={bankChartId}
                onChange={(e) => setBankChartId(e.target.value)}
                className={fieldClass}
              >
                <option value="">Auto-link standard chart account</option>
                {assetChartOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-50"
              disabled={savingBank}
              onClick={() => setAddBankOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingBank}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              onClick={() => void submitBank()}
            >
              {savingBank ? 'Saving…' : 'Add account'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
