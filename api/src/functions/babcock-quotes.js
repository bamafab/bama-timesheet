const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const ALLOWED_STATUSES = ['Quote Sent', 'PO Received', 'Invoice Generated', 'Paid'];
// First system-allocated number. B0091 was the last manually-created Babcock
// quote in SharePoint pre-go-live, so the system picks up at B0092.
const STARTING_REF_NUMBER = 92;

// Build a B#### reference from a number, e.g. 90 → "B0090"
function formatBabcockRef(n) {
    return `B${String(n).padStart(4, '0')}`;
}

// Parse the numeric portion out of a B#### ref. Returns NaN if the ref doesn't match.
function parseBabcockRefNumber(ref) {
    if (!ref) return NaN;
    const m = String(ref).match(/^B(\d{1,6})$/i);
    return m ? parseInt(m[1], 10) : NaN;
}

// ── OPTIONS preflight ──────────────────────────────────────────
app.http('babcock-quotes-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'babcock-quotes/{*path}',
    handler: async (request) => preflight(request)
});

app.http('babcock-quote-next-ref-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'babcock-quote-next-ref',
    handler: async (request) => preflight(request)
});

// ── GET /api/babcock-quotes — list all ─────────────────────────
app.http('babcock-quotes-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'babcock-quotes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const status = request.query.get('status') || '';
            let sqlText = `SELECT id, quote_ref, date_sent, total_value, markup_pct,
                                  source_filename, status, created_by, created_at, updated_at,
                                  quotation_date, customer_id, work_order_no, valid_until,
                                  prepared_by, quote_for_area, quote_for_address, comments,
                                  original_file_id, original_file_url,
                                  generated_file_id, generated_file_url
                           FROM BabcockQuotes`;
            const params = {};
            if (status) {
                sqlText += ' WHERE status = @status';
                params.status = status;
            }
            sqlText += ' ORDER BY created_at DESC';
            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching Babcock quotes:', err);
            return serverError('Failed to fetch Babcock quotes', request);
        }
    }
});

// ── GET /api/babcock-quotes/:id — single (with line items) ─────
app.http('babcock-quotes-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'babcock-quotes/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);

            const result = await query(
                `SELECT * FROM BabcockQuotes WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Babcock quote not found', request);

            const row = result.recordset[0];
            // Parse JSON line_items for the client
            if (row.line_items) {
                try { row.line_items = JSON.parse(row.line_items); }
                catch { /* leave as raw string if malformed */ }
            }
            return ok(row, request);
        } catch (err) {
            context.error('Error fetching Babcock quote:', err);
            return serverError('Failed to fetch Babcock quote', request);
        }
    }
});

// ── GET /api/babcock-quote-next-ref — next available reference ──
// Walks BabcockQuotes for the highest B#### number; starts at STARTING_REF_NUMBER if empty.
app.http('babcock-quote-next-ref', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'babcock-quote-next-ref',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const result = await query(`SELECT quote_ref FROM BabcockQuotes`, {});
            let max = STARTING_REF_NUMBER - 1; // so first issued is STARTING_REF_NUMBER
            for (const r of result.recordset) {
                const n = parseBabcockRefNumber(r.quote_ref);
                if (!isNaN(n) && n > max) max = n;
            }
            const next = max + 1;
            return ok({ reference: formatBabcockRef(next), number: next }, request);
        } catch (err) {
            context.error('Error generating Babcock reference:', err);
            return serverError('Failed to generate reference', request);
        }
    }
});

// ── POST /api/babcock-quotes — create ──────────────────────────
// Body: { quote_ref?, date_sent?, total_value, markup_pct, line_items, source_filename?, created_by? }
// If quote_ref is omitted, server picks the next sequential B####.
app.http('babcock-quotes-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'babcock-quotes',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            let { quote_ref, date_sent, total_value, markup_pct, line_items,
                  source_filename, created_by, status,
                  quotation_date, customer_id, work_order_no, valid_until,
                  prepared_by, quote_for_area, quote_for_address, comments,
                  original_file_id, original_file_url,
                  generated_file_id, generated_file_url } = body;

            // Auto-allocate reference if not supplied — uses same logic as the
            // next-ref endpoint to keep things race-tolerant within a single request.
            if (!quote_ref) {
                const all = await query(`SELECT quote_ref FROM BabcockQuotes`, {});
                let max = STARTING_REF_NUMBER - 1;
                for (const r of all.recordset) {
                    const n = parseBabcockRefNumber(r.quote_ref);
                    if (!isNaN(n) && n > max) max = n;
                }
                quote_ref = formatBabcockRef(max + 1);
            }

            if (status && !ALLOWED_STATUSES.includes(status)) {
                return badRequest(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`, request);
            }

            // Serialise line items if they came in as an object
            const lineItemsJson = line_items
                ? (typeof line_items === 'string' ? line_items : JSON.stringify(line_items))
                : null;

            const result = await query(
                `INSERT INTO BabcockQuotes
                    (quote_ref, date_sent, total_value, markup_pct, line_items,
                     source_filename, status, created_by,
                     quotation_date, customer_id, work_order_no, valid_until,
                     prepared_by, quote_for_area, quote_for_address, comments,
                     original_file_id, original_file_url,
                     generated_file_id, generated_file_url)
                 OUTPUT INSERTED.*
                 VALUES (@quote_ref, @date_sent, @total_value, @markup_pct, @line_items,
                         @source_filename, @status, @created_by,
                         @quotation_date, @customer_id, @work_order_no, @valid_until,
                         @prepared_by, @quote_for_area, @quote_for_address, @comments,
                         @original_file_id, @original_file_url,
                         @generated_file_id, @generated_file_url)`,
                {
                    quote_ref,
                    date_sent: date_sent || null,
                    total_value: total_value !== undefined && total_value !== null ? Number(total_value) : null,
                    markup_pct: markup_pct !== undefined && markup_pct !== null ? Number(markup_pct) : null,
                    line_items: lineItemsJson,
                    source_filename: source_filename || null,
                    status: status || 'Quote Sent',
                    created_by: created_by || null,
                    quotation_date: quotation_date || null,
                    customer_id: customer_id || null,
                    work_order_no: work_order_no || null,
                    valid_until: valid_until || null,
                    prepared_by: prepared_by || null,
                    quote_for_area: quote_for_area || null,
                    quote_for_address: quote_for_address || null,
                    comments: comments || null,
                    original_file_id: original_file_id || null,
                    original_file_url: original_file_url || null,
                    generated_file_id: generated_file_id || null,
                    generated_file_url: generated_file_url || null
                }
            );

            const row = result.recordset[0];
            if (row.line_items) {
                try { row.line_items = JSON.parse(row.line_items); } catch { /* */ }
            }
            return created(row, request);
        } catch (err) {
            if (err.message?.includes('UX_BabcockQuotes_quote_ref')) {
                return badRequest('A Babcock quote with that reference already exists', request);
            }
            context.error('Error creating Babcock quote:', err);
            return serverError('Failed to create Babcock quote', request);
        }
    }
});

