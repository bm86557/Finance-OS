/**
 * AI Client for Transaction Categorization
 * Supports OpenAI and OpenAI-compatible APIs
 * Includes quota-aware rate limiting and intelligent local fallback
 */

import type { AIConfig } from '../config/aiConfig.js';
import { calculateTokenCost, executeAIJSON, fingerprintApiKey, recordAiTelemetryEvent } from './aiGateway.js';
import { classifyTransaction } from '../../src/lib/classificationEngine.js';

export interface CategorySuggestion {
  categoryName: string;
  confidence: number;
  reasoning: string;
}

export interface OrgLearningContext {
  learnedRules?: Array<{ pattern: string; categoryName: string; world?: 'business' | 'personal' }>;
  recentCorrections?: Array<{ narration: string; categoryName: string; world?: 'business' | 'personal' }>;
  departments?: Array<{ id: string; name: string }>;
  personalWorldEnabled?: boolean;
}

export interface TransactionClassificationInput {
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  availableCategories: Array<{ id: string; name: string; type: string }>;
  learningContext?: OrgLearningContext;
}

export interface TransactionClassificationResult {
  suggestedCategory: string;
  confidence: number;
  reasoning: string;
  alternatives: CategorySuggestion[];
  world?: 'business' | 'personal';
  worldReason?: string;
  suggestedDepartment?: string;
  createNewCategory?: boolean;
  newCategoryName?: string;
  usedAI?: boolean;
  modelUsed?: string;
}

// ── Quota exhaustion tracker ────────────────────────────────────────────────
// When we receive a 429 RESOURCE_EXHAUSTED response, record it so we can
// skip further calls during the cooldown window instead of burning requests.
let quotaExhaustedUntil: number = 0;

function isQuotaExhausted(): boolean {
  return Date.now() < quotaExhaustedUntil;
}

function markQuotaExhausted(retryAfterSeconds?: number) {
  // Default to 60 minutes cooldown if the API doesn't tell us
  const cooldownMs = (retryAfterSeconds || 3600) * 1000;
  quotaExhaustedUntil = Date.now() + cooldownMs;
  const mins = Math.ceil(cooldownMs / 60000);
  console.warn(`[aiClient] Quota exhausted. Skipping AI calls for ~${mins} minutes. Local classifier will be used.`);
}

function parseRetryDelay(errorText: string): number | undefined {
  // Parse "retryDelay": "38191s" or "Please retry in 10h36m31s"
  const delayMatch = errorText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (delayMatch) return parseInt(delayMatch[1], 10);

  const humanMatch = errorText.match(/retry in (\d+)h(\d+)m/);
  if (humanMatch) return parseInt(humanMatch[1], 10) * 3600 + parseInt(humanMatch[2], 10) * 60;

  return undefined;
}

// ── Keyword-based local classifier ──────────────────────────────────────────
// Smart fallback that classifies transactions without AI using keyword matching.
// This provides much better results than returning "Uncategorized" for everything.

