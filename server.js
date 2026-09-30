const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch { return {}; }
}
let accounts = loadAccounts();
function saveAccounts() {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}
function rankFromRating(r) {
  if (r >= 2300) return 'X';
  if (r >= 2100) return 'S+';
  if (r >= 1950) return 'S';
  if (r >= 1800) return 'A+';
  if (r >= 1650) return 'A';
  if (r >= 1500) return 'A-';
  if (r >= 1350) return 'B+';
  if (r >= 1200) return 'B';
  if (r >= 1050) return 'B-';
  if (r >= 900) return 'C+';
  if (r >= 750) return 'C';
  return 'C-';
}
function profile(a) {
  return { name: a.name, rating: a.rating, rank: rankFromRating(a.rating), wins: a.wins, losses: a.losses, games: a.games };
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function validName(name) { return typeof name === 'string' && /^[^\s]{2,16}$/.test(name); }
function validPassword(pw) { return typeof pw === 'string' && pw.length >= 4 && pw.length <= 72; }
function issueToken() { return crypto.randomBytes(24).toString('hex'); }
const sessions = new Map();

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}
async function readBody(req) {
  let s = ''; for await (const chunk of req) { s += chunk; if (s.length > 64 * 1024) throw new Error('too large'); }
  return JSON.parse(s || '{}');
}
function sessionForToken(token) {
  token=String(token||'');
  if(!token)return null;
  const live=sessions.get(token);
  if(live)return live;

  /* 再起動後もアカウントに紐づいた最終トークンを復元する。 */
  for(const a of Object.values(accounts)){
    if(a && a.sessionToken===token)return {name:a.name};
  }
  return null;
}
function getSession(req) {
  const auth = String(req.headers.authorization || '');
  return sessionForToken(auth.startsWith('Bearer ') ? auth.slice(7) : '');
}

const rooms = new Map();
const sockets = new Map();

