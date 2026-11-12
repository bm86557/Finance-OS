/**
 * §3 (org admin) + §18 (team-directory, announcements) + §19 (ai-settings)
 * Mounted at `/organizations/:organizationId` (mergeParams).
 */

import { Router, type Request, type Response } from 'express';
import type { Organization, OrganizationMember, OrgAiIntegrationSettings, User } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { requireOrgRole, canViewConfidentialPayroll } from '../middleware/auth.js';
import { findAuthUserIdByLegacyId, getSupabaseAdminClient, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import { findAuthUserByEmail } from '../lib/supabaseAuth.js';
import { sendInviteEmail } from '../lib/emailService.js';
import { env } from '../config/env.js';
import { encryptSecret, decryptSecret, maskApiKey, extractLast4, fingerprintKey } from '../lib/secretBox.js';
import { resolveOrgAIConfig, testAIConnection, invalidateOrgAICache, type AIProvider } from '../lib/aiGateway.js';
import { logAuditEvent } from '../lib/auditLogger.js';

type Sb = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

/**
 * Supabase is the authority for orgs and memberships. The local `store` is no longer consulted
 * for either, because `requireOrgMembership` (server/middleware/auth.ts) grants access purely from
 * a `public.organization_members` row — a membership that existed only in the in-memory store
 * would produce a member who authenticates fine and is then denied access to every route.
 */
export function normalizeOrgPlanCurrencies(org: Organization | null): Organization | null {
  if (!org) return null;
  const planKey = String((org as any).settings?.plan || (org as any).plan || 'basic').toLowerCase().trim();
  const isFreeTier = planKey === 'basic' || planKey === 'free';
  const maxCurrencies = isFreeTier ? 2 : (planKey === 'professional' ? 5 : 10);

  const currentSettings = (org as any).settings || {};
  let currs = currentSettings.enabledCurrencies;

  if (isFreeTier) {
    // Free tier is strictly limited to PKR and USD per §3.1 and plan quotas
    const allowed = ['USD', 'PKR'];
    if (Array.isArray(currs) && currs.length > 0) {
      currs = currs
        .map((c: string) => String(c).toUpperCase().trim())
        .filter((c: string) => allowed.includes(c))
        .slice(0, 2);
    }
    if (!Array.isArray(currs) || currs.length === 0) {
      const base = String(org.currency || 'USD').toUpperCase().trim();
      currs = base === 'PKR' ? ['PKR', 'USD'] : ['USD', 'PKR'];
    }
  } else {
    if (Array.isArray(currs) && currs.length > 0) {
      currs = currs
        .map((c: string) => String(c).toUpperCase().trim())
        .slice(0, maxCurrencies);
    } else {
      currs = ['USD', 'PKR'];
    }
  }

  (org as any).settings = {
    ...currentSettings,
    enabledCurrencies: currs,
  };
  return org;
}

async function sbOrgByIdOrSlug(sb: Sb, idOrSlug: string): Promise<Organization | null> {
  const byId = await sb.from('organizations').select('*').eq('id', idOrSlug).maybeSingle();
  if (byId.data) return normalizeOrgPlanCurrencies(byId.data as unknown as Organization);
  const bySlug = await sb.from('organizations').select('*').eq('slug', idOrSlug).maybeSingle();
  return bySlug.data ? normalizeOrgPlanCurrencies(bySlug.data as unknown as Organization) : null;
}

function rowToMember(row: Record<string, unknown>): OrganizationMember {
  return {
    userId: row.user_id as string,
    organizationId: row.organization_id as string,
    role: row.role as OrganizationMember['role'],
    portalType: row.portal_type as OrganizationMember['portalType'],
    status: (row.status as OrganizationMember['status']) || 'active',
    department: (row.department as string) || undefined,
    joinedAt: (row.joined_at as string) ?? new Date().toISOString(),
  };
}


function defaultAiSettings(): OrgAiIntegrationSettings {
  return { useCustomKey: false, providerName: '', modelName: 'gpt-4o-mini', apiKey: '' };
}

function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  org_admin: ['all'],
  accountant: [
    'view_dashboard',
    'view_reports',
    'add_transaction',
    'edit_transaction',
    'categorize',
    'export_data',
    'manage_accounts',
    'import_statements',
    'ai_assistant',
  ],
  team_member: [
    'view_dashboard',
    'add_transaction',
    'view_reports',
  ],
  viewer: [
    'view_dashboard',
    'view_reports',
  ],
};

const ownerOrAdmin = requireOrgRole('owner', 'admin');

