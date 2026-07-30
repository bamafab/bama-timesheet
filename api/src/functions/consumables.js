// ─────────────────────────────────────────────────────────────────────────────
// consumables.js  (2026-07-30)
//
// Catalogue + movement ledger + reorder basket.
//
// STOCK IS DERIVED FROM THE LEDGER, never stored: opening_qty + Σin − Σout.
// A stored running total drifts the moment a movement is edited or deleted, and
// a stock figure nobody trusts is worse than no figure at all.
//
// NOTHING AUTO-ORDERS. A reorder is requested (basket), then approved by a
// human, then marked ordered against a PO number. No financial commitment
// without someone pressing something — Mateusz's call, and the same principle
// as the money rules.
//
// Routes:
//   GET/POST/PUT/DELETE  /api/consumables[/{id}]     — GET returns derived stock
//   GET/POST/DELETE      /api/consumable-movements[/{id}]   (?consumable_id= &job_id= &since=)
//   POST                 /api/consumable-movements-bulk     — a whole paper tally sheet
//   GET/POST/PUT/DELETE  /api/consumable-reorders[/{id}]
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const CATEGORIES = ['wire', 'electrode', 'gas', 'abrasive', 'ppe', 'fixings', 'paint', 'other'];
const UNITS = ['each', 'kg', 'box', 'roll', 'bottle', 'litre', 'pack'];
const SOURCES = ['paper', 'kiosk', 'office', 'delivery'];
const REORDER_STATUSES = ['basket', 'approved', 'ordered', 'cancelled'];

for (const r of ['consumables', 'consumable-movements', 'consumable-movements-bulk', 'consumable-reorders']) {
    app.http(r + '-options', {
        methods: ['OPTIONS'], authLevel: 'anonymous',
        route: r + '/{*rest}', handler: async (req) => preflight(req)
    });
}

// ── Catalogue, with stock derived in the same query ──────────────────────────
app.http('consumables-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'consumables',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT c.id, c.item_code, c.name, c.category, c.spec, c.unit, c.pack_size,
                        c.supplier_name, c.supplier_part, c.location, c.opening_qty,
                        c.reorder_level, c.reorder_qty, c.batch_tracked, c.notes, c.is_active,
                        c.created_at, c.updated_at,
                        c.opening_qty
                          + ISNULL((SELECT SUM(m.qty) FROM ConsumableMovements m
                                    WHERE m.consumable_id = c.id AND m.direction = 'in'  AND m.is_deleted = 0), 0)
                          - ISNULL((SELECT SUM(m.qty) FROM ConsumableMovements m
                                    WHERE m.consumable_id = c.id AND m.direction = 'out' AND m.is_deleted = 0), 0)
                          AS stock,
                        ISNULL((SELECT SUM(r.qty) FROM ConsumableReorders r
                                WHERE r.consumable_id = c.id AND r.is_deleted = 0
                                  AND r.status IN ('basket','approved','ordered')), 0) AS on_order
                 FROM Consumables c
                 WHERE c.is_deleted = 0
                 ORDER BY c.category, c.item_code`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('consumables list error:', err);
            return serverError('Failed to load consumables', request);
        }
    }
});

app.http('consumables-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'consumables',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.name || !String(b.name).trim()) return badRequest('name is required', request);
            let code = String(b.item_code || '').trim();
            if (!code) {
                const max = await query(
                    `SELECT MAX(TRY_CONVERT(INT, SUBSTRING(item_code, 5, 10))) AS n
                     FROM Consumables WHERE is_deleted = 0 AND item_code LIKE 'CON-%'`);
                code = 'CON-' + String((max.recordset[0].n || 0) + 1).padStart(3, '0');
            }
            const dup = await query(`SELECT id FROM Consumables WHERE is_deleted = 0 AND item_code = @c`, { c: code });
            if (dup.recordset.length) return badRequest(`Item code ${code} already exists`, request);
            const num = v => (v === '' || v === null || v === undefined || !isFinite(+v)) ? null : +v;
            const res = await query(
                `INSERT INTO Consumables
                   (item_code, name, category, spec, unit, pack_size, supplier_name, supplier_part,
                    location, opening_qty, reorder_level, reorder_qty, batch_tracked, notes, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@code, @name, @cat, @spec, @unit, @pack, @sup, @part, @loc,
                         @open, @rlevel, @rqty, @batch, @notes, @by)`,
                {
                    code: code.slice(0, 40), name: String(b.name).trim().slice(0, 200),
                    cat: CATEGORIES.includes(b.category) ? b.category : 'other',
                    spec: b.spec || null,
                    unit: UNITS.includes(b.unit) ? b.unit : 'each',
                    pack: b.pack_size || null, sup: b.supplier_name || null, part: b.supplier_part || null,
                    loc: b.location || null,
                    open: num(b.opening_qty) || 0, rlevel: num(b.reorder_level), rqty: num(b.reorder_qty),
                    batch: b.batch_tracked ? 1 : 0, notes: b.notes || null,
                    by: auth.name || auth.email || null
                });
            return created({ id: res.recordset[0].id, item_code: code }, request);
        } catch (err) {
            context.error('consumables create error:', err);
            return serverError('Failed to create the item', request);
        }
    }
});

app.http('consumables-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'consumables/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid item id', request);
            const cur = await query(`SELECT id, name FROM Consumables WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Item not found', request);
            const b = await request.json();
            const num = v => (v === '' || v === null || v === undefined || !isFinite(+v)) ? null : +v;
            const map = {
                name: v => String(v || '').trim().slice(0, 200) || cur.recordset[0].name,
                category: v => CATEGORIES.includes(v) ? v : 'other',
                spec: v => v || null, unit: v => UNITS.includes(v) ? v : 'each',
                pack_size: v => v || null, supplier_name: v => v || null, supplier_part: v => v || null,
                location: v => v || null, opening_qty: v => num(v) || 0,
                reorder_level: num, reorder_qty: num,
                batch_tracked: v => v ? 1 : 0, notes: v => v || null, is_active: v => v ? 1 : 0
            };
            const sets = []; const params = { id };
            for (const [f, coerce] of Object.entries(map))
                if (f in b) { sets.push(`${f} = @${f}`); params[f] = coerce(b[f]); }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE Consumables SET ${sets.join(', ')} WHERE id = @id`, params);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('consumables update error:', err);
            return serverError('Failed to update the item', request);
        }
    }
});

app.http('consumables-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'consumables/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid item id', request);
            const cur = await query(`SELECT id, item_code, name FROM Consumables WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Item not found', request);
            // Movements are left alone: the history of what was issued stays true
            // even when an item is retired from the catalogue.
            await query(`UPDATE Consumables SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            await logChange('consumable', id, `${cur.recordset[0].item_code} ${cur.recordset[0].name}`,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('consumables delete error:', err);
            return serverError('Failed to delete the item', request);
        }
    }
});

// ── Movements ───────────────────────────────────────────────────────────────
const MOV_COLS = `id, consumable_id, direction, qty, batch_no, issued_to, job_id, job_number,
    po_number, CONVERT(varchar(10), moved_on, 23) AS moved_on, source, notes, entered_by, created_at`;

app.http('consumable-movements-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'consumable-movements',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const cid = parseInt(sp.get('consumable_id')), jid = parseInt(sp.get('job_id'));
            const since = sp.get('since');
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(cid)) { where += ' AND consumable_id = @cid'; params.cid = cid; }
            if (Number.isFinite(jid)) { where += ' AND job_id = @jid'; params.jid = jid; }
            if (since)                { where += ' AND moved_on >= @since'; params.since = since; }
            const res = await query(
                `SELECT TOP 500 ${MOV_COLS} FROM ConsumableMovements WHERE ${where}
                 ORDER BY moved_on DESC, id DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('consumable-movements list error:', err);
            return serverError('Failed to load movements', request);
        }
    }
});

