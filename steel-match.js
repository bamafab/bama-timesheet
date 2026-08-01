// ─────────────────────────────────────────────────────────────────────────────
// steel-match.js — deterministic steel designation matcher (Phase C3b)
//
// Turns messy human/voice input ("UB 178*102*23", "100 by 100 by 5 box",
// "shs 100x100x5") into a real steel-database entry, numerically:
//   1. family detected from alias words anywhere in the string
//   2. dimensions compared as NUMBERS (so "5" == "5.0", "*" == "x" == "by")
//   3. if the leading dims match but the last doesn't (mass/thickness
//      misheard), it SNAPS to the nearest real one and flags the correction
//      — e.g. 178x102x23 UB → 178x102x19 UB (19 kg/m), corrected.
//
// Pure functions, no DOM — used by stock.html and unit-tested in node.
// ─────────────────────────────────────────────────────────────────────────────

const STEEL_FAMILY_ABBR = {
  'Universal Beams': 'UB', 'Universal Columns': 'UC', 'PF Channels': 'PFC',
  'SHS': 'SHS', 'RHS': 'RHS', 'CHS': 'CHS',
  'Equal Angles': 'EA', 'Unequal Angles': 'UA',
  'Flat Bar': 'FLAT', 'Round Bar': 'ROUND', 'Square Bar': 'SQB',
  'Cold-Formed Purlins (Metsec)': 'METSEC',
  'Cold-Formed Purlins (Albion Zed)': 'ZED',
  'Cold-Formed Purlins (Albion Cee)': 'CEE',
  'Cold-Formed Purlins (Kingspan Multibeam)': 'MULTIBEAM'
};

// alias token (spaces stripped) -> family abbr
const STEEL_FAMILY_ALIASES = {
  UB: 'UB', UNIVERSALBEAM: 'UB', UNIVERSALBEAMS: 'UB', BEAM: 'UB', IBEAM: 'UB',
  UC: 'UC', UNIVERSALCOLUMN: 'UC', UNIVERSALCOLUMNS: 'UC', COLUMN: 'UC',
  PFC: 'PFC', CHANNEL: 'PFC', PARALLELFLANGECHANNEL: 'PFC',
  SHS: 'SHS', BOX: 'SHS', BOXSECTION: 'SHS', SQUAREHOLLOW: 'SHS', SQUAREHOLLOWSECTION: 'SHS',
  RHS: 'RHS', RECTANGULARHOLLOW: 'RHS', RECTANGULARHOLLOWSECTION: 'RHS',
  CHS: 'CHS', TUBE: 'CHS', PIPE: 'CHS', CIRCULARHOLLOW: 'CHS', CIRCULARHOLLOWSECTION: 'CHS',
  EA: 'EA', ANGLE: 'EA', EQUALANGLE: 'EA', RSA: 'EA',
  UA: 'UA', UNEQUALANGLE: 'UA',
  FLAT: 'FLAT', FLATBAR: 'FLAT', FLATS: 'FLAT',
  ROUND: 'ROUND', ROUNDBAR: 'ROUND', ROD: 'ROUND', BAR: 'ROUND',
  SQB: 'SQB', SQUAREBAR: 'SQB',
  METSEC: 'METSEC', ZED: 'ZED', CEE: 'CEE', MULTIBEAM: 'MULTIBEAM'
};

function steelParseDims(designation) {
  return (String(designation).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

// Build once: sections + parsed dims + abbr
function steelBuildIndex(sections) {
  return sections.map(s => ({
    ...s,
    abbr: STEEL_FAMILY_ABBR[s.f] || String(s.f).toUpperCase(),
    dims: steelParseDims(s.d)
  }));
}

const _near = (a, b) => Math.abs(a - b) <= Math.max(0.11, b * 0.01);

// steelMatch(raw, index) -> { entry, corrected, original, display } | null
function steelMatch(raw, index) {
  if (!raw) return null;
  let n = String(raw).toUpperCase()
    .replace(/[*×]/g, 'X')
    .replace(/\bBY\b/g, 'X')
    .replace(/,/g, ' ');

  // family detection: try longest alias tokens against the de-spaced string
  let famAbbr = null;
  const compact = n.replace(/[^A-Z0-9.]/g, '');
  const aliasKeys = Object.keys(STEEL_FAMILY_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of aliasKeys) {
    if (compact.includes(k)) {
      // guard: 'BAR'/'BEAM' etc must not be a substring of digits context — fine for letters
      famAbbr = STEEL_FAMILY_ALIASES[k];
      break;
    }
  }

  const nums = (n.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;

  const pool = famAbbr ? index.filter(s => s.abbr === famAbbr) : index;

  // 1) exact numeric match (same dim count, every dim near-equal)
  const exact = pool.filter(s => s.dims.length === nums.length && s.dims.every((d, i) => _near(nums[i], d)));
  if (exact.length === 1 || (exact.length > 1 && famAbbr)) {
    const e = exact[0];
    return { entry: e, corrected: false, original: raw, display: `${e.d} ${e.abbr}` };
  }
  if (exact.length > 1) return null;   // ambiguous across families without a family word

  // 2) mass/thickness snap: leading dims match, last dim wrong -> nearest real
  if (nums.length >= 2) {
    const lead = nums.slice(0, -1), lastN = nums[nums.length - 1];
    const cands = pool.filter(s => s.dims.length === nums.length
      && s.dims.slice(0, -1).every((d, i) => _near(lead[i], d)));
    if (cands.length) {
      const best = cands.reduce((a, b) =>
        Math.abs(a.dims[a.dims.length - 1] - lastN) <= Math.abs(b.dims[b.dims.length - 1] - lastN) ? a : b);
      // only snap when unambiguous family context (family word given, or single-family candidates)
      const fams = new Set(cands.map(c => c.abbr));
      if (famAbbr || fams.size === 1) {
        return { entry: best, corrected: !_near(lastN, best.dims[best.dims.length - 1]),
                 original: raw, display: `${best.d} ${best.abbr}` };
      }
    }
  }

  // 3) partial dims: the input gives the LEADING dimensions and omits the
  //    trailing one(s) — e.g. "150x90 PFC" (depth×flange, mass omitted) or
  //    "203x133 UB". If the leading dims resolve to exactly ONE real section,
  //    it's unambiguous, so use it. Requires a family word (or a single-family
  //    hit) so we never guess across families. "150 PFC" (one dim, many
  //    matches) stays ambiguous and falls through.
  if (nums.length >= 1) {
    const starts = pool.filter(s => s.dims.length > nums.length
      && nums.every((v, i) => _near(v, s.dims[i])));
    const distinct = [...new Map(starts.map(s => [s.d, s])).values()];
    if (distinct.length === 1) {
      const fams = new Set(starts.map(c => c.abbr));
      if (famAbbr || fams.size === 1) {
        const e = distinct[0];
        // Dims were simply omitted, nothing misheard — not flagged as a correction.
        return { entry: e, corrected: false, original: raw, display: `${e.d} ${e.abbr}` };
      }
    }
  }

  // 4) dims given without enough detail AND ambiguous — no match
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { steelBuildIndex, steelMatch, STEEL_FAMILY_ABBR, STEEL_FAMILY_ALIASES };
}
