# v22 Complete One-File Web Game

- Game client is entirely in `index.html` (lobby, practice, CPU battle, online panel, customization, result screen, stage/gimmicks, HUD).
- `server.js` is only the Node/WebSocket server needed for online play.
- Reloading the page starts again from the initial loading screen; game configuration is not persisted.
- No `town.html` or `battle.html` is required.

Render:
- Build Command: `npm install`
- Start Command: `npm start`


## v22 fix
施設移動を旧 startRangePhase のラップ処理から切り離し、同一 index.html 内の直接初期化へ変更。施設移動失敗トーストを出さず、試し撃ち・CPU・オンラインをページ遷移なしで起動。
