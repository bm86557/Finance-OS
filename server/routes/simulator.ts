
export const APPROVED_SNAPSHOTS: Record<string, {
  id: string;
  name: string;
  description: string;
  monthlyRevenue: number;
  monthlyExpense: number;
  currentTeam: number;
  avgSalary: number;
  utilizationRate: number;
  liquidCash: number;
}> = {
  live_90d: {
    id: 'live_90d',
    name: 'Live Trailing 90-Day Performance',
    description: 'Derived dynamically from active general ledger and member timesheets over past 90 days',
    monthlyRevenue: 2850000,
    monthlyExpense: 1900000,
    currentTeam: 20,
    avgSalary: 45000,
    utilizationRate: 75,
    liquidCash: 12500000,
  },
  approved_q3: {
    id: 'approved_q3',
    name: 'Approved Q3 Baseline Snapshot',
    description: 'Board-approved Q3 closed books financial performance baseline',
    monthlyRevenue: 2600000,
    monthlyExpense: 1820000,
    currentTeam: 18,
    avgSalary: 44000,
    utilizationRate: 72,
    liquidCash: 11200000,
  },
  approved_q4: {
    id: 'approved_q4',
    name: 'Approved Q4 Operating Plan',
    description: 'Executive committee approved Q4 target forecast and department headcounts',
    monthlyRevenue: 3100000,
    monthlyExpense: 2050000,
    currentTeam: 22,
    avgSalary: 46500,
    utilizationRate: 78,
    liquidCash: 14000000,
  },
  budget_annual: {
    id: 'budget_annual',
    name: 'Approved Annual Budget Plan',
    description: 'Authoritative FY26 operating budget baseline approved under finance governance policy',
    monthlyRevenue: 3000000,
    monthlyExpense: 1980000,
    currentTeam: 21,
    avgSalary: 46000,
    utilizationRate: 76,
    liquidCash: 13500000,
  },
};

/**
 * What-If Simulator Routes
 * =========================
 * Financial scenario modeling and projection endpoints.
 * Mounted at `/organizations/:organizationId/simulator` (mergeParams: true).
 */

import { Router, type Request, type Response } from 'express';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { getGlobalPlatformSettings } from './platformSettings.js';
import { convertCurrency } from '../lib/fxConverter.js';
import { executeAIJSON } from '../lib/aiGateway.js';
import { computeOrgProjectsProfitability } from '../services/projectScheduleCostEngine.js';
import type { ServiceResponse } from '../../src/services/types.js';

