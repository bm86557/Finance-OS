/**
 * §10 — Assets & depreciation. Mounted at `/organizations/:organizationId/assets` (mergeParams).
 */

import { Router, type Request, type Response } from 'express';
import type { Asset, DepreciationSchedule } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function calculateMonthlyDepreciation(asset: Asset): number {
  if (asset.status !== 'active') return 0;
  switch (asset.depreciationMethod) {
    case 'straight_line': {
      const depreciableAmount = asset.purchasePrice - asset.salvageValue;
      return depreciableAmount / (asset.usefulLifeYears * 12);
    }
    case 'declining_balance': {
      const rate = 2 / asset.usefulLifeYears;
      return (asset.currentValue * rate) / 12;
    }
    default:
      return 0;
  }
}

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function getParamId(req: Request, key = 'id'): string {
  const p = req.params[key];
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function mapDomainToDbAsset(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    organization_id: asset.organizationId,
    name: asset.name,
    asset_code: asset.assetCode,
    category: asset.category,
    account_id: asset.accountId || null,
    accumulated_depreciation_account_id: asset.accumulatedDepreciationAccountId || null,
    depreciation_expense_account_id: asset.depreciationExpenseAccountId || null,
    purchase_date: asset.purchaseDate,
    purchase_price: asset.purchasePrice,
    salvage_value: asset.salvageValue,
    useful_life_years: asset.usefulLifeYears,
    depreciation_method: asset.depreciationMethod,
    current_value: asset.currentValue,
    accumulated_depreciation: asset.accumulatedDepreciation,
    status: asset.status,
    disposal_date: asset.disposalDate || null,
    disposal_amount: asset.disposalAmount ?? null,
    department_id: asset.departmentId || null,
    location: asset.locationDetails || null,
    purchase_payment_method: asset.purchasePaymentMethod || null,
    purchase_bank_account_id: asset.purchaseBankAccountId || null,
    purchase_transaction_id: asset.purchaseTransactionId || null,
    placed_in_service_date: asset.placedInServiceDate || asset.purchaseDate,
    cost_basis: asset.costBasis ?? asset.purchasePrice,
    tax_depreciation_method: asset.taxDepreciationMethod || 'straight_line',
    tax_useful_life_years: asset.taxUsefulLifeYears || asset.usefulLifeYears,
    accumulated_tax_depreciation: asset.accumulatedTaxDepreciation || 0,
    gain_loss_on_disposal: asset.gainLossOnDisposal ?? null,
  };
}

