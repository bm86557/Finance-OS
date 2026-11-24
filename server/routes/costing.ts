/**
 * Costing & Pricing Intelligence Router (§12, §14, §8, §16, §33)
 * ==============================================================
 * Handles:
 *  - Commission Structures CRUD (multiplicative split validation + RBAC + audit)
 *  - Tenant-Scoped Exchange Rates & FX Conversion (single source of truth)
 *  - §14 Quote Simulator, Pricing & Versioning Engine (normalized tables + zero-cache cross-instance safety)
 *
 * NOTE: Overhead Allocations are owned exclusively by `server/routes/overheadAllocations.ts`
 * mounted at `/organizations/:organizationId/overhead-allocations` to eliminate Express route shadowing.
 */

import { Router, type Request, type Response } from 'express';
import type { CommissionStructure, ExchangeRate, Quote } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { DEFAULT_RATES_TO_USD, getEstimatedFxRate } from '../lib/fxConverter.js';
import { calculateQuoteFormulas } from '../services/costingEngine.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomainCommission(row: Record<string, any>): CommissionStructure {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    companyName: String(row.company_name ?? ''),
    country: row.country ? String(row.country) : undefined,
    currency: String(row.currency ?? 'USD'),
    yourProfitPercentage: Number(row.your_profit_percentage ?? 0),
    middlemanPercentage: Number(row.middleman_percentage ?? 0),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

function mapDomainToDbCommission(comm: CommissionStructure): Record<string, unknown> {
  return {
    id: comm.id,
    organization_id: comm.organizationId,
    company_name: comm.companyName,
    country: comm.country || null,
    currency: comm.currency || 'USD',
    your_profit_percentage: comm.yourProfitPercentage,
    middleman_percentage: comm.middlemanPercentage,
  };
}

