/**
 * Local SQLite API — stores the same JSON bundle as the browser `dataStore` / localStorage.
 * `/api/v1/*` (server/routes/apiV1.ts) implements the full REST surface from
 * `architecture/api-backend-rollout.md` §1–§19 against the shared in-memory `store`
 * (server/lib/store.ts), which persists to `data/finance-os.db` after every mutation.
 *
 * Run with `npm run dev:server` or `npm run dev:full` alongside the Vite app.
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { getSupabaseAdminClient } from './lib/supabaseAdmin.js';
import { createApiV1Router } from './routes/apiV1.js';
import { startOutboxWorker } from './lib/outboxWorker.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1gb' }));
app.use(cookieParser());

app.use('/api/v1', createApiV1Router());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'finance-os-api',
    database: 'supabase-postgresql',
    routes: ['/api/v1/auth/login', '/api/v1/auth/session', '/api/v1/organizations/:orgId/...'],
  });
});

/**
 * Whole-bundle endpoint decommissioned — Finance OS operates exclusively on Supabase PostgreSQL.
 * Returns HTTP 410 Gone to prevent any legacy client/sync attempts.
 */
app.all('/api/bundle', (_req, res) => {
  res.status(410).json({
    error: 'SQLite bundle synchronization has been decommissioned. Finance OS operates exclusively on Supabase PostgreSQL.',
  });
});

// Active Supabase connection probe & port listening (only for local standalone server)
if (!process.env.VERCEL) {
  const sbAdmin = getSupabaseAdminClient();
  if (sbAdmin) {
    try {
      const { error } = await sbAdmin.from('organizations').select('id').limit(1);
      if (!error) {
        console.log('[finance-os] Connected to authoritative Supabase PostgreSQL database.');
      }
    } catch (connErr: any) {
      console.warn('[finance-os] Supabase connection probe warning:', connErr?.message || connErr);
    }
  }

  app.listen(env.port, () => {
    console.log(`[finance-os] API http://localhost:${env.port} — Supabase PostgreSQL exclusive + /api/v1 REST (§1-§19)`);
    startOutboxWorker();
  });
}

export default app;
