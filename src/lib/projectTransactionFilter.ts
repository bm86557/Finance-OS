/**
 * Shared Project Transaction Eligibility & Transfer-Exclusion Rules
 * =================================================================
 * Implements FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md:
 * - §1 (Line 48) & §7 (Line 320) & §8 (Line 368) & §23 (F-01, F-07):
 *   Internal transfers & Bank<->Cash movements have ZERO P&L impact and must
 *   never inflate project revenue or direct expenses.
 * - §5 & §12.3: Exclude personal-world entries and unposted/reversed statuses.
 * - §12.4, §29 (X-07), §33.1: Exclude payroll payouts & reimbursement settlements
 *   from direct project debits to prevent double-counting.
 */

export function isInternalTransferTransaction(t: any): boolean {
  if (!t) return false;
  if (Boolean(t.is_transfer ?? t.isTransfer)) return true;
  if (Boolean(t.transfer_group_id ?? t.transferGroupId)) return true;

  const tags = Array.isArray(t.tags) ? t.tags.map((x: any) => String(x).toLowerCase()) : [];
  if (
    tags.includes('transfer') ||
    tags.includes('internal-transfer') ||
    tags.includes('internal_transfer')
  ) {
    return true;
  }

  const desc = String(t.description || t.narration || '').trim().toLowerCase();
  if (
    desc.startsWith('internal transfer') ||
    desc.includes('atm cash withdrawal')
  ) {
    return true;
  }

  return false;
}

export function isValidProjectTransaction(t: any, fromDate?: string, toDate?: string): boolean {
  if (!t) return false;
  const status = String(t.status || '').toLowerCase();
  if (['pending', 'draft', 'rejected', 'reversed', 'cancelled'].includes(status)) {
    return false;
  }
  const worldScope = String(t.world_scope ?? t.worldScope ?? '').toLowerCase();
  const tags = Array.isArray(t.tags) ? t.tags.map((x: any) => String(x).toLowerCase()) : [];
  if (worldScope === 'personal' || tags.includes('personal')) {
    return false;
  }
  if (isInternalTransferTransaction(t)) {
    return false;
  }
  if (fromDate && t.date && t.date < fromDate) return false;
  if (toDate && t.date && t.date > toDate) return false;
  return true;
}

export function isDirectProjectDebit(t: any): boolean {
  if (!t || t.type !== 'debit') return false;
  if (isInternalTransferTransaction(t)) return false;

  const tags = Array.isArray(t.tags) ? t.tags.map((x: any) => String(x).toLowerCase()) : [];
  if (
    tags.includes('reimbursement_settlement') ||
    tags.includes('payroll_payout') ||
    tags.includes('salary') ||
    tags.includes('payroll') ||
    tags.some((tag: string) => tag.startsWith('payslip_alloc:'))
  ) {
    return false;
  }

  const desc = String(t.description || t.narration || '').toLowerCase();
  if (
    desc.includes('reimbursement settlement') ||
    desc.includes('expense payout') ||
    desc.includes('salary payout') ||
    desc.includes('payroll transfer') ||
    desc.includes('payroll payout') ||
    desc.includes('employee salary')
  ) {
    return false;
  }
  return true;
}
