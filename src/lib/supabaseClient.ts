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
 * True when Supabase is configured AND selected as the active data-sync backend
 * (`VITE_USE_SUPABASE_DATA=true`) — i.e. `dataStore`'s single-row `finance_os_app_bundle`
 * sync (see `services/dataStore.ts` / `services/supabaseBundle.ts`) is the source of truth.
 * Services check this to skip the local HTTP API and use the (Supabase-synced) `dataStore`
 * instead, since the two backends keep independent sessions and can't be mixed per-request.
 */
export function isSupabaseDataConfigured(): boolean {
  return import.meta.env.VITE_USE_SUPABASE_DATA === 'true' && isSupabaseConfigured();
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

/**
 * Normalizes `expires_at` in stored Supabase sessions when the user's local system clock
 * (`Date.now()`) is skewed ahead of Supabase's UTC server clock (e.g. PC date set to future).
 * Without this, `@supabase/auth-js` sees `session.expires_at * 1000 < Date.now()` immediately
 * on login, causing continuous refresh storms on every `getSession()` / `sb.from()` call and
 * premature session eviction every 5-10 minutes.
 */
function repairClockSkewedStoredSessions(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const nowSec = Math.round(Date.now() / 1000);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.access_token === 'string' &&
        typeof parsed.expires_at === 'number'
      ) {
        const expiresIn = typeof parsed.expires_in === 'number' && parsed.expires_in > 0 ? parsed.expires_in : 3600;
        // If expires_at is in the past or more than 2x expiresIn away due to local PC clock skew,
        // re-anchor it relative to local Date.now() so GoTrueClient doesn't loop-refresh.
        if (parsed.expires_at <= nowSec + 90 || parsed.expires_at > nowSec + expiresIn * 2) {
          parsed.expires_at = nowSec + expiresIn;
          localStorage.setItem(k, JSON.stringify(parsed));
        }
      }
    }
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Wraps `fetch` for Supabase Auth endpoints so `expires_at` in `/auth/v1/token` responses is
 * always anchored to the browser's `Date.now() + expires_in` rather than the server's clock.
 */
const clockSkewSafeFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (res.ok && urlStr.includes('/auth/v1/') && (urlStr.includes('/token') || urlStr.includes('/verify') || urlStr.includes('/signup'))) {
      const clone = res.clone();
      const data = await clone.json();
      if (data && typeof data === 'object') {
        const nowSec = Math.round(Date.now() / 1000);
        let modified = false;
        if (typeof data.access_token === 'string' && typeof data.expires_in === 'number') {
          data.expires_at = nowSec + data.expires_in;
          modified = true;
        }
        if (data.session && typeof data.session === 'object' && typeof data.session.expires_in === 'number') {
          data.session.expires_at = nowSec + data.session.expires_in;
          modified = true;
        }
        if (modified) {
          return new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      }
    }
  } catch {
    /* fall through with original response */
  }
  return res;
};

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;

  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseAnonKey();
  const fp = `${url}|${key}`;

  if (!client || clientFingerprint !== fp) {
    repairClockSkewedStoredSessions();
    client = createClient(url, key, {
      global: {
        fetch: clockSkewSafeFetch,
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    clientFingerprint = fp;
  }
  return client;
}
