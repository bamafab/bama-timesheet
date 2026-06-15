// ─────────────────────────────────────────────────────────────────────────────
// tender-register.js
//
// REST endpoints for the Tender Register module.
//
// Routes:
//   GET    /api/tender-register              — list (filter: status, assigned_to, year)
//   POST   /api/tender-register              — create new tender
//   GET    /api/tender-register/:id          — single tender
//   PUT    /api/tender-register/:id          — update tender
//   PUT    /api/tender-register/:id/open-in-qb — create QB quote + link
//   GET    /api/tender-assignees             — list assignees
//   POST   /api/tender-assignees             — add assignee (admin)
//   GET    /api/tender-sp/:id               — get/create SharePoint folder
// ─────────────────────────────────────────────────────────────────────────────

const { app }      = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query }    = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

const SP_DRIVE_ID = 'b!CxTKk9lEwkyweUqAo3CRas-huywW4KtLqOk2tNzmx-P7CX86DNhTQo14pLuU_tZu';
const GRAPH_BASE  = 'https://graph.microsoft.com/v1.0';

// ── OPTIONS preflights ────────────────────────────────────────────────────────
app.http('tender-register-preflight', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'tender-register/{*path}',
    handler: async (req) => preflight(req)
});
app.http('tender-assignees-preflight', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'tender-assignees/{*path}',
    handler: async (req) => preflight(req)
});
app.http('tender-sp-preflight', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'tender-sp/{*path}',
    handler: async (req) => preflight(req)
});

// ── SharePoint helpers ────────────────────────────────────────────────────────

async function spFetch(token, path, opts = {}) {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
        ...opts,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        }
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.error?.message || `SP ${res.status}`), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
}

// Get child folder by name under a parent item ID
async function spFindChild(token, parentId, name) {
    try {
        const data = await spFetch(token,
            `/drives/${SP_DRIVE_ID}/items/${parentId}/children?$select=id,name,webUrl&$top=200`
        );
        return (data.value || []).find(i => i.name.toLowerCase() === name.toLowerCase()) || null;
    } catch { return null; }
}

// Get root "Quotation" folder ID
async function spGetQuotationRoot(token) {
    const data = await spFetch(token,
        `/drives/${SP_DRIVE_ID}/root:/Quotation?$select=id,name,webUrl`
    );
    return data;
}

// Create folder under parent
async function spCreateFolder(token, parentId, name) {
    return spFetch(token, `/drives/${SP_DRIVE_ID}/items/${parentId}/children`, {
        method: 'POST',
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
    });
}

// Ensure year folder exists e.g. "06 - 2026"
async function spEnsureYearFolder(token) {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yearFolderName = `${mm} - ${yyyy}`;

    const root = await spGetQuotationRoot(token);
    let yearFolder = await spFindChild(token, root.id, yearFolderName);
    if (!yearFolder) {
        yearFolder = await spCreateFolder(token, root.id, yearFolderName);
    }
    return yearFolder;
}

// Main: find or create tender folder structure
// Returns { yearFolderId, tenderFolderId, subFolderId, folderUrl }
async function spEnsureTenderFolder(token, reference, client, project) {
    const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60);
    const tenderFolderName = `${reference} - ${safeName(client)} - ${safeName(project)}`;
    const subFolderName    = '00 - Tender';

    const yearFolder = await spEnsureYearFolder(token);

    // Check if tender folder already exists
    let tenderFolder = await spFindChild(token, yearFolder.id, tenderFolderName);
    let alreadyExisted = !!tenderFolder;

    if (!tenderFolder) {
        tenderFolder = await spCreateFolder(token, yearFolder.id, tenderFolderName);
    }

    // Ensure 00 - Tender subfolder
    let subFolder = await spFindChild(token, tenderFolder.id, subFolderName);
    if (!subFolder) {
        subFolder = await spCreateFolder(token, tenderFolder.id, subFolderName);
    }

    return {
        yearFolderId:   yearFolder.id,
        tenderFolderId: tenderFolder.id,
        subFolderId:    subFolder.id,
        folderUrl:      tenderFolder.webUrl,
        alreadyExisted
    };
}

