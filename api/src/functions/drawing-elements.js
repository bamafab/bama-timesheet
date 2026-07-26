const { app } = require('@azure/functions');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// OPTIONS preflight
app.http('drawing-elements-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous', route: 'drawing-elements/{*rest}',
    handler: (req) => preflight(req)
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drawing-elements/:jobId
// Returns all element data for a job: approval revisions + files, element
// files (parts/site), element notes, site completion.
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-get', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const jobId = parseInt(request.params.jobId);
        if (!jobId) return badRequest('Invalid jobId', request);

        try {
            const [revRows, revFileRows, elemFileRows, noteRows, siteRow] = await Promise.all([
                query('SELECT * FROM DrawingApprovalRevisions WHERE job_id = @jobId AND is_deleted = 0 ORDER BY revision_type, revision_number', { jobId }),
                query(`SELECT f.* FROM DrawingRevisionFiles f
                       JOIN DrawingApprovalRevisions r ON r.id = f.revision_id
                       WHERE r.job_id = @jobId AND r.is_deleted = 0 ORDER BY f.uploaded_at`, { jobId }),
                query('SELECT * FROM DrawingElementFiles WHERE job_id = @jobId ORDER BY uploaded_at', { jobId }),
                query('SELECT * FROM DrawingElementNotes WHERE job_id = @jobId ORDER BY created_at', { jobId }),
                query('SELECT * FROM DrawingJobSite WHERE job_id = @jobId', { jobId })
            ]);

            // Group revision files under their revision
            const filesByRevision = {};
            for (const f of revFileRows.recordset) {
                if (!filesByRevision[f.revision_id]) filesByRevision[f.revision_id] = [];
                filesByRevision[f.revision_id].push(f);
            }

            const revisions = revRows.recordset.map(r => ({
                id: r.id,
                type: r.revision_type,
                number: r.revision_number,
                constructionNumber: r.construction_number,
                status: r.status,
                statusUpdatedAt: r.status_updated_at,
                isDeleted: !!r.is_deleted,
                uploadedAt: r.uploaded_at,
                uploadedBy: r.uploaded_by,
                files: (filesByRevision[r.id] || []).map(f => ({
                    id: f.id,
                    blobId: f.blob_id,
                    name: f.display_name,
                    fileName: f.file_name,
                    fileId: f.sharepoint_file_id,
                    driveId: f.sharepoint_drive_id,
                    webUrl: f.web_url,
                    uploadedAt: f.uploaded_at
                }))
            }));

            // Group element files by context
            const filesByContext = {};
            for (const f of elemFileRows.recordset) {
                if (!filesByContext[f.context]) filesByContext[f.context] = [];
                filesByContext[f.context].push({
                    id: f.id,
                    blobId: f.blob_id,
                    name: f.display_name,
                    fileName: f.file_name,
                    fileId: f.sharepoint_file_id,
                    driveId: f.sharepoint_drive_id,
                    webUrl: f.web_url,
                    uploadedAt: f.uploaded_at,
                    uploadedBy: f.uploaded_by
                });
            }

            // Group notes by context
            const notesByContext = {};
            for (const n of noteRows.recordset) {
                if (!notesByContext[n.context]) notesByContext[n.context] = [];
                notesByContext[n.context].push({
                    id: n.id,
                    type: n.note_type,
                    author: n.author,
                    text: n.note_text,
                    timestamp: n.created_at
                });
            }

            const site = siteRow.recordset[0];

            return ok({
                revisions,
                files: filesByContext,
                notes: notesByContext,
                site: site ? { completedAt: site.completed_at, completedBy: site.completed_by } : null
            }, request);
        } catch (err) {
            context.error('drawing-elements-get error:', err);
            return serverError('Failed to load drawing elements', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/drawing-elements/:jobId/approval-revision
// Create a new approval revision (PO or CO) with files.
// Body: { type, status, uploadedBy, files: [{name,fileName,fileId,driveId,webUrl,uploadedAt}] }
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-revision-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/approval-revision',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const jobId = parseInt(request.params.jobId);
        if (!jobId) return badRequest('Invalid jobId', request);

        let body;
        try { body = await request.json(); } catch { return badRequest('Invalid JSON', request); }

        const { type, uploadedBy, files = [] } = body;
        if (!type || !['PO','CO'].includes(type)) return badRequest('type must be PO or CO', request);

        try {
            // Numbering reflects the LIVE revisions only: next number = highest
            // non-deleted revision_number of this type + 1 (0 → 1 when none).
            // Deleted rows are never counted, so deleting always frees a number.
            const numRes = await query(
                'SELECT ISNULL(MAX(revision_number), 0) AS mx FROM DrawingApprovalRevisions WHERE job_id = @jobId AND revision_type = @type AND is_deleted = 0',
                { jobId, type }
            );
            const num = (numRes.recordset[0].mx || 0) + 1;

            // Backstop against a concurrent double-submit landing the same number.
            const dupRes = await query(
                'SELECT TOP 1 id FROM DrawingApprovalRevisions WHERE job_id = @jobId AND revision_type = @type AND revision_number = @num AND is_deleted = 0',
                { jobId, type, num }
            );
            if (dupRes.recordset.length) {
                return badRequest(`Revision ${type === 'CO' ? 'C' : 'P'}${String(num).padStart(2,'0')} already exists — refresh and try again`, request);
            }

            // A fresh P (PO) revision is always "sent to engineer" — the review
            // outcome (approved / minor / major) is set later via the status
            // PATCH. A Construction (CO) upload is inherently the approved-for-
            // build issue, so it lands as 'approved' and gets the next live
            // construction_number.
            const effectiveStatus = type === 'CO' ? 'approved' : 'sent';

            let conNum = null;
            if (type === 'CO') {
                const maxRes = await query(
                    "SELECT ISNULL(MAX(construction_number), 0) AS mx FROM DrawingApprovalRevisions WHERE job_id = @jobId AND revision_type = 'CO' AND is_deleted = 0",
                    { jobId }
                );
                const liveC = maxRes.recordset[0].mx || 0;
                conNum = liveC + 1;
            }

            const revRes = await query(
                `INSERT INTO DrawingApprovalRevisions (job_id, revision_type, revision_number, status, uploaded_by, construction_number)
                 OUTPUT INSERTED.*
                 VALUES (@jobId, @type, @num, @status, @uploadedBy, @conNum)`,
                { jobId, type, num, status: effectiveStatus, uploadedBy: uploadedBy || null, conNum }
            );
            const rev = revRes.recordset[0];

            // Insert files
            const insertedFiles = [];
            for (const f of files) {
                const fRes = await query(
                    `INSERT INTO DrawingRevisionFiles (revision_id, blob_id, display_name, file_name, sharepoint_file_id, sharepoint_drive_id, web_url, uploaded_at)
                     OUTPUT INSERTED.*
                     VALUES (@revId, @blobId, @displayName, @fileName, @fileId, @driveId, @webUrl, @uploadedAt)`,
                    {
                        revId: rev.id,
                        blobId: f.blobId || f.id || null,
                        displayName: f.name || f.fileName || '',
                        fileName: f.fileName || f.name || '',
                        fileId: f.fileId || null,
                        driveId: f.driveId || null,
                        webUrl: f.webUrl || null,
                        uploadedAt: f.uploadedAt || new Date().toISOString()
                    }
                );
                insertedFiles.push(fRes.recordset[0]);
            }

            return created({
                id: rev.id,
                type: rev.revision_type,
                number: rev.revision_number,
                constructionNumber: rev.construction_number,
                status: rev.status,
                uploadedAt: rev.uploaded_at,
                files: insertedFiles.map(f => ({
                    id: f.id, name: f.display_name, fileName: f.file_name,
                    fileId: f.sharepoint_file_id, driveId: f.sharepoint_drive_id,
                    webUrl: f.web_url, uploadedAt: f.uploaded_at
                }))
            }, request);
        } catch (err) {
            context.error('revision-create error:', err);
            return serverError('Failed to create revision', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/drawing-elements/:jobId/approval-revision/:revId/status
// Update revision status (sent/approved/rejected).
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-revision-status', {
    methods: ['PATCH'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/approval-revision/{revId}/status',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const revId = parseInt(request.params.revId);
        if (!revId) return badRequest('Invalid revId', request);

        let body;
        try { body = await request.json(); } catch { return badRequest('Invalid JSON', request); }

        const { status } = body;
        // P-revision review outcomes: sent → approved (A) | minor (B) | major (C).
        // 'rejected' retained only so legacy rows remain patchable.
        if (!['sent','approved','minor','major','rejected'].includes(status)) return badRequest('Invalid status', request);

        try {
            const existing = await query(
                'SELECT job_id FROM DrawingApprovalRevisions WHERE id = @revId',
                { revId }
            );
            if (!existing.recordset.length) return notFound('Revision not found', request);

            // Construction numbers are assigned only when a Construction (CO)
            // revision is actually uploaded — never on P approval. So the status
            // PATCH just records the review outcome.
            const res = await query(
                `UPDATE DrawingApprovalRevisions SET status = @status, status_updated_at = SYSUTCDATETIME()
                 OUTPUT INSERTED.id, INSERTED.status, INSERTED.status_updated_at, INSERTED.construction_number
                 WHERE id = @revId`,
                { status, revId }
            );
            if (!res.recordset.length) return notFound('Revision not found', request);
            const out = res.recordset[0];
            return ok({
                id: out.id,
                status: out.status,
                status_updated_at: out.status_updated_at,
                constructionNumber: out.construction_number
            }, request);
        } catch (err) {
            context.error('revision-status error:', err);
            return serverError('Failed to update status', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/drawing-elements/:jobId/approval-revision/:revId
// Soft-delete a revision: it's hidden and no longer counts toward numbering, so
// its number is freed (delete the top revision → the next upload reuses it).
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-revision-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/approval-revision/{revId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const revId = parseInt(request.params.revId);
        if (!revId) return badRequest('Invalid revId', request);

        try {
            const res = await query(
                `UPDATE DrawingApprovalRevisions SET is_deleted = 1
                 OUTPUT INSERTED.id WHERE id = @revId`,
                { revId }
            );
            if (!res.recordset.length) return notFound('Revision not found', request);
            return ok({ id: res.recordset[0].id, deleted: true }, request);
        } catch (err) {
            context.error('revision-delete error:', err);
            return serverError('Failed to delete revision', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/drawing-elements/:jobId/file
// Add a file to a parts-sections / parts-plates / site context.
// Body: { context, name, fileName, fileId, driveId, webUrl, uploadedAt, uploadedBy }
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-file-add', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/file',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const jobId = parseInt(request.params.jobId);
        if (!jobId) return badRequest('Invalid jobId', request);

        let body;
        try { body = await request.json(); } catch { return badRequest('Invalid JSON', request); }

        const { fileContext, name, fileName, fileId, driveId, webUrl, uploadedAt, uploadedBy } = body;
        if (!fileContext || !['parts-sections','parts-plates','site','rams'].includes(fileContext))
            return badRequest('context must be parts-sections, parts-plates, site, or rams', request);

        try {
            const res = await query(
                `INSERT INTO DrawingElementFiles (job_id, context, display_name, file_name, sharepoint_file_id, sharepoint_drive_id, web_url, uploaded_at, uploaded_by)
                 OUTPUT INSERTED.*
                 VALUES (@jobId, @fileContext, @name, @fileName, @fileId, @driveId, @webUrl, @uploadedAt, @uploadedBy)`,
                {
                    jobId, fileContext,
                    name: name || fileName || '',
                    fileName: fileName || name || '',
                    fileId: fileId || null,
                    driveId: driveId || null,
                    webUrl: webUrl || null,
                    uploadedAt: uploadedAt || new Date().toISOString(),
                    uploadedBy: uploadedBy || null
                }
            );
            const f = res.recordset[0];
            return created({
                id: f.id, name: f.display_name, fileName: f.file_name,
                fileId: f.sharepoint_file_id, driveId: f.sharepoint_drive_id,
                webUrl: f.web_url, uploadedAt: f.uploaded_at
            }, request);
        } catch (err) {
            context.error('file-add error:', err);
            return serverError('Failed to add file', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/drawing-elements/:jobId/file/:fileId
// Remove an element file (parts/site). SharePoint deletion handled client-side.
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-file-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/file/{fileId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const fileId = parseInt(request.params.fileId);
        if (!fileId) return badRequest('Invalid fileId', request);

        try {
            const res = await query(
                'DELETE FROM DrawingElementFiles OUTPUT DELETED.id WHERE id = @fileId',
                { fileId }
            );
            if (!res.recordset.length) return notFound('File not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('file-delete error:', err);
            return serverError('Failed to delete file', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/drawing-elements/:jobId/revision-file/:fileId
// Remove a file from an approval revision.
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-revfile-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/revision-file/{fileId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const fileId = parseInt(request.params.fileId);
        if (!fileId) return badRequest('Invalid fileId', request);

        try {
            const res = await query(
                'DELETE FROM DrawingRevisionFiles OUTPUT DELETED.id WHERE id = @fileId',
                { fileId }
            );
            if (!res.recordset.length) return notFound('File not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('revfile-delete error:', err);
            return serverError('Failed to delete revision file', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/drawing-elements/:jobId/note
// Add a note to any context.
// Body: { context, noteType, author, text }
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-note-add', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/note',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const jobId = parseInt(request.params.jobId);
        if (!jobId) return badRequest('Invalid jobId', request);

        let body;
        try { body = await request.json(); } catch { return badRequest('Invalid JSON', request); }

        const { noteContext, noteType, author, text } = body;
        const validContexts = ['approval','parts-sections','parts-plates','site','bom'];
        if (!noteContext || !validContexts.includes(noteContext)) return badRequest('Invalid context', request);
        if (!['draftsman','workshop'].includes(noteType)) return badRequest('Invalid noteType', request);
        if (!author || !text) return badRequest('author and text required', request);

        try {
            const res = await query(
                `INSERT INTO DrawingElementNotes (job_id, context, note_type, author, note_text)
                 OUTPUT INSERTED.*
                 VALUES (@jobId, @noteContext, @noteType, @author, @text)`,
                { jobId, noteContext, noteType, author, text }
            );
            const n = res.recordset[0];
            return created({
                id: n.id, type: n.note_type, author: n.author,
                text: n.note_text, timestamp: n.created_at
            }, request);
        } catch (err) {
            context.error('note-add error:', err);
            return serverError('Failed to add note', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/drawing-elements/:jobId/note/:noteId
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-note-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/note/{noteId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const noteId = parseInt(request.params.noteId);
        if (!noteId) return badRequest('Invalid noteId', request);

        try {
            const res = await query(
                'DELETE FROM DrawingElementNotes OUTPUT DELETED.id WHERE id = @noteId',
                { noteId }
            );
            if (!res.recordset.length) return notFound('Note not found', request);
            return ok({ deleted: true }, request);
        } catch (err) {
            context.error('note-delete error:', err);
            return serverError('Failed to delete note', request);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/drawing-elements/:jobId/site-complete
// Mark site as complete. Body: { completedBy }
// ─────────────────────────────────────────────────────────────────────────────
app.http('drawing-elements-site-complete', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'drawing-elements/{jobId}/site-complete',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const jobId = parseInt(request.params.jobId);
        if (!jobId) return badRequest('Invalid jobId', request);

        let body;
        try { body = await request.json(); } catch { return badRequest('Invalid JSON', request); }

        const completedBy = body.completedBy || null;

        try {
            // Upsert site row
            const existing = await query('SELECT id FROM DrawingJobSite WHERE job_id = @jobId', { jobId });
            if (existing.recordset.length) {
                await query(
                    'UPDATE DrawingJobSite SET completed_at = SYSUTCDATETIME(), completed_by = @completedBy WHERE job_id = @jobId',
                    { jobId, completedBy }
                );
            } else {
                await query(
                    'INSERT INTO DrawingJobSite (job_id, completed_at, completed_by) VALUES (@jobId, SYSUTCDATETIME(), @completedBy)',
                    { jobId, completedBy }
                );
            }
            const row = await query('SELECT * FROM DrawingJobSite WHERE job_id = @jobId', { jobId });
            const s = row.recordset[0];
            return ok({ completedAt: s.completed_at, completedBy: s.completed_by }, request);
        } catch (err) {
            context.error('site-complete error:', err);
            return serverError('Failed to mark site complete', request);
        }
    }
});
