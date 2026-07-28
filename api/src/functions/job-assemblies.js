// Job Assemblies API — backs the new Assembly element flow
// (uploaded PDFs + Claude OCR'd parts table → JobAssemblies + JobAssemblyParts).
//
// See docs/SPEC-job-fabrication-rework.md §5, §10.
//
// Endpoints in this file:
//   GET    /api/job-assemblies?job_id=X   list assemblies + parts for a job
//   POST   /api/job-assemblies            create assembly + parts (one txn)
//   DELETE /api/job-assemblies/:id        delete (only if status='pending')
//
//   PUT    /api/job-assemblies/:id/fabricate   LEGACY all-in-one (kept as shim)
//   GET    /api/job-assemblies/kiosk           kiosk Fabrication tile
//
// Staged / partial fabrication (fab → weld → complete, per-piece counts):
//   PUT    /api/job-assemblies/:id/fab         mark N pieces fabbed
//   PUT    /api/job-assemblies/:id/weld        mark N pieces welded (→ BOM)
//   PUT    /api/job-assemblies/:id/complete    mark N pieces complete (→ BOM)
//   See docs/SPEC-job-fabrication-rework.md + api/sql/add-staged-fabrication.sql

const { app } = require('@azure/functions');
const { query, getPool, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError } = require('../responses');

// A finish is "outsourced" only if at least one ACTIVE supplier offers it
// (has a SupplierServices row). If nobody offers it, it's done in-house and
// the BOM row skips the supplier-DN flow. Mirrors the helper in
// job-bom-items.js — kept local so each function file stays independent.
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

// ─────────────────────────────────────────────────────────────────────────────
// STAGED FABRICATION HELPERS (fab → weld → complete, partial quantities)
// See docs/SPEC-job-fabrication-rework.md + the "Staged / Partial Fabrication"
// migration (api/sql/add-staged-fabrication.sql).
//
// Piece accounting (all on JobAssemblies, kept in sync inside each txn):
//   quantity       total pieces in the assembly
//   qty_fabbed     pieces fabricated (fab→weld route)
//   qty_welded     pieces welded     (0..qty_fabbed) — these hit BOM
//   qty_completed  pieces completed DIRECTLY (Complete button) — these hit BOM
//   Derived:
//     to_fab        = quantity - qty_fabbed - qty_completed
//     ready_to_weld = qty_fabbed - qty_welded
//     bom_qty       = qty_welded + qty_completed
//   The fab→weld pool and the direct-complete pool are DISJOINT: a raw piece
//   goes down exactly one route, so the caps never let the two overlap.
// ─────────────────────────────────────────────────────────────────────────────

// Derive the status label from the counts. 'fabricated' is kept as the
// terminal name (every piece on BOM) so existing reads — kiosk 24h window,
// projects progress rollups, confirmCloseJob — keep working unchanged.
function deriveStatus(quantity, qtyWelded, qtyCompleted, qtyFabbed) {
    const bom = (qtyWelded || 0) + (qtyCompleted || 0);
    if (bom >= quantity) return 'fabricated';
    if (bom > 0 || (qtyFabbed || 0) > 0) return 'in_progress';
    return 'pending';
}

// Smart BOM merge. Adds `delta` pieces to this assembly's OPEN BOM row —
// "open" = no DN raised yet (status NOT IN at_supplier/despatched/on_site).
// If an open row exists we top up its quantity so repeated completions read
// as one line ("5no B2") instead of spawning 1no + 3no + 1no. If none exists
// (first completion, or the previous row was frozen onto a DN), we insert a
// fresh row — a genuinely separate delivery batch.
//
// Returns the BOM row id that received the pieces.
async function applyBomDelta(transaction, assembly, heaviestProfile, delta, createdBy) {
    // Find the open, mergeable BOM row for this assembly.
    const findReq = new sql.Request(transaction);
    findReq.input('aid', sql.Int, assembly.id);
    const openRes = await findReq.query(
        `SELECT TOP 1 id, quantity
         FROM JobBomItems WITH (UPDLOCK, HOLDLOCK)
         WHERE source_assembly_id = @aid
           AND status IN ('pending', 'ready_for_despatch')
         ORDER BY id ASC`
    );

    if (openRes.recordset.length > 0) {
        const row = openRes.recordset[0];
        const topReq = new sql.Request(transaction);
        topReq.input('bid',   sql.Int, row.id);
        topReq.input('delta', sql.Int, delta);
        const upd = await topReq.query(
            `UPDATE JobBomItems SET quantity = quantity + @delta
             OUTPUT INSERTED.id AS id
             WHERE id = @bid`
        );
        return upd.recordset[0].id;
    }

    // No open row — insert a fresh one. Route it the same way the legacy
    // fabricate flow does: needs a supplier DN only if the finish is
    // outsourced, else straight to ready_for_despatch.
    const bomStatus = await finishIsOutsourced(assembly.finish_service_id)
        ? 'pending'
        : 'ready_for_despatch';

    const insReq = new sql.Request(transaction);
    insReq.input('jobId',           sql.Int,           assembly.job_id);
    insReq.input('assemblyId',      sql.Int,           assembly.id);
    insReq.input('description',     sql.NVarChar(256), heaviestProfile);
    insReq.input('quantity',        sql.Int,           delta);
    insReq.input('finishServiceId', sql.Int,           assembly.finish_service_id ?? null);
    insReq.input('status',          sql.NVarChar(32),  bomStatus);
    insReq.input('createdBy',       sql.NVarChar(256), createdBy);
    const ins = await insReq.query(
        `INSERT INTO JobBomItems
            (job_id, source, source_assembly_id, description, quantity,
             finish_service_id, status, created_by)
         OUTPUT INSERTED.id AS id
         VALUES
            (@jobId, 'assembly', @assemblyId, @description, @quantity,
             @finishServiceId, @status, @createdBy)`
    );
    return ins.recordset[0].id;
}