function mapDbRowToQuote(row: Record<string, any>, versions: any[] = []): Quote {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    departmentId: row.department_id ? String(row.department_id) : null,
    clientName: String(row.client_name || 'Client'),
    projectName: String(row.project_name || ''),
    serviceType: String(row.service_type || 'Custom Project'),
    billingModel: String(row.billing_model || 'fixed_price'),
    deliveryHorizonMonths: Number(row.delivery_horizon_months ?? 1),
    currency: String(row.currency || 'USD'),
    targetMarginPercent: Number(row.target_margin_percent ?? 25),
    targetMarkupPercent: Number(row.target_markup_percent ?? 33.33),
    roleEstimates: Array.isArray(row.role_estimates) ? row.role_estimates : [],
    directPurchases: Array.isArray(row.direct_purchases) ? row.direct_purchases : [],
    overheadAmount: Number(row.overhead_amount ?? 0),
    overheadMethod: String(row.overhead_method || 'headcount'),
    contingencyPercent: Number(row.contingency_percent ?? 0),
    contingencyAmount: Number(row.contingency_amount ?? 0),
    estimatedDirectLabor: Number(row.estimated_direct_labor ?? 0),
    directPurchasesTotal: Number(row.direct_purchases_total ?? 0),
    estimatedTotalCost: Number(row.estimated_total_cost ?? 0),
    proposedPrice: Number(row.proposed_price ?? 0),
    profitAmount: Number(row.profit_amount ?? 0),
    marginPercent: row.margin_percent != null ? Number(row.margin_percent) : null,
    markupPercent: row.markup_percent != null ? Number(row.markup_percent) : null,
    requiredPriceForTargetMargin: row.required_price_for_target_margin != null ? Number(row.required_price_for_target_margin) : null,
    requiredPriceForTargetMarkup: Number(row.required_price_for_target_markup ?? 0),
    isTargetMarginValid: Number(row.target_margin_percent ?? 25) >= 0 && Number(row.target_margin_percent ?? 25) < 100,
    isBelowCost: Number(row.proposed_price ?? 0) > 0 && Number(row.proposed_price ?? 0) < Number(row.estimated_total_cost ?? 0),
    currentVersion: String(row.current_version || 'v1.0'),
    versions: versions.map(v => ({
      version: String(v.version),
      createdAt: String(v.created_at || v.createdAt || new Date().toISOString()),
      notes: String(v.notes || ''),
      proposedPrice: Number(v.proposed_price ?? v.proposedPrice ?? 0),
      estimatedTotalCost: Number(v.estimated_total_cost ?? v.estimatedTotalCost ?? 0),
      profitAmount: Number(v.profit_amount ?? v.profitAmount ?? 0),
      marginPercent: (v.margin_percent ?? v.marginPercent) != null ? Number(v.margin_percent ?? v.marginPercent) : null,
      markupPercent: (v.markup_percent ?? v.markupPercent) != null ? Number(v.markup_percent ?? v.markupPercent) : null,
    })),
    status: (row.status || 'draft') as Quote['status'],
    isRevenueRecognized: false,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function isMissingRelationOrColumn(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return code === '42P01' || code === '42703' || code === 'PGRST204' || msg.includes('does not exist') || msg.includes('schema cache');
}

/**
 * Builds canonical fallback baseline FX list derived strictly from `fxConverter.ts`
 * so every module in Finance OS shares ONE consistent FX source (§8, §33 #6).
 */
function buildCanonicalBaselineRates(): ExchangeRate[] {
  const asOf = new Date().toISOString().slice(0, 10);
  const pairs: Array<[string, string]> = [
    ['USD', 'PKR'],
    ['USD', 'EUR'],
    ['USD', 'GBP'],
    ['USD', 'AED'],
    ['USD', 'SAR'],
    ['AED', 'USD'],
    ['EUR', 'USD'],
    ['GBP', 'USD'],
    ['PKR', 'USD'],
    ['AED', 'PKR'],
  ];
  return pairs.map(([base, quote]) => {
    const rate = Math.round(getEstimatedFxRate(base, quote) * 10000) / 10000;
    return {
      id: `fx-base-${base}-${quote}`.toLowerCase(),
      organizationId: null,
      base,
      quote,
      rate,
      asOf,
      source: 'system_baseline',
    };
  });
}

export function createExchangeRatesReadRouter(): Router {
  const r = Router({ mergeParams: true });

  // ── GET /exchange-rates — Org overrides merged cleanly over global baselines ─
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      let rows: any[] | null = null;
      const orgQuery = await sb
        .from('exchange_rates')
        .select('*')
        .or(`organization_id.eq.${orgId},organization_id.is.null`)
        .order('as_of', { ascending: false });

      if (!orgQuery.error && orgQuery.data) {
        rows = orgQuery.data;
      } else if (orgQuery.error && isMissingRelationOrColumn(orgQuery.error)) {
        // Pre-migration 0047 fallback: table exists without organization_id
        const legacyQuery = await sb
          .from('exchange_rates')
          .select('*')
          .order('as_of', { ascending: false });
        if (!legacyQuery.error && legacyQuery.data) {
          rows = legacyQuery.data;
        }
      } else if (orgQuery.error) {
        return fail(res, 500, orgQuery.error.message);
      }

      if (rows && rows.length > 0) {
        // Deduplicate by (base, quote), prioritizing org-scoped override > latest global rate
        const byPair = new Map<string, any>();
        for (const row of rows) {
          const key = `${String(row.base).toUpperCase()}_${String(row.quote).toUpperCase()}`;
          const existing = byPair.get(key);
          const isOrgRow = row.organization_id === orgId;
          const existingIsOrg = existing?.organization_id === orgId;
          if (!existing || (isOrgRow && !existingIsOrg)) {
            byPair.set(key, row);
          }
        }

        const mapped: ExchangeRate[] = Array.from(byPair.values()).map(row => ({
          id: String(row.id),
          organizationId: row.organization_id ?? null,
          base: String(row.base).toUpperCase(),
          quote: String(row.quote).toUpperCase(),
          rate: Number(row.rate),
          asOf: String(row.as_of),
          source: String(row.source || (row.organization_id ? 'org_manual' : 'system')),
        }));
        return ok(res, mapped);
      }

      return ok(res, buildCanonicalBaselineRates());
    } catch (err: any) {
      console.error('[costing.exchange-rates.get] Error:', err);
      return fail(res, 500, err?.message || 'Failed to load exchange rates');
    }
  });

  // ── GET /exchange-rates/convert — Org-scoped FX conversion with provenance ─
  r.get('/convert', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const amount = Number(req.query.amount ?? 1);
    const from = String(req.query.from ?? 'USD').toUpperCase().trim();
    const to = String(req.query.to ?? 'USD').toUpperCase().trim();

    if (!Number.isFinite(amount)) {
      return fail(res, 400, 'Invalid amount');
    }

    if (from === to) {
      return ok(res, {
        amount,
        from,
        to,
        rate: 1,
        converted: Math.round(amount * 100) / 100,
        source: 'identity',
        asOf: new Date().toISOString().slice(0, 10),
      });
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        // 1. Check tenant-specific override first, then global DB rate
        const orgRes = await sb
          .from('exchange_rates')
          .select('rate, as_of, source, organization_id')
          .eq('base', from)
          .eq('quote', to)
          .or(`organization_id.eq.${orgId},organization_id.is.null`)
          .order('as_of', { ascending: false })
          .limit(5);

        if (!orgRes.error && orgRes.data && orgRes.data.length > 0) {
          const picked = orgRes.data.find((r: any) => r.organization_id === orgId) || orgRes.data[0];
          const rate = Number(picked.rate);
          if (rate > 0) {
            const converted = Math.round(amount * rate * 100) / 100;
            return ok(res, {
              amount,
              from,
              to,
              rate,
              converted,
              source: picked.organization_id ? 'org_override' : (picked.source || 'db_baseline'),
              asOf: picked.as_of,
            });
          }
        }
      } catch {
        /* fallback to canonical fxConverter */
      }
    }

    const rate = Math.round(getEstimatedFxRate(from, to) * 10000) / 10000;
    const converted = Math.round(amount * rate * 100) / 100;
    return ok(res, {
      amount,
      from,
      to,
      rate,
      converted,
      source: DEFAULT_RATES_TO_USD[from] && DEFAULT_RATES_TO_USD[to] ? 'system_baseline' : 'fallback_identity',
      asOf: new Date().toISOString().slice(0, 10),
    });
  });

  return r;
}

