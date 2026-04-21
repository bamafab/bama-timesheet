const { app } = require('@azure/functions');
const { query, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError } = require('../responses');

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
                return badRequest('employee_id, project_number, date, and hours are required');
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
                `INSERT INTO ProjectHours (employee_id, project_number, date, hours, week_commencing)
                 OUTPUT INSERTED.*
                 VALUES (@employeeId, @projectNumber, @date, @hours, @weekCommencing)`,
                {
                    employeeId: parseInt(employee_id),
                    projectNumber: project_number,
                    date: date,
                    hours: parseFloat(hours),
                    weekCommencing: weekStart
                }
            );

            return created(result.recordset[0]);
        } catch (err) {
            context.error('Error logging project hours:', err);
            return serverError('Failed to log project hours');
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
            return ok(result.recordset);
        } catch (err) {
            context.error('Error fetching project hours:', err);
            return serverError('Failed to fetch project hours');
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

            if (fields.length === 0) return badRequest('No fields to update');

            const result = await query(
                `UPDATE ProjectHours SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );

            if (result.recordset.length === 0) return notFound('Project hours entry not found');
            return ok(result.recordset[0]);
        } catch (err) {
            context.error('Error updating project hours:', err);
            return serverError('Failed to update project hours');
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

            if (result.recordset.length === 0) return notFound('Entry not found');
            return ok({ deleted: true, entry: result.recordset[0] });
        } catch (err) {
            context.error('Error deleting project hours:', err);
            return serverError('Failed to delete project hours');
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
            return ok(result.recordset);
        } catch (err) {
            context.error('Error fetching summary:', err);
            return serverError('Failed to fetch summary');
        }
    }
});
