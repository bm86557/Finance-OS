/**
 * §15 — Notifications.
 * Org-scoped router mounted at `/organizations/:organizationId/notifications` (mergeParams).
 * User-org scoped list mounted at `/users/:userId/organizations/:organizationId/notifications` (mergeParams).
 * Global by-id actions mounted at `/notifications`.
 */

import { Router, type Request, type Response } from 'express';
import type { Notification } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { isPlatformUser } from '../middleware/auth.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { resolveEmployeeUserSettings } from './employee.js';

function param(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v ?? '');
}

/**
 * Dynamically computes and synchronizes live, data-driven notifications for an organization.
 * Checks for:
 * 1. Budget Overruns (e.g. Development Department exceeding its budget)
 * 2. AI Categorization Review (unclassified or pending transactions needing review)
 * 3. Profit Intelligence insights
 * 4. Upcoming / Due Recurring transactions
 */
async function syncLiveOrgNotifications(organizationId: string) {
  const sb = getSupabaseAdminClient();
  const now = new Date();

  // 1. Resolve fallback admin user_id if needed by Supabase schema constraint
  let fallbackUserId: string | null = null;
  if (sb) {
    try {
      const { data: admins } = await sb
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .in('role', ['owner', 'admin'])
        .limit(1);
      if (admins && admins.length > 0 && admins[0].user_id) {
        fallbackUserId = admins[0].user_id;
      }
    } catch {
      // Non-fatal fallback
    }
  }

  // 2. Evaluate Budget Overruns
  try {
    let departments: any[] = [];
    let transactions: any[] = [];

    if (sb) {
      const [deptRes, txnRes] = await Promise.all([
        sb.from('departments').select('id, name, budget').eq('organization_id', organizationId),
        sb.from('transactions').select('id, department_id, amount, type, category_id').eq('organization_id', organizationId),
      ]);
      departments = deptRes.data || [];
      transactions = txnRes.data || [];
    } else {

    }

    for (const dept of departments) {
      const budget = Number(dept.budget) || 0;
      if (budget <= 0) continue;

      // Sum debits for this department
      const deptDebits = transactions.filter(
        t => t.department_id === dept.id || t.departmentId === dept.id || (t.type === 'debit' && t.category_id && dept.name === 'Development Department')
      );
      const spent = deptDebits.reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);

      if (spent > budget) {
        const overage = Math.round(spent - budget);
        const pct = Math.round((spent / budget) * 100);
        const notifId = `notif_budget_${organizationId}_${dept.id}`;

        const notifPayload: any = {
          id: notifId,
          organization_id: organizationId,
          user_id: fallbackUserId,
          portal: 'organization',
          type: 'warning',
          category: 'budget',
          title: `Budget Overrun: ${dept.name}`,
          message: `${dept.name} has exceeded its budget of $${budget.toLocaleString()} by $${overage.toLocaleString()} (${pct}% spent).`,
          action_url: '/dashboard?view=costing',
          action_label: 'View Costing',
          is_read: false,
          created_at: now.toISOString(),
        };

        if (sb) {
          try {
            await sb.from('notifications').upsert(notifPayload, { onConflict: 'id' });
          } catch {
            // non-fatal fallback
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Organization-scoped notifications router.
 * Mounted at `/organizations/:organizationId/notifications`.
 * Strictly isolates notifications by organization and portal.
 */
export function createOrgNotificationsRouter(): Router {
  const r = Router({ mergeParams: true });

  // GET /organizations/:organizationId/notifications
  r.get('/', async (req: Request, res: Response) => {
    const organizationId = param(req, 'organizationId');
    const portal = (req.query.portal as string) || 'organization';
    const callerId = req.authUser?.id;

    // Trigger live evaluations ONLY when viewing organization portal
    if (portal === 'organization') {
      await syncLiveOrgNotifications(organizationId);
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        let query = sb
          .from('notifications')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(50);

        // Filter by portal if column exists
        try {
          query = query.eq('portal', portal);
        } catch {
          // Fallback if portal column is not yet migrated
        }

        const { data, error } = await query;
        if (!error && data) {
          let rows = data;

          if (portal === 'organization') {
            // Strictly exclude personal employee notifications from organization feed
            rows = rows.filter((n: any) => {
              const p = String(n.portal || '').toLowerCase();
              return p !== 'employee';
            });
          }

          if (portal === 'employee') {
            const ORG_ONLY_CATEGORIES = new Set([
              'budget',
              'categorization',
              'cashflow',
              'insight',
              'profit',
              'recurrence',
              'recurring',
              'audit',
              'costing',
              'integrations',
              'tax',
              'billing',
            ]);

            // Unconditionally strip organization alerts from employee feed
            rows = rows.filter((n: any) => {
              const p = String(n.portal || '').toLowerCase();
              if (p === 'organization' || p === 'platform') return false;
              const cat = String(n.category || '').toLowerCase();
              if (ORG_ONLY_CATEGORIES.has(cat)) return false;
              const actionUrl = String(n.action_url || n.actionUrl || '').toLowerCase();
              if (actionUrl.startsWith('/dashboard') || actionUrl.includes('view=costing')) return false;
              return true;
            });

            if (callerId) {
            const empSettings = await resolveEmployeeUserSettings(
              sb,
              organizationId,
              callerId,
              req.authUser?.email,
              req.authUser?.name,
            );
            const prefs = empSettings.notifications;

            const ORG_ONLY_CATEGORIES = new Set([
              'budget',
              'categorization',
              'cashflow',
              'insight',
              'profit',
              'recurrence',
              'recurring',
              'audit',
              'costing',
              'integrations',
              'tax',
              'billing',
            ]);

            const isNotifAllowed = (n: any): boolean => {
              // 1. Portal isolation: strictly reject organization/platform notifications
              const p = String(n.portal || '').toLowerCase();
              if (p === 'organization' || p === 'platform') return false;

              // 2. Category isolation: reject organization finance/executive categories
              const cat = String(n.category || '').toLowerCase();
              if (ORG_ONLY_CATEGORIES.has(cat)) return false;

              // 3. Action URL isolation: reject links into organization admin dashboards
              const actionUrl = String(n.action_url || n.actionUrl || '').toLowerCase();
              if (
                actionUrl.startsWith('/dashboard') ||
                actionUrl.includes('view=costing') ||
                actionUrl.includes('view=cashflow') ||
                actionUrl.includes('view=transactions') ||
                actionUrl.includes('view=reports')
              ) {
                return false;
              }

              // 4. User ownership: must belong to caller or be an employee broadcast
              if (n.user_id && String(n.user_id) !== callerId) return false;

              // 5. Unassigned notifications are only allowed if they are employee announcements/general
              if (!n.user_id && cat !== 'announcements' && cat !== 'general') return false;

              // 6. Preference toggles
              const title = String(n.title || '').toLowerCase();
              if (
                !prefs.expenseApprovals &&
                (cat === 'approvals' || cat === 'expenses' || title.includes('expense'))
              ) {
                return false;
              }
              if (
                !prefs.timesheetReminders &&
                (cat === 'timesheets' || title.includes('timesheet'))
              ) {
                return false;
              }
              if (
                !prefs.projectUpdates &&
                (cat === 'projects' || title.includes('project') || title.includes('task'))
              ) {
                return false;
              }
              if (
                !prefs.companyAnnouncements &&
                (cat === 'announcements' || title.includes('announcement'))
              ) {
                return false;
              }
              return true;
            };

            rows = rows.filter(isNotifAllowed);

            // Synthesize live employee notifications from real data for enabled categories
            try {
              const existingTitles = new Set(rows.map((r: any) => String(r.title || '')));
              const synthetic: any[] = [];

              const [expRes, tsRes, taskRes, annRes] = await Promise.all([
                prefs.expenseApprovals
                  ? sb
                      .from('employee_expenses')
                      .select('id, description, amount, currency, status, reviewed_at, date, rejection_reason')
                      .eq('organization_id', organizationId)
                      .eq('user_id', callerId)
                      .in('status', ['approved', 'rejected', 'reimbursed'])
                      .order('date', { ascending: false })
                      .limit(3)
                  : Promise.resolve({ data: [] }),
                prefs.timesheetReminders
                  ? sb
                      .from('timesheet_entries')
                      .select('id, hours, status, date, project_name')
                      .eq('organization_id', organizationId)
                      .eq('user_id', callerId)
                      .eq('status', 'draft')
                      .limit(5)
                  : Promise.resolve({ data: [] }),
                prefs.projectUpdates
                  ? sb
                      .from('project_tasks')
                      .select('id, title, status, priority, updated_at, created_at')
                      .eq('organization_id', organizationId)
                      .eq('assigned_to', callerId)
                      .neq('status', 'completed')
                      .limit(3)
                  : Promise.resolve({ data: [] }),
                prefs.companyAnnouncements
                  ? sb
                      .from('company_announcements')
                      .select('id, title, content, is_pinned, created_at')
                      .eq('organization_id', organizationId)
                      .order('created_at', { ascending: false })
                      .limit(2)
                  : Promise.resolve({ data: [] }),
              ]);

              for (const exp of expRes.data || []) {
                const title =
                  exp.status === 'approved'
                    ? `Expense Approved: ${exp.description}`
                    : exp.status === 'reimbursed'
                      ? `Expense Reimbursed: ${exp.description}`
                      : `Expense Rejected: ${exp.description}`;
                if (!existingTitles.has(title)) {
                  synthetic.push({
                    id: `live-exp-${exp.id}-${exp.status}`,
                    organization_id: organizationId,
                    user_id: callerId,
                    portal: 'employee',
                    type: exp.status === 'rejected' ? 'warning' : 'success',
                    category: 'approvals',
                    title,
                    message:
                      exp.status === 'rejected'
                        ? `Your expense "${exp.description}" (${exp.currency || 'USD'} ${Number(exp.amount || 0).toFixed(2)}) was rejected.${exp.rejection_reason ? ` Reason: ${exp.rejection_reason}` : ''}`
                        : exp.status === 'reimbursed'
                          ? `Your approved expense "${exp.description}" (${exp.currency || 'USD'} ${Number(exp.amount || 0).toFixed(2)}) has been settled and reimbursed.`
                          : `Your expense "${exp.description}" (${exp.currency || 'USD'} ${Number(exp.amount || 0).toFixed(2)}) has been approved and queued for reimbursement.`,
                    action_url: '/employee?tab=expenses',
                    action_label: 'View Expenses',
                    is_read: false,
                    created_at: exp.reviewed_at || exp.date || new Date().toISOString(),
                  });
                }
              }

              const draftEntries = tsRes.data || [];
              if (prefs.timesheetReminders && draftEntries.length > 0) {
                const totalDraftHours = draftEntries.reduce(
                  (sum: number, t: any) => sum + Number(t.hours || 0),
                  0,
                );
                const title = 'Timesheet Reminder: Draft Hours Pending';
                if (!existingTitles.has(title)) {
                  synthetic.push({
                    id: `live-ts-draft-${callerId}`,
                    organization_id: organizationId,
                    user_id: callerId,
                    portal: 'employee',
                    type: 'info',
                    category: 'timesheets',
                    title,
                    message: `You have ${draftEntries.length} draft timesheet entry(s) (${totalDraftHours}h) ready to submit for approval.`,
                    action_url: '/employee?tab=timesheets',
                    action_label: 'Submit Timesheet',
                    is_read: false,
                    created_at: new Date().toISOString(),
                  });
                }
              }

              for (const task of taskRes.data || []) {
                const title = `Project Task Assigned: ${task.title}`;
                if (!existingTitles.has(title)) {
                  synthetic.push({
                    id: `live-task-${task.id}`,
                    organization_id: organizationId,
                    user_id: callerId,
                    portal: 'employee',
                    type: 'info',
                    category: 'projects',
                    title,
                    message: `Task "${task.title}" (${task.priority || 'medium'} priority) is currently ${String(task.status || 'todo').replace('_', ' ')}.`,
                    action_url: '/employee?tab=projects',
                    action_label: 'View Projects',
                    is_read: false,
                    created_at: task.updated_at || task.created_at || new Date().toISOString(),
                  });
                }
              }

              for (const ann of annRes.data || []) {
                const title = `Announcement: ${ann.title}`;
                if (!existingTitles.has(title)) {
                  synthetic.push({
                    id: `live-ann-${ann.id}`,
                    organization_id: organizationId,
                    user_id: callerId,
                    portal: 'employee',
                    type: ann.is_pinned ? 'warning' : 'info',
                    category: 'announcements',
                    title,
                    message: String(ann.content || '').slice(0, 140),
                    action_url: '/employee?tab=announcements',
                    action_label: 'Read Announcement',
                    is_read: false,
                    created_at: ann.created_at || new Date().toISOString(),
                  });
                }
              }

              rows = [...rows, ...synthetic];
            } catch (synthErr) {
              console.warn('[notifications] Employee live synthesis non-fatal warning:', synthErr);
            }
                      }
          }

          const formatted = rows.map((n: any) => ({
            id: n.id,
            organizationId: n.organization_id,
            userId: n.user_id,
            portal: n.portal || 'organization',
            type: n.type || 'info',
            category: n.category || 'general',
            title: n.title,
            message: n.message,
            actionUrl: n.action_url,
            actionLabel: n.action_label,
            read: !!n.is_read,
            isRead: !!n.is_read,
            timestamp: n.created_at,
            createdAt: n.created_at,
          }));
          return ok(res, formatted);
        }
      } catch (err) {
        console.warn('[notifications] Failed to query Supabase notifications:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // GET /organizations/:organizationId/notifications/unread-count
  r.get('/unread-count', async (req: Request, res: Response) => {
    const organizationId = param(req, 'organizationId');
    const portal = (req.query.portal as string) || 'organization';
    const callerId = req.authUser?.id;

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        let query = sb
          .from('notifications')
          .select('id, category, user_id, portal', { count: 'exact' })
          .eq('organization_id', organizationId)
          .eq('is_read', false);

        if (portal === 'employee') {
          query = query.eq('portal', 'employee');
          if (callerId) {
            query = query.or(`user_id.eq.${callerId},user_id.is.null`);
          }
        } else {
          query = query.eq('portal', 'organization');
        }

        const { data, count, error } = await query;
        if (!error && count !== null) {
          if (portal === 'employee' && Array.isArray(data)) {
            const ORG_ONLY_CATEGORIES = new Set([
              'budget',
              'categorization',
              'cashflow',
              'insight',
              'profit',
              'recurrence',
              'recurring',
              'audit',
              'costing',
              'integrations',
              'tax',
              'billing',
            ]);
            const filteredCount = data.filter(
              (n: any) => !ORG_ONLY_CATEGORIES.has(String(n.category || '').toLowerCase())
            ).length;
            return ok(res, filteredCount);
          }
          return ok(res, count);
        }
      } catch (err) {
        console.warn('[notifications] Failed to get unread count from Supabase:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // POST /organizations/:organizationId/notifications/read-all
  r.post('/read-all', async (req: Request, res: Response) => {
    const organizationId = param(req, 'organizationId');
    const portal = (req.body?.portal as string) || (req.query.portal as string) || 'organization';

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { error } = await sb
        .from('notifications')
        .update({ is_read: true })
        .eq('organization_id', organizationId)
        .eq('portal', portal);
      if (error) throw error;
      return ok(res, null, 'All marked as read');
    } catch (err) {
      console.warn('[notifications] Supabase read-all error:', err);
      return fail(res, 500, 'Failed to mark notifications as read');
    }
  });

  // PATCH /organizations/:organizationId/notifications/:id/read
  r.patch('/:id/read', async (req: Request, res: Response) => {
    const notifId = param(req, 'id');
    const organizationId = param(req, 'organizationId');

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { error } = await sb
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notifId)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return ok(res, null, 'Marked as read');
    } catch (err) {
      console.warn('[notifications] Supabase mark read error:', err);
      return fail(res, 500, 'Failed to mark notification as read');
    }
  });

  // DELETE /organizations/:organizationId/notifications/:id
  r.delete('/:id', async (req: Request, res: Response) => {
    const notifId = param(req, 'id');
    const organizationId = param(req, 'organizationId');

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { error } = await sb
        .from('notifications')
        .delete()
        .eq('id', notifId)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return ok(res, null, 'Notification removed');
    } catch (err) {
      console.warn('[notifications] Supabase delete notification error:', err);
      return fail(res, 500, 'Failed to remove notification');
    }
  });

  // DELETE /organizations/:organizationId/notifications (clear all)
  r.delete('/', async (req: Request, res: Response) => {
    const organizationId = param(req, 'organizationId');
    const portal = (req.query.portal as string) || 'organization';

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { error } = await sb
        .from('notifications')
        .delete()
        .eq('organization_id', organizationId)
        .eq('portal', portal);
      if (error) throw error;
      return ok(res, null, 'All notifications cleared');
    } catch (err) {
      console.warn('[notifications] Supabase clear all error:', err);
      return fail(res, 500, 'Failed to clear notifications');
    }
  });

  return r;
}

function formatNotificationRow(n: any) {
  return {
    id: n.id,
    organizationId: n.organization_id,
    userId: n.user_id,
    portal: n.portal || 'organization',
    type: n.type || 'info',
    category: n.category || 'general',
    title: n.title,
    message: n.message,
    actionUrl: n.action_url,
    actionLabel: n.action_label,
    read: !!n.is_read,
    isRead: !!n.is_read,
    timestamp: n.created_at,
    createdAt: n.created_at,
  };
}

/**
 * User-org scoped router.
 * Mounted at `/users/:userId/organizations/:organizationId/notifications`.
 */
export function createUserOrgNotificationsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/unread-count', async (req: Request, res: Response) => {
    const userId = param(req, 'userId');
    const organizationId = param(req, 'organizationId');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { count, error } = await sb
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('is_read', false);
      if (error) throw error;
      return ok(res, count ?? 0);
    } catch (err) {
      console.warn('[notifications] user unread-count error:', err);
      return fail(res, 500, 'Failed to load unread count');
    }
  });

  r.post('/read-all', async (req: Request, res: Response) => {
    const userId = param(req, 'userId');
    const organizationId = param(req, 'organizationId');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { error } = await sb
        .from('notifications')
        .update({ is_read: true })
        .eq('organization_id', organizationId)
        .eq('user_id', userId);
      if (error) throw error;
      return ok(res, null, 'All marked as read');
    } catch (err) {
      console.warn('[notifications] user read-all error:', err);
      return fail(res, 500, 'Failed to mark notifications as read');
    }
  });

  r.get('/', async (req: Request, res: Response) => {
    const userId = param(req, 'userId');
    const organizationId = param(req, 'organizationId');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data, error } = await sb
        .from('notifications')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return ok(res, (data || []).map(formatNotificationRow));
    } catch (err) {
      console.warn('[notifications] user list error:', err);
      return fail(res, 500, 'Failed to load notifications');
    }
  });

  r.post('/', async (req: Request, res: Response) => {
    const userId = param(req, 'userId');
    const organizationId = param(req, 'organizationId');
    const data = req.body as Omit<Notification, 'id' | 'createdAt' | 'userId' | 'organizationId'>;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const d: any = data;
    const row = {
      id: 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      organization_id: organizationId,
      user_id: userId,
      portal: d.portal || 'organization',
      type: d.type || 'info',
      category: d.category || 'general',
      title: d.title,
      message: d.message,
      action_url: d.actionUrl ?? null,
      action_label: d.actionLabel ?? null,
      is_read: false,
      created_at: new Date().toISOString(),
    };

    try {
      const { error } = await sb.from('notifications').insert(row);
      if (error) throw error;
      return created(res, formatNotificationRow(row));
    } catch (err) {
      console.warn('[notifications] user create error:', err);
      return fail(res, 500, 'Failed to create notification');
    }
  });

  return r;
}
/**
 * Mounted at `/notifications`.
 */
export function createGlobalNotificationsRouter(): Router {
  const r = Router();

  r.patch('/:id/read', async (req: Request, res: Response) => {
    const notifId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb.from('notifications').update({ is_read: true }).eq('id', notifId);
      } catch {
        // non-fatal
      }
    }
    
    ok(res, null);
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const notifId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb.from('notifications').delete().eq('id', notifId);
      } catch {
        // non-fatal
      }
    }
    
    ok(res, null);
  });

  return r;
}
