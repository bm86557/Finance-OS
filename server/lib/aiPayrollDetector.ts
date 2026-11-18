/**
 * AI Payroll Detection & Automated Payslip Generation Engine (§11, §13, §29 X-05/X-06/X-07, §33)
 * Analyzes bank statement debit transactions and ledger entries to:
 * 1. Automatically detect salary/payroll payouts AND separate employee expense/reimbursement payouts.
 * 2. Extract target pay period (month & year) from narration or posting date.
 * 3. Resolve target employee via fixed salary, approved expense claims, name tokens, email prefixes, or lump-sum split.
 * 4. Merge salary + expense reimbursements into one monthly employee_payslips record per (employee, period).
 * 5. Compute Expected (Base Salary + Approved Expenses) vs. Actual Paid and report Overpaid / Underpaid / Exact variance.
 * 6. Link settled employee_expenses via settlement_transaction_id without double-counting (F-04 & §33 #1 Invariant).
 */

export type PayslipVarianceStatus = 'exact' | 'overpaid' | 'underpaid' | 'unpaid';
export type PayslipAllocationKind = 'salary' | 'reimbursement';

export interface EligibleEmployee {
  id: string;
  userId: string;
  name: string;
  email: string;
  departmentId: string;
  fixedSalary: number;
  hourlyRate: number;
}

export interface ReimbursementDetailItem {
  expenseId?: string;
  description: string;
  amount: number;
  transactionId?: string;
}

export interface AllocationResult {
  payslipId: string;
  userId: string;
  employeeName: string;
  departmentId: string;
  kind: PayslipAllocationKind;
  gross: number;
  net: number;
  salaryAmount: number;
  reimbursementAmount: number;
  expectedTotal: number;
  varianceAmount: number;
  varianceStatus: PayslipVarianceStatus;
  period: string;
  periodSlug: string;
}

export interface DetectionResult {
  processedTransactions: number;
  autoIssuedCount: number;
  autoAllocatedAmount: number;
  matchedEmployees: string[];
  skippedDuplicates: number;
  details: Array<{
    transactionId: string;
    description: string;
    amount: number;
    period: string;
    allocations: AllocationResult[];
    matchType:
      | 'fixed_salary'
      | 'name_match'
      | 'email_match'
      | 'lump_sum_split'
      | 'single_unpaid'
      | 'expense_claim_match'
      | 'expense_name_match';
  }>;
}

