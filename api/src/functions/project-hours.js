const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// POST /api/project-hours — log project hours
app.http('project-hours-create', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'project-hours',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, project_number, date, hours, week_commencing } = body;

            if (!employee_id || !project_number || !date || hours === undefined) {
                return badRequest('employee_id, project_number, date, and hours are required', request);
            }

            // Calculate week_commencing if not provided (Monday of the week)
            let weekStart = week_commencing;
            if (!weekStart) {
                const d = new Date(date);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d.setDate(diff));
                weekStart = monday.toISOString().split('T')[0];
            }

            const result = await query(
                `INSERT INTO ProjectHours (employee_id, project_number, date, hours, week_commencing, is_approved)
                 OUTPUT INSERTED.*
                 VALUES (@employeeId, @projectNumber, @date, @hours, @weekCommencing, 1)`,
                {
                    employeeId: parseInt(employee_id),
                    projectNumber: project_number,
                    date: date,
                    hours: parseFloat(hours),
                    weekCommencing: weekStart
                }
            );

            return created(result.recordset[0], request);
        } catch (err) {
            context.error('Error logging project hours:', err);
            return serverError('Failed to log project hours', request);
        }
    }
});

// GET /api/project-hours — get project hours with filters
// ?employee_id=1&week_commencing=2026-04-20&project_number=P-1234&from=2026-04-01&to=2026-04-30
app.http('project-hours-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-hours',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const employeeId = url.searchParams.get('employee_id');
            const weekCommencing = url.searchParams.get('week_commencing');
            const projectNumber = url.searchParams.get('project_number');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const approved = url.searchParams.get('approved');

            let sqlText = `
                SELECT ph.*, e.name as employee_name
                FROM ProjectHours ph
                JOIN Employees e ON e.id = ph.employee_id
                WHERE 1=1
            `;
            const params = {};

            if (employeeId) {
                sqlText += ' AND ph.employee_id = @employeeId';
                params.employeeId = parseInt(employeeId);
            }

            if (weekCommencing) {
                sqlText += ' AND ph.week_commencing = @weekCommencing';
                params.weekCommencing = weekCommencing;
            }

            if (projectNumber) {
                sqlText += ' AND ph.project_number = @projectNumber';
                params.projectNumber = projectNumber;
            }

            if (from) {
                sqlText += ' AND ph.date >= @from';
                params.from = from;
            }

            if (to) {
                sqlText += ' AND ph.date <= @to';
                params.to = to;
            }

            if (approved !== null && approved !== undefined) {
                sqlText += ' AND ph.is_approved = @approved';
                params.approved = approved === 'true' ? 1 : 0;
            }

            sqlText += ' ORDER BY ph.date DESC, e.name';

            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching project hours:', err);
            return serverError('Failed to fetch project hours', request);
        }
    }
});

