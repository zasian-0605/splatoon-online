/* V102: Canonical Splatoon 3-style special runtime.
   Sources checked: GameWith special list/effects (updated 2026-08-29).
   This file intentionally becomes the final special layer so older V90/V91
   special wrappers no longer decide the active special behavior. */
(function(){
'use strict';

const V='V102-CANONICAL-SPECIALS-2026-10-01';
window.__V102_SPECIALS_READY=true;
window.__ONLINE_BUILD_ID=V;

const OFFICIAL=[
  'ウルトラショット','エナジースタンド','カニタンク','キューインキ','グレートバリア',
  'サメライド','ショクワンダー','トリプルトルネード','ホップソナー','メガホンレーザー5.1ch',
  'テイオウイカ','デコイチラシ','スミナガシート','アメフラシ','ウルトラハンコ',
  'ジェットパック','ナイスダマ','マルチミサイル','ウルトラチャクチ'
];
const SET=new Set(OFFICIAL);

const WEAPON_SPECIALS=[
  'ウルトラショット','カニタンク','エナジースタンド','トリプルトルネード','ナイスダマ',
  'ウルトラハンコ','デコイチラシ','メガホンレーザー5.1ch','テイオウイカ','キューインキ',
  'ホップソナー','ジェットパック','グレートバリア','アメフラシ','ショクワンダー',
  'サメライド','メガホンレーザー5.1ch','スミナガシート','マルチミサイル','デコイチラシ',
  'ウルトラチャクチ','エナジースタンド'
];

const cfg={
  maxBarrier:2200,
  effects:{
    barriers:[],stands:[],storms:[],sonars:[],tornados:[],decoys:[],sheets:[],missiles:[],megas:[]
  }
};

function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d;}
function now(){return performance.now();}
function alive(f){return !!(f&&f.alive);}
function color(f){try{return getFighterInkHex(f);}catch(_){return f?.team==='B'?0xff2255:0xe3ff00;}}
function enemy(a,b){return alive(a)&&alive(b)&&a.team!==b.team;}
function remove(o){
  if(!o)return;
  try{if(o.parent)o.parent.remove(o);}catch(_){}
  try{o.traverse?.(q=>{q.geometry?.dispose?.();const m=q.material;if(m){(Array.isArray(m)?m:[m]).forEach(x=>x?.dispose?.());}});}catch(_){}
}
function mat(c,o=.7){
  return new THREE.MeshBasicMaterial({
    color:c,transparent:o<1,opacity:o,depthWrite:false,depthTest:false,side:THREE.DoubleSide
  });
}
function ring(pos,c,r){
  const g=new THREE.Group();
  const m=new THREE.Mesh(new THREE.RingGeometry(Math.max(.1,r*.72),Math.max(.12,r),36),mat(c,.58));
  m.rotation.x=-Math.PI/2;
  g.add(m);
  g.position.copy(pos);
  scene.add(g);
  return {g,m,base:r,at:now(),end:now()+850};
}
function floorY(x,z,y=50){
  try{return getSupportHeight(x,z,y);}catch(_){return 0;}
}
function groundPos(p){
  const q=p?.clone?p.clone():new THREE.Vector3(n(p?.x),n(p?.y),n(p?.z));
  q.y=Math.max(.05,floorY(q.x,q.z,50)+.06);
  return q;
}
function facing(f){
  if(f?.isPlayer&&camera){
    const d=new THREE.Vector3();
    camera.getWorldDirection(d);d.y=0;
    if(d.lengthSq()>.0001)return d.normalize();
  }
  const a=n(f?.root?.rotation?.y,0);
  return new THREE.Vector3(Math.sin(a),0,Math.cos(a)).normalize();
}
function targetPoint(f,d=18){
  return groundPos(f.pos.clone().addScaledVector(facing(f),d));
}
function planarInput(f){
  let x=(keys.d?1:0)-(keys.a?1:0),z=(keys.s?1:0)-(keys.w?1:0);
  if(!x&&!z)return null;
  const d=new THREE.Vector3(x,0,z).normalize();
  if(f?.isPlayer){
    const y=n(f.root?.rotation?.y,yaw||0);
    d.applyAxisAngle(new THREE.Vector3(0,1,0),y);
  }
  return d.normalize();
}
function damageRadius(src,p,r,dmg,reason='special'){
  const center=p?.clone?p.clone():new THREE.Vector3(n(p?.x),n(p?.y),n(p?.z));
  let count=0;
  for(const f of fighters||[]){
    if(!enemy(src,f))continue;
    const dy=Math.abs(n(f.pos.y)-n(center.y));
    const dd=Math.hypot(n(f.pos.x)-n(center.x),n(f.pos.z)-n(center.z));
    if(dd<=r&&dy<=Math.max(2.6,r*1.4)){
      const fall=Math.max(.35,1-(dd/Math.max(.01,r))*.45);
      try{applyDamage(f,dmg*fall,src,reason);}catch(_){}
      count++;
    }
  }
  return count;
}
function paint(p,r,c,team){
  try{paintGround(p.x,p.z,r,c,{team:team||null});}catch(_){}
}
function explosion(src,p,r,dmg,paintR){
  try{
    explodeAt(p.clone(),r,dmg,src?.team||'A',{
      paintRadius:paintR||r+.4,colorHex:color(src),sourceFighter:src||null
    });
  }catch(_){
    damageRadius(src,p,r,dmg,'special-explosion');
    paint(p,paintR||r+.4,color(src),src?.team);
  }
}
function marker(p,c,r=1.2){
  const q=groundPos(p);
  const g=new THREE.Group();
  const a=new THREE.Mesh(new THREE.RingGeometry(r*.65,r,28),mat(c,.75));
  a.rotation.x=-Math.PI/2;
  const b=new THREE.Mesh(new THREE.RingGeometry(r*.9,r*1.08,28),mat(0xffffff,.4));
  b.rotation.x=-Math.PI/2;b.position.y=.03;
  g.add(a,b);g.position.copy(q);scene.add(g);
  return g;
}
function stateFor(f){return f.__v102Special||null;}
function clearState(f){
  if(!f)return;
  const s=f.__v102Special;
  if(s?.visual)remove(s.visual);
  if(s?.line)remove(s.line);
  if(f.__v102Home)delete f.__v102Home;
  delete f.__v102Special;
  try{f.root.scale.set(1,1,1);}catch(_){}
}
function finishActive(f,returnHome=false){
  const s=stateFor(f);
  if(!s)return;
  if(returnHome&&f.__v102Home)try{f.pos.copy(f.__v102Home);}catch(_){}
  clearState(f);
  try{f.invulnUntil=0;}catch(_){}
}
function sendSpecial(f,name,p,extra={}){
  try{
    if(!onlineActive||!onlineStarted||!onlineSocket||onlineSocket.readyState!==1)return;
    onlineSocket.send(JSON.stringify({
      type:'special',specialName:name,x:n(p?.x,f.pos.x),y:n(p?.y,f.pos.y),z:n(p?.z,f.pos.z),
      extra:Object.assign({v102:true},extra)
    }));
  }catch(_){}
}

function makeBarrier(f){
  const g=new THREE.Group();
  const dome=new THREE.Mesh(new THREE.SphereGeometry(6,32,18,0,Math.PI*2,0,Math.PI*.56),mat(color(f),.26));
  dome.position.y=.15;
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.7,.9,.35,18),mat(0xffffff,.75));
  base.position.y=.2;
  const top=new THREE.Mesh(new THREE.SphereGeometry(.28,12,10),mat(0xffffff,.9));
  top.position.y=6.0;
  g.add(dome,base,top);g.position.copy(f.pos);scene.add(g);
  return g;
}

