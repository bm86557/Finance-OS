/**
 * Overhead Allocation Service
 * ==========================
 * CRUD operations for overhead allocations
 */

import { OverheadAllocation } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import type { ServiceResponse } from './types';

const OA = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/overhead-allocations`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export const overheadAllocationService = {
  async getAll(organizationId: string): Promise<ServiceResponse<OverheadAllocation[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<OverheadAllocation[]>(organizationId);
      if (err) return err;
      return apiGet<OverheadAllocation[]>(OA(organizationId));
    }

    await simulateDelay();
    const allocations = dataStore.overheadAllocations.filter(a => a.organizationId === organizationId);
    return { success: true, data: allocations };
  },

  async getById(id: string, organizationId: string): Promise<ServiceResponse<OverheadAllocation | null>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<OverheadAllocation | null>(organizationId);
      if (err) return err;
      return apiGet<OverheadAllocation | null>(`${OA(organizationId)}/${encodeURIComponent(id)}`);
    }

    await simulateDelay(80);
    const alloc = dataStore.overheadAllocations.find(a => a.id === id) || null;
    return { success: !!alloc, data: alloc };
  },

  async create(
    organizationId: string,
    data: Omit<OverheadAllocation, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<OverheadAllocation>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<OverheadAllocation>(organizationId);
      if (err) return err;
      const res = await apiPostJson<Omit<OverheadAllocation, 'id' | 'organizationId'>, OverheadAllocation>(
        OA(organizationId),
        data
      );
      if (res.success) {
        dataStore.notify('overheadAllocations');
      }
      return res;
    }

    await simulateDelay(200);
    const newAlloc: OverheadAllocation = {
      ...data,
      id: generateId('alloc'),
      organizationId,
      accountIds: data.accountIds || [],
      departments: data.departments || [],
    };
    dataStore.overheadAllocations.push(newAlloc);
    dataStore.notify('overheadAllocations');
    return { success: true, data: newAlloc, message: 'Overhead allocation created' };
  },

  async update(
    id: string,
    organizationId: string,
    updates: Partial<OverheadAllocation>,
  ): Promise<ServiceResponse<OverheadAllocation>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<OverheadAllocation>(organizationId);
      if (err) return err;
      const res = await apiRequest<OverheadAllocation>(
        `${OA(organizationId)}/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(updates) }
      );
      if (res.success) {
        dataStore.notify('overheadAllocations');
      }
      return res;
    }

    await simulateDelay(150);
    const idx = dataStore.overheadAllocations.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Overhead allocation not found' };
    dataStore.overheadAllocations[idx] = { ...dataStore.overheadAllocations[idx], ...updates };
    dataStore.notify('overheadAllocations');
    return { success: true, data: dataStore.overheadAllocations[idx] };
  },

  async delete(id: string, organizationId: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<null>(organizationId);
      if (err) return err;
      const res = await apiRequest<null>(
        `${OA(organizationId)}/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (res.success) {
        dataStore.notify('overheadAllocations');
      }
      return res;
    }

    await simulateDelay(150);
    const idx = dataStore.overheadAllocations.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Overhead allocation not found' };
    dataStore.overheadAllocations.splice(idx, 1);
    dataStore.notify('overheadAllocations');
    return { success: true, data: null, message: 'Overhead allocation deleted' };
  },
};
