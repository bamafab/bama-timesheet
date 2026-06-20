// ============================================================
// F7b — BALUSTRADE LABOUR ENGINE  (deterministic, no AI)
// Sibling to computeStaircaseLabour / computeSpiralLabour.
//
// MODEL — fixed setup + banded marginal £/m (reproduces 1m≈£1,350 → 10m≈£320):
//   For COMMON: labour = fixedSetup + marginalRate(band) × metres,
//     split into FAB / DESIGN / INSTALL. Band edges: 0–1 / 1–5 / 5–20 / 20m+.
//     Marginal rate STEPS DOWN per band (longer run = cheaper per-metre).
//     fixedSetup amortises design base + mobilisation/min-install.
//   For FEATURE: same shell, marginal rate × complexity multiplier (cx),
//     design softened (designCxFactor), like spiral.
//   For MANUAL: hours entered directly (fab/design hrs × rates) + install days.
//
// STAIR UPLIFT (raked): × bal_stair_uplift (default 1.1) on the marginal rate;
//   the envelope min/max scale by the same factor so the guardrail tracks.
//
// RATE-LOCK + ENVELOPE: each family carries {envMin, envMax, locked}. After the
//   effective £/m is computed, if outside envelope → envelopeFlag. When locked,
//   flag is "hard" (red + persisted calc-note); when unlocked it's "soft"
//   (provisional, informational only) so early jobs build the pattern.
//
// All numbers are PLACEHOLDERS — calibrate live (like F6).
// ============================================================

// Placeholder band table per family. Each band: marginal £/m for FAB/DESIGN/INSTALL.
// fixedSetup is the one-off (design base + mobilisation) added regardless of length.
// Tuned so welded_steel lands ~£305–325/m at typical (5–20m) size, and
// handrail_only gives 1m≈£1,200–1,500 / 10m≈£3,200.
const BAL_LABOUR = {
  welded_steel:    { fixedSetup:850, bands:{ '0-1':{fab:140,design:90,install:160}, '1-5':{fab:120,design:55,install:140}, '5-20':{fab:105,design:38,install:120}, '20+':{fab:95,design:30,install:110} }, envMin:305, envMax:325, locked:false },
  kee_klamp:       { fixedSetup:550, bands:{ '0-1':{fab:70,design:50,install:130}, '1-5':{fab:60,design:30,install:110}, '5-20':{fab:50,design:20,install:95}, '20+':{fab:45,design:16,install:88} }, envMin:170, envMax:210, locked:false },
  frameless_glass: { fixedSetup:1100,bands:{ '0-1':{fab:120,design:140,install:200}, '1-5':{fab:100,design:90,install:170}, '5-20':{fab:90,design:60,install:150}, '20+':{fab:80,design:48,install:135} }, envMin:420, envMax:520, locked:false },
  glass_posted:    { fixedSetup:950, bands:{ '0-1':{fab:130,design:110,install:180}, '1-5':{fab:110,design:70,install:155}, '5-20':{fab:98,design:48,install:135}, '20+':{fab:88,design:38,install:122} }, envMin:360, envMax:440, locked:false },
  mesh_infill:     { fixedSetup:800, bands:{ '0-1':{fab:120,design:85,install:155}, '1-5':{fab:100,design:52,install:135}, '5-20':{fab:88,design:36,install:118}, '20+':{fab:80,design:28,install:108} }, envMin:290, envMax:340, locked:false },
  handrail_only:   { fixedSetup:700, bands:{ '0-1':{fab:120,design:70,install:380}, '1-5':{fab:90,design:40,install:200}, '5-20':{fab:70,design:26,install:150}, '20+':{fab:60,design:20,install:130} }, envMin:280, envMax:360, locked:false },
  free_standing:   { fixedSetup:900, bands:{ '0-1':{fab:150,design:95,install:140}, '1-5':{fab:128,design:58,install:120}, '5-20':{fab:112,design:40,install:104}, '20+':{fab:100,design:32,install:95} }, envMin:320, envMax:380, locked:false },
};

function balBandFor(metres){
  if (metres <= 1) return '0-1';
  if (metres <= 5) return '1-5';
  if (metres <= 20) return '5-20';
  return '20+';
}