// ── PUT /api/babcock-quotes/:id — update (status changes etc.) ─
app.http('babcock-quotes-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'babcock-quotes/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);

            const body = await request.json();
            const fields = [];
            const params = { id };

            const allowed = ['quote_ref', 'date_sent', 'total_value', 'markup_pct',
                             'line_items', 'source_filename', 'status',
                             'quotation_date', 'customer_id', 'work_order_no', 'valid_until',
                             'prepared_by', 'quote_for_area', 'quote_for_address', 'comments',
                             'original_file_id', 'original_file_url',
                             'generated_file_id', 'generated_file_url'];

            for (const key of allowed) {
                if (body[key] === undefined) continue;

                if (key === 'status' && body.status && !ALLOWED_STATUSES.includes(body.status)) {
                    return badRequest(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`, request);
                }

                let val = body[key];
                if (key === 'line_items' && val !== null && typeof val !== 'string') {
                    val = JSON.stringify(val);
                }
                if ((key === 'total_value' || key === 'markup_pct') && val !== null && val !== undefined) {
                    val = Number(val);
                }

                fields.push(`${key} = @${key}`);
                params[key] = val;
            }

            if (fields.length === 0) return badRequest('No fields to update', request);
            fields.push('updated_at = GETUTCDATE()');

            const result = await query(
                `UPDATE BabcockQuotes SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );
            if (result.recordset.length === 0) return notFound('Babcock quote not found', request);

            const row = result.recordset[0];
            if (row.line_items) {
                try { row.line_items = JSON.parse(row.line_items); } catch { /* */ }
            }
            return ok(row, request);
        } catch (err) {
            if (err.message?.includes('UX_BabcockQuotes_quote_ref')) {
                return badRequest('A Babcock quote with that reference already exists', request);
            }
            context.error('Error updating Babcock quote:', err);
            return serverError('Failed to update Babcock quote', request);
        }
    }
});

// ── DELETE /api/babcock-quotes/:id ─────────────────────────────
app.http('babcock-quotes-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'babcock-quotes/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('Invalid id', request);

            const result = await query(
                `DELETE FROM BabcockQuotes OUTPUT DELETED.id WHERE id = @id`,
                { id }
            );
            if (result.recordset.length === 0) return notFound('Babcock quote not found', request);
            return ok({ deleted: true, id }, request);
        } catch (err) {
            context.error('Error deleting Babcock quote:', err);
            return serverError('Failed to delete Babcock quote', request);
        }
    }
});
