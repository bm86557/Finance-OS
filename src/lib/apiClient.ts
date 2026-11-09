/**
 * HTTP client for future REST backends (API-000).
 * When `getApiBaseUrl()` is empty, services keep using `dataStore`; do not call `apiRequest` in that mode
 * (or expect a clear `success: false` from `apiRequest` if invoked by mistake).
 */

import type { ServiceResponse } from '@/services/types';
import { logApiFailure } from '@/lib/diagnostics';
import { isSupabaseDataConfigured } from '@/lib/supabaseClient';

/** Primary env: set in `.env.local`. Returns empty string when no backend is configured. */
export function getApiBaseUrl(): string {
  const metaEnv = typeof import.meta !== 'undefined' && (import.meta as any)?.env ? (import.meta as any).env : {};
  const procEnv = typeof process !== 'undefined' && process?.env ? process.env : {};
  const primary = (metaEnv.VITE_API_BASE_URL || procEnv.VITE_API_BASE_URL || '')?.trim?.() ?? '';
  const legacy = (metaEnv.VITE_LOCAL_API_BASE || procEnv.VITE_LOCAL_API_BASE || '')?.trim?.() ?? '';
  return primary || legacy;
}

/**
 * True when an API base is available to route administrative or sync requests through HTTP.
 */
export function isHttpBackendConfigured(): boolean {
  return getApiBaseUrl().length > 0;
}

function joinBaseAndPath(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

export type ApiRequestOptions = RequestInit & {
  /** Optional bearer token; adds `Authorization` header when set. */
  token?: string;
};

/** Prevents hung requests (e.g. misconfigured API) from blocking auth and dashboards forever. */
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

function withTimeoutSignal(
  ms: number,
  existing?: AbortSignal | null,
): { signal: AbortSignal; clear: () => void } {
  if (existing) {
    return { signal: existing, clear: () => {} };
  }
  const c = new AbortController();
  const tid = setTimeout(() => c.abort(), ms);
  return {
    signal: c.signal,
    clear: () => clearTimeout(tid),
  };
}

/**
 * JSON-oriented `fetch` that returns `ServiceResponse<T>`.
 * - Sends cookies (`credentials: 'include'`) for session-style auth.
 * - Auto-attaches Supabase Bearer token if available and token option is omitted.
 * - 2xx: prefers body shaped like `{ success, data, ... }`; otherwise wraps raw JSON as `{ success: true, data }`.
 * - Non-OK HTTP: maps body `error` / `message` or status to `success: false`.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ServiceResponse<T>> {
  const base = getApiBaseUrl();
  if (!base) {
    return {
      success: false,
      data: null as unknown as T,
      error: 'HTTP backend not configured (set VITE_API_BASE_URL in .env.local)',
    };
  }

  const { token, ...requestInit } = options;
  const method = (requestInit.method ?? 'GET').toString().toUpperCase();
  const url = joinBaseAndPath(base, path);
  const headers = new Headers(requestInit.headers);

  let activeToken = token;
  if (!activeToken) {
    try {
      const sb = (await import('@/lib/supabaseClient')).getSupabaseClient();
      if (sb) {
        const sess = await sb.auth.getSession();
        activeToken = sess.data.session?.access_token;
      }
    } catch {
      /* ignore */
    }
  }

  if (activeToken) {
    headers.set('Authorization', `Bearer ${activeToken}`);
  }

  const body = requestInit.body;
  if (body != null && !(body instanceof FormData) && !(body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const { signal: timeoutSignal, clear: clearTimeoutSignal } = withTimeoutSignal(
    DEFAULT_FETCH_TIMEOUT_MS,
    requestInit.signal,
  );

  try {
    const res = await fetch(url, {
      ...requestInit,
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal: timeoutSignal,
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      const errMsg = extractErrorMessage(parsed, res);
      logApiFailure({ method, path, status: res.status, message: errMsg });
      return { success: false, data: null as unknown as T, error: errMsg };
    }

    if (parsed !== undefined && isServiceResponseShape(parsed)) {
      return parsed as ServiceResponse<T>;
    }

    // 204 or raw JSON without ServiceResponse wrapper
    const data = (parsed === undefined ? null : parsed) as T;
    return { success: true, data };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'AbortError'
        ? `Request timed out after ${DEFAULT_FETCH_TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : 'Network error';
    logApiFailure({ method, path, message: msg });
    return { success: false, data: null as unknown as T, error: msg };
  } finally {
    clearTimeoutSignal();
  }
}

function isServiceResponseShape(value: unknown): value is { success: boolean; data: unknown } {
  return typeof value === 'object' && value !== null && 'success' in value && 'data' in value;
}

function extractErrorMessage(parsed: unknown, res: Response): string {
  if (parsed && typeof parsed === 'object' && parsed !== null) {
    const o = parsed as Record<string, unknown>;
    if (typeof o.error === 'string' && o.error) return o.error;
    if (typeof o.message === 'string' && o.message) return o.message;
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** Convenience for JSON bodies. */
export async function apiPostJson<TBody extends object, T>(
  path: string,
  body: TBody,
  options: Omit<ApiRequestOptions, 'body' | 'method'> = {},
): Promise<ServiceResponse<T>> {
  return apiRequest<T>(path, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Convenience for GET without cache surprises during dev. */
export async function apiGet<T>(path: string, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<ServiceResponse<T>> {
  return apiRequest<T>(path, { ...options, method: 'GET' });
}


/** Convenience for PUT with JSON bodies. */
export async function apiPutJson<TBody extends object, T>(
  path: string,
  body: TBody,
  options: Omit<ApiRequestOptions, 'body' | 'method'> = {},
): Promise<ServiceResponse<T>> {
  return apiRequest<T>(path, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Convenience for PATCH with JSON bodies. */
export async function apiPatchJson<TBody extends object, T>(
  path: string,
  body: TBody,
  options: Omit<ApiRequestOptions, 'body' | 'method'> = {},
): Promise<ServiceResponse<T>> {
  return apiRequest<T>(path, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Convenience for DELETE requests. */
export async function apiDelete<T>(
  path: string,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
): Promise<ServiceResponse<T>> {
  return apiRequest<T>(path, {
    ...options,
    method: 'DELETE',
  });
}