// geometry from computeBalustrade; lab = per-quote overrides; ratesBal = rates.balustrade
// Signature mirrors the staircase siblings minus components (labour is run-length driven).
function computeBalustradeLabour(geometry, lab, ratesBal){
  lab = lab || {};
  const RB = ratesBal || {};
  const num = (v,d)=> (v!=null && v!=='' && !isNaN(Number(v))) ? Number(v) : d;
  const famKey = geometry.family || 'welded_steel';
  // family labour preset: per-quote override (lab.familyLabour) → rates.balustrade → hard default
  const preset = (lab.familyLabour) || (RB[famKey]) || BAL_LABOUR[famKey] || BAL_LABOUR.welded_steel;
  const mode = geometry.mode || 'common';
  const metres = Math.max(0, Number(geometry.runM) || (Number(geometry.runLengthMM)||0)/1000);

  const fabRate    = num(lab.fabRate,    num(RB.fab_rate && RB.fab_rate.rate, 45));
  const designRate = num(lab.designRate, num(RB.design_rate && RB.design_rate.rate, 50));
  const stairUplift = geometry.raked ? num(lab.stairUplift, num(RB.bal_stair_uplift && RB.bal_stair_uplift.rate, 1.1)) : 1.0;

  let fabCost=0, designCost=0, installCost=0, breakdown={};

  if (mode === 'manual'){
    // hours entered directly; install via crew × days × day-rate (+extras optional)
    const fabHrs    = num(lab.manualFabHrs, 0);
    const designHrs = num(lab.manualDesignHrs, 0);
    const dayRate   = num(lab.installDayRate, 280);
    const crew      = Math.max(1, Math.round(num(lab.installCrew, 2)));
    const days      = num(lab.installDays, 0);
    fabCost = fabHrs * fabRate;
    designCost = designHrs * designRate;
    installCost = crew * days * dayRate;
    breakdown = { mode, fabHrs, designHrs, crew, days, dayRate };
  } else {
    // COMMON / FEATURE — fixed setup + banded marginal £/m
    const band = balBandFor(metres);
    const b = preset.bands[band] || preset.bands['5-20'];
    const fixedSetup = num(lab.fixedSetup, preset.fixedSetup||0);

    // complexity (feature) — multiplies marginal FAB/INSTALL fully, DESIGN softened
    const cxLevel = mode==='feature'
      ? ((lab.complexity==='complex'||lab.complexity==='moderate') ? lab.complexity : 'moderate')
      : 'simple';
    const cxMult = cxLevel==='complex'  ? num(lab.cxComplex,  num(RB.bal_cx_complex && RB.bal_cx_complex.rate, 1.8))
                 : cxLevel==='moderate' ? num(lab.cxModerate, num(RB.bal_cx_moderate && RB.bal_cx_moderate.rate, 1.35))
                 : 1.0;
    const designCxFactor = num(lab.designCxFactor, num(RB.bal_design_cx_factor && RB.bal_design_cx_factor.rate, 0.4));
    const designMult = 1 + (cxMult-1)*designCxFactor;

    // marginal £/m × metres × complexity, + fixed setup (setup split across the 3)
    const mFab     = b.fab     * metres * cxMult;
    const mInstall = b.install * metres * cxMult;
    const mDesign  = b.design  * metres * designMult;
    // fixed setup attributed: 35% fab, 45% design, 20% install (design-heavy one-off)
    // stair uplift (×1.1) applies to the WHOLE labour so effective £/m tracks the
    // envelope scaling cleanly (envelope min/max are scaled by the same factor).
    fabCost     = (mFab     + fixedSetup*0.35) * stairUplift;
    designCost  = (mDesign  + fixedSetup*0.45) * stairUplift;
    installCost = (mInstall + fixedSetup*0.20) * stairUplift;
    breakdown = { mode, band, metres:Math.round(metres*100)/100, marginal:b, fixedSetup, cxLevel, cxMult, designMult, stairUplift };
  }

  const total = fabCost + designCost + installCost;
  const effRatePerM = metres>0 ? total/metres : total;

  // ── envelope / rate-lock (common only; feature/manual bypass) ──
  let envelopeFlag = null;
  if (mode === 'common' && metres>0){
    const envMin = num(lab.envMin, preset.envMin||0) * stairUplift;
    const envMax = num(lab.envMax, preset.envMax||0) * stairUplift;
    const locked = (lab.locked!=null) ? !!lab.locked : !!preset.locked;
    if (envMax>0 && (effRatePerM < envMin || effRatePerM > envMax)){
      envelopeFlag = {
        hard: locked,                       // locked → red + persisted note; unlocked → soft/provisional
        effRatePerM: Math.round(effRatePerM),
        envMin: Math.round(envMin), envMax: Math.round(envMax),
        raked: !!geometry.raked,
        message: `${metres.toFixed(1)}m ${geometry.familyLabel||famKey}` +
                 ` @ £${Math.round(effRatePerM)}/m — BAMA ${locked?'locked':'provisional'} band` +
                 ` £${Math.round(envMin)}–${Math.round(envMax)}/m${geometry.raked?' (stair ×uplift)':''}.` +
                 (locked ? ' Override allowed.' : ' Not yet locked — guide only.')
      };
    }
  }

  return {
    fab: Math.round(fabCost), design: Math.round(designCost), install: Math.round(installCost),
    total: Math.round(total), effRatePerM: Math.round(effRatePerM*100)/100,
    breakdown, envelopeFlag
  };
}

if (typeof module!=='undefined') module.exports = { computeBalustradeLabour, BAL_LABOUR, balBandFor };
