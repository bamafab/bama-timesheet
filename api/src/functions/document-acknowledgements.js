// document-acknowledgements.js (Read-and-sign module, 2026-08-01)
// Records that someone opened an ERP-produced document on their phone and
// signed it: RAMS (legal "read & understood") or SDN/DN (goods-received).
// The signature image is stored on the row and embedded in any generated
// register PDF, but is NEVER returned by the list endpoint (keeps responses
// small and avoids shipping signatures around). Audited via ChangeLog.
const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, serverError, preflight } = require('../responses');

app.http('doc-ack-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous', route: 'acknowledgements/{*rest}',
    handler: async (req) => preflight(req)
});

// GET /api/acknowledgements?project_number=X  or  ?doc_file_id=Y
// Returns rows WITHOUT the signature blob (signed=1/0 flag instead).
app.http('doc-ack-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'acknowledgements',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const u = new URL(request.url);
            const proj = u.searchParams.get('project_number');
            const docId = u.searchParams.get('doc_file_id');
            const params = {};
            let where = 'is_deleted = 0';
            if (proj)  { where += ' AND project_number = @proj'; params.proj = proj; }
            if (docId) { where += ' AND doc_file_id = @docId'; params.docId = docId; }
            const res = await query(
                `SELECT TOP 500 id, doc_type, doc_ref, doc_file_id, doc_web_url, project_number,
                        job_id, signer_name, signer_company, statement,
                        CASE WHEN signature IS NULL THEN 0 ELSE 1 END AS signed,
                        acknowledged_at, acknowledged_by, register_web_url, notes, created_at
                 FROM DocumentAcknowledgements WHERE ${where}
                 ORDER BY acknowledged_at DESC`, params);
            return ok(res.recordset, request);
        } catch (err) { context.error(err); return serverError('Failed to load acknowledgements', request); }
    }
});

// POST /api/acknowledgements  — record one signature/acknowledgement.
app.http('doc-ack-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'acknowledgements',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.doc_type || !b.signer_name) return badRequest('doc_type and signer_name are required', request);
            const dt = String(b.doc_type).toLowerCase();
            if (!['rams', 'sdn', 'dn'].includes(dt)) return badRequest('doc_type must be rams, sdn or dn', request);
            const res = await query(
                `INSERT INTO DocumentAcknowledgements
                    (doc_type, doc_ref, doc_file_id, doc_web_url, project_number, job_id,
                     signer_name, signer_company, statement, signature, acknowledged_by,
                     register_file_id, register_web_url, notes)
                 OUTPUT INSERTED.id
                 VALUES (@doc_type, @doc_ref, @doc_file_id, @doc_web_url, @project_number, @job_id,
                     @signer_name, @signer_company, @statement, @signature, @by,
                     @register_file_id, @register_web_url, @notes)`,
                {
                    doc_type: dt,
                    doc_ref: b.doc_ref ? String(b.doc_ref).slice(0, 200) : null,
                    doc_file_id: b.doc_file_id || null,
                    doc_web_url: b.doc_web_url ? String(b.doc_web_url).slice(0, 1000) : null,
                    project_number: b.project_number ? String(b.project_number).slice(0, 60) : null,
                    job_id: b.job_id ? parseInt(b.job_id) : null,
                    signer_name: String(b.signer_name).slice(0, 160),
                    signer_company: b.signer_company ? String(b.signer_company).slice(0, 160) : null,
                    statement: b.statement ? String(b.statement).slice(0, 500) : null,
                    signature: b.signature || null,   // base64 PNG data URI
                    by: auth.name || auth.email || null,
                    register_file_id: b.register_file_id || null,
                    register_web_url: b.register_web_url ? String(b.register_web_url).slice(0, 1000) : null,
                    notes: b.notes ? String(b.notes).slice(0, 1000) : null
                });
            const id = res.recordset[0].id;
            await logChange('doc_acknowledgement', id, b.doc_ref || dt, 'acknowledged',
                null, `${b.signer_name} signed ${dt.toUpperCase()}`, auth.name || auth.email);
            return created({ id }, request);
        } catch (err) { context.error(err); return serverError('Failed to record acknowledgement', request); }
    }
});

// GET /api/acknowledgements/{id}/signature — fetch a single signature image
// (only when building the register PDF; not used by the list view).
app.http('doc-ack-signature', {
    methods: ['GET'], authLevel: 'anonymous', route: 'acknowledgements/{id}/signature',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const res = await query(`SELECT signature FROM DocumentAcknowledgements WHERE id = @id AND is_deleted = 0`, { id });
            return ok({ signature: res.recordset[0] ? res.recordset[0].signature : null }, request);
        } catch (err) { context.error(err); return serverError('Failed to load signature', request); }
    }
});

// DELETE /api/acknowledgements/{id} — soft delete (mistakes happen).
app.http('doc-ack-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'acknowledgements/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            await query(`UPDATE DocumentAcknowledgements SET is_deleted = 1 WHERE id = @id`, { id });
            await logChange('doc_acknowledgement', id, null, 'deleted', null, null, auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) { context.error(err); return serverError('Failed to delete', request); }
    }
});
