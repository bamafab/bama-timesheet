"""
test_takeoff.py — pytest gates for the IFC/STEP takeoff engines.

Run:  python3 -m pytest tests/test_takeoff.py -v

Fixtures live in tests/fixtures/ (real customer geometry — NOT committed to
the repo; drop them in locally before running):
  * P2073-EES-PH1-L5-MS-07-C01.STEP  -> 878 kg ±2%  (68 shells, 67 closed)
  * P2073-EES-PH1-L5-MS-07-C01.IFC   -> 791 kg ±10% + LOW CONFIDENCE
                                        (47 components, 22 open)
Fixture tests SKIP (loudly) when the file is missing, so CI without the
customer geometry still runs the synthetic regression.

The synthetic test needs only node (no web-ifc): it hits the shipping
ifc-takeoff.js meshComponents with a flipped-winding, duplicated-vertex cube —
the exact signature of the abs-per-triangle production bug (13.5 t reported
vs 0.79 t real on a CATIA surface export).
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FIXTURES = os.path.join(HERE, "fixtures")
STEP_FIXTURE = os.path.join(FIXTURES, "P2073-EES-PH1-L5-MS-07-C01.STEP")
IFC_FIXTURE = os.path.join(FIXTURES, "P2073-EES-PH1-L5-MS-07-C01.IFC")
HARNESS = os.path.join(HERE, "ifc-harness.js")

sys.path.insert(0, os.path.join(REPO, "takeoff"))


def _have_ocp():
    try:
        import OCP  # noqa: F401
        return True
    except ImportError:
        return False


def _node():
    return shutil.which("node")


def _run_harness(*args):
    """Run the node harness; returns parsed JSON or skips the test with the
    harness's own reason (node missing / web-ifc missing)."""
    node = _node()
    if not node:
        pytest.skip("node is not installed on this host")
    proc = subprocess.run(
        [node, HARNESS, *args],
        capture_output=True, text=True, cwd=REPO, timeout=600,
    )
    if proc.returncode == 3:
        pytest.skip("web-ifc not installed: npm i --prefix tests web-ifc@0.0.57")
    assert proc.returncode == 0, f"harness failed: {proc.stderr.strip()}"
    return json.loads(proc.stdout)


# ── STEP backend (OCP / OpenCascade) ─────────────────────────────────────────

@pytest.mark.skipif(not os.path.isfile(STEP_FIXTURE),
                    reason="STEP fixture not present in tests/fixtures/")
@pytest.mark.skipif(not _have_ocp(),
                    reason="cadquery-ocp not installed (pip install cadquery-ocp)")
def test_step_fixture_p2073():
    from step_takeoff import parse_step
    res = parse_step(STEP_FIXTURE)
    s = res["summary"]
    q = s["geometryQuality"]

    # 878 kg ±2%
    assert abs(s["totalKg"] - 878) <= 878 * 0.02, f"totalKg={s['totalKg']}"

    # 68 shells, 67 closed
    assert q["shellsClosed"] + q["shellsOpen"] == 68, q
    assert q["shellsClosed"] == 67, q

    # 1 open shell out of 68 must not trip the >20%-volume flag on this file
    assert q["lowConfidence"] is False, q
    assert res["rows"], "no rows produced"
    for r in res["rows"]:
        assert r["_unit"] == "EA" and r["kgm"] > 0


# ── IFC engine (shipping ifc-takeoff.js via node harness) ────────────────────

@pytest.mark.skipif(not os.path.isfile(IFC_FIXTURE),
                    reason="IFC fixture not present in tests/fixtures/")
def test_ifc_fixture_p2073():
    out = _run_harness("parse", IFC_FIXTURE)
    s = out["summary"]
    q = s["geometryQuality"]
    assert s["mode"] == "parts", s

    # Re-baselined 2026-08-28 against the measured file (original spec guess
    # was 791 kg / 47 comps / 22 open — pre winding-repair). The fixed engine
    # lands 880.1 kg, 0.23% off the STEP BRep reference (878.1 kg), so the
    # IFC gate is now the SAME ±2% band around the STEP truth.
    assert abs(s["totalKg"] - 878) <= 878 * 0.02, f"totalKg={s['totalKg']}"

    # 71 mesh components, 54 of them open (79.7% of volume — this is a
    # surface export) -> LOW CONFIDENCE must be flagged
    assert q["shellsClosed"] + q["shellsOpen"] == 71, q
    assert q["shellsOpen"] == 54, q
    assert q["lowConfidence"] is True, q


# ── Synthetic regression: abs-per-triangle bug signature ─────────────────────

def test_synthetic_flipped_cube_volume():
    """A unit cube built as a duplicated-vertex triangle soup with half the
    windings flipped. The broken engine (abs per tetra contribution) reports
    roughly DOUBLE the true volume for a corner-origin cube; the fixed engine
    must stitch, repair winding, and report exactly the cube's volume — and
    never more."""
    out = _run_harness("cube")
    comps = out["components"]
    assert len(comps) == 1, f"cube split into {len(comps)} components"
    c = comps[0]
    assert c["open"] is False, "cube must be detected as a closed shell"
    assert c["tris"] == 12
    # Exactly the cube's volume...
    assert abs(c["vol"] - 1.0) < 1e-9, f"vol={c['vol']}"
    # ...and in particular NOT MORE (the bug signature was inflation)
    assert c["vol"] <= 1.0 + 1e-9
