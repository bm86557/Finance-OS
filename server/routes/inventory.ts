/**
 * §11 — Inventory. Mounted at `/organizations/:organizationId/inventory` (mergeParams).
 * 
 * SECURITY: All endpoints filter by organizationId to prevent cross-tenant access.
 * Implements idempotency, validation, and cost tracking for production readiness.
 * Uses Supabase database for persistent storage.
 */

import { Router, type Request, type Response } from 'express';
import type { InventoryItem, InventoryTransaction } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

/** Map a Supabase inventory_items row to the camelCase domain shape used by the frontend. */
function mapDbToDomainItem(item: any): InventoryItem {
  return {
    id: item.id,
    organizationId: item.organization_id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    category: item.category,
    unit: item.unit,
    costingMethod: item.costing_method,
    currentStock: Number(item.current_stock || 0),
    reorderLevel: Number(item.reorder_level || 0),
    reorderQuantity: Number(item.reorder_quantity || 0),
    averageCost: Number(item.average_cost || 0),
    lastCost: Number(item.last_cost || 0),
    sellingPrice: Number(item.selling_price || 0),
    assetAccountId: item.asset_account_id,
    cogsAccountId: item.cogs_account_id,
    isActive: item.is_active,
    negativeStockPolicy: item.negative_stock_policy || 'disallow',
  } as InventoryItem;
}

/** Check if idempotency key was already used (prevents duplicate transactions) */

/** Validate stock level change */
function validateStock(
  item: InventoryItem,
  quantityChange: number
): { valid: boolean; error?: string } {
  const newStock = item.currentStock + quantityChange;
  if (newStock < 0) {
    return {
      valid: false,
      error: `Insufficient stock for ${item.name} (SKU: ${item.sku}). Available: ${item.currentStock}, Requested: ${Math.abs(quantityChange)}`
    };
  }
  if (quantityChange === 0) {
    return { valid: false, error: 'Quantity cannot be zero' };
  }
  return { valid: true };
}

