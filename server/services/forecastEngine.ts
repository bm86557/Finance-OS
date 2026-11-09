/**
 * Cash Flow Forecast Calculation Engine
 * ====================================
 * Shared mathematical model for projecting future daily cash positions.
 * Consumes:
 *  - Real opening bank cash balances
 *  - Historical transactions (for median daily burn & income)
 *  - Scheduled recurring transactions (expanded forward across calendar)
 *  - Scheduled loan payments (debt service & receivables)
 * Produces:
 *  - Daily projected rows (income, expenses, net, balance, confidence)
 *  - High-precision KPIs (currentCash, projectedCash, burnRate, runway, crunch days)
 */

import { convertCurrency } from '../lib/fxConverter.js';

export interface ForecastDayRow {
  date: string;
  income: number;
  expense: number;
  expenses: number;
  net: number;
  balance: number;
  type: 'actual' | 'projected';
  confidence: number;
}

export interface MonthlyBreakdown {
  month: string; // YYYY-MM format
  income: number;
  expense: number;
  net: number;
  balance: number;
  type: 'actual' | 'projected';
  daysInMonth: number;
}

export interface ForecastKPIs {
  currentCash: number;
  projectedCash: number;
  netChange: number;
  burnRate: number; // monthly gross burn (30 * median daily debit)
  dailyBurn: number; // daily median debit
  dailyIncome: number; // daily median credit
  netBurnMonthly: number; // monthly expense - monthly income
  runway: number | null; // months until depletion (null if cash generative)
  runwayStatus: 'cash_generative' | 'burning' | 'insufficient_cash';
  cashCrunchDays: number; // days where balance falls below threshold
  cashCrunchThreshold: number;
  lowestBalance: number;
  lowestBalanceDate: string | null;
  highestBalance: number;
  highestBalanceDate: string | null;
  scenario: 'realistic' | 'best' | 'worst';
  horizonDays: number;
  monthlyBreakdown?: MonthlyBreakdown[];
}

export interface ScenarioFactors {
  incomeFactor: number;
  expenseFactor: number;
  collectionDelayDays: number;
}

export const SCENARIO_ASSUMPTIONS: Record<'realistic' | 'best' | 'worst', {
  label: string;
  revenueFactor: number;
  costFactor: number;
  collectionDelayDays: number;
  targetUtilization: number;
  description: string;
}> = {
  realistic: {
    label: 'Base (Realistic)',
    revenueFactor: 1.0,
    costFactor: 1.0,
    collectionDelayDays: 0,
    targetUtilization: 0.75,
    description: 'Median historical baseline run-rates, 100% scheduled recurring transactions, standard collections.',
  },
  best: {
    label: 'Optimistic',
    revenueFactor: 1.3,
    costFactor: 0.8,
    collectionDelayDays: 0,
    targetUtilization: 0.85,
    description: '+30% revenue/billing rate, -20% operating expenses, immediate receivables realization.',
  },
  worst: {
    label: 'Pessimistic',
    revenueFactor: 0.7,
    costFactor: 1.3,
    collectionDelayDays: 14,
    targetUtilization: 0.60,
    description: '-30% revenue contraction, +30% cost inflation, 14-day customer payment delays.',
  },
};

export function isInternalTransfer(txn: any): boolean {
  if (!txn) return false;
  if (txn.type === 'transfer') return true;
  const tags = Array.isArray(txn?.tags) ? txn.tags : (typeof txn?.tags === 'string' ? JSON.parse(txn.tags || '[]') : []);
  if (Array.isArray(tags) && (tags.includes('transfer') || tags.includes('bank-transfer') || tags.includes('internal-transfer'))) {
    return true;
  }
  const desc = String(txn?.description || '').toLowerCase();
  const narr = String(txn?.narration || '').toLowerCase();
  if (desc.includes('internal transfer') || narr.includes('internal transfer')) return true;
  return false;
}

