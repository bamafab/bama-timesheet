// ============================================================
// F7a — BALUSTRADE GEOMETRY + WEIGHT ENGINE  (pure, deterministic)
// Sibling to computeStaircase / computeSpiralStaircase.
// No labour here (that's F7b computeBalustradeLabour). Produces a real
// weighed takeoff (the "guide") for Common/Feature/Manual.
// Density 7850. Reuses findSteelProfile + balPlateKg (== scPlateKg).
// ============================================================

const BAL_STEEL_DENSITY = 7850; // kg/m3
function balPlateKg(thkMM, wMM, dMM){ return (thkMM/1000)*(wMM/1000)*(dMM/1000)*BAL_STEEL_DENSITY; }
function balResolveKgm(typeStr, findSteelProfile){ const p = findSteelProfile(typeStr); return p && p.kgm ? p.kgm : 0; }

// Per-family geometry defaults. Sections are sensible UK-standard placeholders,
// editable per-quote. Material modifier handled in labour/material layer.
const BAL_FAMILIES = {
  welded_steel:    { label:'Welded steel balustrade', post:'SHS50X50X3',  topRail:'CHS48.3X3.2', botRail:'FLT50X10', defPostSpacingMM:900, defHeightMM:1100, infill:true  },
  kee_klamp:       { label:'Kee-Klamp / tube clamp',  post:'CHS42.4X3.2', topRail:'CHS42.4X3.2', botRail:'',         defPostSpacingMM:1500,defHeightMM:1100, infill:false, noWeld:true },
  frameless_glass: { label:'Frameless glass',         post:'',            topRail:'',            botRail:'',         defPostSpacingMM:0,   defHeightMM:1100, infill:'glass', channel:'FLT100X12' },
  glass_posted:    { label:'Glass between posts',     post:'SHS50X50X3',  topRail:'CHS48.3X3.2', botRail:'',         defPostSpacingMM:1200,defHeightMM:1100, infill:'glass' },
  mesh_infill:     { label:'Mesh infill',             post:'SHS50X50X3',  topRail:'CHS48.3X3.2', botRail:'FLT50X10', defPostSpacingMM:1200,defHeightMM:1100, infill:'mesh' },
  handrail_only:   { label:'Handrail only / single rail', post:'CHS42.4X3.2', topRail:'CHS42.4X3.2', botRail:'',     defPostSpacingMM:1500,defHeightMM:1000, infill:false },
  free_standing:   { label:'Free-standing / self-weighted', post:'SHS60X60X4', topRail:'CHS48.3X3.2', botRail:'FLT50X10', defPostSpacingMM:1000,defHeightMM:1100, infill:true, basePlate:'PLT250X250X12' },
};

// Infill weight models (per metre of run, full panel height). Bars run vertical
// at a spacing; mesh/glass are area. All editable; placeholders.
const BAL_INFILL = {
  square_bar: { label:'Square bar', kind:'bars', section:'FLT16X16', defSpacingMM:100 },
  round_bar:  { label:'Round bar',  kind:'bars', section:'CHS16X2',  defSpacingMM:100 },
  flat_bar:   { label:'Flat bar',   kind:'bars', section:'FLT40X8',  defSpacingMM:120 },
  plate:      { label:'Plate / solid', kind:'sheet', plateMM:3 },
  mesh:       { label:'Mesh / perforated', kind:'sheet', kgm2:12 },
  glass:      { label:'Glass (toughened)', kind:'none' }, // glass not weighed as steel
  none:       { label:'None', kind:'none' },
};

function balRound1(n){ return Math.round(n*10)/10; }

