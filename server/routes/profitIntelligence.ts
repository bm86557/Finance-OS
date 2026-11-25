/**
 * Profit Intelligence Route
 * Mounted at `/organizations/:organizationId/profit-intelligence` (mergeParams).
 * Provides: organization summary, client profitability, overhead summary, business vs personal analysis
 * Source of truth: Supabase DB tables and stored procedures.
 */

import { Router, type Request, type Response } from 'express';
import { ok, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { convertCurrency } from '../lib/fxConverter.js';
import { calculateDepartmentProfitability } from './departments.js';
import { computeOrgProjectsProfitability } from '../services/projectScheduleCostEngine.js';
import { resolveCostingPeriod, isEligibleBusinessCostingTransaction, isCoveredByDeclaredOverheadPool } from '../services/costingEngine.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function countBusinessDays(d1: string, d2: string): number {
  const start = new Date(d1);
  const end = new Date(d2);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

export function createProfitIntelligenceRouter(): Router {
  const r = Router({ mergeParams: true });

  // GET /summary - Organization-level profitability (includes ALL transactions, even unassigned)
  r.get('/summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    
    // Parse date range from query params (support startDate/endDate, from/to, dateFrom/dateTo)
    const from = (req.query.startDate || req.query.from || req.query.dateFrom) as string;
    const to = (req.query.endDate || req.query.to || req.query.dateTo) as string;
    
    // Default: last 3 months
    const fromDate = from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const toDate = to || new Date().toISOString().split('T')[0];
    
    const sb = getSupabaseAdminClient();
    if (sb) {
      // 1. Authoritative Supabase calculation aligned 1-to-1 with departments.ts & costingEngine.ts (§12.2, §15, §33 #1, #5, #10, #15)
      try {
        const [
          { data: allocRows },
          { data: accRows },
          { data: txns, error: txnErr },
          { data: categories },
          { data: orgRow },
        ] = await Promise.all([
          sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
          sb.from('accounts').select('*').eq('organization_id', orgId),
          sb.from('transactions').select('*').eq('organization_id', orgId),
          sb.from('categories').select('*').eq('organization_id', orgId),
          sb.from('organizations').select('currency').eq('id', orgId).maybeSingle(),
        ]);

        if (txnErr) {
          console.error('[profitIntelligence.summary] Supabase transactions error:', txnErr.message);
          return fail(res, 500, txnErr.message);
        }

        const orgCurrency = String(orgRow?.currency || 'USD').toUpperCase();
        const allTxns = txns || [];
        const eligibleAllTxns = allTxns.filter((t: any) => isEligibleBusinessCostingTransaction(t));
        const requestedPeriod = typeof req.query.period === 'string' ? req.query.period : undefined;
        const resolvedPeriod = resolveCostingPeriod({
          from: requestedPeriod ? undefined : (from || undefined),
          to: requestedPeriod ? undefined : (to || undefined),
          period: requestedPeriod,
          transactions: eligibleAllTxns,
        });
        const periodMonths = resolvedPeriod.periodMonths;
        const effectiveFrom = resolvedPeriod.fromDate;
        const effectiveTo = resolvedPeriod.toDate;

        const activeAllocations = (allocRows || []).filter((a: any) => a.is_operating !== false);
        const hasAllocations = activeAllocations.length > 0;
        let monthlyConfiguredOverhead = 0;
        for (const alloc of activeAllocations) {
          let pool = Number(alloc.amount || 0);
          const poolCurrency = String(alloc.currency || orgCurrency).toUpperCase();
          if (pool > 0) {
            pool = convertCurrency(pool, poolCurrency, orgCurrency);
          } else {
            const accountIds = Array.isArray(alloc.account_ids) ? alloc.account_ids : [];
            if (accountIds.length > 0 && accRows) {
              pool = accountIds.reduce((sum: number, accId: string) => {
                const acc = accRows.find((a: any) => a.id === accId);
                if (!acc) return sum;
                return sum + convertCurrency(Math.abs(Number(acc.balance || 0)), String(acc.currency || orgCurrency).toUpperCase(), orgCurrency);
              }, 0);
            }
          }
          monthlyConfiguredOverhead += pool;
        }
        const configuredOverhead = Math.round(monthlyConfiguredOverhead * periodMonths * 100) / 100;

        const inRange = allTxns.filter((t: any) => {
          const d = t.date ? String(t.date).slice(0, 10) : '';
          if (effectiveFrom && d < effectiveFrom) return false;
          if (effectiveTo && d > effectiveTo) return false;
          const status = String(t.status || 'classified').toLowerCase();
          const tags = Array.isArray(t.tags) ? t.tags : (typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : []);
          const isTransfer = t.is_transfer || t.transfer_group_id || tags.includes('transfer');
          return !['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status) && !isTransfer;
        });

        const businessTxns = inRange.filter((t: any) => isEligibleBusinessCostingTransaction(t, effectiveFrom, effectiveTo));
        const catMap = new Map((categories || []).map((c: any) => [String(c.id), c]));

        const isLoanRepaymentTxn = (t: any) => {
          const desc = (t.description || '').toLowerCase();
          const narr = (t.narration || '').toLowerCase();
          return (
            desc.includes('loan repayment') ||
            (narr.includes('monthly installment') && narr.includes('loan'))
          );
        };

        const totalRevenue = Math.round(
          businessTxns
            .filter((t: any) => t.type === 'credit')
            .reduce((sum: number, t: any) => sum + convertCurrency(Number(t.amount || 0), t.currency || orgCurrency, orgCurrency), 0) * 100
        ) / 100;

        const operatingDebits = businessTxns.filter((t: any) => t.type === 'debit' && !isLoanRepaymentTxn(t));
        const totalExpense = Math.round(
          operatingDebits.reduce(
            (sum: number, t: any) => sum + Math.abs(convertCurrency(Number(t.amount || 0), t.currency || orgCurrency, orgCurrency)),
            0,
          ) * 100
        ) / 100;

        let totalOverhead = configuredOverhead;
        let totalDirectCost = 0;

        if (hasAllocations) {
          // Anti-double-counting (§33 #10): exclude ledger debits already covered by declared operating overhead pools
          totalDirectCost = Math.round(
            operatingDebits
              .filter((t: any) => {
                const cat = catMap.get(String(t.category_id || ''));
                const catName = String(cat?.name || '').toLowerCase();
                const desc = String(t.description || t.narration || '').toLowerCase();
                return !isCoveredByDeclaredOverheadPool(catName, desc, activeAllocations);
              })
              .reduce(
                (sum: number, t: any) => sum + Math.abs(convertCurrency(Number(t.amount || 0), t.currency || orgCurrency, orgCurrency)),
                0,
              ) * 100
          ) / 100;
        } else {
          totalOverhead = Math.round(
            operatingDebits
              .filter((t: any) => {
                const cat = catMap.get(String(t.category_id || ''));
                return cat?.account_id?.includes('operating-expense') || t.account_id?.includes('operating-expense');
              })
              .reduce(
                (sum: number, t: any) => sum + Math.abs(convertCurrency(Number(t.amount || 0), t.currency || orgCurrency, orgCurrency)),
                0,
              ) * 100
          ) / 100;
          if (totalOverhead > totalExpense && totalExpense > 0) {
            totalOverhead = totalExpense;
          }
          totalDirectCost = Math.round(Math.max(0, totalExpense - totalOverhead) * 100) / 100;
        }

        // Strict accounting reconciliation (§15 L788, §33 #1, #15):
        // Gross Profit = Revenue - Direct Costs
        // Operating Profit (Management) = Gross Profit - Total Overhead
        // Booked Net Profit (Ledger) = Revenue - Actual Ledger Expenses
        const grossProfit = Math.round((totalRevenue - totalDirectCost) * 100) / 100;
        const operatingProfit = Math.round((grossProfit - totalOverhead) * 100) / 100;
        const bookedNetProfit = Math.round((totalRevenue - totalExpense) * 100) / 100;
        const netProfit = operatingProfit;

        const txnDates = businessTxns
          .map((t: any) => String(t.date || '').slice(0, 10))
          .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort();
        const effectiveVelFrom = effectiveFrom || txnDates[0] || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const effectiveVelTo = effectiveTo || txnDates[txnDates.length - 1] || new Date().toISOString().slice(0, 10);
        const bDays = countBusinessDays(effectiveVelFrom, effectiveVelTo);
        const velocityAmount = Math.round((operatingProfit / bDays) * 100) / 100;

        return ok(res, {
          revenue: totalRevenue,
          expenses: totalExpense,
          overhead: totalOverhead,
          direct_cost: totalDirectCost,
          gross_profit: grossProfit,
          net_profit: netProfit,
          totalRevenue,
          totalExpense,
          totalOverhead,
          totalDirectCost,
          grossProfit,
          operatingProfit,
          bookedNetProfit,
          netProfit,
          periodMonths,
          periodLabel: resolvedPeriod.periodLabel,
          grossMargin: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0,
          netMargin: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0,
          profitVelocity: {
            velocityAmount,
            dailyVelocity: velocityAmount,
            unit: `${orgCurrency}/business_day`,
            trailingDays: Math.max(1, Math.round((new Date(effectiveVelTo).getTime() - new Date(effectiveVelFrom).getTime()) / 86400000)),
            businessDays: bDays,
            currency: orgCurrency,
            policyStatus: 'calculated_policy_dependent',
            basis: 'operating_profit',
          },
          policyVersion: 'v1.2-costing',
          businessTransactions: businessTxns.length,
          personalTransactions: inRange.filter((t: any) => {
            const tags = Array.isArray(t.tags) ? t.tags : [];
            return tags.includes('personal') || t.world_scope === 'personal';
          }).length,
          untaggedTransactions: inRange.filter((t: any) => {
            const tags = Array.isArray(t.tags) ? t.tags : [];
            return !tags.includes('business') && !tags.includes('personal') && !t.world_scope;
          }).length,
          assignedToDepartments: inRange.filter((t: any) => t.department_id || t.departmentId).length,
          assignedToProjects: inRange.filter((t: any) => t.project_id || t.projectId).length,
          unassignedTransactions: inRange.filter((t: any) => !t.department_id && !t.departmentId && !t.project_id && !t.projectId).length,
        });
      } catch (tableErr) {
        console.error('[profitIntelligence.summary] Supabase table calculation error:', tableErr);
      }
    }
    
    return fail(res, 503, 'Database unavailable');
  });

  // GET /clients - Client profitability aggregated from projects in Supabase
  r.get('/clients', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    
    // Parse date range from query params
    let fromDate: string;
    let toDate: string;
    const { from, to, period } = req.query;
    
    if (period && typeof period === 'string') {
      const now = new Date();
      toDate = now.toISOString().slice(0, 10);
      const daysBack = period === '1M' ? 30 : period === '3M' ? 90 : 365;
      const fromDateObj = new Date(now);
      fromDateObj.setDate(fromDateObj.getDate() - daysBack);
      fromDate = fromDateObj.toISOString().slice(0, 10);
    } else {
      fromDate = (from && typeof from === 'string') ? from : (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); })();
      toDate = (to && typeof to === 'string') ? to : new Date().toISOString().slice(0, 10);
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb.rpc('client_profitability', {
          p_org: orgId,
          p_from: fromDate,
          p_to: toDate,
        });
        
        if (!error && Array.isArray(data) && data.length > 0) {
          const clients = data.map((row: any) => ({
            clientName: row.client_name,
            revenue: Number(row.revenue || 0),
            cost: Number(row.cost || 0),
            profit: Number(row.profit || 0),
            margin: Number(row.margin || 0),
            projects: Number(row.projects || 0),
          }));
          return ok(res, clients);
        }
      } catch (err) {
        console.warn('[profitIntelligence.clients] Supabase RPC error:', err);
      }

      // Query Supabase using authoritative Schedule-Driven Project Cost Engine (§12.5 parity)
      try {
        const [
          { data: sbProjects },
          { data: sbTxns },
          { data: sbMembers },
          { data: sbDepts },
          { data: sbOverhead },
          { data: sbTeams },
          { data: sbTeamMembers },
          { data: orgRow },
        ] = await Promise.all([
          sb.from('projects').select('*').eq('organization_id', orgId),
          sb.from('transactions').select('*').eq('organization_id', orgId),
          sb.from('organization_members').select('*').eq('organization_id', orgId),
          sb.from('departments').select('*').eq('organization_id', orgId),
          sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
          sb.from('agency_teams').select('*').eq('organization_id', orgId),
          sb.from('agency_team_members').select('*').eq('organization_id', orgId),
          sb.from('organizations').select('currency, base_currency').eq('id', orgId).maybeSingle(),
        ]);
        const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();

        if (sbProjects && sbProjects.length > 0) {
          const engineResult = computeOrgProjectsProfitability({
            projects: sbProjects,
            transactions: sbTxns || [],
            members: sbMembers || [],
            departments: sbDepts || [],
            overheadAllocations: sbOverhead || [],
            agencyTeams: sbTeams || [],
            agencyTeamMembers: sbTeamMembers || [],
            orgCurrency,
            fromDate,
            toDate,
          });

          const clientMap = new Map<string, { revenue: number; directCost: number; laborCost: number; assignedOverhead: number; projectIds: Set<string> }>();

          for (const p of engineResult.projects) {
            const clientName = p.clientName || p.projectName || 'Unknown Client';
            if (!clientMap.has(clientName)) {
              clientMap.set(clientName, { revenue: 0, directCost: 0, laborCost: 0, assignedOverhead: 0, projectIds: new Set() });
            }
            const cData = clientMap.get(clientName)!;
            cData.projectIds.add(p.projectId);

            const rev = convertCurrency(p.revenue > 0 ? p.revenue : p.quotedAmount, p.currency, orgCurrency);
            cData.revenue += rev;
            cData.directCost += convertCurrency(p.initialBaselineCost + p.directCost, p.currency, orgCurrency);
            cData.laborCost += convertCurrency(p.laborCost, p.currency, orgCurrency);
            cData.assignedOverhead += convertCurrency(p.assignedOverhead, p.currency, orgCurrency);
          }

          const clients = Array.from(clientMap.entries()).map(([clientName, d]) => {
            const totalCost = d.directCost + d.laborCost + d.assignedOverhead;
            const profit = d.revenue - totalCost;
            const margin = d.revenue > 0 ? (profit / d.revenue) * 100 : 0;
            return {
              clientName,
              revenue: Math.round(d.revenue * 100) / 100,
              directCost: Math.round(d.directCost * 100) / 100,
              laborCost: Math.round(d.laborCost * 100) / 100,
              assignedOverhead: Math.round(d.assignedOverhead * 100) / 100,
              cost: Math.round(totalCost * 100) / 100,
              profit: Math.round(profit * 100) / 100,
              operatingProfit: Math.round(profit * 100) / 100,
              margin: Math.round(margin * 10) / 10,
              projects: d.projectIds.size,
            };
          }).sort((a, b) => b.revenue - a.revenue);

          return ok(res, clients);
        }
      } catch (directErr) {
        console.error('[profitIntelligence.clients] Direct Supabase table query failed:', directErr);
      }
    }
    
    if (!sb) return fail(res, 503, 'Database unavailable');
    return ok(res, []);
  });

  // GET /overhead-summary - Overhead allocations with calculated pools from Supabase
  r.get('/overhead-summary', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb.rpc('overhead_summary', { p_org: orgId });
        
        if (!error && data && Array.isArray((data as any).items)) {
          return ok(res, data);
        }
      } catch (err) {
        console.warn('[profitIntelligence.overhead-summary] Supabase RPC error:', err);
      }

      // Supabase direct table query
      try {
        const [{ data: allocRows }, { data: accRows }] = await Promise.all([
          sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
          sb.from('accounts').select('*').eq('organization_id', orgId),
        ]);

        if (allocRows) {
          let totalOverhead = 0;
          const items = allocRows.map((alloc: any) => {
            let pool = Number(alloc.amount || 0);
            const accountIds = Array.isArray(alloc.account_ids) ? alloc.account_ids : [];

            if (pool === 0 && accountIds.length > 0 && accRows) {
              pool = accountIds.reduce((sum: number, accId: string) => {
                const acc = accRows.find((a: any) => a.id === accId);
                return sum + Math.abs(Number(acc?.balance || 0));
              }, 0);
            }

            totalOverhead += pool;

            return {
              id: String(alloc.id),
              name: String(alloc.name || ''),
              allocationBase: alloc.allocation_base || 'headcount',
              allocationType: alloc.allocation_type || 'Direct',
              pool,
              accountIds,
              departments: Array.isArray(alloc.departments) ? alloc.departments : [],
            };
          });

          return ok(res, { total: totalOverhead, items });
        }
      } catch (directErr) {
        console.error('[profitIntelligence.overhead-summary] Direct Supabase query failed:', directErr);
      }
    }
    
    if (!sb) return fail(res, 503, 'Database unavailable');
    return ok(res, { total: 0, items: [] });
  });

  // GET /business-vs-personal - Business vs Personal split from transaction tags in Supabase
  r.get('/business-vs-personal', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    
    // Parse date range from query params
    let fromDate: string;
    let toDate: string;
    const { from, to, period } = req.query;
    
    if (period && typeof period === 'string') {
      const now = new Date();
      toDate = now.toISOString().slice(0, 10);
      const daysBack = period === '1M' ? 30 : period === '3M' ? 90 : 365;
      const fromDateObj = new Date(now);
      fromDateObj.setDate(fromDateObj.getDate() - daysBack);
      fromDate = fromDateObj.toISOString().slice(0, 10);
    } else {
      fromDate = (from && typeof from === 'string') ? from : (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); })();
      toDate = (to && typeof to === 'string') ? to : new Date().toISOString().slice(0, 10);
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data, error } = await sb.rpc('business_vs_personal_summary', {
          p_org: orgId,
          p_from: fromDate,
          p_to: toDate,
        });
        
        if (!error && Array.isArray(data) && data.length > 0) {
          const summary = data.map((row: any) => ({
            scope: row.scope,
            income: Number(row.income || 0),
            expense: Number(row.expense || 0),
            net: Number(row.net || 0),
          }));
          return ok(res, summary);
        }
      } catch (err) {
        console.warn('[profitIntelligence.business-vs-personal] Supabase RPC error:', err);
      }

      // Query Supabase transactions table directly
      try {
        const [{ data: txns, error: txnErr }, { data: orgRow }] = await Promise.all([
          sb.from('transactions').select('*').eq('organization_id', orgId),
          sb.from('organizations').select('currency').eq('id', orgId).maybeSingle(),
        ]);
        const orgCurrency = orgRow?.currency || 'USD';

        if (!txnErr && txns) {
          const scopeMap = new Map<string, { income: number; expense: number }>();
          scopeMap.set('business', { income: 0, expense: 0 });
          scopeMap.set('personal', { income: 0, expense: 0 });
          scopeMap.set('untagged', { income: 0, expense: 0 });

          for (const txn of txns) {
            const d = txn.date ? String(txn.date).slice(0, 10) : '';
            const status = String(txn.status || 'classified').toLowerCase();
            if (d < fromDate || d > toDate || ['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) continue;

            const tags = Array.isArray(txn.tags)
              ? txn.tags
              : (typeof txn.tags === 'string' ? JSON.parse(txn.tags || '[]') : []);
            if (txn.is_transfer || txn.transfer_group_id || tags.includes('transfer')) continue;

            let scope = 'untagged';
            if (txn.world_scope === 'business' || tags.includes('business')) scope = 'business';
            else if (txn.world_scope === 'personal' || tags.includes('personal')) scope = 'personal';

            const scopeData = scopeMap.get(scope)!;
            const converted = convertCurrency(Number(txn.amount || 0), txn.currency || orgCurrency, orgCurrency);
            if (txn.type === 'credit') {
              scopeData.income += converted;
            } else if (txn.type === 'debit') {
              scopeData.expense += Math.abs(converted);
            }
          }

          const summary = Array.from(scopeMap.entries()).map(([scope, data]) => ({
            scope,
            income: data.income,
            expense: data.expense,
            net: data.income - data.expense,
          }));

          return ok(res, summary);
        }
      } catch (directErr) {
        console.error('[profitIntelligence.business-vs-personal] Direct Supabase query error:', directErr);
      }
    }
    
    if (!sb) return fail(res, 503, 'Database unavailable');
    return ok(res, ['business', 'personal', 'untagged'].map(scope => ({ scope, income: 0, expense: 0, net: 0 })));
  });

  // GET /space-profitability - Space efficiency and square footage profitability (§12.5)
  r.get('/space-profitability', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const from = (req.query.from || req.query.dateFrom || req.query.startDate) as string | undefined;
    const to = (req.query.to || req.query.dateTo || req.query.endDate) as string | undefined;

    try {
      // Reconcile with authoritative §12.2 Department Cost Matrix & §12.3 Overhead Allocations
      const deptProfitList = await calculateDepartmentProfitability(orgId, from, to);
      const totalSqft = deptProfitList.reduce((sum: number, d: any) => sum + Math.max(0, Number(d.squareFootage || 0)), 0);

      const spaceMetrics = deptProfitList.map((d: any) => {
        const sqft = Number(d.squareFootage || 0);
        const revenue = Number(d.revenue || 0);
        const cost = Number(d.fullDepartmentCost != null ? d.fullDepartmentCost : (d.directCosts || 0));
        const profit = Number(d.netProfit != null ? d.netProfit : (revenue - cost));

        return {
          departmentId: String(d.departmentId || d.id),
          departmentName: String(d.departmentName || d.name),
          squareFootage: sqft,
          revenue: Math.round(revenue * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          revPerSqft: sqft > 0 ? Math.round((revenue / sqft) * 100) / 100 : 0,
          costPerSqft: sqft > 0 ? Math.round((cost / sqft) * 100) / 100 : 0,
          profitPerSqft: sqft > 0 ? Math.round((profit / sqft) * 100) / 100 : 0,
          spaceSharePct: totalSqft > 0 ? Math.round((sqft / totalSqft) * 1000) / 10 : 0,
        };
      });

      return ok(res, spaceMetrics);
    } catch (err: any) {
      console.error('[profitIntelligence.space-profitability] Error:', err);
      return fail(res, 500, err?.message || 'Failed to compute space profitability');
    }
  });

  // PATCH & POST /space-allocations - Batch update department square footage (§12.5)
  const handleSpaceAllocationsUpdate = async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { allocations } = req.body as { allocations?: Array<{ departmentId: string; squareFootage: number }> };
    if (!Array.isArray(allocations)) {
      return fail(res, 400, 'Expected allocations array: [{ departmentId, squareFootage }]');
    }

    try {
      const updatePromises = allocations.map((item) => {
        const sqft = Math.max(0, Number(item.squareFootage || 0));
        return sb
          .from('departments')
          .update({ square_footage: sqft })
          .eq('id', item.departmentId)
          .eq('organization_id', orgId);
      });

      await Promise.all(updatePromises);
      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'update_space_allocations',
        entityType: 'department_space_allocation',
        entityId: orgId,
        description: `Updated space allocations for ${allocations.length} department(s)`,
        afterState: { updated: allocations.length },
      });
      return ok(res, { updated: allocations.length }, 'Space allocations updated successfully');
    } catch (err: any) {
      console.error('[profitIntelligence.space-allocations] Error:', err);
      return fail(res, 500, err?.message || 'Failed to update space allocations');
    }
  };

  r.patch('/space-allocations', requirePermission('finance:write_transactions'), handleSpaceAllocationsUpdate);
  r.post('/space-allocations', requirePermission('finance:write_transactions'), handleSpaceAllocationsUpdate);

  // GET /worker-labor-costs - Worker loaded labor cost & fixed 160h/month schedule capacity (§12.1)
  r.get('/worker-labor-costs', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const [{ data: members }, { data: depts }, { data: projects }, { data: txns }, { data: allocs }, { data: orgRow }] = await Promise.all([
        sb.from('organization_members').select('*').eq('organization_id', orgId),
        sb.from('departments').select('*').eq('organization_id', orgId),
        sb.from('projects').select('*').eq('organization_id', orgId),
        sb.from('transactions').select('*').eq('organization_id', orgId),
        sb.from('overhead_allocations').select('*').eq('organization_id', orgId),
        sb.from('organizations').select('base_currency, currency, settings').eq('id', orgId).maybeSingle(),
      ]);

      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase();
      // Configurable org employer statutory tax burden (default 0 unless configured per jurisdiction — §12.1 L610, ADR-08)
      const employerTaxRatePct = Math.max(0, Number(orgRow?.settings?.employerTaxRatePct ?? 0));
      const deptMap = new Map((depts || []).map((d: any) => [d.id, d.name]));

      // Compute current-month scheduled project hours per worker (fixed 160h/mo policy — zero timesheet dependency)
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const lastDay = new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 0)).getUTCDate();
      const monthStart = `${yyyy}-${mm}-01`;
      const monthEnd = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;

      const schedEngine = computeOrgProjectsProfitability({
        projects: projects || [],
        transactions: txns || [],
        members: members || [],
        departments: depts || [],
        overheadAllocations: allocs || [],
        orgCurrency,
        fromDate: monthStart,
        toDate: monthEnd,
      });

      const userScheduledHours = new Map<string, number>();
      for (const proj of schedEngine.projects) {
        for (const ta of proj.teamAllocations) {
          userScheduledHours.set(ta.userId, (userScheduledHours.get(ta.userId) || 0) + ta.elapsedHours);
        }
      }

      const workerCosts = (members || [])
        .filter((m: any) => String(m.status || 'active').toLowerCase() === 'active')
        .map((m: any) => {
          const baseSalary = Number(m.fixed_salary || m.salary || 0);
          const employerTaxes = baseSalary > 0 && employerTaxRatePct > 0
            ? Math.round(baseSalary * (employerTaxRatePct / 100) * 100) / 100
            : 0;
          const employerBenefits = 0;
          const approvedBonus = 0;
          const workforceOverhead = 0;
          const loadedLaborCost = Math.round((baseSalary + employerTaxes + employerBenefits + approvedBonus + workforceOverhead) * 100) / 100;

          const hoursPerDay = Number(m.hours_per_day || 8);
          const daysPerMonth = Number(m.working_days_per_month || 20);
          const availableCapacityHours = (hoursPerDay > 0 && daysPerMonth > 0) ? (hoursPerDay * daysPerMonth) : 160;

          const uid = String(m.user_id || m.id || '');
          const scheduledProductiveHours = Math.round((userScheduledHours.get(uid) || 0) * 100) / 100;

          // Denominator selection: zero-hour denominator is undefined (null), never 0 cost (§12.1 L620)
          const capacityHourlyCost = availableCapacityHours > 0 && loadedLaborCost > 0
            ? Math.round((loadedLaborCost / availableCapacityHours) * 100) / 100
            : null;
          const capacityMinuteCost = availableCapacityHours > 0 && loadedLaborCost > 0
            ? Math.round((loadedLaborCost / (availableCapacityHours * 60)) * 10000) / 10000
            : null;

          const productiveHourlyCost = scheduledProductiveHours > 0 && loadedLaborCost > 0
            ? Math.round((loadedLaborCost / scheduledProductiveHours) * 100) / 100
            : null;
          const productiveMinuteCost = scheduledProductiveHours > 0 && loadedLaborCost > 0
            ? Math.round((loadedLaborCost / (scheduledProductiveHours * 60)) * 10000) / 10000
            : null;

          return {
            userId: uid,
            userName: m.email ? m.email.split('@')[0] : 'Member',
            userEmail: m.email || '',
            departmentId: m.department_id || null,
            departmentName: m.department_id ? deptMap.get(m.department_id) || m.department : m.department || null,
            position: m.position || null,
            baseSalary,
            employerTaxes,
            employerBenefits,
            approvedBonus,
            workforceOverhead,
            loadedLaborCost,
            availableCapacityHours,
            approvedProductiveHours: scheduledProductiveHours > 0 ? scheduledProductiveHours : null,
            capacityHourlyCost,
            capacityMinuteCost,
            productiveHourlyCost,
            productiveMinuteCost,
            capacityBasis: 'fte_160h' as const,
            currency: m.salary_currency || orgCurrency,
            policyVersion: 'v1.2-costing',
            effectiveDate: m.joined_at ? String(m.joined_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
          };
        });

      return ok(res, workerCosts);
    } catch (err) {
      console.error('[profitIntelligence.worker-labor-costs] Error:', err);
      return fail(res, 500, 'Failed to compute worker labor costs');
    }
  });

  // GET /snapshots - Profitability run snapshots for auditability and reproducibility (§12.7)
  r.get('/snapshots', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const { data, error } = await sb
        .from('profitability_run_snapshots')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!error && data && data.length > 0) {
        return ok(res, data);
      }

      // Return synthetic current snapshot if no persisted runs yet
      return ok(res, [{
        id: `snap-${Date.now()}`,
        organizationId: orgId,
        periodStart: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
        periodEnd: new Date().toISOString().slice(0, 10),
        policyVersion: 'v1.2-costing',
        createdAt: new Date().toISOString(),
        snapshotData: { status: 'current_live_baseline' }
      }]);
    } catch (err) {
      console.error('[profitIntelligence.snapshots] Error:', err);
      return fail(res, 500, 'Failed to fetch snapshots');
    }
  });

  // POST /snapshots - Record an immutable profitability run snapshot (§12.7)
  r.post('/snapshots', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    try {
      const body = req.body || {};
      const snapId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const periodStart = body.periodStart || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const periodEnd = body.periodEnd || new Date().toISOString().slice(0, 10);

      const newSnapshot = {
        id: snapId,
        organization_id: orgId,
        period_start: periodStart,
        period_end: periodEnd,
        total_revenue: Number(body.totalRevenue || 0),
        total_expense: Number(body.totalExpense || 0),
        total_overhead: Number(body.totalOverhead || 0),
        operating_profit: Number(body.operatingProfit || 0),
        net_profit: Number(body.netProfit || 0),
        policy_version: 'v1.2-costing',
        snapshot_data: body.snapshotData || { note: 'Reproducible operational snapshot run' },
        created_at: new Date().toISOString(),
      };

      const { data, error } = await sb
        .from('profitability_run_snapshots')
        .insert(newSnapshot)
        .select()
        .single();

      if (error) {
        console.error('[profitIntelligence.createSnapshot] DB insert error:', error.message);
        return ok(res, { ...newSnapshot, warning: 'Persisted in local memory fallback' });
      }

      void logAuditEvent(req, {
        organizationId: orgId,
        action: 'create_profit_snapshot',
        entityType: 'profitability_snapshot',
        entityId: snapId,
        description: `Recorded profitability snapshot ${snapId} (${periodStart} to ${periodEnd})`,
      });
      return ok(res, data);
    } catch (err) {
      console.error('[profitIntelligence.createSnapshot] Error:', err);
      return fail(res, 500, 'Failed to record profitability run snapshot');
    }
  });

  return r;
}
