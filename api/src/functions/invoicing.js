// ─────────────────────────────────────────────────────────────────────────────
// invoicing.js — Invoice Tracker API
// ─────────────────────────────────────────────────────────────────────────────
//
// Endpoints (Phase 1, Commit 1 — stubs returning empty arrays / 501 where
// not yet implemented):
//
//   AFPs:
//     GET    /api/applications                — list (filter ?project_id, ?status)
//     GET    /api/applications/:id            — detail + line items
//     POST   /api/applications                — create (Draft)
//     PUT    /api/applications/:id            — update (Draft only)
//     POST   /api/applications/:id/submit     — Draft → Submitted, generate PDF
//     POST   /api/applications/:id/certificate— upload + OCR a payment cert
//     PUT    /api/applications/:id/certificate— confirm certified figures
//     POST   /api/applications/:id/generate-invoice — create Invoice from cert
//     DELETE /api/applications/:id            — cancel
//
//   Invoices:
//     GET    /api/invoices                    — list (filter ?kind, ?status, ?project_id, ?client_id)
//     GET    /api/invoices/:id                — detail + lines + payments
//     POST   /api/invoices                    — create (Draft)
//     PUT    /api/invoices/:id                — update (Draft only)
//     POST   /api/invoices/:id/issue          — Draft → Issued, generate PDF
//     POST   /api/invoices/:id/payments       — record a payment
//     DELETE /api/invoices/:id/payments/:pid  — remove a payment
//     POST   /api/invoices/:id/void           — → Void
//     GET    /api/invoices/next-ref?kind=...  — peek the next ref (UI helper)
//
//   Receipts:
//     GET    /api/receipts                    — list
//     POST   /api/receipts                    — create
//     POST   /api/receipts/parse              — OCR a receipt file (Claude API)
//     PUT    /api/receipts/:id                — update
//     DELETE /api/receipts/:id                — delete
//
//   Supplier invoice attach (PO extension):
//     PUT    /api/purchase-orders/:id/supplier-invoice  — attach + reconcile
//     POST   /api/purchase-orders/:id/supplier-invoice/parse — OCR pre-fill
//
// Commit 2 will fill in invoice + receipt CRUD + PDF generation.
// Commit 3 will fill in AFP lifecycle + certificate OCR.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ─────────────────────────────────────────────────────────────────────────────
// Reference allocators
// ─────────────────────────────────────────────────────────────────────────────

// Pad to 4 digits — INV0258, PRO0258, CN0001
function formatInvoiceRef(prefix, n) {
    return `${prefix}${String(n).padStart(4, '0')}`;
}

// Pad to 2 digits — AFP01, AFP02
function formatAfpRef(n) {
    return `AFP${String(n).padStart(2, '0')}`;
}

// Parse numeric portion of INV0258 / PRO0258 / CN0001
function parseInvoiceRefNumber(ref, prefix) {
    if (!ref) return NaN;
    const re = new RegExp(`^${prefix}(\\d{1,6})$`, 'i');
    const m = String(ref).match(re);
    return m ? parseInt(m[1], 10) : NaN;
}

// Allocate the next INV / PRO / CN reference.
//
// INV and PRO share the same numeric sequence (a pro forma can later convert
// into an invoice using the same number). CN is its own sequence.
async function nextInvoiceRef(kind) {
    let prefix, scanPatterns;
    if (kind === 'credit_note') {
        prefix = 'CN';
        scanPatterns = ['CN%'];
    } else if (kind === 'pro_forma') {
        prefix = 'PRO';
        scanPatterns = ['INV%', 'PRO%']; // share sequence with invoices
    } else {
        prefix = 'INV';
        scanPatterns = ['INV%', 'PRO%']; // share sequence with pro formas
    }

    let maxSeq = 0;
    for (const pat of scanPatterns) {
        const result = await query(
            `SELECT ref FROM Invoices WHERE ref LIKE @pattern`,
            { pattern: pat }
        );
        for (const row of result.recordset) {
            const stripped = row.ref.replace(/^(INV|PRO|CN)/i, '');
            const n = parseInt(stripped, 10);
            if (!isNaN(n) && n > maxSeq) maxSeq = n;
        }
    }
    return formatInvoiceRef(prefix, maxSeq + 1);
}

// Allocate the next AFP ref for a given project.
async function nextAfpRef(projectId) {
    const result = await query(
        `SELECT MAX(application_no) AS max_no FROM Applications WHERE project_id = @pid`,
        { pid: projectId }
    );
    const next = (result.recordset[0]?.max_no || 0) + 1;
    return { application_no: next, ref: formatAfpRef(next) };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS preflight (one wildcard per route prefix)
// ─────────────────────────────────────────────────────────────────────────────

app.http('applications-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'applications/{*path}',
    handler: async (request) => preflight(request)
});

app.http('invoices-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'invoices/{*path}',
    handler: async (request) => preflight(request)
});

app.http('receipts-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'receipts/{*path}',
    handler: async (request) => preflight(request)
});

// ─────────────────────────────────────────────────────────────────────────────
// AFPs — Applications for Payment
// ─────────────────────────────────────────────────────────────────────────────

app.http('applications-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'applications',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = request.query.get('project_id');
            const status = request.query.get('status');
            const includeCancelled = request.query.get('include_cancelled') === 'true';

            let where = [];
            const params = {};
            if (projectId) { where.push('a.project_id = @projectId'); params.projectId = parseInt(projectId); }
            if (status)    { where.push('a.status = @status'); params.status = status; }
            if (!includeCancelled && !status) {
                where.push("a.status <> 'Cancelled'");
            }
            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const result = await query(
                `SELECT a.*, p.project_number, p.project_name, p.client_id,
                        c.company_name AS client_company_name,
                        inv.ref AS invoice_ref
                 FROM Applications a
                 LEFT JOIN Projects p ON a.project_id = p.id
                 LEFT JOIN Clients c  ON p.client_id  = c.id
                 LEFT JOIN Invoices inv ON a.invoice_id = inv.id
                 ${whereClause}
                 ORDER BY a.project_id, a.application_no DESC`,
                params
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error listing AFPs:', err);
            return serverError('Failed to list applications', request);
        }
    }
});

