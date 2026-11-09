import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  FileText, 
  Download, 
  TrendingUp, 
  TrendingDown,
  DollarSign, 
  Calendar,
  Percent,
  Building2,
  PieChart,
  FileSpreadsheet,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  RefreshCw,
  ChevronRight,
  CircleDollarSign,
  Scale,
  Wallet,
  Users
} from 'lucide-react';
import { BarChart, Bar, LineChart, Line, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { toast } from 'sonner';
import { AXIOM } from '../../../styles/axiom-tokens';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';
import { getReportService } from '@/services/reportService';
import type { DepartmentProfitability, ProfitLossReport, BalanceSheetReport, CashFlowReport } from '@/services/types';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { exportToQuickBooks } from '@/lib/exportUtils';
import { useAuth } from '@/contexts/AuthContext';
import { convertCurrency } from '@/lib/currencyUtils';

// NO HARDCODED DATA - Everything fetched from API

const COLORS = {
  purple: '#a855f7',
  cyan: '#06b6d4',
  pink: '#ec4899',
  green: '#10b981',
  amber: '#f59e0b',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f97316'
};

function escapeCsvCell(v: string | number): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatPeriodLabel(period: any, fallbackFrom?: string, fallbackTo?: string): string {
  if (typeof period === 'string' && period.trim() && !period.includes('[object')) {
    return period;
  }
  if (period && typeof period === 'object') {
    const f = period.from || period.startDate || fallbackFrom;
    const t = period.to || period.endDate || fallbackTo;
    if (f && t) return `${formatDate(f)} to ${formatDate(t)}`;
  }
  if (fallbackFrom && fallbackTo) {
    return `${formatDate(fallbackFrom)} to ${formatDate(fallbackTo)}`;
  }
  return 'All Time';
}

function profitLossToCsv(pl: ProfitLossReport): string {
  const rows: (string | number)[][] = [
    ['Report', 'Profit & Loss'],
    ['Period', formatPeriodLabel(pl.period)],
    [],
    ['REVENUE'],
    ...pl.revenue.map((r) => [r.name, r.amount]),
    ['Total revenue', pl.totalRevenue],
    [],
    ['COST OF GOODS SOLD'],
    ...pl.cogs.map((r) => [r.name, r.amount]),
    ['Total COGS', pl.totalCOGS],
    ['Gross profit', pl.grossProfit],
    [],
    ['OPERATING EXPENSES'],
    ...pl.operatingExpenses.map((r) => [r.name, r.amount]),
    ['Total operating expenses', pl.totalOperatingExpenses],
    [],
    ['Operating income', pl.operatingIncome],
    ['Net income', pl.netIncome],
  ];
  return rowsToCsv(rows);
}

function departmentsToCsv(depts: DepartmentProfitability[]): string {
  const rows: (string | number)[][] = [
    ['Department', 'Revenue', 'Direct costs', 'Overhead', 'Net profit', 'Margin %', 'Headcount'],
    ...depts.map((d) => [
      d.departmentName,
      d.revenue,
      d.directCosts,
      d.allocatedOverhead,
      d.netProfit,
      d.profitMargin != null ? Math.round(d.profitMargin * 10) / 10 : '',
      d.headcount,
    ]),
  ];
  return rowsToCsv(rows);
}

type ReportView = 'overview' | 'pl' | 'balance' | 'cashflow' | 'department';

export function ReportsView() {
  const svc = useOrgServices();
  const { currentOrganization } = useAuth();
  const orgCurrency = currentOrganization?.currency || 'USD';
  const { featureFlags } = usePlatformSettings();
  const reportService = getReportService();
  
  const [activeView, setActiveView] = useState<ReportView>('overview');
  const [selectedPeriod, setSelectedPeriod] = useState<'month' | 'quarter' | 'year' | 'all'>('year');
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState('2026-12-31');
  
  // Real data states
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [plData, setPlData] = useState<ProfitLossReport | null>(null);
  const [balanceData, setBalanceData] = useState<BalanceSheetReport | null>(null);
  const [cashFlowData, setCashFlowData] = useState<CashFlowReport[]>([]);
  const [deptData, setDeptData] = useState<DepartmentProfitability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Synchronize date range with selected period
  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (selectedPeriod === 'month') {
      const start = new Date(y, m, 1).toISOString().slice(0, 10);
      const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
      setDateFrom(start);
      setDateTo(end);
    } else if (selectedPeriod === 'quarter') {
      const qMonth = Math.floor(m / 3) * 3;
      const start = new Date(y, qMonth, 1).toISOString().slice(0, 10);
      const end = new Date(y, qMonth + 3, 0).toISOString().slice(0, 10);
      setDateFrom(start);
      setDateTo(end);
    } else if (selectedPeriod === 'year') {
      setDateFrom(`${y}-01-01`);
      setDateTo(`${y}-12-31`);
    } else if (selectedPeriod === 'all') {
      setDateFrom('2020-01-01');
      setDateTo('2030-12-31');
    }
  }, [selectedPeriod]);

  // Fetch all data on mount and when dates change (parallelized for high performance)
  useEffect(() => {
    async function fetchAllData() {
      if (!svc.orgId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const unwrap = (obj: any) => (obj && typeof obj === 'object' && 'data' in obj && obj.data !== undefined) ? obj.data : obj;

        // Fetch all 5 report endpoints in PARALLEL via Promise.all
        const [rawDashboard, rawPl, rawBalance, rawCashFlow, rawDepts] = await Promise.all([
          reportService.getDashboardSummary(svc.orgId, { world: 'business' }).catch(() => null),
          reportService.getProfitLoss(svc.orgId, { from: dateFrom, to: dateTo }).catch(() => null),
          reportService.getBalanceSheet(svc.orgId, dateTo).catch(() => null),
          reportService.getCashFlow(svc.orgId, 6, { from: dateFrom, to: dateTo }).catch(() => []),
          reportService.getDepartmentProfitability(svc.orgId, { from: dateFrom, to: dateTo }).catch(() => []),
        ]);

        let dashboard = unwrap(rawDashboard);
        let pl = unwrap(rawPl);
        let balance = unwrap(rawBalance);
        let cashFlow = unwrap(rawCashFlow);
        let depts = unwrap(rawDepts);

        // Check if we have valid API data
        const hasValidApiData = Boolean(
          (pl && (Number(pl.totalRevenue) > 0 || Number(pl.totalOperatingExpenses) > 0 || (Array.isArray(pl.revenue) && pl.revenue.length > 0))) ||
          (balance && (Number(balance.totalAssets) > 0 || Number(balance.totalLiabilities) > 0 || (Array.isArray(balance.assets) && balance.assets.length > 0)))
        );

        // ONLY invoke raw Supabase multi-table fallback if the backend API returned no valid data
        const sb = getSupabaseClient();
        if (!hasValidApiData && sb && svc.orgId) {
          try {
            const [{ data: txns }, { data: bankAccounts }, { data: accounts }, { data: sbDepts }, { data: loanRows }, { data: assetRows }, { data: invRows }, { data: loanPmtRows }] = await Promise.all([
              sb.from('transactions').select('*, categories:category_id(id, name, type)').eq('organization_id', svc.orgId),
              sb.from('bank_accounts').select('*').eq('organization_id', svc.orgId).eq('is_active', true),
              sb.from('accounts').select('*').eq('organization_id', svc.orgId).eq('is_active', true),
              sb.from('departments').select('*').eq('organization_id', svc.orgId),
              sb.from('loans').select('*').eq('organization_id', svc.orgId),
              sb.from('assets').select('*').eq('organization_id', svc.orgId),
              sb.from('inventory_items').select('*').eq('organization_id', svc.orgId),
              sb.from('loan_payments').select('*').eq('organization_id', svc.orgId),
            ]);

            const allTxns = txns || [];
            if (allTxns.length > 0) {
              const activeTxns = allTxns.filter((t: any) => {
                const status = String(t.status || 'classified').toLowerCase();
                if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) return false;
                const isTransfer = t.is_transfer || (Array.isArray(t.tags) && t.tags.includes('transfer')) || (typeof t.tags === 'string' && t.tags.includes('transfer'));
                if (isTransfer) return false;
                const isPersonal = t.world_scope === 'personal' || (Array.isArray(t.tags) && t.tags.includes('personal')) || (typeof t.tags === 'string' && t.tags.includes('personal'));
                if (isPersonal) return false;

                if (selectedPeriod === 'all') return true;
                const d = t.date;
                if (!d) return true;
                return d >= dateFrom && d <= dateTo;
              });

              const isLoanRepaymentTxn = (t: any) => {
                const cName = t.categories?.name || t.category_id || '';
                const desc = String(t.description || '').toLowerCase();
                const narr = String(t.narration || '').toLowerCase();
                return (
                  cName.toLowerCase().includes('loan repayment') ||
                  desc.includes('loan repayment') ||
                  (narr.includes('monthly installment') && narr.includes('loan'))
                );
              };

              const banks = bankAccounts || [];
              const loans = loanRows || [];
              const loanPmts = loanPmtRows || [];

              const getTxnAmountInBase = (t: any): number => {
                const rawAmt = Math.abs(Number(t.amount || 0));
                const rawCurr = String(t.currency || orgCurrency);
                let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
                if (!fxRate && Array.isArray(t.tags)) {
                  const rTag = t.tags.find((tag: string) => typeof tag === 'string' && tag.startsWith('fx:rate:'));
                  if (rTag) fxRate = Number(rTag.slice(8));
                }
                return t.base_amount != null && Number(t.base_amount) > 0 && String(t.base_currency || orgCurrency).toUpperCase() === orgCurrency
                  ? Number(t.base_amount)
                  : convertCurrency(rawAmt, rawCurr, orgCurrency, fxRate);
              };

              // Calculate Interest Expense (from to_pay loans) and Interest Income (from to_receive loans) STRICTLY within period
              let loanInterestExpense = 0;
              let loanInterestIncome = 0;
              for (const p of loanPmts) {
                if (selectedPeriod !== 'all' && p.paid_on && (p.paid_on < dateFrom || p.paid_on > dateTo)) {
                  continue; // Exclude payments outside active filter window
                }
                const parentLoan = loans.find((l: any) => l.id === p.loan_id);
                const intAmt = Number(p.interest_part || 0);
                if (intAmt > 0) {
                  if (parentLoan?.type === 'to_receive') {
                    loanInterestIncome += intAmt;
                  } else {
                    loanInterestExpense += intAmt;
                  }
                }
              }

              const baseRev = activeTxns.filter((t: any) => t.type === 'credit').reduce((s: number, t: any) => s + getTxnAmountInBase(t), 0);
              const baseExp = activeTxns.filter((t: any) => t.type === 'debit' && !isLoanRepaymentTxn(t)).reduce((s: number, t: any) => s + getTxnAmountInBase(t), 0);

              // Interest counted as expense for borrowed loans, income for lent loans
              const totalRev = baseRev + loanInterestIncome;
              const totalExp = baseExp + loanInterestExpense;

              const cashOnHand = banks.filter((b: any) => !['credit_card', 'line_of_credit'].includes(b.account_type)).reduce((s: number, b: any) => s + (Number(b.balance) || 0), 0);
              const creditLiabilities = banks.filter((b: any) => ['credit_card', 'line_of_credit'].includes(b.account_type)).reduce((s: number, b: any) => s + Math.abs(Number(b.balance) || 0), 0);
              const loanReceivables = loans.filter((l: any) => l.type === 'to_receive' && l.status !== 'paid').reduce((s: number, l: any) => s + (Number(l.remaining_balance ?? l.amount ?? l.principal) || 0), 0);
              const loanPayables = loans.filter((l: any) => l.type === 'to_pay' && l.status !== 'paid').reduce((s: number, l: any) => s + (Number(l.remaining_balance ?? l.amount ?? l.principal) || 0), 0);

              const totalInventoryValuation = (invRows || [])
                .filter((i: any) => i.is_active !== false)
                .reduce((s: number, i: any) => s + (Number(i.current_stock || 0) * Number(i.average_cost || i.unit_price || 0)), 0);

              const totalFixedAssetsValuation = (assetRows || [])
                .filter((a: any) => a.status !== 'disposed')
                .reduce((s: number, a: any) => {
                  const p = Number(a.purchase_price || 0);
                  const acc = Number(a.accumulated_depreciation || 0);
                  const salv = Number(a.salvage_value || 0);
                  return s + (a.current_value != null ? Number(a.current_value) : Math.max(salv, p - acc));
                }, 0);

              const totalAssetsCalc = cashOnHand + loanReceivables + totalInventoryValuation + totalFixedAssetsValuation;
              const totalLiabilitiesCalc = creditLiabilities + loanPayables;
              const netWorthCalc = totalAssetsCalc - totalLiabilitiesCalc;
              const liquidNetWorthCalc = cashOnHand - totalLiabilitiesCalc;

              if (!dashboard || (dashboard.totalRevenue === 0 && dashboard.totalAssets === 0) || dashboard.netWorth === 0) {
                dashboard = {
                  totalRevenue: totalRev,
                  totalExpenses: totalExp,
                  netProfit: totalRev - totalExp,
                  profitMargin: totalRev > 0 ? Math.round(((totalRev - totalExp) / totalRev) * 1000) / 10 : 0,
                  cashOnHand,
                  cashInBank: cashOnHand,
                  accountsReceivable: loanReceivables,
                  accountsPayable: loanPayables,
                  totalAssets: totalAssetsCalc,
                  totalLiabilities: totalLiabilitiesCalc,
                  netWorth: netWorthCalc,
                  liquidNetWorth: liquidNetWorthCalc,
                  pendingTransactions: allTxns.filter((t: any) => t.status === 'pending').length,
                  revenueChange: dashboard?.revenueChange ?? 0,
                  expenseChange: dashboard?.expenseChange ?? 0,
                  profitChange: dashboard?.profitChange ?? 0,
                };
              }

              if (!pl || pl.totalRevenue === 0) {
                const revMap = new Map<string, number>();
                const expMap = new Map<string, number>();
                const cogsMap = new Map<string, number>();
                for (const t of activeTxns) {
                  const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
                  if (tags.includes('transfer')) continue;

                  const catName = t.categories?.name || t.category_id || 'General';
                  const catType = String(t.categories?.type || '').toLowerCase();
                  const amt = getTxnAmountInBase(t);
                  const desc = String(t.description || '').toLowerCase();
                  const narr = String(t.narration || '').toLowerCase();

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
                    if (isLoanRepaymentTxn(t)) continue;

                    const isDirectCost = (
                      desc.includes('inventory purchase') ||
                      narr.includes('purchase:') ||
                      Boolean(t.project_id) ||
                      catName.toLowerCase().includes('cogs') ||
                      catName.toLowerCase().includes('cost of goods') ||
                      catName.toLowerCase().includes('software & tools') ||
                      catName.toLowerCase().includes('debit purchase')
                    );

                    if (isDirectCost) {
                      let cogsLabel = catName;
                      if (desc.includes('inventory purchase') || narr.includes('purchase:')) {
                        cogsLabel = 'Inventory Purchases & Direct Materials';
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
                if (loanInterestIncome > 0) {
                  revMap.set('Interest Income (Loans Given)', (revMap.get('Interest Income (Loans Given)') || 0) + loanInterestIncome);
                }
                if (loanInterestExpense > 0) {
                  expMap.set('Interest Expense (Loans Borrowed)', (expMap.get('Interest Expense (Loans Borrowed)') || 0) + loanInterestExpense);
                }

                if (loanInterestIncome > 0) {
                  revMap.set('Interest Income (Loans Given)', (revMap.get('Interest Income (Loans Given)') || 0) + loanInterestIncome);
                }
                if (loanInterestExpense > 0) {
                  expMap.set('Interest Expense (Loans Borrowed)', (expMap.get('Interest Expense (Loans Borrowed)') || 0) + loanInterestExpense);
                }

                const revItems = Array.from(revMap.entries()).map(([name, amount], idx) => ({ accountId: `rev-${idx}`, name, amount: Math.round(amount * 100) / 100 }));
                const cogsItems = Array.from(cogsMap.entries()).map(([name, amount], idx) => ({ accountId: `cogs-${idx}`, name, amount: Math.round(amount * 100) / 100 }));
                const opexItems = Array.from(expMap.entries()).map(([name, amount], idx) => ({ accountId: `opex-${idx}`, name, amount: Math.round(amount * 100) / 100 }));
                const totCogs = Math.round(cogsItems.reduce((s, c) => s + c.amount, 0) * 100) / 100;
                const totOpex = Math.round(opexItems.reduce((s, e) => s + e.amount, 0) * 100) / 100;

                pl = {
                  period: `${dateFrom} to ${dateTo}`,
                  revenue: revItems,
                  cogs: cogsItems,
                  operatingExpenses: opexItems,
                  totalRevenue: totalRev,
                  totalCOGS: totCogs,
                  grossProfit: Math.round((totalRev - totCogs) * 100) / 100,
                  totalOperatingExpenses: totOpex,
                  operatingIncome: Math.round((totalRev - totCogs - totOpex) * 100) / 100,
                  netIncome: Math.round((totalRev - totCogs - totOpex) * 100) / 100,
                };
              }

              if (!balance || (Number(balance.totalAssets || 0) === 0 && Number(balance.totalLiabilities || 0) === 0)) {
                const bAssets: { accountId: string; name: string; balance: number; type: string }[] = banks
                  .filter((b: any) => !['credit_card', 'line_of_credit'].includes(b.account_type))
                  .map((b: any) => ({
                    accountId: b.id,
                    name: `${b.bank_name || 'Bank'} · ${b.account_number ? b.account_number.slice(-4) : 'Cash'}`,
                    balance: Math.round(Number(b.balance || 0) * 100) / 100,
                    type: 'current',
                  }));

                // Add loans to receive as receivables
                for (const l of loans) {
                  if (l.type === 'to_receive' && l.status !== 'paid') {
                    const rem = Math.round(Number(l.remaining_balance ?? l.amount ?? l.principal ?? 0) * 100) / 100;
                    if (rem > 0) {
                      bAssets.push({
                        accountId: l.id,
                        name: `Loan Receivable: ${l.description || l.party}`,
                        balance: rem,
                        type: 'current',
                      });
                    }
                  }
                }

                const bLiab: { accountId: string; name: string; balance: number; type: string }[] = [];
                // Credit cards & credit lines
                for (const b of banks) {
                  if (['credit_card', 'line_of_credit'].includes(b.account_type)) {
                    bLiab.push({
                      accountId: b.id,
                      name: `${b.bank_name || 'Credit'} (${b.account_type})`,
                      balance: Math.round(Math.abs(Number(b.balance || 0)) * 100) / 100,
                      type: b.account_type === 'credit_card' ? 'current' : 'longTerm',
                    });
                  }
                }

                // Loans to pay
                for (const l of loans) {
                  if (l.type === 'to_pay' && l.status !== 'paid') {
                    const rem = Math.round(Number(l.remaining_balance ?? l.amount ?? l.principal ?? 0) * 100) / 100;
                    if (rem > 0) {
                      const isLong = (l.term_months && l.term_months > 12) || l.frequency === 'annual';
                      bLiab.push({
                        accountId: l.id,
                        name: `Loan Payable: ${l.description || l.party}`,
                        balance: rem,
                        type: isLong ? 'longTerm' : 'current',
                      });
                    }
                  }
                }

                const totA = Math.round(bAssets.reduce((s, a) => s + a.balance, 0) * 100) / 100;
                const totL = Math.round(bLiab.reduce((s, l) => s + l.balance, 0) * 100) / 100;
                const totE = Math.round((totA - totL) * 100) / 100;

                balance = {
                  asOfDate: dateTo,
                  assets: bAssets,
                  liabilities: bLiab,
                  equity: [{ accountId: 'equity-1', name: "Owner's Equity & Retained Earnings", balance: totE, type: 'equity' }],
                  totalAssets: totA,
                  totalLiabilities: totL,
                  totalEquity: totE,
                  currentAssets: totA,
                  fixedAssets: 0,
                  currentLiabilities: bLiab.filter(l => l.type === 'current').reduce((s, l) => s + l.balance, 0),
                  longTermLiabilities: bLiab.filter(l => l.type === 'longTerm').reduce((s, l) => s + l.balance, 0),
                };
              }

              if (!cashFlow || cashFlow.length === 0) {
                const monthMap = new Map<string, { inflow: number; outflow: number }>();
                for (const t of allTxns) {
                  const m = String(t.date || '').slice(0, 7);
                  if (!m) continue;
                  if (!monthMap.has(m)) monthMap.set(m, { inflow: 0, outflow: 0 });
                  const e = monthMap.get(m)!;
                  const amt = getTxnAmountInBase(t);
                  if (t.type === 'credit') e.inflow += amt;
                  else e.outflow += amt;
                }
                const sortedM = Array.from(monthMap.keys()).sort();
                cashFlow = sortedM.slice(-6).map(month => {
                  const d = monthMap.get(month)!;
                  return {
                    month,
                    inflow: Math.round(d.inflow * 100) / 100,
                    outflow: Math.round(d.outflow * 100) / 100,
                    net: Math.round((d.inflow - d.outflow) * 100) / 100,
                  };
                });
              }

              if (!depts || depts.length === 0) {
                const deptList = sbDepts || [];
                depts = deptList.map((d: any) => {
                  const dTxns = allTxns.filter((t: any) => t.department_id === d.id);
                  const rev = dTxns.filter((t: any) => t.type === 'credit').reduce((s: number, t: any) => s + getTxnAmountInBase(t), 0);
                  const cost = dTxns.filter((t: any) => t.type === 'debit').reduce((s: number, t: any) => s + getTxnAmountInBase(t), 0);
                  const profit = rev - cost;
                  const margin = rev > 0 ? (profit / rev) * 100 : 0;
                  return {
                    departmentId: d.id,
                    departmentName: d.name,
                    revenue: rev,
                    directCosts: cost,
                    allocatedOverhead: 0,
                    netProfit: profit,
                    profitMargin: margin,
                    headcount: 1,
                    revenuePerHead: rev,
                    totalHours: 160,
                    billableHours: 160,
                    utilization: 100,
                    costPerHour: cost / 160,
                  };
                });
              }
            }
          } catch (sbErr) {
            console.warn('[ReportsView] Supabase direct fallback error:', sbErr);
          }
        }

        const safeDashboard = unwrap(dashboard);
        const safePl = unwrap(pl);
        const safeBalance = unwrap(balance);
        const safeCashFlow = unwrap(cashFlow);
        const safeDepts = unwrap(depts);

        setDashboardData(safeDashboard);
        setPlData(safePl);
        setBalanceData(safeBalance);
        setCashFlowData(Array.isArray(safeCashFlow) ? safeCashFlow : []);
        setDeptData(Array.isArray(safeDepts) ? safeDepts : []);
        
        console.log('✅ Reports data loaded successfully:', { dashboard, pl, balance, cashFlow, depts });
      } catch (err: any) {
        console.error('❌ Error loading reports:', err);
        setError(err.message || 'Failed to load reports');
        toast.error('Failed to load reports data');
      } finally {
        setLoading(false);
      }
    }
    
    fetchAllData();
  }, [svc.orgId, dateFrom, dateTo, selectedPeriod, refreshKey]);

  // Calculate totals from REAL data (prioritizing period-filtered P&L data so KPI cards & P&L match 100%)
  const totalRevenue = plData ? plData.totalRevenue : (dashboardData?.totalRevenue || 0);
  const totalExpenses = plData
    ? Math.round(((plData.totalCOGS || 0) + (plData.totalOperatingExpenses || 0)) * 100) / 100
    : (dashboardData?.totalExpenses || 0);
  const netProfit = plData
    ? plData.netIncome
    : (dashboardData?.netProfit ?? (totalRevenue - totalExpenses));
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // Balance Sheet from REAL data
  const totalAssets = balanceData?.totalAssets || dashboardData?.totalAssets || 0;
  const totalLiabilities = balanceData?.totalLiabilities || dashboardData?.totalLiabilities || 0;
  const totalEquity = balanceData?.totalEquity || dashboardData?.netWorth || (totalAssets - totalLiabilities);
  const netWorth = totalAssets - totalLiabilities;
  const liquidNetWorth = balanceData?.liquidNetWorth ?? dashboardData?.liquidNetWorth ?? (dashboardData?.cashInBank ? Math.max(0, dashboardData.cashInBank - totalLiabilities) : 0);
  
  const totalCurrentAssets =
    (Array.isArray(balanceData?.assets) ? balanceData.assets : [])
      .filter((a) => a.type === 'current')
      .reduce((sum, a) => sum + (a.balance || 0), 0) ||
    balanceData?.currentAssets ||
    0;
  const totalFixedAssets =
    (Array.isArray(balanceData?.assets) ? balanceData.assets : [])
      .filter((a) => a.type === 'fixed')
      .reduce((sum, a) => sum + (a.balance || 0), 0) ||
    balanceData?.fixedAssets ||
    0;
  const totalCurrentLiabilities =
    (Array.isArray(balanceData?.liabilities) ? balanceData.liabilities : [])
      .filter((l) => l.type === 'current')
      .reduce((sum, l) => sum + (l.balance || 0), 0) ||
    balanceData?.currentLiabilities ||
    0;
  const totalLongTermLiabilities =
    (Array.isArray(balanceData?.liabilities) ? balanceData.liabilities : [])
      .filter((l) => l.type === 'longTerm')
      .reduce((sum, l) => sum + (l.balance || 0), 0) ||
    balanceData?.longTermLiabilities ||
    0;

  // Cash Flow from REAL data (separating Financing loan repayments from Operating Cash Flow)
  const totalNetCashFlow = (Array.isArray(cashFlowData) ? cashFlowData : []).reduce((sum, m) => sum + (m.net || 0), 0);
  const totalCashOutflows = (Array.isArray(cashFlowData) ? cashFlowData : []).reduce((sum, m) => sum + (m.outflow || 0), 0);
  const financingCashFlow = totalExpenses > 0 && totalCashOutflows > totalExpenses
    ? -Math.round((totalCashOutflows - totalExpenses) * 100) / 100
    : 0;
  const investingCashFlow = 0;
  const operatingCashFlow = Math.round((totalNetCashFlow - investingCashFlow - financingCashFlow) * 100) / 100;
  const netCashFlow = totalNetCashFlow;

  // Department data from REAL data
  const departmentRows = (Array.isArray(deptData) ? deptData : []).map((d) => {
    const cost = (d.directCosts || 0) + (d.allocatedOverhead || 0);
    const hc = d.headcount || 1;
    const costPerHour = (d as any).costPerHour || Math.round(cost / (hc * 160));
    return {
      key: d.departmentId,
      name: d.departmentName,
      revenue: d.revenue || 0,
      cost,
      profit: d.netProfit || 0,
      margin: d.profitMargin || 0,
      headcount: d.headcount || 0,
      avgRate: costPerHour,
    };
  });

  const totalDeptRevenue = departmentRows.reduce((sum, d) => sum + d.revenue, 0);
  const totalDeptCost = departmentRows.reduce((sum, d) => sum + d.cost, 0);
  const totalDeptProfit = departmentRows.reduce((sum, d) => sum + d.profit, 0);

  const departmentChartRows = departmentRows.map((d) => ({
    name: d.name,
    revenue: d.revenue,
    cost: d.cost,
    profit: d.profit,
  }));
  
  // Monthly trend from cash flow data
  const monthlyTrendData = (Array.isArray(cashFlowData) ? cashFlowData : []).map(m => ({
    month: m.month,
    revenue: m.inflow || 0,
    expenses: m.outflow || 0,
    profit: m.net || 0
  }));

  const exportCsv = async (reportLabel: string, buildCsv: () => string) => {
    try {
      const csv = buildCsv();
      const filename = `${reportLabel.replace(/\s+/g, '_')}_${dateFrom}_to_${dateTo}.csv`;
      downloadCsvFile(filename, csv);
      toast.success(`${reportLabel} exported`);
    } catch (err: any) {
      console.error('[ReportsView.exportCsv] error:', err);
      toast.error(`Export failed: ${err.message}`);
    }
  };

  const handleRefresh = () => {
    reportService.invalidateCache(svc.orgId);
    setRefreshKey((k) => k + 1);
    toast.success('Refreshing reports…');
  };

  const exportAllReports = () =>
    exportCsv('All_Reports', () => {
      const parts: string[] = [];
      if (plData) parts.push(profitLossToCsv(plData));
      if (deptData?.length) parts.push(departmentsToCsv(deptData));
      if (!parts.length) {
        parts.push(rowsToCsv([['Note', 'No data available yet']]));
      }
      return parts.join('\r\n\r\n');
    });

  const handleExportQuickBooks = async () => {
    try {
      const txRes = await svc.transactions.getAll({ pageSize: 500 });
      const items = txRes.success && txRes.data?.items ? txRes.data.items : [];
      const res = exportToQuickBooks(items, `quickbooks_ledger_${dateFrom}_to_${dateTo}`, 'qbo_csv');
      if (res.success) {
        toast.success('Exported ledger to QuickBooks (.csv) format');
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || 'QuickBooks export failed');
    }
  };

  // Prepare chart data from REAL data with safety checks
  const revenueChartData = (plData?.revenue && Array.isArray(plData.revenue)) 
    ? plData.revenue.map(r => ({
        name: r.name,
        value: r.amount,
        percentage: ((r.amount / (plData.totalRevenue || 1)) * 100).toFixed(1)
      }))
    : [];

  const expenseChartData = (plData?.cogs && plData?.operatingExpenses) 
    ? [
        ...(Array.isArray(plData.cogs) ? plData.cogs : []).map(e => ({ name: e.name, value: e.amount })),
        ...(Array.isArray(plData.operatingExpenses) ? plData.operatingExpenses : []).map(e => ({ name: e.name, value: e.amount }))
      ].map(e => ({
        ...e,
        percentage: ((e.value / ((plData.totalCOGS + plData.totalOperatingExpenses) || 1)) * 100).toFixed(1)
      }))
    : [];

  const plRevenueChartData = revenueChartData;
  const plExpenseChartData = expenseChartData;
  const plNetMarginPct = profitMargin;

  // Show full-screen loading state only on initial cold mount with no data
  if (loading && !plData && !balanceData) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: AXIOM.backgrounds.main }}>
        <div className="text-center">
          <RefreshCw className="size-12 animate-spin text-purple-500 mx-auto mb-4" />
          <p className="text-white text-lg">Loading reports...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: AXIOM.backgrounds.main }}>
        <div className="text-center">
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-6 max-w-md">
            <p className="text-red-400 text-lg mb-4">Failed to load reports</p>
            <p className="text-slate-400 text-sm mb-4">{error}</p>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const viewButtons = [
    { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
    { id: 'pl' as const, label: 'P&L Statement', icon: TrendingUp },
    { id: 'balance' as const, label: 'Balance Sheet', icon: Scale },
    { id: 'cashflow' as const, label: 'Cash Flow', icon: Wallet },
    { id: 'department' as const, label: 'Department P&L', icon: Users },
  ];

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <FileText className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Financial Reports
              </h1>
              <p className="text-slate-400 text-sm">Comprehensive financial statements and analytics</p>
            </div>
          </div>
          <div className="flex gap-3">
            <motion.select
              whileHover={{ scale: 1.02 }}
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value as any)}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={AXIOM.buttons.secondary}
            >
              <option value="year">This Year</option>
              <option value="quarter">This Quarter</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </motion.select>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
              onClick={handleRefresh}
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin text-purple-400' : ''}`} />
              Refresh
            </motion.button>
            {featureFlags.export_to_quickbooks && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => void handleExportQuickBooks()}
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.35))',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  color: '#ffffff',
                }}
              >
                <FileSpreadsheet className="size-4" />
                Export to QuickBooks
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => void exportAllReports()}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Download className="size-4" />
              Export All
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartGreen}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Revenue</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(totalRevenue)}</p>
              <div className="flex items-center gap-1 mt-2">
                {(dashboardData?.revenueChange ?? 0) >= 0 ? (
                  <ArrowUpRight className="size-3 text-green-400" />
                ) : (
                  <ArrowDownRight className="size-3 text-red-400" />
                )}
                <p className={`text-xs ${(dashboardData?.revenueChange ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {(dashboardData?.revenueChange ?? 0) >= 0 ? '+' : ''}{(dashboardData?.revenueChange ?? 0).toFixed(1)}% from last month
                </p>
              </div>
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
          style={AXIOM.containers.chartRed}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Expenses</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(totalExpenses)}</p>
              <div className="flex items-center gap-1 mt-2">
                {(dashboardData?.expenseChange ?? 0) <= 0 ? (
                  <ArrowDownRight className="size-3 text-green-400" />
                ) : (
                  <ArrowUpRight className="size-3 text-red-400" />
                )}
                <p className={`text-xs ${(dashboardData?.expenseChange ?? 0) <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {(dashboardData?.expenseChange ?? 0) >= 0 ? '+' : ''}{(dashboardData?.expenseChange ?? 0).toFixed(1)}% from last month
                </p>
              </div>
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
          style={AXIOM.containers.chartCyan}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Net Profit</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(netProfit)}</p>
              <div className="flex items-center gap-1 mt-2">
                <Percent className="size-3 text-cyan-400" />
                <p className="text-xs text-cyan-400">{profitMargin.toFixed(1)}% margin</p>
              </div>
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

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartPurple}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Net Worth</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(netWorth)}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="size-3 text-purple-400" />
                <p className="text-xs text-purple-400">
                  {liquidNetWorth > 0 ? `Liquid: ${formatCurrency(liquidNetWorth)}` : 'Total equity value'}
                </p>
              </div>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <CircleDollarSign className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* View Selector */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex gap-2 p-2 rounded-2xl"
        style={AXIOM.containers.list}
      >
        {viewButtons.map((btn) => (
          <motion.button
            key={btn.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveView(btn.id)}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={activeView === btn.id ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
          >
            <btn.icon className="size-4" />
            {btn.label}
          </motion.button>
        ))}
      </motion.div>

      {/* Report Content */}
      {activeView === 'overview' && (
        <div className="space-y-4">
          {/* Monthly Trend Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartPurple}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-white">6-Month Financial Trend</h3>
                <p className="text-sm text-slate-400 mt-1">Revenue, Expenses & Profit Analysis</p>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() =>
                  void exportCsv('6-month-trend', () =>
                    rowsToCsv([
                      ['Month', 'Revenue', 'Expenses', 'Profit'],
                      ...monthlyTrendData.map((m) => [m.month, m.revenue, m.expenses, m.profit]),
                    ])
                  )
                }
                className="px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2"
                style={AXIOM.buttons.secondary}
              >
                <Download className="size-3" />
                Export
              </motion.button>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyTrendData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.red} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid {...AXIOM.charts.grid} />
                <XAxis 
                  dataKey="month" 
                  {...AXIOM.charts.axis}
                  tick={{ fill: '#94a3b8' }}
                />
                <YAxis 
                  {...AXIOM.charts.axis}
                  tick={{ fill: '#94a3b8' }}
                  tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                    border: AXIOM.charts.tooltip.border,
                    borderRadius: AXIOM.charts.tooltip.borderRadius,
                    color: '#fff',
                  }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="circle"
                />
                <Area type="monotone" dataKey="revenue" stroke={COLORS.cyan} strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" name="Revenue" />
                <Area type="monotone" dataKey="expenses" stroke={COLORS.red} strokeWidth={2} fillOpacity={1} fill="url(#colorExpenses)" name="Expenses" />
                <Area type="monotone" dataKey="profit" stroke={COLORS.green} strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Quick Links to Reports */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              onClick={() => setActiveView('pl')}
              className="p-6 rounded-2xl cursor-pointer group"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.cyan,
                      boxShadow: AXIOM.shadows.iconCyan,
                    }}
                  >
                    <TrendingUp className="size-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">Profit & Loss Statement</h3>
                    <p className="text-sm text-slate-400">Revenue vs Expenses analysis</p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              </div>
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div>
                  <p className="text-xs text-slate-500">Revenue</p>
                  <p className="text-lg font-bold text-green-400">{formatCurrency(totalRevenue)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Expenses</p>
                  <p className="text-lg font-bold text-red-400">{formatCurrency(totalExpenses)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Net Profit</p>
                  <p className="text-lg font-bold text-cyan-400">{formatCurrency(netProfit)}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              onClick={() => setActiveView('balance')}
              className="p-6 rounded-2xl cursor-pointer group"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.purple,
                      boxShadow: AXIOM.shadows.iconPurple,
                    }}
                  >
                    <Scale className="size-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-purple-400 transition-colors">Balance Sheet</h3>
                    <p className="text-sm text-slate-400">Assets, Liabilities & Equity</p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-slate-400 group-hover:text-purple-400 transition-colors" />
              </div>
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div>
                  <p className="text-xs text-slate-500">Assets</p>
                  <p className="text-lg font-bold text-cyan-400">{formatCurrency(totalAssets)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Liabilities</p>
                  <p className="text-lg font-bold text-red-400">{formatCurrency(totalLiabilities)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Equity</p>
                  <p className="text-lg font-bold text-purple-400">{formatCurrency(totalEquity)}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              onClick={() => setActiveView('cashflow')}
              className="p-6 rounded-2xl cursor-pointer group"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.green,
                      boxShadow: AXIOM.shadows.iconGreen,
                    }}
                  >
                    <Wallet className="size-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-green-400 transition-colors">Cash Flow Statement</h3>
                    <p className="text-sm text-slate-400">Operating, Investing & Financing</p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-slate-400 group-hover:text-green-400 transition-colors" />
              </div>
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div>
                  <p className="text-xs text-slate-500">Operating</p>
                  <p className="text-lg font-bold text-green-400">{formatCurrency(operatingCashFlow)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Investing</p>
                  <p className="text-lg font-bold text-amber-400">{formatCurrency(investingCashFlow)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Financing</p>
                  <p className="text-lg font-bold text-blue-400">{formatCurrency(financingCashFlow)}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              onClick={() => setActiveView('department')}
              className="p-6 rounded-2xl cursor-pointer group"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: AXIOM.iconBoxes.amber,
                      boxShadow: AXIOM.shadows.iconAmber,
                    }}
                  >
                    <Users className="size-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-amber-400 transition-colors">Department P&L</h3>
                    <p className="text-sm text-slate-400">Performance by department</p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-slate-400 group-hover:text-amber-400 transition-colors" />
              </div>
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div>
                  <p className="text-xs text-slate-500">Total Revenue</p>
                  <p className="text-lg font-bold text-green-400">{formatCurrency(totalDeptRevenue)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total Cost</p>
                  <p className="text-lg font-bold text-red-400">{formatCurrency(totalDeptCost)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total Profit</p>
                  <p className="text-lg font-bold text-amber-400">{formatCurrency(totalDeptProfit)}</p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {activeView === 'pl' && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white">Profit & Loss Statement</h3>
                <p className="text-sm text-slate-400 mt-1">
                  For the period: {formatPeriodLabel(plData?.period, dateFrom, dateTo)}
                </p>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() =>
                  void exportCsv('P-L-Statement', () =>
                    plData
                      ? profitLossToCsv(plData)
                      : rowsToCsv([['Message', 'Report not loaded yet — use Refresh and try again']])
                  )
                }
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                  border: '1px solid rgba(6, 182, 212, 0.5)',
                  boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                  color: '#ffffff',
                }}
              >
                <Download className="size-4" />
                Export CSV
              </motion.button>
            </div>

            {loading && (
              <p className="text-slate-400 text-center py-12">Loading this report…</p>
            )}

            {error && (
              <div className="text-center py-8 space-y-3">
                <p className="text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && plData && (
              <div className="space-y-6">
                {plData.revenue.length === 0 &&
                  plData.cogs.length === 0 &&
                  plData.operatingExpenses.length === 0 &&
                  plData.totalRevenue === 0 && (
                    <p className="text-slate-400 text-sm mb-2">
                      No income or expense accounts with balances yet — connect your chart of accounts or add activity to see this report.
                    </p>
                  )}

                <div>
                  <div
                    className="flex items-center justify-between mb-3 pb-2"
                    style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}
                  >
                    <h4 className="text-lg font-bold text-white">REVENUE</h4>
                  </div>
                  <div className="space-y-2">
                    {plData.revenue.map((line) => (
                      <div
                        key={line.accountId}
                        className="flex items-center justify-between py-2 px-4 rounded-lg hover:bg-black/20 transition-colors"
                      >
                        <span className="text-slate-300">{line.name}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-slate-400 w-16 text-right">
                            {plData.totalRevenue > 0
                              ? ((line.amount / plData.totalRevenue) * 100).toFixed(1)
                              : '0.0'}
                            %
                          </span>
                          <span className="text-white font-medium w-32 text-right">
                            {formatCurrency(line.amount)}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div
                      className="flex items-center justify-between pt-3 mt-2"
                      style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}
                    >
                      <span className="text-white font-bold">Total Revenue</span>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-slate-400 w-16 text-right">100%</span>
                        <span className="text-green-400 font-bold w-32 text-right">
                          {formatCurrency(plData.totalRevenue)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div
                    className="flex items-center justify-between mb-3 pb-2"
                    style={{
                      borderTop: '2px solid rgba(148, 163, 184, 0.1)',
                      paddingTop: '24px',
                      borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                    }}
                  >
                    <h4 className="text-lg font-bold text-white">COST OF GOODS SOLD</h4>
                  </div>
                  <div className="space-y-2">
                    {plData.cogs.map((line) => (
                      <div
                        key={line.accountId}
                        className="flex items-center justify-between py-2 px-4 rounded-lg hover:bg-black/20 transition-colors"
                      >
                        <span className="text-slate-300">{line.name}</span>
                        <span className="text-white font-medium w-32 text-right">
                          {formatCurrency(line.amount)}
                        </span>
                      </div>
                    ))}
                    <div
                      className="flex items-center justify-between pt-3 mt-2"
                      style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}
                    >
                      <span className="text-white font-bold">Total COGS</span>
                      <span className="text-red-400 font-bold w-32 text-right">
                        {formatCurrency(plData.totalCOGS)}
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className="flex items-center justify-between p-4 rounded-xl"
                  style={{
                    background: 'rgba(148, 163, 184, 0.08)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                  }}
                >
                  <span className="text-white font-bold">Gross profit</span>
                  <span className="text-cyan-400 font-bold">{formatCurrency(plData.grossProfit)}</span>
                </div>

                <div>
                  <div
                    className="flex items-center justify-between mb-3 pb-2"
                    style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}
                  >
                    <h4 className="text-lg font-bold text-white">OPERATING EXPENSES</h4>
                  </div>
                  <div className="space-y-2">
                    {plData.operatingExpenses.map((line) => {
                      const denom = plData.totalCOGS + plData.totalOperatingExpenses;
                      return (
                        <div
                          key={line.accountId}
                          className="flex items-center justify-between py-2 px-4 rounded-lg hover:bg-black/20 transition-colors"
                        >
                          <span className="text-slate-300">{line.name}</span>
                          <div className="flex items-center gap-4">
                            <span className="text-xs text-slate-400 w-16 text-right">
                              {denom > 0 ? ((line.amount / denom) * 100).toFixed(1) : '0.0'}%
                            </span>
                            <span className="text-white font-medium w-32 text-right">
                              {formatCurrency(line.amount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <div
                      className="flex items-center justify-between pt-3 mt-2"
                      style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}
                    >
                      <span className="text-white font-bold">Total operating expenses</span>
                      <span className="text-red-400 font-bold w-32 text-right">
                        {formatCurrency(plData.totalOperatingExpenses)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4" style={{ borderTop: '2px solid rgba(148, 163, 184, 0.2)' }}>
                  <div
                    className="flex items-center justify-between p-6 rounded-xl"
                    style={{
                      background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                    }}
                  >
                    <span className="text-xl font-bold text-white">NET INCOME</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-cyan-400 w-16 text-right">
                        {plNetMarginPct.toFixed(1)}%
                      </span>
                      <span
                        className={`text-2xl font-bold w-32 text-right ${
                          plData.netIncome >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {formatCurrency(plData.netIncome)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {!loading && !error && plData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="p-6 rounded-2xl"
                style={AXIOM.containers.chartGreen}
              >
                <h4 className="text-lg font-bold text-white mb-4">Revenue Breakdown</h4>
                {plRevenueChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <RePieChart>
                      <Pie
                        data={plRevenueChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ percentage }: { percentage?: string }) => `${percentage ?? ''}%`}
                        outerRadius={90}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {plRevenueChartData.map((_, index) => (
                          <Cell
                            key={`rv-${index}`}
                            fill={Object.values(COLORS)[index % Object.values(COLORS).length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                          border: AXIOM.charts.tooltip.border,
                          borderRadius: AXIOM.charts.tooltip.borderRadius,
                          color: '#fff',
                        }}
                        formatter={(value: number) => formatCurrency(value)}
                      />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-slate-400 text-sm py-8 text-center">Nothing to chart for revenue yet.</p>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
                className="p-6 rounded-2xl"
                style={AXIOM.containers.chartRed}
              >
                <h4 className="text-lg font-bold text-white mb-4">Cost & expense breakdown</h4>
                {plExpenseChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <RePieChart>
                      <Pie
                        data={plExpenseChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ percentage }: { percentage?: string }) => `${percentage ?? ''}%`}
                        outerRadius={90}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {plExpenseChartData.map((_, index) => (
                          <Cell
                            key={`ex-${index}`}
                            fill={Object.values(COLORS)[index % Object.values(COLORS).length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                          border: AXIOM.charts.tooltip.border,
                          borderRadius: AXIOM.charts.tooltip.borderRadius,
                          color: '#fff',
                        }}
                        formatter={(value: number) => formatCurrency(value)}
                      />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-slate-400 text-sm py-8 text-center">Nothing to chart for costs yet.</p>
                )}
              </motion.div>
            </div>
          )}
        </div>
      )}

      {activeView === 'balance' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-white">Balance Sheet</h3>
              <p className="text-sm text-slate-400 mt-1">
                As of {formatDate(balanceData?.asOfDate || new Date().toISOString())}
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => {
                const assets = Array.isArray(balanceData?.assets) ? balanceData.assets : [];
                const liabilities = Array.isArray(balanceData?.liabilities) ? balanceData.liabilities : [];
                const equity = Array.isArray(balanceData?.equity) ? balanceData.equity : [];
                
                void exportCsv('Balance-Sheet', () =>
                  rowsToCsv([
                    ['As of', balanceData?.asOfDate || new Date().toISOString()],
                    [],
                    ['ASSETS'],
                    ['Current Assets'],
                    ...assets.filter(a => a.type === 'current').map(a => [a.name, a.balance]),
                    ['Fixed Assets'],
                    ...assets.filter(a => a.type === 'fixed').map(a => [a.name, a.balance]),
                    ['Total Assets', totalAssets],
                    [],
                    ['LIABILITIES'],
                    ['Current Liabilities'],
                    ...liabilities.filter(l => l.type === 'current').map(l => [l.name, l.balance]),
                    ['Long-term Liabilities'],
                    ...liabilities.filter(l => l.type === 'longTerm').map(l => [l.name, l.balance]),
                    ['Total Liabilities', totalLiabilities],
                    [],
                    ['EQUITY'],
                    ...equity.map(e => [e.name, e.balance]),
                    ['Total Equity', totalAssets - totalLiabilities],
                  ])
                );
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Download className="size-4" />
              Export CSV
            </motion.button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Assets */}
            <div className="space-y-6">
              <div>
                <h4 className="text-lg font-bold text-white mb-3 pb-2" style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                  ASSETS
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-slate-400 mb-2">Current Assets</p>
                    <div className="space-y-2 pl-4">
                      {(Array.isArray(balanceData?.assets) ? balanceData.assets : [])
                        .filter(a => a.type === 'current')
                        .map((asset) => (
                        <div key={asset.accountId} className="flex justify-between py-1">
                          <span className="text-slate-300">{asset.name}</span>
                          <span className="text-white font-medium">
                            {formatCurrency(asset.balance)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <span className="text-white font-medium">Total Current Assets</span>
                        <span className="text-cyan-400 font-bold">
                          {formatCurrency(totalCurrentAssets)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-400 mb-2">Fixed Assets</p>
                    <div className="space-y-2 pl-4">
                      {(Array.isArray(balanceData?.assets) ? balanceData.assets : [])
                        .filter(a => a.type === 'fixed')
                        .map((asset) => (
                        <div key={asset.accountId} className="flex justify-between py-1">
                          <span className="text-slate-300">{asset.name}</span>
                          <span className={`font-medium ${asset.balance < 0 ? 'text-red-400' : 'text-white'}`}>
                            {formatCurrency(asset.balance)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <span className="text-white font-medium">Total Fixed Assets</span>
                        <span className="text-cyan-400 font-bold">
                          {formatCurrency(totalFixedAssets)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4" style={{ borderTop: '2px solid rgba(148, 163, 184, 0.2)' }}>
                    <div 
                      className="flex justify-between p-4 rounded-xl"
                      style={{
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2))',
                        border: '1px solid rgba(6, 182, 212, 0.3)',
                      }}
                    >
                      <span className="text-lg font-bold text-white">TOTAL ASSETS</span>
                      <span className="text-lg font-bold text-cyan-400">
                        {formatCurrency(totalAssets)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Liabilities & Equity */}
            <div className="space-y-6">
              <div>
                <h4 className="text-lg font-bold text-white mb-3 pb-2" style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                  LIABILITIES & EQUITY
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-slate-400 mb-2">Current Liabilities</p>
                    <div className="space-y-2 pl-4">
                      {(Array.isArray(balanceData?.liabilities) ? balanceData.liabilities : [])
                        .filter(l => l.type === 'current')
                        .map((liability) => (
                        <div key={liability.accountId} className="flex justify-between py-1">
                          <span className="text-slate-300">{liability.name}</span>
                          <span className="text-white font-medium">
                            {formatCurrency(liability.balance)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <span className="text-white font-medium">Total Current Liabilities</span>
                        <span className="text-red-400 font-bold">
                          {formatCurrency(totalCurrentLiabilities)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-400 mb-2">Long-term Liabilities</p>
                    <div className="space-y-2 pl-4">
                      {(Array.isArray(balanceData?.liabilities) ? balanceData.liabilities : [])
                        .filter(l => l.type === 'longTerm')
                        .map((liability) => (
                        <div key={liability.accountId} className="flex justify-between py-1">
                          <span className="text-slate-300">{liability.name}</span>
                          <span className="text-white font-medium">
                            {formatCurrency(liability.balance)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <span className="text-white font-medium">Total Long-term Liabilities</span>
                        <span className="text-red-400 font-bold">
                          {formatCurrency(totalLongTermLiabilities)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                    <div className="flex justify-between mb-2">
                      <span className="text-white font-bold">Total Liabilities</span>
                      <span className="text-red-400 font-bold">
                        {formatCurrency(totalLiabilities)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-400 mb-2">Owner's Equity</p>
                    <div className="space-y-2 pl-4">
                      {(Array.isArray(balanceData?.equity) ? balanceData.equity : [])
                        .map((eq) => (
                        <div key={eq.accountId} className="flex justify-between py-1">
                          <span className="text-slate-300">{eq.name}</span>
                          <span className="text-white font-medium">
                            {formatCurrency(eq.balance)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <span className="text-white font-medium">Total Equity</span>
                        <span className="text-green-400 font-bold">
                          {formatCurrency(totalEquity)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4" style={{ borderTop: '2px solid rgba(148, 163, 184, 0.2)' }}>
                    <div 
                      className="flex justify-between p-4 rounded-xl"
                      style={{
                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                      }}
                    >
                      <span className="text-lg font-bold text-white">TOTAL LIABILITIES & EQUITY</span>
                      <span className="text-lg font-bold text-purple-400">
                        {formatCurrency(totalLiabilities + totalEquity)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {activeView === 'cashflow' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-white">Cash Flow Statement</h3>
              <p className="text-sm text-slate-400 mt-1">
                For the period: {formatDate(dateFrom)} to {formatDate(dateTo)}
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() =>
                void exportCsv('Cash-Flow-Statement', () =>
                  rowsToCsv([
                    ['Period', `${formatDate(dateFrom)} to ${formatDate(dateTo)}`],
                    [],
                    ['Month', 'Inflow', 'Outflow', 'Net'],
                    ...(Array.isArray(cashFlowData) ? cashFlowData : []).map((m) => [m.month, m.inflow, m.outflow, m.net]),
                    [],
                    ['Total Net Cash Flow', netCashFlow],
                  ])
                )
              }
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Download className="size-4" />
              Export CSV
            </motion.button>
          </div>

          <div className="space-y-6">
            {/* Operating Activities */}
            {/* Monthly Cash Flow */}
            <div>
              <div className="flex items-center justify-between mb-3 pb-2" style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                <h4 className="text-lg font-bold text-white">MONTHLY CASH FLOW</h4>
              </div>
              <div className="space-y-2">
                {(Array.isArray(cashFlowData) ? cashFlowData : []).map((monthData) => (
                  <div key={monthData.month} className="py-2 px-4 rounded-lg hover:bg-black/20 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-300 font-medium">{monthData.month}</span>
                      <span className={`font-bold ${(monthData.net || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatCurrency(monthData.net || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm pl-4">
                      <span className="text-slate-400">Inflow:</span>
                      <span className="text-green-400">{formatCurrency(monthData.inflow || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm pl-4">
                      <span className="text-slate-400">Outflow:</span>
                      <span className="text-red-400">{formatCurrency(monthData.outflow || 0)}</span>
                    </div>
                  </div>
                ))}
                <div 
                  className="flex items-center justify-between p-4 rounded-xl mt-2"
                  style={{
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2))',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                >
                  <span className="text-white font-bold">Net Cash Flow</span>
                  <span className={`font-bold ${netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(netCashFlow)}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </motion.div>
      )}

      {activeView === 'department' && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white">Department P&L Analysis</h3>
                <p className="text-sm text-slate-400 mt-1">
                  {deptData && deptData.length > 0
                    ? 'From your organization data'
                    : 'Performance breakdown by department (sample rows when no department data yet)'}
                </p>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() =>
                  void exportCsv('Department-P-L', () =>
                    deptData && deptData.length > 0
                      ? departmentsToCsv(deptData)
                      : rowsToCsv([
                          [
                            'Department',
                            'Revenue',
                            'Cost',
                            'Profit',
                            'Margin %',
                            'Headcount',
                            'Avg rate',
                          ],
                          ...departmentRows.map((d) => [
                            d.name,
                            d.revenue,
                            d.cost,
                            d.profit,
                            Math.round(d.margin * 10) / 10,
                            d.headcount,
                            d.avgRate,
                          ]),
                        ])
                  )
                }
                className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                  border: '1px solid rgba(6, 182, 212, 0.5)',
                  boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                  color: '#ffffff',
                }}
              >
                <Download className="size-4" />
                Export CSV
              </motion.button>
            </div>

            {loading && (
              <p className="text-slate-400 text-center py-8">Loading departments…</p>
            )}
            {error && (
              <div className="text-center py-6 space-y-2">
                <p className="text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Department</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Revenue</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Cost</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Profit</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Margin %</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Headcount</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Cost / Hour</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentRows.map((dept, index) => (
                    <tr
                      key={dept.key}
                      className="hover:bg-black/20 transition-colors"
                      style={{
                        borderBottom:
                          index !== departmentRows.length - 1
                            ? '1px solid rgba(148, 163, 184, 0.05)'
                            : 'none',
                      }}
                    >
                      <td className="py-4 px-4">
                        <span className="text-white font-medium">{dept.name}</span>
                      </td>
                      <td className="py-4 px-4 text-right text-green-400 font-medium">
                        {formatCurrency(dept.revenue)}
                      </td>
                      <td className="py-4 px-4 text-right text-red-400 font-medium">
                        {formatCurrency(dept.cost)}
                      </td>
                      <td className="py-4 px-4 text-right text-cyan-400 font-bold">
                        {formatCurrency(dept.profit)}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span
                          className="px-3 py-1 rounded-lg text-xs font-medium"
                          style={{
                            background:
                              dept.margin > 35
                                ? 'rgba(16, 185, 129, 0.2)'
                                : dept.margin > 25
                                  ? 'rgba(245, 158, 11, 0.2)'
                                  : 'rgba(239, 68, 68, 0.2)',
                            border:
                              dept.margin > 35
                                ? '1px solid rgba(16, 185, 129, 0.3)'
                                : dept.margin > 25
                                  ? '1px solid rgba(245, 158, 11, 0.3)'
                                  : '1px solid rgba(239, 68, 68, 0.3)',
                            color: dept.margin > 35 ? '#10b981' : dept.margin > 25 ? '#f59e0b' : '#ef4444',
                          }}
                        >
                          {dept.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right text-slate-300">
                        {dept.headcount}
                      </td>
                      <td className="py-4 px-4 text-right text-slate-300">
                        {formatCurrency(dept.avgRate)}/hr
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid rgba(148, 163, 184, 0.2)' }}>
                    <td className="py-4 px-4">
                      <span className="text-white font-bold">TOTAL</span>
                    </td>
                    <td className="py-4 px-4 text-right text-green-400 font-bold">
                      {formatCurrency(totalDeptRevenue)}
                    </td>
                    <td className="py-4 px-4 text-right text-red-400 font-bold">
                      {formatCurrency(totalDeptCost)}
                    </td>
                    <td className="py-4 px-4 text-right text-cyan-400 font-bold">
                      {formatCurrency(totalDeptProfit)}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-cyan-400 font-bold">
                        {totalDeptRevenue > 0
                          ? ((totalDeptProfit / totalDeptRevenue) * 100).toFixed(1)
                          : '0.0'}
                        %
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right text-white font-bold">
                      {departmentRows.reduce((sum, d) => sum + d.headcount, 0)}
                    </td>
                    <td className="py-4 px-4"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartAmber}
          >
            <h4 className="text-lg font-bold text-white mb-4">Department Revenue vs Profit</h4>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={departmentChartRows}>
                <CartesianGrid {...AXIOM.charts.grid} />
                <XAxis 
                  dataKey="name" 
                  {...AXIOM.charts.axis}
                  tick={{ fill: '#94a3b8' }}
                />
                <YAxis 
                  {...AXIOM.charts.axis}
                  tick={{ fill: '#94a3b8' }}
                  tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: AXIOM.charts.tooltip.backgroundColor,
                    border: AXIOM.charts.tooltip.border,
                    borderRadius: AXIOM.charts.tooltip.borderRadius,
                    color: '#fff',
                  }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend />
                <Bar dataKey="revenue" fill={COLORS.green} name="Revenue" radius={[8, 8, 0, 0]} />
                <Bar dataKey="cost" fill={COLORS.red} name="Cost" radius={[8, 8, 0, 0]} />
                <Bar dataKey="profit" fill={COLORS.amber} name="Profit" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>
      )}
    </div>
  );
}
