/* --- begin ai-combat-v115.js --- */
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
function hasLineOfSight(f,o){
 try{
  const a=f.pos.clone(),b=o.pos.clone();
  a.y+=.85;b.y+=.85;
  if(typeof segmentWall==='function')return !segmentWall(a,b);
  const d=b.clone().sub(a),len=d.length(),steps=Math.max(1,Math.ceil(len/.45));
  for(let i=1;i<steps;i++){
   const p=a.clone().lerp(b,i/steps);
   if(typeof getBlockingWall==='function'&&getBlockingWall(p.x,p.z,p.y))return false;
  }
  return true;
 }catch(_){return true;}
}
function targetFor(f){
 let best=null,bestScore=Infinity;
 for(const o of (fighters||[])){
  if(!o||o===f||!o.alive||o.team===f.team)continue;
  const d=dist(f.pos,o.pos);
  const visible=hasLineOfSight(f,o);
  const score=d+(o.squid_mode?2.5:0)+(o.isPlayer?-4:0)+(visible?0:10);
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
 const dx=target.pos.x-f.pos.x,dz=target.pos.z-f.pos.z;
 const dy=(target.pos.y+.9)-(f.pos.y+1.0);
 const len=Math.hypot(dx,dy,dz)||1;
 const dir=new THREE.Vector3(dx/len,dy/len,dz/len);
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
/* --- end ai-combat-v115.js --- */

/* --- begin gameplay-fixes-v116.js --- */
/* V116: unified gameplay runtime
   - One projectile path for normal shots / chargers / splatlings / legacy callers.
   - Shooter: short straight phase, then gravity.
   - Blaster: no gravity.
   - Charger: straight to range, then vertical drop.
   - After max range, horizontal velocity is reduced to 3/50.
   - Projectile travel paints the actual path; wall hits use face-aware wall paint.
   - Heavy weapon release is routed through the canonical global fire functions.
   - Squid state never starts a heavy weapon charge.
*/
(function(){
  'use strict';
  const BUILD='V124-ONLINE-LAUNCH-PITCH-HP-FULLAUTO-2026-10-03';
  if(window.__V116_UNIFIED_READY)return;
  window.__V116_UNIFIED_READY=true;

  const Y=new THREE.Vector3(0,1,0);
  const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
  const battle=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
  const isSquid=f=>!!f?.isPlayer&&!!f?.squid_mode;

  function aim(f,dir){
    const d=dir?.clone?dir.clone():new THREE.Vector3();
    if(d.lengthSq()<.0001){
      try{camera?.getWorldDirection(d);}catch(_){}
    }
    if(d.lengthSq()<.0001){
      const yaw=num(f?.root?.rotation?.y,0);
      d.set(Math.sin(yaw),0,Math.cos(yaw));
    }
    return d.normalize();
  }

  /* Lower the old upward launch setting by about 10 degrees: canonical +5 degrees.
     Existing camera pitch is preserved, including downward aiming. */
  const CANONICAL_LAUNCH_PITCH_DEG=5;
  function applyLaunchPitch(dir){
    const d=dir.clone().normalize();
    const h=Math.hypot(d.x,d.z);
    if(h<.0001)return d;
    const pitch=Math.atan2(d.y,h)+THREE.MathUtils.degToRad(CANONICAL_LAUNCH_PITCH_DEG);
    const hp=Math.cos(pitch);
    return new THREE.Vector3((d.x/h)*hp,Math.sin(pitch),(d.z/h)*hp).normalize();
  }

  function compensateProjectileDrop(dir,gravity=5.2,speed=35){
    const d=dir.clone();
    /* Counter the short-range ballistic drop while preserving camera pitch. */
    d.y+=Math.max(0,Math.min(.10,Number(gravity)||0)/Math.max(12,Number(speed)||35)*.42);
    return d.normalize();
  }

  function consume(f,cost){
    const c=Math.max(0,num(cost,0));
    if(c<=0)return true;
    try{
      if(typeof window.__V67_V60_CONSUME==='function'){
        const cc=typeof window.__V67_V60_INKCOST==='function'
          ? window.__V67_V60_INKCOST(f,c):c;
        return !!window.__V67_V60_CONSUME(f,cc);
      }
    }catch(_){}
    try{
      if(typeof consumeInk==='function'){
        const cc=typeof inkCost==='function'?inkCost(f,c):c;
        return !!consumeInk(f,cc);
      }
    }catch(_){}
    if(num(f?.ink,0)<c)return false;
    f.ink=num(f.ink,0)-c;
    return true;
  }

  function stagePointIn(x,z){
    try{
      if(typeof marketPointInPolygon==='function')return !!marketPointInPolygon(x,z);
    }catch(_){}
    return Number.isFinite(x)&&Number.isFinite(z)&&x>=-52&&x<=52&&z>=-76&&z<=76;
  }

  function support(x,z,y=50){
    try{return num(getSupportHeight(x,z,y),0);}catch(_){return 0;}
  }

  function wallHit(a,b){
    try{
      if(typeof segmentWall==='function'){
        const h=segmentWall(a,b);
        if(h)return h;
      }
    }catch(_){}
    const dist=a.distanceTo(b),steps=Math.max(1,Math.ceil(dist/.28));
    for(let i=1;i<=steps;i++){
      const p=a.clone().lerp(b,i/steps);
      try{
        const w=getBlockingWall(p.x,p.z,p.y);
        if(w)return {block:w,point:p};
      }catch(_){}
    }
    return null;
  }

  function baseFloorYAt(x,z){
    let floorY=null;
    for(const block of collidableBlocks||[]){
      if(x<block.minX||x>block.maxX||z<block.minZ||z>block.maxZ)continue;
      /* The shared STAGE_SOLID floor is the low solid surface underneath raised blocks. */
      const h=num(block.maxY,0)-num(block.minY,0);
      if(h<=.28 && num(block.maxY,0)<=.30){
        const y=num(block.maxY,0);
        if(floorY===null||y>floorY)floorY=y;
      }
    }
    return floorY;
  }

  function paintBaseFloorBelow(b,p,rr){
    const floorY=baseFloorYAt(p.x,p.z);
    if(floorY===null)return;
    const upper= support(p.x,p.z,Math.max(p.y,50));
    if(upper-floorY<.35)return;
    try{
      paintGround(p.x,p.z,Math.min(1.55,rr*.9),b.colorHex,{
        surfaceY:floorY,
        yHint:floorY+.03,
        team:b.team,
        sourceFighter:b.sourceFighter,
        noNetwork:true
      });
    }catch(_){}
  }

  function paintPathSample(b,p){
    if(!b?.sourceFighter||b.team==null||!p)return;
    const ground=support(p.x,p.z,50);
    const gap=p.y-ground;
    const rr=Math.max(.42,Math.min(2.2,num(b.paintRadius,.8)*.55));

    /* A projectile above a floor/obstacle paints the surface directly below it.
       This is deliberately not limited to a tiny vertical gap: downward shots
       must leave a continuous ink path instead of a few isolated dots. */
    if(Number.isFinite(ground) && p.y>=ground-.12){
      try{
        paintGround(p.x,p.z,rr,b.colorHex,{
          surfaceY:ground,
          yHint:ground+.03,
          team:b.team,
          sourceFighter:b.sourceFighter,
          noNetwork:true
        });
      }catch(_){}
    }

    /* Keep the shared base-floor projection for raised platforms as well. */
    paintBaseFloorBelow(b,p,rr);
  }

  function paintTravel(b,a,p){
    const dist=a.distanceTo(p);
    b.paintAcc=(num(b.paintAcc,0)+Math.hypot(p.x-a.x,p.z-a.z));
    const spacing=b.kind==='charger'?0.60:b.kind==='blaster'?0.85:0.72;
    if(b.paintAcc<spacing)return;
    b.paintAcc=0;
    const steps=Math.max(1,Math.min(10,Math.ceil(dist/0.55)));
    for(let i=0;i<=steps;i++){
      paintPathSample(b,a.clone().lerp(p,i/steps));
    }
  }

  function removeBullet(b,i){
    try{if(b?.mesh?.parent)b.mesh.parent.remove(b.mesh);}catch(_){}
    if(Array.isArray(bullets)&&i>=0)bullets.splice(i,1);
  }

  function impact(b,p,wall){
    if(!b||!p)return;
    if(wall){
      try{
        if(typeof paintWallSurface==='function'){
          paintWallSurface(wall.block,wall.point,b.colorHex,b.team,Math.min(1.55,num(b.paintRadius,1)));
        }
      }catch(_){}
      /* A shot from a raised obstacle also leaves ink on the floor directly below the hit. */
      try{
        paintBaseFloorBelow(b,wall.point,Math.max(.42,Math.min(2.2,num(b.paintRadius,1)*.55)));
      }catch(_){}
      if(b.explosive){
        try{explodeAt(wall.point.clone(),num(b.explosionRadius,0),num(b.splashDamage,0),b.team,{
          paintRadius:num(b.paintRadius,.8),colorHex:b.colorHex,sourceFighter:b.sourceFighter,
          skipParticles:b.kind==='blaster'
        });}catch(_){}
      }
      return;
    }
    const gy=support(p.x,p.z,Math.max(p.y,1));
    const q=p.clone();
    q.y=Math.max(q.y,gy+.03);
    try{
      if(b.explosive){
        explodeAt(q,num(b.explosionRadius,0),num(b.splashDamage,0),b.team,{
          paintRadius:num(b.paintRadius,.8),colorHex:b.colorHex,sourceFighter:b.sourceFighter,
          skipParticles:b.kind==='blaster'
        });
      }else{
        paintGround(q.x,q.z,num(b.paintRadius,.8),b.colorHex,{
          surfaceY:gy,team:b.team,sourceFighter:b.sourceFighter
        });
      }
    }catch(_){}
  }

  function spawnUnified(f,dir,opts={}){
    if(!f?.alive||!f.weapon)return null;
    const w=f.weapon;
    let kind=String(opts.kind||w.category||'shooter');
    const aimed=aim(f,dir);
    const d=opts.exactDirection?aimed:applyLaunchPitch(aimed);
    /* Preserve actual up/down aim while applying the lower upward bias. */
    d.normalize();
    let speed=Math.max(8,num(opts.speed,w.speed||35));
    let range=Math.max(5,num(opts.maxRange,w.range||30));
    let trajectory='delayed';
    let gravity=num(opts.gravity,5.2);
    let straight=Math.min(7.5,range*.28);
    let launchY=num(opts.verticalSpeed,0);

    if(kind==='blaster'||w.category==='blaster'){
      kind='blaster';
      trajectory='blaster';
      gravity=0;
      straight=0;
    }else if(kind==='charger'||w.category==='charger'){
      kind='charger';
      trajectory=w.kind==='stringer'?'stringer':'charger';
      if(trajectory==='charger'){
        gravity=Math.max(10,num(opts.gravity,18));
        straight=range;
      }
    }else if(kind==='slosher'){
      trajectory='arc';
      gravity=num(opts.gravity,10.5);
      straight=0;
      launchY=num(opts.verticalSpeed,7.5+num(w.arc,0)*4);
    }else if(kind==='brella'||kind==='dualies'){
      trajectory='delayed';
      gravity=num(opts.gravity,4.8);
    }else{
      trajectory='delayed';
      gravity=num(opts.gravity,5.2);
    }

    const s=opts.origin?.clone ? opts.origin.clone() : f.pos.clone();
    /* Local shots start 0.55m ahead of the fighter. Online packets already
       contain the authoritative muzzle position, so they pass muzzleForward:0. */
    s.y+=num(opts.yOffset,1.45);
    s.addScaledVector(d,num(opts.muzzleForward,.55));
    const mat=new THREE.MeshBasicMaterial({color:Number(fourHex(f))});
    const mesh=new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(.10,Math.min(.34,num(opts.radius,.13))),8,8),
      mat
    );
    mesh.position.copy(s);
    scene.add(mesh);

    const b={
      __v116Unified:true,
      mesh,
      velocity:d.clone().multiplyScalar(speed),
      verticalSpeed:launchY,
      startPos:s.clone(),
      lastPos:s.clone(),
      travelled:0,
      horizontalTravel:0,
      maxRange:range,
      straightDistance:straight,
      trajectory,
      gravity,
      age:0,
      life:Math.max(.35,num(opts.life,range/Math.max(speed,1)+.5)),
      radius:Math.max(.10,num(opts.radius,.13)),
      paintRadius:Math.max(.3,num(opts.paintRadius,.8)),
      damage:num(opts.damage,w.damage||0),
      team:f.team,
      colorHex:Number(fourHex(f)),
      fromId:f.id,
      sourceFighter:f,
      explosive:!!opts.explosive,
      explosionRadius:num(opts.explosionRadius,0),
      splashDamage:num(opts.splashDamage,0),
      kind,
      paintAcc:0,
      rangeDropped:false,
      chargerDrop:false,
      __v116:false
    };
    bullets.push(b);
    return b;
  }

  function fourHex(f){
    try{
      return typeof getFighterInkHex==='function'
        ? getFighterInkHex(f)
        : (f.team==='B'?0xff2255:0xe3ff00);
    }catch(_){return f?.team==='B'?0xff2255:0xe3ff00;}
  }

  function rsafeOnlineStep(dt,speed){
    return Math.max(.0001,Math.min(.06,num(dt,.016)))*Math.max(8,num(speed,35));
  }

  function updateUnifiedBullets(delta){
    const dt=Math.max(0,Math.min(.06,num(delta,.016)));
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i];
      if(!b?.__v116Unified||!b.mesh){
        continue;
      }
      b.age+=dt;
      const prev=b.mesh.position.clone();

      /* Remote projectile watchdog: never allow a received shot to become a
         stationary sphere because a legacy layer replaced/zeroed its velocity. */
      if(b.__onlineRemote){
        const rs=Math.max(8,num(b.__onlineRemoteSpeed,35));
        const rd=(b.__onlineRemoteDir?.clone?b.__onlineRemoteDir.clone():new THREE.Vector3(0,0,1));
        if(rd.lengthSq()<.0001)rd.set(0,0,1);
        rd.normalize();
        /* Online shots have an extra invariant: their direction is immutable
           for the lifetime of the packet.  Rebuild velocity every frame so an
           older trajectory wrapper cannot leave the remote sphere at rest. */
        if(!b.velocity||typeof b.velocity.lengthSq!=='function'||b.velocity.lengthSq()<.0001){
          b.velocity=rd.clone().multiplyScalar(rs);
        }else{
          const vh=Math.hypot(b.velocity.x,b.velocity.z);
          if(vh<rs*.08)b.velocity.copy(rd).multiplyScalar(rs);
        }
        b.__onlineRemoteDir.copy?.(rd);
      }

      if(b.trajectory==='charger'){
        if(!b.chargerDrop){
          const hSpeed=Math.max(.001,Math.hypot(b.velocity.x,b.velocity.z));
          const move=Math.min(
            hSpeed*dt,
            Math.max(0,b.maxRange-b.horizontalTravel)
          );
          const t=move/hSpeed;
          b.mesh.position.x+=b.velocity.x*t;
          b.mesh.position.y+=b.velocity.y*t;
          b.mesh.position.z+=b.velocity.z*t;
          b.horizontalTravel+=move;
          b.travelled+=move;
          if(b.horizontalTravel>=b.maxRange-.0001){
            b.chargerDrop=true;
            b.velocity.x=0;
            b.velocity.z=0;
            b.velocity.y=0;
          }
        }else{
          b.velocity.y-=b.gravity*dt;
          b.mesh.position.y+=b.velocity.y*dt;
          b.travelled+=Math.abs(b.velocity.y)*dt;
        }
      }else if(b.trajectory==='delayed'){
        const speedXZ=Math.max(.001,Math.hypot(b.velocity.x,b.velocity.z));
        if(b.horizontalTravel<b.straightDistance){
          const move=Math.min(speedXZ*dt,b.straightDistance-b.horizontalTravel);
          const t=move/speedXZ;
          b.mesh.position.addScaledVector(b.velocity,t);
          b.horizontalTravel+=move;
          b.travelled+=move;
        }else{
          b.velocity.y-=b.gravity*dt;
          const drag=Math.max(.86,1-.035*dt);
          b.velocity.x*=drag;b.velocity.z*=drag;
          b.mesh.position.addScaledVector(b.velocity,dt);
          b.horizontalTravel+=speedXZ*dt;
          b.travelled+=speedXZ*dt;
        }
      }else if(b.trajectory==='blaster'){
        b.mesh.position.addScaledVector(b.velocity,dt);
        const dx=b.mesh.position.x-b.startPos.x,dz=b.mesh.position.z-b.startPos.z;
        b.horizontalTravel=Math.hypot(dx,dz);
        b.travelled+=Math.hypot(b.mesh.position.x-prev.x,b.mesh.position.z-prev.z);
      }else if(b.trajectory==='arc'){
        if(!b.__arcStarted){
          b.velocity.y=num(b.verticalSpeed,b.velocity.y);
          b.__arcStarted=true;
        }
        b.velocity.y-=b.gravity*dt;
        b.mesh.position.addScaledVector(b.velocity,dt);
        b.horizontalTravel+=Math.hypot(b.mesh.position.x-prev.x,b.mesh.position.z-prev.z);
        b.travelled+=b.mesh.position.distanceTo(prev);
      }else{
        b.velocity.y-=b.gravity*dt;
        b.mesh.position.addScaledVector(b.velocity,dt);
        b.horizontalTravel+=Math.hypot(b.mesh.position.x-prev.x,b.mesh.position.z-prev.z);
        b.travelled+=Math.hypot(b.mesh.position.x-prev.x,b.mesh.position.z-prev.z);
      }

      /* Collision must be resolved before path painting. Otherwise a fast
         projectile can paint through a wall during the same frame in which
         wallHit() discovers the collision. */
      /* Final anti-stall guard for online shots.  If another legacy
         layer has touched the mesh/velocity before the next frame, a received
         projectile must still advance by its authoritative direction. */
      if(b.__onlineRemote && b.mesh.position.distanceTo(prev)<.000001){
        const rd=(b.__onlineRemoteDir?.clone?b.__onlineRemoteDir.clone():new THREE.Vector3(0,0,1));
        if(rd.lengthSq()<.0001)rd.set(0,0,1);
        rd.normalize();
        b.mesh.position.addScaledVector(rd,rsafeOnlineStep(dt,b.__onlineRemoteSpeed));
        b.travelled+=rsafeOnlineStep(dt,b.__onlineRemoteSpeed);
        b.horizontalTravel+=Math.hypot(rd.x,rd.z)*rsafeOnlineStep(dt,b.__onlineRemoteSpeed);
      }

      const wh=wallHit(prev,b.mesh.position);
      if(wh){
        impact(b,wh.point.clone(),wh);
        removeBullet(b,i);
        continue;
      }

      let hit=null,hitPoint=null;
      const seg=b.mesh.position.clone().sub(prev);
      const den=Math.max(.0001,seg.lengthSq());
      for(const f of fighters||[]){
        if(!f?.alive||f.team===b.team||f.id===b.fromId)continue;
        const target=f.pos.clone();target.y+=.9;
        const t=Math.max(0,Math.min(1,target.clone().sub(prev).dot(seg)/den));
        const q=prev.clone().addScaledVector(seg,t);
        if(q.distanceTo(target)<=b.radius+.55){
          hit=f;hitPoint=q;break;
        }
      }
      if(hit){
        paintTravel(b,prev,hitPoint);
        if(b.__onlineRemote){
          /* Online HP changes come from the server damage packet. */
          removeBullet(b,i);
          continue;
        }
        if(b.explosive){
          try{explodeAt(hitPoint.clone(),num(b.explosionRadius,0),num(b.splashDamage,0),b.team,{
            paintRadius:num(b.paintRadius,.8),colorHex:b.colorHex,sourceFighter:b.sourceFighter,
            skipParticles:b.kind==='blaster'
          });}catch(_){}
          try{applyDamage(hit,Math.max(0,b.damage-b.splashDamage),b.sourceFighter);}catch(_){}
        }else{
          try{applyDamage(hit,b.damage,b.sourceFighter);}catch(_){}
        }
        removeBullet(b,i);
        continue;
      }

      paintTravel(b,prev,b.mesh.position);

      if(b.horizontalTravel>=b.maxRange&&!b.rangeDropped){
        b.rangeDropped=true;
        if(b.trajectory==='charger'){
          /* Charger: straight flight ends exactly at max range, then vertical drop. */
          b.chargerDrop=true;
          b.velocity.x=0;
          b.velocity.z=0;
          b.velocity.y=0;
        }else if(b.trajectory==='blaster'){
          /* Blaster: max range is the explosion point, never a silent shrink/despawn. */
          impact(b,b.mesh.position.clone(),null);
          removeBullet(b,i);
          continue;
        }else{
          b.velocity.x*=3/50;
          b.velocity.z*=3/50;
          b.life=Math.max(b.life,b.age+.38);
        }
      }

      const ground=support(b.mesh.position.x,b.mesh.position.z,Math.max(b.mesh.position.y,1));
      const onGround=b.mesh.position.y<=ground+.02&&b.velocity.y<=0;
      if(onGround){
        impact(b,b.mesh.position.clone(),null);
        removeBullet(b,i);
        continue;
      }
      if(b.age>b.life){
        const p=b.mesh.position.clone();
        /* Never silently delete a projectile: blasters in particular must
           resolve their explosion even if the endpoint is just outside the
           stage polygon. */
        impact(b,p,null);
        removeBullet(b,i);
      }
    }
  }

  function fireBasic(f,dir,now){
    if(!f?.alive||isSquid(f)||!battle())return false;
    const w=f.weapon;if(!w)return false;
    if(['charger','roller','spinner','wiper'].includes(w.category)||w.brush)return false;
    const t=num(now,performance.now());
    const weaponRate=Math.max(
      1,
      num(w.rate,100)
    );
    /* Separate canonical cooldown from legacy lastShot writes. */
    const nextAt=num(f.__canonicalNextShotAt,0);
    if(t<nextAt)return false;
    if(t-num(f.lastShot,0)<weaponRate)return false;
    const baseCost=Math.max(.1,num(w.inkCost,1));
    const base=aim(f,dir);
    let fired=0;
    const emit=(d,o)=>{if(spawnUnified(f,d,o))fired++;};

    if(w.category==='blaster'){
      emit(base,{kind:'blaster',speed:num(w.speed,24),damage:num(w.damage,70),gravity:0,
        radius:.22,paintRadius:num(w.paintRadius,1.35),life:2.0,
        maxRange:num(w.range,23),explosive:true,explosionRadius:num(w.explosionRadius,2.5),
        splashDamage:num(w.splashDamage,35)});
    }else if(w.category==='slosher'){
      const count=w.name==='ヒッセン'?3:w.name==='オーバーフロッシャー'?4:1;
      for(let i=0;i<count;i++){
        const d=count>1?base.clone().applyAxisAngle(Y,(i-(count-1)/2)*.12):base.clone();
        emit(d,{kind:'slosher',speed:num(w.speed,18),damage:num(w.damage,60),gravity:10.5,
          radius:.28,paintRadius:num(w.paintRadius,1.4),life:1.35,maxRange:num(w.range,18)});
      }
    }else if(w.category==='maneuver'){
      for(const side of [-1,1]){
        emit(base.clone().applyAxisAngle(Y,side*num(w.spread,.05)),{
          kind:'dualies',speed:num(w.speed,35),damage:num(w.damage,20),gravity:4.8,
          radius:.14,paintRadius:num(w.paintRadius,.8),life:1.25,maxRange:num(w.range,30)
        });
      }
    }else if(w.category==='brella'){
      const pellets=Math.max(3,Math.min(8,Math.floor(num(w.pellets,5))));
      for(let i=0;i<pellets;i++){
        emit(base.clone().applyAxisAngle(Y,(i-(pellets-1)/2)*num(w.spread,.055)),{
          kind:'brella',speed:num(w.speed,30),damage:num(w.damage,18),gravity:4.8,
          radius:.13,paintRadius:num(w.paintRadius,.75),life:1.2,maxRange:num(w.range,20)
        });
      }
    }else{
      const count=Math.max(1,Math.min(3,Math.floor(num(w.burst,1))));
      for(let i=0;i<count;i++){
        emit(count===1?base:base.clone().applyAxisAngle(Y,(i-(count-1)/2)*.028),{
          kind:'shooter',speed:num(w.speed,35),damage:num(w.damage,30),gravity:5.2,
          radius:.14,paintRadius:num(w.paintRadius,.9),life:1.55,maxRange:num(w.range,30)
        });
      }
    }
    if(fired>0){
      if(!consume(f,baseCost))return false;
      f.lastShot=t;
      f.__canonicalNextShotAt=t+weaponRate;
      f.specialGauge=Math.min(100,num(f.specialGauge,0)+.7*fired*(f.gearProfile?.specialGain||1));
      try{sfx('shoot');}catch(_){}
      if(f.isPlayer&&onlineActive&&onlineStarted){
        try{
          /* Online/server shots must use the same small upward launch bias as
             the local projectile. Otherwise the remote/server trajectory starts
             from the raw camera direction and gravity makes it hit the floor. */
          const netBase=applyLaunchPitch(base);
          const sent=window.__v93SendShot?.({
            x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,dx:netBase.x,dy:netBase.y,dz:netBase.z,
            weaponId:f.weapon.id,mode:w.category
          });
          if(sent===false)console.warn('[ONLINE SHOT TX FAILED]',{
            readyState:window.onlineSocket?.readyState,
            room:window.onlineRoomId
          });
        }catch(err){
          try{console.warn('[ONLINE SHOT TX ERROR]',String(err));}catch(_){}
        }
      }
    }
    return fired>0;
  }

  function fireCharger(f,dir,frac){
    if(!f?.alive||isSquid(f)||!battle()||f.weapon?.category!=='charger')return false;
    const w=f.weapon,q=Math.max(.05,Math.min(1,num(frac,0)));
    try{f.isCharging=false;f.chargeStart=0;}catch(_){}
    /* Canonical charger release: one shot per release, with a small post-shot
       lock so legacy input loops cannot create an infinite stream. */
    const nowShot=performance.now();
    if(nowShot<num(f.__canonicalHeavyNextAt,0))return false;
    /* V117: client and server use the same authoritative charge cost. */
    const cost=num(w.inkCost,8)*(.55+.90*q);
    if(!consume(f,cost))return false;
    const d=aim(f,dir);
    if(w.kind==='stringer'){
      const nArrows=Math.max(3,Math.min(5,Math.floor(num(w.arrows,3))));
      for(let i=0;i<nArrows;i++){
        const dd=d.clone().applyAxisAngle(Y,(i-(nArrows-1)/2)*(.07+(1-q)*.05));
        spawnUnified(f,dd,{kind:'charger',speed:num(w.speedShot,50)*(.75+.25*q),
          damage:num(w.tapDamage,20)+(num(w.fullDamage,80)-num(w.tapDamage,20))*q,
          gravity:14,radius:.13,paintRadius:num(w.paintRadius,.8),life:2.0,maxRange:num(w.range,45)});
      }
    }else{
      spawnUnified(f,d,{kind:'charger',speed:num(w.speedShot,85),gravity:18,radius:.12,
        damage:num(w.tapDamage,30)+(num(w.fullDamage,120)-num(w.tapDamage,30))*q,
        paintRadius:num(w.paintRadius,1.0),life:2.0,maxRange:num(w.range,55)});
    }
    f.specialGauge=Math.min(100,num(f.specialGauge,0)+7+7*q);
    f.__canonicalHeavyNextAt=nowShot+180;
    try{sfx('shoot');}catch(_){}
    if(f.isPlayer&&onlineActive&&onlineStarted){
      try{
        const netD=applyLaunchPitch(d);
        window.__v93SendShot?.({
          x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,
          dx:netD.x,dy:netD.y,dz:netD.z,weaponId:f.weapon.id,mode:w.kind==='stringer'?'stringer':'charger',charge:q
        });
      }catch(_){}
    }
    return true;
  }

  function fireSplatling(f,chargeFrac,aimOverride){
    if(!f?.alive||isSquid(f)||!battle()||f.weapon?.category!=='spinner')return false;
    const w=f.weapon,q=Math.max(.05,Math.min(1,num(chargeFrac,0)));
    const desired=Math.max(
      Math.floor(num(w.minShots,6)),
      Math.round(num(w.maxShots,w.burstShots||12)*q)
    );
    const base=aim(f,aimOverride);
    const per=Math.max(.1,num(w.inkCost,1.3));
    let fired=0;
    for(let i=0;i<desired;i++){
      const d=base.clone().applyAxisAngle(Y,(Math.random()-.5)*num(w.spread,.02)*1.5);
      const delay=i*Math.max(0,num(w.rate,55));
      setTimeout(()=>{
        if(!f?.alive||isSquid(f))return;
        if(!consume(f,per))return;
        spawnUnified(f,d,{kind:'splatling',speed:num(w.speed,43),damage:num(w.damage,29),
          gravity:5.2,drag:.035,radius:.13,paintRadius:num(w.paintRadius,.6),
          life:1.35,maxRange:num(w.range,30)});
        if(f.isPlayer&&onlineActive&&onlineStarted){
          try{
            const netD=applyLaunchPitch(d);
            window.__v93SendShot?.({
              x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,
              dx:netD.x,dy:netD.y,dz:netD.z,weaponId:f.weapon.id,
              mode:'splatling',charge:q,burstShots:1
            });
          }catch(_){}
        }
      },delay);
      fired++;
    }
    return fired>0;
  }

  function directPlayerShot(){
    const f=playerFighter;
    if(!f?.alive||!battle()||isSquid(f))return false;
    const d=new THREE.Vector3();
    try{camera.getWorldDirection(d);}catch(_){}
    return fireBasic(f,d,performance.now());
  }

  // Canonical projectile generation.
  window.__spawnBulletV60=spawnUnified;
  try{spawnBulletV60=spawnUnified;}catch(_){}
  try{window.spawnBulletV60=spawnUnified;}catch(_){}
  try{spawnBullet=spawnUnified;}catch(_){}
  window.spawnBullet=spawnUnified;

  // Canonical firing paths.
  window.tryShoot=fireBasic;
  try{tryShoot=fireBasic;}catch(_){}
  window.fireChargerShot=fireCharger;
  try{fireChargerShot=fireCharger;}catch(_){}
  window.fireChargerShotV60=fireCharger;
  try{fireChargerShotV60=fireCharger;}catch(_){}
  window.fireStringerShot=fireCharger;
  try{fireStringerShot=fireCharger;}catch(_){}
  window.fireSplatlingBurst=fireSplatling;
  try{fireSplatlingBurst=fireSplatling;}catch(_){}
  window.__V67_SIMPLE_SAFE_SHOT=fireBasic;
  window.__V67_DIRECT_SHOOT=directPlayerShot;
  window.directPlayerShot=directPlayerShot;
  try{directPlayerShot=directPlayerShot;}catch(_){}

  // The last updateBullets in the file is now this unified updater.
  window.updateBullets=updateUnifiedBullets;
  try{updateBullets=updateUnifiedBullets;}catch(_){}
  /* Immutable public reference for the game loop. Later legacy code may
     replace window.updateBullets, but projectile simulation stays unified. */
  window.__canonicalProjectileUpdater=updateUnifiedBullets;

  // Heavy release in V112 is redirected to these canonical globals.
  window.__V116_HEAVY_RELEASE=(f,kind,q,dir)=>{
    if(kind==='charger')return fireCharger(f,dir,q);
    if(kind==='spinner')return fireSplatling(f,q,dir);
    return false;
  };

  // V112 input must never initiate charging while squid.
  // This IIFE cannot directly reference V117's charger functions: they live in
  // a different function scope. Use deferred window bridges instead so V116
  // initialization never aborts with ReferenceError.
  const oldStartHeavy=window.__V112_START_HEAVY;
  window.__V119_CHARGER_UNIFIED=true;
  window.__V119_CHARGER_CONTROLLER={
    start:(...args)=>window.__V119_START_CANONICAL?.(...args)||false,
    release:(...args)=>window.__V119_RELEASE_CANONICAL?.(...args)||false,
    cancel:()=>window.__V119_RELEASE_CANONICAL?.(true)||false
  };

  /* V116 is the single projectile updater. */
  window.updateBullets=updateUnifiedBullets;
  try{updateBullets=updateUnifiedBullets;}catch(_){}
  window.__V116_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] unified projectile runtime active');
})();

