/**
 * Supabase-only session helpers.
 *
 * Replaces the removed `server/lib/jwt.ts` + `server/lib/passwords.ts` (locally-signed JWT +
 * bcrypt). Authentication is now resolved exclusively through Supabase Auth:
 *
 *   Authorization: Bearer <supabase access token>   →  sb.auth.getUser(token)
 *   Role source:   public.profiles.platform_role    (RLS-protected, NOT user_metadata)
 *   Revocation:    public.active_sessions            (one row per live session)
 *
 * There is no second token format. A locally-signed JWT would be rejected here anyway — it is not
 * signed by the Supabase project's signing secret — which is exactly why the two systems could
 * never coexist.
 */

import type { Request, Response } from 'express';
import { createClient, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js';
import type { User } from '../../src/services/types.js';
import { env } from '../config/env.js';
// @ts-ignore
import ws from 'ws';

/**
 * Legacy cookie name from the deleted local-JWT flow. It is kept ONLY so `/auth/logout` can clear
 * a stale cookie left in an existing browser. No new code ever sets or reads it as a credential.
 */
export const LEGACY_AUTH_COOKIE_NAME = 'finance_os_session';

/** Supabase access tokens always arrive in the Authorization header from `src/lib/apiClient.ts`. */
export function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const value = header.slice(7).trim();
    if (value) return value;
  }
  return null;
}

/** Clears the dead legacy cookie on logout so an old local JWT can't linger in the browser. */
export function clearLegacyAuthCookie(res: Response): void {
  res.clearCookie(LEGACY_AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    domain: env.cookieDomain,
    path: '/',
  });
}

export type ResolvedAuthUser = {
  user: User;
  /** Row id in `public.active_sessions`, when one could be resolved. */
  sessionId: string | null;
};

interface CachedAuthUser {
  resolved: ResolvedAuthUser;
  expiresAt: number;
}

const authUserCache = new Map<string, CachedAuthUser>();
const AUTH_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Validates a Supabase access token and projects it into the app's `User` shape.
 *
 * Implements high-performance in-memory caching to eliminate redundant WAN round-trips
 * and prevent UND_ERR_CONNECT_TIMEOUT when the frontend issues multiple parallel requests.
 *
 * The platform role is read from `public.profiles` — the column RLS actually governs — rather
 * than from `auth.users.user_metadata`, which is unverified metadata and was the basis of a
 * privilege-escalation path in the old dual-auth flow.
 */
export async function resolveAuthUser(
  sb: SupabaseClient,
  accessToken: string,
): Promise<ResolvedAuthUser | null> {
  const now = Date.now();
  const cached = authUserCache.get(accessToken);
  if (cached && cached.expiresAt > now) {
    return cached.resolved;
  }

  try {
    const { data, error } = await sb.auth.getUser(accessToken);
    if (error || !data.user) return null;

    const user = await projectUser(sb, data.user);
    const resolved: ResolvedAuthUser = { user, sessionId: null };

    authUserCache.set(accessToken, {
      resolved,
      expiresAt: now + AUTH_CACHE_TTL_MS,
    });

    if (authUserCache.size > 2000) {
      const oldestKey = authUserCache.keys().next().value;
      if (oldestKey) authUserCache.delete(oldestKey);
    }

    return resolved;
  } catch (err: any) {
    // If Supabase timed out or threw network error, but we have a recently expired cache entry (< 5 mins), use it as fallback
    if (cached && cached.expiresAt > now - 5 * 60 * 1000) {
      console.warn('[auth] Supabase network timeout/unreachable, safely serving authenticated user from fallback cache');
      return cached.resolved;
    }
    throw err;
  }
}

/** Builds the app-level `User` from an auth user + its `profiles` row. */
export async function projectUser(sb: SupabaseClient, sbUser: SupabaseUser): Promise<User> {
  const meta = (sbUser.user_metadata ?? {}) as Record<string, unknown>;

  let fullName = '';
  let platformRole = 'organization_user';

  const { data: profile } = await sb
    .from('profiles')
    .select('full_name, platform_role')
    .eq('id', sbUser.id)
    .maybeSingle();

  if (profile) {
    fullName = (profile.full_name as string) || '';
    platformRole = (profile.platform_role as string) || 'organization_user';
  } else {
    // Fall back to metadata ONLY for display name and non-privileged default role. Never trust
    // metadata for a platform role — an unprivileged user must not be able to self-escalate.
    fullName =
      (meta.full_name as string) ||
      (meta.name as string) ||
      sbUser.email?.split('@')[0] ||
      'User';
  }

  return {
    id: sbUser.id,
    email: sbUser.email ?? '',
    name: fullName,
    role: platformRole as User['role'],
    createdAt: sbUser.created_at ?? new Date().toISOString(),
  };
}

/** Finds an auth user by email using the service role (RLS-safe: server-side only). */
export async function findAuthUserByEmail(
  sb: SupabaseClient,
  email: string,
): Promise<SupabaseUser | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;

  // Paginate: listUsers defaults to 50 and silently truncates, which would produce false
  // "not invited" answers on a real tenant with more than 50 users.
  const PER_PAGE = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    const match = data?.users?.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (!data || data.users.length < PER_PAGE) return null;
  }
  return null;
}

function deviceTypeFromUserAgent(ua: string): string {
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

function browserFromUserAgent(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return 'Safari';
  return 'Unknown';
}

/**
 * Records a live session in `public.active_sessions`.
 *
 * This table already existed in `supabase/schema.sql` but was never queried by any code path —
 * the old flow kept sessions in the in-memory `store.activeSessions` instead, which is why the
 * Active Sessions screen was permanently empty. Recording them here makes logout / "end session" /
 * "end other sessions" real, and gives the RLS policies on that table something to protect.
 */
export async function recordActiveSession(
  sb: SupabaseClient,
  user: User,
  organizationId: string,
  req: Request,
): Promise<string | null> {
  // `active_sessions.organization_id` is NOT NULL and references public.organizations(id), so a
  // platform user with no organization has no valid row to write. Skip rather than fail — losing
  // the session-log entry is far better than a 500 on login.
  if (!organizationId) return null;

  const ua = (req.headers['user-agent'] as string) || '';
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  try {
    // Only one session per user may be flagged current; the rest become secondary.
    await sb
      .from('active_sessions')
      .update({ is_current_session: false })
      .eq('user_id', user.id);

    const { error } = await sb.from('active_sessions').insert({
      id,
      user_id: user.id,
      user_name: user.name,
      user_email: user.email,
      organization_id: organizationId,
      device_type: deviceTypeFromUserAgent(ua),
      browser: browserFromUserAgent(ua),
      ip_address: req.ip || 'unknown',
      location: 'Unknown',
      login_time: now,
      last_activity: now,
      is_current_session: true,
    });
    if (error) {
      console.warn('[auth] active_sessions insert failed:', error.message);
      return null;
    }
    return id;
  } catch (e) {
    console.warn('[auth] active_sessions insert threw:', e);
    return null;
  }
}

/** Best-effort touch of `last_activity` so the session list doesn't show stale times. */
export async function touchActiveSession(sb: SupabaseClient, userId: string): Promise<void> {
  try {
    await sb
      .from('active_sessions')
      .update({ last_activity: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_current_session', true);
  } catch {
    /* non-critical */
  }
}

/**
 * Creates a user-scoped Supabase client that respects RLS policies.
 * Use this instead of getSupabaseAdminClient() when you want RLS enforcement.
 */
export function getUserSupabaseClient(accessToken: string): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      // @ts-ignore - ws has different types but works at runtime
      transport: ws,
    },
  });
}