// ─────────────────────────────────────────────────────────────────────────────
// fab-output.js — workshop output ledger for reporting (Phase C2b)
//
//   GET /api/fab-output?from=2026-07-01&to=2026-07-29[&stage=fab|weld|complete]
//
// Reads JobAssemblyActions (the per-move audit trail written by the fab/weld/
// complete endpoints since the staged-fabrication build) joined to assemblies
// and jobs, so every row carries: date, who, stage, pieces, kilograms
// (qty × assembly weight-each), project number and job name. Read-only.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, badRequest, serverError, preflight } = require('../responses');

app.http('fab-output-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'fab-output',
    handler: async (request) => preflight(request)
});

app.http('fab-output', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'fab-output',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const from = request.query.get('from');
            const to = request.query.get('to');
            if (!from || !to) return badRequest('from and to (YYYY-MM-DD) are required', request);
            const stage = request.query.get('stage');

            let sqlText = `
                SELECT CONVERT(varchar(10), a.performed_at, 23)      AS date,
                       COALESCE(a.operator_name, a.performed_by, 'Unassigned') AS operator,
                       a.stage,
                       a.qty,
                       ROUND(a.qty * ISNULL(ja.total_weight_kg, 0), 1) AS kg,
                       ja.assembly_mark,
                       dj.project_number,
                       dj.job_name
                  FROM JobAssemblyActions a
                  JOIN JobAssemblies ja ON ja.id = a.assembly_id
                  JOIN DrawingJobs  dj ON dj.id = ja.job_id
                 WHERE a.performed_at >= @from
                   AND a.performed_at < DATEADD(day, 1, CAST(@to AS date))`;
            const params = { from, to };
            if (stage) { sqlText += ' AND a.stage = @stage'; params.stage = stage; }
            sqlText += ' ORDER BY a.performed_at ASC';

            const r = await query(sqlText, params);
            return ok(r.recordset, request);
        } catch (err) {
            context.error('fab-output:', err);
            return serverError('Failed to read fab output', request);
        }
    }
});
