/**
 * Authentication Service
 * =======================
 * Handles login, logout, session management, and role verification.
 *
 * MIGRATION: Replace method bodies with real auth API calls (JWT, OAuth, etc.)
 * The function signatures and return types stay the same.
 */

import { User, OrganizationMember, Organization, ActiveSession } from '@/services/types';
import { DEMO_AUTH_PASSWORD } from '@/data/mockDatabase';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { isSupabaseConfigured, getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';
import type { AuthSession, LoginCredentials } from './authSessionTypes';
import {
  supabaseGetSession,
  supabaseGetUserOrganizations,
  supabaseGetUserRole,
  supabaseLogin,
  supabaseLogout,
  supabaseSignup,
  supabasePlatformSignup,
  supabaseOrgAdminSignup,
  supabaseEmployeeSignup,
  supabaseResetPassword,
  supabaseResendConfirmation,
} from './supabaseAuth';

export type { AuthSession, LoginCredentials } from './authSessionTypes';

/** Prefer employee membership when present so session + redirect match FLOW demos. */
function primaryMembershipForUser(userId: string): OrganizationMember | null {
  const memberships = dataStore.organizationMembers.filter(m => m.userId === userId);
  return memberships.find(m => m.role === 'employee') ?? memberships[0] ?? null;
}

export const authService = {
  /**
   * Resend email confirmation link (for users who signed up but didn't confirm yet)
   */
  async resendConfirmation(email: string): Promise<ServiceResponse<null>> {
    if (isSupabaseConfigured()) {
      return supabaseResendConfirmation(email);
    }
    return { success: true, data: null, message: 'Confirmation email sent (demo mode).' };
  },

  /**
   * Send password reset email
   */
  async resetPassword(email: string, redirectTo?: string): Promise<ServiceResponse<null>> {
    if (isSupabaseConfigured()) {
      return supabaseResetPassword(email, redirectTo);
    }
    await simulateDelay(300);
    return { success: true, data: null, message: 'Password reset instructions sent (demo mode).' };
  },

  /**
   * Register new user account
   */
  async signup(credentials: LoginCredentials): Promise<ServiceResponse<AuthSession>> {
    if (isSupabaseConfigured()) {
      return supabaseSignup(credentials);
    }

    if (isHttpBackendConfigured()) {
      return apiPostJson<LoginCredentials, AuthSession>('/auth/signup', credentials);
    }

    // Mock mode signup
    await simulateDelay(300);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup only available with Supabase or HTTP backend' };
  },

  /**
   * Checks if at least one platform admin account already exists in the system.
   */
  async hasExistingPlatformAdmin(): Promise<boolean> {
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiGet<{ exists: boolean }>('/auth/has-platform-admin');
        if (res.success && res.data && typeof res.data.exists === 'boolean') {
          return res.data.exists;
        }
      } catch {
        /* fallback */
      }
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          // Try RPC first (bypasses RLS safely for anon visitors)
          const { data: rpcData, error: rpcErr } = await sb.rpc('has_platform_admin');
          if (!rpcErr && typeof rpcData === 'boolean') {
            return rpcData;
          }

          const { count, error } = await sb
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('platform_role', 'platform_admin');
          if (!error && typeof count === 'number') {
            return count > 0;
          }
        } catch {
          /* ignore */
        }
      }
    }
    return dataStore.users.some(u => u.role === 'platform_admin');
  },

  /**
   * Register platform admin account (only allowed if none exists)
   */
  async signupPlatformAdmin(credentials: LoginCredentials & { fullName?: string }): Promise<ServiceResponse<AuthSession>> {
    const exists = await this.hasExistingPlatformAdmin();
    if (exists) {
      return {
        success: false,
        data: null as unknown as AuthSession,
        error: 'A platform admin account already exists. Signups are disabled. Please sign in.',
      };
    }

    if (isSupabaseConfigured()) {
      return supabasePlatformSignup(credentials);
    }
    
    if (isHttpBackendConfigured()) {
      const body = { ...credentials, role: 'platform_admin' };
      return apiPostJson<typeof body, AuthSession>('/auth/signup', body);
    }

    await simulateDelay(300);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup only available with Supabase or HTTP backend' };
  },

  /**
   * Register organization admin with organization creation
   */
  async signupOrgAdmin(credentials: LoginCredentials & { 
    fullName?: string; 
    organizationName: string;
    organizationSlug?: string; // Optional — auto-generated from name if not provided
  }): Promise<ServiceResponse<AuthSession>> {
    if (isSupabaseConfigured()) {
      return supabaseOrgAdminSignup(credentials);
    }
    
    if (isHttpBackendConfigured()) {
      const body = { ...credentials, role: 'organization_user' as const };
      return apiPostJson<typeof body, AuthSession>('/auth/signup', body);
    }

    await simulateDelay(300);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup only available with Supabase or HTTP backend' };
  },

  /**
   * Register employee account
   */
  async signupEmployee(credentials: LoginCredentials & { 
    fullName?: string; 
    orgSlug?: string;
  }): Promise<ServiceResponse<AuthSession>> {
    if (isSupabaseConfigured()) {
      return supabaseEmployeeSignup(credentials);
    }
    
    if (isHttpBackendConfigured()) {
      const body = { ...credentials, role: 'organization_user' as const };
      return apiPostJson<typeof body, AuthSession>('/auth/signup', body);
    }

    await simulateDelay(300);
    return { success: false, data: null as unknown as AuthSession, error: 'Signup only available with Supabase or HTTP backend' };
  },

  /**
   * Authenticate user with email/password
   * TODO: Replace with POST /api/auth/login
   */
  async login(credentials: LoginCredentials): Promise<ServiceResponse<AuthSession>> {
    if (isSupabaseConfigured()) {
      return supabaseLogin(credentials);
    }

    const emailNorm = credentials.email.trim().toLowerCase();
    const slugNorm = credentials.orgSlug?.trim().toLowerCase() ?? '';

    if (isHttpBackendConfigured()) {
      // portalType & requiredAccessRole forwarded: server enforces portal routing and access role
      const body: LoginCredentials = {
        email: emailNorm,
        password: credentials.password,
        ...(slugNorm ? { orgSlug: slugNorm } : {}),
        ...(credentials.portalType ? { portalType: credentials.portalType } : {}),
        ...(credentials.requiredAccessRole ? { requiredAccessRole: credentials.requiredAccessRole } : {}),
      };
      return apiPostJson<LoginCredentials, AuthSession>('/auth/login', body);
    }

    await simulateDelay(300);

    if (credentials.password !== DEMO_AUTH_PASSWORD) {
      return { success: false, data: null as unknown as AuthSession, error: 'Invalid email or password' };
    }

    const user = dataStore.users.find(u => u.email.toLowerCase() === emailNorm);
    if (!user) {
      return { success: false, data: null as unknown as AuthSession, error: 'Invalid email or password' };
    }

    const isPlatform = user.role === 'platform_admin' || user.role === 'platform_manager';

    // ── Portal Type Validation (Mock Mode) ─────────────────────────────────
    const portalType = credentials.portalType;
    if (portalType) {
      if (portalType === 'platform_admin') {
        // Platform portal: only platform_admin and platform_manager allowed
        if (!isPlatform) {
          return { success: false, data: null as unknown as AuthSession, error: 'No platform admin account found with this email' };
        }
      } else if (portalType === 'organization_admin') {
        // Organization admin portal: must be org owner or admin
        let adminMemberships = dataStore.organizationMembers.filter(
          m => m.userId === user.id && (m.role === 'owner' || m.role === 'admin')
        );
        if (adminMemberships.length === 0) {
          const defaultOrg = dataStore.organizations[0];
          if (defaultOrg) {
            const newMem: OrganizationMember = {
              userId: user.id,
              organizationId: defaultOrg.id,
              role: 'owner',
              portalType: 'organization_admin',
              status: 'active',
              joinedAt: new Date().toISOString(),
            };
            dataStore.organizationMembers.push(newMem);
            dataStore.notify('organizationMembers');
            adminMemberships = [newMem];
          }
        }
        if (adminMemberships.length === 0) {
          return { success: false, data: null as unknown as AuthSession, error: 'No organization admin account found with this email' };
        }
      } else if (portalType === 'employee') {
        // Employee portal: must have employee role in an organization
        const employeeMemberships = dataStore.organizationMembers.filter(
          m => m.userId === user.id && m.role === 'employee'
        );
        if (employeeMemberships.length === 0) {
          return { success: false, data: null as unknown as AuthSession, error: 'No employee account found with this email' };
        }
      } else if (portalType === 'ai_assistant') {
        // AI Assistant / Bing portal: ONLY platform admin and platform manager allowed
        if (!isPlatform) {
          return {
            success: false,
            data: null as unknown as AuthSession,
            error: 'Access restricted: Only Platform Administrators are authorized to access the Bing AI portal.',
          };
        }
      }
    }

    if (slugNorm) {
      const orgMatch = dataStore.organizations.find(
        o => (o.slug || '').toLowerCase() === slugNorm,
      );
      if (!orgMatch) {
        return { success: false, data: null as unknown as AuthSession, error: 'Workspace not found' };
      }
      if (isPlatform) {
        return {
          success: true,
          data: {
            user,
            organization: orgMatch,
            membership: null,
            token: `mock-token-${user.id}-${Date.now()}`,
          },
        };
      }
      const mem = dataStore.organizationMembers.find(
        m => m.userId === user.id && m.organizationId === orgMatch.id,
      );
      if (!mem) {
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'No access to this workspace',
        };
      }
      
      // Additional portal type check with org slug
      if (portalType === 'employee' && mem.role !== 'employee') {
        return { success: false, data: null as unknown as AuthSession, error: 'No employee account found in this workspace' };
      }
      if (portalType === 'organization_admin' && mem.role !== 'owner' && mem.role !== 'admin') {
        return { success: false, data: null as unknown as AuthSession, error: 'No admin account found in this workspace' };
      }
      
      return {
        success: true,
        data: {
          user,
          organization: orgMatch,
          membership: mem,
          token: `mock-token-${user.id}-${Date.now()}`,
        },
      };
    }

    const membership = primaryMembershipForUser(user.id);
    const org = membership
      ? dataStore.organizations.find(o => o.id === membership.organizationId) || null
      : isPlatform
        ? dataStore.organizations[0] || null
        : null;

    if (credentials.requiredAccessRole) {
      if (!membership) {
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: 'You are not a member of any organization. Please contact your administrator.',
        };
      }
      const actualRole =
        membership.role === 'owner' || membership.role === 'admin' || (membership as any).accessRole === 'org_admin'
          ? 'org_admin'
          : (membership as any).accessRole || 'team_member';

      if (actualRole !== credentials.requiredAccessRole) {
        const roleLabels: Record<string, string> = {
          org_admin: 'Organization Admin',
          accountant: 'Accountant',
          team_member: 'Team Member',
          viewer: 'Viewer',
        };
        const targetLabel = roleLabels[credentials.requiredAccessRole] || credentials.requiredAccessRole;
        const actualLabel = roleLabels[actualRole] || actualRole;
        const orgName = org?.name || 'this organization';
        return {
          success: false,
          data: null as unknown as AuthSession,
          error: `Role Mismatch: You selected "${targetLabel}", but your registered role in ${orgName} is "${actualLabel}". Please select the "${actualLabel}" option to sign in.`,
        };
      }
    }

    return {
      success: true,
      data: {
        user,
        organization: org,
        membership,
        token: `mock-token-${user.id}-${Date.now()}`,
      },
    };
  },

  /**
   * End user session
   * TODO: Replace with POST /api/auth/logout
   */
  async logout(): Promise<ServiceResponse<null>> {
    if (isSupabaseConfigured()) {
      return supabaseLogout();
    }
    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, null>('/auth/logout', {});
    }
    await simulateDelay(100);
    return { success: true, data: null, message: 'Logged out' };
  },

  /**
   * Get current session (e.g., on page refresh)
   * TODO: Replace with GET /api/auth/session (validate JWT)
   */
  async getSession(token: string): Promise<ServiceResponse<AuthSession | null>> {
    if (isSupabaseConfigured()) {
      void token;
      return supabaseGetSession();
    }
    if (isHttpBackendConfigured()) {
      return apiGet<AuthSession | null>('/auth/session', { token });
    }

    await simulateDelay(100);

    // In mock mode, parse the user ID from the token
    const match = token.match(/mock-token-([\w-]+)-/);
    if (!match) {
      return { success: false, data: null, error: 'Invalid token' };
    }

    const userId = match[1];
    const user = dataStore.users.find(u => u.id === userId);
    if (!user) {
      return { success: false, data: null, error: 'User not found' };
    }

    const membership = primaryMembershipForUser(user.id);
    const org = membership
      ? dataStore.organizations.find(o => o.id === membership.organizationId) || null
      : user.role === 'platform_admin' || user.role === 'platform_manager'
        ? dataStore.organizations[0] || null
        : null;

    return {
      success: true,
      data: { user, organization: org, membership, token },
    };
  },

  /**
   * Get all organizations a user belongs to
   * TODO: Replace with GET /api/users/:userId/organizations
   */
  async getUserOrganizations(userId: string): Promise<ServiceResponse<Organization[]>> {
    if (isSupabaseConfigured()) {
      return supabaseGetUserOrganizations(userId);
    }
    if (isHttpBackendConfigured()) {
      return apiGet<Organization[]>(`/users/${encodeURIComponent(userId)}/organizations`);
    }

    await simulateDelay();

    const membershipOrgIds = dataStore.organizationMembers
      .filter(m => m.userId === userId)
      .map(m => m.organizationId);

    const orgs = dataStore.organizations.filter(o => membershipOrgIds.includes(o.id));
    return { success: true, data: orgs };
  },

  /**
   * Get user's role in a specific organization
   * TODO: Replace with GET /api/organizations/:orgId/members/:userId
   */
  async getUserRole(userId: string, organizationId: string): Promise<ServiceResponse<OrganizationMember | null>> {
    if (isSupabaseConfigured()) {
      return supabaseGetUserRole(userId, organizationId);
    }
    if (isHttpBackendConfigured()) {
      const q = `userId=${encodeURIComponent(userId)}`;
      return apiGet<OrganizationMember | null>(
        `/organizations/${encodeURIComponent(organizationId)}/membership?${q}`,
      );
    }

    await simulateDelay(50);

    const membership = dataStore.organizationMembers.find(
      m => m.userId === userId && m.organizationId === organizationId
    );

    return { success: true, data: membership || null };
  },

  /**
   * Check if user has specific permission
   */
  hasPermission(role: string | null, requiredLevel: 'read' | 'write' | 'admin'): boolean {
    if (!role) return false;
    const hierarchy: Record<string, number> = { owner: 4, admin: 3, viewer: 2, employee: 1 };
    const levels: Record<string, number> = { read: 1, write: 2, admin: 3 };
    return (hierarchy[role] || 0) >= (levels[requiredLevel] || 0);
  },

  /**
   * Determine redirect path based on user role
   */
  getRedirectPath(user: User): string {
    const membership = primaryMembershipForUser(user.id);
    if (membership?.role === 'employee' || membership?.portalType === 'employee') {
      return '/employee';
    }
    if (user.role === 'platform_admin' || user.role === 'platform_manager') {
      return '/platform';
    }
    return '/dashboard';
  },

  // ── Session Management (Phase 9C) ──────────────────────────────────────────

  /**
   * Get all active sessions for a user
   * TODO: Replace with GET /api/users/:userId/sessions
   */
  async getActiveSessions(userId: string): Promise<ServiceResponse<ActiveSession[]>> {
    if (isHttpBackendConfigured()) {
      const res = await apiGet<any[]>(`/users/${encodeURIComponent(userId)}/sessions`);
      if (res.success && Array.isArray(res.data)) {
        return {
          success: true,
          data: res.data.map((row: any) => ({
            id: row.id,
            userId: row.user_id || row.userId || userId,
            userName: row.user_name || row.userName || '',
            userEmail: row.user_email || row.userEmail || '',
            organizationId: row.organization_id || row.organizationId || '',
            deviceType: row.device_type || row.deviceType || 'Desktop',
            browser: row.browser || 'Chrome on Windows',
            ipAddress: row.ip_address || row.ipAddress || '127.0.0.1',
            location: row.location || 'Local / Office',
            loginTime: row.login_time || row.loginTime || new Date().toISOString(),
            lastActivity: row.last_activity || row.lastActivity || new Date().toISOString(),
            isCurrentSession: Boolean(row.is_current_session ?? row.isCurrentSession ?? true),
          })),
        };
      }
      return res as ServiceResponse<ActiveSession[]>;
    }

    await simulateDelay();
    const sessions = dataStore.activeSessions.filter(s => s.userId === userId);
    return { success: true, data: sessions };
  },

  /**
   * End (revoke) a specific session
   * TODO: Replace with DELETE /api/sessions/:sessionId
   */
  async endSession(sessionId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    }

    await simulateDelay(150);
    const idx = dataStore.activeSessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return { success: false, data: null, error: 'Session not found' };

    const session = dataStore.activeSessions[idx];
    if (session.isCurrentSession) {
      return { success: false, data: null, error: 'Cannot end your current session' };
    }

    dataStore.activeSessions.splice(idx, 1);
    return { success: true, data: null, message: 'Session ended successfully' };
  },

  /**
   * End all sessions except the current one
   * TODO: Replace with DELETE /api/users/:userId/sessions?keepCurrent=true
   */
  async endAllOtherSessions(userId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, null>(
        `/users/${encodeURIComponent(userId)}/sessions/end-others`,
        {},
      );
    }

    await simulateDelay(200);
    const before = dataStore.activeSessions.length;
    const kept = dataStore.activeSessions.filter(
      s => s.userId !== userId || s.isCurrentSession
    );
    dataStore.activeSessions.length = 0;
    dataStore.activeSessions.push(...kept);
    const ended = before - kept.length;
    return { success: true, data: null, message: `${ended} session(s) ended` };
  },

  /**
   * Get 30-day login and logout session history for a user
   */
  async getSessionHistory(userId: string): Promise<ServiceResponse<Array<{
    id: string;
    action: string;
    device: string;
    location: string;
    time: string;
    status: 'success' | 'failed';
  }>>> {
    if (isHttpBackendConfigured()) {
      return apiGet<Array<{
        id: string;
        action: string;
        device: string;
        location: string;
        time: string;
        status: 'success' | 'failed';
      }>>(`/users/${encodeURIComponent(userId)}/session-history`);
    }

    await simulateDelay(150);
    return {
      success: true,
      data: [
        { id: '1', action: 'Login', device: 'Current Browser', location: 'Local Session', time: new Date().toISOString(), status: 'success' },
      ],
    };
  },

  /**
   * Set up password for an invited employee account.
   *
   * Always goes through the server's `/auth/employee-setup-password`, which
   * verifies the invitation exists, sets the Supabase password via the
   * service-role Admin API, and flips the membership to `active`.
   *
   * The removed local fallback fabricated a `dataStore` user + membership for ANY
   * email and handed back a `demo-token` session, which is exactly how uninvited
   * addresses could "activate" an account and get into the employee portal.
   */
  async setupEmployeePassword(params: {
    email: string;
    password: string;
    name?: string;
    orgSlug?: string;
  }): Promise<ServiceResponse<AuthSession>> {
    const trimmedEmail = params.email.trim().toLowerCase();

    const res = await apiPostJson<typeof params, AuthSession>(
      '/auth/employee-setup-password',
      { ...params, email: trimmedEmail },
    );

    if (res.success && res.data) {
      // Sign in through the Supabase client so the session cookie/refresh token
      // is established for the browser.
      const sb = getSupabaseClient();
      if (sb) {
        try {
          await sb.auth.signInWithPassword({
            email: trimmedEmail,
            password: params.password,
          });
        } catch (sbErr) {
          console.warn('[authService] Supabase client signIn after setup:', sbErr);
        }
      }
      return res;
    }

    if (res.error?.includes('HTTP backend not configured')) {
      return {
        success: false,
        data: null as unknown as AuthSession,
        error: 'Cannot activate your account right now: the activation service is unreachable.',
      };
    }
    return res;
  },

  /**
   * Check if an email has received an invitation to join any organization.
   *
   * Delegates to the server's `/auth/check-invite-status` route, which queries
   * Supabase with the **service-role** key. This is required, not a convenience:
   * on the login screen nobody is signed in yet, so RLS on `organization_members`
   * and `profiles` returns zero rows to the browser's anon client. Querying
   * Supabase directly from here returned `isInvited: false` for every address —
   * which is what told invited employees they had "not been invited".
   *
   * The server reads only Supabase; it no longer consults the local seed store.
   */
  async checkInviteStatus(email: string): Promise<{ isInvited: boolean; organizationName?: string; status?: string }> {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) return { isInvited: false };

    try {
      const res = await apiPostJson<{ email: string }, { isInvited: boolean; organizationName?: string; status?: string }>(
        '/auth/check-invite-status',
        { email: trimmed },
      );
      if (res.success && res.data) return res.data;
      console.warn('[authService.checkInviteStatus] lookup failed:', res.error);
    } catch (e) {
      console.warn('[authService.checkInviteStatus] request failed:', e);
    }
    return { isInvited: false };
  },

  /**
   * Accept an organization invitation
   */
  async acceptInvite(organizationId: string, userId: string): Promise<ServiceResponse<OrganizationMember>> {
    // Supabase is authoritative. The previous version still wrote the local
    // `dataStore` and then returned `success: true` from it when the server call
    // failed, so a declined or broken accept could look like it had worked.
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as any, error: 'Supabase is not configured' };
    }

    const { data, error } = await sb
      .from('organization_members')
      .update({ status: 'active' })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.warn('[authService.acceptInvite] Supabase update failed:', error.message);
      return { success: false, data: null as any, error: error.message };
    }
    if (!data) {
      return { success: false, data: null as any, error: 'No pending invitation found for this account' };
    }

    const member: OrganizationMember = {
      userId: data.user_id,
      organizationId: data.organization_id,
      role: data.role,
      portalType: data.portal_type,
      status: 'active',
      department: data.department,
      joinedAt: data.joined_at,
    };
    return { success: true, data: member, message: 'Invitation accepted! You have joined the team.' };
  },

  /**
   * Decline / reject an organization invitation
   */
  async declineInvite(organizationId: string, userId: string): Promise<ServiceResponse<null>> {
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null, error: 'Supabase is not configured' };
    }

    const { error } = await sb
      .from('organization_members')
      .update({ status: 'rejected' })
      .eq('organization_id', organizationId)
      .eq('user_id', userId);

    if (error) {
      console.warn('[authService.declineInvite] Supabase update failed:', error.message);
      return { success: false, data: null, error: error.message };
    }
    return { success: true, data: null, message: 'Invitation declined' };
  },

  /**
   * Resend an organization invitation email
   */
  async resendInvite(organizationId: string, userId: string): Promise<ServiceResponse<{ previewUrl?: string }>> {
    return apiPostJson<Record<string, never>, { previewUrl?: string }>(
      `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}/resend-invite`,
      {},
    );
  },
};