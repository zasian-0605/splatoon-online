/* --- begin ai-smooth-start-v105.js --- */
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
/* --- end ai-smooth-start-v105.js --- */

/* --- begin ux-rank-sync-v106.js --- */
/* V106: final UX + rank realtime + squid action lock.
   - Hide control/tutorial text until gameplay actually starts.
   - While squid, attack inputs do nothing; do not auto-humanize.
   - Record local CPU results to the authenticated server account.
   - Show live rank/rating and immediate +/- rating result.
*/
(function(){
  'use strict';
  const BUILD='V106-REALTIME-RANK-NO-SQUID-HUMANIZE-TUTORIAL-2026-10-02';

  function $ (id){return document.getElementById(id);}
  function profileNow(){
    try{return window.playerAccount?.profile||null;}catch(_){return null;}
  }
  function isBattle(){return currentPhase===1.5||currentPhase===2;}
  function isSquidPlayer(){
    try{return !!playerFighter?.alive&&!!playerFighter?.squid_mode;}catch(_){return false;}
  }

  // Hide the instruction/tutorial panel outside actual gameplay.
  function syncInstructionVisibility(){
    const el=$('instructions');
    if(!el)return;
    el.style.display=isBattle()?'block':'none';
  }
  syncInstructionVisibility();
  setInterval(syncInstructionVisibility,200);

  // Squid form has no attacks. Prevent the older V66 "humanize then shoot"
  // mousedown path from seeing the attack click.
  document.addEventListener('mousedown',function(e){
    if(!isBattle()||!isSquidPlayer())return;
    if(e.target?.closest?.('#minimap,#fullmap,#online-panel,#result-screen,.mobile-btn,#gear-panel'))return;
    if(e.button===0||e.button===2){
      e.preventDefault();
      e.stopImmediatePropagation();
      try{isShooting=false;}catch(_){}
    }
  },true);

  // Same rule for keyboard-triggered sub/special helpers.
  try{
    const oldSub=window.doPlayerSubThrow;
    if(typeof oldSub==='function'&&!oldSub.__v106){
      const fn=function(){
        return oldSub.apply(this,arguments);
      };
      fn.__v106=true;window.doPlayerSubThrow=fn;
      try{doPlayerSubThrow=fn;}catch(_){}
    }
  }catch(_){}

  try{
    const oldSpecial=window.fireSpecial;
    if(typeof oldSpecial==='function'&&!oldSpecial.__v106){
      const fn=function(f){
        if(f?.isPlayer&&f.squid_mode)return false;
        if(!f&&isSquidPlayer())return false;
        return oldSpecial.apply(this,arguments);
      };
      fn.__v106=true;window.fireSpecial=fn;
      try{fireSpecial=fn;}catch(_){}
    }
  }catch(_){}

  // ---- Live rating HUD ---------------------------------------------------
  let hud=$('v106-rank-hud');
  if(!hud){
    hud=document.createElement('div');
    hud.id='v106-rank-hud';
    Object.assign(hud.style,{
      position:'fixed',left:'16px',top:'16px',zIndex:'150',
      padding:'8px 13px',borderRadius:'12px',
      border:'2px solid rgba(255,255,255,.85)',
      background:'rgba(5,5,15,.82)',color:'#fff',
      font:'900 14px/1.25 Arial,Meiryo,sans-serif',
      textShadow:'1px 1px 2px #000',
      pointerEvents:'none',display:'none',
      boxShadow:'0 4px 14px rgba(0,0,0,.35)'
    });
    document.body.appendChild(hud);
  }

  let lastShownProfile='';
  function showRank(profile,detail){
    if(!hud||!profile)return;
    const p=JSON.stringify([profile.name,profile.rank,profile.rating,profile.wins,profile.losses,profile.games,detail||'']);
    if(p===lastShownProfile&&hud.style.display==='block')return;
    lastShownProfile=p;
    hud.innerHTML='<div>腕前 <b>'+String(profile.rank||'-')+'</b>　レート <b>'+Number(profile.rating||0)+'</b></div>'+
      '<div style="font-size:11px;color:#ddd;margin-top:2px;">勝 '+Number(profile.wins||0)+'　負 '+Number(profile.losses||0)+'　試合 '+Number(profile.games||0)+(detail?'<br><span style="color:#e3ff00;">'+detail+'</span>':'')+'</div>';
    hud.style.display='block';
  }
  window.__V106_SHOW_RANK=showRank;

  function updateHud(){
    const p=profileNow();
    if(!p){
      if(!isBattle()&&(currentPhase!==3)){if(hud)hud.style.display='none';}
      return;
    }
    const shouldShow=isBattle()||currentPhase===3;
    if(shouldShow)showRank(p);
    else if(hud)hud.style.display='none';
  }
  setInterval(updateHud,300);

  function rankValue(p){return Number(p?.rating??750);}
  function accountIsServer(){
    try{return !!window.playerAccount?.online&&!!window.playerAccount?.token&&window.playerAccount?.profile?.name&&window.playerAccount.profile.name!=='Guest';}
    catch(_){return false;}
  }

  function serverOrigin(){
    try{
      const o=(typeof getOnlineServerOrigin==='function'?getOnlineServerOrigin():'')||location.origin;
      return String(o).replace(/\/$/,'');
    }catch(_){return String(location.origin||'').replace(/\/$/,'');}
  }

  async function recordServerCpuResult(winnerTeam){
    if(!accountIsServer()||onlineActive)return null;

    const before=profileNow()?Object.assign({},profileNow()):null;
    showRank(before,'');
    if(hud)hud.innerHTML='<div>腕前を更新中…</div>';

    try{
      const res=await fetch(serverOrigin()+'/api/account/result',{
        method:'POST',
        cache:'no-store',
        headers:{
          'Content-Type':'application/json',
          'Accept':'application/json',
          'Authorization':'Bearer '+String(window.playerAccount.token)
        },
        body:JSON.stringify({
          winnerTeam:String(winnerTeam||'DRAW'),
          team:String(playerFighter?.team||'A')
        })
      });
      const d=await res.json().catch(()=>null);
      if(!res.ok||!d?.ok||!d.profile)throw new Error(d?.error||('HTTP '+res.status));

      const after=d.profile;
      window.playerAccount.profile=after;
      localStorage.setItem('splatoonAccountProfile',JSON.stringify(after));
      window.updateAccountProfileUI?.(after);

      const oldR=rankValue(before),newR=rankValue(after),diff=newR-oldR;
      const detail=diff>0
        ? '勝利！　腕前 +'+diff+'　→ '+after.rank+' / '+newR
        : diff<0
        ? '敗北　腕前 '+diff+'　→ '+after.rank+' / '+newR
        : '引き分け　レート変化なし';
      showRank(after,detail);
      try{window.showToast?.(detail);}catch(_){}
      return after;
    }catch(err){
      try{window.showToast?.('腕前更新に失敗しました');}catch(_){}
      showRank(profileNow(),'腕前更新失敗：通信を確認してください');
      return null;
    }
  }

  // The base V38 endBattle already handles the offline local-account path.
  // For server-authenticated accounts in a local CPU battle, add the missing
  // server-side result report once.
  let resultBusy=false;
  try{
    const oldEnd=endBattle;
    const wrapped=function(){
      if(resultBusy)return oldEnd.apply(this,arguments);
      const shouldServer=accountIsServer()&&!onlineActive;
      let winner='DRAW';
      try{
        computeTurf();
        const a=Number(turfPct.a)||0,b=Number(turfPct.b)||0;
        winner=playerFighter?.team==='A'?(a>=b?'A':'B'):(b>=a?'A':'B');
      }catch(_){}

      const before=profileNow()?Object.assign({},profileNow()):null;
      const out=oldEnd.apply(this,arguments);

      if(shouldServer){
        resultBusy=true;
        recordServerCpuResult(winner).finally(()=>{resultBusy=false;});
      }else if(profileNow()){
        const after=profileNow(),diff=rankValue(after)-rankValue(before);
        if(diff!==0||currentPhase===3){
          showRank(after,diff>0?'勝利！　腕前 +'+diff+'　→ '+after.rank:'結果反映済み');
        }
      }
      return out;
    };
    endBattle=wrapped;
    window.endBattle=wrapped;
  }catch(_){}

  // Make the account/profile HUD update instantly when another code path changes it.
  try{
    const oldUI=window.updateAccountProfileUI;
    if(typeof oldUI==='function'&&!oldUI.__v106){
      const fn=function(profile){
        const out=oldUI.apply(this,arguments);
        if(isBattle()||currentPhase===3)showRank(profile);
        return out;
      };
      fn.__v106=true;
      window.updateAccountProfileUI=fn;
    }
  }catch(_){}

  window.__V106_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] active');
})();
/* --- end ux-rank-sync-v106.js --- */

