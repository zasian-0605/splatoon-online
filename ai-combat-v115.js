/* V115: combat-focused CPU AI */
(function(){
'use strict';
const BUILD='V115-COMBAT-FOCUSED-AI-2026-10-02';
const states=new WeakMap();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function getState(f,now){
 let s=states.get(f);
 if(!s){
  s={phase:Math.random()*Math.PI*2,strafe:Math.random()<.5?-1:1,nextDecision:now+300+Math.random()*400,nextShot:now+Math.random()*250,nextSub:now+1800+Math.random()*1800,nextSpecial:now+4000+Math.random()*3000,chargeStart:0,lastPos:f.pos.clone(),lastAt:now,stuck:0};
  states.set(f,s);
 }
 return s;
}
function ownInk(f){try{return !!onFighterInk(f)}catch(_){return false}}
function targetFor(f){
 let best=null,bestScore=Infinity;
 for(const o of (fighters||[])){
  if(!o||o===f||!o.alive||o.team===f.team)continue;
  const d=dist(f.pos,o.pos);
  const score=d+(o.squid_mode?2.5:0)+(o.isPlayer?-4:0);
  if(score<bestScore){bestScore=score;best=o}
 }
 return best;
}
function rangeFor(w){
 switch(w?.category){
  case 'charger':return [17,31];
  case 'spinner':return [10,24];
  case 'roller':return [0,7];
  case 'wiper':return [2.5,9];
  case 'blaster':return [4,13];
  case 'slosher':return [5,15];
  case 'brella':return [3,12];
  case 'maneuver':return [4,15];
  default:return [4,19];
 }
}
function destinationFor(f,s,target,now){
 const role=f.weapon?.category;
 if(!target){
  const sign=f.team==='A'?-1:1;
  return {x:0,z:sign*18};
 }
 const d=dist(f.pos,target.pos);
 const r=rangeFor(f.weapon);
 const ideal=(r[0]+r[1])*.5;
 const dx=target.pos.x-f.pos.x,dz=target.pos.z-f.pos.z;
 const len=Math.hypot(dx,dz)||1;
 const nx=dx/len,nz=dz/len,px=-nz,pz=nx;
 const side=s.strafe||1;

 // Retreat only at genuinely critical HP or nearly empty ink, and only on own ink.
 if((f.hp<=10||f.ink<=4)&&ownInk(f)){
  const homeZ=f.team==='A'?-48:48;
  const hx=0-f.pos.x,hz=homeZ-f.pos.z,hl=Math.hypot(hx,hz)||1;
  return {x:f.pos.x+hx/hl*7,z:f.pos.z+hz/hl*7,retreat:true};
 }

 // Close-range weapons press forward instead of backing away.
 if(role==='roller'||f.weapon?.brush||f.weapon?.name==='パブロ'||f.weapon?.name==='ホクサイ'||f.weapon?.name==='フィンセント'){
  if(d>5)return {x:f.pos.x+nx*4.5+px*2.0*side,z:f.pos.z+nz*4.5+pz*2.0*side};
  return {x:f.pos.x+px*2.3*side,z:f.pos.z+pz*2.3*side};
 }

 // Out of range: chase the enemy.
 if(d>r[1]){
  const lead=Math.min(6.5,Math.max(3.5,d-r[1]+2));
  return {x:f.pos.x+nx*lead+px*1.8*side,z:f.pos.z+nz*lead+pz*1.8*side};
 }

 // Too close: a tiny spacing correction, not a long escape.
 if(d<r[0]){
  const back=Math.min(2.6,r[0]-d+0.8);
  return {x:f.pos.x-nx*back+px*2.4*side,z:f.pos.z-nz*back+pz*2.4*side};
 }

 // Fighting range: strafe while keeping a mild forward bias.
 const correction=clamp((d-ideal)*.55,-1.8,2.8);
 const wave=Math.sin(now*.003+s.phase)*1.2;
 return {x:f.pos.x+nx*correction+px*(2.6*side+wave),z:f.pos.z+nz*correction+pz*(2.6*side+wave)};
}
function moveAI(f,s,destination,delta,squid){
 if(!destination)return false;
 const dx=destination.x-f.pos.x,dz=destination.z-f.pos.z,len=Math.hypot(dx,dz);
 if(len<.06)return false;
 const dir=new THREE.Vector3(dx/len,0,dz/len);
 const speed=(squid?7.8:5.0)*(f.gearProfile?.[squid?'swim':'move']||1);
 const before=f.pos.clone();
 try{tryMoveWithCollision(f,dir.clone().multiplyScalar(speed),delta,squid)}catch(_){}
 if(before.distanceTo(f.pos)>.01){s.stuck=0;return true}
 s.stuck+=delta;
 if(s.stuck>.28){
  s.strafe*=-1;
  const side=dir.clone().applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI*.5*s.strafe);
  try{tryMoveWithCollision(f,side.multiplyScalar(speed*.8),delta,false)}catch(_){}
  s.stuck=0;
 }
 return false;
}
function attackAI(f,target,now,s){
 if(!target||!target.alive)return;
 const dx=target.pos.x-f.pos.x,dz=target.pos.z-f.pos.z,len=Math.hypot(dx,dz)||1;
 const dir=new THREE.Vector3(dx/len,0,dz/len);
 const w=f.weapon||{};
 try{f.human.rotation.y=Math.atan2(dir.x,dir.z);f.root.rotation.y=f.human.rotation.y}catch(_){}
 if(w.category==='charger'){
  if(!s.chargeStart)s.chargeStart=now;
  const need=Math.max(300,(w.chargeTime||800)*.50);
  if(now-s.chargeStart>=need&&now>=s.nextShot){
   const frac=clamp((now-s.chargeStart)/(w.chargeTime||800),.50,1);
   s.nextShot=now+Math.max(600,(w.rate||100)*2.4);
   try{
    if(w.kind==='stringer'&&typeof fireStringerShot==='function')fireStringerShot(f,dir,frac);
    else if(typeof fireChargerShot==='function')fireChargerShot(f,dir,frac);
    else if(typeof fireChargerShotV60==='function')fireChargerShotV60(f,dir,frac);
   }catch(_){}
   s.chargeStart=0;
  }
  return;
 }
 if(w.category==='spinner'){
  if(!s.chargeStart)s.chargeStart=now;
  const need=Math.max(180,(w.chargeTime||650)*.42);
  if(now-s.chargeStart>=need&&now>=s.nextShot){
   const frac=clamp((now-s.chargeStart)/(w.chargeTime||650),.45,1);
   s.nextShot=now+Math.max(650,(w.rate||60)*7);
   try{if(typeof fireSplatlingBurst==='function')fireSplatlingBurst(f,frac,dir);else if(typeof tryShoot==='function')tryShoot(f,dir,now)}catch(_){}
   s.chargeStart=0;
  }
  return;
 }
 if(w.category==='wiper'){
  if(!s.chargeStart)s.chargeStart=now;
  const need=Math.max(220,(w.chargeTime||600)*.45);
  if(now-s.chargeStart>=need&&now>=s.nextShot){
   const frac=clamp((now-s.chargeStart)/(w.chargeTime||600),.4,1);
   s.nextShot=now+650;
   try{if(typeof fireBladeSlashV60==='function')fireBladeSlashV60(f,frac,dir);else if(typeof doWiperSlash==='function')doWiperSlash(f,frac)}catch(_){}
   s.chargeStart=0;
  }
  return;
 }
 if(w.category==='roller'||w.brush||w.name==='パブロ'||w.name==='ホクサイ'||w.name==='フィンセント'){
  if(now>=s.nextShot){
   s.nextShot=now+280;
   try{
    if((w.brush||/パブロ|ホクサイ|フィンセント/.test(w.name||''))&&typeof doBrushAction==='function')doBrushAction(f,now,true);
    else if(typeof performRollerSwing==='function')performRollerSwing(f,now);
   }catch(_){}
  }
  return;
 }
 if(now>=s.nextShot&&typeof tryShoot==='function'){
  s.nextShot=now+Math.max(90,Number(w.rate)||120);
  try{tryShoot(f,dir,now)}catch(_){}
 }
}
function paintAI(f,now,s){
 if(now>=(s.nextPaint||0)&&f.ink>1){
  s.nextPaint=now+260;
  try{
   const dir=new THREE.Vector3(Math.sin(f.root.rotation.y),0,Math.cos(f.root.rotation.y));
   paintGround(f.pos.x,f.pos.z,.85,getFighterInkHex(f),{to:{x:f.pos.x+dir.x*1.3,z:f.pos.z+dir.z*1.3},noNetwork:true});
   f.ink=Math.max(0,f.ink-.8);
  }catch(_){}
 }
}
function updateCombatAI(f,delta,now){
 if(!f||f.isPlayer||f.remote||!f.alive)return;
 const s=getState(f,now),target=targetFor(f);
 if(now>=s.nextDecision){if(Math.random()<.18)s.strafe*=-1;s.nextDecision=now+280+Math.random()*420}
 const dest=destinationFor(f,s,target,now);
 const retreat=!!dest?.retreat;
 const d=target?dist(f.pos,target.pos):Infinity;
 const r=rangeFor(f.weapon);

 // Squid is a travel/refill tool, not the normal combat state.
 const squid=!!(ownInk(f)&&!retreat&&((!target&&d>10)||(target&&d>r[1]+8)||(f.ink<12&&d>10)));
 f.squid_mode=squid;
 f._moving=moveAI(f,s,dest,delta,squid);
 if(squid)f.ink=Math.min(100,f.ink+34*delta);else paintAI(f,now,s);

 if(target&&!f.squid_mode){
  const distance=dist(f.pos,target.pos);
  if(distance<=r[1]+3)attackAI(f,target,now,s);
  if(distance<20&&now>=s.nextSub){
   s.nextSub=now+2800+Math.random()*1800;
   try{
    if(typeof tryThrowSub==='function'){
     const q=new THREE.Vector3(target.pos.x-f.pos.x,0,target.pos.z-f.pos.z);
     if(q.lengthSq()>.001){q.normalize();tryThrowSub(f,q,now)}
    }
   }catch(_){}
  }
  if(f.specialGauge>=100&&now>=s.nextSpecial&&distance<26){
   s.nextSpecial=now+9000+Math.random()*5000;
   try{window.fireSpecial?.(f)}catch(_){}
  }
 }
 if(now-s.lastAt>.55){
  const moved=f.pos.distanceTo(s.lastPos);
  if(moved<.12)s.stuck+=now-s.lastAt;else s.stuck=0;
  s.lastPos.copy(f.pos);s.lastAt=now;
  if(s.stuck>.9){s.strafe*=-1;s.stuck=0}
 }
 try{
  updateFighterAnimation(f,!!f._moving,!!f.squid_mode);
  if(!f.squid_mode&&target){
   const dx=target.pos.x-f.pos.x,dz=target.pos.z-f.pos.z;
   if(Math.hypot(dx,dz)>.05)f.root.rotation.y=Math.atan2(dx,dz);
  }
 }catch(_){}
}
updateAI=updateCombatAI;
window.updateAI=updateCombatAI;
window.__V115_AI_BUILD=BUILD;
console.log('[SPLATOON ONLINE]['+BUILD+'] combat-focused AI active');
})();