function makeStand(f){
  const g=new THREE.Group(),cans=[];
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.2,2.2,.78),mat(color(f),.92));body.position.y=1.1;g.add(body);
  const top=new THREE.Mesh(new THREE.BoxGeometry(1.34,.22,.84),mat(0xffffff,.9));top.position.y=2.25;g.add(top);
  for(let i=0;i<4;i++){
    const q=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.45,12),mat(i%2?0xe3ff00:0xffffff,.95));
    q.rotation.x=Math.PI/2;q.position.set((i-1.5)*.28,1.22,.44);g.add(q);cans.push(q);
  }
  g.position.copy(f.pos);scene.add(g);
  return {g,cans};
}

function makeSheet(f){
  const g=new THREE.Group();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(14,4.6,.16),mat(color(f),.42));
  mesh.position.y=2.25;g.add(mesh);
  const edge=new THREE.Mesh(new THREE.BoxGeometry(14,.08,.22),mat(0xffffff,.65));edge.position.y=4.55;g.add(edge);
  g.position.copy(f.pos);
  g.rotation.y=f.root.rotation.y;
  scene.add(g);
  return g;
}

function makeMega(f){
  const g=new THREE.Group();
  for(let i=0;i<6;i++){
    const q=new THREE.Mesh(new THREE.CylinderGeometry(.07,.28,.55,12),mat(0xffdf66,.92));
    q.rotation.z=Math.PI/2;
    const a=(i-2.5)*.25;
    q.rotation.y=a;q.position.set(Math.sin(a)*.68,1.55,Math.cos(a)*.68);g.add(q);
  }
  f.root.add(g);return g;
}

function makeDecoy(p,c){
  const q=new THREE.Group();
  const body=new THREE.Mesh(new THREE.SphereGeometry(.55,14,10),mat(c,.9));
  const beacon=new THREE.Mesh(new THREE.TorusGeometry(.56,.09,8,20),mat(0xffffff,.85));
  beacon.rotation.x=Math.PI/2;beacon.position.y=.12;
  q.add(body,beacon);q.position.copy(groundPos(p));scene.add(q);return q;
}

function makeSonar(p,c){
  const g=new THREE.Group();
  const core=new THREE.Mesh(new THREE.CylinderGeometry(.22,.34,1.2,12),mat(c,.85));core.position.y=.6;g.add(core);
  const top=new THREE.Mesh(new THREE.TorusGeometry(.4,.07,8,20),mat(0xffffff,.9));top.rotation.x=Math.PI/2;top.position.y=1.15;g.add(top);
  g.position.copy(groundPos(p));scene.add(g);return g;
}

function makeStorm(p,c){
  const g=new THREE.Group();
  const cloud=new THREE.Mesh(new THREE.CylinderGeometry(4.4,5.0,1.0,24),mat(c,.20));cloud.position.y=4.5;g.add(cloud);
  const core=new THREE.Mesh(new THREE.TorusGeometry(3.4,.10,10,32),mat(0xffffff,.38));core.rotation.x=Math.PI/2;core.position.y=.15;g.add(core);
  g.position.copy(p);scene.add(g);return g;
}

