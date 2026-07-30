// ─────────────────────────────────────────────────────────────────────────────
// tests/itp-generate.js — ITP row generation (F1a)
//
// The ITP is a document a client holds BAMA to, so the invariant that matters
// is that it can never promise something different from what the inspection
// register actually requires. Both read the same plan and the same verified
// NdtExtentRules, and these tests pin that they stay in step.
//
// Run: node tests/itp-generate.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const inspStart = src.indexOf('// INSPECTION & NDT SAMPLING (E2, 2026-07-30)');
const itpStart = src.indexOf('// INSPECTION & TEST PLAN (F1a, 2026-07-30)');
if (inspStart < 0 || itpStart < 0) { console.error('Could not find the required blocks in shared.js'); process.exit(1); }
// Both blocks: the ITP must agree with the E2 sampling maths.
eval(src.slice(inspStart, itpStart).replace(/^const (INSP_|EXEC_CLASSES)/gm, 'var $1').replace(/^let _ndtRules/gm, 'var _ndtRules'));
eval(src.slice(itpStart).replace(/^const ITP_/gm, 'var ITP_'));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

const rules = [
  { exec_class: 'EXC2', weld_category: 'Butt tension', utilisation: 'U>=0.5', pct_required: 10, verified: 1, method_hint: 'UT or RT' },
  { exec_class: 'EXC2', weld_category: 'Butt tension', utilisation: 'U<0.5',  pct_required: 0,  verified: 1, method_hint: 'UT or RT' },
  { exec_class: 'EXC2', weld_category: 'Fillet',       utilisation: null,     pct_required: 0,  verified: 0, method_hint: 'MT or PT' },
  { exec_class: 'EXC3', weld_category: 'Butt tension', utilisation: 'U>=0.5', pct_required: 20, verified: 0, method_hint: 'UT or RT' }
];
const plan2 = { exec_class: 'EXC2', weld_counts: JSON.stringify({ 'Butt tension': 80, 'Fillet': 200 }) };

console.log('Structure');
let rows = itpGenerateRows(plan2, rules);
ok(rows.length > ITP_TEMPLATE.length, 'inspection rows are inserted on top of the standard activities', String(rows.length));
ok(rows.every(r => r.activity && r.activity.trim()), 'every row has an activity');
ok(rows.every(r => ['H', 'W', 'S', 'R'].includes(r.intervention)), 'every intervention is a valid type');
ok(rows.every(r => r.is_auto === 1), 'generated rows are marked auto so regeneration can refresh them');
ok(rows.every((r, i) => i === 0 || r.seq > rows[i - 1].seq), 'seq is strictly increasing');
ok(itpGenerateRows(null, rules).length === 0, 'no plan → no rows, never a throw');
const corrupt = itpGenerateRows({ exec_class: 'EXC2', weld_counts: '{bad' }, rules);
ok(corrupt.length >= ITP_TEMPLATE.length && ITP_TEMPLATE.every(t => corrupt.some(r => r.activity === t.activity)),
   'corrupt weld_counts still yields every standard activity, no throw', String(corrupt.length));
ok(corrupt.some(r => r.inspection_type === 'visual'),
   'and still lists the weld categories from the rules table (population just unknown)');
ok(!/of 0 welds/.test(corrupt.map(r => r.frequency || '').join(' ')),
   'with no population it does not print a nonsense "0 of 0 welds" count');

console.log('\nVisual is 100% on every category, every class');
const visuals = rows.filter(r => r.inspection_type === 'visual');
ok(visuals.length === 2, 'one visual row per weld category', String(visuals.length));
ok(visuals.every(r => /100%/.test(r.frequency)), 'visual frequency is always 100%');
ok(visuals.every(r => r.intervention === 'H'), 'visual is a hold point');
const filletVisual = visuals.find(r => /Fillet/.test(r.activity));
ok(!!filletVisual, 'fillets get a visual row even though they need no NDT');

