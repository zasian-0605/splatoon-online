# Webインクバトル（GitHub / Render 用）

ブラウザで動くWebゲームのソースコードです。

## ファイル
- index.html：ゲーム本体
- server.js：Renderで動かすHTTP / WebSocketサーバー
- package.json：Node.js依存関係
- render.yaml：Render設定

## Render
Build Command：`npm install`
Start Command：`npm start`
Node.js：18以上

## 安全性について
- 実行ファイルやバイナリは同梱していません。
- ブラウザの任意の保存先からWebSocketへ接続する機能は使いません。
- オンライン接続先は、ゲームを開いているWebサイト自身です。
- オンライン通信にはWebSocketを使用します。
