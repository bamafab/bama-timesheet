const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, badRequest, serverError, preflight } = require('../responses');

// GET /api/settings — get all settings
// GET /api/settings/:key — get single setting
app.http('settings-get', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'settings/{key?}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth._preflight) return preflight(request);
        if (auth.status) return auth;

        try {
            const key = request.params.key;

            if (key) {
                const result = await query(
                    'SELECT * FROM Settings WHERE [key] = @key',
                    { key }
                );
                if (result.recordset.length === 0) {
                    return ok({ key, value: null }, request);
                }
                const row = result.recordset[0];
                // Try to parse JSON values
                try {
                    row.value = JSON.parse(row.value);
                } catch (e) {
                    // Not JSON, keep as string
                }
                return ok(row, request);
            }

            const result = await query('SELECT * FROM Settings ORDER BY [key]');
            const settings = {};
            for (const row of result.recordset) {
                try {
                    settings[row.key] = JSON.parse(row.value);
                } catch (e) {
                    settings[row.key] = row.value;
                }
            }
            return ok(settings, request);
        } catch (err) {
            context.error('Error fetching settings:', err);
            return serverError('Failed to fetch settings', request);
        }
    }
});

// PUT /api/settings — update one or more settings
// Body: { "key": "value" } or { "key1": "value1", "key2": "value2" }
app.http('settings-update', {
    methods: ['PUT', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'settings',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth._preflight) return preflight(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();

            if (!body || typeof body !== 'object') {
                return badRequest('Body must be an object of key-value pairs', request);
            }

            const updated = {};
            for (const [key, value] of Object.entries(body)) {
                const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

                await query(
                    `MERGE Settings AS target
                     USING (SELECT @key AS [key]) AS source
                     ON target.[key] = source.[key]
                     WHEN MATCHED THEN
                         UPDATE SET value = @value, updated_at = GETUTCDATE()
                     WHEN NOT MATCHED THEN
                         INSERT ([key], value) VALUES (@key, @value);`,
                    { key, value: stringValue }
                );

                updated[key] = value;
            }

            return ok({ updated }, request);
        } catch (err) {
            context.error('Error updating settings:', err);
            return serverError('Failed to update settings', request);
        }
    }
});

// POST /api/auth/verify-pin — verify manager/draftsman PIN
app.http('auth-verify-pin', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'auth/verify-pin',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth._preflight) return preflight(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, pin } = body;

            if (!employee_id || !pin) {
                return badRequest('employee_id and pin are required', request);
            }

            const result = await query(
                'SELECT id, name, erp_role, pin FROM Employees WHERE id = @id AND is_active = 1',
                { id: parseInt(employee_id) }
            );

            if (result.recordset.length === 0) {
                return ok({ valid: false, reason: 'Employee not found' }, request);
            }

            const emp = result.recordset[0];
            if (emp.pin !== pin) {
                return ok({ valid: false, reason: 'Incorrect PIN' }, request);
            }

            return ok({
                valid: true,
                employee_id: emp.id,
                name: emp.name,
                erp_role: emp.erp_role
            }, request);
        } catch (err) {
            context.error('Error verifying PIN:', err);
            return serverError('Failed to verify PIN', request);
        }
    }
});

// GET /api/health — simple health check
app.http('health', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'health',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') return preflight(request);
        try {
            const result = await query('SELECT 1 AS ok');
            return ok({
                status: 'healthy',
                database: 'connected',
                timestamp: new Date().toISOString()
            }, request);
        } catch (err) {
            const { corsHeaders } = require('../responses');
            return {
                status: 503,
                jsonBody: {
                    status: 'unhealthy',
                    database: 'disconnected',
                    error: err.message,
                    timestamp: new Date().toISOString()
                },
                headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
            };
        }
    }
});
