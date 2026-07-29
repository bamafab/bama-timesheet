// ─────────────────────────────────────────────────────────────────────────────
// capacity.js — workshop load summary (Phase C2)
//
//   GET /api/capacity-summary
//
// One aggregate query: every Live project with its estimated labour hours
// (Σ QuoteLineItems.labour_hours across attached quotes — the F1 transfer),
// hours logged to date (ProjectHours, S000 excluded), and deadline. The
// frontend spreads remaining hours across the weeks to deadline and draws the
// load-vs-capacity board. Read-only.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, serverError, preflight } = require('../responses');

app.http('capacity-summary-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'capacity-summary',
    handler: async (request) => preflight(request)
});

app.http('capacity-summary', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'capacity-summary',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const projRes = await query(`
                SELECT p.id, p.project_number, p.project_name,
                       CONVERT(varchar(10), p.deadline_date, 23) AS deadline_date,
                       est.est_hours,
                       ISNULL(act.logged_hours, 0) AS logged_hours
                  FROM Projects p
                  OUTER APPLY (
                    SELECT SUM(li.labour_hours) AS est_hours
                      FROM ProjectQuotes pq
                      JOIN QuoteLineItems li ON li.qb_quote_id = pq.qb_quote_id
                     WHERE pq.project_id = p.id AND li.is_labour = 1
                  ) est
                  OUTER APPLY (
                    SELECT SUM(ph.hours) AS logged_hours
                      FROM ProjectHours ph
                     WHERE ph.project_number = p.project_number
                       AND ph.project_number <> 'S000'
                  ) act
                 WHERE p.status IN ('Live', 'Active', 'In Progress')
                 ORDER BY p.deadline_date ASC`);

            // Weekly workshop capacity baseline: active shop employees × 40h.
            // The frontend lets the user override this; we supply the default.
            let weeklyCapacity = null;
            try {
                const emp = await query(
                    `SELECT COUNT(*) AS n FROM Employees WHERE ISNULL(active, 1) = 1`);
                weeklyCapacity = (emp.recordset[0].n || 0) * 40;
            } catch (e) { context.warn('capacity baseline:', e.message); }

            return ok({
                projects: projRes.recordset,
                default_weekly_capacity: weeklyCapacity
            }, request);
        } catch (err) {
            context.error('capacity-summary:', err);
            return serverError('Failed to build capacity summary', request);
        }
    }
});
