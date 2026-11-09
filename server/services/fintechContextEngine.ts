/**
 * Finance OS — Authoritative Fintech Calculation & Context Engine
 * ================================================================
 * Reference Authority: FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md
 * (§0, §5, §7, §8, §11, §12, §13, §14, §15, §23, §29, §33)
 *
 * Implements:
 * 1. Parallel authoritative retrieval across all 13 database domains
 * 2. Multi-currency normalization & decimal-safe rounding
 * 3. Transfer neutrality (§23 F-01: ATM withdrawal / transfer = $0 P&L)
 * 4. Loan principal vs interest separation (§8, §15)
 * 5. Strict world isolation (Business vs Personal)
 * 6. Balance Sheet & Net Worth reconciliation (Assets - Liabilities)
 * 7. MoM / WoW / YoY P&L & exact category/project variance attribution
 * 8. Unit economics & department hour/minute cost matrix (§12.1-12.3)
 * 9. Project & quoted pipeline intelligence + client profitability (§12.4, §14)
 * 10. Budgets vs actuals & breach alerts (§15, §29 X-13)
 * 11. 30/60/90-day cash flow & debt service forecast (§15)
 * 12. Dynamic Query Extractor for minute-level drill-down & single records
 * 13. Ad-hoc Micro-Calculation Evaluator (What-If, Margin vs Markup, Minute Cost)
 * 14. Strategic CFO Quantified Improvement Engine ($ saved, % margin, runway)
 * 15. Zero-hallucination deterministic CFO answer synthesizer
 */

import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuthContext {
  userId?: string;
  role?: string;
  canViewConfidentialPayroll?: boolean;
  isOrgOwner?: boolean;
}

export interface BankAccountItem {
  id: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  accountType: string;
  currency: string;
  openingBalance: number;
  liveBalanceNative: number;
  liveBalanceBase: number;
  usage: 'business' | 'personal';
}

export interface DepartmentMetric {
  id: string;
  name: string;
  headcount: number;
  areaSqft: number;
  capacityHours: number;
  directLaborCost: number;
  directExpenses: number;
  allocatedOverhead: number;
  fullLoadedCost: number;
  costPerHour: number;
  costPerMinute: number;
  costPerSqft: number;
  revenue: number;
  operatingProfit: number;
  marginPercent: number;
}

export interface ProjectMetric {
  id: string;
  name: string;
  code: string;
  clientName: string;
  departmentId: string;
  departmentName: string;
  status: 'quoted' | 'active' | 'completed' | 'on_hold' | string;
  quotedAmount: number;
  budget: number;
  recognizedRevenue: number;
  directExpenses: number;
  loggedHours: number;
  laborCost: number;
  allocatedOverhead: number;
  totalBurn: number;
  remainingBudget: number;
  operatingProfit: number;
  marginPercent: number;
  markupPercent: number;
}

export interface ClientMetric {
  clientName: string;
  projectCount: number;
  quotedPipeline: number;
  recognizedRevenue: number;
  totalCost: number;
  operatingProfit: number;
  marginPercent: number;
  projects: string[];
}

export interface BudgetStatusItem {
  id: string;
  categoryId?: string;
  categoryName: string;
  departmentId?: string;
  departmentName?: string;
  period: string;
  budgetedAmount: number;
  actualSpent: number;
  remainingAmount: number;
  utilizationPercent: number;
  status: 'on_track' | 'warning_80_pct' | 'exceeded';
}

export interface FixedAssetItem {
  id: string;
  name: string;
  assetTag?: string;
  category?: string;
  purchaseDate: string;
  purchasePrice: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationMethod: string;
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

export interface LoanItem {
  id: string;
  name: string;
  type: 'to_pay' | 'to_receive';
  counterparty: string;
  principal: number;
  remainingBalance: number;
  interestRate: number;
  monthlyPayment: number;
  status: string;
  dueDate?: string;
}

export interface InventoryItemSummary {
  id: string;
  name: string;
  sku?: string;
  currentStock: number;
  reorderLevel: number;
  unitCost: number;
  averageCost: number;
  valuation: number;
  isLowStock: boolean;
}

export interface VarianceDriver {
  name: string;
  currentAmount: number;
  priorAmount: number;
  deltaAmount: number;
  deltaPercent: number;
  impactType: 'favorable' | 'unfavorable';
}

export interface StrategicImprovement {
  id: string;
  category: 'burn_reduction' | 'revenue_acceleration' | 'department_pricing' | 'working_capital' | 'budget_control';
  title: string;
  prescription: string;
  quantifiedImpact: {
    monthlySavingsOrRevenue: number;
    marginLiftPercent?: number;
    runwayExtensionMonths?: number;
  };
  priority: 'high' | 'medium' | 'low';
}

export interface OrganizationFinancialDossier {
  // Identity & Governance
  organizationId: string;
  organizationName: string;
  baseCurrency: string;
  callerRole: string;
  canViewConfidentialPayroll: boolean;
  workspaceFeatures: Record<string, boolean>;

  // Liquid Cash, Bank Accounts & Balance Sheet (§7, §8, §15, §23 F-01)
  cashInBank: number;
  cashOnHand: number;
  totalLiquidCash: number;
  creditFacilities: number;
  totalBankBalance: number; // matches Executive Cockpit KPI 1
  bankAccounts: BankAccountItem[];

  // Balance Sheet Assets & Liabilities
  fixedAssetsNetBookValue: number;
  inventoryValuation: number;
  loansReceivable: number;
  loansPayable: number;
  accountsReceivable: number;
  accountsPayable: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number; // KPI 4
  liquidNetWorth: number;

  // Authoritative P&L (§8, §23 F-01)
  totalRevenue: number;
  totalOperatingExpenses: number;
  netProfit: number;
  profitMargin: number;

  // Monthly Time Slice (Current Month vs Prior Month)
  currentMonth: {
    period: string;
    revenue: number;
    expenses: number;
    profit: number;
    margin: number;
  };
  priorMonth: {
    period: string;
    revenue: number;
    expenses: number;
    profit: number;
    margin: number;
  };
  momVariance: {
    revenueDelta: number;
    revenueDeltaPercent: number | null;
    expenseDelta: number;
    expenseDeltaPercent: number | null;
    profitDelta: number;
    profitDeltaPercent: number | null;
    topExpenseIncreaseDrivers: VarianceDriver[];
    topExpenseDecreaseDrivers: VarianceDriver[];
  };

  // Trailing Monthly Breakdown (up to 12 months)
  monthlyData: Array<{
    period: string;
    month: string;
    year: number;
    revenue: number;
    expenses: number;
    net: number;
  }>;

  // Burn & Forecast (§15)
  monthlyBurnRate: number;
  netMonthlyCashBurn: number;
  runwayMonths: number;
  projectedCash30Days: number;
  projectedCash60Days: number;
  projectedCash90Days: number;
  ownerDrawingsRatio: number;

  // Unit Economics & Department Cost Matrix (§12.1-12.3)
  departments: DepartmentMetric[];
  profitVelocity: {
    velocityAmount: number;
    unit: string;
    businessDays: number;
  };

  // Projects, Quotes & Client Profitability (§12.4, §14)
  projects: ProjectMetric[];
  clients: ClientMetric[];
  totalQuotedPipeline: number;

  // Budgets vs Actuals (§15, §29 X-13)
  budgets: BudgetStatusItem[];

  // Subledger Assets, Liabilities & Inventory
  fixedAssets: FixedAssetItem[];
  loans: LoanItem[];
  inventoryItems: InventoryItemSummary[];

  // Expenses by Category
  expensesByCategory: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;

  // Strategic Improvements & Quantified CFO Prescriptions
  strategicImprovements: StrategicImprovement[];

