const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY READ-ONLY RUMP (2026-08-09).
// The legacy tender/quote pages (tenders.html, quotes.html) were retired and
// all WRITE endpoints (create / update / delete, TenderComments CRUD, next-ref)
// were deleted to close the silent data fork against the new Tender Register
// (TenderRegister table, dashboard TD). The old Tenders table itself remains
// in the database — it is still read-joined by projects.js / project-sheet.js /
// quote-financials.js (source_quote_id + ProjectQuotes.tender_id on historic
// projects), by qb-quotes.js next-ref (collision guard) and by the live
// "Attach Quote" modal in project-tracker.html (GET /api/tenders?status=won).
// Only GET list + GET by id survive. Do not add write endpoints here.
// ─────────────────────────────────────────────────────────────────────────────

// OPTIONS preflight
app.http('tenders-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'tenders/{*path}',
    handler: async (request) => preflight(request)
});

// GET /api/tenders — list all tenders, optional status filter
app.http('tenders-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tenders',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const status = request.query.get('status') || '';
            let sqlText = `SELECT t.*, c.company_name, c.contact_name, c.contact_email, c.contact_phone,
                                  e.name AS assigned_to_name
                           FROM Tenders t
                           JOIN Clients c ON c.id = t.client_id
                           LEFT JOIN Employees e ON e.id = t.assigned_to_id`;
            const params = {};

            if (status) {
                sqlText += ' WHERE t.status = @status';
                params.status = status;
            }

            sqlText += ' ORDER BY t.created_at DESC';
            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching tenders:', err);
            return serverError('Failed to fetch tenders', request);
        }
    }
});

// GET /api/tenders/:id
app.http('tenders-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tenders/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                `SELECT t.*, c.company_name, c.address_line1, c.address_line2, c.city, c.county, c.postcode,
                        c.contact_name, c.contact_email, c.contact_phone,
                        e.name AS assigned_to_name
                 FROM Tenders t
                 JOIN Clients c ON c.id = t.client_id
                 LEFT JOIN Employees e ON e.id = t.assigned_to_id
                 WHERE t.id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Tender not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error fetching tender:', err);
            return serverError('Failed to fetch tender', request);
        }
    }
});
