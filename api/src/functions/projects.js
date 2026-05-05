const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// OPTIONS preflight
app.http('projects-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'projects/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/projects — list all projects with client + source quote info
app.http('projects-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'projects',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const status = request.query.get('status') || '';
            let sqlText = `SELECT p.*, c.company_name, c.contact_name, c.contact_email, c.contact_phone,
                                  t.reference AS source_quote_reference
                           FROM Projects p
                           LEFT JOIN Clients c ON c.id = p.client_id
                           LEFT JOIN Tenders t ON t.id = p.source_quote_id`;
            const params = {};

            if (status) {
                sqlText += ' WHERE p.status = @status';
                params.status = status;
            }

            sqlText += ' ORDER BY p.created_at DESC';
            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching projects:', err);
            return serverError('Failed to fetch projects', request);
        }
    }
});

// GET /api/projects/:id — single project with full details
app.http('projects-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'projects/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `SELECT p.*, c.company_name, c.address_line1, c.address_line2, c.city, c.county, c.postcode,
                        c.contact_name, c.contact_email, c.contact_phone,
                        t.reference AS source_quote_reference
                 FROM Projects p
                 LEFT JOIN Clients c ON c.id = p.client_id
                 LEFT JOIN Tenders t ON t.id = p.source_quote_id
                 WHERE p.id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Project not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error fetching project:', err);
            return serverError('Failed to fetch project', request);
        }
    }
});

// POST /api/projects — create new project (typically from a Won quote)
app.http('projects-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'projects',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const {
                project_number, project_name, client_id, source_quote_id,
                quote_value, deadline_date, comments,
                sharepoint_folder_id, sharepoint_quote_folder_id,
                project_manager_id, start_date, created_by, status
            } = body;

            if (!project_number) return badRequest('project_number is required', request);
            if (!project_name) return badRequest('project_name is required', request);

            const result = await query(
                `INSERT INTO Projects (
                    project_number, project_name, client_id, status, source_quote_id,
                    quote_value, deadline_date, comments,
                    sharepoint_folder_id, sharepoint_quote_folder_id,
                    project_manager_id, start_date, created_by
                 ) OUTPUT INSERTED.*
                 VALUES (
                    @project_number, @project_name, @client_id, @status, @source_quote_id,
                    @quote_value, @deadline_date, @comments,
                    @sharepoint_folder_id, @sharepoint_quote_folder_id,
                    @project_manager_id, @start_date, @created_by
                 )`,
                {
                    project_number,
                    project_name,
                    client_id: client_id ? parseInt(client_id) : null,
                    status: status || 'In Progress',
                    source_quote_id: source_quote_id ? parseInt(source_quote_id) : null,
                    quote_value: quote_value != null ? parseFloat(quote_value) : null,
                    deadline_date: deadline_date || null,
                    comments: comments || null,
                    sharepoint_folder_id: sharepoint_folder_id || null,
                    sharepoint_quote_folder_id: sharepoint_quote_folder_id || null,
                    project_manager_id: project_manager_id ? parseInt(project_manager_id) : null,
                    start_date: start_date || null,
                    created_by: created_by || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            if (err.message?.includes('UX_Projects_project_number')) {
                return badRequest('A project with that number already exists', request);
            }
            context.error('Error creating project:', err);
            return serverError('Failed to create project', request);
        }
    }
});

// PUT /api/projects/:id — update project fields
app.http('projects-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'projects/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            const fields = [];
            const params = { id };

            const allowed = ['project_name', 'client_id', 'status', 'quote_value',
                           'deadline_date', 'comments', 'sharepoint_folder_id',
                           'sharepoint_quote_folder_id', 'project_manager_id',
                           'start_date', 'completion_date',
                           // Site address + site contact (added with the 2026-05 migration)
                           'site_same_as_client',
                           'site_address_line1', 'site_address_line2',
                           'site_city', 'site_county', 'site_postcode',
                           'site_contact_name', 'site_contact_email', 'site_contact_phone'];

            for (const key of allowed) {
                if (body[key] !== undefined) {
                    fields.push(`${key} = @${key}`);
                    params[key] = body[key];
                }
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE Projects SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Project not found', request);

            // Re-fetch with joined data
            const full = await query(
                `SELECT p.*, c.company_name, c.contact_name, c.contact_email, c.contact_phone,
                        t.reference AS source_quote_reference
                 FROM Projects p
                 LEFT JOIN Clients c ON c.id = p.client_id
                 LEFT JOIN Tenders t ON t.id = p.source_quote_id
                 WHERE p.id = @id`,
                { id }
            );

            return ok(full.recordset[0], request);
        } catch (err) {
            context.error('Error updating project:', err);
            return serverError('Failed to update project', request);
        }
    }
});

// GET /api/projects/by-quote/:quoteId — find a project created from a given quote
app.http('projects-by-quote', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'projects-by-quote/{quoteId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const quoteId = parseInt(request.params.quoteId);
            const result = await query(
                `SELECT * FROM Projects WHERE source_quote_id = @quoteId`,
                { quoteId }
            );
            return ok(result.recordset[0] || null, request);
        } catch (err) {
            context.error('Error fetching project by quote:', err);
            return serverError('Failed to fetch project', request);
        }
    }
});

// OPTIONS preflight for projects-by-quote
app.http('projects-by-quote-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'projects-by-quote/{*path}',
    handler: async (request) => preflight(request)
});

// ───────────────────────────────────────────────────────────────────────────
// Project Contacts — additional people attached to a project (site foreman,
// surveyor, QS, etc.). Separate from the client's ClientContacts.
// Mirrors the client-contacts CRUD shape from clients.js.
// ───────────────────────────────────────────────────────────────────────────

// GET /api/project-contacts?project_id=X
app.http('project-contacts-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-contacts',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const projectId = parseInt(request.query.get('project_id'));
            if (!projectId) return badRequest('project_id is required', request);

            const result = await query(
                `SELECT * FROM ProjectContacts WHERE project_id = @projectId ORDER BY created_at DESC`,
                { projectId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching project contacts:', err);
            return serverError('Failed to fetch project contacts', request);
        }
    }
});

// POST /api/project-contacts — add a contact
app.http('project-contacts-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'project-contacts',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { project_id, contact_name, contact_email, contact_phone, role, notes } = body;
            if (!project_id) return badRequest('project_id is required', request);

            if (!contact_name && !contact_email && !contact_phone) {
                return badRequest('At least one of contact_name, contact_email, or contact_phone is required', request);
            }

            const result = await query(
                `INSERT INTO ProjectContacts (project_id, contact_name, contact_email, contact_phone, role, notes)
                 OUTPUT INSERTED.*
                 VALUES (@projectId, @name, @email, @phone, @role, @notes)`,
                {
                    projectId: parseInt(project_id),
                    name: contact_name || null,
                    email: contact_email || null,
                    phone: contact_phone || null,
                    role: role || null,
                    notes: notes || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating project contact:', err);
            return serverError('Failed to create project contact', request);
        }
    }
});

// PUT /api/project-contacts/:id
app.http('project-contacts-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'project-contacts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };
            const allowed = ['contact_name', 'contact_email', 'contact_phone', 'role', 'notes'];
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    fields.push(`${key} = @${key}`);
                    params[key] = body[key];
                }
            }
            if (fields.length === 0) return badRequest('No fields to update', request);

            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE ProjectContacts SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );
            if (result.recordset.length === 0) return notFound('Project contact not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating project contact:', err);
            return serverError('Failed to update project contact', request);
        }
    }
});

// DELETE /api/project-contacts/:id
app.http('project-contacts-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'project-contacts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `DELETE FROM ProjectContacts OUTPUT DELETED.* WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Project contact not found', request);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting project contact:', err);
            return serverError('Failed to delete project contact', request);
        }
    }
});

