const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// POST /api/holidays — submit holiday request
app.http('holidays-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'holidays',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, date_from, date_to, type, reason, working_days } = body;

            if (!employee_id || !date_from || !date_to || !working_days) {
                return badRequest('employee_id, date_from, date_to, and working_days are required', request);
            }

            // Check employee exists
            const emp = await query(
                'SELECT id, name, holiday_balance FROM Employees WHERE id = @id AND is_active = 1',
                { id: parseInt(employee_id) }
            );
            if (emp.recordset.length === 0) return notFound('Employee not found', request);

            // Check sufficient balance for paid holidays
            const holidayType = type || 'paid';
            if (holidayType === 'paid' && emp.recordset[0].holiday_balance < working_days) {
                return badRequest(`Insufficient holiday balance. Available: ${emp.recordset[0].holiday_balance}, Requested: ${working_days}`, request);
            }

            const result = await query(
                `INSERT INTO Holidays (employee_id, date_from, date_to, type, reason, working_days)
                 OUTPUT INSERTED.*
                 VALUES (@employeeId, @dateFrom, @dateTo, @type, @reason, @workingDays)`,
                {
                    employeeId: parseInt(employee_id),
                    dateFrom: date_from,
                    dateTo: date_to,
                    type: holidayType,
                    reason: reason || null,
                    workingDays: parseInt(working_days)
                }
            );

            return created({
                ...result.recordset[0],
                employee_name: emp.recordset[0].name
            }, request);
        } catch (err) {
            context.error('Error creating holiday:', err);
            return serverError('Failed to create holiday request');
        }
    }
});

// GET /api/holidays — list holidays with filters
// ?employee_id=1&status=pending&from=2026-04-01&to=2026-12-31
app.http('holidays-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'holidays',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const employeeId = url.searchParams.get('employee_id');
            const status = url.searchParams.get('status');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');

            let sqlText = `
                SELECT h.*, e.name as employee_name
                FROM Holidays h
                JOIN Employees e ON e.id = h.employee_id
                WHERE 1=1
            `;
            const params = {};

            if (employeeId) {
                sqlText += ' AND h.employee_id = @employeeId';
                params.employeeId = parseInt(employeeId);
            }

            if (status) {
                sqlText += ' AND h.status = @status';
                params.status = status;
            }

            if (from) {
                sqlText += ' AND h.date_to >= @from';
                params.from = from;
            }

            if (to) {
                sqlText += ' AND h.date_from <= @to';
                params.to = to;
            }

            sqlText += ' ORDER BY h.date_from DESC';

            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching holidays:', err);
            return serverError('Failed to fetch holidays', request);
        }
    }
});

// PUT /api/holidays/:id — approve/reject OR full edit (dates, type, status, reason)
app.http('holidays-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'holidays/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            // Get current holiday
            const current = await query(
                `SELECT h.*, e.holiday_balance, e.name as employee_name
                 FROM Holidays h
                 JOIN Employees e ON e.id = h.employee_id
                 WHERE h.id = @id`,
                { id }
            );

            if (current.recordset.length === 0) return notFound('Holiday not found', request);
            const holiday = current.recordset[0];

            // Determine if this is a simple approve/reject or a full edit
            const isSimpleStatusChange = body.status && !body.date_from && !body.date_to && !body.type && body.working_days === undefined;

            if (isSimpleStatusChange) {
                // Original approve/reject flow
                const { status } = body;
                if (!['approved', 'rejected'].includes(status)) {
                    return badRequest('status must be "approved" or "rejected"', request);
                }
                if (holiday.status !== 'pending') {
                    return badRequest(`Holiday already ${holiday.status}`, request);
                }

                const result = await query(
                    `UPDATE Holidays
                     SET status = @status, decided_at = GETUTCDATE()
                     OUTPUT INSERTED.*
                     WHERE id = @id`,
                    { id, status }
                );

                if (status === 'approved' && holiday.type === 'paid') {
                    await query(
                        `UPDATE Employees SET holiday_balance = holiday_balance - @days WHERE id = @employeeId`,
                        { days: holiday.working_days, employeeId: holiday.employee_id }
                    );
                }

                return ok({ ...result.recordset[0], employee_name: holiday.employee_name }, request);
            }

            // ── Full edit flow ──
            const newStatus = body.status || holiday.status;
            const newType = body.type || holiday.type;
            const newFrom = body.date_from || holiday.date_from;
            const newTo = body.date_to || holiday.date_to;
            const newDays = body.working_days !== undefined ? body.working_days : holiday.working_days;
            const newReason = body.reason !== undefined ? body.reason : holiday.reason;

            if (newStatus && !['pending', 'approved', 'rejected'].includes(newStatus)) {
                return badRequest('status must be "pending", "approved", or "rejected"', request);
            }

            // Reverse old balance impact (if was approved + paid, restore days)
            const oldWasApprovedPaid = holiday.status === 'approved' && holiday.type === 'paid';
            if (oldWasApprovedPaid) {
                await query(
                    `UPDATE Employees SET holiday_balance = holiday_balance + @days WHERE id = @employeeId`,
                    { days: holiday.working_days, employeeId: holiday.employee_id }
                );
            }

            // Update the holiday record
            const result = await query(
                `UPDATE Holidays
                 SET date_from = @dateFrom, date_to = @dateTo, type = @type,
                     status = @status, reason = @reason, working_days = @workingDays,
                     decided_at = CASE WHEN @status IN ('approved','rejected') THEN GETUTCDATE() ELSE decided_at END
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                { id, dateFrom: newFrom, dateTo: newTo, type: newType, status: newStatus, reason: newReason, workingDays: newDays }
            );

            // Apply new balance impact (if now approved + paid, deduct days)
            const newIsApprovedPaid = newStatus === 'approved' && newType === 'paid';
            if (newIsApprovedPaid) {
                await query(
                    `UPDATE Employees SET holiday_balance = holiday_balance - @days WHERE id = @employeeId`,
                    { days: newDays, employeeId: holiday.employee_id }
                );
            }

            return ok({ ...result.recordset[0], employee_name: holiday.employee_name }, request);
        } catch (err) {
            context.error('Error updating holiday:', err);
            return serverError('Failed to update holiday', request);
        }
    }
});

// DELETE /api/holidays/:id — cancel a holiday request
app.http('holidays-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'holidays/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);

            // Get holiday before deleting (to restore balance if needed)
            const current = await query('SELECT * FROM Holidays WHERE id = @id', { id });
            if (current.recordset.length === 0) return notFound('Holiday not found', request);

            const holiday = current.recordset[0];

            // If it was approved and paid, restore the balance
            if (holiday.status === 'approved' && holiday.type === 'paid') {
                await query(
                    `UPDATE Employees
                     SET holiday_balance = holiday_balance + @days
                     WHERE id = @employeeId`,
                    {
                        days: holiday.working_days,
                        employeeId: holiday.employee_id
                    }
                );
            }

            await query('DELETE FROM Holidays WHERE id = @id', { id });

            return ok({ deleted: true, restored_days: (holiday.status === 'approved' && holiday.type === 'paid') ? holiday.working_days : 0 });
        } catch (err) {
            context.error('Error deleting holiday:', err);
            return serverError('Failed to delete holiday', request);
        }
    }
});
