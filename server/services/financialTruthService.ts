/**
 * Authoritative Financial Truth Service (Handoff v1.2 §§0.5, 1, 5, 6, 8, 15, 21, 23, 26).
 *
 * Single source of truth for:
 *  - Live bank & cash account balances
 *  - World isolation (business vs personal + owner privacy)
 *  - Pending/draft/rejected/reversed exclusion & internal transfer neutrality
 *  - Balance Sheet & Net Worth (Assets = Liabilities + Equity)
 *  - Profit & Loss (P&L) & Cash Flow snapshots
 *
 * Shared by `server/routes/reports.ts` and `server/routes/bankAccounts.ts` so
 * Finance OS, Financial Reports, and Accounts & Wallets always reconcile 100%.
 */

import { convertCurrency } from '../lib/fxConverter.js';

export type WorldFilter = 'business' | 'personal' | 'all';

export const NON_POSTED_STATUSES = new Set([
  'pending',
  'draft',
  'rejected',
  'reversed',
  'cancelled',
]);

export const CREDIT_ACCOUNT_TYPES = new Set([
  'credit_card',
  'line_of_credit',
  'credit',
]);

export interface MappedTransaction {
  id: string;
  organizationId: string;
  bankAccountId: string;
  date: string;
  description: string;
  narration: string;
  amount: number;
  rawAmount: number;
  currency: string;
  convertedCurrency: string;
  type: 'credit' | 'debit';
  categoryId?: string;
  categoryName?: string;
  categoryType?: string;
  departmentId?: string;
  projectId?: string;
  status: string;
  worldScope: 'business' | 'personal';
  ownerUserId?: string;
  isTransfer: boolean;
  transferGroupId?: string;
  tags: string[];
  attachments: any[];
  createdAt: string;
}

