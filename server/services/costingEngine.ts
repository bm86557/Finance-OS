/**
 * Authoritative Costing, Overhead Allocation & Pricing Engine
 * ===========================================================
 * Single centralized calculation authority implementing
 * FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md (§§6, 8, 12.1–12.7, 14, 23 F-04/F-05, 33)
 * under the approved fixed 160 hr/month per FTE schedule-driven capacity model.
 *
 * Guarantees:
 *  - Deterministic Hamilton-Hare integer-cent overhead conservation (zero cent leakage, §12.3, §33 #10)
 *  - Identical department driver and overhead allocation math across Department Rates & Projects
 *  - Strict period alignment: transactions, scheduled hours, monthly pools, and 160h/FTE capacity
 *    always share the exact same time basis (§12.2, §33 #5)
 *  - Zero-denominator & zero-revenue results strictly return `null` (Undefined), NEVER 0% or -100% (§12.1, §33 #9)
 *  - Personal-world, internal-transfer, loan-principal, and non-operating exclusions (§1, §5, §12.3)
 *  - Anti-double-counting guard between declared overhead pools and category-inferred direct costs (§33 #10)
 *  - Decimal string serialization alongside numeric values (§6 L234)
 */

import { convertCurrency } from '../lib/fxConverter.js';
import { isInternalTransferTransaction } from '../../src/lib/projectTransactionFilter.js';

export const VALID_ALLOCATION_BASES = [
  'headcount',
  'revenue',
  'direct_cost',
  'equal',
  'custom',
  'manual_weight',
  'department_ratio',
  'square_footage',
  'time_utilization',
] as const;

export type AllocationBase = (typeof VALID_ALLOCATION_BASES)[number];

export interface CostingPeriodResolution {
  fromDate?: string;
  toDate?: string;
  periodLabel: string;
  periodMonths: number;
  isAllTime: boolean;
}

/**
 * Formats a number as a fixed-precision decimal string (§6 L234).
 */
export function toDecimalString(value: number | null | undefined, decimals = 2): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(decimals);
}

/**
 * Resolves a costing/profitability query window so numerator (costs/revenue/overhead)
 * and denominator (160h/FTE capacity) ALWAYS share an exact time basis (§12.2, §33 #5).
 *
 * Defaults to the current calendar month when no explicit window is supplied,
 * matching monthly overhead pools, monthly budgets, and 160h/month FTE capacity.
 */
export function resolveCostingPeriod(options?: {
  from?: string;
  to?: string;
  period?: string;
  todayYmd?: string;
  transactions?: any[];
}): CostingPeriodResolution {
  const now = options?.todayYmd
    ? new Date(`${options.todayYmd.slice(0, 10)}T00:00:00Z`)
    : new Date();

  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const lastDayOfMonth = new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 0)).getUTCDate();
  const monthStart = `${yyyy}-${mm}-01`;
  const monthEnd = `${yyyy}-${mm}-${String(lastDayOfMonth).padStart(2, '0')}`;
  const todayStr = `${yyyy}-${mm}-${String(now.getUTCDate()).padStart(2, '0')}`;

  const period = String(options?.period || '').trim().toUpperCase();

  if (period === 'ALL') {
    // Compute distinct calendar months covered by valid business transactions (minimum 1)
    const months = new Set<string>();
    for (const t of options?.transactions || []) {
      const d = String(t?.date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(d)) months.add(d);
    }
    const monthCount = Math.max(1, months.size);
    return {
      fromDate: undefined,
      toDate: undefined,
      periodLabel: `All Time (${monthCount} mo)`,
      periodMonths: monthCount,
      isAllTime: true,
    };
  }

  if (period === '3M' || period === '1Y' || period === '12M') {
    const monthsBack = period === '3M' ? 3 : 12;
    const startObj = new Date(Date.UTC(yyyy, now.getUTCMonth() - (monthsBack - 1), 1));
    const sY = startObj.getUTCFullYear();
    const sM = String(startObj.getUTCMonth() + 1).padStart(2, '0');
    const fromDate = `${sY}-${sM}-01`;
    return {
      fromDate,
      toDate: monthEnd,
      periodLabel: `${fromDate} to ${monthEnd} (${monthsBack} mo)`,
      periodMonths: monthsBack,
      isAllTime: false,
    };
  }

  if (options?.from || options?.to) {
    const fromDate = options.from ? options.from.slice(0, 10) : monthStart;
    const toDate = options.to ? options.to.slice(0, 10) : todayStr;
    const periodMonths = countMonthsInRange(fromDate, toDate);
    return {
      fromDate,
      toDate,
      periodLabel: `${fromDate} to ${toDate}`,
      periodMonths,
      isAllTime: false,
    };
  }

  // Default: Current Calendar Month (1M) — matches monthly overhead pools & 160h/FTE capacity
  return {
    fromDate: monthStart,
    toDate: monthEnd,
    periodLabel: `${monthStart} to ${monthEnd}`,
    periodMonths: 1,
    isAllTime: false,
  };
}

