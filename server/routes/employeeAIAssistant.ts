/**
 * Employee AI Assistant Router
 * Mounted at `/organizations/:organizationId/me/ai-assistant`
 *
 * Provides:
 * - GET  /suggestions    — dynamic context-aware question chips based on employee's live financial data
 * - POST /chat           — RAG-grounded conversational AI (Gemini/OpenAI or deterministic fallback)
 * - POST /feedback       — continuous learning feedback (thumbs up/down, user corrections)
 * - GET  /history        — recent conversation history
 * - POST /draft-expense  — guarded 1-click draft expense creation from AI recommendation
 */

import { Router, type Request, type Response } from 'express';
import { ok, created, fail } from '../lib/http.js';
import { checkRateLimit, sanitizeForPrompt } from '../lib/aiAssistantHelpers.js';
import { executeAIChat } from '../lib/aiGateway.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import {
  buildEmployeeFinancialDossier,
  retrieveRelevantPolicies,
  generateContextualSuggestions,
  buildEmployeeSystemPrompt,
  generateDeterministicEmployeeReply,
  detectActionRecommendation,
  formatCurrency,
} from '../services/employeeContextEngine.js';

function callerId(req: Request): string {
  const bId = typeof req.body?.userId === 'string' && req.body.userId.trim();
  const qId = typeof req.query?.userId === 'string' && req.query.userId.trim();
  return (req as any).orgMembership?.userId || req.authUser?.id || bId || qId || (req as any).userId || '';
}

function getOrgId(req: Request): string {
  const param = req.params.organizationId;
  const raw = Array.isArray(param) ? param[0] : param || '';
  return (req as any).orgMembership?.organizationId || raw;
}

