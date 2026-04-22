const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// GET /api/user-access — get all permissions for all employees
// GET /api/user-access/:employee_id — get permissions for one employee
app.http('user-access-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'user-access/{employee_id?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const employeeId = request.params.employee_id;

            if (employeeId) {
                const result = await query(
                    'SELECT * FROM UserPermissions WHERE employee_id = @employeeId',
                    { employeeId: parseInt(employeeId) }
                );
                if (result.recordset.length === 0) {
                    // Return default (all false) permissions
                    return ok({
                        employee_id: parseInt(employeeId),
                        by_project: false, by_employee: false, clocking_in_out: false,
                        payroll: false, archive: false, staff: false, holidays: false,
                        reports: false, settings: false, user_access: false, draftsman_mode: false
                    }, request);
                }
                return ok(result.recordset[0], request);
            }

            const result = await query('SELECT up.*, e.name AS employee_name FROM UserPermissions up JOIN Employees e ON up.employee_id = e.id ORDER BY e.name');
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching user access:', err);
            return serverError('Failed to fetch user access', request);
        }
    }
});

// PUT /api/user-access/:employee_id — upsert permissions for an employee
// Body: { "by_project": true, "payroll": false, ... }
app.http('user-access-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'user-access/{employee_id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const employeeId = parseInt(request.params.employee_id);
            const body = await request.json();

            // Check employee exists
            const empCheck = await query('SELECT id FROM Employees WHERE id = @id', { id: employeeId });
            if (empCheck.recordset.length === 0) return notFound('Employee not found', request);

            // Build upsert — merge existing with incoming
            const permCols = [
                'by_project', 'by_employee', 'clocking_in_out', 'payroll',
                'archive', 'staff', 'holidays', 'reports', 'settings',
                'user_access', 'draftsman_mode'
            ];

            // Map camelCase from frontend to snake_case
            const keyMap = {
                byProject: 'by_project', byEmployee: 'by_employee', clockingInOut: 'clocking_in_out',
                payroll: 'payroll', archive: 'archive', staff: 'staff', holidays: 'holidays',
                reports: 'reports', settings: 'settings', userAccess: 'user_access', draftsmanMode: 'draftsman_mode'
            };

            // Check if row exists
            const existing = await query(
                'SELECT * FROM UserPermissions WHERE employee_id = @employeeId',
                { employeeId }
            );

            if (existing.recordset.length === 0) {
                // INSERT
                const vals = {};
                vals.employeeId = employeeId;
                permCols.forEach(col => {
                    // Check both snake_case and camelCase keys
                    const camelKey = Object.entries(keyMap).find(([, v]) => v === col)?.[0];
                    vals[col] = body[col] !== undefined ? (body[col] ? 1 : 0) : (body[camelKey] !== undefined ? (body[camelKey] ? 1 : 0) : 0);
                });

                const colList = permCols.join(', ');
                const paramList = permCols.map(c => `@${c}`).join(', ');

                const insertQ = `INSERT INTO UserPermissions (employee_id, ${colList}) OUTPUT INSERTED.* VALUES (@employeeId, ${paramList})`;
                const params = { employeeId };
                permCols.forEach(col => { params[col] = vals[col]; });

                const result = await query(insertQ, params);
                return ok(result.recordset[0], request);
            } else {
                // UPDATE — only update fields present in body
                const updates = [];
                const params = { employeeId };

                for (const [key, value] of Object.entries(body)) {
                    const snakeKey = keyMap[key] || key;
                    if (permCols.includes(snakeKey)) {
                        updates.push(`${snakeKey} = @${snakeKey}`);
                        params[snakeKey] = value ? 1 : 0;
                    }
                }

                if (updates.length === 0) return badRequest('No valid permission fields', request);

                updates.push('updated_at = GETUTCDATE()');
                const result = await query(
                    `UPDATE UserPermissions SET ${updates.join(', ')} OUTPUT INSERTED.* WHERE employee_id = @employeeId`,
                    params
                );
                return ok(result.recordset[0], request);
            }
        } catch (err) {
            context.error('Error updating user access:', err);
            return serverError('Failed to update user access', request);
        }
    }
});

// GET /api/access-requests — list all pending access requests
app.http('access-requests-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'access-requests',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const result = await query(
                'SELECT * FROM AccessRequests WHERE status = @status ORDER BY created_at DESC',
                { status: 'pending' }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching access requests:', err);
            return serverError('Failed to fetch access requests', request);
        }
    }
});

// POST /api/access-requests — submit a new access request
app.http('access-requests-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'access-requests',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_name, reason } = body;

            if (!employee_name || !reason) {
                return badRequest('employee_name and reason are required', request);
            }

            const result = await query(
                `INSERT INTO AccessRequests (employee_name, reason, status)
                 OUTPUT INSERTED.*
                 VALUES (@employeeName, @reason, 'pending')`,
                { employeeName: employee_name, reason }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating access request:', err);
            return serverError('Failed to create access request', request);
        }
    }
});

// PUT /api/access-requests/:id — dismiss/approve/reject a request
app.http('access-requests-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'access-requests/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const { status } = body;

            if (!status || !['dismissed', 'approved', 'rejected'].includes(status)) {
                return badRequest('status must be dismissed, approved, or rejected', request);
            }

            const result = await query(
                `UPDATE AccessRequests SET status = @status, updated_at = GETUTCDATE()
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                { id, status }
            );

            if (result.recordset.length === 0) return notFound('Access request not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating access request:', err);
            return serverError('Failed to update access request', request);
        }
    }
});

// DELETE /api/access-requests/:id — hard delete
app.http('access-requests-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'access-requests/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                'DELETE FROM AccessRequests OUTPUT DELETED.* WHERE id = @id',
                { id }
            );
            if (result.recordset.length === 0) return notFound('Access request not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('Error deleting access request:', err);
            return serverError('Failed to delete access request', request);
        }
    }
});
