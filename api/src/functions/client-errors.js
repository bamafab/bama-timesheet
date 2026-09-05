// ─────────────────────────────────────────────────────────────────────────────
// client-errors.js — browser errors reported by the global handlers
// (Session 2 — monitoring, 2026-09-05)
//
//   POST /api/client-error            body {page, message, stack, url, userAgent, extra}
//   GET  /api/client-errors?days=7    grouped by page + message (Health tab table)
//   GET  /api/client-errors?days=7&raw=1   individual rows, newest first (CSV export)
//
// Rules:
//   • requireAuth on both — the user email on the row comes from the token.
//   • Rate limit IN CODE, per user: max 20 reports per rolling minute. A page
//     stuck in an error loop is refused with 429 BEFORE any SQL is touched.
//   • Every field is truncated server-side; the browser is not trusted to be
//     polite about a 2 MB stack.
//   • Reads are date-bounded (1–90 days) — the table has no purge job, per the
//     SQL Serverless cost rule (nothing touches SQL on a timer).
//   • Missing table (migration not run yet) is a soft failure: the POST returns
//     200 {stored:false} rather than a 500, so the reporter can never itself
//     trip the 5xx alert before create-client-errors.sql has been run.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, serverError, preflight, corsHeaders } = require('../responses');

const RATE_LIMIT_PER_MIN = 20;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 7;

// ---- rate limit (per Function App instance, in memory) ---------------------
// email → { windowStart, count }. Pruned on every call so it can't grow past
// the number of distinct users seen in the last minute.
const buckets = new Map();
function rateLimited(key, now = Date.now()) {
    for (const [k, b] of buckets) if (now - b.windowStart >= RATE_WINDOW_MS) buckets.delete(k);
    let b = buckets.get(key);
    if (!b) { b = { windowStart: now, count: 0 }; buckets.set(key, b); }
    b.count += 1;
    return b.count > RATE_LIMIT_PER_MIN;
}
function resetRateLimit() { buckets.clear(); }

// ---- input shaping --------------------------------------------------------
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
function shapeReport(body) {
    if (!body || typeof body !== 'object') return null;
    const message = clip(body.message, 1000);
    if (!message || !message.trim()) return null;
    let url = clip(body.url, 500);
    if (url) { url = url.split('#')[0]; }   // hash can carry an access_token on hub bounces
    let extra = null;
    if (body.extra !== undefined && body.extra !== null) {
        try { extra = clip(typeof body.extra === 'string' ? body.extra : JSON.stringify(body.extra), 4000); } catch { extra = null; }
    }
    return {
        page: (clip(body.page, 100) || 'unknown').trim(),
        message: message.trim(),
        stack: clip(body.stack, 8000),
        url,
        user_agent: clip(body.userAgent || body.user_agent, 300),
        extra
    };
}

function daysParam(request) {
    const n = parseInt(request.query.get('days'), 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
    return Math.min(n, MAX_DAYS);
}

const missingTable = (err) => /Invalid object name.*ClientErrors/i.test(err && err.message || '');

// ---- routes ---------------------------------------------------------------
app.http('client-error-preflight', {
    methods: ['OPTIONS'], authLevel: 'anonymous', route: 'client-error',
    handler: async (request) => preflight(request)
});
app.http('client-errors-preflight', {
    methods: ['OPTIONS'], authLevel: 'anonymous', route: 'client-errors',
    handler: async (request) => preflight(request)
});

app.http('client-error-report', {
    methods: ['POST'], authLevel: 'anonymous', route: 'client-error',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        const who = auth.email || auth.userId || 'unknown';

        if (rateLimited(who)) {
            context.warn(`client-error: rate limit hit for ${who} (>${RATE_LIMIT_PER_MIN}/min) — report dropped`);
            return {
                status: 429,
                jsonBody: { error: 'Too many error reports — try again in a minute', retry_after_s: 60 },
                headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...corsHeaders(request) }
            };
        }

        let body;
        try { body = await request.json(); } catch { return badRequest('Invalid JSON', request); }
        const r = shapeReport(body);
        if (!r) return badRequest('message is required', request);

        try {
            const res = await query(`
                INSERT INTO ClientErrors (page, message, stack, url, user_agent, user_email, extra, request_id)
                OUTPUT INSERTED.id
                VALUES (@page, @message, @stack, @url, @user_agent, @user_email, @extra, @request_id)`,
                { ...r, user_email: clip(auth.email, 200), request_id: clip(context.invocationId, 60) });
            return created({ stored: true, id: res.recordset[0].id }, request);
        } catch (err) {
            if (missingTable(err)) {
                context.warn('client-error: ClientErrors table missing — run api/sql/create-client-errors.sql. Dropped:', r.page, r.message);
                return ok({ stored: false, reason: 'ClientErrors table not created yet' }, request);
            }
            context.error('client-error-report:', err);
            return serverError('Failed to store client error', request);
        }
    }
});

app.http('client-errors-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'client-errors',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        const days = daysParam(request);
        const raw = request.query.get('raw') === '1';
        try {
            if (raw) {
                const res = await query(`
                    SELECT TOP 2000 id, CONVERT(varchar(19), occurred_at, 120) AS occurred_at,
                           page, message, stack, url, user_agent, user_email, extra, request_id
                      FROM ClientErrors
                     WHERE occurred_at >= DATEADD(day, -@days, SYSUTCDATETIME())
                     ORDER BY occurred_at DESC, id DESC`, { days });
                return ok({ days, rows: res.recordset }, request);
            }
            const res = await query(`
                SELECT TOP 200
                       g.page, g.message,
                       g.error_count,
                       CONVERT(varchar(19), g.last_seen, 120)  AS last_seen,
                       CONVERT(varchar(19), g.first_seen, 120) AS first_seen,
                       g.user_count,
                       (SELECT STRING_AGG(d.user_email, ', ')
                          FROM (SELECT DISTINCT TOP 3 c2.user_email
                                  FROM ClientErrors c2
                                 WHERE c2.page = g.page AND c2.message = g.message
                                   AND c2.occurred_at >= DATEADD(day, -@days, SYSUTCDATETIME())
                                   AND c2.user_email IS NOT NULL) d) AS users,
                       (SELECT TOP 1 c3.stack FROM ClientErrors c3
                         WHERE c3.page = g.page AND c3.message = g.message
                           AND c3.occurred_at >= DATEADD(day, -@days, SYSUTCDATETIME())
                         ORDER BY c3.occurred_at DESC) AS last_stack,
                       (SELECT TOP 1 c4.url FROM ClientErrors c4
                         WHERE c4.page = g.page AND c4.message = g.message
                           AND c4.occurred_at >= DATEADD(day, -@days, SYSUTCDATETIME())
                         ORDER BY c4.occurred_at DESC) AS last_url
                  FROM (SELECT page, message,
                               COUNT(*)                   AS error_count,
                               MAX(occurred_at)           AS last_seen,
                               MIN(occurred_at)           AS first_seen,
                               COUNT(DISTINCT user_email) AS user_count
                          FROM ClientErrors
                         WHERE occurred_at >= DATEADD(day, -@days, SYSUTCDATETIME())
                         GROUP BY page, message) g
                 ORDER BY g.last_seen DESC`, { days });
            return ok({ days, groups: res.recordset }, request);
        } catch (err) {
            if (missingTable(err)) return ok({ days, groups: [], rows: [], table_missing: true }, request);
            context.error('client-errors-list:', err);
            return serverError('Failed to read client errors', request);
        }
    }
});

module.exports = { _test: { rateLimited, resetRateLimit, shapeReport, RATE_LIMIT_PER_MIN } };
