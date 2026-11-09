/**
 * Organization Invitation Service
 * ================================
 * Handles invite-only organization creation flow
 * Platform admins invite org admins → Email sent → Password setup → Org created
 */

import { getSupabaseClient } from '@/lib/supabaseClient';
import { isHttpBackendConfigured } from '@/lib/apiClient';
import type { ServiceResponse } from './types';

export interface OrgInvitation {
  id: string;
  organizationName: string;
  organizationSlug: string;
  adminEmail: string;
  adminName?: string;
  token: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  expiresAt: string;
  plan?: string;
  createdOrganizationId?: string;
  createdUserId?: string;
  createdBy?: string;
  createdAt: string;
  acceptedAt?: string;
}

export interface CreateOrgInviteInput {
  organizationName: string;
  adminEmail: string;
  adminName?: string;
  plan?: string;
}

export interface AcceptOrgInviteInput {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface ValidateTokenResult {
  valid: boolean;
  invitation?: {
    organizationName: string;
    organizationSlug: string;
    adminEmail: string;
    adminName?: string;
    plan?: string;
    expiresAt: string;
  };
  error?: string;
}

export const orgInvitationService = {
  /**
   * Create organization invitation (Platform Admin only)
   * Uses backend API with nodemailer (like team member invitations)
   */
  async createInvitation(input: CreateOrgInviteInput): Promise<ServiceResponse<OrgInvitation>> {
    console.log('[orgInvitationService.createInvitation] Starting...');
    console.log('[orgInvitationService.createInvitation] isHttpBackendConfigured:', isHttpBackendConfigured());
    
    // Use backend API instead of Supabase RPC
    if (isHttpBackendConfigured()) {
      console.log('[orgInvitationService.createInvitation] Using backend API');
      
      try {
        // Get Supabase session token for auth
        const sb = getSupabaseClient();
        const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
        
        console.log('[orgInvitationService.createInvitation] Has session:', !!session);
        
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const url = `${window.location.origin}/api/v1/platform/invitations`;
        console.log('[orgInvitationService.createInvitation] Calling:', url);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            organizationName: input.organizationName,
            adminEmail: input.adminEmail,
            adminName: input.adminName,
            plan: input.plan || 'basic',
          }),
        });

        console.log('[orgInvitationService.createInvitation] Response status:', response.status);
        
        const result = await response.json();
        console.log('[orgInvitationService.createInvitation] Response data:', result);

        if (!response.ok || !result.success) {
          console.error('[orgInvitationService.createInvitation] API error:', result.error);
          return {
            success: false,
            data: null as any,
            error: result.error || 'Failed to create invitation',
          };
        }

        console.log('[orgInvitationService] ✅ Invitation created and email sent via backend');
        
