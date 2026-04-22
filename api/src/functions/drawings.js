const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// POST /api/drawings — create a drawing job
app.http('drawings-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'drawings',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { project_number, job_name, finishing, transport, sharepoint_file_id } = body;

            if (!project_number || !job_name) {
                return badRequest('project_number and job_name are required', request);
            }

            const result = await query(
                `INSERT INTO DrawingJobs (project_number, job_name, finishing, transport, sharepoint_file_id)
                 OUTPUT INSERTED.*
                 VALUES (@projectNumber, @jobName, @finishing, @transport, @sharepointFileId)`,
                {
                    projectNumber: project_number,
                    jobName: job_name,
                    finishing: finishing || null,
                    transport: transport || null,
                    sharepointFileId: sharepoint_file_id || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating drawing:', err);
            return serverError('Failed to create drawing', request);
        }
    }
});

// GET /api/drawings — list drawings with filters
// ?project_number=P-1234&complete=false
app.http('drawings-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'drawings',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const projectNumber = url.searchParams.get('project_number');
            const complete = url.searchParams.get('complete');

            let sqlText = 'SELECT * FROM DrawingJobs WHERE 1=1';
            const params = {};

            if (projectNumber) {
                sqlText += ' AND project_number = @projectNumber';
                params.projectNumber = projectNumber;
            }

            if (complete !== null && complete !== undefined) {
                sqlText += ' AND is_complete = @isComplete';
                params.isComplete = complete === 'true' ? 1 : 0;
            }

            sqlText += ' ORDER BY created_at DESC';

            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching drawings:', err);
            return serverError('Failed to fetch drawings', request);
        }
    }
});

// GET /api/drawings/:id — get single drawing with elements and notes
app.http('drawings-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'drawings/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);

            const job = await query('SELECT * FROM DrawingJobs WHERE id = @id', { id });
            if (job.recordset.length === 0) return notFound('Drawing not found', request);

            const elements = await query(
                'SELECT * FROM DrawingElements WHERE job_id = @id ORDER BY element_name',
                { id }
            );

            const notes = await query(
                'SELECT * FROM DrawingNotes WHERE job_id = @id ORDER BY created_at DESC',
                { id }
            );

            return ok({
                ...job.recordset[0],
                elements: elements.recordset,
                notes: notes.recordset
            }, request);
        } catch (err) {
            context.error('Error fetching drawing:', err);
            return serverError('Failed to fetch drawing', request);
        }
    }
});

// PUT /api/drawings/:id — update drawing (mark complete, etc.)
app.http('drawings-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'drawings/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };

            if (body.job_name !== undefined) { fields.push('job_name = @jobName'); params.jobName = body.job_name; }
            if (body.finishing !== undefined) { fields.push('finishing = @finishing'); params.finishing = body.finishing; }
            if (body.transport !== undefined) { fields.push('transport = @transport'); params.transport = body.transport; }
            if (body.is_complete !== undefined) {
                fields.push('is_complete = @isComplete');
                params.isComplete = body.is_complete ? 1 : 0;
                if (body.is_complete) {
                    fields.push('completed_at = GETUTCDATE()');
                    if (body.completed_by) {
                        fields.push('completed_by = @completedBy');
                        params.completedBy = body.completed_by;
                    }
                }
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            const result = await query(
                `UPDATE DrawingJobs SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Drawing not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating drawing:', err);
            return serverError('Failed to update drawing', request);
        }
    }
});

// POST /api/drawings/:id/elements — add element to drawing
app.http('drawing-elements-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'drawings/{id}/elements',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const jobId = parseInt(request.params.id);
            const body = await request.json();
            const { element_name, quantity } = body;

            if (!element_name) return badRequest('element_name is required', request);

            const result = await query(
                `INSERT INTO DrawingElements (job_id, element_name, quantity)
                 OUTPUT INSERTED.*
                 VALUES (@jobId, @elementName, @quantity)`,
                {
                    jobId,
                    elementName: element_name,
                    quantity: parseInt(quantity || 1)
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating element:', err);
            return serverError('Failed to create element', request);
        }
    }
});

// PUT /api/drawing-elements/:id — update element (mark complete)
app.http('drawing-elements-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'drawing-elements/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };

            if (body.element_name !== undefined) { fields.push('element_name = @elementName'); params.elementName = body.element_name; }
            if (body.quantity !== undefined) { fields.push('quantity = @quantity'); params.quantity = parseInt(body.quantity); }
            if (body.is_complete !== undefined) {
                fields.push('is_complete = @isComplete');
                params.isComplete = body.is_complete ? 1 : 0;
                if (body.is_complete) {
                    fields.push('completed_at = GETUTCDATE()');
                    if (body.completed_by) {
                        fields.push('completed_by = @completedBy');
                        params.completedBy = body.completed_by;
                    }
                }
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            const result = await query(
                `UPDATE DrawingElements SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Element not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating element:', err);
            return serverError('Failed to update element', request);
        }
    }
});

// POST /api/drawings/:id/notes — add note to drawing
app.http('drawing-notes-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'drawings/{id}/notes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const jobId = parseInt(request.params.id);
            const body = await request.json();
            const { note_text, added_by } = body;

            if (!note_text || !added_by) {
                return badRequest('note_text and added_by are required', request);
            }

            const result = await query(
                `INSERT INTO DrawingNotes (job_id, note_text, added_by)
                 OUTPUT INSERTED.*
                 VALUES (@jobId, @noteText, @addedBy)`,
                {
                    jobId,
                    noteText: note_text,
                    addedBy: added_by
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating note:', err);
            return serverError('Failed to create note', request);
        }
    }
});
