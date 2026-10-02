/* V114: simple kid-friendly UX */
(function(){
'use strict';
const s=document.createElement('style');
s.textContent=`
#next-prompt{display:none !important;}
#dialogue-box{cursor:pointer !important;}
#v113-radio-next{min-width:min(520px,88vw) !important;padding:20px 28px !important;font-size:clamp(24px,5vw,38px) !important;}
#v113-radio-help{font-size:clamp(14px,3vw,20px) !important;}
#v114-practice-title{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:230;display:none;min-width:min(520px,86vw);box-sizing:border-box;padding:10px 30px 13px;border:5px solid #fff;border-radius:18px;background:#2f059c;color:#e3ff00;font:900 clamp(36px,6vw,64px)/1 Arial Black,Arial,Meiryo,sans-serif;text-align:center;text-shadow:4px 4px 0 #000;box-shadow:0 7px 0 rgba(0,0,0,.45),0 0 25px rgba(227,255,0,.35);pointer-events:none;}
#range-hint{font-size:clamp(15px,2.5vw,22px) !important;line-height:1.35 !important;}
#v107-howto-card{width:min(900px,94vw) !important;max-height:88vh !important;padding:22px !important;}
#v107-howto-title{font-size:clamp(30px,5vw,44px) !important;}
#v107-howto-subtitle{font-size:clamp(16px,2.8vw,21px) !important;color:#fff !important;}
@media(max-width:700px){#v114-practice-title{top:8px;border-width:3px;padding:8px 18px 10px;}}
`;
document.head.appendChild(s);
const title=document.createElement('div');
title.id='v114-practice-title';
title.textContent='🎯 試し撃ち場';
document.body.appendChild(title);
let shown=false,wasPractice=false;
function phase(){try{return Number(currentPhase)}catch(_){return -1}}
function sync(){
 const p=phase(),practice=p===1.5,playable=practice||p===2;
 title.style.display=practice?'block':'none';
 const hint=document.getElementById('range-hint');
 const inst=document.getElementById('instructions');
 const life=document.getElementById('alive-count');
 const teamHud=document.getElementById('v67-team-hud');
 if(practice&&hint)hint.innerHTML='🎯 試し撃ち場<br>好きなブキを自由に試そう！';
 if(practice&&inst)inst.innerHTML='WASD：うごく　Space：ジャンプ　Shift：イカ　左クリック：撃つ　Q：ボム　R：スペシャル';
 if(p===2&&inst)inst.innerHTML='WASD：うごく　Space：ジャンプ　Shift：イカ　左クリック：撃つ　Q：ボム　R：スペシャル';
 if(p===2&&life)life.style.display='none';
 if(p===2&&teamHud)teamHud.style.display='none';
 const next=document.getElementById('v113-radio-next');
 const help=document.getElementById('v113-radio-help');
 if(next)next.textContent='タップして次へ ▶';
 if(help)help.textContent='画面をタップして次へ';
 const titleEl=document.getElementById('v107-howto-title');
 const sub=document.getElementById('v107-howto-subtitle');
 if(titleEl)titleEl.textContent='🎮 まずは これだけ！';
 if(sub)sub.textContent='この画面を見ながら操作してみよう。';
 document.querySelectorAll('#v107-howto-body .v107-help-box').forEach(b=>{
  const x=(b.textContent||'').replace(/\s+/g,' ');
  if(x.includes('4 VS 4')||x.includes('前衛')||x.includes('中衛')||x.includes('後衛')||x.includes('試し撃ち場で使うキー'))b.style.display='none';
 });
 if(playable&&!shown){
  shown=true;
  setTimeout(()=>{try{window.__V108_OPEN_HOWTO?.()}catch(e){console.warn('[V114 auto help]',e)}},350);
 }
 if(!practice&&wasPractice&&p!==2)shown=false;
 wasPractice=practice;
}
setInterval(sync,180);
sync();
window.__V114_BUILD='V114-SIMPLE-KIDS-UX-AUTO-HOWTO-PRACTICE-2026-10-02';
})();