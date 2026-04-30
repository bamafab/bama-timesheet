// UK bank holidays. MUST stay in sync with UK_BANK_HOLIDAYS in shared.js
// (currently around line 3338). When the calendar changes, update both files.
//
// Used by:
//   - api/src/functions/clockings.js — POST guard rejects clock-ins on these dates
//   - api/src/functions/payroll.js — auto-pays 8h × basic rate per BH to active payees
//
// Roadmap: move to a Settings/DB row so the calendar can be edited without
// a code deploy each year.

const UK_BANK_HOLIDAYS = [
  '2025-01-01','2025-04-18','2025-04-21','2025-05-05','2025-05-26',
  '2025-08-25','2025-12-25','2025-12-26',
  '2026-01-01','2026-04-03','2026-04-06','2026-05-04','2026-05-25',
  '2026-08-31','2026-12-25','2026-12-28',
  '2027-01-01','2027-03-26','2027-03-29','2027-05-03','2027-05-31',
  '2027-08-30','2027-12-27','2027-12-28'
];

function isBankHoliday(dateStr) {
  return UK_BANK_HOLIDAYS.includes(dateStr);
}

module.exports = { UK_BANK_HOLIDAYS, isBankHoliday };
