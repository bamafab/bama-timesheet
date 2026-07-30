// ─────────────────────────────────────────────────────────────────────────────
// inspection-plans.js  (E2 — inspection & NDT sampling, 2026-07-30)
//
// Sampled supplementary NDT (UT/RT/MT/PT) per EN 1090-2 Table 24, with the
// percentages held in the editable NdtExtentRules table rather than in code.
// VISUAL inspection is 100% at every execution class and is never sampled —
// the required-count maths below hard-codes 100% for visual for that reason.
//
// Routes:
//   GET    /api/ndt-rules                     — the rules table
//   PUT    /api/ndt-rules/{id}                — edit a percentage / verify a row
//   GET    /api/inspection-plans              — ?job_id= (one plan per job)
//   POST   /api/inspection-plans              — create or upsert a job's plan
//   PUT    /api/inspection-plans/{id}         — update exec class / weld counts
//   GET    /api/inspection-records            — ?job_id= or ?plan_id=
//   POST   /api/inspection-records            — log an inspection
//   DELETE /api/inspection-records/{id}       — soft delete (audited)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const EXEC_CLASSES = ['EXC1', 'EXC2', 'EXC3', 'EXC4'];
const INSP_TYPES = ['visual', 'UT', 'RT', 'MT', 'PT'];
const RESULTS = ['pass', 'fail', 'repaired'];

for (const r of ['ndt-rules', 'inspection-plans', 'inspection-records']) {
    app.http(r + '-options', {
        methods: ['OPTIONS'], authLevel: 'anonymous',
        route: r + '/{*rest}', handler: async (req) => preflight(req)
    });
}

// ── Rules ────────────────────────────────────────────────────────────────────
app.http('ndt-rules-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'ndt-rules',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT id, exec_class, weld_category, utilisation, pct_required, method_hint,
                        source_note, verified, verified_by,
                        CONVERT(varchar(10), verified_at, 23) AS verified_at
                 FROM NdtExtentRules WHERE is_deleted = 0
                 ORDER BY exec_class, weld_category, utilisation`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('ndt-rules list error:', err);
            return serverError('Failed to load the NDT extent rules', request);
        }
    }
});

app.http('ndt-rules-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'ndt-rules/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid rule id', request);
            const cur = await query(
                `SELECT id, exec_class, weld_category, utilisation, pct_required, verified
                 FROM NdtExtentRules WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Rule not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const sets = []; const params = { id };
            if ('pct_required' in b) {
                const pct = Number(b.pct_required);
                if (!isFinite(pct) || pct < 0 || pct > 100) return badRequest('pct_required must be 0–100', request);
                sets.push('pct_required = @pct'); params.pct = pct;
            }
            if ('method_hint' in b) { sets.push('method_hint = @mh'); params.mh = b.method_hint || null; }
            if ('source_note' in b) { sets.push('source_note = @sn'); params.sn = b.source_note || null; }
            if ('verified' in b) {
                sets.push('verified = @v, verified_by = @vb, verified_at = @va');
                params.v = b.verified ? 1 : 0;
                params.vb = b.verified ? (auth.name || auth.email || null) : null;
                params.va = b.verified ? new Date().toISOString().slice(0, 10) : null;
            }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE NdtExtentRules SET ${sets.join(', ')} WHERE id = @id`, params);

            const label = `${before.exec_class} ${before.weld_category}${before.utilisation ? ' ' + before.utilisation : ''}`;
            if ('pct_required' in b && Number(b.pct_required) !== Number(before.pct_required))
                await logChange('ndt_rule', id, label, 'pct_change',
                    String(before.pct_required), String(b.pct_required), auth.name || auth.email);
            if ('verified' in b && (b.verified ? 1 : 0) !== before.verified)
                await logChange('ndt_rule', id, label, b.verified ? 'verified' : 'unverified',
                    before.verified ? 'verified' : 'unverified',
                    b.verified ? 'verified' : 'unverified', auth.name || auth.email);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('ndt-rules update error:', err);
            return serverError('Failed to update the rule', request);
        }
    }
});

// ── Plans ────────────────────────────────────────────────────────────────────
const PLAN_COLS = `id, job_id, exec_class, weld_counts, notes, status, created_by, created_at, updated_at`;

app.http('inspection-plans-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'inspection-plans',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const jobId = parseInt(new URL(request.url).searchParams.get('job_id'));
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(jobId)) { where += ' AND job_id = @jid'; params.jid = jobId; }
            const res = await query(`SELECT ${PLAN_COLS} FROM JobInspectionPlans WHERE ${where} ORDER BY id DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('inspection-plans list error:', err);
            return serverError('Failed to load inspection plans', request);
        }
    }
});

