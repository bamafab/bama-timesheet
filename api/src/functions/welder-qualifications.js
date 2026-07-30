// ─────────────────────────────────────────────────────────────────────────────
// welder-qualifications.js  (E1 — welder approvals, 2026-07-30)
//
// Welder qualification certificates with BOTH validity clocks: the 6-month
// employer confirmation (EN ISO 9606-1 §9.2) and the certificate's own expiry.
// Range of approval is stored exactly as printed on the certificate — this API
// never derives or widens a scope.
//
// Routes (flat naming per CLAUDE.md):
//   GET    /api/welder-quals                   — all live qualifications
//   GET    /api/welder-quals/expiring          — confirmation or expiry due ≤60 days / overdue
//   POST   /api/welder-quals                   — create
//   PUT    /api/welder-quals/{id}              — partial update (status audited)
//   DELETE /api/welder-quals/{id}              — soft delete (audited)
//   POST   /api/welder-qual-confirm/{id}       — record a 6-month confirmation (audited)
//   GET    /api/welder-qual-confirmations      — ?qualification_id= log
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const STATUSES = ['valid', 'lapsed', 'revoked', 'superseded'];

const COLS = `id, personnel_id, person_name, cert_no, standard, process, material_group,
    product_form, joint_type, thickness_min, thickness_max, diameter_min, diameter_max,
    positions, filler_designation, backing, transfer_mode, range_notes, examiner,
    CONVERT(varchar(10), test_date, 23)   AS test_date,
    CONVERT(varchar(10), issue_date, 23)  AS issue_date,
    CONVERT(varchar(10), confirm_due, 23) AS confirm_due,
    CONVERT(varchar(10), expiry_date, 23) AS expiry_date,
    status, file_name, sharepoint_file_id, drive_id, web_url, notes, superseded_by,
    created_by, created_at, updated_at`;

// Fields a client may set, with coercion. Anything not listed is ignored.
const FIELDS = {
    personnel_id:       v => Number.isFinite(+v) ? +v : null,
    person_name:        v => String(v || '').trim().slice(0, 200),
    cert_no:            v => String(v || '').trim().slice(0, 100),
    standard:           v => String(v || 'EN ISO 9606-1').trim().slice(0, 60),
    process:            v => String(v || '').trim().slice(0, 40),
    material_group:     v => v ? String(v).trim().slice(0, 40) : null,
    product_form:       v => ['plate', 'pipe', 'both'].includes(v) ? v : null,
    joint_type:         v => ['BW', 'FW', 'both'].includes(v) ? v : null,
    thickness_min:      v => Number.isFinite(+v) && v !== '' && v !== null ? +v : null,
    thickness_max:      v => Number.isFinite(+v) && v !== '' && v !== null ? +v : null,
    diameter_min:       v => Number.isFinite(+v) && v !== '' && v !== null ? +v : null,
    diameter_max:       v => Number.isFinite(+v) && v !== '' && v !== null ? +v : null,
    positions:          v => v ? String(v).trim().slice(0, 200) : null,
    filler_designation: v => v ? String(v).trim().slice(0, 80) : null,
    backing:            v => ['mb', 'nb'].includes(v) ? v : null,
    transfer_mode:      v => v ? String(v).trim().slice(0, 30) : null,
    range_notes:        v => v ? String(v).slice(0, 500) : null,
    examiner:           v => v ? String(v).trim().slice(0, 200) : null,
    test_date:          v => v || null,
    issue_date:         v => v || null,
    confirm_due:        v => v || null,
    expiry_date:        v => v || null,
    status:             v => STATUSES.includes(v) ? v : 'valid',
    file_name:          v => v || null,
    sharepoint_file_id: v => v || null,
    drive_id:           v => v || null,
    web_url:            v => v || null,
    notes:              v => v || null,
    superseded_by:      v => Number.isFinite(+v) ? +v : null
};

app.http('welder-quals-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'welder-quals/{*rest}', handler: async (req) => preflight(req)
});
app.http('welder-qual-confirm-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'welder-qual-confirm/{*rest}', handler: async (req) => preflight(req)
});
app.http('welder-qual-confirmations-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'welder-qual-confirmations', handler: async (req) => preflight(req)
});

