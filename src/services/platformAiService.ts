/**
 * Platform AI Command Center Service
 * ==================================
 * Connects the frontend 4th Portal (/ai-portal) to the real Express backend API (/api/platform/ai).
 * Gathers SaaS-level AI telemetry, tenant token consumption, Gemini Free Tier quotas,
 * multi-model gateway status, and classification quality metrics.
 *
 * Adheres strictly to:
 * - Real Supabase database data
 * - Layered Free Tier vs Paid Tier Detection Engine
 * - Zero mock data
 */

import { isHttpBackendConfigured, apiGet, apiPostJson, apiPutJson, apiDelete } from '@/lib/apiClient';
import type { ServiceResponse } from './types';

export interface KeyTierInfo {
  tier: 'free' | 'paid' | 'unverified';
  confidence: 'declared' | 'verified_by_quota_error' | 'verified_live' | 'inferred' | 'none';
  source: string;
  badgeLabel: string;
  isBilledAsZero: boolean;
  limits: {
    rpm: number;
    rpd: number;
    tpm: number;
    dailyResetTime: string;
  };
  evidence?: {
    quotaMetric?: string;
    quotaId?: string;
    quotaValue?: string | number;
    retryDelay?: string;
    lastErrorText?: string;
    model?: string;
    verifiedAt?: string;
  };
  peakRpmObserved: number;
  throttleCount: number;
}

export interface PlatformAiStats {
  keyTier?: KeyTierInfo;
  billingTier: 'free' | 'paid' | 'unverified' | 'gemini_free_tier' | 'commercial';
  actualSpendUsd: number;
  commercialEquivalentUsd: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalEvents: number;
  platformTokens?: number;
  platformPromptTokens?: number;
  platformCompletionTokens?: number;
  platformEvents?: number;
  byokTokens?: number;
  byokPromptTokens?: number;
  byokCompletionTokens?: number;
  byokEvents?: number;
  totalSystemTokens?: number;
  totalSystemEvents?: number;
  requestsToday: number;
  rollingRpm?: number;
  dailyRequestLimit: number;
  rateLimitRpm: number;
  rateLimitTpm: number;
  dailyResetTime?: string;
  activeProvider: string;
  activeModel: string;
  fallbackChain: string[];
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  avgLatencyMs: number | null;
  uptimePercent: number | null;
  fallbackCount: number;
  airGapVerified: boolean;
  featureBreakdown: {
    narration_classification: number;
    copilot_chat: number;
    copilot_analysis: number;
    employee_rag: number;
    statement_import_batch: number;
  };
  systemEntities: {
    totalTransactions: number;
    totalRules: number;
    totalFeedback: number;
    totalOrganizations: number;
  };
  lastSyncedAt: string;
}

export interface TenantAiConsumption {
  organizationId: string;
  organizationName: string;
  slug: string | null;
  planTier: string;
  paymentProvider?: string;
  planFeePkr: number;
  planFeeUsd: number;
  requestsUsed: number;
  byokRequests?: number;
  aiCreditsQuota: number;
  statementsQuota?: number;
  tokensUsed: number;
  quotaPercent: number;
  rawCostUsd: number;
  commercialShadowCostUsd: number;
  netMarginPkr: number;
  netMarginUsd: number;
  marginPercent: number;
  burnStatus: 'healthy' | 'warning' | 'exceeded' | 'byok_exempt';
  keySource: 'custom_byok' | 'platform_free_tier';
}

export interface GatewayNodeStatus {
  id?: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'custom' | string;
  name: string;
  modelName: string;
  priority: number;
  isActive: boolean;
  circuitOpen: boolean;
  callCount: number;
  failureCount: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  latencyMs?: number;
  successRate?: number;
  costPer1MInput: number;
  costPer1MOutput: number;
  status: 'online' | 'standby' | 'error' | 'tripped' | 'not_configured';
  baseUrl?: string;
  hasApiKey?: boolean;
  keyLast4?: string;
  keySource?: 'vault' | 'env' | 'none';
  rateLimitRpm?: number;
  rateLimitTpm?: number;
  timeoutMs?: number;
  maxTokensPerReq?: number;
  lastUsedAt?: string;
}

