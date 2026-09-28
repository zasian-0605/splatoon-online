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
function getSession(req) {
  const auth = String(req.headers.authorization || '');
  return sessions.get(auth.startsWith('Bearer ') ? auth.slice(7) : '');
}

const rooms = new Map();
const sockets = new Map();

const SERVER_CELL=2;
const SERVER_Y_STEP=.5;
const SERVER_STAGE_POLYGON=[[48,-30.4],[14,-72],[0.5,-38.4],[-3.5,-44.8],[-19,-20.8],[-20.5,-33.6],[-20.5,-17.6],[-14,-3.2],[-36.5,3.2],[-47.5,20.8],[-48,35.2],[-14,72],[-4,46.4],[4,48],[20.5,24],[20,8],[19,20.8],[13.5,9.6],[36,0],[48,-17.6]];
const SERVER_WEAPONS={
  0:{cat:'shooter',damage:32,rate:95,range:34},1:{cat:'shooter',damage:42,rate:180,range:32},
  2:{cat:'shooter',damage:24,rate:70,range:34},3:{cat:'shooter',damage:35,rate:145,range:38},
  4:{cat:'shooter',damage:48,rate:245,range:34},5:{cat:'blaster',damage:76,rate:650,range:28,explosion:2.6,splash:36},
  6:{cat:'blaster',damage:58,rate:820,range:28,explosion:3.2,splash:55},7:{cat:'blaster',damage:55,rate:430,range:30,explosion:2.0,splash:26},
  8:{cat:'blaster',damage:82,rate:700,range:30,explosion:2.8,splash:44},9:{cat:'charger',tap:34,full:120,rate:900,range:58},
  10:{cat:'charger',tap:30,full:170,rate:1350,range:62},11:{cat:'charger',tap:26,full:100,rate:640,range:58},
  12:{cat:'roller',damage:78,rate:380,range:4.0},13:{cat:'roller',damage:108,rate:560,range:4.6},
  14:{cat:'roller',damage:45,rate:190,range:3.2},15:{cat:'maneuver',damage:18,rate:60,range:34},
  16:{cat:'maneuver',damage:20,rate:82,range:37},17:{cat:'maneuver',damage:30,rate:145,range:31},
  18:{cat:'slosher',damage:68,rate:520,range:22,explosion:2.4},19:{cat:'slosher',damage:50,rate:420,range:21,explosion:1.9},
  20:{cat:'slosher',damage:84,rate:780,range:20,explosion:3.0},21:{cat:'slosher',damage:72,rate:600,range:25,explosion:2.6},
  22:{cat:'wiper',damage:72,full:105,rate:520,range:5.0},23:{cat:'wiper',damage:95,full:140,rate:720,range:6.0}
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
  let inside=false;
  for(let i=0,j=SERVER_STAGE_POLYGON.length-1;i<SERVER_STAGE_POLYGON.length;j=i++){
    const xi=SERVER_STAGE_POLYGON[i][0],zi=SERVER_STAGE_POLYGON[i][1],xj=SERVER_STAGE_POLYGON[j][0],zj=SERVER_STAGE_POLYGON[j][1];
    const hit=((zi>z)!==(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}
function serverCellKey(x,z,y){
  return Math.floor(Number(x)/SERVER_CELL)+','+Math.floor(Number(z)/SERVER_CELL)+','+Math.round(Number(y||0)/SERVER_Y_STEP);
}
function markServerPaint(room,x,z,radius,team,y){
  const r=Math.max(.2,Math.min(8,Number(radius)||0));
  const minX=Math.floor((x-r)/SERVER_CELL),maxX=Math.ceil((x+r)/SERVER_CELL);
  const minZ=Math.floor((z-r)/SERVER_CELL),maxZ=Math.ceil((z+r)/SERVER_CELL);
  const gy=Math.round((Number(y)||0)/SERVER_Y_STEP);
  for(let gx=minX;gx<=maxX;gx++){
    for(let gz=minZ;gz<=maxZ;gz++){
      const cx=(gx+.5)*SERVER_CELL,cz=(gz+.5)*SERVER_CELL;
      if(Math.hypot(cx-x,cz-z)<=r+1 && serverPointInStage(cx,cz))room.inkCells.set(gx+','+gz+','+gy,team);
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
    if(rooms.get(keepRoom.id)!==keepRoom||!keepRoom.started||!target.ws||target.ws.readyState!==1)return;
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
function serverResolveShot(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return;
  const wid=Number.isFinite(Number(m.weaponId))?Math.max(0,Math.min(200,Math.floor(Number(m.weaponId)))):player.weaponId;
  const w=SERVER_WEAPONS[wid];if(!w)return;
  const now=Date.now();
  if(now-(player.lastShotAt||0)<Math.max(35,w.rate*.72))return;
  player.lastShotAt=now;
  const dx=Number(m.dx),dy=Number(m.dy),dz=Number(m.dz),len=Math.hypot(dx,dy,dz);
  if(!Number.isFinite(len)||len<.001||len>2)return;
  const dir={x:dx/len,y:dy/len,z:dz/len},origin={x:player.serverPos?.x||0,y:(player.serverPos?.y||0)+1.2,z:player.serverPos?.z||0},range=w.range||35;
  const mode=String(m.mode||'');
  const hitRadius=(mode==='roller-flick'||mode==='brush')?2.2:(mode==='roller-roll'?1.55:(mode==='wiper'?1.65:.95));
  let nearest=null;
  for(const target of room.players.values()){
    if(!target.serverAlive||target.team===player.team)continue;
    const p=target.serverPos||target.spawn;
    const hit=serverDistanceToSegment(p.x,p.y+.9,p.z,origin.x,origin.y,origin.z,
      origin.x+dir.x*range,origin.y+dir.y*range,origin.z+dir.z*range);
    if(hit.distance<hitRadius&&(!nearest||hit.t<nearest.hit.t))nearest={target,hit};
  }
  if(w.cat==='blaster'||w.cat==='slosher'){
    const center=nearest?{x:nearest.hit.x,y:nearest.hit.y,z:nearest.hit.z}:{x:origin.x+dir.x*Math.min(range,16),y:origin.y+dir.y*Math.min(range,16),z:origin.z+dir.z*Math.min(range,16)};
    serverApplyAoE(room,center,w.explosion||2.4,w.damage||0,player.team,player,w.cat);
    if(nearest&&w.damage)serverApplyDamage(room,nearest.target,w.damage,player,w.cat+' direct');
    return;
  }
  if(w.cat==='charger'){
    const frac=Math.max(0,Math.min(1,Number(m.charge)||0));
    if(nearest)serverApplyDamage(room,nearest.target,w.tap+(w.full-w.tap)*frac,player,'charger');
    return;
  }
  if(w.cat==='wiper'){
    const frac=Math.max(0,Math.min(1,Number(m.charge)||0));
    const dmg=(w.damage||72)+((w.full||w.damage||72)-(w.damage||72))*frac;
    if(nearest)serverApplyDamage(room,nearest.target,dmg,player,'wiper');
    return;
  }
  if(nearest){
    let dmg=w.damage||0;
    if(mode==='roller-roll')dmg=Math.min(65,dmg);
    serverApplyDamage(room,nearest.target,dmg,player,w.cat);
  }
}
function serverResolveSub(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return;
  const def=SERVER_SUBS[String(m.subType||'')];if(!def)return;
  const now=Date.now();if(now-(player.lastSubAt||0)<180)return;player.lastSubAt=now;
  const pos=Object.assign({},player.serverPos||player.spawn),vx=Number(m.vx)||0,vz=Number(m.vz)||0;
  const scale=Math.min(1.8,Math.max(.25,(def.delay||0)/1000)),center={x:pos.x+vx*scale,z:pos.z+vz*scale,y:pos.y||0};
  if(!serverPointInStage(center.x,center.z))return;
  setTimeout(()=>{if(!rooms.get(room.id)||!room.started)return;serverApplyAoE(room,center,def.radius||0,def.damage||0,player.team,player,'sub');},Math.max(0,def.delay||0));
}
function serverResolveSpecial(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return;
  const name=String(m.specialName||''),spec=SERVER_SPECIALS[name];if(!spec)return;
  const me=player.serverPos||player.spawn;let x=Number(m.x),z=Number(m.z);
  if(!Number.isFinite(x))x=me.x;if(!Number.isFinite(z))z=me.z;
  const dist=Math.hypot(x-me.x,z-me.z);
  if(dist>45){const s=45/dist;x=me.x+(x-me.x)*s;z=me.z+(z-me.z)*s;}
  if(!serverPointInStage(x,z))return;
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
    config: p.config || sanitizeConfig(null,p.weaponId)
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
    p.serverHp=100;p.serverAlive=true;p.serverInk=100;p.serverRespawnAt=0;p.serverPos=Object.assign({},p.spawn);
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
  const roomPayload = { type: 'room', roomId: room.id, players, count: players.length, minPlayers: 2, maxPlayers: 8 };
  const queuePayload = { type: 'queue', roomId: room.id, count: players.length, maxPlayers: 8 };
  for (const p of room.players.values()) {
    send(p.ws, roomPayload);
    send(p.ws, queuePayload);
  }
  console.log(`[MATCH] ${room.id}: ${players.length}/8 players joined | player=${player.id} account=${player.accountName || '-'} totalSockets=${sockets.size} waitingRooms=${[...rooms.values()].filter(r=>!r.started).map(r=>r.id+':'+r.players.size).join(',') || '-'}`);
  return room;
}
function leaveRoom(player) {
  const room = player.roomId ? rooms.get(player.roomId) : null;
  if (!room) { player.roomId = null; return; }
  room.players.delete(player.id); player.roomId = null; player.team = null; player.ready = false;
  if (!room.started) {
    const players = roster(room);
    const payload = { type: 'room', roomId: room.id, players, count: players.length, minPlayers: 2, maxPlayers: 8 };
    const queuePayload = { type: 'queue', roomId: room.id, count: players.length, maxPlayers: 8 };
    for (const p of room.players.values()) {
      send(p.ws, payload);
      send(p.ws, queuePayload);
    }
    if (room.players.size === 0) rooms.delete(room.id);
  }
  else if (room.players.size === 0) rooms.delete(room.id);
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
      const token = issueToken(); sessions.set(token, { name });
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
    player.msgWindowStart=now; player.msgCount=0;
  }
  player.msgCount++;
  return player.msgCount<=120;
}

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  const id = `Player_${String(nextPlayerNo++).padStart(4, '0')}`;
  const player = {
    id, ws, roomId: null, team: null, ready: false, weaponId: 0,
    config: sanitizeConfig(null,0), spawn: { x: 0, y: 0, z: 0 },
    lastStateAt: 0, lastStatePos: null, lastStateAlive: true,
    accountName: null, accountToken: null,
    msgWindowStart: 0, msgCount: 0, securityWindowStart: 0, securityStrikes: 0,
    lastCalloutAt: 0, lastSpecialStartAt: 0, lastSpecialAt: 0,
    serverHp:100, serverAlive:true, serverPos:null, serverRespawnAt:0,
    lastHazardAt:0, lastShotAt:0, lastSubAt:0
  };
  sockets.set(ws, player);
  console.log(`[WS CONNECT] ${player.id} activeSockets=${sockets.size}`);
  send(ws, { type: 'hello', id });
  broadcastGlobalOnlineCount();
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if(!m || typeof m!=='object' || typeof m.type!=='string') return;
    if(!messageBudget(player)){
      securityStrike(player,'message-rate');
      return;
    }
    if (m.type === 'bindAccount') {
      const token = String(m.token || '');
      const s = sessions.get(token);
      if (s && accounts[s.name]) {
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
      if (Number.isFinite(Number(m.weaponId))) player.weaponId = Math.max(0, Math.min(200, Math.floor(Number(m.weaponId))));
      player.config.weapon = player.weaponId;
      // Online battles can also use Render without a WEB ID.
      // Registered users keep their account/rating; guests simply use their connection id.
      if (!player.accountName) player.accountName = `Guest_${player.id}`;
      console.log(`[WS JOIN REQUEST] ${player.id} account=${player.accountName} currentRoom=${player.roomId || '-'}`);
      const room = joinRoom(player);
      console.log(`[WS JOIN RESULT] ${player.id} account=${player.accountName} room=${room ? room.id : '-'} roomPlayers=${room ? room.players.size : 0} totalSockets=${sockets.size}`);
      send(ws, { type: 'queue', count: room.players.size, roomId: room.id });
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
      player.config.weapon=player.weaponId;
      console.log(`[WS READY] ${player.id} room=${room.id} ready=${player.ready} roomPlayers=${room.players.size}`);
      broadcast(room, { type: 'room', roomId: room.id, players: roster(room), minPlayers: 2, maxPlayers: 8 });
      assignTeamsAndStart(room); return;
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
      broadcast(room, {
        type: 'shot',
        id: player.id,
        team: player.team,
        x: player.serverPos?.x ?? nums[0], y: player.serverPos?.y ?? nums[1], z: player.serverPos?.z ?? nums[2],
        dx: nums[3] / dirLen, dy: nums[4] / dirLen, dz: nums[5] / dirLen,
        weaponId, charge, mode
      }, player.id);
      serverResolveShot(room,player,Object.assign({},m,{weaponId,dx:nums[3],dy:nums[4],dz:nums[5],charge}));
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
      const now=Date.now();
      if(now-player.lastStateAt<28)return;
      const x=Number(m.x),y=Number(m.y),z=Number(m.z),yaw=Number(m.yaw);
      if(!saneWorldPosition(x,y,z)||!Number.isFinite(yaw)){securityStrike(player,'invalid-position');return;}

      if(player.serverHp==null)player.serverHp=100;
      if(player.serverAlive==null)player.serverAlive=true;

      if(player.serverAlive){
        if(player.serverPos){
          const dt=Math.max(.028,(now-player.lastStateAt)/1000);
          const d=Math.hypot(x-player.serverPos.x,z-player.serverPos.z);
          const maxStep=Math.min(2.15,.75+dt*34);
          if(d>maxStep){securityStrike(player,'server-speed='+d.toFixed(2)+' max='+maxStep.toFixed(2));return;}
        }
        player.serverPos={x,y,z};
        player.lastStatePos={x,z,y};
        player.lastStateAt=now;
      }

      if(room.started&&player.serverAlive&&player.team&&now-(player.lastHazardAt||0)>=350){
        player.lastHazardAt=now;
        const inkTeam=serverInkTeamAt(room,player.serverPos||player.spawn);
        if(inkTeam&&inkTeam!==player.team){
          const damage=Math.max(0,Math.min(4,Math.max(0,player.serverHp-1)));
          if(damage>0)serverApplyDamage(room,player,damage,null,'enemy-ink');
        }
      }

      const serverPos=player.serverPos||player.spawn;
      const enemyInk=room.started&&player.team&&serverInkTeamAt(room,serverPos)!=null&&serverInkTeamAt(room,serverPos)!==player.team;
      broadcast(room,{
        type:'state',id:player.id,name:player.accountName||player.id,team:player.team,
        x:serverPos.x,y:serverPos.y||0,z:serverPos.z,yaw,
        hp:Math.max(0,Math.min(100,player.serverHp||0)),
        ink:Math.max(0,Math.min(100,Number.isFinite(Number(m.ink))?Number(m.ink):100)),
        alive:!!player.serverAlive,squid:!!m.squid&&!enemyInk,moving:!!m.moving,weaponId:player.weaponId
      },player.id);
      return;
    }

    if (m.type === 'paint') {
      if(!room.started||!player.team)return;
      const x=Number(m.x),z=Number(m.z),radius=Number(m.radius);
      if(![x,z,radius].every(Number.isFinite)||radius<.2||radius>8||!serverPointInStage(x,z))return;
      const y=Number.isFinite(Number(m.y))?Number(m.y):0;
      const colorHex=Number.isFinite(Number(player.config?.inkColorHex))
        ? Number(player.config.inkColorHex):(player.team==='A'?0xe3ff00:0xff2255);
      markServerPaint(room,x,z,radius,player.team,y);
      const x2=Number(m.x2),z2=Number(m.z2);
      if(Number.isFinite(x2)&&Number.isFinite(z2)&&serverPointInStage(x2,z2))markServerPaint(room,x2,z2,radius,player.team,y);
      broadcast(room,{type:'paint',id:player.id,team:player.team,x,z,radius,colorHex,y,mult:1,
        ...(Number.isFinite(x2)&&Number.isFinite(z2)?{x2,z2}:{})},player.id);
      return;
    }

    if (m.type === 'matchResult') {
      console.log('[AUTH RESULT IGNORE] '+room.id+' '+player.id+' clientHint='+(m.winnerTeam||'-'));
      return;
    }
  ws.on('close', (code, reason) => {
    const beforeRoom = player.roomId || '-';
    const beforeAccount = player.accountName || '-';
    console.log(`[WS CLOSE] ${player.id} account=${beforeAccount} room=${beforeRoom} code=${code} reason=${String(reason || '')} activeSocketsBefore=${sockets.size}`);
    sockets.delete(ws);
    leaveRoom(player);
    console.log(`[WS CLOSE AFTER] ${player.id} rooms=${rooms.size} activeSockets=${sockets.size}`);
    broadcastGlobalOnlineCount();
  });
});
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