export function createEmployeeAIAssistantRouter(): Router {
  const r = Router({ mergeParams: true });

  /**
   * GET /suggestions — Returns proactive suggestions tailored to the employee's current state
   */
  r.get('/suggestions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);

    if (!orgId || !userId) {
      return fail(res, 401, 'Unauthorized employee session');
    }

    try {
      const dossier = await buildEmployeeFinancialDossier(orgId, userId);
      const suggestions = generateContextualSuggestions(dossier);

      return ok(res, {
        suggestions,
        summary: {
          pendingClaimsCount: dossier.expenses.pendingCount,
          pendingClaimsAmount: dossier.expenses.pendingAmount,
          rejectedClaimsCount: dossier.expenses.rejectedCount,
          hoursThisWeek: dossier.timesheets.hoursThisWeek,
          hoursTarget: dossier.timesheets.hoursTarget,
          hoursRemaining: dossier.timesheets.hoursRemaining,
          currency: dossier.baseCurrency,
        },
      });
    } catch (err: any) {
      console.error('[employeeAIAssistant.suggestions] Error:', err);
      return fail(res, 500, 'Failed to generate contextual suggestions');
    }
  });

  /**
   * POST /chat — Conversational AI grounded in personal dossier and company policies (RAG)
   */
  r.post('/chat', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);

    if (!orgId || !userId) {
      return fail(res, 401, 'Unauthorized employee session');
    }

    // Rate limiting: 60 inquiries per 15 min per employee
    const rateLimitKey = `employee-ai-chat:${orgId}:${userId}`;
    const rateLimit = checkRateLimit(rateLimitKey, 60, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return fail(res, 429, `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 1000)} seconds.`);
    }

    const { message, history } = req.body as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return fail(res, 400, 'Message is required');
    }
    if (message.length > 3000) {
      return fail(res, 400, 'Message too long (max 3000 characters)');
    }

    try {
      // 1. Build authoritative Employee Financial Dossier (Strict user isolation)
      const dossier = await buildEmployeeFinancialDossier(orgId, userId);

      // 2. Perform RAG retrieval for relevant company policies & guidelines
      const matchedPolicies = retrieveRelevantPolicies(message, dossier.matchedPolicies);

      // 3. Prepare grounded prompt
      const systemPrompt = buildEmployeeSystemPrompt(dossier, message, matchedPolicies);
      const sanitizedMessage = sanitizeForPrompt(message);
      const conversationHistory = (history || []).slice(-6).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: sanitizeForPrompt(m.content),
      }));

      const allMessages = [...conversationHistory, { role: 'user', content: sanitizedMessage }];

      let replyText = '';
      let modelUsed = 'deterministic-fintech';
      let sourceUsed = 'fintech-engine';
      let providerUsed = 'FinanceOS';
      let actionCard = detectActionRecommendation(message, '');

      // 4. Attempt AI Gateway execution (Gemini / OpenAI)
      try {
        const aiRes = await executeAIChat(orgId, {
          systemPrompt,
          messages: allMessages,
          temperature: 0.65,
        });

        if (aiRes?.text?.trim()) {
          replyText = aiRes.text.trim();
          modelUsed = aiRes.model || 'gemini';
          sourceUsed = aiRes.source || 'platform';
          providerUsed = aiRes.provider || 'gemini';
        }
      } catch (aiErr: any) {
        console.warn('[employeeAIAssistant] AI Gateway unconfigured or unreachable. Using deterministic fallback:', aiErr?.message || aiErr);
      }

      // 5. Fallback to deterministic engine if AI response is empty or failed
      if (!replyText) {
        const fallback = generateDeterministicEmployeeReply(dossier, message);
        replyText = fallback.reply;
        if (!actionCard && fallback.actionCard) {
          actionCard = fallback.actionCard;
        }
      }

      // 6. Generate dynamic follow-up suggestions
      const suggestions = generateContextualSuggestions(dossier);

      // 7. Persist to conversation history asynchronously if Supabase is connected
      const sb = getSupabaseAdminClient();
      if (sb) {
        try {
          await sb.from('employee_ai_conversations').insert([
            {
              organization_id: orgId,
              user_id: userId,
              role: 'user',
              content: message,
            },
            {
              organization_id: orgId,
              user_id: userId,
              role: 'assistant',
              content: replyText,
              action_payload: actionCard ? actionCard : null,
            },
          ]);
        } catch (persistErr) {
          // Non-blocking log if conversation logging table is not yet migrated
          console.warn('[employeeAIAssistant] Non-fatal conversation logging error:', persistErr);
        }
      }

      return ok(res, {
        reply: replyText,
        suggestions,
        actionCard,
        model: modelUsed,
        source: sourceUsed,
        provider: providerUsed,
        remaining: rateLimit.remaining,
      });
    } catch (err: any) {
      console.error('[employeeAIAssistant.chat] Fatal error:', err);
      // Even on severe unexpected error, provide a safe fallback so employee is never left without response
      try {
        const dossier = await buildEmployeeFinancialDossier(orgId, userId);
        const fallback = generateDeterministicEmployeeReply(dossier, message);
        return ok(res, {
          reply: fallback.reply,
          suggestions: fallback.suggestions,
          model: 'deterministic-fallback',
        });
      } catch {
        return fail(res, 500, 'Unable to process inquiry at this moment.');
      }
    }
  });

  /**
   * POST /feedback — Captures employee rating & notes for continuous RAG improvement
   */
  r.post('/feedback', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);

    if (!orgId || !userId) {
      return fail(res, 401, 'Unauthorized employee session');
    }

    const { query, reply, rating, correctionNote } = req.body as {
      query: string;
      reply: string;
      rating: 'positive' | 'negative';
      correctionNote?: string;
    };

    if (!query || !rating) {
      return fail(res, 400, 'Query and rating are required');
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb.from('employee_ai_feedback').insert({
          organization_id: orgId,
          user_id: userId,
          query,
          assistant_reply: reply || '',
          rating,
          correction_note: correctionNote?.trim() || null,
        });
      } catch (err: any) {
        console.warn('[employeeAIAssistant.feedback] Database error:', err?.message || err);
      }
    }

    return ok(res, { success: true }, 'Feedback recorded successfully');
  });

  /**
   * GET /history — Retrieves recent conversation history
   */
  r.get('/history', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);

    if (!orgId || !userId) {
      return fail(res, 401, 'Unauthorized employee session');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return ok(res, []);

    try {
      const { data, error } = await sb
        .from('employee_ai_conversations')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        return ok(res, []);
      }

      return ok(
        res,
        (data || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          actionCard: m.action_payload,
          timestamp: m.created_at,
        })),
      );
    } catch {
      return ok(res, []);
    }
  });

  /**
   * POST /draft-expense — Guarded creation of a draft expense from an AI recommendation (§29 X-09)
   */
  r.post('/draft-expense', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = callerId(req);

    if (!orgId || !userId) {
      return fail(res, 401, 'Unauthorized employee session');
    }

    const { description, amount, category, date, notes } = req.body as {
      description: string;
      amount: number;
      category: string;
      date?: string;
      notes?: string;
    };

    if (!description?.trim() || !amount || amount <= 0) {
      return fail(res, 400, 'Valid description and positive amount are required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const expId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const effectiveDate = date?.trim() || new Date().toISOString().slice(0, 10);

    const { data, error } = await sb
      .from('employee_expenses')
      .insert({
        id: expId,
        organization_id: orgId,
        user_id: userId,
        date: effectiveDate,
        description: description.trim(),
        amount: Number(amount),
        currency: 'USD',
        category: category?.trim() || 'Other',
        status: 'draft',
        notes: notes?.trim() || 'Created via Employee AI Assistant recommendation',
      })
      .select()
      .single();

    if (error) {
      console.error('[employeeAIAssistant.draft-expense] Error:', error.message);
      return fail(res, 500, error.message);
    }

    created(res, data, 'Draft expense created successfully. You can review and attach receipts in My Expenses.');
  });

  return r;
}
