// qms-forms.js (D4 — QMS digital check sheets, 2026-07-30)
// Data-driven form engine: definitions in QmsForms (JSON), filled sheets in
// QmsSubmissions. Frontend renders forms from the definition, generates the
// PDF natively and uploads to SharePoint, then registers the submission here.
// New sheets = INSERT a QmsForms row — no code changes.
const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { logChange } = require('../changelog');
const { ok, created, badRequest, serverError, preflight } = require('../responses');

app.http('qms-forms-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous', route: 'qms-forms/{*rest}',
    handler: async (req) => preflight(req)
});
app.http('qms-submissions-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous', route: 'qms-submissions/{*rest}',
    handler: async (req) => preflight(req)
});

app.http('qms-forms-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'qms-forms',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const res = await query(`SELECT id, form_code, title, definition, version FROM QmsForms WHERE is_active = 1 ORDER BY form_code`);
            return ok(res.recordset, request);
        } catch (err) { context.error(err); return serverError('Failed to load QMS forms', request); }
    }
});

app.http('qms-submissions-list', {
    methods: ['GET'], authLevel: 'anonymous', route: 'qms-submissions',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const code = new URL(request.url).searchParams.get('form_code');
            const params = {};
            let where = 'is_deleted = 0';
            if (code) { where += ' AND form_code = @code'; params.code = code; }
            const res = await query(
                `SELECT TOP 200 id, form_id, form_code, answers, submitted_by, file_name, web_url, created_at
                 FROM QmsSubmissions WHERE ${where} ORDER BY created_at DESC`, params);
            return ok(res.recordset, request);
        } catch (err) { context.error(err); return serverError('Failed to load submissions', request); }
    }
});

app.http('qms-submissions-create', {
    methods: ['POST'], authLevel: 'anonymous', route: 'qms-submissions',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const b = await request.json();
            if (!b.form_id || !b.form_code || !b.answers) return badRequest('form_id, form_code and answers are required', request);
            const res = await query(
                `INSERT INTO QmsSubmissions (form_id, form_code, answers, submitted_by, file_name, sharepoint_file_id, web_url)
                 OUTPUT INSERTED.id
                 VALUES (@form_id, @form_code, @answers, @by, @file_name, @sp_id, @web_url)`,
                {
                    form_id: parseInt(b.form_id), form_code: String(b.form_code).slice(0, 40),
                    answers: JSON.stringify(b.answers).slice(0, 100000),
                    by: auth.name || auth.email || null,
                    file_name: b.file_name || null, sp_id: b.sharepoint_file_id || null, web_url: b.web_url || null
                });
            const id = res.recordset[0].id;
            await logChange('qms_submission', id, b.form_code, 'submitted', null, b.file_name || 'submitted', auth.name || auth.email);
            return created({ id }, request);
        } catch (err) { context.error(err); return serverError('Failed to save submission', request); }
    }
});
