/**
 * Per-organization AI integration settings.
 * Secure BYOK (Bring Your Own Key) Service:
 * - When `isHttpBackendConfigured()`: calls `/organizations/:orgId/ai-settings` (with AES-256-GCM backend storage).
 * - Full support for testing connection, masked display, quota status, and monthly usage metrics.
 */

import { isHttpBackendConfigured, apiGet, apiRequest, apiPostJson } from '@/lib/apiClient';
import type { OrgAiIntegrationSettings, ServiceResponse } from './types';
import { simulateDelay } from './dataStore';

export interface ExtendedOrgAiSettings extends OrgAiIntegrationSettings {
  provider?: string;
  keyLast4?: string;
  hasApiKey?: boolean;
  activeSource?: 'organization' | 'platform' | 'none';
  connectionStatus?: 'valid' | 'invalid' | 'quota_exceeded' | 'unconfigured' | 'pending';
  testError?: string | null;
  lastTestedAt?: string | null;
  quotaExceeded?: boolean;
  quotaResetAt?: string | null;
  monthlyUsage?: {
    orgRequests: number;
    platformRequests: number;
  };
  featuresPowered?: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
  isQuotaExceeded?: boolean;
}

const STORAGE_KEY = 'finance_os_org_ai_settings_v1';

const AI_SETTINGS_PATH = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/ai-settings`;

const AI_TEST_PATH = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/ai-settings/test`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId?.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

export function defaultOrgAiSettings(): ExtendedOrgAiSettings {
  return {
    useCustomKey: false,
    providerName: 'Google Gemini',
    provider: 'gemini',
    modelName: 'gemini-flash-lite-latest',
    apiKey: '',
    hasApiKey: false,
    activeSource: 'platform',
    connectionStatus: 'unconfigured',
    monthlyUsage: { orgRequests: 0, platformRequests: 0 },
    featuresPowered: [
      'AI Financial Assistant (Chat & Strategy)',
      'Smart Transaction Classification',
      'Bank Statement Intelligence Parser',
    ],
  };
}

function normalizeAiSettings(raw: unknown): ExtendedOrgAiSettings {
  if (!raw || typeof raw !== 'object') return defaultOrgAiSettings();
  const o = raw as Record<string, any>;
  return {
    useCustomKey: Boolean(o.useCustomKey),
    providerName: typeof o.providerName === 'string' ? o.providerName : 'Google Gemini',
    provider: typeof o.provider === 'string' ? o.provider : 'gemini',
    modelName:
      typeof o.modelName === 'string' && o.modelName.trim()
        ? o.modelName
        : 'gemini-flash-lite-latest',
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    keyLast4: typeof o.keyLast4 === 'string' ? o.keyLast4 : undefined,
    hasApiKey: Boolean(o.hasApiKey),
    activeSource: o.activeSource || (o.useCustomKey && o.hasApiKey ? 'organization' : 'platform'),
    connectionStatus: o.connectionStatus || 'unconfigured',
    testError: o.testError || null,
    lastTestedAt: o.lastTestedAt || null,
    quotaExceeded: Boolean(o.quotaExceeded),
    quotaResetAt: o.quotaResetAt || null,
    monthlyUsage: o.monthlyUsage || { orgRequests: 0, platformRequests: 0 },
    featuresPowered: Array.isArray(o.featuresPowered) ? o.featuresPowered : defaultOrgAiSettings().featuresPowered,
  };
}

function readAll(): Record<string, ExtendedOrgAiSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, ExtendedOrgAiSettings>;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, ExtendedOrgAiSettings>): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function dispatchAiSettingsEvent(organizationId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finance-os-ai-settings', { detail: { organizationId } }));
  }
}

/**
 * Synchronous read from local demo storage only.
 */
export function getOrgAiSettings(organizationId: string): ExtendedOrgAiSettings | null {
  if (!organizationId || isHttpBackendConfigured()) return null;
  const all = readAll();
  return all[organizationId] ?? null;
}

/**
 * Load AI settings for the org (HTTP or fallback).
 */
