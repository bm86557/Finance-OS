/**
 * §13 — Loans & liabilities. Mounted at `/organizations/:organizationId/loans` (mergeParams).
 *
 * Implements full Supabase persistence with local store fallback.
 * Validates fields, computes balances, handles auto overdue transition,
 * and maintains org-isolation security.
 */

import { Router, type Request, type Response } from 'express';
import type { Loan, LoanRecordStatus } from '../../src/services/types.js';
import { ok, created, notFound, fail } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { recomputeServerBankBalance } from './transactions.js';
import { requirePermission } from '../middleware/auth.js';
import { logAuditEvent } from '../lib/auditLogger.js';
import { postBalancedJournalEntry, resolveGlAccountId } from '../lib/ledgerService.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

function advancePaymentDate(currentDateStr?: string, frequency: string = 'monthly'): string {
  const base = currentDateStr ? new Date(currentDateStr) : new Date();
  const d = isNaN(base.getTime()) ? new Date() : new Date(base);
  if (frequency === 'quarterly') {
    d.setMonth(d.getMonth() + 3);
  } else if (frequency === 'annual') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
}

/**
 * Derives financial metrics and auto-transitions overdue status
 */
function normalizeBalances(
  data: Partial<Loan>,
  existing?: Loan
): Partial<Loan> {
  const principal = Number(data.principal ?? existing?.principal ?? 0);
  const paid = Math.max(0, Number(data.amountPaid ?? existing?.amountPaid ?? 0));
  const interestRate = Number(data.interestRate ?? existing?.interestRate ?? 0);
  let termMonths = Number((data as any).termMonths ?? (data as any).term_months ?? existing?.termMonths ?? 0);

  // Infer termMonths if 0 and dates exist
  const startStr = data.startDate || existing?.startDate;
  const dueStr = data.dueDate || existing?.dueDate;
  if (termMonths <= 0 && startStr && dueStr) {
    const s = new Date(startStr);
    const e = new Date(dueStr);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      if (diff > 0) termMonths = diff;
    }
  }

  // Compute total interest if principal and rate are present
  let totalInterest = Number(data.totalInterest ?? existing?.totalInterest ?? 0);
  if (totalInterest === 0 && interestRate > 0 && principal > 0) {
    if (termMonths > 0) {
      totalInterest = Math.round((principal * (interestRate / 100) * (termMonths / 12)) * 100) / 100;
    } else {
      totalInterest = Math.round((principal * (interestRate / 100)) * 100) / 100;
    }
  }

  const totalObligation = Math.round((principal + totalInterest) * 100) / 100;

  const remaining = data.remainingBalance != null
    ? Number(data.remainingBalance)
    : Math.max(0, Math.round((principal - paid) * 100) / 100);

  // Calculate installment amount if frequency and term are given
  let installmentAmount = Number(data.installmentAmount ?? existing?.installmentAmount ?? 0);
  if (installmentAmount === 0 && termMonths > 0 && principal > 0) {
    installmentAmount = Math.round((totalObligation / termMonths) * 100) / 100;
  }

  // Calculate payments count if not explicitly set
  let paymentsCount = Number(data.paymentsCount ?? existing?.paymentsCount ?? 0);
  if (paymentsCount === 0) {
    if (installmentAmount > 0 && totalObligation > 0) {
      paymentsCount = Math.max(1, Math.ceil(totalObligation / installmentAmount));
    } else if (termMonths > 0) {
      paymentsCount = termMonths;
    } else {
      paymentsCount = 1;
    }
  }

  const paymentsCompleted = Number(data.paymentsCompleted ?? existing?.paymentsCompleted ?? 0);

  // Compute next payment date if not set or needs calculation
  let nextPaymentDate = data.nextPaymentDate ?? existing?.nextPaymentDate;
  if (remaining > 0) {
    if (startStr) {
      const d = new Date(startStr);
      if (!isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + paymentsCompleted);
        nextPaymentDate = d.toISOString().split('T')[0];
      }
    } else if (dueStr) {
      nextPaymentDate = dueStr;
    }
  } else {
    nextPaymentDate = undefined;
  }

  const lastPaymentDate = data.lastPaymentDate ?? existing?.lastPaymentDate;
  const lastPaymentMonth = data.lastPaymentMonth ?? existing?.lastPaymentMonth;

  // Determine status automatically if not defaulted
  const dueDate = data.dueDate ?? existing?.dueDate;
  let status = data.status ?? existing?.status ?? 'active';

  const todayStr = new Date().toISOString().split('T')[0];
  if (remaining <= 0 && totalObligation > 0) {
    status = 'paid';
  } else if (paid > 0 && remaining > 0 && status !== 'defaulted') {
    status = 'partially_paid';
  } else if (dueDate && dueDate < todayStr && remaining > 0 && status !== 'defaulted') {
    status = 'overdue';
  } else if (!status || status === 'pending') {
    status = 'active';
  }

  return {
    ...data,
    principal,
    amount: principal,
    amountPaid: paid,
    remainingBalance: remaining,
    interestRate,
    totalInterest,
    installmentAmount,
    termMonths,
    paymentsCount,
    paymentsCompleted,
    nextPaymentDate,
    lastPaymentDate,
    lastPaymentMonth,
    status,
  };
}

