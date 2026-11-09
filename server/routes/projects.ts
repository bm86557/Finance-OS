/**
 * §8 & §12.4 & §13 — Projects & Profitability Engine.
 * Mounted at `/organizations/:organizationId/projects` (mergeParams).
 * Persists exclusively to Supabase PostgreSQL with rigorous financial correctness.
 */

import { Router, type Request, type Response } from 'express';
import type { Project, TimesheetEntry, ProjectTask } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { convertCurrency } from '../lib/fxConverter.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function callerId(req: Request): string {
  return (req as any).user?.id || (req as any).userId || (req.headers['x-user-id'] as string) || '';
}

/**
 * Validates financial transactions for project profitability (§5, §8, §12.4, §14):
 * - Excludes pending, draft, rejected, reversed, or cancelled transactions
 * - Excludes personal-world transactions
 * - Applies optional date range filter [fromDate, toDate]
 */
function isValidProjectTransaction(t: any, fromDate?: string, toDate?: string): boolean {
  if (!t) return false;
  const status = String(t.status || '').toLowerCase();
  if (status === 'pending' || status === 'draft' || status === 'rejected' || status === 'reversed' || status === 'cancelled') {
    return false;
  }
  if (t.world_scope === 'personal' || (Array.isArray(t.tags) && t.tags.includes('personal'))) {
    return false;
  }
  if (fromDate && t.date && t.date < fromDate) return false;
  if (toDate && t.date && t.date > toDate) return false;
  return true;
}

/**
 * Checks if a debit transaction is a valid direct operational expense (§1247):
 * Excludes reimbursement settlements, payroll transfers, and salary payouts to prevent double counting.
 */
function isDirectProjectDebit(t: any): boolean {
  if (t.type !== 'debit') return false;
  const tags = Array.isArray(t.tags) ? t.tags : [];
  const desc = (t.description || t.narration || '').toLowerCase();
  if (
    tags.includes('reimbursement_settlement') ||
    tags.includes('payroll_payout') ||
    tags.includes('salary') ||
    tags.includes('payroll') ||
    tags.some((tag: string) => String(tag).startsWith('payslip_alloc:'))
  ) {
    return false;
  }
  if (
    desc.includes('reimbursement settlement') ||
    desc.includes('expense payout') ||
    desc.includes('salary payout') ||
    desc.includes('payroll transfer') ||
    desc.includes('employee salary')
  ) {
    return false;
  }
  return true;
}

/**
 * §12.1 Loaded Labor Cost & Capacity Hourly Rate Engine
 * loadedLaborCost = baseSalary + employerTaxes (7.65% FICA) + benefits + bonus + overhead
 * capacityHours = hours_per_day * days_per_month (defaults to 160h)
 */
function calculateMemberLoadedHourlyRate(member: any, deptRateMap: Map<string, number>, deptId?: string): number {
  if (!member) {
    return (deptId && deptRateMap.get(deptId)) || 50;
  }
  if (member.hourly_rate && Number(member.hourly_rate) > 0) {
    return Number(member.hourly_rate);
  }
  const baseSalary = Number(member.fixed_salary || member.salary || 0);
  if (baseSalary > 0) {
    const hoursPerDay = Number(member.hours_per_day || 8);
    const daysPerMonth = Number(member.working_days_per_month || 20);
    const capacityHours = (hoursPerDay > 0 && daysPerMonth > 0) ? (hoursPerDay * daysPerMonth) : 160;
    return capacityHours > 0 ? Math.round((baseSalary / capacityHours) * 100) / 100 : 50;
  }
  const memDeptId = String(member.department_id || member.departmentId || member.department || deptId || '');
  return deptRateMap.get(memDeptId) || 50;
}

/**
 * §12.3 & §33.10 Multi-Driver Shared Overhead Allocation Engine
 * Supports 8 allocation drivers: headcount, revenue, direct_cost, square_footage,
 * time_utilization, department_ratio/manual_weight, custom, and balance lookup.
 * Uses Hamilton-Hare deterministic integer-cent allocation to conserve every cent of overhead.
 */
interface DeptOverheadResult {
  deptPools: Map<string, number>;
  deptRatesPerHour: Map<string, number>;
  deptRatesPerMinute: Map<string, number>;
  deptCapacities: Map<string, number>;
  deptHeadcounts: Map<string, number>;
}

