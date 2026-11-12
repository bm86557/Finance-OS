/**
 * Unified AI Gateway
 * - Central router for all AI features (AI Assistant, AI Classification, Import Parsing)
 * - Resolves keys per-organization:
 *     1. Active custom organization key (AES-256-GCM decrypted on demand)
 *     2. Platform built-in fallback key (with per-tenant quota protection)
 * - Isolated per-tenant quota tracking (no cross-tenant rate limit blocking)
 * - High-speed in-memory credential caching (5 min TTL)
 * - Live telemetry logging into platform_ai_usage_events + resilient in-memory ring-buffer
 * - Dynamic model priority failover & circuit breaker management
 */

import { getSupabaseAdminClient } from './supabaseAdmin.js';
import { encryptSecret, decryptSecret, extractLast4, maskApiKey } from './secretBox.js';
import { getDefaultAIConfig, normalizeGeminiModel, MODERN_GEMINI_FALLBACKS, type AIConfig } from '../config/aiConfig.js';
import { recordSuccessfulCall, recordQuotaError, resolveKeyTier, getCurrentRollingRpm, verifyGeminiKeyLive } from './aiKeyTier.js';

export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'custom';
export type AISource = 'organization' | 'platform' | 'none';

export interface ResolvedAIConfig {
  source: AISource;
  provider: AIProvider;
  providerName: string;
  modelName: string;
  apiKey: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  keyLast4?: string;
  isCustomKey: boolean;
  quotaExceeded: boolean;
  quotaResetAt?: string;
}

export interface AITestResult {
  success: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
  isQuotaExceeded?: boolean;
}

export interface TelemetryEventParams {
  organizationId: string;
  portalType?: string; // 'ai_assistant' | 'organization_admin' | 'employee'
  featureArea?: string; // 'copilot_chat' | 'copilot_analysis' | 'employee_rag' | 'narration_classification' | 'statement_import_batch'
  provider: string; // 'gemini' | 'openai' | 'anthropic'
  modelName: string;
  fallbackTriggered?: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
  latencyMs: number;
  status?: 'success' | 'rate_limited' | 'timeout' | 'error';
  timestamp?: string;
  keySource?: 'platform' | 'custom_byok';
  persisted?: boolean;
}

export interface GatewayModelState {
  id?: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'custom' | string;
  name: string;
  modelName: string;
  priority: number;
  isActive: boolean;
  circuitOpen: boolean;
  consecutiveFailures?: number;
  maxTokensPerReq?: number;
  timeoutMs?: number;
  callCount: number;
  failureCount: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  latencyMs?: number;
  successRate?: number;
  lastUsedAt?: string;
  costPer1MInput: number;
  costPer1MOutput: number;
  status: 'online' | 'standby' | 'error' | 'tripped' | 'not_configured';
  baseUrl?: string;
  hasApiKey?: boolean;
  keyLast4?: string;
  keySource?: 'vault' | 'env' | 'none';
  apiKeyEncrypted?: string;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
}

// ── In-Memory Live Telemetry Ring-Buffer (up to 5,000 events) ────────────────
const MAX_TELEMETRY_BUFFER = 5000;
export const inMemoryUsageEvents: TelemetryEventParams[] = [];

// ── Live Gateway Runtime Models Registry ────────────────────────────────────
let primaryModelOverride: string | null = null;

const runtimeGatewayModels: GatewayModelState[] = [
  {
    provider: 'gemini',
    name: 'Google Gemini Flash Lite',
    modelName: 'gemini-flash-lite-latest',
    priority: 1,
    isActive: true,
    circuitOpen: false,
    callCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.300,
    status: 'online',
  },
  {
    provider: 'gemini',
    name: 'Google Gemini Flash',
    modelName: 'gemini-flash-latest',
    priority: 2,
    isActive: true,
    circuitOpen: false,
    callCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.300,
    status: 'standby',
  },
  {
    provider: 'gemini',
    name: 'Google Gemini 3 Preview',
    modelName: 'gemini-3-flash-preview',
    priority: 3,
    isActive: true,
    circuitOpen: false,
    callCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.300,
    status: 'standby',
  },
  {
    provider: 'gemini',
    name: 'Google Gemini 2.0 Flash',
    modelName: 'gemini-2.0-flash',
    priority: 4,
    isActive: true,
    circuitOpen: false,
    callCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    costPer1MInput: 0.100,
    costPer1MOutput: 0.400,
    status: 'standby',
  },
  {
    provider: 'openai',
    name: 'OpenAI GPT-4o-mini',
    modelName: 'gpt-4o-mini',
    priority: 5,
    isActive: Boolean(process.env.OPENAI_API_KEY),
    circuitOpen: false,
    callCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    costPer1MInput: 0.150,
    costPer1MOutput: 0.600,
    status: process.env.OPENAI_API_KEY ? 'standby' : 'not_configured',
  },
  {
    provider: 'anthropic',
    name: 'Anthropic Claude 3.5 Haiku',
    modelName: 'claude-3-5-haiku-20241022',
    priority: 6,
    isActive: Boolean(process.env.ANTHROPIC_API_KEY),
    circuitOpen: false,
    callCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    costPer1MInput: 0.800,
    costPer1MOutput: 4.000,
    status: process.env.ANTHROPIC_API_KEY ? 'standby' : 'not_configured',
  },
];

/**
 * Formats provider and model names into clean, readable display titles
 */
export function getFriendlyProviderName(provider: string, modelName: string, rawName?: string): string {
  if (rawName && rawName.trim() && !rawName.trim().toUpperCase().startsWith(provider.toUpperCase())) {
    return rawName.trim();
  }
  const p = (provider || '').toLowerCase();
  const m = (modelName || '').toLowerCase();

  if (p === 'gemini') {
    if (m.includes('1.5-flash')) return 'Google Gemini 1.5 Flash';
    if (m.includes('flash-lite')) return 'Google Gemini Flash Lite';
    if (m.includes('2.0-flash') || m.includes('2.0')) return 'Google Gemini 2.0 Flash';
    if (m.includes('3-flash')) return 'Google Gemini 3 Preview';
    if (m.includes('pro')) return 'Google Gemini Pro';
    return 'Google Gemini Flash';
  }
  if (p === 'openai') {
    if (m.includes('4o-mini')) return 'OpenAI GPT-4o-mini';
    if (m.includes('gpt-4o')) return 'OpenAI GPT-4o';
    if (m.includes('o1')) return 'OpenAI o1';
    if (m.includes('o3')) return 'OpenAI o3-mini';
    return `OpenAI (${modelName})`;
  }
  if (p === 'anthropic') {
    if (m.includes('haiku')) return 'Anthropic Claude 3.5 Haiku';
    if (m.includes('sonnet')) return 'Anthropic Claude 3.5 Sonnet';
    return `Anthropic Claude (${modelName})`;
  }
  if (p === 'custom' || m.includes('deepseek')) {
    if (m.includes('deepseek')) return 'DeepSeek V3';
    return rawName?.trim() || `Custom (${modelName})`;
  }
  return rawName?.trim() || `${provider.toUpperCase()} ${modelName}`;
}

export function getGatewayRuntimeModels(): GatewayModelState[] {
  return runtimeGatewayModels.map((m) => {
    let computedStatus: GatewayModelState['status'] = m.circuitOpen
      ? 'tripped'
      : m.status === 'not_configured'
      ? 'not_configured'
      : m.priority === 1
      ? 'online'
      : 'standby';

    // Strictly strip encrypted ciphertext from API responses to ensure zero key exposure to client
    const { apiKeyEncrypted, ...safeProps } = m;

    return {
      ...safeProps,
      name: getFriendlyProviderName(m.provider, m.modelName, m.name),
      latencyMs: m.callCount > 0 ? (m.lastLatencyMs || m.avgLatencyMs) : 0,
      status: computedStatus,
      successRate: m.callCount > 0 ? Number((((m.callCount - m.failureCount) / m.callCount) * 100).toFixed(1)) : 100,
    };
  });
}

export function setGatewayModelCircuit(identifier: string, open: boolean): void {
  const target = identifier.toLowerCase();
  for (const m of runtimeGatewayModels) {
    if (
      m.modelName.toLowerCase() === target ||
      m.provider.toLowerCase() === target ||
      (m.id && m.id.toLowerCase() === target)
    ) {
      m.circuitOpen = open;
      m.status = open ? 'tripped' : (m.priority === 1 ? 'online' : 'standby');
      if (!open) {
        m.failureCount = 0;
      }
    }
  }

  // Also persist circuit state to Supabase if table exists
  const sb = getSupabaseAdminClient();
  if (sb) {
    void Promise.resolve(
      sb
        .from('platform_ai_gateway_providers')
        .update({ circuit_open: open, updated_at: new Date().toISOString() })
        .or(`provider.eq.${identifier},model_name.eq.${identifier}`)
    ).catch(() => {});
  }
}

