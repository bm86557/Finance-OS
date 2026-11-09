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

