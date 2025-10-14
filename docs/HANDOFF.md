# Mission Compass — 引き継ぎ用ハンドブック（MVP途中版）

## 1. 目的
この文書は、次のチャットや別開発者に引き継ぐための“決まりごと（ルール）”と“環境/構成”を1か所に集約します。

## 2. 出力ルール（厳守）
- 変更があるときは **必ずファイルパスを明記し、コードは“全文”** を提示する。
- Windows PowerShell 前提で **コミット・プッシュ・デプロイのコマンド** を毎回あわせて提示する。
- **改善提案は毎回5本**（順番固定）  
  1) 機能の改善  
  2) UIの改善  
  3) ユーザー課題に効く改善（UX）  
  4) Canva Proでできる改善  
  5) ChatGPTが思う改善（自由枠）
- 手順の数はユーザー指定を厳守（指定なしなら最小限）。
- 専門用語はできる限り噛み砕いて説明。
- （手順を出す時は）**次にどんな画面になるか** と **次回の予告** を一言添える。
- モバイル最優先の使い勝手を意識（入力欄の下部固定 / 自動スクロール / タップしやすさ）。

## 3. 現在の技術構成（MVP途中版）
- **ホスティング**: Firebase Hosting（プロジェクト: `missioncompass-3b58e`）
- **API**: Firebase Cloud Functions（1st Gen, Node.js 20）  
  - エンドポイントは Hosting から **`/api/chat`** にリライトされ Functions の `api` に到達
- **認証**: Firebase Authentication（Googleログイン）
- **モデル**: Gemini（Functions 経由でAPIキーを秘匿）

## 4. 主要ファイル/パス
- `public/index.html` … ランディング。ヒーロー写真/CTA。GoogleログインUI。  
- `public/dialog.html` … チャット画面。モバイル優先、下部入力固定、自動スクロール。  
- `public/firebase-config.js` … Web用Firebase設定（公開キー前提の設定ファイル）。  
- `firebase.json` … Hosting と Functions の設定（`/api/**` → Functions: api）。  
- `functions/index.js` … Cloud Functions（`api` エクスポート）。  
- **Secrets**（Functions 側に設定 / コードには直書きしない）  
  - `GEMINI_API_KEY` … Gemini APIキー（Firebase CLI で登録済み）

## 5. デプロイの流れ（再掲）
1) 変更コミット → 2) `git push` → 3) `firebase deploy --project missioncompass-3b58e`  
※ Functions を触っていない場合も、Hosting 変更はこの1コマンドでOK。

## 6. 既知のハマりどころ
- **キャッシュ**：更新が反映されない時はシークレットウィンドウで確認。
- **`/api/chat` が 404**：`firebase.json` の rewrites を確認（`/api/**` → function `api`）。  
- **ログ確認**：`firebase functions:log --only api --project missioncompass-3b58e`
- **Auth が未ログインに見える**：scriptの読み込み順・CSP・モジュール/UMD混在を確認。

## 7. 次回の最初のタスク（確定）
**`public/dialog.html` のフォント/文字組をトップページと合わせる**  
- トップと同じフォントスタック/字間/ウェイトに統一  
- 見出し/本文/ボタンでサイズとウェイトを整理  
- 変更後はファイル全文で提示 + コミット/プッシュ/デプロイ
