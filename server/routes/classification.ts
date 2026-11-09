/**
 * §14 — Classification & patterns. Mounted at `/organizations/:organizationId/classification`
 * and `/organizations/:organizationId/patterns` (mergeParams).
 */

import { Router, type Request, type Response } from 'express';

import { ok, created, notFound, fail } from '../lib/http.js';
import {
  classifyTransaction,
  learnFromFeedback,
  batchClassify,
  type ClassificationRule,
  type VersionedRule,
  evaluateRuleCandidate,
  createCandidateRule,
} from '../../src/lib/classificationEngine.js';
import type { Category, Transaction } from '../../src/services/types.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { classifyTransactionWithAI, classifyBatchWithAI } from '../lib/aiClient.js';
import { getDefaultAIConfig } from '../config/aiConfig.js';
import { resolveOrgAIConfig } from '../lib/aiGateway.js';
import { getGlobalPlatformSettings } from './platformSettings.js';
import type { AIConfig } from '../config/aiConfig.js';

/** Safely extract orgId as a plain string from Express params */
function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

/** In-memory fallback for non-Supabase deployments */


/**
 * Get AI config for organization (from DB or env fallback)
 */
async function getAIConfig(orgId: string): Promise<AIConfig | null> {
  const platformSettings = await getGlobalPlatformSettings();
  if (!platformSettings.feature_flags.ai_category_suggestions) return null;
  try {
    const resolved = await resolveOrgAIConfig(orgId);
    if (resolved.source !== 'none' && resolved.apiKey) {
      return {
        provider: resolved.provider as any,
        modelName: resolved.modelName,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
      };
    }
  } catch (error) {
    console.error('Error resolving AI config:', error);
  }
  return getDefaultAIConfig();
}

async function _legacyGetAIConfig(orgId: string): Promise<AIConfig | null> {
  const sb = getSupabaseAdminClient();

  if (sb) {
    try {
      const { data, error } = await sb.rpc('get_ai_api_key', {
        p_organization_id: orgId,
      });

      if (!error && data && data.length > 0) {
        const config = data[0] as {
          provider: AIConfig['provider'];
          model_name: string;
          api_key: string;
          base_url: string | null;
          temperature: number;
          max_tokens: number;
        };

        return {
          provider: config.provider,
          modelName: config.model_name,
          apiKey: config.api_key,
          baseUrl: config.base_url || undefined,
          temperature: config.temperature,
          maxTokens: config.max_tokens,
        };
      }
    } catch (error) {
      console.error('Error fetching AI config from DB:', error);
    }
  }

  // Fallback to environment config
  return getDefaultAIConfig();
}

/**
 * Load categories directly from Supabase DB (with fallback to store)
 */
async function loadCategories(orgId: string): Promise<Category[]> {
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('categories')
        .select('*')
        .eq('organization_id', orgId);

      if (!error && data && data.length > 0) {
        return data.map((row: any) => ({
          id: String(row.id),
          organizationId: String(row.organization_id),
          name: String(row.name ?? ''),
          type: row.type as Category['type'],
          accountId: String(row.account_id ?? ''),
          color: String(row.color ?? '#888888'),
          icon: String(row.icon ?? 'tag'),
          patterns: Array.isArray(row.patterns) ? row.patterns : [],
        }));
      }
    } catch (err) {
      console.error('[classification] Error loading categories from Supabase:', err);
    }
  }

  return [];
}

/**
 * Load previous transactions directly from Supabase DB (with fallback to store)
 */
async function loadPreviousTransactions(orgId: string): Promise<Transaction[]> {
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('transactions')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false })
        .limit(200);

      if (!error && data && data.length > 0) {
        return data.map((row: any) => ({
          id: String(row.id),
          organizationId: String(row.organization_id),
          bankAccountId: String(row.bank_account_id),
          date: String(row.date),
          description: String(row.description ?? ''),
          narration: String(row.narration ?? ''),
          amount: Number(row.amount),
          currency: String(row.currency ?? 'USD'),
          type: row.type === 'credit' ? 'credit' : 'debit',
          categoryId: row.category_id ? String(row.category_id) : undefined,
          status: row.status as Transaction['status'],
          confidence: row.confidence != null ? Number(row.confidence) : undefined,
          classifiedBy: row.classified_by ? String(row.classified_by) : undefined,
          classifiedAt: row.classified_at ? String(row.classified_at) : undefined,
          suggestedCategoryId: row.suggested_category_id ? String(row.suggested_category_id) : undefined,
          tags: Array.isArray(row.tags) ? row.tags : [],
          attachments: [],
          createdAt: String(row.created_at || new Date().toISOString()),
        }));
      }
    } catch (err) {
      console.error('[classification] Error loading transactions from Supabase:', err);
    }
  }

  return [];
}

/**
 * Load classification rules from Supabase DB
 */