        return {
          success: true,
          data: {
            id: result.data.id,
            organizationName: result.data.organizationName,
            organizationSlug: result.data.organizationSlug,
            adminEmail: result.data.adminEmail,
            adminName: result.data.adminName,
            token: result.data.token,
            status: result.data.status,
            expiresAt: result.data.expiresAt,
            plan: result.data.plan,
            createdAt: result.data.createdAt,
          },
        };
      } catch (error) {
        console.error('[orgInvitationService.createInvitation] API error:', error);
        return {
          success: false,
          data: null as any,
          error: error instanceof Error ? error.message : 'Failed to create invitation',
        };
      }
    }
    
    console.log('[orgInvitationService.createInvitation] Using Supabase fallback');
    
    // Fallback to original Supabase implementation (shouldn't reach here in production)
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as any, error: 'Backend not configured' };
    }

    try {
      const { organizationName, adminEmail, adminName, plan = 'basic' } = input;

      // Validate inputs
      if (!organizationName?.trim()) {
        return { success: false, data: null as any, error: 'Organization name is required' };
      }

      if (!adminEmail?.trim()) {
        return { success: false, data: null as any, error: 'Admin email is required' };
      }

      const trimmedEmail = adminEmail.trim().toLowerCase();
      const trimmedName = organizationName.trim();

      // Generate slug
      const slug = trimmedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Check for duplicate pending invites
      const { data: existing } = await sb
        .from('organization_invitations')
        .select('id, status')
        .eq('admin_email', trimmedEmail)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) {
        return {
          success: false,
          data: null as any,
          error: 'An invitation has already been sent to this email address',
        };
      }

      // Check if email already exists in organizations
      const { data: { user: existingUser } } = await sb.auth.getUser();
      const { data: existingMemberships } = await sb
        .from('organization_members')
        .select('id')
        .eq('email', trimmedEmail)
        .eq('role', 'owner')
        .limit(1);

      if (existingMemberships && existingMemberships.length > 0) {
        return {
          success: false,
          data: null as any,
          error: 'This email already owns an organization',
        };
      }

      // Create invitation
      const { data: invitation, error } = await sb
        .from('organization_invitations')
        .insert({
          organization_name: trimmedName,
          organization_slug: slug,
          admin_email: trimmedEmail,
          admin_name: adminName?.trim() || null,
          plan: plan || 'basic',
          status: 'pending',
          created_by: existingUser?.id || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[orgInvitationService.createInvitation] Error:', error);
        return { success: false, data: null as any, error: error.message };
      }

      console.log('[orgInvitationService] Invitation created successfully:', invitation.id);

      // Generate invitation link
      const clientRedirectUrl = `${window.location.origin}/accept-org-invite/${invitation.token}`;

      // SOLUTION: Use signInWithOtp but with shouldCreateUser: false option
      // This sends email via SMTP without creating user
      try {
        const { error: emailError } = await sb.auth.signInWithOtp({
          email: trimmedEmail,
          options: {
            shouldCreateUser: false, // This is the key - don't auto-create user!
            emailRedirectTo: clientRedirectUrl,
            data: {
              type: 'organization_invitation',
              organization_name: trimmedName,
              admin_name: adminName || trimmedEmail.split('@')[0],
              invitation_link: clientRedirectUrl,
              plan: plan || 'basic',
            },
          },
        });

        if (emailError) {
          console.warn('[orgInvitationService] Email not sent:', emailError.message);
          console.log('[orgInvitationService] ⚠️ Use "Copy Link" as fallback');
        } else {
          console.log('[orgInvitationService] ✅ Invitation email sent successfully to:', trimmedEmail);
        }
      } catch (emailErr) {
        console.warn('[orgInvitationService] Email error:', emailErr);
        console.log('[orgInvitationService] ⚠️ Use "Copy Link" button as fallback');
      }

      console.log('[orgInvitationService] Invitation link:', clientRedirectUrl);
      console.log('📧 Admin will receive email at:', trimmedEmail)

      return {
        success: true,
        data: {
          id: invitation.id,
          organizationName: invitation.organization_name,
          organizationSlug: invitation.organization_slug,
          adminEmail: invitation.admin_email,
          adminName: invitation.admin_name || undefined,
          token: invitation.token,
          status: invitation.status as OrgInvitation['status'],
          expiresAt: invitation.expires_at,
          plan: invitation.plan,
          createdAt: invitation.created_at,
        },
      };
    } catch (error) {
      console.error('[orgInvitationService.createInvitation] Unexpected error:', error);
      return {
        success: false,
        data: null as any,
        error: error instanceof Error ? error.message : 'Failed to create invitation',
      };
    }
  },

  /**
   * Validate invitation token
   */
  async validateToken(token: string): Promise<ValidateTokenResult> {
    const sb = getSupabaseClient();
    if (!sb) {
      return { valid: false, error: 'Supabase client not configured' };
    }

    try {
      // Use RPC function to validate (accessible to anon)
      const { data, error } = await sb.rpc('validate_org_invitation', {
        p_token: token,
      });

      if (error) {
        console.error('[orgInvitationService.validateToken] Error:', error);
        return { valid: false, error: error.message };
      }

      if (!data || data.length === 0) {
        return { valid: false, error: 'Invitation not found' };
      }

      const invitation = data[0];

      if (!invitation.is_valid) {
        return { valid: false, error: 'Invitation has expired or is no longer valid' };
      }

      return {
        valid: true,
        invitation: {
          organizationName: invitation.organization_name,
          organizationSlug: invitation.organization_slug,
          adminEmail: invitation.admin_email,
          adminName: invitation.admin_name || undefined,
          plan: invitation.plan,
          expiresAt: invitation.expires_at,
        },
      };
    } catch (error) {
      console.error('[orgInvitationService.validateToken] Unexpected error:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Failed to validate invitation',
      };
    }
  },

  /**
   * Accept invitation and create organization
   */
  async acceptInvitation(input: AcceptOrgInviteInput): Promise<ServiceResponse<{ organizationId: string; userId: string }>> {
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as any, error: 'Supabase client not configured' };
    }

    try {
      const { token, password, confirmPassword } = input;

      // Validate passwords
      if (password !== confirmPassword) {
        return { success: false, data: null as any, error: 'Passwords do not match' };
      }

      if (password.length < 8) {
        return { success: false, data: null as any, error: 'Password must be at least 8 characters' };
      }

      // Validate token first
      const validation = await this.validateToken(token);
      if (!validation.valid || !validation.invitation) {
        return { success: false, data: null as any, error: validation.error || 'Invalid invitation' };
      }

      const { adminEmail, organizationName, adminName } = validation.invitation;
      const normalizedEmail = adminEmail.trim().toLowerCase();
      const resolvedName = adminName || normalizedEmail.split('@')[0];

      // Create user account
      const { data: authData, error: authError } = await sb.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: resolvedName,
            is_org_admin: true,
            platform_role: 'organization_user',
            organization_name: organizationName,
            email: normalizedEmail,
          },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (authError) {
        console.error('[orgInvitationService.acceptInvitation] Auth error:', authError);
        return { success: false, data: null as any, error: authError.message };
      }

      if (!authData.user) {
        return { success: false, data: null as any, error: 'Failed to create user account' };
      }

      const userId = authData.user.id;

      // Call RPC function to create organization and membership
      const { data: result, error: rpcError } = await sb.rpc('accept_org_invitation', {
        p_token: token,
        p_user_id: userId,
      });

      if (rpcError) {
        console.error('[orgInvitationService.acceptInvitation] RPC error:', rpcError);
        // Try to clean up user account
        try {
          await sb.auth.admin.deleteUser(userId);
        } catch {
          // Ignore cleanup errors
        }
        return { success: false, data: null as any, error: rpcError.message };
      }

      if (!result || !result.success) {
        return {
          success: false,
          data: null as any,
          error: result?.error || 'Failed to create organization',
        };
      }

      // Ensure public.profiles has email and full_name populated
      try {
        await sb
          .from('profiles')
          .upsert({
            id: userId,
            email: normalizedEmail,
            full_name: resolvedName,
            platform_role: 'organization_user',
          }, { onConflict: 'id' });
      } catch (profileErr) {
        console.warn('[orgInvitationService.acceptInvitation] Profile direct upsert warning:', profileErr);
      }

      // Also trigger backend service-role sync endpoint if available
      try {
        await fetch(`${window.location.origin}/api/v1/platform/invitations/sync-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            email: normalizedEmail,
            fullName: resolvedName,
          }),
        });
      } catch {
        /* Non-blocking safeguard */
      }

      return {
        success: true,
        data: {
          organizationId: result.organization_id,
          userId,
        },
      };
    } catch (error) {
      console.error('[orgInvitationService.acceptInvitation] Unexpected error:', error);
      return {
        success: false,
        data: null as any,
        error: error instanceof Error ? error.message : 'Failed to accept invitation',
      };
    }
  },

  /**
   * Get all invitations (Platform Admin only)
   */
  async getAllInvitations(): Promise<ServiceResponse<OrgInvitation[]>> {
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: [], error: 'Supabase client not configured' };
    }

    try {
      const { data, error } = await sb
        .from('organization_invitations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[orgInvitationService.getAllInvitations] Error:', error);
        return { success: false, data: [], error: error.message };
      }

      const invitations: OrgInvitation[] = (data || []).map((inv: any) => ({
        id: inv.id,
        organizationName: inv.organization_name,
        organizationSlug: inv.organization_slug,
        adminEmail: inv.admin_email,
        adminName: inv.admin_name || undefined,
        token: inv.token,
        status: inv.status,
        expiresAt: inv.expires_at,
        plan: inv.plan,
        createdOrganizationId: inv.created_organization_id || undefined,
        createdUserId: inv.created_user_id || undefined,
        createdBy: inv.created_by || undefined,
        createdAt: inv.created_at,
        acceptedAt: inv.accepted_at || undefined,
      }));

      return { success: true, data: invitations };
    } catch (error) {
      console.error('[orgInvitationService.getAllInvitations] Unexpected error:', error);
      return {
        success: false,
        data: [],
        error: error instanceof Error ? error.message : 'Failed to fetch invitations',
      };
    }
  },

  /**
   * Resend invitation email
   */
  async resendInvitation(invitationId: string): Promise<ServiceResponse<void>> {
    // Use backend API (like team member invitations)
    if (isHttpBackendConfigured()) {
      try {
        const response = await fetch(`${window.location.origin}/api/v1/platform/invitations/${invitationId}/resend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          return {
            success: false,
            data: null as any,
            error: result.error || 'Failed to resend invitation',
          };
        }

        console.log('[orgInvitationService.resendInvitation] ✅ Email resent via backend');
        return { success: true, data: null as any };
      } catch (error) {
        console.error('[orgInvitationService.resendInvitation] API error:', error);
        return {
          success: false,
          data: null as any,
          error: error instanceof Error ? error.message : 'Failed to resend invitation',
        };
      }
    }

    // Fallback to Supabase
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as any, error: 'Backend not configured' };
    }

    try {
      console.log('[resendInvitation] Starting resend for invitation:', invitationId);

      // Get invitation details
      const { data: invitation, error: fetchError } = await sb
        .from('organization_invitations')
        .select('*')
        .eq('id', invitationId)
        .eq('status', 'pending')
        .single();

      if (fetchError || !invitation) {
        console.error('[resendInvitation] Invitation not found:', fetchError);
        return { success: false, data: null as any, error: 'Invitation not found or already accepted' };
      }

      console.log('[resendInvitation] Found invitation:', invitation.organization_name, 'for', invitation.admin_email);

      // Check if expired
      if (new Date(invitation.expires_at) < new Date()) {
        return { success: false, data: null as any, error: 'Invitation has expired. Please create a new one.' };
      }

      // Generate invitation link
      const clientRedirectUrl = `${window.location.origin}/accept-org-invite/${invitation.token}`;

      console.log('[resendInvitation] Invitation link:', clientRedirectUrl);

      // SOLUTION: Use signInWithOtp with shouldCreateUser: false
      // This sends email WITHOUT creating user
      try {
        const { error: emailError } = await sb.auth.signInWithOtp({
          email: invitation.admin_email,
          options: {
            shouldCreateUser: false, // Don't auto-create user!
            emailRedirectTo: clientRedirectUrl,
            data: {
              type: 'organization_invitation',
              organization_name: invitation.organization_name,
              admin_name: invitation.admin_name,
              invitation_link: clientRedirectUrl,
            },
          },
        });

        if (emailError) {
          console.error('[resendInvitation] Email sending failed:', emailError);
          return { 
            success: false, 
            data: null as any, 
            error: 'Failed to send email. Please use "Copy Link" button.' 
          };
        }

        console.log('[resendInvitation] ✅ Email sent successfully to:', invitation.admin_email);
        return { success: true, data: null as any };
        
      } catch (emailErr) {
        console.error('[resendInvitation] Email error:', emailErr);
        return { 
          success: false, 
          data: null as any, 
          error: 'Email service unavailable. Please use "Copy Link" button.' 
        };
      }
    } catch (error) {
      console.error('[orgInvitationService.resendInvitation] Unexpected error:', error);
      return {
        success: false,
        data: null as any,
        error: error instanceof Error ? error.message : 'Failed to resend invitation',
      };
    }
  },
  async cancelInvitation(invitationId: string): Promise<ServiceResponse<void>> {
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, data: null as any, error: 'Supabase client not configured' };
    }

    try {
      const { error } = await sb
        .from('organization_invitations')
        .update({ status: 'cancelled' })
        .eq('id', invitationId)
        .eq('status', 'pending');

      if (error) {
        console.error('[orgInvitationService.cancelInvitation] Error:', error);
        return { success: false, data: null as any, error: error.message };
      }

      return { success: true, data: null as any };
    } catch (error) {
      console.error('[orgInvitationService.cancelInvitation] Unexpected error:', error);
      return {
        success: false,
        data: null as any,
        error: error instanceof Error ? error.message : 'Failed to cancel invitation',
      };
    }
  },
};
