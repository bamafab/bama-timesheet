const { app } = require('@azure/functions');
const { query, getPool, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError } = require('../responses');

// POST /api/payroll/approve — approve a week and calculate payroll
app.http('payroll-approve', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'payroll/approve',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const body = await request.json();
            const { week_commencing } = body;

            if (!week_commencing) return badRequest('week_commencing is required');

            // Check if already archived
            const existing = await query(
                'SELECT COUNT(*) as count FROM PayrollArchive WHERE week_commencing = @wc',
                { wc: week_commencing }
            );
            if (existing.recordset[0].count > 0) {
                return badRequest('This week has already been approved');
            }

            // Get all project hours for this week
            const hours = await query(
                `SELECT ph.employee_id, e.name, e.rate,
                        ph.date, ph.hours,
                        DATEPART(dw, ph.date) as day_of_week
                 FROM ProjectHours ph
                 JOIN Employees e ON e.id = ph.employee_id
                 WHERE ph.week_commencing = @wc
                 ORDER BY ph.employee_id, ph.date`,
                { wc: week_commencing }
            );

            if (hours.recordset.length === 0) {
                return badRequest('No project hours found for this week');
            }

            // Group by employee and calculate payroll
            const employeeData = {};
            for (const row of hours.recordset) {
                if (!employeeData[row.employee_id]) {
                    employeeData[row.employee_id] = {
                        employee_id: row.employee_id,
                        name: row.name,
                        rate: parseFloat(row.rate),
                        total_hours: 0,
                        saturday_worked: false,
                        sunday_worked: false,
                        sunday_hours: 0,
                        daily_hours: {}
                    };
                }

                const emp = employeeData[row.employee_id];
                const hrs = parseFloat(row.hours);
                emp.total_hours += hrs;

                // day_of_week: 1=Sunday, 2=Monday, ..., 7=Saturday (SQL Server default)
                if (row.day_of_week === 7) emp.saturday_worked = true;
                if (row.day_of_week === 1) {
                    emp.sunday_worked = true;
                    emp.sunday_hours += hrs;
                }
            }

            // Calculate pay for each employee using BAMA rules:
            // - Basic: first 40 hours at rate
            // - Overtime: hours over 40 at 1.5x rate
            // - Double time: Sunday hours at 2x rate (only if worked both Saturday AND Sunday)
            const payrollRecords = [];

            for (const emp of Object.values(employeeData)) {
                const doubleTimeApplies = emp.saturday_worked && emp.sunday_worked;
                let basic_hours, overtime_hours, double_hours;

                if (doubleTimeApplies) {
                    const nonSundayHours = emp.total_hours - emp.sunday_hours;
                    basic_hours = Math.min(40, nonSundayHours);
                    overtime_hours = Math.max(0, nonSundayHours - 40);
                    double_hours = emp.sunday_hours;
                } else {
                    basic_hours = Math.min(40, emp.total_hours);
                    overtime_hours = Math.max(0, emp.total_hours - 40);
                    double_hours = 0;
                }

                const basic_pay = Math.round(basic_hours * emp.rate * 100) / 100;
                const overtime_pay = Math.round(overtime_hours * emp.rate * 1.5 * 100) / 100;
                const double_pay = Math.round(double_hours * emp.rate * 2 * 100) / 100;
                const total_pay = Math.round((basic_pay + overtime_pay + double_pay) * 100) / 100;

                payrollRecords.push({
                    employee_id: emp.employee_id,
                    week_commencing,
                    total_hours: Math.round(emp.total_hours * 100) / 100,
                    basic_hours: Math.round(basic_hours * 100) / 100,
                    overtime_hours: Math.round(overtime_hours * 100) / 100,
                    double_hours: Math.round(double_hours * 100) / 100,
                    rate: emp.rate,
                    basic_pay,
                    overtime_pay,
                    double_pay,
                    total_pay
                });
            }

            // Insert all payroll records and mark project hours as approved
            const db = await getPool();
            const transaction = new sql.Transaction(db);
            await transaction.begin();

            try {
                const txRequest = new sql.Request(transaction);

                for (const record of payrollRecords) {
                    await txRequest.query(`
                        INSERT INTO PayrollArchive
                            (employee_id, week_commencing, total_hours, basic_hours, overtime_hours,
                             double_hours, rate, basic_pay, overtime_pay, double_pay, total_pay)
                        VALUES
                            (${record.employee_id}, '${record.week_commencing}', ${record.total_hours},
                             ${record.basic_hours}, ${record.overtime_hours}, ${record.double_hours},
                             ${record.rate}, ${record.basic_pay}, ${record.overtime_pay},
                             ${record.double_pay}, ${record.total_pay})
                    `);
                }

                // Mark all project hours for this week as approved
                await txRequest.query(`
                    UPDATE ProjectHours SET is_approved = 1
                    WHERE week_commencing = '${week_commencing}'
                `);

                await transaction.commit();
            } catch (txErr) {
                await transaction.rollback();
                throw txErr;
            }

            return created({
                week_commencing,
                employees: payrollRecords.length,
                total_payroll: Math.round(payrollRecords.reduce((sum, r) => sum + r.total_pay, 0) * 100) / 100,
                records: payrollRecords
            });
        } catch (err) {
            context.error('Error approving payroll:', err);
            return serverError('Failed to approve payroll');
        }
    }
});

// GET /api/archive — get archived payroll weeks
// ?week_commencing=2026-04-20&from=2026-01-01&to=2026-12-31
app.http('archive-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'archive',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const url = new URL(request.url);
            const weekCommencing = url.searchParams.get('week_commencing');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');

            let sqlText = `
                SELECT pa.*, e.name as employee_name
                FROM PayrollArchive pa
                JOIN Employees e ON e.id = pa.employee_id
                WHERE 1=1
            `;
            const params = {};

            if (weekCommencing) {
                sqlText += ' AND pa.week_commencing = @wc';
                params.wc = weekCommencing;
            }

            if (from) {
                sqlText += ' AND pa.week_commencing >= @from';
                params.from = from;
            }

            if (to) {
                sqlText += ' AND pa.week_commencing <= @to';
                params.to = to;
            }

            sqlText += ' ORDER BY pa.week_commencing DESC, e.name';

            const result = await query(sqlText, params);
            return ok(result.recordset);
        } catch (err) {
            context.error('Error fetching archive:', err);
            return serverError('Failed to fetch archive');
        }
    }
});

// GET /api/archive/weeks — list all archived weeks (summary)
app.http('archive-weeks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'archive/weeks',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;

        try {
            const result = await query(`
                SELECT week_commencing,
                       COUNT(*) as employee_count,
                       SUM(total_hours) as total_hours,
                       SUM(total_pay) as total_pay,
                       MIN(archived_at) as archived_at
                FROM PayrollArchive
                GROUP BY week_commencing
                ORDER BY week_commencing DESC
            `);

            return ok(result.recordset);
        } catch (err) {
            context.error('Error fetching archive weeks:', err);
            return serverError('Failed to fetch archive weeks');
        }
    }
});
