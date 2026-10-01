/* V108 CANONICAL GAMEPLAY RUNTIME
 * Loaded last. Gameplay-critical systems below intentionally replace the
 * previous V64/V79/V82/V89/V91/V94/V95/V102 wrapper chain.
 */
(function(){
'use strict';
if(window.__V108_CANONICAL_RUNTIME)return;
window.__V108_CANONICAL_RUNTIME=true;
window.__V108_CANONICAL_BUILD='V108-CANONICAL-2026-10-01';

const UP=new THREE.Vector3(0,1,0);
const Y=new THREE.Vector3(0,1,0);
const EPS=.0001;

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const teamColor=(team,c)=>Number.isFinite(Number(c))?(Number(c)&0xffffff):(team==='B'?0xff2255:0xe3ff00);
const alive=f=>!!f&&f.alive!==false;

/* V109: remove canonical visual marks before a stage rebuild. */
try{
  const _buildStageV109=buildStage;
  buildStage=function(){
    for(const mesh of visualInk.splice(0,visualInk.length)){
      try{scene.remove(mesh);mesh.geometry?.dispose?.();mesh.material?.dispose?.();}catch(_){}
    }
    return _buildStageV109.apply(this,arguments);
  };
  window.buildStage=buildStage;
}catch(_){}
function supportHeight(x,z,y=0){
  const px=n(x),pz=n(z),hint=n(y);
  let best=0;
  for(const b of collidableBlocks||[]){
    if(px<b.minX||px>b.maxX||pz<b.minZ||pz>b.maxZ)continue;
    if(n(b.maxY)>hint+.18)continue;
    if(n(b.maxY)>best)best=n(b.maxY);
  }
  return best;
}
try{getSupportHeight=supportHeight;}catch(_){}
window.getSupportHeight=supportHeight;

function faceHit(block,p){
  if(!block||!p)return null;
  const c=[
    ['minX',Math.abs(p.x-block.minX),new THREE.Vector3(-1,0,0)],
    ['maxX',Math.abs(p.x-block.maxX),new THREE.Vector3(1,0,0)],
    ['minY',Math.abs(p.y-block.minY),new THREE.Vector3(0,-1,0)],
    ['maxY',Math.abs(p.y-block.maxY),UP.clone()],
    ['minZ',Math.abs(p.z-block.minZ),new THREE.Vector3(0,0,-1)],
    ['maxZ',Math.abs(p.z-block.maxZ),new THREE.Vector3(0,0,1)]
  ].sort((a,b)=>a[1]-b[1]);
  const [face]=c;
  const x=clamp(p.x,block.minX+.03,block.maxX-.03);
  const y=clamp(p.y,block.minY+.03,block.maxY-.03);
  const z=clamp(p.z,block.minZ+.03,block.maxZ-.03);
  let point;
  if(face==='minX')point=new THREE.Vector3(block.minX,y,z);
  else if(face==='maxX')point=new THREE.Vector3(block.maxX,y,z);
  else if(face==='minY')point=new THREE.Vector3(x,block.minY,z);
  else if(face==='maxY')point=new THREE.Vector3(x,block.maxY,z);
  else if(face==='minZ')point=new THREE.Vector3(x,y,block.minZ);
  else point=new THREE.Vector3(x,y,block.maxZ);
  return {block,face,point,normal:c[0][2].clone()};
}
try{getFaceHitPoint=faceHit;}catch(_){}
window.getFaceHitPoint=faceHit;

function segmentAABB(a,b,block){
  const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z};
  let te=0,tx=1,normal=null;
  const axes=[
    ['x',block.minX,block.maxX,new THREE.Vector3(-1,0,0),new THREE.Vector3(1,0,0)],
    ['y',block.minY,block.maxY,new THREE.Vector3(0,-1,0),new THREE.Vector3(0,1,0)],
    ['z',block.minZ,block.maxZ,new THREE.Vector3(0,0,-1),new THREE.Vector3(0,0,1)]
  ];
  for(const [axis,min,max,n1,n2] of axes){
    const av=a[axis],dv=d[axis];
    if(Math.abs(dv)<EPS){if(av<min||av>max)return null;continue;}
    let t1=(min-av)/dv,t2=(max-av)/dv,A=n1,B=n2;
    if(t1>t2){[t1,t2]=[t2,t1];[A,B]=[B,A];}
    if(t1>te){te=t1;normal=A;}
    tx=Math.min(tx,t2);
    if(te>tx)return null;
  }
  if(te<0||te>1)return null;
  return {t:te,point:a.clone().lerp(b,te),normal:normal||UP.clone(),block};
}
function firstStageHit(a,b){
  let best=null;
  for(const block of collidableBlocks||[]){
    if(!block||block.mesh?.visible===false)continue;
    const h=segmentAABB(a,b,block);
    if(h&&(!best||h.t<best.t))best=h;
  }
  return best;
}

function ensureInkState(block){
  if(!block.__v108Marks)block.__v108Marks=[];
  if(!block.__v108CellsA)block.__v108CellsA=new Set();
  if(!block.__v108CellsB)block.__v108CellsB=new Set();
}
function faceName(normal){
  if(Math.abs(normal.y)>.7)return normal.y>0?'maxY':'minY';
  if(Math.abs(normal.x)>.7)return normal.x>0?'maxX':'minX';
  return normal.z>0?'maxZ':'minZ';
}
const visualInk=[];
const MAX_VISUAL_INK=50000;
function visualStamp(block,p,normal,r,c,team){
  if(!block)return;
  ensureInkState(block);
  const rr=clamp(r,.2,3.6);
  block.__v108Marks.push({face:faceName(normal),x:p.x,y:p.y,z:p.z,r:rr,color:teamColor(team,c),team:team||null});
  if(block.__v108Marks.length>5000)block.__v108Marks.splice(0,block.__v108Marks.length-5000);
  if(normal.y>.7){
    const set=team==='B'?block.__v108CellsB:block.__v108CellsA;
    const other=team==='B'?block.__v108CellsA:block.__v108CellsB;
    const ix0=Math.floor(p.x-rr-block.minX),ix1=Math.ceil(p.x+rr-block.minX);
    const iz0=Math.floor(p.z-rr-block.minZ),iz1=Math.ceil(p.z+rr-block.minZ);
    for(let ix=ix0;ix<=ix1;ix++)for(let iz=iz0;iz<=iz1;iz++){
      const cx=block.minX+ix+.5,cz=block.minZ+iz+.5;
      if(Math.hypot(cx-p.x,cz-p.z)<=rr+.5){
        const key=ix+','+iz;
        other.delete(key);
        set.add(key);
      }
    }
  }
  const geo=new THREE.CircleGeometry(1,14),pos=geo.attributes.position;
  for(let i=1;i<pos.count;i++){
    const a=Math.atan2(pos.getY(i),pos.getX(i)),q=.82+Math.random()*.24;
    pos.setX(i,Math.cos(a)*q);pos.setY(i,Math.sin(a)*q);
  }
  pos.needsUpdate=true;
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({
    color:teamColor(team,c),transparent:true,opacity:.94,depthWrite:false,side:THREE.DoubleSide
  }));
  mesh.scale.setScalar(rr);
  mesh.position.copy(p).addScaledVector(normal,.025);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal.clone().normalize());
  mesh.userData.__v108=true;
  /* V109: p is already a world-space hit point. Never attach it as local coordinates to block.mesh. */
  scene.add(mesh);
  visualInk.push(mesh);
  while(visualInk.length>MAX_VISUAL_INK){
    const old=visualInk.shift();
    if(old?.parent)old.parent.remove(old);
    try{old.geometry.dispose();old.material.dispose();}catch(_){}
  }
}
function paintFloor(x,z,r,c,to){
  if(!paintCtx)return;
  if(typeof marketPointInPolygon==='function'&&!marketPointInPolygon(x,z))return;
  const a=worldToCanvas(x,z),rr=clamp(r,.2,5),cr=Math.max(1,(rr/(Math.max(1,n(STAGE_HALF_Z,76))*2))*paintCanvas.height);
  paintCtx.save();
  paintCtx.globalAlpha=1;paintCtx.globalCompositeOperation='source-over';
  paintCtx.fillStyle=hexToCss(teamColor(null,c));paintCtx.strokeStyle=paintCtx.fillStyle;
  paintCtx.lineCap='round';paintCtx.lineJoin='round';
  if(to&&Number.isFinite(Number(to.x))&&Number.isFinite(Number(to.z))){
    const b=worldToCanvas(Number(to.x),Number(to.z));
    paintCtx.lineWidth=Math.max(2,cr*1.9);
    paintCtx.beginPath();paintCtx.moveTo(a.cx,a.cy);paintCtx.lineTo(b.cx,b.cy);paintCtx.stroke();
  }else{
    paintCtx.beginPath();paintCtx.arc(a.cx,a.cy,cr,0,Math.PI*2);paintCtx.fill();
  }
  paintCtx.restore();paintTexture.needsUpdate=true;
}
function findBlock(x,z,y,normal){
  let best=null,bd=Infinity;
  for(const b of collidableBlocks||[]){
    if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)continue;
    let target,dist;
    if(normal.y>.7){target=b.maxY;dist=Math.abs(y-target);}
    else if(normal.y<-.7){if(b.maxY-b.minY<1.3)continue;target=b.minY;dist=Math.abs(y-target);}
    else if(Math.abs(normal.x)>.7){target=normal.x>0?b.maxX:b.minX;dist=Math.abs(x-target);}
    else{target=normal.z>0?b.maxZ:b.minZ;dist=Math.abs(z-target);}
    if(dist<.45&&dist<bd){bd=dist;best=b;}
  }
  return best;
}
function surfaceSegment(a,b,r,c,team,block,normal){
  const len=Math.hypot(b.x-a.x,b.z-a.z);
  const steps=Math.max(1,Math.min(160,Math.ceil(len/Math.max(.45,r*.45))));
  for(let i=0;i<=steps;i++){
    const t=i/steps,p=a.clone().lerp(b,t);
    if(normal.y>.7)p.y=block.maxY;
    else if(normal.y<-.7)p.y=block.minY;
    else if(Math.abs(normal.x)>.7)p.x=normal.x>0?block.maxX:block.minX;
    else p.z=normal.z>0?block.maxZ:block.minZ;
    visualStamp(block,p,normal,r,c,team);
  }
}
function canonicalPaintSegment(a,b,r,c,network=false){
  if(!a||!b)return;
  const ay=Number.isFinite(Number(a.y))?Number(a.y):0;
  const by=Number.isFinite(Number(b.y))?Number(b.y):ay;
  const sy=supportHeight(a.x,a.z,Math.max(ay,.2));
  const ey=supportHeight(b.x,b.z,Math.max(by,.2));
  const surfaceY=Math.abs(sy-ey)<=.35?sy:Math.min(sy,ey);
  const team=a.team||b.team||a.sourceFighter?.team||b.sourceFighter?.team||null;
  canonicalPaint(a.x,a.z,r,c,{surfaceY,normal:UP,team,to:{x:b.x,z:b.z},noNetwork:true,sourceFighter:a.sourceFighter||b.sourceFighter});
  if(network)sendPaint(a.x,a.z,r,c,{y:surfaceY,normal:UP,team,to:{x:b.x,z:b.z}});
}
try{paintSegment=canonicalPaintSegment;}catch(_){}
window.paintSegment=canonicalPaintSegment;
try{sendPaintSegment=function(a,b,r,c){canonicalPaintSegment(a,b,r,c,true);};}catch(_){}
window.sendPaintSegment=function(a,b,r,c){canonicalPaintSegment(a,b,r,c,true);};

