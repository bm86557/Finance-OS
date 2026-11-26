/**
 * §7 & §12.2 — Departments & Department Cost Matrix.
 * Mounted at `/organizations/:organizationId/departments` (mergeParams).
 * Backed exclusively by Supabase PostgreSQL with RBAC, audit logging, and
 * strict Handoff v1.2 period/capacity/overhead alignment under the fixed 160h/month FTE model.
 */

import { Router, type Request, type Response } from 'express';
import type { Department } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';
import { requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { computeOrgProjectsProfitability } from '../services/projectScheduleCostEngine.js';
import {
  allocateOverheadPools,
  isCoveredByDeclaredOverheadPool,
  isEligibleBusinessCostingTransaction,
  resolveCostingPeriod,
  toDecimalString,
  type DepartmentDriverStats,
} from '../services/costingEngine.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomainDepartment(row: Record<string, any>): Department {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    budget: row.budget != null ? Number(row.budget) : undefined,
    costCenter: String(row.cost_center ?? ''),
    isActive: Boolean(row.is_active ?? true),
    squareFootage: row.square_footage != null ? Number(row.square_footage) : 0,
    customWeight: row.custom_weight != null ? Number(row.custom_weight) : 1,
  };
}

function mapDomainToDbDepartment(dept: Department): Record<string, unknown> {
  return {
    id: dept.id,
    organization_id: dept.organizationId,
    name: dept.name,
    code: dept.code || '',
    budget: dept.budget != null ? dept.budget : null,
    cost_center: dept.costCenter || '',
    is_active: dept.isActive ?? true,
    square_footage: dept.squareFootage ?? 0,
    custom_weight: dept.customWeight ?? 1,
  };
}

