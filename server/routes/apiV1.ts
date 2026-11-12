/**
 * REST API v1 — full mount point for `architecture/api-backend-rollout.md` §1–§19.
 * All handlers read/write the shared in-memory `store` (server/lib/store.ts), which is
 * persisted to SQLite (`data/finance-os.db`) after every mutation.
 *
 * Authorization: every route below `/organizations/:organizationId` is gated by a single
 * `requireAuth` + `requireOrgMembership` pair mounted on that prefix (see bottom of this file)
 * — Express walks middleware layers in registration order and matches each by path prefix, so
 * that one pair runs for every sub-router mounted under it (transactions, accounts, reports,
 * …) without needing to touch each of those files individually. Routes outside that prefix
 * (auth, users/:userId/*, /platform, /notifications) are gated explicitly per-route below.
 */

import { Router, type Request, type Response } from 'express';
import type {
  ActiveSession,
  Organization,
  OrganizationMember,
  User,
} from '../../src/services/types.js';
import type { AuthSession, LoginCredentials } from '../../src/services/authSessionTypes.js';

import { ok, fail } from '../lib/http.js';
import {
  clearLegacyAuthCookie,
  findAuthUserByEmail,
  projectUser,
  recordActiveSession,
} from '../lib/supabaseAuth.js';
import { toPublicUser } from '../lib/serialize.js';
import {
  requireAuth,
  requirePlatformRole,
  requireOrgMembership,
  requireSelfOrPlatformAdmin,
  isPlatformUser,
} from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rateLimit.js';
import { getSupabaseAdminClient, isSupabaseAdminConfigured, verifyUserCredentials } from '../lib/supabaseAdmin.js';

import { createOrganizationsListRouter } from './organizationsList.js';
import { createOrganizationRouter, normalizeOrgPlanCurrencies } from './organizations.js';
import platformInvitationsRouter from './platformInvitations.js';
import { createTransactionsRouter } from './transactions.js';
import { createAccountsRouter } from './accounts.js';
import { createBankAccountsRouter } from './bankAccounts.js';
import { createCategoriesRouter } from './categories.js';
import { createDepartmentsRouter } from './departments.js';
import { createProjectsRouter } from './projects.js';
import { createRecurringRouter } from './recurring.js';
import { createAssetsRouter } from './assets.js';
import { createInventoryRouter } from './inventory.js';
import { createBudgetsRouter } from './budgets.js';
import { createLoansRouter } from './loans.js';
import { createReportsRouter } from './reports.js';
import { createClassificationRouter, createPatternsRouter } from './classification.js';
import { createAIClassificationRouter } from './aiClassification.js';
import { createAIConfigRouter } from './aiConfig.js';
import { createAIAssistantRouter } from './aiAssistant.js';
import { createOrgNotificationsRouter, createUserOrgNotificationsRouter, createGlobalNotificationsRouter } from './notifications.js';
import { createImportsRouter } from './imports.js';
import { createAuditRouter } from './audit.js';
import { createEmployeeMeRouter } from './employee.js';
import { createPlatformRouter } from './platform.js';
import { createCostingRouter } from './costing.js';
import { createDebugForecastRouter } from './debug-forecast.js';
import { createSimulatorRouter } from './simulator.js';
import { createProfitIntelligenceRouter } from './profitIntelligence.js';
import { createOverheadAllocationsRouter } from './overheadAllocations.js';
import { createCounterpartiesRouter } from './counterparties.js';
import { createAttachmentsRouter } from './attachments.js';
import { createBillingRouter } from './billing.js';
import { createPlatformPlansRouter } from './platformPlans.js';
import { createInvoicesRouter } from './invoices.js';

/** All membership/org reads below go to Supabase — there is no local membership store any more. */
async function fetchMembershipsForUser(
  sb: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  userId: string,
): Promise<OrganizationMember[]> {
  const { data, error } = await sb
    .from('organization_members')
    .select('user_id, organization_id, role, portal_type, status, department, position, joined_at, assigned_projects, fixed_salary, access_role')
    .eq('user_id', userId);
  if (error) {
    console.error('[auth] membership list error:', error.message);
    return [];
  }

  // Also query employee_team_members to get granular role, salary, and assigned projects
  const { data: tmData } = await sb
    .from('employee_team_members')
    .select('organization_id, role, salary, assigned_projects')
    .eq('user_id', userId);

  const tmMap = new Map<string, any>();
  (tmData ?? []).forEach((tm: any) => {
    if (tm.organization_id) {
      tmMap.set(tm.organization_id, tm);
    }
  });

  return (data ?? []).map((m: any) => {
    const tm = tmMap.get(m.organization_id);
    const tmRole = String(tm?.role || '').toLowerCase().trim();
    const pos = (m.position || '').toLowerCase().trim();
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

    const memberProjects = Array.isArray(m.assigned_projects) && m.assigned_projects.length > 0
      ? m.assigned_projects
      : (Array.isArray(tm?.assigned_projects) && tm.assigned_projects.length > 0 ? tm.assigned_projects : []);
    const memberSalary = m.fixed_salary !== undefined && m.fixed_salary !== null
      ? Number(m.fixed_salary)
      : (tm?.salary !== undefined && tm?.salary !== null ? Number(tm.salary) : 0);

    return {
      userId: m.user_id as string,
      organizationId: m.organization_id as string,
      role: m.role as OrganizationMember['role'],
      accessRole,
      portalType: m.portal_type as OrganizationMember['portalType'],
      status: (m.status as OrganizationMember['status']) || 'active',
      department: (m.department as string) || undefined,
      position: (m.position as string) || undefined,
      fixedSalary: memberSalary,
      assignedProjects: memberProjects,
      joinedAt: m.joined_at ?? new Date().toISOString(),
    };
  });
}