const KEYWORD_PATTERNS: Array<{ keywords: string[]; categoryPatterns: string[]; type: 'expense' | 'income' | 'both' }> = [
  // Income patterns
  { keywords: ['salary', 'payroll', 'wages', 'stipend', 'compensation'], categoryPatterns: ['salary', 'payroll', 'wages', 'income', 'compensation'], type: 'income' },
  { keywords: ['interest', 'dividend', 'yield'], categoryPatterns: ['interest', 'dividend', 'investment', 'income'], type: 'income' },
  { keywords: ['refund', 'cashback', 'reimbursement', 'rebate'], categoryPatterns: ['refund', 'reimbursement', 'income', 'other income'], type: 'income' },
  { keywords: ['commission', 'bonus', 'incentive'], categoryPatterns: ['commission', 'bonus', 'income'], type: 'income' },
  { keywords: ['rent received', 'rental income', 'lease income'], categoryPatterns: ['rental', 'rent', 'income'], type: 'income' },
  { keywords: ['sale', 'revenue', 'proceeds', 'receipt'], categoryPatterns: ['sales', 'revenue', 'income'], type: 'income' },
  { keywords: ['transfer in', 'deposit', 'credit'], categoryPatterns: ['transfer', 'deposit', 'income'], type: 'income' },

  // Expense patterns (specific inventory/hardware/restock BEFORE generic "purchase")
  { keywords: ['restock', 'purchase order', 'po-', 'inventory', 'stock', 'wholesale', 'raw material', 'merchandise'], categoryPatterns: ['inventory', 'cost of goods', 'cogs', 'stock', 'purchases', 'procurement'], type: 'expense' },
  { keywords: ['samsung', 'nokia', 'iphone', 'apple', 'macbook', 'laptop', 'desktop', 'monitor', 'server', 'hardware', 'equipment', 'mobile', 'phone', 'tablet', 'electronics'], categoryPatterns: ['inventory', 'equipment', 'hardware', 'asset', 'cost of goods', 'purchases', 'office'], type: 'expense' },
  { keywords: ['rent', 'lease', 'tenancy'], categoryPatterns: ['rent', 'lease', 'occupancy'], type: 'expense' },
  { keywords: ['electric', 'power', 'gas', 'water', 'sewage', 'utility', 'utilities'], categoryPatterns: ['utilit', 'electric', 'power', 'gas', 'water'], type: 'expense' },
  { keywords: ['internet', 'broadband', 'wifi', 'telecom', 'airtime', 'data bundle', 'vodafone', 'airtel', 'jio', 'mtn'], categoryPatterns: ['telecom', 'phone', 'internet', 'communication', 'utilit'], type: 'expense' },
  { keywords: ['insurance', 'premium', 'policy', 'cover'], categoryPatterns: ['insurance', 'premium'], type: 'expense' },
  { keywords: ['fuel', 'petrol', 'diesel', 'gas station', 'shell', 'total', 'filling'], categoryPatterns: ['fuel', 'transport', 'vehicle', 'auto'], type: 'expense' },
  { keywords: ['uber', 'bolt', 'lyft', 'taxi', 'cab', 'ride', 'transport', 'bus', 'train', 'metro', 'fare'], categoryPatterns: ['transport', 'travel', 'commut'], type: 'expense' },
  { keywords: ['food', 'restaurant', 'cafe', 'coffee', 'lunch', 'dinner', 'breakfast', 'meal', 'eat', 'pizza', 'burger', 'catering', 'kitchen', 'snack', 'kfc', 'mcdonald'], categoryPatterns: ['food', 'meal', 'dining', 'restaurant', 'catering', 'entertainment'], type: 'expense' },
  { keywords: ['grocery', 'supermarket', 'market', 'shoprite', 'walmart', 'costco', 'provision', 'store'], categoryPatterns: ['grocery', 'food', 'supplies', 'household'], type: 'expense' },
  { keywords: ['office', 'stationery', 'printer', 'paper', 'toner', 'supplies'], categoryPatterns: ['office', 'supplies', 'stationery', 'admin'], type: 'expense' },
  { keywords: ['software', 'subscription', 'saas', 'license', 'licence', 'cloud', 'hosting', 'domain', 'aws', 'azure', 'google cloud', 'heroku'], categoryPatterns: ['software', 'technology', 'it', 'subscription', 'cloud'], type: 'expense' },
  { keywords: ['marketing', 'ads', 'advert', 'campaign', 'promotion', 'sponsor', 'facebook ads', 'google ads'], categoryPatterns: ['marketing', 'advertis', 'promotion', 'sales'], type: 'expense' },
  { keywords: ['legal', 'lawyer', 'attorney', 'court', 'law firm', 'litigation'], categoryPatterns: ['legal', 'professional', 'consult'], type: 'expense' },
  { keywords: ['accounting', 'audit', 'bookkeeping', 'tax', 'cpa', 'accountant'], categoryPatterns: ['accounting', 'professional', 'tax', 'audit'], type: 'expense' },
  { keywords: ['consultant', 'consulting', 'advisory', 'professional fee'], categoryPatterns: ['consult', 'professional', 'service'], type: 'expense' },
  { keywords: ['repair', 'maintenance', 'service', 'fix', 'plumber', 'electrician'], categoryPatterns: ['repair', 'maintenance', 'service'], type: 'expense' },
  { keywords: ['travel', 'flight', 'hotel', 'airfare', 'booking', 'accommodation', 'lodge', 'airline', 'airport'], categoryPatterns: ['travel', 'transport', 'accommodation'], type: 'expense' },
  { keywords: ['medical', 'hospital', 'doctor', 'pharmacy', 'health', 'clinic', 'dental', 'lab', 'diagnostic'], categoryPatterns: ['medical', 'health', 'insurance'], type: 'expense' },
  { keywords: ['education', 'training', 'course', 'school', 'tuition', 'workshop', 'seminar', 'certification'], categoryPatterns: ['education', 'training', 'development'], type: 'expense' },
  { keywords: ['bank charge', 'bank fee', 'service charge', 'atm', 'transaction fee', 'card fee', 'annual fee'], categoryPatterns: ['bank', 'fee', 'charge', 'financial'], type: 'expense' },
  { keywords: ['loan', 'emi', 'installment', 'repayment', 'mortgage', 'interest payment'], categoryPatterns: ['loan', 'debt', 'interest', 'financial'], type: 'expense' },
  { keywords: ['donation', 'charity', 'contribution', 'ngo', 'tithe', 'offering'], categoryPatterns: ['donation', 'charity', 'contribution'], type: 'expense' },
  { keywords: ['entertainment', 'movie', 'netflix', 'spotify', 'music', 'game', 'ticket', 'concert', 'show'], categoryPatterns: ['entertainment', 'recreation', 'subscription'], type: 'expense' },
  { keywords: ['amazon', 'shopping', 'purchase', 'buy', 'order', 'ecommerce', 'flipkart', 'jumia', 'alibaba'], categoryPatterns: ['shopping', 'purchase', 'supplies', 'expense'], type: 'expense' },
  { keywords: ['transfer', 'wire', 'remittance', 'send', 'payment'], categoryPatterns: ['transfer', 'payment', 'expense'], type: 'expense' },
];

