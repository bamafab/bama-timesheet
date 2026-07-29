// ─────────────────────────────────────────────────────────────────────────────
// supplier-documents.js  (D2 — Supplier records, 2026-07-30)
//
// Per-supplier document register (insurances, quality certs, CIS letters)
// with expiry tracking + supplier approval status (FPC s9). Files upload
// browser→Graph into BAMA / 04 - Suppliers & Subcontractors / <Supplier>;
// this API is metadata + reminder logic only. Mirrors company-documents.js.
//
// Routes:
//   GET    /api/supplier-documents                — all active (?supplier_id= filter, ?all=true incl. archived)
//   GET    /api/supplier-documents/expiring       — expired + inside reminder window
//   POST   /api/supplier-documents                — create
//   PUT    /api/supplier-documents/{id}           — partial update / archive / unarchive (audited)
//   DELETE /api/supplier-documents/{id}           — soft delete (audited)
//   PUT    /api/supplier-approval/{id}            — set approval_status / review date on Suppliers (audited)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const DOC_TYPES = ['insurance_el', 'insurance_pl', 'insurance_pi', 'quality', 'cis', 'hs', 'other'];
const APPROVAL_STATES = ['unapproved', 'approved', 'conditional', 'suspended'];

const SELECT_COLS = `id, supplier_id, doc_type, title, doc_ref, issuer,
    CONVERT(varchar(10), issue_date, 23)  AS issue_date,
    CONVERT(varchar(10), expiry_date, 23) AS expiry_date,
    reminder_days, file_name, sharepoint_file_id, drive_id, web_url, notes,
    is_archived, superseded_by, uploaded_by, created_at, updated_at`;

app.http('supplier-documents-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'supplier-documents/{*rest}',
    handler: async (req) => preflight(req)
});
app.http('supplier-approval-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'supplier-approval/{*rest}',
    handler: async (req) => preflight(req)
});

// ── GET list ─────────────────────────────────────────────────────────────────
app.http('supplier-documents-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'supplier-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const showAll = sp.get('all') === 'true';
            const supplierId = parseInt(sp.get('supplier_id'));
            const params = {};
            let where = 'is_deleted = 0' + (showAll ? '' : ' AND is_archived = 0');
            if (Number.isFinite(supplierId)) { where += ' AND supplier_id = @supplierId'; params.supplierId = supplierId; }
            const res = await query(
                `SELECT ${SELECT_COLS} FROM SupplierDocuments WHERE ${where}
                 ORDER BY supplier_id, CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('supplier-documents list error:', err);
            return serverError('Failed to load supplier documents', request);
        }
    }
});

// ── GET expiring ─────────────────────────────────────────────────────────────
app.http('supplier-documents-expiring', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'supplier-documents/expiring',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT d.id, d.supplier_id, d.doc_type, d.title,
                        CONVERT(varchar(10), d.expiry_date, 23) AS expiry_date,
                        d.reminder_days, s.supplier_name,
                        DATEDIFF(day, CAST(GETUTCDATE() AS date), d.expiry_date) AS days_left
                 FROM SupplierDocuments d
                 JOIN Suppliers s ON s.id = d.supplier_id
                 WHERE d.is_deleted = 0 AND d.is_archived = 0
                   AND d.expiry_date IS NOT NULL
                   AND DATEDIFF(day, CAST(GETUTCDATE() AS date), d.expiry_date) <= d.reminder_days
                 ORDER BY d.expiry_date`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('supplier-documents expiring error:', err);
            return serverError('Failed to load expiring supplier documents', request);
        }
    }
});

