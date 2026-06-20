const { computeBalustrade } = require('/tmp/bal_engine.js');

// Stub steel DB with real-ish kg/m for sections the engine references
const KGM = {
  'SHS50X50X3':4.35, 'SHS60X60X4':6.97, 'CHS48.3X3.2':3.56, 'CHS42.4X3.2':3.09,
  'FLT50X10':3.93, 'FLT16X16':2.01, 'CHS16X2':0.69, 'FLT40X8':2.51, 'FLT100X12':9.42,
};
const findSteelProfile = (raw)=>{
  if(!raw) return {canonical:'',kgm:null,confidence:'none'};
  const k = String(raw).toUpperCase().replace(/[×*\/]/g,'X').replace(/\s+/g,'');
  return { canonical:k, kgm: KGM[k]||null, confidence: KGM[k]?'high':'none' };
};
const deps = { findSteelProfile };
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('  ✗ '+m);} };

console.log('— COMMON welded steel, 5m run, 900 spacing, square bar —');
let r = computeBalustrade({mode:'common',family:'welded_steel',runLengthMM:5000,heightMM:1100,infillType:'square_bar'},deps);
ok(r.ok,'ok');
const posts = r.components.find(c=>c.role==='post');
ok(posts && posts.qty===Math.ceil(5000/900)+1,'post count = ceil(5000/900)+1 = '+(Math.ceil(5000/900)+1)+' got '+(posts&&posts.qty));
const top = r.components.find(c=>c.role==='toprail');
ok(top && top.length===5000 && top.qty===1,'top rail full 5m run');
const inf = r.components.find(c=>c.role==='infill');
ok(inf && inf.qty===Math.floor(5000/100),'infill bars = floor(5000/100)='+Math.floor(5000/100)+' got '+(inf&&inf.qty));
ok(r.geometry.totalKg>0,'totalKg>0 = '+r.geometry.totalKg);
console.log('  posts='+posts.qty+' toprail='+top.length+'mm infillBars='+inf.qty+' totalKg='+r.geometry.totalKg);

console.log('— FRAMELESS GLASS, 4m, no posts, glass infill —');
r = computeBalustrade({mode:'common',family:'frameless_glass',runLengthMM:4000},deps);
ok(r.ok,'ok');
ok(!r.components.find(c=>c.role==='post'),'no posts for frameless');
ok(r.components.find(c=>c.role==='channel'),'has glass channel');
ok(!r.components.find(c=>c.role==='infill'),'no steel infill row (glass)');
console.log('  rows: '+r.components.map(c=>c.role).join(', '));

console.log('— KEE-KLAMP, 6m, 1500 spacing —');
r = computeBalustrade({mode:'common',family:'kee_klamp',runLengthMM:6000},deps);
ok(r.ok,'ok');
const kp = r.components.find(c=>c.role==='post');
ok(kp && kp.qty===Math.ceil(6000/1500)+1,'kee posts='+(Math.ceil(6000/1500)+1)+' got '+(kp&&kp.qty));

console.log('— FREE-STANDING, base plates —');
r = computeBalustrade({mode:'common',family:'free_standing',runLengthMM:3000,baseFix:'baseplate'},deps);
const bp = r.components.find(c=>c.role==='baseplate');
ok(bp && bp._unit==='EA','baseplate EA row present, kg='+(bp&&bp.kgm.toFixed(2)));

console.log('— MANUAL mode weighs supplied rows —');
r = computeBalustrade({mode:'manual',runLengthMM:2000,manualRows:[
  {role:'post',type:'SHS50X50X3',length:1100,qty:4},
  {role:'custom',type:'Bracket',length:1000,qty:2,_unit:'EA',kgm:1.5},
]},deps);
ok(r.ok && r.components.length===2,'2 manual rows');
ok(r.components[0].kgm===4.35,'manual post resolved kgm=4.35 got '+r.components[0].kgm);
ok(r.components[1].kgm===1.5,'manual EA bracket kgm passthrough=1.5 got '+r.components[1].kgm);

console.log('— guard warnings —');
r = computeBalustrade({mode:'common',family:'welded_steel',runLengthMM:5000,heightMM:850,infillType:'square_bar',infillSpacingMM:150},deps);
ok(r.warnings.some(w=>/Part K guard minimum/.test(w)),'height warn fired');
ok(r.warnings.some(w=>/sphere rule/.test(w)),'100mm gap warn fired');

console.log('\nMISSING-SECTION handling —');
r = computeBalustrade({mode:'common',family:'welded_steel',runLengthMM:3000,postType:'NONSENSE99',infillType:'none'},deps);
ok(r.warnings.some(w=>/not found in steel DB/.test(w)),'missing section warns');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