export function round2(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function computePayslipVariance(
  netPaid: number,
  expectedSalary: number,
  expectedReimbursements: number,
): {
  expectedSalary: number;
  expectedReimbursements: number;
  expectedTotal: number;
  varianceAmount: number;
  varianceStatus: PayslipVarianceStatus;
} {
  const expSal = round2(expectedSalary);
  const expReimb = round2(expectedReimbursements);
  const expectedTotal = round2(expSal + expReimb);
  const paid = round2(netPaid);
  const varianceAmount = round2(paid - expectedTotal);

  let varianceStatus: PayslipVarianceStatus = 'exact';
  if (paid <= 0 && expectedTotal > 0) {
    varianceStatus = 'unpaid';
  } else if (Math.abs(varianceAmount) < 0.01) {
    varianceStatus = 'exact';
  } else if (varianceAmount > 0) {
    varianceStatus = 'overpaid';
  } else {
    varianceStatus = 'underpaid';
  }

  return {
    expectedSalary: expSal,
    expectedReimbursements: expReimb,
    expectedTotal,
    varianceAmount,
    varianceStatus,
  };
}

export function normalizePeriodKey(p: string | null | undefined): string {
  if (!p) return '';
  return String(p).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function extractPeriodFromTxn(
  txn: { description?: string; narration?: string; date?: string } | null | undefined,
  fallback?: string,
): { periodStr: string; periodSlug: string; normKey: string } {
  const text = `${txn?.description || ''} ${txn?.narration || ''}`.toLowerCase();
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const monthShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  let foundMonth: string | null = null;
  for (let i = 0; i < 12; i++) {
    if (text.includes(months[i]) || new RegExp(`\\b${monthShort[i]}\\b`, 'i').test(text)) {
      foundMonth = months[i].charAt(0).toUpperCase() + months[i].slice(1);
      break;
    }
  }

  const yearMatch = text.match(/\b(202\d)\b/);
  let year = yearMatch ? yearMatch[1] : null;

  if (txn?.date) {
    const d = new Date(txn.date);
    if (!Number.isNaN(d.getTime())) {
      if (!foundMonth) {
        foundMonth = d.toLocaleDateString('en-US', { month: 'long' });
      }
      if (!year) {
        year = String(d.getFullYear());
      }
    }
  }

  let finalPeriod = fallback || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (foundMonth && year) {
    finalPeriod = `${foundMonth} ${year}`;
  }

  const periodSlug = finalPeriod.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const normKey = normalizePeriodKey(finalPeriod);

  return { periodStr: finalPeriod, periodSlug, normKey };
}

function doesTextMatchEmployee(text: string, emp: EligibleEmployee): boolean {
  const nameTokens = emp.name
    .toLowerCase()
    .split(/\s+/)
    .filter((t: string) => t.length > 2 && !/^(employee|member|user|team|staff|admin|owner)$/i.test(t));
  if (nameTokens.some((tok: string) => new RegExp(`\\b${tok}\\b`, 'i').test(text))) {
    return true;
  }
  const emailPrefix = emp.email ? emp.email.split('@')[0].toLowerCase() : '';
  if (emailPrefix && emailPrefix.length > 3 && text.includes(emailPrefix)) {
    return true;
  }
  return false;
}

/**
 * Scan transactions and automatically issue/merge monthly payslips for high-confidence
 * salary AND separate employee expense reimbursement matches.
 */
export async function detectAndIssuePayslipsForTransactions(
  sb: any,
  orgId: string,
  transactions: any[],
  options?: { authUserId?: string; issueDate?: string },
): Promise<DetectionResult> {
  const result: DetectionResult = {
    processedTransactions: 0,
    autoIssuedCount: 0,
    autoAllocatedAmount: 0,
    matchedEmployees: [],
    skippedDuplicates: 0,
    details: [],
  };

  if (!sb || !orgId || !Array.isArray(transactions) || transactions.length === 0) {
    return result;
  }

  // 1. Fetch active organization members, profiles, existing payslips, and approved/reimbursed expenses
  const [membersRes, profilesRes, payslipsRes, expensesRes] = await Promise.all([
    sb
      .from('organization_members')
      .select('id, user_id, role, access_role, department, department_id, fixed_salary, hourly_rate')
      .eq('organization_id', orgId),
    sb.from('profiles').select('id, full_name, email'),
    sb
      .from('employee_payslips')
      .select('*')
      .eq('organization_id', orgId),
    sb
      .from('employee_expenses')
      .select('*')
      .eq('organization_id', orgId)
      .in('status', ['approved', 'reimbursed']),
  ]);

  const profileMap = new Map<string, { name: string; email: string }>();
  if (profilesRes?.data) {
    for (const p of profilesRes.data) {
      profileMap.set(p.id, {
        name: p.full_name || p.email?.split('@')[0] || 'Employee',
        email: p.email || '',
      });
    }
  }

  const rawMembers = membersRes?.data || [];
  const eligibleEmployees: EligibleEmployee[] = rawMembers
    .filter((m: any) => {
      const role = String(m.role || '').toLowerCase();
      return role !== 'owner' && role !== 'admin' && role !== 'org_admin';
    })
    .map((m: any): EligibleEmployee => {
      const prof = profileMap.get(m.user_id) || { name: 'Employee', email: '' };
      return {
        id: m.id,
        userId: m.user_id,
        name: prof.name,
        email: prof.email,
        departmentId: m.department_id || m.department || 'General',
        fixedSalary: round2(m.fixed_salary || 0),
        hourlyRate: round2(m.hourly_rate || 0),
      };
    });

  if (eligibleEmployees.length === 0) {
    return result;
  }

  // Active payslips indexed by `${userId}::${normKey}` (ignoring voided payslips)
  const activePayslipByUserPeriod = new Map<string, any>();
  const existingPayslips = payslipsRes?.data || [];
  for (const p of existingPayslips) {
    if (String(p.status || '').toLowerCase() === 'voided') continue;
    const k = `${p.user_id}::${normalizePeriodKey(p.period)}`;
    if (!activePayslipByUserPeriod.has(k)) {
      activePayslipByUserPeriod.set(k, { ...p });
    }
  }

  // Approved/reimbursed expenses indexed by `${userId}::${normKey}`
  const expensesByUserPeriod = new Map<string, any[]>();
  const allPayableExpenses: any[] = expensesRes?.data || [];
  for (const exp of allPayableExpenses) {
    const { normKey } = extractPeriodFromTxn({ date: exp.date, description: exp.description });
    const k = `${exp.user_id}::${normKey}`;
    const list = expensesByUserPeriod.get(k) || [];
    list.push(exp);
    expensesByUserPeriod.set(k, list);
  }

  const payrollKeywordRegex = /\b(salary|salaries|payroll|payslip|wages|compensation|monthly\s*pay|paycheck)\b/i;
  const batchPayrollRegex = /\b(all\s+staff|staff\s+salaries|team\s+payroll|monthly\s+payroll|company\s+salaries|lump\s*sum\s+payroll)\b/i;
  const reimbursementKeywordRegex = /\b(reimburse|reimbursement|reimb|expense|claim|refund|ssl|travel|hardware|laptop|per\s*diem|allowance)\b/i;

  for (const txn of transactions) {
    const amount = round2(txn.amount || 0);
    const type = txn.type || 'debit';
    const isTransfer = Boolean(txn.is_transfer);

    if (type !== 'debit' || isTransfer || amount <= 0) {
      continue;
    }

    result.processedTransactions++;

    const existingTags: string[] = Array.isArray(txn.tags) ? txn.tags.map(String) : [];
    let allocatedAmount = 0;
    for (const t of existingTags) {
      if (t.startsWith('payslip_alloc:')) {
        const parts = t.split(':');
        allocatedAmount = round2(allocatedAmount + Number(parts[4] || 0));
      }
    }

    const remainingAmount = Math.max(0, round2(amount - allocatedAmount));
    if (remainingAmount <= 0.01) {
      continue;
    }

    const text = `${txn.description || ''} ${txn.narration || ''} ${existingTags.join(' ')}`.toLowerCase();
    const hasSalaryKeyword = payrollKeywordRegex.test(text);
    const hasBatchKeyword = batchPayrollRegex.test(text);
    const hasReimbursementKeyword = reimbursementKeywordRegex.test(text);

    const { periodStr, periodSlug, normKey } = extractPeriodFromTxn(txn);

    let matchType: DetectionResult['details'][number]['matchType'] | null = null;
    let matchedAllocations: Array<{
      member: EligibleEmployee;
      amount: number;
      kind: PayslipAllocationKind;
      matchedExpense?: any;
    }> = [];

    // --- TRACK A: Separate Employee Expense / Reimbursement Transaction ---
    // Priority 1: Match an unlinked approved/reimbursed employee_expenses claim by exact amount + (employee name or description/reimb keyword)
    const candidateClaims = allPayableExpenses.filter(
      (exp: any) =>
        !exp.settlement_transaction_id &&
        Math.abs(round2(exp.amount) - remainingAmount) < 0.05 &&
        extractPeriodFromTxn({ date: exp.date, description: exp.description }).normKey === normKey,
    );

    if (candidateClaims.length > 0) {
      const exactClaim = candidateClaims.find((exp: any) => {
        const emp = eligibleEmployees.find(e => e.userId === exp.user_id);
        if (!emp) return false;
        const empMatch = doesTextMatchEmployee(text, emp);
        const descWords = String(exp.description || '')
          .toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length >= 3);
        const descMatch = descWords.some((w: string) => text.includes(w));
        return empMatch || descMatch || (candidateClaims.length === 1 && hasReimbursementKeyword);
      });

      if (exactClaim) {
        const emp = eligibleEmployees.find(e => e.userId === exactClaim.user_id);
        if (emp) {
          matchType = 'expense_claim_match';
          matchedAllocations = [
            { member: emp, amount: remainingAmount, kind: 'reimbursement', matchedExpense: exactClaim },
          ];
        }
      }
    }

    // Priority 2: Explicit reimbursement keyword + employee name/email token in narration
    if (!matchType && hasReimbursementKeyword && !hasSalaryKeyword) {
      const empMatch = eligibleEmployees.find(e => doesTextMatchEmployee(text, e));
      if (empMatch) {
        matchType = 'expense_name_match';
        matchedAllocations = [{ member: empMatch, amount: remainingAmount, kind: 'reimbursement' }];
      }
    }

    // --- TRACK B: Salary Outflow Strategies (for employees whose salary isn't already paid this period) ---
    if (!matchType) {
      const unpaidSalaryEmployees = eligibleEmployees.filter((e: EligibleEmployee) => {
        const existing = activePayslipByUserPeriod.get(`${e.userId}::${normKey}`);
        if (!existing) return true;
        const existingSal = round2(existing.salary_amount ?? (Number(existing.reimbursement_amount || 0) === 0 ? existing.gross : 0));
        return existingSal <= 0.01;
      });

      if (unpaidSalaryEmployees.length > 0) {
        // Strategy 1: Exact Fixed Salary Match
        if (hasSalaryKeyword || unpaidSalaryEmployees.length === 1) {
          const exactSalaryMatch = unpaidSalaryEmployees.find(
            (e: EligibleEmployee) => e.fixedSalary > 0 && Math.abs(e.fixedSalary - remainingAmount) < 0.01,
          );
          if (exactSalaryMatch) {
            matchType = 'fixed_salary';
            matchedAllocations = [{ member: exactSalaryMatch, amount: remainingAmount, kind: 'salary' }];
          }
        }

        // Strategy 2: Name Token Match in Narration
        if (!matchType) {
          for (const emp of unpaidSalaryEmployees) {
            const nameTokens = emp.name.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
            const nameMatched = nameTokens.some((tok: string) => new RegExp(`\\b${tok}\\b`, 'i').test(text));
            if (nameMatched) {
              matchType = 'name_match';
              const allocAmt =
                emp.fixedSalary > 0 && emp.fixedSalary <= remainingAmount ? emp.fixedSalary : remainingAmount;
              matchedAllocations = [{ member: emp, amount: allocAmt, kind: 'salary' }];
              break;
            }
          }
        }

        // Strategy 3: Email Prefix Match in Narration
        if (!matchType) {
          for (const emp of unpaidSalaryEmployees) {
            const emailPrefix = emp.email ? emp.email.split('@')[0].toLowerCase() : '';
            if (emailPrefix && emailPrefix.length > 3 && text.includes(emailPrefix)) {
              matchType = 'email_match';
              const allocAmt =
                emp.fixedSalary > 0 && emp.fixedSalary <= remainingAmount ? emp.fixedSalary : remainingAmount;
              matchedAllocations = [{ member: emp, amount: allocAmt, kind: 'salary' }];
              break;
            }
          }
        }

        // Strategy 4: Lump-Sum Batch Match
        if (!matchType && (hasBatchKeyword || (hasSalaryKeyword && unpaidSalaryEmployees.length > 1))) {
          const unpaidSalariesSum = round2(
            unpaidSalaryEmployees.reduce((s: number, e: EligibleEmployee) => s + (e.fixedSalary || 0), 0),
          );
          if (unpaidSalariesSum > 0 && Math.abs(unpaidSalariesSum - remainingAmount) < 0.05) {
            matchType = 'lump_sum_split';
            matchedAllocations = unpaidSalaryEmployees.map((e: EligibleEmployee) => ({
              member: e,
              amount: e.fixedSalary,
              kind: 'salary' as const,
            }));
          }
        }

        // Strategy 5: Single Unpaid Employee with Strong Salary Keyword
        if (!matchType && hasSalaryKeyword && unpaidSalaryEmployees.length === 1) {
          matchType = 'single_unpaid';
          matchedAllocations = [{ member: unpaidSalaryEmployees[0], amount: remainingAmount, kind: 'salary' }];
        }
      }
    }

    if (!matchType || matchedAllocations.length === 0) {
      continue;
    }

    const effIssueDate = options?.issueDate || (txn.date ? String(txn.date).slice(0, 10) : new Date().toISOString().slice(0, 10));
    const newTags: string[] = [];
    const confirmedAllocations: AllocationResult[] = [];

    for (const alloc of matchedAllocations) {
      const mem = alloc.member;
      const allocAmt = round2(alloc.amount);
      if (allocAmt <= 0) continue;

      const userPeriodKey = `${mem.userId}::${normKey}`;
      const existing = activePayslipByUserPeriod.get(userPeriodKey);

      // Idempotency guard: skip if this exact transaction already allocated to this payslip
      if (existing && existingTags.some(t => t.startsWith(`payslip_alloc:${existing.id}:${mem.userId}:`) && t.endsWith(`:${alloc.kind}`))) {
        result.skippedDuplicates++;
        continue;
      }

      const payslipId = existing?.id || `ps-${txn.id}-${mem.userId}-${periodSlug}`;
      const prevSalary = existing
        ? round2(existing.salary_amount ?? (Number(existing.reimbursement_amount || 0) === 0 ? existing.gross : 0))
        : 0;
      const prevReimb = existing ? round2(existing.reimbursement_amount || 0) : 0;

      const salaryAmount = alloc.kind === 'salary' ? round2(prevSalary + allocAmt) : prevSalary;
      const reimbursementAmount = alloc.kind === 'reimbursement' ? round2(prevReimb + allocAmt) : prevReimb;
      const gross = round2(salaryAmount + reimbursementAmount);

      const existingDeductions: any[] = Array.isArray(existing?.deductions) ? existing.deductions : [];
      const dedSum = round2(existingDeductions.reduce((s: number, d: any) => s + Number(d?.amount || 0), 0));
      const net = Math.max(0, round2(gross - dedSum));

      // Expected monthly payable = Base Fixed Salary + Approved/Reimbursed Expenses for this period
      const periodExpenses = expensesByUserPeriod.get(userPeriodKey) || [];
      const expectedReimbursements = round2(
        periodExpenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0),
      );
      const variance = computePayslipVariance(net, mem.fixedSalary, expectedReimbursements);

      const prevReimbDetails: ReimbursementDetailItem[] = Array.isArray(existing?.reimbursement_details)
        ? existing.reimbursement_details
        : [];
      const nextReimbDetails: ReimbursementDetailItem[] =
        alloc.kind === 'reimbursement'
          ? [
              ...prevReimbDetails,
              {
                expenseId: alloc.matchedExpense?.id,
                description: alloc.matchedExpense?.description || txn.description || 'Expense Reimbursement',
                amount: allocAmt,
                transactionId: txn.id,
              },
            ]
          : prevReimbDetails;

      const prevLinkedIds: string[] = Array.isArray(existing?.linked_expense_ids) ? existing.linked_expense_ids : [];
      const nextLinkedIds =
        alloc.matchedExpense?.id && !prevLinkedIds.includes(alloc.matchedExpense.id)
          ? [...prevLinkedIds, alloc.matchedExpense.id]
          : prevLinkedIds;

      const payslipPayload: Record<string, any> = {
        id: payslipId,
        organization_id: orgId,
        user_id: mem.userId,
        period: existing?.period || periodStr,
        issue_date: effIssueDate,
        gross,
        deductions: existingDeductions,
        net,
        currency: txn.currency || existing?.currency || 'USD',
        status: 'paid',
        source_transaction_id: existing?.source_transaction_id || txn.id,
        department_id: mem.departmentId || 'General',
        salary_amount: salaryAmount,
        reimbursement_amount: reimbursementAmount,
        expected_salary: variance.expectedSalary,
        expected_reimbursements: variance.expectedReimbursements,
        expected_total: variance.expectedTotal,
        variance_amount: variance.varianceAmount,
        variance_status: variance.varianceStatus,
        reimbursement_details: nextReimbDetails,
        linked_expense_ids: nextLinkedIds,
        ...(options?.authUserId ? { issued_by: options.authUserId } : {}),
      };

      try {
        let { error: psErr } = await sb.from('employee_payslips').upsert(payslipPayload);
        if (
          psErr &&
          (psErr.message?.includes('issued_by') ||
            psErr.message?.includes('salary_amount') ||
            psErr.message?.includes('variance_status'))
        ) {
          // Graceful fallback if migrations 0042/0043 not yet applied
          const fallbackPayload: Record<string, any> = {
            id: payslipId,
            organization_id: orgId,
            user_id: mem.userId,
            period: existing?.period || periodStr,
            issue_date: effIssueDate,
            gross,
            deductions: existingDeductions,
            net,
            currency: txn.currency || existing?.currency || 'USD',
            status: 'paid',
            source_transaction_id: existing?.source_transaction_id || txn.id,
            department_id: mem.departmentId || 'General',
          };
          const retry = await sb.from('employee_payslips').upsert(fallbackPayload);
          psErr = retry.error;
        }
        if (psErr) {
          console.warn('[aiPayrollDetector] Error upserting payslip:', psErr.message);
          continue;
        }

        // Update local cache so subsequent transactions in the same batch merge accurately
        activePayslipByUserPeriod.set(userPeriodKey, payslipPayload);

        // Link & settle matched approved/reimbursed employee_expenses claim (zero double-counting)
        if (alloc.matchedExpense?.id && !alloc.matchedExpense.settlement_transaction_id) {
          try {
            const nowIso = new Date().toISOString();
            await sb
              .from('employee_expenses')
              .update({
                status: 'reimbursed',
                reimbursed_at: alloc.matchedExpense.reimbursed_at || nowIso,
                settlement_transaction_id: txn.id,
              })
              .eq('id', alloc.matchedExpense.id)
              .eq('organization_id', orgId);
            alloc.matchedExpense.status = 'reimbursed';
            alloc.matchedExpense.settlement_transaction_id = txn.id;
          } catch {
            // non-fatal
          }
        }

        // Record relational payslip allocation
        try {
          await sb.from('payslip_allocations').upsert({
            id: `pa-${payslipId}-${txn.id}-${alloc.kind}`,
            organization_id: orgId,
            payslip_id: payslipId,
            transaction_id: txn.id,
            department_id: mem.departmentId || 'General',
            allocated_amount: allocAmt,
            allocation_kind: alloc.kind,
          });
        } catch {
          // non-fatal
        }

        // Emit transactional outbox event (§19, §33 #7)
        try {
          const { emitOutboxEvent } = await import('./outboxService.js');
          void emitOutboxEvent(sb, {
            organizationId: orgId,
            eventType: 'payslip.issued',
            resourceType: 'employee_payslip',
            resourceId: payslipId,
            payload: {
              userId: mem.userId,
              period: payslipPayload.period,
              kind: alloc.kind,
              salaryAmount,
              reimbursementAmount,
              gross,
              net,
              expectedTotal: variance.expectedTotal,
              varianceAmount: variance.varianceAmount,
              varianceStatus: variance.varianceStatus,
              currency: payslipPayload.currency,
              sourceTransactionId: txn.id,
              autoDetected: true,
            },
          });
        } catch {
          // non-fatal
        }

        result.autoIssuedCount++;
        result.autoAllocatedAmount = round2(result.autoAllocatedAmount + allocAmt);
        result.matchedEmployees.push(mem.name);

        const safeDept = String(mem.departmentId || 'General').replace(/:/g, '-');
        newTags.push(`payslip_alloc:${payslipId}:${mem.userId}:${safeDept}:${allocAmt}:${periodSlug}:${alloc.kind}`);

        confirmedAllocations.push({
          payslipId,
          userId: mem.userId,
          employeeName: mem.name,
          departmentId: mem.departmentId,
          kind: alloc.kind,
          gross,
          net,
          salaryAmount,
          reimbursementAmount,
          expectedTotal: variance.expectedTotal,
          varianceAmount: variance.varianceAmount,
          varianceStatus: variance.varianceStatus,
          period: payslipPayload.period,
          periodSlug,
        });

        try {
          const { emitEmployeePayslipIssuedNotification } = await import('../routes/employee.js');
          void emitEmployeePayslipIssuedNotification(sb, orgId, {
            id: payslipId,
            userId: mem.userId,
            period: payslipPayload.period,
            issueDate: effIssueDate,
            gross,
            deductions: existingDeductions,
            net,
            currency: payslipPayload.currency,
            employeeName: mem.name,
          });
        } catch {
          // non-fatal
        }
      } catch (err: any) {
        console.warn('[aiPayrollDetector] Upsert exception:', err?.message || err);
      }
    }

    if (newTags.length > 0) {
      const mergedTags = Array.from(new Set([...existingTags, ...newTags]));
      try {
        await sb
          .from('transactions')
          .update({ tags: mergedTags })
          .eq('id', txn.id)
          .eq('organization_id', orgId);
      } catch (tagErr: any) {
        console.warn('[aiPayrollDetector] Failed to update transaction tags:', tagErr?.message || tagErr);
      }

      result.details.push({
        transactionId: txn.id,
        description: txn.description || txn.narration || '',
        amount,
        period: periodStr,
        allocations: confirmedAllocations,
        matchType,
      });
    }
  }

  return result;
}