function teamOf(o){return o?.team||o?.sourceFighter?.team||null;}
function sendPaint(x,z,r,c,o={}){
  if(!onlineActive||!onlineStarted||!onlineSocket||onlineSocket.readyState!==1)return;
  const normal=o.normal?.clone?o.normal.clone():UP.clone();
  const m={type:'paint',roomId:onlineRoomId,x:n(x),z:n(z),radius:clamp(n(r,.7),.2,8),colorHex:teamColor(o.team,c),y:n(o.y,.04),nx:normal.x,ny:normal.y,nz:normal.z};
  if(o.to&&Number.isFinite(Number(o.to.x))&&Number.isFinite(Number(o.to.z))){m.x2=n(o.to.x);m.z2=n(o.to.z);}
  try{onlineSocket.send(JSON.stringify(m));}catch(_){}
}
function canonicalPaint(x,z,r,c,o={}){
  const px=n(x),pz=n(z),rr=clamp(n(r,.7),.2,5),team=teamOf(o);
  if(typeof marketPointInPolygon==='function'&&!marketPointInPolygon(px,pz))return;
  let normal=o.normal?.clone?o.normal.clone():UP.clone();
  if(normal.lengthSq()<EPS)normal.copy(UP);else normal.normalize();
  let y=Number.isFinite(Number(o.surfaceY))?Number(o.surfaceY):null;
  if(y===null){
    const sourceY=Number(o.sourceFighter?.pos?.y);
    y=supportHeight(px,pz,Number.isFinite(Number(o.yHint))?Number(o.yHint):(Number.isFinite(sourceY)?sourceY:.04));
  }
  let block=o.block||findBlock(px,pz,y,normal);
  const to=o.to&&Number.isFinite(Number(o.to.x))&&Number.isFinite(Number(o.to.z))?{x:n(o.to.x),z:n(o.to.z)}:null;

  if(normal.y>.7){
    if(block&&block.maxY>.22){
      const p=new THREE.Vector3(clamp(px,block.minX+.04,block.maxX-.04),block.maxY,clamp(pz,block.minZ+.04,block.maxZ-.04));
      if(to&&block.maxY>=.22)surfaceSegment(p,new THREE.Vector3(to.x,block.maxY,to.z),rr,c,team,block,normal);
      else visualStamp(block,p,normal,rr,c,team);
    }else paintFloor(px,pz,rr,c,to);
  }else{
    if(!block){
      block=findBlock(px,pz,y,normal);
    }
    if(block){
      const h=faceHit(block,new THREE.Vector3(px,y,pz));
      const p=h?.point||new THREE.Vector3(px,y,pz);
      if(to&&Math.abs(normal.y)<.7)surfaceSegment(p,new THREE.Vector3(to.x,p.y,to.z),rr,c,team,block,normal);
      else visualStamp(block,p,normal,rr,c,team);
    }
  }
  if(!o.remote&&!o.noNetwork&&onlineActive&&onlineStarted)sendPaint(px,pz,rr,c,{y,normal,to,team});
}
try{paintGround=canonicalPaint;}catch(_){}
window.paintGround=canonicalPaint;window.paintInk=canonicalPaint;