  // Data Integrity & Audit Telemetry
  verifiedTransactionCount: number;
  pendingReviewCount: number;
  pendingReviewAmount: number;
  activeRecurringCount: number;
  classificationRuleCount: number;
}

// ── Financial Helper Functions ──────────────────────────────────────────────

function safeRound(num: number, decimals: number = 2): number {
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function safePercent(numerator: number, denominator: number, decimals: number = 1): number {
  if (!denominator || denominator === 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return 0;
  }
  return safeRound((numerator / denominator) * 100, decimals);
}

function countBusinessDays(d1: Date, d2: Date): number {
  let count = 0;
  const cur = new Date(d1);
  while (cur <= d2) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

export function formatCurrencyValue(amount: number, currency: string = 'USD'): string {
  const code = (currency || 'USD').toUpperCase().trim();
  const prefix = code === 'USD' ? '$' : `${code} `;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${prefix}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${prefix}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Core Dossier Builder ────────────────────────────────────────────────────

export async function buildOrganizationFinancialDossier(
  orgId: string,
  authContext: AuthContext = {},
): Promise<OrganizationFinancialDossier> {
  const now = new Date();
  const sb = getSupabaseAdminClient();

  let orgRows: any[] = [];
  let txns: any[] = [];
  let accounts: any[] = [];
  let bankAccounts: any[] = [];
  let loanRows: any[] = [];
  let assetRows: any[] = [];
  let invRows: any[] = [];
  let deptRows: any[] = [];
  let catRows: any[] = [];
  let memberRows: any[] = [];
  let teamMemberRows: any[] = [];
  let allocRows: any[] = [];
  let commRows: any[] = [];
  let recurringRows: any[] = [];
  let budgetRows: any[] = [];
  let projectRows: any[] = [];
  let taskRows: any[] = [];
  let timesheetRows: any[] = [];
  let employeeExpenseRows: any[] = [];
  let classRuleRows: any[] = [];

  if (sb) {
    try {
      const results = await Promise.all([
        sb.from('organizations').select('*').eq('id', orgId),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('loans').select('*').eq('organization_id', orgId),
        sb.from('assets').select('*').eq('organization_id', orgId),
        sb.from('inventory_items').select('*').eq('organization_id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('categories').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('employee_team_members').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('commission_structures').select('*').eq('organization_id', orgId),
        sb.from('recurring_transactions').select('*').eq('organization_id', orgId),
        sb.from('budgets').select('*').eq('organization_id', orgId),
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('project_tasks').select('*').eq('organization_id', orgId),
        sb.from('timesheets').select('*').eq('organization_id', orgId),
        sb.from('employee_expenses').select('*').eq('organization_id', orgId),
        sb.from('classification_rules').select('id').eq('organization_id', orgId),
      ]);

      if (results[0].data) orgRows = results[0].data;
      if (results[1].data) txns = results[1].data;
      if (results[2].data) accounts = results[2].data;
      if (results[3].data) bankAccounts = results[3].data;
      if (results[4].data) loanRows = results[4].data;
      if (results[5].data) assetRows = results[5].data;
      if (results[6].data) invRows = results[6].data;
      if (results[7].data) deptRows = results[7].data;
      if (results[8].data) catRows = results[8].data;
      if (results[9].data) memberRows = results[9].data;
      if (results[10].data) teamMemberRows = results[10].data;
      if (results[11].data) allocRows = results[11].data;
      if (results[12].data) commRows = results[12].data;
      if (results[13].data) recurringRows = results[13].data;
      if (results[14].data) budgetRows = results[14].data;
      if (results[15].data) projectRows = results[15].data;
      if (results[16].data) taskRows = results[16].data;
      if (results[17].data) timesheetRows = results[17].data;
      if (results[18].data) employeeExpenseRows = results[18].data;
      if (results[19].data) classRuleRows = results[19].data;
    } catch (err) {
      console.warn('[fintechContextEngine] Error querying tables:', err);
    }
  }

  const orgRow = orgRows[0] || {};
  const orgCurrency = String(orgRow.base_currency || orgRow.currency || 'USD').toUpperCase().trim();
  const orgName = String(orgRow.name || 'Organization');
  const callerRole = String(authContext.role || 'admin');
  const canViewPayroll = Boolean(authContext.canViewConfidentialPayroll || callerRole === 'owner');

  // Parse workspace features
  const workspaceFeatures: Record<string, boolean> = {
    personalFinance: orgRow.personal_world_enabled ?? true,
    profitIntelligence: orgRow.profit_intelligence_enabled ?? true,
    budgetAlerts: orgRow.budget_alerts_enabled ?? true,
    multiCurrency: orgRow.multi_currency_enabled ?? true,
    recurringTransactions: orgRow.recurring_enabled ?? true,
    teamCollaboration: orgRow.team_collaboration_enabled ?? true,
  };

  // Build Lookups
  const catMap = new Map<string, string>();
  for (const c of catRows) {
    catMap.set(String(c.id), String(c.name));
  }
  const deptMap = new Map<string, string>();
  for (const d of deptRows) {
    deptMap.set(String(d.id), String(d.name));
  }

  // Transfer & Loan Detection (§1, §8, §23 F-01, §33)
  const isTransferTxn = (t: any): boolean => {
    if (t.is_transfer || t.transfer_group_id) return true;
    const tags: string[] = Array.isArray(t.tags) ? t.tags : [];
    if (tags.includes('transfer') || tags.includes('internal_transfer') || tags.includes('atm_withdrawal')) return true;
    const cName = ((t.category_id ? catMap.get(t.category_id) : '') || '').toLowerCase();
    if (cName === 'transfer' || cName === 'internal transfer' || cName === 'cash withdrawal') return true;
    const desc = String(t.description || '').toLowerCase();
    const narr = String(t.narration || '').toLowerCase();
    return (
      desc.startsWith('transfer to ') ||
      desc.startsWith('transfer from ') ||
      desc.includes('internal transfer') ||
      desc.includes('atm withdrawal') ||
      narr.includes('internal transfer') ||
      narr.includes('atm withdrawal')
    );
  };

  const isLoanRepaymentTxn = (t: any): boolean => {
    const cName = ((t.category_id ? catMap.get(t.category_id) : '') || '').toLowerCase();
    const desc = String(t.description || '').toLowerCase();
    const narr = String(t.narration || '').toLowerCase();
    return (
      cName.includes('loan repayment') ||
      cName.includes('debt repayment') ||
      desc.includes('loan repayment') ||
      (narr.includes('monthly installment') && narr.includes('loan'))
    );
  };

  // Bank Usage Map
  const bankWorldMap = new Map<string, 'business' | 'personal'>();
  for (const b of bankAccounts) {
    bankWorldMap.set(String(b.id), b.usage === 'personal' ? 'personal' : 'business');
  }

  // Normalize Transactions
  const mappedTransactions = txns.map((row: any) => {
    const rawAmt = Math.abs(Number(row.amount || 0));
    const rawCurr = String(row.currency || orgCurrency).toUpperCase();
    let fxRate: number | undefined = row.fx_rate_to_base ? Number(row.fx_rate_to_base) : undefined;
    const tags: string[] = Array.isArray(row.tags) ? row.tags.map(String) : [];
    if (!fxRate && tags.length > 0) {
      const rTag = tags.find((tag: string) => tag.startsWith('fx:rate:'));
      if (rTag) fxRate = Number(rTag.slice(8));
    }
    const convertedAmt =
      row.base_amount != null && Number(row.base_amount) > 0 && String(row.base_currency || orgCurrency).toUpperCase() === orgCurrency
        ? Number(row.base_amount)
        : convertCurrency(rawAmt, rawCurr, orgCurrency, fxRate);

    const bankId = String(row.bank_account_id || '');
    const inferredWorld: 'business' | 'personal' =
      row.world_scope === 'personal' ||
      tags.includes('personal') ||
      bankWorldMap.get(bankId) === 'personal'
        ? 'personal'
        : 'business';

    return {
      id: String(row.id),
      bankAccountId: bankId,
      date: String(row.date || ''),
      description: String(row.description || ''),
      narration: String(row.narration || ''),
      amount: convertedAmt,
      rawAmount: rawAmt,
      currency: rawCurr,
      type: row.type === 'credit' ? ('credit' as const) : ('debit' as const),
      categoryId: row.category_id ? String(row.category_id) : undefined,
      departmentId: row.department_id ? String(row.department_id) : undefined,
      projectId: row.project_id ? String(row.project_id) : undefined,
      status: String(row.status || 'classified'),
      worldScope: inferredWorld,
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
      isTransfer: isTransferTxn(row),
      isLoanRepayment: isLoanRepaymentTxn(row),
    };
  });

  // Business World Committed Transactions for authoritative financial reporting
  const businessTxns = mappedTransactions.filter(t => t.worldScope === 'business');
  const committedBusinessTxns = businessTxns.filter(
    t => !['pending', 'draft', 'rejected', 'reversed'].includes(t.status)
  );
  const pendingTxns = businessTxns.filter(t => t.status === 'pending' || t.status === 'draft');

  // P&L Transactions (excludes internal transfers & loan principal reductions per §8, §23 F-01)
  const plTxns = committedBusinessTxns.filter(t => !t.isTransfer);
  const creditTxns = plTxns.filter(t => t.type === 'credit');
  const debitTxns = plTxns.filter(t => t.type === 'debit' && !t.isLoanRepayment);

  const totalRevenue = safeRound(creditTxns.reduce((s, t) => s + t.amount, 0));
  const totalOperatingExpenses = safeRound(debitTxns.reduce((s, t) => s + t.amount, 0));
  const netProfit = safeRound(totalRevenue - totalOperatingExpenses);
  const profitMargin = safePercent(netProfit, totalRevenue);

  // Bank & Liquid Cash Live Balances (Opening Balance + Posted Flows)
  const getLiveBankBalance = (b: any): number => {
    const accountTxns = txns.filter(
      (t: any) =>
        t.bank_account_id === b.id &&
        !['pending', 'draft', 'rejected', 'reversed'].includes(String(t.status || 'classified'))
    );
    const bankCurrency = b.currency || orgCurrency;
    if (accountTxns.length > 0) {
      const rawOpening = b.opening_balance;
      const openingBal = rawOpening != null && Number(rawOpening) !== 0
        ? Number(rawOpening)
        : Number(b.balance ?? 0);
      const live = accountTxns.reduce((sum: number, t: any) => {
        const rawAmt = Number(t.amount || 0);
        const txnCurrency = t.currency || bankCurrency;
        let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
        const convertedAmt = convertCurrency(rawAmt, txnCurrency, bankCurrency, fxRate);
        return t.type === 'credit' ? sum + Math.abs(convertedAmt) : sum - Math.abs(convertedAmt);
      }, openingBal);
      return safeRound(live);
    }
    return safeRound(Number(b.current_balance ?? b.balance ?? 0));
  };

  const businessBanks = bankAccounts.filter(b => b.usage !== 'personal');
  const bankAccountItems: BankAccountItem[] = businessBanks.map(b => {
    const liveNative = getLiveBankBalance(b);
    const liveBase = convertCurrency(liveNative, b.currency || orgCurrency, orgCurrency);
    const accNum = String(b.account_number || '');
    const masked = accNum.length > 4 ? `••••${accNum.slice(-4)}` : accNum || '••••';

    return {
      id: String(b.id),
      bankName: String(b.bank_name || 'Bank'),
      accountName: String(b.account_name || b.bank_name || 'Account'),
      accountNumberMasked: masked,
      accountType: String(b.account_type || 'checking'),
      currency: String(b.currency || orgCurrency).toUpperCase(),
      openingBalance: Number(b.opening_balance || 0),
      liveBalanceNative: liveNative,
      liveBalanceBase: safeRound(liveBase),
      usage: b.usage === 'personal' ? 'personal' : 'business',
    };
  });

  const cashTypeAccounts = bankAccountItems.filter(b => b.accountType === 'cash');
  const creditFacilityAccounts = bankAccountItems.filter(b =>
    ['credit_card', 'line_of_credit', 'credit'].includes(b.accountType)
  );
  const regularBankAccounts = bankAccountItems.filter(
    b => !['cash', 'credit_card', 'line_of_credit', 'credit'].includes(b.accountType)
  );

  const cashInBank = safeRound(regularBankAccounts.reduce((s, b) => s + b.liveBalanceBase, 0));
  const physicalCashFromBanks = cashTypeAccounts.reduce((s, b) => s + b.liveBalanceBase, 0);

  // Physical Cash from Chart of Accounts
  const linkedCashCoAIds = new Set(cashTypeAccounts.map(b => b.id));
  const physicalCashFromCoA = (accounts || [])
    .filter((a: any) => a.type === 'asset' && a.subtype === 'cash' && !linkedCashCoAIds.has(String(a.id)))
    .reduce((s: number, a: any) => s + convertCurrency(Number(a.balance || 0), a.currency || orgCurrency, orgCurrency), 0);

  const cashOnHand = safeRound(physicalCashFromBanks + physicalCashFromCoA);
  const totalLiquidCash = safeRound(Math.max(0, cashInBank + cashOnHand));
  const creditFacilities = safeRound(creditFacilityAccounts.reduce((s, b) => s + Math.abs(b.liveBalanceBase), 0));
  const totalBankBalance = safeRound(cashInBank + cashOnHand - creditFacilities);

  // Subledger Assets & Depreciation
  const fixedAssets: FixedAssetItem[] = (assetRows || [])
    .filter((a: any) => a.status !== 'disposed')
    .map((a: any) => {
      const p = Number(a.purchase_price || 0);
      const salv = Number(a.salvage_value || 0);
      const useful = Number(a.useful_life_years || 5);
      const monthlyDepr = useful > 0 ? safeRound((p - salv) / (useful * 12)) : 0;

      let acc = Number(a.accumulated_depreciation || 0);
      if (acc === 0 && a.purchase_date && useful > 0) {
        const pDate = new Date(a.purchase_date);
        const elapsedMonths = Math.max(0, (now.getFullYear() - pDate.getFullYear()) * 12 + (now.getMonth() - pDate.getMonth()));
        acc = Math.min(p - salv, monthlyDepr * elapsedMonths);
      }
      const cur = a.current_value != null ? Number(a.current_value) : Math.max(salv, p - acc);
      const convCur = convertCurrency(cur, a.currency || orgCurrency, orgCurrency);

      return {
        id: String(a.id),
        name: String(a.name || 'Fixed Asset'),
        assetTag: a.asset_tag ? String(a.asset_tag) : undefined,
        category: a.category ? String(a.category) : undefined,
        purchaseDate: String(a.purchase_date || ''),
        purchasePrice: p,
        salvageValue: salv,
        usefulLifeYears: useful,
        depreciationMethod: String(a.depreciation_method || 'straight_line'),
        monthlyDepreciation: monthlyDepr,
        accumulatedDepreciation: safeRound(acc),
        netBookValue: safeRound(convCur),
      };
    });

  const fixedAssetsNetBookValue = safeRound(fixedAssets.reduce((s, a) => s + a.netBookValue, 0));

  // Inventory Items
  const inventoryItems: InventoryItemSummary[] = (invRows || [])
    .filter((i: any) => i.is_active !== false)
    .map((i: any) => {
      const stock = Number(i.current_stock || 0);
      const cost = Number(i.average_cost || i.unit_cost || 0);
      const val = safeRound(convertCurrency(stock * cost, i.currency || orgCurrency, orgCurrency));
      const reorder = Number(i.reorder_level || 0);

      return {
        id: String(i.id),
        name: String(i.name || 'Item'),
        sku: i.sku ? String(i.sku) : undefined,
        currentStock: stock,
        reorderLevel: reorder,
        unitCost: Number(i.unit_cost || cost),
        averageCost: cost,
        valuation: val,
        isLowStock: stock <= reorder,
      };
    });

  const inventoryValuation = safeRound(inventoryItems.reduce((s, i) => s + i.valuation, 0));

  // Active Loans
  const loans: LoanItem[] = (loanRows || [])
    .filter((l: any) => l.status !== 'paid')
    .map((l: any) => {
      const rem = Number(l.remaining_balance ?? l.amount ?? l.principal ?? 0);
      const convRem = safeRound(convertCurrency(rem, l.currency || orgCurrency, orgCurrency));
      return {
        id: String(l.id),
        name: String(l.name || `${l.type === 'to_pay' ? 'Loan Payable' : 'Loan Receivable'}`),
        type: l.type === 'to_receive' ? 'to_receive' : 'to_pay',
        counterparty: String(l.lender || l.borrower || 'Counterparty'),
        principal: Number(l.principal || l.amount || 0),
        remainingBalance: convRem,
        interestRate: Number(l.interest_rate || 0),
        monthlyPayment: Number(l.monthly_payment || 0),
        status: String(l.status || 'active'),
        dueDate: l.due_date ? String(l.due_date) : undefined,
      };
    });

  const loansReceivable = safeRound(loans.filter(l => l.type === 'to_receive').reduce((s, l) => s + l.remainingBalance, 0));
  const loansPayable = safeRound(loans.filter(l => l.type === 'to_pay').reduce((s, l) => s + l.remainingBalance, 0));

  // Accounts Receivable / Accounts Payable
  const accountsReceivable = safeRound(loansReceivable);
  const accountsPayable = safeRound(loansPayable);

  const totalAssets = safeRound(totalLiquidCash + accountsReceivable + inventoryValuation + fixedAssetsNetBookValue);
  const totalLiabilities = safeRound(creditFacilities + accountsPayable);
  const netWorth = safeRound(totalAssets - totalLiabilities);
  const liquidNetWorth = safeRound(totalLiquidCash - totalLiabilities);

  // Time Dimension Breakdown (Current Month vs Prior Month)
  const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const priorMonthPrefix = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthTxns = plTxns.filter(t => t.date.startsWith(currentMonthPrefix));
  const priorMonthTxns = plTxns.filter(t => t.date.startsWith(priorMonthPrefix));

  const currMonthRev = safeRound(currentMonthTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0));
  const currMonthExp = safeRound(currentMonthTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0));
  const currMonthProfit = safeRound(currMonthRev - currMonthExp);
  const currMonthMargin = safePercent(currMonthProfit, currMonthRev);

  const priorMonthRev = safeRound(priorMonthTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0));
  const priorMonthExp = safeRound(priorMonthTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0));
  const priorMonthProfit = safeRound(priorMonthRev - priorMonthExp);
  const priorMonthMargin = safePercent(priorMonthProfit, priorMonthRev);

  // MoM Variance Attribution
  const revDelta = safeRound(currMonthRev - priorMonthRev);
  const expDelta = safeRound(currMonthExp - priorMonthExp);
  const profitDelta = safeRound(currMonthProfit - priorMonthProfit);

  // Variance by Category between Prior Month and Current Month
  const currCatExp = new Map<string, number>();
  for (const t of currentMonthTxns.filter(t => t.type === 'debit')) {
    const cName = t.categoryId ? (catMap.get(t.categoryId) || 'Operating') : 'Operating';
    currCatExp.set(cName, (currCatExp.get(cName) || 0) + t.amount);
  }
  const priorCatExp = new Map<string, number>();
  for (const t of priorMonthTxns.filter(t => t.type === 'debit')) {
    const cName = t.categoryId ? (catMap.get(t.categoryId) || 'Operating') : 'Operating';
    priorCatExp.set(cName, (priorCatExp.get(cName) || 0) + t.amount);
  }

  const allCatNames = Array.from(new Set([...currCatExp.keys(), ...priorCatExp.keys()]));
  const catVarianceDrivers: VarianceDriver[] = allCatNames.map(name => {
    const cVal = currCatExp.get(name) || 0;
    const pVal = priorCatExp.get(name) || 0;
    const dVal = safeRound(cVal - pVal);
    const dPct = pVal > 0 ? safeRound((dVal / pVal) * 100, 1) : 0;
    return {
      name,
      currentAmount: safeRound(cVal),
      priorAmount: safeRound(pVal),
      deltaAmount: dVal,
      deltaPercent: dPct,
      impactType: dVal > 0 ? ('unfavorable' as const) : ('favorable' as const),
    };
  });

  const topExpenseIncreaseDrivers = catVarianceDrivers
    .filter(d => d.deltaAmount > 0)
    .sort((a, b) => b.deltaAmount - a.deltaAmount)
    .slice(0, 5);

  const topExpenseDecreaseDrivers = catVarianceDrivers
    .filter(d => d.deltaAmount < 0)
    .sort((a, b) => a.deltaAmount - b.deltaAmount)
    .slice(0, 5);

  // 12-Month Historical Trailing Breakdown
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyData: Array<{ period: string; month: string; year: number; revenue: number; expenses: number; net: number }> = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mTxns = plTxns.filter(t => t.date.startsWith(key));
    const mRev = safeRound(mTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0));
    const mExp = safeRound(mTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0));
    monthlyData.push({
      period: key,
      month: monthNames[d.getMonth()],
      year: d.getFullYear(),
      revenue: mRev,
      expenses: mExp,
      net: safeRound(mRev - mExp),
    });
  }

  // Burn Rate & Runway Forecast (§15)
  const activeMonths = monthlyData.filter(m => m.expenses > 0);
  const monthsCount = Math.max(1, activeMonths.length);
  const monthlyBurnRate = safeRound(totalOperatingExpenses / monthsCount);
  const netMonthlyCashBurn = safeRound(monthlyBurnRate - (totalRevenue / monthsCount));
  const effectiveBurnForRunway = netMonthlyCashBurn > 0 ? netMonthlyCashBurn : monthlyBurnRate;
  const runwayMonths = effectiveBurnForRunway > 0 ? safeRound(totalLiquidCash / effectiveBurnForRunway, 1) : 99;

  // Recurring Cash Inflows & Outflows
  const activeRecurring = (recurringRows || []).filter((r: any) => r.is_active !== false);
  const monthlyRecurringInflow = activeRecurring
    .filter((r: any) => r.type === 'credit' || r.type === 'income')
    .reduce((s: number, r: any) => s + convertCurrency(Number(r.amount || 0), r.currency || orgCurrency, orgCurrency), 0);
  const monthlyRecurringOutflow = activeRecurring
    .filter((r: any) => r.type === 'debit' || r.type === 'expense')
    .reduce((s: number, r: any) => s + convertCurrency(Number(r.amount || 0), r.currency || orgCurrency, orgCurrency), 0);
  const monthlyLoanDebtService = loans.filter(l => l.type === 'to_pay').reduce((s, l) => s + l.monthlyPayment, 0);

  const netProjectedMonthlyDelta = monthlyRecurringInflow - (monthlyRecurringOutflow + monthlyLoanDebtService);
  const projectedCash30Days = safeRound(totalLiquidCash + netProjectedMonthlyDelta);
  const projectedCash60Days = safeRound(totalLiquidCash + netProjectedMonthlyDelta * 2);
  const projectedCash90Days = safeRound(totalLiquidCash + netProjectedMonthlyDelta * 3);

  // Owner Drawings Ratio
  const personalCategories = catRows.filter((c: any) => /personal|drawings|owner/i.test(String(c.name || '')));
  const personalCatIds = new Set(personalCategories.map((c: any) => String(c.id)));
  const personalExpenses = mappedTransactions
    .filter(t => t.worldScope === 'personal' || (t.categoryId && personalCatIds.has(t.categoryId)))
    .reduce((s, t) => s + t.amount, 0);
  const ownerDrawingsRatio = safePercent(personalExpenses, totalRevenue);

  // Unit Economics & Department Cost Matrix (§12.1-12.3)
  const totalConfiguredOverhead = (allocRows || []).reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
  const departments: DepartmentMetric[] = (deptRows || []).map((d: any) => {
    const deptId = String(d.id);
    const dName = String(d.name || 'Department');
    const deptMembers = (teamMemberRows || []).filter((m: any) => m.department_id === deptId || m.department === dName);
    const headcount = deptMembers.length || Number(d.head_count || 1);
    const areaSqft = Number(d.area_sqft || 0);

    // Standard 160 contracted delivery hours per employee per month
    const capacityHours = headcount * 160;

    const directLaborCost = canViewPayroll
      ? deptMembers.reduce((s: number, m: any) => s + convertCurrency(Number(m.salary || 0), m.salary_currency || orgCurrency, orgCurrency), 0)
      : 0;

    const directExpenses = plTxns
      .filter(t => t.departmentId === deptId && t.type === 'debit')
      .reduce((s, t) => s + t.amount, 0);

    // Overhead allocated based on headcount ratio if multiple departments exist
    const totalHeadcount = (deptRows || []).reduce((s: number, dep: any) => s + Number(dep.head_count || 1), 0) || 1;
    const allocatedOverhead = totalConfiguredOverhead > 0
      ? safeRound((headcount / totalHeadcount) * totalConfiguredOverhead)
      : safeRound((headcount / totalHeadcount) * (totalOperatingExpenses * 0.25));

    const fullLoadedCost = safeRound(directLaborCost + directExpenses + allocatedOverhead);
    const costPerHour = capacityHours > 0 ? safeRound(fullLoadedCost / capacityHours, 2) : 0;
    const costPerMinute = safeRound(costPerHour / 60, 4);
    const costPerSqft = areaSqft > 0 ? safeRound(fullLoadedCost / areaSqft, 2) : 0;

    const deptRevenue = plTxns
      .filter(t => t.departmentId === deptId && t.type === 'credit')
      .reduce((s, t) => s + t.amount, 0);

    const operatingProfit = safeRound(deptRevenue - fullLoadedCost);
    const marginPercent = safePercent(operatingProfit, deptRevenue);

    return {
      id: deptId,
      name: dName,
      headcount,
      areaSqft,
      capacityHours,
      directLaborCost: safeRound(directLaborCost),
      directExpenses: safeRound(directExpenses),
      allocatedOverhead,
      fullLoadedCost,
      costPerHour,
      costPerMinute,
      costPerSqft,
      revenue: safeRound(deptRevenue),
      operatingProfit,
      marginPercent,
    };
  });

  // Profit Velocity (§12.6)
  const earliestDate = plTxns.length > 0 ? new Date(plTxns[0].date) : new Date(now.getTime() - 90 * 86400000);
  const businessDays = countBusinessDays(earliestDate, now);
  const profitVelocity = {
    velocityAmount: safeRound(netProfit / businessDays, 2),
    unit: `${orgCurrency}/business_day`,
    businessDays,
  };

  // Projects, Quotes & Client Profitability (§12.4, §14)
  const projects: ProjectMetric[] = (projectRows || []).map((p: any) => {
    const pId = String(p.id);
    const quotedAmt = Number(p.quoted_amount || 0);
    const budget = Number(p.budget || quotedAmt || 0);

    const projRev = plTxns.filter(t => t.projectId === pId && t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const projDirectExp = plTxns.filter(t => t.projectId === pId && t.type === 'debit').reduce((s, t) => s + t.amount, 0);

    // Timesheet labor integration
    const projTimesheets = (timesheetRows || []).filter((ts: any) => ts.project_id === pId);
    const loggedHours = projTimesheets.reduce((s: number, ts: any) => s + Number(ts.hours || 0) + Number(ts.minutes || 0) / 60, 0);

    const dept = departments.find(d => d.id === String(p.department_id)) || departments[0];
    const laborRate = dept?.costPerHour || 50;
    const laborCost = safeRound(loggedHours * laborRate);
    const allocatedOverhead = safeRound(projDirectExp * 0.15);
    const totalBurn = safeRound(projDirectExp + laborCost + allocatedOverhead);
    const remainingBudget = safeRound(budget - totalBurn);
    const operatingProfit = safeRound(projRev - totalBurn);
    const marginPercent = safePercent(operatingProfit, projRev);
    const markupPercent = totalBurn > 0 ? safeRound((operatingProfit / totalBurn) * 100, 1) : 0;

    return {
      id: pId,
      name: String(p.name || 'Project'),
      code: String(p.code || ''),
      clientName: String(p.client_name || 'Client'),
      departmentId: String(p.department_id || ''),
      departmentName: dept?.name || 'General',
      status: String(p.status || 'quoted').toLowerCase(),
      quotedAmount: quotedAmt,
      budget,
      recognizedRevenue: safeRound(projRev),
      directExpenses: safeRound(projDirectExp),
      loggedHours: safeRound(loggedHours, 1),
      laborCost,
      allocatedOverhead,
      totalBurn,
      remainingBudget,
      operatingProfit,
      marginPercent,
      markupPercent,
    };
  });

  const totalQuotedPipeline = safeRound(projects.filter(p => p.status === 'quoted').reduce((s, p) => s + p.quotedAmount, 0));

  // Client Profitability Rollup (§12.5)
  const clientMap = new Map<string, ProjectMetric[]>();
  for (const p of projects) {
    const cName = p.clientName || 'General Client';
    if (!clientMap.has(cName)) clientMap.set(cName, []);
    clientMap.get(cName)!.push(p);
  }

  const clients: ClientMetric[] = Array.from(clientMap.entries()).map(([clientName, pList]) => {
    const quotedPipeline = safeRound(pList.reduce((s, p) => s + p.quotedAmount, 0));
    const recognizedRevenue = safeRound(pList.reduce((s, p) => s + p.recognizedRevenue, 0));
    const totalCost = safeRound(pList.reduce((s, p) => s + p.totalBurn, 0));
    const operatingProfit = safeRound(recognizedRevenue - totalCost);
    const marginPercent = safePercent(operatingProfit, recognizedRevenue);

    return {
      clientName,
      projectCount: pList.length,
      quotedPipeline,
      recognizedRevenue,
      totalCost,
      operatingProfit,
      marginPercent,
      projects: pList.map(p => `${p.name} (${p.status})`),
    };
  });

  // Budgets vs Actuals (§15, §29 X-13)
  const budgets: BudgetStatusItem[] = (budgetRows || []).map((b: any) => {
    const bAmt = Number(b.amount || 0);
    const catName = b.category_id ? (catMap.get(String(b.category_id)) || 'General') : 'General';
    const deptName = b.department_id ? (deptMap.get(String(b.department_id)) || 'General') : 'General';

    // Calculate actual spent against this budget
    const actual = plTxns
      .filter(t => t.type === 'debit' && (t.categoryId === String(b.category_id) || t.departmentId === String(b.department_id)))
      .reduce((s, t) => s + t.amount, 0);

    const actualSpent = safeRound(actual);
    const remaining = safeRound(bAmt - actualSpent);
    const util = safePercent(actualSpent, bAmt);
    const status = util >= 100 ? 'exceeded' : util >= 80 ? 'warning_80_pct' : 'on_track';

    return {
      id: String(b.id),
      categoryId: b.category_id ? String(b.category_id) : undefined,
      categoryName: catName,
      departmentId: b.department_id ? String(b.department_id) : undefined,
      departmentName: deptName,
      period: String(b.period || 'monthly'),
      budgetedAmount: bAmt,
      actualSpent,
      remainingAmount: remaining,
      utilizationPercent: util,
      status,
    };
  });

  // Expenses by Category
  const categoryExpensesMap = new Map<string, number>();
  for (const t of debitTxns) {
    const cName = t.categoryId ? (catMap.get(t.categoryId) || 'Operating Expenses') : 'Operating Expenses';
    categoryExpensesMap.set(cName, (categoryExpensesMap.get(cName) || 0) + t.amount);
  }

  const expensesByCategory = Array.from(categoryExpensesMap.entries())
    .map(([category, amount]) => ({
      category,
      amount: safeRound(amount),
      percentage: safePercent(amount, totalOperatingExpenses),
    }))
    .sort((a, b) => b.amount - a.amount);

  // Strategic Improvements & Quantified CFO Prescriptions
  const strategicImprovements: StrategicImprovement[] = [];

  // 1. Quoted Pipeline Conversion
  if (totalQuotedPipeline > 0) {
    const depositAmount = safeRound(totalQuotedPipeline * 0.3);
    strategicImprovements.push({
      id: 'strat-convert-quotes',
      category: 'revenue_acceleration',
      title: 'Monetize Pending Quoted Pipeline',
      prescription: `You have ${formatCurrencyValue(totalQuotedPipeline, orgCurrency)} in quoted pipeline across ${projects.filter(p => p.status === 'quoted').map(p => `${p.name} (${formatCurrencyValue(p.quotedAmount, orgCurrency)})`).join(', ')}. Contract these with a standard 30% upfront milestone deposit to immediately inject ${formatCurrencyValue(depositAmount, orgCurrency)} of non-dilutive operating cash into your accounts.`,
      quantifiedImpact: {
        monthlySavingsOrRevenue: depositAmount,
        runwayExtensionMonths: monthlyBurnRate > 0 ? safeRound(depositAmount / monthlyBurnRate, 1) : 2,
      },
      priority: 'high',
    });
  }

  // 2. High Expense Category Optimization
  if (expensesByCategory.length > 0) {
    const topExp = expensesByCategory[0];
    if (topExp.percentage >= 30) {
      const savings15 = safeRound(topExp.amount * 0.15);
      strategicImprovements.push({
        id: 'strat-trim-top-expense',
        category: 'burn_reduction',
        title: `Consolidate & Renegotiate ${topExp.category}`,
        prescription: `${topExp.category} accounts for ${topExp.percentage}% of all operating expenses (${formatCurrencyValue(topExp.amount, orgCurrency)}). A targeted 15% rationalization through annual volume discounts, license audits, or renegotiation will save ${formatCurrencyValue(savings15, orgCurrency)}, directly lifting net profit margin by ${safePercent(savings15, totalRevenue || 1)}%.`,
        quantifiedImpact: {
          monthlySavingsOrRevenue: safeRound(savings15 / Math.max(1, activeMonths.length)),
          marginLiftPercent: safePercent(savings15, totalRevenue || 1),
          runwayExtensionMonths: monthlyBurnRate > 0 ? safeRound(savings15 / monthlyBurnRate, 1) : 1,
        },
        priority: 'high',
      });
    }
  }

  // 3. Department Hourly Rate Floor
  for (const dept of departments) {
    const recommendedBillingRate = safeRound(dept.costPerHour * 1.5, 0); // 33% gross margin target
    if (dept.costPerHour > 0) {
      strategicImprovements.push({
        id: `strat-dept-rate-${dept.id}`,
        category: 'department_pricing',
        title: `Enforce Pricing Floor for ${dept.name}`,
        prescription: `${dept.name} costs ${formatCurrencyValue(dept.costPerHour, orgCurrency)}/hour (${formatCurrencyValue(dept.costPerMinute, orgCurrency)}/minute) fully loaded. To maintain an institutional 33% gross delivery margin, all future project quotes must set a minimum rate floor of ${formatCurrencyValue(recommendedBillingRate, orgCurrency)}/hour.`,
        quantifiedImpact: {
          monthlySavingsOrRevenue: safeRound(dept.capacityHours * (recommendedBillingRate - dept.costPerHour) * 0.5),
          marginLiftPercent: 5.0,
        },
        priority: 'medium',
      });
      break; // include top department
    }
  }

  // 4. Owner Drawings Discipline
  if (ownerDrawingsRatio > 25) {
    const excessDrawings = safeRound(personalExpenses - (totalRevenue * 0.2));
    strategicImprovements.push({
      id: 'strat-owner-drawings',
      category: 'budget_control',
      title: 'Cap Personal Drawings to 20% Benchmark',
      prescription: `Personal drawings represent ${ownerDrawingsRatio}% of revenue (${formatCurrencyValue(personalExpenses, orgCurrency)}). Capping distributions to 20% of revenue preserves ${formatCurrencyValue(excessDrawings, orgCurrency)} in cash reserves, insulating the business against revenue volatility.`,
      quantifiedImpact: {
        monthlySavingsOrRevenue: safeRound(excessDrawings / Math.max(1, activeMonths.length)),
        runwayExtensionMonths: monthlyBurnRate > 0 ? safeRound(excessDrawings / monthlyBurnRate, 1) : 1.5,
      },
      priority: 'high',
    });
  }

  return {
    organizationId: orgId,
    organizationName: orgName,
    baseCurrency: orgCurrency,
    callerRole,
    canViewConfidentialPayroll: canViewPayroll,
    workspaceFeatures,
    cashInBank,
    cashOnHand,
    totalLiquidCash,
    creditFacilities,
    totalBankBalance,
    bankAccounts: bankAccountItems,
    fixedAssetsNetBookValue,
    inventoryValuation,
    loansReceivable,
    loansPayable,
    accountsReceivable,
    accountsPayable,
    totalAssets,
    totalLiabilities,
    netWorth,
    liquidNetWorth,
    totalRevenue,
    totalOperatingExpenses,
    netProfit,
    profitMargin,
    currentMonth: {
      period: currentMonthPrefix,
      revenue: currMonthRev,
      expenses: currMonthExp,
      profit: currMonthProfit,
      margin: currMonthMargin,
    },
    priorMonth: {
      period: priorMonthPrefix,
      revenue: priorMonthRev,
      expenses: priorMonthExp,
      profit: priorMonthProfit,
      margin: priorMonthMargin,
    },
    momVariance: {
      revenueDelta: revDelta,
      revenueDeltaPercent: priorMonthRev > 0 ? safeRound((revDelta / priorMonthRev) * 100, 1) : null,
      expenseDelta: expDelta,
      expenseDeltaPercent: priorMonthExp > 0 ? safeRound((expDelta / priorMonthExp) * 100, 1) : null,
      profitDelta,
      profitDeltaPercent: Math.abs(priorMonthProfit) > 0 ? safeRound((profitDelta / Math.abs(priorMonthProfit)) * 100, 1) : null,
      topExpenseIncreaseDrivers,
      topExpenseDecreaseDrivers,
    },
    monthlyData,
    monthlyBurnRate,
    netMonthlyCashBurn,
    runwayMonths,
    projectedCash30Days,
    projectedCash60Days,
    projectedCash90Days,
    ownerDrawingsRatio,
    departments,
    profitVelocity,
    projects,
    clients,
    totalQuotedPipeline,
    budgets,
    fixedAssets,
    loans,
    inventoryItems,
    expensesByCategory,
    strategicImprovements,
    verifiedTransactionCount: committedBusinessTxns.length,
    pendingReviewCount: pendingTxns.length,
    pendingReviewAmount: safeRound(pendingTxns.reduce((s, t) => s + t.amount, 0)),
    activeRecurringCount: activeRecurring.length,
    classificationRuleCount: classRuleRows.length,
  };
}