// ── POST create ──────────────────────────────────────────────────────────────
app.http('supplier-documents-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'supplier-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const supplierId = parseInt(b.supplier_id);
            if (!Number.isFinite(supplierId)) return badRequest('supplier_id is required', request);
            if (!b.title || !String(b.title).trim()) return badRequest('title is required', request);
            const res = await query(
                `INSERT INTO SupplierDocuments
                    (supplier_id, doc_type, title, doc_ref, issuer, issue_date, expiry_date, reminder_days,
                     file_name, sharepoint_file_id, drive_id, web_url, notes, uploaded_by)
                 OUTPUT INSERTED.id
                 VALUES (@supplier_id, @doc_type, @title, @doc_ref, @issuer, @issue_date, @expiry_date, @reminder_days,
                         @file_name, @sharepoint_file_id, @drive_id, @web_url, @notes, @uploaded_by)`,
                {
                    supplier_id: supplierId,
                    doc_type: DOC_TYPES.includes(b.doc_type) ? b.doc_type : 'other',
                    title: String(b.title).trim().slice(0, 200),
                    doc_ref: b.doc_ref || null, issuer: b.issuer || null,
                    issue_date: b.issue_date || null, expiry_date: b.expiry_date || null,
                    reminder_days: Number.isFinite(+b.reminder_days) ? Math.max(0, +b.reminder_days) : 60,
                    file_name: b.file_name || null, sharepoint_file_id: b.sharepoint_file_id || null,
                    drive_id: b.drive_id || null, web_url: b.web_url || null,
                    notes: b.notes || null,
                    uploaded_by: auth.name || auth.email || null
                });
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('supplier-documents create error:', err);
            return serverError('Failed to create supplier document', request);
        }
    }
});

// ── PUT update (partial; archive transitions audited) ───────────────────────
app.http('supplier-documents-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'supplier-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(`SELECT id, title, is_archived FROM SupplierDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const sets = []; const params = { id };
            const map = {
                doc_type: v => DOC_TYPES.includes(v) ? v : 'other',
                title: v => String(v || '').trim().slice(0, 200) || before.title,
                doc_ref: v => v || null, issuer: v => v || null,
                issue_date: v => v || null, expiry_date: v => v || null,
                reminder_days: v => Number.isFinite(+v) ? Math.max(0, +v) : 60,
                file_name: v => v || null, sharepoint_file_id: v => v || null,
                drive_id: v => v || null, web_url: v => v || null,
                notes: v => v || null,
                is_archived: v => v ? 1 : 0,
                superseded_by: v => Number.isFinite(+v) ? +v : null
            };
            for (const [field, coerce] of Object.entries(map))
                if (field in b) { sets.push(`${field} = @${field}`); params[field] = coerce(b[field]); }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE SupplierDocuments SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('is_archived' in b && (b.is_archived ? 1 : 0) !== before.is_archived) {
                await logChange('supplier_document', id, before.title,
                    b.is_archived ? 'archived' : 'unarchived',
                    before.is_archived ? 'archived' : 'active',
                    b.is_archived ? 'archived' : 'active',
                    auth.name || auth.email);
            }
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('supplier-documents update error:', err);
            return serverError('Failed to update supplier document', request);
        }
    }
});

// ── DELETE (soft) ────────────────────────────────────────────────────────────
app.http('supplier-documents-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'supplier-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(`SELECT id, title FROM SupplierDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);
            await query(`UPDATE SupplierDocuments SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            await logChange('supplier_document', id, cur.recordset[0].title,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('supplier-documents delete error:', err);
            return serverError('Failed to delete supplier document', request);
        }
    }
});

// ── PUT /api/supplier-approval/{id} — FPC approval status ───────────────────
app.http('supplier-approval-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'supplier-approval/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid supplier id', request);
            const cur = await query(`SELECT id, supplier_name, approval_status FROM Suppliers WHERE id = @id`, { id });
            if (!cur.recordset.length) return notFound('Supplier not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const status = APPROVAL_STATES.includes(b.approval_status) ? b.approval_status : null;
            if (!status) return badRequest(`approval_status must be one of: ${APPROVAL_STATES.join(', ')}`, request);

            await query(
                `UPDATE Suppliers SET approval_status = @status,
                        approval_review_due = @review_due,
                        approved_by = @by, approved_at = SYSUTCDATETIME()
                 WHERE id = @id`,
                { id, status, review_due: b.approval_review_due || null, by: auth.name || auth.email || null });

            if (status !== (before.approval_status || 'unapproved')) {
                await logChange('supplier', id, before.supplier_name,
                    'approval_change', before.approval_status || 'unapproved', status,
                    auth.name || auth.email);
            }
            return ok({ id, approval_status: status }, request);
        } catch (err) {
            context.error('supplier-approval error:', err);
            return serverError('Failed to update supplier approval', request);
        }
    }
});