function classifyWithKeywords(
  narration: string,
  amount: number,
  type: 'debit' | 'credit',
  availableCategories: Array<{ id: string; name: string; type: string }>,
  personalWorldEnabled: boolean = true
): TransactionClassificationResult | null {
  try {
    const result = classifyTransaction(
      narration,
      amount,
      type,
      availableCategories as any,
      [],
      [],
      { personalWorldEnabled }
    );

    // Do NOT inflate confidence (Handoff §11): preserve real confidence and skip low-confidence fallbacks
    if (result && result.categoryId && result.source !== 'fallback' && result.confidence >= 70) {
      return {
        suggestedCategory: result.categoryName,
        confidence: result.confidence,
        reasoning: result.reasoning,
        world: result.world || 'business',
        worldReason: result.worldReason,
        createNewCategory: false,
        alternatives: (result.alternativeSuggestions || []).map(alt => ({
          categoryName: alt.categoryName,
          confidence: alt.confidence,
          reasoning: `Alternative match (${alt.confidence}%)`,
        })),
      };
    }

    if (result?.proposedNewCategory) {
      return {
        suggestedCategory: result.proposedNewCategory.name,
        confidence: result.confidence,
        reasoning: result.reasoning,
        world: result.world || 'business',
        worldReason: result.worldReason,
        createNewCategory: true,
        newCategoryName: result.proposedNewCategory.name,
        alternatives: [],
      };
    }
  } catch (err) {
    console.warn('[aiClient] Advanced classification error, falling back to keyword list:', err);
  }

  const narrationLower = narration.toLowerCase();
  const expectedCategoryType = type === 'debit' ? 'expense' : 'income';

  // Filter categories to only matching type
  const typedCategories = availableCategories.filter(
    c => c.type === expectedCategoryType
  );
  if (typedCategories.length === 0) return null;

  // Try keyword matching
  for (const pattern of KEYWORD_PATTERNS) {
    // Skip if pattern type doesn't match transaction type
    if (pattern.type !== 'both' && pattern.type !== expectedCategoryType) continue;

    const keywordMatch = pattern.keywords.some(kw => narrationLower.includes(kw));
    if (!keywordMatch) continue;

    // Find best matching category from available categories
    for (const catPattern of pattern.categoryPatterns) {
      const matchedCategory = typedCategories.find(
        c => c.name.toLowerCase().includes(catPattern)
      );
      if (matchedCategory) {
        return {
          suggestedCategory: matchedCategory.name,
          confidence: 82,
          reasoning: `Matched keyword pattern: "${catPattern}"`,
          world: 'business',
          createNewCategory: false,
          alternatives: [],
        };
      }
    }
  }

  return null;
}

