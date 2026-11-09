/**
 * Costing & Pricing Intelligence Service
 * =====================================
 * Client service for:
 *  - Department overhead allocations
 *  - Partner commission structures (cross-border deal splits)
 *  - Exchange rates & live currency conversions
 *
 * Backed by Supabase DB via REST API with direct Supabase client + local fallback.
 */

import type { ServiceResponse, OverheadAllocation, CommissionStructure, ExchangeRate, Quote } from './types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore, generateId, simulateDelay } from './dataStore';

const BASE = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId?.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
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

export const costingService = {
  // ── Overhead Allocations ──────────────────────────────────────────────────

  async getOverheadAllocations(organizationId: string): Promise<ServiceResponse<OverheadAllocation[]>> {
    const err = requireOrg<OverheadAllocation[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiGet<OverheadAllocation[]>(`${BASE(organizationId)}/overhead-allocations`);
      if (res.success && Array.isArray(res.data)) {
        return res;
      }
    }

    // Direct Supabase query fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb
          .from('overhead_allocations')
          .select('*')
          .eq('organization_id', organizationId)
          .order('name', { ascending: true });

        if (!error && Array.isArray(data)) {
          return { success: true, data: data.map(mapDbToDomainAllocation) };
        }
      }
    } catch (e) {
      console.warn('[costingService.getOverheadAllocations] Direct Supabase fetch error:', e);
    }

    await simulateDelay();
    const allocs = dataStore.overheadAllocations.filter(a => a.organizationId === organizationId);
    return { success: true, data: allocs };
  },

  async createOverheadAllocation(
    organizationId: string,
    data: Omit<OverheadAllocation, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<OverheadAllocation>> {
    const err = requireOrg<OverheadAllocation>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<Omit<OverheadAllocation, 'id' | 'organizationId'>, OverheadAllocation>(
        `${BASE(organizationId)}/overhead-allocations`,
        data,
      );
      if (res.success) {
        dataStore.notify('departments');
        return res;
      }
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const newId = generateId('alloc');
        const dbRow = {
          id: newId,
          organization_id: organizationId,
          name: data.name,
          allocation_base: data.allocationBase || 'headcount',
          account_ids: data.accountIds || [],
          departments: data.departments || [],
          amount: data.amount != null ? Number(data.amount) : 0,
        };
        const { data: inserted, error } = await sb.from('overhead_allocations').insert(dbRow).select().single();
        if (!error && inserted) {
          const mapped = mapDbToDomainAllocation(inserted);
          dataStore.notify('departments');
          return { success: true, data: mapped, message: 'Overhead allocation created' };
        }
      }
    } catch (e) {
      console.warn('[costingService.createOverheadAllocation] Direct Supabase insert error:', e);
    }

    await simulateDelay(150);
    const newAlloc: OverheadAllocation = { ...data, id: generateId('alloc'), organizationId };
    dataStore.overheadAllocations.push(newAlloc);
    dataStore.notify('departments');
    return { success: true, data: newAlloc, message: 'Overhead allocation created' };
  },

  async updateOverheadAllocation(
    organizationId: string,
    id: string,
    updates: Partial<OverheadAllocation>,
  ): Promise<ServiceResponse<OverheadAllocation>> {
    const err = requireOrg<OverheadAllocation>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiRequest<OverheadAllocation>(
        `${BASE(organizationId)}/overhead-allocations/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(updates) },
      );
      if (res.success) {
        dataStore.notify('departments');
        return res;
      }
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const dbUpdates: Record<string, unknown> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
        if (updates.allocationBase !== undefined) {
          dbUpdates.allocation_base = updates.allocationBase;
        }
        if (updates.accountIds !== undefined) dbUpdates.account_ids = updates.accountIds;
        if (updates.departments !== undefined) dbUpdates.departments = updates.departments;
        if (updates.amount !== undefined) dbUpdates.amount = Number(updates.amount);

        const { data: updated, error } = await sb
          .from('overhead_allocations')
          .update(dbUpdates)
          .eq('id', id)
          .eq('organization_id', organizationId)
          .select()
          .single();

        if (!error && updated) {
          const mapped = mapDbToDomainAllocation(updated);
          dataStore.notify('departments');
          return { success: true, data: mapped };
        }
      }
    } catch (e) {
      console.warn('[costingService.updateOverheadAllocation] Direct Supabase update error:', e);
    }

    await simulateDelay(150);
    const idx = dataStore.overheadAllocations.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Allocation not found' };
    dataStore.overheadAllocations[idx] = { ...dataStore.overheadAllocations[idx], ...updates };
    dataStore.notify('departments');
    return { success: true, data: dataStore.overheadAllocations[idx] };
  },

  async deleteOverheadAllocation(organizationId: string, id: string): Promise<ServiceResponse<null>> {
    const err = requireOrg<null>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiRequest<null>(
        `${BASE(organizationId)}/overhead-allocations/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (res.success) {
        dataStore.notify('departments');
        return res;
      }
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        await sb.from('overhead_allocations').delete().eq('id', id).eq('organization_id', organizationId);
        dataStore.notify('departments');
        return { success: true, data: null, message: 'Overhead allocation deleted' };
      }
    } catch (e) {
      console.warn('[costingService.deleteOverheadAllocation] Direct Supabase delete error:', e);
    }

    await simulateDelay(150);
    const idx = dataStore.overheadAllocations.findIndex(a => a.id === id);
    if (idx !== -1) dataStore.overheadAllocations.splice(idx, 1);
    dataStore.notify('departments');
    return { success: true, data: null, message: 'Overhead allocation deleted' };
  },

  async setAllocationMethod(
    organizationId: string,
    method: OverheadAllocation['allocationBase'],
  ): Promise<ServiceResponse<{ method: string }>> {
    const err = requireOrg<{ method: string }>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<{ method: string }, { method: string }>(
        `${BASE(organizationId)}/overhead-allocations/method`,
        { method },
      );
      if (res.success) {
        dataStore.notify('departments');
        return res;
      }
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        await sb
          .from('overhead_allocations')
          .update({ allocation_base: method === 'custom' ? 'headcount' : method })
          .eq('organization_id', organizationId);
        dataStore.notify('departments');
        return { success: true, data: { method } };
      }
    } catch (e) {
      console.warn('[costingService.setAllocationMethod] Direct Supabase method update error:', e);
    }

    await simulateDelay(100);
    dataStore.overheadAllocations.forEach(a => {
      if (a.organizationId === organizationId) a.allocationBase = method;
    });
    dataStore.notify('departments');
    return { success: true, data: { method } };
  },

  // ── Commission Structures ─────────────────────────────────────────────────

  async getCommissionStructures(organizationId: string): Promise<ServiceResponse<CommissionStructure[]>> {
    const err = requireOrg<CommissionStructure[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiGet<CommissionStructure[]>(`${BASE(organizationId)}/commission-structures`);
      if (res.success && Array.isArray(res.data)) {
        return res;
      }
    }

    // Direct Supabase query fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb
          .from('commission_structures')
          .select('*')
          .eq('organization_id', organizationId)
          .order('company_name', { ascending: true });

        if (!error && Array.isArray(data)) {
          return { success: true, data: data.map(mapDbToDomainCommission) };
        }
      }
    } catch (e) {
      console.warn('[costingService.getCommissionStructures] Direct Supabase fetch error:', e);
    }

    await simulateDelay();
    return {
      success: true,
      data: [
        {
          id: 'comm-1',
          organizationId,
          companyName: 'Dubai Tech Partners',
          country: 'UAE',
          currency: 'AED',
          yourProfitPercentage: 50,
          middlemanPercentage: 25,
        },
        {
          id: 'comm-2',
          organizationId,
          companyName: 'USA Software Co',
          country: 'United States',
          currency: 'USD',
          yourProfitPercentage: 85,
          middlemanPercentage: 15,
        },
      ],
    };
  },

  async createCommissionStructure(
    organizationId: string,
    data: Omit<CommissionStructure, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<CommissionStructure>> {
    const err = requireOrg<CommissionStructure>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<Omit<CommissionStructure, 'id' | 'organizationId'>, CommissionStructure>(
        `${BASE(organizationId)}/commission-structures`,
        data,
      );
      if (res.success) return res;
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const newId = generateId('comm');
        const dbRow = {
          id: newId,
          organization_id: organizationId,
          company_name: data.companyName,
          country: data.country || null,
          currency: data.currency || 'USD',
          your_profit_percentage: data.yourProfitPercentage,
          middleman_percentage: data.middlemanPercentage,
        };
        const { data: inserted, error } = await sb.from('commission_structures').insert(dbRow).select().single();
        if (!error && inserted) {
          return { success: true, data: mapDbToDomainCommission(inserted), message: 'Commission structure saved' };
        }
      }
    } catch (e) {
      console.warn('[costingService.createCommissionStructure] Direct Supabase insert error:', e);
    }

    await simulateDelay(150);
    const newComm: CommissionStructure = { ...data, id: generateId('comm'), organizationId };
    return { success: true, data: newComm, message: 'Commission structure saved' };
  },

  async updateCommissionStructure(
    organizationId: string,
    id: string,
    updates: Partial<CommissionStructure>,
  ): Promise<ServiceResponse<CommissionStructure>> {
    const err = requireOrg<CommissionStructure>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiRequest<CommissionStructure>(
        `${BASE(organizationId)}/commission-structures/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(updates) },
      );
      if (res.success) return res;
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const dbUpdates: Record<string, unknown> = {};
        if (updates.companyName !== undefined) dbUpdates.company_name = updates.companyName.trim();
        if (updates.country !== undefined) dbUpdates.country = updates.country?.trim() || null;
        if (updates.currency !== undefined) dbUpdates.currency = updates.currency.trim().toUpperCase();
        if (updates.yourProfitPercentage !== undefined) dbUpdates.your_profit_percentage = Number(updates.yourProfitPercentage);
        if (updates.middlemanPercentage !== undefined) dbUpdates.middleman_percentage = Number(updates.middlemanPercentage);

        const { data: updated, error } = await sb
          .from('commission_structures')
          .update(dbUpdates)
          .eq('id', id)
          .eq('organization_id', organizationId)
          .select()
          .single();

        if (!error && updated) {
          return { success: true, data: mapDbToDomainCommission(updated) };
        }
      }
    } catch (e) {
      console.warn('[costingService.updateCommissionStructure] Direct Supabase update error:', e);
    }

    await simulateDelay(150);
    return { success: true, data: { id, organizationId, ...updates } as CommissionStructure };
  },

  async deleteCommissionStructure(organizationId: string, id: string): Promise<ServiceResponse<null>> {
    const err = requireOrg<null>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiRequest<null>(
        `${BASE(organizationId)}/commission-structures/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (res.success) return res;
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        await sb.from('commission_structures').delete().eq('id', id).eq('organization_id', organizationId);
        return { success: true, data: null, message: 'Commission structure deleted' };
      }
    } catch (e) {
      console.warn('[costingService.deleteCommissionStructure] Direct Supabase delete error:', e);
    }

    await simulateDelay(150);
    return { success: true, data: null, message: 'Commission structure deleted' };
  },

  // ── Exchange Rates ────────────────────────────────────────────────────────

  async getExchangeRates(organizationId: string): Promise<ServiceResponse<ExchangeRate[]>> {
    const err = requireOrg<ExchangeRate[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiGet<ExchangeRate[]>(`${BASE(organizationId)}/exchange-rates`);
      if (res.success && Array.isArray(res.data)) {
        return res;
      }
    }

    // Direct Supabase fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb
          .from('exchange_rates')
          .select('*')
          .order('as_of', { ascending: false });

        if (!error && Array.isArray(data)) {
          return {
            success: true,
            data: data.map(r => ({
              id: r.id,
              base: r.base,
              quote: r.quote,
              rate: Number(r.rate),
              asOf: r.as_of,
              source: r.source,
            })),
          };
        }
      }
    } catch (e) {
      console.warn('[costingService.getExchangeRates] Direct Supabase fetch error:', e);
    }

    return {
      success: true,
      data: [
        { base: 'USD', quote: 'PKR', rate: 278, asOf: new Date().toISOString().slice(0, 10) },
        { base: 'AED', quote: 'PKR', rate: 76, asOf: new Date().toISOString().slice(0, 10) },
        { base: 'EUR', quote: 'PKR', rate: 302, asOf: new Date().toISOString().slice(0, 10) },
        { base: 'GBP', quote: 'PKR', rate: 355, asOf: new Date().toISOString().slice(0, 10) },
      ],
    };
  },

  async convertCurrency(
    organizationId: string,
    amount: number,
    from: string,
    to: string,
  ): Promise<ServiceResponse<{ amount: number; from: string; to: string; rate: number; converted: number }>> {
    const err = requireOrg<any>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiGet<any>(
        `${BASE(organizationId)}/exchange-rates/convert?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      if (res.success && res.data) return res;
    }

    // Direct Supabase rpc fallback
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: convData } = await sb.rpc('fx_convert', {
          p_amount: amount,
          p_from: from.toUpperCase(),
          p_to: to.toUpperCase(),
        });
        if (convData != null) {
          const converted = Number(convData);
          const rate = amount > 0 ? converted / amount : 0;
          return { success: true, data: { amount, from, to, rate, converted } };
        }
      }
    } catch (e) {
      console.warn('[costingService.convertCurrency] Direct Supabase rpc error:', e);
    }

    const rates: Record<string, number> = {
      'USD_PKR': 278,
      'AED_PKR': 76,
      'EUR_PKR': 302,
      'GBP_PKR': 355,
      'PKR_USD': 0.0036,
      'PKR_AED': 0.0132,
    };
    const rate = from === to ? 1 : rates[`${from}_${to}`] ?? (from === 'USD' ? 278 : from === 'AED' ? 76 : 1);
    return {
      success: true,
      data: { amount, from, to, rate, converted: amount * rate },
    };
  },

  // ── §14 Quote Simulator & Pricing Engine ─────────────────────────────────

  calculateQuote(input: any) {
    const roleEstimates: any[] = Array.isArray(input.roleEstimates) ? input.roleEstimates : [];
    const directPurchases: any[] = Array.isArray(input.directPurchases) ? input.directPurchases : [];

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
    const overheadAmount = Math.max(0, Number(input.overheadAmount || 0));

    // 4. contingency
    const subtotal = estimatedDirectLabor + directPurchasesTotal + overheadAmount;
    const contingencyPercent = Math.max(0, Number(input.contingencyPercent || 0));
    const contingencyAmount = Number(input.contingencyAmount || 0) > 0
      ? Number(input.contingencyAmount)
      : (subtotal * (contingencyPercent / 100));

    // 5. estimated_total_cost = labor + direct_purchases + attributed_overhead + contingency
    const estimatedTotalCost = subtotal + contingencyAmount;

    // 6. profit_amount = proposed_price − estimated_total_cost
    const proposedPrice = Math.max(0, Number(input.proposedPrice || 0));
    const profitAmount = proposedPrice - estimatedTotalCost;

    // 7. margin_percent = profit_amount / proposed_price × 100 (Safe divide: block div by zero)
    const marginPercent = proposedPrice > 0 ? (profitAmount / proposedPrice) * 100 : 0;

    // 8. markup_percent = profit_amount / estimated_total_cost × 100 (Safe divide: block div by zero)
    const markupPercent = estimatedTotalCost > 0 ? (profitAmount / estimatedTotalCost) * 100 : 0;

    // 9. required_price_for_target_margin = estimated_total_cost / (1 − target_margin_fraction)
    const targetMarginPercent = Number(input.targetMarginPercent ?? 25);
    const targetMarginFraction = targetMarginPercent / 100;
    const isTargetMarginValid = targetMarginFraction < 1 && targetMarginFraction > -1 && (1 - targetMarginFraction) > 1e-6;
    const requiredPriceForTargetMargin = isTargetMarginValid
      ? estimatedTotalCost / (1 - targetMarginFraction)
      : null;

    const targetMarkupPercent = Number(input.targetMarkupPercent ?? 33.33);
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
      isRevenueRecognized: false as const, // Invariant (§14)
    };
  },

  async getQuotes(organizationId: string): Promise<ServiceResponse<Quote[]>> {
    const err = requireOrg<Quote[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const res = await apiGet<Quote[]>(`${BASE(organizationId)}/quotes`);
      if (res.success && Array.isArray(res.data)) {
        return res;
      }
    }

    return {
      success: true,
      data: [
        {
          id: 'quote-001',
          organizationId,
          clientName: 'Client MQ',
          projectName: 'Finance OS Core Rollout',
          serviceType: 'Enterprise Cloud Platform',
          billingModel: 'fixed_price',
          deliveryHorizonMonths: 3,
          currency: 'USD',
          targetMarginPercent: 35,
          targetMarkupPercent: 53.85,
          proposedPrice: 120000,
          roleEstimates: [
            { id: 'r1', roleName: 'Lead Systems Architect', estimatedHours: 160, costRate: 95, billingRate: 160 },
            { id: 'r2', roleName: 'Senior Fullstack Engineer', estimatedHours: 320, costRate: 65, billingRate: 115 },
            { id: 'r3', roleName: 'QA & Financial Golden File Engineer', estimatedHours: 120, costRate: 45, billingRate: 85 },
          ],
          directPurchases: [
            { id: 'dp1', description: 'Dedicated Cloud Database Cluster', category: 'Infrastructure', amount: 3500, currency: 'USD' },
            { id: 'dp2', description: 'Financial OCR Engine API Subscription', category: 'Software Licenses', amount: 1200, currency: 'USD' },
          ],
          overheadAmount: 6500,
          overheadMethod: 'headcount',
          contingencyPercent: 10,
          contingencyAmount: 5260,
          estimatedDirectLabor: 41400,
          estimatedTotalCost: 57860,
          profitAmount: 62140,
          marginPercent: 51.78,
          markupPercent: 107.4,
          requiredPriceForTargetMargin: 89015.38,
          currentVersion: 'v1.1',
          versions: [
            {
              version: 'v1.0',
              createdAt: '2026-10-15T10:00:00Z',
              notes: 'Initial scope quote with 20% margin target',
              proposedPrice: 85000,
              estimatedTotalCost: 55000,
              profitAmount: 30000,
              marginPercent: 35.29,
              markupPercent: 54.55,
            },
            {
              version: 'v1.1',
              createdAt: '2026-10-28T14:30:00Z',
              notes: 'Expanded QA testing coverage and dedicated cluster infrastructure',
              proposedPrice: 120000,
              estimatedTotalCost: 57860,
              profitAmount: 62140,
              marginPercent: 51.78,
              markupPercent: 107.4,
            },
          ],
          status: 'approved',
          isRevenueRecognized: false,
          createdAt: '2026-10-15T10:00:00Z',
          updatedAt: '2026-10-28T14:30:00Z',
        },
      ],
    };
  },

  async saveQuote(organizationId: string, quote: Partial<Quote>): Promise<ServiceResponse<Quote>> {
    const err = requireOrg<Quote>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiPostJson<Partial<Quote>, Quote>(`${BASE(organizationId)}/quotes`, quote);
    }

    const calc = this.calculateQuote(quote);
    const newQuote: Quote = {
      id: quote.id || ('quote-' + Date.now().toString(36)),
      organizationId,
      clientName: quote.clientName || 'Client',
      projectName: quote.projectName || 'Project Quote',
      serviceType: quote.serviceType || 'Custom Development',
      billingModel: quote.billingModel || 'fixed_price',
      deliveryHorizonMonths: quote.deliveryHorizonMonths || 3,
      currency: quote.currency || 'USD',
      targetMarginPercent: quote.targetMarginPercent ?? 25,
      targetMarkupPercent: quote.targetMarkupPercent ?? 33.33,
      roleEstimates: quote.roleEstimates || [],
      directPurchases: quote.directPurchases || [],
      overheadMethod: quote.overheadMethod || 'headcount',
      ...calc,
      currentVersion: quote.currentVersion || 'v1.0',
      versions: quote.versions || [
        {
          version: 'v1.0',
          createdAt: new Date().toISOString(),
          notes: 'Initial baseline quote',
          proposedPrice: calc.proposedPrice,
          estimatedTotalCost: calc.estimatedTotalCost,
          profitAmount: calc.profitAmount,
          marginPercent: calc.marginPercent,
          markupPercent: calc.markupPercent,
        },
      ],
      status: quote.status || 'draft',
      isRevenueRecognized: false,
      createdAt: quote.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return { success: true, data: newQuote };
  },

  async deleteQuote(organizationId: string, quoteId: string): Promise<ServiceResponse<null>> {
    const err = requireOrg<null>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiRequest<null>(`${BASE(organizationId)}/quotes/${encodeURIComponent(quoteId)}`, { method: 'DELETE' });
    }

    return { success: true, data: null };
  },
};