// Allocate the next AFP ref for a project — FLAT route to avoid {id} collision
app.http('applications-next-ref', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'applications-next-ref',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(request.query.get('project_id'));
            if (!projectId) return badRequest('project_id is required', request);
            const { application_no, ref } = await nextAfpRef(projectId);
            return ok({ application_no, ref }, request);
        } catch (err) {
            context.error('Error allocating next AFP ref:', err);
            return serverError('Failed to allocate next AFP ref', request);
        }
    }
});

app.http('applications-detail', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'applications/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const appRes = await query(
                `SELECT a.*, p.project_number, p.project_name, p.client_id,
                        c.company_name AS client_company_name,
                        inv.ref AS invoice_ref, inv.status AS invoice_status
                 FROM Applications a
                 LEFT JOIN Projects p ON a.project_id = p.id
                 LEFT JOIN Clients c  ON p.client_id  = c.id
                 LEFT JOIN Invoices inv ON a.invoice_id = inv.id
                 WHERE a.id = @id`,
                { id }
            );
            if (!appRes.recordset.length) return notFound('Application not found', request);
            const linesRes = await query(
                `SELECT * FROM ApplicationLineItems WHERE application_id = @id ORDER BY line_no`,
                { id }
            );
            // Attachments: certificate metadata
            const attRes = await query(
                `SELECT id, kind, filename, sharepoint_id, sharepoint_url, uploaded_at, uploaded_by
                 FROM InvoiceAttachments
                 WHERE parent_kind IN ('application','application_certificate') AND parent_id = @id
                 ORDER BY uploaded_at DESC`,
                { id }
            );
            return ok({
                ...appRes.recordset[0],
                line_items: linesRes.recordset,
                attachments: attRes.recordset
            }, request);
        } catch (err) {
            context.error('Error fetching AFP:', err);
            return serverError('Failed to fetch application', request);
        }
    }
});

app.http('applications-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            if (!body.project_id) return badRequest('project_id required', request);

            const { application_no, ref } = await nextAfpRef(body.project_id);
            const createdBy = auth.email || auth.name || null;

            const insertRes = await query(
                `INSERT INTO Applications (
                    project_id, application_no, ref, period_label, period_start, period_end,
                    status, is_final,
                    applied_value_net, applied_vat, applied_retention, applied_gross,
                    notes, created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    @projectId, @applicationNo, @ref, @periodLabel, @periodStart, @periodEnd,
                    'Draft', @isFinal,
                    @appliedValueNet, @appliedVat, @appliedRetention, @appliedGross,
                    @notes, @createdBy
                )`,
                {
                    projectId:        body.project_id,
                    applicationNo:    application_no,
                    ref,
                    periodLabel:      body.period_label ?? null,
                    periodStart:      body.period_start ?? null,
                    periodEnd:        body.period_end ?? null,
                    isFinal:          body.is_final ? 1 : 0,
                    appliedValueNet:  Number(body.applied_value_net || 0),
                    appliedVat:       Number(body.applied_vat || 0),
                    appliedRetention: Number(body.applied_retention || 0),
                    appliedGross:     Number(body.applied_gross || 0),
                    notes:            body.notes ?? null,
                    createdBy
                }
            );
            const newApp = insertRes.recordset[0];

            // Line items — required for AFP to be useful
            if (Array.isArray(body.line_items) && body.line_items.length) {
                for (const l of body.line_items) {
                    await query(
                        `INSERT INTO ApplicationLineItems (
                            application_id, line_no, source_quote_line_item_id, description,
                            contract_value, previous_pct_complete, this_app_pct_complete,
                            this_app_value, cumulative_value
                        )
                        VALUES (
                            @applicationId, @lineNo, @sourceQliId, @description,
                            @contractValue, @previousPct, @thisAppPct,
                            @thisAppValue, @cumulativeValue
                        )`,
                        {
                            applicationId: newApp.id,
                            lineNo:        l.line_no,
                            sourceQliId:   l.source_quote_line_item_id ?? null,
                            description:   l.description,
                            contractValue: Number(l.contract_value || 0),
                            previousPct:   Number(l.previous_pct_complete || 0),
                            thisAppPct:    Number(l.this_app_pct_complete || 0),
                            thisAppValue:  Number(l.this_app_value || 0),
                            cumulativeValue: Number(l.cumulative_value || 0)
                        }
                    );
                }
            }

            return created(newApp, request);
        } catch (err) {
            context.error('Error creating AFP:', err);
            return serverError('Failed to create application: ' + err.message, request);
        }
    }
});

