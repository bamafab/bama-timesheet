// ─────────────────────────────────────────────────────────────────────────────
// itp.js  (F1a — Inspection & Test Plan, 2026-07-30)
//
// ITP rows hang off JobInspectionPlans so the plan and the real NDT sampling
// share one exec class and one set of verified percentages.
//
// Routes:
//   GET    /api/itp-rows            — ?plan_id= or ?job_id=
//   POST   /api/itp-rows            — one row
//   POST   /api/itp-rows-bulk       — replace the AUTO rows for a plan
//                                     (hand-added rows are preserved)
//   PUT    /api/itp-rows/{id}       — edit a row
//   DELETE /api/itp-rows/{id}       — soft delete
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const INTERVENTIONS = ['H', 'W', 'S', 'R'];
const COLS = `id, plan_id, job_id, seq, stage, activity, ref_doc, acceptance, intervention,
    frequency, responsibility, record_ref, ndt_category, inspection_type, is_auto, notes,
    created_at, updated_at`;

const FIELDS = {
    seq:             v => Number.isFinite(+v) ? +v : 0,
    stage:           v => v ? String(v).slice(0, 60) : null,
    activity:        v => String(v || '').slice(0, 300),
    ref_doc:         v => v ? String(v).slice(0, 200) : null,
    acceptance:      v => v ? String(v).slice(0, 300) : null,
    intervention:    v => INTERVENTIONS.includes(v) ? v : 'S',
    frequency:       v => v ? String(v).slice(0, 80) : null,
    responsibility:  v => v ? String(v).slice(0, 120) : null,
    record_ref:      v => v ? String(v).slice(0, 120) : null,
    ndt_category:    v => v ? String(v).slice(0, 80) : null,
    inspection_type: v => v ? String(v).slice(0, 20) : null,
    is_auto:         v => v ? 1 : 0,
    notes:           v => v || null
};

for (const r of ['itp-rows', 'itp-rows-bulk']) {
    app.http(r + '-options', {
        methods: ['OPTIONS'], authLevel: 'anonymous',
        route: r + '/{*rest}', handler: async (req) => preflight(req)
    });
}

app.http('itp-rows-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'itp-rows',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const planId = parseInt(sp.get('plan_id')), jobId = parseInt(sp.get('job_id'));
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(planId))     { where += ' AND plan_id = @pid'; params.pid = planId; }
            else if (Number.isFinite(jobId)) { where += ' AND job_id = @jid';  params.jid = jobId; }
            const res = await query(`SELECT ${COLS} FROM ItpRows WHERE ${where} ORDER BY seq, id`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('itp-rows list error:', err);
            return serverError('Failed to load the ITP', request);
        }
    }
});

app.http('itp-rows-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'itp-rows',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const planId = parseInt(b.plan_id), jobId = parseInt(b.job_id);
            if (!Number.isFinite(planId)) return badRequest('plan_id is required', request);
            if (!Number.isFinite(jobId))  return badRequest('job_id is required', request);
            if (!b.activity || !String(b.activity).trim()) return badRequest('activity is required', request);
            const keys = Object.keys(FIELDS);
            const params = { plan_id: planId, job_id: jobId };
            keys.forEach(k => { params[k] = FIELDS[k](b[k]); });
            const res = await query(
                `INSERT INTO ItpRows (plan_id, job_id, ${keys.join(', ')})
                 OUTPUT INSERTED.id VALUES (@plan_id, @job_id, ${keys.map(k => '@' + k).join(', ')})`, params);
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('itp-rows create error:', err);
            return serverError('Failed to add the ITP row', request);
        }
    }
});

// Replace only the AUTO rows. A client's hand-added hold point must survive
// regeneration — losing one silently would be worse than not regenerating.
app.http('itp-rows-bulk', {
    methods: ['POST'], authLevel: 'anonymous', route: 'itp-rows-bulk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const planId = parseInt(b.plan_id), jobId = parseInt(b.job_id);
            if (!Number.isFinite(planId)) return badRequest('plan_id is required', request);
            if (!Number.isFinite(jobId))  return badRequest('job_id is required', request);
            const rows = Array.isArray(b.rows) ? b.rows : [];

            await query(`UPDATE ItpRows SET is_deleted = 1 WHERE plan_id = @pid AND is_auto = 1 AND is_deleted = 0`, { pid: planId });
            const keys = Object.keys(FIELDS);
            let inserted = 0;
            for (const row of rows) {
                if (!row.activity || !String(row.activity).trim()) continue;
                const params = { plan_id: planId, job_id: jobId };
                keys.forEach(k => { params[k] = FIELDS[k](k === 'is_auto' ? 1 : row[k]); });
                await query(
                    `INSERT INTO ItpRows (plan_id, job_id, ${keys.join(', ')})
                     VALUES (@plan_id, @job_id, ${keys.map(k => '@' + k).join(', ')})`, params);
                inserted++;
            }
            const kept = await query(
                `SELECT COUNT(*) AS n FROM ItpRows WHERE plan_id = @pid AND is_auto = 0 AND is_deleted = 0`, { pid: planId });
            await logChange('itp', planId, `Job ${jobId}`, 'regenerated', null,
                `${inserted} generated rows`, auth.name || auth.email);
            return ok({ inserted, hand_added_kept: kept.recordset[0].n }, request);
        } catch (err) {
            context.error('itp-rows bulk error:', err);
            return serverError('Failed to regenerate the ITP', request);
        }
    }
});

app.http('itp-rows-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'itp-rows/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid row id', request);
            const cur = await query(`SELECT id FROM ItpRows WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('ITP row not found', request);
            const b = await request.json();
            const sets = []; const params = { id };
            for (const [f, coerce] of Object.entries(FIELDS)) {
                if (!(f in b)) continue;
                if (f === 'activity' && !String(b[f] || '').trim()) continue;
                sets.push(`${f} = @${f}`); params[f] = coerce(b[f]);
            }
            // Editing a generated row makes it the user's — so regeneration
            // won't wipe the change they just made.
            if (sets.length && !('is_auto' in b)) { sets.push('is_auto = 0'); params.is_auto = 0; }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE ItpRows SET ${sets.join(', ')} WHERE id = @id`, params);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('itp-rows update error:', err);
            return serverError('Failed to update the ITP row', request);
        }
    }
});

app.http('itp-rows-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'itp-rows/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid row id', request);
            const cur = await query(`SELECT id, job_id, activity FROM ItpRows WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('ITP row not found', request);
            await query(`UPDATE ItpRows SET is_deleted = 1 WHERE id = @id`, { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('itp-rows delete error:', err);
            return serverError('Failed to delete the ITP row', request);
        }
    }
});
