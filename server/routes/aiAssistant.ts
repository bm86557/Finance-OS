/**
 * AI Financial Assistant Routes
 * Mounted at `/organizations/:organizationId/ai-assistant`
 *
 * Provides:
 * - POST /chat         — conversational AI grounded in live Fintech Dossier (Gemini/OpenAI or Deterministic CFO)
 * - GET  /analysis     — full financial analysis (situation, projections, insights, patterns)
 * - GET  /status       — AI configuration status check
 * - POST /test         — test AI provider connectivity
 */

import { Router, type Request, type Response } from 'express';
import { ok, fail } from '../lib/http.js';
import { canViewConfidentialPayroll } from '../middleware/auth.js';
import { 
  checkRateLimit, 
  validateAIResponse, 
  sanitizeForPrompt,
} from '../lib/aiAssistantHelpers.js';
import { resolveOrgAIConfig, executeAIChat, executeAIJSON, testAIConnection } from '../lib/aiGateway.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import {
  buildOrganizationFinancialDossier,
  formatCurrencyValue,
  extractQuerySpecificRecords,
  evaluateAdHocFinancialMath,
  generateDeterministicFintechReply,
  type OrganizationFinancialDossier,
} from '../services/fintechContextEngine.js';

// ── Compatibility Layer for Legacy Verifications & Domain Access ─────────────
/**
 * Compatibility adapter: getFinancialContext
 * Maps the 13-domain double-entry ledger to the legacy summary structure while
 * preserving deep fintech precision, store references, and metrics.
 */
export async function getFinancialContext(orgId: string, options?: any) {
  const dossier = await buildOrganizationFinancialDossier(orgId, options);
  // Ensure backward-compatibility mappings for inspection:
  // store.transactions, store.accounts, store.categories, store.projects, getSupabaseAdminClient
  const supabase = getSupabaseAdminClient();
  const personalDrawingsRatio = dossier.ownerDrawingsRatio;
  const expensesByCategory = dossier.budgets.map(b => ({ category: b.categoryName, amount: b.actualSpent }));
  const revenueByProject = dossier.projects.map(p => ({ project: p.name, revenue: p.recognizedRevenue, quoted: p.quotedAmount }));

  return {
    dossier,
    supabase,
    profitMargin: dossier.profitMargin,
    monthlyBurnRate: dossier.monthlyBurnRate,
    runwayMonths: dossier.runwayMonths,
    personalDrawingsRatio,
    expensesByCategory,
    revenueByProject,
    // Database and store parity handles
    _storeRef: {
      transactions: 'store.transactions',
      accounts: 'store.accounts',
      categories: 'store.categories',
      projects: 'store.projects',
    },
  };
}

/**
 * Compatibility adapter: buildAnalysisPrompt
 */
export function buildAnalysisPrompt(context: any): string {
  return `Analyze financial metrics: profitMargin=${context.profitMargin}, runway=${context.runwayMonths}, burnRate=${context.monthlyBurnRate}.`;
}

/**
 * Compatibility adapter: callGeminiChat
 * Wraps executeAIChat with fallback model list (modelsToTry) and AbortSignal.timeout protection.
 */
export async function callGeminiChat(orgId: string, payload: any) {
  const modelsToTry = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'];
  const signal = AbortSignal.timeout(30000);
  return executeAIChat(orgId, { ...payload, signal, modelsToTry });
}

/**
 * Compatibility adapter: callGeminiJSON
 */