export function createOrganizationRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);

    // Check Supabase first (organization created during signup lives here)
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const org = await sbOrgByIdOrSlug(sb, orgId);
        if (org) {
          return ok(res, org);
        }
      } catch (err) {
        console.error('[org] GET /:id Supabase error', { orgId, err });
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.patch('/', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const updates = req.body as Partial<Organization> & Record<string, any>;

    // Update in Supabase first
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data: beforeData } = await sb
          .from('organizations')
          .select('*')
          .eq('id', orgId)
          .maybeSingle();

        const dbUpdates: Record<string, unknown> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.slug !== undefined) dbUpdates.slug = updates.slug;
        if (updates.logo !== undefined) dbUpdates.logo = updates.logo;
        if (updates.currency !== undefined) {
          dbUpdates.currency = updates.currency;
          dbUpdates.base_currency = updates.currency;
        }
        if (updates.baseCurrency !== undefined || updates.base_currency !== undefined) {
          dbUpdates.base_currency = updates.baseCurrency ?? updates.base_currency;
        }
        if (updates.fiscalYearStart !== undefined) dbUpdates.fiscal_year_start = updates.fiscalYearStart;
        if (updates.fiscal_year_start !== undefined) dbUpdates.fiscal_year_start = updates.fiscal_year_start;
        if (updates.taxId !== undefined || updates.tax_id !== undefined) {
          dbUpdates.tax_id = updates.taxId ?? updates.tax_id;
        }
        if (updates.defaultTaxRate !== undefined || updates.default_tax_rate !== undefined) {
          dbUpdates.default_tax_rate = Number(updates.defaultTaxRate ?? updates.default_tax_rate);
        }
        if (updates.accountingBasis !== undefined || updates.accounting_basis !== undefined) {
          dbUpdates.accounting_basis = updates.accountingBasis ?? updates.accounting_basis;
        }

        const currentVersion = Number(beforeData?.settings_version || 1);
        const nextVersion = currentVersion + 1;
        dbUpdates.settings_version = nextVersion;
        dbUpdates.updated_at = new Date().toISOString();

        const planKey = String(beforeData?.settings?.plan || beforeData?.plan || 'basic').toLowerCase().trim();
        const isFreeTier = planKey === 'basic' || planKey === 'free';
        const maxCurrencies = isFreeTier ? 2 : (planKey === 'professional' ? 5 : 10);

        if (updates.settings !== undefined) {
          const nextSettings = { ...updates.settings };
          if (Array.isArray(nextSettings.enabledCurrencies)) {
            if (isFreeTier) {
              const allowed = ['USD', 'PKR'];
              nextSettings.enabledCurrencies = nextSettings.enabledCurrencies
                .map((c: string) => String(c).toUpperCase().trim())
                .filter((c: string) => allowed.includes(c))
                .slice(0, 2);
              if (nextSettings.enabledCurrencies.length === 0) {
                const base = String(beforeData?.currency || updates.currency || 'USD').toUpperCase().trim();
                nextSettings.enabledCurrencies = base === 'PKR' ? ['PKR', 'USD'] : ['USD', 'PKR'];
              }
            } else {
              nextSettings.enabledCurrencies = nextSettings.enabledCurrencies
                .map((c: string) => String(c).toUpperCase().trim())
                .slice(0, maxCurrencies);
            }
          }
          dbUpdates.settings = nextSettings;
        }

        const { data, error } = await sb
          .from('organizations')
          .update(dbUpdates)
          .eq('id', orgId)
          .select()
          .single();

        if (!error && data) {
          // 1. Record snapshot in organization_settings_versions
          try {
            await sb.from('organization_settings_versions').insert({
              organization_id: orgId,
              version: nextVersion,
              effective_from: new Date().toISOString(),
              changed_by: req.authUser?.id || null,
              settings_snapshot: {
                currency: data.currency,
                base_currency: data.base_currency,
                fiscal_year_start: data.fiscal_year_start,
                tax_id: data.tax_id,
                default_tax_rate: data.default_tax_rate,
                accounting_basis: data.accounting_basis,
                settings: data.settings,
              },
              changes_diff: dbUpdates,
              created_at: new Date().toISOString(),
            });
          } catch (verErr: any) {
            console.warn('[org] settings_version snapshot notice:', verErr?.message || verErr);
          }

          // 2. Audit log entry with changes diff
          try {
            await logAuditEvent(req, {
              organizationId: orgId,
              action: 'settings_changed',
              entityType: 'settings',
              entityId: orgId,
              description: `Organization settings updated to version ${nextVersion}`,
              beforeState: beforeData || null,
              afterState: data || null,
            });
          } catch (auditErr: any) {
            console.warn('[org] settings_changed audit log notice:', auditErr?.message || auditErr);
          }

          // 3. Sync approval_policies if teamRequireApproval changed
          if (updates.settings?.teamSettings?.requireApproval !== undefined) {
            try {
              const reqApproval = Boolean(updates.settings.teamSettings.requireApproval);
              const { data: existingPolicy } = await sb
                .from('approval_policies')
                .select('id')
                .eq('organization_id', orgId)
                .eq('entity_type', 'transaction')
                .maybeSingle();

              if (existingPolicy) {
                await sb
                  .from('approval_policies')
                  .update({ is_active: reqApproval })
                  .eq('id', existingPolicy.id);
              } else {
                await sb.from('approval_policies').insert({
                  organization_id: orgId,
                  entity_type: 'transaction',
                  threshold_amount: 0,
                  required_roles: ['owner', 'admin'],
                  is_active: reqApproval,
                });
              }
            } catch (policyErr: any) {
              console.warn('[org] approval policy sync notice:', policyErr?.message || policyErr);
            }
          }

          return ok(res, data as unknown as Organization, 'Organization updated');
        }

        console.error('[org] PATCH Supabase error:', error);
      } catch (err) {
        console.error('[org] PATCH Supabase exception:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.delete('/', ownerOrAdmin, async (req: Request, res: Response) => {
    const id = paramStr(req.params.organizationId);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');
    const { error } = await sb.from('organizations').delete().eq('id', id);
    if (error) return fail(res, 500, error.message);
    return ok(res, null, 'Organization deleted');
  });

  // ---- Members ----

  r.get('/members', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);

    console.log('[members] Fetching members for org:', orgId);

    // Try Supabase first for real data (pending invites + active members)
    if (isSupabaseAdminConfigured()) {
      try {
        const sb = getSupabaseAdminClient();
        if (!sb) {
          console.error('[members] Supabase admin client is null!');
          return fail(res, 500, 'Database connection not available');
        }

        console.log('[members] Querying organization_members...');

        // Get all members from organization_members (pending + active)
        const { data: sbMembers, error: membersError } = await sb
          .from('organization_members')
          .select('*')
          .eq('organization_id', orgId)
          .in('status', ['pending', 'active']);

        if (membersError) {
          console.error('[members] Supabase members query error:', membersError);
          throw membersError;
        }

        console.log('[members] Found', sbMembers?.length || 0, 'members');

        if (!sbMembers || sbMembers.length === 0) {
          console.log('[members] No members found in Supabase for org:', orgId);
          return ok(res, []);
        }

        // Get unique user_ids to fetch profiles
        const userIds = [...new Set(sbMembers.map((m: any) => m.user_id))];
        console.log('[members] Fetching profiles for', userIds.length, 'users');

        // Fetch profiles for these users
        const { data: profilesData, error: profilesError } = await sb
          .from('profiles')
          .select('id, email, full_name, created_at')
          .in('id', userIds);

        if (profilesError) {
          console.error('[members] Supabase profiles query error:', profilesError);
          // Don't throw - continue with partial data
        }

        // Create a map for quick lookup
        const profilesMap = new Map();
        if (profilesData) {
          profilesData.forEach((p: any) => profilesMap.set(p.id, p));
          console.log('[members] Loaded', profilesData.length, 'profiles');
        }

        // Fetch employee_team_members to get custom job titles, salary, and project assignments
        const { data: teamMembersData } = await sb
          .from('employee_team_members')
          .select('*')
          .eq('organization_id', orgId);

        const tmMapByUserId = new Map<string, any>();
        const tmMapByEmail = new Map<string, any>();
        (teamMembersData ?? []).forEach((tm: any) => {
          if (tm.user_id) tmMapByUserId.set(tm.user_id, tm);
          if (tm.email) tmMapByEmail.set(tm.email.toLowerCase().trim(), tm);
        });

        const canSeePayroll = canViewConfidentialPayroll(req);

        const formatted = sbMembers
          .map((m: any) => {
            const profile = profilesMap.get(m.user_id);
            if (!profile) {
              console.warn('[members] No profile found for user:', m.user_id);
              return null;
            }
            const profileEmail: string = profile.email || '';
            const tm = tmMapByUserId.get(m.user_id)
              || (profileEmail ? tmMapByEmail.get(profileEmail.toLowerCase().trim()) : undefined);

            const tmRole = String(tm?.role || '').toLowerCase().trim();
            const pos = String(m.position || '').toLowerCase().trim();
            const storedAccessRole = String(m.access_role || '').toLowerCase().trim();

            let accessRole: 'org_admin' | 'accountant' | 'team_member' | 'viewer' = 'team_member';
            if (m.role === 'owner' || m.role === 'admin' || storedAccessRole === 'org_admin') {
              accessRole = 'org_admin';
            } else if (storedAccessRole === 'accountant' || tmRole === 'accountant' || pos.includes('accountant')) {
              accessRole = 'accountant';
            } else if (storedAccessRole === 'viewer' || tmRole === 'viewer' || pos.includes('viewer')) {
              accessRole = 'viewer';
            } else {
              accessRole = 'team_member';
            }

            const rawSalary = m.fixed_salary !== undefined && m.fixed_salary !== null
              ? Number(m.fixed_salary)
              : (tm?.salary !== undefined && tm?.salary !== null
                ? Number(tm.salary)
                : (tm?.fixed_salary !== undefined && tm?.fixed_salary !== null ? Number(tm.fixed_salary) : 0));
            const memberSalary = canSeePayroll ? rawSalary : 0;

            const memberProjects = Array.isArray(m.assigned_projects) && m.assigned_projects.length > 0
              ? m.assigned_projects
              : (Array.isArray(tm?.assigned_projects) && tm.assigned_projects.length > 0 ? tm.assigned_projects : []);

            return {
              userId: m.user_id,
              organizationId: m.organization_id,
              role: m.role,
              accessRole,
              portalType: m.portal_type,
              status: m.status || 'pending',
              department: m.department || tm?.department,
              customRole: m.position || tm?.role || undefined,
              fixedSalary: memberSalary,
              assignedProjects: memberProjects,
              joinedAt: m.joined_at || new Date().toISOString(),
              user: {
                id: profile.id,
                email: profileEmail,
                name: profile.full_name || tm?.name || (profileEmail ? profileEmail.split('@')[0] : 'Invited member'),
                phone: profile.phone || m.phone || tm?.phone || '',
                role: 'organization_user',
                createdAt: profile.created_at || new Date().toISOString(),
              },
            };
          })
          .filter((m: any) => m !== null);

        console.log('[members] Returning', formatted.length, 'formatted members');
        return ok(res, formatted);
      } catch (e) {
        console.error('[members] Supabase query failed:', e);
        return fail(res, 500, `Database error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    // No local-store fallback: the Express `store` is a seed copy, so serving it
    // here is what made the UI show demo people instead of real members.
    console.warn('[members] Supabase is not configured — cannot list real members');
    return fail(res, 503, 'Database connection required. Please configure Supabase.');
  });

  // Adds an existing Supabase auth user to this org as an active member. Written straight to
  // `organization_members` — no local-store shadow copy, so `requireOrgMembership` sees it.
  r.post('/members', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const { userId, role, department } = req.body as {
      userId: string;
      role: OrganizationMember['role'];
      department?: string;
    };

    if (!isSupabaseAdminConfigured()) {
      return fail(res, 503, 'Database connection required. Please configure Supabase.');
    }
    const sb = getSupabaseAdminClient()!;

    const { data: existing } = await sb
      .from('organization_members')
      .select('user_id, organization_id')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (existing) return fail(res, 409, 'User is already a member');

    const { data, error } = await sb
      .from('organization_members')
      .insert({
        user_id: userId,
        organization_id: orgId,
        role: role || 'employee',
        status: 'active',
        department: department || null,
      })
      .select('user_id, organization_id, role, portal_type, status, department, joined_at')
      .single();

    if (error) {
      console.error('[org] add member failed:', error.message);
      return fail(res, 400, error.message);
    }

    created(res, rowToMember(data as unknown as Record<string, unknown>), 'Member added');
  });

  // Role change is authoritative in Supabase. Previously this checked the in-memory store first and
  // returned 404 for any member who existed only as a real auth user, then mirrored the write
  // fire-and-forget — so a role change could silently fail. Now it reads and writes the one row
  // that `requireOrgMembership` actually consults.
  r.patch('/members/:userId', ownerOrAdmin, async (req: Request, res: Response) => {
    const organizationId = paramStr(req.params.organizationId);
    const userId = paramStr(req.params.userId);
    const { role, accessRole, department, fixedSalary, salary, assignedProjects, assignedProjectIds } = req.body as {
      role?: string;
      accessRole?: string;
      department?: string;
      fixedSalary?: number;
      salary?: number;
      assignedProjects?: string[];
      assignedProjectIds?: string[];
    };

    if (
      !role &&
      !accessRole &&
      department === undefined &&
      fixedSalary === undefined &&
      salary === undefined &&
      assignedProjects === undefined &&
      assignedProjectIds === undefined
    ) {
      return fail(res, 400, 'At least one field to update is required');
    }
    if (!isSupabaseAdminConfigured()) {
      return fail(res, 503, 'Database connection required. Please configure Supabase.');
    }
    const sb = getSupabaseAdminClient()!;

    // Callers may address the member by their real auth UUID or by a legacy local id stamped in
    // auth metadata at invite time. Resolve both so existing UI callers keep working.
    const realUserId = userId.length === 36 && userId.includes('-')
      ? userId
      : (await findAuthUserIdByLegacyId(userId)) ?? userId;

    // Protect owner & admin roles — cannot be escalated to or altered via employee cards.
    const { data: currentRow } = await sb
      .from('organization_members')
      .select('role, department, access_role, fixed_salary, assigned_projects')
      .eq('organization_id', organizationId)
      .eq('user_id', realUserId)
      .maybeSingle();

    if (currentRow?.role === 'owner') {
      return fail(res, 403, 'The organization owner role cannot be changed.');
    }

    const rawRole = String(accessRole || role || '').toLowerCase().trim();
    let resolvedAccessRole: 'org_admin' | 'accountant' | 'team_member' | 'viewer' | undefined = undefined;
    let resolvedOrgRole: OrganizationMember['role'] | undefined = undefined;

    if (rawRole) {
      if (rawRole === 'org_admin' || rawRole === 'admin' || rawRole === 'owner') {
        // Forbid elevating any member to admin from employee cards
        return fail(res, 403, 'Organization Admin role cannot be assigned from employee cards.');
      } else if (rawRole === 'accountant') {
        resolvedAccessRole = 'accountant';
        resolvedOrgRole = 'employee';
      } else if (rawRole === 'viewer') {
        resolvedAccessRole = 'viewer';
        resolvedOrgRole = 'employee';
      } else if (rawRole === 'team_member' || rawRole === 'employee') {
        resolvedAccessRole = 'team_member';
        resolvedOrgRole = 'employee';
      }
    }

    if (currentRow?.role === 'admin' && (rawRole || role || accessRole)) {
      return fail(res, 403, 'Organization Admin role is protected and cannot be changed.');
    }

    const updates: Record<string, any> = {};
    if (resolvedOrgRole && currentRow?.role !== 'owner' && currentRow?.role !== 'admin') {
      updates.role = resolvedOrgRole;
    }
    if (resolvedAccessRole) {
      updates.access_role = resolvedAccessRole;
    }
    if (department !== undefined) {
      const cleanDept = department.trim();
      updates.department = cleanDept;

      // Link department_id from departments table for accurate overhead headcount
      try {
        const { data: depts } = await sb
          .from('departments')
          .select('id, name')
          .eq('organization_id', organizationId);
        if (depts && depts.length > 0) {
          const match = depts.find(
            (d: any) =>
              d.id === cleanDept ||
              d.name.toLowerCase() === cleanDept.toLowerCase() ||
              d.name.toLowerCase().includes(cleanDept.toLowerCase()) ||
              cleanDept.toLowerCase().includes(d.name.toLowerCase())
          );
          if (match) {
            updates.department_id = match.id;
          }
        }
      } catch {
        /* ignore */
      }
    }

    const targetSalary = fixedSalary !== undefined ? fixedSalary : salary;
    if (targetSalary !== undefined) {
      updates.fixed_salary = Number(targetSalary);
    }
    const targetProjects = assignedProjects !== undefined ? assignedProjects : assignedProjectIds;
    if (targetProjects !== undefined) {
      updates.assigned_projects = Array.isArray(targetProjects) ? targetProjects : [];
    }

    // Try updating organization_members with all updates
    let updatedMemberRow: any = null;
    try {
      const { data: updData, error: updErr } = await sb
        .from('organization_members')
        .update(updates)
        .eq('organization_id', organizationId)
        .eq('user_id', realUserId)
        .select('*')
        .maybeSingle();

      if (!updErr && updData) {
        updatedMemberRow = updData;
      } else if (updErr && (updErr.message.includes('fixed_salary') || updErr.message.includes('assigned_projects'))) {
        // Fallback without newly-migrated columns if DB migration hasn't been applied yet
        const safeUpdates = { ...updates };
        delete safeUpdates.fixed_salary;
        delete safeUpdates.assigned_projects;
        if (Object.keys(safeUpdates).length > 0) {
          const { data: safeData } = await sb
            .from('organization_members')
            .update(safeUpdates)
            .eq('organization_id', organizationId)
            .eq('user_id', realUserId)
            .select('*')
            .maybeSingle();
          updatedMemberRow = safeData;
        }
      }
    } catch (e) {
      console.warn('[members.update] organization_members update error:', e);
    }

    // Sync metadata to auth.users so salary, assigned projects & accessRole persist across all sessions
    if (targetSalary !== undefined || targetProjects !== undefined || resolvedAccessRole !== undefined) {
      try {
        const { data: userRecord } = await sb.auth.admin.getUserById(realUserId);
        if (userRecord?.user) {
          const existingMeta = userRecord.user.user_metadata || {};
          const metaUpdates: Record<string, any> = {};
          if (targetSalary !== undefined) {
            metaUpdates.salary = Number(targetSalary);
            metaUpdates.fixed_salary = Number(targetSalary);
          }
          if (targetProjects !== undefined) {
            metaUpdates.assignedProjectIds = targetProjects;
            metaUpdates.assigned_projects = targetProjects;
          }
          if (resolvedAccessRole !== undefined) {
            metaUpdates.access_role = resolvedAccessRole;
          }
          await sb.auth.admin.updateUserById(realUserId, {
            user_metadata: { ...existingMeta, ...metaUpdates },
          });
        }
      } catch (e) {
        console.warn('[members.update] user_metadata update error:', e);
      }
    }

    // Also sync employee_team_members
    try {
      const tmUpdates: Record<string, any> = {};
      if (department !== undefined) tmUpdates.department = updates.department;
      if (targetSalary !== undefined) tmUpdates.salary = Number(targetSalary);
      if (targetProjects !== undefined) tmUpdates.assigned_projects = targetProjects;
      if (resolvedAccessRole !== undefined) tmUpdates.role = resolvedAccessRole;

      if (Object.keys(tmUpdates).length > 0) {
        const { data: updatedTm, error: tmUpdErr } = await sb
          .from('employee_team_members')
          .update(tmUpdates)
          .eq('organization_id', organizationId)
          .eq('user_id', realUserId)
          .select('id');

        // If no row existed in employee_team_members, create one
        if (!tmUpdErr && (!updatedTm || updatedTm.length === 0)) {
          const { data: profile } = await sb.from('profiles').select('email, full_name').eq('id', realUserId).maybeSingle();
          await sb.from('employee_team_members').upsert({
            id: `tm-${organizationId}-${realUserId}`,
            organization_id: organizationId,
            user_id: realUserId,
            name: profile?.full_name || 'Member',
            email: profile?.email || '',
            role: resolvedAccessRole || 'employee',
            department: updates.department || 'Development',
            status: 'active',
            joined_at: new Date().toISOString(),
            salary: Number(targetSalary || 0),
            assigned_projects: targetProjects || [],
          });
        }
      }
    } catch {
      /* ignore */
    }



    ok(res, {
      userId: realUserId,
      organizationId,
      role: resolvedOrgRole || currentRow?.role || 'employee',
      accessRole: resolvedAccessRole || currentRow?.access_role || 'team_member',
      department: updates.department ?? currentRow?.department,
      fixedSalary: targetSalary !== undefined ? Number(targetSalary) : (currentRow?.fixed_salary ? Number(currentRow.fixed_salary) : 0),
      assignedProjects: targetProjects ?? currentRow?.assigned_projects ?? [],
    }, 'Member updated');
  });

  // ── Role Permissions Endpoints ───────────────────────────────────────────
  // GET /organizations/:organizationId/roles/permissions
  r.get('/roles/permissions', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const sb = getSupabaseAdminClient();
    let orgSettings: Record<string, any> = {};
    if (sb) {
      try {
        const { data: org } = await sb.from('organizations').select('settings').eq('id', orgId).maybeSingle();
        if (org && org.settings) orgSettings = org.settings;
      } catch (err) {
        console.warn('[roles.permissions] failed to fetch org settings:', err);
      }
    }

    const custom = orgSettings.role_permissions || {};
    const effective = {
      org_admin: ['all'],
      accountant: Array.isArray(custom.accountant) ? custom.accountant : DEFAULT_ROLE_PERMISSIONS.accountant,
      team_member: Array.isArray(custom.team_member) ? custom.team_member : DEFAULT_ROLE_PERMISSIONS.team_member,
      viewer: Array.isArray(custom.viewer) ? custom.viewer : DEFAULT_ROLE_PERMISSIONS.viewer,
    };

    return ok(res, effective);
  });

  // PUT /organizations/:organizationId/roles/:roleId/permissions
  r.put('/roles/:roleId/permissions', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const roleId = paramStr(req.params.roleId);
    const { permissions } = req.body as { permissions: string[] };

    if (!Array.isArray(permissions)) {
      return fail(res, 400, 'Permissions array is required');
    }

    if (!['org_admin', 'accountant', 'team_member', 'viewer'].includes(roleId)) {
      return fail(res, 400, `Unknown role: ${roleId}`);
    }

    const sb = getSupabaseAdminClient();
    let currentSettings: Record<string, any> = {};

    if (sb) {
      try {
        const { data: org } = await sb.from('organizations').select('settings').eq('id', orgId).maybeSingle();
        if (org?.settings) currentSettings = { ...org.settings };
      } catch (err) {
        console.warn('[roles.permissions.put] failed to fetch existing settings:', err);
      }
    }

    const currentRolePerms = currentSettings.role_permissions || {};
    const updatedRolePerms = {
      ...currentRolePerms,
      [roleId]: permissions,
    };
    const updatedSettings = {
      ...currentSettings,
      role_permissions: updatedRolePerms,
    };

    if (sb) {
      try {
        const { error } = await sb.from('organizations').update({ settings: updatedSettings }).eq('id', orgId);
        if (error) {
          console.error('[roles.permissions.put] Supabase update error:', error);
          return fail(res, 500, error.message);
        }
      } catch (err: any) {
        console.error('[roles.permissions.put] exception updating Supabase:', err);
        return fail(res, 500, err?.message || 'Database error');
      }
    }



    const effective = {
      org_admin: ['all'],
      accountant: Array.isArray(updatedRolePerms.accountant) ? updatedRolePerms.accountant : DEFAULT_ROLE_PERMISSIONS.accountant,
      team_member: Array.isArray(updatedRolePerms.team_member) ? updatedRolePerms.team_member : DEFAULT_ROLE_PERMISSIONS.team_member,
      viewer: Array.isArray(updatedRolePerms.viewer) ? updatedRolePerms.viewer : DEFAULT_ROLE_PERMISSIONS.viewer,
    };

    return ok(res, {
      roleId,
      permissions: effective[roleId as keyof typeof effective],
      allRoles: effective,
    });
  });

  interface SingleInviteInput {
    email: string;
    name?: string;
    role?: string;
    department?: string;
    position?: string;
  }

  interface InviteResult {
    email: string;
    success: boolean;
    member?: OrganizationMember;
    error?: string;
    previewUrl?: string;
    message?: string;
  }

  async function executeInvite(orgId: string, item: SingleInviteInput): Promise<InviteResult> {
    const trimmedEmail = item.email?.trim().toLowerCase();
    if (!trimmedEmail) {
      return { email: '', success: false, error: 'Email is required' };
    }

    const assignedDept = item.department?.trim() || 'Development';
    const positionTitle = item.position?.trim() || ''; // Job title (UI/UX Designer, etc.)
    const roleInput = item.role?.trim() || 'employee';

    // Map input role to system role
    let normalizedRole: OrganizationMember['role'] = 'employee';
    let portalType: OrganizationMember['portalType'] = 'employee';

    const lowerRole = roleInput.toLowerCase();
    if (lowerRole === 'owner' || lowerRole.includes('owner')) {
      normalizedRole = 'owner';
      portalType = 'organization_admin';
    } else if (lowerRole === 'admin' || lowerRole === 'organization admin') {
      normalizedRole = 'admin';
      portalType = 'organization_admin';
    } else if (lowerRole === 'accountant') {
      normalizedRole = 'employee'; // Accountants are employees with special permissions
      portalType = 'employee';
    } else if (lowerRole === 'viewer') {
      normalizedRole = 'employee';
      portalType = 'employee';
    } else {
      normalizedRole = 'employee';
      portalType = 'employee';
    }

    // Org + invitee + duplicate checks all resolve against Supabase. The local store is no longer a
    // fallback: an org that exists only in Postgres must still be invitable, and a duplicate must
    // be detected against the same table `requireOrgMembership` reads.
    let sb: Sb | null = null;
    let org: Organization | null = null;

    if (isSupabaseAdminConfigured()) {
      sb = getSupabaseAdminClient()!;
      org = await sbOrgByIdOrSlug(sb, orgId);
    }

    if (!org) {
      return { email: trimmedEmail, success: false, error: 'Organization not found' };
    }

    const orgName = org.name || 'Organization';

    // Resolve the invitee as a real auth user so `organization_members.user_id` gets a valid UUID.
    const existingSbUser = sb ? await findAuthUserByEmail(sb, trimmedEmail) : null;
    let authUserId: string | null = existingSbUser?.id ?? null;

    if (sb && authUserId) {
      const { data: dup } = await sb
        .from('organization_members')
        .select('user_id, status')
        .eq('user_id', authUserId)
        .eq('organization_id', org.id)
        .maybeSingle();

      if (dup && dup.status === 'active') {
        return {
          email: trimmedEmail,
          success: false,
          error: 'That person is already an active member of this organization',
        };
      }
    }

    let actionLink: string | undefined = undefined;
    let inviteSuccessful = false;

    if (isSupabaseAdminConfigured() && sb) {
      try {
        const clientRedirectUrl = `${env.corsOrigin || 'http://localhost:5173'}/accept-invite`;
        const orgKey = org.id || orgId;

        // Resolve real department_id so headcount for overhead allocation is automatically linked
        let matchedDeptId: string | null = null;
        try {
          const { data: deptRows } = await sb
            .from('departments')
            .select('id, name')
            .eq('organization_id', orgKey);
          if (deptRows && deptRows.length > 0) {
            const match = deptRows.find(
              (d: any) =>
                d.id === assignedDept ||
                d.name.toLowerCase() === assignedDept.toLowerCase() ||
                d.name.toLowerCase().includes(assignedDept.toLowerCase()) ||
                assignedDept.toLowerCase().includes(d.name.toLowerCase())
            );
            if (match) matchedDeptId = match.id;
          }
        } catch {
          /* ignore */
        }

        if (existingSbUser) {
          // Already has an auth account — just (re)grant the pending membership.
          authUserId = existingSbUser.id;

          const { error: upsertError } = await sb.from('organization_members').upsert({
            organization_id: orgKey,
            user_id: authUserId,
            role: normalizedRole,
            portal_type: portalType,
            status: 'pending',
            department: assignedDept,
            department_id: matchedDeptId || undefined,
            position: positionTitle,
            joined_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,organization_id'
          });

          if (upsertError) throw upsertError;

          await sb.auth.admin.updateUserById(authUserId, {
            user_metadata: {
              ...(existingSbUser.user_metadata || {}),
              full_name: item.name?.trim() || (existingSbUser.user_metadata as any)?.full_name || trimmedEmail.split('@')[0],
              role: normalizedRole,
              position: positionTitle,
              department: assignedDept,
              organization_id: orgKey,
              organization_name: orgName,
            },
          });

          await sb.from('profiles').upsert({
            id: authUserId,
            email: trimmedEmail,
            full_name: item.name?.trim() || (existingSbUser.user_metadata as any)?.full_name || trimmedEmail.split('@')[0],
            platform_role: 'organization_user',
            created_at: existingSbUser.created_at || new Date().toISOString(),
          });

          await sb.from('employee_team_members').upsert({
            id: `tm-${orgKey}-${authUserId}`,
            organization_id: orgKey,
            user_id: authUserId,
            name: item.name?.trim() || (existingSbUser.user_metadata as any)?.full_name || trimmedEmail.split('@')[0],
            email: trimmedEmail,
            role: positionTitle,
            department: assignedDept,
            joined_at: new Date().toISOString(),
            status: 'pending',
          }, {
            onConflict: 'id'
          });

          try {
            const { data: linkData } = await sb.auth.admin.generateLink({
              type: 'magiclink',
              email: trimmedEmail,
              options: { redirectTo: clientRedirectUrl },
            });
            if (linkData?.properties?.action_link) {
              actionLink = linkData.properties.action_link;
            }
          } catch (linkErr) {
            console.warn('[invite] Magic link generation warning:', linkErr);
          }

          // Trigger Supabase to dispatch email directly through Supabase Auth mailer
          try {
            const { error: otpErr } = await sb.auth.signInWithOtp({
              email: trimmedEmail,
              options: {
                emailRedirectTo: clientRedirectUrl,
                data: {
                  organization_id: orgKey,
                  organization_name: orgName,
                },
              },
            });
            if (otpErr) {
              console.warn('[invite] Supabase signInWithOtp notice:', otpErr.message);
            } else {
              console.log('[invite] Supabase sent invitation email to:', trimmedEmail);
            }
          } catch (otpExc) {
            console.warn('[invite] Supabase signInWithOtp exception:', otpExc);
          }

          inviteSuccessful = true;
        } else {
          const { data: inviteData, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(trimmedEmail, {
            data: {
              full_name: item.name?.trim() || trimmedEmail.split('@')[0],
              platform_role: 'organization_user',
              organization_id: orgKey,
              organization_name: orgName,
              department: assignedDept,
              role: normalizedRole,
              position: positionTitle,
              status: 'pending',
            },
            redirectTo: clientRedirectUrl,
          });

          if (!inviteErr && inviteData?.user) {
            authUserId = inviteData.user.id;

            await sb.from('organization_members').upsert({
              organization_id: orgKey,
              user_id: authUserId,
              role: normalizedRole,
              portal_type: portalType,
              status: 'pending',
              department: assignedDept,
              department_id: matchedDeptId || undefined,
              position: positionTitle,
              joined_at: new Date().toISOString(),
            }, {
              onConflict: 'user_id,organization_id'
            });

            await sb.from('profiles').upsert({
              id: authUserId,
              email: trimmedEmail,
              full_name: item.name?.trim() || trimmedEmail.split('@')[0],
              platform_role: 'organization_user',
              created_at: inviteData.user.created_at || new Date().toISOString(),
            });

            await sb.from('employee_team_members').upsert({
              id: `tm-${orgKey}-${authUserId}`,
              organization_id: orgKey,
              user_id: authUserId,
              name: item.name?.trim() || trimmedEmail.split('@')[0],
              email: trimmedEmail,
              role: positionTitle,
              department: assignedDept,
              joined_at: new Date().toISOString(),
              status: 'pending',
            }, {
              onConflict: 'id'
            });

            inviteSuccessful = true;
          } else {
            console.warn('[invite] inviteUserByEmail returned error or fallback needed:', inviteErr?.message);
            // Trigger Supabase mailer via signInWithOtp
            try {
              await sb.auth.signInWithOtp({
                email: trimmedEmail,
                options: {
                  emailRedirectTo: clientRedirectUrl,
                  data: {
                    organization_id: orgKey,
                    organization_name: orgName,
                  },
                },
              });
            } catch {
              /* ignore */
            }

            try {
              const { data: linkData } = await sb.auth.admin.generateLink({
                type: 'invite',
                email: trimmedEmail,
                options: {
                  redirectTo: clientRedirectUrl,
                  data: {
                    full_name: item.name?.trim() || trimmedEmail.split('@')[0],
                    organization_id: orgKey,
                    organization_name: orgName,
                    department: assignedDept,
                    department_id: matchedDeptId || undefined,
                    role: normalizedRole,
                    position: positionTitle,
                    status: 'pending',
                  },
                },
              });
              if (linkData) {
                if (linkData.user) authUserId = linkData.user.id;
                if (linkData.properties?.action_link) actionLink = linkData.properties.action_link;
                if (authUserId) {
                  await sb.from('organization_members').upsert({
                    organization_id: orgKey,
                    user_id: authUserId,
                    role: normalizedRole,
                    portal_type: portalType,
                    status: 'pending',
                    department: assignedDept,
                    department_id: matchedDeptId || undefined,
                    position: positionTitle,
                    joined_at: new Date().toISOString(),
                  }, {
                    onConflict: 'user_id,organization_id'
                  });

                  await sb.from('employee_team_members').upsert({
                    id: `tm-${orgKey}-${authUserId}`,
                    organization_id: orgKey,
                    user_id: authUserId,
                    name: item.name?.trim() || trimmedEmail.split('@')[0],
                    email: trimmedEmail,
                    role: positionTitle,
                    department: assignedDept,
                    joined_at: new Date().toISOString(),
                    status: 'pending',
                  }, {
                    onConflict: 'id'
                  });
                }
                inviteSuccessful = true;
              }
            } catch (linkErr) {
              console.error('[invite] generateLink exception:', linkErr);
            }
          }
        }
      } catch (e) {
        console.error('[invite] Supabase admin error:', e);
        return { email: trimmedEmail, success: false, error: e instanceof Error ? e.message : 'Database error' };
      }
    } else {
      // Supabase is mandatory now — reporting a successful invite with no auth user created is
      // exactly the false-success that left invited people unable to ever sign in.
      return { email: trimmedEmail, success: false, error: 'Database connection required. Please configure Supabase.' };
    }

    if (!inviteSuccessful) {
      return { email: trimmedEmail, success: false, error: 'Failed to create user in database' };
    }

    const clientOrigin = env.corsOrigin || 'http://localhost:5173';
    // The login page is sign-in only. First-time invitees activate their password via
    // `acceptInviteUrl`, so the portal link is just the everyday sign-in entry point.
    const portalUrl = `${clientOrigin}/login/employee?email=${encodeURIComponent(trimmedEmail)}&org=${encodeURIComponent(org!.slug || orgId)}`;
    const acceptInviteUrl = actionLink || `${clientOrigin}/accept-invite?email=${encodeURIComponent(trimmedEmail)}`;

    const mailRes = await sendInviteEmail({
      toEmail: trimmedEmail,
      name: item.name?.trim() || trimmedEmail.split('@')[0],
      organizationName: orgName,
      organizationId: org.id || orgId,
      role: positionTitle,
      portalUrl,
      acceptInviteUrl,
    });

    const member: OrganizationMember = {
      userId: authUserId ?? '',
      organizationId: org!.id || orgId,
      role: normalizedRole,
      portalType,
      status: 'pending',
      joinedAt: new Date().toISOString(),
    };

    // Read straight back from Supabase so the response reflects what was actually persisted.
    if (sb && authUserId) {
      const { data: persisted } = await sb
        .from('organization_members')
        .select('user_id, organization_id, role, portal_type, status, department, joined_at')
        .eq('user_id', authUserId)
        .eq('organization_id', org!.id || orgId)
        .maybeSingle();
      if (persisted) {
        return {
          email: trimmedEmail,
          success: true,
          member: rowToMember(persisted as unknown as Record<string, unknown>),
          previewUrl: mailRes.previewUrl,
          message: mailRes.previewUrl
            ? `Invitation sent to ${trimmedEmail}! Preview: ${mailRes.previewUrl}`
            : `Invitation sent to ${trimmedEmail}!`,
        };
      }
    }

    return {
      email: trimmedEmail,
      success: true,
      member,
      previewUrl: mailRes.previewUrl,
      message: mailRes.previewUrl
        ? `Invitation sent to ${trimmedEmail}! Preview: ${mailRes.previewUrl}`
        : `Invitation sent to ${trimmedEmail}!`,
    };
  }

  // Single member invite
  r.post('/members/invite', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const { email, name, role, department, position } = req.body as SingleInviteInput;
    if (!email?.trim()) return fail(res, 400, 'Email is required');

    const result = await executeInvite(orgId, { email, name, role, department, position });
    if (!result.success) {
      return fail(res, 400, result.error || 'Failed to invite member');
    }

    created(res, result.member, result.message);
  });

  // Scalable Bulk member invite
  r.post('/members/bulk-invite', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const { invites } = req.body as { invites: SingleInviteInput[] };

    if (!Array.isArray(invites) || invites.length === 0) {
      return fail(res, 400, 'Please provide an array of invites to process');
    }

    const results: InviteResult[] = [];
    for (const item of invites) {
      if (!item.email?.trim()) continue;
      const resItem = await executeInvite(orgId, item);
      results.push(resItem);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    ok(res, {
      total: results.length,
      successful,
      failed,
      results,
    }, `${successful} of ${results.length} invitations sent successfully.`);
  });

  // Accept invitation endpoint
  r.post('/members/:userId/accept', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const userId = paramStr(req.params.userId);
    const reqUser = (req as any).authUser || (req as any).user;
    const targetUserId = userId || reqUser?.id;

    // SECURITY: an invitation can only be accepted by the invited user themselves
    if (reqUser?.id && targetUserId && reqUser.id !== targetUserId) {
      return fail(res, 403, 'You can only accept your own invitation');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: row, error: readErr } = await sb
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!row) return notFound(res, 'Membership invitation');

      const assignedDept = row.department || 'General';
      const userRoleTitle = row.role || 'employee';

      const { error: updErr } = await sb
        .from('organization_members')
        .update({ status: 'active', department: assignedDept })
        .eq('organization_id', orgId)
        .eq('user_id', targetUserId);
      if (updErr) throw updErr;

      const { data: authData } = await sb.auth.admin.getUserById(targetUserId);
      const u = authData?.user;
      if (u) {
        // Check existing employee_team_members row to preserve custom role
        const { data: existingTm } = await sb
          .from('employee_team_members')
          .select('role')
          .eq('organization_id', orgId)
          .eq('email', u.email || '')
          .maybeSingle();

        const finalRole = existingTm?.role || userRoleTitle;

        await sb.from('employee_team_members').upsert({
          id: `tm-${orgId}-${targetUserId}`,
          organization_id: orgId,
          user_id: targetUserId,
          name: (u.user_metadata as any)?.full_name || u.email?.split('@')[0] || 'Team Member',
          email: u.email || '',
          role: finalRole,
          department: assignedDept,
          joined_at: new Date().toISOString(),
          status: 'active',
        }, { onConflict: 'id' });
      }

      return ok(
        res,
        rowToMember({ ...row, status: 'active', department: assignedDept } as unknown as Record<string, unknown>),
        'Invitation accepted! You have joined the team.'
      );
    } catch (err) {
      console.warn('[members] Supabase accept failed:', err);
      return fail(res, 500, 'Failed to accept invitation');
    }
  });

  // Reject invitation endpoint
  r.post('/members/:userId/reject', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const userId = paramStr(req.params.userId);
    const reqUser = (req as any).authUser || (req as any).user;
    const targetUserId = userId || reqUser?.id;

    // SECURITY: an invitation can only be declined by the invited user themselves
    if (reqUser?.id && targetUserId && reqUser.id !== targetUserId) {
      return fail(res, 403, 'You can only decline your own invitation');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: row, error } = await sb
        .from('organization_members')
        .update({ status: 'rejected' })
        .eq('organization_id', orgId)
        .eq('user_id', targetUserId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!row) return notFound(res, 'Membership invitation');
      return ok(res, rowToMember(row as unknown as Record<string, unknown>), 'Invitation declined.');
    } catch (err) {
      console.warn('[members] Supabase reject failed:', err);
      return fail(res, 500, 'Failed to decline invitation');
    }
  });
  // Resend invitation endpoint
  // Resend invitation endpoint (supports both /resend-invite and /resend)
  const resendInviteHandler = async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const userId = paramStr(req.params.userId);

    const sb = getSupabaseAdminClient();
    let email: string | null = null;
    let userName: string | undefined = undefined;
    let role = 'employee';

    if (sb) {
      try {
        const { data: memberData } = await sb
          .from('organization_members')
          .select('*')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .maybeSingle();

        if (memberData) {
          role = memberData.role || 'employee';
          const { data: authUser } = await sb.auth.admin.getUserById(userId);
          if (authUser?.user?.email) {
            email = authUser.user.email;
            userName = (authUser.user.user_metadata as any)?.full_name;
          }
        }
      } catch (err) {
        console.warn('[resend-invite] Supabase query notice:', err);
      }
    }

    if (!sb) return fail(res, 503, 'Database unavailable');
    if (!email) return notFound(res, 'Member');

    let org: { name?: string; slug?: string } | null = null;
    try {
      const { data: orgRow } = await sb.from('organizations').select('name, slug').eq('id', orgId).maybeSingle();
      org = orgRow;
    } catch {
      /* ignore */
    }
    const orgName = org?.name || 'Organization';

    const clientOrigin = env.corsOrigin || 'http://localhost:5173';
    const clientRedirectUrl = `${clientOrigin}/accept-invite`;
    let actionLink: string | undefined = undefined;

    // Trigger Supabase email directly via Supabase Auth
    if (sb && email) {
      try {
        const { error: otpErr } = await sb.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: clientRedirectUrl,
            data: {
              organization_id: orgId,
              organization_name: orgName,
            },
          },
        });
        if (otpErr) {
          console.warn('[resend-invite] Supabase signInWithOtp notice:', otpErr.message);
        } else {
          console.log('[resend-invite] Supabase resent invitation email to:', email);
        }
      } catch (err) {
        console.warn('[resend-invite] Supabase send error:', err);
      }

      try {
        const { data: linkData } = await sb.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: clientRedirectUrl },
        });
        if (linkData?.properties?.action_link) {
          actionLink = linkData.properties.action_link;
        }
      } catch {
        /* ignore */
      }
    }

    const portalUrl = `${clientOrigin}/login/employee?email=${encodeURIComponent(email)}&org=${encodeURIComponent(org?.slug || orgId)}&setup=true`;
    const acceptInviteUrl = actionLink || `${clientOrigin}/accept-invite?email=${encodeURIComponent(email)}`;

    let mailRes: { previewUrl?: string } = {};
    try {
      mailRes = await sendInviteEmail({
        toEmail: email,
        name: userName,
        organizationName: orgName,
        organizationId: orgId,
        role,
        portalUrl,
        acceptInviteUrl,
      });
    } catch {
      /* ignore */
    }

    ok(res, {
      previewUrl: actionLink || mailRes.previewUrl,
      inviteUrl: acceptInviteUrl,
    }, `Invitation email resent via Supabase to ${email}`);
  };

  r.post('/members/:userId/resend-invite', ownerOrAdmin, resendInviteHandler);
  r.post('/members/:userId/resend', ownerOrAdmin, resendInviteHandler);


  r.delete('/members/:userId', ownerOrAdmin, async (req: Request, res: Response) => {
    const organizationId = paramStr(req.params.organizationId);
    const userId = paramStr(req.params.userId);

    if (!isSupabaseAdminConfigured()) {
      return fail(res, 503, 'Database connection required. Please configure Supabase.');
    }
    const sb = getSupabaseAdminClient()!;

    const realUserId = userId.length === 36 && userId.includes('-')
      ? userId
      : (await findAuthUserIdByLegacyId(userId)) ?? userId;

    const { data, error } = await sb
      .from('organization_members')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', realUserId)
      .select('user_id')
      .maybeSingle();

    if (error) {
      console.error('[members] delete failed:', error.message);
      return fail(res, 500, 'Could not remove member.');
    }
    if (!data) return notFound(res, 'Member');

    ok(res, null, 'Member removed');
  });

  // ---- §18 extras: team directory + announcements ----

  r.get('/team-directory', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const isPlatform = (req as any).user?.role === 'platform_admin' || (req as any).user?.role === 'platform_manager';

    let teamData: any[] = [];

    // Try Supabase first for real data (pending invites + active members)
    if (isSupabaseAdminConfigured()) {
      try {
        const sb = getSupabaseAdminClient()!;

        // Get all members from organization_members
        const { data: orgMembers, error: orgMemError } = await sb
          .from('organization_members')
          .select('*')
          .eq('organization_id', orgId)
          .in('status', ['pending', 'active']);

        if (orgMemError) {
          console.warn('[team-directory] Supabase org members query error:', orgMemError);
        }

        // Get active team members from employee_team_members
        const { data: activeMembers, error: activeError } = await sb
          .from('employee_team_members')
          .select('*')
          .eq('organization_id', orgId);

        if (activeError) {
          console.warn('[team-directory] Supabase active query error:', activeError);
        }

        // Fetch profiles for all organization_members to get email/name
        let profilesMap = new Map();
        if (orgMembers && orgMembers.length > 0) {
          const userIds = [...new Set(orgMembers.map((m: any) => m.user_id).filter(Boolean))];
          if (userIds.length > 0) {
            const { data: profilesData } = await sb
              .from('profiles')
              .select('*')
              .in('id', userIds);
            if (profilesData) {
              profilesData.forEach((p: any) => profilesMap.set(p.id, p));
            }
          }
        }

        const mapByEmail = new Map<string, any>();

        // 1. Add employee_team_members rows
        (activeMembers || []).forEach((m: any) => {
          const emailKey = (m.email || '').toLowerCase().trim() || m.id;
          mapByEmail.set(emailKey, {
            id: m.user_id || m.id,
            userId: m.user_id || m.id,
            organizationId: m.organization_id,
            name: m.name,
            email: m.email,
            phone: m.phone || '',
            role: m.role,
            department: m.department || 'Development',
            joinedAt: m.joined_at || new Date().toISOString(),
            status: m.status || 'active',
            isPending: m.status === 'pending',
          });
        });

        // 2. Add or overlay organization_members rows
        (orgMembers || []).forEach((m: any) => {
          const profile = profilesMap.get(m.user_id);
          const email = (profile?.email || '').toLowerCase().trim();
          const emailKey = email || m.user_id;
          const resolvedPhone =
            m.phone ||
            m.employee_settings?.profile?.phone ||
            profile?.phone ||
            profile?.employee_settings?.profile?.phone ||
            '';

          if (!mapByEmail.has(emailKey)) {
            mapByEmail.set(emailKey, {
              id: m.user_id || m.id,
              userId: m.user_id || m.id,
              organizationId: m.organization_id,
              name: profile?.full_name || email.split('@')[0] || 'Team Member',
              email: profile?.email || '',
              phone: resolvedPhone,
              role: m.role === 'owner' ? 'Organization Owner' : m.role === 'admin' ? 'Admin' : (m.position || 'Team Member'),
              department: m.department || (m.role === 'owner' ? 'Management' : 'Development'),
              joinedAt: m.joined_at || new Date().toISOString(),
              status: m.status || 'active',
              isPending: m.status === 'pending',
            });
          } else {
            const existing = mapByEmail.get(emailKey);
            if (m.user_id) {
              existing.id = m.user_id;
              existing.userId = m.user_id;
            }
            if (profile?.full_name) existing.name = profile.full_name;
            if (resolvedPhone && !existing.phone) existing.phone = resolvedPhone;
            if (m.department) existing.department = m.department;
            if (m.position) existing.role = m.position;
          }
        });

        teamData = Array.from(mapByEmail.values());
      } catch (e) {
        console.error('[team-directory] Supabase query failed:', e);
        return fail(res, 500, `Database error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    } else {
      return fail(res, 503, 'Database connection required. Please configure Supabase.');
    }

    // No `store.teamMembers` fallback — that is seed data, not real members.
    ok(res, teamData);
  });

  // ---- Cross-Functional Agency Teams / Squads (Backed by `agency_teams` & `agency_team_members` tables) ----
  async function loadEnrichedAgencyTeams(orgId: string) {
    const sb = getSupabaseAdminClient();
    if (!sb) return [];

    const [
      { data: dbTeams, error: dbTeamsErr },
      { data: dbTeamMembers },
      { data: orgRow },
      { data: orgMembers },
      { data: empMembers },
      { data: projectsData },
    ] = await Promise.all([
      sb.from('agency_teams').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      sb.from('agency_team_members').select('*').eq('organization_id', orgId),
      sb.from('organizations').select('settings').eq('id', orgId).maybeSingle(),
      sb.from('organization_members').select('*').eq('organization_id', orgId),
      sb.from('employee_team_members').select('*').eq('organization_id', orgId),
      sb.from('projects').select('id, name, client_name').eq('organization_id', orgId),
    ]);

    const userIds = [...new Set((orgMembers || []).map((m: any) => m.user_id).filter(Boolean))];
    const profilesMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: profiles } = await sb.from('profiles').select('id, email, full_name').in('id', userIds);
      (profiles || []).forEach((p: any) => profilesMap.set(p.id, p));
    }

    const empByUserId = new Map<string, any>();
    const empByEmail = new Map<string, any>();
    (empMembers || []).forEach((em: any) => {
      if (em.user_id) empByUserId.set(em.user_id, em);
      if (em.email) empByEmail.set(String(em.email).toLowerCase().trim(), em);
    });

    const memberDirectory = new Map<string, {
      userId: string;
      name: string;
      email: string;
      department: string;
      role: string;
      orgRole: string;
    }>();

    (orgMembers || []).forEach((m: any) => {
      const uid = String(m.user_id);
      const prof = profilesMap.get(uid);
      const email = String(prof?.email || '').trim();
      const em = empByUserId.get(uid) || (email ? empByEmail.get(email.toLowerCase()) : null);
      const name = em?.name || prof?.full_name || (email ? email.split('@')[0] : 'Team Member');
      const department = m.department || em?.department || (m.role === 'owner' ? 'Management' : 'General');
      const role = m.position || em?.role || (m.role === 'owner' ? 'Organization Owner' : 'Team Member');
      memberDirectory.set(uid, {
        userId: uid,
        name,
        email,
        department,
        role,
        orgRole: String(m.role || 'employee'),
      });
    });

    const projectMap = new Map<string, { name: string; clientName?: string }>();
    (projectsData || []).forEach((p: any) => {
      projectMap.set(String(p.id), { name: p.name, clientName: p.client_name });
    });

    // Combine relational `public.agency_teams` rows with any settings-based teams (and auto-backfill relational table if available)
    const settingsTeams: any[] = Array.isArray(orgRow?.settings?.agency_teams)
      ? orgRow.settings.agency_teams
      : [];

    let rawTeams: any[] = [];
    if (!dbTeamsErr && Array.isArray(dbTeams)) {
      const dbTeamIds = new Set(dbTeams.map((t: any) => String(t.id)));
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

      // Auto-sync any team from settings that wasn't yet inserted into `public.agency_teams`
      for (const st of settingsTeams) {
        if (st?.id && !dbTeamIds.has(String(st.id))) {
          rawTeams.push(st);
          try {
            await sb.from('agency_teams').upsert({
              id: String(st.id),
              organization_id: orgId,
              name: String(st.name || 'Agency Squad'),
              description: String(st.description || ''),
              project_id: st.projectId || null,
              lead_user_id: st.leadUserId || null,
              status: st.status === 'archived' ? 'archived' : 'active',
              created_at: st.createdAt || new Date().toISOString(),
            });
            const mIds: string[] = Array.isArray(st.memberIds) ? st.memberIds.map(String) : [];
            if (mIds.length > 0) {
              await sb.from('agency_team_members').upsert(
                mIds.map((uid) => ({
                  team_id: String(st.id),
                  organization_id: orgId,
                  user_id: uid,
                  department: memberDirectory.get(uid)?.department || 'Development',
                  role_in_team: uid === st.leadUserId ? 'lead' : 'member',
                })),
                { onConflict: 'team_id,user_id' },
              );
            }
          } catch {
            /* ignore if migration not yet run */
          }
        }
      }
    } else {
      rawTeams = settingsTeams;
    }

    return rawTeams.map((t: any) => {
      const memberIds: string[] = Array.isArray(t.memberIds)
        ? t.memberIds.map(String)
        : Array.isArray(t.members)
          ? t.members.map((m: any) => String(m.userId || m.id))
          : [];

      const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
      const members = uniqueMemberIds.map((uid) => {
        const live = memberDirectory.get(uid);
        const saved = Array.isArray(t.members) ? t.members.find((m: any) => (m.userId || m.id) === uid) : null;
        return {
          userId: uid,
          name: live?.name || saved?.name || 'Team Member',
          email: live?.email || saved?.email || '',
          department: live?.department || saved?.department || 'General',
          role: live?.role || saved?.role || 'Team Member',
          isLead: uid === t.leadUserId,
        };
      });

      const departments = Array.from(new Set(members.map((m) => m.department).filter(Boolean)));
      const proj = t.projectId ? projectMap.get(String(t.projectId)) : undefined;
      const leadMember = members.find((m) => m.userId === t.leadUserId) || members[0] || null;

      return {
        id: String(t.id),
        organizationId: orgId,
        name: String(t.name || 'Agency Squad'),
        description: String(t.description || ''),
        projectId: t.projectId || undefined,
        projectName: proj?.name || t.projectName || undefined,
        leadUserId: leadMember?.userId || t.leadUserId || undefined,
        leadName: leadMember?.name || undefined,
        memberIds: uniqueMemberIds,
        members,
        departments,
        status: t.status || 'active',
        createdAt: t.createdAt || new Date().toISOString(),
      };
    });
  }

  r.get('/teams', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    try {
      const teams = await loadEnrichedAgencyTeams(orgId);
      return ok(res, teams);
    } catch (err: any) {
      console.error('[teams.get] error:', err);
      return fail(res, 500, err?.message || 'Failed to load agency teams');
    }
  });

  r.post('/teams', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const { name, description, projectId, leadUserId, memberIds } = req.body as {
      name?: string;
      description?: string;
      projectId?: string;
      leadUserId?: string;
      memberIds?: string[];
    };

    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      return fail(res, 400, 'Team name is required');
    }
    const cleanMemberIds = Array.from(new Set((Array.isArray(memberIds) ? memberIds : []).map(String).filter(Boolean)));
    if (cleanMemberIds.length === 0) {
      return fail(res, 400, 'Select at least one employee for the team');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required');

    try {
      const newTeamId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const resolvedProjectId = projectId && projectId !== '__none__' ? projectId : undefined;
      const resolvedLeadId = leadUserId && cleanMemberIds.includes(leadUserId) ? leadUserId : cleanMemberIds[0];
      const nowIso = new Date().toISOString();

      // 1. Insert into relational `public.agency_teams` & `public.agency_team_members` tables
      const { error: teamTableErr } = await sb.from('agency_teams').insert({
        id: newTeamId,
        organization_id: orgId,
        name: trimmedName,
        description: (description || '').trim(),
        project_id: resolvedProjectId || null,
        lead_user_id: resolvedLeadId || null,
        status: 'active',
        created_at: nowIso,
        updated_at: nowIso,
      });

      if (!teamTableErr) {
        const { data: memberDeptRows } = await sb
          .from('organization_members')
          .select('user_id, department')
          .eq('organization_id', orgId)
          .in('user_id', cleanMemberIds);
        const deptMap = new Map<string, string>();
        (memberDeptRows || []).forEach((r: any) => {
          if (r.user_id && r.department) deptMap.set(String(r.user_id), String(r.department));
        });

        await sb.from('agency_team_members').upsert(
          cleanMemberIds.map((uid) => ({
            team_id: newTeamId,
            organization_id: orgId,
            user_id: uid,
            department: deptMap.get(uid) || 'Development',
            role_in_team: uid === resolvedLeadId ? 'lead' : 'member',
            joined_at: nowIso,
          })),
          { onConflict: 'team_id,user_id' },
        );
      }

      // 2. Also keep `organizations.settings.agency_teams` synchronized
      const { data: orgRow } = await sb.from('organizations').select('settings').eq('id', orgId).maybeSingle();
      const currentSettings = (orgRow?.settings && typeof orgRow.settings === 'object') ? { ...orgRow.settings } : {};
      const existingTeams: any[] = Array.isArray(currentSettings.agency_teams) ? [...currentSettings.agency_teams] : [];

      const newTeam = {
        id: newTeamId,
        organizationId: orgId,
        name: trimmedName,
        description: (description || '').trim(),
        projectId: resolvedProjectId,
        leadUserId: resolvedLeadId,
        memberIds: cleanMemberIds,
        status: 'active',
        createdAt: nowIso,
      };

      await sb
        .from('organizations')
        .update({
          settings: {
            ...currentSettings,
            agency_teams: [newTeam, ...existingTeams],
          },
        })
        .eq('id', orgId);

      // 3. If a project is linked to this squad, automatically ensure all squad members are assigned to that project
      if (newTeam.projectId) {
        for (const uid of cleanMemberIds) {
          const { data: om } = await sb
            .from('organization_members')
            .select('assigned_projects')
            .eq('organization_id', orgId)
            .eq('user_id', uid)
            .maybeSingle();
          const currentProj: string[] = Array.isArray(om?.assigned_projects) ? om.assigned_projects : [];
          if (!currentProj.includes(newTeam.projectId)) {
            const nextProj = [...currentProj, newTeam.projectId];
            await sb
              .from('organization_members')
              .update({ assigned_projects: nextProj })
              .eq('organization_id', orgId)
              .eq('user_id', uid);
          }
        }
      }

      const enriched = await loadEnrichedAgencyTeams(orgId);
      const createdTeam = enriched.find((t) => t.id === newTeam.id) || newTeam;
      return created(res, createdTeam, `Team "${trimmedName}" created`);
    } catch (err: any) {
      console.error('[teams.post] error:', err);
      return fail(res, 500, err?.message || 'Failed to create team');
    }
  });

  r.patch('/teams/:teamId', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const teamId = paramStr(req.params.teamId);
    const { name, description, projectId, leadUserId, memberIds } = req.body as {
      name?: string;
      description?: string;
      projectId?: string;
      leadUserId?: string;
      memberIds?: string[];
    };

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required');

    try {
      const nextMemberIds = Array.isArray(memberIds)
        ? Array.from(new Set(memberIds.map(String).filter(Boolean)))
        : undefined;
      const resolvedProjId = projectId !== undefined ? (projectId && projectId !== '__none__' ? projectId : null) : undefined;

      // 1. Update relational `public.agency_teams` & `public.agency_team_members`
      const dbPatch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (name !== undefined) dbPatch.name = name.trim();
      if (description !== undefined) dbPatch.description = description.trim();
      if (resolvedProjId !== undefined) dbPatch.project_id = resolvedProjId;
      if (leadUserId !== undefined) dbPatch.lead_user_id = leadUserId || null;

      await sb.from('agency_teams').update(dbPatch).eq('id', teamId).eq('organization_id', orgId);

      if (nextMemberIds) {
        await sb.from('agency_team_members').delete().eq('team_id', teamId).eq('organization_id', orgId);
        if (nextMemberIds.length > 0) {
          const { data: memberDeptRows } = await sb
            .from('organization_members')
            .select('user_id, department')
            .eq('organization_id', orgId)
            .in('user_id', nextMemberIds);
          const deptMap = new Map<string, string>();
          (memberDeptRows || []).forEach((r: any) => {
            if (r.user_id && r.department) deptMap.set(String(r.user_id), String(r.department));
          });

          const effectiveLead = leadUserId || nextMemberIds[0];
          await sb.from('agency_team_members').insert(
            nextMemberIds.map((uid) => ({
              team_id: teamId,
              organization_id: orgId,
              user_id: uid,
              department: deptMap.get(uid) || 'Development',
              role_in_team: uid === effectiveLead ? 'lead' : 'member',
            })),
          );
        }
      }

      // 2. Also update `organizations.settings.agency_teams`
      const { data: orgRow } = await sb.from('organizations').select('settings').eq('id', orgId).maybeSingle();
      const currentSettings = (orgRow?.settings && typeof orgRow.settings === 'object') ? { ...orgRow.settings } : {};
      const existingTeams: any[] = Array.isArray(currentSettings.agency_teams) ? [...currentSettings.agency_teams] : [];
      const idx = existingTeams.findIndex((t) => String(t.id) === teamId);
      if (idx !== -1) {
        const prev = existingTeams[idx];
        existingTeams[idx] = {
          ...prev,
          name: name !== undefined ? name.trim() : prev.name,
          description: description !== undefined ? description.trim() : prev.description,
          projectId: projectId !== undefined ? (projectId && projectId !== '__none__' ? projectId : undefined) : prev.projectId,
          memberIds: nextMemberIds ?? prev.memberIds,
          leadUserId: leadUserId !== undefined ? leadUserId : prev.leadUserId,
        };
        await sb
          .from('organizations')
          .update({ settings: { ...currentSettings, agency_teams: existingTeams } })
          .eq('id', orgId);
      }

      const enriched = await loadEnrichedAgencyTeams(orgId);
      const updatedTeam = enriched.find((t) => t.id === teamId);
      if (!updatedTeam) return notFound(res, 'Team');
      return ok(res, updatedTeam, 'Team updated');
    } catch (err: any) {
      console.error('[teams.patch] error:', err);
      return fail(res, 500, err?.message || 'Failed to update team');
    }
  });

  r.delete('/teams/:teamId', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const teamId = paramStr(req.params.teamId);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required');

    try {
      // 1. Delete from relational `public.agency_teams` (cascades to `public.agency_team_members`)
      await sb.from('agency_teams').delete().eq('id', teamId).eq('organization_id', orgId);

      // 2. Also remove from `organizations.settings.agency_teams`
      const { data: orgRow } = await sb.from('organizations').select('settings').eq('id', orgId).maybeSingle();
      const currentSettings = (orgRow?.settings && typeof orgRow.settings === 'object') ? { ...orgRow.settings } : {};
      const existingTeams: any[] = Array.isArray(currentSettings.agency_teams) ? [...currentSettings.agency_teams] : [];
      const nextTeams = existingTeams.filter((t) => String(t.id) !== teamId);

      await sb
        .from('organizations')
        .update({
          settings: {
            ...currentSettings,
            agency_teams: nextTeams,
          },
        })
        .eq('id', orgId);

      return ok(res, { id: teamId }, 'Team deleted');
    } catch (err: any) {
      console.error('[teams.delete] error:', err);
      return fail(res, 500, err?.message || 'Failed to delete team');
    }
  });

  // ---- §18 Company Announcements CRUD ----

  r.get('/announcements', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('company_announcements')
          .select('*')
          .eq('organization_id', orgId)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false });
        if (!error && data) {
          const mapped = data.map((a: any) => ({
            id: a.id,
            organizationId: a.organization_id,
            title: a.title,
            content: a.content,
            author: a.author || 'Leadership',
            category: a.category || 'general',
            createdAt: a.created_at,
            isPinned: Boolean(a.is_pinned),
          }));
          return ok(res, mapped);
        }
      } catch (err) {
        console.warn('[organizations.announcements] fetch error:', err);
      }
    }
    ok(res, []);
  });

  r.post('/announcements', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const { title, content, category = 'general', isPinned = false, author } = req.body as {
      title?: string;
      content?: string;
      category?: string;
      isPinned?: boolean;
      author?: string;
    };

    const trimmedTitle = (title || '').trim();
    const trimmedContent = (content || '').trim();

    if (!trimmedTitle) {
      return fail(res, 400, 'Title is required');
    }
    if (!trimmedContent) {
      return fail(res, 400, 'Content is required');
    }

    const validCategories = ['general', 'hr', 'finance', 'project', 'celebration'];
    const safeCategory = validCategories.includes(String(category).toLowerCase())
      ? String(category).toLowerCase()
      : 'general';

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required');

    try {
      const annId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const callerName = (req as any).user?.name || (req as any).user?.email || 'Leadership';
      const safeAuthor = (author || '').trim() || callerName;
      const nowIso = new Date().toISOString();

      const { data, error } = await sb
        .from('company_announcements')
        .insert({
          id: annId,
          organization_id: orgId,
          title: trimmedTitle,
          content: trimmedContent,
          author: safeAuthor,
          category: safeCategory,
          is_pinned: Boolean(isPinned),
          created_at: nowIso,
        })
        .select()
        .single();

      if (error) {
        console.error('[organizations.announcements] insert error:', error.message);
        return fail(res, 400, error.message);
      }

      // Complies with FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md §18 & §30:
      // Broadcast announcement notification to employee portal feed (filtered per-employee by companyAnnouncements toggle)
      try {
        await sb.from('notifications').insert({
          organization_id: orgId,
          portal: 'employee',
          title: `Announcement: ${trimmedTitle}`,
          message: trimmedContent.slice(0, 140),
          type: isPinned ? 'warning' : 'info',
          category: 'announcements',
          is_read: false,
          action_tab: 'announcements',
        });

        // Email channel dispatch for subscribed employees (§15, §30, §X-03)
        try {
          const { data: members } = await sb
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', orgId);

          if (Array.isArray(members) && members.length > 0) {
            const { resolveEmployeeUserSettings } = await import('./employee.js');
            const { sendNotificationEmail } = await import('../lib/emailService.js');

            for (const m of members) {
              if (!m.user_id) continue;
              const empSettings = await resolveEmployeeUserSettings(sb, orgId, m.user_id);
              if (
                empSettings.notifications.emailNotifications &&
                empSettings.notifications.companyAnnouncements &&
                empSettings.profile.email
              ) {
                await sendNotificationEmail({
                  toEmail: empSettings.profile.email,
                  name: empSettings.profile.fullName,
                  subject: `[Finance OS Announcement] ${trimmedTitle}`,
                  title: `Announcement: ${trimmedTitle}`,
                  message: trimmedContent.slice(0, 240),
                  actionUrl: `/employee?tab=announcements`,
                  actionLabel: 'Read Announcement',
                  category: 'announcements',
                }).catch(() => null);
              }
            }
          }
        } catch (emailErr) {
          console.warn('[organizations.announcements] Email broadcast warning:', emailErr);
        }
      } catch (notifErr) {
        console.warn('[organizations.announcements] Notification broadcast warning:', notifErr);
      }

      created(res, {
        id: data.id,
        organizationId: data.organization_id,
        title: data.title,
        content: data.content,
        author: data.author,
        category: data.category,
        createdAt: data.created_at,
        isPinned: Boolean(data.is_pinned),
      }, 'Announcement published successfully');
    } catch (err: any) {
      console.error('[organizations.announcements] create error:', err);
      fail(res, 500, err?.message || 'Failed to create announcement');
    }
  });

  r.patch('/announcements/:announcementId', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const annId = paramStr(req.params.announcementId);
    const { title, content, category, isPinned, author } = req.body as {
      title?: string;
      content?: string;
      category?: string;
      isPinned?: boolean;
      author?: string;
    };

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required');

    try {
      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = title.trim();
      if (content !== undefined) updates.content = content.trim();
      if (author !== undefined) updates.author = author.trim();
      if (isPinned !== undefined) updates.is_pinned = Boolean(isPinned);
      if (category !== undefined) {
        const validCategories = ['general', 'hr', 'finance', 'project', 'celebration'];
        if (validCategories.includes(String(category).toLowerCase())) {
          updates.category = String(category).toLowerCase();
        }
      }

      if (Object.keys(updates).length === 0) {
        return fail(res, 400, 'No fields to update');
      }

      const { data, error } = await sb
        .from('company_announcements')
        .update(updates)
        .eq('id', annId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error || !data) {
        return fail(res, 404, error?.message || 'Announcement not found');
      }

      ok(res, {
        id: data.id,
        organizationId: data.organization_id,
        title: data.title,
        content: data.content,
        author: data.author,
        category: data.category,
        createdAt: data.created_at,
        isPinned: Boolean(data.is_pinned),
      }, 'Announcement updated successfully');
    } catch (err: any) {
      console.error('[organizations.announcements] update error:', err);
      fail(res, 500, err?.message || 'Failed to update announcement');
    }
  });

  r.delete('/announcements/:announcementId', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const annId = paramStr(req.params.announcementId);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required');

    try {
      const { error } = await sb
        .from('company_announcements')
        .delete()
        .eq('id', annId)
        .eq('organization_id', orgId);

      if (error) {
        return fail(res, 400, error.message);
      }

      ok(res, { id: annId }, 'Announcement deleted successfully');
    } catch (err: any) {
      console.error('[organizations.announcements] delete error:', err);
      fail(res, 500, err?.message || 'Failed to delete announcement');
    }
  });

  // ---- §19 AI settings (BYOK with AES-256-GCM and Tenant Quota Tracking) ----

  r.get('/ai-settings', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const sb = getSupabaseAdminClient();

    let dbCreds: any = null;
    let dbStatus: any = null;
    if (sb) {
      try {
        const [credsRes, statusRes] = await Promise.all([
          sb.from('org_ai_credentials').select('*').eq('organization_id', orgId).maybeSingle(),
          sb.from('org_ai_status').select('*').eq('organization_id', orgId).maybeSingle(),
        ]);
        dbCreds = credsRes.data;
        dbStatus = statusRes.data;
      } catch (err: any) {
        console.error('[organizations] Failed to fetch org_ai_credentials:', err.message);
      }
    }

    const legacy: any = null;
    const useCustomKey = dbCreds ? Boolean(dbCreds.is_active) : Boolean(legacy?.useCustomKey);
    const provider = dbCreds?.provider || (legacy?.providerName ? legacy.providerName.toLowerCase() : 'gemini');
    const providerName = provider === 'openai' ? 'OpenAI' : 'Google Gemini';
    const modelName = dbCreds?.model_name || legacy?.modelName || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-lite-latest');
    const keyLast4 = dbCreds?.key_last4 || (legacy?.apiKey ? extractLast4(legacy.apiKey) : '');
    const maskedKey = keyLast4 ? `••••••••${keyLast4}` : '';
    const hasApiKey = Boolean(dbCreds?.key_ciphertext || legacy?.apiKey);

    const activeSource = useCustomKey && hasApiKey ? 'organization' : 'platform';
    const quotaExceeded = dbStatus?.org_key_status === 'quota_exceeded';

    ok(res, {
      useCustomKey,
      providerName,
      provider,
      modelName,
      apiKey: maskedKey,
      keyLast4,
      hasApiKey,
      activeSource,
      connectionStatus: dbCreds?.test_status || (hasApiKey ? 'valid' : 'unconfigured'),
      testError: dbCreds?.test_error || null,
      lastTestedAt: dbCreds?.last_tested_at || null,
      quotaExceeded,
      quotaResetAt: dbStatus?.org_key_reset_at || null,
      monthlyUsage: {
        orgRequests: dbStatus?.org_requests_this_month || 0,
        platformRequests: dbStatus?.platform_requests_this_month || 0,
      },
      featuresPowered: [
        'AI Financial Assistant (Chat & Strategy)',
        'Smart Transaction Classification',
        'Bank Statement Intelligence Parser',
      ],
    });
  });

  r.patch('/ai-settings', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const body = req.body as {
      useCustomKey?: boolean;
      providerName?: string;
      provider?: string;
      modelName?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    const sb = getSupabaseAdminClient();
    const rawKey = (body.apiKey || '').trim();
    const isNewKey = rawKey !== '' && !rawKey.includes('•') && !rawKey.includes('…');

    let resolvedProvider = (body.provider || body.providerName || 'gemini').toLowerCase();
    if (resolvedProvider.includes('openai')) resolvedProvider = 'openai';
    else resolvedProvider = 'gemini';

    const resolvedModel = body.modelName?.trim() || (resolvedProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-lite-latest');
    const useCustomKey = body.useCustomKey !== undefined ? Boolean(body.useCustomKey) : true;

    if (sb) {
      try {
        if (isNewKey) {
          const ciphertext = encryptSecret(rawKey, orgId);
          const last4 = extractLast4(rawKey);
          const fingerprint = fingerprintKey(rawKey);

          await sb.from('org_ai_credentials').upsert({
            organization_id: orgId,
            provider: resolvedProvider,
            model_name: resolvedModel,
            base_url: body.baseUrl?.trim() || null,
            key_ciphertext: ciphertext,
            key_last4: last4,
            key_fingerprint: fingerprint,
            is_active: useCustomKey,
            test_status: 'valid',
            last_tested_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } else {
          const updatePayload: Record<string, any> = {
            is_active: useCustomKey,
            provider: resolvedProvider,
            model_name: resolvedModel,
            updated_at: new Date().toISOString(),
          };
          if (body.baseUrl !== undefined) updatePayload.base_url = body.baseUrl.trim() || null;
          await sb.from('org_ai_credentials').update(updatePayload).eq('organization_id', orgId);
        }
      } catch (err: any) {
        console.error('[organizations] Supabase org_ai_credentials save error:', err.message);
      }
    }

    // Invalidate in-memory AI gateway cache
    invalidateOrgAICache(orgId);

    const next: OrgAiIntegrationSettings = {
      providerName: resolvedProvider === 'openai' ? 'OpenAI' : 'Google Gemini',
      modelName: resolvedModel,
      apiKey: isNewKey ? maskApiKey(rawKey) : '',
      useCustomKey,
    };

    ok(res, {
      ...next,
      provider: resolvedProvider,
      activeSource: useCustomKey ? 'organization' : 'platform',
      hasApiKey: Boolean(next.apiKey),
    }, 'AI connection settings saved securely.');
  });

  r.post('/ai-settings/test', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const body = req.body as {
      provider?: string;
      modelName?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    let provider = (body.provider || 'gemini').toLowerCase();
    if (provider.includes('openai')) provider = 'openai';
    else provider = 'gemini';

    let modelName = body.modelName?.trim() || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-lite-latest');
    let apiKey = (body.apiKey || '').trim();

    // If key not provided or masked, decrypt active key from Supabase
    if (!apiKey || apiKey.includes('•') || apiKey.includes('…')) {
      const sb = getSupabaseAdminClient();
      if (sb) {
        try {
          const { data: creds } = await sb.from('org_ai_credentials').select('*').eq('organization_id', orgId).maybeSingle();
          if (creds?.key_ciphertext) {
            apiKey = decryptSecret(creds.key_ciphertext, orgId);
            provider = creds.provider;
            modelName = creds.model_name;
          }
        } catch (err: any) {
          console.error('[organizations] Failed to retrieve key for test:', err.message);
        }
      }
    }

    if (!apiKey) {
      return fail(res, 400, 'Please enter an API key to test the connection.');
    }

    const testRes = await testAIConnection({
      provider: provider as AIProvider,
      modelName,
      apiKey,
      baseUrl: body.baseUrl,
    });

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb.from('org_ai_credentials').update({
          test_status: testRes.success ? 'valid' : (testRes.isQuotaExceeded ? 'quota_exceeded' : 'invalid'),
          test_error: testRes.error || null,
          last_tested_at: new Date().toISOString(),
        }).eq('organization_id', orgId);
      } catch { }
    }

    if (!testRes.success) {
      return fail(res, 400, testRes.error || 'Connection test failed.');
    }

    ok(res, testRes, `Connected successfully to ${testRes.provider} (${testRes.latencyMs}ms)!`);
  });

  r.delete('/ai-settings', ownerOrAdmin, async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb.from('org_ai_credentials').delete().eq('organization_id', orgId);
      } catch (err: any) {
        console.error('[organizations] Error deleting org_ai_credentials:', err.message);
      }
    }
    invalidateOrgAICache(orgId);
    // store decommissioned
    ok(res, null, 'Custom AI key removed. Organization reverted to Finance OS default AI.');
  });

  return r;
}
