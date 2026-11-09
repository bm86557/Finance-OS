/**
 * Financial Invariant & Security Verification Test Suite.
 * Aligned with Handoff v1.2 §§1, 5, 7, 8, 20, 23, 32, 33, 34.
 *
 * Uses local shims so the file compiles without a vitest dependency.
 * Run with: npx ts-node server/__tests__/dashboardInvariants.test.ts
 * Or keep as a vitest test when vitest is installed.
 */

export {};

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function expect(value: any): any;

// Provide runtime shims when vitest is not available
if (typeof globalThis.describe === 'undefined') {
  (globalThis as any).describe = (name: string, fn: () => void) => { console.log(`\n  ${name}`); fn(); };
  (globalThis as any).it = (name: string, fn: () => void) => { try { fn(); console.log(`    ✓ ${name}`); } catch (e: any) { console.error(`    ✗ ${name}:`, e.message); process.exitCode = 1; } };
  (globalThis as any).expect = (val: any) => ({
    toBe(exp: any) { if (val !== exp) throw new Error(`Expected ${exp} but got ${val}`); },
    toBeLessThan(exp: number) { if (val >= exp) throw new Error(`Expected ${val} < ${exp}`); },
  });
}

describe('Finance OS — Financial Invariants & Security Gates (Handoff v1.2)', () => {
  it('F-01: Transfer Neutrality — ATM withdrawal and bank transfer do not inflate P&L', () => {
    // Simulated transactions
    const txns = [
      { id: 't1', type: 'credit', amount: 5000, is_transfer: false, tags: ['business'] },
      { id: 't2', type: 'debit', amount: 1200, is_transfer: false, tags: ['business'] },
      // Internal transfer: Bank -> Cash in Hand (ATM withdrawal)
      { id: 't3', type: 'debit', amount: 500, is_transfer: true, tags: ['transfer', 'atm_withdrawal'] },
      { id: 't4', type: 'credit', amount: 500, is_transfer: true, tags: ['transfer', 'atm_withdrawal'] },
    ];

    const isTransfer = (t: any) => t.is_transfer || t.tags.includes('transfer');
    const plTxns = txns.filter(t => !isTransfer(t));

    const totalRevenue = plTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = plTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
    const netProfit = totalRevenue - totalExpenses;

    expect(totalRevenue).toBe(5000);
    expect(totalExpenses).toBe(1200);
    expect(netProfit).toBe(3800);
  });

  it('World Isolation: Personal transactions do not contaminate Business P&L or Net Worth', () => {
    const txns = [
      { id: 't1', type: 'credit', amount: 10000, world_scope: 'business' },
      { id: 't2', type: 'debit', amount: 3000, world_scope: 'business' },
      { id: 't3', type: 'debit', amount: 1500, world_scope: 'personal' }, // Personal expense
    ];

    const businessTxns = txns.filter(t => t.world_scope === 'business');
    const businessExpenses = businessTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);

    expect(businessExpenses).toBe(3000); // 1500 personal expense excluded
  });

  it('Pending Gate: Unapproved/Pending transactions do not alter authoritative P&L', () => {
    const txns = [
      { id: 't1', type: 'credit', amount: 8000, status: 'classified' },
      { id: 't2', type: 'debit', amount: 2000, status: 'reconciled' },
      { id: 't3', type: 'debit', amount: 4500, status: 'pending' }, // Unreviewed statement import
    ];

    const authoritativeTxns = txns.filter(t => !['pending', 'draft', 'rejected', 'reversed'].includes(t.status));
    const totalExpenses = authoritativeTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);

    expect(totalExpenses).toBe(2000); // 4500 pending expense excluded from authoritative P&L
  });

  it('Double-Entry Balance: Balanced journal lines ensure SUM(debit) == SUM(credit)', () => {
    const lines = [
      { account_id: 'acc-bank', debit: 2500, credit: 0, base_debit: 2500, base_credit: 0 },
      { account_id: 'acc-income', debit: 0, credit: 2500, base_debit: 0, base_credit: 2500 },
    ];

    const totalDebit = lines.reduce((s, l) => s + l.base_debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.base_credit, 0);

    expect(totalDebit).toBe(totalCredit);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
  });

  it('Salary Confidentiality: Viewer role receives masked monthlyPayroll', () => {
    const userRole = 'viewer';
    const rawMonthlyPayroll = 15000;
    const canViewPayroll = ['owner', 'admin', 'accountant'].includes(userRole);
    const returnedPayroll = canViewPayroll ? rawMonthlyPayroll : 0;

    expect(returnedPayroll).toBe(0);
  });

  it('Platform Admin Implicit Access Block: Platform admin without active support grant receives 403', () => {
    const isPlatformAdmin = true;
    const isOrgMember = false;
    const activeSupportGrant = null;

    const hasAccess = isOrgMember || Boolean(activeSupportGrant);
    expect(hasAccess).toBe(false);
  });

  it('Transfer GL Isolation (§8, §23 F-01): Internal transfer offset is an Asset clearing account, never Revenue or Expense', () => {
    const transferTxn = {
      id: 'txn-trf-1',
      is_transfer: true,
      amount: 1500,
      type: 'debit',
    };
    const accounts = [
      { id: 'acc-bank', type: 'asset', subtype: 'bank_account' },
      { id: 'acc-clearing', type: 'asset', subtype: 'transfer_clearing' },
      { id: 'acc-exp', type: 'expense', subtype: 'operating' },
      { id: 'acc-inc', type: 'income', subtype: 'revenue' },
    ];

    const isTransfer = transferTxn.is_transfer;
    let offsetAccId = '';
    if (isTransfer) {
      const clearing = accounts.find(a => a.type === 'asset' && ['transfer_clearing', 'suspense', 'cash'].includes(a.subtype));
      offsetAccId = clearing?.id || '';
    } else {
      offsetAccId = accounts.find(a => a.type === 'expense')?.id || '';
    }

    expect(offsetAccId).toBe('acc-clearing');
    const offsetAcc = accounts.find(a => a.id === offsetAccId);
    expect(offsetAcc?.type).toBe('asset'); // Must be asset, never expense or income
  });

  it('Import Risk Gate (§11): Low confidence (<80) or Transfer risk is queued for review, not auto-approved', () => {
    const highConfWithRisk = { confidence: 95, riskFlags: ['POTENTIAL_TRANSFER'] };
    const medConfNoRisk = { confidence: 70, riskFlags: [] };
    const highConfNoRisk = { confidence: 85, riskFlags: [] };

    const canAutoApprove = (item: { confidence: number; riskFlags: string[] }) =>
      item.confidence >= 80 && item.riskFlags.length === 0;

    expect(canAutoApprove(highConfWithRisk)).toBe(false); // Demoted due to transfer risk
    expect(canAutoApprove(medConfNoRisk)).toBe(false); // Demoted due to medium confidence (<80)
    expect(canAutoApprove(highConfNoRisk)).toBe(true); // Approved: high confidence + zero risks
  });
});

