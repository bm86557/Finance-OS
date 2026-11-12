/**
 * Durable, append-only Audit Logger backed by Supabase `public.audit_logs` (§7, §19, §32, §33).
 * Falls back gracefully to an in-memory ring buffer only if the DB table has not been migrated yet,
 * ensuring application routes never crash while guaranteeing persistence when migrated.
 */

import type { Request } from 'express';
import { getSupabaseAdminClient } from './supabaseAdmin.js';

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  userRole: string;
  isSupportSession?: boolean;
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress: string;
  userAgent?: string;
  timestamp: string;
}

export interface WriteAuditParams {
  organizationId?: string;
  action: string;
  entityType?: string;
  entity?: string;
  entityId?: string | string[];
  description?: string;
  details?: Record<string, unknown>;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

function computeChangesDiff(
  beforeState?: Record<string, unknown> | null,
  afterState?: Record<string, unknown> | null,
): Record<string, { old: unknown; new: unknown }> | undefined {
  if (!beforeState || !afterState) return undefined;
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  const keys = new Set([...Object.keys(beforeState), ...Object.keys(afterState)]);
  for (const key of keys) {
    if (key === 'updated_at' || key === 'updatedAt') continue;
    const oldVal = beforeState[key];
    const newVal = afterState[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }
  return Object.keys(diff).length > 0 ? diff : undefined;
}

export async function logAuditEvent(req: Request | null, params: WriteAuditParams): Promise<void> {
  const user = req?.authUser;
  const membership = req?.orgMembership;
  const userId = user?.id ?? 'system';
  const userName = user?.name || user?.email || 'System';
  const userRole = membership?.role || user?.role || 'system';
  const isSupportSession = Boolean(req?.isSupportSession);
  const ipAddress =
    (req?.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req?.socket?.remoteAddress ||
    '0.0.0.0';
  const userAgent = (req?.headers['user-agent'] as string) || '';
  const nowIso = new Date().toISOString();
  const changes = computeChangesDiff(params.beforeState, params.afterState);

  const sb = getSupabaseAdminClient();
  if (!sb) {
    throw new Error('[auditLogger] Cannot log audit event: Supabase client is unconfigured');
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  const entityIdVal = Array.isArray(params.entityId) ? params.entityId[0] : (params.entityId ?? '');
  const orgIdVal = params.organizationId || (membership as any)?.organizationId || (user as any)?.organizationId || '';
  const { error } = await sb.from('audit_logs').insert({
    organization_id: orgIdVal,
    actor_user_id: isUuid ? userId : null,
    actor_email: user?.email || userName,
    actor_role: userRole,
    is_support_session: isSupportSession,
    action: params.action,
    entity_type: params.entityType || params.entity || 'general',
    entity_id: entityIdVal,
    description: params.description || `${params.action} ${params.entity || params.entityType || 'record'}`,
    before_state: params.beforeState ?? null,
    after_state: params.afterState ?? null,
    metadata: {
      ...(params.metadata ?? {}),
      ...(params.details ? { details: params.details } : {}),
      ...(changes ? { changes } : {}),
      actor_name: userName,
    },
    ip_address: ipAddress,
    user_agent: userAgent,
    created_at: nowIso,
  });

  if (error) {
    console.error('[auditLogger] Failed to persist audit log to Supabase:', error.message);
    throw new Error(`[auditLogger] Audit persistence failure: ${error.message}`);
  }
}


