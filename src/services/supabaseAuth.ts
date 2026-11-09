/**
 * Maps Supabase Auth sessions to Finance OS `AuthSession` and optional org rows from Postgres.
 * Create tables with `supabase/schema.sql` in the Supabase SQL editor when you are ready for org data.
 */

import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import type { Organization, OrganizationMember, PlatformRole, User, MemberAccessRole } from '@/services/types';
import type { ServiceResponse } from '@/services/types';
import type { AuthSession, LoginCredentials } from '@/services/authSessionTypes';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isHttpBackendConfigured, apiGet } from '@/lib/apiClient';
import { dataStore } from '@/services/dataStore';

function isPlatformRole(v: unknown): v is PlatformRole {
  return v === 'platform_admin' || v === 'platform_manager' || v === 'organization_admin' || v === 'organization_user';
}

function mapSupabaseUser(u: SupabaseUser, platformRoleFallback?: unknown): User {
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    (u.email?.split('@')[0] ?? 'User');

  // Platform role can live in either place, so accept both:
  //  - `auth.users.user_metadata.platform_role` (set at signup)
  //  - `profiles.platform_role` (a real column; the authoritative source)
  // Reading only the metadata meant a role assigned in the profiles table was
  // silently downgraded to `organization_user`, locking the user out of the
  // platform portal with "no platform admin account found".
  const roleRaw = meta.platform_role ?? platformRoleFallback;
  const role: PlatformRole = isPlatformRole(roleRaw) ? roleRaw : 'organization_user';
  return {
    id: u.id,
    email: u.email ?? '',
    name,
    avatar: typeof meta.avatar_url === 'string' ? meta.avatar_url : undefined,
    role,
    createdAt: u.created_at ?? new Date().toISOString(),
  };
}

/** Reads the authoritative `profiles.platform_role` for a user and self-heals missing email. */
async function fetchProfilePlatformRole(userId: string, userEmail?: string): Promise<unknown> {
  try {
    const sb = getSupabaseClient();
    if (!sb) return undefined;
    const { data, error } = await sb
      .from('profiles')
      .select('platform_role, email')
      .eq('id', userId)
      .maybeSingle();
    if (error) return undefined;

    // Auto-heal: If profile email is missing/null, populate it
    if (userEmail && (!data || !(data as any).email)) {
      Promise.resolve(
        sb.from('profiles').upsert(
          { id: userId, email: userEmail.trim().toLowerCase() },
          { onConflict: 'id' }
        )
      ).catch(() => {});
    }

    return (data as { platform_role?: unknown } | null)?.platform_role;
  } catch {
    return undefined;
  }
}

export function mapOrgRow(row: Record<string, unknown>): Organization {
  const settings = row.settings;
  const settingsObj =
    settings && typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as Organization['settings'])
      : { theme: 'dark', notifications: true };

  const createdRaw = row.created_at;
  const createdAt =
    typeof createdRaw === 'string'
      ? createdRaw
      : createdRaw instanceof Date
        ? createdRaw.toISOString()
        : new Date().toISOString();

  return {
    id: String(row.id),
    slug: typeof row.slug === 'string' ? row.slug : undefined,
    name: String(row.name ?? ''),
    logo: typeof row.logo === 'string' ? row.logo : undefined,
    currency: String(row.currency ?? 'USD'),
    fiscalYearStart: String(row.fiscal_year_start ?? '01-01'),
    createdAt,
    settings: settingsObj,
  };
}

type MemberRow = {
  role: string;
  portal_type?: string;
  organization_id: string;
  joined_at?: string;
  organizations: Record<string, unknown> | Record<string, unknown>[] | null;
};

async function fetchOrgBySlug(slug: string): Promise<Organization | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data, error } = await sb.from('organizations').select('*');
  if (error || !data?.length) return null;
  const slugLower = slug.trim().toLowerCase();
  const row = data.find(
    (r: { slug?: string }) => typeof r.slug === 'string' && r.slug.toLowerCase() === slugLower,
  );
  return row ? mapOrgRow(row as Record<string, unknown>) : null;
}