app.http('project-contacts-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'project-contacts/{*path}',
    handler: async (request) => preflight(request)
});

// ───────────────────────────────────────────────────────────────────────────
// Project Comments — threaded comments on a project. Mirrors TenderComments
// from tenders.js. No edit (intentional — comments are a log).
// ───────────────────────────────────────────────────────────────────────────

// GET /api/project-comments?project_id=X
app.http('project-comments-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-comments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const projectId = parseInt(request.query.get('project_id'));
            if (!projectId) return badRequest('project_id is required', request);

            const result = await query(
                `SELECT * FROM ProjectComments WHERE project_id = @projectId ORDER BY created_at ASC`,
                { projectId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching project comments:', err);
            return serverError('Failed to fetch project comments', request);
        }
    }
});

// POST /api/project-comments — add a comment
app.http('project-comments-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'project-comments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { project_id, comment, created_by } = body;
            if (!project_id) return badRequest('project_id is required', request);
            if (!comment || !comment.trim()) return badRequest('comment is required', request);

            const result = await query(
                `INSERT INTO ProjectComments (project_id, comment, created_by)
                 OUTPUT INSERTED.*
                 VALUES (@projectId, @comment, @createdBy)`,
                { projectId: parseInt(project_id), comment: comment.trim(), createdBy: created_by || null }
            );
            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating project comment:', err);
            return serverError('Failed to create project comment', request);
        }
    }
});

// DELETE /api/project-comments/:id
app.http('project-comments-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'project-comments/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `DELETE FROM ProjectComments OUTPUT DELETED.* WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Project comment not found', request);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting project comment:', err);
            return serverError('Failed to delete project comment', request);
        }
    }
});

app.http('project-comments-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'project-comments/{*path}',
    handler: async (request) => preflight(request)
});