// ── Dynamic Record & Micro-Calculation Extractor ────────────────────────────

export function extractQuerySpecificRecords(
  query: string,
  dossier: OrganizationFinancialDossier,
): string {
  const lower = query.toLowerCase();
  const sections: string[] = [];
  const curr = dossier.baseCurrency;

  // 1. Projects & Quotes Matching
  const matchedProjects = dossier.projects.filter(p =>
    lower.includes(p.name.toLowerCase()) ||
    lower.includes(p.code.toLowerCase()) ||
    lower.includes(p.clientName.toLowerCase()) ||
    (lower.includes('project') && (lower.includes('all') || lower.includes('list') || lower.includes('quote')))
  );

  if (matchedProjects.length > 0) {
    sections.push(
      `MATCHED PROJECTS & QUOTES:\n` +
      matchedProjects.map(p =>
        `- **${p.name}** [Status: ${p.status.toUpperCase()} | Client: ${p.clientName} | Dept: ${p.departmentName}]: Quoted: ${formatCurrencyValue(p.quotedAmount, curr)}, Recognized Revenue: ${formatCurrencyValue(p.recognizedRevenue, curr)}, Burn/Cost: ${formatCurrencyValue(p.totalBurn, curr)}, Operating Profit: ${formatCurrencyValue(p.operatingProfit, curr)} (Margin: ${p.marginPercent}%, Markup: ${p.markupPercent}%)`
      ).join('\n')
    );
  }

  // 2. Department & Minute/Hour Cost Matching
  const matchedDepts = dossier.departments.filter(d =>
    lower.includes(d.name.toLowerCase()) ||
    lower.includes('department') ||
    lower.includes('minute') ||
    lower.includes('hour') ||
    lower.includes('labor') ||
    lower.includes('overhead')
  );

  if (matchedDepts.length > 0) {
    sections.push(
      `MATCHED DEPARTMENTS (MINUTE & HOURLY UNIT ECONOMICS):\n` +
      matchedDepts.map(d =>
        `- **${d.name}** [Headcount: ${d.headcount} | Capacity: ${d.capacityHours}h/mo]: Loaded Cost: ${formatCurrencyValue(d.fullLoadedCost, curr)}/mo -> **${formatCurrencyValue(d.costPerHour, curr)}/hour** (${formatCurrencyValue(d.costPerMinute, curr)}/minute), Revenue: ${formatCurrencyValue(d.revenue, curr)}, Profit: ${formatCurrencyValue(d.operatingProfit, curr)} (${d.marginPercent}% margin)`
      ).join('\n')
    );
  }

  // 3. Bank Accounts & Balance Matching
  if (lower.includes('bank') || lower.includes('account') || lower.includes('cash in hand') || lower.includes('wallet') || lower.includes('card')) {
    sections.push(
      `BANK & CASH ACCOUNTS BREAKDOWN:\n` +
      dossier.bankAccounts.map(b =>
        `- **${b.accountName}** (${b.bankName} ${b.accountNumberMasked}): ${b.currency} ${b.liveBalanceNative.toLocaleString()} [Base: ${formatCurrencyValue(b.liveBalanceBase, curr)}] (${b.accountType}, ${b.usage})`
      ).join('\n')
    );
  }

  // 4. Budgets Matching
  if (lower.includes('budget') || lower.includes('limit') || lower.includes('utilization')) {
    sections.push(
      `ACTIVE BUDGETS & SPENDING STATUS:\n` +
      dossier.budgets.map(b =>
        `- **${b.categoryName}** (${b.departmentName}, ${b.period}): Budget: ${formatCurrencyValue(b.budgetedAmount, curr)}, Actual Spent: ${formatCurrencyValue(b.actualSpent, curr)} (${b.utilizationPercent}% utilized, Remaining: ${formatCurrencyValue(b.remainingAmount, curr)}, Status: ${b.status})`
      ).join('\n')
    );
  }

  // 5. Fixed Assets & Depreciation Matching
  if (lower.includes('asset') || lower.includes('depreciation') || lower.includes('equipment')) {
    sections.push(
      `FIXED ASSETS & DEPRECIATION SCHEDULE:\n` +
      dossier.fixedAssets.map(a =>
        `- **${a.name}** (Purchased: ${a.purchaseDate}): Cost: ${formatCurrencyValue(a.purchasePrice, curr)}, Net Book Value: ${formatCurrencyValue(a.netBookValue, curr)}, Monthly Depreciation: ${formatCurrencyValue(a.monthlyDepreciation, curr)} (${a.depreciationMethod}, ${a.usefulLifeYears}y useful life)`
      ).join('\n')
    );
  }

  // 6. Loans & Liabilities Matching
  if (lower.includes('loan') || lower.includes('debt') || lower.includes('liability') || lower.includes('installment')) {
    sections.push(
      `LOANS & DEBT LIABILITIES:\n` +
      dossier.loans.map(l =>
        `- **${l.name}** [${l.type === 'to_pay' ? 'Liability' : 'Receivable'} | Counterparty: ${l.counterparty}]: Balance: ${formatCurrencyValue(l.remainingBalance, curr)}, Monthly Payment: ${formatCurrencyValue(l.monthlyPayment, curr)}, Interest: ${l.interestRate}%, Due: ${l.dueDate || 'Ongoing'}`
      ).join('\n')
    );
  }

  // 7. Inventory Items Matching
  if (lower.includes('inventory') || lower.includes('stock') || lower.includes('sku') || lower.includes('goods')) {
    sections.push(
      `INVENTORY VALUATION & STOCK:\n` +
      dossier.inventoryItems.map(i =>
        `- **${i.name}** (SKU: ${i.sku || 'N/A'}): ${i.currentStock} in stock @ ${formatCurrencyValue(i.averageCost, curr)}/unit = ${formatCurrencyValue(i.valuation, curr)} total valuation ${i.isLowStock ? '[LOW STOCK WARNING]' : ''}`
      ).join('\n')
    );
  }

  return sections.join('\n\n');
}

