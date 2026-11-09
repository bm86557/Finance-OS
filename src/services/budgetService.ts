/**
 * Budget Service
 * ===============
 * CRUD for budgets with tracking, variance analysis, and template support.
 *
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes backed by
 * Supabase (server/routes/budgets.ts). Falls back to local `dataStore`.
 */

import { Budget } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';

const BUD = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/budgets`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export type BudgetVarianceRow = {
  budgetId: string;
  name: string;
  category?: string;
  categoryId?: string;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number;
  utilizationPercent?: number;
  threshold?: number;
  status: string;
  isOverBudget: boolean;
};

export type BudgetAlert = {
  budgetId: string;
  name: string;
  category?: string;
  budgeted: number;
  actual: number;
  utilizationPercent: number;
  threshold: number;
  severity: 'warning' | 'error';
  message: string;
};

export interface BudgetSummary {
  totalBudgeted: number;
  totalSpent: number;
  remaining: number;
  utilizationPct: number;
  activeCount: number;
  warningCount: number;
  exceededCount: number;
  totalCount: number;
  byCategory: Record<string, { budgeted: number; spent: number; count: number; name?: string }>;
}

export const budgetService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Budget[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Budget[]>(organizationId);
      if (err) return err;
      return apiGet<Budget[]>(BUD(organizationId));
    }

    await simulateDelay();
    return { success: true, data: dataStore.budgets.filter(b => b.organizationId === organizationId) };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Budget | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${BUD(organizationId)}/${encodeURIComponent(id)}`
        : `/budgets/${encodeURIComponent(id)}`;
      return apiGet<Budget | null>(path);
    }

    await simulateDelay(80);
    const budget = dataStore.budgets.find(b => b.id === id) || null;
    return { success: !!budget, data: budget };
  },

  async create(
    organizationId: string,
    data: Omit<Budget, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<Budget>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Budget>(organizationId);
      if (err) return err;
      return apiPostJson<Omit<Budget, 'id' | 'organizationId'>, Budget>(BUD(organizationId), data);
    }

    await simulateDelay(200);

    if (data.departmentId && data.departmentId !== 'none') {
      const dept = dataStore.departments.find(d => d.id === data.departmentId);
      if (dept && dept.budget != null && dept.budget > 0) {
        if (data.budgetedAmount > dept.budget) {
          return { success: false, data: null as any, error: `Budget amount exceeds ${dept.name} budget limit of ${dept.budget}` };
        }
        const otherTotal = dataStore.budgets
          .filter(b => b.organizationId === organizationId && b.departmentId === data.departmentId)
          .reduce((sum, b) => sum + (Number(b.budgetedAmount) || 0), 0);
        if (otherTotal + data.budgetedAmount > dept.budget) {
          const avail = Math.max(0, dept.budget - otherTotal);
          return { success: false, data: null as any, error: `Total planned budgets exceed ${dept.name} budget limit of ${dept.budget}. Available: ${avail}` };
        }
      }
    }

    const newBudget: Budget = { ...data, id: generateId('budget'), organizationId };
    dataStore.budgets.push(newBudget);
    dataStore.notify('budgets');
    return { success: true, data: newBudget, message: 'Budget created' };
  },

  async update(
    id: string,
    updates: Partial<Budget>,
    organizationId?: string,
  ): Promise<ServiceResponse<Budget>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${BUD(organizationId)}/${encodeURIComponent(id)}`
        : `/budgets/${encodeURIComponent(id)}`;
      return apiRequest<Budget>(path, { method: 'PATCH', body: JSON.stringify(updates) });
    }

    await simulateDelay(150);
    const idx = dataStore.budgets.findIndex(b => b.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Budget not found' };

    const existing = dataStore.budgets[idx];
    const targetDeptId = updates.departmentId !== undefined ? updates.departmentId : existing.departmentId;
    const targetAmount = updates.budgetedAmount !== undefined ? updates.budgetedAmount : existing.budgetedAmount;

    if (targetDeptId && targetDeptId !== 'none') {
      const dept = dataStore.departments.find(d => d.id === targetDeptId);
      if (dept && dept.budget != null && dept.budget > 0) {
        if (targetAmount > dept.budget) {
          return { success: false, data: null as any, error: `Budget amount exceeds ${dept.name} budget limit of ${dept.budget}` };
        }
        const otherTotal = dataStore.budgets
          .filter(b => b.id !== id && b.departmentId === targetDeptId)
          .reduce((sum, b) => sum + (Number(b.budgetedAmount) || 0), 0);
        if (otherTotal + targetAmount > dept.budget) {
          const avail = Math.max(0, dept.budget - otherTotal);
          return { success: false, data: null as any, error: `Total planned budgets exceed ${dept.name} budget limit of ${dept.budget}. Available: ${avail}` };
        }
      }
    }

    dataStore.budgets[idx] = { ...dataStore.budgets[idx], ...updates };
    dataStore.notify('budgets');
    return { success: true, data: dataStore.budgets[idx] };
  },

  async approve(organizationId: string, id: string): Promise<ServiceResponse<Budget>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<Budget>(`${BUD(organizationId)}/${encodeURIComponent(id)}/approve`, { method: 'POST' });
    }
    const b = dataStore.budgets.find(item => item.id === id);
    if (!b) return { success: false, data: null as any, error: 'Budget not found' };
    b.lifecycleStatus = 'approved';
    b.approvedAt = new Date().toISOString();
    return { success: true, data: b };
  },

  async lock(organizationId: string, id: string): Promise<ServiceResponse<Budget>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<Budget>(`${BUD(organizationId)}/${encodeURIComponent(id)}/lock`, { method: 'POST' });
    }
    const b = dataStore.budgets.find(item => item.id === id);
    if (!b) return { success: false, data: null as any, error: 'Budget not found' };
    b.lifecycleStatus = 'locked';
    return { success: true, data: b };
  },

  async getHistory(organizationId: string, id: string): Promise<ServiceResponse<Budget[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<Budget[]>(`${BUD(organizationId)}/${encodeURIComponent(id)}/history`);
    }
    return { success: true, data: dataStore.budgets.filter(item => item.id === id || item.parentBudgetId === id) };
  },

  async acknowledgeAlert(organizationId: string, alertId: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiRequest<any>(`${BUD(organizationId)}/alerts/${encodeURIComponent(alertId)}/acknowledge`, { method: 'POST' });
    }
    return { success: true, data: { id: alertId, deliveryStatus: 'acknowledged' } };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${BUD(organizationId)}/${encodeURIComponent(id)}`
        : `/budgets/${encodeURIComponent(id)}`;
      return apiRequest<null>(path, { method: 'DELETE' });
    }

    await simulateDelay(150);
    const idx = dataStore.budgets.findIndex(b => b.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Budget not found' };
    dataStore.budgets.splice(idx, 1);
    dataStore.notify('budgets');
    return { success: true, data: null, message: 'Budget deleted' };
  },

  async getVarianceAnalysis(organizationId: string): Promise<ServiceResponse<BudgetVarianceRow[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<BudgetVarianceRow[]>(organizationId);
      if (err) return err;
      return apiGet<BudgetVarianceRow[]>(`${BUD(organizationId)}/variance`);
    }

    await simulateDelay();

    const budgets = dataStore.budgets.filter(b => b.organizationId === organizationId);
    const analysis = budgets.map(budget => {
      const variance = budget.budgetedAmount - budget.spentAmount;
      const variancePercent = budget.budgetedAmount > 0
        ? (variance / budget.budgetedAmount) * 100
        : 0;
      const utilization = budget.budgetedAmount > 0
        ? (budget.spentAmount / budget.budgetedAmount) * 100
        : 0;
      const threshold = budget.alertThreshold ?? 80;
      const isOverBudget = budget.spentAmount > budget.budgetedAmount;
      const status = isOverBudget ? 'exceeded' : utilization >= threshold ? 'warning' : 'on-track';

      return {
        budgetId: budget.id,
        name: budget.name,
        category: budget.categoryId || 'General',
        categoryId: budget.categoryId,
        budgeted: budget.budgetedAmount,
        actual: budget.spentAmount,
        variance,
        variancePercent: Math.round(variancePercent * 10) / 10,
        utilizationPercent: Math.round(utilization * 10) / 10,
        threshold,
        status,
        isOverBudget,
      };
    });

    return { success: true, data: analysis };
  },

  async getAlerts(organizationId: string): Promise<ServiceResponse<BudgetAlert[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<BudgetAlert[]>(organizationId);
      if (err) return err;
      return apiGet<BudgetAlert[]>(`${BUD(organizationId)}/alerts`);
    }

    await simulateDelay();
    const alerts: BudgetAlert[] = dataStore.budgets
      .filter(b => b.organizationId === organizationId)
      .filter(b => {
        const threshold = b.alertThreshold ?? 80;
        const utilization = b.budgetedAmount > 0 ? (b.spentAmount / b.budgetedAmount) * 100 : 0;
        return utilization >= threshold;
      })
      .map(b => {
        const threshold = b.alertThreshold ?? 80;
        const utilization = b.budgetedAmount > 0 ? (b.spentAmount / b.budgetedAmount) * 100 : 0;
        const isOver = b.spentAmount > b.budgetedAmount;
        return {
          budgetId: b.id,
          name: b.name,
          category: b.categoryId || 'General',
          budgeted: b.budgetedAmount,
          actual: b.spentAmount,
          utilizationPercent: Math.round(utilization * 10) / 10,
          threshold,
          severity: isOver ? 'error' : 'warning',
          message: isOver
            ? `Budget exceeded by ${(b.spentAmount - b.budgetedAmount).toFixed(2)} ${b.currency}`
            : `At ${Math.round(utilization)}% of limit (${threshold}% threshold)`,
        };
      });

    return { success: true, data: alerts };
  },

  async getSummary(organizationId: string): Promise<ServiceResponse<BudgetSummary>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<BudgetSummary>(organizationId);
      if (err) return err;
      return apiGet<BudgetSummary>(`${BUD(organizationId)}/summary`);
    }

    await simulateDelay();
    const budgets = dataStore.budgets.filter(b => b.organizationId === organizationId);
    const totalBudgeted = budgets.reduce((s, b) => s + b.budgetedAmount, 0);
    const totalSpent = budgets.reduce((s, b) => s + b.spentAmount, 0);
    const exceededCount = budgets.filter(b => b.budgetedAmount > 0 && b.spentAmount >= b.budgetedAmount).length;
    const warningCount = budgets.filter(b => {
      const u = b.budgetedAmount > 0 ? (b.spentAmount / b.budgetedAmount) * 100 : 0;
      return u >= (b.alertThreshold ?? 80) && b.spentAmount < b.budgetedAmount;
    }).length;
    const activeCount = budgets.length - exceededCount - warningCount;

    return {
      success: true,
      data: {
        totalBudgeted,
        totalSpent,
        remaining: totalBudgeted - totalSpent,
        utilizationPct: totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 1000) / 10 : 0,
        activeCount,
        warningCount,
        exceededCount,
        totalCount: budgets.length,
        byCategory: {},
      },
    };
  },

  async createFromTemplate(
    organizationId: string,
    templateName: string,
    totalAmount: number,
    categories: { category: string; percentage: number }[],
    options?: {
      period?: 'monthly' | 'quarterly' | 'yearly';
      startDate?: string;
      endDate?: string;
      currency?: string;
    },
  ): Promise<ServiceResponse<Budget[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Budget[]>(organizationId);
      if (err) return err;
      return apiPostJson<
        {
          templateName: string;
          totalAmount: number;
          categories: { category: string; percentage: number }[];
          period?: string;
          startDate?: string;
          endDate?: string;
          currency?: string;
        },
        Budget[]
      >(`${BUD(organizationId)}/from-template`, {
        templateName,
        totalAmount,
        categories,
        period: options?.period,
        startDate: options?.startDate,
        endDate: options?.endDate,
        currency: options?.currency,
      });
    }

    // Local fallback: create budgets one by one
    await simulateDelay(300);
    const today = new Date();
    const startDate = options?.startDate || today.toISOString().split('T')[0];
    const period = options?.period || 'monthly';
    const endDate = options?.endDate || (() => {
      const d = new Date(startDate);
      if (period === 'monthly') d.setMonth(d.getMonth() + 1);
      else if (period === 'quarterly') d.setMonth(d.getMonth() + 3);
      else d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().split('T')[0];
    })();

    const createdBudgets: Budget[] = [];
    for (const cat of categories) {
      const newBudget: Budget = {
        id: generateId('budget'),
        organizationId,
        name: `${cat.category} - ${templateName}`,
        period,
        startDate,
        endDate,
        budgetedAmount: Math.round((totalAmount * cat.percentage) / 100 * 100) / 100,
        spentAmount: 0,
        currency: options?.currency || 'USD',
        status: 'active',
        alertThreshold: 80,
      };
      dataStore.budgets.push(newBudget);
      createdBudgets.push(newBudget);
    }
    dataStore.notify('budgets');
    return { success: true, data: createdBudgets, message: `${createdBudgets.length} budgets created` };
  },

  async rollForward(id: string, organizationId?: string): Promise<ServiceResponse<Budget>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${BUD(organizationId)}/${encodeURIComponent(id)}/roll-forward`
        : `/budgets/${encodeURIComponent(id)}/roll-forward`;
      return apiRequest<Budget>(path, { method: 'POST' });
    }

    await simulateDelay(200);
    const existing = dataStore.budgets.find(b => b.id === id);
    if (!existing) return { success: false, data: null as any, error: 'Budget not found' };

    const oldEnd = new Date(existing.endDate);
    const nextStart = new Date(oldEnd);
    nextStart.setDate(nextStart.getDate() + 1);
    const nextStartStr = nextStart.toISOString().split('T')[0];

    const nextEnd = new Date(nextStart);
    if (existing.period === 'monthly') nextEnd.setMonth(nextEnd.getMonth() + 1);
    else if (existing.period === 'quarterly') nextEnd.setMonth(nextEnd.getMonth() + 3);
    else nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    const nextEndStr = nextEnd.toISOString().split('T')[0];

    const newBudget: Budget = {
      ...existing,
      id: generateId('budget'),
      startDate: nextStartStr,
      endDate: nextEndStr,
      spentAmount: 0,
      status: 'active',
      rolledFromId: existing.id,
    };

    dataStore.budgets.push(newBudget);
    dataStore.notify('budgets');
    return { success: true, data: newBudget, message: 'Budget rolled forward' };
  },
};
