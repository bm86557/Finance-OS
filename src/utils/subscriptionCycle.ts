import type { SubscriptionInfo } from '@/services/billingService';

export interface SubscriptionCycleDetails {
  hasActiveSubscription: boolean;
  daysRemaining: number;
  totalCycleDays: number;
  daysPassed: number;
  progressPercent: number;
  startDateFormatted: string;
  renewalDateFormatted: string;
  nextBillingText: string;
  statusBadgeText: string;
  isExpiringSoon: boolean;
  isExpired: boolean;
  cancelAtPeriodEnd: boolean;
}

/**
 * Calculates live remaining days, elapsed progress, and formatted dates
 * based on the authoritative `current_period_start` and `current_period_end`.
 */
export function calculateSubscriptionCycle(
  subscription: SubscriptionInfo | null | undefined,
  planPrice: number = 0,
  planSlug: string = 'basic',
): SubscriptionCycleDetails {
  // Free tier or no paid subscription
  if (planPrice === 0 || planSlug === 'basic' || !subscription) {
    return {
      hasActiveSubscription: false,
      daysRemaining: 0,
      totalCycleDays: 30,
      daysPassed: 0,
      progressPercent: 0,
      startDateFormatted: 'N/A',
      renewalDateFormatted: 'Always Free',
      nextBillingText: 'Free Tier (No expiration)',
      statusBadgeText: 'Always Free',
      isExpiringSoon: false,
      isExpired: false,
      cancelAtPeriodEnd: false,
    };
  }

  const now = new Date();
  const endDate = subscription.current_period_end
    ? new Date(subscription.current_period_end)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const startDate = subscription.current_period_start
    ? new Date(subscription.current_period_start)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const nowMs = now.getTime();
  const endMs = endDate.getTime();
  const startMs = startDate.getTime();

  const totalDurationMs = Math.max(1000, endMs - startMs);
  const elapsedMs = Math.max(0, nowMs - startMs);
  const remainingMs = endMs - nowMs;

  const isExpired = remainingMs <= 0;
  
  // Total cycle in calendar days (typically 30)
  const totalCycleDays = Math.max(1, Math.round(totalDurationMs / (1000 * 60 * 60 * 24)));
  
  // Days remaining: using Math.ceil for accurate countdown
  // (e.g. 28 days and 20 hours remaining = 29 days left)
  const daysRemaining = isExpired ? 0 : Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
  
  // Days passed into current cycle (e.g., day 1 or 2)
  const daysPassed = Math.min(totalCycleDays, Math.max(1, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)) + 1));
  
  // Progress percentage (0% to 100%)
  const progressPercent = isExpired ? 100 : Math.min(100, Math.max(0, (elapsedMs / totalDurationMs) * 100));

  const isExpiringSoon = daysRemaining <= 3 && !isExpired;

  const renewalDateFormatted = endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const startDateFormatted = startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);

  let nextBillingText = '';
  if (isExpired) {
    nextBillingText = `Expired on ${renewalDateFormatted}`;
  } else if (cancelAtPeriodEnd) {
    nextBillingText = `Cancels on ${renewalDateFormatted} (${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left)`;
  } else if (daysRemaining === 0) {
    nextBillingText = `Renews today (${renewalDateFormatted})`;
  } else if (daysRemaining === 1) {
    nextBillingText = `Renews tomorrow (${renewalDateFormatted})`;
  } else {
    nextBillingText = `In ${daysRemaining} days (${renewalDateFormatted})`;
  }

  let statusBadgeText = 'Active';
  if (isExpired) {
    statusBadgeText = 'Expired';
  } else if (cancelAtPeriodEnd) {
    statusBadgeText = 'Canceling';
  } else if (isExpiringSoon) {
    statusBadgeText = `${daysRemaining}d Left`;
  }

  return {
    hasActiveSubscription: true,
    daysRemaining,
    totalCycleDays,
    daysPassed,
    progressPercent,
    startDateFormatted,
    renewalDateFormatted,
    nextBillingText,
    statusBadgeText,
    isExpiringSoon,
    isExpired,
    cancelAtPeriodEnd,
  };
}

