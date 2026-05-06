const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, serverError, preflight } = require('../responses');

// LabourLog = the locked audit record of approved hours, fed from ProjectHours
// when the office syncs a week. See api/sql/create-labour-log.sql for the
// schema and rationale. Replaces the legacy SharePoint Labour Log / Unproductive
// Time sheets — that write path has been retired in shared.js.

// CORS preflight
app.http('labour-log-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'labour-log',
    handler: async (request) => preflight(request)
});

app.http('labour-log-id-preflight', {
    methods: ['OPTIONS'],
    authLevel: 'anonymous',
    route: 'labour-log/{id}',
    handler: async (request) => preflight(request)
});

// POST /api/labour-log
// Body: { entries: [ { project_hours_id, entry_date, employee_id, employee_name,
//                      project_number, project_name, hours, week_commencing,
//                      entry_type? }, ... ],
//         synced_by? }
//
// Idempotent upsert keyed on project_hours_id. If a row already exists for that
// project_hours_id the snapshot fields (hours, project_name, etc.) are refreshed
// to match the current ProjectHours value. New rows are inserted. Returns a
// summary { created, updated, total }.
app.http('labour-log-sync', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'labour-log',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const entries = Array.isArray(body?.entries) ? body.entries : null;
            if (!entries || !entries.length) {
                return badRequest('entries array is required', request);
            }

            const syncedBy = (body?.synced_by || '').toString().slice(0, 255) || null;

            let createdCount = 0;
            let updatedCount = 0;
            const errors = [];

            // We loop one row at a time. The row count per sync is small
            // (a single approved week is typically <100 entries), so the
            // simplicity of per-row error reporting beats a bulk MERGE here.
            for (const e of entries) {
                const phId = parseInt(e.project_hours_id);
                if (!phId) { errors.push({ entry: e, error: 'project_hours_id required' }); continue; }
                if (!e.entry_date)      { errors.push({ entry: e, error: 'entry_date required' });      continue; }
                if (!e.employee_name)   { errors.push({ entry: e, error: 'employee_name required' });   continue; }
                if (!e.project_number)  { errors.push({ entry: e, error: 'project_number required' });  continue; }
                if (e.hours === undefined || e.hours === null) {
                    errors.push({ entry: e, error: 'hours required' }); continue;
                }
                if (!e.week_commencing) { errors.push({ entry: e, error: 'week_commencing required' }); continue; }

                const params = {
                    phId,
                    entryDate:      e.entry_date,
                    weekCommencing: e.week_commencing,
                    employeeId:     e.employee_id ? parseInt(e.employee_id) : null,
                    employeeName:   String(e.employee_name).slice(0, 255),
                    projectNumber:  String(e.project_number).slice(0, 20),
                    projectName:    e.project_name ? String(e.project_name).slice(0, 500) : null,
                    hours:          parseFloat(e.hours),
                    entryType:      (e.entry_type === 'unproductive' ? 'unproductive' : 'productive'),
                    syncedBy
                };

                try {
                    // MERGE for atomic upsert. $action tells us which path ran
                    // so we can return accurate created/updated counts.
                    const result = await query(
                        `MERGE LabourLog AS target
                         USING (SELECT @phId AS project_hours_id) AS src
                            ON target.project_hours_id = src.project_hours_id
                         WHEN MATCHED THEN UPDATE SET
                            entry_date      = @entryDate,
                            week_commencing = @weekCommencing,
                            employee_id     = @employeeId,
                            employee_name   = @employeeName,
                            project_number  = @projectNumber,
                            project_name    = @projectName,
                            hours           = @hours,
                            entry_type      = @entryType,
                            synced_by       = @syncedBy,
                            updated_at      = SYSUTCDATETIME()
                         WHEN NOT MATCHED THEN INSERT
                            (project_hours_id, entry_date, week_commencing, employee_id,
                             employee_name, project_number, project_name, hours,
                             entry_type, synced_by)
                         VALUES
                            (@phId, @entryDate, @weekCommencing, @employeeId,
                             @employeeName, @projectNumber, @projectName, @hours,
                             @entryType, @syncedBy)
                         OUTPUT $action AS action;`,
                        params
                    );
                    const action = result.recordset?.[0]?.action;
                    if (action === 'INSERT') createdCount++;
                    else if (action === 'UPDATE') updatedCount++;
                } catch (rowErr) {
                    context.error('LabourLog row upsert failed:', rowErr.message, params);
                    errors.push({ entry: e, error: rowErr.message });
                }
            }

            return ok({
                created: createdCount,
                updated: updatedCount,
                total:   createdCount + updatedCount,
                errors
            }, request);
        } catch (err) {
            context.error('LabourLog sync failed:', err);
            return serverError('Failed to sync labour log: ' + err.message, request);
        }
    }
});

// GET /api/labour-log
// Query params (all optional, AND-combined):
//   employee_id, project_number, week_commencing, entry_type
//   from, to        — inclusive entry_date range (YYYY-MM-DD)
// Returns rows newest-first.
app.http('labour-log-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'labour-log',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const q = request.query;
            const where = [];
            const params = {};

            const employeeId = q.get('employee_id');
            if (employeeId) { where.push('employee_id = @employeeId'); params.employeeId = parseInt(employeeId); }

            const projectNumber = q.get('project_number');
            if (projectNumber) { where.push('project_number = @projectNumber'); params.projectNumber = projectNumber; }

            const weekCommencing = q.get('week_commencing');
            if (weekCommencing) { where.push('week_commencing = @weekCommencing'); params.weekCommencing = weekCommencing; }

            const entryType = q.get('entry_type');
            if (entryType) { where.push('entry_type = @entryType'); params.entryType = entryType; }

            const from = q.get('from');
            if (from) { where.push('entry_date >= @from'); params.from = from; }

            const to = q.get('to');
            if (to) { where.push('entry_date <= @to'); params.to = to; }

            const sqlText =
                'SELECT * FROM LabourLog' +
                (where.length ? ' WHERE ' + where.join(' AND ') : '') +
                ' ORDER BY entry_date DESC, id DESC';

            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('LabourLog list failed:', err);
            return serverError('Failed to fetch labour log', request);
        }
    }
});

// DELETE /api/labour-log/:id — admin/repair use. Normal day-to-day flow does
// not delete from this table. ProjectHours deletes cascade via the FK.
app.http('labour-log-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'labour-log/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            if (!id) return badRequest('id required', request);
            const result = await query(
                'DELETE FROM LabourLog OUTPUT DELETED.* WHERE id = @id',
                { id }
            );
            return ok(result.recordset[0] || null, request);
        } catch (err) {
            context.error('LabourLog delete failed:', err);
            return serverError('Failed to delete labour log row', request);
        }
    }
});
