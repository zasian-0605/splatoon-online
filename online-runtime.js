/* --- begin online-v93.js --- */
/* V93: Unified online runtime
   One WebSocket owner, one transport bridge, one room protocol.
   Legacy gameplay code may still call onlineSocket.send(); the compatibility
   proxy funnels those messages through this single V93 transport.
*/
(function(){
  'use strict';

  const BUILD='V97-ONLINE-MATCH-READY-2026-10-01';
  const SERVER_ORIGIN='https://splatoon-online-8r1r.onrender.com';
  const WS_URL=SERVER_ORIGIN.replace(/^https:/,'wss:').replace(/^http:/,'ws:');
  const state={
    build:BUILD, phase:'disconnected', socket:null, proxy:null, seq:0,
    roomId:'', playerId:'', team:'', ready:false, lastStateAt:0,
    lastSig:new Map()
  };
  window.__V93_ONLINE=state;
  window.__ONLINE_BUILD_ID=BUILD;

  const $=id=>document.getElementById(id);
  const log=(tag,data)=>{try{console.log('[SPLATOON ONLINE]['+BUILD+']['+tag+']',data);}catch(_){}};
  function persistentGuestId(){
    const key='splatoonGuestIdV110';
    let id='';
    try{id=String(localStorage.getItem(key)||'');}catch(_){}
    if(!/^[A-Za-z0-9_-]{12,64}$/.test(id)){
      try{
        if(globalThis.crypto?.randomUUID) id=globalThis.crypto.randomUUID().replace(/-/g,'');
        else id='g'+Date.now().toString(36)+Math.random().toString(36).slice(2);
      }catch(_){id='g'+Date.now().toString(36)+Math.random().toString(36).slice(2);}
      id=id.replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
      try{localStorage.setItem(key,id);}catch(_){}
    }
    return id;
  }
  function storedAuthToken(){
    try{return String(localStorage.getItem('splatoonAccountToken')||'');}catch(_){return '';}
  }

  function getPlayer(){
    try{if(typeof playerFighter!=='undefined'&&playerFighter)return playerFighter;}catch(_){}
    return window.playerFighter||null;
  }
  function getConfig(){
    try{if(typeof playerConfig!=='undefined'&&playerConfig)return playerConfig;}catch(_){}
    return window.playerConfig||{};
  }
  function getFighters(){
    try{if(typeof fighters!=='undefined'&&Array.isArray(fighters))return fighters;}catch(_){}
    return Array.isArray(window.fighters)?window.fighters:[];
  }
  function getWeapons(){
    try{if(typeof weaponList!=='undefined'&&Array.isArray(weaponList))return weaponList;}catch(_){}
    return Array.isArray(window.weaponList)?window.weaponList:[];
  }
  function setVars(){
    try{window.onlineActive=state.phase==='in_match';}catch(_){}
    try{window.onlineStarted=state.phase==='in_match';}catch(_){}
    try{window.onlineRoomId=state.roomId||'';}catch(_){}
    try{window.onlinePlayerId=state.playerId||'';}catch(_){}
    try{window.onlineTeam=state.team||'';}catch(_){}
    try{window.onlineReady=!!state.ready;}catch(_){}
  }
  function setStatus(s){try{window.setOnlineConnecting?.(s);}catch(_){}try{window.setOnlineStatus?.(s);}catch(_){}}
  function setCount(n,note){try{window.setOnlineCount?.(n,note);}catch(_){}}
  function renderRoom(players){
    const ps=Array.isArray(players)?players:[];
    window.__V93_LAST_ROOM_PLAYERS=ps;
    /* V97: V93 owns the real socket/state, so the Ready button must not depend
       on an older inline socket variable or an older panel-opening wrapper. */
    try{window.renderOnlineRoom?.(ps);}catch(_){}
    try{
      const roomEl=$('online-room');
      const lines=ps.map(p=>{
        const mark=p.ready?'✓':'　';
        const name=String(p.name||p.id||'');
        const team=p.team?' ['+p.team+']':'';
        const you=String(p.id||'')===String(state.playerId||'')?' ← YOU':'';
        return '['+mark+'] '+name+team+you;
      }).join('\n');
      if(roomEl)roomEl.textContent='部屋 '+(state.roomId||'----')+'\n'+ps.length+'/8人\n'+(lines||'まだ誰もいません');
      const ready=$('online-ready');
      if(ready){
        const canReady=state.phase==='room' && !!state.roomId && !!state.socket
          && state.socket.readyState===WebSocket.OPEN && ps.length>=2 && ps.length<8;
        ready.disabled=!canReady;
        ready.textContent=state.ready?'準備解除':'準備OK';
        ready.classList.toggle('ready',!!state.ready);
      }
      if(ps.length>=2 && ps.length<8){
        const msg=state.ready?'準備済み。ほかのプレイヤーを待っています':'2人以上参加中。準備OKを押してください';
        setStatus(msg);
        setCount(ps.length,msg);
      }
    }catch(_){}
  }

  function cleanPayload(m){
    const out={};
    for(const [k,v] of Object.entries(m||{}))if(k!=='type'&&k!=='_v93'&&k!=='clientSeq')out[k]=v;
    return out;
  }
  function signature(m){
    if(!m||!m.type)return '';
    const q=n=>Number.isFinite(Number(n))?Math.round(Number(n)*100)/100:n;
    switch(m.type){
      case 'state':return 'state|'+m.id+'|'+q(m.x)+'|'+q(m.y)+'|'+q(m.z)+'|'+q(m.yaw)+'|'+m.alive+'|'+m.squid;
      case 'shot':return 'shot|'+m.id+'|'+m.weaponId+'|'+q(m.x)+'|'+q(m.y)+'|'+q(m.z)+'|'+q(m.dx)+'|'+q(m.dy)+'|'+q(m.dz)+'|'+(m.mode||'')+'|'+q(m.charge);
      case 'paint':return 'paint|'+m.id+'|'+q(m.x)+'|'+q(m.z)+'|'+q(m.x2)+'|'+q(m.z2)+'|'+q(m.radius)+'|'+m.colorHex;
      case 'sub':return 'sub|'+m.id+'|'+m.subType+'|'+q(m.x)+'|'+q(m.z)+'|'+q(m.vx)+'|'+q(m.vz);
      case 'special':return 'special|'+m.id+'|'+(m.specialName||m.specialType||'')+'|'+q(m.x)+'|'+q(m.y)+'|'+q(m.z)+'|'+JSON.stringify(m.extra||{});
      default:return '';
    }
  }
  function rawSend(type,payload){
    const ws=state.socket;
    if(!ws||ws.readyState!==WebSocket.OPEN)return false;
    const msg=Object.assign({type:String(type||''),_v93:true,clientSeq:++state.seq},payload||{});
    try{ws.send(JSON.stringify(msg));return true;}catch(e){log('SEND_ERROR',{type,error:String(e)});return false;}
  }

  function sendOnlineShot(packet){
    if(!packet||typeof packet!=='object')return false;
    const out=Object.assign({},packet);
    delete out.type;
    delete out.roomId;
    delete out.team;
    return rawSend('shot',out);
  }
  window.__v93SendShot=sendOnlineShot;
  function forwardLegacy(data){
    let m;try{m=typeof data==='string'?JSON.parse(data):data;}catch(_){return false;}
    if(!m||typeof m!=='object'||typeof m.type!=='string')return false;
    if(m.type==='leaveQueue'){disconnect('legacy-leave');return true;}
    if(m.type==='state')return true;
    if(m.type==='joinQueue'){if(state.phase==='disconnected'||state.phase==='connecting')join();return true;}
    if(m.type==='bindAccount')return rawSend('bindAccount',{token:String(m.token||'')});
    if(state.phase!=='in_match'&&!['ready','keepalive'].includes(m.type))return false;
    // V93 owns the periodic state stream; legacy state sends are dropped here. Other gameplay packets still use this single transport.
    const sig=signature(m),now=performance.now();
    if(sig){
      const prev=state.lastSig.get(sig)||0;
      const windowMs=m.type==='state'?24:(m.type==='paint'?28:18);
      if(now-prev<windowMs)return true;
      state.lastSig.set(sig,now);
      if(state.lastSig.size>300)for(const [k,t] of state.lastSig)if(now-t>1000)state.lastSig.delete(k);
    }
    return rawSend(m.type,cleanPayload(m));
  }
  function makeProxy(){
    const ws=state.socket;
    const proxy={
      __v93Proxy:true,
      get readyState(){return ws?.readyState??WebSocket.CLOSED;},
      get url(){return ws?.url||WS_URL;},
      send(data){return forwardLegacy(data);},
      close(code,reason){disconnect(reason||('legacy-close-'+(code||'')));},
      addEventListener(){},removeEventListener(){}
    };
    state.proxy=proxy;
    try{window.onlineSocket=proxy;}catch(_){}
    return proxy;
  }

  function syncPlayerState(force){
    if(state.phase!=='in_match')return;
    const f=getPlayer();
    if(!f||!f.pos||!state.socket||state.socket.readyState!==WebSocket.OPEN)return;
    const now=performance.now();
    if(!force&&now-state.lastStateAt<45)return;
    state.lastStateAt=now;
    let superJump=false;try{superJump=!!window.__V11?.getJumpState?.();}catch(_){}
    const payload={
      x:f.pos.x,y:f.pos.y,z:f.pos.z,yaw:f.root?.rotation?.y||0,
      hp:f.hp,ink:f.ink,alive:f.alive,squid:!!f.squid_mode,
      weaponId:f.weapon?.id??0,moving:!!f._moving,superJump
    };
    try{if(typeof getFighterInkHex==='function')payload.colorHex=getFighterInkHex(f);}catch(_){}
    rawSend('state',payload);
  }

  function findFighter(id){
    const key=String(id||'');if(!key)return null;
    const me=getPlayer();if(me&&String(me.id)===key)return me;
    return getFighters().find(f=>String(f?.id)===key)||null;
  }
  function ensureRemote(m){try{if(typeof window.ensureRemoteFighter==='function')return window.ensureRemoteFighter(m);}catch(_){}return null;}
  function removeRemote(id){
    const key=String(id||'');if(!key)return;
    const f=getFighters().find(x=>x?.remote&&String(x.id)===key);
    if(!f)return;
    try{if(typeof scene!=='undefined')scene.remove(f.root);}catch(_){}
    try{if(typeof fighters!=='undefined'&&Array.isArray(fighters))fighters=fighters.filter(x=>x!==f);}catch(_){}
  }
  function applyRemote(m){
    const id=String(m?.id||'');
    if(!id)return;
    const seq=Number.isFinite(Number(m.seq))?Number(m.seq):0;

    /*
     * V98: the server may clamp a client's position to keep synchronization
     * continuous. Apply correction only when the packet is explicitly marked
     * corrected; ordinary self-state packets must never fight local movement.
     */
    if(id===String(state.playerId||'')){
      const me=getPlayer();
      /* The server is authoritative for online ink. Keep the local HUD/tank
         synchronized without applying ordinary position packets back to the
         local movement controller. */
      if(me && Number.isFinite(Number(m.ink))){
        me.ink=Math.max(0,Math.min(100,Number(m.ink)));
      }
      if(!m.corrected)return;
      const x=Number(m.x),y=Number(m.y),z=Number(m.z);
      if(me?.pos&&[x,y,z].every(Number.isFinite)){
        me.pos.set(x,y,z);
        if(me.root?.rotation)me.root.rotation.y=Number(m.yaw)||me.root.rotation.y;
      }
      return;
    }

    const f=ensureRemote(m);if(!f)return;
    if(seq&&Number.isFinite(Number(f.__v93LastSeq))&&seq<=Number(f.__v93LastSeq))return;
    if(seq)f.__v93LastSeq=seq;
    const x=Number(m.x),y=Number(m.y),z=Number(m.z),yaw=Number(m.yaw);
    if(![x,y,z,yaw].every(Number.isFinite))return;
    f.displayName=String(m.name||f.displayName||id);
    f._netTarget={x,y,z,yaw};f._netLastAt=performance.now();
    if(!f._netHasTarget){f.pos.set(x,y,z);f._netHasTarget=true;}
    f.root.rotation.y=yaw;f.root.visible=m.alive!==false;f.alive=m.alive!==false;
    if(Number.isFinite(Number(m.hp)))f.hp=Number(m.hp);
    if(Number.isFinite(Number(m.ink)))f.ink=Number(m.ink);
    if(Number.isFinite(Number(m.colorHex))&&f.cfg)f.cfg.inkColorHex=Math.max(0,Math.min(0xffffff,Math.floor(Number(m.colorHex))));
    f.squid_mode=!!m.squid;
    f.weapon=getWeapons()[Number(m.weaponId)]||f.weapon;
    try{window.updateFighterAnimation?.(f,!!m.moving,f.squid_mode);}catch(_){}
  }
  function applyDamage(m){
    if(state.phase!=='in_match')return;
    const target=findFighter(m.targetId);if(!target)return;
    if(Number.isFinite(Number(m.hp)))target.hp=Math.max(0,Math.min(target.maxHp||100,Number(m.hp)));
    if(m.reason==='enemy-ink'){try{window.forceHuman?.(target);}catch(_){}}
    if(m.killed||target.hp<=0){
      try{if(typeof killFighter==='function')killFighter(target);}catch(_){target.hp=0;target.alive=false;}
    }else target.alive=true;
  }
  function applyRespawn(m){
    if(state.phase!=='in_match')return;
    const target=findFighter(m.id);if(!target)return;
    try{if(typeof respawnFighter==='function')respawnFighter(target);}catch(_){}
  }

  function handleMessage(m){
    if(!m||typeof m.type!=='string')return;
    switch(m.type){
      case 'hello': {
        log('HELLO',{id:m.id});
        state.playerId=String(m.id||'');
        setVars();
        const token=storedAuthToken();
        const guestId=persistentGuestId();
        if(token){
          rawSend('bindAccount',{token});
        }else{
          rawSend('identify',{guestId});
        }
        break;
      }
      case 'accountBound':
        if(m.error){
          setStatus('ログイン情報が切れています');
          try{localStorage.removeItem('splatoonAccountToken');}catch(_){}
          try{window.showToast?.('ログイン情報が切れています。ログイン画面で入り直してください');}catch(_){}
          return;
        }
        try{
          if(m.profile){
            window.playerAccount=window.playerAccount||{};
            window.playerAccount.profile=m.profile;
            window.playerAccount.online=true;
            localStorage.setItem('splatoonAccountProfile',JSON.stringify(m.profile));
            localStorage.setItem('splatoonAccountName',String(m.profile.name||''));
            window.updateAccountProfileUI?.(m.profile);
            window.showOnlineProfile?.(m.profile);
            if(typeof playerFighter!=='undefined'&&playerFighter)playerFighter.displayName=String(m.profile.name||'');
          }
        }catch(_){}
        join();break;
      case 'guestIdentified':
        join();break;
      case 'roomState': {
        state.roomId=String(m.roomId||'');state.phase='room';
        const me=(m.players||[]).find(p=>String(p.id)===String(state.playerId||''));
        state.ready=!!me?.ready;setVars();renderRoom(m.players||[]);
        setStatus((m.players||[]).length<2?'対戦相手を探しています':'参加者を確認しています');
        setCount(m.players?.length||0,m.players?.length<2?'対戦相手を探しています':'参加者がそろっています');
        break;
      }
      case 'matchFound':
        state.phase='in_match';state.roomId=String(m.roomId||'');
        state.playerId=String(m.selfId||'');state.team=String(m.team||'');state.ready=true;
        setVars();renderRoom(m.players||[]);setStatus('マッチング成立');
        setCount((m.players||[]).length,'対戦開始準備中');
        try{window.startOnlineBattle?.(m);}catch(e){log('START_ERROR',String(e));}
        break;
      case 'state':applyRemote(m);break;
      case 'damage':applyDamage(m);break;
      case 'serverRespawn':applyRespawn(m);break;
      case 'shot':try{window.__receiveOnlineShotV60?.(m);}catch(_){}break;
      case 'sub':try{window.__receiveOnlineSubV60?.(m);}catch(_){}break;
      case 'special':{
        const id=String(m.id||'');
        const f=findFighter(id)||ensureRemote({id:m.id,name:m.name,team:m.team,weaponId:m.weaponId,spawn:{x:Number(m.x)||0,z:Number(m.z)||0},config:m.config||{}});
        const name=m.specialName||(m.specialType==='chargeOrb'?'チャージオーブ':'');
        if(f&&name)try{window.__receiveOriginalSpecial?.(f,name,new THREE.Vector3(Number(m.x)||0,Number(m.y)||0,Number(m.z)||0),m.extra||{});}catch(_){}
        break;
      }
      case 'sensorMark':
        try{const f=findFighter(m.targetId)||ensureRemote(m);if(f)f.revealedUntil=Math.max(Number(f.revealedUntil)||0,Number(m.until)||0);}catch(_){}
        break;
      case 'paint':{
        const x2=Number(m.x2),z2=Number(m.z2);
        const o={mult:m.mult||1,remote:true,team:m.team,surfaceY:Number.isFinite(Number(m.y))?Number(m.y):undefined};
        if(Number.isFinite(x2)&&Number.isFinite(z2))o.to={x:x2,z:z2};
        try{window.paintGround?.(m.x,m.z,m.radius,m.colorHex,o);}catch(_){}
        break;
      }
      case 'playerLeft':removeRemote(m.id);break;
      case 'callout':try{window.showOnlineCallout?.(m.calloutType==='nice'?'ナイス!':'カモン!',m.calloutType==='nice'?'nice':'cmon',m.name||m.id);}catch(_){}break;
      case 'globalOnlineCount':try{window.setGlobalOnlineCount?.(m.count);window.showGlobalOnlineHud?.(true);}catch(_){}break;
      case 'serverTick':window.__onlineLastServerTick=Date.now();break;
      case 'serverInk':{
        const f=getPlayer();if(f&&Number.isFinite(Number(m.ink)))f.ink=Math.max(0,Math.min(100,Number(m.ink)));break;
      }
      case 'shotResult':{
        const f=getPlayer();
        if(f&&Number.isFinite(Number(m.ink)))f.ink=Math.max(0,Math.min(100,Number(m.ink)));
        if(m.accepted===false){
          log('SHOT_REJECTED',{reason:String(m.reason||'unknown'),ink:Number(m.ink)});
        }else{
          log('SHOT_ACCEPTED',{ink:Number(m.ink)});
        }
        break;
      }
      case 'antiCheatWarning':try{window.showToast?.(String(m.reason||'通信に異常が検知されました'));}catch(_){}break;
      case 'matchEnd':
        try{
          /* V111: remember a server-forced win before endBattle() calculates the
             local result screen. A team-disconnect result is authoritative. */
          window.__V111_FORCED_MATCH_RESULT = (m.forced && (m.winnerTeam==='A'||m.winnerTeam==='B'))
            ? {winnerTeam:m.winnerTeam,reason:String(m.reason||'team-eliminated')}
            : null;

          const me=(m.results||[]).find(x=>String(x.id)===String(state.playerId));
          if(me?.profile){
            window.showOnlineProfile?.(me.profile);
            if(window.playerAccount)window.playerAccount.profile=me.profile;
            localStorage.setItem('splatoonAccountProfile',JSON.stringify(me.profile));
            window.updateAccountProfileUI?.(me.profile);
          }
          window.endBattle?.();
        }catch(_){}
        state.phase='room';state.roomId='';state.playerId='';state.team='';state.ready=false;setVars();break;
      default:break;
    }
  }

  function connect(){
    if(state.socket&&(state.socket.readyState===WebSocket.OPEN||state.socket.readyState===WebSocket.CONNECTING))return;
    state.phase='connecting';state.roomId='';state.playerId='';state.team='';state.ready=false;state.lastStateAt=0;setVars();
    setStatus('オンライン接続中');setCount(1,'サーバーへ接続しています');
    let ws;try{ws=new WebSocket(WS_URL);}catch(e){setStatus('WebSocket開始に失敗しました');return;}
    state.socket=ws;makeProxy();
    ws.onopen=()=>{log('OPEN',{url:WS_URL});setStatus('Render接続OK / ルームを検索中');};
    ws.onmessage=ev=>{try{handleMessage(JSON.parse(ev.data));}catch(e){log('BAD_MESSAGE',String(e));}};
    ws.onerror=()=>{if(state.socket===ws){log('ERROR');setStatus('オンライン接続エラー');}};
    ws.onclose=()=>{
      if(state.socket!==ws)return;
      log('CLOSE');
      const wasMatch=state.phase==='in_match';
      state.socket=null;state.proxy=null;state.phase='disconnected';state.roomId='';state.playerId='';state.team='';state.ready=false;setVars();
      try{window.onlineSocket=null;}catch(_){}
      try{window.showGlobalOnlineHud?.(false);}catch(_){}

      if(wasMatch){
        try{window.clearRemoteFighters?.();}catch(_){}
        try{window.battleActive=false;}catch(_){}
        try{window.showToast?.('オンライン接続が切断されたため、試し撃ち場に戻りました');}catch(_){}
      }
    };
  }

  function join(){
    if(!state.socket||state.socket.readyState!==WebSocket.OPEN)return false;
    state.phase='connecting';
    const cfg=Object.assign({},getConfig()),f=getPlayer();
    const weapon=Number(f?.weapon?.id??cfg.weapon??0);
    setStatus('ルームを検索中');
    const token=storedAuthToken();
    const guestId=persistentGuestId();
    return rawSend('joinQueue',{weaponId:weapon,config:cfg,token,guestId});
  }
  function disconnect(reason){
    const ws=state.socket;if(!ws)return;
    try{if(ws.readyState===WebSocket.OPEN)rawSend('leaveQueue',{reason:String(reason||'user')});}catch(_){}
    state.phase='closing';setVars();try{ws.close(1000,String(reason||'user'));}catch(_){}
  }
  function openOnline(){
    try{window.__V10?.releaseLock?.();}catch(_){}
    const panel=$('online-panel');
    if(panel){panel.style.display='flex';panel.style.visibility='visible';panel.style.opacity='1';}
    try{window.showGlobalOnlineHud?.(true);}catch(_){}
    if(!state.socket||state.socket.readyState===WebSocket.CLOSED)connect();
    else if(state.phase==='disconnected'||state.phase==='closing')join();
    else if(state.phase==='room')setStatus('参加者を確認しています');
    else setStatus(state.phase==='in_match'?'対戦中':'オンライン接続中');
    return true;
  }

  async function runProbe(){
    const panel=$('online-test-panel');if(panel)panel.style.display='flex';
    const result=$('online-test-result'),logEl=$('online-test-log'),serverEl=$('online-test-server');
    if(result)result.innerHTML='';if(logEl)logEl.textContent='';
    if(serverEl)serverEl.textContent='HTTP: '+SERVER_ORIGIN+'\\nWebSocket: '+WS_URL;
    const add=(name,kind,detail)=>{
      if(!result)return;
      const row=document.createElement('div');
      row.style.cssText='padding:9px 10px;border-radius:8px;background:#1b1b30;border:2px solid #444;';
      row.innerHTML='<strong>'+({wait:'◐',ok:'✓',fail:'✕'}[kind]||'·')+' '+name+'</strong><div style="font-size:12px;color:#ccc;margin-top:3px;">'+detail+'</div>';
      result.appendChild(row);
    };
    const logger=s=>{if(logEl){logEl.textContent+='['+new Date().toLocaleTimeString()+'] '+s+'\\n';logEl.scrollTop=logEl.scrollHeight;}};
    add('1. サーバーURL','ok',SERVER_ORIGIN);add('2. HTTP /health','wait','確認中…');
    try{
      const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),10000);
      const r=await fetch(SERVER_ORIGIN+'/health',{cache:'no-store',mode:'cors',credentials:'omit',signal:ctl.signal});
      clearTimeout(tm);const txt=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+' '+txt.slice(0,160));
      add('2. HTTP /health','ok','HTTP '+r.status);logger('health OK');
    }catch(e){add('2. HTTP /health','fail',String(e));logger('health FAIL '+String(e));return;}
    add('3. WebSocket','wait','接続中…');
    await new Promise(resolve=>{
      let done=false,ws;
      const finish=()=>{if(done)return;done=true;try{ws.close();}catch(_){}resolve();};
      try{ws=new WebSocket(WS_URL);}catch(e){add('3. WebSocket','fail',String(e));return resolve();}
      const timer=setTimeout(()=>{add('3. WebSocket','fail','10秒以内に応答なし');finish();},10000);
      ws.onopen=()=>{add('3. WebSocket','ok','接続成功');ws.send(JSON.stringify({type:'probe',client:'V93'}));};
      ws.onmessage=ev=>{try{const m=JSON.parse(ev.data);if(m.type==='hello')add('4. hello','ok','サーバー応答あり');if(m.type==='probeAck'){clearTimeout(timer);add('5. 接続プローブ','ok','部屋には参加せず接続だけ確認しました。');logger('probeAck');finish();}}catch(_){}};
      ws.onerror=()=>{add('3. WebSocket','fail','WebSocketエラー');clearTimeout(timer);finish();};
      ws.onclose=()=>{clearTimeout(timer);};
    });
  }

  function intercept(id,fn){
    const el=$(id);if(!el)return;
    el.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();fn(e);},true);
  }
  intercept('online-ready',()=>{
    if(state.phase!=='room'||!state.socket||state.socket.readyState!==WebSocket.OPEN||!state.roomId)return;
    state.ready=!state.ready;setVars();
    rawSend('ready',{ready:state.ready,weaponId:Number(getConfig().weapon||0),config:Object.assign({},getConfig())});
  });
  intercept('online-start',join);
  intercept('online-server-save',openOnline);
  intercept('online-test-run',runProbe);
  intercept('online-test-close',()=>{const p=$('online-test-panel');if(p)p.style.display='none';});

  window.openOnlineMatchmaking=openOnline;
  window.openOnlinePanel=openOnline;
  window.__startOnlineDirect=openOnline;
  window.startOnlineDirect=openOnline;
  window.closeOnlinePanel=()=>{disconnect('user');const p=$('online-panel');if(p)p.style.display='none';};
  window.__runOnlineDiagnostic=runProbe;

  setInterval(()=>syncPlayerState(false),50);

  const oldStart=window.startOnlineBattle;
  if(typeof oldStart==='function'){
    window.startOnlineBattle=function(m){
      state.phase='in_match';state.roomId=String(m.roomId||'');
      state.playerId=String(m.selfId||'');state.team=String(m.team||'');state.ready=true;setVars();
      return oldStart(m);
    };
  }

  try{window.onlineSocket=null;}catch(_){}
  log('READY',{server:WS_URL});
})();
/* --- end online-v93.js --- */

