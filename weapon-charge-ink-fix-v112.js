/* V112: charger / splatling charge + ink-consumption hardening
   - One pointer/touch/mouse charge state for charger and splatlings.
   - Release always fires exactly once when charge is sufficient.
   - Mobile right look pad keeps camera aiming while charging.
   - Splatling burst reserves the affordable number of shots before scheduling.
   - Charger keeps the existing authoritative fire implementation and adds a reliable
     visible paint trace.
   - Audits normal shooting / roller actions so a successful shot can never consume 0 ink.
*/
(function(){
  'use strict';
  if(window.__V112_WEAPON_FIX_READY)return;
  window.__V112_WEAPON_FIX_READY=true;

  const BUILD='V112-CHARGER-SPLATLING-INK-FIX-2026-10-02';

  const num=(v,d=0)=>{
    const x=Number(v);
    return Number.isFinite(x)?x:d;
  };
  const battle=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
  const excludedTarget=(el)=>{
    try{
      return !!el?.closest?.(
        '#minimap,#fullmap,#online-panel,#result-screen,#v65-gear-panel,'+
        '#v107-howto-overlay,#v107-howto-button,.mobile-btn,#joystick-area'
      );
    }catch(_){return false;}
  };

  function gauge(frac){
    const g=document.getElementById('charge-gauge');
    if(!g)return;
    g.style.display='block';
    g.style.setProperty('--pct',String(Math.round(Math.max(0,Math.min(1,frac))*100)));
  }
  function hideGauge(){
    const g=document.getElementById('charge-gauge');
    if(g)g.style.display='none';
  }

  function aimDir(){
    const d=new THREE.Vector3();
    try{camera?.getWorldDirection(d);}catch(_){}
    if(d.lengthSq()<0.0001){
      const f=window.playerFighter||playerFighter;
      const yawNow=num(f?.root?.rotation?.y,0);
      d.set(Math.sin(yawNow),0,Math.cos(yawNow));
    }
    return d.normalize();
  }

  function consumeAmount(f,amount){
    const cost=Math.max(0,num(amount,0));
    if(cost<=0)return true;
    try{
      if(typeof window.__V67_V60_CONSUME==='function'){
        return !!window.__V67_V60_CONSUME(
          f,
          typeof window.__V67_V60_INKCOST==='function'
            ? window.__V67_V60_INKCOST(f,cost)
            : cost
        );
      }
    }catch(_){}
    try{
      if(typeof consumeInk==='function'){
        const c=typeof inkCost==='function'?inkCost(f,cost):cost;
        return !!consumeInk(f,c);
      }
    }catch(_){}
    if(num(f?.ink,0)<cost)return false;
    f.ink=Math.max(0,num(f.ink,0)-cost);
    return true;
  }

  function finalInkCost(f,w,amountFallback=1){
    const base=Math.max(0,num(
      Number.isFinite(Number(w?.inkCost))?w.inkCost:amountFallback,
      amountFallback
    ));
    try{
      if(typeof window.__V67_V60_INKCOST==='function'){
        return Math.max(0,num(window.__V67_V60_INKCOST(f,base),base));
      }
    }catch(_){}
    try{return Math.max(0,num(inkCost(f,base),base));}catch(_){}
    return base;
  }

  /* ----------------------------------------------------------
     Reliable charger fire
     ---------------------------------------------------------- */
  const baseChargerFire=window.fireChargerShot;

  function reliableChargerFire(f,dir,frac){
    if(!f||!f.alive||f.weapon?.category!=='charger')return false;
    const q=Math.max(.05,Math.min(1,num(frac,0)));
    const d=(dir?.clone?dir.clone():aimDir()).normalize();
    const w=f.weapon;
    const beforeInk=num(f.ink,0);
    let ok=false;

    try{
      if(typeof baseChargerFire==='function'){
        ok=!!baseChargerFire(f,d,q);
      }
    }catch(err){
      try{console.warn('[V112 charger]',err);}catch(_){}
      ok=false;
    }

    /* A few legacy charger paths report success without actually decrementing ink.
       Correct that only when the fire call really succeeded. */
    if(ok && num(f.ink,0)>=beforeInk-0.000001){
      const expected=(num(w?.inkCost,7))*(0.75+0.75*q);
      consumeAmount(f,expected);
    }

    /* Reliable line paint for charger: trace to the first wall/stage edge rather
       than painting only one isolated impact dot. */
    if(ok){
      try{
        const start=f.pos.clone();
        start.y+=0.08;
        const planar=d.clone();planar.y=0;
        if(planar.lengthSq()<0.0001)planar.set(0,0,1);
        planar.normalize();
        let end;
        if(typeof traceForward==='function'){
          end=traceForward(
            f.pos.clone(),
            planar,
            Math.max(8,num(w?.range,48)),
            .45
          );
        }else{
          end=f.pos.clone().addScaledVector(planar,Math.max(8,num(w?.range,48)));
        }
        if(end){
          paintGround(
            start.x,start.z,
            Math.max(.72,num(w?.paintRadius,1.0)*.92),
            getFighterInkHex(f),
            {to:{x:end.x,z:end.z},noNetwork:true,sourceFighter:f}
          );
        }
      }catch(_){}
    }
    return ok;
  }

  window.fireChargerShot=reliableChargerFire;
  try{fireChargerShot=reliableChargerFire;}catch(_){}

  /* ----------------------------------------------------------
     Reliable splatling burst
     ---------------------------------------------------------- */
  function reliableSplatlingFire(f,chargeFrac,aimOverride){
    if(!f||!f.alive||f.weapon?.category!=='spinner')return false;
    const w=f.weapon;
    const q=Math.max(.05,Math.min(1,num(chargeFrac,0)));
    const wanted=Math.max(1,Math.round(num(w.maxShots,12)*q));
    const minimum=Math.max(1,Math.floor(num(w.minShots,6)));
    const desired=Math.max(minimum,wanted);
    const rawPer=Math.max(.1,num(w?.inkCost,1.3));
    const per=finalInkCost(f,w,1.3);
    if(per<=0)return false;

    /* Reserve only the shots we can actually pay for. */
    const affordable=Math.min(desired,Math.floor((num(f.ink,0)+1e-6)/per));
    if(affordable<1)return false;
    if(!consumeAmount(f,rawPer*affordable))return false;

    const base=(aimOverride?.clone?aimOverride.clone():aimDir());
    base.y=0;
    if(base.lengthSq()<0.0001){
      base.set(Math.sin(num(f.root?.rotation?.y,0)),0,Math.cos(num(f.root?.rotation?.y,0)));
    }
    base.normalize();

    const spawn=window.__spawnBulletV60;
    if(typeof spawn!=='function'){
      try{
        const oldInk=num(f.ink,0);
        const oldResult=typeof baseSplatlingFire==='function'
          ? baseSplatlingFire(f,q,base)
          : false;
        const after=num(f.ink,0);
        if(after<oldInk){
          f.ink=Math.min(100,after+Math.max(0,oldInk-after));
        }
        return !!oldResult;
      }catch(_){return false;}
    }

    const up=new THREE.Vector3(0,1,0);
    const spreadBase=Math.max(.004,num(w.spread,.02));
    const gap=Math.max(0,num(w.rate,55));

    for(let i=0;i<affordable;i++){
      const index=i;
      setTimeout(()=>{
        if(!f.alive)return;
        try{
          const spread=(Math.random()-.5)*spreadBase*(1.15+Math.random()*.9);
          const d=base.clone().applyAxisAngle(up,spread);
          spawn(f,d,{
            speed:Math.max(20,num(w.speed,43)),
            damage:Math.max(1,num(w.damage,29)),
            gravity:5.2,
            drag:.035,
            radius:.13,
            paintRadius:Math.max(.45,num(w.paintRadius,.60)),
            life:Math.min(1.35,Math.max(.6,num(w.range,30)/Math.max(20,num(w.speed,43))+.35)),
            maxRange:Math.max(10,num(w.range,30)),
            kind:'splatling'
          });
        }catch(err){
          try{console.warn('[V112 splatling projectile]',err);}catch(_){}
        }
      },index*gap);
    }

    try{
      if(f.isPlayer&&onlineActive&&onlineStarted){
        window.__v93SendShot?.({
          x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,
          dx:base.x,dy:0,dz:base.z,
          weaponId:f.weapon.id,
          mode:'splatling',
          charge:q,
          burstShots:affordable
        });
      }
    }catch(_){}

    f.specialGauge=Math.min(
      100,
      num(f.specialGauge,0)+affordable*.45*(f.gearProfile?.specialGain||1)
    );
    try{sfx('shoot');}catch(_){}
    return true;
  }

  window.fireSplatlingBurst=reliableSplatlingFire;
  try{fireSplatlingBurst=reliableSplatlingFire;}catch(_){}

  /* ----------------------------------------------------------
     One charge state for charger + spinner.
     Pointer events are primary; touch/mouse are compatibility fallbacks.
     ---------------------------------------------------------- */
  let active=null;
  let recentTouchUntil=0;

  function clearHeavyState(f,clearLegacy=true){
    if(!f)return;
    f.__v112HeavyCharge=null;
    if(clearLegacy){
      f._v60ChargeStart=0;
      f._v60BladeChargeStart=0;
      f.spinnerCharging=false;
      f.spinnerChargeStart=0;
      f.spinnerFiring=false;
      f.isCharging=false;
      f.chargeStart=0;
    }
    isShooting=false;
    hideGauge();
  }

  function startHeavy(kind,pointerId){
    const f=playerFighter;
    if(!f?.alive||!battle()||active)return false;
    const w=f.weapon;
    if(kind==='charger'&&w?.category!=='charger')return false;
    if(kind==='spinner'&&w?.category!=='spinner')return false;

    const start=performance.now();
    active={kind,pointerId,start,target:f};
    f.__v112HeavyCharge={kind,pointerId,start};

    if(kind==='charger'){
      f.isCharging=true;
      f.chargeStart=start;
      isShooting=false;
    }else{
      f._v60ChargeStart=start;
      f.spinnerCharging=true;
      f.spinnerChargeStart=start;
      isShooting=false;
    }
    gauge(0);
    return true;
  }

  function currentFrac(st,kind){
    const f=st?.target;
    const w=f?.weapon;
    const ms=Math.max(
      120,
      num(w?.chargeTime,kind==='charger'?900:600)
    );
    return Math.max(0,Math.min(1,(performance.now()-num(st.start,performance.now()))/ms));
  }

  function finishHeavy(st,aborted=false){
    if(!st||!st.target)return;
    const f=st.target;
    if(!aborted&&f.alive){
      const q=currentFrac(st,st.kind);
      if(q>=.05){
        try{
          if(st.kind==='charger'){
            (window.__V116_HEAVY_RELEASE?window.__V116_HEAVY_RELEASE(f,'charger',q,aimDir()):reliableChargerFire(f,aimDir(),q));
          }else{
            (window.__V116_HEAVY_RELEASE?window.__V116_HEAVY_RELEASE(f,'spinner',q,aimDir()):reliableSplatlingFire(f,q,aimDir()));
          }
        }catch(err){
          try{console.warn('[V112 heavy release]',err);}catch(_){}
        }
      }
    }
    clearHeavyState(f,true);
    active=null;
  }

  function shouldHandleTarget(e){
    if(!battle()||!playerFighter?.alive)return false;
    if(excludedTarget(e.target))return false;
    if(e.button!==undefined&&e.button!==0)return false;
    const w=playerFighter.weapon;
    return w?.category==='charger'||w?.category==='spinner';
  }

  document.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch' && performance.now()<recentTouchUntil){
      if(shouldHandleTarget(e)){e.preventDefault();e.stopImmediatePropagation();}
      return;
    }
    if(!shouldHandleTarget(e))return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(active)return;
    const kind=playerFighter.weapon.category==='charger'?'charger':'spinner';
    startHeavy(kind,e.pointerId);
  },true);

  document.addEventListener('pointermove',e=>{
    if(!active||e.pointerId!==active.pointerId)return;
    e.preventDefault();
    if(e.pointerType==='touch'){
      const st=active;
      if(typeof st.lastX==='number'){
        const dx=e.clientX-st.lastX,dy=e.clientY-st.lastY;
        yaw-=dx*.005;
        pitch-=dy*.005;
        pitch=Math.max(-Math.PI/2.5,Math.min(Math.PI/3,pitch));
      }
      st.lastX=e.clientX;st.lastY=e.clientY;
    }else if(document.pointerLockElement!==renderer?.domElement){
      const st=active;
      if(typeof st.lastX==='number'){
        const dx=e.clientX-st.lastX,dy=e.clientY-st.lastY;
        yaw-=dx*.004;
        pitch-=dy*.004;
        pitch=Math.max(-Math.PI/2.5,Math.min(Math.PI/3,pitch));
      }
      st.lastX=e.clientX;st.lastY=e.clientY;
    }
    gauge(currentFrac(active,active.kind));
  },true);

  document.addEventListener('pointerup',e=>{
    if(!active||e.pointerId!==active.pointerId)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(e.pointerType==='touch')recentTouchUntil=performance.now()+650;
    finishHeavy(active,false);
  },true);

  document.addEventListener('pointercancel',e=>{
    if(!active||e.pointerId!==active.pointerId)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    recentTouchUntil=performance.now()+650;
    finishHeavy(active,true);
  },true);

  document.addEventListener('touchstart',e=>{
    if(!battle()||!playerFighter?.alive)return;
    const t=e.changedTouches?.[0];
    if(!t)return;
    if(excludedTarget(e.target))return;
    const w=playerFighter.weapon;
    if(w?.category!=='charger'&&w?.category!=='spinner')return;
    e.preventDefault();
    e.stopImmediatePropagation();
    recentTouchUntil=performance.now()+850;
    if(active)return;
    startHeavy(
      w.category==='charger'?'charger':'spinner',
      'touch:'+t.identifier
    );
    if(active){
      active.lastX=t.clientX;
      active.lastY=t.clientY;
    }
  },true);

  document.addEventListener('touchmove',e=>{
    if(!active||typeof active.pointerId!=='string'||!String(active.pointerId).startsWith('touch:'))return;
    const tid=Number(String(active.pointerId).slice(6));
    for(const t of e.changedTouches||[]){
      if(t.identifier!==tid)continue;
      e.preventDefault();
      e.stopImmediatePropagation();
      const dx=t.clientX-active.lastX,dy=t.clientY-active.lastY;
      yaw-=dx*.005;
      pitch-=dy*.005;
      pitch=Math.max(-Math.PI/2.5,Math.min(Math.PI/3,pitch));
      active.lastX=t.clientX;active.lastY=t.clientY;
      gauge(currentFrac(active,active.kind));
      break;
    }
  },true);

  document.addEventListener('touchend',e=>{
    if(!active||typeof active.pointerId!=='string'||!String(active.pointerId).startsWith('touch:'))return;
    const tid=Number(String(active.pointerId).slice(6));
    const found=[...(e.changedTouches||[])].some(t=>t.identifier===tid);
    if(!found)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    recentTouchUntil=performance.now()+650;
    finishHeavy(active,false);
  },true);

  document.addEventListener('touchcancel',e=>{
    if(!active||typeof active.pointerId!=='string'||!String(active.pointerId).startsWith('touch:'))return;
    e.preventDefault();
    e.stopImmediatePropagation();
    recentTouchUntil=performance.now()+650;
    finishHeavy(active,true);
  },true);

  document.addEventListener('mousedown',e=>{
    if(!battle()||!playerFighter?.alive||e.button!==0)return;
    if(excludedTarget(e.target))return;
    if(performance.now()<recentTouchUntil){
      if(playerFighter.weapon?.category==='charger'||playerFighter.weapon?.category==='spinner'){
        e.preventDefault();e.stopImmediatePropagation();
      }
      return;
    }
    const w=playerFighter.weapon;
    if(w?.category!=='charger'&&w?.category!=='spinner')return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(active)return;
    startHeavy(w.category==='charger'?'charger':'spinner','mouse');
  },true);

  document.addEventListener('mousemove',e=>{
    if(!active||active.pointerId!=='mouse')return;
    gauge(currentFrac(active,active.kind));
  },true);

  document.addEventListener('mouseup',e=>{
    if(e.button!==0)return;
    if(!active||active.pointerId!=='mouse')return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finishHeavy(active,false);
  },true);

  window.addEventListener('blur',()=>{
    if(active)finishHeavy(active,true);
  });

  /* ----------------------------------------------------------
     Main-shot ink audit.
     This is intentionally an audit rather than a second firing path:
     if a normal successful tryShoot changed lastShot but didn't spend ink,
     charge exactly once here.
     ---------------------------------------------------------- */
  const baseTry=window.tryShoot;
  if(typeof baseTry==='function'){
    const guardedTry=function(f,dir,now){
      if(!f?.alive)return false;
      const w=f.weapon;
      if(w?.category==='charger'||w?.category==='spinner')return false;
      const beforeInk=num(f.ink,0);
      const beforeLast=num(f.lastShot,0);
      const result=!!baseTry(f,dir,now);
      const specialMode=!!f.__v91Mode;
      const didShot=!specialMode &&
        (num(f.lastShot,0)!==beforeLast) &&
        result;
      if(didShot && num(f.ink,0)>=beforeInk-0.000001){
        consumeAmount(f,Math.max(.1,num(w?.inkCost,1)));
      }
      return result;
    };
    window.tryShoot=guardedTry;
    try{tryShoot=guardedTry;}catch(_){}
  }

  /* Dynamo / roller audit. */
  const baseMove=window.updatePlayerMovement;
  if(typeof baseMove==='function'){
    const guardedMove=function(dt){
      const f=playerFighter;
      const w=f?.weapon;
      const isRoller=!!(f?.alive&&w?.category==='roller');
      const beforeInk=isRoller?num(f.ink,0):0;
      const beforeSwing=isRoller?num(f.lastSwing,0):0;
      const beforeMoving=isRoller?!!f._moving:false;
      const out=baseMove(dt);

      if(isRoller){
        const afterSwing=num(f.lastSwing,0);
        const firedMarker=afterSwing!==beforeSwing;
        const movingNow=!!f._moving || beforeMoving;
        if(firedMarker && num(f.ink,0)>=beforeInk-0.000001){
          const emergencyCost=movingNow?2.5:6.0;
          consumeAmount(f,emergencyCost);
        }
      }
      return out;
    };
    window.updatePlayerMovement=guardedMove;
    try{updatePlayerMovement=guardedMove;}catch(_){}
  }

  setInterval(()=>{
    if(!active)return;
    const f=active.target;
    if(!f?.alive){finishHeavy(active,true);return;}
    gauge(currentFrac(active,active.kind));
    if(active.kind==='charger'){
      f.isCharging=true;
      f.chargeStart=active.start;
    }else{
      f._v60ChargeStart=active.start;
      f.spinnerCharging=true;
      f.spinnerChargeStart=active.start;
    }
  },40);

  window.__V112_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] ready');
})();
