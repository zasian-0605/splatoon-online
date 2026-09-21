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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
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
function roster(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.accountName || p.id, team: p.team, ready: !!p.ready, weaponId: p.weaponId, spawn: p.spawn }));
}
function broadcast(room, obj, exceptId = null) {
  for (const p of room.players.values()) if (p.id !== exceptId) send(p.ws, obj);
}
function waitingRoomFor() {
  for (const room of rooms.values()) if (!room.started && room.players.size < 8) return room;
  const id = `ROOM-${String(nextRoomNo++).padStart(3, '0')}`;
  const room = { id, players: new Map(), started: false, resultReported: false, startsAt: 0, timer: 180 };
  rooms.set(id, room); return room;
}
function assignTeamsAndStart(room) {
  if (room.started || room.players.size < 2) return;
  const ps = [...room.players.values()];
  if (!ps.every(p => p.ready)) return;
  ps.forEach((p, i) => {
    p.team = i % 2 === 0 ? 'A' : 'B';
    const slot = Math.floor(i / 2);
    const x = ((slot % 4) - 1.5) * 3.2;
    p.spawn = p.team === 'A' ? { x, y: 0, z: -64 } : { x, y: 0, z: 64 };
  });
  room.started = true; room.startsAt = Date.now() + 1500; room.timer = 180;
  const r = roster(room);
  for (const p of ps) send(p.ws, { type: 'matchFound', roomId: room.id, selfId: p.id, team: p.team, spawn: p.spawn, startAt: room.startsAt, players: r });
}
function joinRoom(player) {
  if (player.roomId) return rooms.get(player.roomId);
  const room = waitingRoomFor();
  room.players.set(player.id, player); player.roomId = room.id; player.team = null; player.ready = false;
  const payload = { type: 'room', roomId: room.id, players: roster(room), minPlayers: 2, maxPlayers: 8 };
  broadcast(room, payload);
  send(player.ws, payload);
  return room;
}
function leaveRoom(player) {
  const room = player.roomId ? rooms.get(player.roomId) : null;
  if (!room) { player.roomId = null; return; }
  room.players.delete(player.id); player.roomId = null; player.team = null; player.ready = false;
  if (!room.started) { broadcast(room, { type: 'room', roomId: room.id, players: roster(room), minPlayers: 2, maxPlayers: 8 }); if (room.players.size === 0) rooms.delete(room.id); }
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
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const ext = path.extname(file).toLowerCase();
    const ct = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' }); res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  const id = `Player_${String(nextPlayerNo++).padStart(4, '0')}`;
  const player = { id, ws, roomId: null, team: null, ready: false, weaponId: 0, spawn: { x: 0, y: 0, z: 0 }, lastStateAt: 0, accountName: null, accountToken: null };
  sockets.set(ws, player);
  send(ws, { type: 'hello', id });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'bindAccount') {
      const s = sessions.get(String(m.token || ''));
      if (s && accounts[s.name]) { player.accountName = s.name; player.accountToken = String(m.token); send(ws, { type: 'accountBound', profile: profile(accounts[s.name]) }); }
      else send(ws, { type: 'accountBound', error: 'ログイン情報が無効です。' });
      return;
    }
    if (m.type === 'joinQueue') { if (!player.accountName) { send(ws, { type: 'queueError', error: '先にログインしてください。' }); return; } const room = joinRoom(player); send(ws, { type: 'queue', count: room.players.size, roomId: room.id }); return; }
    if (m.type === 'ready') {
      const room = player.roomId ? rooms.get(player.roomId) : null; if (!room || room.started) return;
      player.ready = !!m.ready; player.weaponId = Number.isFinite(m.weaponId) ? m.weaponId : player.weaponId;
      broadcast(room, { type: 'room', roomId: room.id, players: roster(room), minPlayers: 2, maxPlayers: 8 });
      assignTeamsAndStart(room); return;
    }
    if (m.type === 'leaveQueue') { leaveRoom(player); return; }
    const room = player.roomId ? rooms.get(player.roomId) : null; if (!room) return;
    if (m.type === 'state') {
      const now = Date.now(); if (now - player.lastStateAt < 28) return; player.lastStateAt = now;
      player.weaponId = Number.isFinite(m.weaponId) ? m.weaponId : player.weaponId;
      broadcast(room, { type: 'state', id: player.id, name: player.accountName || player.id, team: player.team, x: Number(m.x) || 0, y: Number(m.y) || 0, z: Number(m.z) || 0, yaw: Number(m.yaw) || 0, hp: Math.max(0, Math.min(120, Number(m.hp) || 0)), ink: Math.max(0, Math.min(100, Number(m.ink) || 0)), alive: m.alive !== false, squid: !!m.squid, moving: !!m.moving, weaponId: player.weaponId }, player.id);
      return;
    }
    if (m.type === 'paint') {
      const x = Number(m.x), z = Number(m.z), radius = Number(m.radius); if (![x,z,radius].every(Number.isFinite) || radius < 0.2 || radius > 8) return;
      const colorHex = player.team === 'A' ? 0xe3ff00 : 0xff2255;
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
  ws.on('close', () => { sockets.delete(ws); leaveRoom(player); });
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
