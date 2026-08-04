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
    'bama_contact_name', 'bama_contact_phone',
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

// ═══════════════════════════════════════════════════════════════
// Extras: won QB quote summary + per-job fabrication stats.
// GET /api/project-sheet/:projectId/extras
// Returns { quote: {...}|null, jobs: [...] }. Both halves degrade
// independently — a missing QuoteBuilderQuotes/ProjectQuotes table
// (older env) just yields quote: null.
// ═══════════════════════════════════════════════════════════════
app.http('project-sheet-extras', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-sheet/{projectId}/extras',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const projectId = parseInt(request.params.projectId);
            if (!projectId) return badRequest('Invalid project id', request);

            // ── Quote summary (hours live in the quote_data JSON blob) ──
            let quote = null;
            const quoteSelect = `
                SELECT TOP 1 q.id, q.reference, q.revision, q.status,
                       q.total_kg, q.site_address,
                       JSON_VALUE(q.quote_data, '$.fabHours')       AS fab_hours,
                       JSON_VALUE(q.quote_data, '$.designHours')    AS design_hours,
                       JSON_VALUE(q.quote_data, '$.instDays')       AS inst_days,
                       JSON_VALUE(q.quote_data, '$.instOperatives') AS inst_operatives,
                       JSON_VALUE(q.quote_data, '$.siteAddress')    AS json_site_address
                FROM QuoteBuilderQuotes q`;
            try {
                // Preferred: direct link OR ProjectQuotes join, primary first
                const res = await query(quoteSelect + `
                    LEFT JOIN ProjectQuotes pq
                           ON pq.qb_quote_id = q.id AND pq.project_id = @projectId
                    WHERE q.project_id = @projectId OR pq.project_id = @projectId
                    ORDER BY CASE WHEN pq.is_primary = 1 THEN 0 ELSE 1 END,
                             q.updated_at DESC`, { projectId });
                quote = res.recordset[0] || null;
            } catch (e1) {
                // ProjectQuotes may not exist in this environment — direct link only
                try {
                    const res = await query(quoteSelect + `
                        WHERE q.project_id = @projectId
                        ORDER BY q.updated_at DESC`, { projectId });
                    quote = res.recordset[0] || null;
                } catch (e2) {
                    context.warn('Quote summary unavailable:', e2.message);
                }
            }
            if (quote) quote.source = 'qb';

            // Fallback: no QB quote linked — pull what the Project Tracker
            // holds (source Tender reference + carried-over quote value).
            // Older projects (pre-QB) live entirely on this path.
            if (!quote) {
                try {
                    const res = await query(`
                        SELECT p.project_number, p.quote_value AS project_quote_value,
                               t.reference AS tender_reference, t.quote_value AS tender_quote_value
                        FROM Projects p
                        LEFT JOIN Tenders t ON t.id = p.source_quote_id
                        WHERE p.id = @projectId`, { projectId });
                    const row = res.recordset[0];
                    if (row) {
                        const value = row.tender_quote_value ?? row.project_quote_value ?? null;
                        // project_number mirrors the source quote ref (C260502 ⇄ Q260502)
                        const ref = row.tender_reference ||
                            (String(row.project_number || '').replace(/^C/i, 'Q') || null);
                        if (value != null || row.tender_reference) {
                            quote = { source: 'tracker', reference: ref, revision: '',
                                      quote_value: value };
                        }
                    }
                } catch (e) {
                    context.warn('Tracker quote fallback unavailable:', e.message);
                }
            }

            // ── Per-job stats: members + tonnage from JobAssemblies ──
            // total_weight_kg is the weight of ONE assembly, so tonnage
            // = SUM(quantity * total_weight_kg). DrawingJobs links to
            // Projects by project_number (string), not FK.
            let jobs = [];
            try {
                const res = await query(`
                    SELECT j.id AS job_id, j.job_name,
                           COUNT(a.id)                                        AS assembly_marks,
                           COALESCE(SUM(a.quantity), 0)                       AS members,
                           COALESCE(SUM(a.quantity * a.total_weight_kg), 0)   AS weight_kg
                    FROM DrawingJobs j
                    LEFT JOIN JobAssemblies a ON a.job_id = j.id
                    WHERE j.project_number = (SELECT project_number FROM Projects WHERE id = @projectId)
                    GROUP BY j.id, j.job_name
                    ORDER BY j.id`, { projectId });
                jobs = res.recordset;
            } catch (e) {
                context.warn('Job stats unavailable:', e.message);
            }

            return ok({ quote, jobs }, request);
        } catch (err) {
            context.error('Error fetching project sheet extras:', err);
            return serverError('Failed to fetch project sheet extras', request);
        }
    }
});

// ═══════════════════════════════════════════════════════════════
// Revisions ledger — base quote + Variation Orders, per job.
// ═══════════════════════════════════════════════════════════════

// GET /api/project-sheet/:projectId/revisions
app.http('project-sheet-revisions-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-sheet/{projectId}/revisions',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(request.params.projectId);
            if (!projectId) return badRequest('Invalid project id', request);
            const res = await query(`
                SELECT r.*, j.job_name
                FROM ProjectSheetRevisions r
                LEFT JOIN DrawingJobs j ON j.id = r.job_id
                WHERE r.project_id = @projectId
                ORDER BY r.created_at ASC, r.id ASC`, { projectId });
            return ok(res.recordset, request);
        } catch (err) {
            context.error('Error fetching revisions:', err);
            return serverError('Failed to fetch revisions', request);
        }
    }
});

// POST /api/project-sheet/:projectId/revisions
app.http('project-sheet-revisions-add', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'project-sheet/{projectId}/revisions',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(request.params.projectId);
            if (!projectId) return badRequest('Invalid project id', request);
            const body = await request.json();
            const label = String(body.label || '').trim();
            if (!label) return badRequest('Label is required', request);

            const num = v => (v === undefined || v === null || String(v).trim() === '')
                ? null : parseFloat(v);

            const res = await query(`
                INSERT INTO ProjectSheetRevisions
                    (project_id, job_id, label, description,
                     fab_hours, design_hours, site_operatives, site_days, created_by)
                OUTPUT INSERTED.*
                VALUES (@projectId, @jobId, @label, @description,
                        @fabHours, @designHours, @siteOperatives, @siteDays, @createdBy)`, {
                projectId,
                jobId:          body.job_id ? parseInt(body.job_id) : null,
                label,
                description:    String(body.description || '').trim() || null,
                fabHours:       num(body.fab_hours),
                designHours:    num(body.design_hours),
                siteOperatives: num(body.site_operatives),
                siteDays:       num(body.site_days),
                createdBy:      body.created_by || auth.email || null
            });
            return ok(res.recordset[0], request);
        } catch (err) {
            context.error('Error adding revision:', err);
            return serverError('Failed to add revision', request);
        }
    }
});

// DELETE /api/project-sheet-revisions/:id  (flat route — no collision)
app.http('project-sheet-revisions-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'project-sheet-revisions/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid revision id', request);
            const res = await query(
                'DELETE FROM ProjectSheetRevisions OUTPUT DELETED.* WHERE id = @id', { id });
            if (res.recordset.length === 0) return badRequest('Revision not found', request);
            return ok(res.recordset[0], request);
        } catch (err) {
            context.error('Error deleting revision:', err);
            return serverError('Failed to delete revision', request);
        }
    }
});