function canonicalWallPaint(block,p,c,team,size){
  const h=faceHit(block,p);
  if(!h)return;
  canonicalPaint(h.point.x,h.point.z,clamp(n(size,1),.35,2.6),c,{surfaceY:h.point.y,normal:h.normal,team,block,hitPoint:h.point});
}
try{paintWallSurface=canonicalWallPaint;}catch(_){}
window.paintWallSurface=canonicalWallPaint;

function marksInk(f,want){
  for(const b of collidableBlocks||[]){
    for(const m of b.__v108Marks||[]){
      if(m.team!==want)continue;
      const rr=m.r+.75;
      if(m.face==='maxY'&&Math.abs(f.pos.y-b.maxY)<.8&&Math.hypot(f.pos.x-m.x,f.pos.z-m.z)<=rr)return true;
      if(m.face==='minY'&&Math.abs(f.pos.y-b.minY)<.8&&Math.hypot(f.pos.x-m.x,f.pos.z-m.z)<=rr)return true;
      if((m.face==='minX'||m.face==='maxX')&&Math.abs(f.pos.x-m.x)<1.15&&Math.hypot(f.pos.z-m.z,f.pos.y-m.y)<=rr)return true;
      if((m.face==='minZ'||m.face==='maxZ')&&Math.abs(f.pos.z-m.z)<1.15&&Math.hypot(f.pos.x-m.x,f.pos.y-m.y)<=rr)return true;
    }
  }
  return false;
}
function groundTeam(x,z){
  if(!paintCtx)return null;
  const q=worldToCanvas(x,z);if(q.cx<0||q.cy<0||q.cx>=paintCanvas.width||q.cy>=paintCanvas.height)return null;
  const d=paintCtx.getImageData(Math.floor(q.cx),Math.floor(q.cy),1,1).data;
  let best=null,bd=Infinity;
  for(const t of ['A','B']){
    const col=new THREE.Color(teamColor(t));
    const dr=d[0]/255-col.r,dg=d[1]/255-col.g,db=d[2]/255-col.b,dd=dr*dr+dg*dg+db*db;
    if(dd<bd){bd=dd;best=t;}
  }
  return bd<.17?best:null;
}
function canonicalOnInk(f){
  if(!f?.team)return false;
  if(marksInk(f,f.team))return true;
  const sy=supportHeight(f.pos.x,f.pos.z,f.pos.y+.2);
  return Math.abs(f.pos.y-sy)<.95&&groundTeam(f.pos.x,f.pos.z)===f.team;
}
function canonicalEnemyInk(f){
  if(!f?.team)return false;
  const t=f.team==='A'?'B':'A';
  return marksInk(f,t)||(Math.abs(f.pos.y-supportHeight(f.pos.x,f.pos.z,f.pos.y+.2))<.95&&groundTeam(f.pos.x,f.pos.z)===t);
}
try{onFighterInk=canonicalOnInk;}catch(_){}
window.onFighterInk=canonicalOnInk;
try{isEnemyInkAt=canonicalEnemyInk;}catch(_){}
window.isEnemyInkAt=canonicalEnemyInk;