function formatLearningContextBlock(ctx?: OrgLearningContext): string {
  if (!ctx) return '';
  const sections: string[] = [];
  if (ctx.departments && ctx.departments.length > 0) {
    sections.push(`Organization Departments: ${ctx.departments.map(d => d.name).join(', ')}`);
  }
  if (ctx.learnedRules && ctx.learnedRules.length > 0) {
    const lines = ctx.learnedRules
      .slice(0, 20)
      .map(r => `- "${r.pattern}" => ${r.categoryName} [${r.world || 'business'}]`)
      .join('\n');
    sections.push(`Organization Confirmed Rules (highest priority):\n${lines}`);
  }
  if (ctx.recentCorrections && ctx.recentCorrections.length > 0) {
    const lines = ctx.recentCorrections
      .slice(0, 12)
      .map(c => `- "${c.narration.slice(0, 70)}" => ${c.categoryName} [${c.world || 'business'}]`)
      .join('\n');
    sections.push(`Recent Human Corrections (learn from these patterns):\n${lines}`);
  }
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

const CATCH_ALL_CATEGORY_RE = /^(debit\s*purchases?|buffer|general|other|misc(ellaneous)?|uncategorized|expenses?|purchases?|operating\s*expenses?)$/i;

const CANONICAL_INTENT_RULES: Array<{
  pattern: RegExp;
  canonicalName: string;
  existingMatch: RegExp;
  reason: string;
}> = [
  {
    pattern: /\b(restock|purchase\s*order|po[-\s]?\d+|inventory|low[-\s]?stock|stock\s*replenish|wholesale|merchandise|sku)\b/i,
    canonicalName: 'Inventory & Stock',
    existingMatch: /\b(inventory|stock|cogs|cost\s*of\s*goods|merchandise)\b/i,
    reason: 'Commercial stock/inventory restock purchase order requires dedicated Inventory & Stock tracking',
  },
  {
    pattern: /\b(laptop|macbook|monitor|workstation|server|hardware|equipment|machinery|printer|router)\b/i,
    canonicalName: 'Equipment & Hardware',
    existingMatch: /\b(equipment|hardware|it\s*assets?|fixed\s*assets?|computers?)\b/i,
    reason: 'Hardware/equipment purchase should be tracked separately from generic operating purchases',
  },
  {
    pattern: /\b(electricity|electric\s*bill|water\s*bill|gas\s*bill|internet|broadband|fiber|utility|utilities|wapda|lesco|ke\s*bill|ptcl)\b/i,
    canonicalName: 'Utilities',
    existingMatch: /\b(utilit|internet|telecom|power|electricity)\b/i,
    reason: 'Recurring facility utility/connectivity expense',
  },
  {
    pattern: /\b(bank\s*fee|wire\s*fee|transfer\s*fee|fx\s*fee|service\s*charge|card\s*fee|overdraft|processing\s*fee|stripe\s*fee)\b/i,
    canonicalName: 'Bank Fees & Charges',
    existingMatch: /\b(bank\s*fee|charges?|financial\s*fee|payment\s*processing)\b/i,
    reason: 'Banking or payment processing fee',
  },
  {
    pattern: /\b(legal|attorney|lawyer|audit|chartered\s*accountant|bookkeeping|consulting|advisory|retainer\s*fee)\b/i,
    canonicalName: 'Professional Services',
    existingMatch: /\b(professional|legal|consulting|accounting|audit)\b/i,
    reason: 'External legal, accounting, or advisory professional service',
  },
];

/**
 * Production guard: prevents lightweight fallback models from dumping clearly specialized
 * commercial transactions (e.g. Inventory Restock POs) into vague catch-all categories
 * like "Debit Purchases" or "Buffer" when a proper canonical category is missing.
 */
function refineCatchAllClassification<T extends {
  suggestedCategory: string;
  confidence: number;
  reasoning: string;
  alternatives?: CategorySuggestion[];
  createNewCategory?: boolean;
  newCategoryName?: string;
}>(
  result: T,
  narration: string,
  txnType: 'debit' | 'credit',
  availableCategories: Array<{ id: string; name: string; type: string }>
): T {
  if (txnType !== 'debit') return result;
  if (result.createNewCategory && result.newCategoryName) return result;
  const chosen = String(result.suggestedCategory || '').trim();
  if (!CATCH_ALL_CATEGORY_RE.test(chosen)) return result;
  const baseAlts = Array.isArray(result.alternatives) ? result.alternatives : [];

  for (const rule of CANONICAL_INTENT_RULES) {
    if (!rule.pattern.test(narration)) continue;

    // 1. Check if org already has a proper matching expense category
    const existing = availableCategories.find(
      (c) => String(c.type || '').toLowerCase() !== 'income' && rule.existingMatch.test(c.name)
    );
    if (existing) {
      const nextAlts = [
        { categoryName: chosen, confidence: Math.min(50, result.confidence), reasoning: 'Generic fallback category' },
        ...baseAlts.filter((a) => a.categoryName.toLowerCase() !== existing.name.toLowerCase()),
      ].slice(0, 2);
      return {
        ...result,
        suggestedCategory: existing.name,
        confidence: Math.max(82, result.confidence),
        reasoning: rule.reason,
        alternatives: nextAlts,
        createNewCategory: false,
        newCategoryName: undefined,
      };
    }

    // 2. Org lacks this canonical category — propose creating it cleanly while keeping the catch-all as an alternative
    const nextAlts = [
      { categoryName: chosen, confidence: Math.min(52, result.confidence), reasoning: 'Closest existing generic category' },
      ...baseAlts.filter((a) => a.categoryName.toLowerCase() !== chosen.toLowerCase()),
    ].slice(0, 2);
    return {
      ...result,
      suggestedCategory: rule.canonicalName,
      confidence: Math.max(84, result.confidence),
      reasoning: rule.reason,
      alternatives: nextAlts,
      createNewCategory: true,
      newCategoryName: rule.canonicalName,
    };
  }

  return result;
}

/**
 * Build system prompt for transaction classification
 */
function buildSystemPrompt(
  categories: Array<{ id: string; name: string; type: string }>,
  learningContext?: OrgLearningContext
): string {
  const categoryList = categories.map(c => `- ${c.name} (${c.type})`).join('\n');
  const learningBlock = formatLearningContextBlock(learningContext);
  const worldRule = learningContext?.personalWorldEnabled === false
    ? '2. Set "world" to "business" (personal finance is disabled for this org).'
    : '2. Determine whether the transaction is "business" (company/agency operations, inventory/restock, hardware/equipment, SaaS, payroll, client revenue, office, B2B) or "personal" (groceries, gym, pharmacy, cinema, family, personal shopping/draw).';

  return `You are a senior financial accountant classifying bank transactions into categories, business/personal scope, and departments.

Existing Organization Categories:
${categoryList}${learningBlock}

Rules:
1. Match transaction type (debit=expense, credit=income) with category type.
${worldRule}
3. Understand the FULL commercial intent (e.g., "Purchase: Nokia Mobile - Restock Purchase Order" is Inventory & Stock / Cost of Goods Sold — NOT generic "Debit Purchases" or "Buffer").
4. Follow Organization Confirmed Rules and Recent Human Corrections whenever the merchant or pattern matches.
5. Prefer an existing SPECIFIC category when it accurately fits. NEVER dump specialized commercial transactions (inventory restock, hardware/equipment, utilities, legal/professional services, bank fees) into vague catch-all categories like "Debit Purchases", "Buffer", "General", "Misc", or "Other" — instead set "createNewCategory": true, provide a concise canonical "newCategoryName" (2-4 words, e.g. "Inventory & Stock"), and put the closest existing category in "alternatives" with lower confidence (<=55).
6. ALWAYS provide up to 2 sensible "alternatives" from Existing Organization Categories with honest confidence scores and short reasoning.
7. If Organization Departments are listed, pick the best matching "suggestedDepartment" (or "" if general/shared).
8. Return honest confidence 0-100 (below 70 if ambiguous). Keep reasoning clear and specific (under 25 words).

Return ONLY valid, complete JSON:
{"suggestedCategory":"Category Name","confidence":86,"world":"business","worldReason":"Commercial stock/hardware procurement","suggestedDepartment":"Operations","createNewCategory":false,"newCategoryName":"","reasoning":"Bulk purchase of 10 Samsung Mobile units indicates inventory or hardware procurement","alternatives":[{"categoryName":"Second Best Category","confidence":64,"reasoning":"Short reason"}]}`;
}

/**
 * Build user prompt for specific transaction
 */
function buildUserPrompt(input: TransactionClassificationInput): string {
  const typeDesc = input.type === 'debit' ? 'expense/payment' : 'income/receipt';
  return `Classify this transaction:
- Description: "${input.narration}"
- Amount: ${input.amount}
- Type: ${typeDesc}

Return JSON with your classification.`;
}

async function recordClientTelemetry(params: {
  config: AIConfig;
  provider: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  isFreeTierZeroBilled: boolean;
}) {
  const { config, provider, modelName, promptTokens, completionTokens, totalTokens, latencyMs, isFreeTierZeroBilled } = params;
  const defaults = provider === 'anthropic'
    ? { inRate: 0.80, outRate: 4.00 }
    : provider === 'gemini'
      ? { inRate: 0.075, outRate: 0.30 }
      : { inRate: 0.15, outRate: 0.60 };
  const { actualCostUsd, commercialCostUsd } = calculateTokenCost({
    provider,
    modelName,
    promptTokens,
    completionTokens,
    costPer1MInput: defaults.inRate,
    costPer1MOutput: defaults.outRate,
    isFreeTierZeroBilled,
  });
  const keySource = (config as any).keySource === 'custom_byok' ? 'custom_byok' : 'platform';
  void recordAiTelemetryEvent({
    organizationId: (config as any).organizationId || 'platform_global',
    portalType: 'organization_admin',
    featureArea: 'narration_classification',
    provider,
    modelName,
    fallbackTriggered: false,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: actualCostUsd,
    commercialCostUsd,
    latencyMs,
    status: 'success',
    keySource,
    keyLast4: config.apiKey ? config.apiKey.slice(-4) : undefined,
    keyFingerprint: config.apiKey ? fingerprintApiKey(config.apiKey) : undefined,
  });
}

/**
 * Call OpenAI-compatible API
 */
async function callOpenAICompatible(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const start = Date.now();
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const endpoint = `${baseUrl}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '{}';
  const promptTokens = data.usage?.prompt_tokens || Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const completionTokens = data.usage?.completion_tokens || Math.ceil(content.length / 4);
  recordClientTelemetry({
    config,
    provider: config.provider || 'openai',
    modelName: config.modelName,
    promptTokens,
    completionTokens,
    totalTokens: data.usage?.total_tokens || (promptTokens + completionTokens),
    latencyMs: Date.now() - start,
    isFreeTierZeroBilled: false,
  });
  return content;
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const start = Date.now();
  const endpoint = 'https://api.anthropic.com/v1/messages';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.modelName,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.content[0]?.text || '{}';
  const promptTokens = data.usage?.input_tokens || Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const completionTokens = data.usage?.output_tokens || Math.ceil(content.length / 4);
  recordClientTelemetry({
    config,
    provider: 'anthropic',
    modelName: config.modelName,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs: Date.now() - start,
    isFreeTierZeroBilled: false,
  });
  return content;
}

function repairJsonIfNeeded(rawText: string): string {
  let text = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  
  if (text && !text.endsWith('}')) {
    console.warn('[aiClient] Detected incomplete JSON, attempting to repair');
    try {
      JSON.parse(text);
    } catch {
      const lastQuote = text.lastIndexOf('"');
      const lastColon = text.lastIndexOf(':');
      if (lastColon > lastQuote) {
        text += '""';
      }
      const openBrackets = (text.match(/\[/g) || []).length;
      const closeBrackets = (text.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        text += ']'.repeat(openBrackets - closeBrackets);
      }
      const openBraces = (text.match(/\{/g) || []).length;
      const closeBraces = (text.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        text += '}'.repeat(openBraces - closeBraces);
      }
    }
  }
  return text;
}

/**
 * Call Google Gemini API with automatic model fallbacks and timeout.
 * Respects quota exhaustion tracking to avoid wasting requests.
 */
async function callGemini(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  // Check quota before making any calls
  if (isQuotaExhausted()) {
    throw new Error('Gemini API quota exhausted — using local classifier. Quota resets daily.');
  }

  const modelsToTry = [
    config.modelName || 'gemini-3.8-flash',
  ];

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    const start = Date.now();
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        signal: AbortSignal.timeout(30000), // 30 seconds for batch operations
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `${systemPrompt}\n\n${userPrompt}\n\nIMPORTANT: You must return ONLY valid, complete JSON. Do not truncate. Keep reasoning under 30 words.` }
            ]
          }],
          generationConfig: {
            temperature: config.temperature || 0.3,
            maxOutputTokens: 8192, // Enough for large batches
            candidateCount: 1,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[aiClient] Gemini (${modelName}) returned status ${response.status}`);
        lastError = new Error(`Gemini API error (${response.status}): ${errorText}`);

        if (response.status === 429) {
          const retryDelay = parseRetryDelay(errorText);
          markQuotaExhausted(retryDelay || 120);
          break;
        }
        if (response.status === 503 || response.status === 404) {
          // Transient high-demand spike or unavailable model: step down to next model without freezing quota
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const parts: Array<{ text?: string; thought?: boolean }> = data.candidates?.[0]?.content?.parts || [];
      const nonThought = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
      const raw = nonThought || parts.map((p) => p.text || '').join('').trim() || '{}';
      const promptTokens = data.usageMetadata?.promptTokenCount || Math.ceil((systemPrompt.length + userPrompt.length) / 4);
      const completionTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(raw.length / 4);
      const totalTokens = data.usageMetadata?.totalTokenCount || (promptTokens + completionTokens);

      recordClientTelemetry({
        config,
        provider: 'gemini',
        modelName,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs: Date.now() - start,
        isFreeTierZeroBilled: (config as any).keySource !== 'custom_byok',
      });

      return repairJsonIfNeeded(raw);
    } catch (err: any) {
      lastError = err;
      console.warn(`[aiClient] Gemini attempt with model ${modelName} failed:`, err?.message || err);
      // Try next fallback model instead of triggering a 60s global quota freeze
      continue;
    }
  }

  throw lastError || new Error('Gemini API call failed, using local classifier');
}

