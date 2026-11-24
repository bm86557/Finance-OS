/**
 * Department Service
 * ===================
 * CRUD for departments with authoritative backend profitability & 160h/month cost matrix.
 * Never silently discards valid backend responses or fabricates mock 75%/25% splits (§0 #3, §6 L231).
 */

import { Department } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore } from './dataStore';
import type { ServiceResponse, DepartmentProfitability } from './types';

const DEPT = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/departments`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

function backendUnavailable<T>(message = 'Backend API is not configured or unavailable'): ServiceResponse<T> {
  return { success: false, data: null as unknown as T, error: message };
}

export const departmentService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Department[]>> {
    const err = requireOrg<Department[]>(organizationId);
    if (err) return err;
    if (isHttpBackendConfigured()) {
      return apiGet<Department[]>(DEPT(organizationId));
    }
    return backendUnavailable<Department[]>();
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Department | null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${DEPT(organizationId)}/${encodeURIComponent(id)}`
        : `/departments/${encodeURIComponent(id)}`;
      return apiGet<Department | null>(path);
    }
    return backendUnavailable<Department | null>();
  },

  async create(
    organizationId: string,
    data: Omit<Department, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<Department>> {
    const err = requireOrg<Department>(organizationId);
    if (err) return err;
    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<Omit<Department, 'id' | 'organizationId'>, Department>(DEPT(organizationId), data);
      if (res.success) {
        dataStore.notify('departments');
      }
      return res;
    }
    return backendUnavailable<Department>();
  },

  async update(
    id: string,
    updates: Partial<Department>,
    organizationId?: string,
  ): Promise<ServiceResponse<Department>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${DEPT(organizationId)}/${encodeURIComponent(id)}`
        : `/departments/${encodeURIComponent(id)}`;
      const res = await apiRequest<Department>(path, { method: 'PATCH', body: JSON.stringify(updates) });
      if (res.success) {
        dataStore.notify('departments');
      }
      return res;
    }
    return backendUnavailable<Department>();
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const path = organizationId
        ? `${DEPT(organizationId)}/${encodeURIComponent(id)}`
        : `/departments/${encodeURIComponent(id)}`;
      const res = await apiRequest<null>(path, { method: 'DELETE' });
      if (res.success) {
        dataStore.notify('departments');
      }
      return res;
    }
    return backendUnavailable<null>();
  },

  async getProfitability(
    organizationId: string,
    params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' | 'ALL' }
  ): Promise<ServiceResponse<DepartmentProfitability[]>> {
    const err = requireOrg<DepartmentProfitability[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const queryParams = new URLSearchParams();
      if (params?.period) {
        queryParams.append('period', params.period);
      } else {
        if (params?.from) queryParams.append('from', params.from);
        if (params?.to) queryParams.append('to', params.to);
      }
      const query = queryParams.toString();
      const url = query ? `${DEPT(organizationId)}/profitability?${query}` : `${DEPT(organizationId)}/profitability`;
      // Authoritative backend response — NEVER discard when first department has 0 staff (totalHours === null)!
      return apiGet<DepartmentProfitability[]>(url);
    }

    return backendUnavailable<DepartmentProfitability[]>();
  },
};