/* ---------- canonical projectile creation / firing ---------- */
function aim(f,d){
  if(f?.isPlayer&&camera){
    const q=new THREE.Vector3();
    try{camera.getWorldDirection(q);q.y=0;if(q.lengthSq()>EPS)return q.normalize();}catch(_){}
  }
  const v=d?.clone?d.clone():new THREE.Vector3(Math.sin(n(f?.root?.rotation?.y)),0,Math.cos(n(f?.root?.rotation?.y)));
  if(v.lengthSq()<EPS)v.set(0,0,1);
  v.normalize();
  return v;
}
function consume(f,w,charge=null){
  let cost=n(w?.inkCost,1);
  if(w?.category==='charger')cost*=.7+.7*clamp(n(charge,0),0,1);
  try{if(typeof consumeInk==='function')return !!consumeInk(f,cost);}catch(_){}
  if(n(f.ink)<cost)return false;f.ink-=cost;return true;
}
function spawnCanonical(f,d,o={}){
  const dir=d.clone().normalize(),start=f.pos.clone();
  start.y+=n(o.yOffset,1.2);start.x+=dir.x*.62;start.z+=dir.z*.62;
  const col=teamColor(f.team,getFighterInkHex(f));
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(clamp(n(o.radius,.13),.08,.32),8,8),new THREE.MeshBasicMaterial({color:col}));
  mesh.position.copy(start);scene.add(mesh);
  const speed=Math.max(1,n(o.speed,34));
  const b={__v108:true,mesh,velocity:dir.multiplyScalar(speed),age:0,travelled:0,pathTravel:0,
    straightDistance:n(o.straightDistance,0),maxRange:Math.max(4,n(o.maxRange,n(o.range,30))),
    gravity:n(o.gravity,4.8),drag:n(o.drag,.02),radius:clamp(n(o.radius,.13),.08,.32),
    team:f.team,colorHex:col,damage:n(o.damage,0),fromId:f.id,sourceFighter:f,
    explosive:!!o.explosive,explosionRadius:n(o.explosionRadius,0),splashDamage:n(o.splashDamage,0),
    paintRadius:clamp(n(o.paintRadius,.85),.35,2.8),life:clamp(n(o.life,1.2),.25,4),kind:String(o.kind||'shooter'),netAt:0};
  bullets.push(b);return b;
}
try{spawnBulletV60=spawnCanonical;}catch(_){}
window.__spawnBulletV60=spawnCanonical;