export interface CreateGatewayProviderInput {
  provider: string;
  name: string;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  priority?: number;
  costPer1MInput?: number;
  costPer1MOutput?: number;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
  timeoutMs?: number;
  maxTokensPerReq?: number;
}

export interface UpdateGatewayProviderInput {
  name?: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  priority?: number;
  costPer1MInput?: number;
  costPer1MOutput?: number;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
  timeoutMs?: number;
  maxTokensPerReq?: number;
  circuitOpen?: boolean;
  isActive?: boolean;
}

export interface ClassificationQualityMetrics {
  totalClassifiedMonth: number;
  autoApprovedRatio: number;
  targetAutoApprovedRatio: number;
  manualReviewRatio: number;
  accountantOverrideRate: number;
  targetOverrideRateMax: number;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
    unclassifiedCount?: number;
  };
  activeRuleVersions: number;
  unmatchedMerchantsQueue: number;
  ruleDriftAlerts: number;
}

export interface PlatformAiSecurityStatus {
  encryptionAtRest: string;
  encryptionInTransit: string;
  tenantIsolation: string;
  promptScrubbingActive: boolean;
  piiRedactionActive: boolean;
  retentionPolicy: string;
  customKeyTenants: number;
  globalAiKillSwitch: boolean;
  keyTier?: KeyTierInfo;
  dataPrivacyDisclosure?: string;
}

