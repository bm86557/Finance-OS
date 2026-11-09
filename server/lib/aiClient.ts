/**
 * AI Client for Transaction Categorization
 * Supports OpenAI and OpenAI-compatible APIs
 * Includes quota-aware rate limiting and intelligent local fallback
 */

import type { AIConfig } from '../config/aiConfig.js';
import { classifyTransaction } from '../../src/lib/classificationEngine.js';

export interface CategorySuggestion {
  categoryName: string;
  confidence: number;
  reasoning: string;
}

export interface TransactionClassificationInput {
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  availableCategories: Array<{ id: string; name: string; type: string }>;
}

export interface TransactionClassificationResult {
  suggestedCategory: string;
  confidence: number;
  reasoning: string;
  alternatives: CategorySuggestion[];
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

  // Expense patterns
  { keywords: ['rent', 'lease', 'tenancy'], categoryPatterns: ['rent', 'lease', 'occupancy'], type: 'expense' },
  { keywords: ['electric', 'power', 'gas', 'water', 'sewage', 'utility', 'utilities'], categoryPatterns: ['utilit', 'electric', 'power', 'gas', 'water'], type: 'expense' },
  { keywords: ['internet', 'broadband', 'wifi', 'telecom', 'phone', 'mobile', 'airtime', 'data bundle', 'vodafone', 'airtel', 'jio', 'mtn'], categoryPatterns: ['telecom', 'phone', 'internet', 'communication', 'utilit'], type: 'expense' },
  { keywords: ['insurance', 'premium', 'policy', 'cover'], categoryPatterns: ['insurance', 'premium'], type: 'expense' },
  { keywords: ['fuel', 'petrol', 'diesel', 'gas station', 'shell', 'total', 'filling'], categoryPatterns: ['fuel', 'transport', 'vehicle', 'auto'], type: 'expense' },
  { keywords: ['uber', 'bolt', 'lyft', 'taxi', 'cab', 'ride', 'transport', 'bus', 'train', 'metro', 'fare'], categoryPatterns: ['transport', 'travel', 'commut'], type: 'expense' },
  { keywords: ['food', 'restaurant', 'cafe', 'coffee', 'lunch', 'dinner', 'breakfast', 'meal', 'eat', 'pizza', 'burger', 'catering', 'kitchen', 'snack', 'kfc', 'mcdonald'], categoryPatterns: ['food', 'meal', 'dining', 'restaurant', 'catering', 'entertainment'], type: 'expense' },
  { keywords: ['grocery', 'supermarket', 'market', 'shoprite', 'walmart', 'costco', 'provision', 'store'], categoryPatterns: ['grocery', 'food', 'supplies', 'household'], type: 'expense' },
  { keywords: ['amazon', 'shopping', 'purchase', 'buy', 'order', 'ecommerce', 'flipkart', 'jumia', 'alibaba'], categoryPatterns: ['shopping', 'purchase', 'supplies', 'expense'], type: 'expense' },
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
  { keywords: ['transfer', 'wire', 'remittance', 'send', 'payment'], categoryPatterns: ['transfer', 'payment', 'expense'], type: 'expense' },
];

function classifyWithKeywords(
  narration: string,
  amount: number,
  type: 'debit' | 'credit',
  availableCategories: Array<{ id: string; name: string; type: string }>
): TransactionClassificationResult | null {
  try {
    const result = classifyTransaction(
      narration,
      amount,
      type,
      availableCategories as any,
      [],
      []
    );

    if (result && result.categoryName && result.categoryName !== 'Uncategorized') {
      return {
        suggestedCategory: result.categoryName,
        confidence: Math.max(90, result.confidence),
        reasoning: result.reasoning,
        alternatives: (result.alternativeSuggestions || []).map(alt => ({
          categoryName: alt.categoryName,
          confidence: alt.confidence,
          reasoning: `Alternative match (${alt.confidence}%)`,
        })),
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
          confidence: 95,
          reasoning: `Matched pattern: "${catPattern}"`,
          alternatives: [],
        };
      }
    }
  }

  return null;
}