const insertMovement = async (b, auth) => {
    const qty = Number(b.qty);
    if (!isFinite(qty) || qty <= 0) throw new Error('qty must be greater than zero');
    if (!['in', 'out'].includes(b.direction)) throw new Error("direction must be 'in' or 'out'");
    return query(
        `INSERT INTO ConsumableMovements
           (consumable_id, direction, qty, batch_no, issued_to, job_id, job_number, po_number,
            moved_on, source, notes, entered_by)
         OUTPUT INSERTED.id
         VALUES (@cid, @dir, @qty, @batch, @to, @jid, @jno, @po, @on, @src, @notes, @by)`,
        {
            cid: parseInt(b.consumable_id), dir: b.direction, qty,
            batch: b.batch_no || null, to: b.issued_to || null,
            jid: Number.isFinite(+b.job_id) ? +b.job_id : null,
            jno: b.job_number || null, po: b.po_number || null,
            on: b.moved_on || new Date().toISOString().slice(0, 10),
            src: SOURCES.includes(b.source) ? b.source : 'office',
            notes: b.notes || null, by: auth.name || auth.email || null
        });
};

app.http('consumable-movements-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'consumable-movements',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!Number.isFinite(parseInt(b.consumable_id))) return badRequest('consumable_id is required', request);
            const res = await insertMovement(b, auth);
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            if (/qty must|direction must/.test(err.message)) return badRequest(err.message, request);
            context.error('consumable-movements create error:', err);
            return serverError('Failed to record the movement', request);
        }
    }
});

// Type in a completed paper tally sheet in one go. Partial success is reported
// rather than rolled back — if line 7 is unreadable, the other 12 still count.
app.http('consumable-movements-bulk', {
    methods: ['POST'], authLevel: 'anonymous', route: 'consumable-movements-bulk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const rows = Array.isArray(b.rows) ? b.rows : [];
            if (!rows.length) return badRequest('No rows supplied', request);
            let inserted = 0; const failures = [];
            for (let i = 0; i < rows.length; i++) {
                try {
                    if (!Number.isFinite(parseInt(rows[i].consumable_id))) throw new Error('no item selected');
                    await insertMovement({ source: b.source || 'paper', moved_on: b.moved_on, ...rows[i] }, auth);
                    inserted++;
                } catch (e) { failures.push({ line: i + 1, reason: e.message }); }
            }
            return ok({ inserted, failures }, request);
        } catch (err) {
            context.error('consumable-movements bulk error:', err);
            return serverError('Failed to record the sheet', request);
        }
    }
});

