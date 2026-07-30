// ─────────────────────────────────────────────────────────────────────────────
// tests/traceability.js — material traceability chain
//
// The property that matters: the report must never claim a stronger level of
// traceability than the records support. Piece level requires an allocation
// against that specific assembly; everything else is contract level at best.
//
// Run: node tests/traceability.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const block = shared.slice(shared.indexOf('// MATERIAL TRACEABILITY (2026-07-30)'));
eval(block.replace(/^const TRACE_/gm, 'var TRACE_'));

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

const assemblies = [
  { id: 1, assembly_mark: 'B1', quantity: 4, total_weight_kg: 320, status: 'complete' },
  { id: 2, assembly_mark: 'B2', quantity: 2, total_weight_kg: 180, status: 'fabricated' },
  { id: 3, assembly_mark: 'C1', quantity: 1, total_weight_kg: 95,  status: 'pending' }
];
const heats = [
  { heat: 'A210045', section: 'UB 305x165x40', grade: 'S355JR' },
  { heat: 'A210046', section: 'UC 203x203x46', grade: 'S355JR' },
  { heat: 'B990001', section: 'PFC 200x90', grade: 'S275JR' }
];
const actions = [
  { assembly_id: 1, stage: 'fab',      qty: 4, operator_name: 'Craig Weeson', welding_machine_id: null },
  { assembly_id: 1, stage: 'weld',     qty: 4, operator_name: 'Rafal Zalupski', welding_machine_id: 7 },
  { assembly_id: 1, stage: 'complete', qty: 4, operator_name: 'Rafal Zalupski', welding_machine_id: 7 },
  { assembly_id: 2, stage: 'fab',      qty: 2, operator_name: 'Craig Weeson', welding_machine_id: null }
];
const despatches = [{ assembly_mark: 'B1', qty: 4, dn: 'DN-1001' }];

console.log('Traceability level is never overstated');
let c = traceBuildChain({ assemblies, heats, allocations: [], actions, despatches });
ok(c.rows.every(r => r.level === 'contract'), 'heats on the job but none allocated → contract level, never piece');
ok(c.counts.contract === 3 && c.counts.piece === 0, 'counts reflect that');
ok(c.overallLevel === 'contract', 'the overall verdict is contract level');

const allocations = [
  { assembly_id: 1, assembly_mark: 'B1', heat_no: 'A210045', section: 'UB 305x165x40', grade: 'S355JR' },
  { assembly_id: 1, assembly_mark: 'B1', heat_no: 'A210046', section: 'UC 203x203x46', grade: 'S355JR' }
];
c = traceBuildChain({ assemblies, heats, allocations, actions, despatches });
const b1 = c.rows.find(r => r.mark === 'B1');
const b2 = c.rows.find(r => r.mark === 'B2');
ok(b1.level === 'piece', 'an allocated assembly reaches piece level');
ok(b1.heats.length === 2, 'and lists every heat allocated to it', JSON.stringify(b1.heats));
ok(b2.level === 'contract', 'an unallocated assembly on the same job stays contract level');
ok(c.overallLevel === 'contract', 'the job overall is only as good as its weakest assembly');
ok(c.counts.piece === 1 && c.counts.contract === 2, 'mixed counts are reported honestly');

const allAlloc = assemblies.map(a => ({ assembly_id: a.id, assembly_mark: a.assembly_mark, heat_no: 'A210045' }));
c = traceBuildChain({ assemblies, heats, allocations: allAlloc, actions, despatches });
ok(c.overallLevel === 'piece', 'every assembly allocated → piece level overall');

c = traceBuildChain({ assemblies, heats: [], allocations: [], actions, despatches });
ok(c.rows.every(r => r.level === 'none'), 'no heat numbers recorded at all → "none", not "contract"');
ok(c.overallLevel === 'none', 'and the job verdict says so');

console.log('\nUnallocated heats are surfaced, not hidden');
c = traceBuildChain({ assemblies, heats, allocations, actions, despatches });
ok(c.unallocated.length === 1 && c.unallocated[0].heat === 'B990001',
   'a heat received but never used is listed', JSON.stringify(c.unallocated.map(h => h.heat)));
ok(c.heatCount === 3, 'the received-heat count is reported');
ok(traceBuildChain({ assemblies, heats, allocations: allAlloc, actions, despatches }).unallocated.length === 2,
   'heats not matching any allocation remain flagged');

console.log('\nFabrication history is joined per assembly');
ok(b1.fabricatedBy[0] === 'Craig Weeson', 'fabricator captured');
ok(b1.weldedBy[0] === 'Rafal Zalupski',   'welder captured');
ok(b1.machines[0] === 7,                  'welding machine captured');
ok(b1.qtyFab === 4 && b1.qtyWeld === 4 && b1.qtyComplete === 4, 'stage quantities summed');
ok(b2.weldedBy.length === 0,              'an unwelded assembly reports no welder rather than inheriting one');
ok(b1.despatched.length === 1 && b1.despatched[0].dn === 'DN-1001', 'despatch joined by mark');
ok(b2.despatched.length === 0,            'not-yet-despatched shows nothing');
const c1 = c.rows.find(r => r.mark === 'C1');
ok(c1.fabricatedBy.length === 0 && c1.qtyFab === 0, 'an untouched assembly is empty, not undefined');

console.log('\nMatching is forgiving where the data is messy');
const byMark = traceBuildChain({ assemblies,  heats,
  allocations: [{ assembly_id: null, assembly_mark: 'B2', heat_no: 'A210046' }], actions, despatches });
ok(byMark.rows.find(r => r.mark === 'B2').level === 'piece',
   'an allocation with no assembly_id still matches on mark');
const caseDesp = traceBuildChain({ assemblies, heats, allocations, actions,
  despatches: [{ assembly_mark: ' b1 ', qty: 4, dn: 'DN-2' }] });
ok(caseDesp.rows.find(r => r.mark === 'B1').despatched.length === 1, 'despatch mark matching ignores case and spaces');

console.log('\nEmpty and malformed inputs');
ok(traceBuildChain({}).rows.length === 0, 'nothing at all → no rows, no throw');
ok(traceBuildChain({ assemblies: [], heats: [], allocations: [], actions: [], despatches: [] }).overallLevel === 'contract',
   'an empty job does not claim piece level');

console.log('\nReverse lookup: where was this heat used');
ok(traceWhereUsed('A210045', allocations).length === 1, 'finds the assembly a heat went into');
ok(traceWhereUsed('a210045 ', allocations).length === 1, 'tolerant of case and whitespace');
ok(traceWhereUsed('NOPE', allocations).length === 0, 'unknown heat → nothing, not everything');
ok(traceWhereUsed('', allocations).length === 0, 'empty query → nothing');
ok(traceWhereUsed('A210045', null).length === 0, 'null allocations → nothing, no throw');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
