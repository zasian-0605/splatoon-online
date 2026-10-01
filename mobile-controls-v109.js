/* V109: robust mobile controls + U key How To Play.
   - U always opens the How To Play overlay during gameplay.
   - How To Play also opens on pointerdown, which works better with touch/pointer-lock browsers.
   - Mobile gets a real on-screen joystick with pointer events.
   - Mobile gets a dedicated right-side look/shoot pad.
   - Action buttons work with pointer events and are protected against duplicate touch/mouse firing.
   - Existing gameplay functions/keys are not changed for PC.
*/
(function(){
  'use strict';
  const BUILD='V109-MOBILE-CONTROLS-U-HOWTO-2026-10-02';

  const style=document.createElement('style');
  style.textContent=String.raw`
    #v109-look-pad{
      display:none;
      position:absolute;
      top:0;
      right:0;
      width:58%;
      height:100%;
      z-index:16;
      pointer-events:auto;
      touch-action:none;
      background:transparent;
      user-select:none;
      -webkit-user-select:none;
    }
    #v109-look-pad::after{
      content:'視点 ← スワイプ →';
      position:absolute;
      top:50%;
      right:8%;
      transform:translateY(-50%);
      padding:7px 11px;
      border:2px solid rgba(255,255,255,.35);
      border-radius:10px;
      background:rgba(0,0,0,.18);
      color:rgba(255,255,255,.55);
      font:800 12px Arial,Meiryo,sans-serif;
      pointer-events:none;
    }
    #v109-mobile-hint{
      display:none;
      position:absolute;
      left:50%;
      bottom:12px;
      transform:translateX(-50%);
      z-index:17;
      padding:6px 10px;
      border-radius:10px;
      background:rgba(0,0,0,.42);
      color:#fff;
      font:800 11px Arial,Meiryo,sans-serif;
      pointer-events:none;
      white-space:nowrap;
      text-shadow:1px 1px 2px #000;
    }
    #joystick-area{
      touch-action:none !important;
      user-select:none !important;
      -webkit-user-select:none !important;
    }
    #joystick-knob{
      transition:transform .03s linear;
    }
    .mobile-btn{z-index:25 !important;}\n    @media(max-width:800px){
      #v109-mobile-hint{display:none;}
      #v107-howto-button{touch-action:none !important;}
    }
  `;
  document.head.appendChild(style);

  const battle=()=>typeof currentPhase!=='undefined'&&(currentPhase===1.5||currentPhase===2);
  const howto=()=>window.__V108_OPEN_HOWTO||window.__V107_OPEN_HOWTO;

  /* ---------- How To Play: reliable U key + pointer/touch activation ---------- */
  function openHowTo(){
    if(!battle()) return false;
    const overlay=document.getElementById('v107-howto-overlay');
    if(overlay && overlay.style.display==='flex'){
      overlay.style.display='none';
      return true;
    }
    const fn=howto();
    if(typeof fn!=='function') return false;
    try{ document.exitPointerLock?.(); }catch(_){}
    try{ fn(); }catch(_){ return false; }
    return true;
  }

  document.addEventListener('keydown',e=>{
    if(e.code!=='KeyU'||!battle()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openHowTo();
  },true);

  const howtoBtn=document.getElementById('v107-howto-button');
  if(howtoBtn){
    howtoBtn.addEventListener('pointerdown',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      openHowTo();
    },true);
    howtoBtn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      openHowTo();
    },true);
  }

  /* ---------- Mobile overlay controls ---------- */
  const ensureMobileOverlay=()=>{
    if(document.getElementById('v109-look-pad')) return;
    const battleUi=document.getElementById('battle-ui');
    if(!battleUi) return;

    const look=document.createElement('div');
    look.id='v109-look-pad';
    look.setAttribute('aria-label','スマホ視点・射撃エリア');
    battleUi.appendChild(look);

    const hint=document.createElement('div');
    hint.id='v109-mobile-hint';
    hint.textContent='左：移動　｜　右：視点・射撃　｜　ボタン：アクション';
    battleUi.appendChild(hint);
  };
  ensureMobileOverlay();

  const isMobile=()=>typeof playerConfig!=='undefined'&&playerConfig.device==='mobile';

  const leftZone=document.getElementById('joystick-area');
  const knob=document.getElementById('joystick-knob');
  const lookPad=document.getElementById('v109-look-pad');

  let joyId=null;
  let joyCx=0,joyCy=0;
  const joyMax=50;

  function resetJoy(){
    joyId=null;
    if(knob){
      knob.style.display='none';
      knob.style.transform='translate(-50%,-50%)';
    }
    if(typeof keys!=='undefined'){
      keys.w=keys.a=keys.s=keys.d=false;
    }
  }

  function updateJoy(clientX,clientY){
    let dx=clientX-joyCx;
    let dy=clientY-joyCy;
    const len=Math.hypot(dx,dy);
    if(len>joyMax){
      dx=dx/len*joyMax;
      dy=dy/len*joyMax;
    }
    if(knob){
      knob.style.display='block';
      knob.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
    }

    const dead=9;
    if(typeof keys!=='undefined'){
      keys.a=dx < -dead;
      keys.d=dx > dead;
      keys.w=dy < -dead;
      keys.s=dy > dead;
    }
  }

  if(leftZone){
    leftZone.style.pointerEvents='auto';
    leftZone.style.zIndex='18';

    leftZone.addEventListener('pointerdown',e=>{
      if(!isMobile()||!battle()) return;
      if(joyId!==null) return;
      e.preventDefault();
      e.stopPropagation();
      joyId=e.pointerId;
      const r=leftZone.getBoundingClientRect();
      joyCx=r.left+r.width/2;
      joyCy=r.top+r.height/2;
      try{leftZone.setPointerCapture(e.pointerId);}catch(_){}
      updateJoy(e.clientX,e.clientY);
    },true);

    leftZone.addEventListener('pointermove',e=>{
      if(e.pointerId!==joyId) return;
      e.preventDefault();
      e.stopPropagation();
      updateJoy(e.clientX,e.clientY);
    },true);

    const endJoy=e=>{
      if(e.pointerId!==joyId) return;
      e.preventDefault();
      e.stopPropagation();
      try{leftZone.releasePointerCapture(e.pointerId);}catch(_){}
      resetJoy();
    };
    leftZone.addEventListener('pointerup',endJoy,true);
    leftZone.addEventListener('pointercancel',endJoy,true);
    leftZone.addEventListener('lostpointercapture',()=>resetJoy(),true);
  }

  function aimFromCamera(){
    const d=new THREE.Vector3();
    camera.getWorldDirection(d);
    return d;
  }

  let lookId=null,lastLX=0,lastLY=0;
  if(lookPad){
    lookPad.addEventListener('pointerdown',e=>{
      if(!isMobile()||!battle()) return;
      if(e.target.closest?.('.mobile-btn')) return;
      e.preventDefault();
      e.stopPropagation();
      lookId=e.pointerId;
      lastLX=e.clientX;
      lastLY=e.clientY;
      try{lookPad.setPointerCapture(e.pointerId);}catch(_){}

      const f=playerFighter;
      if(f?.alive&&f.weapon?.category!=='charger'&&f.weapon?.category!=='spinner'&&f.weapon?.category!=='wiper'){
        isShooting=true;
      }else if(f?.alive&&f.weapon?.category==='charger'){
        f.isCharging=true;
        f.chargeStart=performance.now();
        const g=document.getElementById('charge-gauge'); if(g)g.style.display='block';
      }
    },true);

    lookPad.addEventListener('pointermove',e=>{
      if(e.pointerId!==lookId) return;
      e.preventDefault();
      e.stopPropagation();
      const dx=e.clientX-lastLX;
      const dy=e.clientY-lastLY;
      if(typeof yaw==='number') yaw-=dx*0.005;
      if(typeof pitch==='number'){
        pitch-=dy*0.005;
        pitch=Math.max(-Math.PI/2.5,Math.min(Math.PI/3,pitch));
      }
      lastLX=e.clientX;
      lastLY=e.clientY;
    },true);

    const endLook=e=>{
      if(e.pointerId!==lookId) return;
      e.preventDefault();
      e.stopPropagation();
      try{lookPad.releasePointerCapture(e.pointerId);}catch(_){}
      const f=playerFighter;
      if(f?.alive&&f.weapon?.category==='charger'&&f.isCharging){
        const frac=Math.min(1,(performance.now()-f.chargeStart)/(f.weapon.chargeTime||800));
        if(frac>0.08){
          try{fireChargerShot(f,aimFromCamera(),frac);}catch(_){}
        }
        f.isCharging=false;
        const g=document.getElementById('charge-gauge'); if(g)g.style.display='none';
      }
      if(f?.alive&&(f.weapon?.category==='spinner'||f.weapon?.category==='wiper')){
        /* Their established V60 touch handlers remain responsible for charge/release. */
      }
      isShooting=false;
      lookId=null;
    };
    lookPad.addEventListener('pointerup',endLook,true);
    lookPad.addEventListener('pointercancel',endLook,true);
  }

  /* ---------- Mobile action buttons ---------- */
  const actionLocks=new Map();
  const once=(key,fn)=>{
    const n=performance.now();
    const prev=actionLocks.get(key)||0;
    if(n-prev<180) return;
    actionLocks.set(key,n);
    try{fn();}catch(err){console.warn('[V109 mobile]',key,err);}
  };

  function bindButton(id,down,up){
    const el=document.getElementById(id);
    if(!el) return;
    el.style.touchAction='none';
    el.style.userSelect='none';
    el.style.webkitUserSelect='none';

    el.addEventListener('pointerdown',e=>{
      if(!isMobile()||!battle()) return;
      e.preventDefault();
      e.stopPropagation();
      try{el.setPointerCapture(e.pointerId);}catch(_){}
      down?.(e);
    },true);

    const end=e=>{
      if(!isMobile()) return;
      e.preventDefault();
      e.stopPropagation();
      up?.(e);
    };
    el.addEventListener('pointerup',end,true);
    el.addEventListener('pointercancel',end,true);
  }

  bindButton('btn-squid',
    ()=>{ keys.shift=true; },
    ()=>{ keys.shift=false; }
  );
  bindButton('btn-jump',
    ()=>{ once('jump',()=>{keys.space=true;}); },
    ()=>{ keys.space=false; }
  );
  bindButton('btn-sub',
    ()=>once('sub',()=>doPlayerSubThrow()),
    null
  );
  bindButton('btn-special',
    ()=>once('special',()=>fireSpecial(playerFighter)),
    null
  );
  bindButton('btn-map',
    ()=>once('map',()=>{
      const fn=window.__V10?.showMaps;
      if(typeof fn==='function') fn();
      else document.getElementById('fullmap').style.display='flex';
    }),
    null
  );
  bindButton('btn-nice',
    ()=>once('nice',()=>window.sendCallout?.('nice')),
    null
  );
  bindButton('btn-cmon',
    ()=>once('cmon',()=>window.sendCallout?.('cmon')),
    null
  );

  /* Block the older button touch/click handlers and handle each mobile button once.
     This prevents one tap from firing two subs/specials/callouts on touch browsers. */
  function mobileButtonAction(id){
    switch(id){
      case 'btn-sub': once('sub-touch',()=>doPlayerSubThrow()); break;
      case 'btn-special': once('special-touch',()=>fireSpecial(playerFighter)); break;
      case 'btn-map': once('map-touch',()=>{
        const fn=window.__V10?.showMaps;
        if(typeof fn==='function') fn();
        else { const full=document.getElementById('fullmap'); if(full) full.style.display='flex'; }
      }); break;
      case 'btn-nice': once('nice-touch',()=>window.sendCallout?.('nice')); break;
      case 'btn-cmon': once('cmon-touch',()=>window.sendCallout?.('cmon')); break;
    }
  }

  document.addEventListener('touchstart',e=>{
    if(!isMobile()||!battle()) return;
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-squid') keys.shift=true;
    else if(el.id==='btn-jump') keys.space=true;
    else mobileButtonAction(el.id);
  },true);

  document.addEventListener('touchend',e=>{
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-squid') keys.shift=false;
    if(el.id==='btn-jump') keys.space=false;
  },true);

  document.addEventListener('touchcancel',e=>{
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-squid') keys.shift=false;
    if(el.id==='btn-jump') keys.space=false;
  },true);

  document.addEventListener('click',e=>{
    if(!isMobile()||!battle()) return;
    const el=e.target.closest?.('.mobile-btn');
    if(!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(el.id==='btn-sub') once('sub-click',()=>doPlayerSubThrow());
    else if(el.id==='btn-special') once('special-click',()=>fireSpecial(playerFighter));
    else if(el.id==='btn-map') once('map-click',()=>{
      const fn=window.__V10?.showMaps;
      if(typeof fn==='function') fn();
      else { const full=document.getElementById('fullmap'); if(full) full.style.display='flex'; }
    });
    else if(el.id==='btn-nice') once('nice-click',()=>window.sendCallout?.('nice'));
    else if(el.id==='btn-cmon') once('cmon-click',()=>window.sendCallout?.('cmon'));
  },true);

  /* Stop browser long-press context menus/scrolling on all mobile controls. */
  document.addEventListener('contextmenu',e=>{
    if(!isMobile()) return;
    if(e.target.closest?.('#battle-ui,.mobile-btn,#joystick-area,#v109-look-pad')){
      e.preventDefault();
    }
  },true);

  document.addEventListener('touchmove',e=>{
    if(!isMobile()||!battle()) return;
    if(e.target.closest?.('#battle-ui,#joystick-area,#v109-look-pad')){
      e.preventDefault();
    }
  },{passive:false,capture:true});

  function syncMobileUI(){
    const mobile=isMobile();
    const inGame=battle();
    if(lookPad){
      lookPad.style.display=(mobile&&inGame)?'block':'none';
      lookPad.style.pointerEvents=(mobile&&inGame)?'auto':'none';
    }
    if(leftZone){
      leftZone.style.display=(mobile&&inGame)?'block':'none';
      leftZone.style.pointerEvents=(mobile&&inGame)?'auto':'none';
      leftZone.style.zIndex='18';
    }
    const hint=document.getElementById('v109-mobile-hint');
    if(hint) hint.style.display=(mobile&&inGame)?'block':'none';

    ['btn-squid','btn-jump','btn-sub','btn-special','btn-map','btn-nice','btn-cmon'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el)return;
      /* Existing CSS positions these buttons; this only controls visibility. */
      if(inGame&&mobile) el.style.display='flex';
      else el.style.display='none';
    });
  }
  setInterval(syncMobileUI,150);
  syncMobileUI();

  window.__V109_OPEN_HOWTO=openHowTo;
  window.__V109_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] mobile controls + U How To Play active');
})();
