/**
 * Overhead Allocations & Frozen Allocation Runs Route (§12.3, §12.7, §33 #10)
 * Mounted at `/organizations/:organizationId/overhead-allocations` (mergeParams).
 * Single canonical router for all overhead pool CRUD, allocation method switching,
 * and immutable frozen allocation run snapshots — backed by Supabase with RBAC & audit logging.
 */

import { Router, type Request, type Response } from 'express';
import type { OverheadAllocation, OverheadAllocationBase } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import {
  VALID_ALLOCATION_BASES,
  allocateOverheadPools,
  resolveCostingPeriod,
} from '../services/costingEngine.js';
import { calculateDepartmentProfitability } from './departments.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomain(row: Record<string, any>): OverheadAllocation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    allocationBase: (row.allocation_base || 'headcount') as OverheadAllocationBase,
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
    policy_version: String(alloc.policyVersion || 'v1.2-costing'),
    is_operating: alloc.isOperating !== false,
  };
}

function validateCustomDepartments(
  allocationBase: string,
  departments?: Array<{ departmentId?: string; percentage?: number; weight?: number }>,
): string | null {
  if (allocationBase !== 'custom' || !Array.isArray(departments) || departments.length === 0) {
    return null;
  }
  const totalPct = departments.reduce((sum, d) => sum + Number(d?.percentage ?? d?.weight ?? 0), 0);
  if (Math.abs(totalPct - 100) > 0.05) {
    return `Department percentages must total 100% for custom allocation (currently ${totalPct.toFixed(1)}%)`;
  }
  return null;
}