function regularShot(f,d,t){
  if(!f||!f.alive)return false;
  const w=f.weapon||weaponList?.[0];if(!w)return false;
  if(['charger','roller','spinner','wiper'].includes(w.category)||w.brush)return false;
  if(t-n(f.lastShot)<Math.max(25,n(w.rate,100))||!consume(f,w))return false;
  f.lastShot=t;const base=aim(f,d),range=clamp(n(w.range,30),5,80);
  const add=o=>spawnCanonical(f,base,Object.assign({maxRange:range},o));
  let count=0;
  if(w.category==='blaster'){add({speed:clamp(n(w.speed,22),12,32),gravity:5.6,drag:.035,radius:.23,paintRadius:clamp(n(w.paintRadius,1.35),.8,1.8),damage:n(w.damage,70),life:1.45,explosive:true,explosionRadius:n(w.explosionRadius,2.5),splashDamage:n(w.splashDamage,40),kind:'blaster'});count=1;}
  else if(w.category==='slosher'){const q=base.clone();q.y=Math.sin(Math.PI*11/180);q.normalize();spawnCanonical(f,q,{speed:clamp(n(w.speed,19),12,28),gravity:10.5,drag:.015,radius:.28,paintRadius:clamp(n(w.paintRadius,1.45),.9,2),damage:n(w.damage,60),life:1.45,maxRange:range,explosive:true,explosionRadius:n(w.explosionRadius,2.2),splashDamage:n(w.damage*.5,30),kind:'slosher'});count=1;}
  else if(w.category==='maneuver'){for(const s of [-1,1]){const q=base.clone().applyAxisAngle(Y,s*clamp(n(w.spread,.05),.015,.11));spawnCanonical(f,q,{speed:clamp(n(w.speed,35),20,46),gravity:4.8,drag:.03,radius:.13,paintRadius:clamp(n(w.paintRadius,.8),.55,1.1),damage:n(w.damage,20),life:1.15,maxRange:range,kind:'dualies'});count++;}}
  else if(w.category==='brella'){const p=clamp(Math.floor(n(w.pellets,7)),3,9);for(let i=0;i<p;i++){const q=base.clone().applyAxisAngle(Y,(i-(p-1)/2)*.055);spawnCanonical(f,q,{speed:clamp(n(w.speed,30),18,42),gravity:4.8,drag:.04,radius:.13,paintRadius:clamp(n(w.paintRadius,.75),.5,1),damage:n(w.damage,18),life:1.1,maxRange:range,kind:'brella'});count++;}}
  else{const p=w.category==='spinner'?3:clamp(Math.floor(n(w.burst,1)),1,3);for(let i=0;i<p;i++){const q=base.clone();if(p>1)q.applyAxisAngle(Y,(i-(p-1)/2)*.025);spawnCanonical(f,q,{speed:clamp(n(w.speed,36),22,50),gravity:4.8,drag:.035,radius:.13,paintRadius:clamp(n(w.paintRadius,.9),.55,1.15),damage:n(w.damage,28),life:1.15,maxRange:range,kind:w.category==='spinner'?'splatling':'shooter'});count++;}}
  if(count&&f.isPlayer&&onlineActive&&onlineStarted)try{window.__v93SendShot?.({x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,dx:base.x,dy:base.y,dz:base.z,weaponId:w.id,mode:w.category});}catch(_){}
  try{f.specialGauge=Math.min(100,n(f.specialGauge)+.7*count*(f.gearProfile?.specialGain||1));sfx('shoot');}catch(_){}
  return count>0;
}
const previousTry=window.tryShoot;
function canonicalTryShoot(f,d,t){
  if(f?.__v102Special&&['ultra','jet','crab','stamp','kraken'].includes(f.__v102Special.mode))return previousTry?.(f,d,t)||false;
  return regularShot(f,d,n(t,performance.now()));
}
window.tryShoot=canonicalTryShoot;try{tryShoot=canonicalTryShoot;}catch(_){}

function canonicalCharger(f,d,frac=1){
  if(!f?.alive)return false;
  const w=f.weapon||{},q=clamp(n(frac,1),.05,1),t=performance.now();
  if(t-n(f.lastShot)<Math.max(100,n(w.rate,700)*.7)||!consume(f,w,q))return false;
  f.lastShot=t;const base=aim(f,d),stringer=w.kind==='stringer',count=stringer?clamp(Math.floor(n(w.arrows,3)),3,5):1;
  for(let i=0;i<count;i++){
    const qdir=base.clone().applyAxisAngle(Y,(stringer?(i-(count-1)/2)*(.065+(1-q)*.05):0));
    if(stringer){qdir.y=.12+.1*q;qdir.normalize();}
    spawnCanonical(f,qdir,{speed:stringer?n(w.speedShot,50)*(.75+.25*q):n(w.speed,65),gravity:stringer?10:0,drag:.005,radius:.13,paintRadius:clamp(n(w.paintRadius,.75),.5,1.2),damage:stringer?n(w.tapDamage,20)+(n(w.fullDamage,80)-n(w.tapDamage,20))*q:n(w.tapDamage,30)+(n(w.fullDamage,120)-n(w.tapDamage,30))*q,maxRange:clamp(n(w.range,50),5,80),life:stringer?1.7:1.3,kind:stringer?'stringer':'charger'});
  }
  if(f.isPlayer&&onlineActive&&onlineStarted)try{window.__v93SendShot?.({x:f.pos.x,y:f.pos.y+1.2,z:f.pos.z,dx:base.x,dy:base.y,dz:base.z,weaponId:w.id,mode:stringer?'stringer':'charger',charge:q});}catch(_){}
  try{sfx('shoot');}catch(_){}
  return true;
}
window.fireChargerShot=canonicalCharger;try{fireChargerShot=canonicalCharger;}catch(_){}
window.fireChargerShotV60=canonicalCharger;try{fireChargerShotV60=canonicalCharger;}catch(_){}

