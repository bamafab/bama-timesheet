// Purchase Orders API — Phase 1a
//
// CRUD for PurchaseOrders + nested POLineItems and POAttachments.
// Reference allocation is P{YY}{MM}{NN}, resets monthly, allocated server-side.
//
// Status state machine (UI summary; truth lives in flag/timestamp columns):
//   Open      → just raised (may or may not be approved/sent yet)
//   Received  → delivery_received_at set
//   Closed    → paid_at set
//   Cancelled → cancelled_at set (manual abort)
//
// Phase 1b will add: /approve (generate + upload PDFs), /send (email supplier),
// /receive, /invoice, /pay. For now these flag/timestamp columns are exposed
// via the generic PUT endpoint so the UI can already write them; the dedicated
// action endpoints will follow.

const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ── Reference allocation ────────────────────────────────────────────────────
// Format: P{YY}{MM}{NN} (monthly reset). Sequence padded to 2 digits.
// Example: P260501 (May 2026, first PO of the month).

function formatPORef(year2, month2, seq) {
    const yy = String(year2).padStart(2, '0');
    const mm = String(month2).padStart(2, '0');
    const nn = String(seq).padStart(2, '0');
    return `P${yy}${mm}${nn}`;
}

// Parse "P260501" → { year2: 26, month2: 5, seq: 1 } | null on garbage
function parsePORef(ref) {
    if (!ref) return null;
    const m = String(ref).match(/^P(\d{2})(\d{2})(\d{2})$/);
    if (!m) return null;
    return { year2: parseInt(m[1], 10), month2: parseInt(m[2], 10), seq: parseInt(m[3], 10) };
}

async function nextReferenceForMonth(year2, month2) {
    const yymm = String(year2).padStart(2, '0') + String(month2).padStart(2, '0');
    const prefix = `P${yymm}`;
    const result = await query(
        `SELECT reference FROM PurchaseOrders WHERE reference LIKE @pattern`,
        { pattern: prefix + '%' }
    );
    let maxSeq = 0;
    for (const row of result.recordset) {
        const parsed = parsePORef(row.reference);
        if (parsed && parsed.year2 === year2 && parsed.month2 === month2 && parsed.seq > maxSeq) {
            maxSeq = parsed.seq;
        }
    }
    return formatPORef(year2, month2, maxSeq + 1);
}

// ── Validation helpers ──────────────────────────────────────────────────────

const ALLOWED_STATUSES = ['Open', 'Received', 'Invoiced', 'Closed', 'Cancelled'];
const ALLOWED_ATTACHMENT_KINDS = ['delivery_note', 'supplier_invoice', 'other'];

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

// Re-compute total_value (Gross) + vat_amount from line items if any exist;
// otherwise leave total_value as provided. Returns the resolved figures
// or { gross: fallbackGross, vat_amount: null } if nothing to compute.
//
// Calculation: Nett  = sum(line_total) + delivery_charge + collection_charge
//              VAT   = round(Nett × vat_rate / 100, 2)
//              Gross = Nett + VAT
async function recomputeTotal(poId, fallbackGross) {
    const lines = await query(
        `SELECT SUM(line_total) AS t FROM POLineItems WHERE po_id = @poId`,
        { poId }
    );
    const subtotal = lines.recordset[0]?.t;
    if (subtotal === null || subtotal === undefined) {
        return { gross: fallbackGross, vat_amount: null };
    }
    // Pull current charges + rate so we don't drop them on partial updates
    const meta = await query(
        `SELECT delivery_charge, collection_charge, vat_rate
           FROM PurchaseOrders WHERE id = @id`,
        { id: poId }
    );
    const row = meta.recordset[0] || {};
    const dc = Number(row.delivery_charge   || 0);
    const cc = Number(row.collection_charge || 0);
    const vr = Number(row.vat_rate !== null && row.vat_rate !== undefined ? row.vat_rate : 20);
    const nett  = Number(subtotal) + dc + cc;
    const vat   = Math.round(nett * vr) / 100;            // 2dp
    const gross = Math.round((nett + vat) * 100) / 100;   // 2dp
    return { gross, vat_amount: vat };
}

