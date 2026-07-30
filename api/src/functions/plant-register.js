// ─────────────────────────────────────────────────────────────────────────────
// plant-register.js  (Plant Register, 2026-07-30)
//
// Company plant & equipment register: items with per-regime next-due dates
// (LOLER / PUWER / PAT / calibration / service / MOT) + a per-item document
// register for inspection certs / service reports (files upload browser→Graph
// into BAMA / 02 - Quality (QMS) / 07 - Plant & Equipment / <Ref - Name>;
// this API is metadata + reminder logic only). Mirrors employee-documents.js.
//
// Routes (flat naming per CLAUDE.md):
//   GET    /api/plant-items                — active items (?all=true incl. deleted-excluded archived statuses)
//   GET    /api/plant-items/expiring       — regime dates expired or due ≤60 days (in-service / under-repair only)
//   POST   /api/plant-items                — create
//   PUT    /api/plant-items/{id}           — partial update (status transitions audited)
//   DELETE /api/plant-items/{id}           — soft delete (audited)
//   GET    /api/plant-documents            — ?plant_id= filter (?all=true incl. archived)
//   POST   /api/plant-documents            — create
//   PUT    /api/plant-documents/{id}       — partial update / archive (audited)
//   DELETE /api/plant-documents/{id}       — soft delete (audited)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const CATEGORIES = ['lifting_equipment', 'lifting_accessory', 'access', 'welding',
                    'machine', 'power_tool', 'vehicle', 'measuring', 'other'];
const STATUSES   = ['in_service', 'under_repair', 'quarantined', 'off_hired', 'disposed'];
const REGIMES    = ['loler_due', 'puwer_due', 'pat_due', 'calib_due', 'service_due', 'mot_due'];
const DOC_TYPES  = ['loler', 'puwer', 'pat', 'calibration', 'service', 'mot', 'manual', 'other'];

// ─── Welding machines live in this register (F3, Mateusz's decision) ─────────
// WeldingMachines is NOT dropped: JobAssemblies.welding_machine_id points at it
// in two migrations and the workshop kiosk reads /api/welding-machines. So the
// plant row is the editing surface and we keep the WeldingMachines row in step
// behind it — meaning every historic assembly still resolves and the kiosk
// needs no change whatsoever. A welding machine's calib_due IS its verification
// expiry (BAM VER 001), so it maps to WeldingMachines.expiry_date.
async function syncWeldingMachine(plantId, context) {
    try {
        const p = await query(
            `SELECT id, name, serial_no, CONVERT(varchar(10), calib_due, 23) AS calib_due, status, notes, category
             FROM PlantItems WHERE id = @id AND is_deleted = 0`, { id: plantId });
        if (!p.recordset.length) return;
        const item = p.recordset[0];
        if (item.category !== 'welding') return;   // only welding items shadow a machine

        const existing = await query(`SELECT id FROM WeldingMachines WHERE plant_id = @pid`, { pid: plantId });
        const isActive = (item.status === 'disposed' || item.status === 'off_hired') ? 0 : 1;
        const params = {
            pid: plantId,
            name: String(item.name || 'Welding machine').slice(0, 200),
            serial: item.serial_no || null,
            expiry: item.calib_due || null,
            notes: item.notes || null,
            active: isActive
        };
        if (existing.recordset.length) {
            await query(
                `UPDATE WeldingMachines SET machine_name = @name, serial_number = @serial,
                        expiry_date = @expiry, notes = @notes, is_active = @active, updated_at = GETUTCDATE()
                 WHERE plant_id = @pid`, params);
        } else {
            await query(
                `INSERT INTO WeldingMachines (machine_name, serial_number, expiry_date, notes, is_active, plant_id)
                 VALUES (@name, @serial, @expiry, @notes, @active, @pid)`, params);
        }
    } catch (err) {
        // Never fail the plant save because the shadow row misbehaved — the
        // plant register is the source of truth and a resync is idempotent.
        // Most likely cause: plant_id column missing (migration not yet run).
        if (context) context.warn('Welding machine sync skipped: ' + err.message);
    }
}