// Send email notification via Graph
async function sendEmailNotification(token, { reference, client, project, assignedTo, deadline, createdBy, assigneeEmail, mateuszEmail }) {
    const recipients = [{ emailAddress: { address: mateuszEmail } }];
    if (assigneeEmail && assigneeEmail.toLowerCase() !== mateuszEmail.toLowerCase()) {
        recipients.push({ emailAddress: { address: assigneeEmail } });
    }

    const deadlineStr = deadline ? new Date(deadline).toLocaleDateString('en-GB') : 'Not set';
    const subject = `New Tender Registered: ${reference} — ${client}`;
    const body = `
<p>A new tender has been registered in the BAMA ERP system.</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Reference:</td><td><strong>${reference}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Client:</td><td>${client}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Project:</td><td>${project}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Assigned To:</td><td>${assignedTo}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Deadline:</td><td>${deadlineStr}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Registered By:</td><td>${createdBy}</td></tr>
</table>
<p style="margin-top:16px"><a href="https://proud-dune-0dee63110.2.azurestaticapps.net/dashboard.html" style="background:#ff6b00;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none">Open Estimating Dashboard</a></p>
    `.trim();

    try {
        await spFetch(token, `/users/${mateuszEmail}/sendMail`, {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    subject,
                    body: { contentType: 'HTML', content: body },
                    toRecipients: recipients
                },
                saveToSentItems: false
            })
        });
    } catch (e) {
        console.warn('Email notification failed:', e.message);
        // Non-fatal — don't block tender creation
    }
}

// ── GET /api/tender-register ──────────────────────────────────────────────────
app.http('tender-register-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'tender-register',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        const url    = new URL(req.url);
        const status = url.searchParams.get('status');
        const assigned = url.searchParams.get('assigned_to');
        const year   = url.searchParams.get('year') || String(new Date().getFullYear()).slice(-2);

        let sql = `
            SELECT id, reference, client, project,
                   contact_name, contact_email, contact_phone, contact_job_title, contact_skipped,
                   assigned_to, deadline, date_received, status, no_bid_reason,
                   sp_tender_folder_id, sp_subfolder_id, sp_folder_url,
                   qb_quote_id, opened_in_qb_at, opened_in_qb_by,
                   notes, created_by, created_at, updated_at
              FROM TenderRegister
             WHERE reference LIKE @yearPat
        `;
        const params = { yearPat: `Q${year}%` };

        if (status && status !== 'all') {
            sql += ` AND status = @status`;
            params.status = status;
        }
        if (assigned) {
            sql += ` AND assigned_to = @assigned`;
            params.assigned = assigned;
        }
        sql += ` AND status != 'Deleted'`;
        sql += ` ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, created_at DESC`;

        try {
            const rows = (await query(sql, params)).recordset;
            return ok(rows, req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});

// ── POST /api/tender-register ─────────────────────────────────────────────────
app.http('tender-register-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'tender-register',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        let body;
        try { body = await req.json(); } catch { return badRequest('Invalid JSON', req); }

        const { reference, client, project, contact_name, contact_email, contact_phone,
                contact_job_title, contact_skipped, assigned_to, deadline, date_received,
                notes, sp_token } = body;

        if (!reference) return badRequest('reference required', req);
        if (!client)    return badRequest('client required', req);
        if (!project)   return badRequest('project required', req);

        try {
            // Insert tender record
            const result = (await query(`
                INSERT INTO TenderRegister
                    (reference, client, project,
                     contact_name, contact_email, contact_phone, contact_job_title, contact_skipped,
                     assigned_to, deadline, date_received, status, notes, created_by)
                OUTPUT INSERTED.id
                VALUES
                    (@reference, @client, @project,
                     @contact_name, @contact_email, @contact_phone, @contact_job_title, @contact_skipped,
                     @assigned_to, @deadline, @date_received, 'New', @notes, @created_by)
            `, {
                reference, client, project,
                contact_name:      contact_name      || '',
                contact_email:     contact_email     || '',
                contact_phone:     contact_phone     || '',
                contact_job_title: contact_job_title || '',
                contact_skipped:   contact_skipped   ? 1 : 0,
                assigned_to:       assigned_to       || '',
                deadline:          deadline           || null,
                date_received:     date_received      || new Date().toISOString().slice(0, 10),
                notes:             notes              || '',
                created_by:        auth.name          || auth.email || ''
            })).recordset;

            const tenderId = result[0]?.id;

            // Auto-create SharePoint folder in background (non-fatal)
            let spResult = null;
            if (sp_token) {
                try {
                    spResult = await spEnsureTenderFolder(sp_token, reference, client, project);
                    await query(`
                        UPDATE TenderRegister SET
                            sp_year_folder_id   = @yearId,
                            sp_tender_folder_id = @tenderId,
                            sp_subfolder_id     = @subId,
                            sp_folder_url       = @url,
                            updated_at          = GETUTCDATE()
                        WHERE id = @id
                    `, {
                        yearId:   spResult.yearFolderId,
                        tenderId: spResult.tenderFolderId,
                        subId:    spResult.subFolderId,
                        url:      spResult.folderUrl,
                        id:       tenderId
                    });
                } catch (spErr) {
                    console.warn('SharePoint folder creation failed:', spErr.message);
                }
            }

            // Send email notification
            if (sp_token) {
                try {
                    // Get assignee email
                    const assignees = (await query(
                        `SELECT email FROM TenderAssignees WHERE full_name = @name AND active = 1`,
                        { name: assigned_to || '' }
                    )).recordset;
                    await sendEmailNotification(sp_token, {
                        reference, client, project,
                        assignedTo:    assigned_to || '',
                        deadline,
                        createdBy:     auth.name || auth.email || '',
                        assigneeEmail: assignees[0]?.email || '',
                        mateuszEmail:  'matt@bamafabrication.co.uk'
                    });
                } catch (mailErr) {
                    console.warn('Email failed:', mailErr.message);
                }
            }

            return created({ id: tenderId, spFolder: spResult }, req);
        } catch (e) {
            if (e.message?.includes('UX_TenderRegister_Reference')) {
                return badRequest(`Reference ${reference} already exists`, req);
            }
            return serverError(e.message, req);
        }
    }
});

