/**
 * Supabase Cash Flow Forecast Service
 * ===================================
 * Complete, secure Supabase DB integration for Cash Flow Forecast.
 * Directly queries and materializes forecasts in Supabase PostgreSQL tables:
 *  - bank_accounts (liquid opening balances)
 *  - transactions (median historical daily burn & income)
 *  - recurring_transactions (forward-scheduled commitments)
 *  - loans (debt service & loan receivable installments)
 *  - cash_flow_forecasts (materialized daily projection rows & audit trail)
 */

import { getSupabaseClient } from '@/lib/supabaseClient';
import { apiGet, apiPostJson, isHttpBackendConfigured } from '@/lib/apiClient';
import { computeCashFlowForecast, type ForecastDayRow, type ForecastKPIs } from './forecastEngine';
import { convertCurrency } from '@/lib/currencyUtils';

export interface CashFlowForecastData {
  date: string;
  income: number;
  expenses: number;
  net: number;
  balance: number;
  confidence: number;
  type?: 'actual' | 'projected';
}

export interface CashFlowForecastResult {
  forecasts: CashFlowForecastData[];
  currentCash: number;
  projectedCash: number;
  burnRate: number;
  dailyBurn?: number;
  dailyIncome?: number;
  netBurnMonthly?: number;
  runway: number | null;
  runwayStatus?: 'cash_generative' | 'burning' | 'insufficient_cash';
  cashCrunchDays: number;
  cashCrunchThreshold?: number;
  lowestBalance?: number;
  highestBalance?: number;
  scenario: string;
  horizonDays?: number;
  monthlyBreakdown?: any[];
}

/**
 * Generate cash flow forecast for organization and persist to Supabase DB
 */