/**
 * Computes the inclusive calendar month span between two YYYY-MM-DD dates (minimum 1).
 * For single-month windows (even partial months like Nov 1–Nov 22), returns 1 so
 * monthly FTE capacity (160h) and monthly overhead pools align to the month.
 */
export function countMonthsInRange(fromYmd: string, toYmd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return 1;
  if (fromYmd > toYmd) return 1;
  const [fy, fm] = fromYmd.split('-').map(Number);
  const [ty, tm] = toYmd.split('-').map(Number);
  const diff = (ty - fy) * 12 + (tm - fm) + 1;
  return Math.max(1, diff);
}

/**
 * Checks if a transaction is eligible for Business Department / Operating Costing (§1, §5, §12.3).
 */
export function isEligibleBusinessCostingTransaction(
  t: any,
  fromDate?: string,
  toDate?: string,
): boolean {
  if (!t) return false;
  const status = String(t.status || 'classified').toLowerCase();
  if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) {
    return false;
  }

  const worldScope = String(t.world_scope ?? t.worldScope ?? '').toLowerCase();
  const tags: string[] = Array.isArray(t.tags) ? t.tags.map((x: any) => String(x).toLowerCase()) : [];
  if (worldScope === 'personal' || tags.includes('personal')) {
    return false;
  }

  if (isInternalTransferTransaction(t)) {
    return false;
  }

  // Exclude loan principal repayments / financing flows from operating department expenses (§12.3 L645, §15 L766)
  const desc = String(t.description || t.narration || '').toLowerCase();
  if (
    tags.includes('loan_principal') ||
    tags.includes('loan_repayment') ||
    desc.includes('loan repayment') ||
    desc.includes('loan principal')
  ) {
    return false;
  }

  const tDate = String(t.date || '').slice(0, 10);
  if (fromDate && tDate && tDate < fromDate) return false;
  if (toDate && tDate && tDate > toDate) return false;

  return true;
}

/**
 * Guard against double-counting (§33 #10): returns true when an unassigned transaction's
 * category or narration matches an active operating overhead pool name so it is NOT
 * ALSO inferred into a department's Direct Costs via keyword guessing.
 */
export function isCoveredByDeclaredOverheadPool(
  categoryName: string,
  description: string,
  activeOverheadPools: Array<{ name: string; isOperating?: boolean; amount?: number }>,
): boolean {
  const hay = `${categoryName} ${description}`.toLowerCase();
  if (!hay.trim()) return false;

  const stopWords = new Set(['and', 'the', 'for', 'with', 'pool', 'monthly', 'cost', 'costs', 'expense', 'expenses', 'shared', 'general', 'overhead']);

  for (const pool of activeOverheadPools) {
    if (pool.isOperating === false) continue;
    if (Number(pool.amount || 0) <= 0) continue;
    const pName = String(pool.name || '').toLowerCase().trim();
    if (!pName) continue;
    if (pName.length >= 4 && hay.includes(pName)) return true;

    const tokens = pName
      .split(/[^a-z0-9]+/)
      .filter(tok => tok.length >= 4 && !stopWords.has(tok));
    if (tokens.length > 0 && tokens.some(tok => hay.includes(tok))) {
      return true;
    }
  }
  return false;
}

export interface DepartmentDriverStats {
  departmentId: string;
  departmentName: string;
  headcount: number;
  revenue: number;
  directCosts: number;
  scheduledHours: number;
  squareFootage: number;
  customWeight: number;
}

export interface PoolContributionLine {
  poolId: string;
  poolName: string;
  driverBase: AllocationBase;
  driverValue: number;
  totalDriverValue: number;
  driverSharePercent: number;
  allocatedAmount: number;
  usedFallbackEqual?: boolean;
}