// PUT /api/project-hours/:id — update project hours entry
app.http('project-hours-update', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'project-hours/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };

            if (body.project_number !== undefined) { fields.push('project_number = @projectNumber'); params.projectNumber = body.project_number; }
            if (body.hours !== undefined) { fields.push('hours = @hours'); params.hours = parseFloat(body.hours); }
            if (body.date !== undefined) { fields.push('date = @date'); params.date = body.date; }
            if (body.is_approved !== undefined) { fields.push('is_approved = @isApproved'); params.isApproved = body.is_approved ? 1 : 0; }
            if (body.edit_reason !== undefined) { fields.push('edit_reason = @editReason'); params.editReason = body.edit_reason || null; }
            if (body.edited_by !== undefined)   { fields.push('edited_by = @editedBy');     params.editedBy   = body.edited_by   || null; }
            // edited_at: stamp automatically whenever an edit-audit field is set
            if (body.edit_reason !== undefined || body.edited_by !== undefined) {
                fields.push('edited_at = GETUTCDATE()');
            }

            if (fields.length === 0) return badRequest('No fields to update', request);

            const result = await query(
                `UPDATE ProjectHours SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Project hours entry not found', request);
            return ok(result.recordset[0], request);
        } catch (err) {
            context.error('Error updating project hours:', err);
            return serverError('Failed to update project hours', request);
        }
    }
});

// DELETE /api/project-hours/:id — delete project hours entry
app.http('project-hours-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'project-hours/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const id = parseInt(request.params.id);
            const result = await query(
                'DELETE FROM ProjectHours OUTPUT DELETED.* WHERE id = @id',
                { id }
            );

            if (result.recordset.length === 0) return notFound('Entry not found', request);
            return ok({ deleted: true, entry: result.recordset[0] }, request);
        } catch (err) {
            context.error('Error deleting project hours:', err);
            return serverError('Failed to delete project hours', request);
        }
    }
});

// POST /api/project-hours/recompute-s000 — server-side recompute of unproductive (S000) hours
//
// Body: { employee_id, date }   (date as 'YYYY-MM-DD')
//
// Server is the source of truth for the unproductive figure. We:
//   1. Find the clocking row for this employee+date.
//   2. Bail if no clock-out yet (still on shift — nothing to derive).
//   3. Compute clocked_hours from clock_in / clock_out / break_mins,
//      mirroring shared.js calcHours: overnight wrap at 24h, no break
//      deducted on Sat/Sun.
//   4. Sum existing ProjectHours rows for that employee+date excluding S000.
//   5. unproductive = clocked - project_total, rounded to 2dp.
//   6. Delete any existing S000 row for that employee+date (idempotent).
//   7. If unproductive > 0, insert a fresh S000 row.
//   8. Return { entry, hours, clocked_hours, project_hours }.
//
// Manual edits to S000 rows in ProjectHours will be overwritten the next
// time this endpoint runs — by design (S000 is a derived value).
app.http('project-hours-recompute-s000', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'project-hours/recompute-s000',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { employee_id, date } = body;

            if (!employee_id || !date) {
                return badRequest('employee_id and date are required', request);
            }

            const empId = parseInt(employee_id);

            // 1. Find the (closed) clocking for this employee on this date.
            //    There can be more than one ClockEntries row per day in theory
            //    (raw audit trail), but the kiosk produces one closed entry per
            //    shift. Pick the most recent closed entry for the day.
            //
            //    TZ note: we filter on a datetime *range* rather than
            //    CAST(clock_in AS DATE) = @date because Azure SQL evaluates
            //    CAST in its server timezone (UTC), which drifts from workshop
            //    local time (BST in summer) and can miss late-evening or
            //    early-morning shifts at DST boundaries. The 2h margin either
            //    side comfortably absorbs any UK ↔ UTC offset (max 1h) plus
            //    overnight shifts whose clock_in still belongs to @date.
            const clockRes = await query(
                `SELECT TOP 1 clock_in, clock_out, break_mins
                 FROM ClockEntries
                 WHERE employee_id = @empId
                   AND clock_in >= DATEADD(HOUR, -2, CAST(@date AS DATETIME2))
                   AND clock_in <  DATEADD(HOUR, 26, CAST(@date AS DATETIME2))
                   AND clock_out IS NOT NULL
                 ORDER BY clock_out DESC`,
                { empId, date }
            );

            if (clockRes.recordset.length === 0) {
                // No closed clocking → nothing to derive. Also remove any stale
                // S000 row that might exist (e.g. clock-out was reverted).
                await query(
                    `DELETE FROM ProjectHours
                     WHERE employee_id = @empId
                       AND date = @date
                       AND project_number = 'S000'`,
                    { empId, date }
                );
                return ok({
                    entry: null,
                    hours: 0,
                    clocked_hours: 0,
                    project_hours: 0,
                    reason: 'no closed clocking for this date'
                }, request);
            }

            const { clock_in, clock_out, break_mins } = clockRes.recordset[0];

            // 2. Compute clocked hours, mirroring shared.js calcHours().
            //    Both clock_in and clock_out are full DATETIME2s, so the ms
            //    diff is already correct across midnight (overnight shifts).
            //    The wrap below is defensive — if a row is somehow corrupt
            //    with clock_out earlier than clock_in on the same day, it
            //    matches the legacy calcHours behaviour rather than returning
            //    a negative value.
            const ci = new Date(clock_in);
            const co = new Date(clock_out);
            let diffMins = Math.round((co.getTime() - ci.getTime()) / 60000);
            if (diffMins < 0) diffMins += 1440;

            // Break NOT deducted on Sat/Sun (BAMA rule). Use the date string
            // as authoritative — same as shared.js, avoids TZ confusion on
            // the clock_in datetime.
            const d = new Date(date + 'T12:00:00');
            const dow = d.getDay(); // 0 = Sun, 6 = Sat
            const skipBreak = (dow === 0 || dow === 6);
            if (!skipBreak) diffMins -= (break_mins || 0);

            const clockedHrs = diffMins > 0 ? diffMins / 60 : 0;

            // 3. Sum non-S000 project hours for this employee/date.
            const sumRes = await query(
                `SELECT COALESCE(SUM(hours), 0) AS total
                 FROM ProjectHours
                 WHERE employee_id = @empId
                   AND date = @date
                   AND project_number <> 'S000'`,
                { empId, date }
            );
            const projectHrs = parseFloat(sumRes.recordset[0].total) || 0;

            // 4. Derive unproductive (2dp).
            const unproductiveHrs = parseFloat((clockedHrs - projectHrs).toFixed(2));

            // 5. Wipe any existing S000 row(s) for the day — idempotent.
            await query(
                `DELETE FROM ProjectHours
                 WHERE employee_id = @empId
                   AND date = @date
                   AND project_number = 'S000'`,
                { empId, date }
            );

            // 6. Insert fresh S000 row only if there's something to log.
            let entry = null;
            if (unproductiveHrs > 0) {
                // week_commencing = Monday of that week
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d);
                monday.setDate(diff);
                const weekStart = monday.toISOString().split('T')[0];

                const insertRes = await query(
                    `INSERT INTO ProjectHours (employee_id, project_number, date, hours, week_commencing, is_approved)
                     OUTPUT INSERTED.*
                     VALUES (@empId, 'S000', @date, @hours, @weekStart, 1)`,
                    { empId, date, hours: unproductiveHrs, weekStart }
                );
                entry = insertRes.recordset[0];
            }

            return ok({
                entry,
                hours: unproductiveHrs,
                clocked_hours: parseFloat(clockedHrs.toFixed(2)),
                project_hours: parseFloat(projectHrs.toFixed(2))
            }, request);
        } catch (err) {
            context.error('Error recomputing S000:', err);
            return serverError('Failed to recompute unproductive hours', request);
        }
    }
});

// GET /api/project-hours/summary — grouped summary by project or employee
// ?group_by=project&week_commencing=2026-04-20
// ?group_by=employee&week_commencing=2026-04-20
app.http('project-hours-summary', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'project-hours/summary',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const groupBy = url.searchParams.get('group_by') || 'project';
            const weekCommencing = url.searchParams.get('week_commencing');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');

            let whereClause = 'WHERE 1=1';
            const params = {};

            if (weekCommencing) {
                whereClause += ' AND ph.week_commencing = @weekCommencing';
                params.weekCommencing = weekCommencing;
            }
            if (from) {
                whereClause += ' AND ph.date >= @from';
                params.from = from;
            }
            if (to) {
                whereClause += ' AND ph.date <= @to';
                params.to = to;
            }

            let sqlText;
            if (groupBy === 'employee') {
                sqlText = `
                    SELECT e.name as employee_name, ph.employee_id,
                           SUM(ph.hours) as total_hours,
                           COUNT(DISTINCT ph.project_number) as project_count,
                           COUNT(*) as entry_count
                    FROM ProjectHours ph
                    JOIN Employees e ON e.id = ph.employee_id
                    ${whereClause}
                    GROUP BY e.name, ph.employee_id
                    ORDER BY e.name
                `;
            } else {
                sqlText = `
                    SELECT ph.project_number,
                           SUM(ph.hours) as total_hours,
                           COUNT(DISTINCT ph.employee_id) as employee_count,
                           COUNT(*) as entry_count
                    FROM ProjectHours ph
                    ${whereClause}
                    GROUP BY ph.project_number
                    ORDER BY ph.project_number
                `;
            }

            const result = await query(sqlText, params);
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching summary:', err);
            return serverError('Failed to fetch summary', request);
        }
    }
});
