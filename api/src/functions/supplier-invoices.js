const { app } = require('@azure/functions');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');
const { advanceBabcockOnPayment } = require('../babcock-cascade');

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

// ── Allocations table feature-detect ─────────────────────────────────────────
// The Function App may deploy before Mateusz runs the migration in Azure Query
// Editor. Until SupplierInvoicePOAllocations exists everything degrades to the
// legacy single-po_id behaviour. Cached after the first positive check.
let _allocTableKnown = false;
let _cnColKnown = false;
async function cnColExists() {
    if (_cnColKnown) return true;
    try {
        const r = await query(
            `SELECT 1 AS ok FROM sys.columns
              WHERE object_id = OBJECT_ID('SupplierInvoices') AND name = 'credits_invoice_id'`);
        if (r.recordset.length) { _cnColKnown = true; return true; }
    } catch (e) { /* treat as missing */ }
    return false;
}
async function allocTableExists() {
    if (_allocTableKnown) return true;
    try {
        const r = await query(
            `SELECT 1 AS ok FROM sys.tables WHERE name = 'SupplierInvoicePOAllocations'`);
        if (r.recordset.length) { _allocTableKnown = true; return true; }
    } catch (e) { /* treat as missing */ }
    return false;
}

// ── PO net value (total_value is GROSS on PurchaseOrders) ───────────────────
// Mirrors _poNet() in shared.js: gross − vat_amount, else strip vat_rate,
// else assume the figure is already net (legacy rows with no VAT info).
function poNet(po) {
    const gross = Number(po.total_value || 0);
    if (po.vat_amount != null && Number(po.vat_amount) > 0)
        return Math.round((gross - Number(po.vat_amount)) * 100) / 100;
    if (po.vat_rate != null && Number(po.vat_rate) > 0)
        return Math.round((gross / (1 + Number(po.vat_rate) / 100)) * 100) / 100;
    return gross;
}

// ── Replace an invoice's allocations with a single full-value one ───────────
// poId null ⇒ just clear (unmatch). Returns the set of POs whose totals moved.
async function setSingleAllocation(invoiceId, poId, createdBy) {
    const affected = new Set();
    if (!(await allocTableExists())) return affected;
    const old = await query(
        'SELECT po_id FROM SupplierInvoicePOAllocations WHERE invoice_id = @id', { id: invoiceId });
    old.recordset.forEach(r => affected.add(r.po_id));
    await query('DELETE FROM SupplierInvoicePOAllocations WHERE invoice_id = @id', { id: invoiceId });
    if (poId) {
        const inv = await query(
            'SELECT net, vat, gross FROM SupplierInvoices WHERE id = @id', { id: invoiceId });
        const i = inv.recordset[0] || {};
        await query(
            `INSERT INTO SupplierInvoicePOAllocations (invoice_id, po_id, net, vat, gross, created_by)
             VALUES (@invId, @poId, @net, @vat, @gross, @by)`,
            { invId: invoiceId, poId, net: i.net, vat: i.vat, gross: Number(i.gross || 0), by: createdBy || null });
        affected.add(poId);
    }
    return affected;
}

