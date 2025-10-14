了解。**Canvaの自動生成は10/15に再トライ**で受け取り。今回はルール通り、**1手順=1ファイル=1変更**で「`HANDOFF.md` に“商品化チェック”を追記」だけやる。色や他ファイルは触らない。

---

# 変更ファイル（全文）

**パス:** `HANDOFF.md`

````markdown
# Mission Compass — Handoff

## 目的（MVPの仮説検証）
- 「AI対話で『自分のミッション発見』体験に価値があるか」検証

## 重要ルール
- **コードは修正ファイルを「全文」提示**
- **手順は原則1つずつ**（ただし「引き継ぎ」や「まとめ」は一括OK）
- 専門用語はかんたんに。PowerShellコマンド明示。コミット→プッシュ→デプロイを併記
- UI/機能/UX/Canva Pro/自由枠の**5本立て提案**を毎回

## ディレクトリ構成（要点）
- `/public` … ランディング（`index.html`）、`dialog.html`、`firebase-config.js` ほか静的資産
- `/functions` … Firebase Functions（Gemini 連携の HTTP API）
- `firebase.json` … Hosting と Functions の連携（`/api/* → function:api`）
- `.gitignore` … secrets/不要物はコミットしない

## 依存サービス
- Firebase Hosting / Functions（Gen1, Node.js 20）
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
````

## デプロイ（要：firebase login / use）

```pwsh
firebase deploy --only "functions,hosting" --project <YOUR_PROJECT_ID>
```

## 秘密情報

* **GEMINI_API_KEY** は GitHub に載せない。Firebase Secret Manager で管理
* `public/firebase-config.js` はクライアント設定のため公開可（漏洩扱いではない）

## MVPの現在地（途中完成版）

* `/index.html`：ヒーロー、色設計、CTA「はじめる」→ `/dialog`
* `/dialog.html`：LINE風UI、Googleログイン、Geminiチャット（送受信OK）
* 既知のUI課題：フォント統一、オートスクロールの最適化 など

---

## 商品化チェック（初回版）

**目的**

* プロダクトが**「宣伝したらユーザーが使ってくれるレベル」**に達したら、CEO（指揮官）へ即レポート。

**基準（暫定）**

* **価格帯**：無料 **または** **100円の売り切り**でもユーザーに受け入れられる体験品質。
* **導線の滑らかさ**：
  ランディング → 対話開始 → **ミッション言語化** → **今日の一歩提示** まで、初見ユーザーが迷わず完走できる。
* **素材の準備**：LP/ダイアログの視覚的統一が取れており、Brand Kit（A4一枚板）とOG画像テンプレが用意済み。

  * 例：`/public/assets/brand-kit-v1.png`（後日配置予定）

**運用**

* 達したと判断した時点で**即報告**（スクショ2〜3枚・導線メモ・刺さったポイントを3行）。
* 担当：CSO/司令塔AI + 開発担当。
* 次アクションの原則：価格テスト（無料/100円）→ 初期ユーザーの行動観察 → 体験の引っかかり解消。

---

````