// ── GET all ──────────────────────────────────────────────────────────────────
app.http('welder-quals-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'welder-quals',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT ${COLS} FROM WelderQualifications WHERE is_deleted = 0
                 ORDER BY person_name, process, cert_no`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('welder-quals list error:', err);
            return serverError('Failed to load welder qualifications', request);
        }
    }
});

// ── GET expiring — BOTH clocks, unpivoted ────────────────────────────────────
app.http('welder-quals-expiring', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'welder-quals/expiring',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const clock = (col, kind) =>
                `SELECT id, person_name, cert_no, process, '${kind}' AS clock,
                        CONVERT(varchar(10), ${col}, 23) AS due_date,
                        DATEDIFF(day, CAST(GETUTCDATE() AS date), ${col}) AS days_left
                 FROM WelderQualifications
                 WHERE is_deleted = 0 AND status = 'valid' AND ${col} IS NOT NULL
                   AND DATEDIFF(day, CAST(GETUTCDATE() AS date), ${col}) <= 60`;
            const res = await query(
                `${clock('confirm_due', 'confirmation')} UNION ALL ${clock('expiry_date', 'expiry')}
                 ORDER BY days_left`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('welder-quals expiring error:', err);
            return serverError('Failed to load expiring welder qualifications', request);
        }
    }
});

// ── POST create ──────────────────────────────────────────────────────────────
app.http('welder-quals-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'welder-quals',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.person_name || !String(b.person_name).trim()) return badRequest('person_name is required', request);
            if (!b.cert_no || !String(b.cert_no).trim())         return badRequest('cert_no is required', request);
            if (!b.process || !String(b.process).trim())         return badRequest('process is required', request);

            const keys = Object.keys(FIELDS);
            const params = {}; keys.forEach(k => { params[k] = FIELDS[k](b[k]); });
            params.created_by = auth.name || auth.email || null;

            const res = await query(
                `INSERT INTO WelderQualifications (${keys.join(', ')}, created_by)
                 OUTPUT INSERTED.id
                 VALUES (${keys.map(k => '@' + k).join(', ')}, @created_by)`, params);
            const id = res.recordset[0].id;
            await logChange('welder_qualification', id, `${params.person_name} — ${params.process} (${params.cert_no})`,
                'created', null, params.status, auth.name || auth.email);
            return created({ id }, request);
        } catch (err) {
            context.error('welder-quals create error:', err);
            return serverError('Failed to create welder qualification', request);
        }
    }
});

// ── PUT update ───────────────────────────────────────────────────────────────
app.http('welder-quals-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'welder-quals/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid qualification id', request);
            const cur = await query(
                `SELECT id, person_name, cert_no, process, status FROM WelderQualifications
                 WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Qualification not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const sets = []; const params = { id };
            for (const [field, coerce] of Object.entries(FIELDS)) {
                if (!(field in b)) continue;
                // Don't let a blank wipe a required field.
                if (['person_name', 'cert_no', 'process'].includes(field) && !String(b[field] || '').trim()) continue;
                sets.push(`${field} = @${field}`); params[field] = coerce(b[field]);
            }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE WelderQualifications SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('status' in b && STATUSES.includes(b.status) && b.status !== before.status) {
                await logChange('welder_qualification', id,
                    `${before.person_name} — ${before.process} (${before.cert_no})`,
                    'status_change', before.status, b.status, auth.name || auth.email);
            }
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('welder-quals update error:', err);
            return serverError('Failed to update welder qualification', request);
        }
    }
});

// ── DELETE (soft) ────────────────────────────────────────────────────────────
app.http('welder-quals-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'welder-quals/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid qualification id', request);
            const cur = await query(
                `SELECT id, person_name, cert_no, process FROM WelderQualifications
                 WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Qualification not found', request);
            await query(`UPDATE WelderQualifications SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            const q = cur.recordset[0];
            await logChange('welder_qualification', id, `${q.person_name} — ${q.process} (${q.cert_no})`,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('welder-quals delete error:', err);
            return serverError('Failed to delete welder qualification', request);
        }
    }
});

// ── POST 6-month confirmation ────────────────────────────────────────────────
// Writes the signed confirmation to the log AND moves confirm_due forward.
// Both in one endpoint so the two can never disagree.
app.http('welder-qual-confirm', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'welder-qual-confirm/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid qualification id', request);
            const cur = await query(
                `SELECT id, person_name, cert_no, process,
                        CONVERT(varchar(10), confirm_due, 23) AS confirm_due,
                        CONVERT(varchar(10), expiry_date, 23) AS expiry_date
                 FROM WelderQualifications WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Qualification not found', request);
            const q = cur.recordset[0];

            const b = await request.json();
            const confirmedOn = b.confirmed_on || new Date().toISOString().slice(0, 10);
            const confirmedBy = String(b.confirmed_by || auth.name || auth.email || '').trim();
            if (!confirmedBy) return badRequest('confirmed_by is required — someone has to sign it', request);

            // Next due = 6 calendar months from the confirmation date, but never
            // past the certificate's own expiry (the certificate wins).
            const d = new Date(confirmedOn + 'T00:00:00Z');
            d.setUTCMonth(d.getUTCMonth() + 6);
            let nextDue = d.toISOString().slice(0, 10);
            if (q.expiry_date && nextDue > q.expiry_date) nextDue = q.expiry_date;

            await query(
                `INSERT INTO WelderQualConfirmations (qualification_id, confirmed_on, confirmed_by, evidence, next_due)
                 VALUES (@id, @on, @by, @ev, @next)`,
                { id, on: confirmedOn, by: confirmedBy.slice(0, 200), ev: b.evidence || null, next: nextDue });
            await query(
                `UPDATE WelderQualifications SET confirm_due = @next, updated_at = SYSUTCDATETIME() WHERE id = @id`,
                { id, next: nextDue });
            await logChange('welder_qualification', id, `${q.person_name} — ${q.process} (${q.cert_no})`,
                'confirmed', q.confirm_due || null, nextDue, confirmedBy);

            return ok({ id, confirmed_on: confirmedOn, next_due: nextDue }, request);
        } catch (err) {
            context.error('welder-qual-confirm error:', err);
            return serverError('Failed to record the confirmation', request);
        }
    }
});

// ── GET confirmation log ─────────────────────────────────────────────────────
app.http('welder-qual-confirmations', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'welder-qual-confirmations',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const qid = parseInt(new URL(request.url).searchParams.get('qualification_id'));
            const params = {}; let where = '1 = 1';
            if (Number.isFinite(qid)) { where = 'qualification_id = @qid'; params.qid = qid; }
            const res = await query(
                `SELECT id, qualification_id,
                        CONVERT(varchar(10), confirmed_on, 23) AS confirmed_on,
                        confirmed_by, evidence,
                        CONVERT(varchar(10), next_due, 23) AS next_due, created_at
                 FROM WelderQualConfirmations WHERE ${where}
                 ORDER BY confirmed_on DESC, id DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('welder-qual-confirmations error:', err);
            return serverError('Failed to load the confirmation log', request);
        }
    }
});
