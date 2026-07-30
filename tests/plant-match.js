// ─────────────────────────────────────────────────────────────────────────────
// tests/plant-match.js — Plant Register certificate matcher + docs index
//
// The matcher decides which plant item an externally-issued certificate belongs
// to. Getting it wrong files a LOLER cert against the wrong crane, so it's
// pinned here. Run: node tests/plant-match.js  (exit 1 on any failure)
//
// Extracts the module from the live shared.js at runtime — same self-healing
// approach as tests/golden-quotes.js, so it always tests what ships.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const start = src.indexOf('// PLANT REGISTER (2026-07-30)');
if (start < 0) { console.error('Could not find the Plant Register block in shared.js'); process.exit(1); }
const block = src.slice(start);

global.document = { getElementById: () => null, createElement: () => ({ set innerHTML(v) {}, firstElementChild: {} }) };
global.toast = () => {};
global.escapeHtml = s => String(s ?? '');
global.api = {};
global.getOrCreateSubfolder = async () => ({ id: 'x' });
global.BAMA_DRIVE_ID = 'd';
global.docExpiryInfo = () => ({ sort: 0, badge: '' });
eval(block.replace(/^const (PLANT_|_PLANT)/gm, 'var $1').replace(/^let _plant/gm, 'var _plant'));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

_plantItems = [
  { id: 1, plant_ref: 'P-001', name: 'Genie GS-1932 Scissor Lift',     make: 'Genie',    model: 'GS-1932',     serial_no: 'GS3216A-12345', status: 'in_service' },
  { id: 2, plant_ref: 'P-002', name: 'Mitutoyo Vernier Caliper 150mm', make: 'Mitutoyo', model: '500-196-30',  serial_no: 'MT99881',       status: 'in_service' },
  { id: 3, plant_ref: 'P-003', name: '2 Leg Chain Sling 1.5t',         make: 'Pewag',    model: null,          serial_no: 'CS-7781',       status: 'in_service' },
  { id: 4, plant_ref: 'P-004', name: 'Old Genie GS-1932 Scissor Lift', make: 'Genie',    model: 'GS-1932',     serial_no: 'GS3216A-99999', status: 'disposed' }
];

console.log('Certificate → plant item matching');
const m = p => _plantBestMatch(p);
ok(m({ serial: 'GS3216A-12345' }).item?.id === 1,               'exact serial number');
ok(m({ serial: 'gs3216a 12345' }).item?.id === 1,               'serial with different case / punctuation');
ok(m({ serial: '3216A-12345' }).item?.id === 1,                 'partial serial (cert drops a prefix)');
ok(m({ asset_ref: 'P-002' }).item?.id === 2,                    'asset ref printed on the cert');
ok(m({ make: 'Mitutoyo', model: '500-196-30' }).item?.id === 2, 'make + model when no serial printed');
ok(m({ description: '2 leg chain sling 1.5t pewag', make: 'Pewag' }).item?.id === 3, 'description tokens + make');
ok(m({ title: 'Certificate' }).item === null,                   'nothing identifiable → no match, never a guess');
ok(m({ description: 'scissor machine tool' }).item === null,    'generic words alone never match');
ok(m({ serial: 'GS3216A-99999' }).item === null,                'disposed items excluded from matching');
ok(m({ serial: 'GS3216A-12345' }).conf === 'high',              'exact serial → high confidence');
ok(m({ description: '2 leg chain sling 1.5t pewag', make: 'Pewag' }).conf === 'medium', 'soft evidence → medium confidence');

_plantItems.push({ id: 5, plant_ref: 'P-005', name: 'Genie GS-1932 Scissor Lift', make: 'Genie', model: 'GS-1932', serial_no: 'GS3216A-55555', status: 'in_service' });
const twins = m({ make: 'Genie', model: 'GS-1932' });
ok(twins.conf === 'low', 'two identical machines, no serial → flagged low, user must pick');
ok(/ambiguous/.test(twins.why), 'ambiguity is spelled out in the reason');

console.log('\nNewest-certificate-wins index');
_plantAllDocs = [
  { id: 10, plant_id: 1, doc_type: 'loler',       expiry_date: '2026-09-01', title: 'LOLER old',      is_archived: 0 },
  { id: 11, plant_id: 1, doc_type: 'loler',       expiry_date: '2027-03-01', title: 'LOLER new',      is_archived: 0 },
  { id: 12, plant_id: 1, doc_type: 'loler',       expiry_date: '2028-01-01', title: 'LOLER archived', is_archived: 1 },
  { id: 13, plant_id: 2, doc_type: 'calibration', expiry_date: '2027-05-05', title: 'UKAS cal',       is_archived: 0 },
  { id: 14, plant_id: 2, doc_type: 'manual',      expiry_date: '2030-01-01', title: 'Manual',         is_archived: 0 },
  { id: 15, plant_id: 3, doc_type: 'loler',       expiry_date: null,         title: 'No date',        is_archived: 0 }
];
_plantBuildDocIdx();
ok(_plantDocIdx[1].loler_due.expiry === '2027-03-01', 'newest live certificate wins', JSON.stringify(_plantDocIdx[1]));
ok(_plantDocIdx[1].loler_due.doc.id === 11,           'archived certificate ignored even if later');
ok(_plantDocIdx[2].calib_due.expiry === '2027-05-05', 'calibration certificate indexed');
ok(_plantDocIdx[2].service_due === undefined,         'manual maps to no regime');
ok(!(_plantDocIdx[3] && _plantDocIdx[3].loler_due),   'certificate with no printed date is not indexed');
ok(_plantDueSource(9, 'loler_due') === null,          'unknown item → null source');

console.log('\nRef allocation');
ok(_plantNextRef() === 'P-006', 'next ref continues the sequence', _plantNextRef());
_plantItems = [];
ok(_plantNextRef() === 'P-001', 'first ref on an empty register');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
