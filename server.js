const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const queue = [];
const rooms = new Map();
const sockets = new Map();
let nextPlayerNo = 1;

function send(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(list,obj,except=null){ for(const p of list) if(!except || p!==except) send(p.ws,obj); }
function roster(list){ return list.map(p=>({id:p.id,team:p.team||null,weaponId:p.weaponId,spawn:p.spawn,ready:!!p.ready})); }
function queueState(){
  return {type:"queue",count:queue.length,players:roster(queue),readyCount:queue.filter(p=>p.ready).length};
}
function broadcastQueue(){ broadcast(queue,queueState()); }
function removeFromQueue(p){ const i=queue.indexOf(p); if(i>=0) queue.splice(i,1); p.ready=false; }
function assignTeams(players){
  players.forEach((p,i)=>{
    p.team = i < Math.ceil(players.length/2) ? "A" : "B";
    const teamIndex = players.slice(0,i+1).filter(x=>x.team===p.team).length-1;
    p.spawn = p.team==='A'
      ? {x:(teamIndex-1.5)*3.2,y:0,z:-60}
      : {x:(teamIndex-1.5)*3.2,y:0,z:60};
  });
}
function startRoom(){
  if(queue.length<MIN_PLAYERS || queue.length>MAX_PLAYERS) return false;
  if(!queue.every(p=>p.ready)) return false;
  const picked=queue.splice(0,queue.length);
  // Keep everyone who was ready; no 8-player requirement.
  for(let i=picked.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[picked[i],picked[j]]=[picked[j],picked[i]];}
  assignTeams(picked);
  const roomId=`room_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const room={id:roomId,createdAt:Date.now(),startsAt:Date.now()+1200,timer:180,players:new Map()};
  for(const p of picked){p.roomId=roomId;p.ready=false;room.players.set(p.id,p);}
  rooms.set(roomId,room);
  for(const p of picked){
    send(p.ws,{type:"matchFound",roomId,selfId:p.id,team:p.team,spawn:p.spawn,startAt:room.startsAt,players:[...room.players.values()].map(x=>({id:x.id,team:x.team,weaponId:x.weaponId,spawn:x.spawn,ready:true}))});
  }
  return true;
}

const httpServer=http.createServer((req,res)=>{
  let reqPath=decodeURIComponent((req.url||"/").split("?")[0]);
  if(reqPath==="/") reqPath="/index.html";
  if(reqPath.includes('..')){res.writeHead(403);return res.end('Forbidden');}
  const file=path.join(ROOT,reqPath.replace(/^\/+/,""));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});return res.end("Not found");}
    const ext=path.extname(file).toLowerCase();
    const type=ext==='.html'?"text/html; charset=utf-8":ext==='.js'?"text/javascript; charset=utf-8":ext==='.css'?"text/css; charset=utf-8":ext==='.json'?"application/json; charset=utf-8":"application/octet-stream";
    res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});res.end(data);
  });
});

const wss=new WebSocketServer({server:httpServer});
wss.on('connection',ws=>{
  const player={id:`Player_${String(nextPlayerNo++).padStart(2,'0')}`,ws,roomId:null,team:null,weaponId:0,spawn:{x:0,y:0,z:0},ready:false,lastStateAt:0};
  sockets.set(ws,player);
  send(ws,{type:'hello',id:player.id,queueCount:queue.length});

  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw.toString());}catch{return;}

    if(msg.type==='joinQueue'){
      if(player.roomId) return;
      if(!queue.includes(player)){
        if(queue.length>=MAX_PLAYERS){send(ws,{type:'queueFull'});return;}
        queue.push(player);
      }
      player.ready=!!msg.ready;
      broadcastQueue();
      startRoom();
      if(queue.length) broadcastQueue();
      return;
    }

    if(msg.type==='ready'){
      if(!queue.includes(player)) return;
      player.ready=!!msg.ready;
      broadcastQueue();
      startRoom();
      if(queue.length) broadcastQueue();
      return;
    }

    if(msg.type==='leaveQueue'){
      removeFromQueue(player);broadcastQueue();return;
    }

    if(!player.roomId) return;
    const room=rooms.get(player.roomId);if(!room)return;

    if(msg.type==='state'){
      const now=Date.now();if(now-player.lastStateAt<28)return;player.lastStateAt=now;
      player.weaponId=Number.isFinite(msg.weaponId)?msg.weaponId:player.weaponId;
      for(const p of room.players.values()) p.lastKnownState=msg.id===p.id?msg:null;
      broadcast([...room.players.values()],{type:'state',id:player.id,team:player.team,x:Number(msg.x)||0,y:Number(msg.y)||0,z:Number(msg.z)||0,yaw:Number(msg.yaw)||0,hp:Math.max(0,Math.min(120,Number(msg.hp)||0)),ink:Math.max(0,Math.min(100,Number(msg.ink)||0)),alive:msg.alive!==false,squid:!!msg.squid,moving:!!msg.moving,weaponId:player.weaponId},player);
      return;
    }

    if(msg.type==='paint'){
      const x=Number(msg.x),z=Number(msg.z),radius=Number(msg.radius);
      if(![x,z,radius].every(Number.isFinite)||radius<0.2||radius>8)return;
      const colorHex=player.team==='A'?0xe3ff00:0xff2255;
      broadcast([...room.players.values()],{type:'paint',id:player.id,team:player.team,x,z,radius,colorHex,mult:1},player);
      return;
    }

    if(msg.type==='endMatch'){
      broadcast([...room.players.values()],{type:'matchEnd'});
      rooms.delete(room.id);
      for(const p of room.players.values()){p.roomId=null;p.team=null;}
    }
  });

  ws.on('close',()=>{
    removeFromQueue(player);
    if(player.roomId){
      const room=rooms.get(player.roomId);
      if(room){room.players.delete(player.id);broadcast([...room.players.values()],{type:'playerLeave',players:[...room.players.values()].map(x=>({id:x.id,team:x.team,weaponId:x.weaponId,spawn:x.spawn,ready:true}))});if(room.players.size===0)rooms.delete(room.id);}
    }
    sockets.delete(ws);
    broadcastQueue();
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const room of rooms.values()){
    const remain=Math.max(0,180-(now-room.startsAt)/1000);
    broadcast([...room.players.values()],{type:'serverTick',remaining:remain,started:now>=room.startsAt});
    if(remain<=0){broadcast([...room.players.values()],{type:'matchEnd'});rooms.delete(room.id);for(const p of room.players.values()){p.roomId=null;p.team=null;}}
  }
},500);

httpServer.listen(PORT,'0.0.0.0',()=>{console.log(`Splatoon-like server listening on port ${PORT}`);console.log(`Ready queue: ${MIN_PLAYERS}-${MAX_PLAYERS} players; everyone READY starts.`);});