export function createInventoryRouter(): Router {
  const r = Router({ mergeParams: true });

  r.get('/low-stock', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (error) return fail(res, 500, error.message);
    const lowStock = (data || []).filter((i: any) => Number(i.current_stock || 0) <= Number(i.reorder_level || 0));
    return ok(res, lowStock.map(mapDbToDomainItem));
  });

  r.get('/valuation', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (error) return fail(res, 500, error.message);
    const items = (data || []).map(mapDbToDomainItem);
    const byMethod = new Map<string, { count: number; value: number }>();
    let totalValue = 0;
    for (const item of items) {
      const value = item.currentStock * item.averageCost;
      totalValue += value;
      const cur = byMethod.get(item.costingMethod) ?? { count: 0, value: 0 };
      byMethod.set(item.costingMethod, { count: cur.count + 1, value: cur.value + value });
    }
    return ok(res, {
      totalValue: Math.round(totalValue * 100) / 100,
      itemCount: items.length,
      byCostingMethod: Object.fromEntries(byMethod),
    });
  });

  // GET /reconciliation — Reconcile physical inventory valuation with financial records (§15)
  r.get('/reconciliation', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const [{ data: items, error: iErr }, { data: accounts, error: aErr }] = await Promise.all([
      sb.from('inventory_items').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('accounts').select('*').eq('organization_id', orgId).eq('type', 'asset'),
    ]);

    if (iErr) return fail(res, 500, iErr.message);

    const physicalValuation = (items || []).reduce((sum: number, it: any) => {
      return sum + (Number(it.current_stock || 0) * Number(it.average_cost || 0));
    }, 0);

    const roundedValuation = Math.round(physicalValuation * 100) / 100;

    const inventoryAccounts = (accounts || []).filter((a: any) => {
      const name = String(a.name || '').toLowerCase();
      return name.includes('inventory') || name.includes('stock');
    });

    const recordedGlBalance = inventoryAccounts.reduce((sum: number, a: any) => sum + Number(a.balance || 0), 0);
    const discrepancy = Math.round(Math.abs(roundedValuation - recordedGlBalance) * 100) / 100;
    const isBalanced = discrepancy < 0.05;

    // Log reconciliation check
    try {
      await sb.from('reconciliation_logs').insert({
        id: `recon-inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        organization_id: orgId,
        reconciliation_type: 'inventory_valuation',
        status: isBalanced ? 'balanced' : 'variance_detected',
        discrepancy_amount: discrepancy,
        details: {
          physicalValuation: roundedValuation,
          recordedGlBalance,
          discrepancy,
          itemCount: (items || []).length,
        },
      });
    } catch {
      // Ignore non-fatal log insert
    }

    return ok(res, {
      physicalValuation: roundedValuation,
      recordedGlBalance,
      discrepancy,
      isBalanced,
      inventoryAccounts: inventoryAccounts.map((a: any) => ({
        id: a.id,
        name: a.name,
        balance: Number(a.balance || 0),
      })),
      checkedAt: new Date().toISOString(),
    });
  });

  r.get('/transactions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const supabase = getSupabaseAdminClient();

    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('inventory_transactions')
          .select('*')
          .eq('organization_id', orgId)
          .order('date', { ascending: false });

        if (error) throw error;

        console.log('[inventory] GET /transactions - Supabase returned:', data?.length, 'transactions');

        // Transform snake_case to camelCase for frontend
        const txns = (data || []).map((txn: any) => ({
          id: txn.id,
          organizationId: txn.organization_id,
          inventoryItemId: txn.inventory_item_id,
          date: txn.date,
          type: txn.type,
          quantity: txn.quantity,
          unitCost: txn.unit_cost,
          totalAmount: txn.total_amount,
          totalCost: txn.total_cost,
          referenceNumber: txn.reference_number,
          notes: txn.notes,
          departmentId: txn.department_id,
          projectId: txn.project_id,
          idempotencyKey: txn.idempotency_key,
          bankAccountId: txn.bank_account_id,
        }));

        console.log('[inventory] GET /transactions - Transformed:', txns.length, 'transactions');

        return ok(res, txns);
      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[inventory] Error in GET /transactions:', error);
      return fail(res, 500, 'Failed to load inventory transactions');
    }
  });

  r.post('/transactions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<InventoryTransaction, 'id' | 'organizationId'> & { bankAccountId?: string };
    const supabase = getSupabaseAdminClient();

    // IDEMPOTENCY: Check for duplicate submission
    const idempotencyKey = (data as any).idempotencyKey || req.headers['idempotency-key'] as string;
    if (!idempotencyKey) {
      return fail(res, 'Idempotency key required. Provide idempotencyKey in body or Idempotency-Key header.', 400);
    }

    try {
      // Use Supabase if configured, otherwise fallback to local store
      if (supabase) {
        // Check idempotency using Supabase
        const { data: existingTxn } = await supabase
          .from('inventory_transactions')
          .select('id')
          .eq('organization_id', orgId)
          .eq('idempotency_key', idempotencyKey)
          .single();

        if (existingTxn) {
          return fail(res, 'Transaction already recorded with this idempotency key', 409);
        }

        // Get inventory item from Supabase
        const { data: item, error: itemError } = await supabase
          .from('inventory_items')
          .select('*')
          .eq('id', data.inventoryItemId)
          .eq('organization_id', orgId)
          .single();

        if (itemError || !item) {
          return notFound(res, 'Inventory item not found in this organization');
        }

        // VALIDATION: Check stock levels against negative stock policy
        const policy = item.negative_stock_policy || 'disallow';
        const newStock = item.current_stock + data.quantity;
        if (newStock < 0 && policy === 'disallow') {
          return fail(res, `Insufficient stock for ${item.name} (SKU: ${item.sku}). Available: ${item.current_stock}, Requested: ${Math.abs(data.quantity)}`, 400);
        }

        if (data.quantity === 0) {
          return fail(res, 'Quantity cannot be zero', 400);
        }

        // VALIDATION: Ensure required fields
        if (!data.type || !['purchase', 'sale', 'adjustment', 'transfer', 'write_off'].includes(data.type)) {
          return fail(res, 'Invalid transaction type', 400);
        }

        // VALIDATION: Verify bank account if provided
        if (data.bankAccountId) {
          const { data: bankAccount, error: bankError } = await supabase
            .from('bank_accounts')
            .select('id, bank_name, currency, balance')
            .eq('id', data.bankAccountId)
            .eq('organization_id', orgId)
            .single();

          if (bankError || !bankAccount) {
            return fail(res, 'Bank account not found in this organization', 400);
          }
        }

        // COST TRACKING: Calculate unit cost and total cost with FIFO or weighted average
        let unitCost = (data as any).unitCost || 0;
        let totalCost = 0;

        if (data.type === 'purchase') {
          unitCost = (data as any).unitCost || (data.totalAmount / Math.abs(data.quantity));
          totalCost = Math.abs(data.quantity) * unitCost;

          // Record FIFO layer
          try {
            await supabase.from('inventory_layers').insert({
              id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              organization_id: orgId,
              inventory_item_id: data.inventoryItemId,
              purchase_date: data.date,
              quantity_received: Math.abs(data.quantity),
              quantity_remaining: Math.abs(data.quantity),
              unit_cost: unitCost,
            });
          } catch (lErr) {
            console.warn('[inventory] Could not insert FIFO layer:', lErr);
          }
        } else if (data.type === 'sale') {
          if (item.costing_method === 'fifo') {
            // Deplete FIFO layers
            let fifoCost = 0;
            let qtyToDeplete = Math.abs(data.quantity);
            const { data: layers } = await supabase
              .from('inventory_layers')
              .select('*')
              .eq('inventory_item_id', data.inventoryItemId)
              .gt('quantity_remaining', 0)
              .order('purchase_date', { ascending: true });

            if (layers && layers.length > 0) {
              for (const layer of layers) {
                if (qtyToDeplete <= 0) break;
                const available = Number(layer.quantity_remaining);
                const take = Math.min(qtyToDeplete, available);
                fifoCost += take * Number(layer.unit_cost);
                qtyToDeplete -= take;
                await supabase
                  .from('inventory_layers')
                  .update({ quantity_remaining: available - take })
                  .eq('id', layer.id);
              }
            }
            totalCost = fifoCost > 0 ? Math.round(fifoCost * 100) / 100 : Math.abs(data.quantity) * Number(item.average_cost || 0);
            unitCost = Math.abs(data.quantity) > 0 ? Math.round((totalCost / Math.abs(data.quantity)) * 100) / 100 : item.average_cost;
          } else {
            unitCost = item.average_cost;
            totalCost = Math.abs(data.quantity) * unitCost;
          }
        } else if (data.type === 'write_off') {
          unitCost = item.average_cost;
          totalCost = Math.abs(data.quantity) * unitCost;

          // Post non-cash write-off expense transaction into ledger
          try {
            const writeOffTxnId = `txn-writeoff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await supabase.from('transactions').insert([{
              id: writeOffTxnId,
              organization_id: orgId,
              date: data.date,
              description: `Inventory Write-Off - ${item.name}`,
              narration: `Inventory write-off of ${Math.abs(data.quantity)} ${item.unit} (${item.name}). Reason: ${data.notes || 'Spoilage/Damage/Loss'}. Recognized COGS/loss: ${totalCost.toFixed(2)}`,
              amount: totalCost,
              currency: 'USD',
              type: 'debit',
              status: 'reconciled',
              tags: ['inventory-write-off', 'cogs', 'non-cash-expense', `inv-item:${item.id}`, 'business'],
              created_at: new Date().toISOString(),
            }]);
          } catch (wErr) {
            console.warn('[inventory] Write-off transaction insert error:', wErr);
          }
        } else {
          unitCost = (data as any).unitCost || item.average_cost;
          totalCost = Math.abs(data.quantity) * unitCost;
        }

        // Insert inventory transaction into Supabase
        const { data: newTxn, error: txnError } = await supabase
          .from('inventory_transactions')
          .insert({
            organization_id: orgId,
            inventory_item_id: data.inventoryItemId,
            date: data.date,
            type: data.type,
            quantity: data.quantity,
            unit_cost: unitCost,
            total_cost: totalCost,
            total_amount: data.totalAmount,
            reference_number: data.referenceNumber || null,
            notes: data.notes || null,
            idempotency_key: idempotencyKey,
            bank_account_id: data.bankAccountId || null,
          })
          .select()
          .single();

        if (txnError || !newTxn) {
          console.error('[inventory] Failed to create inventory transaction:', txnError);
          return fail(res, 'Failed to create inventory transaction: ' + txnError?.message, 500);
        }

        // Update inventory item stock and cost
        const oldStock = item.current_stock;
        const newStockValue = oldStock + data.quantity;

        let newAverageCost = item.average_cost;
        let newLastCost = item.last_cost;

        if (data.type === 'purchase' && data.quantity > 0) {
          const totalValue = (item.average_cost * oldStock) + (unitCost * data.quantity);
          newAverageCost = newStockValue > 0 ? totalValue / newStockValue : unitCost;
          newLastCost = unitCost;
        }

        const { error: updateError } = await supabase
          .from('inventory_items')
          .update({
            current_stock: newStockValue,
            average_cost: newAverageCost,
            last_cost: newLastCost,
          })
          .eq('id', data.inventoryItemId);

        if (updateError) {
          console.error('[inventory] Failed to update inventory item:', updateError);
          return fail(res, 'Failed to update inventory item: ' + updateError.message, 500);
        }

        // ── Create corresponding financial transaction in Supabase ──
        if (data.bankAccountId) {
          console.log('[inventory] 🔍 Attempting to create financial transaction for bankAccountId:', data.bankAccountId);

          const { data: bankAccount, error: bankAcctError } = await supabase
            .from('bank_accounts')
            .select('currency, balance')
            .eq('id', data.bankAccountId)
            .single();

          if (bankAcctError || !bankAccount) {
            console.error('[inventory] ❌ Bank account not found:', bankAcctError);
            return fail(res, 'Bank account not found: ' + bankAcctError?.message, 400);
          }

          console.log('[inventory] ✅ Found bank account, balance:', bankAccount.balance);

          const amount = data.type === 'purchase' ? -Math.abs(data.totalAmount) : Math.abs(data.totalAmount);

          // Insert financial transaction
          const { data: financialTxn, error: finTxnError } = await supabase
            .from('transactions')
            .insert({
              organization_id: orgId,
              bank_account_id: data.bankAccountId,
              date: data.date,
              description: `${data.type === 'purchase' ? 'Inventory Purchase' : data.type === 'sale' ? 'Inventory Sale' : 'Inventory Adjustment'} - ${item.name}`,
              narration: `${data.type === 'purchase' ? 'Purchase' : data.type === 'sale' ? 'Sale' : 'Adjustment'}: ${item.name} (${Math.abs(data.quantity)} ${item.unit})${data.referenceNumber ? ` - Ref: ${data.referenceNumber}` : ''}${data.notes ? ` - ${data.notes}` : ''}`,
              amount: amount,
              currency: bankAccount.currency || 'USD',
              type: data.type === 'purchase' ? 'debit' : 'credit',
              category_id: null,
              status: 'classified', // Use 'classified' instead of 'completed'
              tags: ['inventory', `inv-item:${item.id}`],
              // Note: metadata is not a column in the schema, removed
            })
            .select()
            .single();

          if (finTxnError) {
            console.error('[inventory] ❌ Failed to create financial transaction:', finTxnError);
            return fail(res, 'Failed to create financial transaction: ' + finTxnError.message, 500);
          }

          console.log(`[inventory] ✅ Created financial transaction ${financialTxn.id} for inventory ${data.type}`);

          // Update bank account balance
          const newBalance = Math.round((bankAccount.balance + amount) * 100) / 100;
          const { error: balanceError } = await supabase
            .from('bank_accounts')
            .update({ balance: newBalance, current_balance: newBalance })
            .eq('id', data.bankAccountId);

          if (balanceError) {
            console.error('[inventory] ❌ Failed to update bank balance:', balanceError);
            return fail(res, 'Failed to update bank balance: ' + balanceError.message, 500);
          }

          console.log(`[inventory] ✅ Updated bank account balance: ${bankAccount.balance} → ${newBalance}`);
        } else {
          console.log('[inventory] ⚠️  No bankAccountId provided, skipping financial transaction');
        }

        return created(res, newTxn, 'Transaction recorded');

      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[inventory] Error in POST /transactions:', error);
      return fail(res, 'Internal server error: ' + (error as Error).message, 500);
    }
  });

  r.get('/items/:itemId/transactions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : (req.params.itemId ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    // SECURITY: Verify item belongs to organization
    const { data: item, error: itemErr } = await sb
      .from('inventory_items')
      .select('id')
      .eq('id', itemId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (itemErr) return fail(res, 500, itemErr.message);
    if (!item) return notFound(res, 'Item not found in this organization');

    const { data, error } = await sb
      .from('inventory_transactions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('inventory_item_id', itemId)
      .order('date', { ascending: false });
    if (error) return fail(res, 500, error.message);

    return ok(res, (data || []).map((txn: any) => ({
      id: txn.id,
      organizationId: txn.organization_id,
      inventoryItemId: txn.inventory_item_id,
      date: txn.date,
      type: txn.type,
      quantity: txn.quantity,
      unitCost: txn.unit_cost,
      totalAmount: txn.total_amount,
      totalCost: txn.total_cost,
      referenceNumber: txn.reference_number,
      notes: txn.notes,
      idempotencyKey: txn.idempotency_key,
      bankAccountId: txn.bank_account_id,
    })));
  });

  r.get('/items/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    // SECURITY: Filter by organization
    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Item not found in this organization');
    return ok(res, mapDbToDomainItem(data));
  });
  r.get('/items', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const supabase = getSupabaseAdminClient();

    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('inventory_items')
          .select('*')
          .eq('organization_id', orgId);

        if (error) throw error;

        console.log('[inventory] GET /items - Supabase returned:', data?.length, 'items');

        // Transform snake_case to camelCase for frontend
        const items = (data || []).map((item: any) => ({
          id: item.id,
          organizationId: item.organization_id,
          sku: item.sku,
          name: item.name,
          description: item.description,
          category: item.category,
          unit: item.unit,
          costingMethod: item.costing_method,
          currentStock: item.current_stock,
          reorderLevel: item.reorder_level,
          reorderQuantity: item.reorder_quantity,
          averageCost: item.average_cost,
          lastCost: item.last_cost,
          sellingPrice: item.selling_price,
          assetAccountId: item.asset_account_id,
          cogsAccountId: item.cogs_account_id,
          isActive: item.is_active,
        }));

        console.log('[inventory] GET /items - Transformed:', items);

        return ok(res, items);
      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[inventory] Error in GET /items:', error);
      return fail(res, 500, 'Failed to load inventory items');
    }
  });

  r.post('/items', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<InventoryItem, 'id' | 'organizationId'>;
    const supabase = getSupabaseAdminClient();

    // VALIDATION: Required fields
    if (!data.sku || !data.name) {
      return fail(res, 'SKU and name are required', 400);
    }

    // VALIDATION: Support both weighted_average and fifo per Handoff §15.5
    if (data.costingMethod && !['weighted_average', 'fifo'].includes(data.costingMethod)) {
      return fail(res,
        `Costing method '${data.costingMethod}' is not supported. Supported methods are 'weighted_average' and 'fifo'.`,
        400
      );
    }

    try {
      if (supabase) {
        // Check for duplicate SKU in same organization
        const { data: existingItem } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('organization_id', orgId)
          .ilike('sku', data.sku)
          .eq('is_active', true)
          .single();

        if (existingItem) {
          return fail(res, `Item with SKU '${data.sku}' already exists`, 409);
        }

        // Insert new item - Supabase will auto-generate id
        const { data: newItem, error } = await supabase
          .from('inventory_items')
          .insert({
            organization_id: orgId,
            sku: data.sku,
            name: data.name,
            description: data.description || null,
            category: data.category || '',
            unit: data.unit || 'unit',
            costing_method: data.costingMethod || 'weighted_average',
            current_stock: data.currentStock || 0,
            reorder_level: data.reorderLevel || 0,
            reorder_quantity: data.reorderQuantity || 0,
            average_cost: data.averageCost || 0,
            last_cost: data.lastCost || 0,
            selling_price: data.sellingPrice || 0,
            asset_account_id: data.assetAccountId || null,
            cogs_account_id: data.cogsAccountId || null,
            is_active: true,
          })
          .select()
          .single();

        if (error) throw error;

        console.log('[inventory] ✅ Created item in Supabase:', newItem.id);
        return created(res, newItem, 'Inventory item created');

      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[inventory] Error in POST /items:', error);
      return fail(res, 'Failed to create inventory item: ' + (error as Error).message, 500);
    }
  });

  r.patch('/items/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const b = (req.body || {}) as Partial<InventoryItem>;
    if (b.costingMethod && !['weighted_average', 'fifo'].includes(b.costingMethod)) {
      return fail(res, `Costing method '${b.costingMethod}' is not supported. Supported methods are 'weighted_average' and 'fifo'.`, 400);
    }

    const update: Record<string, unknown> = {};
    if (b.sku !== undefined) update.sku = b.sku;
    if (b.name !== undefined) update.name = b.name;
    if (b.description !== undefined) update.description = b.description || null;
    if (b.category !== undefined) update.category = b.category;
    if (b.unit !== undefined) update.unit = b.unit;
    if (b.costingMethod !== undefined) update.costing_method = b.costingMethod;
    if (b.reorderLevel !== undefined) update.reorder_level = b.reorderLevel;
    if (b.reorderQuantity !== undefined) update.reorder_quantity = b.reorderQuantity;
    if (b.sellingPrice !== undefined) update.selling_price = b.sellingPrice;
    if (b.assetAccountId !== undefined) update.asset_account_id = b.assetAccountId || null;
    if (b.cogsAccountId !== undefined) update.cogs_account_id = b.cogsAccountId || null;
    if (b.isActive !== undefined) update.is_active = b.isActive;
    // Stock levels and costs change only through inventory transactions.

    if (Object.keys(update).length === 0) return fail(res, 'No updatable fields provided', 400);

    // SECURITY: Filter by organization
    const { data, error } = await sb
      .from('inventory_items')
      .update(update)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Item not found in this organization');
    return ok(res, mapDbToDomainItem(data));
  });

  // DELETE endpoint for soft delete
  r.delete('/items/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('inventory_items')
      .update({ is_active: false })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id')
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Item not found in this organization');
    return ok(res, { id }, 'Item deactivated');
  });

  // Reorder suggestions endpoint
  r.get('/reorder-suggestions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);
    if (error) return fail(res, 500, error.message);

    const suggestions = (data || [])
      .filter((i: any) => Number(i.current_stock || 0) <= Number(i.reorder_level || 0))
      .map((i: any) => {
        const item = mapDbToDomainItem(i);
        const suggestedQty = Math.max(item.reorderQuantity || 0, (item.reorderLevel || 0) - item.currentStock);
        return { item, suggestedQuantity: suggestedQty, estimatedCost: suggestedQty * (item.lastCost || item.averageCost || 0) };
      });
    return ok(res, suggestions);
  });

  // Inventory turnover endpoint: COGS (sales at cost) / average inventory value over the period
  r.get('/turnover', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const months = Number(req.query.months) || 12;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);
    const from = fromDate.toISOString().slice(0, 10);

    const [salesRes, itemsRes] = await Promise.all([
      sb.from('inventory_transactions').select('total_cost').eq('organization_id', orgId).eq('type', 'sale').gte('date', from),
      sb.from('inventory_items').select('current_stock, average_cost').eq('organization_id', orgId).eq('is_active', true),
    ]);
    if (salesRes.error) return fail(res, 500, salesRes.error.message);
    if (itemsRes.error) return fail(res, 500, itemsRes.error.message);

    const cogs = (salesRes.data || []).reduce((s: number, t: any) => s + Math.abs(Number(t.total_cost || 0)), 0);
    const inventoryValue = (itemsRes.data || []).reduce((s: number, i: any) => s + Number(i.current_stock || 0) * Number(i.average_cost || 0), 0);
    const turnoverRatio = inventoryValue > 0 ? cogs / inventoryValue : 0;
    return ok(res, {
      periodMonths: months,
      cogs: Math.round(cogs * 100) / 100,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      turnoverRatio: Math.round(turnoverRatio * 100) / 100,
      daysInventoryOutstanding: turnoverRatio > 0 ? Math.round((months * 30) / turnoverRatio) : null,
    });
  });
  return r;
}
