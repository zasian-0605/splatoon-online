/* V95: stable CPU AI, front-only firing, automatic team colors */
(function(){
'use strict';
if(window.__V95_ACTIVE)return;
window.__V95_ACTIVE=true;
const BUILD='V95-AI-FRONT-AUTO-COLOR-2026-09-30';
const A=0xe3ff00,B=0xff2255,Y=new THREE.Vector3(0,1,0),brains=new WeakMap();

function fs(){try{if(typeof fighters!=='undefined'&&Array.isArray(fighters))return fighters;}catch(_){}return window.fighters||[];}
function front(f){
  let y=Number(f?.human?.rotation?.y);
  if(!Number.isFinite(y))y=Number(f?.root?.rotation?.y)||0;
  const d=new THREE.Vector3(Math.sin(y),0,Math.cos(y));
  return d.lengthSq()?d.normalize():new THREE.Vector3(0,0,1);
}
function face(f,t){
  const dx=t.x-f.pos.x,dz=t.z-f.pos.z;
  if(dx*dx+dz*dz<.0001)return;
  const y=Math.atan2(dx,dz);
  f.human.rotation.y=y;f.root.rotation.y=y;
}
function brain(f,now){
  let a=brains.get(f);
  if(!a){a={strafe:Math.random()<.5?-1:1,nextShot:0,nextStrafe:now+800+Math.random()*800,nextSub:now+1800+Math.random()*1400,nextSpecial:now+5000+Math.random()*4000,charge:0,waypoint:null,nextWaypoint:0,last:f.pos.clone(),lastAt:now,stuck:0};brains.set(f,a);}
  return a;
}
function target(f){
  let best=null,bd=Infinity;
  for(const o of fs()){
    if(!o||o===f||o.remote||!o.alive||!o.team||o.team===f.team)continue;
    const d=Math.hypot(o.pos.x-f.pos.x,o.pos.z-f.pos.z);
    if(d<bd){bd=d;best=o;}
  }
  return best;
}
function range(w){
  switch(w?.category){
    case 'charger':return [14,42];
    case 'spinner':return [9,30];
    case 'roller':return [0,6.5];
    case 'wiper':return [1,9];
    case 'blaster':return [3,15];
    case 'slosher':return [4,17];
    case 'brella':return [3,14];
    default:return [4,24];
  }
}
function move(f,dest,dt){
  const dx=dest.x-f.pos.x,dz=dest.z-f.pos.z,len=Math.hypot(dx,dz);
  if(len<.12)return false;
  const v=new THREE.Vector3(dx/len,0,dz/len).multiplyScalar(5.8*(f.gearProfile?.move||1));
  const before=f.pos.clone();
  try{tryMoveWithCollision(f,v,dt,false);}catch(_){}
  if(before.distanceTo(f.pos)>.02)return true;
  for(const s of [1,-1]){
    const q=v.clone().applyAxisAngle(Y,s*.95);
    try{tryMoveWithCollision(f,q,dt,false);}catch(_){}
    if(before.distanceTo(f.pos)>.02)return true;
  }
  return false;
}
function patrol(f,a,now){
  if(a.waypoint&&now<a.nextWaypoint&&Math.hypot(a.waypoint.x-f.pos.x,a.waypoint.z-f.pos.z)>1.3)return a.waypoint;
  const s=f.team==='A'?-1:1;
  const p=[{x:0,z:s*18},{x:-20,z:s*26},{x:20,z:s*26},{x:0,z:s*4},{x:s*22,z:s*34}];
  a.waypoint=p[Math.floor(Math.random()*p.length)];
  a.nextWaypoint=now+1800+Math.random()*1800;
  return a.waypoint;
}
function onlineAIShot(f,mode,charge){
  if(f?.isPlayer||f?.remote||typeof onlineActive==='undefined'||!onlineActive||typeof onlineStarted==='undefined'||!onlineStarted)return;
  if(typeof window.__v93SendShot!=='function')return;
  const d=front(f),w=f.weapon||{};
  try{window.__v93SendShot({
    x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,
    dx:d.x,dy:d.y,dz:d.z,weaponId:Number(w.id)||0,
    mode:mode||undefined,
    charge:Number.isFinite(Number(charge))?Number(charge):undefined
  });}catch(_){}
}
function attack(f,t,now,a){
  const w=f.weapon||{};face(f,t);const d=front(f);
  if(w.category==='charger'){
    if(!a.charge)a.charge=now;
    if(now-a.charge>=Math.max(260,(w.chargeTime||800)*.58)&&now>=a.nextShot){
      a.nextShot=now+650;
      const frac=Math.max(.45,Math.min(.98,(now-a.charge)/(w.chargeTime||800)));
      try{(window.fireChargerShot||window.fireChargerShotV60)?.(f,d,frac);}catch(_){}
      a.charge=0;
    }
    return;
  }
  if(w.category==='wiper'){
    if(!a.charge)a.charge=now;
    if(now-a.charge>=Math.max(180,(w.chargeTime||600)*.45)&&now>=a.nextShot){
      a.nextShot=now+430;
      const frac=Math.max(.45,Math.min(1,(now-a.charge)/(w.chargeTime||600)));
      try{window.fireBladeSlashV60?.(f,frac,d);}catch(_){}
      a.charge=0;
    }
    return;
  }
  a.charge=0;
  try{
    if(w.category==='roller'&&typeof performRollerSwing==='function'){performRollerSwing(f,now);onlineAIShot(f,'rollerFlick');return;}
    if(w.brush&&typeof doBrushAction==='function'){doBrushAction(f,now,true);onlineAIShot(f,'brush');return;}
    tryShoot(f,d,now);
  }catch(_){}
}
function updateAI95(f,dt,now){
  if(!f||f.isPlayer||f.remote||!f.alive)return;
  const a=brain(f,now),t=target(f);
  let dest,combat=false;
  if(t){
    const d=Math.hypot(t.pos.x-f.pos.x,t.pos.z-f.pos.z),r=range(f.weapon);
    if(f.hp<25||f.ink<8){
      const s=f.team==='A'?-1:1;dest={x:f.pos.x*.35,z:s*40};
    }else if(d>r[1])dest={x:t.pos.x,z:t.pos.z};
    else if(d<Math.max(1.5,r[0])){
      const dx=f.pos.x-t.pos.x,dz=f.pos.z-t.pos.z,l=Math.hypot(dx,dz)||1;
      dest={x:f.pos.x+dx/l*3.5,z:f.pos.z+dz/l*3.5};combat=true;
    }else{
      combat=true;
      if(now>=a.nextStrafe){a.strafe*=-1;a.nextStrafe=now+650+Math.random()*800;}
      const dx=t.pos.x-f.pos.x,dz=t.pos.z-f.pos.z,l=Math.hypot(dx,dz)||1;
      dest={x:f.pos.x+(-dz/l)*a.strafe*2.0,z:f.pos.z+(dx/l)*a.strafe*2.0};
    }
  }else dest=patrol(f,a,now);

  if(dest){
    const moved=move(f,dest,dt);f._moving=moved;
    if(!combat&&moved){f.human.rotation.y=Math.atan2(dest.x-f.pos.x,dest.z-f.pos.z);f.root.rotation.y=f.human.rotation.y;}
  }else f._moving=false;

  if(combat&&t){
    face(f,t);attack(f,t,now,a);
    const d=Math.hypot(t.pos.x-f.pos.x,t.pos.z-f.pos.z);
    if(typeof window.tryThrowSub==='function'&&now>=a.nextSub&&d<24){
      try{window.tryThrowSub(f,front(f),now);}catch(_){}
      a.nextSub=now+2600+Math.random()*1400;
    }
    if(Number(f.specialGauge)>=100&&now>=a.nextSpecial){
      try{window.fireSpecial?.(f);}catch(_){}
      a.nextSpecial=now+9000+Math.random()*4000;
    }
  }
  updateFighterAnimation(f,!!f._moving,false);
  if(now-a.lastAt>.7){
    const md=f.pos.distanceTo(a.last);
    a.stuck=md<.16?a.stuck+.7:0;a.last.copy(f.pos);a.lastAt=now;
    if(a.stuck>1.4){a.stuck=0;a.waypoint=null;a.strafe*=-1;try{tryMoveWithCollision(f,new THREE.Vector3(a.strafe*5,0,0),.18,false);}catch(_){}}
  }
}

/* The V94 raster scan is replaced before the next frame, preventing the thousands
   of getImageData calls that could stall the game. */
try{updateAI=updateAI95;}catch(_){}
window.updateAI=updateAI95;

/* One firing direction: the weapon always uses the fighter's current forward. */
try{
  const baseTry=tryShoot;
  if(!baseTry.__v95Wrapped){
    tryShoot=function(f,_aim,now){return baseTry(f,front(f),now);};
    tryShoot.__v95Wrapped=true;window.tryShoot=tryShoot;
  }
}catch(_){}

function wrap(name,mode){
  const base=window[name];
  if(typeof base!=='function'||base.__v95Wrapped)return;
  const fn=function(f,_aim,c){
    const out=base.call(this,f,front(f),c);
    if(f&&!f.isPlayer&&!f.remote&&f.weapon?.kind!=='stringer'&&f.alive&&out!==false)onlineAIShot(f,mode,c);
    return out;
  };
  fn.__v95Wrapped=true;window[name]=fn;
}
wrap('fireChargerShot','charger');
wrap('fireChargerShotV60','charger');
wrap('fireStringerShot','stringer');
wrap('fireBladeSlashV60','wiper');

/* Ink color is no longer selectable before a battle. */
try{
  const g=document.getElementById('grp-color'),h=g?.closest('.custom-group');
  if(h)h.style.display='none';
  if(typeof playerConfig!=='undefined')playerConfig.color=0;
  const saved=JSON.parse(localStorage.getItem('splatoonPlayerConfigV2')||'null');
  if(saved&&typeof saved==='object'){saved.color=0;localStorage.setItem('splatoonPlayerConfigV2',JSON.stringify(saved));}
}catch(_){}

function applyTeamColors(){
  try{teamAHex=A;teamBHex=B;}catch(_){}
  try{
    if(typeof playerConfig!=='undefined')playerConfig.color=0;
    for(const f of fs()){
      if(!f?.team)continue;
      const c=f.team==='B'?B:A;
      f.cfg=f.cfg||{};
      if(Number(f.cfg.inkColorHex)!==c){
        f.cfg.inkColorHex=c;
        if(!f.remote&&typeof rebuildFighterModel==='function')try{rebuildFighterModel(f,f.cfg);}catch(_){}
      }
    }
  }catch(_){}
}
try{
  const old=startRangePhase;
  startRangePhase=function(){applyTeamColors();const r=old.apply(this,arguments);applyTeamColors();return r;};
  window.startRangePhase=startRangePhase;
}catch(_){}
try{
  const old=startBattleFromRange;
  startBattleFromRange=function(){applyTeamColors();const r=old.apply(this,arguments);applyTeamColors();return r;};
  window.startBattleFromRange=startBattleFromRange;
}catch(_){}
try{
  const old=window.startOnlineBattle;
  if(typeof old==='function'){
    window.startOnlineBattle=function(m){const r=old.call(this,m);applyTeamColors();return r;};
  }
}catch(_){}
window.__V95_BUILD=BUILD;
console.log('[SPLATOON ONLINE]['+BUILD+'] active');
})();