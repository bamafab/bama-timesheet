// ─────────────────────────────────────────────────────────────────────────────
// stock.js — steel stock register (Phase C3)
//
//   GET    /api/stock?q=&include_deleted=1     — list (search on section/location)
//   POST   /api/stock-bulk   { items: [...] }  — create many (voice batch / manual)
//   PUT    /api/stock/{id}                     — update qty/fields, restore
//   DELETE /api/stock/{id}                     — soft delete
//
// Every mutation is audited via ChangeLog ('stock' entity). kgm/family come
// from the client's steel-database match — the server stores what it's given
// and never invents section data (two-engine rule).
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, badRequest, notFound, serverError, preflight } = require('../responses');

app.http('stock-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'stock/{*rest}',
    handler: async (request) => preflight(request)
});
app.http('stock-bulk-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'stock-bulk',
    handler: async (request) => preflight(request)
});

app.http('stock-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'stock',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const q = (request.query.get('q') || '').trim();
            const incDel = request.query.get('include_deleted') === '1';
            let sqlText = `SELECT * FROM StockItems WHERE 1=1`;
            const params = {};
            if (!incDel) sqlText += ' AND is_deleted = 0';
            if (q) {
                sqlText += ' AND (section LIKE @q OR location LIKE @q OR notes LIKE @q)';
                params.q = `%${q}%`;
            }
            sqlText += ' ORDER BY family, section, length_mm DESC';
            const r = await query(sqlText, params);
            return ok(r.recordset, request);
        } catch (err) {
            if (/Invalid object name/i.test(err.message)) return ok([], request);
            context.error('stock-list:', err);
            return serverError('Failed to list stock', request);
        }
    }
});

app.http('stock-bulk-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'stock-bulk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) return badRequest('items array is required', request);
            const by = body.entered_by || auth.name || auth.email || 'unknown';
            const created = [];
            for (const it of items) {
                const section = String(it.section || '').trim().slice(0, 64);
                const lengthMm = parseInt(it.length_mm);
                const qty = parseInt(it.qty) || 1;
                if (!section || !lengthMm || lengthMm <= 0) continue;
                const r = await query(
                    `INSERT INTO StockItems
                        (section, family, kgm, length_mm, qty, grade, location, notes, source, created_by)
                     OUTPUT INSERTED.*
                     VALUES (@section, @family, @kgm, @length_mm, @qty, @grade, @location, @notes, @source, @by)`,
                    {
                        section,
                        family: it.family ? String(it.family).slice(0, 64) : null,
                        kgm: it.kgm != null ? parseFloat(it.kgm) : null,
                        length_mm: lengthMm,
                        qty,
                        grade: it.grade ? String(it.grade).slice(0, 32) : null,
                        location: it.location ? String(it.location).slice(0, 64) : null,
                        notes: it.notes ? String(it.notes).slice(0, 256) : null,
                        source: it.source === 'voice' ? 'voice' : 'manual',
                        by
                    });
                const row = r.recordset[0];
                created.push(row);
                await logChange('stock', row.id, section, 'stock_added',
                    null, `${qty} × ${lengthMm}mm`, by);
            }
            return ok(created, request);
        } catch (err) {
            context.error('stock-bulk-create:', err);
            return serverError('Failed to add stock: ' + err.message, request);
        }
    }
});

app.http('stock-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'stock/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);
            const body = await request.json();
            const allowed = ['section', 'family', 'kgm', 'length_mm', 'qty', 'grade', 'location', 'notes', 'is_deleted'];
            const fields = [], params = { id };
            for (const key of allowed) {
                if (key in body) { fields.push(`${key} = @${key}`); params[key] = body[key]; }
            }
            if (!fields.length) return badRequest('No fields to update', request);
            fields.push('updated_at = GETUTCDATE()');

            const prev = await query('SELECT section, qty, is_deleted FROM StockItems WHERE id = @id', { id });
            if (!prev.recordset.length) return notFound('Stock item not found', request);
            const p = prev.recordset[0];

            const r = await query(
                `UPDATE StockItems SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`, params);
            const row = r.recordset[0];
            const by = body.entered_by || auth.name || auth.email;
            if ('qty' in body && parseInt(body.qty) !== p.qty) {
                await logChange('stock', id, p.section, 'qty_adjusted', String(p.qty), String(body.qty), by);
            }
            if ('is_deleted' in body && !body.is_deleted && p.is_deleted) {
                await logChange('stock', id, p.section, 'restored', null, null, by);
            }
            return ok(row, request);
        } catch (err) {
            context.error('stock-update:', err);
            return serverError('Failed to update stock', request);
        }
    }
});

app.http('stock-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'stock/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const r = await query(
                `UPDATE StockItems SET is_deleted = 1, updated_at = GETUTCDATE()
                 OUTPUT INSERTED.section WHERE id = @id`, { id });
            if (!r.recordset.length) return notFound('Stock item not found', request);
            await logChange('stock', id, r.recordset[0].section, 'stock_deleted',
                null, null, auth.name || auth.email);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('stock-delete:', err);
            return serverError('Failed to delete stock', request);
        }
    }
});