async function fetchOrganizationByIdOrSlug(
  sb: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  idOrSlug: string,
): Promise<Organization | null> {
  const byId = await sb.from('organizations').select('*').eq('id', idOrSlug).maybeSingle();
  let orgRow = byId.data ? (byId.data as unknown as Organization) : null;
  if (!orgRow) {
    const bySlug = await sb.from('organizations').select('*').eq('slug', idOrSlug).maybeSingle();
    orgRow = bySlug.data ? (bySlug.data as unknown as Organization) : null;
  }
  if (!orgRow) return null;

  // Sync active subscription plan if present
  try {
    const { data: sub } = await sb
      .from('organization_subscriptions')
      .select('plan_id, plan_slug, status')
      .eq('organization_id', orgRow.id)
      .eq('status', 'active')
      .maybeSingle();

    if (sub && sub.plan_slug) {
      const currentSettings = (orgRow as any).settings || {};
      (orgRow as any).settings = {
        ...currentSettings,
        plan: sub.plan_slug,
        planId: sub.plan_id || currentSettings.planId,
      };
    }
  } catch {
    /* non-critical */
  }

  return normalizeOrgPlanCurrencies(orgRow);
}

/** Selects best primary membership for user based on portal context. */
function primaryMembershipForUser(
  members: OrganizationMember[],
  userId: string,
  portalType?: string,
  requiredAccessRole?: string,
): OrganizationMember | null {
  const mine = members.filter((m) => m.userId === userId);
  if (requiredAccessRole) {
    const match = mine.find((m) => {
      const act =
        m.role === 'owner' || m.role === 'admin' || (m as any).accessRole === 'org_admin'
          ? 'org_admin'
          : (m as any).accessRole || 'team_member';
      return act === requiredAccessRole;
    });
    if (match) return match;
  }
  if (portalType === 'organization_admin') {
    return mine.find((m) => m.role === 'owner' || m.role === 'admin') ?? mine[0] ?? null;
  }
  return mine.find((m) => m.role === 'employee') ?? mine[0] ?? null;
}

/** Creates a live session row in `public.active_sessions` (was: in-memory `store.activeSessions`). */
async function createSessionForUser(
  req: Request,
  sb: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  user: User,
  org: Organization | null,
): Promise<void> {
  await recordActiveSession(sb, user, org?.id ?? '', req);
}

