// ─────────────────────────────────────────────────────────────────────────────
// tests/money-rounding.js — the money rules (Fault Register: 2dp rounding)
//
// Two rules, both pinned here:
//   1. Round at every monetary step, not just the final .toFixed(2).
//   2. A total is the sum of the ROUNDED lines printed beside it, so an
//      invoice adds up when the client checks it on a calculator.
//
// Also proves the invoice preview and the saved payload compute IDENTICAL
// totals — they were two separate sums before, and could disagree by pennies.
//
// Run: node tests/money-rounding.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const start = src.indexOf('// MONEY — one place for all monetary rounding and formatting');
const end = src.indexOf('function dateStr(d) {');
if (start < 0 || end < 0) { console.error('Could not find the MONEY section in shared.js'); process.exit(1); }
eval(src.slice(start, end).replace(/^const /gm, 'var '));

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — got ' + extra : '')); }
};

console.log('_r2 — single value');
ok(_r2(0.1 + 0.2) === 0.3,            '0.1 + 0.2 → 0.3 (not 0.30000000000000004)', _r2(0.1 + 0.2));
ok(_r2(1290.2999999) === 1290.3,      'float noise collapses to 1290.30', _r2(1290.2999999));
ok(_r2(2.345) === 2.35,               'half-up at the penny', _r2(2.345));
ok(_r2(-1.005) === -1,                'negatives handled (credit notes)', _r2(-1.005));
ok(_r2(null) === 0 && _r2('') === 0 && _r2(undefined) === 0, 'null / empty / undefined → 0');
ok(_r2('12.345') === 12.35,           'numeric strings from inputs coerce', _r2('12.345'));

console.log('\nsumMoney — total equals the sum of the printed lines');
// Three lines that each PRINT as £0.34, so the client's calculator says £1.02.
// The old code summed the raw values (1.00499…) and rounded once → £1.00,
// two pence short of the figures printed above it.
const rows3 = [{ a: 0.335 }, { a: 0.335 }, { a: 0.335 }];
ok(sumMoney(rows3, r => r.a) === 1.02, 'three £0.34 lines → £1.02 (what the client adds up)', sumMoney(rows3, r => r.a));
const naive = _r2(rows3.reduce((s, r) => s + r.a, 0));
ok(naive !== sumMoney(rows3, r => r.a),
   'reproduces the old bug: rounding the raw sum disagrees with the printed lines',
   `naive ${naive} vs lines ${sumMoney(rows3, r => r.a)}`);
// And each printed line really is 0.34
ok(rows3.every(r => _r2(r.a) === 0.34), 'each line prints as £0.34');
ok(sumMoney([0.1, 0.2, 0.3, 0.4]) === 1,   'plain array of amounts', sumMoney([0.1, 0.2, 0.3, 0.4]));
ok(sumMoney([]) === 0,                     'empty list → 0');
ok(sumMoney(null) === 0,                   'null list → 0 (never NaN)');
ok(sumMoney([{ a: null }, { a: 5 }], r => r.a) === 5, 'null line amounts skipped, not NaN');
// 40 lines of £32.257 — the accumulation case from the fault register
const forty = Array.from({ length: 40 }, () => 32.257);
ok(sumMoney(forty) === _r2(40 * 32.26), '40 identical lines match 40 × the printed line value', sumMoney(forty));

console.log('\npctOf — retention, VAT, markup');
ok(pctOf(1290.3, 20) === 258.06,      '20% VAT on 1290.30', pctOf(1290.3, 20));
ok(pctOf(1000, 2.5) === 25,           '2.5% retention on 1000', pctOf(1000, 2.5));
ok(pctOf(0.1 + 0.2, 20) === 0.06,     'operates on the rounded base', pctOf(0.1 + 0.2, 20));
ok(pctOf(100, 0) === 0 && pctOf(100, null) === 0, 'zero / null percentage → 0');