function startSpecial(f,name,target,remote=false,extra={}){
  if(!alive(f)||!SET.has(name))return false;

  const old=stateFor(f);
  if(old)finishActive(f,false);

  const p=target?.clone?target.clone():targetPoint(f,18);
  const t=now();
  const base={name,start:t,until:t+1.0,remote,visual:null};
  f.__v102Special=base;

  if(name==='ウルトラショット'){
    base.mode='ultra';base.until=t+6000;base.shots=3;base.next=0;
  }else if(name==='エナジースタンド'){
    const v=makeStand(f);
    cfg.effects.stands.push({owner:f,team:f.team,pos:f.pos.clone(),group:v.g,cans:4,canMeshes:v.cans,used:new Set(),end:t+15000});
    clearState(f);
  }else if(name==='カニタンク'){
    base.mode='crab';base.until=t+9000;base.next=0;base.ball=false;base.visual=(()=>{const g=new THREE.Group();const body=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),mat(0x66bbcc,.94));body.scale.set(1.28,.74,1.28);body.position.y=.9;g.add(body);for(const x of [-.45,.45]){const l=new THREE.Mesh(new THREE.CylinderGeometry(.11,.16,.85,8),mat(0x335f72,.95));l.rotation.z=x<0?-.35:.35;l.position.set(x,.2,0);g.add(l);}f.root.add(g);return g;})();
  }else if(name==='キューインキ'){
    base.mode='vac';base.until=t+6500;base.charge=0;base.wasShooting=false;
  }else if(name==='グレートバリア'){
    const g=makeBarrier(f);
    cfg.effects.barriers.push({owner:f,team:f.team,pos:f.pos.clone(),group:g,hp:2200,end:t+15000});
    clearState(f);
  }else if(name==='サメライド'){
    base.mode='reef';base.until=t+1800;base.dir=facing(f);base.home=f.pos.clone();base.active=true;
    base.visual=new THREE.Group();const s=new THREE.Mesh(new THREE.ConeGeometry(.7,2.4,12),mat(0x4ac7ff,.94));s.rotation.x=Math.PI/2;s.position.y=.35;base.visual.add(s);f.root.add(base.visual);
    f.invulnUntil=t+1550;
  }else if(name==='ショクワンダー'){
    base.mode='zip';base.until=t+7000;base.home=f.pos.clone();base.target=p.clone();base.used=true;
    const d=p.clone().sub(f.pos);d.y=0;if(d.lengthSq()<.01)d.set(0,0,1);d.normalize();
    const dist=Math.min(18,f.pos.distanceTo(p));f.pos.addScaledVector(d,dist);
    const geo=new THREE.BufferGeometry().setFromPoints([base.home,f.pos]);
    base.line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:color(f),transparent:true,opacity:.75,depthTest:false}));
    scene.add(base.line);
  }else if(name==='トリプルトルネード'){
    for(let i=0;i<3;i++){
      const q=p.clone();q.x+=(i-1)*3.0;q.y=floorY(q.x,q.z,50)+.05;
      const g=new THREE.Group();
      const a=new THREE.Mesh(new THREE.RingGeometry(.8,1.1,24),mat(color(f),.7));a.rotation.x=-Math.PI/2;g.add(a);
      const b=new THREE.Mesh(new THREE.CylinderGeometry(1.8,.6,5.5,18,1,true),mat(color(f),.18));b.position.y=2.6;g.add(b);
      g.position.copy(q);scene.add(g);
      cfg.effects.tornados.push({owner:f,team:f.team,pos:q,group:g,end:t+3000,next:0});
    }
    clearState(f);
  }else if(name==='ホップソナー'){
    const q=groundPos(p);const g=makeSonar(q,color(f));
    cfg.effects.sonars.push({owner:f,team:f.team,pos:q,group:g,wave:0,next:t+800,fx:[],end:t+8000});
    clearState(f);
  }else if(name==='メガホンレーザー5.1ch'){
    base.mode='mega';base.until=t+3000;base.last=0;base.hit=new Map();base.targets=[];base.lines=[];base.visual=makeMega(f);
  }else if(name==='テイオウイカ'){
    base.mode='kraken';base.until=t+6000;base.lastHit=0;base.visual=new THREE.Group();f.root.scale.set(1.35,1.2,1.35);f.invulnUntil=t+6000;
    base.lastSlam=0;
  }else if(name==='デコイチラシ'){
    const d=facing(f),side=new THREE.Vector3(-d.z,0,d.x);
    for(let i=0;i<12;i++){
      const q=p.clone().addScaledVector(d,(i%3)*1.8).addScaledVector(side,(i%4-1.5)*2.2);
      const g=marker(q,0xffffff,1.05);
      const dec=makeDecoy(q,color(f));
      cfg.effects.decoys.push({owner:f,team:f.team,pos:groundPos(q),group:dec,marker:g,end:t+3500,hp:59});
    }
    clearState(f);
  }else if(name==='スミナガシート'){
    const d=planarSafe(p.clone().sub(f.pos));const g=makeSheet(f);
    cfg.effects.sheets.push({owner:f,team:f.team,pos:g.position.clone(),dir:d,group:g,end:t+11000,lastHit:new Map()});
    clearState(f);
  }else if(name==='アメフラシ'){
    const d=facing(f);const g=makeStorm(p,color(f));
    cfg.effects.storms.push({owner:f,team:f.team,pos:p.clone(),dir:d,group:g,end:t+8000,next:0});
    clearState(f);
  }else if(name==='ウルトラハンコ'){
    base.mode='stamp';base.until=t+9000;base.next=0;base.lastThrow=0;base.visual=new THREE.Group();
    const h=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,1.8,8),mat(0x444444));h.position.y=1.35;
    const head=new THREE.Mesh(new THREE.BoxGeometry(1,.62,.44),mat(0x9b59ff));head.position.set(0,2.05,.15);
    base.visual.add(h,head);f.root.add(base.visual);f.invulnUntil=t+450;
  }else if(name==='ジェットパック'){
    base.mode='jet';base.until=t+7500;base.home=f.pos.clone();base.y=f.pos.y+3.0;
    const g=new THREE.Group();for(const x of [-.34,.34]){const tank=new THREE.Mesh(new THREE.CylinderGeometry(.15,.19,.66,10),mat(0x66ddff,.9));tank.position.set(x,1,0);g.add(tank);const flame=new THREE.Mesh(new THREE.ConeGeometry(.13,.55,8),mat(0xff9944,.92));flame.rotation.x=Math.PI;flame.position.set(x,.45,0);g.add(flame);}f.root.add(g);base.visual=g;f.invulnUntil=t+350;
  }else if(name==='ナイスダマ'){
    base.mode='booyah';base.until=t+9000;base.charge=0;base.next=0;base.home=f.pos.clone();f.invulnUntil=t+8500;
    if(remote)base.charge=n(extra.charge,0);
  }else if(name==='マルチミサイル'){
    const targets=(fighters||[]).filter(o=>enemy(f,o)).sort((a,b)=>a.pos.distanceTo(p)-b.pos.distanceTo(p)).slice(0,5);
    const count=Math.max(0,Math.min(10,targets.length*2));
    for(let i=0;i<count;i++){
      const tar=targets[i%Math.max(1,targets.length)];
      if(!tar)continue;
      const g=marker(tar.pos,0xff3344,.85);
      cfg.effects.missiles.push({owner:f,target:tar,team:f.team,marker:g,pos:tar.pos.clone(),at:t+900+i*120});
    }
    clearState(f);
  }else if(name==='ウルトラチャクチ'){
    base.mode='chaku';base.until=t+1000;base.started=t;base.home=f.pos.clone();base.hit=false;
    const g=new THREE.Group();for(const x of [-1.15,0,1.15]){const q=new THREE.Mesh(new THREE.SphereGeometry(.62,16,12),mat(color(f),.9));q.position.set(x,2.05,0);g.add(q);}f.root.add(g);base.visual=g;f.invulnUntil=t+1000;
  }

  if(!remote)sendSpecial(f,name,p,{phase:'start'});
  return true;
}
function planarSafe(d){d.y=0;return d.lengthSq()<.001?new THREE.Vector3(0,0,1):d.normalize();}

