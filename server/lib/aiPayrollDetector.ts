/**
 * AI Payroll Detection & Automated Payslip Generation Engine (§11 & §13)
 * Analyzes bank statement debit transactions and ledger entries to:
 * 1. Automatically detect salary/payroll payouts.
 * 2. Extract target pay period (month & year) from narration or posting date.
 * 3. Resolve target employee via fixed salary, name tokens, or email prefixes (and lump-sum split).
 * 4. Issue official employee_payslips records idempotently without double-counting (F-04 Invariant).
 */

export interface EligibleEmployee {
  id: string;
  userId: string;
  name: string;
  email: string;
  departmentId: string;
  fixedSalary: number;
  hourlyRate: number;
}

export interface AllocationResult {
  payslipId: string;
  userId: string;
  employeeName: string;
  departmentId: string;
  gross: number;
  net: number;
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
    matchType: 'fixed_salary' | 'name_match' | 'email_match' | 'lump_sum_split' | 'single_unpaid';
  }>;
}

export function normalizePeriodKey(p: string | null | undefined): string {
  if (!p) return '';
  return String(p).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function extractPeriodFromTxn(txn: any, fallback?: string): { periodStr: string; periodSlug: string; normKey: string } {
  const text = `${txn?.description || ''} ${txn?.narration || ''}`.toLowerCase();
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
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

/**
 * Scan transactions and automatically issue payslips for high-confidence salary matches.
 */
export async function detectAndIssuePayslipsForTransactions(
  sb: any,
  orgId: string,
  transactions: any[],
  options?: { authUserId?: string; issueDate?: string }
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

  // 1. Fetch active organization members and profiles
  const [membersRes, profilesRes, payslipsRes] = await Promise.all([
    sb.from('organization_members')
      .select('id, user_id, role, access_role, department, department_id, fixed_salary, hourly_rate')
      .eq('organization_id', orgId),
    sb.from('profiles')
      .select('id, full_name, email'),
    sb.from('employee_payslips')
      .select('id, user_id, period, gross, net, status')
      .eq('organization_id', orgId),
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

  // Filter to eligible employee members (exclude owners/admins from auto-payroll)
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
        fixedSalary: Number(m.fixed_salary || 0),
        hourlyRate: Number(m.hourly_rate || 0),
      };
    });

  if (eligibleEmployees.length === 0) {
    return result;
  }

  // Build existing payslip lookup: `${userId}::${normKey}`
  const existingPayslips = payslipsRes?.data || [];
  const issuedSet = new Set<string>();
  for (const p of existingPayslips) {
    const k = `${p.user_id}::${normalizePeriodKey(p.period)}`;
    issuedSet.add(k);
  }

  const payrollKeywordRegex = /\b(salary|salaries|payroll|payslip|wages|stipend|compensation|monthly\s*pay|paycheck)\b/i;
  const batchPayrollRegex = /\b(all\s+staff|staff\s+salaries|team\s+payroll|monthly\s+payroll|company\s+salaries|lump\s*sum\s+payroll)\b/i;

  for (const txn of transactions) {
    const amount = Number(txn.amount || 0);
    const type = txn.type || 'debit';
    const isTransfer = Boolean(txn.is_transfer);

    // Only process non-transfer debit outflows
    if (type !== 'debit' || isTransfer || amount <= 0) {
      continue;
    }

    result.processedTransactions++;

    // Calculate existing allocations on this transaction if any
    const existingTags: string[] = Array.isArray(txn.tags) ? txn.tags.map(String) : [];
    let allocatedAmount = 0;
    for (const t of existingTags) {
      if (t.startsWith('payslip_alloc:')) {
        const parts = t.split(':');
        allocatedAmount += Number(parts[4] || 0);
      }
    }

    const remainingAmount = Math.max(0, Math.round((amount - allocatedAmount) * 100) / 100);
    if (remainingAmount <= 0.01) {
      continue; // Transaction already fully allocated
    }

    const text = `${txn.description || ''} ${txn.narration || ''} ${existingTags.join(' ')}`.toLowerCase();
    const hasSalaryKeyword = payrollKeywordRegex.test(text);
    const hasBatchKeyword = batchPayrollRegex.test(text);

    const { periodStr, periodSlug, normKey } = extractPeriodFromTxn(txn);

    // Filter employees who are NOT yet paid for this target period
    const unpaidEmployees: EligibleEmployee[] = eligibleEmployees.filter((e: EligibleEmployee) => !issuedSet.has(`${e.userId}::${normKey}`));
    if (unpaidEmployees.length === 0) {
      continue; // All employees already paid for this period
    }

    let matchType: 'fixed_salary' | 'name_match' | 'email_match' | 'lump_sum_split' | 'single_unpaid' | null = null;
    let matchedAllocations: Array<{ member: EligibleEmployee; gross: number }> = [];

    // --- STRATEGY 1: Exact Fixed Salary Match with Salary Context ---
    if (hasSalaryKeyword || unpaidEmployees.length === 1) {
      const exactSalaryMatch = unpaidEmployees.find((e: EligibleEmployee) => e.fixedSalary > 0 && Math.abs(e.fixedSalary - remainingAmount) < 0.01);
      if (exactSalaryMatch) {
        matchType = 'fixed_salary';
        matchedAllocations = [{ member: exactSalaryMatch, gross: remainingAmount }];
      }
    }

    // --- STRATEGY 2: Name Token Match in Narration ---
    if (!matchType) {
      for (const emp of unpaidEmployees) {
        const nameTokens = emp.name.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
        const nameMatched = nameTokens.some((tok: string) => {
          const reg = new RegExp(`\\b${tok}\\b`, 'i');
          return reg.test(text);
        });
        if (nameMatched) {
          matchType = 'name_match';
          const allocGross = emp.fixedSalary > 0 && emp.fixedSalary <= remainingAmount ? emp.fixedSalary : remainingAmount;
          matchedAllocations = [{ member: emp, gross: allocGross }];
          break;
        }
      }
    }

    // --- STRATEGY 3: Email Prefix Match in Narration ---
    if (!matchType) {
      for (const emp of unpaidEmployees) {
        const emailPrefix = emp.email ? emp.email.split('@')[0].toLowerCase() : '';
        if (emailPrefix && emailPrefix.length > 3 && text.includes(emailPrefix)) {
          matchType = 'email_match';
          const allocGross = emp.fixedSalary > 0 && emp.fixedSalary <= remainingAmount ? emp.fixedSalary : remainingAmount;
          matchedAllocations = [{ member: emp, gross: allocGross }];
          break;
        }
      }
    }

    // --- STRATEGY 4: Lump-Sum Batch Match ---
    if (!matchType && (hasBatchKeyword || (hasSalaryKeyword && unpaidEmployees.length > 1))) {
      // Check if remainingAmount equals sum of fixed salaries of unpaid employees
      const unpaidSalariesSum = unpaidEmployees.reduce((s: number, e: EligibleEmployee) => s + (e.fixedSalary || 0), 0);
      if (unpaidSalariesSum > 0 && Math.abs(unpaidSalariesSum - remainingAmount) < 0.05) {
        matchType = 'lump_sum_split';
        matchedAllocations = unpaidEmployees.map((e: EligibleEmployee) => ({ member: e, gross: e.fixedSalary }));
      }
    }

    // --- STRATEGY 5: Single Unpaid Employee with Strong Salary Keyword ---
    if (!matchType && hasSalaryKeyword && unpaidEmployees.length === 1) {
      matchType = 'single_unpaid';
      matchedAllocations = [{ member: unpaidEmployees[0], gross: remainingAmount }];
    }

    // If no high-confidence match found, leave transaction unallocated for manual review
    if (!matchType || matchedAllocations.length === 0) {
      continue;
    }

    // Execute issuance for matched allocations
    const effIssueDate = options?.issueDate || (txn.date ? txn.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const newTags: string[] = [];
    const confirmedAllocations: AllocationResult[] = [];

    for (const alloc of matchedAllocations) {
      const mem = alloc.member;
      const gross = Math.round(alloc.gross * 100) / 100;
      const payslipId = `ps-${txn.id}-${mem.userId}-${periodSlug}`;

      // Idempotency check before insert
      if (issuedSet.has(`${mem.userId}::${normKey}`)) {
        result.skippedDuplicates++;
        continue;
      }

      const payslipPayload = {
        id: payslipId,
        organization_id: orgId,
        user_id: mem.userId,
        period: periodStr,
        issue_date: effIssueDate,
        gross,
        deductions: [],
        net: gross,
        currency: txn.currency || 'USD',
        status: 'paid',
        source_transaction_id: txn.id,
        department_id: mem.departmentId || 'General',
      };

      try {
        const { error: psErr } = await sb.from('employee_payslips').upsert(payslipPayload);
        if (psErr) {
          console.warn('[aiPayrollDetector] Error inserting payslip:', psErr.message);
          continue;
        }

        issuedSet.add(`${mem.userId}::${normKey}`);
        result.autoIssuedCount++;
        result.autoAllocatedAmount += gross;
        result.matchedEmployees.push(mem.name);

        const safeDept = String(mem.departmentId || 'General').replace(/:/g, '-');
        newTags.push(`payslip_alloc:${payslipId}:${mem.userId}:${safeDept}:${gross}:${periodSlug}`);

        confirmedAllocations.push({
          payslipId,
          userId: mem.userId,
          employeeName: mem.name,
          departmentId: mem.departmentId,
          gross,
          net: gross,
          period: periodStr,
          periodSlug,
        });

        // Complies with user requirement: dispatch in-app and email notifications
        try {
          const { emitEmployeePayslipIssuedNotification } = await import('../routes/employee.js');
          void emitEmployeePayslipIssuedNotification(
            sb,
            orgId,
            {
              id: payslipId,
              userId: mem.userId,
              period: periodStr,
              issueDate: options?.issueDate || new Date().toISOString().slice(0, 10),
              gross,
              deductions: [],
              net: gross,
              currency: txn.currency || 'USD',
              employeeName: mem.name,
            },
          );
        } catch {
          // non-fatal
        }
      } catch (err: any) {
        console.warn('[aiPayrollDetector] Upsert exception:', err?.message || err);
      }
    }

    // If payslips were created, tag the source transaction
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
 * Void an issued payslip and clean up source transaction allocation tags.
 */
export async function voidPayslip(
  sb: any,
  orgId: string,
  payslipId: string
): Promise<{ success: boolean; message: string }> {
  if (!sb || !orgId || !payslipId) {
    return { success: false, message: 'Invalid arguments' };
  }

  try {
    // 1. Fetch payslip
    const { data: ps, error: psErr } = await sb
      .from('employee_payslips')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', payslipId)
      .maybeSingle();

    if (psErr || !ps) {
      return { success: false, message: psErr?.message || 'Payslip not found' };
    }

    // 2. Delete payslip
    const { error: delErr } = await sb
      .from('employee_payslips')
      .delete()
      .eq('organization_id', orgId)
      .eq('id', payslipId);

    if (delErr) {
      return { success: false, message: `Failed to delete payslip: ${delErr.message}` };
    }

    // 3. Find and clean source transaction tags
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

    return { success: true, message: `Successfully voided payslip ${payslipId}` };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error voiding payslip' };
  }
}
