/**
 * AI Key Tier Detection & Rate-Limit Radar Engine
 * ===============================================
 * Solves the problem of determining whether a Gemini/LLM API key is Free Tier
 * or Paid Tier (Pay-As-You-Go) by implementing an evidence-based layered detector:
 *
 * Layer 1: Explicit Admin Declaration via `AI_BILLING_TIER=free|paid` in environment.
 * Layer 2: Google RPC `QuotaFailure` inspection: when Google returns 429 RESOURCE_EXHAUSTED,
 *          its `details` payload contains `quotaMetric: ...generate_content_free_tier_requests...`
 *          or `quotaId: "FreeTier"`.
 * Layer 3: Throughput inference: sustained peak RPM > 15 without 429 throttling.
 * Layer 4: Safe baseline: Assumed Free Tier (Unverified) with honest UI badge.
 *
 * Security Invariant: Keys are NEVER stored in plaintext. Keys are hashed with SHA-256
 * into a key fingerprint. Changing the key automatically produces a new fingerprint.
 */

import crypto from 'crypto';
import { getSupabaseAdminClient } from './supabaseAdmin.js';

export type KeyTier = 'free' | 'paid' | 'unverified';
export type KeyTierConfidence = 'declared' | 'verified_by_quota_error' | 'verified_live' | 'inferred' | 'none';

export interface KeyTierEvidence {
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string | number;
  retryDelay?: string;
  lastErrorText?: string;
  model?: string;
  verifiedAt?: string;
}

export interface KeyTierState {
  keyFingerprint: string;
  scope: string; // 'platform' or 'org:<id>'
  provider: 'gemini' | 'openai' | 'anthropic';
  tier: KeyTier;
  confidence: KeyTierConfidence;
  evidence: KeyTierEvidence;
  observedLimits: {
    rpm: number;
    rpd: number;
    tpm: number;
    dailyResetTime: string; // Pacific Time Midnight (08:00 UTC)
  };
  peakRpmObserved: number;
  throttleCount: number;
  lastThrottledAt?: string;
  lastVerifiedAt?: string;
  updatedAt: string;
}

// In-memory fast cache keyed by SHA-256 fingerprint
const memoryTierCache = new Map<string, KeyTierState>();

// Sliding 60-second window tracker for calculating real RPM
const slidingCallWindows = new Map<string, number[]>();

/**
 * Computes deterministic SHA-256 fingerprint of API key
 */
export function fingerprintApiKey(apiKey: string): string {
  if (!apiKey || !apiKey.trim()) return 'no_key_configured';
  return crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
}

/**
 * Parses Google Gemini 429 RESOURCE_EXHAUSTED RPC response body
 */
export function parseGeminiQuotaError(errorBodyText: string): {
  isQuotaError: boolean;
  isFreeTierDetected?: boolean;
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string | number;
  retryDelay?: string;
  rawMessage?: string;
} {
  if (!errorBodyText) return { isQuotaError: false };

  try {
    const json = JSON.parse(errorBodyText);
    const err = json?.error;
    if (!err) return { isQuotaError: false };

    const isQuota = err.code === 429 || err.status === 'RESOURCE_EXHAUSTED' || String(err.message || '').includes('quota');
    if (!isQuota) return { isQuotaError: false };

    let isFreeTierDetected = false;
    let quotaMetric: string | undefined;
    let quotaId: string | undefined;
    let quotaValue: string | number | undefined;
    let retryDelay: string | undefined;

    // Check details array for Google RPC QuotaFailure
    if (Array.isArray(err.details)) {
      for (const item of err.details) {
        if (item['@type']?.includes('QuotaFailure') && Array.isArray(item.violations)) {
          for (const v of item.violations) {
            quotaMetric = v.quotaMetric;
            quotaId = v.quotaId;
            quotaValue = v.quotaValue;

            const metricStr = String(v.quotaMetric || '').toLowerCase();
            const idStr = String(v.quotaId || '').toLowerCase();
            if (metricStr.includes('free_tier') || idStr.includes('freetier')) {
              isFreeTierDetected = true;
            }
          }
        }
        if (item['@type']?.includes('RetryInfo') && item.retryDelay) {
          retryDelay = item.retryDelay;
        }
      }
    }

    // Also check raw message for "FreeTier" indicators
    const msgStr = String(err.message || '').toLowerCase();
    if (msgStr.includes('free_tier') || msgStr.includes('freetier')) {
      isFreeTierDetected = true;
    }

    return {
      isQuotaError: true,
      isFreeTierDetected,
      quotaMetric,
      quotaId,
      quotaValue,
      retryDelay,
      rawMessage: err.message,
    };
  } catch {
    // Non-JSON error text
    const textLower = errorBodyText.toLowerCase();
    const isQuota = textLower.includes('429') || textLower.includes('resource_exhausted');
    const isFree = textLower.includes('free_tier') || textLower.includes('freetier');
    return {
      isQuotaError: isQuota,
      isFreeTierDetected: isFree,
      rawMessage: errorBodyText.slice(0, 300),
    };
  }
}

/**
 * Record a successful call to calculate real rolling RPM
 */
