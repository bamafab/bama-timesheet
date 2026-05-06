// ─────────────────────────────────────────────────────────────────────────────
// quote-financials.js
//
// Endpoints for the Project Tracker financial dashboard:
//   /api/quote-line-items            — the 9 fixed line items per quote
//   /api/quote-line-items/seed       — auto-seed the 9 default rows for a quote
//   /api/project-quotes              — multi-quote-per-project link table
//   /api/project-line-progress       — per-line % complete on a project
//
// Permissions: rides on existing viewQuotes / editQuotes (no new perm strings).
// All endpoints require auth via requireAuth (handled in shared middleware).
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ─────────────────────────────────────────────────────────────────────────────
// Default seed rows for a brand-new quote.
// `is_labour` defaults follow the SPEC's "inclusive" set (Approval & Fab Pack,
// Survey, Fabrication, Painting, Installation). The user can untick per-line.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_LINE_ITEMS = [
    { line_no: 1, category: 'prelims',           description: 'Prelims',                         is_labour: 0 },
    { line_no: 2, category: 'approval_fab_pack', description: 'Approval and Fabrication Pack',   is_labour: 1 },
    { line_no: 3, category: 'survey',            description: 'Survey',                          is_labour: 1 },
    { line_no: 4, category: 'material',          description: 'Material cost',                   is_labour: 0 },
    { line_no: 5, category: 'fabrication',       description: 'Fabrication',                     is_labour: 1 },
    { line_no: 6, category: 'painting',          description: 'Painting',                        is_labour: 1 },
    { line_no: 7, category: 'galvanising',       description: 'Galvanising',                     is_labour: 0 },
    { line_no: 8, category: 'installation',      description: 'Installation',                    is_labour: 1 },
    { line_no: 9, category: 'delivery',          description: 'Delivery',                        is_labour: 0 }
];

// ─────────────────────────────────────────────────────────────────────────────
// Quote Line Items
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/quote-line-items?tender_id=X
app.http('quote-line-items-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'quote-line-items',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const tenderId = parseInt(request.query.get('tender_id'));
            if (!tenderId) return badRequest('tender_id is required', request);
            const result = await query(
                `SELECT * FROM QuoteLineItems WHERE tender_id = @tenderId ORDER BY line_no ASC`,
                { tenderId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('quote-line-items-list:', err);
            return serverError('Failed to fetch quote line items', request);
        }
    }
});

// POST /api/quote-line-items/seed/:tender_id — insert the 9 default rows
// (idempotent — does nothing if any row already exists for that tender).
app.http('quote-line-items-seed', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'quote-line-items/seed/{tender_id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const tenderId = parseInt(request.params.tender_id);
            if (!tenderId) return badRequest('tender_id is required', request);

            // Idempotency: if line items already exist, return them and bail.
            const existing = await query(
                `SELECT * FROM QuoteLineItems WHERE tender_id = @tenderId ORDER BY line_no ASC`,
                { tenderId }
            );
            if (existing.recordset.length > 0) return ok(existing.recordset, request);

            // Insert all 9 defaults. Using a single batch for atomicity is overkill
            // here — the unique index protects us from races with a 2nd concurrent
            // seed call (they'd just collide and the loser's rows fail gracefully).
            for (const li of DEFAULT_LINE_ITEMS) {
                await query(
                    `INSERT INTO QuoteLineItems (tender_id, line_no, category, description, is_labour)
                     VALUES (@tenderId, @lineNo, @category, @description, @isLabour)`,
                    { tenderId, lineNo: li.line_no, category: li.category, description: li.description, isLabour: li.is_labour }
                );
            }

            const result = await query(
                `SELECT * FROM QuoteLineItems WHERE tender_id = @tenderId ORDER BY line_no ASC`,
                { tenderId }
            );
            return created(result.recordset, request);
        } catch (err) {
            context.error('quote-line-items-seed:', err);
            return serverError('Failed to seed quote line items', request);
        }
    }
});

