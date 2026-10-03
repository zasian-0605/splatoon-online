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
      canonicalMousePointerId=e.pointerId;
      try{e.target?.setPointerCapture?.(e.pointerId);}catch(_){}
      startCanonicalHoldFire();
      try{window.directPlayerShot?.();}catch(err){
        try{console.warn('[V127 pointer shot]',err);}catch(_){}
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
    startCanonicalHoldFire();
    try{window.directPlayerShot?.();}catch(_){}
    isShooting=true;
  }

  function endDesktop(e){
    if(e.pointerType==='touch')return;
    if(e.type==='mouseup'&&e.button!==0)return;
    if(e.type==='pointerup'&&e.button!==0)return;
    const current=player();
    /* Normal mouse fire is released by mouseup only. */
    if(e.type==='pointerup'&&current?.weapon&&
       !['charger','spinner','wiper','roller'].includes(current.weapon.category)&&!current.weapon.brush){
      return;
    }
    if(!battle()&& !heavy){stopCanonicalHoldFire();return;}
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
    stopCanonicalHoldFire();
    isShooting=false;
    if(e.type==='mouseup')suppressMouseUntil=performance.now()+50;
  }

  /* Window capture runs before the old document-level handlers. */
  window.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')beginDesktop(e);},true);
  window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')endDesktop(e);},true);

  /* Pointer cancellation is a valid end-of-input path too. */
  window.addEventListener('pointercancel',e=>{
    if(e.pointerType!=='mouse')return;
    const current=player();
    if(!chargerInput&&!heavy&&!current?.__rollerInput&&current?.weapon&&
       !['charger','spinner','wiper','roller'].includes(current.weapon.category)&&!current.weapon.brush){
      return;
    }
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

      /* V127: normal held-fire has exactly one owner. */
      return result;
    };
    try{updatePlayerMovement=window.updatePlayerMovement;}catch(_){}
  }

  window.__V116_UPDATE_BULLETS=updateUnifiedBullets;
  window.__V117_CANONICAL_RUNTIME={
    build:'V128-HOLD-FIRE-AND-AUTHORITATIVE-HP-2026-10-03',
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
let canonicalMouseHeld=false;
  let canonicalHoldFrame=0;
  let canonicalMousePointerId=null;
  function isCanonicalNormalWeapon(f){
    return !!f?.alive&&!!f.isPlayer&&!!f.weapon&&
      !isSquid(f)&&!['charger','spinner','wiper','roller'].includes(f.weapon.category)&&!f.weapon.brush;
  }
  function fireCanonicalHeldShot(f,now){
    if(!isCanonicalNormalWeapon(f)||!battle())return false;
    const rate=Math.max(1,num(f.weapon?.rate,100));
    const next=num(f.__v127HeldNextShotAt,0);
    if(now<next)return false;
    f.__v127HeldNextShotAt=now+rate;
    /*
     * The legacy runtime has several lastShot writers. Temporarily clear only
     * those legacy gates; the canonical hold loop owns its own cooldown.
     */
    const savedLast=f.lastShot;
    const savedNext=f.__canonicalNextShotAt;
    try{
      f.lastShot=0;
      f.__canonicalNextShotAt=0;
      return !!fireBasic(f,aimDir(f),now);
    }catch(err){
      try{console.warn('[V128 held-fire]',err);}catch(_){}
      return false;
    }finally{
      if(!Number.isFinite(Number(f.lastShot))||Number(f.lastShot)<=0)f.lastShot=savedLast;
      if(!Number.isFinite(Number(f.__canonicalNextShotAt))||Number(f.__canonicalNextShotAt)<=0)f.__canonicalNextShotAt=savedNext;
    }
  }
  function startCanonicalHoldFire(){
    canonicalMouseHeld=true;
    if(canonicalHoldFrame)return;
    const tick=()=>{
      if(!canonicalMouseHeld){
        canonicalHoldFrame=0;
        return;
      }
      const f=player();
      fireCanonicalHeldShot(f,performance.now());
      canonicalHoldFrame=requestAnimationFrame(tick);
    };
    canonicalHoldFrame=requestAnimationFrame(tick);
  }
  function stopCanonicalHoldFire(){
    canonicalMouseHeld=false;
    if(canonicalHoldFrame){
      cancelAnimationFrame(canonicalHoldFrame);
      canonicalHoldFrame=0;
    }
    canonicalMousePointerId=null;
  }

  