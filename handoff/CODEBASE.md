Mission Compass — CODEBASE.md (v0.2)
最終更新: 2025-10-16

1) ルート構成（要点）
/
├─ public/                … index.html, dialog.html, manifest.json, icons/
├─ functions/             … Firebase Functions Gen2（Node.js 20）
│  ├─ index.js            … onRequest: api2（/api/chat を担当）
│  └─ package.json        … "type":"module", 依存: firebase-functions など
├─ handoff/               … 引き継ぎ一式
│  ├─ PROJECT.md
│  ├─ CODEBASE.md（このファイル）
│  └─ STATUS.md（任意）
├─ firebase.json          … Hosting rewrites / Functions 設定
└─ .firebaserc            … default プロジェクト: missioncompass-3b58e

2) Hosting（Firebase Hosting）
- rewrites:
  /api/** → Functions: api2（asia-northeast1）
  /dialog → /dialog.html
  **      → /index.html（SPA フォールバック）
- PWA: manifest.json を public に配置。iOS 用 meta は index.html / dialog.html に記述済み。

3) Functions（Gen2 / Gemini v1 REST 直叩き）
- エクスポート: api2（region: asia-northeast1）
- エンドポイント（Hosting 経由）: POST https://<site>.web.app/api/chat
- モデル候補（404 は次候補へ。全滅時はローカル応答）:
  mode=chat  : [ gemini-2.5-flash, gemini-2.0-flash ]
  mode=lite  : [ gemini-2.5-flash-lite, gemini-2.0-flash-lite ]
  mode=final : [ gemini-2.5-pro, gemini-2.5-flash ]
- Secrets: GEMINI_API_KEY（Firebase Secrets。コード直書き禁止）
- 返却例: { "reply":"短文…", "model":"gemini-2.5-flash", "mode":"chat" }

4) デプロイ（参考）
- functions+hosting: firebase deploy --only "functions:api2,hosting" --project missioncompass-3b58e
- functions only    : firebase deploy --only "functions:api2" --project missioncompass-3b58e

5) 参照
- /handoff/PROJECT.md（ビジョン/モジュール）
- /handoff/STATUS.md（バージョン/進行中）