const SERVER_CELL=2;
const SERVER_Y_STEP=.5;
const SERVER_STAGE_POLYGON=[[48,-30.4],[14,-72],[0.5,-38.4],[-3.5,-44.8],[-19,-20.8],[-20.5,-33.6],[-20.5,-17.6],[-14,-3.2],[-36.5,3.2],[-47.5,20.8],[-48,35.2],[-14,72],[-4,46.4],[4,48],[20.5,24],[20,8],[19,20.8],[13.5,9.6],[36,0],[48,-17.6]];
const SERVER_PLAYABLE_HALF_X=52;
const SERVER_PLAYABLE_HALF_Z=76;
const SERVER_WEAPONS={
  0:{cat:'shooter',damage:32,rate:95,range:30,speed:37},1:{cat:'shooter',damage:42,rate:180,range:31,speed:35},
  2:{cat:'shooter',damage:24,rate:70,range:30,speed:38},3:{cat:'shooter',damage:35,rate:145,range:39,speed:42},
  4:{cat:'shooter',damage:48,rate:245,range:38,speed:38},
  5:{cat:'blaster',damage:76,rate:590,range:22,speed:20,explosion:2.55,splash:48},6:{cat:'blaster',damage:58,rate:180,range:24,speed:20,explosion:2.4,splash:55},
  7:{cat:'blaster',damage:54,rate:430,range:32,speed:30,explosion:1.9,splash:28},8:{cat:'blaster',damage:82,rate:720,range:30,speed:22,explosion:2.8,splash:44},
  9:{cat:'charger',tap:34,full:160,rate:900,range:62,speed:70},10:{cat:'charger',tap:30,full:180,rate:1250,range:72,speed:85},11:{cat:'charger',tap:32,full:92,rate:520,range:48,speed:60},
  12:{cat:'roller',damage:78,rate:380,range:3},13:{cat:'roller',damage:108,rate:560,range:3.5},14:{cat:'roller',damage:42,rate:145,range:2},
  15:{cat:'maneuver',damage:18,rate:55,range:21,speed:34},16:{cat:'maneuver',damage:19,rate:78,range:35,speed:37},17:{cat:'maneuver',damage:30,rate:145,range:31,speed:29},
  18:{cat:'slosher',damage:70,rate:500,range:16,speed:17,explosion:2.4},19:{cat:'slosher',damage:50,rate:400,range:13,speed:19,explosion:1.9},
  20:{cat:'slosher',damage:84,rate:720,range:22,speed:15,explosion:3.0},21:{cat:'slosher',damage:70,rate:640,range:28,speed:21,explosion:2.6},
  22:{cat:'wiper',damage:72,full:120,rate:520,range:5},23:{cat:'wiper',damage:100,full:150,rate:720,range:6},
  24:{cat:'shooter',damage:28,rate:70,range:32,speed:43},25:{cat:'shooter',damage:14,rate:42,range:28,speed:38},
  26:{cat:'shooter',damage:29,rate:240,range:35,speed:41},27:{cat:'shooter',damage:41,rate:300,range:38,speed:43},
  28:{cat:'blaster',damage:85,rate:600,range:23,speed:27,explosion:2.35,splash:50},29:{cat:'roller',damage:70,rate:300,range:2.65},
  30:{cat:'roller',damage:42,rate:120,range:2.35},31:{cat:'spinner',damage:29,rate:50,range:30,speed:46},
  32:{cat:'spinner',damage:31,rate:62,range:38,speed:48},33:{cat:'spinner',damage:41,rate:70,range:45,speed:50},
  34:{cat:'maneuver',damage:28,rate:55,range:30,speed:38},35:{cat:'brella',damage:34,rate:550,range:20,speed:32},36:{cat:'brella',damage:26,rate:330,range:18,speed:34},
  37:{cat:'charger',kind:'stringer',tap:22,full:76,rate:900,range:48,speed:48},38:{cat:'charger',kind:'stringer',tap:18,full:52,rate:620,range:42,speed:52},
  39:{cat:'charger',tap:30,full:105,rate:520,range:42,speed:66},40:{cat:'charger',tap:24,full:125,rate:1000,range:50,speed:70},
  41:{cat:'roller',damage:38,rate:100,range:2.15},42:{cat:'roller',damage:70,rate:170,range:2.65},
  43:{cat:'blaster',damage:92,rate:750,range:27,speed:22,explosion:2.7,splash:55},44:{cat:'slosher',damage:70,rate:540,range:25,speed:18,explosion:2.5}
};
const SERVER_SUBS={
  instant:{delay:0,radius:2.1,damage:60},timed:{delay:1100,radius:3.4,damage:180},stick:{delay:1500,radius:4.0,damage:180},
  bounce:{delay:1800,radius:1.8,damage:50},seek:{delay:1800,radius:3.6,damage:180},slide:{delay:1400,radius:2.8,damage:180},
  homing:{delay:1800,radius:2.8,damage:60},splatBomb:{delay:1100,radius:3.4,damage:180},suctionBomb:{delay:1500,radius:4.0,damage:180},
  burstBomb:{delay:400,radius:1.9,damage:120},curlingBomb:{delay:1200,radius:2.6,damage:120},fizzyBomb:{delay:1300,radius:2.7,damage:120},
  autobomb:{delay:900,radius:2.8,damage:110},torpedo:{delay:700,radius:2.8,damage:120},angleShooter:{delay:150,radius:1.0,damage:40},
  toxicMist:{delay:250,radius:3.2,damage:8},inkMine:{delay:300,radius:3.0,damage:100},pointSensor:{delay:0,radius:0,damage:0},
  splashWall:{delay:500,radius:2.8,damage:18},sprinkler:{delay:400,radius:2.0,damage:15},sensor:{delay:0,radius:0,damage:0},turret:{delay:0,radius:2.5,damage:50}
};
const SERVER_SPECIALS={
  'トリガーキャノン':[220,2.8],'センチネルミサイル':[150,3.0],'ペイントクラウド':[24,4.5],'ギガスタンプ':[160,3.6],
  'オムニレーザー':[120,2.0],'チャージオーブ':[180,4.0],'パルスノード':[55,3.0],'ラッシュカート':[140,3.4],'トライアークトルネード':[120,3.2],
  'アサルトシェル':[140,3.5],'スワームビーコン':[70,3.0],'コロッサス':[150,3.6],'トリプルクラッシュ':[140,3.0],
  'スモークスクリーン':[20,3.8],'ウルトラショット':[120,2.8],'ナイスダマ':[140,4.0],'カニタンク':[110,3.2],
  'キューインキ':[75,3.0],'アメフラシ':[14,3.8],'ホップソナー':[70,3.2],'サメライド':[150,3.8],
  'ウルトラハンコ':[160,3.8],'テイオウイカ':[160,3.8],'メガホンレーザー5.1ch':[110,2.4],'マルチミサイル':[90,3.0],
  'デコイチラシ':[70,2.4],'スミナガシート':[20,3.5],'ウルトラチャクチ':[160,4.0],'ショクワンダー':[80,3.0]
};
function serverPointInStage(x,z){
  return Number.isFinite(x)&&Number.isFinite(z)
    && x>=-SERVER_PLAYABLE_HALF_X && x<=SERVER_PLAYABLE_HALF_X
    && z>=-SERVER_PLAYABLE_HALF_Z && z<=SERVER_PLAYABLE_HALF_Z;
}
function serverCellKey(x,z,y){
  return Math.floor(Number(x)/SERVER_CELL)+','+Math.floor(Number(z)/SERVER_CELL)+','+Math.round(Number(y||0)/SERVER_Y_STEP);
}
function markServerPaint(room,x,z,radius,team,y,x2,z2){
  const r=Math.max(.2,Math.min(8,Number(radius)||0));
  const sx=Number(x),sz=Number(z);
  if(!Number.isFinite(sx)||!Number.isFinite(sz))return;
  const ex=Number.isFinite(Number(x2))?Number(x2):sx;
  const ez=Number.isFinite(Number(z2))?Number(z2):sz;
  const dist=Math.hypot(ex-sx,ez-sz);
  const steps=Math.max(0,Math.min(48,Math.ceil(dist/Math.max(.75,r*.55))));
  const gy=Math.round((Number(y)||0)/SERVER_Y_STEP);

  for(let i=0;i<=steps;i++){
    const t=steps?i/steps:0;
    const px=sx+(ex-sx)*t,pz=sz+(ez-sz)*t;
    const minX=Math.floor((px-r)/SERVER_CELL),maxX=Math.ceil((px+r)/SERVER_CELL);
    const minZ=Math.floor((pz-r)/SERVER_CELL),maxZ=Math.ceil((pz+r)/SERVER_CELL);
    for(let gx=minX;gx<=maxX;gx++){
      for(let gz=minZ;gz<=maxZ;gz++){
        const cx=(gx+.5)*SERVER_CELL,cz=(gz+.5)*SERVER_CELL;
        if(Math.hypot(cx-px,cz-pz)<=r+1 && serverPointInStage(cx,cz)){
          room.inkCells.set(gx+','+gz+','+gy,team);
        }
      }
    }
  }
}
function seedServerSpawnInk(room){
  for(let gx=-21;gx<=19;gx++){
    for(let gz=-35;gz<=-28;gz++)if(serverPointInStage((gx+.5)*SERVER_CELL,(gz+.5)*SERVER_CELL))room.inkCells.set(gx+','+gz+',0','A');
    for(let gz=27;gz<=34;gz++)if(serverPointInStage((gx+.5)*SERVER_CELL,(gz+.5)*SERVER_CELL))room.inkCells.set(gx+','+gz+',0','B');
  }
}
function serverInkTeamAt(room,p){
  if(!room.inkCells)return null;
  const gx=Math.floor(p.x/SERVER_CELL),gz=Math.floor(p.z/SERVER_CELL),gy=Math.round((Number(p.y)||0)/SERVER_Y_STEP);
  for(let dy=-1;dy<=1;dy++){
    const team=room.inkCells.get(gx+','+gz+','+(gy+dy));
    if(team)return team;
  }
  return null;
}
function serverDistanceToSegment(px,py,pz,ax,ay,az,bx,by,bz){
  const abx=bx-ax,aby=by-ay,abz=bz-az,apx=px-ax,apy=py-ay,apz=pz-az,den=abx*abx+aby*aby+abz*abz||1;
  const t=Math.max(0,Math.min(1,(apx*abx+apy*aby+apz*abz)/den));
  const qx=ax+abx*t,qy=ay+aby*t,qz=az+abz*t;
  return {distance:Math.hypot(px-qx,py-qy,pz-qz),t,x:qx,y:qy,z:qz};
}
function serverFindTrajectoryHit(room,origin,dir,w,hitRadius){
  const range=Math.max(1,Number(w.range)||35),candidates=[];
  const addSegment=(a,b,order)=>{
    for(const target of room.players.values()){
      if(!target.serverAlive||target.team===null||target.team===w._attackerTeam)continue;
      const p=target.serverPos||target.spawn;
      const hit=serverDistanceToSegment(p.x,p.y+.9,p.z,a.x,a.y,a.z,b.x,b.y,b.z);
      if(hit.distance<hitRadius)candidates.push({target,hit,order:order+hit.t});
    }
  };

  if(w.cat==='charger'&&w.kind!=='stringer'){
    const end={
      x:origin.x+dir.x*range,
      y:origin.y+dir.y*range,
      z:origin.z+dir.z*range
    };
    addSegment(origin,end,0);
    candidates.sort((a,b)=>a.order-b.order);
    return {hit:candidates[0]||null,straightEnd:end,dropEnd:end};
  }

  const horizontal=Math.max(.001,Math.hypot(dir.x,dir.z));
  const basePitch=Math.atan2(dir.y,horizontal);
  const extraPitch=w.cat==='slosher'
    ? Math.PI*11/180
    : (w.kind==='stringer'?Math.PI*8/180:0);
  const pitch=basePitch+extraPitch;
  const yaw=Math.atan2(dir.x,dir.z);
  const cp=Math.cos(pitch),sp=Math.sin(pitch);
  const fd={
    x:Math.sin(yaw)*cp,
    y:sp,
    z:Math.cos(yaw)*cp
  };

  const straightDist=Math.min(4.2,range*.24);
  const straight={
    x:origin.x+fd.x*straightDist,
    y:origin.y+fd.y*straightDist,
    z:origin.z+fd.z*straightDist
  };
  addSegment(origin,straight,0);

  const speed=Math.max(1,Number(w.speed)||35);
  const remain=Math.max(0,range-straightDist);
  const gravity=w.cat==='slosher'?10.5:5.5;
  const totalTime=remain/Math.max(1,speed*cp);
  const steps=Math.max(16,Math.min(56,Math.ceil(totalTime*50)));
  let prev=straight;
  for(let i=1;i<=steps;i++){
    const t=totalTime*i/steps;
    const cur={
      x:straight.x+fd.x*speed*t,
      y:straight.y+fd.y*speed*t-.5*gravity*t*t,
      z:straight.z+fd.z*speed*t
    };
    addSegment(prev,cur,i/steps);
    prev=cur;
  }
  candidates.sort((a,b)=>a.order-b.order);
  return {
    hit:candidates[0]||null,
    straightEnd:straight,
    dropEnd:prev
  };
}
function broadcastDamage(room,target,damage,attacker,reason,killed){
  broadcast(room,{type:'damage',targetId:target.id,attackerId:attacker?attacker.id:null,damage:Math.max(0,Math.round(damage)),
    hp:Math.max(0,Math.round(target.serverHp)),killed:!!killed,reason:reason||'weapon'});
}
function serverKillPlayer(room,target,attacker,reason){
  if(!target.serverAlive)return false;
  target.serverAlive=false;target.serverHp=0;target.serverRespawnAt=Date.now()+3000;
  console.log('[AUTH KILL] '+room.id+' '+target.id+' by '+(attacker?attacker.id:'-')+' reason '+(reason||'weapon'));
  const keepRoom=room;
  setTimeout(()=>{
    if(rooms.get(keepRoom.id)!==keepRoom||!keepRoom.started||keepRoom.players.get(target.id)!==target||!target.ws||target.ws.readyState!==1)return;
    target.serverAlive=true;target.serverHp=100;target.serverPos=Object.assign({},target.spawn);
    target.lastStatePos=Object.assign({},target.spawn);target.lastStateAt=Date.now();
    send(target.ws,{type:'serverRespawn',id:target.id,spawn:target.spawn});
    broadcast(keepRoom,{type:'state',id:target.id,name:target.accountName||target.id,team:target.team,
      x:target.spawn.x,y:target.spawn.y||0,z:target.spawn.z,yaw:target.team==='A'?0:Math.PI,
      hp:100,ink:100,alive:true,squid:false,moving:false,weaponId:target.weaponId});
  },3000);
  return true;
}
function serverApplyDamage(room,target,damage,attacker,reason){
  if(!target||!target.serverAlive)return false;
  const d=Math.max(0,Number(damage)||0);if(d<=0)return false;
  target.serverHp=Math.max(0,target.serverHp-d);
  const killed=target.serverHp<=0;
  broadcastDamage(room,target,d,attacker,reason,killed);
  if(killed)serverKillPlayer(room,target,attacker,reason);
  return true;
}
function serverApplyAoE(room,center,radius,damage,team,attacker,reason){
  for(const target of room.players.values()){
    if(!target.serverAlive||target.team===team)continue;
    const pos=target.serverPos||target.spawn,dist=Math.hypot(pos.x-center.x,pos.z-center.z);
    if(dist<=radius){
      const scaled=damage*(1-Math.min(.65,dist/Math.max(.01,radius))*.5);
      serverApplyDamage(room,target,scaled,attacker,reason||'aoe');
    }
  }
}
function serverShotInkCost(w,m){
  const cat=w?.cat||'shooter';
  if(cat==='charger'){
    const frac=Math.max(0,Math.min(1,Number(m?.charge)||0));
    return 5+7*frac;
  }
  if(cat==='blaster')return 3.0;
  if(cat==='slosher')return 3.8;
  if(cat==='maneuver')return .9;
  if(cat==='brella')return 2.8;
  if(cat==='spinner')return .9;
  if(cat==='roller')return 1.5;
  if(cat==='wiper')return 2.0;
  return .9;
}
function serverSubInkCost(type){
  const costs={
    instant:45,timed:70,stick:70,bounce:60,seek:55,slide:65,homing:65,
    splatBomb:70,suctionBomb:70,burstBomb:55,curlingBomb:55,fizzyBomb:50,
    autobomb:55,torpedo:55,angleShooter:30,toxicMist:50,inkMine:55,
    pointSensor:45,splashWall:60,sprinkler:60,sensor:45,turret:65
  };
  return costs[String(type||'')]||55;
}
function serverTrySpendInk(player,cost){
  const c=Math.max(0,Number(cost)||0);
  if(c<=0)return true;
  if((player.serverInk??100)<c)return false;
  player.serverInk=Math.max(0,player.serverInk-c);
  player.serverInkUseAt=Date.now();
  return true;
}
function serverResolveShot(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return false;
  const wid=Number.isFinite(Number(m.weaponId))?Math.max(0,Math.min(200,Math.floor(Number(m.weaponId)))):player.weaponId;
  const w=SERVER_WEAPONS[wid];if(!w)return false;
  const now=Date.now();
  if(now-(player.lastShotAt||0)<Math.max(35,w.rate*.72))return false;
  const shotCost=serverShotInkCost(w,m);
  if(!serverTrySpendInk(player,shotCost)){
    send(player.ws,{type:'serverInk',ink:Math.max(0,player.serverInk??0)});
    return;
  }
  player.lastShotAt=now;
  const dx=Number(m.dx),dy=Number(m.dy),dz=Number(m.dz),len=Math.hypot(dx,dy,dz);
  if(!Number.isFinite(len)||len<.001||len>2)return;
  const dir={x:dx/len,y:dy/len,z:dz/len},origin={x:player.serverPos?.x||0,y:(player.serverPos?.y||0)+1.2,z:player.serverPos?.z||0},range=w.range||35;
  const rawMode=String(m.mode||''); const mode=rawMode==='rollerFlick'?'roller-flick':rawMode;
  const hitRadius=(mode==='roller-flick'||mode==='brush')?2.2:(mode==='roller-roll'?1.55:(mode==='wiper'?1.65:.95));
  // Helper needs the firing team's identity so friendly players are never hit.
  w._attackerTeam=player.team;
  const trajectory=serverFindTrajectoryHit(room,origin,dir,w,hitRadius);
  const nearest=trajectory.hit;

  if(w.cat==='blaster'){
    const end=trajectory.straightEnd;
    const center=nearest
      ? {x:nearest.hit.x,y:nearest.hit.y,z:nearest.hit.z}
      : {x:end.x,y:Math.max(0,end.y),z:end.z};
    serverApplyAoE(room,center,w.explosion||2.4,w.splash||w.damage||0,player.team,player,'blaster');
    return true;
  }
  if(w.cat==='slosher'){
    const center=nearest
      ? {x:nearest.hit.x,y:nearest.hit.y,z:nearest.hit.z}
      : {x:origin.x+dir.x*Math.min(range,16),y:origin.y+dir.y*Math.min(range,16),z:origin.z+dir.z*Math.min(range,16)};
    serverApplyAoE(room,center,w.explosion||2.4,w.damage||0,player.team,player,'slosher');
    return true;
  }
  if(w.cat==='charger'){
    const frac=Math.max(0,Math.min(1,Number(m.charge)||0));
    if(nearest)serverApplyDamage(room,nearest.target,w.tap+(w.full-w.tap)*frac,player,'charger');
    return true;
  }
  if(w.cat==='wiper'){
    const frac=Math.max(0,Math.min(1,Number(m.charge)||0));
    const dmg=(w.damage||72)+((w.full||w.damage||72)-(w.damage||72))*frac;
    if(nearest)serverApplyDamage(room,nearest.target,dmg,player,'wiper');
    return true;
  }
  if(nearest){
    let dmg=w.damage||0;
    if(mode==='roller-roll')dmg=Math.min(65,dmg);
    serverApplyDamage(room,nearest.target,dmg,player,w.cat);
  }
  return true;
}
function serverResolveSub(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return;
  const def=SERVER_SUBS[String(m.subType||'')];if(!def)return;
  const now=Date.now();if(now-(player.lastSubAt||0)<180)return;
  const subCost=serverSubInkCost(m.subType);
  if(!serverTrySpendInk(player,subCost)){
    send(player.ws,{type:'serverInk',ink:Math.max(0,player.serverInk??0)});
    return;
  }
  player.lastSubAt=now;
  const pos=Object.assign({},player.serverPos||player.spawn),vx=Number(m.vx)||0,vz=Number(m.vz)||0;
  const scale=Math.min(1.8,Math.max(.25,(def.delay||0)/1000)),center={x:pos.x+vx*scale,z:pos.z+vz*scale,y:pos.y||0};
  if(!serverPointInStage(center.x,center.z))return;
  setTimeout(()=>{
    // The thrower may have left the room while the fuse was running.
    if(rooms.get(room.id)!==room||!room.started||room.players.get(player.id)!==player||!player.team)return;
    serverApplyAoE(room,center,def.radius||0,def.damage||0,player.team,player,'sub');
  },Math.max(0,def.delay||0));
}
function serverSendSensorMark(viewer,target,specialName,durationMs){
  if(!viewer||!target||viewer===target||!viewer.ws||!target.ws)return;
  const now=Date.now();
  const until=now+Math.max(500,Number(durationMs)||8000);
  const pos=target.serverPos||target.spawn||{x:0,y:0,z:0};
  const payload={
    type:'sensorMark',
    targetId:target.id,
    targetName:target.accountName||target.id,
    targetTeam:target.team,
    weaponId:target.weaponId,
    x:Number(pos.x)||0,y:Number(pos.y)||0,z:Number(pos.z)||0,
    specialName:String(specialName||''),
    until
  };
  send(viewer.ws,payload);
  send(target.ws,{
    type:'sensorTagged',
    targetId:target.id,
    sourceId:viewer.id,
    sourceName:viewer.accountName||viewer.id,
    specialName:String(specialName||''),
    until
  });
}

