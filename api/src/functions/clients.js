const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// OPTIONS preflight
app.http('clients-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'clients/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/clients — list all or search by name
app.http('clients-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'clients',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const search = request.query.get('search') || '';
            let sqlText = 'SELECT * FROM Clients WHERE is_active = 1';
            const params = {};

            if (search) {
                sqlText += ' AND company_name LIKE @search';
                params.search = `%${search}%`;
            }

            sqlText += ' ORDER BY company_name';
            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching clients:', err);
            return serverError('Failed to fetch clients', request);
        }
    }
});

// GET /api/clients/:id
app.http('clients-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'clients/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query('SELECT * FROM Clients WHERE id = @id', { id });
            if (result.recordset.length === 0) return notFound('Client not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error fetching client:', err);
            return serverError('Failed to fetch client', request);
        }
    }
});

// POST /api/clients — create new client
app.http('clients-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'clients',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { company_name, address_line1, address_line2, city, county, postcode,
                    contact_name, contact_email, contact_phone, notes } = body;

            if (!company_name) return badRequest('company_name is required', request);

            const result = await query(
                `INSERT INTO Clients (company_name, address_line1, address_line2, city, county, postcode,
                    contact_name, contact_email, contact_phone, notes)
                 OUTPUT INSERTED.*
                 VALUES (@company_name, @address_line1, @address_line2, @city, @county, @postcode,
                    @contact_name, @contact_email, @contact_phone, @notes)`,
                {
                    company_name, address_line1: address_line1 || null,
                    address_line2: address_line2 || null, city: city || null,
                    county: county || null, postcode: postcode || null,
                    contact_name: contact_name || null, contact_email: contact_email || null,
                    contact_phone: contact_phone || null, notes: notes || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            if (err.message?.includes('UX_Clients_company_name')) {
                return badRequest('A client with that company name already exists', request);
            }
            context.error('Error creating client:', err);
            return serverError('Failed to create client', request);
        }
    }
});

// PUT /api/clients/:id — update client
app.http('clients-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'clients/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();

            const fields = [];
            const params = { id };

            const allowed = ['company_name', 'address_line1', 'address_line2', 'city', 'county',
                           'postcode', 'contact_name', 'contact_email', 'contact_phone', 'notes', 'is_active'];

            for (const key of allowed) {
                if (body[key] !== undefined) {
                    fields.push(`${key} = @${key}`);
                    params[key] = key === 'is_active' ? (body[key] ? 1 : 0) : body[key];
                }
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE Clients SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Client not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating client:', err);
            return serverError('Failed to update client', request);
        }
    }
});

// GET /api/client-contacts?client_id=X — list contacts for a client
app.http('client-contacts-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'client-contacts',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const clientId = parseInt(request.query.get('client_id'));
            if (!clientId) return badRequest('client_id is required', request);

            const result = await query(
                `SELECT * FROM ClientContacts WHERE client_id = @clientId ORDER BY created_at DESC`,
                { clientId }
            );
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching contacts:', err);
            return serverError('Failed to fetch contacts', request);
        }
    }
});

// POST /api/client-contacts — add a contact (auto-dedupe by name + email)
app.http('client-contacts-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'client-contacts',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { client_id, contact_name, contact_email, contact_phone, role, notes } = body;
            if (!client_id) return badRequest('client_id is required', request);

            // At least one identifier required
            if (!contact_name && !contact_email && !contact_phone) {
                return badRequest('At least one of contact_name, contact_email, or contact_phone is required', request);
            }

            // Dedupe by name + email match (case-insensitive)
            const dedupeRes = await query(
                `SELECT id FROM ClientContacts
                 WHERE client_id = @clientId
                   AND ISNULL(LOWER(contact_name), '') = ISNULL(LOWER(@name), '')
                   AND ISNULL(LOWER(contact_email), '') = ISNULL(LOWER(@email), '')`,
                {
                    clientId: parseInt(client_id),
                    name: contact_name || null,
                    email: contact_email || null
                }
            );
            if (dedupeRes.recordset.length > 0) {
                // Already exists — update phone/role/notes if newer values given
                const existingId = dedupeRes.recordset[0].id;
                const updateFields = [];
                const params = { id: existingId };
                if (contact_phone) { updateFields.push('contact_phone = @phone'); params.phone = contact_phone; }
                if (role) { updateFields.push('role = @role'); params.role = role; }
                if (notes) { updateFields.push('notes = @notes'); params.notes = notes; }
                if (updateFields.length) {
                    updateFields.push('updated_at = GETUTCDATE()');
                    const updRes = await query(
                        `UPDATE ClientContacts SET ${updateFields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                        params
                    );
                    return ok({ ...updRes.recordset[0], deduped: true }, request);
                }
                // Nothing to update, return existing
                const existing = await query(`SELECT * FROM ClientContacts WHERE id = @id`, { id: existingId });
                return ok({ ...existing.recordset[0], deduped: true }, request);
            }

            const result = await query(
                `INSERT INTO ClientContacts (client_id, contact_name, contact_email, contact_phone, role, notes)
                 OUTPUT INSERTED.*
                 VALUES (@clientId, @name, @email, @phone, @role, @notes)`,
                {
                    clientId: parseInt(client_id),
                    name: contact_name || null,
                    email: contact_email || null,
                    phone: contact_phone || null,
                    role: role || null,
                    notes: notes || null
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error creating contact:', err);
            return serverError('Failed to create contact', request);
        }
    }
});

// PUT /api/client-contacts/:id — update a contact
app.http('client-contacts-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'client-contacts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };
            const allowed = ['contact_name', 'contact_email', 'contact_phone', 'role', 'notes'];
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    fields.push(`${key} = @${key}`);
                    params[key] = body[key];
                }
            }
            if (fields.length === 0) return badRequest('No fields to update', request);

            fields.push('updated_at = GETUTCDATE()');
            const result = await query(
                `UPDATE ClientContacts SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );
            if (result.recordset.length === 0) return notFound('Contact not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating contact:', err);
            return serverError('Failed to update contact', request);
        }
    }
});

// DELETE /api/client-contacts/:id
app.http('client-contacts-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'client-contacts/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `DELETE FROM ClientContacts OUTPUT DELETED.* WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Contact not found', request);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting contact:', err);
            return serverError('Failed to delete contact', request);
        }
    }
});

// OPTIONS preflight for client-contacts
app.http('client-contacts-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'client-contacts/{*path}',
    handler: async (request) => preflight(request)
});
