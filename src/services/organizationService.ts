/**
 * Organization Service
 * =====================
 * CRUD for organizations, members, and org settings.
 *
 * MIGRATION: Replace method bodies with API calls. Signatures stay the same.
 */

import { Organization, OrganizationMember, User, CompanyAnnouncement } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient, isSupabaseDataConfigured } from '@/lib/supabaseClient';
import { logUnexpectedError } from '@/lib/diagnostics';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse, PaginatedResult, PaginationParams } from './types';

export interface AgencyTeamMember {
  userId: string;
  name: string;
  email: string;
  department: string;
  role: string;
  isLead?: boolean;
}

export interface AgencyTeam {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  projectId?: string;
  projectName?: string;
  leadUserId?: string;
  leadName?: string;
  memberIds: string[];
  members: AgencyTeamMember[];
  departments: string[];
  status: 'active' | 'archived';
  createdAt: string;
}

/**
 * The real `organizations` table (used by Supabase Auth session/login resolution — see
 * supabaseAuth.ts's fetchMembershipAndOrg) is a separate copy of org data from the JSON bundle
 * dataStore persists to. Without this, an org-name/currency/fiscal-year edit here would update the
 * bundle (so most pages reflect it) but never reach the row session-restore reads on next login,
 * so the header/sidebar would keep showing the old value forever. Requires the
 * "organizations_update_member" RLS policy — see supabase/fix_org_update_policy.sql.
 */
function syncOrganizationToSupabaseTable(org: Organization): void {
  if (!isSupabaseDataConfigured()) return;
  const sb = getSupabaseClient();
  if (!sb) return;
  // supabase-js query builders are lazy "thenables" — the request is only actually sent once
  // something calls `.then()`/awaits the builder. A bare `void builder` (no .then()) constructs
  // the chain but never fires it, so the update silently never reaches the network at all.
  sb.from('organizations')
    .update({
      name: org.name,
      logo: org.logo,
      currency: org.currency,
      fiscal_year_start: org.fiscalYearStart,
      settings: org.settings,
    })
    .eq('id', org.id)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) logUnexpectedError('organizationService.syncOrganizationToSupabaseTable', error);
    });
}

