const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// GET /api/employees — list all active employees
// GET /api/employees?all=true — include inactive
// GET /api/employees/:id — get single employee
app.http('employees-list', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'employees/{id?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth._preflight) return preflight(request);
        if (auth.status) return auth; // 401 response

        try {
            const id = request.params.id;

            if (id) {
                const result = await query(
                    'SELECT * FROM Employees WHERE id = @id',
                    { id: parseInt(id) }
                );
                if (result.recordset.length === 0) return notFound('Employee not found', request);
                return ok(result.recordset[0], request);
            }

            const showAll = new URL(request.url).searchParams.get('all') === 'true';
            const sqlText = showAll
                ? 'SELECT * FROM Employees ORDER BY name'
                : 'SELECT * FROM Employees WHERE is_active = 1 ORDER BY name';

            const result = await query(sqlText);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching employees:', err);
            return serverError('Failed to fetch employees', request);
        }
    }
});

// POST /api/employees — create new employee
app.http('employees-create', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'employees',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth._preflight) return preflight(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { name, pin, rate, staff_type, erp_role, holiday_entitlement } = body;

            if (!name || !pin || rate === undefined) {
                return badRequest('name, pin, and rate are required', request);
            }

            const result = await query(
                `INSERT INTO Employees (name, pin, rate, staff_type, erp_role, holiday_balance, holiday_entitlement)
                 OUTPUT INSERTED.*
                 VALUES (@name, @pin, @rate, @staffType, @erpRole, @holidayEntitlement, @holidayEntitlement)`,
                {
                    name,
                    pin,
                    rate: parseFloat(rate),
                    staffType: staff_type || 'workshop',
                    erpRole: erp_role || 'employee',
                    holidayEntitlement: parseFloat(holiday_entitlement || 28)
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating employee:', err);
            return serverError('Failed to create employee', request);
        }
    }
});

// PUT /api/employees/:id — update employee
app.http('employees-update', {
    methods: ['PUT', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'employees/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth._preflight) return preflight(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            // Build dynamic update
            const fields = [];
            const params = { id };

            if (body.name !== undefined) { fields.push('name = @name'); params.name = body.name; }
            if (body.pin !== undefined) { fields.push('pin = @pin'); params.pin = body.pin; }
            if (body.rate !== undefined) { fields.push('rate = @rate'); params.rate = parseFloat(body.rate); }
            if (body.staff_type !== undefined) { fields.push('staff_type = @staffType'); params.staffType = body.staff_type; }
            if (body.erp_role !== undefined) { fields.push('erp_role = @erpRole'); params.erpRole = body.erp_role; }
            if (body.holiday_balance !== undefined) { fields.push('holiday_balance = @holidayBalance'); params.holidayBalance = parseFloat(body.holiday_balance); }
            if (body.holiday_entitlement !== undefined) { fields.push('holiday_entitlement = @holidayEntitlement'); params.holidayEntitlement = parseFloat(body.holiday_entitlement); }
            if (body.is_active !== undefined) { fields.push('is_active = @isActive'); params.isActive = body.is_active ? 1 : 0; }

            if (fields.length === 0) return badRequest('No fields to update', request);

            const result = await query(
                `UPDATE Employees SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Employee not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating employee:', err);
            return serverError('Failed to update employee', request);
        }
    }
});
