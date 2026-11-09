/**
 * useRecurringReminders Hook
 * ===========================
 * Monitors recurring transactions and creates notifications when they are due
 */

import { useEffect } from 'react';
import { useOrgServices } from './useOrgServices';
import { toast } from 'sonner';

export function useRecurringReminders() {
  const svc = useOrgServices();

  useEffect(() => {
    if (!svc.isReady) return;

    const checkDueTransactions = async () => {
      const res = await svc.recurring.getAll();
      if (!res.success) return;

      const today = new Date().toISOString().split('T')[0];
      const dueTransactions = res.data.filter(
        (r) => r.isActive && r.nextOccurrence <= today
      );

      if (dueTransactions.length > 0) {
        // Create notification for each due transaction
        for (const txn of dueTransactions) {
          await svc.notifications.create({
            title: 'Recurring Transaction Due',
            message: `"${txn.description}" (${txn.currency} ${Math.abs(txn.amount).toLocaleString()}) is due. Click to generate.`,
            type: 'info',
            actionUrl: '/dashboard/view=recurring',
            isRead: false,
          });
        }

        // Show toast notification
        toast.info(
          `${dueTransactions.length} recurring transaction${dueTransactions.length > 1 ? 's are' : ' is'} due`,
          {
            action: {
              label: 'View',
              onClick: () => {
                window.location.href = '/dashboard/view=recurring';
              },
            },
            duration: 10000,
          }
        );
      }
    };

    // Check immediately on mount
    checkDueTransactions();

    // Check every 1 hour
    const interval = setInterval(checkDueTransactions, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [svc.isReady, svc.orgId]);
}
