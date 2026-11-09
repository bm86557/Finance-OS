/**
 * usePlatformOrganizations
 * ========================
 * Live tenant list for the platform console.
 *
 * Loads the real `organizations` rows from Supabase and keeps them up to date:
 *   1. Supabase Realtime subscription on `public.organizations` (instant updates), and
 *   2. a low-frequency poll as a safety net for when the table is not part of the
 *      `supabase_realtime` publication (the poll only runs while the tab is visible).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  platformOrganizationService,
  type PlatformOrganization,
  type RealtimeStatus,
} from '@/services/platformOrganizationService';

export interface UsePlatformOrganizationsResult {
  organizations: PlatformOrganization[];
  loading: boolean;
  error: string | null;
  /** 'live' once the Realtime channel is connected. */
  realtime: RealtimeStatus;
  refetch: () => Promise<void>;
}

const FALLBACK_POLL_MS = 30_000;

export function usePlatformOrganizations(): UsePlatformOrganizationsResult {
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeStatus>('connecting');

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const load = useCallback(async (showSpinner: boolean) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (showSpinner) setLoading(true);
    try {
      const res = await platformOrganizationService.getAll();
      if (!mountedRef.current) return;
      if (res.success) {
        setOrganizations(res.data ?? []);
        setError(null);
      } else {
        setError(res.error || 'Could not load organizations.');
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load(true);

    const unsubscribe = platformOrganizationService.subscribeToOrganizations(
      () => {
        void load(false);
      },
      (status) => {
        if (mountedRef.current) setRealtime(status);
      },
    );

    const poll = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void load(false);
    }, FALLBACK_POLL_MS);

    // Refresh immediately when the operator comes back to the tab.
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load]);

  const refetch = useCallback(async () => {
    await load(false);
  }, [load]);

  return { organizations, loading, error, realtime, refetch };
}
