/**
 * Unified AI Gateway
 * - Central router for all AI features (AI Assistant, AI Classification, Import Parsing)
 * - Resolves keys per-organization:
 *     1. Active custom organization key (AES-256-GCM decrypted on demand)
 *     2. Platform built-in fallback key (with per-tenant quota protection)
 * - Isolated per-tenant quota tracking (no cross-tenant rate limit blocking)
 * - High-speed in-memory credential caching (5 min TTL)
 */

import { getSupabaseAdminClient } from './supabaseAdmin.js';
import { store } from './store.js';
import { decryptSecret, extractLast4, maskApiKey } from './secretBox.js';
import { getDefaultAIConfig, normalizeGeminiModel, MODERN_GEMINI_FALLBACKS, type AIConfig } from '../config/aiConfig.js';

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
            // Must support content generation
            if (!m.supportedGenerationMethods?.includes('generateContent')) return false;

            // Exclude models that do not support TEXT output (e.g. TTS audio-only models)
            if (Array.isArray(m.supportedOutputModalities) && !m.supportedOutputModalities.includes('TEXT')) {
              return false;
            }
            if (Array.isArray(m.outputModalities) && !m.outputModalities.includes('TEXT')) {
              return false;
            }

            const rawName = String(m.name || '').toLowerCase();
            // Filter out non-text, specialized, or discontinued models
            if (
              rawName.includes('embedding') ||
              rawName.includes('imagen') ||
              rawName.includes('vision') ||
              rawName.includes('aqa') ||
              rawName.includes('tts') ||
              rawName.includes('audio') ||
              rawName.includes('realtime') ||
              rawName.includes('transcription') ||
              rawName.includes('2.5-flash') // Discontinued for new users
            ) {
              return false;
            }

            return true;
          })
          .map((m: any) => String(m.name || '').replace(/^models\//, ''))
          .filter(Boolean);

        // Sort so preferred production-ready text flash models are attempted first
        const preferredPriority = [
          'gemini-flash-latest',
          'gemini-flash-lite-latest',
          'gemini-3-flash-preview',
          'gemini-3.5-flash',
          'gemini-3.8-flash',
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
          'gemini-1.5-flash',
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
          console.log(`[AI-Gateway] 🔍 Discovered ${sorted.length} active Gemini models for API key: ${sorted.slice(0, 4).join(', ')}...`);
          geminiModelsCache.set(apiKey, { models: sorted, expiresAt: Date.now() + 60 * 60 * 1000 });
          return sorted;
        }
      }
    }
  } catch (err: any) {
    console.warn('[AI-Gateway] Dynamic model discovery note:', err?.message || err);
  }

  return staticFallbacks;
}

// Tenant-specific quota trackers (in-memory fast lookup + synced to Supabase)
const tenantQuotaExhaustedUntil = new Map<string, number>();

export function invalidateOrgAICache(orgId: string): void {
  configCache.delete(orgId);
  tenantQuotaExhaustedUntil.delete(orgId);
}

/**
 * Check if the tenant's custom key is in a quota cooldown window
 */
export function isOrgQuotaExhausted(orgId: string): boolean {
  const until = tenantQuotaExhaustedUntil.get(orgId);
  return !!until && Date.now() < until;
}

/**
 * Mark a tenant's custom key as quota exhausted
 */