export function setGatewayPrimaryModel(modelName: string): void {
  primaryModelOverride = modelName;
  // Invalidate cached config so subsequent platform requests immediately route to new primary
  configCache.clear();

  const match = runtimeGatewayModels.find((m) => m.modelName === modelName || m.id === modelName);
  if (match) {
    const prevPrimary = runtimeGatewayModels.find((m) => m.priority === 1 && m !== match);
    match.priority = 1;
    match.circuitOpen = false;
    match.status = 'online';
    if (prevPrimary) {
      prevPrimary.priority = 2;
      prevPrimary.status = 'standby';
    }
    runtimeGatewayModels.sort((a, b) => a.priority - b.priority);

    // Persist to Supabase if configured
    const sb = getSupabaseAdminClient();
    if (sb) {
      void Promise.resolve((async () => {
        if (match.id) {
          await sb.from('platform_ai_gateway_providers').update({ priority: 1, circuit_open: false, updated_at: new Date().toISOString() }).eq('id', match.id);
        } else {
          await sb.from('platform_ai_gateway_providers').update({ priority: 1, circuit_open: false, updated_at: new Date().toISOString() }).eq('model_name', match.modelName);
        }
        if (prevPrimary) {
          if (prevPrimary.id) {
            await sb.from('platform_ai_gateway_providers').update({ priority: 2, updated_at: new Date().toISOString() }).eq('id', prevPrimary.id);
          } else {
            await sb.from('platform_ai_gateway_providers').update({ priority: 2, updated_at: new Date().toISOString() }).eq('model_name', prevPrimary.modelName);
          }
        }
      })()).catch(() => {});
    }
  }
}

/**
 * Synchronize runtime gateway models with authoritative Supabase platform_ai_gateway_providers table
 */
export async function syncGatewayProvidersFromDb(): Promise<GatewayModelState[]> {
  const sb = getSupabaseAdminClient();
  if (!sb) return getGatewayRuntimeModels();

  try {
    const { data: dbProviders, error } = await sb
      .from('platform_ai_gateway_providers')
      .select('*')
      .order('priority', { ascending: true });

    if (!error && dbProviders && dbProviders.length > 0) {
      const updatedModels: GatewayModelState[] = dbProviders.map((row: any) => {
        const normalizedModelName = row.provider === 'gemini'
          ? normalizeGeminiModel(row.model_name)
          : row.model_name;

        // Auto-heal legacy deprecated model in Supabase row
        if (row.provider === 'gemini' && (row.model_name === 'gemini-1.5-flash' || String(row.model_name).includes('1.5-flash'))) {
          void Promise.resolve(
            sb
              .from('platform_ai_gateway_providers')
              .update({ model_name: normalizedModelName, updated_at: new Date().toISOString() })
              .eq('id', row.id)
          ).catch(() => {});
        }

        const existing = runtimeGatewayModels.find(
          (m) => (m.id && m.id === row.id) || (m.provider === row.provider && (m.modelName === row.model_name || m.modelName === normalizedModelName))
        );

        let hasApiKey = false;
        let keyLast4: string | undefined;
        let keySource: 'vault' | 'env' | 'none' = 'none';

        if (row.api_key_encrypted) {
          hasApiKey = true;
          keySource = 'vault';
          try {
            const decrypted = decryptSecret(row.api_key_encrypted, 'platform_global');
            if (decrypted) keyLast4 = decrypted.slice(-4);
          } catch {
            keyLast4 = '••••';
          }
        } else {
          // Check env fallback
          if (row.provider === 'gemini' && (process.env.AI_API_KEY || process.env.GEMINI_API_KEY)) {
            hasApiKey = true;
            keySource = 'env';
            keyLast4 = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY)!.slice(-4);
          } else if (row.provider === 'openai' && process.env.OPENAI_API_KEY) {
            hasApiKey = true;
            keySource = 'env';
            keyLast4 = process.env.OPENAI_API_KEY.slice(-4);
          } else if (row.provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
            hasApiKey = true;
            keySource = 'env';
            keyLast4 = process.env.ANTHROPIC_API_KEY.slice(-4);
          }
        }

        const callCount = existing?.callCount || 0;
        const failureCount = existing?.failureCount || row.consecutive_failures || 0;
        const avgLatencyMs = existing?.avgLatencyMs || 0;
        const lastLatencyMs = existing?.lastLatencyMs || 0;

        return {
          id: row.id,
          provider: row.provider,
          name: getFriendlyProviderName(row.provider, normalizedModelName, row.name),
          modelName: normalizedModelName,
          priority: row.priority,
          isActive: row.is_active !== false,
          circuitOpen: Boolean(row.circuit_open),
          callCount,
          failureCount,
          avgLatencyMs,
          lastLatencyMs,
          costPer1MInput: Number(row.cost_per_1m_input_tokens || 0.15),
          costPer1MOutput: Number(row.cost_per_1m_output_tokens || 0.60),
          status: Boolean(row.circuit_open)
            ? 'tripped'
            : !hasApiKey
            ? 'not_configured'
            : row.priority === 1
            ? 'online'
            : 'standby',
          baseUrl: row.base_url || undefined,
          hasApiKey,
          keySource,
          keyLast4: keyLast4 ? `••••${keyLast4}` : undefined,
          apiKeyEncrypted: row.api_key_encrypted || undefined,
          rateLimitRpm: row.rate_limit_rpm || 60,
          rateLimitTpm: row.rate_limit_tpm || 1000000,
          maxTokensPerReq: row.max_tokens_per_req || 4096,
          timeoutMs: row.timeout_ms || 10000,
        };
      });

      runtimeGatewayModels.length = 0;
      runtimeGatewayModels.push(...updatedModels);
      runtimeGatewayModels.sort((a, b) => a.priority - b.priority);
    }
  } catch (err) {
    console.warn('[aiGateway] Failed to sync providers from Supabase:', err);
  }

  return getGatewayRuntimeModels();
}

/**
 * Add or update global LLM provider in Supabase and sync runtime state
 */
export async function addGatewayProviderDb(params: {
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
}): Promise<GatewayModelState> {
  const sb = getSupabaseAdminClient();
  const encryptedKey = params.apiKey ? encryptSecret(params.apiKey, 'platform_global') : undefined;
  const priority = params.priority ?? (runtimeGatewayModels.length + 1);

  if (sb) {
    try {
      const payload: any = {
        provider: params.provider.toLowerCase(),
        name: params.name,
        model_name: params.modelName,
        priority,
        cost_per_1m_input_tokens: params.costPer1MInput ?? 0.15,
        cost_per_1m_output_tokens: params.costPer1MOutput ?? 0.60,
        rate_limit_rpm: params.rateLimitRpm ?? 60,
        rate_limit_tpm: params.rateLimitTpm ?? 1000000,
        timeout_ms: params.timeoutMs ?? 10000,
        max_tokens_per_req: params.maxTokensPerReq ?? 4096,
        updated_at: new Date().toISOString(),
      };
      if (encryptedKey) payload.api_key_encrypted = encryptedKey;
      if (params.baseUrl) payload.base_url = params.baseUrl;

      await sb.from('platform_ai_gateway_providers').upsert(payload, { onConflict: 'provider, model_name' });
      await syncGatewayProvidersFromDb();
    } catch (e) {
      console.warn('[aiGateway] Could not upsert provider to DB, keeping in-memory fallback:', e);
    }
  }

  // Ensure runtime in-memory models are updated
  let existing = runtimeGatewayModels.find((m) => m.modelName === params.modelName || (m.provider === params.provider && m.name === params.name));
  const keyLast4 = params.apiKey ? `••••${params.apiKey.slice(-4)}` : undefined;

  if (existing) {
    existing.name = params.name;
    if (params.apiKey) {
      existing.hasApiKey = true;
      existing.keyLast4 = keyLast4;
      existing.apiKeyEncrypted = encryptedKey;
    }
    if (params.baseUrl !== undefined) existing.baseUrl = params.baseUrl;
    if (params.priority !== undefined) existing.priority = params.priority;
    if (params.costPer1MInput !== undefined) existing.costPer1MInput = params.costPer1MInput;
    if (params.costPer1MOutput !== undefined) existing.costPer1MOutput = params.costPer1MOutput;
    if (params.rateLimitRpm !== undefined) existing.rateLimitRpm = params.rateLimitRpm;
    if (params.rateLimitTpm !== undefined) existing.rateLimitTpm = params.rateLimitTpm;
    if (params.timeoutMs !== undefined) existing.timeoutMs = params.timeoutMs;
    if (params.maxTokensPerReq !== undefined) existing.maxTokensPerReq = params.maxTokensPerReq;
  } else {
    existing = {
      id: `custom-${Date.now()}`,
      provider: params.provider as any,
      name: params.name,
      modelName: params.modelName,
      priority,
      isActive: true,
      circuitOpen: false,
      callCount: 0,
      failureCount: 0,
      avgLatencyMs: 0,
      lastLatencyMs: 0,
      costPer1MInput: params.costPer1MInput ?? 0.15,
      costPer1MOutput: params.costPer1MOutput ?? 0.60,
      status: 'standby',
      baseUrl: params.baseUrl,
      hasApiKey: Boolean(params.apiKey),
      keyLast4,
      apiKeyEncrypted: encryptedKey,
      rateLimitRpm: params.rateLimitRpm ?? 60,
      rateLimitTpm: params.rateLimitTpm ?? 1000000,
      maxTokensPerReq: params.maxTokensPerReq ?? 4096,
      timeoutMs: params.timeoutMs ?? 10000,
    };
    runtimeGatewayModels.push(existing);
  }

  runtimeGatewayModels.sort((a, b) => a.priority - b.priority);
  return existing;
}

