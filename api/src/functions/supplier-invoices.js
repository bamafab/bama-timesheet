const { app } = require('@azure/functions');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIER INVOICES LEDGER
//
// Many invoices per PO / standalone / optional Babcock quote link.
// Due dates computed from Suppliers payment terms (NULL for direct debit).
// PO legacy aggregate columns (supplier_invoice_gross etc.) are kept in sync
// so older views keep working.
// ═══════════════════════════════════════════════════════════════════════════

// ── Due date from supplier terms ─────────────────────────────────────────────
// Returns { due_date: 'YYYY-MM-DD'|null, is_dd: 0|1 }
function computeDueDate(supplier, invoiceDateStr) {
    if (!supplier) return { due_date: null, is_dd: 0 };
    if (supplier.payment_dd) return { due_date: null, is_dd: 1 };
    if (!invoiceDateStr) return { due_date: null, is_dd: 0 };

    const d = new Date(invoiceDateStr + 'T12:00:00Z');
    if (isNaN(d)) return { due_date: null, is_dd: 0 };
    const days = Number.isFinite(Number(supplier.payment_term_days))
        ? Number(supplier.payment_term_days) : 30;

    const iso = dt => dt.toISOString().slice(0, 10);
    const eom = (year, monthIdx) => new Date(Date.UTC(year, monthIdx + 1, 0, 12)); // last day of month

    switch (supplier.payment_term_type) {
        case 'days_from_invoice': {
            const due = new Date(d); due.setUTCDate(due.getUTCDate() + days);
            return { due_date: iso(due), is_dd: 0 };
        }
        case 'days_eom': {
            const e = eom(d.getUTCFullYear(), d.getUTCMonth());
            e.setUTCDate(e.getUTCDate() + days);
            return { due_date: iso(e), is_dd: 0 };
        }
        case 'days_following_month': {
            // Day N of the month following the invoice month, clamped to month end
            const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
            const m = (d.getUTCMonth() + 1) % 12;
            const lastDay = eom(y, m).getUTCDate();
            const due = new Date(Date.UTC(y, m, Math.min(days, lastDay), 12));
            return { due_date: iso(due), is_dd: 0 };
        }
        default:
            return { due_date: null, is_dd: 0 };
    }
}

async function getSupplier(id) {
    const r = await query('SELECT * FROM Suppliers WHERE id = @id', { id });
    return r.recordset[0] || null;
}

// ── Recompute PO reconciliation from the SUM of its linked invoices ─────────
// Keeps the legacy aggregate columns on PurchaseOrders in sync:
//   supplier_invoice_gross/net/vat = SUM of linked ledger rows
//   supplier_invoice_received_at   = earliest linked created_at (or NULL)
//   reconciliation_status: matched (within £1) | unmatched (under) | discrepancy (over)
async function recomputePoReconciliation(poId) {
    if (!poId) return;
    const poRes = await query('SELECT id, total_value, status FROM PurchaseOrders WHERE id = @id', { id: poId });
    if (!poRes.recordset.length) return;
    const po = poRes.recordset[0];

    const agg = await query(
        `SELECT COUNT(*) AS cnt,
                SUM(gross) AS sum_gross, SUM(net) AS sum_net, SUM(vat) AS sum_vat,
                MIN(created_at) AS first_at,
                MAX(invoice_ref) AS any_ref, MAX(invoice_date) AS last_date
         FROM SupplierInvoices WHERE po_id = @poId AND is_deleted = 0`,
        { poId }
    );
    const a = agg.recordset[0];
    const cnt = Number(a.cnt || 0);
    const sumGross = Number(a.sum_gross || 0);
    const poTotal = Number(po.total_value || 0);

    let recon = 'unmatched';
    if (cnt > 0 && poTotal > 0) {
        if (Math.abs(sumGross - poTotal) <= 1.00) recon = 'matched';
        else if (sumGross > poTotal + 1.00)       recon = 'discrepancy';
        else                                       recon = 'unmatched'; // partial — more invoices expected
    }

    const statusUpdate = (cnt > 0 && !['Closed', 'Cancelled'].includes(po.status)) ? 'Invoiced' : po.status;

    await query(
        `UPDATE PurchaseOrders SET
            supplier_invoice_gross       = ${cnt > 0 ? '@g' : 'NULL'},
            supplier_invoice_net         = ${cnt > 0 ? '@n' : 'NULL'},
            supplier_invoice_vat         = ${cnt > 0 ? '@v' : 'NULL'},
            supplier_invoice_received_at = ${cnt > 0 ? '@firstAt' : 'NULL'},
            supplier_invoice_ref         = ${cnt > 0 ? '@ref' : 'NULL'},
            supplier_invoice_date        = ${cnt > 0 ? '@lastDate' : 'NULL'},
            reconciliation_status        = ${cnt > 0 ? '@recon' : "'unmatched'"},
            status                       = @status,
            updated_at                   = GETUTCDATE()
         WHERE id = @id`,
        {
            id: poId,
            g: sumGross, n: a.sum_net, v: a.sum_vat,
            firstAt: a.first_at, ref: a.any_ref, lastDate: a.last_date,
            recon, status: statusUpdate
        }
    );
}

