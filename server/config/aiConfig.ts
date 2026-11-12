/**
 * AI Configuration Management
 * Secure handling of AI API keys with environment variable fallback & encryption
 */

import crypto from 'node:crypto';
import { env } from './env.js';

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'azure_openai' | 'custom';
  modelName: string;
  apiKey: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

export interface AIProviderConfig extends AIConfig {
  providerName: string;
}

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = crypto.scryptSync(
  process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'finance-os-32-byte-secret-key-!',
  'salt',
  32
);

export function encryptApiKey(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptApiKey(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.includes(':')) return cipherText; // Return as-is if unencrypted legacy key
  try {
    const [ivHex, encrypted] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return cipherText;
  }
}

export function buildApiUrl(config: AIProviderConfig): string {
  const base = config.baseUrl?.trim() || 'https://api.openai.com/v1';
  if (base.endsWith('/chat/completions')) return base;
  return `${base.replace(/\/+$/, '')}/chat/completions`;
}

export function getProviderHeaders(config: AIProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    if (config.providerName === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
  }
  return headers;
}

export function sanitizeConfigForLogging(config: Partial<AIProviderConfig>): Record<string, unknown> {
  return {
    providerName: config.providerName,
    modelName: config.modelName,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    apiKeyMasked: config.apiKey ? `***${config.apiKey.slice(-4)}` : undefined,
  };
}

/**
 * Map legacy or deprecated model names to current active Gemini models on v1beta
 */
export function normalizeGeminiModel(name?: string): string {
  if (!name) return 'gemini-flash-lite-latest';
  const clean = name.trim().toLowerCase().replace(/^models\//, '');
  if (clean === 'gemini-1.5-flash' || clean === 'models/gemini-1.5-flash') return 'gemini-flash-latest';
  if (clean === 'gemini-2.0-flash' || clean === 'models/gemini-2.0-flash') return 'gemini-flash-latest';
  if (clean.includes('2.0-flash-lite')) return 'gemini-flash-lite-latest';
  if (clean.includes('2.0-flash')) return 'gemini-flash-latest';
  if (clean.includes('2.5-flash')) return 'gemini-flash-latest';
  if (clean.includes('lite')) return 'gemini-flash-lite-latest';
  if (clean.includes('flash-latest')) return 'gemini-flash-latest';
  if (clean.includes('pro')) return 'gemini-3-flash-preview';
  if (clean.includes('preview') || clean.includes('3')) return 'gemini-3-flash-preview';
  if (clean.includes('1.5-flash')) return 'gemini-flash-latest';
  return clean || 'gemini-flash-lite-latest';
}

export const MODERN_GEMINI_FALLBACKS = [
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
] as const;

/**
 * Get AI configuration from environment variables
 * This is the fallback when no org-specific config exists in database
 */
export function getDefaultAIConfig(): AIProviderConfig | null {
  const apiKey = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY)?.trim();
  const provider = (process.env.AI_PROVIDER?.trim() || 'gemini');
  const rawModelName = process.env.AI_MODEL_NAME?.trim() || 'gemini-flash-lite-latest';
  const modelName = provider === 'gemini' ? normalizeGeminiModel(rawModelName) : rawModelName;
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const temperature = Number(process.env.AI_TEMPERATURE || 0.3);
  const maxTokens = Number(process.env.AI_MAX_TOKENS || 2048);

  if (!apiKey) {
    return null;
  }

  return {
    provider: provider as AIConfig['provider'],
    providerName: provider,
    modelName,
    apiKey,
    baseUrl,
    temperature,
    maxTokens,
  };
}

/**
 * Check if AI is configured (either in env or will be in database)
 */
export function isAIConfigured(): boolean {
  return !!(process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
}

/**
 * Validate AI configuration
 */
export function validateAIConfig(config: Partial<AIConfig>): { valid: boolean; error?: string } {
  if (!config.apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  if (!config.provider) {
    return { valid: false, error: 'Provider is required' };
  }

  if (!['openai', 'anthropic', 'gemini', 'azure_openai', 'custom'].includes(config.provider)) {
    return { valid: false, error: 'Invalid provider' };
  }

  if (!config.modelName) {
    return { valid: false, error: 'Model name is required' };
  }

  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
    return { valid: false, error: 'Temperature must be between 0 and 2' };
  }

  return { valid: true };
}
