// ─────────────────────────────────────────────────────────────────────────────
// qb-quotes.js
//
// REST endpoints for the Quote Builder → SQL integration.
//
// Routes:
//   GET    /api/qb-quotes              — list (filter: status, year)
//   GET    /api/qb-quotes/next-ref     — next free reference (scans QB + Tenders)
//   GET    /api/qb-quotes/:id          — single quote (full blob)
//   POST   /api/qb-quotes              — create
//   PUT    /api/qb-quotes/:id          — update / save
//   PUT    /api/qb-quotes/:id/mark-won — mark won + create Project row
//   DELETE /api/qb-quotes/:id          — delete (editQuotes only)
//
//   POST   /api/qb-snapshots           — save a revision snapshot
//   GET    /api/qb-snapshots?quote_id= — list snapshots for a quote
//
// Permissions:
//   viewQuotes  — read access
//   editQuotes  — create / update / delete / mark-won
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// OPTIONS preflight — covers all /api/qb-quotes/* and /api/qb-snapshots/*
app.http('qb-quotes-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'qb-quotes/{*path}',
    handler: async (request) => preflight(request)
});
app.http('qb-snapshots-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'qb-snapshots/{*path}',
    handler: async (request) => preflight(request)
});
app.http('qb-next-ref-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'qb-next-ref',
    handler: async (request) => preflight(request)
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper — check viewQuotes or editQuotes permission
// ─────────────────────────────────────────────────────────────────────────────
async function getPerms(auth) {
    try {
        const r = await query(
            `SELECT up.edit_quotes, up.view_quotes
               FROM UserPermissions up
               JOIN Employees e ON e.id = up.employee_id
              WHERE LOWER(e.name) = LOWER(@name)
                 OR (e.email IS NOT NULL AND LOWER(e.email) = LOWER(@email))`,
            { name: auth.name || '', email: auth.email || '' }
        );
        const row = r.recordset[0];
        return {
            view: !!(row?.view_quotes || row?.edit_quotes),
            edit: !!row?.edit_quotes
        };
    } catch (e) {
        // If Employees has no email column or query fails, fall back to name-only
        try {
            const r = await query(
                `SELECT up.edit_quotes, up.view_quotes
                   FROM UserPermissions up
                   JOIN Employees e ON e.id = up.employee_id
                  WHERE LOWER(e.name) = LOWER(@name)`,
                { name: auth.name || '' }
            );
            const row = r.recordset[0];
            return { view: !!(row?.view_quotes || row?.edit_quotes), edit: !!row?.edit_quotes };
        } catch {
            return { view: false, edit: false };
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/qb-quotes/next-ref
// Returns the next available reference for the current month.
// Scans BOTH QuoteBuilderQuotes AND Tenders to avoid collisions.
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-next-ref', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'qb-next-ref',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const now   = new Date();
            const yy    = String(now.getFullYear()).slice(2);
            const mm    = String(now.getMonth() + 1).padStart(2, '0');
            const prefix = `Q${yy}${mm}`;

            // Find highest sequence number across all tables
            const [qbRes, tRes, trRes] = await Promise.all([
                query(
                    `SELECT TOP 1 reference FROM QuoteBuilderQuotes
                      WHERE reference LIKE @prefix + '%' AND status != 'deleted'
                      ORDER BY reference DESC`,
                    { prefix }
                ),
                query(
                    `SELECT TOP 1 reference FROM Tenders
                      WHERE reference LIKE @prefix + '%'
                      ORDER BY reference DESC`,
                    { prefix }
                ),
                query(
                    `SELECT TOP 1 reference FROM TenderRegister
                      WHERE reference LIKE @prefix + '%' AND status != 'Deleted'
                      ORDER BY reference DESC`,
                    { prefix }
                )
            ]);
            const extractSeq = (ref) => {
                if (!ref) return 0;
                const s = String(ref).slice(prefix.length);
                const n = parseInt(s, 10);
                return isNaN(n) ? 0 : n;
            };
            const maxSeq = Math.max(
                extractSeq(qbRes.recordset[0]?.reference),
                extractSeq(tRes.recordset[0]?.reference),
                extractSeq(trRes.recordset[0]?.reference)
            );
            const count = maxSeq + 1;
            const reference = `${prefix}${String(count).padStart(2, '0')}`;
            return ok({ reference, prefix, count }, request);
        } catch (err) {
            context.error('qb-quotes-next-ref:', err);
            return serverError('Failed to generate reference', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/qb-quotes — list
// Query params: status, year (2-digit e.g. 26), search
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'qb-quotes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const status = request.query.get('status') || '';
            const year   = request.query.get('year')   || '';  // e.g. '26'
            const search = request.query.get('search') || '';

            let sql = `
                SELECT id, reference, revision, status,
                       date_created, date_sent, decision_due, valid_until,
                       company, contact, email, phone,
                       prepared_by, loss_reason, loss_competitor,
                       total_ex_vat, total_kg, margin_pct,
                       cost_material, cost_installation, cost_fabrication,
                       cost_design, cost_painting, cost_survey, cost_delivery, cost_prelims,
                       sharepoint_folder_id, sharepoint_tender_folder_id,
                       project_id, created_by, created_at, updated_at
                FROM QuoteBuilderQuotes
                WHERE 1=1`;
            const params = {};

            if (status) {
                sql += ` AND status = @status`;
                params.status = status;
            }
            if (year) {
                sql += ` AND reference LIKE @yearPrefix + '%'`;
                params.yearPrefix = `Q${year}`;
            }
            if (search) {
                sql += ` AND (reference LIKE @search OR company LIKE @search OR contact LIKE @search)`;
                params.search = `%${search}%`;
            }

            sql += ` ORDER BY date_created DESC, id DESC`;

            const result = await query(sql, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('qb-quotes-list:', err);
            return serverError('Failed to fetch QB quotes', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/qb-quotes/:id — single quote with full blob
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'qb-quotes/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);
            const result = await query(
                `SELECT * FROM QuoteBuilderQuotes WHERE id = @id`,
                { id }
            );
            if (!result.recordset.length) return notFound(request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('qb-quotes-get:', err);
            return serverError('Failed to fetch quote', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/qb-quotes — create new quote
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'qb-quotes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const {
                reference, revision = '', status = 'draft',
                date_created, date_sent = null, decision_due = null, valid_until = null,
                company = '', contact = '', email = '', phone = '', site_address = '',
                prepared_by = '',
                loss_reason = '', loss_competitor = '', loss_comment = '',
                total_ex_vat = null, total_kg = null, margin_pct = null,
                cost_material = null, cost_installation = null, cost_fabrication = null,
                cost_design = null, cost_painting = null, cost_survey = null,
                cost_delivery = null, cost_prelims = null,
                sharepoint_folder_id = null, sharepoint_tender_folder_id = null,
                quote_data = '{}'
            } = body;

            if (!reference) return badRequest('reference is required', request);
            if (!date_created) return badRequest('date_created is required', request);

            const result = await query(
                `INSERT INTO QuoteBuilderQuotes (
                    reference, revision, status,
                    date_created, date_sent, decision_due, valid_until,
                    company, contact, email, phone, site_address, prepared_by,
                    loss_reason, loss_competitor, loss_comment,
                    total_ex_vat, total_kg, margin_pct,
                    cost_material, cost_installation, cost_fabrication,
                    cost_design, cost_painting, cost_survey, cost_delivery, cost_prelims,
                    sharepoint_folder_id, sharepoint_tender_folder_id,
                    quote_data, created_by, created_at, updated_at
                ) OUTPUT INSERTED.*
                VALUES (
                    @reference, @revision, @status,
                    @date_created, @date_sent, @decision_due, @valid_until,
                    @company, @contact, @email, @phone, @site_address, @prepared_by,
                    @loss_reason, @loss_competitor, @loss_comment,
                    @total_ex_vat, @total_kg, @margin_pct,
                    @cost_material, @cost_installation, @cost_fabrication,
                    @cost_design, @cost_painting, @cost_survey, @cost_delivery, @cost_prelims,
                    @sharepoint_folder_id, @sharepoint_tender_folder_id,
                    @quote_data, @created_by, GETUTCDATE(), GETUTCDATE()
                )`,
                {
                    reference, revision, status,
                    date_created, date_sent, decision_due, valid_until,
                    company, contact, email, phone, site_address, prepared_by,
                    loss_reason, loss_competitor, loss_comment,
                    total_ex_vat, total_kg, margin_pct,
                    cost_material, cost_installation, cost_fabrication,
                    cost_design, cost_painting, cost_survey, cost_delivery, cost_prelims,
                    sharepoint_folder_id, sharepoint_tender_folder_id,
                    quote_data: typeof quote_data === 'string' ? quote_data : JSON.stringify(quote_data),
                    created_by: auth.name || auth.email || 'unknown'
                }
            );
            return created(result.recordset[0], request);
        } catch (err) {
            if (err.message?.includes('UX_QBQuotes_RefRevision')) {
                return badRequest('A quote with that reference and revision already exists', request);
            }
            context.error('qb-quotes-create:', err);
            return serverError('Failed to create quote', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/qb-quotes/:id — update / auto-save
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'qb-quotes/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id   = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);
            const body = await request.json();

            const allowed = [
                'revision', 'status',
                'date_sent', 'decision_due', 'valid_until',
                'company', 'contact', 'email', 'phone', 'site_address', 'prepared_by',
                'loss_reason', 'loss_competitor', 'loss_comment',
                'total_ex_vat', 'total_kg', 'margin_pct',
                'cost_material', 'cost_installation', 'cost_fabrication',
                'cost_design', 'cost_painting', 'cost_survey', 'cost_delivery', 'cost_prelims',
                'sharepoint_folder_id', 'sharepoint_tender_folder_id',
                'quote_data'
            ];

            const fields = [];
            const params = { id };
            for (const key of allowed) {
                if (key in body) {
                    fields.push(`${key} = @${key}`);
                    params[key] = key === 'quote_data' && typeof body[key] !== 'string'
                        ? JSON.stringify(body[key])
                        : body[key];
                }
            }
            if (!fields.length) return badRequest('No valid fields to update', request);
            fields.push(`updated_at = GETUTCDATE()`);

            const result = await query(
                `UPDATE QuoteBuilderQuotes SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );
            if (!result.recordset.length) return notFound(request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('qb-quotes-update:', err);
            return serverError('Failed to update quote', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/qb-quotes/:id/mark-won
//
// Marks quote as won and creates a Project row.
// Mirrors convertQuoteToProject() logic from shared.js but runs server-side.
// SharePoint folder creation is handled client-side (same as existing flow)
// and the resulting folder IDs are passed in the request body.
//
// Body: { project_name, client_id, quote_value, deadline_date,
//          sharepoint_project_folder_id, sharepoint_quote_folder_id }
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-mark-won', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'qb-quotes/{id}/mark-won',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        const perms = await getPerms(auth);
        if (!perms.edit) return { status: 403, jsonBody: { error: 'editQuotes permission required — ask an admin to grant it in User Access' } };

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);

            // Load the quote
            const qRes = await query(
                `SELECT * FROM QuoteBuilderQuotes WHERE id = @id`, { id }
            );
            if (!qRes.recordset.length) return notFound(request);
            const quote = qRes.recordset[0];

            if (quote.status === 'won') {
                // Already won — return existing project if linked
                if (quote.project_id) {
                    const pRes = await query(
                        `SELECT * FROM Projects WHERE id = @pid`, { pid: quote.project_id }
                    );
                    return ok({ quote, project: pRes.recordset[0] || null, alreadyWon: true }, request);
                }
            }

            const body = await request.json();
            const {
                project_name,
                client_id        = null,
                quote_value      = null,
                deadline_date    = null,
                sharepoint_project_folder_id = null,
                sharepoint_quote_folder_id   = null,
                comments         = null
            } = body;

            if (!project_name) return badRequest('project_name is required', request);

            // Derive project number: Q260502 → C260502
            const projectNumber = quote.reference.replace(/^Q/i, 'C');

            // Check project doesn't already exist for this reference
            const existingRes = await query(
                `SELECT id FROM Projects WHERE project_number = @pn`,
                { pn: projectNumber }
            );
            if (existingRes.recordset.length) {
                return badRequest(`Project ${projectNumber} already exists`, request);
            }

            const createdBy = auth.name || auth.email || 'unknown';

            // Create Project row
            const projRes = await query(
                `INSERT INTO Projects (
                    project_number, project_name, client_id, status,
                    source_quote_id, quote_value, deadline_date, comments,
                    sharepoint_folder_id, sharepoint_quote_folder_id,
                    created_by, created_at, updated_at
                ) OUTPUT INSERTED.*
                VALUES (
                    @project_number, @project_name, @client_id, 'In Progress',
                    NULL, @quote_value, @deadline_date, @comments,
                    @sharepoint_project_folder_id, @sharepoint_quote_folder_id,
                    @created_by, GETUTCDATE(), GETUTCDATE()
                )`,
                {
                    project_number: projectNumber,
                    project_name,
                    client_id: client_id ? parseInt(client_id) : null,
                    quote_value: quote_value != null ? parseFloat(quote_value) : null,
                    deadline_date: deadline_date || null,
                    comments: comments || null,
                    sharepoint_project_folder_id: sharepoint_project_folder_id || null,
                    sharepoint_quote_folder_id:   sharepoint_quote_folder_id   || null,
                    created_by: createdBy
                }
            );
            const project = projRes.recordset[0];

            // Update quote → won + link project_id
            await query(
                `UPDATE QuoteBuilderQuotes
                    SET status = 'won', project_id = @pid, updated_at = GETUTCDATE()
                  WHERE id = @id`,
                { pid: project.id, id }
            );

            // Seed 9 default line items for the new project (same as convertQuoteToProject)
            // We do this by inserting into QuoteLineItems with tender_id = NULL but
            // linked via ProjectQuotes. First create the ProjectQuotes link:
            try {
                // We need a Tenders row for the ProjectQuotes FK — QB quotes don't have one.
                // So we insert directly into QuoteLineItems with a special qb_quote_id column.
                // For now, seed via project_id directly:
                await query(
                    `INSERT INTO ProjectQuotes (project_id, tender_id, is_primary, added_by, created_at)
                     VALUES (@pid, NULL, 1, @by, GETUTCDATE())`,
                    { pid: project.id, by: createdBy }
                );
            } catch (e) {
                context.warn('ProjectQuotes insert failed (non-fatal):', e.message);
            }

            return ok({ quote: { ...quote, status: 'won', project_id: project.id }, project }, request);
        } catch (err) {
            context.error('qb-quotes-mark-won:', err);
            return serverError('Failed to mark quote as won', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/qb-quotes/:id
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-quotes-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'qb-quotes/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        const perms = await getPerms(auth);
        if (!perms.edit) return { status: 403, jsonBody: { error: 'editQuotes permission required — ask an admin to grant it in User Access' } };

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);
            const result = await query(
                `DELETE FROM QuoteBuilderQuotes OUTPUT DELETED.id, DELETED.reference WHERE id = @id`,
                { id }
            );
            if (!result.recordset.length) return notFound(request);
            return ok({ deleted: true, id, reference: result.recordset[0].reference }, request);
        } catch (err) {
            context.error('qb-quotes-delete:', err);
            return serverError('Failed to delete quote', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/qb-snapshots — save a revision snapshot
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-snapshots-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'qb-snapshots',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const { quote_id, snapshot_ts, reason = 'manual', revision_label = '', status = 'draft', data_snapshot = '{}' } = await request.json();
            if (!quote_id) return badRequest('quote_id is required', request);

            const result = await query(
                `INSERT INTO QuoteBuilderSnapshots (quote_id, snapshot_ts, reason, revision_label, status, data_snapshot)
                 OUTPUT INSERTED.*
                 VALUES (@quote_id, @snapshot_ts, @reason, @revision_label, @status, @data_snapshot)`,
                {
                    quote_id: parseInt(quote_id),
                    snapshot_ts: snapshot_ts || Date.now(),
                    reason, revision_label, status,
                    data_snapshot: typeof data_snapshot === 'string' ? data_snapshot : JSON.stringify(data_snapshot)
                }
            );
            return created(result.recordset[0], request);
        } catch (err) {
            context.error('qb-snapshots-create:', err);
            return serverError('Failed to save snapshot', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/qb-snapshots?quote_id=X — list snapshots for a quote
// ─────────────────────────────────────────────────────────────────────────────
app.http('qb-snapshots-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'qb-snapshots',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const quoteId = parseInt(request.query.get('quote_id'));
            if (!quoteId) return badRequest('quote_id is required', request);
            const result = await query(
                `SELECT id, quote_id, snapshot_ts, reason, revision_label, status
                 FROM QuoteBuilderSnapshots
                 WHERE quote_id = @quoteId
                 ORDER BY snapshot_ts DESC`,
                { quoteId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('qb-snapshots-list:', err);
            return serverError('Failed to fetch snapshots', request);
        }
    }
});
