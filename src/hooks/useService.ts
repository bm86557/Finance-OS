/**
 * useService Hook
 * ================
 * Generic React hook for consuming service layer methods.
 * Handles loading, error, and data states automatically.
 *
 * Note: `data` is `null` while loading and on error. Default values in
 * destructuring (`const { data: x = [] }`) only apply when `data` is
 * `undefined`, not `null` — use `useServiceArray` for list endpoints.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ServiceResponse } from '@/services/types';
import { dataStore } from '@/services/dataStore';
import { logUnexpectedError } from '@/lib/diagnostics';

interface UseServiceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseServiceReturn<T> extends UseServiceState<T> {
  refetch: () => Promise<void>;
  mutate: (newData: T) => void;
}

/**
 * Hook for auto-fetching service data on mount
 *
 * Usage:
 *   const { data, loading, error, refetch } = useService(
 *     () => transactionService.getAll('org-001', { page: 1 }),
 *     [page], // re-fetch when deps change
 *     ['transactions'] // optional: refetch when dataStore notifies these collections
 *   );
 */
export function useService<T>(
  serviceFn: () => Promise<ServiceResponse<T>>,
  deps: any[] = [],
  subscribeToCollections?: readonly string[],
): UseServiceReturn<T> {
  const [state, setState] = useState<UseServiceState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await serviceFn();
      if (mountedRef.current) {
        if (response.success) {
          setState({ data: response.data, loading: false, error: null });
        } else {
          // Enhanced error messaging with HTTP status hints
          const errorMsg = response.error || 'Request failed without error message';
          const fullError = response.error?.includes('403') || response.error?.includes('Forbidden')
            ? `${errorMsg} - Check that you have access to this organization`
            : response.error?.includes('401') || response.error?.includes('Unauthorized')
            ? `${errorMsg} - Please sign in again`
            : errorMsg;
          setState({ data: null, loading: false, error: fullError });
        }
      }
    } catch (err: unknown) {
      logUnexpectedError('useService.fetch', err);
      if (mountedRef.current) {
        const errorMsg = err instanceof Error ? err.message : 'Service error';
        // Better error messages for common HTTP errors
        const fullError = errorMsg.includes('403') || errorMsg.includes('Forbidden')
          ? `Access denied (403) - Verify organization membership`
          : errorMsg.includes('401') || errorMsg.includes('Unauthorized')
          ? `Not authenticated (401) - Please sign in again`
          : errorMsg.includes('Failed to fetch')
          ? `Network error - Check your connection or server status`
          : errorMsg || 'An unexpected error occurred';
        setState({ data: null, loading: false, error: fullError });
      }
    }
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  const subscribeKey = subscribeToCollections?.length
    ? [...subscribeToCollections].sort().join(',')
    : '';

  useEffect(() => {
    if (!subscribeToCollections?.length) return;
    const unsubs = subscribeToCollections.map(col =>
      dataStore.subscribe(col, () => {
        fetchData();
      }),
    );
    return () => {
      unsubs.forEach(u => u());
    };
  }, [fetchData, subscribeKey]);

  const mutate = useCallback((newData: T) => {
    setState(prev => ({ ...prev, data: newData }));
  }, []);

  return { ...state, refetch: fetchData, mutate };
}

export interface UseServiceArrayReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  mutate: (newData: T[]) => void;
}

/**
 * Same as useService but `data` is always an array (never null).
 * Use for endpoints that return ServiceResponse<T[]> so `.map` / `.length` stay safe.
 */
export function useServiceArray<T>(
  serviceFn: () => Promise<ServiceResponse<T[]>>,
  deps: any[] = [],
  subscribeToCollections?: readonly string[],
): UseServiceArrayReturn<T> {
  const { data, loading, error, refetch, mutate } = useService<T[]>(
    serviceFn,
    deps,
    subscribeToCollections,
  );
  return {
    data: data ?? [],
    loading,
    error,
    refetch,
    mutate: mutate as (newData: T[]) => void,
  };
}

/**
 * Hook for service mutations (create, update, delete)
 *
 * Usage:
 *   const { execute, loading, error } = useMutation(
 *     (data) => transactionService.create('org-001', data)
 *   );
 *   await execute(newTransactionData);
 */
export function useMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<ServiceResponse<TOutput>>
): {
  execute: (input: TInput) => Promise<ServiceResponse<TOutput>>;
  loading: boolean;
  error: string | null;
  data: TOutput | null;
  reset: () => void;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TOutput | null>(null);

  const mutationFnRef = useRef(mutationFn);
  mutationFnRef.current = mutationFn;

  const execute = useCallback(async (input: TInput) => {
    setLoading(true);
    setError(null);
    try {
      const response = await mutationFnRef.current(input);
      if (response.success) {
        setData(response.data);
      } else {
        setError(response.error || 'Mutation failed');
      }
      setLoading(false);
      return response;
    } catch (err: unknown) {
      logUnexpectedError('useMutation.execute', err);
      const errorMsg = err instanceof Error ? err.message : 'Mutation error';
      setError(errorMsg);
      setLoading(false);
      return { success: false, data: null as any, error: errorMsg };
    }
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  return { execute, loading, error, data, reset };
}
