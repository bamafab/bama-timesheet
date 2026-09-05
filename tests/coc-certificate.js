// ─────────────────────────────────────────────────────────────────────────────
// tests/coc-certificate.js — Certificate of Conformity (F1b)
//
// A CoC is signed by a director and held by the client, so the properties worth
// pinning are about HONESTY, not layout:
//   • the AI is given the facts and forbidden from adding any of its own
//   • the renderer never fabricates a section it has no data for
//   • issued certificates freeze their figures and are never edited in place
//   • gaps in the supporting records are surfaced, not swallowed
//
// Run: node tests/coc-certificate.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'functions', 'job-certificates.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'api', 'sql', 'create-job-certificates.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

const cocBlock = shared.slice(shared.indexOf('// CERTIFICATE OF CONFORMITY (F1b'));
const promptBlock = (cocBlock.match(/async function cocDraftScope[\s\S]*?^}/m) || [''])[0];
const gatherBlock = (cocBlock.match(/async function cocGatherFacts[\s\S]*?\n  return facts;\n}/m) || [''])[0];

// House-style helpers (PDF house-style, 2026-08): footer + logo sizing live in
// bamaDocHeader()/bamaDocFooter(), so the renderer is checked for the call and
// the helper for the behaviour.
const houseHeader = (shared.match(/^function bamaDocHeader\([\s\S]*?^}/m) || [''])[0];
const houseFooter = (shared.match(/^function bamaDocFooter\([\s\S]*?^}/m) || [''])[0];

