/**
 * Authorization middleware for `/api/v1` and `/api/bundle`.
 *
 * Enforces Handoff v1.2 Security, Tenant Isolation & Confidentiality Invariants (§5, §20, §32, §33):
 *   1. Identity → `sb.auth.getUser(accessToken)` + `public.profiles.platform_role`
 *   2. Tenancy  → `public.organization_members` (active membership required)
 *   3. Break-Glass Support Access → Platform admins do NOT get implicit access to customer finance
 *      data. They must either be an explicit org member OR hold an active, non-expired row in
 *      `public.support_access_grants`, which is audited on every access.
 *   4. Role & Permission Matrix → Enforces write protection and salary/payroll confidentiality.
 */

import type { Request, Response, NextFunction } from 'express';
import { fail } from '../lib/http.js';
import type { User, OrganizationMember, PlatformRole } from '../../src/services/types.js';
import { isSupabaseAdminConfigured, getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { readAccessToken, resolveAuthUser, touchActiveSession } from '../lib/supabaseAuth.js';
import { logAuditEvent } from '../lib/auditLogger.js';

export type OrgRole = 'owner' | 'admin' | 'accountant' | 'manager' | 'viewer' | 'employee' | 'member';

export type PermissionKey =
  | 'finance:read_summary'
  | 'finance:write_transactions'
  | 'finance:post_ledger'
  | 'finance:approve'
  | 'payroll:read_confidential'
  | 'org:manage_settings';

const ROLE_PERMISSION_MATRIX: Record<OrgRole, ReadonlySet<PermissionKey>> = {
  owner: new Set([
    'finance:read_summary',
    'finance:write_transactions',
    'finance:post_ledger',
    'finance:approve',
    'payroll:read_confidential',
    'org:manage_settings',
  ]),
  admin: new Set([
    'finance:read_summary',
    'finance:write_transactions',
    'finance:post_ledger',
    'finance:approve',
    'payroll:read_confidential',
    'org:manage_settings',
  ]),
  accountant: new Set([
    'finance:read_summary',
    'finance:write_transactions',
    'finance:post_ledger',
    'finance:approve',
    'payroll:read_confidential',
  ]),
  manager: new Set([
    'finance:read_summary',
    'finance:approve',
  ]),
  viewer: new Set([
    'finance:read_summary',
  ]),
  employee: new Set([
    'finance:read_summary',
  ]),
  member: new Set([
    'finance:read_summary',
  ]),
};

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: User;
    authSessionId?: string;
    orgMembership?: OrganizationMember;
    isSupportSession?: boolean;
  }
}

const PLATFORM_ROLES = new Set(['platform_admin', 'platform_manager']);

export function isPlatformUser(user: User): boolean {
  return PLATFORM_ROLES.has(user.role);
}

export function canViewConfidentialPayroll(req: Request): boolean {
  const role = (req.orgMembership?.role as OrgRole | undefined) ?? 'viewer';
  return ROLE_PERMISSION_MATRIX[role]?.has('payroll:read_confidential') ?? false;
}

export function canWriteFinance(req: Request): boolean {
  const role = (req.orgMembership?.role as OrgRole | undefined) ?? 'viewer';
  return ROLE_PERMISSION_MATRIX[role]?.has('finance:write_transactions') ?? false;
}

/** Validates the Supabase access token and loads the caller's profile-backed identity. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readAccessToken(req);
  if (!token) {
    fail(res, 401, 'Not authenticated');
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    fail(res, 503, 'Database connection required. Please configure Supabase.');
    return;
  }

  const sb = getSupabaseAdminClient();
  if (!sb) {
    fail(res, 503, 'Database connection required. Please configure Supabase.');
    return;
  }

  try {
    const resolved = await resolveAuthUser(sb, token);
    if (!resolved) {
      fail(res, 401, 'Invalid or expired session. Please sign in again.');
      return;
    }

    req.authUser = resolved.user;
    req.authSessionId = `sb-${resolved.user.id}`;
    next();

    // Fire-and-forget: refreshing last_activity must not block the response.
    void touchActiveSession(sb, resolved.user.id);
  } catch (err) {
    console.error('[auth] Supabase token validation error:', err);
    fail(res, 500, 'Could not validate session.');
  }
}

export function requirePlatformRole(...roles: Array<'platform_admin' | 'platform_manager'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser || !roles.includes(req.authUser.role as 'platform_admin' | 'platform_manager')) {
      fail(res, 403, 'Insufficient privileges');
      return;
    }
    next();
  };
}

/**
 * Resolves the caller's membership in `:organizationId`, which may be an org id or an org slug.
 *
 * Handoff §5, §32, §33:
 * Platform admins do NOT get implicit customer finance access. If a platform user is not an explicit
 * member of the organization, they must hold an active, non-expired grant in `support_access_grants`.
 */
