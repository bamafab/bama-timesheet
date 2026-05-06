const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');
const { isBankHoliday } = require('../bank-holidays');

// Format a Date as YYYY-MM-DD in local time (matches how dates are stored
// and compared throughout the system).
function dateOnly(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Guard: reject clock-ins/clockings on UK bank holidays. The workshop is
// closed on bank holidays — see docs/SPEC-holiday-payroll.md.
function bankHolidayBlocked(date) {
    return isBankHoliday(dateOnly(date));
}

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

            const clockTime = timestamp ? new Date(timestamp) : new Date();

            if (bankHolidayBlocked(clockTime)) {
                return badRequest('The workshop is closed on bank holidays. If this is wrong, speak to the office.', request);
            }

            // Check employee exists and is active
            const emp = await query(
                'SELECT id, name FROM Employees WHERE id = @id AND is_active = 1',
                { id: parseInt(employee_id) }
            );
            if (emp.recordset.length === 0) return notFound('Employee not found or inactive', request);

            // Check if already clocked in (any open entry with no clock_out).
            // Don't filter by date: if a worker forgot to clock out yesterday,
            // letting them clock in today would leave two open shifts. The
            // worker has to close the existing one first.
            const open = await query(
                `SELECT id FROM ClockEntries
                 WHERE employee_id = @id
                   AND clock_out IS NULL`,
                { id: parseInt(employee_id) }
            );
            if (open.recordset.length > 0) {
                return badRequest('Employee is already clocked in', request);
            }

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
            const { employee_id, timestamp, break_mins } = body;

            if (!employee_id) return badRequest('employee_id is required', request);

            // Find the open clock entry for this employee. There can only be
            // one — POST /api/clock-in rejects a new clock-in while another
            // is open. We deliberately don't filter by date: an overnight
            // shift that started yesterday still needs to be closeable today.
            // If the worker forgot to clock out, the office can amend the
            // time afterward.
            const open = await query(
                `SELECT TOP 1 ce.id, ce.clock_in, e.name as employee_name
                 FROM ClockEntries ce
                 JOIN Employees e ON e.id = ce.employee_id
                 WHERE ce.employee_id = @id
                   AND ce.clock_out IS NULL
                 ORDER BY ce.clock_in DESC`,
                { id: parseInt(employee_id) }
            );

            if (open.recordset.length === 0) {
                return badRequest('Employee is not clocked in', request);
            }

            const clockTime = timestamp ? new Date(timestamp) : new Date();
            const breakMinsVal = (break_mins !== undefined && break_mins !== null)
                ? parseInt(break_mins) || 0
                : 30;  // default to 30 min standard break

            const result = await query(
                `UPDATE ClockEntries
                 SET clock_out = @clockOut, break_mins = @breakMins
                 OUTPUT INSERTED.*
                 WHERE id = @id`,
                {
                    clockOut: clockTime,
                    breakMins: breakMinsVal,
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
            const { clock_in, clock_out, amended_by, break_mins, is_approved, approved_by } = body;

            if (clock_in && bankHolidayBlocked(new Date(clock_in))) {
                return badRequest('Cannot move a clocking onto a bank holiday — the workshop is closed.', request);
            }
            if (clock_out && bankHolidayBlocked(new Date(clock_out))) {
                return badRequest('Cannot move a clocking onto a bank holiday — the workshop is closed.', request);
            }

            const fields = ['is_amended = 1'];
            const params = { id };

            if (clock_in) { fields.push('clock_in = @clockIn'); params.clockIn = new Date(clock_in); }
            if (clock_out) { fields.push('clock_out = @clockOut'); params.clockOut = new Date(clock_out); }
            if (amended_by) { fields.push('amended_by = @amendedBy'); params.amendedBy = amended_by; }
            if (break_mins !== undefined) { fields.push('break_mins = @breakMins'); params.breakMins = parseInt(break_mins) || 0; }

            // Approval flag — persists across reloads so an approved amendment
            // stays approved. If the caller is editing clock times without
            // explicitly approving, reset is_approved = 0 so the new edit
            // requires a fresh approval.
            if (is_approved !== undefined) {
                fields.push('is_approved = @isApproved');
                params.isApproved = is_approved ? 1 : 0;
                fields.push('approved_by = @approvedBy');
                params.approvedBy = is_approved ? (approved_by || amended_by || null) : null;
            } else if (clock_in || clock_out || break_mins !== undefined) {
                fields.push('is_approved = 0');
                fields.push('approved_by = NULL');
            }

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
            const { employee_id, clock_in, clock_out, amended_by, break_mins } = body;

            if (!employee_id || !clock_in) {
                return badRequest('employee_id and clock_in are required', request);
            }

            const clockInDate = new Date(clock_in);
            if (bankHolidayBlocked(clockInDate)) {
                return badRequest('Cannot add a clocking on a bank holiday — the workshop is closed.', request);
            }
            if (clock_out && bankHolidayBlocked(new Date(clock_out))) {
                return badRequest('Cannot add a clocking on a bank holiday — the workshop is closed.', request);
            }

            const params = {
                employeeId: parseInt(employee_id),
                clockIn: clockInDate,
                source: 'manual',
                isAmended: amended_by ? 1 : 0,
                amendedBy: amended_by || null,
                breakMins: parseInt(break_mins) || 0
            };

            let sqlText;
            if (clock_out) {
                params.clockOut = new Date(clock_out);
                sqlText = `INSERT INTO ClockEntries (employee_id, clock_in, clock_out, source, is_amended, amended_by, break_mins)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @clockIn, @clockOut, @source, @isAmended, @amendedBy, @breakMins)`;
            } else {
                sqlText = `INSERT INTO ClockEntries (employee_id, clock_in, source, is_amended, amended_by, break_mins)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @clockIn, @source, @isAmended, @amendedBy, @breakMins)`;
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