console.log('The AI is fenced in');
ok(/the only information you may use/i.test(promptBlock), 'the prompt states the facts are the only permitted source');
ok(/Do NOT state any number/i.test(promptBlock),          'forbidden from stating numbers not in the facts');
ok(/Do NOT invent standards, approvals, notified bodies/i.test(promptBlock), 'forbidden from inventing standards or notified bodies');
ok(/heat number/i.test(promptBlock),                      'heat numbers are named as off-limits to invent');
ok(/Do NOT claim compliance/i.test(promptBlock),          'forbidden from claiming compliance beyond the exec class given');
ok(/JSON\.stringify\(summary/.test(promptBlock),          'the facts are passed as structured data, not prose');
ok(!/max_tokens:\s*[4-9]\d{3}/.test(promptBlock),         'token budget is modest — this is a short narrative, not a document');

console.log('\nFacts come from the ERP, and gaps are surfaced');
['/api/projects', 'inspection-plans', 'inspection-records', 'heat-allocations', 'steel-test-certs', 'welder-quals'].forEach(src =>
  ok(gatherBlock.includes(src), `reads ${src}`));
ok(/facts\.gaps\.push/.test(gatherBlock), 'missing records are recorded as gaps');
const gapCount = (gatherBlock.match(/facts\.gaps\.push/g) || []).length;
ok(gapCount >= 8, `every source has a gap path (${gapCount} found)`, String(gapCount));
ok(/No heat \/ cast numbers on file/.test(gatherBlock), 'missing heat numbers is an explicit gap');
ok(/failed inspection/i.test(gatherBlock),           'failed inspections are flagged before certifying');
ok(/qualification not valid/i.test(gatherBlock),     'invalid welder qualifications are flagged');
ok(/sample not yet satisfied/i.test(gatherBlock),    'an unmet inspection sample is flagged');
ok(/catch/.test(gatherBlock),                        'a missing source degrades gracefully rather than throwing');
ok(!/Math\.random|estimate|assume/i.test(gatherBlock), 'nothing is estimated or randomised');

console.log('\nThe renderer omits what it has no data for');
const render = (shared.match(/function drawCocPDF[\s\S]*?\n  return doc;\n}/m) || [''])[0];
ok(/if \(\(d\.heatNumbers \|\| \[\]\)\.length\)/.test(render), 'material section only when there are heat numbers');
ok(/if \(\(d\.ndt \|\| \[\]\)\.length\)/.test(render),         'inspection section only when there is inspection data');
ok(/if \(\(d\.welders \|\| \[\]\)\.length\)/.test(render),     'welder section only when welders are known');
ok(/if \(d\.scopeText\)/.test(render),                         'scope section only when written');
ok(/filter\(p => p\[1\] !== null/.test(render),                'blank key-values are dropped, not printed as empty');
ok(/Visual inspection is carried out on 100% of welds/.test(render),
   'the 100% visual statement is fixed text, not derived from data that could be wrong');
ok(/bamaDocHeader\(/.test(render) && /getImageProperties/.test(houseHeader), 'logo sized via getImageProperties in the house header (data URIs have no naturalWidth)');
ok(/splitTextToSize/.test(render),    'text wrapping used throughout');
ok(/bamaDocFooter\(/.test(render) && /Page \$\{p\} of \$\{total\}/.test(houseFooter), 'page X of Y footer via the house footer');

console.log('\nIssued certificates are frozen');
ok(/payload/.test(api),                        'the payload snapshot column is written');
ok(/revision \+ 1|Number\(prev\.recordset\[0\]\.revision\) \+ 1/.test(api), 'revision auto-increments');
ok(/status = 'superseded'/.test(api),          'the previous revision is superseded');
ok(/certified figures are frozen/i.test(api),  'the update endpoint refuses to edit certified figures');
const updateBlock = (api.match(/job-certificates-update[\s\S]*?^\}\);/m) || [''])[0];
['scope_text', 'payload', 'exec_class', 'issue_date'].forEach(f =>
  ok(!new RegExp(`${f}:\\s*v =>`).test(updateBlock), `${f} is NOT editable after issue`));
ok(/Why the snapshot matters/i.test(migration) && /freezes what was certified/i.test(migration),
   'the migration explains why the snapshot exists');
ok(/logChange\('job_certificate'/.test(api), 'issuing is audited');

console.log('\nUI honesty');
const ui = shared.slice(shared.indexOf('async function cocOpen'));
ok(/Nothing here is drafted or estimated/.test(ui), 'the modal states plainly which parts are facts');
ok(/warning, not a lock/.test(ui),                  'gaps warn without blocking, and say so');
ok(/never edited in place/.test(ui),                're-issue behaviour is explained to the user');
ok(/frozen at today's values/.test(ui),             'the freeze is explained at the point of issue');

console.log('\nSupply-only (DoC) vs supply-and-install (CoC)');
// Mateusz's distinction: same evidence, different declared responsibility.
// This must NOT be confused with a Declaration of PERFORMANCE, which is regulated.
ok(/'coc', 'doc', 'dop', 'om'/.test(api), 'the API accepts all four document types', (api.match(/DOC_TYPES = \[[^\]]*\]/) || [''])[0]);
ok(/NOT a Declaration of Performance/i.test(api), 'the API comment warns against confusing doc with dop');
ok(/supply AND install/i.test(api) && /supply only/i.test(api), 'both scopes are documented at the type list');
ok(/DECLARATION OF CONFORMITY/.test(render) && /CERTIFICATE OF CONFORMITY/.test(render),
   'the renderer carries both titles');
ok(/const supplyOnly = d\.mode === 'doc'/.test(render), 'the renderer branches on an explicit mode, not a guess');
ok(/no responsibility is accepted[\s\S]{0,120}erection/.test(render),
   'supply-only wording expressly excludes erection and works by others');
ok(/fabricated, supplied and installed/.test(render), 'supply-and-install wording covers installation');
ok(/erection records/.test(render), 'and cites erection records');
ok(/Scope', supplyOnly \?/.test(render), 'the scope is stated on the face of the document, not just in the wording');
ok(/Scope:',\s*value: supplyOnly \? 'Supply only' : 'Supply and installation'/.test(render), 'the header meta line states the scope too');
const uiMode = shared.slice(shared.indexOf('async function cocSetMode'));
ok(/doc_type=\$\{_cocMode\}/.test(shared), 'each scope keeps its own revision sequence');
ok(/_cocMode === 'doc' \? 'Issue Declaration/.test(shared), 'the confirm dialog names the right document');
ok(/latest\('coc'\) \|\| latest\('doc'\)/.test(shared), 'the O&M pack picks up whichever was issued');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