/* --- firing while a special is active --- */
const baseTryShoot=window.tryShoot;
function shootSpecial(f,dir){
  const s=stateFor(f);if(!s||!alive(f))return false;
  const t=now(),d=dir?.clone?dir.clone().normalize():facing(f);

  if(s.mode==='ultra'){
    if(s.shots<=0||t>s.until)return false;
    if(t<s.next)return false;
    s.next=t+360;s.shots--;
    try{
      spawnBulletV60(f,d,{speed:48,damage:220,gravity:5,radius:.30,paintRadius:2.2,life:1.55,explosive:true,explosionRadius:3.0,splashDamage:53,kind:'v102UltraShot'}); sendSpecial(f,'ウルトラショット',f.pos,{phase:'shot',dx:d.x,dy:d.y,dz:d.z});
    }catch(_){}
    if(s.shots<=0)setTimeout(()=>{if(stateFor(f)===s)finishActive(f,false);},160);
    return true;
  }

  if(s.mode==='jet'){
    if(t-(s.lastShot||0)<180)return false;s.lastShot=t;
    try{spawnBulletV60(f,d,{speed:38,damage:120,gravity:4,radius:.25,paintRadius:1.5,life:1.4,explosive:true,explosionRadius:2.2,splashDamage:50,kind:'v102Jetpack'});sendSpecial(f,'ジェットパック',f.pos,{phase:'shot',dx:d.x,dy:d.y,dz:d.z});}catch(_){}
    return true;
  }

  if(s.mode==='crab'){
    if(t-(s.lastShot||0)<(keys.space?420:140))return false;s.lastShot=t;
    try{
      if(keys.space){
        spawnBulletV60(f,d,{speed:34,damage:50,gravity:8,radius:.32,paintRadius:2.3,life:1.8,explosive:true,explosionRadius:2.7,splashDamage:30,kind:'v102CrabCannon'}); sendSpecial(f,'カニタンク',f.pos,{phase:'shot',cannon:true,dx:d.x,dy:d.y,dz:d.z});
      }else{
        spawnBulletV60(f,d,{speed:44,damage:32,gravity:5,radius:.18,paintRadius:1.5,life:1.2,kind:'v102CrabShot'}); sendSpecial(f,'カニタンク',f.pos,{phase:'shot',cannon:false,dx:d.x,dy:d.y,dz:d.z});
      }
    }catch(_){}
    return true;
  }

  if(s.mode==='stamp'){
    if(t-(s.lastHit||0)<260)return false;s.lastHit=t;
    const p=f.pos.clone().addScaledVector(d,2.2);p.y+=.1;
    damageRadius(f,p,2.25,100,'ultra-stamp');
    paint(p,2.8,color(f),f.team);
    return true;
  }

  if(s.mode==='kraken'){
    if(t-(s.lastHit||0)<320)return false;s.lastHit=t;
    const p=f.pos.clone().addScaledVector(d,2.5);
    damageRadius(f,p,2.8,120,'kraken-charge');
    paint(p,2.5,color(f),f.team);
    try{f.pos.addScaledVector(d,2.0);}catch(_){}
    return true;
  }
  return false;
}
function overrideTryShoot(f,d,t){
  const s=stateFor(f);
  if(s&&['ultra','jet','crab','stamp','kraken'].includes(s.mode))return shootSpecial(f,d);
  return baseTryShoot?.(f,d,t);
}
window.tryShoot=overrideTryShoot;
try{tryShoot=overrideTryShoot;}catch(_){}

