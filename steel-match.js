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

// alias token (spaces stripped) -> family abbr, OR an array of abbrs when the
// spoken word is genuinely ambiguous (e.g. "box" could be square OR rectangular
// hollow — we search both and let the dimensions disambiguate).
const STEEL_FAMILY_ALIASES = {
  UB: 'UB', UNIVERSALBEAM: 'UB', UNIVERSALBEAMS: 'UB', BEAM: 'UB', BEAMS: 'UB', IBEAM: 'UB', UNIBEAM: 'UB',
  UC: 'UC', UNIVERSALCOLUMN: 'UC', UNIVERSALCOLUMNS: 'UC', COLUMN: 'UC', COLUMNS: 'UC', UNICOLUMN: 'UC',
  PFC: 'PFC', CHANNEL: 'PFC', CHANNELS: 'PFC', PARALLELFLANGECHANNEL: 'PFC', CEECHANNEL: 'PFC',
  // "box" / "hollow" are ambiguous between square and rectangular hollow section
  BOX: ['SHS', 'RHS'], BOXSECTION: ['SHS', 'RHS'], HOLLOW: ['SHS', 'RHS'], HOLLOWSECTION: ['SHS', 'RHS'],
  SHS: 'SHS', SQUAREHOLLOW: 'SHS', SQUAREHOLLOWSECTION: 'SHS', SQUAREBOX: 'SHS', SQUARE: 'SHS',
  RHS: 'RHS', RECTANGULARHOLLOW: 'RHS', RECTANGULARHOLLOWSECTION: 'RHS', RECTANGULAR: 'RHS', RECTBOX: 'RHS', OBLONG: 'RHS',
  CHS: 'CHS', TUBE: 'CHS', TUBES: 'CHS', PIPE: 'CHS', PIPES: 'CHS', CIRCULARHOLLOW: 'CHS', CIRCULARHOLLOWSECTION: 'CHS', ROUNDHOLLOW: 'CHS',
  EA: 'EA', ANGLE: 'EA', ANGLES: 'EA', EQUALANGLE: 'EA', EQUALANGLES: 'EA', RSA: 'EA',
  UA: 'UA', UNEQUALANGLE: 'UA', UNEQUALANGLES: 'UA',
  FLAT: 'FLAT', FLATBAR: 'FLAT', FLATS: 'FLAT', FLT: 'FLAT', FB: 'FLAT', STRIP: 'FLAT',
  ROUND: 'ROUND', ROUNDBAR: 'ROUND', ROD: 'ROUND', RB: 'ROUND',
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

  // family detection: try longest alias tokens against the de-spaced string.
  // An alias may map to a SINGLE family or an ARRAY of families ("box" → SHS+RHS).
  let famAbbrs = null;   // array of abbrs, or null (search everything)
  const compact = n.replace(/[^A-Z0-9.]/g, '');
  const aliasKeys = Object.keys(STEEL_FAMILY_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of aliasKeys) {
    if (compact.includes(k)) {
      const v = STEEL_FAMILY_ALIASES[k];
      famAbbrs = Array.isArray(v) ? v.slice() : [v];
      break;
    }
  }

  const nums = (n.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;

  const pool = famAbbrs ? index.filter(s => famAbbrs.includes(s.abbr)) : index;
  const hadFamily = !!famAbbrs;

  // Cross-section families where the first TWO dims are interchangeable when
  // spoken (depth×width for open sections, or the two face sizes of RHS). The
  // trailing dim (mass or thickness) is NEVER reordered. Angles included: an
  // unequal angle "200x150" may be said "150x200".
  const ORDERABLE = new Set(['UB', 'UC', 'PFC', 'RHS', 'UA', 'EA', 'SHS']);

  // Does the input `nums` match section `s`, allowing the first two dims to be
  // swapped for orderable families? Returns true/false.
  function dimsMatch(s, want) {
    if (s.dims.length !== want.length) return false;
    if (s.dims.every((d, i) => _near(want[i], d))) return true;
    if (ORDERABLE.has(s.abbr) && want.length >= 2) {
      const sw = want.slice(); [sw[0], sw[1]] = [sw[1], sw[0]];
      return s.dims.every((d, i) => _near(sw[i], d));
    }
    return false;
  }
  // Same, but only the LEADING dims (input omitted trailing dim/s).
  function leadMatch(s, want) {
    if (s.dims.length <= want.length) return false;
    if (want.every((v, i) => _near(v, s.dims[i]))) return true;
    if (ORDERABLE.has(s.abbr) && want.length >= 2) {
      const sw = want.slice(); [sw[0], sw[1]] = [sw[1], sw[0]];
      return sw.every((v, i) => _near(v, s.dims[i]));
    }
    return false;
  }

  // 1) full match (dim count equal), order-insensitive on the cross-section.
  //    First try EXACT numeric equality (so near-neighbour masses like 438 vs
  //    437 don't collide); only fall back to near-equality if nothing is exact.
  const exactStrict = pool.filter(s => s.dims.length === nums.length && (
    s.dims.every((d, i) => d === nums[i]) ||
    (ORDERABLE.has(s.abbr) && nums.length >= 2 && s.dims[0] === nums[1] && s.dims[1] === nums[0] && s.dims.slice(2).every((d, i) => d === nums[i + 2]))
  ));
  const strictDistinct = [...new Map(exactStrict.map(s => [s.abbr + s.d, s])).values()];
  if (strictDistinct.length === 1) {
    const e = strictDistinct[0];
    return { entry: e, corrected: false, original: raw, display: `${e.d} ${e.abbr}` };
  }

  const exact = pool.filter(s => dimsMatch(s, nums));
  const exactDistinct = [...new Map(exact.map(s => [s.abbr + s.d, s])).values()];
  if (exactDistinct.length === 1) {
    const e = exactDistinct[0];
    return { entry: e, corrected: false, original: raw, display: `${e.d} ${e.abbr}` };
  }
  if (exactDistinct.length > 1 && hadFamily && famAbbrs.length === 1) {
    return null;
  }
  if (exactDistinct.length > 1) return null;   // ambiguous (e.g. box matched an SHS and an RHS) — refuse

  // 2) mass/thickness snap: leading dims match (either order), last dim wrong
  //    → nearest real one. Only when the family is unambiguous.
  if (nums.length >= 2) {
    const lastN = nums[nums.length - 1];
    const lead = nums.slice(0, -1);
    const cands = pool.filter(s => {
      if (s.dims.length !== nums.length) return false;
      const sLead = s.dims.slice(0, -1);
      if (lead.every((v, i) => _near(v, sLead[i]))) return true;
      if (ORDERABLE.has(s.abbr) && lead.length >= 2) {
        const sw = lead.slice(); [sw[0], sw[1]] = [sw[1], sw[0]];
        return sw.every((v, i) => _near(v, sLead[i]));
      }
      return false;
    });
    const candFams = new Set(cands.map(c => c.abbr));
    if (cands.length && candFams.size === 1) {
      const best = cands.reduce((a, b) =>
        Math.abs(a.dims[a.dims.length - 1] - lastN) <= Math.abs(b.dims[b.dims.length - 1] - lastN) ? a : b);
      return { entry: best, corrected: !_near(lastN, best.dims[best.dims.length - 1]),
               original: raw, display: `${best.d} ${best.abbr}` };
    }
  }

  // 3) partial dims: leading dims given (either order), trailing omitted —
  //    e.g. "150x90 PFC" or "150x90 box". Resolve only when it pins exactly ONE
  //    real section. "150 PFC" (one dim, many) stays ambiguous.
  if (nums.length >= 1) {
    const starts = pool.filter(s => leadMatch(s, nums));
    const distinct = [...new Map(starts.map(s => [s.abbr + s.d, s])).values()];
    if (distinct.length === 1) {
      const e = distinct[0];
      return { entry: e, corrected: false, original: raw, display: `${e.d} ${e.abbr}` };
    }
  }

  // 4) not enough detail / ambiguous — no match
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { steelBuildIndex, steelMatch, STEEL_FAMILY_ABBR, STEEL_FAMILY_ALIASES };
}
