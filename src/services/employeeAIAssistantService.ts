/**
 * Finance OS — Employee AI Assistant Service
 * ===========================================
 * Strictly zero API keys in frontend.
 * Communicates exclusively with the authenticated backend endpoint:
 * `/organizations/:orgId/me/ai-assistant/*`
 */

import { apiGet, apiPostJson, isHttpBackendConfigured } from '@/lib/apiClient';
import type { ServiceResponse } from './types';

export interface ActionCardRecommendation {
  type: 'draft_expense';
  title: string;
  payload: {
    description: string;
    amount: number;
    category: string;
    date: string;
    notes?: string;
  };
}

export interface EmployeeAIChatResponse {
  reply: string;
  suggestions: string[];
  actionCard?: ActionCardRecommendation;
  model?: string;
  source?: string;
  provider?: string;
}

export interface EmployeeAISuggestionsResponse {
  suggestions: string[];
  summary: {
    pendingClaimsCount: number;
    pendingClaimsAmount: number;
    rejectedClaimsCount: number;
    hoursThisWeek: number;
    hoursTarget: number;
    hoursRemaining: number;
    currency: string;
  };
}

export interface EmployeeAIMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionCard?: ActionCardRecommendation;
  timestamp: string;
}

const BASE_URL = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}/me/ai-assistant`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId?.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId is required' };
  }
  return null;
}

export const employeeAIAssistantService = {
  /**
   * Fetch context-aware suggestion chips based on the employee's live financial data
   */
  async getSuggestions(organizationId: string, userId?: string): Promise<ServiceResponse<EmployeeAISuggestionsResponse>> {
    const err = requireOrg<EmployeeAISuggestionsResponse>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      const url = userId
        ? `${BASE_URL(organizationId)}/suggestions?userId=${encodeURIComponent(userId)}`
        : `${BASE_URL(organizationId)}/suggestions`;
      return apiGet<EmployeeAISuggestionsResponse>(url);
    }

    return {
      success: true,
      data: {
        suggestions: [
          'What is my latest net pay amount?',
          'What is our company expense reimbursement policy?',
          'How many hours have I logged this week?',
          'When will approved expenses be paid?',
        ],
        summary: {
          pendingClaimsCount: 0,
          pendingClaimsAmount: 0,
          rejectedClaimsCount: 0,
          hoursThisWeek: 0,
          hoursTarget: 40,
          hoursRemaining: 40,
          currency: 'USD',
        },
      },
    };
  },

  /**
   * Send an inquiry to the Employee AI Assistant (RAG grounded in personal data & company policies)
   */
  async sendMessage(
    organizationId: string,
    message: string,
    history: Array<{ role: string; content: string }> = [],
    userId?: string,
  ): Promise<ServiceResponse<EmployeeAIChatResponse>> {
    const err = requireOrg<EmployeeAIChatResponse>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiPostJson<{ message: string; history: Array<{ role: string; content: string }>; userId?: string }, EmployeeAIChatResponse>(
        `${BASE_URL(organizationId)}/chat`,
        { message, history, userId },
        { signal: AbortSignal.timeout(60_000) },
      );
    }

    return {
      success: false,
      data: null as any,
      error: 'Backend API is not configured.',
    };
  },

  /**
   * Submit thumbs up/down feedback for continuous RAG improvement
   */
  async sendFeedback(
    organizationId: string,
    payload: {
      query: string;
      reply: string;
      rating: 'positive' | 'negative';
      correctionNote?: string;
    },
  ): Promise<ServiceResponse<{ success: boolean }>> {
    const err = requireOrg<{ success: boolean }>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiPostJson<typeof payload, { success: boolean }>(
        `${BASE_URL(organizationId)}/feedback`,
        payload,
      );
    }

    return { success: true, data: { success: true } };
  },

  /**
   * Retrieve recent conversation history
   */
  async getHistory(organizationId: string): Promise<ServiceResponse<EmployeeAIMessageItem[]>> {
    const err = requireOrg<EmployeeAIMessageItem[]>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiGet<EmployeeAIMessageItem[]>(`${BASE_URL(organizationId)}/history`);
    }

    return { success: true, data: [] };
  },

  /**
   * Create a draft expense recommended by the AI upon user confirmation (§29 X-09)
   */
  async executeDraftExpense(
    organizationId: string,
    draft: {
      description: string;
      amount: number;
      category: string;
      date?: string;
      notes?: string;
    },
  ): Promise<ServiceResponse<any>> {
    const err = requireOrg<any>(organizationId);
    if (err) return err;

    if (isHttpBackendConfigured()) {
      return apiPostJson<typeof draft, any>(
        `${BASE_URL(organizationId)}/draft-expense`,
        draft,
      );
    }

    return {
      success: false,
      data: null,
      error: 'Backend API is not configured.',
    };
  },
};