// Mirror of applyBomDelta for rollback. Removes up to `delta` pieces from the
// assembly's OPEN BOM row(s) — never touches a row frozen onto a raised DN
// (at_supplier/despatched/on_site). Returns the number of pieces actually
// removed (may be < delta if not enough open BOM qty exists). If a row hits
// zero it's deleted. Multiple open rows are drained newest-first.
async function removeBomDelta(transaction, assemblyId, delta) {
    let remaining = delta;
    const findReq = new sql.Request(transaction);
    findReq.input('aid', sql.Int, assemblyId);
    const openRes = await findReq.query(
        `SELECT id, quantity
         FROM JobBomItems WITH (UPDLOCK, HOLDLOCK)
         WHERE source_assembly_id = @aid
           AND status IN ('pending', 'ready_for_despatch')
         ORDER BY id DESC`
    );
    for (const row of openRes.recordset) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, row.quantity);
        if (take >= row.quantity) {
            const delReq = new sql.Request(transaction);
            delReq.input('bid', sql.Int, row.id);
            await delReq.query('DELETE FROM JobBomItems WHERE id = @bid');
        } else {
            const updReq = new sql.Request(transaction);
            updReq.input('bid', sql.Int, row.id);
            updReq.input('take', sql.Int, take);
            await updReq.query('UPDATE JobBomItems SET quantity = quantity - @take WHERE id = @bid');
        }
        remaining -= take;
    }
    return delta - remaining; // pieces actually removed
}

// Load an assembly + derive its heaviest part's profile (the BOM line name).
// Returns { assembly, heaviestProfile } or null if not found / no parts.
async function loadAssemblyForStage(id) {
    const aRes = await query('SELECT * FROM JobAssemblies WHERE id = @id', { id });
    if (aRes.recordset.length === 0) return null;
    const assembly = aRes.recordset[0];
    const pRes = await query(
        'SELECT * FROM JobAssemblyParts WHERE assembly_id = @id ORDER BY sort_order ASC, id ASC',
        { id }
    );
    const parts = pRes.recordset;
    let heaviest = parts[0] || null;
    for (const p of parts) {
        if (heaviest && (Number(p.weight_kg) || 0) > (Number(heaviest.weight_kg) || 0)) heaviest = p;
    }
    assembly.parts = parts;
    return { assembly, heaviestProfile: heaviest ? heaviest.profile : (assembly.assembly_mark || 'Assembly') };
}