/**
 * Update an existing gateway provider in Supabase
 */
export async function updateGatewayProviderDb(
  id: string,
  params: {
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
): Promise<GatewayModelState | null> {
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      const payload: any = { updated_at: new Date().toISOString() };
      if (params.name !== undefined) payload.name = params.name;
      if (params.modelName !== undefined) payload.model_name = params.modelName;
      if (params.apiKey) payload.api_key_encrypted = encryptSecret(params.apiKey, 'platform_global');
      if (params.baseUrl !== undefined) payload.base_url = params.baseUrl;
      if (params.priority !== undefined) payload.priority = params.priority;
      if (params.costPer1MInput !== undefined) payload.cost_per_1m_input_tokens = params.costPer1MInput;
      if (params.costPer1MOutput !== undefined) payload.cost_per_1m_output_tokens = params.costPer1MOutput;
      if (params.rateLimitRpm !== undefined) payload.rate_limit_rpm = params.rateLimitRpm;
      if (params.rateLimitTpm !== undefined) payload.rate_limit_tpm = params.rateLimitTpm;
      if (params.timeoutMs !== undefined) payload.timeout_ms = params.timeoutMs;
      if (params.maxTokensPerReq !== undefined) payload.max_tokens_per_req = params.maxTokensPerReq;
      if (params.circuitOpen !== undefined) payload.circuit_open = params.circuitOpen;
      if (params.isActive !== undefined) payload.is_active = params.isActive;

      await sb.from('platform_ai_gateway_providers').update(payload).eq('id', id);
      await syncGatewayProvidersFromDb();
    } catch (e) {
      console.warn('[aiGateway] Could not update provider in DB:', e);
    }
  }

  const existing = runtimeGatewayModels.find((m) => m.id === id || m.modelName === id);
  if (existing) {
    if (params.name !== undefined) existing.name = params.name;
    if (params.modelName !== undefined) existing.modelName = params.modelName;
    if (params.apiKey) {
      existing.hasApiKey = true;
      existing.keyLast4 = `••••${params.apiKey.slice(-4)}`;
      existing.apiKeyEncrypted = encryptSecret(params.apiKey, 'platform_global');
    }
    if (params.baseUrl !== undefined) existing.baseUrl = params.baseUrl;
    if (params.priority !== undefined) existing.priority = params.priority;
    if (params.costPer1MInput !== undefined) existing.costPer1MInput = params.costPer1MInput;
    if (params.costPer1MOutput !== undefined) existing.costPer1MOutput = params.costPer1MOutput;
    if (params.rateLimitRpm !== undefined) existing.rateLimitRpm = params.rateLimitRpm;
    if (params.rateLimitTpm !== undefined) existing.rateLimitTpm = params.rateLimitTpm;
    if (params.timeoutMs !== undefined) existing.timeoutMs = params.timeoutMs;
    if (params.maxTokensPerReq !== undefined) existing.maxTokensPerReq = params.maxTokensPerReq;
    if (params.circuitOpen !== undefined) existing.circuitOpen = params.circuitOpen;
    if (params.isActive !== undefined) existing.isActive = params.isActive;
    runtimeGatewayModels.sort((a, b) => a.priority - b.priority);
  }
  return existing || null;
}

/**
 * Delete a gateway provider from Supabase
 */
export async function deleteGatewayProviderDb(id: string): Promise<boolean> {
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      await sb.from('platform_ai_gateway_providers').delete().eq('id', id);
      await syncGatewayProvidersFromDb();
    } catch {
      // non-blocking
    }
  }

  const idx = runtimeGatewayModels.findIndex((m) => m.id === id || m.modelName === id);
  if (idx !== -1) {
    runtimeGatewayModels.splice(idx, 1);
    return true;
  }
  return true;
}

/**
 * Reorder priorities across the entire failover chain
 */
export async function reorderGatewayProvidersDb(items: Array<{ id: string; priority: number }>): Promise<void> {
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      for (const item of items) {
        await sb.from('platform_ai_gateway_providers').update({ priority: item.priority, updated_at: new Date().toISOString() }).eq('id', item.id);
      }
      await syncGatewayProvidersFromDb();
    } catch {
      // non-blocking
    }
  }

  for (const item of items) {
    const match = runtimeGatewayModels.find((m) => m.id === item.id || m.modelName === item.id);
    if (match) {
      match.priority = item.priority;
    }
  }
  runtimeGatewayModels.sort((a, b) => a.priority - b.priority);
}

/**
 * Resolves the plaintext API key for any gateway model state
 * Prioritizes AES-256-GCM encrypted database vault key, then checks environment variable fallbacks
 */
export function resolveNodeApiKey(model: GatewayModelState): string {
  if (model.apiKeyEncrypted) {
    try {
      const dec = decryptSecret(model.apiKeyEncrypted, 'platform_global');
      if (dec && dec.trim()) return dec.trim();
    } catch {
      // ignore
    }
  }

  const p = (model.provider || '').toLowerCase();
  const m = (model.modelName || '').toLowerCase();

  if (p === 'gemini') {
    return (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  }
  if (p === 'openai') {
    return (process.env.OPENAI_API_KEY || '').trim();
  }
  if (p === 'anthropic') {
    return (process.env.ANTHROPIC_API_KEY || '').trim();
  }
  if (p === 'custom' || m.includes('deepseek') || m.includes('groq')) {
    return (process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  }

  return '';
}

/**
 * Test a specific gateway node directly using its configured credentials
 */
export async function testGatewayNodeDirect(providerIdOrModel: string): Promise<AITestResult> {
  const model = runtimeGatewayModels.find((m) => m.id === providerIdOrModel || m.modelName === providerIdOrModel);
  if (!model) {
    return {
      success: false,
      provider: 'unknown',
      model: providerIdOrModel,
      latencyMs: 0,
      error: 'Model node not found',
    };
  }

  const apiKey = resolveNodeApiKey(model);

  const result = await testAIConnection({
    provider: (model.provider === 'gemini' ? 'gemini' : model.provider === 'openai' ? 'openai' : model.provider === 'anthropic' ? 'anthropic' : 'custom') as AIProvider,
    modelName: model.modelName,
    apiKey,
    baseUrl: model.baseUrl,
  });

  return result;
}

export function getGatewayRuntimeState() {
  const primary = runtimeGatewayModels.find((m) => m.priority === 1 && !m.circuitOpen) || runtimeGatewayModels[0];
  const activeFallback = runtimeGatewayModels.find((m) => m.priority > 1 && !m.circuitOpen);
  const totalCalls = runtimeGatewayModels.reduce((acc, m) => acc + m.callCount, 0);
  const totalFailures = runtimeGatewayModels.reduce((acc, m) => acc + m.failureCount, 0);
  const totalLatency = runtimeGatewayModels.reduce((acc, m) => acc + m.avgLatencyMs * Math.max(1, m.callCount), 0);
  const avgLatency = totalCalls > 0 ? Math.round(totalLatency / totalCalls) : primary.avgLatencyMs;

  return {
    activeProvider: primary.provider === 'gemini' ? 'Google Gemini' : primary.provider === 'openai' ? 'OpenAI' : 'Anthropic',
    activeModel: primary.modelName,
    fallbackModel: activeFallback?.modelName || 'gemini-flash-latest',
    avgLatencyMs: avgLatency,
    uptimePercent: totalCalls > 0 ? Number((((totalCalls - totalFailures) / totalCalls) * 100).toFixed(2)) : 99.85,
    models: getGatewayRuntimeModels(),
  };
}

/**
 * Resolves the primary active API key directly from Supabase DB encrypted vault (AES-256-GCM),
 * falling back to process.env only if DB has not configured a custom key.
 */
export function getPrimaryGatewayApiKey(): {
  apiKey: string;
  source: 'vault' | 'env' | 'none';
  modelName: string;
  provider: string;
  keyLast4?: string;
} {
  const primary = runtimeGatewayModels.find((m) => m.priority === 1 && !m.circuitOpen) || runtimeGatewayModels[0];
  if (!primary) {
    const fallbackEnv = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
    return {
      apiKey: fallbackEnv,
      source: fallbackEnv ? 'env' : 'none',
      modelName: 'gemini-flash-lite-latest',
      provider: 'gemini',
      keyLast4: fallbackEnv ? fallbackEnv.slice(-4) : undefined,
    };
  }

  // 1. Authoritative Supabase DB Vault Encrypted Key
  if (primary.apiKeyEncrypted) {
    try {
      const decrypted = decryptSecret(primary.apiKeyEncrypted, 'platform_global');
      if (decrypted && decrypted.trim()) {
        return {
          apiKey: decrypted.trim(),
          source: 'vault',
          modelName: primary.modelName,
          provider: primary.provider,
          keyLast4: decrypted.trim().slice(-4),
        };
      }
    } catch {
      // decryption failed
    }
  }

  // 2. Server Environment variable fallback
  let envKey = '';
  if (primary.provider === 'gemini') {
    envKey = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  } else if (primary.provider === 'openai') {
    envKey = (process.env.OPENAI_API_KEY || '').trim();
  } else if (primary.provider === 'anthropic') {
    envKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  }

  return {
    apiKey: envKey,
    source: envKey ? 'env' : 'none',
    modelName: primary.modelName,
    provider: primary.provider,
    keyLast4: envKey ? envKey.slice(-4) : undefined,
  };
}

/**
 * Record real-time AI telemetry event to Supabase and in-memory ring-buffer
 */
export async function recordAiTelemetryEvent(params: TelemetryEventParams): Promise<void> {
  const timestamp = params.timestamp || new Date().toISOString();
  const event: TelemetryEventParams = { ...params, timestamp };

  // 1. Maintain in-memory ring buffer
  inMemoryUsageEvents.push(event);
  if (inMemoryUsageEvents.length > MAX_TELEMETRY_BUFFER) {
    inMemoryUsageEvents.shift();
  }

  // 2. Update model runtime metrics
  const modelMatch = runtimeGatewayModels.find((m) => m.modelName === params.modelName || m.provider === params.provider);
  if (modelMatch) {
    modelMatch.callCount++;
    if (params.status === 'error' || params.status === 'rate_limited') {
      modelMatch.failureCount++;
    }
    modelMatch.lastLatencyMs = params.latencyMs;
    modelMatch.avgLatencyMs = Math.round((modelMatch.avgLatencyMs * (modelMatch.callCount - 1) + params.latencyMs) / modelMatch.callCount);
    modelMatch.lastUsedAt = timestamp;
  }

  // 3. Write to Supabase platform_ai_usage_events & update org_ai_status asynchronously
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      await sb.from('platform_ai_usage_events').insert({
        organization_id: params.organizationId,
        portal_type: params.portalType || 'ai_assistant',
        feature_area: params.featureArea || 'copilot_query',
        provider: params.provider,
        model_name: params.modelName,
        fallback_triggered: params.fallbackTriggered || false,
        prompt_tokens: params.promptTokens,
        completion_tokens: params.completionTokens,
        total_tokens: params.totalTokens,
        cost_usd: params.costUsd || 0,
        latency_ms: params.latencyMs,
        status: params.status || 'success',
        created_at: timestamp,
      });
      event.persisted = true;

      // Also increment org_ai_status counters
      const colToIncrement = params.provider === 'gemini' && params.costUsd === 0 ? 'platform_requests_this_month' : 'org_requests_this_month';
      const { data: current } = await sb.from('org_ai_status').select('*').eq('organization_id', params.organizationId).maybeSingle();
      if (!current) {
        await sb.from('org_ai_status').insert({
          organization_id: params.organizationId,
          active_source: 'platform',
          org_requests_this_month: 0,
          platform_requests_this_month: 1,
          last_used_at: timestamp,
        });
      } else {
        await sb
          .from('org_ai_status')
          .update({
            [colToIncrement]: (current[colToIncrement] || 0) + 1,
            last_used_at: timestamp,
            updated_at: timestamp,
          })
          .eq('organization_id', params.organizationId);
      }
    } catch {
      // Non-blocking: table might not exist yet or connection blip
    }
  }
}

