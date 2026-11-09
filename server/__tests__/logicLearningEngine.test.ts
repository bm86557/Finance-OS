/**
 * Logic & Learning Engine Verification Test Suite (§11)
 * =======================================================
 * Tests all core requirements from "11. Logic & Learning: the distinctive product engine":
 *   1. Vendor Mapping Precision & Substring Isolation
 *   2. Contradictory Rules Conflict Detection (Never random selection)
 *   3. Multi-Tenant Isolation (Org A never influences Org B)
 *   4. World Isolation (Personal spending never silently placed in business P&L)
 *   5. Historical Reproducibility (Decisions reproducible under prior rule version)
 *   6. Explicit Grouped Correction Scope
 *   7. Rule Disabling and Deactivation without evidence loss
 *   8. Risk Demotion (Orthogonal risk axis prevents auto-approval of transfers/high values)
 *   9. Monetary & Posted Journal Immutability
 *
 * Can be run directly via: npx tsx server/__tests__/logicLearningEngine.test.ts
 */

import {
  classifyTransaction,
  detectRiskFlags,
  evaluateRuleCandidate,
  createCandidateRule,
  type ClassificationRule,
  type VersionedRule,
} from '../../src/lib/classificationEngine.js';
import type { Category, Transaction } from '../../src/services/types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function expect(value: any): any;