/* =========================================================
   V117 FINAL: canonical runtime/input arbiter
   - V116 remains the single projectile movement path.
   - V117 only owns online shot reception and input arbitration.
   ========================================================= */
(function(){
  'use strict';
  if(window.__V117_CANONICAL_RUNTIME)return;
  const battle=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
  const excluded=e=>{
    const t=e?.target;
    return !!t?.closest?.('#minimap,#fullmap,#online-panel,#result-screen,#v65-gear-panel,#v113-radio-next,.mobile-btn,#gear-panel,#ranking-panel');
  };
  const player=()=>{try{if(typeof playerFighter!=='undefined'&&playerFighter)return playerFighter;}catch(_){}return window.playerFighter||null;};
  const numV117=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
  const canonicalProjectileSpawner=window.__spawnBulletV60||window.spawnBulletV60||window.spawnBullet;
  /* Restored V117 canonical remote-shot bridge.  The previous cleanup accidentally
     removed these declarations while deleting the obsolete per-frame fallback. */
  const YV117=new THREE.Vector3(0,1,0);
  function spawnRemoteBullet(f,dir,opts={}){
    const fn=canonicalProjectileSpawner;
    if(typeof fn!=='function')throw new Error('canonical projectile spawner unavailable');
    const d=(dir?.clone?dir.clone():new THREE.Vector3(0,0,1));
    if(d.lengthSq()<.0001)d.set(0,0,1);
    d.normalize();
    const b=fn(f,d,opts);
    if(!b)return null;
    const speed=Math.max(8,numV117(opts.speed,35));
    b.__onlineRemote=true;
    b.__onlineRemoteDir=d.clone();
    b.__onlineRemoteSpeed=speed;
    b.__onlineRemoteOwner='V118';
    if(!b.velocity||typeof b.velocity.lengthSq!=='function'||b.velocity.lengthSq()<.0001){
      b.velocity=d.clone().multiplyScalar(speed);
    }else{
      b.velocity.copy(d).multiplyScalar(speed);
    }
    b.age=0;
    if(b.mesh){
      b.lastPos=b.mesh.position.clone();
      if(b.startPos)b.startPos=b.mesh.position.clone();
    }
    return b;
  }

  const aimDir=f=>{
    const d=new THREE.Vector3();
    try{camera?.getWorldDirection(d);}catch(_){}
    if(d.lengthSq()<.0001){
      const y=Number(f?.root?.rotation?.y)||0;
      d.set(Math.sin(y),0,Math.cos(y));
    }
    return d.normalize();
  };

  function exitSquidForAction(f,reason){
    if(!f?.isPlayer||!f.squid_mode)return;
    try{window.__V66_BREAK_SQUID_FOR_ACTION?.(reason);}catch(_){}
    /* Keep input responsive if an older form handler failed to update visuals. */
    if(f.squid_mode){
      f.squid_mode=false;
      f._neutralSquid=false;
      try{keys.shift=false;}catch(_){}
      try{window.__V66_SET_SQUID_VISUAL?.(f,false);}catch(_){}
      try{f.human.visible=true;if(f.squid)f.squid.visible=false;}catch(_){}
    }
  }

  /* ---------- Canonical remote ranged-shot receiver ----------
     V117 hardening: never allow the remote-shot receiver to re-enter itself. */
  const legacyReceive=window.__receiveOnlineShotV60;
  let receivingRemoteShot=false;
  function receiveRemoteShotCanonical(m){
    if(receivingRemoteShot){
      try{console.warn('[V117 remote shot] recursive receiver call blocked');}catch(_){}
      return false;
    }
    receivingRemoteShot=true;
    try{
      const wid=Number(m?.weaponId)||0;
      const wp=weaponList[wid]||weaponList[0];
      let rf=(fighters||[]).find(x=>String(x?.id)===String(m?.id));
      if(!rf&&typeof ensureRemoteFighter==='function'){
        rf=ensureRemoteFighter({
          id:m.id,team:m.team,weaponId:wp?.id,
          spawn:{x:Number(m.x)||0,z:Number(m.z)||0},
          config:{weapon:wp?.id}
        });
      }
      if(!rf||!wp){
        try{console.warn('[ONLINE SHOT RX REJECT] missing fighter/weapon',String(m?.id||''),Number(m?.weaponId));}catch(_){}
        return false;
      }

      /* A shot packet is authoritative evidence that the server accepted an
         alive player's shot. State packets can arrive slightly later, so do
         not silently discard the projectile just because alive has not synced. */
      rf.alive=true;
      if(!(Number(rf.hp)>0))rf.hp=rf.maxHp||100;
      rf.weapon=wp;
      const d=new THREE.Vector3(
        Number(m.dx)||0,Number(m.dy)||0,Number(m.dz)||0
      );
      if(d.lengthSq()<.0001)return;
      d.normalize();
      const shotOrigin=new THREE.Vector3(
        Number.isFinite(Number(m.x))?Number(m.x):rf.pos.x,
        Number.isFinite(Number(m.y))?Number(m.y):rf.pos.y,
        Number.isFinite(Number(m.z))?Number(m.z):rf.pos.z
      );
      const spawnAtShot=(dir,opts={})=>spawnRemoteBullet(
        rf,dir,Object.assign({origin:shotOrigin,yOffset:0,muzzleForward:0,exactDirection:true},opts)
      );
      const mode=String(m.mode||'');
      const charge=Math.max(0,Math.min(1,Number.isFinite(Number(m.charge))?Number(m.charge):1));

      /* Preserve legacy special-only and melee presentation paths. */
      const legacyModes=new Set([
        'trizooka','crab','inkjet','ultra-stamp','kraken',
        'rollerFlick','roller-flick','roller-roll','brushFlick','wiperSlash'
      ]);
      if(legacyModes.has(mode) || wp.category==='roller' || wp.category==='wiper' || wp.brush){
        return legacyReceive?.(m);
      }

      /* Server-authoritative projectile parameters. Older servers without
         this object still get the same canonical fallback values. */
      const ps=Object.assign({
        kind:wp.category==='maneuver'?'dualies':wp.category,
        trajectory:wp.category==='slosher'?'arc':'delayed',
        speed:numV117(wp.speed,35),
        maxRange:numV117(wp.range,30),
        straightDistance:wp.category==='slosher'?0:Math.min(7.5,numV117(wp.range,30)*.28),
        gravity:wp.category==='slosher'?10.5:(wp.category==='maneuver'?4.8:5.2),
        verticalSpeed:wp.category==='slosher'?7.5:0,
        radius:wp.category==='slosher'?.28:.14,
        paintRadius:numV117(wp.paintRadius,.9),
        life:numV117(wp.life,1.5),
        damage:numV117(wp.damage,30),
        count:wp.category==='maneuver'?2:1,
        spread:wp.category==='maneuver'?numV117(wp.spread,.055):0,
        explosive:wp.category==='slosher',
        explosionRadius:wp.category==='slosher'?numV117(wp.explosionRadius,2.4):0,
        splashDamage:wp.category==='slosher'?numV117(wp.damage,70):0
      },m.projectile&&typeof m.projectile==='object'?m.projectile:{});

      const makeOpts=extra=>Object.assign({
        kind:ps.kind,
        speed:numV117(ps.speed,35),
        gravity:numV117(ps.gravity,5.2),
        radius:numV117(ps.radius,.14),
        paintRadius:numV117(ps.paintRadius,.9),
        life:numV117(ps.life,1.5),
        maxRange:numV117(ps.maxRange,30),
        straightDistance:numV117(ps.straightDistance,0),
        verticalSpeed:numV117(ps.verticalSpeed,0),
        exactDirection:true,
        explosive:!!ps.explosive,
        explosionRadius:numV117(ps.explosionRadius,0),
        splashDamage:numV117(ps.splashDamage,0)
      },extra||{});

      if(wp.category==='slosher'){
        const count=Math.max(1,Math.min(4,Math.floor(numV117(ps.count,1))));
        for(let i=0;i<count;i++){
          const dd=count>1
            ? d.clone().applyAxisAngle(YV117,(i-(count-1)/2)*numV117(ps.spread,.055))
            : d.clone();
          spawnAtShot(dd,makeOpts({kind:'slosher'}));
        }
        return true;
      }

      if(wp.category==='maneuver'){
        const count=Math.max(1,Math.min(2,Math.floor(numV117(ps.count,2))));
        for(let i=0;i<count;i++){
          const dd=count>1
            ? d.clone().applyAxisAngle(YV117,(i-(count-1)/2)*numV117(ps.spread,.055))
            : d.clone();
          spawnAtShot(dd,makeOpts({kind:'dualies'}));
        }
        return true;
      }

      /* Ordinary shooter. The three currently playable online weapons use
         this canonical branch; unsupported legacy modes are handled above. */
      const spawned=spawnAtShot(d,makeOpts({kind:'shooter'}));
      if(!spawned){
        try{console.warn('[ONLINE SHOT RX SPAWN FAILED]',{
          id:m?.id,weaponId:m?.weaponId,alive:rf?.alive,team:rf?.team,
          origin:[shotOrigin.x,shotOrigin.y,shotOrigin.z],
          dir:[d.x,d.y,d.z]
        });}catch(_){}
        return false;
      }
      return true;
    }catch(err){
      try{console.warn('[V117 remote shot]',err);}catch(_){}
      return false;
    }finally{
      receivingRemoteShot=false;
    }
  }
  window.__receiveOnlineShotV60=receiveRemoteShotCanonical;
  /* Immutable bridge: later legacy/V82 layers may replace the public hook,
     but online ranged shots must always reach the canonical moving projectile. */
  window.__receiveOnlineShotCanonicalV117=receiveRemoteShotCanonical;

  /* ---------- Single desktop input path ---------- */
  let heavy=null;
  let chargerInput=null;
  let suppressMouseUntil=0;
  let canonicalMouseHeld=false;

  function clearLegacyHeavyFlags(f){
    if(!f)return;
    f.isCharging=false;
    f.spinnerCharging=false;
    f.spinnerFiring=false;
    f._v60ChargeStart=0;
    f.spinnerChargeStart=0;
    f._v60BladeChargeStart=0;
    f.wiperChargeStart=0;
    const gauge=document.getElementById('charge-gauge');
    if(gauge)gauge.style.display='none';
  }

  /* ==========================================================
     V119: ONE AUTHORITATIVE CHARGER CONTROLLER
     Input -> charge state -> release -> fireCharger -> spawnUnified.
     No older charger handler is allowed to participate.
     ========================================================== */
  function updateCanonicalChargerGauge(frac){
    const g=document.getElementById('charge-gauge');
    if(g){
      const pct=Math.round(Math.max(0,Math.min(1,Number(frac)||0))*100);
      /* Do not depend on player-runtime.css: the canonical charger owns
         the charge ring completely so it cannot become a 22px/faint dot. */
      g.style.display='block';
      g.style.visibility='visible';
      g.style.opacity='1';
      g.style.width='74px';
      g.style.height='74px';
      g.style.border='3px solid rgba(255,255,255,.9)';
      g.style.zIndex='1000';
      g.style.setProperty('--pct',String(pct));
    }
    const bu=document.getElementById('battle-ui');
    if(bu)bu.style.display='block';
    const ret=document.getElementById('reticle');
    if(ret)ret.style.display='block';
    try{document.documentElement.classList.add('charger-charging');}catch(_){}
  }
  function hideCanonicalChargerGauge(){
    const g=document.getElementById('charge-gauge');
    if(g){
      g.style.display='none';
      g.style.visibility='';
      g.style.opacity='';
      g.style.width='';
      g.style.height='';
      g.style.border='';
      g.style.zIndex='';
    }
    try{document.documentElement.classList.remove('charger-charging');}catch(_){}
  }

  /* Export the canonical charger functions only after this IIFE's
     declarations exist. Earlier versions tried to reference them from V116,
     which caused the line-909 ReferenceError during script initialization. */
  window.__V119_START_CANONICAL=startCanonicalCharger;
  window.__V119_RELEASE_CANONICAL=releaseCanonicalCharger;

  function startCanonicalCharger(pointerId,source='mouse'){
    const f=player();
    if(!f?.alive||!battle()||f.weapon?.category!=='charger')return false;
    if(f.squid_mode)return false;
    if(chargerInput)return false;

    const start=performance.now();
    chargerInput={pointerId,source,start,target:f};
    f.__v119ChargerChargeStart=start;
    f.__v119ChargerCharge=true;
    f.isCharging=true;               // visual/legacy compatibility only
    f.chargeStart=start;             // HUD compatibility only
    isShooting=false;
    updateCanonicalChargerGauge(0);
    return true;
  }

  function chargerFrac(st){
    const f=st?.target,w=f?.weapon;
    const ms=Math.max(120,numV117(w?.chargeTime,900));
    return Math.max(0,Math.min(1,
      (performance.now()-numV117(st?.start,performance.now()))/ms
    ));
  }

  function releaseCanonicalCharger(aborted=false){
    const st=chargerInput;
    chargerInput=null;
    const f=st?.target||player();
    if(f){
      f.__v119ChargerCharge=false;
      f.__v119ChargerChargeStart=0;
      f.isCharging=false;
      f.chargeStart=0;
    }
    hideCanonicalChargerGauge();
    if(!st||aborted||!f?.alive)return false;

    const elapsed=Math.max(0,performance.now()-st.start);
    if(elapsed<60)return false;

    const q=chargerFrac(st);
    const now=performance.now();
    if(now<numV117(f.__canonicalHeavyNextAt,0))return false;

    let ok=false;
    try{
      /*
       * V119 charger fix:
       * V117's controller is in a separate IIFE scope from V116's fireCharger().
       * Calling fireCharger() by bare identifier here can throw ReferenceError,
       * so the release MUST cross the public canonical bridge.
       */
      ok=!!window.__V116_HEAVY_RELEASE?.(f,'charger',q,aimDir(f));
    }catch(err){
      try{console.warn('[canonical charger release]',err);}catch(_){}
      ok=false;
    }
    if(ok)f.__canonicalHeavyNextAt=performance.now()+220;
    return ok;
  }

  function releaseHeavy(abort=false){
    const st=heavy;
    heavy=null;
    if(window.__V119_CHARGER_UNIFIED&&st?.kind==='charger'){
      clearLegacyHeavyFlags(st.target||player());
      return false;
    }
    const f=player();
    const gauge=document.getElementById('charge-gauge');
    if(gauge)gauge.style.display='none';
    if(!st){
      clearLegacyHeavyFlags(f);
      return;
    }

    /* Always clear the local/legacy charge flags first.
       A missed pointerup/pointercancel must never leave the weapon locked. */
    clearLegacyHeavyFlags(f);

    if(!f?.alive||abort)return;
    const elapsed=Math.max(0,performance.now()-st.start);
    const chargeTime=Math.max(120,Number(st.time)||800);
    /* A heavy weapon must have a real charge period; accidental micro-clicks
       no longer become full/rapid shots. */
    if(elapsed<60)return;
    const heavyCooldown=numV117(f?.__canonicalHeavyNextAt,0);
    if(performance.now()<heavyCooldown)return;
    const frac=Math.max(0,Math.min(1,elapsed/chargeTime));
    const d=aimDir(f);
    try{
      if(st.kind==='charger'){
        window.__V116_HEAVY_RELEASE?.(f,'charger',frac,d);
        f.__canonicalHeavyNextAt=performance.now()+180;
      }else if(st.kind==='spinner'){
        window.__V116_HEAVY_RELEASE?.(f,'spinner',frac,d);
      }else if(st.kind==='wiper'&&typeof fireBladeSlashV60==='function'){
        fireBladeSlashV60(f,frac,d);
      }
    }catch(err){
      try{console.warn('[V117 heavy release]',err);}catch(_){}
    }finally{
      clearLegacyHeavyFlags(f);
    }
  }

  function beginDesktop(e){
    if(e.pointerType==='touch')return;
    if(!battle()||excluded(e))return;
    const f=player();
    if(!f?.alive)return;

    if(e.type==='mousedown'&&e.button!==0&&e.button!==2)return;
    if(e.type==='pointerdown'&&e.button!==0){
      if(e.button===2){e.preventDefault();e.stopImmediatePropagation();}
      return;
    }

    e.stopImmediatePropagation();

    if(e.button===2){
      e.preventDefault();
      exitSquidForAction(f,'sub');
      try{doPlayerSubThrow();}catch(_){}
      return;
    }

    if(f.squid_mode){
      exitSquidForAction(f,'shoot');
    }

    const w=f.weapon||{};
    /* V120: normal weapons fire immediately on the primary pointer event.
       The same physical click may also generate mousedown, but fireBasic's
       canonical cooldown rejects that duplicate. This removes the browser-
       dependent pointerdown -> mousedown gap that could make all shots vanish. */
    if(e.type==='pointerdown' &&
       w.category!=='charger'&&w.category!=='spinner'&&w.category!=='wiper'&&w.category!=='roller'){
      canonicalMouseHeld=true;
      try{window.directPlayerShot?.();}catch(err){
        try{console.warn('[V120 pointer shot]',err);}catch(_){}
      }
      isShooting=true;
      return;
    }
    if(w.category==='charger'){
      if(chargerInput)return;
      e.preventDefault();
      try{e.target?.setPointerCapture?.(e.pointerId);}catch(_){}
      startCanonicalCharger(e.type==='pointerdown'?e.pointerId:'mouse',
        e.pointerType==='mouse'?'mouse':'desktop');
      return;
    }
    if(w.category==='spinner'||w.category==='wiper'){
      if(heavy){
        if(heavy.kind===w.category)return;
        heavy=null;
        clearLegacyHeavyFlags(f);
      }
      const kind=w.category;
      heavy={kind,start:performance.now(),time:Number(w.chargeTime)||800};
      f.isCharging=true;
      f.chargeStart=heavy.start;
      if(kind==='spinner'){
        f.spinnerCharging=true;
        f._v60ChargeStart=heavy.start;
        f.spinnerChargeStart=heavy.start;
      }
      if(kind==='wiper')f._v60BladeChargeStart=heavy.start;
      updateCanonicalChargerGauge(0);
      return;
    }

    /*
     * Canonical roller input:
     * - short press/release = one horizontal flick
     * - hold = continuous ground roll
     * - jump + short press = vertical flick
     * Keep one state producer so pointerdown/mousedown cannot double-start it.
     */
    if(w.category==='roller'){
      e.preventDefault();
      e.stopImmediatePropagation();
      try{e.target?.setPointerCapture?.(e.pointerId);}catch(_){}
      const n=performance.now();
      if(!f.__rollerInput){
        f.__rollerInput={
          pointerId:e.type==='pointerdown'?e.pointerId:'mouse',
          source:e.pointerType==='touch'?'touch':'mouse',
          start:n,lastPaintAt:0,lastPos:f.pos.clone()
        };
        f.__rollerLastRollAt=0;
      }
      isShooting=true;
      return;
    }

    canonicalMouseHeld=true;
    try{window.directPlayerShot?.();}catch(_){}
    isShooting=true;
  }

  function endDesktop(e){
    if(e.pointerType==='touch')return;
    if(e.type==='mouseup'&&e.button!==0)return;
    if(e.type==='pointerup'&&e.button!==0)return;
    if(!battle()&& !heavy){canonicalMouseHeld=false;return;}
    e.stopImmediatePropagation();
    if(chargerInput){
      e.preventDefault();
      releaseCanonicalCharger(false);
    }else if(heavy){
      e.preventDefault();
      releaseHeavy(false);
    }else{
      const f=player();
      if(f?.alive&&f.weapon?.category==='roller'&&f.__rollerInput){
        e.preventDefault();
        try{window.__ROLLER_CANONICAL_RELEASE?.(false);}catch(err){
          try{console.warn('[canonical roller release]',err);}catch(_){}
        }
      }
    }
    canonicalMouseHeld=false;
    isShooting=false;
    if(e.type==='mouseup')suppressMouseUntil=performance.now()+50;
  }

  /* Window capture runs before the old document-level handlers. */
  window.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')beginDesktop(e);},true);
  window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')endDesktop(e);},true);

  /* Pointer cancellation is a valid end-of-input path too. */
  window.addEventListener('pointercancel',e=>{
    if(e.pointerType!=='mouse')return;
    if(chargerInput){
      e.preventDefault();e.stopImmediatePropagation();
      releaseCanonicalCharger(true);isShooting=false;return;
    }
    if(player()?.__rollerInput){
      e.preventDefault();e.stopImmediatePropagation();
      try{window.__ROLLER_CANONICAL_RELEASE?.(true);}catch(_){}
      isShooting=false;return;
    }
    if(!heavy)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    releaseHeavy(true);
    isShooting=false;
  },true);

  /* Losing capture is not itself a failed shot. The canonical release
     path still waits for pointerup/mouseup, so moving the mouse away from
     an obstacle/UI cannot silently cancel a charger charge. */
  window.addEventListener('lostpointercapture',e=>{
    if(chargerInput){
      try{console.debug('[V121 charger] lost pointer capture',e.pointerId);}catch(_){}
      return;
    }
    if(!heavy)return;
    releaseHeavy(true);
    isShooting=false;
  },true);

  window.addEventListener('mousedown',e=>{
    if(performance.now()<suppressMouseUntil){e.stopImmediatePropagation();return;}
    beginDesktop(e);
  },true);
  window.addEventListener('mouseup',endDesktop,true);
  window.addEventListener('contextmenu',e=>{
    if(battle()&&!excluded(e)){e.preventDefault();e.stopImmediatePropagation();}
  },true);

  /* V119: charger touch input is handled here, not by player-runtime/V112. */
  window.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch'||!battle()||!player()?.alive)return;
    const f=player();
    if(f.weapon?.category!=='charger'||excluded(e))return;
    e.preventDefault();e.stopImmediatePropagation();
    try{e.target?.setPointerCapture?.(e.pointerId);}catch(_){}
    startCanonicalCharger(e.pointerId,'touch');
  },true);

  window.addEventListener('pointermove',e=>{
    if(!chargerInput||chargerInput.pointerId!==e.pointerId||e.pointerType!=='touch')return;
    e.preventDefault();e.stopImmediatePropagation();
    const st=chargerInput;
    if(typeof st.lastX==='number'){
      const dx=e.clientX-st.lastX,dy=e.clientY-st.lastY;
      yaw-=dx*.005;
      pitch-=dy*.005;
      pitch=Math.max(-Math.PI/2.5,Math.min(Math.PI/3,pitch));
    }
    st.lastX=e.clientX;st.lastY=e.clientY;
    updateCanonicalChargerGauge(chargerFrac(st));
  },true);

  /* Touchscreens may synthesize a mouse event after touchend. Keep that
     synthetic event away from the desktop shooting path. */
  window.addEventListener('pointerup',e=>{
    if(e.pointerType!=='touch'||!chargerInput||chargerInput.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    releaseCanonicalCharger(false);
  },true);
  window.addEventListener('pointercancel',e=>{
    if(e.pointerType!=='touch'||!chargerInput||chargerInput.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    releaseCanonicalCharger(true);
  },true);

  window.addEventListener('touchstart',()=>{
    suppressMouseUntil=performance.now()+900;
  },true);
  window.addEventListener('touchend',()=>{
    suppressMouseUntil=Math.max(suppressMouseUntil,performance.now()+80);
  },true);

  /* Q / R / Shift are the only keyboard action keys owned here. */
  window.addEventListener('keydown',e=>{
    if(!battle())return;
    if(e.code==='ShiftLeft'||e.code==='ShiftRight'){
      if(e.repeat)return;
      e.preventDefault();e.stopImmediatePropagation();
      try{beginSquidHoldV66(e);}catch(_){keys.shift=true;}
      return;
    }
    if(e.code==='KeyQ'){
      e.preventDefault();e.stopImmediatePropagation();
      const f=player();
      if(f?.alive){exitSquidForAction(f,'sub');try{doPlayerSubThrow();}catch(_){}}
      return;
    }
    if(e.code==='KeyR'){
      e.preventDefault();e.stopImmediatePropagation();
      const f=player();
      if(f?.alive){exitSquidForAction(f,'special');try{fireSpecial(f);}catch(_){}}
    }
  },true);

  window.addEventListener('keyup',e=>{
    if(e.code!=='ShiftLeft'&&e.code!=='ShiftRight')return;
    if(!battle())return;
    e.preventDefault();e.stopImmediatePropagation();
    try{endSquidHoldV66(e);}catch(_){keys.shift=false;}
  },true);

  window.addEventListener('blur',()=>{
    if(chargerInput)releaseCanonicalCharger(true);
    releaseHeavy(true);
  });

  /* Safety net: if an input device disappears while a charger is held,
     clear the state so the next press always starts a fresh charge. */
  window.addEventListener('mouseleave',e=>{
    if(!heavy)return;
    if(document.pointerLockElement===renderer?.domElement)return;
    if(e.buttons===0)releaseHeavy(true);
  },true);

  /* V118 FINAL INPUT REPAIR
     One authoritative keyboard path for the three action keys.
     Shift = hold squid, Q = bomb, R = special.
     Q/R first leave squid, then call the current public action function.
  */
  if(!window.__V118_INPUT_REPAIR){
    window.__V118_INPUT_REPAIR=true;
    const battleNow=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
    const currentPlayer=()=>{try{if(typeof playerFighter!=='undefined'&&playerFighter)return playerFighter;}catch(_){}return window.playerFighter||null;};
    const forceHumanForAction=(f,reason)=>{
      if(!f?.isPlayer)return;
      if(f.squid_mode){
        try{window.__V66_BREAK_SQUID_FOR_ACTION?.(reason);}catch(_){}
        f.squid_mode=false;
        f._neutralSquid=false;
        try{keys.shift=false;}catch(_){}
        try{window.__V66_SET_SQUID_VISUAL?.(f,false);}catch(_){}
        try{if(f.human)f.human.visible=true;if(f.squid)f.squid.visible=false;}catch(_){}
      }
    };
    window.addEventListener('keydown',e=>{
      if(!battleNow())return;
      if(e.code==='ShiftLeft'||e.code==='ShiftRight'){
        if(e.repeat)return;
        e.preventDefault();e.stopImmediatePropagation();
        try{beginSquidHoldV66(e);}catch(_){
          try{keys.shift=true;}catch(_){}
          try{window.playerFighter.squid_mode=true;}catch(_){}
        }
        return;
      }
      if(e.code==='KeyQ'){
        e.preventDefault();e.stopImmediatePropagation();
        const f=currentPlayer();
        if(!f?.alive)return;
        forceHumanForAction(f,'sub');
        const d=aimDir(f);
        try{
          if(typeof window.tryThrowSub==='function')window.tryThrowSub(f,d,performance.now());
          else if(typeof tryThrowSub==='function')tryThrowSub(f,d,performance.now());
        }catch(err){try{console.warn('[V118 SUB]',err);}catch(_){}}
        return;
      }
      if(e.code==='KeyR'){
        e.preventDefault();e.stopImmediatePropagation();
        const f=currentPlayer();
        if(!f?.alive)return;
        forceHumanForAction(f,'special');
        try{
          if(typeof window.fireSpecial==='function')window.fireSpecial(f);
          else if(typeof fireSpecial==='function')fireSpecial(f);
        }catch(err){try{console.warn('[V118 SPECIAL]',err);}catch(_){}}
      }
    },true);
    window.addEventListener('keyup',e=>{
      if(e.code!=='ShiftLeft'&&e.code!=='ShiftRight')return;
      if(!battleNow())return;
      e.preventDefault();e.stopImmediatePropagation();
      try{endSquidHoldV66(e);}catch(_){
        try{keys.shift=false;}catch(_){}
        try{if(window.playerFighter){window.playerFighter.squid_mode=false;window.__V66_SET_SQUID_VISUAL?.(window.playerFighter,false);}}catch(_){}
      }
    },true);
    window.addEventListener('blur',()=>{
      try{endSquidHoldV66();}catch(_){try{keys.shift=false;}catch(_){}}
    },true);
    window.__V118_INPUT_REPAIR_READY=true;
  }

  /* Re-apply hold-to-squid after later special/movement wrappers run. */
  const movementBeforeSquidRepair=window.updatePlayerMovement;
  if(typeof movementBeforeSquidRepair==='function'){
    window.updatePlayerMovement=function(delta){
      const f0=player();
      const suppressLegacyNormalFire=!!(f0?.alive&&f0.isPlayer&&f0.weapon&&
        !['charger','spinner','wiper','roller'].includes(f0.weapon.category)&&!f0.weapon.brush);
      const savedShooting=isShooting;
      if(suppressLegacyNormalFire)isShooting=false;
      let result;
      try{
        result=movementBeforeSquidRepair(delta);
      }finally{
        if(suppressLegacyNormalFire)isShooting=savedShooting;
      }
      const f=player();
      if(!f?.alive||!battle())return result;
      let held=!!keys.shift;
      try{held=held||!!window.__V66_SQUID_PHYSICAL_HOLD?.();}catch(_){}
      let enemyInk=false;
      try{enemyInk=!!window.__V66_IS_ENEMY_INK?.(f);}catch(_){}
      const squid=held&&!enemyInk;
      f.squid_mode=squid;
      f._neutralSquid=squid&&!f.isSwimmingOnInk;
      try{window.__V66_SET_SQUID_VISUAL?.(f,squid);}catch(_){}
      try{if(f.human)f.human.visible=!squid;if(f.squid)f.squid.visible=squid;}catch(_){}
      try{window.updateFighterAnimation?.(f,!!f._moving,squid);}catch(_){}

      /* One authoritative held-fire loop for normal ranged weapons. */
      if(f?.alive&&f.isPlayer&&canonicalMouseHeld&&!squid&&f.weapon&&
         !['charger','spinner','wiper','roller'].includes(f.weapon.category)&&!f.weapon.brush){
        try{fireBasic(f,aimDir(f),performance.now());}catch(err){
          try{console.warn('[V117 held-shot]',err);}catch(_){}
        }
      }
      return result;
    };
    try{updatePlayerMovement=window.updatePlayerMovement;}catch(_){}
  }

  window.__V116_UPDATE_BULLETS=updateUnifiedBullets;
  window.__V117_CANONICAL_RUNTIME={
    build:'V122-CHARGER-FULL-INPUT-AND-VISIBLE-CHARGE-2026-10-03',
    projectile:'V116',
    input:'single-desktop-action-path',
    remoteShots:'V117-canonical-ranged',
    launchPitchDeg:CANONICAL_LAUNCH_PITCH_DEG,
    heldFire:'canonical'
  };
  console.log('[SPLATOON ONLINE][V117] canonical runtime active');
})();

