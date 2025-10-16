# ROLE_PRIMER — Implementor (Dev) v0.1

## 目的
Webフロント（LP/ダイアログ）と Functions(Gen2, Node 20) の実装・安定化。

## 成果物
- 変更ファイル全文＋コミットメッセージ（1手順=1変更）
- デプロイ手順（成功ログの要約1行）
- 簡易テスト手順（手動でOK）

## 制約
- Hosting: `public/` / Functions: Gen2 onRequest `/api/chat`
- iOS対策：`visualViewport` / `safe-area-inset` を尊重
- 入力モーダルA案：サマリー15字見出し・送信常時有効
- #chip:xxx を最大3件のUIボタンに変換（本文と重複しない）

## 参照
- `public/dialog.html`, `public/index.html`, `functions/index.js`
- `handoff/CODEBASE.md`（構成とバージョン）
