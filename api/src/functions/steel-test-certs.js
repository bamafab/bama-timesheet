// ─────────────────────────────────────────────────────────────────────────────
// steel-test-certs.js  (Material traceability rework, 2026-07-31)
//
// The mill 3.1 test certificate is the heat-number source for EN 1090
// traceability — replacing the hand-keyed MAT 001 form (the DN already proves
// receipt). Drag the cert PDF onto the job, Claude reads the heat lines, the
// file is filed to SharePoint, and each heat line lands in the EXISTING
// AssemblyHeatAllocations table (linked to the cert) so the CoC / DoP /
// Traceability chain downstream is unchanged.
//
// Routes:
//   GET    /api/steel-test-certs        — ?job_id= (DrawingJobs.id) or ?project_number=
//   POST   /api/steel-test-certs        — { job_id, cert meta, heats:[{section,grade,qty,heat_no}] }
//   DELETE /api/steel-test-certs/{id}   — soft delete (also soft-deletes its heat lines)
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const CERT_COLS = `id, job_id, project_number, cert_no, supplier, po_number, cert_date,
    standard, heat_count, file_name, sharepoint_file_id, web_url, notes, created_by, created_at`;

app.http('steel-test-certs-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'steel-test-certs/{*rest}', handler: async (req) => preflight(req)
});

app.http('steel-test-certs-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'steel-test-certs',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const sp = new URL(request.url).searchParams;
            const jobId = parseInt(sp.get('job_id'));
            const proj = sp.get('project_number');
            const params = {}; let where = 'is_deleted = 0';
            if (Number.isFinite(jobId)) { where += ' AND job_id = @jid'; params.jid = jobId; }
            if (proj)                   { where += ' AND project_number = @pn'; params.pn = proj; }
            const res = await query(
                `SELECT ${CERT_COLS} FROM SteelTestCerts WHERE ${where}
                 ORDER BY created_at DESC`, params);
            return ok(res.recordset, request);
        } catch (err) {
            context.error('steel-test-certs list error:', err);
            return serverError('Failed to load steel test certs', request);
        }
    }
});

app.http('steel-test-certs-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'steel-test-certs',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            const jobId = parseInt(b.job_id);
            if (!Number.isFinite(jobId)) return badRequest('job_id (DrawingJobs.id) is required', request);
            const heats = Array.isArray(b.heats) ? b.heats.filter(h => h && String(h.heat_no || '').trim()) : [];
            const by = auth.name || auth.email || b.created_by || null;

            // 1) Insert the cert row
            const certRes = await query(
                `INSERT INTO SteelTestCerts
                   (job_id, project_number, cert_no, supplier, po_number, cert_date, standard,
                    heat_count, file_name, sharepoint_file_id, web_url, notes, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@jid, @pn, @cno, @sup, @po, @cdate, @std, @hc, @fn, @spid, @url, @notes, @by)`,
                {
                    jid: jobId,
                    pn: b.project_number || null,
                    cno: b.cert_no || null,
                    sup: b.supplier || null,
                    po: b.po_number || null,
                    cdate: b.cert_date || null,
                    std: b.standard || null,
                    hc: heats.length,
                    fn: b.file_name || null,
                    spid: b.sharepoint_file_id || null,
                    url: b.web_url || null,
                    notes: b.notes || null,
                    by
                });
            const certId = certRes.recordset[0].id;

            // 2) Insert each heat line into the existing allocations table,
            //    contract-level (assembly_id null) — allocate to assemblies later.
            for (const h of heats) {
                await query(
                    `INSERT INTO AssemblyHeatAllocations
                       (job_id, assembly_id, assembly_mark, heat_no, section, grade, supplier,
                        po_number, steel_cert_id, qty, notes, created_by)
                     VALUES (@jid, NULL, NULL, @heat, @sec, @grade, @sup, @po, @cid, @qty, @notes, @by)`,
                    {
                        jid: jobId,
                        heat: String(h.heat_no).trim().slice(0, 100),
                        sec: h.section || null, grade: h.grade || null,
                        sup: b.supplier || h.supplier || null,
                        po: b.po_number || h.po_number || null,
                        cid: certId, qty: h.qty != null ? String(h.qty) : null,
                        notes: h.notes || null, by
                    });
            }
            return created({ id: certId, heat_count: heats.length }, request);
        } catch (err) {
            context.error('steel-test-certs create error:', err);
            return serverError('Failed to save steel test cert: ' + err.message, request);
        }
    }
});

app.http('steel-test-certs-delete', {
    methods: ['DELETE'], authLevel: 'anonymous', route: 'steel-test-certs/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            if (!Number.isFinite(id)) return badRequest('Invalid cert id', request);
            const cur = await query('SELECT id FROM SteelTestCerts WHERE id = @id AND is_deleted = 0', { id });
            if (!cur.recordset.length) return notFound('Cert not found', request);
            // Soft-delete the cert AND the heat lines it created, so the
            // traceability chain drops them together.
            await query('UPDATE SteelTestCerts SET is_deleted = 1 WHERE id = @id', { id });
            await query('UPDATE AssemblyHeatAllocations SET is_deleted = 1 WHERE steel_cert_id = @id', { id });
            return ok({ id, deleted: true }, request);
        } catch (err) {
            context.error('steel-test-certs delete error:', err);
            return serverError('Failed to delete steel test cert', request);
        }
    }
});