async function fetchMembershipAndOrg(
  userId: string,
  orgSlug?: string,
  _recursionDepth = 0, // Prevent infinite recursion
  portalType?: string,
): Promise<{ organization: Organization | null; membership: OrganizationMember | null }> {
  // Safety check to prevent infinite recursion
  if (_recursionDepth > 3) {
    return { organization: null, membership: null };
  }

  const sb = getSupabaseClient();
  if (!sb) {
    return { organization: null, membership: null };
  }

  try {
    let rows: MemberRow[] = [];

    // Query organization_members directly without nested join to prevent RLS circular recursion
    let rawMembers: any[] = [];
    const { data: memberData, error: memberErr } = await sb
      .from('organization_members')
      .select('role, access_role, portal_type, status, department, organization_id, joined_at')
      .eq('user_id', userId)
      .limit(10);

    if (!memberErr && memberData) {
      rawMembers = memberData;
    } else if (memberErr) {
      // Fallback query if status/department columns don't exist yet in the database schema
      const { data: fallbackData, error: fallbackErr } = await sb
        .from('organization_members')
        .select('role, access_role, portal_type, organization_id, joined_at')
        .eq('user_id', userId)
        .limit(10);

      if (fallbackErr) {
        return { organization: null, membership: null };
      }
      if (fallbackData) {
        rawMembers = fallbackData;
      }
    }

    if (rawMembers.length > 0) {
      // Fetch matching organizations separately
      const orgIds = [...new Set(rawMembers.map(m => m.organization_id).filter(Boolean))];
      const orgMap = new Map<string, any>();
      if (orgIds.length > 0) {
        try {
          const { data: orgData } = await sb
            .from('organizations')
            .select('*')
            .in('id', orgIds);
          (orgData || []).forEach((o: any) => orgMap.set(o.id, o));
        } catch (orgErr) {
          console.warn('[supabaseAuth] Could not load organizations directly:', orgErr);
        }
      }

      rows = rawMembers.map(m => ({
        ...m,
        organizations: orgMap.get(m.organization_id) || null,
      })) as unknown as MemberRow[];
    }

    if (!rows.length) {
      // Fallback: If browser client session is unauthenticated (causing RLS to return 0 rows),
      // fetch membership via server API which queries Supabase using admin role safely
      if (isHttpBackendConfigured()) {
        try {
          const sRes = await apiGet<AuthSession | null>('/auth/session');
          if (sRes.success && sRes.data?.membership && sRes.data?.organization) {
            return {
              organization: sRes.data.organization,
              membership: sRes.data.membership,
            };
          }
        } catch {
          /* fallback */
        }
      }
      return { organization: null, membership: null };
    }

    let chosen: MemberRow | undefined;

    if (orgSlug) {
      const slugLower = orgSlug.trim().toLowerCase();
      chosen = rows.find(r => {
        const org = r.organizations;
        const o = Array.isArray(org) ? org[0] : org;
        if (!o || typeof o !== 'object') return false;
        const s = (o as { slug?: string }).slug;
        return typeof s === 'string' && s.toLowerCase() === slugLower;
      });
    }

    // If portalType is specified, prioritize matching role/portal_type
    if (!chosen && portalType === 'organization_admin') {
      chosen = rows.find(r => r.role === 'owner' || r.role === 'admin' || r.portal_type === 'organization_admin');
    }
    if (!chosen && portalType === 'employee') {
      chosen = rows.find(r => r.role === 'employee' || r.portal_type === 'employee');
    }

    // Default fallback: prioritize owner/admin, then employee, then first row
    if (!chosen) {
      chosen = rows.find(r => r.role === 'owner' || r.role === 'admin') ?? rows.find(r => r.role === 'employee') ?? rows[0];
    }

    if (!chosen) {
      return { organization: null, membership: null };
    }

    let organization: Organization | null = null;
    const orgRaw = chosen.organizations;
    const orgObj = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;
    if (orgObj && typeof orgObj === 'object') {
      organization = mapOrgRow(orgObj as Record<string, unknown>);
    } else if (chosen.organization_id) {
      // Direct query fallback if join was blocked or unpopulated
      try {
        const { data: directOrg } = await sb
          .from('organizations')
          .select('*')
          .eq('id', chosen.organization_id)
          .maybeSingle();
        if (directOrg) {
          organization = mapOrgRow(directOrg as Record<string, unknown>);
        }
      } catch {
        /* ignore */
      }
    }

    if (!organization) {
      return { organization: null, membership: null };
    }

    let accessRole: MemberAccessRole = 'team_member';
    const chosenAccessRole = String((chosen as any).access_role || '').toLowerCase().trim();
    if (chosen.role === 'owner' || chosen.role === 'admin' || chosenAccessRole === 'org_admin') {
      accessRole = 'org_admin';
    } else if (chosenAccessRole && ['accountant', 'team_member', 'viewer'].includes(chosenAccessRole)) {
      accessRole = chosenAccessRole as MemberAccessRole;
    } else {
      try {
        const { data: tm } = await sb
          .from('employee_team_members')
          .select('role')
          .eq('organization_id', organization.id)
          .eq('user_id', userId)
          .maybeSingle();

        const tmRole = String(tm?.role || '').toLowerCase().trim();
        const pos = String((chosen as any).position || '').toLowerCase().trim();
        if (tmRole === 'accountant' || pos.includes('accountant')) {
          accessRole = 'accountant';
        } else if (tmRole === 'viewer' || pos.includes('viewer')) {
          accessRole = 'viewer';
        } else {
          accessRole = 'team_member';
        }
      } catch {
        /* fallback */
      }
    }

    const rawStatus = (chosen as Record<string, unknown>).status as OrganizationMember['status'] | undefined;
    const membership: OrganizationMember = {
      userId,
      organizationId: organization.id,
      role: chosen.role as OrganizationMember['role'],
      accessRole,
      portalType: chosen.portal_type as OrganizationMember['portalType'],
      status: (rawStatus === 'pending' || rawStatus === 'rejected') ? rawStatus : 'active',
      department: (chosen as any).department,
      position: (chosen as any).position,
      joinedAt: chosen.joined_at ?? new Date().toISOString(),
    };

    return { organization, membership };
  } catch (err) {
    console.error('fetchMembershipAndOrg exception:', err);
    return { organization: null, membership: null };
  }
}

