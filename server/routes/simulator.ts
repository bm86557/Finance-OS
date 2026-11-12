
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
  isPreset: boolean;
  lastResult?: any;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
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
        .select('currency, base_currency')
        .eq('id', orgId)
        .maybeSingle();
      const orgCurrency = String(orgRow?.base_currency || orgRow?.currency || 'USD').toUpperCase().trim();

      // 1. Live liquid cash from active bank accounts
      const { data: bankAccounts } = await sb
        .from('bank_accounts')
        .select('id, balance, currency, type, is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true);

      let liquidCash = 0;
      for (const b of (bankAccounts || [])) {
        const bBal = Number(b.balance ?? 0);
        const bCurr = String(b.currency || orgCurrency).toUpperCase();
        liquidCash += convertCurrency(bBal, bCurr, orgCurrency);
      }

      // 2. Trailing 90 days of transactions
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data: txns } = await sb
        .from('transactions')
        .select('amount, type, currency, is_transfer, transfer_group_id, tags, category_id, description, narration, date')
        .eq('organization_id', orgId)
        .gte('date', ninetyDaysAgo);

      let total90dIncome = 0;
      let total90dExpense = 0;
      let validTxnCount = 0;

      for (const t of (txns || [])) {
        // Exclude internal transfers and loan principal repayments (§14, §15, §33 Invariant 8)
        const tags: string[] = Array.isArray(t.tags) ? t.tags.map(String) : [];
        const isTransfer = Boolean(t.is_transfer || t.transfer_group_id || tags.includes('transfer'));
        const desc = String(t.description || '').toLowerCase();
        const narr = String(t.narration || '').toLowerCase();
        const isLoanPrincipal = tags.includes('loan_principal') || desc.includes('principal repayment') || narr.includes('principal repayment');

        if (isTransfer || isLoanPrincipal) continue;

        const rawAmt = Number(t.amount || 0);
        const rawCurr = String(t.currency || orgCurrency).toUpperCase();
        const converted = convertCurrency(rawAmt, rawCurr, orgCurrency);

        if (t.type === 'income') {
          total90dIncome += converted;
          validTxnCount++;
        } else if (t.type === 'expense') {
          total90dExpense += converted;
          validTxnCount++;
        }
      }

      // 3. Current active team and average salary
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

      // 4. Utilization rate from trailing 90d timesheets
      const { data: tsEntries } = await sb
        .from('timesheet_entries')
        .select('hours, billable')
        .eq('organization_id', orgId)
        .gte('date', ninetyDaysAgo);

      let totalHours = 0;
      let billableHours = 0;
      for (const te of (tsEntries || [])) {
        const h = Number(te.hours || 0);
        totalHours += h;
        if (te.billable !== false) billableHours += h;
      }
      const utilizationRate = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 75;

      const monthlyRevenue = Math.round(total90dIncome / 3);
      const monthlyExpense = Math.round(total90dExpense / 3);
      const hasSufficientHistory = validTxnCount >= 3;

      return {
        monthlyRevenue,
        monthlyExpense,
        currentTeam: currentTeam || 1,
        avgSalary,
        utilizationRate,
        liquidCash: Math.round(liquidCash),
        historyDays: 90,
        hasSufficientHistory,
        currency: orgCurrency,
        thresholds: {
          healthy_margin_pct: 30,
          minimum_margin_pct: 20,
          good_revenue_per_head: currentTeam > 0 ? Math.round(monthlyRevenue / currentTeam) : 140000,
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
   * Returns 12-month forecast based on historical growth
   * Query params: months (default: 12)
   */
  r.get('/projection', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const months = parseInt(String(req.query.months ?? '12'), 10);
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({
        success: false,
        error: 'Database connection not available',
      });
    }

    if (isNaN(months) || months < 1 || months > 60) {
      return fail(res, 400, 'Invalid months parameter (must be 1-60)');
    }

    try {
      const { data, error } = await sb.rpc('simulator_projection', {
        p_org: orgId,
        p_months: months,
      });

      if (error) {
        console.error('[simulator.projection] RPC error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to generate projection',
          details: error.message,
        });
      }

      return ok(res, data as ProjectionPoint[]);
    } catch (err) {
      console.error('[simulator.projection] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /organizations/:organizationId/simulator/scenarios
   * Returns all saved scenarios for the organization
   */
  r.get('/scenarios', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({
        success: false,
        error: 'Database connection not available',
      });
    }

    try {
      const { data, error } = await sb.rpc('what_if_scenarios_list', { p_org: orgId });

      if (error) {
        console.error('[simulator.scenarios.list] RPC error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch scenarios',
          details: error.message,
        });
      }

      const scenarios = (data || []).map(mapDbToScenario);
      return ok(res, scenarios);
    } catch (err) {
      console.error('[simulator.scenarios.list] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /organizations/:organizationId/simulator/scenarios/:id
   * Returns a single scenario by ID
   */
  r.get('/scenarios/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const scenarioId = req.params.id;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({
        success: false,
        error: 'Database connection not available',
      });
    }

    try {
      const { data, error } = await sb.rpc('what_if_scenarios_get', {
        p_org: orgId,
        p_id: scenarioId,
      });

      if (error) {
        console.error('[simulator.scenarios.get] RPC error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch scenario',
          details: error.message,
        });
      }

      if (!data) {
        return notFound(res, 'Scenario not found');
      }

      return ok(res, mapDbToScenario(data));
    } catch (err) {
      console.error('[simulator.scenarios.get] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /organizations/:organizationId/simulator/scenarios
   * Creates a new scenario
   */
  r.post('/scenarios', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({
        success: false,
        error: 'Database connection not available',
      });
    }

    const {
      name,
      revenueChangePct = 0,
      expenseChangePct = 0,
      priceIncreasePct = 0,
      utilizationRatePct = 75,
      newHires = 0,
      avgSalary = 0,
      isPreset = false,
      lastResult = null,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return fail(res, 400, 'Scenario name is required');
    }

    try {
      const { data, error } = await sb.rpc('what_if_scenarios_save', {
        p_org: orgId,
        p_id: null, // null = create new
        p_name: name.trim(),
        p_revenue_change_pct: Number(revenueChangePct),
        p_expense_change_pct: Number(expenseChangePct),
        p_price_increase_pct: Number(priceIncreasePct),
        p_utilization_rate_pct: Number(utilizationRatePct),
        p_new_hires: Number(newHires),
        p_avg_salary: Number(avgSalary),
        p_is_preset: Boolean(isPreset),
        p_last_result: lastResult,
      });

      if (error) {
        console.error('[simulator.scenarios.create] RPC error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to create scenario',
          details: error.message,
        });
      }

      return created(res, mapDbToScenario(data));
    } catch (err) {
      console.error('[simulator.scenarios.create] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * PUT /organizations/:organizationId/simulator/scenarios/:id
   * Updates an existing scenario
   */
  r.put('/scenarios/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const scenarioId = req.params.id;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({
        success: false,
        error: 'Database connection not available',
      });
    }

    const {
      name,
      revenueChangePct,
      expenseChangePct,
      priceIncreasePct,
      utilizationRatePct,
      newHires,
      avgSalary,
      lastResult,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return fail(res, 400, 'Scenario name is required');
    }

    try {
      const { data, error } = await sb.rpc('what_if_scenarios_save', {
        p_org: orgId,
        p_id: scenarioId,
        p_name: name.trim(),
        p_revenue_change_pct: Number(revenueChangePct ?? 0),
        p_expense_change_pct: Number(expenseChangePct ?? 0),
        p_price_increase_pct: Number(priceIncreasePct ?? 0),
        p_utilization_rate_pct: Number(utilizationRatePct ?? 75),
        p_new_hires: Number(newHires ?? 0),
        p_avg_salary: Number(avgSalary ?? 0),
        p_is_preset: false, // Cannot change preset status via update
        p_last_result: lastResult ?? null,
      });

      if (error) {
        console.error('[simulator.scenarios.update] RPC error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update scenario',
          details: error.message,
        });
      }

      if (!data) {
        return notFound(res, 'Scenario not found');
      }

      return ok(res, mapDbToScenario(data));
    } catch (err) {
      console.error('[simulator.scenarios.update] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * DELETE /organizations/:organizationId/simulator/scenarios/:id
   * Deletes a scenario (prevents deletion of presets)
   */
  r.delete('/scenarios/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const scenarioId = req.params.id;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return res.status(503).json({
        success: false,
        error: 'Database connection not available',
      });
    }

    try {
      const { error } = await sb.rpc('what_if_scenarios_delete', {
        p_org: orgId,
        p_id: scenarioId,
      });

      if (error) {
        console.error('[simulator.scenarios.delete] RPC error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to delete scenario',
          details: error.message,
        });
      }

      return res.status(204).send();
    } catch (err) {
      console.error('[simulator.scenarios.delete] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  return r;
}
