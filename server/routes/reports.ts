import { Router, type Request, type Response } from 'express';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';
import { computeOrgProjectsProfitability } from '../services/projectScheduleCostEngine.js';

import { canViewConfidentialPayroll, requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import {
  computeBalanceSheetSnapshot,
  buildInventoryLayerMap,
  computeFifoAwareInventoryValue,
  computeCashFlowSnapshot,
  computeProfitLossSnapshot,
  computeUpcomingObligations,
  filterAccessibleBanks,
  isActiveOrgMember,
  isLoanRepaymentTxn as isLoanRepaymentShared,
  isTransferTxn as isTransferShared,
  mapAndFilterWorldTransactions,
  NON_POSTED_STATUSES,
  type WorldFilter,
} from '../services/financialTruthService.js';

function getOrgId(req: Request): string {
  return req.orgMembership?.organizationId ?? (Array.isArray(req.params.organizationId) ? String(req.params.organizationId[0]) : String(req.params.organizationId ?? ''));
}

export function createReportsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/dashboard', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const rawWorld = String(req.query.world || 'business').toLowerCase();
    const worldFilter: 'business' | 'personal' | 'all' =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const includePayrollConfidential = canViewConfidentialPayroll(req);
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    const [
      { data: orgRows },
      { data: txns, error: txnError },
      { data: accounts, error: accError },
      { data: bankAccounts },
      { data: loanRows },
      { data: loanPaymentRows },
      { data: assetRows },
      { data: invRows },
      { data: deptRows },
      { data: catRows },
      { data: memberRows },
      { data: allocRows },
      { data: recurringRows },
      { data: recurringOccurrenceRows },
      { data: budgetRows },
      { data: payslipRows },
      { data: employeeExpenseRows },
      { data: invoiceRows },
      { data: invLayerRows },
    ] = await Promise.all([
      sb.from('organizations').select('*').eq('id', orgId),
      sb.from('transactions').select('*').eq('organization_id', orgId),
      sb.from('accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('loans').select('*').eq('organization_id', orgId),
      sb.from('loan_payments').select('id, loan_id, payment_month, paid_on, amount').eq('organization_id', orgId),
      sb.from('assets').select('*').eq('organization_id', orgId),
      sb.from('inventory_items').select('*').eq('organization_id', orgId),
      sb.from('departments').select('*').eq('organization_id', orgId),
      sb.from('categories').select('*').eq('organization_id', orgId),
      sb.from('organization_members').select('*').eq('organization_id', orgId),
      sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
      sb.from('recurring_transactions').select('*').eq('organization_id', orgId),
      sb.from('recurring_occurrences').select('template_id, scheduled_date, scheduled_period_key, status').eq('organization_id', orgId),
      sb.from('budgets').select('*').eq('organization_id', orgId),
      sb.from('employee_payslips').select('*').eq('organization_id', orgId),
      sb.from('employee_expenses').select('*').eq('organization_id', orgId).eq('status', 'approved'),
      sb.from('invoices').select('id, invoice_number, client_name, due_date, total_amount, amount_paid, amount_due, currency, status').eq('organization_id', orgId),
      sb.from('inventory_layers').select('inventory_item_id, quantity_remaining, unit_cost').eq('organization_id', orgId).gt('quantity_remaining', 0),
    ]);

    const orgRow = orgRows?.[0];
    const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();

    if (txnError || accError) {
      console.error('[reports.dashboard] Supabase error:', txnError || accError);
      return res.status(500).json({ error: 'Failed to fetch report data from Supabase.' });
    }

    const catMap = new Map<string, string>();
    for (const c of (catRows || [])) {
      catMap.set(String(c.id), String(c.name));
    }

    // ── World Isolation Map for Bank Accounts (§1, §5, §8, §33) ──────────────
    const { allAccessibleBanks: allBanks, worldBanks: banks, bankWorldMap } = filterAccessibleBanks(
      bankAccounts ?? [],
      worldFilter,
      callerUserId,
      isOrgOwner,
    );

    const isLoanRepaymentTxn = (t: { categoryId?: string; description?: string; narration?: string }) =>
      isLoanRepaymentShared(t, catMap);

    // ── Internal Transfer Detection (§1, §8, §23 F-01, §33) ──────────────────
    const isTransferTxn = (t: {
      isTransfer?: boolean;
      transferGroupId?: string;
      tags?: string[];
      categoryId?: string;
      description?: string;
      narration?: string;
    }) => isTransferShared(t, catMap);

    // Apply World Isolation filter (§1, §5, §33)
    const worldTransactions = mapAndFilterWorldTransactions(
      txns ?? [],
      orgCurrency,
      bankWorldMap,
      worldFilter,
      callerUserId,
      isOrgOwner,
    );

    // Separate Pending / Unapproved rows from Committed / Posted rows (§8, §33)
    const pendingList = worldTransactions.filter(t => t.status === 'pending' || t.status === 'draft');
    const pendingTransactions = pendingList.length;
    const pendingReviewAmount = Math.round(
      pendingList.reduce((s, t) => s + Math.abs(t.amount), 0) * 100
    ) / 100;

    // Authoritative P&L transactions exclude pending/draft/rejected/reversed AND internal transfers
    const committedPlTransactions = worldTransactions.filter(
      t =>
        !['pending', 'draft', 'rejected', 'reversed'].includes(t.status) &&
        !isTransferTxn(t)
    );

    const totalRevenue = committedPlTransactions
      .filter(t => t.type === 'credit')
      .reduce((s, t) => s + t.amount, 0);
    // Operating expenses strictly exclude loan principal repayments and internal transfers
    const totalExpenses = committedPlTransactions
      .filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round(((totalRevenue - totalExpenses) / totalRevenue) * 1000) / 10 : null;

    // Current Month Metrics
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthTxns = committedPlTransactions.filter(t => t.date && t.date.startsWith(currentMonthPrefix));
    const monthlyRevenue = currentMonthTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const monthlyExpenses = currentMonthTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const monthlyProfit = monthlyRevenue - monthlyExpenses;

    // Prior Month Metrics for real dynamic MoM deltas
    const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const priorMonthPrefix = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const priorMonthTxns = committedPlTransactions.filter(t => t.date && t.date.startsWith(priorMonthPrefix));
    const priorRevenue = priorMonthTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const priorExpenses = priorMonthTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const priorProfit = priorRevenue - priorExpenses;

    const revenueChange = priorRevenue > 0 ? Math.round(((monthlyRevenue - priorRevenue) / priorRevenue) * 1000) / 10 : null;
    const expenseChange = priorExpenses > 0 ? Math.round(((monthlyExpenses - priorExpenses) / priorExpenses) * 1000) / 10 : null;
    const profitChange = Math.abs(priorProfit) > 0 ? Math.round(((monthlyProfit - priorProfit) / Math.abs(priorProfit)) * 1000) / 10 : null;

    // Current Week Metrics
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const currentWeekTxns = committedPlTransactions.filter(t => t.date && new Date(t.date) >= oneWeekAgo && new Date(t.date) <= now);
    const priorWeekTxns = committedPlTransactions.filter(t => t.date && new Date(t.date) >= twoWeeksAgo && new Date(t.date) < oneWeekAgo);
    const weeklyRevenue = currentWeekTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const weeklyExpenses = currentWeekTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const weeklyProfit = weeklyRevenue - weeklyExpenses;
    const priorWeeklyProfit = priorWeekTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0) -
      priorWeekTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const weeklyProfitChange = Math.abs(priorWeeklyProfit) > 0 ? Math.round(((weeklyProfit - priorWeeklyProfit) / Math.abs(priorWeeklyProfit)) * 1000) / 10 : null;

    // Current Year Metrics
    const currentYearPrefix = `${now.getFullYear()}-`;
    const priorYearPrefix = `${now.getFullYear() - 1}-`;
    const currentYearTxns = committedPlTransactions.filter(t => t.date && t.date.startsWith(currentYearPrefix));
    const priorYearTxns = committedPlTransactions.filter(t => t.date && t.date.startsWith(priorYearPrefix));
    const yearlyRevenue = currentYearTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const yearlyExpenses = currentYearTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const yearlyProfit = yearlyRevenue - yearlyExpenses;
    const priorYearlyProfit = priorYearTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0) -
      priorYearTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const yearlyProfitChange = Math.abs(priorYearlyProfit) > 0 ? Math.round(((yearlyProfit - priorYearlyProfit) / Math.abs(priorYearlyProfit)) * 1000) / 10 : null;

    // Monthly payroll from strictly active organization members (only for business world & authorized roles)
    const activeMembers = (memberRows ?? []).filter(isActiveOrgMember);
    const rawMonthlyPayroll =
      worldFilter === 'personal'
        ? 0
        : activeMembers.reduce(
          (sum: number, m: any) =>
            sum + convertCurrency(Number(m.fixed_salary || m.salary || 0), m.salary_currency || m.currency || orgCurrency, orgCurrency),
          0
        );
    const monthlyPayroll = includePayrollConfidential ? Math.round(rawMonthlyPayroll * 100) / 100 : 0;

    // 1–7. Authoritative Balance Sheet & Net Worth Snapshot (shared with /balance-sheet & /bank-accounts)
    const bsSnapshot = computeBalanceSheetSnapshot({
      orgCurrency,
      worldFilter,
      allAccessibleBanks: allBanks,
      worldBanks: banks,
      rawTxns: txns ?? [],
      accounts: accounts ?? [],
      loanRows: loanRows ?? [],
      assetRows: assetRows ?? [],
      invRows: invRows ?? [],
      invLayerRows: invLayerRows ?? [],
    });

    const {
      cashInBank,
      cashOnHand,
      totalBankBalanceBase,
      totalLiquidCash,
      accountsReceivable,
      accountsPayable,
      loansReceivable,
      loansPayable,
      totalInventory,
      totalFixedAssets,
      totalAssets,
      totalLiabilities,
      netWorth,
      liquidNetWorth,
    } = bsSnapshot;

    const cashTypeBankAccounts = banks.filter((b: any) => String(b.account_type || '') === 'cash');

    // 8. Dynamic MoM Trend Percentages for Total Balance, Cash in Hand, and Net Worth
    const cashBankIds = new Set(cashTypeBankAccounts.map((b: any) => String(b.id)));
    const currentMonthAllFlows = worldTransactions.filter(
      t => t.date && t.date.startsWith(currentMonthPrefix) && !['pending', 'draft', 'rejected', 'reversed'].includes(t.status)
    );
    const currentMonthNetFlow = currentMonthAllFlows.reduce(
      (s, t) => (t.type === 'credit' ? s + t.amount : s - Math.abs(t.amount)),
      0
    );
    const currentMonthCashHandFlow = currentMonthAllFlows
      .filter(t => cashBankIds.has(t.bankAccountId))
      .reduce((s, t) => (t.type === 'credit' ? s + t.amount : s - Math.abs(t.amount)), 0);

    const priorBalanceBase = totalBankBalanceBase - currentMonthNetFlow;
    const totalBalanceChange =
      Math.abs(priorBalanceBase) > 0.01
        ? Math.round(((totalBankBalanceBase - priorBalanceBase) / Math.abs(priorBalanceBase)) * 1000) / 10
        : null;

    const priorCashOnHand = cashOnHand - currentMonthCashHandFlow;
    const cashOnHandChange =
      Math.abs(priorCashOnHand) > 0.01
        ? Math.round(((cashOnHand - priorCashOnHand) / Math.abs(priorCashOnHand)) * 1000) / 10
        : null;

    const priorNetWorth = netWorth - monthlyProfit;
    const netWorthChange =
      Math.abs(priorNetWorth) > 0.01
        ? Math.round(((netWorth - priorNetWorth) / Math.abs(priorNetWorth)) * 1000) / 10
        : null;

    // ── Generate 100% Real 12-Month & 8-Week Chart Analytics from Database ──
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsMap = new Map<string, { name: string; key: string; Revenue: number; Expenses: number; Profit: number }>();
    const monthKeys: string[] = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const name = monthNames[d.getMonth()];
      monthKeys.push(key);
      monthsMap.set(key, { name, key, Revenue: 0, Expenses: 0, Profit: 0 });
    }

    for (const t of committedPlTransactions) {
      if (!t.date) continue;
      const key = t.date.slice(0, 7);
      const bucket = monthsMap.get(key);
      if (bucket) {
        if (t.type === 'credit') {
          bucket.Revenue += t.amount;
        } else if (!isLoanRepaymentTxn(t)) {
          bucket.Expenses += Math.abs(t.amount);
        }
      }
    }

    const monthlyProfitData = monthKeys.map(k => {
      const b = monthsMap.get(k)!;
      return {
        name: b.name,
        Revenue: Math.round(b.Revenue * 100) / 100,
        Expenses: Math.round(b.Expenses * 100) / 100,
        Profit: Math.round((b.Revenue - b.Expenses) * 100) / 100,
      };
    });

    // Weekly Profit Data (8 rolling weeks for 1W period filter on ProfitIntelligenceGraph)
    const depts = deptRows || [];
    const deptMap = new Map<string, string>();
    for (const d of depts) {
      deptMap.set(String(d.id), String(d.name));
    }
    const defaultDepts = depts.length > 0 ? depts.map((d: any) => d.name) : ['Development', 'Design', 'Marketing', 'Sales'];

    const weeklyProfitData: Array<Record<string, any>> = [];
    for (let w = 7; w >= 0; w--) {
      const wEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
      const wStart = new Date(wEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      const label = wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const wTxns = committedPlTransactions.filter(t => {
        if (!t.date) return false;
        const dt = new Date(t.date);
        return dt >= wStart && dt < wEnd;
      });
      const wRev = wTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
      const wExp = wTxns.filter(t => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
      const wRow: Record<string, any> = {
        name: label,
        Revenue: Math.round(wRev * 100) / 100,
        Expenses: Math.round(wExp * 100) / 100,
        Profit: Math.round((wRev - wExp) * 100) / 100,
      };
      for (const dName of defaultDepts) {
        wRow[dName] = 0;
      }
      for (const t of wTxns) {
        if (t.type !== 'debit' || isLoanRepaymentTxn(t)) continue;
        const dName = t.departmentId ? deptMap.get(t.departmentId) : null;
        if (dName && wRow[dName] !== undefined) {
          wRow[dName] = Math.round((wRow[dName] + Math.abs(t.amount)) * 100) / 100;
        }
      }
      weeklyProfitData.push(wRow);
    }

    // Real Department Performance monthly breakdown (Operational debit outflows by department)
    const departmentPerformance = monthKeys.map(k => {
      const b = monthsMap.get(k)!;
      const row: Record<string, any> = { name: b.name };
      for (const dName of defaultDepts) {
        row[dName] = 0;
      }
      for (const t of committedPlTransactions) {
        if (t.type !== 'debit' || isLoanRepaymentTxn(t) || !t.date || t.date.slice(0, 7) !== k) continue;
        const dName = t.departmentId ? deptMap.get(t.departmentId) : null;
        if (dName && row[dName] !== undefined) {
          row[dName] = Math.round((row[dName] + Math.abs(t.amount)) * 100) / 100;
        }
      }
      return row;
    });

    // Real Expense Categories Donut Breakdown (strictly reflecting posted operational debits)
    const catTotals = new Map<string, number>();
    for (const t of committedPlTransactions) {
      if (t.type === 'debit' && !isLoanRepaymentTxn(t)) {
        const catName = (t.categoryId ? catMap.get(t.categoryId) : null) || 'General Operations';
        catTotals.set(catName, (catTotals.get(catName) || 0) + Math.abs(t.amount));
      }
    }

    const palette = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#f97316'];
    const sortedCategories = Array.from(catTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], idx) => ({
        name,
        value: Math.round(value * 100) / 100,
        color: palette[idx % palette.length],
      }));
    const expenseCategories = sortedCategories.length > 0 ? sortedCategories : [
      { name: 'Operations', value: 0, color: palette[0] }
    ];

    const monthlyComparison = monthlyProfitData.slice(-6);

    // ── Monthly Goals from Active Budgets & Margin Targets ──────────────────
    const activeBudgets = (budgetRows || []).filter((b: any) => b.status !== 'completed');
    const totalBudgetedExpense = activeBudgets.reduce(
      (s: number, b: any) => s + convertCurrency(Number(b.budgeted_amount || 0), b.currency || orgCurrency, orgCurrency),
      0
    );

    const monthlyGoals = {
      expenseBudget: totalBudgetedExpense > 0 ? Math.round(totalBudgetedExpense * 100) / 100 : null,
      expenseActual: Math.round(monthlyExpenses * 100) / 100,
      expensePct: totalBudgetedExpense > 0 ? Math.min(100, Math.round((monthlyExpenses / totalBudgetedExpense) * 100)) : null,
      revenueTarget: null,
      revenueActual: Math.round(monthlyRevenue * 100) / 100,
      revenuePct: null,
      savingsTarget: null,
      savingsActual: Math.round(monthlyProfit * 100) / 100,
      savingsPct: null,
      targetSource: totalBudgetedExpense > 0 ? 'budgets' : 'none',
    };

    // ── Authoritative Upcoming Payments & Expenses (Next 30 Days + Overdue Separation) ──
    const upcomingSnapshot = computeUpcomingObligations({
      orgCurrency,
      worldFilter,
      includePayrollConfidential,
      allOrgBanks: bankAccounts ?? [],
      bankWorldMap,
      recurringRows: recurringRows ?? [],
      recurringOccurrenceRows: recurringOccurrenceRows ?? [],
      loanRows: loanRows ?? [],
      loanPaymentRows: loanPaymentRows ?? [],
      memberRows: memberRows ?? [],
      payslipRows: payslipRows ?? [],
      employeeExpenseRows: employeeExpenseRows ?? [],
      invoiceRows: invoiceRows ?? [],
      asOfDate: now,
      horizonDays: 30,
    });

    const {
      upcomingPayments,
      upcomingExpenses,
      overduePayments,
      overdueExpenses,
      totalUpcomingPayments,
      totalUpcomingExpenses,
      totalOverduePayments,
      totalOverdueExpenses,
    } = upcomingSnapshot;

    // Monthly Burn Rate & Cash Runway Months (§12.1, §12.4, §15, §33)
    // Trailing active operating months within the 3-month window
    const trailingMonths = monthKeys.slice(-3);
    const activeTrailingExp = trailingMonths
      .map(k => monthsMap.get(k)?.Expenses || 0)
      .filter(exp => exp > 0);
    const sumActiveTrailing = activeTrailingExp.reduce((s, v) => s + v, 0);
    const historicalBurn = activeTrailingExp.length > 0
      ? sumActiveTrailing / activeTrailingExp.length
      : monthlyExpenses;
    // Monthly burn rate factors active historical operational expenses and active monthly payroll
    const monthlyBurnRate = Math.round(Math.max(historicalBurn, monthlyPayroll) * 100) / 100;
    const cashRunwayMonths = monthlyBurnRate > 0
      ? Math.round((totalLiquidCash / monthlyBurnRate) * 10) / 10
      : null;

    ok(res, {
      currency: orgCurrency,
      worldScope: worldFilter,
      totalRevenue,
      totalExpenses,
      netProfit,
      monthlyRevenue,
      monthlyExpenses,
      monthlyProfit,
      monthlyProfitChange: profitChange,
      weeklyRevenue,
      weeklyExpenses,
      weeklyProfit,
      weeklyProfitChange,
      yearlyRevenue,
      yearlyExpenses,
      yearlyProfit,
      yearlyProfitChange,
      profitMargin,
      cashOnHand,
      cashOnHandChange,
      cashInBank,
      totalBankBalanceBase,
      totalBalanceChange,
      accountsReceivable,
      accountsPayable,
      totalAssets,
      totalLiabilities,
      netWorth,
      netWorthChange,
      liquidNetWorth,
      totalInventory,
      totalFixedAssets,
      monthlyPayroll: includePayrollConfidential ? monthlyPayroll : 0,
      payrollConfidentialMasked: !includePayrollConfidential,
      monthlyBurnRate,
      cashRunwayMonths,
      loansReceivable,
      loansPayable,
      pendingTransactions,
      pendingReviewAmount,
      revenueChange,
      expenseChange,
      profitChange,
      monthlyGoals,
      upcomingPayments,
      upcomingExpenses,
      overduePayments,
      overdueExpenses,
      totalUpcomingPayments,
      totalUpcomingExpenses,
      totalOverduePayments,
      totalOverdueExpenses,
      meta: {
        basis: 'cash',
        baseCurrency: orgCurrency,
        worldScope: worldFilter,
        asOf: new Date().toISOString(),
        source: 'transactions',
        unapprovedCount: pendingTransactions,
        upcomingWindow: {
          start: upcomingSnapshot.windowStart,
          end: upcomingSnapshot.windowEnd,
          basis: upcomingSnapshot.basis,
        },
      },
      chartData: {
        profitData: monthlyProfitData,
        weeklyProfitData,
        departmentData: departmentPerformance,
        expenseCategoryData: expenseCategories,
        monthlyComparisonData: monthlyComparison,
      },
    });
  });

  r.get('/profit-loss', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
    const rawWorld = String(req.query.world || 'business').toLowerCase();
    const worldFilter: WorldFilter =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    try {
      const [{ data: orgRow }, { data: bankAccounts }, { data: catRows }, { data: txns, error: qErr }] = await Promise.all([
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
        sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('transactions').select('*, categories:category_id(id, name, type)').eq('organization_id', orgId),
      ]);

      if (qErr) {
        return res.status(500).json({ error: qErr.message });
      }

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();
      const catMap = new Map<string, string>();
      for (const c of (catRows || [])) {
        catMap.set(String(c.id), String(c.name));
      }

      const { bankWorldMap } = filterAccessibleBanks(bankAccounts ?? [], worldFilter, callerUserId, isOrgOwner);
      const worldTransactions = mapAndFilterWorldTransactions(
        txns ?? [],
        orgCurrency,
        bankWorldMap,
        worldFilter,
        callerUserId,
        isOrgOwner,
      );

      const committedPlTransactions = worldTransactions.filter(
        (t) => !NON_POSTED_STATUSES.has(t.status) && !isTransferShared(t, catMap),
      );

      return ok(
        res,
        computeProfitLossSnapshot({
          committedPlTransactions,
          catMap,
          dateFrom,
          dateTo,
        }),
      );
    } catch (directErr) {
      console.error('[reports.profit-loss] calculation error:', directErr);
      return res.status(500).json({ error: (directErr as any)?.message || 'Failed to calculate profit & loss report.' });
    }
  });

  r.get('/cash-flow', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const months = Number(req.query.months ?? 6) || 6;
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
    const rawWorld = String(req.query.world || 'business').toLowerCase();
    const worldFilter: WorldFilter =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    try {
      const [{ data: orgRow }, { data: bankAccounts }, { data: catRows }, { data: txns, error: qErr }] = await Promise.all([
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
        sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('transactions').select('*, categories:category_id(id, name, type)').eq('organization_id', orgId),
      ]);

      if (qErr) {
        return res.status(500).json({ error: qErr.message });
      }

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();
      const catMap = new Map<string, string>();
      for (const c of (catRows || [])) {
        catMap.set(String(c.id), String(c.name));
      }

      const { bankWorldMap } = filterAccessibleBanks(bankAccounts ?? [], worldFilter, callerUserId, isOrgOwner);
      const worldTransactions = mapAndFilterWorldTransactions(
        txns ?? [],
        orgCurrency,
        bankWorldMap,
        worldFilter,
        callerUserId,
        isOrgOwner,
      );

      return ok(
        res,
        computeCashFlowSnapshot({
          worldTransactions,
          catMap,
          months,
          dateFrom,
          dateTo,
        }),
      );
    } catch (directErr) {
      console.error('[reports.cash-flow] calculation error:', directErr);
    }

    ok(res, []);
  });

  r.get('/expense-breakdown', async (req: Request, res: Response) => {
    const orgId = req.params.organizationId;
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    try {
      const { data, error } = await sb.rpc('get_expense_breakdown', {
        p_organization_id: orgId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });

      if (!error && data && Array.isArray(data.breakdown) && data.breakdown.length > 0) {
        return ok(res, data.breakdown);
      }
    } catch (err) {
      console.warn('[reports.expense-breakdown] Supabase RPC error, calculating directly:', err);
    }

    // Direct calculation from transactions table
    try {
      const { data: orgRow } = await sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle();
      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();

      let q = sb
        .from('transactions')
        .select('id, amount, description, narration, category_id, currency, fx_rate_to_base, base_amount, base_currency, tags, categories:category_id(id, name)')
        .eq('organization_id', orgId)
        .eq('type', 'debit');

      if (dateFrom) q = q.gte('date', dateFrom);
      if (dateTo) q = q.lte('date', dateTo);

      const { data: rows, error: qErr } = await q;
      if (!qErr && rows && rows.length > 0) {
        const catMap = new Map<string, { id: string; name: string; amount: number; count: number }>();
        const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#14b8a6', '#f97316'];

        for (const t of rows) {
          const desc = String(t.description || '').toLowerCase();
          const narr = String(t.narration || '').toLowerCase();
          const catName = (t as any).categories?.name || t.category_id || 'General Expenses';

          if (
            catName.toLowerCase().includes('loan repayment') ||
            desc.includes('loan repayment') ||
            (narr.includes('monthly installment') && narr.includes('loan'))
          ) {
            continue; // Exclude financing loan principal repayments
          }

          let name = catName;
          if (desc.includes('inventory purchase') || narr.includes('purchase:')) {
            name = 'Inventory Purchases & Direct Materials';
          }

          const catId = t.category_id || (name === 'Inventory Purchases & Direct Materials' ? 'cat-inventory' : 'cat-general');
          const rawAmt = Math.abs(Number(t.amount || 0));
          const rawCurr = String((t as any).currency || orgCurrency).toUpperCase().trim();
          let fxRate: number | undefined = (t as any).fx_rate_to_base ? Number((t as any).fx_rate_to_base) : undefined;
          const tags: string[] = Array.isArray((t as any).tags) ? (t as any).tags.map(String) : [];
          if (!fxRate && tags.length > 0) {
            const rTag = tags.find((tag: string) => tag.startsWith('fx:rate:'));
            if (rTag) fxRate = Number(rTag.slice(8));
          }
          const amt =
            (t as any).base_amount != null && Number((t as any).base_amount) > 0 && String((t as any).base_currency || orgCurrency).toUpperCase() === orgCurrency
              ? Number((t as any).base_amount)
              : convertCurrency(rawAmt, rawCurr, orgCurrency, fxRate);

          if (!catMap.has(name)) {
            catMap.set(name, { id: catId, name, amount: 0, count: 0 });
          }
          const item = catMap.get(name)!;
          item.amount += amt;
          item.count += 1;
        }

        const total = Array.from(catMap.values()).reduce((s, c) => s + c.amount, 0);
        const breakdown = Array.from(catMap.values())
          .sort((a, b) => b.amount - a.amount)
          .map((item, idx) => ({
            categoryId: item.id,
            categoryName: item.name,
            amount: Math.round(item.amount * 100) / 100,
            percentage: total > 0 ? Math.round((item.amount / total) * 1000) / 10 : 0,
            color: colors[idx % colors.length],
            transactionCount: item.count,
          }));

        return ok(res, breakdown);
      }
    } catch (directErr) {
      console.error('[reports.expense-breakdown] direct calculation error:', directErr);
    }

    ok(res, []);
  });

  r.get('/revenue-breakdown', async (req: Request, res: Response) => {
    const orgId = req.params.organizationId;
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    try {
      const { data, error } = await sb.rpc('get_revenue_breakdown', {
        p_organization_id: orgId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });

      if (!error && data && Array.isArray(data.breakdown) && data.breakdown.length > 0) {
        return ok(res, data.breakdown);
      }
    } catch (err) {
      console.warn('[reports.revenue-breakdown] Supabase RPC error, calculating directly:', err);
    }

    // Direct calculation from transactions table
    try {
      const { data: orgRow } = await sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle();
      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();

      let q = sb
        .from('transactions')
        .select('id, amount, description, narration, project_id, currency, fx_rate_to_base, base_amount, base_currency, tags, projects:project_id(id, name)')
        .eq('organization_id', orgId)
        .eq('type', 'credit');

      if (dateFrom) q = q.gte('date', dateFrom);
      if (dateTo) q = q.lte('date', dateTo);

      const { data: rows, error: qErr } = await q;
      if (!qErr && rows && rows.length > 0) {
        const projMap = new Map<string, { id: string; name: string; revenue: number }>();

        for (const t of rows) {
          const desc = String(t.description || '').toLowerCase();
          const narr = String(t.narration || '').toLowerCase();
          let projName = (t as any).projects?.name || 'General Revenue';
          let projId = t.project_id || 'proj-general';

          if (!t.project_id) {
            if (desc.includes('inventory sale') || narr.includes('sale:')) {
              projName = 'Product & Inventory Sales';
              projId = 'proj-inventory';
            }
          }

          const rawAmt = Math.abs(Number(t.amount || 0));
          const rawCurr = String((t as any).currency || orgCurrency).toUpperCase().trim();
          let fxRate: number | undefined = (t as any).fx_rate_to_base ? Number((t as any).fx_rate_to_base) : undefined;
          const tags: string[] = Array.isArray((t as any).tags) ? (t as any).tags.map(String) : [];
          if (!fxRate && tags.length > 0) {
            const rTag = tags.find((tag: string) => tag.startsWith('fx:rate:'));
            if (rTag) fxRate = Number(rTag.slice(8));
          }
          const amt =
            (t as any).base_amount != null && Number((t as any).base_amount) > 0 && String((t as any).base_currency || orgCurrency).toUpperCase() === orgCurrency
              ? Number((t as any).base_amount)
              : convertCurrency(rawAmt, rawCurr, orgCurrency, fxRate);

          if (!projMap.has(projName)) {
            projMap.set(projName, { id: projId, name: projName, revenue: 0 });
          }
          const item = projMap.get(projName)!;
          item.revenue += amt;
        }

        const total = Array.from(projMap.values()).reduce((s, p) => s + p.revenue, 0);
        const breakdown = Array.from(projMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .map(item => ({
            projectId: item.id,
            projectName: item.name,
            revenue: Math.round(item.revenue * 100) / 100,
            percentage: total > 0 ? Math.round((item.revenue / total) * 1000) / 10 : 0,
          }));

        return ok(res, breakdown);
      }
    } catch (directErr) {
      console.error('[reports.revenue-breakdown] direct calculation error:', directErr);
    }

    ok(res, []);
  });

  // Helper to compute verified liquid cash from bank accounts + transactions with FX conversion
  async function computeLiveLiquidCash(
    orgId: string,
    sbClient: any,
    bankAccounts: any[],
    transactions: any[],
    baseCurrency = 'USD',
    world: 'business' | 'personal' | 'all' = 'business'
  ): Promise<number> {
    let totalBank = 0;
    let totalOnlineWallets = 0;
    let totalCreditLiabilities = 0;
    let totalCash = 0;

    const scopedBanks = (bankAccounts || []).filter((b: any) => {
      const usage = b.usage === 'personal' ? 'personal' : 'business';
      if (world === 'all') return true;
      return usage === world;
    });

    if (scopedBanks.length > 0) {
      for (const b of scopedBanks) {
        const accountTxns = (transactions || []).filter(
          (t: any) =>
            t.bank_account_id === b.id &&
            !['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
        );
        const rawOpening = b.opening_balance;
        const fallbackStored = b.current_balance ?? b.balance;
        const openingBal = rawOpening != null
          ? Number(rawOpening)
          : (accountTxns.length > 0 ? 0 : Number(fallbackStored ?? 0));
        let liveBal = openingBal;

        if (accountTxns.length === 0) {
          liveBal = Number(fallbackStored ?? openingBal ?? 0);
        } else {
          for (const t of accountTxns) {
            const rawAmt = Number(t.amount || 0);
            const txnCurrency = (t.currency || b.currency || baseCurrency).toUpperCase();
            let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
            const tags = Array.isArray(t.tags) ? t.tags : (typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : []);
            if (!fxRate && tags) {
              const rTag = tags.find((tag: any) => typeof tag === 'string' && tag.startsWith('fx:rate:'));
              if (rTag) fxRate = Number(rTag.slice(8));
            }
            const convertedAmt = convertCurrency(rawAmt, txnCurrency, b.currency || baseCurrency, fxRate);
            if (t.type === 'credit') {
              liveBal += convertedAmt;
            } else {
              liveBal -= Math.abs(convertedAmt);
            }
          }
        }

        const roundedLiveBal = Math.round(liveBal * 100) / 100;
        // Keep Supabase bank_accounts.balance in sync with verified ledger debits/credits
        if (sbClient && Math.abs(Number(b.balance) - roundedLiveBal) > 0.01) {
          b.balance = roundedLiveBal;
          void sbClient
            .from('bank_accounts')
            .update({ balance: roundedLiveBal, last_synced_at: new Date().toISOString() })
            .eq('id', b.id);
        }

        const balInBase = convertCurrency(roundedLiveBal, b.currency || baseCurrency, baseCurrency);

        if (['checking', 'savings', 'debit_card', 'prepaid_card', 'bank_account'].includes(b.account_type)) {
          totalBank += balInBase;
        } else if (b.account_type === 'online_wallet') {
          totalOnlineWallets += balInBase;
        } else if (['credit_card', 'line_of_credit', 'credit'].includes(b.account_type)) {
          totalCreditLiabilities += Math.abs(balInBase);
        } else if (b.account_type === 'cash') {
          totalCash += balInBase;
        }
      }

      return Math.round((totalBank + totalCash + totalOnlineWallets - totalCreditLiabilities) * 100) / 100;
    }

    // Fallback: Chart of accounts assets
    const { data: accData } = await sbClient
      .from('accounts')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);
    if (accData) {
      return accData
        .filter((a: any) => a.type === 'asset' && ['bank_account', 'current_asset', 'cash'].includes(a.subtype))
        .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
    }

    return 0;
  }

  async function runForecastForOrg(
    req: Request,
    orgId: string,
    horizonDays: number,
    scenario: 'realistic' | 'best' | 'worst',
  ) {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return { status: 503 as const, error: 'Database connection required. Please configure Supabase.' };
    }

    const rawWorld = String(req.query.world || req.body?.world || 'business').toLowerCase();
    const worldFilter: WorldFilter =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';

    const [
      { data: orgData },
      { data: bankData },
      { data: txnData },
      { data: recData },
      { data: loanData },
    ] = await Promise.all([
      sb.from('organizations').select('currency').eq('id', orgId).single(),
      sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('transactions').select('*').eq('organization_id', orgId),
      sb.from('recurring_transactions').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('loans').select('*').eq('organization_id', orgId),
    ]);

    const baseCurrency = orgData?.currency || 'USD';
    const rawTxns = txnData || [];
    const { worldBanks, bankWorldMap } = filterAccessibleBanks(
      bankData || [],
      worldFilter,
      callerUserId,
      isOrgOwner,
    );

    const worldTxns = rawTxns.filter((t: any) => {
      const bankWorld = t.bank_account_id ? bankWorldMap.get(String(t.bank_account_id)) : undefined;
      if (t.bank_account_id && !bankWorld && (bankData || []).some((b: any) => String(b.id) === String(t.bank_account_id))) {
        return false;
      }
      const usage = bankWorld || (t.usage === 'personal' || t.world === 'personal' ? 'personal' : 'business');
      if (usage === 'personal' && t.owner_user_id && t.owner_user_id !== callerUserId && !isOrgOwner) {
        return false;
      }
      return worldFilter === 'all' ? true : usage === worldFilter;
    });

    const worldRecurring = (recData || []).filter((r: any) => {
      const bankWorld = r.bank_account_id ? bankWorldMap.get(String(r.bank_account_id)) : undefined;
      const usage = bankWorld || (r.usage === 'personal' || r.world === 'personal' ? 'personal' : 'business');
      return worldFilter === 'all' ? true : usage === worldFilter;
    });

    const worldLoans = worldFilter === 'personal' ? [] : (loanData || []);
    const currentCash = await computeLiveLiquidCash(orgId, sb, worldBanks, rawTxns, baseCurrency, worldFilter);

    const { computeCashFlowForecast } = await import('../services/forecastEngine.js');
    const result = computeCashFlowForecast({
      organizationId: orgId,
      horizonDays,
      scenario,
      currentCash,
      baseCurrency,
      transactions: worldTxns,
      recurring: worldRecurring,
      loans: worldLoans,
    });

    if (result.forecasts.length > 0) {
      try {
        const rowsToInsert = result.forecasts.map(f => ({
          id: `cff-${orgId}-${f.date}-${scenario}`,
          organization_id: orgId,
          date: f.date,
          forecasted_income: f.income,
          forecasted_expenses: f.expense,
          net_cash_flow: f.net,
          projected_balance: f.balance,
          confidence: f.confidence,
          scenario,
          generated_at: new Date().toISOString(),
        }));

        await sb
          .from('cash_flow_forecasts')
          .delete()
          .eq('organization_id', orgId)
          .eq('scenario', scenario)
          .gte('date', result.forecasts[0].date);

        await sb.from('cash_flow_forecasts').upsert(rowsToInsert);
      } catch (persistErr) {
        console.warn('[reports.forecast] Failed to persist to cash_flow_forecasts table:', persistErr);
      }
    }

    return {
      status: 200 as const,
      payload: {
        ...result.kpis,
        worldScope: worldFilter,
        forecasts: result.forecasts,
        assumptions: (result as any).assumptions,
        cutoffDate: (result as any).cutoffDate,
      },
    };
  }

  r.get('/forecast', async (req: Request, res: Response) => {
    const orgId = String(req.params.organizationId);
    const horizonDays = Number(req.query.horizonDays ?? (Number(req.query.monthsAhead ?? 3) * 30)) || 90;
    const scenario = ((req.query.scenario as string) || 'realistic') as 'realistic' | 'best' | 'worst';

    try {
      const outcome = await runForecastForOrg(req, orgId, horizonDays, scenario);
      if (outcome.status !== 200) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
      return ok(res, outcome.payload);
    } catch (dbErr) {
      console.error('[reports.forecast] Supabase DB read error:', dbErr);
      return res.status(500).json({ error: 'Failed to fetch forecast data from Supabase.' });
    }
  });

  // ── GET /forecast/profit — Accrued / Recognized Profit Forecast ───────────
  r.get('/forecast/profit', async (req: Request, res: Response) => {
    const orgId = String(req.params.organizationId);
    const horizonMonths = Number(req.query.horizonMonths || 6);
    const scenario = ((req.query.scenario as string) || 'realistic') as 'realistic' | 'best' | 'worst';

    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const [
        { data: txns },
        { data: recurring },
        { data: overheadRows },
        { data: assetRows },
      ] = await Promise.all([
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('recurring_transactions').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('overhead_allocations').select('amount').eq('organization_id', orgId),
        sb.from('assets').select('purchase_price, salvage_value, useful_life_years, status').eq('organization_id', orgId).eq('status', 'active'),
      ]);

      // Calculate 3-month trailing baseline averages
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const cutoffStr = threeMonthsAgo.toISOString().split('T')[0];

      let totalHistCredit = 0;
      let totalHistDebit = 0;
      for (const t of (txns || [])) {
        if (t.date >= cutoffStr) {
          const amt = Math.abs(Number(t.amount || 0));
          if (t.type === 'credit') totalHistCredit += amt;
          else totalHistDebit += amt;
        }
      }
      const baselineMonthlyRevenue = totalHistCredit / 3;
      const baselineMonthlyCogs = (totalHistDebit * 0.4) / 3;
      const baselineMonthlyOpex = (totalHistDebit * 0.6) / 3;

      let recRev = 0;
      let recExp = 0;
      for (const r of (recurring || [])) {
        const amt = Math.abs(Number(r.amount || 0));
        if (r.type === 'credit') recRev += amt;
        else recExp += amt;
      }

      const monthlyOverhead = (overheadRows || []).reduce((s: number, o: any) => s + Number(o.amount || 0), 0);
      let monthlyDepr = 0;
      for (const a of (assetRows || [])) {
        const p = Number(a.purchase_price || 0);
        const s = Number(a.salvage_value || 0);
        const l = Math.max(1, Number(a.useful_life_years || 5));
        monthlyDepr += (p - s) / (l * 12);
      }

      const { computeProfitForecast } = await import('../services/forecastEngine.js');
      const forecast = computeProfitForecast({
        organizationId: orgId,
        horizonMonths,
        scenario,
        baselineMonthlyRevenue,
        baselineMonthlyCogs,
        baselineMonthlyOpex,
        monthlyRecurringRevenue: recRev,
        monthlyRecurringExpense: recExp,
        monthlyOverheadPool: monthlyOverhead,
        monthlyDepreciation: monthlyDepr,
      });

      return ok(res, forecast);
    } catch (err: any) {
      console.error('[reports.forecast.profit] error:', err);
      return fail(res, 500, err?.message || 'Failed to generate profit forecast');
    }
  });

  // ── GET /forecast/capacity — Hours, Billing Rates & Utilization Forecast ──
  r.get('/forecast/capacity', async (req: Request, res: Response) => {
    const orgId = String(req.params.organizationId);
    const horizonMonths = Number(req.query.horizonMonths || 6);
    const scenario = ((req.query.scenario as string) || 'realistic') as 'realistic' | 'best' | 'worst';

    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const [{ data: members }, { data: projects }] = await Promise.all([
        sb.from('organization_members').select('*').eq('organization_id', orgId).eq('status', 'active'),
        sb.from('projects').select('*').eq('organization_id', orgId),
      ]);

      const activeHeadcount = Math.max(1, (members || []).length);
      const schedEngine = computeOrgProjectsProfitability({
        projects: projects || [],
        transactions: [],
        members: members || [],
        departments: [],
        overheadAllocations: [],
      });

      let totalPlannedHours = 0;
      let totalQuotedVal = 0;
      for (const p of schedEngine.projects) {
        if (p.plannedHours > 0 && p.quotedAmount > 0) {
          totalPlannedHours += p.plannedHours;
          totalQuotedVal += p.quotedAmount;
        }
      }
      const avgRate = totalPlannedHours > 0 ? totalQuotedVal / totalPlannedHours : 85;
      const monthlyPayroll = (members || []).reduce((sum: number, m: any) => {
        const sal = Number(m.fixed_salary || m.salary || 0);
        return sum + (sal > 0 ? sal : Number(m.hourly_rate || 0) * 160);
      }, 0);

      const { computeCapacityForecast } = await import('../services/forecastEngine.js');
      const forecast = computeCapacityForecast({
        organizationId: orgId,
        horizonMonths,
        scenario,
        activeHeadcount,
        standardHoursPerFte: 160,
        historicalBillableRate: Math.round(avgRate * 100) / 100,
        directStaffCostPerMonth: monthlyPayroll > 0 ? monthlyPayroll : activeHeadcount * 4500,
      });

      return ok(res, forecast);
    } catch (err: any) {
      console.error('[reports.forecast.capacity] error:', err);
      return fail(res, 500, err?.message || 'Failed to generate capacity forecast');
    }
  });

  // ── GET /forecast/combined — Integrated Cash, Profit & Capacity Forecast ───
  r.get('/forecast/combined', async (req: Request, res: Response) => {
    const orgId = String(req.params.organizationId);
    const horizonMonths = Number(req.query.horizonMonths || 6);
    const scenario = ((req.query.scenario as string) || 'realistic') as 'realistic' | 'best' | 'worst';

    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const [
        { data: orgData },
        { data: bankData },
        { data: txnData },
        { data: recData },
        { data: loanData },
        { data: members },
        { data: overheadRows },
        { data: assetRows },
      ] = await Promise.all([
        sb.from('organizations').select('currency').eq('id', orgId).single(),
        sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('recurring_transactions').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('loans').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId).eq('status', 'active'),
        sb.from('overhead_allocations').select('amount').eq('organization_id', orgId),
        sb.from('assets').select('purchase_price, salvage_value, useful_life_years').eq('organization_id', orgId).eq('status', 'active'),
      ]);

      const baseCurrency = orgData?.currency || 'USD';
      const currentCash = await computeLiveLiquidCash(orgId, sb, bankData || [], txnData || [], baseCurrency);

      const { computeCashFlowForecast, computeProfitForecast, computeCapacityForecast, SCENARIO_ASSUMPTIONS } = await import('../services/forecastEngine.js');

      const cashResult = computeCashFlowForecast({
        organizationId: orgId,
        horizonDays: horizonMonths * 30,
        scenario,
        currentCash,
        baseCurrency,
        transactions: txnData || [],
        recurring: recData || [],
        loans: loanData || [],
      });

      const monthlyOverhead = (overheadRows || []).reduce((s: number, o: any) => s + Number(o.amount || 0), 0);
      let monthlyDepr = 0;
      for (const a of (assetRows || [])) {
        monthlyDepr += (Number(a.purchase_price || 0) - Number(a.salvage_value || 0)) / (Math.max(1, Number(a.useful_life_years || 5)) * 12);
      }

      const profitResult = computeProfitForecast({
        organizationId: orgId,
        horizonMonths,
        scenario,
        baselineMonthlyRevenue: cashResult.kpis.dailyIncome * 30,
        baselineMonthlyCogs: cashResult.kpis.dailyBurn * 12,
        baselineMonthlyOpex: cashResult.kpis.dailyBurn * 18,
        monthlyOverheadPool: monthlyOverhead,
        monthlyDepreciation: monthlyDepr,
      });

      const capacityResult = computeCapacityForecast({
        organizationId: orgId,
        horizonMonths,
        scenario,
        activeHeadcount: (members || []).length || 1,
      });

      return ok(res, {
        organizationId: orgId,
        scenario,
        assumptions: SCENARIO_ASSUMPTIONS[scenario],
        cutoffDate: new Date().toISOString().split('T')[0],
        cashForecast: cashResult,
        profitForecast: profitResult,
        capacityForecast: capacityResult,
      });
    } catch (err: any) {
      console.error('[reports.forecast.combined] error:', err);
      return fail(res, 500, err?.message || 'Failed to generate combined forecast');
    }
  });

  r.post('/forecast/generate', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = String(req.params.organizationId);
    const horizonDays = Number(req.body?.horizonDays || req.query.horizonDays || 90);
    const scenario = ((req.body?.scenario || req.query.scenario || 'realistic') as string) as 'realistic' | 'best' | 'worst';

    try {
      const outcome = await runForecastForOrg(req, orgId, horizonDays, scenario);
      if (outcome.status !== 200) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'generate_forecast',
        entityType: 'forecast',
        entityId: orgId,
        description: `Generated ${scenario} forecast (${horizonDays}d)`,
      });
      return ok(res, outcome.payload);
    } catch (err) {
      console.error('[reports.forecast/generate] DB query error:', err);
      return res.status(500).json({ error: 'Failed to fetch forecast data from Supabase.' });
    }
  });

  r.get('/balance-sheet', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const asOfDate = req.query.asOfDate as string | undefined;
    const rawWorld = String(req.query.world || 'business').toLowerCase();
    const worldFilter: WorldFilter =
      rawWorld === 'personal' || rawWorld === 'all' ? rawWorld : 'business';
    const callerUserId = req.authUser?.id;
    const isOrgOwner = req.orgMembership?.role === 'owner';

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    try {
      const [
        { data: orgRow },
        { data: bankAccounts },
        { data: accounts },
        { data: txns },
        { data: loanRows },
        { data: assetRows },
        { data: invRows },
        { data: invLayerRows },
      ] = await Promise.all([
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
        sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('loans').select('*').eq('organization_id', orgId),
        sb.from('assets').select('*').eq('organization_id', orgId),
        sb.from('inventory_items').select('*').eq('organization_id', orgId),
        sb.from('inventory_layers').select('inventory_item_id, quantity_remaining, unit_cost').eq('organization_id', orgId).gt('quantity_remaining', 0),
      ]);

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();
      const { allAccessibleBanks, worldBanks } = filterAccessibleBanks(
        bankAccounts ?? [],
        worldFilter,
        callerUserId,
        isOrgOwner,
      );

      const snapshot = computeBalanceSheetSnapshot({
        orgCurrency,
        worldFilter,
        allAccessibleBanks,
        worldBanks,
        rawTxns: txns ?? [],
        accounts: accounts ?? [],
        loanRows: loanRows ?? [],
        assetRows: assetRows ?? [],
        invRows: invRows ?? [],
        invLayerRows: invLayerRows ?? [],
        asOfDate,
      });

      return ok(res, snapshot);
    } catch (directErr) {
      console.error('[reports.balance-sheet] calculation error:', directErr);
    }

    ok(res, {
      asOfDate: asOfDate || new Date().toISOString().split('T')[0],
      assets: [],
      liabilities: [],
      equity: [],
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
      liquidNetWorth: 0,
      netWorth: 0,
    });
  });

  r.get('/department-profitability', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return res.status(503).json({ error: 'Database connection required. Please configure Supabase.' });
    }

    // Direct calculation from transactions, timesheets, projects, payslip allocations, and departments (Model A)
    try {
      const [{ data: depts }, { data: txns }, { data: members }, { data: allocRows }, { data: projects }, { data: timesheets }, { data: categories }, { data: orgRow }] = await Promise.all([
        sb.from('departments').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('timesheet_entries').select('*').eq('organization_id', orgId),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
      ]);

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();
      const totalOverhead = (allocRows || []).reduce((sum: number, a: any) => sum + Number(a.amount || 0), 0);
      const activeDepts = (depts && depts.length > 0) ? depts : [];
      const deptCount = activeDepts.length;

      const matchDepartmentId = (rawVal: string | undefined | null): string | null => {
        if (!rawVal) return null;
        const val = String(rawVal).trim().toLowerCase();
        if (!val) return null;
        for (const dept of activeDepts) {
          const dId = String(dept.id).toLowerCase();
          const dName = String(dept.name || '').toLowerCase();
          const dCode = String(dept.code || '').toLowerCase();
          if (
            val === dId ||
            val === dName ||
            (dCode.length > 0 && val === dCode) ||
            (val.length >= 3 && (dName.includes(val) || val.includes(dName)))
          ) {
            return dept.id;
          }
        }
        return null;
      };

      const inferCreditDepartmentId = (t: any): string | null => {
        const text = `${t.description || ''} ${t.narration || ''}`.toLowerCase();
        if (!text.trim()) return null;
        for (const dept of activeDepts) {
          const fullDeptName = String(dept.name || '').toLowerCase().trim();
          const baseName = fullDeptName.replace(/\s*department\s*/g, '').trim();
          if (fullDeptName.length >= 4 && text.includes(fullDeptName)) return dept.id;
          if (baseName === 'marketing' && /\b(marketing\s+campaign|marketing\s+service|marketing\s+retainer|marketing\s+client)\b/i.test(text)) return dept.id;
          if (baseName === 'development' && /\b(development\s+project|software\s+development)\b/i.test(text)) return dept.id;
        }
        return null;
      };

      const activeEmployeeMembers = (members || []).filter((m: any) => {
        const st = String(m.status || 'active').toLowerCase();
        const role = String(m.role || '').toLowerCase();
        return st === 'active' && role !== 'owner';
      });

      const userDeptMap = new Map<string, string>();
      const deptStats = new Map<string, { revenue: number; directCosts: number; headcount: number; billableHours: number }>();

      for (const dept of activeDepts) {
        const dMembers = activeEmployeeMembers.filter((m: any) => {
          const resolved = matchDepartmentId(m.department_id || m.departmentId) || matchDepartmentId(m.department);
          return resolved === dept.id;
        });
        for (const m of dMembers) {
          const uid = String(m.user_id || m.userId || m.id || '');
          if (uid) userDeptMap.set(uid, dept.id);
        }
        deptStats.set(dept.id, { revenue: 0, directCosts: 0, headcount: dMembers.length, billableHours: 0 });
      }

      const projectMap = new Map<string, any>();
      for (const p of (projects || [])) projectMap.set(String(p.id), p);

      const scheduleDeptEngine = computeOrgProjectsProfitability({
        projects: projects || [],
        transactions: txns || [],
        members: members || [],
        departments: activeDepts,
        overheadAllocations: allocRows || [],
        orgCurrency,
        fromDate: dateFrom,
        toDate: dateTo,
      });

      const projectDeptHours = new Map<string, Map<string, number>>();
      for (const [pid, dMap] of scheduleDeptEngine.projectDeptScheduledHours.entries()) {
        const resolvedMap = new Map<string, number>();
        for (const [rawDeptId, hrs] of dMap.entries()) {
          const deptId = matchDepartmentId(rawDeptId) || rawDeptId;
          if (deptId && deptStats.has(deptId) && hrs > 0) {
            deptStats.get(deptId)!.billableHours = Math.round((deptStats.get(deptId)!.billableHours + hrs) * 10) / 10;
            resolvedMap.set(deptId, (resolvedMap.get(deptId) || 0) + hrs);
          }
        }
        if (resolvedMap.size > 0) projectDeptHours.set(pid, resolvedMap);
      }


      const catMap = new Map<string, string>();
      for (const c of (categories || [])) {
        if (c.id && c.name) catMap.set(String(c.id), String(c.name).toLowerCase());
      }
      const inferDeptFromCategory = (catId?: string | null): string | null => {
        if (!catId) return null;
        const cName = catMap.get(String(catId)) || '';
        if (!cName) return null;
        for (const dept of activeDepts) {
          const dName = String(dept.name || '').toLowerCase();
          if (dName.includes('development') && (cName.includes('software') || cName.includes('tools') || cName.includes('cloud') || cName.includes('saas') || cName.includes('dev') || cName.includes('hosting') || cName.includes('api') || cName.includes('tech'))) {
            return dept.id;
          }
          if (dName.includes('marketing') && (cName.includes('marketing') || cName.includes('advertising') || cName.includes('ads') || cName.includes('promo') || cName.includes('campaign') || cName.includes('seo') || cName.includes('social'))) {
            return dept.id;
          }
        }
        return null;
      };

      const periodTxns = (txns || []).filter((t: any) => {
        if (dateFrom && t.date && t.date < dateFrom) return false;
        if (dateTo && t.date && t.date > dateTo) return false;
        return true;
      });

      for (const t of periodTxns) {
        const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
        if (tags.includes('transfer')) continue;
        const rawAmt = Math.abs(Number(t.amount || 0));
        const rawCurr = String((t as any).currency || orgCurrency).toUpperCase().trim();
        let fxRate: number | undefined = (t as any).fx_rate_to_base ? Number((t as any).fx_rate_to_base) : undefined;
        if (!fxRate && tags.length > 0) {
          const rTag = tags.find((tag: string) => tag.startsWith('fx:rate:'));
          if (rTag) fxRate = Number(rTag.slice(8));
        }
        const amount =
          (t as any).base_amount != null && Number((t as any).base_amount) > 0 && String((t as any).base_currency || orgCurrency).toUpperCase() === orgCurrency
            ? Number((t as any).base_amount)
            : convertCurrency(rawAmt, rawCurr, orgCurrency, fxRate);
        if (amount <= 0) continue;

        const desc = String(t.description || '').toLowerCase();
        const narr = String(t.narration || '').toLowerCase();
        if (t.type === 'debit' && (desc.includes('loan repayment') || (narr.includes('monthly installment') && narr.includes('loan')))) {
          continue;
        }

        const explicitDeptId = matchDepartmentId(t.department_id || t.departmentId);
        const projId = String(t.project_id || t.projectId || '');
        const proj = projId ? projectMap.get(projId) : null;
        const projDeptId = proj ? matchDepartmentId(proj.department_id || proj.departmentId) : null;

        if (t.type === 'credit') {
          const pHoursMap = projId ? projectDeptHours.get(projId) : undefined;
          const totalProjHours = pHoursMap ? Array.from(pHoursMap.values()).reduce((s, h) => s + h, 0) : 0;
          if (projId && pHoursMap && totalProjHours > 0) {
            for (const [dId, hrs] of pHoursMap.entries()) {
              const stat = deptStats.get(dId);
              if (stat) stat.revenue += amount * (hrs / totalProjHours);
            }
          } else {
            const targetDeptId = explicitDeptId || projDeptId || inferCreditDepartmentId(t);
            if (targetDeptId && deptStats.has(targetDeptId)) {
              deptStats.get(targetDeptId)!.revenue += amount;
            }
          }
        } else {
          const allocTags = tags.filter(tag => tag.startsWith('payslip_alloc:'));
          let allocatedSum = 0;
          for (const aTag of allocTags) {
            const parts = aTag.split(':');
            const tagUserId = parts[2] || '';
            const tagDeptRaw = parts[3] || '';
            const tagGross = Number(parts[4] || 0);
            if (tagGross <= 0) continue;
            const resolvedDeptId = matchDepartmentId(tagDeptRaw) || userDeptMap.get(tagUserId) || explicitDeptId || projDeptId;
            const effectiveAlloc = Math.min(tagGross, Math.max(0, amount - allocatedSum));
            if (effectiveAlloc > 0 && resolvedDeptId && deptStats.has(resolvedDeptId)) {
              deptStats.get(resolvedDeptId)!.directCosts += effectiveAlloc;
              allocatedSum += effectiveAlloc;
            }
          }
          const unallocatedRemainder = Math.max(0, amount - allocatedSum);
          if (unallocatedRemainder > 0) {
            const targetDeptId = explicitDeptId || projDeptId || inferDeptFromCategory(t.category_id || t.categoryId);
            if (targetDeptId && deptStats.has(targetDeptId)) {
              deptStats.get(targetDeptId)!.directCosts += unallocatedRemainder;
            }
          }
        }
      }

      const result = activeDepts.map((dept: any) => {
        const st = deptStats.get(dept.id) || { revenue: 0, directCosts: 0, headcount: 0, billableHours: 0 };
        const revenue = Math.round(st.revenue * 100) / 100;
        const directCosts = Math.round(st.directCosts * 100) / 100;
        const allocatedOverhead = Math.round((totalOverhead / deptCount) * 100) / 100;
        const totalCost = directCosts + allocatedOverhead;
        const netProfit = Math.round((revenue - totalCost) * 100) / 100;
        const profitMargin = revenue > 0 ? Math.round(((revenue - totalCost) / revenue) * 1000) / 10 : null;
        const headcount = st.headcount;
        const capacityHours = headcount > 0 ? headcount * 160 : null;
        let costPerHour: number | null = null;
        let costPerMinute: number | null = null;
        if (capacityHours != null && capacityHours > 0 && totalCost > 0) {
          costPerHour = Math.round((totalCost / capacityHours) * 100) / 100;
          costPerMinute = Math.round((totalCost / capacityHours / 60) * 10000) / 10000;
        }
        const productiveHours = st.billableHours > 0 ? st.billableHours : null;
        let productiveCostPerHour: number | null = null;
        let productiveCostPerMinute: number | null = null;
        if (productiveHours != null && productiveHours > 0 && totalCost > 0) {
          productiveCostPerHour = Math.round((totalCost / productiveHours) * 100) / 100;
          productiveCostPerMinute = Math.round((totalCost / productiveHours / 60) * 10000) / 10000;
        }
        const revenuePerHead = headcount > 0 ? Math.round((revenue / headcount) * 100) / 100 : null;

        return {
          departmentId: dept.id,
          departmentName: dept.name,
          revenue,
          directCosts,
          allocatedOverhead,
          netProfit,
          profitMargin,
          headcount,
          revenuePerHead,
          costPerHour,
          costPerMinute,
          productiveHours,
          productiveCostPerHour,
          productiveCostPerMinute,
          capacityBasis: 'fte_160h',
          overheadSource: totalOverhead > 0 ? 'declared_pools' : 'none',
          totalHours: capacityHours,
          billableHours: st.billableHours,
          utilization: (capacityHours != null && capacityHours > 0 && st.billableHours > 0) ? Math.round((st.billableHours / capacityHours) * 1000) / 10 : null,
        };
      });

      return ok(res, result);
    } catch (directErr) {
      console.error('[reports.department-profitability] direct calculation error:', directErr);
    }

    ok(res, []);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 — Reconciliation Summary & Equations Engine
  // ═══════════════════════════════════════════════════════════════════════════
  r.get('/reconciliation-summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const [
        { data: bankAccounts },
        { data: txns },
        { data: assets },
        { data: inventoryItems },
        { data: invLayerRows },
        { data: loans },
        { data: overheadRows },
      ] = await Promise.all([
        sb.from('bank_accounts').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('assets').select('*').eq('organization_id', orgId),
        sb.from('inventory_items').select('*').eq('organization_id', orgId).eq('is_active', true),
        sb.from('inventory_layers').select('inventory_item_id, quantity_remaining, unit_cost').eq('organization_id', orgId).gt('quantity_remaining', 0),
        sb.from('loans').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
      ]);

      const allTxns = txns || [];
      const nonTransferTxns = allTxns.filter(t => !t.tags?.includes('transfer') && t.type !== 'transfer');

      // 1. Balance Sheet Equation: Assets = Liabilities + Equity
      let totalBankAssets = 0;
      let totalLiabilities = 0;

      for (const ba of (bankAccounts || [])) {
        const bal = Number(ba.balance || 0);
        if (['credit_card', 'line_of_credit'].includes(ba.account_type)) {
          totalLiabilities += Math.abs(bal);
        } else {
          totalBankAssets += bal;
        }
      }

      const reconLayerMap = buildInventoryLayerMap(invLayerRows ?? []);
      const totalInventoryValuation = (inventoryItems || []).reduce(
        (sum, item) => sum + computeFifoAwareInventoryValue(item, reconLayerMap), 0
      );

      const totalFixedAssets = (assets || []).reduce((sum, a) => {
        if (a.status === 'disposed') return sum;
        const basis = Number(a.cost_basis || a.purchase_price || 0);
        const depr = Number(a.accumulated_depreciation || 0);
        return sum + Math.max(0, basis - depr);
      }, 0);

      const totalLoanReceivables = (loans || [])
        .filter(l => l.type === 'to_receive' && l.status !== 'paid')
        .reduce((sum, l) => sum + Number(l.remaining_balance || l.principal || 0), 0);

      const totalLoanPayables = (loans || [])
        .filter(l => l.type === 'to_pay' && l.status !== 'paid')
        .reduce((sum, l) => sum + Number(l.remaining_balance || l.principal || 0), 0);

      totalLiabilities += totalLoanPayables;
      const totalAssets = Math.round((totalBankAssets + totalInventoryValuation + totalFixedAssets + totalLoanReceivables) * 100) / 100;
      const totalLiabilitiesRounded = Math.round(totalLiabilities * 100) / 100;
      const totalEquity = Math.round((totalAssets - totalLiabilitiesRounded) * 100) / 100;

      const bsDiscrepancy = Math.round(Math.abs(totalAssets - (totalLiabilitiesRounded + totalEquity)) * 100) / 100;

      // 2. Journal Balance Invariant
      let totalDebits = 0;
      let totalCredits = 0;
      for (const t of allTxns) {
        const amt = Math.abs(Number(t.amount || 0));
        if (t.type === 'credit') totalCredits += amt;
        else totalDebits += amt;
      }
      totalDebits = Math.round(totalDebits * 100) / 100;
      totalCredits = Math.round(totalCredits * 100) / 100;
      const journalDiff = Math.round(Math.abs(totalDebits - totalCredits) * 100) / 100;

      // 3. Cash Flow Movement Reconciliation: Opening Cash + Net Movement = Closing Cash
      let totalInflows = 0;
      let totalOutflows = 0;
      for (const t of nonTransferTxns) {
        const amt = Math.abs(Number(t.amount || 0));
        if (t.type === 'credit') totalInflows += amt;
        else totalOutflows += amt;
      }
      const netCashMovement = Math.round((totalInflows - totalOutflows) * 100) / 100;
      const actualBankClosingCash = Math.round(totalBankAssets * 100) / 100;

      // 4. Differences between Cash Flow, Revenue, Booked Profit and Management Profitability
      let bookedRevenue = 0;
      let directCosts = 0;
      let operatingCosts = 0;

      for (const t of nonTransferTxns) {
        const amt = Math.abs(Number(t.amount || 0));
        const tags: string[] = Array.isArray(t.tags) ? t.tags : [];
        if (t.type === 'credit') {
          bookedRevenue += amt;
        } else {
          if (tags.includes('loan-principal') || tags.includes('liability-reduction')) {
            // Excluded from OpEx — this is financing cash outflow reducing liability
            continue;
          }
          if (tags.includes('inventory-purchase') || tags.includes('direct-cost') || Boolean(t.project_id)) {
            directCosts += amt;
          } else {
            operatingCosts += amt;
          }
        }
      }

      bookedRevenue = Math.round(bookedRevenue * 100) / 100;
      const bookedNetIncome = Math.round((bookedRevenue - directCosts - operatingCosts) * 100) / 100;

      const totalOverheadPools = (overheadRows || []).reduce((sum, o) => sum + Number(o.amount || 0), 0);
      const managementProfitability = Math.round((bookedNetIncome - totalOverheadPools) * 100) / 100;

      const explanation = `Differences Explained:
1. Cash Flow Net (${netCashMovement.toFixed(2)}) reflects actual money entering and leaving bank accounts, including loan principal financing movements.
2. Booked Revenue (${bookedRevenue.toFixed(2)}) captures recognized operating sales in the period.
3. Booked P&L Profit (${bookedNetIncome.toFixed(2)}) excludes financing loan principal repayments (${(allTxns.filter(t => t.tags?.includes('loan-principal')).reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0)).toFixed(2)}) and deducts recognized operating & inventory costs.
4. Management Profitability (${managementProfitability.toFixed(2)}) further adjusts booked profit for declared overhead pools (${totalOverheadPools.toFixed(2)}) and departmental capacity burdens.`;

      // Log reconciliation
      try {
        await sb.from('reconciliation_logs').insert({
          id: `recon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          organization_id: orgId,
          reconciliation_type: 'balance_sheet',
          status: bsDiscrepancy < 0.05 ? 'balanced' : 'variance_detected',
          discrepancy_amount: bsDiscrepancy,
          details: {
            assets: totalAssets,
            liabilities: totalLiabilitiesRounded,
            equity: totalEquity,
            netCashMovement,
            bookedRevenue,
            bookedNetIncome,
            managementProfitability,
          },
        });
      } catch {
        // Non-fatal
      }

      // Compute authoritative double-entry journal_lines balance & real cash flow reconciliation (§15, §33 #8)
      const { data: glLines } = await sb
        .from('journal_lines')
        .select('base_debit, base_credit, debit, credit')
        .eq('organization_id', orgId);

      const glTotalDebits = Math.round(
        (glLines || []).reduce((s: number, l: any) => s + Number(l.base_debit ?? l.debit ?? 0), 0) * 100
      ) / 100;
      const glTotalCredits = Math.round(
        (glLines || []).reduce((s: number, l: any) => s + Number(l.base_credit ?? l.credit ?? 0), 0) * 100
      ) / 100;
      const glDiff = Math.round(Math.abs(glTotalDebits - glTotalCredits) * 100) / 100;
      const hasGlLines = (glLines || []).length > 0;
      const effectiveJournalDebits = hasGlLines ? glTotalDebits : totalDebits;
      const effectiveJournalCredits = hasGlLines ? glTotalCredits : totalCredits;
      const effectiveJournalDiff = hasGlLines ? glDiff : journalDiff;

      const openingBankCash = Math.round(
        (bankAccounts || []).reduce((s: number, b: any) => s + Number(b.opening_balance || 0), 0) * 100
      ) / 100;
      const expectedClosingCash = Math.round((openingBankCash + netCashMovement) * 100) / 100;
      const cashDiscrepancy = Math.round((actualBankClosingCash - expectedClosingCash) * 100) / 100;

      return ok(res, {
        checkedAt: new Date().toISOString(),
        balanceSheetEquation: {
          assets: totalAssets,
          liabilities: totalLiabilitiesRounded,
          equity: totalEquity,
          isBalanced: bsDiscrepancy < 0.05,
          discrepancy: bsDiscrepancy,
        },
        journalBalance: {
          source: hasGlLines ? 'journal_lines' : 'transactions_fallback',
          totalDebits: effectiveJournalDebits,
          totalCredits: effectiveJournalCredits,
          isBalanced: hasGlLines ? effectiveJournalDiff < 0.05 : effectiveJournalDiff < 0.05,
          discrepancy: effectiveJournalDiff,
        },
        cashFlowReconciliation: {
          openingBankCash,
          netCashMovement,
          expectedClosingCash,
          actualBankClosingCash,
          isBalanced: Math.abs(cashDiscrepancy) < 1,
          discrepancy: cashDiscrepancy,
        },
        profitMeasuresExplanation: {
          cashFlowNet: netCashMovement,
          accruedRevenue: bookedRevenue,
          bookedNetIncome,
          managementProfitability,
          explanation,
        },
      });
    } catch (err: any) {
      console.error('[reports.reconciliation-summary] error:', err);
      return fail(res, 500, err?.message || 'Failed to calculate reconciliation summary');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 — Client Profitability
  // ═══════════════════════════════════════════════════════════════════════════
  r.get('/profitability/clients', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    try {
      // §12.5 & §15 Client Profitability Parity with Schedule-Driven Project Costing Engine
      const [
        { data: projects },
        { data: txns },
        { data: members },
        { data: departments },
        { data: overheadData },
        { data: teamsData },
        { data: teamMembersData },
        { data: orgRow },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('agency_teams').select('*').eq('organization_id', orgId),
        sb.from('agency_team_members').select('*').eq('organization_id', orgId),
        sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
      ]);

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      const engineResult = computeOrgProjectsProfitability({
        projects: projects || [],
        transactions: txns || [],
        members: members || [],
        departments: departments || [],
        overheadAllocations: overheadData || [],
        agencyTeams: teamsData || [],
        agencyTeamMembers: teamMembersData || [],
        orgCurrency,
      });

      interface ClientAccumulator {
        clientName: string;
        revenue: number;
        directCosts: number;
        laborCosts: number;
        assignedOverhead: number;
        projectCount: number;
        projectIds: Set<string>;
      }

      const clientMap = new Map<string, ClientAccumulator>();

      for (const p of engineResult.projects) {
        const cName = p.clientName || 'General Clients';
        if (!clientMap.has(cName)) {
          clientMap.set(cName, {
            clientName: cName,
            revenue: 0,
            directCosts: 0,
            laborCosts: 0,
            assignedOverhead: 0,
            projectCount: 0,
            projectIds: new Set(),
          });
        }
        const stat = clientMap.get(cName)!;
        stat.projectCount++;
        stat.projectIds.add(p.projectId);

        const rev = convertCurrency(p.revenue > 0 ? p.revenue : p.quotedAmount, p.currency, orgCurrency);
        stat.revenue += rev;
        stat.directCosts += convertCurrency(p.initialBaselineCost + p.directCost, p.currency, orgCurrency);
        stat.laborCosts += convertCurrency(p.laborCost, p.currency, orgCurrency);
        stat.assignedOverhead += convertCurrency(p.assignedOverhead, p.currency, orgCurrency);
      }

      const clientList = Array.from(clientMap.values()).map(c => {
        const totalCost = Math.round((c.directCosts + c.laborCosts + c.assignedOverhead) * 100) / 100;
        const netProfit = Math.round((c.revenue - totalCost) * 100) / 100;
        const marginPct = c.revenue > 0 ? Math.round(((netProfit / c.revenue) * 100) * 10) / 10 : 0;
        return {
          clientName: c.clientName,
          revenue: Math.round(c.revenue * 100) / 100,
          directCosts: Math.round(c.directCosts * 100) / 100,
          laborCosts: Math.round(c.laborCosts * 100) / 100,
          assignedOverhead: Math.round(c.assignedOverhead * 100) / 100,
          totalCost,
          cost: totalCost,
          netProfit,
          profitMarginPercent: marginPct,
          projectCount: c.projectCount,
        };
      });

      return ok(res, clientList);
    } catch (err: any) {
      console.error('[reports.profitability.clients] error:', err);
      return fail(res, 500, err?.message || 'Failed to calculate client profitability');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 — Versioned Report Snapshots & Downloads
  // ═══════════════════════════════════════════════════════════════════════════
  r.get('/snapshots', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    const { reportType } = req.query as { reportType?: string };
    let q = sb.from('report_snapshots').select('*').eq('organization_id', orgId);
    if (reportType) q = q.eq('report_type', reportType);

    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) return fail(res, 500, error.message);

    return ok(res, (data || []).map(row => ({
      id: row.id,
      organizationId: row.organization_id,
      reportType: row.report_type,
      title: row.title,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      accountingBasis: row.accounting_basis,
      snapshotData: row.snapshot_data,
      createdBy: row.created_by,
      version: row.version,
      createdAt: row.created_at,
    })));
  });

  r.post('/snapshots', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    const { reportType, title, periodStart, periodEnd, accountingBasis = 'accrual', snapshotData } = req.body;
    if (!reportType || !title || !snapshotData) {
      return fail(res, 400, 'reportType, title, and snapshotData are required');
    }

    const { data: existing } = await sb
      .from('report_snapshots')
      .select('version')
      .eq('organization_id', orgId)
      .eq('report_type', reportType)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = existing && existing.length > 0 ? (existing[0].version || 1) + 1 : 1;
    const snapshotId = `snap-${reportType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const newSnapshot = {
      id: snapshotId,
      organization_id: orgId,
      report_type: reportType,
      title: title.trim(),
      period_start: periodStart || null,
      period_end: periodEnd || null,
      accounting_basis: accountingBasis,
      snapshotData,
      created_by: (req as any).user?.name || (req as any).user?.email || 'admin',
      version: nextVersion,
      created_at: new Date().toISOString(),
    };

    const { error: insErr } = await sb.from('report_snapshots').insert([{
      id: snapshotId,
      organization_id: orgId,
      report_type: reportType,
      title: title.trim(),
      period_start: periodStart || null,
      period_end: periodEnd || null,
      accounting_basis: accountingBasis,
      snapshot_data: snapshotData,
      created_by: newSnapshot.created_by,
      version: nextVersion,
      created_at: newSnapshot.created_at,
    }]);

    if (insErr) return fail(res, 500, insErr.message);
    return created(res, newSnapshot, `Report snapshot created (v${nextVersion})`);
  });

  r.get('/snapshots/:id/download', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    const { data, error } = await sb
      .from('report_snapshots')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error || !data) return notFound(res, 'Snapshot');

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'download_report_snapshot',
      entityType: 'report_snapshot',
      entityId: String(data.id),
      description: `Downloaded report snapshot ${data.report_type} v${data.version}`,
    }).catch(() => {});

    const format = String(req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      const payload = data.snapshot_data;
      const rows: Record<string, any>[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.rows)
          ? payload.rows
          : [typeof payload === 'object' && payload ? payload : { value: payload }];
      const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csvLines = [
        headers.map(esc).join(','),
        ...rows.map((row) => headers.map((h) => esc(typeof row?.[h] === 'object' ? JSON.stringify(row[h]) : row?.[h])).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-snapshot-${data.report_type}-v${data.version}.csv"`);
      return res.status(200).send(csvLines.join('\n'));
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="report-snapshot-${data.report_type}-v${data.version}.json"`);
    return res.status(200).send(JSON.stringify(data.snapshot_data, null, 2));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 — Core Accounting Reports: Trial Balance, General Ledger, Aging, Tax
  // ═══════════════════════════════════════════════════════════════════════════

  r.get('/trial-balance', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const asOf = String(req.query.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const [{ data: accounts }, { data: entries }, { data: lines }, { data: orgRow }] = await Promise.all([
        sb.from('accounts').select('id, code, name, type, subtype').eq('organization_id', orgId),
        sb.from('journal_entries').select('id, entry_date, status').eq('organization_id', orgId).eq('status', 'posted').lte('entry_date', asOf),
        sb.from('journal_lines').select('journal_entry_id, account_id, debit, credit, base_debit, base_credit').eq('organization_id', orgId),
        sb.from('organizations').select('base_currency, currency').eq('id', orgId).maybeSingle(),
      ]);

      const validEntryIds = new Set((entries || []).map((e: any) => String(e.id)));
      const acctMap = new Map((accounts || []).map((a: any) => [String(a.id), a]));
      const totalsByAccount = new Map<string, { debit: number; credit: number }>();

      for (const l of lines || []) {
        if (!validEntryIds.has(String(l.journal_entry_id))) continue;
        const aId = String(l.account_id);
        const cur = totalsByAccount.get(aId) || { debit: 0, credit: 0 };
        cur.debit += Number(l.base_debit ?? l.debit ?? 0);
        cur.credit += Number(l.base_credit ?? l.credit ?? 0);
        totalsByAccount.set(aId, cur);
      }

      const rows = Array.from(totalsByAccount.entries())
        .map(([accountId, agg]) => {
          const acct = acctMap.get(accountId);
          const debit = Math.round(agg.debit * 100) / 100;
          const credit = Math.round(agg.credit * 100) / 100;
          return {
            accountId,
            code: acct?.code || '',
            name: acct?.name || accountId,
            type: acct?.type || 'unknown',
            subtype: acct?.subtype || '',
            debit,
            credit,
            netBalance: Math.round((debit - credit) * 100) / 100,
          };
        })
        .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));

      const totalDebits = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
      const totalCredits = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
      const discrepancy = Math.round(Math.abs(totalDebits - totalCredits) * 100) / 100;

      return ok(res, {
        asOf,
        baseCurrency: String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase(),
        rows,
        totalDebits,
        totalCredits,
        discrepancy,
        isBalanced: discrepancy < 0.05,
      });
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to compute trial balance');
    }
  });

  r.get('/general-ledger', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const startDate = req.query.startDate ? String(req.query.startDate).slice(0, 10) : null;
    const endDate = req.query.endDate ? String(req.query.endDate).slice(0, 10) : null;
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    const limit = Math.min(500, Math.max(10, Number(req.query.limit || 200)));
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      let jeQuery = sb
        .from('journal_entries')
        .select('*')
        .eq('organization_id', orgId)
        .order('entry_date', { ascending: false })
        .limit(limit);
      if (startDate) jeQuery = jeQuery.gte('entry_date', startDate);
      if (endDate) jeQuery = jeQuery.lte('entry_date', endDate);

      const [{ data: entries, error: jeErr }, { data: accounts }] = await Promise.all([
        jeQuery,
        sb.from('accounts').select('id, code, name, type').eq('organization_id', orgId),
      ]);
      if (jeErr) return fail(res, 500, jeErr.message);

      const entryIds = (entries || []).map((e: any) => e.id);
      let lineRows: any[] = [];
      if (entryIds.length > 0) {
        let lineQ = sb
          .from('journal_lines')
          .select('*')
          .eq('organization_id', orgId)
          .in('journal_entry_id', entryIds);
        if (accountId) lineQ = lineQ.eq('account_id', accountId);
        const { data: lines } = await lineQ;
        lineRows = lines || [];
      }

      const acctMap = new Map((accounts || []).map((a: any) => [String(a.id), a]));
      const linesByJe = new Map<string, any[]>();
      for (const l of lineRows) {
        const jId = String(l.journal_entry_id);
        if (!linesByJe.has(jId)) linesByJe.set(jId, []);
        const acct = acctMap.get(String(l.account_id));
        linesByJe.get(jId)!.push({
          ...l,
          accountCode: acct?.code || '',
          accountName: acct?.name || l.account_id,
          accountType: acct?.type || '',
        });
      }

      const ledgerEntries = (entries || [])
        .map((e: any) => ({
          ...e,
          lines: linesByJe.get(String(e.id)) || [],
        }))
        .filter((e: any) => !accountId || e.lines.length > 0);

      return ok(res, {
        startDate,
        endDate,
        accountId,
        count: ledgerEntries.length,
        entries: ledgerEntries,
      });
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to fetch general ledger');
    }
  });

  r.get('/aging', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const asOfStr = String(req.query.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const asOfMs = new Date(`${asOfStr}T00:00:00Z`).getTime();
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const [{ data: invoices }, { data: loans }, { data: orgRow }] = await Promise.all([
        sb.from('invoices').select('*').eq('organization_id', orgId),
        sb.from('loans').select('*').eq('organization_id', orgId).neq('status', 'paid'),
        sb.from('organizations').select('base_currency, currency').eq('id', orgId).maybeSingle(),
      ]);

      const baseCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      const emptyBuckets = () => ({ current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, total: 0 });
      const arBuckets = emptyBuckets();
      const apBuckets = emptyBuckets();

      const addToBucket = (buckets: ReturnType<typeof emptyBuckets>, dueDateStr: string | null | undefined, amt: number) => {
        if (amt <= 0) return;
        const dueMs = dueDateStr ? new Date(`${String(dueDateStr).slice(0, 10)}T00:00:00Z`).getTime() : asOfMs;
        const daysPastDue = Number.isFinite(dueMs) ? Math.floor((asOfMs - dueMs) / 86_400_000) : 0;
        if (daysPastDue <= 0) buckets.current += amt;
        else if (daysPastDue <= 30) buckets.days_1_30 += amt;
        else if (daysPastDue <= 60) buckets.days_31_60 += amt;
        else if (daysPastDue <= 90) buckets.days_61_90 += amt;
        else buckets.days_90_plus += amt;
        buckets.total += amt;
      };

      const arItems: any[] = [];
      for (const inv of invoices || []) {
        const status = String(inv.status || '').toLowerCase();
        if (['paid', 'cancelled', 'void', 'draft'].includes(status)) continue;
        const total = Number(inv.total_amount ?? inv.total ?? inv.amount ?? 0);
        const paid = Number(inv.amount_paid ?? inv.paid_amount ?? 0);
        const openAmt = Math.max(0, total - paid);
        if (openAmt <= 0) continue;
        const convAmt = Math.round(convertCurrency(openAmt, String(inv.currency || baseCurrency), baseCurrency) * 100) / 100;
        addToBucket(arBuckets, inv.due_date || inv.issue_date, convAmt);
        arItems.push({
          id: inv.id,
          invoiceNumber: inv.invoice_number || inv.id,
          clientName: inv.client_name || 'Client',
          dueDate: inv.due_date || null,
          openAmount: convAmt,
          status,
        });
      }

      const apItems: any[] = [];
      for (const loan of loans || []) {
        const rem = Number(loan.remaining_balance ?? loan.principal ?? 0);
        if (rem <= 0) continue;
        const convAmt = Math.round(convertCurrency(rem, String(loan.currency || baseCurrency), baseCurrency) * 100) / 100;
        if (loan.type === 'to_receive') {
          addToBucket(arBuckets, loan.next_payment_date || loan.due_date, convAmt);
        } else {
          addToBucket(apBuckets, loan.next_payment_date || loan.due_date, convAmt);
          apItems.push({
            id: loan.id,
            party: loan.party || 'Lender',
            dueDate: loan.next_payment_date || loan.due_date || null,
            openAmount: convAmt,
            status: loan.status,
          });
        }
      }

      const roundBuckets = (b: ReturnType<typeof emptyBuckets>) => ({
        current: Math.round(b.current * 100) / 100,
        days_1_30: Math.round(b.days_1_30 * 100) / 100,
        days_31_60: Math.round(b.days_31_60 * 100) / 100,
        days_61_90: Math.round(b.days_61_90 * 100) / 100,
        days_90_plus: Math.round(b.days_90_plus * 100) / 100,
        total: Math.round(b.total * 100) / 100,
      });

      return ok(res, {
        asOf: asOfStr,
        baseCurrency,
        receivables: { buckets: roundBuckets(arBuckets), items: arItems },
        payables: { buckets: roundBuckets(apBuckets), items: apItems },
      });
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to compute AR/AP aging report');
    }
  });

  r.get('/tax-summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const startDate = req.query.startDate ? String(req.query.startDate).slice(0, 10) : null;
    const endDate = req.query.endDate ? String(req.query.endDate).slice(0, 10) : null;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      let txnQ = sb.from('transactions').select('*').eq('organization_id', orgId);
      if (startDate) txnQ = txnQ.gte('date', startDate);
      if (endDate) txnQ = txnQ.lte('date', endDate);

      const [{ data: txns }, { data: invoices }, { data: categories }, { data: orgRow }] = await Promise.all([
        txnQ,
        sb.from('invoices').select('*').eq('organization_id', orgId),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('organizations').select('base_currency, currency').eq('id', orgId).maybeSingle(),
      ]);

      const baseCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      const catMap = new Map((categories || []).map((c: any) => [String(c.id), String(c.name || '')]));

      let taxPaidExpenses = 0;
      const taxExpenseItems: any[] = [];
      for (const t of txns || []) {
        const status = String(t.status || 'posted').toLowerCase();
        if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) continue;
        if (t.type !== 'debit') continue;
        const catName = (t.category_id ? catMap.get(String(t.category_id)) || '' : '').toLowerCase();
        const desc = `${t.description || ''} ${t.narration || ''}`.toLowerCase();
        if (catName.includes('tax') || desc.includes('tax') || desc.includes('vat') || desc.includes('gst') || desc.includes('withholding')) {
          const amt = Math.abs(convertCurrency(Number(t.base_amount ?? t.amount ?? 0), String(t.currency || baseCurrency), baseCurrency));
          taxPaidExpenses += amt;
          taxExpenseItems.push({ id: t.id, date: t.date, description: t.description || t.narration, category: catName || 'Taxes', amount: Math.round(amt * 100) / 100 });
        }
      }

      let outputTaxCollected = 0;
      for (const inv of invoices || []) {
        const status = String(inv.status || '').toLowerCase();
        if (['draft', 'cancelled', 'void'].includes(status)) continue;
        const invDate = String(inv.issue_date || inv.created_at || '').slice(0, 10);
        if (startDate && invDate && invDate < startDate) continue;
        if (endDate && invDate && invDate > endDate) continue;
        const taxAmt = Number(inv.tax_amount ?? inv.tax ?? 0);
        if (taxAmt > 0) {
          outputTaxCollected += convertCurrency(taxAmt, String(inv.currency || baseCurrency), baseCurrency);
        }
      }

      return ok(res, {
        startDate,
        endDate,
        baseCurrency,
        outputTaxCollected: Math.round(outputTaxCollected * 100) / 100,
        taxPaidExpenses: Math.round(taxPaidExpenses * 100) / 100,
        netTaxPosition: Math.round((outputTaxCollected - taxPaidExpenses) * 100) / 100,
        taxExpenseCount: taxExpenseItems.length,
        taxExpenseItems: taxExpenseItems.slice(0, 100),
      });
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to compute tax summary');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 — Classification Accuracy, Overrides & Audit History
  // ═══════════════════════════════════════════════════════════════════════════
  r.get('/governance/audit-history', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const [{ data: rules }, { data: txns }] = await Promise.all([
        sb.from('classification_rules').select('*').eq('organization_id', orgId),
        sb.from('transactions').select('status, tags, narration').eq('organization_id', orgId),
      ]);

      const allTxns = txns || [];
      const totalTxns = allTxns.length;
      const autoApproved = allTxns.filter(t => t.tags?.includes('auto-approved')).length;
      const manuallyClassified = allTxns.filter(t => t.tags?.includes('manual-review') || t.tags?.includes('user-override')).length;
      const pendingReview = allTxns.filter(t => t.status === 'pending').length;

      const accuracyPct = (autoApproved + manuallyClassified) > 0
        ? Math.round((autoApproved / (autoApproved + manuallyClassified)) * 1000) / 10
        : 0;

      return ok(res, {
        totalRules: (rules || []).length,
        totalTransactionsEvaluated: totalTxns,
        autoApprovedCount: autoApproved,
        manualOverridesCount: manuallyClassified,
        pendingReviewCount: pendingReview,
        classificationAccuracyPercent: accuracyPct,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[reports.governance.audit-history] error:', err);
      return fail(res, 500, err?.message || 'Failed to fetch governance audit history');
    }
  });

  return r;
}