const LIST_SELECT = `
    SELECT si.*,
           s.supplier_name, s.payment_term_type, s.payment_term_days, s.payment_dd,
           po.reference AS po_reference, po.total_value AS po_total_value,
           po.job_number, po.cost_centre,
           p.project_number, p.project_name,
           bq.quote_ref AS babcock_quote_ref,
           pr.run_ref, pr.run_date
      FROM SupplierInvoices si
      JOIN Suppliers s        ON s.id  = si.supplier_id
 LEFT JOIN PurchaseOrders po  ON po.id = si.po_id
 LEFT JOIN Projects p         ON p.id  = po.project_id
 LEFT JOIN BabcockQuotes bq   ON bq.id = si.babcock_quote_id
 LEFT JOIN SupplierPaymentRuns pr ON pr.id = si.payment_run_id
     WHERE si.is_deleted = 0`;

// ── GET /api/supplier-invoices  (?supplier_id=&po_id=&status=unpaid|paid&unmatched=1)
// ── GET /api/supplier-invoices/{id}
app.http('supplier-invoices-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'supplier-invoices/{id?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = request.params.id;
            if (id) {
                const r = await query(LIST_SELECT + ' AND si.id = @id', { id: parseInt(id) });
                if (!r.recordset.length) return notFound('Invoice not found', request);
                return ok(r.recordset[0], request);
            }
            const params = {};
            let where = '';
            const sp = new URL(request.url).searchParams;
            if (sp.get('supplier_id')) { where += ' AND si.supplier_id = @sid'; params.sid = parseInt(sp.get('supplier_id')); }
            if (sp.get('po_id'))       { where += ' AND si.po_id = @pid';       params.pid = parseInt(sp.get('po_id')); }
            if (sp.get('unmatched'))   { where += ' AND si.po_id IS NULL'; }
            if (sp.get('status') === 'unpaid') where += ' AND si.paid_at IS NULL';
            if (sp.get('status') === 'paid')   where += ' AND si.paid_at IS NOT NULL';
            const r = await query(LIST_SELECT + where + ' ORDER BY si.invoice_date DESC, si.id DESC', params);
            return ok(r.recordset, request);
        } catch (err) {
            context.error('supplier-invoices list failed:', err);
            return serverError('Failed to list supplier invoices: ' + err.message, request);
        }
    }
});

