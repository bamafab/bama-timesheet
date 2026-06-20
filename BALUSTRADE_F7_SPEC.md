# Phase 7 — Balustrade / Handrail Engine — Design Spec

Status: **DRAFT for sign-off** · Scope: `quote-builder.html` only · Sibling to staircase (F1–F6)

---

## 1. Principle (unchanged from staircase)

Two-layer: a **pure JS deterministic engine** (geometry + weight + labour, BS-aware, density 7850)
and **no AI arithmetic**. All output rows inject into `q.takeoff` as editable rows carrying
`_excludeFromFabHours:true` + `_excludeFromFittingsBase:true`. Configuration stored in
`q.balustrades[]`. Per-area PDF/BOQ works automatically (ordinary takeoff rows).

Entry point: new **🛡 Balustrade** button in the Takeoff bar, next to 🪜 Staircase / 🌀 Spiral.
Own modal `#balustradeModal`, Basic/Advanced toggle.

---

## 2. Three modes

| Mode | Geometry/takeoff | Labour | Use |
|------|------------------|--------|-----|
| **Common** | auto-built, weighed (guide) | banded £/m (FAB/DESIGN/INSTALL) | standard runs, fast |
| **Feature** | auto-built, weighed | complexity multiplier (like spiral `cx`) | bespoke / unique |
| **Manual** | user builds rows | hours entered, or borrow a band | true anomalies (mixed runs) |

**Key rule (Common):** the weight takeoff is a *guide* showing what's included; the **band £/m is
authoritative** for the headline price. Feature/Manual price off the takeoff + their own labour.

---

## 3. The guided chain (Common & Feature)

Image/icon buttons, picked in this logical order (order tunable later):

1. **System family** → sets base preset
2. **Handrail type** → round tube / square / RHS / flat plate / timber-capped / Kee-Klamp
3. **Spigots?** (glass families) → yes/no
4. **Infill** → square bar / round bar / flat bar / plate / mesh / glass toughened / frameless / none
5. **Posts** → type + spacing (default per family)
6. **Material** → mild steel / stainless / aluminium (rate modifier)
7. **Finish** → galv / powder / paint / none (feeds existing paint layer)
8. **Mounting** → top-fix base plate / side-fix / core-drill / cast-in (labour modifier)

### System families (v1)
- `welded_steel`   — standard welded MS balustrade
- `kee_klamp`      — tube-clamp handrail/balustrade (no welding)
- `frameless_glass`— glass in channel/shoe, no posts
- `glass_posted`   — glass infill between posts (clamps or spigots)
- `mesh_infill`    — mesh/perforated infill panels
- `handrail_only`  — single rail / wall-mounted / single top rail
- `free_standing`  — self-supported / self-weighted (no fixing into structure)

Infill / handrail / material / mounting are **modifiers** on the family preset, not families.

---

## 4. Engine signatures

```
computeBalustrade(input) -> { ok, geometry, components[], warnings[] }
computeBalustradeLabour(geometry, components, lab, mode) -> { fab, design, install, total, breakdown, effRatePerM, envelopeFlag }
```

- `components[]`: same row shape as staircase — `{type,length,qty,kgm,role,note,_unit,_materialRate?,_fixedPrice?}`.
  Posts/rails per-length; base plates / glass panels EA; infill bars per-length × count.
- Weight from `findSteelProfile` (sections) + `scPlateKg` (plate/base plates). Reuse, don't reinvent.

### Labour — Common (banded)
Bands by run metres: **0–1 / 1–5 / 5–20 / 20m+**. Each band carries FAB/DESIGN/INSTALL £/m
(or hrs/m × rate). Plus a **fixed setup chunk** (design base + mobilisation/min-install) so short
runs land high per-metre. Reproduces the anchors:
- handrail-only 1m installed ≈ £1,200–1,500 ; 10m ≈ £3,200 (≈£320/m)
- common (square bar infill + round top rail) all-in ≈ £305–325/m at typical size

### Labour — Feature
Same fixed+marginal shell but band rate replaced by `bal_cx_*` multiplier (moderate/complex),
design softened (`bal_design_cx_factor`), mirroring spiral.

### Labour — Manual
FAB/DESIGN/INSTALL hours entered directly; optional "borrow band" prefill. No auto-guess.

---

## 5. Envelope guardrail (Common only)

Each family carries a £/m **envelope** `{min,max}` (e.g. welded_steel 305/325), editable in Adjust panel.
After labour resolves the **effective £/m**, if outside envelope:
1. **In-modal red flag** in `r.warnings[]` (red, like the staircase riser warning):
   *"15m common @ £360/m — BAMA standard 305–325/m. Override allowed."*
2. **Persisted calc-note** pushed to the existing `techRiskAlerts` list (`type:'warning'`,
   `rule:'bal-envelope'`) so it shows in calcs afterwards alongside cranage/galv-length notes.
Warn-but-allow. Never blocks. (Per decision: option 1 + colour + calc-note.)

---

## 6. Injection

Standalone area only (own area; no attach-to-stair in v1). Mirrors `injectSpiral`:
```
q.areas.push({id,name,collapsed:false})
q.balustrades.push({areaId, mode, family, input, geometry, labour, ts})
components -> q.takeoff rows (+ exclusion flags, _materialRate/_fixedPrice as needed)
saveAll(); renderTakeoff(); recalcAll(); close; toast
```

---

## 7. Rates — `DEFAULT_RATES.balustrade` (PLACEHOLDERS, calibrate live like F6)

Per-family band tables {fab,design,install £/m × 4 bands}, fixed setup, envelopes,
material modifiers (stainless/alu ×), mounting modifiers, cx multipliers, post-spacing defaults.
All editable per-quote in an Adjust panel. Standard rates fab £45/h, design £50/h, install crew×day.

---

## 8. Build order (one logical change per commit, Node test before UI)

- **F7a** geometry+weight engine `computeBalustrade` + Node unit test
- **F7b** banded/multiplier labour engine `computeBalustradeLabour` + Node test (anchor to 1m/10m)
- **F7c** modal UI: image-button chain, Basic/Advanced, Adjust panel
- **F7d** envelope guardrail (in-modal + techRiskAlerts note)
- **F7e** injection + per-area PDF/BOQ verification
- **F7f** SVG schematics — 2D elevation + plan AND isometric/3D, pure from geometry (no AI), like F6 spiral. Draws posts at spacing, top/bottom rails, infill bars/glass/mesh, base plates, raked sections on the slope. Mateusz wants this.
- preflight 0-errors before each push; git add/commit/pull --rebase/push

---

## OPEN before coding
- Real band numbers (calibrate live — placeholders for now): OK per decision.
- Confirm family list (7) is complete for v1.
- Confirm post-spacing defaults source (Part K 1.0m typical? Mateusz to confirm).