export function getInMemoryTelemetrySummary() {
  const totalEvents = inMemoryUsageEvents.length;
  const totalTokens = inMemoryUsageEvents.reduce((sum, e) => sum + e.totalTokens, 0);
  const promptTokens = inMemoryUsageEvents.reduce((sum, e) => sum + e.promptTokens, 0);
  const completionTokens = inMemoryUsageEvents.reduce((sum, e) => sum + e.completionTokens, 0);
  const actualCostUsd = inMemoryUsageEvents.reduce((sum, e) => sum + (e.costUsd || 0), 0);
  // Commercial shadow cost
  const commercialEquivalentUsd = (promptTokens / 1_000_000) * 0.075 + (completionTokens / 1_000_000) * 0.30;
  const fallbackCount = inMemoryUsageEvents.filter((e) => e.fallbackTriggered).length;
  const avgLatencyMs = totalEvents > 0 ? Math.round(inMemoryUsageEvents.reduce((sum, e) => sum + e.latencyMs, 0) / totalEvents) : 580;

  return {
    totalEvents,
    totalTokens,
    promptTokens,
    completionTokens,
    actualCostUsd: Number(actualCostUsd.toFixed(4)),
    commercialEquivalentUsd: Number(commercialEquivalentUsd.toFixed(4)),
    fallbackCount,
    avgLatencyMs,
    events: inMemoryUsageEvents,
  };
}

/**
 * Returns only in-memory events that failed to persist to Supabase
 * Prevents double-counting in platform reports.
 */
export function getUnpersistedTelemetryEvents(): TelemetryEventParams[] {
  return inMemoryUsageEvents.filter((e) => !e.persisted);
}

/**
 * Enforces per-tenant monthly AI Credits limits (§32) for platform pooled keys
 */
export async function checkOrgAiCreditsLimit(orgId: string): Promise<{
  allowed: boolean;
  reason?: string;
  creditsUsed: number;
  creditsQuota: number;
  planName: string;
}> {
  const sb = getSupabaseAdminClient();
  if (!sb) return { allowed: true, creditsUsed: 0, creditsQuota: 500, planName: 'Default' };

  try {
    const { data: org } = await sb.from('organizations').select('id, name, plan, settings').eq('id', orgId).maybeSingle();
    const rawPlan = org?.settings?.plan || org?.plan || 'basic';
    const planSlug = String(rawPlan).toLowerCase().replace(/^plan-/, '');

    const { data: planRow } = await sb.from('platform_plans').select('name, limits').eq('slug', planSlug).maybeSingle();
    const creditsQuota = Number(planRow?.limits?.ai_credits ?? (planSlug === 'enterprise' ? 2500 : planSlug === 'professional' ? 500 : 100));
    const planName = planRow?.name || planSlug;

    const { data: statusRow } = await sb.from('org_ai_status').select('platform_requests_this_month').eq('organization_id', orgId).maybeSingle();
    const creditsUsed = Number(statusRow?.platform_requests_this_month ?? 0);

    if (creditsQuota > 0 && creditsUsed >= creditsQuota) {
      return {
        allowed: false,
        reason: `Monthly AI credits quota reached (${creditsUsed}/${creditsQuota})`,
        creditsUsed,
        creditsQuota,
        planName,
      };
    }

    return {
      allowed: true,
      creditsUsed,
      creditsQuota,
      planName,
    };
  } catch {
    return { allowed: true, creditsUsed: 0, creditsQuota: 500, planName: 'Default' };
  }
}

interface CachedConfig {
  resolved: ResolvedAIConfig;
  expiresAt: number;
}

const configCache = new Map<string, CachedConfig>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache for dynamically discovered Google Gemini models per API key
const geminiModelsCache = new Map<string, { models: string[]; expiresAt: number }>();

async function getAvailableGeminiModels(apiKey: string): Promise<string[]> {
  const cached = geminiModelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }

  const staticFallbacks = [
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
  ];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data: any = await res.json();
      if (Array.isArray(data?.models)) {
        const found = data.models
          .filter((m: any) => {
            if (!m.supportedGenerationMethods?.includes('generateContent')) return false;
            if (Array.isArray(m.supportedOutputModalities) && !m.supportedOutputModalities.includes('TEXT')) {
              return false;
            }
            if (Array.isArray(m.outputModalities) && !m.outputModalities.includes('TEXT')) {
              return false;
            }

            const rawName = String(m.name || '').toLowerCase();
            if (
              rawName.includes('embedding') ||
              rawName.includes('imagen') ||
              rawName.includes('vision') ||
              rawName.includes('aqa') ||
              rawName.includes('tts') ||
              rawName.includes('audio') ||
              rawName.includes('realtime') ||
              rawName.includes('transcription') ||
              rawName.includes('2.5-flash') ||
              rawName === 'models/gemini-1.5-flash' ||
              rawName === 'gemini-1.5-flash'
            ) {
              return false;
            }

            return true;
          })
          .map((m: any) => String(m.name || '').replace(/^models\//, ''))
          .filter((name: string) => Boolean(name) && name !== 'gemini-1.5-flash');

        const preferredPriority = [
          'gemini-flash-lite-latest',
          'gemini-flash-latest',
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
          'gemini-3-flash-preview',
          'gemini-3.5-flash',
          'gemini-3.8-flash',
          'gemini-1.5-flash-latest',
        ];

        const sorted = found.sort((a: string, b: string) => {
          const aIdx = preferredPriority.indexOf(a);
          const bIdx = preferredPriority.indexOf(b);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
          const aFlash = a.includes('flash') ? 0 : 1;
          const bFlash = b.includes('flash') ? 0 : 1;
          return aFlash - bFlash;
        });

        if (sorted.length > 0) {
          geminiModelsCache.set(apiKey, { models: sorted, expiresAt: Date.now() + 60 * 60 * 1000 });
          return sorted;
        }
      }
    }
  } catch (err: any) {
    // Non-blocking
  }

  return staticFallbacks;
}

