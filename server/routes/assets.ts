/**
 * §10 — Assets & depreciation. Mounted at `/organizations/:organizationId/assets` (mergeParams).
 */

import { Router, type Request, type Response } from 'express';
import type { Asset, DepreciationSchedule } from '../../src/services/types.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ensureDefaultAccounts } from './accounts.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { requirePermission } from '../middleware/auth.js';
import { postBalancedJournalEntry, resolveGlAccountId, resolveOrgCurrency } from '../lib/ledgerService.js';

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
    location_details: asset.locationDetails || null,
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
        
        // Handoff §15 / §33 #3: Use authoritative persisted depreciation only (never fabricate unposted depreciation on read)
        const assets = (data || []).map((asset: any) => {
          const purchasePrice = Number(asset.cost_basis ?? asset.purchase_price ?? 0);
          const salvageValue = Number(asset.salvage_value || 0);
          const accumulatedDepreciation = Number(asset.accumulated_depreciation || 0);
          const currentValue = asset.current_value != null
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
        
        if (error) throw error;
        // Handoff §15 / §33 #3: Return authoritative persisted depreciation & full §15 metadata (no phantom unposted depreciation)
        const assets = (data || []).map((asset: any) => {
          const purchasePrice = Number(asset.purchase_price || 0);
          const costBasis = Number(asset.cost_basis ?? purchasePrice);
          const salvageValue = Number(asset.salvage_value || 0);
          const usefulLifeYears = Number(asset.useful_life_years || 5);
          const accumulatedDepreciation = Number(asset.accumulated_depreciation || 0);
          const currentValue = asset.current_value != null
            ? Number(asset.current_value)
            : Math.max(salvageValue, Math.round((costBasis - accumulatedDepreciation) * 100) / 100);

          return {
            id: asset.id,
            organizationId: asset.organization_id,
            assetCode: asset.asset_code,
            name: asset.name,
            description: asset.description,
            category: asset.category,
            accountId: asset.account_id || '',
            accumulatedDepreciationAccountId: asset.accumulated_depreciation_account_id || '',
            depreciationExpenseAccountId: asset.depreciation_expense_account_id || '',
            purchaseDate: asset.purchase_date,
            placedInServiceDate: asset.placed_in_service_date || asset.purchase_date,
            purchasePrice,
            costBasis,
            salvageValue,
            usefulLifeYears,
            depreciationMethod: asset.depreciation_method || 'straight_line',
            taxDepreciationMethod: asset.tax_depreciation_method || 'straight_line',
            taxUsefulLifeYears: asset.tax_useful_life_years != null ? Number(asset.tax_useful_life_years) : usefulLifeYears,
            accumulatedTaxDepreciation: Number(asset.accumulated_tax_depreciation || 0),
            currentValue,
            accumulatedDepreciation,
            status: asset.status,
            disposalDate: asset.disposal_date,
            disposalAmount: asset.disposal_amount != null ? Number(asset.disposal_amount) : undefined,
            gainLossOnDisposal: asset.gain_loss_on_disposal != null ? Number(asset.gain_loss_on_disposal) : undefined,
            locationDetails: asset.location_details ?? asset.location ?? undefined,
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

  r.post('/:id/dispose', requirePermission('finance:post_ledger'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const { disposalDate, disposalAmount, bankAccountId } = (req.body || {}) as {
      disposalDate?: string;
      disposalAmount?: number;
      bankAccountId?: string;
    };
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
      if (dispAmt < 0) return fail(res, 400, 'Disposal amount cannot be negative');
      const gainLoss = Math.round((dispAmt - netBookValue) * 100) / 100;
      const effectiveDisposalDate = disposalDate || new Date().toISOString().slice(0, 10);
      const orgCurrency = await resolveOrgCurrency(sb, orgId);

      // Post balanced disposal journal entry FIRST (§8, §15) so closed periods or GL errors abort cleanly
      if (costBasis > 0) {
        let cashGlId = '';
        if (bankAccountId) {
          const { data: ba } = await sb
            .from('bank_accounts')
            .select('account_id')
            .eq('id', bankAccountId)
            .eq('organization_id', orgId)
            .maybeSingle();
          cashGlId = ba?.account_id || '';
        }
        if (!cashGlId) {
          cashGlId = await resolveGlAccountId(sb, orgId, 'asset', ['bank_account', 'cash']);
        }
        const fixedAssetGlId = existing.account_id || (await resolveGlAccountId(sb, orgId, 'asset', ['fixed_asset', 'fixed asset']));
        const accumDeprGlId = existing.accumulated_depreciation_account_id || (await resolveGlAccountId(sb, orgId, 'asset', ['accumulated_depreciation', 'accumulated depreciation']));
        const gainGlId = await resolveGlAccountId(sb, orgId, 'income', ['gain', 'other_income']);
        const lossGlId = await resolveGlAccountId(sb, orgId, 'expense', ['loss', 'disposal', 'operating_expense']);

        const lines = [
          ...(dispAmt > 0 ? [{ accountId: cashGlId, bankAccountId: bankAccountId || null, debit: dispAmt, credit: 0, description: `Cash proceeds from disposal of ${existing.name}` }] : []),
          ...(accDepr > 0 ? [{ accountId: accumDeprGlId, debit: accDepr, credit: 0, description: `Remove accumulated depreciation for ${existing.name}` }] : []),
          ...(gainLoss < 0 ? [{ accountId: lossGlId, debit: Math.abs(gainLoss), credit: 0, description: `Loss on disposal of ${existing.name}` }] : []),
          { accountId: fixedAssetGlId, debit: 0, credit: costBasis, description: `Derecognize fixed asset ${existing.name}` },
          ...(gainLoss > 0 ? [{ accountId: gainGlId, debit: 0, credit: gainLoss, description: `Gain on disposal of ${existing.name}` }] : []),
        ];

        const jeRes = await postBalancedJournalEntry(sb, {
          organizationId: orgId,
          entryDate: effectiveDisposalDate,
          description: `Asset Disposal - ${existing.name || assetId}`,
          sourceType: 'asset_disposal',
          sourceId: assetId,
          currency: orgCurrency,
          actorUserId: req.authUser?.id || null,
          entryPrefix: 'DISP',
          lines,
        });
        if (!jeRes.success) {
          return fail(res, 400, `Disposal journal posting failed: ${jeRes.error || 'Unknown ledger error'}`);
        }
      }

      const { data, error } = await sb
        .from('assets')
        .update({
          status: 'disposed',
          disposal_date: effectiveDisposalDate,
          disposal_amount: dispAmt,
          gain_loss_on_disposal: gainLoss,
          current_value: 0,
        })
        .eq('id', assetId)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();
      if (error) throw error;

      // Post disposal transaction & update bank balance if cash was received via bankAccountId
      if (dispAmt > 0 && bankAccountId) {
        try {
          const txnId = `txn-disposal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await sb.from('transactions').insert([{
            id: txnId,
            organization_id: orgId,
            bank_account_id: bankAccountId,
            date: effectiveDisposalDate,
            description: `Asset Disposal Sale - ${existing.name || assetId}`,
            narration: `Disposal proceeds for ${existing.name || assetId}. Book value: ${netBookValue.toFixed(2)}, Gain/Loss: ${gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}`,
            amount: dispAmt,
            currency: orgCurrency,
            type: 'credit',
            status: 'reconciled',
            tags: ['asset-disposal', 'investing-cash-flow', `asset:${assetId}`, 'business'],
            created_at: new Date().toISOString(),
          }]);
          const { data: baRow } = await sb
            .from('bank_accounts')
            .select('balance')
            .eq('id', bankAccountId)
            .eq('organization_id', orgId)
            .maybeSingle();
          if (baRow) {
            await sb
              .from('bank_accounts')
              .update({ balance: Math.round((Number(baRow.balance || 0) + dispAmt) * 100) / 100 })
              .eq('id', bankAccountId)
              .eq('organization_id', orgId);
          }
        } catch (tErr) {
          console.warn('[assets.dispose] Failed to insert disposal bank transaction:', tErr);
        }
      }

      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'dispose_asset',
        entityType: 'asset',
        entityId: assetId,
        description: `Disposed asset ${existing.name} for ${dispAmt} ${orgCurrency} (Gain/Loss: ${gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)})`,
        beforeState: existing,
        afterState: data,
      }).catch(() => {});

      return ok(res, data, `Asset disposed. Gain/Loss recognized: ${gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}`);
    } catch (err) {
      console.error('[assets.dispose] Supabase error:', err);
      return fail(res, 500, 'Failed to dispose asset');
    }
  });
  r.post('/:id/depreciation', requirePermission('finance:post_ledger'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const { period } = req.body as { period: string };

    // Get current month in YYYY-MM format
    const today = new Date();
    const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const targetPeriod = period || currentPeriod;
    if (!/^\d{4}-\d{2}$/.test(targetPeriod)) {
      return fail(res, 400, 'period must be in YYYY-MM format');
    }

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

        const inServiceDate = String(dbAsset.placed_in_service_date || dbAsset.purchase_date || '');
        if (inServiceDate && targetPeriod < inServiceDate.slice(0, 7)) {
          return fail(res, 400, `Cannot post depreciation for ${targetPeriod} before placed-in-service date (${inServiceDate.slice(0, 7)}).`);
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
        const purchasePrice = Number(dbAsset.cost_basis ?? dbAsset.purchase_price ?? 0);
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
        const orgCurrency = await resolveOrgCurrency(sb, orgId);

        // 3b. Post real balanced double-entry depreciation journal (§8, §15)
        const deprExpGlId = dbAsset.depreciation_expense_account_id || (await resolveGlAccountId(sb, orgId, 'expense', ['depreciation']));
        const accumDeprGlId = dbAsset.accumulated_depreciation_account_id || (await resolveGlAccountId(sb, orgId, 'asset', ['accumulated_depreciation', 'accumulated depreciation']));
        const jeRes = await postBalancedJournalEntry(sb, {
          organizationId: orgId,
          entryDate: `${targetPeriod}-01`,
          description: `Monthly Depreciation (${targetPeriod}) - ${dbAsset.name || dbAsset.asset_code}`,
          sourceType: 'depreciation_run',
          sourceId: `${assetId}:${targetPeriod}`,
          currency: orgCurrency,
          actorUserId: req.authUser?.id || null,
          entryPrefix: 'DEP',
          lines: [
            { accountId: deprExpGlId, departmentId: dbAsset.department_id || null, debit: actualDepr, credit: 0, description: `Depreciation expense (${targetPeriod}) - ${dbAsset.name}` },
            { accountId: accumDeprGlId, debit: 0, credit: actualDepr, description: `Accumulated depreciation (${targetPeriod}) - ${dbAsset.name}` },
          ],
        });
        if (!jeRes.success || !jeRes.journalEntryId) {
          return fail(res, 400, `Depreciation journal posting failed: ${jeRes.error || 'Unable to post balanced journal entry'}`);
        }
        const journalEntryId = jeRes.journalEntryId;

        // 4. Save schedule entry to Supabase (protected by partial unique index on (asset_id, period) WHERE status='posted')
        const { error: insErr } = await sb.from('depreciation_schedules').insert({
          id: scheduleId,
          organization_id: orgId,
          asset_id: assetId,
          period: targetPeriod,
          opening_value: currentBookValue,
          depreciation_amount: actualDepr,
          closing_value: closingValue,
          status: 'posted',
          journal_entry_id: journalEntryId,
        });

        if (insErr) {
          if (insErr.code === '23505') {
            return fail(res, 409, `Depreciation for period ${targetPeriod} has already been posted for this asset.`);
          }
          console.error('[assets.postDepreciation] Supabase schedule insert error:', insErr);
          return fail(res, 500, `Failed to post depreciation schedule: ${insErr.message}`);
        }

        // 5. Update Asset current_value and accumulated_depreciation in Supabase
        await sb.from('assets').update({
          current_value: closingValue,
          accumulated_depreciation: newAccDepr,
          status: newStatus,
        }).eq('id', assetId).eq('organization_id', orgId);

        // 6. Post non-cash accounting transaction in ledger (stamped with targetPeriod date, tagged non-cash-expense)
        try {
          const deprTxnId = `txn-depr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await sb.from('transactions').insert([{
            id: deprTxnId,
            organization_id: orgId,
            date: `${targetPeriod}-01`,
            description: `Depreciation Run - ${dbAsset.name || dbAsset.asset_code}`,
            narration: `Monthly depreciation for period ${targetPeriod} on ${dbAsset.name} (${journalEntryId})`,
            amount: actualDepr,
            currency: orgCurrency,
            type: 'debit',
            status: 'reconciled',
            tags: ['depreciation-expense', 'non-cash-expense', `asset:${assetId}`, `period:${targetPeriod}`, 'business'],
            created_at: new Date().toISOString(),
          }]);
        } catch (tErr) {
          console.warn('[assets.postDepreciation] Failed to record depreciation transaction:', tErr);
        }

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'post_depreciation',
          entityType: 'depreciation_schedule',
          entityId: scheduleId,
          description: `Posted depreciation for ${dbAsset.name} (${targetPeriod}): ${actualDepr} ${orgCurrency}`,
          afterState: { assetId, period: targetPeriod, depreciationAmount: actualDepr, closingValue, journalEntryId },
        }).catch(() => {});

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
            placedInServiceDate: data.placed_in_service_date || data.purchase_date,
            purchasePrice: data.purchase_price,
            costBasis: data.cost_basis ?? data.purchase_price,
            salvageValue: data.salvage_value,
            usefulLifeYears: data.useful_life_years,
            depreciationMethod: data.depreciation_method,
            taxDepreciationMethod: data.tax_depreciation_method || 'straight_line',
            taxUsefulLifeYears: data.tax_useful_life_years ?? data.useful_life_years,
            accumulatedTaxDepreciation: data.accumulated_tax_depreciation ?? 0,
            currentValue: data.current_value,
            accumulatedDepreciation: data.accumulated_depreciation,
            status: data.status,
            disposalDate: data.disposal_date,
            disposalAmount: data.disposal_amount,
            gainLossOnDisposal: data.gain_loss_on_disposal,
            departmentId: data.department_id,
            locationDetails: data.location_details ?? data.location,
            purchasePaymentMethod: data.purchase_payment_method,
            purchaseBankAccountId: data.purchase_bank_account_id,
            purchaseTransactionId: data.purchase_transaction_id,
          });
        }
        return notFound(res, 'Asset');
      } catch (err) {
        console.error('[assets.getById] Supabase error:', err);
        return fail(res, 500, 'Failed to fetch asset');
      }
    }
    return fail(res, 503, 'Database unavailable');
  });

  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<Asset, 'id' | 'organizationId'>;

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    // Handoff §15 validation: name, cost basis, salvage, useful life, category, depreciation method
    const name = String(data.name || '').trim();
    if (!name) return fail(res, 400, 'Asset Name is required');

    const purchasePrice = Number(data.purchasePrice);
    const salvageValue = Number(data.salvageValue ?? 0);
    const usefulLifeYears = Number(data.usefulLifeYears);

    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return fail(res, 400, 'Purchase price must be 0 or greater');
    }
    if (!Number.isFinite(salvageValue) || salvageValue < 0 || salvageValue > purchasePrice) {
      return fail(res, 400, 'Salvage value must be between 0 and purchase price');
    }
    if (!Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0) {
      return fail(res, 400, 'Useful life must be greater than 0 years');
    }
    if (!data.purchaseDate) {
      return fail(res, 400, 'Purchase date is required');
    }

    try {
      // Resolve required Chart of Accounts FKs (account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
      let accountId = data.accountId?.trim() || '';
      let accumDeprAccountId = data.accumulatedDepreciationAccountId?.trim() || '';
      let deprExpAccountId = data.depreciationExpenseAccountId?.trim() || '';

      if (!accountId || !accumDeprAccountId || !deprExpAccountId) {
        await ensureDefaultAccounts(orgId);
        const { data: orgAccounts, error: accErr } = await sb
          .from('accounts')
          .select('id, name, type, subtype')
          .eq('organization_id', orgId)
          .eq('is_active', true);

        if (accErr) throw accErr;
        const accts = orgAccounts || [];

        if (!accountId) {
          const fixedAssetAcct =
            accts.find((a: any) => String(a.subtype || '').toLowerCase() === 'fixed_asset') ||
            accts.find((a: any) => String(a.name || '').toLowerCase().includes('fixed asset')) ||
            accts.find((a: any) => a.type === 'asset');
          accountId = fixedAssetAcct?.id || '';
        }

        if (!accumDeprAccountId) {
          const accumAcct =
            accts.find((a: any) => String(a.subtype || '').toLowerCase() === 'accumulated_depreciation') ||
            accts.find((a: any) => String(a.name || '').toLowerCase().includes('accumulated depreciation')) ||
            accts.find((a: any) => a.type === 'asset');
          accumDeprAccountId = accumAcct?.id || accountId;
        }

        if (!deprExpAccountId) {
          const deprExpAcct =
            accts.find((a: any) => String(a.name || '').toLowerCase().includes('depreciation') && a.type === 'expense') ||
            accts.find((a: any) => a.type === 'expense');
          deprExpAccountId = deprExpAcct?.id || accountId;
        }
      }

      if (!accountId || !accumDeprAccountId || !deprExpAccountId) {
        return fail(res, 400, 'Organization chart of accounts is missing required Fixed Asset / Depreciation accounts.');
      }

      const categoryPrefix = data.category ? data.category.substring(0, 3).toUpperCase() : 'AST';
      const assetCode = data.assetCode?.trim() || `AST-${categoryPrefix}-${Date.now().toString().slice(-6)}`;

      const newAsset: Asset = {
        ...data,
        name,
        id: 'asset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
        organizationId: orgId,
        assetCode,
        accountId,
        accumulatedDepreciationAccountId: accumDeprAccountId,
        depreciationExpenseAccountId: deprExpAccountId,
        purchasePrice,
        salvageValue,
        usefulLifeYears,
        depreciationMethod: data.depreciationMethod || 'straight_line',
        currentValue: purchasePrice,
        accumulatedDepreciation: 0,
        status: data.status || 'active',
        placedInServiceDate: data.placedInServiceDate || data.purchaseDate,
        costBasis: data.costBasis ?? purchasePrice,
      };

      const { error } = await sb.from('assets').upsert(mapDomainToDbAsset(newAsset), { onConflict: 'id' });
      if (error) throw error;

      // Post capitalization journal entry (§15): Dr Fixed Asset / Cr Bank or Accounts Payable
      if (purchasePrice > 0) {
        const orgCurrency = await resolveOrgCurrency(sb, orgId);
        let creditGlId = '';
        if (newAsset.purchaseBankAccountId) {
          const { data: ba } = await sb
            .from('bank_accounts')
            .select('account_id')
            .eq('id', newAsset.purchaseBankAccountId)
            .eq('organization_id', orgId)
            .maybeSingle();
          creditGlId = ba?.account_id || '';
        }
        if (!creditGlId) {
          creditGlId = newAsset.purchaseBankAccountId
            ? await resolveGlAccountId(sb, orgId, 'asset', ['bank_account', 'cash'])
            : await resolveGlAccountId(sb, orgId, 'liability', ['payable', 'accounts_payable']);
        }
        const capJe = await postBalancedJournalEntry(sb, {
          organizationId: orgId,
          entryDate: newAsset.purchaseDate,
          description: `Fixed Asset Capitalization - ${newAsset.name} (${newAsset.assetCode})`,
          sourceType: 'asset_purchase',
          sourceId: newAsset.id,
          currency: orgCurrency,
          actorUserId: req.authUser?.id || null,
          entryPrefix: 'CAP',
          lines: [
            { accountId: newAsset.accountId, departmentId: newAsset.departmentId || null, debit: purchasePrice, credit: 0, description: `Capitalize fixed asset ${newAsset.name}` },
            { accountId: creditGlId, bankAccountId: newAsset.purchaseBankAccountId || null, debit: 0, credit: purchasePrice, description: newAsset.purchaseBankAccountId ? `Bank payment for ${newAsset.name}` : `Payable for ${newAsset.name}` },
          ],
        });
        if (!capJe.success) {
          console.warn('[assets.post] Capitalization journal warning:', capJe.error);
        }
      }

      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'create_asset',
        entityType: 'asset',
        entityId: newAsset.id,
        description: `Registered fixed asset ${newAsset.name} (${newAsset.assetCode}) at ${newAsset.purchasePrice}`,
        afterState: { ...newAsset },
      });

      return created(res, newAsset, 'Asset created');
    } catch (err: any) {
      console.error('[assets.post] Supabase persist error:', err);
      return fail(res, 500, err?.message || 'Failed to create asset');
    }
  });

  r.patch('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
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
        placedInServiceDate: existing.placed_in_service_date,
        purchasePrice: existing.purchase_price,
        costBasis: existing.cost_basis ?? existing.purchase_price,
        salvageValue: existing.salvage_value,
        usefulLifeYears: existing.useful_life_years,
        depreciationMethod: existing.depreciation_method,
        taxDepreciationMethod: existing.tax_depreciation_method,
        taxUsefulLifeYears: existing.tax_useful_life_years,
        accumulatedTaxDepreciation: existing.accumulated_tax_depreciation,
        currentValue: existing.current_value,
        accumulatedDepreciation: existing.accumulated_depreciation,
        status: existing.status,
        disposalDate: existing.disposal_date,
        disposalAmount: existing.disposal_amount,
        gainLossOnDisposal: existing.gain_loss_on_disposal,
        departmentId: existing.department_id,
        locationDetails: existing.location_details ?? existing.location,
        purchasePaymentMethod: existing.purchase_payment_method,
        purchaseBankAccountId: existing.purchase_bank_account_id,
        purchaseTransactionId: existing.purchase_transaction_id,
      } as Asset;

      // Guard immutable posted accounting fields (§8, §33 #4): never allow direct overwrite via PATCH
      const rawPatch = (req.body || {}) as Partial<Asset>;
      const {
        accumulatedDepreciation: _ignoredAccDepr,
        currentValue: _ignoredCurVal,
        status: _ignoredStatus,
        disposalDate: _ignoredDispDate,
        disposalAmount: _ignoredDispAmt,
        gainLossOnDisposal: _ignoredGainLoss,
        ...safePatch
      } = rawPatch as any;
      if (existing.status === 'disposed') {
        return fail(res, 400, 'Cannot modify a disposed asset.');
      }
      const merged: Asset = { ...current, ...safePatch, id: current.id, organizationId: current.organizationId };

      const { error } = await sb.from('assets').upsert(mapDomainToDbAsset(merged), { onConflict: 'id' });
      if (error) throw error;

      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'update_asset',
        entityType: 'asset',
        entityId: assetId,
        description: `Updated asset ${merged.name} (${merged.assetCode})`,
        beforeState: existing,
        afterState: merged as unknown as Record<string, unknown>,
      }).catch(() => {});

      return ok(res, merged);
    } catch (err) {
      console.error('[assets.patch] Supabase error:', err);
      return fail(res, 500, 'Failed to update asset');
    }
  });

  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const assetId = getParamId(req, 'id');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data: existingAsset } = await sb
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (!existingAsset) return notFound(res, 'Asset');
      if (existingAsset.status === 'disposed') {
        return fail(res, 400, 'Cannot delete a disposed asset. Historical disposal records are immutable.');
      }

      const { data: postedSchedules } = await sb
        .from('depreciation_schedules')
        .select('id')
        .eq('asset_id', assetId)
        .eq('organization_id', orgId)
        .eq('status', 'posted')
        .limit(1);

      if (postedSchedules && postedSchedules.length > 0) {
        return fail(res, 400, 'Cannot delete an asset with posted depreciation history. Dispose of the asset instead.');
      }

      const { error: schedErr } = await sb.from('depreciation_schedules').delete().eq('asset_id', assetId).eq('organization_id', orgId);
      if (schedErr) throw schedErr;
      const { error } = await sb.from('assets').delete().eq('id', assetId).eq('organization_id', orgId);
      if (error) throw error;

      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'delete_asset',
        entityType: 'asset',
        entityId: assetId,
        description: `Deleted asset ${existingAsset.name} (${existingAsset.asset_code})`,
        beforeState: existingAsset,
      }).catch(() => {});

      return ok(res, { id: assetId });
    } catch (err) {
      console.error('[assets.delete] Supabase delete error:', err);
      return fail(res, 500, 'Failed to delete asset');
    }
  });

  return r;
}