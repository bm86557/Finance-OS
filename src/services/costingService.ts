/**
 * Costing & Pricing Intelligence Service (§12, §14, §8)
 * ======================================================
 * Authoritative API client for:
 *  - Department overhead allocations & immutable frozen allocation runs
 *  - Partner commission structures (multiplicative deal splits)
 *  - Tenant-scoped exchange rates & FX conversions
 *  - §14 Quote simulator, pricing & immutable quote versioning
 *
 * Strictly delegates financial authority to the backend API (no silent mock fabrication — §0 #3).
 */

import type {
  ServiceResponse,
  OverheadAllocation,
  AllocationRun,
  CommissionStructure,
  ExchangeRate,
  Quote,
  QuoteCalculationResult,
} from './types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore } from './dataStore';

const BASE = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId?.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

function backendUnavailable<T>(message = 'Backend API is not configured or unavailable'): ServiceResponse<T> {
  return { success: false, data: null as unknown as T, error: message };
}

export const costingService = {
  // ── Overhead Allocations & Frozen Allocation Runs ─────────────────────────

  async getOverheadAllocations(organizationId: string): Promise<ServiceResponse<OverheadAllocation[]>> {
    const err = requireOrg<OverheadAllocation[]>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<OverheadAllocation[]>();
    return apiGet<OverheadAllocation[]>(`${BASE(organizationId)}/overhead-allocations`);
  },

  async createOverheadAllocation(
    organizationId: string,
    data: Omit<OverheadAllocation, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<OverheadAllocation>> {
    const err = requireOrg<OverheadAllocation>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<OverheadAllocation>();

    const res = await apiPostJson<Omit<OverheadAllocation, 'id' | 'organizationId'>, OverheadAllocation>(
      `${BASE(organizationId)}/overhead-allocations`,
      data,
    );
    if (res.success) {
      dataStore.notify('departments');
      dataStore.notify('overheadAllocations');
    }
    return res;
  },

  async updateOverheadAllocation(
    organizationId: string,
    id: string,
    updates: Partial<OverheadAllocation>,
  ): Promise<ServiceResponse<OverheadAllocation>> {
    const err = requireOrg<OverheadAllocation>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<OverheadAllocation>();

    const res = await apiRequest<OverheadAllocation>(
      `${BASE(organizationId)}/overhead-allocations/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );
    if (res.success) {
      dataStore.notify('departments');
      dataStore.notify('overheadAllocations');
    }
    return res;
  },

  async deleteOverheadAllocation(organizationId: string, id: string): Promise<ServiceResponse<null>> {
    const err = requireOrg<null>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<null>();

    const res = await apiRequest<null>(
      `${BASE(organizationId)}/overhead-allocations/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (res.success) {
      dataStore.notify('departments');
      dataStore.notify('overheadAllocations');
    }
    return res;
  },

  async setAllocationMethod(
    organizationId: string,
    method: OverheadAllocation['allocationBase'],
  ): Promise<ServiceResponse<{ method: string }>> {
    const err = requireOrg<{ method: string }>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<{ method: string }>();

    const res = await apiPostJson<{ method: string }, { method: string }>(
      `${BASE(organizationId)}/overhead-allocations/method`,
      { method },
    );
    if (res.success) {
      dataStore.notify('departments');
      dataStore.notify('overheadAllocations');
    }
    return res;
  },

  async getAllocationRuns(organizationId: string): Promise<ServiceResponse<AllocationRun[]>> {
    const err = requireOrg<AllocationRun[]>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<AllocationRun[]>();
    return apiGet<AllocationRun[]>(`${BASE(organizationId)}/overhead-allocations/runs`);
  },

  async freezeAllocationRun(
    organizationId: string,
    params?: { from?: string; to?: string; period?: string },
  ): Promise<ServiceResponse<AllocationRun>> {
    const err = requireOrg<AllocationRun>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<AllocationRun>();
    return apiPostJson<Record<string, unknown>, AllocationRun>(
      `${BASE(organizationId)}/overhead-allocations/runs`,
      params || {},
    );
  },

  // ── Commission Structures ─────────────────────────────────────────────────

  async getCommissionStructures(organizationId: string): Promise<ServiceResponse<CommissionStructure[]>> {
    const err = requireOrg<CommissionStructure[]>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<CommissionStructure[]>();
    return apiGet<CommissionStructure[]>(`${BASE(organizationId)}/commission-structures`);
  },

  async createCommissionStructure(
    organizationId: string,
    data: Omit<CommissionStructure, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<CommissionStructure>> {
    const err = requireOrg<CommissionStructure>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<CommissionStructure>();
    return apiPostJson<Omit<CommissionStructure, 'id' | 'organizationId'>, CommissionStructure>(
      `${BASE(organizationId)}/commission-structures`,
      data,
    );
  },

  async updateCommissionStructure(
    organizationId: string,
    id: string,
    updates: Partial<CommissionStructure>,
  ): Promise<ServiceResponse<CommissionStructure>> {
    const err = requireOrg<CommissionStructure>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<CommissionStructure>();
    return apiRequest<CommissionStructure>(
      `${BASE(organizationId)}/commission-structures/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );
  },

  async deleteCommissionStructure(organizationId: string, id: string): Promise<ServiceResponse<null>> {
    const err = requireOrg<null>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<null>();
    return apiRequest<null>(
      `${BASE(organizationId)}/commission-structures/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  },

  // ── Tenant-Scoped Exchange Rates ──────────────────────────────────────────

  async getExchangeRates(organizationId: string): Promise<ServiceResponse<ExchangeRate[]>> {
    const err = requireOrg<ExchangeRate[]>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<ExchangeRate[]>();
    return apiGet<ExchangeRate[]>(`${BASE(organizationId)}/exchange-rates`);
  },

  async saveExchangeRate(
    organizationId: string,
    payload: { base: string; quote: string; rate: number },
  ): Promise<ServiceResponse<ExchangeRate>> {
    const err = requireOrg<ExchangeRate>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<ExchangeRate>();
    return apiPostJson<{ base: string; quote: string; rate: number }, ExchangeRate>(
      `${BASE(organizationId)}/exchange-rates`,
      payload,
    );
  },

  async convertCurrency(
    organizationId: string,
    amount: number,
    from: string,
    to: string,
  ): Promise<ServiceResponse<{ amount: number; from: string; to: string; rate: number; converted: number; source?: string; asOf?: string }>> {
    const err = requireOrg<any>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<any>();
    return apiGet<any>(
      `${BASE(organizationId)}/exchange-rates/convert?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
  },

  // ── §14 Quote Simulator & Pricing Engine ─────────────────────────────────

  /**
   * Pure preview calculator mirroring authoritative `server/services/costingEngine.ts`
   * (zero ledger mutation; null on zero-denominator per §14 L739 & §33 #9).
   */
  calculateQuote(input: {
    roleEstimates?: Array<{ estimatedHours?: number; costRate?: number }>;
    directPurchases?: Array<{ amount?: number }>;
    overheadAmount?: number;
    contingencyPercent?: number;
    contingencyAmount?: number;
    proposedPrice?: number;
    targetMarginPercent?: number;
    targetMarkupPercent?: number;
  }): QuoteCalculationResult {
    const roleEstimates = Array.isArray(input.roleEstimates) ? input.roleEstimates : [];
    const directPurchases = Array.isArray(input.directPurchases) ? input.directPurchases : [];

    const estimatedDirectLabor = roleEstimates.reduce(
      (sum, r) => sum + Math.max(0, Number(r.estimatedHours || 0)) * Math.max(0, Number(r.costRate || 0)),
      0,
    );
    const directPurchasesTotal = directPurchases.reduce(
      (sum, p) => sum + Math.max(0, Number(p.amount || 0)),
      0,
    );
    const overheadAmount = Math.max(0, Number(input.overheadAmount || 0));
    const subtotal = estimatedDirectLabor + directPurchasesTotal + overheadAmount;
    const contingencyPercent = Math.max(0, Number(input.contingencyPercent || 0));
    const contingencyAmount = Number(input.contingencyAmount || 0) > 0
      ? Math.max(0, Number(input.contingencyAmount))
      : subtotal * (contingencyPercent / 100);
    const estimatedTotalCost = subtotal + contingencyAmount;

    const proposedPrice = Math.max(0, Number(input.proposedPrice || 0));
    const profitAmount = proposedPrice - estimatedTotalCost;

    // Strictly null on zero denominator (§14 L739, §33 #9)
    const marginPercent = proposedPrice > 0 ? Math.round(((profitAmount / proposedPrice) * 100) * 100) / 100 : null;
    const markupPercent = estimatedTotalCost > 0 ? Math.round(((profitAmount / estimatedTotalCost) * 100) * 100) / 100 : null;

    const targetMarginPercent = Number(input.targetMarginPercent ?? 25);
    const targetMarginFraction = targetMarginPercent / 100;
    const isTargetMarginValid =
      Number.isFinite(targetMarginPercent) &&
      targetMarginFraction >= 0 &&
      targetMarginFraction < 1 &&
      1 - targetMarginFraction > 1e-6;
    const requiredPriceForTargetMargin = isTargetMarginValid
      ? estimatedTotalCost / (1 - targetMarginFraction)
      : null;

    const targetMarkupPercent = Math.max(0, Number(input.targetMarkupPercent ?? 33.33));
    const requiredPriceForTargetMarkup = estimatedTotalCost * (1 + targetMarkupPercent / 100);

    const r2 = (n: number) => Math.round(n * 100) / 100;

    return {
      estimatedDirectLabor: r2(estimatedDirectLabor),
      directPurchasesTotal: r2(directPurchasesTotal),
      overheadAmount: r2(overheadAmount),
      contingencyAmount: r2(contingencyAmount),
      contingencyPercent,
      estimatedTotalCost: r2(estimatedTotalCost),
      proposedPrice: r2(proposedPrice),
      profitAmount: r2(profitAmount),
      marginPercent,
      markupPercent,
      requiredPriceForTargetMargin: requiredPriceForTargetMargin != null ? r2(requiredPriceForTargetMargin) : null,
      requiredPriceForTargetMarkup: r2(requiredPriceForTargetMarkup),
      isTargetMarginValid,
      isBelowCost: proposedPrice > 0 && proposedPrice < estimatedTotalCost,
      meetsTargetMargin: marginPercent != null && isTargetMarginValid && marginPercent >= targetMarginPercent,
      isRevenueRecognized: false,
    };
  },

  async calculateQuoteRemote(
    organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<ServiceResponse<QuoteCalculationResult>> {
    const err = requireOrg<QuoteCalculationResult>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<QuoteCalculationResult>();
    return apiPostJson<Record<string, unknown>, QuoteCalculationResult>(
      `${BASE(organizationId)}/quotes/calculate`,
      payload,
    );
  },

  async getQuotes(organizationId: string): Promise<ServiceResponse<Quote[]>> {
    const err = requireOrg<Quote[]>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<Quote[]>();
    return apiGet<Quote[]>(`${BASE(organizationId)}/quotes`);
  },

  async saveQuote(organizationId: string, quote: Partial<Quote> & { versionNotes?: string }): Promise<ServiceResponse<Quote>> {
    const err = requireOrg<Quote>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<Quote>();
    return apiPostJson<Partial<Quote> & { versionNotes?: string }, Quote>(
      `${BASE(organizationId)}/quotes`,
      quote,
    );
  },

  async deleteQuote(organizationId: string, quoteId: string): Promise<ServiceResponse<null>> {
    const err = requireOrg<null>(organizationId);
    if (err) return err;
    if (!isHttpBackendConfigured()) return backendUnavailable<null>();
    return apiRequest<null>(`${BASE(organizationId)}/quotes/${encodeURIComponent(quoteId)}`, { method: 'DELETE' });
  },
};