// ── POST /api/supplier-invoices — create (parsed upload or manual entry)
// Body: { supplier_id, po_id?, babcock_quote_id?, invoice_ref?, invoice_date?,
//         net?, vat?, gross, sharepoint_file_id?, sharepoint_file_url?,
//         filename?, notes?, source? }
// Server computes due_date/is_dd from supplier terms; creates POAttachments
// row when a file + po_id are present; recomputes PO reconciliation.
app.http('supplier-invoices-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'supplier-invoices',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const supplierId = parseInt(body.supplier_id);
            const gross = Number(body.gross);
            if (!supplierId) return badRequest('supplier_id is required', request);
            if (!Number.isFinite(gross) || gross === 0) return badRequest('gross is required', request);

            const supplier = await getSupplier(supplierId);
            if (!supplier) return notFound('Supplier not found', request);

            const poId = body.po_id ? parseInt(body.po_id) : null;
            if (poId) {
                const poRes = await query('SELECT id, supplier_id FROM PurchaseOrders WHERE id = @id', { id: poId });
                if (!poRes.recordset.length) return notFound('PO not found', request);
                if (poRes.recordset[0].supplier_id !== supplierId)
                    return badRequest('PO belongs to a different supplier', request);
            }

            const computed = computeDueDate(supplier, body.invoice_date || null);
            // Manual due-date override wins (e.g. subcontractor "pay me on the 5th")
            const due_date = body.due_date !== undefined && body.due_date !== null && body.due_date !== ''
                ? String(body.due_date).slice(0, 10) : computed.due_date;
            const is_dd = computed.is_dd;
            const createdBy = auth.email || auth.name || null;

            const invoiceType = body.invoice_type === 'subcontractor' ? 'subcontractor' : 'supplier';

            const ins = await query(
                `INSERT INTO SupplierInvoices
                    (supplier_id, po_id, babcock_quote_id, invoice_ref, invoice_date,
                     net, vat, gross, due_date, is_dd,
                     invoice_type, labour_gross, cis_rate, cis_deduction,
                     sharepoint_file_id, sharepoint_file_url, filename, notes, source, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@supplierId, @poId, @babcockId, @ref, @invDate,
                         @net, @vat, @gross, @dueDate, @isDd,
                         @invoiceType, @labourGross, @cisRate, @cisDeduction,
                         @spId, @spUrl, @filename, @notes, @source, @createdBy)`,
                {
                    supplierId, poId,
                    babcockId: body.babcock_quote_id ? parseInt(body.babcock_quote_id) : null,
                    ref:      body.invoice_ref || null,
                    invDate:  body.invoice_date || null,
                    net:      body.net != null ? Number(body.net) : null,
                    vat:      body.vat != null ? Number(body.vat) : null,
                    gross,
                    dueDate:  due_date,
                    isDd:     is_dd,
                    invoiceType,
                    labourGross:  body.labour_gross != null ? Number(body.labour_gross) : null,
                    cisRate:      body.cis_rate != null && body.cis_rate !== '' ? Number(body.cis_rate) : null,
                    cisDeduction: body.cis_deduction != null ? Number(body.cis_deduction) : null,
                    spId:     body.sharepoint_file_id || null,
                    spUrl:    body.sharepoint_file_url || null,
                    filename: body.filename || null,
                    notes:    body.notes || null,
                    source:   body.source === 'manual' ? 'manual' : 'parsed',
                    createdBy
                }
            );
            const newId = ins.recordset[0].id;

            // Mirror the file into POAttachments when linked to a PO (legacy views)
            if (poId && body.sharepoint_file_id) {
                await query(
                    `INSERT INTO POAttachments (po_id, kind, filename, sharepoint_file_id, sharepoint_file_url, uploaded_by)
                     VALUES (@poId, 'supplier_invoice', @filename, @spId, @spUrl, @by)`,
                    { poId, filename: body.filename || 'supplier-invoice.pdf',
                      spId: body.sharepoint_file_id, spUrl: body.sharepoint_file_url || null, by: createdBy }
                );
            }

            if (poId) await recomputePoReconciliation(poId);

            const r = await query(LIST_SELECT + ' AND si.id = @id', { id: newId });
            return created(r.recordset[0], request);
        } catch (err) {
            context.error('supplier-invoices create failed:', err);
            return serverError('Failed to create supplier invoice: ' + err.message, request);
        }
    }
});