/* Remote ranged shots use this same representation. */
const previousRemote=window.__receiveOnlineShotV60;
window.__receiveOnlineShotV60=function(m){
  const w=weaponList?.[Number(m?.weaponId)];
  if(!w||w.category==='roller'||w.category==='wiper')return previousRemote?.(m);
  let f=(fighters||[]).find(x=>x.id===m.id);
  if(!f&&typeof ensureRemoteFighter==='function')try{f=ensureRemoteFighter({id:m.id,team:m.team,weaponId:w.id,spawn:{x:n(m.x),z:n(m.z)},config:{weapon:w.id}});}catch(_){}
  if(!f)return false;
  f.weapon=w;
  const d=new THREE.Vector3(n(m.dx),n(m.dy),n(m.dz,1));if(d.lengthSq()<EPS)d.set(0,0,1);d.normalize();
  if(w.category==='charger'){
    const q=clamp(n(m.charge,1),.05,1);const s=w.kind==='stringer',count=s?clamp(Math.floor(n(w.arrows,3)),3,5):1;
    for(let i=0;i<count;i++){const qd=d.clone().applyAxisAngle(Y,s?(i-(count-1)/2)*(.065+(1-q)*.05):0);if(s){qd.y=.12+.1*q;qd.normalize();}spawnCanonical(f,qd,{speed:s?n(w.speedShot,50)*(.75+.25*q):n(w.speed,65),gravity:s?10:0,drag:.005,radius:.13,paintRadius:clamp(n(w.paintRadius,.75),.5,1.2),damage:s?n(w.tapDamage,20)+(n(w.fullDamage,80)-n(w.tapDamage,20))*q:n(w.tapDamage,30)+(n(w.fullDamage,120)-n(w.tapDamage,30))*q,maxRange:clamp(n(w.range,50),5,80),life:s?1.7:1.3,kind:s?'stringer':'charger'});}
    return true;
  }
  const opt={maxRange:clamp(n(w.range,30),5,80),speed:clamp(n(w.speed,36),18,50),gravity:w.category==='slosher'?10.5:4.8,drag:.03,radius:w.category==='slosher'?.28:.13,paintRadius:clamp(n(w.paintRadius,.85),.45,1.8),damage:n(w.damage,28),life:1.3,kind:w.category};
  if(w.category==='blaster'){opt.speed=clamp(n(w.speed,22),12,32);opt.radius=.23;opt.gravity=5.6;opt.explosive=true;opt.explosionRadius=n(w.explosionRadius,2.5);opt.splashDamage=n(w.splashDamage,40);}
  canonicalSpawnBullet(f,d,opt);
  return true;
};

/* ---------- one projectile updater ---------- */
function bulletTrail(b,a){
  const z=b.mesh.position;
  const ga=supportHeight(a.x,a.z,Math.max(a.y,.2)),gb=supportHeight(z.x,z.z,Math.max(z.y,.2));
  if(Math.abs(ga-gb)>.3)return;
  const gapA=a.y-ga,gapB=z.y-gb;
  if(gapA<-.1||gapB<-.1||gapA>1.35||gapB>1.35)return;
  const r=clamp(n(b.paintRadius,.8)*.58,.4,1.1);
  canonicalPaint(a.x,a.z,r,b.colorHex,{surfaceY:ga,normal:UP,team:b.team,to:{x:z.x,z:z.z},noNetwork:true,sourceFighter:b.sourceFighter});
  const t=performance.now();
  if(b.sourceFighter?.isPlayer&&t-(b.netAt||0)>=55){b.netAt=t;sendPaint(a.x,a.z,r,b.colorHex,{y:ga,normal:UP,team:b.team,to:{x:z.x,z:z.z}});}
}
function pointSegment(p,a,b){
  const ab=b.clone().sub(a),q=Math.max(EPS,ab.lengthSq()),t=clamp(p.clone().sub(a).dot(ab)/q,0,1);
  const x=a.clone().addScaledVector(ab,t);return {t,p:x,d:p.distanceTo(x)};
}
function updateCanonicalBullets(dt){
  const step=clamp(n(dt,.016),.001,.08);
  for(let i=(bullets||[]).length-1;i>=0;i--){
    const b=bullets[i];if(!b?.mesh){bullets.splice(i,1);continue;}
    const prev=b.mesh.position.clone();b.age=n(b.age)+step;
    const sx=Math.hypot(n(b.velocity?.x),n(b.velocity?.z)),travel=n(b.pathTravel,b.travelled),straight=n(b.straightDistance);
    if(sx>.001&&travel<straight){
      const move=Math.min(sx*step,Math.max(0,n(b.maxRange,30)-travel)),q=move/sx;
      b.velocity.y-=n(b.gravity)*q;b.mesh.position.x+=n(b.velocity.x)*q;b.mesh.position.y+=n(b.velocity.y)*q;b.mesh.position.z+=n(b.velocity.z)*q;
      b.pathTravel=travel+move;b.travelled=n(b.travelled)+move;
    }else{
      b.velocity.x*=clamp(1-n(b.drag)*step,.7,1);b.velocity.z*=clamp(1-n(b.drag)*step,.7,1);b.velocity.y-=n(b.gravity)*step;b.mesh.position.addScaledVector(b.velocity,step);
      const move=Math.hypot(n(b.velocity.x),n(b.velocity.z))*step;b.travelled=n(b.travelled)+move;b.pathTravel=n(b.pathTravel)+move;
    }

    bulletTrail(b,prev);

    let fh=null,ft=Infinity;
    for(const f of fighters||[]){
      if(!alive(f)||f.team===b.team||f.id===b.fromId)continue;
      const h=pointSegment(new THREE.Vector3(f.pos.x,f.pos.y+.9,f.pos.z),prev,b.mesh.position);
      if(h.d<=n(b.radius,.13)+.55&&h.t<ft){ft=h.t;fh={f,p:h.p};}
    }
    const sh=firstStageHit(prev,b.mesh.position);
    if(fh&&(!sh||ft<=sh.t)){
      b.mesh.position.copy(fh.p);
      try{
        if(b.explosive)explodeAt(b.mesh.position.clone(),n(b.explosionRadius),n(b.splashDamage),b.team,{paintRadius:b.paintRadius,colorHex:b.colorHex,sourceFighter:b.sourceFighter});
        if(n(b.damage)>0)applyDamage(fh.f,Math.max(0,n(b.damage)-n(b.splashDamage)),b.sourceFighter||null);
      }catch(_){}
      scene.remove(b.mesh);bullets.splice(i,1);continue;
    }
    if(sh){
      b.mesh.position.copy(sh.point);
      try{
        if(b.explosive)explodeAt(sh.point.clone(),n(b.explosionRadius),n(b.splashDamage),b.team,{paintRadius:b.paintRadius,colorHex:b.colorHex,sourceFighter:b.sourceFighter});
        canonicalPaint(sh.point.x,sh.point.z,b.paintRadius,b.colorHex,{surfaceY:sh.point.y,normal:sh.normal,team:b.team,block:sh.block,hitPoint:sh.point,sourceFighter:b.sourceFighter});
      }catch(_){}
      scene.remove(b.mesh);bullets.splice(i,1);continue;
    }
    if(b.age>n(b.life,1.2)||n(b.travelled)>=n(b.maxRange,30)){
      const p=b.mesh.position.clone(),gy=supportHeight(p.x,p.z,p.y);
      canonicalPaint(p.x,p.z,b.paintRadius,b.colorHex,{surfaceY:gy,normal:UP,team:b.team,sourceFighter:b.sourceFighter});
      scene.remove(b.mesh);bullets.splice(i,1);
    }
  }
}
try{updateBullets=updateCanonicalBullets;}catch(_){}
window.updateBullets=updateCanonicalBullets;

