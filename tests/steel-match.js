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

// ── Shop-floor phrasing robustness (added 2026-08-01) ───────────────────────
// Family words: beam/column, box/hollow/square/rectangular, flt.
t('305x305x137 column', '305x305x137 UC');
t('254 by 254 by 73 column', '254x254x73 UC');
t('100x100x8 box', '100x100x8.0 SHS');       // box → square hollow
t('120x80x6 box', '120x80x6.3 RHS (corrected)'); // box → rectangular hollow, nearest thk
t('100x100x8 hollow', '100x100x8.0 SHS');
t('100x100x8 square', '100x100x8.0 SHS');
t('120x80x6 rectangular', '120x80x6.3 RHS (corrected)');
t('100x10 flt', '100x10 FLAT');              // "flt" abbreviation
t('100x10 flat', '100x10 FLAT');

// Dimension order spoken reversed — cross-section is order-insensitive, mass is not.
t('133x203x25 UB', '203x133x25 UB');
t('75x150 PFC', '150x75x18 PFC');
t('103 by 203 beam', '203x102x23 UB');       // 103≈102 within tolerance, unique

// Close-mass sections must resolve to the EXACT one said (regression: 438 vs 437).
t('1016x305x438 UB', '1016x305x438 UB');
t('1016x305x437 UB', '1016x305x437 UB');
t('356x406x467 UC', '356x406x467 UC');
t('356x406x463 UC', '356x406x463 UC');

// Reversed + ambiguous still refuses (120x80 RHS has 3 thicknesses).
t('80x120 box', 'NO MATCH');
// Wrong family for the size must not invent a section.
t('203x133x25 column', 'NO MATCH');          // 203x133 is a UB, not a UC

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
