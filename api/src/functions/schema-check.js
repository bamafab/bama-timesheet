// ─────────────────────────────────────────────────────────────────────────────
// schema-check.js  (2026-07-30)
//
// "Have I run that migration?" answered by the database instead of by memory.
// Reads api/src/schema-manifest.json (generated from api/sql/*.sql by
// api/sql/build-manifest.py) and probes sys.tables / sys.columns for the
// tables and columns each script is supposed to create, plus the QmsForms
// seed rows. Read-only — it never creates or alters anything.
//
// Status per script:
//   applied     — everything it should create is present
//   partial     — some of it is present (script half-ran, or was superseded)
//   missing     — none of it is present ⇒ needs running
//   unverifiable— data-only script (backfill / import / constraint widening);
//                 nothing structural to look for, so it's listed for the eye
//   retired     — script only created tables retired with the legacy tender
//                 world (manifest kind='retired'); not required, never run it
//
// Route: GET /api/schema-check
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, serverError, preflight } = require('../responses');

let MANIFEST = null;
function manifest() {
    if (!MANIFEST) MANIFEST = require('../schema-manifest.json');
    return MANIFEST;
}

app.http('schema-check-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'schema-check',
    handler: async (req) => preflight(req)
});

app.http('schema-check', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'schema-check',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const [tablesRes, colsRes] = await Promise.all([
                query(`SELECT name FROM sys.tables`),
                query(`SELECT t.name AS tbl, c.name AS col
                       FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id`)
            ]);
            const tables = new Set(tablesRes.recordset.map(r => r.name.toLowerCase()));
            const cols = new Set(colsRes.recordset.map(r => (r.tbl + '.' + r.col).toLowerCase()));

            // QMS seed rows — only if the table exists at all.
            let forms = new Set();
            if (tables.has('qmsforms')) {
                try {
                    const f = await query(`SELECT form_code FROM QmsForms`);
                    forms = new Set(f.recordset.map(r => String(r.form_code).trim().toLowerCase()));
                } catch (e) { context.warn('QmsForms read failed: ' + e.message); }
            }

            const migrations = manifest().migrations.map(m => {
                const checks = [];
                (m.tables || []).forEach(t =>
                    checks.push({ kind: 'table', label: t, present: tables.has(t.toLowerCase()) }));
                (m.columns || []).forEach(c =>
                    checks.push({
                        kind: 'column', label: c.table + '.' + c.column,
                        // A column on a table that doesn't exist yet is missing, not an error.
                        present: cols.has((c.table + '.' + c.column).toLowerCase())
                    }));
                (m.seedForms || []).forEach(code =>
                    checks.push({ kind: 'seed', label: code, present: forms.has(String(code).trim().toLowerCase()) }));

                let status;
                if (m.kind === 'retired') status = 'retired';
                else if (m.kind === 'manual' || !checks.length) status = 'unverifiable';
                else {
                    const have = checks.filter(c => c.present).length;
                    status = have === checks.length ? 'applied' : have === 0 ? 'missing' : 'partial';
                }
                return {
                    script: m.script, title: m.title, kind: m.kind, status,
                    retired: m.retired || [], retired_note: m.retired_note || null,
                    checks,
                    missing: checks.filter(c => !c.present).map(c => c.label)
                };
            });

            const counts = migrations.reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a; }, {});
            return ok({
                checked_at: new Date().toISOString(),
                table_count: tables.size,
                counts,
                migrations
            }, request);
        } catch (err) {
            context.error('schema-check error:', err);
            return serverError('Failed to inspect the database schema', request);
        }
    }
});