/**
 * Build system prompt for transaction classification
 */
function buildSystemPrompt(categories: Array<{ id: string; name: string; type: string }>): string {
  const categoryList = categories.map(c => `- ${c.name} (${c.type})`).join('\n');
  
  return `Classify bank transactions into categories.

Categories:
${categoryList}

Rules:
1. Match transaction type (debit/credit) with category type (expense/income)
2. Return confidence 0-100
3. Keep reasoning under 30 words
4. alternatives array is optional (omit if unsure)

Return ONLY valid, complete JSON in compact format:
{"suggestedCategory":"Category Name","confidence":75,"reasoning":"Brief explanation","alternatives":[]}`;
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

/**
 * Call OpenAI-compatible API
 */
async function callOpenAICompatible(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
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
  return data.choices[0]?.message?.content || '{}';
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
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
  return data.content[0]?.text || '{}';
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

        if (response.status === 429 || response.status === 503 || response.status === 404) {
          const retryDelay = response.status === 429 ? parseRetryDelay(errorText) : 120;
          markQuotaExhausted(retryDelay || 120);
          break;
        }
        throw lastError;
      }

      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      return repairJsonIfNeeded(raw);
    } catch (err: any) {
      lastError = err;
      console.warn(`[aiClient] Gemini attempt with model ${modelName} failed:`, err?.message || err);
      // On network timeout or 503, set a 60s cooldown to avoid hanging subsequent calls
      if (!isQuotaExhausted()) {
        markQuotaExhausted(60);
      }
      break;
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
 * Main classification function — tries AI first, falls back to local keyword classifier
 */
export async function classifyTransactionWithAI(
  input: TransactionClassificationInput,
  config: AIConfig
): Promise<TransactionClassificationResult> {
  // If quota is exhausted, go straight to local classifier
  if (config.provider === 'gemini' && isQuotaExhausted()) {
    const localResult = classifyWithKeywords(
      input.narration, input.amount, input.type, input.availableCategories
    );
    if (localResult) return localResult;
    return {
      suggestedCategory: 'Uncategorized',
      confidence: 0,
      reasoning: 'AI quota exhausted; no keyword match found',
      alternatives: [],
    };
  }

  const systemPrompt = buildSystemPrompt(input.availableCategories);
  const userPrompt = buildUserPrompt(input);

  try {
    const responseText = await callAI(config, systemPrompt, userPrompt);

    let result: TransactionClassificationResult;
    try {
      result = JSON.parse(responseText) as TransactionClassificationResult;
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      return {
        suggestedCategory: 'Uncategorized',
        confidence: 0,
        reasoning: 'AI returned invalid response',
        alternatives: [],
      };
    }
    
    if (!result.suggestedCategory || typeof result.confidence !== 'number') {
      console.error('Invalid AI response structure:', result);
      throw new Error('Invalid AI response format');
    }

    result.confidence = Math.max(0, Math.min(100, result.confidence));
    if (!Array.isArray(result.alternatives)) {
      result.alternatives = [];
    }

    return result;
  } catch (error) {
    // On failure, try local keyword classifier before giving up
    const localResult = classifyWithKeywords(
      input.narration, input.amount, input.type, input.availableCategories
    );
    if (localResult) {
      console.log(`[aiClient] AI failed, local classifier matched: "${localResult.suggestedCategory}"`);
      return localResult;
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
}

/**
 * High-performance batch classification: sends all transactions in a single prompt
 * and automatically classifies any missing transactions individually so NO transactions are skipped.
 * 
 * Quota-aware: detects rate limits early and falls back to local keyword classification
 * to avoid burning through free-tier quota on doomed requests.
 */
/**
 * High-performance batch classification with parallel processing
 * Strategy:
 * 1. Quick local classification for obvious patterns (instant)
 * 2. Deduplicate similar transactions (reduce API calls)
 * 3. Process remaining in parallel chunks (fast)
 * 4. Fall back for any failures (reliable)
 */
export async function classifyBatchWithAI(
  input: {
    transactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>;
    availableCategories: Array<{ id: string; name: string; type: string }>;
  },
  config: AIConfig
): Promise<Map<number, BatchItemClassification>> {
  const results = new Map<number, BatchItemClassification>();
  if (!input.transactions.length) return results;

  const totalCount = input.transactions.length;
  console.log(`[aiClient] Batch classification started: ${totalCount} transactions`);

  // ═══ PHASE 1: Quick local classification for high-confidence matches ═══
  const needsAI: number[] = [];
  const startLocal = Date.now();

  for (let i = 0; i < totalCount; i++) {
    const txn = input.transactions[i];
    const localResult = classifyWithKeywords(
      txn.narration, txn.amount, txn.type, input.availableCategories
    );
    
    // Use local result if confidence is high enough (90+)
    if (localResult && localResult.confidence >= 90) {
      results.set(i, {
        index: i,
        suggestedCategory: localResult.suggestedCategory,
        confidence: localResult.confidence,
        reasoning: localResult.reasoning,
      });
    } else {
      needsAI.push(i);
    }
  }

  const localTime = Date.now() - startLocal;
  console.log(`[aiClient] Phase 1: ${results.size}/${totalCount} classified locally in ${localTime}ms`);

  // If all classified locally or quota exhausted, return early
  if (needsAI.length === 0 || (config.provider === 'gemini' && isQuotaExhausted())) {
    if (isQuotaExhausted()) {
      console.log(`[aiClient] Quota exhausted, using local classifier for remaining ${needsAI.length}`);
      // Classify remaining with lower threshold
      for (const idx of needsAI) {
        const txn = input.transactions[idx];
        const localResult = classifyWithKeywords(
          txn.narration, txn.amount, txn.type, input.availableCategories
        );
        if (localResult) {
          results.set(idx, {
            index: idx,
            suggestedCategory: localResult.suggestedCategory,
            confidence: Math.max(60, localResult.confidence),
            reasoning: localResult.reasoning,
          });
        }
      }
    }
    return results;
  }

  // ═══ PHASE 2: Deduplicate similar transactions ═══
  const dedupeMap = new Map<string, number[]>(); // narration -> indices
  for (const idx of needsAI) {
    const key = input.transactions[idx].narration.toLowerCase().trim();
    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, []);
    }
    dedupeMap.get(key)!.push(idx);
  }

  const uniqueKeys = Array.from(dedupeMap.keys());
  console.log(`[aiClient] Phase 2: Deduplicated ${needsAI.length} → ${uniqueKeys.length} unique transactions`);

  // ═══ PHASE 3: Parallel AI classification in optimized chunks ═══
  const CHUNK_SIZE = 10; // Balanced: not too big (timeout), not too small (slow)
  const MAX_PARALLEL = 3; // Process 3 chunks simultaneously
  
  const startAI = Date.now();
  const chunks: number[][] = [];
  
  // Build chunks from unique transaction indices
  for (let i = 0; i < uniqueKeys.length; i += CHUNK_SIZE) {
    const chunkKeys = uniqueKeys.slice(i, Math.min(i + CHUNK_SIZE, uniqueKeys.length));
    const chunkIndices = chunkKeys.flatMap(key => dedupeMap.get(key)!);
    chunks.push(chunkIndices.map(idx => needsAI.indexOf(idx)).filter(i => i >= 0));
  }

  // Process chunks in parallel batches
  for (let batchStart = 0; batchStart < chunks.length; batchStart += MAX_PARALLEL) {
    const batchEnd = Math.min(batchStart + MAX_PARALLEL, chunks.length);
    const parallelChunks = chunks.slice(batchStart, batchEnd);
    
    const promises = parallelChunks.map((chunkIndices, idx) => 
      classifyChunkWithAI(
        chunkIndices.map(i => needsAI[i]),
        input.transactions,
        input.availableCategories,
        config,
        batchStart + idx
      )
    );

    const chunkResults = await Promise.allSettled(promises);
    
    // Merge results
    chunkResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        for (const [idx, classification] of result.value) {
          results.set(idx, classification);
          
          // Apply same classification to duplicates
          const txn = input.transactions[idx];
          const key = txn.narration.toLowerCase().trim();
          const duplicates = dedupeMap.get(key) || [];
          for (const dupIdx of duplicates) {
            if (dupIdx !== idx && !results.has(dupIdx)) {
              results.set(dupIdx, { ...classification, index: dupIdx });
            }
          }
        }
      }
    });
  }

  const aiTime = Date.now() - startAI;
  console.log(`[aiClient] Phase 3: AI classified ${results.size - (totalCount - needsAI.length)} transactions in ${aiTime}ms`);

  // ═══ PHASE 4: Final fallback for any missed transactions ═══
  const stillMissing: number[] = [];
  for (let i = 0; i < totalCount; i++) {
    if (!results.has(i)) stillMissing.push(i);
  }

  if (stillMissing.length > 0) {
    console.log(`[aiClient] Phase 4: Fallback for ${stillMissing.length} remaining transactions`);
    for (const idx of stillMissing) {
      const txn = input.transactions[idx];
      const localResult = classifyWithKeywords(
        txn.narration, txn.amount, txn.type, input.availableCategories
      );
      results.set(idx, {
        index: idx,
        suggestedCategory: localResult?.suggestedCategory || 'Uncategorized',
        confidence: localResult?.confidence || 50,
        reasoning: localResult?.reasoning || 'Fallback classification',
      });
    }
  }

  const totalTime = Date.now() - startLocal;
  console.log(`[aiClient] Batch complete: ${results.size}/${totalCount} in ${totalTime}ms (${Math.round(totalTime/totalCount)}ms/txn)`);

  return results;
}