/* --- special button / activation --- */
const baseFireSpecial=window.fireSpecial;
function fireCanonical(f){
  if(!alive(f))return false;
  const s=stateFor(f);
  if(s?.mode==='booyah'){
    if(s.charge<100){if(f.isPlayer)try{showToast('ナイスダマ：ナイスを5回！');}catch(_){}return false;}
    const p=targetPoint(f,18);
    explosion(f,p,5.2,300,5.6);
    s.charge=0;
    sendSpecial(f,'ナイスダマ',p,{phase:'throw',charge:100});
    finishActive(f,false);
    return true;
  }
  const name=f.weapon?.special;
  if(!SET.has(name))return baseFireSpecial?.(f)||false;
  if(n(f.specialGauge)<100){
    if(f.isPlayer)try{showToast('スペシャルゲージをためてください');}catch(_){}
    return false;
  }
  f.specialGauge=0;
  f.ink=100;
  return startSpecial(f,name,targetPoint(f,18),false,{});
}
window.fireSpecial=fireCanonical;
try{fireSpecial=fireCanonical;}catch(_){}

/* --- Booyah handling --- */
window.__chargeBooyahFromNice=function(){
  const f=playerFighter;
  const s=stateFor(f);
  if(!f||!s||s.mode!=='booyah')return false;
  s.charge=Math.min(100,s.charge+20);
  if(f.isPlayer)try{showToast('ナイスダマ '+s.charge+'%');}catch(_){}
  if(onlineActive&&onlineStarted&&s.charge%20===0)sendSpecial(f,'ナイスダマ',f.pos,{phase:'charge',charge:s.charge});
  return true;
};

/* --- remote special events --- */
const oldReceive=window.__receiveOriginalSpecial;
window.__receiveOriginalSpecial=function(f,name,p,extra){
  if(SET.has(name)){
    const e=extra&&typeof extra==='object'?extra:{};
    if(e.phase==='shot'&&(name==='ウルトラショット'||name==='ジェットパック'||name==='カニタンク')){
      const d=new THREE.Vector3(n(e.dx),n(e.dy),n(e.dz));
      if(d.lengthSq()<.001)d.copy(facing(f));else d.normalize();
      try{
        const opt=name==='ウルトラショット'
          ? {speed:48,damage:220,gravity:5,radius:.30,paintRadius:2.2,life:1.55,explosive:true,explosionRadius:3.0,splashDamage:53,kind:'v102RemoteUltra'}
          : name==='ジェットパック'
            ? {speed:38,damage:120,gravity:4,radius:.25,paintRadius:1.5,life:1.4,explosive:true,explosionRadius:2.2,splashDamage:50,kind:'v102RemoteJet'}
            : (e.cannon
              ? {speed:34,damage:50,gravity:8,radius:.32,paintRadius:2.3,life:1.8,explosive:true,explosionRadius:2.7,splashDamage:30,kind:'v102RemoteCrabCannon'}
              : {speed:44,damage:32,gravity:5,radius:.18,paintRadius:1.5,life:1.2,kind:'v102RemoteCrabShot'});
        spawnBulletV60(f,d,opt);
      }catch(_){ }
      return;
    }
    const e=extra&&typeof extra==='object'?extra:{};
    if(name==='ナイスダマ'&&e.phase==='charge'){
      const s=stateFor(f)||startSpecial(f,name,p,true,e)&&stateFor(f);
      if(s)s.charge=Math.max(s.charge,n(e.charge,s.charge));
      return;
    }
    if(name==='ナイスダマ'&&e.phase==='throw'){
      if(!stateFor(f))startSpecial(f,name,p,true,{});
      const q=targetPoint(f,18);
      if(e&&Number.isFinite(Number(p?.x)))q.set(n(p.x),n(p.y),n(p.z));
      explosion(f,q,5.2,300,5.6);finishActive(f,false);return;
    }
    startSpecial(f,name,p,true,e);
    return;
  }
  return oldReceive?.(f,name,p,extra);
};