function serverApplySensorPulse(room,viewer,center,radius,specialName,durationMs,maxTargets){
  if(!room?.started||!viewer?.team)return;
  const rr=Math.max(.5,Number(radius)||20);
  const from=center||viewer.serverPos||viewer.spawn;
  const targets=[...room.players.values()]
    .filter(t=>t!==viewer&&t.serverAlive&&t.team&&t.team!==viewer.team)
    .map(t=>{
      const p=t.serverPos||t.spawn;
      return {target:t,d:Math.hypot((p.x||0)-(from.x||0),(p.z||0)-(from.z||0))};
    })
    .filter(v=>v.d<=rr)
    .sort((a,b)=>a.d-b.d)
    .slice(0,Math.max(1,Number(maxTargets)||99));
  for(const v of targets){
    serverSendSensorMark(viewer,v.target,specialName,durationMs);
  }
  return targets.length;
}

function serverResolveSpecial(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return;
  const name=String(m.specialName||''),spec=SERVER_SPECIALS[name];if(!spec)return;
  const me=player.serverPos||player.spawn;let x=Number(m.x),z=Number(m.z);
  if(!Number.isFinite(x))x=me.x;if(!Number.isFinite(z))z=me.z;
  const dist=Math.hypot(x-me.x,z-me.z);
  if(dist>45){const scale=45/dist;x=me.x+(x-me.x)*scale;z=me.z+(z-me.z)*scale;}
  if(!serverPointInStage(x,z))return;

  const sensorAlias=name==='パルスノード';
  const sensorHop=name==='ホップソナー'||sensorAlias;
  const sensorMega=name==='メガホンレーザー5.1ch'||name==='オムニレーザー';
  const sensorMissile=name==='センチネルミサイル';

  if(sensorMega){
    serverApplySensorPulse(room,player,{x,y:Number(m.y)||0,z},45,name,3000,3);
  }else if(sensorHop){
    /* ホップソナーはウェーブごとに再索敵する。 */
    const center={x,y:Number(m.y)||0,z};
    serverApplySensorPulse(room,player,center,20,name,8000,99);
    [1600,4100,6600].forEach(delay=>{
      setTimeout(()=>{
        if(rooms.get(room.id)!==room||!room.started||room.players.get(player.id)!==player||!player.team)return;
        serverApplySensorPulse(room,player,player.serverPos||center,20,name,8000,99);
      },delay);
    });
  }else if(sensorMissile){
    serverApplySensorPulse(room,player,{x,y:Number(m.y)||0,z},45,name,4000,3);
  }

  serverApplyAoE(room,{x,y:Number(m.y)||0,z},spec[1],spec[0],player.team,player,'special:'+name);
}
function finishServerMatch(room){
  if(!room||room.resultReported)return;
  room.resultReported=true;let a=0,b=0;
  for(const team of room.inkCells?.values()||[]){if(team==='A')a++;else if(team==='B')b++;}
  const winnerTeam=a===b?'DRAW':(a>b?'A':'B'),updated=[];
  for(const p of room.players.values()){const pr=updateAccountResult(p,winnerTeam);if(pr)updated.push({id:p.id,profile:pr});}
  console.log('[AUTH MATCH END] '+room.id+' Acells='+a+' Bcells='+b+' winner='+winnerTeam);
  broadcast(room,{type:'matchEnd',winnerTeam,results:updated,score:{A:a,B:b}});
  room.started=false;
  setTimeout(()=>{if(rooms.get(room.id)===room)rooms.delete(room.id);},5000);
}

