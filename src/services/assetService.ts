/**
 * Asset & Depreciation Service
 * ==============================
 * CRUD for fixed assets, depreciation schedule management.
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore`.
 */

import { Asset, DepreciationSchedule, Transaction } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';

const ASSET = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/assets`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export type AssetSummary = {
  totalAssets: number;
  totalCurrentValue: number;
  totalPurchaseValue: number;
  totalDepreciation: number;
  byCategory: { category: string; count: number; value: number }[];
};

export const assetService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Asset[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Asset[]>(organizationId);
      if (err) return err;
      return apiGet<Asset[]>(ASSET(organizationId));
    }

    await simulateDelay();
    const assets = dataStore.assets.filter(a => a.organizationId === organizationId);
    return { success: true, data: assets };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Asset | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ASSET(organizationId)}/${encodeURIComponent(id)}`
        : `/assets/${encodeURIComponent(id)}`;
      return apiGet<Asset | null>(path);
    }

    await simulateDelay(80);
    const asset = dataStore.assets.find(a => a.id === id) || null;
    return { success: !!asset, data: asset };
  },

  async create(
    organizationId: string,
    data: Omit<Asset, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<Asset>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Asset>(organizationId);
      if (err) return err;
      return apiPostJson<Omit<Asset, 'id' | 'organizationId'>, Asset>(ASSET(organizationId), data);
    }

    await simulateDelay(200);
    
    // Generate unique asset code
    const categoryPrefix = data.category.substring(0, 3).toUpperCase();
    const assetCode = `AST-${categoryPrefix}-${Date.now().toString().slice(-6)}`;
    
    const newAsset: Asset = { 
      ...data, 
      id: generateId('asset'), 
      organizationId,
      assetCode,
      currentValue: data.purchasePrice,
      accumulatedDepreciation: 0,
    };
    
    dataStore.assets.push(newAsset);
    
    // Create purchase transaction if payment method specified
    if (data.purchasePaymentMethod && data.purchasePaymentMethod !== 'none' && data.purchasePrice > 0) {
      const transactionId = generateId('txn');
      
      const transaction: Transaction = {
        id: transactionId,
        organizationId,
        bankAccountId: data.purchaseBankAccountId || '',
        date: data.purchaseDate,
        description: `Asset Purchase: ${data.name}`,
        narration: `Purchased ${data.category} asset - ${data.name}`,
        amount: -Math.abs(data.purchasePrice), // Negative for expense
        currency: 'USD',
        type: 'debit',
        categoryId: '',
        status: 'classified',
        tags: ['asset-purchase'],
        attachments: [],
        createdAt: new Date().toISOString(),
        idempotencyKey: `asset-purchase-${assetCode}`,
      };
      
      dataStore.transactions.push(transaction);
      
      // Update bank account balance if bank payment
      if (data.purchasePaymentMethod === 'bank_account' && data.purchaseBankAccountId) {
        const bankAccountIdx = dataStore.bankAccounts.findIndex(
          ba => ba.id === data.purchaseBankAccountId
        );
        if (bankAccountIdx !== -1) {
          dataStore.bankAccounts[bankAccountIdx].balance -= Math.abs(data.purchasePrice);
          dataStore.notify('bankAccounts');
        }
      }
      
      // Store transaction reference in asset
      newAsset.purchaseTransactionId = transactionId;
      
      dataStore.notify('transactions');
    }
    
    dataStore.notify('assets');
    return { success: true, data: newAsset, message: 'Asset created' };
  },

  async update(
    id: string,
    updates: Partial<Asset>,
    organizationId?: string,
  ): Promise<ServiceResponse<Asset>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ASSET(organizationId)}/${encodeURIComponent(id)}`
        : `/assets/${encodeURIComponent(id)}`;
      return apiRequest<Asset>(path, { method: 'PATCH', body: JSON.stringify(updates) });
    }

    await simulateDelay(150);
    const idx = dataStore.assets.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Asset not found' };
    dataStore.assets[idx] = { ...dataStore.assets[idx], ...updates };
    dataStore.notify('assets');
    return { success: true, data: dataStore.assets[idx] };
  },

  async dispose(
    id: string,
    disposalDate: string,
    disposalAmount: number,
    organizationId?: string,
  ): Promise<ServiceResponse<Asset>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ASSET(organizationId)}/${encodeURIComponent(id)}/dispose`
        : `/assets/${encodeURIComponent(id)}/dispose`;
      return apiPostJson<{ disposalDate: string; disposalAmount: number }, Asset>(path, {
        disposalDate,
        disposalAmount,
      });
    }

    await simulateDelay(200);
    const idx = dataStore.assets.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Asset not found' };

    dataStore.assets[idx] = {
      ...dataStore.assets[idx],
      status: 'disposed',
      disposalDate,
      disposalAmount,
    };
    dataStore.notify('assets');
    return { success: true, data: dataStore.assets[idx], message: 'Asset disposed' };
  },

  async listDepreciationSchedules(organizationId: string): Promise<ServiceResponse<DepreciationSchedule[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<DepreciationSchedule[]>(organizationId);
      if (err) return err;
      return apiGet<DepreciationSchedule[]>(`${ASSET(organizationId)}/depreciation-schedules`);
    }

    await simulateDelay();
    const schedules = dataStore.depreciationSchedules.filter(d => d.organizationId === organizationId);
    return { success: true, data: schedules };
  },

  async getDepreciationSchedule(
    assetId: string,
    organizationId?: string,
  ): Promise<ServiceResponse<DepreciationSchedule[]>> {
    if (isHttpBackendConfigured()) {
      if (organizationId) {
        return apiGet<DepreciationSchedule[]>(
          `${ASSET(organizationId)}/${encodeURIComponent(assetId)}/depreciation-schedule`,
        );
      }
      return apiGet<DepreciationSchedule[]>(
        `/assets/${encodeURIComponent(assetId)}/depreciation-schedule`,
      );
    }

    await simulateDelay();
    const schedules = dataStore.depreciationSchedules.filter(d => d.assetId === assetId);
    return { success: true, data: schedules };
  },

  async getTaxSchedule(assetId: string, organizationId?: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured() && organizationId) {
      return apiGet<any>(`${ASSET(organizationId)}/${encodeURIComponent(assetId)}/tax-schedule`);
    }
    return { success: true, data: { taxPolicy: { method: 'straight_line' }, schedule: [] } };
  },

  calculateMonthlyDepreciation(asset: Asset): number {
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
  },

  async postDepreciation(
    assetId: string,
    period: string,
    organizationId?: string,
  ): Promise<ServiceResponse<DepreciationSchedule>> {
    if (isHttpBackendConfigured()) {
      if (organizationId) {
        return apiPostJson<{ period: string }, DepreciationSchedule>(
          `${ASSET(organizationId)}/${encodeURIComponent(assetId)}/depreciation`,
          { period },
        );
      }
      return apiPostJson<{ period: string }, DepreciationSchedule>(
        `/assets/${encodeURIComponent(assetId)}/depreciation`,
        { period },
      );
    }

    await simulateDelay(250);

    const asset = dataStore.assets.find(a => a.id === assetId);
    if (!asset) return { success: false, data: null as any, error: 'Asset not found' };

    // Prevent duplicate depreciation posting for the same asset and period
    const existingScheduleIdx = dataStore.depreciationSchedules.findIndex(
      s => s.assetId === assetId && s.period === period
    );
    if (existingScheduleIdx !== -1 && dataStore.depreciationSchedules[existingScheduleIdx].status === 'posted') {
      return {
        success: false,
        data: null as any,
        error: `Depreciation for period ${period} has already been posted for this asset.`,
      };
    }

    const monthlyDepr = assetService.calculateMonthlyDepreciation(asset);
    const closingValue = Math.max(asset.salvageValue, asset.currentValue - monthlyDepr);
    const actualDepr = asset.currentValue - closingValue;

    if (actualDepr <= 0) {
      return {
        success: false,
        data: null as any,
        error: 'Asset has reached its salvage value floor; no further depreciation can be charged.',
      };
    }

    const schedule: DepreciationSchedule = {
      id: existingScheduleIdx !== -1 ? dataStore.depreciationSchedules[existingScheduleIdx].id : generateId('depr'),
      assetId,
      organizationId: asset.organizationId,
      period,
      openingValue: asset.currentValue,
      depreciationAmount: Math.round(actualDepr * 100) / 100,
      closingValue: Math.round(closingValue * 100) / 100,
      status: 'posted',
    };

    if (existingScheduleIdx !== -1) {
      dataStore.depreciationSchedules[existingScheduleIdx] = schedule;
    } else {
      dataStore.depreciationSchedules.push(schedule);
    }

    const assetIdx = dataStore.assets.findIndex(a => a.id === assetId);
    dataStore.assets[assetIdx].currentValue = closingValue;
    dataStore.assets[assetIdx].accumulatedDepreciation += actualDepr;

    if (closingValue <= asset.salvageValue) {
      dataStore.assets[assetIdx].status = 'fully_depreciated';
    }

    dataStore.notify('assets');
    dataStore.notify('depreciationSchedules');
    return { success: true, data: schedule, message: 'Depreciation posted' };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ASSET(organizationId)}/${encodeURIComponent(id)}`
        : `/assets/${encodeURIComponent(id)}`;
      return apiRequest<null>(path, { method: 'DELETE' });
    }

    await simulateDelay(150);
    const hasHistory = dataStore.depreciationSchedules.some(s => s.assetId === id && s.status === 'posted');
    if (hasHistory) {
      return {
        success: false,
        data: null,
        error: 'Cannot delete asset with posted depreciation history. Dispose the asset instead.',
      };
    }
    const idx = dataStore.assets.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Asset not found' };
    dataStore.assets.splice(idx, 1);
    dataStore.depreciationSchedules = dataStore.depreciationSchedules.filter(s => s.assetId !== id);
    dataStore.notify('assets');
    dataStore.notify('depreciationSchedules');
    return { success: true, data: null, message: 'Asset deleted' };
  },

  async getAnalytics(organizationId: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${ASSET(organizationId)}/analytics`);
    }

    await simulateDelay();
    const assets = dataStore.assets.filter(a => a.organizationId === organizationId);
    const schedules = dataStore.depreciationSchedules.filter(s => s.organizationId === organizationId);
    const totalCost = assets.reduce((s, a) => s + (a.purchasePrice || 0), 0);
    const totalCurrentValue = assets.reduce((s, a) => s + (a.currentValue || 0), 0);
    const totalDepreciation = assets.reduce((s, a) => s + (a.accumulatedDepreciation || 0), 0);

    return {
      success: true,
      data: {
        summary: {
          totalAssets: assets.length,
          totalPurchaseCost: totalCost,
          totalCurrentValue,
          totalDepreciation,
          depreciationRatePct: totalCost > 0 ? Math.round((totalDepreciation / totalCost) * 1000) / 10 : 0,
        },
        byCategory: Array.from(
          assets.reduce((map, a) => {
            const cur = map.get(a.category) || { count: 0, cost: 0, currentValue: 0, depreciation: 0 };
            cur.count += 1;
            cur.cost += a.purchasePrice || 0;
            cur.currentValue += a.currentValue || 0;
            cur.depreciation += a.accumulatedDepreciation || 0;
            map.set(a.category, cur);
            return map;
          }, new Map<string, any>()).entries()
        ).map(([category, stats]) => ({ category, ...stats })),
        byStatus: Array.from(
          assets.reduce((map, a) => {
            map.set(a.status, (map.get(a.status) || 0) + 1);
            return map;
          }, new Map<string, number>()).entries()
        ).map(([status, count]) => ({ status, count })),
        recentDepreciations: schedules.slice(-10),
      },
    };
  },

  async getSummary(organizationId: string): Promise<ServiceResponse<AssetSummary>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<AssetSummary>(organizationId);
      if (err) return err;
      return apiGet<AssetSummary>(`${ASSET(organizationId)}/summary`);
    }

    await simulateDelay();

    const assets = dataStore.assets.filter(a => a.organizationId === organizationId);
    const byCategory = new Map<string, { count: number; value: number }>();

    for (const asset of assets) {
      const existing = byCategory.get(asset.category) || { count: 0, value: 0 };
      byCategory.set(asset.category, {
        count: existing.count + 1,
        value: existing.value + asset.currentValue,
      });
    }

    return {
      success: true,
      data: {
        totalAssets: assets.length,
        totalCurrentValue: assets.reduce((s, a) => s + a.currentValue, 0),
        totalPurchaseValue: assets.reduce((s, a) => s + a.purchasePrice, 0),
        totalDepreciation: assets.reduce((s, a) => s + a.accumulatedDepreciation, 0),
        byCategory: Array.from(byCategory.entries()).map(([category, data]) => ({
          category,
          ...data,
        })),
      },
    };
  },
};