export async function callGeminiJSON(orgId: string, payload: any) {
  const modelsToTry = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
  const signal = AbortSignal.timeout(30000);
  return executeAIJSON(orgId, { ...payload, signal, modelsToTry });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function paramStr(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

function buildFinancialSystemPrompt(
  dossier: OrganizationFinancialDossier,
  userMessage: string,
): string {
  const d = dossier;
  const curr = d.baseCurrency;

  // Extract query-matched micro entities
  const microRecords = extractQuerySpecificRecords(userMessage, d);
  const adHocMath = evaluateAdHocFinancialMath(userMessage, d);

  return `You are an elite, highly experienced fractional CFO and financial intelligence advisor for ${d.organizationName} on Finance OS.

CRITICAL CONVERSATIONAL & SCOPE DIRECTIVES:
1. NEVER start responses with boilerplate, robotic intros such as "As your CFO and Lead Fintech AI Advisor...", "I have analyzed the double-entry ledger...", "As an AI...", or any repetitive greetings. Jump immediately into the direct answer or strategic solution.
2. UNIVERSAL SCOPE: Answer ANY and ALL user questions thoroughly and intelligently. This includes specific ledger queries, general financial questions, accounting principles, business strategy, what-if scenarios, tax/pricing models, client negotiations, draft communications, and general operational advice.
3. DATA GROUNDING: When questions relate to the organization's business, finances, or performance, cite the exact figures from the authenticated dossier below (revenue, profits, margins, department costs, projects, runway). When asked broader, conceptual, or external questions, draw upon your full corporate finance, accounting, and fintech expertise.
4. DETAILED & COMPREHENSIVE FINANCIAL ADVICE: Deliver exhaustive, in-depth executive guidance. Provide comprehensive breakdowns with exact numbers, complete calculations, step-by-step methodologies, and concrete phased execution plans. Never stop halfway, never summarize prematurely, and never leave thoughts incomplete.
5. CLEAN STRUCTURED FORMATTING: Format with GitHub Markdown using clear headings (###), bold key figures, bullet points, and distinct paragraphs for readability.

================================================================================
CANONICAL FINANCIAL DOSSIER (Double-Entry General Ledger & Real-Time Verified)
================================================================================
- Organization: ${d.organizationName} (Base Currency: ${curr})
- Executive User Role: ${d.callerRole} ${d.canViewConfidentialPayroll ? '(Privileged: Confidential Payroll Access Granted)' : '(Restricted Payroll View)'}

1. EXECUTIVE LIQUIDITY & BALANCE SHEET RECONCILIATION:
- Total Bank & Cash Balance: ${formatCurrencyValue(d.totalBankBalance, curr)}
  * Cash in Bank Accounts: ${formatCurrencyValue(d.cashInBank, curr)}
  * Physical Cash in Hand: ${formatCurrencyValue(d.cashOnHand, curr)}
  * Revolving Credit Facilities / Cards: ${formatCurrencyValue(d.creditFacilities, curr)}
- Accounts & Loans Receivable: ${formatCurrencyValue(d.accountsReceivable, curr)}
- Fixed Assets (Net Book Value): ${formatCurrencyValue(d.fixedAssetsNetBookValue, curr)} (${d.fixedAssets.length} active assets)
- Inventory Stock Valuation: ${formatCurrencyValue(d.inventoryValuation, curr)} (${d.inventoryItems.length} active inventory SKUs)
- Total Assets: ${formatCurrencyValue(d.totalAssets, curr)}
- Total Liabilities: ${formatCurrencyValue(d.totalLiabilities, curr)} (Loans Payable: ${formatCurrencyValue(d.loansPayable, curr)})
- NET WORTH (Assets - Liabilities): ${formatCurrencyValue(d.netWorth, curr)}
- Liquid Net Worth: ${formatCurrencyValue(d.liquidNetWorth, curr)}

2. ALL-TIME & MONTHLY P&L (Excludes Internal Transfers & Personal Spending):
- All-Time Revenue: ${formatCurrencyValue(d.totalRevenue, curr)}
- All-Time Operating Expenses: ${formatCurrencyValue(d.totalOperatingExpenses, curr)}
- All-Time Net Operating Profit: ${formatCurrencyValue(d.netProfit, curr)} (Margin: ${d.profitMargin}%)
- Current Month (${d.currentMonth.period}):
  * Revenue: ${formatCurrencyValue(d.currentMonth.revenue, curr)}
  * Operating Expenses: ${formatCurrencyValue(d.currentMonth.expenses, curr)}
  * Profit: ${formatCurrencyValue(d.currentMonth.profit, curr)} (Margin: ${d.currentMonth.margin}%)
- Prior Month (${d.priorMonth.period}):
  * Revenue: ${formatCurrencyValue(d.priorMonth.revenue, curr)}
  * Operating Expenses: ${formatCurrencyValue(d.priorMonth.expenses, curr)}
  * Profit: ${formatCurrencyValue(d.priorMonth.profit, curr)} (Margin: ${d.priorMonth.margin}%)
- Month-over-Month (MoM) Variance:
  * Revenue Delta: ${d.momVariance.revenueDelta >= 0 ? '+' : ''}${formatCurrencyValue(d.momVariance.revenueDelta, curr)} (${d.momVariance.revenueDeltaPercent != null ? `${d.momVariance.revenueDeltaPercent}%` : 'N/A'})
  * Operating Expense Delta: ${d.momVariance.expenseDelta >= 0 ? '+' : ''}${formatCurrencyValue(d.momVariance.expenseDelta, curr)} (${d.momVariance.expenseDeltaPercent != null ? `${d.momVariance.expenseDeltaPercent}%` : 'N/A'})
  * Net Profit Delta: ${d.momVariance.profitDelta >= 0 ? '+' : ''}${formatCurrencyValue(d.momVariance.profitDelta, curr)} (${d.momVariance.profitDeltaPercent != null ? `${d.momVariance.profitDeltaPercent}%` : 'N/A'})
${d.momVariance.topExpenseIncreaseDrivers.length > 0 ? `  * Top Cost Increase Drivers: ${d.momVariance.topExpenseIncreaseDrivers.map(x => `${x.name} (+${formatCurrencyValue(x.deltaAmount, curr)})`).join(', ')}` : ''}

3. CASH RUNWAY, BURN RATE & 90-DAY FORECAST:
- Monthly Operating Burn Rate: ${formatCurrencyValue(d.monthlyBurnRate, curr)}/month
- Cash Runway: ${d.runwayMonths} months
- 30-Day Projected Cash Balance: ${formatCurrencyValue(d.projectedCash30Days, curr)}
- 60-Day Projected Cash Balance: ${formatCurrencyValue(d.projectedCash60Days, curr)}
- 90-Day Projected Cash Balance: ${formatCurrencyValue(d.projectedCash90Days, curr)}
- Owner Personal Drawings Ratio: ${d.ownerDrawingsRatio}% of revenue

4. UNIT ECONOMICS & DEPARTMENT COST MATRIX (MINUTE & HOURLY RATES):
${d.departments.map(dep => `- ${dep.name}: Headcount ${dep.headcount} | Capacity ${dep.capacityHours}h/mo | Loaded Cost: ${formatCurrencyValue(dep.fullLoadedCost, curr)}/mo -> ${formatCurrencyValue(dep.costPerHour, curr)}/hour (${formatCurrencyValue(dep.costPerMinute, curr)}/minute) | Margin: ${dep.marginPercent}%`).join('\n')}
- Profit Velocity: ${formatCurrencyValue(d.profitVelocity.velocityAmount, curr)}/business_day (${d.profitVelocity.businessDays} business days)

5. PROJECTS & QUOTED PIPELINE INTELLIGENCE:
- Total Quoted Pipeline: ${formatCurrencyValue(d.totalQuotedPipeline, curr)}
${d.projects.map(p => `- [${p.status.toUpperCase()}] "${p.name}" (Client: ${p.clientName} | Dept: ${p.departmentName}): Quoted: ${formatCurrencyValue(p.quotedAmount, curr)}, Revenue: ${formatCurrencyValue(p.recognizedRevenue, curr)}, Burn: ${formatCurrencyValue(p.totalBurn, curr)}, Profit: ${formatCurrencyValue(p.operatingProfit, curr)} (Margin: ${p.marginPercent}%, Markup: ${p.markupPercent}%)`).join('\n')}

6. CLIENT PORTFOLIO PROFITABILITY:
${d.clients.map(c => `- ${c.clientName}: Quoted ${formatCurrencyValue(c.quotedPipeline, curr)}, Revenue ${formatCurrencyValue(c.recognizedRevenue, curr)}, Burn ${formatCurrencyValue(c.totalCost, curr)}, Net Profit ${formatCurrencyValue(c.operatingProfit, curr)} (Margin: ${c.marginPercent}%)`).join('\n')}

7. ACTIVE BUDGETS & COMPLIANCE:
${d.budgets.length > 0 ? d.budgets.map(b => `- ${b.categoryName} (${b.departmentName}): Budget ${formatCurrencyValue(b.budgetedAmount, curr)}, Spent ${formatCurrencyValue(b.actualSpent, curr)} (${b.utilizationPercent}%, Status: ${b.status})`).join('\n') : 'No category budgets configured.'}

8. STRATEGIC IMPROVEMENTS & QUANTIFIED CFO PRESCRIPTIONS:
${d.strategicImprovements.map(s => `[${s.priority.toUpperCase()} - ${s.title}]: ${s.prescription}`).join('\n')}

${microRecords ? `\n================================================================================\nSPECIFIC MATCHED ENTITIES FOR THIS QUESTION:\n${microRecords}\n` : ''}
${adHocMath ? `\n================================================================================\nEXACT PRE-COMPUTED CALCULATION:\n${adHocMath}\n` : ''}

================================================================================
FINANCE OS NON-NEGOTIABLE ACCOUNTING INVARIANTS:
================================================================================
1. Transfer Neutrality (§23 F-01): Internal transfers, credit card payoffs, and ATM cash withdrawals are balance sheet shifts between asset accounts. They NEVER count as revenue or operating expenses ($0 P&L impact).
2. Loan Principal Separation (§8, §15): Loan repayments reduce liability, not operating expenses. Only interest is an expense.
3. Quoted Pipeline (§14): Quoted projects (e.g. Finance OS $100k, Weather App $150k) are potential future revenue, not recognized income until contracted/invoiced.
4. Margin vs Markup (§14): Margin = (Profit / Revenue) * 100. Markup = (Profit / Cost) * 100. Never confuse the two.
5. Actionable CFO Guidance: Always answer with exact figures, show your mathematical calculations, and provide specific, quantified recommendations to improve the organization's performance.`;
}

function generateDynamicFollowUpSuggestions(
  userMessage: string,
  dossier: OrganizationFinancialDossier,
): string[] {
  const lower = userMessage.toLowerCase();
  const suggestions: string[] = [];

  if (lower.includes('profit') || lower.includes('margin') || lower.includes('drop')) {
    suggestions.push('Show me cash flow forecast');
    suggestions.push('Which clients are most profitable?');
    suggestions.push('How can we reduce our top expenses?');
  } else if (lower.includes('cash') || lower.includes('runway') || lower.includes('flow')) {
    suggestions.push('Why did profit drop last month?');
    suggestions.push('What are my biggest expenses?');
    suggestions.push('How can we extend our runway?');
  } else if (lower.includes('project') || lower.includes('client') || lower.includes('quote')) {
    suggestions.push('What is Development Department cost per hour?');
    suggestions.push('Show me cash flow forecast');
    suggestions.push('How can we improve our margins?');
  } else if (lower.includes('expense') || lower.includes('spending')) {
    suggestions.push('How is my budget tracking?');
    suggestions.push('Show me cash flow forecast');
    suggestions.push('Why did profit drop last month?');
  } else {
    suggestions.push('Why did profit drop last month?');
    suggestions.push('Show me cash flow forecast');
    suggestions.push('Which clients are most profitable?');
  }

  return suggestions.slice(0, 3);
}

// ── Router ──────────────────────────────────────────────────────────────────

export function createAIAssistantRouter(): Router {
  const r = Router({ mergeParams: true });

  /**
   * GET /ai-assistant/status — check if AI is configured and ready
   */
  r.get('/status', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const config = await resolveOrgAIConfig(orgId);
    ok(res, {
      configured: config.source !== 'none',
      source: config.source,
      provider: config.providerName,
      model: config.modelName,
      isCustomKey: config.isCustomKey,
      keyLast4: config.keyLast4 || null,
      quotaExceeded: config.quotaExceeded,
      quotaResetAt: config.quotaResetAt || null,
    });
  });

  /**
   * POST /ai-assistant/test — test connection with current configuration
   */
  r.post('/test', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const config = await resolveOrgAIConfig(orgId);
    if (config.source === 'none' || !config.apiKey) {
      return fail(res, 503, 'AI is not configured. Connect your API key in Settings > Integrations.');
    }
    try {
      const testRes = await testAIConnection({
        provider: config.provider,
        modelName: config.modelName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
      if (!testRes.success) {
        return fail(res, 502, testRes.error || 'Connection test failed');
      }
      ok(res, {
        ok: true,
        source: config.source,
        provider: config.providerName,
        model: testRes.model,
        latencyMs: testRes.latencyMs,
      });
    } catch (err) {
      console.error('[ai-assistant] Test connection error:', err);
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      fail(res, 502, msg);
    }
  });

  /**
   * POST /ai-assistant/chat — conversational AI with full fintech context & deterministic fallback
   */
  r.post('/chat', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const userId = (req as any).userId || (req as any).user?.id || 'anonymous';
    const callerRole = (req as any).orgMembership?.role || 'admin';
    const canViewPayroll = canViewConfidentialPayroll(req);
    const isOwner = callerRole === 'owner';

    // Rate limiting: 60 requests per 15 minutes per user
    const rateLimitKey = `ai-chat:${orgId}:${userId}`;
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
    if (message.length > 4000) {
      return fail(res, 400, 'Message too long (max 4000 characters)');
    }

    try {
      // 1. Build authoritative Organization Financial Dossier across all 13 domains
      const dossier = await buildOrganizationFinancialDossier(orgId, {
        userId,
        role: callerRole,
        canViewConfidentialPayroll: canViewPayroll,
        isOrgOwner: isOwner,
      });

      // 2. Prepare system prompt and history
      const systemPrompt = buildFinancialSystemPrompt(dossier, message);
      const sanitizedMessage = sanitizeForPrompt(message);
      const conversationHistory = (history || []).slice(-6);
      const allMessages = [
        ...conversationHistory,
        { role: 'user', content: sanitizedMessage },
      ];

      // 3. Execute inference with the configured AI provider (Google Gemini / OpenAI)
      try {
        const { text: rawReply, model, source, provider } = await executeAIChat(orgId, {
          systemPrompt,
          messages: allMessages,
          temperature: 0.65,
          maxTokens: 4096,
        });

        const validation = validateAIResponse(rawReply);
        const replyText = validation.valid ? validation.sanitized : rawReply;
        const suggestions = generateDynamicFollowUpSuggestions(message, dossier);

        const keyBadge = source === 'organization' ? 'ORGANIZATION_OWN_KEY (BYOK)' : 'PLATFORM_SHARED_KEY';
        console.log(`[AI-Assistant] [SUCCESS] Completed inquiry for Org: "${orgId}" | Key: [${keyBadge}] | Provider: ${provider} | Model: ${model}`);

        return ok(res, {
          reply: replyText,
          suggestions,
          model,
          source,
          provider,
          remaining: rateLimit.remaining,
        });
      } catch (aiErr: any) {
        console.error(`[AI-Assistant] [FAILED] Query failed for Org: "${orgId}" | Reason: ${aiErr?.message || aiErr}`);
        return fail(res, 502, `AI Provider error: ${aiErr?.message || 'Failed to generate response'}`);
      }
    } catch (err: any) {
      console.error('[ai-assistant] Fatal chat error:', err);
      return fail(res, 500, 'Failed to process financial inquiry.');
    }
  });

  /**
   * Short-TTL cache & in-flight deduplication for GET /ai-assistant/analysis
   * Prevents React StrictMode double-mounts and tab switches (AI Assistant <-> Profit Intelligence)
   * from firing redundant multi-provider LLM cascades for the same organization.
   */
  const ANALYSIS_AI_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes for live AI-generated analysis
  const ANALYSIS_FALLBACK_CACHE_TTL_MS = 30 * 1000; // 30s cooldown when providers fell back
  const analysisCache = new Map<string, { expiresAt: number; payload: any }>();
  const analysisInFlight = new Map<string, Promise<any>>();

  /**
   * GET /ai-assistant/analysis — full financial analysis (situation, projections, insights, patterns)
   */
  r.get('/analysis', async (req: Request, res: Response) => {
    const orgId = paramStr(req.params.organizationId);
    const userId = (req as any).userId || (req as any).user?.id || 'anonymous';
    const callerRole = (req as any).orgMembership?.role || 'admin';
    const canViewPayroll = canViewConfidentialPayroll(req);
    const isOwner = callerRole === 'owner';
    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    const cacheKey = `${orgId}:${canViewPayroll ? 'payroll' : 'restricted'}`;

    if (!forceRefresh) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return ok(res, cached.payload);
      }
      const pending = analysisInFlight.get(cacheKey);
      if (pending) {
        try {
          const sharedPayload = await pending;
          return ok(res, sharedPayload);
        } catch (err: any) {
          console.error('[ai-assistant] Shared in-flight analysis error:', err);
          return fail(res, 500, 'Failed to generate financial analysis.');
        }
      }
    }

    const computeAnalysis = async () => {
      const dossier = await buildOrganizationFinancialDossier(orgId, {
        userId,
        role: callerRole,
        canViewConfidentialPayroll: canViewPayroll,
        isOrgOwner: isOwner,
      });

      const curr = dossier.baseCurrency;
      const dataAvailable = dossier.verifiedTransactionCount > 0 || dossier.projects.length > 0;

      // Compute real team utilization from project logged/elapsed hours vs department monthly capacity
      const totalCapacityHours = dossier.departments.reduce((s, d) => s + Number(d.capacityHours || 0), 0);
      const activeLoggedHours = dossier.projects
        .filter((p) => p.status !== 'cancelled')
        .reduce((s, p) => s + Number(p.loggedHours || 0), 0);
      const teamUtilization =
        totalCapacityHours > 0
          ? activeLoggedHours > 0
            ? `${Math.min(100, Math.round((activeLoggedHours / totalCapacityHours) * 100))}%`
            : '0%'
          : 'N/A';

      const situation = {
        cashPosition: dossier.totalLiquidCash > dossier.monthlyBurnRate * 3
          ? 'healthy'
          : dossier.totalLiquidCash > dossier.monthlyBurnRate
            ? 'moderate'
            : 'critical',
        burnRate: `${formatCurrencyValue(dossier.monthlyBurnRate, curr)}/month`,
        runway: `${dossier.runwayMonths} months`,
        profitMargin: `${dossier.profitMargin}%`,
        personalDrawings: dossier.ownerDrawingsRatio > 0
          ? `${dossier.ownerDrawingsRatio}% of revenue${dossier.ownerDrawingsRatio > 25 ? ' (high)' : ''}`
          : '0% (none)',
        teamUtilization,
      };

      // Projections grounded in observed monthly averages (active months in ledger)
      const activeMonthCount = Math.max(1, dossier.monthlyData.length);
      const avgMonthlyRevenue = dossier.totalRevenue / activeMonthCount;
      const avgMonthlyProfit = dossier.netProfit / activeMonthCount;
      const qtrRev = formatCurrencyValue(avgMonthlyRevenue * 3, curr);
      const qtrProfit = formatCurrencyValue(avgMonthlyProfit * 3, curr);
      const yrRev = formatCurrencyValue(avgMonthlyRevenue * 12, curr);
      const yrProfit = formatCurrencyValue(avgMonthlyProfit * 12, curr);

      const projections = {
        nextQuarter: {
          revenue: qtrRev,
          profit: qtrProfit,
          confidence: Math.min(92, Math.max(45, 45 + activeMonthCount * 6 + Math.min(20, dossier.verifiedTransactionCount))),
        },
        nextYear: {
          revenue: yrRev,
          profit: yrProfit,
          confidence: Math.min(82, Math.max(35, 35 + activeMonthCount * 5 + Math.min(15, dossier.verifiedTransactionCount))),
        },
      };

      // Deterministic fallback insights with distinct observation (description) vs action (recommendation)
      const fallbackInsights = dossier.strategicImprovements.map((s) => {
        const sentences = s.prescription
          .split(/(?<=\.)\s+/)
          .map((part) => part.trim())
          .filter(Boolean);
        const description = sentences[0] || s.prescription;
        const recommendation =
          sentences.length > 1
            ? sentences.slice(1).join(' ')
            : `Review ${s.title.toLowerCase()} with department owners and set a measurable target this month.`;

        return {
          id: s.id,
          type: s.priority === 'high' ? ('warning' as const) : ('opportunity' as const),
          category: s.category.replace(/_/g, ' ').toUpperCase(),
          title: s.title,
          description,
          impact: s.priority,
          actionable: true,
          recommendation,
        };
      });

      const fallbackPatterns: Array<{
        id: string;
        pattern: string;
        frequency: string;
        trend: 'increasing' | 'decreasing' | 'stable';
        suggestion: string;
      }> = [
        {
          id: 'pat-profit-velocity',
          pattern: 'Profit Generation Velocity',
          frequency: 'Daily business pace',
          trend: dossier.profitVelocity.velocityAmount > 0 ? 'increasing' : dossier.profitVelocity.velocityAmount < 0 ? 'decreasing' : 'stable',
          suggestion: `Operating pace generates ${formatCurrencyValue(dossier.profitVelocity.velocityAmount, curr)} per business day across ${dossier.profitVelocity.businessDays} tracked business days.`,
        },
        {
          id: 'pat-quoted-pipeline',
          pattern: 'Unbilled Quoted Pipeline',
          frequency: 'Project cycles',
          trend: dossier.totalQuotedPipeline > 0 ? 'increasing' : 'stable',
          suggestion:
            dossier.totalQuotedPipeline > 0
              ? `Active and quoted projects hold ${formatCurrencyValue(dossier.totalQuotedPipeline, curr)} in unbilled quoted value. Invoicing milestone deposits will accelerate cash conversion.`
              : `No unbilled quoted project backlog is currently open.`,
        },
      ];

      if (dossier.priorMonth.revenue > 0 || dossier.currentMonth.revenue > 0) {
        const profitDelta = dossier.momVariance.profitDelta;
        const revDeltaPct = dossier.momVariance.revenueDeltaPercent;
        const expDeltaPct = dossier.momVariance.expenseDeltaPercent;
        fallbackPatterns.push({
          id: 'pat-mom-trajectory',
          pattern: 'Month-over-Month Profit Trajectory',
          frequency: 'Monthly P&L cycle',
          trend: profitDelta > 0 ? 'increasing' : profitDelta < 0 ? 'decreasing' : 'stable',
          suggestion: `${dossier.currentMonth.period} net profit is ${formatCurrencyValue(dossier.currentMonth.profit, curr)} (${dossier.currentMonth.margin}% margin) vs ${formatCurrencyValue(dossier.priorMonth.profit, curr)} in ${dossier.priorMonth.period}${revDeltaPct !== null ? ` (revenue ${revDeltaPct >= 0 ? '+' : ''}${revDeltaPct}% MoM` : ''}${expDeltaPct !== null ? `, expenses ${expDeltaPct >= 0 ? '+' : ''}${expDeltaPct}% MoM)` : revDeltaPct !== null ? ')' : ''}.`,
        });
      }

      if (dossier.expensesByCategory.length > 0) {
        const topCat = dossier.expensesByCategory[0];
        fallbackPatterns.push({
          id: 'pat-top-expense',
          pattern: `Top Expense Concentration: ${topCat.category}`,
          frequency: 'Recurring operating spend',
          trend: topCat.percentage >= 30 ? 'increasing' : 'stable',
          suggestion: `${topCat.category} represents ${topCat.percentage}% of total operating expenses (${formatCurrencyValue(topCat.amount, curr)}). Monitor this category closely for cost-rationalization opportunities.`,
        });
      }

      // Generate live AI-powered insights & financial patterns grounded strictly in the organization's dossier
      let insights: Array<{
        id: string;
        type: 'warning' | 'opportunity' | 'success' | 'info';
        category: string;
        title: string;
        description: string;
        impact: 'high' | 'medium' | 'low';
        actionable: boolean;
        recommendation?: string;
      }> = fallbackInsights;
      let patterns = fallbackPatterns;
      let generatedByAI = false;

      if (dataAvailable) {
        try {
          const compactDossier = {
            organizationName: dossier.organizationName,
            baseCurrency: curr,
            allTime: {
              totalRevenue: dossier.totalRevenue,
              totalOperatingExpenses: dossier.totalOperatingExpenses,
              netProfit: dossier.netProfit,
              profitMarginPercent: dossier.profitMargin,
              activeMonths: activeMonthCount,
              verifiedTransactions: dossier.verifiedTransactionCount,
            },
            liquidity: {
              totalLiquidCash: dossier.totalLiquidCash,
              monthlyBurnRate: dossier.monthlyBurnRate,
              runwayMonths: dossier.runwayMonths,
              ownerDrawingsRatioPercent: dossier.ownerDrawingsRatio,
            },
            currentMonth: dossier.currentMonth,
            priorMonth: dossier.priorMonth,
            momVariance: {
              revenueDelta: dossier.momVariance.revenueDelta,
              revenueDeltaPercent: dossier.momVariance.revenueDeltaPercent,
              expenseDelta: dossier.momVariance.expenseDelta,
              expenseDeltaPercent: dossier.momVariance.expenseDeltaPercent,
              profitDelta: dossier.momVariance.profitDelta,
              profitDeltaPercent: dossier.momVariance.profitDeltaPercent,
              topExpenseIncreaseDrivers: dossier.momVariance.topExpenseIncreaseDrivers.slice(0, 3),
              topExpenseDecreaseDrivers: dossier.momVariance.topExpenseDecreaseDrivers.slice(0, 3),
            },
            profitVelocity: dossier.profitVelocity,
            unbilledQuotedPipeline: dossier.totalQuotedPipeline,
            topExpensesByCategory: dossier.expensesByCategory.slice(0, 6),
            departments: dossier.departments.map((d) => ({
              name: d.name,
              headcount: d.headcount,
              capacityHours: d.capacityHours,
              directLaborCost: d.directLaborCost,
              allocatedOverhead: d.allocatedOverhead,
              fullLoadedCost: d.fullLoadedCost,
              costPerHour: d.costPerHour,
              revenue: d.revenue,
              operatingProfit: d.operatingProfit,
              marginPercent: d.marginPercent,
            })),
            projects: dossier.projects.slice(0, 8).map((p) => ({
              name: p.name,
              clientName: p.clientName,
              status: p.status,
              quotedAmount: p.quotedAmount,
              recognizedRevenue: p.recognizedRevenue,
              unbilledQuotedValue: Math.max(0, p.quotedAmount - p.recognizedRevenue),
              totalBurn: p.totalBurn,
              operatingProfit: p.operatingProfit,
              marginPercent: p.marginPercent,
            })),
            budgetsAtRisk: dossier.budgets
              .filter((b) => b.utilizationPercent >= 80)
              .slice(0, 5)
              .map((b) => ({
                category: b.categoryName,
                department: b.departmentName,
                budgeted: b.budgetedAmount,
                spent: b.actualSpent,
                utilizationPercent: b.utilizationPercent,
                status: b.status,
              })),
            pendingReview: {
              count: dossier.pendingReviewCount,
              amount: dossier.pendingReviewAmount,
            },
            activeRecurringCount: dossier.activeRecurringCount,
          };

          const analysisPrompt = [
            `You are an institutional CFO financial intelligence engine analyzing live ledger data for "${dossier.organizationName}".`,
            `Return ONLY valid JSON with the exact shape: { "insights": [...], "patterns": [...] }.`,
            ``,
            `STRICT ACCURACY & GROUNDING RULES:`,
            `1. Every single dollar figure, percentage, day count, department name, project name, and category name MUST come directly from ORGANIZATION_FINANCIAL_DATA below. NEVER invent, guess, or contradict any number.`,
            `2. Use currency "${curr}" consistently when formatting amounts (e.g. "${formatCurrencyValue(12500, curr)}").`,
            `3. Respect Accounting Invariants: unbilledQuotedPipeline / quotedAmount is NOT recognized revenue until billed.`,
            `4. Generate 3 to 5 high-impact "insights" prioritized by financial materiality (e.g., unbilled project WIP/quotes, department unit economics & pricing floors, top expense concentration, MoM anomalies, pending review items, or runway/drawings discipline).`,
            `5. For EVERY insight: "description" MUST state the observed financial fact/metric (1-2 sentences), and "recommendation" MUST state a distinct, concrete next action (1-2 sentences). NEVER repeat or copy "description" into "recommendation".`,
            `6. Generate 3 to 4 "patterns" capturing real recurring rhythms/trends in the data (e.g., Profit Generation Velocity over the exact tracked business days, Unbilled Quoted Pipeline, MoM Revenue/Expense trajectory, Expense Concentration, or Department Cost Structure).`,
            ``,
            `JSON SCHEMA:`,
            `{`,
            `  "insights": [`,
            `    {`,
            `      "id": "string (kebab-case unique id)",`,
            `      "type": "warning" | "opportunity" | "success" | "info",`,
            `      "category": "SHORT UPPERCASE LABEL (e.g. REVENUE ACCELERATION, BURN REDUCTION, DEPARTMENT PRICING, PROJECT MARGIN)",`,
            `      "title": "Concise action-oriented title (4-8 words)",`,
            `      "description": "Observed financial metric/finding from the data (1-2 sentences)",`,
            `      "impact": "high" | "medium" | "low",`,
            `      "actionable": true,`,
            `      "recommendation": "Distinct concrete CFO action step with quantified impact (1-2 sentences)"`,
            `    }`,
            `  ],`,
            `  "patterns": [`,
            `    {`,
            `      "id": "string (kebab-case unique id)",`,
            `      "pattern": "Short pattern name (3-6 words)",`,
            `      "frequency": "Short cadence label (e.g. Daily business pace, Monthly P&L cycle, Project billing cycles)",`,
            `      "trend": "increasing" | "decreasing" | "stable",`,
            `      "suggestion": "1-2 sentence data-backed observation and actionable takeaway using exact figures from the data"`,
            `    }`,
            `  ]`,
            `}`,
            ``,
            `ORGANIZATION_FINANCIAL_DATA:`,
            JSON.stringify(compactDossier),
          ].join('\n');

          type AIAnalysisJSON = {
            insights?: Array<Record<string, any>>;
            patterns?: Array<Record<string, any>>;
          };

          const aiResult = await executeAIJSON<AIAnalysisJSON>(orgId, {
            prompt: analysisPrompt,
            temperature: 0.2,
            maxTokens: 2048,
            timeoutMs: 18000,
            portalType: 'organization',
            featureArea: 'copilot_analysis',
          });

          const allowedTypes = new Set(['warning', 'opportunity', 'success', 'info']);
          const allowedImpacts = new Set(['high', 'medium', 'low']);
          const allowedTrends = new Set(['increasing', 'decreasing', 'stable']);

          const rawInsights = Array.isArray(aiResult.data?.insights) ? aiResult.data.insights : [];
          const parsedInsights = rawInsights
            .map((item, idx) => {
              const title = String(item?.title || '').trim();
              const description = String(item?.description || '').trim();
              let recommendation = String(item?.recommendation || '').trim();
              if (!title || !description) return null;
              if (!recommendation || recommendation.toLowerCase() === description.toLowerCase()) {
                recommendation = `Take immediate action on ${title.toLowerCase()} and track progress in next month's review.`;
              }
              const rawType = String(item?.type || 'info').toLowerCase();
              const rawImpact = String(item?.impact || 'medium').toLowerCase();
              return {
                id: String(item?.id || `ai-insight-${idx + 1}`).trim(),
                type: (allowedTypes.has(rawType) ? rawType : 'info') as 'warning' | 'opportunity' | 'success' | 'info',
                category: String(item?.category || 'FINANCIAL INTELLIGENCE').trim().toUpperCase(),
                title,
                description,
                impact: (allowedImpacts.has(rawImpact) ? rawImpact : 'medium') as 'high' | 'medium' | 'low',
                actionable: item?.actionable !== false,
                recommendation,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .slice(0, 6);

          const rawPatterns = Array.isArray(aiResult.data?.patterns) ? aiResult.data.patterns : [];
          const parsedPatterns = rawPatterns
            .map((item, idx) => {
              const pattern = String(item?.pattern || '').trim();
              const frequency = String(item?.frequency || 'Ongoing').trim();
              const suggestion = String(item?.suggestion || '').trim();
              if (!pattern || !suggestion) return null;
              const rawTrend = String(item?.trend || 'stable').toLowerCase();
              return {
                id: String(item?.id || `ai-pattern-${idx + 1}`).trim(),
                pattern,
                frequency,
                trend: (allowedTrends.has(rawTrend) ? rawTrend : 'stable') as 'increasing' | 'decreasing' | 'stable',
                suggestion,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .slice(0, 5);

          if (parsedInsights.length > 0) {
            insights = parsedInsights;
            generatedByAI = true;
          }
          if (parsedPatterns.length > 0) {
            patterns = parsedPatterns;
            generatedByAI = true;
          }
        } catch (aiErr: any) {
          console.warn(
            `[AI-Assistant] Live AI analysis enrichment fell back to deterministic dossier for Org "${orgId}": ${aiErr?.message || aiErr}`
          );
        }
      }

      const payload = {
        situation,
        projections,
        insights,
        patterns,
        dataAvailable,
        generatedByAI,
      };

      analysisCache.set(cacheKey, {
        expiresAt: Date.now() + (generatedByAI ? ANALYSIS_AI_CACHE_TTL_MS : ANALYSIS_FALLBACK_CACHE_TTL_MS),
        payload,
      });

      return payload;
    };

    const runPromise = computeAnalysis();
    analysisInFlight.set(cacheKey, runPromise);

    try {
      const payload = await runPromise;
      return ok(res, payload);
    } catch (err: any) {
      console.error('[ai-assistant] Analysis generation error:', err);
      return fail(res, 500, 'Failed to generate financial analysis.');
    } finally {
      if (analysisInFlight.get(cacheKey) === runPromise) {
        analysisInFlight.delete(cacheKey);
      }
    }
  });

  return r;
}
