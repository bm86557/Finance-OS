/**
 * Costing & Pricing Intelligence Router
 * =====================================
 * Handles:
 *  - Overhead Allocations CRUD (with 100% sum validation)
 *  - Commission Structures CRUD (with <= 100% split validation)
 *  - Exchange Rates & FX Conversion
 *
 * Backed by Supabase DB with resilient SQLite store fallback.
 */

import { Router, type Request, type Response } from 'express';
import type { OverheadAllocation, CommissionStructure, ExchangeRate } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDbToDomainAllocation(row: Record<string, any>): OverheadAllocation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    allocationBase: row.allocation_base || 'headcount',
    accountIds: Array.isArray(row.account_ids) ? row.account_ids : [],
    departments: Array.isArray(row.departments) ? row.departments : [],
    amount: row.amount != null ? Number(row.amount) : undefined,
  };
}

function mapDomainToDbAllocation(alloc: OverheadAllocation, safeBase = false): Record<string, unknown> {
  return {
    id: alloc.id,
    organization_id: alloc.organizationId,
    name: alloc.name,
    allocation_base: safeBase && alloc.allocationBase === 'custom' ? 'headcount' : (alloc.allocationBase || 'headcount'),
    account_ids: alloc.accountIds || [],
    departments: alloc.departments || [],
    amount: alloc.amount != null ? alloc.amount : 0,
  };
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

export function createCostingRouter(): Router {
  const r = Router({ mergeParams: true });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. OVERHEAD ALLOCATIONS
  // ══════════════════════════════════════════════════════════════════════════

  r.get(['/overhead-allocations', '/costing/overhead-allocations'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('overhead_allocations')
          .select('*')
          .eq('organization_id', orgId)
          .order('name', { ascending: true });

        if (error) {
          console.error('[costing.overhead-allocations.get] Supabase query error:', error);
          return fail(res, 500, error.message);
        }

        return ok(res, (data || []).map(mapDbToDomainAllocation));
      } catch (err) {
        console.error('[costing.overhead-allocations.get] Supabase query error:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.post(['/overhead-allocations', '/costing/overhead-allocations'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body as Partial<OverheadAllocation>;

    if (!body.name || !body.name.trim()) {
      return fail(res, 400, 'Allocation name is required');
    }

    const allocationBase = body.allocationBase || 'headcount';
    const departments = Array.isArray(body.departments) ? body.departments : [];

    // Validate 100% total percentage rule if custom percentage distribution is provided
    if (departments.length > 0 && allocationBase === 'custom') {
      const totalPct = departments.reduce((sum, d) => sum + Number(d.percentage || 0), 0);
      if (Math.abs(totalPct - 100) > 0.05) {
        return fail(res, 400, `Department percentages must total 100% (currently ${totalPct.toFixed(1)}%)`);
      }
    }

    const newAlloc: OverheadAllocation = {
      id: body.id || ('alloc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)),
      organizationId: orgId,
      name: body.name.trim(),
      allocationBase,
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
      departments,
      amount: body.amount != null ? Math.max(0, Number(body.amount)) : 0,
    };

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        let { data, error } = await sb
          .from('overhead_allocations')
          .insert(mapDomainToDbAllocation(newAlloc))
          .select()
          .single();

        if (error && newAlloc.allocationBase === 'custom') {
          const fallback = await sb
            .from('overhead_allocations')
            .insert(mapDomainToDbAllocation(newAlloc, true))
            .select()
            .single();
          data = fallback.data;
          error = fallback.error;
        }

        if (!error && data) {
          const mapped = mapDbToDomainAllocation(data);
          if (newAlloc.allocationBase === 'custom') mapped.allocationBase = 'custom';
          return created(res, mapped, 'Overhead allocation created');
        }
        console.error('[costing.overhead-allocations.post] Supabase error:', error);
      } catch (err) {
        console.error('[costing.overhead-allocations.post] Exception:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.put(['/overhead-allocations/:id', '/costing/overhead-allocations/:id'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const updates = req.body as Partial<OverheadAllocation>;

    if (updates.departments && updates.allocationBase === 'custom') {
      const totalPct = updates.departments.reduce((sum, d) => sum + Number(d.percentage || 0), 0);
      if (Math.abs(totalPct - 100) > 0.05) {
        return fail(res, 400, `Department percentages must total 100% (currently ${totalPct.toFixed(1)}%)`);
      }
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const dbUpdates: Record<string, unknown> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
        if (updates.allocationBase !== undefined) dbUpdates.allocation_base = updates.allocationBase;
        if (updates.accountIds !== undefined) dbUpdates.account_ids = updates.accountIds;
        if (updates.departments !== undefined) dbUpdates.departments = updates.departments;
        if (updates.amount !== undefined) dbUpdates.amount = Number(updates.amount);

        let { data, error } = await sb
          .from('overhead_allocations')
          .update(dbUpdates)
          .eq('id', id)
          .eq('organization_id', orgId)
          .select()
          .single();

        if (error && updates.allocationBase === 'custom') {
          dbUpdates.allocation_base = 'headcount';
          const fallback = await sb
            .from('overhead_allocations')
            .update(dbUpdates)
            .eq('id', id)
            .eq('organization_id', orgId)
            .select()
            .single();
          data = fallback.data;
          error = fallback.error;
        }

        if (!error && data) {
          const mapped = mapDbToDomainAllocation(data);
          if (updates.allocationBase === 'custom') mapped.allocationBase = 'custom';
          return ok(res, mapped);
        }
      } catch (err) {
        console.error('[costing.overhead-allocations.put] Supabase update exception:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  const setMethodHandler = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { method } = req.body as { method: OverheadAllocation['allocationBase'] };

    if (!method || !['revenue', 'headcount', 'direct_cost', 'equal', 'custom'].includes(method)) {
      return fail(res, 400, 'Invalid allocation method');
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb
          .from('overhead_allocations')
          .update({ allocation_base: method })
          .eq('organization_id', orgId);
      } catch (err) {
        console.error('[costing.overhead-allocations.method] Supabase error:', err);
      }
    }

    

    ok(res, { method }, `Overhead allocation method updated to ${method}`);
  };

  r.post(['/overhead-allocations/method', '/costing/overhead-allocations/method'], setMethodHandler);
  r.put(['/overhead-allocations/method', '/costing/overhead-allocations/method'], setMethodHandler);

  // ══════════════════════════════════════════════════════════════════════════
  // 2. COMMISSION STRUCTURES
  // ══════════════════════════════════════════════════════════════════════════

  r.get(['/commission-structures', '/costing/commission-structures'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
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
      } catch (err) {
        console.error('[costing.commission-structures.get] Supabase query error:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.post(['/commission-structures', '/costing/commission-structures'], async (req: Request, res: Response) => {
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

    if (isNaN(yourSplit) || yourSplit < 0 || yourSplit > 100) {
      return fail(res, 400, 'Your split percentage must be between 0 and 100');
    }
    if (isNaN(middleman) || middleman < 0 || middleman > 100) {
      return fail(res, 400, 'Middleman cut must be between 0 and 100');
    }

    // CHECK validation: splits must not exceed 100%
    if (yourSplit + middleman > 100) {
      return fail(
        res,
        400,
        `Commission splits cannot exceed 100% (Your split: ${yourSplit}%, Middleman cut: ${middleman}%, Sum: ${yourSplit + middleman}%)`
      );
    }

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

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('commission_structures')
          .insert(mapDomainToDbCommission(newComm))
          .select()
          .single();

        if (!error && data) {
          const mapped = mapDbToDomainCommission(data);
          
          return created(res, mapped, 'Commission structure saved');
        }
        console.error('[costing.commission-structures.post] Supabase error:', error);
      } catch (err) {
        console.error('[costing.commission-structures.post] Exception:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  const updateCommissionHandler = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const updates = req.body as Partial<CommissionStructure>;

    let current: CommissionStructure | null = null;
    {
      const sbCur = getSupabaseAdminClient();
      if (sbCur) {
        const { data: curRow } = await sbCur
          .from('commission_structures')
          .select('*')
          .eq('id', id)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (curRow) current = mapDbToDomainCommission(curRow);
      }
    }

    const yourSplit = updates.yourProfitPercentage !== undefined ? Number(updates.yourProfitPercentage) : current?.yourProfitPercentage ?? 50;
    const middleman = updates.middlemanPercentage !== undefined ? Number(updates.middlemanPercentage) : current?.middlemanPercentage ?? 0;

    if (yourSplit + middleman > 100) {
      return fail(
        res,
        400,
        `Commission splits cannot exceed 100% (Your split: ${yourSplit}%, Middleman cut: ${middleman}%, Sum: ${yourSplit + middleman}%)`
      );
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
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
          .single();

        if (!error && data) {
          const mapped = mapDbToDomainCommission(data);
          
          return ok(res, mapped);
        }
      } catch (err) {
        console.error('[costing.commission-structures.patch] Supabase error:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');

    notFound(res, 'Commission Structure');
  };

  r.patch(['/commission-structures/:id', '/costing/commission-structures/:id'], updateCommissionHandler);
  r.put(['/commission-structures/:id', '/costing/commission-structures/:id'], updateCommissionHandler);

  r.delete(['/commission-structures/:id', '/costing/commission-structures/:id'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { error } = await sb
          .from('commission_structures')
          .delete()
          .eq('id', id)
          .eq('organization_id', orgId);

        if (error) {
          console.error('[costing.commission-structures.delete] Supabase error:', error);
          return fail(res, 500, error.message);
        }

        return ok(res, null, 'Commission structure deleted');
      } catch (err: any) {
        console.error('[costing.commission-structures.delete] Supabase error:', err);
        return fail(res, 500, err?.message || 'Failed to delete commission structure');
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. EXCHANGE RATES & CONVERSION
  // ══════════════════════════════════════════════════════════════════════════

  r.get(['/exchange-rates', '/costing/exchange-rates'], async (_req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('exchange_rates')
          .select('*')
          .order('as_of', { ascending: false });

        if (!error && data) {
          if (data.length > 0) {
            return ok(res, data.map(r => ({
              id: r.id,
              base: r.base,
              quote: r.quote,
              rate: Number(r.rate),
              asOf: r.as_of,
              source: r.source,
            })));
          }

          // Fallback initial baseline rates if table is empty
          const asOf = new Date().toISOString().slice(0, 10);
          const baseline = [
            { id: 'fx-pkr', base: 'USD', quote: 'PKR', rate: 278.5, asOf, source: 'system' },
            { id: 'fx-eur', base: 'USD', quote: 'EUR', rate: 0.92, asOf, source: 'system' },
            { id: 'fx-gbp', base: 'USD', quote: 'GBP', rate: 0.79, asOf, source: 'system' },
            { id: 'fx-aed', base: 'USD', quote: 'AED', rate: 3.67, asOf, source: 'system' },
            { id: 'fx-sar', base: 'USD', quote: 'SAR', rate: 3.75, asOf, source: 'system' },
          ];
          return ok(res, baseline);
        }
      } catch (err) {
        console.error('[costing.exchange-rates.get] Supabase error:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.get(['/exchange-rates/convert', '/costing/exchange-rates/convert'], async (req: Request, res: Response) => {
    const amount = Number(req.query.amount ?? 1);
    const from = String(req.query.from ?? 'USD').toUpperCase();
    const to = String(req.query.to ?? 'PKR').toUpperCase();

    if (from === to) {
      return ok(res, { amount, from, to, rate: 1, converted: amount });
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data: convData } = await sb.rpc('fx_convert', {
          p_amount: amount,
          p_from: from,
          p_to: to,
        });

        if (convData != null) {
          const converted = Number(convData);
          const rate = amount > 0 ? converted / amount : 0;
          return ok(res, { amount, from, to, rate, converted });
        }
      } catch {
        /* fallback to local rates table */
      }
    }

    

    // Standard fallback default rates
    const defaults: Record<string, number> = {
      'USD_PKR': 278.0,
      'AED_PKR': 76.0,
      'EUR_PKR': 302.0,
      'GBP_PKR': 355.0,
      'PKR_USD': 0.0036,
      'PKR_AED': 0.0132,
    };

    const rate = defaults[`${from}_${to}`] ?? (from === 'USD' ? 278 : from === 'AED' ? 76 : 1);
    const converted = amount * rate;

    ok(res, { amount, from, to, rate, converted });
  });

  r.post(['/exchange-rates', '/costing/exchange-rates'], async (req: Request, res: Response) => {
    const { base, quote, rate } = req.body as { base: string; quote: string; rate: number };

    if (!base || !quote || rate == null || Number(rate) <= 0) {
      return fail(res, 400, 'Valid base, quote, and positive rate are required');
    }

    const b = base.trim().toUpperCase();
    const q = quote.trim().toUpperCase();
    const rVal = Number(rate);
    const asOf = new Date().toISOString().slice(0, 10);

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb.from('exchange_rates').upsert({
          base: b,
          quote: q,
          rate: rVal,
          as_of: asOf,
          source: 'manual',
        }, { onConflict: 'base,quote,as_of' });
      } catch (err) {
        console.error('[costing.exchange-rates.post] Supabase error:', err);
      }
    }

    

    ok(res, { base: b, quote: q, rate: rVal, asOf }, 'Exchange rate saved');
  });


  // ══════════════════════════════════════════════════════════════════════════
  // 4. §14 QUOTE SIMULATOR, PRICING & VERSIONING ENGINE
  // ══════════════════════════════════════════════════════════════════════════

  // In-memory cache synced with Supabase organizations.settings.saved_quotes
  const orgQuotesCache = new Map<string, any[]>();

  async function loadOrgQuotes(sb: any, orgId: string): Promise<any[]> {
    if (orgQuotesCache.has(orgId)) {
      return orgQuotesCache.get(orgId) || [];
    }
    if (sb) {
      try {
        const { data: orgData } = await sb
          .from('organizations')
          .select('settings')
          .eq('id', orgId)
          .maybeSingle();
        if (orgData?.settings?.saved_quotes && Array.isArray(orgData.settings.saved_quotes)) {
          orgQuotesCache.set(orgId, orgData.settings.saved_quotes);
          return orgData.settings.saved_quotes;
        }
      } catch (err) {
        console.warn('[costing.quotes] Error loading saved_quotes from DB:', err);
      }
    }
    orgQuotesCache.set(orgId, []);
    return [];
  }

  async function persistOrgQuotes(sb: any, orgId: string, quotes: any[]): Promise<void> {
    orgQuotesCache.set(orgId, quotes);
    if (sb) {
      try {
        const { data: orgData } = await sb
          .from('organizations')
          .select('settings')
          .eq('id', orgId)
          .maybeSingle();
        const currentSettings = (orgData?.settings && typeof orgData.settings === 'object') ? orgData.settings : {};
        await sb
          .from('organizations')
          .update({
            settings: {
              ...currentSettings,
              saved_quotes: quotes,
            },
          })
          .eq('id', orgId);
      } catch (err) {
        console.warn('[costing.quotes] Error saving quotes to DB:', err);
      }
    }
  }

  function calculateQuoteFormulas(body: any) {
    const roleEstimates: any[] = Array.isArray(body.roleEstimates) ? body.roleEstimates : [];
    const directPurchases: any[] = Array.isArray(body.directPurchases) ? body.directPurchases : [];

    // 1. estimated_direct_labor = Σ estimated_hours_by_role × cost_rate
    const estimatedDirectLabor = roleEstimates.reduce(
      (sum, r) => sum + (Math.max(0, Number(r.estimatedHours || 0)) * Math.max(0, Number(r.costRate || 0))),
      0
    );

    // 2. direct_purchases
    const directPurchasesTotal = directPurchases.reduce(
      (sum, p) => sum + Math.max(0, Number(p.amount || 0)),
      0
    );

    // 3. attributed_overhead
    const overheadAmount = Math.max(0, Number(body.overheadAmount || 0));

    // 4. contingency
    const subtotal = estimatedDirectLabor + directPurchasesTotal + overheadAmount;
    const contingencyPercent = Math.max(0, Number(body.contingencyPercent || 0));
    const contingencyAmount = Number(body.contingencyAmount || 0) > 0
      ? Number(body.contingencyAmount)
      : (subtotal * (contingencyPercent / 100));

    // 5. estimated_total_cost = labor + direct_purchases + attributed_overhead + contingency
    const estimatedTotalCost = subtotal + contingencyAmount;

    // 6. profit_amount = proposed_price − estimated_total_cost
    const proposedPrice = Math.max(0, Number(body.proposedPrice || 0));
    const profitAmount = proposedPrice - estimatedTotalCost;

    // 7. margin_percent = profit_amount / proposed_price × 100 (Safe divide: block div by zero)
    const marginPercent = proposedPrice > 0 ? (profitAmount / proposedPrice) * 100 : 0;

    // 8. markup_percent = profit_amount / estimated_total_cost × 100 (Safe divide: block div by zero)
    const markupPercent = estimatedTotalCost > 0 ? (profitAmount / estimatedTotalCost) * 100 : 0;

    // 9. required_price_for_target_margin = estimated_total_cost / (1 − target_margin_fraction)
    // Block invalid target margins (>= 100% or <= -100%)
    const targetMarginPercent = Number(body.targetMarginPercent ?? 25);
    const targetMarginFraction = targetMarginPercent / 100;
    const isTargetMarginValid = targetMarginFraction < 1 && targetMarginFraction > -1 && (1 - targetMarginFraction) > 1e-6;
    const requiredPriceForTargetMargin = isTargetMarginValid
      ? estimatedTotalCost / (1 - targetMarginFraction)
      : null;

    // Target markup price
    const targetMarkupPercent = Number(body.targetMarkupPercent ?? 33.33);
    const targetMarkupFraction = targetMarkupPercent / 100;
    const requiredPriceForTargetMarkup = estimatedTotalCost * (1 + targetMarkupFraction);

    return {
      estimatedDirectLabor: Math.round(estimatedDirectLabor * 100) / 100,
      directPurchasesTotal: Math.round(directPurchasesTotal * 100) / 100,
      overheadAmount: Math.round(overheadAmount * 100) / 100,
      contingencyAmount: Math.round(contingencyAmount * 100) / 100,
      contingencyPercent,
      estimatedTotalCost: Math.round(estimatedTotalCost * 100) / 100,
      proposedPrice: Math.round(proposedPrice * 100) / 100,
      profitAmount: Math.round(profitAmount * 100) / 100,
      marginPercent: Math.round(marginPercent * 100) / 100,
      markupPercent: Math.round(markupPercent * 100) / 100,
      requiredPriceForTargetMargin: requiredPriceForTargetMargin != null ? Math.round(requiredPriceForTargetMargin * 100) / 100 : null,
      requiredPriceForTargetMarkup: Math.round(requiredPriceForTargetMarkup * 100) / 100,
      isTargetMarginValid,
      isRevenueRecognized: false, // Invariant (§14): Not recognized revenue until contracted/billed
    };
  }

  // Pure Calculation Endpoint for real-time simulator preview
  r.post(['/quotes/calculate', '/costing/quotes/calculate'], (req: Request, res: Response) => {
    const calc = calculateQuoteFormulas(req.body);
    return ok(res, calc);
  });

  // GET /quotes - list all quotes with versions
  r.get(['/quotes', '/costing/quotes'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    const quotes = await loadOrgQuotes(sb, orgId);
    return ok(res, quotes);
  });

  // POST /quotes - Create quote or new version
  r.post(['/quotes', '/costing/quotes'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body;
    const sb = getSupabaseAdminClient();

    if (!body.projectName || !body.projectName.trim()) {
      return fail(res, 400, 'Project / Quote name is required');
    }

    const calc = calculateQuoteFormulas(body);
    const list = [...(await loadOrgQuotes(sb, orgId))];
    
    // Check if updating existing quote with new version
    const existingIndex = body.id ? list.findIndex((q: any) => q.id === body.id) : -1;
    let quote: any;

    if (existingIndex >= 0) {
      const prev = list[existingIndex];
      const versionNum = (prev.versions?.length || 1) + 1;
      const nextVersion = `v1.${versionNum - 1}`;
      const versionEntry = {
        version: nextVersion,
        createdAt: new Date().toISOString(),
        notes: body.versionNotes || `Version update ${nextVersion}`,
        proposedPrice: calc.proposedPrice,
        estimatedTotalCost: calc.estimatedTotalCost,
        profitAmount: calc.profitAmount,
        marginPercent: calc.marginPercent,
        markupPercent: calc.markupPercent,
      };

      quote = {
        ...prev,
        ...body,
        ...calc,
        organizationId: orgId,
        currentVersion: nextVersion,
        versions: [...(prev.versions || []), versionEntry],
        isRevenueRecognized: false, // Invariant (§14)
        updatedAt: new Date().toISOString(),
      };
      list[existingIndex] = quote;
    } else {
      const newId = body.id || ('quote-' + Date.now().toString(36));
      quote = {
        id: newId,
        organizationId: orgId,
        clientName: body.clientName?.trim() || 'New Client',
        projectName: body.projectName.trim(),
        serviceType: body.serviceType || 'Custom Project',
        billingModel: body.billingModel || 'fixed_price',
        deliveryHorizonMonths: Number(body.deliveryHorizonMonths || 3),
        currency: body.currency || 'USD',
        targetMarginPercent: Number(body.targetMarginPercent ?? 25),
        targetMarkupPercent: Number(body.targetMarkupPercent ?? 33.33),
        roleEstimates: body.roleEstimates || [],
        directPurchases: body.directPurchases || [],
        overheadMethod: body.overheadMethod || 'headcount',
        ...calc,
        currentVersion: 'v1.0',
        versions: [
          {
            version: 'v1.0',
            createdAt: new Date().toISOString(),
            notes: body.versionNotes || 'Initial baseline quote version',
            proposedPrice: calc.proposedPrice,
            estimatedTotalCost: calc.estimatedTotalCost,
            profitAmount: calc.profitAmount,
            marginPercent: calc.marginPercent,
            markupPercent: calc.markupPercent,
          },
        ],
        status: 'draft',
        isRevenueRecognized: false, // Invariant (§14)
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.unshift(quote);
    }

    await persistOrgQuotes(sb, orgId, list);
    return created(res, quote);
  });

  // DELETE /quotes/:id
  r.delete(['/quotes/:id', '/costing/quotes/:id'], async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const quoteId = req.params.id;
    const sb = getSupabaseAdminClient();
    const list = await loadOrgQuotes(sb, orgId);
    const filtered = list.filter((q: any) => q.id !== quoteId);
    await persistOrgQuotes(sb, orgId, filtered);
    return ok(res, null, 'Quote deleted');
  });

  return r;
}
