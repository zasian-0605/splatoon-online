/* V107: large always-available How To Play button.
   - A clearly visible button is shown during gameplay.
   - Clicking it opens a large readable tutorial overlay every time.
   - Does not change keyboard/mouse controls; only adds help UI.
*/
(function(){
  'use strict';
  const BUILD='V107-LARGE-HOWTO-ALWAYS-AVAILABLE-2026-10-02';

  const style=document.createElement('style');
  style.textContent=String.raw`
    #v107-howto-button{
      position:fixed;
      top:58px;
      right:16px;
      z-index:240;
      display:none;
      min-width:150px;
      padding:13px 20px;
      border:3px solid #fff;
      border-radius:14px;
      background:#2f059c;
      color:#fff;
      font:900 19px/1 Arial,Meiryo,sans-serif;
      text-shadow:2px 2px 0 #000;
      box-shadow:0 5px 0 rgba(0,0,0,.45),0 0 18px rgba(227,255,0,.35);
      cursor:pointer;
      pointer-events:auto;
      touch-action:manipulation;
    }
    #v107-howto-button:active{
      transform:translateY(3px);
      box-shadow:0 2px 0 rgba(0,0,0,.45),0 0 12px rgba(227,255,0,.35);
    }
    #v107-howto-overlay{
      position:fixed;
      inset:0;
      z-index:260;
      display:none;
      align-items:center;
      justify-content:center;
      padding:24px;
      box-sizing:border-box;
      background:rgba(4,0,18,.88);
      pointer-events:auto;
    }
    #v107-howto-card{
      width:min(760px,92vw);
      max-height:86vh;
      overflow:auto;
      box-sizing:border-box;
      padding:24px;
      border:4px solid #fff;
      border-radius:20px;
      background:linear-gradient(180deg,#2f059c,#16052f);
      color:#fff;
      font-family:Arial,Meiryo,sans-serif;
      box-shadow:0 14px 40px rgba(0,0,0,.55);
    }
    #v107-howto-title{
      font:900 32px/1.1 Arial Black,Meiryo,sans-serif;
      text-align:center;
      margin-bottom:16px;
      text-shadow:3px 3px 0 #000;
    }
    #v107-howto-body{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:12px;
      font-size:16px;
      line-height:1.55;
    }
    .v107-help-box{
      padding:14px;
      border:2px solid rgba(255,255,255,.55);
      border-radius:12px;
      background:rgba(0,0,0,.23);
    }
    .v107-help-box b{
      display:block;
      color:#e3ff00;
      font-size:18px;
      margin-bottom:5px;
    }
    #v107-howto-close{
      display:block;
      margin:18px auto 0;
      min-width:190px;
      padding:12px 22px;
      border:0;
      border-radius:12px;
      background:#e3ff00;
      color:#2f059c;
      font:900 18px/1 Arial,Meiryo,sans-serif;
      cursor:pointer;
      pointer-events:auto;
    }
    @media(max-width:700px){
      #v107-howto-button{
        top:10px;
        right:10px;
        min-width:128px;
        padding:11px 14px;
        font-size:16px;
      }
      #v107-howto-card{padding:18px;}
      #v107-howto-title{font-size:27px;}
      #v107-howto-body{grid-template-columns:1fr;font-size:15px;}
    }
  `;
  document.head.appendChild(style);

  const button=document.createElement('button');
  button.id='v107-howto-button';
  button.type='button';
  button.textContent='📖 遊び方';
  document.body.appendChild(button);

  const overlay=document.createElement('div');
  overlay.id='v107-howto-overlay';
  overlay.innerHTML=`
    <div id="v107-howto-card" role="dialog" aria-modal="true" aria-label="遊び方">
      <div id="v107-howto-title">📖 遊び方</div>
      <div id="v107-howto-body">
        <div class="v107-help-box"><b>🎮 移動</b>WASD：移動<br>Space：ジャンプ</div>
        <div class="v107-help-box"><b>🖱️ 視点・攻撃</b>マウス：視点操作<br>左クリック：射撃</div>
        <div class="v107-help-box"><b>🦑 イカ</b>Shiftを押している間だけイカ状態。離すとヒトに戻ります。</div>
        <div class="v107-help-box"><b>💣 サブ</b>Q：サブウェポン<br>右クリック：サブ</div>
        <div class="v107-help-box"><b>⭐ スペシャル</b>R：スペシャル</div>
        <div class="v107-help-box"><b>🗺️ マップ</b>M：マップを開く<br>味方を選ぶとスーパージャンプ</div>
        <div class="v107-help-box"><b>⚔️ CPU戦</b>4 VS 4。味方CPUと一緒に戦います。</div>
        <div class="v107-help-box"><b>🏆 腕前</b>試合結果でレートが更新され、ゲーム中にも現在の腕前を確認できます。</div>
      </div>
      <button id="v107-howto-close" type="button">閉じる</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const close=()=>{
    overlay.style.display='none';
    try{window.requestPointerLockBack?.();}catch(_){}
  };
  const open=()=>{
    try{window.__V10?.releaseLock?.();}catch(_){}
    overlay.style.display='flex';
  };

  button.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  overlay.addEventListener('click',e=>{
    if(e.target===overlay)close();
  });
  document.getElementById('v107-howto-close').addEventListener('click',close);
  window.addEventListener('keydown',e=>{
    if(e.code==='Escape'&&overlay.style.display==='flex')close();
  },true);

  function sync(){
    const inGame=(typeof currentPhase!=='undefined')&&(currentPhase===1.5||currentPhase===2);
    button.style.display=inGame?'block':'none';
    if(!inGame)overlay.style.display='none';
  }
  setInterval(sync,150);
  sync();

  window.__V107_OPEN_HOWTO=open;
  window.__V107_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] large how-to button active');
})();
