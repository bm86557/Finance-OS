import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useNotifications, type Notification } from '../../../contexts/NotificationContext';
import { Button } from '../ui/button';
import { 
  Bell, 
  X, 
  Check, 
  CheckCheck,
  Trash2,
  AlertTriangle,
  Info,
  TrendingUp,
  Brain,
  Calendar,
  Settings as SettingsIcon,
  Waves,
  ArrowRight,
  Receipt,
  Clock,
  Briefcase,
  Megaphone,
  CheckCircle2,
  Wallet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';

const CATEGORY_ICONS: Record<string, any> = {
  cashflow: Waves,
  categorization: Brain,
  insight: TrendingUp,
  reminder: Calendar,
  system: SettingsIcon,
  budget: AlertTriangle,
  general: Bell,
  approvals: CheckCircle2,
  expenses: Receipt,
  timesheets: Clock,
  projects: Briefcase,
  announcements: Megaphone,
  payslips: Wallet,
};

const TYPE_STYLES: Record<string, string> = {
  info: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
  success: 'bg-green-500/10 border-green-500/20 text-green-400',
  warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  error: 'bg-red-500/10 border-red-500/20 text-red-400',
  insight: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
};

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    unreadCount: rawUnreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    refresh
  } = useNotifications();

  // Route-aware runtime portal boundary guard
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const isEmployeePortal = currentPath.startsWith('/employee');

  const visibleNotifications = notifications.filter(n => {
    const p = String(n.portal || '').toLowerCase();
    if (isEmployeePortal) {
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
      const actionUrl = String(n.actionUrl || '').toLowerCase();
      if (actionUrl.startsWith('/dashboard') || actionUrl.includes('view=costing')) return false;
    } else {
      if (p === 'employee') return false;
    }
    return true;
  });

  const unreadCount = visibleNotifications.filter(n => !n.read).length;

  return (
    <>
      {/* Notification Bell Button */}
      <button
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          if (next && refresh) {
            refresh().catch(() => null);
          }
        }}
        className="relative p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
        title="Notifications"
      >
        <Bell className="w-5 h-5 text-slate-400 hover:text-slate-200 transition-colors" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center shadow-lg shadow-red-500/50">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, x: 20, y: -10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 20, y: -10 }}
              transition={{ duration: 0.2 }}
              className="fixed right-4 top-16 w-96 max-w-[calc(100vw-2rem)] bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-white/10 bg-slate-950">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-medium text-sm">Notifications</h3>
                    <p className="text-xs text-slate-400">
                      {unreadCount > 0 
                        ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                        : 'All caught up!'
                      }
                    </p>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Actions */}
                {visibleNotifications.length > 0 && (
                  <div className="flex gap-2 mt-3">
                    {unreadCount > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={markAllAsRead}
                        className="flex-1 border-white/10 hover:bg-white/5 text-white text-xs h-8"
                      >
                        <CheckCheck className="w-3 h-3 mr-1" />
                        Mark all read
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={clearAll}
                      className="flex-1 border-white/10 hover:bg-white/5 text-white text-xs h-8"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Clear all
                    </Button>
                  </div>
                )}
              </div>

              {/* Notifications List */}
              <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                {visibleNotifications.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <Bell className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">No notifications</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {isEmployeePortal ? 'Personal employee updates will appear here' : 'Live organization alerts will appear here'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {visibleNotifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onRead={() => markAsRead(notification.id)}
                        onRemove={() => removeNotification(notification.id)}
                        onClose={() => setIsOpen(false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function NotificationItem({
  notification,
  onRead,
  onRemove,
  onClose
}: {
  notification: Notification;
  onRead: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const Icon = CATEGORY_ICONS[notification.category] || CATEGORY_ICONS.general || Bell;
  const typeStyle = TYPE_STYLES[notification.type] || TYPE_STYLES.info;
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={`px-4 py-3 hover:bg-white/5 transition-colors ${
        !notification.read ? 'bg-blue-500/5' : ''
      }`}
    >
      <div className="flex gap-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeStyle}`}>
          <Icon className="w-4 h-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="text-sm font-medium text-white">{notification.title}</h4>
            {!notification.read && (
              <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1" />
            )}
          </div>
          <p className="text-xs text-slate-400 mb-2 line-clamp-2">
            {notification.message}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {formatDistanceToNow(notification.timestamp instanceof Date ? notification.timestamp : new Date(notification.timestamp), { addSuffix: true })}
            </span>
            {notification.actionLabel && (
              <button
                onClick={() => {
                  onRead();
                  onClose();
                  if (notification.actionUrl) {
                    navigate(notification.actionUrl);
                  }
                }}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
              >
                {notification.actionLabel}
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {!notification.read && (
            <button
              onClick={onRead}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Mark as read"
            >
              <Check className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-red-400 transition-colors"
            title="Remove"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
