/**
 * Employee AI Assistant & RAG Invariants Test Suite
 * ==================================================
 * Aligned with FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md (§5, §13, §29 X-09, §33).
 *
 * Verifies:
 * 1. Scope Isolation & Confidentiality: Assistant only references caller's personal data.
 * 2. RAG Policy Retrieval: Accurate token and keyword matching for expense and timesheet rules.
 * 3. Proactive Contextual Suggestions: Dynamically generated chips based on real employee state.
 * 4. Deterministic Fallback Quality: Rich, empathetic, and compliant answers without hallucination.
 * 5. Guarded Action Recommendation (§29 X-09): Detects expense intent and produces unposted draft cards.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function expect(value: any): {
  toBe(expected: any): void;
  toBeGreaterThan(expected: number): void;
  toContain(expected: string): void;
  not: {
    toContain(expected: string): void;
  };
};

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
    toBeGreaterThan(exp: number) {
      if (val <= exp) throw new Error(`Expected ${val} > ${exp}`);
    },
    toContain(exp: string) {
      if (typeof val === 'string' && !val.includes(exp)) {
        throw new Error(`Expected string to contain "${exp}"`);
      }
      if (Array.isArray(val) && !val.includes(exp)) {
        throw new Error(`Expected array to contain ${JSON.stringify(exp)}`);
      }
    },
    not: {
      toContain(exp: string) {
        if (typeof val === 'string' && val.includes(exp)) {
          throw new Error(`Expected string NOT to contain "${exp}"`);
        }
      },
    },
  });
}

import {
  retrieveRelevantPolicies,
  generateContextualSuggestions,
  generateDeterministicEmployeeReply,
  detectActionRecommendation,
  type EmployeeFinancialDossier,
  type PolicyDocument,
} from '../services/employeeContextEngine.js';

describe('Employee AI Assistant & RAG Engine', () => {
  const samplePolicies: PolicyDocument[] = [
    {
      id: 'pol_expense_general',
      category: 'expense_policy',
      title: 'General Expense Reimbursement Policy',
      content: 'Itemized receipts required for claims over $25. Must submit within 30 days.',
      keywords: ['expense', 'receipt', 'reimbursement', 'claim', 'limit'],
    },
    {
      id: 'pol_expense_meals',
      category: 'expense_policy',
      title: 'Meals, Entertainment & Per Diem Limits',
      content: 'Meals during business travel or overtime are reimbursable up to $50/day. Itemized receipts required.',
      keywords: ['meal', 'food', 'lunch', 'dinner', 'per diem'],
    },
    {
      id: 'pol_expense_software',
      category: 'expense_policy',
      title: 'Software, Licenses & Cloud Services',
      content: 'Software subscriptions, SSL certificates, and cloud services must have official invoice attached.',
      keywords: ['software', 'subscription', 'license', 'ssl', 'cloud'],
    },
    {
      id: 'pol_timesheet_submission',
      category: 'timesheet_policy',
      title: 'Weekly Timesheet & 40-Hour Target',
      content: 'Standard expectation is 40 hours per week. Submit weekly by Friday 5 PM.',
      keywords: ['timesheet', 'hours', 'target', '40 hours'],
    },
    {
      id: 'pol_rejection_resolution',
      category: 'expense_policy',
      title: 'Handling Expense Rejections & Resubmission',
      content: 'Review rejection reason, edit claim, attach missing receipt, and resubmit.',
      keywords: ['rejected', 'rejection', 'resubmit', 'fix'],
    },
  ];

  const mockDossier: EmployeeFinancialDossier = {
    organizationId: 'org_test_123',
    organizationName: 'Finance OS Test Agency',
    baseCurrency: 'USD',
    userId: 'usr_emp_456',
    employeeName: 'Bilal Malik',
    employeeEmail: 'bilal@financeos.io',
    department: 'Engineering',
    position: 'Full Stack Engineer',
    expenses: {
      totalCount: 3,
      totalAmount: 349.0,
      pendingCount: 1,
      pendingAmount: 100.0,
      approvedCount: 1,
      approvedAmount: 100.0,
      reimbursedCount: 0,
      reimbursedAmount: 0,
      rejectedCount: 1,
      rejectedAmount: 149.0,
      recentExpenses: [
        {
          id: 'exp_ssl_1',
          date: '2026-11-02',
          description: 'Dev Server SSL Certificate',
          amount: 149.0,
          currency: 'USD',
          category: 'Software',
          status: 'rejected',
          rejectionReason: 'Missing official tax invoice / license proof',
        },
        {
          id: 'exp_client_meal',
          date: '2026-11-05',
          description: 'Client Lunch with MQ',
          amount: 100.0,
          currency: 'USD',
          category: 'Meals & Entertainment',
          status: 'submitted',
        },
      ],
      byCategory: {
        Software: { count: 1, amount: 149.0 },
        'Meals & Entertainment': { count: 1, amount: 100.0 },
      },
    },
    timesheets: {
      hoursThisWeek: 32,
      hoursLastWeek: 40,
      totalHoursLogged: 72,
      hoursTarget: 40,
      hoursRemaining: 8,
      status: 'on_track',
      weeklyDays: [
        { day: 'Mon', date: '2026-11-09', hours: 8 },
        { day: 'Tue', date: '2026-11-10', hours: 8 },
        { day: 'Wed', date: '2026-11-11', hours: 8 },
        { day: 'Thu', date: '2026-11-12', hours: 8 },
        { day: 'Fri', date: '2026-11-13', hours: 0 },
      ],
      recentEntries: [],
    },
    tasks: {
      activeProjectsCount: 2,
      completedTasksCount: 3,
      totalTasksCount: 3,
      assignedTasks: [],
    },
    payslip: {
      hasPayslip: true,
      period: 'October 2026',
      grossPay: 4500.0,
      netPay: 3800.0,
      deductions: 700.0,
      currency: 'USD',
    },
    matchedPolicies: samplePolicies,
  };

  it('1. RAG Policy Retrieval matches relevant policies based on query intent', () => {
    const mealMatches = retrieveRelevantPolicies('Can I claim lunch for client meeting?', samplePolicies);
    expect(mealMatches.length).toBeGreaterThan(0);
    expect(mealMatches[0].id).toBe('pol_expense_meals');

    const softwareMatches = retrieveRelevantPolicies('Do I get reimbursed for dev server ssl certificates?', samplePolicies);
    expect(softwareMatches.length).toBeGreaterThan(0);
    expect(softwareMatches[0].id).toBe('pol_expense_software');

    const rejectionMatches = retrieveRelevantPolicies('Why was my claim rejected?', samplePolicies);
    expect(rejectionMatches.length).toBeGreaterThan(0);
    expect(rejectionMatches[0].id).toBe('pol_rejection_resolution');
  });

  it('2. Proactive Contextual Suggestions are dynamically generated based on current employee status', () => {
    const suggestions = generateContextualSuggestions(mockDossier);
    expect(suggestions.length).toBeGreaterThan(2);

    // Because an expense is rejected, should prompt about the rejection
    const hasRejectionPrompt = suggestions.some((s) => s.includes('Dev Server SSL Certificate') || s.includes('rejected'));
    expect(hasRejectionPrompt).toBe(true);

    // Because hours < 40, should prompt about remaining hours
    const hasHoursPrompt = suggestions.some((s) => s.includes('hours') && s.includes('40h'));
    expect(hasHoursPrompt).toBe(true);
  });

  it('3. Deterministic Fallback answers rejection inquiries with specific rejection reasons & fix steps', () => {
    const res = generateDeterministicEmployeeReply(mockDossier, 'Why was my Dev Server SSL Certificate rejected?');
    expect(res.reply).toContain('Dev Server SSL Certificate');
    expect(res.reply).toContain('$149.00');
    expect(res.reply).toContain('Missing official tax invoice / license proof');
    expect(res.reply).toContain('Resubmit for Review');
  });

  it('4. Timesheet inquiry provides accurate hours breakdown & remaining balance', () => {
    const res = generateDeterministicEmployeeReply(mockDossier, 'How many hours have I logged this week?');
    expect(res.reply).toContain('32h');
    expect(res.reply).toContain('40h');
    expect(res.reply).toContain('8h remaining');
  });

  it('5. Guarded Action Detection produces an unposted draft card for purchase inquiries (§29 X-09)', () => {
    const action = detectActionRecommendation('I spent $45 on team lunch, how do I submit it?', '');
    expect(action !== null).toBe(true);
    expect(action?.type).toBe('draft_expense');
    expect(action?.payload.amount).toBe(45);
    expect(action?.payload.category).toBe('Meals & Entertainment');
  });

  it('6. Strict scope isolation: Assistant reply does not leak executive net worth or company P&L', () => {
    const res = generateDeterministicEmployeeReply(mockDossier, 'What is the company profit or net worth?');
    expect(res.reply).not.toContain('liquidNetWorth');
    expect(res.reply).not.toContain('ownerDrawingsRatio');
    expect(res.reply).not.toContain('totalBankBalance');
    expect(res.reply).toContain('Bilal Malik');
  });
});
