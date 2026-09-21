# スプラ風 Web v29

1ファイルゲーム本体版。`index.html` に街ロビー・試し撃ち・CPU対戦・オンライン・カスタマイズ・結果画面・各種ギミックを統合。

## v29変更
- ローディング後は必ずロビーへ入る。
- 正面に試し撃ち受付、広場にCPU/オンライン/カスタマイズを明確に配置。
- CPU対戦開始時、A/B各チームをそれぞれ1つのスポーンエリアへ集結させてから開始。
- オンライン側もチームスポーン地点にスナップ。
- 既存のマップ、武器、HUD、歩行、MAP表示などは維持。

## ローカル
`npm install` → `npm start` → http://localhost:3000


## v30
Lobby / radio flow restored from v28/v29 stable base. Initial loading now proceeds to customization, then radio, then lobby; team-spawn changes are retained.