// Tenant-specific quota trackers (in-memory fast lookup + synced to Supabase)
const tenantQuotaExhaustedUntil = new Map<string, number>();

export function invalidateOrgAICache(orgId: string): void {
  configCache.delete(orgId);
  tenantQuotaExhaustedUntil.delete(orgId);
}

export function isOrgQuotaExhausted(orgId: string): boolean {
  const until = tenantQuotaExhaustedUntil.get(orgId);
  return !!until && Date.now() < until;
}

export function markOrgQuotaExhausted(orgId: string, retryAfterSeconds: number = 3600): void {
  const cooldownMs = Math.max(retryAfterSeconds, 60) * 1000;
  const resetTime = Date.now() + cooldownMs;
  tenantQuotaExhaustedUntil.set(orgId, resetTime);

  const sb = getSupabaseAdminClient();
  if (sb) {
    void Promise.resolve(
      sb.from('org_ai_status').upsert({
        organization_id: orgId,
        org_key_status: 'quota_exceeded',
        org_key_reset_at: new Date(resetTime).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ).catch(() => {});
  }
}

/**
 * Resolve AI configuration for an organization
 */
export async function resolveOrgAIConfig(orgId: string): Promise<ResolvedAIConfig> {
  const now = Date.now();
  const cached = configCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    return cached.resolved;
  }

  const sb = getSupabaseAdminClient();

  // 1. Check for custom organization credentials in Supabase
  if (sb) {
    try {
      const { data: creds, error } = await sb
        .from('org_ai_credentials')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .maybeSingle();

      if (!error && creds && creds.key_ciphertext) {
        const decryptedKey = decryptSecret(creds.key_ciphertext, orgId);
        if (decryptedKey) {
          const quotaExceeded = isOrgQuotaExhausted(orgId);
          const resolved: ResolvedAIConfig = {
            source: 'organization',
            provider: creds.provider as AIProvider,
            providerName: creds.provider === 'openai' ? 'OpenAI' : 'Google Gemini',
            modelName: creds.model_name || 'gemini-flash-lite-latest',
            apiKey: decryptedKey,
            baseUrl: creds.base_url || undefined,
            temperature: 0.3,
            maxTokens: 4096,
            keyLast4: creds.key_last4,
            isCustomKey: true,
            quotaExceeded,
            quotaResetAt: tenantQuotaExhaustedUntil.get(orgId)
              ? new Date(tenantQuotaExhaustedUntil.get(orgId)!).toISOString()
              : undefined,
          };

          configCache.set(orgId, { resolved, expiresAt: now + CACHE_TTL_MS });
          return resolved;
        }
      }
    } catch {
      // Fall through to platform default
    }
  }

  // 2. Fallback to platform default key (DB Vault or Environment GEMINI_API_KEY / AI_API_KEY)
  const platformKeyInfo = getPrimaryGatewayApiKey();
  const defaultConfig = getDefaultAIConfig();
  const apiKey = (platformKeyInfo.apiKey || defaultConfig?.apiKey || '').trim();

  if (apiKey) {
    const rawModel = primaryModelOverride || platformKeyInfo.modelName || defaultConfig?.modelName || 'gemini-2.0-flash';
    const effectiveModel = normalizeGeminiModel(rawModel);
    const rawProvider = platformKeyInfo.provider || defaultConfig?.provider || 'gemini';
    const effectiveProvider = (rawProvider === 'openai' ? 'openai' : 'gemini') as AIProvider;

    const resolved: ResolvedAIConfig = {
      source: 'platform',
      provider: effectiveProvider,
      providerName: 'Finance OS AI (Platform Shared)',
      modelName: effectiveModel,
      apiKey,
      baseUrl: defaultConfig?.baseUrl,
      temperature: 0.3,
      maxTokens: 4096,
      keyLast4: platformKeyInfo.keyLast4 || apiKey.slice(-4),
      isCustomKey: false,
      quotaExceeded: false,
    };
    configCache.set(orgId, { resolved, expiresAt: now + CACHE_TTL_MS });
    return resolved;
  }

  // 3. No key available
  return {
    source: 'none',
    provider: 'gemini',
    providerName: 'None',
    modelName: 'none',
    apiKey: '',
    temperature: 0.3,
    maxTokens: 0,
    isCustomKey: false,
    quotaExceeded: false,
  };
}

/**
 * Increment usage counter for tracking
 */
export async function trackUsage(orgId: string, source: AISource): Promise<void> {
  await recordAiTelemetryEvent({
    organizationId: orgId,
    provider: 'gemini',
    modelName: 'gemini-flash-lite-latest',
    promptTokens: 200,
    completionTokens: 80,
    totalTokens: 280,
    costUsd: 0,
    latencyMs: 450,
    status: 'success',
  });
}

/**
 * Test AI Connection directly with provider
 */
export async function testAIConnection(params: {
  provider: AIProvider;
  modelName: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<AITestResult> {
  const { provider, modelName, apiKey, baseUrl } = params;
  const start = Date.now();

  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      provider,
      model: modelName,
      latencyMs: 0,
      error: 'API key is missing or empty.',
    };
  }

  const cleanKey = apiKey.trim();

  try {
    if (provider === 'gemini') {
      const normalizedModel = normalizeGeminiModel(modelName);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModel}:generateContent`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey,
        },
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with 1 word: Pong' }] }],
          generationConfig: { maxOutputTokens: 5, temperature: 0 },
        }),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errorText = await res.text();
        const isQuota = res.status === 429 || errorText.includes('RESOURCE_EXHAUSTED');
        let errorMsg = `Gemini returned ${res.status}: ${res.statusText}`;
        if (isQuota) {
          errorMsg = 'API quota or rate limit exceeded on this key.';
          await recordQuotaError(cleanKey, errorText, normalizedModel, 'platform');
        } else if (res.status === 400 || res.status === 403) {
          errorMsg = 'Invalid API key or unauthorized project access.';
        }
        return {
          success: false,
          provider: 'gemini',
          model: normalizedModel,
          latencyMs,
          error: errorMsg,
          isQuotaExceeded: isQuota,
        };
      }

      // 1. Record successful call for rolling RPM radar
      recordSuccessfulCall(cleanKey, 'platform');

      // 2. Actively verify key tier live
      void verifyGeminiKeyLive(cleanKey, normalizedModel, 'platform').catch(() => {});

      // 3. Record live telemetry event so dashboard metrics reflect the invocation
      void recordAiTelemetryEvent({
        organizationId: 'platform_global',
        portalType: 'ai_assistant',
        featureArea: 'copilot_analysis',
        provider: 'gemini',
        modelName: normalizedModel,
        fallbackTriggered: false,
        promptTokens: 8,
        completionTokens: 2,
        totalTokens: 10,
        costUsd: 0,
        latencyMs,
        status: 'success',
      }).catch(() => {});

      // 4. Update runtime model stats
      const matched = runtimeGatewayModels.find((m) => m.modelName === normalizedModel);
      if (matched) {
        matched.callCount++;
        matched.lastLatencyMs = latencyMs;
        matched.avgLatencyMs = matched.callCount > 1
          ? Math.round((matched.avgLatencyMs * (matched.callCount - 1) + latencyMs) / matched.callCount)
          : latencyMs;
        matched.lastUsedAt = new Date().toISOString();
      }

      return {
        success: true,
        provider: 'gemini',
        model: normalizedModel,
        latencyMs,
      };
    } else if (provider === 'anthropic') {
      const url = 'https://api.anthropic.com/v1/messages';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cleanKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          model: modelName || 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'Respond with 1 word: Pong' }],
          max_tokens: 5,
        }),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errorText = await res.text();
        const isQuota = res.status === 429 || errorText.includes('rate_limit_error') || errorText.includes('overloaded');
        let errorMsg = `Anthropic returned ${res.status}: ${res.statusText}`;
        if (isQuota) {
          errorMsg = 'API quota or rate limit exceeded on this Anthropic key.';
        } else if (res.status === 401) {
          errorMsg = 'Invalid Anthropic API key.';
        }
        return {
          success: false,
          provider: 'anthropic',
          model: modelName,
          latencyMs,
          error: errorMsg,
          isQuotaExceeded: isQuota,
        };
      }

      return {
        success: true,
        provider: 'anthropic',
        model: modelName,
        latencyMs,
      };
    } else {
      // OpenAI / OpenAI-compatible / Custom (DeepSeek, Groq, etc.)
      const url = baseUrl
        ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
        : 'https://api.openai.com/v1/chat/completions';

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`,
        },
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          model: modelName || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Respond with 1 word: Pong' }],
          max_tokens: 5,
        }),
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errorText = await res.text();
        const isQuota = res.status === 429 || errorText.includes('insufficient_quota');
        let errorMsg = `Provider returned ${res.status}: ${res.statusText}`;
        if (isQuota) {
          errorMsg = 'API quota exhausted on this key (check billing/credits).';
        } else if (res.status === 401) {
          errorMsg = 'Invalid API key or unauthorized.';
        }
        return {
          success: false,
          provider: provider || 'openai',
          model: modelName,
          latencyMs,
          error: errorMsg,
          isQuotaExceeded: isQuota,
        };
      }

      return {
        success: true,
        provider: provider || 'openai',
        model: modelName,
        latencyMs,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      success: false,
      provider,
      model: modelName,
      latencyMs,
      error: err.name === 'TimeoutError' ? 'Connection timed out after 12 seconds.' : err.message,
    };
  }
}

