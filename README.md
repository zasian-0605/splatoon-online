# 自作インクバトル Webゲーム v25

v24 の不具合修正版です（ゲーム本体は `index.html` 1ファイル、`server.js` はオンライン通信専用）。

## 構成
- `index.html` … ゲーム本体（ロビー / 試し撃ち / CPU 4vs4 / オンライン / カスタマイズ）
- `server.js` … 配信 + WebSocket マッチング（2〜8人、全員 READY で開始、ダメージ中継）
- `package.json`, `render.yaml` … Render 用

## Render へ更新する手順
1. この zip の中身を GitHub リポジトリのルートに上書きコミット（`index.html` `server.js` `package.json` `render.yaml` `README.md`）
2. Render が自動デプロイ（`/healthz` でヘルスチェック）
3. 無料枠は 15 分アイドルでスリープし、復帰に 30〜60 秒かかります

## 主な変更点
詳細は `CHANGES.md` を参照。
