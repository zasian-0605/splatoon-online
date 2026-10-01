/* V93: Unified online runtime
   One WebSocket owner, one transport bridge, one room protocol.
   Legacy gameplay code may still call onlineSocket.send(); the compatibility
   proxy funnels those messages through this single V93 transport.
*/
(function(){
  'use strict';

  const BUILD='V111-ONLINE-CONSOLIDATED-2026-10-01';
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
      const windowMs=m.type==='state'?24:(m.type==='paint'?5:18);
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
      if(!m.corrected)return;
      const me=getPlayer();
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
        const token=localStorage.getItem('splatoonAccountToken');
        if(token)rawSend('bindAccount',{token});else join();
        break;
      }
      case 'accountBound':
        if(m.error){setStatus('ログイン情報が切れています');try{localStorage.removeItem('splatoonAccountToken');}catch(_){}return;}
        try{window.showOnlineProfile?.(m.profile);}catch(_){}
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
      case 'sensorMark':{
        try{
          const f=findFighter(m.targetId)||ensureRemote(m);
          if(f){
            const until=Number(m.until)||0;
            f._sensorViewerUntil=Math.max(Number(f._sensorViewerUntil)||0,until);
            f.revealedUntil=Math.max(Number(f.revealedUntil)||0,until);
          }
        }catch(_){}
        break;
      }
      case 'sensorTagged':{
        try{
          const f=findFighter(m.targetId)||getPlayer();
          if(f){
            const until=Number(m.until)||0;
            f._sensorTaggedUntil=Math.max(Number(f._sensorTaggedUntil)||0,until);
            f.__v111SensorSourceId=String(m.sourceId||'');
            f.__v111SensorSourceName=String(m.sourceName||'');
          }
        }catch(_){}
        break;
      }
      case 'paint':{
        const x2=Number(m.x2),z2=Number(m.z2);
        const o={mult:m.mult||1,remote:true,team:m.team,surfaceY:Number.isFinite(Number(m.y))?Number(m.y):undefined};
        if(Number.isFinite(x2)&&Number.isFinite(z2))o.to={x:x2,z:z2};
        const nx=Number(m.nx),ny=Number(m.ny),nz=Number(m.nz);
        if([nx,ny,nz].every(Number.isFinite))o.normal=new THREE.Vector3(nx,ny,nz);
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
      case 'antiCheatWarning':try{window.showToast?.(String(m.reason||'通信に異常が検知されました'));}catch(_){}break;
      case 'matchEnd':
        try{
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
    state.socket=ws;makeProxy();installSocket(ws);wireProxy(ws);
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
    setStatus('ルームを検索中');return rawSend('joinQueue',{weaponId:weapon,config:cfg});
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

/* V107: preserve paint surface normals from the authoritative server. */
window.__V107_ONLINE_PAINT_NORMALS=true;
window.__V111_ONLINE_CONSOLIDATED=true;

