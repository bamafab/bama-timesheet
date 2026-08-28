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
          // IfcConversionBasedUnit: factor = ValueComponent × base-unit factor.
          // ValueComponent is an IfcMeasureWithUnit wrapped measure — web-ifc
          // returns it as {type,value} (sometimes nested one level deeper).
          // The base unit is usually an IfcSIUnit, but CATIA has been seen to
          // chain conversion units, so recurse one level if needed.
          var convFactor = function (unit, depth) {
            if (!unit || depth > 3) return null;
            var si = siLengthFactorMM(unit);
            if (si != null) return si;
            if (!(unit.ConversionFactor && unit.ConversionFactor.value != null)) return null;
            var mw = api.GetLine(modelID, unit.ConversionFactor.value);
            var vc = mw && mw.ValueComponent;
            while (vc && vc.value != null && typeof vc.value === 'object') vc = vc.value;
            var val = (vc && vc.value != null) ? Number(vc.value) : NaN;
            var base = 1;
            if (mw && mw.UnitComponent && mw.UnitComponent.value != null) {
              var bu = api.GetLine(modelID, mw.UnitComponent.value);
              var bf = convFactor(bu, depth + 1);
              if (bf != null) base = bf;
            }
            return (isFinite(val) && val > 0) ? val * base : null;
          };
          var cf = convFactor(u, 0);
          if (cf != null) return cf;
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
  //
  // VOLUME CORRECTNESS (production bug, 2026-08-28): surface-style exports
  // (CATIA/3DEXPERIENCE shell models) arrive as MANY separate surface patches
  // per physical part. Taking |volume| per patch/geometry inflates the total
  // massively (P2073 CATIA file: 13.5 t reported vs 0.79 t real, ~17×).
  // Correct approach, implemented in meshComponents():
  //   1. stitch vertices at 1e-6 m tolerance across ALL geometries of the
  //      element (surface patches share boundary vertices),
  //   2. union-find triangles into connected components (= physical shells),
  //   3. repair triangle winding per component (BFS across shared edges — CAD
  //      exports routinely flip normals patch-to-patch),
  //   4. SIGNED tetra sum per component, abs() only at component level.
  //      NEVER abs per face/triangle.
  // Components with boundary edges (an edge used by exactly one triangle) are
  // OPEN shells — their enclosed volume is not well-defined, so they feed the
  // geometry-quality stats and, above 20% of total volume, flag the whole
  // result LOW CONFIDENCE.
  var STEEL_KG_PER_MM3 = 7.85e-6;
  var STITCH_TOL_M = 1e-6; // vertex stitching tolerance, metres

  // Pure geometry: triangle soup → connected components with signed volume.
  // positions: flat [x,y,z,...] in model units; indices: flat triangle indices
  // into positions; tol: stitch tolerance in the SAME units as positions.
  // Returns [{ vol, open, mn:[x,y,z], mx:[x,y,z], tris }] — vol is |signed sum|
  // per component, in positions-units³. Exported as IFCTakeoff._meshComponents
  // so the node test can hit it with a synthetic flipped-normal cube.
  function meshComponents(positions, indices, tol) {
    if (!indices.length) return [];
    tol = tol > 0 ? tol : 1e-9;

    // 1) Stitch: quantise to a tol grid, searching the 27 neighbouring cells
    // so near-boundary vertices still merge. canon[i] = canonical vertex id.
    var cell = {};              // "qx|qy|qz" → [canonical ids in that cell]
    var canonPos = [];          // canonical id → [x,y,z] (first-seen coords)
    var vCount = positions.length / 3;
    var canonOf = new Int32Array(vCount);
    function q(v) { return Math.round(v / tol); }
    for (var i = 0; i < vCount; i++) {
      var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      var qx = q(x), qy = q(y), qz = q(z);
      var found = -1;
      for (var dx = -1; dx <= 1 && found < 0; dx++)
        for (var dy = -1; dy <= 1 && found < 0; dy++)
          for (var dz = -1; dz <= 1 && found < 0; dz++) {
            var ids = cell[(qx + dx) + '|' + (qy + dy) + '|' + (qz + dz)];
            if (!ids) continue;
            for (var c = 0; c < ids.length; c++) {
              var p = canonPos[ids[c]];
              if (Math.abs(p[0] - x) <= tol && Math.abs(p[1] - y) <= tol && Math.abs(p[2] - z) <= tol) {
                found = ids[c]; break;
              }
            }
          }
      if (found < 0) {
        found = canonPos.length;
        canonPos.push([x, y, z]);
        var k0 = qx + '|' + qy + '|' + qz;
        (cell[k0] || (cell[k0] = [])).push(found);
      }
      canonOf[i] = found;
    }

    // 2) Remap triangles to canonical ids; drop degenerates.
    var tris = []; // [a,b,c] canonical
    for (var t = 0; t < indices.length; t += 3) {
      var a = canonOf[indices[t]], b = canonOf[indices[t + 1]], c2 = canonOf[indices[t + 2]];
      if (a === b || b === c2 || a === c2) continue;
      tris.push([a, b, c2]);
    }
    if (!tris.length) return [];

    // 3) Union-find over canonical vertex ids, joined per triangle.
    var uf = new Int32Array(canonPos.length);
    for (var u = 0; u < uf.length; u++) uf[u] = u;
    function find(n) { while (uf[n] !== n) { uf[n] = uf[uf[n]]; n = uf[n]; } return n; }
    function union(m, n) { m = find(m); n = find(n); if (m !== n) uf[m] = n; }
    for (var t2 = 0; t2 < tris.length; t2++) { union(tris[t2][0], tris[t2][1]); union(tris[t2][1], tris[t2][2]); }

    // Group triangle indices per component root.
    var comps = {}; // root → [tri index]
    for (var t3 = 0; t3 < tris.length; t3++) {
      var r = find(tris[t3][0]);
      (comps[r] || (comps[r] = [])).push(t3);
    }

    // 4) Per component: edge map → winding repair (BFS) → signed volume.
    var out = [];
    Object.keys(comps).forEach(function (root) {
      var list = comps[root];
      // Edge map: undirected key → [{tri (local idx), dir(+1 if a<b order)}]
      var edges = {};
      function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
      for (var li = 0; li < list.length; li++) {
        var tr = tris[list[li]];
        for (var e = 0; e < 3; e++) {
          var va = tr[e], vb = tr[(e + 1) % 3];
          var k = edgeKey(va, vb);
          (edges[k] || (edges[k] = [])).push({ li: li, fwd: va < vb });
        }
      }
      // Winding repair: BFS; across a 2-manifold edge the two triangles must
      // traverse it in OPPOSITE directions. flip[li] toggles a triangle.
      var flip = new Uint8Array(list.length);
      var seen = new Uint8Array(list.length);
      var open = false;
      // Components can have several BFS islands if joined only via a vertex.
      for (var seed = 0; seed < list.length; seed++) {
        if (seen[seed]) continue;
        seen[seed] = 1;
        var queue = [seed];
        while (queue.length) {
          var cur = queue.pop();
          var trc = tris[list[cur]];
          for (var e2 = 0; e2 < 3; e2++) {
            var va2 = trc[e2], vb2 = trc[(e2 + 1) % 3];
            var uses = edges[edgeKey(va2, vb2)];
            if (uses.length === 1) { open = true; continue; }
            if (uses.length !== 2) continue; // non-manifold — don't propagate
            var me = null, other = null;
            for (var uu = 0; uu < 2; uu++) { if (uses[uu].li === cur && me == null) me = uses[uu]; else other = uses[uu]; }
            if (!other || seen[other.li]) continue;
            // Effective direction after flips: fwd XOR flip
            var myDir = me.fwd !== !!flip[cur];
            var otDir = other.fwd !== !!flip[other.li];
            if (myDir === otDir) flip[other.li] = 1; // must be opposite
            seen[other.li] = 1;
            queue.push(other.li);
          }
        }
      }
      // Any boundary edge anywhere in the component → open shell.
      if (!open) { Object.keys(edges).some(function (k2) { if (edges[k2].length === 1) { open = true; return true; } return false; }); }

      var vol = 0;
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (var li2 = 0; li2 < list.length; li2++) {
        var tr2 = tris[list[li2]];
        var A = canonPos[tr2[0]], B = canonPos[tr2[1]], C = canonPos[tr2[2]];
        if (flip[li2]) { var tmp = B; B = C; C = tmp; }
        vol += (A[0] * (B[1] * C[2] - B[2] * C[1])
              - A[1] * (B[0] * C[2] - B[2] * C[0])
              + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
        for (var p2 = 0; p2 < 3; p2++) {
          var pt2 = p2 === 0 ? A : (p2 === 1 ? B : C);
          for (var k3 = 0; k3 < 3; k3++) {
            if (pt2[k3] < mn[k3]) mn[k3] = pt2[k3];
            if (pt2[k3] > mx[k3]) mx[k3] = pt2[k3];
          }
        }
      }
      out.push({ vol: Math.abs(vol), open: open, mn: mn, mx: mx, tris: list.length });
    });
    return out;
  }

  function solidPartsOf(api, modelID, expressID, unitMM) {
    // Gather ONE world-space triangle soup across ALL geometries of the
    // element (a CATIA shell arrives as dozens of surface-patch geometries —
    // they must be stitched together, never volumed one by one).
    var positions = [];
    var indices = [];
    api.StreamMeshes(modelID, [expressID], function (mesh) {
      var g = mesh.geometries;
      for (var i = 0; i < g.size(); i++) {
        var pg = g.get(i);
        var geo = api.GetGeometry(modelID, pg.geometryExpressID);
        var verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        var idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        var m = pg.flatTransformation;
        var base = positions.length / 3;
        for (var v = 0; v < verts.length; v += 6) { // x,y,z,nx,ny,nz
          var x = verts[v], y = verts[v + 1], z = verts[v + 2];
          positions.push(
            m[0] * x + m[4] * y + m[8]  * z + m[12],
            m[1] * x + m[5] * y + m[9]  * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
          );
        }
        for (var t = 0; t < idx.length; t++) indices.push(base + idx[t]);
      }
    });
    if (!indices.length) return [];

    var u = unitMM || 1;
    var tolModel = (STITCH_TOL_M * 1000) / u; // 1e-6 m expressed in model units
    var comps = meshComponents(positions, indices, tolModel);

    var parts = [];
    for (var c = 0; c < comps.length; c++) {
      var comp = comps[c];
      var volMM3 = comp.vol * u * u * u;
      if (!isFinite(volMM3) || volMM3 <= 0) continue;
      var dims = [
        (comp.mx[0] - comp.mn[0]) * u,
        (comp.mx[1] - comp.mn[1]) * u,
        (comp.mx[2] - comp.mn[2]) * u
      ].sort(function (x, y) { return y - x; }); // [L, W, T] descending
      parts.push({ kg: volMM3 * STEEL_KG_PER_MM3, volMM3: volMM3, dims: dims, open: comp.open });
    }
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
      var shellsClosed = 0, shellsOpen = 0, openKg = 0;
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
              if (part.open) { shellsOpen++; openKg += part.kg; } else { shellsClosed++; }
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
        // Geometry quality (parts mode): closed vs open shells, and the share
        // of total volume that came from OPEN shells. Above 20% open the whole
        // takeoff is flagged LOW CONFIDENCE — open-shell volume is a best
        // effort, not a watertight measurement.
        geometryQuality: partsMode ? {
          shellsClosed: shellsClosed,
          shellsOpen: shellsOpen,
          openVolumePct: totalKg > 0 ? Math.round((openKg / totalKg) * 1000) / 10 : 0,
          lowConfidence: totalKg > 0 && (openKg / totalKg) > 0.20
        } : null,
        levels: Array.from(new Set(rows.map(function (r) { return r._notes; }).filter(Boolean)))
      }
    };
  }

  global.IFCTakeoff = { parseIFC: parseIFC, loadWebIfc: loadWebIfc, _sectionFromProps: sectionFromProps, _tidyLevel: tidyLevel, _meshComponents: meshComponents };
})(typeof window !== 'undefined' ? window : this);