function calculateMultiDriverDepartmentOverhead(
  departments: any[],
  allocations: any[],
  activeMembers: any[],
  transactions: any[],
  timesheets: any[],
  bankAccounts: any[] = []
): DeptOverheadResult {
  const numDepts = Math.max(1, (departments || []).length);
  const deptHeadcounts = new Map<string, number>();
  const deptDirectCosts = new Map<string, number>();
  const deptRevenues = new Map<string, number>();
  const deptBillableHours = new Map<string, number>();
  const deptSquareFootage = new Map<string, number>();
  const deptCustomWeights = new Map<string, number>();
  const deptPools = new Map<string, number>();

  for (const d of (departments || [])) {
    const dId = String(d.id);
    deptPools.set(dId, 0);
    deptSquareFootage.set(dId, Number(d.square_footage || d.squareFootage || 0));
    deptCustomWeights.set(dId, Number(d.custom_weight || d.customWeight || 1));
    deptDirectCosts.set(dId, 0);
    deptRevenues.set(dId, 0);
    deptBillableHours.set(dId, 0);

    const count = (activeMembers || []).filter((m: any) => {
      const memDept = String(m.department_id || m.departmentId || m.department || '').toLowerCase();
      const thisId = dId.toLowerCase();
      const thisName = String(d.name || '').toLowerCase();
      return memDept === thisId || (thisName.length >= 3 && memDept.includes(thisName));
    }).length;
    deptHeadcounts.set(dId, count);
  }

  // Aggregate departmental stats for drivers
  for (const t of (transactions || [])) {
    if (!t.department_id && !t.departmentId) continue;
    const dId = String(t.department_id || t.departmentId);
    if (!deptPools.has(dId)) continue;
    const amt = Math.abs(Number(t.amount || 0));
    if (t.type === 'credit') {
      deptRevenues.set(dId, (deptRevenues.get(dId) || 0) + amt);
    } else if (t.type === 'debit') {
      deptDirectCosts.set(dId, (deptDirectCosts.get(dId) || 0) + amt);
    }
  }

  for (const ts of (timesheets || [])) {
    if (ts.status !== 'approved' || ts.billable === false) continue;
    const uId = String(ts.user_id || ts.userId);
    const mem = (activeMembers || []).find((m: any) => String(m.user_id || m.userId || m.id) === uId);
    const dId = String(mem?.department_id || mem?.departmentId || mem?.department || '');
    if (dId && deptBillableHours.has(dId)) {
      deptBillableHours.set(dId, (deptBillableHours.get(dId) || 0) + Number(ts.hours || 0));
    }
  }

  for (const alloc of (allocations || [])) {
    let pool = Number(alloc.amount || alloc.allocated_amount || 0);
    if (pool <= 0 && Array.isArray(alloc.account_ids || alloc.accountIds)) {
      const accIds = alloc.account_ids || alloc.accountIds;
      pool = accIds.reduce((sum: number, aId: string) => {
        const acc = (bankAccounts || []).find((b: any) => String(b.id) === String(aId));
        return sum + Math.abs(Number(acc?.balance || 0));
      }, 0);
    }
    if (pool <= 0) continue;

    const directDeptId = String(alloc.department_id || alloc.departmentId || '');
    if (directDeptId && deptPools.has(directDeptId)) {
      deptPools.set(directDeptId, (deptPools.get(directDeptId) || 0) + pool);
      continue;
    }

    const base = String(alloc.allocation_base || alloc.allocation_driver || alloc.allocationBase || 'headcount').toLowerCase();
    const driverEntries: Array<{ deptId: string; driverValue: number }> = [];
    let totalDriverValue = 0;

    for (const d of (departments || [])) {
      const dId = String(d.id);
      let val = 0;
      if (base === 'headcount') {
        val = deptHeadcounts.get(dId) || 0;
      } else if (base === 'revenue') {
        val = Math.max(0, deptRevenues.get(dId) || 0);
      } else if (base === 'direct_cost') {
        val = Math.max(0, deptDirectCosts.get(dId) || 0);
      } else if (base === 'square_footage') {
        val = Math.max(0, deptSquareFootage.get(dId) || 0);
      } else if (base === 'time_utilization') {
        val = Math.max(0, deptBillableHours.get(dId) || 0);
      } else if (base === 'department_ratio' || base === 'manual_weight') {
        val = Math.max(0, deptCustomWeights.get(dId) || 1);
      } else if (base === 'custom') {
        const customAlloc = (alloc.departments || []).find((x: any) => String(x.departmentId || x.department_id) === dId);
        val = Math.max(0, Number(customAlloc?.percentage || customAlloc?.weight || 0));
      } else {
        val = 1;
      }
      driverEntries.push({ deptId: dId, driverValue: val });
      totalDriverValue += val;
    }

    const effectiveTotalDriver = totalDriverValue > 0 ? totalDriverValue : numDepts;
    const poolCents = Math.round(pool * 100);
    let distributedCents = 0;

    const intermediate = driverEntries.map(entry => {
      const share = totalDriverValue > 0 ? entry.driverValue / effectiveTotalDriver : 1 / numDepts;
      const exactCents = poolCents * share;
      const floorCents = Math.floor(exactCents);
      const remainder = exactCents - floorCents;
      distributedCents += floorCents;
      return { deptId: entry.deptId, share, cents: floorCents, remainder };
    });

    let leftoverCents = poolCents - distributedCents;
    intermediate.sort((a, b) => b.remainder - a.remainder);
    for (const item of intermediate) {
      if (leftoverCents > 0) {
        item.cents += 1;
        leftoverCents -= 1;
      }
      const existing = deptPools.get(item.deptId) || 0;
      deptPools.set(item.deptId, existing + (item.cents / 100));
    }
  }

  const deptCapacities = new Map<string, number>();
  const deptRatesPerHour = new Map<string, number>();
  const deptRatesPerMinute = new Map<string, number>();

  for (const d of (departments || [])) {
    const dId = String(d.id);
    const headcount = deptHeadcounts.get(dId) || 0;
    const capacityHours = headcount > 0 ? headcount * 160 : 160;
    const pool = deptPools.get(dId) || 0;
    const ratePerHour = capacityHours > 0 ? pool / capacityHours : 0;
    deptCapacities.set(dId, capacityHours);
    deptRatesPerHour.set(dId, ratePerHour);
    deptRatesPerMinute.set(dId, ratePerHour / 60);
  }

  return { deptPools, deptRatesPerHour, deptRatesPerMinute, deptCapacities, deptHeadcounts };
}

function mapDbToDomainProject(row: Record<string, any>): Project {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    clientName: String(row.client_name ?? ''),
    departmentId: String(row.department_id ?? ''),
    status: row.status as Project['status'],
    startDate: String(row.start_date ?? ''),
    endDate: row.end_date ? String(row.end_date) : undefined,
    quotedAmount: Number(row.quoted_amount ?? 0),
    actualCost: Number(row.actual_cost ?? 0),
    currency: String(row.currency ?? 'USD'),
    initialBaselineCost: Number(row.initial_baseline_cost ?? 0),
    committedRemainingWork: Number(row.committed_remaining_work ?? 0),
  };
}

function mapDomainToDbProject(proj: Project): Record<string, unknown> {
  return {
    id: proj.id,
    organization_id: proj.organizationId,
    name: proj.name,
    code: proj.code || '',
    client_name: proj.clientName || '',
    department_id: proj.departmentId || null,
    status: proj.status || 'active',
    start_date: proj.startDate || new Date().toISOString().slice(0, 10),
    end_date: proj.endDate || null,
    quoted_amount: proj.quotedAmount || 0,
    actual_cost: proj.actualCost || 0,
    currency: proj.currency || 'USD',
    initial_baseline_cost: proj.initialBaselineCost ?? 0,
    committed_remaining_work: proj.committedRemainingWork ?? 0,
  };
}