export function extractFxRate(row: Record<string, any>): number | undefined {
  if (row.fx_rate_to_base != null && Number(row.fx_rate_to_base) > 0) {
    return Number(row.fx_rate_to_base);
  }
  const tags: string[] = Array.isArray(row.tags) ? row.tags.map(String) : [];
  const rTag = tags.find((tag) => tag.startsWith('fx:rate:'));
  if (rTag) {
    const parsed = Number(rTag.slice(8));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function convertTxnAmountToCurrency(
  row: Record<string, any>,
  targetCurrency: string,
  fallbackSourceCurrency: string,
): number {
  const rawAmt = Math.abs(Number(row.amount || 0));
  const rawCurr = String(row.currency || fallbackSourceCurrency).toUpperCase().trim();
  const target = String(targetCurrency).toUpperCase().trim();
  const fxRate = extractFxRate(row);

  if (
    row.base_amount != null &&
    Number(row.base_amount) > 0 &&
    String(row.base_currency || target).toUpperCase().trim() === target
  ) {
    return Number(row.base_amount);
  }
  return convertCurrency(rawAmt, rawCurr, target, fxRate);
}

/**
 * Canonical live balance calculation for a bank/cash/wallet/credit account.
 * Matches `bankAccounts.ts` and `reports.ts` so Accounts & Wallets and Dashboard never diverge.
 */
export function computeLiveBankBalance(
  bankRow: Record<string, any>,
  orgTransactions: Record<string, any>[],
  orgCurrency: string,
  asOfDate?: string,
): number {
  const bankCurrency = String(bankRow.currency || orgCurrency).toUpperCase().trim();
  const accountTxns = (orgTransactions || []).filter((t) => {
    if (String(t.bank_account_id) !== String(bankRow.id)) return false;
    const status = String(t.status || 'classified').toLowerCase();
    if (NON_POSTED_STATUSES.has(status)) return false;
    if (asOfDate && t.date && String(t.date) > asOfDate) return false;
    return true;
  });

  const rawOpening = bankRow.opening_balance;
  const fallbackStored = bankRow.current_balance ?? bankRow.balance;
  const openingBal =
    rawOpening != null
      ? Number(rawOpening)
      : accountTxns.length > 0
        ? 0
        : Number(fallbackStored ?? 0);

  if (accountTxns.length === 0) {
    return Math.round(Number(fallbackStored ?? openingBal ?? 0) * 100) / 100;
  }

  const live = accountTxns.reduce((sum, t) => {
    const convertedAmt = convertTxnAmountToCurrency(t, bankCurrency, bankCurrency);
    return t.type === 'credit' ? sum + convertedAmt : sum - Math.abs(convertedAmt);
  }, openingBal);

  return Math.round(live * 100) / 100;
}

export function isLoanRepaymentTxn(
  t: { categoryId?: string; categoryName?: string; description?: string; narration?: string },
  catMap: Map<string, string>,
): boolean {
  const cName = (t.categoryName || (t.categoryId ? catMap.get(t.categoryId) : '') || '').toLowerCase();
  const desc = (t.description || '').toLowerCase();
  const narr = (t.narration || '').toLowerCase();
  return (
    cName.includes('loan repayment') ||
    desc.includes('loan repayment') ||
    (narr.includes('monthly installment') && narr.includes('loan'))
  );
}

export function isTransferTxn(
  t: {
    isTransfer?: boolean;
    transferGroupId?: string;
    tags?: string[];
    categoryId?: string;
    categoryName?: string;
    description?: string;
    narration?: string;
  },
  catMap: Map<string, string>,
): boolean {
  if (t.isTransfer || t.transferGroupId) return true;
  const tags = t.tags || [];
  if (tags.includes('transfer')) return true;
  const cName = (t.categoryName || (t.categoryId ? catMap.get(t.categoryId) : '') || '').toLowerCase();
  if (cName === 'transfer' || cName === 'internal transfer' || cName === 'cash withdrawal') return true;
  const desc = (t.description || '').toLowerCase();
  const narr = (t.narration || '').toLowerCase();
  return (
    desc.startsWith('transfer to ') ||
    desc.startsWith('transfer from ') ||
    desc.includes('internal transfer') ||
    desc.includes('atm withdrawal') ||
    narr.includes('internal transfer')
  );
}

export function filterAccessibleBanks(
  bankAccounts: Record<string, any>[],
  worldFilter: WorldFilter,
  callerUserId?: string,
  isOrgOwner = false,
): { allAccessibleBanks: Record<string, any>[]; worldBanks: Record<string, any>[]; bankWorldMap: Map<string, 'business' | 'personal'> } {
  const allAccessibleBanks = (bankAccounts ?? []).filter((b) => {
    const usage = b.usage === 'personal' ? 'personal' : 'business';
    if (usage === 'personal' && b.owner_user_id && b.owner_user_id !== callerUserId && !isOrgOwner) {
      return false;
    }
    return true;
  });

  const bankWorldMap = new Map<string, 'business' | 'personal'>();
  for (const b of allAccessibleBanks) {
    bankWorldMap.set(String(b.id), b.usage === 'personal' ? 'personal' : 'business');
  }

  const worldBanks = allAccessibleBanks.filter((b) => {
    const bWorld = b.usage === 'personal' ? 'personal' : 'business';
    if (worldFilter === 'all') return true;
    return bWorld === worldFilter;
  });

  return { allAccessibleBanks, worldBanks, bankWorldMap };
}

export function mapAndFilterWorldTransactions(
  rawTxns: Record<string, any>[],
  orgCurrency: string,
  bankWorldMap: Map<string, 'business' | 'personal'>,
  worldFilter: WorldFilter,
  callerUserId?: string,
  isOrgOwner = false,
): MappedTransaction[] {
  const mapped: MappedTransaction[] = (rawTxns ?? []).map((row) => {
    const rawAmt = Number(row.amount || 0);
    const rawCurr = String(row.currency ?? orgCurrency);
    const tags: string[] = Array.isArray(row.tags) ? row.tags.map(String) : [];
    const convertedAmt = convertTxnAmountToCurrency(row, orgCurrency, orgCurrency);
    const bankId = String(row.bank_account_id);

    const inferredWorld: 'business' | 'personal' =
      row.world_scope === 'personal' ||
      tags.includes('personal') ||
      bankWorldMap.get(bankId) === 'personal'
        ? 'personal'
        : 'business';

    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      bankAccountId: bankId,
      date: String(row.date || ''),
      description: String(row.description ?? ''),
      narration: String(row.narration ?? ''),
      amount: convertedAmt,
      rawAmount: rawAmt,
      currency: rawCurr,
      convertedCurrency: orgCurrency,
      type: row.type === 'credit' ? 'credit' : 'debit',
      categoryId: row.category_id ? String(row.category_id) : undefined,
      categoryName: row.categories?.name ? String(row.categories.name) : undefined,
      categoryType: row.categories?.type ? String(row.categories.type) : undefined,
      departmentId: row.department_id ? String(row.department_id) : undefined,
      projectId: row.project_id ? String(row.project_id) : undefined,
      status: String(row.status || 'classified').toLowerCase(),
      worldScope: inferredWorld,
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
      isTransfer: Boolean(row.is_transfer),
      transferGroupId: row.transfer_group_id ? String(row.transfer_group_id) : undefined,
      tags,
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      createdAt: String(row.created_at || new Date().toISOString()),
    };
  });

  return mapped.filter((t) => {
    if (t.worldScope === 'personal' && t.ownerUserId && t.ownerUserId !== callerUserId && !isOrgOwner) {
      return false;
    }
    if (worldFilter === 'all') return true;
    return t.worldScope === worldFilter;
  });
}

export interface BalanceSheetLine {
  accountId: string;
  name: string;
  balance: number;
  type: 'current' | 'fixed' | 'longTerm' | 'equity';
}

export interface BalanceSheetSnapshot {
  asOfDate: string;
  cashInBank: number;
  cashOnHand: number;
  creditFromBanks: number;
  totalBankBalanceBase: number;
  totalLiquidCash: number;
  accountsReceivable: number;
  accountsPayable: number;
  loansReceivable: number;
  loansPayable: number;
  totalInventory: number;
  totalFixedAssets: number;
  otherAssets: number;
  otherLiabilities: number;
  currentAssets: number;
  fixedAssets: number;
  currentLiabilities: number;
  longTermLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netWorth: number;
  liquidNetWorth: number;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
}

export function computeBalanceSheetSnapshot(params: {
  orgCurrency: string;
  worldFilter: WorldFilter;
  allAccessibleBanks: Record<string, any>[];
  worldBanks: Record<string, any>[];
  rawTxns: Record<string, any>[];
  accounts: Record<string, any>[];
  loanRows: Record<string, any>[];
  assetRows: Record<string, any>[];
  invRows: Record<string, any>[];
  asOfDate?: string;
}): BalanceSheetSnapshot {
  const {
    orgCurrency,
    worldFilter,
    allAccessibleBanks,
    worldBanks,
    rawTxns,
    accounts,
    loanRows,
    assetRows,
    invRows,
    asOfDate,
  } = params;

  const refDate = asOfDate ? new Date(asOfDate) : new Date();
  const effectiveAsOf = asOfDate || new Date().toISOString().split('T')[0];

  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  const equity: BalanceSheetLine[] = [];

  const nonCashBankAccounts = worldBanks.filter(
    (b) => !CREDIT_ACCOUNT_TYPES.has(String(b.account_type || '')) && String(b.account_type || '') !== 'cash',
  );
  const cashTypeBankAccounts = worldBanks.filter((b) => String(b.account_type || '') === 'cash');
  const creditFacilityAccounts = worldBanks.filter((b) => CREDIT_ACCOUNT_TYPES.has(String(b.account_type || '')));

  let cashInBank = 0;
  for (const b of nonCashBankAccounts) {
    const liveNative = computeLiveBankBalance(b, rawTxns, orgCurrency, asOfDate);
    const balBase = Math.round(convertCurrency(liveNative, b.currency || orgCurrency, orgCurrency) * 100) / 100;
    cashInBank += balBase;
    const name = (b.bank_name || 'Bank Account') + (b.account_number ? ` · ${String(b.account_number).slice(-4)}` : '');
    assets.push({ accountId: String(b.id), name, balance: balBase, type: 'current' });
  }
  cashInBank = Math.round(cashInBank * 100) / 100;

  let physicalCashFromBankAccounts = 0;
  for (const b of cashTypeBankAccounts) {
    const liveNative = computeLiveBankBalance(b, rawTxns, orgCurrency, asOfDate);
    const balBase = Math.round(convertCurrency(liveNative, b.currency || orgCurrency, orgCurrency) * 100) / 100;
    physicalCashFromBankAccounts += balBase;
    const name = (b.bank_name || 'Cash in Hand') + (b.account_number ? ` · ${String(b.account_number).slice(-4)}` : '');
    assets.push({ accountId: String(b.id), name, balance: balBase, type: 'current' });
  }

  let creditFromBanks = 0;
  for (const b of creditFacilityAccounts) {
    const liveNative = computeLiveBankBalance(b, rawTxns, orgCurrency, asOfDate);
    const balBase = Math.round(Math.abs(convertCurrency(liveNative, b.currency || orgCurrency, orgCurrency)) * 100) / 100;
    creditFromBanks += balBase;
    const isLongTerm = String(b.account_type || '') === 'line_of_credit';
    liabilities.push({
      accountId: String(b.id),
      name: `${b.bank_name || 'Credit Facility'} (${b.account_type})`,
      balance: balBase,
      type: isLongTerm ? 'longTerm' : 'current',
    });
  }
  creditFromBanks = Math.round(creditFromBanks * 100) / 100;

  const accountsList = (accounts ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: String(row.type),
    subtype: String(row.subtype || ''),
    balance: Math.round(convertCurrency(Number(row.balance ?? 0), row.currency || orgCurrency, orgCurrency) * 100) / 100,
  }));

  // Unlinked Chart of Accounts physical cash
  const linkedCashCoAIds = new Set(cashTypeBankAccounts.map((b) => String(b.account_id || '')).filter(Boolean));
  const physicalCashCoAAccounts =
    worldFilter === 'personal'
      ? []
      : accountsList.filter((a) => a.type === 'asset' && a.subtype === 'cash' && !linkedCashCoAIds.has(a.id));

  let physicalCashFromCoA = 0;
  for (const a of physicalCashCoAAccounts) {
    physicalCashFromCoA += a.balance;
    if (a.balance !== 0) {
      assets.push({ accountId: a.id, name: a.name, balance: a.balance, type: 'current' });
    }
  }

  const cashOnHand = Math.round((physicalCashFromBankAccounts + physicalCashFromCoA) * 100) / 100;
  const totalBankBalanceBase = Math.round((cashInBank + cashOnHand - creditFromBanks) * 100) / 100;
  const totalLiquidCash = Math.max(0, Math.round((cashInBank + cashOnHand) * 100) / 100);

  // Fixed Assets (Net Book Value)
  const activeFixedAssets = worldFilter === 'personal' ? [] : (assetRows || []).filter((a) => a.status !== 'disposed');
  let totalFixedAssets = 0;
  for (const a of activeFixedAssets) {
    const p = Number(a.purchase_price || 0);
    let acc = Number(a.accumulated_depreciation || 0);
    const salv = Number(a.salvage_value || 0);
    const useful = Number(a.useful_life_years || 5);
    if (acc === 0 && a.purchase_date && useful > 0) {
      const pDate = new Date(a.purchase_date);
      const elapsedMonths = Math.max(0, (refDate.getFullYear() - pDate.getFullYear()) * 12 + (refDate.getMonth() - pDate.getMonth()));
      const deprAmount = Math.max(0, p - salv);
      acc = Math.min(deprAmount, (deprAmount / (useful * 12)) * elapsedMonths);
    }
    const cur = a.current_value != null ? Number(a.current_value) : Math.max(salv, p - acc);
    const netVal = Math.round(convertCurrency(cur, a.currency || orgCurrency, orgCurrency) * 100) / 100;
    totalFixedAssets += netVal;
    if (netVal > 0) {
      assets.push({ accountId: String(a.id), name: `Fixed Asset: ${a.name || 'Equipment'}`, balance: netVal, type: 'fixed' });
    }
  }
  totalFixedAssets = Math.round(totalFixedAssets * 100) / 100;

  // Inventory Valuation
  const activeInv = worldFilter === 'personal' ? [] : (invRows || []).filter((i) => i.is_active !== false);
  let totalInventory = 0;
  for (const item of activeInv) {
    const stock = Number(item.current_stock || 0);
    const cost = Number(item.average_cost || item.unit_cost || item.unit_price || 0);
    const val = Math.round(convertCurrency(stock * cost, item.currency || orgCurrency, orgCurrency) * 100) / 100;
    totalInventory += val;
    if (val > 0) {
      assets.push({ accountId: String(item.id), name: `Inventory: ${item.name}`, balance: val, type: 'current' });
    }
  }
  totalInventory = Math.round(totalInventory * 100) / 100;

  // Loans Receivable & Payable
  const activeLoans = worldFilter === 'personal' ? [] : (loanRows || []).filter((l) => l.status !== 'paid');
  let loansReceivable = 0;
  let loansPayable = 0;
  for (const l of activeLoans) {
    const bal = Math.round(
      convertCurrency(Number(l.remaining_balance ?? l.amount ?? l.principal) || 0, l.currency || orgCurrency, orgCurrency) * 100,
    ) / 100;
    if (bal <= 0) continue;
    const loanDesc = l.description ? `${l.description} (${l.party})` : `Loan: ${l.party || 'Obligation'}`;
    if (l.type === 'to_receive') {
      loansReceivable += bal;
      assets.push({ accountId: String(l.id), name: `Loan Receivable: ${loanDesc}`, balance: bal, type: 'current' });
    } else if (l.type === 'to_pay') {
      loansPayable += bal;
      const isLongTerm = (l.term_months && Number(l.term_months) > 12) || l.frequency === 'annual';
      liabilities.push({
        accountId: String(l.id),
        name: `Loan Payable: ${loanDesc}`,
        balance: bal,
        type: isLongTerm ? 'longTerm' : 'current',
      });
    }
  }
  loansReceivable = Math.round(loansReceivable * 100) / 100;
  loansPayable = Math.round(loansPayable * 100) / 100;

  // Accounts Receivable (CoA AR + Loans Receivable)
  const arAccounts =
    worldFilter === 'personal'
      ? []
      : accountsList.filter(
          (a) => a.type === 'asset' && (a.subtype === 'accounts_receivable' || a.name.toLowerCase().includes('receivable')),
        );
  let coaArBalance = 0;
  for (const a of arAccounts) {
    coaArBalance += a.balance;
    if (a.balance !== 0) {
      assets.push({ accountId: a.id, name: a.name, balance: a.balance, type: 'current' });
    }
  }
  const accountsReceivable = Math.round((coaArBalance + loansReceivable) * 100) / 100;

  // Accounts Payable (Deduplicated with Loans Payable)
  const apAccounts =
    worldFilter === 'personal'
      ? []
      : accountsList.filter(
          (a) => a.type === 'liability' && (a.subtype === 'accounts_payable' || a.name.toLowerCase().includes('payable')),
        );
  const apBalance = apAccounts.reduce((s, a) => s + a.balance, 0);
  const apIsDuplicateOfLoans = loansPayable > 0 && Math.abs(apBalance - loansPayable) < 2000;
  const accountsPayable = Math.round(
    (apIsDuplicateOfLoans ? Math.max(apBalance, loansPayable) : apBalance + loansPayable) * 100,
  ) / 100;

  if (!apIsDuplicateOfLoans) {
    for (const a of apAccounts) {
      if (a.balance !== 0) {
        liabilities.push({ accountId: a.id, name: a.name, balance: a.balance, type: 'current' });
      }
    }
  }

  // Other Assets & Liabilities (Strictly deduplicated)
  const allBankCoAIds = new Set(allAccessibleBanks.map((b) => String(b.account_id || '')).filter(Boolean));
  const otherAssetAccounts =
    worldFilter === 'personal'
      ? []
      : accountsList.filter(
          (a) =>
            a.type === 'asset' &&
            !allBankCoAIds.has(a.id) &&
            !['cash', 'bank_account', 'current_asset', 'accounts_receivable', 'inventory', 'fixed_asset'].includes(a.subtype) &&
            !a.name.toLowerCase().includes('receivable') &&
            !a.name.toLowerCase().includes('inventory') &&
            !a.name.toLowerCase().includes('fixed asset') &&
            !a.name.toLowerCase().includes('bank') &&
            !a.name.toLowerCase().includes('cash'),
        );
  let otherAssets = 0;
  for (const a of otherAssetAccounts) {
    otherAssets += a.balance;
    if (a.balance !== 0) {
      assets.push({ accountId: a.id, name: a.name, balance: a.balance, type: 'current' });
    }
  }
  otherAssets = Math.round(otherAssets * 100) / 100;

  const otherLiabilityAccounts =
    worldFilter === 'personal'
      ? []
      : accountsList.filter(
          (a) =>
            a.type === 'liability' &&
            !['accounts_payable', 'credit_card', 'line_of_credit'].includes(a.subtype) &&
            !a.name.toLowerCase().includes('payable'),
        );
  let otherLiabilities = 0;
  for (const a of otherLiabilityAccounts) {
    otherLiabilities += a.balance;
    if (a.balance !== 0) {
      liabilities.push({
        accountId: a.id,
        name: a.name,
        balance: a.balance,
        type: a.subtype === 'long_term' ? 'longTerm' : 'current',
      });
    }
  }
  otherLiabilities = Math.round(otherLiabilities * 100) / 100;

  const totalAssets = Math.round((cashInBank + cashOnHand + accountsReceivable + totalInventory + totalFixedAssets + otherAssets) * 100) / 100;
  const totalLiabilities = Math.round((creditFromBanks + accountsPayable + otherLiabilities) * 100) / 100;
  const netWorth = Math.round((totalAssets - totalLiabilities) * 100) / 100;
  const liquidNetWorth = Math.round((cashInBank + cashOnHand - totalLiabilities) * 100) / 100;

  const currentAssets = Math.round((totalAssets - totalFixedAssets) * 100) / 100;
  const longTermLiabilities = Math.round(
    liabilities.filter((l) => l.type === 'longTerm').reduce((s, l) => s + l.balance, 0) * 100,
  ) / 100;
  const currentLiabilities = Math.round((totalLiabilities - longTermLiabilities) * 100) / 100;

  equity.push({
    accountId: 'retained-earnings',
    name: "Owner's Equity & Retained Earnings",
    balance: netWorth,
    type: 'equity',
  });

  return {
    asOfDate: effectiveAsOf,
    cashInBank,
    cashOnHand,
    creditFromBanks,
    totalBankBalanceBase,
    totalLiquidCash,
    accountsReceivable,
    accountsPayable,
    loansReceivable,
    loansPayable,
    totalInventory,
    totalFixedAssets,
    otherAssets,
    otherLiabilities,
    currentAssets,
    fixedAssets: totalFixedAssets,
    currentLiabilities,
    longTermLiabilities,
    totalAssets,
    totalLiabilities,
    totalEquity: netWorth,
    netWorth,
    liquidNetWorth,
    assets,
    liabilities,
    equity,
  };
}

