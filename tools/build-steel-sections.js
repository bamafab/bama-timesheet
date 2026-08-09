#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/build-steel-sections.js — regenerate steel-sections.json from the
// canonical STEEL_KGM in steel-data.js. (2026-08-09, four-copy drift fix.)
//
//   node tools/build-steel-sections.js          # writes steel-sections.json
//   node tools/build-steel-sections.js --check  # dry-run, exit 1 if stale
//
// WHY: steel data used to live in four hand-maintained copies (steel-data.js,
// the QB inline copy, steel-sections.json, steel-database.html). The json
// copy drifted (missing 2026-08-08 gap-fills) AND carried garbage kg/m for
// every CHS/SHS/RHS/Flat/Round/Square row (kgm = first designation number,
// not mass) plus nulls for all purlins — and that field drives stock tonnage
// in stock.html / m-qms.html. This generator makes steel-data.js the single
// source for the json. NEVER hand-edit steel-sections.json again: patch
// steel-data.js + the QB inline copy (two-copy rule), then run this script.
//
// Rows present in the OLD json but absent from STEEL_KGM are preserved
// verbatim (with a console warning) so the matcher never loses a section.
// Existing designation strings are kept exactly (tests pin display formats
// like "100x100x8.0 SHS"); only genuinely new rows get generated formatting.
// Gate: node tests/steel-match.js after every run.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');

// ── 1. Load STEEL_KGM from steel-data.js ────────────────────────────────────
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'steel-data.js'), 'utf8'), sandbox);
const KGM = sandbox.window.STEEL_KGM;
if (!KGM || !Object.keys(KGM).length) { console.error('Could not extract STEEL_KGM'); process.exit(1); }

// ── 2. Map each key → { family, designation } ───────────────────────────────
// Alias keys ('*' separators, FLAT≡FLT, RSA≡EA, UEA≡UA) are skipped — they
// exist for lookup convenience in STEEL_KGM only.
const num1 = s => { const m = String(s).match(/\d+(?:\.\d+)?/); return m ? m[0] : ''; };

// Format a hollow-section thickness the way the json always has: '8' → '8.0'.
const dec1 = t => (t.includes('.') ? t : t + '.0');

function classify(key) {
  if (key.includes('*')) return null;                       // separator alias
  let m;
  if ((m = key.match(/^UBP(.+)$/)))  return { f: 'Universal Bearing Piles', d: m[1] };
  if ((m = key.match(/^UB(.+)$/)))   return { f: 'Universal Beams',   d: m[1] };
  if ((m = key.match(/^UC(.+)$/)))   return { f: 'Universal Columns', d: m[1] };
  if ((m = key.match(/^PFC(.+)$/)))  return { f: 'PF Channels',       d: m[1] };
  if (key.startsWith('RSA') || key.startsWith('UEA') || key.startsWith('FLAT')) return null; // aliases of EA/UA/FLT
  if ((m = key.match(/^EA(.+)$/)))   return { f: 'Equal Angles',      d: m[1] };
  if ((m = key.match(/^UA(.+)$/)))   return { f: 'Unequal Angles',    d: m[1] };
  if ((m = key.match(/^CHS(.+)x(.+)$/))) return { f: 'CHS', d: `${m[1]}x${dec1(m[2])}` };
  if ((m = key.match(/^SHS(.+)x(.+)$/))) return { f: 'SHS', d: `${m[1]}x${dec1(m[2])}` };
  if ((m = key.match(/^RHS(.+)x(.+)$/))) return { f: 'RHS', d: `${m[1]}x${dec1(m[2])}` };
  if ((m = key.match(/^FLT(.+)$/)))  return { f: 'Flat Bar',   d: m[1] };
  if (key.match(/^RB\d/))            return { f: 'Round Bar',  d: key };
  if (key.match(/^SQB\d/))           return { f: 'Square Bar', d: key };
  if ((m = key.match(/^ASB(\d+)x(\d+)$/))) return { f: 'Asymmetric Beams', d: `${m[1]} ASB ${m[2]}` };
  if ((m = key.match(/^IPE(.+)$/))) return { f: 'IPE (European)', d: `IPE ${m[1]}` };
  if ((m = key.match(/^HE(\d+)([ABCM])$/))) return { f: 'HE (European)', d: `HE ${m[1]} ${m[2]}` };
  if ((m = key.match(/^W(.+)$/)) && key.match(/^W\d/))  return { f: 'W-sections (ASTM)',  d: `W ${m[1]}` };
  if ((m = key.match(/^HP(.+)$/)) && key.match(/^HP\d/)) return { f: 'HP-sections (ASTM)', d: `HP ${m[1]}` };
  if ((m = key.match(/^ALU-(EA|SHS|RHS|CHS|FLAT|RB)(.*)$/))) {
    const fam = { EA: 'Aluminium Equal Angle', SHS: 'Aluminium SHS', RHS: 'Aluminium RHS',
                  CHS: 'Aluminium CHS', FLAT: 'Aluminium Flat Bar', RB: 'Aluminium Round Bar' }[m[1]];
    return { f: fam, d: m[2] };
  }
  if ((m = key.match(/^SS-(EA|SHS|RHS|CHS|FLAT|RB)(.*)$/))) {
    const fam = { EA: 'Stainless Equal Angle', SHS: 'Stainless SHS', RHS: 'Stainless RHS',
                  CHS: 'Stainless CHS', FLAT: 'Stainless Flat Bar', RB: 'Stainless Round Bar' }[m[1]];
    return { f: fam, d: m[2] };
  }
  if (key.match(/^Z\d/))  return { f: 'Cold-Formed Purlins (Albion Zed)',  d: key };
  if (key.match(/^C\d/))  return { f: 'Cold-Formed Purlins (Albion Cee)',  d: key };
  if (key.match(/^M\d/))  return { f: 'Cold-Formed Purlins (Kingspan Multibeam)', d: key };
  if (key.match(/^\d/))   return { f: 'Cold-Formed Purlins (Metsec)', d: key }; // 142Z13, 170E20 …
  return { f: null, d: key }; // unclassified — reported, not emitted
}

