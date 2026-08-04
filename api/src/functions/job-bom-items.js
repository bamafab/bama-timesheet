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

const ALLOWED_STATUS = ['pending', 'at_supplier', 'ready_for_despatch', 'despatched', 'on_site'];

// A finish is "outsourced" only if at least one ACTIVE supplier actually
// offers it (has a SupplierServices row for that service type). If nobody
// offers it, the finish is done in-house (e.g. we paint here ourselves) —
// so the item skips the supplier-DN flow entirely and lands straight in
// 'ready_for_despatch', ready to ship to site. No finish at all is treated
// the same way.
//
// This keeps the whole thing data-driven off the Suppliers tab: add a
// galvaniser and galv items route to it; don't add a painter and paint
// stays in-house. No separate in-house/outsourced flag to maintain.
async function finishIsOutsourced(finishServiceId) {
    if (!finishServiceId) return false;
    const r = await query(
        `SELECT TOP 1 1 AS x
         FROM SupplierServices ss
         JOIN Suppliers s ON s.id = ss.supplier_id
         WHERE ss.service_type_id = @fid AND s.is_active = 1`,
        { fid: finishServiceId }
    );
    return r.recordset.length > 0;
}

// Resolve the create/re-route status for a given finish.
async function statusForFinish(finishServiceId) {
    return (await finishIsOutsourced(finishServiceId)) ? 'pending' : 'ready_for_despatch';
}

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
                        a.assembly_mark AS source_assembly_mark,
                        a.total_weight_kg AS assembly_weight_kg,
                        ap.max_length_mm  AS assembly_max_length_mm
                 FROM JobBomItems b
                 LEFT JOIN ServiceTypes  st ON st.id = b.finish_service_id
                 LEFT JOIN Suppliers     s  ON s.id = b.supplier_id
                 LEFT JOIN JobAssemblies a  ON a.id = b.source_assembly_id
                 OUTER APPLY (
                     SELECT MAX(p.length_mm) AS max_length_mm
                     FROM JobAssemblyParts p
                     WHERE p.assembly_id = a.id
                 ) ap
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

            // item_type: 'fabricated' (default) | 'fixing' | 'consumable'.
            // Fixings/consumables (bolts, anchors, resin, etc.) arrive already
            // finished — they carry no finish and go straight to the despatch
            // queue, so their finish_service_id is forced null regardless of
            // what's sent.
            const itemType = ['fixing', 'consumable'].includes(body.item_type)
                ? body.item_type
                : 'fabricated';
            const isLoose = itemType !== 'fabricated';

            const finishServiceId = (!isLoose && body.finish_service_id)
                ? parseInt(body.finish_service_id)
                : null;
            const status = await statusForFinish(finishServiceId);
            const unitWeightKg = (body.unit_weight_kg != null && body.unit_weight_kg !== '')
                ? Number(body.unit_weight_kg)
                : null;
            const createdBy = body.created_by || auth.email || auth.name || null;

            const res = await query(
                `INSERT INTO JobBomItems
                    (job_id, source, source_assembly_id, description, quantity,
                     item_type, unit_weight_kg,
                     finish_service_id, status, sharepoint_file_id, sharepoint_drive_id,
                     sharepoint_web_url, file_name, created_by)
                 OUTPUT INSERTED.*
                 VALUES
                    (@jobId, 'manual', NULL, @description, @quantity,
                     @itemType, @unitWeightKg,
                     @finishServiceId, @status, @spFileId, @spDriveId,
                     @spWebUrl, @fileName, @createdBy)`,
                {
                    jobId,
                    description,
                    quantity,
                    itemType,
                    unitWeightKg,
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
            // item_type: fixings/consumables arrive finished → no finish, straight
            // to ready_for_despatch. Fabricated (default) keeps the finish flow.
            const itemType = ['fixing', 'consumable'].includes(body.item_type)
                ? body.item_type : 'fabricated';
            const isLoose = itemType !== 'fabricated';
            const finishServiceId = (!isLoose && body.finish_service_id)
                ? parseInt(body.finish_service_id)
                : null;
            // All rows in a bulk call share one finish, so resolve once.
            const status = await statusForFinish(finishServiceId);
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
                    const unitWeightKg = (it.unit_weight_kg != null && it.unit_weight_kg !== '')
                        ? Number(it.unit_weight_kg) : null;
                    const r = new sql.Request(transaction);
                    r.input('jobId',           sql.Int,           jobId);
                    r.input('description',     sql.NVarChar(256), description);
                    r.input('quantity',        sql.Int,           quantity);
                    r.input('itemType',        sql.NVarChar(16),  itemType);
                    r.input('unitWeightKg',    sql.Decimal(10,3), unitWeightKg);
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
                             item_type, unit_weight_kg,
                             finish_service_id, status, sharepoint_file_id, sharepoint_drive_id,
                             sharepoint_web_url, file_name, created_by)
                         OUTPUT INSERTED.*
                         VALUES
                            (@jobId, 'manual', NULL, @description, @quantity,
                             @itemType, @unitWeightKg,
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
            if (body.unit_weight_kg !== undefined) {
                const w = (body.unit_weight_kg === null || body.unit_weight_kg === '')
                    ? null : Number(body.unit_weight_kg);
                if (w !== null && (isNaN(w) || w < 0)) {
                    return badRequest('unit_weight_kg must be a non-negative number', request);
                }
                fields.push('unit_weight_kg = @unitWeightKg');
                params.unitWeightKg = w;
            }
            if (body.finish_service_id !== undefined) {
                const newFinishId = body.finish_service_id ? parseInt(body.finish_service_id) : null;
                fields.push('finish_service_id = @finishServiceId');
                params.finishServiceId = newFinishId;

                // Re-route the item when its finish changes — but ONLY while it
                // hasn't yet gone to a supplier. A finish now offered by an active
                // supplier ⇒ 'pending' (needs a DN); an in-house / unsupplied
                // finish (or no finish) ⇒ 'ready_for_despatch'. Rows already at
                // at_supplier / despatched / on_site are left untouched so we
                // never regress a live DN.
                const cur = await query('SELECT status FROM JobBomItems WHERE id = @id', { id });
                if (cur.recordset.length === 0) return notFound('BOM item not found', request);
                const curStatus = cur.recordset[0].status;
                if (curStatus === 'pending' || curStatus === 'ready_for_despatch') {
                    fields.push('status = @newStatus');
                    params.newStatus = await statusForFinish(newFinishId);
                }
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
            } else if (newStatus === 'on_site') {
                // 'on_site' is the terminal state when items have been
                // delivered to the client/site via a Site DN. Reuses
                // despatched_at as the timestamp — the row's status
                // discriminates whether it went to a supplier-DN
                // ('despatched') or a site-DN ('on_site') destination.
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
// POST /api/job-bom-items/generate-dn
// Body:
//   {
//     item_ids:           [42, 43, 44, ...],   -- must all share the same finish_service_id
//     supplier_id:        7,                   -- must be active + have SupplierServices entry
//                                                 for the items' finish_service_id
//     sharepoint_file_id: "0123ABC..." | null, -- the DN PDF uploaded by the frontend
//     sharepoint_drive_id: "...",
//     sharepoint_web_url:  "https://...",
//     file_name:          "DN-0042.pdf"
//   }
//
// Returns: { dn_ref: 'DN-0042', items: [...] }
//
// In a single transaction:
//   1. Allocate the next DN ref from Settings.dn_next_seq (UPDLOCK so two
//      concurrent generate-DNs don't collide on the number).
//   2. Validate: every item_id exists, belongs to the same job (defence
//      against client tampering), is currently status='pending', and has
//      the same finish_service_id.
//   3. Validate the supplier is active AND has SupplierServices for that
//      finish_service_id.
//   4. UPDATE all selected items to status='at_supplier' with supplier_id,
//      sent_at, sharepoint_file_id/drive_id/web_url/file_name pointing at
//      the DN PDF.
//
// Note: the actual DN PDF is built and uploaded by the frontend (html2pdf
// + SharePoint PUT). The backend only handles the allocation and the
// status flip — keeps the Functions runtime small (no PDF libs needed).
// The frontend uploads to the path AFTER calling this endpoint so the
// DN ref returned here becomes the filename.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-generate-dn', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/generate-dn',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const itemIds = Array.isArray(body.item_ids)
                ? body.item_ids.map(x => parseInt(x)).filter(x => !isNaN(x))
                : [];
            const supplierId = parseInt(body.supplier_id);
            if (itemIds.length === 0) return badRequest('item_ids must be a non-empty array', request);
            if (!supplierId || isNaN(supplierId)) return badRequest('supplier_id is required', request);

            // Build a parameterised IN clause for the item lookup
            const idParams = { supplierId };
            const idPlaceholders = itemIds.map((id, i) => {
                const k = `id${i}`;
                idParams[k] = id;
                return `@${k}`;
            }).join(',');

            // Cheap pre-flight validation (outside the txn for fast-fail)
            const checkRes = await query(
                `SELECT id, job_id, status, finish_service_id
                 FROM JobBomItems
                 WHERE id IN (${idPlaceholders})`,
                idParams
            );
            if (checkRes.recordset.length !== itemIds.length) {
                return badRequest('One or more BOM items not found', request);
            }
            const finishIds = new Set(checkRes.recordset.map(r => r.finish_service_id));
            if (finishIds.size > 1) {
                return badRequest('All items on a DN must share the same finish', request);
            }
            const finishServiceId = checkRes.recordset[0].finish_service_id;
            if (!finishServiceId) {
                return badRequest('Items without a finish cannot go on a DN — they are already ready for despatch', request);
            }
            // Multi-job DNs are allowed as long as every job belongs to the
            // SAME PROJECT (one delivery run can carry several jobs' steel).
            const jobIds = [...new Set(checkRes.recordset.map(r => r.job_id))];
            if (jobIds.length > 1) {
                const jparams = {};
                const jph = jobIds.map((id, i) => { const k = `jid${i}`; jparams[k] = id; return `@${k}`; }).join(',');
                const jrows = await query(
                    `SELECT DISTINCT project_number FROM DrawingJobs WHERE id IN (${jph})`, jparams);
                if (jrows.recordset.length > 1) {
                    return badRequest('All items on a DN must belong to the same project', request);
                }
            }
            const notPending = checkRes.recordset.filter(r => r.status !== 'pending');
            if (notPending.length) {
                return badRequest(`Items ${notPending.map(r => r.id).join(',')} are not pending`, request);
            }

            // Supplier must be active AND offer the relevant finish service
            const supplierRes = await query(
                `SELECT s.id
                 FROM Suppliers s
                 JOIN SupplierServices ss ON ss.supplier_id = s.id
                 WHERE s.id = @supplierId AND s.is_active = 1
                   AND ss.service_type_id = @finishServiceId`,
                { supplierId, finishServiceId }
            );
            if (supplierRes.recordset.length === 0) {
                return badRequest('Selected supplier is inactive or does not offer the required finish', request);
            }

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                // 1. Allocate next DN ref atomically. UPDLOCK keeps two concurrent
                //    generators from getting the same number.
                const seqReq = new sql.Request(transaction);
                const seqRes = await seqReq.query(
                    `SELECT value FROM Settings WITH (UPDLOCK, HOLDLOCK) WHERE [key] = 'dn_next_seq'`
                );
                if (seqRes.recordset.length === 0) {
                    throw new Error('Settings.dn_next_seq not initialised — run migration 1');
                }
                const nextSeq = parseInt(seqRes.recordset[0].value) || 1;
                const dnRef = `DN-${String(nextSeq).padStart(4, '0')}`;

                // Increment for the next allocation
                const incReq = new sql.Request(transaction);
                incReq.input('newVal', sql.NVarChar(64), String(nextSeq + 1));
                await incReq.query(
                    `UPDATE Settings SET value = @newVal, updated_at = SYSUTCDATETIME()
                     WHERE [key] = 'dn_next_seq'`
                );

                // 2. Flip selected items. The WHERE clause re-checks status='pending'
                //    to defend against concurrent status changes.
                const fileName = body.file_name || `${dnRef}.pdf`;
                const upReq = new sql.Request(transaction);
                upReq.input('supplierId', sql.Int,           supplierId);
                upReq.input('spFileId',   sql.NVarChar(256), body.sharepoint_file_id  || null);
                upReq.input('spDriveId',  sql.NVarChar(256), body.sharepoint_drive_id || null);
                upReq.input('spWebUrl',   sql.NVarChar(1024), body.sharepoint_web_url || null);
                upReq.input('fileName',   sql.NVarChar(256), fileName);
                itemIds.forEach((id, i) => upReq.input(`id${i}`, sql.Int, id));

                const upRes = await upReq.query(
                    `UPDATE JobBomItems
                     SET status              = 'at_supplier',
                         supplier_id         = @supplierId,
                         sent_at             = SYSUTCDATETIME(),
                         sharepoint_file_id  = @spFileId,
                         sharepoint_drive_id = @spDriveId,
                         sharepoint_web_url  = @spWebUrl,
                         file_name           = @fileName
                     OUTPUT INSERTED.*
                     WHERE id IN (${idPlaceholders}) AND status = 'pending'`
                );
                if (upRes.recordset.length !== itemIds.length) {
                    throw new Error('One or more items changed status concurrently — please refresh.');
                }

                await transaction.commit();
                return ok({ dn_ref: dnRef, items: upRes.recordset }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error generating DN:', err);
            return serverError('Failed to generate DN: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items/generate-sdn
// Site Delivery Note allocator with PARTIAL + OVERSHIP support (Phase 2).
//   - No supplier required (destination is the client / installation site)
//   - Ships a per-line quantity (not the whole line), so 100 of a 250 line
//     can go on one note and the rest later.
//   - Each ship writes a JobBomDespatches ledger row (per SDN, per line) and
//     bumps JobBomItems.despatched_qty. A line flips to 'on_site' once it's
//     fully delivered (despatched_qty >= quantity); until then it stays
//     ready_for_despatch and keeps appearing in the SDN queue.
//   - Fixings/consumables may OVERSHIP (send more than outstanding, or ship
//     again after they're complete — erectors lose bolts). Fabricated marks
//     are capped at outstanding.
//   - Uses Settings.sdn_next_seq → SDN-0001, SDN-0002, …
//
// Body:
//   {
//     lines: [ { item_id: 42, qty: 100 }, ... ]   -- share one job_id
//     // (legacy: item_ids:[...] ships each line's full outstanding)
//     sharepoint_file_id / _drive_id / _web_url / file_name  -- optional; the
//        PDF is uploaded after allocation, so these are normally backfilled
//        via /generate-sdn/files once the upload returns a webUrl.
//   }
//
// Returns: { sdn_ref, lines: [{ item_id, qty, quantity, despatched_qty,
//                               outstanding, status, item_type }] }
//
// Single transaction with UPDLOCK+HOLDLOCK on the Settings row so concurrent
// allocators can't collide on the number.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-generate-sdn', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/generate-sdn',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();

            // Accept the new {lines:[{item_id,qty}]} shape; fall back to the
            // legacy {item_ids:[...]} (ship full outstanding on each).
            let lines = [];
            if (Array.isArray(body.lines)) {
                lines = body.lines
                    .map(l => ({ item_id: parseInt(l.item_id), qty: parseInt(l.qty) }))
                    .filter(l => !isNaN(l.item_id) && !isNaN(l.qty));
            } else if (Array.isArray(body.item_ids)) {
                lines = body.item_ids
                    .map(x => ({ item_id: parseInt(x), qty: null }))
                    .filter(l => !isNaN(l.item_id));
            }
            if (lines.length === 0) return badRequest('lines must be a non-empty array of {item_id, qty}', request);

            // Collapse duplicate item_ids (defensive) — sum their qty
            const byId = new Map();
            for (const l of lines) {
                const prev = byId.get(l.item_id);
                if (prev) prev.qty = (prev.qty == null || l.qty == null) ? (prev.qty ?? l.qty) : prev.qty + l.qty;
                else byId.set(l.item_id, { ...l });
            }
            lines = Array.from(byId.values());
            const itemIds = lines.map(l => l.item_id);

            // Pre-flight validation outside the txn for fast-fail
            const idParams = {};
            const idPlaceholders = itemIds.map((id, i) => {
                const k = `id${i}`;
                idParams[k] = id;
                return `@${k}`;
            }).join(',');

            const checkRes = await query(
                `SELECT id, job_id, status, quantity, despatched_qty, item_type
                 FROM JobBomItems
                 WHERE id IN (${idPlaceholders})`,
                idParams
            );
            if (checkRes.recordset.length !== itemIds.length) {
                return badRequest('One or more BOM items not found', request);
            }
            // Multi-job SDNs are allowed as long as every job belongs to the
            // SAME PROJECT (one site delivery can carry several jobs' items).
            const jobIds = [...new Set(checkRes.recordset.map(r => r.job_id))];
            if (jobIds.length > 1) {
                const jparams = {};
                const jph = jobIds.map((id, i) => { const k = `jid${i}`; jparams[k] = id; return `@${k}`; }).join(',');
                const jrows = await query(
                    `SELECT DISTINCT project_number FROM DrawingJobs WHERE id IN (${jph})`, jparams);
                if (jrows.recordset.length > 1) {
                    return badRequest('All items on an SDN must belong to the same project', request);
                }
            }

            const rowById = new Map(checkRes.recordset.map(r => [r.id, r]));
            const isLoose = t => t === 'fixing' || t === 'consumable';

            // Validate each line, resolving qty and status eligibility.
            for (const l of lines) {
                const row = rowById.get(l.item_id);
                const outstanding = Math.max(0, (row.quantity || 0) - (row.despatched_qty || 0));

                // Legacy/no-qty → default to full outstanding
                if (l.qty == null) l.qty = outstanding > 0 ? outstanding : 0;

                if (!Number.isInteger(l.qty) || l.qty < 1) {
                    return badRequest(`Item ${l.item_id}: qty must be >= 1`, request);
                }

                if (isLoose(row.item_type)) {
                    // Fixings ship from ready_for_despatch OR on_site (overship /
                    // top-up after complete). No upper cap.
                    if (row.status !== 'ready_for_despatch' && row.status !== 'on_site') {
                        return badRequest(
                            `Fixing ${l.item_id} is '${row.status}' — must be ready for despatch (or already on site) to ship.`,
                            request);
                    }
                } else {
                    // Fabricated marks: ready_for_despatch only, capped at outstanding.
                    if (row.status !== 'ready_for_despatch') {
                        return badRequest(
                            `Item ${l.item_id} is not ready_for_despatch (only items back from a supplier, or never needing one, can ship to site).`,
                            request);
                    }
                    if (l.qty > outstanding) {
                        return badRequest(
                            `Item ${l.item_id}: qty ${l.qty} exceeds outstanding ${outstanding}. Fabricated marks can't be overshipped.`,
                            request);
                    }
                }
            }

            const createdBy = auth.email || auth.name || null;
            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                // 1. Allocate next SDN ref atomically
                const seqReq = new sql.Request(transaction);
                const seqRes = await seqReq.query(
                    `SELECT value FROM Settings WITH (UPDLOCK, HOLDLOCK) WHERE [key] = 'sdn_next_seq'`
                );
                if (seqRes.recordset.length === 0) {
                    throw new Error('Settings.sdn_next_seq not initialised — run add-sdn-sequence.sql');
                }
                const nextSeq = parseInt(seqRes.recordset[0].value) || 1;
                const sdnRef = `SDN-${String(nextSeq).padStart(4, '0')}`;

                const incReq = new sql.Request(transaction);
                incReq.input('newVal', sql.NVarChar(64), String(nextSeq + 1));
                await incReq.query(
                    `UPDATE Settings SET value = @newVal, updated_at = SYSUTCDATETIME()
                     WHERE [key] = 'sdn_next_seq'`
                );

                const fileName = body.file_name || `${sdnRef}.pdf`;
                const resultLines = [];

                // 2. Per line: write ledger row, bump despatched_qty, set status.
                for (const l of lines) {
                    const row = rowById.get(l.item_id);

                    // Ledger row — the reprintable per-SDN record
                    const ledReq = new sql.Request(transaction);
                    ledReq.input('itemId',    sql.Int,            l.item_id);
                    ledReq.input('sdnRef',     sql.NVarChar(32),  sdnRef);
                    ledReq.input('qty',        sql.Int,           l.qty);
                    ledReq.input('spFileId',   sql.NVarChar(256), body.sharepoint_file_id  || null);
                    ledReq.input('spDriveId',  sql.NVarChar(256), body.sharepoint_drive_id || null);
                    ledReq.input('spWebUrl',   sql.NVarChar(1024),body.sharepoint_web_url  || null);
                    ledReq.input('fileName',   sql.NVarChar(256), fileName);
                    ledReq.input('createdBy',  sql.NVarChar(256), createdBy);
                    await ledReq.query(
                        `INSERT INTO JobBomDespatches
                            (bom_item_id, sdn_ref, qty, sharepoint_file_id,
                             sharepoint_drive_id, sharepoint_web_url, file_name, created_by)
                         VALUES
                            (@itemId, @sdnRef, @qty, @spFileId, @spDriveId, @spWebUrl, @fileName, @createdBy)`
                    );

                    // Bump the row: despatched_qty += qty, flip to on_site when
                    // fully delivered, stamp latest SDN refs for the "open PDF"
                    // link. re-check status guards concurrent changes.
                    const newDespatched = (row.despatched_qty || 0) + l.qty;
                    const nowComplete = newDespatched >= (row.quantity || 0);
                    const allowedStatuses = isLoose(row.item_type)
                        ? `('ready_for_despatch','on_site')`
                        : `('ready_for_despatch')`;

                    const upReq = new sql.Request(transaction);
                    upReq.input('itemId',    sql.Int,            l.item_id);
                    upReq.input('addQty',     sql.Int,           l.qty);
                    upReq.input('spFileId',   sql.NVarChar(256), body.sharepoint_file_id  || null);
                    upReq.input('spDriveId',  sql.NVarChar(256), body.sharepoint_drive_id || null);
                    upReq.input('spWebUrl',   sql.NVarChar(1024),body.sharepoint_web_url  || null);
                    upReq.input('fileName',   sql.NVarChar(256), fileName);
                    const upRes = await upReq.query(
                        `UPDATE JobBomItems
                         SET despatched_qty      = despatched_qty + @addQty,
                             status              = CASE WHEN despatched_qty + @addQty >= quantity
                                                        THEN 'on_site' ELSE status END,
                             despatched_at       = CASE WHEN despatched_qty + @addQty >= quantity
                                                        THEN SYSUTCDATETIME() ELSE despatched_at END,
                             sharepoint_file_id  = @spFileId,
                             sharepoint_drive_id = @spDriveId,
                             sharepoint_web_url  = @spWebUrl,
                             file_name           = @fileName
                         OUTPUT INSERTED.id, INSERTED.quantity, INSERTED.despatched_qty,
                                INSERTED.status, INSERTED.item_type
                         WHERE id = @itemId AND status IN ${allowedStatuses}`
                    );
                    if (upRes.recordset.length !== 1) {
                        throw new Error(`Item ${l.item_id} changed status concurrently — please refresh.`);
                    }
                    const u = upRes.recordset[0];
                    resultLines.push({
                        item_id:        u.id,
                        qty:            l.qty,
                        quantity:       u.quantity,
                        despatched_qty: u.despatched_qty,
                        outstanding:    Math.max(0, u.quantity - u.despatched_qty),
                        status:         u.status,
                        item_type:      u.item_type,
                        complete:       nowComplete
                    });
                }

                await transaction.commit();
                return ok({ sdn_ref: sdnRef, lines: resultLines }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error generating SDN:', err);
            return serverError('Failed to generate SDN: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items/generate-sdn/files
// Backfill the SharePoint refs onto an SDN's ledger rows (and the latest-SDN
// pointer on the item rows) AFTER the PDF has been uploaded. generate-sdn
// allocates the ref (needed for the filename printed on the PDF) before the
// upload exists, so the webUrl is written here in a second, cheap call.
// Body: { sdn_ref, sharepoint_file_id?, sharepoint_drive_id?, sharepoint_web_url?, file_name? }
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-generate-sdn-files', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/generate-sdn/files',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const sdnRef = (body.sdn_ref || '').trim();
            if (!sdnRef) return badRequest('sdn_ref is required', request);

            const params = {
                sdnRef,
                spFileId:  body.sharepoint_file_id  || null,
                spDriveId: body.sharepoint_drive_id || null,
                spWebUrl:  body.sharepoint_web_url  || null,
                fileName:  body.file_name           || null
            };

            // Ledger rows for this SDN
            await query(
                `UPDATE JobBomDespatches
                 SET sharepoint_file_id  = @spFileId,
                     sharepoint_drive_id = @spDriveId,
                     sharepoint_web_url  = @spWebUrl,
                     file_name           = COALESCE(@fileName, file_name)
                 WHERE sdn_ref = @sdnRef`,
                params
            );
            // Item rows whose latest note is this SDN
            await query(
                `UPDATE b
                 SET b.sharepoint_file_id  = @spFileId,
                     b.sharepoint_drive_id = @spDriveId,
                     b.sharepoint_web_url  = @spWebUrl,
                     b.file_name           = COALESCE(@fileName, b.file_name)
                 FROM JobBomItems b
                 WHERE b.id IN (SELECT bom_item_id FROM JobBomDespatches WHERE sdn_ref = @sdnRef)
                   AND b.file_name = @fileName`,
                params
            );
            return ok({ sdn_ref: sdnRef, updated: true }, request);
        } catch (err) {
            context.error('Error backfilling SDN files:', err);
            return serverError('Failed to save SDN file refs: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items/bulk-status — advance many rows in one call.
// Body: { item_ids:[...], status, force? }.
// Only rows in the correct SOURCE state are updated (others silently
// skipped); returns { updated: n }. Limited to the toolbar-safe terminal
// hops — at_supplier / on_site still route through generate-dn / -sdn
// (they need a supplier or DN PDF), so they're intentionally not offered.
// POST (not PUT) + literal route avoids colliding with job-bom-items/{id}.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-bulk-status', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/bulk-status',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const itemIds = Array.isArray(body.item_ids)
                ? body.item_ids.map(x => parseInt(x)).filter(x => !isNaN(x))
                : [];
            if (itemIds.length === 0) return badRequest('item_ids must be a non-empty array', request);

            const target = body.status;
            const force = body.force === true || body.force === 1;

            // Allowed bulk targets → required source state + timestamp column.
            const RULES = {
                ready_for_despatch: { from: 'at_supplier',       ts: 'returned_at' },
                despatched:         { from: 'ready_for_despatch', ts: 'despatched_at' }
            };
            const rule = RULES[target];
            if (!rule) {
                return badRequest('Unsupported bulk status (use ready_for_despatch or despatched)', request);
            }

            const params = { target };
            const ph = itemIds.map((id, i) => { params[`id${i}`] = id; return `@id${i}`; }).join(',');
            let whereState = '';
            if (!force) { whereState = ' AND status = @fromState'; params.fromState = rule.from; }

            const res = await query(
                `UPDATE JobBomItems
                 SET status = @target, ${rule.ts} = SYSUTCDATETIME()
                 OUTPUT INSERTED.id
                 WHERE id IN (${ph})${whereState}`,
                params
            );
            return ok({ updated: res.recordset.length }, request);
        } catch (err) {
            context.error('Error bulk-updating BOM status:', err);
            return serverError('Failed to bulk-update status', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items/bulk-finish — set one finish on many rows.
// Body: { item_ids:[...], finish_service_id }. Re-routes each row
// (supplied finish → pending, in-house/none → ready_for_despatch) but only
// for rows not yet sent to a supplier. Rows already at_supplier+ keep their
// status (finish still updated). Returns { updated, rerouted }.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-bulk-finish', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/bulk-finish',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const itemIds = Array.isArray(body.item_ids)
                ? body.item_ids.map(x => parseInt(x)).filter(x => !isNaN(x))
                : [];
            if (itemIds.length === 0) return badRequest('item_ids must be a non-empty array', request);

            const finishServiceId = body.finish_service_id ? parseInt(body.finish_service_id) : null;
            const newStatus = await statusForFinish(finishServiceId);
            const ph = itemIds.map((_, i) => `@id${i}`).join(',');

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();
            try {
                // 1. set finish on every selected row
                const r1 = new sql.Request(transaction);
                r1.input('finishServiceId', sql.Int, finishServiceId);
                itemIds.forEach((id, i) => r1.input(`id${i}`, sql.Int, id));
                const up1 = await r1.query(
                    `UPDATE JobBomItems SET finish_service_id = @finishServiceId
                     OUTPUT INSERTED.id WHERE id IN (${ph})`
                );

                // 2. re-route status ONLY for rows still pre-supplier
                const r2 = new sql.Request(transaction);
                r2.input('newStatus', sql.NVarChar(32), newStatus);
                itemIds.forEach((id, i) => r2.input(`id${i}`, sql.Int, id));
                const up2 = await r2.query(
                    `UPDATE JobBomItems SET status = @newStatus
                     OUTPUT INSERTED.id
                     WHERE id IN (${ph}) AND status IN ('pending','ready_for_despatch')`
                );

                await transaction.commit();
                return ok({ updated: up1.recordset.length, rerouted: up2.recordset.length }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error bulk-setting finish:', err);
            return serverError('Failed to bulk-set finish', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-bom-items/bulk-delete — delete many rows in one call.
// Body: { item_ids:[...] }. Returns { deleted: n }.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-bom-items-bulk-delete', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-bom-items/bulk-delete',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const itemIds = Array.isArray(body.item_ids)
                ? body.item_ids.map(x => parseInt(x)).filter(x => !isNaN(x))
                : [];
            if (itemIds.length === 0) return badRequest('item_ids must be a non-empty array', request);

            const params = {};
            const ph = itemIds.map((id, i) => { params[`id${i}`] = id; return `@id${i}`; }).join(',');
            const res = await query(
                `DELETE FROM JobBomItems OUTPUT DELETED.id WHERE id IN (${ph})`,
                params
            );
            return ok({ deleted: res.recordset.length }, request);
        } catch (err) {
            context.error('Error bulk-deleting BOM items:', err);
            return serverError('Failed to bulk-delete BOM items', request);
        }
    }
});

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
