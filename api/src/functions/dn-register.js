// ─────────────────────────────────────────────────────────────────────────────
// dn-register.js — deliveries register (supplier DNs + site SDNs)
//
// One durable row per generated note, written by the frontend right after the
// PDF upload (non-fatal there — the note itself is already filed). Multi-job
// notes carry a job_ids JSON array so they list on every covered job's Site
// Installation. Supplier DNs had no ledger before this: refs stamped on the
// item rows are overwritten by later shipments, so this table is the only
// durable "when was DN-0042 sent, and where's the PDF" record.
//
// Routes (flat):
//   GET  /api/dn-register?projectId=X   — register rows, newest first
//   POST /api/dn-register               — insert one row (idempotent on ref:
//        a duplicate ref returns the existing row instead of erroring, so a
//        retry after a flaky response can't double-register)
//
// Table: DeliveryNoteRegister (api/sql/create-delivery-note-register.sql).
// NEW TABLE => no Function App restart needed.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, serverError, preflight } = require('../responses');

app.http('dn-register-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'dn-register',
    handler: async (req) => preflight(req)
});

// ── GET /api/dn-register?projectId=X ─────────────────────────────────────────
app.http('dn-register-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'dn-register',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(new URL(request.url).searchParams.get('projectId'));
            if (!projectId) return badRequest('projectId is required', request);
            const rows = await query(
                `SELECT id, ref, kind, project_id, job_ids, destination, line_count, total_qty,
                        sharepoint_web_url, file_name, created_at, created_by
                 FROM DeliveryNoteRegister
                 WHERE project_id = @projectId
                 ORDER BY created_at DESC`,
                { projectId }
            );
            return ok(rows.recordset, request);
        } catch (e) {
            context.error('dn-register-list', e);
            return serverError(e.message, request);
        }
    }
});

// ── POST /api/dn-register ────────────────────────────────────────────────────
app.http('dn-register-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'dn-register',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const ref = (b.ref || '').trim();
            const kind = (b.kind || '').trim();
            if (!ref) return badRequest('ref is required', request);
            if (!['supplier', 'site'].includes(kind))
                return badRequest("kind must be 'supplier' or 'site'", request);
            const projectId = parseInt(b.project_id) || null;
            const jobIds = Array.isArray(b.job_ids) ? b.job_ids.map(Number).filter(Boolean) : [];

            // Idempotent on ref — a retried POST returns the existing row.
            const existing = await query(
                `SELECT id, ref FROM DeliveryNoteRegister WHERE ref = @ref`, { ref });
            if (existing.recordset.length)
                return ok({ ...existing.recordset[0], duplicate: true }, request);

            const ins = await query(
                `INSERT INTO DeliveryNoteRegister
                   (ref, kind, project_id, job_ids, destination, line_count, total_qty,
                    sharepoint_file_id, sharepoint_drive_id, sharepoint_web_url, file_name, created_by)
                 OUTPUT INSERTED.id, INSERTED.created_at
                 VALUES
                   (@ref, @kind, @projectId, @jobIds, @destination, @lineCount, @totalQty,
                    @spFileId, @spDriveId, @spWebUrl, @fileName, @createdBy)`,
                {
                    ref, kind, projectId,
                    jobIds: JSON.stringify(jobIds),
                    destination: b.destination || null,
                    lineCount: parseInt(b.line_count) || null,
                    totalQty: parseInt(b.total_qty) || null,
                    spFileId: b.sharepoint_file_id || null,
                    spDriveId: b.sharepoint_drive_id || null,
                    spWebUrl: b.sharepoint_web_url || null,
                    fileName: b.file_name || null,
                    createdBy: b.created_by || auth.name || auth.email || null
                });
            return created({ id: ins.recordset[0].id, ref, created_at: ins.recordset[0].created_at }, request);
        } catch (e) {
            context.error('dn-register-create', e);
            return serverError(e.message, request);
        }
    }
});
