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
  detectRiskFlags,
  inferWorldScope,
  suggestMissingCategorySpec,
  type ClassificationRule,
  type VersionedRule,
  type ProposedNewCategory,
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
import { requireOrgRole } from '../middleware/auth.js';
import { recomputeServerBankBalance } from './transactions.js';
import { postTransactionToJournal } from '../lib/ledgerService.js';
import {
  loadFullRules,
  loadTenantPolicy,
  loadOrgPersonalWorldEnabled,
  loadLearningPromptContext,
  findOrCreateCategoryForOrg,
  upsertVersionedRule,
  recordClassificationEvidence,
  recordRuleMatchUsage,
  recordFeedbackRejection,
  isTransactionImmutable,
  applyMatchingPendingBatchCorrection,
  getRuleVersionHistory,
  updateTenantClassificationPolicy,
  getRealPerformanceMetrics,
} from '../services/learningEngineService.js';

/** Safely extract orgId as a plain string from Express params */
function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

/** In-memory fallback for non-Supabase deployments */


/**
 * Get AI config for organization (from DB or env fallback)
 */
async function getAIConfig(orgId: string): Promise<(AIConfig & { organizationId?: string }) | null> {
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
        organizationId: orgId,
      };
    }
  } catch (error) {
    console.error('Error resolving AI config:', error);
  }
  const def = getDefaultAIConfig();
  return def ? { ...def, organizationId: orgId } : null;
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
 * Load full versioned classification rules from Supabase DB (§11)
 */
async function loadRules(orgId: string, includeInactive: boolean = false): Promise<ClassificationRule[]> {
  const sb = getSupabaseAdminClient();
  return loadFullRules(sb, orgId, includeInactive);
}

/**
 * Exact/near-exact category match WITHOUT silently falling back to "General / Other".
 * Used so missing categories can be detected and proposed instead of misclassified.
 */
