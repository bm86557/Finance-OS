/**
 * Double-Entry General Ledger Service (§7, §8, §33).
 *
 * Enforces balanced double-entry accounting invariants on transaction posting:
 *   - Money inflow (credit to bank):
 *       DR: Bank Account Asset Account (1010/etc)
 *       CR: Category / Revenue Account (4010/etc)
 *   - Money outflow (debit from bank):
 *       DR: Category / Expense Account (5010/etc)
 *       CR: Bank Account Asset Account (1010/etc)
 *
 * Invariant: SUM(base_debit) == SUM(base_credit) on every posted journal entry.
 * Corrections are handled immutably via paired reversal journal entries.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LedgerPostingResult {
  success: boolean;
  journalEntryId?: string;
  error?: string;
}

/**
 * Enforce closed fiscal period guard (§7, §8, §23 F-06, §33 #5).
 * Blocks posting to any period marked 'soft_closed' or 'closed'.
 */
export async function assertFiscalPeriodOpen(
  sb: SupabaseClient,
  organizationId: string,
  entryDate: string,
): Promise<{ open: boolean; error?: string }> {
  const isoDate = String(entryDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return { open: true };
  try {
    const { data, error } = await sb
      .from('fiscal_periods')
      .select('id, name, status, start_date, end_date')
      .eq('organization_id', organizationId)
      .in('status', ['soft_closed', 'closed'])
      .lte('start_date', isoDate)
      .gte('end_date', isoDate)
      .limit(1);

    if (error) {
      // Gracefully allow if fiscal_periods table does not exist in older schemas
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return { open: true };
      }
      return { open: true };
    }
    if (data && data.length > 0) {
      const p = data[0];
      return {
        open: false,
        error: `Posting blocked: fiscal period "${p.name || p.start_date}" is ${p.status} for date ${isoDate} (Handoff §8, §23 F-06).`,
      };
    }
    return { open: true };
  } catch {
    return { open: true };
  }
}

