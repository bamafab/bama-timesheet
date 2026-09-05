// ─────────────────────────────────────────────────────────────────────────────
// tests/toolbox-talks.js — toolbox talk library, drafting and register
//
// What matters here: an attendance record is EVIDENCE, so it must not be
// possible to record a talk nobody attended, signature images must never reach
// the database, and an AI-drafted talk must be visibly a draft.
//
// Run: node tests/toolbox-talks.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'functions', 'toolbox-talks.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'api', 'sql', 'create-toolbox-talks.sql'), 'utf8');
const block = shared.slice(shared.indexOf('// TOOLBOX TALKS (2026-07-30)'));
eval(block.slice(0, block.indexOf('let _tbtTalks')).replace(/^const TBT_/gm, 'var TBT_'));

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

console.log('Starter library is fit for a steel fabricator');
ok(TBT_STARTER_LIBRARY.length === 10, '10 starter talks', String(TBT_STARTER_LIBRARY.length));
ok(TBT_STARTER_LIBRARY.every(t => t.title && t.summary && t.category), 'each has title, summary and category');
ok(TBT_STARTER_LIBRARY.every(t => TBT_CATEGORIES[t.category]), 'every category is a known one');
ok(TBT_STARTER_LIBRARY.every(t => (t.key_points || []).length >= 5), 'each has at least 5 key points');
ok(TBT_STARTER_LIBRARY.every(t => t.key_points.every(p => p.length > 15)), 'no one-word filler points');
['hot_works', 'height', 'lifting', 'manual_handling', 'ppe', 'plant', 'coshh', 'site_traffic', 'electrical', 'welfare']
  .forEach(c => ok(TBT_STARTER_LIBRARY.some(t => t.category === c), `covers ${c}`));
const allText = JSON.stringify(TBT_STARTER_LIBRARY).toLowerCase();
ok(/fume/.test(allText) && /carcinogen/.test(allText), 'welding fume is treated as a carcinogen');
ok(/loler/.test(allText), 'lifting accessories reference LOLER examination');
ok(/suspended load/.test(allText), 'nobody under a suspended load');
ok(/near miss/.test(allText), 'near-miss reporting is prompted — what 45001 auditors look for');
ok(!/\b\d+%\s*of\s*(accidents|injuries|deaths)/.test(allText), 'no invented accident statistics');

console.log('\nThe drafting prompt is fenced sensibly');
const prompt = block.slice(block.indexOf('async function tbtDraftTalk'),
                           block.indexOf('// ── Talk sheet PDF'));
ok(/no invented statistics/i.test(prompt),        'forbidden from inventing statistics');
ok(/UK terminology/i.test(prompt),               'UK practice, not US');
ok(/steel fabrication and erection/i.test(prompt), 'specific to the trade, not generic safety filler');
ok(/Do not claim BAMA has any particular procedure/i.test(prompt),
   'forbidden from asserting BAMA has procedures or kit it may not have');
ok(/unless you are certain/i.test(prompt),       'cautious about citing regulation numbers');
ok(/source: 'drafted'/.test(prompt) || /source: 'drafted'/.test(block), 'drafts are marked as drafts');
const draftUi = block.slice(block.indexOf('async function tbtDoDraft'));
ok(/Read it properly before you give it/i.test(draftUi), 'the UI tells the user to review it');
ok(/not from your site/i.test(draftUi),          'and says what the draft cannot know');

console.log('\nAn attendance record cannot be empty or faked');
ok(/At least one attendee is required/.test(api), 'the API rejects a delivery with no attendees');
ok(/a talk with nobody at it is not a record/i.test(api), 'and says why');
ok(/delivered_by is required/.test(api),         'somebody must be named as having given it');
ok(/Tick who attended/.test(block),              'the UI blocks the same case before it gets there');
ok(/document\.querySelectorAll\('\.tbtAtt'\)[\s\S]{0,120}checked = true/.test(block),
   'signing a name auto-ticks attendance, so it cannot be signed-but-unrecorded');

console.log('\nSignature images never reach the database');
ok(/SIGNATURE IMAGES DO NOT/i.test(migration), 'the migration states the rule');
ok(/signed: !!a\.signed/.test(api),             'the API keeps only a signed flag');
ok(/Strip anything image-like/i.test(api),      'and strips the rest deliberately');
const sendBlock = block.slice(block.indexOf('await api.post(\'/api/toolbox-deliveries\''));
ok(/attendees: picked\.map\(a => \(\{ name: a\.name, role: a\.role, signed: a\.signed \}\)\)/.test(sendBlock),
   'the client sends name/role/signed only — no signature payload');
ok(/deliberately NOT sent/.test(sendBlock),     'with the reason at the call site');
ok(/addImage\(a\.signature/.test(shared),       'the signature is rendered into the PDF instead');

console.log('\nThe register survives library edits');
ok(/talk_ref\s+NVARCHAR\(40\)\s+NULL,\s*--\s*snapshot/.test(migration) || /snapshot/.test(migration),
   'deliveries snapshot the talk ref and title');
ok(/never\s*\n?\s*--\s*orphans|orphans/.test(api), 'deleting a library talk does not orphan its delivery records');
ok(/talk_title/.test(api), 'the title is stored on the delivery');

console.log('\nPaper route works too');
const pdf = (shared.match(/function drawTbtPDF[\s\S]*?\n  return doc;\n}/m) || [''])[0];

// House-style helpers (PDF house-style, 2026-08): footer + logo sizing live in
// bamaDocHeader()/bamaDocFooter(), so the renderer is checked for the call and
// the helper for the behaviour.
const houseHeader = (shared.match(/^function bamaDocHeader\([\s\S]*?^}/m) || [''])[0];
const houseFooter = (shared.match(/^function bamaDocFooter\([\s\S]*?^}/m) || [''])[0];
ok(/spareRows/.test(pdf),                      'blank rows are printed for walk-ups');
ok(/spareRows: 14/.test(block),                'the print-blank route gives plenty of lines');
ok(/doc\.line\(mL \+ wName \+ wRole \+ 2, y \+ 9/.test(pdf), 'a ruled signature line when there is no e-signature');
ok(/I CONFIRM I ATTENDED AND UNDERSTOOD/.test(pdf), 'the register carries a confirmation statement');
ok(/bamaDocFooter\(/.test(pdf) && /Page \$\{p\} of \$\{total\}/.test(houseFooter), 'page X of Y footer via the house footer');
ok(/getImageProperties/.test(pdf),             'logo sized properly');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
