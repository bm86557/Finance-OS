/**
 * Authoritative Logic & Learning Backend Service (Handoff v1.2 §5, §10, §11)
 * ==========================================================================
 * Centralizes:
 * - Loading full versioned org classification rules (preserving scope/match/prediction/world)
 * - Loading tenant classification policy & personal_world_enabled org setting
 * - Building tenant-isolated AI few-shot learning context from human-confirmed rules & feedback
 * - Idempotent missing-category creation linked to valid Chart of Accounts GL account_id
 * - Versioned rule creation/updates with collision checks & classification_rule_versions archival
 * - Immutable classification_evidence persistence
 * - Real Supabase-backed AI performance & per-category accuracy analytics
 */

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category, Transaction } from '../../src/services/types.js';
import {
  cleanNarration,
  createCandidateRule,
  evaluateRuleCandidate,
  learnFromFeedback,
  type ClassificationRule,
  type ProposedNewCategory,
  type TenantPolicy,
} from '../../src/lib/classificationEngine.js';
import type { OrgLearningContext } from '../lib/aiClient.js';
import { logAuditEvent } from '../lib/auditLogger.js';

export const DEFAULT_TENANT_POLICY: Omit<TenantPolicy, 'organizationId'> = {
  highThreshold: 85,
  mediumThreshold: 60,
  allowsAutoApproval: true,
  highValueThreshold: 5000,
  duplicateWindowDays: 7,
  policyVersion: 1,
};

/**
 * Loads full §11 rule objects for an organization (preserving scope, match, prediction, version, priority, status, world).
 */
export async function loadFullRules(
  sb: SupabaseClient | null,
  orgId: string,
  includeInactive: boolean = false
): Promise<ClassificationRule[]> {
  if (!sb) return [];

  try {
    let query = sb
      .from('classification_rules')
      .select('*')
      .eq('organization_id', orgId)
      .order('priority', { ascending: false });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    const nowMs = Date.now();
    return (data || [])
      .filter((row: any) => {
        if (includeInactive) return true;
        if ((row.status ?? 'active') !== 'active') return false;
        if (row.effective_to) {
          const endMs = new Date(row.effective_to).getTime();
          if (Number.isFinite(endMs) && endMs < nowMs) return false;
        }
        return true;
      })
      .map((row: any) => {
        const rawScope = row.scope && typeof row.scope === 'object' ? row.scope : {};
        const world: 'business' | 'personal' =
          row.world_scope === 'personal' || rawScope.world === 'personal' || row.prediction?.world === 'personal'
            ? 'personal'
            : 'business';
        return {
          id: String(row.id),
          pattern: String(row.pattern || row.match?.pattern || ''),
          categoryId: String(row.category_id || row.prediction?.category_id || ''),
          confidence: Number(row.confidence) > 1 ? Number(row.confidence) : Math.round(Number(row.confidence || 0) * 100),
          matchCount: Number(row.match_count ?? row.times_applied ?? 0),
          correctCount: Number(row.correct_count ?? row.times_confirmed ?? 0),
          wrongCount: Number(row.wrong_count ?? row.times_overridden ?? 0),
          falsePositiveCount: Number(row.false_positive_count ?? 0),
          createdFrom: (row.source === 'auto' || row.source === 'ai' ? 'auto' : 'user') as 'user' | 'auto',
          lastUsed: row.last_used_at || row.updated_at || undefined,
          version: Number(row.version || 1),
          status: (row.status || (row.is_active === false ? 'disabled' : 'active')) as 'active' | 'archived' | 'disabled',
          priority: Number(row.priority ?? 50),
          explanation: String(row.explanation || ''),
          effectiveFrom: row.effective_from || row.created_at || undefined,
          effectiveTo: row.effective_to || null,
          scope: {
            world,
            account_ids: Array.isArray(rawScope.account_ids) ? rawScope.account_ids : [],
            directions: Array.isArray(rawScope.directions) && rawScope.directions.length > 0 ? rawScope.directions : undefined,
            min_amount: rawScope.min_amount != null ? Number(rawScope.min_amount) : undefined,
            max_amount: rawScope.max_amount != null ? Number(rawScope.max_amount) : undefined,
          },
          match: row.match && typeof row.match === 'object'
            ? {
                method: row.match.method || 'token_set',
                tokens: Array.isArray(row.match.tokens) ? row.match.tokens : undefined,
                pattern: row.match.pattern || row.pattern,
                merchant_alias: row.match.merchant_alias || undefined,
              }
            : { method: 'pattern', pattern: String(row.pattern || '') },
          prediction: row.prediction && typeof row.prediction === 'object'
            ? {
                category_id: row.prediction.category_id || row.category_id || undefined,
                category_code: row.prediction.category_code || undefined,
                counterparty: row.prediction.counterparty || undefined,
                department_id: row.prediction.department_id || row.department_id || undefined,
                project_id: row.prediction.project_id || row.project_id || undefined,
                client: row.prediction.client || undefined,
                world,
              }
            : {
                category_id: row.category_id || undefined,
                department_id: row.department_id || undefined,
                project_id: row.project_id || undefined,
                world,
              },
        };
      });
  } catch (err) {
    console.warn('[learningEngine] loadFullRules warning:', err);
    return [];
  }
}

/**
 * Loads tenant classification policy (thresholds, auto-approval gate, high-value threshold).
 */