/* --- begin online-v95.js --- */
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

/* V95 firing-direction fix:
   - Player shots preserve the aim supplied by the normal input path.
   - AI shots may still use the fighter's forward direction when no aim is supplied.
   - Never replace a live player camera aim with a potentially stale root/human rotation. */
function v95ShotDirection(f, supplied){
  if(f?.isPlayer && supplied?.clone){
    const d=supplied.clone();
    d.y=0;
    if(d.lengthSq()>.0001)return d.normalize();
    try{
      const c=new THREE.Vector3();
      camera?.getWorldDirection(c);
      c.y=0;
      if(c.lengthSq()>.0001)return c.normalize();
    }catch(_){}
  }
  return front(f);
}
try{
  const baseTry=tryShoot;
  if(!baseTry.__v95Wrapped){
    tryShoot=function(f,aimDir,now){
      return baseTry(f,v95ShotDirection(f,aimDir),now);
    };
    tryShoot.__v95Wrapped=true;
    window.tryShoot=tryShoot;
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
/* --- end online-v95.js --- */

/* --- begin online-v96.js --- */
/* V96: online protocol hardening
   - Fix sensorMark/sensorTagged reception.
   - Reconnect legacy addEventListener callers to the real WebSocket.
   - Re-enter matchmaking after a completed match when the Online UI is opened again.
   - Keep client/server weapon authority aligned with V96 server validation.
*/
(function(){
'use strict';
const BUILD='V96-ONLINE-HARDENING-2026-10-01';
const state=window.__V93_ONLINE;
if(!state||window.__V96_ACTIVE)return;
window.__V96_ACTIVE=true;
window.__V96_BUILD=BUILD;

const getFighters=()=>{
  try{return Array.isArray(window.fighters)?window.fighters:[];}catch(_){return [];}
};
const getPlayer=()=>{
  try{return window.playerFighter||null;}catch(_){return null;}
};
function find(id){
  const k=String(id||'');
  const me=getPlayer();
  if(me&&String(me.id)===k)return me;
  return getFighters().find(f=>String(f?.id)===k)||null;
}
function ensure(m){
  try{return window.ensureRemoteFighter?.(m)||null;}catch(_){return null;}
}
function configForJoin(){
  let cfg={};
  try{
    cfg=typeof playerConfig!=='undefined'&&playerConfig
      ? Object.assign({},playerConfig)
      : Object.assign({},window.playerConfig||{});
  }catch(_){cfg=Object.assign({},window.playerConfig||{});}
  const f=getPlayer();
  const weapon=Number(f?.weapon?.id??cfg.weapon??0);
  cfg.weapon=Number.isFinite(weapon)?Math.max(0,Math.min(2,Math.floor(weapon))):0;
  return {cfg,weapon:cfg.weapon};
}
function setVars(){
  try{window.onlineActive=state.phase==='in_match';}catch(_){}
  try{window.onlineStarted=state.phase==='in_match';}catch(_){}
  try{window.onlineRoomId=state.roomId||'';}catch(_){}
  try{window.onlinePlayerId=state.playerId||'';}catch(_){}
  try{window.onlineTeam=state.team||'';}catch(_){}
  try{window.onlineReady=!!state.ready;}catch(_){}
}
function wireProxy(ws){
  const p=window.onlineSocket;
  if(!p||p.__v96EventsWired||p.__v93Proxy!==true)return;
  p.__v96EventsWired=true;
  try{
    p.addEventListener=(type,fn,opts)=>{
      if(ws&&typeof ws.addEventListener==='function')return ws.addEventListener(type,fn,opts);
    };
    p.removeEventListener=(type,fn,opts)=>{
      if(ws&&typeof ws.removeEventListener==='function')return ws.removeEventListener(type,fn,opts);
    };
  }catch(_){}
}
function applySensorMark(m){
  const f=find(m.targetId)||ensure(m);
  if(!f)return;
  const until=Number(m.until)||0;
  f._sensorViewerUntil=Math.max(Number(f._sensorViewerUntil)||0,until);
  /* V93 already uses revealedUntil for AI visibility; preserve that behavior too. */
  f.revealedUntil=Math.max(Number(f.revealedUntil)||0,until);
}
function applySensorTagged(m){
  const f=find(m.targetId)||getPlayer();
  if(!f)return;
  const until=Number(m.until)||0;
  f._sensorTaggedUntil=Math.max(Number(f._sensorTaggedUntil)||0,until);
  f.__v96SensorSourceId=String(m.sourceId||'');
  f.__v96SensorSourceName=String(m.sourceName||'');
}
function installSocket(ws){
  if(!ws||ws.__v96Hooked)return;
  ws.__v96Hooked=true;
  ws.addEventListener('message',ev=>{
    let m;try{m=JSON.parse(ev.data);}catch(_){return;}
    if(m.type==='sensorMark')applySensorMark(m);
    else if(m.type==='sensorTagged')applySensorTagged(m);
    wireProxy(ws);
  });
  wireProxy(ws);
}
function rejoinQueue(){
  const ws=state.socket;
  if(!ws||ws.readyState!==WebSocket.OPEN)return false;
  const {cfg,weapon}=configForJoin();
  state.phase='connecting';
  state.roomId='';
  state.team='';
  state.ready=false;
  state.lastStateAt=0;
  setVars();
  try{
    const msg={
      type:'joinQueue',
      _v93:true,
      clientSeq:++state.seq,
      weaponId:weapon,
      config:cfg
    };
    ws.send(JSON.stringify(msg));
    try{window.setOnlineConnecting?.('ルームを検索中');}catch(_){}
    try{window.setOnlineCount?.(1,'対戦相手を探しています');}catch(_){}
    return true;
  }catch(_){return false;}
}
function patchOpen(name){
  const old=window[name];
  if(typeof old!=='function'||old.__v96Wrapped)return;
  const fn=function(){
    const out=old.apply(this,arguments);
    const s=window.__V93_ONLINE;
    if(s&&s.socket&&s.socket.readyState===WebSocket.OPEN){
      wireProxy(s.socket);
      /* V93 stays in phase=room after matchEnd but clears the roomId.
         A fresh Online-screen open should immediately make a new queue request. */
      if(!s.roomId&&s.phase==='room')setTimeout(rejoinQueue,0);
    }
    return out;
  };
  fn.__v96Wrapped=true;
  window[name]=fn;
}
patchOpen('openOnlineMatchmaking');
patchOpen('openOnlinePanel');
patchOpen('__startOnlineDirect');

const watcher=setInterval(()=>{
  try{
    const s=window.__V93_ONLINE;
    if(s?.socket)installSocket(s.socket);
    wireProxy(s?.socket);
    /* A socket can be replaced after reconnect, so never assume the first one is permanent. */
  }catch(_){}
},200);
watcher.unref?.();

try{
  const p=window.onlineSocket;
  if(p&&state.socket)wireProxy(state.socket);
}catch(_){}

console.log('[SPLATOON ONLINE]['+BUILD+'] active');
})();
/* --- end online-v96.js --- */