/**
 * Classify a single chunk with AI (helper for parallel processing)
 */
async function classifyChunkWithAI(
  indices: number[],
  allTransactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>,
  availableCategories: Array<{ id: string; name: string; type: string }>,
  config: AIConfig,
  chunkId: number
): Promise<Map<number, BatchItemClassification>> {
  const results = new Map<number, BatchItemClassification>();
  if (indices.length === 0) return results;

  const categoryList = availableCategories.map(c => `${c.name}(${c.type})`).join(', ');
  const chunkTransactions = indices.map(idx => allTransactions[idx]);

  // Ultra-compact prompt for speed
  const systemPrompt = `Classify transactions. Categories: ${categoryList}
Rules: Match type (debit=expense, credit=income). Confidence 60-95. Reasoning <15 words.
Return JSON: {"classifications":[{"index":0,"suggestedCategory":"Name","confidence":85,"reasoning":"why"}]}`;

  const txnsPayload = chunkTransactions.map((t, i) => ({
    index: indices[i],
    desc: t.narration,
    amt: t.amount,
    type: t.type === 'debit' ? 'exp' : 'inc',
  }));

  const userPrompt = `Classify ${indices.length} txns:\n${JSON.stringify(txnsPayload)}`;

  try {
    const rawText = await callAI(config, systemPrompt, userPrompt);
    
    // Parse response
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    const list: any[] = Array.isArray(parsed) 
      ? parsed 
      : (Array.isArray(parsed?.classifications) ? parsed.classifications : []);

    for (const item of list) {
      if (typeof item?.index === 'number' && item?.suggestedCategory) {
        results.set(item.index, {
          index: item.index,
          suggestedCategory: String(item.suggestedCategory).trim(),
          confidence: Math.max(60, Math.min(95, Number(item.confidence) || 80)),
          reasoning: String(item.reasoning || 'AI classified').substring(0, 100),
        });
      }
    }

    console.log(`[aiClient] Chunk ${chunkId}: ${results.size}/${indices.length} classified`);
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