// input: {
//   mode:'common'|'feature'|'manual', family, runLengthMM, heightMM,
//   postSpacingMM, postType, topRailType, botRailType, infillType,
//   infillSpacingMM, infillSection, baseFix:'baseplate'|'sidefix'|'coredrill'|'castin',
//   raked:false, manualRows:[ {role,type,length,qty,_unit} ]  // manual mode only
// }
function computeBalustrade(input, deps){
  const findSteelProfile = deps.findSteelProfile;
  const warnings = [];
  const fam = BAL_FAMILIES[input.family] || BAL_FAMILIES.welded_steel;
  const mode = input.mode || 'common';
  const components = [];
  const _canon = (t)=>{ const p=findSteelProfile(t); return (p && p.confidence!=='none' && p.canonical)?p.canonical:t; };

  // ── MANUAL: user supplies rows; we just weigh them ──
  if (mode === 'manual'){
    (input.manualRows||[]).forEach(r=>{
      const unit = r._unit||'';
      let kgm = 0;
      if (unit === 'EA'){ kgm = Number(r.kgm)||0; }
      else { kgm = balResolveKgm(r.type, findSteelProfile); if(!kgm && r.kgm) kgm=Number(r.kgm); }
      components.push({ type:_canon(r.type), length:Number(r.length)||1000, qty:Number(r.qty)||1,
        kgm, role:r.role||'manual', note:r.note||'', _unit:unit });
    });
    return { ok:true, geometry:{ mode, family:input.family, runLengthMM:Number(input.runLengthMM)||0, manual:true }, components, warnings };
  }

  // ── COMMON / FEATURE: build geometry from run length + height ──
  const runMM = Number(input.runLengthMM)||0;
  if (runMM<=0) return { ok:false, warnings:['Run length (mm) is required.'], geometry:{}, components:[] };
  const runM = runMM/1000;
  // RAKED / STAIR balustrade: simple flag (no segment model in v1). On the
  // pitch, Part K guard is 900mm vertical; landings stay 1100mm. We default the
  // height to 900 when raked and remind about landings. runLengthMM is taken as
  // the SLOPED length already (auto-pull from staircase supplies sloped length).
  const raked = !!input.raked;
  let heightMM = Number(input.heightMM)>0 ? Number(input.heightMM) : (raked ? 900 : fam.defHeightMM);
  if (raked) warnings.push(`Raked stair balustrade: 900mm on the pitch — landing/level sections must be 1100mm. Run length is taken as the sloped length.`);
  const guardMin = raked ? 900 : 1000;
  if (heightMM < guardMin) warnings.push(`Height ${heightMM}mm is below the Part K guard minimum (${raked?'900mm on pitch':'1100mm level / 900mm domestic'}) — confirm.`);

  const spacingMM = Number(input.postSpacingMM)>0 ? Number(input.postSpacingMM) : fam.defPostSpacingMM;
  // posts: frameless glass has none; others = ceil(run/spacing)+1 (end posts)
  let nPosts = 0;
  if (spacingMM>0){
    if (spacingMM>1500) warnings.push(`Post spacing ${spacingMM}mm exceeds 1500mm — verify structural adequacy of the top rail span.`);
    nPosts = Math.ceil(runMM/spacingMM) + 1;
  }

  // ── posts ──
  const postType = input.postType || fam.post;
  if (nPosts>0 && postType){
    const postKgm = balResolveKgm(postType, findSteelProfile);
    if (!postKgm) warnings.push(`Post section "${postType}" not found in steel DB — weight will read as missing.`);
    components.push({ type:_canon(postType), length:heightMM, qty:nPosts, kgm:postKgm,
      role:'post', note:`${nPosts} posts @ ${spacingMM}mm c/c`, _unit:'' });
  }

  // ── top rail (full run) ──
  const topType = input.topRailType || fam.topRail;
  if (topType){
    const topKgm = balResolveKgm(topType, findSteelProfile);
    if (!topKgm) warnings.push(`Top rail section "${topType}" not found in steel DB.`);
    components.push({ type:_canon(topType), length:runMM, qty:1, kgm:topKgm,
      role:'toprail', note:`Top/hand rail, ${runM.toFixed(2)}m run`, _unit:'' });
  }

  // ── bottom rail (full run, if family has one) ──
  const botType = input.botRailType!=null ? input.botRailType : fam.botRail;
  if (botType){
    const botKgm = balResolveKgm(botType, findSteelProfile);
    components.push({ type:_canon(botType), length:runMM, qty:1, kgm:botKgm,
      role:'botrail', note:`Bottom rail, ${runM.toFixed(2)}m run`, _unit:'' });
  }

  // ── glass channel (frameless) ──
  if (fam.channel){
    const chKgm = balResolveKgm(fam.channel, findSteelProfile);
    components.push({ type:_canon(fam.channel), length:runMM, qty:1, kgm:chKgm,
      role:'channel', note:`Glass base channel, ${runM.toFixed(2)}m run`, _unit:'' });
  }

  // ── base plates (free-standing / top-fix) ──
  if (input.baseFix === 'baseplate' || fam.basePlate){
    if (nPosts>0){
      // baseplate dims from preset string PLTwwwXdddXttt, else default 200x200x10
      let bw=200,bd=200,bt=10;
      const bp = (fam.basePlate||'PLT200X200X10').replace(/[^0-9X]/g,'').split('X');
      if (bp.length===3){ bw=+bp[0]; bd=+bp[1]; bt=+bp[2]; }
      const plKg = balPlateKg(bt, bw, bd);
      components.push({ type:`PLT${bw}x${bd}x${bt}`, length:1000, qty:nPosts, kgm:plKg,
        role:'baseplate', note:`${nPosts} base plates ${bw}x${bd}x${bt}`, _unit:'EA' });
    }
  }

  // ── infill ──
  const infillKey = input.infillType || (typeof fam.infill==='string'? fam.infill : (fam.infill? 'square_bar':'none'));
  const inf = BAL_INFILL[infillKey] || BAL_INFILL.none;
  if (inf.kind === 'bars'){
    const sp = Number(input.infillSpacingMM)>0 ? Number(input.infillSpacingMM) : inf.defSpacingMM;
    if (sp>100) warnings.push(`Infill bar gap ${sp}mm may exceed the 100mm sphere rule (Part K) — confirm clear gap.`);
    const sect = input.infillSection || inf.section;
    const barKgm = balResolveKgm(sect, findSteelProfile);
    const nBars = Math.max(0, Math.floor(runMM/sp));
    // each vertical bar spans (height - rails allowance ~ height-100)
    const barLen = Math.max(0, heightMM-100);
    components.push({ type:_canon(sect), length:barLen, qty:nBars, kgm:barKgm,
      role:'infill', note:`${nBars} ${inf.label.toLowerCase()} @ ${sp}mm`, _unit:'' });
  } else if (inf.kind === 'sheet'){
    const areaM2 = runM * ((heightMM-100)/1000);
    let panelKg;
    if (inf.plateMM){ panelKg = balPlateKg(inf.plateMM, 1000, 1000)*areaM2; }
    else { panelKg = (inf.kgm2||12)*areaM2; }
    components.push({ type:`${inf.label} infill`, length:1000, qty:1, kgm:panelKg,
      role:'infill', note:`${inf.label} infill ${areaM2.toFixed(2)}m²`, _unit:'EA' });
  } // 'none'/glass → no steel infill row (glass handled in material/labour layer)

  const totalKg = components.reduce((s,c)=>{
    const len = c._unit==='EA' ? 1 : (c.length/1000);
    return s + (c.kgm||0)*len*(c.qty||1);
  },0);

  return {
    ok:true,
    geometry:{ mode, family:input.family, familyLabel:fam.label, runLengthMM:runMM, runM:balRound1(runM),
      heightMM, postSpacingMM:spacingMM, nPosts, infill:infillKey, raked, totalKg:balRound1(totalKg) },
    components, warnings
  };
}

if (typeof module!=='undefined') module.exports = { computeBalustrade, BAL_FAMILIES, BAL_INFILL, balPlateKg };
