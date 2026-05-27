// Job BOM Items API — backs the new unified BOM/despatch queue.
//
// See docs/SPEC-job-fabrication-rework.md §6, §10.
//
// Endpoints:
//   GET    /api/job-bom-items?job_id=X       list rows + supplier/finish names
//   POST   /api/job-bom-items                create one row (rarely used; bulk preferred)
//   POST   /api/job-bom-items/bulk           create N rows sharing one source file
//   PUT    /api/job-bom-items/:id            edit description/quantity/finish
//   PUT    /api/job-bom-items/:id/status     advance state machine
//   DELETE /api/job-bom-items/:id            delete (any status)
//
// Out of scope for this file (commit 10):
//   POST   /api/job-bom-items/generate-dn    body: { item_ids:[…], supplier_id }

const { app } = require('@azure/functions');
const { query, getPool, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError } = require('../responses');

const ALLOWED_STATUS = ['pending', 'at_supplier', 'ready_for_despatch', 'despatched'];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/job-bom-items?job_id=X
// Returns BOM rows for a job. Joins finish and supplier names so the
// frontend doesn't need extra round-trips for display.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'job-bom-items',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const jobId = parseInt(url.searchParams.get('job_id'));
            if (!jobId || isNaN(jobId)) return badRequest('job_id is required', request);

            const res = await query(
                `SELECT b.*,
                        st.name AS finish_name,
                        s.supplier_name AS supplier_name,
                        a.assembly_mark AS source_assembly_mark
                 FROM JobBomItems b
                 LEFT JOIN ServiceTypes  st ON st.id = b.finish_service_id
                 LEFT JOIN Suppliers     s  ON s.id = b.supplier_id
                 LEFT JOIN JobAssemblies a  ON a.id = b.source_assembly_id
                 WHERE b.job_id = @jobId
                 ORDER BY b.created_at ASC, b.id ASC`,
                { jobId }
            );

            return ok(res.recordset, request);
        } catch (err) {
            context.error('Error listing BOM items:', err);
            return serverError('Failed to list BOM items', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items
// Body: { job_id, description, quantity, finish_service_id?,
//         sharepoint_file_id?, sharepoint_drive_id?, sharepoint_web_url?,
//         file_name? }
// Creates one row. source='manual' (assembly-sourced rows are created
// internally by the fabricate endpoint — see commit 8). Status defaults:
//   - finish_service_id set → 'pending'
//   - finish_service_id null → 'ready_for_despatch' (no supplier needed)
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const jobId = parseInt(body.job_id);
            const description = (body.description || '').trim();
            const quantity = parseInt(body.quantity);
            if (!jobId)       return badRequest('job_id is required', request);
            if (!description) return badRequest('description is required', request);
            if (!quantity || quantity < 1) return badRequest('quantity must be >= 1', request);

            const finishServiceId = body.finish_service_id
                ? parseInt(body.finish_service_id)
                : null;
            const status = finishServiceId ? 'pending' : 'ready_for_despatch';
            const createdBy = body.created_by || auth.email || auth.name || null;

            const res = await query(
                `INSERT INTO JobBomItems
                    (job_id, source, source_assembly_id, description, quantity,
                     finish_service_id, status, sharepoint_file_id, sharepoint_drive_id,
                     sharepoint_web_url, file_name, created_by)
                 OUTPUT INSERTED.*
                 VALUES
                    (@jobId, 'manual', NULL, @description, @quantity,
                     @finishServiceId, @status, @spFileId, @spDriveId,
                     @spWebUrl, @fileName, @createdBy)`,
                {
                    jobId,
                    description,
                    quantity,
                    finishServiceId,
                    status,
                    spFileId:  body.sharepoint_file_id  || null,
                    spDriveId: body.sharepoint_drive_id || null,
                    spWebUrl:  body.sharepoint_web_url  || null,
                    fileName:  body.file_name           || null,
                    createdBy
                }
            );

            return created(res.recordset[0], request);
        } catch (err) {
            context.error('Error creating BOM item:', err);
            return serverError('Failed to create BOM item: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items/bulk
// Bulk-create N rows in a single transaction. Used by the manual-upload
// OCR flow where one PDF parses to many line items.
//
// Body:
//   {
//     job_id, finish_service_id?, sharepoint_file_id, sharepoint_drive_id,
//     sharepoint_web_url, file_name,
//     items: [{ description, quantity }, ...]
//   }
//
// All rows share the same source file (sharepoint_* fields) so "Open PDF"
// from any row in the BOM list opens the source slip.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-bulk', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/bulk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const jobId = parseInt(body.job_id);
            if (!jobId) return badRequest('job_id is required', request);
            if (!Array.isArray(body.items) || body.items.length === 0) {
                return badRequest('items must be a non-empty array', request);
            }
            const finishServiceId = body.finish_service_id
                ? parseInt(body.finish_service_id)
                : null;
            const status = finishServiceId ? 'pending' : 'ready_for_despatch';
            const createdBy = body.created_by || auth.email || auth.name || null;

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                const inserted = [];
                for (let i = 0; i < body.items.length; i++) {
                    const it = body.items[i];
                    const description = (it.description || '').trim();
                    const quantity = parseInt(it.quantity);
                    if (!description) throw new Error(`Row ${i + 1}: description is required`);
                    if (!quantity || quantity < 1) {
                        throw new Error(`Row ${i + 1}: quantity must be >= 1`);
                    }
                    const r = new sql.Request(transaction);
                    r.input('jobId',           sql.Int,           jobId);
                    r.input('description',     sql.NVarChar(256), description);
                    r.input('quantity',        sql.Int,           quantity);
                    r.input('finishServiceId', sql.Int,           finishServiceId);
                    r.input('status',          sql.NVarChar(32),  status);
                    r.input('spFileId',        sql.NVarChar(256), body.sharepoint_file_id  || null);
                    r.input('spDriveId',       sql.NVarChar(256), body.sharepoint_drive_id || null);
                    r.input('spWebUrl',        sql.NVarChar(1024), body.sharepoint_web_url || null);
                    r.input('fileName',        sql.NVarChar(256), body.file_name           || null);
                    r.input('createdBy',       sql.NVarChar(256), createdBy);

                    const ins = await r.query(
                        `INSERT INTO JobBomItems
                            (job_id, source, source_assembly_id, description, quantity,
                             finish_service_id, status, sharepoint_file_id, sharepoint_drive_id,
                             sharepoint_web_url, file_name, created_by)
                         OUTPUT INSERTED.*
                         VALUES
                            (@jobId, 'manual', NULL, @description, @quantity,
                             @finishServiceId, @status, @spFileId, @spDriveId,
                             @spWebUrl, @fileName, @createdBy)`
                    );
                    inserted.push(ins.recordset[0]);
                }
                await transaction.commit();
                return created({ items: inserted }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error bulk-creating BOM items:', err);
            return serverError('Failed to bulk-create BOM items: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-bom-items/:id
// Edit description / quantity / finish_service_id. Doesn't change status —
// use /status for that. Useful for fixing OCR mistakes after the fact.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-bom-items/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);

            const body = await request.json();
            const fields = [];
            const params = { id };

            if (body.description !== undefined) {
                const d = (body.description || '').trim();
                if (!d) return badRequest('description cannot be empty', request);
                fields.push('description = @description');
                params.description = d;
            }
            if (body.quantity !== undefined) {
                const q = parseInt(body.quantity);
                if (!q || q < 1) return badRequest('quantity must be >= 1', request);
                fields.push('quantity = @quantity');
                params.quantity = q;
            }
            if (body.finish_service_id !== undefined) {
                fields.push('finish_service_id = @finishServiceId');
                params.finishServiceId = body.finish_service_id ? parseInt(body.finish_service_id) : null;
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            const res = await query(
                `UPDATE JobBomItems SET ${fields.join(', ')}
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                params
            );
            if (res.recordset.length === 0) return notFound('BOM item not found', request);
            return ok(res.recordset[0], request);
        } catch (err) {
            context.error('Error updating BOM item:', err);
            return serverError('Failed to update BOM item', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-bom-items/:id/status
// Advances the state machine. Body: { status, supplier_id? }.
// Transitions allowed:
//   pending             → at_supplier         (requires supplier_id; usually
//                                              set by generate-DN in commit 10)
//   at_supplier         → ready_for_despatch  (returned from supplier)
//   ready_for_despatch  → despatched          (gone to client)
//   any                 → any                 (when ?force=1 — only for fixing
//                                              mistakes via the UI; we record
//                                              the timestamps that match the
//                                              new state and clear any later
//                                              ones)
//
// We don't support backward transitions in v1 per spec, but the force flag
// is reserved for manual corrections.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-status', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-bom-items/{id}/status',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);

            const body = await request.json();
            const newStatus = body.status;
            if (!ALLOWED_STATUS.includes(newStatus)) {
                return badRequest('Invalid status', request);
            }

            const url = new URL(request.url);
            const force = url.searchParams.get('force') === '1';

            // Compute the SET clause based on the new status
            const sets = ['status = @status'];
            const params = { id, status: newStatus };

            if (newStatus === 'at_supplier') {
                if (!body.supplier_id) return badRequest('supplier_id is required for at_supplier', request);
                sets.push('supplier_id = @supplierId');
                params.supplierId = parseInt(body.supplier_id);
                sets.push('sent_at = SYSUTCDATETIME()');
            } else if (newStatus === 'ready_for_despatch') {
                sets.push('returned_at = SYSUTCDATETIME()');
            } else if (newStatus === 'despatched') {
                sets.push('despatched_at = SYSUTCDATETIME()');
            } else if (newStatus === 'pending') {
                // Reset: clear supplier and timestamps (only if forcing back)
                if (!force) return badRequest('Cannot revert to pending without ?force=1', request);
                sets.push('supplier_id = NULL', 'sent_at = NULL', 'returned_at = NULL', 'despatched_at = NULL', 'delivery_note_id = NULL');
            }

            const res = await query(
                `UPDATE JobBomItems SET ${sets.join(', ')}
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                params
            );
            if (res.recordset.length === 0) return notFound('BOM item not found', request);
            return ok(res.recordset[0], request);
        } catch (err) {
            context.error('Error updating BOM item status:', err);
            return serverError('Failed to update BOM item status', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/job-bom-items/:id
// Hard delete. Allowed in any status (the frontend can warn the user
// before calling).
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'job-bom-items/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);

            const existing = await query('SELECT id FROM JobBomItems WHERE id = @id', { id });
            if (existing.recordset.length === 0) return notFound('BOM item not found', request);

            await query('DELETE FROM JobBomItems WHERE id = @id', { id });
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting BOM item:', err);
            return serverError('Failed to delete BOM item', request);
        }
    }
});
