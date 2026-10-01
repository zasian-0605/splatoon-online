/* V107: large always-available How To Play button / V108 full key guide.
   - A large, clearly visible button is shown during every gameplay phase.
   - The overlay contains every gameplay instruction currently shown in #instructions,
     plus the related lobby/practice shortcuts already used by the game.
   - Key/button labels are displayed as large keycaps so the controls are easy to scan.
   - Does not change gameplay controls; only replaces/expands the help UI.
*/
(function(){
  'use strict';
  const BUILD='V108-LARGE-HOWTO-FULL-KEY-GUIDE-2026-10-02';

  const style=document.createElement('style');
  style.textContent=String.raw`
    #v107-howto-button{
      position:fixed;
      top:58px;
      right:16px;
      z-index:240;
      display:none;
      min-width:190px;
      padding:14px 22px;
      border:3px solid #fff;
      border-radius:14px;
      background:#2f059c;
      color:#fff;
      font:900 20px/1 Arial Black,Arial,Meiryo,sans-serif;
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
      padding:20px;
      box-sizing:border-box;
      background:rgba(4,0,18,.90);
      pointer-events:auto;
    }
    #v107-howto-card{
      width:min(980px,95vw);
      max-height:90vh;
      overflow:auto;
      box-sizing:border-box;
      padding:28px;
      border:4px solid #fff;
      border-radius:22px;
      background:linear-gradient(180deg,#3508aa,#16052f);
      color:#fff;
      font-family:Arial,Meiryo,sans-serif;
      box-shadow:0 14px 40px rgba(0,0,0,.60);
    }
    #v107-howto-title{
      font:900 38px/1.1 Arial Black,Arial,Meiryo,sans-serif;
      text-align:center;
      margin:0 0 8px;
      text-shadow:3px 3px 0 #000;
    }
    #v107-howto-subtitle{
      text-align:center;
      color:#eee;
      font-size:15px;
      margin:0 0 20px;
    }
    #v107-howto-body{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:14px;
    }
    .v107-help-box{
      padding:16px;
      border:2px solid rgba(255,255,255,.62);
      border-radius:14px;
      background:rgba(0,0,0,.23);
    }
    .v107-help-box.full{
      grid-column:1 / -1;
    }
    .v107-help-box b{
      display:block;
      color:#e3ff00;
      font-size:20px;
      margin-bottom:9px;
    }
    .v107-help-row{
      display:flex;
      align-items:center;
      gap:10px;
      flex-wrap:wrap;
      margin:7px 0;
      font-size:17px;
      line-height:1.45;
    }
    .v107-key{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:42px;
      min-height:38px;
      padding:4px 10px;
      box-sizing:border-box;
      border:2px solid #fff;
      border-bottom-width:5px;
      border-radius:9px;
      background:#111;
      color:#fff;
      font:900 17px/1 Arial Black,Arial,Meiryo,sans-serif;
      box-shadow:0 2px 0 rgba(0,0,0,.5);
    }
    .v107-key.wide{min-width:102px;}
    .v107-mouse{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:108px;
      min-height:38px;
      padding:4px 10px;
      border:2px solid #fff;
      border-radius:9px;
      background:#101825;
      color:#e3ff00;
      font:900 16px/1 Arial,Meiryo,sans-serif;
    }
    .v107-note{
      color:#ddd;
      font-size:13px;
      line-height:1.5;
      margin-top:5px;
    }
    .v107-highlight{
      color:#e3ff00;
      font-weight:900;
    }
    #v107-howto-close{
      display:block;
      margin:20px auto 0;
      min-width:210px;
      padding:13px 24px;
      border:0;
      border-radius:12px;
      background:#e3ff00;
      color:#2f059c;
      font:900 19px/1 Arial Black,Arial,Meiryo,sans-serif;
      cursor:pointer;
      pointer-events:auto;
    }
    @media(max-width:700px){
      #v107-howto-button{
        top:10px;
        right:10px;
        min-width:150px;
        padding:11px 14px;
        font-size:17px;
      }
      #v107-howto-card{padding:18px;}
      #v107-howto-title{font-size:30px;}
      #v107-howto-body{grid-template-columns:1fr;}
      .v107-help-box.full{grid-column:auto;}
      .v107-help-row{font-size:15px;}
      .v107-key{min-width:38px;min-height:34px;font-size:15px;}
      .v107-mouse{min-width:95px;min-height:34px;font-size:14px;}
    }
  `;
  document.head.appendChild(style);

  const button=document.createElement('button');
  button.id='v107-howto-button';
  button.type='button';
  button.textContent='📖 遊び方・キー操作';
  document.body.appendChild(button);

  const overlay=document.createElement('div');
  overlay.id='v107-howto-overlay';
  overlay.innerHTML=`
    <div id="v107-howto-card" role="dialog" aria-modal="true" aria-label="遊び方・キー操作">
      <div id="v107-howto-title">📖 遊び方・キー操作</div>
      <div id="v107-howto-subtitle">試合中いつでもこのボタンから開けます。操作を忘れたときに見てください。</div>

      <div id="v107-howto-body">
        <div class="v107-help-box">
          <b>🎮 移動</b>
          <div class="v107-help-row">
            <span class="v107-key">W</span>
            <span class="v107-key">A</span>
            <span class="v107-key">S</span>
            <span class="v107-key">D</span>
            <span>移動</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-key wide">Space</span>
            <span>ジャンプ</span>
          </div>
        </div>

        <div class="v107-help-box">
          <b>🖱️ 視点・射撃</b>
          <div class="v107-help-row">
            <span class="v107-mouse">マウス</span>
            <span>視点操作</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-mouse">左クリック</span>
            <span>射撃</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-mouse">右クリック</span>
            <span>サブウェポン</span>
          </div>
          <div class="v107-note">※ イカ状態では射撃・サブは使いません。Shiftを離してヒトに戻ってから使います。</div>
        </div>

        <div class="v107-help-box">
          <b>🦑 イカ状態</b>
          <div class="v107-help-row">
            <span class="v107-key wide">Shift</span>
            <span>押している間だけイカ</span>
          </div>
          <div class="v107-note">Shiftを離すとヒトに戻ります。敵インクの上ではイカになれません。</div>
        </div>

        <div class="v107-help-box">
          <b>💣 サブウェポン</b>
          <div class="v107-help-row">
            <span class="v107-key">Q</span>
            <span>サブを使う</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-mouse">右クリック</span>
            <span>サブを使う</span>
          </div>
        </div>

        <div class="v107-help-box">
          <b>⭐ スペシャル</b>
          <div class="v107-help-row">
            <span class="v107-key">R</span>
            <span>スペシャルを発動</span>
          </div>
          <div class="v107-note">スペシャルゲージがたまっているときに使えます。</div>
        </div>

        <div class="v107-help-box">
          <b>🗺️ マップ・スーパージャンプ</b>
          <div class="v107-help-row">
            <span class="v107-key">M</span>
            <span>マップを開く</span>
          </div>
          <div class="v107-note">マップで味方を選ぶとスーパージャンプ。M または ESC でマップを閉じます。</div>
        </div>

        <div class="v107-help-box full">
          <b>🎯 試し撃ち場で使うキー</b>
          <div class="v107-help-row">
            <span class="v107-key">E</span>
            <span>カスタマイズに戻る</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-key">O</span>
            <span>CPU対戦（4 VS 4）へ</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-key">3</span>
            <span>オンラインへ</span>
          </div>
          <div class="v107-note">試し撃ち場では自由に移動・射撃できます。</div>
        </div>

        <div class="v107-help-box full">
          <b>🏹 チャージャー</b>
          <div class="v107-help-row">
            <span class="v107-mouse">左クリック長押し</span>
            <span>チャージ</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-mouse">離す</span>
            <span>発射</span>
          </div>
          <div class="v107-note">チャージ中は照準・チャージゲージを確認できます。</div>
        </div>

        <div class="v107-help-box full">
          <b>⚔️ 4 VS 4 Xマッチ風CPU戦</b>
          <div class="v107-help-row">
            <span class="v107-key wide">4 VS 4</span>
            <span>味方4人 vs 敵4人</span>
          </div>
          <div class="v107-note">前衛・中衛・後衛が連携して戦います。Shift：押している間だけイカ / Q：サブ / R：スペシャル。</div>
        </div>

        <div class="v107-help-box">
          <b>🏆 腕前・レート</b>
          <div class="v107-help-row">
            <span>試合結果で</span>
            <span class="v107-highlight">レート</span>
            <span>が更新されます。</span>
          </div>
          <div class="v107-note">ゲーム中にも現在の腕前・レート・勝敗・試合数を確認できます。</div>
        </div>

        <div class="v107-help-box">
          <b>📱 スマホ操作</b>
          <div class="v107-help-row">
            <span class="v107-mouse">左半分スワイプ</span>
            <span>移動</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-mouse">右半分スワイプ</span>
            <span>視点</span>
          </div>
          <div class="v107-help-row">
            <span class="v107-mouse">右半分タップ</span>
            <span>射撃</span>
          </div>
          <div class="v107-note">画面上の 🦑 / UP / ボム / SP / MAP / ナイス / カモン ボタンも使えます。</div>
        </div>

        <div class="v107-help-box full">
          <b>📝 いま画面に出ている操作説明を全部まとめると</b>
          <div class="v107-note" style="font-size:15px;color:#fff;">
            【PC】WASD：移動 / マウス：視点＆射撃 / 左クリック：射撃 / 右クリック：サブ / Shift：潜伏（イカ） / Space：ジャンプ / Q：サブ / R：スペシャル<br>
            チャージャー：左クリック長押しでチャージ、離すと発射<br>
            試し撃ち場：E＝カスタマイズ、O＝CPU対戦（4vs4）、3＝オンライン<br>
            【スマホ】左半分スワイプ＝移動 / 右半分スワイプ＝視点 / 右半分タップ＝射撃
          </div>
        </div>
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
    try{document.exitPointerLock?.();}catch(_){}
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

  window.__V108_OPEN_HOWTO=open;
  window.__V108_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] full key guide active');
})();
