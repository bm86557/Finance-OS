/**
 * Overhead Allocations Route
 * Mounted at `/organizations/:organizationId/overhead-allocations` (mergeParams).
 * CRUD operations for overhead allocation management backed exclusively by Supabase.
 */

import { Router, type Request, type Response } from 'express';
import type { OverheadAllocation } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomain(row: Record<string, any>): OverheadAllocation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    allocationBase: row.allocation_base || 'headcount',
    accountIds: Array.isArray(row.account_ids) ? row.account_ids : [],
    departments: Array.isArray(row.departments) ? row.departments : [],
    amount: row.amount != null ? Number(row.amount) : undefined,
    policyVersion: row.policy_version || 'v1.2-costing',
    isOperating: row.is_operating !== false,
  };
}

function mapDomainToDb(alloc: OverheadAllocation): Record<string, unknown> {
  return {
    id: alloc.id,
    organization_id: alloc.organizationId,
    name: alloc.name,
    allocation_base: alloc.allocationBase,
    account_ids: alloc.accountIds || [],
    departments: alloc.departments || [],
    amount: alloc.amount != null ? alloc.amount : 0,
    policy_version: alloc.policyVersion || 'v1.2-costing',
    is_operating: alloc.isOperating !== false,
  };
}

const VALID_ALLOCATION_BASES = [
  'equal',
  'headcount',
  'revenue',
  'direct_cost',
  'custom',
  'manual_weight',
  'department_ratio',
  'square_footage',
  'time_utilization',
];

export function createOverheadAllocationsRouter(): Router {
  const r = Router({ mergeParams: true });

  // GET all overhead allocations
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('overhead_allocations')
      .select('*')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[overheadAllocations.get] Supabase query error:', error.message);
      return fail(res, 500, error.message);
    }

    return ok(res, (data || []).map(mapDbToDomain));
  });

  // GET single overhead allocation
  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const allocId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('overhead_allocations')
      .select('*')
      .eq('id', allocId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) {
      console.error('[overheadAllocations.getById] Supabase query error:', error.message);
      return fail(res, 500, error.message);
    }

    if (!data) return notFound(res, 'Overhead Allocation');
    return ok(res, mapDbToDomain(data));
  });

  // POST create new overhead allocation
  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<OverheadAllocation, 'id' | 'organizationId'>;

    if (data.allocationBase && !VALID_ALLOCATION_BASES.includes(data.allocationBase)) {
      return fail(res, 400, `Invalid allocationBase. Must be one of: ${VALID_ALLOCATION_BASES.join(', ')}`);
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = (data as any).id || ('alloc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newAlloc: OverheadAllocation = {
      ...data,
      id: newId,
      organizationId: orgId,
      accountIds: data.accountIds || [],
      departments: data.departments || [],
      amount: data.amount || 0,
    };

    const dbRow = mapDomainToDb(newAlloc);
    const { data: insertedData, error } = await sb
      .from('overhead_allocations')
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      console.error('[overheadAllocations.post] Supabase insert error:', error.message);
      return fail(res, 500, error.message);
    }

    return created(res, mapDbToDomain(insertedData), 'Overhead allocation created');
  });

  // PATCH update overhead allocation
  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const allocId = req.params.id;
    const updates = req.body as Partial<OverheadAllocation>;

    if (updates.allocationBase && !VALID_ALLOCATION_BASES.includes(updates.allocationBase)) {
      return fail(res, 400, `Invalid allocationBase. Must be one of: ${VALID_ALLOCATION_BASES.join(', ')}`);
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.allocationBase !== undefined) dbUpdates.allocation_base = updates.allocationBase;
    if (updates.accountIds !== undefined) dbUpdates.account_ids = updates.accountIds;
    if (updates.departments !== undefined) dbUpdates.departments = updates.departments;
    if (updates.amount !== undefined) dbUpdates.amount = updates.amount;

    const { data, error } = await sb
      .from('overhead_allocations')
      .update(dbUpdates)
      .eq('id', allocId)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[overheadAllocations.patch] Supabase update error:', error.message);
      return fail(res, 500, error.message);
    }

    if (!data) return notFound(res, 'Overhead Allocation');
    return ok(res, mapDbToDomain(data));
  });

  // DELETE overhead allocation
  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const allocId = req.params.id;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { error } = await sb
      .from('overhead_allocations')
      .delete()
      .eq('id', allocId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('[overheadAllocations.delete] Supabase delete error:', error.message);
      return fail(res, 500, error.message);
    }

    return ok(res, null, 'Overhead allocation deleted');
  });

  return r;
}