export async function buildAuthSessionFromSupabase(
  session: Session,
  orgSlug?: string,
  portalType?: string,
): Promise<AuthSession> {
  const user = mapSupabaseUser(session.user, await fetchProfilePlatformRole(session.user.id, session.user.email));
  const isPlatform = user.role === 'platform_admin' || user.role === 'platform_manager';
  const slugNorm = orgSlug?.trim();

  if (slugNorm && isPlatform) {
    const org = await fetchOrgBySlug(slugNorm);
    if (org) {
      return {
        user,
        organization: org,
        membership: null,
        token: session.access_token,
      };
    }
  }

  let { organization, membership } = await fetchMembershipAndOrg(session.user.id, orgSlug, 0, portalType);

  // If no membership found, return session with null org/membership
  // This allows login to succeed, and the UI can show "setup required" or redirect to onboarding
  if (!membership) {
    if (isHttpBackendConfigured()) {
      try {
        const sRes = await apiGet<AuthSession | null>('/auth/session');
        if (sRes.success && sRes.data?.organization && sRes.data?.membership) {
          return {
            user,
            organization: sRes.data.organization,
            membership: sRes.data.membership,
            token: session.access_token,
          };
        }
      } catch {
        /* fallback */
      }
    }

    // Platform admins and managers don't have organization membership - this is expected
    if (isPlatform) {
      console.log('[buildAuthSessionFromSupabase] Platform user authenticated (no organization membership required)');
    } else {
      console.warn('[buildAuthSessionFromSupabase] No membership found for user in Supabase');
    }
    
    // For organization_admin portal, user MUST have an org
    // Rather than failing login, we'll return the session and let the app handle it
    return {
      user,
      organization: organization || null,
      membership: null,
      token: session.access_token,
    };
  }

  return {
    user,
    organization,
    membership,
    token: session.access_token,
  };
}

