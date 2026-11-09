import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useService } from './useService';
import { organizationService } from '@/services/organizationService';
import type { MemberAccessRole } from '@/services/types';
import { usePlanEntitlements } from './usePlanEntitlements';
import { isPermissionAllowedByPlanFeatures } from '@/config/planFeatures';

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

export const VIEW_TO_REQUIRED_PERMISSION: Record<string, string> = {
  'finance-os': 'view_dashboard',
  'dashboard': 'view_dashboard',
  'quick-add': 'add_transaction',
  'transactions': 'view_reports',
  'recurring': 'view_reports',
  'accounts': 'manage_accounts',
  'payment-methods': 'manage_accounts',
  'import': 'import_statements',
  'logic': 'categorize',
  'ai-assistant': 'ai_assistant',
  'profit-intelligence': 'view_reports',
  'budgets': 'view_reports',
  'forecast': 'view_reports',
  'projects': 'view_reports',
  'simulator': 'view_reports',
  'costing': 'view_reports',
  'reports': 'view_reports',
  'loans': 'view_reports',
  'assets': 'view_reports',
  'inventory': 'view_reports',
  'team': 'manage_team',
  'payroll': 'manage_team',
  'settings': 'organization_settings',
  'integrations': 'organization_settings',
  'active-sessions': 'manage_team',
  'audit-log': 'manage_team',
};

export function usePermissions() {
  const { userRole, accessRole, membership, currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';
  const { isViewAllowedByPlan, allowedFeatures, currentPlan } = usePlanEntitlements();

  const activeRole: MemberAccessRole =
    accessRole ||
    membership?.accessRole ||
    (userRole === 'owner' || userRole === 'admin' ? 'org_admin' : 'team_member');

  // Fetch live role permissions from organization settings if available
  const { data: rolePermissionsData } = useService(
    () => (orgId ? organizationService.getRolePermissions(orgId) : Promise.resolve({ success: true, data: DEFAULT_ROLE_PERMISSIONS })),
    [orgId],
    ['role_permissions', orgId],
  );

  const permissions: string[] = useMemo(() => {
    if (activeRole === 'org_admin' || userRole === 'owner' || userRole === 'admin') {
      return ['all'];
    }
    const map = rolePermissionsData || DEFAULT_ROLE_PERMISSIONS;
    return map[activeRole] || DEFAULT_ROLE_PERMISSIONS[activeRole] || DEFAULT_ROLE_PERMISSIONS.team_member;
  }, [activeRole, userRole, rolePermissionsData]);

  // Defense-in-depth: A permission is only granted if BOTH the role has it AND the plan includes it
  const can = (permissionId: string): boolean => {
    // 1. Verify organization plan capability
    if (!isPermissionAllowedByPlanFeatures(permissionId, allowedFeatures)) {
      return false;
    }

    if (permissions.includes('all')) return true;
    return permissions.includes(permissionId);
  };

  const canAny = (...permissionIds: string[]): boolean => {
    return permissionIds.some((p) => can(p));
  };

  const canAccessView = (view: string): boolean => {
    // 1. Verify organization plan allows view
    if (!isViewAllowedByPlan(view)) {
      return false;
    }

    if (permissions.includes('all')) return true;
    const reqPerm = VIEW_TO_REQUIRED_PERMISSION[view];
    if (reqPerm) {
      return can(reqPerm);
    }
    return true;
  };

  return {
    can,
    canAny,
    canAccessView,
    activeRole,
    permissions,
    isPermissionAllowedByPlan: (permId: string) => isPermissionAllowedByPlanFeatures(permId, allowedFeatures),
    currentPlan,
    planFeatures: allowedFeatures,
    isOrgAdmin: activeRole === 'org_admin' || userRole === 'owner' || userRole === 'admin',
    isAccountant: activeRole === 'accountant',
    isTeamMember: activeRole === 'team_member',
    isViewer: activeRole === 'viewer',
  };
}
