// ─────────────────────────────────────────────────────────────────────────────
// employee-documents.js  (D3 — Employee documents, 2026-07-30)
//
// Per-employee document register (contracts, right-to-work, certs, reviews)
// with expiry tracking. Files upload browser→Graph into
// BAMA / 03 - Employees / <Employee Name>; this API is metadata + reminder
// logic only. Mirrors company-documents.js / supplier-documents.js.
//
// Routes:
//   GET    /api/employee-documents                — all active (?employee= filter, ?all=true incl. archived)
//   GET    /api/employee-documents/expiring       — expired + inside reminder window
//   POST   /api/employee-documents                — create
//   PUT    /api/employee-documents/{id}           — partial update / archive / unarchive (audited)
//   DELETE /api/employee-documents/{id}           — soft delete (audited)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const DOC_TYPES = ['contract', 'rtw', 'cert', 'review', 'hs', 'other'];

const SELECT_COLS = `id, employee_name, employee_ref, doc_type, title, doc_ref, issuer,
    CONVERT(varchar(10), issue_date, 23)  AS issue_date,
    CONVERT(varchar(10), expiry_date, 23) AS expiry_date,
    reminder_days, file_name, sharepoint_file_id, drive_id, web_url, notes,
    is_archived, superseded_by, uploaded_by, created_at, updated_at`;

app.http('employee-documents-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'employee-documents/{*rest}',
    handler: async (req) => preflight(req)
});

// ── GET list ─────────────────────────────────────────────────────────────────
app.http('employee-documents-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'employee-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const showAll = sp.get('all') === 'true';
            const emp = sp.get('employee');
            const params = {};
            let where = 'is_deleted = 0' + (showAll ? '' : ' AND is_archived = 0');
            if (emp) { where += ' AND employee_name = @emp'; params.emp = emp; }
            const res = await query(
                `SELECT ${SELECT_COLS} FROM EmployeeDocuments WHERE ${where}
                 ORDER BY employee_name, CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('employee-documents list error:', err);
            return serverError('Failed to load employee documents', request);
        }
    }
});

// ── GET expiring ─────────────────────────────────────────────────────────────
app.http('employee-documents-expiring', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'employee-documents/expiring',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT d.id, d.employee_name, d.doc_type, d.title,
                        CONVERT(varchar(10), d.expiry_date, 23) AS expiry_date,
                        d.reminder_days,
                        DATEDIFF(day, CAST(GETUTCDATE() AS date), d.expiry_date) AS days_left
                 FROM EmployeeDocuments d
                 WHERE d.is_deleted = 0 AND d.is_archived = 0
                   AND d.expiry_date IS NOT NULL
                   AND DATEDIFF(day, CAST(GETUTCDATE() AS date), d.expiry_date) <= d.reminder_days
                 ORDER BY d.expiry_date`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('employee-documents expiring error:', err);
            return serverError('Failed to load expiring employee documents', request);
        }
    }
});

// ── POST create ──────────────────────────────────────────────────────────────
app.http('employee-documents-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'employee-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.employee_name || !String(b.employee_name).trim()) return badRequest('employee_name is required', request);
            if (!b.title || !String(b.title).trim()) return badRequest('title is required', request);
            const res = await query(
                `INSERT INTO EmployeeDocuments
                    (employee_name, employee_ref, doc_type, title, doc_ref, issuer, issue_date, expiry_date, reminder_days,
                     file_name, sharepoint_file_id, drive_id, web_url, notes, uploaded_by)
                 OUTPUT INSERTED.id
                 VALUES (@employee_name, @employee_ref, @doc_type, @title, @doc_ref, @issuer, @issue_date, @expiry_date, @reminder_days,
                         @file_name, @sharepoint_file_id, @drive_id, @web_url, @notes, @uploaded_by)`,
                {
                    employee_name: String(b.employee_name).trim().slice(0, 120),
                    employee_ref: b.employee_ref != null ? String(b.employee_ref).slice(0, 60) : null,
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
            context.error('employee-documents create error:', err);
            return serverError('Failed to create employee document', request);
        }
    }
});

// ── PUT update (partial; archive transitions audited) ───────────────────────
app.http('employee-documents-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'employee-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(`SELECT id, title, is_archived FROM EmployeeDocuments WHERE id = @id AND is_deleted = 0`, { id });
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
            await query(`UPDATE EmployeeDocuments SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('is_archived' in b && (b.is_archived ? 1 : 0) !== before.is_archived) {
                await logChange('employee_document', id, before.title,
                    b.is_archived ? 'archived' : 'unarchived',
                    before.is_archived ? 'archived' : 'active',
                    b.is_archived ? 'archived' : 'active',
                    auth.name || auth.email);
            }
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('employee-documents update error:', err);
            return serverError('Failed to update employee document', request);
        }
    }
});

// ── DELETE (soft) ────────────────────────────────────────────────────────────
app.http('employee-documents-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'employee-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(`SELECT id, title FROM EmployeeDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);
            await query(`UPDATE EmployeeDocuments SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            await logChange('employee_document', id, cur.recordset[0].title,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('employee-documents delete error:', err);
            return serverError('Failed to delete employee document', request);
        }
    }
});

