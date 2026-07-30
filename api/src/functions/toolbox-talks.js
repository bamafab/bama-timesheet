// ─────────────────────────────────────────────────────────────────────────────
// toolbox-talks.js  (2026-07-30)
//
// Talk library + a record of every delivery. Signature images never reach the
// database — the signed PDF in SharePoint is the evidence, the register holds
// who attended and when (same rule as the QMS engine).
//
// Routes:
//   GET/POST/PUT/DELETE  /api/toolbox-talks[/{id}]
//   GET/POST/DELETE      /api/toolbox-deliveries[/{id}]   (?job_id= &talk_id= &since=)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const TALK_COLS = `id, talk_ref, title, category, summary, content, key_points, source,
    CONVERT(varchar(10), review_due, 23) AS review_due, is_active, created_by, created_at, updated_at`;
const DELIV_COLS = `id, talk_id, talk_ref, talk_title, job_id, job_number, location,
    CONVERT(varchar(10), delivered_on, 23) AS delivered_on,
    delivered_by, attendees, attendee_count, notes,
    file_name, sharepoint_file_id, drive_id, web_url, created_by, created_at`;

for (const r of ['toolbox-talks', 'toolbox-deliveries']) {
    app.http(r + '-options', {
        methods: ['OPTIONS'], authLevel: 'anonymous',
        route: r + '/{*rest}', handler: async (req) => preflight(req)
    });
}

app.http('toolbox-talks-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'toolbox-talks',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT ${TALK_COLS} FROM ToolboxTalks WHERE is_deleted = 0 ORDER BY category, talk_ref`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('toolbox-talks list error:', err);
            return serverError('Failed to load the talk library', request);
        }
    }
});

app.http('toolbox-talks-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'toolbox-talks',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.title || !String(b.title).trim()) return badRequest('title is required', request);
            let ref = String(b.talk_ref || '').trim();
            if (!ref) {
                const max = await query(
                    `SELECT MAX(TRY_CONVERT(INT, SUBSTRING(talk_ref, 5, 10))) AS n
                     FROM ToolboxTalks WHERE is_deleted = 0 AND talk_ref LIKE 'TBT-%'`);
                ref = 'TBT-' + String((max.recordset[0].n || 0) + 1).padStart(3, '0');
            }
            const res = await query(
                `INSERT INTO ToolboxTalks (talk_ref, title, category, summary, content, key_points, source, review_due, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@ref, @title, @cat, @sum, @content, @kp, @src, @rev, @by)`,
                {
                    ref: ref.slice(0, 40), title: String(b.title).trim().slice(0, 200),
                    cat: b.category || 'general', sum: b.summary || null,
                    content: b.content || null,
                    kp: b.key_points ? (typeof b.key_points === 'string' ? b.key_points : JSON.stringify(b.key_points)) : null,
                    src: ['library', 'drafted', 'custom'].includes(b.source) ? b.source : 'custom',
                    rev: b.review_due || null, by: auth.name || auth.email || null
                });
            return created({ id: res.recordset[0].id, talk_ref: ref }, request);
        } catch (err) {
            context.error('toolbox-talks create error:', err);
            return serverError('Failed to save the talk', request);
        }
    }
});

app.http('toolbox-talks-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'toolbox-talks/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid talk id', request);
            const cur = await query(`SELECT id, title FROM ToolboxTalks WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Talk not found', request);
            const b = await request.json();
            const map = {
                title: v => String(v || '').trim().slice(0, 200) || cur.recordset[0].title,
                category: v => v || 'general', summary: v => v || null, content: v => v || null,
                key_points: v => v ? (typeof v === 'string' ? v : JSON.stringify(v)) : null,
                review_due: v => v || null, is_active: v => v ? 1 : 0
            };
            const sets = []; const params = { id };
            for (const [f, coerce] of Object.entries(map))
                if (f in b) { sets.push(`${f} = @${f}`); params[f] = coerce(b[f]); }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE ToolboxTalks SET ${sets.join(', ')} WHERE id = @id`, params);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('toolbox-talks update error:', err);
            return serverError('Failed to update the talk', request);
        }
    }
});

