#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// golden-quotes.js — regression harness for the QB pricing engine
// (Fault Register F10 / Phase B5)
//
//   node tests/golden-quotes.js            → compare against golden-expected.json
//   node tests/golden-quotes.js --update   → regenerate golden-expected.json
//
// Extracts computeQuoteTotals / computeAreaBreakdown (and their helper
// closure) from quote-builder.html AT RUNTIME, so it always tests the code
// that will ship — no duplicated engine copy to drift. Runs 10 fixture quotes
// covering the engine's branches and compares every numeric output to the
// committed expectations (tolerance ±£0.01 / ±0.01).
//
// Rule (CLAUDE.md): run this BEFORE any push that touches computeQuoteTotals,
// computeAreaBreakdown, or their helpers. A red run means quoted prices moved
// — either fix the regression or consciously re-baseline with --update and
// say why in the commit message.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const QB_PATH = path.join(__dirname, '..', 'quote-builder.html');
const EXPECTED_PATH = path.join(__dirname, 'golden-expected.json');
const UPDATE = process.argv.includes('--update');
const TOL = 0.011;

// ── Extract the engine closure from the live page ───────────────────────────
const page = fs.readFileSync(QB_PATH, 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name;
  const s = page.indexOf(marker);
  if (s < 0) throw new Error(`extract: ${marker} not found in quote-builder.html`);
  const e = page.indexOf('\n}\n', s);
  if (e < 0) throw new Error(`extract: end of ${name} not found`);
  return page.slice(s, e + 3);
}
function extractConst(decl) {
  const s = page.indexOf(decl);
  if (s < 0) throw new Error(`extract: ${decl} not found`);
  const e = page.indexOf(';\n', s);
  return page.slice(s, e + 2);
}

// Seed set — transitive helpers are auto-resolved below.
const SEED_FNS = ['r2', 'rowWeight', 'rowFinishType', 'autoFabHours',
  'computeImportedTotals', 'wizItemLabour', 'wizLabourRollup',
  'computeQuoteTotals', 'computeAreaBreakdown', 'computeQuoteHoursByCategory'];

const loaded = new Set();
function extractDeclaration(name) {
  // const/let X = { ... };  or  = [ ... ];  or a simple expression.
  for (const kw of ['const ', 'let ', 'var ']) {
    const s = page.indexOf(kw + name + ' =');
    if (s < 0) continue;
    // balance to the terminating ';' at depth 0
    let depth = 0, i = page.indexOf('=', s);
    for (; i < page.length; i++) {
      const ch = page[i];
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
      else if (ch === ';' && depth === 0) break;
    }
    return page.slice(s, i + 1).replace(kw + name, 'globalThis.' + name);
  }
  return null;
}

function loadFn(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const marker = 'function ' + name;
  if (page.indexOf(marker) >= 0) {
    eval(extractFunction(name)
      .replace(new RegExp('\\bfunction ' + name + '\\b'), 'globalThis.' + name + ' = function ' + name));
    return;
  }
  const decl = extractDeclaration(name);
  if (!decl) throw new Error(`resolve: ${name} not found as function or declaration in quote-builder.html`);
  eval(decl);
}

eval(extractConst('const AREA_PRICE_CATS =').replace('const AREA_PRICE_CATS', 'globalThis.AREA_PRICE_CATS'));
eval(extractConst('const AREA_JOBWIDE_CATS =').replace('const AREA_JOBWIDE_CATS', 'globalThis.AREA_JOBWIDE_CATS'));
SEED_FNS.forEach(loadFn);
globalThis.rates = null;   // engine accepts null rates (QB preflight does the same)

