/**
 * Notification Service
 * =====================
 * CRUD for user & organization notifications.
 *
 * When `VITE_API_BASE_URL` is set, uses REST routes from backend API;
 * otherwise `dataStore`.
 */

import { Notification } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';

const NOTIF_BASE = (userId: string, organizationId: string) =>
  `/users/${encodeURIComponent(userId)}/organizations/${encodeURIComponent(organizationId)}/notifications`;

function requireUserOrg<T>(userId: string, organizationId: string): ServiceResponse<T> | null {
  if (!userId.trim() || !organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'userId and organizationId required' };
  }
  return null;
}

export const notificationService = {
  /**
   * Fetch live notifications strictly for an organization and portal (organization | employee).
   */
  async getByOrganization(
    organizationId: string,
    portal: 'organization' | 'employee' = 'organization',
  ): Promise<ServiceResponse<any[]>> {
    if (!organizationId?.trim()) {
      return { success: true, data: [] };
    }
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiGet<any[]>(
          `/organizations/${encodeURIComponent(organizationId)}/notifications?portal=${encodeURIComponent(portal)}`,
        );
        if (res.success && Array.isArray(res.data)) {
          return res;
        }
      } catch {
        /* fallback to Supabase */
      }
    }

    try {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      const sb = getSupabaseClient();
      if (sb) {
        const { data: authData } = await sb.auth.getUser();
        const callerId = authData?.user?.id;

        const { data: dbRows, error: notifErr } = await sb
          .from('notifications')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!notifErr && Array.isArray(dbRows)) {
          let rows = dbRows;

          if (portal === 'organization') {
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
            // Load employee's notification preferences
            const { employeeService } = await import('./employeeService');
            const sRes = await employeeService.getMySettings(
              organizationId,
              callerId,
            );
            const prefs = sRes.data.notifications;

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

            // 1. Filter notifications based on strict portal boundary and preference toggles
            rows = rows.filter((n: any) => {
              // 1. Strict portal check
              const p = String(n.portal || '').toLowerCase();
              if (p === 'organization' || p === 'platform') return false;

              // 2. Reject organization executive categories
              const cat = String(n.category || '').toLowerCase();
              if (ORG_ONLY_CATEGORIES.has(cat)) return false;

              // 3. Reject links to organization dashboard
              const actionUrl = String(n.action_url || n.actionUrl || '').toLowerCase();
              if (
                actionUrl.startsWith('/dashboard') ||
                actionUrl.includes('view=costing') ||
                actionUrl.includes('view=cashflow') ||
                actionUrl.includes('view=transactions')
              ) {
                return false;
              }

              // 4. User ownership
              if (n.user_id && String(n.user_id) !== callerId) return false;
              if (!n.user_id && cat !== 'announcements' && cat !== 'general') return false;

              // 5. Preference toggles
              const title = String(n.title || '').toLowerCase();
              if (
                !prefs.expenseApprovals &&
                (cat === 'approvals' ||
                  cat === 'expenses' ||
                  title.includes('expense'))
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
                (cat === 'projects' ||
                  title.includes('project') ||
                  title.includes('task'))
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
            });

            // 2. Synthesize live notifications from real Supabase tables for enabled categories
            try {
              const existingTitles = new Set(
                rows.map((r: any) => String(r.title || '')),
              );
              const synthetic: any[] = [];

              const [expRes, tsRes, taskRes, annRes] =
                await Promise.all([
                  prefs.expenseApprovals
                    ? sb
                        .from('employee_expenses')
                        .select(
                          'id, description, amount, currency, status, reviewed_at, date, rejection_reason',
                        )
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

              for (const exp of (expRes.data as any[]) || []) {
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
                    created_at:
                      exp.reviewed_at || exp.date || new Date().toISOString(),
                  });
                }
              }

              const draftEntries = (tsRes.data as any[]) || [];
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

              for (const task of (taskRes.data as any[]) || []) {
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
                    created_at:
                      task.updated_at ||
                      task.created_at ||
                      new Date().toISOString(),
                  });
                }
              }

              for (const ann of (annRes.data as any[]) || []) {
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
              console.warn(
                '[notificationService] Live synthesis non-fatal warning:',
                synthErr,
              );
            }
                      }
          }

          return { success: true, data: rows };
        }
      }
    } catch (sbErr) {
      console.warn('[notificationService] Supabase fallback error:', sbErr);
    }

    const filtered = dataStore.notifications.filter(
      (n: any) =>
        n.organizationId === organizationId &&
        (!n.portal || n.portal === portal),
    );
    return { success: true, data: filtered };
  },

  /**
   * Get unread count for organization and portal.
   */
  async getOrgUnreadCount(
    organizationId: string,
    portal: 'organization' | 'employee' = 'organization',
  ): Promise<ServiceResponse<number>> {
    if (!organizationId?.trim()) {
      return { success: true, data: 0 };
    }
    if (isHttpBackendConfigured()) {
      return apiGet<number>(
        `/organizations/${encodeURIComponent(organizationId)}/notifications/unread-count?portal=${encodeURIComponent(portal)}`,
      );
    }
    const count = dataStore.notifications.filter(
      (n: any) => n.organizationId === organizationId && !n.isRead && (!n.portal || n.portal === portal),
    ).length;
    return { success: true, data: count };
  },

  /**
   * Mark all notifications as read for organization and portal.
   */
  async markOrgAllAsRead(
    organizationId: string,
    portal: 'organization' | 'employee' = 'organization',
  ): Promise<ServiceResponse<null>> {
    if (!organizationId?.trim()) return { success: true, data: null };
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/notifications/read-all`,
        {
          method: 'POST',
          body: JSON.stringify({ portal }),
        },
      );
    }
    dataStore.notifications.forEach((n: any) => {
      if (n.organizationId === organizationId && (!n.portal || n.portal === portal)) {
        n.isRead = true;
      }
    });
    dataStore.notify('notifications');
    return { success: true, data: null };
  },

  /**
   * Mark a single notification read for organization.
   */
  async markOrgNotificationRead(
    organizationId: string,
    notificationId: string,
  ): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/notifications/${encodeURIComponent(notificationId)}/read`,
        {
          method: 'PATCH',
          body: '{}',
        },
      );
    }
    return this.markAsRead(notificationId);
  },

  /**
   * Delete / dismiss a notification for organization.
   */
  async deleteOrgNotification(
    organizationId: string,
    notificationId: string,
  ): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/notifications/${encodeURIComponent(notificationId)}`,
        {
          method: 'DELETE',
        },
      );
    }
    return this.delete(notificationId);
  },

  /**
   * Clear all notifications for organization and portal.
   */
  async clearOrgNotifications(
    organizationId: string,
    portal: 'organization' | 'employee' = 'organization',
  ): Promise<ServiceResponse<null>> {
    if (!organizationId?.trim()) return { success: true, data: null };
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/notifications?portal=${encodeURIComponent(portal)}`,
        {
          method: 'DELETE',
        },
      );
    }
    dataStore.notifications = dataStore.notifications.filter(
      (n: any) => !(n.organizationId === organizationId && (!n.portal || n.portal === portal)),
    );
    dataStore.notify('notifications');
    return { success: true, data: null };
  },

  async getAll(userId: string, organizationId: string): Promise<ServiceResponse<Notification[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireUserOrg<Notification[]>(userId, organizationId);
      if (err) return err;
      return apiGet<Notification[]>(NOTIF_BASE(userId, organizationId));
    }

    await simulateDelay();
    const notifications = dataStore.notifications.filter(
      n => n.userId === userId && n.organizationId === organizationId,
    );
    return { success: true, data: notifications };
  },

  async getUnreadCount(userId: string, organizationId: string): Promise<ServiceResponse<number>> {
    if (isHttpBackendConfigured()) {
      const err = requireUserOrg<number>(userId, organizationId);
      if (err) return err;
      return apiGet<number>(`${NOTIF_BASE(userId, organizationId)}/unread-count`);
    }

    await simulateDelay(50);
    const count = dataStore.notifications.filter(
      n => n.userId === userId && n.organizationId === organizationId && !n.isRead,
    ).length;
    return { success: true, data: count };
  },

  async markAsRead(notificationId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(`/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PATCH',
        body: '{}',
      });
    }

    await simulateDelay(80);
    const idx = dataStore.notifications.findIndex(n => n.id === notificationId);
    if (idx !== -1) {
      dataStore.notifications[idx].isRead = true;
      dataStore.notify('notifications');
    }
    return { success: true, data: null };
  },

  async markAllAsRead(userId: string, organizationId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const err = requireUserOrg<null>(userId, organizationId);
      if (err) return err;
      return apiRequest<null>(`${NOTIF_BASE(userId, organizationId)}/read-all`, {
        method: 'POST',
        body: '{}',
      });
    }

    await simulateDelay(100);
    dataStore.notifications.forEach(n => {
      if (n.userId === userId && n.organizationId === organizationId) {
        n.isRead = true;
      }
    });
    dataStore.notify('notifications');
    return { success: true, data: null, message: 'All marked as read' };
  },

  async create(notification: Omit<Notification, 'id' | 'createdAt'>): Promise<ServiceResponse<Notification>> {
    if (isHttpBackendConfigured()) {
      const err = requireUserOrg<Notification>(notification.userId, notification.organizationId);
      if (err) return err;
      return apiPostJson<Omit<Notification, 'id' | 'createdAt'>, Notification>(
        NOTIF_BASE(notification.userId, notification.organizationId),
        notification,
      );
    }

    await simulateDelay(100);
    const newNotif: Notification = {
      ...notification,
      id: generateId('notif'),
      createdAt: new Date().toISOString(),
    };
    dataStore.notifications.unshift(newNotif);
    dataStore.notify('notifications');
    return { success: true, data: newNotif };
  },

  async delete(notificationId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(`/notifications/${encodeURIComponent(notificationId)}`, { method: 'DELETE' });
    }

    await simulateDelay(80);
    const idx = dataStore.notifications.findIndex(n => n.id === notificationId);
    if (idx !== -1) {
      dataStore.notifications.splice(idx, 1);
      dataStore.notify('notifications');
    }
    return { success: true, data: null };
  },
};
