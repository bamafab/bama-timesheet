// ─────────────────────────────────────────────────────────────────────────────
// rams-documents.js — RAMS register (numbering + revisions + multi-job merge)
//
// Every generated RAMS is persisted here so it can be REVISED later instead of
// rebuilt from scratch. Numbering is per-project: rams_no 1, 2, 3… printed as
// "<project> - 001 - <title>". A revision is a NEW row sharing project_id +
// rams_no with revision+1; all earlier rows of that number are flagged
// superseded (kept, with their PDFs, for the audit trail). job_ids is a JSON
// array — one RAMS can cover several jobs (merge), and the PDF is registered
// against each of them in DrawingElementFiles by the client.
//
// Routes (flat — never sub-paths of parameterised routes):
//   GET  /api/rams-docs?projectId=X        — register rows (no rams_data blob)
//   GET  /api/rams-docs/{id}               — one row incl. rams_data
//   GET  /api/rams-next-no?projectId=X[&ramsNo=Y]
//        — next rams_no for a NEW rams, or next revision for an existing no
//   POST /api/rams-docs                    — insert new rams / new revision;
//        collision-guarded on (project_id, rams_no, revision); a revision
//        insert flips superseded=1 on the earlier rows of that number.
//
// Table: RamsDocuments (api/sql/create-rams-documents.sql). New table =>
// no Function App restart needed.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ── OPTIONS preflights ───────────────────────────────────────────────────────
app.http('rams-docs-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'rams-docs/{*rest}',
    handler: async (req) => preflight(req)
});
app.http('rams-next-no-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'rams-next-no',
    handler: async (req) => preflight(req)
});

const LIST_COLS = `id, project_id, rams_no, revision, title, doc_no, job_ids,
    pdf_file_id, pdf_drive_id, pdf_web_url, docx_file_id, docx_drive_id, docx_web_url,
    superseded, created_at, created_by`;

// ── GET /api/rams-docs?projectId=X ──────────────────────────────────────────
app.http('rams-docs-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'rams-docs',
    handler: async (request, context) => {
        const auth = requireAuth(request); if (auth.error) return auth.error;
        try {
            const projectId = parseInt(new URL(request.url).searchParams.get('projectId'));
            if (!projectId) return badRequest(request, 'projectId is required');
            const rows = await query(
                `SELECT ${LIST_COLS} FROM RamsDocuments
                 WHERE project_id = @projectId
                 ORDER BY rams_no ASC, revision ASC`,
                { projectId }
            );
            return ok(request, rows.recordset);
        } catch (e) {
            context.error('rams-docs-list', e);
            return serverError(request, e.message);
        }
    }
});

// ── GET /api/rams-docs/{id} — full row incl. rams_data blob ─────────────────
app.http('rams-docs-get', {
    methods: ['GET'], authLevel: 'anonymous', route: 'rams-docs/{id:int}',
    handler: async (request, context) => {
        const auth = requireAuth(request); if (auth.error) return auth.error;
        try {
            const id = parseInt(request.params.id);
            const rows = await query(
                `SELECT ${LIST_COLS}, rams_data FROM RamsDocuments WHERE id = @id`, { id });
            if (!rows.recordset.length) return notFound(request, 'RAMS document not found');
            return ok(request, rows.recordset[0]);
        } catch (e) {
            context.error('rams-docs-get', e);
            return serverError(request, e.message);
        }
    }
});

// ── GET /api/rams-next-no?projectId=X[&ramsNo=Y] ────────────────────────────
// Without ramsNo: { rams_no: <next free>, revision: 0 }.
// With ramsNo:    { rams_no: Y, revision: <max existing rev + 1> }.
app.http('rams-next-no', {
    methods: ['GET'], authLevel: 'anonymous', route: 'rams-next-no',
    handler: async (request, context) => {
        const auth = requireAuth(request); if (auth.error) return auth.error;
        try {
            const sp = new URL(request.url).searchParams;
            const projectId = parseInt(sp.get('projectId'));
            if (!projectId) return badRequest(request, 'projectId is required');
            const ramsNo = parseInt(sp.get('ramsNo')) || null;
            if (ramsNo) {
                const rows = await query(
                    `SELECT MAX(revision) AS maxRev FROM RamsDocuments
                     WHERE project_id = @projectId AND rams_no = @ramsNo`,
                    { projectId, ramsNo });
                const maxRev = rows.recordset[0]?.maxRev;
                if (maxRev == null) return notFound(request, `RAMS ${ramsNo} not found for this project`);
                return ok(request, { rams_no: ramsNo, revision: maxRev + 1 });
            }
            const rows = await query(
                `SELECT ISNULL(MAX(rams_no), 0) + 1 AS nextNo FROM RamsDocuments
                 WHERE project_id = @projectId`, { projectId });
            return ok(request, { rams_no: rows.recordset[0].nextNo, revision: 0 });
        } catch (e) {
            context.error('rams-next-no', e);
            return serverError(request, e.message);
        }
    }
});