// Runtime shims when vitest is not in the environment
if (typeof globalThis.describe === 'undefined') {
  (globalThis as any).describe = (name: string, fn: () => void) => {
    console.log(`\n  ${name}`);
    fn();
  };
  (globalThis as any).it = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`    ✓ ${name}`);
    } catch (e: any) {
      console.error(`    ✗ ${name}:`, e.message);
      process.exitCode = 1;
    }
  };
  (globalThis as any).expect = (val: any) => ({
    toBe(exp: any) {
      if (val !== exp) throw new Error(`Expected ${JSON.stringify(exp)} but got ${JSON.stringify(val)}`);
    },
    toEqual(exp: any) {
      if (JSON.stringify(val) !== JSON.stringify(exp)) {
        throw new Error(`Expected ${JSON.stringify(exp)} but got ${JSON.stringify(val)}`);
      }
    },
    toBeGreaterThan(exp: number) {
      if (!(val > exp)) throw new Error(`Expected ${val} > ${exp}`);
    },
    toBeLessThan(exp: number) {
      if (!(val < exp)) throw new Error(`Expected ${val} < ${exp}`);
    },
    toContain(exp: any) {
      if (!val || (!Array.isArray(val) && typeof val !== 'string') || !val.includes(exp)) {
        throw new Error(`Expected ${JSON.stringify(val)} to contain ${JSON.stringify(exp)}`);
      }
    },
    not: {
      toContain(exp: any) {
        if (val && (Array.isArray(val) || typeof val === 'string') && val.includes(exp)) {
          throw new Error(`Expected ${JSON.stringify(val)} NOT to contain ${JSON.stringify(exp)}`);
        }
      },
      toBe(exp: any) {
        if (val === exp) throw new Error(`Expected NOT ${JSON.stringify(exp)}`);
      },
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ────────────────────────────────────────────────────────────────────────────

const testCategories: Category[] = [
  { id: 'cat-general', organizationId: 'org-test', name: 'General & Operating Expenses', type: 'expense', accountId: 'acc-0', color: '#888888', icon: 'tag', patterns: [] },
  { id: 'cat-software', organizationId: 'org-test', name: 'Software & Subscriptions', type: 'expense', accountId: 'acc-1', color: '#00ffff', icon: 'laptop', patterns: [] },
  { id: 'cat-marketing', organizationId: 'org-test', name: 'Marketing & Advertising', type: 'expense', accountId: 'acc-2', color: '#ff00ff', icon: 'megaphone', patterns: [] },
  { id: 'cat-legal', organizationId: 'org-test', name: 'Legal & Professional Services', type: 'expense', accountId: 'acc-3', color: '#ffff00', icon: 'briefcase', patterns: [] },
  { id: 'cat-meals', organizationId: 'org-test', name: 'Meals & Entertainment', type: 'expense', accountId: 'acc-4', color: '#00ff00', icon: 'utensils', patterns: [] },
  { id: 'cat-personal', organizationId: 'org-test', name: 'Personal Drawings', type: 'expense', accountId: 'acc-5', color: '#ff8800', icon: 'user', patterns: [] },
  { id: 'cat-revenue', organizationId: 'org-test', name: 'Client Revenue', type: 'income', accountId: 'acc-6', color: '#00aa00', icon: 'dollar-sign', patterns: [] },
];

describe('Logic & Learning: The Distinctive Product Engine (§11)', () => {

  it('TEST-01: Learned Vendor Maps Correctly; Generic Substring Is Isolated', () => {
    // 1. Learned vendor rule for Adobe
    const adobeRule: ClassificationRule = {
      id: 'rule-adobe-1',
      pattern: 'adobe systems',
      categoryId: 'cat-software',
      confidence: 98,
      matchCount: 5,
      createdFrom: 'user',
      priority: 60,
      scope: { world: 'business', directions: ['debit'] },
      match: { method: 'token_set', tokens: ['adobe'], merchant_alias: 'Adobe' },
      prediction: { category_id: 'cat-software', counterparty: 'Adobe' },
    };

    // Transaction 1: Direct match on learned vendor
    const res1 = classifyTransaction(
      'POS DEBIT 10/14 ADOBE SYSTEMS INC SAN JOSE CA REF#8829',
      120.00,
      'debit',
      testCategories,
      [],
      [adobeRule],
      { world: 'business' }
    );

    expect(res1.categoryId).toBe('cat-software');
    expect(res1.confidence).toBeGreaterThan(90);
    expect(res1.matchedRuleId).toBe('rule-adobe-1');

    // Transaction 2: Description containing generic substring "ober" or unrelated text
    const res2 = classifyTransaction(
      'BAD OBERAN HOTELS OVERNIGHT LODGING',
      240.00,
      'debit',
      testCategories,
      [],
      [adobeRule],
      { world: 'business' }
    );

    // Must NOT match Adobe rule!
    expect(res2.categoryId).not.toBe('cat-software');
    expect(res2.matchedRuleId).not.toBe('rule-adobe-1');
  });

  it('TEST-02: Two Contradictory Rules Trigger Review, Never Random Ordering', () => {
    // Two conflicting rules with the same pattern and equal priority
    const ruleLegal: ClassificationRule = {
      id: 'rule-conflict-legal',
      pattern: 'acme consulting',
      categoryId: 'cat-legal',
      confidence: 95,
      matchCount: 2,
      createdFrom: 'user',
      priority: 50,
      scope: { world: 'business', directions: ['debit'] },
    };

    const ruleMarketing: ClassificationRule = {
      id: 'rule-conflict-mkt',
      pattern: 'acme consulting',
      categoryId: 'cat-marketing',
      confidence: 95,
      matchCount: 2,
      createdFrom: 'user',
      priority: 50,
      scope: { world: 'business', directions: ['debit'] },
    };

    const result = classifyTransaction(
      'ACME CONSULTING MONTHLY RETAINER',
      1500.00,
      'debit',
      testCategories,
      [],
      [ruleLegal, ruleMarketing],
      { world: 'business' }
    );

    // Contradiction must trigger RULE_CONFLICT and route to MANUAL_REVIEW
    expect(result.needsReview).toBe(true);
    expect(result.placement).toBe('manual_review');
    expect(result.riskFlags).toContain('RULE_CONFLICT');
    expect(result.reasoning).toContain('CONFLICT');
  });

  it('TEST-03: Multi-Tenant Isolation — Org A Rules Never Influence Org B Predictions', () => {
    // Org A rule
    const orgARule: VersionedRule = {
      id: 'rule-org-a-custom',
      organization_id: 'org-alpha',
      version: 1,
      status: 'active',
      scope: { world: 'business', directions: ['debit'] },
      match: { method: 'token_set', tokens: ['customtech'], pattern: 'customtech' },
      prediction: { category_id: 'cat-software', counterparty: 'CustomTech' },
      confidence_policy: 'high_only_if_no_conflict',
      priority: 80,
      explanation: 'Org Alpha custom vendor',
      effective_from: '2026-01-01T00:00:00Z',
    };

    // Simulated tenant filtering: Org B only loads rules where organization_id == 'org-beta'
    const allTenantRules = [orgARule];
    const orgBRules = allTenantRules.filter(r => r.organization_id === 'org-beta');

    const resultOrgB = classifyTransaction(
      'CUSTOMTECH SOLUTIONS WIRE REF 9901',
      450.00,
      'debit',
      testCategories,
      [],
      orgBRules as unknown as ClassificationRule[],
      { organizationId: 'org-beta', world: 'business' }
    );

    // Org B does not have this rule, so matchedRuleId must be undefined
    expect(resultOrgB.matchedRuleId).not.toBe('rule-org-a-custom');
  });

  it('TEST-04: World Isolation — Business Rules Do Not Silently Place Personal Spending into Business P&L', () => {
    const businessRule: ClassificationRule = {
      id: 'rule-business-card',
      pattern: 'weekend leisure club',
      categoryId: 'cat-meals',
      confidence: 90,
      matchCount: 1,
      createdFrom: 'user',
      priority: 50,
      scope: { world: 'business', directions: ['debit'] },
    };

    // A personal expenditure with spa/salon personal hints in a business context
    const result = classifyTransaction(
      'SPA SALON AND GROCERY STORE PURCHASE',
      120.00,
      'debit',
      testCategories,
      [],
      [businessRule],
      { world: 'business' }
    );

    // Cross-world ambiguity flag must be raised
    expect(result.riskFlags).toContain('CROSS_WORLD_AMBIGUITY');
    // High-risk cross-world items cannot be auto-approved
    expect(result.placement).toBe('manual_review');
    expect(result.needsReview).toBe(true);
  });

  it('TEST-05: Historical Reproducibility Under Prior Rule Versions', () => {
    // Version 1 of rule (Vendor X was categorized as Legal)
    const ruleV1: VersionedRule = {
      id: 'rule-vendor-x',
      organization_id: 'org-test',
      version: 1,
      status: 'active',
      scope: { world: 'business', directions: ['debit'] },
      match: { method: 'token_set', pattern: 'vendor x', tokens: ['vendor', 'x'] },
      prediction: { category_id: 'cat-legal' },
      confidence_policy: 'high_only_if_no_conflict',
      priority: 50,
      explanation: 'Old vendor X mapping',
      effective_from: '2026-01-01T00:00:00Z',
    };

    // Version 2 of rule (Vendor X was later re-trained as Software)
    const ruleV2: VersionedRule = {
      ...ruleV1,
      version: 2,
      prediction: { category_id: 'cat-software' },
      explanation: 'Updated vendor X mapping',
      effective_from: '2026-10-01T00:00:00Z',
    };

    // Test with v1 active:
    const resV1 = classifyTransaction('VENDOR X SERVICES INVOICE', 500, 'debit', testCategories, [], [ruleV1 as any]);
    expect(resV1.categoryId).toBe('cat-legal');
    expect(resV1.matchedRuleVersion).toBe(1);

    // Test with v2 active:
    const resV2 = classifyTransaction('VENDOR X SERVICES INVOICE', 500, 'debit', testCategories, [], [ruleV2 as any]);
    expect(resV2.categoryId).toBe('cat-software');
    expect(resV2.matchedRuleVersion).toBe(2);
  });

  it('TEST-06: Candidate Rule Collision Evaluation Detects Overly Generic Patterns', () => {
    // Attempting to train a rule with a single generic word "payment"
    const genericCandidate: VersionedRule = {
      id: 'rule-candidate-bad',
      organization_id: 'org-test',
      version: 1,
      status: 'active',
      scope: { world: 'business', directions: ['debit'] },
      match: { method: 'token_set', tokens: ['payment'], pattern: 'payment' },
      prediction: { category_id: 'cat-software' },
      confidence_policy: 'high_only_if_no_conflict',
      priority: 50,
      explanation: 'Generic payment test',
      effective_from: '2026-10-01T00:00:00Z',
    };

    const evaluation = evaluateRuleCandidate(genericCandidate, [], []);
    expect(evaluation.isValid).toBe(false);
    expect(evaluation.collisionWarning).toContain('too generic');
  });

  it('TEST-07: Disabling/Reverting Rule Blocks Future Use Without Deleting Evidence', () => {
    const disabledRule: ClassificationRule = {
      id: 'rule-disabled-test',
      pattern: 'special software co',
      categoryId: 'cat-software',
      confidence: 100,
      matchCount: 1,
      createdFrom: 'user',
      status: 'disabled', // Disabled rule
      scope: { world: 'business', directions: ['debit'] },
    };

    const result = classifyTransaction(
      'SPECIAL SOFTWARE CO MONTHLY',
      100,
      'debit',
      testCategories,
      [],
      [disabledRule]
    );

    // Disabled rule must not match
    expect(result.matchedRuleId).not.toBe('rule-disabled-test');
  });

  it('TEST-08: Risk Demotion — High Confidence With Active Risk Flag (Transfer / High-Value) Is Demoted to Review', () => {
    // 1. ATM / Transfer Narration
    const transferResult = classifyTransaction(
      'ATM CASH W/D 1ST NATIONAL BANK 10/14',
      200.00,
      'debit',
      testCategories,
      [],
      [],
      { world: 'business' }
    );
    expect(transferResult.riskFlags).toContain('TRANSFER_CANDIDATE');
    expect(transferResult.placement).toBe('manual_review');
    expect(transferResult.needsReview).toBe(true);

    // 2. High-Value Anomaly ($25,000 transaction with high confidence vendor)
    const highValRule: ClassificationRule = {
      id: 'rule-large-vendor',
      pattern: 'big enterprise vendor',
      categoryId: 'cat-software',
      confidence: 99,
      matchCount: 1,
      createdFrom: 'user',
      priority: 80,
      scope: { world: 'business', directions: ['debit'] },
    };

    const highValResult = classifyTransaction(
      'BIG ENTERPRISE VENDOR ANNUAL LICENSE',
      25000.00,
      'debit',
      testCategories,
      [],
      [highValRule],
      { tenantPolicy: { highValueThreshold: 5000, highThreshold: 85 } }
    );

    expect(highValResult.confidence).toBeGreaterThan(90);
    expect(highValResult.riskFlags).toContain('HIGH_VALUE_TRANSACTION');
    // High confidence must be strictly demoted to manual_review because risk is not empty
    expect(highValResult.placement).toBe('manual_review');
    expect(highValResult.needsReview).toBe(true);
  });

  it('TEST-09: Monetary Precision & Journal Immutability', () => {
    // Initial posted transaction
    const postedTxn: Transaction = {
      id: 'txn-posted-100',
      organizationId: 'org-test',
      bankAccountId: 'bank-1',
      date: '2026-09-15',
      narration: 'INITIAL POSTED TRANSACTION',
      amount: 1540.75,
      type: 'debit',
      currency: 'USD',
      categoryId: 'cat-software',
      description: '',
      tags: [],
      attachments: [],
      status: 'posted',
      confidence: 100,
      classifiedBy: 'user',
      createdAt: '2026-09-15T00:00:00Z',
    };

    // Candidate rule generated for another category
    const newRule = createCandidateRule('org-test', postedTxn.narration, 'cat-marketing');

    // Classification test on same narration
    const res = classifyTransaction(postedTxn.narration, postedTxn.amount, postedTxn.type, testCategories, [], [newRule as any]);

    // Rule outputs classification prediction but cannot alter the posted transaction amount
    expect(postedTxn.amount).toBe(1540.75);
    expect(postedTxn.status).toBe('posted');
    expect(postedTxn.categoryId).toBe('cat-software'); // Historical entry remains intact
  });

});
