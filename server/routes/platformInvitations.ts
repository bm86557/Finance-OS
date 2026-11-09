/**
 * Platform-level Organization Invitations API
 * Similar to team member invitations but for creating new organizations
 */

import { Router, Request, Response } from 'express';
import type { OrganizationMember } from '../../src/services/types.js';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import { findAuthUserByEmail } from '../lib/supabaseAuth.js';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const router = Router();

interface OrgInvitationEmailParams {
  toEmail: string;
  organizationName: string;
  organizationSlug: string;
  adminName?: string;
  plan?: string;
  invitationToken: string;
  invitationUrl: string;
}

/**
 * Get email transporter (shared logic from emailService.ts)
 */
async function getTransporter() {
  if (env.smtpHost && env.smtpUser) {
    return {
      transporter: nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass,
        },
      }),
      isTest: false,
    };
  }

  // Development fallback: try Ethereal
  try {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    return { transporter, isTest: true };
  } catch (err) {
    console.warn('[getTransporter] Ethereal failed, using JSON transport:', err);
    const transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return { transporter, isTest: true };
  }
}

/**
 * Send organization invitation email via nodemailer (uses same SMTP as team invites)
 */
async function sendOrgInvitationEmail(params: OrgInvitationEmailParams): Promise<{
  success: boolean;
  previewUrl?: string;
  error?: string;
}> {
  const {
    toEmail,
    organizationName,
    adminName,
    plan = 'Basic',
    invitationUrl,
  } = params;

  const recipientName = adminName?.trim() || toEmail.split('@')[0];

  // Build email HTML
  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to create ${organizationName} on Finance OS</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e2e8f0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #111827 0%, #0d131f 100%); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); background: linear-gradient(90deg, rgba(16,185,129,0.12), rgba(6,182,212,0.12));">
              <div style="display: inline-block; padding: 6px 14px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; font-size: 13px; font-weight: 700; color: #10b981; letter-spacing: 0.5px;">
                FINANCE OS
              </div>
              <h1 style="margin: 16px 0 0; font-size: 28px; font-weight: 700; color: #fff; line-height: 1.2;">
                🏢 You're Invited to Create Your Organization
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; color: #cbd5e1; line-height: 1.6;">
                Hello <strong style="color: #10b981;">${recipientName}</strong>,
              </p>
              
              <p style="margin: 0 0 24px; font-size: 16px; color: #cbd5e1; line-height: 1.6;">
                You've been invited to create and manage <strong style="color: #fff;">${organizationName}</strong> on Finance OS Platform.
              </p>

              <!-- Info Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; margin: 24px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 12px; font-size: 12px; font-weight: 700; color: #10b981; letter-spacing: 0.5px; text-transform: uppercase;">
                      📋 Organization Details
                    </p>
                    <p style="margin: 0 0 8px; font-size: 15px; color: #e2e8f0;">
                      🏢 Organization: <strong style="color: #fff;">${organizationName}</strong>
                    </p>
                    <p style="margin: 0 0 8px; font-size: 15px; color: #e2e8f0;">
                      ✉️ Admin Email: <strong style="color: #fff;">${toEmail}</strong>
                    </p>
                    <p style="margin: 0; font-size: 15px; color: #e2e8f0;">
                      📦 Plan: <strong style="color: #fff;">${plan}</strong>
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 16px; font-size: 16px; color: #cbd5e1; line-height: 1.6;">
                Click the button below to set your password and activate your organization:
              </p>

              <!-- CTA Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 16px 0 24px;">
                    <a href="${invitationUrl}" style="display: inline-block; padding: 16px 48px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; text-decoration: none; border-radius: 10px; font-size: 16px; font-weight: 700; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.35); text-align: center;">
                      🚀 Create Your Organization
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px; font-size: 13px; color: #64748b;">
                Or copy this link into your browser:
              </p>
              <p style="margin: 0 0 24px; padding: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; font-family: 'Courier New', monospace; font-size: 12px; color: #94a3b8; word-break: break-all;">
                ${invitationUrl}
              </p>

              <!-- Expiry Notice -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: rgba(251, 146, 60, 0.1); border: 1px solid rgba(251, 146, 60, 0.3); border-radius: 8px; margin: 24px 0 0;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0; font-size: 14px; color: #fbbf24;">
                      <strong>⏰ Important:</strong> This invitation expires in 7 days.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid rgba(255,255,255,0.08); text-align: center;">
              <p style="margin: 0 0 8px; font-size: 14px; font-weight: 700; color: #fff;">
                Finance OS Platform
              </p>
              <p style="margin: 0 0 16px; font-size: 13px; color: #64748b;">
                This invitation was sent by your Platform Administrator
              </p>
              <p style="margin: 0; font-size: 12px; color: #475569;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const { transporter, isTest } = await getTransporter();
    
    const info = await transporter.sendMail({
      from: env.smtpFrom || `"Finance OS Platform" <${env.smtpUser || 'noreply@financeos.com'}>`,
      to: toEmail,
      subject: `🏢 You're invited to create ${organizationName} on Finance OS`,
      html: emailHtml,
    });

    console.log('[sendOrgInvitationEmail] ✅ Email sent to:', toEmail);

    if (isTest) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log('[sendOrgInvitationEmail] 📧 Preview URL:', previewUrl);
      return { success: true, previewUrl: previewUrl || undefined };
    }

    return { success: true };
  } catch (error) {
    console.error('[sendOrgInvitationEmail] Error sending email:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send email' };
  }
}