export function createCommissionStructuresRouter(): Router {
  const r = Router({ mergeParams: true });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. COMMISSION STRUCTURES (Multiplicative Split Validation + RBAC + Audit)
  // ══════════════════════════════════════════════════════════════════════════

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data, error } = await sb
        .from('commission_structures')
        .select('*')
        .eq('organization_id', orgId)
        .order('company_name', { ascending: true });

      if (error) {
        console.error('[costing.commission-structures.get] Supabase query error:', error);
        return fail(res, 500, error.message);
      }

      return ok(res, (data || []).map(mapDbToDomainCommission));
    } catch (err: any) {
      console.error('[costing.commission-structures.get] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to load commission structures');
    }
  });

  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as Partial<CommissionStructure>;

    if (!body.companyName || !body.companyName.trim()) {
      return fail(res, 400, 'Company name is required');
    }
    if (!body.currency || !body.currency.trim()) {
      return fail(res, 400, 'Currency is required');
    }

    const yourSplit = Number(body.yourProfitPercentage ?? 50);
    const middleman = Number(body.middlemanPercentage ?? 0);

    // Multiplicative model: Net = Deal × (yourSplit/100) × (1 - middleman/100)
    // Each percentage is independently valid in [0, 100].
    if (!Number.isFinite(yourSplit) || yourSplit < 0 || yourSplit > 100) {
      return fail(res, 400, 'Your split percentage must be between 0 and 100');
    }
    if (!Number.isFinite(middleman) || middleman < 0 || middleman > 100) {
      return fail(res, 400, 'Middleman cut must be between 0 and 100');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const newComm: CommissionStructure = {
      id: body.id || ('comm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)),
      organizationId: orgId,
      companyName: body.companyName.trim(),
      country: body.country?.trim() || undefined,
      currency: body.currency.trim().toUpperCase(),
      yourProfitPercentage: yourSplit,
      middlemanPercentage: middleman,
      createdAt: new Date().toISOString(),
    };

    try {
      const { data, error } = await sb
        .from('commission_structures')
        .insert(mapDomainToDbCommission(newComm))
        .select()
        .single();

      if (error) {
        console.error('[costing.commission-structures.post] Supabase error:', error);
        return fail(res, 400, error.message);
      }

      const mapped = mapDbToDomainCommission(data);
      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: 'commission_structure_created',
          entityType: 'commission_structure',
          entityId: mapped.id,
          description: `Created commission structure "${mapped.companyName}" (${mapped.yourProfitPercentage}% split, ${mapped.middlemanPercentage}% middleman cut)`,
          afterState: mapped as unknown as Record<string, unknown>,
        });
      } catch { /* non-blocking audit log */ }

      return created(res, mapped, 'Commission structure saved');
    } catch (err: any) {
      console.error('[costing.commission-structures.post] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to save commission structure');
    }
  });

  const updateCommissionHandler = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const updates = req.body as Partial<CommissionStructure>;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: curRow, error: curErr } = await sb
      .from('commission_structures')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (curErr) return fail(res, 500, curErr.message);
    if (!curRow) return notFound(res, 'Commission Structure');

    const current = mapDbToDomainCommission(curRow);
    const yourSplit = updates.yourProfitPercentage !== undefined ? Number(updates.yourProfitPercentage) : current.yourProfitPercentage;
    const middleman = updates.middlemanPercentage !== undefined ? Number(updates.middlemanPercentage) : current.middlemanPercentage;

    if (!Number.isFinite(yourSplit) || yourSplit < 0 || yourSplit > 100) {
      return fail(res, 400, 'Your split percentage must be between 0 and 100');
    }
    if (!Number.isFinite(middleman) || middleman < 0 || middleman > 100) {
      return fail(res, 400, 'Middleman cut must be between 0 and 100');
    }

    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.companyName !== undefined) dbUpdates.company_name = updates.companyName.trim();
      if (updates.country !== undefined) dbUpdates.country = updates.country?.trim() || null;
      if (updates.currency !== undefined) dbUpdates.currency = updates.currency.trim().toUpperCase();
      if (updates.yourProfitPercentage !== undefined) dbUpdates.your_profit_percentage = yourSplit;
      if (updates.middlemanPercentage !== undefined) dbUpdates.middleman_percentage = middleman;

      const { data, error } = await sb
        .from('commission_structures')
        .update(dbUpdates)
        .eq('id', id)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();

      if (error) {
        console.error('[costing.commission-structures.patch] Supabase error:', error);
        return fail(res, 400, error.message);
      }
      if (!data) return notFound(res, 'Commission Structure');

      const mapped = mapDbToDomainCommission(data);
      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: 'commission_structure_updated',
          entityType: 'commission_structure',
          entityId: mapped.id,
          description: `Updated commission structure "${mapped.companyName}"`,
          beforeState: current as unknown as Record<string, unknown>,
          afterState: mapped as unknown as Record<string, unknown>,
        });
      } catch { /* non-blocking audit log */ }

      return ok(res, mapped);
    } catch (err: any) {
      console.error('[costing.commission-structures.patch] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to update commission structure');
    }
  };

  r.patch('/:id', requirePermission('finance:write_transactions'), updateCommissionHandler);
  r.put('/:id', requirePermission('finance:write_transactions'), updateCommissionHandler);

  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: beforeRow } = await sb
        .from('commission_structures')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();

      const { error } = await sb
        .from('commission_structures')
        .delete()
        .eq('id', id)
        .eq('organization_id', orgId);

      if (error) {
        console.error('[costing.commission-structures.delete] Supabase error:', error);
        return fail(res, 500, error.message);
      }

      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: 'commission_structure_deleted',
          entityType: 'commission_structure',
          entityId: String(id),
          description: `Deleted commission structure "${beforeRow?.company_name || id}"`,
          beforeState: beforeRow ? (mapDbToDomainCommission(beforeRow) as unknown as Record<string, unknown>) : null,
        });
      } catch { /* non-blocking audit log */ }

      return ok(res, null, 'Commission structure deleted');
    } catch (err: any) {
      console.error('[costing.commission-structures.delete] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to delete commission structure');
    }
  });

  return r;
}

