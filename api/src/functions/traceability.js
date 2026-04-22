const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError } = require('../responses');

// ═══════════════════════════════════════════
// WELDING MACHINES
// ═══════════════════════════════════════════

// GET /api/welding-machines — list all (with authorised welders)
app.http('welding-machines-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'welding-machines/{id?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = request.params.id;

            if (id) {
                const machine = await query('SELECT * FROM WeldingMachines WHERE id = @id', { id: parseInt(id) });
                if (machine.recordset.length === 0) return notFound('Machine not found', request);

                const welders = await query(
                    `SELECT wmw.id AS link_id, wmw.employee_id, e.name AS employee_name
                     FROM WeldingMachineWelders wmw
                     JOIN Employees e ON wmw.employee_id = e.id
                     WHERE wmw.machine_id = @machineId
                     ORDER BY e.name`,
                    { machineId: parseInt(id) }
                );

                return ok({ ...machine.recordset[0], welders: welders.recordset }, request);
            }

            const machines = await query('SELECT * FROM WeldingMachines WHERE is_active = 1 ORDER BY machine_name');
            // Fetch all welder assignments in one query
            const allWelders = await query(
                `SELECT wmw.machine_id, wmw.employee_id, e.name AS employee_name
                 FROM WeldingMachineWelders wmw
                 JOIN Employees e ON wmw.employee_id = e.id
                 ORDER BY e.name`
            );

            const welderMap = {};
            allWelders.recordset.forEach(w => {
                if (!welderMap[w.machine_id]) welderMap[w.machine_id] = [];
                welderMap[w.machine_id].push(w);
            });

            const result = machines.recordset.map(m => ({
                ...m,
                welders: welderMap[m.id] || []
            }));

            return ok(result, request);
        } catch (err) {
            context.error('Error fetching welding machines:', err);
            return serverError('Failed to fetch welding machines', request);
        }
    }
});

// POST /api/welding-machines — create a new machine
app.http('welding-machines-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'welding-machines',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { machine_name, serial_number, expiry_date, notes, welder_ids } = body;

            if (!machine_name) return badRequest('machine_name is required', request);

            const result = await query(
                `INSERT INTO WeldingMachines (machine_name, serial_number, expiry_date, notes)
                 OUTPUT INSERTED.*
                 VALUES (@machineName, @serialNumber, @expiryDate, @notes)`,
                {
                    machineName: machine_name,
                    serialNumber: serial_number || null,
                    expiryDate: expiry_date || null,
                    notes: notes || null
                }
            );

            const machine = result.recordset[0];

            // Add authorised welders
            if (Array.isArray(welder_ids) && welder_ids.length > 0) {
                for (const empId of welder_ids) {
                    await query(
                        'INSERT INTO WeldingMachineWelders (machine_id, employee_id) VALUES (@machineId, @empId)',
                        { machineId: machine.id, empId: parseInt(empId) }
                    );
                }
            }

            return created(machine, request);
        } catch (err) {
            context.error('Error creating welding machine:', err);
            return serverError('Failed to create welding machine', request);
        }
    }
});