/* --- movement controlled specials --- */
const baseMovement=window.updatePlayerMovement;
function moveSpecial(dt){
  const f=playerFighter,s=stateFor(f);
  if(!f||!s||!alive(f))return false;
  const t=now();

  if(s.mode==='jet'){
    if(t>=s.until){finishActive(f,true);return true;}
    const d=planarInput(f);if(d){f.pos.x+=d.x*7.0*dt;f.pos.z+=d.z*7.0*dt;}
    let y=s.y;if(keys.space)y+=2.8;if(keys.shift)y-=2.2;
    f.pos.y+=(y-f.pos.y)*Math.min(1,dt*8);
    setHuman(f);return true;
  }

  if(s.mode==='crab'){
    if(t>=s.until){finishActive(f,false);return true;}
    s.ball=!!keys.shift;
    const d=planarInput(f);if(d){const sp=s.ball?12.5:5.5;f.pos.x+=d.x*sp*dt;f.pos.z+=d.z*sp*dt;f.root.rotation.y=Math.atan2(d.x,d.z);}
    if(s.visual)s.visual.scale.setScalar(s.ball?1.12:1);
    setHuman(f);return true;
  }

  if(s.mode==='stamp'){
    if(t>=s.until){finishActive(f,false);return true;}
    const d=planarInput(f);if(d){try{tryMoveWithCollision(f,d.clone().multiplyScalar(5.0),dt,false);}catch(_){f.pos.addScaledVector(d,5*dt);}f.root.rotation.y=Math.atan2(d.x,d.z);}
    setHuman(f);return true;
  }

  if(s.mode==='reef'){
    if(t>=s.until){explosion(f,f.pos,5.0,220,5.5);finishActive(f,false);return true;}
    const before=f.pos.clone(),step=s.dir.clone().multiplyScalar(26*dt);
    try{tryMoveWithCollision(f,step,dt,false);}catch(_){f.pos.addScaledVector(step,1);}
    if(f.pos.distanceTo(before)<.05){
      explosion(f,f.pos,5.0,220,5.5);finishActive(f,false);return true;
    }
    paint(f.pos,1.7,color(f),f.team);
    damageRadius(f,f.pos,2.0,220,'reefslider');
    setHuman(f);return true;
  }

  if(s.mode==='kraken'){
    if(t>=s.until){explosion(f,f.pos,3.2,120,3.8);finishActive(f,false);return true;}
    const d=planarInput(f)||facing(f);
    if(d){
      try{tryMoveWithCollision(f,d.clone().multiplyScalar(8.2),dt,false);}catch(_){f.pos.addScaledVector(d,8.2*dt);}
      f.root.rotation.y=Math.atan2(d.x,d.z);
    }
    if(keys.space&&t-(s.lastSlam||0)>1000){
      s.lastSlam=t;explosion(f,f.pos,3.8,60,4.2);
    }
    setHuman(f);return true;
  }

  if(s.mode==='zip'){
    if(t>=s.until){finishActive(f,true);return true;}
    const old=keys.shift;keys.shift=false;
    try{baseMovement?.(dt);}finally{keys.shift=old;}
    return true;
  }

  if(s.mode==='chaku'){
    const p=Math.min(1,(t-s.start)/700),gy=floorY(f.pos.x,f.pos.z,50);
    f.pos.y=gy+.15+4.4*Math.sin(p*Math.PI/2);
    if(p>=1){explosion(f,f.pos,5.2,220,5.8);finishActive(f,false);}
    return true;
  }

  return false;
}
function setHuman(f){
  try{f.squid_mode=false;if(f.human)f.human.visible=true;if(f.squid)f.squid.visible=false;}catch(_){}
}
function movementOverride(dt){
  const s=stateFor(playerFighter);
  if(s&&['jet','crab','stamp','reef','kraken','zip','chaku'].includes(s.mode))return moveSpecial(dt);
  return baseMovement?.(dt);
}
window.updatePlayerMovement=movementOverride;
try{updatePlayerMovement=movementOverride;}catch(_){}