export function createExchangeRatesWriteRouter(): Router {
  const r = Router({ mergeParams: true });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. TENANT-SCOPED EXCHANGE RATE OVERRIDES (§5, §8, §20, §33 #6 & #11)
  // ══════════════════════════════════════════════════════════════════════════

  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { base, quote, rate } = req.body as { base?: string; quote?: string; rate?: number };

    if (!base || !quote || rate == null || !Number.isFinite(Number(rate)) || Number(rate) <= 0) {
      return fail(res, 400, 'Valid base, quote, and positive rate are required');
    }

    const b = base.trim().toUpperCase();
    const q = quote.trim().toUpperCase();
    const rVal = Number(rate);
    const asOf = new Date().toISOString().slice(0, 10);

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      // Tenant-isolated upsert: ALWAYS writes organization_id = orgId, never mutating global rates
      const { data: existing } = await sb
        .from('exchange_rates')
        .select('id, rate')
        .eq('organization_id', orgId)
        .eq('base', b)
        .eq('quote', q)
        .eq('as_of', asOf)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await sb
          .from('exchange_rates')
          .update({ rate: rVal, source: 'org_manual' })
          .eq('id', existing.id)
          .eq('organization_id', orgId);
        if (error) return fail(res, 500, error.message);
      } else {
        const { error } = await sb
          .from('exchange_rates')
          .insert({
            organization_id: orgId,
            base: b,
            quote: q,
            rate: rVal,
            as_of: asOf,
            source: 'org_manual',
          });
        if (error) {
          if (isMissingRelationOrColumn(error)) {
            return fail(
              res,
              503,
              'Tenant-scoped exchange_rates column (organization_id) not yet migrated. Apply migration 0047 before saving org FX overrides.',
            );
          }
          return fail(res, 500, error.message);
        }
      }

      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: 'exchange_rate_updated',
          entityType: 'exchange_rate',
          entityId: `${b}_${q}_${asOf}`,
          description: `Saved organization FX override ${b}/${q} = ${rVal} (as of ${asOf})`,
          beforeState: existing ? { rate: Number(existing.rate) } : null,
          afterState: { organizationId: orgId, base: b, quote: q, rate: rVal, asOf },
        });
      } catch { /* non-blocking audit log */ }

      return ok(res, { organizationId: orgId, base: b, quote: q, rate: rVal, asOf, source: 'org_manual' }, 'Organization exchange rate saved');
    } catch (err: any) {
      console.error('[costing.exchange-rates.post] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to save exchange rate');
    }
  });

  return r;
}