export const SCENARIO_PROFILES: Record<'realistic' | 'best' | 'worst', ScenarioFactors> = {
  realistic: {
    incomeFactor: 1.0,
    expenseFactor: 1.0,
    collectionDelayDays: 0,
  },
  best: {
    incomeFactor: 1.3,
    expenseFactor: 0.8,
    collectionDelayDays: 0,
  },
  worst: {
    incomeFactor: 0.7,
    expenseFactor: 1.3,
    collectionDelayDays: 14,
  },
};

export interface EngineInput {
  organizationId: string;
  horizonDays?: number;
  scenario?: 'realistic' | 'best' | 'worst';
  currentCash: number;
  baseCurrency?: string;
  transactions?: Array<{
    date: string;
    amount: number;
    type: string;
    status?: string;
    currency?: string;
    fx_rate_to_base?: number;
    tags?: any;
  }>;
  recurring?: Array<{
    id: string;
    description?: string;
    amount: number;
    currency?: string;
    type: 'credit' | 'debit';
    frequency?: string;
    next_occurrence?: string;
    nextOccurrence?: string;
    is_active?: boolean;
    isActive?: boolean;
  }>;
  loans?: Array<{
    id: string;
    type: 'to_receive' | 'to_pay';
    amount?: number;
    currency?: string;
    installment_amount?: number;
    installmentAmount?: number;
    monthly_payment?: number;
    next_payment_date?: string;
    nextPaymentDate?: string;
    status?: string;
  }>;
  customCrunchThreshold?: number;
}

function extractFxRate(t: any): number | undefined {
  if (t?.fx_rate_to_base && Number(t.fx_rate_to_base) > 0) return Number(t.fx_rate_to_base);
  const tags = Array.isArray(t?.tags) ? t.tags : (typeof t?.tags === 'string' ? JSON.parse(t.tags || '[]') : []);
  if (Array.isArray(tags)) {
    const rTag = tags.find((tag: any) => typeof tag === 'string' && tag.startsWith('fx:rate:'));
    if (rTag) return Number(rTag.slice(8));
  }
  return undefined;
}

/**
 * Aggregate historical transactions by month to establish baseline monthly patterns
 * Uses FX currency conversion so foreign currencies (e.g. PKR, EUR) are accurately converted to baseCurrency
 */
function aggregateTransactionsByMonth(
  transactions: Array<{ date: string; amount: number; type: string; currency?: string; fx_rate_to_base?: number; tags?: any }>,
  baseCurrency = 'USD',
  debug = false
) {
  const monthlyData: Record<string, { income: number; expense: number; count: number }> = {};

  for (const txn of transactions) {
    if (isInternalTransfer(txn)) continue;
    const month = txn.date.substring(0, 7); // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = { income: 0, expense: 0, count: 0 };
    }

    const rawAmt = Number(txn.amount || 0);
    const txnCurrency = (txn.currency || baseCurrency).toUpperCase();
    const fxRate = extractFxRate(txn);
    const convertedAmount = convertCurrency(rawAmt, txnCurrency, baseCurrency, fxRate);

    if (txn.type === 'credit') {
      monthlyData[month].income += Math.abs(convertedAmount);
    } else if (txn.type === 'debit') {
      monthlyData[month].expense += Math.abs(convertedAmount);
    } else if (convertedAmount > 0) {
      monthlyData[month].income += convertedAmount;
    } else if (convertedAmount < 0) {
      monthlyData[month].expense += Math.abs(convertedAmount);
    }
    
    monthlyData[month].count += 1;
  }

  return monthlyData;
}

/**
 * Calculate average monthly income and expense from historical monthly aggregates
 */
function getMonthlyPatternAverage(monthlyData: Record<string, { income: number; expense: number; count: number }>) {
  const months = Object.values(monthlyData);
  if (months.length === 0) {
    return { avgMonthlyIncome: 0, avgMonthlyExpense: 0 };
  }

  // Use median to resist outliers
  const incomes = months.map(m => m.income).sort((a, b) => a - b);
  const expenses = months.map(m => m.expense).sort((a, b) => a - b);

  const medianIncome = incomes.length % 2 === 0
    ? (incomes[incomes.length / 2 - 1] + incomes[incomes.length / 2]) / 2
    : incomes[Math.floor(incomes.length / 2)];

  const medianExpense = expenses.length % 2 === 0
    ? (expenses[expenses.length / 2 - 1] + expenses[expenses.length / 2]) / 2
    : expenses[Math.floor(expenses.length / 2)];

  return {
    avgMonthlyIncome: Math.round(medianIncome * 100) / 100,
    avgMonthlyExpense: Math.round(medianExpense * 100) / 100,
  };
}