export interface OverheadAllocationEngineResult {
  deptPoolTotals: Map<string, number>;
  deptPoolLines: Map<string, PoolContributionLine[]>;
  allLines: Array<PoolContributionLine & { departmentId: string; departmentName: string }>;
  totalEligiblePoolAmount: number;
  totalAllocatedAmount: number;
  unallocatedRemainder: number;
  includedPoolsCount: number;
  excludedNonOperatingCount: number;
}

/**
 * Authoritative Multi-Driver Overhead Allocation Engine (§12.3 & §33 #10)
 * - Uses Hamilton-Hare Largest-Remainder integer-cent distribution (zero penny drift).
 * - Enforces `isOperating !== false`.
 * - Supports all 9 declared drivers + account-backed pools + period scaling (`periodMonths`).
 * - Consumed identically by Department Cost Rates, Project Costing, and Frozen Allocation Runs.
 */
export function allocateOverheadPools(input: {
  departments: DepartmentDriverStats[];
  allocations: any[];
  accounts?: any[];
  periodMonths?: number;
  orgCurrency?: string;
}): OverheadAllocationEngineResult {
  const {
    departments = [],
    allocations = [],
    accounts = [],
    periodMonths = 1,
    orgCurrency = 'USD',
  } = input;

  const mult = Math.max(1, Number(periodMonths || 1));
  const deptPoolTotals = new Map<string, number>();
  const deptPoolLines = new Map<string, PoolContributionLine[]>();
  const allLines: Array<PoolContributionLine & { departmentId: string; departmentName: string }> = [];

  for (const d of departments) {
    deptPoolTotals.set(d.departmentId, 0);
    deptPoolLines.set(d.departmentId, []);
  }

  let totalEligiblePoolCents = 0;
  let totalAllocatedCents = 0;
  let includedPoolsCount = 0;
  let excludedNonOperatingCount = 0;

  for (const alloc of allocations) {
    const isOperating = alloc.isOperating !== false && alloc.is_operating !== false;
    if (!isOperating) {
      excludedNonOperatingCount++;
      continue;
    }

    let monthlyPool = Number(alloc.amount ?? alloc.allocated_amount ?? 0);
    const accIds: string[] = Array.isArray(alloc.accountIds ?? alloc.account_ids)
      ? (alloc.accountIds ?? alloc.account_ids)
      : [];

    if (monthlyPool <= 0 && accIds.length > 0 && accounts.length > 0) {
      monthlyPool = accIds.reduce((sum: number, accId: string) => {
        const acc = accounts.find((a: any) => String(a.id) === String(accId));
        if (!acc) return sum;
        const rawBal = Math.abs(Number(acc.balance || 0));
        return sum + convertCurrency(rawBal, acc.currency || orgCurrency, orgCurrency);
      }, 0);
    }

    const pool = monthlyPool * mult;
    if (pool <= 0) continue;

    includedPoolsCount++;
    const poolCents = Math.round(pool * 100);
    totalEligiblePoolCents += poolCents;

    if (departments.length === 0) {
      continue; // Recorded cleanly in unallocatedRemainder
    }

    const poolId = String(alloc.id || '');
    const poolName = String(alloc.name || 'Overhead Pool');

    // Direct single-department pool assignment (if specified)
    const directDeptId = String(alloc.department_id || alloc.departmentId || '');
    if (directDeptId && deptPoolTotals.has(directDeptId)) {
      const targetDept = departments.find(d => d.departmentId === directDeptId)!;
      const allocatedAmount = poolCents / 100;
      deptPoolTotals.set(directDeptId, Math.round(((deptPoolTotals.get(directDeptId) || 0) + allocatedAmount) * 100) / 100);
      totalAllocatedCents += poolCents;
      const line: PoolContributionLine = {
        poolId,
        poolName,
        driverBase: 'custom',
        driverValue: 100,
        totalDriverValue: 100,
        driverSharePercent: 100,
        allocatedAmount,
      };
      deptPoolLines.get(directDeptId)!.push(line);
      allLines.push({ ...line, departmentId: directDeptId, departmentName: targetDept.departmentName });
      continue;
    }

    const rawBase = String(alloc.allocationBase ?? alloc.allocation_base ?? alloc.allocation_driver ?? 'headcount').toLowerCase();
    const base: AllocationBase = (VALID_ALLOCATION_BASES as readonly string[]).includes(rawBase)
      ? (rawBase as AllocationBase)
      : 'headcount';

    const poolDepts: any[] = Array.isArray(alloc.departments) ? alloc.departments : [];

    const driverEntries: Array<{ dept: DepartmentDriverStats; driverValue: number }> = [];
    let totalDriverValue = 0;

    for (const dept of departments) {
      let val = 0;
      if (base === 'headcount') {
        val = Math.max(0, dept.headcount);
      } else if (base === 'revenue') {
        val = Math.max(0, dept.revenue);
      } else if (base === 'direct_cost') {
        val = Math.max(0, dept.directCosts);
      } else if (base === 'square_footage') {
        val = Math.max(0, dept.squareFootage);
      } else if (base === 'time_utilization') {
        val = Math.max(0, dept.scheduledHours);
      } else if (base === 'custom' || base === 'manual_weight' || base === 'department_ratio') {
        const customEntry = poolDepts.find(
          (x: any) => String(x?.departmentId || x?.department_id) === dept.departmentId,
        );
        if (customEntry != null && Number(customEntry.percentage ?? customEntry.weight ?? 0) > 0) {
          val = Number(customEntry.percentage ?? customEntry.weight);
        } else if (base !== 'custom') {
          val = Math.max(0, dept.customWeight);
        } else {
          val = 0;
        }
      } else {
        // equal
        val = 1;
      }

      driverEntries.push({ dept, driverValue: val });
      totalDriverValue += val;
    }

    // If totalDriverValue is 0 (e.g. square_footage = 0 everywhere), fall back to equal across
    // departments with active staff if any exist, else across all departments, and flag it.
    const usedFallbackEqual = totalDriverValue <= 0 && base !== 'equal';
    const numDepts = departments.length;
    const effectiveTotal = totalDriverValue > 0 ? totalDriverValue : numDepts;

    let distributedCents = 0;
    const intermediate = driverEntries.map(entry => {
      const share = totalDriverValue > 0 ? entry.driverValue / effectiveTotal : 1 / numDepts;
      const exactCents = poolCents * share;
      const floorCents = Math.floor(exactCents);
      distributedCents += floorCents;
      return {
        dept: entry.dept,
        driverValue: entry.driverValue,
        share,
        cents: floorCents,
        remainder: exactCents - floorCents,
      };
    });

    // Hamilton-Hare deterministic cent tie-breaking
    const leftoverCents = poolCents - distributedCents;
    const sorted = [...intermediate].sort(
      (a, b) => b.remainder - a.remainder || a.dept.departmentId.localeCompare(b.dept.departmentId),
    );
    for (let i = 0; i < leftoverCents; i++) {
      sorted[i].cents += 1;
    }

    for (const item of intermediate) {
      const allocatedAmount = item.cents / 100;
      totalAllocatedCents += item.cents;
      const prev = deptPoolTotals.get(item.dept.departmentId) || 0;
      deptPoolTotals.set(item.dept.departmentId, Math.round((prev + allocatedAmount) * 100) / 100);

      const line: PoolContributionLine = {
        poolId,
        poolName,
        driverBase: base,
        driverValue: Math.round(item.driverValue * 100) / 100,
        totalDriverValue: Math.round(effectiveTotal * 100) / 100,
        driverSharePercent: Math.round(item.share * 10000) / 100,
        allocatedAmount,
        ...(usedFallbackEqual ? { usedFallbackEqual: true } : {}),
      };
      deptPoolLines.get(item.dept.departmentId)!.push(line);
      allLines.push({
        ...line,
        departmentId: item.dept.departmentId,
        departmentName: item.dept.departmentName,
      });
    }
  }

  return {
    deptPoolTotals,
    deptPoolLines,
    allLines,
    totalEligiblePoolAmount: totalEligiblePoolCents / 100,
    totalAllocatedAmount: totalAllocatedCents / 100,
    unallocatedRemainder: Math.max(0, totalEligiblePoolCents - totalAllocatedCents) / 100,
    includedPoolsCount,
    excludedNonOperatingCount,
  };
}

