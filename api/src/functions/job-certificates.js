// ─────────────────────────────────────────────────────────────────────────────
// job-certificates.js  (F1b, 2026-07-30)
//
// Register of issued Certificates of Conformity and Declarations of Performance.
// `payload` is a frozen snapshot of the figures each certificate was issued on —
// NDT extent achieved, heat numbers, drawing revisions — because those move on
// afterwards and a re-render would no longer match the paper the client holds.
// Re-issuing therefore creates a NEW revision and supersedes the old one; it
// never edits an issued certificate in place.
//
// Routes:
//   GET    /api/job-certificates          — ?job_id= &doc_type=
//   POST   /api/job-certificates          — issue (auto-increments revision)
//   PUT    /api/job-certificates/{id}     — file refs / notes / status only
//   DELETE /api/job-certificates/{id}     — soft delete (audited)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const DOC_TYPES = ['coc', 'dop'];
const COLS = `id, job_id, doc_type, cert_ref, revision,
    CONVERT(varchar(10), issue_date, 23) AS issue_date,
    issued_by, exec_class, scope_text, payload, status, superseded_by,
    file_name, sharepoint_file_id, drive_id, web_url, notes, created_at, updated_at`;

app.http('job-certificates-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'job-certificates/{*rest}', handler: async (req) => preflight(req)
});

app.http('job-certificates-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'job-certificates',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const jobId = parseInt(sp.get('job_id')), type = sp.get('doc_type');
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(jobId))     { where += ' AND job_id = @jid';  params.jid = jobId; }
            if (DOC_TYPES.includes(type))   { where += ' AND doc_type = @dt'; params.dt = type; }
            const res = await query(
                `SELECT ${COLS} FROM JobCertificates WHERE ${where} ORDER BY job_id, doc_type, revision DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('job-certificates list error:', err);
            return serverError('Failed to load issued certificates', request);
        }
    }
});

app.http('job-certificates-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'job-certificates',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const jobId = parseInt(b.job_id);
            if (!Number.isFinite(jobId))          return badRequest('job_id is required', request);
            if (!DOC_TYPES.includes(b.doc_type))  return badRequest("doc_type must be 'coc' or 'dop'", request);
            if (!b.cert_ref || !String(b.cert_ref).trim()) return badRequest('cert_ref is required', request);

            // Revision continues the sequence for this job + document type, and the
            // previous one is superseded rather than overwritten.
            const prev = await query(
                `SELECT TOP 1 id, revision FROM JobCertificates
                 WHERE job_id = @jid AND doc_type = @dt AND is_deleted = 0
                 ORDER BY revision DESC`, { jid: jobId, dt: b.doc_type });
            const revision = prev.recordset.length ? Number(prev.recordset[0].revision) + 1 : 1;

            const res = await query(
                `INSERT INTO JobCertificates
                   (job_id, doc_type, cert_ref, revision, issue_date, issued_by, exec_class,
                    scope_text, payload, status, file_name, sharepoint_file_id, drive_id, web_url, notes)
                 OUTPUT INSERTED.id
                 VALUES (@jid, @dt, @ref, @rev, @date, @by, @ec, @scope, @payload, @status,
                         @fn, @spid, @drv, @url, @notes)`,
                {
                    jid: jobId, dt: b.doc_type,
                    ref: String(b.cert_ref).trim().slice(0, 80), rev: revision,
                    date: b.issue_date || new Date().toISOString().slice(0, 10),
                    by: b.issued_by || auth.name || auth.email || null,
                    ec: b.exec_class || null,
                    scope: b.scope_text || null,
                    payload: b.payload ? (typeof b.payload === 'string' ? b.payload : JSON.stringify(b.payload)) : null,
                    status: ['draft', 'issued'].includes(b.status) ? b.status : 'issued',
                    fn: b.file_name || null, spid: b.sharepoint_file_id || null,
                    drv: b.drive_id || null, url: b.web_url || null, notes: b.notes || null
                });
            const id = res.recordset[0].id;
            if (prev.recordset.length) {
                await query(
                    `UPDATE JobCertificates SET status = 'superseded', superseded_by = @new, updated_at = SYSUTCDATETIME()
                     WHERE id = @old`, { new: id, old: prev.recordset[0].id });
            }
            await logChange('job_certificate', id, `${b.doc_type.toUpperCase()} ${b.cert_ref} rev ${revision}`,
                'issued', prev.recordset.length ? `rev ${prev.recordset[0].revision}` : null,
                `rev ${revision}`, auth.name || auth.email);
            return created({ id, revision }, request);
        } catch (err) {
            context.error('job-certificates create error:', err);
            return serverError('Failed to record the certificate', request);
        }
    }
});

// Only file references, notes and status are editable. The certified FIGURES
// are frozen — to change those you issue a new revision.
app.http('job-certificates-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'job-certificates/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid certificate id', request);
            const cur = await query(
                `SELECT id, cert_ref, revision, status FROM JobCertificates WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Certificate not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const allowed = {
                file_name: v => v || null, sharepoint_file_id: v => v || null,
                drive_id: v => v || null, web_url: v => v || null,
                notes: v => v || null,
                status: v => ['draft', 'issued', 'superseded'].includes(v) ? v : before.status
            };
            const sets = []; const params = { id };
            for (const [f, coerce] of Object.entries(allowed))
                if (f in b) { sets.push(`${f} = @${f}`); params[f] = coerce(b[f]); }
            if (!sets.length) return badRequest('No editable fields supplied — certified figures are frozen; issue a new revision instead', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE JobCertificates SET ${sets.join(', ')} WHERE id = @id`, params);
            if ('status' in b && b.status !== before.status)
                await logChange('job_certificate', id, `${before.cert_ref} rev ${before.revision}`,
                    'status_change', before.status, b.status, auth.name || auth.email);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('job-certificates update error:', err);
            return serverError('Failed to update the certificate', request);
        }
    }
});

app.http('job-certificates-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'job-certificates/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid certificate id', request);
            const cur = await query(
                `SELECT id, cert_ref, revision, doc_type FROM JobCertificates WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Certificate not found', request);
            await query(`UPDATE JobCertificates SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            const c = cur.recordset[0];
            await logChange('job_certificate', id, `${c.doc_type.toUpperCase()} ${c.cert_ref} rev ${c.revision}`,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('job-certificates delete error:', err);
            return serverError('Failed to delete the certificate', request);
        }
    }
});