/* ---------- AI: direct entity targeting, same weapon engine ---------- */
const aiState=new WeakMap();
function aiTarget(f){
  let best=null,bd=Infinity;
  for(const o of fighters||[]){if(!o||o===f||o.remote||!alive(o)||!o.team||o.team===f.team)continue;const d=Math.hypot(o.pos.x-f.pos.x,o.pos.z-f.pos.z);if(d<bd){bd=d;best=o;}}
  return best;
}
function aiRange(w){
  switch(w?.category){case'charger':return[12,45];case'spinner':return[9,30];case'roller':return[0,7];case'wiper':return[2,9];case'blaster':return[3,16];case'slosher':return[4,18];case'brella':return[3,14];default:return[4,26];}
}
function updateCanonicalAI(f,dt,now){
  if(!f||f.isPlayer||f.remote||!alive(f))return;
  let s=aiState.get(f);
  if(!s){s={strafe:Math.random()<.5?-1:1,nextShot:0,nextSub:now+1800,nextSpecial:now+5500,charge:0};aiState.set(f,s);}
  const t=aiTarget(f),w=f.weapon||{},r=aiRange(w);let combat=false,dest=null;
  if(t){
    const d=Math.hypot(t.pos.x-f.pos.x,t.pos.z-f.pos.z);
    if(d>r[1])dest={x:t.pos.x,z:t.pos.z};
    else if(d<Math.max(1.5,r[0])){const dx=f.pos.x-t.pos.x,dz=f.pos.z-t.pos.z,l=Math.hypot(dx,dz)||1;dest={x:f.pos.x+dx/l*3.2,z:f.pos.z+dz/l*3.2};combat=true;}
    else{combat=true;const dx=t.pos.x-f.pos.x,dz=t.pos.z-f.pos.z,l=Math.hypot(dx,dz)||1;dest={x:f.pos.x+(-dz/l)*s.strafe*2,z:f.pos.z+(dx/l)*s.strafe*2};}
  }else{
    const q=f.team==='A'?-1:1;dest={x:Math.sin(now*.0007)*20,z:q*(18+Math.cos(now*.0005)*12)};
  }
  if(num(f.ink)<15)f.squid_mode=canonicalOnInk(f);
  if(num(f.ink)>92)f.squid_mode=false;
  const aiWasSquid=!!f.squid_mode;
  if(dest){
    const dx=dest.x-f.pos.x,dz=dest.z-f.pos.z,l=Math.hypot(dx,dz);
    if(l>.12){const v=new THREE.Vector3(dx/l*(aiWasSquid?12.5:5.8),0,dz/l*(aiWasSquid?12.5:5.8));try{tryMoveWithCollision(f,v,dt,aiWasSquid);}catch(_){}}
  }
  if(aiWasSquid)f.ink=Math.min(100,num(f.ink)+31*dt);
  else if(dest&&Math.hypot(dest.x-f.pos.x,dest.z-f.pos.z)>.2){
    f.ink=Math.max(0,num(f.ink)-dt*(combat?1:.25));
  }
  if(combat&&t){
    const dx=t.pos.x-f.pos.x,dz=t.pos.z-f.pos.z,l=Math.hypot(dx,dz)||1,dir=new THREE.Vector3(dx/l,0,dz/l);
    f.human.rotation.y=Math.atan2(dir.x,dir.z);f.root.rotation.y=f.human.rotation.y;
    try{
      if(w.category==='charger'){if(!s.charge)s.charge=now;if(now-s.charge>=Math.max(300,n(w.chargeTime,800)*.65)&&now>=s.nextShot){canonicalCharger(f,dir,clamp((now-s.charge)/n(w.chargeTime,800),.45,.95));s.nextShot=now+850;s.charge=0;}}
      else if(w.category==='wiper'&&typeof fireBladeSlashV60==='function'){if(!s.charge)s.charge=now;if(now-s.charge>=Math.max(220,n(w.chargeTime,600)*.5)){fireBladeSlashV60(f,.7,dir);s.charge=0;}}
      else if(w.category==='roller'&&typeof performRollerSwing==='function')performRollerSwing(f,now);
      else if(w.category==='spinner'&&typeof fireSplatlingBurst==='function'&&now>=s.nextShot){
        fireSplatlingBurst(f,.65+Math.random()*.30);
        s.nextShot=now+900;
      }
      else canonicalTryShoot(f,dir,now);
    }catch(_){}
    if(typeof window.tryThrowSub==='function'&&now>=s.nextSub){try{window.tryThrowSub(f,dir,now);}catch(_){}s.nextSub=now+2600;}
    if(n(f.specialGauge)>=100&&now>=s.nextSpecial){try{window.fireSpecial?.(f);}catch(_){}s.nextSpecial=now+9000;}
  }
}
try{updateAI=updateCanonicalAI;}catch(_){}
window.updateAI=updateCanonicalAI;

