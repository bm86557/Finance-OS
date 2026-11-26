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

export function computeFifoAwareInventoryValue(
  item: Record<string, any>,
  layersByItem: Map<string, Array<{ quantity_remaining: number; unit_cost: number }>>,
): number {
  const method = String(item.costing_method ?? item.costingMethod ?? 'weighted_average');
  if (method === 'fifo') {
    const layers = layersByItem.get(String(item.id));
    if (layers && layers.length > 0) {
      return layers.reduce((s, l) => s + Number(l.quantity_remaining || 0) * Number(l.unit_cost || 0), 0);
    }
  }
  const stock = Number(item.current_stock ?? item.currentStock ?? 0);
  const cost = Number(item.average_cost ?? item.averageCost ?? item.unit_cost ?? item.unit_price ?? 0);
  return stock * cost;
}

export function buildInventoryLayerMap(
  invLayerRows?: Record<string, any>[],
): Map<string, Array<{ quantity_remaining: number; unit_cost: number }>> {
  const map = new Map<string, Array<{ quantity_remaining: number; unit_cost: number }>>();
  for (const l of invLayerRows || []) {
    const qty = Number(l.quantity_remaining || 0);
    if (qty <= 0) continue;
    const key = String(l.inventory_item_id);
    const arr = map.get(key) || [];
    arr.push({ quantity_remaining: qty, unit_cost: Number(l.unit_cost || 0) });
    map.set(key, arr);
  }
  return map;
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
  invLayerRows?: Record<string, any>[];
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
    invLayerRows,
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

  // Inventory Valuation (FIFO layers for FIFO items, weighted average otherwise)
  const activeInv = worldFilter === 'personal' ? [] : (invRows || []).filter((i) => i.is_active !== false);
  const invLayersByItem = buildInventoryLayerMap(invLayerRows);
  let totalInventory = 0;
  for (const item of activeInv) {
    const rawVal = computeFifoAwareInventoryValue(item, invLayersByItem);
    const val = Math.round(convertCurrency(rawVal, item.currency || orgCurrency, orgCurrency) * 100) / 100;
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

// ═══════════════════════════════════════════════════════════════════════════
// Upcoming Payments & Expenses Engine (Handoff v1.2 §§1, 5, 6, 7, 8, 13, 29, 33)
// ═══════════════════════════════════════════════════════════════════════════

export type UpcomingSourceType = 'recurring' | 'loan' | 'payroll' | 'invoice' | 'reimbursement';

export interface UpcomingItem {
  id: string;
  date: string;
  isoDate: string;
  title: string;
  amount: number;
  rawAmount: number;
  currency: string;
  originalCurrency: string;
  type: 'credit' | 'debit';
  sourceType: UpcomingSourceType;
  sourceId: string;
  isOverdue: boolean;
  daysOverdue?: number;
  subtitle?: string;
}

export interface UpcomingObligationsSnapshot {
  upcomingPayments: UpcomingItem[];
  upcomingExpenses: UpcomingItem[];
  overduePayments: UpcomingItem[];
  overdueExpenses: UpcomingItem[];
  totalUpcomingPayments: number;
  totalUpcomingExpenses: number;
  totalOverduePayments: number;
  totalOverdueExpenses: number;
  remainingMonthlyPayroll: number;
  windowStart: string;
  windowEnd: string;
  basis: 'cash_scheduled';
  currency: string;
  worldScope: WorldFilter;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/**
 * Strict active membership predicate.
 * Prevents `status: 'pending' | 'inactive' | 'terminated'` members from being
 * counted simply because `is_active` is undefined on `organization_members`.
 */
export function isActiveOrgMember(member: Record<string, any> | null | undefined): boolean {
  if (!member) return false;
  const st = String(member.status ?? '').toLowerCase().trim();
  if (st.length > 0) {
    return st === 'active';
  }
  return member.is_active !== false;
}

function toIsoDateUtc(input: unknown): string | null {
  if (!input) return null;
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(input).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
    return null;
  }
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function parseIsoUtcParts(iso: string): { year: number; month0: number; day: number; ms: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month0: m - 1, day: d, ms: Date.UTC(y, m - 1, d) };
}

function formatIsoFromParts(year: number, month0: number, day: number): string {
  const dt = new Date(Date.UTC(year, month0, day));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function addDaysUtc(iso: string, days: number): string {
  const { year, month0, day } = parseIsoUtcParts(iso);
  return formatIsoFromParts(year, month0, day + days);
}

function addMonthsClampedUtc(iso: string, monthsToAdd: number): string {
  const { year, month0, day } = parseIsoUtcParts(iso);
  const targetFirst = new Date(Date.UTC(year, month0 + monthsToAdd, 1));
  const lastDayOfTarget = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  return formatIsoFromParts(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(day, lastDayOfTarget));
}

function advanceIsoByFrequency(iso: string, frequency?: string): string {
  const f = String(frequency || 'monthly').toLowerCase().trim();
  if (f === 'daily') return addDaysUtc(iso, 1);
  if (f === 'weekly') return addDaysUtc(iso, 7);
  if (f === 'biweekly' || f === 'bi-weekly') return addDaysUtc(iso, 14);
  if (f === 'quarterly') return addMonthsClampedUtc(iso, 3);
  if (f === 'yearly' || f === 'annual' || f === 'annually') return addMonthsClampedUtc(iso, 12);
  return addMonthsClampedUtc(iso, 1);
}

function diffDaysUtc(fromIso: string, toIso: string): number {
  return Math.round((parseIsoUtcParts(toIso).ms - parseIsoUtcParts(fromIso).ms) / 86_400_000);
}

function formatDisplayDateUtc(iso: string): string {
  const { month0, day } = parseIsoUtcParts(iso);
  return `${SHORT_MONTHS[month0]} ${day}`;
}

function endOfMonthIsoUtc(year: number, month0: number): string {
  const dt = new Date(Date.UTC(year, month0 + 1, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function payslipMatchesMonth(ps: Record<string, any>, year: number, month0: number): boolean {
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`;
  const periodRaw = String(ps.period || '').toLowerCase().trim();
  if (periodRaw) {
    if (periodRaw.includes(ym)) return true;
    const longMonth = LONG_MONTHS[month0];
    const shortMonth = SHORT_MONTHS[month0].toLowerCase();
    const hasYear = periodRaw.includes(String(year));
    const hasMonth = periodRaw.includes(longMonth) || new RegExp(`\\b${shortMonth}\\b`).test(periodRaw);
    if (hasYear && hasMonth) return true;
    // Handle MM/YYYY or MM-YYYY
    const mm = String(month0 + 1).padStart(2, '0');
    if (periodRaw === `${mm}/${year}` || periodRaw === `${mm}-${year}`) return true;
    return false;
  }
  const issueIso = toIsoDateUtc(ps.issue_date || ps.paid_date);
  return Boolean(issueIso && issueIso.startsWith(ym));
}

function sortUpcomingItems(items: UpcomingItem[]): UpcomingItem[] {
  return items.sort((a, b) => {
    if (a.isoDate !== b.isoDate) return a.isoDate.localeCompare(b.isoDate);
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.title.localeCompare(b.title);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Authoritative 30-day Upcoming Payments & Expenses Engine.
 *
 * Strictly enforces Handoff v1.2 invariants:
 *  - Zero mock data; 100% real org Supabase rows.
 *  - World isolation (`business` vs `personal` vs `all`) across recurring schedules, loans, payroll, invoices, and reimbursements.
 *  - Calendar-date cutoffs (`today` .. `today + horizonDays`) with explicit overdue separation (`isoDate < today`).
 *  - Recurring expiration (`end_date`, `generated_occurrence_count >= total_occurrences_expected`) and multi-occurrence expansion (weekly/daily).
 *  - Loan double-payment prevention (`loan_payments` + `last_payment_month`), null-date rejection, and remaining-obligation cap.
 *  - Customer invoices (`issued`, `sent`, `partially_paid`, `overdue` with `amount_due > 0`).
 *  - Remaining unpaid Team Payroll (`organization_members` strictly `status === 'active'` minus already-paid/issued `employee_payslips` for the current month), RBAC-masked for non-privileged roles, deduplicated against recurring payroll templates.
 *  - Approved unreimbursed `employee_expenses` (`status === 'approved'`, no `settlement_transaction_id`, not already bundled into a non-voided payslip).
 *  - Deterministic chronological sorting and base-currency normalization.
 */
export function computeUpcomingObligations(params: {
  orgCurrency: string;
  worldFilter: WorldFilter;
  includePayrollConfidential: boolean;
  allOrgBanks: Record<string, any>[];
  bankWorldMap: Map<string, 'business' | 'personal'>;
  recurringRows: Record<string, any>[];
  recurringOccurrenceRows?: Record<string, any>[];
  loanRows: Record<string, any>[];
  loanPaymentRows?: Record<string, any>[];
  memberRows: Record<string, any>[];
  payslipRows?: Record<string, any>[];
  employeeExpenseRows?: Record<string, any>[];
  invoiceRows?: Record<string, any>[];
  asOfDate?: Date | string;
  horizonDays?: number;
}): UpcomingObligationsSnapshot {
  const {
    orgCurrency,
    worldFilter,
    includePayrollConfidential,
    allOrgBanks,
    bankWorldMap,
    recurringRows,
    recurringOccurrenceRows = [],
    loanRows,
    loanPaymentRows = [],
    memberRows,
    payslipRows = [],
    employeeExpenseRows = [],
    invoiceRows = [],
    asOfDate = new Date(),
    horizonDays = 30,
  } = params;

  const baseCurr = String(orgCurrency || 'USD').toUpperCase().trim();
  // Use local calendar date when given a live Date so the user's day matches their cockpit,
  // or exact ISO date when passed as string (for deterministic golden tests).
  const todayStr =
    typeof asOfDate === 'string'
      ? (toIsoDateUtc(asOfDate) || toIsoDateUtc(new Date())!)
      : `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}-${String(asOfDate.getDate()).padStart(2, '0')}`;
  const horizonEndStr = addDaysUtc(todayStr, Math.max(1, horizonDays));

  const upcomingPayments: UpcomingItem[] = [];
  const upcomingExpenses: UpcomingItem[] = [];
  const overduePayments: UpcomingItem[] = [];
  const overdueExpenses: UpcomingItem[] = [];

  const allBankIds = new Set((allOrgBanks || []).map((b) => String(b.id)));

  // Index already-settled/skipped recurring occurrences so they never re-appear as overdue/upcoming
  const settledRecurringOccurrences = new Set<string>();
  for (const occ of recurringOccurrenceRows || []) {
    const st = String(occ.status || '').toLowerCase().trim();
    if (st === 'posted' || st === 'skipped') {
      if (occ.template_id && occ.scheduled_date) {
        const dIso = toIsoDateUtc(occ.scheduled_date);
        if (dIso) settledRecurringOccurrences.add(`${String(occ.template_id)}:${dIso}`);
      }
      if (occ.template_id && occ.scheduled_period_key) {
        settledRecurringOccurrences.add(`${String(occ.template_id)}:${String(occ.scheduled_period_key)}`);
      }
    }
  }

  // ── 1. Recurring Transactions ────────────────────────────────────────────
  for (const rec of recurringRows || []) {
    if (rec.is_active === false || rec.isActive === false) continue;

    const rawAmt = Math.abs(Number(rec.amount || 0));
    if (!Number.isFinite(rawAmt) || rawAmt <= 0) continue;

    // World isolation via linked bank account or explicit world_scope/usage
    const bankId = rec.bank_account_id ? String(rec.bank_account_id) : '';
    const bankWorld = bankId ? bankWorldMap.get(bankId) : undefined;
    if (bankId && !bankWorld && allBankIds.has(bankId)) {
      // Linked to another user's private personal bank account
      continue;
    }
    const recWorld: 'business' | 'personal' =
      bankWorld || (rec.world_scope === 'personal' || rec.usage === 'personal' ? 'personal' : 'business');
    if (worldFilter !== 'all' && recWorld !== worldFilter) continue;

    const nextIso = toIsoDateUtc(rec.next_occurrence || rec.nextOccurrence || rec.start_date || rec.startDate);
    if (!nextIso) continue;

    const endDateIso = toIsoDateUtc(rec.end_date || rec.endDate);
    const genCount = Number(rec.generated_occurrence_count ?? rec.generatedOccurrenceCount ?? 0);
    const expectedRaw = rec.total_occurrences_expected ?? rec.totalOccurrencesExpected;
    const expectedCount = expectedRaw != null && expectedRaw !== '' ? Number(expectedRaw) : null;

    // Strict expiration & completion checks
    if (expectedCount != null && Number.isFinite(expectedCount) && genCount >= expectedCount) {
      continue;
    }
    if (endDateIso && nextIso > endDateIso) {
      continue;
    }

    const origCurr = String(rec.currency || baseCurr).toUpperCase().trim();
    const convAmt = round2(convertCurrency(rawAmt, origCurr, baseCurr));
    const recTypeNorm = String(rec.type || '').toLowerCase().trim();
    const direction: 'credit' | 'debit' =
      recTypeNorm === 'credit' || recTypeNorm === 'income' ? 'credit' : 'debit';
    const freq = String(rec.frequency || 'monthly').toLowerCase().trim();
    const title = String(rec.description || 'Recurring Transaction').trim() || 'Recurring Transaction';

    const maxRemainingRuns =
      expectedCount != null && Number.isFinite(expectedCount)
        ? Math.max(0, expectedCount - genCount)
        : 120;

    let curIso = nextIso;
    let emittedRuns = 0;
    let safetySteps = 0;
    let overdueEmitted = false;

    while (curIso <= horizonEndStr && emittedRuns < maxRemainingRuns && safetySteps < 120) {
      safetySteps++;
      if (endDateIso && curIso > endDateIso) break;

      const isAlreadySettled = settledRecurringOccurrences.has(`${String(rec.id)}:${curIso}`);
      if (!isAlreadySettled) {
        if (curIso < todayStr) {
          // Emit the overdue occurrence once (matches recurring_generate_due semantics)
          if (!overdueEmitted) {
            overdueEmitted = true;
            emittedRuns++;
            const item: UpcomingItem = {
              id: `rec-overdue-${rec.id}-${curIso}`,
              date: formatDisplayDateUtc(curIso),
              isoDate: curIso,
              title,
              amount: convAmt,
              rawAmount: round2(rawAmt),
              currency: baseCurr,
              originalCurrency: origCurr,
              type: direction,
              sourceType: 'recurring',
              sourceId: String(rec.id),
              isOverdue: true,
              daysOverdue: diffDaysUtc(curIso, todayStr),
            };
            if (direction === 'credit') overduePayments.push(item);
            else overdueExpenses.push(item);
          }
        } else {
          emittedRuns++;
          const item: UpcomingItem = {
            id: `rec-${rec.id}-${curIso}`,
            date: formatDisplayDateUtc(curIso),
            isoDate: curIso,
            title,
            amount: convAmt,
            rawAmount: round2(rawAmt),
            currency: baseCurr,
            originalCurrency: origCurr,
            type: direction,
            sourceType: 'recurring',
            sourceId: String(rec.id),
            isOverdue: false,
          };
          if (direction === 'credit') upcomingPayments.push(item);
          else upcomingExpenses.push(item);
        }
      }

      const nextStep = advanceIsoByFrequency(curIso, freq);
      if (nextStep <= curIso) break; // safety guard
      curIso = nextStep;
    }
  }

  // ── 2. Active Loan Installments (business / all world) ───────────────────
  if (worldFilter !== 'personal') {
    const paidLoanMonths = new Set<string>();
    for (const lp of loanPaymentRows || []) {
      if (lp.loan_id && lp.payment_month) {
        paidLoanMonths.add(`${String(lp.loan_id)}:${String(lp.payment_month).slice(0, 7)}`);
      }
    }

    for (const loan of loanRows || []) {
      const status = String(loan.status || 'active').toLowerCase().trim();
      if (['paid', 'defaulted', 'cancelled'].includes(status)) continue;

      const principal = Number(loan.principal ?? loan.amount ?? 0);
      const paid = Number(loan.amount_paid ?? 0);
      const remaining = Number(loan.remaining_balance ?? Math.max(0, principal - paid));
      if (!Number.isFinite(remaining) || remaining <= 0) continue;

      const declaredInst = Number(loan.installment_amount ?? 0);

      // Require a valid date — never fabricate an undated "Upcoming" row
      let nextIso = toIsoDateUtc(loan.next_payment_date || loan.due_date);
      if (!nextIso) continue;

      if (loan.last_payment_month) {
        paidLoanMonths.add(`${String(loan.id)}:${String(loan.last_payment_month).slice(0, 7)}`);
      }

      // Guard against showing an installment whose month was already paid
      const loanFreq = String(loan.frequency || 'monthly').toLowerCase().trim();
      let advanceGuard = 0;
      while (paidLoanMonths.has(`${String(loan.id)}:${nextIso.slice(0, 7)}`) && advanceGuard < 12) {
        nextIso = advanceIsoByFrequency(nextIso, loanFreq);
        advanceGuard++;
      }

      if (nextIso > horizonEndStr) continue;

      // Cap final installment to remaining balance + accrued interest; fall back to full remaining obligation for bullet loans
      const accruedInterest = Math.max(0, Number(loan.accrued_interest || 0));
      const totalRemainingObligation = remaining + accruedInterest;
      const effectiveInst =
        Number.isFinite(declaredInst) && declaredInst > 0
          ? Math.min(declaredInst, totalRemainingObligation)
          : totalRemainingObligation;
      if (effectiveInst <= 0) continue;

      const origCurr = String(loan.currency || baseCurr).toUpperCase().trim();
      const convAmt = round2(convertCurrency(effectiveInst, origCurr, baseCurr));
      const isReceivable = loan.type === 'to_receive';
      const direction: 'credit' | 'debit' = isReceivable ? 'credit' : 'debit';
      const title =
        String(loan.description || '').trim() ||
        (isReceivable ? `Loan Collection · ${loan.party || ''}`.trim() : `Loan Repayment · ${loan.party || ''}`.trim());

      const isOverdue = nextIso < todayStr;
      const item: UpcomingItem = {
        id: `loan-${loan.id}-${nextIso}`,
        date: formatDisplayDateUtc(nextIso),
        isoDate: nextIso,
        title,
        amount: convAmt,
        rawAmount: round2(effectiveInst),
        currency: baseCurr,
        originalCurrency: origCurr,
        type: direction,
        sourceType: 'loan',
        sourceId: String(loan.id),
        isOverdue,
        ...(isOverdue ? { daysOverdue: diffDaysUtc(nextIso, todayStr) } : {}),
      };

      if (isOverdue) {
        if (isReceivable) overduePayments.push(item);
        else overdueExpenses.push(item);
      } else {
        if (isReceivable) upcomingPayments.push(item);
        else upcomingExpenses.push(item);
      }
    }
  }

  // ── 3. Open Issued Customer Invoices (Receivables — §29 X-12) ────────────
  if (worldFilter !== 'personal') {
    const collectibleStatuses = new Set(['issued', 'sent', 'partially_paid', 'overdue']);
    for (const inv of invoiceRows || []) {
      const status = String(inv.status || '').toLowerCase().trim();
      if (!collectibleStatuses.has(status)) continue;

      const amountDue = Number(inv.amount_due ?? Math.max(0, Number(inv.total_amount || 0) - Number(inv.amount_paid || 0)));
      if (!Number.isFinite(amountDue) || amountDue <= 0) continue;

      const dueIso = toIsoDateUtc(inv.due_date);
      if (!dueIso || dueIso > horizonEndStr) continue;

      const origCurr = String(inv.currency || baseCurr).toUpperCase().trim();
      const convAmt = round2(convertCurrency(amountDue, origCurr, baseCurr));
      const invNum = String(inv.invoice_number || '').trim();
      const clientName = String(inv.client_name || '').trim();
      const title = clientName && invNum
        ? `${invNum} · ${clientName}`
        : (clientName || invNum || 'Customer Invoice');

      const isOverdue = dueIso < todayStr;
      const item: UpcomingItem = {
        id: `inv-${inv.id}-${dueIso}`,
        date: formatDisplayDateUtc(dueIso),
        isoDate: dueIso,
        title,
        amount: convAmt,
        rawAmount: round2(amountDue),
        currency: baseCurr,
        originalCurrency: origCurr,
        type: 'credit',
        sourceType: 'invoice',
        sourceId: String(inv.id),
        isOverdue,
        ...(isOverdue ? { daysOverdue: diffDaysUtc(dueIso, todayStr) } : {}),
      };

      if (isOverdue) overduePayments.push(item);
      else upcomingPayments.push(item);
    }
  }

  // ── 4. Remaining Unpaid Team Payroll (§5, §20, §29 X-07, §33 #1/#3/#11) ──
  let remainingMonthlyPayroll = 0;
  if (worldFilter !== 'personal' && includePayrollConfidential) {
    const hasRecurringPayrollInWindow = [...upcomingExpenses, ...overdueExpenses].some(
      (e) => e.sourceType === 'recurring' && /\b(payroll|salaries|team\s+payroll)\b/i.test(e.title),
    );

    const { year: curYear, month0: curMonth0 } = parseIsoUtcParts(todayStr);
    const activeMembers = (memberRows || []).filter(isActiveOrgMember);

    // Map already-paid/issued salary per user_id for the current month (excluding voided/draft payslips)
    const paidSalaryByUser = new Map<string, number>();
    const settledStatuses = new Set(['paid', 'issued', 'processing']);
    for (const ps of payslipRows || []) {
      const psStatus = String(ps.status || '').toLowerCase().trim();
      if (!settledStatuses.has(psStatus)) continue;
      if (!payslipMatchesMonth(ps, curYear, curMonth0)) continue;

      const uid = String(ps.user_id || '');
      if (!uid) continue;

      const explicitSal = Number(ps.salary_amount || 0);
      const reimb = Number(ps.reimbursement_amount || 0);
      const grossOrNet = Number(ps.gross ?? ps.net ?? 0);
      const nativeSalPaid = explicitSal > 0 ? explicitSal : Math.max(0, grossOrNet - reimb);
      if (nativeSalPaid <= 0) continue;

      const psCurr = String(ps.currency || baseCurr).toUpperCase().trim();
      const paidBase = convertCurrency(nativeSalPaid, psCurr, baseCurr);
      paidSalaryByUser.set(uid, round2((paidSalaryByUser.get(uid) || 0) + paidBase));
    }

    let fullMonthlyPayroll = 0;
    let totalSalariedHeadcount = 0;
    let unpaidSalariedHeadcount = 0;

    for (const m of activeMembers) {
      const salNative = Number(m.fixed_salary || m.salary || 0);
      if (!Number.isFinite(salNative) || salNative <= 0) continue;

      const salCurr = String(m.salary_currency || m.currency || baseCurr).toUpperCase().trim();
      const salBase = round2(convertCurrency(salNative, salCurr, baseCurr));
      fullMonthlyPayroll = round2(fullMonthlyPayroll + salBase);
      totalSalariedHeadcount++;

      const uid = String(m.user_id || m.id || '');
      const alreadyPaid = paidSalaryByUser.get(uid) || 0;
      const remaining = Math.max(0, round2(salBase - alreadyPaid));
      if (remaining > 0.01) {
        remainingMonthlyPayroll = round2(remainingMonthlyPayroll + remaining);
        unpaidSalariedHeadcount++;
      }
    }

    if (!hasRecurringPayrollInWindow) {
      const curMonthEndIso = endOfMonthIsoUtc(curYear, curMonth0);
      if (remainingMonthlyPayroll > 0 && curMonthEndIso >= todayStr && curMonthEndIso <= horizonEndStr) {
        upcomingExpenses.push({
          id: `payroll-${curMonthEndIso}`,
          date: formatDisplayDateUtc(curMonthEndIso),
          isoDate: curMonthEndIso,
          title: 'Team Payroll',
          amount: remainingMonthlyPayroll,
          rawAmount: remainingMonthlyPayroll,
          currency: baseCurr,
          originalCurrency: baseCurr,
          type: 'debit',
          sourceType: 'payroll',
          sourceId: `payroll-${curMonthEndIso}`,
          isOverdue: false,
          ...(unpaidSalariedHeadcount < totalSalariedHeadcount
            ? { subtitle: `${unpaidSalariedHeadcount} of ${totalSalariedHeadcount} remaining` }
            : {}),
        });
      } else if (remainingMonthlyPayroll === 0 && fullMonthlyPayroll > 0) {
        // Current month fully settled — project next month-end if it falls within the 30-day horizon
        const nextMonthEndIso = endOfMonthIsoUtc(curYear, curMonth0 + 1);
        if (nextMonthEndIso >= todayStr && nextMonthEndIso <= horizonEndStr) {
          upcomingExpenses.push({
            id: `payroll-${nextMonthEndIso}`,
            date: formatDisplayDateUtc(nextMonthEndIso),
            isoDate: nextMonthEndIso,
            title: 'Team Payroll',
            amount: fullMonthlyPayroll,
            rawAmount: fullMonthlyPayroll,
            currency: baseCurr,
            originalCurrency: baseCurr,
            type: 'debit',
            sourceType: 'payroll',
            sourceId: `payroll-${nextMonthEndIso}`,
            isOverdue: false,
          });
        }
      }
    }
  }

  // ── 5. Approved Unreimbursed Employee Expenses (§29 X-05, §33 #3) ────────
  if (worldFilter !== 'personal') {
    const settledExpenseIds = new Set<string>();
    for (const ps of payslipRows || []) {
      const psStatus = String(ps.status || '').toLowerCase().trim();
      if (psStatus === 'voided' || psStatus === 'draft') continue;
      if (Array.isArray(ps.linked_expense_ids)) {
        for (const eid of ps.linked_expense_ids) {
          if (eid) settledExpenseIds.add(String(eid));
        }
      }
    }

    for (const exp of employeeExpenseRows || []) {
      const status = String(exp.status || '').toLowerCase().trim();
      // Only approved claims awaiting actual payout; exclude draft, submitted, rejected, reimbursed
      if (status !== 'approved') continue;
      if (exp.settlement_transaction_id || exp.reimbursed_at) continue;
      if (settledExpenseIds.has(String(exp.id))) continue;

      const rawAmt = Math.abs(Number(exp.amount || 0));
      if (!Number.isFinite(rawAmt) || rawAmt <= 0) continue;

      const origCurr = String(exp.currency || baseCurr).toUpperCase().trim();
      const convAmt = round2(convertCurrency(rawAmt, origCurr, baseCurr));
      const expDateIso = toIsoDateUtc(exp.date);
      if (expDateIso && expDateIso > horizonEndStr) continue;
      const dueIso = expDateIso && expDateIso > todayStr ? expDateIso : todayStr;

      upcomingExpenses.push({
        id: `reimb-${exp.id}`,
        date: formatDisplayDateUtc(dueIso),
        isoDate: dueIso,
        title: String(exp.description || 'Employee Reimbursement').trim() || 'Employee Reimbursement',
        amount: convAmt,
        rawAmount: round2(rawAmt),
        currency: baseCurr,
        originalCurrency: origCurr,
        type: 'debit',
        sourceType: 'reimbursement',
        sourceId: String(exp.id),
        isOverdue: false,
      });
    }
  }

  sortUpcomingItems(upcomingPayments);
  sortUpcomingItems(upcomingExpenses);
  sortUpcomingItems(overduePayments);
  sortUpcomingItems(overdueExpenses);

  const totalUpcomingPayments = round2(upcomingPayments.reduce((s, i) => s + i.amount, 0));
  const totalUpcomingExpenses = round2(upcomingExpenses.reduce((s, i) => s + i.amount, 0));
  const totalOverduePayments = round2(overduePayments.reduce((s, i) => s + i.amount, 0));
  const totalOverdueExpenses = round2(overdueExpenses.reduce((s, i) => s + i.amount, 0));

  return {
    upcomingPayments,
    upcomingExpenses,
    overduePayments,
    overdueExpenses,
    totalUpcomingPayments,
    totalUpcomingExpenses,
    totalOverduePayments,
    totalOverdueExpenses,
    remainingMonthlyPayroll,
    windowStart: todayStr,
    windowEnd: horizonEndStr,
    basis: 'cash_scheduled',
    currency: baseCurr,
    worldScope: worldFilter,
  };
}
