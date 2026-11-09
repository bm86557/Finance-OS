import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import { organizationService } from '@/services/organizationService';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useServiceArray } from '@/hooks/useService';
import { formatCurrency } from '@/lib/formatters';
import { convertCurrency } from '@/lib/currencyUtils';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { BankAccount } from '@/services/types';
import {
  Plus,
  Wallet,
  Building2,
  Banknote,
  Edit,
  Eye,
  CreditCard,
  DollarSign,
  Link2,
  Upload,
  Smartphone,
} from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { AXIOM } from '../../../styles/axiom-tokens';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';

/** UI grouping — includes `cash` wallet type */
type AccountCategory = 'bank' | 'cash' | 'virtual';

/** High-level choice in the add-account form */
type WalletKind = 'cash' | 'bank' | 'online_wallet' | 'card';

function getAccountCategory(accountType: BankAccount['accountType']): AccountCategory {
  if (accountType === 'cash') return 'cash';
  if (accountType === 'checking' || accountType === 'savings' || accountType === 'debit_card' || accountType === 'prepaid_card') return 'bank';
  if (
    accountType === 'credit_card' ||
    accountType === 'line_of_credit' ||
    accountType === 'online_wallet'
  ) {
    return 'virtual';
  }
  return 'bank';
}

function walletKindFromAccountType(t: BankAccount['accountType']): WalletKind {
  if (t === 'cash') return 'cash';
  if (t === 'checking' || t === 'savings') return 'bank';
  if (t === 'online_wallet') return 'online_wallet';
  return 'card';
}

function accountTypesForWalletKind(kind: WalletKind): BankAccount['accountType'][] {
  switch (kind) {
    case 'cash':
      return ['cash'];
    case 'bank':
      return ['checking', 'savings'];
    case 'online_wallet':
      return ['online_wallet'];
    case 'card':
      return ['debit_card', 'credit_card', 'line_of_credit', 'prepaid_card'];
    default:
      return ['checking'];
  }
}