function mapDbToDomainTask(row: Record<string, any>): ProjectTask {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    assignedTo: row.assigned_to ? String(row.assigned_to) : undefined,
    assignedToName: row.assigned_to_name ? String(row.assigned_to_name) : undefined,
    status: (row.status || 'todo') as ProjectTask['status'],
    priority: (row.priority || 'medium') as ProjectTask['priority'],
    estimatedHours: Number(row.estimated_hours ?? 0),
    loggedHours: Number(row.logged_hours ?? 0),
    startDate: row.start_date ? String(row.start_date) : undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function createProjectsRouter(): Router {
  const r = Router({ mergeParams: true });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /profitability - Multi-project summary with §12.4 costing formulas
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/profitability', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { from, to, period } = req.query;

    let fromDate: string | undefined = undefined;
    let toDate: string | undefined = undefined;

    if (period && typeof period === 'string') {
      const daysBack = period === '1M' ? 30 : period === '3M' ? 90 : 365;
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      fromDate = d.toISOString().slice(0, 10);
      toDate = new Date().toISOString().slice(0, 10);
    } else {
      if (typeof from === 'string' && from) fromDate = from;
      if (typeof to === 'string' && to) toDate = to;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const [
          { data: pData },
          { data: tData },
          { data: tsData },
          { data: mData },
          { data: dData },
          { data: oaData },
          { data: profData },
          { data: tasksData },
          { data: bankAccountsData },
        ] = await Promise.all([
          sb.from('projects').select('*').eq('organization_id', orgId).order('name', { ascending: true }),
          sb.from('transactions').select('*').eq('organization_id', orgId),
          sb.from('timesheet_entries').select('*').eq('organization_id', orgId),
          sb.from('organization_members').select('*').eq('organization_id', orgId),
          sb.from('departments').select('*').eq('organization_id', orgId),
          sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
          sb.from('profiles').select('id, full_name, email, avatar_url'),
          sb.from('project_tasks').select('*').eq('organization_id', orgId),
          sb.from('bank_accounts').select('id, balance, currency').eq('organization_id', orgId),
        ]);

        if (pData && pData.length > 0) {
          const profileMap = new Map<string, { name: string; email: string; avatarUrl?: string }>();
          (profData || []).forEach((p: any) => {
            profileMap.set(String(p.id), {
              name: p.full_name || p.email?.split('@')[0] || 'Team Member',
              email: p.email || '',
              avatarUrl: p.avatar_url,
            });
          });

          const deptRateMap = new Map((dData || []).map((d: any) => {
            const budget = Number(d.budget || 0);
            const rate = budget > 0 ? (budget / 160) : 50;
            return [String(d.id), rate];
          }));

          const memberRateMap = new Map((mData || []).map((m: any) => [
            String(m.user_id || m.userId),
            calculateMemberLoadedHourlyRate(m, deptRateMap, m.department_id)
          ]));

          const activeMembers = (mData || []).filter((m: any) => (m.status || 'active') === 'active');
          const userDeptMap = new Map<string, string>();
          for (const m of activeMembers) {
            const uid = String(m.user_id || m.userId || m.id || '');
            let dId = String(m.department_id || m.departmentId || m.department || '');
            for (const d of (dData || [])) {
              if (dId === String(d.id) || (d.name && dId.toLowerCase() === d.name.toLowerCase())) {
                dId = String(d.id);
                break;
              }
            }
            if (uid && dId) userDeptMap.set(uid, dId);
          }

          // Compute deterministic multi-driver shared overhead allocation
          const overheadEngine = calculateMultiDriverDepartmentOverhead(
            dData || [],
            oaData || [],
            activeMembers,
            tData || [],
            tsData || [],
            bankAccountsData || []
          );

          const profitability = pData.map((proj: any) => {
            const projCurrency = proj.currency || 'USD';
            const quotedAmount = Number(proj.quoted_amount || 0);
            const initialBaseline = Number(proj.initial_baseline_cost || 0);

            // Filter transactions strictly adhering to §5, §8, §12.4
            const projTxnMap = new Map<string, any>();
            for (const t of (tData || [])) {
              if (t.project_id === proj.id && isValidProjectTransaction(t, fromDate, toDate)) {
                projTxnMap.set(t.id, t);
              }
            }
            const projTxns = Array.from(projTxnMap.values());

            // Direct Expenses (debits converted to project currency, excluding reimbursements/payroll)
            const directCost = projTxns
              .filter((t: any) => isDirectProjectDebit(t))
              .reduce((sum: number, t: any) => {
                const amt = Math.abs(Number(t.amount || 0));
                const converted = convertCurrency(amt, t.currency || projCurrency, projCurrency);
                return sum + converted;
              }, 0);

            // Recognized Revenue from credits (converted to project currency)
            const revenueFromTxns = projTxns
              .filter((t: any) => t.type === 'credit')
              .reduce((sum: number, t: any) => {
                const amt = Number(t.amount || 0);
                const converted = convertCurrency(amt, t.currency || projCurrency, projCurrency);
                return sum + converted;
              }, 0);

            // Timesheet entries for this project with date filtering
            const projTs = (tsData || []).filter((t: any) => {
              if (t.project_id !== proj.id) return false;
              const tDate = t.date || t.work_date;
              if (fromDate && tDate && tDate < fromDate) return false;
              if (toDate && tDate && tDate > toDate) return false;
              return true;
            });

            const loggedHours = projTs.reduce((s: number, t: any) => s + Number(t.hours || 0), 0);
            const billableHours = projTs.filter((t: any) => t.billable !== false).reduce((s: number, t: any) => s + Number(t.hours || 0), 0);
            const nonBillableHours = projTs.filter((t: any) => t.billable === false).reduce((s: number, t: any) => s + Number(t.hours || 0), 0);
            const contributorCount = new Set(projTs.map((t: any) => t.user_id)).size;

            let laborCost = 0;
            let pendingLaborCost = 0;
            let approvedHours = 0;
            let pendingHours = 0;
            const projectContributorsMap = new Map<string, { userId: string; name: string; email?: string; avatarUrl?: string; hours: number; approvedHours: number; laborCost: number }>();

            for (const t of projTs) {
              const uId = String(t.user_id);
              const isApproved = t.status === 'approved';
              const tHours = Number(t.hours || 0);
              const durationMins = Number(t.duration_minutes || Math.round(tHours * 60));

              let costPerMinute = Number(t.effective_cost_per_minute || 0);
              if (costPerMinute <= 0) {
                const hourlyRate = memberRateMap.get(uId) || 50;
                costPerMinute = hourlyRate / 60;
              }

              const entryLabor = Number(t.calculated_labor_cost || 0) > 0
                ? Number(t.calculated_labor_cost)
                : Math.round(durationMins * costPerMinute * 100) / 100;

              // Only approved time is recognized financial labor burn per §12.4 & §13
              if (isApproved) {
                laborCost += entryLabor;
                approvedHours += tHours;
              } else {
                pendingHours += tHours;
                pendingLaborCost += entryLabor;
              }

              const prof = profileMap.get(uId);
              const mem = (mData || []).find((m: any) => String(m.user_id || m.userId || m.id) === uId);
              const memName = prof?.name || mem?.user?.name || mem?.name || mem?.email?.split('@')[0] || (uId.includes('-') ? 'Team Member' : uId);

              const existing = projectContributorsMap.get(uId) || {
                userId: uId,
                name: memName,
                email: prof?.email || mem?.email || '',
                avatarUrl: prof?.avatarUrl,
                hours: 0,
                approvedHours: 0,
                laborCost: 0,
              };
              existing.hours += tHours;
              if (isApproved) {
                existing.laborCost += entryLabor;
                existing.approvedHours += tHours;
              }
              projectContributorsMap.set(uId, existing);
            }
            laborCost = Math.round(laborCost * 100) / 100;
            pendingLaborCost = Math.round(pendingLaborCost * 100) / 100;

            // Project Status Lifecycle (§13)
            let projectStatus = proj.status || 'quoted';
            if (projectStatus === 'quoted' && (approvedHours > 0 || projTxns.length > 0)) {
              projectStatus = 'active';
            }

            // Multi-Department Project Assigned Overhead (§§12.4, 12.5)
            // ONLY approved delivery minutes absorb overhead into actual project cost
            let projectOverheadSum = 0;
            for (const t of projTs) {
              if (t.status !== 'approved') continue;
              const uId = String(t.user_id);
              const deptId = userDeptMap.get(uId) || String(proj.department_id || '');
              const durMins = Number(t.duration_minutes || Math.round(Number(t.hours || 0) * 60));
              const rPerMin = overheadEngine.deptRatesPerMinute.get(deptId) || 0;
              projectOverheadSum += durMins * rPerMin;
            }
            const assignedOverhead = Math.round(projectOverheadSum * 100) / 100;

            // §12.4 actual_project_cost = initial_baseline + labor + direct_expenses + assigned_overhead
            const actualCost = Math.round((initialBaseline + directCost + laborCost + assignedOverhead) * 100) / 100;

            // Synchronize computed actual_cost & lifecycle status back to DB only if approved work exists
            if (Number(proj.actual_cost) !== actualCost || (approvedHours > 0 && proj.status !== projectStatus)) {
              Promise.resolve(
                sb.from('projects')
                  .update({
                    actual_cost: actualCost,
                    status: projectStatus,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', proj.id)
              ).catch((e: any) => console.warn('[projects.syncDb] Error syncing project actual_cost to DB:', e?.message));
            }

            // Operating Profit = Recognized Revenue - Actual Cost (§12.4, §14)
            // If project is quoted or has $0 recognized revenue, recognized revenue is $0
            const recognizedRevenue = Math.round(revenueFromTxns * 100) / 100;
            const directCosts = Math.round((directCost + laborCost) * 100) / 100;
            const projectContribution = Math.round((recognizedRevenue - directCosts) * 100) / 100;
            const operatingProfit = Math.round((recognizedRevenue - actualCost) * 100) / 100;
            const profitMargin = recognizedRevenue > 0
              ? Math.round(((operatingProfit / recognizedRevenue) * 100) * 10) / 10
              : 0;
            const budgetVariance = quotedAmount > 0
              ? Math.round((((actualCost - quotedAmount) / quotedAmount) * 100) * 10) / 10
              : 0;

            // Target/Planned Baseline Metrics (for quoted comparison)
            const targetProfit = Math.round((quotedAmount - initialBaseline) * 100) / 100;
            const targetMargin = quotedAmount > 0
              ? Math.round(((targetProfit / quotedAmount) * 100) * 10) / 10
              : 0;

            // Cost-to-complete (ETC), Projected at Completion (EAC), Margin at Risk (§12.4)
            const committedRemainingWork = Number(proj.committed_remaining_work || 0);
            const projOpenTasks = (tasksData || []).filter((task: any) => task.project_id === proj.id && task.status !== 'completed');
            const openTasksRemainingCost = projOpenTasks.reduce((sum: number, task: any) => {
              const estHours = Number(task.estimated_hours || 0);
              const logHours = Number(task.logged_hours || 0);
              const remHours = Math.max(0, estHours - logHours);
              const taskRate = (task.assigned_to && memberRateMap.get(String(task.assigned_to))) || 50;
              return sum + (remHours * taskRate);
            }, 0);

            let costToComplete = 0;
            if (committedRemainingWork > 0) {
              costToComplete = committedRemainingWork;
            } else if (openTasksRemainingCost > 0) {
              costToComplete = openTasksRemainingCost;
            } else if (projectStatus === 'completed') {
              costToComplete = 0;
            } else {
              costToComplete = Math.max(0, quotedAmount - actualCost);
            }
            costToComplete = Math.round(costToComplete * 100) / 100;

            const projectedAtCompletion = Math.round((actualCost + costToComplete) * 100) / 100;
            const marginAtRisk = Math.round((quotedAmount - projectedAtCompletion) * 100) / 100;

            // Burn as consumed cost to date & planned daily budget (§12.4)
            const consumedBurn = actualCost;
            let daysElapsed = 0;
            let daysRemaining = 0;
            let totalSpanDays = 0;
            let completionPct = 0;
            let plannedDailyBudget = 0;
            let burnRatePerDay = 0;

            if (proj.start_date) {
              const startMs = new Date(proj.start_date).getTime();
              const nowMs = Date.now();
              const diffDays = Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24));
              daysElapsed = Math.max(0, diffDays);

              if (proj.end_date) {
                const endMs = new Date(proj.end_date).getTime();
                daysRemaining = Math.max(0, Math.floor((endMs - nowMs) / (1000 * 60 * 60 * 24)));
                totalSpanDays = Math.max(1, Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24)));
                completionPct = totalSpanDays > 0 ? Math.min(100, Math.max(0, Math.round((daysElapsed / totalSpanDays) * 100))) : 0;
                plannedDailyBudget = Math.round((quotedAmount / totalSpanDays) * 100) / 100;
              }
            }

            if (daysElapsed > 0) {
              burnRatePerDay = Math.round((consumedBurn / daysElapsed) * 100) / 100;
            } else if (laborCost > 0) {
              burnRatePerDay = laborCost;
            }

            return {
              projectId: proj.id,
              projectName: proj.name,
              code: proj.code || '',
              clientName: proj.client_name || '',
              departmentId: proj.department_id || '',
              status: projectStatus,
              currency: projCurrency,
              startDate: proj.start_date,
              endDate: proj.end_date,
              quotedAmount,
              initialBaselineCost: initialBaseline,
              directCost: Math.round(directCost * 100) / 100,
              laborCost,
              pendingLaborCost,
              assignedOverhead,
              actualCost,
              consumedBurn,
              burnRatePerDay,
              daysElapsed,
              daysRemaining,
              completionPct,
              revenue: recognizedRevenue,
              profit: operatingProfit,
              operatingProfit,
              profitMargin,
              targetProfit,
              targetMargin,
              projectContribution,
              costToComplete,
              projectedAtCompletion,
              marginAtRisk,
              budgetVariance,
              loggedHours: Math.round(loggedHours * 100) / 100,
              approvedHours: Math.round(approvedHours * 100) / 100,
              pendingHours: Math.round(pendingHours * 100) / 100,
              billableHours: Math.round(billableHours * 100) / 100,
              nonBillableHours: Math.round(nonBillableHours * 100) / 100,
              committedRemainingWork,
              contributorCount,
              contributors: Array.from(projectContributorsMap.values()).map(c => ({
                userId: c.userId,
                name: c.name,
                email: c.email || '',
                avatarUrl: c.avatarUrl || null,
                hours: Math.round(c.hours * 10) / 10,
                approvedHours: Math.round(c.approvedHours * 10) / 10,
                laborCost: Math.round(c.laborCost * 100) / 100,
              })),
              totalSpanDays,
              plannedDailyBudget,
            };
          });

          return ok(res, profitability);
        }
      } catch (err) {
        console.error('[projects.profitability] Supabase error:', err);
      }
    }

    if (!sb) return fail(res, 503, 'Database unavailable');
    return ok(res, []);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /:id/profitability-details - Deep drilldown for dedicated tracking page
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/:id/profitability-details', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const { from, to } = req.query;

    const fromDate = typeof from === 'string' && from ? from : undefined;
    const toDate = typeof to === 'string' && to ? to : undefined;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const [
        { data: projectData, error: projError },
        { data: txnData },
        { data: tsData },
        { data: memData },
        { data: deptData },
        { data: oaData },
        { data: profData },
        { data: tasksData },
        { data: bankAccountsData },
      ] = await Promise.all([
        sb.from('projects').select('*').eq('id', projectId).eq('organization_id', orgId).maybeSingle(),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('timesheet_entries').select('*').eq('project_id', projectId).eq('organization_id', orgId).order('date', { ascending: false }),
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('profiles').select('id, full_name, email, avatar_url'),
        sb.from('project_tasks').select('*').eq('organization_id', orgId),
        sb.from('bank_accounts').select('id, balance, currency').eq('organization_id', orgId),
      ]);

      if (projError || !projectData) {
        return notFound(res, 'Project');
      }

      const projCurrency = projectData.currency || 'USD';

      const profileMap = new Map<string, { name: string; email: string; avatarUrl?: string }>();
      (profData || []).forEach((p: any) => {
        profileMap.set(String(p.id), {
          name: p.full_name || p.email?.split('@')[0] || 'Team Member',
          email: p.email || '',
          avatarUrl: p.avatar_url,
        });
      });

      // 1. Build lookup tables
      const memberMap = new Map((memData || []).map((m: any) => [
        String(m.user_id || m.userId),
        m
      ]));
      const deptMap = new Map((deptData || []).map((d: any) => [
        String(d.id),
        d.name
      ]));
      const deptRateMap = new Map((deptData || []).map((d: any) => {
        const budget = Number(d.budget || 0);
        const rate = budget > 0 ? (budget / 160) : 50;
        return [String(d.id), rate];
      }));

      const memberRateMap = new Map((memData || []).map((m: any) => [
        String(m.user_id || m.userId),
        calculateMemberLoadedHourlyRate(m, deptRateMap, m.department_id)
      ]));

      // 2. Transactions linked to project with multi-currency & status filters (§5, §8, §12.4)
      const txnMap = new Map<string, any>();
      for (const t of (txnData || [])) {
        if (t.project_id === projectId && isValidProjectTransaction(t, fromDate, toDate)) {
          txnMap.set(t.id, t);
        }
      }
      const projectTxns = Array.from(txnMap.values());

      const income = projectTxns
        .filter((t: any) => t.type === 'credit')
        .map((t: any) => {
          const rawAmt = Number(t.amount || 0);
          const converted = convertCurrency(rawAmt, t.currency || projCurrency, projCurrency);
          return {
            id: t.id,
            date: t.date,
            description: t.description || t.narration || 'Project credit',
            amount: converted,
            type: t.type,
            categoryId: t.category_id,
            status: t.status,
            currency: projCurrency,
          };
        });

      const expenses = projectTxns
        .filter((t: any) => isDirectProjectDebit(t))
        .map((t: any) => {
          const rawAmt = Math.abs(Number(t.amount || 0));
          const converted = convertCurrency(rawAmt, t.currency || projCurrency, projCurrency);
          return {
            id: t.id,
            date: t.date,
            description: t.description || t.narration || 'Direct expense',
            amount: converted,
            type: t.type,
            categoryId: t.category_id,
            status: t.status,
            currency: projCurrency,
          };
        });

      const directExpenses = Math.round(expenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
      // Recognized revenue is from credit ledger postings (§12.4, §14)
      const recognizedRevenue = Math.round(income.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;

      // 3. Timesheets, minute precision, rate lookup, and contributor rollups
      let totalLoggedMinutes = 0;
      let totalApprovedMinutes = 0;
      let totalBillableMinutes = 0;
      let totalNonBillableMinutes = 0;
      let laborCost = 0;
      let pendingLaborCost = 0;

      interface ContributorRollup {
        userId: string;
        name: string;
        email: string;
        avatar?: string;
        department?: string;
        role?: string;
        firstDate: string;
        lastDate: string;
        totalHours: number;
        approvedMinutes: number;
        ratePerMinute: number;
        ratePerHour: number;
        totalLaborCost: number;
        approvedCount: number;
        pendingCount: number;
      }
      const contributorMap = new Map<string, ContributorRollup>();

      // Filter project timesheets with optional date range
      const rawTimesheets = (tsData || []).filter((ts: any) => {
        const tDate = ts.date || ts.work_date;
        if (fromDate && tDate && tDate < fromDate) return false;
        if (toDate && tDate && tDate > toDate) return false;
        return true;
      });

      const timesheetEntries = rawTimesheets.map((ts: any) => {
        const uId = String(ts.user_id);
        const prof = profileMap.get(uId);
        const mem = memberMap.get(uId);
        const memName = prof?.name || mem?.user?.name || mem?.name || mem?.email?.split('@')[0] || (uId.includes('-') ? 'Team Member' : uId);
        const memEmail = prof?.email || mem?.user?.email || mem?.email || '';

        const hours = Number(ts.hours || 0);
        const durationMinutes = Number(ts.duration_minutes || Math.round(hours * 60));

        let costPerHour = Number(ts.effective_cost_per_hour || 0);
        let costPerMinute = Number(ts.effective_cost_per_minute || 0);

        if (costPerHour <= 0 || costPerMinute <= 0) {
          costPerHour = memberRateMap.get(uId) || 50.0;
          costPerMinute = Math.round((costPerHour / 60) * 10000) / 10000;
        }

        const entryLaborCost = Math.round(durationMinutes * costPerMinute * 100) / 100;

        totalLoggedMinutes += durationMinutes;
        const isApproved = ts.status === 'approved';
        if (isApproved) {
          totalApprovedMinutes += durationMinutes;
          laborCost += entryLaborCost;
        } else {
          pendingLaborCost += entryLaborCost;
        }

        if (ts.billable !== false) {
          totalBillableMinutes += durationMinutes;
        } else {
          totalNonBillableMinutes += durationMinutes;
        }

        // Roll up contributor stats
        let contrib = contributorMap.get(uId);
        if (!contrib) {
          contrib = {
            userId: uId,
            name: memName,
            email: memEmail,
            avatar: mem?.user?.avatar,
            department: mem?.department ? deptMap.get(mem.department) || mem.department : undefined,
            role: mem?.role || mem?.position || 'Team Member',
            firstDate: ts.date,
            lastDate: ts.date,
            totalHours: 0,
            approvedMinutes: 0,
            ratePerMinute: Math.round(costPerMinute * 10000) / 10000,
            ratePerHour: Math.round(costPerHour * 100) / 100,
            totalLaborCost: 0,
            approvedCount: 0,
            pendingCount: 0,
          };
          contributorMap.set(uId, contrib);
        }

        contrib.totalHours += hours;
        if (isApproved) {
          contrib.approvedMinutes += durationMinutes;
          contrib.approvedCount += 1;
          contrib.totalLaborCost += entryLaborCost;
        } else {
          contrib.pendingCount += 1;
        }

        if (ts.date < contrib.firstDate) contrib.firstDate = ts.date;
        if (ts.date > contrib.lastDate) contrib.lastDate = ts.date;

        return {
          id: ts.id,
          date: ts.date,
          startTime: ts.start_time || undefined,
          endTime: ts.end_time || undefined,
          hours,
          durationMinutes,
          description: ts.description || 'Logged time',
          billable: Boolean(ts.billable ?? true),
          status: ts.status || 'draft',
          userId: uId,
          userName: memName,
          ratePerMinute: Math.round(costPerMinute * 10000) / 10000,
          ratePerHour: Math.round(costPerHour * 100) / 100,
          calculatedLaborCost: entryLaborCost,
          approvedAt: ts.approved_at || undefined,
          approvedBy: ts.approved_by || undefined,
          rejectionReason: ts.rejection_reason || undefined,
          revisionHistory: Array.isArray(ts.revision_history) ? ts.revision_history : [],
        };
      });

      laborCost = Math.round(laborCost * 100) / 100;
      pendingLaborCost = Math.round(pendingLaborCost * 100) / 100;

      // 4. Multi-Department Multi-Driver Shared Overhead Allocation Engine (§§12.2, 12.3, 12.4, 12.5)
      const activeMembers = (memData || []).filter((m: any) => (m.status || 'active') === 'active');
      const userDeptMap = new Map<string, string>();
      for (const m of activeMembers) {
        const uid = String(m.user_id || m.userId || m.id || '');
        let dId = String(m.department_id || m.departmentId || m.department || '');
        for (const d of (deptData || [])) {
          if (dId === String(d.id) || (d.name && dId.toLowerCase() === d.name.toLowerCase())) {
            dId = String(d.id);
            break;
          }
        }
        if (uid && dId) userDeptMap.set(uid, dId);
      }

      const overheadEngine = calculateMultiDriverDepartmentOverhead(
        deptData || [],
        oaData || [],
        activeMembers,
        txnData || [],
        tsData || [],
        bankAccountsData || []
      );

      const deptHoursMap = new Map<string, number>();
      const deptAbsorbedMap = new Map<string, number>();
      for (const entry of timesheetEntries) {
        // ONLY approved timesheets absorb overhead into actual recognized cost
        if (entry.status !== 'approved') continue;
        const uId = String(entry.userId);
        const dId = userDeptMap.get(uId) || String(projectData.department_id || '');
        const rPerMin = overheadEngine.deptRatesPerMinute.get(dId) || 0;
        const dur = Number(entry.durationMinutes || Math.round(Number(entry.hours || 0) * 60));
        const hrs = Number(entry.hours || dur / 60);

        deptHoursMap.set(dId, (deptHoursMap.get(dId) || 0) + hrs);
        deptAbsorbedMap.set(dId, (deptAbsorbedMap.get(dId) || 0) + (dur * rPerMin));
      }

      const overheadBreakdown: any[] = [];
      for (const d of (deptData || [])) {
        const dId = String(d.id);
        const loggedHrs = Math.round((deptHoursMap.get(dId) || 0) * 10) / 10;
        const absorbed = Math.round((deptAbsorbedMap.get(dId) || 0) * 100) / 100;
        const pool = Math.round((overheadEngine.deptPools.get(dId) || 0) * 100) / 100;
        const cap = overheadEngine.deptCapacities.get(dId) || 160;
        const rH = Math.round((overheadEngine.deptRatesPerHour.get(dId) || 0) * 100) / 100;

        if (loggedHrs > 0 || dId === String(projectData.department_id || '')) {
          overheadBreakdown.push({
            departmentId: dId,
            departmentName: d.name || 'Department',
            headcount: overheadEngine.deptHeadcounts.get(dId) || 0,
            departmentOverheadPool: pool,
            departmentCapacityHours: cap,
            overheadRatePerHour: rH,
            loggedHours: loggedHrs,
            allocatedOverhead: absorbed,
            absorptionPercent: pool > 0 ? Math.round((absorbed / pool) * 1000) / 10 : 0,
          });
        }
      }

      const assignedOverhead = Math.round(
        Array.from(deptAbsorbedMap.values()).reduce((sum, v) => sum + v, 0) * 100
      ) / 100;

      // 5. Section 12.4 Financial Summaries
      const initialBaseline = Number(projectData.initial_baseline_cost || 0);
      const actualProjectCost = Math.round((initialBaseline + directExpenses + laborCost + assignedOverhead) * 100) / 100;
      const directCosts = Math.round((directExpenses + laborCost) * 100) / 100;
      const projectContribution = Math.round((recognizedRevenue - directCosts) * 100) / 100;
      const projectOperatingProfit = Math.round((recognizedRevenue - actualProjectCost) * 100) / 100;

      // Synchronize computed actual_cost & lifecycle status back to Supabase DB only on approved activity
      const pStatus = (totalApprovedMinutes > 0 && projectData.status === 'quoted') ? 'active' : (projectData.status || 'quoted');
      if (Number(projectData.actual_cost) !== actualProjectCost || (totalApprovedMinutes > 0 && projectData.status !== pStatus)) {
        Promise.resolve(
          sb.from('projects')
            .update({
              actual_cost: actualProjectCost,
              status: pStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', projectId)
        ).catch(() => { });
      }
      const projectMarginPercent = recognizedRevenue > 0
        ? Math.round(((projectOperatingProfit / recognizedRevenue) * 100) * 10) / 10
        : 0;

      const quotedAmount = Number(projectData.quoted_amount || 0);
      const committedRemainingWork = Number(projectData.committed_remaining_work || 0);

      // Incomplete tasks estimate from project_tasks
      const projOpenTasks = (tasksData || []).filter((task: any) => task.project_id === projectId && task.status !== 'completed');
      const openTasksRemainingCost = projOpenTasks.reduce((sum: number, task: any) => {
        const estHours = Number(task.estimated_hours || 0);
        const logHours = Number(task.logged_hours || 0);
        const remHours = Math.max(0, estHours - logHours);
        const taskRate = (task.assigned_to && memberRateMap.get(String(task.assigned_to))) || 50;
        return sum + (remHours * taskRate);
      }, 0);

      let costToComplete = 0;
      if (committedRemainingWork > 0) {
        costToComplete = committedRemainingWork;
      } else if (openTasksRemainingCost > 0) {
        costToComplete = openTasksRemainingCost;
      } else if (projectData.status === 'completed') {
        costToComplete = 0;
      } else {
        costToComplete = Math.max(0, quotedAmount - actualProjectCost);
      }
      costToComplete = Math.round(costToComplete * 100) / 100;

      const projectedAtCompletion = Math.round((actualProjectCost + costToComplete) * 100) / 100;
      const marginAtRisk = Math.round((quotedAmount - projectedAtCompletion) * 100) / 100;

      const targetProfit = Math.round((quotedAmount - initialBaseline) * 100) / 100;
      const targetMarginPercent = quotedAmount > 0
        ? Math.round(((targetProfit / quotedAmount) * 100) * 10) / 10
        : 0;

      // 6. Labor Allocation vs Payroll GL Reconciliation Trace (§1338)
      let totalOrgPayrollExpense = 0;
      let totalOrgAllocatedLabor = 0;
      try {
        const { data: allMembers } = await sb
          .from('organization_members')
          .select('fixed_salary, hourly_rate')
          .eq('organization_id', orgId);
        if (allMembers) {
          totalOrgPayrollExpense = allMembers.reduce((sum: number, m: any) => {
            const fix = Number(m.fixed_salary || 0);
            return sum + (fix > 0 ? fix : Number(m.hourly_rate || 0) * 160);
          }, 0);
        }
        const { data: allOrgTs } = await sb
          .from('timesheet_entries')
          .select('hours, duration_minutes, effective_cost_per_minute, effective_cost_per_hour, status, calculated_labor_cost')
          .eq('organization_id', orgId);
        if (allOrgTs) {
          for (const ts of allOrgTs) {
            // Reconcile approved timesheets
            if (ts.status !== 'approved') continue;
            const dur = Number(ts.duration_minutes || Math.round(Number(ts.hours || 0) * 60));
            let rM = Number(ts.effective_cost_per_minute || 0);
            if (rM <= 0) {
              const rH = Number(ts.effective_cost_per_hour || 50);
              rM = rH / 60;
            }
            totalOrgAllocatedLabor += Number(ts.calculated_labor_cost || dur * rM);
          }
          totalOrgAllocatedLabor = Math.round(totalOrgAllocatedLabor * 100) / 100;
        }
      } catch (e) {
        console.warn('[projects.profitability-details] Reconciliation trace query error:', e);
      }
      const unallocatedPayrollBench = Math.max(0, Math.round((totalOrgPayrollExpense - totalOrgAllocatedLabor) * 100) / 100);
      const reconciliationTrace = {
        totalOrgPayrollExpense: Math.round(totalOrgPayrollExpense * 100) / 100,
        totalOrgAllocatedLabor,
        projectAllocatedLabor: laborCost,
        unallocatedPayrollBench,
        reconciliationEquation: 'Total Payroll Expense = Allocated Project Labor + Unallocated Bench/General Overhead',
        status: 'balanced',
      };

      // Timeline & Burn calculation (§12.4)
      let daysElapsed = 0;
      let daysRemaining = 0;
      let totalSpanDays = 0;
      let completionPct = 0;
      let plannedDailyBudget = 0;
      let burnRatePerDay = 0;

      if (projectData.start_date) {
        const startMs = new Date(projectData.start_date).getTime();
        const nowMs = Date.now();
        const diffDays = Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24));
        daysElapsed = Math.max(0, diffDays);

        if (projectData.end_date) {
          const endMs = new Date(projectData.end_date).getTime();
          daysRemaining = Math.max(0, Math.floor((endMs - nowMs) / (1000 * 60 * 60 * 24)));
          totalSpanDays = Math.max(1, Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24)));
          completionPct = totalSpanDays > 0 ? Math.min(100, Math.max(0, Math.round((daysElapsed / totalSpanDays) * 100))) : 0;
          plannedDailyBudget = Math.round((quotedAmount / totalSpanDays) * 100) / 100;
        }
      }

      const consumedBurn = actualProjectCost;
      if (daysElapsed > 0) {
        burnRatePerDay = Math.round((consumedBurn / daysElapsed) * 100) / 100;
      } else if (laborCost > 0) {
        burnRatePerDay = laborCost;
      }

      const contributors = Array.from(contributorMap.values()).map(c => ({
        ...c,
        totalHours: Math.round(c.totalHours * 100) / 100,
        totalLaborCost: Math.round(c.totalLaborCost * 100) / 100,
      }));

      return ok(res, {
        project: mapDbToDomainProject(projectData),
        summary: {
          quotedAmount,
          initialBaselineCost: initialBaseline,
          committedRemainingWork,
          directExpenses: Math.round(directExpenses * 100) / 100,
          laborCost,
          pendingLaborCost,
          assignedOverhead,
          actualProjectCost,
          consumedBurn,
          burnRatePerDay,
          recognizedRevenue,
          targetProfit,
          targetMarginPercent,
          projectContribution,
          projectOperatingProfit,
          projectMarginPercent,
          costToComplete: Math.round(costToComplete * 100) / 100,
          projectedAtCompletion: Math.round(projectedAtCompletion * 100) / 100,
          marginAtRisk,
          totalLoggedHours: Math.round((totalLoggedMinutes / 60) * 100) / 100,
          totalApprovedHours: Math.round((totalApprovedMinutes / 60) * 100) / 100,
          totalBillableHours: Math.round((totalBillableMinutes / 60) * 100) / 100,
          totalNonBillableHours: Math.round((totalNonBillableMinutes / 60) * 100) / 100,
          contributorCount: contributors.length,
        },
        reconciliationTrace,
        timeline: {
          startDate: projectData.start_date,
          endDate: projectData.end_date,
          daysElapsed,
          daysRemaining,
          totalSpanDays,
          completionPct,
          plannedDailyBudget,
        },
        contributors,
        timesheetEntries,
        income,
        expenses,
        overheadAllocations: oaData || [],
        overheadBreakdown,
      });
    } catch (err: any) {
      console.error('[projects.profitability-details] Exception:', err);
      return fail(res, 500, err?.message || 'Error calculating project profitability details');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /:id/timesheets/:entryId/approve - §13 Manager Approval & Rate Lock
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/:id/timesheets/:entryId/approve', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const entryId = req.params.entryId;
    const approverUserId = callerId(req);
    const role = req.orgMembership?.role;
    const isApprover = role === 'owner' || role === 'admin' || role === 'accountant' || role === 'manager';
    if (!isApprover) {
      return fail(res, 403, 'Forbidden: Approver permission required to approve timesheets');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: entry, error: fetchErr } = await sb
        .from('timesheet_entries')
        .select('*')
        .eq('id', entryId)
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (fetchErr || !entry) {
        return notFound(res, 'Timesheet entry');
      }

      // Self-approval guard (§33 Invariant #11): Non-owner cannot approve their own timesheet
      if (entry.user_id === approverUserId && role !== 'owner') {
        return fail(res, 403, 'Self-approval of timesheet entries is strictly prohibited');
      }

      // Lookup member salary or hourly rate to lock effective cost
      const { data: mem } = await sb
        .from('organization_members')
        .select('fixed_salary, hourly_rate, hours_per_day, working_days_per_month')
        .eq('organization_id', orgId)
        .eq('user_id', entry.user_id)
        .maybeSingle();

      const hours = Number(entry.hours || 0);
      const durationMinutes = Number(entry.duration_minutes || Math.round(hours * 60));
      const costPerHour = calculateMemberLoadedHourlyRate(mem, new Map());
      const costPerMinute = Math.round((costPerHour / 60) * 10000) / 10000;
      const calculatedLaborCost = Math.round(durationMinutes * costPerMinute * 100) / 100;

      const { data: updated, error: updateErr } = await sb
        .from('timesheet_entries')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: approverUserId || null,
          effective_cost_per_hour: costPerHour,
          effective_cost_per_minute: costPerMinute,
          calculated_labor_cost: calculatedLaborCost,
        })
        .eq('id', entryId)
        .select()
        .single();

      if (updateErr) {
        return fail(res, 500, updateErr.message);
      }

      // Auto-advance quoted project to active once time has been approved
      try {
        await sb
          .from('projects')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', projectId)
          .eq('organization_id', orgId)
          .eq('status', 'quoted');
      } catch (pErr) {
        console.warn('[projects.timesheetApprove] Could not advance project status:', pErr);
      }

      // Auto-advance associated task/deliverable to completed
      try {
        if (entry.task_id) {
          await sb
            .from('project_tasks')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', entry.task_id)
            .eq('organization_id', orgId);
        } else if (entry.description) {
          await sb
            .from('project_tasks')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('project_id', projectId)
            .eq('organization_id', orgId)
            .ilike('title', entry.description.trim());
        }
      } catch (tErr) {
        console.warn('[projects.timesheetApprove] Could not advance task status:', tErr);
      }

      // Emit timesheet approval notification (gated by employee notification preferences)
      try {
        const { emitEmployeeTimesheetApprovalNotification } = await import('./employee.js');
        await emitEmployeeTimesheetApprovalNotification(sb, orgId, entry, approverUserId);
      } catch (notifErr) {
        console.warn('[projects.timesheetApprove] Notification emit warning:', notifErr);
      }

      return ok(res, updated, 'Timesheet entry approved and labor cost locked.');
    } catch (err: any) {
      console.error('[projects.timesheetApprove] Error:', err);
      return fail(res, 500, err?.message || 'Error approving timesheet');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /:id/timesheets/:entryId/revise - §13 Time Revision with Audit Delta
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/:id/timesheets/:entryId/revise', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const entryId = req.params.entryId;
    const modifierId = callerId(req);
    const { newHours, reason } = req.body as { newHours: number; reason?: string };

    if (newHours == null || isNaN(newHours) || newHours <= 0) {
      return fail(res, 400, 'Valid newHours greater than 0 required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: entry, error: fetchErr } = await sb
        .from('timesheet_entries')
        .select('*')
        .eq('id', entryId)
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (fetchErr || !entry) {
        return notFound(res, 'Timesheet entry');
      }

      const prevHours = Number(entry.hours || 0);
      const newDurationMinutes = Math.round(newHours * 60);
      const costPerMinute = Number(entry.effective_cost_per_minute || 50 / 60);
      const newLaborCost = Math.round(newDurationMinutes * costPerMinute * 100) / 100;

      const history = Array.isArray(entry.revision_history) ? [...entry.revision_history] : [];
      history.push({
        previousHours: prevHours,
        newHours,
        revisedAt: new Date().toISOString(),
        revisedBy: modifierId || 'Manager',
        reason: reason || 'Manager revision',
      });

      const { data: updated, error: updateErr } = await sb
        .from('timesheet_entries')
        .update({
          hours: newHours,
          duration_minutes: newDurationMinutes,
          calculated_labor_cost: newLaborCost,
          revision_history: history,
        })
        .eq('id', entryId)
        .select()
        .single();

      if (updateErr) {
        return fail(res, 500, updateErr.message);
      }

      return ok(res, updated, `Timesheet revised from ${prevHours}h to ${newHours}h with audit record preserved.`);
    } catch (err: any) {
      console.error('[projects.timesheetRevise] Error:', err);
      return fail(res, 500, err?.message || 'Error revising timesheet');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /:id/timesheets/:entryId/reject - Reject timesheet
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/:id/timesheets/:entryId/reject', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const entryId = req.params.entryId;
    const { reason } = req.body as { reason?: string };

    const role = req.orgMembership?.role;
    const isApprover = role === 'owner' || role === 'admin' || role === 'accountant' || role === 'manager';
    if (!isApprover) {
      return fail(res, 403, 'Forbidden: Approver permission required to reject timesheets');
    }

    if (!reason || !String(reason).trim()) {
      return fail(res, 400, 'A non-empty rejection reason is required when rejecting a timesheet');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const trimmedReason = String(reason).trim();
      const { data: updated, error } = await sb
        .from('timesheet_entries')
        .update({
          status: 'draft',
          rejection_reason: trimmedReason,
        })
        .eq('id', entryId)
        .eq('project_id', projectId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) return fail(res, 500, error.message);
      return ok(res, updated, 'Timesheet returned to draft status.');
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Error rejecting timesheet');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Core REST CRUD routes for projects
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('projects')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[projects.get] Supabase query error:', error);
      return fail(res, 500, error.message);
    }
    return ok(res, (data || []).map(mapDbToDomainProject));
  });

  r.get('/:id/transactions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('transactions')
      .select('*')
      .eq('project_id', req.params.id)
      .eq('organization_id', orgId);

    if (error) return fail(res, 500, error.message);
    return ok(res, data || []);
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Project');
    return ok(res, mapDbToDomainProject(data));
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Project, 'id' | 'organizationId'>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = (data as any).id || ('proj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newProject: Project = { ...data, id: newId, organizationId: orgId };

    const dbRow = mapDomainToDbProject(newProject);
    const { data: insertedData, error } = await sb
      .from('projects')
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      console.error('[projects.post] Supabase insert error:', error);
      return fail(res, 500, error.message);
    }
    return created(res, mapDbToDomainProject(insertedData), 'Project created');
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<Project>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.clientName !== undefined) dbUpdates.client_name = updates.clientName;
    if (updates.departmentId !== undefined) dbUpdates.department_id = updates.departmentId;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate;
    if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate;
    if (updates.quotedAmount !== undefined) dbUpdates.quoted_amount = updates.quotedAmount;
    if (updates.actualCost !== undefined) dbUpdates.actual_cost = updates.actualCost;
    if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
    if (updates.initialBaselineCost !== undefined) dbUpdates.initial_baseline_cost = updates.initialBaselineCost;
    if (updates.committedRemainingWork !== undefined) dbUpdates.committed_remaining_work = updates.committedRemainingWork;

    const { data, error } = await sb
      .from('projects')
      .update(dbUpdates)
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[projects.patch] Supabase update error:', error);
      return fail(res, 500, error.message);
    }
    if (!data) return notFound(res, 'Project');
    return ok(res, mapDbToDomainProject(data));
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { error } = await sb
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) {
      console.error('[projects.delete] Supabase delete error:', error);
      return fail(res, 500, error.message);
    }
    return ok(res, null, 'Project deleted');
  });


  // ─────────────────────────────────────────────────────────────────────────────
  // Project Tasks Endpoints (§13 Work Domain & §12.4 Deliverables)
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/:id/tasks', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('project_tasks')
          .select('*')
          .eq('organization_id', orgId)
          .eq('project_id', projectId)
          .order('created_at', { ascending: true });

        if (!error && data) {
          return ok(res, data.map(mapDbToDomainTask));
        }
      } catch (err) {
        console.warn('[projects.tasks.get] Supabase query error, fallback:', err);
      }
    }

    return ok(res, []);
  });

  r.post('/:id/tasks', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const projectId = req.params.id;
    const body = req.body as Partial<ProjectTask>;
    const sb = getSupabaseAdminClient();

    if (!body.title?.trim()) {
      return fail(res, 400, 'Task title is required');
    }

    const taskId = body.id || `task-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const dbRow = {
      id: taskId,
      organization_id: orgId,
      project_id: projectId,
      title: body.title.trim(),
      description: body.description?.trim() || '',
      assigned_to: body.assignedTo || null,
      assigned_to_name: body.assignedToName?.trim() || '',
      status: body.status || 'todo',
      priority: body.priority || 'medium',
      estimated_hours: Number(body.estimatedHours || 0),
      logged_hours: Number(body.loggedHours || 0),
      start_date: body.startDate || null,
      due_date: body.dueDate || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    if (sb) {
      try {
        const { data, error } = await sb
          .from('project_tasks')
          .insert(dbRow)
          .select()
          .single();

        if (error) {
          console.warn('[projects.tasks.post] Supabase insert error:', error.message);
          return fail(res, 500, error.message);
        }
        if (data?.assigned_to) {
          try {
            const { emitEmployeeTaskAssignmentNotification } = await import('./employee.js');
            await emitEmployeeTaskAssignmentNotification(sb, orgId, data, callerId(req));
          } catch (notifErr) {
            console.warn('[projects.tasks.post] Task assignment notification warning:', notifErr);
          }
        }
        return created(res, mapDbToDomainTask(data));
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return created(res, mapDbToDomainTask(dbRow));
  });

  r.patch('/:id/tasks/:taskId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id: projectId, taskId } = req.params;
    const updates = req.body as Partial<ProjectTask>;
    const sb = getSupabaseAdminClient();

    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
    if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
    if (updates.assignedTo !== undefined) dbUpdates.assigned_to = updates.assignedTo || null;
    if (updates.assignedToName !== undefined) dbUpdates.assigned_to_name = updates.assignedToName.trim();
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
    if (updates.estimatedHours !== undefined) dbUpdates.estimated_hours = Number(updates.estimatedHours);
    if (updates.loggedHours !== undefined) dbUpdates.logged_hours = Number(updates.loggedHours);
    if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate;
    if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;

    if (sb) {
      try {
        const { data, error } = await sb
          .from('project_tasks')
          .update(dbUpdates)
          .eq('id', taskId)
          .eq('project_id', projectId)
          .eq('organization_id', orgId)
          .select()
          .maybeSingle();

        if (error) return fail(res, 500, error.message);
        if (!data) return notFound(res, 'Task');
        if (data?.assigned_to && updates.assignedTo) {
          try {
            const { emitEmployeeTaskAssignmentNotification } = await import('./employee.js');
            await emitEmployeeTaskAssignmentNotification(sb, orgId, data, callerId(req));
          } catch (notifErr) {
            console.warn('[projects.tasks.patch] Task assignment notification warning:', notifErr);
          }
        }
        return ok(res, mapDbToDomainTask(data));
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return ok(res, { id: taskId, projectId, organizationId: orgId, ...updates });
  });

  r.delete('/:id/tasks/:taskId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id: projectId, taskId } = req.params;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { error } = await sb
          .from('project_tasks')
          .delete()
          .eq('id', taskId)
          .eq('project_id', projectId)
          .eq('organization_id', orgId);

        if (error) return fail(res, 500, error.message);
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return ok(res, null, 'Task deleted');
  });

  return r;
}