// Record a stage action + return the fresh assembly row. Called inside a txn.
async function recordAction(transaction, assemblyId, stage, qty, operatorId, operatorName, machineId, bomItemId, performedBy) {
    const r = new sql.Request(transaction);
    r.input('aid',    sql.Int,           assemblyId);
    r.input('stage',  sql.NVarChar(16),  stage);
    r.input('qty',    sql.Int,           qty);
    r.input('opId',   sql.Int,           operatorId ?? null);
    r.input('opName', sql.NVarChar(256), operatorName ?? null);
    r.input('mach',   sql.Int,           machineId ?? null);
    r.input('bom',    sql.Int,           bomItemId ?? null);
    r.input('by',     sql.NVarChar(256), performedBy ?? null);
    await r.query(
        `INSERT INTO JobAssemblyActions
            (assembly_id, stage, qty, operator_id, operator_name,
             welding_machine_id, bom_item_id, performed_by)
         VALUES (@aid, @stage, @qty, @opId, @opName, @mach, @bom, @by)`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/job-assemblies?job_id=X
// Returns assemblies for the given job, each with their parts pre-joined.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'job-assemblies',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const jobId = parseInt(url.searchParams.get('job_id'));
            if (!jobId || isNaN(jobId)) return badRequest('job_id is required', request);

            const assembliesRes = await query(
                `SELECT a.*, s.name AS finish_name
                 FROM JobAssemblies a
                 LEFT JOIN ServiceTypes s ON s.id = a.finish_service_id
                 WHERE a.job_id = @jobId
                 ORDER BY a.created_at ASC, a.id ASC`,
                { jobId }
            );
            const assemblies = assembliesRes.recordset;
            if (assemblies.length === 0) return ok([], request);

            const ids = assemblies.map(a => a.id);
            // Build a parameterised IN clause for parts lookup
            const idParams = {};
            const idPlaceholders = ids.map((id, i) => {
                const k = `id${i}`;
                idParams[k] = id;
                return `@${k}`;
            }).join(',');

            const partsRes = await query(
                `SELECT * FROM JobAssemblyParts
                 WHERE assembly_id IN (${idPlaceholders})
                 ORDER BY assembly_id, sort_order ASC, id ASC`,
                idParams
            );

            const partsByAssembly = {};
            for (const p of partsRes.recordset) {
                if (!partsByAssembly[p.assembly_id]) partsByAssembly[p.assembly_id] = [];
                partsByAssembly[p.assembly_id].push(p);
            }
            for (const a of assemblies) {
                a.parts = partsByAssembly[a.id] || [];
            }

            return ok(assemblies, request);
        } catch (err) {
            context.error('Error listing job assemblies:', err);
            return serverError('Failed to list job assemblies', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/job-assemblies
// Creates an assembly + its parts in a single transaction.
//
// Body shape:
//   {
//     job_id: 42,
//     assembly_mark: "RL1",
//     quantity: 26,
//     finish_service_id: 7|null,
//     finish_label_raw: "Galvanised"|null,
//     total_area_m2: 0.25|null,
//     total_weight_kg: 6.47|null,
//     sharepoint_file_id: "...",
//     sharepoint_drive_id: "...",
//     sharepoint_web_url: "..."|null,
//     file_name: "RL1-A3.pdf",
//     parts: [
//       { part_mark, quantity, profile, length_mm, material, area_m2, weight_kg },
//       ...
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'job-assemblies',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const required = ['job_id', 'assembly_mark', 'quantity',
                              'sharepoint_file_id', 'sharepoint_drive_id', 'file_name'];
            for (const k of required) {
                if (body[k] === undefined || body[k] === null || body[k] === '') {
                    return badRequest(`${k} is required`, request);
                }
            }
            if (!Array.isArray(body.parts) || body.parts.length === 0) {
                return badRequest('parts must be a non-empty array', request);
            }

            const createdBy = body.created_by || auth.email || auth.name || null;

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                const aReq = new sql.Request(transaction);
                aReq.input('jobId',           sql.Int,           body.job_id);
                aReq.input('mark',            sql.NVarChar(64),  body.assembly_mark);
                aReq.input('qty',             sql.Int,           body.quantity);
                aReq.input('finishServiceId', sql.Int,           body.finish_service_id ?? null);
                aReq.input('finishLabelRaw',  sql.NVarChar(128), body.finish_label_raw ?? null);
                aReq.input('totalAreaM2',     sql.Decimal(10,3), body.total_area_m2 ?? null);
                aReq.input('totalWeightKg',   sql.Decimal(10,3), body.total_weight_kg ?? null);
                aReq.input('spFileId',        sql.NVarChar(256), body.sharepoint_file_id);
                aReq.input('spDriveId',       sql.NVarChar(256), body.sharepoint_drive_id);
                aReq.input('spWebUrl',        sql.NVarChar(1024), body.sharepoint_web_url ?? null);
                aReq.input('fileName',        sql.NVarChar(256), body.file_name);
                aReq.input('createdBy',       sql.NVarChar(256), createdBy);

                const aRes = await aReq.query(
                    `INSERT INTO JobAssemblies
                        (job_id, assembly_mark, quantity, finish_service_id, finish_label_raw,
                         total_area_m2, total_weight_kg, sharepoint_file_id, sharepoint_drive_id,
                         sharepoint_web_url, file_name, status, created_by)
                     OUTPUT INSERTED.*
                     VALUES
                        (@jobId, @mark, @qty, @finishServiceId, @finishLabelRaw,
                         @totalAreaM2, @totalWeightKg, @spFileId, @spDriveId,
                         @spWebUrl, @fileName, 'pending', @createdBy)`
                );
                const assembly = aRes.recordset[0];

                // Insert parts one row at a time. Few rows per assembly (typically <10),
                // so a loop is fine. Parameterised per iteration.
                const insertedParts = [];
                for (let i = 0; i < body.parts.length; i++) {
                    const p = body.parts[i];
                    if (!p.profile) {
                        throw new Error(`Part ${i + 1}: profile is required`);
                    }
                    // Sketch-style drawings (no Tekla part marks) send parts with
                    // profile only — default the mark rather than rejecting.
                    if (!p.part_mark) p.part_mark = `P${i + 1}`;
                    const pReq = new sql.Request(transaction);
                    pReq.input('assemblyId', sql.Int,           assembly.id);
                    pReq.input('partMark',   sql.NVarChar(64),  p.part_mark);
                    pReq.input('quantity',   sql.Int,           p.quantity || 1);
                    pReq.input('profile',    sql.NVarChar(128), p.profile);
                    pReq.input('lengthMm',   sql.Decimal(10,2), p.length_mm ?? null);
                    pReq.input('material',   sql.NVarChar(64),  p.material ?? null);
                    pReq.input('areaM2',     sql.Decimal(10,3), p.area_m2 ?? null);
                    pReq.input('weightKg',   sql.Decimal(10,3), p.weight_kg ?? null);
                    pReq.input('sortOrder',  sql.Int,           i);

                    const pRes = await pReq.query(
                        `INSERT INTO JobAssemblyParts
                            (assembly_id, part_mark, quantity, profile, length_mm, material,
                             area_m2, weight_kg, sort_order)
                         OUTPUT INSERTED.*
                         VALUES
                            (@assemblyId, @partMark, @quantity, @profile, @lengthMm, @material,
                             @areaM2, @weightKg, @sortOrder)`
                    );
                    insertedParts.push(pRes.recordset[0]);
                }

                await transaction.commit();

                assembly.parts = insertedParts;
                return created(assembly, request);
            } catch (txErr) {
                await transaction.rollback();
                // UNIQUE constraint on (job_id, assembly_mark) — give the caller a
                // typed signal so the frontend can pop the replace-confirm modal.
                if (txErr.message && (txErr.message.includes('UQ_JobAssemblies_JobMark') ||
                                      txErr.message.includes('UNIQUE KEY'))) {
                    return {
                        status: 409,
                        jsonBody: {
                            error: 'duplicate_mark',
                            message: `Assembly "${body.assembly_mark}" already exists on this job.`
                        },
                        headers: { 'Content-Type': 'application/json' }
                    };
                }
                throw txErr;
            }
        } catch (err) {
            context.error('Error creating job assembly:', err);
            return serverError('Failed to create job assembly: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/job-assemblies/:id
// Hard-deletes an assembly (and via FK cascade, its parts).
//
// Per spec: a `pending` assembly can be deleted freely. A `fabricated`
// assembly cannot — the frontend must walk the user through the BOM
// implications first via the replace-confirm modal, then the API caller
// nulls out source_assembly_id on dependent BOM rows in the SAME txn
// before deleting the JobAssemblies row.
//
// JobBomItems.source_assembly_id is FK with NO ACTION (default), so this
// handler nulls those rows first then deletes the assembly — all in a
// single transaction so concurrent reads never see an orphaned BOM row.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);

            const url = new URL(request.url);
            const force = url.searchParams.get('force') === '1';

            const existing = await query(
                'SELECT id, status FROM JobAssemblies WHERE id = @id',
                { id }
            );
            if (existing.recordset.length === 0) {
                return notFound('Assembly not found', request);
            }
            const row = existing.recordset[0];
            if (row.status === 'fabricated' && !force) {
                return {
                    status: 409,
                    jsonBody: {
                        error: 'fabricated_protected',
                        message: 'This assembly has been marked as fabricated. Use ?force=1 to override (caller must confirm the BOM implications first).'
                    },
                    headers: { 'Content-Type': 'application/json' }
                };
            }

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                const tReq = new sql.Request(transaction);
                tReq.input('id', sql.Int, id);

                // Null source_assembly_id on any dependent BOM rows so the
                // FK doesn't block the delete (FK_JobBomItems_Assembly is
                // NO ACTION — see migration notes).
                await tReq.query('UPDATE JobBomItems SET source_assembly_id = NULL WHERE source_assembly_id = @id');

                // Parts cascade automatically via FK_JobAssemblyParts_Assembly.
                await tReq.query('DELETE FROM JobAssemblies WHERE id = @id');

                await transaction.commit();
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }

            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting job assembly:', err);
            return serverError('Failed to delete job assembly', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/job-assemblies/kiosk
// Returns the list for the kiosk Fabrication tile (SPEC §8):
//   - All 'pending' assemblies on In Progress projects
//   - All 'fabricated' assemblies fabricated in the last 24h on In Progress
//     projects (so the workshop can see what they just finished)
//
// The kiosk renders these grouped by project + job, sorted with pending
// first.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-kiosk', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'job-assemblies/kiosk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            // Pull assemblies first (small set), then their parts, then
            // hydrate parts onto each assembly. Same pattern as the list
            // endpoint to keep the response shape consistent.
            const assembliesRes = await query(
                `SELECT a.*,
                        j.job_name,
                        j.project_number,
                        p.project_name,
                        c.company_name,
                        st.name AS finish_name
                 FROM JobAssemblies a
                 JOIN DrawingJobs j ON j.id = a.job_id
                 JOIN Projects    p ON p.project_number = j.project_number
                 LEFT JOIN Clients c ON c.id = p.client_id
                 LEFT JOIN ServiceTypes st ON st.id = a.finish_service_id
                 WHERE p.status = 'In Progress'
                   AND ISNULL(j.is_complete, 0) = 0   -- closed jobs drop off the kiosk
                   AND (a.status IN ('pending', 'in_progress')
                        OR (a.status = 'fabricated'
                            AND a.fabricated_at > DATEADD(hour, -24, SYSUTCDATETIME())))
                 ORDER BY a.status DESC,
                          j.project_number,
                          j.job_name,
                          a.assembly_mark`
            );
            const assemblies = assembliesRes.recordset;
            if (assemblies.length === 0) return ok([], request);

            const ids = assemblies.map(a => a.id);
            const idParams = {};
            const idPlaceholders = ids.map((id, i) => {
                const k = `id${i}`;
                idParams[k] = id;
                return `@${k}`;
            }).join(',');

            const partsRes = await query(
                `SELECT * FROM JobAssemblyParts
                 WHERE assembly_id IN (${idPlaceholders})
                 ORDER BY assembly_id, sort_order ASC, id ASC`,
                idParams
            );
            const partsByAssembly = {};
            for (const p of partsRes.recordset) {
                if (!partsByAssembly[p.assembly_id]) partsByAssembly[p.assembly_id] = [];
                partsByAssembly[p.assembly_id].push(p);
            }
            for (const a of assemblies) {
                a.parts = partsByAssembly[a.id] || [];
            }

            return ok(assemblies, request);
        } catch (err) {
            context.error('Error fetching kiosk assemblies:', err);
            return serverError('Failed to fetch kiosk assemblies', request);
        }
    }
});

