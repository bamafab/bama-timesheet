const { app } = require('@azure/functions');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// Preflight for both subroutes
app.http('payroll-extras-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'payroll-comments/{*path}',
    handler: async (request) => preflight(request)
});
app.http('payroll-revisions-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'payroll-revisions/{*path}',
    handler: async (request) => preflight(request)
});

// ── PAYROLL COMMENTS ──────────────────────────────────────────────────────

// GET /api/payroll-comments?week_commencing=YYYY-MM-DD
app.http('payroll-comments-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'payroll-comments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const weekCommencing = url.searchParams.get('week_commencing');
            if (!weekCommencing) return badRequest('week_commencing is required', request);

            const result = await query(
                `SELECT * FROM PayrollComments
                 WHERE week_commencing = @weekCommencing
                 ORDER BY created_at ASC`,
                { weekCommencing }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching payroll comments:', err);
            return serverError('Failed to fetch payroll comments', request);
        }
    }
});

// POST /api/payroll-comments
app.http('payroll-comments-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'payroll-comments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { week_commencing, comment, created_by } = body;
            if (!week_commencing) return badRequest('week_commencing is required', request);
            if (!comment || !comment.trim()) return badRequest('comment is required', request);
            if (!created_by) return badRequest('created_by is required', request);

            const result = await query(
                `INSERT INTO PayrollComments (week_commencing, comment, created_by)
                 OUTPUT INSERTED.*
                 VALUES (@weekCommencing, @comment, @createdBy)`,
                { weekCommencing: week_commencing, comment: comment.trim(), createdBy: created_by }
            );
            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating payroll comment:', err);
            return serverError('Failed to create payroll comment', request);
        }
    }
});

// PUT /api/payroll-comments/:id
app.http('payroll-comments-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'payroll-comments/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const { comment, updated_by } = body;
            if (!comment || !comment.trim()) return badRequest('comment is required', request);
            if (!updated_by) return badRequest('updated_by is required', request);

            const result = await query(
                `UPDATE PayrollComments
                 SET comment = @comment, updated_by = @updatedBy, updated_at = GETUTCDATE()
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                { id, comment: comment.trim(), updatedBy: updated_by }
            );
            if (result.recordset.length === 0) return notFound('Comment not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating payroll comment:', err);
            return serverError('Failed to update payroll comment', request);
        }
    }
});

// DELETE /api/payroll-comments/:id
app.http('payroll-comments-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'payroll-comments/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `DELETE FROM PayrollComments OUTPUT DELETED.* WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Comment not found', request);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting payroll comment:', err);
            return serverError('Failed to delete payroll comment', request);
        }
    }
});

// ── PAYROLL REVISIONS ─────────────────────────────────────────────────────

// GET /api/payroll-revisions?week_commencing=YYYY-MM-DD
app.http('payroll-revisions-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'payroll-revisions',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const weekCommencing = url.searchParams.get('week_commencing');
            if (!weekCommencing) return badRequest('week_commencing is required', request);

            const result = await query(
                `SELECT * FROM PayrollRevisions
                 WHERE week_commencing = @weekCommencing
                 ORDER BY revision_number ASC`,
                { weekCommencing }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching payroll revisions:', err);
            return serverError('Failed to fetch payroll revisions', request);
        }
    }
});

// POST /api/payroll-revisions
app.http('payroll-revisions-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'payroll-revisions',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { week_commencing, revision_number, file_name, file_url, created_by } = body;
            if (!week_commencing) return badRequest('week_commencing is required', request);
            if (revision_number === undefined || revision_number === null)
                return badRequest('revision_number is required', request);
            if (!file_name) return badRequest('file_name is required', request);
            if (!created_by) return badRequest('created_by is required', request);

            const result = await query(
                `INSERT INTO PayrollRevisions (week_commencing, revision_number, file_name, file_url, created_by)
                 OUTPUT INSERTED.*
                 VALUES (@weekCommencing, @revisionNumber, @fileName, @fileUrl, @createdBy)`,
                {
                    weekCommencing: week_commencing,
                    revisionNumber: parseInt(revision_number),
                    fileName: file_name,
                    fileUrl: file_url || null,
                    createdBy: created_by
                }
            );
            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating payroll revision:', err);
            return serverError('Failed to create payroll revision', request);
        }
    }
});
