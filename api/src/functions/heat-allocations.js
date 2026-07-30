// ─────────────────────────────────────────────────────────────────────────────
// heat-allocations.js  (material traceability, 2026-07-30)
//
// Joins heat/cast numbers to assemblies — the link that turns contract-level
// traceability into piece-level. Optional by design: allocate where it matters,
// and the traceability report states which level each assembly actually reaches
// rather than implying piece level everywhere.
//
// Routes:
//   GET    /api/heat-allocations           — ?job_id= or ?assembly_id= or ?heat_no=
//   POST   /api/heat-allocations           — one allocation
//   POST   /api/heat-allocations-bulk      — many at once (tick heats × assemblies)
//   DELETE /api/heat-allocations/{id}      — soft delete
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const COLS = `id, job_id, assembly_id, assembly_mark, heat_no, section, grade, supplier,
    po_number, qms_submission_id, qty, notes, created_by, created_at`;

for (const r of ['heat-allocations', 'heat-allocations-bulk']) {
    app.http(r + '-options', {
        methods: ['OPTIONS'], authLevel: 'anonymous',
        route: r + '/{*rest}', handler: async (req) => preflight(req)
    });
}

app.http('heat-allocations-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'heat-allocations',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const jobId = parseInt(sp.get('job_id')), asmId = parseInt(sp.get('assembly_id'));
            const heat = sp.get('heat_no');
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(jobId)) { where += ' AND job_id = @jid'; params.jid = jobId; }
            if (Number.isFinite(asmId)) { where += ' AND assembly_id = @aid'; params.aid = asmId; }
            if (heat)                   { where += ' AND heat_no = @heat'; params.heat = heat; }
            const res = await query(
                `SELECT ${COLS} FROM AssemblyHeatAllocations WHERE ${where}
                 ORDER BY assembly_mark, heat_no`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('heat-allocations list error:', err);
            return serverError('Failed to load heat allocations', request);
        }
    }
});

const insert = async (b, auth) => query(
    `INSERT INTO AssemblyHeatAllocations
       (job_id, assembly_id, assembly_mark, heat_no, section, grade, supplier, po_number,
        qms_submission_id, qty, notes, created_by)
     OUTPUT INSERTED.id
     VALUES (@jid, @aid, @mark, @heat, @sec, @grade, @sup, @po, @qms, @qty, @notes, @by)`,
    {
        jid: parseInt(b.job_id),
        aid: Number.isFinite(+b.assembly_id) ? +b.assembly_id : null,
        mark: b.assembly_mark || null,
        heat: String(b.heat_no).trim().slice(0, 100),
        sec: b.section || null, grade: b.grade || null,
        sup: b.supplier || null, po: b.po_number || null,
        qms: Number.isFinite(+b.qms_submission_id) ? +b.qms_submission_id : null,
        qty: b.qty || null, notes: b.notes || null,
        by: auth.name || auth.email || null
    });

app.http('heat-allocations-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'heat-allocations',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!Number.isFinite(parseInt(b.job_id))) return badRequest('job_id is required', request);
            if (!b.heat_no || !String(b.heat_no).trim()) return badRequest('heat_no is required', request);
            const res = await insert(b, auth);
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('heat-allocations create error:', err);
            return serverError('Failed to save the allocation', request);
        }
    }
});

// Tick a set of heats against a set of assemblies. Existing rows for the same
// (assembly, heat) pair are skipped rather than duplicated — allocating twice
// is a natural thing to do by accident and shouldn't double the paperwork.
app.http('heat-allocations-bulk', {
    methods: ['POST'], authLevel: 'anonymous', route: 'heat-allocations-bulk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const jobId = parseInt(b.job_id);
            if (!Number.isFinite(jobId)) return badRequest('job_id is required', request);
            const rows = Array.isArray(b.rows) ? b.rows : [];
            if (!rows.length) return badRequest('No allocations supplied', request);

            const existing = await query(
                `SELECT assembly_id, heat_no FROM AssemblyHeatAllocations
                 WHERE job_id = @jid AND is_deleted = 0`, { jid: jobId });
            const seen = new Set(existing.recordset.map(r => `${r.assembly_id}|${String(r.heat_no).trim()}`));

            let inserted = 0, skipped = 0;
            for (const r of rows) {
                if (!r.heat_no || !String(r.heat_no).trim()) continue;
                const key = `${Number.isFinite(+r.assembly_id) ? +r.assembly_id : null}|${String(r.heat_no).trim()}`;
                if (seen.has(key)) { skipped++; continue; }
                await insert({ ...r, job_id: jobId }, auth);
                seen.add(key); inserted++;
            }
            return ok({ inserted, skipped }, request);
        } catch (err) {
            context.error('heat-allocations bulk error:', err);
            return serverError('Failed to save the allocations', request);
        }
    }
});

app.http('heat-allocations-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'heat-allocations/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid allocation id', request);
            const cur = await query(`SELECT id FROM AssemblyHeatAllocations WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Allocation not found', request);
            await query(`UPDATE AssemblyHeatAllocations SET is_deleted = 1 WHERE id = @id`, { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('heat-allocations delete error:', err);
            return serverError('Failed to delete the allocation', request);
        }
    }
});
