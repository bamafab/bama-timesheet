const { computeBalustrade } = require('/tmp/bal_engine.js');
const KGM={'SHS50X50X3':4.35,'CHS48.3X3.2':3.56,'FLT50X10':3.93,'FLT16X16':2.01};
const findSteelProfile=(raw)=>{if(!raw)return{canonical:'',kgm:null,confidence:'none'};const k=String(raw).toUpperCase().replace(/[×*\/]/g,'X').replace(/\s+/g,'');return{canonical:k,kgm:KGM[k]||null,confidence:KGM[k]?'high':'none'};};
const deps={findSteelProfile}; let pass=0,fail=0; const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};

console.log('— RAKED stair balustrade defaults to 900mm —');
let r=computeBalustrade({mode:'common',family:'welded_steel',runLengthMM:4200,raked:true,infillType:'square_bar'},deps);
ok(r.ok,'ok');
ok(r.geometry.heightMM===900,'height defaults 900 raked, got '+r.geometry.heightMM);
ok(r.geometry.raked===true,'raked flag set');
ok(r.warnings.some(w=>/900mm on the pitch/.test(w)),'raked landing reminder fired');
const top=r.components.find(c=>c.role==='toprail');
ok(top.length===4200,'top rail = sloped run 4200mm');
console.log('  height='+r.geometry.heightMM+' totalKg='+r.geometry.totalKg+' (sloped 4.2m)');

console.log('— explicit height override on raked still honoured —');
r=computeBalustrade({mode:'common',family:'welded_steel',runLengthMM:3000,raked:true,heightMM:1100,infillType:'none'},deps);
ok(r.geometry.heightMM===1100,'override 1100 honoured, got '+r.geometry.heightMM);

console.log('— level run unaffected (still 1100 default) —');
r=computeBalustrade({mode:'common',family:'welded_steel',runLengthMM:5000,infillType:'none'},deps);
ok(r.geometry.heightMM===1100,'level default 1100, got '+r.geometry.heightMM);
ok(r.geometry.raked===false,'level not raked');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
