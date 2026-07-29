// ─────────────────────────────────────────────────────────────────────────────
// company-documents.js  (D1 — Company Document Library, 2026-07-29)
//
// Register of company-level documents (insurances, policies, accreditations,
// H&S) with expiry tracking. Files live in SharePoint under
// BAMA / 01 - Company Management — the FRONTEND uploads via Graph
// (user delegated token) and stores the resulting file metadata here.
// This API is metadata + reminder logic only; it never touches Graph.
//
// Routes:
//   GET    /api/company-documents            — active docs; ?all=true incl. archived
//   GET    /api/company-documents/expiring   — expired + inside reminder window
//   POST   /api/company-documents            — create
//   PUT    /api/company-documents/{id}       — update metadata / archive / unarchive
//   DELETE /api/company-documents/{id}       — soft-delete
//
// ChangeLog convention (F6): archive / unarchive / soft-delete are audited
// via logChange — non-fatal by design.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const CATEGORIES = ['insurance', 'policy', 'accreditation', 'coshh', 'ra_ssow', 'hs', 'other'];

const SELECT_COLS = `id, category, title, doc_ref, issuer,
    CONVERT(varchar(10), issue_date, 23)  AS issue_date,
    CONVERT(varchar(10), expiry_date, 23) AS expiry_date,
    reminder_days, file_name, sharepoint_file_id, drive_id, web_url, notes,
    is_archived, superseded_by, uploaded_by, created_at, updated_at`;

// ── OPTIONS preflight ────────────────────────────────────────────────────────
app.http('company-documents-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'company-documents/{*rest}',
    handler: async (req) => preflight(req)
});

// ── GET /api/company-documents ───────────────────────────────────────────────
app.http('company-documents-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'company-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const showAll = new URL(request.url).searchParams.get('all') === 'true';
            const res = await query(
                `SELECT ${SELECT_COLS}
                 FROM CompanyDocuments
                 WHERE is_deleted = 0 ${showAll ? '' : 'AND is_archived = 0'}
                 ORDER BY category, CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date`
            );
            return ok(res.recordset, request);
        } catch (err) {
            context.error('company-documents list error:', err);
            return serverError('Failed to load company documents', request);
        }
    }
});

// ── GET /api/company-documents/expiring ──────────────────────────────────────
// Active (not archived, not deleted) docs that are expired OR inside their
// own reminder_days window. Powers the ED alert strip — kept as a single
// cheap query so it can run on every dashboard load.
app.http('company-documents-expiring', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'company-documents/expiring',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT ${SELECT_COLS},
                        DATEDIFF(day, CAST(GETUTCDATE() AS date), expiry_date) AS days_left
                 FROM CompanyDocuments
                 WHERE is_deleted = 0 AND is_archived = 0
                   AND expiry_date IS NOT NULL
                   AND DATEDIFF(day, CAST(GETUTCDATE() AS date), expiry_date) <= reminder_days
                 ORDER BY expiry_date`
            );
            return ok(res.recordset, request);
        } catch (err) {
            context.error('company-documents expiring error:', err);
            return serverError('Failed to load expiring documents', request);
        }
    }
});

// ── POST /api/company-documents ──────────────────────────────────────────────
app.http('company-documents-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'company-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.title || !String(b.title).trim()) return badRequest('title is required', request);
            const category = CATEGORIES.includes(b.category) ? b.category : 'other';
            const res = await query(
                `INSERT INTO CompanyDocuments
                    (category, title, doc_ref, issuer, issue_date, expiry_date, reminder_days,
                     file_name, sharepoint_file_id, drive_id, web_url, notes, uploaded_by)
                 OUTPUT INSERTED.id
                 VALUES (@category, @title, @doc_ref, @issuer, @issue_date, @expiry_date, @reminder_days,
                         @file_name, @sharepoint_file_id, @drive_id, @web_url, @notes, @uploaded_by)`,
                {
                    category,
                    title:              String(b.title).trim().slice(0, 200),
                    doc_ref:            b.doc_ref            || null,
                    issuer:             b.issuer             || null,
                    issue_date:         b.issue_date         || null,
                    expiry_date:        b.expiry_date        || null,
                    reminder_days:      Number.isFinite(+b.reminder_days) ? Math.max(0, +b.reminder_days) : 60,
                    file_name:          b.file_name          || null,
                    sharepoint_file_id: b.sharepoint_file_id || null,
                    drive_id:           b.drive_id           || null,
                    web_url:            b.web_url            || null,
                    notes:              b.notes              || null,
                    uploaded_by:        auth.name || auth.email || null
                }
            );
            const id = res.recordset[0].id;
            return created({ id }, request);
        } catch (err) {
            context.error('company-documents create error:', err);
            return serverError('Failed to create document', request);
        }
    }
});

// ── PUT /api/company-documents/{id} ──────────────────────────────────────────
// Partial update: only fields present in the body are written.
// is_archived / superseded_by transitions are audited via logChange.
app.http('company-documents-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'company-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(
                `SELECT id, title, is_archived FROM CompanyDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const sets = [];
            const params = { id };
            const map = {
                category: v => CATEGORIES.includes(v) ? v : 'other',
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
            for (const [field, coerce] of Object.entries(map)) {
                if (field in b) { sets.push(`${field} = @${field}`); params[field] = coerce(b[field]); }
            }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');

            await query(`UPDATE CompanyDocuments SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('is_archived' in b && (b.is_archived ? 1 : 0) !== before.is_archived) {
                await logChange('company_document', id, before.title,
                    b.is_archived ? 'archived' : 'unarchived',
                    before.is_archived ? 'archived' : 'active',
                    b.is_archived ? 'archived' : 'active',
                    auth.name || auth.email);
            }
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('company-documents update error:', err);
            return serverError('Failed to update document', request);
        }
    }
});

// ── DELETE /api/company-documents/{id} ───────────────────────────────────────
// Soft delete (reversible in SQL). The SharePoint file is left in place.
app.http('company-documents-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'company-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(
                `SELECT id, title FROM CompanyDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);

            await query(
                `UPDATE CompanyDocuments SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            await logChange('company_document', id, cur.recordset[0].title,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('company-documents delete error:', err);
            return serverError('Failed to delete document', request);
        }
    }
});