function findExactOrCloseCategory(
  suggestedName: string,
  categories: Category[],
  type?: 'debit' | 'credit'
): Category | undefined {
  if (!categories.length || !suggestedName) return undefined;
  const target = suggestedName.trim().toLowerCase();
  const cleanTarget = target.replace(/[^a-z0-9]/g, '');
  if (!cleanTarget || target === 'uncategorized') return undefined;

  const expectedType = type === 'credit' ? 'income' : 'expense';
  const typeCats = categories.filter(c => !type || c.type === expectedType);

  let matched = typeCats.find(c => c.name.trim().toLowerCase() === target)
    || categories.find(c => c.name.trim().toLowerCase() === target);
  if (matched) return matched;

  matched = typeCats.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget)
    || categories.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget);
  if (matched) return matched;

  matched = typeCats.find(c => {
    const cl = c.name.toLowerCase();
    return (cl.length >= 4 && target.includes(cl)) || (target.length >= 4 && cl.includes(target));
  });
  return matched;
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
    const { narration, amount, type, useAI, world, autoCreateCategories, accountId, transactionId } = req.body as {
      narration: string;
      amount: number;
      type: 'debit' | 'credit';
      useAI?: boolean;
      world?: 'business' | 'personal';
      autoCreateCategories?: boolean;
      accountId?: string;
      transactionId?: string;
    };

    const sb = getSupabaseAdminClient();
    const [categories, previousTxns, rules, tenantPolicy, personalWorldEnabled] = await Promise.all([
      loadCategories(orgId),
      loadPreviousTransactions(orgId),
      loadRules(orgId),
      loadTenantPolicy(sb, orgId),
      loadOrgPersonalWorldEnabled(sb, orgId),
    ]);

    // 1. Rules-First Deterministic Cascade (§11): Org Rules -> Learned Patterns -> Taxonomy -> History
    const ruleResult = classifyTransaction(narration, amount, type, categories, previousTxns, rules, {
      organizationId: orgId,
      world,
      accountId,
      personalWorldEnabled,
      tenantPolicy,
    });

    if (ruleResult.matchedRuleId) {
      void recordRuleMatchUsage(sb, orgId, [ruleResult.matchedRuleId]);
    }

    // 2. If AI is explicitly disabled, return deterministic rule result immediately.
    // Otherwise consult AI grounded with org rules, human corrections, and departments.
    if (useAI === false) {
      let finalCatId = ruleResult.categoryId;
      let finalCatName = ruleResult.categoryName;
      let proposedNewCategory = ruleResult.proposedNewCategory || null;

      if (!finalCatId && proposedNewCategory && autoCreateCategories && sb) {
        try {
          const { category } = await findOrCreateCategoryForOrg(sb, orgId, proposedNewCategory, (req as any).authUser?.id);
          finalCatId = category.id;
          finalCatName = category.name;
          proposedNewCategory = null;
        } catch (createErr) {
          console.warn('[classification.classify] Auto-create category warning:', createErr);
        }
      }

      if (transactionId) {
        void recordClassificationEvidence(sb, orgId, {
          transactionId,
          rawNarration: narration,
          normalizedTokens: ruleResult.normalizedTokens,
          candidateRules: ruleResult.candidateRules,
          selectedRuleId: ruleResult.matchedRuleId || null,
          selectedRuleVersion: ruleResult.matchedRuleVersion || null,
          confidence: ruleResult.confidence,
          confidenceBand: ruleResult.confidenceBand || 'medium',
          riskFlags: ruleResult.riskFlags || [],
          decisionReason: ruleResult.reasoning,
          placement: ruleResult.placement || 'manual_review',
          finalDecision: { categoryId: finalCatId || null, world: ruleResult.world || 'business' },
          actorId: (req as any).authUser?.id || null,
        });
      }

      const suggestedDeptId = ruleResult.suggestedDepartmentId || (await inferDepartment(orgId, narration, finalCatName));
      return ok(res, {
        ...ruleResult,
        categoryId: finalCatId,
        categoryName: finalCatName,
        proposedNewCategory,
        suggestedDepartmentId: suggestedDeptId,
        source: ruleResult.source || 'rules',
      });
    }

    // 3. Otherwise consult AI grounded with the org's confirmed rules & recent human corrections (§11)
    const aiConfig = await getAIConfig(orgId);
    if (aiConfig) {
      try {
        const learningContext = await loadLearningPromptContext(sb, orgId, categories, rules);
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
            learningContext,
          },
          aiConfig
        );

        const inferredWorld: 'business' | 'personal' =
          personalWorldEnabled && (aiResult.world === 'personal' || ruleResult.world === 'personal')
            ? 'personal'
            : 'business';

        const exactCategory = aiResult.createNewCategory
          ? undefined
          : findExactOrCloseCategory(aiResult.suggestedCategory, categories, type);

        let categoryId = exactCategory?.id || '';
        let categoryName = exactCategory?.name || '';
        let proposedNewCategory: ProposedNewCategory | null = null;

        if (!exactCategory) {
          const proposedName = (aiResult.newCategoryName || aiResult.suggestedCategory || '').trim();
          const expectedType: 'expense' | 'income' = type === 'credit' ? 'income' : 'expense';
          if (proposedName && proposedName.toLowerCase() !== 'uncategorized') {
            proposedNewCategory = {
              name: proposedName,
              type: expectedType,
              world: inferredWorld,
              color: inferredWorld === 'personal' ? '#f59e0b' : (expectedType === 'income' ? '#10b981' : '#38bdf8'),
              icon: inferredWorld === 'personal' ? 'user' : (expectedType === 'income' ? 'dollar-sign' : 'tag'),
              reason: aiResult.reasoning || `AI proposed new category "${proposedName}"`,
            };
          } else {
            proposedNewCategory = suggestMissingCategorySpec(narration, type, inferredWorld, categories);
          }

          if (proposedNewCategory && autoCreateCategories && sb) {
            try {
              const { category } = await findOrCreateCategoryForOrg(sb, orgId, proposedNewCategory, (req as any).authUser?.id);
              categoryId = category.id;
              categoryName = category.name;
              proposedNewCategory = null;
            } catch (createErr) {
              console.warn('[classification.classify] AI auto-create category warning:', createErr);
            }
          } else if (proposedNewCategory) {
            categoryName = proposedNewCategory.name;
          }
        }

        const riskFlags = Array.from(new Set([
          ...(ruleResult.riskFlags || []),
          ...detectRiskFlags(narration, amount, type, previousTxns, {
            highValueThreshold: tenantPolicy.highValueThreshold,
            duplicateWindowDays: tenantPolicy.duplicateWindowDays,
            world: world || inferredWorld,
          }),
          ...(inferredWorld === 'personal' && (world || 'business') === 'business' ? ['CROSS_WORLD_AMBIGUITY'] : []),
        ]));

        const confidenceBand =
          aiResult.confidence >= tenantPolicy.highThreshold ? 'high' :
          aiResult.confidence >= tenantPolicy.mediumThreshold ? 'medium' : 'low';

        const placement =
          proposedNewCategory || riskFlags.length > 0 || confidenceBand === 'low'
            ? 'manual_review'
            : (confidenceBand === 'high' && tenantPolicy.allowsAutoApproval ? 'auto_approved' : 'bulk_review');

        const orgDepts = await loadDepartments(orgId);
        const matchedAiDept = aiResult.suggestedDepartment
          ? orgDepts.find(d => d.name.toLowerCase() === aiResult.suggestedDepartment!.toLowerCase() || d.name.toLowerCase().includes(aiResult.suggestedDepartment!.toLowerCase()))
          : undefined;
        const suggestedDeptId = matchedAiDept?.id || (await inferDepartment(orgId, narration, categoryName));

        if (transactionId) {
          void recordClassificationEvidence(sb, orgId, {
            transactionId,
            rawNarration: narration,
            normalizedTokens: ruleResult.normalizedTokens,
            candidateRules: ruleResult.candidateRules,
            modelVersion: aiResult.modelUsed || aiConfig.modelName || null,
            confidence: aiResult.confidence,
            confidenceBand,
            riskFlags,
            decisionReason: aiResult.reasoning,
            placement,
            finalDecision: { categoryId: categoryId || null, world: inferredWorld },
            actorId: (req as any).authUser?.id || null,
          });
        }

        return ok(res, {
          categoryId,
          categoryName: categoryName || 'Uncategorized',
          suggestedDepartmentId: suggestedDeptId,
          confidence: aiResult.confidence,
          confidenceBand,
          placement,
          riskFlags,
          reasoning: aiResult.reasoning,
          world: inferredWorld,
          worldConfidence: aiResult.world === ruleResult.world ? 92 : 78,
          worldReason: aiResult.worldReason || ruleResult.worldReason,
          proposedNewCategory,
          alternativeSuggestions: (aiResult.alternatives || []).map(alt => {
            const altCat = findExactOrCloseCategory(alt.categoryName, categories, type);
            return {
              categoryId: altCat?.id || '',
              categoryName: altCat?.name || alt.categoryName,
              confidence: alt.confidence,
              reasoning: alt.reasoning,
            };
          }),
          needsReview: placement !== 'auto_approved',
          source: aiResult.usedAI === false ? 'fallback' : 'ai',
          modelUsed: aiResult.modelUsed,
          rawNarration: narration,
          normalizedTokens: ruleResult.normalizedTokens,
        });
      } catch (error) {
        console.warn('[classification] AI classification failed, returning deterministic result:', error);
      }
    }

    const suggestedDeptId = ruleResult.suggestedDepartmentId || (await inferDepartment(orgId, narration, ruleResult.categoryName));
    ok(res, { ...ruleResult, suggestedDepartmentId: suggestedDeptId, source: ruleResult.source || 'rules' });
  });

  r.post('/batch', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactions, useAI, forceAI, world, autoCreateCategories, accountId } = req.body as {
      transactions: Array<{ id?: string; narration: string; amount: number; type: 'debit' | 'credit'; accountId?: string }>;
      useAI?: boolean;
      forceAI?: boolean;
      world?: 'business' | 'personal';
      autoCreateCategories?: boolean;
      accountId?: string;
    };

    if (!Array.isArray(transactions)) {
      console.error('[classification.batch] transactions is not an array:', typeof transactions);
      return fail(res, 400, 'transactions must be an array');
    }

    console.log(`[classification.batch] Processing ${transactions.length} transactions with useAI=${useAI}${forceAI ? ' forceAI=true' : ''}`);

    const sb = getSupabaseAdminClient();
    const [categories, previousTxns, rules, tenantPolicy, personalWorldEnabled] = await Promise.all([
      loadCategories(orgId),
      loadPreviousTransactions(orgId),
      loadRules(orgId),
      loadTenantPolicy(sb, orgId),
      loadOrgPersonalWorldEnabled(sb, orgId),
    ]);
    console.log(`[classification.batch] org=${orgId}: loaded ${categories.length} categories, ${rules.length} active rules`);

    const finalResults = new Map<number, any>();
    const ruleResults = new Map<number, ReturnType<typeof classifyTransaction>>();
    const indicesNeedingAI: number[] = [];
    const matchedRuleIds: string[] = [];
    let resolvedByRulesCount = 0;

    // PHASE 1 (Handoff §11): Evaluate deterministic org rules, risk flags, conflict detection,
    // and world scope for every row. When useAI=true, ALL rows are sent to AI grounded with
    // the organization's learned rules & human corrections so every transaction receives AI
    // classification while preserving deterministic rule evidence and fallback safety.
    for (let index = 0; index < transactions.length; index++) {
      const txn = transactions[index];
      const ruleRes = classifyTransaction(
        txn.narration,
        txn.amount,
        txn.type,
        categories,
        previousTxns,
        rules,
        {
          organizationId: orgId,
          world,
          accountId: txn.accountId || accountId,
          personalWorldEnabled,
          tenantPolicy,
        }
      );
      ruleResults.set(index, ruleRes);
      if (ruleRes.matchedRuleId) matchedRuleIds.push(ruleRes.matchedRuleId);

      if (useAI !== true) {
        const suggestedDeptId =
          ruleRes.suggestedDepartmentId ||
          (await inferDepartment(orgId, txn.narration, ruleRes.categoryName));
        finalResults.set(index, {
          index,
          ...ruleRes,
          suggestedDepartmentId: suggestedDeptId,
          source: ruleRes.source || 'rules',
        });
        resolvedByRulesCount++;
      } else {
        indicesNeedingAI.push(index);
      }
    }

    if (matchedRuleIds.length > 0) {
      void recordRuleMatchUsage(sb, orgId, matchedRuleIds);
    }

    // PHASE 2: Consult AI ONLY for unresolved / medium-or-low confidence rows, grounded with org learning context
    if (useAI === true && indicesNeedingAI.length > 0) {
      const aiConfig = await getAIConfig(orgId);
      if (aiConfig) {
        try {
          const learningContext = await loadLearningPromptContext(sb, orgId, categories, rules);
          const aiInputTxns = indicesNeedingAI.map(idx => transactions[idx]);
          const aiBatchMap = await classifyBatchWithAI(
            {
              transactions: aiInputTxns,
              availableCategories: categories.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
              })),
              learningContext,
            },
            aiConfig
          );

          for (let localIdx = 0; localIdx < indicesNeedingAI.length; localIdx++) {
            const origIdx = indicesNeedingAI[localIdx];
            const item = aiBatchMap.get(localIdx);
            const txn = transactions[origIdx];
            const ruleRes = ruleResults.get(origIdx)!;

            if (!item) continue;

            const inferredWorld: 'business' | 'personal' =
              personalWorldEnabled && (item.world === 'personal' || ruleRes.world === 'personal')
                ? 'personal'
                : 'business';

            const exactCat = item.createNewCategory
              ? undefined
              : findExactOrCloseCategory(item.suggestedCategory, categories, txn.type);

            let categoryId = exactCat?.id || '';
            let categoryName = exactCat?.name || '';
            let proposedNewCategory: ProposedNewCategory | null = null;

            if (!exactCat) {
              const proposedName = (item.newCategoryName || item.suggestedCategory || '').trim();
              const expectedType: 'expense' | 'income' = txn.type === 'credit' ? 'income' : 'expense';
              if (proposedName && proposedName.toLowerCase() !== 'uncategorized') {
                proposedNewCategory = {
                  name: proposedName,
                  type: expectedType,
                  world: inferredWorld,
                  color: inferredWorld === 'personal' ? '#f59e0b' : (expectedType === 'income' ? '#10b981' : '#38bdf8'),
                  icon: inferredWorld === 'personal' ? 'user' : (expectedType === 'income' ? 'dollar-sign' : 'tag'),
                  reason: item.reasoning || `No existing category matched; proposed "${proposedName}"`,
                };
              } else {
                proposedNewCategory = ruleRes.proposedNewCategory || suggestMissingCategorySpec(txn.narration, txn.type, inferredWorld, categories);
              }
              if (proposedNewCategory) {
                categoryName = proposedNewCategory.name;
              }
            }

            const riskFlags = Array.from(new Set([
              ...(ruleRes.riskFlags || []),
              ...(inferredWorld === 'personal' && (world || 'business') === 'business' ? ['CROSS_WORLD_AMBIGUITY'] : []),
            ]));

            const confidenceBand =
              item.confidence >= tenantPolicy.highThreshold ? 'high' :
              item.confidence >= tenantPolicy.mediumThreshold ? 'medium' : 'low';

            const placement =
              proposedNewCategory
                ? 'bulk_review'
                : (riskFlags.length > 0 || confidenceBand === 'low'
                    ? 'manual_review'
                    : (confidenceBand === 'high' && tenantPolicy.allowsAutoApproval ? 'auto_approved' : 'bulk_review'));

            const aiAlts = (item.alternatives || []).map(alt => {
              const altCat = findExactOrCloseCategory(alt.categoryName, categories, txn.type);
              return {
                categoryId: altCat?.id || '',
                categoryName: altCat?.name || alt.categoryName,
                confidence: alt.confidence,
                reasoning: alt.reasoning,
              };
            });
            const mergedAlternatives = [...aiAlts];
            for (const rAlt of ruleRes.alternativeSuggestions || []) {
              if (
                rAlt.categoryName.toLowerCase() !== (categoryName || '').toLowerCase() &&
                !mergedAlternatives.some(a => a.categoryName.toLowerCase() === rAlt.categoryName.toLowerCase())
              ) {
                mergedAlternatives.push({
                  categoryId: rAlt.categoryId,
                  categoryName: rAlt.categoryName,
                  confidence: rAlt.confidence,
                  reasoning: `Rule/taxonomy alternative (${rAlt.confidence}%)`,
                });
              }
            }

            const orgDepts = learningContext.departments || [];
            const matchedDept = item.suggestedDepartment
              ? orgDepts.find(
                  d =>
                    d.name.toLowerCase() === item.suggestedDepartment!.toLowerCase() ||
                    d.name.toLowerCase().includes(item.suggestedDepartment!.toLowerCase())
                )
              : undefined;
            const suggestedDeptId = matchedDept?.id || ruleRes.suggestedDepartmentId || (await inferDepartment(orgId, txn.narration, categoryName));

            finalResults.set(origIdx, {
              index: origIdx,
              categoryId,
              categoryName: categoryName || 'Uncategorized',
              suggestedDepartmentId: suggestedDeptId,
              confidence: item.confidence,
              confidenceBand,
              placement,
              riskFlags,
              reasoning: item.reasoning,
              world: inferredWorld,
              worldConfidence: item.world === ruleRes.world ? 90 : 75,
              worldReason: item.worldReason || ruleRes.worldReason,
              proposedNewCategory,
              alternativeSuggestions: mergedAlternatives.slice(0, 3),
              needsReview: placement !== 'auto_approved',
              source: item.usedAI === false ? 'fallback' : 'ai',
              modelUsed: item.modelUsed,
              matchedRuleId: ruleRes.matchedRuleId,
              matchedRuleVersion: ruleRes.matchedRuleVersion,
              candidateRules: ruleRes.candidateRules,
              rawNarration: txn.narration,
              normalizedTokens: ruleRes.normalizedTokens,
            });
          }

          console.log(`[classification.batch] AI classified ${aiBatchMap.size}/${indicesNeedingAI.length} unresolved transactions`);
        } catch (error) {
          console.warn('[classification.batch] AI batch classification failed, falling back to deterministic results:', error);
        }
      }
    }

    // PHASE 3: Fill any remaining rows with deterministic rule engine results (NO forced General fallback!)
    let fallbackCount = 0;
    for (let index = 0; index < transactions.length; index++) {
      if (!finalResults.has(index)) {
        const txn = transactions[index];
        const ruleRes = ruleResults.get(index)!;
        const suggestedDeptId =
          ruleRes.suggestedDepartmentId ||
          (await inferDepartment(orgId, txn.narration, ruleRes.categoryName));
        finalResults.set(index, {
          index,
          ...ruleRes,
          suggestedDepartmentId: suggestedDeptId,
          source: ruleRes.source || 'rules',
        });
        fallbackCount++;
      }
    }

    const aiResolvedCount = transactions.length - resolvedByRulesCount - fallbackCount;
    console.log(
      `[classification.batch] Resolved ${transactions.length}/${transactions.length} transactions ` +
      `(${resolvedByRulesCount} via learned org rules, ${aiResolvedCount} via AI, ${fallbackCount} via deterministic fallback)`
    );

    // Optional: auto-create missing categories immediately if caller requested it
    if (autoCreateCategories && sb) {
      const createdByKey = new Map<string, Category>();
      for (let index = 0; index < transactions.length; index++) {
        const item = finalResults.get(index);
        if (item && !item.categoryId && item.proposedNewCategory) {
          const cacheKey = `${item.proposedNewCategory.type}:${item.proposedNewCategory.name.toLowerCase()}`;
          try {
            let cat = createdByKey.get(cacheKey);
            if (!cat) {
              const resCat = await findOrCreateCategoryForOrg(sb, orgId, item.proposedNewCategory, (req as any).authUser?.id);
              cat = resCat.category;
              createdByKey.set(cacheKey, cat);
            }
            item.categoryId = cat.id;
            item.categoryName = cat.name;
            item.categoryAutoCreated = true;
          } catch (err) {
            console.warn('[classification.batch] Auto-create category warning:', err);
          }
        }
      }
    }

    const results = transactions.map((_, i) => finalResults.get(i)!);
    ok(res, { results });
  });

  r.post('/learn', requireOrgRole('owner', 'admin', 'accountant', 'manager', 'employee', 'member'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionId, correctCategoryId, departmentId, projectId, world, scope, rationale, proposedNewCategory } = req.body as {
      transactionId: string;
      correctCategoryId?: string;
      departmentId?: string;
      projectId?: string;
      world?: 'business' | 'personal';
      scope?: 'row' | 'batch' | 'future';
      rationale?: string;
      proposedNewCategory?: ProposedNewCategory | null;
    };

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    let txn: any = null;
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

    if (!txn) return notFound(res, 'Transaction');

    // Enforce §8 / §11 financial immutability: never overwrite posted/reconciled/closed-period transactions
    const imm = await isTransactionImmutable(sb, orgId, txn);
    if (imm.immutable) {
      return fail(res, 400, imm.reason || 'ALREADY_POSTED: Cannot modify a posted or reconciled transaction.');
    }

    const callerUserId = (req as any).authUser?.id || (req as any).user?.id || null;
    const callerRole = req.orgMembership?.role;
    const canManageOrgRules = callerRole === 'owner' || callerRole === 'admin' || callerRole === 'accountant';
    const personalWorldEnabled = await loadOrgPersonalWorldEnabled(sb, orgId);

    if (world === 'personal' && !personalWorldEnabled) {
      return fail(res, 400, 'WORLD_DISABLED: Personal finance tracking is disabled in organization settings.');
    }

    const resolvedWorld: 'business' | 'personal' =
      world === 'personal' || (!world && txn.world_scope === 'personal' && personalWorldEnabled)
        ? 'personal'
        : 'business';

    let finalCategoryId = String(correctCategoryId || '').trim();
    if (!finalCategoryId && proposedNewCategory?.name) {
      if (!canManageOrgRules) {
        return fail(res, 403, 'FORBIDDEN: Only finance admins or org owners can create new categories.');
      }
      try {
        const resCat = await findOrCreateCategoryForOrg(sb, orgId, {
          ...proposedNewCategory,
          world: resolvedWorld,
        }, callerUserId);
        finalCategoryId = resCat.category.id;
      } catch (catErr: any) {
        return fail(res, 400, catErr?.message || 'Could not create proposed category');
      }
    }

    if (!finalCategoryId) {
      return fail(res, 400, 'correctCategoryId is required');
    }

    const categories = await loadCategories(orgId);
    const previousCategoryId = txn.category_id || txn.categoryId || null;
    const narration = txn.narration || txn.description || '';
    const effectiveScope: 'row' | 'batch' | 'future' = scope || 'future';

    try {
      const suggestedCatId = txn.suggested_category_id || txn.suggestedCategoryId || null;
      const currentCatId = txn.category_id || txn.categoryId || suggestedCatId;
      const action = (currentCatId && currentCatId === finalCategoryId) ? 'accepted' : 'corrected';

      // 1. Record feedback in Supabase (always allowed for non-viewer org members)
      let feedbackId: string | null = null;
      try {
        const { data: fbRow } = await sb
          .from('classification_feedback')
          .insert({
            organization_id: orgId,
            transaction_id: transactionId,
            suggested_category_id: suggestedCatId,
            suggested_confidence: txn.confidence || null,
            final_category_id: finalCategoryId,
            action,
            ai_reasoning: txn.ai_reasoning || null,
            correction_reason: rationale || null,
            feedback_by: callerUserId,
          })
          .select('id')
          .maybeSingle();
        if (fbRow?.id) feedbackId = String(fbRow.id);
      } catch (fbErr) {
        console.warn('[classification.learn] Feedback record warning:', fbErr);
      }

      // 2. Resolve department (explicit or inferred)
      const matchedCat = categories.find(c => c.id === finalCategoryId);
      const resolvedDeptId = departmentId
        || txn.department_id
        || (await inferDepartment(orgId, `${txn.description || ''} ${narration}`, matchedCat?.name));

      // 3. Scope-controlled learning (§11 & §33 #12):
      //    - 'row': update this transaction only; do NOT create/update org-wide rule
      //    - 'batch': update this transaction + matching pending rows in the batch (admin/accountant only)
      //    - 'future': update this transaction + create/version org-wide rule (admin/accountant only)
      let ruleResult: Awaited<ReturnType<typeof upsertVersionedRule>> | null = null;
      let batchUpdatedCount = 0;
      const affectedBankAccounts = new Set<string>();
      if (txn.bank_account_id) affectedBankAccounts.add(String(txn.bank_account_id));

      if (effectiveScope === 'future' && canManageOrgRules) {
        ruleResult = await upsertVersionedRule(sb, orgId, {
          narration,
          categoryId: finalCategoryId,
          previousCategoryId,
          world: resolvedWorld,
          direction: txn.type === 'credit' ? 'credit' : 'debit',
          departmentId: resolvedDeptId,
          projectId: projectId || txn.project_id || undefined,
          action,
          source: 'user',
          feedbackId,
          sourceTransactionId: transactionId,
          actorUserId: callerUserId,
          changeReason: rationale || (action === 'corrected' ? 'human_correction' : 'human_confirmation'),
        });
      }

      // 4. Update transaction in Supabase (including world_scope and synced world tag)
      const existingTags: string[] = Array.isArray(txn.tags) ? txn.tags : [];
      const nextTags = Array.from(new Set([
        ...existingTags.filter(t => t !== 'business' && t !== 'personal'),
        resolvedWorld,
      ]));

      const updatePayload: Record<string, any> = {
        category_id: finalCategoryId,
        world_scope: resolvedWorld,
        tags: nextTags,
        status: 'classified',
        classified_at: new Date().toISOString(),
        classified_by: 'user',
        confidence: 100,
      };
      if (resolvedDeptId) updatePayload.department_id = resolvedDeptId;
      if (projectId) updatePayload.project_id = projectId;

      await sb.from('transactions').update(updatePayload).eq('id', transactionId).eq('organization_id', orgId);

      // 4b. Apply matching pending rows when scope === 'batch' (finance admin/owner/accountant only)
      if (effectiveScope === 'batch' && canManageOrgRules) {
        const batchRes = await applyMatchingPendingBatchCorrection(sb, orgId, {
          sourceTransactionId: transactionId,
          sourceImportId: txn.source_import_id || null,
          narration,
          type: txn.type === 'credit' ? 'credit' : 'debit',
          categoryId: finalCategoryId,
          departmentId: resolvedDeptId,
          world: resolvedWorld,
          actorUserId: callerUserId,
          rationale,
        });
        batchUpdatedCount = batchRes.updatedCount;
        batchRes.bankAccountIds.forEach(id => affectedBankAccounts.add(id));
      }

      // 5. Recompute bank balances & post journal idempotently when transitioning pending -> classified (§8, §10)
      for (const bankId of affectedBankAccounts) {
        void recomputeServerBankBalance(orgId, bankId);
      }
      if (!txn.journal_entry_id) {
        void postTransactionToJournal(sb, {
          id: txn.id,
          organization_id: orgId,
          bank_account_id: txn.bank_account_id,
          category_id: finalCategoryId,
          department_id: resolvedDeptId || null,
          project_id: projectId || txn.project_id || null,
          date: txn.date,
          amount: txn.amount,
          base_amount: txn.base_amount ?? txn.amount,
          currency: txn.currency || 'USD',
          type: txn.type === 'credit' ? 'credit' : 'debit',
          description: txn.description || narration,
          world_scope: resolvedWorld,
        }, callerUserId);
      }

      // 6. Record immutable classification_evidence (§11)
      await recordClassificationEvidence(sb, orgId, {
        transactionId,
        rawNarration: narration,
        selectedRuleId: ruleResult?.ruleId || null,
        selectedRuleVersion: ruleResult?.version || null,
        confidence: 100,
        confidenceBand: 'high',
        riskFlags: [],
        decisionReason: rationale || (action === 'corrected' ? 'Human category correction' : 'Human confirmation'),
        placement: effectiveScope === 'batch' ? 'bulk_review' : 'auto_approved',
        humanFeedback: { action, previousCategoryId, correctCategoryId: finalCategoryId, world: resolvedWorld, scope: effectiveScope, rationale },
        finalDecision: { categoryId: finalCategoryId, departmentId: resolvedDeptId || null, world: resolvedWorld, batchUpdatedCount },
        actorId: callerUserId,
      });

      ok(
        res,
        {
          updated: true,
          categoryId: finalCategoryId,
          departmentId: resolvedDeptId,
          ruleId: ruleResult?.ruleId,
          ruleVersion: ruleResult?.version,
          ruleLearned: Boolean(ruleResult?.ruleId && !ruleResult?.skipped),
          batchUpdatedCount,
          collisionWarning: ruleResult?.collisionWarning,
          world: resolvedWorld,
          scope: effectiveScope,
        },
        effectiveScope === 'row'
          ? 'Classification updated for this transaction only'
          : effectiveScope === 'batch'
            ? `Classification updated (+${batchUpdatedCount} matching pending rows)`
            : (canManageOrgRules ? 'Classification updated and learned for future transactions' : 'Feedback suggestion recorded')
      );
    } catch (error) {
      console.error('Error learning from feedback:', error);
      fail(res, 400, 'Failed to record learning');
    }
  });

  // ── Explicit Rejection of AI / Rule Suggestions (§11 Feedback Loop) ────────
  r.post('/reject', requireOrgRole('owner', 'admin', 'accountant', 'manager', 'employee', 'member'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionId, suggestedCategoryId, suggestedConfidence, reason } = req.body as {
      transactionId: string;
      suggestedCategoryId?: string;
      suggestedConfidence?: number;
      reason?: string;
    };
    if (!transactionId) return fail(res, 400, 'transactionId is required');

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    try {
      const result = await recordFeedbackRejection(sb, orgId, {
        transactionId,
        suggestedCategoryId: suggestedCategoryId || null,
        suggestedConfidence: suggestedConfidence ?? null,
        reason: reason || null,
        actorUserId: (req as any).authUser?.id || null,
      });
      return ok(res, { rejected: true, ...result }, 'Suggestion rejection recorded');
    } catch (err: any) {
      const msg = err?.message || 'Failed to record rejection';
      if (msg.includes('not found')) return notFound(res, 'Transaction');
      return fail(res, 400, msg);
    }
  });

  // ── Tenant Classification Policy (§11 Configurable Thresholds) ─────────────
  r.get('/policy', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    const policy = await loadTenantPolicy(sb, orgId);
    return ok(res, policy);
  });

  r.put('/policy', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');
    try {
      const updated = await updateTenantClassificationPolicy(sb, orgId, req.body || {});
      return ok(res, updated, 'Classification policy updated');
    } catch (err: any) {
      return fail(res, 400, err?.message || 'Failed to update classification policy');
    }
  });

  r.get('/rules', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const includeInactive = req.query.includeInactive === 'true';
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const rules = await loadRules(orgId, includeInactive);
        return ok(res, rules);
      } catch (error) {
        console.error('[classification.rules.get] Error loading rules:', error);
        return ok(res, []);
      }
    }

    return fail(res, 503, 'Supabase client is unconfigured');
  });

  r.post('/rules', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const ruleData = req.body as Partial<ClassificationRule> & { world?: 'business' | 'personal' };
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    const pattern = String(ruleData.pattern || '').trim();
    const categoryId = String(ruleData.categoryId || '').trim();
    if (!pattern || !categoryId) {
      return fail(res, 400, 'pattern and categoryId are required');
    }

    try {
      const world: 'business' | 'personal' =
        ruleData.world === 'personal' || ruleData.scope?.world === 'personal' || ruleData.prediction?.world === 'personal'
          ? 'personal'
          : 'business';

      const resUpsert = await upsertVersionedRule(sb, orgId, {
        pattern,
        narration: pattern,
        categoryId,
        world,
        direction: ruleData.scope?.directions?.length === 1 ? ruleData.scope.directions[0] : undefined,
        action: 'created',
        source: ruleData.createdFrom === 'auto' ? 'learned' : 'user',
        actorUserId: (req as any).authUser?.id || null,
        changeReason: 'manual_rule_created',
      });

      if (resUpsert.skipped) {
        return fail(res, 400, resUpsert.collisionWarning || 'Rule pattern is too generic or invalid');
      }

      return created(res, {
        id: resUpsert.ruleId || `rule-${Date.now()}`,
        pattern: resUpsert.pattern,
        categoryId,
        confidence: ruleData.confidence && ruleData.confidence <= 1 ? Math.round(ruleData.confidence * 100) : (ruleData.confidence || 95),
        matchCount: ruleData.matchCount || 0,
        createdFrom: (ruleData.createdFrom || 'user') as 'user' | 'auto',
        version: resUpsert.version || 1,
        status: 'active',
        scope: { world },
        prediction: { category_id: categoryId, world },
        collisionWarning: resUpsert.collisionWarning,
      }, 'Rule added');
    } catch (error) {
      console.error('[classification.rules.post] Exception:', error);
      return fail(res, 500, 'Failed to create rule');
    }
  });

  r.patch('/rules/:ruleId', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const updates = req.body as Partial<ClassificationRule> & { world?: 'business' | 'personal' };
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    try {
      const { data: existing } = await sb
        .from('classification_rules')
        .select('*')
        .eq('id', req.params.ruleId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (!existing) return notFound(res, 'Rule');

      const nextWorld: 'business' | 'personal' =
        updates.world === 'personal' || updates.scope?.world === 'personal'
          ? 'personal'
          : (updates.world === 'business' || updates.scope?.world === 'business'
              ? 'business'
              : (existing.world_scope === 'personal' ? 'personal' : 'business'));

      const nextVersion = Number(existing.version || 1) + 1;
      const nowIso = new Date().toISOString();

      // Archive previous version (§11)
      try {
        await sb.from('classification_rule_versions').insert({
          rule_id: existing.id,
          organization_id: orgId,
          version: Number(existing.version || 1),
          status: 'archived',
          scope: existing.scope || { world: existing.world_scope || 'business' },
          match: existing.match || { method: 'pattern', pattern: existing.pattern },
          prediction: existing.prediction || { category_id: existing.category_id, world: existing.world_scope || 'business' },
          confidence_policy: existing.confidence_policy || 'high_only_if_no_conflict',
          priority: Number(existing.priority ?? 50),
          explanation: existing.explanation || '',
          change_reason: 'manual_rule_edited',
          effective_from: existing.effective_from || existing.created_at || nowIso,
          effective_to: nowIso,
          changed_by: (req as any).authUser?.id || null,
        });
      } catch {
        /* graceful if table missing */
      }

      const dbUpdates: Record<string, any> = {
        version: nextVersion,
        world_scope: nextWorld,
        scope: { ...(existing.scope || {}), world: nextWorld },
        prediction: { ...(existing.prediction || {}), category_id: updates.categoryId ?? existing.category_id, world: nextWorld },
        updated_at: nowIso,
      };
      if (updates.pattern !== undefined) {
        dbUpdates.pattern = updates.pattern;
        dbUpdates.match = { ...(existing.match || {}), pattern: updates.pattern.toLowerCase() };
      }
      if (updates.categoryId !== undefined) dbUpdates.category_id = updates.categoryId;
      if (updates.confidence !== undefined) {
        let conf = updates.confidence;
        if (conf <= 1) conf = Math.round(conf * 100);
        dbUpdates.confidence = Math.max(0, Math.min(100, Math.round(conf)));
      }
      if (updates.matchCount !== undefined) dbUpdates.match_count = updates.matchCount;
      if (updates.status !== undefined) {
        dbUpdates.status = updates.status;
        dbUpdates.is_active = updates.status === 'active';
      }

      const { data, error } = await sb
        .from('classification_rules')
        .update(dbUpdates)
        .eq('id', req.params.ruleId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) {
        // Fallback for legacy schema without version/world_scope columns
        const legacyUpdates: Record<string, any> = {};
        if (updates.pattern !== undefined) legacyUpdates.pattern = updates.pattern;
        if (updates.categoryId !== undefined) legacyUpdates.category_id = updates.categoryId;
        if (dbUpdates.confidence !== undefined) legacyUpdates.confidence = dbUpdates.confidence;
        const { data: legacyData, error: legacyErr } = await sb
          .from('classification_rules')
          .update(legacyUpdates)
          .eq('id', req.params.ruleId)
          .eq('organization_id', orgId)
          .select()
          .single();
        if (legacyErr) return notFound(res, 'Rule');
        return ok(res, {
          id: legacyData.id,
          pattern: legacyData.pattern,
          categoryId: legacyData.category_id,
          confidence: legacyData.confidence > 1 ? legacyData.confidence : Math.round(legacyData.confidence * 100),
          matchCount: legacyData.match_count || 0,
          createdFrom: legacyData.source as 'user' | 'auto',
          lastUsed: legacyData.last_used_at,
          scope: { world: nextWorld },
        }, 'Rule updated');
      }

      return ok(res, {
        id: data.id,
        pattern: data.pattern,
        categoryId: data.category_id,
        confidence: data.confidence > 1 ? data.confidence : Math.round(data.confidence * 100),
        matchCount: data.match_count || 0,
        createdFrom: data.source as 'user' | 'auto',
        lastUsed: data.last_used_at,
        version: data.version || nextVersion,
        status: data.status || 'active',
        scope: { world: nextWorld },
        prediction: { category_id: data.category_id, world: nextWorld },
      }, 'Rule updated');
    } catch (error) {
      console.error('[classification.rules.patch] Exception:', error);
      return fail(res, 500, 'Failed to update rule');
    }
  });

  // Soft-archive instead of hard-deleting rule so historical audit evidence stays intact (§11)
  r.delete('/rules/:ruleId', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    try {
      const { data: existing } = await sb
        .from('classification_rules')
        .select('*')
        .eq('id', req.params.ruleId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (!existing) return notFound(res, 'Rule');

      const nowIso = new Date().toISOString();
      try {
        await sb.from('classification_rule_versions').insert({
          rule_id: existing.id,
          organization_id: orgId,
          version: Number(existing.version || 1),
          status: 'archived',
          scope: existing.scope || { world: existing.world_scope || 'business' },
          match: existing.match || { method: 'pattern', pattern: existing.pattern },
          prediction: existing.prediction || { category_id: existing.category_id, world: existing.world_scope || 'business' },
          confidence_policy: existing.confidence_policy || 'high_only_if_no_conflict',
          priority: Number(existing.priority ?? 50),
          explanation: existing.explanation || '',
          change_reason: 'rule_archived_via_delete',
          effective_from: existing.effective_from || existing.created_at || nowIso,
          effective_to: nowIso,
          changed_by: (req as any).authUser?.id || null,
        });
      } catch {
        /* graceful if table missing */
      }

      const { error } = await sb
        .from('classification_rules')
        .update({
          status: 'archived',
          is_active: false,
          effective_to: nowIso,
          updated_at: nowIso,
        })
        .eq('id', req.params.ruleId)
        .eq('organization_id', orgId);

      if (error) {
        // Fallback if status/effective_to columns absent on legacy DB
        await sb
          .from('classification_rules')
          .update({ is_active: false })
          .eq('id', req.params.ruleId)
          .eq('organization_id', orgId);
      }

      return ok(res, { id: req.params.ruleId, status: 'archived' }, 'Rule archived (historical evidence preserved)');
    } catch (error) {
      console.error('[classification.rules.delete] Exception:', error);
      return fail(res, 500, 'Failed to archive rule');
    }
  });

  // ── Rule Version History (§11 Audit & Reproducibility) ─────────────────────
  r.get('/rules/:ruleId/versions', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    const versions = await getRuleVersionHistory(sb, orgId, String(req.params.ruleId));
    return ok(res, versions);
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
          // Honest baseline: 0% until real user confirmations/corrections exist (§11)
          accuracyRate = 0;
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
    let acceptanceRate = 0;

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

  // ── Real AI Performance Analytics (§11 — zero mock hashes/trends) ──────────
  r.get('/performance', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    const categories = await loadCategories(orgId);
    const metrics = await getRealPerformanceMetrics(sb, orgId, categories);
    return ok(res, metrics);
  });

  // ── Submit 3-Tier Import Bulk Review Decisions (§10, §11) ──────────────────
  r.post('/bulk-review', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { decisions } = req.body as {
      decisions: Array<{
        transactionId?: string;
        narration?: string;
        pattern?: string;
        type?: 'debit' | 'credit';
        world?: 'business' | 'personal';
        usage?: 'business' | 'personal';
        action: 'accept' | 'override';
        categoryId?: string;
        proposedNewCategory?: ProposedNewCategory | null;
        createRule?: boolean;
      }>;
    };

    if (!Array.isArray(decisions)) {
      return fail(res, 400, 'decisions array is required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    const callerUserId = (req as any).authUser?.id || null;
    let processedCount = 0;
    let rulesCreated = 0;
    let categoriesCreated = 0;
    const createdCategories: Array<{ key: string; id: string; name: string }> = [];
    const createdCache = new Map<string, Category>();
    const seenRulePatterns = new Set<string>();

    for (const d of decisions) {
      processedCount++;
      const world: 'business' | 'personal' =
        (d.world || d.usage) === 'personal' ? 'personal' : 'business';
      let finalCategoryId = (d.categoryId || '').trim();

      // 1. Auto-create missing category if approved/proposed and no categoryId yet
      if (!finalCategoryId && d.proposedNewCategory?.name) {
        const key = `${d.proposedNewCategory.type}:${d.proposedNewCategory.name.toLowerCase()}`;
        try {
          let cat = createdCache.get(key);
          if (!cat) {
            const resCat = await findOrCreateCategoryForOrg(sb, orgId, {
              ...d.proposedNewCategory,
              world,
            }, callerUserId);
            cat = resCat.category;
            createdCache.set(key, cat);
            if (resCat.created) {
              categoriesCreated++;
              createdCategories.push({ key, id: cat.id, name: cat.name });
            }
          }
          finalCategoryId = cat.id;
        } catch (catErr) {
          console.warn('[classification.bulk-review] Category creation warning:', catErr);
        }
      }

      // 2. Create/update versioned, collision-checked rule when requested (or overridden)
      if (d.createRule && finalCategoryId && (d.pattern || d.narration)) {
        const dedupeKey = `${world}:${(d.pattern || d.narration || '').toLowerCase().trim()}:${finalCategoryId}`;
        if (!seenRulePatterns.has(dedupeKey)) {
          seenRulePatterns.add(dedupeKey);
          try {
            const ruleRes = await upsertVersionedRule(sb, orgId, {
              pattern: d.pattern,
              narration: d.narration || d.pattern,
              categoryId: finalCategoryId,
              world,
              direction: d.type === 'credit' ? 'credit' : 'debit',
              action: d.action === 'override' ? 'corrected' : 'accepted',
              source: 'import',
              actorUserId: callerUserId,
              changeReason: 'statement_import_review',
            });
            if (!ruleRes.skipped && ruleRes.ruleId) {
              rulesCreated++;
            }
          } catch (ruleErr) {
            console.warn('[classification.bulk-review] Rule upsert warning:', ruleErr);
          }
        }
      }
    }

    return ok(
      res,
      { processedCount, rulesCreated, categoriesCreated, createdCategories },
      `Processed ${processedCount} review decisions (${categoriesCreated} new categories, ${rulesCreated} rules learned)`
    );
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

  // ── Approve Bulk Review Group (§5 RBAC + §8 Immutability + §11 Evidence) ───
  r.post('/bulk-review/approve', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionIds, categoryId, world } = req.body as {
      transactionIds: string[];
      categoryId: string;
      world?: 'business' | 'personal';
    };

    if (!Array.isArray(transactionIds) || transactionIds.length === 0 || !categoryId) {
      return fail(res, 400, 'transactionIds and categoryId required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    const personalWorldEnabled = await loadOrgPersonalWorldEnabled(sb, orgId);
    if (world === 'personal' && !personalWorldEnabled) {
      return fail(res, 400, 'WORLD_DISABLED: Personal finance tracking is disabled in organization settings.');
    }

    const { data: rows } = await sb
      .from('transactions')
      .select('id, status, date, bank_account_id, narration, description, world_scope')
      .eq('organization_id', orgId)
      .in('id', transactionIds);

    const eligibleRows: any[] = [];
    let skippedImmutable = 0;
    for (const row of rows || []) {
      const imm = await isTransactionImmutable(sb, orgId, row);
      if (imm.immutable) {
        skippedImmutable++;
      } else {
        eligibleRows.push(row);
      }
    }

    const eligibleIds = eligibleRows.map(r => String(r.id));
    const nowIso = new Date().toISOString();
    const actorUserId = (req as any).authUser?.id || null;
    const affectedBanks = new Set<string>();

    if (eligibleIds.length > 0) {
      const updatePatch: Record<string, any> = {
        category_id: categoryId,
        status: 'classified',
        classified_at: nowIso,
        classified_by: 'bulk_review',
        confidence: 90,
      };
      if (world === 'business' || world === 'personal') {
        updatePatch.world_scope = world;
      }

      await sb
        .from('transactions')
        .update(updatePatch)
        .in('id', eligibleIds)
        .eq('organization_id', orgId);

      for (const row of eligibleRows) {
        if (row.bank_account_id) affectedBanks.add(String(row.bank_account_id));
        await recordClassificationEvidence(sb, orgId, {
          transactionId: String(row.id),
          rawNarration: String(row.narration || row.description || ''),
          confidence: 90,
          confidenceBand: 'high',
          riskFlags: [],
          decisionReason: 'Approved via grouped bulk review',
          placement: 'bulk_review',
          humanFeedback: { action: 'accepted', categoryId, world: world || row.world_scope || 'business' },
          finalDecision: { categoryId, world: world || row.world_scope || 'business' },
          actorId: actorUserId,
        });
      }

      for (const bankId of affectedBanks) {
        void recomputeServerBankBalance(orgId, bankId);
      }
    }

    return ok(
      res,
      { approvedCount: eligibleIds.length, skippedImmutable },
      `Bulk approved ${eligibleIds.length} transaction(s)${skippedImmutable > 0 ? ` (${skippedImmutable} posted/locked skipped)` : ''}`
    );
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
  r.post('/rules/:ruleId/revert', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const ruleId = req.params.ruleId;
    const { targetVersion, reason } = req.body as { targetVersion: number; reason?: string };

    if (!targetVersion || Number(targetVersion) < 1) {
      return fail(res, 400, 'Valid targetVersion is required');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    try {
      const { data: verRow } = await sb
        .from('classification_rule_versions')
        .select('*')
        .eq('organization_id', orgId)
        .eq('rule_id', ruleId)
        .eq('version', targetVersion)
        .maybeSingle();

      if (!verRow) {
        return notFound(res, `Rule version v${targetVersion}`);
      }

      const { data: currentRule } = await sb
        .from('classification_rules')
        .select('*')
        .eq('organization_id', orgId)
        .eq('id', ruleId)
        .maybeSingle();

      if (!currentRule) {
        return notFound(res, 'Rule');
      }

      const nextVersion = Number(currentRule.version || 1) + 1;
      const nowIso = new Date().toISOString();

      await sb.from('classification_rule_versions').insert({
        rule_id: ruleId,
        organization_id: orgId,
        version: Number(currentRule.version || 1),
        status: 'archived',
        scope: currentRule.scope || {},
        match: currentRule.match || {},
        prediction: currentRule.prediction || {},
        confidence_policy: currentRule.confidence_policy || 'high_only_if_no_conflict',
        priority: currentRule.priority || 50,
        explanation: currentRule.explanation || '',
        change_reason: reason || `Reverted to version ${targetVersion}`,
        effective_from: currentRule.effective_from || nowIso,
        effective_to: nowIso,
        changed_by: (req as any).authUser?.id || null,
      });

      const revertedWorld = verRow.prediction?.world || verRow.scope?.world || currentRule.world_scope || 'business';
      await sb.from('classification_rules').update({
        version: nextVersion,
        status: 'active',
        is_active: true,
        world_scope: revertedWorld,
        category_id: verRow.prediction?.category_id || verRow.category_id || currentRule.category_id,
        scope: verRow.scope || currentRule.scope,
        match: verRow.match || currentRule.match,
        prediction: verRow.prediction || currentRule.prediction,
        confidence: verRow.confidence || currentRule.confidence,
        priority: verRow.priority || currentRule.priority,
        explanation: `Reverted to behavior of version ${targetVersion}`,
        effective_from: nowIso,
        effective_to: null,
        updated_at: nowIso,
      }).eq('id', ruleId).eq('organization_id', orgId);

      return ok(res, { reverted: true, ruleId, targetVersion, newVersion: nextVersion }, `Rule reverted to v${targetVersion}`);
    } catch (e) {
      console.error('[classification.revert] Error reverting rule:', e);
      return fail(res, 500, 'Failed to revert rule');
    }
  });

  // ── Set Rule Status (active / disabled / archived) ─────────────────────────
  r.patch('/rules/:ruleId/status', requireOrgRole('owner', 'admin', 'accountant'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const ruleId = req.params.ruleId;
    const { status } = req.body as { status: 'active' | 'disabled' | 'archived' };

    if (!status || !['active', 'disabled', 'archived'].includes(status)) {
      return fail(res, 400, 'Valid status required (active, disabled, archived)');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    try {
      await sb
        .from('classification_rules')
        .update({
          status,
          is_active: status === 'active',
          effective_to: status === 'archived' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ruleId)
        .eq('organization_id', orgId);
    } catch (e) {
      console.error('[classification.rules.status] Error updating status:', e);
      return fail(res, 500, 'Failed to update rule status');
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
    const { narration, amount, type, world, accountId } = req.body as {
      narration: string;
      amount: number;
      type: 'debit' | 'credit';
      world?: 'business' | 'personal';
      accountId?: string;
    };
    const sb = getSupabaseAdminClient();
    const [categories, previousTxns, rules, tenantPolicy, personalWorldEnabled] = await Promise.all([
      loadCategories(orgId),
      loadPreviousTransactions(orgId),
      loadRules(orgId),
      loadTenantPolicy(sb, orgId),
      loadOrgPersonalWorldEnabled(sb, orgId),
    ]);
    const result = classifyTransaction(narration, amount, type, categories, previousTxns, rules, {
      organizationId: orgId,
      world,
      accountId,
      personalWorldEnabled,
      tenantPolicy,
    });
    if (result.matchedRuleId) {
      void recordRuleMatchUsage(sb, orgId, [result.matchedRuleId]);
    }
    ok(res, result);
  });

  r.post('/learn', requireOrgRole('owner', 'admin', 'accountant', 'manager', 'employee', 'member'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const { transactionId, correctCategoryId, world, scope } = req.body as {
      transactionId: string;
      correctCategoryId: string;
      world?: 'business' | 'personal';
      scope?: 'row' | 'batch' | 'future';
    };
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Supabase client is unconfigured');

    const { data: txn } = await sb
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!txn) return notFound(res, 'Transaction');

    const imm = await isTransactionImmutable(sb, orgId, txn);
    if (imm.immutable) {
      return fail(res, 400, imm.reason || 'Transaction is immutable');
    }

    const personalWorldEnabled = await loadOrgPersonalWorldEnabled(sb, orgId);
    if (world === 'personal' && !personalWorldEnabled) {
      return fail(res, 400, 'WORLD_DISABLED: Personal finance tracking is disabled in organization settings.');
    }

    const resolvedWorld: 'business' | 'personal' =
      world === 'personal' || (!world && txn.world_scope === 'personal' && personalWorldEnabled) ? 'personal' : 'business';
    const callerUserId = (req as any).authUser?.id || null;
    const callerRole = req.orgMembership?.role;
    const canManageOrgRules = callerRole === 'owner' || callerRole === 'admin' || callerRole === 'accountant';
    const narration = String(txn.narration || txn.description || '');
    const previousCategoryId = txn.category_id || null;
    const action = previousCategoryId && previousCategoryId === correctCategoryId ? 'accepted' : 'corrected';

    let feedbackId: string | null = null;
    try {
      const { data: fbRow } = await sb
        .from('classification_feedback')
        .insert({
          organization_id: orgId,
          transaction_id: transactionId,
          suggested_category_id: txn.suggested_category_id || previousCategoryId,
          suggested_confidence: txn.confidence || null,
          final_category_id: correctCategoryId,
          action,
          feedback_by: callerUserId,
        })
        .select('id')
        .maybeSingle();
      if (fbRow?.id) feedbackId = String(fbRow.id);
    } catch {
      /* non-fatal */
    }

    let ruleRes: Awaited<ReturnType<typeof upsertVersionedRule>> | null = null;
    if (scope !== 'row' && canManageOrgRules) {
      ruleRes = await upsertVersionedRule(sb, orgId, {
        narration,
        categoryId: correctCategoryId,
        previousCategoryId,
        world: resolvedWorld,
        direction: txn.type === 'credit' ? 'credit' : 'debit',
        action,
        source: 'user',
        feedbackId,
        sourceTransactionId: transactionId,
        actorUserId: callerUserId,
        changeReason: 'pattern_engine_learn',
      });
    }

    await sb.from('transactions').update({
      category_id: correctCategoryId,
      world_scope: resolvedWorld,
      status: 'classified',
      classified_at: new Date().toISOString(),
      classified_by: 'user',
      confidence: 100,
    }).eq('id', transactionId).eq('organization_id', orgId);

    if (txn.bank_account_id) {
      void recomputeServerBankBalance(orgId, String(txn.bank_account_id));
    }

    await recordClassificationEvidence(sb, orgId, {
      transactionId,
      rawNarration: narration,
      selectedRuleId: ruleRes?.ruleId || null,
      selectedRuleVersion: ruleRes?.version || null,
      confidence: 100,
      confidenceBand: 'high',
      riskFlags: [],
      decisionReason: 'Pattern engine confirmation/correction',
      placement: 'auto_approved',
      humanFeedback: { action, previousCategoryId, correctCategoryId, world: resolvedWorld },
      finalDecision: { categoryId: correctCategoryId, world: resolvedWorld },
      actorId: callerUserId,
    });

    ok(res, { updated: true, ruleId: ruleRes?.ruleId, world: resolvedWorld }, 'Classification updated and learned');
  });

  return r;
}