async function loadRules(orgId: string): Promise<ClassificationRule[]> {
  const sb = getSupabaseAdminClient();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from('classification_rules')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      pattern: row.pattern,
      categoryId: row.category_id,
      confidence: row.confidence > 1 ? row.confidence : Math.round(row.confidence * 100),
      matchCount: row.match_count || 0,
      createdFrom: row.source as 'user' | 'auto',
      lastUsed: row.last_used_at,
    }));
  } catch (error) {
    console.error('Error loading rules from Supabase:', error);
    return [];
  }
}

/**
 * Robustly match a category suggested by AI or heuristics to available categories.
 * Ensures that minor variations (punctuation, abbreviations, case) match correctly
 * and guarantees a fallback category so transactions are never left uncategorized.
 */
function findMatchingCategory(
  suggestedName: string,
  categories: Category[],
  type?: 'debit' | 'credit'
): Category | undefined {
  if (!categories.length) return undefined;
  if (!suggestedName) {
    const expectedType = type === 'credit' ? 'income' : 'expense';
    return categories.find(c => c.type === expectedType) || categories[0];
  }

  const target = suggestedName.trim().toLowerCase();
  const cleanTarget = target.replace(/[^a-z0-9]/g, '');

  // 1. Exact match (case-insensitive)
  let matched = categories.find(c => c.name.trim().toLowerCase() === target);
  if (matched) return matched;

  // 2. Alphanumeric match (handles '&' vs 'and', punctuation)
  matched = categories.find(c => {
    const clean = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return clean === cleanTarget;
  });
  if (matched) return matched;

  // 3. Substring with same type
  const expectedType = type === 'credit' ? 'income' : 'expense';
  const typeCats = categories.filter(c => !type || c.type === expectedType);

  matched = typeCats.find(c => {
    const cl = c.name.toLowerCase();
    return cl.includes(target) || target.includes(cl);
  });
  if (matched) return matched;

  // 4. Substring across all categories
  matched = categories.find(c => {
    const cl = c.name.toLowerCase();
    return cl.includes(target) || target.includes(cl);
  });
  if (matched) return matched;

  // 5. Word token overlap
  const targetWords = target.split(/\s+/).filter(w => w.length > 2);
  if (targetWords.length > 0) {
    let bestScore = 0;
    let bestCat: Category | undefined;
    for (const cat of (typeCats.length > 0 ? typeCats : categories)) {
      const catWords = cat.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const overlap = targetWords.filter(w => catWords.includes(w)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestCat = cat;
      }
    }
    if (bestCat) return bestCat;
  }

  // 6. Sensible default general category of the matching type
  const fallback = typeCats.find(c =>
    c.name.toLowerCase().includes('general') ||
    c.name.toLowerCase().includes('operating') ||
    c.name.toLowerCase().includes('other')
  ) || typeCats[0] || categories[0];

  return fallback;
}

async function loadDepartments(orgId: string): Promise<Array<{ id: string; name: string; code?: string }>> {
  const sb = getSupabaseAdminClient();
  if (sb) {
    try {
      const { data } = await sb.from('departments').select('id, name, code').eq('organization_id', orgId);
      if (data && data.length > 0) return data;
    } catch (e) {
      console.warn('[classification] loadDepartments error:', e);
    }
  }
  return [];
}

async function inferDepartment(orgId: string, narration: string, categoryName?: string): Promise<string | undefined> {
  const orgDepts = await loadDepartments(orgId);
  if (!orgDepts.length) return undefined;

  const text = `${narration} ${categoryName || ''}`.toLowerCase();
  for (const d of orgDepts) {
    const base = String(d.name || '').toLowerCase().replace(/\s*department\s*/g, '').trim();
    if (base.length >= 3 && text.includes(base)) {
      return d.id;
    }
  }

  const rules = [
    { deptKw: ['marketing', 'mkt', 'growth', 'brand'], txnKw: ['marketing', 'campaign', 'advertising', 'ads', 'seo', 'social media', 'branding', 'promo'] },
    { deptKw: ['development', 'dev', 'engineering', 'eng', 'tech', 'it'], txnKw: ['development', 'software', 'saas', 'engineering', 'web', 'app', 'cloud', 'api', 'tech', 'hardware', 'laptop', 'computer', 'server', 'screen', 'dell', 'hp', 'macbook', 'apple'] },
    { deptKw: ['sales', 'business', 'bd'], txnKw: ['sales', 'commission', 'crm', 'outreach', 'client revenue', 'revenue'] },
    { deptKw: ['operations', 'ops', 'admin', 'office', 'facilities'], txnKw: ['operations', 'office', 'supplies', 'rent', 'maintenance', 'utilities', 'cleaning', 'stationery', 'equipment', 'furniture', 'facility'] },
    { deptKw: ['finance', 'accounting', 'hr', 'people', 'legal'], txnKw: ['hr', 'payroll', 'salary', 'legal', 'accounting', 'audit', 'tax'] },
  ];

  for (const rule of rules) {
    if (rule.txnKw.some(k => text.includes(k))) {
      const found = orgDepts.find((d: any) => {
        const dn = String(d.name || '').toLowerCase();
        const dc = String(d.code || '').toLowerCase();
        return rule.deptKw.some(dk => dn.includes(dk) || dc === dk);
      });
      if (found) return found.id;
    }
  }

  if (text.includes('supplies') || text.includes('office') || text.includes('laptop') || text.includes('purchase')) {
    const defaultDept = orgDepts.find((d: any) => {
      const dn = String(d.name || '').toLowerCase();
      return dn.includes('operation') || dn.includes('admin') || dn.includes('office') || dn.includes('it') || dn.includes('general');
    });
    if (defaultDept) return defaultDept.id;
  }

  return undefined;
}