async function callAI(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(config, systemPrompt, userPrompt);
    case 'gemini':
      return callGemini(config, systemPrompt, userPrompt);
    case 'openai':
    case 'azure_openai':
    case 'custom':
    default:
      return callOpenAICompatible(config, systemPrompt, userPrompt);
  }
}

/**
 * Main classification function — uses Unified AI Gateway multi-provider failover first,
 * falls back to direct callAI, and only uses local keyword classifier if all LLM providers fail.
 */
export async function classifyTransactionWithAI(
  input: TransactionClassificationInput,
  config: AIConfig
): Promise<TransactionClassificationResult> {
  const systemPrompt = buildSystemPrompt(input.availableCategories, input.learningContext);
  const userPrompt = buildUserPrompt(input);
  const orgId = (config as any).organizationId as string | undefined;

  try {
    let result: TransactionClassificationResult;
    let modelUsed: string | undefined = config.modelName;

    if (orgId) {
      try {
        const gwRes = await executeAIJSON<TransactionClassificationResult>(orgId, {
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          temperature: config.temperature ?? 0.2,
          portalType: 'organization_admin',
          featureArea: 'narration_classification',
        });
        result = gwRes.data;
        modelUsed = gwRes.model || modelUsed;
      } catch (gwErr: any) {
        console.warn('[aiClient] Gateway executeAIJSON failed, trying direct callAI:', gwErr?.message || gwErr);
        const responseText = await callAI(config, systemPrompt, userPrompt);
        result = JSON.parse(responseText) as TransactionClassificationResult;
      }
    } else {
      const responseText = await callAI(config, systemPrompt, userPrompt);
      result = JSON.parse(responseText) as TransactionClassificationResult;
    }

    if (!result || (!result.suggestedCategory && !result.newCategoryName) || typeof result.confidence !== 'number') {
      throw new Error('Invalid AI response format');
    }

    result.suggestedCategory = String(result.suggestedCategory || result.newCategoryName || '').trim();
    result.confidence = Math.max(0, Math.min(100, Math.round(result.confidence)));
    result.world = result.world === 'personal' && input.learningContext?.personalWorldEnabled !== false ? 'personal' : 'business';
    result.createNewCategory = Boolean(result.createNewCategory);
    if (result.createNewCategory && result.newCategoryName) {
      result.newCategoryName = String(result.newCategoryName).trim().slice(0, 60);
    }
    if (!Array.isArray(result.alternatives)) {
      result.alternatives = [];
    } else {
      result.alternatives = result.alternatives
        .filter((a: any) => a && a.categoryName)
        .slice(0, 3)
        .map((a: any) => ({
          categoryName: String(a.categoryName).trim(),
          confidence: Math.max(10, Math.min(95, Math.round(Number(a.confidence) || 50))),
          reasoning: String(a.reasoning || 'Alternative AI suggestion').slice(0, 120),
        }));
    }
    result.usedAI = true;
    result.modelUsed = modelUsed;

    return refineCatchAllClassification(result, input.narration, input.type, input.availableCategories);
  } catch (error) {
    // On failure of ALL AI providers, fall back to local keyword classifier (marked usedAI: false!)
    const localResult = classifyWithKeywords(
      input.narration, input.amount, input.type, input.availableCategories,
      input.learningContext?.personalWorldEnabled !== false
    );
    if (localResult) {
      console.log(`[aiClient] All AI providers unavailable, local classifier matched: "${localResult.suggestedCategory}"`);
      return { ...localResult, usedAI: false };
    }

    console.error('AI classification error:', error);
    throw new Error(`Failed to classify with AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export interface BatchItemClassification {
  index: number;
  suggestedCategory: string;
  confidence: number;
  reasoning: string;
  world?: 'business' | 'personal';
  worldReason?: string;
  suggestedDepartment?: string;
  alternatives?: CategorySuggestion[];
  createNewCategory?: boolean;
  newCategoryName?: string;
  usedAI?: boolean;
  modelUsed?: string;
}

/**
 * High-performance batch classification with Unified AI Gateway multi-provider failover.
 * Note: Org rules are already evaluated BEFORE calling this function (§11).
 * Sends unresolved rows to the real LLM with org learning context, returning category +
 * alternatives + personal/business world + department + missing category proposals.
 */
export async function classifyBatchWithAI(
  input: {
    transactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>;
    availableCategories: Array<{ id: string; name: string; type: string }>;
    learningContext?: OrgLearningContext;
  },
  config: AIConfig
): Promise<Map<number, BatchItemClassification>> {
  const results = new Map<number, BatchItemClassification>();
  if (!input.transactions.length) return results;

  const totalCount = input.transactions.length;
  const personalEnabled = input.learningContext?.personalWorldEnabled !== false;
  const startLocal = Date.now();
  console.log(`[aiClient] Batch AI classification started: ${totalCount} transactions`);

  // Send ALL unresolved rows passed here to the LLM (deduplicated by type+narration)
  const needsAI: number[] = Array.from({ length: totalCount }, (_, i) => i);

  // ═══ PHASE 1: Deduplicate identical transactions to minimize LLM tokens ═══
  const dedupeMap = new Map<string, number[]>();
  for (const idx of needsAI) {
    const key = `${input.transactions[idx].type}:${input.transactions[idx].narration.toLowerCase().trim()}`;
    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, []);
    }
    dedupeMap.get(key)!.push(idx);
  }

  const uniqueKeys = Array.from(dedupeMap.keys());
  console.log(`[aiClient] Deduplicated ${needsAI.length} → ${uniqueKeys.length} unique transactions for LLM`);

  // ═══ PHASE 2: Parallel AI classification in compact chunks via Unified AI Gateway ═══
  // Keep chunks compact (5 rows) so JSON output never truncates on reasoning models and runs fast in parallel.
  const CHUNK_SIZE = 5;
  const MAX_PARALLEL = 3;

  const startAI = Date.now();
  const chunks: number[][] = [];

  for (let i = 0; i < uniqueKeys.length; i += CHUNK_SIZE) {
    const chunkKeys = uniqueKeys.slice(i, Math.min(i + CHUNK_SIZE, uniqueKeys.length));
    const repIndices = chunkKeys.map(key => dedupeMap.get(key)![0]);
    chunks.push(repIndices);
  }

  const applyChunkResult = (result: PromiseSettledResult<Map<number, BatchItemClassification>>) => {
    if (result.status === 'fulfilled') {
      for (const [idx, classification] of result.value) {
        results.set(idx, classification);

        const txn = input.transactions[idx];
        const key = `${txn.type}:${txn.narration.toLowerCase().trim()}`;
        const duplicates = dedupeMap.get(key) || [];
        for (const dupIdx of duplicates) {
          if (dupIdx !== idx && !results.has(dupIdx)) {
            results.set(dupIdx, { ...classification, index: dupIdx });
          }
        }
      }
    }
  };

  // Canary-first execution: run Chunk 0 first when multiple chunks exist so any overloaded/503
  // gateway model trips its circuit breaker immediately, letting remaining parallel chunks go
  // straight to the healthy provider without redundant timeouts.
  let startIdx = 0;
  if (chunks.length > 1) {
    const [firstRes] = await Promise.allSettled([
      classifyChunkWithAI(
        chunks[0],
        input.transactions,
        input.availableCategories,
        config,
        0,
        input.learningContext
      ),
    ]);
    applyChunkResult(firstRes);
    startIdx = 1;
  }

  for (let batchStart = startIdx; batchStart < chunks.length; batchStart += MAX_PARALLEL) {
    const batchEnd = Math.min(batchStart + MAX_PARALLEL, chunks.length);
    const parallelChunks = chunks.slice(batchStart, batchEnd);

    const promises = parallelChunks.map((chunkIndices, idx) =>
      classifyChunkWithAI(
        chunkIndices,
        input.transactions,
        input.availableCategories,
        config,
        batchStart + idx,
        input.learningContext
      )
    );

    const chunkResults = await Promise.allSettled(promises);
    chunkResults.forEach(applyChunkResult);
  }

  // ═══ PHASE 2B: Automatic single retry for any chunks missed due to transient 503/timeout ═══
  const missedUniqueReps: number[] = [];
  for (const key of uniqueKeys) {
    const repIdx = dedupeMap.get(key)![0];
    if (!results.has(repIdx)) {
      missedUniqueReps.push(repIdx);
    }
  }
  if (missedUniqueReps.length > 0 && !isQuotaExhausted()) {
    console.log(`[aiClient] Retrying ${missedUniqueReps.length} missed unique transaction(s) with LLM...`);
    const retryChunks: number[][] = [];
    for (let i = 0; i < missedUniqueReps.length; i += CHUNK_SIZE) {
      retryChunks.push(missedUniqueReps.slice(i, i + CHUNK_SIZE));
    }
    for (let rIdx = 0; rIdx < retryChunks.length; rIdx++) {
      const [retryRes] = await Promise.allSettled([
        classifyChunkWithAI(
          retryChunks[rIdx],
          input.transactions,
          input.availableCategories,
          config,
          100 + rIdx,
          input.learningContext
        ),
      ]);
      applyChunkResult(retryRes);
    }
  }

  const aiTime = Date.now() - startAI;
  console.log(`[aiClient] LLM classified ${results.size}/${totalCount} transactions in ${aiTime}ms`);

  // ═══ PHASE 3: Local fallback ONLY for rows where ALL AI providers failed (honestly flagged usedAI: false) ═══
  const stillMissing: number[] = [];
  for (let i = 0; i < totalCount; i++) {
    if (!results.has(i)) stillMissing.push(i);
  }

  if (stillMissing.length > 0) {
    console.warn(`[aiClient] Fallback classifier used for ${stillMissing.length} transactions (AI providers unavailable)`);
    for (const idx of stillMissing) {
      const txn = input.transactions[idx];
      const localResult = classifyWithKeywords(
        txn.narration, txn.amount, txn.type, input.availableCategories, personalEnabled
      );
      results.set(idx, {
        index: idx,
        suggestedCategory: localResult?.suggestedCategory || 'Uncategorized',
        confidence: localResult?.confidence || 45,
        reasoning: localResult?.reasoning || 'Fallback classification (AI temporarily unavailable)',
        world: localResult?.world || 'business',
        worldReason: localResult?.worldReason,
        alternatives: localResult?.alternatives || [],
        createNewCategory: localResult?.createNewCategory,
        newCategoryName: localResult?.newCategoryName,
        usedAI: false,
      });
    }
  }

  const totalTime = Date.now() - startLocal;
  console.log(`[aiClient] Batch complete: ${results.size}/${totalCount} in ${totalTime}ms`);

  return results;
}

/**
 * Classify a single chunk with AI via Unified AI Gateway (multi-provider failover + JSON output)
 */
async function classifyChunkWithAI(
  indices: number[],
  allTransactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>,
  availableCategories: Array<{ id: string; name: string; type: string }>,
  config: AIConfig,
  chunkId: number,
  learningContext?: OrgLearningContext
): Promise<Map<number, BatchItemClassification>> {
  const results = new Map<number, BatchItemClassification>();
  if (indices.length === 0) return results;

  const categoryList = availableCategories.length > 0
    ? availableCategories.map(c => `${c.name}(${c.type})`).join(', ')
    : 'None yet (propose clean standard accounting categories with createNewCategory:true and newCategoryName)';
  const learningBlock = formatLearningContextBlock(learningContext);
  const personalEnabled = learningContext?.personalWorldEnabled !== false;
  const chunkTransactions = indices.map(idx => allTransactions[idx]);

  const systemPrompt = `You are a senior financial accountant classifying bank transactions into categories, business/personal scope, and departments.
Existing Categories: ${categoryList}${learningBlock}
Rules:
1. Match type (exp=expense, inc=income).
2. ${personalEnabled ? 'Classify world as "business" (company/agency operations, inventory/restock, hardware/equipment, SaaS, payroll, client revenue) or "personal" (groceries, gym, pharmacy, cinema, family, personal shopping/draw).' : 'Always set world="business".'}
3. Understand FULL meaning (e.g., "Purchase: Nokia Mobile - Restock PO" is Inventory & Stock / Cost of Goods Sold, NOT generic "Debit Purchases" or "Buffer").
4. Follow Organization Confirmed Rules and Recent Human Corrections when applicable.
5. Prefer an existing SPECIFIC category when it accurately fits. NEVER dump specialized commercial transactions (inventory/restock POs, hardware/equipment, utilities, legal/professional services, bank fees) into vague catch-all categories like "Debit Purchases", "Buffer", "General", "Misc", or "Other" — instead set createNewCategory:true, newCategoryName:"Canonical Name" (e.g. "Inventory & Stock"), suggestedCategory:"Canonical Name", and place the generic category in "alternatives" with confidence <= 55.
6. ALWAYS include up to 2 sensible "alternatives" from Existing Categories with confidence and short reasoning.
7. If Organization Departments are listed, include best matching "suggestedDepartment" (or "").
8. Honest confidence 35-95. Clear, specific reasoning (<20 words).
Return ONLY valid JSON:
{"classifications":[{"index":0,"suggestedCategory":"Name","confidence":86,"world":"business","worldReason":"why","suggestedDepartment":"Operations","createNewCategory":false,"newCategoryName":"","reasoning":"specific reason","alternatives":[{"categoryName":"Alt Category","confidence":65,"reasoning":"why"}]}]}`;

  const txnsPayload = chunkTransactions.map((t, i) => ({
    index: indices[i],
    desc: t.narration,
    amt: t.amount,
    type: t.type === 'debit' ? 'exp' : 'inc',
  }));

  const userPrompt = `Classify ${indices.length} transactions:\n${JSON.stringify(txnsPayload)}`;
  const orgId = (config as any).organizationId as string | undefined;

  try {
    let parsed: any;
    let modelUsed: string | undefined = config.modelName;

    if (orgId) {
      try {
        const gwRes = await executeAIJSON<any>(orgId, {
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          temperature: config.temperature ?? 0.2,
          maxTokens: 8192,
          timeoutMs: 25_000,
          portalType: 'organization_admin',
          featureArea: 'statement_import_batch',
        });
        parsed = gwRes.data;
        modelUsed = gwRes.model || modelUsed;
      } catch (gwErr: any) {
        const msg = String(gwErr?.message || gwErr);
        if (msg.includes('(429)') || msg.toLowerCase().includes('quota')) {
          markQuotaExhausted(parseRetryDelay(msg) || 120);
          throw gwErr;
        }
        console.warn(`[aiClient] Chunk ${chunkId} gateway failed, trying direct callAI:`, msg);
        const rawText = await callAI(config, systemPrompt, userPrompt);
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleaned);
        }
      }
    } else {
      const rawText = await callAI(config, systemPrompt, userPrompt);
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      }
    }

    const list: any[] = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.classifications) ? parsed.classifications : []);

    for (const item of list) {
      if (typeof item?.index === 'number' && (item?.suggestedCategory || item?.newCategoryName)) {
        const createNew = Boolean(item.createNewCategory);
        const newCatName = createNew ? String(item.newCategoryName || item.suggestedCategory || '').trim().slice(0, 60) : undefined;
        const alts: CategorySuggestion[] = Array.isArray(item.alternatives)
          ? item.alternatives
              .filter((a: any) => a && a.categoryName)
              .slice(0, 3)
              .map((a: any) => ({
                categoryName: String(a.categoryName).trim(),
                confidence: Math.max(10, Math.min(95, Math.round(Number(a.confidence) || 50))),
                reasoning: String(a.reasoning || 'Alternative AI suggestion').substring(0, 120),
              }))
          : [];
        const txnForIdx = allTransactions[item.index];
        const baseClassified: BatchItemClassification = {
          index: item.index,
          suggestedCategory: String(item.suggestedCategory || newCatName || '').trim(),
          confidence: Math.max(30, Math.min(95, Math.round(Number(item.confidence) || 75))),
          reasoning: String(item.reasoning || 'AI classified').substring(0, 150),
          world: item.world === 'personal' && personalEnabled ? 'personal' : 'business',
          worldReason: item.worldReason ? String(item.worldReason).substring(0, 120) : undefined,
          suggestedDepartment: item.suggestedDepartment ? String(item.suggestedDepartment).trim() : undefined,
          alternatives: alts,
          createNewCategory: createNew,
          newCategoryName: newCatName,
          usedAI: true,
          modelUsed,
        };
        const refined = txnForIdx
          ? refineCatchAllClassification(baseClassified, txnForIdx.narration, txnForIdx.type, availableCategories)
          : baseClassified;
        results.set(item.index, refined);
      }
    }

    console.log(`[aiClient] Chunk ${chunkId}: ${results.size}/${indices.length} classified by LLM (${modelUsed})`);
  } catch (err) {
    console.warn(`[aiClient] Chunk ${chunkId} failed:`, err instanceof Error ? err.message : err);
  }

  return results;
}

/**
 * Test AI connection
 */
export async function testAIConnection(config: AIConfig): Promise<{ success: boolean; error?: string; latency?: number }> {
  const startTime = Date.now();
  
  try {
    const testInput: TransactionClassificationInput = {
      narration: 'AMAZON.COM PURCHASE',
      amount: 49.99,
      type: 'debit',
      availableCategories: [
        { id: 'cat-1', name: 'Office Supplies', type: 'expense' },
        { id: 'cat-2', name: 'Software', type: 'expense' },
      ],
    };

    await classifyTransactionWithAI(testInput, config);
    
    const latency = Date.now() - startTime;
    return { success: true, latency };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
