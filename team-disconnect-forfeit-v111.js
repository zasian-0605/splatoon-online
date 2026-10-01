/* V111: online team-disconnect forfeit result on the client.
   The server decides the winner. This only makes the result screen reflect that
   authoritative result instead of recomputing turf after a team has vanished.
*/
(function(){
  'use strict';
  const BUILD='V111-TEAM-DISCONNECT-FORFEIT-2026-10-02';

  const oldCompute=computeTurf;
  computeTurf=function(){
    const forced=window.__V111_FORCED_MATCH_RESULT;
    if(forced && (forced.winnerTeam==='A'||forced.winnerTeam==='B')){
      turfPct.a=forced.winnerTeam==='A'?100:0;
      turfPct.b=forced.winnerTeam==='B'?100:0;
      return;
    }
    return oldCompute();
  };

  const oldEnd=endBattle;
  endBattle=function(){
    const forced=window.__V111_FORCED_MATCH_RESULT;
    const out=oldEnd.apply(this,arguments);
    if(forced && (forced.winnerTeam==='A'||forced.winnerTeam==='B')){
      const won=playerFighter?.team===forced.winnerTeam;
      const title=document.getElementById('result-title');
      const detail=document.getElementById('result-detail');
      if(title){
        title.textContent=won?'WIN!!':'LOSE...';
        title.style.color=won?'#e3ff00':'#ff0055';
      }
      if(detail){
        detail.textContent=won
          ? '敵チームがいなくなったため勝利！'
          : '味方チームがいなくなったため敗北…';
      }
      try{window.showToast?.(won?'敵チーム離脱 → WIN!!':'味方チーム離脱 → LOSE...');}catch(_){}
    }
    /* Consume the one-shot server result so the next normal match uses turf. */
    window.__V111_FORCED_MATCH_RESULT=null;
    return out;
  };

  window.__V111_BUILD=BUILD;
  console.log('[SPLATOON ONLINE]['+BUILD+'] team disconnect forfeit UI active');
})();
