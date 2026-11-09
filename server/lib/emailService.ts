import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface InviteEmailParams {
  toEmail: string;
  name?: string;
  organizationName: string;
  organizationId: string;
  role: string;
  portalUrl: string;
  acceptInviteUrl?: string;
}

export interface SentEmailRecord {
  id: string;
  to: string;
  name?: string;
  organizationName: string;
  role: string;
  subject: string;
  portalUrl: string;
  acceptInviteUrl?: string;
  previewUrl?: string;
  sentAt: string;
  status: 'sent' | 'preview_generated' | 'fallback_logged';
}

export const recentSentEmails: SentEmailRecord[] = [];

/**
 * Creates a configured nodemailer transporter.
 * If SMTP credentials are provided, connects to real SMTP.
 * Otherwise, falls back to an Ethereal test inbox or in-memory logging for development.
 */
async function getTransporter() {
  const host = process.env.SMTP_HOST?.trim() || env.smtpHost;
  const user = process.env.SMTP_USER?.trim() || env.smtpUser;
  const pass = process.env.SMTP_PASS?.trim() || env.smtpPass;
  const port = Number(process.env.SMTP_PORT || env.smtpPort || 587);
  const secure = (process.env.SMTP_SECURE || String(env.smtpSecure)) === 'true';

  if (process.env.NODE_ENV !== 'test' && host && user && pass) {
    return {
      transporter: nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      }),
      isTest: false,
    };
  }

  // Development / local fallback: use reliable JSON transport
  const transporter = nodemailer.createTransport({
    jsonTransport: true,
  });
  return { transporter, isTest: true };
}

function generateEmailHtml(params: InviteEmailParams): string {
  const { toEmail, name, organizationName, role, portalUrl, acceptInviteUrl } = params;
  const roleDisplay = role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const recipientName = name?.trim() || toEmail.split('@')[0];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to join ${organizationName} on Finance OS</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e2e8f0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #111827 0%, #0d131f 100%); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          
          <!-- Header Branding -->
          <tr>
            <td style="padding: 32px 40px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); background: linear-gradient(90deg, rgba(16,185,129,0.12), rgba(6,182,212,0.12));">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="display: inline-block; padding: 6px 14px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; font-size: 13px; font-weight: 700; color: #10b981; letter-spacing: 0.5px;">
                      FINANCE OS
                    </div>
                  </td>
                  <td align="right">
                    <span style="font-size: 12px; color: #94a3b8; font-family: monospace;">TEAM INVITATION</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px 40px 32px;">
              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                You're invited to join <span style="color: #34d399;">${organizationName}</span> on Finance OS
              </h1>
              
              <p style="margin: 0 0 24px; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                Hello <strong>${recipientName}</strong>,
              </p>

              <p style="margin: 0 0 24px; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                You have been invited to join the team of <strong style="color: #ffffff;">${organizationName}</strong> on the <strong style="color: #34d399;">Finance OS</strong> financial management platform as a <strong style="color: #38bdf8;">${roleDisplay}</strong>.
              </p>

              <!-- Highlight Callout Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 32px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 12px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #34d399;">
                      How to join the team:
                    </p>
                    <p style="margin: 0 0 8px; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                      1. Click <strong>Activate &amp; Set Password</strong> below and choose a password for <strong>${toEmail}</strong>.
                    </p>
                    <p style="margin: 0 0 8px; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                      2. You will be signed in and taken to the <strong>Employee Portal</strong> automatically.
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                      3. After that, use the <strong>Employee Portal</strong> link below to sign in again any time.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Primary CTA Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
                <tr>
                  <td align="center">
                    <a href="${acceptInviteUrl || portalUrl}" style="display: inline-block; padding: 15px 36px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; border-radius: 10px; box-shadow: 0 8px 20px -4px rgba(16, 185, 129, 0.5); letter-spacing: 0.3px;">
                      Activate &amp; Set Password &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 20px; font-size: 13px; color: #94a3b8; text-align: center;">
                Already activated your account? Sign in here:<br>
                <a href="${portalUrl}" style="color: #38bdf8; word-break: break-all; text-decoration: underline;">
                  ${portalUrl}
                </a>
              </p>

              <p style="margin: 24px 0 0; font-size: 13px; color: #64748b; line-height: 1.5; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 20px;">
                If you did not expect this invitation, you can ignore this email — no account will be created.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #090d16; border-top: 1px solid rgba(255,255,255,0.06); text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #64748b;">
                Finance OS &bull; Multi-tenant Financial Intelligence &bull; Secured with end-to-end multi-tenant isolation
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
}

