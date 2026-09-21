# スプラ3風 Webオンライン v26（STAGE / INK QUALITY）

1ファイル版をベースに、ステージ座標・塗り・武器表示・オンライン塗り制御を整理した品質強化版です。
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


## v26 改修ポイント
- ステージの実寸（横36×縦90）に合わせて塗り座標を修正。
- 通常射撃の塗りを小さくし、ローラー・ワイパー・ブラスターの塗り方を分離。
- バトルステージを低い遮蔽物中心の3レーン構成に整理。
- 武器名だけでなくカテゴリ記号・色・基本ステータスも表示。
- オンラインの塗りパケットにレート制限・座標・半径のサーバー側上限を追加。

## 安全メモ
- 非公式のファンメイド作品です。任天堂・Nintendo・Splatoonとは関係ありません。
- オンライン接続先は、公開しているこのWebサービス自身のWebSocketだけを使用します。
- 外部Tailwind CSS読み込みを削除し、Three.jsにはSubresource Integrityを設定しています。
- Render側のHTTPレスポンスにCSP、X-Frame-Options、nosniff、Referrer-Policyなどのセキュリティヘッダーを付けています。