let nextPlayerNo = 1;
let nextRoomNo = 1;
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function onlinePlayerCount() { return sockets.size; }
function broadcastGlobalOnlineCount() {
  const payload = { type: 'globalOnlineCount', count: onlinePlayerCount() };
  for (const player of sockets.values()) send(player.ws, payload);
}

const ONLINE_INK_COLORS={A:0xe3ff00,B:0xff2255};
function canonicalInkColor(player){
  return player?.team==='B'?ONLINE_INK_COLORS.B:ONLINE_INK_COLORS.A;
}
function applyCanonicalPlayerColor(player){
  const c=canonicalInkColor(player);
  if(player?.config)player.config.inkColorHex=c;
  return c;
}

function sanitizeConfig(cfg, fallbackWeapon=0) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    style: c.style === 'boy' ? 'boy' : 'girl',
    hair: Number.isFinite(Number(c.hair)) ? Math.max(0, Math.min(3, Math.floor(Number(c.hair)))) : 0,
    color: Number.isFinite(Number(c.color)) ? Math.max(0, Math.min(3, Math.floor(Number(c.color)))) : 0,
    outfit: Number.isFinite(Number(c.outfit)) ? Math.max(0, Math.min(49, Math.floor(Number(c.outfit)))) : 0,
    weapon: Number.isFinite(Number(c.weapon)) ? Math.max(0, Math.min(200, Math.floor(Number(c.weapon)))) : fallbackWeapon,
    gear: Number.isFinite(Number(c.gear)) ? Math.max(0, Math.min(3, Math.floor(Number(c.gear)))) : 0,
    device: c.device === 'mobile' ? 'mobile' : 'pc',
    inkColorHex: Number.isFinite(Number(c.inkColorHex)) ? Math.max(0, Math.min(0xffffff, Math.floor(Number(c.inkColorHex)))) : null
  };
}
function roster(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.accountName || p.id,
    team: p.team,
    ready: !!p.ready,
    weaponId: p.weaponId,
    spawn: p.spawn,
    config: Object.assign({}, p.config || sanitizeConfig(null,p.weaponId), {inkColorHex:applyCanonicalPlayerColor(p)})
  }));
}
function broadcast(room, obj, exceptId = null) {
  for (const p of room.players.values()) if (p.id !== exceptId) send(p.ws, obj);
}
function createWaitingRoom() {
  // 部屋番号は常に小さい空き番号から再利用する。
  let number = 1;
  while (rooms.has(`ROOM-${String(number).padStart(3, '0')}`)) number++;

  const id = `ROOM-${String(number).padStart(3, '0')}`;
  const room = {
    id,
    players: new Map(),
    started: false,
    resultReported: false,
    startsAt: 0,
    timer: 180,
    inkCells: new Map()
  };
  rooms.set(id, room);
  return room;
}

