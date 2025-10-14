@'
# Mission Compass — Handoff

## 目的（MVPの仮説検証）
- 「AI対話で『自分のミッション発見』体験に価値があるか」検証

## 重要ルール
- **コードは修正ファイルを「全文」提示**
- **手順は原則1つずつ**（ただし「引き継ぎ」や「まとめ」は一括OK）
- 専門用語はかんたんに。PowerShellコマンド明示。コミット→プッシュ→デプロイを併記
- UI/機能/UX/Canva Pro/自由枠の**5本立て提案**を毎回

## ディレクトリ構成（要点）
- /public … ランディング(index.html), dialog.html, firebase-config.js ほか静的資産
- /functions … Firebase Functions（Gemini 連携のHTTP API）
- firebase.json … Hosting と Functions の連携（/api/* → function:api）
- .gitignore … secrets/不要物はコミットしない

## 依存サービス
- Firebase Hosting / Functions(Gen1, Node.js 20)
- Google Sign-In（Firebase Auth）
- Gemini API（Google AI Studio / Secret Manager 経由）

## セットアップ（ローカル）
```pwsh
npm --version
firebase --version
# ルート
npm install
# functions
cd functions
npm install
cd ..

秘密情報

GEMINI_API_KEY は GitHub に載せない。Firebase Secret Manager で管理

public/firebase-config.js はクライアント設定のため公開可（漏洩扱いではない）

MVPの現在地（途中完成版）

/index.html：ヒーロー、色設計、CTA「はじめる」→ /dialog

/dialog.html：LINE風UI、Googleログイン、Geminiチャット（送受信OK）

既知のUI課題：フォント統一、オートスクロールの最適化 など

'@ | Out-File -Encoding UTF8 -FilePath HANDOFF.md

デプロイ（要：firebase login / use）
firebase deploy --only "functions,hosting" --project <YOUR_PROJECT_ID