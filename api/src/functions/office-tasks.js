// Office Tasks API
//
// Replaces the SharePoint JSON office-tasks.json approach with SQL storage.
// Messages remain in SharePoint JSON (separate concern, not migrated here).
//
// Routes:
//   GET    /api/office-tasks           list (filter by ?assignedTo= &status= &source=)
//   POST   /api/office-tasks           create
//   PUT    /api/office-tasks/:id       update (status, priority, due_date, title, description)
//   DELETE /api/office-tasks/:id       delete
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

app.http('office-tasks-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'office-tasks/{*path}',
    handler: async (request) => preflight(request)
});

// ── GET /api/office-tasks ─────────────────────────────────────────────────────
app.http('office-tasks-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'office-tasks',
    handler: async (request) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const assignedTo = request.query.get('assignedTo') || '';
            const statusFilter = request.query.get('status') || '';
            const sourceFilter = request.query.get('source') || '';

            let sql = `SELECT * FROM OfficeTasks WHERE 1=1`;
            const params = {};

            if (assignedTo) {
                sql += ` AND assigned_to = @assignedTo`;
                params.assignedTo = assignedTo;
            }
            if (statusFilter) {
                sql += ` AND status = @status`;
                params.status = statusFilter;
            }
            if (sourceFilter) {
                sql += ` AND source = @source`;
                params.source = sourceFilter;
            }

            // Exclude dismissed tasks by default unless explicitly requested
            if (!statusFilter) {
                sql += ` AND status != 'dismissed'`;
            }

            sql += ` ORDER BY created_at DESC`;

            const rows = await query(sql, params);
            return ok({ tasks: rows.recordset });
        } catch (e) {
            return serverError(e);
        }
    }
});

// ── POST /api/office-tasks ────────────────────────────────────────────────────
app.http('office-tasks-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'office-tasks',
    handler: async (request) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { title, description, assigned_to, assigned_by, due_date,
                    priority, source, source_ref } = body;

            if (!title || !String(title).trim()) {
                return badRequest('title is required');
            }

            const result = await query(
                `INSERT INTO OfficeTasks
                    (title, description, assigned_to, assigned_by, due_date,
                     priority, status, source, source_ref)
                 OUTPUT INSERTED.*
                 VALUES (@title, @description, @assigned_to, @assigned_by, @due_date,
                         @priority, 'open', @source, @source_ref)`,
                {
                    title: String(title).slice(0, 200),
                    description: description || null,
                    assigned_to: assigned_to || null,
                    assigned_by: assigned_by || null,
                    due_date: due_date || null,
                    priority: priority || 'normal',
                    source: source || 'manual',
                    source_ref: source_ref || null
                }
            );

            return created(result.recordset[0]);
        } catch (e) {
            return serverError(e);
        }
    }
});

// ── PUT /api/office-tasks/:id ─────────────────────────────────────────────────
app.http('office-tasks-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'office-tasks/:id',
    handler: async (request) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id, 10);
            if (!id) return badRequest('invalid id');

            const body = await request.json();
            const allowed = ['title', 'description', 'assigned_to', 'assigned_by',
                             'due_date', 'priority', 'status', 'source_ref'];

            const setClauses = [];
            const params = { id };

            for (const field of allowed) {
                if (Object.prototype.hasOwnProperty.call(body, field)) {
                    setClauses.push(`${field} = @${field}`);
                    params[field] = body[field] === '' ? null : body[field];
                }
            }

            if (!setClauses.length) return badRequest('no valid fields to update');

            // If marking complete, stamp completed_at; if re-opening, clear it
            if (body.status === 'complete') {
                setClauses.push(`completed_at = GETUTCDATE()`);
            } else if (body.status === 'open') {
                setClauses.push(`completed_at = NULL`);
            }

            setClauses.push(`updated_at = GETUTCDATE()`);

            const result = await query(
                `UPDATE OfficeTasks SET ${setClauses.join(', ')}
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                params
            );

            if (!result.recordset.length) return notFound('task not found');
            return ok(result.recordset[0]);
        } catch (e) {
            return serverError(e);
        }
    }
});

// ── DELETE /api/office-tasks/:id ─────────────────────────────────────────────
app.http('office-tasks-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'office-tasks/:id',
    handler: async (request) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id, 10);
            if (!id) return badRequest('invalid id');

            const result = await query(
                `DELETE FROM OfficeTasks OUTPUT DELETED.id WHERE id = @id`,
                { id }
            );

            if (!result.recordset.length) return notFound('task not found');
            return ok({ deleted: result.recordset[0].id });
        } catch (e) {
            return serverError(e);
        }
    }
});