/* --- begin howto-v107.js --- */
/* V107: large always-available How To Play button / V108 full key guide.
   - A large, clearly visible button is shown during every gameplay phase.
   - The overlay contains every gameplay instruction currently shown in #instructions,
     plus the related lobby/practice shortcuts already used by the game.
   - Key/button labels are displayed as large keycaps so the controls are easy to scan.
   - Does not change gameplay controls; only replaces/expands the help UI.
*/
(function(){
  'use strict';
  const BUILD='V108-LARGE-HOWTO-FULL-KEY-GUIDE-2026-10-02';

  const style=document.createElement('style');
  style.textContent=String.raw`
    #v107-howto-button{
      position:fixed;
      top:58px;
      right:16px;
      z-index:240;
      display:none;
      min-width:190px;
      padding:14px 22px;
      border:3px solid #fff;
      border-radius:14px;
      background:#2f059c;
      color:#fff;
      font:900 20px/1 Arial Black,Arial,Meiryo,sans-serif;
      text-shadow:2px 2px 0 #000;
      box-shadow:0 5px 0 rgba(0,0,0,.45),0 0 18px rgba(227,255,0,.35);
      cursor:pointer;
      pointer-events:auto;
      touch-action:manipulation;
    }
    #v107-howto-button:active{
      transform:translateY(3px);
      box-shadow:0 2px 0 rgba(0,0,0,.45),0 0 12px rgba(227,255,0,.35);
    }

    #v107-howto-overlay{
      position:fixed;
      inset:0;
      z-index:260;
      display:none;
      align-items:center;
      justify-content:center;
      padding:20px;
      box-sizing:border-box;
      background:rgba(4,0,18,.90);
      pointer-events:auto;
    }
    #v107-howto-card{
      width:min(980px,95vw);
      max-height:90vh;
      overflow:auto;
      box-sizing:border-box;
      padding:28px;
      border:4px solid #fff;
      border-radius:22px;
      background:linear-gradient(180deg,#3508aa,#16052f);
      color:#fff;
      font-family:Arial,Meiryo,sans-serif;
      box-shadow:0 14px 40px rgba(0,0,0,.60);
    }
    #v107-howto-title{
      font:900 38px/1.1 Arial Black,Arial,Meiryo,sans-serif;
      text-align:center;
      margin:0 0 8px;
      text-shadow:3px 3px 0 #000;
    }
    #v107-howto-subtitle{
      text-align:center;
      color:#eee;
      font-size:15px;
      margin:0 0 20px;
    }
    #v107-howto-body{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:14px;
    }
    .v107-help-box{
      padding:16px;
      border:2px solid rgba(255,255,255,.62);
      border-radius:14px;
      background:rgba(0,0,0,.23);
    }
    .v107-help-box.full{
      grid-column:1 / -1;
    }
    .v107-help-box b{
      display:block;
      color:#e3ff00;
      font-size:20px;
      margin-bottom:9px;
    }
    .v107-help-row{
      display:flex;
      align-items:center;
      gap:10px;
      flex-wrap:wrap;
      margin:7px 0;
      font-size:17px;
      line-height:1.45;
    }
    .v107-key{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:42px;
      min-height:38px;
      padding:4px 10px;
      box-sizing:border-box;
      border:2px solid #fff;
      border-bottom-width:5px;
      border-radius:9px;
      background:#111;
      color:#fff;
      font:900 17px/1 Arial Black,Arial,Meiryo,sans-serif;
      box-shadow:0 2px 0 rgba(0,0,0,.5);
    }
    .v107-key.wide{min-width:102px;}
    .v107-mouse{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:108px;
      min-height:38px;
      padding:4px 10px;
      border:2px solid #fff;
      border-radius:9px;
      background:#101825;
      color:#e3ff00;
      font:900 16px/1 Arial,Meiryo,sans-serif;
    }
    .v107-note{
      color:#ddd;
      font-size:13px;
      line-height:1.5;
      margin-top:5px;
    }
    .v107-highlight{
      color:#e3ff00;
      font-weight:900;
    }
    #v107-howto-close{
      display:block;
      margin:20px auto 0;
      min-width:210px;
      padding:13px 24px;
      border:0;
      border-radius:12px;
      background:#e3ff00;
      color:#2f059c;
      font:900 19px/1 Arial Black,Arial,Meiryo,sans-serif;
      cursor:pointer;
      pointer-events:auto;
    }
    /* Culture-festival quick scan: make the important instructions impossible to miss. */
    .v107-culture-banner{
      margin:0 0 14px;
      padding:14px 16px;
      border:4px solid #e3ff00;
      border-radius:16px;
      background:#ff0055;
      color:#fff;
      font:900 21px/1.35 Arial Black,Arial,Meiryo,sans-serif;
      text-align:center;
      text-shadow:3px 3px 0 #000;
      box-shadow:0 6px 0 #000;
    }
    .v107-online-route{
      border:5px solid #00d4ff;
      background:rgba(0,212,255,.13);
    }
    .v107-online-route .v107-step{
      margin:10px 0;
      padding:11px 13px;
      border-radius:12px;
      background:rgba(0,0,0,.34);
      font:900 19px/1.45 Arial,Meiryo,sans-serif;
    }
    .v107-online-route .v107-step strong{
      color:#e3ff00;
      font-size:23px;
    }
    .v107-online-warning{
      margin-top:11px;
      padding:11px 13px;
      border-radius:12px;
      background:rgba(255,0,85,.24);
      border:2px solid rgba(255,255,255,.7);
      font-weight:900;
    }
    /* Canonical charger charge ring: keep it clearly visible while held. */
    #charge-gauge{
      width:74px !important;
      height:74px !important;
      border:3px solid rgba(255,255,255,.9) !important;
      background:conic-gradient(#ff0055 calc(var(--pct,0)*1%), rgba(255,255,255,.15) 0) !important;
      opacity:1 !important;
      z-index:1000 !important;
    }
    html.charger-charging #charge-gauge{
      width:74px !important;
      height:74px !important;
      border:3px solid rgba(255,255,255,.95) !important;
      opacity:1 !important;
    }
    html.charger-charging #charge-gauge::after{
      top:5px !important;
      left:5px !important;
      right:5px !important;
      bottom:5px !important;
      background:rgba(20,0,50,.5) !important;
    }
    @media(max-width:700px){
      #v107-howto-button{
        top:10px;
        right:10px;
        min-width:150px;
        padding:11px 14px;
        font-size:17px;
      }
      #v107-howto-card{padding:18px;}
      #v107-howto-title{font-size:30px;}
      #v107-howto-body{grid-template-columns:1fr;}
      .v107-help-box.full{grid-column:auto;}
      .v107-help-row{font-size:15px;}
      .v107-key{min-width:38px;min-height:34px;font-size:15px;}
      .v107-mouse{min-width:95px;min-height:34px;font-size:14px;}
      .v107-culture-banner{font-size:18px;box-shadow:0 4px 0 #000;}
      .v107-online-route .v107-step{font-size:17px;}
      .v107-online-route .v107-step strong{font-size:20px;}
    }
  `;

  /* U: キーボードだけを表示。各キーから線を伸ばして役割を示す。 */
  style.textContent += String.raw`
    #v107-howto-card{width:min(980px,94vw);max-height:90vh;overflow:auto;padding:28px;background:rgba(0,0,0,.88);border:4px solid #fff;border-radius:18px;box-sizing:border-box;}
    .v107-keyboard{display:flex;flex-direction:column;align-items:center;gap:26px;min-height:320px;justify-content:center;}
    .v107-krow{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;}
    .v107-kitem{position:relative;display:flex;flex-direction:column;align-items:center;min-width:78px;}
    .v107-kitem i{width:2px;height:30px;background:#e3ff00;display:block;}
    .v107-kitem small{min-height:22px;color:#fff;font:900 15px/1.2 Arial,Meiryo,sans-serif;white-space:nowrap;}
    .v107-key{display:inline-flex;align-items:center;justify-content:center;min-width:58px;height:48px;padding:4px 10px;box-sizing:border-box;border:3px solid #fff;border-bottom-width:6px;border-radius:9px;background:#111;color:#fff;font:900 20px/1 Arial Black,Arial,Meiryo,sans-serif;}
    .v107-key.wide{min-width:100px;}
    .v107-key.space{min-width:180px;}
    .v107-mouse-guide{margin-top:8px;text-align:center;}
    .v107-mouse-head{position:relative;width:74px;height:108px;margin:0 auto;border:3px solid #fff;border-radius:34px 34px 28px 28px;background:#111;box-sizing:border-box;}
    .v107-mouse-left,.v107-mouse-right{position:absolute;top:0;width:50%;height:48px;}
    .v107-mouse-left{left:0;border-right:2px solid #777;}
    .v107-mouse-right{right:0;}
    .v107-mouse-wheel{position:absolute;left:50%;top:13px;transform:translateX(-50%);width:10px;height:22px;border:2px solid #fff;border-radius:7px;}
    .v107-mouse-lines{display:flex;justify-content:center;gap:14px;height:28px;}
    .v107-mouse-lines span{width:2px;background:#e3ff00;display:block;}
    .v107-mouse-labels{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;color:#fff;font:900 14px/1.2 Arial,Meiryo,sans-serif;}
    @media(max-width:700px){.v107-keyboard{gap:20px}.v107-krow{gap:7px}.v107-kitem{min-width:62px}.v107-kitem i{height:22px}.v107-key{min-width:48px;height:42px;font-size:17px}.v107-key.space{min-width:135px}.v107-kitem small{font-size:12px}}
  `;
  document.head.appendChild(style);

  const button=document.createElement('button');
  button.id='v107-howto-button';
  button.type='button';
  button.textContent='U / 操作説明';
  document.body.appendChild(button);

  const overlay=document.createElement('div');
  overlay.id='v107-howto-overlay';
  overlay.innerHTML=`
    <div id="v107-howto-card" role="dialog" aria-modal="true" aria-label="キーボード操作">
      <div style="text-align:center;color:#e3ff00;font:900 16px Arial,Meiryo,sans-serif;margin-bottom:10px;">Uで閉じる</div>
      <div class="v107-keyboard">
        <div class="v107-krow">
          <div class="v107-kitem"><span class="v107-key">Q</span><i></i><small>サブ</small></div>
          <div class="v107-kitem"><span class="v107-key">W</span><i></i><small>前進</small></div>
          <div class="v107-kitem"><span class="v107-key">E</span><i></i><small>カスタマイズ</small></div>
          <div class="v107-kitem"><span class="v107-key">R</span><i></i><small>スペシャル</small></div>
          <div class="v107-kitem"><span class="v107-key">3</span><i></i><small>オンライン</small></div>
          <div class="v107-kitem"><span class="v107-key">O</span><i></i><small>CPと戦う</small></div>
          <div class="v107-kitem"><span class="v107-key">P</span><i></i><small>オンラインで戦う</small></div>
        </div>
        <div class="v107-krow">
          <div class="v107-kitem"><span class="v107-key">A</span><i></i><small>左</small></div>
          <div class="v107-kitem"><span class="v107-key">S</span><i></i><small>後退</small></div>
          <div class="v107-kitem"><span class="v107-key">D</span><i></i><small>右</small></div>
        </div>
        <div class="v107-krow">
          <div class="v107-kitem"><span class="v107-key wide">Shift</span><i></i><small>イカ</small></div>
          <div class="v107-kitem"><span class="v107-key space">Space</span><i></i><small>ジャンプ</small></div>
        </div>
        <div class="v107-mouse-guide">
          <div class="v107-mouse-head"><span class="v107-mouse-left"></span><span class="v107-mouse-wheel"></span><span class="v107-mouse-right"></span></div>
          <div class="v107-mouse-lines"><span></span><span></span><span></span></div>
          <div class="v107-mouse-labels"><small>左クリック：射撃</small><small>マウス：視点</small><small>右クリック：サブ</small></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close=()=>{
    overlay.style.display='none';
    try{window.requestPointerLockBack?.();}catch(_){}
  };
  const open=()=>{
    try{document.exitPointerLock?.();}catch(_){}
    try{window.__V10?.releaseLock?.();}catch(_){}
    overlay.style.display='flex';
  };

  button.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  overlay.addEventListener('click',e=>{
    if(e.target===overlay)close();
  });
  overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
  window.addEventListener('keydown',e=>{
    if(e.code==='Escape'&&overlay.style.display==='flex')close();
  },true);

  function sync(){
    const inGame=(typeof currentPhase!=='undefined')&&(currentPhase===1.5||currentPhase===2);
    button.style.display=inGame?'block':'none';
    if(!inGame)overlay.style.display='none';
  }
  setInterval(sync,150);
  sync();

  window.__V108_OPEN_HOWTO=open;
  window.__V108_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] full key guide active');
})();
/* --- end howto-v107.js --- */

/* --- begin mobile-controls-v109.js --- */
/* V109: robust mobile controls + U key How To Play.
   - U always opens the How To Play overlay during gameplay.
   - How To Play also opens on pointerdown, which works better with touch/pointer-lock browsers.
   - Mobile gets a real on-screen joystick with pointer events.
   - Mobile gets a dedicated right-side look/shoot pad.
   - Action buttons work with pointer events and are protected against duplicate touch/mouse firing.
   - Existing gameplay functions/keys are not changed for PC.
*/
(function(){
  'use strict';
  const BUILD='V109-MOBILE-CONTROLS-U-HOWTO-2026-10-02';

  const style=document.createElement('style');
  style.textContent=String.raw`
    #v109-look-pad{
      display:none;
      position:absolute;
      top:0;
      right:0;
      width:58%;
      height:100%;
      z-index:16;
      pointer-events:auto;
      touch-action:none;
      background:transparent;
      user-select:none;
      -webkit-user-select:none;
    }
    #v109-look-pad::after{
      content:'視点 ← スワイプ →';
      position:absolute;
      top:50%;
      right:8%;
      transform:translateY(-50%);
      padding:7px 11px;
      border:2px solid rgba(255,255,255,.35);
      border-radius:10px;
      background:rgba(0,0,0,.18);
      color:rgba(255,255,255,.55);
      font:800 12px Arial,Meiryo,sans-serif;
      pointer-events:none;
    }
    #v109-mobile-hint{
      display:none;
      position:absolute;
      left:50%;
      bottom:12px;
      transform:translateX(-50%);
      z-index:17;
      padding:6px 10px;
      border-radius:10px;
      background:rgba(0,0,0,.42);
      color:#fff;
      font:800 11px Arial,Meiryo,sans-serif;
      pointer-events:none;
      white-space:nowrap;
      text-shadow:1px 1px 2px #000;
    }
    #joystick-area{
      touch-action:none !important;
      user-select:none !important;
      -webkit-user-select:none !important;
    }
    #joystick-knob{
      transition:transform .03s linear;
    }
    .mobile-btn{z-index:25 !important;}\n    @media(max-width:800px){
      #v109-mobile-hint{display:none;}
      #v107-howto-button{touch-action:none !important;}
    }
  `;
  document.head.appendChild(style);

  const battle=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
  const howto=()=>window.__V108_OPEN_HOWTO||window.__V107_OPEN_HOWTO;

  /* ---------- How To Play: reliable U key + pointer/touch activation ---------- */
  function openHowTo(){
    if(!battle()) return false;
    const overlay=document.getElementById('v107-howto-overlay');
    if(overlay && overlay.style.display==='flex'){
      overlay.style.display='none';
      return true;
    }
    const fn=howto();
    if(typeof fn!=='function') return false;
    // Uの操作説明を開く瞬間は中央のポインターロック管理にも解除を通知する。
    try{ window.__V10?.releaseLock?.(); }catch(_){
      try{ document.exitPointerLock?.(); }catch(__){}
    }
    try{ fn(); }catch(_){ return false; }
    return true;
  }

  document.addEventListener('keydown',e=>{
    if(e.code!=='KeyU'||!battle()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openHowTo();
  },true);

  const howtoBtn=document.getElementById('v107-howto-button');
  if(howtoBtn){
    howtoBtn.addEventListener('pointerdown',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      openHowTo();
    },true);
    howtoBtn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      openHowTo();
    },true);
  }

  /* ---------- Mobile overlay controls ---------- */
  const ensureMobileOverlay=()=>{
    if(document.getElementById('v109-look-pad')) return;
    const battleUi=document.getElementById('battle-ui');
    if(!battleUi) return;

    const look=document.createElement('div');
    look.id='v109-look-pad';
    look.setAttribute('aria-label','スマホ視点・射撃エリア');
    battleUi.appendChild(look);

    const hint=document.createElement('div');
    hint.id='v109-mobile-hint';
    hint.textContent='左：移動　｜　右：視点・射撃　｜　ボタン：アクション';
    battleUi.appendChild(hint);
  };
  ensureMobileOverlay();

  const isMobile=()=>typeof playerConfig!=='undefined'&&playerConfig.device==='mobile';

  const leftZone=document.getElementById('joystick-area');
  const knob=document.getElementById('joystick-knob');
  const lookPad=document.getElementById('v109-look-pad');

  let joyId=null;
  let joyCx=0,joyCy=0;
  const joyMax=50;

  function resetJoy(){
    joyId=null;
    if(knob){
      knob.style.display='none';
      knob.style.transform='translate(-50%,-50%)';
    }
    if(typeof keys!=='undefined'){
      keys.w=keys.a=keys.s=keys.d=false;
    }
  }

  function updateJoy(clientX,clientY){
    let dx=clientX-joyCx;
    let dy=clientY-joyCy;
    const len=Math.hypot(dx,dy);
    if(len>joyMax){
      dx=dx/len*joyMax;
      dy=dy/len*joyMax;
    }
    if(knob){
      knob.style.display='block';
      knob.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
    }

    const dead=9;
    if(typeof keys!=='undefined'){
      keys.a=dx < -dead;
      keys.d=dx > dead;
      keys.w=dy < -dead;
      keys.s=dy > dead;
    }
  }

  if(leftZone){
    leftZone.style.pointerEvents='auto';
    leftZone.style.zIndex='18';

    leftZone.addEventListener('pointerdown',e=>{
      if(!isMobile()||!battle()) return;
      if(joyId!==null) return;
      e.preventDefault();
      e.stopPropagation();
      joyId=e.pointerId;
      const r=leftZone.getBoundingClientRect();
      joyCx=r.left+r.width/2;
      joyCy=r.top+r.height/2;
      try{leftZone.setPointerCapture(e.pointerId);}catch(_){}
      updateJoy(e.clientX,e.clientY);
    },true);

    leftZone.addEventListener('pointermove',e=>{
      if(e.pointerId!==joyId) return;
      e.preventDefault();
      e.stopPropagation();
      updateJoy(e.clientX,e.clientY);
    },true);

    const endJoy=e=>{
      if(e.pointerId!==joyId) return;
      e.preventDefault();
      e.stopPropagation();
      try{leftZone.releasePointerCapture(e.pointerId);}catch(_){}
      resetJoy();
    };
    leftZone.addEventListener('pointerup',endJoy,true);
    leftZone.addEventListener('pointercancel',endJoy,true);
    leftZone.addEventListener('lostpointercapture',()=>resetJoy(),true);
  }

  function aimFromCamera(){
    const d=new THREE.Vector3();
    camera.getWorldDirection(d);
    return d;
  }

  let lookId=null,lastLX=0,lastLY=0;
  if(lookPad){
    lookPad.addEventListener('pointerdown',e=>{
      if(!isMobile()||!battle()) return;
      if(e.target.closest?.('.mobile-btn')) return;
      e.preventDefault();
      e.stopPropagation();
      lookId=e.pointerId;
      lastLX=e.clientX;
      lastLY=e.clientY;
      try{lookPad.setPointerCapture(e.pointerId);}catch(_){}

      const f=playerFighter;
      if(f?.alive&&f.weapon?.category==='charger'&&window.__V119_CHARGER_UNIFIED){
        return;
      }
      if(f?.alive&&f.weapon?.category!=='charger'&&f.weapon?.category!=='spinner'&&f.weapon?.category!=='wiper'){
        isShooting=true;
      }else if(f?.alive&&f.weapon?.category==='charger'){
        f.isCharging=true;
        f.chargeStart=performance.now();
        const g=document.getElementById('charge-gauge'); if(g)g.style.display='block';
      }
    },true);

    lookPad.addEventListener('pointermove',e=>{
      if(e.pointerId!==lookId) return;
      e.preventDefault();
      e.stopPropagation();
      const dx=e.clientX-lastLX;
      const dy=e.clientY-lastLY;
      if(typeof yaw==='number') yaw-=dx*0.005;
      if(typeof pitch==='number'){
        pitch-=dy*0.005;
        pitch=Math.max(-Math.PI/2.5,Math.min(Math.PI/3,pitch));
      }
      lastLX=e.clientX;
      lastLY=e.clientY;
    },true);

    const endLook=e=>{
      if(e.pointerId!==lookId) return;
      e.preventDefault();
      e.stopPropagation();
      try{lookPad.releasePointerCapture(e.pointerId);}catch(_){}
      const f=playerFighter;
      if(f?.alive&&f.weapon?.category==='charger'&&f.isCharging){
        const frac=Math.min(1,(performance.now()-f.chargeStart)/(f.weapon.chargeTime||800));
        if(frac>0.08){
          try{fireChargerShot(f,aimFromCamera(),frac);}catch(_){}
        }
        f.isCharging=false;
        const g=document.getElementById('charge-gauge'); if(g)g.style.display='none';
      }
      if(f?.alive&&(f.weapon?.category==='spinner'||f.weapon?.category==='wiper')){
        /* Their established V60 touch handlers remain responsible for charge/release. */
      }
      isShooting=false;
      lookId=null;
    };
    lookPad.addEventListener('pointerup',endLook,true);
    lookPad.addEventListener('pointercancel',endLook,true);
  }

  /* ---------- Mobile action buttons ---------- */
  const actionLocks=new Map();
  const once=(key,fn)=>{
    const n=performance.now();
    const prev=actionLocks.get(key)||0;
    if(n-prev<180) return;
    actionLocks.set(key,n);
    try{fn();}catch(err){console.warn('[V109 mobile]',key,err);}
  };

  function bindButton(id,down,up){
    const el=document.getElementById(id);
    if(!el) return;
    el.style.touchAction='none';
    el.style.userSelect='none';
    el.style.webkitUserSelect='none';

    el.addEventListener('pointerdown',e=>{
      if(!isMobile()||!battle()) return;
      e.preventDefault();
      e.stopPropagation();
      try{el.setPointerCapture(e.pointerId);}catch(_){}
      down?.(e);
    },true);

    const end=e=>{
      if(!isMobile()) return;
      e.preventDefault();
      e.stopPropagation();
      up?.(e);
    };
    el.addEventListener('pointerup',end,true);
    el.addEventListener('pointercancel',end,true);
  }

  bindButton('btn-squid',
    ()=>{ keys.shift=true; },
    ()=>{ keys.shift=false; }
  );
  bindButton('btn-jump',
    ()=>{ once('jump',()=>{keys.space=true;}); },
    ()=>{ keys.space=false; }
  );
  bindButton('btn-sub',
    ()=>once('sub',()=>doPlayerSubThrow()),
    null
  );
  bindButton('btn-special',
    ()=>once('special',()=>fireSpecial(playerFighter)),
    null
  );
  bindButton('btn-map',
    ()=>once('map',()=>{
      const fn=window.__V10?.showMaps;
      if(typeof fn==='function') fn();
      else document.getElementById('fullmap').style.display='flex';
    }),
    null
  );
  bindButton('btn-nice',
    ()=>once('nice',()=>window.sendCallout?.('nice')),
    null
  );
  bindButton('btn-cmon',
    ()=>once('cmon',()=>window.sendCallout?.('cmon')),
    null
  );

  /* Block the older button touch/click handlers and handle each mobile button once.
     This prevents one tap from firing two subs/specials/callouts on touch browsers. */
  function mobileButtonAction(id){
    switch(id){
      case 'btn-sub': once('sub',()=>doPlayerSubThrow()); break;
      case 'btn-special': once('special',()=>fireSpecial(playerFighter)); break;
      case 'btn-map': once('map',()=>{
        const fn=window.__V10?.showMaps;
        if(typeof fn==='function') fn();
        else { const full=document.getElementById('fullmap'); if(full) full.style.display='flex'; }
      }); break;
      case 'btn-nice': once('nice',()=>window.sendCallout?.('nice')); break;
      case 'btn-cmon': once('cmon',()=>window.sendCallout?.('cmon')); break;
    }
  }

  document.addEventListener('touchstart',e=>{
    if(!isMobile()||!battle()) return;
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-squid') keys.shift=true;
    else if(el.id==='btn-jump') keys.space=true;
    else mobileButtonAction(el.id);
  },true);

  document.addEventListener('touchend',e=>{
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-squid') keys.shift=false;
    if(el.id==='btn-jump') keys.space=false;
  },true);

  document.addEventListener('touchcancel',e=>{
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-squid') keys.shift=false;
    if(el.id==='btn-jump') keys.space=false;
  },true);

  document.addEventListener('click',e=>{
    if(!isMobile()||!battle()) return;
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-sub') once('sub',()=>doPlayerSubThrow());
    else if(el.id==='btn-special') once('special',()=>fireSpecial(playerFighter));
    else if(el.id==='btn-map') once('map',()=>{
      const fn=window.__V10?.showMaps;
      if(typeof fn==='function') fn();
      else { const full=document.getElementById('fullmap'); if(full) full.style.display='flex'; }
    });
    else if(el.id==='btn-nice') once('nice',()=>window.sendCallout?.('nice'));
    else if(el.id==='btn-cmon') once('cmon',()=>window.sendCallout?.('cmon'));
  },true);

  /* Stop browser long-press context menus/scrolling on all mobile controls. */
  document.addEventListener('contextmenu',e=>{
    if(!isMobile()) return;
    if(e.target.closest?.('#battle-ui,.mobile-btn,#joystick-area,#v109-look-pad')){
      e.preventDefault();
    }
  },true);

  document.addEventListener('touchmove',e=>{
    if(!isMobile()||!battle()) return;
    if(e.target.closest?.('#battle-ui,#joystick-area,#v109-look-pad')){
      e.preventDefault();
    }
  },{passive:false,capture:true});

  function syncMobileUI(){
    const mobile=isMobile();
    const inGame=battle();
    if(lookPad){
      lookPad.style.display=(mobile&&inGame)?'block':'none';
      lookPad.style.pointerEvents=(mobile&&inGame)?'auto':'none';
    }
    if(leftZone){
      leftZone.style.display=(mobile&&inGame)?'block':'none';
      leftZone.style.pointerEvents=(mobile&&inGame)?'auto':'none';
      leftZone.style.zIndex='18';
    }
    const hint=document.getElementById('v109-mobile-hint');
    if(hint) hint.style.display=(mobile&&inGame)?'block':'none';

    ['btn-squid','btn-jump','btn-sub','btn-special','btn-map','btn-nice','btn-cmon'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el)return;
      /* Existing CSS positions these buttons; this only controls visibility. */
      if(inGame&&mobile) el.style.display='flex';
      else el.style.display='none';
    });
  }
  setInterval(syncMobileUI,150);
  syncMobileUI();

  window.__V109_OPEN_HOWTO=openHowTo;
  window.__V109_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] mobile controls + U How To Play active');
})();
/* --- end mobile-controls-v109.js --- */

/* --- begin account-persistence-v110.js --- */
/* V110: persistent account restore + stable display name.
   - Keeps the saved authentication token/profile in localStorage across refreshes.
   - Verifies the token before allowing the account gate to fall back to login.
   - Prevents a refresh race from showing Guest when a saved account exists.
   - Applies the authenticated display name to the local player and online UI.
*/
(function(){
  'use strict';
  const BUILD='V110-PERSISTENT-ACCOUNT-NAME-2026-10-02';
  const TOKEN_KEY='splatoonAccountToken';
  const PROFILE_KEY='splatoonAccountProfile';
  const NAME_KEY='splatoonAccountName';
  const GUEST_KEY='splatoonGuestIdV110';

  function read(key){
    try{return localStorage.getItem(key)||'';}catch(_){return '';}
  }
  function write(key,value){
    try{localStorage.setItem(key,String(value??''));}catch(_){}
  }
  function getOrigin(){
    try{
      const fn=typeof getOnlineServerOrigin==='function'?getOnlineServerOrigin:null;
      return String(fn?fn():location.origin).replace(/\/$/,'');
    }catch(_){return String(location.origin||'').replace(/\/$/,'');}
  }
  function cachedProfile(){
    try{
      const p=JSON.parse(read(PROFILE_KEY)||'null');
      return p&&p.name?p:null;
    }catch(_){return null;}
  }
  function applyProfile(p,token){
    if(!p||!p.name)return false;
    window.__accountReady=true;
    window.playerAccount=Object.assign({},window.playerAccount||{},{
      token:token||read(TOKEN_KEY),
      profile:p,
      online:!!(token||read(TOKEN_KEY))
    });
    write(TOKEN_KEY,token||read(TOKEN_KEY));
    write(PROFILE_KEY,JSON.stringify(p));
    write(NAME_KEY,p.name);
    try{window.updateAccountProfileUI?.(p);}catch(_){}
    try{window.showOnlineProfile?.(p);}catch(_){}
    try{
      if(typeof playerFighter!=='undefined'&&playerFighter){
        playerFighter.displayName=String(p.name);
        playerFighter.accountName=String(p.name);
        playerFighter.name=String(p.name);
      }
    }catch(_){}
    const name=document.getElementById('account-name');
    if(name)name.value=String(p.name);
    return true;
  }

  /* A stable browser-only guest identity is also kept, so guest reconnects
     do not become a different logical online user. */
  function ensureGuestId(){
    let id=read(GUEST_KEY);
    if(!/^[A-Za-z0-9_-]{12,64}$/.test(id)){
      try{
        id=crypto.randomUUID().replace(/-/g,'');
      }catch(_){
        id='g'+Date.now().toString(36)+Math.random().toString(36).slice(2);
      }
      id=id.replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
      write(GUEST_KEY,id);
    }
    return id;
  }
  window.__V110_GUEST_ID=ensureGuestId();

  const token=read(TOKEN_KEY);
  let authCheckDone=!token||location.protocol==='file:';
  let authChecking=!!token&&location.protocol!=='file:';
  let queuedStart=false;

  /* Preserve the currently installed account-gated starter. */
  const baseStart=(typeof startCustomizePhase==='function')?startCustomizePhase:null;
  if(baseStart){
    startCustomizePhase=function(){
      if(authChecking){
        queuedStart=true;
        try{
          const status=document.getElementById('account-status');
          if(status)status.textContent='保存したログイン情報を確認中…';
        }catch(_){}
        return;
      }
      return baseStart.apply(this,arguments);
    };
  }

  async function restore(){
    if(!token||location.protocol==='file:'){
      authCheckDone=true;
      authChecking=false;
      return;
    }

    const cached=cachedProfile();
    try{
      const r=await fetch(getOrigin()+'/api/account/me',{
        method:'GET',
        cache:'no-store',
        headers:{
          'Authorization':'Bearer '+token,
          'Accept':'application/json'
        }
      });
      const d=await r.json().catch(()=>null);
      if(!r.ok||!d?.ok||!d.profile)throw new Error('session invalid');
      applyProfile(d.profile,token);
      console.log('[SPLATOON ONLINE]['+BUILD+'] account restored:',d.profile.name);
    }catch(err){
      /* Do not silently turn a saved account into Guest.
         Keep the cached name visible until the user explicitly logs in again. */
      if(cached){
        try{window.updateAccountProfileUI?.(cached);}catch(_){}
        const name=document.getElementById('account-name');
        if(name)name.value=String(cached.name||'');
        window.__V110_AUTH_ERROR=String(err?.message||err);
      }else{
        try{localStorage.removeItem(TOKEN_KEY);}catch(_){}
        window.__V110_AUTH_ERROR='no-valid-session';
      }
    }finally{
      authCheckDone=true;
      authChecking=false;
      if(queuedStart){
        queuedStart=false;
        try{startCustomizePhase();}catch(e){console.warn('[V110 start]',e);}
      }
    }
  }

  /* If a prior cached profile exists, preload its visible name immediately.
     It is still server-verified above before the account gate proceeds. */
  const cached=cachedProfile();
  if(cached){
    try{
      const name=document.getElementById('account-name');
      if(name)name.value=String(cached.name||'');
      window.playerAccount=window.playerAccount||{token:null,profile:null,online:false};
      window.playerAccount.profile=cached;
      window.updateAccountProfileUI?.(cached);
    }catch(_){}
  }

  restore();

  /* Make every newly created local player carry the saved display name. */
  const applyNameTimer=setInterval(()=>{
    try{
      const p=window.playerAccount?.profile||cachedProfile();
      const f=typeof playerFighter!=='undefined'?playerFighter:null;
      if(f&&p?.name){
        f.displayName=String(p.name);
        f.accountName=String(p.name);
        f.name=String(p.name);
      }
      if(authCheckDone&&f)clearInterval(applyNameTimer);
    }catch(_){}
  },250);
  applyNameTimer.unref?.();

  /* Guest button is explicitly guest: it does not erase a saved account.
     The saved account remains available for the next refresh/login. */
  const guest=document.getElementById('account-guest');
  if(guest&&!guest.__v110){
    guest.__v110=true;
    guest.addEventListener('click',()=>{
      window.playerAccount=Object.assign({},window.playerAccount||{},{
        token:null,
        profile:{name:'ゲスト',rating:750,rank:'C-',wins:0,losses:0,games:0},
        online:false
      });
      try{window.playerFighter&&(window.playerFighter.displayName='ゲスト');}catch(_){}
    },true);
  }

  console.log('[SPLATOON ONLINE]['+BUILD+'] persistent account restore active');
})();
/* --- end account-persistence-v110.js --- */

/* --- begin team-disconnect-forfeit-v111.js --- */
/* V111: online team-disconnect forfeit result on the client.
   The server decides the winner. This only makes the result screen reflect that
   authoritative result instead of recomputing turf after a team has vanished.
*/
(function(){
  'use strict';
  const BUILD='V111-TEAM-DISCONNECT-FORFEIT-2026-10-02';

  const oldCompute=computeTurf;
  computeTurf=function(){
    const forced=window.__V111_FORCED_MATCH_RESULT;
    if(forced && (forced.winnerTeam==='A'||forced.winnerTeam==='B')){
      turfPct.a=forced.winnerTeam==='A'?100:0;
      turfPct.b=forced.winnerTeam==='B'?100:0;
      return;
    }
    return oldCompute();
  };

  const oldEnd=endBattle;
  endBattle=function(){
    const forced=window.__V111_FORCED_MATCH_RESULT;
    const out=oldEnd.apply(this,arguments);
    if(forced && (forced.winnerTeam==='A'||forced.winnerTeam==='B')){
      const won=playerFighter?.team===forced.winnerTeam;
      const title=document.getElementById('result-title');
      const detail=document.getElementById('result-detail');
      if(title){
        title.textContent=won?'WIN!!':'LOSE...';
        title.style.color=won?'#e3ff00':'#ff0055';
      }
      if(detail){
        detail.textContent=won
          ? '敵チームがいなくなったため勝利！'
          : '味方チームがいなくなったため敗北…';
      }
      try{window.showToast?.(won?'敵チーム離脱 → WIN!!':'味方チーム離脱 → LOSE...');}catch(_){}
    }
    /* Consume the one-shot server result so the next normal match uses turf. */
    window.__V111_FORCED_MATCH_RESULT=null;
    return out;
  };

  window.__V111_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] team disconnect forfeit UI active');
})();
/* --- end team-disconnect-forfeit-v111.js --- */

/* --- begin weapon-charge-ink-fix-v112.js --- */
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
  function setChargerChargeVisual(on){
    try{document.documentElement.classList.toggle('charger-charging',!!on);}catch(_){}
  }

  function hideGauge(){
    const g=document.getElementById('charge-gauge');
    if(g)g.style.display='none';
    setChargerChargeVisual(false);
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
    if(window.__V119_CHARGER_UNIFIED)return false;
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
      const expected=(num(w?.inkCost,7))*(0.55+0.90*q);
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
    if(window.__V119_CHARGER_UNIFIED&&kind==='charger')return false;
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
      setChargerChargeVisual(true);
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
    if(window.__V119_CHARGER_UNIFIED&&st.kind==='charger'){
      clearHeavyState(st.target,true);
      active=null;
      return false;
    }
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
    if(window.__V119_CHARGER_UNIFIED&&w?.category==='charger')return false;
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
    if(window.__V119_CHARGER_UNIFIED&&w?.category==='charger')return;
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
    if(window.__V119_CHARGER_UNIFIED&&w?.category==='charger')return;
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
/* --- end weapon-charge-ink-fix-v112.js --- */

/* --- begin radio-kids-simple-v113.js --- */
/* V113: kid-friendly Radio / News screen
   - Large, obvious "タップして次へ" button.
   - Tapping anywhere in the radio dialog advances it.
   - Space / Enter remain supported.
*/
(function(){
  'use strict';
  if(window.__V113_RADIO_READY)return;
  window.__V113_RADIO_READY=true;

  const style=document.createElement('style');
  style.textContent =
    '#news-screen{touch-action:manipulation;}'+
    '#dialogue-box{cursor:pointer;}'+
    '#v113-radio-next{'+
      'position:absolute;right:18px;top:18px;left:auto;bottom:auto;transform:none;z-index:120;'+
      'min-width:min(220px,42vw);padding:8px 14px;border:2px solid #fff;border-radius:10px;'+
      'background:#e3ff00;color:#2f059c;font:900 clamp(13px,2vw,18px)/1.05 Arial,Meiryo,sans-serif;'+
      'text-align:center;box-shadow:8px 8px 0 #000,0 0 24px rgba(227,255,0,.45);'+
      'cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation;}'+
    '#v113-radio-next:active{transform:translateY(3px) scale(.98);box-shadow:3px 3px 0 #000;}'+
    '#v113-radio-help{position:absolute;left:50%;bottom:2vh;transform:translateX(-50%);z-index:120;'+
      'color:#fff;font:900 clamp(13px,2.4vw,20px)/1.2 Arial,Meiryo,sans-serif;text-shadow:2px 2px 0 #000;'+
      'pointer-events:none;white-space:nowrap;}'+
    '@media(max-width:600px){'+
      '#v113-radio-next{right:10px;top:10px;min-width:150px;padding:8px 10px;border-width:2px;}'+
      '#v113-radio-help{bottom:3vh;}'+
    '}';
  document.head.appendChild(style);

  function isRadio(){
    return typeof currentPhase!=='undefined' && currentPhase===1;
  }

  let button=null;
  let help=null;

  function ensure(){
    const screen=document.getElementById('news-screen');
    if(!screen)return false;
    if(!button){
      button=document.createElement('button');
      button.id='v113-radio-next';
      button.type='button';
      button.textContent='タップして次へ ▶';
      screen.appendChild(button);
      button.addEventListener('pointerdown',e=>{
        if(!isRadio())return;
        e.preventDefault();
        e.stopImmediatePropagation();
        try{showNextLine();}catch(err){console.warn('[V113 radio]',err);}
      },true);
      button.addEventListener('click',e=>{
        if(!isRadio())return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },true);
    }
    if(!help){
      help=document.createElement('div');
      help.id='v113-radio-help';
      help.textContent='ここをタップすると次へ進みます';
      screen.appendChild(help);
    }
    return true;
  }

  function refreshLabel(){
    ensure();
    if(!button)return;
    const typing=typeof isTyping!=='undefined' && !!isTyping;
    button.textContent=typing ? 'タップして文字を全部見る ▶' : 'タップして次へ ▶';
  }

  const baseStart=window.startNewsPhase;
  if(typeof baseStart==='function'){
    window.startNewsPhase=function(){
      const r=baseStart.apply(this,arguments);
      ensure();
      refreshLabel();
      return r;
    };
    try{startNewsPhase=window.startNewsPhase;}catch(_){}
  }

  const baseNext=window.showNextLine;
  if(typeof baseNext==='function'){
    window.showNextLine=function(){
      const r=baseNext.apply(this,arguments);
      setTimeout(refreshLabel,0);
      return r;
    };
    try{showNextLine=window.showNextLine;}catch(_){}
  }

  document.addEventListener('pointerdown',e=>{
    if(!isRadio()||!ensure())return;
    if(e.target.closest?.('#v113-radio-next'))return;
    const target=e.target.closest?.('#dialogue-box,#news-image-area,#news-screen');
    if(!target)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try{showNextLine();}catch(err){console.warn('[V113 radio tap]',err);}
    setTimeout(refreshLabel,0);
  },true);

  window.addEventListener('keydown',e=>{
    if(!isRadio())return;
    if(e.code!=='Space'&&e.code!=='Enter')return;
    setTimeout(refreshLabel,0);
  },true);

  setTimeout(()=>{ensure();refreshLabel();},0);
  window.__V113_RADIO_BUILD='V113-KID-FRIENDLY-NEXT-2026-10-02';
  console.log('[SPLATOON ONLINE][V113] radio UI ready');
})();
/* --- end radio-kids-simple-v113.js --- */

/* --- begin ux-simplify-v114.js --- */
/* V114: simple kid-friendly UX */
(function(){
'use strict';
const s=document.createElement('style');
s.textContent=`
#next-prompt{display:none !important;}
#dialogue-box{cursor:pointer !important;}
#v113-radio-next{min-width:min(220px,42vw) !important;padding:8px 14px !important;font-size:clamp(13px,2vw,18px) !important;border-width:2px !important;border-radius:10px !important;box-shadow:4px 4px 0 #000 !important;}
#v113-radio-help{font-size:12px !important;bottom:1vh !important;}
#v114-practice-title{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:230;display:none;min-width:min(520px,86vw);box-sizing:border-box;padding:10px 30px 13px;border:5px solid #fff;border-radius:18px;background:#2f059c;color:#e3ff00;font:900 clamp(36px,6vw,64px)/1 Arial Black,Arial,Meiryo,sans-serif;text-align:center;text-shadow:4px 4px 0 #000;box-shadow:0 7px 0 rgba(0,0,0,.45),0 0 25px rgba(227,255,0,.35);pointer-events:none;}
#range-hint{font-size:clamp(15px,2.5vw,22px) !important;line-height:1.35 !important;}
#v107-howto-card{width:min(900px,94vw) !important;max-height:88vh !important;padding:22px !important;}
#v107-howto-title{font-size:clamp(30px,5vw,44px) !important;}
#v107-howto-subtitle{font-size:clamp(16px,2.8vw,21px) !important;color:#fff !important;}
@media(max-width:700px){#v114-practice-title{top:8px;border-width:3px;padding:8px 18px 10px;}}
`;
document.head.appendChild(s);
const title=document.createElement('div');
title.id='v114-practice-title';
title.textContent='🎯 試し撃ち場';
document.body.appendChild(title);
let shown=false,wasPractice=false;
function phase(){try{return Number(currentPhase)}catch(_){return -1}}
function sync(){
 const p=phase(),practice=p===1.5,playable=practice||p===2;
 title.style.display=practice?'block':'none';
 const hint=document.getElementById('range-hint');
 const inst=document.getElementById('instructions');
 const life=document.getElementById('alive-count');
 const teamHud=document.getElementById('v67-team-hud');
 if(practice&&hint)hint.innerHTML='🎯 試し撃ち場<br>好きなブキを自由に試そう！';
 if(practice&&inst)inst.innerHTML='WASD：うごく　Space：ジャンプ　Shift：イカ　左クリック：撃つ　Q：ボム　R：スペシャル';
 if(p===2&&inst)inst.innerHTML='WASD：うごく　Space：ジャンプ　Shift：イカ　左クリック：撃つ　Q：ボム　R：スペシャル';
 if(p===2&&life)life.style.display='none';
 if(p===2&&teamHud)teamHud.style.display='none';
 const next=document.getElementById('v113-radio-next');
 const help=document.getElementById('v113-radio-help');
 if(next)next.textContent='タップして次へ ▶';
 if(help)help.textContent='画面をタップして次へ';
 const titleEl=document.getElementById('v107-howto-title');
 const sub=document.getElementById('v107-howto-subtitle');
 if(titleEl)titleEl.textContent='🎮 まずは これだけ！';
 if(sub)sub.textContent='この画面を見ながら操作してみよう。';
 document.querySelectorAll('#v107-howto-body .v107-help-box').forEach(b=>{
  const x=(b.textContent||'').replace(/\s+/g,' ');
  if(x.includes('4 VS 4')||x.includes('前衛')||x.includes('中衛')||x.includes('後衛')||x.includes('試し撃ち場で使うキー'))b.style.display='none';
 });
 if(playable&&!shown){
  shown=true;
  setTimeout(()=>{try{window.__V108_OPEN_HOWTO?.()}catch(e){console.warn('[V114 auto help]',e)}},350);
 }
 if(!practice&&wasPractice&&p!==2)shown=false;
 wasPractice=practice;
}
setInterval(sync,180);
sync();
window.__V114_BUILD='V114-SIMPLE-KIDS-UX-AUTO-HOWTO-PRACTICE-2026-10-02';
})();
/* --- end ux-simplify-v114.js --- */