/* --- ongoing placed effects --- */
function updateCanon(dt){
  const t=now();

  for(const f of fighters||[]){
    const s=stateFor(f);
    if(!s||!alive(f))continue;

    if(t>=s.until&&['jet','crab','stamp','reef','kraken','zip','chaku'].includes(s.mode)){
      if(!f.isPlayer&&s.mode==='reef')explosion(f,f.pos,5.0,220,5.5);
      if(!f.isPlayer&&s.mode==='chaku')explosion(f,f.pos,5.2,220,5.8);
      finishActive(f,s.mode==='jet'||s.mode==='zip');
      continue;
    }

    if(s.mode==='mega'){
      if(t>=s.until){finishActive(f,false);continue;}
      if(t-(s.last||0)>140){
        s.last=t;
        s.targets=(fighters||[]).filter(o=>enemy(f,o)).sort((a,b)=>a.pos.distanceTo(f.pos)-b.pos.distanceTo(f.pos)).slice(0,3);
      }
      while(s.lines.length<6){
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:color(f),transparent:true,opacity:.62,depthTest:false}));
        line.renderOrder=9999;scene.add(line);s.lines.push(line);
      }
      let k=0;
      for(const q of s.targets||[]){
        if(!alive(q))continue;
        const a=f.pos.clone();a.y+=1.5;const b=q.pos.clone();b.y+=1;
        for(const off of [-.16,.16]){
          if(!s.lines[k])break;
          const side=new THREE.Vector3(-Math.cos(f.root.rotation.y),0,Math.sin(f.root.rotation.y)).multiplyScalar(off);
          s.lines[k++].geometry.setFromPoints([a.clone().add(side),b.clone().add(side)]);
          const key=String(q.id),last=n(s.hit?.get(key),0);
          if(t-last>200){s.hit.set(key,t);try{applyDamage(q,28,f,'megaphone');}catch(_){}}
        }
      }
      for(;k<s.lines.length;k++)s.lines[k].geometry.setFromPoints([f.pos,f.pos]);
    }

    if(s.mode==='vac'){
      if(t>=s.until||s.charge>=180){
        const d=facing(f),p=f.pos.clone().addScaledVector(d,6);explosion(f,p,3.8,Math.min(220,60+s.charge),4.4);finishActive(f,false);continue;
      }
      const sucking=!!isShooting;
      s.wasShooting=sucking;
      for(let i=(bullets?.length||0)-1;i>=0;i--){
        const b=bullets[i];if(!b?.mesh||b.team===f.team)continue;
        if(b.mesh.position.distanceTo(f.pos)<5.5){
          s.charge=Math.min(180,s.charge+Math.max(12,n(b.damage,25)*.55));
          remove(b.mesh);bullets.splice(i,1);
        }
      }
      try{
        for(let i=(subInstances?.length||0)-1;i>=0;i--){
          const b=subInstances[i];if(!b?.mesh||b.team===f.team)continue;
          if(b.mesh.position.distanceTo(f.pos)<4.8){s.charge=Math.min(180,s.charge+35);remove(b.mesh);subInstances.splice(i,1);}
        }
      }catch(_){}
    }
  }

  for(let i=cfg.effects.barriers.length-1;i>=0;i--){
    const b=cfg.effects.barriers[i];
    if(t>=b.end||!alive(b.owner)||b.hp<=0){remove(b.group);cfg.effects.barriers.splice(i,1);continue;}
    for(let j=(bullets?.length||0)-1;j>=0;j--){
      const q=bullets[j];if(!q?.mesh||q.team===b.team)continue;
      const d=Math.hypot(q.mesh.position.x-b.pos.x,q.mesh.position.z-b.pos.z);
      if(d<6.0&&Math.abs(q.mesh.position.y-(b.pos.y+2.0))<4.0){b.hp-=Math.max(1,n(q.damage,20));remove(q.mesh);bullets.splice(j,1);}
    }
    try{
      for(let j=(subInstances?.length||0)-1;j>=0;j--){
        const q=subInstances[j];if(!q?.mesh||q.team===b.team)continue;
        if(Math.hypot(q.mesh.position.x-b.pos.x,q.mesh.position.z-b.pos.z)<6){remove(q.mesh);subInstances.splice(j,1);}
      }
    }catch(_){}
  }

  for(let i=cfg.effects.stands.length-1;i>=0;i--){
    const s=cfg.effects.stands[i];
    if(t>=s.end||s.cans<=0){remove(s.group);cfg.effects.stands.splice(i,1);continue;}
    if(s.group)s.group.rotation.y+=dt*.7;
    for(const f of fighters||[]){
      if(!alive(f)||f.team!==s.team||s.used.has(String(f.id))||f.pos.distanceTo(s.pos)>2.6)continue;
      s.used.add(String(f.id));s.cans--;
      f.speedBoostUntil=Math.max(f.speedBoostUntil||0,t+17000);
      f.__v102EnergyUntil=t+17000;
      f.ink=Math.min(100,f.ink+35);
      const meshList=s.canMeshes||[];
      const q=meshList.find(x=>x?.visible);
      if(q)q.visible=false;
    }
  }

  for(let i=cfg.effects.storms.length-1;i>=0;i--){
    const s=cfg.effects.storms[i];
    if(t>=s.end){remove(s.group);cfg.effects.storms.splice(i,1);continue;}
    s.pos.addScaledVector(s.dir,1.25*dt);s.group.position.copy(s.pos);
    if(t>=s.next){
      s.next=t+250;paint(s.pos,5,color(s.owner),s.team);
      for(const f of fighters||[]){
        if(!alive(f))continue;
        const d=f.pos.distanceTo(s.pos);
        if(f.team===s.team){if(d<5&&f.hp<f.maxHp)f.hp=Math.min(f.maxHp,f.hp+5);}
        else if(d<5.1)try{applyDamage(f,6,s.owner,'ink-storm');}catch(_){}
      }
    }
  }

  for(let i=cfg.effects.sonars.length-1;i>=0;i--){
    const s=cfg.effects.sonars[i];
    if(t>=s.end){remove(s.group);for(const x of s.fx||[])remove(x.mesh);cfg.effects.sonars.splice(i,1);continue;}
    if(t>=s.next&&s.wave<3){
      s.next=t+(s.wave===0?1400:2200);s.wave++;
      const q=new THREE.Mesh(new THREE.RingGeometry(.8,1.1,40),mat(color(s.owner),.72));
      q.rotation.x=-Math.PI/2;q.position.copy(s.pos);scene.add(q);s.fx.push({mesh:q,at:t});
      for(const f of fighters||[])if(enemy(s.owner,f)&&f.pos.distanceTo(s.pos)<20){
        try{applyDamage(f,45,s.owner,'hop-sonar');}catch(_){}
        f.revealedUntil=t+7000;
      }
    }
    for(let k=s.fx.length-1;k>=0;k--){
      const q=s.fx[k],p=Math.min(1,(t-q.at)/850);q.mesh.scale.setScalar(.12+p*17);q.mesh.material.opacity=.72*(1-p);
      if(p>=1){remove(q.mesh);s.fx.splice(k,1);}
    }
  }

  for(let i=cfg.effects.tornados.length-1;i>=0;i--){
    const s=cfg.effects.tornados[i];
    if(t>=s.end){remove(s.group);cfg.effects.tornados.splice(i,1);continue;}
    s.group.rotation.y+=dt*2;
    if(t>=s.next){s.next=t+650;explosion(s.owner,s.pos,3.0,135,3.8);}
  }

  for(let i=cfg.effects.decoys.length-1;i>=0;i--){
    const d=cfg.effects.decoys[i];
    if(t>=d.end){explosion(d.owner,d.pos,2.4,70,3.0);remove(d.group);remove(d.marker);cfg.effects.decoys.splice(i,1);continue;}
    d.group.rotation.y+=dt*1.5;
    for(const f of fighters||[])if(enemy(d.owner,f)&&f.pos.distanceTo(d.pos)<1.2){/* real game lets enemies destroy decoys; proximity only intimidates here */}
  }

  for(let i=cfg.effects.missiles.length-1;i>=0;i--){
    const m=cfg.effects.missiles[i];
    if(t>=m.at){
      const p=alive(m.target)?m.target.pos.clone():m.pos.clone();
      explosion(m.owner,p,2.6,150,3.2);remove(m.marker);cfg.effects.missiles.splice(i,1);continue;
    }
    if(m.marker&&alive(m.target))m.marker.position.copy(groundPos(m.target.pos));
  }

  for(let i=cfg.effects.sheets.length-1;i>=0;i--){
    const s=cfg.effects.sheets[i];
    if(t>=s.end){remove(s.group);cfg.effects.sheets.splice(i,1);continue;}
    s.pos.addScaledVector(s.dir,.8*dt);s.group.position.copy(s.pos);s.group.rotation.y=Math.atan2(s.dir.x,s.dir.z);
    for(const f of fighters||[]){
      if(!enemy(s.owner,f))continue;
      const r=f.pos.clone().sub(s.pos);const side=Math.abs(r.dot(new THREE.Vector3(-s.dir.z,0,s.dir.x)));const front=Math.abs(r.dot(s.dir));
      if(side<7&&front<.45){
        const last=n(s.lastHit.get(String(f.id)),0);
        if(t-last>500){s.lastHit.set(String(f.id),t);try{applyDamage(f,30,s.owner,'sminaga-sheet');}catch(_){}}
        f.grayVisionUntil=t+400;
      }
    }
  }

  for(let i=cfg.effects.megas.length-1;i>=0;i--){
    const s=cfg.effects.megas[i];
    if(t>=s.end){cfg.effects.megas.splice(i,1);continue;}
  }

  for(const f of fighters||[]){
    const s=stateFor(f);if(!s)continue;
    if(t>=s.until&&['jet','crab','stamp','reef','kraken','zip','chaku','booyah'].includes(s.mode)){
      if(!f.isPlayer&&s.mode==='reef')explosion(f,f.pos,5.0,220,5.5);
      if(!f.isPlayer&&s.mode==='chaku')explosion(f,f.pos,5.2,220,5.8);
      finishActive(f,s.mode==='jet'||s.mode==='zip');
      continue;
    }
    if(s.visual&&s.mode==='jet')s.visual.rotation.y+=dt*3;
    if(s.visual&&s.mode==='crab')s.visual.rotation.y+=dt*.5;
    if(s.visual&&s.mode==='stamp')s.visual.rotation.x=isShooting?-.06:0;
    if(s.visual&&s.mode==='chaku')s.visual.rotation.y+=dt*3;
  }

  let gray=false;
  for(const s of cfg.effects.sheets)if(playerFighter?.alive){
    const r=playerFighter.pos.clone().sub(s.pos),side=Math.abs(r.dot(new THREE.Vector3(-s.dir.z,0,s.dir.x))),front=Math.abs(r.dot(s.dir));
    if(side<7&&front<.5){gray=true;break;}
  }
  if(renderer?.domElement)renderer.domElement.style.filter=gray?'grayscale(1) saturate(.3)':'';
}