// Self-healing closure: run each fixture in a resolve loop — any
// "X is not defined" pulls function X from the page and retries. Keeps the
// harness working when the engine grows new helpers.
function runResolving(fn, maxIter) {
  for (let i = 0; i < (maxIter || 25); i++) {
    try { return fn(); }
    catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message || '');
      if (!m) throw e;
      loadFn(m[1]);   // throws clearly if the page truly lacks it
    }
  }
  throw new Error('resolve loop exceeded — circular or missing helper');
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Deterministic synthetic quotes; each exercises specific engine branches.
// NEVER edit a fixture casually — that invalidates its golden result.
const F = (o) => Object.assign({
  type: 'bama', margin: 20, fittingsPct: 10, fittingsRate: 1.30, miscMaterial: 0,
  fabRate: 45, fabpackRate: 50, designRate: 50, connDesignRate: 50,
  structEngRate: 90, architectRate: 90,
  instOperatives: 2, globalDays: true, blockNA: {},
  takeoff: [], areas: [], labourRows: [], plantRows: [], paintRows: [],
  deliveryRows: [], prelimRows: [], consumableRows: [], surveyVisitRows: [],
  areaPricing: {}, areaPricingLocks: [], areaFullLocks: []
}, o);

const FIXTURES = {
  '01_minimal_single_beam': F({
    takeoff: [{ type: '203x133x25 UB', length: 6000, qty: 4, kgm: 25.1, rate: 1.25 }],
    fabHours: 20
  }),
  '02_fittings_and_misc': F({
    takeoff: [{ type: '100x100x8 SHS', length: 3000, qty: 10, kgm: 22.9, rate: 1.4 }],
    fittingsPct: 15, fittingsRate: 1.5, miscMaterial: 350, fabHours: 30
  }),
  '03_na_blocks': F({
    takeoff: [{ type: 'IPE 200', length: 5000, qty: 6, kgm: 22.4, rate: 1.3 }],
    fabHours: 25, instDays: 2, labourRows: [{ qty: 2, rate: 45 }],
    deliveryRows: [{ qty: 1, rate: 250 }],
    blockNA: { installation: true, delivery: true }
  }),
  '04_labour_plant_global_days': F({
    takeoff: [{ type: 'UC 203x203x46', length: 4000, qty: 8, kgm: 46.1, rate: 1.2 }],
    fabHours: 60, instDays: 3,
    labourRows: [{ qty: 2, rate: 45 }, { qty: 1, rate: 55 }],
    plantRows: [{ qty: 1, rate: 480 }]
  }),
  '05_per_row_days': F({
    takeoff: [{ type: 'PFC 200x90', length: 7000, qty: 5, kgm: 29.7, rate: 1.35 }],
    fabHours: 40, instDays: 5, globalDays: false,
    labourRows: [{ qty: 3, days: 2, rate: 45 }, { qty: 1, days: 4, rate: 50 }]
  }),
  '06_paint_and_galv': F({
    takeoff: [
      { type: '150x150x10 SHS', length: 6000, qty: 6, kgm: 43.6, rate: 1.3, finish: 'galvanise' },
      { type: '80x80x5 SHS', length: 3000, qty: 10, kgm: 11.7, rate: 1.3, finish: 'paint' }
    ],
    fabHours: 45,
    paintRows: [
      { type: 'galvanise', unit: 'tonnes', qty: 0, rate: 380 },
      { type: 'paint', unit: 'm2', qty: 60, rate: 9.5 }
    ]
  }),
  '07_delivery_prelims_survey_purlins': F({
    takeoff: [{ type: '254x146x31 UB', length: 8000, qty: 12, kgm: 31.1, rate: 1.22 }],
    fabHours: 90,
    deliveryRows: [{ qty: 2, rate: 275 }],
    prelimRows: [{ qty: 1, rate: 800 }],
    consumableRows: [{ qty: 3, rate: 40 }],
    surveyVisitRows: [{ qty: 2, rate: 320 }],
    surveyParking: 25, purlinM: 120, purlinRate: 8.5
  }),
  '08_ea_units_and_office_hours': F({
    takeoff: [
      { type: '305x165x40 UB', length: 9000, qty: 6, kgm: 40.3, rate: 1.18 },
      { type: 'Heavy hinge set', length: 1000, qty: 4, kgm: 6.2, rate: 55, _unit: 'EA' }
    ],
    fabHours: 70, fabpackHours: 10, designHours: 12,
    connDesignHours: 4, structEngHours: 3, architectHours: 2,
    instDays: 2, labourRows: [{ qty: 2, rate: 48 }]
  }),
  '09_areas_with_pinned_total': F({
    takeoff: [
      { type: '203x133x25 UB', length: 6000, qty: 8, kgm: 25.1, rate: 1.25, area: 'a1' },
      { type: '80x80x5 SHS', length: 2100, qty: 4, kgm: 11.7, rate: 1.3, area: 'a2' }
    ],
    areas: [{ id: 'a1', name: 'Main' }, { id: 'a2', name: 'Gate' }],
    fabHours: 50, instDays: 2, labourRows: [{ qty: 2, rate: 45 }],
    pricingMode: 'area', areaRebalanceMode: 'fixed',
    areaTotalOverrides: { a2: 1500 }
  }),
  '10_auto_fab_hours': F({
    takeoff: [{ type: '356x171x51 UB', length: 10000, qty: 10, kgm: 51.0, rate: 1.15 }],
    fabHours: 0, fabComplexity: 'medium', instDays: 4,
    labourRows: [{ qty: 2, rate: 45 }]
  })
};

