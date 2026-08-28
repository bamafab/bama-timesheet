#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ifc-harness.js — drives the SHIPPING ifc-takeoff.js engine from the command
// line so pytest (tests/test_takeoff.py) can assert on it. Two modes:
//
//   node tests/ifc-harness.js cube
//     Synthetic regression for the abs-per-triangle volume bug: a unit cube
//     whose triangle windings are deliberately flipped in a fixed pattern,
//     with every triangle carrying its own duplicated vertices (surface-soup
//     style, like a CATIA patch export). The fixed engine must stitch, repair
//     winding, and report EXACTLY the cube's volume — the broken engine
//     reported roughly double (abs per tetra contribution).
//     Prints: {"components":[{"vol":..,"open":..}]}
//
//   node tests/ifc-harness.js parse <file.ifc>
//     Full parseIFC on a real file. Needs web-ifc installed:
//       npm i --prefix tests web-ifc@0.0.57
//     Prints: {"summary":{...}, "rowCount":N}
//
// Stdlib-only apart from the optional web-ifc dependency for parse mode.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const mod = require(path.join(__dirname, '..', 'ifc-takeoff.js'));
const IFCTakeoff = mod.IFCTakeoff || global.IFCTakeoff;
if (!IFCTakeoff) { console.error('ifc-takeoff.js did not export IFCTakeoff'); process.exit(2); }

const mode = process.argv[2];

if (mode === 'cube') {
  // Unit cube: 8 logical vertices, 12 triangles with consistent outward
  // winding — then every EVEN triangle gets its winding flipped, and every
  // triangle gets its own private (duplicated) vertices.
  const P8 = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const T = [
    [0,2,1],[0,3,2],  // bottom
    [4,5,6],[4,6,7],  // top
    [0,1,5],[0,5,4],  // front
    [2,3,7],[2,7,6],  // back
    [1,2,6],[1,6,5],  // right
    [3,0,4],[3,4,7]   // left
  ];
  const positions = [];
  const indices = [];
  T.forEach((t, ti) => {
    const order = (ti % 2 === 0) ? [t[0], t[2], t[1]] : t; // flip evens
    order.forEach(vi => {
      indices.push(positions.length / 3);
      positions.push(P8[vi][0], P8[vi][1], P8[vi][2]);
    });
  });
  const comps = IFCTakeoff._meshComponents(positions, indices, 1e-6);
  console.log(JSON.stringify({ components: comps.map(c => ({ vol: c.vol, open: c.open, tris: c.tris })) }));
  process.exit(0);
}

if (mode === 'parse') {
  const file = process.argv[3];
  if (!file || !fs.existsSync(file)) { console.error('usage: ifc-harness.js parse <file.ifc>'); process.exit(2); }
  let WebIFC;
  try {
    WebIFC = require('web-ifc'); // tests/node_modules or global
  } catch (e) {
    console.error('WEB_IFC_MISSING: npm i --prefix tests web-ifc@0.0.57');
    process.exit(3);
  }
  global.WebIFC = WebIFC; // loadWebIfc() picks this up — no DOM needed
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  IFCTakeoff.parseIFC(ab, {}).then(res => {
    console.log(JSON.stringify({ summary: res.summary, rowCount: res.rows.length }));
    process.exit(0);
  }).catch(err => {
    console.error('PARSE_FAILED: ' + (err && err.message || err));
    process.exit(1);
  });
} else if (mode !== 'cube') {
  console.error('usage: ifc-harness.js cube | parse <file.ifc>');
  process.exit(2);
}
