const { computeBalustradeLabour } = require('/tmp/bal_labour.js');
let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const G=(o)=>Object.assign({mode:'common',family:'welded_steel',familyLabel:'Welded steel balustrade',raked:false},o);

console.log('═══ ANCHOR 1: handrail-only 1m installed should be £1,200–1,500 ═══');
let r=computeBalustradeLabour(G({family:'handrail_only',familyLabel:'Handrail only',runLengthMM:1000,runM:1}),{},{});
console.log(`  1m: fab £${r.fab} design £${r.design} install £${r.install} = TOTAL £${r.total} (£${r.effRatePerM}/m)`);
ok(r.total>=1200 && r.total<=1550,'1m handrail in £1200–1550 band → got £'+r.total);

console.log('═══ ANCHOR 2: handrail-only 10m should be ~£3,200 ═══');
r=computeBalustradeLabour(G({family:'handrail_only',familyLabel:'Handrail only',runLengthMM:10000,runM:10}),{},{});
console.log(`  10m: fab £${r.fab} design £${r.design} install £${r.install} = TOTAL £${r.total} (£${r.effRatePerM}/m)`);
ok(r.total>=2900 && r.total<=3500,'10m handrail ~£3,200 (2900–3500) → got £'+r.total);

console.log('═══ ANCHOR 3: common welded steel at typical size lands ~£305–325/m ═══');
[5,10,15,20].forEach(m=>{
  r=computeBalustradeLabour(G({runLengthMM:m*1000,runM:m,infill:'square_bar'}),{},{});
  console.log(`  ${m}m: TOTAL £${r.total} → £${r.effRatePerM}/m  band=${r.breakdown.band}  flag=${r.envelopeFlag?(r.envelopeFlag.hard?'HARD':'soft'):'none'}`);
});
r=computeBalustradeLabour(G({runLengthMM:15000,runM:15}),{},{});
ok(r.effRatePerM>=290 && r.effRatePerM<=340,'15m welded ~305–325/m → got £'+r.effRatePerM+'/m');

console.log('═══ STAIR UPLIFT: raked = ×1.1, envelope scales ═══');
let lvl=computeBalustradeLabour(G({runLengthMM:8000,runM:8}),{},{});
let stair=computeBalustradeLabour(G({runLengthMM:8000,runM:8,raked:true}),{},{});
console.log(`  level 8m £${lvl.effRatePerM}/m  vs  stair 8m £${stair.effRatePerM}/m (ratio ${(stair.effRatePerM/lvl.effRatePerM).toFixed(3)})`);
ok(stair.effRatePerM > lvl.effRatePerM,'stair dearer than level');
ok(Math.abs(stair.effRatePerM/lvl.effRatePerM - 1.1) < 0.02,'stair ≈ ×1.1 of level');

console.log('═══ ENVELOPE: unlocked=soft, locked=hard ═══');
// force out of band with a silly high fixedSetup override on a short run
r=computeBalustradeLabour(G({runLengthMM:2000,runM:2}),{fixedSetup:3000},{});
console.log(`  2m forced high: £${r.effRatePerM}/m flag=${r.envelopeFlag?(r.envelopeFlag.hard?'HARD':'SOFT'):'none'}`);
ok(r.envelopeFlag && r.envelopeFlag.hard===false,'unlocked → soft flag');
r=computeBalustradeLabour(G({runLengthMM:2000,runM:2}),{fixedSetup:3000,locked:true},{});
ok(r.envelopeFlag && r.envelopeFlag.hard===true,'locked → hard flag');

console.log('═══ FEATURE: complexity raises cost, design softened ═══');
let common=computeBalustradeLabour(G({mode:'common',runLengthMM:10000,runM:10}),{},{});
let feat=computeBalustradeLabour(G({mode:'feature',runLengthMM:10000,runM:10}),{complexity:'complex'},{});
console.log(`  common 10m £${common.total}  vs  feature/complex £${feat.total}`);
ok(feat.total>common.total,'feature dearer');
ok(!feat.envelopeFlag,'feature bypasses envelope');

console.log('═══ MANUAL: hours in, install days ═══');
r=computeBalustradeLabour({mode:'manual',family:'welded_steel',runM:4},{manualFabHrs:20,manualDesignHrs:6,installCrew:2,installDays:1.5,installDayRate:280},{});
console.log(`  manual: fab £${r.fab} design £${r.design} install £${r.install} = £${r.total}`);
ok(r.fab===20*45 && r.design===6*50 && r.install===2*1.5*280,'manual arithmetic exact');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