app.http('inspection-plans-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'inspection-plans',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const jobId = parseInt(b.job_id);
            if (!Number.isFinite(jobId)) return badRequest('job_id is required', request);
            const execClass = EXEC_CLASSES.includes(b.exec_class) ? b.exec_class : 'EXC2';
            const counts = b.weld_counts ? (typeof b.weld_counts === 'string' ? b.weld_counts : JSON.stringify(b.weld_counts)) : null;

            // One plan per job — upsert rather than creating duplicates.
            const dup = await query(`SELECT id FROM JobInspectionPlans WHERE job_id = @jid AND is_deleted = 0`, { jid: jobId });
            if (dup.recordset.length) {
                const id = dup.recordset[0].id;
                await query(
                    `UPDATE JobInspectionPlans SET exec_class = @ec, weld_counts = @wc, notes = @n,
                            updated_at = SYSUTCDATETIME() WHERE id = @id`,
                    { id, ec: execClass, wc: counts, n: b.notes || null });
                return ok({ id, updated: true }, request);
            }
            const res = await query(
                `INSERT INTO JobInspectionPlans (job_id, exec_class, weld_counts, notes, created_by)
                 OUTPUT INSERTED.id VALUES (@jid, @ec, @wc, @n, @by)`,
                { jid: jobId, ec: execClass, wc: counts, n: b.notes || null, by: auth.name || auth.email || null });
            const id = res.recordset[0].id;
            await logChange('inspection_plan', id, `Job ${jobId} ${execClass}`, 'created', null, execClass, auth.name || auth.email);
            return created({ id }, request);
        } catch (err) {
            context.error('inspection-plans create error:', err);
            return serverError('Failed to save the inspection plan', request);
        }
    }
});

app.http('inspection-plans-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'inspection-plans/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid plan id', request);
            const cur = await query(
                `SELECT id, job_id, exec_class, status FROM JobInspectionPlans WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Plan not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const sets = []; const params = { id };
            if ('exec_class' in b && EXEC_CLASSES.includes(b.exec_class)) { sets.push('exec_class = @ec'); params.ec = b.exec_class; }
            if ('weld_counts' in b) {
                sets.push('weld_counts = @wc');
                params.wc = b.weld_counts ? (typeof b.weld_counts === 'string' ? b.weld_counts : JSON.stringify(b.weld_counts)) : null;
            }
            if ('notes' in b)  { sets.push('notes = @n');  params.n = b.notes || null; }
            if ('status' in b && ['open', 'complete'].includes(b.status)) { sets.push('status = @st'); params.st = b.status; }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE JobInspectionPlans SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('exec_class' in b && b.exec_class !== before.exec_class)
                await logChange('inspection_plan', id, `Job ${before.job_id}`, 'exec_class_change',
                    before.exec_class, b.exec_class, auth.name || auth.email);
            if ('status' in b && b.status !== before.status)
                await logChange('inspection_plan', id, `Job ${before.job_id}`, 'status_change',
                    before.status, b.status, auth.name || auth.email);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('inspection-plans update error:', err);
            return serverError('Failed to update the plan', request);
        }
    }
});

// ── Records ──────────────────────────────────────────────────────────────────
const REC_COLS = `id, plan_id, job_id, assembly_id, assembly_mark, weld_category, inspection_type,
    weld_count, result, inspector, welder_name,
    CONVERT(varchar(10), inspected_on, 23) AS inspected_on,
    report_ref, qms_submission_id, file_name, sharepoint_file_id, drive_id, web_url,
    notes, created_by, created_at`;

app.http('inspection-records-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'inspection-records',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const jobId = parseInt(sp.get('job_id')), planId = parseInt(sp.get('plan_id'));
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(planId)) { where += ' AND plan_id = @pid'; params.pid = planId; }
            else if (Number.isFinite(jobId)) { where += ' AND job_id = @jid'; params.jid = jobId; }
            const res = await query(
                `SELECT ${REC_COLS} FROM JobInspectionRecords WHERE ${where}
                 ORDER BY inspected_on DESC, id DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('inspection-records list error:', err);
            return serverError('Failed to load inspection records', request);
        }
    }
});