console.log('\nNDT rows come from the verified rules — and only where required');
const ndts = rows.filter(r => r.inspection_type && r.inspection_type !== 'visual');
ok(ndts.length === 1, 'only the category with a non-zero percentage gets an NDT row', String(ndts.length));
ok(/Butt tension/.test(ndts[0].activity), 'and it is the butt welds, not the fillets');
ok(/10%/.test(ndts[0].frequency), 'the percentage on the document matches the rules table', ndts[0].frequency);
ok(/8 of 80/.test(ndts[0].frequency), 'the count is spelled out: 8 of 80', ndts[0].frequency);
ok(ndts[0].intervention === 'W', 'third-party NDT is a witness point');
ok(/Third party/.test(ndts[0].responsibility), 'responsibility is the NDT subcontractor');

console.log('\nThe ITP and the sampling register cannot disagree');
const prog = _inspProgress(plan2, [], rules);
const buttProg = prog.find(p => p.category === 'Butt tension');
const itpRequired = Number(/\((\d+) of/.exec(ndts[0].frequency)[1]);
ok(itpRequired === buttProg.ndtRequired,
   `ITP says ${itpRequired}, register requires ${buttProg.ndtRequired} — same number`,
   `${itpRequired} vs ${buttProg.ndtRequired}`);
const rows3 = itpGenerateRows({ exec_class: 'EXC3', weld_counts: JSON.stringify({ 'Butt tension': 80 }) }, rules);
const ndt3 = rows3.find(r => r.inspection_type && r.inspection_type !== 'visual');
ok(/20%/.test(ndt3.frequency) && /16 of 80/.test(ndt3.frequency), 'EXC3 doubles it on the document too', ndt3.frequency);
const prog3 = _inspProgress({ exec_class: 'EXC3', weld_counts: JSON.stringify({ 'Butt tension': 80 }) }, [], rules);
ok(prog3.find(p => p.category === 'Butt tension').ndtRequired === 16, 'and the register agrees at EXC3');

console.log('\nUnverified percentages are flagged ON the document');
ok(/to be confirmed/.test(ndt3.acceptance), 'an unverified EXC3 extent says so in the acceptance column');
ok(!!ndt3.notes && /not yet verified/.test(ndt3.notes), 'and carries a note');
const verifiedNdt = rows.find(r => r.inspection_type === 'UT' && /Butt tension/.test(r.activity));
ok(!/to be confirmed/.test(verifiedNdt.acceptance), 'a verified extent carries no caveat');
ok(!verifiedNdt.notes, 'and no note');

console.log('\nLive progress against real records');
const records = [
  { weld_category: 'Butt tension', inspection_type: 'visual', weld_count: 60, result: 'pass' },
  { weld_category: 'Butt tension', inspection_type: 'UT',     weld_count: 3,  result: 'pass' }
];
const vp = itpRowProgress(visuals.find(r => /Butt tension/.test(r.activity)), plan2, records);
ok(vp.required === 80 && vp.done === 60 && vp.short === 20, 'visual: 60 of 80 done, 20 short', JSON.stringify(vp));
const np = itpRowProgress(ndts[0], plan2, records);
ok(np.required === 8 && np.done === 3 && np.short === 5, 'NDT: 3 of 8 done, 5 short', JSON.stringify(np));
ok(itpRowProgress({ activity: 'Fit-up inspection' }, plan2, records) === null,
   'a non-inspection row has no progress figure rather than a misleading zero');

console.log('\nStandard activities are sane');
ok(ITP_TEMPLATE.some(t => /Fit-up/.test(t.activity) && t.intervention === 'H'), 'fit-up is a hold point');
ok(ITP_TEMPLATE.some(t => /Welder qualification/.test(t.activity)), 'welder qualification is checked');
ok(ITP_TEMPLATE.some(t => /Declaration of Performance/.test(t.activity)), 'release covers the DoP');
ok(ITP_TEMPLATE.every(t => t.stage && t.acceptance && t.record_ref), 'every standard row has stage, acceptance and a record reference');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