/*
 * FINAL WEAPON BEHAVIOR REPAIR — V124
 * Roller is now an independent canonical action:
 *   - short press: one short downward flick
 *   - hold: continuous ink directly under the roller
 *   - jump + press: narrow long/vertical flick, plus vertical wall ink
 */
(function(){
  'use strict';

  const HOLD_MS=180;
  const ROLL_EVERY=70;
  const ROLL_INK=.58;
  const FLICK_INK=5.0;
  const GROUND_RADIUS=.92;
  const GROUND_REACH=3.1;
  const AIR_REACH=4.15;

  const num=(v,d=0)=>{
    const n=Number(v);
    return Number.isFinite(n)?n:d;
  };
  const inBattle=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
  const player=()=>{try{return playerFighter||null;}catch(_){return null;}};

  function dirOf(f){
    const d=new THREE.Vector3();
    try{if(f?.isPlayer&&camera)camera.getWorldDirection(d);}catch(_){}
    d.y=0;
    if(d.lengthSq()<.0001){
      const y=num(f?.root?.rotation?.y,0);
      d.set(Math.sin(y),0,Math.cos(y));
    }
    return d.normalize();
  }

  function floorY(f){
    try{return num(getSupportHeight(f.pos.x,f.pos.z,Math.max(f.pos.y,1)),0);}catch(_){return 0;}
  }

  function airborne(f){
    return num(f.pos.y,0)>floorY(f)+.48 || num(window.playerVelocity?.y,0)>1.0;
  }

  function spend(f,cost){
    const c=Math.max(.1,num(cost,.1));
    try{
      if(typeof window.__consumeInkForGame==='function')return !!window.__consumeInkForGame(f,c);
    }catch(_){}
    if(num(f?.ink,0)<c)return false;
    f.ink=Math.max(0,num(f.ink,0)-c);
    return true;
  }

  function safePaint(x,z,r,col,opts){
    try{paintGround(x,z,r,col,opts);}catch(err){
      try{console.warn('[V124 roller paint]',err);}catch(_){}
    }
  }

  function enemyHit(f,d,reach,damage,maxDy){
    try{
      for(const o of fighters||[]){
        if(!o?.alive||o.team===f.team)continue;
        const rel=o.pos.clone().sub(f.pos);
        const planar=new THREE.Vector3(rel.x,0,rel.z);
        const dist=planar.length();
        if(dist<.12||dist>reach)continue;
        planar.normalize();
        if(planar.dot(d)<.15)continue;
        if(Math.abs(num(o.pos.y)-num(f.pos.y))>maxDy)continue;
        applyDamage(o,damage,f);
      }
    }catch(_){}
  }

  function groundFlick(f,d){
    const col=f.team==='A'?teamAHex:teamBHex;
    /* Short, compact sweep. It does not launch a long-distance projectile. */
    const reach=GROUND_REACH,width=1.35;
    for(let i=0;i<=6;i++){
      const t=i/6;
      const side=(t-.5)*width;
      const p=f.pos.clone().addScaledVector(d,.42+reach*t);
      p.x+=-d.z*side;
      p.z+=d.x*side;
      safePaint(p.x,p.z,GROUND_RADIUS*(1-.16*t),col,{team:f.team,sourceFighter:f});
    }
  }

  function airGroundFlick(f,d){
    const col=f.team==='A'?teamAHex:teamBHex;
    /* Jump flick: narrow, elongated strip instead of a wide splash. */
    const reach=AIR_REACH,width=.58;
    let prev=null;
    for(let i=0;i<=10;i++){
      const t=i/10;
      const p=f.pos.clone().addScaledVector(d,.45+reach*t);
      p.x+=-d.z*((t-.5)*width);
      p.z+=d.x*((t-.5)*width);
      if(prev){
        safePaint(prev.x,prev.z,.48,col,{to:{x:p.x,z:p.z},team:f.team,sourceFighter:f});
      }else{
        safePaint(p.x,p.z,.52,col,{team:f.team,sourceFighter:f});
      }
      prev=p;
    }
  }

  function wallHitAhead(f,d){
    for(const distance of [1.4,1.9,2.5,3.1,3.8]){
      const p=f.pos.clone().addScaledVector(d,distance);
      try{
        const block=getBlockingWall(p.x,p.z,num(f.pos.y)+1.0);
        if(block)return {block,p};
      }catch(_){}
    }
    return null;
  }

  function verticalWallFlick(f,d){
    const hit=wallHitAhead(f,d);
    if(!hit)return;
    const block=hit.block?.block||hit.block;
    if(!block)return;
    const col=f.team==='A'?teamAHex:teamBHex;
    const center=num(f.pos.y)+1.0;
    const bottom=Math.max(num(block.minY)+.12,center-1.2);
    const top=Math.min(num(block.maxY)-.08,center+1.2);
    for(let i=0;i<=8;i++){
      const y=bottom+(top-bottom)*(i/8);
      try{
        const fp=getFaceHitPoint(block,new THREE.Vector3(hit.p.x,y,hit.p.z));
        paintWallSurface(block,fp.point,col,f.team,.58);
      }catch(_){}
    }
    const base=f.pos.clone().addScaledVector(d,1.8);
    safePaint(base.x,base.z,.52,col,{team:f.team,sourceFighter:f});
  }

  function doFlick(f){
    if(!f?.alive||f.weapon?.category!=='roller'||!inBattle()||f.squid_mode)return false;
    if(!spend(f,FLICK_INK))return false;
    const d=dirOf(f);
    const jump=airborne(f);
    try{
      if(jump){
        airGroundFlick(f,d);
        verticalWallFlick(f,d);
      }else{
        groundFlick(f,d);
      }
    }catch(err){
      try{console.warn('[V124 roller flick]',err);}catch(_){}
    }
    enemyHit(f,d,jump?4.0:1.95,jump?78:72,jump?2.2:1.25);

    const t=performance.now();
    f.lastSwing=t;
    f.__rollerLastFlickAt=t;
    try{
      const al=f.armL?.rotation?.x,ar=f.armR?.rotation?.x;
      if(f.armL)f.armL.rotation.x=-1.3;
      if(f.armR)f.armR.rotation.x=-1.55;
      setTimeout(()=>{
        try{
          if(f.armL&&Number.isFinite(al))f.armL.rotation.x=al;
          if(f.armR&&Number.isFinite(ar))f.armR.rotation.x=ar;
        }catch(_){}
      },110);
    }catch(_){}
    try{sfx('shoot');}catch(_){}
    return true;
  }

  function updateHold(f,now){
    const st=f?.__rollerInput;
    if(!f?.isPlayer||f.weapon?.category!=='roller'||!st||!inBattle())return false;
    if(f.squid_mode){
      f.__rollerInput=null;
      return false;
    }
    const t=num(now,performance.now());
    if(t-num(st.start,t)<HOLD_MS)return false;
    if(t-num(st.lastPaintAt,0)<ROLL_EVERY)return false;
    if(!spend(f,ROLL_INK))return false;

    const col=f.team==='A'?teamAHex:teamBHex;
    const cur=f.pos.clone();
    const prev=st.lastPos?.clone?st.lastPos.clone():cur.clone();
    if(cur.distanceTo(prev)>.04){
      safePaint(prev.x,prev.z,.84,col,{
        to:{x:cur.x,z:cur.z},team:f.team,sourceFighter:f
      });
    }
    /* The roller always inks immediately below itself while held. */
    safePaint(cur.x,cur.z,1.02,col,{team:f.team,sourceFighter:f});
    st.lastPos=cur.clone();
    st.lastPaintAt=t;
    f.__rollerLastRollAt=t;
    f.lastSwing=t;
    enemyHit(f,dirOf(f),1.7,52,1.35);
    return true;
  }

  function release(aborted){
    const f=player();
    const st=f?.__rollerInput;
    if(f)f.__rollerInput=null;
    if(!st||aborted||!f?.alive||!inBattle()||f.weapon?.category!=='roller')return false;
    const elapsed=Math.max(0,performance.now()-num(st.start,performance.now()));
    if(elapsed<HOLD_MS)return doFlick(f);
    return true;
  }

  /*
   * Player movement: legacy roller code is completely suppressed while the
   * canonical input is held. Then only the canonical under-roller painter runs.
   */
  const previous=window.updatePlayerMovement;
  if(typeof previous==='function'&&!window.__V124_ROLLER_MOVEMENT){
    window.__V124_ROLLER_MOVEMENT=true;
    window.updatePlayerMovement=function(delta){
      const f=player();
      const active=!!(f?.isPlayer&&f.weapon?.category==='roller'&&f.__rollerInput);
      const saved=isShooting;
      if(active)isShooting=false;
      let out;
      try{out=previous(delta);}
      finally{if(active)isShooting=saved;}
      if(active&&!f.squid_mode)updateHold(f,performance.now());
      return out;
    };
    try{updatePlayerMovement=window.updatePlayerMovement;}catch(_){}
  }

  /*
   * This function is used by CPU AI and legacy callers. A CPU has no input state,
   * so each attack request is one controlled flick.
   */
  window.performRollerSwing=function(f,now){
    if(!f?.alive||f.weapon?.category!=='roller')return false;
    if(f.isPlayer)return f.__rollerInput?updateHold(f,num(now,performance.now())):false;
    return doFlick(f);
  };
  try{performRollerSwing=window.performRollerSwing;}catch(_){}

  window.__ROLLER_CANONICAL_RELEASE=release;
  window.__ROLLER_CANONICAL_FLICK=doFlick;
  window.__ROLLER_CANONICAL_HOLD_UPDATE=updateHold;

  const oldRespawn=window.respawnFighter;
  if(typeof oldRespawn==='function'&&!window.__V124_ROLLER_RESPAWN){
    window.__V124_ROLLER_RESPAWN=true;
    window.respawnFighter=function(f){
      try{
        if(f){
          f.__rollerInput=null;
          f.__rollerLastRollAt=0;
          f.__rollerLastFlickAt=0;
        }
      }catch(_){}
      return oldRespawn.apply(this,arguments);
    };
  }

  /*
   * The previous build repainted the entire practice canvas on entry.
   * That made the turf comparison meaningless and hid roller paint tests.
   * The turf bar now compares only wet A/B pixels, so no pre-painting is needed.
   */

  window.__V124_ROLLER_READY=true;
  console.log('[SPLATOON ONLINE][V124] roller canonical behavior active');
})();
/* --- end gameplay-fixes-v116.js --- */