export function createAssetsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const supabase = getSupabaseAdminClient();
    
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('assets')
          .select('*')
          .eq('organization_id', orgId);
        
        if (error) throw error;
        
        const now = new Date();
        const assets = (data || []).map((asset: any) => {
          const purchasePrice = Number(asset.purchase_price || 0);
          const salvageValue = Number(asset.salvage_value || 0);
          const usefulLifeYears = Number(asset.useful_life_years || 5);
          let accumulatedDepreciation = Number(asset.accumulated_depreciation || 0);

          if (accumulatedDepreciation === 0 && asset.purchase_date && usefulLifeYears > 0) {
            const pDate = new Date(asset.purchase_date);
            const elapsedMonths = Math.max(0, (now.getFullYear() - pDate.getFullYear()) * 12 + (now.getMonth() - pDate.getMonth()));
            const depreciableAmount = Math.max(0, purchasePrice - salvageValue);
            accumulatedDepreciation = Math.min(depreciableAmount, Math.round(((depreciableAmount / (usefulLifeYears * 12)) * elapsedMonths) * 100) / 100);
          }

          const currentValue = asset.current_value != null && Number(asset.current_value) > 0
            ? Number(asset.current_value)
            : Math.max(salvageValue, Math.round((purchasePrice - accumulatedDepreciation) * 100) / 100);

          return {
            ...asset,
            purchasePrice,
            currentValue,
            accumulatedDepreciation,
          };
        });

        const byCategory = new Map<string, { count: number; value: number }>();
        for (const asset of assets) {
          const existing = byCategory.get(asset.category) || { count: 0, value: 0 };
          byCategory.set(asset.category, { 
            count: existing.count + 1, 
            value: existing.value + asset.currentValue 
          });
        }
        
        return ok(res, {
          totalAssets: assets.length,
          totalCurrentValue: assets.reduce((s: number, a: any) => s + a.currentValue, 0),
          totalPurchaseValue: assets.reduce((s: number, a: any) => s + a.purchasePrice, 0),
          totalDepreciation: assets.reduce((s: number, a: any) => s + a.accumulatedDepreciation, 0),
          byCategory: Array.from(byCategory.entries()).map(([category, data]) => ({ category, ...data })),
        });
      } else {
  return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[assets] Error in GET /summary:', error);
      return fail(res, 500, 'Failed to load asset summary');
    }
  });

  r.get('/depreciation-schedules', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const supabase = getSupabaseAdminClient();
    
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('depreciation_schedules')
          .select('*')
          .eq('organization_id', orgId);
        
        if (error) throw error;
        
        // Transform snake_case to camelCase
        const schedules = (data || []).map((schedule: any) => ({
          id: schedule.id,
          assetId: schedule.asset_id,
          organizationId: schedule.organization_id,
          period: schedule.period,
          openingValue: schedule.opening_value,
          depreciationAmount: schedule.depreciation_amount,
          closingValue: schedule.closing_value,
          status: schedule.status,
          postedAt: schedule.posted_at,
          postedBy: schedule.posted_by,
          journalEntryId: schedule.journal_entry_id,
        }));
        
        return ok(res, schedules);
      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[assets] Error in GET /depreciation-schedules:', error);
      return fail(res, 500, 'Failed to load depreciation schedules');
    }
  });

  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const supabase = getSupabaseAdminClient();
    
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('assets')
          .select('*')
          .eq('organization_id', orgId);
        
        const now = new Date();
        const assets = (data || []).map((asset: any) => {
          const purchasePrice = Number(asset.purchase_price || 0);
          const salvageValue = Number(asset.salvage_value || 0);
          const usefulLifeYears = Number(asset.useful_life_years || 5);
          let accumulatedDepreciation = Number(asset.accumulated_depreciation || 0);

          if (accumulatedDepreciation === 0 && asset.purchase_date && usefulLifeYears > 0) {
            const pDate = new Date(asset.purchase_date);
            const elapsedMonths = Math.max(0, (now.getFullYear() - pDate.getFullYear()) * 12 + (now.getMonth() - pDate.getMonth()));
            const depreciableAmount = Math.max(0, purchasePrice - salvageValue);
            accumulatedDepreciation = Math.min(depreciableAmount, Math.round(((depreciableAmount / (usefulLifeYears * 12)) * elapsedMonths) * 100) / 100);
          }

          const currentValue = asset.current_value != null && Number(asset.current_value) > 0
            ? Number(asset.current_value)
            : Math.max(salvageValue, Math.round((purchasePrice - accumulatedDepreciation) * 100) / 100);

          return {
            id: asset.id,
            organizationId: asset.organization_id,
            assetCode: asset.asset_code,
            name: asset.name,
            description: asset.description,
            category: asset.category,
            purchaseDate: asset.purchase_date,
            purchasePrice,
            salvageValue,
            usefulLifeYears,
            depreciationMethod: asset.depreciation_method || 'straight_line',
            currentValue,
            accumulatedDepreciation,
            status: asset.status,
            disposalDate: asset.disposal_date,
            disposalAmount: asset.disposal_amount,
            location: asset.location,
            serialNumber: asset.serial_number,
            departmentId: asset.department_id,
          };
        });
        
        return ok(res, assets);
      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[assets] Error in GET /:', error);
      return fail(res, 500, 'Failed to load assets');
    }
  });

  r.get('/:id/depreciation-schedule', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('depreciation_schedules')
          .select('*')
          .eq('asset_id', assetId)
          .eq('organization_id', orgId)
          .order('period', { ascending: false });
        if (!error && data) {
          const schedules = data.map((schedule: any) => ({
            id: schedule.id,
            assetId: schedule.asset_id,
            organizationId: schedule.organization_id,
            period: schedule.period,
            openingValue: Number(schedule.opening_value),
            depreciationAmount: Number(schedule.depreciation_amount),
            closingValue: Number(schedule.closing_value),
            status: schedule.status,
            postedAt: schedule.posted_at,
            postedBy: schedule.posted_by,
            journalEntryId: schedule.journal_entry_id,
          }));
          return ok(res, schedules);
        }
      } catch (err) {
        console.error('[assets.getDepreciationSchedule] Supabase query error:', err);
      }
    }
    return fail(res, 503, 'Database unavailable');
  });

  // GET /:id/tax-schedule - Explicit Tax Depreciation Policy & Projected Schedule
  r.get('/:id/tax-schedule', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: asset, error } = await sb
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error || !asset) return notFound(res, 'Asset');

    const method = asset.tax_depreciation_method || 'straight_line';
    const costBasis = Number(asset.cost_basis || asset.purchase_price || 0);
    const salvage = Number(asset.salvage_value || 0);
    const lifeYears = Number(asset.tax_useful_life_years || asset.useful_life_years || 5);
    const placedDate = asset.placed_in_service_date || asset.purchase_date || new Date().toISOString().slice(0, 10);

    const taxSchedule = [];
    const depreciable = Math.max(0, costBasis - salvage);

    if (method === 'section_179') {
      // 100% immediate expense in year 1
      taxSchedule.push({
        year: 1,
        startingBasis: costBasis,
        taxDepreciationRate: 1.0,
        taxDeduction: depreciable,
        endingBasis: salvage,
        policyNote: 'Section 179 full immediate expensing',
      });
    } else if (method === 'macrs_200_db') {
      // MACRS 200% declining balance convention (half-year)
      const macrsRates5yr = [0.20, 0.32, 0.192, 0.1152, 0.1152, 0.0576];
      let b = costBasis;
      for (let y = 0; y < macrsRates5yr.length; y++) {
        const rate = macrsRates5yr[y];
        const deduction = Math.round(costBasis * rate * 100) / 100;
        const ending = Math.max(0, Math.round((b - deduction) * 100) / 100);
        taxSchedule.push({
          year: y + 1,
          startingBasis: b,
          taxDepreciationRate: rate,
          taxDeduction: deduction,
          endingBasis: ending,
          policyNote: 'MACRS 200% Declining Balance (Half-year convention)',
        });
        b = ending;
      }
    } else {
      // Standard straight line tax
      const annual = lifeYears > 0 ? depreciable / lifeYears : 0;
      let b = costBasis;
      for (let y = 1; y <= lifeYears; y++) {
        const deduction = Math.round(annual * 100) / 100;
        const ending = Math.max(salvage, Math.round((b - deduction) * 100) / 100);
        taxSchedule.push({
          year: y,
          startingBasis: b,
          taxDepreciationRate: Math.round((1 / lifeYears) * 1000) / 1000,
          taxDeduction: deduction,
          endingBasis: ending,
          policyNote: 'Straight-line tax depreciation',
        });
        b = ending;
      }
    }

    return ok(res, {
      assetId,
      assetName: asset.name,
      taxPolicy: {
        method,
        placedInServiceDate: placedDate,
        costBasis,
        salvageValue: salvage,
        taxUsefulLifeYears: lifeYears,
        accumulatedTaxDepreciation: Number(asset.accumulated_tax_depreciation || 0),
      },
      schedule: taxSchedule,
    });
  });

  r.post('/:id/dispose', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const { disposalDate, disposalAmount } = (req.body || {}) as { disposalDate?: string; disposalAmount?: number };
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: existing, error: readErr } = await sb
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!existing) return notFound(res, 'Asset');
      if (existing.status === 'disposed') return fail(res, 400, 'Asset is already disposed');

      const costBasis = Number(existing.cost_basis || existing.purchase_price || 0);
      const accDepr = Number(existing.accumulated_depreciation || 0);
      const netBookValue = Math.max(0, costBasis - accDepr);
      const dispAmt = Number(disposalAmount ?? 0);
      const gainLoss = Math.round((dispAmt - netBookValue) * 100) / 100;

      const { data, error } = await sb
        .from('assets')
        .update({
          status: 'disposed',
          disposal_date: disposalDate || new Date().toISOString().slice(0, 10),
          disposal_amount: dispAmt,
          gain_loss_on_disposal: gainLoss,
        })
        .eq('id', assetId)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();
      if (error) throw error;

      // Post disposal transaction if cash was received
      if (dispAmt > 0) {
        try {
          const txnId = `txn-disposal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await sb.from('transactions').insert([{
            id: txnId,
            organization_id: orgId,
            date: disposalDate || new Date().toISOString().slice(0, 10),
            description: `Asset Disposal Sale - ${existing.name || assetId}`,
            narration: `Disposal proceeds for ${existing.name || assetId}. Book value: ${netBookValue.toFixed(2)}, Gain/Loss: ${gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}`,
            amount: dispAmt,
            currency: 'USD',
            type: 'credit',
            status: 'reconciled',
            tags: ['asset-disposal', 'investing-cash-flow', `asset:${assetId}`, 'business'],
            created_at: new Date().toISOString(),
          }]);
        } catch (tErr) {
          console.warn('[assets.dispose] Failed to insert disposal transaction:', tErr);
        }
      }

      return ok(res, data, `Asset disposed. Gain/Loss recognized: ${gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}`);
    } catch (err) {
      console.error('[assets.dispose] Supabase error:', err);
      return fail(res, 500, 'Failed to dispose asset');
    }
  });
  r.post('/:id/depreciation', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const { period } = req.body as { period: string };

    // Get current month in YYYY-MM format
    const today = new Date();
    const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const targetPeriod = period || currentPeriod;

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        // 1. Check if asset exists in Supabase
        const { data: dbAsset, error: assetErr } = await sb
          .from('assets')
          .select('*')
          .eq('id', assetId)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (assetErr || !dbAsset) {
          return notFound(res, 'Asset');
        }

        if (dbAsset.status !== 'active') {
          return fail(res, 400, `Cannot post depreciation for an asset with status '${dbAsset.status}'`);
        }

        // 2. Strict idempotency: Ensure only ONE posted depreciation entry exists per month for this asset
        const { data: existingSchedules, error: schedErr } = await sb
          .from('depreciation_schedules')
          .select('*')
          .eq('asset_id', assetId)
          .eq('period', targetPeriod)
          .eq('status', 'posted');

        if (!schedErr && existingSchedules && existingSchedules.length > 0) {
          return fail(res, 400, `Depreciation for period ${targetPeriod} has already been posted for this asset.`);
        }

        // 3. Compute accurate depreciation amounts
        const purchasePrice = Number(dbAsset.purchase_price || 0);
        const salvageValue = Number(dbAsset.salvage_value || 0);
        const usefulLifeYears = Math.max(1, Number(dbAsset.useful_life_years || 5));
        const currentBookValue = dbAsset.current_value != null ? Number(dbAsset.current_value) : purchasePrice;
        const currentAccDepr = Number(dbAsset.accumulated_depreciation || 0);

        let monthlyDepr = 0;
        if (dbAsset.depreciation_method === 'declining_balance') {
          const rate = 2 / usefulLifeYears;
          monthlyDepr = (currentBookValue * rate) / 12;
        } else {
          // straight_line
          const depreciableAmount = Math.max(0, purchasePrice - salvageValue);
          monthlyDepr = depreciableAmount / (usefulLifeYears * 12);
        }

        monthlyDepr = Math.round(monthlyDepr * 100) / 100;
        const maxAllowedDepr = Math.max(0, currentBookValue - salvageValue);
        const actualDepr = Math.min(monthlyDepr, maxAllowedDepr);

        if (actualDepr <= 0) {
          return fail(res, 400, 'Asset has reached its salvage value floor; no further depreciation can be charged.');
        }

        const closingValue = Math.round((currentBookValue - actualDepr) * 100) / 100;
        const newAccDepr = Math.round((currentAccDepr + actualDepr) * 100) / 100;
        const newStatus = closingValue <= salvageValue ? 'fully_depreciated' : 'active';
        const scheduleId = `depr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const journalEntryId = `DEP-${dbAsset.asset_code || assetId}-${targetPeriod}`;

        // 4. Save schedule entry to Supabase
        const { error: insErr } = await sb.from('depreciation_schedules').insert({
          id: scheduleId,
          organization_id: orgId,
          asset_id: assetId,
          period: targetPeriod,
          opening_value: currentBookValue,
          depreciation_amount: actualDepr,
          closing_value: closingValue,
          status: 'posted',
          posted_at: new Date().toISOString(),
          journal_entry_id: journalEntryId,
        });

        if (insErr) {
          console.error('[assets.postDepreciation] Supabase schedule insert error:', insErr);
          return fail(res, 500, `Failed to post depreciation schedule: ${insErr.message}`);
        }

        // 5. Update Asset current_value and accumulated_depreciation in Supabase
        await sb.from('assets').update({
          current_value: closingValue,
          accumulated_depreciation: newAccDepr,
          status: newStatus,
        }).eq('id', assetId).eq('organization_id', orgId);

        // 6. Post non-cash accounting transaction in ledger
        try {
          const deprTxnId = `txn-depr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await sb.from('transactions').insert([{
            id: deprTxnId,
            organization_id: orgId,
            date: new Date().toISOString().slice(0, 10),
            description: `Depreciation Run - ${dbAsset.name || dbAsset.asset_code}`,
            narration: `Monthly depreciation for period ${targetPeriod} on ${dbAsset.name} (${journalEntryId})`,
            amount: actualDepr,
            currency: 'USD',
            type: 'debit',
            status: 'reconciled',
            tags: ['depreciation-expense', 'non-cash-expense', `asset:${assetId}`, `period:${targetPeriod}`, 'business'],
            created_at: new Date().toISOString(),
          }]);
        } catch (tErr) {
          console.warn('[assets.postDepreciation] Failed to record depreciation transaction:', tErr);
        }

        const domainSchedule: DepreciationSchedule = {
          id: scheduleId,
          assetId,
          organizationId: orgId,
          period: targetPeriod,
          openingValue: currentBookValue,
          depreciationAmount: actualDepr,
          closingValue,
          status: 'posted',
          postedAt: new Date().toISOString(),
          journalEntryId,
        };

        return created(res, domainSchedule, 'Depreciation posted successfully');
      } catch (err: any) {
        console.error('[assets.postDepreciation] Exception:', err);
        return fail(res, 500, err?.message || 'Failed to post depreciation');
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb.from('assets').select('*').eq('id', assetId).eq('organization_id', orgId).maybeSingle();
        if (!error && data) {
          return ok(res, {
            id: data.id,
            organizationId: data.organization_id,
            assetCode: data.asset_code,
            name: data.name,
            category: data.category,
            accountId: data.account_id || '',
            accumulatedDepreciationAccountId: data.accumulated_depreciation_account_id || '',
            depreciationExpenseAccountId: data.depreciation_expense_account_id || '',
            purchaseDate: data.purchase_date,
            purchasePrice: data.purchase_price,
            salvageValue: data.salvage_value,
            usefulLifeYears: data.useful_life_years,
            depreciationMethod: data.depreciation_method,
            currentValue: data.current_value,
            accumulatedDepreciation: data.accumulated_depreciation,
            status: data.status,
            disposalDate: data.disposal_date,
            disposalAmount: data.disposal_amount,
            departmentId: data.department_id,
            locationDetails: data.location,
            purchasePaymentMethod: data.purchase_payment_method,
            purchaseBankAccountId: data.purchase_bank_account_id,
            purchaseTransactionId: data.purchase_transaction_id,
          });
        }
      } catch (err) {
        console.error('[assets.getById] Supabase error:', err);
      }
    }
    return fail(res, 503, 'Database unavailable');
  });

  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Asset, 'id' | 'organizationId'>;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    // Generate unique asset code
    const categoryPrefix = data.category ? data.category.substring(0, 3).toUpperCase() : 'AST';
    const assetCode = `AST-${categoryPrefix}-${Date.now().toString().slice(-6)}`;

    const newAsset: Asset = {
      ...data,
      id: 'asset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      organizationId: orgId,
      assetCode,
      currentValue: data.purchasePrice,
      accumulatedDepreciation: 0,
    };

    try {
      const { error } = await sb.from('assets').upsert(mapDomainToDbAsset(newAsset), { onConflict: 'id' });
      if (error) throw error;
      return created(res, newAsset, 'Asset created');
    } catch (err) {
      console.error('[assets.post] Supabase persist error:', err);
      return fail(res, 500, 'Failed to create asset');
    }
  });

  r.patch('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: existing, error: readErr } = await sb
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!existing) return notFound(res, 'Asset');

      const current: Asset = {
        id: existing.id,
        organizationId: existing.organization_id,
        assetCode: existing.asset_code,
        name: existing.name,
        category: existing.category,
        accountId: existing.account_id || '',
        accumulatedDepreciationAccountId: existing.accumulated_depreciation_account_id || '',
        depreciationExpenseAccountId: existing.depreciation_expense_account_id || '',
        purchaseDate: existing.purchase_date,
        purchasePrice: existing.purchase_price,
        salvageValue: existing.salvage_value,
        usefulLifeYears: existing.useful_life_years,
        depreciationMethod: existing.depreciation_method,
        currentValue: existing.current_value,
        accumulatedDepreciation: existing.accumulated_depreciation,
        status: existing.status,
        disposalDate: existing.disposal_date,
        disposalAmount: existing.disposal_amount,
        departmentId: existing.department_id,
        locationDetails: existing.location,
        purchasePaymentMethod: existing.purchase_payment_method,
        purchaseBankAccountId: existing.purchase_bank_account_id,
        purchaseTransactionId: existing.purchase_transaction_id,
      } as Asset;

      const patch = req.body as Partial<Asset>;
      const merged: Asset = { ...current, ...patch, id: current.id, organizationId: current.organizationId };

      const { error } = await sb.from('assets').upsert(mapDomainToDbAsset(merged), { onConflict: 'id' });
      if (error) throw error;
      return ok(res, merged);
    } catch (err) {
      console.error('[assets.patch] Supabase error:', err);
      return fail(res, 500, 'Failed to update asset');
    }
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { error: schedErr } = await sb.from('depreciation_schedules').delete().eq('asset_id', assetId).eq('organization_id', orgId);
      if (schedErr) throw schedErr;
      const { error } = await sb.from('assets').delete().eq('id', assetId).eq('organization_id', orgId);
      if (error) throw error;
      return ok(res, { id: assetId });
    } catch (err) {
      console.error('[assets.delete] Supabase delete error:', err);
      return fail(res, 500, 'Failed to delete asset');
    }
  });

  return r;
}