export async function supabaseSignup(credentials: LoginCredentials & { 
  role?: 'platform_admin' | 'platform_manager' | 'organization_user';
  organizationName?: string;
  fullName?: string;
}): Promise<ServiceResponse<AuthSession>> {
  const emailNorm = credentials.email.trim().toLowerCase();

  try {
    const { isHttpBackendConfigured, apiPostJson } = await import('@/lib/apiClient');

    if (isHttpBackendConfigured()) {
      const body = {
        email: emailNorm,
        password: credentials.password,
        fullName: credentials.fullName || emailNorm.split('@')[0],
        role: credentials.role || 'organization_user',
        organizationName: credentials.organizationName,
      };

      const res = await apiPostJson<typeof body, AuthSession>('/auth/signup', body);

      if (!res.success) {
        if (res.error?.toLowerCase().includes('already registered') || res.error?.toLowerCase().includes('already exists')) {
          return { success: false, data: null as unknown as AuthSession, error: 'Email already registered. Try logging in instead.' };
        }
        return res;
      }

      if (res.data) {
        const sb = getSupabaseClient();
        if (sb) {
          const { data: signIn, error: signInErr } = await sb.auth.signInWithPassword({
            email: emailNorm,
            password: credentials.password,
          });
          if (!signInErr && signIn.session) {
            const session = await buildAuthSessionFromSupabase(signIn.session, credentials.orgSlug);
            return { success: true, data: session, message: 'Account created successfully!' };
          }
        }
        return { success: true, data: res.data, message: 'Account created successfully!' };
      }

      return { success: true, data: null as unknown as AuthSession, message: 'Account created successfully! You can now sign in.' };
    }

    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as unknown as AuthSession, error: 'Supabase client unavailable' };
    }

    const userMetadata: Record<string, any> = {
      platform_role: credentials.role || 'organization_user',
      full_name: credentials.fullName || credentials.email.split('@')[0],
    };

    if (credentials.organizationName) {
      userMetadata.organization_name = credentials.organizationName;
    }

    const { data, error } = await sb.auth.signUp({
      email: emailNorm,
      password: credentials.password,
      options: {
        data: userMetadata,
        emailRedirectTo: `${window.location.origin}`
      }
    });

    if (error) {
      if (error.message.includes('User already registered')) {
        return { success: false, data: null as unknown as AuthSession, error: 'Email already registered. Try logging in instead.' };
      }
      return { success: false, data: null as unknown as AuthSession, error: error.message };
    }
    
    if (data.session) {
      const session = await buildAuthSessionFromSupabase(data.session, credentials.orgSlug);
      return { success: true, data: session };
    }

    return { 
      success: true, 
      data: null as unknown as AuthSession, 
      message: 'Account created successfully! You can now sign in.' 
    };
  } catch (err) {
    console.error('Supabase signup error:', err);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup failed. Please try again.' };
  }
}

// Platform Admin specific signup (only allowed if NO platform admin exists yet)
export async function supabasePlatformSignup(credentials: LoginCredentials & { fullName?: string }): Promise<ServiceResponse<AuthSession>> {
  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { data: rpcExists, error: rpcErr } = await sb.rpc('has_platform_admin');
      if (!rpcErr && rpcExists === true) {
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'A platform admin account already exists. Signups are disabled. Please sign in.',
        };
      }
      const { count, error } = await sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('platform_role', 'platform_admin');
      if (!error && typeof count === 'number' && count > 0) {
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'A platform admin account already exists. Signups are disabled. Please sign in.',
        };
      }
    } catch {
      // proceed
    }
  }

  return supabaseSignup({
    ...credentials,
    role: 'platform_admin',
  });
}