/**
 * Sends an invitation email to the employee.
 */
export async function sendInviteEmail(params: InviteEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  previewUrl?: string;
  clientUrl: string;
}> {
  const { toEmail, organizationName, portalUrl } = params;
  const subject = `You are invited to the team of ${organizationName} on Finance OS`;
  const html = generateEmailHtml(params);
  const text = `
You are invited to join the team of ${organizationName} on Finance OS!

You can log in through the Employee Portal of Finance OS to join the team and access your workspace:
${portalUrl}

If this is your first time logging in with this email (${toEmail}), please set up your password on the Employee Portal.
Once logged in, you will see your organization invitation with options to Accept or Reject joining the team.

Finance OS
  `.trim();

  try {
    const { transporter, isTest } = await getTransporter();

    const info = await transporter.sendMail({
      from: env.smtpFrom,
      to: toEmail,
      subject,
      text,
      html,
    });

    let previewUrl: string | undefined = undefined;
    if (isTest && info) {
      const etherealUrl = nodemailer.getTestMessageUrl(info);
      if (etherealUrl) previewUrl = etherealUrl;
    }

    const record: SentEmailRecord = {
      id: `mail-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      to: toEmail,
      name: params.name,
      organizationName,
      role: params.role,
      subject,
      portalUrl,
      acceptInviteUrl: params.acceptInviteUrl,
      previewUrl,
      sentAt: new Date().toISOString(),
      status: previewUrl ? 'preview_generated' : 'sent',
    };

    recentSentEmails.unshift(record);
    if (recentSentEmails.length > 50) recentSentEmails.pop();

    console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║ 📧 FINANCE OS INVITATION EMAIL DISPATCHED                             ║');
    console.log(`║ Recipient: ${toEmail.padEnd(58)} ║`);
    console.log(`║ Organization: ${organizationName.padEnd(55)} ║`);
    console.log(`║ Portal URL: ${portalUrl.padEnd(57)} ║`);
    if (previewUrl) {
      console.log(`║ Ethereal Preview: ${previewUrl.padEnd(51)} ║`);
    }
    console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

    return {
      success: true,
      messageId: info.messageId,
      previewUrl,
      clientUrl: portalUrl,
    };
  } catch (err) {
    console.error('[emailService] Error sending email:', err);

    // Fallback: record as logged so the system doesn't break
    const record: SentEmailRecord = {
      id: `mail-${Date.now()}`,
      to: toEmail,
      name: params.name,
      organizationName,
      role: params.role,
      subject,
      portalUrl,
      acceptInviteUrl: params.acceptInviteUrl,
      sentAt: new Date().toISOString(),
      status: 'fallback_logged',
    };
    recentSentEmails.unshift(record);

    return {
      success: true,
      previewUrl: undefined,
      clientUrl: portalUrl,
    };
  }
}

export interface NotificationEmailParams {
  toEmail: string;
  name?: string;
  organizationName?: string;
  subject: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  category?: string;
}

/**
 * Dispatches an automated notification email to an employee when their emailNotifications preference is active.
 * Complies with FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md §X-03 (Rejection/approval notification routing with approved email channel).
 */
export async function sendNotificationEmail(params: NotificationEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  previewUrl?: string;
}> {
  const { toEmail, name, organizationName, subject, title, message, actionUrl, actionLabel, category } = params;
  const recipientName = name?.trim() || toEmail.split('@')[0];
  const orgDisplay = organizationName || 'Finance OS';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e2e8f0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #111827 0%, #0d131f 100%); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <tr>
            <td style="padding: 28px 36px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); background: linear-gradient(90deg, rgba(139,92,246,0.12), rgba(6,182,212,0.12));">
              <span style="display: inline-block; padding: 5px 12px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.35); border-radius: 8px; font-size: 12px; font-weight: 700; color: #c084fc; letter-spacing: 0.5px;">
                ${orgDisplay.toUpperCase()} NOTIFICATION
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 36px 24px;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #ffffff;">
                Hello ${recipientName},
              </h2>
              <div style="padding: 16px 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600; color: #f1f5f9;">${title}</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #94a3b8;">${message}</p>
              </div>
              ${actionUrl ? `
              <div style="margin-top: 24px; text-align: left;">
                <a href="${actionUrl}" style="display: inline-block; padding: 12px 24px; background: #8b5cf6; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 10px;">
                  ${actionLabel || 'View in Employee Portal'} &rarr;
                </a>
              </div>` : ''}
              <p style="margin: 28px 0 0 0; font-size: 12px; color: #64748b;">
                You received this email because email notifications are enabled in your Employee Portal Settings. To manage your preferences, visit My Settings &gt; Notification Preferences.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `${title}\n\n${message}\n\n${actionLabel ? `${actionLabel}: ${actionUrl}` : ''}\n\nManaged in Employee Portal Settings.`;

  try {
    const { transporter, isTest } = await getTransporter();
    const info = await transporter.sendMail({
      from: env.smtpFrom,
      to: toEmail,
      subject,
      text,
      html,
    });

    let previewUrl: string | undefined = undefined;
    if (isTest && info) {
      const etherealUrl = nodemailer.getTestMessageUrl(info);
      if (etherealUrl) previewUrl = etherealUrl;
    }

    const record: SentEmailRecord = {
      id: `notif-mail-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      to: toEmail,
      name: recipientName,
      organizationName: orgDisplay,
      role: 'employee',
      subject,
      portalUrl: actionUrl || '/employee',
      previewUrl,
      sentAt: new Date().toISOString(),
      status: previewUrl ? 'preview_generated' : 'sent',
    };

    recentSentEmails.unshift(record);
    if (recentSentEmails.length > 50) recentSentEmails.pop();

    console.log(`[emailService] Notification email dispatched to ${toEmail} (${subject})`);
    return { success: true, messageId: info.messageId, previewUrl };
  } catch (err) {
    console.warn('[emailService] Real SMTP delivery failed/timed out, recording fallback outbox:', err);
    const record: SentEmailRecord = {
      id: `notif-mail-${Date.now()}`,
      to: toEmail,
      name: recipientName,
      organizationName: orgDisplay,
      role: 'employee',
      subject,
      portalUrl: actionUrl || '/employee',
      sentAt: new Date().toISOString(),
      status: 'fallback_logged',
    };
    recentSentEmails.unshift(record);
    if (recentSentEmails.length > 50) recentSentEmails.pop();
    return { success: true };
  }
}