// ── GET /api/tender-register/:id ─────────────────────────────────────────────
app.http('tender-register-get', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'tender-register/{id}',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        const id = parseInt(req.params.id);
        if (!id) return badRequest('invalid id', req);

        try {
            const rows = (await query(
                `SELECT * FROM TenderRegister WHERE id = @id`, { id }
            )).recordset;
            const rowset = rows.recordset || rows;
            if (!rowset.length) return notFound('Tender not found', req);
            return ok(rowset[0], req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});

// ── PUT /api/tender-register/:id ─────────────────────────────────────────────
app.http('tender-register-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'tender-register/{id}',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        const id = parseInt(req.params.id);
        if (!id) return badRequest('invalid id', req);

        let body;
        try { body = await req.json(); } catch { return badRequest('Invalid JSON', req); }

        try {
            await query(`
                UPDATE TenderRegister SET
                    client            = @client,
                    project           = @project,
                    contact_name      = @contact_name,
                    contact_email     = @contact_email,
                    contact_phone     = @contact_phone,
                    contact_job_title = @contact_job_title,
                    contact_skipped   = @contact_skipped,
                    assigned_to       = @assigned_to,
                    deadline          = @deadline,
                    status            = @status,
                    no_bid_reason     = @no_bid_reason,
                    notes             = @notes,
                    updated_at        = GETUTCDATE()
                WHERE id = @id
            `, {
                id,
                client:            body.client            || '',
                project:           body.project           || '',
                contact_name:      body.contact_name      || '',
                contact_email:     body.contact_email     || '',
                contact_phone:     body.contact_phone     || '',
                contact_job_title: body.contact_job_title || '',
                contact_skipped:   body.contact_skipped   ? 1 : 0,
                assigned_to:       body.assigned_to       || '',
                deadline:          body.deadline          || null,
                status:            body.status            || 'New',
                no_bid_reason:     body.no_bid_reason     || '',
                notes:             body.notes             || ''
            });
            return ok({ updated: true }, req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});

// ── PUT /api/tender-register/:id/open-in-qb ──────────────────────────────────
app.http('tender-register-open-in-qb', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'tender-register/{id}/open-in-qb',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        const id = parseInt(req.params.id);
        if (!id) return badRequest('invalid id', req);

        let body;
        try { body = await req.json(); } catch { return badRequest('Invalid JSON', req); }

        const { qb_quote_id } = body;
        if (!qb_quote_id) return badRequest('qb_quote_id required', req);

        try {
            await query(`
                UPDATE TenderRegister SET
                    status          = 'In QB',
                    qb_quote_id     = @qbId,
                    opened_in_qb_at = GETUTCDATE(),
                    opened_in_qb_by = @by,
                    updated_at      = GETUTCDATE()
                WHERE id = @id
            `, { id, qbId: qb_quote_id, by: auth.name || auth.email || '' });

            return ok({ updated: true }, req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});

// ── GET /api/tender-sp/:id — find/create SP folder for existing tender ────────
app.http('tender-sp-sync', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'tender-sp/{id}',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        const id = parseInt(req.params.id);
        if (!id) return badRequest('invalid id', req);

        let body;
        try { body = await req.json(); } catch { return badRequest('Invalid JSON', req); }
        const { sp_token } = body;
        if (!sp_token) return badRequest('sp_token required', req);

        try {
            const rows = (await query(
                `SELECT reference, client, project, sp_tender_folder_id FROM TenderRegister WHERE id = @id`,
                { id }
            )).recordset;
            if (!rows.length) return notFound('Tender not found', req);

            const t = rows[0];

            // If we already have folder ID, verify it still exists
            if (t.sp_tender_folder_id) {
                try {
                    const folder = await spFetch(sp_token,
                        `/drives/${SP_DRIVE_ID}/items/${t.sp_tender_folder_id}?$select=id,name,webUrl`
                    );
                    return ok({ exists: true, folderId: folder.id, folderUrl: folder.webUrl, alreadyExisted: true }, req);
                } catch {
                    // Folder ID no longer valid — fall through to recreate
                }
            }

            // Find or create
            const spResult = await spEnsureTenderFolder(sp_token, t.reference, t.client, t.project);

            await query(`
                UPDATE TenderRegister SET
                    sp_year_folder_id   = @yearId,
                    sp_tender_folder_id = @tenderId,
                    sp_subfolder_id     = @subId,
                    sp_folder_url       = @url,
                    updated_at          = GETUTCDATE()
                WHERE id = @id
            `, {
                yearId:   spResult.yearFolderId,
                tenderId: spResult.tenderFolderId,
                subId:    spResult.subFolderId,
                url:      spResult.folderUrl,
                id
            });

            return ok({ ...spResult, exists: true }, req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});

// ── GET /api/tender-assignees ─────────────────────────────────────────────────
app.http('tender-assignees-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'tender-assignees',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        try {
            const rows = (await query(
                `SELECT id, full_name, email, active FROM TenderAssignees WHERE active = 1 ORDER BY sort_order, full_name`
            )).recordset;
            return ok(rows, req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});

// ── POST /api/tender-assignees ────────────────────────────────────────────────
app.http('tender-assignees-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'tender-assignees',
    handler: async (req) => {
        const auth = await requireAuth(req);
        if (auth.status) return auth;

        let body;
        try { body = await req.json(); } catch { return badRequest('Invalid JSON', req); }

        const { full_name, email } = body;
        if (!full_name) return badRequest('full_name required', req);

        try {
            const result = (await query(`
                INSERT INTO TenderAssignees (full_name, email)
                OUTPUT INSERTED.id
                VALUES (@name, @email)
            `, { name: full_name, email: email || '' })).recordset;

            return created({ id: result[0]?.id }, req);
        } catch (e) {
            return serverError(e.message, req);
        }
    }
});