/* Ultra / Mega line cleanup */
/* Store stand can meshes on the effect itself; four cans are consumed independently. */
for(const s of cfg.effects.stands){if(Array.isArray(s.cans)&&!s.canMeshes){s.canMeshes=s.cans;s.cans=s.canMeshes.length;}}

const oldFinishHook=window.killFighter;
if(typeof oldFinishHook==='function'){
  window.killFighter=function(f){
    if(stateFor(f))finishActive(f,false);
    return oldFinishHook(f);
  };
}

/* Keep energy stand can meshes explicit. */
for(const s of cfg.effects.stands){
  if(!s._canMeshes&&s.cans?.length&&Array.isArray(s.cans))s._canMeshes=s.cans;
}

/* Map all project weapons onto the 19 official specials so every special is reachable. */
try{
  for(let i=0;i<(weaponList||[]).length;i++){
    const w=weaponList[i];
    if(w)w.special=WEAPON_SPECIALS[i%WEAPON_SPECIALS.length];
  }
  try{rebuildWeaponSelectV60?.();}catch(_){}
  setTimeout(()=>{try{rebuildWeaponSelectV60?.();}catch(_){}})
}catch(_){}

/* Final ongoing-effect owner. Older V90/V91 state is not touched because this
   runtime uses only __v102Special and cfg.effects. */
const baseOngoing=window.updateOngoingEffects;
window.updateOngoingEffects=function(dt){
  try{baseOngoing?.(dt);}catch(e){console.warn('[V102 old special layer]',e);}
  try{updateCanon(dt);}catch(e){console.warn('[V102 canonical specials]',e);}
};
try{updateOngoingEffects=window.updateOngoingEffects;}catch(_){}

console.log('[SPLATOON ONLINE]['+V+'] canonical 19-special runtime active');
})();