export async function calculateDepartmentProfitability(
  orgId: string,
  dateFrom?: string,
  dateTo?: string,
  period?: string,
): Promise<any[]> {
  const sb = getSupabaseAdminClient();

  let departments: Department[] = [];
  let orgTxns: any[] = [];
  let members: any[] = [];
  let projects: any[] = [];
  let accounts: any[] = [];
  let allocations: any[] = [];
  let sbCategories: any[] = [];
  let agencyTeams: any[] = [];
  let agencyTeamMembers: any[] = [];
  let orgCurrency = 'USD';

  if (sb) {
    try {
      const [
        { data: orgRows },
        { data: sbDepts },
        { data: sbTxns },
        { data: sbMembers },
        { data: sbProjects },
        { data: sbAllocs },
        { data: sbAccounts },
        { data: fetchedCategories },
        { data: sbTeams },
        { data: sbTeamMembers },
      ] = await Promise.all([
        sb.from('organizations').select('base_currency, currency').eq('id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId).order('name', { ascending: true }),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('accounts').select('id, balance, currency').eq('organization_id', orgId),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
        sb.from('agency_teams').select('*').eq('organization_id', orgId),
        sb.from('agency_team_members').select('*').eq('organization_id', orgId),
      ]);

      if (orgRows?.[0]) {
        orgCurrency = String(orgRows[0].base_currency || orgRows[0].currency || 'USD').toUpperCase();
      }

      sbCategories = fetchedCategories || [];
      accounts = sbAccounts || [];
      agencyTeams = sbTeams || [];
      agencyTeamMembers = sbTeamMembers || [];

      if (sbDepts && sbDepts.length > 0) {
        departments = sbDepts.map((d: any) => ({
          id: String(d.id),
          organizationId: String(d.organization_id),
          name: String(d.name),
          code: String(d.code || ''),
          budget: Number(d.budget || 0),
          costCenter: String(d.cost_center || ''),
          isActive: Boolean(d.is_active ?? true),
          squareFootage: Number(d.square_footage || 0),
          customWeight: Number(d.custom_weight || 1),
        }));
        orgTxns = sbTxns || [];
        members = sbMembers || [];
        projects = sbProjects || [];
        allocations = (sbAllocs || []).map((a: any) => ({
          id: String(a.id),
          organizationId: String(a.organization_id),
          name: String(a.name || ''),
          allocationBase: a.allocation_base || 'headcount',
          accountIds: Array.isArray(a.account_ids) ? a.account_ids : [],
          departments: Array.isArray(a.departments) ? a.departments : [],
          amount: Number(a.amount || 0),
          policyVersion: String(a.policy_version || 'v1.2-costing'),
          isOperating: a.is_operating !== false,
        }));
      }
    } catch (sbFetchErr) {
      console.warn('[departments.profitability] Supabase direct query error:', sbFetchErr);
    }
  }

  // Resolve an explicit, matched period window (defaults to Current Calendar Month = 1M)
  // so transactions, scheduled hours, overhead pools, budgets, and 160h/FTE capacity
  // ALWAYS share the exact same time basis (§12.2, §33 #5).
  const eligibleAllTxns = orgTxns.filter(t => isEligibleBusinessCostingTransaction(t));
  const resolvedPeriod = resolveCostingPeriod({
    from: dateFrom,
    to: dateTo,
    period,
    transactions: eligibleAllTxns,
  });
  const effectiveFrom = resolvedPeriod.fromDate;
  const effectiveTo = resolvedPeriod.toDate;
  const periodMonths = resolvedPeriod.periodMonths;

  const activeMembers = members.filter(m => String(m.status || 'active').toLowerCase() === 'active');

  const matchDepartmentId = (rawVal: string | undefined | null): string | null => {
    if (!rawVal) return null;
    const val = String(rawVal).trim().toLowerCase();
    if (!val) return null;
    for (const dept of departments) {
      const dId = dept.id.toLowerCase();
      const dName = dept.name.toLowerCase();
      const dCode = (dept.code || '').toLowerCase();
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
    for (const dept of departments) {
      const fullDeptName = dept.name.toLowerCase().trim();
      const baseName = fullDeptName.replace(/\s*department\s*/g, '').trim();
      if (fullDeptName.length >= 4 && text.includes(fullDeptName)) {
        return dept.id;
      }
      if (baseName === 'marketing' && /\b(marketing\s+campaign|marketing\s+service|marketing\s+retainer|marketing\s+client)\b/i.test(text)) {
        return dept.id;
      }
      if (baseName === 'development' && /\b(development\s+project|software\s+development)\b/i.test(text)) {
        return dept.id;
      }
    }
    return null;
  };

  const deptDirects = new Map<string, {
    revenue: number;
    postedStaffLabor: number;
    contractedMonthlySalary: number;
    allocatedStaffLabor: number;
    directDepartmentExpenses: number;
    directCosts: number;
    laborCostSource: 'posted_payroll' | 'accrued_salary_160h' | 'none';
    headcount: number;
    billableHours: number;
    squareFootage: number;
    customWeight: number;
  }>();
  const userDeptMap = new Map<string, string>();

  for (const dept of departments) {
    const deptMembers = activeMembers.filter(m => {
      // Handoff §12.1 / §33 #9: Do not count an org owner in a delivery department unless explicitly assigned via department_id
      if (String(m.role || '').toLowerCase() === 'owner' && !(m.department_id || m.departmentId)) {
        return false;
      }
      const resolved = matchDepartmentId(m.department_id || m.departmentId) || matchDepartmentId(m.department);
      return resolved === dept.id;
    });

    let contractedMonthlySalary = 0;
    for (const m of deptMembers) {
      const uid = String(m.user_id || m.userId || m.id || '');
      if (uid) userDeptMap.set(uid, dept.id);

      const sCurr = String(m.salary_currency || orgCurrency).toUpperCase();
      const fixedSal = Number(m.fixed_salary || m.salary || 0);
      if (fixedSal > 0) {
        contractedMonthlySalary += convertCurrency(fixedSal, sCurr, orgCurrency);
      } else if (Number(m.hourly_rate || 0) > 0) {
        contractedMonthlySalary += convertCurrency(Number(m.hourly_rate) * 160, sCurr, orgCurrency);
      }
    }

    deptDirects.set(dept.id, {
      revenue: 0,
      postedStaffLabor: 0,
      contractedMonthlySalary: Math.round(contractedMonthlySalary * 100) / 100,
      allocatedStaffLabor: 0,
      directDepartmentExpenses: 0,
      directCosts: 0,
      laborCostSource: 'none',
      headcount: deptMembers.length,
      billableHours: 0,
      squareFootage: Number(dept.squareFootage ?? 0),
      customWeight: Number(dept.customWeight ?? 1),
    });
  }

  const projectMap = new Map<string, any>();
  for (const p of projects) {
    projectMap.set(String(p.id), p);
  }

  // Schedule-driven Mon–Fri 160h/month project allocation filtered to the EXACT SAME period
  const scheduleEngine = computeOrgProjectsProfitability({
    projects,
    transactions: orgTxns,
    members,
    departments,
    overheadAllocations: allocations,
    agencyTeams,
    agencyTeamMembers,
    bankAccounts: accounts,
    orgCurrency,
    fromDate: effectiveFrom,
    toDate: effectiveTo,
  });

  // 1) Active-staff scheduled hours per department (strictly active members in that dept — never injects phantom hours into 0-staff depts!)
  for (const [rawDeptId, hrs] of scheduleEngine.deptActiveStaffScheduledHours.entries()) {
    const deptId = matchDepartmentId(rawDeptId) || rawDeptId;
    const cur = deptId ? deptDirects.get(deptId) : undefined;
    if (cur && cur.headcount > 0 && hrs > 0) {
      cur.billableHours = Math.round((cur.billableHours + hrs) * 10) / 10;
    }
  }

  // 2) Project multi-department effort split map for attributing project revenue credits
  const projectDeptHours = new Map<string, Map<string, number>>();
  for (const [pid, dMap] of scheduleEngine.projectDeptScheduledHours.entries()) {
    const resolvedMap = new Map<string, number>();
    for (const [rawDeptId, hrs] of dMap.entries()) {
      const deptId = matchDepartmentId(rawDeptId) || rawDeptId;
      if (deptId && deptDirects.has(deptId) && hrs > 0) {
        resolvedMap.set(deptId, (resolvedMap.get(deptId) || 0) + hrs);
      }
    }
    if (resolvedMap.size > 0) {
      projectDeptHours.set(pid, resolvedMap);
    }
  }

  const categoryNameMap = new Map<string, string>();
  for (const c of sbCategories) {
    if (c.id && c.name) categoryNameMap.set(String(c.id), String(c.name).toLowerCase());
  }

  const inferDeptFromCat = (catId?: string | null, description = ''): string | null => {
    if (!catId) return null;
    const cName = categoryNameMap.get(String(catId)) || '';
    if (!cName) return null;

    // Anti-double-counting guard (§33 #10): never infer an unassigned expense into a department's
    // Direct Costs if an active operating Overhead Pool already covers that cost bucket!
    if (isCoveredByDeclaredOverheadPool(cName, description, allocations)) {
      return null;
    }

    for (const dept of departments) {
      const dName = String(dept.name || '').toLowerCase();
      if (dName.includes('development') && (cName.includes('software') || cName.includes('tools') || cName.includes('dev') || cName.includes('api') || cName.includes('tech'))) {
        return dept.id;
      }
      if (dName.includes('marketing') && (cName.includes('marketing') || cName.includes('advertising') || cName.includes('ads') || cName.includes('promo') || cName.includes('campaign') || cName.includes('seo') || cName.includes('social'))) {
        return dept.id;
      }
    }
    return null;
  };

  // Single-Pass Transaction Allocator (strictly business-world, non-transfer, period-filtered)
  for (const t of orgTxns) {
    if (!isEligibleBusinessCostingTransaction(t, effectiveFrom, effectiveTo)) continue;

    const rawAmount = Math.abs(Number(t.amount || 0));
    if (rawAmount <= 0) continue;
    const txnCurrency = String(t.currency || orgCurrency).toUpperCase();
    const amount = convertCurrency(rawAmount, txnCurrency, orgCurrency);
    const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];

    const explicitDeptId = matchDepartmentId(t.departmentId || t.department_id);
    const projId = String(t.projectId || t.project_id || '');
    const proj = projId ? projectMap.get(projId) : null;
    const projDeptId = proj ? matchDepartmentId(proj.departmentId || proj.department_id) : null;

    if (t.type === 'credit') {
      const pHoursMap = projId ? projectDeptHours.get(projId) : undefined;
      const totalProjHours = pHoursMap
        ? Array.from(pHoursMap.values()).reduce((s, h) => s + h, 0)
        : 0;

      if (projId && pHoursMap && totalProjHours > 0) {
        for (const [dId, hrs] of pHoursMap.entries()) {
          const share = amount * (hrs / totalProjHours);
          const stat = deptDirects.get(dId);
          if (stat) stat.revenue += share;
        }
      } else {
        const targetDeptId = explicitDeptId || projDeptId || inferCreditDepartmentId(t);
        if (targetDeptId && deptDirects.has(targetDeptId)) {
          deptDirects.get(targetDeptId)!.revenue += amount;
        }
      }
    } else if (t.type === 'debit') {
      const allocTags = tags.filter(tag => tag.startsWith('payslip_alloc:'));
      let allocatedSum = 0;

      for (const aTag of allocTags) {
        const parts = aTag.split(':');
        const tagUserId = parts[2] || '';
        const tagDeptRaw = parts[3] || '';
        // FX-convert tagGross from transaction currency into orgCurrency (§8, §33 #6)
        const tagGrossRaw = Number(parts[4] || 0);
        const tagGross = convertCurrency(tagGrossRaw, txnCurrency, orgCurrency);
        const tagKind = parts[6] || 'salary';
        if (tagGross <= 0) continue;

        const resolvedDeptId =
          matchDepartmentId(tagDeptRaw) ||
          userDeptMap.get(tagUserId) ||
          explicitDeptId ||
          projDeptId;

        const effectiveAlloc = Math.min(tagGross, Math.max(0, amount - allocatedSum));
        if (effectiveAlloc > 0 && resolvedDeptId && deptDirects.has(resolvedDeptId)) {
          const st = deptDirects.get(resolvedDeptId)!;
          if (tagKind === 'reimbursement') {
            st.directDepartmentExpenses += effectiveAlloc;
          } else {
            st.postedStaffLabor += effectiveAlloc;
          }
          allocatedSum += effectiveAlloc;
        }
      }

      const unallocatedRemainder = Math.max(0, amount - allocatedSum);
      if (unallocatedRemainder > 0) {
        const desc = String(t.description || t.narration || '').toLowerCase();
        const targetDeptId = explicitDeptId || projDeptId || inferDeptFromCat(t.category_id || t.categoryId, desc);
        if (targetDeptId && deptDirects.has(targetDeptId)) {
          const st = deptDirects.get(targetDeptId)!;
          const isDirectSalary = desc.includes('salary') || desc.includes('payroll') || tags.includes('salary');
          if (isDirectSalary) {
            st.postedStaffLabor += unallocatedRemainder;
          } else {
            st.directDepartmentExpenses += unallocatedRemainder;
          }
        }
      }
    }
  }

  // Finalize Direct Costs per department (reconciling posted payroll vs 160h/mo contracted salaries without double-counting)
  for (const stat of deptDirects.values()) {
    stat.revenue = Math.round(stat.revenue * 100) / 100;
    stat.directDepartmentExpenses = Math.round(stat.directDepartmentExpenses * 100) / 100;
    const postedLabor = Math.round(stat.postedStaffLabor * 100) / 100;
    const accruedSalary = Math.round(stat.contractedMonthlySalary * periodMonths * 100) / 100;

    if (postedLabor > 0) {
      stat.allocatedStaffLabor = postedLabor;
      stat.laborCostSource = 'posted_payroll';
    } else if (accruedSalary > 0) {
      stat.allocatedStaffLabor = accruedSalary;
      stat.laborCostSource = 'accrued_salary_160h';
    } else {
      stat.allocatedStaffLabor = 0;
      stat.laborCostSource = 'none';
    }

    stat.directCosts = Math.round((stat.allocatedStaffLabor + stat.directDepartmentExpenses) * 100) / 100;
  }

  // --- §12.3 Authoritative Multi-Driver Overhead Allocation Engine (Zero-Leakage Hamilton-Hare) ---
  const driverStats: DepartmentDriverStats[] = departments.map(dept => {
    const s = deptDirects.get(dept.id)!;
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      headcount: s.headcount,
      revenue: s.revenue,
      directCosts: s.directCosts,
      scheduledHours: s.billableHours,
      squareFootage: s.squareFootage,
      customWeight: s.customWeight,
    };
  });

  const overheadResult = allocateOverheadPools({
    departments: driverStats,
    allocations,
    accounts,
    periodMonths,
    orgCurrency,
  });

  const profitability = departments.map(dept => {
    const stats = deptDirects.get(dept.id)!;
    const {
      revenue,
      allocatedStaffLabor,
      directDepartmentExpenses,
      directCosts,
      laborCostSource,
      headcount,
      billableHours,
      squareFootage,
    } = stats;

    const includedPools = overheadResult.deptPoolLines.get(dept.id) || [];
    const allocatedOverhead = overheadResult.deptPoolTotals.get(dept.id) || 0;

    // Full Department Cost (§12.2) = direct_department_cost + allocated_shared_overhead
    const fullDepartmentCost = Math.round((directCosts + allocatedOverhead) * 100) / 100;
    const netProfit = Math.round((revenue - fullDepartmentCost) * 100) / 100;
    // Strictly null when revenue <= 0 (§33 #9 — never 0% or -100%)
    const profitMargin = revenue > 0
      ? Math.round(((revenue - fullDepartmentCost) / revenue) * 1000) / 10
      : null;

    // Fixed 160h/month per FTE scaled by periodMonths; strictly null when headcount === 0 (§12.1 L620)
    const capacityHours = headcount > 0 ? Math.round(headcount * 160 * periodMonths * 100) / 100 : null;
    const totalHours = capacityHours;
    const totalMinutes = capacityHours != null ? Math.round(capacityHours * 60) : null;

    // Utilization strictly null when capacity is undefined (0 staff)
    const utilization = (capacityHours != null && capacityHours > 0)
      ? Math.round((billableHours / capacityHours) * 1000) / 10
      : null;

    // Dual Management Views (§12.2, F-04 L1069: minute rates computed from unrounded totals)
    let directCostPerHour: number | null = null;
    let directCostPerMinute: number | null = null;
    if (capacityHours != null && capacityHours > 0 && directCosts > 0) {
      directCostPerHour = Math.round((directCosts / capacityHours) * 100) / 100;
      directCostPerMinute = Math.round((directCosts / (capacityHours * 60)) * 10000) / 10000;
    }

    let costPerHour: number | null = null;
    let costPerMinute: number | null = null;
    if (capacityHours != null && capacityHours > 0 && fullDepartmentCost > 0) {
      costPerHour = Math.round((fullDepartmentCost / capacityHours) * 100) / 100;
      costPerMinute = Math.round((fullDepartmentCost / (capacityHours * 60)) * 10000) / 10000;
    }

    const productiveHours = billableHours > 0 ? billableHours : null;
    let productiveCostPerHour: number | null = null;
    let productiveCostPerMinute: number | null = null;
    if (productiveHours != null && productiveHours > 0 && fullDepartmentCost > 0) {
      productiveCostPerHour = Math.round((fullDepartmentCost / productiveHours) * 100) / 100;
      productiveCostPerMinute = Math.round((fullDepartmentCost / (productiveHours * 60)) * 10000) / 10000;
    }

    const monthlyBudget = Number(dept.budget || 0);
    const budgetAmount = Math.round(monthlyBudget * periodMonths * 100) / 100;
    const budgetSpent = Math.round(directCosts * 100) / 100;
    const budgetRemaining = Math.max(0, Math.round((budgetAmount - budgetSpent) * 100) / 100);
    const budgetUtilization = budgetAmount > 0 ? Math.round((budgetSpent / budgetAmount) * 1000) / 10 : 0;
    const standardRate = (budgetAmount > 0 && capacityHours != null && capacityHours > 0)
      ? Math.round((budgetAmount / capacityHours) * 100) / 100
      : costPerHour;

    const capacityBasis = capacityHours != null ? 'fte_160h' : 'none';

    const costMatrixMeta = {
      period: resolvedPeriod.periodLabel,
      periodMonths,
      currency: orgCurrency,
      policyVersion: 'v1.2-costing',
      calculationTimestamp: new Date().toISOString(),
      dataFreshness: 'realtime_transactions',
      selectedCapacityHours: capacityHours,
      selectedCapacityBasis: capacityBasis,
      includedPoolsCount: overheadResult.includedPoolsCount,
      excludedNonOperatingPoolsCount: overheadResult.excludedNonOperatingCount,
      totalPoolsAmount: overheadResult.totalEligiblePoolAmount,
      unallocatedOverhead: overheadResult.unallocatedRemainder,
      laborCostSource,
    };

    return {
      departmentId: dept.id,
      departmentName: dept.name,
      revenue,
      allocatedStaffLabor,
      directDepartmentExpenses,
      directCosts,
      allocatedOverhead,
      includedPools,
      fullDepartmentCost,
      netProfit,
      profitMargin,
      headcount,
      revenuePerHead: headcount > 0 ? Math.round((revenue / headcount) * 100) / 100 : null,
      squareFootage,
      totalHours,
      totalMinutes,
      billableHours,
      utilization,
      directCostPerHour,
      directCostPerMinute,
      costPerHour,
      costPerMinute,
      productiveHours,
      productiveCostPerHour,
      productiveCostPerMinute,
      capacityBasis,
      overheadSource: overheadResult.includedPoolsCount > 0 ? 'declared_pools' : 'none',
      costMatrixMeta,
      decimals: {
        revenue: toDecimalString(revenue, 2)!,
        directCosts: toDecimalString(directCosts, 2)!,
        allocatedOverhead: toDecimalString(allocatedOverhead, 2)!,
        fullDepartmentCost: toDecimalString(fullDepartmentCost, 2)!,
        netProfit: toDecimalString(netProfit, 2)!,
        costPerHour: toDecimalString(costPerHour, 2),
        costPerMinute: toDecimalString(costPerMinute, 4),
        directCostPerHour: toDecimalString(directCostPerHour, 2),
        directCostPerMinute: toDecimalString(directCostPerMinute, 4),
      },
      budget: budgetAmount,
      budgetSpent,
      budgetRemaining,
      budgetUtilization,
      standardRate,
    };
  });

  return profitability;
}