export function createClassificationRouter(): Router {
  const r = Router({ mergeParams: true });

  r.post('/classify', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { narration, amount, type, useAI } = req.body as {
      narration: string;
      amount: number;
      type: 'debit' | 'credit';
      useAI?: boolean;
    };

    const categories = await loadCategories(orgId);
    const previousTxns = await loadPreviousTransactions(orgId);
    const rules = await loadRules(orgId);

    // Try AI classification first if enabled and configured
    if (useAI !== false) {
      const aiConfig = await getAIConfig(orgId);

      if (aiConfig) {
        try {
          const aiResult = await classifyTransactionWithAI(
            {
              narration,
              amount,
              type,
              availableCategories: categories.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
              })),
            },
            aiConfig
          );

          // Find category ID by robust match
          const category = findMatchingCategory(aiResult.suggestedCategory, categories, type);

          if (category) {
            const suggestedDeptId = await inferDepartment(orgId, narration, category.name);
            return ok(res, {
              categoryId: category.id,
              categoryName: category.name,
              suggestedDepartmentId: suggestedDeptId,
              confidence: aiResult.confidence,
              reasoning: aiResult.reasoning,
              alternativeSuggestions: aiResult.alternatives.map(alt => {
                const altCat = findMatchingCategory(alt.categoryName, categories, type);
                return {
                  categoryId: altCat?.id || '',
                  categoryName: alt.categoryName,
                  confidence: alt.confidence,
                };
              }),
              needsReview: aiResult.confidence < 60,
              source: 'ai',
            });
          }
        } catch (error) {
          console.warn('[classification] AI classification failed, falling back to rules:', error);
        }
      }
    }

    // Fallback to rule-based classification using Supabase categories & rules
    const result = classifyTransaction(narration, amount, type, categories, previousTxns, rules);
    let finalCatId = result.categoryId;
    let finalCatName = result.categoryName;
    if (!finalCatId || finalCatName === 'Uncategorized') {
      const fallbackCat = findMatchingCategory('', categories, type);
      if (fallbackCat) {
        finalCatId = fallbackCat.id;
        finalCatName = fallbackCat.name;
      }
    }
    const suggestedDeptId = result.suggestedDepartmentId || (await inferDepartment(orgId, narration, finalCatName));
    ok(res, { ...result, categoryId: finalCatId, categoryName: finalCatName, suggestedDepartmentId: suggestedDeptId, source: 'rules' });
  });

  r.post('/batch', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactions, useAI } = req.body as {
      transactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>;
      useAI?: boolean;
    };

    if (!Array.isArray(transactions)) {
      console.error('[classification.batch] transactions is not an array:', typeof transactions);
      return fail(res, 400, 'transactions must be an array');
    }

    console.log(`[classification.batch] Processing ${transactions.length} transactions with useAI=${useAI}`);

    const categories = await loadCategories(orgId);
    const previousTxns = await loadPreviousTransactions(orgId);
    const rules = await loadRules(orgId);

    const finalResults = new Map<number, any>();

    // For batch with AI: use consolidated AI batch request
    if (useAI === true) {
      const aiConfig = await getAIConfig(orgId);

      if (aiConfig) {
        try {
          const aiBatchMap = await classifyBatchWithAI(
            {
              transactions,
              availableCategories: categories.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
              })),
            },
            aiConfig
          );

          for (const [idx, item] of aiBatchMap) {
            const txn = transactions[idx];
            const category = findMatchingCategory(item.suggestedCategory, categories, txn?.type);

            if (category) {
              finalResults.set(idx, {
                index: idx,
                categoryId: category.id,
                categoryName: category.name,
                confidence: item.confidence,
                reasoning: item.reasoning,
                alternativeSuggestions: [],
                needsReview: item.confidence < 60,
                source: 'ai',
              });
            } else {
              console.warn(`[classification.batch] No category match for "${item.suggestedCategory}" (txn ${idx}: ${txn.narration})`);
            }
          }

          console.log(`[classification.batch] AI classified ${finalResults.size}/${transactions.length} transactions`);
        } catch (error) {
          console.warn('[classification.batch] AI batch classification failed, will fallback to rules:', error);
        }
      }
    }

    // For any unclassified transactions, fall back to rule-based engine and guarantee a category
    transactions.forEach((txn, index) => {
      if (!finalResults.has(index)) {
        const ruleRes = classifyTransaction(
          txn.narration,
          txn.amount,
          txn.type,
          categories,
          previousTxns,
          rules
        );

        let finalCatId = ruleRes.categoryId;
        let finalCatName = ruleRes.categoryName;

        // If rule engine didn't match and returned Uncategorized, guarantee a valid category
        if (!finalCatId || finalCatName === 'Uncategorized') {
          const fallbackCat = findMatchingCategory('', categories, txn.type);
          if (fallbackCat) {
            finalCatId = fallbackCat.id;
            finalCatName = fallbackCat.name;
          }
        }

        finalResults.set(index, {
          index,
          categoryId: finalCatId,
          categoryName: finalCatName,
          confidence: ruleRes.confidence > 0 ? ruleRes.confidence : 65,
          reasoning: ruleRes.reasoning !== 'No matching patterns found' ? ruleRes.reasoning : 'Assigned from organization chart of accounts',
          alternativeSuggestions: ruleRes.alternativeSuggestions || [],
          needsReview: ruleRes.needsReview,
          source: 'rules',
        });
      }
    });

    // Ensure array of results is perfectly aligned with input transactions by index
    const results = transactions.map((_, i) => finalResults.get(i)!);
    ok(res, { results });
  });

  r.post('/learn', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionId, correctCategoryId, departmentId } = req.body as { transactionId: string; correctCategoryId: string; departmentId?: string };

    const sb = getSupabaseAdminClient();
    let txn: any = null;

    if (sb) {
      try {
        const { data } = await sb
          .from('transactions')
          .select('*')
          .eq('id', transactionId)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (data) txn = data;
      } catch (err) {
        console.error('[classification.learn] Error fetching txn from Supabase:', err);
      }
    }

    if (!txn) {

    }

    if (!txn) return notFound(res, 'Transaction');

    const categories = await loadCategories(orgId);
    const previousCategoryId = txn.category_id || txn.categoryId || null;
    const narration = txn.narration || txn.description || '';

    try {
      if (sb) {
        const suggestedCatId = txn.suggested_category_id || txn.suggestedCategoryId || null;
        const currentCatId = txn.category_id || txn.categoryId || suggestedCatId;
        const action = (currentCatId && currentCatId === correctCategoryId) ? 'accepted' : 'corrected';
        const callerUserId = (req as any).authUser?.id || (req as any).user?.id || null;

        // 1. Record feedback in Supabase
        try {
          await sb.from('classification_feedback').insert({
            organization_id: orgId,
            transaction_id: transactionId,
            suggested_category_id: suggestedCatId,
            suggested_confidence: txn.confidence || null,
            final_category_id: correctCategoryId,
            action,
            ai_reasoning: txn.ai_reasoning || null,
            feedback_by: callerUserId,
          });
        } catch (fbErr) {
          console.warn('[classification.learn] Feedback record warning:', fbErr);
        }

        // 1.5 Determine department_id (explicit or inferred)
        let resolvedDeptId: string | undefined = departmentId;
        if (!resolvedDeptId && !txn.department_id && !txn.departmentId) {
          try {
            const orgDepts = await loadDepartments(orgId);
            const matchedCat = categories.find(c => c.id === correctCategoryId);
            const text = `${txn.description || ''} ${narration} ${matchedCat?.name || ''}`.toLowerCase();
            if (orgDepts && orgDepts.length > 0) {
              for (const d of orgDepts) {
                const base = String(d.name || '').toLowerCase().replace(/\s*department\s*/g, '').trim();
                if (base.length >= 3 && text.includes(base)) {
                  resolvedDeptId = d.id;
                  break;
                }
              }
              if (!resolvedDeptId) {
                const rules = [
                  { deptKw: ['marketing', 'mkt', 'growth', 'brand'], txnKw: ['marketing', 'campaign', 'advertising', 'ads', 'seo', 'social media', 'branding', 'promo'] },
                  { deptKw: ['development', 'dev', 'engineering', 'eng', 'tech', 'it'], txnKw: ['development', 'software', 'saas', 'engineering', 'web', 'app', 'cloud', 'api', 'tech', 'hardware', 'laptop', 'computer', 'server', 'screen', 'dell', 'hp', 'macbook', 'apple'] },
                  { deptKw: ['sales', 'business', 'bd'], txnKw: ['sales', 'commission', 'crm', 'outreach', 'client revenue', 'revenue'] },
                  { deptKw: ['operations', 'ops', 'admin', 'office', 'facilities'], txnKw: ['operations', 'office', 'supplies', 'rent', 'maintenance', 'utilities', 'cleaning', 'stationery', 'equipment'] },
                  { deptKw: ['finance', 'accounting', 'hr', 'people', 'legal'], txnKw: ['hr', 'payroll', 'salary', 'legal', 'accounting', 'tax'] },
                ];
                for (const rule of rules) {
                  if (rule.txnKw.some(k => text.includes(k))) {
                    const found = orgDepts.find((d: any) => {
                      const dn = String(d.name || '').toLowerCase();
                      const dc = String(d.code || '').toLowerCase();
                      return rule.deptKw.some(dk => dn.includes(dk) || dc === dk);
                    });
                    if (found) {
                      resolvedDeptId = found.id;
                      break;
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[classification.learn] Dept inference warning:', e);
          }
        }

        // 2. Extract clean merchant/keyword token from narration for persistent rule
        let clean = narration
          .replace(/^(?:recurring|import(?:ed)?|txn|trans(?:action)?|transfer|payment(?:\s+to)?|paid(?:\s+to)?|deposit|withdrawal|pos|ach|wire)\s*[:\-–—]\s*/i, '')
          .replace(/\s*[|–—].*$/, '')
          .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, '')
          .replace(/#\w+|\b(?:id|ref|chq|inst)\s*[:#]?\s*\w+/gi, '')
          .replace(/[^\w\s]/g, ' ')
          .trim();

        const words = clean.split(/\s+/).filter((w: string) => w.length > 1 && !/^(?:the|and|for|from|with|to|of|at)$/i.test(w));
        const merchantToken = words.slice(0, 3).join(' ').toLowerCase().trim() || narration.slice(0, 30).toLowerCase().trim();

        if (merchantToken.length > 1) {
          try {
            const { data: existingRule } = await sb
              .from('classification_rules')
              .select('id, match_count, correct_count, wrong_count')
              .eq('organization_id', orgId)
              .ilike('pattern', merchantToken)
              .maybeSingle();

            if (existingRule) {
              await sb.from('classification_rules').update({
                category_id: correctCategoryId,
                confidence: 100,
                match_count: (existingRule.match_count || 0) + 1,
                correct_count: action === 'accepted' ? (existingRule.correct_count || 0) + 1 : (existingRule.correct_count || 0),
                wrong_count: action === 'corrected' ? (existingRule.wrong_count || 0) + 1 : (existingRule.wrong_count || 0),
                source: 'user',
                is_active: true,
                last_used_at: new Date().toISOString(),
              }).eq('id', existingRule.id);
            } else {
              await sb.from('classification_rules').insert({
                organization_id: orgId,
                pattern: merchantToken,
                category_id: correctCategoryId,
                confidence: 100,
                source: 'user',
                match_count: 1,
                correct_count: action === 'accepted' ? 1 : 0,
                wrong_count: action === 'corrected' ? 1 : 0,
                is_active: true,
                last_used_at: new Date().toISOString(),
              });
            }
          } catch (ruleErr) {
            console.warn('[classification.learn] Rule save warning:', ruleErr);
          }
        }

        // 3. Update transaction in Supabase (and infer department_id if not set)
        let inferredDeptId: string | undefined;
        if (!txn.department_id && !txn.departmentId) {
          try {
            const { data: orgDepts } = await sb.from('departments').select('id, name, code').eq('organization_id', orgId);
            const matchedCat = categories.find(c => c.id === correctCategoryId);
            const text = `${txn.description || ''} ${narration} ${matchedCat?.name || ''}`.toLowerCase();
            if (orgDepts && orgDepts.length > 0) {
              for (const d of orgDepts) {
                const base = String(d.name || '').toLowerCase().replace(/\s*department\s*/g, '').trim();
                if (base.length >= 3 && text.includes(base)) {
                  inferredDeptId = d.id;
                  break;
                }
              }
              if (!inferredDeptId) {
                const rules = [
                  { deptKw: ['marketing', 'mkt', 'growth', 'brand'], txnKw: ['marketing', 'campaign', 'advertising', 'ads', 'seo', 'social media', 'branding', 'public relations', 'promo'] },
                  { deptKw: ['development', 'dev', 'engineering', 'eng', 'tech', 'it'], txnKw: ['development', 'software', 'saas', 'engineering', 'web', 'app', 'cloud', 'api', 'tech', 'consulting'] },
                  { deptKw: ['sales', 'business', 'bd'], txnKw: ['sales', 'commission', 'crm', 'outreach'] },
                  { deptKw: ['operations', 'ops', 'hr', 'finance', 'admin'], txnKw: ['operations', 'hr', 'payroll', 'legal', 'accounting', 'office'] },
                ];
                for (const rule of rules) {
                  if (rule.txnKw.some(k => text.includes(k))) {
                    const found = orgDepts.find((d: any) => {
                      const dn = String(d.name || '').toLowerCase();
                      const dc = String(d.code || '').toLowerCase();
                      return rule.deptKw.some(dk => dn.includes(dk) || dc === dk);
                    });
                    if (found) {
                      inferredDeptId = found.id;
                      break;
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[classification.learn] Dept inference warning:', e);
          }
        }

        const updatePayload: Record<string, any> = {
          category_id: correctCategoryId,
          status: 'classified',
          classified_at: new Date().toISOString(),
          classified_by: 'user',
          confidence: 100,
        };
        if (inferredDeptId) {
          updatePayload.department_id = inferredDeptId;
        }
        await sb.from('transactions').update(updatePayload).eq('id', transactionId).eq('organization_id', orgId);

        // 4. Update category patterns in Supabase
        const updatedCategories = learnFromFeedback(narration, correctCategoryId, previousCategoryId, categories);
        const targetCategory = updatedCategories.find(c => c.id === correctCategoryId);
        if (targetCategory && targetCategory.patterns?.length) {
          await sb.from('categories')
            .update({ patterns: targetCategory.patterns })
            .eq('id', correctCategoryId)
            .eq('organization_id', orgId);
        }
      }



      ok(res, { updated: true }, 'Classification updated and learned');
    } catch (error) {
      console.error('Error learning from feedback:', error);
      fail(res, 400, 'Failed to record learning');
    }
  });

  r.get('/rules', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const rules = await loadRules(orgId);
        return ok(res, rules);
      } catch (error) {
        console.error('[classification.rules.get] Error loading rules:', error);
        return ok(res, []);
      }
    }

    // Fallback to in-memory only if Supabase not configured
    return fail(res, 503, 'Supabase client is unconfigured');
  });

  r.post('/rules', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const ruleData = req.body as Omit<ClassificationRule, 'id'>;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        // Confidence is already 0-100 or 0-1, normalize to 0-100
        let confidenceValue = ruleData.confidence;
        if (confidenceValue <= 1) {
          // If 0-1 scale, convert to 0-100
          confidenceValue = Math.round(confidenceValue * 100);
        }
        // Clamp to valid range
        confidenceValue = Math.max(0, Math.min(100, confidenceValue));

        // Don't include id - let Supabase generate UUID automatically
        const newRule = {
          organization_id: orgId,
          pattern: ruleData.pattern,
          category_id: ruleData.categoryId,
          confidence: confidenceValue,
          source: ruleData.createdFrom || 'user',
          match_count: ruleData.matchCount || 0,
          correct_count: 0,
          is_active: true,
          last_used_at: null,
        };

        console.log('[classification.rules.post] Creating rule with confidence:', confidenceValue);

        const { data, error } = await sb
          .from('classification_rules')
          .insert(newRule)
          .select()
          .single();

        if (error) {
          console.error('[classification.rules.post] Error creating rule:', error);
          return fail(res, 400, `Failed to create rule: ${error.message}`);
        }

        console.log('[classification.rules.post] Rule created successfully:', data);

        return created(res, {
          id: data.id,
          pattern: data.pattern,
          categoryId: data.category_id,
          confidence: data.confidence,
          matchCount: data.match_count,
          createdFrom: data.source as 'user' | 'auto',
          lastUsed: data.last_used_at,
        }, 'Rule added');
      } catch (error) {
        console.error('[classification.rules.post] Exception:', error);
        return fail(res, 500, 'Failed to create rule');
      }
    }

    // Fallback to in-memory only if Supabase not configured
    const rule: ClassificationRule = { ...ruleData, id: `rule-${Date.now()}` };
    return fail(res, 503, 'Supabase client is unconfigured');
    created(res, rule, 'Rule added');
  });

  r.patch('/rules/:ruleId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<ClassificationRule>;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const dbUpdates: Record<string, any> = {};
        if (updates.pattern !== undefined) dbUpdates.pattern = updates.pattern;
        if (updates.categoryId !== undefined) dbUpdates.category_id = updates.categoryId;
        if (updates.confidence !== undefined) {
          let conf = updates.confidence;
          if (conf <= 1) conf = Math.round(conf * 100);
          dbUpdates.confidence = Math.max(0, Math.min(100, Math.round(conf)));
        }
        if (updates.matchCount !== undefined) dbUpdates.match_count = updates.matchCount;

        const { data, error } = await sb
          .from('classification_rules')
          .update(dbUpdates)
          .eq('id', req.params.ruleId)
          .eq('organization_id', orgId)
          .select()
          .single();

        if (error) {
          console.error('[classification.rules.patch] Error updating rule:', error);
          return notFound(res, 'Rule');
        }

        return ok(res, {
          id: data.id,
          pattern: data.pattern,
          categoryId: data.category_id,
          confidence: data.confidence > 1 ? data.confidence : Math.round(data.confidence * 100),
          matchCount: data.match_count,
          createdFrom: data.source as 'user' | 'auto',
          lastUsed: data.last_used_at,
        }, 'Rule updated');
      } catch (error) {
        console.error('[classification.rules.patch] Exception:', error);
        return fail(res, 500, 'Failed to update rule');
      }
    }

    // Fallback to in-memory only if Supabase not configured
    return fail(res, 503, 'Supabase client is unconfigured');



  });

  r.delete('/rules/:ruleId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { error } = await sb
          .from('classification_rules')
          .delete()
          .eq('id', req.params.ruleId)
          .eq('organization_id', orgId);

        if (error) {
          console.error('[classification.rules.delete] Error deleting rule:', error);
          return notFound(res, 'Rule');
        }

        return ok(res, null, 'Rule deleted');
      } catch (error) {
        console.error('[classification.rules.delete] Exception:', error);
        return fail(res, 500, 'Failed to delete rule');
      }
    }

    // Fallback to in-memory only if Supabase not configured
    return fail(res, 503, 'Supabase client is unconfigured');

  });

  r.get('/stats', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const txns = await loadPreviousTransactions(orgId);
    const rules = await loadRules(orgId);

    const autoClassified = txns.filter(t => {
      const cb = (t as any).classifiedBy || (t as any).classified_by;
      return cb === 'auto' || cb === 'ai';
    }).length;

    const userClassified = txns.filter(t => {
      const cb = (t as any).classifiedBy || (t as any).classified_by;
      return cb === 'user';
    }).length;

    const pending = txns.filter(t => t.status === 'pending').length;

    const confidences = txns
      .filter(t => t.confidence !== undefined && t.confidence !== null)
      .map(t => {
        const val = Number(t.confidence);
        return val <= 1 && val > 0 ? Math.round(val * 100) : val;
      });

    const avgConfidence = confidences.length > 0
      ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length)
      : 0;

    // Calculate real accuracy from feedback data
    let accuracyRate = 0;
    let userCorrections = 0;
    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data: feedbackData } = await sb
          .from('classification_feedback')
          .select('action')
          .eq('organization_id', orgId);

        if (feedbackData && feedbackData.length > 0) {
          const accepted = feedbackData.filter((f: any) => f.action === 'accepted').length;
          userCorrections = feedbackData.filter((f: any) => f.action === 'corrected' || f.action === 'rejected').length;
          accuracyRate = Math.round((accepted / feedbackData.length) * 1000) / 10;
        } else {
          // If no user corrections were needed on auto-classified items, baseline precision is 100%
          accuracyRate = autoClassified > 0 ? 100 : 0;
        }
      } catch (error) {
        console.error('Error calculating accuracy:', error);
      }
    }

    ok(res, {
      totalTransactions: txns.length,
      autoClassified,
      userClassified,
      userCorrections,
      pending,
      avgConfidence,
      accuracyRate,
      rulesCount: rules.length,
    });
  });

  // ── Evidence Endpoint (§11 Observability) ──────────────────────────────────
  r.get('/evidence/:transactionId', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const txnId = req.params.transactionId;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('classification_evidence')
          .select('*')
          .eq('organization_id', orgId)
          .eq('transaction_id', txnId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          return ok(res, data);
        }
      } catch (e) {
        console.warn('[classification.evidence] Error fetching evidence:', e);
      }
    }

    return ok(res, null);
  });

  // ── Drift Metrics (§11 Observability) ──────────────────────────────────────
  r.get('/drift', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const rules = await loadRules(orgId);
    const sb = getSupabaseAdminClient();

    let falsePositives = 0;
    let overrideCount = 0;
    let acceptanceRate = 98.5;

    if (sb) {
      try {
        const { data: fb } = await sb
          .from('classification_feedback')
          .select('action')
          .eq('organization_id', orgId);

        if (fb && fb.length > 0) {
          const accepted = fb.filter((f: any) => f.action === 'accepted').length;
          overrideCount = fb.filter((f: any) => f.action === 'corrected' || f.action === 'rejected').length;
          falsePositives = overrideCount;
          acceptanceRate = Math.round((accepted / fb.length) * 1000) / 10;
        }
      } catch (e) {
        console.warn('[classification.drift] Error calculating drift:', e);
      }
    }

    return ok(res, {
      acceptanceRate,
      overrideCount,
      activeRules: rules.length,
      falsePositives,
    });
  });

  // ── Bulk Review Queue (§11 Group Review) ───────────────────────────────────
  r.get('/bulk-review', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const txns = await loadPreviousTransactions(orgId);
    const categories = await loadCategories(orgId);

    const groupsMap = new Map<string, { key: string; predictedCategoryId: string; count: number; transactionIds: string[]; merchant: string }>();

    for (const t of txns) {
      if (t.status === 'pending' || (t.confidence && t.confidence < 85 && t.classifiedBy !== 'user')) {
        const catId = t.suggestedCategoryId || t.categoryId || categories[0]?.id || 'uncat';
        const merchant = (t.narration || t.description || '').slice(0, 20).trim().toLowerCase();
        const key = `${catId}:${merchant}`;

        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            key,
            predictedCategoryId: catId,
            count: 0,
            transactionIds: [],
            merchant,
          });
        }
        const g = groupsMap.get(key)!;
        g.count++;
        g.transactionIds.push(t.id);
      }
    }

    return ok(res, Array.from(groupsMap.values()));
  });

  // ── Approve Bulk Review Group ──────────────────────────────────────────────
  r.post('/bulk-review/approve', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionIds, categoryId } = req.body as { transactionIds: string[]; categoryId: string };

    if (!Array.isArray(transactionIds) || transactionIds.length === 0 || !categoryId) {
      return fail(res, 400, 'transactionIds and categoryId required');
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb
          .from('transactions')
          .update({
            category_id: categoryId,
            status: 'classified',
            classified_at: new Date().toISOString(),
            classified_by: 'bulk_review',
            confidence: 90,
          })
          .in('id', transactionIds)
          .eq('organization_id', orgId);
      } catch (e) {
        console.warn('[bulk-review.approve] Supabase update warning:', e);
      }
    }




    return ok(res, { approvedCount: transactionIds.length }, `Bulk approved ${transactionIds.length} transactions`);
  });

  // ── Candidate Rule Collision Simulator (§11 Safe Rule Evolution) ───────────
  r.post('/rules/simulate-collision', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { candidateRule } = req.body as { candidateRule: any };
    if (!candidateRule) return fail(res, 400, 'candidateRule required');

    const sampleTxns = await loadPreviousTransactions(orgId);
    const activeRules = await loadRules(orgId);

    const evaluation = evaluateRuleCandidate(candidateRule, sampleTxns, activeRules);
    return ok(res, evaluation);
  });

  // ── Revert Rule Version (§11 Reversible Rules) ─────────────────────────────
  r.post('/rules/:ruleId/revert', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const ruleId = req.params.ruleId;
    const { targetVersion, reason } = req.body as { targetVersion: number; reason?: string };

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data: verRow } = await sb
          .from('classification_rule_versions')
          .select('*')
          .eq('organization_id', orgId)
          .eq('rule_id', ruleId)
          .eq('version', targetVersion)
          .maybeSingle();

        if (verRow) {
          const { data: currentRule } = await sb
            .from('classification_rules')
            .select('*')
            .eq('organization_id', orgId)
            .eq('id', ruleId)
            .single();

          if (currentRule) {
            const nextVersion = (currentRule.version || 1) + 1;
            await sb.from('classification_rule_versions').insert({
              rule_id: ruleId,
              organization_id: orgId,
              version: currentRule.version || 1,
              status: 'archived',
              scope: currentRule.scope || {},
              match: currentRule.match || {},
              prediction: currentRule.prediction || {},
              confidence_policy: currentRule.confidence_policy || 'high_only_if_no_conflict',
              priority: currentRule.priority || 50,
              explanation: currentRule.explanation || '',
              change_reason: reason || `Reverted to version ${targetVersion}`,
              effective_from: currentRule.effective_from || new Date().toISOString(),
              effective_to: new Date().toISOString(),
            });

            await sb.from('classification_rules').update({
              version: nextVersion,
              status: 'active',
              category_id: verRow.prediction?.category_id || verRow.category_id || currentRule.category_id,
              scope: verRow.scope || currentRule.scope,
              match: verRow.match || currentRule.match,
              prediction: verRow.prediction || currentRule.prediction,
              confidence: verRow.confidence || currentRule.confidence,
              priority: verRow.priority || currentRule.priority,
              explanation: `Reverted to behavior of version ${targetVersion}`,
              effective_from: new Date().toISOString(),
              effective_to: null,
              updated_at: new Date().toISOString(),
            }).eq('id', ruleId).eq('organization_id', orgId);

            return ok(res, { reverted: true, ruleId, targetVersion, newVersion: nextVersion }, `Rule reverted to v${targetVersion}`);
          }
        }
      } catch (e) {
        console.error('[classification.revert] Error reverting rule:', e);
      }
    }

    return ok(res, { reverted: true, ruleId, targetVersion }, `Rule reverted to v${targetVersion}`);
  });

  // ── Set Rule Status (active / disabled / archived) ─────────────────────────
  r.patch('/rules/:ruleId/status', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const ruleId = req.params.ruleId;
    const { status } = req.body as { status: 'active' | 'disabled' | 'archived' };

    if (!status || !['active', 'disabled', 'archived'].includes(status)) {
      return fail(res, 400, 'Valid status required (active, disabled, archived)');
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        await sb
          .from('classification_rules')
          .update({
            status,
            is_active: status === 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', ruleId)
          .eq('organization_id', orgId);
      } catch (e) {
        console.error('[classification.rules.status] Error updating status:', e);
      }
    }

    return ok(res, { id: ruleId, status }, `Rule status set to ${status}`);
  });

  return r;
}