// Persist line items for a PO (full replace).
async function writeLineItems(poId, items) {
    if (!Array.isArray(items)) return;
    // Delete-then-insert. Simpler than diff-merge for small N.
    await query(`DELETE FROM POLineItems WHERE po_id = @poId`, { poId });
    for (let i = 0; i < items.length; i++) {
        const it = items[i] || {};
        const qty = num(it.quantity);
        const up  = num(it.unit_price);
        let lt    = num(it.line_total);
        if (lt === null && qty !== null && up !== null) {
            lt = Math.round(qty * up * 100) / 100;
        }
        await query(
            `INSERT INTO POLineItems (po_id, description, quantity, unit, unit_price, line_total, sort_order)
             VALUES (@poId, @description, @quantity, @unit, @unit_price, @line_total, @sort_order)`,
            {
                poId,
                description: String(it.description || '').slice(0, 500),
                quantity:   qty,
                unit:       it.unit ? String(it.unit).slice(0, 50) : null,
                unit_price: up,
                line_total: lt,
                sort_order: it.sort_order !== undefined ? parseInt(it.sort_order, 10) : i
            }
        );
    }
}

async function fetchLineItems(poId) {
    const r = await query(
        `SELECT * FROM POLineItems WHERE po_id = @poId ORDER BY sort_order, id`,
        { poId }
    );
    return r.recordset;
}

async function fetchAttachments(poId) {
    const r = await query(
        `SELECT * FROM POAttachments WHERE po_id = @poId ORDER BY uploaded_at DESC`,
        { poId }
    );
    return r.recordset;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

// GET /api/purchase-orders-next-reference?date=YYYY-MM-DD
// Preview the next reference for the given month (defaults to today).
// Separate top-level route so it doesn't collide with /:id.
app.http('purchase-orders-next-ref', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'purchase-orders-next-reference',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const dateStr = request.query.get('date');
            const d = dateStr ? new Date(dateStr) : new Date();
            if (isNaN(d.getTime())) return badRequest('Invalid date', request);
            const yr2 = d.getUTCFullYear() % 100;
            const mo2 = d.getUTCMonth() + 1;
            const ref = await nextReferenceForMonth(yr2, mo2);
            return ok({ reference: ref, year2: yr2, month2: mo2 }, request);
        } catch (err) {
            context.error('PO next-ref error:', err);
            return serverError('Failed to allocate next reference', request);
        }
    }
});