// Single transaction:
//   1. UPDATE JobAssemblies → status='fabricated' + welder + machine + when/who
//   2. INSERT JobBomItems  → description = heaviest part's profile,
//                            quantity    = assembly.quantity,
//                            finish      = assembly.finish_service_id,
//                            status      = 'pending' if finish set,
//                                          else 'ready_for_despatch'
//
// Body shape: { welder_id, welding_machine_id, fabricated_by }
//   - fabricated_by is the welder's display name (so the assembly card and
//     kiosk read out the same string without a join). See SPEC §5.
//
// Returns: { assembly, bom_item } so the frontend can update both caches
// in one round trip.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-fabricate', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}/fabricate',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);

            const body = await request.json();
            const welderId  = parseInt(body.welder_id);
            const machineId = parseInt(body.welding_machine_id);
            const fabricatedBy = (body.fabricated_by || '').trim();

            if (!welderId  || isNaN(welderId))  return badRequest('welder_id is required',         request);
            if (!machineId || isNaN(machineId)) return badRequest('welding_machine_id is required', request);
            if (!fabricatedBy)                  return badRequest('fabricated_by is required',     request);

            // Fetch the assembly + its parts so we can derive the BOM row.
            // We pull this OUTSIDE the txn to validate inputs cheaply; the
            // txn re-reads and locks the row with UPDLOCK.
            const aRes = await query(
                `SELECT a.*
                 FROM JobAssemblies a
                 WHERE a.id = @id`,
                { id }
            );
            if (aRes.recordset.length === 0) return notFound('Assembly not found', request);
            const assembly = aRes.recordset[0];

            if (assembly.status === 'fabricated') {
                return {
                    status: 409,
                    jsonBody: {
                        error: 'already_fabricated',
                        message: 'This assembly has already been marked as fabricated.'
                    },
                    headers: { 'Content-Type': 'application/json' }
                };
            }

            // Determine the heaviest part (MAX(weight_kg)). Ties: first one.
            const partsRes = await query(
                'SELECT * FROM JobAssemblyParts WHERE assembly_id = @id ORDER BY sort_order ASC, id ASC',
                { id }
            );
            const parts = partsRes.recordset;
            if (parts.length === 0) {
                return badRequest('Assembly has no parts — cannot derive BOM line', request);
            }
            let heaviest = parts[0];
            for (const p of parts) {
                if ((Number(p.weight_kg) || 0) > (Number(heaviest.weight_kg) || 0)) {
                    heaviest = p;
                }
            }

            // Route the auto-generated BOM row the same way manual rows are:
            // it only needs a supplier DN if an active supplier actually offers
            // this finish. Otherwise (in-house finish like paint, or no finish)
            // it lands straight in 'ready_for_despatch'. Keeps fabricate from
            // dumping phantom 'pending' rows for finishes we do in-house.
            const bomStatus = await finishIsOutsourced(assembly.finish_service_id)
                ? 'pending'
                : 'ready_for_despatch';

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                // 1. Flip the assembly to fabricated. The WHERE clause re-checks
                //    status='pending' to defend against a concurrent fabricate.
                const uReq = new sql.Request(transaction);
                uReq.input('id',           sql.Int,           id);
                uReq.input('welderId',     sql.Int,           welderId);
                uReq.input('machineId',    sql.Int,           machineId);
                uReq.input('fabricatedBy', sql.NVarChar(256), fabricatedBy);

                const uRes = await uReq.query(
                    `UPDATE JobAssemblies
                     SET status              = 'fabricated',
                         qty_fabbed          = quantity,
                         qty_welded          = quantity,
                         fabricated_at       = SYSUTCDATETIME(),
                         fabricated_by       = @fabricatedBy,
                         welder_id           = @welderId,
                         welding_machine_id  = @machineId
                     OUTPUT INSERTED.*
                     WHERE id = @id AND status = 'pending'`
                );
                if (uRes.recordset.length === 0) {
                    throw new Error('Assembly status changed concurrently — please reload.');
                }
                const updatedAssembly = uRes.recordset[0];

                // 2. Insert the matching BOM row.
                const bReq = new sql.Request(transaction);
                bReq.input('jobId',            sql.Int,            assembly.job_id);
                bReq.input('assemblyId',       sql.Int,            id);
                bReq.input('description',      sql.NVarChar(256),  heaviest.profile);
                bReq.input('quantity',         sql.Int,            assembly.quantity);
                bReq.input('finishServiceId',  sql.Int,            assembly.finish_service_id ?? null);
                bReq.input('status',           sql.NVarChar(32),   bomStatus);
                bReq.input('createdBy',        sql.NVarChar(256),  fabricatedBy);

                const bRes = await bReq.query(
                    `INSERT INTO JobBomItems
                        (job_id, source, source_assembly_id, description, quantity,
                         finish_service_id, status, created_by)
                     OUTPUT INSERTED.*
                     VALUES
                        (@jobId, 'assembly', @assemblyId, @description, @quantity,
                         @finishServiceId, @status, @createdBy)`
                );
                const bomItem = bRes.recordset[0];

                await transaction.commit();

                // Hydrate parts onto the returned assembly so the frontend
                // doesn't need a follow-up GET to refresh its row.
                updatedAssembly.parts = parts;

                return ok({ assembly: updatedAssembly, bom_item: bomItem }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error fabricating job assembly:', err);
            return serverError('Failed to mark fabricated: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-assemblies/:id/fab   — mark N pieces FABRICATED
// Body: { qty, operator_id?, operator_name?, performed_by? }
//   Increments qty_fabbed. Cap = quantity - qty_fabbed - qty_completed
//   (only raw, un-routed pieces can be fabbed). Does NOT touch BOM — fabbed
//   pieces reach BOM later via the weld stage. Fabricator is optional in
//   draftsman bulk-close; the action row records whoever is given.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-fab', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}/fab',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);
            const body = await request.json();
            const qty = parseInt(body.qty);
            if (!qty || isNaN(qty) || qty < 1) return badRequest('qty must be a positive integer', request);

            const loaded = await loadAssemblyForStage(id);
            if (!loaded) return notFound('Assembly not found', request);
            const a = loaded.assembly;

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();
            try {
                // Re-read with lock to get authoritative counts.
                const lockReq = new sql.Request(transaction);
                lockReq.input('id', sql.Int, id);
                const lr = await lockReq.query(
                    'SELECT quantity, qty_fabbed, qty_welded, qty_completed FROM JobAssemblies WITH (UPDLOCK) WHERE id = @id'
                );
                const c = lr.recordset[0];
                const maxFab = c.quantity - c.qty_fabbed - c.qty_completed;
                if (qty > maxFab) {
                    await transaction.rollback();
                    return badRequest(`Only ${maxFab} piece(s) left to fabricate on ${a.assembly_mark}.`, request);
                }

                const newFabbed = c.qty_fabbed + qty;
                const newStatus = deriveStatus(c.quantity, c.qty_welded, c.qty_completed, newFabbed);

                const upReq = new sql.Request(transaction);
                upReq.input('id', sql.Int, id);
                upReq.input('nf', sql.Int, newFabbed);
                upReq.input('st', sql.NVarChar(32), newStatus);
                const up = await upReq.query(
                    `UPDATE JobAssemblies SET qty_fabbed = @nf, status = @st
                     OUTPUT INSERTED.* WHERE id = @id`
                );

                await recordAction(transaction, id, 'fab', qty,
                    body.operator_id ? parseInt(body.operator_id) : null,
                    (body.operator_name || '').trim() || null,
                    null, null, (body.performed_by || auth.name || '').trim() || null);

                await transaction.commit();
                const updated = up.recordset[0];
                updated.parts = a.parts;
                return ok({ assembly: updated }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error marking fabbed:', err);
            return serverError('Failed to mark fabbed: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-assemblies/:id/weld   — mark N pieces WELDED (→ BOM)
// Body: { qty, welder_id?, welder_name?, welding_machine_id?, performed_by? }
//   Increments qty_welded. Cap = qty_fabbed - qty_welded (can only weld what
//   was fabbed). Welded pieces hit BOM via applyBomDelta (smart merge).
//   Welder + machine expected in workshop/kiosk, optional in draftsman bulk.
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-weld', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}/weld',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);
            const body = await request.json();
            const qty = parseInt(body.qty);
            if (!qty || isNaN(qty) || qty < 1) return badRequest('qty must be a positive integer', request);

            const loaded = await loadAssemblyForStage(id);
            if (!loaded) return notFound('Assembly not found', request);
            const a = loaded.assembly;

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();
            try {
                const lockReq = new sql.Request(transaction);
                lockReq.input('id', sql.Int, id);
                const lr = await lockReq.query(
                    'SELECT quantity, qty_fabbed, qty_welded, qty_completed FROM JobAssemblies WITH (UPDLOCK) WHERE id = @id'
                );
                const c = lr.recordset[0];
                const maxWeld = c.qty_fabbed - c.qty_welded;
                if (qty > maxWeld) {
                    await transaction.rollback();
                    return badRequest(`Only ${maxWeld} fabricated piece(s) ready to weld on ${a.assembly_mark}.`, request);
                }

                const performedBy = (body.performed_by || auth.name || '').trim() || null;
                const bomId = await applyBomDelta(transaction, a, loaded.heaviestProfile, qty, performedBy);

                const newWelded = c.qty_welded + qty;
                const newStatus = deriveStatus(c.quantity, newWelded, c.qty_completed, c.qty_fabbed);

                const upReq = new sql.Request(transaction);
                upReq.input('id', sql.Int, id);
                upReq.input('nw', sql.Int, newWelded);
                upReq.input('st', sql.NVarChar(32), newStatus);
                // On terminal, stamp the legacy fabricated_* fields so existing
                // reads (card "Fabricated · name", kiosk 24h) keep working.
                let extra = '';
                if (newStatus === 'fabricated') {
                    upReq.input('fb', sql.NVarChar(256), performedBy);
                    upReq.input('wid', sql.Int, body.welder_id ? parseInt(body.welder_id) : null);
                    upReq.input('mid', sql.Int, body.welding_machine_id ? parseInt(body.welding_machine_id) : null);
                    extra = `, fabricated_at = SYSUTCDATETIME(), fabricated_by = @fb,
                              welder_id = COALESCE(@wid, welder_id),
                              welding_machine_id = COALESCE(@mid, welding_machine_id)`;
                }
                const up = await upReq.query(
                    `UPDATE JobAssemblies SET qty_welded = @nw, status = @st${extra}
                     OUTPUT INSERTED.* WHERE id = @id`
                );

                await recordAction(transaction, id, 'weld', qty,
                    body.welder_id ? parseInt(body.welder_id) : null,
                    (body.welder_name || '').trim() || null,
                    body.welding_machine_id ? parseInt(body.welding_machine_id) : null,
                    bomId, performedBy);

                await transaction.commit();
                const updated = up.recordset[0];
                updated.parts = a.parts;
                return ok({ assembly: updated, bom_item_id: bomId }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error marking welded:', err);
            return serverError('Failed to mark welded: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-assemblies/:id/complete   — mark N pieces COMPLETE (→ BOM)
// Body: { qty, operator_id?, operator_name?, welding_machine_id?, performed_by? }
//   The direct-to-BOM path for pieces that don't go through the fab→weld
//   tracking (e.g. no welding needed, or done in one hit). Increments
//   qty_completed. Cap = quantity - qty_fabbed - qty_completed (raw pieces
//   only — fabbed pieces finish via weld). Feeds BOM via applyBomDelta.
//   Operator + machine optional (draftsman bulk-close).
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-complete', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}/complete',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);
            const body = await request.json();
            const qty = parseInt(body.qty);
            if (!qty || isNaN(qty) || qty < 1) return badRequest('qty must be a positive integer', request);

            const loaded = await loadAssemblyForStage(id);
            if (!loaded) return notFound('Assembly not found', request);
            const a = loaded.assembly;

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();
            try {
                const lockReq = new sql.Request(transaction);
                lockReq.input('id', sql.Int, id);
                const lr = await lockReq.query(
                    'SELECT quantity, qty_fabbed, qty_welded, qty_completed FROM JobAssemblies WITH (UPDLOCK) WHERE id = @id'
                );
                const c = lr.recordset[0];
                const maxComplete = c.quantity - c.qty_fabbed - c.qty_completed;
                if (qty > maxComplete) {
                    await transaction.rollback();
                    return badRequest(`Only ${maxComplete} raw piece(s) left to complete on ${a.assembly_mark}. (Fabbed pieces finish via Weld.)`, request);
                }

                const performedBy = (body.performed_by || auth.name || '').trim() || null;
                const bomId = await applyBomDelta(transaction, a, loaded.heaviestProfile, qty, performedBy);

                const newCompleted = c.qty_completed + qty;
                const newStatus = deriveStatus(c.quantity, c.qty_welded, newCompleted, c.qty_fabbed);

                const upReq = new sql.Request(transaction);
                upReq.input('id', sql.Int, id);
                upReq.input('nc', sql.Int, newCompleted);
                upReq.input('st', sql.NVarChar(32), newStatus);
                let extra = '';
                if (newStatus === 'fabricated') {
                    upReq.input('fb', sql.NVarChar(256), performedBy);
                    upReq.input('wid', sql.Int, body.operator_id ? parseInt(body.operator_id) : null);
                    upReq.input('mid', sql.Int, body.welding_machine_id ? parseInt(body.welding_machine_id) : null);
                    extra = `, fabricated_at = SYSUTCDATETIME(), fabricated_by = @fb,
                              welder_id = COALESCE(@wid, welder_id),
                              welding_machine_id = COALESCE(@mid, welding_machine_id)`;
                }
                const up = await upReq.query(
                    `UPDATE JobAssemblies SET qty_completed = @nc, status = @st${extra}
                     OUTPUT INSERTED.* WHERE id = @id`
                );

                await recordAction(transaction, id, 'complete', qty,
                    body.operator_id ? parseInt(body.operator_id) : null,
                    (body.operator_name || '').trim() || null,
                    body.welding_machine_id ? parseInt(body.welding_machine_id) : null,
                    bomId, performedBy);

                await transaction.commit();
                const updated = up.recordset[0];
                updated.parts = a.parts;
                return ok({ assembly: updated, bom_item_id: bomId }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error marking complete:', err);
            return serverError('Failed to mark complete: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-assemblies/:id/rollback   — undo N pieces of a stage (draftsman)
// Body: { stage, qty, performed_by? }   stage: 'fab' | 'weld' | 'complete'
//
// Mirror of the fab/weld/complete endpoints. Sends pieces back a step:
//   fab      → qty_fabbed -= N       cap = qty_fabbed - qty_welded
//              (can't un-fab welded pieces; un-weld those first). No BOM.
//   weld     → qty_welded -= N       cap = min(qty_welded, open BOM qty)
//              removes N from the open BOM row (never a DN'd row).
//   complete → qty_completed -= N    cap = min(qty_completed, open BOM qty)
//              removes N from the open BOM row.
// Only pieces still on an OPEN (no-DN) BOM row can be pulled back — anything
// already on a raised DN is frozen and excluded by the cap. Logged to
// JobAssemblyActions with the same stage name and performed_by suffixed
// '(rollback)' so the audit trail stays honest without needing a new
// stage value (the CHECK constraint only allows fab/weld/complete).
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-rollback', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}/rollback',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);
            const body = await request.json();
            const stage = (body.stage || '').trim();
            const qty = parseInt(body.qty);
            if (!['fab', 'weld', 'complete'].includes(stage)) return badRequest("stage must be 'fab', 'weld' or 'complete'", request);
            if (!qty || isNaN(qty) || qty < 1) return badRequest('qty must be a positive integer', request);

            const loaded = await loadAssemblyForStage(id);
            if (!loaded) return notFound('Assembly not found', request);
            const a = loaded.assembly;

            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();
            try {
                const lockReq = new sql.Request(transaction);
                lockReq.input('id', sql.Int, id);
                const lr = await lockReq.query(
                    'SELECT quantity, qty_fabbed, qty_welded, qty_completed FROM JobAssemblies WITH (UPDLOCK) WHERE id = @id'
                );
                const c = lr.recordset[0];

                let newFabbed = c.qty_fabbed, newWelded = c.qty_welded, newCompleted = c.qty_completed;

                if (stage === 'fab') {
                    const cap = c.qty_fabbed - c.qty_welded;
                    if (qty > cap) { await transaction.rollback(); return badRequest(`Can only un-fab ${cap} piece(s) on ${a.assembly_mark} (welded pieces must be un-welded first).`, request); }
                    newFabbed = c.qty_fabbed - qty;
                } else if (stage === 'weld') {
                    // Compute open BOM qty inside the txn via the same predicate.
                    const obReq = new sql.Request(transaction);
                    obReq.input('aid', sql.Int, id);
                    const ob = await obReq.query(`SELECT ISNULL(SUM(quantity),0) AS q FROM JobBomItems WITH (UPDLOCK) WHERE source_assembly_id=@aid AND status IN ('pending','ready_for_despatch')`);
                    const openQ = Number(ob.recordset[0].q) || 0;
                    const cap = Math.min(c.qty_welded, openQ);
                    if (qty > cap) { await transaction.rollback(); return badRequest(`Can only un-weld ${cap} piece(s) on ${a.assembly_mark} (the rest are already on a delivery note).`, request); }
                    const removed = await removeBomDelta(transaction, id, qty);
                    newWelded = c.qty_welded - removed;
                } else { // complete
                    const obReq = new sql.Request(transaction);
                    obReq.input('aid', sql.Int, id);
                    const ob = await obReq.query(`SELECT ISNULL(SUM(quantity),0) AS q FROM JobBomItems WITH (UPDLOCK) WHERE source_assembly_id=@aid AND status IN ('pending','ready_for_despatch')`);
                    const openQ = Number(ob.recordset[0].q) || 0;
                    const cap = Math.min(c.qty_completed, openQ);
                    if (qty > cap) { await transaction.rollback(); return badRequest(`Can only un-complete ${cap} piece(s) on ${a.assembly_mark} (the rest are already on a delivery note).`, request); }
                    const removed = await removeBomDelta(transaction, id, qty);
                    newCompleted = c.qty_completed - removed;
                }

                const newStatus = deriveStatus(c.quantity, newWelded, newCompleted, newFabbed);
                const performedBy = ((body.performed_by || auth.name || '').trim() + ' (rollback)').trim();

                const upReq = new sql.Request(transaction);
                upReq.input('id', sql.Int, id);
                upReq.input('nf', sql.Int, newFabbed);
                upReq.input('nw', sql.Int, newWelded);
                upReq.input('nc', sql.Int, newCompleted);
                upReq.input('st', sql.NVarChar(32), newStatus);
                // Clear the legacy terminal stamps if we've dropped below terminal.
                const clearStamp = newStatus !== 'fabricated'
                    ? ', fabricated_at = NULL, fabricated_by = NULL'
                    : '';
                const up = await upReq.query(
                    `UPDATE JobAssemblies
                     SET qty_fabbed=@nf, qty_welded=@nw, qty_completed=@nc, status=@st${clearStamp}
                     OUTPUT INSERTED.* WHERE id=@id`
                );

                await recordAction(transaction, id, stage, qty, null, null, null, null, performedBy);

                await transaction.commit();
                const updated = up.recordset[0];
                updated.parts = a.parts;
                return ok({ assembly: updated }, request);
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }
        } catch (err) {
            context.error('Error rolling back stage:', err);
            return serverError('Failed to roll back: ' + err.message, request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/job-assemblies/:id/attach-pdf
// Attaches (or replaces) a SharePoint PDF reference on an existing assembly.
// Called after a manual-entry assembly has its PDF uploaded client-side.
//
// Body: { sharepoint_file_id, sharepoint_drive_id, sharepoint_web_url, file_name }
// ─────────────────────────────────────────────────────────────────────────────
app.http('job-assemblies-attach-pdf', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-assemblies/{id}/attach-pdf',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id || isNaN(id)) return badRequest('Invalid id', request);

            const body = await request.json();
            const { sharepoint_file_id, sharepoint_drive_id, sharepoint_web_url, file_name } = body;
            if (!sharepoint_file_id || !sharepoint_drive_id || !file_name) {
                return badRequest('sharepoint_file_id, sharepoint_drive_id and file_name are required', request);
            }

            const result = await query(
                `UPDATE JobAssemblies
                 SET sharepoint_file_id  = @spFileId,
                     sharepoint_drive_id = @spDriveId,
                     sharepoint_web_url  = @spWebUrl,
                     file_name           = @fileName
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                {
                    id,
                    spFileId:  sharepoint_file_id,
                    spDriveId: sharepoint_drive_id,
                    spWebUrl:  sharepoint_web_url ?? null,
                    fileName:  file_name
                }
            );

            if (!result.recordset.length) return notFound('Assembly not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error attaching PDF to assembly:', err);
            return serverError('Failed to attach PDF: ' + err.message, request);
        }
    }
});
