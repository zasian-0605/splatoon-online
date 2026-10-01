/* V104: vertical aim + hard camera collision.
   - Restores vertical aim by fixing the V79 local aim() implementation in index.html.
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
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  function rayBoxEntry(a,b,min,max){
    const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z};
    let t0=0,t1=1;
    for(const k of ['x','y','z']){
      const av=a[k], dv=d[k];
      if(Math.abs(dv)<1e-8){
        if(av<min[k]||av>max[k]) return null;
        continue;
      }
      let q0=(min[k]-av)/dv, q1=(max[k]-av)/dv;
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
    const blocks=Array.isArray(window.collidableBlocks)?window.collidableBlocks:[];
    const R=.42, SKIN=.14;

    // Stop the camera on the first solid stage surface along its path.
    let bestT=1;
    let hit=false;
    for(const b of blocks){
      if(!b)continue;
      const min={x:n(b.minX)-R,y:n(b.minY)-R,z:n(b.minZ)-R};
      const max={x:n(b.maxX)+R,y:n(b.maxY)+R,z:n(b.maxZ)+R};
      const t=rayBoxEntry(anchor,out,min,max);
      if(t!==null && t>0.0005 && t<bestT){
        bestT=t;
        hit=true;
      }
    }
    if(hit){
      const len=anchor.distanceTo(out);
      const back=Math.min(.20,(SKIN/Math.max(.001,len)));
      const safeT=Math.max(0,bestT-back);
      out.copy(anchor).lerp(out,safeT);
    }

    // Absolute final safety: never leave the camera inside a solid block.
    for(let pass=0;pass<2;pass++){
      let moved=false;
      for(const b of blocks){
        if(!b)continue;
        if(pushOutside(out,b,R,SKIN))moved=true;
      }
      if(!moved)break;
    }

    // Ground / platform safety: keep a small gap from the highest support.
    let support=-Infinity;
    for(const b of blocks){
      if(!b)continue;
      if(out.x>=n(b.minX)-R && out.x<=n(b.maxX)+R &&
         out.z>=n(b.minZ)-R && out.z<=n(b.maxZ)+R &&
         n(b.maxY)<=out.y+.1 && n(b.maxY)>support){
        support=n(b.maxY);
      }
    }
    if(Number.isFinite(support))out.y=Math.max(out.y,support+.55);
    else out.y=Math.max(out.y,.55);

    return out;
  }

  function applyBattleCamera(cam){
    if(!cam||!window.playerFighter||!window.THREE)return;
    if(window.currentPhase!==1.5 && window.currentPhase!==2)return;
    const f=window.playerFighter;
    if(!f?.alive)return;

    // Same camera controls as before; only the collision handling is added.
    const anchor=f.pos.clone();
    anchor.y+=1.5;

    const offset=new THREE.Vector3(1.5,1.5,n(window.cameraDistance,8));
    offset.applyAxisAngle(new THREE.Vector3(1,0,0),n(window.pitch,-.2));
    offset.applyAxisAngle(new THREE.Vector3(0,1,0),n(window.yaw,0));

    const desired=anchor.clone().add(offset);
    const safe=clampCameraPosition(desired,anchor);
    cam.position.copy(safe);
    cam.lookAt(anchor);
  }

  // Because the original state variables are lexical in index.html, the camera
  // is reconstructed from their live values exposed by a tiny bridge below.
  // If the bridge is unavailable, the existing camera is still protected.
  const originalRender=window.renderer?.render?.bind(window.renderer);
  if(originalRender){
    window.renderer.render=function(sceneArg,cameraArg){
      try{applyBattleCamera(cameraArg);}catch(_){}
      return originalRender(sceneArg,cameraArg);
    };
  }

  // Expose a safe function for the inline bridge.
  window.__V104_CLAMP_CAMERA=clampCameraPosition;
  window.__V104_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] loaded');
})();