export function createApiV1Router(): Router {
  const r = Router();

  // ── §1 Auth & sessions ──────────────────────────────────────────────────

  r.post('/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
    const body = req.body as LoginCredentials & { portalType?: string; requiredAccessRole?: string };
    const emailNorm = (body?.email ?? '').trim().toLowerCase();
    const slugNorm = (body?.orgSlug ?? '').trim().toLowerCase();
    const password = body?.password ?? '';
    const portalType = body?.portalType;

    if (!emailNorm || !password) return fail(res, 400, 'Email and password are required');

    if (!isSupabaseAdminConfigured()) {
      return fail(res, 503, 'Database connection required. Please configure Supabase.');
    }
    const sb = getSupabaseAdminClient()!;

    // Password verification uses an isolated client so the admin client's service-role session is never polluted.
    const { user: authUser, session: authSessionData, error: signInErr } = await verifyUserCredentials(
      emailNorm,
      password,
    );
    if (signInErr || !authUser) {
      return fail(res, 401, 'Invalid email or password');
    }

    const user = await projectUser(sb, authUser);
    const isPlatform = isPlatformUser(user);
    const memberships = await fetchMembershipsForUser(sb, user.id);

    if (portalType === 'employee' && memberships.length === 0) {
      return fail(res, 403, 'You are not invited by any organization, so you are not allowed to log in. Please contact your organization administrator to receive an invitation.');
    }

    // ── Portal Type Validation ──────────────────────────────────────────────
    if (portalType) {
      if (portalType === 'platform_admin') {
        if (user.role !== 'platform_admin' && user.role !== 'platform_manager') {
          return fail(res, 403, 'No platform admin account found with this email');
        }
      } else if (portalType === 'organization_admin') {
        if (memberships.length === 0 && !isPlatform) {
          return fail(res, 403, 'You are not a member of any organization. Please contact your organization administrator.');
        }
      } else if (portalType === 'employee') {
        const employeeMemberships = memberships.filter(
          m => m.role === 'employee' || (m.role as string) === 'viewer' || m.portalType === 'employee'
        );
        if (employeeMemberships.length === 0) {
          return fail(res, 403, 'You are not invited by any organization, so you are not allowed to log in. Please contact your organization administrator to receive an invitation.');
        }
      } else if (portalType === 'ai_assistant') {
        if (!isPlatform) {
          return fail(res, 403, 'Access restricted: Only Platform Administrators are authorized to access the Bing AI portal.');
        }
      }
    }

    let org: Organization | null = null;
    let membership: OrganizationMember | null = null;

    if (slugNorm) {
      const orgMatch = await fetchOrganizationByIdOrSlug(sb, slugNorm);
      if (!orgMatch) return fail(res, 400, 'Workspace not found');
      if (!isPlatform) {
        const mem = memberships.find(m => m.organizationId === orgMatch.id);
        if (!mem) return fail(res, 403, 'No access to this workspace');

        if (portalType === 'employee' && mem.role !== 'employee') {
          return fail(res, 403, 'No employee account found in this workspace');
        }

        membership = mem;
      }
      org = orgMatch;
    } else {
      membership = primaryMembershipForUser(memberships, user.id, portalType, body.requiredAccessRole);
      org = membership
        ? await fetchOrganizationByIdOrSlug(sb, membership.organizationId)
        : isPlatform
          ? (await sb.from('organizations').select('*').limit(1).maybeSingle()).data as unknown as Organization ?? null
          : null;
    }

    if (body.requiredAccessRole && !isPlatform) {
      if (!membership) {
        return fail(res, 403, 'You are not a member of any organization. Please contact your organization administrator.');
      }
      const actualRole =
        membership.role === 'owner' || membership.role === 'admin' || (membership as any).accessRole === 'org_admin'
          ? 'org_admin'
          : (membership as any).accessRole || 'team_member';

      const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin' || actualRole === 'org_admin';

      if (actualRole !== body.requiredAccessRole && !isOwnerOrAdmin) {
        const roleLabels: Record<string, string> = {
          org_admin: 'Organization Admin',
          accountant: 'Accountant',
          team_member: 'Team Member',
          viewer: 'Viewer',
        };
        const targetLabel = roleLabels[body.requiredAccessRole] || body.requiredAccessRole;
        const actualLabel = roleLabels[actualRole] || actualRole;
        const orgName = org?.name || 'this organization';
        return fail(
          res,
          403,
          `Role Mismatch: You selected "${targetLabel}", but your registered role in ${orgName} is "${actualLabel}". Please select the "${actualLabel}" option to sign in.`
        );
      }
    }

    await createSessionForUser(req, sb, user, org);

    try {
      const { logAuditEvent } = await import('../lib/auditLogger.js');
      await logAuditEvent(req, {
        organizationId: org?.id || '',
        action: 'login',
        entityType: 'session',
        entityId: user.id,
        description: `User ${user.name || user.email} signed in successfully via ${portalType || 'portal'}`,
        metadata: {
          portalType,
          device: req.headers['user-agent'] || 'Desktop',
        },
      });
    } catch {
      /* non-blocking audit failure */
    }

    const authSession: AuthSession = { user: toPublicUser(user) as User, organization: org, membership, token: authSessionData?.access_token || '' };
    ok(res, authSession);
  });

  r.get('/auth/has-platform-admin', async (_req: Request, res: Response) => {
    if (!isSupabaseAdminConfigured()) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }
    const sb = getSupabaseAdminClient()!;
    const { count, error } = await sb
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('platform_role', 'platform_admin');
    if (error) {
      return fail(res, 500, error.message);
    }
    return ok(res, { exists: (count ?? 0) > 0 });
  });

  // ── Signup — Supabase Auth owns the credential, the SQL RPC owns org + owner membership ──
  r.post('/auth/signup', loginRateLimiter, async (req: Request, res: Response) => {
    try {
      const body = req.body as LoginCredentials & {
        fullName?: string;
        role?: 'platform_admin' | 'platform_manager' | 'organization_user';
        organizationName?: string;
      };

      const emailNorm = (body?.email ?? '').trim().toLowerCase();
      const password = body?.password ?? '';
      const fullName = body?.fullName?.trim() || emailNorm.split('@')[0];
      const role = body?.role || 'organization_user';
      const organizationName = body?.organizationName?.trim();

      if (!emailNorm || !password) {
        return fail(res, 400, 'Email and password are required');
      }
      if (password.length < 6) {
        return fail(res, 400, 'Password must be at least 6 characters');
      }
      if (role === 'platform_admin' && password.length < 8) {
        return fail(res, 400, 'Platform admin password must be at least 8 characters');
      }

      if (!isSupabaseAdminConfigured()) {
        return fail(res, 503, 'Database connection required. Please configure Supabase.');
      }
      const sb = getSupabaseAdminClient()!;

      // Duplicate check via the auth admin API (RLS would hide other users from the anon client).
      const existing = await findAuthUserByEmail(sb, emailNorm);
      if (existing) {
        return fail(res, 409, 'Email already registered');
      }

      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email: emailNorm,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          // Seeded for display only. Authorization reads public.profiles.platform_role, which RLS
          // governs — so this field can never be used to self-escalate.
          platform_role: role,
        },
      });

      if (createErr || !created?.user) {
        const msg = createErr?.message || 'Could not create account';
        if (/already/i.test(msg)) return fail(res, 409, 'Email already registered');
        return fail(res, 400, msg);
      }

      const newUser = await projectUser(sb, created.user);

      // The handle_new_user trigger populates public.profiles on insert. For a platform admin the
      // role must be set explicitly, since the trigger always writes 'organization_user'.
      if (role === 'platform_admin' || role === 'platform_manager') {
        const { error: roleErr } = await sb
          .from('profiles')
          .update({ platform_role: role })
          .eq('id', created.user.id);
        if (roleErr) console.warn('[auth] profiles role update failed:', roleErr.message);
        newUser.role = role;
      }

      // Create the organization + owner membership atomically via the SECURITY DEFINER RPC.
      let organization: Organization | null = null;
      let membership: OrganizationMember | null = null;

      if (role === 'organization_user' && organizationName) {
        const orgId = `org-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const orgSlug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        const { data: rpcResult, error: rpcErr } = await sb.rpc('create_organization_with_owner', {
          p_org_id: orgId,
          p_org_name: organizationName,
          p_org_slug: orgSlug,
          p_user_id: newUser.id,
          p_currency: 'USD',
          p_fiscal_year_start: '01-01',
        });

        if (rpcErr) {
          console.error('[auth] create_organization_with_owner failed:', rpcErr.message);
          return fail(res, 500, 'Account created, but the organization could not be set up.');
        }

        const rpcOut = (rpcResult ?? {}) as { success?: boolean; error?: string };
        if (!rpcOut.success) {
          return fail(res, 400, rpcOut.error || 'Could not create the organization.');
        }

        organization = await fetchOrganizationByIdOrSlug(sb, orgId);
        const memberships = await fetchMembershipsForUser(sb, newUser.id);
        membership = memberships.find(m => m.organizationId === orgId) ?? null;
      }

      await createSessionForUser(req, sb, newUser, organization);

      const authSession: AuthSession = {
        user: toPublicUser(newUser) as User,
        organization,
        membership,
        token: '',
      };

      ok(res, authSession, 'Account created successfully');
    } catch (error) {
      console.error('Signup error:', error);
      fail(res, 500, 'Internal server error');
    }
  });

  // ── Check if an email is invited by any organization ──────────────────────
  //
  // This MUST run server-side with the service-role key. The browser cannot do
  // it: on the login screen nobody is signed in yet, so RLS on
  // `organization_members` / `profiles` returns zero rows for the anon client and
  // the employee is wrongly told they were never invited. The service role
  // bypasses RLS, and we match the email via `auth.admin.listUsers()`.
  r.post('/auth/check-invite-status', async (req: Request, res: Response) => {
    try {
      const emailNorm = ((req.body?.email as string) ?? '').trim().toLowerCase();
      if (!emailNorm) {
        return ok(res, { isInvited: false });
      }

      if (!isSupabaseAdminConfigured()) {
        return fail(res, 503, 'Database connection required. Please configure Supabase.');
      }

      try {
        const sb = getSupabaseAdminClient()!;
        const sbUser = await findAuthUserByEmail(sb, emailNorm);
        
        let memRows: any[] = [];
        if (sbUser) {
          const { data, error } = await sb
            .from('organization_members')
            .select('*, organizations(*)')
            .eq('user_id', sbUser.id);
          if (!error && data) memRows = data;
        }

        // Also check by email in organization_members
        if (memRows.length === 0) {
          const { data, error } = await sb
            .from('organization_members')
            .select('*, organizations(*)')
            .ilike('email', emailNorm);
          if (!error && data) memRows = data;
        }

        const empMem = (memRows || []).find(
          (m: Record<string, unknown>) =>
            (m.role === 'employee' || m.role === 'viewer' || m.portal_type === 'employee') &&
            (m.status === 'pending' || m.status === 'active' || !m.status)
        );

        if (empMem) {
          const orgRel = empMem.organizations as Record<string, unknown> | Record<string, unknown>[] | null;
          const orgObj = Array.isArray(orgRel) ? orgRel[0] : orgRel;
          const orgName = (orgObj?.name as string | undefined) || 'Organization';
          return ok(res, { isInvited: true, organizationName: orgName, status: empMem.status || 'pending' });
        }

        // Also check employee_team_members for team invite
        const { data: tmRow } = await sb
          .from('employee_team_members')
          .select('*, organizations(*)')
          .ilike('email', emailNorm)
          .maybeSingle();

        if (tmRow) {
          const orgRel = tmRow.organizations as Record<string, unknown> | Record<string, unknown>[] | null;
          const orgObj = Array.isArray(orgRel) ? orgRel[0] : orgRel;
          const orgName = (orgObj?.name as string | undefined) || 'Organization';
          return ok(res, { isInvited: true, organizationName: orgName, status: tmRow.status || 'pending' });
        }

        return ok(res, { isInvited: false });
      } catch (e) {
        console.error('[auth] check-invite-status Supabase error:', e);
        return fail(res, 500, 'Could not verify the invitation. Please try again.');
      }
    } catch (err) {
      console.error('check-invite-status error:', err);
      return fail(res, 500, 'Could not verify the invitation. Please try again.');
    }
  });

  // ── Employee set password for invited account ──────────────────────────────
  r.post('/auth/employee-setup-password', loginRateLimiter, async (req: Request, res: Response) => {
    try {
      const body = req.body as { email: string; password: string; name?: string; orgSlug?: string };
      const emailNorm = (body?.email ?? '').trim().toLowerCase();
      const password = body?.password ?? '';
      const fullName = body?.name?.trim();

      if (!emailNorm || !password) {
        return fail(res, 400, 'Email and password are required');
      }
      if (password.length < 6) {
        return fail(res, 400, 'Password must be at least 6 characters');
      }

      if (!isSupabaseAdminConfigured()) {
        return fail(res, 503, 'Database connection required. Please configure Supabase.');
      }
      const sb = getSupabaseAdminClient()!;

      // Eligibility is decided purely by an existing invitation row in Supabase.
      const invitedAuthUser = await findAuthUserByEmail(sb, emailNorm);
      const targetUserId = invitedAuthUser?.id ?? null;

      const { data: memRow } = await sb
        .from('organization_members')
        .select('user_id, organization_id, role, portal_type, status, department, joined_at, access_role')
        .ilike('email', emailNorm)
        .in('status', ['pending', 'active'])
        .maybeSingle();

      let membership: OrganizationMember | null = memRow
        ? {
            userId: memRow.user_id as string,
            organizationId: memRow.organization_id as string,
            role: memRow.role as OrganizationMember['role'],
            accessRole: memRow.access_role as OrganizationMember['accessRole'],
            portalType: memRow.portal_type as OrganizationMember['portalType'],
            status: (memRow.status as OrganizationMember['status']) || 'pending',
            department: (memRow.department as string) || undefined,
            joinedAt: memRow.joined_at ?? new Date().toISOString(),
          }
        : null;

      if (!membership && targetUserId) {
        const memberships = await fetchMembershipsForUser(sb, targetUserId);
        membership =
          memberships.find(m => m.status === 'pending') ??
          memberships.find(m => m.portalType === 'employee') ??
          memberships[0] ??
          null;
      }

      // Fallback check against employee_team_members
      if (!membership) {
        const { data: tmRow } = await sb
          .from('employee_team_members')
          .select('*')
          .ilike('email', emailNorm)
          .maybeSingle();
        if (tmRow && tmRow.organization_id) {
          membership = {
            userId: tmRow.user_id || targetUserId || `tm-usr-${Date.now()}`,
            organizationId: tmRow.organization_id,
            role: 'employee',
            accessRole: 'team_member',
            portalType: 'employee',
            status: 'active',
            department: tmRow.department || undefined,
            joinedAt: tmRow.joined_at || new Date().toISOString(),
          };
        }
      }

      if (!membership) {
        return fail(
          res,
          403,
          'This email address has not received an invitation to join an organization. Employee accounts are invite-only. Please contact your organization administrator to receive an invitation.'
        );
      }

      // Set the credential in Supabase Auth.
      let finalUserId = targetUserId;
      if (invitedAuthUser) {
        const { error: updErr } = await sb.auth.admin.updateUserById(invitedAuthUser.id, {
          password,
          email_confirm: true,
        });
        if (updErr) {
          return fail(res, 400, updErr.message);
        }
        finalUserId = invitedAuthUser.id;
      } else {
        const { data: crtData, error: crtErr } = await sb.auth.admin.createUser({
          email: emailNorm,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName || emailNorm.split('@')[0],
            platform_role: 'organization_user',
          },
        });
        if (crtErr || !crtData?.user) return fail(res, 400, crtErr?.message || 'Could not create account credential');
        finalUserId = crtData.user.id;
      }

      // Update membership with the resolved user ID and activate it
      membership.userId = finalUserId!;
      membership.status = 'active';

      await sb
        .from('organization_members')
        .upsert({
          organization_id: membership.organizationId,
          user_id: finalUserId,
          email: emailNorm,
          role: membership.role || 'employee',
          portal_type: membership.portalType || 'employee',
          status: 'active',
          department: membership.department || null,
          joined_at: membership.joinedAt || new Date().toISOString(),
        }, { onConflict: 'user_id,organization_id' });

      // Keep public.profiles in sync
      await sb.from('profiles').upsert({
        id: finalUserId,
        email: emailNorm,
        full_name: fullName || emailNorm.split('@')[0],
        platform_role: 'organization_user',
      });

      const userMeta = invitedAuthUser?.user_metadata || {};
      const assignedRole = userMeta.role || (membership.role === 'owner' ? 'Owner / Lead' : membership.role === 'admin' ? 'Admin' : 'Team Member');
      const assignedDept = userMeta.department || membership.department || 'Development';
      const assignedName = fullName || userMeta.full_name || emailNorm.split('@')[0];

      try {
        await sb.from('employee_team_members').upsert({
          id: `tm-${membership.organizationId}-${membership.userId}`,
          organization_id: membership.organizationId,
          user_id: membership.userId,
          name: assignedName,
          email: emailNorm,
          role: assignedRole,
          department: assignedDept,
          joined_at: new Date().toISOString(),
          status: 'active',
        }, { onConflict: 'id' });
      } catch (tmErr) {
        console.warn('[auth] employee_team_members upsert warning:', tmErr);
      }


      const org = await fetchOrganizationByIdOrSlug(sb, membership.organizationId);

      // No cookie/token is issued. The response is informational only; the browser authenticates
      // separately through Supabase Auth.
      const authSession: AuthSession = {
        user: {
          id: membership.userId,
          email: emailNorm,
          name: assignedName,
          role: 'organization_user',
          createdAt: new Date().toISOString(),
        },
        organization: org,
        membership,
        token: '',
      };

      ok(res, authSession, 'Password set successfully! Welcome to Finance OS.');
    } catch (err) {
      console.error('employee-setup-password error:', err);
      fail(res, 500, 'Internal server error setting password');
    }
  });


r.post('/auth/logout', requireAuth, async (req: Request, res: Response) => {
    // The browser's Supabase session is cleared client-side via supabase.auth.signOut(). Server-side
    // we revoke the recorded session row so the session list reflects reality.
    const caller = req.authUser;
    const sb = getSupabaseAdminClient();
    if (caller && sb) {
      try {
        await sb
          .from('active_sessions')
          .delete()
          .eq('user_id', caller.id)
          .eq('is_current_session', true);
      } catch (e) {
        console.warn('[auth] logout session cleanup failed:', e);
      }
    }
    clearLegacyAuthCookie(res);
    ok(res, null, 'Logged out');
  });

  r.get('/auth/session', requireAuth, async (req: Request, res: Response) => {
    const user = req.authUser!;
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Database connection required. Please configure Supabase.');
    }

    const memberships = await fetchMembershipsForUser(sb, user.id);
    const membership = primaryMembershipForUser(memberships, user.id);
    const org = membership
      ? await fetchOrganizationByIdOrSlug(sb, membership.organizationId)
      : isPlatformUser(user)
        ? ((await sb.from('organizations').select('*').limit(1).maybeSingle()).data as unknown as Organization ?? null)
        : null;

    const session: AuthSession = { user: toPublicUser(user) as User, organization: org, membership, token: '' };
    ok(res, session);
  });

  r.get('/users/:userId/organizations', requireAuth, requireSelfOrPlatformAdmin, async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required. Please configure Supabase.');

    const memberships = await fetchMembershipsForUser(sb, String(req.params.userId));
    const orgs: Organization[] = [];
    for (const m of memberships) {
      const org = await fetchOrganizationByIdOrSlug(sb, m.organizationId);
      if (org) orgs.push(org);
    }
    ok(res, orgs);
  });

  r.get('/organizations/:organizationId/membership', requireAuth, async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    if (!userId) return fail(res, 400, 'userId query required');
    const caller = req.authUser!;
    if (userId !== caller.id && !isPlatformUser(caller)) return fail(res, 403, 'Forbidden');

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required. Please configure Supabase.');

    const memberships = await fetchMembershipsForUser(sb, userId);
    const membership =
      memberships.find(m => m.organizationId === req.params.organizationId) ?? null;
    ok(res, membership);
  });

  r.get('/users/:userId/sessions', requireAuth, requireSelfOrPlatformAdmin, async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required. Please configure Supabase.');

    const { data, error } = await sb
      .from('active_sessions')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('login_time', { ascending: false });
    if (error) {
      console.error('[auth] sessions list error:', error.message);
      return fail(res, 500, 'Could not load sessions.');
    }
    ok(res, data ?? []);
  });

  r.get('/users/:userId/session-history', requireAuth, requireSelfOrPlatformAdmin, async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required. Please configure Supabase.');

    const userId = req.params.userId;
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data: auditEvents } = await sb
        .from('audit_logs')
        .select('*')
        .eq('actor_user_id', userId)
        .in('action', ['login', 'logout', 'session_revoked', 'session_ended'])
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50);

      const { data: currentSessions } = await sb
        .from('active_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('login_time', { ascending: false });

      const history: Array<{
        id: string;
        action: string;
        device: string;
        location: string;
        time: string;
        status: 'success' | 'failed';
      }> = [];

      (auditEvents || []).forEach((e: any) => {
        history.push({
          id: String(e.id),
          action: e.action === 'login' ? 'Login' : e.action === 'logout' ? 'Logout' : 'Session Ended',
          device: e.user_agent || e.metadata?.device || 'Desktop',
          location: e.ip_address || 'Local / Office',
          time: e.created_at,
          status: 'success',
        });
      });

      (currentSessions || []).forEach((s: any) => {
        if (!history.some(h => h.id === s.id)) {
          history.push({
            id: s.id,
            action: 'Login',
            device: `${s.browser || 'Browser'} on ${s.device_type || 'Desktop'}`,
            location: `${s.location || 'Local'} • ${s.ip_address || '127.0.0.1'}`,
            time: s.login_time,
            status: 'success',
          });
        }
      });

      history.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      return ok(res, history);
    } catch (e: any) {
      console.warn('[session-history] error:', e);
      return fail(res, 500, e?.message || 'Could not fetch session history');
    }
  });

  r.delete('/sessions/:sessionId', requireAuth, async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required. Please configure Supabase.');

    const { data: session } = await sb
      .from('active_sessions')
      .select('user_id, is_current_session')
      .eq('id', req.params.sessionId)
      .maybeSingle();

    if (!session) return fail(res, 404, 'Session not found');

    const caller = req.authUser!;
    if (session.user_id !== caller.id && !isPlatformUser(caller)) return fail(res, 403, 'Forbidden');
    if (session.is_current_session) return fail(res, 400, 'Cannot end your current session');

    const { error } = await sb.from('active_sessions').delete().eq('id', req.params.sessionId);
    if (error) return fail(res, 500, 'Could not end session.');
    ok(res, null, 'Session ended successfully');
  });

  r.post('/users/:userId/sessions/end-others', requireAuth, requireSelfOrPlatformAdmin, async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database connection required. Please configure Supabase.');

    const userId = req.params.userId;
    const { data: kept } = await sb
      .from('active_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('is_current_session', true);

    const keepIds = (kept ?? []).map((k) => k.id as string);

    const { data: all } = await sb
      .from('active_sessions')
      .select('id')
      .eq('user_id', userId);

    const toRemove = (all ?? [])
      .map((s) => s.id as string)
      .filter((id) => !keepIds.includes(id));

    if (toRemove.length > 0) {
      const { error } = await sb.from('active_sessions').delete().in('id', toRemove);
      if (error) return fail(res, 500, 'Could not end sessions.');
    }

    ok(res, null, `${toRemove.length} session(s) ended`);
  });

  // ── §3 Organization admin + members + §18 extras + §19 AI settings ─────
  // List/create-organization is a platform-console operation (see AuthContext.loadOrganizations
  // and platform/OrganizationsView — both only ever call it for platform_admin/platform_manager).
  // The auth + role gate lives INSIDE organizationsList.ts's own routes, not here — see the
  // comment on that file for why a blanket `.use(..., requirePlatformRole)` at this exact mount
  // point would also (incorrectly) reject every regular org member's deeper `/organizations/:id/*`
  // request, since Express prefix-matches `/organizations` against those paths too.
  r.use('/organizations', createOrganizationsListRouter());
  
  // Platform-level organization invitations (similar to team member invites)
  // Uses Supabase RLS for security, so no backend auth required
  r.use('/platform/invitations', platformInvitationsRouter);

  // Single gate for every org-scoped resource: Express matches this prefix layer on every
  // request under /organizations/:organizationId/*, runs requireAuth + requireOrgMembership,
  // then falls through to whichever more specific router below actually handles the route.
  r.use('/organizations/:organizationId', requireAuth, requireOrgMembership);
  r.use('/organizations/:organizationId', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  r.use('/organizations/:organizationId/transactions', createTransactionsRouter());
  r.use('/organizations/:organizationId/counterparties', createCounterpartiesRouter());
  r.use('/organizations/:organizationId/attachments', createAttachmentsRouter());
  r.use('/organizations/:organizationId/accounts', createAccountsRouter());
  r.use('/organizations/:organizationId/bank-accounts', createBankAccountsRouter());
  r.use('/organizations/:organizationId/categories', createCategoriesRouter());
  r.use('/organizations/:organizationId/departments', createDepartmentsRouter());
  r.use('/organizations/:organizationId/projects', createProjectsRouter());
  r.use('/organizations/:organizationId/profit-intelligence', createProfitIntelligenceRouter());
  r.use('/organizations/:organizationId/overhead-allocations', createOverheadAllocationsRouter());
  r.use('/organizations/:organizationId/recurring-transactions', createRecurringRouter());
  r.use('/organizations/:organizationId/assets', createAssetsRouter());
  r.use('/organizations/:organizationId/inventory', createInventoryRouter());
  r.use('/organizations/:organizationId/budgets', createBudgetsRouter());
  r.use('/organizations/:organizationId/loans', createLoansRouter());
  r.use('/organizations/:organizationId/reports', createReportsRouter());
  r.use('/organizations/:organizationId/simulator', createSimulatorRouter());
  r.use('/organizations/:organizationId/classification', createClassificationRouter());
  r.use('/organizations/:organizationId/patterns', createPatternsRouter());
  r.use('/organizations/:organizationId/ai-classification', createAIClassificationRouter());
  r.use('/organizations/:organizationId/ai', createAIConfigRouter());
  r.use('/organizations/:organizationId/ai-assistant', createAIAssistantRouter());
  r.use('/organizations/:organizationId/imports', createImportsRouter());
  r.use('/organizations/:organizationId/audit-logs', createAuditRouter());
  r.use('/organizations/:organizationId/me', createEmployeeMeRouter());
  r.use('/organizations/:organizationId', createCostingRouter());
  r.use('/organizations/:organizationId/costing', createCostingRouter());
  r.use('/organizations/:organizationId/notifications', createOrgNotificationsRouter());
  r.use('/organizations/:organizationId/debug-forecast', createDebugForecastRouter());
  r.use('/organizations/:organizationId/billing', createBillingRouter());
  r.use('/organizations/:organizationId/invoices', createInvoicesRouter());

  // Public/shared plans catalogue
  r.use('/plans', createPlatformPlansRouter());

  // Shared system-wide platform configuration (active currencies, FX rates, retention policies, feature flags)
  r.get('/platform-config', async (_req: Request, res: Response) => {
    try {
      const { getGlobalPlatformSettings } = await import('./platformSettings.js');
      const settings = await getGlobalPlatformSettings();
      return ok(res, {
        currencies: settings.currencies,
        retention_policies: settings.retention_policies,
        backup_policies: {
          full_backup_frequency: settings.backup_policies.full_backup_frequency,
          incremental_backup_frequency: settings.backup_policies.incremental_backup_frequency,
          backup_retention_days: settings.backup_policies.backup_retention_days,
        },
        feature_flags: settings.feature_flags,
        updated_at: settings.updated_at,
      });
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to load platform config');
    }
  });

  // §15 Notifications — outside the /organizations/:organizationId prefix, so gated explicitly.
  r.use(
    '/users/:userId/organizations/:organizationId/notifications',
    requireAuth,
    requireSelfOrPlatformAdmin,
    createUserOrgNotificationsRouter(),
  );
  r.use('/notifications', requireAuth, createGlobalNotificationsRouter());

  // Plans catalogue accessible to all authenticated users (required by usePlanEntitlements and Billing)
  r.use('/platform/plans', requireAuth, createPlatformPlansRouter());

  // §2 Platform console — platform staff only.
  r.use('/platform', requireAuth, requirePlatformRole('platform_admin', 'platform_manager'), createPlatformRouter());

  // Generic org admin (§3 root/members) + §18 team-directory/announcements + §19 ai-settings —
  // mount last; already covered by the /organizations/:organizationId gate above.
  r.use('/organizations/:organizationId', createOrganizationRouter());

  return r;
}

export type { Organization, User };