export function markOrgQuotaExhausted(orgId: string, retryAfterSeconds: number = 3600): void {
  const cooldownMs = Math.max(retryAfterSeconds, 60) * 1000;
  const resetTime = Date.now() + cooldownMs;
  tenantQuotaExhaustedUntil.set(orgId, resetTime);

  // Sync non-sensitive status to Supabase asynchronously
  const sb = getSupabaseAdminClient();
  if (sb) {
    void Promise.resolve(
      sb.from('org_ai_status').upsert({
        organization_id: orgId,
        org_key_status: 'quota_exceeded',
        org_key_reset_at: new Date(resetTime).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ).catch((err: any) => console.error('[aiGateway] Failed to sync quota status to Supabase:', err?.message));
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
            maxTokens: 2048,
            keyLast4: creds.key_last4,
            isCustomKey: true,
            quotaExceeded,
            quotaResetAt: tenantQuotaExhaustedUntil.get(orgId)
              ? new Date(tenantQuotaExhaustedUntil.get(orgId)!).toISOString()
              : undefined,
          };

          console.log(`[AI-Gateway] ⚡ [RESOLVED] Org: ${orgId} -> USING ORGANIZATION'S OWN API KEY (${resolved.providerName} / ${resolved.modelName} | Key: ••••••••${resolved.keyLast4 || '****'})`);
          configCache.set(orgId, { resolved, expiresAt: now + CACHE_TTL_MS });
          return resolved;
        }
      }
    } catch (err) {
      console.error(`[aiGateway] Error checking org_ai_credentials for ${orgId}:`, (err as Error).message);
    }
  }

  // 2. Check local store fallback for backwards compatibility
  if (store.aiSettings[orgId]?.useCustomKey && store.aiSettings[orgId]?.apiKey?.trim()) {
    const s = store.aiSettings[orgId];
    const key = s.apiKey.trim();
    const quotaExceeded = isOrgQuotaExhausted(orgId);
    const resolved: ResolvedAIConfig = {
      source: 'organization',
      provider: (s.providerName || 'gemini').toLowerCase().includes('openai') ? 'openai' : 'gemini',
      providerName: s.providerName || 'Custom Provider',
      modelName: s.modelName || 'gpt-4o-mini',
      apiKey: key,
      temperature: 0.3,
      maxTokens: 2048,
      keyLast4: extractLast4(key),
      isCustomKey: true,
      quotaExceeded,
      quotaResetAt: tenantQuotaExhaustedUntil.get(orgId)
        ? new Date(tenantQuotaExhaustedUntil.get(orgId)!).toISOString()
        : undefined,
    };
    console.log(`[AI-Gateway] ⚡ [RESOLVED] Org: ${orgId} -> USING ORGANIZATION'S OWN API KEY (Store: ${resolved.providerName} / ${resolved.modelName} | Key: ••••••••${resolved.keyLast4 || '****'})`);
    configCache.set(orgId, { resolved, expiresAt: now + CACHE_TTL_MS });
    return resolved;
  }

  // 3. Fallback to platform default key
  const defaultConfig = getDefaultAIConfig();
  if (defaultConfig && defaultConfig.apiKey) {
    const resolved: ResolvedAIConfig = {
      source: 'platform',
      provider: defaultConfig.provider === 'openai' ? 'openai' : 'gemini',
      providerName: 'Finance OS AI',
      modelName: defaultConfig.modelName || 'gemini-flash-lite-latest',
      apiKey: defaultConfig.apiKey,
      baseUrl: defaultConfig.baseUrl,
      temperature: 0.3,
      maxTokens: 2048,
      isCustomKey: false,
      quotaExceeded: false,
    };
    console.log(`[AI-Gateway] 🏢 [RESOLVED] Org: ${orgId} -> USING FINANCE OS PLATFORM DEFAULT KEY (Model: ${resolved.modelName})`);
    configCache.set(orgId, { resolved, expiresAt: now + CACHE_TTL_MS });
    return resolved;
  }

  // 4. No key available
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
  const sb = getSupabaseAdminClient();
  if (!sb) return;

  try {
    const colToIncrement = source === 'organization' ? 'org_requests_this_month' : 'platform_requests_this_month';
    // Upsert status record with incremented counter
    const { data: current } = await sb.from('org_ai_status').select('*').eq('organization_id', orgId).maybeSingle();

    if (!current) {
      await sb.from('org_ai_status').insert({
        organization_id: orgId,
        active_source: source,
        org_requests_this_month: source === 'organization' ? 1 : 0,
        platform_requests_this_month: source === 'platform' ? 1 : 0,
        last_used_at: new Date().toISOString(),
      });
    } else {
      await sb
        .from('org_ai_status')
        .update({
          active_source: source,
          [colToIncrement]: (current[colToIncrement] || 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId);
    }
  } catch (err) {
    // Non-blocking
  }
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
  console.log(`[AI-Gateway] 🧪 [TEST CONNECTION] Testing ${provider} (${modelName}) with Key: ••••••••${cleanKey.slice(-4)}...`);

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

      console.log(`[AI-Gateway] ✅ [TEST SUCCESS] Gemini responded in ${latencyMs}ms using Organization Key (••••••••${cleanKey.slice(-4)})!`);
      return {
        success: true,
        provider: 'gemini',
        model: normalizedModel,
        latencyMs,
      };
    } else {
      // OpenAI / OpenAI-compatible
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
        let errorMsg = `OpenAI returned ${res.status}: ${res.statusText}`;
        if (isQuota) {
          errorMsg = 'API quota exhausted on this OpenAI key (check billing/credits).';
        } else if (res.status === 401) {
          errorMsg = 'Invalid OpenAI API key.';
        }
        return {
          success: false,
          provider: 'openai',
          model: modelName,
          latencyMs,
          error: errorMsg,
          isQuotaExceeded: isQuota,
        };
      }

      console.log(`[AI-Gateway] ✅ [TEST SUCCESS] OpenAI responded in ${latencyMs}ms using Organization Key (••••••••${cleanKey.slice(-4)})!`);
      return {
        success: true,
        provider: 'openai',
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

/**
 * Execute chat request via resolved AI config
 */
export async function executeAIChat(
  orgId: string,
  params: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
  },
): Promise<{
  text: string;
  source: AISource;
  provider: string;
  model: string;
  quotaWarning?: string;
}> {
  const config = await resolveOrgAIConfig(orgId);

  if (config.source === 'none' || !config.apiKey) {
    throw new Error('No AI provider configured for this organization.');
  }

  // If org's custom key has hit quota, notify immediately
  if (config.source === 'organization' && config.quotaExceeded) {
    throw new Error(`Your organization's AI API quota is currently exceeded (resets soon). Please check your provider account.`);
  }

  const { systemPrompt, messages, temperature = 0.4 } = params;
  console.log(`[AI-Gateway] 🚀 [CHAT EXECUTE] Org: ${orgId} | Routing: ${config.source === 'organization' ? "⚡ ORGANIZATION'S OWN KEY (••••••••" + (config.keyLast4 || config.apiKey.slice(-4)) + ")" : "🏢 PLATFORM DEFAULT KEY"} | Provider: ${config.providerName} | Model: ${config.modelName}`);

  try {
    if (config.provider === 'gemini') {
      const dynamicModels = await getAvailableGeminiModels(config.apiKey);
      const normalized = normalizeGeminiModel(config.modelName);
      // Prioritize the user's specifically configured model and normalized variant first,
      // followed by battle-tested fast models, and only then dynamic/discovered models.
      const modelsToTry = Array.from(new Set([
        config.modelName,
        normalized,
        'gemini-flash-latest',
        'gemini-flash-lite-latest',
        'gemini-3-flash-preview',
        'gemini-3.5-flash',
        'gemini-3.8-flash',
        ...MODERN_GEMINI_FALLBACKS,
        ...dynamicModels,
      ])).filter(Boolean);

      let lastError: Error | null = null;

      for (const model of modelsToTry) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
          const parts: Array<{ text: string }> = [{ text: systemPrompt + '\n\n' }];
          for (const msg of messages) {
            const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
            parts.push({ text: `${prefix}${msg.content}\n` });
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey,
            },
            signal: AbortSignal.timeout(18_000),
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                temperature,
                maxOutputTokens: config.maxTokens,
                candidateCount: 1,
              },
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 429 || errorText.includes('RESOURCE_EXHAUSTED')) {
              console.warn(`[AI-Gateway] Model ${model} rate limited (429), trying next fallback...`);
              throw new Error(`Gemini rate limited (${response.status})`);
            }
            if (response.status === 503 || errorText.includes('high demand') || errorText.includes('UNAVAILABLE')) {
              console.warn(`[AI-Gateway] Model ${model} high demand (503), trying next fallback...`);
              throw new Error(`Gemini high demand (${response.status})`);
            }
            throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 150)}`);
          }

          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Empty response from AI provider.');

          // Track usage
          void trackUsage(orgId, config.source);
          console.log(`[AI-Gateway] ✅ [CHAT SUCCESS] Response generated via ${config.source === "organization" ? "⚡ ORGANIZATION'S OWN KEY" : "🏢 PLATFORM DEFAULT KEY"} (${config.providerName} / ${model})`);

          return {
            text: text.trim(),
            source: config.source,
            provider: config.providerName,
            model,
          };
        } catch (err: any) {
          lastError = err;
          const msg = String(err.message || '');
          // Fail fast ONLY if credentials are fundamentally invalid or project unauthorized.
          // Model incompatibility errors (404 discontinued, 400 unsupported modality/config, 429 rate limit, 503 high demand) MUST fall through to next fallback!
          const isApiKeyFatal =
            msg.includes('API_KEY_INVALID') ||
            msg.includes('API key not valid') ||
            msg.includes('API key expired') ||
            msg.includes('API error (401)') ||
            msg.includes('API error (403)');

          if (isApiKeyFatal) {
            throw err;
          }
          console.warn(`[AI-Gateway] Model ${model} attempt failed (${msg}), trying next fallback model...`);
          // Continue to next fallback model
        }
      }

      throw lastError || new Error('Failed to generate response from AI provider.');
    } else {
      // OpenAI / OpenAI-compatible
      const url = config.baseUrl
        ? `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
        : 'https://api.openai.com/v1/chat/completions';

      const promptMsgs = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model: config.modelName || 'gpt-4o-mini',
          messages: promptMsgs,
          temperature,
          max_tokens: config.maxTokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429 || errorText.includes('insufficient_quota')) {
          if (config.source === 'organization') {
            markOrgQuotaExhausted(orgId, 3600);
          }
          throw new Error(`OpenAI API quota exceeded for your organization.`);
        }
        throw new Error(`OpenAI API error (${response.status}): ${errorText.slice(0, 150)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from OpenAI.');

      void trackUsage(orgId, config.source);

      return {
        text: text.trim(),
        source: config.source,
        provider: config.providerName,
        model: config.modelName,
      };
    }
  } catch (err: any) {
    throw err;
  }
}

/**
 * Execute structured JSON generation via resolved AI config
 */
export async function executeAIJSON<T>(
  orgId: string,
  params: {
    prompt: string;
    temperature?: number;
  },
): Promise<{
  data: T;
  source: AISource;
  provider: string;
  model: string;
}> {
  const config = await resolveOrgAIConfig(orgId);

  if (config.source === 'none' || !config.apiKey) {
    throw new Error('No AI provider configured for this organization.');
  }

  if (config.source === 'organization' && config.quotaExceeded) {
    throw new Error(`Your organization's AI API quota is currently exceeded.`);
  }

  const { prompt, temperature = 0.2 } = params;
  console.log(`[AI-Gateway] 🚀 [JSON EXECUTE] Org: ${orgId} | Routing: ${config.source === 'organization' ? "⚡ ORGANIZATION'S OWN KEY (••••••••" + (config.keyLast4 || config.apiKey.slice(-4)) + ")" : "🏢 PLATFORM DEFAULT KEY"} | Model: ${config.modelName}`);

  if (config.provider === 'gemini') {
    const modelsToTry = Array.from(new Set([
      config.modelName,
      normalizeGeminiModel(config.modelName),
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3-flash-preview',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      ...MODERN_GEMINI_FALLBACKS,
    ])).filter(Boolean);

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey,
          },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: 4096,
              candidateCount: 1,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 || errorText.includes('RESOURCE_EXHAUSTED')) {
            if (config.source === 'organization') {
              markOrgQuotaExhausted(orgId, 3600);
            }
            throw new Error(`AI quota exceeded.`);
          }
          throw new Error(`Gemini error: ${response.status}`);
        }

        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleaned) as T;

        void trackUsage(orgId, config.source);

        return {
          data: parsed,
          source: config.source,
          provider: config.providerName,
          model,
        };
      } catch (err: any) {
        lastError = err;
        if (err.message?.includes('quota exceeded')) throw err;
      }
    }

    throw lastError || new Error('Failed to generate JSON from AI provider.');
  } else {
    // OpenAI JSON mode
    const url = config.baseUrl
      ? `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: config.modelName || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        if (config.source === 'organization') markOrgQuotaExhausted(orgId, 3600);
        throw new Error('OpenAI quota exceeded.');
      }
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw) as T;

    void trackUsage(orgId, config.source);

    return {
      data: parsed,
      source: config.source,
      provider: config.providerName,
      model: config.modelName,
    };
  }
}
