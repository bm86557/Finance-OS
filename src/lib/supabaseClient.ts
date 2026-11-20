/**
 * Supabase browser client (anon key — use RLS in Supabase).
 *
 * Connection order (first non-empty wins per field):
 * 1. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `.env.local` (best for teams)
 * 2. Values saved in localStorage from the in-app "Connect Supabase" form (quick personal setup)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_STORAGE_URL = 'finance_os_supabase_url';
export const SUPABASE_STORAGE_ANON_KEY = 'finance_os_supabase_anon_key';

let client: SupabaseClient | null = null;
let clientFingerprint = '';

function envUrl(): string {
  const meta = typeof import.meta !== 'undefined' && (import.meta as any)?.env ? (import.meta as any).env : {};
  const proc = typeof process !== 'undefined' && process?.env ? process.env : {};
  return (meta.VITE_SUPABASE_URL || proc.VITE_SUPABASE_URL || '')?.trim?.() ?? '';
}

function envKey(): string {
  const meta = typeof import.meta !== 'undefined' && (import.meta as any)?.env ? (import.meta as any).env : {};
  const proc = typeof process !== 'undefined' && process?.env ? process.env : {};
  const anon = (meta.VITE_SUPABASE_ANON_KEY || proc.VITE_SUPABASE_ANON_KEY || '')?.trim?.() ?? '';
  const publishable = (meta.VITE_SUPABASE_PUBLISHABLE_KEY || proc.VITE_SUPABASE_PUBLISHABLE_KEY || '')?.trim?.() ?? '';
  return anon || publishable;
}

function storageUrl(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(SUPABASE_STORAGE_URL)?.trim() ?? '';
}

function storageKey(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(SUPABASE_STORAGE_ANON_KEY)?.trim() ?? '';
}

/** URL used for API calls: env overrides storage. */
export function getResolvedSupabaseUrl(): string {
  return envUrl() || storageUrl();
}

/** Anon key: env overrides storage. */
export function getResolvedSupabaseAnonKey(): string {
  return envKey() || storageKey();
}

export type SupabaseConfigSource = 'env' | 'storage' | 'none';

export function getSupabaseConfigHint(): {
  urlSource: SupabaseConfigSource;
  keySource: SupabaseConfigSource;
  isComplete: boolean;
} {
  const hasEnvUrl = envUrl().length > 0;
  const hasEnvKey = envKey().length > 0;
  const hasStoreUrl = storageUrl().length > 0;
  const hasStoreKey = storageKey().length > 0;
  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseAnonKey();
  return {
    urlSource: hasEnvUrl ? 'env' : hasStoreUrl ? 'storage' : 'none',
    keySource: hasEnvKey ? 'env' : hasStoreKey ? 'storage' : 'none',
    isComplete: url.length > 0 && key.length > 0,
  };
}

export function isSupabaseConfigured(): boolean {
  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseAnonKey();
  return url.length > 0 && key.length > 0;
}

/**
 * Legacy single-row `finance_os_app_bundle` dataStore sync is decommissioned.
 * Always returns `false` so all services use real Supabase PostgreSQL tables and `/api/v1` routes
 * rather than the in-memory `dataStore` bundle, even if `VITE_USE_SUPABASE_DATA=true` is set in env.
 */
export function isSupabaseDataConfigured(): boolean {
  return false;
}

/** Persist URL + anon key in the browser (used when env vars are not set). */
export function saveSupabaseConfigToStorage(url: string, anonKey: string): void {
  if (typeof localStorage === 'undefined') return;
  const u = url.trim();
  const k = anonKey.trim();
  if (u) localStorage.setItem(SUPABASE_STORAGE_URL, u);
  else localStorage.removeItem(SUPABASE_STORAGE_URL);
  if (k) localStorage.setItem(SUPABASE_STORAGE_ANON_KEY, k);
  else localStorage.removeItem(SUPABASE_STORAGE_ANON_KEY);
  invalidateSupabaseClient();
}

export function clearSupabaseConfigFromStorage(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SUPABASE_STORAGE_URL);
  localStorage.removeItem(SUPABASE_STORAGE_ANON_KEY);
  invalidateSupabaseClient();
}

export function invalidateSupabaseClient(): void {
  client = null;
  clientFingerprint = '';
  inFlightRefresh = null;
}

let inFlightRefresh: Promise<string | undefined> | null = null;
const PROACTIVE_REFRESH_BUFFER_SEC = 120; // Refresh tokens within 2 minutes of expiry

function isSessionNearExpiry(expiresAt?: number | null, bufferSec = PROACTIVE_REFRESH_BUFFER_SEC): boolean {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAt <= nowSec + bufferSec;
}

/**
 * Refreshes the active Supabase session using a single shared in-flight promise so concurrent
 * requests and multi-tab refresh rotations never race on refresh-token rotation.
 */
