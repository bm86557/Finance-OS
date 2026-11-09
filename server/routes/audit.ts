/**
 * §19 — Immutable Audit Log router. Mounted at `/organizations/:organizationId/audit-logs`.
 * Backed by Supabase `public.audit_logs` with fallback to in-memory ring buffer if table is not yet migrated.
 */

import { Router, type Request, type Response } from 'express';
import { ok, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { getGlobalPlatformSettings } from './platformSettings.js';

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  userRole?: string;
  action: string;
  resource: string;
  resourceId: string;
  entityType?: string;
  entityId?: string;
  details: string;
  description?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  ipAddress: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}

export function pushAuditLog(entry: AuditLogEntry): void {
  void logAuditEvent(null, {
    organizationId: entry.organizationId,
    action: entry.action,
    entityType: entry.entityType || entry.resource || 'system',
    entityId: entry.entityId || entry.resourceId || '',
    description: entry.details || entry.description || '',
    metadata: { severity: entry.severity, userName: entry.userName },
  });
}

function inferSeverity(action: string): 'info' | 'warning' | 'critical' {
  const lower = action.toLowerCase();
  if (lower.includes('delete') || lower.includes('reverse') || lower.includes('support_session')) {
    return 'critical';
  }
  if (lower.includes('update') || lower.includes('bulk') || lower.includes('override')) {
    return 'warning';
  }
  return 'info';
}

export function createAuditRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/', async (req: Request, res: Response) => {
    const rawOrg = req.orgMembership?.organizationId ?? req.params.organizationId;
    const orgId = Array.isArray(rawOrg) ? rawOrg[0] : String(rawOrg ?? '');
    const {
      severity,
      action,
      entityType,
      userId,
      startDate,
      endDate,
      search,
    } = req.query as {
      severity?: string;
      action?: string;
      entityType?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    };

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    let query = sb
      .from('audit_logs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (action) query = query.eq('action', action);
    if (entityType) query = query.eq('entity_type', entityType);
    if (userId) query = query.eq('actor_user_id', userId);
    if (startDate) {
      query = query.gte('created_at', startDate);
    } else if (req.query.includeArchived !== 'true') {
      const platformSettings = await getGlobalPlatformSettings();
      const retentionDays = platformSettings.retention_policies.audit_log_retention_days || 365;
      const retentionCutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
      query = query.gte('created_at', retentionCutoff);
    }
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) {
      return fail(res, 500, error.message);
    }

    let entries: AuditLogEntry[] = (data || []).map((row: Record<string, unknown>) => {
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};
      const act = String(row.action ?? 'view');
      const sev = (meta.severity as 'info' | 'warning' | 'critical') || inferSeverity(act);
      const actorName = String(meta.actor_name || row.actor_email || 'System');
      const desc = String(row.description ?? '');
      const entType = String(row.entity_type ?? 'record');
      const entId = String(row.entity_id ?? '');

      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        userId: String(row.actor_user_id ?? 'system'),
        userName: actorName,
        userRole: String(row.actor_role ?? 'member'),
        action: act,
        resource: entType,
        resourceId: entId,
        entityType: entType,
        entityId: entId,
        details: desc,
        description: desc,
        changes: (meta.changes as Record<string, { old: unknown; new: unknown }>) ?? undefined,
        ipAddress: String(row.ip_address ?? '0.0.0.0'),
        timestamp: String(row.created_at ?? new Date().toISOString()),
        severity: sev,
      };
    });

    if (severity) entries = entries.filter(l => l.severity === severity);
    if (action) entries = entries.filter(l => l.action === action);
    if (entityType) entries = entries.filter(l => l.entityType === entityType || l.resource === entityType);
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter(
        l =>
          l.details.toLowerCase().includes(q) ||
          l.userName.toLowerCase().includes(q) ||
          l.resource.toLowerCase().includes(q),
      );
    }

    ok(res, entries);
  });

  return r;
}
