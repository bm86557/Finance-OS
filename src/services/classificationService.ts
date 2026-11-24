/**
 * AI Classification Service
 * ==========================
 * Wraps the classification engine with service-layer patterns.
 * When `VITE_API_BASE_URL` is set, uses org-scoped REST routes; otherwise `dataStore` + local rules.
 */

import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { dataStore, simulateDelay } from './dataStore';
import type { VersionedRule } from '@/lib/classificationEngine';
import {
  classifyTransaction,
  learnFromFeedback,
  batchClassify,
  ClassificationResult,
  ClassificationRule,
} from '@/lib/classificationEngine';
import type { ServiceResponse } from './types';

const CLS = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/classification`;

function requireOrg<T>(organizationId: string): ServiceResponse<T> | null {
  if (!organizationId.trim()) {
    return { success: false, data: null as unknown as T, error: 'organizationId required' };
  }
  return null;
}

let classificationRules: ClassificationRule[] = [];

export type ClassificationStats = {
  totalTransactions: number;
  autoClassified: number;
  userClassified: number;
  userCorrections?: number;
  pending: number;
  avgConfidence: number;
  accuracyRate: number;
  rulesCount: number;
};

export type ClassificationPerformance = {
  monthlyTrend: Array<{
    month: string;
    label: string;
    total: number;
    accepted: number;
    corrected: number;
    accuracy: number | null;
  }>;
  categoryPerformance: Array<{
    categoryId: string;
    categoryName: string;
    icon: string;
    color: string;
    total: number;
    accepted: number;
    corrected: number;
    avgConfidence: number;
    accuracy: number | null;
  }>;
  totalFeedback: number;
};

function batchResponseToMap(data: unknown): Map<number, ClassificationResult> {
  const map = new Map<number, ClassificationResult>();
  if (Array.isArray(data)) {
    data.forEach((r, i) => {
      const idx = typeof (r as any)?.index === 'number' ? (r as any).index : i;
      map.set(idx, r as ClassificationResult);
    });
    return map;
  }
  if (data && typeof data === 'object' && 'results' in (data as object)) {
    const arr = (data as { results: (ClassificationResult & { index?: number })[] }).results;
    if (Array.isArray(arr)) {
      arr.forEach((r, i) => {
        const idx = typeof r?.index === 'number' ? r.index : i;
        map.set(idx, r);
      });
      return map;
    }
  }
  return map;
}

export const classificationService = {
  async classify(
    organizationId: string,
    narration: string,
    amount: number,
    type: 'debit' | 'credit',
    world?: 'business' | 'personal',
    transactionId?: string,
    useAI?: boolean,
    accountId?: string,
  ): Promise<ServiceResponse<ClassificationResult>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationResult>(organizationId);
      if (err) return err;
      const res = await apiPostJson<
        {
          narration: string;
          amount: number;
          type: 'debit' | 'credit';
          world?: 'business' | 'personal';
          transactionId?: string;
          accountId?: string;
          useAI?: boolean;
        },
        ClassificationResult
      >(
        `${CLS(organizationId)}/classify`,
        {
          narration,
          amount,
          type,
          ...(world ? { world } : {}),
          ...(transactionId ? { transactionId } : {}),
          ...(accountId ? { accountId } : {}),
          ...(useAI !== undefined ? { useAI } : {}),
        },
        { timeoutMs: 45_000 },
      );
      if (res.success && res.data) {
        return res;
      }
      console.warn('[classificationService] Backend classify failed, falling back to local engine:', res.error);
    }

    const { categoryService } = await import('./categoryService');
    const catRes = await categoryService.getAll(organizationId);
    const categories = catRes.data || dataStore.categories.filter(c => c.organizationId === organizationId);
    const previousTxns = dataStore.transactions.filter(t => t.organizationId === organizationId);

    const result = classifyTransaction(narration, amount, type, categories, previousTxns, classificationRules, { world, accountId });
    return { success: true, data: result };
  },

  async batchClassify(
    organizationId: string,
    transactions: Array<{ id?: string; narration: string; amount: number; type: 'debit' | 'credit'; accountId?: string }>,
    useAI: boolean = false,
    forceAI: boolean = false,
  ): Promise<ServiceResponse<Map<number, ClassificationResult>>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Map<number, ClassificationResult>>(organizationId);
      if (err) return err;
      const res = await apiPostJson<
        { transactions: typeof transactions; useAI?: boolean; forceAI?: boolean },
        ClassificationResult[] | { results: (ClassificationResult & { index?: number })[] }
      >(`${CLS(organizationId)}/batch`, { transactions, useAI, forceAI }, { timeoutMs: useAI ? 120_000 : 30_000 });
      if (res.success && res.data != null) {
        return {
          success: true,
          data: batchResponseToMap(res.data),
        };
      }
      console.warn('[classificationService] Backend batchClassify failed, falling back to local engine:', res.error);
    }

    const { categoryService } = await import('./categoryService');
    const catRes = await categoryService.getAll(organizationId);
    const categories = catRes.data || dataStore.categories.filter(c => c.organizationId === organizationId);
    const previousTxns = dataStore.transactions.filter(t => t.organizationId === organizationId);

    const results = batchClassify(transactions, categories, previousTxns, classificationRules);
    return { success: true, data: results };
  },

  async learnFromCorrection(
    organizationId: string,
    transactionId: string,
    correctCategoryId: string,
    departmentId?: string,
    options?: {
      world?: 'business' | 'personal';
      scope?: 'row' | 'batch' | 'future';
      rationale?: string;
    },
  ): Promise<ServiceResponse<{ updated: boolean; departmentId?: string; world?: string; ruleId?: string; batchUpdatedCount?: number }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<{ updated: boolean; departmentId?: string }>(organizationId);
      if (err) return err;

      // Unified §11 endpoint: POST /classification/learn (handles immutability, world_scope, scope, evidence, balance sync)
      const learnRes = await apiPostJson<{
        transactionId: string;
        correctCategoryId: string;
        departmentId?: string;
        world?: 'business' | 'personal';
        scope?: 'row' | 'batch' | 'future';
        rationale?: string;
      }, { updated: boolean; departmentId?: string; world?: string; ruleId?: string; batchUpdatedCount?: number }>(
        `${CLS(organizationId)}/learn`,
        {
          transactionId,
          correctCategoryId,
          ...(departmentId ? { departmentId } : {}),
          ...(options?.world ? { world: options.world } : {}),
          ...(options?.scope ? { scope: options.scope } : {}),
          ...(options?.rationale ? { rationale: options.rationale } : {}),
        },
      );

      if (learnRes.success) {
        const assignedDept = departmentId || learnRes.data?.departmentId;
        const localTxn = dataStore.transactions.find(t => t.id === transactionId);
        if (localTxn) {
          localTxn.categoryId = correctCategoryId;
          if (assignedDept) localTxn.departmentId = assignedDept;
          localTxn.classifiedBy = 'user';
          localTxn.status = 'classified';
          localTxn.confidence = 100;
        }
        dataStore.notify('transactions');
        dataStore.notify('departments');
        dataStore.notify('classification-rules');
        dataStore.notify('categories');

        return {
          success: true,
          data: {
            updated: true,
            departmentId: assignedDept,
            world: learnRes.data?.world,
            ruleId: learnRes.data?.ruleId,
            batchUpdatedCount: learnRes.data?.batchUpdatedCount,
          },
          message: learnRes.message || 'Classification updated and learned',
        };
      }
      return {
        success: false,
        data: { updated: false },
        error: learnRes.error || 'Failed to record learning feedback',
      };
    }

    await simulateDelay(150);

    const txn = dataStore.transactions.find(t => t.id === transactionId);
    if (!txn) return { success: false, data: { updated: false }, error: 'Transaction not found' };

    const categories = dataStore.categories.filter(c => c.organizationId === organizationId);
    const previousCategoryId = txn.categoryId || null;

    const updatedCategories = learnFromFeedback(
      txn.narration,
      correctCategoryId,
      previousCategoryId,
      categories,
    );

    for (const updated of updatedCategories) {
      const idx = dataStore.categories.findIndex(c => c.id === updated.id);
      if (idx !== -1) {
        dataStore.categories[idx] = updated;
      }
    }

    const txnIdx = dataStore.transactions.findIndex(t => t.id === transactionId);
    if (txnIdx !== -1) {
      dataStore.transactions[txnIdx] = {
        ...dataStore.transactions[txnIdx],
        categoryId: correctCategoryId,
        status: 'classified',
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'user',
        confidence: 100,
      };
    }

    const rule: ClassificationRule = {
      id: `rule-${Date.now()}`,
      pattern: txn.narration,
      categoryId: correctCategoryId,
      confidence: 95,
      matchCount: 1,
      createdFrom: 'user',
      lastUsed: new Date().toISOString(),
    };
    classificationRules.push(rule);

    dataStore.notify('categories');
    dataStore.notify('transactions');
    dataStore.notify('classification-rules');

    return { success: true, data: { updated: true }, message: 'Classification updated and learned' };
  },

  async getRules(organizationId?: string, includeInactive: boolean = false): Promise<ServiceResponse<ClassificationRule[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationRule[]>(organizationId ?? '');
      if (err) return err;
      const qs = includeInactive ? '?includeInactive=true' : '';
      return apiGet<ClassificationRule[]>(`${CLS(organizationId!)}/rules${qs}`);
    }

    await simulateDelay();
    return { success: true, data: [...classificationRules] };
  },

  async addRule(
    rule: Omit<ClassificationRule, 'id'>,
    organizationId?: string,
  ): Promise<ServiceResponse<ClassificationRule>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationRule>(organizationId ?? '');
      if (err) return err;
      return apiPostJson<Omit<ClassificationRule, 'id'>, ClassificationRule>(
        `${CLS(organizationId!)}/rules`,
        rule,
      );
    }

    await simulateDelay(150);
    const newRule: ClassificationRule = { ...rule, id: `rule-${Date.now()}` };
    classificationRules.push(newRule);
    dataStore.notify('classification-rules');
    return { success: true, data: newRule, message: 'Rule added' };
  },

  async updateRule(
    ruleId: string,
    updates: Partial<Omit<ClassificationRule, 'id'>>,
    organizationId?: string,
  ): Promise<ServiceResponse<ClassificationRule>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationRule>(organizationId ?? '');
      if (err) return err;
      return apiRequest<ClassificationRule>(`${CLS(organizationId!)}/rules/${encodeURIComponent(ruleId)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    }

    await simulateDelay(150);
    const idx = classificationRules.findIndex(r => r.id === ruleId);
    if (idx === -1) return { success: false, data: null as any, error: 'Rule not found' };
    classificationRules[idx] = { ...classificationRules[idx], ...updates };
    dataStore.notify('classification-rules');
    return { success: true, data: classificationRules[idx], message: 'Rule updated' };
  },

  async deleteRule(ruleId: string, organizationId?: string): Promise<ServiceResponse<null>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<null>(organizationId ?? '');
      if (err) return err;
      return apiRequest<null>(`${CLS(organizationId!)}/rules/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
      });
    }

    await simulateDelay(100);
    classificationRules = classificationRules.filter(r => r.id !== ruleId);
    dataStore.notify('classification-rules');
    return { success: true, data: null, message: 'Rule deleted' };
  },

  async getStats(organizationId: string): Promise<ServiceResponse<ClassificationStats>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationStats>(organizationId);
      if (err) return err;
      return apiGet<ClassificationStats>(`${CLS(organizationId)}/stats`);
    }

    await simulateDelay();

    const txns = dataStore.transactions.filter(t => t.organizationId === organizationId);
    const autoClassified = txns.filter(t => t.classifiedBy === 'auto' || t.classifiedBy === 'ai').length;
    const userClassified = txns.filter(t => t.classifiedBy === 'user').length;
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

    return {
      success: true,
      data: {
        totalTransactions: txns.length,
        autoClassified,
        userClassified,
        userCorrections: 0,
        pending,
        avgConfidence,
        accuracyRate: 100,
        rulesCount: classificationRules.length,
      },
    };
  },

  async recordHumanOverride(
    organizationId: string,
    payload: {
      transactionId: string;
      correctCategoryId?: string;
      departmentId?: string;
      projectId?: string;
      scope: 'row' | 'batch' | 'future';
      rationale?: string;
      world?: 'business' | 'personal';
      proposedNewCategory?: any;
    }
  ): Promise<ServiceResponse<{
    updated: boolean;
    categoryId?: string;
    departmentId?: string;
    ruleId?: string;
    ruleVersion?: number;
    ruleLearned?: boolean;
    batchUpdatedCount?: number;
    collisionWarning?: string;
    world?: 'business' | 'personal';
    scope?: 'row' | 'batch' | 'future';
  }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      const res = await apiPostJson<typeof payload, any>(
        `${CLS(organizationId)}/learn`,
        payload
      );
      if (res.success) {
        dataStore.notify('transactions');
        dataStore.notify('departments');
        dataStore.notify('classification-rules');
        dataStore.notify('categories');
      }
      return res;
    }

    await simulateDelay(150);
    const txn = dataStore.transactions.find(t => t.id === payload.transactionId);
    if (txn && payload.correctCategoryId) {
      txn.categoryId = payload.correctCategoryId;
      if (payload.departmentId) txn.departmentId = payload.departmentId;
      txn.status = 'classified';
      txn.classifiedBy = 'user';
      txn.confidence = 100;
      dataStore.notify('transactions');
    }
    return { success: true, data: { updated: true } };
  },

  async rejectSuggestion(
    organizationId: string,
    transactionId: string,
    options?: {
      suggestedCategoryId?: string;
      suggestedConfidence?: number;
      reason?: string;
    }
  ): Promise<ServiceResponse<{ rejected: boolean; feedbackId?: string; disabledRules?: string[] }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      const res = await apiPostJson<any, any>(
        `${CLS(organizationId)}/reject`,
        {
          transactionId,
          ...(options?.suggestedCategoryId ? { suggestedCategoryId: options.suggestedCategoryId } : {}),
          ...(options?.suggestedConfidence != null ? { suggestedConfidence: options.suggestedConfidence } : {}),
          ...(options?.reason ? { reason: options.reason } : {}),
        }
      );
      if (res.success) {
        dataStore.notify('classification-rules');
      }
      return res;
    }
    await simulateDelay(100);
    return { success: true, data: { rejected: true, disabledRules: [] } };
  },

  async getRuleVersions(
    organizationId: string,
    ruleId: string
  ): Promise<ServiceResponse<any[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any[]>(organizationId);
      if (err) return err;
      return apiGet<any[]>(`${CLS(organizationId)}/rules/${encodeURIComponent(ruleId)}/versions`);
    }
    await simulateDelay(50);
    return { success: true, data: [] };
  },

  async getPolicy(organizationId: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${CLS(organizationId)}/policy`);
    }
    await simulateDelay(50);
    return { success: true, data: { highThreshold: 85, mediumThreshold: 60, allowsAutoApproval: true, highValueThreshold: 5000, duplicateWindowDays: 7, policyVersion: 1 } };
  },

  async updatePolicy(organizationId: string, updates: Record<string, unknown>): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiRequest<any>(`${CLS(organizationId)}/policy`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    }
    await simulateDelay(50);
    return { success: true, data: updates };
  },

  async revertRuleVersion(
    organizationId: string,
    ruleId: string,
    targetVersion: number,
    reason?: string
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiPostJson<{ targetVersion: number; reason?: string }, any>(
        `${CLS(organizationId)}/rules/${encodeURIComponent(ruleId)}/revert`,
        { targetVersion, reason }
      );
    }

    await simulateDelay(100);
    return { success: true, data: { reverted: true, targetVersion } };
  },

  async setRuleStatus(
    organizationId: string,
    ruleId: string,
    status: 'active' | 'disabled' | 'archived'
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiRequest<any>(
        `${CLS(organizationId)}/rules/${encodeURIComponent(ruleId)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }
      );
    }

    await simulateDelay(100);
    const rule = classificationRules.find(r => r.id === ruleId);
    if (rule) {
      (rule as any).status = status;
      dataStore.notify('classification-rules');
    }
    return { success: true, data: { status } };
  },

  async simulateRuleCollision(
    organizationId: string,
    candidateRule: any
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiPostJson<{ candidateRule: any }, any>(
        `${CLS(organizationId)}/rules/simulate-collision`,
        { candidateRule }
      );
    }

    await simulateDelay(100);
    return {
      success: true,
      data: {
        isValid: true,
        matchedSampleCount: 1,
        conflictingRuleCount: 0,
      },
    };
  },

  async getBulkReviewGroups(
    organizationId: string
  ): Promise<ServiceResponse<Array<{ key: string; predictedCategoryId: string; count: number; transactionIds: string[]; merchant: string }>>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${CLS(organizationId)}/bulk-review`);
    }

    await simulateDelay(100);
    return { success: true, data: [] };
  },

  async approveBulkReviewGroup(
    organizationId: string,
    transactionIds: string[],
    categoryId: string
  ): Promise<ServiceResponse<{ approvedCount: number }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiPostJson<{ transactionIds: string[]; categoryId: string }, any>(
        `${CLS(organizationId)}/bulk-review/approve`,
        { transactionIds, categoryId }
      );
    }

    await simulateDelay(100);
    return { success: true, data: { approvedCount: transactionIds.length } };
  },

  async getDriftMetrics(
    organizationId: string
  ): Promise<ServiceResponse<{ acceptanceRate: number; overrideCount: number; activeRules: number; falsePositives: number }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${CLS(organizationId)}/drift`);
    }

    await simulateDelay(100);
    return {
      success: true,
      data: {
        acceptanceRate: 98,
        overrideCount: 2,
        activeRules: classificationRules.length,
        falsePositives: 0,
      },
    };
  },

  async getPerformance(organizationId: string): Promise<ServiceResponse<ClassificationPerformance>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationPerformance>(organizationId);
      if (err) return err;
      return apiGet<ClassificationPerformance>(`${CLS(organizationId)}/performance`);
    }

    await simulateDelay(50);
    return {
      success: true,
      data: { monthlyTrend: [], categoryPerformance: [], totalFeedback: 0 },
    };
  },

  async getTransactionEvidence(
    organizationId: string,
    transactionId: string
  ): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<any>(organizationId);
      if (err) return err;
      return apiGet<any>(`${CLS(organizationId)}/evidence/${encodeURIComponent(transactionId)}`);
    }

    await simulateDelay(50);
    return { success: true, data: null };
  },
};