app.http('toolbox-talks-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'toolbox-talks/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid talk id', request);
            // Deliveries snapshot their title, so removing a library row never
            // orphans the record that it was actually given.
            await query(`UPDATE ToolboxTalks SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('toolbox-talks delete error:', err);
            return serverError('Failed to delete the talk', request);
        }
    }
});

app.http('toolbox-deliveries-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'toolbox-deliveries',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const jobId = parseInt(sp.get('job_id')), talkId = parseInt(sp.get('talk_id'));
            const since = sp.get('since');
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(jobId))  { where += ' AND job_id = @jid';  params.jid = jobId; }
            if (Number.isFinite(talkId)) { where += ' AND talk_id = @tid'; params.tid = talkId; }
            if (since)                   { where += ' AND delivered_on >= @since'; params.since = since; }
            const res = await query(
                `SELECT TOP 500 ${DELIV_COLS} FROM ToolboxTalkDeliveries WHERE ${where}
                 ORDER BY delivered_on DESC, id DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('toolbox-deliveries list error:', err);
            return serverError('Failed to load the delivery register', request);
        }
    }
});

app.http('toolbox-deliveries-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'toolbox-deliveries',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const talkId = parseInt(b.talk_id);
            if (!Number.isFinite(talkId)) return badRequest('talk_id is required', request);
            if (!b.delivered_by || !String(b.delivered_by).trim()) return badRequest('delivered_by is required — someone gave the talk', request);
            const attendees = Array.isArray(b.attendees) ? b.attendees : [];
            if (!attendees.length) return badRequest('At least one attendee is required — a talk with nobody at it is not a record', request);
            // Strip anything image-like: signatures belong in the filed PDF only.
            const clean = attendees.map(a => ({
                name: String(a.name || '').slice(0, 200),
                role: a.role ? String(a.role).slice(0, 120) : null,
                signed: !!a.signed
            })).filter(a => a.name);

            const res = await query(
                `INSERT INTO ToolboxTalkDeliveries
                   (talk_id, talk_ref, talk_title, job_id, job_number, location, delivered_on, delivered_by,
                    attendees, attendee_count, notes, file_name, sharepoint_file_id, drive_id, web_url, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@tid, @ref, @title, @jid, @jno, @loc, @on, @by, @att, @cnt, @notes, @fn, @spid, @drv, @url, @cby)`,
                {
                    tid: talkId, ref: b.talk_ref || null, title: b.talk_title || null,
                    jid: Number.isFinite(+b.job_id) ? +b.job_id : null,
                    jno: b.job_number || null, loc: b.location || null,
                    on: b.delivered_on || new Date().toISOString().slice(0, 10),
                    by: String(b.delivered_by).trim().slice(0, 200),
                    att: JSON.stringify(clean), cnt: clean.length,
                    notes: b.notes || null,
                    fn: b.file_name || null, spid: b.sharepoint_file_id || null,
                    drv: b.drive_id || null, url: b.web_url || null,
                    cby: auth.name || auth.email || null
                });
            const id = res.recordset[0].id;
            await logChange('toolbox_talk', id, `${b.talk_ref || ''} ${b.talk_title || ''}`.trim(),
                'delivered', null, `${clean.length} attendee(s)`, auth.name || auth.email);
            return created({ id, attendee_count: clean.length }, request);
        } catch (err) {
            context.error('toolbox-deliveries create error:', err);
            return serverError('Failed to record the delivery', request);
        }
    }
});

app.http('toolbox-deliveries-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'toolbox-deliveries/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid delivery id', request);
            const cur = await query(
                `SELECT id, talk_ref, talk_title FROM ToolboxTalkDeliveries WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Delivery not found', request);
            await query(`UPDATE ToolboxTalkDeliveries SET is_deleted = 1 WHERE id = @id`, { id });
            await logChange('toolbox_talk', id, `${cur.recordset[0].talk_ref || ''} ${cur.recordset[0].talk_title || ''}`.trim(),
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('toolbox-deliveries delete error:', err);
            return serverError('Failed to delete the delivery', request);
        }
    }
});
