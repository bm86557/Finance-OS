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

/**
 * Refreshes the active Supabase session using a single shared in-flight promise so concurrent
 * requests never race on refresh-token rotation.
 */
export async function refreshSupabaseAccessToken(): Promise<string | undefined> {
  const sb = getSupabaseClient();
  if (!sb) return undefined;

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const { data, error } = await sb.auth.refreshSession();
        if (error) return undefined;
        return data.session?.access_token;
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
 * Returns the active Supabase access token.
 */
export async function getActiveSupabaseAccessToken(): Promise<string | undefined> {
  const sb = getSupabaseClient();
  if (!sb) return undefined;

  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

function normalizeSessionJsonClockSkew(raw: string | null, isWrite: boolean): string | null {
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
        // On write (fresh sign-in or token refresh), anchor expires_at to browser clock + expires_in
        parsed.expires_at = nowSec + expiresIn;
        return JSON.stringify(parsed);
      }
      // On read, if local PC clock is skewed more than 10 minutes ahead of stored server expires_at,
      // re-anchor so GoTrueClient does not treat a valid session as expired on every read.
      if (parsed.expires_at < nowSec - 600 || parsed.expires_at > nowSec + expiresIn * 2) {
        parsed.expires_at = nowSec + expiresIn;
        return JSON.stringify(parsed);
      }
    }
  } catch {
    /* ignore non-JSON storage values */
  }
  return raw;
}

const clockSkewSafeStorage = {
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
      const toStore = /^sb-.*-auth-token$/.test(key)
        ? (normalizeSessionJsonClockSkew(value, true) ?? value)
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