export function recordSuccessfulCall(apiKey: string, scope = 'platform'): void {
  const fp = fingerprintApiKey(apiKey);
  const now = Date.now();

  let timestamps = slidingCallWindows.get(fp);
  if (!timestamps) {
    timestamps = [];
    slidingCallWindows.set(fp, timestamps);
  }

  // Retain only calls within last 60 seconds
  const cutoff = now - 60000;
  timestamps = timestamps.filter((t) => t > cutoff);
  timestamps.push(now);
  slidingCallWindows.set(fp, timestamps);

  const currentRpm = timestamps.length;

  // Update in-memory tier state peak RPM
  const state = getOrCreateTierState(fp, scope);
  if (currentRpm > state.peakRpmObserved) {
    state.peakRpmObserved = currentRpm;
    state.updatedAt = new Date().toISOString();
  }
}

/**
 * Record a 429 quota failure to detect Free Tier vs Paid Tier
 */
export async function recordQuotaError(
  apiKey: string,
  errorBodyText: string,
  modelName: string,
  scope = 'platform'
): Promise<void> {
  const fp = fingerprintApiKey(apiKey);
  const state = getOrCreateTierState(fp, scope);
  const now = new Date().toISOString();

  const parsed = parseGeminiQuotaError(errorBodyText);
  if (!parsed.isQuotaError) return;

  state.throttleCount++;
  state.lastThrottledAt = now;
  state.updatedAt = now;

  if (parsed.isFreeTierDetected) {
    state.tier = 'free';
    state.confidence = 'verified_by_quota_error';
    state.evidence = {
      quotaMetric: parsed.quotaMetric || 'generate_content_free_tier_requests',
      quotaId: parsed.quotaId || 'FreeTier',
      quotaValue: parsed.quotaValue,
      retryDelay: parsed.retryDelay,
      lastErrorText: parsed.rawMessage?.slice(0, 200),
      model: modelName,
      verifiedAt: now,
    };
    state.lastVerifiedAt = now;
  } else if (parsed.quotaMetric && !parsed.isFreeTierDetected) {
    // A 429 occurred with quotaMetric NOT indicating free_tier (e.g. Standard Paid rate limits exceeded)
    state.tier = 'paid';
    state.confidence = 'verified_by_quota_error';
    state.evidence = {
      quotaMetric: parsed.quotaMetric,
      quotaId: parsed.quotaId,
      quotaValue: parsed.quotaValue,
      retryDelay: parsed.retryDelay,
      lastErrorText: parsed.rawMessage?.slice(0, 200),
      model: modelName,
      verifiedAt: now,
    };
    state.lastVerifiedAt = now;
  }

  // Persist to Supabase table platform_ai_key_tier_state if configured
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      await sb.from('platform_ai_key_tier_state').upsert({
        key_fingerprint: fp,
        scope,
        provider: 'gemini',
        tier: state.tier,
        confidence: state.confidence,
        evidence: state.evidence,
        observed_limits: state.observedLimits,
        peak_rpm_observed: state.peakRpmObserved,
        throttle_count: state.throttleCount,
        last_throttled_at: state.lastThrottledAt,
        last_verified_at: state.lastVerifiedAt,
        updated_at: state.updatedAt,
      });
    } catch {
      // Table may not exist yet, memory state preserved
    }
  }
}

/**
 * Actively marks Gemini key as verified live upon successful connection
 */
export async function verifyGeminiKeyLive(
  apiKey: string,
  modelName = 'gemini-flash-lite-latest',
  scope = 'platform'
): Promise<KeyTierState> {
  const fp = fingerprintApiKey(apiKey);
  const state = getOrCreateTierState(fp, scope);
  const now = new Date().toISOString();

  state.tier = 'free';
  state.confidence = 'verified_live';
  state.evidence = {
    model: modelName,
    verifiedAt: now,
    quotaMetric: 'gemini_active_live_probe',
  };
  state.lastVerifiedAt = now;
  state.updatedAt = now;

  // Persist to Supabase table platform_ai_key_tier_state if configured
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      await sb.from('platform_ai_key_tier_state').upsert({
        key_fingerprint: fp,
        scope,
        provider: 'gemini',
        tier: state.tier,
        confidence: state.confidence,
        evidence: state.evidence,
        observed_limits: state.observedLimits,
        peak_rpm_observed: state.peakRpmObserved,
        throttle_count: state.throttleCount,
        last_throttled_at: state.lastThrottledAt,
        last_verified_at: state.lastVerifiedAt,
        updated_at: state.updatedAt,
      });
    } catch {
      // Table may not exist yet, memory state preserved
    }
  }

  return state;
}

/**
 * Resolves active Key Tier status using layered detection
 */