const ITEM_COLS = `id, plant_ref, name, category, make, model, serial_no, location,
    ownership, hire_company, CONVERT(varchar(10), purchase_date, 23) AS purchase_date, status,
    ${REGIMES.map(r => `CONVERT(varchar(10), ${r}, 23) AS ${r}`).join(', ')},
    notes, created_by, created_at, updated_at`;

const DOC_COLS = `id, plant_id, doc_type, title, doc_ref, issuer,
    CONVERT(varchar(10), issue_date, 23)  AS issue_date,
    CONVERT(varchar(10), expiry_date, 23) AS expiry_date,
    reminder_days, file_name, sharepoint_file_id, drive_id, web_url, notes,
    is_archived, superseded_by, uploaded_by, created_at, updated_at`;

app.http('plant-items-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'plant-items/{*rest}',
    handler: async (req) => preflight(req)
});
app.http('plant-documents-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'plant-documents/{*rest}',
    handler: async (req) => preflight(req)
});

// ── GET items ────────────────────────────────────────────────────────────────
app.http('plant-items-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'plant-items',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(
                `SELECT ${ITEM_COLS} FROM PlantItems WHERE is_deleted = 0
                 ORDER BY CASE status WHEN 'disposed' THEN 2 WHEN 'off_hired' THEN 1 ELSE 0 END, plant_ref`);
            const items = res.recordset;
            // Welding-machine links, fetched separately and defensively: if the
            // migration hasn't run (no plant_id column) the register must still
            // load rather than 500. Never fold this into ITEM_COLS.
            try {
                const links = await query(`SELECT id, plant_id FROM WeldingMachines WHERE plant_id IS NOT NULL`);
                const byPlant = {};
                links.recordset.forEach(l => { byPlant[l.plant_id] = l.id; });
                items.forEach(i => { i.welding_machine_id = byPlant[i.id] || null; });
            } catch (e) {
                context.warn('Welding machine links unavailable (migration not run?): ' + e.message);
            }
            return ok(items, request);
        } catch (err) {
            context.error('plant-items list error:', err);
            return serverError('Failed to load plant register', request);
        }
    }
});

// ── GET expiring (regime dates unpivoted) ────────────────────────────────────
app.http('plant-items-expiring', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'plant-items/expiring',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const unions = REGIMES.map(r =>
                `SELECT id, plant_ref, name, '${r}' AS regime,
                        CONVERT(varchar(10), ${r}, 23) AS due_date,
                        DATEDIFF(day, CAST(GETUTCDATE() AS date), ${r}) AS days_left
                 FROM PlantItems
                 WHERE is_deleted = 0 AND status IN ('in_service','under_repair')
                   AND ${r} IS NOT NULL
                   AND DATEDIFF(day, CAST(GETUTCDATE() AS date), ${r}) <= 60`).join(' UNION ALL ');
            const res = await query(`${unions} ORDER BY days_left`);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('plant-items expiring error:', err);
            return serverError('Failed to load expiring plant inspections', request);
        }
    }
});

// ── POST create item ─────────────────────────────────────────────────────────
app.http('plant-items-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'plant-items',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.plant_ref || !String(b.plant_ref).trim()) return badRequest('plant_ref is required', request);
            if (!b.name || !String(b.name).trim()) return badRequest('name is required', request);
            const dup = await query(
                `SELECT id FROM PlantItems WHERE is_deleted = 0 AND plant_ref = @ref`,
                { ref: String(b.plant_ref).trim() });
            if (dup.recordset.length) return badRequest(`Plant ref ${b.plant_ref} already exists`, request);

            const params = {
                plant_ref: String(b.plant_ref).trim().slice(0, 30),
                name: String(b.name).trim().slice(0, 150),
                category: CATEGORIES.includes(b.category) ? b.category : 'machine',
                make: b.make || null, model: b.model || null, serial_no: b.serial_no || null,
                location: b.location || null,
                ownership: b.ownership === 'hired' ? 'hired' : 'owned',
                hire_company: b.hire_company || null,
                purchase_date: b.purchase_date || null,
                status: STATUSES.includes(b.status) ? b.status : 'in_service',
                notes: b.notes || null,
                created_by: auth.name || auth.email || null
            };
            REGIMES.forEach(r => { params[r] = b[r] || null; });
            const res = await query(
                `INSERT INTO PlantItems
                    (plant_ref, name, category, make, model, serial_no, location, ownership, hire_company,
                     purchase_date, status, ${REGIMES.join(', ')}, notes, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@plant_ref, @name, @category, @make, @model, @serial_no, @location, @ownership, @hire_company,
                         @purchase_date, @status, ${REGIMES.map(r => '@' + r).join(', ')}, @notes, @created_by)`,
                params);
            const newId = res.recordset[0].id;
            if (params.category === 'welding') await syncWeldingMachine(newId, context);
            return created({ id: newId }, request);
        } catch (err) {
            context.error('plant-items create error:', err);
            return serverError('Failed to create plant item', request);
        }
    }
});