// PUT /api/welding-machines/:id — update machine details + welders
app.http('welding-machines-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'welding-machines/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            const fields = [];
            const params = { id };

            if (body.machine_name !== undefined) { fields.push('machine_name = @machineName'); params.machineName = body.machine_name; }
            if (body.serial_number !== undefined) { fields.push('serial_number = @serialNumber'); params.serialNumber = body.serial_number; }
            if (body.expiry_date !== undefined) { fields.push('expiry_date = @expiryDate'); params.expiryDate = body.expiry_date || null; }
            if (body.notes !== undefined) { fields.push('notes = @notes'); params.notes = body.notes; }
            if (body.is_active !== undefined) { fields.push('is_active = @isActive'); params.isActive = body.is_active ? 1 : 0; }

            if (fields.length > 0) {
                fields.push('updated_at = GETUTCDATE()');
                const result = await query(
                    `UPDATE WeldingMachines SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                    params
                );
                if (result.recordset.length === 0) return notFound('Machine not found', request);
            }

            // Replace welders if provided
            if (Array.isArray(body.welder_ids)) {
                await query('DELETE FROM WeldingMachineWelders WHERE machine_id = @id', { id });
                for (const empId of body.welder_ids) {
                    await query(
                        'INSERT INTO WeldingMachineWelders (machine_id, employee_id) VALUES (@machineId, @empId)',
                        { machineId: id, empId: parseInt(empId) }
                    );
                }
            }

            // Return updated machine with welders
            const machine = await query('SELECT * FROM WeldingMachines WHERE id = @id', { id });
            const welders = await query(
                `SELECT wmw.employee_id, e.name AS employee_name
                 FROM WeldingMachineWelders wmw JOIN Employees e ON wmw.employee_id = e.id
                 WHERE wmw.machine_id = @id ORDER BY e.name`,
                { id }
            );

            return ok({ ...machine.recordset[0], welders: welders.recordset }, request);
        } catch (err) {
            context.error('Error updating welding machine:', err);
            return serverError('Failed to update welding machine', request);
        }
    }
});

// DELETE /api/welding-machines/:id — soft delete
app.http('welding-machines-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'welding-machines/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                'UPDATE WeldingMachines SET is_active = 0, updated_at = GETUTCDATE() OUTPUT INSERTED.* WHERE id = @id',
                { id }
            );
            if (result.recordset.length === 0) return notFound('Machine not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('Error deleting welding machine:', err);
            return serverError('Failed to delete welding machine', request);
        }
    }
});

// ═══════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════

// GET /api/suppliers — list all active suppliers
app.http('suppliers-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'suppliers/{id?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = request.params.id;

            if (id) {
                const result = await query('SELECT * FROM Suppliers WHERE id = @id', { id: parseInt(id) });
                if (result.recordset.length === 0) return notFound('Supplier not found', request);
                return ok(result.recordset[0], request);
            }

            const result = await query('SELECT * FROM Suppliers WHERE is_active = 1 ORDER BY service_type, supplier_name');
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching suppliers:', err);
            return serverError('Failed to fetch suppliers', request);
        }
    }
});

// POST /api/suppliers — create a new supplier
app.http('suppliers-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'suppliers',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { service_type, supplier_name, address, telephone, email, contact_name, notes } = body;

            if (!service_type || !supplier_name) return badRequest('service_type and supplier_name are required', request);

            const result = await query(
                `INSERT INTO Suppliers (service_type, supplier_name, address, telephone, email, contact_name, notes)
                 OUTPUT INSERTED.*
                 VALUES (@serviceType, @supplierName, @address, @telephone, @email, @contactName, @notes)`,
                {
                    serviceType: service_type,
                    supplierName: supplier_name,
                    address: address || null,
                    telephone: telephone || null,
                    email: email || null,
                    contactName: contact_name || null,
                    notes: notes || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating supplier:', err);
            return serverError('Failed to create supplier', request);
        }
    }
});

// PUT /api/suppliers/:id — update supplier
app.http('suppliers-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'suppliers/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            const fields = [];
            const params = { id };

            if (body.service_type !== undefined) { fields.push('service_type = @serviceType'); params.serviceType = body.service_type; }
            if (body.supplier_name !== undefined) { fields.push('supplier_name = @supplierName'); params.supplierName = body.supplier_name; }
            if (body.address !== undefined) { fields.push('address = @address'); params.address = body.address; }
            if (body.telephone !== undefined) { fields.push('telephone = @telephone'); params.telephone = body.telephone; }
            if (body.email !== undefined) { fields.push('email = @email'); params.email = body.email; }
            if (body.contact_name !== undefined) { fields.push('contact_name = @contactName'); params.contactName = body.contact_name; }
            if (body.notes !== undefined) { fields.push('notes = @notes'); params.notes = body.notes; }
            if (body.is_active !== undefined) { fields.push('is_active = @isActive'); params.isActive = body.is_active ? 1 : 0; }

            if (fields.length === 0) return badRequest('No fields to update', request);

            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE Suppliers SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Supplier not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating supplier:', err);
            return serverError('Failed to update supplier', request);
        }
    }
});

// DELETE /api/suppliers/:id — soft delete
app.http('suppliers-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'suppliers/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                'UPDATE Suppliers SET is_active = 0, updated_at = GETUTCDATE() OUTPUT INSERTED.* WHERE id = @id',
                { id }
            );
            if (result.recordset.length === 0) return notFound('Supplier not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('Error deleting supplier:', err);
            return serverError('Failed to delete supplier', request);
        }
    }
});
