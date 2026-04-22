const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// POST /api/clock-in — record a clock-in
app.http('clock-in', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'clock-in',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, timestamp, source } = body;

            if (!employee_id) return badRequest('employee_id is required', request);

            // Check employee exists and is active
            const emp = await query(
                'SELECT id, name FROM Employees WHERE id = @id AND is_active = 1',
                { id: parseInt(employee_id) }
            );
            if (emp.recordset.length === 0) return notFound('Employee not found or inactive', request);

            // Check if already clocked in (has an open entry with no clock_out)
            const open = await query(
                'SELECT id FROM ClockEntries WHERE employee_id = @id AND clock_out IS NULL',
                { id: parseInt(employee_id) }
            );
            if (open.recordset.length > 0) {
                return badRequest('Employee is already clocked in', request);
            }

            const clockTime = timestamp ? new Date(timestamp) : new Date();

            const result = await query(
                `INSERT INTO ClockEntries (employee_id, clock_in, source)
                 OUTPUT INSERTED.*
                 VALUES (@employeeId, @clockIn, @source)`,
                {
                    employeeId: parseInt(employee_id),
                    clockIn: clockTime,
                    source: source || 'kiosk'
                }
            );

            return created({
                ...result.recordset[0],
                employee_name: emp.recordset[0].name
            }, request);
        } catch (err) {
            context.error('Error clocking in:', err);
            return serverError('Failed to clock in', request);
        }
    }
});

// POST /api/clock-out — record a clock-out
app.http('clock-out', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'clock-out',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, timestamp } = body;

            if (!employee_id) return badRequest('employee_id is required', request);

            // Find the open clock entry
            const open = await query(
                `SELECT ce.id, ce.clock_in, e.name as employee_name
                 FROM ClockEntries ce
                 JOIN Employees e ON e.id = ce.employee_id
                 WHERE ce.employee_id = @id AND ce.clock_out IS NULL`,
                { id: parseInt(employee_id) }
            );

            if (open.recordset.length === 0) {
                return badRequest('Employee is not clocked in', request);
            }

            const clockTime = timestamp ? new Date(timestamp) : new Date();

            const result = await query(
                `UPDATE ClockEntries
                 SET clock_out = @clockOut
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                {
                    clockOut: clockTime,
                    id: open.recordset[0].id
                }
            );

            return ok({
                ...result.recordset[0],
                employee_name: open.recordset[0].employee_name
            }, request);
        } catch (err) {
            context.error('Error clocking out:', err);
            return serverError('Failed to clock out', request);
        }
    }
});

// GET /api/clockings — get clock entries with filters
// ?employee_id=1&date=2026-04-21&week_commencing=2026-04-20&from=2026-04-01&to=2026-04-30
app.http('clockings-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'clockings',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const employeeId = url.searchParams.get('employee_id');
            const date = url.searchParams.get('date');
            const weekCommencing = url.searchParams.get('week_commencing');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');

            let sqlText = `
                SELECT ce.*, e.name as employee_name
                FROM ClockEntries ce
                JOIN Employees e ON e.id = ce.employee_id
                WHERE 1=1
            `;
            const params = {};

            if (employeeId) {
                sqlText += ' AND ce.employee_id = @employeeId';
                params.employeeId = parseInt(employeeId);
            }

            if (date) {
                sqlText += ' AND CAST(ce.clock_in AS DATE) = @date';
                params.date = date;
            }

            if (weekCommencing) {
                const weekStart = new Date(weekCommencing);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                sqlText += ' AND CAST(ce.clock_in AS DATE) >= @weekStart AND CAST(ce.clock_in AS DATE) <= @weekEnd';
                params.weekStart = weekStart.toISOString().split('T')[0];
                params.weekEnd = weekEnd.toISOString().split('T')[0];
            }

            if (from) {
                sqlText += ' AND CAST(ce.clock_in AS DATE) >= @from';
                params.from = from;
            }

            if (to) {
                sqlText += ' AND CAST(ce.clock_in AS DATE) <= @to';
                params.to = to;
            }

            sqlText += ' ORDER BY ce.clock_in DESC';

            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching clockings:', err);
            return serverError('Failed to fetch clockings', request);
        }
    }
});

// PUT /api/clockings/:id — amend a clock entry (manager)
app.http('clockings-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'clockings/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const { clock_in, clock_out, amended_by } = body;

            const fields = ['is_amended = 1'];
            const params = { id };

            if (clock_in) { fields.push('clock_in = @clockIn'); params.clockIn = new Date(clock_in); }
            if (clock_out) { fields.push('clock_out = @clockOut'); params.clockOut = new Date(clock_out); }
            if (amended_by) { fields.push('amended_by = @amendedBy'); params.amendedBy = amended_by; }

            const result = await query(
                `UPDATE ClockEntries SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Clock entry not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating clocking:', err);
            return serverError('Failed to update clocking', request);
        }
    }
});

// POST /api/clockings — add manual clock entry (manager)
app.http('clockings-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'clockings',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, clock_in, clock_out, amended_by } = body;

            if (!employee_id || !clock_in) {
                return badRequest('employee_id and clock_in are required', request);
            }

            const params = {
                employeeId: parseInt(employee_id),
                clockIn: new Date(clock_in),
                source: 'manual',
                isAmended: amended_by ? 1 : 0,
                amendedBy: amended_by || null
            };

            let sqlText;
            if (clock_out) {
                params.clockOut = new Date(clock_out);
                sqlText = `INSERT INTO ClockEntries (employee_id, clock_in, clock_out, source, is_amended, amended_by)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @clockIn, @clockOut, @source, @isAmended, @amendedBy)`;
            } else {
                sqlText = `INSERT INTO ClockEntries (employee_id, clock_in, source, is_amended, amended_by)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @clockIn, @source, @isAmended, @amendedBy)`;
            }

            const result = await query(sqlText, params);
            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating clocking:', err);
            return serverError('Failed to create clocking', request);
        }
    }
});

// DELETE /api/clockings/:id — delete a clock entry (manager)
app.http('clockings-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'clockings/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                'DELETE FROM ClockEntries OUTPUT DELETED.* WHERE id = @id',
                { id }
            );

            if (result.recordset.length === 0) return notFound('Clock entry not found', request);
            return ok({ deleted: true, entry: result.recordset[0] }, request);
        } catch (err) {
            context.error('Error deleting clocking:', err);
            return serverError('Failed to delete clocking', request);
        }
    }
});