// ── PUT /api/supplier-invoices/{id} — edit fields / mark paid / unpay
app.http('supplier-invoices-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'supplier-invoices/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const cur = await query('SELECT * FROM SupplierInvoices WHERE id = @id AND is_deleted = 0', { id });
            if (!cur.recordset.length) return notFound('Invoice not found', request);
            const inv = cur.recordset[0];

            const fields = [];
            const params = { id };
            const set = (col, key, val) => { fields.push(`${col} = @${key}`); params[key] = val; };

            for (const col of ['invoice_ref', 'notes', 'paid_ref', 'paid_by',
                               'sharepoint_file_id', 'sharepoint_file_url', 'filename']) {
                if (body[col] !== undefined) set(col, col.replace(/_/g, ''), body[col] || null);
            }
            for (const col of ['net', 'vat', 'gross', 'labour_gross', 'cis_rate', 'cis_deduction']) {
                if (body[col] !== undefined) set(col, col.replace(/_/g, ''), body[col] != null && body[col] !== '' ? Number(body[col]) : null);
            }
            if (body.invoice_type !== undefined)
                set('invoice_type', 'invtype', body.invoice_type === 'subcontractor' ? 'subcontractor' : 'supplier');
            if (body.supplier_id !== undefined && parseInt(body.supplier_id))
                set('supplier_id', 'newsupid', parseInt(body.supplier_id));
            if (body.po_id !== undefined)
                set('po_id', 'newpoid', body.po_id ? parseInt(body.po_id) : null);
            if (body.invoice_date !== undefined) set('invoice_date', 'invdate', body.invoice_date || null);
            if (body.paid_at !== undefined) set('paid_at', 'paidat', body.paid_at || null);
            if (body.payment_run_id !== undefined) set('payment_run_id', 'runid', body.payment_run_id || null);
            if (body.babcock_quote_id !== undefined) set('babcock_quote_id', 'bqid', body.babcock_quote_id || null);
            if (body.due_date !== undefined) set('due_date', 'duedate', body.due_date || null); // manual override

            // Re-derive due date when the invoice date changed and no manual override supplied
            if (body.invoice_date !== undefined && body.due_date === undefined) {
                const supplier = await getSupplier(inv.supplier_id);
                const { due_date, is_dd } = computeDueDate(supplier, body.invoice_date || null);
                set('due_date', 'duedate2', due_date);
                set('is_dd', 'isdd2', is_dd);
            }

            if (!fields.length) return badRequest('No fields to update', request);
            fields.push('updated_at = GETUTCDATE()');
            await query(`UPDATE SupplierInvoices SET ${fields.join(', ')} WHERE id = @id`, params);

            const affectedPos = new Set();
            if (inv.po_id) affectedPos.add(inv.po_id);
            if (body.po_id !== undefined && body.po_id) affectedPos.add(parseInt(body.po_id));
            for (const pid of affectedPos) await recomputePoReconciliation(pid);

            const r = await query(LIST_SELECT + ' AND si.id = @id', { id });
            return ok(r.recordset[0], request);
        } catch (err) {
            context.error('supplier-invoices update failed:', err);
            return serverError('Failed to update supplier invoice: ' + err.message, request);
        }
    }
});

// ── DELETE /api/supplier-invoices/{id} — soft delete + PO recompute
app.http('supplier-invoices-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'supplier-invoices/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const cur = await query('SELECT po_id FROM SupplierInvoices WHERE id = @id AND is_deleted = 0', { id });
            if (!cur.recordset.length) return notFound('Invoice not found', request);
            await query('UPDATE SupplierInvoices SET is_deleted = 1, updated_at = GETUTCDATE() WHERE id = @id', { id });
            if (cur.recordset[0].po_id) await recomputePoReconciliation(cur.recordset[0].po_id);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('supplier-invoices delete failed:', err);
            return serverError('Failed to delete supplier invoice: ' + err.message, request);
        }
    }
});

