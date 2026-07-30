// ─────────────────────────────────────────────────────────────────────────────
// tests/om-pack.js — O&M / handover pack assembly (F1d)
//
// The contents page carries page numbers a client will actually turn to, so the
// pagination has to be exactly right — off by one and every reference is wrong.
// Also pinned: nothing is silently dropped, and the pack is honest about not
// having bookmark trees.
//
// Run: node tests/om-pack.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const block = shared.slice(shared.indexOf('// O&M / HANDOVER PACK (F1d'));
eval(block.slice(0, block.indexOf('function drawOmFrontMatter')).replace(/^const OM_/gm, 'var OM_'));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

console.log('Pagination — each section costs a divider plus its pages');
let laid = omPaginate([{ title: 'A', pageCount: 3 }, { title: 'B', pageCount: 1 }, { title: 'C', pageCount: 10 }], 2);
ok(laid[0].dividerPage === 3, 'first divider lands right after the front matter', String(laid[0].dividerPage));
ok(laid[0].contentStart === 4, 'its content starts on the next page');
ok(laid[1].dividerPage === 7, 'second section starts after 1 divider + 3 pages', String(laid[1].dividerPage));
ok(laid[2].dividerPage === 9, 'third follows the single-page section', String(laid[2].dividerPage));
ok(laid.every(s => s.startPage === s.dividerPage), 'the contents points at the divider, which is what you flick to');
ok(omPaginate([], 2).length === 0, 'no sections → no rows, no throw');
ok(omPaginate([{ title: 'X' }], 2)[0].dividerPage === 3, 'a section with unknown page count still paginates');

console.log('\nLayout settles, and the totals add up');
const mk = n => Array.from({ length: n }, (_, i) => ({ title: 'S' + i, pageCount: 2 }));
let L = omLayout(mk(3));
ok(L.indexPages === 1, '3 sections need one contents page');
ok(L.frontPages === 2, 'cover + one contents page');
ok(L.sections[0].dividerPage === 3, 'first section starts on page 3');
ok(L.totalPages === 2 + 3 * 3, 'total = front + 3 × (divider + 2 pages)', String(L.totalPages));

L = omLayout(mk(31));
ok(L.indexPages === 2, '31 sections spill onto a second contents page', String(L.indexPages));
ok(L.frontPages === 3, 'front matter grows to 3 pages');
ok(L.sections[0].dividerPage === 4, 'and every section shifts down accordingly', String(L.sections[0].dividerPage));

L = omLayout(mk(30));
ok(L.indexPages === 1, 'exactly 30 sections still fit on one page', String(L.indexPages));
L = omLayout(mk(60));
ok(L.indexPages === 2 && L.sections[0].dividerPage === 4, '60 sections → 2 contents pages');
L = omLayout(mk(61));
ok(L.indexPages === 3 && L.sections[0].dividerPage === 5, '61 → 3 contents pages');

console.log('\nPage numbers are internally consistent');
L = omLayout([{ title: 'DoP', pageCount: 1 }, { title: 'CoC', pageCount: 2 },
              { title: 'ITP', pageCount: 4 }, { title: 'Drawings', pageCount: 120 }]);
let expected = L.frontPages + 1;
let consistent = true;
L.sections.forEach(s => {
  if (s.dividerPage !== expected) consistent = false;
  expected += 1 + s.pageCount;
});
ok(consistent, 'every section starts exactly where the previous one ended', JSON.stringify(L.sections.map(s => s.dividerPage)));
ok(L.totalPages === expected - 1, 'the total matches the last page used', `${L.totalPages} vs ${expected - 1}`);
ok(L.totalPages === 2 + (1 + 1) + (1 + 2) + (1 + 4) + (1 + 120), 'total computed the long way agrees', String(L.totalPages));
ok(omLayout([]).totalPages === 2, 'an empty pack is still cover + contents');

console.log('\nNothing is dropped silently');
const asm = block.slice(block.indexOf('async function omAssemblePack'), block.indexOf('async function omGatherSources'));
ok(/failures\.push/.test(asm),                  'unreadable sources are collected as failures');
ok(/never silently dropped/i.test(block),       'the intent is documented');
ok(/if \(!prepared\.length\) throw/.test(asm),  'an empty pack throws rather than producing a cover with nothing behind it');
ok(/ignoreEncryption: true/.test(asm),          'encrypted client PDFs are still readable');
ok(/getPageCount\(\)/.test(asm),                'real page counts are measured, not assumed');
const ui = block.slice(block.indexOf('async function omBuild'));
ok(/Left out:/.test(ui),                        'failures are shown to the user, with reasons');
ok(/payload/.test(ui) && /failures: res\.failures/.test(ui), 'and recorded in the pack register for later');

console.log('\nHonest about bookmarks');
ok(/pdf-lib has no outline\/bookmark API/i.test(block), 'the limitation is stated in the code');
ok(/subtly corrupt/i.test(block),               'and the reason for not hand-writing outlines');
ok(/can't write\s*\n?\s*bookmark trees/i.test(block) || /bookmark trees/.test(block),
   'and the user is told in the UI rather than left to wonder');

console.log('\nBuild order and library guards');
// Order must be: collect (measure page counts) → settle layout → front matter → bind.
// The contents page cannot be drawn before the page counts are known.
ok(asm.indexOf('failures.push') < asm.indexOf('omLayout('), 'sources are collected and measured first');
ok(asm.indexOf('omLayout(') < asm.indexOf('drawOmFrontMatter'), 'the layout is settled before the contents page is drawn');
ok(asm.indexOf('drawOmFrontMatter') < asm.indexOf('Binding section'), 'front matter is built before the sections are bound');
ok(asm.indexOf('drawOmFrontMatter') < asm.indexOf('drawOmDivider'), 'and before any divider');
ok(/typeof PDFLib === 'undefined'/.test(asm),   'missing pdf-lib fails with a clear message');
ok(/await resolveJsPDFCtor\(\)/.test(asm),      'jsPDF resolver is awaited (it is async)');
const office = fs.readFileSync(path.join(__dirname, '..', 'office.html'), 'utf8');
ok(/pdf-lib/.test(office),  'office.html loads pdf-lib — the pack is built from this page');
ok(/jspdf/.test(office),    'office.html loads jsPDF — ITP, CoC, DoP and the pack all render from here');
ok(!/const Ctor = resolveJsPDFCtor\(\);/.test(shared),
   'no un-awaited resolveJsPDFCtor() calls remain anywhere');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
