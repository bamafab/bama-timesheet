// ─────────────────────────────────────────────────────────────────────────────
// policies.js  (Policy Studio, 2026-08-08)
//
// ERP-owned company policies: structured sections in the DB, PDF regenerated
// on demand by the FRONTEND (native jsPDF house style, director authorisation
// block on the document). This API is metadata only — it never touches Graph.
//
// Revision model (Mateusz, option B): staff signatures are keyed to the
// SharePoint file id. Re-issuing the SAME revision overwrites the same file
// (signatures persist); a revision bump creates a new file (signatures reset).
//
// Routes:
//   GET    /api/policies                 — active policies
//   POST   /api/policies                 — create draft
//   PUT    /api/policies/{id}            — update (issue transitions audited)
//   DELETE /api/policies/{id}            — soft-delete
//   GET    /api/director-signature       — latest active stored signature
//   POST   /api/director-signature       — replace stored signature
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const CATEGORIES = ['policy', 'hs', 'ra_ssow'];

const SELECT_COLS = `id, ref, title, category, revision, review_months, sections, history,
    status, company_document_id, sharepoint_file_id, drive_id, web_url, file_name,
    issued_at, issued_by, created_at, updated_at`;

// Fields the frontend may PUT. sections/history are JSON strings.
const PUT_FIELDS = ['ref', 'title', 'category', 'revision', 'review_months', 'sections',
    'history', 'status', 'company_document_id', 'sharepoint_file_id', 'drive_id',
    'web_url', 'file_name', 'issued_at', 'issued_by'];

app.http('policies-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'policies/{*rest}',
    handler: async (req) => preflight(req)
});
app.http('director-signature-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'director-signature',
    handler: async (req) => preflight(req)
});

// ── GET /api/policies ────────────────────────────────────────────────────────
app.http('policies-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'policies',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT ${SELECT_COLS} FROM Policies WHERE is_deleted = 0 ORDER BY ref, title`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('policies list error:', err);
            return serverError('Failed to load policies', request);
        }
    }
});

// ── POST /api/policies ───────────────────────────────────────────────────────
app.http('policies-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'policies',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.title || !String(b.title).trim()) return badRequest('title is required', request);
            const category = CATEGORIES.includes(b.category) ? b.category : 'policy';
            const res = await query(
                `INSERT INTO Policies (ref, title, category, revision, review_months, sections, history, status)
                 OUTPUT INSERTED.id
                 VALUES (@ref, @title, @category, @revision, @review_months, @sections, @history, 'draft')`,
                {
                    ref: b.ref || null,
                    title: String(b.title).trim().slice(0, 200),
                    category,
                    revision: Number.isFinite(+b.revision) ? Math.max(1, +b.revision) : 1,
                    review_months: Number.isFinite(+b.review_months) ? Math.max(1, +b.review_months) : 12,
                    sections: b.sections ? String(b.sections) : null,
                    history: b.history ? String(b.history) : null
                });
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('policies create error:', err);
            return serverError('Failed to create policy', request);
        }
    }
});

// ── PUT /api/policies/{id} ───────────────────────────────────────────────────
app.http('policies-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'policies/{id:int}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = +request.params.id;
            const b = await request.json();
            const prev = await query(`SELECT ${SELECT_COLS} FROM Policies WHERE id = @id AND is_deleted = 0`, { id });
            if (!prev.recordset.length) return notFound('Policy not found', request);
            const before = prev.recordset[0];

            const sets = [], params = { id };
            for (const f of PUT_FIELDS) {
                if (b[f] === undefined) continue;
                sets.push(`${f} = @${f}`);
                params[f] = b[f] === null ? null : (['revision', 'review_months', 'company_document_id'].includes(f) ? +b[f] : String(b[f]));
            }
            if (!sets.length) return badRequest('nothing to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE Policies SET ${sets.join(', ')} WHERE id = @id`, params);

            // F6: issue / revision transitions are state changes on a compliance entity.
            if ((b.status && b.status !== before.status) || (b.revision !== undefined && +b.revision !== before.revision)) {
                const revBump = b.revision !== undefined && +b.revision !== before.revision;
                await logChange('policy', id, `${before.ref || 'POL'} ${before.title}`.trim(),
                    revBump ? 'revision' : b.status,
                    `rev ${before.revision} / ${before.status}`,
                    `rev ${b.revision ?? before.revision} / ${b.status ?? before.status}`,
                    b.issued_by || auth.name || auth.email);
            }
            const after = await query(`SELECT ${SELECT_COLS} FROM Policies WHERE id = @id`, { id });
            return ok(after.recordset[0], request);
        } catch (err) {
            context.error('policies update error:', err);
            return serverError('Failed to update policy', request);
        }
    }
});

// ── DELETE /api/policies/{id} (soft) ─────────────────────────────────────────
app.http('policies-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'policies/{id:int}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = +request.params.id;
            const res = await query(`UPDATE Policies SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id AND is_deleted = 0`, { id });
            if (!res.rowsAffected[0]) return notFound('Policy not found', request);
            await logChange('policy', id, null, 'delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ deleted: id }, request);
        } catch (err) {
            context.error('policies delete error:', err);
            return serverError('Failed to delete policy', request);
        }
    }
});

// ── GET /api/director-signature ──────────────────────────────────────────────
app.http('director-signature-get', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'director-signature',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT TOP 1 id, signer_name, signature, created_at
                 FROM DirectorSignatures WHERE is_active = 1 ORDER BY created_at DESC`);
            return ok(res.recordset[0] || null, request);
        } catch (err) {
            context.error('director-signature get error:', err);
            return serverError('Failed to load director signature', request);
        }
    }
});

// ── POST /api/director-signature ─────────────────────────────────────────────
app.http('director-signature-set', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'director-signature',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.signer_name || !b.signature) return badRequest('signer_name and signature are required', request);
            await query(`UPDATE DirectorSignatures SET is_active = 0 WHERE is_active = 1`);
            const res = await query(
                `INSERT INTO DirectorSignatures (signer_name, signature) OUTPUT INSERTED.id
                 VALUES (@signer_name, @signature)`,
                { signer_name: String(b.signer_name).trim().slice(0, 100), signature: String(b.signature) });
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('director-signature set error:', err);
            return serverError('Failed to store director signature', request);
        }
    }
});
