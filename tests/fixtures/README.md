# Takeoff test fixtures

Real customer geometry — **not committed to the repo**. Drop the files here
locally to run the full pytest suite (`python3 -m pytest tests/test_takeoff.py`):

* `P2073-EES-PH1-L5-MS-07-C01.STEP` — expected 878 kg ±2% (68 shells, 67 closed)
* `P2073-EES-PH1-L5-MS-07-C01.IFC`  — expected 878 kg ±2% (measured 880.1 —
  0.23% off the STEP BRep reference), LOW CONFIDENCE (71 components,
  54 open, 79.7% open volume)

The IFC fixture test also needs web-ifc for the node harness:
`npm i --prefix tests web-ifc@0.0.57`

Without the fixtures, the synthetic flipped-cube regression still runs.