export async function fetchOrgAiSettings(
  organizationId: string,
): Promise<ServiceResponse<ExtendedOrgAiSettings | null>> {
  const err = requireOrg<ExtendedOrgAiSettings | null>(organizationId);
  if (err) return err;

  if (isHttpBackendConfigured()) {
    const res = await apiGet<unknown>(AI_SETTINGS_PATH(organizationId));
    if (!res.success) return res as ServiceResponse<ExtendedOrgAiSettings | null>;
    if (res.data == null) return { success: true, data: defaultOrgAiSettings() };
    return { success: true, data: normalizeAiSettings(res.data) };
  }

  await simulateDelay(50);
  const all = readAll();
  const raw = all[organizationId] ?? defaultOrgAiSettings();
  return { success: true, data: raw };
}

/**
 * Save organization AI settings
 */
export async function saveOrgAiSettingsResponse(
  organizationId: string,
  patch: Partial<ExtendedOrgAiSettings>,
): Promise<ServiceResponse<ExtendedOrgAiSettings>> {
  if (!organizationId?.trim()) {
    return {
      success: false,
      data: { ...defaultOrgAiSettings(), ...patch },
      error: 'Select an organization before saving.',
    };
  }

  if (isHttpBackendConfigured()) {
    const ro = requireOrg<ExtendedOrgAiSettings>(organizationId);
    if (ro) return ro;
    const base = defaultOrgAiSettings();
    const merged = {
      ...base,
      ...patch,
      modelName: patch.modelName?.trim() || base.modelName,
    };
    const res = await apiRequest<ExtendedOrgAiSettings>(AI_SETTINGS_PATH(organizationId), {
      method: 'PATCH',
      body: JSON.stringify(merged),
    });
    if (res.success) {
      dispatchAiSettingsEvent(organizationId);
      const data = res.data != null ? normalizeAiSettings(res.data) : merged;
      return {
        success: true,
        data,
        message: 'AI connection settings saved securely with AES-256-GCM encryption.',
      };
    }
    return {
      success: false,
      data: defaultOrgAiSettings(),
      error: res.error ?? 'Could not save AI settings.',
    };
  }

  const all = readAll();
  const mergedPrev = all[organizationId] ?? defaultOrgAiSettings();
  const next: ExtendedOrgAiSettings = { ...mergedPrev, ...patch };
  all[organizationId] = next;
  writeAll(all);
  dispatchAiSettingsEvent(organizationId);
  return { success: true, data: next, message: 'AI connection settings saved.' };
}

/**
 * Test AI Connection directly with provider
 */
export async function testOrgAiConnection(
  organizationId: string,
  params: {
    provider: string;
    modelName: string;
    apiKey?: string;
    baseUrl?: string;
  },
): Promise<ServiceResponse<ConnectionTestResult>> {
  if (!organizationId?.trim()) {
    return { success: false, data: null as any, error: 'Organization ID is required.' };
  }

  if (isHttpBackendConfigured()) {
    const res = await apiPostJson<object, ConnectionTestResult>(AI_TEST_PATH(organizationId), params);
    return res;
  }

  await simulateDelay(600);
  return {
    success: true,
    data: {
      success: true,
      provider: params.provider,
      model: params.modelName,
      latencyMs: 380,
    },
    message: `Connected successfully to ${params.provider}!`,
  };
}

/**
 * Clear or remove custom AI settings
 */
export async function clearOrgAiSettingsResponse(organizationId: string): Promise<ServiceResponse<null>> {
  if (!organizationId?.trim()) {
    return { success: false, data: null, error: 'Select an organization first.' };
  }

  if (isHttpBackendConfigured()) {
    const res = await apiRequest<null>(AI_SETTINGS_PATH(organizationId), {
      method: 'DELETE',
    });
    if (res.success) {
      dispatchAiSettingsEvent(organizationId);
      return { success: true, data: null, message: 'Custom AI key removed. Organization reverted to Finance OS AI.' };
    }
    return { success: false, data: null, error: res.error ?? 'Could not remove AI key.' };
  }

  const all = readAll();
  delete all[organizationId];
  writeAll(all);
  dispatchAiSettingsEvent(organizationId);
  return { success: true, data: null, message: 'AI settings cleared.' };
}

/** Last 4 chars for display when masked */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `••••••••${key.slice(-4)}`;
}