export async function postTransactionToJournal(
  sb: SupabaseClient,
  txn: {
    id: string;
    organization_id: string;
    bank_account_id: string;
    category_id?: string | null;
    department_id?: string | null;
    project_id?: string | null;
    date: string;
    amount: number;
    base_amount?: number | null;
    currency?: string;
    type: 'credit' | 'debit' | 'income' | 'expense' | 'transfer' | string;
    description?: string;
    world_scope?: string;
  },
  actorUserId?: string | null,
): Promise<LedgerPostingResult> {
  try {
    const orgId = txn.organization_id;
    const baseAmt = Math.abs(Number(txn.base_amount ?? txn.amount));
    if (baseAmt <= 0) {
      return { success: true }; // Zero-dollar txns do not post journal lines
    }

    // Closed fiscal period guard (§8, §23 F-06, §33 #5)
    const periodCheck = await assertFiscalPeriodOpen(sb, orgId, txn.date || new Date().toISOString().slice(0, 10));
    if (!periodCheck.open) {
      return { success: false, error: periodCheck.error };
    }

    // Idempotency check (§33 #7): If journal entry already exists for this transaction, return early
    const { data: existingJe } = await sb
      .from('journal_entries')
      .select('id')
      .eq('organization_id', orgId)
      .eq('source_type', 'transaction')
      .eq('source_id', txn.id)
      .maybeSingle();

    if (existingJe?.id) {
      return { success: true, journalEntryId: existingJe.id };
    }

    // 1. Resolve Bank Account GL account
    const { data: bankRow } = await sb
      .from('bank_accounts')
      .select('account_id, currency, bank_name')
      .eq('id', txn.bank_account_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    // 2. Resolve Category GL account
    let categoryAccountId: string | null = null;
    if (txn.category_id) {
      const { data: catRow } = await sb
        .from('categories')
        .select('account_id')
        .eq('id', txn.category_id)
        .eq('organization_id', orgId)
        .maybeSingle();
      categoryAccountId = catRow?.account_id ?? null;
    }

    const isTransfer = Boolean(
      (txn as any).isTransfer ||
      (txn as any).is_transfer ||
      (txn as any).transferGroupId ||
      (txn as any).transfer_group_id ||
      txn.type === 'transfer' ||
      (Array.isArray((txn as any).tags) && (txn as any).tags.includes('transfer'))
    );

    // Fallback Chart of Accounts lookup if unlinked
    let resolvedBankAccountId: string;
    let resolvedOffsetAccountId: string;

    if (!bankRow?.account_id || !categoryAccountId || isTransfer) {
      const { data: accounts } = await sb
        .from('accounts')
        .select('id, type, subtype')
        .eq('organization_id', orgId)
        .eq('is_active', true);

      const bankAcc = (accounts || []).find((a: any) => a.type === 'asset' && ['bank_account', 'cash'].includes(a.subtype)) || accounts?.[0];
      const isCredit = txn.type === 'credit' || txn.type === 'income';

      if (isTransfer) {
        // Enforce Handoff v1.2 §8 & §23 F-01: Transfer offsets must be Asset clearing accounts, NEVER revenue or expense
        const transferClearingAcc = (accounts || []).find((a: any) => a.type === 'asset' && ['transfer_clearing', 'suspense', 'cash'].includes(a.subtype)) || bankAcc;
        resolvedBankAccountId = bankRow?.account_id || bankAcc?.id || `acc-${orgId}-cash-bank`;
        resolvedOffsetAccountId = transferClearingAcc?.id || `acc-${orgId}-clearing`;
      } else {
        const targetType = isCredit ? 'income' : 'expense';
        const offsetAcc = (accounts || []).find((a: any) => a.type === targetType) || accounts?.[1] || bankAcc;
        resolvedBankAccountId = bankRow?.account_id || bankAcc?.id || `acc-${orgId}-cash-bank`;
        resolvedOffsetAccountId = categoryAccountId || offsetAcc?.id || `acc-${orgId}-${targetType}`;
      }
    } else {
      resolvedBankAccountId = bankRow.account_id;
      resolvedOffsetAccountId = categoryAccountId;
    }

    const journalEntryId = `je-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entryNumber = `JE-${txn.date.replace(/-/g, '')}-${journalEntryId.slice(-4).toUpperCase()}`;
    const desc = txn.description || `Transaction ${txn.id}`;
    const worldScope = txn.world_scope || 'business';

    // 3. Insert Journal Entry Header
    const { error: jeErr } = await sb.from('journal_entries').insert({
      id: journalEntryId,
      organization_id: orgId,
      entry_number: entryNumber,
      entry_date: txn.date,
      description: desc,
      source_type: isTransfer ? 'transfer' : 'transaction',
      source_id: txn.id,
      world_scope: worldScope,
      status: 'posted',
      created_by: actorUserId || null,
      posted_at: new Date().toISOString(),
    });

    if (jeErr && !jeErr.message.includes('does not exist')) {
      return { success: false, error: jeErr.message };
    }

    // 4. Construct Balanced Journal Lines
    const lines = [];
    const isCredit = txn.type === 'credit' || txn.type === 'income';
    if (isCredit) {
      // Inflow: DR Bank Asset, CR Income Offset
      lines.push({
        journal_entry_id: journalEntryId,
        organization_id: orgId,
        account_id: resolvedBankAccountId,
        bank_account_id: txn.bank_account_id,
        description: desc,
        debit: baseAmt,
        credit: 0,
        currency: txn.currency || 'USD',
        base_debit: baseAmt,
        base_credit: 0,
      });
      lines.push({
        journal_entry_id: journalEntryId,
        organization_id: orgId,
        account_id: resolvedOffsetAccountId,
        department_id: txn.department_id || null,
        project_id: txn.project_id || null,
        description: desc,
        debit: 0,
        credit: baseAmt,
        currency: txn.currency || 'USD',
        base_debit: 0,
        base_credit: baseAmt,
      });
    } else {
      // Outflow: DR Expense Offset, CR Bank Asset
      lines.push({
        journal_entry_id: journalEntryId,
        organization_id: orgId,
        account_id: resolvedOffsetAccountId,
        department_id: txn.department_id || null,
        project_id: txn.project_id || null,
        description: desc,
        debit: baseAmt,
        credit: 0,
        currency: txn.currency || 'USD',
        base_debit: baseAmt,
        base_credit: 0,
      });
      lines.push({
        journal_entry_id: journalEntryId,
        organization_id: orgId,
        account_id: resolvedBankAccountId,
        bank_account_id: txn.bank_account_id,
        description: desc,
        debit: 0,
        credit: baseAmt,
        currency: txn.currency || 'USD',
        base_debit: 0,
        base_credit: baseAmt,
      });
    }

    const { error: lineErr } = await sb.from('journal_lines').insert(lines);
    if (lineErr && !lineErr.message.includes('does not exist')) {
      console.warn('[ledgerService] journal_lines insert warning:', lineErr.message);
    }

    // 5. Update source transaction
    await sb
      .from('transactions')
      .update({
        journal_entry_id: journalEntryId,
        posted_at: new Date().toISOString(),
      })
      .eq('id', txn.id)
      .eq('organization_id', orgId);

    return { success: true, journalEntryId };
  } catch (err: any) {
    console.error('[ledgerService] postTransactionToJournal exception:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function reverseTransactionJournal(
  sb: SupabaseClient,
  txnId: string,
  organizationId: string,
  reason: string,
  actorUserId?: string | null,
): Promise<LedgerPostingResult> {
  try {
    const { data: txn } = await sb
      .from('transactions')
      .select('*')
      .eq('id', txnId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!txn) {
      return { success: false, error: 'Transaction not found' };
    }

    const origJournalId = txn.journal_entry_id;
    if (origJournalId) {
      const { data: origLines } = await sb
        .from('journal_lines')
        .select('*')
        .eq('journal_entry_id', origJournalId);

      if (origLines && origLines.length >= 2) {
        const revJournalId = `je-rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const revEntryNumber = `REV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${revJournalId.slice(-4).toUpperCase()}`;

        await sb.from('journal_entries').insert({
          id: revJournalId,
          organization_id: organizationId,
          entry_number: revEntryNumber,
          entry_date: new Date().toISOString().split('T')[0],
          description: `Reversal of ${txn.description || txnId}: ${reason}`,
          source_type: 'reversal',
          source_id: txnId,
          world_scope: txn.world_scope || 'business',
          status: 'posted',
          reversal_of_journal_id: origJournalId,
          created_by: actorUserId || null,
          posted_at: new Date().toISOString(),
        });

        // Swap Debits and Credits
        const swappedLines = origLines.map((l: any) => ({
          journal_entry_id: revJournalId,
          organization_id: organizationId,
          account_id: l.account_id,
          bank_account_id: l.bank_account_id,
          department_id: l.department_id,
          project_id: l.project_id,
          description: `Reversal: ${l.description || ''}`,
          debit: l.credit,
          credit: l.debit,
          currency: l.currency,
          base_debit: l.base_credit,
          base_credit: l.base_debit,
        }));

        await sb.from('journal_lines').insert(swappedLines);

        await sb
          .from('journal_entries')
          .update({ reversed_by_journal_id: revJournalId, status: 'reversed' })
          .eq('id', origJournalId);
      }
    }

    await sb
      .from('transactions')
      .update({
        status: 'reversed',
        correction_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', txnId)
      .eq('organization_id', organizationId);

    return { success: true };
  } catch (err: any) {
    console.error('[ledgerService] reverseTransactionJournal exception:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export interface BalancedJournalLineInput {
  accountId: string;
  bankAccountId?: string | null;
  departmentId?: string | null;
  projectId?: string | null;
  description?: string;
  debit: number;
  credit: number;
}

export interface PostBalancedJournalInput {
  organizationId: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string;
  currency?: string;
  worldScope?: 'business' | 'personal';
  actorUserId?: string | null;
  entryPrefix?: string;
  lines: BalancedJournalLineInput[];
}

/**
 * Resolves the organization's authoritative base currency (§8 Multi-currency).
 */
export async function resolveOrgCurrency(
  sb: SupabaseClient,
  organizationId: string,
): Promise<string> {
  try {
    const { data } = await sb
      .from('organizations')
      .select('currency')
      .eq('id', organizationId)
      .maybeSingle();
    if (data?.currency) return String(data.currency).toUpperCase();
  } catch {
    // fallback below
  }
  return 'USD';
}

/**
 * Resolves a fallback GL account id for an organization by type/subtype/name hint.
 */
export async function resolveGlAccountId(
  sb: SupabaseClient,
  organizationId: string,
  preferredType: 'asset' | 'liability' | 'equity' | 'income' | 'expense',
  hints: string[] = [],
): Promise<string> {
  const { data: accounts } = await sb
    .from('accounts')
    .select('id, name, type, subtype')
    .eq('organization_id', organizationId)
    .eq('is_active', true);

  const list = accounts || [];
  const lowerHints = hints.map((h) => h.toLowerCase());

  for (const hint of lowerHints) {
    const exactSub = list.find(
      (a: any) =>
        a.type === preferredType &&
        (String(a.subtype || '').toLowerCase() === hint ||
          String(a.name || '').toLowerCase().includes(hint)),
    );
    if (exactSub?.id) return String(exactSub.id);
  }

  const byType = list.find((a: any) => a.type === preferredType);
  if (byType?.id) return String(byType.id);

  return list[0]?.id ? String(list[0].id) : `acc-${organizationId}-${preferredType}`;
}

/**
 * Posts a multi-line balanced double-entry journal entry (§7, §8, §15, §33).
 *
 * Hard invariants enforced:
 *  - Idempotent on (organization_id, source_type, source_id)
 *  - No negative debits/credits and no line with both debit > 0 and credit > 0
 *  - SUM(debit) === SUM(credit) within 0.01 rounding tolerance
 */
export async function postBalancedJournalEntry(
  sb: SupabaseClient,
  input: PostBalancedJournalInput,
): Promise<LedgerPostingResult> {
  try {
    const activeLines = input.lines
      .map((l) => ({
        ...l,
        debit: Math.round(Number(l.debit || 0) * 100) / 100,
        credit: Math.round(Number(l.credit || 0) * 100) / 100,
      }))
      .filter((l) => l.debit > 0 || l.credit > 0);

    if (activeLines.length < 2) {
      return { success: false, error: 'Balanced journal entry requires at least two non-zero lines' };
    }

    for (const line of activeLines) {
      if (line.debit < 0 || line.credit < 0) {
        return { success: false, error: 'Journal line debit/credit cannot be negative' };
      }
      if (line.debit > 0 && line.credit > 0) {
        return { success: false, error: 'Journal line cannot have both debit and credit amounts' };
      }
    }

    const totalDebit = Math.round(activeLines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const totalCredit = Math.round(activeLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    if (Math.abs(totalDebit - totalCredit) >= 0.01) {
      return {
        success: false,
        error: `Unbalanced journal entry: total debit (${totalDebit}) !== total credit (${totalCredit})`,
      };
    }

    // Closed fiscal period guard (§8, §23 F-06, §33 #5)
    const effectiveEntryDate = input.entryDate || new Date().toISOString().slice(0, 10);
    const periodCheck = await assertFiscalPeriodOpen(sb, input.organizationId, effectiveEntryDate);
    if (!periodCheck.open) {
      return { success: false, error: periodCheck.error };
    }

    // Idempotency check (§33 #7)
    const { data: existingJe } = await sb
      .from('journal_entries')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('source_type', input.sourceType)
      .eq('source_id', input.sourceId)
      .maybeSingle();

    if (existingJe?.id) {
      return { success: true, journalEntryId: String(existingJe.id) };
    }

    const currency = input.currency || (await resolveOrgCurrency(sb, input.organizationId));
    const journalEntryId = `je-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prefix = input.entryPrefix || 'JE';
    const dateCompact = (input.entryDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const entryNumber = `${prefix}-${dateCompact}-${journalEntryId.slice(-4).toUpperCase()}`;

    const { error: jeErr } = await sb.from('journal_entries').insert({
      id: journalEntryId,
      organization_id: input.organizationId,
      entry_number: entryNumber,
      entry_date: input.entryDate || new Date().toISOString().slice(0, 10),
      description: input.description,
      source_type: input.sourceType,
      source_id: input.sourceId,
      world_scope: input.worldScope || 'business',
      status: 'posted',
      created_by: input.actorUserId || null,
      posted_at: new Date().toISOString(),
    });

    if (jeErr && !jeErr.message.includes('does not exist')) {
      return { success: false, error: jeErr.message };
    }

    const dbLines = activeLines.map((l) => ({
      journal_entry_id: journalEntryId,
      organization_id: input.organizationId,
      account_id: l.accountId,
      bank_account_id: l.bankAccountId || null,
      department_id: l.departmentId || null,
      project_id: l.projectId || null,
      description: l.description || input.description,
      debit: l.debit,
      credit: l.credit,
      currency,
      base_debit: l.debit,
      base_credit: l.credit,
    }));

    const { error: lineErr } = await sb.from('journal_lines').insert(dbLines);
    if (lineErr && !lineErr.message.includes('does not exist')) {
      console.error('[ledgerService] postBalancedJournalEntry lines failed, rolling back header:', lineErr.message);
      await sb.from('journal_entries').delete().eq('id', journalEntryId).eq('organization_id', input.organizationId);
      return { success: false, error: `Journal lines insert failed: ${lineErr.message}` };
    }

    return { success: true, journalEntryId };
  } catch (err: any) {
    console.error('[ledgerService] postBalancedJournalEntry exception:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