// ── Run ──────────────────────────────────────────────────────────────────────
function numericLeaves(obj, prefix, out) {
  out = out || {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? prefix + '.' + k : k;
    if (typeof v === 'number' && isFinite(v)) out[key] = Math.round(v * 100) / 100;
    else if (Array.isArray(v)) v.forEach((el, i) => {
      if (el && typeof el === 'object') numericLeaves(el, `${key}[${i}]`, out);
    });
    else if (v && typeof v === 'object') numericLeaves(v, key, out);
  }
  return out;
}

const results = {};
for (const [name, q] of Object.entries(FIXTURES)) {
  const totals = runResolving(() => computeQuoteTotals(q, null));
  const out = { totals: numericLeaves(totals) };
  if (q.pricingMode === 'area') {
    q._computed = totals;
    out.areaBreakdown = numericLeaves(runResolving(() => computeAreaBreakdown(q)));
  }
  out.hours = numericLeaves(runResolving(() => computeQuoteHoursByCategory(q)));
  results[name] = out;
}

if (UPDATE) {
  fs.writeFileSync(EXPECTED_PATH, JSON.stringify(results, null, 2));
  console.log(`✓ golden-expected.json re-baselined: ${Object.keys(results).length} fixtures. Commit it with a reason.`);
  process.exit(0);
}

if (!fs.existsSync(EXPECTED_PATH)) {
  console.error('✗ tests/golden-expected.json missing — run with --update once to baseline.');
  process.exit(1);
}
const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));

let failures = 0, comparisons = 0;
for (const [name, exp] of Object.entries(expected)) {
  const got = results[name];
  if (!got) { console.error(`✗ ${name}: fixture missing from harness`); failures++; continue; }
  for (const section of Object.keys(exp)) {
    const e = exp[section] || {}, g = got[section] || {};
    const keys = new Set([...Object.keys(e), ...Object.keys(g)]);
    for (const k of keys) {
      comparisons++;
      const ev = e[k], gv = g[k];
      if (ev == null || gv == null || Math.abs(ev - gv) > TOL) {
        console.error(`✗ ${name} :: ${section}.${k}  expected ${ev}  got ${gv}`);
        failures++;
      }
    }
  }
}
for (const name of Object.keys(results)) {
  if (!expected[name]) { console.error(`✗ ${name}: new fixture with no golden baseline — run --update`); failures++; }
}

if (failures) {
  console.error(`\n✗ GOLDEN TESTS FAILED — ${failures} mismatch(es) across ${comparisons} comparisons.`);
  console.error('  Quoted prices have MOVED. Fix the regression, or re-baseline with --update and justify it in the commit.');
  process.exit(1);
}
console.log(`✓ Golden tests passed — ${comparisons} values across ${Object.keys(expected).length} fixtures, all within ±${TOL}.`);
