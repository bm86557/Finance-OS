/**
 * Employee Service
 * =================
 * Employee-facing features: expenses, payslips, timesheets, directory, announcements.
 * When `VITE_API_BASE_URL` is set, uses org-scoped `/me/*` REST routes (§18); otherwise `dataStore`.
 */

import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, simulateDelay, generateId } from './dataStore';
import type {
  ServiceResponse,
  EmployeeExpense,
  EmployeePayslip,
  TimesheetEntry,
  EmployeeTeamMember,
  CompanyAnnouncement,
  ProjectTask,
  EmployeeUserSettings,
  EmployeeNotificationPreferences,
  EmployeeSecuritySettings,
  EmployeeSessionTimeout,
} from './types';

export type Expense = EmployeeExpense;
export type Payslip = EmployeePayslip;
export type { TimesheetEntry };
export type TeamMember = EmployeeTeamMember;
export type Announcement = CompanyAnnouncement;

function mondayOfWeek(ref: Date): Date {
  const d = new Date(ref);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTs(iso?: string, fallback?: string): number {
  const s = iso || fallback || '';
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

function expenseDateValid(dateRaw: string): boolean {
  const s = dateRaw?.trim() ?? '';
  if (!s) return false;
  const normalized = s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const t = Date.parse(normalized);
  return !Number.isNaN(t);
}

type ExpenseCreateInput = Omit<EmployeeExpense, 'id' | 'organizationId' | 'userId'>;

function validateExpenseInput(data: ExpenseCreateInput): { ok: true } | { ok: false; error: string } {
  const description = data.description?.trim() ?? '';
  if (!description) return { ok: false, error: 'Description is required' };

  const amount = data.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Amount must be a number greater than 0' };
  }

  const category = data.category?.trim() ?? '';
  if (!category) return { ok: false, error: 'Category is required' };

  const dateStr = data.date?.trim() ?? '';
  if (!dateStr) return { ok: false, error: 'Date is required' };
  if (!expenseDateValid(dateStr)) return { ok: false, error: 'Invalid date' };

  if (data.status !== 'draft' && data.status !== 'submitted') {
    return { ok: false, error: 'New expenses must be saved as draft or submitted' };
  }

  return { ok: true };
}

function expenseCreateFingerprint(
  e: Pick<EmployeeExpense, 'date' | 'amount' | 'category' | 'description' | 'status' | 'currency'>,
): string {
  return [
    e.date.trim(),
    String(e.amount),
    e.category.trim().toLowerCase(),
    e.description.trim().toLowerCase(),
    e.status,
    e.currency.trim().toUpperCase(),
  ].join('\u0001');
}

function hasDuplicateExpense(
  organizationId: string,
  userId: string,
  candidate: Pick<EmployeeExpense, 'date' | 'amount' | 'category' | 'description' | 'status' | 'currency'>,
): boolean {
  const fp = expenseCreateFingerprint(candidate);
  return dataStore.expenses.some(
    row =>
      row.organizationId === organizationId &&
      row.userId === userId &&
      expenseCreateFingerprint(row) === fp,
  );
}

/** Trims and requires non-empty org + user for employee-scoped calls. */
function requireOrgAndUser(
  orgId: string,
  userId: string,
): { ok: true; orgId: string; userId: string } | { ok: false; error: string } {
  const o = orgId?.trim() ?? '';
  const u = userId?.trim() ?? '';
  if (!o || !u) {
    return { ok: false, error: 'Organization and user are required' };
  }
  return { ok: true, orgId: o, userId: u };
}

/** Trims and requires non-empty org for org-scoped calls. */
function requireOrg(orgId: string): { ok: true; orgId: string } | { ok: false; error: string } {
  const o = orgId?.trim() ?? '';
  if (!o) {
    return { ok: false, error: 'Organization is required' };
  }
  return { ok: true, orgId: o };
}

const ME = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}/me`;

export type EmployeeDashboardSummary = ReturnType<typeof emptyEmployeeDashboardSummary>;

function emptyEmployeeDashboardSummary(): {
  hoursThisWeek: number;
  hoursTarget: number;
  pendingExpenses: number;
  pendingExpenseAmount: number;
  activeProjects: number;
  salary: { gross: number; net: number; currency: string };
  weeklyHours: { day: string; hours: number }[];
  recentActivity: {
    id: string;
    type: 'expense' | 'timesheet' | 'project' | 'payslip';
    text: string;
    time: string;
    status: string;
    amount?: number;
  }[];
  announcements: { id: string; title: string; date: string; urgent: boolean }[];
  projectNotifications: {
    id: string;
    title: string;
    message: string;
    type: string;
    category: string;
    date: string;
    urgent: boolean;
    actionUrl?: string;
  }[];
  completedTasks: number;
  totalTasks: number;
  department: string;
  position: string;
  lastPayPeriod: string;
} {
  return {
    hoursThisWeek: 0,
    hoursTarget: 40,
    pendingExpenses: 0,
    pendingExpenseAmount: 0,
    activeProjects: 0,
    salary: { gross: 0, net: 0, currency: 'USD' },
    weeklyHours: [],
    recentActivity: [],
    announcements: [],
    projectNotifications: [],
    completedTasks: 0,
    totalTasks: 0,
    department: '',
    position: '',
    lastPayPeriod: '',
  };
}

export const employeeService = {
  async getExpenses(orgId: string, userId: string): Promise<ServiceResponse<EmployeeExpense[]>> {
    if (isHttpBackendConfigured()) {
      const ru = requireOrgAndUser(orgId, userId);
      if (!ru.ok) {
        return { success: false, data: [], error: ru.error };
      }
      return apiGet<EmployeeExpense[]>(`${ME(ru.orgId)}/expenses?userId=${encodeURIComponent(ru.userId)}`);
    }

    await simulateDelay();
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: [], error: ru.error };
    }
    const { orgId: o, userId: u } = ru;
    const rows = dataStore.expenses.filter(e => e.organizationId === o && e.userId === u);
    const sorted = [...rows].sort((a, b) => {
      const db = parseTs(b.submittedAt, b.date) - parseTs(a.submittedAt, a.date);
      if (db !== 0) return db;
      return b.id.localeCompare(a.id);
    });
    return { success: true, data: sorted };
  },

  async createExpense(
    orgId: string,
    userId: string,
    data: ExpenseCreateInput,
  ): Promise<ServiceResponse<EmployeeExpense>> {
    const fail = (error: string) =>
      ({ success: false, data: null as unknown as EmployeeExpense, error } as const);

    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return fail(ru.error);
    }
    const { orgId: o, userId: u } = ru;

    const check = validateExpenseInput(data);
    if (!check.ok) {
      return fail(check.error);
    }

    if (isHttpBackendConfigured()) {
      const currency = (data.currency?.trim() || 'USD').toUpperCase().slice(0, 8);
      const nowIso = new Date().toISOString();
      const submittedAt =
        data.status === 'submitted' ? (data.submittedAt?.trim() || nowIso) : undefined;
      const body = {
        userId: u,
        description: data.description.trim(),
        amount: data.amount,
        currency,
        category: data.category.trim(),
        date: data.date.trim(),
        status: data.status,
        ...(submittedAt !== undefined ? { submittedAt } : {}),
        ...(data.notes?.trim() ? { notes: data.notes.trim() } : {}),
        ...(data.projectId?.trim() ? { projectId: data.projectId.trim() } : {}),
        ...(data.receiptUrl?.trim() ? { receiptUrl: data.receiptUrl.trim() } : {}),
      };
      return apiPostJson<typeof body, EmployeeExpense>(`${ME(o)}/expenses`, body);
    }

    await simulateDelay(200);

    const currency = (data.currency?.trim() || 'USD').toUpperCase().slice(0, 8);
    const nowIso = new Date().toISOString();
    const submittedAt =
      data.status === 'submitted' ? (data.submittedAt?.trim() || nowIso) : undefined;

    const notes = data.notes?.trim() || undefined;
    const projectId = data.projectId?.trim() || undefined;
    const receiptUrl = data.receiptUrl?.trim() || undefined;

    const candidate: Pick<
      EmployeeExpense,
      'date' | 'amount' | 'category' | 'description' | 'status' | 'currency'
    > = {
      date: data.date.trim(),
      description: data.description.trim(),
      amount: data.amount,
      currency,
      category: data.category.trim(),
      status: data.status,
    };

    if (hasDuplicateExpense(o, u, candidate)) {
      return fail('An expense with the same details already exists');
    }

    const exp: EmployeeExpense = {
      id: generateId('exp'),
      organizationId: o,
      userId: u,
      date: candidate.date,
      description: candidate.description,
      amount: candidate.amount,
      currency: candidate.currency,
      category: candidate.category,
      status: candidate.status,
      submittedAt,
      notes,
      projectId,
      receiptUrl,
    };

    dataStore.expenses.unshift(exp);
    dataStore.notify('expenses', true);
    return {
      success: true,
      data: exp,
      message: data.status === 'submitted' ? 'Expense submitted' : 'Expense created',
    };
  },

  async submitExpense(id: string, organizationId?: string): Promise<ServiceResponse<EmployeeExpense>> {
    const fail = (error: string) =>
      ({ success: false, data: null as unknown as EmployeeExpense, error } as const);

    const expId = id?.trim() ?? '';
    if (!expId) {
      return fail('Expense id is required');
    }

    if (isHttpBackendConfigured()) {
      const o = organizationId?.trim() ?? '';
      if (!o) return fail('organizationId required');
      return apiRequest<EmployeeExpense>(`${ME(o)}/expenses/${encodeURIComponent(expId)}/submit`, {
        method: 'POST',
        body: '{}',
      });
    }

    await simulateDelay(150);

    const exp = dataStore.expenses.find(e => e.id === expId);
    if (!exp) return fail('Expense not found');

    if (exp.status === 'submitted') {
      return { success: true, data: exp, message: 'Already submitted' };
    }
    if (exp.status !== 'draft') {
      return fail('Only draft expenses can be submitted for review');
    }

    exp.status = 'submitted';
    exp.submittedAt = new Date().toISOString();
    dataStore.notify('expenses', true);
    return { success: true, data: exp, message: 'Expense submitted for review' };
  },

  async updateExpense(
    orgId: string,
    id: string,
    updates: Partial<ExpenseCreateInput>,
  ): Promise<ServiceResponse<EmployeeExpense>> {
    const fail = (error: string) =>
      ({ success: false, data: null as unknown as EmployeeExpense, error } as const);

    const expId = id?.trim() ?? '';
    const o = orgId?.trim() ?? '';
    if (!expId) return fail('Expense id is required');
    if (!o) return fail('Organization id is required');

    if (isHttpBackendConfigured()) {
      return apiRequest<EmployeeExpense>(`${ME(o)}/expenses/${encodeURIComponent(expId)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    }

    return fail('HTTP backend required for expense updates');
  },

  async getPayslips(orgId: string, userId: string): Promise<ServiceResponse<EmployeePayslip[]>> {
    if (isHttpBackendConfigured()) {
      const ru = requireOrgAndUser(orgId, userId);
      if (!ru.ok) {
        return { success: false, data: [], error: ru.error };
      }
      return apiGet<EmployeePayslip[]>(`${ME(ru.orgId)}/payslips?userId=${encodeURIComponent(ru.userId)}`);
    }

    await simulateDelay();
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: [], error: ru.error };
    }
    const { orgId: o, userId: u } = ru;
    const rows = dataStore.payslips.filter(p => p.organizationId === o && p.userId === u);
    return { success: true, data: rows };
  },

  async getTimesheets(orgId: string, userId: string): Promise<ServiceResponse<TimesheetEntry[]>> {
    if (isHttpBackendConfigured()) {
      const ru = requireOrgAndUser(orgId, userId);
      if (!ru.ok) {
        return { success: false, data: [], error: ru.error };
      }
      return apiGet<TimesheetEntry[]>(`${ME(ru.orgId)}/timesheets?userId=${encodeURIComponent(ru.userId)}`);
    }

    await simulateDelay();
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: [], error: ru.error };
    }
    const { orgId: o, userId: u } = ru;
    const rows = dataStore.timesheets.filter(t => t.organizationId === o && t.userId === u);
    return { success: true, data: rows };
  },

  async batchCreateTimesheetEntries(
    orgId: string,
    userId: string,
    entries: Array<Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>>,
  ): Promise<ServiceResponse<TimesheetEntry[]>> {
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: [], error: ru.error };
    }
    const { orgId: o, userId: u } = ru;

    if (isHttpBackendConfigured()) {
      return apiPostJson<{ entries: Array<Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>> }, TimesheetEntry[]>(
        `${ME(o)}/timesheets/batch`,
        { entries },
      );
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        // Dynamic member cost lookup
        let effectiveCostPerHour = 50;
        try {
          const { data: memberCostData } = await sb
            .from('organization_members')
            .select('fixed_salary, hourly_rate, hours_per_day, working_days_per_month')
            .eq('organization_id', o)
            .eq('user_id', u)
            .maybeSingle();

          const baseSalary = Number(memberCostData?.fixed_salary || 0);
          const hourlyRateVal = Number(memberCostData?.hourly_rate || 0);
          const hoursPerDay = Number(memberCostData?.hours_per_day || 8);
          const daysPerMonth = Number(memberCostData?.working_days_per_month || 20);
          const capacityHours = (hoursPerDay > 0 && daysPerMonth > 0) ? (hoursPerDay * daysPerMonth) : 160;

          effectiveCostPerHour = baseSalary > 0
            ? Math.round((baseSalary / capacityHours) * 100) / 100
            : (hourlyRateVal > 0 ? hourlyRateVal : 50);
        } catch {}

        const effectiveCostPerMinute = Math.round((effectiveCostPerHour / 60) * 10000) / 10000;
        const insertedRows: TimesheetEntry[] = [];

        for (const item of entries) {
          const hrs = Number(item.hours || 0);
          if (hrs <= 0) continue;
          const entryId = (item as any).id || generateId('ts');
          const calculatedLaborCost = Math.round(hrs * effectiveCostPerHour * 100) / 100;

          const dbRow = {
            id: entryId,
            organization_id: o,
            user_id: u,
            date: item.date,
            project_id: item.projectId,
            project_name: item.projectName || '',
            hours: hrs,
            description: item.description || '',
            billable: item.billable ?? true,
            status: item.status || 'draft',
            task_id: (item as any).taskId || null,
            effective_cost_per_hour: effectiveCostPerHour,
            effective_cost_per_minute: effectiveCostPerMinute,
            calculated_labor_cost: calculatedLaborCost,
          };

          const { error } = await sb.from('timesheet_entries').upsert(dbRow);
          if (!error) {
            insertedRows.push({
              ...item,
              id: entryId,
              organizationId: o,
              userId: u,
              effectiveCostPerHour,
              effectiveCostPerMinute,
              calculatedLaborCost,
            });
            if ((item as any).taskId) {
              try {
                const { data: tRow } = await sb.from('project_tasks').select('logged_hours, status').eq('id', (item as any).taskId).maybeSingle();
                if (tRow) {
                  await sb.from('project_tasks').update({
                    logged_hours: Number(tRow.logged_hours || 0) + hrs,
                    status: tRow.status === 'todo' ? 'in_progress' : tRow.status,
                    updated_at: new Date().toISOString(),
                  }).eq('id', (item as any).taskId);
                }
              } catch {}
            }
          }
        }
        return { success: true, data: insertedRows };
      }
    } catch (e) {
      console.warn('[employeeService.batchCreateTimesheetEntries] direct Supabase insert error:', e);
    }

    await simulateDelay(200);
    const created = entries.map(item => {
      const row: TimesheetEntry = { ...item, id: generateId('ts'), organizationId: o, userId: u };
      dataStore.timesheets.unshift(row);
      return row;
    });
    dataStore.notify('timesheets', true);
    return { success: true, data: created };
  },

  async createTimesheetEntry(
    orgId: string,
    userId: string,
    data: Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>,
  ): Promise<ServiceResponse<TimesheetEntry>> {
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: null as unknown as TimesheetEntry, error: ru.error };
    }
    const { orgId: o, userId: u } = ru;

    if (isHttpBackendConfigured()) {
      return apiPostJson<Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'> & { userId: string }, TimesheetEntry>(
        `${ME(o)}/timesheets`,
        { ...data, userId: u },
      );
    }

    await simulateDelay(200);

    const entry: TimesheetEntry = { ...data, id: generateId('ts'), organizationId: o, userId: u };
    dataStore.timesheets.unshift(entry);
    dataStore.notify('timesheets', true);
    return { success: true, data: entry };
  },

  async submitTimesheet(ids: string[], organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const o = organizationId?.trim() ?? '';
      if (!o) {
        return { success: false, data: null, error: 'organizationId required' };
      }
      return apiPostJson<{ ids: string[] }, null>(`${ME(o)}/timesheets/submit-week`, { ids });
    }

    await simulateDelay(200);
    let changed = false;
    ids.forEach(id => {
      const entry = dataStore.timesheets.find(t => t.id === id);
      if (entry && entry.status === 'draft') {
        entry.status = 'submitted';
        changed = true;
      }
    });
    if (changed) {
      dataStore.notify('timesheets', true);
    }
    return { success: true, data: null, message: 'Timesheet submitted' };
  },

  /**
   * Team directory: real members + real pending invites, read from Supabase only.
   *
   * The old fall-through to the HTTP `/team-directory` route was removed on
   * purpose — that route bottoms out in the Express `store.teamMembers` seed, so
   * a Supabase miss silently rendered demo people as the team.
   */
  async getTeamDirectory(orgId: string): Promise<ServiceResponse<EmployeeTeamMember[]>> {
    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (!sb) {
        return { success: false, data: [], error: 'Supabase is not configured' };
      }

      const { data: orgMems, error: memErr } = await sb
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .in('status', ['active', 'pending']);

      if (memErr) {
        console.warn('[employeeService.getTeamDirectory] members query error:', memErr.message);
        return { success: false, data: [], error: memErr.message };
      }

      console.log('[employeeService.getTeamDirectory] orgMems fetched:', orgMems);

      const { data: teamData } = await sb
        .from('employee_team_members')
        .select('*')
        .eq('organization_id', orgId);

      let profilesMap = new Map();
      if (orgMems && orgMems.length > 0) {
        const userIds = [...new Set(orgMems.map((m: any) => m.user_id).filter(Boolean))];
        if (userIds.length > 0) {
          const { data: profs } = await sb
            .from('profiles')
            .select('*')
            .in('id', userIds);
          if (profs) {
            profs.forEach((p: any) => profilesMap.set(p.id, p));
          }
        }
      }

      const map = new Map<string, EmployeeTeamMember>();

      (teamData || []).forEach((tm: any) => {
        const item: EmployeeTeamMember = {
          id: tm.id || tm.user_id,
          organizationId: tm.organization_id,
          name: tm.name || tm.email?.split('@')[0] || 'Team Member',
          email: tm.email || '',
          phone: tm.phone || '',
          role: tm.role || 'Team Member',
          department: tm.department || 'Development',
          avatar: tm.avatar,
          joinedAt: tm.joined_at,
          status: tm.status || 'active',
        };
        if (tm.email) map.set(tm.email.toLowerCase().trim(), item);
        if (tm.user_id) map.set(tm.user_id, item);
        if (tm.id) map.set(tm.id, item);
      });

      (orgMems || []).forEach((om: any) => {
        const profile = profilesMap.get(om.user_id);
        const email = (profile?.email || '').toLowerCase().trim();
        const existing = (email ? map.get(email) : null) || map.get(om.user_id) || map.get(om.id);
        
        // Determine the display role from position or fallback to role
        const displayRole = om.position || 
          (om.role === 'owner' ? 'Owner / Lead' : 
           om.role === 'admin' ? 'Admin' : 
           om.role === 'accountant' ? 'Accountant' : 
           'Team Member');
        const displayDepartment = om.department || 'Development';
        
        console.log(`[getTeamDirectory] Processing member:`, {
          email,
          user_id: om.user_id,
          position: om.position,
          role: om.role,
          displayRole,
          displayDepartment,
          existing: !!existing
        });
        
        if (existing) {
          // Update existing record with organization_members data (takes precedence)
          existing.role = displayRole;
          existing.department = displayDepartment;
          existing.status = om.status || existing.status;
          if (!existing.name || existing.name === 'Team Member') {
            existing.name = profile?.full_name || email.split('@')[0] || 'Team Member';
          }
          if (!existing.email && profile?.email) {
            existing.email = profile.email;
          }
          const resolvedPhone =
            om.phone ||
            om.employee_settings?.profile?.phone ||
            profile?.phone ||
            profile?.employee_settings?.profile?.phone ||
            '';
          if (resolvedPhone && !existing.phone) {
            existing.phone = resolvedPhone;
          }
          if (profile?.full_name) {
            existing.name = profile.full_name;
          }
        } else {
          const item: EmployeeTeamMember = {
            id: om.user_id,
            organizationId: orgId,
            name: profile?.full_name || email.split('@')[0] || 'Team Member',
            email: profile?.email || '',
            phone:
              om.phone ||
              om.employee_settings?.profile?.phone ||
              profile?.phone ||
              profile?.employee_settings?.profile?.phone ||
              '',
            role: displayRole,
            department: displayDepartment,
            joinedAt: om.joined_at,
            status: om.status || 'active',
          };
          if (email) map.set(email, item);
          map.set(om.user_id, item);
        }
      });

      const uniqueList = Array.from(new Set(map.values()));
      return { success: true, data: uniqueList };
    } catch (err) {
      console.warn('[employeeService.getTeamDirectory] Supabase query error:', err);
      return { success: false, data: [], error: err instanceof Error ? err.message : 'Failed to load team' };
    }
  },

  async getAnnouncements(orgId: string): Promise<ServiceResponse<CompanyAnnouncement[]>> {
    if (isHttpBackendConfigured()) {
      const ro = requireOrg(orgId);
      if (!ro.ok) {
        return { success: false, data: [], error: ro.error };
      }
      return apiGet<CompanyAnnouncement[]>(`/organizations/${encodeURIComponent(ro.orgId)}/announcements`);
    }

    await simulateDelay();
    const ro = requireOrg(orgId);
    if (!ro.ok) {
      return { success: false, data: [], error: ro.error };
    }
    const rows = dataStore.announcements.filter(a => a.organizationId === ro.orgId);
    return { success: true, data: rows };
  },

  async getDashboardSummary(
    orgId: string,
    userId: string,
  ): Promise<ServiceResponse<EmployeeDashboardSummary>> {
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: emptyEmployeeDashboardSummary(), error: ru.error };
    }
    const { orgId: o, userId: u } = ru;

    if (isHttpBackendConfigured()) {
      try {
        const res = await apiGet<EmployeeDashboardSummary>(`${ME(o)}/employee-dashboard?userId=${encodeURIComponent(u)}`);
        if (res.success && res.data) {
          return res;
        }
      } catch (err) {
        console.warn('[employeeService.getDashboardSummary] backend request failed, falling back to Supabase:', err);
      }
    }

    // Direct Supabase query fallback (ensures actual Supabase DB data is always shown)
    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const [
          { data: dbExp },
          { data: dbTs },
          { data: dbPs },
          { data: dbAnn },
          { data: myMembership },
          { data: dbTasks },
          { data: dbProjNotifs },
        ] = await Promise.all([
          sb.from('employee_expenses').select('*').eq('organization_id', o).eq('user_id', u),
          sb.from('timesheet_entries').select('*').eq('organization_id', o).eq('user_id', u),
          sb.from('employee_payslips').select('*').eq('organization_id', o).eq('user_id', u).order('issue_date', { ascending: false }),
          sb.from('company_announcements').select('*').eq('organization_id', o).order('created_at', { ascending: false }).limit(4),
          sb.from('organization_members').select('department, role, position, fixed_salary, assigned_projects').eq('organization_id', o).eq('user_id', u).maybeSingle(),
          sb.from('project_tasks').select('*').eq('organization_id', o),
          sb.from('notifications').select('*').eq('organization_id', o).or(`user_id.eq.${u},user_id.is.null`).order('created_at', { ascending: false }).limit(8),
        ]);

        const expenses: EmployeeExpense[] = (dbExp || []).map((row: any) => ({
          id: row.id,
          organizationId: row.organization_id,
          userId: row.user_id,
          date: row.date,
          description: row.description || '',
          amount: Number(row.amount || 0),
          currency: row.currency || 'USD',
          category: row.category || '',
          status: row.status,
          submittedAt: row.submitted_at,
          notes: row.notes,
          projectId: row.project_id,
          receiptUrl: row.receipt_url,
        }));

        const timesheets: TimesheetEntry[] = (dbTs || []).map((row: any) => ({
          id: row.id,
          organizationId: row.organization_id,
          userId: row.user_id,
          date: row.date,
          projectId: row.project_id,
          projectName: row.project_name || '',
          hours: Number(row.hours || 0),
          description: row.description || '',
          billable: Boolean(row.billable ?? true),
          status: row.status as TimesheetEntry['status'],
          startTime: row.start_time || undefined,
          endTime: row.end_time || undefined,
          durationMinutes: Number(row.duration_minutes || Math.round(Number(row.hours || 0) * 60)),
        }));

        const userPayslips = (dbPs || []).map((p: any) => ({
          id: String(p.id),
          organizationId: String(p.organization_id),
          userId: String(p.user_id),
          period: String(p.period),
          issueDate: String(p.issue_date),
          gross: Number(p.gross || p.net || 0),
          deductions: Array.isArray(p.deductions) ? p.deductions : [],
          net: Number(p.net || 0),
          currency: String(p.currency || 'USD'),
          status: (p.status || 'paid') as any,
        }));

        const memberDepartment = (myMembership as any)?.department ?? undefined;
        const memberPosition = (myMembership as any)?.position || 
          ((myMembership as any)?.role === 'owner' ? 'Owner / Lead' :
           (myMembership as any)?.role === 'admin' ? 'Admin' :
           (myMembership as any)?.role === 'accountant' ? 'Accountant' : 'Member');
        const fixedSalary = Number((myMembership as any)?.fixed_salary || 0);

        let memberAssignedProjects: string[] = [];
        if ((myMembership as any)?.assigned_projects) {
          const rawProj = (myMembership as any).assigned_projects;
          if (Array.isArray(rawProj)) memberAssignedProjects = rawProj;
          else if (typeof rawProj === 'string') {
            try {
              const parsed = JSON.parse(rawProj);
              memberAssignedProjects = Array.isArray(parsed) ? parsed : [rawProj];
            } catch {
              memberAssignedProjects = [rawProj];
            }
          }
        }

        const projectIdsWithTime = timesheets.map(t => t.projectId).filter(Boolean);
        const allAssignedProjects = new Set([...memberAssignedProjects, ...projectIdsWithTime]);

        const employeeDbTasks = (dbTasks || []).filter((t: any) => t.assigned_to === u || (!t.assigned_to && allAssignedProjects.has(t.project_id)));
        let totalTasks = employeeDbTasks.length;
        let completedTasks = employeeDbTasks.filter((t: any) => t.status === 'completed').length;
        if (totalTasks === 0) {
          const uniqueTasks = Array.from(new Set(timesheets.map(t => t.description?.trim()).filter(Boolean)));
          totalTasks = uniqueTasks.length > 0 ? uniqueTasks.length : (allAssignedProjects.size > 0 ? allAssignedProjects.size : 0);
          completedTasks = timesheets.filter(t => t.status === 'approved' && t.description?.trim()).length > 0
            ? uniqueTasks.filter(task => timesheets.some(t => t.description?.trim() === task && t.status === 'approved')).length
            : 0;
        }

        const pending = expenses.filter(e => e.status === 'draft' || e.status === 'submitted');
        const mon = mondayOfWeek(new Date());
        const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const weeklyHours = dayLabels.map((day, i) => {
          const d = new Date(mon);
          d.setDate(mon.getDate() + i);
          const ds = ymd(d);
          const hours = timesheets.filter(t => t.date === ds).reduce((s, t) => s + t.hours, 0);
          return { day, hours };
        });
        const thisWeekHours = weeklyHours.reduce((s, t) => s + t.hours, 0);

        const latestPay = [...userPayslips].sort((a, b) => parseTs(b.issueDate) - parseTs(a.issueDate))[0];
        const fallbackSalary = fixedSalary > 0
          ? { gross: fixedSalary, net: fixedSalary, currency: 'USD' }
          : { gross: 0, net: 0, currency: 'USD' };
        const salary = latestPay
          ? { gross: latestPay.gross, net: latestPay.net, currency: latestPay.currency }
          : fallbackSalary;

        const ann = (dbAnn || []).map((a: any) => ({
          id: a.id,
          title: a.title,
          date: new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
          urgent: Boolean(a.is_pinned),
        }));

        const activityRaw: {
          id: string;
          type: 'expense' | 'timesheet' | 'project' | 'payslip';
          text: string;
          ts: number;
          status: string;
          amount?: number;
        }[] = [];
        expenses.forEach(e => {
          activityRaw.push({
            id: `exp-${e.id}`,
            type: 'expense',
            text: e.description,
            ts: parseTs(e.submittedAt, e.date),
            status: e.status === 'submitted' ? 'pending' : e.status,
            amount: e.amount,
          });
        });
        timesheets.forEach(t => {
          activityRaw.push({
            id: `ts-${t.id}`,
            type: 'timesheet',
            text: `Logged ${t.hours}h on ${t.projectName}`,
            ts: parseTs(undefined, t.date),
            status: t.status,
          });
        });
        if (latestPay) {
          activityRaw.push({
            id: `pay-${latestPay.id}`,
            type: 'payslip',
            text: `${latestPay.period} payslip available`,
            ts: parseTs(undefined, latestPay.issueDate),
            status: 'info',
          });
        }
        activityRaw.sort((a, b) => b.ts - a.ts);
        const recentActivity = activityRaw.slice(0, 8).map(a => ({
          id: a.id,
          type: a.type,
          text: a.text,
          time: a.ts ? new Date(a.ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '',
          status: a.status,
          amount: a.amount,
        }));

        return {
          success: true,
          data: {
            hoursThisWeek: thisWeekHours,
            hoursTarget: 40,
            pendingExpenses: pending.length,
            pendingExpenseAmount: pending.reduce((s, e) => s + e.amount, 0),
            activeProjects: allAssignedProjects.size,
            salary,
            weeklyHours,
            recentActivity,
            announcements: ann,
            projectNotifications: (dbProjNotifs || []).map((n: any) => ({
              id: n.id,
              title: n.title,
              message: n.message,
              type: n.type || 'info',
              category: n.category || 'projects',
              date: new Date(n.created_at || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
              urgent: Boolean(n.priority === 'urgent' || n.priority === 'high'),
              actionUrl: n.action_url || (n.action_tab ? `/employee?tab=${n.action_tab}` : undefined),
            })),
            completedTasks,
            totalTasks,
            department: memberDepartment ?? 'Team',
            position: memberPosition ?? 'Member',
            lastPayPeriod: latestPay?.period ?? '',
          },
        };
      }
    } catch (e) {
      console.warn('[employeeService.getDashboardSummary] Supabase direct query fallback failed:', e);
    }

    await simulateDelay();

    const expenses = dataStore.expenses.filter(e => e.userId === u && e.organizationId === o);
    const timesheets = dataStore.timesheets.filter(t => t.userId === u && t.organizationId === o);
    const pending = expenses.filter(e => e.status === 'draft' || e.status === 'submitted');

    const mon = mondayOfWeek(new Date());
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weeklyHours = dayLabels.map((day, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      const ds = ymd(d);
      const hours = timesheets.filter(t => t.date === ds).reduce((s, t) => s + t.hours, 0);
      return { day, hours };
    });

    const thisWeekHours = weeklyHours.reduce((s, t) => s + t.hours, 0);

    const userPayslips = dataStore.payslips.filter(p => p.userId === u && p.organizationId === o);
    const latestPay = [...userPayslips].sort((a, b) => parseTs(b.issueDate) - parseTs(a.issueDate))[0];

    let memberDepartment: string | undefined;
    let memberPosition: string | undefined;

    const activityRaw: {
      id: string;
      type: 'expense' | 'timesheet' | 'project' | 'payslip';
      text: string;
      ts: number;
      status: string;
      amount?: number;
    }[] = [];

    expenses.forEach(e => {
      activityRaw.push({
        id: `exp-${e.id}`,
        type: 'expense',
        text: e.description,
        ts: parseTs(e.submittedAt, e.date),
        status: e.status === 'submitted' ? 'pending' : e.status,
        amount: e.amount,
      });
    });
    timesheets.forEach(t => {
      activityRaw.push({
        id: `ts-${t.id}`,
        type: 'timesheet',
        text: `Logged ${t.hours}h on ${t.projectName}`,
        ts: parseTs(undefined, t.date),
        status: t.status,
      });
    });
    if (latestPay) {
      activityRaw.push({
        id: `pay-${latestPay.id}`,
        type: 'payslip',
        text: `${latestPay.period} payslip available`,
        ts: parseTs(undefined, latestPay.issueDate),
        status: 'info',
      });
    }

    activityRaw.sort((a, b) => b.ts - a.ts);
    const recentActivity = activityRaw.slice(0, 8).map(a => ({
      id: a.id,
      type: a.type,
      text: a.text,
      time: a.ts ? new Date(a.ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '',
      status: a.status,
      amount: a.amount,
    }));

    const ann = dataStore.announcements
      .filter(a => a.organizationId === o)
      .sort((a, b) => parseTs(b.createdAt) - parseTs(a.createdAt))
      .slice(0, 4)
      .map(a => ({
        id: a.id,
        title: a.title,
        date: new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
        urgent: a.isPinned,
      }));

    return {
      success: true,
      data: {
        hoursThisWeek: thisWeekHours,
        hoursTarget: 40,
        pendingExpenses: pending.length,
        pendingExpenseAmount: pending.reduce((s, e) => s + e.amount, 0),
        activeProjects: new Set(timesheets.map(t => t.projectId)).size,
        salary: latestPay
          ? { gross: latestPay.gross, net: latestPay.net, currency: latestPay.currency }
          : { gross: 0, net: 0, currency: 'USD' },
        weeklyHours,
        recentActivity,
        announcements: ann,
        projectNotifications: [],
        completedTasks: 0,
        totalTasks: 0,
        department: memberDepartment ?? 'Team',
        position: memberPosition ?? 'Member',
        lastPayPeriod: latestPay?.period ?? '',
      },
    };
  },

  async getTimesheetsByOrg(orgId: string, projectId?: string): Promise<ServiceResponse<TimesheetEntry[]>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: [], error: 'Organization ID is required' };

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        let q = sb
          .from('timesheet_entries')
          .select('*')
          .eq('organization_id', o);

        if (projectId) q = q.eq('project_id', projectId);

        const { data, error } = await q.order('date', { ascending: false });

        if (!error && data) {
          const mapped: TimesheetEntry[] = data.map((row: any) => ({
            id: row.id,
            organizationId: row.organization_id,
            userId: row.user_id,
            date: row.date,
            projectId: row.project_id,
            projectName: row.project_name || '',
            hours: Number(row.hours || 0),
            description: row.description || '',
            billable: Boolean(row.billable ?? true),
            status: row.status as TimesheetEntry['status'],
          }));
          return { success: true, data: mapped };
        }
      }
    } catch (sbErr) {
      console.warn('[employeeService.getTimesheetsByOrg] Supabase direct query error:', sbErr);
    }

    if (isHttpBackendConfigured()) {
      const queryParams = new URLSearchParams({ all: 'true' });
      if (projectId) queryParams.set('projectId', projectId);
      return apiGet<TimesheetEntry[]>(`${ME(o)}/timesheets?${queryParams.toString()}`);
    }

    return { success: true, data: [] };
  },

  async getMyTasks(orgId: string, userId?: string): Promise<ServiceResponse<ProjectTask[]>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: [], error: 'Organization ID is required' };

    if (isHttpBackendConfigured()) {
      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      return apiGet<ProjectTask[]>(`${ME(o)}/tasks${qs}`);
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        let q = sb.from('project_tasks').select('*').eq('organization_id', o);
        if (userId) q = q.eq('assigned_to', userId);
        const { data, error } = await q.order('created_at', { ascending: false });
        if (!error && data) {
          const mapped: ProjectTask[] = data.map((t: any) => ({
            id: t.id,
            organizationId: t.organization_id,
            projectId: t.project_id,
            title: t.title,
            description: t.description || undefined,
            assignedTo: t.assigned_to || undefined,
            assignedToName: t.assigned_to_name || undefined,
            status: t.status || 'todo',
            priority: t.priority || 'medium',
            estimatedHours: Number(t.estimated_hours || 0),
            loggedHours: Number(t.logged_hours || 0),
            dueDate: t.due_date || undefined,
            createdAt: t.created_at || undefined,
          }));
          return { success: true, data: mapped };
        }
      }
    } catch (err) {
      console.warn('[employeeService.getMyTasks] Supabase query error:', err);
    }

    return { success: true, data: [] };
  },

  async updateTaskStatus(orgId: string, taskId: string, status: string, userId?: string): Promise<ServiceResponse<ProjectTask>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null as any, error: 'Organization ID is required' };

    if (isHttpBackendConfigured()) {
      return apiRequest<ProjectTask>(`${ME(o)}/tasks/${encodeURIComponent(taskId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, userId }),
      });
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb
          .from('project_tasks')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', taskId)
          .eq('organization_id', o)
          .select()
          .maybeSingle();
        if (!error && data) {
          return {
            success: true,
            data: {
              id: data.id,
              organizationId: data.organization_id,
              projectId: data.project_id,
              title: data.title,
              description: data.description || undefined,
              assignedTo: data.assigned_to || undefined,
              assignedToName: data.assigned_to_name || undefined,
              status: data.status || 'todo',
              priority: data.priority || 'medium',
              estimatedHours: Number(data.estimated_hours || 0),
              loggedHours: Number(data.logged_hours || 0),
              dueDate: data.due_date || undefined,
              createdAt: data.created_at || undefined,
            },
          };
        }
      }
    } catch (err) {
      console.warn('[employeeService.updateTaskStatus] Supabase error:', err);
    }

    return { success: false, data: null as any, error: 'Failed to update task status' };
  },

  async getPayrollOverview(orgId: string): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null, error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      return apiGet<any>(`${ME(o)}/payroll/overview`);
    }
    return { success: true, data: { members: [], debitTransactions: [], payslips: [], aiSuggestions: [] } };
  },

  async getAdminExpenseQueue(orgId: string): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: [], error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      return apiGet<any>(`${ME(o)}/expenses/admin/queue`);
    }
    return { success: true, data: [] };
  },

  async issuePayslips(orgId: string, payload: any): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null, error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      return apiPostJson<any, any>(`${ME(o)}/payslips/issue`, payload);
    }
    return { success: true, data: payload, message: 'Payslips issued' };
  },

  async autoDetectPayroll(orgId: string): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null, error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      return apiPostJson<any, any>(`${ME(o)}/payroll/auto-detect`, {});
    }
    return { success: true, data: { detectedCount: 0 } };
  },

  async voidPayslip(orgId: string, payslipId: string, reason?: string): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null, error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      return apiPostJson<any, any>(`${ME(o)}/payslips/void`, { payslipId, reason });
    }
    return { success: true, data: { voided: true } };
  },

  async reviewExpense(orgId: string, expenseId: string, decision: string, reviewNotes?: string): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null, error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiPostJson<any, any>(`${ME(o)}/expenses/${encodeURIComponent(expenseId)}/review`, { decision, reviewNotes });
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
        const { data: updatedExp, error: updateErr } = await sb
          .from('employee_expenses')
          .update({
            status: decision === 'rejected' ? 'rejected' : 'approved',
            reviewed_at: nowIso,
            rejection_reason: decision === 'rejected' ? (reviewNotes || null) : null,
          })
          .eq('id', expenseId)
          .eq('organization_id', o)
          .select()
          .single();

        if (!updateErr && updatedExp) {
          const { employeeService } = await import('./employeeService');
          const sRes = await employeeService.getMySettings(o, updatedExp.user_id);
          if (sRes.data?.notifications?.expenseApprovals !== false) {
            const desc = updatedExp.description || 'Expense claim';
            const amountStr = `${updatedExp.currency || 'USD'} ${Number(updatedExp.amount || 0).toFixed(2)}`;
            const isApproved = updatedExp.status === 'approved';
            await sb.from('notifications').insert({
              organization_id: o,
              user_id: updatedExp.user_id,
              portal: 'employee',
              title: isApproved ? `Expense Approved: ${desc}` : `Expense Rejected: ${desc}`,
              message: isApproved
                ? `Your expense "${desc}" (${amountStr}) has been approved and queued for reimbursement.`
                : `Your expense "${desc}" (${amountStr}) was rejected.${reviewNotes ? ` Reason: ${reviewNotes}` : ''}`,
              type: isApproved ? 'success' : 'warning',
              category: 'approvals',
              is_read: false,
              action_tab: 'expenses',
            } as any);
          }
          return { success: true, data: updatedExp };
        }
      }
    } catch (err: any) {
      console.warn('[employeeService.reviewExpense] Supabase fallback warning:', err);
    }

    return { success: true, data: { reviewed: true } };
  },

  async settleExpense(orgId: string, expenseId: string, transactionId?: string): Promise<ServiceResponse<any>> {
    const o = orgId?.trim();
    if (!o) return { success: false, data: null, error: 'Organization ID is required' };
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiPostJson<any, any>(`${ME(o)}/expenses/${encodeURIComponent(expenseId)}/settle`, { transactionId });
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
        const { data: updatedExp, error: updateErr } = await sb
          .from('employee_expenses')
          .update({
            status: 'reimbursed',
            reimbursed_at: nowIso,
            settlement_transaction_id: transactionId || null,
          })
          .eq('id', expenseId)
          .eq('organization_id', o)
          .select()
          .single();

        if (!updateErr && updatedExp) {
          const { employeeService } = await import('./employeeService');
          const sRes = await employeeService.getMySettings(o, updatedExp.user_id);
          if (sRes.data?.notifications?.expenseApprovals !== false) {
            const desc = updatedExp.description || 'Expense claim';
            const amountStr = `${updatedExp.currency || 'USD'} ${Number(updatedExp.amount || 0).toFixed(2)}`;
            await sb.from('notifications').insert({
              organization_id: o,
              user_id: updatedExp.user_id,
              portal: 'employee',
              title: `Expense Reimbursed: ${desc}`,
              message: `Your approved expense "${desc}" (${amountStr}) has been settled and reimbursed.`,
              type: 'success',
              category: 'approvals',
              is_read: false,
              action_tab: 'expenses',
            } as any);
          }
          return { success: true, data: updatedExp };
        }
      }
    } catch (err: any) {
      console.warn('[employeeService.settleExpense] Supabase fallback warning:', err);
    }

    return { success: true, data: { settled: true } };
  },

  async getMySettings(
    orgId: string,
    userId: string,
  ): Promise<ServiceResponse<EmployeeUserSettings>> {
    const ru = requireOrgAndUser(orgId, userId);
    const defaultSettings: EmployeeUserSettings = {
      userId: userId || '',
      organizationId: orgId || '',
      profile: {
        fullName: '',
        email: '',
        phone: '',
        department: 'Development',
        position: 'Employee',
        role: 'employee',
      },
      notifications: {
        emailNotifications: true,
        expenseApprovals: true,
        timesheetReminders: true,
        projectUpdates: false,
        companyAnnouncements: true,
      },
      security: {
        twoFactorEnabled: true,
        sessionTimeout: '30 minutes',
      },
      updatedAt: new Date().toISOString(),
    };

    if (!ru.ok) {
      return { success: false, data: defaultSettings, error: ru.error };
    }

    if (isHttpBackendConfigured()) {
      const res = await apiGet<EmployeeUserSettings>(`${ME(ru.orgId)}/settings`);
      if (res.success && res.data) {
        return res;
      }
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const [{ data: prof }, { data: om }, { data: authData }] = await Promise.all([
          sb.from('profiles').select('*').eq('id', ru.userId).maybeSingle(),
          sb
            .from('organization_members')
            .select('*')
            .eq('organization_id', ru.orgId)
            .eq('user_id', ru.userId)
            .maybeSingle(),
          sb.auth.getUser(),
        ]);

        const authMeta = authData?.user?.user_metadata || {};
        const omSettings = (om as any)?.employee_settings || {};
        const profSettings = (prof as any)?.employee_settings || {};
        const metaSettings = authMeta?.employee_settings || {};

        const email = String(
          (prof as any)?.email || authData?.user?.email || '',
        ).trim();
        const fullName = String(
          (prof as any)?.full_name ||
            omSettings?.profile?.fullName ||
            profSettings?.profile?.fullName ||
            authMeta?.full_name ||
            authMeta?.name ||
            (email ? email.split('@')[0] : 'Employee'),
        ).trim();
        const phone = String(
          (om as any)?.phone ||
            (prof as any)?.phone ||
            omSettings?.profile?.phone ||
            profSettings?.profile?.phone ||
            metaSettings?.profile?.phone ||
            authMeta?.phone ||
            '',
        ).trim();
        const department = String(
          (om as any)?.department || 'Development',
        ).trim();
        const position = String(
          (om as any)?.position || (om as any)?.role || 'Employee',
        ).trim();

        const mergedNotifs = {
          ...defaultSettings.notifications,
          ...(metaSettings?.notifications || {}),
          ...(profSettings?.notifications || {}),
          ...(omSettings?.notifications || {}),
        };
        const mergedSecurity = {
          ...defaultSettings.security,
          ...(metaSettings?.security || {}),
          ...(profSettings?.security || {}),
          ...(omSettings?.security || {}),
        };

        return {
          success: true,
          data: {
            userId: ru.userId,
            organizationId: ru.orgId,
            profile: {
              fullName,
              email,
              phone,
              department,
              position,
              role: String((om as any)?.role || 'employee'),
            },
            notifications: mergedNotifs,
            security: mergedSecurity,
            updatedAt: String(
              omSettings?.updatedAt ||
                profSettings?.updatedAt ||
                metaSettings?.updatedAt ||
                new Date().toISOString(),
            ),
          },
        };
      }
    } catch (err) {
      console.warn('[employeeService.getMySettings] Supabase fallback error:', err);
    }

    return { success: true, data: defaultSettings };
  },

  async updateMySettings(
    orgId: string,
    userId: string,
    payload: {
      profile?: Partial<EmployeeUserSettings['profile']>;
      notifications?: Partial<EmployeeNotificationPreferences>;
      security?: Partial<EmployeeSecuritySettings>;
    },
  ): Promise<ServiceResponse<EmployeeUserSettings>> {
    const ru = requireOrgAndUser(orgId, userId);
    if (!ru.ok) {
      return { success: false, data: null as any, error: ru.error };
    }

    if (isHttpBackendConfigured()) {
      try {
        const res = await apiRequest<EmployeeUserSettings>(`${ME(ru.orgId)}/settings`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (res.success && res.data) {
          return res;
        }
        console.warn('[employeeService.updateMySettings] Backend HTTP returned non-success, falling back to direct Supabase:', res.error);
      } catch (httpErr) {
        console.warn('[employeeService.updateMySettings] Backend HTTP request failed, falling back to direct Supabase:', httpErr);
      }
    }

    try {
      const current = await this.getMySettings(ru.orgId, ru.userId);
      const base = current.data;
      const nowIso = new Date().toISOString();

      const nextFullName =
        payload.profile?.fullName !== undefined
          ? String(payload.profile.fullName).trim()
          : base.profile.fullName;
      const nextPhone =
        payload.profile?.phone !== undefined
          ? String(payload.profile.phone).trim()
          : base.profile.phone;

      const nextNotifications: EmployeeNotificationPreferences = {
        ...base.notifications,
        ...(payload.notifications || {}),
      };
      const nextSecurity: EmployeeSecuritySettings = {
        ...base.security,
        ...(payload.security || {}),
      };

      const settingsBlob = {
        profile: { fullName: nextFullName, phone: nextPhone },
        notifications: nextNotifications,
        security: nextSecurity,
        updatedAt: nowIso,
      };

      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        // 1. Update public.profiles with column fallback
        try {
          const { error: pErr1 } = await sb
            .from('profiles')
            .update({
              full_name: nextFullName,
              phone: nextPhone,
              employee_settings: settingsBlob,
              updated_at: nowIso,
            })
            .eq('id', ru.userId);

          if (pErr1) {
            await sb
              .from('profiles')
              .update({
                full_name: nextFullName,
                updated_at: nowIso,
              })
              .eq('id', ru.userId);
          }
        } catch (profErr) {
          console.warn('[employeeService.updateMySettings] profiles update non-fatal warning:', profErr);
        }

        // 2. Update public.organization_members
        try {
          await sb
            .from('organization_members')
            .update({
              phone: nextPhone,
              employee_settings: settingsBlob,
            })
            .eq('organization_id', ru.orgId)
            .eq('user_id', ru.userId);
        } catch (omErr) {
          console.warn('[employeeService.updateMySettings] organization_members update non-fatal warning:', omErr);
        }

        // 3. Update public.employee_team_members so Organization dashboard & Team Directory reflect new name
        try {
          const userEmail = base.profile.email?.toLowerCase().trim();
          const { data: teamRows } = await sb
            .from('employee_team_members')
            .select('id, user_id, email')
            .eq('organization_id', ru.orgId);

          const matchingRows = (teamRows || []).filter(
            (r: any) =>
              (r.user_id && String(r.user_id) === ru.userId) ||
              (userEmail && String(r.email || '').toLowerCase().trim() === userEmail),
          );

          for (const row of matchingRows) {
            try {
              const { error: tmErr } = await sb
                .from('employee_team_members')
                .update({
                  name: nextFullName,
                  phone: nextPhone,
                  user_id: ru.userId,
                })
                .eq('id', row.id);

              if (tmErr) {
                await sb
                  .from('employee_team_members')
                  .update({ name: nextFullName })
                  .eq('id', row.id);
              }
            } catch {
              /* ignore individual row error */
            }
          }
        } catch (tmErr) {
          console.warn('[employeeService.updateMySettings] employee_team_members update warning:', tmErr);
        }

        // 4. Update Supabase Auth user metadata
        try {
          await sb.auth.updateUser({
            data: {
              full_name: nextFullName,
              name: nextFullName,
              phone: nextPhone,
              employee_settings: settingsBlob,
            },
          });
        } catch (authErr) {
          console.warn('[employeeService.updateMySettings] auth.updateUser non-fatal warning:', authErr);
        }
      }

      // 5. Keep local in-memory dataStore updated if active
      try {
        const u = dataStore.users.find((x) => x.id === ru.userId);
        if (u) u.name = nextFullName;
        const tm = dataStore.teamMembers.find(
          (x) => x.id === ru.userId || (x as any).userId === ru.userId,
        );
        if (tm) {
          tm.name = nextFullName;
          (tm as any).phone = nextPhone;
        }
      } catch {
        /* ignore */
      }

      const updated: EmployeeUserSettings = {
        ...base,
        profile: {
          ...base.profile,
          fullName: nextFullName,
          phone: nextPhone,
        },
        notifications: nextNotifications,
        security: nextSecurity,
        updatedAt: nowIso,
      };

      return {
        success: true,
        data: updated,
        message: 'Settings saved successfully',
      };
    } catch (err: any) {
      return {
        success: false,
        data: null as any,
        error: err?.message || 'Failed to update settings',
      };
    }
  },

  async submitSupportRequest(
    orgId: string,
    payload: { subject: string; message: string; category?: string },
  ): Promise<ServiceResponse<{ submittedAt: string }>> {
    const ro = requireOrg(orgId);
    if (!ro.ok) {
      return { success: false, data: null as any, error: ro.error };
    }
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiPostJson<typeof payload, { submittedAt: string }>(
          `${ME(ro.orgId)}/support-request`,
          payload,
        );
        if (res.success) return res;
      } catch {
        /* fallback to Supabase */
      }
    }

    const nowIso = new Date().toISOString();
    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const { data: authData } = await sb.auth.getUser();
        const userEmail = authData?.user?.email || 'employee';
        const userName =
          authData?.user?.user_metadata?.full_name ||
          authData?.user?.user_metadata?.name ||
          userEmail.split('@')[0];

        const notifRow = {
          organization_id: ro.orgId,
                    title: `Employee Support Request: ${payload.subject}`,
          message: `From ${userName} (${userEmail}): ${payload.message}`,
          type: 'info',
          category: payload.category || 'general',
          action_url: '/dashboard?view=team',
          action_label: 'View Team',
          is_read: false,
          created_at: nowIso,
        };

        await sb.from('notifications').insert(notifRow);

        await sb.from('audit_logs').insert({
          organization_id: ro.orgId,
          actor_user_id: authData?.user?.id || null,
          actor_email: userEmail,
          actor_role: 'employee',
          action: 'employee_support.requested',
          entity_type: 'support_request',
          entity_id: authData?.user?.id || 'unknown',
          description: `Employee support requested: ${payload.subject}`,
          after_state: { subject: payload.subject, category: payload.category || 'general', message: payload.message },
          metadata: { actor_name: userName },
          created_at: nowIso,
        });
      }
    } catch (sbErr) {
      console.warn('[employeeService.submitSupportRequest] Supabase insert warning:', sbErr);
    }

    try {
      (dataStore.notifications as any).unshift({
        id: `notif_${Date.now()}`,
        userId: '',
        organizationId: ro.orgId,
        title: `Employee Support Request: ${payload.subject}`,
        message: payload.message,
        type: 'info',
        category: (payload.category as any) || 'general',
        actionUrl: '/dashboard?view=team',
        actionLabel: 'View Team',
        isRead: false,
        createdAt: nowIso,
      });
      dataStore.notify('notifications');
    } catch {
      /* ignore */
    }

    return {
      success: true,
      data: { submittedAt: nowIso },
      message: 'Support request sent to your organization administrator',
    };
  },
};