// ── POST /api/supplier-invoices-match — link ticked invoices to a PO (or unlink)
// Body: { invoice_ids: [..], po_id: int|null, babcock_quote_id?: int|null, force?: bool }
// Over-match guard: if the resulting matched total would exceed the PO total by
// more than £1, returns { needs_confirm:true, po_total, matched_total, over_by }
// WITHOUT saving. Client re-posts with force:true after bamaConfirm.
app.http('supplier-invoices-match', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'supplier-invoices-match',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const ids = Array.isArray(body.invoice_ids) ? body.invoice_ids.map(Number).filter(Boolean) : [];
            if (!ids.length) return badRequest('invoice_ids is required', request);
            const poId = body.po_id ? parseInt(body.po_id) : null;
            const babcockId = body.babcock_quote_id !== undefined
                ? (body.babcock_quote_id ? parseInt(body.babcock_quote_id) : null)
                : undefined;

            const idList = ids.join(',');
            const invRes = await query(
                `SELECT id, supplier_id, po_id, gross FROM SupplierInvoices
                  WHERE id IN (${idList}) AND is_deleted = 0`);
            const invoices = invRes.recordset;
            if (invoices.length !== ids.length) return notFound('One or more invoices not found', request);

            const oldPoIds = [...new Set(invoices.map(i => i.po_id).filter(Boolean))];

            if (poId) {
                const poRes = await query(
                    'SELECT id, supplier_id, reference, total_value FROM PurchaseOrders WHERE id = @id', { id: poId });
                if (!poRes.recordset.length) return notFound('PO not found', request);
                const po = poRes.recordset[0];

                if (invoices.some(i => i.supplier_id !== po.supplier_id))
                    return badRequest('All invoices must belong to the same supplier as the PO', request);

                // Over-match check: existing matched (excluding the ones being moved) + new
                const existing = await query(
                    `SELECT ISNULL(SUM(gross),0) AS s FROM SupplierInvoices
                      WHERE po_id = @poId AND is_deleted = 0 AND id NOT IN (${idList})`,
                    { poId });
                const matchedTotal = Number(existing.recordset[0].s)
                                   + invoices.reduce((s, i) => s + Number(i.gross || 0), 0);
                const poTotal = Number(po.total_value || 0);

                if (poTotal > 0 && matchedTotal > poTotal + 1.00 && !body.force) {
                    return ok({
                        needs_confirm: true,
                        po_reference: po.reference,
                        po_total: poTotal,
                        matched_total: +matchedTotal.toFixed(2),
                        over_by: +(matchedTotal - poTotal).toFixed(2),
                        invoice_count: (await query(
                            `SELECT COUNT(*) AS c FROM SupplierInvoices
                              WHERE po_id = @poId AND is_deleted = 0 AND id NOT IN (${idList})`,
                            { poId })).recordset[0].c + invoices.length
                    }, request);
                }
            }

            await query(
                `UPDATE SupplierInvoices SET
                    po_id = @poId,
                    ${babcockId !== undefined ? 'babcock_quote_id = @bqId,' : ''}
                    updated_at = GETUTCDATE()
                 WHERE id IN (${idList})`,
                { poId, ...(babcockId !== undefined ? { bqId: babcockId } : {}) }
            );

            for (const affected of new Set([poId, ...oldPoIds].filter(Boolean)))
                await recomputePoReconciliation(affected);

            const r = await query(LIST_SELECT + ` AND si.id IN (${idList})`);
            return ok({ matched: true, invoices: r.recordset }, request);
        } catch (err) {
            context.error('supplier-invoices match failed:', err);
            return serverError('Failed to match invoices: ' + err.message, request);
        }
    }
});

// ── GET /api/supplier-payment-runs — list runs (with invoice rollup)
app.http('supplier-payment-runs-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'supplier-payment-runs',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const runs = await query('SELECT * FROM SupplierPaymentRuns ORDER BY run_date DESC, id DESC');
            return ok(runs.recordset, request);
        } catch (err) {
            context.error('payment-runs list failed:', err);
            return serverError('Failed to list payment runs: ' + err.message, request);
        }
    }
});