app.http('applications-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'applications/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            // Only Draft AFPs can be edited
            const existing = await query('SELECT status FROM Applications WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Application not found', request);
            if (existing.recordset[0].status !== 'Draft') {
                return badRequest('Only Draft AFPs can be edited', request);
            }

            await query(
                `UPDATE Applications SET
                    period_label      = @periodLabel,
                    period_start      = @periodStart,
                    period_end        = @periodEnd,
                    is_final          = @isFinal,
                    applied_value_net = @appliedValueNet,
                    applied_vat       = @appliedVat,
                    applied_retention = @appliedRetention,
                    applied_gross     = @appliedGross,
                    notes             = @notes,
                    updated_at        = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    periodLabel:      body.period_label ?? null,
                    periodStart:      body.period_start ?? null,
                    periodEnd:        body.period_end ?? null,
                    isFinal:          body.is_final ? 1 : 0,
                    appliedValueNet:  Number(body.applied_value_net || 0),
                    appliedVat:       Number(body.applied_vat || 0),
                    appliedRetention: Number(body.applied_retention || 0),
                    appliedGross:     Number(body.applied_gross || 0),
                    notes:            body.notes ?? null
                }
            );

            // Replace line items wholesale
            if (Array.isArray(body.line_items)) {
                await query('DELETE FROM ApplicationLineItems WHERE application_id = @id', { id });
                for (const l of body.line_items) {
                    await query(
                        `INSERT INTO ApplicationLineItems (
                            application_id, line_no, source_quote_line_item_id, description,
                            contract_value, previous_pct_complete, this_app_pct_complete,
                            this_app_value, cumulative_value
                        )
                        VALUES (
                            @applicationId, @lineNo, @sourceQliId, @description,
                            @contractValue, @previousPct, @thisAppPct,
                            @thisAppValue, @cumulativeValue
                        )`,
                        {
                            applicationId: id,
                            lineNo:        l.line_no,
                            sourceQliId:   l.source_quote_line_item_id ?? null,
                            description:   l.description,
                            contractValue: Number(l.contract_value || 0),
                            previousPct:   Number(l.previous_pct_complete || 0),
                            thisAppPct:    Number(l.this_app_pct_complete || 0),
                            thisAppValue:  Number(l.this_app_value || 0),
                            cumulativeValue: Number(l.cumulative_value || 0)
                        }
                    );
                }
            }

            const refetched = await query('SELECT * FROM Applications WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error updating AFP:', err);
            return serverError('Failed to update application: ' + err.message, request);
        }
    }
});

app.http('applications-submit', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/submit',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json().catch(() => ({}));

            const existing = await query('SELECT status FROM Applications WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Application not found', request);
            if (existing.recordset[0].status !== 'Draft') {
                return badRequest(`Cannot submit AFP — current status is ${existing.recordset[0].status}`, request);
            }
            if (!body.sharepoint_pdf_id || !body.sharepoint_pdf_url) {
                return badRequest('sharepoint_pdf_id and sharepoint_pdf_url required (client must upload PDF first)', request);
            }

            await query(
                `UPDATE Applications SET
                    status              = 'Submitted',
                    submitted_at        = GETUTCDATE(),
                    sharepoint_pdf_id   = @pdfId,
                    sharepoint_pdf_url  = @pdfUrl,
                    updated_at          = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    pdfId:  body.sharepoint_pdf_id,
                    pdfUrl: body.sharepoint_pdf_url
                }
            );
            const refetched = await query('SELECT * FROM Applications WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error submitting AFP:', err);
            return serverError('Failed to submit application: ' + err.message, request);
        }
    }
});

// Upload certificate metadata — file uploaded by client to SharePoint first.
// Stores attachment row + parsed OCR figures (not yet confirmed).
app.http('applications-certificate-upload', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/certificate',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const uploadedBy = auth.email || auth.name || null;

            const existing = await query('SELECT status FROM Applications WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Application not found', request);
            if (existing.recordset[0].status !== 'Submitted' && existing.recordset[0].status !== 'Certified') {
                return badRequest(`Certificate can only be attached to Submitted/Certified AFPs (current: ${existing.recordset[0].status})`, request);
            }
            if (!body.sharepoint_id || !body.sharepoint_url) {
                return badRequest('sharepoint_id and sharepoint_url required', request);
            }

            // Insert the attachment
            const attRes = await query(
                `INSERT INTO InvoiceAttachments (parent_kind, parent_id, kind, filename, sharepoint_id, sharepoint_url, uploaded_by)
                 OUTPUT INSERTED.id
                 VALUES ('application_certificate', @parentId, 'certificate', @filename, @sharepointId, @sharepointUrl, @uploadedBy)`,
                {
                    parentId:      id,
                    filename:      body.filename || 'certificate.pdf',
                    sharepointId:  body.sharepoint_id,
                    sharepointUrl: body.sharepoint_url,
                    uploadedBy
                }
            );
            const attId = attRes.recordset[0]?.id;

            // Point Applications.certificate_attachment_id at it
            await query(
                `UPDATE Applications SET
                    certificate_attachment_id = @attId,
                    certificate_received_at   = GETUTCDATE(),
                    updated_at                = GETUTCDATE()
                 WHERE id = @id`,
                { id, attId }
            );

            return ok({ id, attachment_id: attId, sharepoint_url: body.sharepoint_url }, request);
        } catch (err) {
            context.error('Error uploading certificate:', err);
            return serverError('Failed to upload certificate: ' + err.message, request);
        }
    }
});