export async function loadTenantPolicy(sb: SupabaseClient | null, orgId: string): Promise<TenantPolicy> {
  if (!sb) return { organizationId: orgId, ...DEFAULT_TENANT_POLICY };

  try {
    const { data, error } = await sb
      .from('tenant_classification_policies')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!error && data) {
      return {
        organizationId: orgId,
        highThreshold: Number(data.high_threshold ?? DEFAULT_TENANT_POLICY.highThreshold),
        mediumThreshold: Number(data.medium_threshold ?? DEFAULT_TENANT_POLICY.mediumThreshold),
        allowsAutoApproval: data.allows_auto_approval !== false,
        highValueThreshold: Number(data.high_value_threshold ?? DEFAULT_TENANT_POLICY.highValueThreshold),
        duplicateWindowDays: Number(data.duplicate_window_days ?? DEFAULT_TENANT_POLICY.duplicateWindowDays),
        policyVersion: Number(data.policy_version ?? 1),
      };
    }
  } catch {
    /* graceful fallback if migration 0017 not applied */
  }

  return { organizationId: orgId, ...DEFAULT_TENANT_POLICY };
}

/**
 * Checks whether personal world tracking is enabled for this organization (§5).
 */
export async function loadOrgPersonalWorldEnabled(sb: SupabaseClient | null, orgId: string): Promise<boolean> {
  if (!sb) return true;
  try {
    const { data } = await sb
      .from('organizations')
      .select('personal_world_enabled, settings')
      .eq('id', orgId)
      .maybeSingle();

    if (!data) return true;
    const val = (data as any).personal_world_enabled
      ?? (data as any).settings?.personal_world_enabled
      ?? (data as any).settings?.features?.personal_finance;
    return val !== false;
  } catch {
    return true;
  }
}

/**
 * Builds tenant-isolated AI few-shot learning context from human-confirmed rules & recent feedback (§11).
 * Never uses unconfirmed AI guesses as training truth.
 */
