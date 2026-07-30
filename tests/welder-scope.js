// ─────────────────────────────────────────────────────────────────────────────
// tests/welder-scope.js — welder qualification validity + scope checking
//
// This is a compliance module: a wrong "yes" here means an unqualified weld
// gets made and signed off. Two things are pinned:
//   1. Both validity clocks — the certificate expiry AND the 6-month employer
//      confirmation (EN ISO 9606-1 §9.2). Either one lapsing makes the
//      qualification unusable, even if the other looks fine.
//   2. Scope is COMPARED against the printed range, never inferred. A
//      certificate that prints PF does not license PC; a missing range is
//      reported as "check by hand", never treated as approval.
//
// Run: node tests/welder-scope.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const start = src.indexOf('// WELDER APPROVALS (E1, 2026-07-30)');
if (start < 0) { console.error('Could not find the WELDER APPROVALS block in shared.js'); process.exit(1); }
eval(src.slice(start).replace(/^const (WELD_|_WELD)/gm, 'var $1').replace(/^let _weld/gm, 'var _weld'));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

// A realistic EN ISO 9606-1 certificate: 135, M11, plate, butt welds,
// 3–24mm, positions PA PB PC PF, confirmed to 2026-11-30, expires 2028-05-01.
const base = {
  id: 1, person_name: 'Rafal Zalupski', cert_no: 'WQ-1042', status: 'valid',
  standard: 'EN ISO 9606-1', process: '135', material_group: 'M11',
  product_form: 'plate', joint_type: 'BW',
  thickness_min: 3, thickness_max: 24, diameter_min: null, diameter_max: null,
  positions: 'PA,PB,PC,PF', confirm_due: '2026-11-30', expiry_date: '2028-05-01'
};
const ON = '2026-07-30';   // fixed "today" so the tests don't rot

console.log('Validity — two independent clocks');
ok(weldQualValidity(base, ON).usable, 'in date on both clocks → usable');
ok(!weldQualValidity({ ...base, expiry_date: '2026-06-01' }, ON).usable, 'expired certificate → not usable');
ok(!weldQualValidity({ ...base, confirm_due: '2026-06-01' }, ON).usable,
   'certificate in date but 6-month confirmation overdue → NOT usable');
ok(/confirmation overdue/.test(weldQualValidity({ ...base, confirm_due: '2026-06-01' }, ON).reason),
   'the reason names the confirmation, not the expiry');
ok(!weldQualValidity({ ...base, status: 'revoked' }, ON).usable,    'revoked → not usable');
ok(!weldQualValidity({ ...base, status: 'superseded' }, ON).usable, 'superseded → not usable');
ok(weldQualValidity({ ...base, confirm_due: null, expiry_date: null }, ON).usable,
   'no dates recorded → not blocked (nothing to contradict), flagged elsewhere');
ok(weldQualValidity(base, '2029-01-01').usable === false, 'checking a future date applies the same rules');

console.log('\nProcess and material group');
ok(_weldScopeCheck(base, { process: '135', onDate: ON }).ok,      'same process passes');
ok(!_weldScopeCheck(base, { process: '141', onDate: ON }).ok,     'different process fails (135 ≠ 141)');
ok(!_weldScopeCheck(base, { process: '136', onDate: ON }).ok,     '135 does not cover 136');
ok(_weldScopeCheck(base, { material_group: 'M11', onDate: ON }).ok, 'matching material group passes');
ok(!_weldScopeCheck(base, { material_group: 'M21', onDate: ON }).ok, 'different material group fails');
ok(_weldScopeCheck({ ...base, material_group: 'M11,M21' }, { material_group: 'M21', onDate: ON }).ok,
   'multi-group certificate covers either group');
const noGroup = _weldScopeCheck({ ...base, material_group: null }, { material_group: 'M11', onDate: ON });
ok(noGroup.ok && noGroup.notes.length, 'missing group → passes with a "check by hand" note, not a silent yes');

console.log('\nThickness — compared against the PRINTED range');
ok(_weldScopeCheck(base, { thickness: 12, onDate: ON }).ok,   '12mm inside 3–24mm');
ok(_weldScopeCheck(base, { thickness: 3, onDate: ON }).ok,    'exactly at the lower bound');
ok(_weldScopeCheck(base, { thickness: 24, onDate: ON }).ok,   'exactly at the upper bound');
ok(!_weldScopeCheck(base, { thickness: 2.5, onDate: ON }).ok, '2.5mm below range fails');
ok(!_weldScopeCheck(base, { thickness: 30, onDate: ON }).ok,  '30mm above range fails');
ok(/above the approved range/.test(_weldScopeCheck(base, { thickness: 30, onDate: ON }).fails[0]),
   'the failure says which way it is out');