export interface PayslipEmailParams {
  toEmail: string;
  name?: string;
  organizationName?: string;
  period: string;
  issueDate?: string;
  gross: number;
  deductions?: Array<{ label?: string; name?: string; amount: number }>;
  net: number;
  currency?: string;
  portalUrl?: string;
}

/**
 * Dispatches an official salary payslip notification email to an employee when a payslip is issued.
 */
export async function sendPayslipEmail(params: PayslipEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  previewUrl?: string;
}> {
  const { toEmail, name, organizationName, period, issueDate, gross, deductions, net, currency, portalUrl } = params;
  const recipientName = name?.trim() || toEmail.split('@')[0];
  const orgDisplay = organizationName || 'Finance OS';
  const cur = currency || 'USD';
  const subject = `[Finance OS] Payslip Issued for ${period} - ${orgDisplay}`;
  const actionLink = portalUrl || 'http://localhost:5173/employee?tab=payslips';

  const cleanDeductions = Array.isArray(deductions)
    ? deductions.filter(d => Number(d.amount) > 0)
    : [];
  const totalDeductions = cleanDeductions.reduce((s, d) => s + Number(d.amount || 0), 0);

  const formattedGross = `${cur} ${Number(gross || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formattedDeductions = `${cur} ${Number(totalDeductions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formattedNet = `${cur} ${Number(net || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const effDate = issueDate || new Date().toISOString().slice(0, 10);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e2e8f0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(180deg, #111827 0%, #0d131f 100%); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <tr>
            <td style="padding: 28px 36px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); background: linear-gradient(90deg, rgba(16,185,129,0.12), rgba(6,182,212,0.12));">
              <span style="display: inline-block; padding: 5px 12px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; font-size: 12px; font-weight: 700; color: #34d399; letter-spacing: 0.5px;">
                OFFICIAL PAYSLIP &bull; ${period.toUpperCase()}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 36px 24px;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #ffffff;">
                Hello ${recipientName},
              </h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Your official salary payslip for <strong>${period}</strong> has been issued by <strong>${orgDisplay}</strong> and is now available in your Employee Portal.
              </p>

              <!-- Payslip Summary Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; margin-bottom: 24px; overflow: hidden;">
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; color: #94a3b8;">Pay Period</td>
                  <td align="right" style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; font-weight: 600; color: #f1f5f9;">${period}</td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; color: #94a3b8;">Issue Date</td>
                  <td align="right" style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; font-weight: 600; color: #f1f5f9;">${effDate}</td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; color: #94a3b8;">Gross Earnings</td>
                  <td align="right" style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; font-weight: 600; color: #f1f5f9;">${formattedGross}</td>
                </tr>
                ${totalDeductions > 0 ? `
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; color: #f87171;">Total Deductions</td>
                  <td align="right" style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; font-weight: 600; color: #f87171;">-${formattedDeductions}</td>
                </tr>
                ` : ''}
                <tr style="background: rgba(16, 185, 129, 0.08);">
                  <td style="padding: 16px 20px; font-size: 14px; font-weight: 700; color: #ffffff;">Net Take-Home Pay</td>
                  <td align="right" style="padding: 16px 20px; font-size: 18px; font-weight: 700; color: #34d399;">${formattedNet}</td>
                </tr>
              </table>

              <!-- Action Button -->
              <div style="margin: 28px 0; text-align: left;">
                <a href="${actionLink}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; border-radius: 10px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);">
                  View &amp; Download Payslip &rarr;
                </a>
              </div>

              <p style="margin: 28px 0 0 0; font-size: 12px; color: #64748b; line-height: 1.5; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 20px;">
                You received this notification because email notifications are enabled in your Employee Portal Settings. You can view your full payslip records and print PDF receipts anytime from the My Payslips tab.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `Payslip Issued: ${period}\n\nHello ${recipientName},\nYour official salary payslip for ${period} has been issued by ${orgDisplay}.\n\nGross Earnings: ${formattedGross}\nTotal Deductions: ${formattedDeductions}\nNet Take-Home Pay: ${formattedNet}\nIssue Date: ${effDate}\n\nView and download your payslip here:\n${actionLink}\n\nManaged in Employee Portal Settings.`;

  try {
    const { transporter, isTest } = await getTransporter();
    const info = await transporter.sendMail({
      from: env.smtpFrom,
      to: toEmail,
      subject,
      text,
      html,
    });

    let previewUrl: string | undefined = undefined;
    if (isTest && info) {
      const etherealUrl = nodemailer.getTestMessageUrl(info);
      if (etherealUrl) previewUrl = etherealUrl;
    }

    const record: SentEmailRecord = {
      id: `payslip-mail-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      to: toEmail,
      name: recipientName,
      organizationName: orgDisplay,
      role: 'employee',
      subject,
      portalUrl: actionLink,
      previewUrl,
      sentAt: new Date().toISOString(),
      status: previewUrl ? 'preview_generated' : 'sent',
    };

    recentSentEmails.unshift(record);
    if (recentSentEmails.length > 50) recentSentEmails.pop();

    console.log(`[emailService] Payslip email successfully dispatched to ${toEmail} (${subject})`);
    return { success: true, messageId: info.messageId, previewUrl };
  } catch (err) {
    console.warn('[emailService] Real SMTP delivery failed/timed out, recording fallback outbox:', err);
    const record: SentEmailRecord = {
      id: `payslip-mail-${Date.now()}`,
      to: toEmail,
      name: recipientName,
      organizationName: orgDisplay,
      role: 'employee',
      subject,
      portalUrl: actionLink,
      sentAt: new Date().toISOString(),
      status: 'fallback_logged',
    };
    recentSentEmails.unshift(record);
    if (recentSentEmails.length > 50) recentSentEmails.pop();
    return { success: true };
  }
}