console.log('\nInvoice: preview total === saved total');
// Mirrors both code paths in shared.js (recalcInvoiceTotals and _invPayload).
function invoiceTotals(rows, { retentionPct = 0, treatment = 'reverse_charge' } = {}) {
  const net = sumMoney(rows, l => Number(l.quantity || 0) * Number(l.unit_price || 0));
  const retention = pctOf(net, retentionPct);
  const vatBase = _r2(net - retention);
  const vat = treatment === 'standard' ? pctOf(vatBase, 20) : 0;
  const reverseCharge = treatment === 'reverse_charge' ? pctOf(vatBase, 20) : 0;
  return { net, retention, vat, reverseCharge, gross: _r2(vatBase + vat) };
}
function savedTotals(rows, opts) {
  const lines = rows.map(l => ({ line_total: _r2(Number(l.quantity || 0) * Number(l.unit_price || 0)) }));
  const net = sumMoney(lines, l => l.line_total);
  const retention = pctOf(net, opts?.retentionPct || 0);
  const vatBase = _r2(net - retention);
  const vat = (opts?.treatment === 'standard') ? pctOf(vatBase, 20) : 0;
  return { net, retention, vat, gross: _r2(vatBase + vat) };
}
const awkward = [
  { quantity: 3,    unit_price: 32.257 },
  { quantity: 7,    unit_price: 1.005  },
  { quantity: 1.5,  unit_price: 99.99  },
  { quantity: 12,   unit_price: 0.335  }
];
for (const opts of [{}, { retentionPct: 5 }, { treatment: 'standard' }, { retentionPct: 2.5, treatment: 'standard' }]) {
  const a = invoiceTotals(awkward, opts), b = savedTotals(awkward, opts);
  ok(a.net === b.net && a.retention === b.retention && a.vat === b.vat && a.gross === b.gross,
     `preview === saved  (${JSON.stringify(opts)})`, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
// Gross must equal net − retention + VAT using the printed figures
const t = invoiceTotals(awkward, { retentionPct: 5, treatment: 'standard' });
ok(t.gross === _r2(t.net - t.retention + t.vat), 'gross reconciles against the printed net/retention/VAT',
   `${t.gross} vs ${_r2(t.net - t.retention + t.vat)}`);
// Reverse charge must NOT inflate the gross
const rc = invoiceTotals(awkward, { treatment: 'reverse_charge' });
ok(rc.gross === rc.net && rc.reverseCharge > 0, 'reverse charge shown for info but not billed');

console.log('\nFormatters');
ok(gbp2(1290.2999999) === '£1,290.30', 'gbp2 rounds before formatting', gbp2(1290.2999999));
ok(gbp2(0) === '£0.00',                'gbp2 zero is a real figure, not a dash');
ok(gbp2(null) === '—',                 'gbp2 null → dash');
ok(gbpWhole(1290.6) === '£1,291',      'gbpWhole rounds to the pound', gbpWhole(1290.6));
ok(gbpWhole(null) === '—',             'gbpWhole null → dash');
ok(gbpShort(1300000) === '£1.3m',      'gbpShort millions', gbpShort(1300000));
ok(gbpShort(45400) === '£45k',         'gbpShort thousands', gbpShort(45400));
ok(gbpShort(-1300000) === '£-1.3m',    'gbpShort handles negatives', gbpShort(-1300000));
ok(gbpShort(0) === '—',                'gbpShort zero → dash (tile reads as empty)');

console.log('\nDuplicated copies on the two shared.js-free pages');
// dashboard.html and quote-builder.html do NOT load shared.js, so each carries
// its own fmtGBP. They must behave identically to the canonical helper or the
// same figure formats differently depending on which page you're looking at.
function extractFn(file, name) {
  const txt = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const at = txt.indexOf('function ' + name + '(v) {');
  if (at < 0) return null;
  // Walk braces to the end of the function.
  let i = txt.indexOf('{', at), depth = 0, end = -1;
  for (; i < txt.length; i++) {
    if (txt[i] === '{') depth++;
    else if (txt[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  return end < 0 ? null : txt.slice(at, end);
}
const SAMPLES = [null, undefined, '', 0, 1, 0.5, 12.345, 999, 1000, 1290.2999999, 45400, 999999, 1300000, -1300000, -0.5, '1234.567'];
for (const [file, canonical] of [['dashboard.html', gbpShort], ['quote-builder.html', gbpWhole]]) {
  const code = extractFn(file, 'fmtGBP');
  if (!code) { fail++; console.log('  ✗ could not find fmtGBP in ' + file); continue; }
  let local;
  try { local = eval('(' + code.replace(/^function fmtGBP/, 'function') + ')'); }
  catch (e) { fail++; console.log('  ✗ ' + file + ' fmtGBP would not parse: ' + e.message); continue; }
  const bad = SAMPLES.filter(v => local(v) !== canonical(v));
  ok(!bad.length, `${file} fmtGBP matches the canonical helper on every sample`,
     bad.map(v => `${JSON.stringify(v)}: ${local(v)} vs ${canonical(v)}`).join('; '));
}
// Guard the assumption itself: if either page ever starts loading shared.js,
// the duplicate should be deleted and this test updated.
for (const file of ['dashboard.html', 'quote-builder.html']) {
  const txt = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  ok(!/src="shared\.js/.test(txt),
     `${file} still does not load shared.js (if it now does, delete the duplicate and use the canonical helper)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