// ── POST /api/rams-docs — insert new rams or new revision ───────────────────
app.http('rams-docs-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'rams-docs',
    handler: async (request, context) => {
        const auth = requireAuth(request); if (auth.error) return auth.error;
        try {
            const b = await request.json();
            const projectId = parseInt(b.project_id);
            const ramsNo = parseInt(b.rams_no);
            const revision = parseInt(b.revision);
            if (!projectId || !ramsNo || isNaN(revision) || revision < 0)
                return badRequest(request, 'project_id, rams_no and revision are required');
            const jobIds = Array.isArray(b.job_ids) ? b.job_ids.map(Number).filter(Boolean) : [];
            if (!jobIds.length) return badRequest(request, 'job_ids must contain at least one job');

            // Collision guard — same pattern as qb-next-ref: the number was
            // handed out by rams-next-no, verify nobody claimed it since.
            const clash = await query(
                `SELECT id FROM RamsDocuments
                 WHERE project_id = @projectId AND rams_no = @ramsNo AND revision = @revision`,
                { projectId, ramsNo, revision });
            if (clash.recordset.length)
                return badRequest(request, `RAMS ${ramsNo} Rev ${revision} already exists for this project — reopen the modal to pick up the next number.`);

            // A revision supersedes every earlier row of that number.
            if (revision > 0) {
                await query(
                    `UPDATE RamsDocuments SET superseded = 1
                     WHERE project_id = @projectId AND rams_no = @ramsNo AND revision < @revision`,
                    { projectId, ramsNo, revision });
            }

            const ins = await query(
                `INSERT INTO RamsDocuments
                   (project_id, rams_no, revision, title, doc_no, job_ids, rams_data,
                    pdf_file_id, pdf_drive_id, pdf_web_url,
                    docx_file_id, docx_drive_id, docx_web_url, created_by)
                 OUTPUT INSERTED.id, INSERTED.created_at
                 VALUES
                   (@projectId, @ramsNo, @revision, @title, @docNo, @jobIds, @ramsData,
                    @pdfFileId, @pdfDriveId, @pdfWebUrl,
                    @docxFileId, @docxDriveId, @docxWebUrl, @createdBy)`,
                {
                    projectId, ramsNo, revision,
                    title: b.title || null,
                    docNo: b.doc_no || null,
                    jobIds: JSON.stringify(jobIds),
                    ramsData: (typeof b.rams_data === 'string') ? b.rams_data : JSON.stringify(b.rams_data || {}),
                    pdfFileId: b.pdf_file_id || null,
                    pdfDriveId: b.pdf_drive_id || null,
                    pdfWebUrl: b.pdf_web_url || null,
                    docxFileId: b.docx_file_id || null,
                    docxDriveId: b.docx_drive_id || null,
                    docxWebUrl: b.docx_web_url || null,
                    createdBy: b.created_by || auth.name || auth.email || null
                });
            const row = ins.recordset[0];

            // Audit — non-fatal by design.
            await logChange('rams', row.id, b.doc_no || `RAMS ${ramsNo}`,
                revision > 0 ? 'revision_issued' : 'created',
                revision > 0 ? `Rev ${revision - 1}` : null,
                `Rev ${revision} (jobs: ${jobIds.join(', ')})`,
                b.created_by || auth.name || auth.email);

            return created(request, {
                id: row.id, project_id: projectId, rams_no: ramsNo, revision,
                title: b.title || null, doc_no: b.doc_no || null,
                job_ids: JSON.stringify(jobIds), superseded: false,
                created_at: row.created_at
            });
        } catch (e) {
            context.error('rams-docs-create', e);
            return serverError(request, e.message);
        }
    }
});
