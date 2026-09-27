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
    timer: 180
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
  room.started = true; room.startsAt = Date.now() + 1500; room.timer = 180;
  console.log(`[MATCH START] ${room.id} players=${ps.map(p => p.id+'('+ (p.accountName||'-') +')').join(',')} totalSockets=${sockets.size}`);
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
    lastCalloutAt: 0, lastSpecialStartAt: 0, lastSpecialAt: 0
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
      broadcast(room, {
        type: 'shot',
        id: player.id,
        team: player.team,
        x: nums[0], y: nums[1], z: nums[2],
        dx: nums[3] / dirLen, dy: nums[4] / dirLen, dz: nums[5] / dirLen,
        weaponId
      }, player.id);
      return;
    }
    if (m.type === 'sub') {
      if (!room.started || !player.team) return;
      const nums = ['x','y','z','vx','vy','vz'].map(k => Number(m[k]));
      if (nums.some(v => !Number.isFinite(v))) return;
      const subType = String(m.subType || '');
      const allowed = ['timed','stick','instant','slide','bounce','seek','homing','sensor','turret'];
      if (!allowed.includes(subType)) return;
      const speed = Math.hypot(nums[3], nums[4], nums[5]);
      if (speed < 0.01 || speed > 40) return;
      const weaponId = Number.isFinite(Number(m.weaponId)) ? Math.max(0, Math.min(200, Math.floor(Number(m.weaponId)))) : player.weaponId;
      broadcast(room, {
        type: 'sub',
        id: player.id,
        team: player.team,
        x: nums[0], y: nums[1], z: nums[2],
        vx: nums[3], vy: nums[4], vz: nums[5],
        subType,
        weaponId
      }, player.id);
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
        'アサルトシェル','スワームビーコン','コロッサス','トリプルクラッシュ','スモークスクリーン'
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
      const now = Date.now();
      if (now - player.lastStateAt < 28) return;
      const x=Number(m.x), y=Number(m.y), z=Number(m.z), yaw=Number(m.yaw);
      if(!saneWorldPosition(x,y,z) || !Number.isFinite(yaw)){
        securityStrike(player,'invalid-position');
        return;
      }
      const alive=m.alive!==false;
      const hp=Number(m.hp), ink=Number(m.ink);
      if(!Number.isFinite(hp)||hp<0||hp>100||!Number.isFinite(ink)||ink<0||ink>100){
        securityStrike(player,'invalid-vitals');
        return;
      }
      if(player.roomId && player.team && player.startedWeaponId!==undefined){
        const requestedWeapon=Number.isFinite(Number(m.weaponId)) ? Math.floor(Number(m.weaponId)) : player.weaponId;
        if(requestedWeapon!==player.startedWeaponId){
          securityStrike(player,'loadout-change-during-match');
          return;
        }
      }
      if(player.lastStatePos && player.lastStateAlive && alive){
        const dt=Math.max(0.028,(now-player.lastStateAt)/1000);
        const d=Math.hypot(x-player.lastStatePos.x,z-player.lastStatePos.z);
        if(d>3.2){
          securityStrike(player,`teleport-distance=${d.toFixed(2)} dt=${dt.toFixed(3)}`);
          return;
        }
      }
      if(player.lastStatePos && !player.lastStateAlive && alive){
        // 復活した瞬間だけサーバー側の移動基準をリセット。
        player.lastStatePos={x,z,y};
      }else{
        player.lastStatePos={x,z,y};
      }
      player.lastStateAlive=alive;
      player.lastStateAt=now;
      player.weaponId = Number.isFinite(Number(m.weaponId)) ? Math.max(0,Math.min(200,Math.floor(Number(m.weaponId)))) : player.weaponId;
      broadcast(room, {
        type: 'state', id: player.id, name: player.accountName || player.id, team: player.team,
        x,y,z,yaw,
        hp: Math.max(0, Math.min(100,hp)),
        ink: Math.max(0, Math.min(100,ink)),
        alive, squid: !!m.squid, moving: !!m.moving, weaponId: player.weaponId
      }, player.id);
      return;
    }
    if (m.type === 'paint') {
      if (!room.started || !player.team) return;
      const x = Number(m.x), z = Number(m.z), radius = Number(m.radius); if (![x,z,radius].every(Number.isFinite) || radius < 0.2 || radius > 8) return;
      const colorHex = Number.isFinite(Number(player.config?.inkColorHex)) ? Number(player.config.inkColorHex) : (player.team === 'A' ? 0xe3ff00 : 0xff2255);
      broadcast(room, { type:'paint', id:player.id, team:player.team, x,z,radius,colorHex,mult:1 }, player.id); return;
    }
    if (m.type === 'matchResult' && !room.resultReported) {
      room.resultReported = true; const winnerTeam = ['A','B','DRAW'].includes(m.winnerTeam) ? m.winnerTeam : 'DRAW';
      const updated = [];
      for (const p of room.players.values()) { const pr = updateAccountResult(p, winnerTeam); if (pr) updated.push({ id:p.id, profile:pr }); }
      broadcast(room, { type:'matchEnd', winnerTeam, results:updated }); room.started=false;
      setTimeout(() => { if (rooms.get(room.id) === room) rooms.delete(room.id); }, 5000); return;
    }
  });
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
    if (remain <= 0 && !room.resultReported) { room.resultReported = true; broadcast(room, { type:'matchTimeout' }); }
  }
}, 500);
server.listen(PORT, '0.0.0.0', () => console.log(`Splatoon-like room server listening on ${PORT}`));