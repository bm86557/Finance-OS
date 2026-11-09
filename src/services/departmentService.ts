/**
 * Department Service
 * ===================
 * CRUD for departments with profitability and overhead allocation.
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore`.
 */

import { Department } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse, DepartmentProfitability } from './types';

const DEPT = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/departments`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export const departmentService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Department[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Department[]>(organizationId);
      if (err) return err;
      return apiGet<Department[]>(DEPT(organizationId));
    }

    await simulateDelay();
    const departments = dataStore.departments.filter(d => d.organizationId === organizationId);
    return { success: true, data: departments };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Department | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${DEPT(organizationId)}/${encodeURIComponent(id)}`
        : `/departments/${encodeURIComponent(id)}`;
      return apiGet<Department | null>(path);
    }

    await simulateDelay(80);
    const dept = dataStore.departments.find(d => d.id === id) || null;
    return { success: !!dept, data: dept };
  },

  async create(
    organizationId: string,
    data: Omit<Department, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<Department>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Department>(organizationId);
      if (err) return err;
      const res = await apiPostJson<Omit<Department, 'id' | 'organizationId'>, Department>(DEPT(organizationId), data);
      if (res.success) {
        dataStore.notify('departments');
      }
      return res;
    }

    await simulateDelay(200);
    const newDept: Department = { ...data, id: generateId('dept'), organizationId };
    dataStore.departments.push(newDept);
    dataStore.notify('departments');
    return { success: true, data: newDept, message: 'Department created' };
  },

  async update(
    id: string,
    updates: Partial<Department>,
    organizationId?: string,
  ): Promise<ServiceResponse<Department>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${DEPT(organizationId)}/${encodeURIComponent(id)}`
        : `/departments/${encodeURIComponent(id)}`;
      const res = await apiRequest<Department>(path, { method: 'PATCH', body: JSON.stringify(updates) });
      if (res.success) {
        dataStore.notify('departments');
      }
      return res;
    }

    await simulateDelay(150);
    const idx = dataStore.departments.findIndex(d => d.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Department not found' };
    dataStore.departments[idx] = { ...dataStore.departments[idx], ...updates };
    dataStore.notify('departments');
    return { success: true, data: dataStore.departments[idx] };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${DEPT(organizationId)}/${encodeURIComponent(id)}`
        : `/departments/${encodeURIComponent(id)}`;
      const res = await apiRequest<null>(path, { method: 'DELETE' });
      if (res.success) {
        dataStore.notify('departments');
      }
      return res;
    }

    await simulateDelay(150);
    const idx = dataStore.departments.findIndex(d => d.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Department not found' };
    dataStore.departments.splice(idx, 1);
    dataStore.notify('departments');
    return { success: true, data: null, message: 'Department deleted' };
  },

  async getProfitability(
    organizationId: string,
    params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }
  ): Promise<ServiceResponse<DepartmentProfitability[]>> {
    const err = requireOrg<DepartmentProfitability[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const queryParams = new URLSearchParams();
      if (params?.period) queryParams.append('period', params.period);
      else {
        if (params?.from) queryParams.append('from', params.from);
        if (params?.to) queryParams.append('to', params.to);
      }
      const query = queryParams.toString();
      const url = query ? `${DEPT(organizationId)}/profitability?${query}` : `${DEPT(organizationId)}/profitability`;
      const res = await apiGet<DepartmentProfitability[]>(url);
      if (res.success && Array.isArray(res.data) && res.data.length > 0 && res.data[0].totalHours != null) {
        return res;
      }
    }

    // Direct Supabase calculation fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const [
          { data: sbDepts }, 
          { data: sbTxns }, 
          { data: sbMembers },
          { data: sbProjects },
          { data: sbAllocs },
          { data: sbTimesheetEntries }
        ] = await Promise.all([
          sb.from('departments').select('*').eq('organization_id', organizationId),
          sb.from('transactions').select('*').eq('organization_id', organizationId),
          sb.from('organization_members').select('*').eq('organization_id', organizationId),
          sb.from('projects').select('*').eq('organization_id', organizationId),
          sb.from('overhead_allocations').select('*').eq('organization_id', organizationId),
          sb.from('timesheet_entries').select('*').eq('organization_id', organizationId),
        ]);

        if (sbDepts && sbDepts.length > 0) {
          const depts = sbDepts.map((d: any) => ({
            id: String(d.id),
            organizationId: String(d.organization_id),
            name: String(d.name),
            code: String(d.code || ''),
            budget: Number(d.budget || 0),
            costCenter: String(d.cost_center || ''),
            isActive: Boolean(d.is_active ?? true),
          }));
          const txns = sbTxns || [];
          const members = sbMembers || [];
          const projects = sbProjects || [];
          const allocs = (sbAllocs || []).map((a: any) => ({
            id: String(a.id),
            amount: Number(a.amount || 0),
            allocationBase: a.allocation_base || 'headcount',
            departments: Array.isArray(a.departments) ? a.departments : [],
          }));
          const timesheets = sbTimesheetEntries || [];

          const activeMembers = members.filter((m: any) => (m.status || 'active') === 'active');
          let totalOrgHeadcount = 0;
          let totalOrgRevenue = 0;
          let totalOrgDirectCosts = 0;

          const matchDepartmentId = (rawVal: string | undefined | null): string | null => {
            if (!rawVal) return null;
            const val = String(rawVal).trim().toLowerCase();
            if (!val) return null;
            for (const dept of depts) {
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
            for (const dept of depts) {
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

          const deptDirects = new Map<string, { revenue: number; directCosts: number; staffLabor?: number; headcount: number; billableHours: number }>();
          const userDeptMap = new Map<string, string>();

          for (const dept of depts) {
            const deptMembers = activeMembers.filter((m: any) => {
              const resolved = matchDepartmentId(m.department_id || m.departmentId) || matchDepartmentId(m.department);
              return resolved === dept.id;
            });
            for (const m of deptMembers) {
              const uid = String(m.user_id || m.userId || m.id || '');
              if (uid) userDeptMap.set(uid, dept.id);
            }
            deptDirects.set(dept.id, {
              revenue: 0,
              directCosts: 0,
              staffLabor: 0,
              headcount: deptMembers.length,
              billableHours: 0,
            });
            totalOrgHeadcount += deptMembers.length;
          }

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

          for (const t of txns) {
            const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
            if (tags.includes('transfer')) continue;

            const amount = Math.abs(Number(t.amount || 0));
            if (amount <= 0) continue;

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
                const tagGross = Number(parts[4] || 0);
                if (tagGross <= 0) continue;

                const resolvedDeptId =
                  matchDepartmentId(tagDeptRaw) ||
                  userDeptMap.get(tagUserId) ||
                  explicitDeptId ||
                  projDeptId;

                const effectiveAlloc = Math.min(tagGross, Math.max(0, amount - allocatedSum));
                if (effectiveAlloc > 0 && resolvedDeptId && deptDirects.has(resolvedDeptId)) {
                  deptDirects.get(resolvedDeptId)!.directCosts += effectiveAlloc;
                  (deptDirects.get(resolvedDeptId)! as any).staffLabor = ((deptDirects.get(resolvedDeptId)! as any).staffLabor || 0) + effectiveAlloc;
                  allocatedSum += effectiveAlloc;
                }
              }

              const unallocatedRemainder = Math.max(0, amount - allocatedSum);
              if (unallocatedRemainder > 0) {
                const targetDeptId = explicitDeptId || projDeptId;
                if (targetDeptId && deptDirects.has(targetDeptId)) {
                  deptDirects.get(targetDeptId)!.directCosts += unallocatedRemainder;
                }
              }
            }
          }

          for (const stat of deptDirects.values()) {
            stat.revenue = Math.round(stat.revenue * 100) / 100;
            stat.directCosts = Math.round(stat.directCosts * 100) / 100;
            totalOrgRevenue += stat.revenue;
            totalOrgDirectCosts += stat.directCosts;
          }

          const profitability: DepartmentProfitability[] = depts.map(dept => {
            const stats = deptDirects.get(dept.id) || { revenue: 0, directCosts: 0, headcount: 0, billableHours: 0 };
            const { revenue, directCosts, headcount, billableHours } = stats;

            let allocatedOverhead = 0;
            for (const alloc of allocs) {
              const pool = Number(alloc.amount || 0);
              if (pool > 0) {
                const numDepts = Math.max(1, depts.length);
                const base = alloc.allocationBase || 'headcount';
                if (base === 'headcount') {
                  const ratio = totalOrgHeadcount > 0 ? headcount / totalOrgHeadcount : 1 / numDepts;
                  allocatedOverhead += pool * ratio;
                } else if (base === 'revenue') {
                  const ratio = totalOrgRevenue > 0 ? revenue / totalOrgRevenue : 1 / numDepts;
                  allocatedOverhead += pool * ratio;
                } else if (base === 'direct_cost') {
                  const ratio = totalOrgDirectCosts > 0 ? directCosts / totalOrgDirectCosts : 1 / numDepts;
                  allocatedOverhead += pool * ratio;
                } else {
                  allocatedOverhead += pool / numDepts;
                }
              }
            }

            const capacityHours = headcount > 0 ? headcount * 160 : null;
            const totalHours = capacityHours;
            const totalMinutes = capacityHours != null ? capacityHours * 60 : null;
            const fullDepartmentCost = Math.round((directCosts + allocatedOverhead) * 100) / 100;
            const totalCost = fullDepartmentCost;
            const netProfit = Math.round((revenue - totalCost) * 100) / 100;
            const profitMargin = revenue > 0
              ? Math.round(((revenue - totalCost) / revenue) * 1000) / 10
              : null;

            const utilization = (capacityHours != null && capacityHours > 0 && billableHours > 0)
              ? Math.round((billableHours / capacityHours) * 1000) / 10
              : null;

            // Direct Cost View
            let directCostPerHour: number | null = null;
            let directCostPerMinute: number | null = null;
            if (capacityHours != null && capacityHours > 0 && directCosts > 0) {
              directCostPerHour = Math.round((directCosts / capacityHours) * 100) / 100;
              directCostPerMinute = Math.round((directCostPerHour / 60) * 10000) / 10000;
            }

            // Fully Loaded Cost View
            let costPerHour: number | null = null;
            let costPerMinute: number | null = null;
            if (capacityHours != null && capacityHours > 0 && totalCost > 0) {
              costPerHour = Math.round((totalCost / capacityHours) * 100) / 100;
              costPerMinute = Math.round((costPerHour / 60) * 10000) / 10000;
            }

            const productiveHours = billableHours > 0 ? billableHours : null;
            let productiveCostPerHour: number | null = null;
            let productiveCostPerMinute: number | null = null;
            if (productiveHours != null && productiveHours > 0 && totalCost > 0) {
              productiveCostPerHour = Math.round((totalCost / productiveHours) * 100) / 100;
              productiveCostPerMinute = Math.round((totalCost / productiveHours / 60) * 10000) / 10000;
            }

            const budgetAmount = Number(dept.budget || 0);
            const budgetSpent = Math.round(directCosts);
            const budgetRemaining = Math.max(0, budgetAmount - budgetSpent);
            const budgetUtilization = budgetAmount > 0 ? Math.round((budgetSpent / budgetAmount) * 1000) / 10 : 0;
            const standardRate = (budgetAmount > 0 && capacityHours && capacityHours > 0)
              ? Math.round((budgetAmount / capacityHours) * 100) / 100
              : costPerHour;

            return {
              departmentId: dept.id,
              departmentName: dept.name,
              revenue,
              allocatedStaffLabor: Math.round(((stats as any).staffLabor > 0 ? (stats as any).staffLabor : directCosts * 0.75) * 100) / 100,
              directDepartmentExpenses: Math.round(((stats as any).staffLabor > 0 ? Math.max(0, directCosts - (stats as any).staffLabor) : directCosts * 0.25) * 100) / 100,
              directCosts,
              allocatedOverhead: Math.round(allocatedOverhead),
              fullDepartmentCost,
              netProfit,
              profitMargin,
              headcount,
              revenuePerHead: headcount > 0 ? Math.round(revenue / headcount) : null,
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
              overheadSource: (sbAllocs && sbAllocs.length > 0) ? 'declared_pools' : 'none',
              budget: budgetAmount,
              budgetSpent,
              budgetRemaining,
              budgetUtilization,
              standardRate,
            };
          });

          return { success: true, data: profitability };
        }
      }
    } catch (e) {
      console.warn('[departmentService.getProfitability] Direct Supabase fetch error:', e);
    }

    await simulateDelay();

    const departments = dataStore.departments.filter(d => d.organizationId === organizationId && d.isActive);
    const orgTxns = dataStore.transactions.filter(t => t.organizationId === organizationId);
    const members = dataStore.organizationMembers.filter(m => m.organizationId === organizationId);
    const allocations = dataStore.overheadAllocations.filter(a => a.organizationId === organizationId);

    const profitability: DepartmentProfitability[] = departments.map(dept => {
      const deptTxns = orgTxns.filter(t => t.departmentId === dept.id);
      const revenue = deptTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
      const directCosts = deptTxns.filter(t => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0);

      let allocatedOverhead = 0;
      for (const alloc of allocations) {
        const deptAlloc = alloc.departments.find(d => d.departmentId === dept.id);
        if (deptAlloc) {
          const totalOverhead = alloc.accountIds.reduce((sum, accId) => {
            const acc = dataStore.accounts.find(a => a.id === accId);
            return sum + (acc?.balance || 0);
          }, 0);
          allocatedOverhead += (totalOverhead * (deptAlloc.percentage ?? 0)) / 100;
        }
      }

      const txnMatchedHeadcount = members.filter((m) =>
        orgTxns.some((t) => t.departmentId === dept.id && t.classifiedBy === m.userId),
      ).length;
      let headcount = txnMatchedHeadcount;
      if (headcount === 0) {
        let h = 0;
        for (let i = 0; i < dept.id.length; i++) h = (h * 31 + dept.id.charCodeAt(i)) | 0;
        headcount = 2 + (Math.abs(h) % 5);
      }

      const fullDepartmentCost = Math.round((directCosts + allocatedOverhead) * 100) / 100;
      const totalCost = fullDepartmentCost;
      const netProfit = revenue - totalCost;
      const profitMargin = revenue > 0
        ? Math.round(((revenue - totalCost) / revenue) * 1000) / 10
        : null;

      const capacityHours = headcount > 0 ? headcount * 160 : null;
      const totalHours = capacityHours;
      const totalMinutes = capacityHours != null ? capacityHours * 60 : null;

      const billableRatio = revenue > 0
        ? Math.min(0.85, Math.max(0.45, revenue / (revenue + directCosts + 1)))
        : 0.6;
      const billableHours = capacityHours ? Math.round(capacityHours * billableRatio) : 0;

      const utilization = (capacityHours != null && capacityHours > 0 && billableHours > 0)
        ? Math.round((billableHours / capacityHours) * 1000) / 10
        : null;

      let directCostPerHour: number | null = null;
      let directCostPerMinute: number | null = null;
      if (capacityHours != null && capacityHours > 0 && directCosts > 0) {
        directCostPerHour = Math.round((directCosts / capacityHours) * 100) / 100;
        directCostPerMinute = Math.round((directCostPerHour / 60) * 10000) / 10000;
      }

      let costPerHour: number | null = null;
      let costPerMinute: number | null = null;
      if (capacityHours != null && capacityHours > 0 && totalCost > 0) {
        costPerHour = Math.round((totalCost / capacityHours) * 100) / 100;
        costPerMinute = Math.round((totalCost / capacityHours / 60) * 10000) / 10000;
      }

      const productiveHours = billableHours > 0 ? billableHours : null;
      let productiveCostPerHour: number | null = null;
      let productiveCostPerMinute: number | null = null;
      if (productiveHours != null && productiveHours > 0 && totalCost > 0) {
        productiveCostPerHour = Math.round((totalCost / productiveHours) * 100) / 100;
        productiveCostPerMinute = Math.round((totalCost / productiveHours / 60) * 10000) / 10000;
      }

      const budgetAmount = Number(dept.budget || 0);
      const budgetSpent = Math.round(totalCost);
      const budgetRemaining = Math.max(0, budgetAmount - budgetSpent);
      const budgetUtilization = budgetAmount > 0 ? Math.round((budgetSpent / budgetAmount) * 1000) / 10 : 0;
      const standardRate = (budgetAmount > 0 && capacityHours && capacityHours > 0)
        ? Math.round((budgetAmount / capacityHours) * 100) / 100
        : costPerHour;

      return {
        departmentId: dept.id,
        departmentName: dept.name,
        revenue,
        allocatedStaffLabor: Math.round(directCosts * 0.75 * 100) / 100,
        directDepartmentExpenses: Math.round(directCosts * 0.25 * 100) / 100,
        directCosts,
        allocatedOverhead: Math.round(allocatedOverhead),
        fullDepartmentCost,
        netProfit,
        profitMargin,
        headcount,
        revenuePerHead: headcount > 0 ? Math.round(revenue / headcount) : null,
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
        overheadSource: 'none',
        budget: budgetAmount,
        budgetSpent,
        budgetRemaining,
        budgetUtilization,
        standardRate,
      };
    });

    return { success: true, data: profitability };
  },
};