export function computeProfitLossSnapshot(params: {
  committedPlTransactions: MappedTransaction[];
  catMap: Map<string, string>;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { committedPlTransactions, catMap, dateFrom, dateTo } = params;

  const filtered = committedPlTransactions.filter((t) => {
    if (dateFrom && t.date && t.date < dateFrom) return false;
    if (dateTo && t.date && t.date > dateTo) return false;
    return true;
  });

  const revMap = new Map<string, number>();
  const expMap = new Map<string, number>();
  const cogsMap = new Map<string, number>();
  const taxMap = new Map<string, number>();
  const interestMap = new Map<string, number>();

  for (const t of filtered) {
    const catName = t.categoryName || (t.categoryId ? catMap.get(t.categoryId) : '') || 'General';
    const catType = String(t.categoryType || '').toLowerCase();
    const amt = Math.abs(t.amount);
    const desc = t.description.toLowerCase();
    const narr = t.narration.toLowerCase();
    const tags = t.tags || [];

    if (t.type === 'credit') {
      let label = catName;
      const isExpenseCategoryName =
        catType === 'expense' ||
        /software|tools|supplies|rent|maintenance|travel|tax|payroll|salary|marketing|debit/i.test(label);

      if (desc.includes('inventory sale') || narr.includes('sale:')) {
        label = 'Product & Inventory Sales';
      } else if (desc.includes('refund') || narr.includes('refund')) {
        label = 'Vendor Refunds & Rebates';
      } else if (label === 'General' || isExpenseCategoryName) {
        label = 'Client Revenue & Sales';
      }
      revMap.set(label, (revMap.get(label) || 0) + amt);
    } else {
      if (isLoanRepaymentTxn(t, catMap)) {
        continue;
      }

      const isInterest =
        catName.toLowerCase().includes('interest') ||
        desc.includes('loan interest') ||
        desc.includes('interest expense') ||
        narr.includes('interest expense') ||
        tags.includes('interest');
      if (isInterest) {
        const label = catName || 'Loan Interest Expense';
        interestMap.set(label, (interestMap.get(label) || 0) + amt);
        continue;
      }

      const isTax =
        catType === 'tax' ||
        tags.includes('tax') ||
        tags.includes('corporate-tax') ||
        /^(tax|corporate tax|income tax|sales tax|vat expense)\b/i.test(catName) ||
        desc.includes('tax payment') ||
        narr.includes('tax payment');
      if (isTax) {
        const label = catName || 'Tax Expense';
        taxMap.set(label, (taxMap.get(label) || 0) + amt);
        continue;
      }

      const isDirectCost =
        desc.includes('inventory purchase') ||
        narr.includes('purchase:') ||
        Boolean(t.projectId) ||
        catName.toLowerCase().includes('cogs') ||
        catName.toLowerCase().includes('cost of goods') ||
        catName.toLowerCase().includes('software & tools') ||
        catName.toLowerCase().includes('debit purchase');

      if (isDirectCost) {
        let cogsLabel = catName;
        if (desc.includes('inventory purchase') || narr.includes('purchase:')) {
          cogsLabel = 'Inventory Purchases & Direct Materials';
        } else if (catName === 'General') {
          cogsLabel = 'Direct Delivery Costs';
        }
        cogsMap.set(cogsLabel, (cogsMap.get(cogsLabel) || 0) + amt);
      } else {
        let expLabel = catName.trim();
        if (
          expLabel === 'General' &&
          (desc.includes('salary') || desc.includes('payroll') || tags.includes('salary') || tags.includes('payroll-slip'))
        ) {
          expLabel = 'Payroll & Salaries';
        }
        expMap.set(expLabel, (expMap.get(expLabel) || 0) + amt);
      }
    }
  }

  const revenue = Array.from(revMap.entries()).map(([name, amount], idx) => ({
    accountId: `rev-${idx}`,
    name,
    amount: Math.round(amount * 100) / 100,
  }));
  const cogs = Array.from(cogsMap.entries()).map(([name, amount], idx) => ({
    accountId: `cogs-${idx}`,
    name,
    amount: Math.round(amount * 100) / 100,
  }));
  const operatingExpenses = Array.from(expMap.entries()).map(([name, amount], idx) => ({
    accountId: `opex-${idx}`,
    name,
    amount: Math.round(amount * 100) / 100,
  }));
  const taxes = Array.from(taxMap.entries()).map(([name, amount], idx) => ({
    accountId: `tax-${idx}`,
    name,
    amount: Math.round(amount * 100) / 100,
  }));
  const interest = Array.from(interestMap.entries()).map(([name, amount], idx) => ({
    accountId: `int-${idx}`,
    name,
    amount: Math.round(amount * 100) / 100,
  }));

  const totalRevenue = Math.round(revenue.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const totalCOGS = Math.round(cogs.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const grossProfit = Math.round((totalRevenue - totalCOGS) * 100) / 100;
  const totalOperatingExpenses = Math.round(operatingExpenses.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const operatingIncome = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;
  const taxExpense = Math.round(taxes.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const interestExpense = Math.round(interest.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const netIncome = Math.round((operatingIncome - taxExpense - interestExpense) * 100) / 100;

  return {
    period: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : 'All Time',
    basis: 'cash',
    revenue,
    cogs,
    operatingExpenses,
    taxes,
    interest,
    totalRevenue,
    totalCOGS,
    grossProfit,
    totalOperatingExpenses,
    operatingIncome,
    taxExpense,
    interestExpense,
    netIncome,
  };
}

export function computeCashFlowSnapshot(params: {
  worldTransactions: MappedTransaction[];
  catMap: Map<string, string>;
  months: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { worldTransactions, catMap, months, dateFrom, dateTo } = params;

  const postedExternal = worldTransactions.filter((t) => {
    if (NON_POSTED_STATUSES.has(t.status)) return false;
    if (isTransferTxn(t, catMap)) return false;
    if (dateFrom && t.date && t.date < dateFrom) return false;
    if (dateTo && t.date && t.date > dateTo) return false;
    return true;
  });

  const monthMap = new Map<string, { inflow: number; outflow: number }>();
  for (const t of postedExternal) {
    const m = String(t.date || '').slice(0, 7);
    if (!m) continue;
    if (!monthMap.has(m)) monthMap.set(m, { inflow: 0, outflow: 0 });
    const entry = monthMap.get(m)!;
    const amt = Math.abs(t.amount);
    if (t.type === 'credit') entry.inflow += amt;
    else entry.outflow += amt;
  }

  const sortedMonths = Array.from(monthMap.keys()).sort();
  return sortedMonths.slice(-months).map((month) => {
    const d = monthMap.get(month)!;
    return {
      month,
      inflow: Math.round(d.inflow * 100) / 100,
      outflow: Math.round(d.outflow * 100) / 100,
      net: Math.round((d.inflow - d.outflow) * 100) / 100,
    };
  });
}
