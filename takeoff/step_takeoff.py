#!/usr/bin/env python3
"""
step_takeoff.py — STEP (.step/.stp) → steel takeoff engine for Quote Builder.

Companion to ifc-takeoff.js: same output shape ({rows, summary}) so QB's
IFC/STEP import modal consumes either without caring which engine produced it.

TWO-ENGINE PRINCIPLE: this reads exact geometry out of the file via
OpenCascade. It does NOT invent, estimate, or price anything. Mass is
|volume| x 7850 kg/m^3 (structural steel), volume comes from BRep exact
geometry (BRepGProp), never from a mesh approximation.

Engine rules (spec, 2026-08-28):
  * OpenCascade via the `cadquery-ocp` package (import OCP) — LAZY import so
    merely importing this module never pulls the ~700MB binding in.
  * STEPControl_Reader -> TransferRoots -> OneShape.
  * Iterate TopAbs_SOLID; if the file has no solids, iterate TopAbs_SHELL
    (surface exports from SolidWorks/CATIA are the norm, not the exception).
  * Volume: GProp_GProps + BRepGProp.VolumeProperties_s per solid/shell.
    Face contributions are summed SIGNED by OCCT internally; abs() is applied
    at the shell/solid level only — NEVER per face/triangle.
  * Units come from the file. Interface_Static "xstep.cascade.unit" is pinned
    to MM before reading, so OCCT converts whatever the file declares
    (M, INCH, ...) into millimetres — we never assume the file is in mm.
  * Geometry quality: closed vs open shells is tracked per part. If more than
    20% of the total volume comes from OPEN shells, the whole result is
    flagged LOW CONFIDENCE (open-shell volume is a best effort, not a
    watertight measurement).

Output row shape (identical to ifc-takeoff.js parts mode):
  { type, length: 1000, qty, kgm: <kg each>, rate: null, _unit: 'EA',
    _notes, _ifcClass: 'PART', _confidence: 'exact'|'low', _rawSection }

CLI:
  python3 takeoff/step_takeoff.py path/to/file.step [--pretty]
prints the {rows, summary} JSON to stdout.
"""

import json
import math
import os
import sys

STEEL_KG_PER_MM3 = 7.85e-6  # 7850 kg/m^3 in kg/mm^3
OPEN_VOL_LOW_CONFIDENCE = 0.20  # >20% of volume from open shells -> flag


# ── OCP (lazy) ───────────────────────────────────────────────────────────────

def _ocp():
    """Lazy import of the OpenCascade binding. Raises a clear error if the
    cadquery-ocp package is not installed on this host."""
    try:
        from OCP.STEPControl import STEPControl_Reader
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.Interface import Interface_Static
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL
        from OCP.TopoDS import TopoDS
        from OCP.GProp import GProp_GProps
        from OCP.BRepGProp import BRepGProp
        from OCP.Bnd import Bnd_Box
        from OCP.BRepBndLib import BRepBndLib
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "OpenCascade binding not available - install with: "
            "pip install cadquery-ocp"
        ) from e
    return dict(
        STEPControl_Reader=STEPControl_Reader,
        IFSelect_RetDone=IFSelect_RetDone,
        Interface_Static=Interface_Static,
        TopExp_Explorer=TopExp_Explorer,
        TopAbs_SOLID=TopAbs_SOLID,
        TopAbs_SHELL=TopAbs_SHELL,
        TopoDS=TopoDS,
        GProp_GProps=GProp_GProps,
        BRepGProp=BRepGProp,
        Bnd_Box=Bnd_Box,
        BRepBndLib=BRepBndLib,
    )


# ── Geometry helpers ─────────────────────────────────────────────────────────

def _signed_volume_mm3(shape, O):
    """|signed volume| of one solid/shell, in mm^3. OCCT's VolumeProperties
    sums signed face contributions internally (divergence theorem); a reversed
    orientation simply lands negative — abs() here, at the shape level."""
    props = O["GProp_GProps"]()
    O["BRepGProp"].VolumeProperties_s(shape, props)
    return abs(props.Mass())  # geometry already in mm after unit pinning


def _bbox_dims_mm(shape, O):
    """Axis-aligned bounding box extents [L, W, T] descending, in mm."""
    box = O["Bnd_Box"]()
    O["BRepBndLib"].Add_s(shape, box)
    if box.IsVoid():
        return [0.0, 0.0, 0.0]
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    return sorted([xmax - xmin, ymax - ymin, zmax - zmin], reverse=True)


def _shape_is_closed(shape, kind, O):
    """A TopAbs_SOLID counts as closed when every shell it owns is closed;
    a bare TopAbs_SHELL reports its own Closed() flag (the STEP reader sets it
    from CLOSED_SHELL vs OPEN_SHELL entities)."""
    if kind == "shell":
        return bool(shape.Closed())
    exp = O["TopExp_Explorer"](shape, O["TopAbs_SHELL"])
    any_shell = False
    while exp.More():
        any_shell = True
        if not O["TopoDS"].Shell_s(exp.Current()).Closed():
            return False
        exp.Next()
    return any_shell  # a solid with no shells is not a measurable body


