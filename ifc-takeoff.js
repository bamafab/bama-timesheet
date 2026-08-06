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
  // millimetres needs ×1; one in metres needs ×1000. Two declaration styles:
  //   • IfcSIUnit LENGTHUNIT (Revit/Tekla): prefix tells us MILLI/plain metres.
  //   • IfcConversionBasedUnit LENGTHUNIT (CATIA/3DEXPERIENCE): e.g. 'METRE'
  //     defined as 1000 × an underlying milli-metre SIUnit. Missing this case
  //     under-scales every dimension 1000× — so resolve the conversion chain.
  // Defaults to 1 (assume mm) if nothing is declared.
  function siLengthFactorMM(u) {
    if (!(u && u.Name && u.Name.value === 'METRE')) return null;
    var pfx = u.Prefix && u.Prefix.value;
    if (pfx === 'MILLI') return 1;
    if (pfx === 'CENTI') return 10;
    if (pfx === 'DECI') return 100;
    return 1000; // plain metres (or unknown prefix — treat as m)
  }
  function lengthUnitToMM(api, modelID) {
    var W = global.WebIFC;
    try {
      // Preferred: walk the project's IfcUnitAssignment — that is the unit the
      // geometry is actually authored in (a stray SIUnit may only be the BASE
      // of a conversion unit, as in CATIA exports).
      var uaIds = api.GetLineIDsWithType(modelID, W.IFCUNITASSIGNMENT);
      for (var a = 0; a < uaIds.size(); a++) {
        var ua = api.GetLine(modelID, uaIds.get(a));
        var units = ua.Units || [];
        for (var j = 0; j < units.length; j++) {
          if (!units[j] || units[j].value == null) continue;
          var u = api.GetLine(modelID, units[j].value);
          if (!(u.UnitType && u.UnitType.value === 'LENGTHUNIT')) continue;
          var si = siLengthFactorMM(u);
          if (si != null) return si; // plain IfcSIUnit LENGTHUNIT
          // IfcConversionBasedUnit: factor = ValueComponent × base-unit factor
          if (u.ConversionFactor && u.ConversionFactor.value != null) {
            var mw = api.GetLine(modelID, u.ConversionFactor.value);
            var vc = mw && mw.ValueComponent;
            var val = (vc && vc.value != null) ? Number(vc.value) : NaN;
            var base = 1;
            if (mw && mw.UnitComponent && mw.UnitComponent.value != null) {
              var bu = api.GetLine(modelID, mw.UnitComponent.value);
              var bf = siLengthFactorMM(bu);
              if (bf != null) base = bf;
            }
            if (isFinite(val) && val > 0) return val * base;
          }
        }
      }
    } catch (e) { /* fall through to the plain SIUnit scan */ }
    try {
      var ids = api.GetLineIDsWithType(modelID, W.IFCSIUNIT);
      for (var i = 0; i < ids.size(); i++) {
        var u2 = api.GetLine(modelID, ids.get(i));
        if (u2.UnitType && u2.UnitType.value === 'LENGTHUNIT') {
          var f = siLengthFactorMM(u2);
          if (f != null) return f;
        }
      }
    } catch (e2) { /* fall back to mm */ }
    return 1;
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

  // ── PARTS MODE: mesh a solid element → per-part volume, bbox, mass ─────────
  // For CAD-style exports (CATIA / SolidWorks / Inventor) that contain no
  // IfcBeam/Column/Member — just IfcBuildingElementProxy / IfcPlate solids
  // (brackets, plate assemblies). Volume is the exact signed-tetrahedron sum
  // over the triangulated mesh (divergence theorem) — deterministic geometry,
  // nothing estimated. Mass = volume × 7850 kg/m³ (structural steel).
  var STEEL_KG_PER_MM3 = 7.85e-6;

  function solidPartsOf(api, modelID, expressID, unitMM) {
    var parts = [];
    api.StreamMeshes(modelID, [expressID], function (mesh) {
      var g = mesh.geometries;
      for (var i = 0; i < g.size(); i++) {
        var pg = g.get(i);
        var geo = api.GetGeometry(modelID, pg.geometryExpressID);
        var verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        var idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        var m = pg.flatTransformation;
        function tx(vi) {
          var x = verts[vi * 6], y = verts[vi * 6 + 1], z = verts[vi * 6 + 2];
          return [
            m[0] * x + m[4] * y + m[8]  * z + m[12],
            m[1] * x + m[5] * y + m[9]  * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
          ];
        }
        var vol = 0;
        var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (var t = 0; t < idx.length; t += 3) {
          var a = tx(idx[t]), b = tx(idx[t + 1]), c = tx(idx[t + 2]);
          vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
                - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
          for (var p = 0; p < 3; p++) {
            var pt = p === 0 ? a : (p === 1 ? b : c);
            for (var k = 0; k < 3; k++) {
              if (pt[k] < mn[k]) mn[k] = pt[k];
              if (pt[k] > mx[k]) mx[k] = pt[k];
            }
          }
        }
        var u = unitMM || 1;
        var volMM3 = Math.abs(vol) * u * u * u;
        if (!isFinite(volMM3) || volMM3 <= 0) continue;
        var dims = [(mx[0] - mn[0]) * u, (mx[1] - mn[1]) * u, (mx[2] - mn[2]) * u]
          .sort(function (x, y) { return y - x; }); // [L, W, T] descending
        parts.push({ kg: volMM3 * STEEL_KG_PER_MM3, volMM3: volMM3, dims: dims });
      }
    });
    return parts;
  }

  // Human label for a solid part from its measured geometry:
  //  • bbox ≥90% full → a rectangular plate/flat → "PLT T x W x L"
  //  • matches a solid cylinder on its two near-equal minor axes → "Bar ØD x L"
  //  • anything else → "Solid part L x W x T" (machined/welded body)
  function labelPart(part) {
    var d = part.dims;
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    var L = r1(d[0]), W = r1(d[1]), T = r1(d[2]);
    var bboxVol = d[0] * d[1] * d[2];
    if (bboxVol > 0 && part.volMM3 / bboxVol >= 0.9) {
      return 'PLT ' + T + ' x ' + W + ' x ' + L;
    }
    // Cylinder test: minor axes within 5% of each other, and volume within
    // ±10% of π·(D/2)²·L for D = mean of the minor axes.
    if (d[2] > 0 && d[1] / d[2] <= 1.05) {
      var D = (d[1] + d[2]) / 2;
      var cyl = Math.PI * (D / 2) * (D / 2) * d[0];
      var fit = part.volMM3 / cyl;
      if (fit >= 0.9 && fit <= 1.1) return 'Bar \u00D8' + r1(D) + ' x ' + L;
    }
    return 'Solid part ' + L + ' x ' + W + ' x ' + T;
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

      // ── PARTS FALLBACK ─────────────────────────────────────────────────
      // No linear steel members at all: this is a CAD solids export (CATIA/
      // SolidWorks bracket or plate assembly). Measure every solid instead —
      // per-part mesh volume × 7850 → kg each — and emit EA rows QB already
      // knows how to price (kgm = kg each, length 1000, same as the staircase
      // engine's tread rows). Identical parts group into a qty.
      var partsMode = false;
      var partsCount = 0;
      var totalKg = 0;
      if (!rows.length) {
        var partClasses = [
          WebIFC.IFCBUILDINGELEMENTPROXY, WebIFC.IFCPLATE,
          WebIFC.IFCDISCRETEACCESSORY, WebIFC.IFCMECHANICALFASTENER
        ];
        var grouped = {}; // key → row
        for (var pc = 0; pc < partClasses.length; pc++) {
          if (partClasses[pc] == null) continue;
          var pIds = api.GetLineIDsWithType(modelID, partClasses[pc]);
          for (var pi = 0; pi < pIds.size(); pi++) {
            var peid = pIds.get(pi);
            var pProps = api.GetLine(modelID, peid);
            var elName = (pProps.Name && pProps.Name.value ? String(pProps.Name.value) : '')
              .replace(/\.(step|stp|ifc)$/i, '').trim();
            var parts = solidPartsOf(api, modelID, peid, unitMM);
            for (var pp = 0; pp < parts.length; pp++) {
              var part = parts[pp];
              // Skip mesh slivers under 10g — export artefacts, not steel.
              if (part.kg < 0.01) continue;
              partsMode = true;
              partsCount++;
              totalKg += part.kg;
              var kgEach = Math.round(part.kg * 100) / 100;
              var dimKey = part.dims.map(function (v) { return Math.round(v * 2) / 2; }).join('x');
              var key = elName + '|' + dimKey + '|' + kgEach;
              if (grouped[key]) { grouped[key].qty++; continue; }
              grouped[key] = {
                type: labelPart(part),
                length: 1000,          // EA convention: weight = (length/1000)·kgm·qty
                qty: 1,
                kgm: kgEach,           // kg per piece — measured, not estimated
                rate: rateFn ? rateFn('PLT') : null,
                _unit: 'EA',
                _notes: elName,
                _ifcClass: 'PART',
                _confidence: 'exact',  // geometry-derived weight — nothing fuzzy
                _rawSection: labelPart(part)
              };
            }
          }
        }
        Object.keys(grouped).forEach(function (k) { rows.push(grouped[k]); });
      }
    } finally {
      api.CloseModel(modelID);
    }

    return {
      rows: rows,
      summary: {
        total: partsMode ? partsCount : rows.length,
        beams: counts.BEAM,
        columns: counts.COLUMN,
        members: counts.MEMBER,
        missingLength: missingLen,
        unmatchedSection: partsMode ? 0 : unmatched,
        mode: partsMode ? 'parts' : 'members',
        parts: partsCount,
        uniqueParts: partsMode ? rows.length : 0,
        totalKg: partsMode ? Math.round(totalKg * 10) / 10 : null,
        levels: Array.from(new Set(rows.map(function (r) { return r._notes; }).filter(Boolean)))
      }
    };
  }

  global.IFCTakeoff = { parseIFC: parseIFC, loadWebIfc: loadWebIfc, _sectionFromProps: sectionFromProps, _tidyLevel: tidyLevel };
})(typeof window !== 'undefined' ? window : this);
