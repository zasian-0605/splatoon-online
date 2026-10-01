/* V104: vertical aim + hard camera collision.
   - Battle camera never enters collidable stage blocks.
   - Camera stops at the blocking surface; player movement is untouched.
*/
(function(){
  'use strict';
  const BUILD='V104-VERTICAL-AIM-CAMERA-COLLISION-2026-10-02';

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

  function clampCameraPosition(desired,anchor){
    const out=desired.clone();
    const blocks=Array.isArray(collidableBlocks)?collidableBlocks:[];
    const R=.42;
    const SKIN=.14;

    // Stop at the first wall/platform hit between the player and the camera.
    let bestT=1;
    let hit=false;
    for(const b of blocks){
      if(!b)continue;
      const min={x:n(b.minX)-R,y:n(b.minY)-R,z:n(b.minZ)-R};
      const max={x:n(b.maxX)+R,y:n(b.maxY)+R,z:n(b.maxZ)+R};
      const t=rayBoxEntry(anchor,out,min,max);
      if(t!==null&&t>0.0005&&t<bestT){
        bestT=t;
        hit=true;
      }
    }

    if(hit){
      const len=anchor.distanceTo(out);
      const back=Math.min(.20,SKIN/Math.max(.001,len));
      const safeT=Math.max(0,bestT-back);
      out.copy(anchor).lerp(out,safeT);
    }

    // Final penetration guard.
    for(let pass=0;pass<2;pass++){
      let moved=false;
      for(const b of blocks){
        if(!b)continue;
        if(pushOutside(out,b,R,SKIN))moved=true;
      }
      if(!moved)break;
    }

    // Extra floor/platform clearance.
    let support=-Infinity;
    for(const b of blocks){
      if(!b)continue;
      if(out.x>=n(b.minX)-R&&out.x<=n(b.maxX)+R&&
         out.z>=n(b.minZ)-R&&out.z<=n(b.maxZ)+R&&
         n(b.maxY)<=out.y+.1&&n(b.maxY)>support){
        support=n(b.maxY);
      }
    }
    if(Number.isFinite(support))out.y=Math.max(out.y,support+.55);
    else out.y=Math.max(out.y,.55);

    return out;
  }

  function protectBattleCamera(cam,anchor){
    if(!cam||!anchor)return;
    try{cam.position.copy(clampCameraPosition(cam.position,anchor));}catch(_){}
  }

  if(renderer&&typeof renderer.render==='function'){
    const originalRender=renderer.render.bind(renderer);

    renderer.render=function(sceneArg,cameraArg){
      try{
        if(cameraArg===camera&&(currentPhase===1.5||currentPhase===2)){
          if(playerFighter?.alive){
            // Preserve the existing yaw/pitch/camera-distance controls.
            // This only changes the camera position when a solid is in the way.
            const anchor=playerFighter.pos.clone();
            anchor.y+=1.5;

            const offset=new THREE.Vector3(1.5,1.5,n(cameraDistance,8));
            offset.applyAxisAngle(new THREE.Vector3(1,0,0),pitch);
            offset.applyAxisAngle(new THREE.Vector3(0,1,0),yaw);

            const desired=anchor.clone().add(offset);
            cameraArg.position.copy(clampCameraPosition(desired,anchor));
            cameraArg.lookAt(anchor);
          }else{
            const target=(typeof findSpectateTarget==='function')?findSpectateTarget(playerFighter):null;
            if(target?.pos){
              const anchor=target.pos.clone();
              anchor.y+=1.0;
              protectBattleCamera(cameraArg,anchor);
            }
          }
        }
      }catch(err){
        // Camera protection must never stop the game renderer.
      }

      return originalRender(sceneArg,cameraArg);
    };
  }

  window.__V104_CLAMP_CAMERA=clampCameraPosition;
  window.__V104_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] loaded');
})();