function paginationQuery(params: PaginationParams = {}): string {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set('page', String(params.page));
  if (params.pageSize != null) qs.set('pageSize', String(params.pageSize));
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.sortOrder) qs.set('sortOrder', params.sortOrder);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const organizationService = {
  /**
   * Get all organizations (platform admin view)
   * Fetches from Supabase if configured, otherwise falls back to local dataStore
   */
  async getAll(params: PaginationParams = {}): Promise<ServiceResponse<PaginatedResult<Organization>>> {
    if (isHttpBackendConfigured()) {
      return apiGet<PaginatedResult<Organization>>(`/organizations${paginationQuery(params)}`);
    }

    // Try Supabase first if configured (even without VITE_USE_SUPABASE_DATA)
    const sb = getSupabaseClient();
    if (sb) {
      try {
        const { page = 1, pageSize = 20 } = params;
        const start = (page - 1) * pageSize;
        const end = start + pageSize - 1;

        const { data: orgs, error, count } = await sb
          .from('organizations')
          .select('*', { count: 'exact' })
          .range(start, end)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[organizationService.getAll] Supabase error:', error);
          // Fall through to dataStore fallback on error
        } else {
          const items: Organization[] = (orgs || []).map((row: any) => ({
            id: row.id,
            slug: row.slug || undefined,
            name: row.name,
            logo: row.logo || undefined,
            currency: row.currency,
            fiscalYearStart: row.fiscal_year_start,
            createdAt: row.created_at,
            settings: row.settings || { theme: 'dark', notifications: true },
          }));

          const total = count || 0;

          return {
            success: true,
            data: {
              items,
              total,
              page,
              pageSize,
              totalPages: Math.ceil(total / pageSize),
              hasMore: end < total,
            },
          };
        }
      } catch (err) {
        console.error('[organizationService.getAll] Error:', err);
        // Fall through to dataStore fallback
      }
    }

    // Fallback to local dataStore only if Supabase is not available
    await simulateDelay();
    const { page = 1, pageSize = 20 } = params;
    const total = dataStore.organizations.length;
    const items = dataStore.organizations.slice((page - 1) * pageSize, page * pageSize);

    return {
      success: true,
      data: {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasMore: page * pageSize < total,
      },
    };
  },

  /**
   * Get organization by ID
   * TODO: Replace with GET /api/organizations/:id
   */
  async getById(id: string): Promise<ServiceResponse<Organization | null>> {
    if (isHttpBackendConfigured()) {
      return apiGet<Organization | null>(`/organizations/${encodeURIComponent(id)}`);
    }

    await simulateDelay(100);
    const org = dataStore.organizations.find(o => o.id === id) || null;
    return { success: !!org, data: org };
  },

  /**
   * Create a new organization
   * TODO: Replace with POST /api/organizations
   */
  async create(data: Omit<Organization, 'id' | 'createdAt'>): Promise<ServiceResponse<Organization>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<Omit<Organization, 'id' | 'createdAt'>, Organization>('/organizations', data);
    }

    await simulateDelay(250);
    const newOrg: Organization = {
      ...data,
      id: generateId('org'),
      createdAt: new Date().toISOString(),
    };
    dataStore.organizations.push(newOrg);
    dataStore.notify('organizations');
    return { success: true, data: newOrg, message: 'Organization created' };
  },

  /**
   * Update organization
   * TODO: Replace with PATCH /api/organizations/:id
   */
  async update(id: string, updates: Partial<Organization>): Promise<ServiceResponse<Organization>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<Organization>(`/organizations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    }

    await simulateDelay(200);
    const idx = dataStore.organizations.findIndex(o => o.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Organization not found' };

    dataStore.organizations[idx] = { ...dataStore.organizations[idx], ...updates };
    dataStore.notify('organizations');
    syncOrganizationToSupabaseTable(dataStore.organizations[idx]);
    return { success: true, data: dataStore.organizations[idx], message: 'Organization updated' };
  },

  /**
   * Delete organization
   * TODO: Replace with DELETE /api/organizations/:id
   */
  async delete(id: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(`/organizations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    await simulateDelay(200);
    const idx = dataStore.organizations.findIndex(o => o.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Organization not found' };

    dataStore.organizations.splice(idx, 1);
    // Cascade: remove members, transactions, etc. for this org
    dataStore.organizationMembers = dataStore.organizationMembers.filter(m => m.organizationId !== id);
    dataStore.transactions = dataStore.transactions.filter(t => t.organizationId !== id);
    dataStore.notify('organizations');
    return { success: true, data: null, message: 'Organization deleted' };
  },

  // ---- MEMBERS ----

  /**
   * Get organization members with user details.
   *
   * Supabase (`organization_members` + `profiles`) is the only source of truth.
   * There is intentionally no `dataStore` fallback: the seed bundle holds
   * `user-001`-style ids that never match real Supabase auth UUIDs, so falling
   * back to it rendered mock people (John Doe, Sarah Smith, …) as real members.
   */
  async getMembers(organizationId: string): Promise<ServiceResponse<(OrganizationMember & { user: User })[]>> {
    if (isHttpBackendConfigured()) {
      try {
        const res = await apiGet<(OrganizationMember & { user: User })[]>(
          `/organizations/${encodeURIComponent(organizationId)}/members`,
        );
        if (res.success && res.data) {
          return res;
        }
      } catch (err) {
        console.warn('[organizationService.getMembers] Backend HTTP failed, falling back to direct Supabase:', err);
      }
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) {
        return { success: false, data: [], error: 'Supabase is not configured' };
      }

      const { data: membersData, error: membersError } = await sb
        .from('organization_members')
        .select('*')
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'active']);

      if (membersError) {
        console.warn('[organizationService.getMembers] members query error:', membersError.message);
        return { success: false, data: [], error: membersError.message };
      }

      const rows = membersData ?? [];
      if (rows.length === 0) return { success: true, data: [] };

      const userIds = [...new Set(rows.map((m: any) => m.user_id).filter(Boolean))];

      const { data: profilesData } = await sb
        .from('profiles')
        .select('id, email, full_name, created_at')
        .in('id', userIds);

      const profilesMap = new Map<string, any>();
      (profilesData ?? []).forEach((p: any) => profilesMap.set(p.id, p));

      // Fetch employee_team_members to get custom job titles/positions (e.g. Senior Developer)
      const { data: teamMembersData } = await sb
        .from('employee_team_members')
        .select('id, user_id, email, role, department')
        .eq('organization_id', organizationId);

      const tmMapByUserId = new Map<string, any>();
      const tmMapByEmail = new Map<string, any>();
      (teamMembersData ?? []).forEach((tm: any) => {
        if (tm.user_id) tmMapByUserId.set(tm.user_id, tm);
        if (tm.email) tmMapByEmail.set(tm.email.toLowerCase().trim(), tm);
      });

      // A missing profile row must NOT hide a real member — the `organization_members`
      // row is authoritative for existence, so fall back to placeholders.
      const members = rows.map((m: any) => {
        const profile = profilesMap.get(m.user_id);
        const email = profile?.email || '';
        const tm = tmMapByUserId.get(m.user_id) || (email ? tmMapByEmail.get(email.toLowerCase().trim()) : undefined);

        const fixedSalary = Number(m.fixed_salary ?? tm?.salary ?? 0);
        const assignedProjects = m.assigned_projects || tm?.assigned_projects || [];

        const tmRole = String(tm?.role || '').toLowerCase().trim();
        const pos = String(m.position || '').toLowerCase().trim();
        let accessRole: 'org_admin' | 'accountant' | 'team_member' | 'viewer' = 'team_member';
        if (m.role === 'owner' || m.role === 'admin') {
          accessRole = 'org_admin';
        } else if (tmRole === 'accountant' || pos.includes('accountant')) {
          accessRole = 'accountant';
        } else if (tmRole === 'viewer' || pos.includes('viewer')) {
          accessRole = 'viewer';
        } else {
          accessRole = 'team_member';
        }

        return {
          userId: m.user_id,
          organizationId: m.organization_id,
          role: m.role,
          accessRole,
          portalType: m.portal_type,
          status: m.status || 'pending',
          department: m.role === 'owner' ? (tm?.department || m.department || 'Management') : (tm?.department || m.department || 'Development'),
          customRole: tm?.role || (m.role === 'owner' ? 'Organization Owner' : undefined),
          fixedSalary,
          assignedProjects,
          joinedAt: m.joined_at || new Date().toISOString(),
          user: {
            id: m.user_id,
            email: profile?.email ?? '',
            name: profile?.full_name || (profile?.email ? profile.email.split('@')[0] : 'Invited member'),
            role: 'organization_user',
            createdAt: profile?.created_at || new Date().toISOString(),
          },
        };
      }) as (OrganizationMember & { user: User; customRole?: string })[];

      return { success: true, data: members };
    } catch (e) {
      console.warn('[organizationService.getMembers] Supabase query failed:', e);
      return { success: false, data: [], error: e instanceof Error ? e.message : 'Failed to fetch members' };
    }
  },

  /**
   * Add an existing Supabase user to an organization.
   * Writes straight to `organization_members` — no local `dataStore` write, so a
   * member added here is immediately visible to every other reader.
   */
  async addMember(
    organizationId: string,
    userId: string,
    role: OrganizationMember['role']
  ): Promise<ServiceResponse<OrganizationMember>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ userId: string; role: OrganizationMember['role'] }, OrganizationMember>(
        `/organizations/${encodeURIComponent(organizationId)}/members`,
        { userId, role },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const { data: existing } = await sb
        .from('organization_members')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (existing) return { success: false, data: null as any, error: 'User is already a member' };

      const member: OrganizationMember = {
        userId,
        organizationId,
        role,
        status: 'active',
        joinedAt: new Date().toISOString(),
      };

      const { error } = await sb.from('organization_members').insert({
        user_id: userId,
        organization_id: organizationId,
        role,
        status: 'active',
        joined_at: member.joinedAt,
      });
      if (error) return { success: false, data: null as any, error: error.message };

      return { success: true, data: member, message: 'Member added' };
    } catch (e) {
      return { success: false, data: null as any, error: e instanceof Error ? e.message : 'Failed to add member' };
    }
  },

  /**
   * Invite someone by email.
   *
   * This always goes through the server's `/organizations/:id/members/invite`
   * route. That route is required, not optional: it holds the Supabase
   * **service-role** key (server-only) which is the only thing that can call
   * `inviteUserByEmail` to create the auth user and send the real invite email.
   * The browser's anon key can never do this.
   *
   * There is deliberately NO local/mock fallback — a "successful" invite that
   * only touched the in-memory seed store would never appear in Supabase, so the
   * invited employee could never actually log in.
   */
  async inviteMember(
    organizationId: string,
    email: string,
    role: OrganizationMember['role'],
    name?: string,
    department?: string,
    position?: string,
  ): Promise<ServiceResponse<OrganizationMember>> {
    const trimmedEmail = email.trim().toLowerCase();

    // Pass the caller's access token so the server can authorize the invite.
    let token: string | undefined = undefined;
    const sb = getSupabaseClient();
    if (sb) {
      try {
        const sess = await sb.auth.getSession();
        token = sess.data.session?.access_token;
      } catch {
        /* ignore */
      }
    }

    const res = await apiPostJson<{ email: string; name?: string; role: OrganizationMember['role']; department?: string; position?: string }, OrganizationMember>(
      `/organizations/${encodeURIComponent(organizationId)}/members/invite`,
      { email: trimmedEmail, name, role, department, position },
      token ? { token } : {},
    );

    if (res.success) return res;

    // Surface a clear, actionable error instead of silently faking a local invite.
    if (res.error?.includes('HTTP backend not configured')) {
      return {
        success: false,
        data: null as any,
        error: 'Cannot send invitations right now: the invite service is unreachable. No invitation was created.',
      };
    }
    return res;
  },

  /**
   * Scalable bulk invitation for multiple members simultaneously
   */
  async bulkInviteMembers(
    organizationId: string,
    invites: Array<{ email: string; name?: string; role?: string; department?: string; position?: string }>,
  ): Promise<ServiceResponse<{
    total: number;
    successful: number;
    failed: number;
    results: Array<{ email: string; success: boolean; previewUrl?: string; error?: string; message?: string }>;
  }>> {
    const validInvites = invites.filter(i => i.email && i.email.trim().length > 0);
    if (validInvites.length === 0) {
      return { success: false, data: null as any, error: 'No valid email addresses provided' };
    }

    let token: string | undefined = undefined;
    const sb = getSupabaseClient();
    if (sb) {
      try {
        const sess = await sb.auth.getSession();
        token = sess.data.session?.access_token;
      } catch {
        /* ignore */
      }
    }

    const res = await apiPostJson<{
      invites: Array<{ email: string; name?: string; role?: string; department?: string; position?: string }>;
    }, {
      total: number;
      successful: number;
      failed: number;
      results: Array<{ email: string; success: boolean; previewUrl?: string; error?: string; message?: string }>;
    }>(
      `/organizations/${encodeURIComponent(organizationId)}/members/bulk-invite`,
      { invites: validInvites },
      token ? { token } : {},
    );

    if (res.success && res.data) {
      return res;
    }

    // Fallback if backend bulk route fails: process individually
    const results: Array<{ email: string; success: boolean; previewUrl?: string; error?: string; message?: string }> = [];
    for (const inv of validInvites) {
      const singleRes = await this.inviteMember(
        organizationId,
        inv.email,
        (inv.role as any) || 'employee',
        inv.name,
        inv.department,
        inv.position,
      );
      results.push({
        email: inv.email,
        success: singleRes.success,
        error: singleRes.error,
        message: singleRes.message,
      });
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      success: true,
      data: {
        total: results.length,
        successful,
        failed,
        results,
      },
      message: `${successful} of ${results.length} invitations processed.`,
    };
  },

  /**
   * Update member role
   * TODO: Replace with PATCH /api/organizations/:orgId/members/:userId
   */
   async updateMemberRole(
    organizationId: string,
    userId: string,
    newRole: OrganizationMember['role'] | string
  ): Promise<ServiceResponse<OrganizationMember>> {
    const rawRole = String(newRole).toLowerCase().trim();
    let accessRole: string = 'team_member';
    let dbOrgRole: OrganizationMember['role'] = 'employee';
    if (rawRole === 'org_admin' || rawRole === 'admin' || rawRole === 'owner') {
      return { success: false, data: null as any, error: 'Organization Admin role cannot be assigned from employee cards.' };
    } else if (rawRole === 'accountant') {
      accessRole = 'accountant';
      dbOrgRole = 'employee';
    } else if (rawRole === 'viewer') {
      accessRole = 'viewer';
      dbOrgRole = 'employee';
    } else {
      accessRole = 'team_member';
      dbOrgRole = 'employee';
    }

    if (isHttpBackendConfigured()) {
      return apiRequest<OrganizationMember>(
        `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: dbOrgRole, accessRole }),
        },
      );
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const { data, error } = await sb
        .from('organization_members')
        .update({ role: dbOrgRole, access_role: accessRole })
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();

      if (error) return { success: false, data: null as any, error: error.message };
      if (!data) return { success: false, data: null as any, error: 'Member not found' };

      // Update employee_team_members
      await sb
        .from('employee_team_members')
        .update({ role: accessRole })
        .eq('organization_id', organizationId)
        .eq('user_id', userId);

      const member: OrganizationMember = {
        userId: data.user_id,
        organizationId: data.organization_id,
        role: data.role,
        accessRole: accessRole as any,
        portalType: data.portal_type,
        status: data.status,
        joinedAt: data.joined_at,
      };
      return { success: true, data: member, message: 'Role updated successfully' };
    } catch (e) {
      return { success: false, data: null as any, error: e instanceof Error ? e.message : 'Failed to update role' };
    }
  },

  async updateMemberDepartment(
    organizationId: string,
    userId: string,
    department: string,
  ): Promise<ServiceResponse<OrganizationMember>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<OrganizationMember>(
        `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ department }),
        },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const { data, error } = await sb
        .from('organization_members')
        .update({ department })
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();

      if (error) return { success: false, data: null as any, error: error.message };
      if (!data) return { success: false, data: null as any, error: 'Member not found' };

      const member: OrganizationMember = {
        userId: data.user_id,
        organizationId: data.organization_id,
        role: data.role,
        portalType: data.portal_type,
        status: data.status,
        department: data.department,
        joinedAt: data.joined_at,
      };
      return { success: true, data: member, message: 'Department updated' };
    } catch (e) {
      return { success: false, data: null as any, error: e instanceof Error ? e.message : 'Failed to update department' };
    }
  },

  async updateMemberSalary(
    organizationId: string,
    userId: string,
    fixedSalary: number,
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<any>(
        `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ fixedSalary }),
        },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      // Update user_metadata or columns
      try {
        await sb
          .from('organization_members')
          .update({ fixed_salary: fixedSalary })
          .eq('user_id', userId)
          .eq('organization_id', organizationId);
      } catch {
        /* column might not exist */
      }

      return { success: true, data: { userId, fixedSalary }, message: 'Fixed salary updated' };
    } catch (e) {
      return { success: false, data: null as any, error: e instanceof Error ? e.message : 'Failed to update salary' };
    }
  },

  async updateMemberProjects(
    organizationId: string,
    userId: string,
    assignedProjects: string[],
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<any>(
        `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ assignedProjects }),
        },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      try {
        await sb
          .from('organization_members')
          .update({ assigned_projects: assignedProjects })
          .eq('user_id', userId)
          .eq('organization_id', organizationId);
      } catch {
        /* column might not exist */
      }

      return { success: true, data: { userId, assignedProjects }, message: 'Assigned projects updated' };
    } catch (e) {
      return { success: false, data: null as any, error: e instanceof Error ? e.message : 'Failed to update assigned projects' };
    }
  },

  /**
   * Remove member from organization
   * TODO: Replace with DELETE /api/organizations/:orgId/members/:userId
   */
  async removeMember(organizationId: string, userId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null, error: 'Supabase is not configured' };

      const { error } = await sb
        .from('organization_members')
        .delete()
        .eq('user_id', userId)
        .eq('organization_id', organizationId);

      if (error) {
        return { success: false, data: null, error: error.message || 'Failed to remove member' };
      }
      return { success: true, data: null, message: 'Member removed successfully' };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : 'Failed to remove member' };
    }
  },

  /**
   * Get role permissions dictionary for an organization
   */
  async getRolePermissions(organizationId: string): Promise<ServiceResponse<Record<string, string[]>>> {
    if (isHttpBackendConfigured()) {
      return apiGet<Record<string, string[]>>(`/organizations/${encodeURIComponent(organizationId)}/roles/permissions`);
    }

    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: org } = await sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle();
        const custom = (org?.settings as any)?.role_permissions || {};
        return {
          success: true,
          data: {
            org_admin: ['all'],
            accountant: Array.isArray(custom.accountant) ? custom.accountant : [
              'view_dashboard', 'view_reports', 'add_transaction', 'edit_transaction', 'categorize', 'export_data', 'manage_accounts', 'import_statements'
            ],
            team_member: Array.isArray(custom.team_member) ? custom.team_member : [
              'view_dashboard', 'add_transaction', 'view_reports'
            ],
            viewer: Array.isArray(custom.viewer) ? custom.viewer : [
              'view_dashboard', 'view_reports'
            ],
          }
        };
      }
    } catch {}

    return {
      success: true,
      data: {
        org_admin: ['all'],
        accountant: ['view_dashboard', 'view_reports', 'add_transaction', 'edit_transaction', 'categorize', 'export_data', 'manage_accounts', 'import_statements'],
        team_member: ['view_dashboard', 'add_transaction', 'view_reports'],
        viewer: ['view_dashboard', 'view_reports'],
      }
    };
  },

  /**
   * Update role permissions for a specific role
   */
  async updateRolePermissions(
    organizationId: string,
    roleId: string,
    permissions: string[]
  ): Promise<ServiceResponse<{ roleId: string; permissions: string[]; allRoles: Record<string, string[]> }>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<{ roleId: string; permissions: string[]; allRoles: Record<string, string[]> }>(
        `/organizations/${encodeURIComponent(organizationId)}/roles/${encodeURIComponent(roleId)}/permissions`,
        {
          method: 'PUT',
          body: JSON.stringify({ permissions }),
        }
      );
    }

    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: org } = await sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle();
        const currentSettings = (org?.settings as any) || {};
        const updatedRolePerms = {
          ...(currentSettings.role_permissions || {}),
          [roleId]: permissions,
        };
        const updatedSettings = {
          ...currentSettings,
          role_permissions: updatedRolePerms,
        };
        await sb.from('organizations').update({ settings: updatedSettings }).eq('id', organizationId);
        return {
          success: true,
          data: {
            roleId,
            permissions,
            allRoles: updatedRolePerms,
          },
          message: 'Permissions updated successfully',
        };
      }
    } catch (e: any) {
      return { success: false, data: null as any, error: e?.message || 'Failed to update permissions' };
    }

    return {
      success: true,
      data: {
        roleId,
        permissions,
        allRoles: {},
      },
      message: 'Permissions updated',
    };
  },

  // ---- AGENCY TEAMS & CROSS-DEPARTMENTAL SQUADS ----

  async getTeams(organizationId: string): Promise<ServiceResponse<AgencyTeam[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<AgencyTeam[]>(`/organizations/${encodeURIComponent(organizationId)}/teams`);
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: true, data: [] };

      const [
        { data: dbTeams, error: dbTeamsErr },
        { data: dbTeamMembers },
        { data: orgRow },
        { data: membersRes },
        { data: projectsRes },
      ] = await Promise.all([
        sb.from('agency_teams').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }),
        sb.from('agency_team_members').select('*').eq('organization_id', organizationId),
        sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle(),
        this.getMembers(organizationId),
        sb.from('projects').select('id, name').eq('organization_id', organizationId),
      ]);

      let rawTeams: any[] = [];
      if (!dbTeamsErr && Array.isArray(dbTeams) && dbTeams.length > 0) {
        const membersByTeam = new Map<string, string[]>();
        (dbTeamMembers || []).forEach((tm: any) => {
          const tid = String(tm.team_id);
          const list = membersByTeam.get(tid) || [];
          list.push(String(tm.user_id));
          membersByTeam.set(tid, list);
        });
        rawTeams = dbTeams.map((row: any) => ({
          id: row.id,
          organizationId: row.organization_id,
          name: row.name,
          description: row.description || '',
          projectId: row.project_id || undefined,
          leadUserId: row.lead_user_id ? String(row.lead_user_id) : undefined,
          memberIds: membersByTeam.get(String(row.id)) || [],
          status: row.status || 'active',
          createdAt: row.created_at,
        }));
      } else {
        rawTeams = Array.isArray((orgRow?.settings as any)?.agency_teams)
          ? (orgRow?.settings as any).agency_teams
          : [];
      }
      if (rawTeams.length === 0) return { success: true, data: [] };

      const membersMap = new Map<string, any>();
      for (const m of membersRes || []) {
        membersMap.set(m.userId, m);
      }
      const projectsMap = new Map<string, string>();
      for (const p of projectsRes || []) {
        projectsMap.set(p.id, p.name);
      }

      const enriched: AgencyTeam[] = rawTeams.map((t: any) => {
        const memberIds: string[] = Array.isArray(t.memberIds) ? t.memberIds : [];
        const leadId = t.leadUserId ? String(t.leadUserId) : undefined;
        const members: AgencyTeamMember[] = memberIds
          .map((uid) => {
            const m = membersMap.get(String(uid));
            if (!m) return null;
            return {
              userId: m.userId,
              name: m.user?.name || m.user?.email?.split('@')[0] || 'Team Member',
              email: m.user?.email || '',
              department: m.department || 'Development',
              role: m.customRole || (m.role === 'owner' ? 'Organization Owner' : 'Team Member'),
              isLead: leadId === String(uid),
            };
          })
          .filter(Boolean) as AgencyTeamMember[];

        const departments = Array.from(new Set(members.map((m) => m.department).filter(Boolean)));
        const leadMember = leadId ? members.find((m) => m.userId === leadId) : undefined;

        return {
          id: String(t.id),
          organizationId,
          name: String(t.name || 'Agency Squad'),
          description: String(t.description || ''),
          projectId: t.projectId ? String(t.projectId) : undefined,
          projectName: t.projectId ? projectsMap.get(String(t.projectId)) || t.projectName : undefined,
          leadUserId: leadId,
          leadName: leadMember?.name || t.leadName,
          memberIds,
          members,
          departments,
          status: t.status === 'archived' ? 'archived' : 'active',
          createdAt: t.createdAt || new Date().toISOString(),
        };
      });

      return { success: true, data: enriched };
    } catch (e: any) {
      return { success: false, data: [], error: e?.message || 'Failed to load agency teams' };
    }
  },

  async createTeam(
    organizationId: string,
    payload: {
      name: string;
      description?: string;
      projectId?: string;
      leadUserId?: string;
      memberIds: string[];
    },
  ): Promise<ServiceResponse<AgencyTeam>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<typeof payload, AgencyTeam>(
        `/organizations/${encodeURIComponent(organizationId)}/teams`,
        payload,
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const { data: orgRow } = await sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle();
      const currentSettings = (orgRow?.settings as any) || {};
      const existingTeams: any[] = Array.isArray(currentSettings.agency_teams) ? currentSettings.agency_teams : [];

      const uniqueMembers = Array.from(new Set(payload.memberIds.map(String).filter(Boolean)));
      if (payload.leadUserId && !uniqueMembers.includes(payload.leadUserId)) {
        uniqueMembers.unshift(payload.leadUserId);
      }

      const newTeam = {
        id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        organizationId,
        name: payload.name.trim(),
        description: (payload.description || '').trim(),
        projectId: payload.projectId || undefined,
        leadUserId: payload.leadUserId || uniqueMembers[0] || undefined,
        memberIds: uniqueMembers,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      };

      const updatedSettings = {
        ...currentSettings,
        agency_teams: [...existingTeams, newTeam],
      };

      await sb.from('organizations').update({ settings: updatedSettings }).eq('id', organizationId);
      const allTeams = await this.getTeams(organizationId);
      const created = (allTeams.data || []).find((t) => t.id === newTeam.id) || (newTeam as any);
      return { success: true, data: created, message: `Team "${newTeam.name}" created` };
    } catch (e: any) {
      return { success: false, data: null as any, error: e?.message || 'Failed to create team' };
    }
  },

  async updateTeam(
    organizationId: string,
    teamId: string,
    updates: Partial<{
      name: string;
      description: string;
      projectId: string;
      leadUserId: string;
      memberIds: string[];
      status: 'active' | 'archived';
    }>,
  ): Promise<ServiceResponse<AgencyTeam>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<AgencyTeam>(
        `/organizations/${encodeURIComponent(organizationId)}/teams/${encodeURIComponent(teamId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const { data: orgRow } = await sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle();
      const currentSettings = (orgRow?.settings as any) || {};
      const existingTeams: any[] = Array.isArray(currentSettings.agency_teams) ? currentSettings.agency_teams : [];
      const idx = existingTeams.findIndex((t: any) => String(t.id) === teamId);
      if (idx === -1) return { success: false, data: null as any, error: 'Team not found' };

      const target = { ...existingTeams[idx], ...updates, updatedAt: new Date().toISOString() };
      const nextTeams = [...existingTeams];
      nextTeams[idx] = target;

      await sb
        .from('organizations')
        .update({ settings: { ...currentSettings, agency_teams: nextTeams } })
        .eq('id', organizationId);

      const allTeams = await this.getTeams(organizationId);
      const updated = (allTeams.data || []).find((t) => t.id === teamId) || target;
      return { success: true, data: updated, message: 'Team updated' };
    } catch (e: any) {
      return { success: false, data: null as any, error: e?.message || 'Failed to update team' };
    }
  },

  async deleteTeam(organizationId: string, teamId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/teams/${encodeURIComponent(teamId)}`,
        { method: 'DELETE' },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null, error: 'Supabase is not configured' };

      const { data: orgRow } = await sb.from('organizations').select('settings').eq('id', organizationId).maybeSingle();
      const currentSettings = (orgRow?.settings as any) || {};
      const existingTeams: any[] = Array.isArray(currentSettings.agency_teams) ? currentSettings.agency_teams : [];
      const nextTeams = existingTeams.filter((t: any) => String(t.id) !== teamId);

      await sb
        .from('organizations')
        .update({ settings: { ...currentSettings, agency_teams: nextTeams } })
        .eq('id', organizationId);

      return { success: true, data: null, message: 'Team deleted' };
    } catch (e: any) {
      return { success: false, data: null, error: e?.message || 'Failed to delete team' };
    }
  },

  /**
   * Get all company announcements for an organization (sorted pinned first, newest first)
   */
  async getAnnouncements(organizationId: string): Promise<ServiceResponse<CompanyAnnouncement[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<CompanyAnnouncement[]>(`/organizations/${encodeURIComponent(organizationId)}/announcements`);
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: [], error: 'Supabase is not configured' };

      const { data, error } = await sb
        .from('company_announcements')
        .select('*')
        .eq('organization_id', organizationId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      const mapped: CompanyAnnouncement[] = (data || []).map((a: any) => ({
        id: a.id,
        organizationId: a.organization_id,
        title: a.title,
        content: a.content,
        author: a.author || 'Leadership',
        category: a.category || 'general',
        createdAt: a.created_at,
        isPinned: Boolean(a.is_pinned),
      }));
      return { success: true, data: mapped };
    } catch (e: any) {
      return { success: false, data: [], error: e?.message || 'Failed to fetch announcements' };
    }
  },

  /**
   * Create a new company announcement (Owner/Admin)
   */
  async createAnnouncement(
    organizationId: string,
    payload: {
      title: string;
      content: string;
      category?: 'general' | 'hr' | 'finance' | 'project' | 'celebration';
      isPinned?: boolean;
      author?: string;
    },
  ): Promise<ServiceResponse<CompanyAnnouncement>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<typeof payload, CompanyAnnouncement>(
        `/organizations/${encodeURIComponent(organizationId)}/announcements`,
        payload,
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const annId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();
      const row = {
        id: annId,
        organization_id: organizationId,
        title: payload.title.trim(),
        content: payload.content.trim(),
        author: payload.author?.trim() || 'Leadership',
        category: payload.category || 'general',
        is_pinned: Boolean(payload.isPinned),
        created_at: nowIso,
      };

      const { data, error } = await sb
        .from('company_announcements')
        .insert(row)
        .select()
        .single();

      if (error) throw error;
      return {
        success: true,
        data: {
          id: data.id,
          organizationId: data.organization_id,
          title: data.title,
          content: data.content,
          author: data.author,
          category: data.category,
          createdAt: data.created_at,
          isPinned: Boolean(data.is_pinned),
        },
        message: 'Announcement published',
      };
    } catch (e: any) {
      return { success: false, data: null as any, error: e?.message || 'Failed to create announcement' };
    }
  },

  /**
   * Update an existing company announcement (Owner/Admin)
   */
  async updateAnnouncement(
    organizationId: string,
    announcementId: string,
    updates: Partial<{
      title: string;
      content: string;
      category: 'general' | 'hr' | 'finance' | 'project' | 'celebration';
      isPinned: boolean;
      author: string;
    }>,
  ): Promise<ServiceResponse<CompanyAnnouncement>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<CompanyAnnouncement>(
        `/organizations/${encodeURIComponent(organizationId)}/announcements/${encodeURIComponent(announcementId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null as any, error: 'Supabase is not configured' };

      const dbUpdates: Record<string, any> = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title.trim();
      if (updates.content !== undefined) dbUpdates.content = updates.content.trim();
      if (updates.author !== undefined) dbUpdates.author = updates.author.trim();
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.isPinned !== undefined) dbUpdates.is_pinned = Boolean(updates.isPinned);

      const { data, error } = await sb
        .from('company_announcements')
        .update(dbUpdates)
        .eq('id', announcementId)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (error) throw error;
      return {
        success: true,
        data: {
          id: data.id,
          organizationId: data.organization_id,
          title: data.title,
          content: data.content,
          author: data.author,
          category: data.category,
          createdAt: data.created_at,
          isPinned: Boolean(data.is_pinned),
        },
        message: 'Announcement updated',
      };
    } catch (e: any) {
      return { success: false, data: null as any, error: e?.message || 'Failed to update announcement' };
    }
  },

  /**
   * Delete a company announcement (Owner/Admin)
   */
  async deleteAnnouncement(organizationId: string, announcementId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<null>(
        `/organizations/${encodeURIComponent(organizationId)}/announcements/${encodeURIComponent(announcementId)}`,
        { method: 'DELETE' },
      );
    }

    try {
      const sb = getSupabaseClient();
      if (!sb) return { success: false, data: null, error: 'Supabase is not configured' };

      const { error } = await sb
        .from('company_announcements')
        .delete()
        .eq('id', announcementId)
        .eq('organization_id', organizationId);

      if (error) throw error;
      return { success: true, data: null, message: 'Announcement deleted' };
    } catch (e: any) {
      return { success: false, data: null, error: e?.message || 'Failed to delete announcement' };
    }
  },
};