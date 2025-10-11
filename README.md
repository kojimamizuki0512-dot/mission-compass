# Mission Compass (QuickStart)

目的はただ一つ：「訪問者を説得し、信頼させ、**100円の決済**を完了させる」。

## セットアップ
1) `.env` を作成（`.env.example`をコピーしてキーを設定）  
2) 依存を入れて起動:
```powershell
npm install --include=optional && npm run build
npm run dev
```
3) ブラウザで http://localhost:3000 を開く

## Stripe が未設定の場合
- 開発確認のため、/checkout で **自動的に課金スキップ（ダミー）**して /dialog に遷移します。
- 本番では必ず `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` を設定してください。

## 仕様
- LP（/）→「対話セッションを開始（100円）」→（未ログインなら登録/ログイン）→ Stripe Checkout → 成功で /dialog（ゲート付き）
- 認証と支払い状態はセッションで管理（MVP）
- ユーザーは lowdb(JSON) に保存（`data/db.json`）

## ライセンス
Proprietary