export interface QuoteCalculationInput {
  roleEstimates?: Array<{ id?: string; roleName?: string; estimatedHours?: number; costRate?: number; billingRate?: number }>;
  directPurchases?: Array<{ id?: string; description?: string; category?: string; amount?: number; currency?: string }>;
  overheadAmount?: number;
  contingencyPercent?: number;
  contingencyAmount?: number;
  proposedPrice?: number;
  targetMarginPercent?: number;
  targetMarkupPercent?: number;
}

export interface QuoteCalculationOutput {
  estimatedDirectLabor: number;
  directPurchasesTotal: number;
  overheadAmount: number;
  contingencyAmount: number;
  contingencyPercent: number;
  estimatedTotalCost: number;
  proposedPrice: number;
  profitAmount: number;
  /** Undefined (null) when proposedPrice <= 0 (§14 L739, §33 #9) */
  marginPercent: number | null;
  /** Undefined (null) when estimatedTotalCost <= 0 (§14 L739, §33 #9) */
  markupPercent: number | null;
  /** Undefined (null) when targetMarginPercent is not in [0, 100) */
  requiredPriceForTargetMargin: number | null;
  requiredPriceForTargetMarkup: number;
  isTargetMarginValid: boolean;
  isBelowCost: boolean;
  meetsTargetMargin: boolean;
  /** Decimal string serialization for exact monetary provenance (§6 L234) */
  decimals: {
    estimatedDirectLabor: string;
    directPurchasesTotal: string;
    overheadAmount: string;
    contingencyAmount: string;
    estimatedTotalCost: string;
    proposedPrice: string;
    profitAmount: string;
    requiredPriceForTargetMargin: string | null;
    requiredPriceForTargetMarkup: string;
  };
  /** Invariant (§14 L739): quotes are NEVER recognized revenue */
  isRevenueRecognized: false;
}

