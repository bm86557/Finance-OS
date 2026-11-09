/**
 * Server-only Supabase client using the service-role key — never import this from `src/`.
 * Backs admin-only operations the anon-key browser client structurally cannot do:
 * creating/inviting real auth users and resolving `user_metadata.legacy_id` (the mock
 * dataStore user id, e.g. `user-emp-001`) back to a real Supabase Auth UUID.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
// @ts-ignore
import ws from 'ws';

let client: SupabaseClient | null = null;

export function isSupabaseAdminConfigured(): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseServiceRoleKey.length > 0;
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!isSupabaseAdminConfigured()) return null;
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: {
        // @ts-ignore - ws has different types but works at runtime
        transport: ws,
      },
    });
  }
  return client;
}

/** Paginates `auth.admin.listUsers` looking for `user_metadata.legacy_id === legacyId`. */
export async function findAuthUserIdByLegacyId(legacyId: string): Promise<string | null> {
  const sb = getSupabaseAdminClient();
  if (!sb) return null;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const match = data.users.find(u => (u.user_metadata as Record<string, unknown> | null)?.legacy_id === legacyId);
    if (match) return match.id;
    if (data.users.length < 200) return null; // last page
  }
  return null;
}

/**
 * Verifies email/password against Supabase Auth using a dedicated isolated client instance.
 * Never mutates the singleton admin client's service-role authentication headers.
 */
export async function verifyUserCredentials(email: string, password: string) {
  if (!isSupabaseAdminConfigured()) {
    return { user: null, session: null, error: new Error('Supabase admin not configured') };
  }
  const verifier = createClient(env.supabaseUrl, env.supabaseAnonKey || env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      // @ts-ignore
      transport: ws,
    },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

