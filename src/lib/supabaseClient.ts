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
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;

  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseAnonKey();
  const fp = `${url}|${key}`;

  if (!client || clientFingerprint !== fp) {
    client = createClient(url, key, {
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