/**
 * Immutably void an issued payslip (§8, §33 #4/#18 — never hard-delete financial records)
 * and clean up source transaction allocation tags + relational allocations.
 */
export async function voidPayslip(
  sb: any,
  orgId: string,
  payslipId: string,
  actorUserId?: string,
  reason?: string,
): Promise<{ success: boolean; message: string; beforeState?: any }> {
  if (!sb || !orgId || !payslipId) {
    return { success: false, message: 'Invalid arguments' };
  }

  try {
    const { data: ps, error: psErr } = await sb
      .from('employee_payslips')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', payslipId)
      .maybeSingle();

    if (psErr || !ps) {
      return { success: false, message: psErr?.message || 'Payslip not found' };
    }

    if (String(ps.status || '').toLowerCase() === 'voided') {
      return { success: true, message: `Payslip ${payslipId} is already voided`, beforeState: ps };
    }

    const nowIso = new Date().toISOString();
    const voidPatch: Record<string, any> = {
      status: 'voided',
      void_reason: reason?.trim() || 'Voided by payroll administrator',
      voided_by: actorUserId || null,
      voided_at: nowIso,
      updated_at: nowIso,
    };

    const { error: voidErr } = await sb
      .from('employee_payslips')
      .update(voidPatch)
      .eq('organization_id', orgId)
      .eq('id', payslipId);

    if (voidErr) {
      return { success: false, message: `Failed to void payslip: ${voidErr.message}` };
    }

    try {
      await sb
        .from('payslip_allocations')
        .delete()
        .eq('organization_id', orgId)
        .eq('payslip_id', payslipId);
    } catch {
      // non-fatal
    }

    const targetSourceId = ps.source_transaction_id;
    if (targetSourceId) {
      const { data: txn } = await sb
        .from('transactions')
        .select('id, tags')
        .eq('organization_id', orgId)
        .eq('id', targetSourceId)
        .maybeSingle();

      if (txn && Array.isArray(txn.tags)) {
        const cleanedTags = txn.tags.filter((t: string) => !t.startsWith(`payslip_alloc:${payslipId}:`));
        await sb
          .from('transactions')
          .update({ tags: cleanedTags })
          .eq('organization_id', orgId)
          .eq('id', targetSourceId);
      }
    }

    try {
      const { emitOutboxEvent } = await import('./outboxService.js');
      void emitOutboxEvent(sb, {
        organizationId: orgId,
        eventType: 'payslip.voided',
        resourceType: 'employee_payslip',
        resourceId: payslipId,
        payload: {
          userId: ps.user_id,
          period: ps.period,
          voidedBy: actorUserId || null,
          reason: voidPatch.void_reason,
        },
      });
    } catch {
      // non-fatal
    }

    return { success: true, message: `Successfully voided payslip ${payslipId}`, beforeState: ps };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error voiding payslip' };
  }
}
