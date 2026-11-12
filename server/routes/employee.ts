/**
 * §18 — Employee workspace `/me/*`. Mounted at `/organizations/:organizationId/me` (mergeParams).
 * Mirrors `employeeService` (dataStore branch) exactly, including validation + dedupe rules.
 */

import { Router, type Request, type Response } from 'express';
import type {
  EmployeeExpense,
  TimesheetEntry,
  ProjectTask,
  EmployeeUserSettings,
  EmployeeNotificationPreferences,
  EmployeeSecuritySettings,
  EmployeeSessionTimeout,
} from '../../src/services/types.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { detectAndIssuePayslipsForTransactions, voidPayslip } from '../lib/aiPayrollDetector.js';
import { canViewConfidentialPayroll, canWriteFinance } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { createEmployeeAIAssistantRouter } from './employeeAIAssistant.js';

/**
 * Every route here is a self-service endpoint for the logged-in employee (mounted under
 * `/organizations/:organizationId/me`, already gated by requireAuth + requireOrgMembership in
 * apiV1.ts). `userId` therefore always comes from `req.authUser`, never from a client-supplied
 * query/body field — a client could otherwise pass any other employee's `userId` and read or
 * mutate their expenses/timesheets/payslips. Platform staff (who bypass org-membership checks)
 * don't have a personal "me" workspace in any org, so they're intentionally excluded here too.
 */
function callerId(req: Request): string {
  return req.authUser!.id;
}

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
  return [e.date.trim(), String(e.amount), e.category.trim().toLowerCase(), e.description.trim().toLowerCase(), e.status, e.currency.trim().toUpperCase()].join('');
}

function hasDuplicateExpense(organizationId: string, userId: string, candidate: any): boolean { return false; }

function mapDbExpenseToDomain(row: any): EmployeeExpense {
  let rejectionReason = row.rejection_reason || undefined;
  if (!rejectionReason && typeof row.notes === 'string' && row.notes.startsWith('REJECTED:')) {
    rejectionReason = row.notes.replace(/^REJECTED:\s*/, '').trim();
  }
  return {
    id: row.id,
    organizationId: row.organization_id || row.organizationId,
    userId: row.user_id || row.userId,
    date: row.date,
    description: row.description || '',
    amount: Number(row.amount || 0),
    currency: row.currency || 'USD',
    category: row.category || 'Other',
    status: row.status as EmployeeExpense['status'],
    receiptUrl: row.receipt_url || row.receiptUrl || undefined,
    notes: row.notes || undefined,
    projectId: row.project_id || row.projectId || undefined,
    submittedAt: row.submitted_at || row.submittedAt || undefined,
    reviewedBy: row.reviewed_by || row.reviewedBy || undefined,
    reviewedAt: row.reviewed_at || row.reviewedAt || undefined,
    rejectionReason,
    reimbursedAt: row.reimbursed_at || row.reimbursedAt || undefined,
    settlementTransactionId: row.settlement_transaction_id || row.settlementTransactionId || undefined,
  };
}

const DEFAULT_EMPLOYEE_NOTIFICATIONS: EmployeeNotificationPreferences = {
  emailNotifications: true,
  expenseApprovals: true,
  timesheetReminders: true,
  projectUpdates: false,
  companyAnnouncements: true,
};

const DEFAULT_EMPLOYEE_SECURITY: EmployeeSecuritySettings = {
  twoFactorEnabled: true,
  sessionTimeout: '30 minutes',
};

const VALID_SESSION_TIMEOUTS: EmployeeSessionTimeout[] = [
  '15 minutes',
  '30 minutes',
  '1 hour',
  '4 hours',
  '8 hours',
];

function normalizeNotifications(raw: any): EmployeeNotificationPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EMPLOYEE_NOTIFICATIONS };
  return {
    emailNotifications:
      typeof raw.emailNotifications === 'boolean'
        ? raw.emailNotifications
        : DEFAULT_EMPLOYEE_NOTIFICATIONS.emailNotifications,
    expenseApprovals:
      typeof raw.expenseApprovals === 'boolean'
        ? raw.expenseApprovals
        : DEFAULT_EMPLOYEE_NOTIFICATIONS.expenseApprovals,
    timesheetReminders:
      typeof raw.timesheetReminders === 'boolean'
        ? raw.timesheetReminders
        : DEFAULT_EMPLOYEE_NOTIFICATIONS.timesheetReminders,
    projectUpdates:
      typeof raw.projectUpdates === 'boolean'
        ? raw.projectUpdates
        : DEFAULT_EMPLOYEE_NOTIFICATIONS.projectUpdates,
    companyAnnouncements:
      typeof raw.companyAnnouncements === 'boolean'
        ? raw.companyAnnouncements
        : DEFAULT_EMPLOYEE_NOTIFICATIONS.companyAnnouncements,
  };
}

function normalizeSecurity(raw: any): EmployeeSecuritySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EMPLOYEE_SECURITY };
  const timeoutCandidate = String(raw.sessionTimeout || '').trim() as EmployeeSessionTimeout;
  const sessionTimeout: EmployeeSessionTimeout = VALID_SESSION_TIMEOUTS.includes(timeoutCandidate)
    ? timeoutCandidate
    : DEFAULT_EMPLOYEE_SECURITY.sessionTimeout;
  return {
    twoFactorEnabled:
      typeof raw.twoFactorEnabled === 'boolean'
        ? raw.twoFactorEnabled
        : DEFAULT_EMPLOYEE_SECURITY.twoFactorEnabled,
    sessionTimeout,
  };
}

export async function resolveEmployeeUserSettings(
  sb: any,
  orgId: string,
  userId: string,
  fallbackEmail?: string,
  fallbackName?: string,
): Promise<EmployeeUserSettings> {
  let profileRow: any = null;
  let memberRow: any = null;
  let teamRow: any = null;
  let authUser: any = null;

  if (sb && userId) {
    const [profRes, memRes, teamRes, authRes] = await Promise.allSettled([
      sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
      sb
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle(),
      sb.from('employee_team_members').select('*').eq('organization_id', orgId),
      sb.auth?.admin?.getUserById ? sb.auth.admin.getUserById(userId) : Promise.resolve({ data: null }),
    ]);

    if (profRes.status === 'fulfilled') profileRow = profRes.value?.data || null;
    if (memRes.status === 'fulfilled') memberRow = memRes.value?.data || null;
    if (authRes.status === 'fulfilled') authUser = authRes.value?.data?.user || null;

    const emailToMatch = String(
      profileRow?.email || authUser?.email || fallbackEmail || '',
    )
      .toLowerCase()
      .trim();

    if (teamRes.status === 'fulfilled' && Array.isArray(teamRes.value?.data)) {
      teamRow =
        teamRes.value.data.find(
          (r: any) =>
            (r.user_id && String(r.user_id) === userId) ||
            (emailToMatch && String(r.email || '').toLowerCase().trim() === emailToMatch),
        ) || null;
    }
  }

  const authMeta = authUser?.user_metadata || {};
  const memSettings =
    memberRow?.employee_settings && typeof memberRow.employee_settings === 'object'
      ? memberRow.employee_settings
      : null;
  const profSettings =
    profileRow?.employee_settings && typeof profileRow.employee_settings === 'object'
      ? profileRow.employee_settings
      : null;
  const metaSettings =
    authMeta?.employee_settings && typeof authMeta.employee_settings === 'object'
      ? authMeta.employee_settings
      : null;

  const mergedSettingsSource = {
    notifications: {
      ...(metaSettings?.notifications || {}),
      ...(profSettings?.notifications || {}),
      ...(memSettings?.notifications || {}),
    },
    security: {
      ...(metaSettings?.security || {}),
      ...(profSettings?.security || {}),
      ...(memSettings?.security || {}),
    },
  };

  const email = String(
    profileRow?.email || authUser?.email || teamRow?.email || fallbackEmail || '',
  ).trim();

  const rawFullName = String(
    profileRow?.full_name ||
    memSettings?.profile?.fullName ||
    profSettings?.profile?.fullName ||
    teamRow?.name ||
    authMeta?.full_name ||
    authMeta?.name ||
    fallbackName ||
    '',
  ).trim();

  const fullName = rawFullName || (email ? email.split('@')[0] : 'Employee');

  const phone = String(
    memberRow?.phone ??
    profileRow?.phone ??
    teamRow?.phone ??
    memSettings?.profile?.phone ??
    profSettings?.profile?.phone ??
    metaSettings?.profile?.phone ??
    authMeta?.phone ??
    '',
  ).trim();

  const department = String(
    memberRow?.department ||
    teamRow?.department ||
    (memberRow?.role === 'owner' || memberRow?.role === 'admin' ? 'Management' : 'Development'),
  ).trim();

  const position = String(
    memberRow?.position || teamRow?.role || memberRow?.role || 'Employee',
  ).trim();

  const role = String(memberRow?.role || 'employee').trim();

  return {
    userId,
    organizationId: orgId,
    profile: {
      fullName,
      email,
      phone,
      department,
      position,
      role,
    },
    notifications: normalizeNotifications(mergedSettingsSource.notifications),
    security: normalizeSecurity(mergedSettingsSource.security),
    updatedAt: String(
      memSettings?.updatedAt ||
      profSettings?.updatedAt ||
      metaSettings?.updatedAt ||
      profileRow?.updated_at ||
      new Date().toISOString(),
    ),
  };
}