function waitingRoomFor() {
  // 待機部屋は必ず ROOM-001 → ROOM-002 → ROOM-003 の順。
  // 「人がいるか」ではなく「その部屋が8人で埋まっているか」だけで次の番号へ進む。
  // これで全員がまずROOM-001に入り、満員になったらROOM-002へ進む。
  const waiting = [...rooms.values()]
    .filter(room => !room.started)
    .sort((a, b) => {
      const an = Number(a.id.replace(/^ROOM-/, '')) || 0;
      const bn = Number(b.id.replace(/^ROOM-/, '')) || 0;
      return an - bn;
    });

  for (const room of waiting) {
    if (room.players.size < 8) return room;
  }

  return createWaitingRoom();
}
function assignTeamsAndStart(room) {
  if (room.started || room.players.size < 2) return;
  const ps = [...room.players.values()];
  if (!ps.every(p => p.ready)) return;
  ps.forEach((p, i) => {
    p.team = i % 2 === 0 ? 'A' : 'B';
    p.startedWeaponId = p.weaponId;
    const slot = Math.floor(i / 2);
    const x = ((slot % 4) - 1.5) * 3.2;
    p.spawn = p.team === 'A' ? { x, y: 0, z: -64 } : { x, y: 0, z: 64 };
  });
  room.resultReported=false;
  room.inkCells=new Map();
  seedServerSpawnInk(room);
  for(const p of ps){
    p.serverHp=100;p.serverAlive=true;p.serverInk=100;p.serverSquid=false;p.serverInkLastAt=Date.now();p.serverInkUseAt=0;p.serverRespawnAt=0;p.serverPos=Object.assign({},p.spawn);
    p.lastStatePos=Object.assign({},p.spawn);p.lastStateAt=Date.now();p.lastShotAt=0;p.lastSubAt=0;p.lastHazardAt=0;
  }
  room.started = true; room.startsAt = Date.now() + 1500; room.timer = 180;
  console.log('[MATCH START] '+room.id+' players='+ps.map(p=>p.id+'('+(p.accountName||'-')+')').join(',')+' totalSockets='+sockets.size);
  const r = roster(room);
  for (const p of ps) send(p.ws, { type: 'matchFound', roomId: room.id, selfId: p.id, team: p.team, spawn: p.spawn, startAt: room.startsAt, players: r });
}
function joinRoom(player) {
  if (player.roomId) return rooms.get(player.roomId);
  const room = waitingRoomFor();
  room.players.set(player.id, player);
  player.roomId = room.id;
  player.team = null;
  player.ready = false;

  // 参加者が入るたび、部屋全員へ現在人数を即時通知する。
  const players = roster(room);
  const roomPayload = { type: 'roomState', roomId: room.id, players, count: players.length, minPlayers: 2, maxPlayers: 8 };
  for (const p of room.players.values()) send(p.ws, roomPayload);
  console.log(`[MATCH] ${room.id}: ${players.length}/8 players joined | player=${player.id} account=${player.accountName || '-'} totalSockets=${sockets.size} waitingRooms=${[...rooms.values()].filter(r=>!r.started).map(r=>r.id+':'+r.players.size).join(',') || '-'}`);
  return room;
}
function leaveRoom(player) {
  const room = player.roomId ? rooms.get(player.roomId) : null;
  if (!room) { player.roomId = null; player.team = null; player.ready = false; return; }

  const leavingId = player.id;
  const leavingName = player.accountName || player.id;
  const wasStarted = !!room.started;

  // Map.delete makes a leave idempotent: duplicate close/leave events cannot
  // remove somebody else or broadcast the same player twice.
  room.players.delete(leavingId);
  player.roomId = null;
  player.team = null;
  player.ready = false;

  if (wasStarted) {
    // Existing players must immediately remove the disconnected fighter.
    // Previously a started room only cleaned itself when empty, leaving
    // ghost/duplicate fighters on every remaining client.
    if (room.players.size > 0) {
      broadcast(room, { type: 'playerLeft', id: leavingId, name: leavingName });
    }
    if (room.players.size === 0) rooms.delete(room.id);
    return;
  }

  const players = roster(room);
  const payload = { type: 'roomState', roomId: room.id, players, count: players.length, minPlayers: 2, maxPlayers: 8 };
  for (const p of room.players.values()) send(p.ws, payload);
  if (room.players.size === 0) rooms.delete(room.id);
}
function updateAccountResult(player, winnerTeam) {
  const a = accounts[player.accountName]; if (!a) return null;
  const won = winnerTeam === 'DRAW' ? null : player.team === winnerTeam;
  a.games += 1;
  if (won === true) { a.wins += 1; a.rating = Math.min(3000, a.rating + 25); }
  else if (won === false) { a.losses += 1; a.rating = Math.max(0, a.rating - 20); }
  saveAccounts(); return profile(a);
}

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }
  if (req.method === 'GET' && p === '/health') {
    return json(res, 200, { ok: true, service: 'splatoon-like-web-online', websocket: true, time: new Date().toISOString() });
  }
  if (req.method === 'POST' && (p === '/api/account/register' || p === '/api/account/login')) {
    try {
      const b = await readBody(req); const name = String(b.name || ''); const pw = String(b.password || '');
      if (!validName(name) || !validPassword(pw)) return json(res, 400, { ok: false, error: '名前は2〜16文字、パスワードは4〜72文字です。' });
      if (p.endsWith('register')) {
        if (accounts[name]) return json(res, 409, { ok: false, error: 'その名前はすでに登録されています。' });
        const salt = crypto.randomBytes(16).toString('hex');
        accounts[name] = { name, salt, hash: hashPassword(pw, salt), rating: 750, wins: 0, losses: 0, games: 0 };
        saveAccounts();
      } else {
        const a = accounts[name];
        if (!a) return json(res, 401, { ok: false, error: '名前またはパスワードが違います。' });
        const supplied = Buffer.from(hashPassword(pw, a.salt), 'hex');
        const actual = Buffer.from(a.hash, 'hex');
        if (supplied.length !== actual.length || !crypto.timingSafeEqual(supplied, actual)) return json(res, 401, { ok: false, error: '名前またはパスワードが違います。' });
      }
      const token = issueToken();
      sessions.set(token, { name });
      accounts[name].sessionToken=token;
      saveAccounts();
      return json(res, 200, { ok: true, token, profile: profile(accounts[name]), created: p.endsWith('register') });
    } catch { return json(res, 400, { ok: false, error: 'リクエストを処理できませんでした。' }); }
  }
  if (req.method === 'GET' && p === '/api/account/me') {
    const s = getSession(req); if (!s || !accounts[s.name]) return json(res, 401, { ok: false });
    return json(res, 200, { ok: true, profile: profile(accounts[s.name]) });
  }
  if (req.method === 'POST' && p === '/api/account/result') {
    const s = getSession(req); if (!s || !accounts[s.name]) return json(res, 401, { ok: false });
    const b = await readBody(req).catch(() => ({})); const winner = String(b.winnerTeam || 'DRAW');
    return json(res, 200, { ok: true, profile: updateAccountResult({ accountName: s.name, team: b.team || 'A' }, winner) });
  }
  if (req.method === 'POST' && p === '/api/feedback') {
    try {
      const b = await readBody(req);
      const allowed = new Set(['バグ','ラグ','操作','マッチング','見た目','その他']);
      const category = allowed.has(String(b.category||'')) ? String(b.category) : 'その他';
      const text = String(b.text||'').slice(0,1000);
      const s = getSession(req);
      const account = s && accounts[s.name] ? s.name : null;
      const item = {
        at:new Date().toISOString(),
        account,
        category,
        text,
        build:String(b.build||'').slice(0,80),
        roomId:String(b.roomId||'').slice(0,32)
      };
      if(!global.feedbackStore) global.feedbackStore=[];
      global.feedbackStore.push(item);
      if(global.feedbackStore.length>500) global.feedbackStore.splice(0,global.feedbackStore.length-500);
      console.log('[FEEDBACK]',JSON.stringify(item));
      return json(res, 200, { ok:true });
    } catch {
      return json(res,400,{ok:false,error:'フィードバックを処理できませんでした。'});
    }
  }
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, p.replace(/^\/+/, ''));
  const relativeFile = path.relative(ROOT, file);
  if (relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const ext = path.extname(file).toLowerCase();
    const ct = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' }); res.end(data);
  });
});