export function createOverheadAllocationsRouter(): Router {
  const r = Router({ mergeParams: true });

  // ── GET / — List all overhead pools for org ────────────────────────────────
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

  // ── GET /runs — List immutable frozen allocation runs (§12.7) ──────────────
  r.get('/runs', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: runs, error } = await sb
        .from('allocation_runs')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        // Table not yet migrated — return empty list gracefully
        if (error.code === '42P01' || error.message.includes('allocation_runs')) {
          return ok(res, []);
        }
        return fail(res, 500, error.message);
      }

      return ok(res, (runs || []).map((run: any) => ({
        id: String(run.id),
        organizationId: String(run.organization_id),
        periodStart: String(run.period_start),
        periodEnd: String(run.period_end),
        policyVersion: String(run.policy_version || 'v1.2-costing'),
        currency: String(run.currency || 'USD'),
        totalPoolAmount: Number(run.total_pool_amount || 0),
        allocatedAmount: Number(run.allocated_amount || 0),
        unallocatedRemainder: Number(run.unallocated_remainder || 0),
        status: run.status || 'frozen',
        lines: run.snapshot_data?.lines || [],
        createdAt: String(run.created_at),
      })));
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to load allocation runs');
    }
  });

  // ── POST /runs — Freeze an immutable allocation run snapshot (§12.7) ───────
  r.post('/runs', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { from, to, period } = req.body || {};
      const resolved = resolveCostingPeriod({ from, to, period });
      const deptProfit = await calculateDepartmentProfitability(orgId, from, to, period);

      const [{ data: sbAllocs }, { data: sbAccounts }, { data: orgRow }] = await Promise.all([
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('accounts').select('id, balance, currency').eq('organization_id', orgId),
        sb.from('organizations').select('base_currency, currency').eq('id', orgId).maybeSingle(),
      ]);

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      const allocResult = allocateOverheadPools({
        departments: deptProfit.map((d: any) => ({
          departmentId: d.departmentId,
          departmentName: d.departmentName,
          headcount: d.headcount,
          revenue: d.revenue,
          directCosts: d.directCosts,
          scheduledHours: d.billableHours,
          squareFootage: d.squareFootage || 0,
          customWeight: 1,
        })),
        allocations: sbAllocs || [],
        accounts: sbAccounts || [],
        periodMonths: resolved.periodMonths,
        orgCurrency,
      });

      const runId = `alloc-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();
      const periodStart = resolved.fromDate || nowIso.slice(0, 10);
      const periodEnd = resolved.toDate || nowIso.slice(0, 10);

      const runRow = {
        id: runId,
        organization_id: orgId,
        period_start: periodStart,
        period_end: periodEnd,
        policy_version: 'v1.2-costing',
        currency: orgCurrency,
        total_pool_amount: allocResult.totalEligiblePoolAmount,
        allocated_amount: allocResult.totalAllocatedAmount,
        unallocated_remainder: allocResult.unallocatedRemainder,
        status: 'frozen',
        snapshot_data: {
          periodLabel: resolved.periodLabel,
          periodMonths: resolved.periodMonths,
          includedPoolsCount: allocResult.includedPoolsCount,
          excludedNonOperatingCount: allocResult.excludedNonOperatingCount,
          lines: allocResult.allLines,
          departments: deptProfit.map((d: any) => ({
            departmentId: d.departmentId,
            departmentName: d.departmentName,
            headcount: d.headcount,
            capacityHours: d.totalHours,
            directCosts: d.directCosts,
            allocatedOverhead: d.allocatedOverhead,
            costPerHour: d.costPerHour,
            costPerMinute: d.costPerMinute,
          })),
        },
        created_by: req.authUser?.id || null,
        created_at: nowIso,
      };

      const { error: runErr } = await sb.from('allocation_runs').insert(runRow);
      if (runErr) {
        if (runErr.code === '42P01' || runErr.message.includes('allocation_runs')) {
          return fail(res, 503, 'Allocation runs table not yet migrated. Please apply migration 0047.');
        }
        return fail(res, 500, runErr.message);
      }

      if (allocResult.allLines.length > 0) {
        const lineRows = allocResult.allLines.map(l => ({
          run_id: runId,
          organization_id: orgId,
          pool_id: l.poolId,
          pool_name: l.poolName,
          department_id: l.departmentId,
          department_name: l.departmentName,
          driver_base: l.driverBase,
          driver_value: l.driverValue,
          total_driver_value: l.totalDriverValue,
          driver_share_percent: l.driverSharePercent,
          allocated_amount: l.allocatedAmount,
        }));
        await sb.from('allocation_run_lines').insert(lineRows);
      }

      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: 'allocation_run_frozen',
          entityType: 'allocation_run',
          entityId: runId,
          description: `Frozen overhead allocation run for ${resolved.periodLabel} (${orgCurrency} ${allocResult.totalAllocatedAmount.toFixed(2)} allocated)`,
          afterState: {
            periodStart,
            periodEnd,
            totalPoolAmount: allocResult.totalEligiblePoolAmount,
            allocatedAmount: allocResult.totalAllocatedAmount,
            unallocatedRemainder: allocResult.unallocatedRemainder,
          },
        });
      } catch { /* non-blocking audit log */ }

      return created(res, {
        id: runId,
        organizationId: orgId,
        periodStart,
        periodEnd,
        policyVersion: 'v1.2-costing',
        currency: orgCurrency,
        totalPoolAmount: allocResult.totalEligiblePoolAmount,
        allocatedAmount: allocResult.totalAllocatedAmount,
        unallocatedRemainder: allocResult.unallocatedRemainder,
        status: 'frozen',
        lines: allocResult.allLines,
        createdAt: nowIso,
      }, 'Overhead allocation run frozen');
    } catch (err: any) {
      console.error('[overheadAllocations.runs.post] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to freeze overhead allocation run');
    }
  });

  // ── POST & PUT /method — Switch allocation basis across all org pools ──────
  const setMethodHandler = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { method } = req.body as { method?: OverheadAllocationBase };

    if (!method || !(VALID_ALLOCATION_BASES as readonly string[]).includes(method)) {
      return fail(
        res,
        400,
        `Invalid allocation method. Must be one of: ${VALID_ALLOCATION_BASES.join(', ')}`,
      );
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: beforeRows } = await sb
      .from('overhead_allocations')
      .select('id, name, allocation_base')
      .eq('organization_id', orgId);

    const { error } = await sb
      .from('overhead_allocations')
      .update({ allocation_base: method })
      .eq('organization_id', orgId);

    if (error) {
      console.error('[overheadAllocations.method] Supabase update error:', error.message);
      return fail(res, 500, error.message);
    }

    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'overhead_allocation_method_changed',
        entityType: 'overhead_allocation',
        entityId: orgId,
        description: `Changed organization overhead allocation method to "${method}" across ${(beforeRows || []).length} pool(s)`,
        beforeState: { pools: beforeRows || [] },
        afterState: { method, poolCount: (beforeRows || []).length },
      });
    } catch { /* non-blocking audit log */ }

    return ok(res, { method }, `Overhead allocation method updated to ${method}`);
  };

  r.post('/method', requirePermission('finance:write_transactions'), setMethodHandler);
  r.put('/method', requirePermission('finance:write_transactions'), setMethodHandler);

  // ── GET /:id — Single overhead pool ────────────────────────────────────────
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

  // ── POST / — Create overhead pool ──────────────────────────────────────────
  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Partial<OverheadAllocation>;

    if (!data?.name || !data.name.trim()) {
      return fail(res, 400, 'Allocation name is required');
    }

    const allocationBase = (data.allocationBase || 'headcount') as OverheadAllocationBase;
    if (!(VALID_ALLOCATION_BASES as readonly string[]).includes(allocationBase)) {
      return fail(res, 400, `Invalid allocationBase. Must be one of: ${VALID_ALLOCATION_BASES.join(', ')}`);
    }

    const amount = data.amount != null ? Number(data.amount) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      return fail(res, 400, 'Pool amount must be a non-negative number');
    }

    const customErr = validateCustomDepartments(allocationBase, data.departments);
    if (customErr) return fail(res, 400, customErr);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newId = data.id || ('alloc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    const newAlloc: OverheadAllocation = {
      id: newId,
      organizationId: orgId,
      name: data.name.trim(),
      allocationBase,
      accountIds: Array.isArray(data.accountIds) ? data.accountIds : [],
      departments: Array.isArray(data.departments) ? data.departments : [],
      amount,
      policyVersion: data.policyVersion || 'v1.2-costing',
      isOperating: data.isOperating !== false,
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

    const mapped = mapDbToDomain(insertedData);
    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'overhead_allocation_created',
        entityType: 'overhead_allocation',
        entityId: mapped.id,
        description: `Created overhead pool "${mapped.name}" (${mapped.amount ?? 0}/mo, basis: ${mapped.allocationBase})`,
        afterState: mapped as unknown as Record<string, unknown>,
      });
    } catch { /* non-blocking audit log */ }

    return created(res, mapped, 'Overhead allocation created');
  });

  // ── PATCH & PUT /:id — Update overhead pool ────────────────────────────────
  const updatePoolHandler = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const allocId = req.params.id;
    const updates = req.body as Partial<OverheadAllocation>;

    if (updates.allocationBase && !(VALID_ALLOCATION_BASES as readonly string[]).includes(updates.allocationBase)) {
      return fail(res, 400, `Invalid allocationBase. Must be one of: ${VALID_ALLOCATION_BASES.join(', ')}`);
    }
    if (updates.amount !== undefined && (!Number.isFinite(Number(updates.amount)) || Number(updates.amount) < 0)) {
      return fail(res, 400, 'Pool amount must be a non-negative number');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: existingRow } = await sb
      .from('overhead_allocations')
      .select('*')
      .eq('id', allocId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!existingRow) return notFound(res, 'Overhead Allocation');

    const effectiveBase = updates.allocationBase ?? existingRow.allocation_base ?? 'headcount';
    const effectiveDepts = updates.departments ?? existingRow.departments;
    const customErr = validateCustomDepartments(effectiveBase, effectiveDepts);
    if (customErr) return fail(res, 400, customErr);

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
    if (updates.allocationBase !== undefined) dbUpdates.allocation_base = updates.allocationBase;
    if (updates.accountIds !== undefined) dbUpdates.account_ids = updates.accountIds;
    if (updates.departments !== undefined) dbUpdates.departments = updates.departments;
    if (updates.amount !== undefined) dbUpdates.amount = Number(updates.amount);
    if (updates.isOperating !== undefined) dbUpdates.is_operating = Boolean(updates.isOperating);

    const { data, error } = await sb
      .from('overhead_allocations')
      .update(dbUpdates)
      .eq('id', allocId)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[overheadAllocations.update] Supabase update error:', error.message);
      return fail(res, 500, error.message);
    }

    if (!data) return notFound(res, 'Overhead Allocation');
    const mapped = mapDbToDomain(data);

    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'overhead_allocation_updated',
        entityType: 'overhead_allocation',
        entityId: mapped.id,
        description: `Updated overhead pool "${mapped.name}"`,
        beforeState: mapDbToDomain(existingRow) as unknown as Record<string, unknown>,
        afterState: mapped as unknown as Record<string, unknown>,
      });
    } catch { /* non-blocking audit log */ }

    return ok(res, mapped);
  };

  r.patch('/:id', requirePermission('finance:write_transactions'), updatePoolHandler);
  r.put('/:id', requirePermission('finance:write_transactions'), updatePoolHandler);

  // ── DELETE /:id — Delete overhead pool ─────────────────────────────────────
  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const allocId = req.params.id;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: beforeRow } = await sb
      .from('overhead_allocations')
      .select('*')
      .eq('id', allocId)
      .eq('organization_id', orgId)
      .maybeSingle();

    const { error } = await sb
      .from('overhead_allocations')
      .delete()
      .eq('id', allocId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('[overheadAllocations.delete] Supabase delete error:', error.message);
      return fail(res, 500, error.message);
    }

    try {
      await logAuditEvent(req, {
        organizationId: orgId,
        action: 'overhead_allocation_deleted',
        entityType: 'overhead_allocation',
        entityId: String(allocId),
        description: `Deleted overhead pool "${beforeRow?.name || allocId}"`,
        beforeState: beforeRow ? (mapDbToDomain(beforeRow) as unknown as Record<string, unknown>) : null,
      });
    } catch { /* non-blocking audit log */ }

    return ok(res, null, 'Overhead allocation deleted');
  });

  return r;
}