const noThk = _weldScopeCheck({ ...base, thickness_min: null, thickness_max: null }, { thickness: 40, onDate: ON });
ok(noThk.ok && noThk.notes.length, 'no printed thickness range → note, never invented approval');
ok(_weldScopeCheck({ ...base, thickness_max: null }, { thickness: 500, onDate: ON }).ok,
   'open-ended upper bound respected (min printed, max blank)');

console.log('\nPositions — membership only, no coverage rules invented');
ok(_weldScopeCheck(base, { position: 'PF', onDate: ON }).ok,   'PF is in the approved list');
ok(_weldScopeCheck(base, { position: 'pf', onDate: ON }).ok,   'case-insensitive');
ok(!_weldScopeCheck(base, { position: 'PG', onDate: ON }).ok,  'PG not approved → fails');
ok(!_weldScopeCheck({ ...base, positions: 'PF' }, { position: 'PC', onDate: ON }).ok,
   'PF does NOT silently license PC — coverage rules are not inferred');
ok(_weldScopeCheck({ ...base, positions: 'PA PB PC PF' }, { position: 'PB', onDate: ON }).ok,
   'space-separated positions parse');
ok(_weldScopeCheck({ ...base, positions: 'PA/PB/H-L045' }, { position: 'H-L045', onDate: ON }).ok,
   'slash-separated and hyphenated positions parse');

console.log('\nDiameter, joint type, product form');
const pipe = { ...base, product_form: 'pipe', diameter_min: 25, diameter_max: 150 };
ok(_weldScopeCheck(pipe, { diameter: 100, onDate: ON }).ok,      'Ø100 inside 25–150');
ok(!_weldScopeCheck(pipe, { diameter: 200, onDate: ON }).ok,     'Ø200 above range fails');
ok(!_weldScopeCheck(base, { product_form: 'pipe', onDate: ON }).ok, 'plate certificate does not cover pipe');
ok(_weldScopeCheck({ ...base, product_form: 'both' }, { product_form: 'pipe', onDate: ON }).ok,
   "'both' covers pipe");
ok(!_weldScopeCheck(base, { joint_type: 'FW', onDate: ON }).ok,   'BW certificate does not cover FW');
ok(_weldScopeCheck({ ...base, joint_type: 'both' }, { joint_type: 'FW', onDate: ON }).ok, "'both' covers FW");

console.log('\nCombined failures and the person-level check');
const multi = _weldScopeCheck(base, { process: '141', thickness: 40, position: 'PG', onDate: ON });
ok(!multi.ok && multi.fails.length === 3, 'every reason is reported, not just the first', JSON.stringify(multi.fails));
const lapsedAndOut = _weldScopeCheck({ ...base, confirm_due: '2026-01-01' }, { thickness: 40, onDate: ON });
ok(lapsedAndOut.fails.length === 2, 'validity and scope failures both surface');

_weldQuals = [
  base,
  { ...base, id: 2, cert_no: 'WQ-1043', process: '141', thickness_min: 1.5, thickness_max: 8, positions: 'PA,PC' },
  { ...base, id: 3, cert_no: 'WQ-0900', process: '135', expiry_date: '2026-01-01' }   // expired duplicate
];
ok(weldCheckPerson('Rafal Zalupski', { process: '141', thickness: 5, position: 'PC', onDate: ON }).ok,
   'person-level check finds the right certificate among several');
ok(weldCheckPerson('Rafal Zalupski', { process: '141', thickness: 5, position: 'PC', onDate: ON }).match.cert_no === 'WQ-1043',
   'names which certificate covers the work');
ok(!weldCheckPerson('Rafal Zalupski', { process: '111', onDate: ON }).ok, 'process nobody holds → not covered');
ok(!weldCheckPerson('Nobody At All', { process: '135', onDate: ON }).ok,  'unknown person → not covered');
ok(weldCheckPerson('  rafal zalupski  ', { process: '135', thickness: 12, onDate: ON }).ok,
   'name matching tolerates case and stray spaces');
ok(weldCheckPerson('Rafal Zalupski', { process: '135', thickness: 12, onDate: ON }).match.cert_no === 'WQ-1042',
   'expired duplicate is not the one chosen');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
