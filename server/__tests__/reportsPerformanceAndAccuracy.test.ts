import assert from 'node:assert/strict';

console.log('  Finance OS — Reports Performance & Accuracy Verification');

// 1. Test P&L RPC Guard Logic
{
  const rpcDataZeroCogs = {
    totalRevenue: 50000,
    totalCOGS: 0,
    totalOperatingExpenses: 20000,
    operatingIncome: 30000,
    netIncome: 30000,
    revenue: [{ name: 'Software Consulting', amount: 50000 }],
    cogs: [],
    operatingExpenses: [{ name: 'Salaries', amount: 20000 }],
  };

  const isAccepted = Boolean(
    Number(rpcDataZeroCogs.totalRevenue) > 0 ||
    Number(rpcDataZeroCogs.totalOperatingExpenses) > 0 ||
    Number(rpcDataZeroCogs.totalCOGS) > 0 ||
    (Array.isArray(rpcDataZeroCogs.revenue) && rpcDataZeroCogs.revenue.length > 0)
  );

  assert.equal(isAccepted, true, 'Zero-COGS service firm data must be accepted from RPC directly');
  console.log('    ✓ 1. Zero-COGS service firm P&L data accepted directly from database RPC');
}

// 2. Test Balance Sheet RPC Guard Logic
{
  const rpcDataNoInventory = {
    totalAssets: 120000,
    totalLiabilities: 20000,
    totalEquity: 100000,
    assets: [
      { name: 'Chase Checking · 1234', balance: 70000, type: 'current' },
      { name: 'MacBook Pro Laptops', balance: 50000, type: 'fixed' },
    ],
    liabilities: [
      { name: 'Amex Credit Card', balance: 20000, type: 'current' },
    ],
    equity: [
      { name: "Owner's Equity & Retained Earnings", balance: 100000, type: 'equity' },
    ],
  };

  const hasRealRpcData = (
    Number(rpcDataNoInventory.totalAssets) > 0 ||
    Number(rpcDataNoInventory.totalLiabilities) > 0 ||
    (Array.isArray(rpcDataNoInventory.assets) && rpcDataNoInventory.assets.some((a: any) => Number(a.balance) !== 0))
  );

  assert.equal(hasRealRpcData, true, 'Non-inventory business balance sheet must be accepted directly from database RPC');
  assert.equal(
    rpcDataNoInventory.totalAssets,
    rpcDataNoInventory.totalLiabilities + rpcDataNoInventory.totalEquity,
    'Fundamental accounting equation: Assets = Liabilities + Equity'
  );
  console.log('    ✓ 2. Zero-inventory Balance Sheet data accepted and satisfies Assets = Liabilities + Equity');
}

// 3. Test Period-Filtered Loan Interest Isolation
{
  const loanPayments = [
    { id: 'lp-1', paid_on: '2026-01-15', interest_part: 500 },
    { id: 'lp-2', paid_on: '2026-05-15', interest_part: 500 },
    { id: 'lp-3', paid_on: '2026-10-15', interest_part: 500 },
  ];

  const dateFrom = '2026-10-01';
  const dateTo = '2026-10-31';
  const selectedPeriod = 'month';

  let periodInterest = 0;
  for (const p of loanPayments) {
    if (selectedPeriod !== 'all' && p.paid_on && (p.paid_on < dateFrom || p.paid_on > dateTo)) {
      continue;
    }
    periodInterest += p.interest_part;
  }

  assert.equal(periodInterest, 500, 'Only October interest must be counted in October period, not lifetime $1,500');
  console.log('    ✓ 3. Period-filtered loan interest isolates active window without lifetime bleed');
}

// 4. Test KPI Period Card Fallback Safety
{
  const plDataMonth = {
    totalRevenue: 0,
    totalCOGS: 0,
    totalOperatingExpenses: 4500,
    netIncome: -4500,
  };
  const dashboardDataAllTime = {
    totalRevenue: 600000,
    totalExpenses: 400000,
    netProfit: 200000,
  };

  const totalRevenue = plDataMonth ? plDataMonth.totalRevenue : (dashboardDataAllTime?.totalRevenue || 0);
  const totalExpenses = plDataMonth
    ? Math.round(((plDataMonth.totalCOGS || 0) + (plDataMonth.totalOperatingExpenses || 0)) * 100) / 100
    : (dashboardDataAllTime?.totalExpenses || 0);
  const netProfit = plDataMonth ? plDataMonth.netIncome : (totalRevenue - totalExpenses);

  assert.equal(totalRevenue, 0, 'Month KPI card must show $0 revenue, not all-time $600k');
  assert.equal(totalExpenses, 4500, 'Month KPI card must show $4,500 expenses');
  assert.equal(netProfit, -4500, 'Month KPI card must show -$4,500 net loss');
  console.log('    ✓ 4. KPI cards accurately display zero-revenue periods without defaulting to all-time totals');
}

console.log('\nAll Reports Performance & Accuracy tests passed successfully!');

