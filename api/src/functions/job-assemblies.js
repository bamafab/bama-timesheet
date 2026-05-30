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
// Out of scope for this file (later commits):
//   PUT    /api/job-assemblies/:id/fabricate   mark fabricated + BOM row (commit 8)
//   GET    /api/job-assemblies/kiosk           kiosk Fabrication tile (commit 11)

const { app } = require('@azure/functions');
const { query, getPool, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError } = require('../responses');

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
                    if (!p.part_mark || !p.profile) {
                        throw new Error(`Part ${i + 1}: part_mark and profile are required`);
                    }
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
                        st.name AS finish_name
                 FROM JobAssemblies a
                 JOIN DrawingJobs j ON j.id = a.job_id
                 JOIN Projects    p ON p.project_number = j.project_number
                 LEFT JOIN ServiceTypes st ON st.id = a.finish_service_id
                 WHERE p.status = 'In Progress'
                   AND (a.status = 'pending'
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

            const bomStatus = assembly.finish_service_id ? 'pending' : 'ready_for_despatch';

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