/**
 * POST /api/v1/platform/invitations
 * Create organization invitation and send email
 * PUBLIC endpoint - security handled by Supabase RLS
 */
router.post('/', async (req: Request, res: Response) => {
  console.log('[platformInvitations.POST] Request received');
  console.log('[platformInvitations.POST] Body:', req.body);
  console.log('[platformInvitations.POST] Headers:', req.headers);
  
  try {
    const { organizationName, adminEmail, adminName, plan } = req.body;

    if (!organizationName?.trim() || !adminEmail?.trim()) {
      console.log('[platformInvitations.POST] Missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Organization name and admin email are required',
      });
    }

    console.log('[platformInvitations.POST] Creating invitation for:', adminEmail);

    const sb = getSupabaseAdminClient();
    if (!sb || !isSupabaseAdminConfigured()) {
      console.error('[platformInvitations.POST] Supabase not configured');
      return res.status(500).json({
        success: false,
        error: 'Database not configured',
      });
    }

    const trimmedEmail = adminEmail.trim().toLowerCase();
    const trimmedName = organizationName.trim();

    // Generate slug
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    console.log('[platformInvitations.POST] Generated slug:', slug);

    // Check for duplicate pending invites
    const { data: existing } = await sb
      .from('organization_invitations')
      .select('id, status')
      .eq('admin_email', trimmedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'An invitation has already been sent to this email address',
      });
    }

    // Check if email already owns an organization
    const { data: existingMemberships } = await sb
      .from('organization_members')
      .select('id')
      .eq('email', trimmedEmail)
      .eq('role', 'owner')
      .limit(1);

    if (existingMemberships && existingMemberships.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'This email already owns an organization',
      });
    }

    // Create invitation
    const { data: invitation, error: dbError } = await sb
      .from('organization_invitations')
      .insert({
        organization_name: trimmedName,
        organization_slug: slug,
        admin_email: trimmedEmail,
        admin_name: adminName?.trim() || null,
        plan: plan || 'basic',
        status: 'pending',
      })
      .select()
      .single();

    if (dbError || !invitation) {
      console.error('[platformInvitations] Database error:', dbError);
      return res.status(500).json({
        success: false,
        error: dbError?.message || 'Failed to create invitation',
      });
    }

    // Generate invitation URL
    const clientOrigin = req.headers.origin || `http://localhost:${env.port || 5173}`;
    const invitationUrl = `${clientOrigin}/accept-org-invite/${invitation.token}`;

    // Send email via nodemailer (like team invitations)
    const emailResult = await sendOrgInvitationEmail({
      toEmail: trimmedEmail,
      organizationName: trimmedName,
      organizationSlug: slug,
      adminName: adminName?.trim(),
      plan: plan || 'basic',
      invitationToken: invitation.token,
      invitationUrl,
    });

    if (!emailResult.success) {
      console.warn('[platformInvitations] Email failed, but invitation created');
    }

    return res.json({
      success: true,
      data: {
        id: invitation.id,
        organizationName: invitation.organization_name,
        organizationSlug: invitation.organization_slug,
        adminEmail: invitation.admin_email,
        adminName: invitation.admin_name,
        token: invitation.token,
        status: invitation.status,
        expiresAt: invitation.expires_at,
        plan: invitation.plan,
        createdAt: invitation.created_at,
        invitationUrl,
        previewUrl: emailResult.previewUrl,
      },
      message: emailResult.previewUrl
        ? `Invitation created and email sent! Preview: ${emailResult.previewUrl}`
        : `Invitation created and email sent to ${trimmedEmail}!`,
    });
  } catch (error) {
    console.error('[platformInvitations] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create invitation',
    });
  }
});

