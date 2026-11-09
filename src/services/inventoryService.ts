/**
 * Inventory Service
 * ==================
 * CRUD for inventory items and inventory transactions.
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore`.
 */

import { InventoryItem, InventoryTransaction } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';

// Import transaction service to create financial transactions
import { transactionService } from './transactionService';

const INV = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/inventory`;

const ITEMS = (organizationId: string) => `${INV(organizationId)}/items`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export type InventoryValuation = {
  totalItems: number;
  totalValue: number;
  byCostingMethod: { method: string; count: number; value: number }[];
};

export const inventoryService = {
  async getAll(organizationId: string): Promise<ServiceResponse<InventoryItem[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<InventoryItem[]>(organizationId);
      if (err) return err;
      return apiGet<InventoryItem[]>(ITEMS(organizationId));
    }

    await simulateDelay();
    return { success: true, data: dataStore.inventoryItems.filter(i => i.organizationId === organizationId) };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<InventoryItem | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ITEMS(organizationId)}/${encodeURIComponent(id)}`
        : `/inventory/items/${encodeURIComponent(id)}`;
      return apiGet<InventoryItem | null>(path);
    }

    await simulateDelay(80);
    const item = dataStore.inventoryItems.find(i => i.id === id) || null;
    return { success: !!item, data: item };
  },

  async create(
    organizationId: string,
    data: Omit<InventoryItem, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<InventoryItem>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<InventoryItem>(organizationId);
      if (err) return err;
      return apiPostJson<Omit<InventoryItem, 'id' | 'organizationId'>, InventoryItem>(
        ITEMS(organizationId),
        data,
      );
    }

    await simulateDelay(200);
    const newItem: InventoryItem = { ...data, id: generateId('inv'), organizationId };
    dataStore.inventoryItems.push(newItem);
    dataStore.notify('inventoryItems');
    return { success: true, data: newItem, message: 'Inventory item created' };
  },

  async update(
    id: string,
    updates: Partial<InventoryItem>,
    organizationId?: string,
  ): Promise<ServiceResponse<InventoryItem>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${ITEMS(organizationId)}/${encodeURIComponent(id)}`
        : `/inventory/items/${encodeURIComponent(id)}`;
      return apiRequest<InventoryItem>(path, { method: 'PATCH', body: JSON.stringify(updates) });
    }

    await simulateDelay(150);
    const idx = dataStore.inventoryItems.findIndex(i => i.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Item not found' };
    dataStore.inventoryItems[idx] = { ...dataStore.inventoryItems[idx], ...updates };
    dataStore.notify('inventoryItems');
    return { success: true, data: dataStore.inventoryItems[idx] };
  },

  async recordTransaction(
    organizationId: string,
    data: Omit<InventoryTransaction, 'id' | 'organizationId'> & { 
      unitCost?: number; 
      totalCost?: number; 
      idempotencyKey?: string;
      bankAccountId?: string; // NEW: Bank account for payment
    },
  ): Promise<ServiceResponse<InventoryTransaction>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<InventoryTransaction>(organizationId);
      if (err) return err;
      
      // Generate idempotency key if not provided
      if (!data.idempotencyKey) {
        data.idempotencyKey = `invtxn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      
      return apiPostJson<typeof data, InventoryTransaction>(
        `${INV(organizationId)}/transactions`,
        data,
      );
    }

    await simulateDelay(200);

    // Generate idempotency key if not provided
    const idempotencyKey = data.idempotencyKey || `invtxn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check for duplicate
    if (dataStore.inventoryTransactions.some((t: any) => t.idempotencyKey === idempotencyKey)) {
      return { success: false, data: null as any, error: 'Transaction already recorded' };
    }

    const newTxn: InventoryTransaction & { unitCost?: number; totalCost?: number; idempotencyKey: string; bankAccountId?: string } = {
      ...data,
      id: generateId('invtxn'),
      organizationId,
      idempotencyKey,
      bankAccountId: data.bankAccountId,
    } as any;

    const itemIdx = dataStore.inventoryItems.findIndex(i => i.id === data.inventoryItemId);
    if (itemIdx === -1) {
      return { success: false, data: null as any, error: 'Item not found' };
    }

    const item = dataStore.inventoryItems[itemIdx];
    
    // Validate stock
    if (item.currentStock + data.quantity < 0) {
      return {
        success: false,
        data: null as any,
        error: `Insufficient stock: ${item.currentStock} available, ${Math.abs(data.quantity)} requested`,
      };
    }

    // Calculate costs
    if (data.type === 'purchase') {
      newTxn.unitCost = data.unitCost || (data.totalAmount / Math.abs(data.quantity));
      newTxn.totalCost = Math.abs(data.quantity) * (newTxn.unitCost || 0);
    } else if (data.type === 'sale') {
      newTxn.unitCost = item.averageCost;
      newTxn.totalCost = Math.abs(data.quantity) * item.averageCost;
    }

    dataStore.inventoryTransactions.push(newTxn as any);

    const oldStock = item.currentStock;
    dataStore.inventoryItems[itemIdx].currentStock += data.quantity;

    if (data.type === 'purchase' && data.quantity > 0) {
      const unitCost = newTxn.unitCost || 0;
      const totalValue = (item.averageCost * oldStock) + (unitCost * data.quantity);
      const newStock = oldStock + data.quantity;
      dataStore.inventoryItems[itemIdx].averageCost = newStock > 0 ? totalValue / newStock : unitCost;
      dataStore.inventoryItems[itemIdx].lastCost = unitCost;
    }

    // ── NEW: Create corresponding financial transaction in the ledger ──
    if (data.bankAccountId) {
      console.log('[inventoryService] Creating financial transaction for bankAccountId:', data.bankAccountId);
      const bankAccount = dataStore.bankAccounts.find(a => a.id === data.bankAccountId);
      
      if (!bankAccount) {
        console.error('[inventoryService] Bank account not found:', data.bankAccountId);
      } else {
        console.log('[inventoryService] Found bank account:', bankAccount.bankName);
        
        // Create transaction using transaction service to ensure proper balance updates
        const financialTxnData = {
          bankAccountId: data.bankAccountId,
          date: data.date,
          description: `${data.type === 'purchase' ? 'Inventory Purchase' : data.type === 'sale' ? 'Inventory Sale' : 'Inventory Adjustment'} - ${item.name}`,
          narration: `${data.type === 'purchase' ? 'Purchase' : data.type === 'sale' ? 'Sale' : 'Adjustment'}: ${item.name} (${Math.abs(data.quantity)} ${item.unit})${data.referenceNumber ? ` - Ref: ${data.referenceNumber}` : ''}${data.notes ? ` - ${data.notes}` : ''}`,
          amount: data.type === 'purchase' ? -Math.abs(data.totalAmount) : Math.abs(data.totalAmount),
          currency: bankAccount.currency || 'USD',
          type: data.type === 'purchase' ? ('debit' as const) : ('credit' as const),
          categoryId: '', // Category can be set by user later or auto-categorized
          status: 'classified' as const,
          tags: ['inventory', `inv-item:${item.id}`],
          metadata: {
            source: 'inventory',
            inventoryTransactionId: newTxn.id,
            inventoryItemId: item.id,
            inventoryItemName: item.name,
            inventoryItemSku: item.sku,
            quantity: data.quantity,
            unitCost: newTxn.unitCost,
          },
        };

        console.log('[inventoryService] Financial transaction data:', financialTxnData);

        // Use transaction service to create - this handles balance updates automatically
        if (isHttpBackendConfigured()) {
          console.log('[inventoryService] HTTP backend mode - not creating transaction locally');
          // When backend is configured, it will handle the transaction creation
          // via the inventory API which should create the financial transaction server-side
        } else {
          // For local dataStore mode, create the transaction directly
          const financialTxn = {
            id: generateId('txn'),
            organizationId,
            ...financialTxnData,
            attachments: [],
            isReconciled: false,
            createdAt: new Date().toISOString(),
          };

          console.log('[inventoryService] Creating financial transaction:', financialTxn);
          dataStore.transactions.push(financialTxn);
          console.log('[inventoryService] Transaction added to dataStore, total transactions:', dataStore.transactions.length);
          
          // Update bank account balance immediately
          const bankIdx = dataStore.bankAccounts.findIndex(a => a.id === data.bankAccountId);
          if (bankIdx !== -1) {
            const oldBalance = dataStore.bankAccounts[bankIdx].balance;
            dataStore.bankAccounts[bankIdx].balance += financialTxn.amount;
            const newBalance = dataStore.bankAccounts[bankIdx].balance;
            console.log('[inventoryService] Updated bank balance:', oldBalance, '->', newBalance);
          }
          
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');
          console.log('[inventoryService] Notified listeners');
        }
      }
    } else {
      console.warn('[inventoryService] No bankAccountId provided, skipping financial transaction');
    }

    dataStore.notify('inventoryItems');
    dataStore.notify('inventoryTransactions');
    return { success: true, data: newTxn as any, message: 'Transaction recorded' };
  },

  async getTransactions(
    inventoryItemId: string,
    organizationId?: string,
  ): Promise<ServiceResponse<InventoryTransaction[]>> {
    if (isHttpBackendConfigured()) {
      if (organizationId) {
        return apiGet<InventoryTransaction[]>(
          `${ITEMS(organizationId)}/${encodeURIComponent(inventoryItemId)}/transactions`,
        );
      }
      return apiGet<InventoryTransaction[]>(
        `/inventory/items/${encodeURIComponent(inventoryItemId)}/transactions`,
      );
    }

    await simulateDelay();
    const txns = dataStore.inventoryTransactions.filter(t => t.inventoryItemId === inventoryItemId);
    return { success: true, data: txns };
  },

  async getReconciliation(organizationId: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${INV(organizationId)}/reconciliation`);
    }
    return { success: true, data: { isBalanced: true, discrepancy: 0 } };
  },

  /** All inventory transactions for the org (not in §11 table; uses `GET .../inventory/transactions`). */
  async getAllTransactions(organizationId: string): Promise<ServiceResponse<InventoryTransaction[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<InventoryTransaction[]>(organizationId);
      if (err) return err;
      return apiGet<InventoryTransaction[]>(`${INV(organizationId)}/transactions`);
    }

    await simulateDelay();
    const txns = dataStore.inventoryTransactions
      .filter(t => t.organizationId === organizationId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { success: true, data: txns };
  },

  async getLowStockAlerts(organizationId: string): Promise<ServiceResponse<InventoryItem[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<InventoryItem[]>(organizationId);
      if (err) return err;
      return apiGet<InventoryItem[]>(`${INV(organizationId)}/low-stock`);
    }

    await simulateDelay();
    const lowStock = dataStore.inventoryItems.filter(
      i => i.organizationId === organizationId && i.isActive && i.currentStock <= i.reorderLevel,
    );
    return { success: true, data: lowStock };
  },

  async getValuation(organizationId: string): Promise<ServiceResponse<InventoryValuation>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<InventoryValuation>(organizationId);
      if (err) return err;
      return apiGet<InventoryValuation>(`${INV(organizationId)}/valuation`);
    }

    await simulateDelay();
    const items = dataStore.inventoryItems.filter(i => i.organizationId === organizationId && i.isActive);

    const byMethod = new Map<string, { count: number; value: number }>();
    let totalValue = 0;

    for (const item of items) {
      const value = item.currentStock * item.averageCost;
      totalValue += value;
      const existing = byMethod.get(item.costingMethod) || { count: 0, value: 0 };
      byMethod.set(item.costingMethod, { count: existing.count + 1, value: existing.value + value });
    }

    return {
      success: true,
      data: {
        totalItems: items.length,
        totalValue: Math.round(totalValue * 100) / 100,
        byCostingMethod: Array.from(byMethod.entries()).map(([method, data]) => ({
          method,
          ...data,
          value: Math.round(data.value * 100) / 100,
        })),
      },
    };
  },

  /** Get inventory turnover metrics */
  async getTurnover(
    organizationId: string,
    months: number = 12
  ): Promise<ServiceResponse<{
    periodMonths: number;
    cogs: number;
    averageInventory: number;
    turnoverRatio: number | null;
    daysOnHand: number | null;
    hasSufficientHistory: boolean;
    message: string;
  }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg(organizationId);
      if (err) return err as any;
      return apiGet(`${INV(organizationId)}/turnover?months=${months}`);
    }

    await simulateDelay();
    
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);
    
    const salesTxns = dataStore.inventoryTransactions.filter(
      t => t.organizationId === organizationId && 
           t.type === 'sale' && 
           new Date(t.date) >= fromDate
    );
    
    // Calculate COGS
    const cogs = salesTxns.reduce((sum, t) => {
      const unitCost = (t as any).unitCost || 0;
      return sum + (Math.abs(t.quantity) * unitCost);
    }, 0);
    
    // Calculate inventory value
    const items = dataStore.inventoryItems.filter(i => i.organizationId === organizationId && i.isActive);
    const inventoryValue = items.reduce((sum, i) => sum + (i.currentStock * i.averageCost), 0);
    
    const turnoverRatio = inventoryValue > 0 ? Math.round((cogs / inventoryValue) * 100) / 100 : null;
    const daysOnHand = cogs > 0 ? Math.round((inventoryValue / (cogs / (months * 30))) * 10) / 10 : null;
    
    return {
      success: true,
      data: {
        periodMonths: months,
        cogs: Math.round(cogs * 100) / 100,
        averageInventory: Math.round(inventoryValue * 100) / 100,
        turnoverRatio,
        daysOnHand,
        hasSufficientHistory: salesTxns.length >= 3,
        message: salesTxns.length < 3 
          ? 'Insufficient transaction history for accurate calculation'
          : turnoverRatio === null 
            ? 'No inventory value to calculate turnover'
            : 'Calculation complete'
      },
    };
  },

  /** Get reorder suggestions */
  async getReorderSuggestions(
    organizationId: string
  ): Promise<ServiceResponse<Array<{
    itemId: string;
    itemName: string;
    sku: string;
    currentStock: number;
    reorderLevel: number;
    reorderQuantity: number;
    suggestedOrderQty: number;
    daysUntilStockout: number | null;
    priority: 'out_of_stock' | 'critical' | 'high' | 'medium' | 'low';
  }>>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg(organizationId);
      if (err) return err as any;
      return apiGet(`${INV(organizationId)}/reorder-suggestions`);
    }

    await simulateDelay();
    
    const lowStockItems = dataStore.inventoryItems.filter(
      i => i.organizationId === organizationId && i.isActive && i.currentStock <= i.reorderLevel
    );
    
    const suggestions = lowStockItems.map(item => {
      // Calculate average daily sales from last 90 days
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 90);
      
      const recentSales = dataStore.inventoryTransactions.filter(
        t => t.organizationId === organizationId &&
             t.inventoryItemId === item.id &&
             t.type === 'sale' &&
             new Date(t.date) >= fromDate
      );
      
      const totalSold = recentSales.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
      const avgDailySales = recentSales.length > 0 ? totalSold / 90 : 0;
      const suggestedQty = Math.max(
        item.reorderQuantity,
        Math.ceil(avgDailySales * 30)
      );
      
      const daysUntilStockout = avgDailySales > 0 ? item.currentStock / avgDailySales : null;
      
      let priority: 'out_of_stock' | 'critical' | 'high' | 'medium' | 'low';
      if (item.currentStock <= 0) {
        priority = 'out_of_stock';
      } else if (daysUntilStockout && daysUntilStockout < 7) {
        priority = 'critical';
      } else if (daysUntilStockout && daysUntilStockout < 14) {
        priority = 'high';
      } else if (item.currentStock <= item.reorderLevel) {
        priority = 'medium';
      } else {
        priority = 'low';
      }
      
      return {
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        currentStock: item.currentStock,
        reorderLevel: item.reorderLevel,
        reorderQuantity: item.reorderQuantity,
        suggestedOrderQty: suggestedQty,
        daysUntilStockout,
        priority,
      };
    });
    
    // Sort by priority
    const priorityOrder = { out_of_stock: 0, critical: 1, high: 2, medium: 3, low: 4 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    
    return { success: true, data: suggestions };
  },
};