export async function requireOrgMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.authUser;
  if (!user) {
    fail(res, 401, 'Not authenticated');
    return;
  }

  const organizationId = req.params.organizationId;
  if (!organizationId) {
    fail(res, 400, 'organizationId is required');
    return;
  }

  const sb = getSupabaseAdminClient();
  if (!sb) {
    fail(res, 503, 'Database connection required. Please configure Supabase.');
    return;
  }

  try {
    const byId = await sb.from('organizations').select('id').eq('id', organizationId).maybeSingle();
    const orgId = byId.data?.id ?? (
      (await sb.from('organizations').select('id').eq('slug', organizationId).maybeSingle()).data?.id ?? null
    );

    if (!orgId) {
      console.warn('[auth] org lookup failed', {
        organizationId,
        byIdError: byId.error?.message ?? null,
        userId: user.id,
      });
      fail(res, 404, 'Organization not found');
      return;
    }

    const { data: memberRow, error } = await sb
      .from('organization_members')
      .select('user_id, organization_id, role, portal_type, status, department, joined_at')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) {
      console.error('[auth] membership lookup error:', error.message);
      fail(res, 500, 'Could not verify organization access.');
      return;
    }

    if (memberRow) {
      const status = (memberRow.status as string) || 'active';
      if (status === 'rejected' || status === 'inactive') {
        fail(res, 403, 'This membership is no longer active.');
        return;
      }

      req.orgMembership = {
        userId: user.id,
        organizationId: orgId,
        role: memberRow.role as OrganizationMember['role'],
        portalType: memberRow.portal_type as OrganizationMember['portalType'],
        status: status as OrganizationMember['status'],
        department: (memberRow.department as string) || undefined,
        joinedAt: memberRow.joined_at ?? new Date().toISOString(),
      };
      next();
      return;
    }

    // If caller is a platform user without direct org membership, check break-glass support_access_grants
    if (isPlatformUser(user)) {
      const { data: grantRow, error: grantErr } = await sb
        .from('support_access_grants')
        .select('id, access_level, reason, expires_at')
        .eq('organization_id', orgId)
        .eq('granted_to_user_id', user.id)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (!grantErr && grantRow) {
        const mappedRole: any =
          grantRow.access_level === 'read_write' ? 'admin' : 'viewer';
        req.isSupportSession = true;
        req.orgMembership = {
          userId: user.id,
          organizationId: orgId,
          role: mappedRole,
          portalType: 'organization_admin' as any,
          status: 'active',
          joinedAt: new Date().toISOString(),
        };
        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'support_session_access',
          entityType: 'organization',
          entityId: orgId,
          description: `Support session access (${grantRow.access_level}) via grant ${grantRow.id}: ${grantRow.reason}`,
          metadata: { method: req.method, path: req.originalUrl, grantId: grantRow.id },
        });
        next();
        return;
      }

      fail(
        res,
        403,
        'Platform admins do not have implicit access to tenant financial data. An active support access grant is required.',
      );
      return;
    }

    fail(res, 403, 'No access to this organization');
  } catch (e) {
    console.error('[auth] membership check threw:', e);
    fail(res, 500, 'Could not verify organization access.');
  }
}

/** For /users/:userId/* — caller must be that user, or platform staff. */
export function requireSelfOrPlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = req.authUser;
  if (!user) {
    fail(res, 401, 'Not authenticated');
    return;
  }
  if (user.id === req.params.userId || isPlatformUser(user)) {
    next();
    return;
  }
  fail(res, 403, 'Forbidden');
}

/** Finer-grained org-role gate (owner/admin/accountant/manager/viewer/employee). */
export function requireOrgRole(...roles: Array<OrgRole>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      fail(res, 401, 'Not authenticated');
      return;
    }
    const membership = req.orgMembership;
    if (!membership || !roles.includes(membership.role as OrgRole)) {
      fail(res, 403, 'Insufficient role');
      return;
    }
    next();
  };
}

/** Enforces a specific permission from the Handoff v1.2 RBAC matrix. */
export function requirePermission(permission: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      fail(res, 401, 'Not authenticated');
      return;
    }
    const role = (req.orgMembership?.role as OrgRole | undefined) ?? 'viewer';
    const perms = ROLE_PERMISSION_MATRIX[role];
    if (!perms || !perms.has(permission)) {
      fail(res, 403, `Missing required permission: ${permission}`);
      return;
    }
    next();
  };
}

export type { PlatformRole };
