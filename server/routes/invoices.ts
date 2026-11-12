/**
 * Customer Invoices & Accounts Receivable Router (§4, §7, §15, §29 X-12).
 * Mounted at `/organizations/:organizationId/invoices` (mergeParams).
 */

import { Router, type Request, type Response } from 'express';
import { ok, fail, notFound, created } from '../lib/http.js';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { logAuditEvent } from '../lib/auditLogger.js';

function getOrgId(req: Request): string {
  const p = req.params.organizationId;
  return Array.isArray(p) ? p[0] : (p ?? '');
}

export function createInvoicesRouter(): Router {
  const r = Router({ mergeParams: true });

  // GET / — List invoices with filtering and pagination
  r.get('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const {
      status,
      clientId,
      projectId,
      search,
      page = '1',
      pageSize = '20',
      sortBy = 'issue_date',
      sortOrder = 'desc',
    } = req.query as Record<string, string>;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
    const offset = (p - 1) * limit;

    let query = sb
      .from('invoices')
      .select('*, invoice_lines(*)', { count: 'exact' })
      .eq('organization_id', orgId);

    if (status) query = query.eq('status', status);
    if (clientId) query = query.eq('client_id', clientId);
    if (projectId) query = query.eq('project_id', projectId);
    if (search) {
      query = query.or(`invoice_number.ilike.%${search}%,client_name.ilike.%${search}%`);
    }

    const isAsc = sortOrder.toLowerCase() === 'asc';
    query = query.order(sortBy || 'issue_date', { ascending: isAsc }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) {
      return fail(res, 500, error.message);
    }

    return ok(res, {
      items: data || [],
      total: count || 0,
      page: p,
      pageSize: limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  });

  // GET /stats — Receivables summary
  r.get('/stats', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: invoices, error } = await sb
      .from('invoices')
      .select('total_amount, amount_paid, amount_due, status, due_date')
      .eq('organization_id', orgId);

    if (error) return fail(res, 500, error.message);

    const today = new Date().toISOString().slice(0, 10);
    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalOverdue = 0;
    let overdueCount = 0;

    for (const inv of invoices || []) {
      if (inv.status === 'voided' || inv.status === 'draft') continue;
      const total = Number(inv.total_amount || 0);
      const paid = Number(inv.amount_paid || 0);
      const due = Number(inv.amount_due || 0);

      totalInvoiced += total;
      totalCollected += paid;
      totalOutstanding += due;

      if (due > 0 && inv.due_date < today) {
        totalOverdue += due;
        overdueCount++;
      }
    }

    return ok(res, {
      totalInvoiced,
      totalCollected,
      totalOutstanding,
      totalOverdue,
      overdueCount,
      totalInvoices: invoices?.length || 0,
    });
  });

  // GET /:id — Get invoice with lines, payments and credits
  r.get('/:id', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: invoice, error } = await sb
      .from('invoices')
      .select('*, invoice_lines(*), invoice_payments(*), invoice_credits(*)')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!invoice) return notFound(res, 'Invoice not found');

    return ok(res, invoice);
  });

  // POST / — Create a new customer invoice with line items
  r.post('/', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const {
      invoiceNumber,
      clientId,
      clientName,
      projectId,
      issueDate = new Date().toISOString().slice(0, 10),
      dueDate,
      currency = 'USD',
      paymentTerms = 'Net 30',
      notes,
      lines = [],
    } = req.body || {};

    if (!clientName || !clientName.trim()) {
      return fail(res, 400, 'clientName is required');
    }

    const calculatedDueDate = dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const invId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const finalNumber = invoiceNumber || `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${invId.slice(-4).toUpperCase()}`;

    // Calculate line items and totals
    let subtotal = 0;
    const processedLines = (lines as any[]).map((line, idx) => {
      const qty = Number(line.quantity || 1);
      const price = Number(line.unitPrice || 0);
      const amt = Number(line.amount != null ? line.amount : qty * price);
      subtotal += amt;
      return {
        id: `line-${invId}-${idx + 1}`,
        invoice_id: invId,
        organization_id: orgId,
        description: String(line.description || 'Service'),
        quantity: qty,
        unit_price: price,
        amount: amt,
        service_type: line.serviceType || null,
        sort_order: idx,
      };
    });

    const taxAmount = Number(req.body.taxAmount || 0);
    const totalAmount = subtotal + taxAmount;

    const { error: invErr } = await sb.from('invoices').insert({
      id: invId,
      organization_id: orgId,
      invoice_number: finalNumber,
      client_id: clientId || null,
      client_name: clientName.trim(),
      project_id: projectId || null,
      issue_date: issueDate,
      due_date: calculatedDueDate,
      currency,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      amount_paid: 0.00,
      amount_due: totalAmount,
      status: 'draft',
      payment_terms: paymentTerms,
      notes: notes || null,
      created_by: req.authUser?.id || null,
    });

    if (invErr) {
      return fail(res, 500, `Failed to create invoice: ${invErr.message}`);
    }

    if (processedLines.length > 0) {
      const { error: lineErr } = await sb.from('invoice_lines').insert(processedLines);
      if (lineErr) {
        console.warn('[invoices] Line item insertion warning:', lineErr.message);
      }
    }

    void logAuditEvent(req, {
      action: 'create',
      entity: 'invoice',
      entityId: invId,
      details: { invoiceNumber: finalNumber, clientName, totalAmount, currency },
    });

    return created(res, {
      id: invId,
      invoiceNumber: finalNumber,
      clientName,
      totalAmount,
      currency,
      status: 'draft',
      lines: processedLines,
    });
  });

  // POST /:id/issue — Issue/Send invoice
  r.post('/:id/issue', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: inv, error: fetchErr } = await sb
      .from('invoices')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!inv) return notFound(res, 'Invoice not found');

    const nextStatus = inv.amount_paid > 0 ? (inv.amount_paid >= inv.total_amount ? 'paid' : 'partially_paid') : 'issued';

    const { data: updated, error: updErr } = await sb
      .from('invoices')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (updErr) return fail(res, 500, updErr.message);

    void logAuditEvent(req, {
      action: 'update',
      entity: 'invoice',
      entityId: req.params.id,
      details: { fromStatus: inv.status, toStatus: nextStatus },
    });

    return ok(res, updated, `Invoice issued successfully as '${nextStatus}'`);
  });

  // POST /:id/payments — Record collection payment against invoice (X-12)
  r.post('/:id/payments', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: inv, error: fetchErr } = await sb
      .from('invoices')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchErr) return fail(res, 500, fetchErr.message);
    if (!inv) return notFound(res, 'Invoice not found');
    if (inv.status === 'voided') {
      return fail(res, 400, 'Cannot apply payment to a voided invoice');
    }

    const {
      amount,
      paymentDate = new Date().toISOString().slice(0, 10),
      paymentMethod = 'bank_transfer',
      referenceNumber,
      settlementTransactionId,
      notes,
    } = req.body || {};

    const payAmt = Number(amount);
    if (!Number.isFinite(payAmt) || payAmt <= 0) {
      return fail(res, 400, 'Payment amount must be greater than 0');
    }

    const payId = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { error: payErr } = await sb.from('invoice_payments').insert({
      id: payId,
      invoice_id: inv.id,
      organization_id: orgId,
      payment_date: paymentDate,
      amount: payAmt,
      currency: inv.currency,
      payment_method: paymentMethod,
      reference_number: referenceNumber || null,
      settlement_transaction_id: settlementTransactionId || null,
      notes: notes || null,
      created_by: req.authUser?.id || null,
    });

    if (payErr) return fail(res, 500, payErr.message);

    // Recompute total paid and remaining balance
    const newPaid = Number(inv.amount_paid || 0) + payAmt;
    const newDue = Math.max(0, Number(inv.total_amount || 0) - newPaid);
    const newStatus = newDue <= 0 ? 'paid' : 'partially_paid';

    const { data: updatedInv, error: updErr } = await sb
      .from('invoices')
      .update({
        amount_paid: newPaid,
        amount_due: newDue,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inv.id)
      .select()
      .single();

    if (updErr) return fail(res, 500, updErr.message);

    void logAuditEvent(req, {
      action: 'payment',
      entity: 'invoice',
      entityId: inv.id,
      details: { amount: payAmt, newPaid, newDue, newStatus },
    });

    return created(res, {
      payment: { id: payId, amount: payAmt, paymentDate, referenceNumber },
      invoice: updatedInv,
    }, 'Payment successfully recorded against invoice');
  });

  // POST /:id/void — Void an invoice
  r.post('/:id/void', async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const sb = getSupabaseAdminClient();
    if (!sb) return fail(res, 503, 'Database unavailable');

    const { data: updated, error } = await sb
      .from('invoices')
      .update({ status: 'voided', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) return fail(res, 500, error.message);
    return ok(res, updated, 'Invoice marked as voided');
  });

  return r;
}