def _label_part(vol_mm3, dims):
    """Human label from measured geometry — mirrors ifc-takeoff.js labelPart
    so mixed IFC/STEP takeoffs read consistently in QB:
      * bbox >=90% full -> rectangular plate/flat -> "PLT T x W x L"
      * two near-equal minor axes matching a cylinder -> "Bar ØD x L"
      * anything else -> "Solid part L x W x T"
    """
    r1 = lambda v: round(v * 10) / 10
    L, W, T = (r1(d) for d in dims)
    bbox_vol = dims[0] * dims[1] * dims[2]
    if bbox_vol > 0 and vol_mm3 / bbox_vol >= 0.9:
        return f"PLT {T} x {W} x {L}"
    if dims[2] > 0 and dims[1] / dims[2] <= 1.05:
        D = (dims[1] + dims[2]) / 2
        cyl = math.pi * (D / 2) ** 2 * dims[0]
        if cyl > 0 and 0.9 <= vol_mm3 / cyl <= 1.1:
            return f"Bar \u00d8{r1(D)} x {L}"
    return f"Solid part {L} x {W} x {T}"


# ── Public engine ────────────────────────────────────────────────────────────

def parse_step(path):
    """Parse a .step/.stp file → {rows, summary} matching ifc-takeoff.js
    parts mode. Raises RuntimeError on unreadable files."""
    O = _ocp()

    # Pin the working unit to MM BEFORE reading: the reader then converts the
    # file's own declared unit (whatever it is) into millimetres.
    O["Interface_Static"].SetCVal_s("xstep.cascade.unit", "MM")

    reader = O["STEPControl_Reader"]()
    status = reader.ReadFile(path)
    if status != O["IFSelect_RetDone"]:
        raise RuntimeError(f"STEP reader could not read {os.path.basename(path)} (status {int(status)})")
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise RuntimeError("STEP transfer produced no geometry")

    # Solids first; a file with no solids is a surface export — walk shells.
    shapes = []
    exp = O["TopExp_Explorer"](shape, O["TopAbs_SOLID"])
    while exp.More():
        shapes.append(("solid", O["TopoDS"].Solid_s(exp.Current())))
        exp.Next()
    if not shapes:
        exp = O["TopExp_Explorer"](shape, O["TopAbs_SHELL"])
        while exp.More():
            shapes.append(("shell", O["TopoDS"].Shell_s(exp.Current())))
            exp.Next()
    if not shapes:
        raise RuntimeError("No solids or shells in this STEP file")

    el_name = os.path.splitext(os.path.basename(path))[0]

    grouped = {}
    parts_count = 0
    total_kg = 0.0
    shells_closed = 0
    shells_open = 0
    open_kg = 0.0

    for kind, sh in shapes:
        vol_mm3 = _signed_volume_mm3(sh, O)
        kg = vol_mm3 * STEEL_KG_PER_MM3
        if not (kg > 0 and math.isfinite(kg)):
            continue
        if kg < 0.01:  # mesh/model slivers under 10 g — artefacts, not steel
            continue
        closed = _shape_is_closed(sh, kind, O)
        parts_count += 1
        total_kg += kg
        if closed:
            shells_closed += 1
        else:
            shells_open += 1
            open_kg += kg

        dims = _bbox_dims_mm(sh, O)
        kg_each = round(kg * 100) / 100
        dim_key = "x".join(str(round(d * 2) / 2) for d in dims)
        key = f"{el_name}|{dim_key}|{kg_each}"
        if key in grouped:
            grouped[key]["qty"] += 1
            continue
        label = _label_part(vol_mm3, dims)
        grouped[key] = {
            "type": label,
            "length": 1000,          # EA convention: weight = (length/1000)*kgm*qty
            "qty": 1,
            "kgm": kg_each,          # kg per piece — measured, not estimated
            "rate": None,            # QB sets the material rate on import
            "_unit": "EA",
            "_notes": el_name,
            "_ifcClass": "PART",
            "_confidence": "exact" if closed else "low",
            "_rawSection": label,
        }

    rows = list(grouped.values())
    open_pct = (open_kg / total_kg) if total_kg > 0 else 0.0
    low_confidence = total_kg > 0 and open_pct > OPEN_VOL_LOW_CONFIDENCE

    return {
        "rows": rows,
        "summary": {
            "total": parts_count,
            "beams": 0,
            "columns": 0,
            "members": 0,
            "missingLength": 0,
            "unmatchedSection": 0,
            "mode": "parts",
            "parts": parts_count,
            "uniqueParts": len(rows),
            "totalKg": round(total_kg * 10) / 10,
            "geometryQuality": {
                "shellsClosed": shells_closed,
                "shellsOpen": shells_open,
                "openVolumePct": round(open_pct * 1000) / 10,
                "lowConfidence": low_confidence,
            },
            "levels": [el_name] if rows else [],
        },
    }


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    pretty = "--pretty" in argv
    if len(args) != 1:
        print("usage: step_takeoff.py <file.step|file.stp> [--pretty]", file=sys.stderr)
        return 2
    path = args[0]
    if not os.path.isfile(path):
        print(f"no such file: {path}", file=sys.stderr)
        return 2
    if not path.lower().endswith((".step", ".stp")):
        print("not a .step/.stp file", file=sys.stderr)
        return 2
    result = parse_step(path)
    print(json.dumps(result, indent=2 if pretty else None))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
