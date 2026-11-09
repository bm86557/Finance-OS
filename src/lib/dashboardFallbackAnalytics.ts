/**
 * Placeholder KPIs when org financial data is empty or still loading.
 * Single source for org dashboard surfaces — avoid duplicate inline constants.
 * VALUES IN USD (Base Currency)
 */
export const dashboardFallbackAnalytics = {
  netWorth: 0,
  cashInHand: 0,
  monthlyProfit: 0,
  weeklyProfit: 0,
  yearlyProfit: 0,
} as const;
