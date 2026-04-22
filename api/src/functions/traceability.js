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
// SERVICE TYPES
// ═══════════════════════════════════════════

// GET /api/service-types — list all active service types
app.http('service-types-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'service-types',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const result = await query('SELECT * FROM ServiceTypes WHERE is_active = 1 ORDER BY name');
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching service types:', err);
            return serverError('Failed to fetch service types', request);
        }
    }
});

// POST /api/service-types — create a new service type
app.http('service-types-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'service-types',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            if (!body.name || !body.name.trim()) return badRequest('name is required', request);

            const result = await query(
                'INSERT INTO ServiceTypes (name) OUTPUT INSERTED.* VALUES (@name)',
                { name: body.name.trim() }
            );
            return created(result.recordset[0], request);
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE')) {
                return badRequest('Service type already exists', request);
            }
            context.error('Error creating service type:', err);
            return serverError('Failed to create service type', request);
        }
    }
});

// DELETE /api/service-types/:id — soft delete
app.http('service-types-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'service-types/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                'UPDATE ServiceTypes SET is_active = 0 OUTPUT INSERTED.* WHERE id = @id',
                { id }
            );
            if (result.recordset.length === 0) return notFound('Service type not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('Error deleting service type:', err);
            return serverError('Failed to delete service type', request);
        }
    }
});

// ═══════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════

// GET /api/suppliers — list all active suppliers with their services
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

                const services = await query(
                    `SELECT ss.service_type_id, st.name AS service_name
                     FROM SupplierServices ss JOIN ServiceTypes st ON ss.service_type_id = st.id
                     WHERE ss.supplier_id = @supplierId ORDER BY st.name`,
                    { supplierId: parseInt(id) }
                );
                return ok({ ...result.recordset[0], services: services.recordset }, request);
            }

            const suppliers = await query('SELECT * FROM Suppliers WHERE is_active = 1 ORDER BY supplier_name');

            const allServices = await query(
                `SELECT ss.supplier_id, ss.service_type_id, st.name AS service_name
                 FROM SupplierServices ss JOIN ServiceTypes st ON ss.service_type_id = st.id
                 ORDER BY st.name`
            );
            const svcMap = {};
            allServices.recordset.forEach(s => {
                if (!svcMap[s.supplier_id]) svcMap[s.supplier_id] = [];
                svcMap[s.supplier_id].push(s);
            });

            const result = suppliers.recordset.map(s => ({
                ...s,
                services: svcMap[s.id] || []
            }));

            return ok(result, request);
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
            const { supplier_name, address_line1, address_line2, city, county, postcode, telephone, email, contact_name, notes, service_type_ids } = body;

            if (!supplier_name) return badRequest('supplier_name is required', request);

            const result = await query(
                `INSERT INTO Suppliers (supplier_name, address_line1, address_line2, city, county, postcode, telephone, email, contact_name, notes)
                 OUTPUT INSERTED.*
                 VALUES (@supplierName, @addressLine1, @addressLine2, @city, @county, @postcode, @telephone, @email, @contactName, @notes)`,
                {
                    supplierName: supplier_name,
                    addressLine1: address_line1 || null,
                    addressLine2: address_line2 || null,
                    city: city || null,
                    county: county || null,
                    postcode: postcode || null,
                    telephone: telephone || null,
                    email: email || null,
                    contactName: contact_name || null,
                    notes: notes || null
                }
            );

            const supplier = result.recordset[0];

            if (Array.isArray(service_type_ids) && service_type_ids.length > 0) {
                for (const stId of service_type_ids) {
                    await query(
                        'INSERT INTO SupplierServices (supplier_id, service_type_id) VALUES (@supplierId, @stId)',
                        { supplierId: supplier.id, stId: parseInt(stId) }
                    );
                }
            }

            return created(supplier, request);
        } catch (err) {
            context.error('Error creating supplier:', err);
            return serverError('Failed to create supplier: ' + (err.message || String(err)), request);
        }
    }
});

// PUT /api/suppliers/:id — update supplier details + services
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

            if (body.supplier_name !== undefined) { fields.push('supplier_name = @supplierName'); params.supplierName = body.supplier_name; }
            if (body.address_line1 !== undefined) { fields.push('address_line1 = @addressLine1'); params.addressLine1 = body.address_line1; }
            if (body.address_line2 !== undefined) { fields.push('address_line2 = @addressLine2'); params.addressLine2 = body.address_line2; }
            if (body.city !== undefined) { fields.push('city = @city'); params.city = body.city; }
            if (body.county !== undefined) { fields.push('county = @county'); params.county = body.county; }
            if (body.postcode !== undefined) { fields.push('postcode = @postcode'); params.postcode = body.postcode; }
            if (body.telephone !== undefined) { fields.push('telephone = @telephone'); params.telephone = body.telephone; }
            if (body.email !== undefined) { fields.push('email = @email'); params.email = body.email; }
            if (body.contact_name !== undefined) { fields.push('contact_name = @contactName'); params.contactName = body.contact_name; }
            if (body.notes !== undefined) { fields.push('notes = @notes'); params.notes = body.notes; }
            if (body.is_active !== undefined) { fields.push('is_active = @isActive'); params.isActive = body.is_active ? 1 : 0; }

            if (fields.length > 0) {
                fields.push('updated_at = GETUTCDATE()');
                const result = await query(
                    `UPDATE Suppliers SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                    params
                );
                if (result.recordset.length === 0) return notFound('Supplier not found', request);
            }

            // Replace services if provided
            if (Array.isArray(body.service_type_ids)) {
                await query('DELETE FROM SupplierServices WHERE supplier_id = @id', { id });
                for (const stId of body.service_type_ids) {
                    await query(
                        'INSERT INTO SupplierServices (supplier_id, service_type_id) VALUES (@supplierId, @stId)',
                        { supplierId: id, stId: parseInt(stId) }
                    );
                }
            }

            // Return updated supplier with services
            const supplier = await query('SELECT * FROM Suppliers WHERE id = @id', { id });
            const services = await query(
                `SELECT ss.service_type_id, st.name AS service_name
                 FROM SupplierServices ss JOIN ServiceTypes st ON ss.service_type_id = st.id
                 WHERE ss.supplier_id = @id ORDER BY st.name`,
                { id }
            );
            return ok({ ...supplier.recordset[0], services: services.recordset }, request);
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
