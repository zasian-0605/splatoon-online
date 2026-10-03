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
function buildRanking(limit=50, session=null) {
  const list=Object.values(accounts)
    .filter(a=>a && typeof a.name==='string')
    .map(a=>({
      name:a.name,
      rating:Number.isFinite(Number(a.rating))?Number(a.rating):750,
      rank:rankFromRating(Number.isFinite(Number(a.rating))?Number(a.rating):750),
      wins:Number.isFinite(Number(a.wins))?Number(a.wins):0,
      losses:Number.isFinite(Number(a.losses))?Number(a.losses):0,
      games:Number.isFinite(Number(a.games))?Number(a.games):0
    }))
    .sort((a,b)=>
      b.rating-a.rating ||
      b.wins-a.wins ||
      b.games-a.games ||
      a.name.localeCompare(b.name,'ja')
    );
  const total=list.length;
  let myRank=null;
  let myProfile=null;
  if(session?.name){
    const index=list.findIndex(x=>x.name===session.name);
    if(index>=0){
      myRank=index+1;
      myProfile=list[index];
    }
  }
  return {entries:list.slice(0,Math.max(1,Math.min(100,Number(limit)||50))),total,myRank,myProfile};
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

/* V116: compact server-side mirror of the important solid stage pieces.
   The client uses the same AABB-style collision model. These blocks are used
   only for projectile occlusion and movement sanity checks. */
const SERVER_STAGE_BLOCKS=[];
function addServerBlock(x,y,z,w,h,d,climbable=true){
  SERVER_STAGE_BLOCKS.push({
    minX:x-w/2,maxX:x+w/2,minY:y,maxY:y+h,
    minZ:z-d/2,maxZ:z+d/2,climbable
  });
}
function addServerXZ(x,z,w,d,h,y=0,climbable=true){
  addServerBlock(x,y,z,w,h,d,climbable);
}

/* Ground is the same unified STAGE_SOLID footprint as the client. */
addServerXZ(0,0,104,152,.08,-.04,false);

/* Low raised terrain. */
[
  [-12,-37,12,7,.85,.40],[12,-37,12,7,.85,.40],
  [-12,37,12,7,.85,.40],[12,37,12,7,.85,.40]
].forEach(v=>addServerXZ(...v));

/* Outer shelves. */
[
  [-40,-38,5,20,3],[-39,-9,5,15,3],[-40,22,5,18,3],
  [40,-39,5,20,3],[40,-11,5,13,3],[39,17,5,17,3],
  [-24,-50,20,4,2.8],[2,-50,16,4,2.8],[25,-43,13,4,2.8],
  [-28,47,17,4,2.8],[-4,51,16,4,2.8],[22,46,18,4,2.8]
].forEach(v=>addServerXZ(...v));

/* Left/right routes. */
[
  [-31,-33,12,3,2.2],[-34,-20,10,3,2.2],[-31,-7,12,3,2.2],
  [-30,7,12,3,2.2],[-29,21,11,3,2.2],[-27,34,12,3,2.2],
  [31,-35,11,3,2.2],[34,-22,9,3,2.2],[32,-9,11,3,2.2],
  [31,5,10,3,2.2],[30,19,11,3,2.2],[27,33,13,3,2.2],
  [-37,-31,3,13,3],[-37,-5,3,10,3],[-37,12,3,12,3],[-36,31,3,12,3],
  [37,-32,3,15,3],[37,-6,3,12,3],[37,12,3,10,3],[36,30,3,12,3]
].forEach(v=>addServerXZ(...v));

/* Central structures. */
[
  [0,0,30,26,2.2,2.5],[-19,-1,8,16,1.4,1.0],[19,1,8,16,1.4,1.0],
  [-10,0,3,13,2.0],[10,0,3,13,2.0],[0,-9,11,3,1.8],[0,9,11,3,1.8],
  [-23,-11,5,8,3],[ -23,11,5,8,3],[23,-11,5,8,3],[23,11,5,8,3],
  [-14,-20,10,3,2.1],[14,-20,10,3,2.1],[-14,20,10,3,2.1],[14,20,10,3,2.1]
].forEach(v=>addServerXZ(...v));

/* Upper backline platforms. */
[
  [-18,30,18,12,2.6,2.2],[18,30,18,12,2.6,2.2],[0,44,14,9,3.0,4.5],
  [-27,30,2,8,5.2],[27,30,2,8,5.2],[0,38,3,5,6.2],
  [34,38,7,3,2.5],[29,42,5,3,2.5]
].forEach(v=>addServerXZ(...v));

/* Shelf-like columns. */
[
  [-30,-25,2,2,3.8],[-15,-25,2,2,3.8],[15,-25,2,2,3.8],[30,-25,2,2,3.8],
  [-30,25,2,2,3.8],[-15,25,2,2,3.8],[15,25,2,2,3.8],[30,25,2,2,3.8]
].forEach(v=>addServerXZ(...v));

/* Break gate. */
addServerXZ(0,14,9,1.2,3.2);

function serverSegmentAabbHit(a,b,block){
  const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z};
  let t0=0,t1=1;
  for(const k of ['x','y','z']){
    const min=block['min'+k.toUpperCase()],max=block['max'+k.toUpperCase()];
    const av=a[k],dv=d[k];
    if(Math.abs(dv)<1e-9){
      if(av<min||av>max)return null;
      continue;
    }
    let q0=(min-av)/dv,q1=(max-av)/dv;
    if(q0>q1){const q=q0;q0=q1;q1=q;}
    t0=Math.max(t0,q0);t1=Math.min(t1,q1);
    if(t0>t1)return null;
  }
  return t0>=0&&t0<=1?t0:null;
}
function serverStageOcclusion(a,b){
  let best=null,bestT=Infinity;
  for(const block of SERVER_STAGE_BLOCKS){
    const t=serverSegmentAabbHit(a,b,block);
    if(t!==null&&t<bestT){
      bestT=t;
      best={block,t,point:{
        x:a.x+(b.x-a.x)*t,
        y:a.y+(b.y-a.y)*t,
        z:a.z+(b.z-a.z)*t
      }};
    }
  }
  return best;
}
function serverPositionBlocked(x,y,z){
  for(const block of SERVER_STAGE_BLOCKS){
    if(x<block.minX-.35||x>block.maxX+.35||z<block.minZ-.35||z>block.maxZ+.35)continue;
    /* Standing on the top face is valid; being inside the volume is not. */
    if(y>=block.maxY-.28)continue;
    if(y+0.85>block.minY && y-0.65<block.maxY)return true;
  }
  return false;
}
function serverResolveHorizontalMove(oldPos,newPos){
  if(!oldPos)return newPos;
  if(!serverPositionBlocked(newPos.x,newPos.y,newPos.z))return newPos;
  let lo=0,hi=1;
  for(let i=0;i<8;i++){
    const t=(lo+hi)/2;
    const p={
      x:oldPos.x+(newPos.x-oldPos.x)*t,
      y:newPos.y,
      z:oldPos.z+(newPos.z-oldPos.z)*t
    };
    if(serverPositionBlocked(p.x,p.y,p.z))hi=t;else lo=t;
  }
  return {
    x:oldPos.x+(newPos.x-oldPos.x)*lo,
    y:newPos.y,
    z:oldPos.z+(newPos.z-oldPos.z)*lo
  };
}
/* Canonical online main-weapon projectile values.
   These must match combat-runtime.js so the authoritative hit/paint simulation
   and the remote visual projectile use the same numbers. */