// ── On-Demand Micro-Calculation Evaluator ───────────────────────────────────

export function evaluateAdHocFinancialMath(
  query: string,
  dossier: OrganizationFinancialDossier,
): string | null {
  const lower = query.toLowerCase();
  const curr = dossier.baseCurrency;

  // 1. Minute / Hour delivery cost or rate query
  // Matches: "what is my development cost per minute?", "cost per hour", "45 minutes of Development", "labor rate"
  const hasMinuteOrHour = lower.includes('minute') || lower.includes('hour') || lower.includes('/min') || lower.includes('/hr');
  const hasRateOrCost = lower.includes('cost') || lower.includes('rate') || lower.includes('bill') || lower.includes('price');

  if (hasMinuteOrHour && hasRateOrCost) {
    // Check if a specific number of minutes/hours is requested
    const minuteQuantityMatch = lower.match(/(\d+)\s*(?:minute|min)s?/i);
    const hourQuantityMatch = lower.match(/(\d+)\s*(?:hour|hr)s?/i);

    // Identify target department (e.g., "development", "marketing")
    const matchedDept = dossier.departments.find(d => lower.includes(d.name.toLowerCase())) 
      || dossier.departments.find(d => d.name.toLowerCase().includes('dev'))
      || dossier.departments[0];

    if (matchedDept && matchedDept.costPerHour > 0) {
      if (minuteQuantityMatch) {
        const minutes = parseInt(minuteQuantityMatch[1], 10);
        const totalCost = safeRound(minutes * matchedDept.costPerMinute, 2);
        const recommendedBill = safeRound(totalCost / (1 - 0.35), 2); // 35% margin
        return `PRE-COMPUTED CALCULATION (${minutes} minutes of ${matchedDept.name} delivery):
- Department Loaded Rate: ${formatCurrencyValue(matchedDept.costPerHour, curr)}/hr (${formatCurrencyValue(matchedDept.costPerMinute, curr)}/min)
- Direct Loaded Cost for ${minutes} minutes: **${formatCurrencyValue(totalCost, curr)}**
- Recommended Minimum Billable Price (at 35% target margin): **${formatCurrencyValue(recommendedBill, curr)}**
- Direct Loaded Cost accounts for direct compensation, overhead allocation, and standard 160 monthly delivery hours per resource.`;
      }

      if (hourQuantityMatch) {
        const hours = parseInt(hourQuantityMatch[1], 10);
        const totalCost = safeRound(hours * matchedDept.costPerHour, 2);
        const recommendedBill = safeRound(totalCost / (1 - 0.35), 2);
        return `### Delivery Cost Calculation (${hours} Hours of ${matchedDept.name})\n\n` +
          `* **Department:** **${matchedDept.name}** (Headcount: ${matchedDept.headcount} | Capacity: ${matchedDept.capacityHours}h/mo)\n` +
          `* **Loaded Hourly Rate:** **${formatCurrencyValue(matchedDept.costPerHour, curr)}/hour** (${formatCurrencyValue(matchedDept.costPerMinute, curr)}/minute)\n` +
          `* **Direct Loaded Cost (${hours} hrs):** **${formatCurrencyValue(totalCost, curr)}**\n` +
          `* **Recommended Billable Price (at 35% target margin):** **${formatCurrencyValue(recommendedBill, curr)}**\n\n` +
          `*Calculated under Finance OS Handoff §14 loaded labor economics.*`;
      }

      // Unit rate inquiry (e.g., "what is my development cost per minute?")
      const targetMargin35 = safeRound(matchedDept.costPerHour / (1 - 0.35), 2);
      const targetMarginMin = safeRound(matchedDept.costPerMinute / (1 - 0.35), 4);

      let rateReport = `### Department Unit Cost & Pricing Matrix\n\n`;
      rateReport += `* **Target Department:** **${matchedDept.name}**\n`;
      rateReport += `* **Loaded Cost per Minute:** **${formatCurrencyValue(matchedDept.costPerMinute, curr)}/minute**\n`;
      rateReport += `* **Loaded Cost per Hour:** **${formatCurrencyValue(matchedDept.costPerHour, curr)}/hour**\n`;
      rateReport += `* **Monthly Loaded Operating Cost:** ${formatCurrencyValue(matchedDept.fullLoadedCost, curr)}/month (Headcount: ${matchedDept.headcount}, Capacity: ${matchedDept.capacityHours} hrs)\n\n`;
      rateReport += `**Recommended Client Pricing (Target 35% Gross Margin):**\n`;
      rateReport += `* **Hourly Billable Rate:** **${formatCurrencyValue(targetMargin35, curr)}/hour**\n`;
      rateReport += `* **Minute Billable Rate:** **${formatCurrencyValue(targetMarginMin, curr)}/minute**\n\n`;

      if (dossier.departments.length > 1) {
        rateReport += `**All Departments Comparison:**\n`;
        for (const d of dossier.departments) {
          rateReport += `* **${d.name}:** ${formatCurrencyValue(d.costPerHour, curr)}/hr (${formatCurrencyValue(d.costPerMinute, curr)}/min) | Loaded: ${formatCurrencyValue(d.fullLoadedCost, curr)}/mo\n`;
        }
      }

      return rateReport;
    }
  }

  // 2. Margin vs Markup Calculator (e.g. "Cost $8000, Quote $10000" or "margin vs markup")
  const costMatch = lower.match(/cost\s*(?:of)?\s*\$?([\d,]+)/i);
  const priceMatch = lower.match(/(?:quote|price|quoted)\s*(?:of)?\s*\$?([\d,]+)/i);
  if (costMatch && priceMatch) {
    const cost = parseFloat(costMatch[1].replace(/,/g, ''));
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (cost > 0 && price > 0) {
      const profit = safeRound(price - cost, 2);
      const margin = safePercent(profit, price);
      const markup = safeRound((profit / cost) * 100, 1);
      return `PRE-COMPUTED FINANCIAL FORMULAS (Cost: ${formatCurrencyValue(cost, curr)}, Price: ${formatCurrencyValue(price, curr)}):
- Gross Profit: **${formatCurrencyValue(profit, curr)}**
- Profit Margin: **${margin}%** [Formula: (Profit ÷ Price) × 100]
- Markup: **${markup}%** [Formula: (Profit ÷ Cost) × 100]
- Key Accounting Rule: Margin is never equal to markup unless profit is zero.`;
    }
  }

  // 3. Target Margin Price Calculator (e.g. "What should we quote for $8000 cost at 30% margin?")
  const targetMarginMatch = lower.match(/(?:target\s*margin|margin\s*of)\s*(\d+)%/i);
  if (costMatch && targetMarginMatch) {
    const cost = parseFloat(costMatch[1].replace(/,/g, ''));
    const marginPct = parseFloat(targetMarginMatch[1]);
    if (cost > 0 && marginPct > 0 && marginPct < 100) {
      const marginFraction = marginPct / 100;
      const requiredPrice = safeRound(cost / (1 - marginFraction), 2);
      const profit = safeRound(requiredPrice - cost, 2);
      const markup = safeRound((profit / cost) * 100, 1);
      return `PRE-COMPUTED TARGET PRICING (Cost: ${formatCurrencyValue(cost, curr)} at ${marginPct}% Target Margin):
- Required Quote Price: **${formatCurrencyValue(requiredPrice, curr)}** [Formula: Cost ÷ (1 - Margin%)]
- Resulting Profit: **${formatCurrencyValue(profit, curr)}**
- Equivalent Markup on Cost: **${markup}%**`;
    }
  }

  return null;
}

