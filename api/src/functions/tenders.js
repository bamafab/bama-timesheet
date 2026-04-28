const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// OPTIONS preflight
app.http('tenders-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'tenders/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/tenders — list all tenders, optional status filter
app.http('tenders-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tenders',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const status = request.query.get('status') || '';
            let sqlText = `SELECT t.*, c.company_name, c.contact_name, c.contact_email, c.contact_phone
                           FROM Tenders t
                           JOIN Clients c ON c.id = t.client_id`;
            const params = {};

            if (status) {
                sqlText += ' WHERE t.status = @status';
                params.status = status;
            }

            sqlText += ' ORDER BY t.created_at DESC';
            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching tenders:', err);
            return serverError('Failed to fetch tenders', request);
        }
    }
});

// GET /api/tenders/:id
app.http('tenders-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tenders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `SELECT t.*, c.company_name, c.address_line1, c.address_line2, c.city, c.county, c.postcode,
                        c.contact_name, c.contact_email, c.contact_phone
                 FROM Tenders t
                 JOIN Clients c ON c.id = t.client_id
                 WHERE t.id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Tender not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error fetching tender:', err);
            return serverError('Failed to fetch tender', request);
        }
    }
});

// GET /api/tender-next-ref — get next available reference
app.http('tenders-next-ref', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tender-next-ref',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const now = new Date();
            const year = request.query.get('year') || String(now.getFullYear()).slice(-2);
            const month = request.query.get('month') || String(now.getMonth() + 1).padStart(2, '0');
            const prefix = `Q${year}${month}`;

            const result = await query(
                `SELECT COUNT(*) as cnt FROM Tenders WHERE reference LIKE @prefix + '%'`,
                { prefix }
            );

            const count = (result.recordset[0]?.cnt || 0) + 1;
            const reference = `${prefix}${String(count).padStart(2, '0')}`;

            return ok({ reference, prefix, count }, request);
        } catch (err) {
            context.error('Error generating reference:', err);
            return serverError('Failed to generate reference', request);
        }
    }
});

// POST /api/tenders — create new tender
app.http('tenders-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'tenders',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { reference, client_id, project_name, comments,
                    sharepoint_folder_id, sharepoint_tender_folder_id, created_by,
                    contact_name, contact_email, contact_phone } = body;

            if (!reference) return badRequest('reference is required', request);
            if (!client_id) return badRequest('client_id is required', request);
            if (!project_name) return badRequest('project_name is required', request);

            const result = await query(
                `INSERT INTO Tenders (reference, client_id, project_name, comments, status,
                    sharepoint_folder_id, sharepoint_tender_folder_id, created_by,
                    contact_name, contact_email, contact_phone)
                 OUTPUT INSERTED.*
                 VALUES (@reference, @client_id, @project_name, @comments, 'tender',
                    @sharepoint_folder_id, @sharepoint_tender_folder_id, @created_by,
                    @contact_name, @contact_email, @contact_phone)`,
                {
                    reference,
                    client_id: parseInt(client_id),
                    project_name,
                    comments: comments || null,
                    sharepoint_folder_id: sharepoint_folder_id || null,
                    sharepoint_tender_folder_id: sharepoint_tender_folder_id || null,
                    created_by: created_by || null,
                    contact_name: contact_name || null,
                    contact_email: contact_email || null,
                    contact_phone: contact_phone || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            if (err.message?.includes('UX_Tenders_reference')) {
                return badRequest('A tender with that reference already exists', request);
            }
            context.error('Error creating tender:', err);
            return serverError('Failed to create tender', request);
        }
    }
});

// PUT /api/tenders/:id — update tender fields or change status
app.http('tenders-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'tenders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            const fields = [];
            const params = { id };

            const allowed = ['project_name', 'comments', 'status', 'quote_handler_id',
                           'sharepoint_folder_id', 'sharepoint_tender_folder_id',
                           'converted_by', 'contact_name', 'contact_email', 'contact_phone'];

            for (const key of allowed) {
                if (body[key] !== undefined) {
                    fields.push(`${key} = @${key}`);
                    params[key] = body[key];
                }
            }

            // If converting to quote, set converted_at
            if (body.status === 'quote') {
                fields.push('converted_at = GETUTCDATE()');
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE Tenders SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Tender not found', request);

            // Re-fetch with client data
            const full = await query(
                `SELECT t.*, c.company_name, c.contact_name, c.contact_email, c.contact_phone
                 FROM Tenders t JOIN Clients c ON c.id = t.client_id WHERE t.id = @id`,
                { id }
            );

            return ok(full.recordset[0], request);
        } catch (err) {
            context.error('Error updating tender:', err);
            return serverError('Failed to update tender', request);
        }
    }
});

// GET /api/tender-comments?tender_id=X — list comments for a tender
app.http('tender-comments-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tender-comments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const tenderId = parseInt(request.query.get('tender_id'));
            if (!tenderId) return badRequest('tender_id is required', request);

            const result = await query(
                `SELECT * FROM TenderComments WHERE tender_id = @tenderId ORDER BY created_at ASC`,
                { tenderId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching comments:', err);
            return serverError('Failed to fetch comments', request);
        }
    }
});

// POST /api/tender-comments — add a comment
app.http('tender-comments-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'tender-comments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { tender_id, comment, created_by } = body;
            if (!tender_id) return badRequest('tender_id is required', request);
            if (!comment || !comment.trim()) return badRequest('comment is required', request);

            const result = await query(
                `INSERT INTO TenderComments (tender_id, comment, created_by)
                 OUTPUT INSERTED.*
                 VALUES (@tenderId, @comment, @createdBy)`,
                { tenderId: parseInt(tender_id), comment: comment.trim(), createdBy: created_by || null }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating comment:', err);
            return serverError('Failed to create comment', request);
        }
    }
});

// DELETE /api/tender-comments/:id — delete a comment
app.http('tender-comments-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'tender-comments/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `DELETE FROM TenderComments OUTPUT DELETED.* WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Comment not found', request);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting comment:', err);
            return serverError('Failed to delete comment', request);
        }
    }
});

// OPTIONS preflight for tender-comments
app.http('tender-comments-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'tender-comments/{*path}',
    handler: async (request) => preflight(request)
});