// ── Multi-Provider Execution Drivers ────────────────────────────────────────

async function callGeminiChatDirect(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}> {
  const { apiKey, model, systemPrompt, messages, temperature = 0.4, maxTokens = 4096, timeoutMs = 35_000 } = params;
  const start = Date.now();
  const normalized = normalizeGeminiModel(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${normalized}:generateContent`;

  const parts: Array<{ text: string }> = [{ text: systemPrompt + '\n\n' }];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
    parts.push({ text: `${prefix}${msg.content}\n` });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        candidateCount: 1,
      },
    }),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || errorText.includes('RESOURCE_EXHAUSTED')) {
      throw new Error(`Gemini rate limited (429): ${errorText.slice(0, 150)}`);
    }
    if (response.status === 503 || errorText.includes('high demand') || errorText.includes('UNAVAILABLE')) {
      throw new Error(`Gemini high demand (503): ${errorText.slice(0, 150)}`);
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 150)}`);
  }

  const data: any = await response.json();
  const rawParts = data.candidates?.[0]?.content?.parts || [];
  const text = rawParts
    .filter((p: any) => typeof p.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('')
    .trim() || rawParts.map((p: any) => p.text || '').join('').trim();

  if (!text) throw new Error('Empty response from Gemini provider.');

  const promptChars = systemPrompt.length + messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const promptTokens = data.usageMetadata?.promptTokenCount || Math.ceil(promptChars / 4);
  const completionTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);
  const totalTokens = data.usageMetadata?.totalTokenCount || (promptTokens + completionTokens);

  return { text, promptTokens, completionTokens, totalTokens, latencyMs };
}

async function callOpenAiCompatibleChat(params: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}> {
  const { apiKey, baseUrl, model, systemPrompt, messages, temperature = 0.4, maxTokens = 4096, timeoutMs = 35_000 } = params;
  const start = Date.now();
  const url = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  const promptMsgs = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: promptMsgs,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || errorText.includes('insufficient_quota')) {
      throw new Error(`OpenAI rate limit or quota exceeded (429): ${errorText.slice(0, 150)}`);
    }
    throw new Error(`OpenAI API error (${response.status}): ${errorText.slice(0, 150)}`);
  }

  const data: any = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI-compatible provider.');

  const promptChars = systemPrompt.length + messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const promptTokens = data.usage?.prompt_tokens || Math.ceil(promptChars / 4);
  const completionTokens = data.usage?.completion_tokens || Math.ceil(text.length / 4);
  const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

  return { text: text.trim(), promptTokens, completionTokens, totalTokens, latencyMs };
}

async function callAnthropicChat(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}> {
  const { apiKey, model, systemPrompt, messages, temperature = 0.4, maxTokens = 4096, timeoutMs = 35_000 } = params;
  const start = Date.now();
  const url = 'https://api.anthropic.com/v1/messages';

  const anthropicMessages = messages
    .filter((m) => m.content && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

  if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
    anthropicMessages.unshift({ role: 'user', content: 'Hello' });
  }

  const payload: any = {
    model: model || 'claude-3-5-haiku-20241022',
    messages: anthropicMessages,
    max_tokens: maxTokens,
    temperature,
  };
  if (systemPrompt && systemPrompt.trim()) {
    payload.system = systemPrompt;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(payload),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || errorText.includes('rate_limit_error') || errorText.includes('overloaded')) {
      throw new Error(`Anthropic rate limited (429): ${errorText.slice(0, 150)}`);
    }
    throw new Error(`Anthropic API error (${response.status}): ${errorText.slice(0, 150)}`);
  }

  const data: any = await response.json();
  const text = data.content
    ?.filter((c: any) => c.type === 'text')
    ?.map((c: any) => c.text)
    ?.join('')
    ?.trim() || '';

  if (!text) throw new Error('Empty response from Anthropic provider.');

  const promptChars = (systemPrompt?.length || 0) + messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const promptTokens = data.usage?.input_tokens || Math.ceil(promptChars / 4);
  const completionTokens = data.usage?.output_tokens || Math.ceil(text.length / 4);
  const totalTokens = promptTokens + completionTokens;

  return { text, promptTokens, completionTokens, totalTokens, latencyMs };
}

async function callGeminiJSONDirect<T>(params: {
  apiKey: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{
  data: T;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}> {
  const { apiKey, model, prompt, temperature = 0.2, maxTokens = 4096, timeoutMs = 35_000 } = params;
  const start = Date.now();
  const normalized = normalizeGeminiModel(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${normalized}:generateContent`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        candidateCount: 1,
        responseMimeType: 'application/json',
      },
    }),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || errorText.includes('RESOURCE_EXHAUSTED')) {
      throw new Error(`Gemini rate limited (429): ${errorText.slice(0, 150)}`);
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 150)}`);
  }

  const resJson: any = await response.json();
  const raw = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as T;

  const promptTokens = resJson.usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4);
  const completionTokens = resJson.usageMetadata?.candidatesTokenCount || Math.ceil(cleaned.length / 4);
  const totalTokens = promptTokens + completionTokens;

  return { data: parsed, promptTokens, completionTokens, totalTokens, latencyMs };
}

async function callOpenAiCompatibleJSONDirect<T>(params: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{
  data: T;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}> {
  const { apiKey, baseUrl, model, prompt, temperature = 0.2, maxTokens = 4096, timeoutMs = 35_000 } = params;
  const start = Date.now();
  const url = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || errorText.includes('insufficient_quota')) {
      throw new Error(`OpenAI quota or rate limit exceeded (429): ${errorText.slice(0, 150)}`);
    }
    throw new Error(`OpenAI API error (${response.status}): ${errorText.slice(0, 150)}`);
  }

  const resJson: any = await response.json();
  const rawText = resJson.choices?.[0]?.message?.content || '{}';
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as T;

  const promptTokens = resJson.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
  const completionTokens = resJson.usage?.completion_tokens || Math.ceil(cleaned.length / 4);
  const totalTokens = promptTokens + completionTokens;

  return { data: parsed, promptTokens, completionTokens, totalTokens, latencyMs };
}