// ── Recompute PO reconciliation from the SUM of its allocated invoices ──────
// Source of truth: SupplierInvoicePOAllocations (falls back to si.po_id until
// the migration runs). Comparison is NET-to-NET: allocated net vs PO net
// (total_value − vat_amount). Keeps the legacy aggregate columns on
// PurchaseOrders in sync:
//   supplier_invoice_gross/net/vat = SUM of allocated shares
//   supplier_invoice_received_at   = earliest linked created_at (or NULL)
//   reconciliation_status: matched (within £1) | unmatched (under) | discrepancy (over)
async function recomputePoReconciliation(poId) {
    if (!poId) return;
    const poRes = await query(
        'SELECT id, total_value, vat_amount, vat_rate, status FROM PurchaseOrders WHERE id = @id', { id: poId });
    if (!poRes.recordset.length) return;
    const po = poRes.recordset[0];

    const useAlloc = await allocTableExists();
    const agg = useAlloc
        ? await query(
            `SELECT COUNT(*) AS cnt,
                    SUM(a.gross) AS sum_gross, SUM(a.net) AS sum_net, SUM(a.vat) AS sum_vat,
                    MIN(si.created_at) AS first_at,
                    MAX(si.invoice_ref) AS any_ref, MAX(si.invoice_date) AS last_date
               FROM SupplierInvoicePOAllocations a
               JOIN SupplierInvoices si ON si.id = a.invoice_id AND si.is_deleted = 0
              WHERE a.po_id = @poId`,
            { poId })
        : await query(
            `SELECT COUNT(*) AS cnt,
                    SUM(gross) AS sum_gross, SUM(net) AS sum_net, SUM(vat) AS sum_vat,
                    MIN(created_at) AS first_at,
                    MAX(invoice_ref) AS any_ref, MAX(invoice_date) AS last_date
             FROM SupplierInvoices WHERE po_id = @poId AND is_deleted = 0`,
            { poId });
    const a = agg.recordset[0];
    const cnt = Number(a.cnt || 0);
    const sumGross = Number(a.sum_gross || 0);
    const sumNet = a.sum_net != null ? Number(a.sum_net) : null;
    const poTotal = Number(po.total_value || 0);
    const poNetVal = poNet(po);

    // Net-to-net when we have invoice nets; gross fallback for legacy rows
    // saved without a net figure.
    const compareLhs = sumNet != null ? sumNet : sumGross;
    const compareRhs = sumNet != null ? poNetVal : poTotal;

    let recon = 'unmatched';
    if (cnt > 0 && compareRhs > 0) {
        if (Math.abs(compareLhs - compareRhs) <= 1.00) recon = 'matched';
        else if (compareLhs > compareRhs + 1.00)       recon = 'discrepancy';
        else                                            recon = 'unmatched'; // partial — more invoices expected
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
           s.is_subcontractor, s.is_labour_supplier,
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
            const useAlloc = await allocTableExists();
            // Attach allocations: [{po_id, po_reference, job_number, net, vat, gross}]
            // to every returned invoice so the UI can show multi-PO splits.
            const attachAllocations = async (rows) => {
                if (!useAlloc || !rows.length) return rows;
                const invIds = rows.map(r => r.id).join(',');
                const ar = await query(
                    `SELECT a.invoice_id, a.po_id, a.net, a.vat, a.gross,
                            po.reference AS po_reference, po.job_number
                       FROM SupplierInvoicePOAllocations a
                       JOIN PurchaseOrders po ON po.id = a.po_id
                      WHERE a.invoice_id IN (${invIds})
                      ORDER BY a.id`);
                const byInv = {};
                for (const al of ar.recordset) {
                    (byInv[al.invoice_id] = byInv[al.invoice_id] || []).push({
                        po_id: al.po_id, po_reference: al.po_reference, job_number: al.job_number,
                        net: al.net != null ? Number(al.net) : null,
                        vat: al.vat != null ? Number(al.vat) : null,
                        gross: Number(al.gross || 0)
                    });
                }
                for (const row of rows) row.allocations = byInv[row.id] || [];
                return rows;
            };

            const id = request.params.id;
            if (id) {
                const r = await query(LIST_SELECT + ' AND si.id = @id', { id: parseInt(id) });
                if (!r.recordset.length) return notFound('Invoice not found', request);
                await attachAllocations(r.recordset);
                return ok(r.recordset[0], request);
            }
            const params = {};
            let where = '';
            const sp = new URL(request.url).searchParams;
            if (sp.get('supplier_id')) { where += ' AND si.supplier_id = @sid'; params.sid = parseInt(sp.get('supplier_id')); }
            if (sp.get('po_id')) {
                params.pid = parseInt(sp.get('po_id'));
                where += useAlloc
                    ? ' AND (si.po_id = @pid OR EXISTS (SELECT 1 FROM SupplierInvoicePOAllocations ax WHERE ax.invoice_id = si.id AND ax.po_id = @pid))'
                    : ' AND si.po_id = @pid';
            }
            if (sp.get('unmatched')) {
                where += useAlloc
                    ? ' AND si.po_id IS NULL AND NOT EXISTS (SELECT 1 FROM SupplierInvoicePOAllocations ax WHERE ax.invoice_id = si.id)'
                    : ' AND si.po_id IS NULL';
            }
            if (sp.get('status') === 'unpaid') where += ' AND si.paid_at IS NULL';
            if (sp.get('status') === 'paid')   where += ' AND si.paid_at IS NOT NULL';
            const r = await query(LIST_SELECT + where + ' ORDER BY si.invoice_date DESC, si.id DESC', params);
            await attachAllocations(r.recordset);
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

            // Optional multi-PO split: allocations: [{po_id, net?, vat?, gross}]
            // When present it wins over po_id; po_id is then set to the first
            // allocation's PO (denormalised "primary PO" for legacy views).
            const allocations = Array.isArray(body.allocations)
                ? body.allocations
                    .map(a => ({
                        po_id: parseInt(a.po_id),
                        net:   a.net   != null && a.net   !== '' ? Number(a.net)   : null,
                        vat:   a.vat   != null && a.vat   !== '' ? Number(a.vat)   : null,
                        gross: a.gross != null && a.gross !== '' ? Number(a.gross) : null
                    }))
                    .filter(a => a.po_id && (a.net != null || a.gross != null))
                : null;

            let poId = body.po_id ? parseInt(body.po_id) : null;
            if (allocations && allocations.length) poId = allocations[0].po_id;

            const poIdsToCheck = allocations && allocations.length
                ? [...new Set(allocations.map(a => a.po_id))]
                : (poId ? [poId] : []);
            for (const pid of poIdsToCheck) {
                const poRes = await query('SELECT id, supplier_id FROM PurchaseOrders WHERE id = @id', { id: pid });
                if (!poRes.recordset.length) return notFound(`PO ${pid} not found`, request);
                if (poRes.recordset[0].supplier_id !== supplierId)
                    return badRequest('PO belongs to a different supplier', request);
            }

            const onAccount = !!supplier.payment_on_account;
            const computed = computeDueDate(supplier, body.invoice_date || null);
            // Manual due-date override wins (e.g. subcontractor "pay me on the 5th")
            const due_date = body.due_date !== undefined && body.due_date !== null && body.due_date !== ''
                ? String(body.due_date).slice(0, 10) : computed.due_date;
            const is_dd = computed.is_dd;
            const createdBy = auth.email || auth.name || null;

            const invoiceType = body.invoice_type === 'subcontractor' ? 'subcontractor' : 'supplier';

            // Credit note link: negative-amount rows may reference the invoice
            // they credit. Validated to the same supplier; silently dropped if
            // the migration hasn't been run yet.
            let creditsInvoiceId = null;
            if (body.credits_invoice_id && await cnColExists()) {
                const orig = await query(
                    'SELECT id, supplier_id FROM SupplierInvoices WHERE id = @id AND is_deleted = 0',
                    { id: parseInt(body.credits_invoice_id) });
                if (orig.recordset.length && orig.recordset[0].supplier_id === supplierId)
                    creditsInvoiceId = orig.recordset[0].id;
            }

            const cnCol = creditsInvoiceId != null;
            const ins = await query(
                `INSERT INTO SupplierInvoices
                    (supplier_id, po_id, babcock_quote_id, invoice_ref, invoice_date,
                     net, vat, gross, due_date, is_dd,
                     invoice_type, labour_gross, cis_rate, cis_deduction,
                     paid_at, paid_by, paid_ref,
                     sharepoint_file_id, sharepoint_file_url, filename, notes, source, created_by${cnCol ? ', credits_invoice_id' : ''})
                 OUTPUT INSERTED.id
                 VALUES (@supplierId, @poId, @babcockId, @ref, @invDate,
                         @net, @vat, @gross, @dueDate, @isDd,
                         @invoiceType, @labourGross, @cisRate, @cisDeduction,
                         @paidAt, @paidBy, @paidRef,
                         @spId, @spUrl, @filename, @notes, @source, @createdBy${cnCol ? ', @creditsInvoiceId' : ''})`,
                {
                    supplierId, poId,
                    babcockId: body.babcock_quote_id ? parseInt(body.babcock_quote_id) : null,
                    ref:      body.invoice_ref || null,
                    invDate:  body.invoice_date || null,
                    net:      body.net != null ? Number(body.net) : null,
                    vat:      body.vat != null ? Number(body.vat) : null,
                    gross,
                    dueDate:  onAccount ? null : due_date,
                    isDd:     is_dd,
                    paidAt:   onAccount ? ((body.invoice_date || new Date().toISOString().slice(0, 10)) + 'T12:00:00') : null,
                    paidBy:   onAccount ? 'auto (on account)' : null,
                    paidRef:  onAccount ? 'On account' : null,
                    invoiceType,
                    labourGross:  body.labour_gross != null ? Number(body.labour_gross) : null,
                    cisRate:      body.cis_rate != null && body.cis_rate !== '' ? Number(body.cis_rate) : null,
                    cisDeduction: body.cis_deduction != null ? Number(body.cis_deduction) : null,
                    spId:     body.sharepoint_file_id || null,
                    spUrl:    body.sharepoint_file_url || null,
                    filename: body.filename || null,
                    notes:    body.notes || null,
                    source:   body.source === 'manual' ? 'manual' : 'parsed',
                    createdBy,
                    ...(cnCol ? { creditsInvoiceId } : {})
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

            // Mirror the PO link(s) into the allocations table (source of truth)
            if (await allocTableExists()) {
                if (allocations && allocations.length) {
                    // Pro-rata VAT/gross for rows given as net-only, using the
                    // invoice's own net:vat ratio — deterministic, no AI maths.
                    const invNet = body.net != null ? Number(body.net) : null;
                    const invVat = body.vat != null ? Number(body.vat) : 0;
                    for (const al of allocations) {
                        let { net, vat, gross: g } = al;
                        if (net != null && g == null) {
                            const ratio = invNet && invNet !== 0 ? net / invNet : 0;
                            vat = vat != null ? vat : Math.round(invVat * ratio * 100) / 100;
                            g = Math.round((net + vat) * 100) / 100;
                        } else if (g != null && net == null) {
                            net = null; // gross-only allocation — net unknown
                        }
                        await query(
                            `INSERT INTO SupplierInvoicePOAllocations (invoice_id, po_id, net, vat, gross, created_by)
                             VALUES (@invId, @poId, @net, @vat, @gross, @by)`,
                            { invId: newId, poId: al.po_id, net, vat, gross: g ?? 0, by: createdBy });
                    }
                } else if (poId) {
                    await setSingleAllocation(newId, poId, createdBy);
                }
            }

            for (const pid of poIdsToCheck) await recomputePoReconciliation(pid);

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
            if (body.credits_invoice_id !== undefined && await cnColExists())
                set('credits_invoice_id', 'creditsid', body.credits_invoice_id ? parseInt(body.credits_invoice_id) : null);

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

            if (await allocTableExists()) {
                const curAlloc = await query(
                    'SELECT id, po_id FROM SupplierInvoicePOAllocations WHERE invoice_id = @id', { id });
                curAlloc.recordset.forEach(a => affectedPos.add(a.po_id));

                if (body.po_id !== undefined) {
                    // Explicit PO change from the edit form ⇒ collapse to a single
                    // full-value allocation on the new PO (or none when unmatched).
                    const newPo = body.po_id ? parseInt(body.po_id) : null;
                    (await setSingleAllocation(id, newPo, auth.email || auth.name || null))
                        .forEach(p => affectedPos.add(p));
                } else if (curAlloc.recordset.length === 1 &&
                           ['net', 'vat', 'gross'].some(c => body[c] !== undefined)) {
                    // Amounts edited on a plain single-PO invoice ⇒ keep the one
                    // allocation covering the full invoice. Multi-PO splits are
                    // deliberate manual figures — never silently rescale those.
                    const fresh = await query(
                        'SELECT net, vat, gross FROM SupplierInvoices WHERE id = @id', { id });
                    const f = fresh.recordset[0];
                    await query(
                        `UPDATE SupplierInvoicePOAllocations
                            SET net = @net, vat = @vat, gross = @gross, updated_at = GETUTCDATE()
                          WHERE invoice_id = @id`,
                        { id, net: f.net, vat: f.vat, gross: Number(f.gross || 0) });
                }
            }

            for (const pid of affectedPos) await recomputePoReconciliation(pid);

            // ── Babcock cascade (Bama SW paid) ── paid_at just went NULL→value on
            // a Babcock-linked, non-credit invoice ⇒ advance the tracker
            // 'Payment Received' → 'Paid to Bama SW'. Strict + one-way + non-fatal.
            let babcock = null;
            if (body.paid_at && !inv.paid_at && Number(inv.gross || 0) >= 0) {
                const bqId = body.babcock_quote_id !== undefined
                    ? (body.babcock_quote_id ? parseInt(body.babcock_quote_id) : null)
                    : inv.babcock_quote_id;
                if (bqId) {
                    try {
                        babcock = await advanceBabcockOnPayment('bamasw', bqId, body.paid_at);
                    } catch (e) {
                        context.error('Babcock cascade failed (non-fatal):', e);
                    }
                }
            }

            const r = await query(LIST_SELECT + ' AND si.id = @id', { id });
            return ok({ ...r.recordset[0], babcock }, request);
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

            const affected = new Set();
            if (cur.recordset[0].po_id) affected.add(cur.recordset[0].po_id);
            if (await allocTableExists()) {
                const al = await query(
                    'SELECT po_id FROM SupplierInvoicePOAllocations WHERE invoice_id = @id', { id });
                al.recordset.forEach(a => affected.add(a.po_id));
            }

            await query('UPDATE SupplierInvoices SET is_deleted = 1, updated_at = GETUTCDATE() WHERE id = @id', { id });
            // Allocations stay in place (the reconciliation JOIN filters deleted
            // invoices out) so an undelete would restore the split intact.
            for (const pid of affected) await recomputePoReconciliation(pid);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('supplier-invoices delete failed:', err);
            return serverError('Failed to delete supplier invoice: ' + err.message, request);
        }
    }
});

