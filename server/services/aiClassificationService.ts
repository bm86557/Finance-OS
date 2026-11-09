/**
 * AI Classification Service
 * Handles AI-powered transaction categorization with pattern learning
 */

import type { AIProviderConfig } from '../config/aiConfig.js';
import { buildApiUrl, getProviderHeaders, sanitizeConfigForLogging } from '../config/aiConfig.js';
import type { Category, Transaction } from '../../src/services/types.js';

export interface ClassificationRequest {
  narration: string;
  amount: number;
  type: 'debit' | 'credit';
  date?: string;
  merchantInfo?: string;
}

export interface ClassificationResult {
  categoryId: string;
  categoryName: string;
  confidence: number;
  reasoning: string;
  alternativeSuggestions: Array<{
    categoryId: string;
    categoryName: string;
    confidence: number;
  }>;
  needsReview: boolean;
  source: 'ai' | 'rule' | 'historical' | 'heuristic';
}

/**
 * Build system prompt for transaction categorization
 */
function buildSystemPrompt(categories: Category[]): string {
  const incomeCategories = categories
    .filter(c => c.type === 'income')
    .map(c => `- ${c.name} (ID: ${c.id})`)
    .join('\n');
  
  const expenseCategories = categories
    .filter(c => c.type === 'expense')
    .map(c => `- ${c.name} (ID: ${c.id})`)
    .join('\n');
  
  return `You are an expert financial transaction classifier for accounting systems.

Your task is to analyze transaction descriptions and categorize them accurately.

Available INCOME categories:
${incomeCategories || '(none)'}

Available EXPENSE categories:
${expenseCategories || '(none)'}

When analyzing a transaction:
1. Identify the merchant/payee from the description
2. Determine the likely nature of the transaction
3. Select the most appropriate category from the list above
4. Provide a confidence score (0-100) based on clarity of the description
5. Suggest up to 2 alternative categories if applicable

Respond in JSON format:
{
  "categoryId": "cat-xxx",
  "categoryName": "Category Name",
  "confidence": 85,
  "reasoning": "Brief explanation of why this category fits",
  "alternatives": [
    {"categoryId": "cat-yyy", "categoryName": "Alternative", "confidence": 70}
  ]
}

Rules:
- Use the exact categoryId from the list above
- Confidence below 60 indicates uncertainty
- Be conservative: lower confidence for ambiguous transactions
- Consider transaction type (debit/credit) when selecting categories`;
}

/**
 * Build user prompt for a specific transaction
 */
function buildUserPrompt(request: ClassificationRequest): string {
  const typeLabel = request.type === 'debit' ? 'Expense (money out)' : 'Income (money in)';
  
  let prompt = `Categorize this transaction:

Description: "${request.narration}"
Amount: ${request.amount}
Type: ${typeLabel}`;
  
  if (request.date) {
    prompt += `\nDate: ${request.date}`;
  }
  
  if (request.merchantInfo) {
    prompt += `\nMerchant: ${request.merchantInfo}`;
  }
  
  return prompt;
}

/**
 * Parse AI response and map to our format
 */
function parseAIResponse(
  response: string,
  categories: Category[]
): Omit<ClassificationResult, 'needsReview' | 'source'> {
  try {
    // Try to parse JSON response
    const data = JSON.parse(response);
    
    // Validate category exists
    const category = categories.find(c => c.id === data.categoryId);
    if (!category) {
      throw new Error(`Category ${data.categoryId} not found`);
    }
    
    return {
      categoryId: data.categoryId,
      categoryName: data.categoryName || category.name,
      confidence: Math.min(100, Math.max(0, data.confidence || 0)),
      reasoning: data.reasoning || 'AI classification',
      alternativeSuggestions: (data.alternatives || [])
        .slice(0, 3)
        .map((alt: any) => ({
          categoryId: alt.categoryId,
          categoryName: alt.categoryName,
          confidence: Math.min(100, Math.max(0, alt.confidence || 0)),
        }))
        .filter((alt: any) => categories.some(c => c.id === alt.categoryId)),
    };
  } catch (error) {
    console.error('Failed to parse AI response:', error);
    throw new Error('Invalid AI response format');
  }
}