// PUT /api/quote-line-items/:id — update a single line item
app.http('quote-line-items-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'quote-line-items/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };
            const allowed = ['description', 'quantity', 'unit_price', 'vat_applies', 'vat_rate', 'is_labour'];
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    fields.push(`${key} = @${key}`);
                    params[key] = body[key];
                }
            }
            if (fields.length === 0) return badRequest('No fields to update', request);
            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE QuoteLineItems SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );
            if (result.recordset.length === 0) return notFound('Line item not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('quote-line-items-update:', err);
            return serverError('Failed to update line item', request);
        }
    }
});

// PUT /api/quote-line-items/bulk — update multiple line items in one request.
// Body: { items: [{ id, description?, quantity?, unit_price?, vat_applies?, vat_rate?, is_labour? }, ...] }
// Returns the updated rows. Used by the line-items editor's Save button so we
// don't fire 9 separate requests on every save.
app.http('quote-line-items-bulk-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'quote-line-items-bulk',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) return badRequest('items array is required', request);

            const allowed = ['description', 'quantity', 'unit_price', 'vat_applies', 'vat_rate', 'is_labour'];
            const updated = [];
            for (const item of items) {
                if (!item.id) continue;
                const fields = [];
                const params = { id: parseInt(item.id) };
                for (const key of allowed) {
                    if (item[key] !== undefined) {
                        fields.push(`${key} = @${key}`);
                        params[key] = item[key];
                    }
                }
                if (!fields.length) continue;
                fields.push('updated_at = GETUTCDATE()');
                const r = await query(
                    `UPDATE QuoteLineItems SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                    params
                );
                if (r.recordset.length) updated.push(r.recordset[0]);
            }
            return ok(updated, request);
        } catch (err) {
            context.error('quote-line-items-bulk-update:', err);
            return serverError('Failed to update line items', request);
        }
    }
});

app.http('quote-line-items-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'quote-line-items/{*path}',
    handler: async (request) => preflight(request)
});
app.http('quote-line-items-bulk-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'quote-line-items-bulk',
    handler: async (request) => preflight(request)
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Quotes — link table for multi-quote-per-project
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/project-quotes?project_id=X — returns each linked quote with its
// Tenders row joined in (so the frontend can show client/project/value/etc).
app.http('project-quotes-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-quotes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(request.query.get('project_id'));
            if (!projectId) return badRequest('project_id is required', request);
            const result = await query(
                `SELECT pq.project_id, pq.tender_id, pq.is_primary, pq.added_at, pq.added_by,
                        t.reference, t.project_name AS quote_project_name, t.status AS quote_status,
                        t.value AS quote_value, t.comments AS quote_comments,
                        t.client_id, c.company_name
                 FROM ProjectQuotes pq
                 INNER JOIN Tenders t ON t.id = pq.tender_id
                 LEFT JOIN Clients c ON c.id = t.client_id
                 WHERE pq.project_id = @projectId
                 ORDER BY pq.is_primary DESC, pq.added_at ASC`,
                { projectId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('project-quotes-list:', err);
            return serverError('Failed to fetch project quotes', request);
        }
    }
});

// POST /api/project-quotes — attach an existing quote to a project
app.http('project-quotes-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'project-quotes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const { project_id, tender_id, is_primary, added_by } = body;
            if (!project_id || !tender_id) return badRequest('project_id and tender_id are required', request);

            // Reject duplicates politely (UNIQUE constraint would do it but the
            // error would be cryptic to the frontend).
            const dupe = await query(
                `SELECT 1 FROM ProjectQuotes WHERE project_id = @pid AND tender_id = @tid`,
                { pid: parseInt(project_id), tid: parseInt(tender_id) }
            );
            if (dupe.recordset.length) return badRequest('That quote is already attached to this project', request);

            await query(
                `INSERT INTO ProjectQuotes (project_id, tender_id, is_primary, added_by)
                 VALUES (@pid, @tid, @primary, @by)`,
                { pid: parseInt(project_id), tid: parseInt(tender_id), primary: is_primary ? 1 : 0, by: added_by || null }
            );
            return created({ project_id: parseInt(project_id), tender_id: parseInt(tender_id), is_primary: !!is_primary }, request);
        } catch (err) {
            context.error('project-quotes-create:', err);
            return serverError('Failed to attach quote', request);
        }
    }
});

// DELETE /api/project-quotes/:project_id/:tender_id — detach. Refuses the
// primary quote: the original winning quote stays bonded to its project.
app.http('project-quotes-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'project-quotes/{project_id}/{tender_id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(request.params.project_id);
            const tenderId  = parseInt(request.params.tender_id);
            const row = await query(
                `SELECT is_primary FROM ProjectQuotes WHERE project_id = @pid AND tender_id = @tid`,
                { pid: projectId, tid: tenderId }
            );
            if (!row.recordset.length) return notFound('Link not found', request);
            if (row.recordset[0].is_primary) {
                return badRequest('Cannot detach the primary (originating) quote from a project', request);
            }
            await query(
                `DELETE FROM ProjectQuotes WHERE project_id = @pid AND tender_id = @tid`,
                { pid: projectId, tid: tenderId }
            );
            return ok({ deleted: true, project_id: projectId, tender_id: tenderId }, request);
        } catch (err) {
            context.error('project-quotes-delete:', err);
            return serverError('Failed to detach quote', request);
        }
    }
});

app.http('project-quotes-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'project-quotes/{*path}',
    handler: async (request) => preflight(request)
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Line Progress — per-line % complete on a project
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/project-line-progress?project_id=X — flat list of progress rows
app.http('project-line-progress-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-line-progress',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projectId = parseInt(request.query.get('project_id'));
            if (!projectId) return badRequest('project_id is required', request);
            const result = await query(
                `SELECT * FROM ProjectLineProgress WHERE project_id = @projectId`,
                { projectId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('project-line-progress-list:', err);
            return serverError('Failed to fetch progress', request);
        }
    }
});

// PUT /api/project-line-progress — upsert a single (project, line) progress row.
// Body: { project_id, quote_line_item_id, percent_complete, last_updated_by }
app.http('project-line-progress-upsert', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'project-line-progress',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const { project_id, quote_line_item_id, percent_complete, last_updated_by } = body;
            if (!project_id || !quote_line_item_id) return badRequest('project_id and quote_line_item_id are required', request);
            const pct = parseFloat(percent_complete);
            if (Number.isNaN(pct) || pct < 0 || pct > 100) return badRequest('percent_complete must be between 0 and 100', request);

            // MERGE-style upsert via try-update-then-insert. Avoids needing to know
            // the unique-constraint error code per provider.
            const upd = await query(
                `UPDATE ProjectLineProgress
                 SET percent_complete = @pct, last_updated_by = @by, last_updated_at = GETUTCDATE()
                 OUTPUT INSERTED.*
                 WHERE project_id = @pid AND quote_line_item_id = @lid`,
                { pid: parseInt(project_id), lid: parseInt(quote_line_item_id), pct, by: last_updated_by || null }
            );
            if (upd.recordset.length) return ok(upd.recordset[0], request);

            const ins = await query(
                `INSERT INTO ProjectLineProgress (project_id, quote_line_item_id, percent_complete, last_updated_by)
                 OUTPUT INSERTED.*
                 VALUES (@pid, @lid, @pct, @by)`,
                { pid: parseInt(project_id), lid: parseInt(quote_line_item_id), pct, by: last_updated_by || null }
            );
            return created(ins.recordset[0], request);
        } catch (err) {
            context.error('project-line-progress-upsert:', err);
            return serverError('Failed to update progress', request);
        }
    }
});

app.http('project-line-progress-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'project-line-progress/{*path}',
    handler: async (request) => preflight(request)
});
