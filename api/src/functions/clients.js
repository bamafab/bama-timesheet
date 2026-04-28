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
