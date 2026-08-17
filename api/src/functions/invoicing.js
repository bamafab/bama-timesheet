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
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');
const { advanceBabcockOnPayment } = require('../babcock-cascade');

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

            // Explicit AFP number (mid-project onboarding via AFP import) —
            // create as that exact valuation number; nextAfpRef (MAX+1) then
            // continues the sequence naturally afterwards.
            let application_no, ref;
            if (body.application_no != null && Number(body.application_no) > 0) {
                application_no = Math.floor(Number(body.application_no));
                const dup = await query(
                    'SELECT id FROM Applications WHERE project_id = @pid AND application_no = @n',
                    { pid: body.project_id, n: application_no }
                );
                if (dup.recordset.length) {
                    return badRequest(`AFP number ${application_no} already exists for this project`, request);
                }
                ref = formatAfpRef(application_no);
            } else {
                ({ application_no, ref } = await nextAfpRef(body.project_id));
            }
            const createdBy = auth.email || auth.name || null;

            const insertRes = await query(
                `INSERT INTO Applications (
                    project_id, application_no, ref, period_label, period_start, period_end,
                    status, is_final,
                    applied_value_net, applied_vat, applied_retention, applied_gross,
                    previous_certificate_value, retention_pct, contract_no, cumulative_value_net,
                    notes, created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    @projectId, @applicationNo, @ref, @periodLabel, @periodStart, @periodEnd,
                    'Draft', @isFinal,
                    @appliedValueNet, @appliedVat, @appliedRetention, @appliedGross,
                    @prevCertValue, @retentionPct, @contractNo, @cumulativeValueNet,
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
                    prevCertValue:    body.previous_certificate_value != null ? Number(body.previous_certificate_value) : null,
                    retentionPct:     body.retention_pct != null ? Number(body.retention_pct) : null,
                    contractNo:       body.contract_no ?? null,
                    cumulativeValueNet: body.cumulative_value_net != null ? Number(body.cumulative_value_net) : null,
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
                            this_app_value, cumulative_value,
                            section, item_no, item_description, item_quote_ref, item_wo_no,
                            gross_amount_paid
                        )
                        VALUES (
                            @applicationId, @lineNo, @sourceQliId, @description,
                            @contractValue, @previousPct, @thisAppPct,
                            @thisAppValue, @cumulativeValue,
                            @section, @itemNo, @itemDescription, @itemQuoteRef, @itemWoNo,
                            @grossAmountPaid
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
                            cumulativeValue: Number(l.cumulative_value || 0),
                            section:       l.section || 'measured',
                            itemNo:        l.item_no != null ? Number(l.item_no) : null,
                            itemDescription: l.item_description ?? null,
                            itemQuoteRef:  l.item_quote_ref ?? null,
                            itemWoNo:      l.item_wo_no ?? null,
                            grossAmountPaid: l.gross_amount_paid != null ? Number(l.gross_amount_paid) : null
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
                    previous_certificate_value = @prevCertValue,
                    retention_pct     = @retentionPct,
                    contract_no       = @contractNo,
                    cumulative_value_net = @cumulativeValueNet,
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
                    prevCertValue:    body.previous_certificate_value != null ? Number(body.previous_certificate_value) : null,
                    retentionPct:     body.retention_pct != null ? Number(body.retention_pct) : null,
                    contractNo:       body.contract_no ?? null,
                    cumulativeValueNet: body.cumulative_value_net != null ? Number(body.cumulative_value_net) : null,
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
                            this_app_value, cumulative_value,
                            section, item_no, item_description, item_quote_ref, item_wo_no,
                            gross_amount_paid
                        )
                        VALUES (
                            @applicationId, @lineNo, @sourceQliId, @description,
                            @contractValue, @previousPct, @thisAppPct,
                            @thisAppValue, @cumulativeValue,
                            @section, @itemNo, @itemDescription, @itemQuoteRef, @itemWoNo,
                            @grossAmountPaid
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
                            cumulativeValue: Number(l.cumulative_value || 0),
                            section:       l.section || 'measured',
                            itemNo:        l.item_no != null ? Number(l.item_no) : null,
                            itemDescription: l.item_description ?? null,
                            itemQuoteRef:  l.item_quote_ref ?? null,
                            itemWoNo:      l.item_wo_no ?? null,
                            grossAmountPaid: l.gross_amount_paid != null ? Number(l.gross_amount_paid) : null
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
            // PDF refs are optional — submits still work when the project has
            // no SharePoint folder (client falls back to opening the PDF in a
            // tab); refs can be backfilled by re-submitting later.
            await query(
                `UPDATE Applications SET
                    status              = 'Submitted',
                    submitted_at        = GETUTCDATE(),
                    sharepoint_pdf_id   = COALESCE(@pdfId, sharepoint_pdf_id),
                    sharepoint_pdf_url  = COALESCE(@pdfUrl, sharepoint_pdf_url),
                    updated_at          = GETUTCDATE()
                 WHERE id = @id`,
                {
                    id,
                    pdfId:  body.sharepoint_pdf_id || null,
                    pdfUrl: body.sharepoint_pdf_url || null
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

// Un-certify — revert a Certified AFP back to Submitted (wrong cert entered,
// or test AFPs). Clears the certified header figures and unwinds the per-line
// paid accumulation (gross_amount_paid returns to its carried base). Invoiced
// AFPs must have their invoice unlinked/deleted first.
app.http('applications-uncertify', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/uncertify',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const res = await query('SELECT status FROM Applications WHERE id = @id', { id });
            if (!res.recordset.length) return notFound('Application not found', request);
            const status = res.recordset[0].status;
            if (status === 'Invoiced') {
                return badRequest('AFP is Invoiced — unlink or delete the invoice first, then un-certify', request);
            }
            if (status !== 'Certified') {
                return badRequest(`Only Certified AFPs can be un-certified — current status is ${status}`, request);
            }
            await logChange('application', id, 'AFP#' + id, 'uncertified',
                'Certified', 'Submitted', auth.name || auth.email);
            // Unwind per-line: paid returns to its pre-cert base
            await query(
                `UPDATE ApplicationLineItems
                 SET gross_amount_paid = ISNULL(gross_amount_paid, 0) - ISNULL(certified_this_app_value, 0),
                     certified_this_app_value = NULL
                 WHERE application_id = @id`, { id });
            await query(
                `UPDATE Applications SET
                    status = 'Submitted',
                    certified_value_net = NULL, certified_vat = NULL,
                    certified_retention = NULL, certified_gross = NULL,
                    certificate_ref = NULL, certificate_date = NULL,
                    certified_at = NULL,
                    updated_at = GETUTCDATE()
                 WHERE id = @id`, { id });
            const refetched = await query('SELECT * FROM Applications WHERE id = @id', { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error un-certifying AFP:', err);
            return serverError('Failed to un-certify: ' + err.message, request);
        }
    }
});

// Match an EXISTING invoice to an AFP (instead of generating a new one) —
// e.g. legacy invoices raised before the AFP was onboarded. Pass
// { invoice_id: null } to unlink (status returns to Certified).
app.http('applications-link-invoice', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/link-invoice',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json().catch(() => ({}));

            const afpRes = await query('SELECT * FROM Applications WHERE id = @id', { id });
            if (!afpRes.recordset.length) return notFound('Application not found', request);
            const afp = afpRes.recordset[0];
            if (afp.status === 'Draft' || afp.status === 'Cancelled') {
                return badRequest(`Cannot link an invoice to a ${afp.status} AFP`, request);
            }

            if (body.invoice_id == null) {
                await query(
                    `UPDATE Applications SET invoice_id = NULL,
                        status = CASE WHEN status = 'Invoiced' THEN 'Certified' ELSE status END,
                        updated_at = GETUTCDATE()
                     WHERE id = @id`, { id });
            } else {
                const invId = parseInt(body.invoice_id);
                const invRes = await query('SELECT * FROM Invoices WHERE id = @invId', { invId });
                if (!invRes.recordset.length) return notFound('Invoice not found', request);
                const inv = invRes.recordset[0];
                if (inv.status === 'Void' || inv.status === 'Cancelled') {
                    return badRequest(`Cannot link a ${inv.status} invoice`, request);
                }
                if (inv.project_id != null && inv.project_id !== afp.project_id) {
                    return badRequest('Invoice belongs to a different project', request);
                }
                // Backfill the invoice's project when it was created without one
                if (inv.project_id == null) {
                    await query('UPDATE Invoices SET project_id = @pid, updated_at = GETUTCDATE() WHERE id = @invId',
                        { pid: afp.project_id, invId });
                }
                await query(
                    `UPDATE Applications SET invoice_id = @invId, status = 'Invoiced', updated_at = GETUTCDATE()
                     WHERE id = @id`, { id, invId });
            }
            const refetched = await query(
                `SELECT a.*, inv.ref AS invoice_ref
                 FROM Applications a LEFT JOIN Invoices inv ON a.invoice_id = inv.id
                 WHERE a.id = @id`, { id });
            return ok(refetched.recordset[0], request);
        } catch (err) {
            context.error('Error linking invoice to AFP:', err);
            return serverError('Failed to link invoice: ' + err.message, request);
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
            // Certificate file is OPTIONAL — clients don't always send a formal
            // cert, and test AFPs need certifying to preview invoices. Figures
            // can be entered manually; the file can be attached later.
            const wasAlreadyCertified = existing.recordset[0].status === 'Certified'
                                     || existing.recordset[0].status === 'Invoiced';
            const _certAudit = () => logChange('application', id,
                body.certificate_ref || ('AFP#' + id),
                wasAlreadyCertified ? 'certificate_updated' : 'certified',
                existing.recordset[0].status, 'Certified', auth.name || auth.email);
            await _certAudit();

            await query(
                `UPDATE Applications SET
                    certified_value_net = @certifiedValueNet,
                    certified_vat       = @certifiedVat,
                    certified_retention = @certifiedRetention,
                    certified_gross     = @certifiedGross,
                    certificate_ref     = @certificateRef,
                    certificate_date    = @certificateDate,
                    certificate_final_payment_date = @certFinalPaymentDate,
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
                    certificateDate:   body.certificate_date ?? null,
                    certFinalPaymentDate: body.certificate_final_payment_date ?? null
                }
            );

            // Per-line certified values (optional).
            // gross_amount_paid = cumulative paid to date on the line. At AFP
            // creation it holds the carried-forward previous paid; certifying
            // adds this cert's per-line value on top. On RE-confirm we first
            // strip the old certified value so the delta is replaced, not
            // double-added.
            if (Array.isArray(body.line_items)) {
                for (const l of body.line_items) {
                    if (l.id && l.certified_cumulative_value != null) {
                        // Cumulative certified-to-date for the line: paid-to-date
                        // becomes exactly that figure; this-period certified =
                        // cumulative − the carried base (paid before this cert).
                        // Re-confirm safe: base excludes the previous confirm.
                        await query(
                            `UPDATE ApplicationLineItems
                             SET certified_this_app_value = @cum
                                   - (ISNULL(gross_amount_paid, 0)
                                      - CASE WHEN @wasCert = 1 THEN ISNULL(certified_this_app_value, 0) ELSE 0 END),
                                 gross_amount_paid = @cum
                             WHERE id = @lid AND application_id = @aid`,
                            { cum: Number(l.certified_cumulative_value), lid: l.id, aid: id,
                              wasCert: wasAlreadyCertified ? 1 : 0 }
                        );
                    } else if (l.id && l.certified_this_app_value != null) {
                        await query(
                            `UPDATE ApplicationLineItems
                             SET gross_amount_paid = ISNULL(gross_amount_paid, 0)
                                                   - CASE WHEN @wasCert = 1 THEN ISNULL(certified_this_app_value, 0) ELSE 0 END
                                                   + @val,
                                 certified_this_app_value = @val
                             WHERE id = @lid AND application_id = @aid`,
                            { val: Number(l.certified_this_app_value), lid: l.id, aid: id,
                              wasCert: wasAlreadyCertified ? 1 : 0 }
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
// New Invoice: kind=invoice, status=Draft, ref=auto, source_afp_id=N.
// Invoice value = the certified payment due (already net of retention).
// Retention is held at PROJECT level (Applications.certified_retention feeds
// CVR "Retention held") and must NEVER be deducted again on the invoice —
// see the 17/08/2026 INV0316 bug where cumulative retention was subtracted
// from an amount-due figure that was already net of retention.
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
                `SELECT a.*, p.client_id AS project_client_id,
                        c.vat_treatment AS client_vat_treatment,
                        c.payment_terms_days AS client_payment_terms
                 FROM Applications a
                 LEFT JOIN Projects p ON a.project_id = p.id
                 LEFT JOIN Clients c  ON p.client_id  = c.id
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

            // Allocate invoice ref
            const invRef = await nextInvoiceRef('invoice');

            // Round at every step (see the MONEY section in shared.js) so this
            // matches what the invoice modal and the PDF compute to the penny.
            const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

            // Invoice net = the certified PAYMENT DUE excluding VAT.
            // certified_gross is the "payment due this period" figure off the
            // notice (post-retention); strip any VAT they showed. Fall back to
            // certified net − retention (this-period figures), then to the
            // applied equivalents. Retention itself is NOT deducted here —
            // the due figure is already net of it and retention is tracked on
            // the AFP/project, not the invoice.
            const netAmount =
                (app2.certified_gross != null && Number(app2.certified_gross) > 0)
                    ? r2(Number(app2.certified_gross) - Number(app2.certified_vat || 0))
                : (app2.certified_value_net != null && Number(app2.certified_value_net) !== 0)
                    ? r2(Number(app2.certified_value_net) - Number(app2.certified_retention || 0))
                : (app2.applied_gross != null && Number(app2.applied_gross) > 0)
                    ? r2(Number(app2.applied_gross) - Number(app2.applied_vat || 0))
                    : r2(Number(app2.applied_value_net || 0) - Number(app2.applied_retention || 0));

            // VAT position comes from the CLIENT's vat_treatment setting —
            // never from the AFP figures (certs frequently show £0 VAT under
            // reverse charge, which previously produced broken VAT documents).
            //   standard       → 20% VAT added on (net − retention)
            //   reverse_charge → no VAT billed; reverse-charge amount shown
            //                    for information (customer accounts to HMRC)
            //   zero           → no VAT at all
            const treatment = ['standard', 'reverse_charge', 'zero'].includes(app2.client_vat_treatment)
                            ? app2.client_vat_treatment : 'reverse_charge';
            const vatBase = r2(netAmount);
            const vatAmount     = treatment === 'standard'      ? r2(vatBase * 0.20) : 0;
            const reverseCharge = treatment === 'reverse_charge' ? r2(vatBase * 0.20) : 0;
            const grossAmount   = r2(vatBase + vatAmount);

            // Due date: the certificate's "Final Date for payment" wins when
            // present (that is the contractual date under the payment notice);
            // otherwise invoice date + client payment terms (default 30 days).
            const invDate = new Date();
            const invoiceDateStr = invDate.toISOString().slice(0, 10);
            let dueDateStr;
            const certDue = app2.certificate_final_payment_date;
            if (certDue) {
                dueDateStr = (certDue instanceof Date ? certDue.toISOString() : String(certDue)).slice(0, 10);
            } else {
                const termsDays = Number(app2.client_payment_terms) > 0 ? Number(app2.client_payment_terms) : 30;
                const dueDate = new Date(invDate);
                dueDate.setDate(dueDate.getDate() + termsDays);
                dueDateStr = dueDate.toISOString().slice(0, 10);
            }

            // Single summary line item — "as per AFP / payment certificate",
            // fully editable while the invoice is still Draft.
            const fmtUk = (s) => {
                const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
                return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
            };
            let summaryDesc = `Works executed as per Application for Payment ${app2.ref}`;
            if (app2.certificate_ref) {
                summaryDesc += ` / Payment Certificate ${app2.certificate_ref}`;
                const certDateUk = fmtUk(app2.certificate_date instanceof Date
                    ? app2.certificate_date.toISOString() : app2.certificate_date);
                if (certDateUk) summaryDesc += ` dated ${certDateUk}`;
            }

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
                    @invoiceDate, @dueDate,
                    @vatApplies, @cisReverseCharge,
                    @netAmount, @vatAmount, @reverseChargeAmount,
                    NULL, @retention, NULL,
                    @grossAmount, @grossAmount,
                    'Draft', NULL, @createdBy
                )`,
                {
                    ref:                 invRef,
                    sourceAfpId:         id,
                    projectId:           app2.project_id,
                    clientId:            app2.project_client_id,
                    invoiceDate:         invoiceDateStr,
                    dueDate:             dueDateStr,
                    vatApplies:          treatment === 'standard' ? 1 : 0,
                    cisReverseCharge:    treatment === 'reverse_charge' ? 1 : 0,
                    netAmount,
                    vatAmount,
                    reverseChargeAmount: reverseCharge,
                    retention:           0, // held on the project (AFP), never deducted on the invoice
                    grossAmount,
                    createdBy
                }
            );
            const newInv = insertRes.recordset[0];

            // Single summary line at the full applied/certified net value
            await query(
                `INSERT INTO InvoiceLineItems (invoice_id, line_no, description, quantity, unit_price, line_total)
                 VALUES (@invoiceId, 1, @description, 1, @amount, @amount)`,
                { invoiceId: newInv.id, description: summaryDesc, amount: netAmount }
            );

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
                        c.company_name AS client_company_name,
                        c.vat_treatment AS client_vat_treatment,
                        c.payment_terms_days AS client_payment_terms,
                        c.address_line1 AS client_address_line1,
                        c.address_line2 AS client_address_line2,
                        c.city AS client_city,
                        c.county AS client_county,
                        c.postcode AS client_postcode,
                        a.ref AS afp_ref,
                        a.certificate_ref AS afp_certificate_ref,
                        a.certificate_date AS afp_certificate_date,
                        pi.ref AS parent_invoice_ref
                 FROM Invoices i
                 LEFT JOIN Projects p ON i.project_id = p.id
                 LEFT JOIN Clients c  ON i.client_id  = c.id
                 LEFT JOIN Applications a ON i.source_afp_id = a.id
                 LEFT JOIN Invoices pi ON i.parent_invoice_id = pi.id
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices-import — bulk import of HISTORICAL invoices.
// Flat route (avoids {id} collision). Preserves the original refs from the
// old PDFs; skips any ref that already exists. Imported rows land as
// Issued or Paid (Paid → total_outstanding 0). Used to backfill the
// INV0001–INV025x gap from the pre-ERP era.
// ─────────────────────────────────────────────────────────────────────────────
app.http('invoices-import', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices-import',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const rows = Array.isArray(body.invoices) ? body.invoices : [];
            if (!rows.length) return badRequest('No invoices supplied', request);
            if (rows.length > 100) return badRequest('Max 100 invoices per batch', request);

            const createdBy = auth.email || auth.name || null;
            const inserted = [], skipped = [];

            for (const r of rows) {
                const ref = String(r.ref || '').trim().toUpperCase();
                if (!ref || !r.invoice_date) {
                    skipped.push({ ref: ref || '(blank)', reason: 'Missing ref or invoice_date' });
                    continue;
                }
                const dup = await query('SELECT id FROM Invoices WHERE ref = @ref', { ref });
                if (dup.recordset.length) {
                    skipped.push({ ref, reason: 'Ref already exists' });
                    continue;
                }

                const status = r.status === 'Issued' ? 'Issued' : 'Paid';
                const gross = Number(r.gross_amount || 0);
                const kind = ref.startsWith('CN') ? 'credit_note'
                           : ref.startsWith('PRO') ? 'pro_forma' : 'invoice';

                const insertRes = await query(
                    `INSERT INTO Invoices (
                        ref, kind, project_id, client_id, customer_text,
                        invoice_date, due_date, issued_at,
                        vat_applies, cis_reverse_charge,
                        net_amount, vat_amount, reverse_charge_amount,
                        retention_amount, gross_amount, total_outstanding,
                        status, sharepoint_pdf_id, sharepoint_pdf_url,
                        notes, created_by
                    )
                    OUTPUT INSERTED.id, INSERTED.ref
                    VALUES (
                        @ref, @kind, @projectId, @clientId, @customerText,
                        @invoiceDate, @dueDate, @invoiceDate,
                        @vatApplies, @cisReverseCharge,
                        @netAmount, @vatAmount, @reverseChargeAmount,
                        @retentionAmount, @grossAmount, @totalOutstanding,
                        @status, @spId, @spUrl,
                        @notes, @createdBy
                    )`,
                    {
                        ref, kind,
                        projectId:           r.project_id ?? null,
                        clientId:            r.client_id ?? null,
                        customerText:        r.customer_text ?? null,
                        invoiceDate:         r.invoice_date,
                        dueDate:             r.due_date ?? null,
                        vatApplies:          r.vat_applies ? 1 : 0,
                        cisReverseCharge:    r.cis_reverse_charge ? 1 : 0,
                        netAmount:           Number(r.net_amount || 0),
                        vatAmount:           Number(r.vat_amount || 0),
                        reverseChargeAmount: Number(r.reverse_charge_amount || 0),
                        retentionAmount:     r.retention_amount != null ? Number(r.retention_amount) : null,
                        grossAmount:         gross,
                        totalOutstanding:    status === 'Paid' ? 0 : gross,
                        status,
                        spId:                r.sharepoint_pdf_id ?? null,
                        spUrl:               r.sharepoint_pdf_url ?? null,
                        notes:               r.notes ?? 'Imported from historical invoice PDF',
                        createdBy
                    }
                );
                const newId = insertRes.recordset[0].id;

                // Optional single summary line so the detail view isn't empty
                if (Number(r.net_amount || 0) !== 0) {
                    await query(
                        `INSERT INTO InvoiceLineItems (invoice_id, line_no, description, quantity, unit_price, line_total)
                         VALUES (@invoiceId, 1, @description, 1, @amount, @amount)`,
                        {
                            invoiceId: newId,
                            description: r.line_description || 'Historical invoice (imported)',
                            amount: Number(r.net_amount || 0)
                        }
                    );
                }

                inserted.push({ id: newId, ref });
            }

            return ok({ inserted, skipped }, request);
        } catch (err) {
            context.error('Error importing invoices:', err);
            return serverError('Failed to import invoices: ' + err.message, request);
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
                    ref, kind, source_afp_id, parent_invoice_id, is_retention_release, project_id, client_id, customer_text,
                    invoice_date, due_date,
                    vat_applies, cis_reverse_charge,
                    net_amount, vat_amount, reverse_charge_amount,
                    retention_pct, retention_amount, retention_due_date,
                    gross_amount, total_outstanding,
                    status, notes, created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    @ref, @kind, @sourceAfpId, @parentInvoiceId, @isRetentionRelease, @projectId, @clientId, @customerText,
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
                    isRetentionRelease:  body.is_retention_release ? 1 : 0,
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
                    parent_invoice_id   = @parentInvoiceId,
                    is_retention_release = @isRetentionRelease,
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
                    parentInvoiceId:     body.parent_invoice_id ?? null,
                    isRetentionRelease:  body.is_retention_release ? 1 : 0,
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

// POST /api/invoices/{id}/reopen — flip a Paid invoice back to Issued.
// Guarded: only allowed when NO payments are recorded (i.e. imported
// historicals wrongly marked Paid). Invoices with payment rows must be
// corrected by deleting the payment (which recomputes automatically).
app.http('invoices-reopen', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/reopen',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const invRes = await query('SELECT status, gross_amount FROM Invoices WHERE id = @id', { id });
            if (!invRes.recordset.length) return notFound('Invoice not found', request);
            const inv = invRes.recordset[0];
            if (inv.status !== 'Paid') {
                return badRequest(`Only Paid invoices can be reopened (current: ${inv.status})`, request);
            }
            const pays = await query('SELECT COUNT(*) AS n FROM InvoicePayments WHERE invoice_id = @id', { id });
            if (Number(pays.recordset[0].n) > 0) {
                return badRequest('This invoice has recorded payments — delete the payment row(s) instead; status recomputes automatically', request);
            }
            const upd = await query(
                `UPDATE Invoices SET
                    status = 'Issued',
                    total_outstanding = gross_amount,
                    updated_at = GETUTCDATE()
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                { id }
            );
            return ok(upd.recordset[0], request);
        } catch (err) {
            context.error('Error reopening invoice:', err);
            return serverError('Failed to reopen invoice: ' + err.message, request);
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

            const inv = await query('SELECT gross_amount, status, kind, project_id FROM Invoices WHERE id = @id', { id });
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

            // ── Babcock cascade (sales side) ──────────────────────────────────
            // Invoice on a Babcock (BC) project just became fully Paid ⇒ mirror
            // to the Babcock tracker: 'Approved to Pay' → 'Payment Received'.
            // Strict + one-way + non-fatal — see api/src/babcock-cascade.js.
            let babcock = null;
            if (newStatus === 'Paid' && inv.recordset[0].status !== 'Paid' &&
                inv.recordset[0].kind === 'invoice' && inv.recordset[0].project_id) {
                try {
                    const pr = await query(
                        'SELECT source_babcock_quote_id FROM Projects WHERE id = @pid',
                        { pid: inv.recordset[0].project_id }
                    );
                    const bqId = pr.recordset[0]?.source_babcock_quote_id;
                    if (bqId) babcock = await advanceBabcockOnPayment('sales', bqId, body.payment_date);
                } catch (e) {
                    context.error('Babcock sales cascade failed (non-fatal):', e);
                }
            }

            return ok({ id, total_paid: totalPaid, total_outstanding: outstanding, status: newStatus, babcock }, request);
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

// Hard delete — TEST/Draft invoices only. Issued invoices must be voided
// (audit trail). Cascades line items + unlinks any AFP pointing at it.
app.http('invoices-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'invoices/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const res = await query('SELECT * FROM Invoices WHERE id = @id', { id });
            if (!res.recordset.length) return notFound('Invoice not found', request);
            const inv = res.recordset[0];
            if (inv.status !== 'Draft' && inv.status !== 'Void') {
                return badRequest(`Only Draft or Void invoices can be deleted — ${inv.status} invoices must be voided first (audit trail)`, request);
            }
            const pay = await query('SELECT COUNT(*) AS n FROM InvoicePayments WHERE invoice_id = @id', { id });
            if (pay.recordset[0].n > 0) {
                return badRequest('Invoice has recorded payments — remove them first', request);
            }
            // Unlink any AFP matched to this invoice (status returns to Certified)
            await query(
                `UPDATE Applications SET invoice_id = NULL,
                    status = CASE WHEN status = 'Invoiced' THEN 'Certified' ELSE status END,
                    updated_at = GETUTCDATE()
                 WHERE invoice_id = @id`, { id });
            await query('DELETE FROM InvoiceLineItems WHERE invoice_id = @id', { id });
            await logChange('invoice', id, inv.ref || ('INV#' + id), 'hard_delete',
                inv.status, null, auth.name || auth.email);
            await query('DELETE FROM Invoices WHERE id = @id', { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('Error deleting invoice:', err);
            return serverError('Failed to delete invoice: ' + err.message, request);
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
            const prev = await query('SELECT ref, status FROM Invoices WHERE id = @id', { id });
            await query(
                `UPDATE Invoices SET
                    status            = 'Void',
                    voided_at         = GETUTCDATE(),
                    total_outstanding = 0,
                    updated_at        = GETUTCDATE()
                 WHERE id = @id`,
                { id }
            );
            const p = prev.recordset[0] || {};
            await logChange('invoice', id, p.ref || ('INV#' + id), 'voided',
                p.status || null, 'Void', auth.name || auth.email);
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