export const platformAiService = {
  /**
   * Get live platform AI telemetry from backend
   */
  async getStats(): Promise<ServiceResponse<PlatformAiStats>> {
    if (isHttpBackendConfigured()) {
      return apiGet<PlatformAiStats>('/platform/ai/stats');
    }
    return {
      success: false,
      data: null as any,
      error: 'Backend API is offline or unreachable.',
    };
  },

  /**
   * Get detailed key tier state and radar
   */
  async getKeyTier(): Promise<ServiceResponse<KeyTierInfo & { rollingRpm: number }>> {
    if (isHttpBackendConfigured()) {
      return apiGet<KeyTierInfo & { rollingRpm: number }>('/platform/ai/key-tier');
    }
    return {
      success: false,
      data: null as any,
      error: 'Backend API is offline or unreachable.',
    };
  },

  /**
   * Get per-organization AI token consumption and net platform margin from Supabase
   */
  async getTenantUsage(): Promise<ServiceResponse<TenantAiConsumption[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<TenantAiConsumption[]>('/platform/ai/tenant-usage');
    }
    return {
      success: false,
      data: [] as TenantAiConsumption[],
      error: 'Backend API is offline or unreachable.',
    };
  },

  /**
   * Get real-time provider gateway nodes and circuit breaker health
   */
  async getGatewayStatus(): Promise<ServiceResponse<GatewayNodeStatus[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<GatewayNodeStatus[]>('/platform/ai/gateway-status');
    }
    return {
      success: false,
      data: [] as GatewayNodeStatus[],
      error: 'Backend API is offline or unreachable.',
    };
  },

  /**
   * Dynamic Gateway Providers CRUD & Failover Management
   */
  async getGatewayProviders(): Promise<ServiceResponse<GatewayNodeStatus[]>> {
    if (isHttpBackendConfigured()) {
      return apiGet<GatewayNodeStatus[]>('/platform/ai/gateway/providers');
    }
    return { success: false, data: [], error: 'Backend API unreachable' };
  },

  async addGatewayProvider(input: CreateGatewayProviderInput): Promise<ServiceResponse<GatewayNodeStatus>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<CreateGatewayProviderInput, GatewayNodeStatus>('/platform/ai/gateway/providers', input);
    }
    return { success: false, data: null as any, error: 'Backend API unreachable' };
  },

  async updateGatewayProvider(id: string, input: UpdateGatewayProviderInput): Promise<ServiceResponse<GatewayNodeStatus>> {
    if (isHttpBackendConfigured()) {
      return apiPutJson<UpdateGatewayProviderInput, GatewayNodeStatus>(`/platform/ai/gateway/providers/${id}`, input);
    }
    return { success: false, data: null as any, error: 'Backend API unreachable' };
  },

  async deleteGatewayProvider(id: string): Promise<ServiceResponse<{ success: boolean; message: string }>> {
    if (isHttpBackendConfigured()) {
      return apiDelete<{ success: boolean; message: string }>(`/platform/ai/gateway/providers/${id}`);
    }
    return { success: false, data: null as any, error: 'Backend API unreachable' };
  },

  async reorderGatewayProviders(order: Array<{ id: string; priority: number }>): Promise<ServiceResponse<GatewayNodeStatus[]>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<{ order: Array<{ id: string; priority: number }> }, GatewayNodeStatus[]>('/platform/ai/gateway/providers/reorder', { order });
    }
    return { success: false, data: [], error: 'Backend API unreachable' };
  },

  async testGatewayNode(id: string): Promise<ServiceResponse<{ success: boolean; latencyMs: number; model: string; provider: string; error?: string }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson<object, any>(`/platform/ai/gateway/providers/${id}/test`, {});
    }
    return { success: false, data: null as any, error: 'Backend API unreachable' };
  },

  /**
   * Test arbitrary credentials and endpoint directly before saving
   */
  async testConnection(params: {
    provider: string;
    modelName: string;
    apiKey: string;
    baseUrl?: string;
  }): Promise<ServiceResponse<{ success: boolean; latencyMs: number; model: string; provider: string; error?: string }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson('/platform/ai/gateway/test-connection', params);
    }
    return { success: false, data: null as any, error: 'Backend API unreachable' };
  },

  /**
   * Toggle gateway provider circuit breaker (trip or reset)
   */
  async toggleGatewayProvider(provider: string, action: 'trip_circuit' | 'reset_circuit'): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson('/platform/ai/gateway/toggle', { provider, action });
    }
    return { success: false, data: null, error: 'Backend API unreachable' };
  },

  /**
   * Switch gateway primary model
   */
  async setPrimaryModel(modelName: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson('/platform/ai/gateway/toggle', { action: 'set_primary', modelName });
    }
    return { success: false, data: null, error: 'Backend API unreachable' };
  },

  /**
   * Ping live gateway to test connectivity and measure round-trip latency
   */
  async pingGateway(modelName?: string): Promise<ServiceResponse<{ success: boolean; latencyMs: number; model: string; provider: string }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson('/platform/ai/gateway/ping', { modelName });
    }
    return { success: false, data: null as any, error: 'Backend API unreachable' };
  },

  /**
   * Get narration classification accuracy and drift metrics from Supabase (§11)
   */
  async getClassificationQuality(): Promise<ServiceResponse<ClassificationQualityMetrics>> {
    if (isHttpBackendConfigured()) {
      return apiGet<ClassificationQualityMetrics>('/platform/ai/classification-quality');
    }
    return {
      success: false,
      data: null as any,
      error: 'Backend API is offline or unreachable.',
    };
  },

  /**
   * Run on-demand audit scan and scoring of database transactions against rules (§11)
   */
  async scanClassificationQuality(): Promise<ServiceResponse<{ scannedCount: number; updatedCount: number; message: string }>> {
    if (isHttpBackendConfigured()) {
      return apiPostJson('/platform/ai/scan-quality', {});
    }
    return {
      success: false,
      data: null as any,
      error: 'Backend API is offline or unreachable.',
    };
  },

  /**
   * Get air-gap privacy vault & security status (§20, §33)
   */
  async getSecurityStatus(): Promise<ServiceResponse<PlatformAiSecurityStatus>> {
    if (isHttpBackendConfigured()) {
      return apiGet<PlatformAiSecurityStatus>('/platform/ai/security-status');
    }
    return {
      success: false,
      data: null as any,
      error: 'Backend API is offline or unreachable.',
    };
  },
};