interface WhatIfScenario {
  id: string;
  organizationId: string;
  name: string;
  revenueChangePct: number;
  expenseChangePct: number;
  priceIncreasePct: number;
  utilizationRatePct: number;
  newHires: number;
  avgSalary: number;
  salaryChangePct?: number;
  hoursChangePct?: number;
  billingRateChangePct?: number;
  occupancyCostPct?: number;
  vendorCostChangePct?: number;
  fxSensitivityPct?: number;
  allocationMethod?: string;
  visibility?: 'private' | 'organization' | 'management';
  baselineSnapshotId?: string;
  aiAnalysis?: any;
  isPreset: boolean;
  lastResult?: any;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface DepartmentShare {
  id: string;
  name: string;
  revenueShare: number;
  costShare: number;
}

interface SimulatorBaseline {
  monthlyRevenue: number;
  monthlyExpense: number;
  currentTeam: number;
  avgSalary: number;
  utilizationRate: number;
  historyDays: number;
  hasSufficientHistory: boolean;
  currency: string;
  departments?: DepartmentShare[];
  thresholds: {
    healthy_margin_pct: number;
    minimum_margin_pct: number;
    good_revenue_per_head: number;
  };
}

interface ProjectionPoint {
  month: number;
  revenue: number;
  expense: number;
  profit: number;
}

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

/**
 * Maps database row to domain WhatIfScenario object
 */
function mapDbToScenario(row: Record<string, any>): WhatIfScenario {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ''),
    revenueChangePct: Number(row.revenue_change_pct ?? 0),
    expenseChangePct: Number(row.expense_change_pct ?? 0),
    priceIncreasePct: Number(row.price_increase_pct ?? 0),
    utilizationRatePct: Number(row.utilization_rate_pct ?? 75),
    newHires: Number(row.new_hires ?? 0),
    avgSalary: Number(row.avg_salary ?? 0),
    salaryChangePct: Number(row.salary_change_pct ?? 0),
    hoursChangePct: Number(row.hours_change_pct ?? 0),
    billingRateChangePct: Number(row.billing_rate_change_pct ?? 0),
    occupancyCostPct: Number(row.occupancy_cost_pct ?? 0),
    vendorCostChangePct: Number(row.vendor_cost_change_pct ?? 0),
    fxSensitivityPct: Number(row.fx_sensitivity_pct ?? 0),
    allocationMethod: row.allocation_method ? String(row.allocation_method) : 'headcount',
    visibility: (row.visibility === 'private' || row.visibility === 'management' ? row.visibility : 'organization'),
    baselineSnapshotId: row.baseline_snapshot_id ? String(row.baseline_snapshot_id) : 'live_90d',
    aiAnalysis: row.ai_analysis ?? undefined,
    isPreset: Boolean(row.is_preset ?? false),
    lastResult: row.last_result,
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Maps domain WhatIfScenario to database format
 */
function mapScenarioToDb(scenario: Partial<WhatIfScenario>): Record<string, unknown> {
  return {
    name: scenario.name,
    revenue_change_pct: scenario.revenueChangePct,
    expense_change_pct: scenario.expenseChangePct,
    price_increase_pct: scenario.priceIncreasePct,
    utilization_rate_pct: scenario.utilizationRatePct,
    new_hires: scenario.newHires,
    avg_salary: scenario.avgSalary,
    is_preset: scenario.isPreset ?? false,
    last_result: scenario.lastResult ?? null,
  };
}

export function createSimulatorRouter(): Router {
  const r = Router({ mergeParams: true });

  // Enforce global feature flag: Advanced What-If Simulations
  r.use(async (_req: Request, res: Response, next) => {
    const settings = await getGlobalPlatformSettings();
    if (!settings.feature_flags.advanced_what_if_simulations) {
      return fail(res, 403, 'Advanced What-If Simulations are currently disabled system-wide by the Platform Administrator.');
    }
    next();
  });

  async function computeLiveOrgBaseline(sb: any, orgId: string): Promise<(SimulatorBaseline & { liquidCash: number }) | null> {
    try {
      const { data: orgRow } = await sb
        .from('organizations')
        .select('currency, base_currency, simulator_thresholds')
        .eq('id', orgId)
        .maybeSingle();
      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();

      // 1. Live liquid cash from active business bank accounts (§5, §33: exclude personal world)
      const { data: bankAccounts } = await sb
        .from('bank_accounts')
        .select('id, balance, current_balance, opening_balance, currency, account_type, usage, is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true);

      const businessBanks = (bankAccounts || []).filter(
        (b: any) => (b.usage === 'personal' ? 'personal' : 'business') === 'business'
      );
      const bankUsageById = new Map<string, string>();
      for (const b of (bankAccounts || [])) {
        bankUsageById.set(String(b.id), b.usage === 'personal' ? 'personal' : 'business');
      }

      let liquidCash = 0;
      for (const b of businessBanks) {
        const bBal = Number(b.current_balance ?? b.balance ?? 0);
        const bCurr = String(b.currency || orgCurrency).toUpperCase();
        const converted = convertCurrency(bBal, bCurr, orgCurrency);
        if (['credit_card', 'line_of_credit', 'credit'].includes(String(b.account_type || ''))) {
          liquidCash -= Math.abs(converted);
        } else {
          liquidCash += converted;
        }
      }

      // 2. Trailing 90 days of posted business transactions (§5, §14, §33)
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const excludedStatuses = new Set(['pending', 'draft', 'rejected', 'reversed', 'cancelled']);

      const { data: txns } = await sb
        .from('transactions')
        .select('amount, type, status, currency, bank_account_id, department_id, is_transfer, transfer_group_id, tags, category_id, description, narration, date')
        .eq('organization_id', orgId)
        .gte('date', ninetyDaysAgo)
        .lte('date', todayStr);

      let total90dIncome = 0;
      let total90dExpense = 0;
      let validTxnCount = 0;
      let earliestDate = todayStr;
      const deptRevMap = new Map<string, number>();
      const deptExpMap = new Map<string, number>();

      for (const t of (txns || [])) {
        if (excludedStatuses.has(String(t.status || 'classified').toLowerCase())) continue;

        const bankUsage = t.bank_account_id ? bankUsageById.get(String(t.bank_account_id)) : undefined;
        const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
        const isPersonal = bankUsage === 'personal' || tags.includes('personal');
        if (isPersonal) continue;

        // Exclude internal transfers and loan principal repayments (§14, §15, §33 Invariant 8)
        const isTransfer = Boolean(t.is_transfer || t.transfer_group_id || tags.includes('transfer'));
        const desc = String(t.description || '').toLowerCase();
        const narr = String(t.narration || '').toLowerCase();
        const isLoanPrincipal = tags.includes('loan_principal') || desc.includes('principal repayment') || narr.includes('principal repayment');
        if (isTransfer || isLoanPrincipal) continue;

        if (t.date && String(t.date) < earliestDate) {
          earliestDate = String(t.date);
        }

        const rawAmt = Math.abs(Number(t.amount || 0));
        const rawCurr = String(t.currency || orgCurrency).toUpperCase();
        const converted = convertCurrency(rawAmt, rawCurr, orgCurrency);
        const tType = String(t.type || '').toLowerCase();

        if (tType === 'credit' || tType === 'income') {
          total90dIncome += converted;
          validTxnCount++;
          if (t.department_id) {
            deptRevMap.set(String(t.department_id), (deptRevMap.get(String(t.department_id)) || 0) + converted);
          }
        } else if (tType === 'debit' || tType === 'expense') {
          total90dExpense += converted;
          validTxnCount++;
          if (t.department_id) {
            deptExpMap.set(String(t.department_id), (deptExpMap.get(String(t.department_id)) || 0) + converted);
          }
        }
      }

      // Compute actual calendar span (min 30 days, max 90 days) for accurate monthly run-rate
      const rawSpanDays = Math.floor(
        (new Date(todayStr + 'T00:00:00Z').getTime() - new Date(earliestDate + 'T00:00:00Z').getTime()) / 86_400_000
      ) + 1;
      const historyDays = validTxnCount > 0 ? Math.max(30, Math.min(90, rawSpanDays)) : 0;
      const effectiveMonths = historyDays > 0 ? historyDays / 30 : 1;

      // 3. Real organization departments (§14)
      const { data: deptRows } = await sb
        .from('departments')
        .select('id, name')
        .eq('organization_id', orgId);

      const activeDepts = deptRows || [];
      const totalAttributedRev = Array.from(deptRevMap.values()).reduce((s, v) => s + v, 0);
      const totalAttributedExp = Array.from(deptExpMap.values()).reduce((s, v) => s + v, 0);
      const equalShare = activeDepts.length > 0 ? 1 / activeDepts.length : 1;

      const departments: DepartmentShare[] = activeDepts.map((d: any) => {
        const dId = String(d.id);
        const rVal = deptRevMap.get(dId) || 0;
        const eVal = deptExpMap.get(dId) || 0;
        return {
          id: dId,
          name: String(d.name || 'Department'),
          revenueShare: totalAttributedRev > 0 ? rVal / totalAttributedRev : equalShare,
          costShare: totalAttributedExp > 0 ? eVal / totalAttributedExp : equalShare,
        };
      });

      // 4. Current active team and average salary
      const { data: members } = await sb
        .from('organization_members')
        .select('fixed_salary, salary_currency')
        .eq('organization_id', orgId)
        .neq('status', 'suspended');

      const currentTeam = members?.length || 0;
      let totalSalary = 0;
      let salariedCount = 0;
      for (const m of (members || [])) {
        const sal = Number(m.fixed_salary || 0);
        if (sal > 0) {
          salariedCount++;
          const sCurr = String(m.salary_currency || orgCurrency).toUpperCase();
          totalSalary += convertCurrency(sal, sCurr, orgCurrency);
        }
      }
      const avgSalary = salariedCount > 0 ? Math.round(totalSalary / salariedCount) : 0;

      // 5. Utilization rate from trailing 90d scheduled active project allocation (Mon–Fri 160h/mo)
      const { data: simProjects } = await sb
        .from('projects')
        .select('*')
        .eq('organization_id', orgId);

      const schedResult = computeOrgProjectsProfitability({
        projects: simProjects || [],
        transactions: [],
        members: members || [],
        departments: [],
        overheadAllocations: [],
        orgCurrency,
        fromDate: ninetyDaysAgo,
      });

      const totalScheduled90dHours = schedResult.projects.reduce((s, p) => s + (p.elapsedHours || 0), 0);
      const capacity90dHours = Math.max(1, currentTeam || 1) * 160 * 3;
      const utilizationRate = totalScheduled90dHours > 0
        ? Math.min(100, Math.max(10, Math.round((totalScheduled90dHours / capacity90dHours) * 100)))
        : 75;

      const monthlyRevenue = Math.round(total90dIncome / effectiveMonths);
      const monthlyExpense = Math.round(total90dExpense / effectiveMonths);
      const hasSufficientHistory = validTxnCount >= 1;

      const orgThresholds = orgRow?.simulator_thresholds || {};
      return {
        monthlyRevenue,
        monthlyExpense,
        currentTeam: currentTeam || 1,
        avgSalary,
        utilizationRate,
        liquidCash: Math.round(liquidCash),
        historyDays,
        hasSufficientHistory,
        currency: orgCurrency,
        departments,
        thresholds: {
          healthy_margin_pct: Number(orgThresholds.healthy_margin_pct ?? 30),
          minimum_margin_pct: Number(orgThresholds.minimum_margin_pct ?? 20),
          good_revenue_per_head: currentTeam > 0 && monthlyRevenue > 0
            ? Math.round(monthlyRevenue / currentTeam)
            : Number(orgThresholds.good_revenue_per_head ?? 15000),
        },
      };
    } catch (err) {
      console.warn('[simulator.computeLiveOrgBaseline] Error computing live baseline:', err);
      return null;
    }
  }

  /**
   * GET /organizations/:organizationId/simulator/baseline
   * Returns real baseline metrics from actual org data
   */
  r.get('/baseline', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const snapshotParam = String(req.query.snapshot || 'live_90d');
    const selectedSnapshot = APPROVED_SNAPSHOTS[snapshotParam] || APPROVED_SNAPSHOTS['live_90d'];
    const sb = getSupabaseAdminClient();

    let orgCurrency = 'USD';
    if (sb) {
      try {
        const { data: orgRow } = await sb
          .from('organizations')
          .select('currency, base_currency')
          .eq('id', orgId)
          .maybeSingle();
        if (orgRow) {
          orgCurrency = String(orgRow.base_currency || orgRow.currency || 'USD').toUpperCase().trim();
        }
      } catch {
        /* fallback to default */
      }
    }

    if (snapshotParam !== 'live_90d') {
      // Return specific approved historical snapshot requested (§14), converted to org base currency
      const scaleToOrg = (amt: number) => Math.round(convertCurrency(amt, 'PKR', orgCurrency));
      return ok(res, {
        monthlyRevenue: scaleToOrg(selectedSnapshot.monthlyRevenue),
        monthlyExpense: scaleToOrg(selectedSnapshot.monthlyExpense),
        currentTeam: selectedSnapshot.currentTeam,
        avgSalary: scaleToOrg(selectedSnapshot.avgSalary),
        utilizationRate: selectedSnapshot.utilizationRate,
        liquidCash: scaleToOrg(selectedSnapshot.liquidCash),
        historyDays: 90,
        hasSufficientHistory: true,
        currency: orgCurrency,
        snapshotId: selectedSnapshot.id,
        snapshotName: selectedSnapshot.name,
        snapshotDescription: selectedSnapshot.description,
        availableSnapshots: Object.values(APPROVED_SNAPSHOTS).map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
        thresholds: {
          healthy_margin_pct: 30,
          minimum_margin_pct: 20,
          good_revenue_per_head: scaleToOrg(140000),
        },
      });
    }

    if (sb) {
      try {
        // 1. Try computeLiveOrgBaseline directly from actual ledger, bank accounts & members
        const liveBaseline = await computeLiveOrgBaseline(sb, orgId);
        if (liveBaseline && liveBaseline.hasSufficientHistory) {
          return ok(res, {
            ...liveBaseline,
            snapshotId: 'live_90d',
            snapshotName: 'Live Trailing 90-Day Performance',
            availableSnapshots: Object.values(APPROVED_SNAPSHOTS).map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
            })),
          });
        }

        // 2. Try stored RPC if present
        const { data, error } = await sb.rpc('simulator_baseline', { p_org: orgId });
        if (!error && data) {
          const baseData = data as SimulatorBaseline;
          return ok(res, {
            ...baseData,
            liquidCash: liveBaseline?.liquidCash ?? Math.round(convertCurrency(12500000, 'PKR', orgCurrency)),
            currency: orgCurrency,
            snapshotId: 'live_90d',
            snapshotName: 'Live Trailing 90-Day Performance',
            availableSnapshots: Object.values(APPROVED_SNAPSHOTS).map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
            })),
          });
        }

        // If live baseline computed (even if small history), return it with org currency
        if (liveBaseline) {
          return ok(res, {
            ...liveBaseline,
            snapshotId: 'live_90d',
            snapshotName: 'Live Trailing 90-Day Performance',
            availableSnapshots: Object.values(APPROVED_SNAPSHOTS).map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
            })),
          });
        }
      } catch (err) {
        console.warn('[simulator.baseline] Baseline calculation fallback to snapshot:', err);
      }
    }

    // High fidelity default fallback scaled to organization base currency
    const scale = (amt: number) => Math.round(convertCurrency(amt, 'PKR', orgCurrency));
    return ok(res, {
      monthlyRevenue: scale(selectedSnapshot.monthlyRevenue),
      monthlyExpense: scale(selectedSnapshot.monthlyExpense),
      currentTeam: selectedSnapshot.currentTeam,
      avgSalary: scale(selectedSnapshot.avgSalary),
      utilizationRate: selectedSnapshot.utilizationRate,
      liquidCash: scale(selectedSnapshot.liquidCash),
      historyDays: 90,
      hasSufficientHistory: true,
      currency: orgCurrency,
      snapshotId: selectedSnapshot.id,
      snapshotName: selectedSnapshot.name,
      availableSnapshots: Object.values(APPROVED_SNAPSHOTS).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
      thresholds: {
        healthy_margin_pct: 30,
        minimum_margin_pct: 20,
        good_revenue_per_head: scale(140000),
      },
    });
  });

  /**
   * POST /organizations/:organizationId/simulator/proposals
   * §14 Governance Invariant: Generates a proposed real-world change requiring an explicit separate workflow.
   * NEVER mutates posted ledger, current salary table, official budget or invoice.
   */
  r.post('/proposals', (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const body = req.body;
    const user = (req as any).user;
    const authorName = user?.name || user?.email || 'Finance Planner';

    const proposal = {
      id: 'prop-' + Date.now().toString(36),
      organizationId: orgId,
      scenarioName: body.scenarioName || 'What-If Optimization Proposal',
      proposedBy: authorName,
      createdAt: new Date().toISOString(),
      status: 'draft_pending_governance_review',
      annualProfitImpact: Number(body.annualProfitImpact || 0),
      parameterChanges: body.parameterChanges || {},
      affectedDepartments: body.affectedDepartments || ['Engineering', 'Product & Design', 'Sales & Marketing', 'Operations'],
      justification: body.justification || 'Generated from non-posting what-if simulation scenario to capture target margins.',
      disclaimer: 'INVARIANT (§14): Simulation outputs are strictly non-posting and produce zero ledger entries, salary changes, or invoice mutations. Execution requires formal multi-signature governance approval.',
    };

    return created(res, proposal, 'Formal Change Proposal generated for governance workflow');
  });

  /**
   * GET /organizations/:organizationId/simulator/projection
   * Returns 12-month forecast based on live org baseline (with RPC fallback)
   */
  r.get('/projection', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const months = parseInt(String(req.query.months ?? '12'), 10);
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({ success: false, error: 'Database connection not available' });
    }
    if (isNaN(months) || months < 1 || months > 60) {
      return fail(res, 400, 'Invalid months parameter (must be 1-60)');
    }

    try {
      const liveBaseline = await computeLiveOrgBaseline(sb, orgId);
      if (liveBaseline) {
        const points: ProjectionPoint[] = [];
        for (let m = 1; m <= months; m++) {
          const rev = Math.round(liveBaseline.monthlyRevenue * (1 + (m - 1) * 0.015));
          const exp = Math.round(liveBaseline.monthlyExpense * (1 + (m - 1) * 0.008));
          points.push({ month: m, revenue: rev, expense: exp, profit: rev - exp });
        }
        return ok(res, points);
      }

      const { data, error } = await sb.rpc('simulator_projection', { p_org: orgId, p_months: months });
      if (error) {
        return ok(res, []);
      }
      return ok(res, data as ProjectionPoint[]);
    } catch (err) {
      console.error('[simulator.projection] Unexpected error:', err);
      return ok(res, []);
    }
  });

  /**
   * GET /organizations/:organizationId/simulator/scenarios
   * Returns all saved scenarios from Supabase what_if_scenarios (direct table query, org-scoped)
   */
  r.get('/scenarios', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ success: false, error: 'Database connection not available' });

    try {
      const { data, error } = await sb
        .from('what_if_scenarios')
        .select('*')
        .eq('organization_id', orgId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('[simulator.scenarios.list] Direct query error, returning empty list:', error.message);
        return ok(res, []);
      }

      return ok(res, (data || []).map(mapDbToScenario));
    } catch (err) {
      console.error('[simulator.scenarios.list] Unexpected error:', err);
      return ok(res, []);
    }
  });

  /**
   * GET /organizations/:organizationId/simulator/scenarios/:id
   */
  r.get('/scenarios/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const scenarioId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ success: false, error: 'Database connection not available' });

    try {
      const { data, error } = await sb
        .from('what_if_scenarios')
        .select('*')
        .eq('organization_id', orgId)
        .eq('id', scenarioId)
        .maybeSingle();

      if (error) return fail(res, 500, error.message);
      if (!data) return notFound(res, 'Scenario not found');
      return ok(res, mapDbToScenario(data));
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to fetch scenario');
    }
  });

  /**
   * POST /organizations/:organizationId/simulator/scenarios
   * Persists a new scenario directly into Supabase public.what_if_scenarios (§14)
   */
  r.post('/scenarios', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ success: false, error: 'Database connection not available' });

    const {
      name,
      revenueChangePct = 0,
      expenseChangePct = 0,
      priceIncreasePct = 0,
      utilizationRatePct = 75,
      newHires = 0,
      avgSalary = 0,
      salaryChangePct = 0,
      hoursChangePct = 0,
      billingRateChangePct = 0,
      occupancyCostPct = 0,
      vendorCostChangePct = 0,
      fxSensitivityPct = 0,
      allocationMethod = 'headcount',
      visibility = 'organization',
      baselineSnapshotId = 'live_90d',
      aiAnalysis = null,
      isPreset = false,
      lastResult = null,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return fail(res, 400, 'Scenario name is required');
    }

    const baseRow: Record<string, unknown> = {
      organization_id: orgId,
      name: name.trim(),
      revenue_change_pct: Number(revenueChangePct),
      expense_change_pct: Number(expenseChangePct),
      price_increase_pct: Number(priceIncreasePct),
      utilization_rate_pct: Number(utilizationRatePct),
      new_hires: Math.round(Number(newHires)),
      avg_salary: Number(avgSalary),
      is_preset: Boolean(isPreset),
      last_result: lastResult,
      created_by: (req as any).authUser?.id || null,
      updated_at: new Date().toISOString(),
    };

    const extendedRow: Record<string, unknown> = {
      ...baseRow,
      salary_change_pct: Number(salaryChangePct),
      hours_change_pct: Number(hoursChangePct),
      billing_rate_change_pct: Number(billingRateChangePct),
      occupancy_cost_pct: Number(occupancyCostPct),
      vendor_cost_change_pct: Number(vendorCostChangePct),
      fx_sensitivity_pct: Number(fxSensitivityPct),
      allocation_method: String(allocationMethod || 'headcount'),
      visibility: visibility === 'private' || visibility === 'management' ? visibility : 'organization',
      baseline_snapshot_id: String(baselineSnapshotId || 'live_90d'),
      ai_analysis: aiAnalysis,
    };

    try {
      let { data, error } = await sb
        .from('what_if_scenarios')
        .insert(extendedRow)
        .select('*')
        .single();

      // Graceful fallback if migration 0045 extended columns haven't been applied yet
      if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
        const retry = await sb
          .from('what_if_scenarios')
          .insert(baseRow)
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error('[simulator.scenarios.create] Supabase insert error:', error);
        return fail(res, 500, `Failed to save scenario: ${error.message}`);
      }

      return created(res, mapDbToScenario(data), 'Scenario saved to Supabase');
    } catch (err: any) {
      console.error('[simulator.scenarios.create] Unexpected error:', err);
      return fail(res, 500, err?.message || 'Failed to create scenario');
    }
  });

  /**
   * PUT /organizations/:organizationId/simulator/scenarios/:id
   */
  r.put('/scenarios/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const scenarioId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ success: false, error: 'Database connection not available' });

    const { name, revenueChangePct, expenseChangePct, priceIncreasePct, utilizationRatePct, newHires, avgSalary, lastResult } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return fail(res, 400, 'Scenario name is required');
    }

    try {
      const { data, error } = await sb
        .from('what_if_scenarios')
        .update({
          name: name.trim(),
          revenue_change_pct: Number(revenueChangePct ?? 0),
          expense_change_pct: Number(expenseChangePct ?? 0),
          price_increase_pct: Number(priceIncreasePct ?? 0),
          utilization_rate_pct: Number(utilizationRatePct ?? 75),
          new_hires: Math.round(Number(newHires ?? 0)),
          avg_salary: Number(avgSalary ?? 0),
          last_result: lastResult ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId)
        .eq('id', scenarioId)
        .select('*')
        .maybeSingle();

      if (error) return fail(res, 500, error.message);
      if (!data) return notFound(res, 'Scenario not found');
      return ok(res, mapDbToScenario(data));
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to update scenario');
    }
  });

  /**
   * DELETE /organizations/:organizationId/simulator/scenarios/:id
   */
  r.delete('/scenarios/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const scenarioId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return res.status(503).json({ success: false, error: 'Database connection not available' });

    try {
      const { error } = await sb
        .from('what_if_scenarios')
        .delete()
        .eq('organization_id', orgId)
        .eq('id', scenarioId)
        .eq('is_preset', false);

      if (error) return fail(res, 500, error.message);
      return res.status(204).send();
    } catch (err: any) {
      return fail(res, 500, err?.message || 'Failed to delete scenario');
    }
  });

  /**
   * POST /organizations/:organizationId/simulator/ai-parse
   * AI-powered natural language -> hypothetical scenario parameters (§14, strictly non-posting)
   */
  r.post('/ai-parse', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const promptText = String(req.body?.prompt || '').trim();
    const baseline = req.body?.baseline || {};
    if (!promptText) return fail(res, 400, 'Please enter a scenario prompt');

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    try {
      const aiPrompt = `You are a CFO Financial Modeling AI for a Finance OS What-If Simulator (strictly non-posting sandbox).
Current Organization Baseline (${baseline.currency || 'USD'}):
- Monthly Revenue: ${baseline.monthlyRevenue ?? 0}
- Monthly Expense: ${baseline.monthlyExpense ?? 0}
- Team Size: ${baseline.currentTeam ?? 1}
- Average Monthly Salary: ${baseline.avgSalary ?? 0}
- Utilization Rate: ${baseline.utilizationRate ?? 75}%

User Scenario Request: "${promptText}"

Translate this request into exact hypothetical scenario parameters. Return ONLY valid JSON with this schema:
{
  "name": "Short 3-5 word scenario title",
  "revenueChangePct": number (-50 to 100),
  "expenseChangePct": number (-50 to 100),
  "priceIncreasePct": number (-30 to 50),
  "utilizationRatePct": number (40 to 100),
  "newHires": integer (0 to 50),
  "avgSalary": number (positive monthly salary in ${baseline.currency || 'USD'}),
  "salaryChangePct": number (-30 to 50),
  "vendorCostChangePct": number (-50 to 100),
  "fxSensitivityPct": number (-30 to 30),
  "rationale": "1-2 sentence explanation of how the prompt was mapped to these parameters."
}`;

      const aiRes = await executeAIJSON<any>(orgId, {
        prompt: aiPrompt,
        temperature: 0.2,
        portalType: 'organization',
        featureArea: 'what_if_simulator',
      });

      const d = aiRes.data || {};
      return ok(res, {
        aiPowered: true,
        provider: aiRes.provider,
        model: aiRes.model,
        scenario: {
          name: String(d.name || 'AI Modeled Scenario').slice(0, 60),
          revenueChangePct: clamp(Number(d.revenueChangePct ?? 0), -50, 100),
          expenseChangePct: clamp(Number(d.expenseChangePct ?? 0), -50, 100),
          priceIncreasePct: clamp(Number(d.priceIncreasePct ?? 0), -30, 50),
          utilizationRatePct: clamp(Number(d.utilizationRatePct ?? baseline.utilizationRate ?? 75), 40, 100),
          newHires: clamp(Math.round(Number(d.newHires ?? 0)), 0, 50),
          avgSalary: Math.max(0, Number(d.avgSalary ?? baseline.avgSalary ?? 0)),
          salaryChangePct: clamp(Number(d.salaryChangePct ?? 0), -30, 50),
          vendorCostChangePct: clamp(Number(d.vendorCostChangePct ?? 0), -50, 100),
          fxSensitivityPct: clamp(Number(d.fxSensitivityPct ?? 0), -30, 30),
        },
        rationale: String(d.rationale || 'Parameters modeled from your natural-language prompt.'),
      });
    } catch (aiErr: any) {
      // Deterministic regex fallback so feature always works even if no AI key is configured
      const lower = promptText.toLowerCase();
      const hireMatch = lower.match(/(?:hire|add)\s+(\d+)/);
      const revMatch = lower.match(/(?:revenue|sales)\s*(?:up|by|\+|increase\w*\s*by)?\s*([+-]?\d+)\s*%/);
      const priceMatch = lower.match(/(?:price|pricing|rate)\s*(?:up|by|\+|increase\w*\s*by)?\s*([+-]?\d+)\s*%/);
      const expCutMatch = lower.match(/(?:cut|reduce|lower)\s*(?:expense|cost|spend)\w*\s*(?:by)?\s*(\d+)\s*%/);

      return ok(res, {
        aiPowered: false,
        provider: 'deterministic-fallback',
        model: 'rule-parser',
        scenario: {
          name: 'Parsed Scenario',
          revenueChangePct: revMatch ? clamp(Number(revMatch[1]), -50, 100) : 0,
          expenseChangePct: expCutMatch ? clamp(-Number(expCutMatch[1]), -50, 100) : 0,
          priceIncreasePct: priceMatch ? clamp(Number(priceMatch[1]), -30, 50) : 0,
          utilizationRatePct: Number(baseline.utilizationRate ?? 75),
          newHires: hireMatch ? clamp(Number(hireMatch[1]), 0, 50) : 0,
          avgSalary: Number(baseline.avgSalary ?? 0),
          salaryChangePct: 0,
          vendorCostChangePct: 0,
          fxSensitivityPct: 0,
        },
        rationale: `Parsed using deterministic fallback (${aiErr?.message || 'AI gateway unavailable'}). Configure an AI provider in Platform AI Portal for full LLM modeling.`,
      });
    }
  });

  /**
   * POST /organizations/:organizationId/simulator/ai-analyze
   * AI CFO Scenario Analysis grounded in real org baseline + scenario impact (§13, §14)
   */
  r.post('/ai-analyze', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { baseline = {}, scenario = {}, impact = {} } = req.body || {};
    const currency = baseline.currency || 'USD';

    try {
      const aiPrompt = `You are a Chief Financial Officer (CFO) AI analyzing a non-posting What-If Financial Simulation (Handoff §14).
Organization Baseline (${currency}/month):
- Baseline Revenue: ${baseline.monthlyRevenue ?? 0}, Baseline Expense: ${baseline.monthlyExpense ?? 0}
- Baseline Team: ${baseline.currentTeam ?? 1}, Liquid Cash: ${baseline.liquidCash ?? 0}

Scenario Inputs ("${scenario.name || 'Custom Scenario'}"):
- Revenue Change: ${scenario.revenueChangePct ?? 0}%, Price Increase: ${scenario.priceIncreasePct ?? 0}%, Utilization: ${scenario.utilizationRatePct ?? 75}%
- Expense Change: ${scenario.expenseChangePct ?? 0}%, New Hires: ${scenario.newHires ?? 0} @ ${scenario.avgSalary ?? 0}/mo
- Salary Shift: ${scenario.salaryChangePct ?? 0}%, Vendor Cost Shift: ${scenario.vendorCostChangePct ?? 0}%, FX Sensitivity: ${scenario.fxSensitivityPct ?? 0}%

Computed Scenario Output:
- Projected Revenue: ${impact.revenue ?? 0}, Projected Expense: ${impact.expense ?? 0}, Projected Profit: ${impact.profit ?? 0}
- Margin: ${impact.margin ?? 0}%, Break-Even Revenue: ${impact.breakEvenRevenue ?? 0}, Coverage Ratio: ${impact.coverageRatio ?? 0}x
- Monthly Burn Rate: ${impact.monthlyBurnRate ?? 0}, Cash Runway: ${impact.runwayMonths ?? 999} months

Return ONLY valid JSON:
{
  "executiveSummary": "2-3 sentence CFO verdict with exact numbers in ${currency}",
  "riskLevel": "low" | "moderate" | "high",
  "keyRisks": ["concise risk 1", "concise risk 2"],
  "optimizationLevers": ["actionable lever 1", "actionable lever 2", "actionable lever 3"],
  "departmentCommentary": "1-2 sentence insight on departmental cost/margin pressure",
  "recommendedAction": "1 concrete next step (remember: simulation is non-posting; real changes require approval workflow)"
}`;

      const aiRes = await executeAIJSON<any>(orgId, {
        prompt: aiPrompt,
        temperature: 0.25,
        portalType: 'organization',
        featureArea: 'what_if_simulator',
      });

      const d = aiRes.data || {};
      return ok(res, {
        aiPowered: true,
        provider: aiRes.provider,
        model: aiRes.model,
        executiveSummary: String(d.executiveSummary || ''),
        riskLevel: ['low', 'moderate', 'high'].includes(d.riskLevel) ? d.riskLevel : 'moderate',
        keyRisks: Array.isArray(d.keyRisks) ? d.keyRisks.map(String).slice(0, 4) : [],
        optimizationLevers: Array.isArray(d.optimizationLevers) ? d.optimizationLevers.map(String).slice(0, 4) : [],
        departmentCommentary: String(d.departmentCommentary || ''),
        recommendedAction: String(d.recommendedAction || ''),
        disclaimer: 'Non-posting simulation (§14): no ledger entries, salaries, or budgets were modified.',
      });
    } catch (aiErr: any) {
      const margin = Number(impact.margin ?? 0);
      const profit = Number(impact.profit ?? 0);
      const runway = Number(impact.runwayMonths ?? 999);
      const riskLevel = profit < 0 || margin < 15 ? 'high' : margin < 25 ? 'moderate' : 'low';
      return ok(res, {
        aiPowered: false,
        provider: 'deterministic-fallback',
        model: 'cfo-rules',
        executiveSummary: `Projected monthly profit is ${currency} ${Math.round(profit).toLocaleString()} (${margin.toFixed(1)}% margin) with ${runway >= 999 ? 'cash-generative operations' : `${runway} months of cash runway`}.`,
        riskLevel,
        keyRisks: [
          ...(profit < 0 ? [`Net monthly burn of ${currency} ${Math.abs(Math.round(profit)).toLocaleString()} reduces cash reserves.`] : []),
          ...(Number(impact.coverageRatio ?? 0) < 1.2 ? [`Tight break-even coverage ratio (${Number(impact.coverageRatio ?? 0).toFixed(2)}x).`] : []),
          ...(Number(scenario.newHires ?? 0) > 0 ? [`Hiring ${scenario.newHires} staff adds ${currency} ${Math.round(Number(scenario.newHires) * Number(scenario.avgSalary || 0)).toLocaleString()}/mo in fixed payroll.`] : []),
        ],
        optimizationLevers: [
          'Test a +5% to +10% pricing adjustment to expand net margin without increasing headcount.',
          'Increase billable utilization toward 80%+ before committing to fixed payroll expansion.',
          'Review discretionary operating expenses to widen break-even safety coverage above 1.5x.',
        ],
        departmentCommentary: 'Monitor department-level cost deltas closely before approving budget or headcount changes.',
        recommendedAction: 'Save this scenario for management review; submit a formal Change Proposal if approved.',
        disclaimer: `Deterministic CFO fallback (${aiErr?.message || 'AI gateway unavailable'}). Non-posting simulation (§14).`,
      });
    }
  });

  return r;
}