export async function loadLearningPromptContext(
  sb: SupabaseClient | null,
  orgId: string,
  categories: Category[],
  rules?: ClassificationRule[]
): Promise<OrgLearningContext> {
  const personalWorldEnabled = await loadOrgPersonalWorldEnabled(sb, orgId);
  const catById = new Map(categories.map(c => [c.id, c.name]));

  const activeRules = rules ?? (await loadFullRules(sb, orgId));
  const learnedRules = activeRules
    .filter(r => r.pattern && r.categoryId && catById.has(r.categoryId) && r.createdFrom === 'user')
    .slice(0, 20)
    .map(r => ({
      pattern: r.pattern,
      categoryName: catById.get(r.categoryId)!,
      world: (r.prediction?.world || r.scope?.world || 'business') as 'business' | 'personal',
    }));

  const recentCorrections: Array<{ narration: string; categoryName: string; world?: 'business' | 'personal' }> = [];
  if (sb) {
    try {
      const { data: fbRows } = await sb
        .from('classification_feedback')
        .select('transaction_id, final_category_id, action')
        .eq('organization_id', orgId)
        .in('action', ['corrected', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(15);

      if (fbRows && fbRows.length > 0) {
        const txnIds = Array.from(new Set(fbRows.map((f: any) => f.transaction_id).filter(Boolean)));
        if (txnIds.length > 0) {
          const { data: txns } = await sb
            .from('transactions')
            .select('id, narration, description, world_scope')
            .eq('organization_id', orgId)
            .in('id', txnIds);

          const txnMap = new Map((txns || []).map((t: any) => [String(t.id), t]));
          for (const fb of fbRows) {
            const t = txnMap.get(String(fb.transaction_id));
            const catName = catById.get(String(fb.final_category_id));
            if (t && catName) {
              const narr = String(t.narration || t.description || '').trim();
              if (narr) {
                recentCorrections.push({
                  narration: narr,
                  categoryName: catName,
                  world: t.world_scope === 'personal' ? 'personal' : 'business',
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[learningEngine] loadLearningPromptContext feedback warning:', err);
    }
  }

  const departments: Array<{ id: string; name: string }> = [];
  if (sb) {
    try {
      const { data: deptRows } = await sb
        .from('departments')
        .select('id, name')
        .eq('organization_id', orgId);
      for (const d of deptRows || []) {
        if (d?.id && d?.name) departments.push({ id: String(d.id), name: String(d.name) });
      }
    } catch {
      /* non-fatal */
    }
  }

  return {
    learnedRules,
    recentCorrections: recentCorrections.slice(0, 12),
    departments,
    personalWorldEnabled,
  };
}

/**
 * Idempotently finds an existing org category by normalized name + type,
 * or creates a new category linked to a valid Chart of Accounts GL account_id (§9, §11).
 */
export async function findOrCreateCategoryForOrg(
  sb: SupabaseClient,
  orgId: string,
  spec: ProposedNewCategory,
  actorUserId?: string | null
): Promise<{ category: Category; created: boolean }> {
  const cleanName = String(spec.name || '').trim().slice(0, 64);
  const catType: 'expense' | 'income' = spec.type === 'income' ? 'income' : 'expense';
  if (!cleanName) {
    throw new Error('Category name is required');
  }

  // 1. Check existing org categories first (case-insensitive / alphanumeric match)
  const { data: existingCats } = await sb
    .from('categories')
    .select('*')
    .eq('organization_id', orgId);

  const normTarget = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = (existingCats || []).find((c: any) => {
    if (c.type !== catType) return false;
    const cn = String(c.name || '').trim().toLowerCase();
    return cn === cleanName.toLowerCase() || cn.replace(/[^a-z0-9]/g, '') === normTarget;
  });

  if (matched) {
    // Merge any new seed patterns
    const existingPats: string[] = Array.isArray(matched.patterns) ? matched.patterns : [];
    const mergedPats = Array.from(new Set([...existingPats, ...(spec.patterns || [])])).slice(0, 50);
    if (mergedPats.length > existingPats.length) {
      await sb.from('categories').update({ patterns: mergedPats }).eq('id', matched.id).eq('organization_id', orgId);
    }
    return {
      created: false,
      category: {
        id: String(matched.id),
        organizationId: orgId,
        name: String(matched.name),
        type: matched.type as Category['type'],
        accountId: String(matched.account_id || ''),
        color: String(matched.color || '#38bdf8'),
        icon: String(matched.icon || 'tag'),
        patterns: mergedPats,
      },
    };
  }

  // 2. Resolve or create a valid Chart of Accounts GL account_id for this category type
  // Note: `accounts.type` uses 'income' | 'expense' (not 'revenue'), and `categories.account_id` is NOT NULL.
  let accountId = '';
  const accountType: 'income' | 'expense' = catType === 'income' ? 'income' : 'expense';
  const { data: existingAcc } = await sb
    .from('accounts')
    .select('id, subtype')
    .eq('organization_id', orgId)
    .in('type', catType === 'income' ? ['income', 'revenue'] : ['expense'])
    .order('code', { ascending: true })
    .limit(10);

  if (Array.isArray(existingAcc) && existingAcc.length > 0) {
    // Prefer operating_revenue / other_income for income, operating_expense for expense
    const preferred = existingAcc.find((a: any) =>
      catType === 'income'
        ? ['operating_revenue', 'other_income'].includes(String(a.subtype || ''))
        : ['operating_expense', 'other_expense'].includes(String(a.subtype || ''))
    ) || existingAcc[0];
    accountId = String(preferred.id);
  } else {
    const newAccId = `acc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const fallbackCode = `${catType === 'income' ? '49' : '69'}${Math.floor(10 + Math.random() * 89)}`;
    const { data: createdAcc, error: accErr } = await sb
      .from('accounts')
      .insert({
        id: newAccId,
        organization_id: orgId,
        name: catType === 'income' ? 'Other Income' : 'Other Operating Expenses',
        code: fallbackCode,
        type: accountType,
        subtype: catType === 'income' ? 'other_income' : 'operating_expense',
        currency: 'USD',
        balance: 0,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (accErr) {
      console.warn(`[learningEngine] Failed to auto-create ${accountType} GL account for org ${orgId}:`, accErr.message);
    }
    if (createdAcc?.id) {
      accountId = String(createdAcc.id);
    } else {
      // Last-resort lookup of any org account to satisfy categories.account_id NOT NULL constraint
      const { data: anyAcc } = await sb
        .from('accounts')
        .select('id')
        .eq('organization_id', orgId)
        .limit(1)
        .maybeSingle();
      if (anyAcc?.id) accountId = String(anyAcc.id);
    }
  }

  if (!accountId) {
    throw new Error(`Failed to resolve a Chart of Accounts GL account for ${catType} category "${cleanName}"`);
  }

  const newCatId = `cat-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const seedPatterns = Array.from(new Set((spec.patterns || []).map(p => p.toLowerCase().trim()).filter(p => p.length > 2))).slice(0, 20);
  const insertRow = {
    id: newCatId,
    organization_id: orgId,
    name: cleanName,
    type: catType,
    account_id: accountId,
    color: spec.color || (spec.world === 'personal' ? '#f59e0b' : (catType === 'income' ? '#10b981' : '#38bdf8')),
    icon: spec.icon || (spec.world === 'personal' ? 'user' : (catType === 'income' ? 'dollar-sign' : 'tag')),
    patterns: seedPatterns,
  };

  const { data: inserted, error } = await sb
    .from('categories')
    .insert(insertRow)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create category "${cleanName}": ${error.message}`);
  }

  void logAuditEvent(null, {
    organizationId: orgId,
    action: 'category.auto_created',
    entityType: 'category',
    entityId: newCatId,
    description: `Auto-created category "${cleanName}" (${catType})`,
    afterState: insertRow,
    metadata: { reason: spec.reason, world: spec.world || 'business', actorUserId: actorUserId || null },
  });

  return {
    created: true,
    category: {
      id: String(inserted.id),
      organizationId: orgId,
      name: String(inserted.name),
      type: inserted.type as Category['type'],
      accountId: String(inserted.account_id || ''),
      color: String(inserted.color || '#38bdf8'),
      icon: String(inserted.icon || 'tag'),
      patterns: Array.isArray(inserted.patterns) ? inserted.patterns : [],
    },
  };
}

/**
 * Upserts a versioned, collision-checked classification rule (§11):
 * - Evaluates generic-word & conflicting-rule collisions
 * - Archives prior version into `classification_rule_versions` on update
 * - Persists `world_scope`, `scope`, `match`, `prediction`, `version`, `confidence`, `source`
 * - Updates `categories.patterns` so Logic & Learning Center stays in sync
 */
export async function upsertVersionedRule(
  sb: SupabaseClient,
  orgId: string,
  params: {
    narration?: string;
    pattern?: string;
    categoryId: string;
    previousCategoryId?: string | null;
    world?: 'business' | 'personal';
    direction?: 'debit' | 'credit';
    departmentId?: string;
    projectId?: string;
    action?: 'accepted' | 'corrected' | 'created';
    source?: 'user' | 'learned' | 'import';
    feedbackId?: string | null;
    sourceTransactionId?: string | null;
    actorUserId?: string | null;
    changeReason?: string;
  }
): Promise<{ ruleId?: string; version?: number; pattern: string; collisionWarning?: string; skipped?: boolean }> {
  const activeRules = await loadFullRules(sb, orgId);
  const world: 'business' | 'personal' = params.world === 'personal' ? 'personal' : 'business';
  const rawBasis = (params.pattern || params.narration || '').trim();
  if (!rawBasis) return { pattern: '', skipped: true };

  const { merchant, tokens } = cleanNarration(rawBasis);
  const normalizedPattern = (params.pattern ? params.pattern.trim().toLowerCase() : (merchant || tokens.slice(0, 2).join(' ')).toLowerCase().trim());

  if (!normalizedPattern || normalizedPattern.length < 2) {
    return { pattern: normalizedPattern, skipped: true };
  }

  // Find existing rule matching pattern + org
  const { data: existingRule } = await sb
    .from('classification_rules')
    .select('*')
    .eq('organization_id', orgId)
    .ilike('pattern', normalizedPattern)
    .maybeSingle();

  const candidate = createCandidateRule(orgId, params.narration || normalizedPattern, params.categoryId, {
    existingRule: existingRule ? {
      id: String(existingRule.id),
      pattern: String(existingRule.pattern),
      categoryId: String(existingRule.category_id || ''),
      confidence: Number(existingRule.confidence || 90),
      matchCount: Number(existingRule.match_count || 0),
      createdFrom: 'user',
      version: Number(existingRule.version || 1),
    } : undefined,
    world,
    departmentId: params.departmentId,
    projectId: params.projectId,
    feedbackId: params.feedbackId || undefined,
  });

  candidate.match.pattern = normalizedPattern;
  if (params.direction) {
    candidate.scope.directions = [params.direction];
  } else {
    candidate.scope.directions = ['debit', 'credit'];
  }

  const evaluation = evaluateRuleCandidate(candidate, [], activeRules);
  if (!evaluation.isValid) {
    return {
      pattern: normalizedPattern,
      collisionWarning: evaluation.collisionWarning,
      skipped: true,
    };
  }

  const nowIso = new Date().toISOString();
  const isAccepted = params.action === 'accepted';
  const isCorrected = params.action === 'corrected';
  let finalRuleId = existingRule?.id ? String(existingRule.id) : candidate.id;
  let finalVersion = existingRule ? Number(existingRule.version || 1) + 1 : 1;

  if (existingRule) {
    // Archive prior version into classification_rule_versions (§11 immutable history)
    try {
      await sb.from('classification_rule_versions').insert({
        rule_id: finalRuleId,
        organization_id: orgId,
        version: Number(existingRule.version || 1),
        status: 'archived',
        scope: existingRule.scope || { world: existingRule.world_scope || 'business' },
        match: existingRule.match || { method: 'pattern', pattern: existingRule.pattern },
        prediction: existingRule.prediction || { category_id: existingRule.category_id, world: existingRule.world_scope || 'business' },
        confidence_policy: existingRule.confidence_policy || 'high_only_if_no_conflict',
        priority: Number(existingRule.priority ?? 50),
        explanation: existingRule.explanation || '',
        change_reason: params.changeReason || (isCorrected ? 'learned_from_correction' : 'confirmed_rule_update'),
        created_from_feedback_id: params.feedbackId || null,
        source_transaction_id: params.sourceTransactionId || null,
        effective_from: existingRule.effective_from || existingRule.created_at || nowIso,
        effective_to: nowIso,
        changed_by: params.actorUserId || null,
      });
    } catch {
      /* graceful if classification_rule_versions migration not applied */
    }

    const nextCorrect = isAccepted ? Number(existingRule.correct_count || 0) + 1 : Number(existingRule.correct_count || 0);
    const nextWrong = isCorrected ? Number(existingRule.wrong_count || 0) + 1 : Number(existingRule.wrong_count || 0);
    const calibratedConf = computeCalibratedRuleConfidence(nextCorrect, nextWrong, true);

    const updateBody: Record<string, any> = {
      category_id: params.categoryId,
      department_id: params.departmentId || existingRule.department_id || null,
      project_id: params.projectId || existingRule.project_id || null,
      world_scope: world,
      version: finalVersion,
      status: 'active',
      scope: candidate.scope,
      match: candidate.match,
      prediction: candidate.prediction,
      confidence: calibratedConf,
      source: params.source || 'user',
      is_active: true,
      match_count: Number(existingRule.match_count || 0) + 1,
      times_applied: Number(existingRule.times_applied ?? existingRule.match_count ?? 0) + 1,
      correct_count: nextCorrect,
      wrong_count: nextWrong,
      times_confirmed: Number(existingRule.times_confirmed || 0) + (isAccepted ? 1 : 0),
      times_overridden: Number(existingRule.times_overridden || 0) + (isCorrected ? 1 : 0),
      explanation: candidate.explanation,
      effective_from: nowIso,
      effective_to: null,
      last_used_at: nowIso,
      updated_at: nowIso,
    };

    const { error: updErr } = await sb
      .from('classification_rules')
      .update(updateBody)
      .eq('id', finalRuleId)
      .eq('organization_id', orgId);

    if (updErr) {
      // Fallback for legacy schema lacking extended columns
      await sb
        .from('classification_rules')
        .update({
          category_id: params.categoryId,
          confidence: calibratedConf,
          source: 'user',
          is_active: true,
          match_count: Number(existingRule.match_count || 0) + 1,
          last_used_at: nowIso,
        })
        .eq('id', finalRuleId)
        .eq('organization_id', orgId);
    }
  } else {
    const initialCorrect = isAccepted ? 1 : 0;
    const initialWrong = isCorrected ? 1 : 0;
    const initialConf = computeCalibratedRuleConfidence(initialCorrect, initialWrong, false);

    const insertBody: Record<string, any> = {
      id: finalRuleId,
      organization_id: orgId,
      pattern: normalizedPattern,
      category_id: params.categoryId,
      department_id: params.departmentId || null,
      project_id: params.projectId || null,
      world_scope: world,
      version: 1,
      status: 'active',
      scope: candidate.scope,
      match: candidate.match,
      prediction: candidate.prediction,
      confidence_policy: candidate.confidence_policy,
      priority: candidate.priority,
      explanation: candidate.explanation,
      confidence: initialConf,
      source: params.source || 'user',
      is_active: true,
      match_count: 1,
      times_applied: 1,
      correct_count: initialCorrect,
      wrong_count: initialWrong,
      times_confirmed: 1,
      effective_from: nowIso,
      last_used_at: nowIso,
      created_by: params.actorUserId || null,
    };

    const { data: insData, error: insErr } = await sb
      .from('classification_rules')
      .insert(insertBody)
      .select('id')
      .maybeSingle();

    if (insErr) {
      // Fallback for legacy UUID-PK schema
      const { data: legacyIns } = await sb
        .from('classification_rules')
        .insert({
          organization_id: orgId,
          pattern: normalizedPattern,
          category_id: params.categoryId,
          confidence: initialConf,
          source: 'user',
          match_count: 1,
          is_active: true,
          last_used_at: nowIso,
        })
        .select('id')
        .maybeSingle();
      if (legacyIns?.id) finalRuleId = String(legacyIns.id);
    } else if (insData?.id) {
      finalRuleId = String(insData.id);
    }
  }

  // Sync categories.patterns so Learned Patterns tab reflects learning immediately
  try {
    const { data: catRows } = await sb
      .from('categories')
      .select('id, organization_id, name, type, account_id, color, icon, patterns')
      .eq('organization_id', orgId);

    if (catRows && catRows.length > 0) {
      const domainCats: Category[] = catRows.map((c: any) => ({
        id: String(c.id),
        organizationId: orgId,
        name: String(c.name),
        type: c.type as Category['type'],
        accountId: String(c.account_id || ''),
        color: String(c.color || '#888888'),
        icon: String(c.icon || 'tag'),
        patterns: Array.isArray(c.patterns) ? c.patterns : [],
      }));

      const updatedCats = learnFromFeedback(
        params.narration || normalizedPattern,
        params.categoryId,
        params.previousCategoryId || null,
        domainCats
      );

      const targetCat = updatedCats.find(c => c.id === params.categoryId);
      if (targetCat) {
        const merged = Array.from(new Set([...(targetCat.patterns || []), normalizedPattern])).slice(0, 50);
        await sb.from('categories').update({ patterns: merged }).eq('id', params.categoryId).eq('organization_id', orgId);
      }
      if (params.previousCategoryId && params.previousCategoryId !== params.categoryId) {
        const prevCat = updatedCats.find(c => c.id === params.previousCategoryId);
        if (prevCat) {
          await sb.from('categories').update({ patterns: prevCat.patterns || [] }).eq('id', params.previousCategoryId).eq('organization_id', orgId);
        }
      }
    }
  } catch (patErr) {
    console.warn('[learningEngine] Category pattern sync warning:', patErr);
  }

  return {
    ruleId: finalRuleId,
    version: finalVersion,
    pattern: normalizedPattern,
    collisionWarning: evaluation.collisionWarning,
  };
}

/**
 * Writes an immutable audit record to `classification_evidence` (§11 Observability).
 */
export async function recordClassificationEvidence(
  sb: SupabaseClient | null,
  orgId: string,
  payload: {
    transactionId: string;
    rawNarration: string;
    normalizedTokens?: string[];
    candidateRules?: any[];
    selectedRuleId?: string | null;
    selectedRuleVersion?: number | null;
    modelVersion?: string | null;
    confidence: number;
    confidenceBand: 'high' | 'medium' | 'low';
    riskFlags?: string[];
    decisionReason: string;
    placement: 'auto_approved' | 'bulk_review' | 'manual_review';
    humanFeedback?: Record<string, unknown> | null;
    finalDecision?: Record<string, unknown> | null;
    actorId?: string | null;
  }
): Promise<void> {
  if (!sb || !payload.transactionId) return;
  try {
    await sb.from('classification_evidence').insert({
      organization_id: orgId,
      transaction_id: payload.transactionId,
      raw_narration: payload.rawNarration || '',
      normalized_tokens: payload.normalizedTokens || [],
      candidate_rules: payload.candidateRules || [],
      selected_rule_id: payload.selectedRuleId || null,
      selected_rule_version: payload.selectedRuleVersion || null,
      model_version_if_any: payload.modelVersion || null,
      confidence: Math.min(100, Math.max(0, Number(payload.confidence || 0))),
      confidence_band: payload.confidenceBand || 'medium',
      risk_flags: payload.riskFlags || [],
      decision_reason: payload.decisionReason || 'Classified',
      placement: payload.placement || 'manual_review',
      human_feedback: payload.humanFeedback || null,
      final_decision: payload.finalDecision || null,
      actor_id: payload.actorId || null,
    });
  } catch {
    /* graceful if migration 0017 not applied */
  }
}

/**
 * Computes REAL monthly accuracy trends and per-category accuracy from Supabase
 * `classification_feedback` and `transactions` (replaces mock/hashed UI charts).
 */
export async function getRealPerformanceMetrics(
  sb: SupabaseClient | null,
  orgId: string,
  categories: Category[]
): Promise<{
  monthlyTrend: Array<{ month: string; label: string; total: number; accepted: number; corrected: number; accuracy: number | null }>;
  categoryPerformance: Array<{ categoryId: string; categoryName: string; icon: string; color: string; total: number; accepted: number; corrected: number; avgConfidence: number; accuracy: number | null }>;
  totalFeedback: number;
}> {
  const now = new Date();
  const monthBuckets: Array<{ key: string; label: string; total: number; accepted: number; corrected: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    monthBuckets.push({ key, label, total: 0, accepted: 0, corrected: 0 });
  }

  if (!sb) {
    return {
      monthlyTrend: monthBuckets.map(b => ({ month: b.key, label: b.label, total: 0, accepted: 0, corrected: 0, accuracy: null })),
      categoryPerformance: [],
      totalFeedback: 0,
    };
  }

  const [{ data: fbRows }, { data: txnRows }] = await Promise.all([
    sb
      .from('classification_feedback')
      .select('action, final_category_id, suggested_category_id, suggested_confidence, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1000),
    sb
      .from('transactions')
      .select('category_id, confidence, classified_by, date')
      .eq('organization_id', orgId)
      .not('category_id', 'is', null)
      .order('date', { ascending: false })
      .limit(1000),
  ]);

  const feedbacks = fbRows || [];
  const txns = txnRows || [];

  // Aggregate monthly trend from real feedback rows
  const bucketMap = new Map(monthBuckets.map(b => [b.key, b]));
  for (const fb of feedbacks) {
    const dt = fb.created_at ? new Date(fb.created_at) : null;
    if (!dt || Number.isNaN(dt.getTime())) continue;
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (fb.action === 'accepted') bucket.accepted += 1;
    else if (fb.action === 'corrected' || fb.action === 'rejected') bucket.corrected += 1;
  }

  // Aggregate per-category real stats
  const catStats = new Map<string, { total: number; accepted: number; corrected: number; confSum: number; confCount: number }>();
  for (const fb of feedbacks) {
    const cid = String(fb.final_category_id || fb.suggested_category_id || '');
    if (!cid) continue;
    const st = catStats.get(cid) || { total: 0, accepted: 0, corrected: 0, confSum: 0, confCount: 0 };
    st.total += 1;
    if (fb.action === 'accepted') st.accepted += 1;
    else if (fb.action === 'corrected' || fb.action === 'rejected') st.corrected += 1;
    catStats.set(cid, st);
  }

  for (const t of txns) {
    const cid = String(t.category_id || '');
    if (!cid) continue;
    const st = catStats.get(cid) || { total: 0, accepted: 0, corrected: 0, confSum: 0, confCount: 0 };
    if (t.confidence != null) {
      const cVal = Number(t.confidence);
      const norm = cVal <= 1 && cVal > 0 ? Math.round(cVal * 100) : Math.round(cVal);
      st.confSum += norm;
      st.confCount += 1;
    }
    catStats.set(cid, st);
  }

  const categoryPerformance = categories
    .map(cat => {
      const st = catStats.get(cat.id);
      const feedbackTotal = st ? st.accepted + st.corrected : 0;
      const accuracy = feedbackTotal > 0 ? Math.round((st!.accepted / feedbackTotal) * 1000) / 10 : null;
      const avgConfidence = st && st.confCount > 0 ? Math.round(st.confSum / st.confCount) : 0;
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        icon: cat.icon || 'tag',
        color: cat.color || '#38bdf8',
        total: st?.confCount || feedbackTotal || 0,
        accepted: st?.accepted || 0,
        corrected: st?.corrected || 0,
        avgConfidence,
        accuracy,
      };
    })
    .filter(c => c.total > 0 || c.accepted > 0 || c.corrected > 0)
    .sort((a, b) => (b.accepted + b.corrected + b.total) - (a.accepted + a.corrected + a.total))
    .slice(0, 8);

  return {
    monthlyTrend: monthBuckets.map(b => ({
      month: b.key,
      label: b.label,
      total: b.total,
      accepted: b.accepted,
      corrected: b.corrected,
      accuracy: b.total > 0 ? Math.round((b.accepted / b.total) * 1000) / 10 : null,
    })),
    categoryPerformance,
    totalFeedback: feedbacks.length,
  };
}

/**
 * Computes calibrated rule confidence (0..100) from real historical confirmations & corrections (§11).
 */
export function computeCalibratedRuleConfidence(
  correctCount: number,
  wrongCount: number,
  isExistingRule: boolean
): number {
  const c = Math.max(0, Number(correctCount || 0));
  const w = Math.max(0, Number(wrongCount || 0));
  const total = c + w;
  if (total === 0) return isExistingRule ? 90 : 88;
  // Bayesian smoothing with conservative prior (alpha=4, beta=0.5)
  const raw = ((c + 4) / (total + 4.5)) * 100;
  return Math.max(45, Math.min(99, Math.round(raw)));
}

/**
 * Checks whether a transaction is posted/reconciled or inside a locked accounting period (§8, §11, §33 #3).
 */
export async function isTransactionImmutable(
  sb: SupabaseClient | null,
  orgId: string,
  txn: { status?: string | null; date?: string | null }
): Promise<{ immutable: boolean; reason?: string }> {
  const status = String(txn.status || '').toLowerCase();
  if (status === 'posted' || status === 'reconciled') {
    return {
      immutable: true,
      reason: `ALREADY_POSTED: Transaction is ${status} and immutable. Perform an authorized reversal instead of mutating classification.`,
    };
  }
  if (sb && txn.date) {
    try {
      const { data: lockedPeriods } = await sb
        .from('accounting_periods')
        .select('id, status')
        .eq('organization_id', orgId)
        .lte('start_date', txn.date)
        .gte('end_date', txn.date)
        .in('status', ['soft_closed', 'locked'])
        .limit(1);
      if (lockedPeriods && lockedPeriods.length > 0) {
        return {
          immutable: true,
          reason: 'PERIOD_CLOSED: Transaction falls inside a closed or locked accounting period.',
        };
      }
    } catch {
      /* graceful if accounting_periods table not present */
    }
  }
  return { immutable: false };
}

/**
 * Increments match_count, times_applied, and last_used_at when rules fire during classification (§11).
 */
export async function recordRuleMatchUsage(
  sb: SupabaseClient | null,
  orgId: string,
  ruleIds: string[]
): Promise<void> {
  if (!sb || ruleIds.length === 0) return;
  const uniqueIds = Array.from(new Set(ruleIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  const nowIso = new Date().toISOString();

  try {
    const { data: rows } = await sb
      .from('classification_rules')
      .select('id, match_count, times_applied')
      .eq('organization_id', orgId)
      .in('id', uniqueIds);

    for (const r of rows || []) {
      const nextMatch = Number(r.match_count || 0) + 1;
      const nextApplied = Number(r.times_applied ?? r.match_count ?? 0) + 1;
      await sb
        .from('classification_rules')
        .update({
          match_count: nextMatch,
          times_applied: nextApplied,
          last_used_at: nowIso,
        })
        .eq('id', r.id)
        .eq('organization_id', orgId);
    }
  } catch {
    /* non-fatal telemetry update */
  }
}

/**
 * Persists an explicit rejection of AI/rule suggestions without posting the transaction (§11).
 * Increments wrong_count/false_positive_count on matching rules and auto-disables noisy rules (>= 3).
 */
export async function recordFeedbackRejection(
  sb: SupabaseClient,
  orgId: string,
  params: {
    transactionId: string;
    suggestedCategoryId?: string | null;
    suggestedConfidence?: number | null;
    reason?: string | null;
    actorUserId?: string | null;
  }
): Promise<{ feedbackId?: string; disabledRules: string[] }> {
  const { data: txn } = await sb
    .from('transactions')
    .select('id, narration, description, status, date, suggested_category_id, confidence, ai_reasoning')
    .eq('id', params.transactionId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (!txn) {
    throw new Error('Transaction not found');
  }

  const imm = await isTransactionImmutable(sb, orgId, txn);
  if (imm.immutable) {
    throw new Error(imm.reason || 'Transaction is immutable');
  }

  const narration = String(txn.narration || txn.description || '').trim();
  const suggestedCatId = params.suggestedCategoryId ?? txn.suggested_category_id ?? null;
  let feedbackId: string | undefined;

  try {
    const { data: fbRow } = await sb
      .from('classification_feedback')
      .insert({
        organization_id: orgId,
        transaction_id: params.transactionId,
        suggested_category_id: suggestedCatId,
        suggested_confidence: params.suggestedConfidence ?? txn.confidence ?? null,
        final_category_id: null,
        action: 'rejected',
        ai_reasoning: txn.ai_reasoning || null,
        correction_reason: params.reason || 'User rejected suggested categories',
        feedback_by: params.actorUserId || null,
      })
      .select('id')
      .maybeSingle();
    if (fbRow?.id) feedbackId = String(fbRow.id);
  } catch (err) {
    console.warn('[learningEngine] recordFeedbackRejection feedback insert warning:', err);
  }

  const disabledRules: string[] = [];
  if (narration) {
    const { merchant } = cleanNarration(narration);
    const pat = (merchant || '').trim().toLowerCase();
    if (pat.length >= 3) {
      const { data: matchedRules } = await sb
        .from('classification_rules')
        .select('id, wrong_count, correct_count, false_positive_count, is_active, category_id')
        .eq('organization_id', orgId)
        .ilike('pattern', pat)
        .eq('is_active', true);

      for (const wr of matchedRules || []) {
        if (suggestedCatId && wr.category_id && wr.category_id !== suggestedCatId) continue;
        const nextWrong = Number(wr.wrong_count || 0) + 1;
        const nextFp = Number(wr.false_positive_count || 0) + 1;
        const shouldDisable = nextWrong >= 3;
        const nextConf = computeCalibratedRuleConfidence(Number(wr.correct_count || 0), nextWrong, true);
        await sb
          .from('classification_rules')
          .update({
            wrong_count: nextWrong,
            false_positive_count: nextFp,
            confidence: nextConf,
            is_active: shouldDisable ? false : wr.is_active,
            status: shouldDisable ? 'disabled' : 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', wr.id)
          .eq('organization_id', orgId);
        if (shouldDisable) disabledRules.push(String(wr.id));
      }
    }
  }

  await recordClassificationEvidence(sb, orgId, {
    transactionId: params.transactionId,
    rawNarration: narration,
    confidence: Number(params.suggestedConfidence ?? txn.confidence ?? 0),
    confidenceBand: 'low',
    riskFlags: ['USER_REJECTED'],
    decisionReason: params.reason || 'User rejected suggested categories',
    placement: 'manual_review',
    humanFeedback: { action: 'rejected', suggestedCategoryId: suggestedCatId, reason: params.reason || null },
    finalDecision: { status: 'pending', categoryId: null },
    actorId: params.actorUserId || null,
  });

  return { feedbackId, disabledRules };
}

/**
 * Applies a human classification decision to matching pending unposted rows in the same batch/org (§11 scope='batch').
 * Never mutates already posted/reconciled rows.
 */
export async function applyMatchingPendingBatchCorrection(
  sb: SupabaseClient,
  orgId: string,
  params: {
    sourceTransactionId: string;
    sourceImportId?: string | null;
    narration: string;
    type: 'debit' | 'credit';
    categoryId: string;
    departmentId?: string;
    world: 'business' | 'personal';
    actorUserId?: string | null;
    rationale?: string;
  }
): Promise<{ updatedCount: number; updatedIds: string[]; bankAccountIds: string[] }> {
  const { merchant, tokens } = cleanNarration(params.narration);
  const matchKey = (merchant || tokens.slice(0, 2).join(' ')).trim().toLowerCase();
  if (!matchKey || matchKey.length < 3) {
    return { updatedCount: 0, updatedIds: [], bankAccountIds: [] };
  }

  let query = sb
    .from('transactions')
    .select('id, bank_account_id, narration, description, status, date, type')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .eq('type', params.type)
    .neq('id', params.sourceTransactionId)
    .limit(200);

  if (params.sourceImportId) {
    query = query.eq('source_import_id', params.sourceImportId);
  }

  const { data: candidates } = await query;
  const matching = (candidates || []).filter((row: any) => {
    const raw = String(row.narration || row.description || '');
    const cleaned = cleanNarration(raw);
    return (
      (cleaned.merchant && cleaned.merchant.toLowerCase() === matchKey) ||
      cleaned.cleaned.includes(matchKey)
    );
  });

  if (matching.length === 0) {
    return { updatedCount: 0, updatedIds: [], bankAccountIds: [] };
  }

  const nowIso = new Date().toISOString();
  const updatedIds: string[] = [];
  const bankAccountIds = new Set<string>();

  for (const row of matching) {
    const imm = await isTransactionImmutable(sb, orgId, row);
    if (imm.immutable) continue;

    const patch: Record<string, any> = {
      category_id: params.categoryId,
      world_scope: params.world,
      status: 'classified',
      classified_at: nowIso,
      classified_by: 'bulk_review',
      confidence: 95,
    };
    if (params.departmentId) patch.department_id = params.departmentId;

    const { error } = await sb
      .from('transactions')
      .update(patch)
      .eq('id', row.id)
      .eq('organization_id', orgId);

    if (!error) {
      updatedIds.push(String(row.id));
      if (row.bank_account_id) bankAccountIds.add(String(row.bank_account_id));
      await recordClassificationEvidence(sb, orgId, {
        transactionId: String(row.id),
        rawNarration: String(row.narration || row.description || ''),
        confidence: 95,
        confidenceBand: 'high',
        riskFlags: [],
        decisionReason: params.rationale || `Batch grouped correction applied from transaction ${params.sourceTransactionId}`,
        placement: 'bulk_review',
        humanFeedback: { action: 'batch_applied', sourceTransactionId: params.sourceTransactionId, world: params.world },
        finalDecision: { categoryId: params.categoryId, departmentId: params.departmentId || null, world: params.world },
        actorId: params.actorUserId || null,
      });
    }
  }

  return {
    updatedCount: updatedIds.length,
    updatedIds,
    bankAccountIds: Array.from(bankAccountIds),
  };
}

/**
 * Fetches immutable archived versions of a classification rule (§11).
 */
export async function getRuleVersionHistory(
  sb: SupabaseClient | null,
  orgId: string,
  ruleId: string
): Promise<any[]> {
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('classification_rule_versions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('rule_id', ruleId)
      .order('version', { ascending: false });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Updates tenant classification policy with monotonic policy_version (§11).
 */
export async function updateTenantClassificationPolicy(
  sb: SupabaseClient,
  orgId: string,
  updates: Partial<{
    highThreshold: number;
    mediumThreshold: number;
    allowsAutoApproval: boolean;
    highValueThreshold: number;
    duplicateWindowDays: number;
  }>
): Promise<TenantPolicy> {
  const current = await loadTenantPolicy(sb, orgId);
  const nextHigh = updates.highThreshold != null ? Math.min(100, Math.max(50, Number(updates.highThreshold))) : current.highThreshold;
  const nextMedium = updates.mediumThreshold != null ? Math.min(nextHigh - 5, Math.max(20, Number(updates.mediumThreshold))) : current.mediumThreshold;
  const nextVersion = current.policyVersion + 1;

  const row = {
    organization_id: orgId,
    high_threshold: nextHigh,
    medium_threshold: nextMedium,
    allows_auto_approval: updates.allowsAutoApproval ?? current.allowsAutoApproval,
    high_value_threshold: updates.highValueThreshold != null ? Math.max(0, Number(updates.highValueThreshold)) : current.highValueThreshold,
    duplicate_window_days: updates.duplicateWindowDays != null ? Math.max(1, Math.round(Number(updates.duplicateWindowDays))) : current.duplicateWindowDays,
    policy_version: nextVersion,
    updated_at: new Date().toISOString(),
  };

  await sb.from('tenant_classification_policies').upsert(row, { onConflict: 'organization_id' });

  return {
    organizationId: orgId,
    highThreshold: row.high_threshold,
    mediumThreshold: row.medium_threshold,
    allowsAutoApproval: row.allows_auto_approval,
    highValueThreshold: row.high_value_threshold,
    duplicateWindowDays: row.duplicate_window_days,
    policyVersion: row.policy_version,
  };
}