export async function generateCashFlowForecast(
  organizationId: string,
  horizonDays: number = 90,
  scenario: 'realistic' | 'best' | 'worst' = 'realistic'
): Promise<{ success: boolean; data?: CashFlowForecastResult; error?: string }> {
  try {
    // 1. Try Backend REST endpoint (which persists to Supabase DB)
    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<
        { horizonDays: number; scenario: string },
        CashFlowForecastResult
      >(`/organizations/${encodeURIComponent(organizationId)}/reports/forecast/generate`, {
        horizonDays,
        scenario,
      });

      if (res.success && res.data) {
        return { success: true, data: res.data };
      }
    }

    // 2. Direct Supabase DB execution and persistence
    const sb = getSupabaseClient();
    if (!sb) {
      return { success: false, error: 'Supabase client not configured' };
    }

    const { data: orgRow } = await sb.from('organizations').select('currency').eq('id', organizationId).single();
    const baseCurrency = (orgRow?.currency || 'USD').toUpperCase();

    // A. Query liquid cash from bank_accounts
    const { data: bankData } = await sb
      .from('bank_accounts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true);

    // B. Query transactions from Supabase DB with all fields
    const { data: txns } = await sb
      .from('transactions')
      .select('*')
      .eq('organization_id', organizationId);

    let currentCash = 0;
    if (bankData && bankData.length > 0) {
      let totalBank = 0;
      let totalOnlineWallets = 0;
      let totalCreditLiabilities = 0;
      let totalCash = 0;

      for (const b of bankData) {
        const accountTxns = (txns || []).filter(
          (t: any) =>
            t.bank_account_id === b.id &&
            !['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(String(t.status || 'classified').toLowerCase())
        );
        const rawOpening = b.opening_balance;
        const openingBal = rawOpening != null
          ? Number(rawOpening)
          : (accountTxns.length > 0 ? 0 : Number(b.balance ?? 0));

        let liveBal = openingBal;

        for (const t of accountTxns) {
          const rawAmt = Number(t.amount || 0);
          const txnCurrency = (t.currency || b.currency || baseCurrency).toUpperCase();
          let fxRate: number | undefined = t.fx_rate_to_base ? Number(t.fx_rate_to_base) : undefined;
          const tags = Array.isArray(t.tags) ? t.tags : (typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : []);
          if (!fxRate && tags) {
            const rTag = tags.find((tag: any) => typeof tag === 'string' && tag.startsWith('fx:rate:'));
            if (rTag) fxRate = Number(rTag.slice(8));
          }
          const convertedAmt = convertCurrency(rawAmt, txnCurrency, b.currency || baseCurrency, fxRate);
          if (t.type === 'credit') {
            liveBal += convertedAmt;
          } else {
            liveBal -= Math.abs(convertedAmt);
          }
        }

        const roundedLiveBal = Math.round(liveBal * 100) / 100;
        const balInBase = convertCurrency(roundedLiveBal, b.currency || baseCurrency, baseCurrency);

        if (['checking', 'savings', 'debit_card', 'prepaid_card', 'bank_account'].includes(b.account_type)) {
          totalBank += balInBase;
        } else if (b.account_type === 'online_wallet') {
          totalOnlineWallets += balInBase;
        } else if (['credit_card', 'line_of_credit'].includes(b.account_type)) {
          totalCreditLiabilities += Math.abs(balInBase);
        } else if (b.account_type === 'cash') {
          totalCash += balInBase;
        }
      }

      currentCash = Math.round((totalBank + totalCash + totalOnlineWallets - totalCreditLiabilities) * 100) / 100;
    }

    // Fallback to accounts table if bank accounts is 0
    if (currentCash === 0) {
      const { data: accData } = await sb
        .from('accounts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true);
      if (accData) {
        currentCash = accData
          .filter((a: any) => a.type === 'asset' && ['bank_account', 'current_asset', 'cash'].includes(a.subtype))
          .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
      }
    }

    // C. Query recurring transactions from Supabase DB
    const { data: recurring } = await sb
      .from('recurring_transactions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true);

    // D. Query loans from Supabase DB
    const { data: loans } = await sb
      .from('loans')
      .select('*')
      .eq('organization_id', organizationId);

    // Compute deterministic forecast with baseCurrency
    const engineResult = computeCashFlowForecast({
      organizationId,
      horizonDays,
      scenario,
      currentCash,
      baseCurrency,
      transactions: txns || [],
      recurring: recurring || [],
      loans: loans || [],
    });

    // E. Persist rows to cash_flow_forecasts table in Supabase DB
    if (engineResult.forecasts.length > 0) {
      const rowsToInsert = engineResult.forecasts.map(f => ({
        id: `cff-${organizationId}-${f.date}-${scenario}`,
        organization_id: organizationId,
        date: f.date,
        forecasted_income: f.income,
        forecasted_expenses: f.expense,
        net_cash_flow: f.net,
        projected_balance: f.balance,
        confidence: f.confidence,
        scenario,
        generated_at: new Date().toISOString(),
      }));

      // Delete old forecast rows for this horizon and scenario
      await sb
        .from('cash_flow_forecasts')
        .delete()
        .eq('organization_id', organizationId)
        .eq('scenario', scenario)
        .gte('date', engineResult.forecasts[0].date);

      await sb.from('cash_flow_forecasts').upsert(rowsToInsert);
    }

    const result: CashFlowForecastResult = {
      forecasts: engineResult.forecasts.map(f => ({
        date: f.date,
        income: f.income,
        expenses: f.expenses,
        net: f.net,
        balance: f.balance,
        confidence: f.confidence,
        type: f.type,
      })),
      currentCash: engineResult.kpis.currentCash,
      projectedCash: engineResult.kpis.projectedCash,
      burnRate: engineResult.kpis.burnRate,
      dailyBurn: engineResult.kpis.dailyBurn,
      dailyIncome: engineResult.kpis.dailyIncome,
      netBurnMonthly: engineResult.kpis.netBurnMonthly,
      runway: engineResult.kpis.runway,
      runwayStatus: engineResult.kpis.runwayStatus,
      cashCrunchDays: engineResult.kpis.cashCrunchDays,
      cashCrunchThreshold: engineResult.kpis.cashCrunchThreshold,
      lowestBalance: engineResult.kpis.lowestBalance,
      highestBalance: engineResult.kpis.highestBalance,
      scenario,
      horizonDays,
      monthlyBreakdown: engineResult.kpis.monthlyBreakdown,
    };

    return { success: true, data: result };
  } catch (err) {
    console.error('[supabaseCashFlowService.generateCashFlowForecast] Exception:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate forecast',
    };
  }
}

/**
 * Get cash flow forecast with KPIs directly from Supabase DB
 * Reads materialized forecasts or generates on-the-fly if empty
 */
export async function getCashFlowForecast(
  organizationId: string,
  horizonDays: number = 90,
  scenario: 'realistic' | 'best' | 'worst' = 'realistic'
): Promise<{ success: boolean; data?: CashFlowForecastResult; error?: string }> {
  try {
    // 1. Try Backend API first if running
    if (isHttpBackendConfigured()) {
      const res = await apiGet<any>(
        `/organizations/${encodeURIComponent(organizationId)}/reports/forecast?horizonDays=${horizonDays}&scenario=${scenario}`
      );
      if (res.success && res.data && Array.isArray(res.data.forecasts) && res.data.forecasts.length > 0) {
        return {
          success: true,
          data: {
            forecasts: res.data.forecasts.map((f: any) => ({
              date: f.date,
              income: Number(f.income || 0),
              expenses: Number(f.expenses ?? f.expense ?? 0),
              net: Number(f.net ?? f.netFlow ?? 0),
              balance: Number(f.balance || 0),
              confidence: Number(f.confidence ?? 80),
              type: f.type || 'projected',
            })),
            currentCash: Number(res.data.currentCash || 0),
            projectedCash: Number(res.data.projectedCash || 0),
            burnRate: Number(res.data.burnRate || 0),
            dailyBurn: res.data.dailyBurn,
            dailyIncome: res.data.dailyIncome,
            netBurnMonthly: res.data.netBurnMonthly,
            runway: res.data.runway ?? null,
            runwayStatus: res.data.runwayStatus || (res.data.runway === null ? 'cash_generative' : 'burning'),
            cashCrunchDays: Number(res.data.cashCrunchDays || 0),
            cashCrunchThreshold: res.data.cashCrunchThreshold,
            lowestBalance: res.data.lowestBalance,
            highestBalance: res.data.highestBalance,
            scenario: res.data.scenario || scenario,
            horizonDays,
            monthlyBreakdown: res.data.monthlyBreakdown,
          },
        };
      }
    }

    // 2. Direct Supabase DB generation and persistence
    return await generateCashFlowForecast(organizationId, horizonDays, scenario);
  } catch (err) {
    console.error('[supabaseCashFlowService.getCashFlowForecast] Exception:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