// Confirm certified figures — sets Applications.certified_* + status=Certified.
// Also writes per-line certified values from body.line_items[].certified_this_app_value
app.http('applications-certificate-confirm', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'applications/{id}/certificate',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            const existing = await query('SELECT status, certificate_attachment_id FROM Applications WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Application not found', request);
            if (!existing.recordset[0].certificate_attachment_id) {
                return badRequest('No certificate uploaded — upload the cert PDF first', request);
            }

            await query(
                `UPDATE Applications SET
                    certified_value_net = @certifiedValueNet,
                    certified_vat       = @certifiedVat,
                    certified_retention = @certifiedRetention,
                    certified_gross     = @certifiedGross,
                    certificate_ref     = @certificateRef,
                    certificate_date    = @certificateDate,
                    status              = 'Certified',
                    certified_at        = GETUTCDATE(),
                    updated_at          = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    certifiedValueNet: body.certified_value_net != null ? Number(body.certified_value_net) : null,
                    certifiedVat:      body.certified_vat       != null ? Number(body.certified_vat)       : null,
                    certifiedRetention:body.certified_retention != null ? Number(body.certified_retention) : null,
                    certifiedGross:    body.certified_gross     != null ? Number(body.certified_gross)     : null,
                    certificateRef:    body.certificate_ref ?? null,
                    certificateDate:   body.certificate_date ?? null
                }
            );

            // Per-line certified values (optional)
            if (Array.isArray(body.line_items)) {
                for (const l of body.line_items) {
                    if (l.id && l.certified_this_app_value != null) {
                        await query(
                            `UPDATE ApplicationLineItems
                             SET certified_this_app_value = @val
                             WHERE id = @lid AND application_id = @aid`,
                            { val: Number(l.certified_this_app_value), lid: l.id, aid: id }
                        );
                    }
                }
            }

            const refetched = await query('SELECT * FROM Applications WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error confirming certificate:', err);
            return serverError('Failed to confirm certificate: ' + err.message, request);
        }
    }
});

// Generate an Invoice from a Certified AFP.
// New Invoice: kind=invoice, status=Draft, ref=auto, source_afp_id=N,
// retention copied from AFP, lines copied from ApplicationLineItems.
app.http('applications-generate-invoice', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/generate-invoice',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const createdBy = auth.email || auth.name || null;

            const appRes = await query(
                `SELECT a.*, p.client_id AS project_client_id
                 FROM Applications a
                 LEFT JOIN Projects p ON a.project_id = p.id
                 WHERE a.id = @id`,
                { id }
            );
            if (!appRes.recordset.length) return notFound('Application not found', request);
            const app2 = appRes.recordset[0];
            if (app2.status !== 'Certified') {
                return badRequest(`AFP must be Certified to generate invoice (current: ${app2.status})`, request);
            }
            if (app2.invoice_id) {
                return badRequest(`AFP already invoiced (invoice id ${app2.invoice_id})`, request);
            }

            const linesRes = await query(
                `SELECT * FROM ApplicationLineItems WHERE application_id = @id ORDER BY line_no`,
                { id }
            );
            const afpLines = linesRes.recordset;

            // Allocate invoice ref
            const invRef = await nextInvoiceRef('invoice');

            // Use certified net if present, otherwise applied net (defensive)
            const netAmount = app2.certified_value_net != null ? Number(app2.certified_value_net)
                            : (app2.applied_value_net != null ? Number(app2.applied_value_net) : 0);
            const vatAmount = app2.certified_vat != null ? Number(app2.certified_vat)
                            : (app2.applied_vat != null ? Number(app2.applied_vat) : 0);
            const retention = app2.certified_retention != null ? Number(app2.certified_retention)
                            : (app2.applied_retention != null ? Number(app2.applied_retention) : 0);
            const grossAmount = app2.certified_gross != null ? Number(app2.certified_gross)
                              : (app2.applied_gross != null ? Number(app2.applied_gross) : 0);

            // Create the Draft Invoice
            const insertRes = await query(
                `INSERT INTO Invoices (
                    ref, kind, source_afp_id, project_id, client_id, customer_text,
                    invoice_date, due_date,
                    vat_applies, cis_reverse_charge,
                    net_amount, vat_amount, reverse_charge_amount,
                    retention_pct, retention_amount, retention_due_date,
                    gross_amount, total_outstanding,
                    status, notes, created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    @ref, 'invoice', @sourceAfpId, @projectId, @clientId, NULL,
                    @invoiceDate, NULL,
                    @vatApplies, 0,
                    @netAmount, @vatAmount, 0,
                    NULL, @retention, NULL,
                    @grossAmount, @grossAmount,
                    'Draft', @notes, @createdBy
                )`,
                {
                    ref:         invRef,
                    sourceAfpId: id,
                    projectId:   app2.project_id,
                    clientId:    app2.project_client_id,
                    invoiceDate: new Date().toISOString().slice(0, 10),
                    vatApplies:  vatAmount > 0 ? 1 : 0,
                    netAmount,
                    vatAmount,
                    retention,
                    grossAmount,
                    notes:       `Generated from AFP ${app2.ref}`,
                    createdBy
                }
            );
            const newInv = insertRes.recordset[0];

            // Copy line items from AFP — use certified_this_app_value if set, else this_app_value
            for (let i = 0; i < afpLines.length; i++) {
                const l = afpLines[i];
                const amount = l.certified_this_app_value != null ? Number(l.certified_this_app_value) : Number(l.this_app_value || 0);
                if (amount === 0) continue; // skip zero-value lines (nothing claimed)
                await query(
                    `INSERT INTO InvoiceLineItems (invoice_id, line_no, description, quantity, unit_price, line_total)
                     VALUES (@invoiceId, @lineNo, @description, 1, @amount, @amount)`,
                    {
                        invoiceId:   newInv.id,
                        lineNo:      i + 1,
                        description: l.description,
                        amount
                    }
                );
            }

            // Update AFP: invoice_id + status=Invoiced
            await query(
                `UPDATE Applications SET
                    invoice_id  = @invoiceId,
                    status      = 'Invoiced',
                    invoiced_at = GETUTCDATE(),
                    updated_at  = GETUTCDATE()
                 WHERE id = @id`,
                { id, invoiceId: newInv.id }
            );

            return created({ invoice: newInv, afp_id: id }, request);
        } catch (err) {
            context.error('Error generating invoice from AFP:', err);
            return serverError('Failed to generate invoice: ' + err.message, request);
        }
    }
});

// Cancel an AFP (soft) — status=Cancelled, application_no burned.
// Replaces the DELETE stub since deletion is not allowed.
app.http('applications-cancel', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/cancel',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const existing = await query('SELECT status FROM Applications WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Application not found', request);
            if (existing.recordset[0].status === 'Invoiced') {
                return badRequest('Cannot cancel an Invoiced AFP — void the linked invoice first', request);
            }
            if (existing.recordset[0].status === 'Cancelled') {
                return badRequest('Already cancelled', request);
            }
            await query(
                `UPDATE Applications SET
                    status       = 'Cancelled',
                    cancelled_at = GETUTCDATE(),
                    updated_at   = GETUTCDATE()
                 WHERE id = @id`,
                { id }
            );
            return ok({ id, status: 'Cancelled' }, request);
        } catch (err) {
            context.error('Error cancelling AFP:', err);
            return serverError('Failed to cancel application: ' + err.message, request);
        }
    }
});

// Keep the DELETE route registered too, but route it to cancel-style behaviour
app.http('applications-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'applications/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const existing = await query('SELECT status FROM Applications WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Application not found', request);
            if (existing.recordset[0].status === 'Invoiced') {
                return badRequest('Cannot cancel an Invoiced AFP', request);
            }
            await query(
                `UPDATE Applications SET
                    status       = 'Cancelled',
                    cancelled_at = GETUTCDATE(),
                    updated_at   = GETUTCDATE()
                 WHERE id = @id`,
                { id }
            );
            return ok({ id, status: 'Cancelled' }, request);
        } catch (err) {
            context.error('Error cancelling AFP:', err);
            return serverError('Failed to cancel application: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────────────────────

app.http('invoices-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'invoices',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const kind = request.query.get('kind');
            const status = request.query.get('status');
            const projectId = request.query.get('project_id');
            const clientId = request.query.get('client_id');

            const where = [];
            const params = {};
            if (kind)      { where.push('i.kind = @kind');       params.kind = kind; }
            if (status)    { where.push('i.status = @status');   params.status = status; }
            if (projectId) { where.push('i.project_id = @pid');  params.pid = parseInt(projectId); }
            if (clientId)  { where.push('i.client_id = @cid');   params.cid = parseInt(clientId); }
            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const result = await query(
                `SELECT i.*,
                        p.project_number, p.project_name,
                        c.company_name AS client_company_name
                 FROM Invoices i
                 LEFT JOIN Projects p ON i.project_id = p.id
                 LEFT JOIN Clients c  ON i.client_id  = c.id
                 ${whereClause}
                 ORDER BY i.invoice_date DESC, i.id DESC`,
                params
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error listing invoices:', err);
            return serverError('Failed to list invoices', request);
        }
    }
});

app.http('invoices-next-ref', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'invoices-next-ref',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const kind = request.query.get('kind') || 'invoice';
            if (!['invoice','pro_forma','credit_note'].includes(kind)) {
                return badRequest('Invalid kind', request);
            }
            const ref = await nextInvoiceRef(kind);
            return ok({ kind, ref }, request);
        } catch (err) {
            context.error('Error allocating next invoice ref:', err);
            return serverError('Failed to allocate next ref', request);
        }
    }
});

app.http('invoices-detail', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'invoices/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const invRes = await query(
                `SELECT i.*,
                        p.project_number, p.project_name,
                        c.company_name AS client_company_name
                 FROM Invoices i
                 LEFT JOIN Projects p ON i.project_id = p.id
                 LEFT JOIN Clients c  ON i.client_id  = c.id
                 WHERE i.id = @id`,
                { id }
            );
            if (!invRes.recordset.length) return notFound('Invoice not found', request);
            const linesRes = await query(
                `SELECT * FROM InvoiceLineItems WHERE invoice_id = @id ORDER BY line_no`,
                { id }
            );
            const paysRes = await query(
                `SELECT * FROM InvoicePayments WHERE invoice_id = @id ORDER BY payment_date`,
                { id }
            );
            return ok({
                ...invRes.recordset[0],
                line_items: linesRes.recordset,
                payments: paysRes.recordset
            }, request);
        } catch (err) {
            context.error('Error fetching invoice:', err);
            return serverError('Failed to fetch invoice', request);
        }
    }
});

app.http('invoices-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const kind = body.kind || 'invoice';
            if (!['invoice','pro_forma','credit_note'].includes(kind)) {
                return badRequest('Invalid kind', request);
            }
            if (!body.invoice_date) return badRequest('invoice_date required', request);

            const ref = await nextInvoiceRef(kind);
            const createdBy = auth.email || auth.name || null;

            const insertRes = await query(
                `INSERT INTO Invoices (
                    ref, kind, source_afp_id, parent_invoice_id, project_id, client_id, customer_text,
                    invoice_date, due_date,
                    vat_applies, cis_reverse_charge,
                    net_amount, vat_amount, reverse_charge_amount,
                    retention_pct, retention_amount, retention_due_date,
                    gross_amount, total_outstanding,
                    status, notes, created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    @ref, @kind, @sourceAfpId, @parentInvoiceId, @projectId, @clientId, @customerText,
                    @invoiceDate, @dueDate,
                    @vatApplies, @cisReverseCharge,
                    @netAmount, @vatAmount, @reverseChargeAmount,
                    @retentionPct, @retentionAmount, @retentionDueDate,
                    @grossAmount, @totalOutstanding,
                    'Draft', @notes, @createdBy
                )`,
                {
                    ref,
                    kind,
                    sourceAfpId:         body.source_afp_id ?? null,
                    parentInvoiceId:     body.parent_invoice_id ?? null,
                    projectId:           body.project_id ?? null,
                    clientId:            body.client_id ?? null,
                    customerText:        body.customer_text ?? null,
                    invoiceDate:         body.invoice_date,
                    dueDate:             body.due_date ?? null,
                    vatApplies:          body.vat_applies ? 1 : 0,
                    cisReverseCharge:    body.cis_reverse_charge ? 1 : 0,
                    netAmount:           Number(body.net_amount || 0),
                    vatAmount:           Number(body.vat_amount || 0),
                    reverseChargeAmount: Number(body.reverse_charge_amount || 0),
                    retentionPct:        body.retention_pct ?? null,
                    retentionAmount:     body.retention_amount ?? null,
                    retentionDueDate:    body.retention_due_date ?? null,
                    grossAmount:         Number(body.gross_amount || 0),
                    totalOutstanding:    Number(body.total_outstanding ?? body.gross_amount ?? 0),
                    notes:               body.notes ?? null,
                    createdBy
                }
            );
            const newInv = insertRes.recordset[0];

            // Line items
            if (Array.isArray(body.line_items) && body.line_items.length) {
                for (const l of body.line_items) {
                    await query(
                        `INSERT INTO InvoiceLineItems (invoice_id, line_no, description, quantity, unit, unit_price, line_total)
                         VALUES (@invoiceId, @lineNo, @description, @quantity, @unit, @unitPrice, @lineTotal)`,
                        {
                            invoiceId:   newInv.id,
                            lineNo:      l.line_no,
                            description: l.description,
                            quantity:    Number(l.quantity || 0),
                            unit:        l.unit ?? null,
                            unitPrice:   Number(l.unit_price || 0),
                            lineTotal:   Number(l.line_total || 0)
                        }
                    );
                }
            }

            return created(newInv, request);
        } catch (err) {
            context.error('Error creating invoice:', err);
            return serverError('Failed to create invoice: ' + err.message, request);
        }
    }
});

app.http('invoices-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'invoices/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            // Only Draft invoices can be edited (per spec)
            const existing = await query('SELECT status FROM Invoices WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Invoice not found', request);
            if (existing.recordset[0].status !== 'Draft') {
                return badRequest('Only Draft invoices can be edited', request);
            }

            await query(
                `UPDATE Invoices SET
                    project_id          = @projectId,
                    client_id           = @clientId,
                    customer_text       = @customerText,
                    invoice_date        = @invoiceDate,
                    due_date            = @dueDate,
                    vat_applies         = @vatApplies,
                    cis_reverse_charge  = @cisReverseCharge,
                    net_amount          = @netAmount,
                    vat_amount          = @vatAmount,
                    reverse_charge_amount = @reverseChargeAmount,
                    retention_pct       = @retentionPct,
                    retention_amount    = @retentionAmount,
                    retention_due_date  = @retentionDueDate,
                    gross_amount        = @grossAmount,
                    total_outstanding   = @totalOutstanding,
                    notes               = @notes,
                    updated_at          = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    projectId:           body.project_id ?? null,
                    clientId:            body.client_id ?? null,
                    customerText:        body.customer_text ?? null,
                    invoiceDate:         body.invoice_date,
                    dueDate:             body.due_date ?? null,
                    vatApplies:          body.vat_applies ? 1 : 0,
                    cisReverseCharge:    body.cis_reverse_charge ? 1 : 0,
                    netAmount:           Number(body.net_amount || 0),
                    vatAmount:           Number(body.vat_amount || 0),
                    reverseChargeAmount: Number(body.reverse_charge_amount || 0),
                    retentionPct:        body.retention_pct ?? null,
                    retentionAmount:     body.retention_amount ?? null,
                    retentionDueDate:    body.retention_due_date ?? null,
                    grossAmount:         Number(body.gross_amount || 0),
                    totalOutstanding:    Number(body.total_outstanding ?? body.gross_amount ?? 0),
                    notes:               body.notes ?? null
                }
            );

            // Replace line items wholesale (simple + safe for Draft state)
            if (Array.isArray(body.line_items)) {
                await query('DELETE FROM InvoiceLineItems WHERE invoice_id = @id', { id });
                for (const l of body.line_items) {
                    await query(
                        `INSERT INTO InvoiceLineItems (invoice_id, line_no, description, quantity, unit, unit_price, line_total)
                         VALUES (@invoiceId, @lineNo, @description, @quantity, @unit, @unitPrice, @lineTotal)`,
                        {
                            invoiceId:   id,
                            lineNo:      l.line_no,
                            description: l.description,
                            quantity:    Number(l.quantity || 0),
                            unit:        l.unit ?? null,
                            unitPrice:   Number(l.unit_price || 0),
                            lineTotal:   Number(l.line_total || 0)
                        }
                    );
                }
            }

            const refetched = await query('SELECT * FROM Invoices WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error updating invoice:', err);
            return serverError('Failed to update invoice: ' + err.message, request);
        }
    }
});

