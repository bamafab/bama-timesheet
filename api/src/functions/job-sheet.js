const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, badRequest, serverError, preflight } = require('../responses');

// ═══════════════════════════════════════════════════════════════
// Job Sheet — per-job site/delivery details (JobSheets table).
//
// One row per DrawingJobs row (job_id PK, ON DELETE CASCADE).
// This is the default prefill source for SDN / Site Pack / RAMS.
// Supplier DNs (galv/powder) do NOT read from here.
//
// Flat routes per CLAUDE.md convention:
//   GET /api/job-sheet/{jobId}  → row (or {} when none saved yet)
//   PUT /api/job-sheet/{jobId}  → upsert, returns the saved row
// ═══════════════════════════════════════════════════════════════

const FIELDS = [
    'site_name', 'address_line1', 'address_line2', 'city', 'county',
    'postcode', 'contact_name', 'contact_phone', 'contact_email',
    'client_po_number', 'notes'
];

// OPTIONS preflight
app.http('job-sheet-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'job-sheet/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/job-sheet/:jobId
app.http('job-sheet-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'job-sheet/{jobId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const jobId = parseInt(request.params.jobId);
            if (!jobId) return badRequest('Invalid job id', request);

            const res = await query(
                'SELECT * FROM JobSheets WHERE job_id = @jobId',
                { jobId }
            );
            // No row yet is a normal state (job sheet not filled in) —
            // return an empty object, not a 404, so the frontend loader
            // can treat "missing" and "present" uniformly.
            return ok(res.recordset[0] || {}, request);
        } catch (err) {
            context.error('Error fetching job sheet:', err);
            return serverError('Failed to fetch job sheet', request);
        }
    }
});

// PUT /api/job-sheet/:jobId — upsert
app.http('job-sheet-upsert', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'job-sheet/{jobId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const jobId = parseInt(request.params.jobId);
            if (!jobId) return badRequest('Invalid job id', request);
            const body = await request.json();

            // Job must exist (FK would also enforce this, but a clean
            // 400 beats a raw SQL error).
            const jobRes = await query('SELECT id FROM DrawingJobs WHERE id = @jobId', { jobId });
            if (jobRes.recordset.length === 0) return badRequest('Job not found', request);

            const params = { jobId, updatedBy: body.updated_by || auth.email || null };
            const setPairs = [];
            const insertCols = ['job_id', 'updated_at', 'updated_by'];
            const insertVals = ['@jobId', 'GETUTCDATE()', '@updatedBy'];

            for (const f of FIELDS) {
                const key = f.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase());
                const raw = body[f];
                params[key] = (raw === undefined || raw === null || String(raw).trim() === '')
                    ? null : String(raw).trim();
                setPairs.push(`${f} = @${key}`);
                insertCols.push(f);
                insertVals.push(`@${key}`);
            }

            // UPDATE-then-INSERT upsert (single-writer UI; no MERGE needed)
            const upd = await query(
                `UPDATE JobSheets SET ${setPairs.join(', ')},
                        updated_at = GETUTCDATE(), updated_by = @updatedBy
                 OUTPUT INSERTED.* WHERE job_id = @jobId`,
                params
            );
            if (upd.recordset.length > 0) return ok(upd.recordset[0], request);

            const ins = await query(
                `INSERT INTO JobSheets (${insertCols.join(', ')})
                 OUTPUT INSERTED.*
                 VALUES (${insertVals.join(', ')})`,
                params
            );
            return ok(ins.recordset[0], request);
        } catch (err) {
            context.error('Error saving job sheet:', err);
            return serverError('Failed to save job sheet', request);
        }
    }
});
