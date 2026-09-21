# スプラ3風 Webオンライン v25

分割前に動作していた1ファイル版をベースに戻した安定版です。
ゲーム本体は `index.html` 1ファイルに入っています。
オンライン通信には `server.js` が必要です。

## 構成
- index.html：街・試し撃ち・CPU・オンライン・カスタマイズ・バトル・結果画面
- server.js：WebSocketオンラインサーバー
- package.json
- render.yaml

## Render
Build Command: `npm install`
Start Command: `npm start`


## v26 stage update
- Battle stage expanded to a very wide 60 x 150 rectangular field.
- Paint and map coordinates use separate X/Z scales so the wide stage displays correctly.
- Enemy/AI charge states never show the player's shared charge gauge; only local player charging is shown.
