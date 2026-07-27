const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, badRequest, serverError, preflight } = require('../responses');

// ═══════════════════════════════════════════════════════════════
// Job Sheet (project-level) — site/delivery details for a project
// (ProjectSheets table, one row per Projects row).
//
// UI still calls this "Job Sheet", but it lives at PROJECT level:
// two different site addresses within one project is rare, so all
// jobs under a project share the same sheet. This is the default
// prefill source for SDN / Site Pack / RAMS. Supplier DNs
// (galv/powder) do NOT read from here.
//
// Flat routes per CLAUDE.md convention:
//   GET /api/project-sheet/{projectId}  → row (or {} when none saved)
//   PUT /api/project-sheet/{projectId}  → upsert, returns saved row
// projectId = Projects.id (int), NOT the project_number string.
// ═══════════════════════════════════════════════════════════════

const FIELDS = [
    'site_name', 'address_line1', 'address_line2', 'city', 'county',
    'postcode',
    'commercial_name', 'commercial_phone', 'commercial_email',
    'pm_name', 'pm_phone', 'pm_email',
    'site_manager_name', 'site_manager_phone', 'site_manager_email',
    'client_po_number', 'notes'
];

// OPTIONS preflight
app.http('project-sheet-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'project-sheet/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/project-sheet/:projectId
app.http('project-sheet-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-sheet/{projectId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const projectId = parseInt(request.params.projectId);
            if (!projectId) return badRequest('Invalid project id', request);

            const res = await query(
                'SELECT * FROM ProjectSheets WHERE project_id = @projectId',
                { projectId }
            );
            // No row yet is a normal state (sheet not filled in) — return
            // an empty object, not a 404, so the frontend loader treats
            // "missing" and "present" uniformly.
            return ok(res.recordset[0] || {}, request);
        } catch (err) {
            context.error('Error fetching project sheet:', err);
            return serverError('Failed to fetch project sheet', request);
        }
    }
});

// PUT /api/project-sheet/:projectId — upsert
app.http('project-sheet-upsert', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'project-sheet/{projectId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const projectId = parseInt(request.params.projectId);
            if (!projectId) return badRequest('Invalid project id', request);
            const body = await request.json();

            // Project must exist (FK would also enforce this, but a clean
            // 400 beats a raw SQL error).
            const projRes = await query('SELECT id FROM Projects WHERE id = @projectId', { projectId });
            if (projRes.recordset.length === 0) return badRequest('Project not found', request);

            const params = { projectId, updatedBy: body.updated_by || auth.email || null };
            const setPairs = [];
            const insertCols = ['project_id', 'updated_at', 'updated_by'];
            const insertVals = ['@projectId', 'GETUTCDATE()', '@updatedBy'];

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
                `UPDATE ProjectSheets SET ${setPairs.join(', ')},
                        updated_at = GETUTCDATE(), updated_by = @updatedBy
                 OUTPUT INSERTED.* WHERE project_id = @projectId`,
                params
            );
            if (upd.recordset.length > 0) return ok(upd.recordset[0], request);

            const ins = await query(
                `INSERT INTO ProjectSheets (${insertCols.join(', ')})
                 OUTPUT INSERTED.*
                 VALUES (${insertVals.join(', ')})`,
                params
            );
            return ok(ins.recordset[0], request);
        } catch (err) {
            context.error('Error saving project sheet:', err);
            return serverError('Failed to save project sheet', request);
        }
    }
});