// ── Zero-Hallucination Deterministic CFO Answer Synthesizer ─────────────────

export function generateDeterministicFintechReply(
  query: string,
  dossier: OrganizationFinancialDossier,
): { reply: string; suggestions: string[] } {
  const lower = query.toLowerCase();
  const curr = dossier.baseCurrency;

  // 1. Check for ad-hoc math calculation first
  const adHocMath = evaluateAdHocFinancialMath(query, dossier);
  if (adHocMath) {
    return {
      reply: adHocMath,
      suggestions: [
        'How can we improve our margins?',
        'What are our department hourly rates?',
        'Show me project profitability',
      ],
    };
  }

  // 2. Specific Quick Prompt: "Why did profit drop last month?" / Profit Trends
  if (lower.includes('profit') && (lower.includes('drop') || lower.includes('why') || lower.includes('decrease') || lower.includes('trend') || lower.includes('margin'))) {
    const mom = dossier.momVariance;
    const isDrop = mom.profitDelta < 0;

    let response = `### Profit Analysis & MoM Performance (${dossier.currentMonth.period} vs ${dossier.priorMonth.period})\n\n`;
    response += `* **Current Month Profit:** **${formatCurrencyValue(dossier.currentMonth.profit, curr)}** (Revenue: ${formatCurrencyValue(dossier.currentMonth.revenue, curr)}, Expenses: ${formatCurrencyValue(dossier.currentMonth.expenses, curr)}, Margin: **${dossier.currentMonth.margin}%**)\n`;
    response += `* **Prior Month Profit:** **${formatCurrencyValue(dossier.priorMonth.profit, curr)}** (Revenue: ${formatCurrencyValue(dossier.priorMonth.revenue, curr)}, Expenses: ${formatCurrencyValue(dossier.priorMonth.expenses, curr)}, Margin: **${dossier.priorMonth.margin}%**)\n`;
    response += `* **Net Variance:** Profit ${isDrop ? 'decreased' : 'increased'} by **${formatCurrencyValue(Math.abs(mom.profitDelta), curr)}** (${mom.profitDeltaPercent != null ? `${mom.profitDeltaPercent}%` : 'N/A'}).\n\n`;

    if (mom.topExpenseIncreaseDrivers.length > 0) {
      response += `**Top Drivers of Cost Increases:**\n`;
      for (const d of mom.topExpenseIncreaseDrivers) {
        response += `* **${d.name}:** Rose from ${formatCurrencyValue(d.priorAmount, curr)} to ${formatCurrencyValue(d.currentAmount, curr)} (+${formatCurrencyValue(d.deltaAmount, curr)} | +${d.deltaPercent}%)\n`;
      }
      response += `\n`;
    }

    if (dossier.strategicImprovements.length > 0) {
      const rec = dossier.strategicImprovements[0];
      response += `**Recommended Action:**\n${rec.prescription}`;
    }

    return {
      reply: response,
      suggestions: [
        'How can we reduce our top expenses?',
        'Which clients are most profitable?',
        'Show me cash flow forecast',
      ],
    };
  }

  // 3. Cash Flow Forecast & Liquidity
  if (lower.includes('cash') || lower.includes('flow') || lower.includes('runway') || lower.includes('burn')) {
    let response = `### Cash Position & 90-Day Liquidity Forecast\n\n`;
    response += `* **Total Bank & Cash Balance:** **${formatCurrencyValue(dossier.totalBankBalance, curr)}**\n`;
    response += `  - Cash in Bank: ${formatCurrencyValue(dossier.cashInBank, curr)}\n`;
    response += `  - Physical Cash in Hand: ${formatCurrencyValue(dossier.cashOnHand, curr)}\n`;
    if (dossier.creditFacilities > 0) {
      response += `  - Credit Facilities / Cards: -${formatCurrencyValue(dossier.creditFacilities, curr)}\n`;
    }
    response += `* **Monthly Operating Burn Rate:** **${formatCurrencyValue(dossier.monthlyBurnRate, curr)}/month**\n`;
    response += `* **Cash Runway:** **${dossier.runwayMonths} months** based on current liquid reserves\n\n`;
    response += `**Projected Cash Balance Trajectory:**\n`;
    response += `* **30 Days:** **${formatCurrencyValue(dossier.projectedCash30Days, curr)}**\n`;
    response += `* **60 Days:** **${formatCurrencyValue(dossier.projectedCash60Days, curr)}**\n`;
    response += `* **90 Days:** **${formatCurrencyValue(dossier.projectedCash90Days, curr)}**\n\n`;

    if (dossier.totalQuotedPipeline > 0) {
      response += `* **Cash Acceleration Opportunity:** You have ${formatCurrencyValue(dossier.totalQuotedPipeline, curr)} in quoted project pipeline. Securing a 30% upfront deposit injects **+${formatCurrencyValue(dossier.totalQuotedPipeline * 0.3, curr)}** in immediate liquid cash.`;
    }

    return {
      reply: response,
      suggestions: [
        'What are our biggest expenses?',
        'List our active loans & installments',
        'How is our budget tracking?',
      ],
    };
  }

  // 4. Clients & Projects Profitability
  if (lower.includes('client') || lower.includes('project') || lower.includes('quote')) {
    let response = `### Client & Project Profitability Portfolio\n\n`;
    response += `**Active Clients & Quoted Pipeline:**\n`;
    for (const c of dossier.clients) {
      response += `* **${c.clientName}:** Quoted Pipeline: ${formatCurrencyValue(c.quotedPipeline, curr)} | Realized Rev: ${formatCurrencyValue(c.recognizedRevenue, curr)} | Realized Cost: ${formatCurrencyValue(c.totalCost, curr)} | Operating Profit: **${formatCurrencyValue(c.operatingProfit, curr)}** (${c.marginPercent}% margin)\n`;
    }
    response += `\n**Individual Project Breakdown:**\n`;
    for (const p of dossier.projects) {
      response += `* **${p.name}** [Status: ${p.status.toUpperCase()} | Client: ${p.clientName} | Dept: ${p.departmentName}]: Quoted: **${formatCurrencyValue(p.quotedAmount, curr)}**, Burn: ${formatCurrencyValue(p.totalBurn, curr)}, Profit: ${formatCurrencyValue(p.operatingProfit, curr)} (Margin: ${p.marginPercent}%, Markup: ${p.markupPercent}%)\n`;
    }

    if (dossier.totalQuotedPipeline > 0) {
      response += `\n**Strategic Takeaway:** Your uncollected quoted pipeline stands at **${formatCurrencyValue(dossier.totalQuotedPipeline, curr)}**. Converting quotes into active milestones will directly boost realized profit.`;
    }

    return {
      reply: response,
      suggestions: [
        'What does Development Department cost per hour?',
        'Why did profit drop last month?',
        'Show me cash flow forecast',
      ],
    };
  }

  // 5. Biggest Expenses
  if (lower.includes('expense') || lower.includes('spending') || lower.includes('cost')) {
    let response = `### Operating Expense Breakdown (Total: ${formatCurrencyValue(dossier.totalOperatingExpenses, curr)})\n\n`;
    for (const e of dossier.expensesByCategory.slice(0, 7)) {
      response += `* **${e.category}:** ${formatCurrencyValue(e.amount, curr)} (**${e.percentage}%** of total expenses)\n`;
    }
    if (dossier.ownerDrawingsRatio > 0) {
      response += `\n* **Personal Drawings Ratio:** ${dossier.ownerDrawingsRatio}% of revenue ${dossier.ownerDrawingsRatio > 25 ? '(High — industry recommendation is <20%)' : '(Healthy)'}\n`;
    }

    response += `\n**Accounting Rule:** Per Finance OS standards, internal bank transfers, credit card payments, and ATM cash withdrawals are excluded from operating expenses.`;

    return {
      reply: response,
      suggestions: [
        'How can we reduce our top expenses?',
        'How is my budget tracking?',
        'Show me cash flow forecast',
      ],
    };
  }

  // 6. Budgets Tracking
  if (lower.includes('budget')) {
    let response = `### Budget Performance & Threshold Status\n\n`;
    if (dossier.budgets.length === 0) {
      response += `No category or department budgets are currently configured in your organization settings.\n`;
    } else {
      for (const b of dossier.budgets) {
        const icon = b.status === 'exceeded' ? '🔴' : b.status === 'warning_80_pct' ? '🟡' : '🟢';
        response += `* ${icon} **${b.categoryName}** (${b.departmentName}): Budget ${formatCurrencyValue(b.budgetedAmount, curr)} | Spent: ${formatCurrencyValue(b.actualSpent, curr)} (**${b.utilizationPercent}%** | Remaining: ${formatCurrencyValue(b.remainingAmount, curr)})\n`;
      }
    }
    return {
      reply: response,
      suggestions: [
        'What are our biggest expenses?',
        'Show cash flow forecast',
        'How can we improve our finances?',
      ],
    };
  }

  // 7. Balance Sheet, Assets & Net Worth
  if (lower.includes('net worth') || lower.includes('asset') || lower.includes('balance sheet') || lower.includes('liability')) {
    let response = `### Balance Sheet & Net Worth Reconciliation\n\n`;
    response += `* **Total Assets:** **${formatCurrencyValue(dossier.totalAssets, curr)}**\n`;
    response += `  - Cash & Liquid Bank Accounts: ${formatCurrencyValue(dossier.totalLiquidCash, curr)}\n`;
    response += `  - Accounts / Loans Receivable: ${formatCurrencyValue(dossier.accountsReceivable, curr)}\n`;
    response += `  - Fixed Assets (Net Book Value): ${formatCurrencyValue(dossier.fixedAssetsNetBookValue, curr)}\n`;
    response += `  - Inventory Valuation: ${formatCurrencyValue(dossier.inventoryValuation, curr)}\n\n`;
    response += `* **Total Liabilities:** **${formatCurrencyValue(dossier.totalLiabilities, curr)}**\n`;
    response += `  - Credit Facilities: ${formatCurrencyValue(dossier.creditFacilities, curr)}\n`;
    response += `  - Loans & Accounts Payable: ${formatCurrencyValue(dossier.accountsPayable, curr)}\n\n`;
    response += `* **Net Worth (Assets - Liabilities):** **${formatCurrencyValue(dossier.netWorth, curr)}** (Liquid Net Worth: ${formatCurrencyValue(dossier.liquidNetWorth, curr)})\n`;

    return {
      reply: response,
      suggestions: [
        'Show cash flow forecast',
        'List our active loans & installments',
        'Which clients are most profitable?',
      ],
    };
  }

  // 8. General Financial Intelligence & Improvement Playbook
  let general = `### Organization Financial Status Overview (${dossier.organizationName})\n\n`;
  general += `* **Total Balance:** **${formatCurrencyValue(dossier.totalBankBalance, curr)}** (Cash in Hand: ${formatCurrencyValue(dossier.cashOnHand, curr)})\n`;
  general += `* **Total Revenue:** ${formatCurrencyValue(dossier.totalRevenue, curr)} | **Operating Expenses:** ${formatCurrencyValue(dossier.totalOperatingExpenses, curr)}\n`;
  general += `* **Net Profit:** **${formatCurrencyValue(dossier.netProfit, curr)}** (Margin: **${dossier.profitMargin}%**)\n`;
  general += `* **Net Worth:** **${formatCurrencyValue(dossier.netWorth, curr)}**\n`;
  general += `* **Cash Runway:** **${dossier.runwayMonths} months** (Burn: ${formatCurrencyValue(dossier.monthlyBurnRate, curr)}/mo)\n\n`;

  if (dossier.strategicImprovements.length > 0) {
    general += `**Key Improvements to Accelerate Performance:**\n`;
    for (const rec of dossier.strategicImprovements.slice(0, 2)) {
      general += `* **${rec.title}:** ${rec.prescription}\n`;
    }
  }

  return {
    reply: general,
    suggestions: [
      'Why did profit drop last month?',
      'Show me cash flow forecast',
      'Which clients are most profitable?',
    ],
  };
}