function mapSupabaseRowToLoan(row: any): Loan {
  const principal = Number(row.principal || row.amount || 0);
  const totalInterest = row.total_interest != null ? Number(row.total_interest) : 0;
  const totalObligation = Math.round((principal + totalInterest) * 100) / 100;
  const amountPaid = Number(row.amount_paid || 0);

  const remainingBalance = Number(row.remaining_balance ?? Math.max(0, principal - amountPaid));

  const installmentAmount = row.installment_amount != null ? Number(row.installment_amount) : 0;
  let termMonths = row.term_months != null ? Number(row.term_months) : 0;
  if (termMonths <= 0 && row.start_date && row.due_date) {
    const s = new Date(row.start_date);
    const e = new Date(row.due_date);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      if (diff > 0) termMonths = diff;
    }
  }
  
  let paymentsCount = row.payments_count != null ? Number(row.payments_count) : 0;
  if (paymentsCount === 0) {
    if (installmentAmount > 0 && totalObligation > 0) {
      paymentsCount = Math.max(1, Math.ceil(totalObligation / installmentAmount));
    } else if (termMonths > 0) {
      paymentsCount = termMonths;
    }
  }

  const paymentsCompleted = row.payments_completed != null ? Number(row.payments_completed) : 0;

  let nextPaymentDate = row.next_payment_date;
  if (remainingBalance > 0 && row.start_date) {
    const d = new Date(row.start_date);
    if (!isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + paymentsCompleted);
      nextPaymentDate = d.toISOString().split('T')[0];
    }
  } else if (remainingBalance <= 0) {
    nextPaymentDate = undefined;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  let overdueAmount = 0;
  if (remainingBalance > 0) {
    if (row.due_date && String(row.due_date) < todayStr) {
      overdueAmount = remainingBalance;
    } else if (nextPaymentDate && String(nextPaymentDate) < todayStr && installmentAmount > 0) {
      overdueAmount = Math.min(remainingBalance, installmentAmount);
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    party: row.party,
    amount: Number(row.amount || row.principal || 0),
    currency: row.currency || 'USD',
    principal,
    interestRate: row.interest_rate != null ? Number(row.interest_rate) : undefined,
    totalInterest,
    amountPaid,
    remainingBalance,
    dueDate: row.due_date,
    startDate: row.start_date || undefined,
    status: row.status,
    description: row.description || '',
    installmentAmount,
    frequency: row.frequency || undefined,
    termMonths,
    nextPaymentDate: nextPaymentDate || undefined,
    lastPaymentDate: row.last_payment_date || undefined,
    lastPaymentMonth: row.last_payment_month || undefined,
    paymentsCount,
    paymentsCompleted,
    rateType: (row.rate_type as Loan['rateType']) || 'fixed',
    accruedInterest: row.accrued_interest != null ? Number(row.accrued_interest) : 0,
    ...(overdueAmount > 0 ? { overdueAmount } : { overdueAmount: 0 }),
  } as Loan;
}

export function createLoansRouter(): Router {
  const r = Router({ mergeParams: true });

  // GET / - List all loans for this organization
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('loans')
          .select('*')
          .eq('organization_id', orgId)
          .order('due_date', { ascending: true });

        if (!error && data) {
          const loans = data.map(mapSupabaseRowToLoan);
          return ok(res, loans);
        }
        if (error) {
          console.warn('[loans] Supabase GET error, falling back to local store:', error.message);
        }
      } catch (err) {
        console.error('[loans] Supabase query exception:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // GET /:id - Single loan by ID (org-scoped)
  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('loans')
          .select('*')
          .eq('id', id)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (!error && data) {
          return ok(res, mapSupabaseRowToLoan(data));
        }
      } catch (err) {
        console.error('[loans] Supabase getById exception:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // POST / - Create a loan
  r.post('/', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const data = req.body as Partial<Loan>;

    const party = (data.party || '').trim();
    if (!party) return fail(res, 400, 'Enter who this loan is with.');
    const principal = Number(data.principal);
    if (!principal || principal <= 0) return fail(res, 400, 'Principal must be greater than zero.');
    if (!data.dueDate?.trim()) return fail(res, 400, 'Due date is required.');

    const normalized = normalizeBalances(data);
    const loanId = `loan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const currency = (normalized.currency || 'USD').toUpperCase();
    const description = (normalized.description || '').trim() || 'Loan';

    const newLoan: Loan = {
      ...(normalized as any),
      id: loanId,
      organizationId: orgId,
      currency,
      party,
      description,
    };

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const row = {
          id: loanId,
          organization_id: orgId,
          type: newLoan.type,
          party: newLoan.party,
          amount: newLoan.amount,
          currency: newLoan.currency,
          principal: newLoan.principal,
          interest_rate: newLoan.interestRate ?? 0,
          total_interest: newLoan.totalInterest ?? 0,
          amount_paid: newLoan.amountPaid ?? 0,
          remaining_balance: newLoan.remainingBalance ?? newLoan.principal,
          due_date: newLoan.dueDate,
          start_date: newLoan.startDate || null,
          status: newLoan.status,
          description: newLoan.description,
          installment_amount: newLoan.installmentAmount ?? 0,
          frequency: newLoan.frequency || null,
          term_months: newLoan.termMonths ?? 0,
          next_payment_date: newLoan.nextPaymentDate || null,
          last_payment_date: newLoan.lastPaymentDate || null,
          last_payment_month: newLoan.lastPaymentMonth || null,
          payments_count: newLoan.paymentsCount ?? 0,
          payments_completed: newLoan.paymentsCompleted ?? 0,
          rate_type: data.rateType === 'variable' ? 'variable' : 'fixed',
          accrued_interest: Number(data.accruedInterest ?? 0),
        };

        const { error } = await sb.from('loans').insert([row]);
        if (error) {
          console.error('[loans] Supabase insert error:', error.message);
          return fail(res, 500, `Could not save loan in database: ${error.message}`);
        }

        // Link with bank account if provided + post balanced disbursement journal (§8, §15)
        const bankAccountId = (data as any).bankAccountId || (data as any).bank_account_id;
        if (bankAccountId) {
          try {
            const isCompanyBorrowing = newLoan.type === 'to_pay';
            const txnId = `txn-loan-init-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const entryDate = newLoan.startDate || new Date().toISOString().split('T')[0];
            await sb.from('transactions').insert([{
              id: txnId,
              organization_id: orgId,
              bank_account_id: bankAccountId,
              date: entryDate,
              description: isCompanyBorrowing ? `Loan Received - ${newLoan.party}` : `Loan Issued - ${newLoan.party}`,
              narration: isCompanyBorrowing
                ? `Principal disbursement received from ${newLoan.party} (${newLoan.description || 'Loan'})`
                : `Funds lent to ${newLoan.party} (${newLoan.description || 'Loan'})`,
              amount: newLoan.principal,
              currency: newLoan.currency || 'USD',
              type: isCompanyBorrowing ? 'credit' : 'debit',
              status: 'reconciled',
              tags: ['loan-disbursement', `loan:${loanId}`],
              created_at: new Date().toISOString(),
            }]);
            await recomputeServerBankBalance(orgId, bankAccountId);

            const { data: bankRow } = await sb
              .from('bank_accounts')
              .select('account_id')
              .eq('id', bankAccountId)
              .eq('organization_id', orgId)
              .maybeSingle();
            const bankGlId = bankRow?.account_id || (await resolveGlAccountId(sb, orgId, 'asset', ['bank_account', 'cash']));
            const loanGlId = isCompanyBorrowing
              ? await resolveGlAccountId(sb, orgId, 'liability', ['loan', 'debt', 'payable'])
              : await resolveGlAccountId(sb, orgId, 'asset', ['loan', 'receivable']);

            await postBalancedJournalEntry(sb, {
              organizationId: orgId,
              entryDate,
              description: isCompanyBorrowing ? `Loan Disbursement Received - ${newLoan.party}` : `Loan Disbursement Issued - ${newLoan.party}`,
              sourceType: 'loan_disbursement',
              sourceId: loanId,
              currency: newLoan.currency || 'USD',
              actorUserId: req.authUser?.id || null,
              entryPrefix: 'LOAN',
              lines: isCompanyBorrowing
                ? [
                    { accountId: bankGlId, bankAccountId, debit: newLoan.principal, credit: 0, description: `Loan proceeds from ${newLoan.party}` },
                    { accountId: loanGlId, debit: 0, credit: newLoan.principal, description: `Loan liability to ${newLoan.party}` },
                  ]
                : [
                    { accountId: loanGlId, debit: newLoan.principal, credit: 0, description: `Loan receivable from ${newLoan.party}` },
                    { accountId: bankGlId, bankAccountId, debit: 0, credit: newLoan.principal, description: `Loan funds disbursed to ${newLoan.party}` },
                  ],
            });
          } catch (bankErr) {
            console.error('[loans] Error linking bank account on creation:', bankErr);
          }
        }

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'create_loan',
          entityType: 'loan',
          entityId: loanId,
          description: `Created ${newLoan.type} loan with ${newLoan.party} for ${newLoan.principal} ${newLoan.currency}`,
          afterState: row,
        }).catch(() => {});
      } catch (err: any) {
        console.error('[loans] Supabase insert exception:', err);
        return fail(res, 500, err?.message || 'Database error creating loan');
      }
    }

    if (!sb) return fail(res, 503, 'Database unavailable');

    created(res, newLoan, 'Loan saved');
  });

  // GET /:id/payments - List all payments recorded for this loan
  r.get('/:id/payments', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const loanId = req.params.id;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data, error } = await sb
          .from('loan_payments')
          .select('*')
          .eq('loan_id', loanId)
          .eq('organization_id', orgId)
          .order('paid_on', { ascending: false });

        if (!error && data) {
          const payments = data.map(p => ({
            id: p.id,
            organizationId: p.organization_id,
            loanId: p.loan_id,
            amount: Number(p.amount),
            paymentMonth: p.payment_month,
            paidOn: p.paid_on,
            principalPart: Number(p.principal_part || 0),
            interestPart: Number(p.interest_part || 0),
            feePart: Number(p.fee_part || 0),
            journalEntryId: p.journal_entry_id,
            method: p.method,
            reference: p.reference,
            notes: p.notes,
            createdAt: p.created_at,
          }));
          return ok(res, payments);
        }
      } catch (err) {
        console.error('[loans] Error fetching loan payments:', err);
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // GET /:id/schedule - Expected amortization / payment schedule (projections separate from posting)
  r.get('/:id/schedule', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const loanId = req.params.id;
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: loanRow, error } = await sb
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error || !loanRow) return notFound(res, 'Loan');
    const loan = mapSupabaseRowToLoan(loanRow);

    const termMonths = Math.max(1, loan.termMonths || 12);
    const principal = Number(loan.principal || loan.amount || 0);
    const rateAnnual = Number(loan.interestRate || 0) / 100;
    const rateMonthly = rateAnnual / 12;

    // Monthly installment calculation
    let monthlyInstallment = loan.installmentAmount || 0;
    if (monthlyInstallment <= 0) {
      if (rateMonthly > 0) {
        monthlyInstallment = (principal * rateMonthly * Math.pow(1 + rateMonthly, termMonths)) / (Math.pow(1 + rateMonthly, termMonths) - 1);
      } else {
        monthlyInstallment = principal / termMonths;
      }
    }
    monthlyInstallment = Math.round(monthlyInstallment * 100) / 100;

    let balance = principal;
    const schedule = [];
    const startDate = loan.startDate ? new Date(loan.startDate) : new Date();

    for (let i = 1; i <= termMonths; i++) {
      if (balance <= 0) break;
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      const dateStr = d.toISOString().split('T')[0];
      const monthStr = dateStr.substring(0, 7);

      const interestPortion = Math.round(balance * rateMonthly * 100) / 100;
      const principalPortion = Math.min(balance, Math.round((monthlyInstallment - interestPortion) * 100) / 100);
      const installment = Math.round((principalPortion + interestPortion) * 100) / 100;
      const closingBalance = Math.max(0, Math.round((balance - principalPortion) * 100) / 100);

      schedule.push({
        installmentNumber: i,
        paymentDate: dateStr,
        paymentMonth: monthStr,
        openingBalance: balance,
        principalPortion,
        interestPortion,
        totalInstallment: installment,
        closingBalance,
        status: i <= (loan.paymentsCompleted || 0) ? 'paid' : 'projected',
      });

      balance = closingBalance;
    }

    return ok(res, {
      loanId: loan.id,
      principal,
      interestRate: loan.interestRate,
      rateType: loan.rateType,
      termMonths,
      monthlyInstallment,
      totalExpectedPayments: schedule.length,
      schedule,
    });
  });

  // POST /:id/payments - Record a monthly payment with double-payment prevention and split
  r.post('/:id/payments', requirePermission('finance:post_ledger'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const loanId = req.params.id;
    const {
      amount,
      paymentMonth, // 'YYYY-MM', e.g. '2026-10'
      paidOn = new Date().toISOString().split('T')[0],
      method = 'bank_transfer',
      bankAccountId = '',
      reference = '',
      notes = '',
      principalPart,
      interestPart,
      feePart,
    } = req.body;

    const paymentAmount = Number(amount);
    if (!paymentAmount || paymentAmount <= 0) {
      return fail(res, 400, 'Payment amount must be greater than zero.');
    }

    const targetMonth = paymentMonth || paidOn.substring(0, 7);

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        // 1. Fetch current loan
        const { data: loanRow, error: loanErr } = await sb
          .from('loans')
          .select('*')
          .eq('id', loanId)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (loanErr || !loanRow) return notFound(res, 'Loan');

        const currentLoan = mapSupabaseRowToLoan(loanRow);

        // 2. Double-payment prevention: Has this loan already been paid for this month?
        const { data: existingPayment } = await sb
          .from('loan_payments')
          .select('id, paid_on, amount, payment_month')
          .eq('organization_id', orgId)
          .eq('loan_id', loanId)
          .eq('payment_month', targetMonth)
          .maybeSingle();

        if (existingPayment || currentLoan.lastPaymentMonth === targetMonth) {
          return fail(
            res,
            400,
            `The installment for ${targetMonth} has already been paid for this loan. Duplicate payment is not allowed.`
          );
        }

        if (currentLoan.status === 'paid' || (currentLoan.remainingBalance ?? 0) <= 0) {
          return fail(res, 400, 'This loan has already been fully paid.');
        }

        // 3. Compute explicit split: principal, interest, fees (§15)
        const remaining = currentLoan.remainingBalance ?? currentLoan.principal;
        const rateMonthly = currentLoan.interestRate ? (Number(currentLoan.interestRate) / 100 / 12) : 0;
        let computedInterest = Math.round(remaining * rateMonthly * 100) / 100;
        if (computedInterest > paymentAmount) computedInterest = paymentAmount;

        const actualInterest = interestPart != null ? Number(interestPart) : computedInterest;
        const actualFees = feePart != null ? Number(feePart) : 0;
        const actualPrincipal = principalPart != null
          ? Number(principalPart)
          : Math.min(remaining, Math.max(0, Math.round((paymentAmount - actualInterest - actualFees) * 100) / 100));

        if (actualPrincipal < 0 || actualInterest < 0 || actualFees < 0) {
          return fail(res, 400, 'Principal, interest, and fee portions must be non-negative.');
        }
        if (actualPrincipal > remaining + 0.01) {
          return fail(res, 400, `Principal portion (${actualPrincipal}) cannot exceed remaining loan principal (${remaining}).`);
        }
        const splitTotal = Math.round((actualPrincipal + actualInterest + actualFees) * 100) / 100;
        if (splitTotal <= 0) {
          return fail(res, 400, 'Total payment split must be greater than zero.');
        }
        if (Math.abs(splitTotal - paymentAmount) > 0.01) {
          return fail(
            res,
            400,
            `Payment split mismatch: principal (${actualPrincipal}) + interest (${actualInterest}) + fees (${actualFees}) = ${splitTotal}, which does not equal payment amount (${paymentAmount}).`,
          );
        }

        const paymentId = `lp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

        // 4. Insert payment ledger record FIRST so unique index (loan_id, payment_month) blocks concurrent duplicates BEFORE posting GL journals
        const paymentRow: any = {
          id: paymentId,
          organization_id: orgId,
          loan_id: loanId,
          amount: splitTotal,
          payment_month: targetMonth,
          paid_on: paidOn,
          principal_part: actualPrincipal,
          interest_part: actualInterest,
          fee_part: actualFees,
          journal_entry_id: null,
          method,
          reference: (reference || '').trim(),
          notes: (notes || '').trim(),
        };
        if (bankAccountId) {
          paymentRow.bank_account_id = bankAccountId;
        }

        const { error: insErr } = await sb.from('loan_payments').insert([paymentRow]);
        if (insErr) {
          if (insErr.code === '23505') {
            return fail(res, 409, `The installment for ${targetMonth} has already been paid for this loan.`);
          }
          return fail(res, 500, `Could not record loan payment: ${insErr.message}`);
        }

        // 4b. Post balanced double-entry journal for principal / interest / fees split (§8, §15)
        const isPayable = currentLoan.type === 'to_pay';
        let bankGlId = '';
        if (bankAccountId) {
          const { data: bankRow } = await sb
            .from('bank_accounts')
            .select('account_id')
            .eq('id', bankAccountId)
            .eq('organization_id', orgId)
            .maybeSingle();
          bankGlId = bankRow?.account_id || '';
        }
        if (!bankGlId) {
          bankGlId = await resolveGlAccountId(sb, orgId, 'asset', ['bank_account', 'cash']);
        }
        const loanGlId = isPayable
          ? await resolveGlAccountId(sb, orgId, 'liability', ['loan', 'debt', 'payable'])
          : await resolveGlAccountId(sb, orgId, 'asset', ['loan', 'receivable']);
        const interestGlId = isPayable
          ? await resolveGlAccountId(sb, orgId, 'expense', ['interest', 'finance'])
          : await resolveGlAccountId(sb, orgId, 'income', ['interest', 'finance']);
        const feeGlId = isPayable
          ? await resolveGlAccountId(sb, orgId, 'expense', ['fee', 'bank', 'finance'])
          : await resolveGlAccountId(sb, orgId, 'income', ['fee', 'other_income']);

        const journalLines = isPayable
          ? [
              ...(actualPrincipal > 0 ? [{ accountId: loanGlId, debit: actualPrincipal, credit: 0, description: `Loan principal reduction - ${currentLoan.party}` }] : []),
              ...(actualInterest > 0 ? [{ accountId: interestGlId, debit: actualInterest, credit: 0, description: `Loan interest expense - ${currentLoan.party}` }] : []),
              ...(actualFees > 0 ? [{ accountId: feeGlId, debit: actualFees, credit: 0, description: `Loan service fee - ${currentLoan.party}` }] : []),
              { accountId: bankGlId, bankAccountId: bankAccountId || null, debit: 0, credit: splitTotal, description: `Loan payment outflow - ${currentLoan.party}` },
            ]
          : [
              { accountId: bankGlId, bankAccountId: bankAccountId || null, debit: splitTotal, credit: 0, description: `Loan repayment received - ${currentLoan.party}` },
              ...(actualPrincipal > 0 ? [{ accountId: loanGlId, debit: 0, credit: actualPrincipal, description: `Loan principal collected - ${currentLoan.party}` }] : []),
              ...(actualInterest > 0 ? [{ accountId: interestGlId, debit: 0, credit: actualInterest, description: `Loan interest income - ${currentLoan.party}` }] : []),
              ...(actualFees > 0 ? [{ accountId: feeGlId, debit: 0, credit: actualFees, description: `Loan fee income - ${currentLoan.party}` }] : []),
            ];

        const jeResult = await postBalancedJournalEntry(sb, {
          organizationId: orgId,
          entryDate: paidOn,
          description: `Loan Payment (${targetMonth}) - ${currentLoan.party}`,
          sourceType: 'loan_payment',
          sourceId: paymentId,
          currency: currentLoan.currency || 'USD',
          actorUserId: req.authUser?.id || null,
          entryPrefix: 'LOANPAY',
          lines: journalLines,
        });
        if (!jeResult.success || !jeResult.journalEntryId) {
          // Roll back loan_payments row so subledger never diverges from GL
          await sb.from('loan_payments').delete().eq('id', paymentId).eq('organization_id', orgId);
          return fail(res, 400, `Loan payment journal posting failed: ${jeResult.error || 'Unable to post balanced journal entry'}`);
        }
        const journalEntryId = jeResult.journalEntryId;
        await sb.from('loan_payments').update({ journal_entry_id: journalEntryId }).eq('id', paymentId).eq('organization_id', orgId);

        // 5. Update loan balances & status — ONLY principal reduces liability!
        const newAmountPaid = Math.round(((currentLoan.amountPaid || 0) + actualPrincipal) * 100) / 100;
        const newRemaining = Math.max(0, Math.round(((currentLoan.principal || 0) - newAmountPaid) * 100) / 100);
        const newPaymentsCompleted = (currentLoan.paymentsCompleted || 0) + 1;
        
        let nextPayment: string | null = null;
        if (newRemaining > 0) {
          if (currentLoan.startDate) {
            const d = new Date(currentLoan.startDate);
            if (!isNaN(d.getTime())) {
              d.setMonth(d.getMonth() + newPaymentsCompleted);
              nextPayment = d.toISOString().split('T')[0];
            }
          }
          if (!nextPayment) {
            nextPayment = advancePaymentDate(paidOn, currentLoan.frequency);
          }
        }
        const newStatus = newRemaining <= 0 ? 'paid' : 'partially_paid';

        const { data: updatedLoanRow, error: upErr } = await sb
          .from('loans')
          .update({
            amount_paid: newAmountPaid,
            remaining_balance: newRemaining,
            payments_completed: newPaymentsCompleted,
            last_payment_date: paidOn,
            last_payment_month: targetMonth,
            next_payment_date: nextPayment,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', loanId)
          .eq('organization_id', orgId)
          .select()
          .single();

        // 6. Post double-entry accounting transactions
        // Crucial invariant: Principal repayment reduces liability, DOES NOT become operating expense
        if (bankAccountId) {
          try {
            const isPayable = currentLoan.type === 'to_pay';
            const baseType = isPayable ? 'debit' : 'credit';

            // Post Principal reduction transaction
            if (actualPrincipal > 0) {
              const txnId = `txn-principal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              await sb.from('transactions').insert([{
                id: txnId,
                organization_id: orgId,
                bank_account_id: bankAccountId,
                date: paidOn,
                description: `Loan Principal Repayment - ${currentLoan.party}`,
                narration: `Principal reduction (${targetMonth}) for loan: ${currentLoan.description || currentLoan.party}`,
                amount: actualPrincipal,
                currency: currentLoan.currency || 'USD',
                type: baseType,
                status: 'reconciled',
                tags: ['loan-principal', 'liability-reduction', `month:${targetMonth}`, `loan:${loanId}`, 'business'],
                attachments: [],
                created_at: new Date().toISOString(),
              }]);
            }

            // Post Interest expense transaction (Finance expense, recognized in P&L)
            if (actualInterest > 0) {
              const intTxnId = `txn-interest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              await sb.from('transactions').insert([{
                id: intTxnId,
                organization_id: orgId,
                bank_account_id: bankAccountId,
                date: paidOn,
                description: `Loan Interest - ${currentLoan.party}`,
                narration: `Financing interest expense (${targetMonth}) for loan: ${currentLoan.description || currentLoan.party}`,
                amount: actualInterest,
                currency: currentLoan.currency || 'USD',
                type: baseType,
                status: 'reconciled',
                tags: ['loan-interest', 'finance-expense', `month:${targetMonth}`, `loan:${loanId}`, 'business'],
                attachments: [],
                created_at: new Date().toISOString(),
              }]);
            }

            // Post Fee expense transaction if any
            if (actualFees > 0) {
              const feeTxnId = `txn-fee-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              await sb.from('transactions').insert([{
                id: feeTxnId,
                organization_id: orgId,
                bank_account_id: bankAccountId,
                date: paidOn,
                description: `Loan Service Fee - ${currentLoan.party}`,
                narration: `Bank/Lender loan fee (${targetMonth}) for loan: ${currentLoan.description || currentLoan.party}`,
                amount: actualFees,
                currency: currentLoan.currency || 'USD',
                type: baseType,
                status: 'reconciled',
                tags: ['loan-fee', 'finance-expense', `month:${targetMonth}`, `loan:${loanId}`, 'business'],
                attachments: [],
                created_at: new Date().toISOString(),
              }]);
            }

            await recomputeServerBankBalance(orgId, bankAccountId);
          } catch (tErr) {
            console.error('[loans] Non-fatal transaction creation error:', tErr);
          }
        }

        const finalLoan = updatedLoanRow ? mapSupabaseRowToLoan(updatedLoanRow) : currentLoan;

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'record_loan_payment',
          entityType: 'loan_payment',
          entityId: paymentId,
          description: `Recorded loan payment (${targetMonth}) for ${currentLoan.party}: principal=${actualPrincipal}, interest=${actualInterest}, fees=${actualFees}`,
          afterState: { payment: paymentRow, remainingBalance: finalLoan.remainingBalance, journalEntryId },
        }).catch(() => {});

        return created(res, { payment: paymentRow, loan: finalLoan }, `Payment for ${targetMonth} recorded successfully.`);
      } catch (err: any) {
        console.error('[loans] Payment exception:', err);
        return fail(res, 500, err?.message || 'Database error recording payment');
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // PATCH /:id - Update loan details or record payments
  r.patch('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const updates = req.body as Partial<Loan>;

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { data: existing, error: fetchErr } = await sb
          .from('loans')
          .select('*')
          .eq('id', id)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (fetchErr) return fail(res, 500, 'Database error');
        if (!existing) return notFound(res, 'Loan');

        const currentLoan = mapSupabaseRowToLoan(existing);
        const callerRole = String((req as any).orgMembership?.role || '').toLowerCase();
        const isModifyingPrincipalOrBalance =
          (updates.principal !== undefined && Number(updates.principal) !== Number(currentLoan.principal)) ||
          (updates.remainingBalance !== undefined && Number(updates.remainingBalance) !== Number(currentLoan.remainingBalance)) ||
          (updates.amountPaid !== undefined && Number(updates.amountPaid) !== Number(currentLoan.amountPaid));
        if (isModifyingPrincipalOrBalance) {
          if (currentLoan.status === 'paid') {
            return fail(res, 400, 'Cannot alter principal or balances on a fully paid loan.');
          }
          if (!['owner', 'admin', 'accountant'].includes(callerRole)) {
            return fail(res, 403, 'Adjusting loan principal or balances requires owner, admin, or accountant approval (Handoff §16).');
          }
        }
        const normalized = normalizeBalances(updates, currentLoan);

        const dbUpdates: any = {};
        if (updates.type !== undefined) dbUpdates.type = updates.type;
        if (updates.party !== undefined) dbUpdates.party = updates.party.trim();
        if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
        if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;
        if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate || null;
        if (updates.currency !== undefined) dbUpdates.currency = updates.currency.toUpperCase();
        if (updates.frequency !== undefined) dbUpdates.frequency = updates.frequency || null;
        if (updates.termMonths !== undefined || (updates as any).term_months !== undefined) {
          dbUpdates.term_months = Number(updates.termMonths ?? (updates as any).term_months);
        }
        if (updates.nextPaymentDate !== undefined) dbUpdates.next_payment_date = updates.nextPaymentDate || null;
        if (updates.lastPaymentDate !== undefined) dbUpdates.last_payment_date = updates.lastPaymentDate || null;
        if (updates.lastPaymentMonth !== undefined) dbUpdates.last_payment_month = updates.lastPaymentMonth || null;
        if (updates.paymentsCount !== undefined) dbUpdates.payments_count = Number(updates.paymentsCount);
        if (updates.paymentsCompleted !== undefined) dbUpdates.payments_completed = Number(updates.paymentsCompleted);

        if (normalized.principal !== undefined) dbUpdates.principal = normalized.principal;
        if (normalized.amount !== undefined) dbUpdates.amount = normalized.amount;
        if (normalized.amountPaid !== undefined) dbUpdates.amount_paid = normalized.amountPaid;
        if (normalized.remainingBalance !== undefined) dbUpdates.remaining_balance = normalized.remainingBalance;
        if (normalized.interestRate !== undefined) dbUpdates.interest_rate = normalized.interestRate;
        if (normalized.totalInterest !== undefined) dbUpdates.total_interest = normalized.totalInterest;
        if (normalized.installmentAmount !== undefined) dbUpdates.installment_amount = normalized.installmentAmount;
        if (normalized.status !== undefined) dbUpdates.status = normalized.status;
        if (updates.rateType !== undefined) dbUpdates.rate_type = updates.rateType === 'variable' ? 'variable' : 'fixed';
        if (updates.accruedInterest !== undefined) dbUpdates.accrued_interest = Number(updates.accruedInterest);

        const { data: updatedRow, error: updateErr } = await sb
          .from('loans')
          .update(dbUpdates)
          .eq('id', id)
          .eq('organization_id', orgId)
          .select()
          .single();

        if (updateErr) {
          console.error('[loans] Supabase update error:', updateErr.message);
          return fail(res, 500, updateErr.message);
        }

        const updatedLoan = mapSupabaseRowToLoan(updatedRow);
        const principalAdjusted = updates.principal !== undefined && Number(updates.principal) !== Number(existing.principal);
        void logAuditEvent(req, {
          organizationId: orgId,
          action: principalAdjusted ? 'adjust_loan_principal' : 'update_loan',
          entityType: 'loan',
          entityId: String(id),
          description: principalAdjusted
            ? `Adjusted loan principal for ${updatedLoan.party} from ${existing.principal} to ${updatedLoan.principal}`
            : `Updated loan ${updatedLoan.party}`,
          beforeState: existing,
          afterState: updatedRow,
        }).catch(() => {});

        return ok(res, updatedLoan);
      } catch (err: any) {
        console.error('[loans] Supabase update exception:', err);
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    return fail(res, 503, 'Database unavailable');
  });

  // DELETE /:id - Remove loan (guarded against deleting loans with posted payment history)
  r.delete('/:id', requirePermission('finance:write_transactions'), async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const id = req.params.id;
    const sb = getSupabaseAdminClient();

    if (sb) {
      try {
        const { data: existingLoan } = await sb
          .from('loans')
          .select('*')
          .eq('id', id)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (!existingLoan) return notFound(res, 'Loan');

        const { data: existingPayments } = await sb
          .from('loan_payments')
          .select('id')
          .eq('loan_id', id)
          .eq('organization_id', orgId)
          .limit(1);

        if (existingPayments && existingPayments.length > 0) {
          return fail(res, 400, 'Cannot delete a loan with recorded payment history. Mark it settled or defaulted instead.');
        }

        const { error } = await sb
          .from('loans')
          .delete()
          .eq('id', id)
          .eq('organization_id', orgId);

        if (error) {
          console.error('[loans] Supabase delete error:', error.message);
          return fail(res, 500, error.message);
        }

        void logAuditEvent(req, {
          organizationId: orgId,
          action: 'delete_loan',
          entityType: 'loan',
          entityId: String(id),
          description: `Deleted loan ${existingLoan.party}`,
          beforeState: existingLoan,
        }).catch(() => {});
      } catch (err: any) {
        console.error('[loans] Supabase delete exception:', err);
        return fail(res, 500, err?.message || 'Database error');
      }
    }

    if (!sb) return fail(res, 503, 'Database unavailable');

    ok(res, null, 'Loan removed');
  });

  return r;
}