export function createDepartmentsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/profitability', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const rawFrom = req.query.from || req.query.dateFrom || req.query.startDate;
    const rawTo = req.query.to || req.query.dateTo || req.query.endDate;
    const rawPeriod = req.query.period;
    const dateFrom = typeof rawFrom === 'string' && rawFrom ? rawFrom : undefined;
    const dateTo = typeof rawTo === 'string' && rawTo ? rawTo : undefined;
    const period = typeof rawPeriod === 'string' && rawPeriod ? rawPeriod : undefined;

    try {
      const profitability = await calculateDepartmentProfitability(orgId, dateFrom, dateTo, period);
      return ok(res, profitability);
    } catch (err: any) {
      console.error('[departments.profitability] Error:', err);
      return fail(res, 500, err?.message || 'Failed to calculate department profitability');
    }
  });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('departments')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[departments.get] Supabase query error:', error);
      return fail(res, 500, error.message);
    }
    return ok(res, (data || []).map(mapDbToDomainDepartment));
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('departments')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Department');
    return ok(res, mapDbToDomainDepartment(data));
  });

  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Department, 'id' | 'organizationId'>;
    if (!data?.name || !data.name.trim()) {
      return fail(res, 400, 'Department name is required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = (data as any).id || ('dept-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newDept: Department = { ...data, name: data.name.trim(), id: newId, organizationId: orgId };

    const dbRow = mapDomainToDbDepartment(newDept);
    const { data: insertedData, error } = await sb
      .from('departments')
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      console.error('[departments.post] Supabase insert error:', error);
      return fail(res, 500, error.message);
    }

    const mapped = mapDbToDomainDepartment(insertedData);
    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'department_created',
        entityType: 'department',
        entityId: mapped.id,
        description: `Created department "${mapped.name}"`,
        afterState: mapped as unknown as Record<string, unknown>,
      });
    } catch { /* non-blocking audit log */ }

    return created(res, mapped, 'Department created');
  });

  r.patch('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<Department>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: beforeRow } = await sb
      .from('departments')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.budget !== undefined) dbUpdates.budget = updates.budget;
    if (updates.costCenter !== undefined) dbUpdates.cost_center = updates.costCenter;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    if (updates.squareFootage !== undefined) dbUpdates.square_footage = Math.max(0, Number(updates.squareFootage));
    if (updates.customWeight !== undefined) dbUpdates.custom_weight = Math.max(0, Number(updates.customWeight));

    const { data, error } = await sb
      .from('departments')
      .update(dbUpdates)
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Department');

    const mapped = mapDbToDomainDepartment(data);
    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'department_updated',
        entityType: 'department',
        entityId: mapped.id,
        description: `Updated department "${mapped.name}"`,
        beforeState: beforeRow ? (mapDbToDomainDepartment(beforeRow) as unknown as Record<string, unknown>) : null,
        afterState: mapped as unknown as Record<string, unknown>,
      });
    } catch { /* non-blocking audit log */ }

    return ok(res, mapped);
  });

  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: beforeRow } = await sb
      .from('departments')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    const { error } = await sb
      .from('departments')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) return fail(res, 500, error.message);

    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'department_deleted',
        entityType: 'department',
        entityId: String(req.params.id),
        description: `Deleted department "${beforeRow?.name || req.params.id}"`,
        beforeState: beforeRow ? (mapDbToDomainDepartment(beforeRow) as unknown as Record<string, unknown>) : null,
      });
    } catch { /* non-blocking audit log */ }

    return ok(res, null, 'Department deleted');
  });

  return r;
}