app.http('invoices-issue', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/issue',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json().catch(() => ({}));
            const existing = await query('SELECT status FROM Invoices WHERE id = @id', { id });
            if (!existing.recordset.length) return notFound('Invoice not found', request);
            if (existing.recordset[0].status !== 'Draft') {
                return badRequest(`Cannot issue invoice — current status is ${existing.recordset[0].status}`, request);
            }
            await query(
                `UPDATE Invoices SET
                    status              = 'Issued',
                    issued_at           = GETUTCDATE(),
                    sharepoint_pdf_id   = @pdfId,
                    sharepoint_pdf_url  = @pdfUrl,
                    updated_at          = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    pdfId:  body.sharepoint_pdf_id ?? null,
                    pdfUrl: body.sharepoint_pdf_url ?? null
                }
            );
            const refetched = await query('SELECT * FROM Invoices WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error issuing invoice:', err);
            return serverError('Failed to issue invoice: ' + err.message, request);
        }
    }
});

app.http('invoices-payment-add', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/payments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const createdBy = auth.email || auth.name || null;

            const inv = await query('SELECT gross_amount, status FROM Invoices WHERE id = @id', { id });
            if (!inv.recordset.length) return notFound('Invoice not found', request);
            if (inv.recordset[0].status === 'Void' || inv.recordset[0].status === 'Cancelled') {
                return badRequest('Cannot add payment to a voided/cancelled invoice', request);
            }

            await query(
                `INSERT INTO InvoicePayments (invoice_id, payment_date, amount, method,
                                               is_retention_release, reference, notes, created_by)
                 VALUES (@invoiceId, @paymentDate, @amount, @method,
                         @isRetentionRelease, @reference, @notes, @createdBy)`,
                {
                    invoiceId:          id,
                    paymentDate:        body.payment_date,
                    amount:             Number(body.amount || 0),
                    method:             body.method ?? null,
                    isRetentionRelease: body.is_retention_release ? 1 : 0,
                    reference:          body.reference ?? null,
                    notes:              body.notes ?? null,
                    createdBy
                }
            );

            // Recompute status + outstanding
            const sumRes = await query(
                'SELECT SUM(amount) AS total_paid FROM InvoicePayments WHERE invoice_id = @id',
                { id }
            );
            const totalPaid = Number(sumRes.recordset[0]?.total_paid || 0);
            const gross = Number(inv.recordset[0].gross_amount || 0);
            const outstanding = +(gross - totalPaid).toFixed(2);
            let newStatus;
            if (outstanding <= 0.005) newStatus = 'Paid';
            else if (totalPaid > 0)   newStatus = 'Partially Paid';
            else                      newStatus = inv.recordset[0].status;  // unchanged

            await query(
                `UPDATE Invoices SET
                    total_outstanding = @outstanding,
                    status            = @status,
                    updated_at        = GETUTCDATE()
                 WHERE id = @id`,
                { id, outstanding, status: newStatus }
            );

            return ok({ id, total_paid: totalPaid, total_outstanding: outstanding, status: newStatus }, request);
        } catch (err) {
            context.error('Error adding payment:', err);
            return serverError('Failed to add payment: ' + err.message, request);
        }
    }
});

app.http('invoices-payment-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/payments/{pid}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const pid = parseInt(request.params.pid);

            await query('DELETE FROM InvoicePayments WHERE id = @pid AND invoice_id = @id', { id, pid });

            const inv = await query('SELECT gross_amount, status FROM Invoices WHERE id = @id', { id });
            if (!inv.recordset.length) return notFound('Invoice not found', request);

            const sumRes = await query(
                'SELECT SUM(amount) AS total_paid FROM InvoicePayments WHERE invoice_id = @id',
                { id }
            );
            const totalPaid = Number(sumRes.recordset[0]?.total_paid || 0);
            const gross = Number(inv.recordset[0].gross_amount || 0);
            const outstanding = +(gross - totalPaid).toFixed(2);
            let newStatus;
            if (outstanding <= 0.005)       newStatus = 'Paid';
            else if (totalPaid > 0)         newStatus = 'Partially Paid';
            else if (inv.recordset[0].status === 'Paid' || inv.recordset[0].status === 'Partially Paid')
                                            newStatus = 'Issued';
            else                            newStatus = inv.recordset[0].status;

            await query(
                `UPDATE Invoices SET
                    total_outstanding = @outstanding,
                    status            = @status,
                    updated_at        = GETUTCDATE()
                 WHERE id = @id`,
                { id, outstanding, status: newStatus }
            );

            return ok({ id, total_outstanding: outstanding, status: newStatus }, request);
        } catch (err) {
            context.error('Error deleting payment:', err);
            return serverError('Failed to delete payment: ' + err.message, request);
        }
    }
});

app.http('invoices-void', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/void',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            await query(
                `UPDATE Invoices SET
                    status            = 'Void',
                    voided_at         = GETUTCDATE(),
                    total_outstanding = 0,
                    updated_at        = GETUTCDATE()
                 WHERE id = @id`,
                { id }
            );
            return ok({ id, status: 'Void' }, request);
        } catch (err) {
            context.error('Error voiding invoice:', err);
            return serverError('Failed to void invoice: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Receipts
// ─────────────────────────────────────────────────────────────────────────────

app.http('receipts-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'receipts',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const category = request.query.get('category');
            const projectId = request.query.get('project_id');
            const where = [];
            const params = {};
            if (category)  { where.push('r.category = @category'); params.category = category; }
            if (projectId) { where.push('r.project_id = @pid');    params.pid = parseInt(projectId); }
            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const result = await query(
                `SELECT r.*,
                        p.project_number, p.project_name,
                        e.name AS paid_by_name
                 FROM Receipts r
                 LEFT JOIN Projects p  ON r.project_id = p.id
                 LEFT JOIN Employees e ON r.paid_by_employee_id = e.id
                 ${whereClause}
                 ORDER BY r.receipt_date DESC, r.id DESC`,
                params
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error listing receipts:', err);
            return serverError('Failed to list receipts', request);
        }
    }
});

app.http('receipts-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'receipts',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            if (!body.receipt_date) return badRequest('receipt_date required', request);
            if (!body.gross_amount) return badRequest('gross_amount required', request);
            const createdBy = auth.email || auth.name || null;

            // Insert the row first
            const insertRes = await query(
                `INSERT INTO Receipts (
                    receipt_date, supplier_text, category, project_id, cost_centre,
                    net_amount, vat_amount, gross_amount,
                    payment_method, paid_by_employee_id, notes, created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    @receiptDate, @supplierText, @category, @projectId, @costCentre,
                    @netAmount, @vatAmount, @grossAmount,
                    @paymentMethod, @paidByEmployeeId, @notes, @createdBy
                )`,
                {
                    receiptDate:      body.receipt_date,
                    supplierText:     body.supplier_text ?? null,
                    category:         body.category || 'Other',
                    projectId:        body.project_id ?? null,
                    costCentre:       body.cost_centre ?? null,
                    netAmount:        body.net_amount ?? null,
                    vatAmount:        body.vat_amount ?? null,
                    grossAmount:      Number(body.gross_amount || 0),
                    paymentMethod:    body.payment_method || 'other',
                    paidByEmployeeId: body.paid_by_employee_id ?? null,
                    notes:            body.notes ?? null,
                    createdBy
                }
            );
            const newReceipt = insertRes.recordset[0];

            // Attachment (uploaded by client to SharePoint, just metadata here)
            if (body.attachment && body.attachment.sharepoint_id) {
                const attRes = await query(
                    `INSERT INTO InvoiceAttachments (parent_kind, parent_id, kind, filename, sharepoint_id, sharepoint_url, uploaded_by)
                     OUTPUT INSERTED.id
                     VALUES ('receipt', @parentId, 'receipt', @filename, @sharepointId, @sharepointUrl, @uploadedBy)`,
                    {
                        parentId:      newReceipt.id,
                        filename:      body.attachment.filename ?? null,
                        sharepointId:  body.attachment.sharepoint_id,
                        sharepointUrl: body.attachment.sharepoint_url ?? null,
                        uploadedBy:    createdBy
                    }
                );
                const attId = attRes.recordset[0]?.id;
                if (attId) {
                    await query(
                        'UPDATE Receipts SET attachment_id = @attId WHERE id = @id',
                        { id: newReceipt.id, attId }
                    );
                    newReceipt.attachment_id = attId;
                }
            }

            return created(newReceipt, request);
        } catch (err) {
            context.error('Error creating receipt:', err);
            return serverError('Failed to create receipt: ' + err.message, request);
        }
    }
});

app.http('receipts-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'receipts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            await query(
                `UPDATE Receipts SET
                    receipt_date        = @receiptDate,
                    supplier_text       = @supplierText,
                    category            = @category,
                    project_id          = @projectId,
                    cost_centre         = @costCentre,
                    net_amount          = @netAmount,
                    vat_amount          = @vatAmount,
                    gross_amount        = @grossAmount,
                    payment_method      = @paymentMethod,
                    paid_by_employee_id = @paidByEmployeeId,
                    is_reconciled       = @isReconciled,
                    notes               = @notes,
                    updated_at          = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    receiptDate:      body.receipt_date,
                    supplierText:     body.supplier_text ?? null,
                    category:         body.category || 'Other',
                    projectId:        body.project_id ?? null,
                    costCentre:       body.cost_centre ?? null,
                    netAmount:        body.net_amount ?? null,
                    vatAmount:        body.vat_amount ?? null,
                    grossAmount:      Number(body.gross_amount || 0),
                    paymentMethod:    body.payment_method || 'other',
                    paidByEmployeeId: body.paid_by_employee_id ?? null,
                    isReconciled:     body.is_reconciled ? 1 : 0,
                    notes:            body.notes ?? null
                }
            );
            const refetched = await query('SELECT * FROM Receipts WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error updating receipt:', err);
            return serverError('Failed to update receipt: ' + err.message, request);
        }
    }
});

