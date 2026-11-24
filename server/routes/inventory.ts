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
import { requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { postBalancedJournalEntry, resolveGlAccountId, resolveOrgCurrency } from '../lib/ledgerService.js';

const VALID_NEGATIVE_STOCK_POLICIES = new Set(['disallow', 'warn', 'allow_with_backorder']);

function computeItemValuation(
  item: { id: string; costingMethod?: string; costing_method?: string; currentStock?: number; current_stock?: number; averageCost?: number; average_cost?: number },
  layersByItem: Map<string, Array<{ quantity_remaining: number; unit_cost: number }>>,
): number {
  const method = item.costingMethod ?? item.costing_method ?? 'weighted_average';
  const stock = Number(item.currentStock ?? item.current_stock ?? 0);
  const avg = Number(item.averageCost ?? item.average_cost ?? 0);
  if (method === 'fifo') {
    const layers = layersByItem.get(item.id);
    if (layers && layers.length > 0) {
      return layers.reduce((s, l) => s + Number(l.quantity_remaining || 0) * Number(l.unit_cost || 0), 0);
    }
  }
  return stock * avg;
}

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

    const [{ data, error }, { data: layerRows }] = await Promise.all([
      sb.from('inventory_items').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('inventory_layers').select('inventory_item_id, quantity_remaining, unit_cost').eq('organization_id', orgId).gt('quantity_remaining', 0),
    ]);

    if (error) return fail(res, 500, error.message);
    const layersByItem = new Map<string, Array<{ quantity_remaining: number; unit_cost: number }>>();
    for (const l of layerRows || []) {
      const key = String((l as any).inventory_item_id);
      const arr = layersByItem.get(key) || [];
      arr.push({ quantity_remaining: Number((l as any).quantity_remaining || 0), unit_cost: Number((l as any).unit_cost || 0) });
      layersByItem.set(key, arr);
    }

    const items = (data || []).map(mapDbToDomainItem);
    const byMethod = new Map<string, { count: number; value: number }>();
    let totalValue = 0;
    for (const item of items) {
      const value = computeItemValuation(item, layersByItem);
      totalValue += value;
      const cur = byMethod.get(item.costingMethod) ?? { count: 0, value: 0 };
      byMethod.set(item.costingMethod, { count: cur.count + 1, value: Math.round((cur.value + value) * 100) / 100 });
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

    const [{ data: items, error: iErr }, { data: accounts }, { data: layerRows }] = await Promise.all([
      sb.from('inventory_items').select('*').eq('organization_id', orgId).eq('is_active', true),
      sb.from('accounts').select('*').eq('organization_id', orgId).eq('type', 'asset'),
      sb.from('inventory_layers').select('inventory_item_id, quantity_remaining, unit_cost').eq('organization_id', orgId).gt('quantity_remaining', 0),
    ]);

    if (iErr) return fail(res, 500, iErr.message);

    const layersByItem = new Map<string, Array<{ quantity_remaining: number; unit_cost: number }>>();
    for (const l of layerRows || []) {
      const key = String((l as any).inventory_item_id);
      const arr = layersByItem.get(key) || [];
      arr.push({ quantity_remaining: Number((l as any).quantity_remaining || 0), unit_cost: Number((l as any).unit_cost || 0) });
      layersByItem.set(key, arr);
    }

    const physicalValuation = (items || []).reduce((sum: number, it: any) => {
      return sum + computeItemValuation(it, layersByItem);
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

  r.post('/transactions', requirePermission('finance:post_ledger'), async (req: Request, res: Response) => {
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
            // Deplete FIFO layers (strictly org-scoped)
            let fifoCost = 0;
            let qtyToDeplete = Math.abs(data.quantity);
            const { data: layers } = await supabase
              .from('inventory_layers')
              .select('*')
              .eq('organization_id', orgId)
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
                  .eq('id', layer.id)
                  .eq('organization_id', orgId);
              }
            }
            totalCost = fifoCost > 0 ? Math.round(fifoCost * 100) / 100 : Math.abs(data.quantity) * Number(item.average_cost || 0);
            unitCost = Math.abs(data.quantity) > 0 ? Math.round((totalCost / Math.abs(data.quantity)) * 100) / 100 : item.average_cost;
          } else {
            unitCost = item.average_cost;
            totalCost = Math.abs(data.quantity) * unitCost;
          }
        } else if (data.type === 'write_off') {
          if (item.costing_method === 'fifo') {
            let fifoCost = 0;
            let qtyToDeplete = Math.abs(data.quantity);
            const { data: layers } = await supabase
              .from('inventory_layers')
              .select('*')
              .eq('organization_id', orgId)
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
                  .eq('id', layer.id)
                  .eq('organization_id', orgId);
              }
            }
            totalCost = fifoCost > 0 ? Math.round(fifoCost * 100) / 100 : Math.abs(data.quantity) * Number(item.average_cost || 0);
            unitCost = Math.abs(data.quantity) > 0 ? Math.round((totalCost / Math.abs(data.quantity)) * 100) / 100 : item.average_cost;
          } else {
            unitCost = item.average_cost;
            totalCost = Math.abs(data.quantity) * unitCost;
          }

          // Post non-cash write-off expense transaction into ledger using org currency (§8, §15)
          try {
            const orgCurrency = await resolveOrgCurrency(supabase, orgId);
            const writeOffTxnId = `txn-writeoff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await supabase.from('transactions').insert([{
              id: writeOffTxnId,
              organization_id: orgId,
              date: data.date,
              description: `Inventory Write-Off - ${item.name}`,
              narration: `Inventory write-off of ${Math.abs(data.quantity)} ${item.unit} (${item.name}). Reason: ${data.notes || 'Spoilage/Damage/Loss'}. Recognized COGS/loss: ${totalCost.toFixed(2)}`,
              amount: totalCost,
              currency: orgCurrency,
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
          .eq('id', data.inventoryItemId)
          .eq('organization_id', orgId);

        if (updateError) {
          console.error('[inventory] Failed to update inventory item:', updateError);
          return fail(res, 500, 'Failed to update inventory item: ' + updateError.message);
        }

        // ── Post balanced double-entry GL journal for inventory movement (§8, §15) ──
        // Note: Inventory movement is NOT automatically the same as cash payment.
        // Without a bankAccountId, purchase credits Accounts Payable rather than Bank/Cash.
        try {
          const orgCurrency = await resolveOrgCurrency(supabase, orgId);
          const invAssetGlId = item.asset_account_id || (await resolveGlAccountId(supabase, orgId, 'asset', ['inventory', 'stock']));
          const cogsGlId = item.cogs_account_id || (await resolveGlAccountId(supabase, orgId, 'expense', ['cogs', 'cost of goods', 'inventory']));

          if (data.type === 'purchase' && totalCost > 0) {
            let creditGlId: string;
            if (data.bankAccountId) {
              const { data: ba } = await supabase
                .from('bank_accounts')
                .select('account_id')
                .eq('id', data.bankAccountId)
                .eq('organization_id', orgId)
                .maybeSingle();
              creditGlId = ba?.account_id || (await resolveGlAccountId(supabase, orgId, 'asset', ['bank_account', 'cash']));
            } else {
              creditGlId = await resolveGlAccountId(supabase, orgId, 'liability', ['payable', 'accounts_payable']);
            }
            await postBalancedJournalEntry(supabase, {
              organizationId: orgId,
              entryDate: data.date,
              description: `Inventory Purchase - ${item.name} (${Math.abs(data.quantity)} ${item.unit})`,
              sourceType: 'inventory_purchase',
              sourceId: String(newTxn.id),
              currency: orgCurrency,
              actorUserId: req.authUser?.id || null,
              entryPrefix: 'INVP',
              lines: [
                { accountId: invAssetGlId, debit: totalCost, credit: 0, description: `Inventory received - ${item.name}` },
                { accountId: creditGlId, bankAccountId: data.bankAccountId || null, debit: 0, credit: totalCost, description: data.bankAccountId ? `Bank payment for ${item.name}` : `Accounts payable for ${item.name}` },
              ],
            });
          } else if ((data.type === 'sale' || data.type === 'write_off') && totalCost > 0) {
            await postBalancedJournalEntry(supabase, {
              organizationId: orgId,
              entryDate: data.date,
              description: `${data.type === 'sale' ? 'Inventory COGS' : 'Inventory Write-Off'} - ${item.name} (${Math.abs(data.quantity)} ${item.unit})`,
              sourceType: data.type === 'sale' ? 'inventory_cogs' : 'inventory_write_off',
              sourceId: String(newTxn.id),
              currency: orgCurrency,
              actorUserId: req.authUser?.id || null,
              entryPrefix: data.type === 'sale' ? 'COGS' : 'INVW',
              lines: [
                { accountId: cogsGlId, debit: totalCost, credit: 0, description: `${data.type === 'sale' ? 'COGS recognized' : 'Write-off loss'} - ${item.name}` },
                { accountId: invAssetGlId, debit: 0, credit: totalCost, description: `Inventory relieved - ${item.name}` },
              ],
            });
          }
        } catch (jeErr) {
          console.warn('[inventory] Non-fatal journal posting warning:', jeErr);
        }

        // ── Create corresponding financial transaction in Supabase (only when paid/settled via bankAccountId) ──
        if (data.bankAccountId) {
          console.log('[inventory] 🔍 Attempting to create financial transaction for bankAccountId:', data.bankAccountId);

          const { data: bankAccount, error: bankAcctError } = await supabase
            .from('bank_accounts')
            .select('currency, balance')
            .eq('id', data.bankAccountId)
            .eq('organization_id', orgId)
            .single();

          if (bankAcctError || !bankAccount) {
            console.error('[inventory] ❌ Bank account not found:', bankAcctError);
            return fail(res, 400, 'Bank account not found: ' + bankAcctError?.message);
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
            return fail(res, 500, 'Failed to create financial transaction: ' + finTxnError.message);
          }

          console.log(`[inventory] ✅ Created financial transaction ${financialTxn.id} for inventory ${data.type}`);

          // Update bank account balance
          const newBalance = Math.round((bankAccount.balance + amount) * 100) / 100;
          const { error: balanceError } = await supabase
            .from('bank_accounts')
            .update({ balance: newBalance, current_balance: newBalance })
            .eq('id', data.bankAccountId)
            .eq('organization_id', orgId);

          if (balanceError) {
            console.error('[inventory] ❌ Failed to update bank balance:', balanceError);
            return fail(res, 500, 'Failed to update bank balance: ' + balanceError.message);
          }

          console.log(`[inventory] ✅ Updated bank account balance: ${bankAccount.balance} → ${newBalance}`);
        } else {
          console.log('[inventory] ⚠️  No bankAccountId provided, skipping financial transaction');
        }

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'record_inventory_movement',
          entityType: 'inventory_transaction',
          entityId: String(newTxn.id),
          description: `Recorded inventory ${data.type} for ${item.name} (qty: ${data.quantity}, cost: ${totalCost})`,
          afterState: newTxn,
        }).catch(() => {});

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

        // Transform snake_case to camelCase for frontend (includes negativeStockPolicy)
        const items = (data || []).map(mapDbToDomainItem);

        return ok(res, items);
      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[inventory] Error in GET /items:', error);
      return fail(res, 500, 'Failed to load inventory items');
    }
  });

  r.post('/items', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Omit<InventoryItem, 'id' | 'organizationId'>;
    const supabase = getSupabaseAdminClient();

    // VALIDATION: Required fields
    if (!data.sku || !data.name) {
      return fail(res, 400, 'SKU and name are required');
    }

    // VALIDATION: Support both weighted_average and fifo per Handoff §15.5
    if (data.costingMethod && !['weighted_average', 'fifo'].includes(data.costingMethod)) {
      return fail(
        res,
        400,
        `Costing method '${data.costingMethod}' is not supported. Supported methods are 'weighted_average' and 'fifo'.`,
      );
    }
    if (data.negativeStockPolicy && !VALID_NEGATIVE_STOCK_POLICIES.has(data.negativeStockPolicy)) {
      return fail(res, 400, `Invalid negativeStockPolicy '${data.negativeStockPolicy}'`);
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
          return fail(res, 409, `Item with SKU '${data.sku}' already exists`);
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
            negative_stock_policy: data.negativeStockPolicy || 'disallow',
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

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'create_inventory_item',
          entityType: 'inventory_item',
          entityId: String(newItem.id),
          description: `Created inventory item ${newItem.name} (SKU: ${newItem.sku})`,
          afterState: newItem,
        }).catch(() => {});

        return created(res, mapDbToDomainItem(newItem), 'Inventory item created');

      } else {
        return fail(res, 503, 'Database unavailable');
      }
    } catch (error) {
      console.error('[inventory] Error in POST /items:', error);
      return fail(res, 500, 'Failed to create inventory item: ' + (error as Error).message);
    }
  });

  r.patch('/items/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const b = (req.body || {}) as Partial<InventoryItem>;
    if (b.costingMethod && !['weighted_average', 'fifo'].includes(b.costingMethod)) {
      return fail(res, 400, `Costing method '${b.costingMethod}' is not supported. Supported methods are 'weighted_average' and 'fifo'.`);
    }
    if (b.negativeStockPolicy && !VALID_NEGATIVE_STOCK_POLICIES.has(b.negativeStockPolicy)) {
      return fail(res, 400, `Invalid negativeStockPolicy '${b.negativeStockPolicy}'`);
    }

    const update: Record<string, unknown> = {};
    if (b.sku !== undefined) update.sku = b.sku;
    if (b.name !== undefined) update.name = b.name;
    if (b.description !== undefined) update.description = b.description || null;
    if (b.category !== undefined) update.category = b.category;
    if (b.unit !== undefined) update.unit = b.unit;
    if (b.costingMethod !== undefined) update.costing_method = b.costingMethod;
    if (b.negativeStockPolicy !== undefined) update.negative_stock_policy = b.negativeStockPolicy;
    if (b.reorderLevel !== undefined) update.reorder_level = b.reorderLevel;
    if (b.reorderQuantity !== undefined) update.reorder_quantity = b.reorderQuantity;
    if (b.sellingPrice !== undefined) update.selling_price = b.sellingPrice;
    if (b.assetAccountId !== undefined) update.asset_account_id = b.assetAccountId || null;
    if (b.cogsAccountId !== undefined) update.cogs_account_id = b.cogsAccountId || null;
    if (b.isActive !== undefined) update.is_active = b.isActive;
    // Stock levels and costs change only through inventory transactions.

    if (Object.keys(update).length === 0) return fail(res, 400, 'No updatable fields provided');

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

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'update_inventory_item',
      entityType: 'inventory_item',
      entityId: id,
      description: `Updated inventory item ${data.name} (SKU: ${data.sku})`,
      afterState: data,
    }).catch(() => {});

    return ok(res, mapDbToDomainItem(data));
  });

  // DELETE endpoint for soft delete
  r.delete('/items/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? '');
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data, error } = await sb
      .from('inventory_items')
      .update({ is_active: false })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id, name, sku')
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return notFound(res, 'Item not found in this organization');

    void logAuditEvent(req, {
      organizationId: orgId,
      action: 'deactivate_inventory_item',
      entityType: 'inventory_item',
      entityId: id,
      description: `Deactivated inventory item ${data.name} (SKU: ${data.sku})`,
    }).catch(() => {});

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