// GET /api/purchase-orders        — list (filters: status, project_id, supplier_id, q)
// GET /api/purchase-orders/:id    — single, with line items + attachments
app.http('purchase-orders-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = request.params.id;

            if (id) {
                const poId = parseInt(id, 10);
                if (isNaN(poId)) return badRequest('Invalid id', request);

                const r = await query(
                    `SELECT po.*, s.supplier_name, s.address_line1 AS supplier_address1,
                            s.address_line2 AS supplier_address2, s.city AS supplier_city,
                            s.county AS supplier_county, s.postcode AS supplier_postcode,
                            s.telephone AS supplier_phone, s.email AS supplier_email,
                            s.contact_name AS supplier_contact,
                            p.project_number, p.project_name, p.client_id
                       FROM PurchaseOrders po
                       JOIN Suppliers s   ON po.supplier_id = s.id
                  LEFT JOIN Projects p    ON po.project_id  = p.id
                      WHERE po.id = @id`,
                    { id: poId }
                );
                if (r.recordset.length === 0) return notFound('Purchase order not found', request);
                const po = r.recordset[0];
                po.line_items  = await fetchLineItems(poId);
                po.attachments = await fetchAttachments(poId);
                return ok(po, request);
            }

            // List with optional filters.
            const status     = request.query.get('status');
            const projectId  = request.query.get('project_id');
            const supplierId = request.query.get('supplier_id');
            const q          = request.query.get('q');

            const where = [];
            const params = {};
            if (status)     { where.push('po.status = @status');           params.status     = status; }
            if (projectId)  { where.push('po.project_id = @projectId');    params.projectId  = parseInt(projectId, 10); }
            if (supplierId) { where.push('po.supplier_id = @supplierId');  params.supplierId = parseInt(supplierId, 10); }
            if (q)          { where.push('(po.reference LIKE @q OR s.supplier_name LIKE @q OR po.description LIKE @q)');
                              params.q = `%${q}%`; }

            const sqlText =
                `SELECT po.id, po.reference, po.supplier_id, po.project_id, po.cost_centre,
                        po.total_value, po.description, po.status,
                        po.job_number, po.delivery_date, po.delivery_address,
                        po.delivery_charge, po.collection_charge,
                        po.approved_at, po.approved_by, po.sent_at, po.sent_by,
                        po.delivery_received_at, po.invoice_received_at,
                        po.invoice_value, po.invoice_ref, po.paid_at,
                        po.cancelled_at, po.sharepoint_pdf_url, po.sharepoint_dn_url,
                        po.supplier_invoice_received_at, po.supplier_invoice_ref,
                        po.supplier_invoice_date, po.supplier_invoice_net,
                        po.supplier_invoice_vat, po.supplier_invoice_gross,
                        po.reconciliation_status, po.reconciliation_notes,
                        po.created_by, po.created_at, po.updated_at,
                        s.supplier_name,
                        p.project_number, p.project_name,
                        pa.sharepoint_file_url AS sharepoint_url
                   FROM PurchaseOrders po
                   JOIN Suppliers s ON po.supplier_id = s.id
              LEFT JOIN Projects p  ON po.project_id  = p.id
              LEFT JOIN POAttachments pa ON pa.po_id = po.id AND pa.kind = 'supplier_invoice'
                                        AND pa.id = (SELECT TOP 1 id FROM POAttachments
                                                     WHERE po_id = po.id AND kind = 'supplier_invoice'
                                                     ORDER BY id DESC)
                  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}\n               ORDER BY po.created_at DESC`;

            const r = await query(sqlText, params);
            return ok(r.recordset, request);
        } catch (err) {
            context.error('PO list error:', err);
            return serverError('Failed to fetch purchase orders', request);
        }
    }
});

