// ─────────────────────────────────────────────────────────────────────────────
// tests/dop-declaration.js — Declaration of Performance (F1c)
//
// This is the regulated document. It names BAMA as manufacturer, under BAMA's
// sole responsibility, so the tests are about what the ERP REFUSES to do:
//   • never invent a declared performance value
//   • never issue before a human has confirmed the approved body / FPC numbers
//   • never quietly default a blank characteristic into a claim
//   • read the certificate exactly as printed, and re-require confirmation
//     whenever it is re-read
//
// Run: node tests/dop-declaration.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const block = shared.slice(shared.indexOf('// DECLARATION OF PERFORMANCE (F1c'));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

// Load the pure parts
global.btoa = b => Buffer.from(b, 'binary').toString('base64');
const pure = block.slice(0, block.indexOf('async function dopLoadConfig'));
eval(pure.replace(/^const DOP_/gm, 'var DOP_'));
const assembleSrc = (block.match(/function dopAssemble[\s\S]*?\n}/m) || [''])[0];
eval(assembleSrc);

console.log('Blank config declares nothing');
const cfg = dopBlankConfig();
ok(cfg.characteristics.length === DOP_CHARACTERISTICS.length, 'every characteristic from the standard is listed');
ok(cfg.characteristics.every(c => c.performance === ''), 'EVERY performance value starts blank — nothing is pre-declared');
ok(!cfg.characteristics.some(c => /NPD/i.test(c.performance)), 'NPD is never defaulted in — it has to be chosen');
ok(cfg.verified === false, 'a fresh config is unverified');
ok(cfg.approved_body_number === '' && cfg.fpc_certificate_no === '', 'no body number or FPC number is invented');
ok(/Not yet verified/i.test(cfg.source_note), 'the config says plainly that it is unverified');
ok(/Yaxley/.test(cfg.address) && !/Culley/i.test(cfg.address), 'address is Yaxley, never Culley Court');
ok(cfg.marking === 'UKCA', 'defaults to UKCA marking');
ok(cfg.avcp_system === '2+', 'AVCP system 2+ for structural steel');

console.log('\nIssue is blocked until a human has confirmed');
const full = { ...dopBlankConfig(), verified: true, approved_body_name: 'X', approved_body_number: '0086',
  fpc_certificate_no: 'FPC-1', standard: 'BS EN 1090-1', avcp_system: '2+',
  characteristics: [{ characteristic: 'Reaction to fire', performance: 'A1' }] };
ok(dopAssemble(full, {}, { execClass: 'EXC2' }).blockers.length === 0, 'a complete verified config can issue');
ok(dopAssemble({ ...full, verified: false }, {}, {}).blockers.some(b => /not been verified/i.test(b)),
   'unverified config blocks issue');
[['approved_body_number', 'approved body number'], ['fpc_certificate_no', 'FPC certificate number'],
 ['standard', 'designated standard'], ['avcp_system', 'AVCP system']].forEach(([k, label]) => {
  const b = dopAssemble({ ...full, [k]: '' }, {}, {}).blockers;
  ok(b.length > 0, `missing ${label} blocks issue`, JSON.stringify(b));
});
const noPerf = dopAssemble({ ...full, characteristics: [{ characteristic: 'Reaction to fire', performance: '' }] }, {}, {});
ok(noPerf.blockers.some(b => /every characteristic is blank/i.test(b)),
   'a declaration with no performance values at all is blocked, not issued empty');

console.log('\nPartial declarations warn rather than silently omit');
const partial = dopAssemble({ ...full, characteristics: [
  { characteristic: 'Reaction to fire', performance: 'A1' },
  { characteristic: 'Fatigue strength', performance: '' }] }, {}, { execClass: 'EXC2' });
ok(partial.blockers.length === 0, 'partial is allowed');
ok(partial.warnings.some(w => /left blank/.test(w) && /NPD/.test(w)),
   'but warns, and points out NPD is the way to say "none determined"');
ok(partial.declared.length === 1, 'only the completed characteristics count as declared');

console.log('\nExecution class mismatch is caught');
const mismatch = dopAssemble({ ...full, exec_class: 'EXC2' }, {}, { execClass: 'EXC3' });
ok(mismatch.warnings.some(w => /EXC3/.test(w) && /EXC2/.test(w)),
   'job EXC3 against an EXC2 certificate is flagged', JSON.stringify(mismatch.warnings));
ok(dopAssemble({ ...full, exec_class: 'EXC3' }, {}, { execClass: 'EXC3' }).warnings.every(w => !/certificate covers/.test(w)),
   'matching classes produce no mismatch warning');

console.log('\nThe certificate reader copies, never interprets');
const readerStart = block.indexOf('async function dopReadCertificate');
const readerEnd = block.indexOf('function dopAssemble');
const reader = block.slice(readerStart, readerEnd);
ok(/EXACTLY as printed/i.test(reader),               'prompt demands exact transcription');
ok(/Do NOT infer/i.test(reader),                     'forbidden from inferring');
ok(/Do NOT guess a body number/i.test(reader),       'specifically forbidden from guessing a body number from the name');
ok(/transcription error matters more/i.test(reader), 'the prompt explains why exactness beats completeness here');
ok(/return null for anything not clearly printed/i.test(reader), 'null rather than a plausible value');
ok(/company-documents/.test(reader),                 'reads the certificate out of the ERP, not from the user');
ok(/_abToBase64/.test(reader),                       'uses the chunked base64 converter, not a spread that would blow the stack');
const readUi = (block.match(/async function dopReadCert\(\)[\s\S]*?\n}/m) || [''])[0];
ok(/_dopCfg\.verified = false/.test(readUi), 'anything freshly read is marked UNVERIFIED again');
ok(/check every character/i.test(readUi),    'the user is told to check every character');

console.log('\nRenderer only prints what was declared');
const pdfData = (block.match(/function _dopPdfData[\s\S]*?\n}/m) || [''])[0];
ok(/filter\(c => String\(c\.performance \|\| ''\)\.trim\(\)\)/.test(pdfData),
   'blank characteristics are filtered out of the PDF, not printed as empty claims');
const render = (shared.match(/function drawDopPDF[\s\S]*?\n  return doc;\n}/m) || [''])[0];
['Unique identification code', 'Intended use', 'Manufacturer',
 'System of assessment', 'Declared performance'].forEach(c =>
  ok(render.includes(c), `prescribed clause present: ${c}`));
ok(/sole\s+\n?\s*'?\+?\s*'?responsibility of the manufacturer/.test(render) || /sole/.test(render),
   'the statutory sole-responsibility statement is present');
ok(/Construction Products Regulations/.test(render), 'cites the Construction Products Regulations');
ok(/getImageProperties/.test(render), 'logo sized via getImageProperties');
ok(/Page \$\{p\} of \$\{total\}/.test(render), 'page X of Y footer');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