// ── POST /api/supplier-invoices-match — link invoices ↔ POs ─────────────────
// TWO MODES:
//
// A) Many invoices → one PO (or unlink):
//    { invoice_ids: [..], po_id: int|null, babcock_quote_id?, force? }
//    Each invoice gets a single full-value allocation on that PO.
//
// B) One invoice split across many POs (consolidated supplier billing):
//    { invoice_id: int, allocations: [{po_id, net}], force? }
//    VAT/gross shares are derived pro-rata from the invoice's own net:vat
//    ratio — deterministic, never invented.
//
// Guards (both modes, compared NET-to-NET, £1 tolerance) return
// { needs_confirm:true, warnings:[{kind, ...}] } WITHOUT saving; the client
// re-posts with force:true after bamaConfirm:
//   kind:'po_over'       — a PO's allocated net would exceed its order net
//   kind:'sum_mismatch'  — (mode B) the splits don't add up to the invoice net
app.http('supplier-invoices-match', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'supplier-invoices-match',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const createdBy = auth.email || auth.name || null;
            const useAlloc = await allocTableExists();
            const r2 = v => Math.round(Number(v) * 100) / 100;

            // Existing allocated net+gross on a PO, excluding the given invoices
            const poMatchedSoFar = async (poId, excludeIds) => {
                const notIn = excludeIds.length ? ` AND a.invoice_id NOT IN (${excludeIds.join(',')})` : '';
                if (useAlloc) {
                    const r = await query(
                        `SELECT ISNULL(SUM(a.net),0) AS n, ISNULL(SUM(a.gross),0) AS g, COUNT(*) AS c
                           FROM SupplierInvoicePOAllocations a
                           JOIN SupplierInvoices si ON si.id = a.invoice_id AND si.is_deleted = 0
                          WHERE a.po_id = @poId${notIn}`, { poId });
                    return r.recordset[0];
                }
                const legacyNotIn = excludeIds.length ? ` AND id NOT IN (${excludeIds.join(',')})` : '';
                const r = await query(
                    `SELECT ISNULL(SUM(net),0) AS n, ISNULL(SUM(gross),0) AS g, COUNT(*) AS c
                       FROM SupplierInvoices WHERE po_id = @poId AND is_deleted = 0${legacyNotIn}`, { poId });
                return r.recordset[0];
            };

            // ═══ MODE B — split one invoice across several POs ═══
            if (body.invoice_id && Array.isArray(body.allocations)) {
                if (!useAlloc)
                    return badRequest('Splitting an invoice across POs needs the SupplierInvoicePOAllocations migration — run create-supplier-invoice-po-allocations.sql first', request);

                const invId = parseInt(body.invoice_id);
                const invRes = await query(
                    `SELECT id, supplier_id, po_id, net, vat, gross, invoice_ref FROM SupplierInvoices
                      WHERE id = @id AND is_deleted = 0`, { id: invId });
                if (!invRes.recordset.length) return notFound('Invoice not found', request);
                const inv = invRes.recordset[0];

                const splits = body.allocations
                    .map(a => ({ po_id: parseInt(a.po_id), net: r2(a.net) }))
                    .filter(a => a.po_id && Number.isFinite(a.net) && a.net !== 0);
                if (!splits.length) return badRequest('allocations is empty', request);
                if (new Set(splits.map(s => s.po_id)).size !== splits.length)
                    return badRequest('Duplicate PO in allocations', request);

                const poIds = splits.map(s => s.po_id);
                const poRes = await query(
                    `SELECT id, supplier_id, reference, total_value, vat_amount, vat_rate
                       FROM PurchaseOrders WHERE id IN (${poIds.join(',')})`);
                if (poRes.recordset.length !== poIds.length) return notFound('One or more POs not found', request);
                const poById = Object.fromEntries(poRes.recordset.map(p => [p.id, p]));
                if (poRes.recordset.some(p => p.supplier_id !== inv.supplier_id))
                    return badRequest('All POs must belong to the same supplier as the invoice', request);

                // ── Guards (net-to-net, £1 tolerance) ──
                const warnings = [];
                const invNet = inv.net != null ? Number(inv.net) : null;
                const sumNet = r2(splits.reduce((s, a) => s + a.net, 0));
                if (invNet != null && Math.abs(sumNet - invNet) > 1.00) {
                    warnings.push({
                        kind: 'sum_mismatch',
                        invoice_ref: inv.invoice_ref,
                        invoice_net: r2(invNet),
                        allocated_net: sumNet,
                        diff: r2(sumNet - invNet)
                    });
                }
                for (const s of splits) {
                    const po = poById[s.po_id];
                    const poNetVal = poNet(po);
                    const already = await poMatchedSoFar(s.po_id, [invId]);
                    const wouldBe = r2(Number(already.n) + s.net);
                    if (poNetVal > 0 && wouldBe > poNetVal + 1.00) {
                        warnings.push({
                            kind: 'po_over',
                            po_reference: po.reference,
                            po_net: poNetVal,
                            matched_net: wouldBe,
                            over_by: r2(wouldBe - poNetVal)
                        });
                    }
                }
                if (warnings.length && !body.force)
                    return ok({ needs_confirm: true, warnings }, request);

                // ── Write: replace this invoice's allocations with the split ──
                const oldAlloc = await query(
                    'SELECT po_id FROM SupplierInvoicePOAllocations WHERE invoice_id = @id', { id: invId });
                const affected = new Set(oldAlloc.recordset.map(a => a.po_id));
                if (inv.po_id) affected.add(inv.po_id);
                await query('DELETE FROM SupplierInvoicePOAllocations WHERE invoice_id = @id', { id: invId });

                const invVat = inv.vat != null ? Number(inv.vat) : 0;
                for (const s of splits) {
                    const ratio = invNet ? s.net / invNet : 0;
                    const vat = r2(invVat * ratio);
                    await query(
                        `INSERT INTO SupplierInvoicePOAllocations (invoice_id, po_id, net, vat, gross, created_by)
                         VALUES (@invId, @poId, @net, @vat, @gross, @by)`,
                        { invId, poId: s.po_id, net: s.net, vat, gross: r2(s.net + vat), by: createdBy });
                    affected.add(s.po_id);
                }
                await query(
                    'UPDATE SupplierInvoices SET po_id = @poId, updated_at = GETUTCDATE() WHERE id = @id',
                    { id: invId, poId: splits[0].po_id });

                for (const pid of affected) await recomputePoReconciliation(pid);

                const out = await query(LIST_SELECT + ' AND si.id = @id', { id: invId });
                return ok({ matched: true, invoices: out.recordset }, request);
            }

            // ═══ MODE A — link ticked invoices to one PO (or unlink) ═══
            const ids = Array.isArray(body.invoice_ids) ? body.invoice_ids.map(Number).filter(Boolean) : [];
            if (!ids.length) return badRequest('invoice_ids is required', request);
            const poId = body.po_id ? parseInt(body.po_id) : null;
            const babcockId = body.babcock_quote_id !== undefined
                ? (body.babcock_quote_id ? parseInt(body.babcock_quote_id) : null)
                : undefined;

            const idList = ids.join(',');
            const invRes = await query(
                `SELECT id, supplier_id, po_id, net, gross FROM SupplierInvoices
                  WHERE id IN (${idList}) AND is_deleted = 0`);
            const invoices = invRes.recordset;
            if (invoices.length !== ids.length) return notFound('One or more invoices not found', request);

            const oldPoIds = new Set(invoices.map(i => i.po_id).filter(Boolean));
            if (useAlloc) {
                const oldAl = await query(
                    `SELECT DISTINCT po_id FROM SupplierInvoicePOAllocations WHERE invoice_id IN (${idList})`);
                oldAl.recordset.forEach(a => oldPoIds.add(a.po_id));
            }

            if (poId) {
                const poRes = await query(
                    `SELECT id, supplier_id, reference, total_value, vat_amount, vat_rate
                       FROM PurchaseOrders WHERE id = @id`, { id: poId });
                if (!poRes.recordset.length) return notFound('PO not found', request);
                const po = poRes.recordset[0];

                if (invoices.some(i => i.supplier_id !== po.supplier_id))
                    return badRequest('All invoices must belong to the same supplier as the PO', request);

                // Over-match check — NET when every invoice has one, else gross
                // fallback (legacy rows saved without a net figure).
                const allHaveNet = invoices.every(i => i.net != null);
                const already = await poMatchedSoFar(poId, ids);
                const incoming = invoices.reduce(
                    (s, i) => s + Number((allHaveNet ? i.net : i.gross) || 0), 0);
                const matchedTotal = r2(Number(allHaveNet ? already.n : already.g) + incoming);
                const poCompare = allHaveNet ? poNet(po) : Number(po.total_value || 0);

                if (poCompare > 0 && matchedTotal > poCompare + 1.00 && !body.force) {
                    return ok({
                        needs_confirm: true,
                        basis: allHaveNet ? 'net' : 'gross',
                        po_reference: po.reference,
                        po_total: poCompare,
                        matched_total: matchedTotal,
                        over_by: r2(matchedTotal - poCompare),
                        invoice_count: Number(already.c) + invoices.length,
                        warnings: [{
                            kind: 'po_over', po_reference: po.reference,
                            po_net: poCompare, matched_net: matchedTotal,
                            over_by: r2(matchedTotal - poCompare)
                        }]
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
            for (const inv of invoices) await setSingleAllocation(inv.id, poId, createdBy);

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

            // ── Babcock cascade (Bama SW paid) ────────────────────────────
            // Any Babcock-linked invoice in this run ⇒ advance the tracker
            // 'Payment Received' → 'Paid to Bama SW'. Credit notes (gross < 0)
            // never advance. Strict + one-way + non-fatal — see
            // api/src/babcock-cascade.js.
            const babcock = [];
            try {
                const bqInvs = await query(
                    `SELECT id, babcock_quote_id, gross FROM SupplierInvoices
                      WHERE id IN (${idList}) AND babcock_quote_id IS NOT NULL`);
                for (const row of bqInvs.recordset) {
                    if (Number(row.gross || 0) < 0) continue;
                    const r = await advanceBabcockOnPayment('bamasw', row.babcock_quote_id, body.run_date);
                    if (r) babcock.push(r);
                }
            } catch (e) {
                context.error('Babcock cascade failed (non-fatal):', e);
            }

            const invoices = await query(LIST_SELECT + ` AND si.id IN (${idList})`);
            return created({ run, invoices: invoices.recordset, babcock }, request);
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
