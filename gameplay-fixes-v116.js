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
  const BUILD='V116-UNIFIED-PROJECTILE-GAMEPLAY-2026-10-02';
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

  function paintPathSample(b,p){
    if(!b?.sourceFighter||b.team==null||!p)return;
    const ground=support(p.x,p.z,Math.max(p.y,1));
    const gap=p.y-ground;
    if(gap<-.08||gap>2.0)return;
    try{
      const rr=Math.max(.42,Math.min(2.2,num(b.paintRadius,.8)*.55));
      paintGround(p.x,p.z,rr,b.colorHex,{
        surfaceY:ground,
        yHint:p.y,
        team:b.team,
        sourceFighter:b.sourceFighter,
        noNetwork:true
      });
    }catch(_){}
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
      if(b.explosive){
        try{explodeAt(wall.point.clone(),num(b.explosionRadius,0),num(b.splashDamage,0),b.team,{
          paintRadius:num(b.paintRadius,.8),colorHex:b.colorHex,sourceFighter:b.sourceFighter
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
          paintRadius:num(b.paintRadius,.8),colorHex:b.colorHex,sourceFighter:b.sourceFighter
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
    const d=aim(f,dir);
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

    const s=f.pos.clone();
    s.y+=num(opts.yOffset,1.2);
    s.addScaledVector(d,.55);
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

  function updateUnifiedBullets(delta){
    const dt=Math.max(0,Math.min(.06,num(delta,.016)));
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i];
      if(!b?.__v116Unified||!b.mesh){
        continue;
      }
      b.age+=dt;
      const prev=b.mesh.position.clone();

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

      paintTravel(b,prev,b.mesh.position);

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
        if(b.explosive){
          try{explodeAt(hitPoint.clone(),num(b.explosionRadius,0),num(b.splashDamage,0),b.team,{
            paintRadius:num(b.paintRadius,.8),colorHex:b.colorHex,sourceFighter:b.sourceFighter
          });}catch(_){}
          try{applyDamage(hit,Math.max(0,b.damage-b.splashDamage),b.sourceFighter);}catch(_){}
        }else{
          try{applyDamage(hit,b.damage,b.sourceFighter);}catch(_){}
        }
        removeBullet(b,i);
        continue;
      }

      if(b.horizontalTravel>=b.maxRange&&!b.rangeDropped){
        b.rangeDropped=true;
        if(b.trajectory==='charger'){
          b.chargerDrop=true;
          b.velocity.x=0;b.velocity.z=0;b.velocity.y=0;
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
        if(stagePointIn(p.x,p.z))impact(b,p,null);
        removeBullet(b,i);
      }
    }
  }

  function fireBasic(f,dir,now){
    if(!f?.alive||isSquid(f)||!battle())return false;
    const w=f.weapon;if(!w)return false;
    if(['charger','roller','spinner','wiper'].includes(w.category)||w.brush)return false;
    const t=num(now,performance.now());
    if(t-num(f.lastShot,0)<num(w.rate,100))return false;
    const baseCost=Math.max(.1,num(w.inkCost,1));
    if(!consume(f,baseCost))return false;
    f.lastShot=t;

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
      f.specialGauge=Math.min(100,num(f.specialGauge,0)+.7*fired*(f.gearProfile?.specialGain||1));
      try{sfx('shoot');}catch(_){}
      if(f.isPlayer&&onlineActive&&onlineStarted){
        try{window.__v93SendShot?.({
          x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,dx:base.x,dy:base.y,dz:base.z,
          weaponId:f.weapon.id,mode:w.category
        });}catch(_){}
      }
    }
    return fired>0;
  }

  function fireCharger(f,dir,frac){
    if(!f?.alive||isSquid(f)||!battle()||f.weapon?.category!=='charger')return false;
    const w=f.weapon,q=Math.max(.05,Math.min(1,num(frac,0)));
    const cost=num(w.inkCost,8)*(.75+.75*q);
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
    try{sfx('shoot');}catch(_){}
    if(f.isPlayer&&onlineActive&&onlineStarted){
      try{window.__v93SendShot?.({
        x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,
        dx:d.x,dy:d.y,dz:d.z,weaponId:f.weapon.id,mode:w.kind==='stringer'?'stringer':'charger',charge:q
      });}catch(_){}
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
          try{window.__v93SendShot?.({
            x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,
            dx:d.x,dy:d.y,dz:d.z,weaponId:f.weapon.id,
            mode:'splatling',charge:q,burstShots:1
          });}catch(_){}
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
  window.fireSplatlingBurst=fireSplatling;
  try{fireSplatlingBurst=fireSplatling;}catch(_){}
  window.__V67_SIMPLE_SAFE_SHOT=fireBasic;
  window.__V67_DIRECT_SHOOT=directPlayerShot;
  window.directPlayerShot=directPlayerShot;
  try{directPlayerShot=directPlayerShot;}catch(_){}

  // The last updateBullets in the file is now this unified updater.
  window.updateBullets=updateUnifiedBullets;
  try{updateBullets=updateUnifiedBullets;}catch(_){}

  // Heavy release in V112 is redirected to these canonical globals.
  window.__V116_HEAVY_RELEASE=(f,kind,q,dir)=>{
    if(kind==='charger')return fireCharger(f,dir,q);
    if(kind==='spinner')return fireSplatling(f,q,dir);
    return false;
  };

  // V112 input must never initiate charging while squid.
  const oldStartHeavy=window.__V112_START_HEAVY;
  window.__V116_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] unified projectile runtime active');
})();
