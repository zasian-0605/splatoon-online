# スプラ3風 Webオンライン v34

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


## v34
- v25ベース。ロビー／ラジオの流れを維持。
- バトルステージから移動ギミック、ジャンプ台、ランチャー、リフト、スポンジ等を削除。
- 平面60×150＋少数の塗れる四角い壁。
- ロビー用アバターとバトル用ファイターを分離して、移動状態を初期化。
