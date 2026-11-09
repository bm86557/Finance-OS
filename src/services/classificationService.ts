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
  ): Promise<ServiceResponse<ClassificationResult>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationResult>(organizationId);
      if (err) return err;
      const res = await apiPostJson<{ narration: string; amount: number; type: 'debit' | 'credit' }, ClassificationResult>(
        `${CLS(organizationId)}/classify`,
        { narration, amount, type },
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

    const result = classifyTransaction(narration, amount, type, categories, previousTxns, classificationRules);
    return { success: true, data: result };
  },

  async batchClassify(
    organizationId: string,
    transactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>,
    useAI: boolean = false,
  ): Promise<ServiceResponse<Map<number, ClassificationResult>>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<Map<number, ClassificationResult>>(organizationId);
      if (err) return err;
      const res = await apiPostJson<
        { transactions: typeof transactions; useAI?: boolean },
        ClassificationResult[] | { results: (ClassificationResult & { index?: number })[] }
      >(`${CLS(organizationId)}/batch`, { transactions, useAI });
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
  ): Promise<ServiceResponse<{ updated: boolean; departmentId?: string }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<{ updated: boolean; departmentId?: string }>(organizationId);
      if (err) return err;

      // Fetch the transaction from API to get its current state for feedback
      let suggestedCategoryId: string | undefined;
      let suggestedConfidence: number | undefined;
      let aiReasoning: string | undefined;

      try {
        const txnResponse = await apiGet<any>(`/organizations/${encodeURIComponent(organizationId)}/transactions/${encodeURIComponent(transactionId)}`);
        if (txnResponse.success && txnResponse.data) {
          suggestedCategoryId = txnResponse.data.suggestedCategoryId || txnResponse.data.suggested_category_id || txnResponse.data.categoryId;
          suggestedConfidence = txnResponse.data.suggestedConfidence || txnResponse.data.suggested_confidence || txnResponse.data.confidence;
          aiReasoning = txnResponse.data.aiReasoning || txnResponse.data.ai_reasoning;
        } else {
          const localTxn = dataStore.transactions.find(t => t.id === transactionId);
          if (localTxn) {
            suggestedCategoryId = localTxn.suggestedCategoryId || localTxn.categoryId;
            suggestedConfidence = localTxn.suggestedConfidence || localTxn.confidence;
            aiReasoning = localTxn.aiReasoning;
          }
        }

      } catch (err) {
        console.warn('[learnFromCorrection] Failed to fetch transaction, using defaults:', err);
      }

      const action = suggestedCategoryId && suggestedCategoryId !== correctCategoryId
        ? 'corrected'
        : 'accepted';

      const feedbackRes = await apiPostJson<{
        transaction_id: string;
        suggested_category_id?: string;
        suggested_confidence?: number;
        final_category_id: string;
        department_id?: string;
        action: string;
        ai_reasoning?: string;
      }, { recorded: boolean; department_id?: string }>(
        `/organizations/${encodeURIComponent(organizationId)}/ai-classification/feedback`,
        {
          transaction_id: transactionId,
          suggested_category_id: suggestedCategoryId,
          suggested_confidence: suggestedConfidence,
          final_category_id: correctCategoryId,
          department_id: departmentId,
          action: action,
          ai_reasoning: aiReasoning,
        },
      );

      if (feedbackRes.success) {
        const assignedDept = departmentId || (feedbackRes.data as any)?.department_id;
        const localTxn = dataStore.transactions.find(t => t.id === transactionId);
        if (localTxn) {
          localTxn.categoryId = correctCategoryId;
          if (assignedDept) {
            localTxn.departmentId = assignedDept;
          }
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
          data: { updated: true, departmentId: assignedDept },
          message: action === 'corrected'
            ? 'Category corrected and pattern learned for future precision'
            : 'Category confirmed and saved to AI learning database'
        };
      } else {
        return {
          success: false,
          data: { updated: false },
          error: feedbackRes.error || 'Failed to record feedback'
        };
      }
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

  async getRules(organizationId?: string): Promise<ServiceResponse<ClassificationRule[]>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<ClassificationRule[]>(organizationId ?? '');
      if (err) return err;
      return apiGet<ClassificationRule[]>(`${CLS(organizationId!)}/rules`);
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
      correctCategoryId: string;
      departmentId?: string;
      projectId?: string;
      scope: 'row' | 'batch' | 'future';
      rationale?: string;
      world?: 'business' | 'personal';
    }
  ): Promise<ServiceResponse<{ updated: boolean; candidateRule?: any }>> {
    if (isHttpBackendConfigured()) {
      const err = requireOrg<{ updated: boolean; candidateRule?: any }>(organizationId);
      if (err) return err;
      return apiPostJson<typeof payload, { updated: boolean; candidateRule?: any }>(
        `${CLS(organizationId)}/learn`,
        payload
      );
    }

    await simulateDelay(150);
    const txn = dataStore.transactions.find(t => t.id === payload.transactionId);
    if (txn) {
      txn.categoryId = payload.correctCategoryId;
      if (payload.departmentId) txn.departmentId = payload.departmentId;
      txn.status = 'classified';
      txn.classifiedBy = 'user';
      txn.confidence = 100;
      dataStore.notify('transactions');
    }
    return { success: true, data: { updated: true } };
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
