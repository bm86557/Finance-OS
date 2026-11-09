/**
 * Profit Intelligence Service
 * ==========================
 * Service for client profitability, overhead summary, and business vs personal analysis.
 */

import { isHttpBackendConfigured, apiGet, apiPostJson } from '@/lib/apiClient';
import { dataStore, simulateDelay } from './dataStore';
import type { ServiceResponse, SquareFootProfitability, ProfitVelocity, ProfitabilitySnapshot, WorkerLoadedLaborCost } from './types';

const PI = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/profit-intelligence`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export interface OrganizationSummary {
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
  grossProfit: number;
  operatingProfit?: number;
  totalOverhead: number;
  totalDirectCost?: number;
  attributedLabor?: number;
  profitVelocity?: ProfitVelocity;
  policyVersion?: string;
  businessTransactions: number;
  personalTransactions: number;
  untaggedTransactions: number;
  assignedToDepartments: number;
  assignedToProjects: number;
  unassignedTransactions: number;
}

export interface ClientProfitability {
  clientName: string;
  revenue: number;
  cost: number;
  directCost?: number;
  laborCost?: number;
  profit: number;
  operatingProfit?: number;
  margin: number;
  projects: number;
}

export interface OverheadSummary {
  total: number;
  items: Array<{
    id: string;
    name: string;
    allocationBase: string;
    allocationType?: string;
    pool: number;
    accountIds: string[];
    departments: any[];
  }>;
}

export interface BusinessVsPersonal {
  scope: string;
  income: number;
  expense: number;
  net: number;
}

export const profitIntelligenceService = {
  async getSummary(
    organizationId: string,
    params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }
  ): Promise<ServiceResponse<OrganizationSummary>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<OrganizationSummary>(organizationId);
      if (err) return err;

      const queryParams = new URLSearchParams();
      if (params?.from) queryParams.set('startDate', params.from);
      if (params?.to) queryParams.set('endDate', params.to);
      if (params?.period) queryParams.set('period', params.period);

      const query = queryParams.toString();
      const url = query ? `${PI(organizationId)}/summary?${query}` : `${PI(organizationId)}/summary`;
      return apiGet<OrganizationSummary>(url);
    }

    // Fallback: calculate from store transactions
    await simulateDelay();
    
    const transactions = dataStore.transactions.filter(t => 
      t.organizationId === organizationId &&
      t.status !== 'pending'
    );

    const businessTxns = transactions.filter(t => 
      Array.isArray(t.tags) && t.tags.includes('business')
    );

    const totalRevenue = businessTxns
      .filter(t => t.type === 'credit')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpense = businessTxns
      .filter(t => t.type === 'debit')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const allocations = dataStore.overheadAllocations.filter(a => a.organizationId === organizationId);
    let totalOverhead = allocations.reduce((sum, a) => sum + Number(a.amount || 0), 0);
    if (totalOverhead === 0 && allocations.length === 0) {
      totalOverhead = 105000;
    }
    if (totalOverhead > totalExpense && totalExpense > 0) {
      totalOverhead = totalExpense;
    }
    const totalDirectCost = Math.max(0, totalExpense - totalOverhead);
    const grossProfit = totalRevenue - totalDirectCost;
    const netProfit = totalRevenue - totalExpense;

    return {
      success: true,
      data: {
        totalRevenue,
        totalExpense,
        totalOverhead,
        grossProfit,
        netProfit,
        businessTransactions: businessTxns.length,
        personalTransactions: transactions.filter(t => 
          Array.isArray(t.tags) && t.tags.includes('personal')
        ).length,
        untaggedTransactions: transactions.filter(t =>
          !Array.isArray(t.tags) || (!t.tags.includes('business') && !t.tags.includes('personal'))
        ).length,
        assignedToDepartments: transactions.filter(t => t.departmentId).length,
        assignedToProjects: transactions.filter(t => t.projectId).length,
        unassignedTransactions: transactions.filter(t => !t.departmentId && !t.projectId).length
      }
    };
  },

  async getClientProfitability(
    organizationId: string,
    params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }
  ): Promise<ServiceResponse<ClientProfitability[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClientProfitability[]>(organizationId);
      if (err) return err;

      const queryParams = new URLSearchParams();
      if (params?.period) queryParams.append('period', params.period);
      else {
        if (params?.from) queryParams.append('from', params.from);
        if (params?.to) queryParams.append('to', params.to);
      }
      const query = queryParams.toString();
      const url = query ? `${PI(organizationId)}/clients?${query}` : `${PI(organizationId)}/clients`;
      return apiGet<ClientProfitability[]>(url);
    }

    // Fallback to in-memory calculation
    await simulateDelay();
    
    const projects = dataStore.projects.filter(p => p.organizationId === organizationId);
    const transactions = dataStore.transactions.filter(t => t.organizationId === organizationId);
    
    // Aggregate by client name
    const clientMap = new Map<string, { revenue: number; cost: number; projectIds: Set<string> }>();
    
    for (const proj of projects) {
      const clientName = proj.clientName || 'Unknown Client';
      if (!clientMap.has(clientName)) {
        clientMap.set(clientName, { revenue: 0, cost: 0, projectIds: new Set() });
      }
      
      const clientData = clientMap.get(clientName)!;
      clientData.projectIds.add(proj.id);
      
      const projTxns = transactions.filter(t => t.projectId === proj.id);
      const revenue = projTxns.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
      const cost = projTxns.filter(t => t.type === 'debit').reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      clientData.revenue += revenue;
      clientData.cost += cost;
    }
    
    const clients = Array.from(clientMap.entries())
      .map(([clientName, data]) => {
        const profit = data.revenue - data.cost;
        const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
        return {
          clientName,
          revenue: data.revenue,
          cost: data.cost,
          profit,
          margin: Math.round(margin * 10) / 10,
          projects: data.projectIds.size,
        };
      })
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
    
    return { success: true, data: clients };
  },

  async getOverheadSummary(
    organizationId: string
  ): Promise<ServiceResponse<OverheadSummary>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<OverheadSummary>(organizationId);
      if (err) return err;
      return apiGet<OverheadSummary>(`${PI(organizationId)}/overhead-summary`);
    }

    // Fallback to in-memory calculation
    await simulateDelay();
    
    const allocations = dataStore.overheadAllocations.filter(a => a.organizationId === organizationId);
    const accounts = dataStore.accounts.filter(a => a.organizationId === organizationId);
    
    let total = 0;
    const items = allocations.map(alloc => {
      let pool = alloc.amount || 0;
      
      if (pool === 0 && alloc.accountIds && alloc.accountIds.length > 0) {
        pool = alloc.accountIds.reduce((sum: number, accId: string) => {
          const acc = accounts.find(a => a.id === accId);
          return sum + Math.abs(acc?.balance || 0);
        }, 0);
      }
      
      total += pool;
      
      return {
        id: alloc.id,
        name: alloc.name,
        allocationBase: alloc.allocationBase,
        pool,
        accountIds: alloc.accountIds || [],
        departments: alloc.departments || [],
      };
    });
    
    return { success: true, data: { total, items } };
  },

  async getBusinessVsPersonal(
    organizationId: string,
    params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }
  ): Promise<ServiceResponse<BusinessVsPersonal[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<BusinessVsPersonal[]>(organizationId);
      if (err) return err;

      const queryParams = new URLSearchParams();
      if (params?.period) queryParams.append('period', params.period);
      else {
        if (params?.from) queryParams.append('from', params.from);
        if (params?.to) queryParams.append('to', params.to);
      }
      const query = queryParams.toString();
      const url = query ? `${PI(organizationId)}/business-vs-personal?${query}` : `${PI(organizationId)}/business-vs-personal`;
      return apiGet<BusinessVsPersonal[]>(url);
    }

    // Fallback to in-memory calculation
    await simulateDelay();
    
    const transactions = dataStore.transactions.filter(t => t.organizationId === organizationId);
    
    const scopeMap = new Map<string, { income: number; expense: number }>();
    scopeMap.set('business', { income: 0, expense: 0 });
    scopeMap.set('personal', { income: 0, expense: 0 });
    scopeMap.set('untagged', { income: 0, expense: 0 });
    
    for (const txn of transactions) {
      let scope = 'untagged';
      if (txn.tags) {
        const tags = Array.isArray(txn.tags) ? txn.tags : [];
        if (tags.includes('business')) scope = 'business';
        else if (tags.includes('personal')) scope = 'personal';
      }
      
      const scopeData = scopeMap.get(scope)!;
      if (txn.type === 'credit') {
        scopeData.income += txn.amount;
      } else if (txn.type === 'debit') {
        scopeData.expense += Math.abs(txn.amount);
      }
    }
    
    const summary = Array.from(scopeMap.entries()).map(([scope, data]) => ({
      scope,
      income: data.income,
      expense: data.expense,
      net: data.income - data.expense,
    }));
    
    return { success: true, data: summary };
  },

  async getSpaceProfitability(
    organizationId: string,
    params?: { from?: string; to?: string }
  ): Promise<ServiceResponse<SquareFootProfitability[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<SquareFootProfitability[]>(organizationId);
      if (err) return err;

      const queryParams = new URLSearchParams();
      if (params?.from) queryParams.append('from', params.from);
      if (params?.to) queryParams.append('to', params.to);
      const query = queryParams.toString();
      const url = query ? `${PI(organizationId)}/space-profitability?${query}` : `${PI(organizationId)}/space-profitability`;
      return apiGet<SquareFootProfitability[]>(url);
    }

    await simulateDelay();
    return { success: true, data: [] };
  },

  async getSnapshots(
    organizationId: string
  ): Promise<ServiceResponse<ProfitabilitySnapshot[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProfitabilitySnapshot[]>(organizationId);
      if (err) return err;
      return apiGet<ProfitabilitySnapshot[]>(`${PI(organizationId)}/snapshots`);
    }

    await simulateDelay();
    return { success: true, data: [] };
  },

  async createSnapshot(
    organizationId: string,
    data: Partial<ProfitabilitySnapshot>
  ): Promise<ServiceResponse<ProfitabilitySnapshot>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ProfitabilitySnapshot>(organizationId);
      if (err) return err;
      return apiPostJson<Partial<ProfitabilitySnapshot>, ProfitabilitySnapshot>(`${PI(organizationId)}/snapshots`, data);
    }

    await simulateDelay();
    const newSnap: ProfitabilitySnapshot = {
      id: `snap-${Date.now()}`,
      organizationId,
      periodStart: data.periodStart || new Date().toISOString().slice(0, 10),
      periodEnd: data.periodEnd || new Date().toISOString().slice(0, 10),
      totalRevenue: data.totalRevenue || 0,
      totalExpense: data.totalExpense || 0,
      totalOverhead: data.totalOverhead || 0,
      operatingProfit: data.operatingProfit || 0,
      netProfit: data.netProfit || 0,
      policyVersion: 'v1.2-costing',
      createdAt: new Date().toISOString(),
      snapshotData: data.snapshotData || {},
    };
    return { success: true, data: newSnap };
  },

  async getWorkerLaborCosts(
    organizationId: string
  ): Promise<ServiceResponse<WorkerLoadedLaborCost[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<WorkerLoadedLaborCost[]>(organizationId);
      if (err) return err;
      return apiGet<WorkerLoadedLaborCost[]>(`${PI(organizationId)}/worker-labor-costs`);
    }

    await simulateDelay();
    return { success: true, data: [] };
  },
};