/**
 * Authoritative §14 Quote & Pricing Formula Engine (F-05 verified).
 * Explicitly separates Margin (profit / price) from Markup (profit / cost),
 * blocks division by zero & invalid target margins (< 0% or >= 100%),
 * and guarantees `isRevenueRecognized: false`.
 */
export function calculateQuoteFormulas(body: QuoteCalculationInput): QuoteCalculationOutput {
  const roleEstimates = Array.isArray(body?.roleEstimates) ? body.roleEstimates : [];
  const directPurchases = Array.isArray(body?.directPurchases) ? body.directPurchases : [];

  // 1. estimated_direct_labor = Σ estimated_hours_by_role × cost_rate
  const estimatedDirectLabor = roleEstimates.reduce(
    (sum, r) => sum + Math.max(0, Number(r?.estimatedHours || 0)) * Math.max(0, Number(r?.costRate || 0)),
    0,
  );

  // 2. direct_purchases
  const directPurchasesTotal = directPurchases.reduce(
    (sum, p) => sum + Math.max(0, Number(p?.amount || 0)),
    0,
  );

  // 3. attributed_overhead
  const overheadAmount = Math.max(0, Number(body?.overheadAmount || 0));

  // 4. contingency
  const subtotal = estimatedDirectLabor + directPurchasesTotal + overheadAmount;
  const contingencyPercent = Math.max(0, Number(body?.contingencyPercent || 0));
  const contingencyAmount = Number(body?.contingencyAmount || 0) > 0
    ? Math.max(0, Number(body.contingencyAmount))
    : subtotal * (contingencyPercent / 100);

  // 5. estimated_total_cost = labor + direct_purchases + attributed_overhead + contingency
  const estimatedTotalCost = subtotal + contingencyAmount;

  // 6. profit_amount = proposed_price − estimated_total_cost
  const proposedPrice = Math.max(0, Number(body?.proposedPrice || 0));
  const profitAmount = proposedPrice - estimatedTotalCost;

  // 7. margin_percent = profit_amount / proposed_price × 100 (null at zero price — §33 #9)
  const marginPercent = proposedPrice > 0
    ? Math.round(((profitAmount / proposedPrice) * 100) * 100) / 100
    : null;

  // 8. markup_percent = profit_amount / estimated_total_cost × 100 (null at zero cost — §33 #9)
  const markupPercent = estimatedTotalCost > 0
    ? Math.round(((profitAmount / estimatedTotalCost) * 100) * 100) / 100
    : null;

  // 9. required_price_for_target_margin = estimated_total_cost / (1 − target_margin_fraction)
  //    Valid strictly for target margin in [0%, 100%)
  const targetMarginPercent = Number(body?.targetMarginPercent ?? 25);
  const targetMarginFraction = targetMarginPercent / 100;
  const isTargetMarginValid =
    Number.isFinite(targetMarginPercent) &&
    targetMarginFraction >= 0 &&
    targetMarginFraction < 1 &&
    1 - targetMarginFraction > 1e-6;
  const requiredPriceForTargetMargin = isTargetMarginValid
    ? estimatedTotalCost / (1 - targetMarginFraction)
    : null;

  const targetMarkupPercent = Math.max(0, Number(body?.targetMarkupPercent ?? 33.33));
  const requiredPriceForTargetMarkup = estimatedTotalCost * (1 + targetMarkupPercent / 100);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const estLaborR = r2(estimatedDirectLabor);
  const dirPurchR = r2(directPurchasesTotal);
  const ovhR = r2(overheadAmount);
  const contR = r2(contingencyAmount);
  const totalCostR = r2(estimatedTotalCost);
  const priceR = r2(proposedPrice);
  const profitR = r2(profitAmount);
  const reqMarginR = requiredPriceForTargetMargin != null ? r2(requiredPriceForTargetMargin) : null;
  const reqMarkupR = r2(requiredPriceForTargetMarkup);

  return {
    estimatedDirectLabor: estLaborR,
    directPurchasesTotal: dirPurchR,
    overheadAmount: ovhR,
    contingencyAmount: contR,
    contingencyPercent,
    estimatedTotalCost: totalCostR,
    proposedPrice: priceR,
    profitAmount: profitR,
    marginPercent,
    markupPercent,
    requiredPriceForTargetMargin: reqMarginR,
    requiredPriceForTargetMarkup: reqMarkupR,
    isTargetMarginValid,
    isBelowCost: proposedPrice > 0 && proposedPrice < estimatedTotalCost,
    meetsTargetMargin: marginPercent != null && isTargetMarginValid && marginPercent >= targetMarginPercent,
    decimals: {
      estimatedDirectLabor: estLaborR.toFixed(2),
      directPurchasesTotal: dirPurchR.toFixed(2),
      overheadAmount: ovhR.toFixed(2),
      contingencyAmount: contR.toFixed(2),
      estimatedTotalCost: totalCostR.toFixed(2),
      proposedPrice: priceR.toFixed(2),
      profitAmount: profitR.toFixed(2),
      requiredPriceForTargetMargin: reqMarginR != null ? reqMarginR.toFixed(2) : null,
      requiredPriceForTargetMarkup: reqMarkupR.toFixed(2),
    },
    isRevenueRecognized: false,
  };
}

