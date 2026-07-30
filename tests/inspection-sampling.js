// ─────────────────────────────────────────────────────────────────────────────
// tests/inspection-sampling.js — inspection & NDT sampling maths
//
// Two invariants that must never break:
//   1. VISUAL is 100% at every execution class — never sampled, whatever the
//      rules table says.
//   2. Sample counts round UP. Rounding down under-samples, which is the
//      failure mode that matters: it would tell you you're compliant when
//      you're one inspection short.
//
// Run: node tests/inspection-sampling.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const start = src.indexOf('// INSPECTION & NDT SAMPLING (E2, 2026-07-30)');
if (start < 0) { console.error('Could not find the INSPECTION block in shared.js'); process.exit(1); }
eval(src.slice(start).replace(/^const (INSP_|EXEC_CLASSES)/gm, 'var $1').replace(/^let _ndtRules/gm, 'var _ndtRules'));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

console.log('Visual is never sampled');
ok(_inspRequired(100, 10, 'visual') === 100, 'visual ignores the percentage entirely', _inspRequired(100, 10, 'visual'));
ok(_inspRequired(37, 0, 'visual') === 37,    'visual with a 0% rule still requires all 37');
ok(_inspRequired(0, 100, 'visual') === 0,    'no welds → nothing required');

console.log('\nNDT sample counts round UP');
ok(_inspRequired(100, 10, 'UT') === 10,  '100 welds at 10% → 10');
ok(_inspRequired(45, 10, 'UT') === 5,    '45 at 10% = 4.5 → 5, never 4', _inspRequired(45, 10, 'UT'));
ok(_inspRequired(41, 10, 'UT') === 5,    '41 at 10% = 4.1 → 5');
ok(_inspRequired(1, 10, 'UT') === 1,     'a single weld at 10% still needs 1 — you cannot do 0.1');
ok(_inspRequired(100, 20, 'RT') === 20,  'EXC3-style 20% on 100 welds');
ok(_inspRequired(100, 0, 'UT') === 0,    '0% rule → nothing required');
ok(_inspRequired(0, 10, 'UT') === 0,     'no population → nothing required');
ok(_inspRequired(100, 100, 'UT') === 100, '100% → every weld');
ok(_inspRequired(100, 150, 'UT') === 100, 'a nonsense >100% rule is clamped, not multiplied');
ok(_inspRequired(100, -5, 'UT') === 0,    'a negative percentage is clamped to 0');
ok(_inspRequired('60', '10', 'UT') === 6, 'string inputs from form fields coerce');
ok(_inspRequired(null, 10, 'UT') === 0,   'null population → 0, never NaN');

console.log('\nJob progress — required vs done');
const rules = [
  { exec_class: 'EXC2', weld_category: 'Butt tension', utilisation: 'U>=0.5', pct_required: 10, verified: 1, method_hint: 'UT or RT' },
  { exec_class: 'EXC2', weld_category: 'Butt tension', utilisation: 'U<0.5',  pct_required: 0,  verified: 1, method_hint: 'UT or RT' },
  { exec_class: 'EXC2', weld_category: 'Fillet',       utilisation: null,     pct_required: 0,  verified: 0, method_hint: 'MT or PT' },
  { exec_class: 'EXC3', weld_category: 'Butt tension', utilisation: 'U>=0.5', pct_required: 20, verified: 0, method_hint: 'UT or RT' }
];
const plan = { exec_class: 'EXC2', weld_counts: JSON.stringify({ 'Butt tension': 80, 'Fillet': 200 }) };
let prog = _inspProgress(plan, [], rules);
const butt = prog.find(p => p.category === 'Butt tension');
const fillet = prog.find(p => p.category === 'Fillet');
ok(butt.pct === 10,             'the higher utilisation variant is assumed until told otherwise', String(butt.pct));
ok(butt.ndtRequired === 8,      '80 butt welds at 10% → 8 NDT', String(butt.ndtRequired));
ok(butt.visualRequired === 80,  'all 80 need visual');
ok(fillet.ndtRequired === 0,    'fillets at EXC2 need no supplementary NDT');
ok(fillet.visualRequired === 200, 'but all 200 fillets still need visual');
ok(fillet.unverified === true,  'an unverified rule is flagged so the UI can warn');
ok(butt.unverified === false,   'a verified rule is not flagged');

const records = [
  { weld_category: 'Butt tension', inspection_type: 'UT',     weld_count: 5, result: 'pass' },
  { weld_category: 'Butt tension', inspection_type: 'RT',     weld_count: 2, result: 'pass' },
  { weld_category: 'Butt tension', inspection_type: 'visual', weld_count: 80, result: 'pass' },
  { weld_category: 'Butt tension', inspection_type: 'UT',     weld_count: 1, result: 'fail' },
  { weld_category: 'Fillet',       inspection_type: 'visual', weld_count: 150, result: 'pass' }
];
prog = _inspProgress(plan, records, rules);
const b2 = prog.find(p => p.category === 'Butt tension');
const f2 = prog.find(p => p.category === 'Fillet');
ok(b2.ndtDone === 8,        'NDT of any method counts toward the sample (5 UT + 2 RT + 1 UT)', String(b2.ndtDone));
ok(b2.ndtShort === 0,       'sample met → no shortfall');
ok(b2.visualShort === 0,    'visual complete');
ok(b2.failures === 1,       'failures are counted separately from the sample');
ok(f2.visualShort === 50,   'fillet visual is 50 short of the required 200', String(f2.visualShort));
ok(f2.ndtShort === 0,       'no NDT required, so no NDT shortfall');

console.log('\nExecution class changes the requirement');
const plan3 = { exec_class: 'EXC3', weld_counts: JSON.stringify({ 'Butt tension': 80 }) };
const p3 = _inspProgress(plan3, [], rules).find(p => p.category === 'Butt tension');
ok(p3.pct === 20,          'EXC3 picks up the EXC3 rule, not the EXC2 one', String(p3.pct));
ok(p3.ndtRequired === 16,  '80 at 20% → 16');
ok(p3.unverified === true, 'unverified EXC3 rule is flagged');
const planNoRule = { exec_class: 'EXC1', weld_counts: JSON.stringify({ 'Butt tension': 80 }) };
const p1 = _inspProgress(planNoRule, [], rules).find(p => p.category === 'Butt tension');
ok(p1.pct === 0 && p1.ndtRequired === 0, 'no rule for that class → 0% required, never a guess');
ok(p1.visualRequired === 80, 'but visual is still 100% even with no NDT rule');

console.log('\nEdge cases');
ok(_inspProgress({ exec_class: 'EXC2', weld_counts: null }, [], rules).length === 0,
   'no weld counts entered → nothing claimed');
ok(_inspProgress({ exec_class: 'EXC2', weld_counts: '{bad json' }, [], rules).length === 0,
   'corrupt weld_counts JSON does not throw');
ok(_inspProgress({ exec_class: 'EXC2', weld_counts: '{}' }, records, rules).length === 2,
   'categories with records but no population still appear (over-inspection is visible)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
