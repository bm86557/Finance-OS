/**
 * Central, fail-loud environment resolution for the server. Import this before anything else
 * touches `process.env` for auth/security config, so a missing required var in production surfaces
 * immediately at boot rather than as a mysterious runtime failure later.
 */

import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Vite dev server auto-loads `.env` / `.env.local`, but this Express server is started
// standalone (`tsx watch server/index.ts`) and Node does not do that on its own — without this,
// every var below would silently fall back to its dev default even when `.env.local` sets it.
// Mirrors Vite's own precedence: `.env.local` wins over `.env` for any key present in both.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');
loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true });
loadDotenv({ path: path.join(repoRoot, '.env.local'), override: true, quiet: true });

const isProd = process.env.NODE_ENV === 'production';

export function validateSupabaseEnv(url?: string, serviceRoleKey?: string): { supabaseUrl: string; supabaseServiceRoleKey: string } {
  const finalUrl = (url ?? process.env.SUPABASE_URL)?.trim() || '';
  if (!finalUrl) {
    throw new Error('[FATAL] Missing required Supabase credentials: SUPABASE_URL is not defined or empty. Server cannot boot without exclusive Supabase authority.');
  }

  try {
    const parsed = new URL(finalUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Protocol must be http or https');
    }
  } catch {
    throw new Error(`[FATAL] Invalid Supabase credentials: SUPABASE_URL "${finalUrl}" must be a valid HTTP or HTTPS URL.`);
  }

  const finalKey = (serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim() || '';
  if (!finalKey) {
    throw new Error('[FATAL] Missing required Supabase credentials: SUPABASE_SERVICE_ROLE_KEY is not defined or empty. Server cannot boot without exclusive Supabase authority.');
  }

  return { supabaseUrl: finalUrl, supabaseServiceRoleKey: finalKey };
}

// Fail-fast on module import unless explicitly skipped (e.g. isolated unit testing of validation functions)
const { supabaseUrl, supabaseServiceRoleKey } = validateSupabaseEnv();

export const env = {
  isProd,
  // NOTE: JWT_SECRET / JWT_EXPIRES_IN are intentionally absent. The local JWT flow
  // (server/lib/jwt.ts) has been deleted — tokens are now minted and verified solely by Supabase
  // Auth, so the server no longer signs anything and needs no signing secret of its own.
  corsOrigin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProd,
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
  port: Number(process.env.PORT ?? 3001),
  // Exclusive authoritative database credentials
  supabaseUrl,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || '',
  supabaseServiceRoleKey,
  // SMTP configuration for sending real invitation emails
  smtpHost: process.env.SMTP_HOST?.trim() || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER?.trim() || '',
  smtpPass: process.env.SMTP_PASS?.trim() || '',
  smtpFrom: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'Finance OS <noreply@financeos.com>',
  // Stripe Sandbox & Billing configuration
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || process.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || '',
  stripeMode: (process.env.STRIPE_SECRET_KEY?.trim() ? 'stripe_test' : 'sandbox_simulator') as 'stripe_test' | 'sandbox_simulator',
};
