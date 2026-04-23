// ═══════════════════════════════════════════════════════════════════════════
// REPLACEMENTS for 3 existing functions in shared.js
// These read from settings.templates (via the core builders) instead of
// hardcoding company details, colours, and footer text.
// Behaviour is identical when settings are empty — the defaults reproduce
// the current hardcoded output exactly.
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════
// REPLACE EXISTING generatePayrollPDF() (currently ~line 5291 in shared.js)
// ═══════════════════════════════════════════
async function generatePayrollPDF() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');
  const results = employees.map(e => calculatePayroll(e.name, mon, sun)).filter(Boolean);

  if (!results.length) { toast('No payroll data to export', 'error'); return; }

  const totals = {
    basic: results.reduce((s, r) => s + r.basicPay, 0),
    ot: results.reduce((s, r) => s + r.overtimePay, 0),
    dt: results.reduce((s, r) => s + r.doublePay, 0),
    grand: results.reduce((s, r) => s + r.totalPay, 0)
  };
  const weekStr = `${fmtDate(mon)} – ${fmtDate(sun)}`;

  // Ensure logo is loaded into cache so it embeds in the print window
  await loadLogoDataUri();

  const html = buildPayrollHTML({ results, totals, weekStr });
  const printWin = window.open('', '_blank');
  printWin.document.write(html + `<script>window.onload = function() { window.print(); }<\/script>`);
  printWin.document.close();
}


// ═══════════════════════════════════════════
// REPLACE EXISTING exportAttendancePDF() (currently ~line 4469 in shared.js)
// ═══════════════════════════════════════════
async function exportAttendancePDF() {
  const empFilter = document.getElementById('rptEmployeeFilter')?.value || '';
  const data = getAttendanceData(empFilter);
  const general = getPeriodData(empFilter);
  const { from, to } = getReportDateRange();
  const periodLabels = { week: 'This Week', month: 'This Month', year: 'This Year' };
  let periodLabel = periodLabels[rptPeriod];
  if (rptOffset !== 0) {
    if (rptPeriod === 'week') periodLabel = `Week of ${fmtDateStr(from)}`;
    else if (rptPeriod === 'month') {
      const d = new Date(from + 'T12:00:00');
      periodLabel = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    } else periodLabel = from.slice(0, 4);
  }
  const filterLabel = empFilter ? ` — ${empFilter}` : ' — All Employees';

  await loadLogoDataUri();

  const html = buildAttendanceHTML({
    periodLabel,
    from: fmtDateStr(from),
    to: fmtDateStr(to),
    filterLabel,
    general,
    data
  });
  const printWin = window.open('', '_blank');
  printWin.document.write(html + `<script>window.onload = function() { window.print(); }<\/script>`);
  printWin.document.close();
}


// ═══════════════════════════════════════════
// REPLACE EXISTING buildDeliveryNoteHTML() (currently ~line 7962 in shared.js)
// Note: this is the real (non-core) wrapper. It's now a thin pass-through to
// the core builder, so it stays the same signature used by existing callers
// (saveDeliveryNotePDFToSharePoint, printDeliveryNote).
// ═══════════════════════════════════════════
function buildDeliveryNoteHTML(dn, bomJob, proj, job) {
  // Logo is expected to already be in cache at this point.
  // For safety, callers of this should await loadLogoDataUri() first.
  return buildDeliveryNoteHTMLCore(dn, bomJob, proj, job);
}


// ═══════════════════════════════════════════
// SMALL EDITS — one-line tweaks to existing functions
// ═══════════════════════════════════════════

// ── 1. saveDeliveryNotePDFToSharePoint() — add await for logo BEFORE buildDeliveryNoteHTML() ──
// Find the line near the top of the function: `const html = buildDeliveryNoteHTML(dn, bomJob, proj, job);`
// Change it to TWO lines:
//     await loadLogoDataUri();
//     const html = buildDeliveryNoteHTML(dn, bomJob, proj, job);

// ── 2. printDeliveryNote() — same thing ──
// Find: `const html = buildDeliveryNoteHTML(dn, bomJob, currentProject || {}, currentJob || {});`
// Change to:
//     await loadLogoDataUri();
//     const html = buildDeliveryNoteHTML(dn, bomJob, currentProject || {}, currentJob || {});
// (printDeliveryNote is already async so no other changes needed.)