// POST /api/purchase-orders
// Body: { reference?, supplier_id, project_id?, cost_centre?, total_value?,
//         vat_rate?, vat_amount?, description?, job_number?, delivery_date?,
//         delivery_address?, delivery_charge?, collection_charge?,
//         line_items?, created_by? }
// If reference is omitted, server allocates next for the current month.
// total_value is the GROSS figure (= Nett + VAT). vat_rate defaults to 20.
// vat_amount can be supplied; otherwise the API leaves it NULL and the
// frontend's computed value (preferred) is stored as part of the same body.
app.http('purchase-orders-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'purchase-orders',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            let {
                reference, supplier_id, project_id, cost_centre,
                total_value, description,
                vat_rate, vat_amount,
                job_number, delivery_date, delivery_address,
                delivery_charge, collection_charge,
                line_items, created_by, status
            } = body;

            // Required fields
            if (!supplier_id) return badRequest('supplier_id is required', request);

            // project_id XOR cost_centre (DB also enforces this)
            const hasProject = project_id !== undefined && project_id !== null && project_id !== '';
            const hasCC      = cost_centre !== undefined && cost_centre !== null && cost_centre !== '';
            if (hasProject && hasCC) {
                return badRequest('Provide exactly one of project_id or cost_centre (got both)', request);
            }
            if (!hasProject && !hasCC) {
                return badRequest('Provide exactly one of project_id or cost_centre (got neither)', request);
            }

            // Allocate ref if not provided (the common path)
            if (!reference) {
                const now = new Date();
                reference = await nextReferenceForMonth(now.getUTCFullYear() % 100, now.getUTCMonth() + 1);
            } else if (!parsePORef(reference)) {
                return badRequest('reference must be in P{YY}{MM}{NN} format', request);
            }

            if (status && !ALLOWED_STATUSES.includes(status)) {
                return badRequest(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`, request);
            }

            // Auto-fill job_number from project_number when project linked & not given
            let resolvedJobNumber = job_number || null;
            if (!resolvedJobNumber && hasProject) {
                const proj = await query(
                    `SELECT project_number FROM Projects WHERE id = @id`,
                    { id: parseInt(project_id, 10) }
                );
                if (proj.recordset[0]) resolvedJobNumber = proj.recordset[0].project_number;
            }

            const insert = await query(
                `INSERT INTO PurchaseOrders
                    (reference, supplier_id, project_id, cost_centre,
                     total_value, vat_rate, vat_amount, description, status,
                     job_number, delivery_date, delivery_address,
                     delivery_charge, collection_charge,
                     created_by,
                     approved_at, approved_by)
                 OUTPUT INSERTED.id
                 VALUES (@reference, @supplier_id, @project_id, @cost_centre,
                         @total_value, @vat_rate, @vat_amount, @description, @status,
                         @job_number, @delivery_date, @delivery_address,
                         @delivery_charge, @collection_charge,
                         @created_by,
                         GETUTCDATE(), @created_by)`,
                {
                    reference,
                    supplier_id: parseInt(supplier_id, 10),
                    project_id:  hasProject ? parseInt(project_id, 10) : null,
                    cost_centre: hasCC ? String(cost_centre).slice(0, 100) : null,
                    total_value: num(total_value),
                    vat_rate:    vat_rate    !== undefined ? num(vat_rate)    : 20.00,
                    vat_amount:  num(vat_amount),
                    description: description || null,
                    status: status || 'Open',
                    job_number: resolvedJobNumber,
                    delivery_date: delivery_date || null,
                    delivery_address: delivery_address || null,
                    delivery_charge: num(delivery_charge),
                    collection_charge: num(collection_charge),
                    created_by: created_by || null
                }
            );

            const newId = insert.recordset[0].id;

            // Persist line items (if any) and recompute Gross + VAT amount.
            // We re-update total_value + vat_amount so they stay in sync with
            // the lines we just wrote, even if the caller sent a stale figure.
            if (Array.isArray(line_items) && line_items.length > 0) {
                await writeLineItems(newId, line_items);
                const computed = await recomputeTotal(newId, num(total_value));
                if (computed.gross !== null && computed.gross !== undefined) {
                    await query(
                        `UPDATE PurchaseOrders
                            SET total_value = @t,
                                vat_amount  = @v,
                                updated_at  = GETUTCDATE()
                          WHERE id = @id`,
                        { id: newId, t: computed.gross, v: computed.vat_amount }
                    );
                }
            }

            // Echo back the full record
            const echo = await query(
                `SELECT po.*, s.supplier_name, p.project_number, p.project_name
                   FROM PurchaseOrders po
                   JOIN Suppliers s ON po.supplier_id = s.id
              LEFT JOIN Projects p  ON po.project_id  = p.id
                  WHERE po.id = @id`,
                { id: newId }
            );
            const out = echo.recordset[0];
            out.line_items  = await fetchLineItems(newId);
            out.attachments = await fetchAttachments(newId);
            return created(out, request);
        } catch (err) {
            context.error('PO create error:', err);
            // Reference uniqueness — return a clean message
            if (err && err.number === 2601) {
                return badRequest('Reference already exists (race) — retry', request);
            }
            return serverError('Failed to create purchase order', request);
        }
    }
});

// PUT /api/purchase-orders/:id
// Partial update — any of the same fields plus the state flags
// (approved_at/by, sent_at/by, delivery_received_at/by,
//  invoice_received_at/value/ref/by, paid_at/by, cancelled_at/by/reason,
//  sharepoint_*).
app.http('purchase-orders-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const poId = parseInt(request.params.id, 10);
            if (isNaN(poId)) return badRequest('Invalid id', request);

            const body = await request.json();

            // Whitelist of updatable columns. Reference + created_by are immutable.
            const stringCols = [
                'description', 'cost_centre', 'status', 'job_number',
                'delivery_address', 'approved_by', 'sent_by',
                'delivery_received_by', 'invoice_received_by',
                'invoice_ref', 'paid_by', 'cancelled_by', 'cancelled_reason',
                'sharepoint_folder_id', 'sharepoint_pdf_id', 'sharepoint_pdf_url',
                'sharepoint_dn_id', 'sharepoint_dn_url'
            ];
            const numericCols = [
                'total_value', 'delivery_charge', 'collection_charge', 'invoice_value',
                'vat_rate', 'vat_amount'
            ];
            const intCols   = ['supplier_id', 'project_id'];
            const dateCols  = ['delivery_date'];
            const tsCols    = [
                'approved_at', 'sent_at', 'delivery_received_at',
                'invoice_received_at', 'paid_at', 'cancelled_at'
            ];

            const updates = [];
            const params  = { id: poId };

            for (const col of stringCols) {
                if (body[col] !== undefined) {
                    updates.push(`${col} = @${col}`);
                    params[col] = body[col] === null ? null : String(body[col]);
                }
            }
            for (const col of numericCols) {
                if (body[col] !== undefined) {
                    updates.push(`${col} = @${col}`);
                    params[col] = num(body[col]);
                }
            }
            for (const col of intCols) {
                if (body[col] !== undefined) {
                    updates.push(`${col} = @${col}`);
                    params[col] = body[col] === null ? null : parseInt(body[col], 10);
                }
            }
            for (const col of dateCols) {
                if (body[col] !== undefined) {
                    updates.push(`${col} = @${col}`);
                    params[col] = body[col] || null;
                }
            }
            for (const col of tsCols) {
                if (body[col] !== undefined) {
                    updates.push(`${col} = @${col}`);
                    params[col] = body[col] || null;
                }
            }

            if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
                return badRequest(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`, request);
            }

            // Line items full-replace if provided
            let replaceLines = false;
            if (Array.isArray(body.line_items)) {
                replaceLines = true;
            }

            if (updates.length === 0 && !replaceLines) {
                return badRequest('No updatable fields provided', request);
            }

            if (updates.length > 0) {
                updates.push('updated_at = GETUTCDATE()');
                await query(
                    `UPDATE PurchaseOrders SET ${updates.join(', ')} WHERE id = @id`,
                    params
                );
            }

            if (replaceLines) {
                await writeLineItems(poId, body.line_items);
                // Recompute total + VAT from lines unless the caller explicitly
                // supplied total_value in the same body (in which case trust them).
                if (body.total_value === undefined) {
                    const computed = await recomputeTotal(poId, null);
                    if (computed.gross !== null && computed.gross !== undefined) {
                        await query(
                            `UPDATE PurchaseOrders
                                SET total_value = @t,
                                    vat_amount  = @v,
                                    updated_at  = GETUTCDATE()
                              WHERE id = @id`,
                            { id: poId, t: computed.gross, v: computed.vat_amount }
                        );
                    }
                }
            }

            // Echo back
            const echo = await query(
                `SELECT po.*, s.supplier_name, p.project_number, p.project_name
                   FROM PurchaseOrders po
                   JOIN Suppliers s ON po.supplier_id = s.id
              LEFT JOIN Projects p  ON po.project_id  = p.id
                  WHERE po.id = @id`,
                { id: poId }
            );
            if (echo.recordset.length === 0) return notFound('Purchase order not found', request);
            const out = echo.recordset[0];
            out.line_items  = await fetchLineItems(poId);
            out.attachments = await fetchAttachments(poId);
            return ok(out, request);
        } catch (err) {
            context.error('PO update error:', err);
            return serverError('Failed to update purchase order', request);
        }
    }
});