// ── PUT update item (partial; status transitions audited) ───────────────────
app.http('plant-items-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'plant-items/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid plant id', request);
            const cur = await query(`SELECT id, plant_ref, name, status FROM PlantItems WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Plant item not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            if ('plant_ref' in b && String(b.plant_ref).trim() !== before.plant_ref) {
                const dup = await query(
                    `SELECT id FROM PlantItems WHERE is_deleted = 0 AND plant_ref = @ref AND id <> @id`,
                    { ref: String(b.plant_ref).trim(), id });
                if (dup.recordset.length) return badRequest(`Plant ref ${b.plant_ref} already exists`, request);
            }

            const sets = []; const params = { id };
            const map = {
                plant_ref: v => String(v || '').trim().slice(0, 30) || before.plant_ref,
                name: v => String(v || '').trim().slice(0, 150) || before.name,
                category: v => CATEGORIES.includes(v) ? v : 'machine',
                make: v => v || null, model: v => v || null, serial_no: v => v || null,
                location: v => v || null,
                ownership: v => v === 'hired' ? 'hired' : 'owned',
                hire_company: v => v || null,
                purchase_date: v => v || null,
                status: v => STATUSES.includes(v) ? v : before.status,
                notes: v => v || null
            };
            REGIMES.forEach(r => { map[r] = v => v || null; });
            for (const [field, coerce] of Object.entries(map))
                if (field in b) { sets.push(`${field} = @${field}`); params[field] = coerce(b[field]); }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE PlantItems SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('status' in b && b.status !== before.status && STATUSES.includes(b.status)) {
                await logChange('plant_item', id, `${before.plant_ref} ${before.name}`,
                    'status_change', before.status, b.status, auth.name || auth.email);
            }
            await syncWeldingMachine(id, context);   // no-op unless category is 'welding'
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('plant-items update error:', err);
            return serverError('Failed to update plant item', request);
        }
    }
});

// ── DELETE item (soft) ───────────────────────────────────────────────────────
app.http('plant-items-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'plant-items/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid plant id', request);
            const cur = await query(`SELECT id, plant_ref, name FROM PlantItems WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Plant item not found', request);
            await query(`UPDATE PlantItems SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            // Deactivate the shadow machine — NEVER delete it. JobAssemblies rows
            // point at its id and deleting would orphan fabrication history.
            try {
                await query(`UPDATE WeldingMachines SET is_active = 0, updated_at = GETUTCDATE() WHERE plant_id = @pid`, { pid: id });
            } catch (e) { context.warn('Welding machine deactivate skipped: ' + e.message); }
            await logChange('plant_item', id, `${cur.recordset[0].plant_ref} ${cur.recordset[0].name}`,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('plant-items delete error:', err);
            return serverError('Failed to delete plant item', request);
        }
    }
});

// ── GET documents ────────────────────────────────────────────────────────────
app.http('plant-documents-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'plant-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const showAll = sp.get('all') === 'true';
            const plantId = parseInt(sp.get('plant_id'));
            const params = {};
            let where = 'is_deleted = 0' + (showAll ? '' : ' AND is_archived = 0');
            if (Number.isFinite(plantId)) { where += ' AND plant_id = @pid'; params.pid = plantId; }
            const res = await query(
                `SELECT ${DOC_COLS} FROM PlantDocuments WHERE ${where}
                 ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('plant-documents list error:', err);
            return serverError('Failed to load plant documents', request);
        }
    }
});

