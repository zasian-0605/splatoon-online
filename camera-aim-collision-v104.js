/* V104 FINAL: vertical camera direction, solid camera collision,
   and squid movement on painted elevated tops.
   Player controls remain WASD / Shift; only collision/camera resolution changes.
*/
(function(){
  'use strict';
  const BUILD='V104-FINAL-VERTICAL-CAMERA-TOP-INK-2026-10-02';

  function n(v,d=0){
    const x=Number(v);
    return Number.isFinite(x)?x:d;
  }

  function rayBoxEntry(a,b,min,max){
    const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z};
    let t0=0,t1=1;
    for(const k of ['x','y','z']){
      const av=a[k],dv=d[k];
      if(Math.abs(dv)<1e-8){
        if(av<min[k]||av>max[k])return null;
        continue;
      }
      let q0=(min[k]-av)/dv,q1=(max[k]-av)/dv;
      if(q0>q1){const q=q0;q0=q1;q1=q;}
      t0=Math.max(t0,q0);
      t1=Math.min(t1,q1);
      if(t0>t1)return null;
    }
    if(t1<0||t0>1)return null;
    return Math.max(0,t0);
  }

  function pushOutside(p,b,r,skin){
    const minX=n(b.minX)-r,maxX=n(b.maxX)+r;
    const minY=n(b.minY)-r,maxY=n(b.maxY)+r;
    const minZ=n(b.minZ)-r,maxZ=n(b.maxZ)+r;
    if(p.x<minX||p.x>maxX||p.y<minY||p.y>maxY||p.z<minZ||p.z>maxZ)return false;

    const dx=Math.min(p.x-minX,maxX-p.x);
    const dy=Math.min(p.y-minY,maxY-p.y);
    const dz=Math.min(p.z-minZ,maxZ-p.z);

    if(dx<=dy&&dx<=dz){
      p.x=(p.x-minX<maxX-p.x?minX-skin:maxX+skin);
    }else if(dy<=dx&&dy<=dz){
      p.y=(p.y-minY<maxY-p.y?minY-skin:maxY+skin);
    }else{
      p.z=(p.z-minZ<maxZ-p.z?minZ-skin:maxZ+skin);
    }
    return true;
  }

  function currentTopBlock(f){
    if(!f?.pos)return null;
    let best=null,bestGap=Infinity;
    for(const b of collidableBlocks||[]){
      if(!b)continue;
      const h=n(b.maxY)-n(b.minY);
      if(h<1.0)continue;
      if(f.pos.x<b.minX-.06||f.pos.x>b.maxX+.06||
         f.pos.z<b.minZ-.06||f.pos.z>b.maxZ+.06)continue;

      // Human center is near maxY; squid resting center is about maxY-0.35.
      const gapHuman=Math.abs(f.pos.y-n(b.maxY));
      const gapSquid=Math.abs((f.pos.y+.35)-n(b.maxY));
      const gap=Math.min(gapHuman,gapSquid);
      if(gap<bestGap&&gap<=.62){
        best=b;bestGap=gap;
      }
    }
    return best;
  }

  function paintedElevatedTop(f){
    const b=currentTopBlock(f);
    if(!b||n(b.maxY)<=.45)return null;
    try{
      if(typeof onFighterInk==='function'&&onFighterInk(f))return b;
    }catch(_){}
    return null;
  }

  function blockingOtherTop(b,x,z,y){
    const pad=.30;
    if(!b)return false;
    if(n(b.maxY)-n(b.minY)<1.3)return false;
    if(x<b.minX-pad||x>b.maxX+pad||z<b.minZ-pad||z>b.maxZ+pad)return false;
    if(y+.2>=n(b.maxY)-.15)return false;
    if(y+1.5<=n(b.minY))return false;
    return true;
  }

  function moveSquidAcrossPaintedTop(f,v,dt,support){
    const rawX=f.pos.x+n(v?.x)*dt;
    const rawZ=f.pos.z+n(v?.z)*dt;

    if(typeof marketPointInPolygon==='function'&&!marketPointInPolygon(rawX,rawZ)){
      const p=typeof clampStageXY==='function'?clampStageXY(rawX,rawZ):{x:rawX,z:rawZ};
      f.pos.x=p.x;f.pos.z=p.z;
      return false;
    }

    let nx=rawX,nz=rawZ;

    // The platform the player is standing on is NOT a wall.
    // Other blocks still block normally.
    for(const b of collidableBlocks||[]){
      if(!b||b===support)continue;
      if(blockingOtherTop(b,nx,f.pos.z,f.pos.y))nx=f.pos.x;
    }
    for(const b of collidableBlocks||[]){
      if(!b||b===support)continue;
      if(blockingOtherTop(b,f.pos.x,nz,f.pos.y))nz=f.pos.z;
    }

    // Keep the same stage border behavior.
    if(typeof clampStageXY==='function'){
      const p=clampStageXY(nx,nz);
      nx=p.x;nz=p.z;
    }

    f.pos.x=nx;
    f.pos.z=nz;

    // Explicitly cancel an accidental wall attachment created by older layers.
    f.__v89WallClimbing=false;
    f.__v89Wall=null;
    f.__v89WallFace=null;
    return false; // gravity/floor code below still owns Y movement.
  }

  // FINAL movement gate: painted elevated top has priority over wall climbing.
  if(typeof tryMoveWithCollision==='function'){
    const baseMove=tryMoveWithCollision;
    tryMoveWithCollision=function(f,v,dt,isSquid){
      if(isSquid&&f?.isPlayer){
        const support=paintedElevatedTop(f);
        if(support)return moveSquidAcrossPaintedTop(f,v,dt,support);
      }
      return baseMove(f,v,dt,isSquid);
    };
    window.tryMoveWithCollision=tryMoveWithCollision;
  }

  function clampCameraPosition(desired,anchor){
    const out=desired.clone();
    const blocks=Array.isArray(collidableBlocks)?collidableBlocks:[];
    const R=.42,SKIN=.14;

    // First intersection of the player->camera segment with any stage solid.
    let bestT=1,hit=false;
    for(const b of blocks){
      if(!b)continue;
      const min={x:n(b.minX)-R,y:n(b.minY)-R,z:n(b.minZ)-R};
      const max={x:n(b.maxX)+R,y:n(b.maxY)+R,z:n(b.maxZ)+R};
      const t=rayBoxEntry(anchor,out,min,max);
      if(t!==null&&t>0.0001&&t<bestT){
        bestT=t;
        hit=true;
      }
    }

    if(hit){
      const len=anchor.distanceTo(out);
      const back=Math.min(.24,SKIN/Math.max(.001,len));
      out.copy(anchor).lerp(out,Math.max(0,bestT-back));
    }

    // Never leave the camera inside a solid.
    for(let pass=0;pass<3;pass++){
      let moved=false;
      for(const b of blocks){
        if(b&&pushOutside(out,b,R,SKIN))moved=true;
      }
      if(!moved)break;
    }

    // Absolute floor/platform clearance.
    let support=-Infinity;
    for(const b of blocks){
      if(!b)continue;
      if(out.x>=n(b.minX)-R&&out.x<=n(b.maxX)+R&&
         out.z>=n(b.minZ)-R&&out.z<=n(b.maxZ)+R&&
         n(b.maxY)<=out.y+.05&&n(b.maxY)>support){
        support=n(b.maxY);
      }
    }
    out.y=Number.isFinite(support)?Math.max(out.y,support+.55):Math.max(out.y,.55);

    return out;
  }

  if(renderer&&typeof renderer.render==='function'){
    const originalRender=renderer.render.bind(renderer);

    renderer.render=function(sceneArg,cameraArg){
      try{
        if(cameraArg===camera&&(currentPhase===1.5||currentPhase===2)){
          if(playerFighter?.alive){
            const anchor=playerFighter.pos.clone();
            anchor.y+=1.5;

            // IMPORTANT: invert the old X-axis orbit sign.
            // Mouse up -> pitch increases -> camera moves upward -> view turns upward.
            const offset=new THREE.Vector3(1.5,1.5,n(cameraDistance,8));
            offset.applyAxisAngle(new THREE.Vector3(1,0,0),-pitch);
            offset.applyAxisAngle(new THREE.Vector3(0,1,0),yaw);

            const desired=anchor.clone().add(offset);
            cameraArg.position.copy(clampCameraPosition(desired,anchor));
            cameraArg.lookAt(anchor);
          }else if(typeof findSpectateTarget==='function'){
            const target=findSpectateTarget(playerFighter);
            if(target?.pos){
              const anchor=target.pos.clone();
              anchor.y+=1.0;
              cameraArg.position.copy(clampCameraPosition(cameraArg.position,anchor));
              cameraArg.lookAt(anchor);
            }
          }
        }
      }catch(_){
        // Camera safety must never interrupt rendering.
      }
      return originalRender(sceneArg,cameraArg);
    };
  }

  window.__V104_CLAMP_CAMERA=clampCameraPosition;
  window.__V104_BUILD=BUILD;
  window.__V104_TOP_INK_FIX=true;
  console.log('[SPLATOON ONLINE]['+BUILD+'] loaded');
})();