// DELETE /api/purchase-orders/:id
// Hard-delete. POLineItems + POAttachments cascade automatically.
// Use sparingly — once a PO has been sent to a supplier the audit trail
// generally matters more than tidying the table. Prefer status='Cancelled'
// via the PUT endpoint for normal aborts.
app.http('purchase-orders-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const poId = parseInt(request.params.id, 10);
            if (isNaN(poId)) return badRequest('Invalid id', request);
            const r = await query(
                `DELETE FROM PurchaseOrders OUTPUT DELETED.id WHERE id = @id`,
                { id: poId }
            );
            if (r.recordset.length === 0) return notFound('Purchase order not found', request);
            return ok({ deleted: true, id: poId }, request);
        } catch (err) {
            context.error('PO delete error:', err);
            return serverError('Failed to delete purchase order', request);
        }
    }
});

// POST /api/purchase-orders/:id/attachments
// Body: { kind, filename, sharepoint_file_id?, sharepoint_file_url?, uploaded_by? }
app.http('purchase-orders-attach', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}/attachments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const poId = parseInt(request.params.id, 10);
            if (isNaN(poId)) return badRequest('Invalid id', request);
            const body = await request.json();
            const { kind, filename, sharepoint_file_id, sharepoint_file_url, uploaded_by } = body;
            if (!ALLOWED_ATTACHMENT_KINDS.includes(kind)) {
                return badRequest(`kind must be one of: ${ALLOWED_ATTACHMENT_KINDS.join(', ')}`, request);
            }
            if (!filename) return badRequest('filename is required', request);

            // Make sure the PO exists
            const exists = await query(`SELECT id FROM PurchaseOrders WHERE id = @id`, { id: poId });
            if (exists.recordset.length === 0) return notFound('Purchase order not found', request);

            const r = await query(
                `INSERT INTO POAttachments (po_id, kind, filename, sharepoint_file_id, sharepoint_file_url, uploaded_by)
                 OUTPUT INSERTED.*
                 VALUES (@po_id, @kind, @filename, @sharepoint_file_id, @sharepoint_file_url, @uploaded_by)`,
                {
                    po_id: poId,
                    kind,
                    filename: String(filename).slice(0, 500),
                    sharepoint_file_id: sharepoint_file_id || null,
                    sharepoint_file_url: sharepoint_file_url || null,
                    uploaded_by: uploaded_by || null
                }
            );
            return created(r.recordset[0], request);
        } catch (err) {
            context.error('PO attach error:', err);
            return serverError('Failed to attach file', request);
        }
    }
});

// DELETE /api/purchase-orders/:id/attachments/:attId
app.http('purchase-orders-detach', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}/attachments/{attId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const poId  = parseInt(request.params.id,    10);
            const attId = parseInt(request.params.attId, 10);
            if (isNaN(poId) || isNaN(attId)) return badRequest('Invalid id', request);
            const r = await query(
                `DELETE FROM POAttachments OUTPUT DELETED.id WHERE id = @attId AND po_id = @poId`,
                { poId, attId }
            );
            if (r.recordset.length === 0) return notFound('Attachment not found', request);
            return ok({ deleted: true, id: attId }, request);
        } catch (err) {
            context.error('PO detach error:', err);
            return serverError('Failed to remove attachment', request);
        }
    }
});

// CORS preflight catch-all for all PO routes
app.http('purchase-orders-options', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{*rest}',
    handler: async (request) => preflight(request)
});