const SERVER_WEAPONS={
  0:{cat:'shooter',damage:32,rate:95,range:30,speed:37,gravity:5.2,straightDistance:7.5,
     radius:.14,paintRadius:1.15,life:1.55,trajectory:'delayed'},
  1:{cat:'slosher',damage:70,rate:500,range:16,speed:17,gravity:10.5,verticalSpeed:7.5,
     radius:.28,paintRadius:1.75,life:1.35,trajectory:'arc',explosion:2.4},
  2:{cat:'maneuver',damage:28,rate:55,range:30,speed:38,gravity:4.8,straightDistance:7.5,
     radius:.14,paintRadius:.72,life:1.0,trajectory:'delayed',spread:.055,count:2}
};

function serverProjectileSpec(w,m={}){
  if(!w)return null;
  const out={
    kind:w.cat==='maneuver'?'dualies':w.cat,
    trajectory:w.trajectory||'delayed',
    speed:Number(w.speed)||35,
    maxRange:Number(w.range)||30,
    straightDistance:Number(w.straightDistance)||0,
    gravity:Number(w.gravity)||0,
    verticalSpeed:Number(w.verticalSpeed)||0,
    radius:Number(w.radius)||.14,
    paintRadius:Number(w.paintRadius)||.9,
    life:Number(w.life)||1.5,
    damage:Number(w.damage)||0,
    count:Math.max(1,Math.min(8,Math.floor(Number(w.count)||1))),
    spread:Number(w.spread)||0,
    explosive:w.cat==='slosher',
    explosionRadius:Number(w.explosion)||0,
    splashDamage:w.cat==='slosher'?Number(w.damage)||0:0
  };
  if(w.cat==='charger'){
    const q=Math.max(0,Math.min(1,Number(m.charge)||0));
    out.speed=Number(w.speedShot||w.speed)||85;
    out.damage=Number(w.tap||0)+(Number(w.full||0)-Number(w.tap||0))*q;
  }
  return out;
}
const SERVER_SUBS={
  instant:{delay:0,radius:2.1,damage:60},timed:{delay:1100,radius:3.4,damage:180},stick:{delay:1500,radius:4.0,damage:180},
  bounce:{delay:1800,radius:1.8,damage:50},seek:{delay:1800,radius:3.6,damage:180},slide:{delay:1400,radius:2.8,damage:180},
  homing:{delay:1800,radius:2.8,damage:60},splatBomb:{delay:1000,radius:3.2,damage:180},suctionBomb:{delay:2000,radius:4.0,damage:180},
  burstBomb:{delay:0,radius:2.0,damage:60},curlingBomb:{delay:2700,radius:2.7,damage:180},fizzyBomb:{delay:1600,radius:2.8,damage:50},
  autobomb:{delay:2500,radius:2.6,damage:150},torpedo:{delay:1800,radius:2.8,damage:120},angleShooter:{delay:0,radius:1.2,damage:40},
  toxicMist:{delay:0,radius:3.2,damage:8},inkMine:{delay:0,radius:2.8,damage:45},pointSensor:{delay:0,radius:3.0,damage:0},
  squidBeacon:{delay:0,radius:1.4,damage:0},splashWall:{delay:0,radius:2.0,damage:30},sprinkler:{delay:0,radius:2.0,damage:20},sensor:{delay:0,radius:0,damage:0},turret:{delay:0,radius:2.5,damage:50}
};
const SERVER_SUB_BY_WEAPON={
  0:'splatBomb',
  1:'fizzyBomb',
  2:'splatBomb'
};
const SERVER_SPECIALS={
  'ドームシールド':[0,5.0],'グラップラー':[0,4.0],'ヴァキュームコア':[75,3.0],
  'ブーストステーション':[0,5.0],'スカイパック':[80,3.0],'ジェットパック':[80,3.0],
  'グレートバリア':[0,6.0],'エナジースタンド':[0,5.0],'トリプルトルネード':[120,3.2],
  'トリガーキャノン':[220,2.8],'センチネルミサイル':[150,3.0],'ペイントクラウド':[24,4.5],'ギガスタンプ':[160,3.6],
  'オムニレーザー':[120,2.0],'チャージオーブ':[180,4.0],'パルスノード':[55,3.0],'ラッシュカート':[140,3.4],'トライアークトルネード':[120,3.2],
  'アサルトシェル':[140,3.5],'スワームビーコン':[70,3.0],'コロッサス':[150,3.6],'トリプルクラッシュ':[140,3.0],
  'スモークスクリーン':[20,3.8],'ウルトラショット':[120,2.8],'ナイスダマ':[140,4.0],'カニタンク':[110,3.2],
  'キューインキ':[75,3.0],'アメフラシ':[14,3.8],'ホップソナー':[70,3.2],'サメライド':[150,3.8],
  'ウルトラハンコ':[160,3.8],'テイオウイカ':[160,3.8],'メガホンレーザー5.1ch':[110,2.4],'マルチミサイル':[90,3.0],
  'デコイチラシ':[70,2.4],'スミナガシート':[20,3.5],'ウルトラチャクチ':[160,4.0],'ショクワンダー':[80,3.0]
};
const SERVER_WEAPON_INK_COST=[
  0.95,4.4,0.75
];
const SERVER_SPECIAL_BY_WEAPON={
  0:'ウルトラショット',
  1:'ナイスダマ',
  2:'カニタンク'
};
function serverPointInStage(x,z){
  x=Number(x);z=Number(z);
  /* Keep server gameplay geometry aligned with the client's canonical
     rectangular STAGE_SOLID floor. The AA polygon is an obstacle-reference
     shape only and must not reject valid spawn/turf coordinates. */
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
function seedServerSpawnInk(room,players){
  if(!room?.inkCells)return;
  const ps=Array.isArray(players)?players:[...room.players.values()];
  for(const p of ps){
    const sp=p?.spawn;if(!sp||!p.team)continue;
    const sx=Number(sp.x),sz=Number(sp.z);
    if(!Number.isFinite(sx)||!Number.isFinite(sz))continue;
    /* Compact friendly refill pad centered on the actual server spawn. */
    const pts=[
      [0,0],[3.2,0],[-3.2,0],[0,3.2],[0,-3.2],
      [3.2,3.2],[-3.2,3.2],[3.2,-3.2],[-3.2,-3.2]
    ];
    for(const [ox,oz] of pts){
      const x=sx+ox,z=sz+oz;
      if(serverPointInStage(x,z))markServerPaint(room,x,z,2.7,p.team,0);
    }
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
  /* V117: authoritative trajectory now mirrors the client projectile runtime.
     - charger: flies on the aimed line to max range
     - blaster: gravity-free straight flight
     - other ranged weapons: short straight phase, then gravity
     - no hidden extra pitch is injected server-side
  */
  const range=Math.max(1,Number(w.range)||35);
  let bestTarget=null,bestTargetOrder=Infinity,bestWall=null,bestWallOrder=Infinity;

  const considerSegment=(a,b,orderBase)=>{
    for(const target of room.players.values()){
      if(!target.serverAlive||target.team===null||target.team===w._attackerTeam)continue;
      const p=target.serverPos||target.spawn;
      const hit=serverDistanceToSegment(
        p.x,p.y+.9,p.z,a.x,a.y,a.z,b.x,b.y,b.z
      );
      /*
       * V120: use a real player-sized hit volume instead of requiring the
       * projectile center to pass through a thin 3D line. The client aim can
       * differ slightly because the camera/launch pitch is applied locally.
       * Keep wall ordering authoritative so this never turns into shooting
       * through a wall.
       */
      /* Online opponent hit volume is intentionally a little larger than
         the local visual body to make centered shots reliably register. */
      const playerRadius=Math.max(2.2,Number(hitRadius)||2.2);
      const playerHalfHeight=2.25;
      const targetCenterY=Number(p.y)||0;
      const verticalDistance=Math.abs((hit.y||0)-(targetCenterY+.9));

      /*
       * Also evaluate the X/Z ray independently. This prevents a small camera
       * pitch difference from turning a visually centered shot into a miss.
       */
      const abx=b.x-a.x, abz=b.z-a.z;
      const apx=p.x-a.x, apz=p.z-a.z;
      const hDen=abx*abx+abz*abz;
      const ht=hDen>1e-9
        ? Math.max(0,Math.min(1,(apx*abx+apz*abz)/hDen))
        : 0;
      const hqx=a.x+abx*ht, hqz=a.z+abz*ht;
      const horizontalDistance=Math.hypot(p.x-hqx,p.z-hqz);
      const horizontalBodyHit=horizontalDistance<=playerRadius &&
        verticalDistance<=playerHalfHeight;

      const bodyHit=hit.distance<playerRadius ||
        (verticalDistance<=playerHalfHeight && hit.distance<=playerRadius+.55) ||
        horizontalBodyHit;
      if(bodyHit){
        const order=orderBase+Math.min(hit.t,ht);
        if(order<bestTargetOrder){
          bestTarget={target,hit:Object.assign({},hit,{t:Math.min(hit.t,ht)}),order};
        }
      }
    }
    const wall=serverStageOcclusion(a,b);
    if(wall){
      const order=orderBase+wall.t;
      if(order<bestWallOrder)bestWall={wall,order};
    }
  };

  if(w.cat==='charger'){
    const end={
      x:origin.x+dir.x*range,
      y:origin.y+dir.y*range,
      z:origin.z+dir.z*range
    };
    considerSegment(origin,end,0);
    const targetWins=bestTarget&&bestTargetOrder<bestWallOrder;
    return {
      hit:targetWins?bestTarget:null,
      wall:bestWall&&(!bestTarget||bestWallOrder<bestTargetOrder)?bestWall:null,
      straightEnd:bestWall&&bestWallOrder<1?bestWall.wall.point:end,
      dropEnd:end
    };
  }

  if(w.cat==='blaster'){
    const end={
      x:origin.x+dir.x*range,
      y:origin.y+dir.y*range,
      z:origin.z+dir.z*range
    };
    considerSegment(origin,end,0);
    const targetWins=bestTarget&&bestTargetOrder<bestWallOrder;
    return {
      hit:targetWins?bestTarget:null,
      wall:bestWall&&(!bestTarget||bestWallOrder<bestTargetOrder)?bestWall:null,
      straightEnd:bestWall&&bestWallOrder<1?bestWall.wall.point:end,
      dropEnd:end
    };
  }

  const speed=Math.max(1,Number(w.speed)||35);
  const gravity=Number(w.gravity)||(
    w.cat==='slosher' ? 10.5 :
    ((w.cat==='brella'||w.cat==='maneuver'||w.cat==='dualies') ? 4.8 : 5.2)
  );

  /* Slosher is a real arc from the muzzle: no initial straight phase. */
  if(w.cat==='slosher'){
    const launchY=Number(w.verticalSpeed)||7.5;
    const horizontal=Math.max(.001,Math.hypot(dir.x,dir.z));
    const totalTime=range/Math.max(1,speed*horizontal);
    const steps=Math.max(16,Math.min(80,Math.ceil(totalTime*60)));
    let prev=origin;
    let lastVisible=origin;
    for(let j=1;j<=steps;j++){
      const t=totalTime*j/steps;
      const cur={
        x:origin.x+dir.x*speed*t,
        y:origin.y+launchY*t-.5*gravity*t*t,
        z:origin.z+dir.z*speed*t
      };
      considerSegment(prev,cur,j/steps);
      if(bestWallOrder<=j/steps)break;
      lastVisible=cur;
      prev=cur;
    }
    const targetWins=bestTarget&&bestTargetOrder<bestWallOrder;
    return {
      hit:targetWins?bestTarget:null,
      wall:bestWall&&(!bestTarget||bestWallOrder<bestTargetOrder)?bestWall:null,
      straightEnd:origin,
      dropEnd:lastVisible
    };
  }

  const straightDist=Math.min(
    Number.isFinite(Number(w.straightDistance))
      ? Math.max(0,Number(w.straightDistance))
      : Math.min(7.5,range*.28),
    range
  );
  const straight={
    x:origin.x+dir.x*straightDist,
    y:origin.y+dir.y*straightDist,
    z:origin.z+dir.z*straightDist
  };
  considerSegment(origin,straight,0);

  const remain=Math.max(0,range-straightDist);
  const launchY=dir.y*speed;
  const horizontal=Math.max(.001,Math.hypot(dir.x,dir.z));
  const totalTime=remain/Math.max(1,speed*horizontal);
  const steps=Math.max(16,Math.min(64,Math.ceil(totalTime*50)));
  let prev=straight;
  let lastVisible=straight;
  let orderBase=straightDist/Math.max(range,.001);

  for(let j=1;j<=steps;j++){
    const t=totalTime*j/steps;
    const cur={
      x:straight.x+dir.x*speed*t,
      y:straight.y+launchY*t-.5*gravity*t*t,
      z:straight.z+dir.z*speed*t
    };
    considerSegment(prev,cur,orderBase+(j/steps)*(1-orderBase));
    if(bestWallOrder<=orderBase+(j/steps)*(1-orderBase))break;
    lastVisible=cur;
    prev=cur;
  }

  const targetWins=bestTarget&&bestTargetOrder<bestWallOrder;
  return {
    hit:targetWins?bestTarget:null,
    wall:bestWall&&(!bestTarget||bestWallOrder<bestTargetOrder)?bestWall:null,
    straightEnd:straight,
    dropEnd:lastVisible
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
    target.lastStateAt=Date.now();
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
  const cy=Number(center?.y)||0,rr=Math.max(.1,Number(radius)||0);
  for(const target of room.players.values()){
    if(!target.serverAlive||target.team===team)continue;
    const pos=target.serverPos||target.spawn;
    const flat=Math.hypot((pos.x||0)-(center.x||0),(pos.z||0)-(center.z||0));
    const vertical=Math.abs((Number(pos.y)||0)-cy);
    if(flat<=rr && vertical<=Math.max(2.25,rr*1.25)){
      const dist=Math.hypot(flat,vertical);
      const scaled=damage*(1-Math.min(.65,dist/Math.max(.01,rr))*.5);
      serverApplyDamage(room,target,scaled,attacker,reason||'aoe');
    }
  }
}
function serverRejectShot(player,reason){
  try{if(player)player.__shotRejectReason=String(reason||'rejected').slice(0,80);}catch(_){}
  return false;
}
function serverShotInkCost(w,m){
  const wid=Number(m?.weaponId);
  if(Number.isInteger(wid)&&SERVER_WEAPON_INK_COST[wid]!=null){
    const base=SERVER_WEAPON_INK_COST[wid];
    if(w?.cat==='charger'){
      const frac=Math.max(0,Math.min(1,Number(m?.charge)||0));
      return base*(.55+.90*frac);
    }
    if(w?.cat==='spinner'){
      const burst=Math.max(1,Math.min(32,Math.floor(Number(m?.burstShots)||1)));
      return base*burst;
    }
    if(w?.cat==='wiper'){
      const frac=Math.max(0,Math.min(1,Number(m?.charge)||0));
      return base*(.65+.55*frac);
    }
    if(w?.cat==='roller'&&String(m?.mode||'')==='rollerFlick')return 6;
    if(w?.cat==='roller'&&String(m?.mode||'')==='brushFlick')return 2;
    return base;
  }
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
const SERVER_SUB_INK_COST={
  instant:45,timed:70,stick:70,bounce:60,seek:55,slide:65,homing:65,
  splatBomb:45,suctionBomb:50,burstBomb:35,curlingBomb:55,fizzyBomb:50,autobomb:45,
  inkMine:40,pointSensor:40,squidBeacon:75,splashWall:60,sprinkler:60,torpedo:45,
  angleShooter:40,toxicMist:45,sensor:45,turret:65
};
const SERVER_OUTFIT_INK_SAVER=[
  1,1,.92,.84,1,1,1,1,1,.92,.92,.84,.84,1,1,1,.92,1,1,1,
  .84,.84,1.08,1.08,1,1,1,1,1,1,1,.84,.84,1,1,.92,1,.92,1,1,
  1,1,1,1,1,1.08,1,1.08,1,1.08
];
const SERVER_OUTFIT_INK_REGEN=[
  1,1,1.04,1.12,1,1,1,1,1,1.04,1.04,1.12,1.12,1,1,1,1.04,1,1,1,
  1.12,1.12,1,1,1,1,1,1,1,1,1,1.12,1.12,1,1,1.04,1,1.04,1,1,
  1,1,1,1,1,1,1,1,1,1
];
function serverInkSaver(player){
  const config=player?.config||{};
  const outfit=Math.max(0,Math.min(49,Math.floor(Number(config.outfit)||0)));
  const gear=Math.max(0,Math.min(3,Math.floor(Number(config.gear)||0)));
  return (SERVER_OUTFIT_INK_SAVER[outfit]||1)*(gear===2?.88:1);
}
function serverInkRegenRate(player){
  const config=player?.config||{};
  const outfit=Math.max(0,Math.min(49,Math.floor(Number(config.outfit)||0)));
  const gear=Math.max(0,Math.min(3,Math.floor(Number(config.gear)||0)));
  return 29*(SERVER_OUTFIT_INK_REGEN[outfit]||1)*(gear===2?1.16:1);
}
function serverSubInkCost(type){
  return SERVER_SUB_INK_COST[String(type||'')]??55;
}
function serverTrySpendInk(player,cost){
  const c=Math.max(0,Number(cost)||0)*serverInkSaver(player);
  if(c<=0)return true;
  if((player.serverInk??100)<c)return false;
  player.serverInk=Math.max(0,player.serverInk-c);
  player.serverInkUseAt=Date.now();
  return true;
}
function serverBeginPaintTrace(player){
  const p=player.serverPos||player.spawn||{x:0,y:0,z:0};
  player.paintAnchors=[{x:Number(p.x)||0,z:Number(p.z)||0,at:Date.now()}];
  player.paintTraceUntil=Date.now()+2200;
}
function serverAcceptPaintTrace(player,x,z,x2,z2){
  const now=Date.now();
  const anchors=Array.isArray(player.paintAnchors)?player.paintAnchors:[];
  const candidates=[{x,z},{x:Number(x2),z:Number(z2)}].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z));
  const near=anchors.some(a=>candidates.some(p=>Math.hypot(p.x-a.x,p.z-a.z)<=3.6));
  if(near || (player.serverPos&&Math.hypot(x-player.serverPos.x,z-player.serverPos.z)<=3.6)){
    const end=Number.isFinite(Number(x2))&&Number.isFinite(Number(z2))
      ? {x:Number(x2),z:Number(z2),at:now}
      : {x:Number(x),z:Number(z),at:now};
    player.paintAnchors=[end,...anchors.filter(a=>now-a.at<2200)].slice(0,12);
    player.paintTraceUntil=Math.max(player.paintTraceUntil||0,now+2200);
    return true;
  }
  return now>=(player.paintTraceUntil||0)?false:true;
}
function serverResolveShot(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return serverRejectShot(player,'room-not-started-or-dead');
  const wid=player.weaponId;
  const w=SERVER_WEAPONS[wid];if(!w)return serverRejectShot(player,'weapon-not-allowed');
  const now=Date.now();
  if(now-(player.lastShotAt||0)<Math.max(35,w.rate*.72))return serverRejectShot(player,'cooldown');
  const dx=Number(m.dx),dy=Number(m.dy),dz=Number(m.dz),len=Math.hypot(dx,dy,dz);
  if(!Number.isFinite(len)||len<.001||len>2)return serverRejectShot(player,'bad-direction');
  const shotCost=serverShotInkCost(w,m);
  if(!serverTrySpendInk(player,shotCost)){
    send(player.ws,{type:'serverInk',ink:Math.max(0,player.serverInk??0)});
    return serverRejectShot(player,'ink');
  }
  player.lastShotAt=now;
  serverBeginPaintTrace(player);
  const dir={x:dx/len,y:dy/len,z:dz/len};
  const muzzleForward=.55;
  const origin={
    x:(player.serverPos?.x||0)+dir.x*muzzleForward,
    y:(player.serverPos?.y||0)+1.2,
    z:(player.serverPos?.z||0)+dir.z*muzzleForward
  };
  const range=w.range||35;
  const rawMode=String(m.mode||'');
  let mode='';
  if(w.cat==='roller'&&(rawMode==='roller-flick'||rawMode==='rollerFlick'||rawMode==='roller-roll'||rawMode==='brushFlick'))mode=rawMode==='rollerFlick'?'roller-flick':rawMode==='brushFlick'?'brush-flick':rawMode;
  else if(w.cat==='wiper'&&rawMode==='wiperSlash')mode='wiper';
  const hitRadius=(mode==='roller-flick'||mode==='brush-flick'||mode==='brush')?2.55:(mode==='roller-roll'?1.85:(mode==='wiper'?2.0:1.55));
  // Helper needs the firing team's identity so friendly players are never hit.
  w._attackerTeam=player.team;
  const trajectoryWeapon=mode==='roller-flick'
    ? Object.assign({},w,{cat:'shooter',range:w.flickRange||14,speed:18,gravity:15})
    : w;
  trajectoryWeapon._attackerTeam=player.team;
  const trajectory=serverFindTrajectoryHit(room,origin,dir,trajectoryWeapon,hitRadius);
  const nearest=trajectory.hit;

  /* V121: keep server turf authoritative, but do not paint the entire
     shot trajectory here.  The old origin -> endpoint fill looked like a
     half-finished bomb path on the opponent's side.  The client projectile
     handles the visible flight/trail; the server records only its resolved
     impact/drop point as the gameplay fallback. */
  try{
    const paintEnd=nearest
      ? nearest.hit
      : trajectory.wall
        ? trajectory.wall.wall.point
        : (trajectory.dropEnd||trajectory.straightEnd||origin);
    const paintRadius=Math.max(
      .30,
      Math.min(2.40,Number(w.paintRadius)||.9)
    );
    const paintY=Number(player.serverPos?.y)||0;
    markServerPaint(
      room,Number(paintEnd.x),Number(paintEnd.z),paintRadius,player.team,paintY
    );
  }catch(_){}

  if(w.cat==='blaster'){
    const end=trajectory.straightEnd;
    const center=nearest
      ? {x:nearest.hit.x,y:nearest.hit.y,z:nearest.hit.z}
      : trajectory.wall
        ? {x:trajectory.wall.wall.point.x,y:trajectory.wall.wall.point.y,z:trajectory.wall.wall.point.z}
        : {x:end.x,y:Math.max(0,end.y),z:end.z};
    serverApplyAoE(room,center,w.explosion||2.4,w.splash||w.damage||0,player.team,player,'blaster');
    return true;
  }
  if(w.cat==='slosher'){
    const center=nearest
      ? {x:nearest.hit.x,y:nearest.hit.y,z:nearest.hit.z}
      : trajectory.wall
        ? {x:trajectory.wall.wall.point.x,y:trajectory.wall.wall.point.y,z:trajectory.wall.wall.point.z}
        : {x:origin.x+dir.x*Math.min(range,16),y:origin.y+dir.y*Math.min(range,16),z:origin.z+dir.z*Math.min(range,16)};
    serverApplyAoE(room,center,w.explosion||2.4,w.damage||0,player.team,player,'slosher');
    return true;
  }
  if(w.cat==='charger'){
    const frac=Math.max(0,Math.min(1,Number(m.charge)||0));
    if(nearest)serverApplyDamage(room,nearest.target,w.tap+(w.full-w.tap)*frac,player,'charger');
    return true;
  }
  if(w.cat==='spinner'){
    const wid=Number(player.weaponId);
    const defs={
      31:{min:6,max:12},
      32:{min:10,max:24},
      33:{min:10,max:32}
    };
    const def=defs[wid]||{min:1,max:32};
    const frac=Math.max(0,Math.min(1,Number(m.charge)||0));
    const requested=Math.floor(Number(m.burstShots)||1);
    /* V116 sends splatling shots one projectile at a time. A full burst is
       represented by repeated authoritative shot messages, so one accepted
       message must never silently become the old minimum-six-shot burst. */
    const count=Math.max(1,Math.min(def.max,requested));
    if(nearest)serverApplyDamage(room,nearest.target,(w.damage||0)*count,player,'spinner-shot');
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
    else if(mode==='roller-flick')dmg=w.flickDamage||dmg;
    serverApplyDamage(room,nearest.target,dmg,player,w.cat);
  }
  return true;
}
function serverResolveSub(room,player,m){
  if(!room.started||!player.team||!player.serverAlive)return false;
  const def=SERVER_SUBS[String(m.subType||'')];if(!def)return false;
  const expectedSub=SERVER_SUB_BY_WEAPON[Number(player.weaponId)];
  if(expectedSub && String(m.subType)!==expectedSub)return false;
  const now=Date.now();if(now-(player.lastSubAt||0)<180)return false;
  const pos=Object.assign({},player.serverPos||player.spawn),vx=Number(m.vx)||0,vz=Number(m.vz)||0;
  const scale=Math.min(1.8,Math.max(.25,(def.delay||0)/1000)),center={x:pos.x+vx*scale,z:pos.z+vz*scale,y:pos.y||0};
  if(!serverPointInStage(center.x,center.z))return false;
  const subCost=serverSubInkCost(m.subType);
  if(!serverTrySpendInk(player,subCost)){
    send(player.ws,{type:'serverInk',ink:Math.max(0,player.serverInk??0)});
    return false;
  }
  player.lastSubAt=now;
  setTimeout(()=>{
    // The thrower may have left the room while the fuse was running.
    if(rooms.get(room.id)!==room||!room.started||room.players.get(player.id)!==player||!player.team)return;
    serverApplyAoE(room,center,def.radius||0,def.damage||0,player.team,player,'sub');
  },Math.max(0,def.delay||0));
  return true;
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
  if(!room.started||!player.team||!player.serverAlive)return false;
  /*
   * V103: the server is authoritative for activation/validation and event
   * delivery. Continuous special behavior is simulated by the canonical
   * client runtime so placed specials (barrier/stand/sonar/storm/sheet)
   * remain alive instead of being reduced to one instant AoE.
   */
  const OFFICIAL_SPECIALS=new Set([
    'ウルトラショット','エナジースタンド','カニタンク','キューインキ','グレートバリア',
    'サメライド','ショクワンダー','トリプルトルネード','ホップソナー','メガホンレーザー5.1ch',
    'テイオウイカ','デコイチラシ','スミナガシート','アメフラシ','ウルトラハンコ','ジェットパック',
    'ナイスダマ','マルチミサイル','ウルトラチャクチ'
  ]);
  const name=String(m.specialName||'');
  if(!OFFICIAL_SPECIALS.has(name))return false;
  const expected=SERVER_SPECIAL_BY_WEAPON[Number(player.weaponId)];
  if(expected && name!==expected)return false;
  const me=player.serverPos||player.spawn;let x=Number(m.x),z=Number(m.z);
  if(!Number.isFinite(x))x=me.x;if(!Number.isFinite(z))z=me.z;
  const dist=Math.hypot(x-me.x,z-me.z);
  if(dist>45){const scale=45/dist;x=me.x+(x-me.x)*scale;z=me.z+(z-me.z)*scale;}
  if(!serverPointInStage(x,z))return false;

  const sensorHop=name==='ホップソナー';
  const sensorMega=name==='メガホンレーザー5.1ch';
  const sensorMissile=name==='マルチミサイル';
  const center={x,y:Number(m.y)||0,z};

  if(sensorMega){
    serverApplySensorPulse(room,player,center,45,name,3000,3);
  }else if(sensorHop){
    serverApplySensorPulse(room,player,center,20,name,8000,99);
    [1600,4100,6600].forEach(delay=>{
      setTimeout(()=>{
        if(rooms.get(room.id)!==room||!room.started||room.players.get(player.id)!==player||!player.team)return;
        serverApplySensorPulse(room,player,player.serverPos||center,20,name,8000,99);
      },delay);
    });
  }else if(sensorMissile){
    serverApplySensorPulse(room,player,center,60,name,4000,5);
  }
  /*
   * Do not apply a generic AoE here. Every official special has its own
   * runtime behavior on both clients, and generic AoE caused placed specials
   * to deal damage at activation and then again during their real duration.
   */
  return true;
}
function finishServerMatch(room, forcedWinnerTeam=null, reason='turf'){
  if(!room||room.resultReported)return;
  room.resultReported=true;let a=0,b=0;
  for(const team of room.inkCells?.values()||[]){if(team==='A')a++;else if(team==='B')b++;}
  let winnerTeam;
  if(forcedWinnerTeam==='A'||forcedWinnerTeam==='B'){
    winnerTeam=forcedWinnerTeam;
  }else{
    winnerTeam=a===b?'DRAW':(a>b?'A':'B');
  }
  const updated=[];
  for(const p of room.players.values()){
    const pr=updateAccountResult(p,winnerTeam);
    if(pr)updated.push({id:p.id,profile:pr});
  }
  const forced=winnerTeam!==null && (reason==='team-eliminated');
  console.log('[AUTH MATCH END] '+room.id+' Acells='+a+' Bcells='+b+' winner='+winnerTeam+' reason='+reason);
  broadcast(room,{
    type:'matchEnd',
    winnerTeam,
    forced,
    reason,
    results:updated,
    score:{A:a,B:b}
  });
  for(const p of room.players.values()){
    p.roomId=null;p.team=null;p.ready=false;
  }
  room.players.clear();
  room.started=false;
  rooms.delete(room.id);
}

let nextPlayerNo = 1;
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function onlineIdentityKey(player) {
  /* Guests are identified by their persistent browser guestKey; all guest
     sockets must not collapse into one generic 'ゲスト' identity. */
  if (player?.guestKey) return 'guest:' + String(player.guestKey);
  if (player?.accountName) return 'account:' + String(player.accountName);
  return 'socket:' + String(player?.id || '');
}
function onlinePlayerCount() {
  const ids = new Set();
  for (const player of sockets.values()) ids.add(onlineIdentityKey(player));
  return ids.size;
}
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
    weapon: Number.isFinite(Number(c.weapon)) ? Math.max(0, Math.min(2, Math.floor(Number(c.weapon)))) : Math.max(0, Math.min(2, Number(fallbackWeapon)||0)),
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
  // 2〜7人: 全員が「準備OK」になるまで待機。
  // 8人: 全員Readyを待たず、自動で開始。
  if (room.started || room.players.size < 2) return;
  const ps = [...room.players.values()];
  if (room.players.size < 8 && !ps.every(p => p.ready)) return;
  ps.forEach((p, i) => {
    p.team = i % 2 === 0 ? 'A' : 'B';
    const slot = Math.floor(i / 2);
    const x = ((slot % 4) - 1.5) * 3.2;
    p.spawn = p.team === 'A' ? { x, y: 0, z: -64 } : { x, y: 0, z: 64 };
  });
  room.resultReported=false;
  /* Online battles always start dry. Practice/local match paint must never
     leak into a new server-authoritative online room. */
  room.inkCells=new Map();
  seedServerSpawnInk(room,ps);
  for(const p of ps){
    p.serverHp=100;p.serverAlive=true;p.serverInk=100;p.serverSquid=false;p.serverInkLastAt=Date.now();p.serverInkUseAt=0;p.serverRespawnAt=0;p.serverPos=Object.assign({},p.spawn);
    p.lastStatePos=Object.assign({},p.spawn);p.lastStateAt=Date.now();p.lastShotAt=0;p.lastSubAt=0;p.lastHazardAt=0;
  }
  room.started = true; room.startsAt = Date.now() + 1500;
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
  // 人数が8人になった場合だけ、この呼び出しで即時自動開始する。
  // 2〜7人では assignTeamsAndStart() 内のReady条件で待機する。
  assignTeamsAndStart(room);
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
    // When an entire team disappears, the remaining team wins immediately.
    if (room.players.size > 0) {
      broadcast(room, { type: 'playerLeft', id: leavingId, name: leavingName });
    }

    if (room.players.size === 0) {
      rooms.delete(room.id);
      return;
    }

    const hasA = [...room.players.values()].some(p=>p.team==='A');
    const hasB = [...room.players.values()].some(p=>p.team==='B');

    if (room.started && !room.resultReported && (hasA !== hasB)) {
      const forcedWinner = hasA ? 'A' : 'B';
      finishServerMatch(room, forcedWinner, 'team-eliminated');
      return;
    }

    return;
  }

  const players = roster(room);
  const payload = { type: 'roomState', roomId: room.id, players, count: players.length, minPlayers: 2, maxPlayers: 8 };
  for (const p of room.players.values()) send(p.ws, payload);
  if (room.players.size === 0) rooms.delete(room.id);
  else assignTeamsAndStart(room);
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
  let p;
  try {
    p = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (_) {
    return res.writeHead(400).end('Bad request');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }
  if (req.method === 'GET' && p === '/health') {
    return json(res, 200, { ok: true, service: 'splatoon-like-web-online', websocket: true, build: 'V103-SERVER-SPECIAL-AUTH-2026-10-01', time: new Date().toISOString() });
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
  if (req.method === 'GET' && p === '/api/ranking') {
    const s=getSession(req);
    const limit=Math.max(1,Math.min(100,Number(new URL(req.url||'/', 'http://localhost').searchParams.get('limit'))||50));
    return json(res,200,{ok:true,...buildRanking(limit,s)});
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
  const clean = p.replace(/^\/+/, '');
  /* Only game assets are public. Server code, account data, package metadata,
     .github and other repository files must never be downloadable. */
  const PUBLIC_FILE = /^(index\.html|about\.html|sitemap\.xml|favicon\.ico|(?:world|player|combat|online)-runtime\.js|node_modules\/three\/build\/three\.min\.js)$/;
  if (!PUBLIC_FILE.test(clean)) return res.writeHead(404).end('Not found');

  const file = path.resolve(ROOT, clean);
  const relativeFile = path.relative(ROOT, file);
  if (relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) return res.writeHead(403).end();

  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const ext = path.extname(file).toLowerCase();
    const types = {
      '.html':'text/html; charset=utf-8',
      '.js':'text/javascript; charset=utf-8',
      '.xml':'application/xml; charset=utf-8',
      '.txt':'text/plain; charset=utf-8',
      '.ico':'image/x-icon'
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

function securityStrike(player, reason, notify=true) {
  const now = Date.now();
  if (!player.securityWindowStart || now-player.securityWindowStart>10000) {
    player.securityWindowStart=now; player.securityStrikes=0;
  }
  player.securityStrikes++;
  console.warn(`[ANTI-CHEAT] ${player.id} strike=${player.securityStrikes} reason=${reason}`);
  /*
   * V99: 通常のオンライン移動補正はプレイヤーへ警告を出さない。
   * 特にインク上の高速移動はフレーム間隔や通信遅延で一時的に大きな
   * 座標差が出るため、同期補正そのものを「失敗」と見せない。
   */
  if(notify){
    try{send(player.ws,{type:'antiCheatWarning',reason:'座標同期を調整しました。'});}catch(_){}
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
function messageBudget(player,type='gameplay'){
  const now=Date.now();
  if(!player.msgWindowStart || now-player.msgWindowStart>=1000){
    player.msgWindowStart=now; player.msgCount=0; player.msgRateDrops=0;
  }
  player.msgCount++;
  /*
   * V98: state is the heartbeat of movement synchronization. Dropping a state
   * packet can make the other client look completely frozen even though the
   * WebSocket itself is still alive. State traffic is tiny (~20/s/client), so
   * always allow it and apply the normal budget to lower-priority gameplay.
   */
  if(type==='state')return true;
  if(player.msgCount<=240)return true;
  player.msgRateDrops=(player.msgRateDrops||0)+1;
  return false;
}

const wss = new WebSocketServer({
  server,
  /* A gameplay packet is tiny; 64 KiB is more than enough and prevents a
     client from allocating huge WebSocket payloads. */
  maxPayload: 64 * 1024
});
wss.on('connection', ws => {
  ws.isAlive=true;
  ws.missedHeartbeats=0;
  ws.on('pong',()=>{ws.isAlive=true;ws.missedHeartbeats=0;});
  ws.on('error',err=>console.warn('[WS ERROR]',err?.message||err));
  const id = `Player_${String(nextPlayerNo++).padStart(4, '0')}`;
  const player = {
    id, ws, roomId: null, team: null, ready: false, weaponId: 0,
    config: sanitizeConfig(null,0), spawn: { x: 0, y: 0, z: 0 },
    lastStateAt: 0, stateSeq: 0,
    accountName: null,
    guestKey: null,
    msgWindowStart: 0, msgCount: 0, securityWindowStart: 0, securityStrikes: 0,
    lastCalloutAt: 0, lastSpecialStartAt: 0, lastSpecialAt: 0,
    lastClientSeq: 0,
    serverHp:100, serverAlive:true, serverPos:null, serverRespawnAt:0,
    lastHazardAt:0, lastShotAt:0, lastSubAt:0,
    paintAnchors:[], paintTraceUntil:0,
    msgRateDrops:0, speedViolations:0, lastSpeedStrikeAt:0
  };
  sockets.set(ws, player);
  console.log(`[WS CONNECT] ${player.id} activeSockets=${sockets.size}`);
  send(ws, { type: 'hello', id });
  broadcastGlobalOnlineCount();
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if(!m || typeof m!=='object' || typeof m.type!=='string') return;
    const clientSeq=Number(m.clientSeq);
    if(Number.isInteger(clientSeq)){
      if(clientSeq<=player.lastClientSeq)return;
      player.lastClientSeq=clientSeq;
    }
    if(!messageBudget(player,m.type)){
      if((player.msgRateDrops||0)===1)console.warn('[WS RATE DROP] '+player.id+' account='+(player.accountName||'-'));
      return;
    }    if (m.type === 'identify') {
      const boundRoom = player.roomId ? rooms.get(player.roomId) : null;
      if (boundRoom?.started) return;
      const token = String(m.token || '');
      const guestKey = String(m.guestId || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
      const s = sessionForToken(token);
      if (s && accounts[s.name]) {
        player.accountName = s.name;
        player.guestKey = null;
        send(ws, { type:'accountBound', profile:profile(accounts[s.name]) });
      } else if (guestKey) {
        player.accountName = null;
        player.guestKey = guestKey;
        send(ws, { type:'guestIdentified', guestId:guestKey, name:'ゲスト' });
      } else {
        player.accountName = null;
        player.guestKey = null;
        send(ws, { type:'guestIdentified', name:'ゲスト' });
      }
      broadcastGlobalOnlineCount();
      return;
    }
    if (m.type === 'bindAccount') {
      const boundRoom = player.roomId ? rooms.get(player.roomId) : null;
      if (boundRoom?.started) return;
      const token = String(m.token || '');
      const s = sessionForToken(token);
      if (s && accounts[s.name]) {
        // Connections are identified by their WebSocket player id.
        // The same account may be open on more than one device/tab without
        // forcibly disconnecting an active match.
        player.accountName = s.name;
        player.guestKey = null;
        console.log(`[WS BIND] ${player.id} account=${player.accountName}`);
        send(ws, { type: 'accountBound', profile: profile(accounts[s.name]) });
        broadcastGlobalOnlineCount();
      } else {
        console.log(`[WS BIND FAIL] ${player.id} tokenInvalid=true`);
        send(ws, { type: 'accountBound', error: 'ログイン情報が無効です。' });
      }
      return;
    }
    if (m.type === 'joinQueue') {
      const currentRoom = player.roomId ? rooms.get(player.roomId) : null;
      if (currentRoom?.started) return;
      /* Join may arrive immediately after socket creation. Re-bind from the
         stored token/guest id here too, so the roster never falls back to a
         socket-generated Guest_Player_XXXX name. */
      if (!player.accountName && m.token) {
        const s = sessionForToken(String(m.token || ''));
        if (s && accounts[s.name]) player.accountName = s.name;
      }
      if (!player.accountName && m.guestId) {
        const guestKey = String(m.guestId || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
        if (guestKey) player.guestKey = guestKey;
      }
      if (m.config && typeof m.config === 'object') player.config = sanitizeConfig(m.config, player.weaponId);
      applyCanonicalPlayerColor(player);
      if (Number.isFinite(Number(m.weaponId))) player.weaponId = Math.max(0, Math.min(2, Math.floor(Number(m.weaponId))));
      player.config.weapon = player.weaponId;
      // Online battles can also use Render without a WEB ID.
      // Registered users keep their account/rating; guests keep one stable
      // browser identity instead of becoming a new Guest_Player_XXXX on every reconnect.
      if (!player.accountName && !player.guestKey) player.guestKey = 'anon-' + player.id;
      if (!player.accountName) player.accountName = 'ゲスト';
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
      player.weaponId = Number.isFinite(m.weaponId) ? Math.max(0, Math.min(2, Math.floor(Number(m.weaponId)))) : player.weaponId;
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
      const weaponId = player.weaponId;
      const charge = Number.isFinite(Number(m.charge)) ? Math.max(0, Math.min(1, Number(m.charge))) : null;
      const mode = typeof m.mode === 'string' ? String(m.mode).slice(0, 32) : null;
      player.__shotRejectReason='';
      const accepted=serverResolveShot(room,player,Object.assign({},m,{weaponId,dx:nums[3],dy:nums[4],dz:nums[5],charge}));
      if(!accepted){
        console.warn('[ONLINE SHOT REJECT]',player.id,'reason=',player.__shotRejectReason||'unknown','ink=',Number(player.serverInk??0).toFixed(1),'alive=',!!player.serverAlive);
        send(player.ws,{type:'shotResult',accepted:false,reason:player.__shotRejectReason||'unknown',ink:Math.max(0,player.serverInk??0)});
        return;
      }
      const projectile=serverProjectileSpec(SERVER_WEAPONS[weaponId],{charge,mode});
      const bDir={x:nums[3]/dirLen,y:nums[4]/dirLen,z:nums[5]/dirLen};
      const bOrigin=player.serverPos||{x:nums[0],y:Number(nums[1])-1.2,z:nums[2]};
      send(player.ws,{type:'shotResult',accepted:true,ink:Math.max(0,player.serverInk??0)});
      broadcast(room, {
        type: 'shot',
        protocol: 'v117-projectile-1',
        id: player.id,
        team: player.team,
        x: (bOrigin.x||0)+bDir.x*.55,
        y: (bOrigin.y||0)+1.2,
        z: (bOrigin.z||0)+bDir.z*.55,
        dx:bDir.x,dy:bDir.y,dz:bDir.z,
        weaponId, charge, mode, projectile
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
      const weaponId = player.weaponId;
      const charge = Number.isFinite(Number(m.charge)) ? Math.max(0, Math.min(1.4, Number(m.charge))) : 0;
      const accepted=serverResolveSub(room,player,Object.assign({},m,{subType,vx:nums[3],vy:nums[4],vz:nums[5]}));
      if(!accepted)return;
      broadcast(room, {
        type: 'sub',
        id: player.id,
        team: player.team,
        x: player.serverPos?.x ?? nums[0], y: player.serverPos?.y ?? nums[1], z: player.serverPos?.z ?? nums[2],
        vx: nums[3], vy: nums[4], vz: nums[5],
        subType,
        weaponId, charge
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
      const accepted=serverResolveSpecial(room,player,Object.assign({},m,{specialName:name,x,y,z}));
      if(!accepted)return;
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
      const now=Date.now(); if(now-player.lastStateAt<28)return;
      let x=Number(m.x),rawY=Number(m.y),z=Number(m.z),yaw=Number(m.yaw);
      if(!Number.isFinite(x)||!Number.isFinite(rawY)||!Number.isFinite(z)||!Number.isFinite(yaw)){
        console.warn('[WS STATE DROP] '+player.id+' invalid-position');
        return;
      }

      /*
       * V98: never let a recoverable movement discrepancy freeze the remote
       * player. Keep coordinates inside the known world envelope instead of
       * dropping the complete synchronization frame.
       */
      const originalX=x,originalY=rawY,originalZ=z;
      x=Math.max(-SERVER_PLAYABLE_HALF_X,Math.min(SERVER_PLAYABLE_HALF_X,x));
      z=Math.max(-SERVER_PLAYABLE_HALF_Z,Math.min(SERVER_PLAYABLE_HALF_Z,z));
      /* V105 sync fix: preserve the client's squid rest height on the floor. */
      rawY=Math.max(-0.5,Math.min(8,rawY));
      let corrected=false;
      if(x!==originalX||z!==originalZ||rawY!==originalY){
        corrected=true;
        securityStrike(player,'state-position-clamped');
      }

      const y=rawY;
      if(player.serverHp==null)player.serverHp=100; if(player.serverAlive==null)player.serverAlive=true; if(player.serverInk==null)player.serverInk=100;
      if(player.serverAlive){
        if(player.serverPos){
          const dt=Math.max(.028,(now-player.lastStateAt)/1000);
          const d=Math.hypot(x-player.serverPos.x,z-player.serverPos.z);
          /*
           * V99: derive the allowed displacement from the real client movement
           * rates instead of a fixed 2.8-unit cap. Squid movement is faster on
           * friendly ink, and packet timing can jitter, so a fixed cap caused
           * false corrections during perfectly normal ink-swim movement.
           */
          const requestedSquid=!!m.squid;
          const maxSpeed=requestedSquid ? 32 : 20;
          const baseStep=requestedSquid ? 1.05 : .95;
          const maxStep=m.superJump
            ? Math.min(16,Math.max(4.0,baseStep+dt*maxSpeed*2.2))
            : Math.min(12,Math.max(3.0,baseStep+dt*maxSpeed*1.8));
          // Normal movement must not be corrected back every few packets.
          // Only a truly huge jump is clamped.
          const hardJump=maxStep*2.5;
          if(d>hardJump){
            player.speedViolations=(player.speedViolations||0)+1;
            if(now-(player.lastSpeedWarnAt||0)>3000){
              player.lastSpeedWarnAt=now;
              console.warn('[WS SPEED CLAMP] '+player.id+' d='+d.toFixed(2)+' hardMax='+hardJump.toFixed(2)+' squid='+requestedSquid);
            }
            const scale=hardJump/Math.max(d,.0001);
            x=player.serverPos.x+(x-player.serverPos.x)*scale;
            z=player.serverPos.z+(z-player.serverPos.z)*scale;
            corrected=true;
          }else{
            player.speedViolations=0;
          }        }
        const resolved=serverResolveHorizontalMove(player.serverPos,{x,y,z});
        x=resolved.x;z=resolved.z;
        player.serverPos={x,y,z}; player.lastStateAt=now;
      }
      const serverPosForInk=player.serverPos||player.spawn;
      const enemyInkNow=room.started&&player.team&&serverInkTeamAt(room,serverPosForInk)!=null&&serverInkTeamAt(room,serverPosForInk)!==player.team;
      player.serverSquid=!!m.squid&&!enemyInkNow;
      const prevInkAt=player.serverInkLastAt||now;
      const inkDt=Math.max(0,Math.min(.25,(now-prevInkAt)/1000));
      if(player.serverSquid&&now-(player.serverInkUseAt||0)>=450){
        player.serverInk=Math.min(100,(player.serverInk??100)+serverInkRegenRate(player)*inkDt);
      }
      player.serverInkLastAt=now;
      if(room.started&&player.serverAlive&&player.team&&now-(player.lastHazardAt||0)>=350){
        player.lastHazardAt=now; const inkTeam=serverInkTeamAt(room,player.serverPos||player.spawn);
        if(inkTeam&&inkTeam!==player.team){
          /* Enemy ink damage remains gradual, but HP is allowed to reach 0. */
          const damage=Math.max(0,Math.min(4,Math.max(0,player.serverHp)));
          if(damage>0)serverApplyDamage(room,player,damage,null,'enemy-ink');
        }
      }
      const serverPos=player.serverPos||player.spawn,enemyInk=enemyInkNow;
      const packet={type:'state',seq:++player.stateSeq,id:player.id,name:player.accountName||player.id,team:player.team,x:serverPos.x,y:serverPos.y||0,z:serverPos.z,yaw,corrected,
        hp:Math.max(0,Math.min(100,player.serverHp||0)),ink:Math.max(0,Math.min(100,player.serverInk??100)),alive:!!player.serverAlive,squid:!!m.squid&&!enemyInk,moving:!!m.moving,weaponId:player.weaponId,colorHex:applyCanonicalPlayerColor(player)};
      broadcast(room,packet,player.id); send(player.ws,packet); return;
    }

    if (m.type === 'paint') {
      if(!room.started||!player.team||!player.serverAlive)return;
      const x=Number(m.x),z=Number(m.z),radius=Number(m.radius);
      if(![x,z,radius].every(Number.isFinite)||radius<.2||radius>8||!serverPointInStage(x,z))return;
      const now=Date.now();
      if(now-(player.lastPaintAt||0)<28)return;
      const x2raw=Number(m.x2),z2raw=Number(m.z2);
      if(!serverAcceptPaintTrace(player,x,z,x2raw,z2raw))return;
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
      ws.missedHeartbeats=(ws.missedHeartbeats||0)+1;
      if(ws.missedHeartbeats>=3){
        console.warn('[WS HEARTBEAT TIMEOUT] '+player.id+' missed='+ws.missedHeartbeats);
        try{ws.terminate();}catch(_){}
      }else{
        console.warn('[WS HEARTBEAT MISS] '+player.id+' missed='+ws.missedHeartbeats);
      }
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
    const remain = Math.max(0, 180 - Math.max(0, (now - room.startsAt) / 1000));
    broadcast(room, { type:'serverTick', remaining:remain, started:now >= room.startsAt });
    if (remain <= 0 && !room.resultReported) { finishServerMatch(room); }
  }
}, 500);
server.listen(PORT, '0.0.0.0', () => console.log(`Splatoon-like room server listening on ${PORT}`));
