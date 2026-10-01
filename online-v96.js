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
  try{
    if(typeof fighters!=='undefined' && Array.isArray(fighters))return fighters;
    return Array.isArray(window.fighters)?window.fighters:[];
  }catch(_){
    return Array.isArray(window.fighters)?window.fighters:[];
  }
};
const getPlayer=()=>{
  try{
    if(typeof playerFighter!=='undefined' && playerFighter)return playerFighter;
    return window.playerFighter||null;
  }catch(_){
    return window.playerFighter||null;
  }
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
  cfg.weapon=Number.isFinite(weapon)?Math.max(0,Math.min(200,Math.floor(weapon))):0;
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