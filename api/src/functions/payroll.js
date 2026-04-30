const { app } = require('@azure/functions');
const { query, getPool, sql } = require('../db');
const { requireAuth } = require('../auth');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');
const { isBankHoliday } = require('../bank-holidays');

// YYYY-MM-DD in local time (matches how dates are compared everywhere else)
function dateOnly(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Round to 2dp (avoids floating-point grime in payroll figures)
function r2(n) { return Math.round(n * 100) / 100; }

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

            if (!week_commencing) return badRequest('week_commencing is required', request);

            // Check if already archived
            const existing = await query(
                'SELECT COUNT(*) as count FROM PayrollArchive WHERE week_commencing = @wc',
                { wc: week_commencing }
            );
            if (existing.recordset[0].count > 0) {
                return badRequest('This week has already been approved', request);
            }

            // ── Calculate the week's date range (Mon-Sun, inclusive) ──
            const weekStart = new Date(week_commencing + 'T00:00:00');
            const weekDates = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(weekStart);
                d.setDate(weekStart.getDate() + i);
                weekDates.push(dateOnly(d));
            }
            const weekEndStr = weekDates[6];

            // Bank holiday dates that fall in this week
            const bhInWeek = weekDates.filter(d => {
                const dow = new Date(d + 'T12:00:00').getDay();
                return dow !== 0 && dow !== 6 && isBankHoliday(d);
            });

            // ── Fetch project hours ──
            const hours = await query(
                `SELECT ph.employee_id, e.name, e.rate, e.pay_type, e.is_active,
                        ph.date, ph.hours,
                        DATEPART(dw, ph.date) as day_of_week
                 FROM ProjectHours ph
                 JOIN Employees e ON e.id = ph.employee_id
                 WHERE ph.week_commencing = @wc
                 ORDER BY ph.employee_id, ph.date`,
                { wc: week_commencing }
            );

            // ── Fetch approved booked holidays overlapping this week ──
            const holidaysResult = await query(
                `SELECT h.employee_id, e.name, e.rate, e.pay_type, e.is_active,
                        h.date_from, h.date_to, h.type, h.working_days
                 FROM Holidays h
                 JOIN Employees e ON e.id = h.employee_id
                 WHERE h.status = 'approved'
                   AND h.type IN ('paid', 'half')
                   AND h.date_from <= @weekEnd
                   AND h.date_to   >= @weekStart`,
                { weekStart: week_commencing, weekEnd: weekEndStr }
            );

            // ── Fetch all active payees (for bank holiday auto-pay) ──
            const payees = bhInWeek.length > 0
                ? await query(`
                    SELECT id, name, rate FROM Employees
                    WHERE is_active = 1 AND pay_type = 'payee'
                  `)
                : { recordset: [] };

            // Bail only if absolutely nothing happened this week
            if (hours.recordset.length === 0
                && holidaysResult.recordset.length === 0
                && bhInWeek.length === 0) {
                return badRequest('No project hours, holidays, or bank holidays for this week', request);
            }

            // ── Build per-employee record ──
            // Keyed by employee_id. Created lazily as we encounter each
            // employee in any of the three sources.
            const employeeData = {};
            function ensure(emp_id, name, rate) {
                if (!employeeData[emp_id]) {
                    employeeData[emp_id] = {
                        employee_id: emp_id,
                        name,
                        rate: parseFloat(rate),
                        worked_hours: 0,
                        saturday_worked: false,
                        sunday_worked: false,
                        sunday_hours: 0,
                        holiday_hours: 0,
                        bank_holiday_hours: 0
                    };
                }
                return employeeData[emp_id];
            }

            // 1) Project hours
            for (const row of hours.recordset) {
                const emp = ensure(row.employee_id, row.name, row.rate);
                const hrs = parseFloat(row.hours);
                emp.worked_hours += hrs;
                // SQL Server DATEPART(dw): 1=Sunday, 7=Saturday (default datefirst=7)
                if (row.day_of_week === 7) emp.saturday_worked = true;
                if (row.day_of_week === 1) {
                    emp.sunday_worked = true;
                    emp.sunday_hours += hrs;
                }
            }

            // 2) Booked holidays — walk the in-week portion of each range,
            //    skip weekends and bank holidays (matches frontend `working_days`)
            for (const row of holidaysResult.recordset) {
                const emp = ensure(row.employee_id, row.name, row.rate);
                if (row.type === 'half') {
                    // Half-days are always single-day in practice — credit 4h
                    // if the day falls in this week and is a working day.
                    const d = dateOnly(new Date(row.date_from));
                    if (d >= week_commencing && d <= weekEndStr) {
                        const dow = new Date(d + 'T12:00:00').getDay();
                        if (dow !== 0 && dow !== 6 && !isBankHoliday(d)) {
                            emp.holiday_hours += 4;
                        }
                    }
                    continue;
                }
                // type === 'paid' — walk every date in [max(start,weekStart), min(end,weekEnd)]
                const rangeStart = new Date(Math.max(
                    new Date(row.date_from).getTime(),
                    weekStart.getTime()
                ));
                const rangeEnd = new Date(Math.min(
                    new Date(row.date_to).getTime(),
                    new Date(weekEndStr + 'T00:00:00').getTime()
                ));
                for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
                    const ds = dateOnly(d);
                    const dow = d.getDay();
                    if (dow === 0 || dow === 6) continue;
                    if (isBankHoliday(ds)) continue;
                    emp.holiday_hours += 8;
                }
            }

            // 3) Bank holidays — auto-pay 8h × basic to every active payee
            //    for each BH in the week. Creates rows for payees who didn't
            //    work and didn't book holiday — they're still owed BH pay.
            if (bhInWeek.length > 0) {
                const bhHoursTotal = bhInWeek.length * 8;
                for (const p of payees.recordset) {
                    const emp = ensure(p.id, p.name, p.rate);
                    emp.bank_holiday_hours += bhHoursTotal;
                }
            }

            // ── Apply BAMA rules per employee ──
            // - Booked holiday + bank holiday hours fill the 40h bucket FIRST,
            //   pushing any worked hours that don't fit into overtime.
            // - Holiday/BH hours are always at basic rate (never OT, never DT).
            // - Sunday hours stay double if both Sat AND Sun were worked;
            //   bank holidays always fall on weekdays so don't interact.
            const payrollRecords = [];

            for (const emp of Object.values(employeeData)) {
                const nonWorkedPaidHours = emp.holiday_hours + emp.bank_holiday_hours;
                const doubleTimeApplies = emp.saturday_worked && emp.sunday_worked;

                let basic_hours, overtime_hours, double_hours;

                if (doubleTimeApplies) {
                    double_hours = emp.sunday_hours;
                    const nonSundayWorked = emp.worked_hours - emp.sunday_hours;
                    const nonSundayCombined = nonSundayWorked + nonWorkedPaidHours;

                    if (nonSundayCombined <= 40) {
                        basic_hours = nonSundayWorked;
                        overtime_hours = 0;
                    } else {
                        const basicCapacityForWorked = Math.max(0, 40 - nonWorkedPaidHours);
                        basic_hours = Math.min(nonSundayWorked, basicCapacityForWorked);
                        overtime_hours = nonSundayWorked - basic_hours;
                    }
                } else {
                    double_hours = 0;
                    if (emp.worked_hours + nonWorkedPaidHours <= 40) {
                        basic_hours = emp.worked_hours;
                        overtime_hours = 0;
                    } else {
                        const basicCapacityForWorked = Math.max(0, 40 - nonWorkedPaidHours);
                        basic_hours = Math.min(emp.worked_hours, basicCapacityForWorked);
                        overtime_hours = emp.worked_hours - basic_hours;
                    }
                }

                const basic_pay        = r2(basic_hours        * emp.rate);
                const overtime_pay     = r2(overtime_hours     * emp.rate * 1.5);
                const double_pay       = r2(double_hours       * emp.rate * 2);
                const holiday_pay      = r2(emp.holiday_hours      * emp.rate);
                const bank_holiday_pay = r2(emp.bank_holiday_hours * emp.rate);
                const total_pay = r2(basic_pay + overtime_pay + double_pay + holiday_pay + bank_holiday_pay);
                const total_hours = r2(emp.worked_hours + emp.holiday_hours + emp.bank_holiday_hours);

                payrollRecords.push({
                    employee_id: emp.employee_id,
                    week_commencing,
                    total_hours,
                    basic_hours: r2(basic_hours),
                    overtime_hours: r2(overtime_hours),
                    double_hours: r2(double_hours),
                    holiday_hours: r2(emp.holiday_hours),
                    bank_holiday_hours: r2(emp.bank_holiday_hours),
                    rate: emp.rate,
                    basic_pay,
                    overtime_pay,
                    double_pay,
                    holiday_pay,
                    bank_holiday_pay,
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
                             double_hours, holiday_hours, bank_holiday_hours, rate,
                             basic_pay, overtime_pay, double_pay, holiday_pay, bank_holiday_pay, total_pay)
                        VALUES
                            (${record.employee_id}, '${record.week_commencing}', ${record.total_hours},
                             ${record.basic_hours}, ${record.overtime_hours}, ${record.double_hours},
                             ${record.holiday_hours}, ${record.bank_holiday_hours}, ${record.rate},
                             ${record.basic_pay}, ${record.overtime_pay}, ${record.double_pay},
                             ${record.holiday_pay}, ${record.bank_holiday_pay}, ${record.total_pay})
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
                total_payroll: r2(payrollRecords.reduce((sum, r) => sum + r.total_pay, 0)),
                records: payrollRecords
            });
        } catch (err) {
            context.error('Error approving payroll:', err);
            return serverError('Failed to approve payroll', request);
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
            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching archive:', err);
            return serverError('Failed to fetch archive', request);
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

            return ok(result.recordset, request);
        } catch (err) {
            context.error('Error fetching archive weeks:', err);
            return serverError('Failed to fetch archive weeks', request);
        }
    }
});
