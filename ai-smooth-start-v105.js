/* V105: clean battle ink + smooth CPU AI.
   - CPU battle starts from a completely clean ink field.
   - Replaces the expensive per-AI 2D pixel scan with direct cached actor selection.
   - Smooth steering prevents frame-to-frame direction snapping.
   - Keeps existing WASD/Shift/player controls unchanged.
*/
(function(){
  'use strict';
  const BUILD='V105-CLEAN-START-SMOOTH-AI-2026-10-02';

  function n(v,d=0){
    const x=Number(v);
    return Number.isFinite(x)?x:d;
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function dist2D(a,b){return Math.hypot(a.x-b.x,a.z-b.z);}

  function clearAllBattleInk(){
    try{
      if(paintCtx&&paintCanvas){
        paintCtx.clearRect(0,0,paintCanvas.width,paintCanvas.height);
        paintCtx.fillStyle='#555566';
        paintCtx.fillRect(0,0,paintCanvas.width,paintCanvas.height);
        paintTexture.needsUpdate=true;
      }
    }catch(_){}

    try{
      // Clear persistent gameplay paint state on every stage-solid.
      for(const b of collidableBlocks||[]){
        if(!b)continue;
        b.paintTeam=null;
        b.paintLevel=0;
        if(Array.isArray(b.__v80WallMarks))b.__v80WallMarks.length=0;
        if(Array.isArray(b.__v82WallMarks))b.__v82WallMarks.length=0;
        if(Array.isArray(b.__v82SurfaceMarks))b.__v82SurfaceMarks.length=0;
        if(Array.isArray(b.__v89WallMarks))b.__v89WallMarks.length=0;

        // Remove all visual ink belonging to the block.
        if(b.mesh&&typeof b.mesh.traverse==='function'){
          const remove=[];
          b.mesh.traverse(obj=>{
            if(obj===b.mesh)return;
            const u=obj.userData||{};
            if(u.v80WallInk||u.v82WallInk||u.v82SurfaceInk)remove.push(obj);
          });
          for(const obj of remove){
            if(obj.parent)obj.parent.remove(obj);
            try{obj.geometry?.dispose?.();obj.material?.dispose?.();}catch(_){}
          }
        }
      }
    }catch(_){}

    try{
      // V79 unified paint layer is attached to stageGroup.
      if(stageGroup&&typeof stageGroup.traverse==='function'){
        const remove=[];
        stageGroup.traverse(obj=>{
          if(obj===stageGroup)return;
          const u=obj.userData||{};
          if(u.v79Unified)remove.push(obj);
        });
        for(const obj of remove){
          if(obj.parent)obj.parent.remove(obj);
          try{obj.geometry?.dispose?.();obj.material?.dispose?.();}catch(_){}
        }
      }
    }catch(_){}

    try{
      if(Array.isArray(decals))decals.length=0;
    }catch(_){}
  }

  if(typeof startBattleFromRange==='function'){
    const baseStartBattle=startBattleFromRange;
    startBattleFromRange=function(){
      clearAllBattleInk();
      return baseStartBattle.apply(this,arguments);
    };
  }
  window.__V105_CLEAR_BATTLE_INK=clearAllBattleInk;

  // ---- Smooth CPU AI -----------------------------------------------------
  const aiState=new WeakMap();

  function stateFor(f,now){
    let s=aiState.get(f);
    if(!s){
      s={
        steer:new THREE.Vector3(),
        targetPos:null,
        nextTarget:0,
        nextShot:0,
        nextSub:0,
        nextSpecial:0,
        paintAt:0,
        strafe:Math.random()<.5?-1:1,
        lastPos:f.pos.clone(),
        lastMoveAt:now,
        stuck:0,
        chargeStart:0
      };
      aiState.set(f,s);
    }
    return s;
  }

  function nearestEnemy(f){
    let best=null,bd=Infinity;
    for(const o of fighters||[]){
      if(!o||!o.alive||o.team===f.team)continue;
      const d=dist2D(f.pos,o.pos);
      if(d<bd){bd=d;best=o;}
    }
    return best;
  }

  function ownInkAt(f){
    try{return typeof onFighterInk==='function'&&onFighterInk(f);}catch(_){return false;}
  }
  function enemyInkAtSafe(f){
    try{return typeof isEnemyInkAt==='function'&&isEnemyInkAt(f);}catch(_){return false;}
  }

  function roleRange(w){
    switch(w?.category){
      case 'charger':return [18,34];
      case 'spinner':return [12,28];
      case 'roller':return [0,7];
      case 'wiper':return [3,9];
      case 'blaster':return [4,14];
      case 'slosher':return [5,16];
      case 'brella':return [3,13];
      default:return [5,21];
    }
  }

  function chooseDestination(f,s,target,now){
    const sign=f.team==='A'?-1:1;

    if(target){
      const d=dist2D(f.pos,target.pos);
      const r=roleRange(f.weapon);
      let ideal=(r[0]+r[1])*.5;

      // Retreat only when genuinely in danger. The old threshold made the CPU retreat
      // so often that it looked frightened even when it still had plenty of HP.
      if(f.hp<14 || (enemyInkAtSafe(f) && f.hp<38)){
        const dx=f.pos.x-target.pos.x,dz=f.pos.z-target.pos.z;
        const len=Math.hypot(dx,dz)||1;
        return {x:f.pos.x+dx/len*8,z:f.pos.z+dz/len*8};
      }

      // Smooth strafing around the target instead of snapping between points.
      const dx=target.pos.x-f.pos.x,dz=target.pos.z-f.pos.z;
      const len=Math.hypot(dx,dz)||1;
      if(d<Math.max(5,r[0]+1.5)){
        ideal=Math.max(2.8,r[0]);
      }
      const nx=dx/len,nz=dz/len;
      const px=-nz,pz=nx;
      const wave=Math.sin(now*.0025+s.phase||0)*2.2;
      return {
        x:target.pos.x-nx*ideal+px*wave*s.strafe,
        z:target.pos.z-nz*ideal+pz*wave*s.strafe
      };
    }

    // No target: advance toward center/front while keeping role separation.
    const role=f.weapon?.category;
    if(role==='charger'||role==='spinner')return {x:0,z:sign*18};
    if(role==='roller'||role==='wiper')return {x:0,z:sign*28};
    return {x:0,z:sign*20};
  }

  function shouldSquid(f,destination,target){
    if(!ownInkAt(f)||f.ink<25)return false;
    if(enemyInkAtSafe(f))return false;
    if(target&&dist2D(f,target.pos)<20)return false;
    if(!destination)return false;
    return dist2D(f.pos,destination)>6;
  }

  function smoothMove(f,s,destination,delta,squid){
    if(!destination)return false;

    const dx=destination.x-f.pos.x,dz=destination.z-f.pos.z;
    const len=Math.hypot(dx,dz);
    if(len<.08)return false;

    const desired=new THREE.Vector3(dx/len,0,dz/len);
    if(s.steer.lengthSq()<.001)s.steer.copy(desired);
    else{
      const blend=1-Math.exp(-12*Math.min(.1,Math.max(.001,delta)));
      s.steer.lerp(desired,blend);
      s.steer.y=0;
      if(s.steer.lengthSq()<.001)s.steer.copy(desired);
      else s.steer.normalize();
    }

    const w=f.weapon||{};
    const baseSpeed=squid?7.4:4.9;
    const gear=f.gearProfile?.[squid?'swim':'move']||1;
    let speed=baseSpeed*gear;

    if(!squid){
      if(w.category==='roller'||w.category==='wiper')speed*=1.05;
      if(w.category==='charger'||w.category==='spinner')speed*=.94;
    }

    const before=f.pos.clone();
    try{tryMoveWithCollision(f,s.steer.clone().multiplyScalar(speed),delta,squid);}catch(_){}

    let moved=before.distanceTo(f.pos);
    if(moved>.012){
      s.stuck=0;
      s.lastPos.copy(f.pos);
      s.lastMoveAt=performance.now();
      return true;
    }

    // Gentle side-step only after a real stall.
    s.stuck+=delta;
    if(s.stuck>.22){
      const side=s.steer.clone().applyAxisAngle(new THREE.Vector3(0,1,0),s.strafe*Math.PI*.5);
      try{tryMoveWithCollision(f,side.multiplyScalar(speed*.7),delta,false);}catch(_){}
      s.stuck=0;
      s.strafe*=-1;
    }
    return false;
  }

  function doAttack(f,target,now,s){
    if(!target||!target.alive)return;

    const dx=target.pos.x-f.pos.x,dz=target.pos.z-f.pos.z;
    const len=Math.hypot(dx,dz)||1;
    const dir=new THREE.Vector3(dx/len,0,dz/len);
    f.human.rotation.y=Math.atan2(dir.x,dir.z);
    f.root.rotation.y=f.human.rotation.y;

    const w=f.weapon||{};

    try{
      if(w.category==='charger'){
        if(!s.chargeStart)s.chargeStart=now;
        const need=Math.max(280,(w.chargeTime||800)*.62);
        if(now-s.chargeStart>=need&&now>=s.nextShot){
          s.nextShot=now+720;
          const frac=clamp((now-s.chargeStart)/(w.chargeTime||800),.45,.98);
          if(typeof fireChargerShot==='function')fireChargerShot(f,dir,frac);
          s.chargeStart=0;
        }
        return;
      }

      if(w.category==='spinner'){
        if(!s.chargeStart)s.chargeStart=now;
        const need=Math.max(180,(w.chargeTime||650)*.45);
        if(now-s.chargeStart>=need&&now>=s.nextShot){
          s.nextShot=now+Math.max(360,Math.min(760,(w.rate||60)*8));
          const frac=clamp((now-s.chargeStart)/(w.chargeTime||650),.45,1);
          if(typeof fireSplatlingBurst==='function'){
            fireSplatlingBurst(f,frac,dir);
          }
          s.chargeStart=0;
        }
        return;
      }

      if(w.category==='wiper'){
        if(!s.chargeStart)s.chargeStart=now;
        const need=Math.max(220,(w.chargeTime||600)*.45);
        if(now-s.chargeStart>=need){
          const frac=clamp((now-s.chargeStart)/(w.chargeTime||600),.35,1);
          if(typeof fireBladeSlashV60==='function')fireBladeSlashV60(f,frac,dir);
          else if(typeof doWiperSlash==='function')doWiperSlash(f,frac);
          s.chargeStart=0;
        }
        return;
      }

      if(w.category==='roller'){
        if(typeof performRollerSwing==='function')performRollerSwing(f,now);
        return;
      }

      if(now>=s.nextShot&&typeof tryShoot==='function'){
        s.nextShot=now+Math.max(80,n(w.rate,120));
        tryShoot(f,dir,now);
      }
    }catch(_){}
  }

  function updateSmoothAI(f,delta,now){
    if(!f||f.isPlayer||f.remote||!f.alive)return;
    const s=stateFor(f,now);
    if(!Number.isFinite(s.phase))s.phase=Math.random()*Math.PI*2;

    const target=nearestEnemy(f);
    const destination=chooseDestination(f,s,target,now);
    const squid=shouldSquid(f,destination,target);

    f.squid_mode=squid;
    f._moving=destination?smoothMove(f,s,destination,delta,squid):false;

    // Regenerate and paint without generating excessive work every frame.
    if(squid){
      f.ink=Math.min(100,f.ink+28*delta);
      if(f.hp<f.maxHp)f.hp=Math.min(f.maxHp,f.hp+5.5*delta);
    }else{
      f.ink=Math.max(0,f.ink-delta*.32);
      if(now>=s.paintAt){
        try{
          const end=f.pos.clone().add(s.steer.clone().multiplyScalar(1.4));
          paintGround(f.pos.x,f.pos.z,.9,getFighterInkHex(f),{to:{x:end.x,z:end.z},noNetwork:true});
        }catch(_){}
        s.paintAt=now+120;
      }
    }

    if(target){
      const d=dist2D(f.pos,target.pos);
      if(!squid&&d<=Math.max(24,roleRange(f.weapon)[1]+2))doAttack(f,target,now,s);

      if(!squid&&d<20&&now>=s.nextSub&&Math.random()<delta*.65){
        try{
          if(typeof tryThrowSub==='function'){
            const q=new THREE.Vector3(target.pos.x-f.pos.x,0,target.pos.z-f.pos.z).normalize();
            tryThrowSub(f,q,now);
          }
        }catch(_){}
        s.nextSub=now+2200+Math.random()*1300;
      }

      if(!squid&&f.specialGauge>=100&&now>=s.nextSpecial){
        if(d<22){
          try{fireSpecial?.(f);}catch(_){}
          s.nextSpecial=now+9000+Math.random()*4000;
        }
      }
    }

    updateFighterAnimation(f,!!f._moving,!!f.squid_mode);
    if(!f.squid_mode&&f._moving)f.root.rotation.y=f.human.rotation.y;
    else if(f.squid_mode&&s.steer.lengthSq()>.01)f.root.rotation.y=Math.atan2(s.steer.x,s.steer.z);
  }

  updateAI=updateSmoothAI;
  window.updateAI=updateSmoothAI;
  window.__V105_AI=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] smooth CPU AI + clean battle start active');
})();
