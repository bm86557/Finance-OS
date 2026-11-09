/**
 * Single-row JSON bundle sync for Finance OS ↔ Supabase (`finance_os_app_bundle`).
 * Requires Supabase Auth session + RLS policy on that table.
 */

import { getSupabaseClient } from '@/lib/supabaseClient';
import { buildPersistedBundleFromMocks } from '@/services/initialBundle';

export const BUNDLE_TABLE = 'finance_os_app_bundle';

export async function fetchBundleFromSupabase(): Promise<{
  schemaVersion: number;
  payload: Record<string, unknown>;
} | null> {
  if (import.meta.env.VITE_USE_SUPABASE_DATA !== 'true') return null;
  const sb = getSupabaseClient();
  if (!sb) return null;

  const { data, error } = await sb
    .from(BUNDLE_TABLE)
    .select('schema_version, payload')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    schemaVersion: data.schema_version as number,
    payload: data.payload as Record<string, unknown>,
  };
}

export async function upsertBundleToSupabase(
  bundle: { schemaVersion: number; payload: Record<string, unknown> },
  _opts?: { keepalive?: boolean },
): Promise<boolean> {
  if (import.meta.env.VITE_USE_SUPABASE_DATA !== 'true') return false;
  const sb = getSupabaseClient();
  if (!sb) return false;

  const { error } = await sb.from(BUNDLE_TABLE).upsert(
    {
      id: 1,
      schema_version: bundle.schemaVersion,
      payload: bundle.payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  return !error;
}

/** Insert mock-shaped bundle when the table has no row (first-time setup after login). */
export async function seedBundleIfEmpty(): Promise<void> {
  if (import.meta.env.VITE_USE_SUPABASE_DATA !== 'true') return;
  const existing = await fetchBundleFromSupabase();
  if (existing) return;
  const b = buildPersistedBundleFromMocks();
  await upsertBundleToSupabase(b);
}