/**
 * Call AI API for classification
 */
export async function classifyWithAI(
  request: ClassificationRequest,
  categories: Category[],
  config: AIProviderConfig
): Promise<ClassificationResult> {
  const startTime = Date.now();
  
  try {
    const systemPrompt = buildSystemPrompt(categories);
    const userPrompt = buildUserPrompt(request);
    
    const url = buildApiUrl(config);
    const headers = getProviderHeaders(config);
    
    // Build request body (OpenAI format)
    const body = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature || 0.3,
      max_tokens: config.maxTokens || 500,
      response_format: { type: 'json_object' }, // Force JSON response
    };
    
    console.log(`🤖 Calling AI API: ${config.providerName} (${config.modelName})`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Extract content from OpenAI format
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content in AI response');
    }
    
    const parsed = parseAIResponse(content, categories);
    
    const duration = Date.now() - startTime;
    console.log(`✅ AI classification completed in ${duration}ms (confidence: ${parsed.confidence}%)`);
    
    return {
      ...parsed,
      needsReview: parsed.confidence < 60,
      source: 'ai',
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ AI classification failed after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Batch classify multiple transactions
 */
export async function batchClassifyWithAI(
  requests: ClassificationRequest[],
  categories: Category[],
  config: AIProviderConfig
): Promise<Map<number, ClassificationResult>> {
  const results = new Map<number, ClassificationResult>();
  
  console.log(`🤖 Batch classifying ${requests.length} transactions...`);
  
  // Process in parallel with rate limiting
  const BATCH_SIZE = 5; // Adjust based on rate limits
  
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (req, batchIndex) => {
      try {
        const result = await classifyWithAI(req, categories, config);
        results.set(i + batchIndex, result);
      } catch (error) {
        console.error(`Failed to classify transaction ${i + batchIndex}:`, error);
        // Set a fallback result
        results.set(i + batchIndex, {
          categoryId: '',
          categoryName: 'Uncategorized',
          confidence: 0,
          reasoning: 'AI classification failed',
          alternativeSuggestions: [],
          needsReview: true,
          source: 'ai',
        });
      }
    });
    
    await Promise.all(batchPromises);
    
    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < requests.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`✅ Batch classification complete: ${results.size}/${requests.length} successful`);
  
  return results;
}

/**
 * Test AI connection
 */
export async function testAIConnection(config: AIProviderConfig): Promise<{
  success: boolean;
  latency?: number;
  error?: string;
  model?: string;
}> {
  const startTime = Date.now();
  
  try {
    const url = buildApiUrl(config);
    const headers = getProviderHeaders(config);
    
    const body = {
      model: config.modelName,
      messages: [
        { role: 'user', content: 'Hello, respond with just "OK"' },
      ],
      max_tokens: 10,
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    const latency = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        latency,
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
      };
    }
    
    const data = await response.json();
    
    return {
      success: true,
      latency,
      model: data.model || config.modelName,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      latency,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract merchant name from transaction description
 * This helps improve AI accuracy
 */
export function extractMerchantName(narration: string): string {
  // Remove common prefixes
  let merchant = narration
    .replace(/^(DEPOSIT|PAYMENT|TRANSFER|WITHDRAWAL|POS|ATM)\s*[-:]?\s*/i, '')
    .trim();
  
  // Extract merchant from common formats
  // Format: "MERCHANT NAME - LOCATION"
  const dashIndex = merchant.indexOf(' - ');
  if (dashIndex > 0) {
    merchant = merchant.substring(0, dashIndex).trim();
  }
  
  // Format: "MERCHANT NAME, LOCATION"
  const commaIndex = merchant.indexOf(',');
  if (commaIndex > 0) {
    merchant = merchant.substring(0, commaIndex).trim();
  }
  
  // Remove transaction IDs (alphanumeric strings after asterisk)
  merchant = merchant.replace(/\*[A-Z0-9]+$/i, '').trim();
  
  return merchant;
}
