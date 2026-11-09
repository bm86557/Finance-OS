import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { notificationService } from '@/services/notificationService';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'insight';
  icon?: any;
  timestamp: Date;
  read: boolean;
  actionLabel?: string;
  actionUrl?: string;
  category:
    | 'cashflow'
    | 'categorization'
    | 'insight'
    | 'reminder'
    | 'system'
    | 'budget'
    | 'approvals'
    | 'expenses'
    | 'timesheets'
    | 'projects'
    | 'announcements'
    | 'payslips'
    | 'general';
  organizationId?: string;
  portal?: 'organization' | 'employee' | 'platform';
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

const NOTIFICATION_CONTEXT_KEY = Symbol.for('finance_os.notification_context');
export const NotificationContext = ((globalThis as any)[NOTIFICATION_CONTEXT_KEY] ||
  ((globalThis as any)[NOTIFICATION_CONTEXT_KEY] = createContext<NotificationContextType | undefined>(undefined))) as React.Context<NotificationContextType | undefined>;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { currentOrganization, user } = useAuth();
  const location = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  // Clean up legacy mock notifications key from previous iterations
  useEffect(() => {
    try {
      localStorage.removeItem('financeOS_notifications');
    } catch {
      // non-fatal
    }
  }, []);

  // Determine current portal based on pathname
  const portal: 'organization' | 'employee' = location.pathname.startsWith('/employee')
    ? 'employee'
    : 'organization';

  const orgId = currentOrganization?.id || '';

  // Fetch live notifications from backend & Supabase
  const fetchLiveNotifications = useCallback(async () => {
    if (!orgId) {
      setNotifications([]);
      return;
    }

    try {
      setLoading(true);
      const res = await notificationService.getByOrganization(orgId, portal);
      if (res.success && Array.isArray(res.data)) {
        const safeItems = res.data.filter((n: any) => {
          if (portal === 'employee') {
            const p = String(n.portal || '').toLowerCase();
            if (p === 'organization' || p === 'platform') return false;
            const cat = String(n.category || '').toLowerCase();
            const ORG_CATS = [
              'budget',
              'categorization',
              'cashflow',
              'insight',
              'profit',
              'recurrence',
              'recurring',
              'audit',
              'costing',
              'tax',
              'billing',
            ];
            if (ORG_CATS.includes(cat)) return false;
            const actionUrl = String(n.actionUrl || n.action_url || '').toLowerCase();
            if (actionUrl.startsWith('/dashboard') || actionUrl.includes('view=costing')) {
              return false;
            }
          }
          return true;
        });

        const formatted: Notification[] = safeItems.map((n: any) => ({
          id: n.id,
          title: n.title || 'Notification',
          message: n.message || '',
          type: n.type || 'info',
          category: n.category || 'system',
          actionLabel: n.actionLabel || n.action_label,
          actionUrl: n.actionUrl || n.action_url,
          read: !!n.read || !!n.isRead || !!n.is_read,
          timestamp: n.timestamp ? new Date(n.timestamp) : (n.createdAt ? new Date(n.createdAt) : new Date()),
          organizationId: n.organizationId || n.organization_id || orgId,
          portal: n.portal || portal,
        }));
        setNotifications(formatted);
      } else {
        setNotifications([]);
      }
    } catch (err) {
      console.warn('[NotificationContext] Failed to load live notifications:', err);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, portal]);

  // Initial load and refetch whenever active organization or portal changes.
  // Immediately reset local notifications array to prevent stale ghost alerts from lingering across portals.
  useEffect(() => {
    setNotifications([]);
    fetchLiveNotifications();
  }, [portal, orgId, fetchLiveNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = useCallback(async (id: string) => {
    // Optimistic local update
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
    if (orgId) {
      await notificationService.markOrgNotificationRead(orgId, id).catch(() => null);
    }
  }, [orgId]);

  const markAllAsRead = useCallback(async () => {
    // Optimistic local update
    setNotifications(prev =>
      prev.map(n => ({ ...n, read: true }))
    );
    if (orgId) {
      await notificationService.markOrgAllAsRead(orgId, portal).catch(() => null);
    }
  }, [orgId, portal]);

  const removeNotification = useCallback(async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (orgId) {
      await notificationService.deleteOrgNotification(orgId, id).catch(() => null);
    }
  }, [orgId]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    if (orgId) {
      await notificationService.clearOrgNotifications(orgId, portal).catch(() => null);
    }
  }, [orgId, portal]);

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
      organizationId: orgId,
      portal,
    };
    setNotifications(prev => [newNotification, ...prev]);
  }, [orgId, portal]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        refresh: fetchLiveNotifications,
        addNotification,
        markAsRead,
        markAllAsRead,
        removeNotification,
        clearAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}
