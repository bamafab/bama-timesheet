// ─────────────────────────────────────────────────────────────────────────────
// cvr.js — Cost & Value Reconciliation summary (Phase C4)
//
//   GET /api/cvr-summary          — every Live project, one row each
//   GET /api/cvr-summary?all=1    — include completed projects too
//
// One aggregate query per concern, assembled server-side:
//   contract   = Σ line items (qty × price) across attached quotes
//   applied    = Σ applied_value_net   (AFPs, per-period values, not Draft/Cancelled)
//   certified  = Σ certified_value_net (Certified + Invoiced AFPs)
//   retention  = certified_retention of the LATEST certified AFP (client
//                notices state retention CUMULATIVELY, so latest = total held)
//   invoiced   = Σ net_amount   (non-Void/Cancelled invoices on the project)
//   paid       = Σ gross_amount − total_outstanding (same invoices)
//   labour     = Σ hours × Employees.rate (S000 excluded)  [cost to date]
//   po_nett    = Σ total_value − vat_amount on active POs  [committed]
// The frontend derives margin/WIP; this endpoint only reports facts.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, serverError, preflight } = require('../responses');

app.http('cvr-summary-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'cvr-summary',
    handler: async (request) => preflight(request)
});

app.http('cvr-summary', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'cvr-summary',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const all = request.query.get('all') === '1';
            const statusFilter = all ? '' : `AND p.status IN ('Live', 'Active', 'In Progress')`;
            const r = await query(`
                SELECT p.id, p.project_number, p.project_name, p.status,
                       CONVERT(varchar(10), p.deadline_date, 23) AS deadline_date,
                       ISNULL(contract.v, 0)  AS contract_value,
                       ISNULL(afp.applied, 0)   AS applied_net,
                       ISNULL(afp.certified, 0) AS certified_net,
                       ISNULL(afp.retention, 0) AS retention_held,
                       afp.last_afp             AS last_afp_ref,
                       ISNULL(inv.net, 0)       AS invoiced_net,
                       ISNULL(inv.paid, 0)      AS paid_gross,
                       ISNULL(inv.outstanding, 0) AS outstanding_gross,
                       ISNULL(lab.cost, 0)      AS labour_cost,
                       ISNULL(lab.hours, 0)     AS labour_hours,
                       ISNULL(po.nett, 0)       AS po_nett
                  FROM Projects p
                  OUTER APPLY (
                    SELECT SUM(li.quantity * li.unit_price) AS v
                      FROM ProjectQuotes pq
                      JOIN QuoteLineItems li ON li.qb_quote_id = pq.qb_quote_id
                     WHERE pq.project_id = p.id
                  ) contract
                  OUTER APPLY (
                    SELECT SUM(CASE WHEN a.status NOT IN ('Draft','Cancelled')
                                    THEN a.applied_value_net ELSE 0 END)   AS applied,
                           SUM(CASE WHEN a.status IN ('Certified','Invoiced')
                                    THEN a.certified_value_net ELSE 0 END) AS certified,
                           (SELECT TOP 1 a2.certified_retention
                              FROM Applications a2
                             WHERE a2.project_id = p.id
                               AND a2.status IN ('Certified','Invoiced')
                               AND a2.certified_retention IS NOT NULL
                             ORDER BY a2.application_no DESC) AS retention,
                           MAX(CASE WHEN a.status NOT IN ('Draft','Cancelled')
                                    THEN a.ref END) AS last_afp
                      FROM Applications a
                     WHERE a.project_id = p.id
                  ) afp
                  OUTER APPLY (
                    SELECT SUM(i.net_amount) AS net,
                           SUM(i.gross_amount - i.total_outstanding) AS paid,
                           SUM(i.total_outstanding) AS outstanding
                      FROM Invoices i
                     WHERE i.project_id = p.id
                       AND i.status NOT IN ('Void','Cancelled','Draft')
                  ) inv
                  OUTER APPLY (
                    SELECT SUM(ph.hours * ISNULL(e.rate, 0)) AS cost,
                           SUM(ph.hours) AS hours
                      FROM ProjectHours ph
                      JOIN Employees e ON e.id = ph.employee_id
                     WHERE ph.project_number = p.project_number
                       AND ph.project_number <> 'S000'
                  ) lab
                  OUTER APPLY (
                    SELECT SUM(o.total_value - ISNULL(o.vat_amount, 0)) AS nett
                      FROM PurchaseOrders o
                     WHERE o.project_id = p.id
                       AND o.status <> 'Cancelled'
                  ) po
                 WHERE 1=1 ${statusFilter}
                 ORDER BY p.project_number`);
            return ok(r.recordset, request);
        } catch (err) {
            context.error('cvr-summary:', err);
            return serverError('Failed to build CVR summary: ' + err.message, request);
        }
    }
});