export function AccountsWallets() {
  const { theme } = useTheme();
  const { currentOrganization, applyOrganizationUpdate } = useAuth();
  const baseCurrency = currentOrganization?.currency || 'USD';
  const goToOrgView = useOrgWorkspaceNav();
  const [selectedType, setSelectedType] = useState<'all' | AccountCategory>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connectInfoOpen, setConnectInfoOpen] = useState(false);

  const [formWalletKind, setFormWalletKind] = useState<WalletKind>('bank');
  const [formBankName, setFormBankName] = useState('');
  const [formAccountNumber, setFormAccountNumber] = useState('');
  const [formAccountType, setFormAccountType] = useState<BankAccount['accountType']>('checking');
  const [formCurrency, setFormCurrency] = useState(baseCurrency);
  const [formSetAsBase, setFormSetAsBase] = useState(false);
  const [formBalance, setFormBalance] = useState('');
  const [formChartAccountId, setFormChartAccountId] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formIban, setFormIban] = useState('');
  const [formSwift, setFormSwift] = useState('');
  const [formRouting, setFormRouting] = useState('');
  const [formUsage, setFormUsage] = useState<'personal' | 'business'>('business');

  const svc = useOrgServices();

  const { data: bankAccounts, loading, error, refetch } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts', 'transactions'],
  );

  const { data: chartAccounts } = useServiceArray(
    () => svc.accounts.getAll(),
    [svc.orgId],
    ['accounts'],
  );

  const assetChartOptions = useMemo(
    () => chartAccounts.filter((a) => (a.type === 'asset' || a.type === 'liability') && a.isActive),
    [chartAccounts],
  );

  const typesForKind = useMemo(() => accountTypesForWalletKind(formWalletKind), [formWalletKind]);
  const { getSelectableCurrencyCodes } = usePlatformSettings();
  const selectableCurrencies = getSelectableCurrencyCodes(formCurrency || baseCurrency);

  useEffect(() => {
    const list = accountTypesForWalletKind(formWalletKind);
    setFormAccountType((prev) => (list.includes(prev) ? prev : list[0]));
  }, [formWalletKind]);

  const filteredAccounts = useMemo(() => {
    if (selectedType === 'all') return bankAccounts;
    return bankAccounts.filter((a) => getAccountCategory(a.accountType) === selectedType);
  }, [bankAccounts, selectedType]);

  const totalBankBalance = useMemo(
    () =>
      bankAccounts
        .filter((a) => a.accountType === 'checking' || a.accountType === 'savings' || a.accountType === 'debit_card' || a.accountType === 'prepaid_card')
        .reduce((sum, a) => sum + convertCurrency(Number(a.balance) || 0, a.currency || baseCurrency, baseCurrency), 0),
    [bankAccounts, baseCurrency],
  );

  const totalOnlineWallets = useMemo(
    () =>
      bankAccounts
        .filter((a) => a.accountType === 'online_wallet')
        .reduce((sum, a) => sum + convertCurrency(Number(a.balance) || 0, a.currency || baseCurrency, baseCurrency), 0),
    [bankAccounts, baseCurrency],
  );

  const totalCreditLiabilities = useMemo(
    () =>
      bankAccounts
        .filter((a) => a.accountType === 'credit_card' || a.accountType === 'line_of_credit')
        .reduce((sum, a) => sum + Math.abs(convertCurrency(Number(a.balance) || 0, a.currency || baseCurrency, baseCurrency)), 0),
    [bankAccounts, baseCurrency],
  );

  const totalCash = useMemo(
    () =>
      bankAccounts
        .filter((a) => a.accountType === 'cash')
        .reduce((sum, a) => sum + convertCurrency(Number(a.balance) || 0, a.currency || baseCurrency, baseCurrency), 0),
    [bankAccounts, baseCurrency],
  );

  const netBalance = totalBankBalance + totalCash + totalOnlineWallets - totalCreditLiabilities;
  const totalVirtualAndCards = totalOnlineWallets - totalCreditLiabilities;

  const resetForm = () => {
    setFormWalletKind('bank');
    setFormBankName('');
    setFormAccountNumber('');
    setFormAccountType('checking');
    setFormCurrency(baseCurrency);
    setFormSetAsBase(bankAccounts.length === 0);
    setFormBalance('');
    setFormIban('');
    setFormSwift('');
    setFormRouting('');
    setFormUsage('business');
    setFormChartAccountId(assetChartOptions[0]?.id ?? '');
    setFormIsActive(true);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setFormChartAccountId(assetChartOptions[0]?.id ?? '');
    setCreateOpen(true);
  };

  const openEdit = (account: BankAccount) => {
    setEditingId(account.id);
    setFormWalletKind(walletKindFromAccountType(account.accountType));
    setFormBankName(account.bankName);
    setFormAccountNumber(account.accountNumber);
    setFormAccountType(account.accountType);
    setFormCurrency(account.currency);
    setFormSetAsBase(account.currency === baseCurrency || bankAccounts.length <= 1);
    setFormBalance(String(Number.isFinite(account.balance) ? account.balance : 0));
    setFormChartAccountId(account.accountId);
    setFormIsActive(account.isActive);
    setFormIban(account.iban ?? '');
    setFormSwift(account.swiftCode ?? '');
    setFormRouting(account.routingNumber ?? '');
    setFormUsage(account.usage ?? 'business');
    setEditOpen(true);
  };

  const handleCurrencyChange = (newCurr: string) => {
    const oldCurr = formCurrency;
    if (oldCurr !== newCurr && formBalance) {
      const parsed = parseFloat(formBalance.replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        const converted = convertCurrency(parsed, oldCurr, newCurr);
        setFormBalance(String(Math.round(converted * 100) / 100));
      }
    }
    setFormCurrency(newCurr);
  };

  const parseBalance = (): number | null => {
    const raw = formBalance.replace(/,/g, '').trim();
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const trimOpt = (s: string) => {
    const t = s.trim();
    return t ? t : undefined;
  };

  const validateIdentifiers = (name: string, num: string, iban: string, isEdit = false): boolean => {
    if (!name) {
      toast.error('Enter a name.');
      return false;
    }
    // On edit, identifiers are optional — user may only be changing balance/type/currency
    if (isEdit) return true;
    if (formWalletKind === 'cash') return true;
    if (formWalletKind === 'bank') {
      if (!num && !iban) {
        toast.error('Enter an account number or IBAN.');
        return false;
      }
      return true;
    }
    if (formWalletKind === 'online_wallet') {
      if (!num && !iban) {
        toast.error('Enter a wallet ID, email, or IBAN.');
        return false;
      }
      return true;
    }
    // Cards: reference optional (last 4 digits may be unknown)
    return true;
  };

  const resolvedAccountNumber = (num: string, iban: string): string => {
    if (formWalletKind === 'cash' && !num) return '—';
    if (num) return num;
    if (iban) return '(see IBAN)';
    return '—';
  };

  const submitCreate = async () => {
    const name = formBankName.trim();
    const num = formAccountNumber.trim();
    const iban = formIban.trim();
    if (!validateIdentifiers(name, num, iban)) return;
    const chartId = formChartAccountId || assetChartOptions[0]?.id || '';
    const bal = parseBalance();
    if (bal === null) {
      toast.error('Enter a valid current balance.');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        accountId: chartId,
        bankName: name,
        accountNumber: resolvedAccountNumber(num, iban),
        accountType: formAccountType,
        currency: formCurrency,
        balance: bal,
        isActive: formIsActive,
        iban: trimOpt(formIban),
        swiftCode: trimOpt(formSwift),
        routingNumber: trimOpt(formRouting),
        usage: formUsage,
        setAsBaseCurrency: formSetAsBase,
      };
      const res = await svc.accounts.createBankAccount(payload);
      if (res.success) {
        if (formSetAsBase && currentOrganization) {
          void organizationService.update(currentOrganization.id, { currency: formCurrency }).then(orgRes => {
            if (orgRes.success && orgRes.data) {
              applyOrganizationUpdate(orgRes.data);
            } else {
              applyOrganizationUpdate({ ...currentOrganization, currency: formCurrency });
            }
          });
        }
        toast.success(res.message ?? 'Account added');
        setCreateOpen(false);
        resetForm();
        await refetch();
      } else {
        toast.error(res.error ?? 'Could not add account.');
      }
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editingId) return;
    const name = formBankName.trim();
    const num = formAccountNumber.trim();
    const iban = formIban.trim();
    if (!validateIdentifiers(name, num, iban, true)) return;
    const chartId = formChartAccountId || assetChartOptions[0]?.id || '';
    const bal = parseBalance();
    if (bal === null) {
      toast.error('Enter a valid balance.');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        accountId: chartId,
        bankName: name,
        accountNumber: resolvedAccountNumber(num, iban),
        accountType: formAccountType,
        currency: formCurrency,
        balance: bal,
        isActive: formIsActive,
        iban: trimOpt(formIban),
        swiftCode: trimOpt(formSwift),
        routingNumber: trimOpt(formRouting),
        usage: formUsage,
        setAsBaseCurrency: formSetAsBase,
      };
      const res = await svc.accounts.updateBankAccount(editingId, payload);
      if (res.success) {
        if (formSetAsBase && currentOrganization) {
          void organizationService.update(currentOrganization.id, { currency: formCurrency }).then(orgRes => {
            if (orgRes.success && orgRes.data) {
              applyOrganizationUpdate(orgRes.data);
            } else {
              applyOrganizationUpdate({ ...currentOrganization, currency: formCurrency });
            }
          });
        }
        toast.success('Account updated');
        setEditOpen(false);
        resetForm();
        await refetch();
      } else {
        toast.error(res.error ?? 'Could not update account.');
      }
    } finally {
      setSaving(false);
    }
  };

  const dialogSurface =
    theme === 'light'
      ? 'border-slate-200 bg-white text-slate-900'
      : 'border-slate-700 bg-slate-950 text-slate-100';

  const inputClass =
    'h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white';

  const FormFields = (
    <div className="space-y-3 pt-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">What are you adding?</label>
        <select
          value={formWalletKind}
          onChange={(e) => setFormWalletKind(e.target.value as WalletKind)}
          className={inputClass}
        >
          <option value="bank">Bank account</option>
          <option value="cash">Cash on hand</option>
          <option value="online_wallet">Online wallet (Payoneer, Wise, PayPal, …)</option>
          <option value="card">Card or credit line</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Personal or business?</label>
        <select
          value={formUsage}
          onChange={(e) => setFormUsage(e.target.value as 'personal' | 'business')}
          className={inputClass}
        >
          <option value="business">Business</option>
          <option value="personal">Personal</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          {formWalletKind === 'online_wallet'
            ? 'Wallet name'
            : formWalletKind === 'cash'
              ? 'Label'
              : 'Account name'}
        </label>
        <input
          value={formBankName}
          onChange={(e) => setFormBankName(e.target.value)}
          className={inputClass}
          placeholder={
            formWalletKind === 'online_wallet'
              ? 'e.g. Payoneer USD'
              : formWalletKind === 'cash'
                ? 'e.g. Petty cash, main till'
                : formWalletKind === 'card'
                  ? 'e.g. Business Visa'
                  : 'e.g. HBL Business Current'
          }
        />
      </div>

      {(formWalletKind === 'bank' || formWalletKind === 'online_wallet') && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">IBAN (optional)</label>
          <input
            value={formIban}
            onChange={(e) => setFormIban(e.target.value)}
            className={inputClass}
            placeholder="International bank account number"
            autoComplete="off"
          />
        </div>
      )}

      {formWalletKind === 'bank' && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Account number</label>
            <input
              value={formAccountNumber}
              onChange={(e) => setFormAccountNumber(e.target.value)}
              className={inputClass}
              placeholder="Domestic account number on statements"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">SWIFT / BIC (optional)</label>
            <input
              value={formSwift}
              onChange={(e) => setFormSwift(e.target.value)}
              className={inputClass}
              placeholder="Bank identifier for international transfers"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Routing number (optional)</label>
            <input
              value={formRouting}
              onChange={(e) => setFormRouting(e.target.value)}
              className={inputClass}
              placeholder="ACH / wire routing where applicable"
              autoComplete="off"
            />
          </div>
        </>
      )}

      {formWalletKind === 'online_wallet' && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Wallet ID, email, or account reference
            </label>
            <input
              value={formAccountNumber}
              onChange={(e) => setFormAccountNumber(e.target.value)}
              className={inputClass}
              placeholder="What you use to sign in or receive funds"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">SWIFT / BIC (optional)</label>
            <input
              value={formSwift}
              onChange={(e) => setFormSwift(e.target.value)}
              className={inputClass}
              placeholder="If the provider gives one"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Routing number (optional)</label>
            <input
              value={formRouting}
              onChange={(e) => setFormRouting(e.target.value)}
              className={inputClass}
              placeholder="Rare for online wallets"
            />
          </div>
        </>
      )}

      {formWalletKind === 'cash' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Reference (optional)</label>
          <input
            value={formAccountNumber}
            onChange={(e) => setFormAccountNumber(e.target.value)}
            className={inputClass}
            placeholder="Optional note or till ID"
          />
        </div>
      )}

      {formWalletKind === 'card' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Card or account reference</label>
          <input
            value={formAccountNumber}
            onChange={(e) => setFormAccountNumber(e.target.value)}
            className={inputClass}
            placeholder="Last digits or internal reference"
          />
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-3 ${formWalletKind === 'bank' || formWalletKind === 'card' ? 'sm:grid-cols-2' : ''}`}
      >
        {(formWalletKind === 'bank' || formWalletKind === 'card') && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              {formWalletKind === 'bank' ? 'Account type' : 'Card nature & type'}
            </label>
            <select
              value={formAccountType}
              onChange={(e) => setFormAccountType(e.target.value as BankAccount['accountType'])}
              className={inputClass}
            >
              {typesForKind.map((t) => (
                <option key={t} value={t}>
                  {t === 'cash'
                    ? 'Cash wallet'
                    : t === 'online_wallet'
                      ? 'Online wallet'
                      : t === 'debit_card'
                        ? 'Debit Card (Asset — Available Funds)'
                        : t === 'prepaid_card'
                          ? 'Prepaid Card (Asset — Loaded Funds)'
                          : t === 'credit_card'
                            ? 'Credit Card (Liability — Debt / Owed)'
                            : t === 'line_of_credit'
                              ? 'Line of Credit (Liability — Revolving Debt)'
                              : t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Currency</label>
          <select
            value={formCurrency}
            onChange={(e) => handleCurrencyChange(e.target.value)}
            className={inputClass}
          >
            {selectableCurrencies.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}





          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
        <input
          id="setAsBaseCurrencyCheckbox"
          type="checkbox"
          checked={formSetAsBase}
          onChange={(e) => setFormSetAsBase(e.target.checked)}
          className="size-4 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-500 cursor-pointer"
        />
        <label htmlFor="setAsBaseCurrencyCheckbox" className="text-xs text-blue-200 cursor-pointer select-none">
          <strong>Organization Base Currency:</strong> Use <strong>{formCurrency}</strong> as the base currency for all overall dashboard features, KPIs, and reports.
        </label>
      </div>

      {(formAccountType === 'credit_card' || formAccountType === 'line_of_credit') && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          ⚠️ <strong>Credit Card & Line of Credit:</strong> The entered balance is treated as outstanding debt owed to the card issuer (Liability). It will be subtracted from your organization&apos;s Net Balance. If this is a card with available cash (funds you own), select <strong>Debit Card</strong> instead.
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          {formAccountType === 'credit_card' || formAccountType === 'line_of_credit'
            ? 'Current balance owed (Debt / Liability)'
            : 'Current balance (Available Funds / Asset)'}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={formBalance}
          onChange={(e) => setFormBalance(e.target.value)}
          className={inputClass}
          placeholder="0.00"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Linked chart account</label>
        <select
          value={formChartAccountId}
          onChange={(e) => setFormChartAccountId(e.target.value)}
          className={inputClass}
        >
          <option value="">Auto-assign standard chart account</option>
          {assetChartOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name} ({a.type})
            </option>
          ))}
        </select>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={formIsActive}
          onChange={(e) => setFormIsActive(e.target.checked)}
          className="rounded border-slate-600"
        />
        Active
      </label>
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

      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl p-3"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Wallet className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl md:text-4xl" style={AXIOM.text.titleStyle}>
                Accounts & Wallets
              </h1>
              <p className="text-xs text-slate-400 sm:text-sm">
                Connect feeds where available, or add accounts manually and keep them fresh with statements.
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Two ways to work with money */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
              style={{ background: AXIOM.iconBoxes.blue, boxShadow: AXIOM.shadows.iconBlue }}
            >
              <Link2 className="size-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">Automatic bank &amp; wallet feeds</h2>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: AXIOM.text.slate400 }}>
                Direct connections depend on each bank or payment company. Many only work through approved partners, and
                smaller apps are not always invited. We are building secure integrations and will turn them on by region
                when contracts allow.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white ring-1 ring-slate-600 hover:bg-slate-700"
                  onClick={() => goToOrgView?.('integrations')}
                >
                  Integration settings
                </button>
                <button
                  type="button"
                  className="rounded-xl px-4 py-2 text-sm font-medium text-slate-300 hover:text-white"
                  onClick={() => setConnectInfoOpen(true)}
                >
                  How this works
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
              style={{ background: AXIOM.iconBoxes.cyan, boxShadow: AXIOM.shadows.iconCyan }}
            >
              <Upload className="size-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">Add accounts yourself</h2>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: AXIOM.text.slate400 }}>
                Record cash, bank accounts, and cards here. When feeds are not available, upload weekly or monthly
                statements on the import screen to reconcile and refresh balances.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
                  onClick={openCreate}
                >
                  <Plus className="size-4" />
                  Add account
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white ring-1 ring-slate-600 hover:bg-slate-700"
                  onClick={() => goToOrgView?.('import')}
                >
                  Import a statement
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Summary Cards */}
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
              <p className="mb-1 text-sm text-slate-400">Net balance ({baseCurrency})</p>
              <p className="text-2xl font-bold text-white">{formatCurrency(netBalance, baseCurrency)}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
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
          className="rounded-2xl p-6"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Bank accounts</p>
              <p className="text-2xl font-bold text-cyan-400">{formatCurrency(totalBankBalance, baseCurrency)}</p>
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
              <p className="mb-1 text-sm text-slate-400">Cash in hand</p>
              <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalCash, baseCurrency)}</p>
            </div>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <Banknote className="size-6 text-white" />
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
              <p className="mb-1 text-sm text-slate-400">Online wallets &amp; cards</p>
              <p className="text-2xl font-bold text-purple-400">{formatCurrency(totalVirtualAndCards, baseCurrency)}</p>
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

      {/* Filter Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex flex-wrap gap-2"
      >
        {(['all', 'bank', 'cash', 'virtual'] as const).map((type) => (
          <motion.button
            key={type}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="rounded-xl px-4 py-2 text-sm font-medium capitalize"
            style={
              selectedType === type
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
            onClick={() => setSelectedType(type)}
          >
            {type === 'all' ? 'All accounts' : `${type} ${type === 'cash' ? '' : 'accounts'}`}
          </motion.button>
        ))}
      </motion.div>

      {/* Accounts Grid */}
      {loading && bankAccounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-12 text-center"
          style={AXIOM.containers.list}
        >
          <p className="text-sm" style={{ color: AXIOM.text.slate400 }}>
            Loading accounts…
          </p>
        </motion.div>
      ) : !loading && bankAccounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-12 text-center"
          style={AXIOM.containers.list}
        >
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl"
            style={{
              background: AXIOM.iconBoxes.purple,
              boxShadow: AXIOM.shadows.iconPurple,
            }}
          >
            <Wallet className="size-8 text-white" />
          </div>
          <p className="mb-2 text-lg font-bold text-white">No accounts yet</p>
          <p className="mb-4 text-sm text-slate-400">
            Use <span className="text-slate-300">Add account</span> for manual wallets, or open{' '}
            <span className="text-slate-300">Import a statement</span> when you have a file. Automatic feeds are optional
            and depend on your bank.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={!assetChartOptions.length}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              onClick={openCreate}
            >
              Add account
            </button>
            <button
              type="button"
              className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white ring-1 ring-slate-600 hover:bg-slate-700"
              onClick={() => goToOrgView?.('import')}
            >
              Import a statement
            </button>
          </div>
        </motion.div>
      ) : filteredAccounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-12 text-center"
          style={AXIOM.containers.list}
        >
          <p className="text-sm" style={{ color: AXIOM.text.slate400 }}>
            Nothing matches this filter. Try &quot;All accounts&quot; or another type.
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredAccounts.map((account, idx) => {
            const cat = getAccountCategory(account.accountType);
            const iconData =
              account.accountType === 'online_wallet'
                ? { icon: Smartphone, box: AXIOM.iconBoxes.purple, shadow: AXIOM.shadows.iconPurple }
                : cat === 'bank'
                  ? { icon: Building2, box: AXIOM.iconBoxes.blue, shadow: AXIOM.shadows.iconBlue }
                  : cat === 'virtual'
                    ? {
                        icon: CreditCard,
                        box: AXIOM.iconBoxes.purple,
                        shadow: AXIOM.shadows.iconPurple,
                      }
                    : { icon: Banknote, box: AXIOM.iconBoxes.green, shadow: AXIOM.shadows.iconGreen };
            const Icon = iconData.icon;

            return (
              <motion.div
                key={account.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 + idx * 0.05 }}
                className="group rounded-2xl p-6"
                style={AXIOM.containers.list}
              >
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background: iconData.box,
                        boxShadow: iconData.shadow,
                      }}
                    >
                      <Icon className="size-6 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-bold text-white">{account.bankName}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-lg px-2 py-0.5 text-xs font-medium capitalize"
                          style={account.isActive ? AXIOM.badges.success : AXIOM.badges.warning}
                        >
                          {account.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-xs capitalize" style={{ color: AXIOM.text.slate400 }}>
                          {account.accountType.replace(/_/g, ' ')}
                        </span>
                        {account.accountType === 'credit_card' || account.accountType === 'line_of_credit' ? (
                          <span className="rounded-lg px-2 py-0.5 text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Liability (Debt)
                          </span>
                        ) : (
                          <span className="rounded-lg px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Asset (Funds)
                          </span>
                        )}
                        <span
                          className="rounded-lg px-2 py-0.5 text-xs font-medium"
                          style={
                            (account.usage ?? 'business') === 'business'
                              ? AXIOM.badges.info
                              : AXIOM.badges.cyan
                          }
                        >
                          {(account.usage ?? 'business') === 'business' ? 'Business' : 'Personal'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  {account.accountType === 'credit_card' || account.accountType === 'line_of_credit' ? (
                    <>
                      <p className="mb-1 text-xs font-medium text-rose-400">Current balance owed (Liability)</p>
                      <p className="font-mono text-3xl font-bold text-rose-300">
                        {formatCurrency(Number.isFinite(account.balance) ? account.balance : 0, account.currency)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mb-1 text-xs text-slate-400">Current available balance</p>
                      <p className="font-mono text-3xl font-bold text-white">
                        {formatCurrency(Number.isFinite(account.balance) ? account.balance : 0, account.currency)}
                      </p>
                    </>
                  )}
                </div>

                <div className="mb-6 space-y-3">
                  {account.iban && (
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                      <span className="shrink-0 text-sm" style={{ color: AXIOM.text.slate400 }}>
                        IBAN
                      </span>
                      <span className="break-all font-mono text-xs text-white sm:text-right">{account.iban}</span>
                    </div>
                  )}
                  {account.accountNumber &&
                    account.accountNumber !== '—' &&
                    account.accountNumber !== '(see IBAN)' && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm" style={{ color: AXIOM.text.slate400 }}>
                          Account number
                        </span>
                        <span className="font-mono text-sm text-white">{account.accountNumber}</span>
                      </div>
                    )}
                  {account.swiftCode && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm" style={{ color: AXIOM.text.slate400 }}>
                        SWIFT / BIC
                      </span>
                      <span className="font-mono text-sm text-white">{account.swiftCode}</span>
                    </div>
                  )}
                  {account.routingNumber && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm" style={{ color: AXIOM.text.slate400 }}>
                        Routing
                      </span>
                      <span className="font-mono text-sm text-white">{account.routingNumber}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: AXIOM.text.slate400 }}>
                      Currency
                    </span>
                    <span className="text-sm font-medium text-white">{account.currency}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
                    style={{
                      background: 'rgba(168, 85, 247, 0.3)',
                      border: '1px solid rgba(168, 85, 247, 0.5)',
                      color: '#ffffff',
                    }}
                    onClick={() => goToOrgView?.('transactions')}
                  >
                    <Eye className="size-4" />
                    View transactions
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{
                      background: 'rgba(0, 0, 0, 0.2)',
                      border: 'none',
                      color: AXIOM.text.slate400,
                    }}
                    onClick={() => openEdit(account)}
                  >
                    <Edit className="size-4" />
                  </motion.button>
                </div>
                <button
                  type="button"
                  className="mt-3 w-full text-center text-xs text-slate-500 transition-colors hover:text-cyan-300"
                  onClick={() => goToOrgView?.('import')}
                >
                  Update balance from a statement
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={`${dialogSurface} max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Saved to your organization. Link each wallet to an asset on your chart of accounts.
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
              disabled={saving || !assetChartOptions.length}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              onClick={() => void submitCreate()}
            >
              {saving ? 'Saving…' : 'Add account'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className={`${dialogSurface} max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Updates this wallet only. Balances stay in sync with the data store.
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
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              onClick={() => void submitEdit()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={connectInfoOpen} onOpenChange={setConnectInfoOpen}>
        <DialogContent className={`${dialogSurface} max-w-lg`}>
          <DialogHeader>
            <DialogTitle>How bank connections work</DialogTitle>
            <DialogDescription className={theme === 'light' ? 'text-slate-600' : 'text-slate-400'}>
              Plain-language expectations so you are not stuck waiting on something we cannot control.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-relaxed" style={{ color: AXIOM.text.slate300 }}>
            <p>
              Large banks and card networks usually offer transaction feeds only through certified partners, under strict
              contracts. That is why many finance apps rely on aggregators — and why some regions or institutions never
              appear in smaller products.
            </p>
            <p>
              We still want you to have a full picture: use <strong className="text-white">Add account</strong> for anything
              you manage manually, and <strong className="text-white">Import a statement</strong> on a cadence that suits
              you (weekly, monthly, or when you get a PDF or CSV).
            </p>
            <p className="text-xs" style={{ color: AXIOM.text.slate400 }}>
              Integration toggles and provider keys live under Integration settings when your organization is ready.
            </p>
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white ring-1 ring-slate-600 hover:bg-slate-700"
              onClick={() => setConnectInfoOpen(false)}
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