/* ---------- turf uses both floor paint and elevated top marks ---------- */
function computeCanonicalTurf(){
  sampleCtx.clearRect(0,0,96,96);sampleCtx.drawImage(paintCanvas,0,0,96,96);
  const d=sampleCtx.getImageData(0,0,96,96).data;let a=0,b=0;
  for(let i=0;i<d.length;i+=4){
    const A=new THREE.Color(teamColor('A')),B=new THREE.Color(teamColor('B'));
    const p=new THREE.Color((d[i]<<16)|(d[i+1]<<8)|d[i+2]);
    if(p.distanceTo(A)<.25)a++;else if(p.distanceTo(B)<.25)b++;
  }
  let total=96*96,ca=0,cb=0;
  for(const block of collidableBlocks||[]){
    if(!block||!block.stagePlatform||n(block.maxY)<=.22)continue;
    const cells=Math.max(1,Math.ceil(n(block.w)*n(block.d)));total+=cells;
    ca+=Math.min(cells,block.__v108CellsA?.size||0);cb+=Math.min(cells,block.__v108CellsB?.size||0);
  }
  turfPct.a=Math.round(((a+ca)/total)*100);turfPct.b=Math.round(((b+cb)/total)*100);
}
try{computeTurf=computeCanonicalTurf;}catch(_){}
window.computeTurf=computeCanonicalTurf;

/* ---------- simple, accessible help UI ---------- */
(function installHelpUI(){
  if(document.getElementById('v108-help-button'))return;
  const style=document.createElement('style');
  style.textContent=`
    #v108-help-button{position:fixed;right:14px;top:72px;z-index:9000;border:2px solid #fff;border-radius:10px;background:#171b22;color:#fff;font-weight:800;font-size:14px;padding:8px 11px;cursor:pointer}
    #v108-help-panel{position:fixed;right:14px;top:118px;z-index:8999;width:min(320px,calc(100vw - 28px));box-sizing:border-box;background:rgba(18,22,29,.97);color:#fff;border:2px solid #fff;border-radius:14px;padding:14px;display:none;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:system-ui,sans-serif}
    #v108-help-panel h3{margin:0 0 10px;font-size:17px}
    #v108-help-panel p{margin:7px 0;line-height:1.45;font-size:13px}
    #v108-help-panel .close{width:100%;margin-top:8px;border:0;border-radius:9px;padding:9px;font-weight:800;cursor:pointer}
    @media(max-width:700px){#v108-help-button{top:58px;right:10px}#v108-help-panel{top:105px;right:10px}}
  `;
  document.head.appendChild(style);
  const btn=document.createElement('button');btn.id='v108-help-button';btn.type='button';btn.textContent='操作';
  const panel=document.createElement('div');panel.id='v108-help-panel';
  panel.innerHTML='<h3>操作ガイド</h3><p>移動：W A S D</p><p>視点：マウス</p><p>攻撃：左クリック</p><p>サブ：右クリック</p><p>イカ：Shift</p><p>ジャンプ：Space</p><p>オンライン：P / パネル：T</p><button class="close" type="button">閉じる</button>';
  document.body.appendChild(btn);document.body.appendChild(panel);
  btn.addEventListener('click',e=>{e.stopPropagation();panel.style.display=panel.style.display==='block'?'none':'block';});
  panel.querySelector('.close').addEventListener('click',()=>panel.style.display='none');
})();
console.log('[SPLATOON ONLINE][V108] canonical gameplay runtime active');
})();