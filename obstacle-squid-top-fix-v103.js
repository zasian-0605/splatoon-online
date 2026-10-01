/* V103: hard stop for squid wall-attachment when standing on an elevated obstacle.
   Keeps existing WASD/Shift controls unchanged.
   The squid pose sits about 0.35 below the collision support height, so the
   older 0.25/0.32 top checks could miss the platform and let wall-climb logic
   attach to a neighboring cliff. This final wrapper is deliberately loaded
   after the legacy movement layers so it is the last collision gate. */
(function(){
  'use strict';
  const BUILD='V103-SQUID-OBSTACLE-TOP-SAFETY-2026-10-01';
  const previous = window.tryMoveWithCollision || (typeof tryMoveWithCollision==='function' ? tryMoveWithCollision : null);
  if(!previous){
    console.warn('[SPLATOON ONLINE]['+BUILD+'] tryMoveWithCollision not available');
    return;
  }

  function num(v,d=0){
    const n=Number(v);
    return Number.isFinite(n)?n:d;
  }

  function supportTopY(x,z,hintY){
    try{
      const y=num(hintY,0);
      return num(getSupportHeight(x,z,y+3),0);
    }catch(_){
      return 0;
    }
  }

  function standingOnElevatedObstacle(f,x,z){
    if(!f?.pos || typeof getSupportHeight!=='function')return false;
    const sy=supportTopY(x,z,f.pos.y);
    if(!(sy>0.45))return false; // do not classify the main ground as an obstacle

    // Human standing: f.y ~= supportY
    // Squid resting pose: f.y ~= supportY - 0.35
    const humanGap=Math.abs(f.pos.y-sy);
    const squidGap=Math.abs((f.pos.y+0.35)-sy);
    return humanGap<=0.55 || squidGap<=0.55;
  }

  window.tryMoveWithCollision=function(f,v,dt,isSquid){
    if(isSquid && f?.isPlayer){
      const vx=num(v?.x), vz=num(v?.z), d=num(dt);
      const nx=f.pos.x+vx*d, nz=f.pos.z+vz*d;
      if(standingOnElevatedObstacle(f,f.pos.x,f.pos.z) ||
         standingOnElevatedObstacle(f,nx,nz)){
        // Being on a platform top must never inherit wall-climb attachment.
        if(f.__v89WallClimbing){
          f.__v89WallClimbing=false;
          f.__v89Wall=null;
          f.__v89WallFace=null;
        }
        return previous(f,v,d,false);
      }
    }
    return previous(f,v,dt,isSquid);
  };

  window.__V103_SQUID_OBSTACLE_TOP_FIX=true;
  window.__V103_SQUID_OBSTACLE_TOP_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] loaded');
})();