// ── POST /api/supplier-payment-runs — create a BACS run & mark invoices paid
// Body: { run_date, method?, run_ref?, period_from?, period_to?, notes?, invoice_ids: [..] }
app.http('supplier-payment-runs-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'supplier-payment-runs',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const ids = Array.isArray(body.invoice_ids) ? body.invoice_ids.map(Number).filter(Boolean) : [];
            if (!ids.length) return badRequest('invoice_ids is required', request);
            if (!body.run_date) return badRequest('run_date is required', request);
            const idList = ids.join(',');

            const invRes = await query(
                `SELECT id, gross, paid_at FROM SupplierInvoices WHERE id IN (${idList}) AND is_deleted = 0`);
            if (invRes.recordset.length !== ids.length)
                return notFound('One or more invoices not found', request);
            const alreadyPaid = invRes.recordset.filter(i => i.paid_at);
            if (alreadyPaid.length)
                return badRequest(`${alreadyPaid.length} invoice(s) already paid — deselect them first`, request);

            const total = +invRes.recordset.reduce((s, i) => s + Number(i.gross || 0), 0).toFixed(2);
            const createdBy = auth.email || auth.name || null;

            const runIns = await query(
                `INSERT INTO SupplierPaymentRuns
                    (run_ref, run_date, method, period_from, period_to, invoice_count, total_gross, notes, created_by)
                 OUTPUT INSERTED.*
                 VALUES (@ref, @runDate, @method, @from, @to, @cnt, @total, @notes, @by)`,
                {
                    ref:     body.run_ref || null,
                    runDate: body.run_date,
                    method:  body.method || 'BACS',
                    from:    body.period_from || null,
                    to:      body.period_to || null,
                    cnt:     ids.length,
                    total,
                    notes:   body.notes || null,
                    by:      createdBy
                }
            );
            const run = runIns.recordset[0];

            await query(
                `UPDATE SupplierInvoices SET
                    paid_at = @paidAt, paid_by = @by,
                    paid_ref = @paidRef, payment_run_id = @runId,
                    updated_at = GETUTCDATE()
                 WHERE id IN (${idList})`,
                {
                    paidAt: body.run_date + 'T12:00:00',
                    by: createdBy,
                    paidRef: [body.method || 'BACS', body.run_ref].filter(Boolean).join(' · '),
                    runId: run.id
                }
            );

            const invoices = await query(LIST_SELECT + ` AND si.id IN (${idList})`);
            return created({ run, invoices: invoices.recordset }, request);
        } catch (err) {
            context.error('payment-run create failed:', err);
            return serverError('Failed to create payment run: ' + err.message, request);
        }
    }
});

// ── CORS preflight ──────────────────────────────────────────────────────────
app.http('supplier-invoices-options', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'supplier-invoices/{*rest}',
    handler: async (request) => preflight(request)
});
app.http('supplier-invoices-match-options', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'supplier-invoices-match',
    handler: async (request) => preflight(request)
});
app.http('supplier-payment-runs-options', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'supplier-payment-runs',
    handler: async (request) => preflight(request)
});

// ── POST /api/supplier-invoices-recompute-due — re-derive due dates after a
// terms change. Body: { supplier_id }. Touches unpaid, non-deleted invoices.
app.http('supplier-invoices-recompute-due', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'supplier-invoices-recompute-due',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const supplierId = parseInt(body.supplier_id);
            if (!supplierId) return badRequest('supplier_id is required', request);
            const supplier = await getSupplier(supplierId);
            if (!supplier) return notFound('Supplier not found', request);

            const invs = await query(
                `SELECT id, invoice_date FROM SupplierInvoices
                  WHERE supplier_id = @sid AND is_deleted = 0 AND paid_at IS NULL`,
                { sid: supplierId });

            let updated = 0;
            for (const inv of invs.recordset) {
                const dateStr = inv.invoice_date ? new Date(inv.invoice_date).toISOString().slice(0, 10) : null;
                const { due_date, is_dd } = computeDueDate(supplier, dateStr);
                await query(
                    `UPDATE SupplierInvoices SET due_date = @due, is_dd = @dd, updated_at = GETUTCDATE() WHERE id = @id`,
                    { id: inv.id, due: due_date, dd: is_dd });
                updated++;
            }
            return ok({ updated }, request);
        } catch (err) {
            context.error('recompute-due failed:', err);
            return serverError('Failed to recompute due dates: ' + err.message, request);
        }
    }
});
app.http('supplier-invoices-recompute-due-options', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'supplier-invoices-recompute-due',
    handler: async (request) => preflight(request)
});
