/* V110 PAINT SYNC
   Keeps ink visuals attached to moving stage parts.
   This module contains only generic scene/paint synchronization.
*/
(function(){
  'use strict';
  if(window.__V110_PAINT_SYNC)return;
  window.__V110_PAINT_SYNC=true;

  function num(v,d=0){
    return Number.isFinite(Number(v))?Number(v):d;
  }

  function getLiftBlocks(){
    const out=[];
    for(const g of (window.__marketStageGimmicks||[])){
      if(g?.type==='lift' && g.block?.mesh?.visible!==false && g.block.mesh)out.push(g.block);
    }
    return out;
  }

  function isPaintMesh(o){
    return !!o?.userData?.__v108 && o.isObject3D;
  }

  function adoptPaintMesh(mesh,block){
    if(!mesh||!block?.mesh)return false;
    if(mesh.parent===block.mesh){
      mesh.userData.__v110PaintAnchor=block;
      return true;
    }
    const world=mesh.getWorldPosition(new THREE.Vector3());
    block.mesh.updateWorldMatrix?.(true,false);
    const local=block.mesh.worldToLocal(world);
    block.mesh.add(mesh);
    mesh.position.copy(local);
    mesh.userData.__v110PaintAnchor=block;
    return true;
  }

  function scanPaintMeshes(){
    const lifts=getLiftBlocks();
    if(!lifts.length)return;
    const candidates=[];
    scene.traverse(o=>{if(isPaintMesh(o))candidates.push(o);});
    for(const mesh of candidates){
      if(mesh.userData.__v110PaintAnchor?.mesh){
        const b=mesh.userData.__v110PaintAnchor;
        if(b===lifts.find(x=>x===b))continue;
      }
      const world=mesh.getWorldPosition(new THREE.Vector3());
      for(const block of lifts){
        if(world.x<block.minX-.25||world.x>block.maxX+.25||world.z<block.minZ-.25||world.z>block.maxZ+.25)continue;
        if(Math.abs(world.y-block.maxY)>3.6 && Math.abs(world.y-block.minY)>3.6)continue;
        if(adoptPaintMesh(mesh,block))break;
      }
    }
  }

  let last=0;
  function tick(t){
    if(t-last>120){last=t;try{scanPaintMeshes();}catch(_){}}
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  console.log('[SPLATOON ONLINE][V110] moving-platform paint sync active');
})();
