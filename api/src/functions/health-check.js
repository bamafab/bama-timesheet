// ─────────────────────────────────────────────────────────────────────────────
// health-check.js — READ-ONLY data-integrity diagnostics (Fault Register B0)
//
//   GET /api/health-check?year=2026
//
// Runs a battery of independent checks against live data and reports findings
// keyed to FAULT-REGISTER.md entries. Every check is wrapped so one failure
// (e.g. a table this environment doesn't have) reports as status:'error' for
// that check only — the endpoint never 500s because a single probe broke.
// This endpoint MUST NEVER write anything.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, serverError, preflight } = require('../responses');

app.http('health-check-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'health-check',
    handler: async (request) => preflight(request)
});

// Helper — run one named check, never throw.
async function runCheck(id, fault, title, fn) {
    try {
        const rows = await fn();
        return {
            id, fault, title,
            status: rows.length ? 'issues' : 'ok',
            count: rows.length,
            rows: rows.slice(0, 100)   // cap payload; count is still the full number
        };
    } catch (e) {
        return { id, fault, title, status: 'error', count: 0, rows: [], error: e.message };
    }
}

app.http('health-check', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'health-check',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const year = parseInt(request.query.get('year')) || new Date().getFullYear();
        const yy = String(year).slice(2);
        const refPat = `Q${yy}%`;

        const checks = [];

        // ── C1 (F2/F9) — blob vs column disagreements per QB quote ─────────
        checks.push(await runCheck('blob-column-drift', 'F2/F9',
            'Quotes where the JSON blob and SQL columns disagree', async () => {
            const r = await query(`
                SELECT id, reference, status, revision, company,
                       CONVERT(varchar(10), date_created, 23) AS date_created,
                       CONVERT(varchar(10), date_sent, 23)    AS date_sent,
                       CONVERT(varchar(10), decision_due, 23) AS decision_due,
                       CONVERT(varchar(10), valid_until, 23)  AS valid_until,
                       CONVERT(varchar(10), chasing_date, 23) AS chasing_date,
                       quote_data
                  FROM QuoteBuilderQuotes
                 WHERE reference LIKE @refPat AND ISNULL(status,'') != 'deleted'`,
                { refPat });
            const findings = [];
            const day = v => v ? String(v).slice(0, 10) : '';
            for (const row of r.recordset) {
                let blob;
                try { blob = JSON.parse(row.quote_data || '{}'); } catch { 
                    findings.push({ reference: row.reference, field: 'quote_data', column: '(unparseable JSON)', blob: '' });
                    continue;
                }
                const pairs = [
                    ['date',        day(blob.date),        day(row.date_created)],
                    ['dateSent',    day(blob.dateSent),    day(row.date_sent)],
                    ['decisionDue', day(blob.decisionDue), day(row.decision_due)],
                    ['validUntil',  day(blob.validUntil),  day(row.valid_until)],
                    ['chasingDate', day(blob.chasingDate), day(row.chasing_date)],
                    ['status',      blob.status || '',     row.status || ''],
                    ['revision',    blob.revision || '',   row.revision || ''],
                    ['company',     (blob.company || '').trim(), (row.company || '').trim()]
                ];
                for (const [field, b, c] of pairs) {
                    if ((b || c) && b !== c) {
                        findings.push({ reference: row.reference, field, blob: b || '(empty)', column: c || '(empty)' });
                    }
                }
            }
            return findings;
        }));

        // ── C2 (F4) — refs held by ghost rows (deleted / NULL status) ──────
        checks.push(await runCheck('ghost-refs', 'F4',
            'Quote numbers held by deleted or NULL-status rows', async () => {
            const r = await query(`
                SELECT reference,
                       CASE WHEN status IS NULL THEN '(NULL status)' ELSE status END AS held_by,
                       'QuoteBuilderQuotes' AS in_table
                  FROM QuoteBuilderQuotes
                 WHERE reference LIKE @refPat
                   AND (status = 'deleted' OR status IS NULL)
                 ORDER BY reference`, { refPat });
            return r.recordset;
        }));

        // ── C3 (F4) — refs that exist ONLY in Tenders/TenderRegister ───────
        checks.push(await runCheck('tender-only-refs', 'F4',
            'Refs in Tenders/TenderRegister with no live QB quote (can block numbering)', async () => {
            const r = await query(`
                SELECT t.reference, t.in_table
                  FROM (
                    SELECT reference, 'Tenders' AS in_table FROM Tenders
                     WHERE reference LIKE @refPat
                    UNION ALL
                    SELECT reference, 'TenderRegister' FROM TenderRegister
                     WHERE reference LIKE @refPat AND ISNULL(status,'') != 'Deleted'
                  ) t
                 WHERE NOT EXISTS (
                    SELECT 1 FROM QuoteBuilderQuotes q
                     WHERE q.reference = t.reference AND ISNULL(q.status,'') != 'deleted')
                 ORDER BY t.reference`, { refPat });
            return r.recordset;
        }));

        // ── C4 (F1) — projects showing the qty=1 seeded-hours pattern ──────
        checks.push(await runCheck('seeded-hours-pattern', 'F1',
            'Won quotes whose labour lines are all quantity=1 (Hours Scheduled meaningless)', async () => {
            const r = await query(`
                SELECT q.reference, COUNT(*) AS labour_lines
                  FROM QuoteLineItems li
                  JOIN QuoteBuilderQuotes q ON q.id = li.qb_quote_id
                 WHERE li.is_labour = 1
                 GROUP BY q.reference
                HAVING SUM(CASE WHEN li.quantity <> 1 OR li.labour_hours IS NOT NULL
                                THEN 1 ELSE 0 END) = 0
                ORDER BY q.reference`);
            return r.recordset;
        }));

        // ── C5 (F1) — labour lines hand-fixed into the contract-value trap ─
        checks.push(await runCheck('hours-in-quantity', 'F1',
            'Labour lines with quantity>1 AND a unit price (contract value inflated by qty x price)', async () => {
            const r = await query(`
                SELECT q.reference, li.category, li.quantity, li.unit_price,
                       CAST(li.quantity * li.unit_price AS decimal(18,2)) AS line_value
                  FROM QuoteLineItems li
                  JOIN QuoteBuilderQuotes q ON q.id = li.qb_quote_id
                 WHERE li.is_labour = 1 AND li.quantity > 1 AND li.unit_price > 0
                 ORDER BY li.quantity * li.unit_price DESC`);
            return r.recordset;
        }));

        // ── C6 — line-item sum vs quote total (reconciliation) ─────────────
        checks.push(await runCheck('lines-vs-total', 'F1/F7',
            'Quotes where line items do not sum to total_ex_vat (tolerance £1)', async () => {
            const r = await query(`
                SELECT q.reference, q.total_ex_vat,
                       CAST(SUM(li.quantity * li.unit_price) AS decimal(18,2)) AS line_sum
                  FROM QuoteBuilderQuotes q
                  JOIN QuoteLineItems li ON li.qb_quote_id = q.id
                 WHERE q.reference LIKE @refPat
                   AND ISNULL(q.status,'') != 'deleted'
                   AND q.total_ex_vat IS NOT NULL
                 GROUP BY q.reference, q.total_ex_vat
                HAVING ABS(SUM(li.quantity * li.unit_price) - q.total_ex_vat) > 1
                ORDER BY ABS(SUM(li.quantity * li.unit_price) - q.total_ex_vat) DESC`,
                { refPat });
            return r.recordset;
        }));

        // ── C7 — orphaned rows ──────────────────────────────────────────────
        checks.push(await runCheck('orphans', 'F9',
            'Orphaned rows (line items / project links pointing at missing parents)', async () => {
            const out = [];
            const a = await query(`
                SELECT 'QuoteLineItems -> missing quote' AS kind, COUNT(*) AS n
                  FROM QuoteLineItems li
                 WHERE li.qb_quote_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM QuoteBuilderQuotes q WHERE q.id = li.qb_quote_id)`);
            if (a.recordset[0].n > 0) out.push(a.recordset[0]);
            const b = await query(`
                SELECT 'ProjectQuotes -> missing project' AS kind, COUNT(*) AS n
                  FROM ProjectQuotes pq
                 WHERE NOT EXISTS (SELECT 1 FROM Projects p WHERE p.id = pq.project_id)`);
            if (b.recordset[0].n > 0) out.push(b.recordset[0]);
            const c = await query(`
                SELECT 'ProjectQuotes -> missing quote' AS kind, COUNT(*) AS n
                  FROM ProjectQuotes pq
                 WHERE pq.qb_quote_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM QuoteBuilderQuotes q WHERE q.id = pq.qb_quote_id)`);
            if (c.recordset[0].n > 0) out.push(c.recordset[0]);
            const d = await query(`
                SELECT 'Projects.source_quote_id -> missing quote' AS kind, COUNT(*) AS n
                  FROM Projects p
                 WHERE p.source_quote_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM QuoteBuilderQuotes q WHERE q.id = p.source_quote_id)`);
            if (d.recordset[0].n > 0) out.push(d.recordset[0]);
            return out;
        }));

        // ── C8 — won quotes with no project link ───────────────────────────
        checks.push(await runCheck('won-without-project', 'F1/F7',
            'Won quotes with no linked project (Won -> Project flow incomplete)', async () => {
            const r = await query(`
                SELECT reference, company, total_ex_vat
                  FROM QuoteBuilderQuotes q
                 WHERE q.status = 'won'
                   AND q.project_id IS NULL
                   AND NOT EXISTS (SELECT 1 FROM ProjectQuotes pq WHERE pq.qb_quote_id = q.id)
                 ORDER BY reference`);
            return r.recordset;
        }));

        // ── C9 (F7) — projects with multiple attached quotes (double-count review) ──
        checks.push(await runCheck('multi-quote-projects', 'F7',
            'Projects with 2+ attached quotes — review for contract double-counting', async () => {
            const r = await query(`
                SELECT p.project_number, p.project_name, COUNT(*) AS quotes_attached
                  FROM ProjectQuotes pq
                  JOIN Projects p ON p.id = pq.project_id
                 GROUP BY p.project_number, p.project_name
                HAVING COUNT(*) > 1
                ORDER BY COUNT(*) DESC`);
            return r.recordset;
        }));

        // ── C10 — invoices/applications chain sanity (light) ───────────────
        checks.push(await runCheck('afp-invoice-links', 'F7',
            'Certified applications with no linked invoice (may be intentional — review)', async () => {
            const r = await query(`
                SELECT a.id, a.ref AS afp_ref, a.status,
                       CONVERT(varchar(10), a.certificate_date, 23) AS cert_date
                  FROM Applications a
                 WHERE a.certificate_ref IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM Invoices i WHERE i.source_afp_id = a.id)
                 ORDER BY a.certificate_date DESC`);
            return r.recordset;
        }));

        const issues = checks.filter(c => c.status === 'issues').reduce((s, c) => s + c.count, 0);
        return ok({
            year,
            ran_at: new Date().toISOString(),
            total_findings: issues,
            checks
        }, request);
    }
});