// Organization Admin signup with organization creation
// Routes through the SERVER (/api/v1/auth/signup) which uses admin.createUser({ email_confirm: true })
// so the user can log in immediately without any email confirmation step.
export async function supabaseOrgAdminSignup(credentials: LoginCredentials & { 
  fullName?: string; 
  organizationName: string;
  organizationSlug?: string; // Optional — auto-generated from name if not provided
}): Promise<ServiceResponse<AuthSession>> {
  const emailNorm = credentials.email.trim().toLowerCase();

  try {
    // ── Route through the server (which has the service-role key and sets email_confirm: true) ──
    // This is the ONLY correct path — sb.auth.signUp() from the browser requires email confirmation
    // which is not deliverable on Supabase free tier and blocks login entirely.
    const { isHttpBackendConfigured, apiPostJson } = await import('@/lib/apiClient');

    if (isHttpBackendConfigured()) {
      const body = {
        email: emailNorm,
        password: credentials.password,
        fullName: credentials.fullName || emailNorm.split('@')[0],
        role: 'organization_user' as const,
        organizationName: credentials.organizationName,
        organizationSlug: credentials.organizationSlug,
      };

      const res = await apiPostJson<typeof body, AuthSession>('/auth/signup', body);

      if (!res.success) {
        // Normalize common server error messages
        if (res.error?.toLowerCase().includes('already registered') || res.error?.toLowerCase().includes('already exists')) {
          return { success: false, data: null as unknown as AuthSession, error: 'Email already registered. Try logging in instead.' };
        }
        return res;
      }

      // Server-created user is auto-confirmed — sign them into the browser session now
      if (res.data) {
        const sb = getSupabaseClient();
        if (sb) {
          const { data: signIn, error: signInErr } = await sb.auth.signInWithPassword({
            email: emailNorm,
            password: credentials.password,
          });
          if (!signInErr && signIn.session) {
            const session = await buildAuthSessionFromSupabase(signIn.session);
            return { success: true, data: session, message: 'Organization created successfully!' };
          }
        }
        // Return server session even if browser sign-in failed
        return { success: true, data: res.data, message: 'Organization created successfully!' };
      }

      return { success: true, data: null as unknown as AuthSession, message: 'Organization created successfully! You can now log in.' };
    }

    // ── Fallback: direct Supabase signup (only when server is not running) ──
    // This path requires email confirmation — the UI handles CONFIRM_EMAIL_REQUIRED.
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as unknown as AuthSession, error: 'Supabase client unavailable' };
    }

    const orgSlug = credentials.organizationSlug?.trim() 
      || credentials.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check org name uniqueness before creating user
    const { data: existingOrgByName } = await sb
      .from('organizations')
      .select('id, name')
      .ilike('name', credentials.organizationName.trim())
      .maybeSingle();

    if (existingOrgByName) {
      return { 
        success: false, 
        data: null as unknown as AuthSession, 
        error: `Organization name "${credentials.organizationName.trim()}" is already registered. Please choose a different name.` 
      };
    }

    const { data: existingOrg } = await sb
      .from('organizations')
      .select('id')
      .eq('slug', orgSlug)
      .maybeSingle();
    
    if (existingOrg) {
      return { success: false, data: null as unknown as AuthSession, error: `Organization URL "${orgSlug}" is already taken. Please choose a different slug.` };
    }

    const orgId = `org-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { data: authData, error: authError } = await sb.auth.signUp({
      email: emailNorm,
      password: credentials.password,
      options: {
        data: {
          platform_role: 'organization_user',
          full_name: credentials.fullName || emailNorm.split('@')[0],
        },
        emailRedirectTo: `${window.location.origin}`
      }
    });

    if (authError) {
      if (authError.message.includes('User already registered')) {
        return { success: false, data: null as unknown as AuthSession, error: 'Email already registered. Try logging in instead.' };
      }
      return { success: false, data: null as unknown as AuthSession, error: authError.message };
    }

    if (!authData.user) {
      return { success: false, data: null as unknown as AuthSession, error: 'Failed to create user' };
    }

    const { data: funcResult, error: funcError } = await sb.rpc('create_organization_with_owner', {
      p_org_id: orgId,
      p_org_name: credentials.organizationName,
      p_org_slug: orgSlug,
      p_user_id: authData.user.id,
      p_currency: 'USD',
      p_fiscal_year_start: '01-01'
    });

    if (funcError) {
      return { success: false, data: null as unknown as AuthSession, error: 'Failed to create organization: ' + funcError.message };
    }

    const result = funcResult as { success: boolean; error?: string };
    if (!result.success) {
      return { success: false, data: null as unknown as AuthSession, error: 'Failed to create organization: ' + (result.error || 'Unknown error') };
    }

    if (authData.session) {
      const session = await buildAuthSessionFromSupabase(authData.session);
      return { success: true, data: session, message: 'Organization created successfully!' };
    }

    // Email confirmation required (fallback path only)
    return {
      success: true,
      data: null as unknown as AuthSession,
      message: 'CONFIRM_EMAIL_REQUIRED',
    };
  } catch (err) {
    console.error('Supabase org admin signup error:', err);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup failed. Please try again.' };
  }
}


// Employee signup
export async function supabaseEmployeeSignup(credentials: LoginCredentials & { 
  fullName?: string; 
  orgSlug?: string;
}): Promise<ServiceResponse<AuthSession>> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { success: false, data: null as unknown as AuthSession, error: 'Supabase client unavailable' };
  }

  const emailNorm = credentials.email.trim().toLowerCase();
  
  try {
    // Step 1: Sign up the user with Supabase Auth
    const { data: authData, error: authError } = await sb.auth.signUp({
      email: emailNorm,
      password: credentials.password,
      options: {
        data: {
          platform_role: 'organization_user',
          full_name: credentials.fullName || emailNorm.split('@')[0],
        },
        emailRedirectTo: `${window.location.origin}`
      }
    });

    if (authError) {
      if (authError.message.includes('User already registered')) {
        return { success: false, data: null as unknown as AuthSession, error: 'Email already registered. Try logging in instead.' };
      }
      return { success: false, data: null as unknown as AuthSession, error: authError.message };
    }

    if (!authData.user) {
      return { success: false, data: null as unknown as AuthSession, error: 'Failed to create user' };
    }

    // Step 2: Create employee membership using SECURITY DEFINER function
    // This bypasses RLS and properly checks if org exists
    if (credentials.orgSlug) {
      const { data: funcResult, error: funcError } = await sb.rpc('create_employee_membership', {
        p_user_id: authData.user.id,
        p_org_slug: credentials.orgSlug.toLowerCase().trim()
      });

      if (funcError) {
        console.error('Failed to create membership:', funcError);
        return { success: false, data: null as unknown as AuthSession, error: 'Failed to join organization: ' + funcError.message };
      }

      // Check if function returned success
      const result = funcResult as { success: boolean; error?: string; organization_id?: string };
      if (!result.success) {
        console.error('Function returned error:', result.error);
        return { success: false, data: null as unknown as AuthSession, error: result.error || 'Failed to join organization' };
      }

      console.log('Employee membership created successfully:', result);
    }

    // Step 3: If session available, build auth session
    if (authData.session) {
      const session = await buildAuthSessionFromSupabase(authData.session, credentials.orgSlug);
      return { success: true, data: session, message: 'Employee account created successfully!' };
    }

    // Email confirmation required
    return { 
      success: true, 
      data: null as unknown as AuthSession, 
      message: 'Please check your email for verification link' 
    };
  } catch (err) {
    console.error('Supabase employee signup error:', err);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup failed. Please try again.' };
  }
}

export async function supabaseResendConfirmation(email: string): Promise<ServiceResponse<null>> {
  const sb = getSupabaseClient();
  if (!sb) return { success: false, data: null, error: 'Supabase client unavailable' };
  const { error } = await sb.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
  if (error) return { success: false, data: null, error: error.message };
  return { success: true, data: null, message: 'Confirmation email sent! Please check your inbox.' };
}

export async function supabaseLogin(credentials: LoginCredentials): Promise<ServiceResponse<AuthSession>> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { success: false, data: null as unknown as AuthSession, error: 'Supabase client unavailable' };
  }

  const emailNorm = credentials.email.trim().toLowerCase();
  const { data, error } = await sb.auth.signInWithPassword({
    email: emailNorm,
    password: credentials.password,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    // Only flag as "email not confirmed" when Supabase explicitly says so.
    // Do NOT include "invalid login credentials" here — that error also fires
    // for wrong passwords, and mapping it to EMAIL_NOT_CONFIRMED misleads users
    // whose email IS confirmed but whose password is wrong.
    if (msg.includes('email not confirmed')) {
      return {
        success: false,
        data: null as unknown as AuthSession,
        error: 'EMAIL_NOT_CONFIRMED',
      };
    }
    return { success: false, data: null as unknown as AuthSession, error: error.message };
  }
  if (!data.session) {
    return { success: false, data: null as unknown as AuthSession, error: 'No session returned' };
  }

  // Build auth session with membership data
  let session = await buildAuthSessionFromSupabase(data.session, credentials.orgSlug, credentials.portalType);
  
  // ── Auto-fix: Ensure user has organization ──────────────────────────────
  // If no membership found, try to auto-create organization for user
  if (!session.membership && !session.organization && credentials.portalType !== 'platform_admin') {
    try {
      console.log('[supabaseLogin] No membership found, attempting auto-fix...');
      const { data: fixResult, error: fixError } = await sb.rpc('ensure_user_has_organization', {
        p_user_id: data.session.user.id
      });
      
      if (!fixError && fixResult?.success) {
        console.log('[supabaseLogin] Auto-fix successful, rebuilding session...');
        // Rebuild session after organization was created
        session = await buildAuthSessionFromSupabase(data.session, credentials.orgSlug, credentials.portalType);
      } else {
        console.warn('[supabaseLogin] Auto-fix failed:', fixError?.message || fixResult?.error);
      }
    } catch (autoFixErr) {
      console.error('[supabaseLogin] Auto-fix exception:', autoFixErr);
      // Continue with login even if auto-fix fails
    }
  }
  
  // ── Portal Type Validation ──────────────────────────────────────────────
  // Ensure users can only log in through their designated portal type
  const portalType = credentials.portalType;
  if (portalType && session.user) {
    const user = session.user;
    const membership = session.membership;
    const isPlatform = user.role === 'platform_admin' || user.role === 'platform_manager';

    if (portalType === 'platform_admin') {
      // Platform portal: only platform_admin and platform_manager allowed
      if (!isPlatform) {
        await sb.auth.signOut(); // Sign out the invalid session
        return { success: false, data: null as unknown as AuthSession, error: 'No platform admin account found with this email' };
      }
    } else if (portalType === 'organization_admin') {
      // Organization portal: user must belong to an organization
      if (!membership && !session.organization) {
        console.error('No membership or organization found for user during org dashboard login');
        await sb.auth.signOut();
        return { success: false, data: null as unknown as AuthSession, error: 'You are not a member of any organization. Please contact your organization administrator.' };
      }
    } else if (portalType === 'employee') {
      // Employee portal: must have employee or viewer role in an organization
      if (!membership) {
        console.error('No membership found for user during employee login');
        await sb.auth.signOut();
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'You are not invited by any organization. Please contact your organization administrator for an invitation.',
        };
      }
      if (membership.role !== 'employee') {
        await sb.auth.signOut();
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'No employee account found with this email. If you are an administrator, please use the Organization Admin portal.',
        };
      }
    } else if (portalType === 'ai_assistant') {
      // AI Assistant / Bing portal: ONLY platform admin and platform manager allowed
      if (!isPlatform) {
        await sb.auth.signOut();
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'Access restricted: Only Platform Administrators are authorized to access the Bing AI portal.',
        };
      }
    }
  }

  // ── Granular Access Role Validation ──────────────────────────────────
  // When logging in through Organization Dashboard with a specific role selected
  if (credentials.requiredAccessRole && session.user) {
    const user = session.user;
    const isPlatform = user.role === 'platform_admin' || user.role === 'platform_manager';
    if (isPlatform) {
      // Platform admins have full administrative control across all dashboards
      return { success: true, data: session };
    }

    const membership = session.membership;
    if (!membership) {
      console.error('No membership found for user during role validation');
      await sb.auth.signOut();
      return {
        success: false,
        data: null as unknown as AuthSession,
        error: 'You are not a member of this organization. Please contact your organization administrator.',
      };
    }

    // Determine the user's actual access role
    let actualRole: MemberAccessRole = 'team_member';
    if (membership.role === 'owner' || membership.role === 'admin' || membership.accessRole === 'org_admin') {
      actualRole = 'org_admin';
    } else if (membership.accessRole && ['accountant', 'team_member', 'viewer'].includes(membership.accessRole)) {
      actualRole = membership.accessRole;
    } else if ((membership.role as string) === 'viewer') {
      actualRole = 'viewer';
    }

    // Role enforcement:
    // If the user is an owner or admin, they hold all sub-role permissions
    const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin' || actualRole === 'org_admin';

    if (actualRole !== credentials.requiredAccessRole && !isOwnerOrAdmin) {
      await sb.auth.signOut();
      const roleLabels: Record<MemberAccessRole, string> = {
        org_admin: 'Organization Admin',
        accountant: 'Accountant',
        team_member: 'Team Member',
        viewer: 'Viewer',
      };
      const targetLabel = roleLabels[credentials.requiredAccessRole] || credentials.requiredAccessRole;
      const actualLabel = roleLabels[actualRole] || actualRole;
      const orgName = session.organization?.name || 'this organization';

      return {
        success: false,
        data: null as unknown as AuthSession,
        error: `Role Mismatch: You selected "${targetLabel}", but your registered role in ${orgName} is "${actualLabel}". Please select the "${actualLabel}" option to sign in.`,
      };
    }
  }

  return { success: true, data: session };
}

export async function supabaseResetPassword(email: string, redirectTo?: string): Promise<ServiceResponse<null>> {
  const sb = getSupabaseClient();
  if (!sb) return { success: false, data: null, error: 'Supabase client unavailable' };
  const targetRedirect = redirectTo || `${window.location.origin}/reset-password`;
  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: targetRedirect,
  });
  if (error) return { success: false, data: null, error: error.message };
  return { success: true, data: null, message: 'Password reset link sent to your email.' };
}

export async function supabaseLogout(): Promise<ServiceResponse<null>> {
  const sb = getSupabaseClient();
  if (!sb) return { success: true, data: null };
  const { error } = await sb.auth.signOut();
  if (error) return { success: false, data: null, error: error.message };
  return { success: true, data: null, message: 'Logged out' };
}

export async function supabaseGetSession(): Promise<ServiceResponse<AuthSession | null>> {
  const sb = getSupabaseClient();
  if (!sb) {
    return { success: false, data: null, error: 'Supabase client unavailable' };
  }

  const {
    data: { session },
    error,
  } = await sb.auth.getSession();
  if (error) {
    return { success: false, data: null, error: error.message };
  }
  if (!session) {
    return { success: true, data: null };
  }

  const mapped = await buildAuthSessionFromSupabase(session);
  return { success: true, data: mapped };
}

export async function supabaseGetUserOrganizations(userId: string): Promise<ServiceResponse<Organization[]>> {
  const sb = getSupabaseClient();
  if (!sb) return { success: true, data: [] };

  // Query member rows directly without nested join to prevent PostgREST RLS circular recursion
  const { data: memberRows, error: memberErr } = await sb
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId);

  if (memberErr || !memberRows?.length) {
    return { success: true, data: [] };
  }

  const orgIds = [...new Set(memberRows.map((r: any) => r.organization_id).filter(Boolean))];
  if (orgIds.length === 0) return { success: true, data: [] };

  const { data: orgData, error: orgErr } = await sb
    .from('organizations')
    .select('*')
    .in('id', orgIds);

  if (orgErr || !orgData?.length) {
    return { success: true, data: [] };
  }

  const orgs: Organization[] = orgData.map((o: any) => mapOrgRow(o as Record<string, unknown>));
  return { success: true, data: orgs };
}

export async function supabaseGetUserRole(
  userId: string,
  organizationId: string,
): Promise<ServiceResponse<OrganizationMember | null>> {
  const sb = getSupabaseClient();
  if (!sb) return { success: true, data: null };

  const { data, error } = await sb
    .from('organization_members')
    .select('role, joined_at')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error || !data) {
    return { success: true, data: null };
  }

  const row = data as { role: string; joined_at?: string };
  return {
    success: true,
    data: {
      userId,
      organizationId,
      role: row.role as OrganizationMember['role'],
      joinedAt: row.joined_at ?? new Date().toISOString(),
    },
  };
}