// ── POST create document ─────────────────────────────────────────────────────
app.http('plant-documents-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'plant-documents',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const plantId = parseInt(b.plant_id);
            if (!Number.isFinite(plantId)) return badRequest('plant_id is required', request);
            if (!b.title || !String(b.title).trim()) return badRequest('title is required', request);
            const res = await query(
                `INSERT INTO PlantDocuments
                    (plant_id, doc_type, title, doc_ref, issuer, issue_date, expiry_date, reminder_days,
                     file_name, sharepoint_file_id, drive_id, web_url, notes, uploaded_by)
                 OUTPUT INSERTED.id
                 VALUES (@plant_id, @doc_type, @title, @doc_ref, @issuer, @issue_date, @expiry_date, @reminder_days,
                         @file_name, @sharepoint_file_id, @drive_id, @web_url, @notes, @uploaded_by)`,
                {
                    plant_id: plantId,
                    doc_type: DOC_TYPES.includes(b.doc_type) ? b.doc_type : 'other',
                    title: String(b.title).trim().slice(0, 200),
                    doc_ref: b.doc_ref || null, issuer: b.issuer || null,
                    issue_date: b.issue_date || null, expiry_date: b.expiry_date || null,
                    reminder_days: Number.isFinite(+b.reminder_days) ? Math.max(0, +b.reminder_days) : 30,
                    file_name: b.file_name || null, sharepoint_file_id: b.sharepoint_file_id || null,
                    drive_id: b.drive_id || null, web_url: b.web_url || null,
                    notes: b.notes || null,
                    uploaded_by: auth.name || auth.email || null
                });
            return created({ id: res.recordset[0].id }, request);
        } catch (err) {
            context.error('plant-documents create error:', err);
            return serverError('Failed to create plant document', request);
        }
    }
});

// ── PUT update document (partial; archive audited) ───────────────────────────
app.http('plant-documents-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'plant-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(`SELECT id, title, is_archived FROM PlantDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);
            const before = cur.recordset[0];

            const b = await request.json();
            const sets = []; const params = { id };
            const map = {
                doc_type: v => DOC_TYPES.includes(v) ? v : 'other',
                title: v => String(v || '').trim().slice(0, 200) || before.title,
                doc_ref: v => v || null, issuer: v => v || null,
                issue_date: v => v || null, expiry_date: v => v || null,
                reminder_days: v => Number.isFinite(+v) ? Math.max(0, +v) : 30,
                file_name: v => v || null, sharepoint_file_id: v => v || null,
                drive_id: v => v || null, web_url: v => v || null,
                notes: v => v || null,
                is_archived: v => v ? 1 : 0,
                superseded_by: v => Number.isFinite(+v) ? +v : null
            };
            for (const [field, coerce] of Object.entries(map))
                if (field in b) { sets.push(`${field} = @${field}`); params[field] = coerce(b[field]); }
            if (!sets.length) return badRequest('No fields to update', request);
            sets.push('updated_at = SYSUTCDATETIME()');
            await query(`UPDATE PlantDocuments SET ${sets.join(', ')} WHERE id = @id`, params);

            if ('is_archived' in b && (b.is_archived ? 1 : 0) !== before.is_archived) {
                await logChange('plant_document', id, before.title,
                    b.is_archived ? 'archived' : 'unarchived',
                    before.is_archived ? 'archived' : 'active',
                    b.is_archived ? 'archived' : 'active',
                    auth.name || auth.email);
            }
            return ok({ id, updated: true }, request);
        } catch (err) {
            context.error('plant-documents update error:', err);
            return serverError('Failed to update plant document', request);
        }
    }
});

// ── DELETE document (soft) ───────────────────────────────────────────────────
app.http('plant-documents-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'plant-documents/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid document id', request);
            const cur = await query(`SELECT id, title FROM PlantDocuments WHERE id = @id AND is_deleted = 0`, { id });
            if (!cur.recordset.length) return notFound('Document not found', request);
            await query(`UPDATE PlantDocuments SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
            await logChange('plant_document', id, cur.recordset[0].title,
                'soft_delete', 'active', 'deleted', auth.name || auth.email);
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('plant-documents delete error:', err);
            return serverError('Failed to delete plant document', request);
        }
    }
});
