# Spec — Paid Holiday in Payroll

**Status:** Draft for review (rev 3 — merged HOL/BH display column)
**Author:** Claude (with Bama input)
**Last updated:** 2026-04-30

## Problem

Today the payroll page and the holiday system are completely siloed:

1. **Booked paid holidays** — A staff member who books and gets approved for a
   paid holiday has the day decremented from `holiday_balance`, but the day is
   invisible to payroll. The payroll cell shows `—`, `calculatePayroll`
   (frontend) and `payroll-approve` (API) both ignore the `Holidays` table,
   and `PayrollArchive` rows for the week reflect only worked hours.
2. **Bank holidays** — UK bank holidays are excluded from `working_days` at
   booking time (so booking a holiday across Easter doesn't burn the staff
   member's balance), but they don't appear in payroll either. A payee who's
   off for Easter Monday silently loses 8h of pay.

Result: whoever runs payroll has to mentally reconcile both the Holidays tab
and the UK bank holiday calendar against the payroll table, then add the
missing pay manually outside the system.

This spec covers paid holidays + bank holidays. Sickness handling is deferred
to a future SSP feature (see Roadmap below).

---

## Decisions (confirmed with user)

1. **Holiday day → hours conversion:** Flat **8 hours × employee rate**, for
   every employee. No new "contracted hours" field. Half-day holidays
   (`type='half'`, `working_days=0.5`) convert to **4 hours**.
2. **Overtime interaction:** Holiday hours **count toward the 40h threshold
   before any worked hours go to overtime**. Holiday hours themselves are
   always paid at basic rate (never overtime, never double-time).
3. **Bank holidays:**
   - Every UK bank holiday is paid at **8h × basic rate** automatically to
     every active **payee** employee (CIS staff and inactive employees
     excluded — same eligibility as the rest of payroll).
   - **Nobody can clock in on a bank holiday.** The kiosk and all "add
     clocking" paths reject attempts with a clear message. This eliminates
     the "what if someone works on a bank holiday" question entirely:
     by rule, they don't.
   - No row in the `Holidays` table is created. Bank-holiday hours are
     derived at payroll-calc time from the existing `UK_BANK_HOLIDAYS`
     constant.
   - Bank holidays do **not** deduct from `holiday_balance` (already true
     today via `countWorkingDays`; unchanged).
   - Bank-holiday hours feed the same 40h bucket as booked holiday hours
     (i.e. Decision 2 applies to them too).
4. **Sickness/absence:** **Ignored** by payroll for now. Add to roadmap to
   build a proper SSP trigger later.
5. **Permission gate:** Holiday-pay numbers are financial and stay behind the
   existing `payroll` permission, which already gates the entire payroll tab.
   No new permission key needed.

---

## Behaviour by example

Paul, rate £20/hr.

### Example A — full week worked, no holiday
Worked 42h Mon–Fri (no Sat/Sun).
- Basic: 40h × £20 = £800
- Overtime: 2h × £30 = £60
- Total: **£860**

(Same as today.)

### Example B — Mon paid holiday, worked Tue–Fri 8h each
Holiday hours: 8. Worked hours: 32. Combined: 40.
- Basic worked: 32h × £20 = £640
- Holiday: 8h × £20 = £160
- Overtime: 0
- Total: **£800**

### Example C — Mon paid holiday, worked Tue–Sat 9h each (45h worked)
Holiday: 8h. Worked: 45h. Combined notional: 53h.

Holiday fills the 40h bucket first → 8h holiday + 32h worked at basic, then
the remaining 13h worked goes to overtime. Sat alone (no Sun) → no double.
- Holiday: 8h × £20 = £160
- Basic worked: 32h × £20 = £640
- Overtime: 13h × £30 = £390
- Total: **£1,190**

### Example D — half-day Fri, Sat+Sun both worked
Half-day holiday Fri (4h). Worked Mon–Thu 8h, Fri 4h, Sat 8h, Sun 6h = 42h
worked + 4h holiday.

Sun double-time applies (Sat AND Sun). Sun's 6h come out of the calc first as
double. Remaining: 36h worked + 4h holiday = 40h → all basic.
- Holiday: 4h × £20 = £80
- Basic worked: 36h × £20 = £720
- Overtime: 0
- Double: 6h × £40 = £240
- Total: **£1,040**

### Example E — pending or rejected holiday
Ignored. Only `status='approved'` paid/half holidays count.

### Example F — week containing Easter Monday (UK bank holiday)
Worked Tue–Fri 8h each (32h). Mon = Easter Monday (BH).
- Bank holiday: 8h × £20 = £160 (auto, no booking required)
- Basic worked: 32h × £20 = £640
- Overtime: 0
- Total: **£800**

(Payee staff only. CIS contractor on the same week with the same hours gets
£640 — no bank holiday top-up.)

### Example G — bank holiday + booked holiday in same week
Mon = Easter Monday (BH). Tue = booked paid holiday (deducts balance).
Wed–Fri worked 9h each (27h).
- Bank holiday: 8h
- Booked holiday: 8h (1 day off `holiday_balance`)
- Worked: 27h
- Combined toward 40h: 8 + 8 + 24 = 40 → 24h worked at basic, 3h spill to OT
- BH pay:        8h × £20 = £160
- Holiday pay:   8h × £20 = £160
- Basic worked: 24h × £20 = £480
- Overtime:      3h × £30 = £90
- Total: **£890**

---

## Data model changes

### `PayrollArchive` — add columns

```sql
ALTER TABLE PayrollArchive ADD holiday_hours      DECIMAL(6,2)  NOT NULL DEFAULT 0;
ALTER TABLE PayrollArchive ADD holiday_pay        DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE PayrollArchive ADD bank_holiday_hours DECIMAL(6,2)  NOT NULL DEFAULT 0;
ALTER TABLE PayrollArchive ADD bank_holiday_pay   DECIMAL(10,2) NOT NULL DEFAULT 0;
```

Two reasons to keep booked holiday and bank holiday in separate columns
rather than merging into one "non-worked paid hours" bucket:
- The HMRC reporting story is different (booked holiday counts against the
  28-day entitlement; bank holidays don't).
- Operations want to be able to answer "how much did we spend on bank
  holidays last year" without grepping the calendar.

`total_pay` continues to mean "everything we owe them this week" — it now
includes both holiday and bank-holiday pay. `total_hours` continues to mean
"everything that counts as paid time" — it now includes both. Old archived
rows default to 0/0/0/0.

No other table changes. Bank holidays are not stored in the `Holidays`
table — they're derived from the `UK_BANK_HOLIDAYS` constant at calc time.

### `Employees` — no change
We deliberately do **not** add `contracted_hours_per_day`. Decision 1 says
flat 8h. If we ever need per-employee day length, that's a separate change.

---

## Frontend changes (`shared.js`)

### 1. New helper: `getHolidayHoursForEmployee(empName, dateStr)`

Mirrors `getDayHoursForEmployee`. Returns:
- `8` for an approved `paid` holiday on that date
- `4` for an approved `half` holiday on that date
- `0` otherwise

Iterates `state.timesheetData.holidays`, filters by:
- `employeeName === empName`
- `status === 'approved'`
- `type === 'paid' || type === 'half'`
- `dateStr` falls within `[dateFrom, dateTo]` inclusive
- `dateStr` is a working day (not Sat/Sun, not in `UK_BANK_HOLIDAYS`) —
  matches how `working_days` is counted at booking time

### 1b. New helper: `getBankHolidayHoursForEmployee(empName, dateStr)`

Returns `8` if **all** of:
- `dateStr` is in `UK_BANK_HOLIDAYS`
- the employee exists, is `active !== false`, and `payType` is `'payee'`
  (matches the existing `renderPayroll` filter for who appears in the
  payroll table)
- `dateStr` is not a Sat or Sun (defensive — bank holidays in scope are all
  weekdays in practice; if a future BH ever falls on a weekend the rule is
  "no pay" since the employee wasn't going to be working anyway)

Otherwise `0`. No DB lookup — pure derivation from `UK_BANK_HOLIDAYS` and
the employee record.

### 1c. Clock-in guard

Bank-holiday clock-in is blocked at every entry point:
- `index.html` kiosk clock-in flow — check date against `UK_BANK_HOLIDAYS`
  before submitting, show a friendly modal: "Today is a bank holiday — the
  workshop is closed. If this is wrong, speak to the office."
- `mgrAddClockingModal` and `addClockingModal` — same check on the chosen
  date, block submit with a similar message.
- API-side belt-and-braces: `clockings.js` POST handler rejects with 400 if
  the clocking date is in a server-side bank holiday list. (Server keeps
  its own copy — don't trust the client.)

This guard can ship in the same release as the payroll change. There's no
ordering dependency.

### 2. Update `calculatePayroll(employeeName, weekMon, weekSun)`

Sum holiday hours and bank-holiday hours across the week:

```js
let holidayHours = 0;
let bankHolidayHours = 0;
const dayHoliday = {};     // date → booked-holiday hours
const dayBankHoliday = {}; // date → bank-holiday hours

for (let i = 0; i < 7; i++) {
  const d = new Date(weekMon);
  d.setDate(weekMon.getDate() + i);
  const ds = dateStr(d);

  const hh = getHolidayHoursForEmployee(employeeName, ds);
  if (hh > 0) { dayHoliday[ds] = hh; holidayHours += hh; }

  const bh = getBankHolidayHoursForEmployee(employeeName, ds);
  if (bh > 0) { dayBankHoliday[ds] = bh; bankHolidayHours += bh; }
}
```

Pay calculation — booked holiday and bank holiday are mathematically
identical for the 40h-bucket calc (both fill the bucket at basic rate
before worked hours can spill to OT). Treat them as one combined
"non-worked paid hours" figure for the math, and split back out for
display/archive:

```js
const workedHours = totalHours;
const nonWorkedPaidHours = holidayHours + bankHolidayHours;

let basicHours, overtimeHours, doubleHours;

if (doubleTimeApplies) {
  // Sunday hours are always double; non-Sun worked + non-worked-paid
  // share the 40h bucket. (Bank holidays fall on weekdays so they're
  // always non-Sunday.)
  doubleHours = sundayHours;
  const nonSundayWorked = workedHours - sundayHours;
  const nonSundayCombined = nonSundayWorked + nonWorkedPaidHours;

  if (nonSundayCombined <= 40) {
    basicHours = nonSundayWorked;
    overtimeHours = 0;
  } else {
    const basicCapacityForWorked = Math.max(0, 40 - nonWorkedPaidHours);
    basicHours = Math.min(nonSundayWorked, basicCapacityForWorked);
    overtimeHours = nonSundayWorked - basicHours;
  }
} else {
  doubleHours = 0;
  if (workedHours + nonWorkedPaidHours <= 40) {
    basicHours = workedHours;
    overtimeHours = 0;
  } else {
    const basicCapacityForWorked = Math.max(0, 40 - nonWorkedPaidHours);
    basicHours = Math.min(workedHours, basicCapacityForWorked);
    overtimeHours = workedHours - basicHours;
  }
}

const holidayPay     = holidayHours     * rate;  // always basic rate
const bankHolidayPay = bankHolidayHours * rate;  // always basic rate
const basicPay       = basicHours       * rate;
const overtimePay    = overtimeHours    * rate * 1.5;
const doublePay      = doubleHours      * rate * 2;
const totalPay       = basicPay + overtimePay + doublePay + holidayPay + bankHolidayPay;
```

Returned object gains `holidayHours`, `holidayPay`, `dayHoliday`,
`bankHolidayHours`, `bankHolidayPay`, `dayBankHoliday`.

`totalHours` returned to callers becomes
`workedHours + holidayHours + bankHolidayHours` (so the TOTAL HRS column
reflects all paid time). The existing `dayHours` map stays as worked-only —
we merge in the table render so it's visually distinct.

**Edge case — bank-holiday-only week:** the early-return condition becomes
"return null only if worked + holiday + bank-holiday hours all zero" rather
than "no clockings". A payee employee on holiday for a week containing a
bank holiday should still get the BH pay even if they booked the rest off
(unpaid).

### 3. Update `renderPayroll()`

Day-cell render — currently:

```js
${r.dayHrs.map(h => `<td …>${h > 0 ? h.toFixed(1) : '—'}</td>`)}
```

Day-cell render — booked holiday and bank holiday share the same accent
colour and `H` label so the table reads as one concept:

```js
${days.map(d => {
  const worked = r.payroll?.dayHours?.[d.date] || 0;
  const hol    = r.payroll?.dayHoliday?.[d.date] || 0;
  const bh     = r.payroll?.dayBankHoliday?.[d.date] || 0;
  const totalHol = hol + bh; // merged for display

  if (totalHol > 0 && worked === 0) {
    return `<td class="mono" style="text-align:center;color:var(--accent)">
              ${totalHol.toFixed(1)}<sub style="font-size:9px;color:var(--muted)">H</sub>
            </td>`;
  }
  if (worked > 0 && totalHol > 0) {
    // Edge case: half-day holiday + worked half-day. (BH + worked never
    // happens because clock-in is blocked.)
    return `<td class="mono" style="text-align:center">
              ${worked.toFixed(1)}
              <br><span class="hol-badge">+${totalHol.toFixed(1)}H</span>
            </td>`;
  }
  return `<td class="mono" style="text-align:center;color:${worked > 0 ? 'var(--text)' : 'var(--subtle)'}">${worked > 0 ? worked.toFixed(1) : '—'}</td>`;
}).join('')}
```

(New `.hol-badge` class added to bama.css. Same accent colour for booked
and bank — staff don't need to distinguish in the live view.)

One new column inserted between `TOTAL HRS` and `STD (£)`:

```html
<th>HOL (£)</th>
```

```html
<td class="mono" style="color:var(--accent)">
  ${(() => {
    const totalHolHrs = (r.payroll?.holidayHours || 0) + (r.payroll?.bankHolidayHours || 0);
    const totalHolPay = (r.payroll?.holidayPay   || 0) + (r.payroll?.bankHolidayPay   || 0);
    if (totalHolHrs === 0) return '—';
    return `${totalHolHrs}h<br><span style="font-size:11px;color:var(--muted)">£${totalHolPay.toFixed(2)}</span>`;
  })()}
</td>
```

Footer totals row gains a single HOL total. `grandTotal` already includes
`totalPay` which includes both — no change there.

The `min-width:900px` on the table needs bumping to ~980px for the one
new column.

**Note on data preservation:** the `holidayHours` / `holidayPay` /
`bankHolidayHours` / `bankHolidayPay` fields stay separate on the
`payroll` object returned by `calculatePayroll`. Only the *display*
merges. This keeps the door open for a future "BH spend last year"
report or any drill-down without needing to re-derive from the
calendar.

### 4. Filter the empty-state check

```js
}).filter(r => r.totalHrs > 0 || r.payroll);
```

Already covers it because a holiday-only employee will have `r.payroll`
truthy after the change above.

---

## Backend changes (`api/src/functions/payroll.js`)

### `payroll-approve` handler

Current SQL fetches `ProjectHours` only. Add a parallel fetch of approved
holidays for the week:

```sql
SELECT h.employee_id, e.name, e.rate,
       h.date_from, h.date_to, h.type, h.working_days
FROM Holidays h
JOIN Employees e ON e.id = h.employee_id
WHERE h.status = 'approved'
  AND h.type IN ('paid', 'half')
  AND h.date_from <= @weekEnd
  AND h.date_to   >= @weekStart
```

Where `@weekStart = week_commencing` and `@weekEnd = week_commencing + 6 days`.
A holiday range may overlap the week edge — count only the working-day
portion that falls inside the week.

For each overlapping holiday, walk every date in
`MAX(date_from, weekStart) … MIN(date_to, weekEnd)`, skip Sat/Sun and UK bank
holidays (the same `UK_BANK_HOLIDAYS` list — copy to a small server-side
helper or hard-code in `payroll.js`; not worth a shared module yet), and:
- `paid` → +8 hours per working day
- `half` → +4 hours total for the range (half-day holidays are always single-
  day in practice; assert range length = 1 working day)

Aggregate per employee into `holiday_hours`.

**Bank holiday calculation** — separate, in-memory:

```js
// For each active payee employee, count BH days in this week
const ukBankHolidays = require('./bank-holidays'); // server-side copy of UK_BANK_HOLIDAYS

const bhInThisWeek = []; // dates in the week that are bank holidays
for (let i = 0; i < 7; i++) {
  const d = new Date(weekStart);
  d.setDate(weekStart.getDate() + i);
  const ds = formatDate(d); // YYYY-MM-DD
  const dow = d.getDay();
  if (dow !== 0 && dow !== 6 && ukBankHolidays.includes(ds)) {
    bhInThisWeek.push(ds);
  }
}

// Pull every active payee employee, not just those with hours
const payees = await query(`
  SELECT id, name, rate FROM Employees
  WHERE is_active = 1 AND pay_type = 'payee'
`);

// Add bank-holiday hours to every payee's record
for (const payee of payees.recordset) {
  if (!employeeData[payee.id]) {
    employeeData[payee.id] = {
      employee_id: payee.id,
      name: payee.name,
      rate: parseFloat(payee.rate),
      total_hours: 0,
      saturday_worked: false,
      sunday_worked: false,
      sunday_hours: 0,
      holiday_hours: 0,
      bank_holiday_hours: 0,
      daily_hours: {}
    };
  }
  employeeData[payee.id].bank_holiday_hours = bhInThisWeek.length * 8;
}
```

Then apply the same basic/OT/DT math as the frontend, treating
`holiday_hours + bank_holiday_hours` as the combined "non-worked paid"
figure that fills the 40h bucket first.

The current early-return:

```js
if (hours.recordset.length === 0) {
  return badRequest('No project hours found for this week', request);
}
```

becomes:

```js
const hasAnything =
  hours.recordset.length > 0 ||
  holidays.recordset.length > 0 ||
  bhInThisWeek.length > 0;

if (!hasAnything) {
  return badRequest('No project hours, holidays, or bank holidays in this week', request);
}
```

INSERT statement gains `holiday_hours`, `holiday_pay`, `bank_holiday_hours`,
`bank_holiday_pay`. `total_hours` and `total_pay` include all of them.

**One subtle point:** if a week contains a bank holiday and no payee did
any work or booked holiday, every active payee still gets a `PayrollArchive`
row with just `bank_holiday_hours = 8` and corresponding pay. That's
correct — they're owed the bank holiday whether or not anything else
happened that week. The early-return bypasses approval only when there's
nothing at all.

### Server-side bank holiday list

Create `api/src/bank-holidays.js`. Mirror of `UK_BANK_HOLIDAYS` in shared.js
(currently shared.js lines 3338–3345). When the calendar changes, **update
both files**:

```js
// UK bank holidays. MUST stay in sync with UK_BANK_HOLIDAYS in shared.js.
// Roadmap: move to a Settings/DB row so this isn't duplicated.
module.exports = [
  '2025-01-01','2025-04-18','2025-04-21','2025-05-05','2025-05-26',
  '2025-08-25','2025-12-25','2025-12-26',
  '2026-01-01','2026-04-03','2026-04-06','2026-05-04','2026-05-25',
  '2026-08-31','2026-12-25','2026-12-28',
  '2027-01-01','2027-03-26','2027-03-29','2027-05-03','2027-05-31',
  '2027-08-30','2027-12-27','2027-12-28'
];
```

Used by both `payroll-approve` (calc) and `clockings.js` (POST guard —
reject clock-ins on these dates).

All listed dates fall Mon–Fri (verified including substitute days for
2026 Boxing Day and 2027 Christmas/Boxing) so the "BH on a weekend → no
pay" branch in `getBankHolidayHoursForEmployee` is defensive only — it
doesn't fire against the current list.

The existing transaction-block string interpolation comment in CLAUDE.md
("payroll.js interpolates numeric payroll fields inside the transaction
block — values are all parsed numbers, not user input") still holds —
holiday_hours and holiday_pay are computed numerics, safe to interpolate.

### `archive-list` and `archive-weeks`

`archive-list` returns `pa.*` so new columns flow through automatically.
`archive-weeks` aggregates `total_hours` and `total_pay` — both now include
holiday by construction. No code change needed; the numbers will silently
become correct from the first week approved with the new code.

---

## UI: archive view

The existing archive view (`renderArchive` in shared.js, on office.html) reads
`PayrollArchive` rows. Add one merged HOL column that shows
`holiday_hours + bank_holiday_hours` and `holiday_pay + bank_holiday_pay`,
matching the live payroll table. The four underlying columns stay in the
database for any future drill-down report.

---

## Things deliberately NOT in this spec

- **Sickness / SSP.** See roadmap addition below. We ignore sickness entries
  in payroll for now.
- **Unpaid holiday.** Already invisible to payroll, stays that way.
- **Bank-holiday entitlement automation.** UK bank holidays continue to be
  excluded from `working_days` at booking time (so booking across Easter
  doesn't burn the staff member's balance). Unchanged.
- **Bank holidays for CIS staff.** CIS contractors do not get bank holiday
  pay. Same eligibility filter (`pay_type='payee'`) as the rest of payroll.
- **Working on a bank holiday.** Blocked at every clock-in entry point —
  see Frontend section 1c. No code path computes pay for hours worked
  on a bank holiday because the rule is "you can't".
- **Per-employee contracted hours.** Flat 8h for now per Decision 1. If we
  later get a salaried staff member on a 7.5h day, that's a follow-up.
- **Backfilling old archived weeks.** New columns default to 0 on old rows,
  which is wrong-but-harmless: those weeks were already approved and paid
  outside the system. Reports that average across periods will be slightly
  off until enough new weeks accumulate.
- **PayrollArchive revision flow.** If a holiday is approved/edited *after*
  the week has been archived, the archive row won't update. Out of scope —
  same limitation exists today for clocking edits.
- **Bank holiday list maintenance.** UK bank holidays are hard-coded in
  `UK_BANK_HOLIDAYS` (frontend) and the new `api/src/bank-holidays.js`
  (backend). When the calendar changes, both must be updated. Roadmap item:
  move to a `Settings` table entry so it's editable in the UI.
- **Tooltip / drill-down on holiday cell.** Could show "Approved 2026-04-15
  by [name]" on hover later; not in v1.

---

## Roadmap addition (to add to CLAUDE.md when this ships)

> **Sickness / SSP integration.** Sickness and absence entries on the
> `Holidays` table (type other than `paid`/`half`/`unpaid`) are currently
> ignored by payroll. Build SSP triggering: track qualifying days, apply
> the SSP rate after the 3-day waiting period, surface on the payroll page
> alongside holiday pay. Depends on a settings entry for the current SSP
> weekly rate and a per-employee earnings threshold check.
>
> **Bank holiday list to settings.** UK bank holiday dates are duplicated in
> `UK_BANK_HOLIDAYS` (shared.js) and `api/src/bank-holidays.js`. Move to a
> `BankHolidays` table or `Settings` row, editable from manager.html. Keeps
> the calendar accurate without a code deploy each year.

---

## Implementation order (smallest safe steps)

1. **SQL migration** — add `holiday_hours`, `holiday_pay`,
   `bank_holiday_hours`, `bank_holiday_pay` columns (defaults 0). Deploy
   this first; old code keeps working unchanged.
2. **Server-side bank holiday list** — create `api/src/bank-holidays.js`
   with the same dates as `UK_BANK_HOLIDAYS`. Deploy. No behaviour change yet.
3. **Clock-in guard** — `clockings.js` POST handler rejects bank holiday
   dates. Frontend kiosk + add-clocking modals show a friendly block. Bump
   cache-bust. Deploy. (Independent of payroll changes; can ship before
   them.)
4. **Backend `payroll-approve`** — read holidays + compute bank holiday
   hours, write all four new columns. Deploy.
5. **Frontend `calculatePayroll` + `renderPayroll`** — read holidays + bank
   holidays, show one merged HOL column and day-cell badges. Bump cache-
   bust. Deploy.
6. **Archive view** — add merged HOL column to `renderArchive`. Bump
   cache-bust. Deploy.
7. **CLAUDE.md updates** — payroll rules section (document new rules),
   roadmap additions. Same PR as step 5 or 6.

Each step is independently deployable and reversible. Step 3 (clock-in
guard) has no dependency on the payroll changes and can ship as soon as
we agree on it. Steps 4 and 5 should ship close together so the live
payroll table and the archive don't diverge for long, but they don't
strictly have to.

---

## Test cases to write up before pushing

**Booked holiday cases (from rev 1):**
- Employee with no clockings, no holiday → not in table (existing behaviour).
- Employee with clockings only → identical numbers to today.
- Employee with full-day paid holiday + 4 worked days of 8h → 40h total,
  all basic, holiday cell shows 8h, total pay = 40 × rate.
- Employee with paid holiday + 5 days × 9h worked → holiday fills 40h before
  worked overtime kicks in.
- Half-day holiday on Friday → 4h holiday cell, half-day reflected in
  combined-with-40h math.
- Sat + Sun worked + Mon paid holiday → double time on Sun unaffected by
  holiday; holiday + non-Sun worked share the 40h bucket.
- Holiday range spanning week boundary (Fri prev week → Tue this week) →
  only 2 days (Mon, Tue) counted in this week.
- Holiday with `status='pending'` → ignored.
- Bank holiday inside a booked holiday range → excluded from booked-holiday
  count (matches `working_days`), counted as bank-holiday hours instead.
- Approving a week that has only holidays, no clockings → succeeds, archives
  row with holiday-only pay.

**Bank holiday cases (new in rev 2):**
- Active payee, no clockings, no booked holiday, week contains 1 BH →
  archived row shows 8h BH, £160 BH pay (at £20/hr), £0 everything else.
- Active payee, week contains 1 BH + 32h worked Tue–Fri → 40h total,
  all basic worked + BH, no overtime. Matches Example F.
- Active CIS contractor, week contains 1 BH + 40h worked → BH ignored,
  paid 40h × rate at basic. No BH row, no BH pay.
- Inactive employee (`is_active=0`), week contains 1 BH → no payroll row
  generated. (Unchanged from today's "inactive employees don't get paid".)
- Week contains 2 BHs (e.g. Easter Mon + Tue is fictional but the math
  must handle it) → 16h BH × rate.
- Clock-in attempted on a BH from kiosk → blocked, friendly message shown.
- Clock-in POST attempted on a BH directly via API → 400 returned.
- Manager "add clocking" attempt for a BH date → blocked at modal level
  AND backend rejects belt-and-braces.
- Booked holiday spanning a BH (e.g. Mon + Tue + BH-Wed + Thu + Fri) → 4
  days deducted from balance, BH-Wed counted as bank holiday only, total
  paid hours = 5 × 8 = 40, total pay split 32h holiday + 8h BH.
- BH falling on a Saturday or Sunday (rare; e.g. substitute days) → no BH
  pay, no special handling. Roadmap item if this becomes real.
