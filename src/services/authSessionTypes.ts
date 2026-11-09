import type { User, Organization, OrganizationMember, MemberAccessRole } from '@/services/types';

export interface AuthSession {
  user: User;
  organization: Organization | null;
  membership: OrganizationMember | null;
  token: string;
}

export type PortalType = 'organization_admin' | 'employee' | 'platform_admin' | 'ai_assistant';

export interface LoginCredentials {
  email: string;
  password: string;
  orgSlug?: string;
  portalType?: PortalType; // Which portal the user is trying to access
  requiredAccessRole?: MemberAccessRole; // When logging in with a specific role selected
}
