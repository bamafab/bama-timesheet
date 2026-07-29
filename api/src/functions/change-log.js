// ─────────────────────────────────────────────────────────────────────────────
// change-log.js — read the audit trail (Fault Register F6 / Phase B3)
//
//   GET /api/change-log?limit=100&entity_type=qb_quote&entity_id=7&ref=Q260712
//
// Read-only. Newest first.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, serverError, preflight } = require('../responses');

app.http('change-log-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'change-log',
    handler: async (request) => preflight(request)
});

app.http('change-log-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'change-log',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const limit = Math.min(parseInt(request.query.get('limit')) || 100, 500);
            const where = [], params = { limit };
            const et = request.query.get('entity_type');
            const eid = parseInt(request.query.get('entity_id'));
            const ref = request.query.get('ref');
            if (et)  { where.push('entity_type = @et');  params.et = et; }
            if (eid) { where.push('entity_id = @eid');   params.eid = eid; }
            if (ref) { where.push('entity_ref = @ref');  params.ref = ref; }
            const sql = `SELECT TOP (@limit) id, entity_type, entity_id, entity_ref,
                                action, old_value, new_value, changed_by,
                                CONVERT(varchar(19), changed_at, 120) AS changed_at
                           FROM ChangeLog
                          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                          ORDER BY changed_at DESC, id DESC`;
            const r = await query(sql, params);
            return ok(r.recordset, request);
        } catch (err) {
            // Table may not exist yet — return empty rather than erroring the UI
            if (/Invalid object name/i.test(err.message)) return ok([], request);
            context.error('change-log-list:', err);
            return serverError('Failed to read change log', request);
        }
    }
});