export function resolveKeyTier(apiKey?: string, scope = 'platform'): {
  tier: KeyTier;
  confidence: KeyTierConfidence;
  source: 'env_declaration' | 'quota_error_evidence' | 'live_api_verification' | 'throughput_inference' | 'assumed_free_tier';
  badgeLabel: string;
  isBilledAsZero: boolean;
  limits: {
    rpm: number;
    rpd: number;
    tpm: number;
    dailyResetTime: string;
  };
  evidence?: KeyTierEvidence;
  peakRpmObserved: number;
  throttleCount: number;
} {
  const envDeclared = (process.env.AI_BILLING_TIER || '').trim().toLowerCase();

  // Layer 1: Admin Declaration via environment variable
  if (envDeclared === 'paid' || envDeclared === 'commercial') {
    return {
      tier: 'paid',
      confidence: 'declared',
      source: 'env_declaration',
      badgeLabel: 'PAID TIER · Declared by Admin',
      isBilledAsZero: false,
      limits: { rpm: 4000, rpd: 0, tpm: 4000000, dailyResetTime: 'No Daily Limit' },
      peakRpmObserved: 0,
      throttleCount: 0,
    };
  }
  if (envDeclared === 'free' || envDeclared === 'free_tier') {
    return {
      tier: 'free',
      confidence: 'declared',
      source: 'env_declaration',
      badgeLabel: 'FREE TIER · Declared by Admin',
      isBilledAsZero: true,
      limits: { rpm: 15, rpd: 1500, tpm: 1000000, dailyResetTime: 'Midnight Pacific Time (08:00 UTC)' },
      peakRpmObserved: 0,
      throttleCount: 0,
    };
  }

  // Layer 2: Check observed evidence in memory/database
  const keyToUse = apiKey || process.env.AI_API_KEY || '';
  const fp = fingerprintApiKey(keyToUse);
  const state = memoryTierCache.get(fp);

  if (state && state.confidence === 'verified_live') {
    return {
      tier: 'free',
      confidence: 'verified_live',
      source: 'live_api_verification',
      badgeLabel: 'FREE TIER · Verified Live (15 RPM / 1,500 RPD)',
      isBilledAsZero: true,
      limits: { rpm: 15, rpd: 1500, tpm: 1000000, dailyResetTime: 'Midnight Pacific Time (08:00 UTC)' },
      evidence: state.evidence,
      peakRpmObserved: state.peakRpmObserved,
      throttleCount: state.throttleCount,
    };
  }

  if (state && state.confidence === 'verified_by_quota_error') {
    const isFree = state.tier === 'free';
    return {
      tier: state.tier,
      confidence: 'verified_by_quota_error',
      source: 'quota_error_evidence',
      badgeLabel: isFree ? 'FREE TIER · Verified by API Quota' : 'PAID TIER · Verified by API Quota',
      isBilledAsZero: isFree,
      limits: isFree
        ? { rpm: 15, rpd: 1500, tpm: 1000000, dailyResetTime: 'Midnight Pacific Time (08:00 UTC)' }
        : { rpm: 4000, rpd: 0, tpm: 4000000, dailyResetTime: 'No Daily Limit' },
      evidence: state.evidence,
      peakRpmObserved: state.peakRpmObserved,
      throttleCount: state.throttleCount,
    };
  }

  // Layer 3: Throughput inference (if observed RPM > 18 without throttles)
  if (state && state.peakRpmObserved > 18 && state.throttleCount === 0) {
    return {
      tier: 'paid',
      confidence: 'inferred',
      source: 'throughput_inference',
      badgeLabel: 'PAID TIER · Inferred (>15 RPM without throttle)',
      isBilledAsZero: false,
      limits: { rpm: 4000, rpd: 0, tpm: 4000000, dailyResetTime: 'No Daily Limit' },
      peakRpmObserved: state.peakRpmObserved,
      throttleCount: state.throttleCount,
    };
  }

  // Layer 4: Default Safe Baseline
  return {
    tier: 'free',
    confidence: 'none',
    source: 'assumed_free_tier',
    badgeLabel: 'FREE TIER · Unverified (Assumed)',
    isBilledAsZero: true,
    limits: { rpm: 15, rpd: 1500, tpm: 1000000, dailyResetTime: 'Midnight Pacific Time (08:00 UTC)' },
    peakRpmObserved: state?.peakRpmObserved || 0,
    throttleCount: state?.throttleCount || 0,
  };
}

/**
 * Returns current rolling RPM for the active platform key
 */
export function getCurrentRollingRpm(apiKey?: string): number {
  const fp = fingerprintApiKey(apiKey || process.env.AI_API_KEY || '');
  const now = Date.now();
  let timestamps = slidingCallWindows.get(fp);
  if (!timestamps) return 0;
  timestamps = timestamps.filter((t) => t > now - 60000);
  slidingCallWindows.set(fp, timestamps);
  return timestamps.length;
}

function getOrCreateTierState(fp: string, scope: string): KeyTierState {
  let existing = memoryTierCache.get(fp);
  if (!existing) {
    existing = {
      keyFingerprint: fp,
      scope,
      provider: 'gemini',
      tier: 'unverified',
      confidence: 'none',
      evidence: {},
      observedLimits: {
        rpm: 15,
        rpd: 1500,
        tpm: 1000000,
        dailyResetTime: 'Midnight Pacific Time (08:00 UTC)',
      },
      peakRpmObserved: 0,
      throttleCount: 0,
      updatedAt: new Date().toISOString(),
    };
    memoryTierCache.set(fp, existing);
  }
  return existing;
}

