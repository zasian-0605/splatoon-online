# 自作インクバトル Web v19

ゲーム本体は `index.html` の1ファイルに統合しています。

- 街ロビー → 施設 → 黄色い波の遷移 → 自動で試し撃ち
- CPU対戦 / オンライン2〜8人
- MAPは押した時だけ表示
- ページを再読み込みするとゲーム状態・カスタマイズ保存をリセット
- Three.jsはCDN読み込み

## Render
Build Command: `npm install`
Start Command: `npm start`

オンライン時は `server.js` と `ws` を使用します。