async function callAnthropicJSONDirect<T>(params: {
  apiKey: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{
  data: T;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}> {
  const { apiKey, model, prompt, temperature = 0.2, maxTokens = 4096, timeoutMs = 35_000 } = params;
  const start = Date.now();
  const url = 'https://api.anthropic.com/v1/messages';

  const system = 'You are a strict JSON data extractor. You must respond ONLY with a valid JSON object. Do not include markdown code block formatting, and do not include any conversational text.';

  const payload: any = {
    model: model || 'claude-3-5-haiku-20241022',
    system,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(payload),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || errorText.includes('rate_limit_error') || errorText.includes('overloaded')) {
      throw new Error(`Anthropic rate limited (429): ${errorText.slice(0, 150)}`);
    }
    throw new Error(`Anthropic API error (${response.status}): ${errorText.slice(0, 150)}`);
  }

  const resJson: any = await response.json();
  const rawText = resJson.content
    ?.filter((c: any) => c.type === 'text')
    ?.map((c: any) => c.text)
    ?.join('')
    ?.trim() || '{}';

  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as T;

  const promptTokens = resJson.usage?.input_tokens || Math.ceil(prompt.length / 4);
  const completionTokens = resJson.usage?.output_tokens || Math.ceil(cleaned.length / 4);
  const totalTokens = promptTokens + completionTokens;

  return { data: parsed, promptTokens, completionTokens, totalTokens, latencyMs };
}

/**
 * Execute chat request via resolved AI config with live token metering and cross-provider auto-failover
 */
export async function executeAIChat(
  orgId: string,
  params: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    portalType?: string;
    featureArea?: string;
    maxTokens?: number;
  },
): Promise<{
  text: string;
  source: AISource;
  provider: string;
  model: string;
  quotaWarning?: string;
  tokensUsed?: number;
}> {
  const config = await resolveOrgAIConfig(orgId);

  if (config.source === 'none' || !config.apiKey) {
    throw new Error('No AI provider configured for this organization.');
  }

  if (config.source === 'organization' && config.quotaExceeded) {
    throw new Error(`Your organization's AI API quota is currently exceeded (resets soon). Please check your provider account.`);
  }

  const { systemPrompt, messages, temperature = 0.4 } = params;

  // ──────────────────────────────────────────────────────────────────────────
  // CASE A: Tenant BYOK Key (MarqNetworks, etc.) - Strictly isolated scope
  // ──────────────────────────────────────────────────────────────────────────
  if (config.source === 'organization') {
    const maskedKey = config.keyLast4 ? `••••${config.keyLast4}` : (config.apiKey ? `••••${config.apiKey.slice(-4)}` : 'none');
    try {
      if (config.provider === 'gemini') {
        const dynamicModels = await getAvailableGeminiModels(config.apiKey);
        const modelsToTry = Array.from(
          new Set([
            config.modelName ? normalizeGeminiModel(config.modelName) : null,
            'gemini-flash-lite-latest',
            'gemini-flash-latest',
            ...dynamicModels,
          ])
        ).filter((m): m is string => Boolean(m) && m !== 'gemini-1.5-flash');

        let lastError: Error | null = null;
        for (const model of modelsToTry) {
          try {
            const res = await callGeminiChatDirect({
              apiKey: config.apiKey,
              model,
              systemPrompt,
              messages,
              temperature,
              maxTokens: params.maxTokens || config.maxTokens || 4096,
            });

            recordSuccessfulCall(config.apiKey, `org:${orgId}`);

            await recordAiTelemetryEvent({
              organizationId: orgId,
              portalType: params.portalType || 'ai_assistant',
              featureArea: params.featureArea || 'copilot_chat',
              provider: 'gemini',
              modelName: model,
              fallbackTriggered: false,
              promptTokens: res.promptTokens,
              completionTokens: res.completionTokens,
              totalTokens: res.totalTokens,
              costUsd: Number(((res.promptTokens / 1_000_000) * 0.075 + (res.completionTokens / 1_000_000) * 0.30).toFixed(6)),
              latencyMs: res.latencyMs,
              status: 'success',
              keySource: 'custom_byok',
            });

            console.log(`[AI-Gateway] [SUCCESS] ORGANIZATION_OWN_KEY (key: ${maskedKey}) -> provider: Google Gemini | model: ${model} | org: ${orgId} | latency: ${res.latencyMs}ms | tokens: ${res.totalTokens}`);
            return {
              text: res.text,
              source: config.source,
              provider: config.providerName,
              model,
              tokensUsed: res.totalTokens,
            };
          } catch (err: any) {
            lastError = err;
            if (err.message?.includes('429')) {
              await recordQuotaError(config.apiKey, err.message, model, `org:${orgId}`);
              markOrgQuotaExhausted(orgId, 3600);
            }
          }
        }
        throw lastError || new Error('Organization Gemini model failed.');
      } else if (config.provider === 'anthropic') {
        const res = await callAnthropicChat({
          apiKey: config.apiKey,
          model: config.modelName || 'claude-3-5-haiku-20241022',
          systemPrompt,
          messages,
          temperature,
          maxTokens: params.maxTokens || config.maxTokens || 4096,
        });

        await recordAiTelemetryEvent({
          organizationId: orgId,
          portalType: params.portalType || 'ai_assistant',
          featureArea: params.featureArea || 'copilot_chat',
          provider: 'anthropic',
          modelName: config.modelName || 'claude-3-5-haiku-20241022',
          fallbackTriggered: false,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          totalTokens: res.totalTokens,
          costUsd: Number(((res.promptTokens / 1_000_000) * 0.80 + (res.completionTokens / 1_000_000) * 4.00).toFixed(6)),
          latencyMs: res.latencyMs,
          status: 'success',
          keySource: 'custom_byok',
        });

        return {
          text: res.text,
          source: config.source,
          provider: config.providerName,
          model: config.modelName,
          tokensUsed: res.totalTokens,
        };
      } else {
        // OpenAI / Custom OpenAI-compatible
        const res = await callOpenAiCompatibleChat({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.modelName || 'gpt-4o-mini',
          systemPrompt,
          messages,
          temperature,
          maxTokens: params.maxTokens || config.maxTokens || 4096,
        });

        await recordAiTelemetryEvent({
          organizationId: orgId,
          portalType: params.portalType || 'ai_assistant',
          featureArea: params.featureArea || 'copilot_chat',
          provider: 'openai',
          modelName: config.modelName || 'gpt-4o-mini',
          fallbackTriggered: false,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          totalTokens: res.totalTokens,
          costUsd: Number(((res.promptTokens / 1_000_000) * 0.150 + (res.completionTokens / 1_000_000) * 0.600).toFixed(6)),
          latencyMs: res.latencyMs,
          status: 'success',
          keySource: 'custom_byok',
        });

        return {
          text: res.text,
          source: config.source,
          provider: config.providerName,
          model: config.modelName,
          tokensUsed: res.totalTokens,
        };
      }
    } catch (err: any) {
      console.error(`[AI-Gateway] [FAILED] ORGANIZATION_OWN_KEY (key: ${maskedKey}) -> invocation failed for org: ${orgId}. Reason: ${err?.message}`);
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE B: SaaS Platform Shared Key - Universal Cross-Provider Cascade Radar
  // ──────────────────────────────────────────────────────────────────────────

  // Enforce monthly AI Credits limit for platform pooled key (§32)
  const quotaCheck = await checkOrgAiCreditsLimit(orgId);
  if (!quotaCheck.allowed) {
    throw new Error(`Your organization has reached its monthly AI credits limit (${quotaCheck.creditsQuota} requests) on the ${quotaCheck.planName} plan. Please upgrade your plan in Plans & Billing or configure your own API key (BYOK) in AI Settings.`);
  }

  // Build sorted active failover cascade ($P_1 \to P_2 \to P_3 \to \dots$)
  let cascade = runtimeGatewayModels
    .filter((m) => m.isActive !== false && !m.circuitOpen)
    .sort((a, b) => a.priority - b.priority);

  // Auto-heal: If all circuits are tripped, reset to prevent total platform outage
  if (cascade.length === 0) {
    console.warn('[AI-Gateway] All provider circuits tripped! Resetting circuits to prevent SaaS outage.');
    for (const m of runtimeGatewayModels) {
      m.circuitOpen = false;
      m.status = m.priority === 1 ? 'online' : 'standby';
    }
    cascade = [...runtimeGatewayModels].sort((a, b) => a.priority - b.priority);
  }

  let lastError: Error | null = null;
  let attemptCount = 0;

  for (const node of cascade) {
    const nodeKey = resolveNodeApiKey(node);
    if (!nodeKey) {
      continue; // Standby node has no API key configured yet
    }

    attemptCount++;
    try {
      let result: {
        text: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        latencyMs: number;
      };

      const prov = (node.provider || '').toLowerCase();
      if (prov === 'gemini') {
        result = await callGeminiChatDirect({
          apiKey: nodeKey,
          model: node.modelName,
          systemPrompt,
          messages,
          temperature,
          maxTokens: params.maxTokens || node.maxTokensPerReq || 4096,
          timeoutMs: node.timeoutMs || 35_000,
        });
        recordSuccessfulCall(nodeKey, 'platform');
      } else if (prov === 'anthropic') {
        result = await callAnthropicChat({
          apiKey: nodeKey,
          model: node.modelName,
          systemPrompt,
          messages,
          temperature,
          maxTokens: params.maxTokens || node.maxTokensPerReq || 4096,
          timeoutMs: node.timeoutMs || 35_000,
        });
      } else {
        // OpenAI or Custom (DeepSeek, Groq, etc.)
        result = await callOpenAiCompatibleChat({
          apiKey: nodeKey,
          baseUrl: node.baseUrl,
          model: node.modelName,
          systemPrompt,
          messages,
          temperature,
          maxTokens: params.maxTokens || node.maxTokensPerReq || 4096,
          timeoutMs: node.timeoutMs || 35_000,
        });
      }

      // Zero billed cost for platform Gemini Free Tier key
      const actualCostUsd = (node.provider === 'gemini' && !node.apiKeyEncrypted)
        ? 0
        : Number(((result.promptTokens / 1_000_000) * node.costPer1MInput + (result.completionTokens / 1_000_000) * node.costPer1MOutput).toFixed(6));

      node.callCount++;
      node.lastLatencyMs = result.latencyMs;
      node.avgLatencyMs = node.callCount > 1
        ? Math.round((node.avgLatencyMs * (node.callCount - 1) + result.latencyMs) / node.callCount)
        : result.latencyMs;
      node.lastUsedAt = new Date().toISOString();

      await recordAiTelemetryEvent({
        organizationId: orgId,
        portalType: params.portalType || 'ai_assistant',
        featureArea: params.featureArea || 'copilot_chat',
        provider: node.provider,
        modelName: node.modelName,
        fallbackTriggered: attemptCount > 1,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        costUsd: actualCostUsd,
        latencyMs: result.latencyMs,
        status: 'success',
        keySource: 'platform',
      });

      const maskedKey = `••••${nodeKey.slice(-4)}`;
      console.log(`[AI-Gateway] [SUCCESS] PLATFORM_SHARED_KEY (key: ${maskedKey}) -> provider: ${node.name} | model: ${node.modelName} | attempt: ${attemptCount} | latency: ${result.latencyMs}ms | tokens: ${result.totalTokens}`);

      return {
        text: result.text,
        source: 'platform',
        provider: node.name,
        model: node.modelName,
        tokensUsed: result.totalTokens,
      };
    } catch (err: any) {
      lastError = err;
      node.failureCount++;
      const msg = String(err.message || '');
      console.warn(`[AI-Gateway] [FAILOVER CASCADE] Node ${node.name} (${node.modelName}) priority ${node.priority} failed: "${msg}". Tripping node circuit and stepping down to next provider...`);

      const isRateLimited = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate limit');
      const isOutage = msg.includes('503') || msg.includes('500') || msg.includes('timeout') || msg.includes('UNAVAILABLE') || msg.includes('overloaded');

      if (isRateLimited || isOutage || node.failureCount >= 2) {
        setGatewayModelCircuit(node.modelName, true);
      }
    }
  }

  console.error(`[AI-Gateway] [FAILED] PLATFORM_SHARED_KEY -> All active gateway providers in the cascade failed for org: ${orgId}. Last error: ${lastError?.message}`);
  throw lastError || new Error('All configured AI gateway providers failed to generate a response.');
}

/**
 * Execute structured JSON generation via resolved AI config with live token metering and auto-failover
 */
export async function executeAIJSON<T>(
  orgId: string,
  params: {
    prompt: string;
    temperature?: number;
    portalType?: string;
    featureArea?: string;
  },
): Promise<{
  data: T;
  source: AISource;
  provider: string;
  model: string;
  tokensUsed?: number;
}> {
  const config = await resolveOrgAIConfig(orgId);

  if (config.source === 'none' || !config.apiKey) {
    throw new Error('No AI provider configured for this organization.');
  }

  if (config.source === 'organization' && config.quotaExceeded) {
    throw new Error(`Your organization's AI API quota is currently exceeded.`);
  }

  const { prompt, temperature = 0.2 } = params;

  // ──────────────────────────────────────────────────────────────────────────
  // CASE A: Tenant BYOK Key
  // ──────────────────────────────────────────────────────────────────────────
  if (config.source === 'organization') {
    if (config.provider === 'gemini') {
      const res = await callGeminiJSONDirect<T>({
        apiKey: config.apiKey,
        model: config.modelName || 'gemini-flash-latest',
        prompt,
        temperature,
      });

      await recordAiTelemetryEvent({
        organizationId: orgId,
        portalType: params.portalType || 'ai_assistant',
        featureArea: params.featureArea || 'copilot_analysis',
        provider: 'gemini',
        modelName: config.modelName || 'gemini-flash-latest',
        fallbackTriggered: false,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        totalTokens: res.totalTokens,
        costUsd: Number(((res.promptTokens / 1_000_000) * 0.075 + (res.completionTokens / 1_000_000) * 0.30).toFixed(6)),
        latencyMs: res.latencyMs,
        status: 'success',
        keySource: 'custom_byok',
      });

      return {
        data: res.data,
        source: config.source,
        provider: config.providerName,
        model: config.modelName,
        tokensUsed: res.totalTokens,
      };
    } else if (config.provider === 'anthropic') {
      const res = await callAnthropicJSONDirect<T>({
        apiKey: config.apiKey,
        model: config.modelName || 'claude-3-5-haiku-20241022',
        prompt,
        temperature,
      });

      await recordAiTelemetryEvent({
        organizationId: orgId,
        portalType: params.portalType || 'ai_assistant',
        featureArea: params.featureArea || 'copilot_analysis',
        provider: 'anthropic',
        modelName: config.modelName || 'claude-3-5-haiku-20241022',
        fallbackTriggered: false,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        totalTokens: res.totalTokens,
        costUsd: Number(((res.promptTokens / 1_000_000) * 0.80 + (res.completionTokens / 1_000_000) * 4.00).toFixed(6)),
        latencyMs: res.latencyMs,
        status: 'success',
        keySource: 'custom_byok',
      });

      return {
        data: res.data,
        source: config.source,
        provider: config.providerName,
        model: config.modelName,
        tokensUsed: res.totalTokens,
      };
    } else {
      const res = await callOpenAiCompatibleJSONDirect<T>({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelName || 'gpt-4o-mini',
        prompt,
        temperature,
      });

      await recordAiTelemetryEvent({
        organizationId: orgId,
        portalType: params.portalType || 'ai_assistant',
        featureArea: params.featureArea || 'copilot_analysis',
        provider: 'openai',
        modelName: config.modelName || 'gpt-4o-mini',
        fallbackTriggered: false,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        totalTokens: res.totalTokens,
        costUsd: Number(((res.promptTokens / 1_000_000) * 0.150 + (res.completionTokens / 1_000_000) * 0.600).toFixed(6)),
        latencyMs: res.latencyMs,
        status: 'success',
        keySource: 'custom_byok',
      });

      return {
        data: res.data,
        source: config.source,
        provider: config.providerName,
        model: config.modelName,
        tokensUsed: res.totalTokens,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE B: SaaS Platform Shared Key - Universal Failover Cascade for JSON
  // ──────────────────────────────────────────────────────────────────────────
  let cascade = runtimeGatewayModels
    .filter((m) => m.isActive !== false && !m.circuitOpen)
    .sort((a, b) => a.priority - b.priority);

  if (cascade.length === 0) {
    for (const m of runtimeGatewayModels) {
      m.circuitOpen = false;
      m.status = m.priority === 1 ? 'online' : 'standby';
    }
    cascade = [...runtimeGatewayModels].sort((a, b) => a.priority - b.priority);
  }

  let lastError: Error | null = null;
  let attemptCount = 0;

  for (const node of cascade) {
    const nodeKey = resolveNodeApiKey(node);
    if (!nodeKey) continue;

    attemptCount++;
    try {
      let res: {
        data: T;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        latencyMs: number;
      };

      const prov = (node.provider || '').toLowerCase();
      if (prov === 'gemini') {
        res = await callGeminiJSONDirect<T>({
          apiKey: nodeKey,
          model: node.modelName,
          prompt,
          temperature,
          timeoutMs: node.timeoutMs || 35_000,
        });
        recordSuccessfulCall(nodeKey, 'platform');
      } else if (prov === 'anthropic') {
        res = await callAnthropicJSONDirect<T>({
          apiKey: nodeKey,
          model: node.modelName,
          prompt,
          temperature,
          timeoutMs: node.timeoutMs || 35_000,
        });
      } else {
        res = await callOpenAiCompatibleJSONDirect<T>({
          apiKey: nodeKey,
          baseUrl: node.baseUrl,
          model: node.modelName,
          prompt,
          temperature,
          timeoutMs: node.timeoutMs || 35_000,
        });
      }

      const actualCostUsd = (node.provider === 'gemini' && !node.apiKeyEncrypted)
        ? 0
        : Number(((res.promptTokens / 1_000_000) * node.costPer1MInput + (res.completionTokens / 1_000_000) * node.costPer1MOutput).toFixed(6));

      node.callCount++;
      node.lastLatencyMs = res.latencyMs;
      node.avgLatencyMs = node.callCount > 1
        ? Math.round((node.avgLatencyMs * (node.callCount - 1) + res.latencyMs) / node.callCount)
        : res.latencyMs;
      node.lastUsedAt = new Date().toISOString();

      await recordAiTelemetryEvent({
        organizationId: orgId,
        portalType: params.portalType || 'ai_assistant',
        featureArea: params.featureArea || 'copilot_analysis',
        provider: node.provider,
        modelName: node.modelName,
        fallbackTriggered: attemptCount > 1,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        totalTokens: res.totalTokens,
        costUsd: actualCostUsd,
        latencyMs: res.latencyMs,
        status: 'success',
        keySource: 'platform',
      });

      return {
        data: res.data,
        source: 'platform',
        provider: node.name,
        model: node.modelName,
        tokensUsed: res.totalTokens,
      };
    } catch (err: any) {
      lastError = err;
      node.failureCount++;
      const msg = String(err.message || '');
      console.warn(`[AI-Gateway:JSON] [FAILOVER] Node ${node.name} (${node.modelName}) failed: "${msg}". Stepping down to next provider...`);

      const isRateLimited = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate limit');
      const isOutage = msg.includes('503') || msg.includes('500') || msg.includes('timeout') || msg.includes('UNAVAILABLE') || msg.includes('overloaded');

      if (isRateLimited || isOutage || node.failureCount >= 2) {
        setGatewayModelCircuit(node.modelName, true);
      }
    }
  }

  throw lastError || new Error('All configured AI gateway providers failed to generate JSON response.');
}