app.http('receipts-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'receipts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            await query('DELETE FROM Receipts WHERE id = @id', { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('Error deleting receipt:', err);
            return serverError('Failed to delete receipt: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Supplier invoice attach (PO extension)
// PUT /api/purchase-orders/:id/supplier-invoice — attach + reconcile
// ─────────────────────────────────────────────────────────────────────────────

app.http('po-supplier-invoice-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}/supplier-invoice/{*path}',
    handler: async (request) => preflight(request)
});

app.http('po-supplier-invoice-attach', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}/supplier-invoice',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const uploadedBy = auth.email || auth.name || null;

            // Fetch the PO so we can do auto-reconcile against total_value
            const poRes = await query('SELECT * FROM PurchaseOrders WHERE id = @id', { id });
            if (!poRes.recordset.length) return notFound('PO not found', request);
            const po = poRes.recordset[0];

            // Reconciliation: gross within £1 of PO total = matched, else discrepancy
            const grossBilled = Number(body.supplier_invoice_gross || 0);
            const poTotal = Number(po.total_value || 0);
            let reconciliationStatus = 'unmatched';
            if (poTotal > 0) {
                reconciliationStatus = (Math.abs(grossBilled - poTotal) <= 1.00) ? 'matched' : 'discrepancy';
            }

            // Create attachment row in POAttachments (existing table — note: po_id, sharepoint_file_id, sharepoint_file_url)
            let attachmentId = null;
            if (body.sharepoint_id) {
                const attRes = await query(
                    `INSERT INTO POAttachments (po_id, kind, filename, sharepoint_file_id, sharepoint_file_url, uploaded_by)
                     OUTPUT INSERTED.id
                     VALUES (@poId, 'supplier_invoice', @filename, @sharepointFileId, @sharepointFileUrl, @uploadedBy)`,
                    {
                        poId:              id,
                        filename:          body.filename || 'supplier-invoice.pdf',
                        sharepointFileId:  body.sharepoint_id,
                        sharepointFileUrl: body.sharepoint_url ?? null,
                        uploadedBy
                    }
                );
                attachmentId = attRes.recordset[0]?.id || null;
            }

            // Update the PO with the supplier invoice fields
            // Advance status to Invoiced unless already Closed/Cancelled
            const statusUpdate = ['Closed', 'Cancelled'].includes(po.status) ? po.status : 'Invoiced';
            await query(
                `UPDATE PurchaseOrders SET
                    supplier_invoice_ref            = @ref,
                    supplier_invoice_date           = @invDate,
                    supplier_invoice_net            = @net,
                    supplier_invoice_vat            = @vat,
                    supplier_invoice_gross          = @gross,
                    supplier_invoice_received_at    = GETUTCDATE(),
                    supplier_invoice_attachment_id  = @attachmentId,
                    reconciliation_status           = @reconStatus,
                    reconciliation_notes            = @notes,
                    status                          = @status,
                    updated_at                      = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    ref:         body.supplier_invoice_ref ?? null,
                    invDate:     body.supplier_invoice_date ?? null,
                    net:         body.supplier_invoice_net ?? null,
                    vat:         body.supplier_invoice_vat ?? null,
                    gross:       grossBilled || null,
                    attachmentId,
                    reconStatus: reconciliationStatus,
                    notes:       body.reconciliation_notes ?? null,
                    status:      statusUpdate
                }
            );

            const refetched = await query('SELECT * FROM PurchaseOrders WHERE id = @id', { id });
            return ok({
                ...refetched.recordset[0],
                reconciliation_status: reconciliationStatus,
                attachment_id: attachmentId
            }, request);
        } catch (err) {
            context.error('Error attaching supplier invoice:', err);
            return serverError('Failed to attach supplier invoice: ' + err.message, request);
        }
    }
});

module.exports = { nextInvoiceRef, nextAfpRef, formatInvoiceRef, formatAfpRef };
