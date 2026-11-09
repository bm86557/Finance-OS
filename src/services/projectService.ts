/**
 * Project Service
 * ================
 * CRUD for client projects with profitability calculations.
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore`.
 */

import { Project, Transaction, ProjectTask } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse, ProjectProfitability } from './types';

const PROJ = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/projects`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export const projectService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Project[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Project[]>(organizationId);
      if (err) return err;
      return apiGet<Project[]>(PROJ(organizationId));
    }

    await simulateDelay();
    const projects = dataStore.projects.filter(p => p.organizationId === organizationId);
    return { success: true, data: projects };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Project | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${PROJ(organizationId)}/${encodeURIComponent(id)}`
        : `/projects/${encodeURIComponent(id)}`;
      return apiGet<Project | null>(path);
    }

    await simulateDelay(80);
    const project = dataStore.projects.find(p => p.id === id) || null;
    return { success: !!project, data: project };
  },

  async create(
    organizationId: string,
    data: Omit<Project, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<Project>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Project>(organizationId);
      if (err) return err;
      const res = await apiPostJson<Omit<Project, 'id' | 'organizationId'>, Project>(PROJ(organizationId), data);
      if (res.success) {
        dataStore.notify('projects');
      }
      return res;
    }

    await simulateDelay(200);
    const newProject: Project = { ...data, id: generateId('proj'), organizationId };
    dataStore.projects.push(newProject);
    dataStore.notify('projects');
    return { success: true, data: newProject, message: 'Project created' };
  },

  async update(
    id: string,
    updates: Partial<Project>,
    organizationId?: string,
  ): Promise<ServiceResponse<Project>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${PROJ(organizationId)}/${encodeURIComponent(id)}`
        : `/projects/${encodeURIComponent(id)}`;
      const res = await apiRequest<Project>(path, { method: 'PATCH', body: JSON.stringify(updates) });
      if (res.success) {
        dataStore.notify('projects');
      }
      return res;
    }

    await simulateDelay(150);
    const idx = dataStore.projects.findIndex(p => p.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Project not found' };
    dataStore.projects[idx] = { ...dataStore.projects[idx], ...updates };
    dataStore.notify('projects');
    return { success: true, data: dataStore.projects[idx] };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${PROJ(organizationId)}/${encodeURIComponent(id)}`
        : `/projects/${encodeURIComponent(id)}`;
      const res = await apiRequest<null>(path, { method: 'DELETE' });
      if (res.success) {
        dataStore.notify('projects');
      }
      return res;
    }

    await simulateDelay(150);
    const idx = dataStore.projects.findIndex(p => p.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Project not found' };
    dataStore.projects.splice(idx, 1);
    dataStore.notify('projects');
    return { success: true, data: null, message: 'Project deleted' };
  },

  async getProfitability(
    organizationId: string,
    params?: { from?: string; to?: string; period?: '1M' | '3M' | '12M' }
  ): Promise<ServiceResponse<ProjectProfitability[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProjectProfitability[]>(organizationId);
      if (err) return err;

      // Build query string
      const queryParams = new URLSearchParams();
      if (params?.period) {
        queryParams.append('period', params.period);
      } else {
        if (params?.from) queryParams.append('from', params.from);
        if (params?.to) queryParams.append('to', params.to);
      }

      const query = queryParams.toString();
      const url = query ? `${PROJ(organizationId)}/profitability?${query}` : `${PROJ(organizationId)}/profitability`;

      const res = await apiGet<ProjectProfitability[]>(url);
      if (res.success && Array.isArray(res.data)) {
        return res;
      }
    }

    // Direct Supabase query fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const [
          { data: sbProjects },
          { data: sbTxns },
          { data: sbTimesheets },
          { data: sbMembers },
          { data: sbDepts },
        ] = await Promise.all([
          sb.from('projects').select('*').eq('organization_id', organizationId),
          sb.from('transactions').select('*').eq('organization_id', organizationId),
          sb.from('timesheet_entries').select('*').eq('organization_id', organizationId),
          sb.from('organization_members').select('*').eq('organization_id', organizationId),
          sb.from('departments').select('*').eq('organization_id', organizationId),
        ]);

        if (sbProjects && sbProjects.length > 0) {
          const txns = sbTxns || [];
          const ts = sbTimesheets || [];

          // Build department and member rate lookup maps
          const deptRateMap = new Map<string, number>();
          for (const d of (sbDepts || [])) {
            if (d.cost_per_hour && Number(d.cost_per_hour) > 0) {
              deptRateMap.set(d.id, Number(d.cost_per_hour));
            }
          }

          const memberRateMap = new Map<string, number>();
          for (const m of (sbMembers || [])) {
            const fixedSal = Number(m.fixed_salary || 0);
            let rate = 0;
            if (fixedSal > 0) {
              const hoursPerDay = Number(m.hours_per_day || 8);
              const daysPerMonth = Number(m.working_days_per_month || 20);
              const capHours = (hoursPerDay > 0 && daysPerMonth > 0) ? hoursPerDay * daysPerMonth : 160;
              rate = fixedSal / capHours;
            } else if (m.hourly_rate && Number(m.hourly_rate) > 0) {
              rate = Number(m.hourly_rate);
            } else if (m.department_id && deptRateMap.has(m.department_id)) {
              rate = deptRateMap.get(m.department_id)!;
            } else {
              rate = 50.0;
            }
            memberRateMap.set(m.user_id || m.id, rate);
          }

          const profitability: ProjectProfitability[] = sbProjects.map((proj: any) => {
            const projTxns = txns.filter((t: any) => {
              if (t.project_id !== proj.id) return false;
              const status = String(t.status || '').toLowerCase();
              if (status === 'pending' || status === 'draft' || status === 'rejected' || status === 'reversed' || status === 'cancelled') return false;
              if (t.world_scope === 'personal') return false;
              return true;
            });

            const revenue = projTxns
              .filter((t: any) => t.type === 'credit')
              .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

            const directCost = projTxns
              .filter((t: any) => {
                if (t.type !== 'debit') return false;
                const tags = Array.isArray(t.tags) ? t.tags : [];
                const desc = (t.description || t.narration || '').toLowerCase();
                if (tags.includes('reimbursement_settlement') || tags.includes('payroll_payout') || tags.includes('salary') || tags.includes('payroll')) return false;
                if (desc.includes('reimbursement settlement') || desc.includes('expense payout') || desc.includes('salary payout')) return false;
                return true;
              })
              .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amount || 0)), 0);

            const projTs = ts.filter((t: any) => t.project_id === proj.id);
            const loggedHours = projTs.reduce((sum: number, t: any) => sum + Number(t.hours || 0), 0);
            const billableHours = projTs.filter((t: any) => t.billable !== false).reduce((sum: number, t: any) => sum + Number(t.hours || 0), 0);
            const nonBillableHours = projTs.filter((t: any) => t.billable === false).reduce((sum: number, t: any) => sum + Number(t.hours || 0), 0);
            const contributorCount = new Set(projTs.map((t: any) => t.user_id)).size;

            // Only approved timesheets accumulate to actual recognized labor cost (§12.4, §13)
            const laborCost = projTs
              .filter((t: any) => t.status === 'approved')
              .reduce((sum: number, t: any) => {
                const rate = memberRateMap.get(t.user_id) || 50.0;
                return sum + (Number(t.hours || 0) * rate);
              }, 0);

            const quotedAmount = Number(proj.quoted_amount || 0);
            const initialBaseline = Number(proj.initial_baseline_cost || 0);
            const committedRemainingWork = Number(proj.committed_remaining_work || 0);
            const actualCost = Math.round((initialBaseline + directCost + laborCost) * 100) / 100;

            // Recognized Revenue from ledger credits (§12.4, §14)
            const recognizedRevenue = Math.round(revenue * 100) / 100;
            const operatingProfit = Math.round((recognizedRevenue - actualCost) * 100) / 100;
            const directCosts = Math.round((directCost + laborCost) * 100) / 100;
            const projectContribution = Math.round((recognizedRevenue - directCosts) * 100) / 100;
            const profitMargin = recognizedRevenue > 0 ? Math.round(((operatingProfit / recognizedRevenue) * 100) * 10) / 10 : 0;
            const budgetVariance = quotedAmount > 0
              ? Math.round((((actualCost - quotedAmount) / quotedAmount) * 100) * 10) / 10
              : 0;
            const costToComplete = committedRemainingWork > 0
              ? committedRemainingWork
              : Math.max(0, quotedAmount - actualCost);
            const projectedAtCompletion = actualCost + costToComplete;
            const marginAtRisk = Math.round((quotedAmount - projectedAtCompletion) * 100) / 100;

            return {
              projectId: proj.id,
              projectName: proj.name,
              clientName: proj.client_name,
              quotedAmount,
              actualCost,
              revenue: recognizedRevenue,
              profit: operatingProfit,
              profitMargin,
              status: proj.status,
              budgetVariance,
              loggedHours: Math.round(loggedHours * 100) / 100,
              billableHours: Math.round(billableHours * 100) / 100,
              nonBillableHours: Math.round(nonBillableHours * 100) / 100,
              committedRemainingWork,
              contributorCount,
              directCost: Math.round(directCost * 100) / 100,
              laborCost: Math.round(laborCost * 100) / 100,
              projectContribution,
              operatingProfit,
              costToComplete: Math.round(costToComplete * 100) / 100,
              projectedAtCompletion: Math.round(projectedAtCompletion * 100) / 100,
              marginAtRisk,
            };
          });

          return { success: true, data: profitability };
        }
      }
    } catch (e) {
      console.warn('[projectService.getProfitability] Direct Supabase error:', e);
    }

    await simulateDelay();

    // Calculate date range for filtering
    let fromDate: string;
    let toDate: string;

    if (params?.period) {
      const now = new Date();
      toDate = now.toISOString().slice(0, 10);
      const daysBack = params.period === '1M' ? 30 : params.period === '3M' ? 90 : 365;
      const fromDateObj = new Date(now);
      fromDateObj.setDate(fromDateObj.getDate() - daysBack);
      fromDate = fromDateObj.toISOString().slice(0, 10);
    } else {
      fromDate = params?.from || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 90);
        return d.toISOString().slice(0, 10);
      })();
      toDate = params?.to || new Date().toISOString().slice(0, 10);
    }

    const projects = dataStore.projects.filter(p => p.organizationId === organizationId);
    const orgTxns = dataStore.transactions.filter(t =>
      t.organizationId === organizationId &&
      t.date >= fromDate &&
      t.date <= toDate &&
      t.status !== 'pending' &&
      t.status !== 'draft' &&
      t.status !== 'rejected' &&
      t.status !== 'reversed'
    );

    const profitability: ProjectProfitability[] = projects.map(proj => {
      const projTxns = orgTxns.filter(t => t.projectId === proj.id);
      const revenue = projTxns
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const costs = projTxns
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);

      const projTs = dataStore.timesheets.filter(t => t.organizationId === organizationId && t.projectId === proj.id);
      const loggedHours = projTs.reduce((sum, t) => sum + Number(t.hours || 0), 0);
      const contributorCount = new Set(projTs.map(t => t.userId)).size;

      const laborCost = projTs
        .filter(t => t.status === 'approved')
        .reduce((sum, t) => {
          const member = (dataStore as any).organizationMembers?.find((m: any) => m.userId === t.userId);
          const rate = Number(member?.hourlyRate || member?.hourly_rate || (member?.fixedSalary ? member.fixedSalary / 160 : 50));
          return sum + (Number(t.hours || 0) * (rate > 0 ? rate : 50));
        }, 0);

      const directCost = costs;
      const totalCosts = Math.round((directCost + laborCost) * 100) / 100;
      const recognizedRevenue = revenue;
      const operatingProfit = Math.round((recognizedRevenue - totalCosts) * 100) / 100;
      const directCosts = Math.round((directCost + laborCost) * 100) / 100;
            const projectContribution = Math.round((recognizedRevenue - directCosts) * 100) / 100;
      const profitMargin = recognizedRevenue > 0 ? Math.round(((operatingProfit / recognizedRevenue) * 100) * 10) / 10 : 0;
      const budgetVariance = proj.quotedAmount > 0
        ? Math.round((((totalCosts - proj.quotedAmount) / proj.quotedAmount) * 100) * 10) / 10
        : 0;
      const costToComplete = Math.max(0, proj.quotedAmount - totalCosts);
      const projectedAtCompletion = totalCosts + costToComplete;
      const marginAtRisk = Math.round((proj.quotedAmount - projectedAtCompletion) * 100) / 100;

      return {
        projectId: proj.id,
        projectName: proj.name,
        clientName: proj.clientName,
        quotedAmount: proj.quotedAmount,
        actualCost: totalCosts,
        revenue: recognizedRevenue,
        profit: operatingProfit,
        profitMargin,
        status: proj.status,
        budgetVariance,
        loggedHours: Math.round(loggedHours * 100) / 100,
        contributorCount,
        directCost: Math.round(directCost * 100) / 100,
        laborCost: Math.round(laborCost * 100) / 100,
        projectContribution,
        operatingProfit,
        costToComplete: Math.round(costToComplete * 100) / 100,
        projectedAtCompletion: Math.round(projectedAtCompletion * 100) / 100,
        marginAtRisk,
      };
    });

    return { success: true, data: profitability };
  },

  async getProjectTransactions(
    projectId: string,
    organizationId?: string,
  ): Promise<ServiceResponse<Transaction[]>> {
    if (isHttpBackendConfigured()) {
      if (organizationId) {
        return apiGet<Transaction[]>(
          `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/transactions`,
        );
      }
      return apiGet<Transaction[]>(`/projects/${encodeURIComponent(projectId)}/transactions`);
    }

    await simulateDelay();
    const txns = dataStore.transactions.filter(
      t => t.projectId === projectId && (!organizationId || t.organizationId === organizationId),
    );
    return { success: true, data: txns };
  },

  async getProjectDetails(
    projectId: string,
    organizationId: string,
    params?: { from?: string; to?: string },
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      const q = new URLSearchParams();
      if (params?.from) q.append('from', params.from);
      if (params?.to) q.append('to', params.to);
      const qs = q.toString() ? `?${q.toString()}` : '';
      return apiGet<any>(
        `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/profitability-details${qs}`,
      );
    }

    await simulateDelay();

    // Fallback: fetch project and transactions from dataStore
    const project = dataStore.projects.find(
      p => p.id === projectId && p.organizationId === organizationId
    );

    if (!project) {
      return { success: false, data: null, error: 'Project not found' };
    }

    const txns = dataStore.transactions.filter(
      t => t.projectId === projectId &&
        t.organizationId === organizationId &&
        t.status !== 'pending'
    );

    const income = txns.filter(t => t.type === 'credit');
    const expenses = txns.filter(t => t.type === 'debit');

    const totalRevenue = income.reduce((sum, t) => sum + t.amount, 0);
    const totalCosts = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const netProfit = totalRevenue - totalCosts;
    const varianceAmount = totalCosts - project.quotedAmount;
    const variancePct = project.quotedAmount > 0
      ? (varianceAmount / project.quotedAmount) * 100
      : 0;

    return {
      success: true,
      data: {
        project,
        income,
        expenses,
        contributors: [],
        timesheetEntries: [],
        timeline: {
          startDate: project.startDate,
          endDate: project.endDate,
          daysElapsed: 1,
          daysRemaining: 0,
          completionPct: 0,
        },
        summary: {
          quotedAmount: project.quotedAmount,
          initialBaselineCost: 0,
          directExpenses: totalCosts,
          laborCost: 0,
          assignedOverhead: 0,
          actualProjectCost: totalCosts,
          consumedBurn: totalCosts,
          burnRatePerDay: totalCosts,
          recognizedRevenue: totalRevenue || project.quotedAmount,
          projectContribution: totalRevenue - totalCosts,
          projectOperatingProfit: netProfit,
          projectMarginPercent: variancePct,
          costToComplete: Math.max(0, project.quotedAmount - totalCosts),
          projectedAtCompletion: project.quotedAmount,
          marginAtRisk: 0,
          totalLoggedHours: 0,
          totalApprovedHours: 0,
          contributorCount: 0,
        },
      },
    };
  },

  async approveTimesheetEntry(
    organizationId: string,
    projectId: string,
    entryId: string,
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiPostJson<Record<string, never>, any>(
          `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/timesheets/${encodeURIComponent(entryId)}/approve`,
          {},
        );
        if (res.success) return res;
      } catch {
        /* fallback to Supabase */
      }
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const nowIso = new Date().toISOString();
        const { data: updatedTs, error: updateErr } = await sb
          .from('timesheet_entries')
          .update({
            status: 'approved',
            approved_at: nowIso,
          })
          .eq('id', entryId)
          .eq('organization_id', organizationId)
          .select()
          .single();

        if (!updateErr && updatedTs) {
          const { employeeService } = await import('./employeeService');
          const sRes = await employeeService.getMySettings(organizationId, updatedTs.user_id);
          if (sRes.data?.notifications?.timesheetReminders !== false) {
            const hours = Number(updatedTs.hours || 0);
            await sb.from('notifications').insert({
              organization_id: organizationId,
              user_id: updatedTs.user_id,
              portal: 'employee',
              title: `Timesheet Approved: ${hours}h`,
              message: `Your timesheet entry for ${updatedTs.date || 'the period'} (${hours} hours) has been approved and locked.`,
              type: 'success',
              category: 'timesheets',
              is_read: false,
              action_tab: 'timesheets',
            } as any);
          }
          return { success: true, data: updatedTs, message: 'Timesheet approved' };
        }
      }
    } catch (err: any) {
      console.warn('[projectService.approveTimesheetEntry] Supabase fallback warning:', err);
    }

    await simulateDelay(100);
    const ts = dataStore.timesheets.find(t => t.id === entryId);
    if (ts) {
      ts.status = 'approved';
      (ts as any).approvedAt = new Date().toISOString();
      dataStore.notify('timesheets');
    }
    return { success: true, data: ts, message: 'Timesheet approved' };
  },

  async reviseTimesheetEntry(
    organizationId: string,
    projectId: string,
    entryId: string,
    newHours: number,
    reason?: string,
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ newHours: number; reason?: string }, any>(
        `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/timesheets/${encodeURIComponent(entryId)}/revise`,
        { newHours, reason },
      );
    }
    await simulateDelay(100);
    const ts = dataStore.timesheets.find(t => t.id === entryId);
    if (ts) {
      const prevHours = ts.hours;
      ts.hours = newHours;
      const hist = (ts as any).revisionHistory || [];
      hist.push({
        previousHours: prevHours,
        newHours,
        revisedAt: new Date().toISOString(),
        reason: reason || 'Manager revision',
      });
      (ts as any).revisionHistory = hist;
      dataStore.notify('timesheets');
    }
    return { success: true, data: ts, message: 'Timesheet revised' };
  },

  async rejectTimesheetEntry(
    organizationId: string,
    projectId: string,
    entryId: string,
    reason?: string,
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ reason?: string }, any>(
        `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/timesheets/${encodeURIComponent(entryId)}/reject`,
        { reason },
      );
    }
    await simulateDelay(100);
    const ts = dataStore.timesheets.find(t => t.id === entryId);
    if (ts) {
      ts.status = 'draft';
      (ts as any).rejectionReason = reason || 'Rejected';
      dataStore.notify('timesheets');
    }
    return { success: true, data: ts, message: 'Timesheet rejected' };
  },

  async getTasks(organizationId: string, projectId: string): Promise<ServiceResponse<ProjectTask[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProjectTask[]>(organizationId);
      if (err) return err;
      return apiGet<ProjectTask[]>(`${PROJ(organizationId)}/${encodeURIComponent(projectId)}/tasks`);
    }

    await simulateDelay();
    const tasks = ((dataStore as any).tasks || []).filter((t: ProjectTask) => t.organizationId === organizationId && t.projectId === projectId);
    return { success: true, data: tasks };
  },

  async createTask(
    organizationId: string,
    projectId: string,
    taskData: Partial<ProjectTask>,
  ): Promise<ServiceResponse<ProjectTask>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProjectTask>(organizationId);
      if (err) return err;
      const res = await apiPostJson<Partial<ProjectTask>, ProjectTask>(`${PROJ(organizationId)}/${encodeURIComponent(projectId)}/tasks`, taskData as any);
      if (res.success) {
        dataStore.notify('projects');
        dataStore.notify('project_tasks');
      }
      return res;
    }

    await simulateDelay();
    const newTask: ProjectTask = {
      id: generateId('task'),
      organizationId,
      projectId,
      title: taskData.title || 'New Task',
      description: taskData.description || '',
      assignedTo: taskData.assignedTo,
      assignedToName: taskData.assignedToName,
      status: taskData.status || 'todo',
      priority: taskData.priority || 'medium',
      estimatedHours: taskData.estimatedHours || 0,
      loggedHours: taskData.loggedHours || 0,
      startDate: taskData.startDate,
      dueDate: taskData.dueDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!(dataStore as any).tasks) (dataStore as any).tasks = [];
    (dataStore as any).tasks.push(newTask);
    dataStore.notify('projects');
    dataStore.notify('project_tasks');
    return { success: true, data: newTask };
  },

  async updateTask(
    organizationId: string,
    projectId: string,
    taskId: string,
    updates: Partial<ProjectTask>,
  ): Promise<ServiceResponse<ProjectTask>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProjectTask>(organizationId);
      if (err) return err;
      const res = await apiRequest<ProjectTask>(`${PROJ(organizationId)}/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(updates) });
      if (res.success) {
        dataStore.notify('projects');
        dataStore.notify('project_tasks');
      }
      return res;
    }

    await simulateDelay();
    const tasks = (dataStore as any).tasks || [];
    const idx = tasks.findIndex((t: ProjectTask) => t.id === taskId);
    if (idx !== -1) {
      tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
      dataStore.notify('projects');
      dataStore.notify('project_tasks');
      return { success: true, data: tasks[idx] };
    }
    return { success: false, data: null as any, error: 'Task not found' };
  },

  async deleteTask(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<null>(organizationId);
      if (err) return err;
      const res = await apiRequest<null>(`${PROJ(organizationId)}/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      if (res.success) {
        dataStore.notify('projects');
        dataStore.notify('project_tasks');
      }
      return res;
    }

    await simulateDelay();
    if ((dataStore as any).tasks) {
      (dataStore as any).tasks = (dataStore as any).tasks.filter((t: ProjectTask) => t.id !== taskId);
      dataStore.notify('projects');
      dataStore.notify('project_tasks');
    }
    return { success: true, data: null };
  },

};