/**
 * POST /api/v1/platform/invitations/:id/resend
 * Resend invitation email
 */
router.post('/:id/resend', async (req: Request, res: Response) => {
  try {
    const invitationId = req.params.id;

    const sb = getSupabaseAdminClient();
    if (!sb || !isSupabaseAdminConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured',
      });
    }

    // Get invitation
    const { data: invitation, error: fetchError } = await sb
      .from('organization_invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !invitation) {
      return res.status(404).json({
        success: false,
        error: 'Invitation not found or already accepted',
      });
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Invitation has expired. Please create a new one.',
      });
    }

    // Generate invitation URL
    const clientOrigin = req.headers.origin || `http://localhost:${env.port || 5173}`;
    const invitationUrl = `${clientOrigin}/accept-org-invite/${invitation.token}`;

    // Send email
    const emailResult = await sendOrgInvitationEmail({
      toEmail: invitation.admin_email,
      organizationName: invitation.organization_name,
      organizationSlug: invitation.organization_slug,
      adminName: invitation.admin_name,
      plan: invitation.plan || 'basic',
      invitationToken: invitation.token,
      invitationUrl,
    });

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        error: emailResult.error || 'Failed to send email',
      });
    }

    return res.json({
      success: true,
      message: emailResult.previewUrl
        ? `Email resent! Preview: ${emailResult.previewUrl}`
        : `Email resent to ${invitation.admin_email}!`,
      previewUrl: emailResult.previewUrl,
    });
  } catch (error) {
    console.error('[platformInvitations.resend] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resend invitation',
    });
  }
});

/**
 * POST /api/v1/platform/invitations/sync-profile
 * Server-side safeguard to ensure profiles.email is populated using service role
 */
router.post('/sync-profile', async (req: Request, res: Response) => {
  try {
    const { userId, email, fullName } = req.body;
    if (!userId || !email) {
      return res.status(400).json({ success: false, error: 'Missing userId or email' });
    }

    const sb = getSupabaseAdminClient();
    if (sb && isSupabaseAdminConfigured()) {
      const trimmedEmail = String(email).trim().toLowerCase();
      const resolvedName = fullName || trimmedEmail.split('@')[0];

      await sb
        .from('profiles')
        .upsert({
          id: userId,
          email: trimmedEmail,
          full_name: resolvedName,
          platform_role: 'organization_user',
        }, { onConflict: 'id' });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[platformInvitations.syncProfile] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
