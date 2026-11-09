/**
 * Attachments & File Provenance Router
 * Mounted at `/organizations/:organizationId/attachments` (mergeParams).
 * Operates strictly on Supabase PostgreSQL with explicit error propagation.
 */

import { Router, type Request, type Response } from 'express';
import { ok, created, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

export function createAttachmentsRouter(): Router {
  const r = Router({ mergeParams: true });

  // Get attachments for a specific entity
  r.get('/:entityType/:entityId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { entityType, entityId } = req.params;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { data, error } = await sb
      .from('attachments')
      .select('*')
      .eq('organization_id', orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });

    if (error) {
      return fail(res, 500, error.message);
    }

    return ok(res, data || []);
  });

  // Record a new uploaded attachment
  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const {
      entity_type,
      entity_id,
      file_name,
      file_size,
      mime_type,
      storage_bucket = 'receipts',
      storage_path,
      file_hash,
    } = req.body;

    if (!entity_type || !entity_id || !file_name || !storage_path) {
      return fail(res, 400, 'entity_type, entity_id, file_name, and storage_path are required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const callerUserId = (req as any).authUser?.id || (req as any).user?.id || null;
    const record = {
      organization_id: orgId,
      entity_type,
      entity_id,
      file_name,
      file_size: Number(file_size) || 0,
      mime_type: mime_type || 'application/octet-stream',
      storage_bucket,
      storage_path,
      file_hash: file_hash || null,
      uploaded_by: callerUserId,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await sb.from('attachments').insert(record).select().single();
    if (error) {
      return fail(res, 500, error.message);
    }

    return created(res, data);
  });

  // Delete an attachment
  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return fail(res, 503, 'Supabase client is unconfigured');
    }

    const { error } = await sb
      .from('attachments')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) {
      return fail(res, 500, error.message);
    }

    return ok(res, { deleted: true });
  });

  return r;
}
