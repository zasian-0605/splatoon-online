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
