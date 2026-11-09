/**
 * AI Financial Assistant Service
 * ==============================
 * Handles communication with the Supabase-backed AI Assistant backend endpoints:
 * - GET  /organizations/:orgId/ai-assistant/status
 * - POST /organizations/:orgId/ai-assistant/chat
 * - GET  /organizations/:orgId/ai-assistant/analysis
 * - POST /organizations/:orgId/ai-assistant/test
 */

import { isHttpBackendConfigured, apiGet, apiPostJson } from '@/lib/apiClient';
import type { ServiceResponse } from './types';

export interface AIFinancialSituation {
  cashPosition: string;
  burnRate: string;
  runway: string;
  profitMargin: string;
  personalDrawings: string;
  teamUtilization: string;
}

export interface AIProjection {
  revenue: string;
  profit: string;
  confidence: number;
}

export interface AIProjections {
  nextQuarter: AIProjection;
  nextYear: AIProjection;
}

export interface AIInsight {
  id: string;
  type: 'warning' | 'opportunity' | 'success' | 'info';
  category: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  actionable: boolean;
  recommendation?: string;
}

export interface FinancialPattern {
  id: string;
  pattern: string;
  frequency: string;
  trend: 'increasing' | 'decreasing' | 'stable';
  suggestion: string;
}

export interface AIAnalysisData {
  situation: AIFinancialSituation;
  projections: AIProjections;
  insights: AIInsight[];
  patterns: FinancialPattern[];
  dataAvailable: boolean;
}

export interface AIChatResponse {
  reply: string;
  suggestions: string[];
  model?: string;
  source?: string;
  provider?: string;
}

export interface AIAssistantStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  isCustomKey?: boolean;
  source?: string;
}

const AI_BASE = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}/ai-assistant`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId?.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId is required' };
  }
  return null;
}

export const aiAssistantService = {
  /**
   * Check AI configuration status from Supabase / backend
   */
  async getStatus(organizationId: string): Promise<ServiceResponse<AIAssistantStatus>> {
    const err = requireOrg<AIAssistantStatus>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiGet<AIAssistantStatus>(`${AI_BASE(organizationId)}/status`);
    }

    return {
      success: false,
      data: null as any,
      error: 'Backend API is not configured. Please set VITE_API_BASE_URL.',
    };
  },

  /**
   * Fetch full AI analysis (situation, projections, insights, patterns) backed by live Supabase ledger
   */
  async getAnalysis(organizationId: string): Promise<ServiceResponse<AIAnalysisData>> {
    const err = requireOrg<AIAnalysisData>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiGet<AIAnalysisData>(`${AI_BASE(organizationId)}/analysis`);
    }

    return {
      success: false,
      data: null as any,
      error: 'Backend API is not configured. Please set VITE_API_BASE_URL.',
    };
  },

  /**
   * Send a chat message to the AI assistant grounded in Supabase DB
   */
  async sendMessage(
    organizationId: string,
    message: string,
    history: Array<{ role: string; content: string }> = [],
  ): Promise<ServiceResponse<AIChatResponse>> {
    const err = requireOrg<AIChatResponse>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiPostJson<{ message: string; history: Array<{ role: string; content: string }> }, AIChatResponse>(
        `${AI_BASE(organizationId)}/chat`,
        { message, history },
        { signal: AbortSignal.timeout(90_000) },
      );
    }

    return {
      success: false,
      data: null as any,
      error: 'Backend API is not configured. Please set VITE_API_BASE_URL.',
    };
  },

  /**
   * Test the AI connection
   */
  async testConnection(organizationId: string): Promise<ServiceResponse<{ ok: boolean; model?: string; reply?: string }>> {
    const err = requireOrg<{ ok: boolean; model?: string; reply?: string }>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiPostJson<Record<string, never>, { ok: boolean; model?: string; reply?: string }>(
        `${AI_BASE(organizationId)}/test`,
        {},
      );
    }

    return {
      success: false,
      data: null as any,
      error: 'Backend API is not configured. Please set VITE_API_BASE_URL.',
    };
  },
};
