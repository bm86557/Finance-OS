/**
 * Project Service
 * ================
 * CRUD for client projects with profitability calculations.
 * Uses org-scoped REST routes (backed by Supabase PostgreSQL) and direct Supabase fallback.
 */

import { Project, Transaction, ProjectTask } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore } from './dataStore';
import { reconcileTask, buildAutoCloseDescription, todayYmdLocal } from '@/lib/taskReconciler';
import { isValidProjectTransaction, isDirectProjectDebit } from '@/lib/projectTransactionFilter';
import { computeProjectSchedulePreview } from '@/lib/projectScheduleHours';
import type { ServiceResponse, ProjectProfitability } from './types';

const PROJ = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/projects`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

function backendUnavailable<T>(message = 'Backend API and Supabase client are unavailable'): ServiceResponse<T> {
  return { success: false, data: null as unknown as T, error: message };
}

export const projectService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Project[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Project[]>(organizationId);
      if (err) return err;
      return apiGet<Project[]>(PROJ(organizationId));
    }
    return backendUnavailable<Project[]>();
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Project | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${PROJ(organizationId)}/${encodeURIComponent(id)}`
        : `/projects/${encodeURIComponent(id)}`;
      return apiGet<Project | null>(path);
    }
    return backendUnavailable<Project | null>();
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
    return backendUnavailable<Project>();
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
    return backendUnavailable<Project>();
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
    return backendUnavailable<null>();
  },

  async markCompleted(
    organizationId: string,
    projectId: string,
    completedAt?: string,
  ): Promise<ServiceResponse<Project>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Project>(organizationId);
      if (err) return err;
      const res = await apiPostJson<{ completedAt?: string }, Project>(
        `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/complete`,
        completedAt ? { completedAt } : {},
      );
      if (res.success) {
        dataStore.notify('projects');
      }
      return res;
    }
    return backendUnavailable<Project>();
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

    // Direct Supabase query fallback (Schedule-driven Mon–Fri 40h/wk, 160h/mo — zero timesheet dependency)
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const [
          { data: sbProjects },
          { data: sbTxns },
          { data: sbMembers },
          { data: sbDepts },
        ] = await Promise.all([
          sb.from('projects').select('*').eq('organization_id', organizationId),
          sb.from('transactions').select('*').eq('organization_id', organizationId),
          sb.from('organization_members').select('*').eq('organization_id', organizationId),
          sb.from('departments').select('*').eq('organization_id', organizationId),
        ]);

        if (sbProjects && sbProjects.length > 0) {
          const txns = sbTxns || [];

          const deptRateMap = new Map<string, number>();
          for (const d of (sbDepts || [])) {
            if (d.cost_per_hour && Number(d.cost_per_hour) > 0) {
              deptRateMap.set(d.id, Number(d.cost_per_hour));
            } else if (d.budget && Number(d.budget) > 0) {
              deptRateMap.set(d.id, Number(d.budget) / 160);
            }
          }

          const profitability: ProjectProfitability[] = sbProjects.map((proj: any) => {
            const projTxns = txns.filter((t: any) => t.project_id === proj.id && isValidProjectTransaction(t));

            const revenue = projTxns
              .filter((t: any) => t.type === 'credit')
              .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

            const directCost = projTxns
              .filter((t: any) => isDirectProjectDebit(t))
              .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amount || 0)), 0);

            const assignedMembers = (sbMembers || []).filter((m: any) => {
              const ap = Array.isArray(m.assigned_projects) ? m.assigned_projects : [];
              return ap.includes(proj.id);
            });

            const memberCount = assignedMembers.length > 0
              ? assignedMembers.length
              : Math.max(1, Number(proj.planned_team_size || 1));

            const combinedHourlyRate = assignedMembers.length > 0
              ? assignedMembers.reduce((sum: number, m: any) => {
                const sal = Number(m.fixed_salary || 0);
                const hr = sal > 0 ? sal / 160 : (Number(m.hourly_rate || 0) || deptRateMap.get(proj.department_id) || 50);
                return sum + hr;
              }, 0)
              : (deptRateMap.get(proj.department_id) || 50) * memberCount;

            const quotedAmount = Number(proj.quoted_amount || 0);
            const initialBaseline = Number(proj.initial_baseline_cost || 0);
            const committedRemainingWork = Number(proj.committed_remaining_work || 0);

            const preview = computeProjectSchedulePreview({
              startDate: proj.start_date,
              endDate: proj.end_date,
              status: proj.status,
              completedAt: proj.completed_at,
              pausedAt: proj.paused_at,
              pausedBusinessDays: Number(proj.paused_business_days || 0),
              quotedAmount,
              initialBaselineCost: initialBaseline + directCost,
              budgetedHours: proj.budgeted_hours ? Number(proj.budgeted_hours) : null,
              memberCount,
              combinedHourlyRate,
            });

            const laborCost = preview.estimatedElapsedLaborCost;
            const actualCost = Math.round((initialBaseline + directCost + laborCost) * 100) / 100;
            const recognizedRevenue = Math.round(revenue * 100) / 100;
            const operatingProfit = Math.round((recognizedRevenue - actualCost) * 100) / 100;
            const quoteProfit = Math.round((quotedAmount - actualCost) * 100) / 100;
            const quoteMarginPct = quotedAmount > 0 ? Math.round(((quoteProfit / quotedAmount) * 100) * 10) / 10 : null;
            const directCosts = Math.round((directCost + laborCost) * 100) / 100;
            const projectContribution = Math.round((recognizedRevenue - directCosts) * 100) / 100;
            const profitMargin = recognizedRevenue > 0 ? Math.round(((operatingProfit / recognizedRevenue) * 100) * 10) / 10 : null;
            const budgetVariance = quotedAmount > 0
              ? Math.round((((actualCost - quotedAmount) / quotedAmount) * 100) * 10) / 10
              : 0;
            const avgRate = memberCount > 0 ? combinedHourlyRate / memberCount : 50;
            const costToComplete = proj.status === 'completed'
              ? 0
              : committedRemainingWork > 0
                ? committedRemainingWork
                : Math.round(preview.remainingHours * avgRate * 100) / 100;
            const projectedAtCompletion = Math.round((actualCost + costToComplete) * 100) / 100;
            const marginAtRisk = Math.round((quotedAmount - projectedAtCompletion) * 100) / 100;
            const todayStr = new Date().toISOString().slice(0, 10);
            const effectiveStatus =
              proj.status === 'quoted' && proj.start_date && todayStr >= String(proj.start_date).slice(0, 10)
                ? 'active'
                : proj.status;
            const isOverdue = effectiveStatus === 'active' && preview.overdueBusinessDays > 0;
            const healthStatus =
              effectiveStatus === 'quoted' ? 'quoted'
                : effectiveStatus === 'on_hold' ? 'on_hold'
                  : effectiveStatus === 'cancelled' ? 'cancelled'
                    : effectiveStatus === 'completed' ? (quotedAmount > 0 && actualCost > quotedAmount ? 'completed_loss' : 'completed_profit')
                      : quotedAmount > 0 && actualCost > quotedAmount ? 'in_loss'
                        : isOverdue ? 'overtime'
                          : marginAtRisk < 0 ? 'at_risk'
                            : 'on_track';

            return {
              projectId: proj.id,
              projectName: proj.name,
              clientName: proj.client_name,
              quotedAmount,
              actualCost,
              revenue: recognizedRevenue,
              profit: operatingProfit,
              quoteProfit,
              quoteMarginPct,
              profitMargin,
              operatingMarginPct: recognizedRevenue > 0 ? profitMargin : null,
              status: effectiveStatus,
              budgetVariance,
              plannedHours: preview.plannedHours,
              elapsedHours: preview.elapsedHours,
              remainingHours: preview.remainingHours,
              overrunHours: preview.overrunHours,
              projectSchedulePlannedHours: preview.projectSchedulePlannedHours,
              projectScheduleElapsedHours: preview.projectScheduleElapsedHours,
              projectScheduleRemainingHours: preview.projectScheduleRemainingHours,
              projectScheduleOverrunHours: preview.projectScheduleOverrunHours,
              plannedBusinessDays: preview.plannedBusinessDays,
              elapsedBusinessDays: preview.elapsedBusinessDays,
              remainingBusinessDays: preview.remainingBusinessDays,
              overdueBusinessDays: preview.overdueBusinessDays,
              isOverdue,
              isOpenEnded: !proj.end_date,
              breakEvenDate: preview.breakEvenDate,
              healthStatus,
              lossAmount: quotedAmount > 0 && actualCost > quotedAmount ? Math.round((actualCost - quotedAmount) * 100) / 100 : 0,
              loggedHours: preview.elapsedHours,
              billableHours: preview.elapsedHours,
              nonBillableHours: 0,
              committedRemainingWork,
              contributorCount: assignedMembers.length,
              directCost: Math.round(directCost * 100) / 100,
              laborCost: Math.round(laborCost * 100) / 100,
              projectContribution,
              operatingProfit,
              costToComplete: Math.round(costToComplete * 100) / 100,
              projectedAtCompletion,
              marginAtRisk,
              isUsingDeptFallback: assignedMembers.length === 0,
              capacityBasis: 'scheduled_mon_fri_40h_160h',
            };
          });

          return { success: true, data: profitability };
        }
      }
    } catch (e) {
      console.warn('[projectService.getProfitability] Direct Supabase error:', e);
    }

    return backendUnavailable<ProjectProfitability[]>();
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
    return backendUnavailable<Transaction[]>();
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
    return backendUnavailable<any>();
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
        const { data: existingTs } = await sb
          .from('timesheet_entries')
          .select('id, status')
          .eq('id', entryId)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (existingTs && existingTs.status !== 'submitted') {
          if (existingTs.status === 'approved') {
            return { success: true, data: existingTs, message: 'Timesheet entry is already approved.' };
          }
          return {
            success: false,
            data: null,
            error: 'Only submitted timesheet entries can be approved. This entry is still in draft.',
          };
        }

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
          let completionMsg = 'Timesheet approved';
          try {
            let targetTask: any = null;
            if (updatedTs.task_id) {
              const { data: tById } = await sb
                .from('project_tasks')
                .select('*')
                .eq('id', updatedTs.task_id)
                .eq('organization_id', organizationId)
                .maybeSingle();
              targetTask = tById;
            }
            if (!targetTask && updatedTs.description) {
              const { data: tByTitle } = await sb
                .from('project_tasks')
                .select('*')
                .eq('project_id', projectId)
                .eq('organization_id', organizationId)
                .ilike('title', String(updatedTs.description).trim())
                .maybeSingle();
              targetTask = tByTitle;
            }
            if (targetTask) {
              const { data: projTs } = await sb
                .from('timesheet_entries')
                .select('*')
                .eq('project_id', projectId)
                .eq('organization_id', organizationId);
              const allTs = (projTs || []).map((r: any) => (r.id === entryId ? updatedTs : r));
              const reconciled = reconcileTask({ ...targetTask, status: 'completed' }, allTs);
              const estH = Number(targetTask.estimated_hours || 0);
              const appH = Number(reconciled.approvedHours || 0);
              const incH = Number(reconciled.incompleteHours || 0);
              const entryDate = updatedTs.date || todayYmdLocal();

              let noteText = '';
              if (estH > 0 && appH < estH - 0.001) {
                noteText = `Logged ${appH.toFixed(1)}h of ${estH.toFixed(1)}h allocated (${incH.toFixed(1)}h incomplete on ${entryDate})`;
                completionMsg = `Timesheet approved. Task "${targetTask.title}" auto-closed: ${appH.toFixed(1)}h / ${estH.toFixed(1)}h (${incH.toFixed(1)}h incomplete).`;
              } else if (targetTask.due_date && entryDate > targetTask.due_date) {
                noteText = `Completed late (${appH.toFixed(1)}h approved on ${entryDate}; due ${targetTask.due_date})`;
                completionMsg = `Timesheet approved. Task "${targetTask.title}" auto-closed (Completed Late).`;
              } else {
                noteText = `Completed on time (${appH.toFixed(1)}h${estH > 0 ? ` / ${estH.toFixed(1)}h` : ''} approved on ${entryDate})`;
                completionMsg = `Timesheet approved. Task "${targetTask.title}" auto-closed (Completed On Time).`;
              }

              await sb
                .from('project_tasks')
                .update({
                  status: 'completed',
                  logged_hours: reconciled.loggedHours ?? appH,
                  description: buildAutoCloseDescription(targetTask.description, noteText),
                  updated_at: nowIso,
                })
                .eq('id', targetTask.id)
                .eq('organization_id', organizationId);
            }
          } catch (tErr) {
            console.warn('[projectService.approveTimesheetEntry] Task auto-close warning:', tErr);
          }

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
          return { success: true, data: updatedTs, message: completionMsg };
        }
      }
    } catch (err: any) {
      console.warn('[projectService.approveTimesheetEntry] Supabase fallback warning:', err);
    }

    return backendUnavailable<any>();
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
    return backendUnavailable<any>();
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
    return backendUnavailable<any>();
  },

  async getTasks(organizationId: string, projectId: string): Promise<ServiceResponse<ProjectTask[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProjectTask[]>(organizationId);
      if (err) return err;
      const res = await apiGet<ProjectTask[]>(`${PROJ(organizationId)}/${encodeURIComponent(projectId)}/tasks`);
      if (res.success && Array.isArray(res.data)) return res;
    }

    try {
      const sb = getSupabaseClient();
      if (sb) {
        const [{ data: tData, error: tErr }, { data: tsData }] = await Promise.all([
          sb.from('project_tasks').select('*').eq('organization_id', organizationId).eq('project_id', projectId).order('created_at', { ascending: true }),
          sb.from('timesheet_entries').select('*').eq('organization_id', organizationId).eq('project_id', projectId),
        ]);
        if (!tErr && tData) {
          return { success: true, data: tData.map((r: any) => reconcileTask(r, tsData || [])) };
        }
      }
    } catch (e) {
      console.warn('[projectService.getTasks] Supabase fallback error:', e);
    }

    return backendUnavailable<ProjectTask[]>();
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
        return res;
      }
    }

    const todayStr = todayYmdLocal();
    const nowIso = new Date().toISOString();
    const taskId = taskData.id || `task-${Date.now()}`;
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const dbRow = {
          id: taskId,
          organization_id: organizationId,
          project_id: projectId,
          title: (taskData.title || 'New Task').trim(),
          description: taskData.description || '',
          assigned_to: taskData.assignedTo || null,
          assigned_to_name: taskData.assignedToName || '',
          status: taskData.status || 'todo',
          priority: taskData.priority || 'medium',
          estimated_hours: Number(taskData.estimatedHours || 0),
          logged_hours: Number(taskData.loggedHours || 0),
          start_date: taskData.startDate || todayStr,
          due_date: taskData.dueDate || todayStr,
          created_at: nowIso,
          updated_at: nowIso,
        };
        const { data, error } = await sb.from('project_tasks').insert(dbRow).select().single();
        if (!error && data) {
          dataStore.notify('projects');
          dataStore.notify('project_tasks');
          return { success: true, data: reconcileTask(data, []) };
        }
      }
    } catch (e) {
      console.warn('[projectService.createTask] Supabase fallback error:', e);
    }

    return backendUnavailable<ProjectTask>();
  },

  async createTasksBatch(
    organizationId: string,
    projectId: string,
    tasks: Array<Partial<ProjectTask>>,
  ): Promise<ServiceResponse<ProjectTask[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProjectTask[]>(organizationId);
      if (err) return err;
      const res = await apiPostJson<{ tasks: Array<Partial<ProjectTask>> }, ProjectTask[]>(
        `${PROJ(organizationId)}/${encodeURIComponent(projectId)}/tasks/batch`,
        { tasks },
      );
      if (res.success) {
        dataStore.notify('projects');
        dataStore.notify('project_tasks');
        return res;
      }
    }

    const todayStr = todayYmdLocal();
    const nowIso = new Date().toISOString();
    const valid = tasks.filter(t => t && t.title?.trim());
    try {
      const sb = getSupabaseClient();
      if (sb && valid.length > 0) {
        const dbRows = valid.map((t, idx) => ({
          id: t.id || `task-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          organization_id: organizationId,
          project_id: projectId,
          title: t.title!.trim(),
          description: t.description?.trim() || '',
          assigned_to: t.assignedTo || null,
          assigned_to_name: t.assignedToName?.trim() || '',
          status: t.status || 'todo',
          priority: t.priority || 'medium',
          estimated_hours: Number(t.estimatedHours || 0),
          logged_hours: Number(t.loggedHours || 0),
          start_date: t.startDate || t.dueDate || todayStr,
          due_date: t.dueDate || t.startDate || todayStr,
          created_at: nowIso,
          updated_at: nowIso,
        }));
        const { data: existingTasks } = await sb
          .from('project_tasks')
          .select('id, title, assigned_to, start_date, due_date')
          .eq('organization_id', organizationId)
          .eq('project_id', projectId);

        const existingList = existingTasks || [];
        const seenKeys = new Set<string>();
        const rowsToInsert: typeof dbRows = [];
        const skippedDays: string[] = [];

        for (const row of dbRows) {
          const rowDate = row.start_date || row.due_date;
          const rowTitleKey = row.title.trim().toLowerCase();
          const batchKey = `${rowDate}::${row.assigned_to || 'unassigned'}::${row.assigned_to ? '' : rowTitleKey}`;

          const alreadyExists = seenKeys.has(batchKey) || existingList.some((ex: any) => {
            const sameDay = ex.start_date === rowDate || ex.due_date === rowDate;
            if (!sameDay) return false;
            if (row.assigned_to) {
              return String(ex.assigned_to || '') === String(row.assigned_to);
            }
            return String(ex.title || '').trim().toLowerCase() === rowTitleKey;
          });

          if (alreadyExists) {
            skippedDays.push(rowDate);
            continue;
          }
          seenKeys.add(batchKey);
          rowsToInsert.push(row);
        }

        if (rowsToInsert.length === 0) {
          return {
            success: true,
            data: [],
            message: `No new tasks created — task(s) already exist for ${skippedDays.join(', ')}.`,
          };
        }

        const { data, error } = await sb.from('project_tasks').insert(rowsToInsert).select();
        if (!error && data) {
          dataStore.notify('projects');
          dataStore.notify('project_tasks');
          const message = skippedDays.length > 0
            ? `Assigned ${rowsToInsert.length} task(s); skipped ${skippedDays.length} existing day(s) (${skippedDays.join(', ')}).`
            : `Assigned ${rowsToInsert.length} weekly tasks (Mon–Fri).`;
          return { success: true, data: data.map((r: any) => reconcileTask(r, [])), message };
        }
      }
    } catch (e) {
      console.warn('[projectService.createTasksBatch] Supabase fallback error:', e);
    }

    return backendUnavailable<ProjectTask[]>();
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
        return res;
      }
    }

    try {
      const sb = getSupabaseClient();
      if (sb) {
        const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
        if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
        if (updates.estimatedHours !== undefined) dbUpdates.estimated_hours = Number(updates.estimatedHours);
        if (updates.loggedHours !== undefined) dbUpdates.logged_hours = Number(updates.loggedHours);
        if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;
        const { data, error } = await sb
          .from('project_tasks')
          .update(dbUpdates)
          .eq('id', taskId)
          .eq('project_id', projectId)
          .eq('organization_id', organizationId)
          .select()
          .maybeSingle();
        if (!error && data) {
          dataStore.notify('projects');
          dataStore.notify('project_tasks');
          return { success: true, data: reconcileTask(data, []) };
        }
      }
    } catch (e) {
      console.warn('[projectService.updateTask] Supabase fallback error:', e);
    }

    return backendUnavailable<ProjectTask>('Task not found');
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

    return backendUnavailable<null>();
  },

};