/**
 * Authoritative Multiplicative Partner Commission Calculator.
 * Middleman Cut is deducted from Company's Gross Share:
 *   yourGrossShare = dealAmount × (yourSplitPct / 100)
 *   middlemanCut   = yourGrossShare × (middlemanPct / 100)
 *   yourNetShare   = yourGrossShare − middlemanCut
 */
export function calculateCommissionBreakdown(input: {
  dealAmount: number;
  yourSplitPct: number;
  middlemanPct: number;
  fxRate: number;
}) {
  const dealAmount = Math.max(0, Number(input.dealAmount || 0));
  const yourSplitPct = Math.min(100, Math.max(0, Number(input.yourSplitPct || 0)));
  const middlemanPct = Math.min(100, Math.max(0, Number(input.middlemanPct || 0)));
  const fxRate = Math.max(0, Number(input.fxRate || 0));

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const yourGrossShare = r2((dealAmount * yourSplitPct) / 100);
  const middlemanCut = r2((yourGrossShare * middlemanPct) / 100);
  const yourNetShare = r2(yourGrossShare - middlemanCut);
  const inBaseCurrency = r2(yourNetShare * fxRate);
  const effectiveReturnPct = dealAmount > 0 ? r2((yourNetShare / dealAmount) * 100) : null;

  return {
    dealAmount: r2(dealAmount),
    yourSplitPct,
    middlemanPct,
    fxRate,
    yourGrossShare,
    middlemanCut,
    yourNetShare,
    inBaseCurrency,
    effectiveReturnPct,
    decimals: {
      dealAmount: r2(dealAmount).toFixed(2),
      yourGrossShare: yourGrossShare.toFixed(2),
      middlemanCut: middlemanCut.toFixed(2),
      yourNetShare: yourNetShare.toFixed(2),
      inBaseCurrency: inBaseCurrency.toFixed(2),
    },
  };
}