function securityStrike(player, reason) {
  const now = Date.now();
  if (!player.securityWindowStart || now-player.securityWindowStart>10000) {
    player.securityWindowStart=now;
    player.securityStrikes=0;
  }
  player.securityStrikes++;
  console.warn(`[ANTI-CHEAT] ${player.id} strike=${player.securityStrikes} reason=${reason}`);
  send(player.ws,{type:'antiCheatWarning',reason:'不正または異常な通信を検知しました。'});
  if(player.securityStrikes>=4){
    try{ player.ws.close(1008,'invalid client state'); }catch{}
    return false;
  }
  return true;
}
function finiteNumber(v){ return Number.isFinite(Number(v)); }
function saneWorldPosition(x,y,z){
  return finiteNumber(x)&&finiteNumber(y)&&finiteNumber(z)
    && Number(x)>=-50 && Number(x)<=50
    && Number(z)>=-80 && Number(z)<=80
    && Number(y)>=-0.5 && Number(y)<=8;
}
function messageBudget(player){
  const now=Date.now();
  if(!player.msgWindowStart || now-player.msgWindowStart>=1000){
    player.msgWindowStart=now; player.msgCount=0; player.msgRateDrops=0;
  }
  player.msgCount++;
  if(player.msgCount<=240)return true;
  // Excess gameplay packets are dropped instead of disconnecting a healthy client.
  // This avoids false positives when paint + state + action packets overlap.
  player.msgRateDrops=(player.msgRateDrops||0)+1;
  return false;
}

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('error',err=>console.warn('[WS ERROR]',err?.message||err));
  const id = `Player_${String(nextPlayerNo++).padStart(4, '0')}`;
  const player = {
    id, ws, roomId: null, team: null, ready: false, weaponId: 0,
    config: sanitizeConfig(null,0), spawn: { x: 0, y: 0, z: 0 },
    lastStateAt: 0, lastStatePos: null, lastStateAlive: true, stateSeq: 0,
    accountName: null, accountToken: null,
    msgWindowStart: 0, msgCount: 0, securityWindowStart: 0, securityStrikes: 0,
    lastCalloutAt: 0, lastSpecialStartAt: 0, lastSpecialAt: 0,
    serverHp:100, serverAlive:true, serverPos:null, serverRespawnAt:0,
    lastHazardAt:0, lastShotAt:0, lastSubAt:0,
    msgRateDrops:0, speedViolations:0, lastSpeedStrikeAt:0
  };
  sockets.set(ws, player);
  console.log(`[WS CONNECT] ${player.id} activeSockets=${sockets.size}`);
  send(ws, { type: 'hello', id });
  broadcastGlobalOnlineCount();
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if(!m || typeof m!=='object' || typeof m.type!=='string') return;
    if(!messageBudget(player)){
      if((player.msgRateDrops||0)===1)console.warn('[WS RATE DROP] '+player.id+' account='+(player.accountName||'-'));
      return;
    }
    if (m.type === 'bindAccount') {
      const token = String(m.token || '');
      const s = sessionForToken(token);
      if (s && accounts[s.name]) {
        // Connections are identified by their WebSocket player id.
        // The same account may be open on more than one device/tab without
        // forcibly disconnecting an active match.
        player.accountName = s.name;
        player.accountToken = token;
        console.log(`[WS BIND] ${player.id} account=${player.accountName}`);
        send(ws, { type: 'accountBound', profile: profile(accounts[s.name]) });
      } else {
        console.log(`[WS BIND FAIL] ${player.id} tokenInvalid=true`);
        send(ws, { type: 'accountBound', error: 'ログイン情報が無効です。' });
      }
      return;
    }
    if (m.type === 'joinQueue') {
      if (m.config && typeof m.config === 'object') player.config = sanitizeConfig(m.config, player.weaponId);
      applyCanonicalPlayerColor(player);
      if (Number.isFinite(Number(m.weaponId))) player.weaponId = Math.max(0, Math.min(200, Math.floor(Number(m.weaponId))));
      player.config.weapon = player.weaponId;
      // Online battles can also use Render without a WEB ID.
      // Registered users keep their account/rating; guests simply use their connection id.
      if (!player.accountName) player.accountName = `Guest_${player.id}`;
      console.log(`[WS JOIN REQUEST] ${player.id} account=${player.accountName} currentRoom=${player.roomId || '-'}`);
      const room = joinRoom(player);
      console.log(`[WS JOIN RESULT] ${player.id} account=${player.accountName} room=${room ? room.id : '-'} roomPlayers=${room ? room.players.size : 0} totalSockets=${sockets.size}`);
      return;
    }
    if (m.type === 'ready') {
      const room = player.roomId ? rooms.get(player.roomId) : null;
      if (!room || room.started) {
        console.log(`[WS READY IGNORED] ${player.id} room=${player.roomId || '-'} reason=no-waiting-room-or-started`);
        return;
      }
      player.ready = !!m.ready;
      player.weaponId = Number.isFinite(m.weaponId) ? Math.max(0, Math.min(200, Math.floor(Number(m.weaponId)))) : player.weaponId;
      if(m.config && typeof m.config === 'object') player.config=sanitizeConfig(m.config,player.weaponId);
      applyCanonicalPlayerColor(player);
      player.config.weapon=player.weaponId;
      console.log(`[WS READY] ${player.id} room=${room.id} ready=${player.ready} roomPlayers=${room.players.size}`);
      broadcast(room, { type: 'roomState', roomId: room.id, players: roster(room), count: room.players.size, minPlayers: 2, maxPlayers: 8 });
      assignTeamsAndStart(room); return;
    }
    if (m.type === 'probe') {
      send(ws,{type:'probeAck',at:Date.now(),build:'V93-ONLINE-UNIFIED'});
      return;
    }
    if (m.type === 'keepalive') {
      send(ws,{type:'keepaliveAck',at:m.at||Date.now()});
      return;
    }
    if (m.type === 'leaveQueue') {
      console.log(`[WS LEAVE REQUEST] ${player.id} room=${player.roomId || '-'} account=${player.accountName || '-'}`);
      leaveRoom(player);
      console.log(`[WS LEAVE RESULT] ${player.id} room=- totalSockets=${sockets.size} rooms=${rooms.size}`);
      return;
    }
    const room = player.roomId ? rooms.get(player.roomId) : null; if (!room) return;
    if (m.type === 'shot') {
      if (!room.started || !player.team) return;
      const nums = ['x','y','z','dx','dy','dz'].map(k => Number(m[k]));
      if (nums.some(v => !Number.isFinite(v))) return;
      const dirLen = Math.hypot(nums[3], nums[4], nums[5]);
      if (dirLen < 0.001 || dirLen > 2.0) return;
      const weaponId = Number.isFinite(Number(m.weaponId)) ? Math.max(0, Math.min(200, Math.floor(Number(m.weaponId)))) : player.weaponId;
      const charge = Number.isFinite(Number(m.charge)) ? Math.max(0, Math.min(1, Number(m.charge))) : null;
      const mode = typeof m.mode === 'string' ? String(m.mode).slice(0, 32) : null;
      const accepted=serverResolveShot(room,player,Object.assign({},m,{weaponId,dx:nums[3],dy:nums[4],dz:nums[5],charge}));
      if(!accepted)return;
      broadcast(room, {
        type: 'shot',
        id: player.id,
        team: player.team,
        x: player.serverPos?.x ?? nums[0], y: player.serverPos?.y ?? nums[1], z: player.serverPos?.z ?? nums[2],
        dx: nums[3] / dirLen, dy: nums[4] / dirLen, dz: nums[5] / dirLen,
        weaponId, charge, mode
      }, player.id);
      return;
    }
    if (m.type === 'sub') {
      if (!room.started || !player.team) return;
      const nums = ['x','y','z','vx','vy','vz'].map(k => Number(m[k]));
      if (nums.some(v => !Number.isFinite(v))) return;
      const subType = String(m.subType || '');
      const allowed = [
        'timed','stick','instant','slide','bounce','seek','homing','sensor','turret',
        'splatBomb','suctionBomb','burstBomb','curlingBomb','fizzyBomb','autobomb',
        'inkMine','pointSensor','splashWall','sprinkler','torpedo','angleShooter','toxicMist'
      ];
      if (!allowed.includes(subType)) return;
      const speed = Math.hypot(nums[3], nums[4], nums[5]);
      if (speed < 0.01 || speed > 40) return;
      const weaponId = Number.isFinite(Number(m.weaponId)) ? Math.max(0, Math.min(200, Math.floor(Number(m.weaponId)))) : player.weaponId;
      const charge = Number.isFinite(Number(m.charge)) ? Math.max(0, Math.min(1.4, Number(m.charge))) : 0;
      broadcast(room, {
        type: 'sub',
        id: player.id,
        team: player.team,
        x: player.serverPos?.x ?? nums[0], y: player.serverPos?.y ?? nums[1], z: player.serverPos?.z ?? nums[2],
        vx: nums[3], vy: nums[4], vz: nums[5],
        subType,
        weaponId, charge
      }, player.id);
      serverResolveSub(room,player,Object.assign({},m,{subType,vx:nums[3],vy:nums[4],vz:nums[5]}));
      return;
    }
    // Charge Orb has a dedicated two-phase protocol. Only handle that
    // protocol here; other special messages must reach the generic handler below.
    if (m.type === 'special' && String(m.specialType || '') === 'chargeOrb') {
      if(!room.started || !player.team) return;
      const phase=String(m.phase||'');
      const now=Date.now();
      if(phase==='start'){
        if(now-player.lastSpecialStartAt<1200)return;
        player.lastSpecialStartAt=now;
        broadcast(room,{type:'special',specialType:'chargeOrb',phase:'start',id:player.id,team:player.team},player.id);
        return;
      }
      if(phase!=='throw') return;
      if(!player.lastSpecialStartAt || now-player.lastSpecialStartAt>6000)return;
      const nums=['x','y','z','charge'].map(k=>Number(m[k]));
      if(nums.slice(0,3).some(v=>!Number.isFinite(v))||!Number.isFinite(nums[3]))return;
      if(!saneWorldPosition(nums[0],nums[1],nums[2])||nums[3]<0||nums[3]>100)return;
      player.lastSpecialAt=now;player.lastSpecialStartAt=0;
      broadcast(room,{type:'special',specialType:'chargeOrb',phase:'throw',id:player.id,team:player.team,x:nums[0],y:nums[1],z:nums[2],charge:Math.max(0,Math.min(100,nums[3]))},player.id);
      serverResolveSpecial(room,player,{specialName:'チャージオーブ',x:nums[0],y:nums[1],z:nums[2]});
      return;
    }
    if (m.type === 'special') {
      if (!room.started || !player.team) return;
      const specialName=String(m.specialName || '');
      const legacyOrb=String(m.specialType || '')==='chargeOrb';
      const allowed=[
        'トリガーキャノン','ドームシールド','グラップラー','センチネルミサイル','ペイントクラウド',
        'ギガスタンプ','オムニレーザー','チャージオーブ','パルスノード','ヴァキュームコア',
        'ブーストステーション','ラッシュカート','トライアークトルネード','スカイパック',
        'アサルトシェル','スワームビーコン','コロッサス','トリプルクラッシュ','スモークスクリーン',
        'ウルトラショット','ナイスダマ','カニタンク','ジェットパック','キューインキ','アメフラシ',
        'ホップソナー','グレートバリア','サメライド','ウルトラハンコ','テイオウイカ','エナジースタンド',
        'メガホンレーザー5.1ch','マルチミサイル','デコイチラシ','スミナガシート','ウルトラチャクチ','ショクワンダー'
      ];
      const name=legacyOrb?'チャージオーブ':specialName;
      if(!allowed.includes(name)) return;
      const now=Date.now();
      if(now-player.lastSpecialAt<500) return;
      const x=Number(m.x),y=Number(m.y),z=Number(m.z);
      if(!saneWorldPosition(x,y,z)) return;
      let extra=(m.extra && typeof m.extra==='object')?m.extra:{};
      const compact={};
      if(legacyOrb && m.phase) compact.phase=String(m.phase).slice(0,12);
      for(const k of ['angle','targetId']) if(extra[k]!==undefined) compact[k]=String(extra[k]).slice(0,40);
      player.lastSpecialAt=now;
      broadcast(room,{
        type:'special', id:player.id, team:player.team,
        specialName:name, x,y,z, extra:compact
      },player.id);
      serverResolveSpecial(room,player,Object.assign({},m,{specialName:name,x,y,z}));
      return;
    }
    if (m.type === 'callout') {
      const now=Date.now();
      if(!room.started) return;
      if(now-player.lastCalloutAt<800) return;
      const calloutType=String(m.calloutType||'');
      if(calloutType!=='nice' && calloutType!=='cmon') return;
      player.lastCalloutAt=now;
      broadcast(room,{type:'callout',id:player.id,name:player.accountName||player.id,calloutType},player.id);
      return;
    }
    if (m.type === 'state') {
      const now=Date.now(); if(now-player.lastStateAt<28)return;
      const x=Number(m.x),rawY=Number(m.y),z=Number(m.z),yaw=Number(m.yaw);
      if(!saneWorldPosition(x,rawY,z)||!Number.isFinite(yaw)){securityStrike(player,'invalid-position');return;}
      if(rawY<-1||rawY>14){securityStrike(player,'invalid-height');return;}
      if(!serverPointInStage(x,z)){securityStrike(player,'outside-stage');return;}
      const y=Math.max(0,rawY);
      if(player.serverHp==null)player.serverHp=100; if(player.serverAlive==null)player.serverAlive=true; if(player.serverInk==null)player.serverInk=100;
      if(player.serverAlive){
        if(player.serverPos){
          const dt=Math.max(.028,(now-player.lastStateAt)/1000),d=Math.hypot(x-player.serverPos.x,z-player.serverPos.z);
          // Super-jump is a legitimate large 2D displacement over ~1 second.
          // Normal movement keeps the strict speed gate; a flagged super-jump gets
          // a larger temporary allowance instead of being disconnected.
          const maxStep=m.superJump ? Math.min(12,.82+dt*150) : Math.min(2.8,.82+dt*42);
          if(d>maxStep){
            player.speedViolations=(player.speedViolations||0)+1;
            if(player.speedViolations>3&&now-(player.lastSpeedStrikeAt||0)>1200){
              player.lastSpeedStrikeAt=now;
              securityStrike(player,'server-speed='+d.toFixed(2)+' max='+maxStep.toFixed(2));
            }
            return;
          }
          player.speedViolations=0;
        }
        player.serverPos={x,y,z}; player.lastStatePos={x,z,y}; player.lastStateAt=now;
      }
      const prevInkAt=player.serverInkLastAt||now;
      const inkDt=Math.max(0,Math.min(.25,(now-prevInkAt)/1000));
      if(player.serverSquid&&now-(player.serverInkUseAt||0)>=450){
        player.serverInk=Math.min(100,(player.serverInk??100)+42*inkDt);
      }
      player.serverInkLastAt=now;
      if(room.started&&player.serverAlive&&player.team&&now-(player.lastHazardAt||0)>=350){
        player.lastHazardAt=now; const inkTeam=serverInkTeamAt(room,player.serverPos||player.spawn);
        if(inkTeam&&inkTeam!==player.team){const damage=Math.max(0,Math.min(4,Math.max(0,player.serverHp-1)));if(damage>0)serverApplyDamage(room,player,damage,null,'enemy-ink');}
      }
      const serverPos=player.serverPos||player.spawn,enemyInk=room.started&&player.team&&serverInkTeamAt(room,serverPos)!=null&&serverInkTeamAt(room,serverPos)!==player.team;
      player.serverSquid=!!m.squid&&!enemyInk;
      const packet={type:'state',seq:++player.stateSeq,id:player.id,name:player.accountName||player.id,team:player.team,x:serverPos.x,y:serverPos.y||0,z:serverPos.z,yaw,
        hp:Math.max(0,Math.min(100,player.serverHp||0)),ink:Math.max(0,Math.min(100,player.serverInk??100)),alive:!!player.serverAlive,squid:!!m.squid&&!enemyInk,moving:!!m.moving,weaponId:player.weaponId,colorHex:applyCanonicalPlayerColor(player)};
      broadcast(room,packet,player.id); send(player.ws,packet); return;
    }

    if (m.type === 'paint') {
      if(!room.started||!player.team||!player.serverAlive)return;
      const x=Number(m.x),z=Number(m.z),radius=Number(m.radius);
      if(![x,z,radius].every(Number.isFinite)||radius<.2||radius>8||!serverPointInStage(x,z))return;
      const now=Date.now();
      if(now-(player.lastPaintAt||0)<28)return;
      player.lastPaintAt=now;
      const serverPos=player.serverPos||player.spawn,y=Number.isFinite(Number(m.y))?Number(m.y):Number(serverPos.y)||0;
      const colorHex=applyCanonicalPlayerColor(player);
      const x2=Number(m.x2),z2=Number(m.z2);
      markServerPaint(room,x,z,radius,player.team,y,
        Number.isFinite(x2)&&Number.isFinite(z2)&&serverPointInStage(x2,z2)?x2:undefined,
        Number.isFinite(x2)&&Number.isFinite(z2)&&serverPointInStage(x2,z2)?z2:undefined);
      const pn={
        type:'paint',id:player.id,team:player.team,x,z,radius,colorHex,y,mult:1,
        ...(Number.isFinite(x2)&&Number.isFinite(z2)&&serverPointInStage(x2,z2)?{x2,z2}:{}),
        ...(Number.isFinite(Number(m.nx))&&Number.isFinite(Number(m.ny))&&Number.isFinite(Number(m.nz))?{
          nx:Number(m.nx),ny:Number(m.ny),nz:Number(m.nz)
        }:{})
      };
      broadcast(room,pn,player.id);
      send(player.ws,{type:'serverInk',ink:player.serverInk}); return;
    }

  });
  ws.on('close', (code, reason) => {
    ws.isAlive=false;
    const beforeRoom = player.roomId || '-';
    const beforeAccount = player.accountName || '-';
    console.log(`[WS CLOSE] ${player.id} account=${beforeAccount} room=${beforeRoom} code=${code} reason=${String(reason || '')} activeSocketsBefore=${sockets.size}`);
    sockets.delete(ws);
    leaveRoom(player);
    console.log(`[WS CLOSE AFTER] ${player.id} rooms=${rooms.size} activeSockets=${sockets.size}`);
    broadcastGlobalOnlineCount();
  });
});

const WS_HEARTBEAT=setInterval(()=>{
  for(const player of sockets.values()){
    const ws=player.ws;
    if(ws.readyState!==1)continue;
    if(ws.isAlive===false){
      console.warn('[WS HEARTBEAT TIMEOUT] '+player.id);
      try{ws.terminate();}catch(_){}
      continue;
    }
    ws.isAlive=false;
    try{ws.ping();}catch(_){}
  }
},30000);
WS_HEARTBEAT.unref?.();

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.started) continue;
    const remain = Math.max(0, 180 - Math.max(0, (now - room.startsAt) / 1000)); room.timer = remain;
    broadcast(room, { type:'serverTick', remaining:remain, started:now >= room.startsAt });
    if (remain <= 0 && !room.resultReported) { finishServerMatch(room); }
  }
}, 500);
server.listen(PORT, '0.0.0.0', () => console.log(`Splatoon-like room server listening on ${PORT}`));