app.http('inspection-records-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'inspection-records',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const planId = parseInt(b.plan_id), jobId = parseInt(b.job_id);
            if (!Number.isFinite(planId)) return badRequest('plan_id is required', request);
            if (!Number.isFinite(jobId))  return badRequest('job_id is required', request);
            if (!b.weld_category)         return badRequest('weld_category is required', request);
            if (!INSP_TYPES.includes(b.inspection_type)) return badRequest('inspection_type must be one of ' + INSP_TYPES.join(', '), request);

            const res = await query(
                `INSERT INTO JobInspectionRecords
                   (plan_id, job_id, assembly_id, assembly_mark, weld_category, inspection_type, weld_count,
                    result, inspector, welder_name, inspected_on, report_ref, qms_submission_id,
                    file_name, sharepoint_file_id, drive_id, web_url, notes, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@plan, @job, @aid, @mark, @cat, @type, @cnt, @res, @insp, @weld, @on, @ref, @qms,
                         @fn, @spid, @drv, @url, @notes, @by)`,
                {
                    plan: planId, job: jobId,
                    aid: Number.isFinite(+b.assembly_id) ? +b.assembly_id : null,
                    mark: b.assembly_mark || null,
                    cat: String(b.weld_category).slice(0, 80),
                    type: b.inspection_type,
                    cnt: Number.isFinite(+b.weld_count) && +b.weld_count > 0 ? +b.weld_count : 1,
                    res: RESULTS.includes(b.result) ? b.result : 'pass',
                    insp: b.inspector || auth.name || auth.email || null,
                    weld: b.welder_name || null,
                    on: b.inspected_on || new Date().toISOString().slice(0, 10),
                    ref: b.report_ref || null,
                    qms: Number.isFinite(+b.qms_submission_id) ? +b.qms_submission_id : null,
                    fn: b.file_name || null, spid: b.sharepoint_file_id || null,
                    drv: b.drive_id || null, url: b.web_url || null,
                    notes: b.notes || null, by: auth.name || auth.email || null
                });
            const id = res.recordset[0].id;
            // A failed inspection is a quality event — always audited.
            if (b.result === 'fail')
                await logChange('inspection_record', id,
                    `Job ${jobId} ${b.assembly_mark || ''} ${b.inspection_type}`.trim(),
                    'inspection_failed', null, 'fail', auth.name || auth.email);
            return created({ id }, request);
        } catch (err) {
            context.error('inspection-records create error:', err);
            return serverError('Failed to log the inspection', request);
        }
    }
});

app.http('inspection-records-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'inspection-records/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid record id', request);
            const cur = await query(
                `SELECT id, job_id, assembly_mark, inspection_type FROM JobInspectionRecords
                 WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Record not found', request);
            await query(`UPDATE JobInspectionRecords SET is_deleted = 1 WHERE id = @id`, { id });
            const r = cur.recordset[0];
            await logChange('inspection_record', id,
                `Job ${r.job_id} ${r.assembly_mark || ''} ${r.inspection_type}`.trim(),
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('inspection-records delete error:', err);
            return serverError('Failed to delete the record', request);
        }
    }
});
