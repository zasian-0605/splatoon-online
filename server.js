const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(__dirname, "index.html");

const queue = [];
const rooms = new Map();
const sockets = new Map();
let nextPlayerNo = 1;

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcastRoom(room, obj, exceptId = null) {
  for (const p of room.players.values()) {
    if (p.id !== exceptId) send(p.ws, obj);
  }
}
function removeFromQueue(player) {
  const i = queue.indexOf(player);
  if (i >= 0) queue.splice(i, 1);
}
function roomRoster(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    team: p.team,
    weaponId: p.weaponId,
    spawn: p.spawn
  }));
}
function tryMakeRoom() {
  while (queue.length >= 8) {
    const picked = queue.splice(0, 8);
    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Fisher-Yates shuffle => automatic 4/4 team assignment.
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }

    const room = {
      id: roomId,
      createdAt: Date.now(),
      startsAt: Date.now() + 1200,
      timer: 180,
      players: new Map()
    };

    picked.forEach((p, i) => {
      p.roomId = roomId;
      p.team = i < 4 ? "A" : "B";
      const spawnIndex = i % 4;
      p.spawn = p.team === "A"
        ? { x: (spawnIndex - 1.5) * 3.2, y: 0, z: -37 }
        : { x: (spawnIndex - 1.5) * 3.2, y: 0, z: 37 };
      room.players.set(p.id, p);
    });
    rooms.set(roomId, room);

    for (const p of picked) {
      send(p.ws, {
        type: "matchFound",
        roomId,
        selfId: p.id,
        team: p.team,
        spawn: p.spawn,
        startAt: room.startsAt,
        players: roomRoster(room),
      });
    }
  }
}

const httpServer = http.createServer((req, res) => {
  let reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (reqPath === "/") reqPath = "/index.html";
  const file = path.join(__dirname, reqPath.replace(/^\/+/, ""));
  if (!file.startsWith(__dirname)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".js" ? "text/javascript; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const id = `Player_${String(nextPlayerNo++).padStart(2, "0")}`;
  const player = {
    id,
    ws,
    roomId: null,
    team: null,
    weaponId: 0,
    spawn: { x: 0, y: 0, z: 0 },
    lastStateAt: 0
  };
  sockets.set(ws, player);

  send(ws, { type: "hello", id, queueCount: queue.length });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "joinQueue") {
      removeFromQueue(player);
      if (player.roomId) return;
      queue.push(player);
      send(ws, { type: "queue", count: queue.length });
      for (const q of queue) {
        if (q !== player) send(q.ws, { type: "queue", count: queue.length });
      }
      tryMakeRoom();
      return;
    }

    if (msg.type === "leaveQueue") {
      removeFromQueue(player);
      send(ws, { type: "queue", count: queue.length });
      return;
    }

    if (!player.roomId) return;
    const room = rooms.get(player.roomId);
    if (!room) return;

    if (msg.type === "state") {
      // Rate limit client state to ~30 Hz per player.
      const now = Date.now();
      if (now - player.lastStateAt < 28) return;
      player.lastStateAt = now;
      player.weaponId = Number.isFinite(msg.weaponId) ? msg.weaponId : player.weaponId;
      broadcastRoom(room, {
        type: "state",
        id: player.id,
        team: player.team,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        z: Number(msg.z) || 0,
        yaw: Number(msg.yaw) || 0,
        hp: Math.max(0, Math.min(120, Number(msg.hp) || 0)),
        ink: Math.max(0, Math.min(100, Number(msg.ink) || 0)),
        alive: msg.alive !== false,
        squid: !!msg.squid,
        moving: !!msg.moving,
        weaponId: player.weaponId
      }, player.id);
      return;
    }

    if (msg.type === "paint") {
      const x = Number(msg.x), z = Number(msg.z), radius = Number(msg.radius);
      if (![x, z, radius].every(Number.isFinite)) return;
      if (radius < 0.2 || radius > 8) return;
      // Team/color are server-chosen; clients are not allowed to send a fake team.
      const colorHex = player.team === "A" ? 0xe3ff00 : 0xff2255;
      broadcastRoom(room, {
        type: "paint",
        id: player.id,
        team: player.team,
        x, z,
        radius,
        colorHex,
        mult: 1
      }, player.id);
      return;
    }

    if (msg.type === "serverToast") {
      const text = String(msg.text || "").slice(0, 80);
      broadcastRoom(room, { type: "serverToast", text }, player.id);
      return;
    }

    if (msg.type === "endMatch") {
      broadcastRoom(room, { type: "matchEnd" });
      rooms.delete(room.id);
      for (const p of room.players.values()) {
        p.roomId = null;
        p.team = null;
      }
    }
  });

  ws.on("close", () => {
    removeFromQueue(player);
    sockets.delete(ws);
    if (player.roomId) {
      const room = rooms.get(player.roomId);
      if (room) {
        room.players.delete(player.id);
        broadcastRoom(room, { type: "playerLeave", players: roomRoster(room) });
        if (room.players.size === 0) rooms.delete(room.id);
      }
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const remain = Math.max(0, 180 - (now - room.startsAt) / 1000);
    room.timer = remain;
    broadcastRoom(room, {
      type: "serverTick",
      remaining: remain,
      started: now >= room.startsAt
    });
    if (remain <= 0) {
      broadcastRoom(room, { type: "matchEnd" });
      rooms.delete(room.id);
    }
  }
}, 500);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Splatoon-like server listening on port ${PORT}`);
  console.log("Waiting for 8 players per match...");
});