export function createQuotesRouter(): Router {
  const r = Router({ mergeParams: true });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. §14 QUOTE SIMULATOR, PRICING & VERSIONING ENGINE
  //    (Normalized `quotes` + `quote_versions`, zero cross-instance memory cache)
  // ══════════════════════════════════════════════════════════════════════════

  async function loadOrgQuotesFromDb(sb: any, orgId: string): Promise<{ quotes: Quote[]; usingNormalizedTable: boolean }> {
    const { data: qRows, error: qErr } = await sb
      .from('quotes')
      .select('*')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false });

    if (!qErr && Array.isArray(qRows)) {
      const quoteIds = qRows.map((q: any) => q.id);
      let versionsByQuote = new Map<string, any[]>();
      if (quoteIds.length > 0) {
        const { data: vRows } = await sb
          .from('quote_versions')
          .select('*')
          .eq('organization_id', orgId)
          .in('quote_id', quoteIds)
          .order('created_at', { ascending: true });
        for (const v of vRows || []) {
          const list = versionsByQuote.get(v.quote_id) || [];
          list.push(v);
          versionsByQuote.set(v.quote_id, list);
        }
      }
      return {
        quotes: qRows.map((row: any) => mapDbRowToQuote(row, versionsByQuote.get(row.id) || [])),
        usingNormalizedTable: true,
      };
    }

    if (qErr && !isMissingRelationOrColumn(qErr)) {
      throw new Error(qErr.message);
    }

    // Pre-migration 0047 graceful fallback (read directly from DB, never stale process memory)
    const { data: orgData } = await sb
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    const saved = Array.isArray(orgData?.settings?.saved_quotes) ? orgData.settings.saved_quotes : [];
    return { quotes: saved, usingNormalizedTable: false };
  }

  async function persistLegacyOrgQuotes(sb: any, orgId: string, quotes: Quote[]): Promise<void> {
    const { data: orgData } = await sb
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    const currentSettings = (orgData?.settings && typeof orgData.settings === 'object') ? orgData.settings : {};
    const { error } = await sb
      .from('organizations')
      .update({ settings: { ...currentSettings, saved_quotes: quotes } })
      .eq('id', orgId);
    if (error) throw new Error(error.message);
  }

  // Pure Calculation Endpoint for real-time simulator preview (zero DB writes — §14 L739)
  r.post('/calculate', (req: Request, res: Response) => {
    const body = req.body || {};
    const targetMargin = Number(body.targetMarginPercent ?? 25);
    if (!Number.isFinite(targetMargin) || targetMargin < 0 || targetMargin >= 100) {
      return fail(res, 400, 'Target margin must be between 0% and 99.99% (cannot be negative or >= 100%)');
    }
    const calc = calculateQuoteFormulas(body);
    return ok(res, calc);
  });

  // GET / — List all saved quotes with versions
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { quotes } = await loadOrgQuotesFromDb(sb, orgId);
      return ok(res, quotes);
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to load quotes');
    }
  });

  // POST / — Create quote or append immutable new quote version (§14)
  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body || {};
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    if (!body.projectName || !String(body.projectName).trim()) {
      return fail(res, 400, 'Project / Quote name is required');
    }

    const targetMargin = Number(body.targetMarginPercent ?? 25);
    if (!Number.isFinite(targetMargin) || targetMargin < 0 || targetMargin >= 100) {
      return fail(res, 400, 'Target margin must be between 0% and 99.99%');
    }

    const calc = calculateQuoteFormulas(body);
    const nowIso = new Date().toISOString();

    try {
      const { quotes: existingList, usingNormalizedTable } = await loadOrgQuotesFromDb(sb, orgId);
      const existing = body.id ? existingList.find(q => q.id === body.id) : undefined;
      const quoteId = existing?.id || body.id || (`quote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
      const nextVersionNum = existing ? (existing.versions?.length || 1) + 1 : 1;
      const nextVersion = `v1.${nextVersionNum - 1}`;
      const versionNotes = String(body.versionNotes || (existing ? `Version update ${nextVersion}` : 'Initial baseline quote version'));

      if (usingNormalizedTable) {
        const dbQuoteRow = {
          id: quoteId,
          organization_id: orgId,
          department_id: body.departmentId || existing?.departmentId || null,
          client_name: String(body.clientName || existing?.clientName || 'Client').trim(),
          project_name: String(body.projectName).trim(),
          service_type: String(body.serviceType || existing?.serviceType || 'Custom Project'),
          billing_model: String(body.billingModel || existing?.billingModel || 'fixed_price'),
          delivery_horizon_months: Math.max(0.25, Number(body.deliveryHorizonMonths ?? existing?.deliveryHorizonMonths ?? 1)),
          currency: String(body.currency || existing?.currency || 'USD').toUpperCase(),
          target_margin_percent: targetMargin,
          target_markup_percent: Math.max(0, Number(body.targetMarkupPercent ?? existing?.targetMarkupPercent ?? 33.33)),
          role_estimates: Array.isArray(body.roleEstimates) ? body.roleEstimates : (existing?.roleEstimates || []),
          direct_purchases: Array.isArray(body.directPurchases) ? body.directPurchases : (existing?.directPurchases || []),
          overhead_amount: calc.overheadAmount,
          overhead_method: String(body.overheadMethod || existing?.overheadMethod || 'headcount'),
          contingency_percent: calc.contingencyPercent,
          contingency_amount: calc.contingencyAmount,
          estimated_direct_labor: calc.estimatedDirectLabor,
          direct_purchases_total: calc.directPurchasesTotal,
          estimated_total_cost: calc.estimatedTotalCost,
          proposed_price: calc.proposedPrice,
          profit_amount: calc.profitAmount,
          margin_percent: calc.marginPercent,
          markup_percent: calc.markupPercent,
          required_price_for_target_margin: calc.requiredPriceForTargetMargin,
          required_price_for_target_markup: calc.requiredPriceForTargetMarkup,
          current_version: nextVersion,
          status: existing?.status || body.status || 'draft',
          is_revenue_recognized: false,
          created_by: existing ? undefined : (req.authUser?.id || null),
          updated_at: nowIso,
        };

        const { data: savedRow, error: saveErr } = existing
          ? await sb.from('quotes').update(dbQuoteRow).eq('id', quoteId).eq('organization_id', orgId).select().single()
          : await sb.from('quotes').insert({ ...dbQuoteRow, created_at: nowIso }).select().single();

        if (saveErr) return fail(res, 500, saveErr.message);

        await sb.from('quote_versions').insert({
          quote_id: quoteId,
          organization_id: orgId,
          version: nextVersion,
          notes: versionNotes,
          proposed_price: calc.proposedPrice,
          estimated_total_cost: calc.estimatedTotalCost,
          profit_amount: calc.profitAmount,
          margin_percent: calc.marginPercent,
          markup_percent: calc.markupPercent,
          snapshot_payload: { ...dbQuoteRow, decimals: calc.decimals },
          created_by: req.authUser?.id || null,
          created_at: nowIso,
        });

        const { data: vRows } = await sb
          .from('quote_versions')
          .select('*')
          .eq('quote_id', quoteId)
          .order('created_at', { ascending: true });

        const mapped = mapDbRowToQuote(savedRow, vRows || []);

        try {
          await logAuditEvent(req, {
            organizationId: orgId,
            action: existing ? 'quote_version_created' : 'quote_created',
            entityType: 'quote',
            entityId: mapped.id,
            description: `${existing ? 'Saved new version' : 'Created quote'} "${mapped.projectName}" (${mapped.currentVersion})`,
            afterState: { version: mapped.currentVersion, proposedPrice: mapped.proposedPrice, estimatedTotalCost: mapped.estimatedTotalCost, marginPercent: mapped.marginPercent, markupPercent: mapped.markupPercent },
          });
        } catch { /* non-blocking audit log */ }

        return created(res, mapped);
      }

      // Pre-migration 0047 fallback in organizations.settings.saved_quotes (always fresh DB read)
      const versionEntry = {
        version: nextVersion,
        createdAt: nowIso,
        notes: versionNotes,
        proposedPrice: calc.proposedPrice,
        estimatedTotalCost: calc.estimatedTotalCost,
        profitAmount: calc.profitAmount,
        marginPercent: calc.marginPercent,
        markupPercent: calc.markupPercent,
      };
      const quote: Quote = {
        id: quoteId,
        organizationId: orgId,
        departmentId: body.departmentId || existing?.departmentId || null,
        clientName: String(body.clientName || existing?.clientName || 'Client').trim(),
        projectName: String(body.projectName).trim(),
        serviceType: String(body.serviceType || existing?.serviceType || 'Custom Project'),
        billingModel: String(body.billingModel || existing?.billingModel || 'fixed_price'),
        deliveryHorizonMonths: Number(body.deliveryHorizonMonths ?? existing?.deliveryHorizonMonths ?? 1),
        currency: String(body.currency || existing?.currency || 'USD').toUpperCase(),
        targetMarginPercent: targetMargin,
        targetMarkupPercent: Number(body.targetMarkupPercent ?? existing?.targetMarkupPercent ?? 33.33),
        roleEstimates: Array.isArray(body.roleEstimates) ? body.roleEstimates : (existing?.roleEstimates || []),
        directPurchases: Array.isArray(body.directPurchases) ? body.directPurchases : (existing?.directPurchases || []),
        overheadMethod: String(body.overheadMethod || existing?.overheadMethod || 'headcount'),
        ...calc,
        currentVersion: nextVersion,
        versions: [...(existing?.versions || []), versionEntry],
        status: existing?.status || body.status || 'draft',
        isRevenueRecognized: false,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      const nextList = existing
        ? existingList.map(q => (q.id === quoteId ? quote : q))
        : [quote, ...existingList];

      await persistLegacyOrgQuotes(sb, orgId, nextList);

      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: existing ? 'quote_version_created' : 'quote_created',
          entityType: 'quote',
          entityId: quote.id,
          description: `${existing ? 'Saved new version' : 'Created quote'} "${quote.projectName}" (${quote.currentVersion})`,
          afterState: { version: quote.currentVersion, proposedPrice: quote.proposedPrice, estimatedTotalCost: quote.estimatedTotalCost },
        });
      } catch { /* non-blocking audit log */ }

      return created(res, quote);
    } catch (err: any) {
      console.error('[costing.quotes.post] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to save quote');
    }
  });

  // DELETE /:id
  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const quoteId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { quotes, usingNormalizedTable } = await loadOrgQuotesFromDb(sb, orgId);
      const before = quotes.find(q => q.id === quoteId);

      if (usingNormalizedTable) {
        const { error } = await sb
          .from('quotes')
          .delete()
          .eq('id', quoteId)
          .eq('organization_id', orgId);
        if (error) return fail(res, 500, error.message);
      } else {
        await persistLegacyOrgQuotes(sb, orgId, quotes.filter(q => q.id !== quoteId));
      }

      try {
        await logAuditEvent(req, {
          organizationId: orgId,
          action: 'quote_deleted',
          entityType: 'quote',
          entityId: String(quoteId),
          description: `Deleted quote "${before?.projectName || quoteId}"`,
          beforeState: before ? { projectName: before.projectName, currentVersion: before.currentVersion, proposedPrice: before.proposedPrice } : null,
        });
      } catch { /* non-blocking audit log */ }

      return ok(res, null, 'Quote deleted');
    } catch (err: any) {
      console.error('[costing.quotes.delete] Exception:', err);
      return fail(res, 500, err?.message || 'Failed to delete quote');
    }
  });

  return r;
}

export function createCostingRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use('/commission-structures', createCommissionStructuresRouter());
  r.use('/exchange-rates', createExchangeRatesReadRouter());
  r.use('/exchange-rates', createExchangeRatesWriteRouter());
  r.use('/quotes', createQuotesRouter());
  return r;
}
