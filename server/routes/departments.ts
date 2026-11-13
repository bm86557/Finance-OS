/**
 * §7 — Departments. Mounted at `/organizations/:organizationId/departments` (mergeParams).
 * Supports Supabase DB persistence when configured + fallback to in-memory store.
 */

import { Router, type Request, type Response } from 'express';
import type { Department, OverheadAllocation } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomainAllocation(row: Record<string, any>): OverheadAllocation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    allocationBase: row.allocation_base || 'headcount',
    accountIds: Array.isArray(row.account_ids) ? row.account_ids : [],
    departments: Array.isArray(row.departments) ? row.departments : [],
    amount: row.amount != null ? Number(row.amount) : undefined,
  };
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
  dateTo?: string
): Promise<any[]> {
  const sb = getSupabaseAdminClient();

  // Direct calculation from Supabase tables if connected, else in-memory store
  let departments: Department[] = [];
  let orgTxns: any[] = [];
  let members: any[] = [];
  let timesheets: any[] = [];
  let projects: any[] = [];
  let accounts: any[] = [];
  let allocations: any[] = [];
  let sbCategories: any[] = [];

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
        { data: sbTimesheetEntries },
        { data: fetchedCategories }
      ] = await Promise.all([
        sb.from('organizations').select('base_currency, currency').eq('id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('timesheet_entries').select('*').eq('organization_id', orgId),
        sb.from('categories').select('id, name').eq('organization_id', orgId),
      ]);

      if (orgRows?.[0]) {
        orgCurrency = String(orgRows[0].base_currency || orgRows[0].currency || 'USD').toUpperCase();
      }

      sbCategories = fetchedCategories || [];

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
        projects = (sbProjects || []).map((p: any) => ({
          id: String(p.id),
          organizationId: String(p.organization_id),
          name: String(p.name),
          code: String(p.code || ''),
          clientName: String(p.client_name || ''),
          departmentId: String(p.department_id || ''),
          status: p.status,
          startDate: p.start_date,
          endDate: p.end_date,
          quotedAmount: Number(p.quoted_amount || 0),
          actualCost: Number(p.actual_cost || 0),
          currency: p.currency || 'USD',
        }));
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
        timesheets = (sbTimesheetEntries || []).map((t: any) => ({
          id: String(t.id),
          organizationId: String(t.organization_id),
          userId: String(t.user_id),
          projectId: String(t.project_id),
          hours: Number(t.hours || 0),
          date: t.date,
          status: t.status,
          billable: t.billable !== false,
        }));
      }
    } catch (sbFetchErr) {
      console.warn('[departments.profitability] Supabase direct query error:', sbFetchErr);
    }
  }



  // Pre-calculate org totals for proportional allocation bases
  const activeMembers = members.filter(m => (m.status || 'active') === 'active');

  // Helper: Resolve a department identifier or member's text department to an active department ID
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

  // Helper: Strict AI / Semantic Department Attribution ONLY for explicit department credit inflows (e.g. "Marketing Campaign")
  const inferCreditDepartmentId = (t: any): string | null => {
    const text = `${t.description || ''} ${t.narration || ''}`.toLowerCase();
    if (!text.trim()) return null;

    // Match explicit whole-word department phrases on credit inflows (e.g. "marketing campaign", "development department")
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

  // Initialize deptDirects and map each user_id to their home department
  // Initialize deptDirects and map each user_id to their home department (§12.2 Direct Cost Matrix)
  const deptDirects = new Map<string, {
    revenue: number;
    allocatedStaffLabor: number;
    directDepartmentExpenses: number;
    directCosts: number;
    headcount: number;
    billableHours: number;
    squareFootage: number;
    customWeight: number;
  }>();
  const userDeptMap = new Map<string, string>();
  let totalOrgRevenue = 0;
  let totalOrgDirectCosts = 0;
  let totalOrgHeadcount = 0;

  for (const dept of departments) {
    const deptMembers = activeMembers.filter(m => {
      const resolved = matchDepartmentId(m.department_id || m.departmentId) || matchDepartmentId(m.department);
      return resolved === dept.id;
    });
    for (const m of deptMembers) {
      const uid = String(m.user_id || m.userId || m.id || '');
      if (uid) userDeptMap.set(uid, dept.id);
    }
    deptDirects.set(dept.id, {
      revenue: 0,
      allocatedStaffLabor: 0,
      directDepartmentExpenses: 0,
      directCosts: 0,
      headcount: deptMembers.length,
      billableHours: 0,
      squareFootage: Number((dept as any).squareFootage ?? (dept as any).square_footage ?? 0),
      customWeight: Number((dept as any).customWeight ?? (dept as any).custom_weight ?? 1),
    });
    totalOrgHeadcount += deptMembers.length;
  }

  // Map projects and compute per-project logged hours by department (Model A: Timesheet Effort Split)
  const projectMap = new Map<string, any>();
  for (const p of projects) {
    projectMap.set(String(p.id), p);
  }

  const projectDeptHours = new Map<string, Map<string, number>>();
  for (const ts of timesheets) {
    const hrs = Number(ts.hours || 0);
    if (hrs <= 0) continue;
    const uid = String(ts.user_id || ts.userId || '');
    const pid = String(ts.project_id || ts.projectId || '');
    const proj = projectMap.get(pid);
    const deptId =
      userDeptMap.get(uid) ||
      matchDepartmentId(proj?.departmentId || proj?.department_id) ||
      null;

    if (deptId && deptDirects.has(deptId)) {
      if (ts.billable !== false) {
        const cur = deptDirects.get(deptId)!;
        cur.billableHours = Math.round((cur.billableHours + hrs) * 10) / 10;
      }
      if (pid) {
        if (!projectDeptHours.has(pid)) projectDeptHours.set(pid, new Map());
        const pMap = projectDeptHours.get(pid)!;
        pMap.set(deptId, (pMap.get(deptId) || 0) + hrs);
      }
    }
  }

  const categoryNameMap = new Map<string, string>();
  if (Array.isArray(sbCategories)) {
    for (const c of sbCategories) {
      if (c.id && c.name) categoryNameMap.set(String(c.id), String(c.name).toLowerCase());
    }
  }
  const inferDeptFromCat = (catId?: string | null): string | null => {
    if (!catId) return null;
    const cName = categoryNameMap.get(String(catId)) || '';
    if (!cName) return null;
    for (const dept of departments) {
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

  // Single-Pass Transaction Allocator (Guarantees 0% double-counting across departments)
  for (const t of orgTxns) {
    const status = String(t.status || 'classified').toLowerCase();
    if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) continue;

    const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
    if (t.is_transfer || t.transfer_group_id || tags.includes('transfer')) continue;

    const tDate = String(t.date || '').slice(0, 10);
    if (dateFrom && tDate < dateFrom) continue;
    if (dateTo && tDate > dateTo) continue;

    const rawAmount = Math.abs(Number(t.amount || 0));
    if (rawAmount <= 0) continue;
    const amount = convertCurrency(rawAmount, t.currency || orgCurrency, orgCurrency);

    const explicitDeptId = matchDepartmentId(t.departmentId || t.department_id);
    const projId = String(t.projectId || t.project_id || '');
    const proj = projId ? projectMap.get(projId) : null;
    const projDeptId = proj ? matchDepartmentId(proj.departmentId || proj.department_id) : null;

    if (t.type === 'credit') {
      // Priority 1: Project-Linked Multi-Department Effort Split (Model A)
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
        // Priority 2 & 3: Explicit Dept -> Project Home Dept -> Explicit Credit Department Match
        const targetDeptId = explicitDeptId || projDeptId || inferCreditDepartmentId(t);
        if (targetDeptId && deptDirects.has(targetDeptId)) {
          deptDirects.get(targetDeptId)!.revenue += amount;
        }
      }
    } else if (t.type === 'debit') {
      // Priority 1: Check for Payslip Split Allocations on this transaction (Zero Double-Counting)
      // Tag format: payslip_alloc:<payslipId>:<userId>:<deptId>:<gross>:<period>
      const allocTags = tags.filter(tag => tag.startsWith('payslip_alloc:'));
      let allocatedSum = 0;

      for (const aTag of allocTags) {
        const parts = aTag.split(':');
        // parts[0] = 'payslip_alloc', parts[1] = payslipId, parts[2] = userId, parts[3] = deptId, parts[4] = gross
        const tagUserId = parts[2] || '';
        const tagDeptRaw = parts[3] || '';
        const tagGross = Number(parts[4] || 0);
        if (tagGross <= 0) continue;

        const resolvedDeptId =
          matchDepartmentId(tagDeptRaw) ||
          userDeptMap.get(tagUserId) ||
          explicitDeptId ||
          projDeptId;

        const effectiveAlloc = Math.min(tagGross, Math.max(0, amount - allocatedSum));
        if (effectiveAlloc > 0 && resolvedDeptId && deptDirects.has(resolvedDeptId)) {
          const st = deptDirects.get(resolvedDeptId)!;
          st.allocatedStaffLabor += effectiveAlloc;
          st.directCosts += effectiveAlloc;
          allocatedSum += effectiveAlloc;
        }
      }

      // Priority 2: Direct department expenses (non-labor operational debits)
      const unallocatedRemainder = Math.max(0, amount - allocatedSum);
      if (unallocatedRemainder > 0) {
        const targetDeptId = explicitDeptId || projDeptId || inferDeptFromCat(t.category_id || t.categoryId);
        if (targetDeptId && deptDirects.has(targetDeptId)) {
          const st = deptDirects.get(targetDeptId)!;
          const desc = String(t.description || '').toLowerCase();
          const narr = String(t.narration || '').toLowerCase();
          const isDirectSalary = desc.includes('salary') || desc.includes('payroll') || tags.includes('salary');
          if (isDirectSalary) {
            st.allocatedStaffLabor += unallocatedRemainder;
          } else {
            st.directDepartmentExpenses += unallocatedRemainder;
          }
          st.directCosts += unallocatedRemainder;
        }
      }
    }
  }

  for (const stat of deptDirects.values()) {
    stat.revenue = Math.round(stat.revenue * 100) / 100;
    stat.allocatedStaffLabor = Math.round(stat.allocatedStaffLabor * 100) / 100;
    stat.directDepartmentExpenses = Math.round(stat.directDepartmentExpenses * 100) / 100;
    stat.directCosts = Math.round((stat.allocatedStaffLabor + stat.directDepartmentExpenses) * 100) / 100;
    totalOrgRevenue += stat.revenue;
    totalOrgDirectCosts += stat.directCosts;
  }

  // --- §12.3 Multi-Driver Overhead Allocation Engine (Zero-Leakage Residual Reconciliation) ---
  const deptPoolContributions = new Map<string, any[]>();
  for (const dept of departments) {
    deptPoolContributions.set(dept.id, []);
  }

  let totalAllocatedSharedOverhead = 0;

  for (const alloc of allocations) {
    let pool = alloc.amount != null && alloc.amount > 0 ? Number(alloc.amount) : 0;
    if (pool === 0 && alloc.accountIds?.length > 0) {
      pool = alloc.accountIds.reduce((sum: number, accId: string) => {
        const acc = accounts.find(a => a.id === accId);
        return sum + Math.abs(Number(acc?.balance || 0));
      }, 0);
    }
    if (pool <= 0) continue;

    const base = String(alloc.allocationBase || 'headcount').toLowerCase();
    const numDepts = Math.max(1, departments.length);

    // Compute driver values for each department
    const driverEntries: Array<{
      deptId: string;
      driverValue: number;
    }> = [];

    let totalDriverValue = 0;

    for (const dept of departments) {
      const stats = deptDirects.get(dept.id) || {
        headcount: 0,
        revenue: 0,
        directCosts: 0,
        billableHours: 0,
        squareFootage: 0,
        customWeight: 1,
      };

      let val = 0;
      if (base === 'headcount') {
        val = stats.headcount;
      } else if (base === 'revenue') {
        val = Math.max(0, stats.revenue);
      } else if (base === 'direct_cost') {
        val = Math.max(0, stats.directCosts);
      } else if (base === 'square_footage') {
        val = Math.max(0, stats.squareFootage);
      } else if (base === 'time_utilization') {
        val = Math.max(0, stats.billableHours);
      } else if (base === 'department_ratio' || base === 'manual_weight') {
        val = Math.max(0, stats.customWeight);
      } else if (base === 'custom') {
        const deptAlloc = alloc.departments?.find((d: any) => (d.departmentId || d.department_id) === dept.id);
        val = Math.max(0, Number(deptAlloc?.percentage || deptAlloc?.weight || 0));
      } else {
        // equal
        val = 1;
      }

      driverEntries.push({ deptId: dept.id, driverValue: val });
      totalDriverValue += val;
    }

    // If total driver value is 0 (e.g. no square footage or revenue recorded anywhere),
    // fallback cleanly to equal distribution across all departments
    const effectiveTotalDriver = totalDriverValue > 0 ? totalDriverValue : numDepts;

    // Hamilton-Hare / Largest Remainder deterministic integer-cent allocation
    const poolCents = Math.round(pool * 100);
    let distributedCents = 0;

    const intermediate = driverEntries.map(entry => {
      const share = totalDriverValue > 0 ? entry.driverValue / effectiveTotalDriver : 1 / numDepts;
      const exactCents = poolCents * share;
      const floorCents = Math.floor(exactCents);
      const remainder = exactCents - floorCents;
      distributedCents += floorCents;
      return {
        deptId: entry.deptId,
        driverValue: entry.driverValue,
        share,
        cents: floorCents,
        remainder,
      };
    });

    // Distribute leftover cents deterministically to departments with highest remainders
    const leftoverCents = poolCents - distributedCents;
    const sortedRemainder = [...intermediate].sort((a, b) => b.remainder - a.remainder || a.deptId.localeCompare(b.deptId));
    for (let i = 0; i < leftoverCents; i++) {
      sortedRemainder[i].cents += 1;
    }

    // Record final allocation for each department
    for (const item of intermediate) {
      const allocatedAmount = Math.round(item.cents) / 100;
      const sharePercent = Math.round(item.share * 10000) / 100;
      deptPoolContributions.get(item.deptId)?.push({
        poolId: alloc.id,
        poolName: alloc.name,
        driverBase: base as any,
        driverValue: Math.round(item.driverValue * 100) / 100,
        totalDriverValue: Math.round(effectiveTotalDriver * 100) / 100,
        driverSharePercent: sharePercent,
        allocatedAmount,
      });
    }
    totalAllocatedSharedOverhead += pool;
  }

  const profitability = departments.map(dept => {
    const stats = deptDirects.get(dept.id) || {
      revenue: 0,
      allocatedStaffLabor: 0,
      directDepartmentExpenses: 0,
      directCosts: 0,
      headcount: 0,
      billableHours: 0,
      squareFootage: 0,
      customWeight: 1,
    };
    const { revenue, allocatedStaffLabor, directDepartmentExpenses, directCosts, headcount, billableHours, squareFootage } = stats;

    const includedPools = deptPoolContributions.get(dept.id) || [];
    const allocatedOverhead = Math.round(includedPools.reduce((sum, p) => sum + p.allocatedAmount, 0) * 100) / 100;

    // Full Department Cost (§12.2) = direct_department_cost + allocated_shared_overhead
    const fullDepartmentCost = Math.round((directCosts + allocatedOverhead) * 100) / 100;
    const totalCost = fullDepartmentCost;
    const netProfit = Math.round((revenue - fullDepartmentCost) * 100) / 100;
    const profitMargin = revenue > 0
      ? Math.round(((revenue - fullDepartmentCost) / revenue) * 1000) / 10
      : null;

    // Standard FTE working capacity in financial systems = 160 hours / month (40 hrs/wk * 4 wks)
    // When headcount is 0, standard capacity is null per Handoff v1.2 §12.1 L620.
    const capacityHours = headcount > 0 ? headcount * 160 : null;
    const totalHours = capacityHours;
    const totalMinutes = capacityHours != null ? capacityHours * 60 : null;

    // Real utilization: billable hours logged against standard capacity
    const utilization = (capacityHours != null && capacityHours > 0 && billableHours > 0)
      ? Math.round((billableHours / capacityHours) * 1000) / 10
      : null;

    // --- §12.2 Dual Management Views ---
    // 1. Direct Cost View: direct costs only (labor + direct department expenses)
    let directCostPerHour: number | null = null;
    let directCostPerMinute: number | null = null;
    if (capacityHours != null && capacityHours > 0 && directCosts > 0) {
      directCostPerHour = Math.round((directCosts / capacityHours) * 100) / 100;
      directCostPerMinute = Math.round((directCostPerHour / 60) * 10000) / 10000;
    }

    // 2. Fully Loaded Cost View: direct costs + allocated shared overhead
    let costPerHour: number | null = null;
    let costPerMinute: number | null = null;
    if (capacityHours != null && capacityHours > 0 && fullDepartmentCost > 0) {
      costPerHour = Math.round((fullDepartmentCost / capacityHours) * 100) / 100;
      costPerMinute = Math.round((costPerHour / 60) * 10000) / 10000;
    }

    // 3. Productive Capacity Cost Rate: based on hours actually logged on projects/timesheets
    const productiveHours = billableHours > 0 ? billableHours : null;
    let productiveCostPerHour: number | null = null;
    let productiveCostPerMinute: number | null = null;
    if (productiveHours != null && productiveHours > 0 && fullDepartmentCost > 0) {
      productiveCostPerHour = Math.round((fullDepartmentCost / productiveHours) * 100) / 100;
      productiveCostPerMinute = Math.round((productiveCostPerHour / 60) * 10000) / 10000;
    }

    const budgetAmount = Number(dept.budget || 0);
    // Department direct operational expenditures applied against budget
    const budgetSpent = Math.round(directCosts);
    const budgetRemaining = Math.max(0, budgetAmount - budgetSpent);
    const budgetUtilization = budgetAmount > 0 ? Math.round((budgetSpent / budgetAmount) * 1000) / 10 : 0;
    const standardRate = (budgetAmount > 0 && capacityHours && capacityHours > 0)
      ? Math.round((budgetAmount / capacityHours) * 100) / 100
      : costPerHour;

    const costMatrixMeta: any = {
      period: (dateFrom && dateTo) ? `${dateFrom} to ${dateTo}` : 'Current Month (Rolling)',
      currency: orgCurrency,
      policyVersion: 'v1.2-costing',
      calculationTimestamp: new Date().toISOString(),
      dataFreshness: 'realtime_transactions',
      selectedCapacityHours: capacityHours,
      selectedCapacityBasis: capacityHours != null ? 'fte_160h' : 'none',
      includedPoolsCount: allocations.length,
      totalPoolsAmount: totalAllocatedSharedOverhead,
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
      revenuePerHead: headcount > 0 ? Math.round(revenue / headcount) : null,
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
      capacityBasis: 'fte_160h',
      overheadSource: allocations.length > 0 ? 'declared_pools' : 'none',
      costMatrixMeta,
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
    const dateFrom = typeof rawFrom === 'string' ? rawFrom : undefined;
    const dateTo = typeof rawTo === 'string' ? rawTo : undefined;

    try {
      const profitability = await calculateDepartmentProfitability(orgId, dateFrom, dateTo);
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

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Department, 'id' | 'organizationId'>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = (data as any).id || ('dept-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newDept: Department = { ...data, id: newId, organizationId: orgId };

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

    return created(res, mapDbToDomainDepartment(insertedData), 'Department created');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<Department>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.budget !== undefined) dbUpdates.budget = updates.budget;
    if (updates.costCenter !== undefined) dbUpdates.cost_center = updates.costCenter;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    if (updates.squareFootage !== undefined) dbUpdates.square_footage = updates.squareFootage;
    if (updates.customWeight !== undefined) dbUpdates.custom_weight = updates.customWeight;

    const { data, error } = await sb
      .from('departments')
      .update(dbUpdates)
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Department');
    return ok(res, mapDbToDomainDepartment(data));
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { error } = await sb
      .from('departments')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) return fail(res, 500, error.message);
    return ok(res, null, 'Department deleted');
  });

  return r;
}