async function emitEmployeeExpenseNotification(
  sb: any,
  orgId: string,
  exp: any,
  decision: 'approved' | 'rejected' | 'reimbursed',
  reason?: string,
): Promise<void> {
  if (!sb || !exp?.user_id) return;
  try {
    const empSettings = await resolveEmployeeUserSettings(sb, orgId, String(exp.user_id));
    if (!empSettings.notifications.expenseApprovals) {
      return; // Employee opted out of Expense Approvals notifications
    }

    const amountStr = `${exp.currency || 'USD'} ${Number(exp.amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const desc = String(exp.description || 'Expense claim');
    const title =
      decision === 'approved'
        ? `Expense Approved: ${desc}`
        : decision === 'reimbursed'
          ? `Expense Reimbursed: ${desc}`
          : `Expense Rejected: ${desc}`;
    const message =
      decision === 'approved'
        ? `Your expense claim "${desc}" (${amountStr}) has been approved and queued for reimbursement.`
        : decision === 'reimbursed'
          ? `Your approved expense claim "${desc}" (${amountStr}) has been settled and reimbursed.`
          : `Your expense claim "${desc}" (${amountStr}) was rejected.${reason ? ` Reason: ${reason}` : ''}`;

    const baseRow: Record<string, any> = {
      organization_id: orgId,
      portal: 'employee',
      title,
      message,
      type: decision === 'rejected' ? 'warning' : 'success',
      category: 'approvals',
      is_read: false,
      action_tab: 'expenses',
    };

    const { error: insertWithUserErr } = await sb
      .from('notifications')
      .insert({ ...baseRow, user_id: exp.user_id });

    if (insertWithUserErr) {
      // Fallback if user_id column has not been migrated yet
      await sb.from('notifications').insert(baseRow);
    }

    // Complies with FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md §X-03:
    // Optional approved email channel when employee has emailNotifications enabled
    if (empSettings.notifications.emailNotifications && empSettings.profile.email) {
      try {
        const { sendNotificationEmail } = await import('../lib/emailService.js');
        await sendNotificationEmail({
          toEmail: empSettings.profile.email,
          name: empSettings.profile.fullName,
          subject: `[Finance OS] ${title}`,
          title,
          message,
          actionUrl: `/employee?tab=expenses`,
          actionLabel: 'View Expense Claims',
          category: 'expense_approvals',
        });
      } catch (emailErr) {
        console.warn('[employee.expenseEmail] Non-fatal notification email dispatch warning:', emailErr);
      }
    }
  } catch (err) {
    console.warn('[employee.expenseNotification] Non-fatal notification emit warning:', err);
  }
}

export async function emitEmployeeTimesheetApprovalNotification(
  sb: any,
  orgId: string,
  entry: any,
  approverUserId?: string,
): Promise<void> {
  if (!sb || !entry?.user_id) return;
  try {
    const empSettings = await resolveEmployeeUserSettings(sb, orgId, String(entry.user_id));
    if (!empSettings.notifications.timesheetReminders) {
      return; // Opted out of timesheet reminders / status notifications
    }

    const hours = Number(entry.hours || 0);
    const title = `Timesheet Approved: ${hours}h`;
    const message = `Your timesheet entry for ${entry.date || 'the period'} (${hours} hours) has been approved and locked.`;

    const baseRow: Record<string, any> = {
      organization_id: orgId,
      portal: 'employee',
      title,
      message,
      type: 'success',
      category: 'timesheets',
      is_read: false,
      action_tab: 'timesheets',
    };

    const { error: insertErr } = await sb
      .from('notifications')
      .insert({ ...baseRow, user_id: entry.user_id });

    if (insertErr) {
      await sb.from('notifications').insert(baseRow);
    }

    if (empSettings.notifications.emailNotifications && empSettings.profile.email) {
      try {
        const { sendNotificationEmail } = await import('../lib/emailService.js');
        await sendNotificationEmail({
          toEmail: empSettings.profile.email,
          name: empSettings.profile.fullName,
          subject: `[Finance OS] ${title}`,
          title,
          message,
          actionUrl: `/employee?tab=timesheets`,
          actionLabel: 'View Timesheet',
          category: 'timesheets',
        });
      } catch (emailErr) {
        console.warn('[employee.timesheetEmail] Non-fatal email dispatch warning:', emailErr);
      }
    }
  } catch (err) {
    console.warn('[employee.timesheetNotification] Non-fatal error:', err);
  }
}

export async function emitEmployeeTaskAssignmentNotification(
  sb: any,
  orgId: string,
  task: any,
  assignerUserId?: string,
): Promise<void> {
  if (!sb || !task?.assigned_to) return;
  try {
    const empSettings = await resolveEmployeeUserSettings(sb, orgId, String(task.assigned_to));
    if (!empSettings.notifications.projectUpdates) {
      return; // Opted out of Project Updates
    }

    const taskTitle = String(task.title || 'Untitled task');
    const priority = String(task.priority || 'medium');
    const title = `Project Task Assigned: ${taskTitle}`;
    const message = `You have been assigned to task "${taskTitle}" (${priority} priority).`;

    const baseRow: Record<string, any> = {
      organization_id: orgId,
      portal: 'employee',
      title,
      message,
      type: 'info',
      category: 'projects',
      is_read: false,
      action_tab: 'projects',
    };

    const { error: insertErr } = await sb
      .from('notifications')
      .insert({ ...baseRow, user_id: task.assigned_to });

    if (insertErr) {
      await sb.from('notifications').insert(baseRow);
    }

    if (empSettings.notifications.emailNotifications && empSettings.profile.email) {
      try {
        const { sendNotificationEmail } = await import('../lib/emailService.js');
        await sendNotificationEmail({
          toEmail: empSettings.profile.email,
          name: empSettings.profile.fullName,
          subject: `[Finance OS] ${title}`,
          title,
          message,
          actionUrl: `/employee?tab=projects`,
          actionLabel: 'View Projects',
          category: 'projects',
        });
      } catch (emailErr) {
        console.warn('[employee.taskEmail] Non-fatal email dispatch warning:', emailErr);
      }
    }
  } catch (err) {
    console.warn('[employee.taskNotification] Non-fatal error:', err);
  }
}

export async function emitEmployeePayslipIssuedNotification(
  sb: any,
  orgId: string,
  payslip: {
    id: string;
    userId: string;
    period: string;
    issueDate?: string;
    gross: number;
    deductions?: Array<{ label?: string; name?: string; amount: number }>;
    net: number;
    currency?: string;
    employeeName?: string;
  },
  orgName?: string,
): Promise<void> {
  if (!sb || !payslip?.userId) return;
  try {
    const empSettings = await resolveEmployeeUserSettings(
      sb,
      orgId,
      String(payslip.userId),
      undefined,
      payslip.employeeName,
    );

    let toEmail = empSettings.profile.email;
    let toName = empSettings.profile.fullName || payslip.employeeName;

    // Fallback lookup: query organization_members or users
    if (!toEmail) {
      try {
        const { data: member } = await sb
          .from('organization_members')
          .select('user_email, name')
          .eq('organization_id', orgId)
          .eq('user_id', payslip.userId)
          .maybeSingle();
        if (member?.user_email) {
          toEmail = member.user_email;
          if (!toName && member.name) toName = member.name;
        }
        if (!toEmail) {
          const { data: usr } = await sb
            .from('users')
            .select('email, name')
            .eq('id', payslip.userId)
            .maybeSingle();
          if (usr?.email) {
            toEmail = usr.email;
            if (!toName && usr.name) toName = usr.name;
          }
        }
      } catch (lookupErr) {
        console.warn('[employee.payslipLookup] Non-fatal member lookup warning:', lookupErr);
      }
    }

    const cur = payslip.currency || 'USD';
    const netFormatted = `${cur} ${Number(payslip.net || payslip.gross || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const title = `Payslip Issued: ${payslip.period}`;
    const message = `Your payslip for ${payslip.period} (${netFormatted} net pay) has been issued and is ready to view.`;

    const baseRow: Record<string, any> = {
      organization_id: orgId,
      portal: 'employee',
      title,
      message,
      type: 'success',
      category: 'payslips',
      is_read: false,
      action_url: '/employee?tab=payslips',
      action_label: 'View Payslips',
      action_tab: 'payslips',
    };

    const { error: insertErr } = await sb
      .from('notifications')
      .insert({ ...baseRow, user_id: payslip.userId });

    if (insertErr) {
      await sb.from('notifications').insert(baseRow);
    }

    // Check if employee has email notifications enabled (master email toggle)
    if (empSettings.notifications.emailNotifications && toEmail) {
      try {
        const { sendPayslipEmail } = await import('../lib/emailService.js');
        await sendPayslipEmail({
          toEmail,
          name: toName,
          organizationName: orgName || 'Finance OS',
          period: payslip.period,
          issueDate: payslip.issueDate,
          gross: payslip.gross,
          deductions: payslip.deductions,
          net: payslip.net,
          currency: cur,
          portalUrl: `${env.corsOrigin || 'http://localhost:5173'}/employee?tab=payslips`,
        });
      } catch (emailErr) {
        console.warn('[employee.payslipEmail] Non-fatal email dispatch warning:', emailErr);
      }
    }
  } catch (err) {
    console.warn('[employee.payslipNotification] Non-fatal error:', err);
  }
}

export function createEmployeeMeRouter(): Router {
  const r = Router({ mergeParams: true });

  function getOrgId(req: Request): string {
    const p = req.params.organizationId;
    return Array.isArray(p) ? p[0] : (p ?? '');
  }

  // Mount Employee AI Assistant (RAG & contextual guidance for employee dashboard)
  r.use('/ai-assistant', createEmployeeAIAssistantRouter());

  r.get('/expenses', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('employee_expenses')
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) return fail(res, 500, error.message);
    return ok(res, (data || []).map(mapDbExpenseToDomain));
  });

  r.post('/expenses', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as ExpenseCreateInput;
    const userId = callerId(req);

    const check = validateExpenseInput(body);
    if (!check.ok) return fail(res, 400, (check as { ok: false; error: string }).error);

    const currency = (body.currency?.trim() || 'USD').toUpperCase().slice(0, 8);
    const nowIso = new Date().toISOString();
    const submittedAt = body.status === 'submitted' ? (body.submittedAt?.trim() || nowIso) : null;
    const notes = body.notes?.trim() || null;
    const projectId = body.projectId?.trim() || null;
    const receiptUrl = body.receiptUrl?.trim() || null;

    const candidate = {
      date: body.date.trim(),
      description: body.description.trim(),
      amount: body.amount,
      currency,
      category: body.category.trim(),
      status: body.status,
    };

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const expId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const dbRow = {
      id: expId,
      organization_id: orgId,
      user_id: userId,
      date: candidate.date,
      description: candidate.description,
      amount: candidate.amount,
      currency: candidate.currency,
      category: candidate.category,
      status: candidate.status,
      submitted_at: submittedAt,
      notes,
      project_id: projectId,
      receipt_url: receiptUrl,
    };

    const { data, error } = await sb.from('employee_expenses').insert(dbRow).select().single();
    if (error) {
      console.error('[employee.createExpense] Supabase error:', error.message);
      return fail(res, 500, error.message);
    }

    const exp: EmployeeExpense = {
      id: data.id,
      organizationId: data.organization_id,
      userId: data.user_id,
      date: data.date,
      description: data.description,
      amount: Number(data.amount),
      currency: data.currency,
      category: data.category,
      status: data.status,
      submittedAt: data.submitted_at || undefined,
      notes: data.notes || undefined,
      projectId: data.project_id || undefined,
      receiptUrl: data.receipt_url || undefined,
    };
    created(res, exp, body.status === 'submitted' ? 'Expense submitted' : 'Expense created');
  });

  r.post('/expenses/:id/submit', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: exp, error: fetchErr } = await sb
      .from('employee_expenses')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!exp) return fail(res, 404, 'Expense not found');
    if (exp.organization_id !== orgId || exp.user_id !== userId) {
      return fail(res, 403, 'Forbidden');
    }
    if (exp.status === 'submitted') return ok(res, exp, 'Already submitted');
    if (exp.status !== 'draft' && exp.status !== 'rejected') {
      return fail(res, 400, 'Only draft or rejected expenses can be submitted for review');
    }

    const submittedAt = new Date().toISOString();
    const { data: updated, error: updateErr } = await sb
      .from('employee_expenses')
      .update({
        status: 'submitted',
        submitted_at: submittedAt,
        rejection_reason: null,
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateErr) return fail(res, 500, updateErr.message);
    ok(res, mapDbExpenseToDomain(updated), 'Expense submitted for review');
  });

  /**
   * PATCH /organizations/:organizationId/me/expenses/:id
   * Employee edits a draft or rejected expense claim before resubmission (§29 X-02).
   */
  r.patch('/expenses/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: exp, error: fetchErr } = await sb
      .from('employee_expenses')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!exp) return fail(res, 404, 'Expense not found');
    if (exp.organization_id !== orgId || exp.user_id !== userId) {
      return fail(res, 403, 'Forbidden');
    }
    if (exp.status !== 'draft' && exp.status !== 'rejected') {
      return fail(res, 400, 'Only draft or rejected expense claims can be modified');
    }

    const b = req.body || {};
    const patch: Record<string, any> = {};
    if (b.description !== undefined) patch.description = String(b.description).trim();
    if (b.amount !== undefined) {
      const amt = Number(b.amount);
      if (isNaN(amt) || amt <= 0) return fail(res, 400, 'Amount must be greater than 0');
      patch.amount = amt;
    }
    if (b.currency !== undefined) patch.currency = String(b.currency).trim().toUpperCase();
    if (b.category !== undefined) patch.category = String(b.category).trim();
    if (b.date !== undefined) patch.date = String(b.date).trim();
    if (b.projectId !== undefined) patch.project_id = b.projectId || null;
    if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes).trim() : null;
    if (b.receiptUrl !== undefined) patch.receipt_url = b.receiptUrl || null;

    const { data: updated, error: updateErr } = await sb
      .from('employee_expenses')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateErr) return fail(res, 500, updateErr.message);
    return ok(res, mapDbExpenseToDomain(updated), 'Expense claim updated');
  });

  /**
   * GET /organizations/:organizationId/me/expenses/admin/queue
   * Admin/Accountant queue to view all employee expense claims across the organization.
   */
  r.get('/expenses/admin/queue', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const callerRole = (req.orgMembership?.role as string) || 'employee';
    const isApprover = ['owner', 'admin', 'accountant', 'manager'].includes(callerRole) || canWriteFinance(req) || canViewConfidentialPayroll(req);
    if (!isApprover) {
      return fail(res, 403, 'Forbidden: Insufficient permissions to view review queue');
    }
    const statusFilter = (req.query.status as string) || 'all';
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      let query = sb
        .from('employee_expenses')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false });

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const [expensesRes, profilesRes, membersRes] = await Promise.all([
        query,
        sb.from('profiles').select('id, full_name, email'),
        sb.from('organization_members').select('user_id, department'),
      ]);

      if (expensesRes.error) return fail(res, 500, expensesRes.error.message);

      const profileMap = new Map<string, { name: string; email: string }>();
      (profilesRes.data || []).forEach((p: any) => {
        profileMap.set(p.id, { name: p.full_name || p.email?.split('@')[0] || 'Employee', email: p.email || '' });
      });

      const memberMap = new Map<string, string>();
      (membersRes.data || []).forEach((m: any) => {
        memberMap.set(m.user_id, m.department || 'General');
      });

      const enriched = (expensesRes.data || []).map((row: any) => {
        const domain = mapDbExpenseToDomain(row);
        const prof = profileMap.get(domain.userId) || { name: 'Employee', email: '' };
        return {
          ...domain,
          employeeName: prof.name,
          employeeEmail: prof.email,
          departmentName: memberMap.get(domain.userId) || 'General',
        };
      });

      return ok(res, enriched);
    } catch (err: any) {
      console.error('[expenses.admin.queue] Error:', err);
      return fail(res, 500, err?.message || 'Failed to fetch expense queue');
    }
  });

  /**
   * POST /organizations/:organizationId/me/expenses/:id/review
   * Organization Manager / Admin approves or rejects a submitted expense claim.
   */
  r.post('/expenses/:id/review', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const caller = callerId(req);
    const { action, reason } = req.body || {};

    if (action !== 'approve' && action !== 'reject') {
      return fail(res, 400, 'Action must be "approve" or "reject"');
    }

    if (action === 'reject' && (!reason || !String(reason).trim())) {
      return fail(res, 400, 'A non-empty rejection reason is required when rejecting an expense claim');
    }

    // Role verification: only Org Admin, Owner, Accountant, or Manager can review expenses
    const role = req.orgMembership?.role;
    const isApprover = role === 'owner' || role === 'admin' || role === 'accountant' || role === 'manager';
    if (!isApprover) {
      return fail(res, 403, 'Forbidden: Approver permission required to review expense claims');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: exp, error: fetchErr } = await sb
      .from('employee_expenses')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!exp) return fail(res, 404, 'Expense not found');

    // Self-approval guard (§33 Invariant #11): Non-owner cannot approve their own claim
    if (action === 'approve' && exp.user_id === caller && role !== 'owner') {
      return fail(res, 403, 'Self-approval of expense claims is strictly prohibited');
    }

    if (exp.status !== 'submitted') {
      return fail(res, 400, `Cannot review expense in '${exp.status}' status (must be 'submitted')`);
    }

    const nowIso = new Date().toISOString();
    const isApprove = action === 'approve';
    const newStatus = isApprove ? 'approved' : 'rejected';
    const trimmedReason = reason ? String(reason).trim() : null;
    const notesPatch = !isApprove && trimmedReason ? `REJECTED: ${trimmedReason}` : exp.notes;

    const patchPayload: Record<string, any> = {
      status: newStatus,
      reviewed_by: caller,
      reviewed_at: nowIso,
      rejection_reason: !isApprove ? trimmedReason : null,
      notes: notesPatch,
    };

    try {
      const { data: updated, error: updateErr } = await sb
        .from('employee_expenses')
        .update(patchPayload)
        .eq('id', req.params.id)
        .select()
        .single();

      if (updateErr) return fail(res, 500, updateErr.message);

      await emitEmployeeExpenseNotification(
        sb,
        orgId,
        updated,
        isApprove ? 'approved' : 'rejected',
        reason ? String(reason).trim() : undefined,
      );

      return ok(res, mapDbExpenseToDomain(updated), isApprove ? 'Expense claim approved' : 'Expense claim rejected');
    } catch (err: any) {
      console.error('[expenses.review] Error:', err);
      return fail(res, 500, err?.message || 'Failed to review expense');
    }
  });

  /**
   * POST /organizations/:organizationId/me/expenses/:id/settle
   * Mark approved expense claim as reimbursed and link settlement transaction (F-04 Invariant).
   */
  r.post('/expenses/:id/settle', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { settlementTransactionId } = req.body || {};

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: exp, error: fetchErr } = await sb
      .from('employee_expenses')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!exp) return fail(res, 404, 'Expense not found');
    if (exp.status !== 'approved') {
      return fail(res, 400, `Cannot settle expense in '${exp.status}' status (must be 'approved')`);
    }

    const patchPayload: Record<string, any> = {
      status: 'reimbursed',
    };

    try {
      const { data: updated, error: updateErr } = await sb
        .from('employee_expenses')
        .update(patchPayload)
        .eq('id', req.params.id)
        .select()
        .single();

      if (updateErr) return fail(res, 500, updateErr.message);

      if (settlementTransactionId) {
        const { data: txn } = await sb
          .from('transactions')
          .select('id, tags')
          .eq('id', settlementTransactionId)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (txn) {
          const currentTags = Array.isArray(txn.tags) ? txn.tags : [];
          const updatedTags = Array.from(new Set([...currentTags, `expense_settle:${exp.id}:${exp.user_id}:${exp.amount}`]));
          await sb.from('transactions').update({ tags: updatedTags }).eq('id', settlementTransactionId);
        }
      }

      await emitEmployeeExpenseNotification(sb, orgId, updated, 'reimbursed');

      return ok(res, mapDbExpenseToDomain(updated), 'Expense claim settled and marked reimbursed');
    } catch (err: any) {
      console.error('[expenses.settle] Error:', err);
      return fail(res, 500, err?.message || 'Failed to settle expense');
    }
  });

  r.get('/payslips', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const caller = callerId(req);
    const requestedUserId = req.query.userId ? String(req.query.userId) : caller;

    // Confidential payroll guard (§5, §33 #15): Viewing another user's payslips requires confidential payroll access
    if (requestedUserId !== caller && !canViewConfidentialPayroll(req)) {
      return fail(res, 403, 'Forbidden: Confidential payroll access required to view other employees\' payslips');
    }

    const userId = requestedUserId;
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('employee_payslips')
          .select('*')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .order('issue_date', { ascending: false });
        if (!error && data) {
          const mapped = data.map((p: any) => ({
            id: p.id,
            organizationId: p.organization_id,
            userId: p.user_id,
            period: p.period,
            issueDate: p.issue_date,
            gross: Number(p.gross || p.net || 0),
            deductions: Array.isArray(p.deductions) ? p.deductions : [],
            net: Number(p.net || 0),
            currency: p.currency || 'USD',
            status: p.status || 'paid',
          }));
          return ok(res, mapped);
        }
      } catch (err) {
        console.warn('[employee.payslips] Supabase query error:', err);
      }
    }
    ok(res, []);
  });

  r.get('/timesheets', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const requestedUserId = req.query.userId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const isAll = req.query.all === 'true';
    const targetUserId = requestedUserId || (isAll ? undefined : callerId(req));
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        let q = sb
          .from('timesheet_entries')
          .select('*')
          .eq('organization_id', orgId);

        if (targetUserId) {
          q = q.eq('user_id', targetUserId);
        }
        if (projectId) {
          q = q.eq('project_id', projectId);
        }

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
            startTime: row.start_time || undefined,
            endTime: row.end_time || undefined,
            durationMinutes: Number(row.duration_minutes || Math.round(Number(row.hours || 0) * 60)),
            effectiveCostPerMinute: Number(row.effective_cost_per_minute || 0),
            effectiveCostPerHour: Number(row.effective_cost_per_hour || 0),
            calculatedLaborCost: Number(row.calculated_labor_cost || 0),
            approvedAt: row.approved_at || undefined,
            approvedBy: row.approved_by || undefined,
            rejectionReason: row.rejection_reason || undefined,
            revisionHistory: Array.isArray(row.revision_history) ? row.revision_history : [],
          }));
          return ok(res, mapped);
        }
      } catch (err) {
        console.error('[employee.getTimesheets] Supabase query error:', err);
      }
    }
    ok(res, []);
  });

  r.post('/timesheets', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>;
    const userId = callerId(req);
    const entryId = (body as any).id || `ts_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newHours = Number(body.hours || 0);

    if (newHours <= 0 || isNaN(newHours)) {
      return fail(res, 400, 'Hours must be greater than 0');
    }

    const sb = getSupabaseAdminClient();
    let existingHours = 0;

    if (sb && body.projectId) {
      try {
        const { data: projectData, error: projErr } = await sb
          .from('projects')
          .select('id, name, status, organization_id, start_date, end_date')
          .eq('id', body.projectId)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (projErr) {
          console.warn('[employee.createTimesheet] Project check error:', projErr);
        } else if (!projectData) {
          return fail(res, 400, 'Project not found in this organization (§13).');
        } else if (projectData.status === 'cancelled') {
          return fail(res, 400, 'Time cannot be logged against a cancelled project (§13).');
        } else if (projectData.start_date && body.date < projectData.start_date) {
          return fail(res, 400, `Cannot log hours for ${projectData.name}: date (${body.date}) is before project start date (${projectData.start_date}).`);
        } else if (projectData.end_date && body.date > projectData.end_date) {
          return fail(res, 400, `Cannot log hours for ${projectData.name}: date (${body.date}) is after project end date (${projectData.end_date}).`);
        } else if (!body.projectName && projectData.name) {
          (body as any).projectName = projectData.name;
        }

        // Validate project assignment if configured for the employee (§13)
        const { data: memberData } = await sb
          .from('organization_members')
          .select('role, assigned_projects')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .maybeSingle();

        if (
          memberData &&
          memberData.role !== 'owner' &&
          memberData.role !== 'admin' &&
          Array.isArray(memberData.assigned_projects) &&
          memberData.assigned_projects.length > 0 &&
          !memberData.assigned_projects.includes(body.projectId)
        ) {
          return fail(res, 403, 'Employee is not assigned to this project (§13).');
        }
      } catch (err) {
        console.warn('[employee.createTimesheet] Membership validation error:', err);
      }
    }

    if (sb) {
      try {
        const { data: dayEntries } = await sb
          .from('timesheet_entries')
          .select('id, hours')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .eq('date', body.date);
        if (dayEntries && Array.isArray(dayEntries)) {
          existingHours = dayEntries
            .filter((row: any) => row.id !== entryId)
            .reduce((sum: number, row: any) => sum + Number(row.hours || 0), 0);
        }
      } catch (err) {
        console.warn('[employee.createTimesheet] Supabase check daily limit error:', err);
      }
    }

    if (existingHours + newHours > 8.0) {
      const remaining = Math.max(0, 8.0 - existingHours);
      return fail(
        res,
        400,
        `Daily limit of 8 hours exceeded. You have already logged ${existingHours.toFixed(1)}h on ${body.date} across projects. Maximum remaining is ${remaining.toFixed(1)}h.`
      );
    }

    const entry: TimesheetEntry = {
      ...body,
      id: entryId,
      organizationId: orgId,
      userId,
      projectName: body.projectName || '',
      hours: newHours,
      description: body.description || '',
      billable: body.billable ?? true,
      status: body.status || 'draft',
    };

    if (sb) {
      try {
        let effectiveCostPerHour = 50;
        try {
          const { data: memberCostData } = await sb
            .from('organization_members')
            .select('fixed_salary, hourly_rate, hours_per_day, working_days_per_month')
            .eq('organization_id', orgId)
            .eq('user_id', userId)
            .maybeSingle();

          const baseSalary = Number(memberCostData?.fixed_salary || 0);
          const hourlyRateVal = Number(memberCostData?.hourly_rate || 0);
          const hoursPerDay = Number(memberCostData?.hours_per_day || 8);
          const daysPerMonth = Number(memberCostData?.working_days_per_month || 20);
          const capacityHours = (hoursPerDay > 0 && daysPerMonth > 0) ? (hoursPerDay * daysPerMonth) : 160;

          effectiveCostPerHour = baseSalary > 0
            ? Math.round((baseSalary / capacityHours) * 100) / 100
            : (hourlyRateVal > 0 ? hourlyRateVal : 50);
        } catch (memCostErr) {
          console.warn('[employee.createTimesheet] Member cost lookup warning:', memCostErr);
        }

        const effectiveCostPerMinute = Math.round((effectiveCostPerHour / 60) * 10000) / 10000;
        const calculatedLaborCost = Math.round(newHours * effectiveCostPerHour * 100) / 100;

        (entry as any).effectiveCostPerHour = effectiveCostPerHour;
        (entry as any).effectiveCostPerMinute = effectiveCostPerMinute;
        (entry as any).calculatedLaborCost = calculatedLaborCost;

        const dbRow = {
          id: entry.id,
          organization_id: orgId,
          user_id: userId,
          date: entry.date,
          project_id: entry.projectId,
          project_name: entry.projectName,
          hours: entry.hours,
          description: entry.description,
          billable: entry.billable,
          status: entry.status,
          task_id: (entry as any).taskId || null,
          effective_cost_per_hour: effectiveCostPerHour,
          effective_cost_per_minute: effectiveCostPerMinute,
          calculated_labor_cost: calculatedLaborCost,
        };

        if ((entry as any).taskId) {
          try {
            const { data: tRow } = await sb.from('project_tasks').select('logged_hours, status').eq('id', (entry as any).taskId).maybeSingle();
            if (tRow) {
              const updatedLoggedHours = Number(tRow.logged_hours || 0) + Number(entry.hours || 0);
              const updatedStatus = tRow.status === 'todo' ? 'in_progress' : tRow.status;
              await sb.from('project_tasks').update({
                logged_hours: updatedLoggedHours,
                status: updatedStatus,
                updated_at: new Date().toISOString()
              }).eq('id', (entry as any).taskId);
            }
          } catch (taskErr) {
            console.warn('[employee.timesheet] project_task update skipped:', taskErr);
          }
        }
        const { error: upsertErr } = await sb.from('timesheet_entries').upsert(dbRow);
        if (upsertErr) {
          console.warn('[employee.createTimesheet] Supabase upsert error:', upsertErr.message);
        }
      } catch (err) {
        console.error('[employee.createTimesheet] Supabase error:', err);
      }
    }

    created(res, entry);
  });







  // ─────────────────────────────────────────────────────────────────────────────
  // Batch Create / Auto-Fill Week Timesheet Entries (§13 Work & Time)
  // ─────────────────────────────────────────────────────────────────────────────
  r.post('/timesheets/batch', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = (typeof req.query.userId === 'string' && req.query.userId.trim()) || callerId(req);
    const { entries } = req.body as { entries: Array<Omit<TimesheetEntry, 'id' | 'organizationId' | 'userId'>> };

    if (!Array.isArray(entries) || entries.length === 0) {
      return fail(res, 400, 'Entries array is required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    // Dynamic cost lookup for the authenticated employee (§12.1, §13)
    let effectiveCostPerHour = 50;
    try {
      const { data: memberCostData } = await sb
        .from('organization_members')
        .select('fixed_salary, hourly_rate, hours_per_day, working_days_per_month')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();

      const baseSalary = Number(memberCostData?.fixed_salary || 0);
      const hourlyRateVal = Number(memberCostData?.hourly_rate || 0);
      const hoursPerDay = Number(memberCostData?.hours_per_day || 8);
      const daysPerMonth = Number(memberCostData?.working_days_per_month || 20);
      const capacityHours = (hoursPerDay > 0 && daysPerMonth > 0) ? (hoursPerDay * daysPerMonth) : 160;

      effectiveCostPerHour = baseSalary > 0
        ? Math.round((baseSalary / capacityHours) * 100) / 100
        : (hourlyRateVal > 0 ? hourlyRateVal : 50);
    } catch (memCostErr) {
      console.warn('[employee.createTimesheetBatch] Member cost lookup warning:', memCostErr);
    }

    const effectiveCostPerMinute = Math.round((effectiveCostPerHour / 60) * 10000) / 10000;

    // Check existing hours for these dates to enforce daily 8h cap
    const dates = Array.from(new Set(entries.map(e => e.date)));
    const { data: existingDayEntries } = await sb
      .from('timesheet_entries')
      .select('id, date, hours')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .in('date', dates);

    const existingHoursMap = new Map<string, number>();
    (existingDayEntries || []).forEach((row: any) => {
      const d = String(row.date);
      existingHoursMap.set(d, (existingHoursMap.get(d) || 0) + Number(row.hours || 0));
    });

    const createdEntries: any[] = [];
    for (const item of entries) {
      const hrs = Number(item.hours || 0);
      if (hrs <= 0) continue;
      const currentDayTotal = existingHoursMap.get(item.date) || 0;
      if (currentDayTotal + hrs > 8.0) {
        continue; // Skip or cap at 8h
      }
      existingHoursMap.set(item.date, currentDayTotal + hrs);

      const entryId = (item as any).id || `ts_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const calculatedLaborCost = Math.round(hrs * effectiveCostPerHour * 100) / 100;

      const dbRow = {
        id: entryId,
        organization_id: orgId,
        user_id: userId,
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

      const { error: insertErr } = await sb.from('timesheet_entries').upsert(dbRow);
      if (!insertErr) {
        createdEntries.push(dbRow);
        if ((item as any).taskId) {
          try {
            const { data: tRow } = await sb.from('project_tasks').select('logged_hours, status').eq('id', (item as any).taskId).maybeSingle();
            if (tRow) {
              const updatedLogged = Number(tRow.logged_hours || 0) + hrs;
              const updatedStatus = tRow.status === 'todo' ? 'in_progress' : tRow.status;
              await sb.from('project_tasks').update({
                logged_hours: updatedLogged,
                status: updatedStatus,
                updated_at: new Date().toISOString()
              }).eq('id', (item as any).taskId);
            }
          } catch {
            /* ignore non-fatal */
          }
        }
      }
    }

    ok(res, createdEntries, `Successfully logged ${createdEntries.length} week entries`);
  });

  r.post('/timesheets/submit-week', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const { ids } = req.body as { ids: string[] };

    const sb = getSupabaseAdminClient();
    if (sb && ids && ids.length > 0) {
      try {
        const { data: entriesToSubmit } = await sb
          .from('timesheet_entries')
          .select('id, date, project_id')
          .in('id', ids)
          .eq('organization_id', orgId)
          .eq('user_id', userId);

        if (entriesToSubmit && entriesToSubmit.length > 0) {
          const projectIds = Array.from(new Set(entriesToSubmit.map((e: any) => e.project_id).filter(Boolean)));
          const { data: projs } = await sb
            .from('projects')
            .select('id, name, start_date, end_date')
            .in('id', projectIds)
            .eq('organization_id', orgId);

          const projMap = new Map((projs || []).map((p: any) => [p.id, p]));
          for (const e of entriesToSubmit) {
            const p = projMap.get(e.project_id);
            if (p) {
              if (p.start_date && e.date < p.start_date) {
                return fail(res, 400, `Cannot submit hours for ${p.name}: date (${e.date}) is before project start date (${p.start_date}).`);
              }
              if (p.end_date && e.date > p.end_date) {
                return fail(res, 400, `Cannot submit hours for ${p.name}: date (${e.date}) is after project end date (${p.end_date}).`);
              }
            }
          }
        }

        const { error } = await sb
          .from('timesheet_entries')
          .update({ status: 'submitted' })
          .in('id', ids)
          .eq('organization_id', orgId)
          .eq('user_id', userId);
        if (error) {
          console.warn('[employee.submitTimesheets] Supabase error:', error.message);
          return fail(res, 500, error.message);
        }
      } catch (err: any) {
        console.error('[employee.submitTimesheets] Supabase error:', err);
        return fail(res, 500, err?.message || 'Error submitting timesheets');
      }
    }

    ok(res, null, 'Timesheet submitted');
  });

  r.get('/employee-dashboard', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = (typeof req.query.userId === 'string' && req.query.userId.trim()) || callerId(req);
    const sb = getSupabaseAdminClient();

    let expenses: EmployeeExpense[] = [];
    let timesheets: TimesheetEntry[] = [];
    let userPayslips: any[] = [];
    let ann: any[] = [];
    let memberDepartment = 'Development';
    let memberPosition = 'Senior Developer';
    let fixedSalary = 0;
    let salaryCurrency: string | null = null;
    let memberAssignedProjects: string[] = [];
    let dbTasks: any[] = [];
    let dbProjNotifs: any[] = [];
    let orgCurrency = 'USD';

    if (sb) {
      try {
        const [
          { data: dbExp },
          { data: dbTs },
          { data: dbPs },
          { data: dbAnn },
          { data: om },
          { data: fetchedTasks },
          { data: fetchedNotifs },
          { data: orgRow },
        ] = await Promise.all([
          sb.from('employee_expenses').select('*').eq('organization_id', orgId).eq('user_id', userId),
          sb.from('timesheet_entries').select('*').eq('organization_id', orgId).eq('user_id', userId),
          sb.from('employee_payslips').select('*').eq('organization_id', orgId).eq('user_id', userId).order('issue_date', { ascending: false }),
          sb.from('company_announcements').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(4),
          sb.from('organization_members').select('department, role, position, fixed_salary, salary_currency, assigned_projects').eq('organization_id', orgId).eq('user_id', userId).maybeSingle(),
          sb.from('project_tasks').select('*').eq('organization_id', orgId),
          sb.from('notifications').select('*').eq('organization_id', orgId).or(`user_id.eq.${userId},user_id.is.null`).order('created_at', { ascending: false }).limit(8),
          sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
        ]);

        if (orgRow) {
          orgCurrency = String(orgRow.base_currency || orgRow.currency || 'USD').toUpperCase().trim();
        }

        if (fetchedTasks) {
          dbTasks = fetchedTasks;
        }
        if (fetchedNotifs) {
          dbProjNotifs = fetchedNotifs;
        }

        if (dbExp) {
          expenses = dbExp.map((row: any) => ({
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
        }

        if (dbTs) {
          timesheets = dbTs.map((row: any) => ({
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
            effectiveCostPerMinute: Number(row.effective_cost_per_minute || 0),
            effectiveCostPerHour: Number(row.effective_cost_per_hour || 0),
            calculatedLaborCost: Number(row.calculated_labor_cost || 0),
            approvedAt: row.approved_at || undefined,
            approvedBy: row.approved_by || undefined,
            rejectionReason: row.rejection_reason || undefined,
            revisionHistory: Array.isArray(row.revision_history) ? row.revision_history : [],
          }));
        }

        if (dbPs) {
          userPayslips = dbPs.map((p: any) => ({
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
        }

        if (dbAnn) {
          ann = dbAnn.map((a: any) => ({
            id: a.id,
            title: a.title,
            date: new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
            urgent: Boolean(a.is_pinned),
          }));
        }

        if (om) {
          if (om.department) memberDepartment = om.department;
          if (om.position) memberPosition = om.position;
          else if (om.role) memberPosition = om.role;
          if (om.fixed_salary) fixedSalary = Number(om.fixed_salary);
          if (om.salary_currency) salaryCurrency = String(om.salary_currency).toUpperCase();
          if (om.assigned_projects) {
            if (Array.isArray(om.assigned_projects)) memberAssignedProjects = om.assigned_projects;
            else if (typeof om.assigned_projects === 'string') {
              try {
                const parsed = JSON.parse(om.assigned_projects);
                memberAssignedProjects = Array.isArray(parsed) ? parsed : [om.assigned_projects];
              } catch {
                memberAssignedProjects = [om.assigned_projects];
              }
            }
          }
        }
      } catch (err) {
        console.warn('[employee.dashboard] Supabase queries error:', err);
      }
    }

    // Expenses pending reimbursement (submitted awaiting approval OR approved awaiting payment (§16, §33 Invariant 3))
    const pending = expenses.filter(e => e.status === 'draft' || e.status === 'submitted' || (e.status === 'approved' && !(e as any).settlementTransactionId));

    const mon = mondayOfWeek(new Date());
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weeklyHours = dayLabels.map((day, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      const ds = ymd(d);
      const hours = timesheets.filter(t => t.date === ds).reduce((s, t) => s + t.hours, 0);
      return { day, hours };
    });

    const thisWeekStart = ymd(mon);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    const thisWeekEnd = ymd(fri);
    const thisWeekHours = timesheets.filter(t => t.date >= thisWeekStart && t.date <= thisWeekEnd).reduce((s, t) => s + t.hours, 0);

    const latestPay = [...userPayslips].sort((a, b) => parseTs(b.issueDate) - parseTs(a.issueDate))[0];

    const activityRaw: { id: string; type: 'expense' | 'timesheet' | 'project' | 'payslip'; text: string; ts: number; status: string; amount?: number }[] = [];
    expenses.forEach(e => {
      activityRaw.push({
        id: `exp-${e.id}`, type: 'expense', text: e.description,
        ts: parseTs(e.submittedAt, e.date), status: e.status === 'submitted' ? 'pending' : e.status, amount: e.amount,
      });
    });
    timesheets.forEach(t => {
      activityRaw.push({ id: `ts-${t.id}`, type: 'timesheet', text: `Logged ${t.hours}h on ${t.projectName}`, ts: parseTs(undefined, t.date), status: t.status });
    });
    if (latestPay) {
      activityRaw.push({ id: `pay-${latestPay.id}`, type: 'payslip', text: `${latestPay.period} payslip available`, ts: parseTs(undefined, latestPay.issueDate), status: 'info' });
    }
    activityRaw.sort((a, b) => b.ts - a.ts);
    const recentActivity = activityRaw.slice(0, 8).map(a => ({
      id: a.id, type: a.type, text: a.text,
      time: a.ts ? new Date(a.ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '',
      status: a.status, amount: a.amount,
    }));

    const projectIdsWithTime = timesheets.map(t => t.projectId).filter(Boolean);
    const allAssignedProjects = new Set([...memberAssignedProjects, ...projectIdsWithTime]);

    // Tasks from Work Domain Authority (§13)
    const employeeDbTasks = (dbTasks || []).filter((t: any) => t.assigned_to === userId || (!t.assigned_to && allAssignedProjects.has(t.project_id)));
    let totalTasks = employeeDbTasks.length;
    let completedTasks = employeeDbTasks.filter((t: any) => t.status === 'completed').length;

    // Fallback to timesheet deliverables if no tasks seeded in project_tasks yet
    if (totalTasks === 0) {
      const uniqueTasks = Array.from(new Set(timesheets.map(t => t.description?.trim()).filter(Boolean)));
      totalTasks = uniqueTasks.length > 0 ? uniqueTasks.length : (allAssignedProjects.size > 0 ? allAssignedProjects.size : 0);
      completedTasks = timesheets.filter(t => t.status === 'approved' && t.description?.trim()).length > 0
        ? uniqueTasks.filter(task => timesheets.some(t => t.description?.trim() === task && t.status === 'approved')).length
        : 0;
    }

    // Salary: Latest payslip net, or fallback to contracted fixed salary (§12.1, §17, §18)
    const effectiveSalaryCurrency = salaryCurrency || orgCurrency;
    const fallbackSalary = fixedSalary > 0
      ? { gross: fixedSalary, net: fixedSalary, currency: effectiveSalaryCurrency }
      : { gross: 0, net: 0, currency: effectiveSalaryCurrency };
    const compensation = latestPay
      ? { gross: latestPay.gross, net: latestPay.net, currency: latestPay.currency }
      : fallbackSalary;

    ok(res, {
      hoursThisWeek: thisWeekHours,
      hoursTarget: 40,
      pendingExpenses: pending.length,
      pendingExpenseAmount: pending.reduce((s, e) => s + e.amount, 0),
      activeProjects: allAssignedProjects.size,
      salary: compensation,
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
      department: memberDepartment,
      position: memberPosition,
      lastPayPeriod: latestPay?.period ?? '',
    });
  });

  /**
   * GET /organizations/:organizationId/me/payroll/overview
   * Organization-wide AI Payroll & Salary Payslips Studio overview
   */
  r.get('/payroll/overview', async (req: Request, res: Response) => {
    if (!canViewConfidentialPayroll(req)) {
      return fail(res, 403, 'Forbidden: Confidential payroll access required');
    }

    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    let rawMembers: any[] = [];
    let rawProfiles: any[] = [];
    let rawDepts: any[] = [];
    let rawTxns: any[] = [];
    let rawPayslips: any[] = [];
    let rawTimesheets: any[] = [];

    if (sb) {
      try {
        const [
          { data: sbMembers },
          { data: sbDepts },
          { data: sbTxns },
          { data: sbPayslips },
          { data: sbTimesheets },
        ] = await Promise.all([
          sb.from('organization_members').select('*').eq('organization_id', orgId),
          sb.from('departments').select('*').eq('organization_id', orgId),
          sb.from('transactions').select('*').eq('organization_id', orgId).order('date', { ascending: false }),
          sb.from('employee_payslips').select('*').eq('organization_id', orgId).order('issue_date', { ascending: false }),
          sb.from('timesheet_entries').select('*').eq('organization_id', orgId),
        ]);

        rawMembers = sbMembers || [];
        rawDepts = sbDepts || [];
        rawTxns = sbTxns || [];
        rawPayslips = sbPayslips || [];
        rawTimesheets = sbTimesheets || [];

        const userIds = rawMembers.map(m => m.user_id).filter(Boolean);
        if (userIds.length > 0) {
          const { data: sbProfiles } = await sb.from('profiles').select('id, email, full_name').in('id', userIds);
          rawProfiles = sbProfiles || [];
        }
      } catch (err) {
        console.warn('[payroll.overview] Supabase fetch error:', err);
      }
    }



    const departments = rawDepts.map((d: any) => ({
      id: String(d.id),
      name: String(d.name),
      code: String(d.code || ''),
      budget: Number(d.budget || 0),
    }));

    const matchDeptId = (valRaw: string | undefined | null): string => {
      if (!valRaw) return departments[0]?.id || '';
      const val = String(valRaw).trim().toLowerCase();
      for (const d of departments) {
        const dId = d.id.toLowerCase();
        const dName = d.name.toLowerCase();
        const dCode = d.code.toLowerCase();
        if (
          val === dId ||
          val === dName ||
          (dCode && val === dCode) ||
          (val.length >= 3 && (dName.includes(val) || val.includes(dName)))
        ) {
          return d.id;
        }
      }
      return departments[0]?.id || '';
    };

    const profileMap = new Map<string, any>();
    for (const p of rawProfiles) {
      profileMap.set(String(p.id), p);
    }

    const nowPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    const members = rawMembers
      .filter((m: any) => {
        const st = String(m.status || 'active').toLowerCase();
        const role = String(m.role || 'employee').toLowerCase();
        const portal = String(m.portal_type || m.portalType || 'employee').toLowerCase();
        return st === 'active' && role !== 'owner' && role !== 'admin' && role !== 'org_admin' && portal !== 'organization';
      })
      .map((m: any) => {
        const uid = String(m.user_id || m.userId || m.id || '');
        const prof = profileMap.get(uid);
        const email = String(m.email || prof?.email || '');
        const rawName = String(m.name || prof?.full_name || '').trim();
        const isGenericPlaceholder = /^(employee|member|user|team\s*member)\s*\d*$/i.test(rawName);
        const name = (!rawName || isGenericPlaceholder) && email
          ? email.split('@')[0]
          : (rawName || 'Team Member');
        const deptId = matchDeptId(m.department_id || m.departmentId || m.department);
        const deptObj = departments.find(d => d.id === deptId);
        const userTs = rawTimesheets.filter((t: any) => String(t.user_id || t.userId) === uid);
        const monthHours = userTs
          .filter((t: any) => String(t.date || '').startsWith(nowPrefix))
          .reduce((s: number, t: any) => s + Number(t.hours || 0), 0);
        const totalHours = userTs.reduce((s: number, t: any) => s + Number(t.hours || 0), 0);

        return {
          userId: uid,
          name,
          email,
          role: String(m.role || 'employee'),
          position: String(m.position || m.role || 'Team Member'),
          departmentId: deptId,
          departmentName: deptObj?.name || String(m.department || 'General'),
          fixedSalary: Number(m.fixed_salary || m.fixedSalary || 0),
          loggedHoursMonth: Math.round((monthHours > 0 ? monthHours : totalHours) * 10) / 10,
          totalLoggedHours: Math.round(totalHours * 10) / 10,
        };
      });

    // Helper: Normalize period string for robust comparison (e.g. "March 2026", "march-2026" -> "march2026")
    const normalizePeriodKey = (p: string | null | undefined): string => {
      if (!p) return '';
      return String(p).toLowerCase().replace(/[^a-z0-9]/g, '');
    };

    // Helper: Extract human-readable period like "March 2026" from transaction text or date
    const extractPeriodFromTxn = (txn: any, fallbackPeriod: string): string => {
      const text = `${txn?.description || ''} ${txn?.narration || ''}`.toLowerCase();
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const monthShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      let foundMonth: string | null = null;
      for (let i = 0; i < 12; i++) {
        if (text.includes(months[i]) || new RegExp(`\\b${monthShort[i]}\\b`, 'i').test(text)) {
          foundMonth = months[i].charAt(0).toUpperCase() + months[i].slice(1);
          break;
        }
      }
      const yearMatch = text.match(/\b(202\d)\b/);
      let year = yearMatch ? yearMatch[1] : null;
      if (txn?.date) {
        const d = new Date(txn.date);
        if (!Number.isNaN(d.getTime())) {
          if (!foundMonth) {
            foundMonth = d.toLocaleDateString('en-US', { month: 'long' });
          }
          if (!year) {
            year = String(d.getFullYear());
          }
        }
      }
      if (foundMonth && year) {
        return `${foundMonth} ${year}`;
      }
      return fallbackPeriod;
    };

    // Map for fast employee lookup by userId
    const memberByUserId: Map<string, any> = new Map(members.map(m => [m.userId, m]));
    const STOP_NAMES = new Set(['employee', 'member', 'user', 'team', 'staff', 'admin', 'owner', 'client', 'vendor', 'payment', 'transfer', 'salary', 'payroll']);
    const doesTxnMatchMember = (text: string, m: { name: string; email: string }): boolean => {
      const clean = m.name.toLowerCase().trim();
      const tokens = clean.split(/\s+/).filter(tok => tok.length >= 3 && !STOP_NAMES.has(tok) && !/^\d+$/.test(tok));
      for (const tok of tokens) {
        if (new RegExp(`\\b${tok}\\b`, 'i').test(text)) return true;
      }
      const emailPrefix = (m.email.split('@')[0] || '').toLowerCase();
      if (emailPrefix.length >= 4 && !STOP_NAMES.has(emailPrefix) && text.includes(emailPrefix)) {
        return true;
      }
      return false;
    };

    // Map ledger transactions (both debit and credit) & parse existing payslip_alloc tags
    const sourceTxnByPayslipId = new Map<string, { txnId: string; description: string; date: string }>();
    const debitTransactions = rawTxns
      .filter((t: any) => {
        const tags = Array.isArray(t.tags) ? t.tags.map(String) : [];
        return !tags.includes('transfer');
      })
      .map((t: any) => {
        const txnType: 'debit' | 'credit' = t.type === 'credit' ? 'credit' : 'debit';
        const amount = Math.abs(Number(t.amount || 0));
        const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
        const allocTags = tags.filter(tag => tag.startsWith('payslip_alloc:'));

        const allocations = allocTags.map(aTag => {
          const parts = aTag.split(':');
          const psId = parts[1] || '';
          const uid = parts[2] || '';
          const dId = parts[3] || '';
          const gross = Number(parts[4] || 0);
          const rawPeriod = parts.slice(5).join(':') || '';
          let period = rawPeriod;
          if (rawPeriod) {
            const segs = rawPeriod.split('-');
            period = segs.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
          }
          if (psId) {
            sourceTxnByPayslipId.set(psId, {
              txnId: String(t.id),
              description: String(t.description || t.narration || ''),
              date: String(t.date || ''),
            });
          }
          const emp = memberByUserId.get(uid);
          return {
            payslipId: psId,
            userId: uid,
            employeeName: emp?.name || 'Employee',
            employeeEmail: emp?.email || '',
            departmentId: dId,
            departmentName: emp?.departmentName || '',
            gross,
            period,
          };
        });

        const allocatedAmount = Math.round(allocations.reduce((s, a) => s + a.gross, 0) * 100) / 100;
        const remainingAmount = Math.max(0, Math.round((amount - allocatedAmount) * 100) / 100);
        const text = `${t.description || ''} ${t.narration || ''} ${tags.join(' ')}`.toLowerCase();
        const catId = String(t.category_id || t.categoryId || '').toLowerCase();
        const isReimbursementOrSupplies = /\b(reimbursement|supplies|equipment|laptop|rent|electricity|travel)\b/i.test(text);
        const isSalaryKeyword = !isReimbursementOrSupplies && (
          /\b(salary|salaries|payroll|payslip|wages|stipend|compensation|lump\s*sum|monthly\s*pay)\b/i.test(text) ||
          catId.includes('cat-pay')
        );
        const matchesMemberName = !isReimbursementOrSupplies && members.some(m => doesTxnMatchMember(text, m));

        return {
          id: String(t.id),
          type: txnType,
          date: String(t.date || ''),
          description: String(t.description || t.narration || 'Transaction'),
          narration: String(t.narration || t.description || ''),
          amount,
          currency: String(t.currency || 'USD'),
          departmentId: String(t.department_id || t.departmentId || ''),
          allocatedAmount,
          remainingAmount,
          allocations,
          isPayrollCandidate: txnType === 'debit' && (isSalaryKeyword || matchesMemberName || allocatedAmount > 0),
          isPayrollCredit: txnType === 'credit' && isSalaryKeyword,
        };
      });

    // Build AI Suggestions for unallocated / partially-allocated debit transactions
    const defaultPeriod = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const aiSuggestions: Array<{
      id: string;
      type: 'single_match' | 'lump_sum_split';
      transactionId: string;
      transactionDescription: string;
      transactionDate: string;
      transactionAmount: number;
      remainingAmount: number;
      confidence: number;
      reasoning: string;
      period: string;
      suggestedAllocations: Array<{
        userId: string;
        employeeName: string;
        departmentId: string;
        departmentName: string;
        gross: number;
        net: number;
      }>;
    }> = [];

    for (const txn of debitTransactions) {
      if (txn.type !== 'debit' || !txn.isPayrollCandidate || txn.remainingAmount <= 0) continue;
      const text = `${txn.description} ${txn.narration}`.toLowerCase();

      const txnPeriod = extractPeriodFromTxn(txn, defaultPeriod);
      const normTxnPeriod = normalizePeriodKey(txnPeriod);

      // Check how much each employee has already been paid for this period (across payslips and this txn)
      const memberPaymentInfo = members.map(m => {
        let paidForPeriod = 0;
        for (const p of rawPayslips) {
          const pUid = String(p.user_id || p.userId || '');
          if (pUid === m.userId && normalizePeriodKey(p.period) === normTxnPeriod) {
            paidForPeriod += Number(p.gross || p.net || 0);
          }
        }
        const txnAlloc = (txn.allocations || []).find((a: any) => a.userId === m.userId && (normalizePeriodKey(a.period) === normTxnPeriod || !a.period));
        if (txnAlloc && paidForPeriod < txnAlloc.gross) {
          paidForPeriod = txnAlloc.gross;
        }

        const isAlreadyPaid = paidForPeriod > 0 && (
          m.fixedSalary > 0 ? paidForPeriod >= m.fixedSalary * 0.9 : true
        );
        const remainingDue = Math.max(0, (m.fixedSalary || 0) - paidForPeriod);

        return {
          member: m,
          paidForPeriod,
          isAlreadyPaid,
          remainingDue,
        };
      });

      const unpaidInfo = memberPaymentInfo.filter(info => !info.isAlreadyPaid);
      const alreadyPaidInfo = memberPaymentInfo.filter(info => info.isAlreadyPaid);

      // 1. Check for direct employee name / email prefix match (excluding generic words like 'employee')
      const matchedMembers = members.filter(m => doesTxnMatchMember(text, m));

      if (matchedMembers.length === 1) {
        const emp = matchedMembers[0];
        const isSalaryWord = ['salary', 'payroll', 'pay', 'wage', 'stipend', 'wire', 'transfer'].some(w => text.includes(w));
        const confidence = isSalaryWord ? 96 : 89;
        aiSuggestions.push({
          id: `ai-single-${txn.id}-${emp.userId}`,
          type: 'single_match',
          transactionId: txn.id,
          transactionDescription: txn.description,
          transactionDate: txn.date,
          transactionAmount: txn.amount,
          remainingAmount: txn.remainingAmount,
          confidence,
          reasoning: `AI matched employee name "${emp.name}" (${emp.departmentName}) in ledger narration "${txn.description}". Issuing this payslip attributes ${txn.remainingAmount.toLocaleString()} directly to ${emp.departmentName} hourly cost without duplicating the ledger entry.`,
          period: txnPeriod,
          suggestedAllocations: [
            {
              userId: emp.userId,
              employeeName: emp.name,
              departmentId: emp.departmentId,
              departmentName: emp.departmentName,
              gross: txn.remainingAmount,
              net: txn.remainingAmount,
            },
          ],
        });
        continue;
      }

      // 2. Check for single unpaid employee left for this period (e.g. Ali remaining for March 2026)
      if (unpaidInfo.length === 1) {
        const emp = unpaidInfo[0].member;
        const alreadyPaidNote = alreadyPaidInfo.length > 0
          ? ` (${alreadyPaidInfo.map(a => `${a.member.name} already paid $${a.paidForPeriod.toLocaleString()}`).join(', ')})`
          : '';
        aiSuggestions.push({
          id: `ai-single-rem-${txn.id}-${emp.userId}`,
          type: 'single_match',
          transactionId: txn.id,
          transactionDescription: txn.description,
          transactionDate: txn.date,
          transactionAmount: txn.amount,
          remainingAmount: txn.remainingAmount,
          confidence: 95,
          reasoning: `AI matched remaining ${txn.remainingAmount.toLocaleString()} to ${emp.name} (${emp.departmentName}) for ${txnPeriod}.${alreadyPaidNote} Issuing this payslip fully satisfies the ${txnPeriod} payroll outflow without double-paying already-settled staff.`,
          period: txnPeriod,
          suggestedAllocations: [
            {
              userId: emp.userId,
              employeeName: emp.name,
              departmentId: emp.departmentId,
              departmentName: emp.departmentName,
              gross: txn.remainingAmount,
              net: txn.remainingAmount,
            },
          ],
        });
        continue;
      }

      // 3. Check for exact Fixed Salary match
      const salaryMatchedMember = members.find(
        m => m.fixedSalary > 0 && Math.abs(m.fixedSalary - txn.remainingAmount) <= Math.max(50, m.fixedSalary * 0.05)
      );
      if (salaryMatchedMember) {
        aiSuggestions.push({
          id: `ai-sal-${txn.id}-${salaryMatchedMember.userId}`,
          type: 'single_match',
          transactionId: txn.id,
          transactionDescription: txn.description,
          transactionDate: txn.date,
          transactionAmount: txn.amount,
          remainingAmount: txn.remainingAmount,
          confidence: 88,
          reasoning: `Transaction amount (${txn.remainingAmount.toLocaleString()}) matches ${salaryMatchedMember.name}'s configured monthly salary (${salaryMatchedMember.fixedSalary.toLocaleString()}) in ${salaryMatchedMember.departmentName}.`,
          period: txnPeriod,
          suggestedAllocations: [
            {
              userId: salaryMatchedMember.userId,
              employeeName: salaryMatchedMember.name,
              departmentId: salaryMatchedMember.departmentId,
              departmentName: salaryMatchedMember.departmentName,
              gross: txn.remainingAmount,
              net: txn.remainingAmount,
            },
          ],
        });
        continue;
      }

      // 4. Lump-Sum Batch Split Suggestion (excluding already-paid staff for this period)
      if (members.length >= 1 && txn.isPayrollCandidate) {
        const activeSplitTargets = unpaidInfo.length > 0 ? unpaidInfo.map(u => u.member) : members;
        const totalFixed = activeSplitTargets.reduce((s, m) => s + (m.fixedSalary > 0 ? m.fixedSalary : 0), 0);
        const totalHours = activeSplitTargets.reduce((s, m) => s + (m.loggedHoursMonth > 0 ? m.loggedHoursMonth : 0), 0);

        let runningSum = 0;
        const splits = members.map((m) => {
          const isUnpaid = activeSplitTargets.some(t => t.userId === m.userId);
          if (!isUnpaid) {
            return {
              userId: m.userId,
              employeeName: m.name,
              departmentId: m.departmentId,
              departmentName: m.departmentName,
              gross: 0,
              net: 0,
            };
          }
          const targetIdx = activeSplitTargets.findIndex(t => t.userId === m.userId);
          let ratio = 1 / activeSplitTargets.length;
          if (totalFixed > 0) {
            ratio = (m.fixedSalary > 0 ? m.fixedSalary : totalFixed / activeSplitTargets.length) / totalFixed;
          } else if (totalHours > 0) {
            ratio = (m.loggedHoursMonth > 0 ? m.loggedHoursMonth : totalHours / activeSplitTargets.length) / totalHours;
          }
          const share =
            targetIdx === activeSplitTargets.length - 1
              ? Math.max(0, Math.round((txn.remainingAmount - runningSum) * 100) / 100)
              : Math.round(txn.remainingAmount * ratio * 100) / 100;
          runningSum += share;
          return {
            userId: m.userId,
            employeeName: m.name,
            departmentId: m.departmentId,
            departmentName: m.departmentName,
            gross: share,
            net: share,
          };
        });

        const basisText =
          totalFixed > 0
            ? 'configured employee salaries'
            : totalHours > 0
              ? 'logged monthly timesheet hours'
              : 'active team headcount';

        aiSuggestions.push({
          id: `ai-lump-${txn.id}`,
          type: 'lump_sum_split',
          transactionId: txn.id,
          transactionDescription: txn.description,
          transactionDate: txn.date,
          transactionAmount: txn.amount,
          remainingAmount: txn.remainingAmount,
          confidence: ['salary', 'payroll', 'lump', 'batch', 'team'].some(w => text.includes(w)) ? 94 : 82,
          reasoning: `AI detected a lump-sum outflow of ${txn.remainingAmount.toLocaleString()} ("${txn.description}"). Recommended splitting across ${activeSplitTargets.length} unpaid team member(s) for ${txnPeriod}${alreadyPaidInfo.length > 0 ? ` (${alreadyPaidInfo.map(a => `${a.member.name} already paid $${a.paidForPeriod.toLocaleString()}`).join(', ')})` : ''} weighted by ${basisText} so each department's Cost / Hour reflects actual payroll without double-counting in the ledger.`,
          period: txnPeriod,
          suggestedAllocations: splits,
        });
      }
    }

    // Merge and enrich all issued payslips
    // (memberByUserId was initialized above)
    const payslipsMap = new Map<string, any>();

    for (const p of rawPayslips) {
      const id = String(p.id);
      const uid = String(p.user_id || p.userId || '');
      const emp = memberByUserId.get(uid);
      const src = sourceTxnByPayslipId.get(id);
      payslipsMap.set(id, {
        id,
        organizationId: orgId,
        userId: uid,
        employeeName: emp?.name || 'Employee',
        employeeEmail: emp?.email || '',
        departmentId: emp?.departmentId || '',
        departmentName: emp?.departmentName || 'General',
        period: String(p.period || ''),
        issueDate: String(p.issue_date || p.issueDate || ''),
        gross: Number(p.gross || p.net || 0),
        deductions: Array.isArray(p.deductions) ? p.deductions : [],
        net: Number(p.net || 0),
        currency: String(p.currency || 'USD'),
        status: String(p.status || 'paid'),
        sourceTransactionId: src?.txnId || null,
        sourceTransactionDescription: src?.description || null,
      });
    }

    const payslips = Array.from(payslipsMap.values()).sort(
      (a, b) => parseTs(b.issueDate) - parseTs(a.issueDate)
    );

    ok(res, {
      members,
      departments,
      debitTransactions,
      payslips,
      aiSuggestions,
    });
  });

  /**
   * POST /organizations/:organizationId/me/payslips/issue
   * Issue single or lump-sum split payslips and tag source ledger transaction (Zero Double-Counting)
   */
  r.post('/payslips/issue', async (req: Request, res: Response) => {
    if (!canViewConfidentialPayroll(req)) {
      return fail(res, 403, 'Forbidden: Confidential payroll access required');
    }

    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    const {
      sourceTransactionId,
      period,
      issueDate,
      allocations,
    } = req.body as {
      sourceTransactionId?: string;
      period: string;
      issueDate?: string;
      allocations: Array<{
        userId: string;
        employeeName?: string;
        departmentId?: string;
        gross: number;
        deductions?: Array<{ label: string; amount: number }>;
        currency?: string;
      }>;
    };

    if (!period || !period.trim()) {
      return fail(res, 400, 'Pay period is required (e.g. October 2026)');
    }
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return fail(res, 400, 'At least one employee allocation is required');
    }

    const cleanAllocations = allocations.filter(a => a && a.userId && Number(a.gross) > 0);
    if (cleanAllocations.length === 0) {
      return fail(res, 400, 'Valid employee allocations with gross amount > 0 are required');
    }

    const periodClean = period.trim();
    const periodSlug = periodClean.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const effIssueDate = issueDate && /^\d{4}-\d{2}-\d{2}$/.test(issueDate)
      ? issueDate
      : ymd(new Date());

    // 1. If linked to a source ledger transaction, verify balance so it never exceeds txn amount
    let sourceTxn: any = null;
    if (sourceTransactionId) {
      if (sb) {
        const { data } = await sb
          .from('transactions')
          .select('*')
          .eq('id', sourceTransactionId)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (data) sourceTxn = data;
      }
      if (!sourceTxn) {

      }
      if (!sourceTxn) {
        return fail(res, 404, 'Source ledger transaction not found');
      }

      const txnAmount = Math.abs(Number(sourceTxn.amount || 0));
      const existingTags: string[] = Array.isArray(sourceTxn.tags) ? sourceTxn.tags.map(String) : [];
      const updatingUserIds = new Set(cleanAllocations.map(a => a.userId));

      // Sum existing allocations EXCEPT any for the same (userId, periodSlug) being updated
      let retainedAllocated = 0;
      for (const tag of existingTags) {
        if (!tag.startsWith('payslip_alloc:')) continue;
        const parts = tag.split(':');
        const tagUid = parts[2] || '';
        const tagGross = Number(parts[4] || 0);
        const tagPeriod = parts.slice(5).join(':') || '';
        if (updatingUserIds.has(tagUid) && tagPeriod === periodSlug) {
          continue; // Will be replaced by new allocation
        }
        retainedAllocated += tagGross;
      }

      const newAllocSum = cleanAllocations.reduce((s, a) => s + Number(a.gross || 0), 0);
      if (retainedAllocated + newAllocSum > txnAmount + 0.01) {
        return fail(
          res,
          400,
          `Total split allocations (${(retainedAllocated + newAllocSum).toLocaleString()}) cannot exceed the ledger transaction amount (${txnAmount.toLocaleString()}).`
        );
      }
    }

    // 2. Create/upsert payslips in Supabase public.employee_payslips (and in-memory store)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const issuedPayslips: any[] = [];
    const newAllocTags: string[] = [];

    for (const alloc of cleanAllocations) {
      const gross = Math.round(Number(alloc.gross) * 100) / 100;
      // Keep deductions strictly as Array<{ label, amount }> (Flaw #5 safeguard)
      const pureDeductions = Array.isArray(alloc.deductions)
        ? alloc.deductions
          .filter((d: any) => d && (typeof d.label === 'string' || typeof d.name === 'string') && Number(d.amount) > 0)
          .map((d: any) => {
            const lbl = String(d.name || d.label || 'Deduction').trim();
            const amt = Math.round(Number(d.amount) * 100) / 100;
            return { name: lbl, label: lbl, amount: amt };
          })
        : [];
      const totalDed = pureDeductions.reduce((s, d) => s + d.amount, 0);
      const net = Math.max(0, Math.round((gross - totalDed) * 100) / 100);
      const currency = alloc.currency || sourceTxn?.currency || 'USD';
      const payslipId = `ps-${sourceTransactionId || 'manual'}-${alloc.userId}-${periodSlug}`;

      const payslipObj = {
        id: payslipId,
        organizationId: orgId,
        userId: alloc.userId,
        period: periodClean,
        issueDate: effIssueDate,
        gross,
        deductions: pureDeductions,
        net,
        currency,
        status: 'paid' as const,
      };

      // Upsert into Supabase if userId is a valid UUID (Flaw #6 safeguard)
      if (sb && uuidRegex.test(alloc.userId)) {
        try {
          const { error: psErr } = await sb.from('employee_payslips').upsert({
            id: payslipId,
            organization_id: orgId,
            user_id: alloc.userId,
            period: periodClean,
            issue_date: effIssueDate,
            gross,
            deductions: pureDeductions,
            net,
            currency,
            status: 'paid',
          });
          if (psErr) {
            console.warn('[payslips.issue] Supabase employee_payslips upsert warning:', psErr.message);
          }
        } catch (err) {
          console.warn('[payslips.issue] Supabase upsert error:', err);
        }
      }



      issuedPayslips.push(payslipObj);

      // Dispatch in-app notification & automated email to employee
      void emitEmployeePayslipIssuedNotification(
        sb,
        orgId,
        {
          id: payslipId,
          userId: alloc.userId,
          period: periodClean,
          issueDate: effIssueDate,
          gross,
          deductions: pureDeductions,
          net,
          currency,
          employeeName: alloc.employeeName,
        },
        (req as any).authOrg?.name,
      );

      if (sourceTransactionId) {
        const safeDept = (alloc.departmentId || 'dept').replace(/:/g, '-');
        newAllocTags.push(`payslip_alloc:${payslipId}:${alloc.userId}:${safeDept}:${gross}:${periodSlug}`);
      }
    }

    // 3. Tag source transaction in Supabase & store without creating a duplicate ledger row
    if (sourceTransactionId && sourceTxn) {
      const existingTags: string[] = Array.isArray(sourceTxn.tags) ? sourceTxn.tags.map(String) : [];
      const updatingUserIds = new Set(cleanAllocations.map(a => a.userId));

      const filteredTags = existingTags.filter(tag => {
        if (!tag.startsWith('payslip_alloc:')) return true;
        const parts = tag.split(':');
        const tagUid = parts[2] || '';
        const tagPeriod = parts.slice(5).join(':') || '';
        return !(updatingUserIds.has(tagUid) && tagPeriod === periodSlug);
      });

      const updatedTags = [...filteredTags, ...newAllocTags];

      if (sb) {
        try {
          await sb
            .from('transactions')
            .update({ tags: updatedTags })
            .eq('id', sourceTransactionId)
            .eq('organization_id', orgId);
        } catch (err) {
          console.warn('[payslips.issue] Failed to update transaction tags in Supabase:', err);
        }
      }
    }
    created(res, { issuedPayslips }, `Successfully issued ${issuedPayslips.length} payslip(s)`);
  });

  /**
   * POST /organizations/:organizationId/me/payroll/auto-detect
   * Scan unallocated statement transactions and automatically detect/issue payslips.
   */
  r.post('/payroll/auto-detect', async (req: Request, res: Response) => {
    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb || !orgId) {
      return fail(res, 500, 'Supabase client or organization ID unavailable');
    }

    try {
      const { data: txns, error: txnErr } = await sb
        .from('transactions')
        .select('*')
        .eq('organization_id', orgId)
        .eq('type', 'debit')
        .eq('is_transfer', false)
        .order('date', { ascending: false })
        .limit(200);

      if (txnErr) {
        return fail(res, 500, txnErr.message);
      }

      const result = await detectAndIssuePayslipsForTransactions(sb, orgId, txns || []);
      ok(res, result, `Auto-detection completed. Issued ${result.autoIssuedCount} payslip(s).`);
    } catch (err: any) {
      console.error('[payroll.auto-detect] Error:', err);
      fail(res, 500, err?.message || 'Auto-detection failed');
    }
  });

  /**
   * POST /organizations/:organizationId/me/payslips/void
   * Safely void/cancel an issued payslip and clean up source transaction allocation tags.
   */
  r.post('/payslips/void', async (req: Request, res: Response) => {
    if (!canViewConfidentialPayroll(req)) {
      return fail(res, 403, 'Forbidden: Confidential payroll access required');
    }

    const orgId = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : (req.params.organizationId ?? '');
    const { payslipId } = req.body || {};
    if (!payslipId) {
      return fail(res, 400, 'payslipId is required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb || !orgId) {
      return fail(res, 500, 'Supabase client or organization ID unavailable');
    }

    try {
      const voidRes = await voidPayslip(sb, orgId, payslipId);
      if (!voidRes.success) {
        return fail(res, 400, voidRes.message);
      }
      ok(res, voidRes, voidRes.message);
    } catch (err: any) {
      console.error('[payslips.void] Error:', err);
      fail(res, 500, err?.message || 'Failed to void payslip');
    }
  });


  // ─────────────────────────────────────────────────────────────────────────────
  // Employee Assigned Tasks across all projects (§13 Employee Finance & Work)
  // ─────────────────────────────────────────────────────────────────────────────
  r.get('/tasks', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const [
          { data: tasks, error: tErr },
          { data: projects, error: pErr },
        ] = await Promise.all([
          sb.from('project_tasks').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
          sb.from('projects').select('id, name, client_name').eq('organization_id', orgId),
        ]);

        if (!tErr && tasks) {
          const projMap = new Map((projects || []).map((p: any) => [p.id, p]));
          // Filter to tasks assigned to this user OR unassigned on user's projects
          const filtered = tasks.filter((t: any) => !t.assigned_to || t.assigned_to === userId);
          const mapped = filtered.map((t: any) => ({
            id: String(t.id),
            organizationId: String(t.organization_id),
            projectId: String(t.project_id),
            projectName: projMap.get(t.project_id)?.name || '',
            title: String(t.title ?? ''),
            description: String(t.description ?? ''),
            assignedTo: t.assigned_to ? String(t.assigned_to) : undefined,
            assignedToName: t.assigned_to_name ? String(t.assigned_to_name) : undefined,
            status: t.status || 'todo',
            priority: t.priority || 'medium',
            estimatedHours: Number(t.estimated_hours ?? 0),
            loggedHours: Number(t.logged_hours ?? 0),
            startDate: t.start_date || undefined,
            dueDate: t.due_date || undefined,
            createdAt: t.created_at || undefined,
            updatedAt: t.updated_at || undefined,
          }));
          return ok(res, mapped);
        }
      } catch (err) {
        console.warn('[employee.tasks.get] Supabase query error:', err);
      }
    }

    return ok(res, []);
  });

  r.patch('/tasks/:taskId/status', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const taskId = req.params.taskId;
    const { status } = req.body as { status: 'todo' | 'in_progress' | 'completed' };

    if (!['todo', 'in_progress', 'completed'].includes(status)) {
      return fail(res, 400, 'Invalid status. Must be todo, in_progress, or completed');
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('project_tasks')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', taskId)
          .eq('organization_id', orgId)
          .select()
          .maybeSingle();

        if (error) return fail(res, 500, error.message);
        if (!data) return notFound(res, 'Task');
        return ok(res, data);
      } catch (err: any) {
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return ok(res, { id: taskId, status });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Employee Self-Service Settings ("My Settings") & Support (§18, §20, §29)
  // ─────────────────────────────────────────────────────────────────────────────

  r.get('/settings', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const sb = getSupabaseAdminClient();

    try {
      const settings = await resolveEmployeeUserSettings(
        sb,
        orgId,
        userId,
        req.authUser?.email,
        req.authUser?.name,
      );
      return ok(res, settings);
    } catch (err: any) {
      console.error('[employee.settings.get] Error:', err);
      return fail(res, 500, err?.message || 'Failed to load employee settings');
    }
  });

  const handleUpdateSettings = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const beforeSettings = await resolveEmployeeUserSettings(
        sb,
        orgId,
        userId,
        req.authUser?.email,
        req.authUser?.name,
      );

      const body = (req.body || {}) as {
        profile?: Partial<EmployeeUserSettings['profile']>;
        notifications?: Partial<EmployeeNotificationPreferences>;
        security?: Partial<EmployeeSecuritySettings>;
      };

      const nextFullName =
        body.profile?.fullName !== undefined
          ? String(body.profile.fullName).trim()
          : beforeSettings.profile.fullName;

      if (!nextFullName || nextFullName.length < 2) {
        return fail(res, 400, 'Full Name must be at least 2 characters');
      }
      if (nextFullName.length > 120) {
        return fail(res, 400, 'Full Name cannot exceed 120 characters');
      }

      const nextPhone =
        body.profile?.phone !== undefined
          ? String(body.profile.phone).trim()
          : beforeSettings.profile.phone;

      if (nextPhone && !/^[+\d\s\-().]{5,30}$/.test(nextPhone)) {
        return fail(
          res,
          400,
          'Please enter a valid phone number (e.g. +1 555-0105)',
        );
      }

      // Governance rule (§5 / §18): Department & Email are authoritative and read-only for employees
      const nextNotifications = normalizeNotifications({
        ...beforeSettings.notifications,
        ...(body.notifications || {}),
      });

      if (
        body.security?.sessionTimeout !== undefined &&
        !VALID_SESSION_TIMEOUTS.includes(body.security.sessionTimeout as EmployeeSessionTimeout)
      ) {
        return fail(
          res,
          400,
          `Invalid session timeout. Allowed values: ${VALID_SESSION_TIMEOUTS.join(', ')}`,
        );
      }

      const nextSecurity = normalizeSecurity({
        ...beforeSettings.security,
        ...(body.security || {}),
      });

      const nowIso = new Date().toISOString();
      const settingsBlob = {
        profile: {
          fullName: nextFullName,
          phone: nextPhone,
        },
        notifications: nextNotifications,
        security: nextSecurity,
        updatedAt: nowIso,
      };

      // 1. Update public.profiles (with resilient fallback if migration 0027 columns are missing)
      const { error: profFullErr } = await sb
        .from('profiles')
        .update({
          full_name: nextFullName,
          phone: nextPhone,
          employee_settings: settingsBlob,
          updated_at: nowIso,
        })
        .eq('id', userId);

      if (profFullErr) {
        await sb
          .from('profiles')
          .update({
            full_name: nextFullName,
            updated_at: nowIso,
          })
          .eq('id', userId);
      }

      // 2. Update public.organization_members (phone + employee_settings)
      const { error: memUpdateErr } = await sb
        .from('organization_members')
        .update({
          phone: nextPhone,
          employee_settings: settingsBlob,
        })
        .eq('organization_id', orgId)
        .eq('user_id', userId);

      if (memUpdateErr) {
        // Fallback if phone/employee_settings column not yet migrated on organization_members
        console.warn('[employee.settings.patch] organization_members extended columns fallback:', memUpdateErr.message);
      }

      // 3. Sync public.employee_team_members (for Team Directory name & phone visibility)
      const emailLower = beforeSettings.profile.email.toLowerCase().trim();
      const { data: teamRows } = await sb
        .from('employee_team_members')
        .select('id, email, user_id')
        .eq('organization_id', orgId);

      const matchingTeamIds = (teamRows || [])
        .filter(
          (r: any) =>
            (r.user_id && String(r.user_id) === userId) ||
            (emailLower && String(r.email || '').toLowerCase().trim() === emailLower),
        )
        .map((r: any) => r.id);

      if (matchingTeamIds.length > 0) {
        const { error: teamFullErr } = await sb
          .from('employee_team_members')
          .update({
            name: nextFullName,
            phone: nextPhone,
            user_id: userId,
          })
          .in('id', matchingTeamIds);

        if (teamFullErr) {
          await sb
            .from('employee_team_members')
            .update({ name: nextFullName })
            .in('id', matchingTeamIds);
        }
      }

      // 4. Sync Supabase Auth user_metadata so JWT / session and fallback storage stay 100% consistent
      try {
        const { data: authData } = await sb.auth.admin.getUserById(userId);
        const existingMeta = authData?.user?.user_metadata || {};
        await sb.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...existingMeta,
            full_name: nextFullName,
            name: nextFullName,
            phone: nextPhone,
            employee_settings: settingsBlob,
          },
        });
      } catch (authErr) {
        console.warn('[employee.settings.patch] auth.admin.updateUserById non-fatal warning:', authErr);
      }

      const afterSettings: EmployeeUserSettings = {
        userId,
        organizationId: orgId,
        profile: {
          ...beforeSettings.profile,
          fullName: nextFullName,
          phone: nextPhone,
        },
        notifications: nextNotifications,
        security: nextSecurity,
        updatedAt: nowIso,
      };

      // 5. Write immutable audit event (§7, §16, §20)
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'employee_settings.updated',
        entityType: 'employee_settings',
        entityId: userId,
        description: `Employee ${beforeSettings.profile.fullName} updated personal settings`,
        beforeState: {
          profile: beforeSettings.profile as any,
          notifications: beforeSettings.notifications as any,
          security: beforeSettings.security as any,
        },
        afterState: {
          profile: afterSettings.profile as any,
          notifications: afterSettings.notifications as any,
          security: afterSettings.security as any,
        },
      });

      return ok(res, afterSettings, 'Settings updated successfully');
    } catch (err: any) {
      console.error('[employee.settings.patch] Error:', err);
      return fail(res, 500, err?.message || 'Failed to update employee settings');
    }
  };

  r.patch('/settings', handleUpdateSettings);
  r.put('/settings', handleUpdateSettings);

  /**
   * POST /organizations/:organizationId/me/support-request
   * Submits an employee help/support ticket to the Organization Admin notification feed.
   */
  r.post('/support-request', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);
    const { subject, message, category } = (req.body || {}) as {
      subject?: string;
      message?: string;
      category?: string;
    };

    const cleanSubject = String(subject || '').trim();
    const cleanMessage = String(message || '').trim();
    if (!cleanSubject || !cleanMessage) {
      return fail(res, 400, 'Subject and message are required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const empSettings = await resolveEmployeeUserSettings(
        sb,
        orgId,
        userId,
        req.authUser?.email,
        req.authUser?.name,
      );

      await sb.from('notifications').insert({
        organization_id: orgId,
        portal: 'organization',
        title: `Employee Support Request: ${cleanSubject}`,
        message: `From ${empSettings.profile.fullName} (${empSettings.profile.department}${empSettings.profile.email ? ` • ${empSettings.profile.email}` : ''}): ${cleanMessage}`,
        type: 'info',
        category: category || 'general',
        is_read: false,
        action_tab: 'team',
      });

      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'employee_support.requested',
        entityType: 'support_request',
        entityId: userId,
        description: `Employee support requested: ${cleanSubject}`,
        afterState: { subject: cleanSubject, category: category || 'general', message: cleanMessage },
      });

      return created(
        res,
        { submittedAt: new Date().toISOString() },
        'Support request sent to your organization administrator',
      );
    } catch (err: any) {
      console.error('[employee.supportRequest] Error:', err);
      return fail(res, 500, err?.message || 'Failed to submit support request');
    }
  });

  return r;
}