app.http('consumable-movements-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'consumable-movements/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid movement id', request);
            const cur = await query(`SELECT id, consumable_id, direction, qty FROM ConsumableMovements WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Movement not found', request);
            await query(`UPDATE ConsumableMovements SET is_deleted = 1 WHERE id = @id`, { id });
            const m = cur.recordset[0];
            await logChange('consumable_movement', id, `${m.direction} ${m.qty}`,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('consumable-movements delete error:', err);
            return serverError('Failed to delete the movement', request);
        }
    }
});

// ── Reorder basket ──────────────────────────────────────────────────────────
app.http('consumable-reorders-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'consumable-reorders',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const status = new URL(request.url).searchParams.get('status');
            const params = {}; let where = 'r.is_deleted = 0';
            if (REORDER_STATUSES.includes(status)) { where += ' AND r.status = @st'; params.st = status; }
            const res = await query(
                `SELECT r.id, r.consumable_id, r.qty, r.status, r.stock_at_request, r.requested_by,
                        r.approved_by, r.approved_at, r.po_number, r.notes, r.created_at, r.updated_at,
                        c.item_code, c.name, c.unit, c.pack_size, c.supplier_name, c.supplier_part
                 FROM ConsumableReorders r
                 LEFT JOIN Consumables c ON c.id = r.consumable_id
                 WHERE ${where}
                 ORDER BY CASE r.status WHEN 'basket' THEN 0 WHEN 'approved' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,
                          c.supplier_name, c.item_code`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('consumable-reorders list error:', err);
            return serverError('Failed to load the reorder basket', request);
        }
    }
});

app.http('consumable-reorders-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'consumable-reorders',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const cid = parseInt(b.consumable_id);
            const qty = Number(b.qty);
            if (!Number.isFinite(cid)) return badRequest('consumable_id is required', request);
            if (!isFinite(qty) || qty <= 0) return badRequest('qty must be greater than zero', request);
            // Already in the basket or approved? Don't stack duplicates.
            const dup = await query(
                `SELECT id FROM ConsumableReorders WHERE consumable_id = @cid AND is_deleted = 0
                   AND status IN ('basket','approved')`, { cid });
            if (dup.recordset.length) return badRequest('Already in the basket for this item', request);
            const res = await query(
                `INSERT INTO ConsumableReorders (consumable_id, qty, stock_at_request, requested_by, notes)
                 OUTPUT INSERTED.id VALUES (@cid, @qty, @stock, @by, @notes)`,
                {
                    cid, qty,
                    stock: isFinite(+b.stock_at_request) ? +b.stock_at_request : null,
                    by: b.requested_by || auth.name || auth.email || null,
                    notes: b.notes || null
                });
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('consumable-reorders create error:', err);
            return serverError('Failed to add to the basket', request);
        }
    }
});

// Approve / mark ordered / cancel. Approval is recorded against a name — it is
// the moment a human takes responsibility for the spend.
app.http('consumable-reorders-update', {
    methods: ['PUT'], authLevel: 'anonymous', route: 'consumable-reorders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid reorder id', request);
            const cur = await query(
                `SELECT r.id, r.status, r.qty, c.item_code, c.name FROM ConsumableReorders r
                 LEFT JOIN Consumables c ON c.id = r.consumable_id
                 WHERE r.id = @id AND r.is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Reorder not found', request);
            const before = cur.recordset[0];
            const b = await request.json();
            const sets = []; const params = { id };
            if ('qty' in b) {
                const q = Number(b.qty);
                if (!isFinite(q) || q <= 0) return badRequest('qty must be greater than zero', request);
                sets.push('qty = @qty'); params.qty = q;
            }
            if ('notes' in b)     { sets.push('notes = @notes'); params.notes = b.notes || null; }
            if ('po_number' in b) { sets.push('po_number = @po'); params.po = b.po_number || null; }
            if ('status' in b && REORDER_STATUSES.includes(b.status)) {
                sets.push('status = @st'); params.st = b.status;
                if (b.status === 'approved') {
                    sets.push('approved_by = @ab, approved_at = SYSUTCDATETIME()');
                    params.ab = b.approved_by || auth.name || auth.email || null;
                }
            }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE ConsumableReorders SET ${sets.join(', ')} WHERE id = @id`, params);
            if ('status' in b && b.status !== before.status && REORDER_STATUSES.includes(b.status))
                await logChange('consumable_reorder', id, `${before.item_code || ''} ${before.name || ''}`.trim(),
                    'status_change', before.status, b.status, auth.name || auth.email);
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('consumable-reorders update error:', err);
            return serverError('Failed to update the reorder', request);
        }
    }
});

app.http('consumable-reorders-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'consumable-reorders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid reorder id', request);
            await query(`UPDATE ConsumableReorders SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('consumable-reorders delete error:', err);
            return serverError('Failed to remove from the basket', request);
        }
    }
});