export async function refreshSupabaseAccessToken(failedToken?: string): Promise<string | undefined> {
  const sb = getSupabaseClient();
  if (!sb) return undefined;

  // Cross-tab recovery: if another tab already rotated and stored a fresh token, use it immediately
  if (failedToken) {
    try {
      const { data } = await sb.auth.getSession();
      const latest = data.session;
      if (latest?.access_token && latest.access_token !== failedToken && !isSessionNearExpiry(latest.expires_at, 30)) {
        return latest.access_token;
      }
    } catch {
      /* continue to refreshSession */
    }
  }

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const { data, error } = await sb.auth.refreshSession();
        if (!error && data.session?.access_token) {
          return data.session.access_token;
        }
        // If refresh failed due to a concurrent cross-tab rotation, wait briefly and re-read storage once
        await new Promise((r) => setTimeout(r, 150));
        const { data: retryData } = await sb.auth.getSession();
        if (
          retryData.session?.access_token &&
          retryData.session.access_token !== failedToken &&
          !isSessionNearExpiry(retryData.session.expires_at, 0)
        ) {
          return retryData.session.access_token;
        }
        return undefined;
      } catch {
        return undefined;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }

  return inFlightRefresh;
}

/**
 * Ensures the active Supabase session is fresh (proactively refreshing if expired or within 2 minutes of expiry).
 * Safe to call on tab focus, visibilitychange, and network reconnect.
 */
export async function ensureFreshSupabaseSession(): Promise<string | undefined> {
  return getActiveSupabaseAccessToken();
}

/**
 * Returns the active Supabase access token, proactively refreshing if near or past expiry.
 */
export async function getActiveSupabaseAccessToken(): Promise<string | undefined> {
  const sb = getSupabaseClient();
  if (!sb) return undefined;

  try {
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session?.access_token) return undefined;

    if (isSessionNearExpiry(session.expires_at)) {
      const refreshed = await refreshSupabaseAccessToken(session.access_token);
      if (refreshed) return refreshed;
    }
    return session.access_token;
  } catch {
    return undefined;
  }
}

export function normalizeSessionJsonClockSkew(
  raw: string | null,
  isWrite: boolean,
  previousRaw?: string | null,
): string | null {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.access_token === 'string' &&
      typeof parsed.expires_at === 'number'
    ) {
      const nowSec = Math.round(Date.now() / 1000);
      const expiresIn = typeof parsed.expires_in === 'number' && parsed.expires_in > 0 ? parsed.expires_in : 3600;
      if (isWrite) {
        // Anchor expires_at to browser clock + expires_in ONLY when a genuinely new access_token is written
        // (sign-in or refresh). Never extend an already-stored token's expiry on re-writes.
        let prevAccessToken: string | undefined;
        let prevExpiresAt: number | undefined;
        if (previousRaw) {
          try {
            const prev = JSON.parse(previousRaw);
            prevAccessToken = prev?.access_token;
            prevExpiresAt = typeof prev?.expires_at === 'number' ? prev.expires_at : undefined;
          } catch {
            /* ignore */
          }
        }
        if (prevAccessToken && prevAccessToken === parsed.access_token && prevExpiresAt !== undefined) {
          parsed.expires_at = prevExpiresAt;
        } else {
          parsed.expires_at = nowSec + expiresIn;
        }
        return JSON.stringify(parsed);
      }
      // On read: NEVER rewrite an expired expires_at into the future (that would sabotage GoTrueClient autoRefreshToken!).
      // Only clamp obviously corrupt far-future timestamps (> 2x expires_in ahead of browser clock).
      if (parsed.expires_at > nowSec + expiresIn * 2) {
        parsed.expires_at = nowSec + expiresIn;
        return JSON.stringify(parsed);
      }
    }
  } catch {
    /* ignore non-JSON storage values */
  }
  return raw;
}

export const clockSkewSafeStorage = {
  getItem(key: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      if (raw && /^sb-.*-auth-token$/.test(key)) {
        const normalized = normalizeSessionJsonClockSkew(raw, false);
        if (normalized && normalized !== raw) {
          localStorage.setItem(key, normalized);
          return normalized;
        }
      }
      return raw;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const prevRaw = /^sb-.*-auth-token$/.test(key) ? localStorage.getItem(key) : null;
      const toStore = /^sb-.*-auth-token$/.test(key)
        ? (normalizeSessionJsonClockSkew(value, true, prevRaw) ?? value)
        : value;
      localStorage.setItem(key, toStore);
    } catch {
      /* ignore storage errors */
    }
  },
  removeItem(key: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore storage errors */
    }
  },
};

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;

  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseAnonKey();
  const fp = `${url}|${key}`;

  if (!client || clientFingerprint !== fp) {
    client = createClient(url, key, {
      auth: {
        storage: clockSkewSafeStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    clientFingerprint = fp;
  }
  return client;
}
