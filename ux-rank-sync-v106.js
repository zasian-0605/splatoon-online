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
        if(isSquidPlayer())return false;
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