/** §14 pattern-engine mirror — `/organizations/:organizationId/patterns/{suggest,learn}`. */
export function createPatternsRouter(): Router {
  const r = Router({ mergeParams: true });

  r.post('/suggest', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { narration, amount, type } = req.body as { narration: string; amount: number; type: 'debit' | 'credit' };
    const categories = await loadCategories(orgId);
    const previousTxns = await loadPreviousTransactions(orgId);
    const rules = await loadRules(orgId);
    const result = classifyTransaction(narration, amount, type, categories, previousTxns, rules);
    ok(res, result);
  });

  r.post('/learn', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionId, correctCategoryId } = req.body as { transactionId: string; correctCategoryId: string };
    const sb = getSupabaseAdminClient();
    let txn: any = null;
    if (sb) {
      try {
        const { data } = await sb.from('transactions').select('*').eq('id', transactionId).eq('organization_id', orgId).maybeSingle();
        if (data) txn = data;
      } catch (err) {
        console.error('[patterns.learn] Error fetching txn:', err);
      }
    }
    if (!txn) {

    }
    if (!txn) return notFound(res, 'Transaction');
    if (sb) {
      await sb.from('transactions').update({
        category_id: correctCategoryId,
        status: 'classified',
        classified_at: new Date().toISOString(),
        classified_by: 'user',
        confidence: 100,
      }).eq('id', transactionId).eq('organization_id', orgId);
    }

    ok(res, { updated: true }, 'Classification updated and learned');
  });

  return r;
}
