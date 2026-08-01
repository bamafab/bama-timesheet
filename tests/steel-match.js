// tests/steel-match.js — regression gate for the steel designation matcher.
// Run: node tests/steel-match.js   (exit 1 on any failure)
//
// Covers: exact numeric match, mass/thickness nearest-snap correction, the
// partial-dimension resolution (leading dims given, trailing omitted — e.g.
// "150x90 PFC" → 150x90x24, added 2026-08-01), and the ambiguity guards that
// must NOT match. Gate this before any push touching steel-match.js.

const path = require('path');
const sm = require(path.join(__dirname, '..', 'steel-match.js'));
const sections = require(path.join(__dirname, '..', 'steel-sections.json'));
const idx = sm.steelBuildIndex(sections);

let pass = 0, fail = 0;
function t(input, expect) {
  const m = sm.steelMatch(input, idx);
  const got = m ? `${m.display}${m.corrected ? ' (corrected)' : ''}` : 'NO MATCH';
  if (got === expect) { pass++; }
  else { fail++; console.log(`  ✗ "${input}" => ${got}   (expected: ${expect})`); }
}

// Partial dims — PFCs are unique on depth×flange, so 2 numbers resolve.
t('150x90 PFC', '150x90x24 PFC');
t('150x75 PFC', '150x75x18 PFC');
t('200x90 PFC', '200x90x30 PFC');
t('260x75 PFC', '260x75x28 PFC');
t('150 by 90 PFC', '150x90x24 PFC');   // "by" separator

// Full designation still matches exactly.
t('150x90x24 PFC', '150x90x24 PFC');
t('200x75x23 PFC', '200x75x23 PFC');

// Exact + nearest-mass snap (existing behaviour, must be unchanged).
t('178x102x19 UB', '178x102x19 UB');
t('178x102x23 UB', '178x102x19 UB (corrected)');
t('100x100x8 SHS', '100x100x8.0 SHS');
t('203 by 133 by 25 UB', '203x133x25 UB');

// Ambiguity guards — must NOT match.
t('203x133 UB', 'NO MATCH');   // two masses (25 & 30) — needs the mass
t('150 PFC', 'NO MATCH');      // one dim, many candidates
t('100 UB', 'NO MATCH');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
