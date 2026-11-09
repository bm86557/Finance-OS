/**
 * What-If Simulator Service
 * ==========================
 * Financial scenario modeling and projection service.
 * Handles baseline metrics, projections, and scenario CRUD.
 */

import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { getSupabaseClient, isSupabaseDataConfigured } from '@/lib/supabaseClient';
import { logUnexpectedError } from '@/lib/diagnostics';
import type { ServiceResponse } from './types';

/**
 * What-If Scenario domain type
 */
export interface WhatIfScenario {
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
  allocationMethod?: 'headcount' | 'revenue' | 'equal' | 'direct_cost';
  visibility?: 'private' | 'organization' | 'management';
  isPreset: boolean;
  lastResult?: ScenarioImpact;
  createdBy?: string;
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Baseline metrics from real org data
 */
export interface SimulatorBaseline {
  monthlyRevenue: number;
  monthlyExpense: number;
  currentTeam: number;
  avgSalary: number;
  utilizationRate: number;
  historyDays: number;
  hasSufficientHistory: boolean;
  currency: string;
  liquidCash?: number;
  snapshotId?: string;
  snapshotName?: string;
  snapshotDescription?: string;
  availableSnapshots?: Array<{ id: string; name: string; description: string }>;
  thresholds: {
    healthy_margin_pct: number;
    minimum_margin_pct: number;
    good_revenue_per_head: number;
  };
}

/**
 * Monthly projection point
 */
export interface ProjectionPoint {
  month: number;
  revenue: number;
  expense: number;
  profit: number;
}

export interface DepartmentImpactItem {
  departmentId: string;
  departmentName: string;
  baselineCost: number;
  scenarioCost: number;
  costDelta: number;
  baselineProfit: number;
  scenarioProfit: number;
  profitDelta: number;
  baselineMargin: number;
  scenarioMargin: number;
}

export interface UncertaintyCase {
  label: string;
  revenue: number;
  expense: number;
  profit: number;
  margin: number;
  runwayMonths: number;
}

/**
 * Calculated impact of a scenario
 */
export interface ScenarioImpact {
  revenue: number;
  expense: number;
  profit: number;
  profitChange: number;
  profitChangePercent: number;
  margin: number;
  totalTeam: number;
  revenuePerHead: number;
  profitPerHead: number;
  breakEvenRevenue: number;
  revenueGap: number;
  coverageRatio: number;
  monthlyBurnRate: number;
  runwayMonths: number;
  departmentImpact: DepartmentImpactItem[];
  uncertainty: {
    stressCase: UncertaintyCase;
    expectedCase: UncertaintyCase;
    bullCase: UncertaintyCase;
  };
}

/**
 * Creates the simulator service for a specific organization
 */
export function createSimulatorService(organizationId: string) {
  const basePath = `/organizations/${encodeURIComponent(organizationId)}/simulator`;

  return {
    /**
     * Get baseline metrics from real org data
     */
    async getBaseline(snapshotId?: string): Promise<ServiceResponse<SimulatorBaseline>> {
      const qs = snapshotId ? `?snapshot=${encodeURIComponent(snapshotId)}` : '';
      if (isHttpBackendConfigured()) {
        return apiGet<SimulatorBaseline>(`${basePath}/baseline${qs}`);
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        try {
          const { data, error } = await sb.rpc('simulator_baseline', {
            p_org: organizationId,
          });

          if (error) {
            logUnexpectedError('simulatorService.getBaseline', error);
            return {
              success: false,
              data: null as any,
              error: `Failed to fetch baseline: ${error.message}`,
            };
          }

          return {
            success: true,
            data: data as SimulatorBaseline,
          };
        } catch (err) {
          logUnexpectedError('simulatorService.getBaseline', err);
          return {
            success: false,
            data: null as any,
            error: 'Failed to fetch baseline metrics',
          };
        }
      }

      // Ultimate fallback: hardcoded baseline
      return {
        success: true,
        data: {
          monthlyRevenue: 2850000,
          monthlyExpense: 1900000,
          currentTeam: 20,
          avgSalary: 45000,
          utilizationRate: 75,
          historyDays: 0,
          hasSufficientHistory: false,
          currency: 'PKR',
          thresholds: {
            healthy_margin_pct: 30,
            minimum_margin_pct: 20,
            good_revenue_per_head: 140000,
          },
        },
      };
    },

    /**
     * Get 12-month projection based on historical growth
     */
    async getProjection(months: number = 12): Promise<ServiceResponse<ProjectionPoint[]>> {
      if (isHttpBackendConfigured()) {
        return apiGet<ProjectionPoint[]>(`${basePath}/projection?months=${months}`);
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        try {
          const { data, error } = await sb.rpc('simulator_projection', {
            p_org: organizationId,
            p_months: months,
          });

          if (error) {
            logUnexpectedError('simulatorService.getProjection', error);
            return {
              success: false,
              data: null as any,
              error: `Failed to generate projection: ${error.message}`,
            };
          }

          return {
            success: true,
            data: data as ProjectionPoint[],
          };
        } catch (err) {
          logUnexpectedError('simulatorService.getProjection', err);
          return {
            success: false,
            data: null as any,
            error: 'Failed to generate projection',
          };
        }
      }

      // Ultimate fallback: empty projection
      return {
        success: true,
        data: [],
      };
    },

    /**
     * Get all saved scenarios
     */
    async getAllScenarios(): Promise<ServiceResponse<WhatIfScenario[]>> {
      if (isHttpBackendConfigured()) {
        return apiGet<WhatIfScenario[]>(`${basePath}/scenarios`);
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        try {
          const { data, error } = await sb.rpc('what_if_scenarios_list', {
            p_org: organizationId,
          });

          if (error) {
            logUnexpectedError('simulatorService.getAllScenarios', error);
            return {
              success: false,
              data: null as any,
              error: `Failed to fetch scenarios: ${error.message}`,
            };
          }

          // Map snake_case to camelCase
          const scenarios: WhatIfScenario[] = (data || []).map((row: any) => ({
            id: row.id,
            organizationId: row.organization_id,
            name: row.name,
            revenueChangePct: Number(row.revenue_change_pct ?? 0),
            expenseChangePct: Number(row.expense_change_pct ?? 0),
            priceIncreasePct: Number(row.price_increase_pct ?? 0),
            utilizationRatePct: Number(row.utilization_rate_pct ?? 75),
            newHires: Number(row.new_hires ?? 0),
            avgSalary: Number(row.avg_salary ?? 0),
            isPreset: Boolean(row.is_preset ?? false),
            lastResult: row.last_result,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));

          return {
            success: true,
            data: scenarios,
          };
        } catch (err) {
          logUnexpectedError('simulatorService.getAllScenarios', err);
          return {
            success: false,
            data: null as any,
            error: 'Failed to fetch scenarios',
          };
        }
      }

      // Ultimate fallback: empty list
      return {
        success: true,
        data: [],
      };
    },

    /**
     * Get a single scenario by ID
     */
    async getScenario(scenarioId: string): Promise<ServiceResponse<WhatIfScenario | null>> {
      if (isHttpBackendConfigured()) {
        return apiGet<WhatIfScenario>(`${basePath}/scenarios/${encodeURIComponent(scenarioId)}`);
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        try {
          const { data, error } = await sb.rpc('what_if_scenarios_get', {
            p_org: organizationId,
            p_id: scenarioId,
          });

          if (error) {
            logUnexpectedError('simulatorService.getScenario', error);
            return {
              success: false,
              data: null as any,
              error: `Failed to fetch scenario: ${error.message}`,
            };
          }

          if (!data) {
            return {
              success: true,
              data: null,
            };
          }

          const scenario: WhatIfScenario = {
            id: data.id,
            organizationId: data.organization_id,
            name: data.name,
            revenueChangePct: Number(data.revenue_change_pct ?? 0),
            expenseChangePct: Number(data.expense_change_pct ?? 0),
            priceIncreasePct: Number(data.price_increase_pct ?? 0),
            utilizationRatePct: Number(data.utilization_rate_pct ?? 75),
            newHires: Number(data.new_hires ?? 0),
            avgSalary: Number(data.avg_salary ?? 0),
            isPreset: Boolean(data.is_preset ?? false),
            lastResult: data.last_result,
            createdBy: data.created_by,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };

          return {
            success: true,
            data: scenario,
          };
        } catch (err) {
          logUnexpectedError('simulatorService.getScenario', err);
          return {
            success: false,
            data: null as any,
            error: 'Failed to fetch scenario',
          };
        }
      }

      return {
        success: true,
        data: null,
      };
    },

    /**
     * Create a new scenario
     */
    async createScenario(scenario: Omit<WhatIfScenario, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<ServiceResponse<WhatIfScenario>> {
      if (isHttpBackendConfigured()) {
        return apiPostJson<typeof scenario, WhatIfScenario>(`${basePath}/scenarios`, scenario);
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        try {
          const { data, error } = await sb.rpc('what_if_scenarios_save', {
            p_org: organizationId,
            p_id: null,
            p_name: scenario.name,
            p_revenue_change_pct: scenario.revenueChangePct,
            p_expense_change_pct: scenario.expenseChangePct,
            p_price_increase_pct: scenario.priceIncreasePct,
            p_utilization_rate_pct: scenario.utilizationRatePct,
            p_new_hires: scenario.newHires,
            p_avg_salary: scenario.avgSalary,
            p_is_preset: scenario.isPreset ?? false,
            p_last_result: scenario.lastResult ?? null,
          });

          if (error) {
            logUnexpectedError('simulatorService.createScenario', error);
            return {
              success: false,
              data: null as any,
              error: `Failed to create scenario: ${error.message}`,
            };
          }

          const created: WhatIfScenario = {
            id: data.id,
            organizationId: data.organization_id,
            name: data.name,
            revenueChangePct: Number(data.revenue_change_pct ?? 0),
            expenseChangePct: Number(data.expense_change_pct ?? 0),
            priceIncreasePct: Number(data.price_increase_pct ?? 0),
            utilizationRatePct: Number(data.utilization_rate_pct ?? 75),
            newHires: Number(data.new_hires ?? 0),
            avgSalary: Number(data.avg_salary ?? 0),
            isPreset: Boolean(data.is_preset ?? false),
            lastResult: data.last_result,
            createdBy: data.created_by,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };

          return {
            success: true,
            data: created,
          };
        } catch (err) {
          logUnexpectedError('simulatorService.createScenario', err);
          return {
            success: false,
            data: null as any,
            error: 'Failed to create scenario',
          };
        }
      }

      return {
        success: false,
        data: null as any,
        error: 'No backend available',
      };
    },

    /**
     * Update an existing scenario
     */
    async updateScenario(scenarioId: string, updates: Partial<Omit<WhatIfScenario, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'createdBy'>>): Promise<ServiceResponse<WhatIfScenario>> {
      if (isHttpBackendConfigured()) {
        return apiRequest<WhatIfScenario>(`${basePath}/scenarios/${encodeURIComponent(scenarioId)}`, {
          method: 'PUT',
          body: JSON.stringify(updates),
        });
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        // First fetch the current scenario
        const currentResponse = await this.getScenario(scenarioId);
        if (!currentResponse.success || !currentResponse.data) {
          return {
            success: false,
            data: null as any,
            error: 'Scenario not found',
          };
        }

        const current = currentResponse.data;

        try {
          const { data, error } = await sb.rpc('what_if_scenarios_save', {
            p_org: organizationId,
            p_id: scenarioId,
            p_name: updates.name ?? current.name,
            p_revenue_change_pct: updates.revenueChangePct ?? current.revenueChangePct,
            p_expense_change_pct: updates.expenseChangePct ?? current.expenseChangePct,
            p_price_increase_pct: updates.priceIncreasePct ?? current.priceIncreasePct,
            p_utilization_rate_pct: updates.utilizationRatePct ?? current.utilizationRatePct,
            p_new_hires: updates.newHires ?? current.newHires,
            p_avg_salary: updates.avgSalary ?? current.avgSalary,
            p_is_preset: false,
            p_last_result: updates.lastResult ?? current.lastResult ?? null,
          });

          if (error) {
            logUnexpectedError('simulatorService.updateScenario', error);
            return {
              success: false,
              data: null as any,
              error: `Failed to update scenario: ${error.message}`,
            };
          }

          const updated: WhatIfScenario = {
            id: data.id,
            organizationId: data.organization_id,
            name: data.name,
            revenueChangePct: Number(data.revenue_change_pct ?? 0),
            expenseChangePct: Number(data.expense_change_pct ?? 0),
            priceIncreasePct: Number(data.price_increase_pct ?? 0),
            utilizationRatePct: Number(data.utilization_rate_pct ?? 75),
            newHires: Number(data.new_hires ?? 0),
            avgSalary: Number(data.avg_salary ?? 0),
            isPreset: Boolean(data.is_preset ?? false),
            lastResult: data.last_result,
            createdBy: data.created_by,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };

          return {
            success: true,
            data: updated,
          };
        } catch (err) {
          logUnexpectedError('simulatorService.updateScenario', err);
          return {
            success: false,
            data: null as any,
            error: 'Failed to update scenario',
          };
        }
      }

      return {
        success: false,
        data: null as any,
        error: 'No backend available',
      };
    },

    /**
     * Delete a scenario
     */
    async deleteScenario(scenarioId: string): Promise<ServiceResponse<void>> {
      if (isHttpBackendConfigured()) {
        return apiRequest(`${basePath}/scenarios/${encodeURIComponent(scenarioId)}`, {
          method: 'DELETE',
        });
      }

      // Fallback to Supabase direct
      if (isSupabaseDataConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) {
          return {
            success: false,
            data: null as any,
            error: 'Database client not initialized',
          };
        }

        try {
          const { error } = await sb.rpc('what_if_scenarios_delete', {
            p_org: organizationId,
            p_id: scenarioId,
          });

          if (error) {
            logUnexpectedError('simulatorService.deleteScenario', error);
            return {
              success: false,
              data: undefined,
              error: `Failed to delete scenario: ${error.message}`,
            };
          }

          return {
            success: true,
            data: undefined,
          };
        } catch (err) {
          logUnexpectedError('simulatorService.deleteScenario', err);
          return {
            success: false,
            data: undefined,
            error: 'Failed to delete scenario',
          };
        }
      }

      return {
        success: false,
        data: null as any,
        error: 'No backend available',
      };
    },

    /**
     * Calculate the impact of a scenario
     * This is a client-side calculation based on baseline and scenario parameters
     */
    calculateImpact(baseline: SimulatorBaseline, scenario: Partial<WhatIfScenario>): ScenarioImpact {
      const revenueChangePct = scenario.revenueChangePct ?? 0;
      const expenseChangePct = scenario.expenseChangePct ?? 0;
      const priceIncreasePct = scenario.priceIncreasePct ?? 0;
      const utilizationRatePct = scenario.utilizationRatePct ?? baseline.utilizationRate;
      const newHires = scenario.newHires ?? 0;
      const avgSalary = scenario.avgSalary ?? baseline.avgSalary;

      // Additional §14 input drivers
      const salaryChangePct = scenario.salaryChangePct ?? 0;
      const hoursChangePct = scenario.hoursChangePct ?? 0;
      const billingRateChangePct = scenario.billingRateChangePct ?? 0;
      const occupancyCostPct = scenario.occupancyCostPct ?? 0;
      const vendorCostChangePct = scenario.vendorCostChangePct ?? 0;
      const fxSensitivityPct = scenario.fxSensitivityPct ?? 0;

      // 1. Revenue with compounding effects (volume, price elasticity, utilization, rate shift, FX)
      const baseRev = baseline.monthlyRevenue;
      const revenueFromVol = baseRev * (1 + revenueChangePct / 100);
      const revenueFromPrice = revenueFromVol * (1 + priceIncreasePct / 100);
      const revenueFromRate = revenueFromPrice * (1 + billingRateChangePct / 100);
      const revenueFromHours = revenueFromRate * (1 + hoursChangePct / 100);
      const revenueFromUtil = baseline.utilizationRate > 0 
        ? revenueFromHours * (utilizationRatePct / baseline.utilizationRate)
        : revenueFromHours;
      const revenueFromFx = revenueFromUtil * (1 + fxSensitivityPct / 100);
      const projectedRevenue = Math.round(revenueFromFx);

      // 2. Expense calculation (salary adjustments, occupancy, vendor shifts, new hires)
      const baseExp = baseline.monthlyExpense;
      const effectiveSalary = avgSalary * (1 + salaryChangePct / 100);
      const salaryShiftImpact = (effectiveSalary - avgSalary) * baseline.currentTeam;
      const occupancyShift = baseExp * 0.15 * (occupancyCostPct / 100);
      const vendorShift = baseExp * 0.20 * (vendorCostChangePct / 100);
      const generalExpenseShift = baseExp * (expenseChangePct / 100);
      const newHireCost = newHires * effectiveSalary;

      const projectedExpense = Math.round(Math.max(0, baseExp + generalExpenseShift + salaryShiftImpact + newHireCost + occupancyShift + vendorShift));

      // 3. Profit & Margin
      const projectedProfit = projectedRevenue - projectedExpense;
      const currentProfit = baseline.monthlyRevenue - baseline.monthlyExpense;
      const profitChange = projectedProfit - currentProfit;
      const profitChangePercent = currentProfit !== 0 ? (profitChange / Math.abs(currentProfit)) * 100 : 0;
      const margin = projectedRevenue > 0 ? (projectedProfit / projectedRevenue) * 100 : 0;

      // 4. Team metrics
      const totalTeam = Math.max(1, baseline.currentTeam + newHires);
      const revenuePerHead = Math.round(projectedRevenue / totalTeam);
      const profitPerHead = Math.round(projectedProfit / totalTeam);

      // 5. Break-even & Cash Runway (§14)
      const breakEvenRevenue = projectedExpense;
      const revenueGap = projectedRevenue - breakEvenRevenue;
      const coverageRatio = breakEvenRevenue > 0 ? projectedRevenue / breakEvenRevenue : 0;
      const monthlyBurnRate = projectedProfit < 0 ? Math.abs(projectedProfit) : 0;
      const liquidCash = baseline.liquidCash ?? 12500000;
      const runwayMonths = monthlyBurnRate > 0 ? Math.round((liquidCash / monthlyBurnRate) * 10) / 10 : 999;

      // 6. Department Impact Breakdown (§14)
      const depts = [
        { id: 'dept-dev', name: 'Development & Engineering', weight: 0.55 },
        { id: 'dept-des', name: 'Product & Design', weight: 0.15 },
        { id: 'dept-qa', name: 'QA & Golden Testing', weight: 0.10 },
        { id: 'dept-sales', name: 'Sales & Growth', weight: 0.12 },
        { id: 'dept-ops', name: 'Operations & G&A', weight: 0.08 },
      ];

      const departmentImpact: DepartmentImpactItem[] = depts.map(d => {
        const bCost = Math.round(baseline.monthlyExpense * d.weight);
        const sCost = Math.round(projectedExpense * d.weight);
        const bRev = Math.round(baseline.monthlyRevenue * d.weight);
        const sRev = Math.round(projectedRevenue * d.weight);
        const bProf = bRev - bCost;
        const sProf = sRev - sCost;
        return {
          departmentId: d.id,
          departmentName: d.name,
          baselineCost: bCost,
          scenarioCost: sCost,
          costDelta: sCost - bCost,
          baselineProfit: bProf,
          scenarioProfit: sProf,
          profitDelta: sProf - bProf,
          baselineMargin: bRev > 0 ? (bProf / bRev) * 100 : 0,
          scenarioMargin: sRev > 0 ? (sProf / sRev) * 100 : 0,
        };
      });

      // 7. Uncertainty Envelope (§14: stress case, expected, bull case)
      const stressRev = Math.round(projectedRevenue * 0.85);
      const stressExp = Math.round(projectedExpense * 1.08);
      const stressProf = stressRev - stressExp;
      const stressBurn = stressProf < 0 ? Math.abs(stressProf) : 0;

      const bullRev = Math.round(projectedRevenue * 1.15);
      const bullExp = Math.round(projectedExpense * 0.96);
      const bullProf = bullRev - bullExp;
      const bullBurn = bullProf < 0 ? Math.abs(bullProf) : 0;

      return {
        revenue: projectedRevenue,
        expense: projectedExpense,
        profit: projectedProfit,
        profitChange,
        profitChangePercent,
        margin: Math.round(margin * 10) / 10,
        totalTeam,
        revenuePerHead,
        profitPerHead,
        breakEvenRevenue,
        revenueGap,
        coverageRatio: Math.round(coverageRatio * 100) / 100,
        monthlyBurnRate,
        runwayMonths,
        departmentImpact,
        uncertainty: {
          stressCase: {
            label: 'Stress Downside (-15% Rev, +8% Cost)',
            revenue: stressRev,
            expense: stressExp,
            profit: stressProf,
            margin: stressRev > 0 ? Math.round((stressProf / stressRev) * 1000) / 10 : 0,
            runwayMonths: stressBurn > 0 ? Math.round((liquidCash / stressBurn) * 10) / 10 : 999,
          },
          expectedCase: {
            label: 'Expected Plan Scenario',
            revenue: projectedRevenue,
            expense: projectedExpense,
            profit: projectedProfit,
            margin: Math.round(margin * 10) / 10,
            runwayMonths,
          },
          bullCase: {
            label: 'Bull Upside (+15% Rev, -4% Cost)',
            revenue: bullRev,
            expense: bullExp,
            profit: bullProf,
            margin: bullRev > 0 ? Math.round((bullProf / bullRev) * 1000) / 10 : 0,
            runwayMonths: bullBurn > 0 ? Math.round((liquidCash / bullBurn) * 10) / 10 : 999,
          },
        },
      };
    },

    /**
     * Generate an explicit proposed real-world change proposal (§14)
     * Strictly non-posting; does NOT mutate real books or salaries.
     */
    async createChangeProposal(proposalData: any) {
      if (isHttpBackendConfigured()) {
        return apiPostJson(`${basePath}/proposals`, proposalData);
      }
      return {
        success: true,
        data: {
          id: 'prop-' + Date.now().toString(36),
          status: 'draft_pending_governance_review',
          ...proposalData,
          createdAt: new Date().toISOString(),
          disclaimer: 'INVARIANT (§14): Simulation outputs are strictly non-posting and produce zero ledger entries, salary changes, or invoice mutations. Execution requires formal governance approval.',
        },
      };
    },
  };
}
