/* V113: kid-friendly Radio / News screen
   - Large, obvious "タップして次へ" button.
   - Tapping anywhere in the radio dialog advances it.
   - Space / Enter remain supported.
*/
(function(){
  'use strict';
  if(window.__V113_RADIO_READY)return;
  window.__V113_RADIO_READY=true;

  const style=document.createElement('style');
  style.textContent =
    '#news-screen{touch-action:manipulation;}'+
    '#dialogue-box{cursor:pointer;}'+
    '#v113-radio-next{'+
      'position:absolute;left:50%;bottom:7vh;transform:translateX(-50%);z-index:120;'+
      'min-width:min(430px,82vw);padding:18px 28px;border:4px solid #fff;border-radius:18px;'+
      'background:#e3ff00;color:#2f059c;font:900 clamp(20px,4vw,34px)/1.05 Arial,Meiryo,sans-serif;'+
      'text-align:center;box-shadow:8px 8px 0 #000,0 0 24px rgba(227,255,0,.45);'+
      'cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation;}'+
    '#v113-radio-next:active{transform:translateX(-50%) translateY(5px) scale(.98);box-shadow:4px 4px 0 #000;}'+
    '#v113-radio-help{position:absolute;left:50%;bottom:2vh;transform:translateX(-50%);z-index:120;'+
      'color:#fff;font:900 clamp(13px,2.4vw,20px)/1.2 Arial,Meiryo,sans-serif;text-shadow:2px 2px 0 #000;'+
      'pointer-events:none;white-space:nowrap;}'+
    '@media(max-width:600px){'+
      '#v113-radio-next{bottom:10vh;min-width:78vw;padding:16px 18px;border-width:3px;}'+
      '#v113-radio-help{bottom:3vh;}'+
    '}';
  document.head.appendChild(style);

  function isRadio(){
    return typeof currentPhase!=='undefined' && currentPhase===1;
  }

  let button=null;
  let help=null;

  function ensure(){
    const screen=document.getElementById('news-screen');
    if(!screen)return false;
    if(!button){
      button=document.createElement('button');
      button.id='v113-radio-next';
      button.type='button';
      button.textContent='タップして次へ ▶';
      screen.appendChild(button);
      button.addEventListener('pointerdown',e=>{
        if(!isRadio())return;
        e.preventDefault();
        e.stopImmediatePropagation();
        try{showNextLine();}catch(err){console.warn('[V113 radio]',err);}
      },true);
      button.addEventListener('click',e=>{
        if(!isRadio())return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },true);
    }
    if(!help){
      help=document.createElement('div');
      help.id='v113-radio-help';
      help.textContent='ここをタップすると次へ進みます';
      screen.appendChild(help);
    }
    return true;
  }

  function refreshLabel(){
    ensure();
    if(!button)return;
    const typing=typeof isTyping!=='undefined' && !!isTyping;
    button.textContent=typing ? 'タップして文字を全部見る ▶' : 'タップして次へ ▶';
  }

  const baseStart=window.startNewsPhase;
  if(typeof baseStart==='function'){
    window.startNewsPhase=function(){
      const r=baseStart.apply(this,arguments);
      ensure();
      refreshLabel();
      return r;
    };
    try{startNewsPhase=window.startNewsPhase;}catch(_){}
  }

  const baseNext=window.showNextLine;
  if(typeof baseNext==='function'){
    window.showNextLine=function(){
      const r=baseNext.apply(this,arguments);
      setTimeout(refreshLabel,0);
      return r;
    };
    try{showNextLine=window.showNextLine;}catch(_){}
  }

  document.addEventListener('pointerdown',e=>{
    if(!isRadio()||!ensure())return;
    if(e.target.closest?.('#v113-radio-next'))return;
    const target=e.target.closest?.('#dialogue-box,#news-image-area,#news-screen');
    if(!target)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try{showNextLine();}catch(err){console.warn('[V113 radio tap]',err);}
    setTimeout(refreshLabel,0);
  },true);

  window.addEventListener('keydown',e=>{
    if(!isRadio())return;
    if(e.code!=='Space'&&e.code!=='Enter')return;
    setTimeout(refreshLabel,0);
  },true);

  setTimeout(()=>{ensure();refreshLabel();},0);
  window.__V113_RADIO_BUILD='V113-KID-FRIENDLY-NEXT-2026-10-02';
  console.log('[SPLATOON ONLINE][V113] radio UI ready');
})();
