/**
 * Loan Service — org-scoped loans & liabilities (receivable / payable).
 * Supports REST API backend when configured, direct Supabase client when available,
 * and fallback to local dataStore.
 */

import type { Loan, LoanPayment } from '@/services/types';
import { isHttpBackendConfigured, apiGet, apiPostJson, apiRequest } from '@/lib/apiClient';
import { isSupabaseConfigured, getSupabaseClient } from '@/lib/supabaseClient';
import { dataStore, generateId, simulateDelay } from './dataStore';
import { transactionService } from './transactionService';
import { recomputeBankAccountBalance } from './accountService';
import type { ServiceResponse } from './types';

const LOANS_PATH = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}/loans`;

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

function normalizeBalances(
  data: Partial<Loan>,
  existing?: Loan
): Partial<Loan> {
  const principal = Number(data.principal ?? existing?.principal ?? 0);
  const paid = Math.max(0, Number(data.amountPaid ?? existing?.amountPaid ?? 0));
  const interestRate = Number(data.interestRate ?? existing?.interestRate ?? 0);
  let termMonths = Number(data.termMonths ?? (data as any)?.term_months ?? existing?.termMonths ?? (existing as any)?.term_months ?? 0);

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

function mapRowToLoan(row: any): Loan {
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
  };
}

export const loanService = {
  async getAll(organizationId: string): Promise<ServiceResponse<Loan[]>> {
    if (!organizationId) {
      return { success: true, data: [] };
    }

    // 1. Prefer HTTP Backend if configured
    if (isHttpBackendConfigured()) {
      const res = await apiGet<Loan[]>(LOANS_PATH(organizationId));
      if (res.success && Array.isArray(res.data)) {
        // Keep dataStore in sync so local widgets react
        dataStore.loans = res.data;
        return res;
      }
    }

    // 2. Direct Supabase Client fallback
    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb
            .from('loans')
            .select('*')
            .eq('organization_id', organizationId)
            .order('due_date', { ascending: true });

          if (!error && data) {
            const loans = data.map(mapRowToLoan);
            dataStore.loans = loans;
            return { success: true, data: loans };
          }
        } catch (e) {
          console.warn('[loanService] Direct Supabase fetch error:', e);
        }
      }
    }

    // 3. In-memory dataStore fallback
    await simulateDelay(60);
    const list = dataStore.loans.filter(l => l.organizationId === organizationId);
    return { success: true, data: list };
  },

  async getById(id: string, organizationId?: string): Promise<ServiceResponse<Loan | null>> {
    if (isHttpBackendConfigured() && organizationId) {
      return apiGet<Loan | null>(`${LOANS_PATH(organizationId)}/${encodeURIComponent(id)}`);
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          let q = sb.from('loans').select('*').eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { data, error } = await q.maybeSingle();
          if (!error && data) {
            return { success: true, data: mapRowToLoan(data) };
          }
        } catch (e) {
          console.warn('[loanService] getById error:', e);
        }
      }
    }

    await simulateDelay(60);
    const loan = dataStore.loans.find(l => l.id === id) ?? null;
    return { success: !!loan, data: loan };
  },

  async create(
    organizationId: string,
    data: Omit<Loan, 'id' | 'organizationId'>,
  ): Promise<ServiceResponse<Loan>> {
    const party = (data.party || '').trim();
    if (!party) {
      return { success: false, data: null as any, error: 'Enter who this loan is with.' };
    }
    if (!data.principal || data.principal <= 0) {
      return { success: false, data: null as any, error: 'Principal must be greater than zero.' };
    }
    if (!data.dueDate?.trim()) {
      return { success: false, data: null as any, error: 'Due date is required.' };
    }

    // 1. Prefer HTTP backend
    if (isHttpBackendConfigured()) {
      const res = await apiPostJson<Omit<Loan, 'id' | 'organizationId'>, Loan>(
        LOANS_PATH(organizationId),
        data
      );
      if (res.success && res.data) {
        dataStore.loans.push(res.data);
        dataStore.notify('loans');
        return res;
      }
      if (!res.success && res.error) {
        return res;
      }
    }

    // 2. Direct Supabase client fallback
    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const normalized = normalizeBalances(data);
          const loanId = generateId('loan');
          const row = {
            id: loanId,
            organization_id: organizationId,
            type: data.type,
            party,
            amount: normalized.principal,
            currency: data.currency || 'USD',
            principal: normalized.principal,
            interest_rate: normalized.interestRate ?? 0,
            total_interest: normalized.totalInterest ?? 0,
            amount_paid: normalized.amountPaid ?? 0,
            remaining_balance: normalized.remainingBalance ?? normalized.principal,
            due_date: data.dueDate,
            start_date: data.startDate || null,
            status: normalized.status,
            description: (data.description || '').trim() || 'Loan',
            installment_amount: normalized.installmentAmount ?? 0,
            frequency: data.frequency || null,
            term_months: normalized.termMonths ?? 0,
            next_payment_date: normalized.nextPaymentDate || null,
            last_payment_date: normalized.lastPaymentDate || null,
            last_payment_month: normalized.lastPaymentMonth || null,
            payments_count: normalized.paymentsCount ?? 0,
            payments_completed: normalized.paymentsCompleted ?? 0,
          };

          const { data: inserted, error } = await sb
            .from('loans')
            .insert([row])
            .select()
            .single();

          if (!error && inserted) {
            const newLoan = mapRowToLoan(inserted);
            dataStore.loans.push(newLoan);
            dataStore.notify('loans');
            return { success: true, data: newLoan, message: 'Loan saved' };
          }
          if (error) {
            return { success: false, data: null as any, error: error.message };
          }
        } catch (e: any) {
          return { success: false, data: null as any, error: e?.message || 'Database error' };
        }
      }
    }

    // 3. Local dataStore fallback
    await simulateDelay(150);
    const normalized = normalizeBalances(data);
    const newLoan: Loan = {
      ...(normalized as any),
      id: generateId('loan'),
      organizationId,
      currency: normalized.currency || 'USD',
      description: (normalized.description || '').trim() || 'Loan',
    };
    dataStore.loans.push(newLoan);
    dataStore.notify('loans');
    return { success: true, data: newLoan, message: 'Loan saved' };
  },

  async update(id: string, updates: Partial<Loan>, organizationId?: string): Promise<ServiceResponse<Loan>> {
    // 1. Prefer HTTP backend
    if (isHttpBackendConfigured() && organizationId) {
      const res = await apiRequest<Loan>(`${LOANS_PATH(organizationId)}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      if (res.success && res.data) {
        const idx = dataStore.loans.findIndex(l => l.id === id);
        if (idx !== -1) {
          dataStore.loans[idx] = res.data;
        } else {
          dataStore.loans.push(res.data);
        }
        dataStore.notify('loans');
        return res;
      }
      if (!res.success && res.error) {
        return res;
      }
    }

    // 2. Direct Supabase client fallback
    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
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

          if (updates.principal !== undefined) {
            dbUpdates.principal = Number(updates.principal);
            dbUpdates.amount = Number(updates.principal);
          }
          if (updates.amountPaid !== undefined) dbUpdates.amount_paid = Number(updates.amountPaid);
          if (updates.remainingBalance !== undefined) dbUpdates.remaining_balance = Number(updates.remainingBalance);
          if (updates.interestRate !== undefined) dbUpdates.interest_rate = Number(updates.interestRate);
          if (updates.totalInterest !== undefined) dbUpdates.total_interest = Number(updates.totalInterest);
          if (updates.installmentAmount !== undefined) dbUpdates.installment_amount = Number(updates.installmentAmount);
          if (updates.status !== undefined) dbUpdates.status = updates.status;

          let q = sb.from('loans').update(dbUpdates).eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { data: updated, error } = await q.select().single();

          if (!error && updated) {
            const updatedLoan = mapRowToLoan(updated);
            const idx = dataStore.loans.findIndex(l => l.id === id);
            if (idx !== -1) dataStore.loans[idx] = updatedLoan;
            dataStore.notify('loans');
            return { success: true, data: updatedLoan, message: 'Loan updated' };
          }
          if (error) {
            return { success: false, data: null as any, error: error.message };
          }
        } catch (e: any) {
          return { success: false, data: null as any, error: e?.message || 'Database error' };
        }
      }
    }

    // 3. Local dataStore fallback
    await simulateDelay(150);
    const idx = dataStore.loans.findIndex(l => l.id === id);
    if (idx === -1) return { success: false, data: null as any, error: 'Loan not found' };
    const merged = { ...dataStore.loans[idx], ...updates };
    const n = normalizeBalances(merged, dataStore.loans[idx]);
    dataStore.loans[idx] = { ...merged, ...n } as Loan;
    dataStore.notify('loans');
    return { success: true, data: dataStore.loans[idx], message: 'Loan updated' };
  },

  async delete(id: string, organizationId?: string): Promise<ServiceResponse<null>> {
    // 1. Prefer HTTP backend
    if (isHttpBackendConfigured() && organizationId) {
      const res = await apiRequest<null>(`${LOANS_PATH(organizationId)}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.success) {
        const idx = dataStore.loans.findIndex(l => l.id === id);
        if (idx !== -1) {
          dataStore.loans.splice(idx, 1);
          dataStore.notify('loans');
        }
        return res;
      }
    }

    // 2. Direct Supabase client fallback
    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          let q = sb.from('loans').delete().eq('id', id);
          if (organizationId) q = q.eq('organization_id', organizationId);
          const { error } = await q;
          if (!error) {
            const idx = dataStore.loans.findIndex(l => l.id === id);
            if (idx !== -1) {
              dataStore.loans.splice(idx, 1);
              dataStore.notify('loans');
            }
            return { success: true, data: null, message: 'Loan removed' };
          }
          if (error) {
            return { success: false, data: null, error: error.message };
          }
        } catch (e: any) {
          return { success: false, data: null, error: e?.message || 'Database error' };
        }
      }
    }

    // 3. Local dataStore fallback
    await simulateDelay(150);
    const idx = dataStore.loans.findIndex(l => l.id === id);
    if (idx === -1) return { success: false, data: null, error: 'Loan not found' };
    dataStore.loans.splice(idx, 1);
    dataStore.notify('loans');
    return { success: true, data: null, message: 'Loan removed' };
  },

  /**
   * Get expected amortization / payment projection schedule separate from actual postings
   */
  async getSchedule(loanId: string, organizationId: string): Promise<ServiceResponse<any>> {
    if (isHttpBackendConfigured() && organizationId) {
      return apiGet<any>(`${LOANS_PATH(organizationId)}/${encodeURIComponent(loanId)}/schedule`);
    }
    return { success: true, data: { schedule: [] } };
  },

  /**
   * Records a monthly installment payment with double-payment protection
   */
  async recordPayment(
    loanId: string,
    paymentData: {
      amount: number;
      paymentMonth?: string; // 'YYYY-MM', e.g. '2026-10'
      paidOn?: string;       // 'YYYY-MM-DD'
      method?: string;
      bankAccountId?: string;
      reference?: string;
      notes?: string;
      principalPart?: number;
      interestPart?: number;
      feePart?: number;
    },
    organizationId: string
  ): Promise<ServiceResponse<{ payment: LoanPayment; loan: Loan }>> {
    const paidOn = paymentData.paidOn || new Date().toISOString().split('T')[0];
    const targetMonth = paymentData.paymentMonth || paidOn.substring(0, 7);
    const amount = Number(paymentData.amount);

    if (!amount || amount <= 0) {
      return { success: false, data: null as any, error: 'Payment amount must be greater than zero.' };
    }

    // 1. Prefer HTTP backend if configured
    if (isHttpBackendConfigured() && organizationId) {
      const res = await apiRequest<{ payment: LoanPayment; loan: Loan }>(
        `${LOANS_PATH(organizationId)}/${encodeURIComponent(loanId)}/payments`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount,
            paymentMonth: targetMonth,
            paidOn,
            method: paymentData.method || 'bank_transfer',
            bankAccountId: paymentData.bankAccountId || undefined,
            reference: paymentData.reference || '',
            notes: paymentData.notes || '',
          }),
        }
      );
      if (res.success && res.data) {
        const idx = dataStore.loans.findIndex(l => l.id === loanId);
        if (idx !== -1) {
          dataStore.loans[idx] = res.data.loan;
        }
        if (paymentData.bankAccountId) {
          void recomputeBankAccountBalance(organizationId, paymentData.bankAccountId);
        }
        dataStore.notify('loans');
        dataStore.notify('transactions');
        dataStore.notify('bankAccounts');
        return res;
      }
      if (!res.success && res.error) {
        return res;
      }
    }

    // 2. Direct Supabase client fallback
    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          // Check if loan exists
          const { data: loanRow, error: loanErr } = await sb
            .from('loans')
            .select('*')
            .eq('id', loanId)
            .eq('organization_id', organizationId)
            .single();

          if (loanErr || !loanRow) {
            return { success: false, data: null as any, error: 'Loan not found.' };
          }

          const currentLoan = mapRowToLoan(loanRow);

          // Check for existing payment in the same month
          const { data: existingPayment } = await sb
            .from('loan_payments')
            .select('id, payment_month')
            .eq('loan_id', loanId)
            .eq('payment_month', targetMonth)
            .maybeSingle();

          if (existingPayment || currentLoan.lastPaymentMonth === targetMonth) {
            return {
              success: false,
              data: null as any,
              error: `The installment for ${targetMonth} has already been paid for this loan. Duplicate payment is not allowed.`,
            };
          }

          const paymentId = generateId('lp');
          const paymentRow: any = {
            id: paymentId,
            organization_id: organizationId,
            loan_id: loanId,
            amount,
            payment_month: targetMonth,
            paid_on: paidOn,
            principal_part: amount,
            interest_part: 0,
            method: paymentData.method || 'bank_transfer',
            reference: (paymentData.reference || '').trim(),
            notes: (paymentData.notes || '').trim(),
          };
          if (paymentData.bankAccountId) {
            paymentRow.bank_account_id = paymentData.bankAccountId;
          }

          const { error: insErr } = await sb.from('loan_payments').insert([paymentRow]);
          if (insErr) {
            if (insErr.code === '23505') {
              return {
                success: false,
                data: null as any,
                error: `The installment for ${targetMonth} has already been paid for this loan.`,
              };
            }
            return { success: false, data: null as any, error: insErr.message };
          }

          const newAmountPaid = Math.round(((currentLoan.amountPaid || 0) + amount) * 100) / 100;
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
            .eq('organization_id', organizationId)
            .select()
            .single();

          if (upErr) {
            return { success: false, data: null as any, error: upErr.message };
          }

          // Also generate accounting transaction if bankAccountId is provided
          if (paymentData.bankAccountId) {
            try {
              const isPayable = currentLoan.type === 'to_pay';
              let categoryId = dataStore.categories.find(c => 
                c.organizationId === organizationId && c.name.toLowerCase().includes('loan')
              )?.id;

              if (!categoryId) {
                const { data: dbCats } = await sb
                  .from('categories')
                  .select('id')
                  .eq('organization_id', organizationId)
                  .ilike('name', '%loan%')
                  .limit(1);
                if (dbCats && dbCats.length > 0) {
                  categoryId = dbCats[0].id;
                }
              }

              await transactionService.create(organizationId, {
                bankAccountId: paymentData.bankAccountId,
                date: paidOn,
                description: `Loan Repayment - ${currentLoan.party}`,
                narration: `Monthly installment (${targetMonth}) for loan: ${currentLoan.description || currentLoan.party}`,
                amount,
                currency: currentLoan.currency || 'USD',
                type: isPayable ? 'debit' : 'credit',
                categoryId,
                status: 'reconciled',
                tags: ['loan-payment', `month:${targetMonth}`, `loan:${loanId}`, 'business'],
                attachments: [],
              });
              await recomputeBankAccountBalance(organizationId, paymentData.bankAccountId);
            } catch (txErr) {
              console.error('[loanService] Transaction creation error:', txErr);
            }
          }

          const finalLoan = mapRowToLoan(updatedLoanRow);
          const idx = dataStore.loans.findIndex(l => l.id === loanId);
          if (idx !== -1) {
            dataStore.loans[idx] = finalLoan;
            dataStore.notify('loans');
          }
          dataStore.notify('transactions');
          dataStore.notify('bankAccounts');

          const createdPayment: LoanPayment = {
            id: paymentId,
            organizationId,
            loanId,
            bankAccountId: paymentData.bankAccountId,
            amount,
            paymentMonth: targetMonth,
            paidOn,
            principalPart: amount,
            interestPart: 0,
            method: paymentData.method || 'bank_transfer',
            reference: paymentData.reference || '',
            notes: paymentData.notes || '',
          };

          return {
            success: true,
            data: { payment: createdPayment, loan: finalLoan },
            message: `Payment of $${amount.toLocaleString()} for ${targetMonth} recorded.`,
          };
        } catch (e: any) {
          return { success: false, data: null as any, error: e?.message || 'Database error' };
        }
      }
    }

    // 3. Local dataStore fallback
    await simulateDelay(150);
    const idx = dataStore.loans.findIndex(l => l.id === loanId);
    if (idx === -1) return { success: false, data: null as any, error: 'Loan not found' };

    const currentLoan = dataStore.loans[idx];
    if (currentLoan.lastPaymentMonth === targetMonth) {
      return {
        success: false,
        data: null as any,
        error: `The installment for ${targetMonth} has already been paid for this loan. Duplicate payment is not allowed.`,
      };
    }

    const newAmountPaid = Math.round(((currentLoan.amountPaid || 0) + amount) * 100) / 100;
    const newRemaining = Math.max(0, Math.round(((currentLoan.principal || 0) - newAmountPaid) * 100) / 100);
    const newPaymentsCompleted = (currentLoan.paymentsCompleted || 0) + 1;
    let nextPayment: string | undefined = undefined;
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

    const updatedLoan: Loan = {
      ...currentLoan,
      amountPaid: newAmountPaid,
      remainingBalance: newRemaining,
      paymentsCompleted: newPaymentsCompleted,
      lastPaymentDate: paidOn,
      lastPaymentMonth: targetMonth,
      nextPaymentDate: nextPayment,
      status: newStatus,
    };
    dataStore.loans[idx] = updatedLoan;

    const newPayment: LoanPayment = {
      id: generateId('lp'),
      organizationId,
      loanId,
      bankAccountId: paymentData.bankAccountId,
      amount,
      paymentMonth: targetMonth,
      paidOn,
      principalPart: amount,
      interestPart: 0,
      method: paymentData.method || 'bank_transfer',
      reference: paymentData.reference || '',
      notes: paymentData.notes || '',
      createdAt: new Date().toISOString(),
    };

    if (!(dataStore as any).loanPayments) (dataStore as any).loanPayments = [];
    (dataStore as any).loanPayments.push(newPayment);

    // Generate transaction in dataStore
    try {
      if (dataStore.transactions) {
        const isPayable = currentLoan.type === 'to_pay';
        const txnId = generateId('tx');
        dataStore.transactions.unshift({
          id: txnId,
          organizationId,
          bankAccountId: paymentData.bankAccountId || (dataStore.bankAccounts?.[0]?.id ?? 'bank-1'),
          date: paidOn,
          description: `${currentLoan.party} - Loan Payment`,
          narration: `Monthly installment (${targetMonth}) for loan: ${currentLoan.description || currentLoan.party}`,
          amount,
          currency: currentLoan.currency || 'USD',
          type: isPayable ? 'debit' : 'credit',
          categoryId: 'cat-loan-repayment',
          status: 'reconciled',
          tags: ['loan-payment', targetMonth],
          attachments: [],
          createdAt: new Date().toISOString(),
        } as any);

        if (paymentData.bankAccountId && dataStore.bankAccounts) {
          const b = dataStore.bankAccounts.find(acc => acc.id === paymentData.bankAccountId);
          if (b) {
            if (isPayable) b.balance -= amount;
            else b.balance += amount;
          }
        }
      }
    } catch (e) {
      console.warn('[loanService] dataStore transaction warning:', e);
    }

    dataStore.notify('loans');
    dataStore.notify('transactions');
    dataStore.notify('bankAccounts');

    return {
      success: true,
      data: { payment: newPayment, loan: updatedLoan },
      message: `Payment of $${amount.toLocaleString()} for ${targetMonth} recorded.`,
    };
  },

  /**
   * Fetches payment records for a specific loan
   */
  async getPayments(loanId: string, organizationId: string): Promise<ServiceResponse<LoanPayment[]>> {
    if (isHttpBackendConfigured() && organizationId) {
      const res = await apiGet<LoanPayment[]>(`${LOANS_PATH(organizationId)}/${encodeURIComponent(loanId)}/payments`);
      if (res.success && Array.isArray(res.data)) {
        return res;
      }
    }

    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb
            .from('loan_payments')
            .select('*')
            .eq('loan_id', loanId)
            .eq('organization_id', organizationId)
            .order('paid_on', { ascending: false });

          if (!error && data) {
            const list: LoanPayment[] = data.map(p => ({
              id: p.id,
              organizationId: p.organization_id,
              loanId: p.loan_id,
              amount: Number(p.amount),
              paymentMonth: p.payment_month,
              paidOn: p.paid_on,
              principalPart: Number(p.principal_part || 0),
              interestPart: Number(p.interest_part || 0),
              method: p.method,
              reference: p.reference,
              notes: p.notes,
              createdAt: p.created_at,
            }));
            return { success: true, data: list };
          }
        } catch (e) {
          console.warn('[loanService] getPayments error:', e);
        }
      }
    }

    const list = ((dataStore as any).loanPayments || []).filter(
      (p: any) => p.loanId === loanId && p.organizationId === organizationId
    );
    return { success: true, data: list };
  },

  /**
   * Fetches all loan payment records across the organization
   */
  async getAllPayments(organizationId: string): Promise<ServiceResponse<LoanPayment[]>> {
    if (isSupabaseConfigured()) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb
            .from('loan_payments')
            .select('*')
            .eq('organization_id', organizationId)
            .order('paid_on', { ascending: false });

          if (!error && data) {
            const list: LoanPayment[] = data.map(p => ({
              id: p.id,
              organizationId: p.organization_id,
              loanId: p.loan_id,
              amount: Number(p.amount),
              paymentMonth: p.payment_month,
              paidOn: p.paid_on,
              principalPart: Number(p.principal_part || 0),
              interestPart: Number(p.interest_part || 0),
              method: p.method,
              reference: p.reference,
              notes: p.notes,
              createdAt: p.created_at,
            }));
            return { success: true, data: list };
          }
        } catch (e) {
          console.warn('[loanService] getAllPayments error:', e);
        }
      }
    }

    const list = ((dataStore as any).loanPayments || []).filter(
      (p: any) => p.organizationId === organizationId
    );
    return { success: true, data: list };
  },
};
