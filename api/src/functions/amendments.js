const { app } = require('@azure/functions');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// OPTIONS preflight
app.http('amendments-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'amendments/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/amendments — list amendments, optional ?status=pending&employee_id=1
app.http('amendments-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'amendments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const status     = url.searchParams.get('status');
            const employeeId = url.searchParams.get('employee_id');

            let sql = `
                SELECT a.*, e.name as employee_name
                FROM ClockingAmendments a
                JOIN Employees e ON e.id = a.employee_id
                WHERE 1=1
            `;
            const params = {};

            if (status)     { sql += ' AND a.status = @status';           params.status     = status; }
            if (employeeId) { sql += ' AND a.employee_id = @employeeId';   params.employeeId = parseInt(employeeId); }

            sql += ' ORDER BY a.submitted_at DESC';

            const result = await query(sql, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching amendments:', err);
            return serverError('Failed to fetch amendments', request);
        }
    }
});

// POST /api/amendments — employee submits an amendment request
app.http('amendments-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'amendments',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { clocking_id, employee_id, clocking_date,
                    original_in, original_out,
                    requested_in, requested_out, reason } = body;

            if (!clocking_id)   return badRequest('clocking_id is required', request);
            if (!employee_id)   return badRequest('employee_id is required', request);
            if (!clocking_date) return badRequest('clocking_date is required', request);
            if (!reason)        return badRequest('reason is required', request);
            if (!requested_in && !requested_out)
                return badRequest('At least one of requested_in or requested_out is required', request);

            // Remove any existing pending/rejected amendment for this clocking (allow re-submit)
            await query(
                `DELETE FROM ClockingAmendments
                 WHERE clocking_id = @clockingId AND employee_id = @employeeId
                   AND status IN ('pending', 'rejected')`,
                { clockingId: parseInt(clocking_id), employeeId: parseInt(employee_id) }
            );

            const result = await query(
                `INSERT INTO ClockingAmendments
                    (clocking_id, employee_id, clocking_date, original_in, original_out,
                     requested_in, requested_out, reason, status)
                 OUTPUT INSERTED.*
                 VALUES (@clockingId, @employeeId, @clockingDate, @originalIn, @originalOut,
                         @requestedIn, @requestedOut, @reason, 'pending')`,
                {
                    clockingId:   parseInt(clocking_id),
                    employeeId:   parseInt(employee_id),
                    clockingDate: clocking_date,
                    originalIn:   original_in  || null,
                    originalOut:  original_out || null,
                    requestedIn:  requested_in  || null,
                    requestedOut: requested_out || null,
                    reason
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating amendment:', err);
            return serverError('Failed to create amendment', request);
        }
    }
});

// PUT /api/amendments/:id — approve or reject
app.http('amendments-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'amendments/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id   = parseInt(request.params.id);
            const body = await request.json();
            const { status, resolved_by } = body;

            if (!status) return badRequest('status is required', request);
            if (!['approved', 'rejected'].includes(status))
                return badRequest('status must be approved or rejected', request);

            const result = await query(
                `UPDATE ClockingAmendments
                 SET status = @status, resolved_by = @resolvedBy, resolved_at = GETUTCDATE()
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                { id, status, resolvedBy: resolved_by || null }
            );

            if (result.recordset.length === 0) return notFound('Amendment not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating amendment:', err);
            return serverError('Failed to update amendment', request);
        }
    }
});
