/* ============================================================================
 * ifc-takeoff.js — IFC → steel takeoff parser for Quote Builder
 * ----------------------------------------------------------------------------
 * Reads an IFC model (structural steel export from Revit/Tekla/etc.) entirely
 * in the browser via web-ifc (WASM) and returns a flat member list shaped
 * exactly like the PlanSwift importer's _psRows, so QB's existing import
 * pipeline (groupPsRows + importPlanswift) can consume it unchanged.
 *
 * TWO-ENGINE PRINCIPLE: this reads structured data out of the file. It does
 * NOT invent, estimate, or price anything. Section text comes verbatim from
 * the IFC. Length comes from the member's own geometry. Weight/rate come from
 * QB's steel database (findSteelProfile), never from here.
 *
 * Output row shape (per member piece):
 *   { type, length(mm), qty:1, kgm|null, rate|null, _unit:'MM',
 *     _notes:<storey name>, _ifcClass:'BEAM'|'COLUMN'|'MEMBER',
 *     _confidence:'exact'|'fuzzy'|'none' }
 *
 * web-ifc is loaded on demand from jsDelivr (same lazy-CDN pattern as docx.js).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var WEB_IFC_VERSION = '0.0.57';
  var WEB_IFC_CDN = 'https://cdn.jsdelivr.net/npm/web-ifc@' + WEB_IFC_VERSION + '/web-ifc-api-iife.js';
  var WEB_IFC_WASM_DIR = 'https://cdn.jsdelivr.net/npm/web-ifc@' + WEB_IFC_VERSION + '/';

  // Section designation pattern — UK/EN/US families QB's steel DB knows about.
  var SECTION_RE = /((?:UKB|UKC|UB|UC|PFC|RHS|SHS|CHS|HEA|HEB|HEM|HE|IPE|UBP|ASB|W|HP|L)\s?\d[\dxX×.\s]*\d)/;

  var _apiPromise = null;

  // ── Lazy-load web-ifc from CDN (IIFE build exposes window.WebIFC) ──────────
  function loadWebIfc() {
    if (global.WebIFC && global.WebIFC.IfcAPI) return Promise.resolve(global.WebIFC);
    if (_apiPromise) return _apiPromise;
    _apiPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = WEB_IFC_CDN;
      s.async = true;
      s.onload = function () {
        if (global.WebIFC && global.WebIFC.IfcAPI) resolve(global.WebIFC);
        else reject(new Error('web-ifc loaded but WebIFC.IfcAPI missing'));
      };
      s.onerror = function () { reject(new Error('Could not load the IFC reader (network/CDN blocked).')); };
      document.head.appendChild(s);
    });
    return _apiPromise;
  }

  // ── Pull a steel section designation out of a Family:Type string ──────────
  // IFC Name/ObjectType look like "L-Equal Leg Angles:L120x120x12:346361" or
  // "Rectangular Hollow Sections-Column:RHS150x100x6.3". Take the token that
  // reads as a section; fall back to the raw type name so nothing is dropped.
  function sectionFromProps(props) {
    var candidates = [];
    if (props.ObjectType && props.ObjectType.value) candidates.push(props.ObjectType.value);
    if (props.Name && props.Name.value) candidates.push(props.Name.value);
    for (var i = 0; i < candidates.length; i++) {
      var parts = String(candidates[i]).split(':');
      for (var j = 0; j < parts.length; j++) {
        var m = parts[j].match(SECTION_RE);
        if (m) return m[1].replace(/\s+/g, '').trim();
      }
    }
    // No recognisable section — return the cleanest name token we have so the
    // user still sees the member and can fix it by hand.
    if (candidates.length) {
      var first = String(candidates[0]).split(':');
      return (first[1] || first[0] || candidates[0]).trim();
    }
    return '?';
  }

  // ── Determine the file's length unit → factor to convert model units to mm ─
  // web-ifc returns geometry in the file's own declared length unit. A file in
  // millimetres needs ×1; one in metres needs ×1000. Read IfcSIUnit / prefix so
  // we never guess. Defaults to 1 (assume mm) if nothing is declared.
  function lengthUnitToMM(api, modelID) {
    var W = global.WebIFC;
    var factor = 1; // assume mm
    try {
      var ids = api.GetLineIDsWithType(modelID, W.IFCSIUNIT);
      for (var i = 0; i < ids.size(); i++) {
        var u = api.GetLine(modelID, ids.get(i));
        if (u.UnitType && u.UnitType.value === 'LENGTHUNIT' && u.Name && u.Name.value === 'METRE') {
          var pfx = u.Prefix && u.Prefix.value;
          if (pfx === 'MILLI') factor = 1;
          else if (pfx === 'CENTI') factor = 10;
          else if (pfx === 'DECI') factor = 100;
          else if (!pfx || pfx === null) factor = 1000; // plain metres
          else factor = 1000;
          return factor;
        }
      }
    } catch (e) { /* fall back to mm */ }
    // Conversion-based units (e.g. inches) — rare in structural IFC; treat the
    // model as already-mm rather than mangling it.
    return factor;
  }

  // ── Member length = longest axis of its LOCAL-coordinate mesh bbox ────────
  // Works for both extruded solids and Breps (columns). Local coords mean the
  // bbox spans the member itself, not its position in the world. unitMM scales
  // the model's own units to millimetres.
  function memberLengthMM(api, modelID, expressID, unitMM) {
    var mn = [Infinity, Infinity, Infinity];
    var mx = [-Infinity, -Infinity, -Infinity];
    var got = false;
    api.StreamMeshes(modelID, [expressID], function (mesh) {
      var g = mesh.geometries;
      for (var i = 0; i < g.size(); i++) {
        var pg = g.get(i);
        var geo = api.GetGeometry(modelID, pg.geometryExpressID);
        var verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        for (var v = 0; v < verts.length; v += 6) { // x,y,z,nx,ny,nz
          for (var k = 0; k < 3; k++) {
            var c = verts[v + k];
            if (c < mn[k]) mn[k] = c;
            if (c > mx[k]) mx[k] = c;
          }
        }
        got = true;
      }
    });
    if (!got) return null;
    var ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    var longest = Math.max(ext[0], ext[1], ext[2]);
    // Scale the model's own units to mm using the file's declared length unit.
    var mm = Math.round(longest * (unitMM || 1));
    // Guard against NaN/absurd values (a member over 50m is almost certainly a
    // unit or geometry error rather than a real steel section).
    if (!isFinite(mm) || mm <= 0 || mm > 50000) return null;
    return mm;
  }

  // ── Map every element → its containing storey name (level) ────────────────
  // IfcRelContainedInSpatialStructure links elements to an IfcBuildingStorey.
  function buildStoreyMap(api, modelID) {
    var map = {};   // expressID → storey name
    var storeyName = {}; // storey expressID → name
    try {
      var storeys = api.GetLineIDsWithType(modelID, api.GetIfcType ? undefined : undefined);
    } catch (e) { /* fall through to relation scan */ }
    // Name every storey
    var STOREY = 'IFCBUILDINGSTOREY';
    var relLines;
    try {
      var sIds = api.GetLineIDsWithType(modelID, global.WebIFC.IFCBUILDINGSTOREY);
      for (var i = 0; i < sIds.size(); i++) {
        var sid = sIds.get(i);
        var sp = api.GetLine(modelID, sid);
        storeyName[sid] = (sp.Name && sp.Name.value) ? sp.Name.value :
                          (sp.LongName && sp.LongName.value) ? sp.LongName.value : ('Level ' + sid);
      }
      var rIds = api.GetLineIDsWithType(modelID, global.WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
      for (var r = 0; r < rIds.size(); r++) {
        var rel = api.GetLine(modelID, rIds.get(r));
        var structEID = rel.RelatingStructure && rel.RelatingStructure.value;
        var nm = storeyName[structEID];
        if (!nm) continue;
        var elems = rel.RelatedElements || [];
        for (var e = 0; e < elems.length; e++) {
          if (elems[e] && elems[e].value != null) map[elems[e].value] = nm;
        }
      }
    } catch (err) { /* leave map partial — members without a level get '' */ }
    return map;
  }

  // Clean up a storey label for use as a QB area name:
  //  "19.800m MAIN FLOOR" → "Main Floor";  "31.420m UPPER ROOF PLAN" → "Upper Roof Plan"
  function tidyLevel(name) {
    if (!name) return '';
    var s = String(name).replace(/^[\d.,\-\s]*m?\s*/i, '').trim(); // strip leading elevation
    if (!s) s = String(name).trim();
    return s.replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // ── Public: parse an ArrayBuffer, return { rows, summary } ────────────────
  // matchFn(sectionString) → { canonical, kgm, confidence } (QB's findSteelProfile).
  // rateFn(sectionString)  → £/kg or £/m rate (QB's sectionMaterialRate). Both optional.
  async function parseIFC(arrayBuffer, opts) {
    opts = opts || {};
    var matchFn = opts.matchFn || function () { return { canonical: null, kgm: null, confidence: 'none' }; };
    var rateFn = opts.rateFn || function () { return null; };

    var WebIFC = await loadWebIfc();
    var api = new WebIFC.IfcAPI();
    if (api.SetWasmPath) api.SetWasmPath(WEB_IFC_WASM_DIR, true);
    await api.Init();

    var modelID = api.OpenModel(new Uint8Array(arrayBuffer));
    var rows = [];
    var counts = { BEAM: 0, COLUMN: 0, MEMBER: 0 };
    var missingLen = 0;
    var unmatched = 0;

    try {
      var storeyMap = buildStoreyMap(api, modelID);
      var unitMM = lengthUnitToMM(api, modelID);

      var classes = [
        [WebIFC.IFCBEAM, 'BEAM'],
        [WebIFC.IFCCOLUMN, 'COLUMN'],
        [WebIFC.IFCMEMBER, 'MEMBER']
      ];

      for (var ci = 0; ci < classes.length; ci++) {
        var cls = classes[ci][0], label = classes[ci][1];
        var ids = api.GetLineIDsWithType(modelID, cls);
        for (var i = 0; i < ids.size(); i++) {
          var eid = ids.get(i);
          var props = api.GetLine(modelID, eid);
          var section = sectionFromProps(props);
          var lenMM = memberLengthMM(api, modelID, eid, unitMM);
          if (lenMM == null) { missingLen++; lenMM = 0; }

          var prof = matchFn(section) || {};
          var canon = (prof.canonical && prof.confidence !== 'none') ? prof.canonical : section;
          var conf = prof.confidence || 'none';
          if (conf === 'none') unmatched++;

          rows.push({
            type: canon,
            length: lenMM,
            qty: 1,
            kgm: (prof.kgm != null ? prof.kgm : null),
            rate: rateFn(canon),
            _unit: 'MM',
            _notes: tidyLevel(storeyMap[eid] || ''),
            _ifcClass: label,
            _confidence: conf,
            _rawSection: section
          });
          counts[label]++;
        }
      }
    } finally {
      api.CloseModel(modelID);
    }

    return {
      rows: rows,
      summary: {
        total: rows.length,
        beams: counts.BEAM,
        columns: counts.COLUMN,
        members: counts.MEMBER,
        missingLength: missingLen,
        unmatchedSection: unmatched,
        levels: Array.from(new Set(rows.map(function (r) { return r._notes; }).filter(Boolean)))
      }
    };
  }

  global.IFCTakeoff = { parseIFC: parseIFC, loadWebIfc: loadWebIfc, _sectionFromProps: sectionFromProps, _tidyLevel: tidyLevel };
})(typeof window !== 'undefined' ? window : this);
