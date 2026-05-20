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

            let where = [];
            const params = {};
            if (projectId) { where.push('a.project_id = @projectId'); params.projectId = parseInt(projectId); }
            if (status)    { where.push('a.status = @status'); params.status = status; }
            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const result = await query(
                `SELECT a.*, p.project_number, p.project_name, p.client_id
                 FROM Applications a
                 LEFT JOIN Projects p ON a.project_id = p.id
                 ${whereClause}
                 ORDER BY a.created_at DESC`,
                params
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error listing AFPs:', err);
            return serverError('Failed to list applications', request);
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
                `SELECT a.*, p.project_number, p.project_name, p.client_id
                 FROM Applications a
                 LEFT JOIN Projects p ON a.project_id = p.id
                 WHERE a.id = @id`,
                { id }
            );
            if (!appRes.recordset.length) return notFound('Application not found', request);
            const linesRes = await query(
                `SELECT * FROM ApplicationLineItems WHERE application_id = @id ORDER BY line_no`,
                { id }
            );
            return ok({ ...appRes.recordset[0], line_items: linesRes.recordset }, request);
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
        // Full create logic lands in Commit 3 (AFP lifecycle). For Commit 1
        // we return 501 so the UI can still render its placeholder tab.
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('applications-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'applications/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('applications-submit', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/submit',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('applications-certificate-upload', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/certificate',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('applications-certificate-confirm', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'applications/{id}/certificate',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('applications-generate-invoice', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'applications/{id}/generate-invoice',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('applications-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'applications/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 3)', headers: { 'Content-Type': 'text/plain' } };
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
    route: 'invoices/next-ref',
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
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('invoices-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'invoices/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('invoices-issue', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/issue',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('invoices-payment-add', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/payments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('invoices-payment-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/payments/{pid}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('invoices-void', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'invoices/{id}/void',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
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
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('receipts-parse', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'receipts/parse',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('receipts-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'receipts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

app.http('receipts-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'receipts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        return { status: 501, body: 'Not implemented yet (lands in Commit 2)', headers: { 'Content-Type': 'text/plain' } };
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Supplier invoice attach (PO extension) — preflight only here.
// PUT/POST handlers live in purchase-orders.js Commit 2 update.
// ─────────────────────────────────────────────────────────────────────────────

app.http('po-supplier-invoice-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'purchase-orders/{id}/supplier-invoice/{*path}',
    handler: async (request) => preflight(request)
});

module.exports = { nextInvoiceRef, nextAfpRef, formatInvoiceRef, formatAfpRef };