// ── 3. Build generated rows ─────────────────────────────────────────────────
const genByFam = new Map();
const unclassified = [];
for (const [key, kgm] of Object.entries(KGM)) {
  const c = classify(key);
  if (!c) continue;
  if (!c.f) { unclassified.push(key); continue; }
  if (!genByFam.has(c.f)) genByFam.set(c.f, []);
  genByFam.get(c.f).push({ f: c.f, d: c.d, kgm });
}

// ── 4. Union with old json: keep old designation strings; keep old-only rows ─
const oldRows = JSON.parse(fs.readFileSync(path.join(ROOT, 'steel-sections.json'), 'utf8'));
const nums = s => (String(s).match(/\d+(?:\.\d+)?/g) || []).map(Number).join(',');
const lets = s => String(s).toUpperCase().replace(/[^A-Z]/g, '').replace(/X/g, '');
const sig  = r => `${r.f}|${nums(r.d)}|${lets(r.d)}`;

const genBySig = new Map();
for (const rows of genByFam.values()) for (const r of rows) genBySig.set(sig(r), r);

const keptOldOnly = [];
let renamed = 0, kgmFixed = 0;
for (const o of oldRows) {
  const g = genBySig.get(sig(o));
  if (g) {
    if (g.d !== o.d) { g.d = o.d; renamed++; }              // preserve display string
    if (o.kgm !== g.kgm) kgmFixed++;
  } else {
    keptOldOnly.push(o);                                     // not in STEEL_KGM — preserve
  }
}

// Family output order = old json's family order, then any new families.
const famOrder = [];
for (const o of oldRows) if (!famOrder.includes(o.f)) famOrder.push(o.f);
for (const f of genByFam.keys()) if (!famOrder.includes(f)) famOrder.push(f);

const out = [];
for (const f of famOrder) {
  for (const r of (genByFam.get(f) || [])) out.push(r);
  for (const o of keptOldOnly) if (o.f === f) out.push(o);
}

// ── 5. Report + write ────────────────────────────────────────────────────────
console.log(`STEEL_KGM entries: ${Object.keys(KGM).length} (aliases skipped)`);
console.log(`Generated rows: ${out.length}  (old json: ${oldRows.length})`);
console.log(`kg/m values corrected vs old json: ${kgmFixed}`);
console.log(`Old-only rows preserved (NOT in STEEL_KGM — consider adding them): ${keptOldOnly.length}`);
for (const o of keptOldOnly) console.log(`   • ${o.f}  ${o.d}  (kgm in old json: ${o.kgm})`);
if (unclassified.length) console.log(`Unclassified keys (NOT emitted): ${unclassified.join(', ')}`);

const json = '[' + out.map(r => JSON.stringify(r)).join(',\n') + ']';
if (CHECK) {
  const cur = fs.readFileSync(path.join(ROOT, 'steel-sections.json'), 'utf8');
  if (cur.trim() !== json.trim()) { console.error('\nSTALE: steel-sections.json does not match steel-data.js — rerun this script.'); process.exit(1); }
  console.log('\nsteel-sections.json is up to date.');
} else {
  fs.writeFileSync(path.join(ROOT, 'steel-sections.json'), json + '\n');
  console.log('\nWrote steel-sections.json');
}