export function computeCashFlowForecast(input: EngineInput): {
  forecasts: ForecastDayRow[];
  kpis: ForecastKPIs;
  assumptions?: any;
  cutoffDate?: string;
} {
  const horizonDays = Math.max(7, Math.min(365, input.horizonDays || 90));
  const scenario = input.scenario || 'realistic';
  const profile = SCENARIO_PROFILES[scenario] || SCENARIO_PROFILES.realistic;
  const currentCash = Math.round(Number(input.currentCash || 0) * 100) / 100;
  const baseCurrency = (input.baseCurrency || 'USD').toUpperCase();

  // 1. Calculate historical baseline daily debits & credits in baseCurrency (using median for outlier resistance)
  // Internal transfers are strictly excluded to avoid artificial inflation of consolidated cash flow
  const todayStr = new Date().toISOString().split('T')[0];
  const txns = (input.transactions || []).filter(t => !isInternalTransfer(t));
  
  const debitTxns = txns.filter(t => t.type === 'debit' && t.date <= todayStr);
  const creditTxns = txns.filter(t => t.type === 'credit' && t.date <= todayStr);

  const dailyDebitsMap: Record<string, number> = {};
  for (const t of debitTxns) {
    const rawAmt = Number(t.amount || 0);
    const txnCurrency = (t.currency || baseCurrency).toUpperCase();
    const fxRate = extractFxRate(t);
    const convertedAmt = convertCurrency(rawAmt, txnCurrency, baseCurrency, fxRate);
    dailyDebitsMap[t.date] = (dailyDebitsMap[t.date] || 0) + Math.abs(convertedAmt);
  }
  const debitVals = Object.values(dailyDebitsMap).sort((a, b) => a - b);
  const medianDailyDebit = debitVals.length > 0
    ? (debitVals.length % 2 === 0
        ? (debitVals[debitVals.length / 2 - 1] + debitVals[debitVals.length / 2]) / 2
        : debitVals[Math.floor(debitVals.length / 2)])
    : 0;

  const dailyCreditsMap: Record<string, number> = {};
  for (const t of creditTxns) {
    const rawAmt = Number(t.amount || 0);
    const txnCurrency = (t.currency || baseCurrency).toUpperCase();
    const fxRate = extractFxRate(t);
    const convertedAmt = convertCurrency(rawAmt, txnCurrency, baseCurrency, fxRate);
    dailyCreditsMap[t.date] = (dailyCreditsMap[t.date] || 0) + Math.abs(convertedAmt);
  }
  const creditVals = Object.values(dailyCreditsMap).sort((a, b) => a - b);
  const medianDailyCredit = creditVals.length > 0
    ? (creditVals.length % 2 === 0
        ? (creditVals[creditVals.length / 2 - 1] + creditVals[creditVals.length / 2]) / 2
        : creditVals[Math.floor(creditVals.length / 2)])
    : 0;

  const baseDailyExpense = medianDailyDebit * profile.expenseFactor;
  const baseDailyIncome = medianDailyCredit * profile.incomeFactor;

  // 2. Pre-index scheduled recurring items across the projection horizon (converted to baseCurrency)
  const recurringByDate: Record<string, { income: number; expense: number }> = {};
  const activeRecurring = (input.recurring || []).filter(r => r.is_active !== false && r.isActive !== false);

  for (const item of activeRecurring) {
    let nextStr = item.next_occurrence || item.nextOccurrence;
    if (!nextStr) continue;

    const rawAmt = Math.abs(Number(item.amount || 0));
    const itemCurrency = (item.currency || baseCurrency).toUpperCase();
    const amt = convertCurrency(rawAmt, itemCurrency, baseCurrency);
    const isCredit = item.type === 'credit';
    const freq = (item.frequency || 'monthly').toLowerCase();

    // Advance occurrence forward across the horizon
    let curDate = new Date(nextStr);
    const horizonEndDate = new Date();
    horizonEndDate.setDate(horizonEndDate.getDate() + horizonDays + 30);

    let safety = 0;
    while (curDate <= horizonEndDate && safety < 100) {
      safety++;
      const dStr = curDate.toISOString().split('T')[0];
      
      // If collection delay applies to credits in worst case scenario
      let targetDateStr = dStr;
      if (isCredit && profile.collectionDelayDays > 0) {
        const delayed = new Date(curDate);
        delayed.setDate(delayed.getDate() + profile.collectionDelayDays);
        targetDateStr = delayed.toISOString().split('T')[0];
      }

      if (!recurringByDate[targetDateStr]) {
        recurringByDate[targetDateStr] = { income: 0, expense: 0 };
      }

      if (isCredit) {
        recurringByDate[targetDateStr].income += amt * profile.incomeFactor;
      } else {
        recurringByDate[targetDateStr].expense += amt * profile.expenseFactor;
      }

      // Step to next occurrence
      if (freq === 'weekly') {
        curDate.setDate(curDate.getDate() + 7);
      } else if (freq === 'biweekly') {
        curDate.setDate(curDate.getDate() + 14);
      } else if (freq === 'quarterly') {
        curDate.setMonth(curDate.getMonth() + 3);
      } else if (freq === 'annual' || freq === 'yearly') {
        curDate.setFullYear(curDate.getFullYear() + 1);
      } else {
        // default monthly
        curDate.setMonth(curDate.getMonth() + 1);
      }
    }
  }

  // 3. Pre-index scheduled loan payments (converted to baseCurrency)
  const loansByDate: Record<string, { income: number; expense: number }> = {};
  const activeLoans = (input.loans || []).filter(l => (l.status || 'active') === 'active');

  for (const loan of activeLoans) {
    const nextStr = loan.next_payment_date || loan.nextPaymentDate;
    if (!nextStr) continue;

    const rawInstallment = Math.abs(Number(loan.installment_amount || loan.installmentAmount || loan.monthly_payment || 0));
    if (rawInstallment <= 0) continue;

    const loanCurrency = (loan.currency || baseCurrency).toUpperCase();
    const installment = convertCurrency(rawInstallment, loanCurrency, baseCurrency);

    const isReceivable = loan.type === 'to_receive';
    if (!loansByDate[nextStr]) {
      loansByDate[nextStr] = { income: 0, expense: 0 };
    }
    if (isReceivable) {
      loansByDate[nextStr].income += installment * profile.incomeFactor;
    } else {
      loansByDate[nextStr].expense += installment * profile.expenseFactor;
    }
  }

  // 4. Generate daily projected rows
  const forecasts: ForecastDayRow[] = [];
  let runningBalance = currentCash;
  let lowestBalance = currentCash;
  let lowestBalanceDate: string | null = todayStr;
  let highestBalance = currentCash;
  let highestBalanceDate: string | null = todayStr;

  // Default crunch threshold: 20% of current cash or minimum $10,000 (adaptive to currency & org scale)
  const defaultThreshold = Math.max(10000, Math.round(currentCash * 0.2));
  const cashCrunchThreshold = input.customCrunchThreshold ?? defaultThreshold;
  let cashCrunchDays = 0;

  const startDate = new Date();

  for (let offset = 1; offset <= horizonDays; offset++) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + offset);
    const dateStr = dayDate.toISOString().split('T')[0];

    // Combine baseline + recurring + loans
    const rec = recurringByDate[dateStr] || { income: 0, expense: 0 };
    const loan = loansByDate[dateStr] || { income: 0, expense: 0 };

    const dayIncome = Math.round((baseDailyIncome + rec.income + loan.income) * 100) / 100;
    const dayExpense = Math.round((baseDailyExpense + rec.expense + loan.expense) * 100) / 100;
    const dayNet = Math.round((dayIncome - dayExpense) * 100) / 100;

    runningBalance = Math.round((runningBalance + dayNet) * 100) / 100;

    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance;
      lowestBalanceDate = dateStr;
    }
    if (runningBalance > highestBalance) {
      highestBalance = runningBalance;
      highestBalanceDate = dateStr;
    }

    if (runningBalance < cashCrunchThreshold) {
      cashCrunchDays++;
    }

    // Decay confidence naturally over time from 95% down to 55%
    const confidence = Math.max(50, Math.round(95 - (offset / horizonDays) * 40));

    forecasts.push({
      date: dateStr,
      income: dayIncome,
      expense: dayExpense,
      expenses: dayExpense,
      net: dayNet,
      balance: runningBalance,
      type: 'projected',
      confidence,
    });
  }

  // 5. Derived KPIs
  const projectedCash = forecasts.length > 0 ? forecasts[forecasts.length - 1].balance : currentCash;
  const netChange = Math.round((projectedCash - currentCash) * 100) / 100;

  // Burn rate: standard 30-day gross operating expense
  const burnRate = Math.round(medianDailyDebit * 30);
  const totalProjectedIncome30 = forecasts.slice(0, 30).reduce((s, f) => s + f.income, 0);
  const totalProjectedExpense30 = forecasts.slice(0, 30).reduce((s, f) => s + f.expense, 0);
  const netBurnMonthly = Math.round(totalProjectedExpense30 - totalProjectedIncome30);

  // 6. Generate accurate monthly breakdown using actual monthly transaction data in baseCurrency
  const monthlyBreakdown: MonthlyBreakdown[] = [];
  const historicalMonthly = aggregateTransactionsByMonth(txns, baseCurrency);
  const { avgMonthlyIncome, avgMonthlyExpense } = getMonthlyPatternAverage(historicalMonthly);

  const todayMonth = todayStr.substring(0, 7);
  const relevantMonths = Object.keys(historicalMonthly).filter(
    month => month <= todayMonth
  );
  
  let runningMonthlyBalance = currentCash;
  
  for (const month of relevantMonths.sort()) {
    const historical = historicalMonthly[month];
    
    if (historical) {
      const income = Math.round(historical.income * 100) / 100;
      const expense = Math.round(historical.expense * 100) / 100;
      const net = Math.round((income - expense) * 100) / 100;
      runningMonthlyBalance = Math.round((runningMonthlyBalance + net) * 100) / 100;
      
      const parts = month.split('-');
      const daysInMonth = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10), 0).getDate();
      
      monthlyBreakdown.push({
        month,
        income,
        expense,
        net,
        balance: runningMonthlyBalance,
        type: 'actual',
        daysInMonth,
      });
    }
  }

  // Calculate realistic monthly burn rate and runway
  const actualMonthlyBurnRate = avgMonthlyExpense > 0 ? Math.round(avgMonthlyExpense) : burnRate;
  const actualNetBurnMonthly = Math.round(avgMonthlyExpense - avgMonthlyIncome);

  let adjustedRunway: number | null = null;
  let finalRunwayStatus: 'cash_generative' | 'burning' | 'insufficient_cash' = 'cash_generative';

  if (currentCash <= 0) {
    adjustedRunway = 0;
    finalRunwayStatus = 'insufficient_cash';
  } else if (actualNetBurnMonthly > 0) {
    adjustedRunway = Math.round((currentCash / actualNetBurnMonthly) * 10) / 10;
    finalRunwayStatus = 'burning';
  } else {
    adjustedRunway = null;
    finalRunwayStatus = 'cash_generative';
  }

  return {
    forecasts,
    kpis: {
      currentCash,
      projectedCash,
      netChange,
      burnRate: actualMonthlyBurnRate,
      dailyBurn: Math.round((actualMonthlyBurnRate / 30) * 100) / 100,
      dailyIncome: Math.round(medianDailyCredit * 100) / 100,
      netBurnMonthly: actualNetBurnMonthly,
      runway: adjustedRunway,
      runwayStatus: finalRunwayStatus,
      cashCrunchDays,
      cashCrunchThreshold,
      lowestBalance,
      lowestBalanceDate,
      highestBalance,
      highestBalanceDate,
      scenario,
      horizonDays,
      monthlyBreakdown,
    },
    assumptions: SCENARIO_ASSUMPTIONS[scenario],
    cutoffDate: todayStr,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §15 — Profit Forecast Engine (Accrued / Recognized Revenue & Cost)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfitForecastInput {
  organizationId: string;
  horizonMonths?: number;
  scenario?: 'realistic' | 'best' | 'worst';
  baselineMonthlyRevenue?: number;
  baselineMonthlyCogs?: number;
  baselineMonthlyOpex?: number;
  monthlyRecurringRevenue?: number;
  monthlyRecurringExpense?: number;
  monthlyOverheadPool?: number;
  monthlyDepreciation?: number;
}

export interface MonthlyProfitRow {
  month: string;
  recognizedRevenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  allocatedOverhead: number;
  depreciationExpense: number;
  netIncome: number;
  profitMarginPercent: number;
}

export function computeProfitForecast(input: ProfitForecastInput): {
  months: MonthlyProfitRow[];
  kpis: {
    totalRevenue: number;
    totalCogs: number;
    grossProfit: number;
    totalOpex: number;
    netIncome: number;
    averageMarginPercent: number;
    scenario: 'realistic' | 'best' | 'worst';
    assumptions: typeof SCENARIO_ASSUMPTIONS['realistic'];
    cutoffDate: string;
  };
} {
  const horizonMonths = Math.max(1, Math.min(24, input.horizonMonths || 6));
  const scenario = input.scenario || 'realistic';
  const profile = SCENARIO_ASSUMPTIONS[scenario] || SCENARIO_ASSUMPTIONS.realistic;
  const cutoffDate = new Date().toISOString().split('T')[0];

  const baseRev = Math.max(0, Number(input.baselineMonthlyRevenue || 0));
  const baseCogs = Math.max(0, Number(input.baselineMonthlyCogs || 0));
  const baseOpex = Math.max(0, Number(input.baselineMonthlyOpex || 0));
  const recRev = Math.max(0, Number(input.monthlyRecurringRevenue || 0));
  const recExp = Math.max(0, Number(input.monthlyRecurringExpense || 0));
  const overhead = Math.max(0, Number(input.monthlyOverheadPool || 0));
  const depr = Math.max(0, Number(input.monthlyDepreciation || 0));

  const monthlyRev = (baseRev + recRev) * profile.revenueFactor;
  const monthlyCogs = baseCogs * profile.costFactor;
  const monthlyOpex = (baseOpex + recExp) * profile.costFactor;

  const months: MonthlyProfitRow[] = [];
  const cur = new Date();

  let cumRev = 0;
  let cumCogs = 0;
  let cumOpex = 0;
  let cumNet = 0;

  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(cur.getFullYear(), cur.getMonth() + i, 1);
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const grossProfit = Math.round((monthlyRev - monthlyCogs) * 100) / 100;
    const totalOperatingCosts = Math.round((monthlyOpex + overhead + depr) * 100) / 100;
    const netIncome = Math.round((grossProfit - totalOperatingCosts) * 100) / 100;
    const profitMarginPercent = monthlyRev > 0 ? Math.round((netIncome / monthlyRev) * 1000) / 10 : 0;

    months.push({
      month: mStr,
      recognizedRevenue: Math.round(monthlyRev * 100) / 100,
      cogs: Math.round(monthlyCogs * 100) / 100,
      grossProfit,
      operatingExpenses: Math.round(monthlyOpex * 100) / 100,
      allocatedOverhead: Math.round(overhead * 100) / 100,
      depreciationExpense: Math.round(depr * 100) / 100,
      netIncome,
      profitMarginPercent,
    });

    cumRev += monthlyRev;
    cumCogs += monthlyCogs;
    cumOpex += totalOperatingCosts;
    cumNet += netIncome;
  }

  return {
    months,
    kpis: {
      totalRevenue: Math.round(cumRev * 100) / 100,
      totalCogs: Math.round(cumCogs * 100) / 100,
      grossProfit: Math.round((cumRev - cumCogs) * 100) / 100,
      totalOpex: Math.round(cumOpex * 100) / 100,
      netIncome: Math.round(cumNet * 100) / 100,
      averageMarginPercent: cumRev > 0 ? Math.round((cumNet / cumRev) * 1000) / 10 : 0,
      scenario,
      assumptions: profile,
      cutoffDate,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §15 — Capacity Forecast Engine (Hours, Billing Rates & Utilization)
// ─────────────────────────────────────────────────────────────────────────────

export interface CapacityForecastInput {
  organizationId: string;
  horizonMonths?: number;
  scenario?: 'realistic' | 'best' | 'worst';
  activeHeadcount: number;
  standardHoursPerFte?: number;
  historicalBillableRate?: number;
  historicalBillableHours?: number;
  directStaffCostPerMonth?: number;
}

export interface MonthlyCapacityRow {
  month: string;
  headcount: number;
  capacityHours: number;
  forecastedBillableHours: number;
  forecastedNonBillableHours: number;
  utilizationPercent: number;
  forecastedRevenue: number;
  directCost: number;
  capacityMargin: number;
}

export function computeCapacityForecast(input: CapacityForecastInput): {
  months: MonthlyCapacityRow[];
  kpis: {
    totalCapacityHours: number;
    totalBillableHours: number;
    totalNonBillableHours: number;
    averageUtilizationPercent: number;
    projectedBillings: number;
    projectedDirectCost: number;
    projectedMargin: number;
    scenario: 'realistic' | 'best' | 'worst';
    assumptions: typeof SCENARIO_ASSUMPTIONS['realistic'];
    cutoffDate: string;
  };
} {
  const horizonMonths = Math.max(1, Math.min(24, input.horizonMonths || 6));
  const scenario = input.scenario || 'realistic';
  const profile = SCENARIO_ASSUMPTIONS[scenario] || SCENARIO_ASSUMPTIONS.realistic;
  const cutoffDate = new Date().toISOString().split('T')[0];

  const headcount = Math.max(1, input.activeHeadcount || 1);
  const hoursPerFte = input.standardHoursPerFte || 160;
  const capacityHours = headcount * hoursPerFte;
  const rate = Math.max(1, Number(input.historicalBillableRate || 85)) * profile.revenueFactor;
  const directCost = Math.max(0, Number(input.directStaffCostPerMonth || 0)) * profile.costFactor;

  const targetUtil = Math.min(0.95, Math.max(0.40, profile.targetUtilization));
  const billableHours = Math.round(capacityHours * targetUtil);
  const nonBillableHours = capacityHours - billableHours;
  const projectedRevenue = Math.round(billableHours * rate * 100) / 100;
  const capacityMargin = Math.round((projectedRevenue - directCost) * 100) / 100;

  const months: MonthlyCapacityRow[] = [];
  const cur = new Date();

  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(cur.getFullYear(), cur.getMonth() + i, 1);
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    months.push({
      month: mStr,
      headcount,
      capacityHours,
      forecastedBillableHours: billableHours,
      forecastedNonBillableHours: nonBillableHours,
      utilizationPercent: Math.round(targetUtil * 1000) / 10,
      forecastedRevenue: projectedRevenue,
      directCost,
      capacityMargin,
    });
  }

  const totalCap = capacityHours * horizonMonths;
  const totalBillable = billableHours * horizonMonths;
  const totalBillings = projectedRevenue * horizonMonths;
  const totalCost = directCost * horizonMonths;

  return {
    months,
    kpis: {
      totalCapacityHours: totalCap,
      totalBillableHours: totalBillable,
      totalNonBillableHours: totalCap - totalBillable,
      averageUtilizationPercent: Math.round(targetUtil * 1000) / 10,
      projectedBillings: Math.round(totalBillings * 100) / 100,
      projectedDirectCost: Math.round(totalCost * 100) / 100,
      projectedMargin: Math.round((totalBillings - totalCost) * 100) / 100,
      scenario,
      assumptions: profile,
      cutoffDate,
    },
  };
}
