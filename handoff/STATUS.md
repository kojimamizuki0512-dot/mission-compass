Mission Compass — STATUS.md (v0.1)
最終更新: 2025-10-16

1) 環境 / URL
- WebApp: https://missioncompass-3b58e.web.app/
- API:    POST /api/chat  → Functions: api2 (region: asia-northeast1)

2) 実行基盤
- Functions: Gen2 / Node.js 20 / ESM ("type":"module")
- Secrets:   GEMINI_API_KEY（Firebase Secretsで管理）
- Gemini API: REST v1 / endpoint: https://generativelanguage.googleapis.com/v1/

3) モデル方針（現行）
- chat（通常短文）     : gemini-2.5-flash（fallback: gemini-2.0-flash）
- lite（より軽量）     : gemini-2.5-flash-lite（fallback: gemini-2.0-flash-lite）
- final（長文まとめ）  : gemini-2.5-pro（fallback: gemini-2.5-flash）
※ 404 などで利用不可の場合は順次フォールバック／最終的にローカル応答。

4) フロント（ビルド表記）
- index.html   : <footer> に build: YYYY-MM-DD-… を表示
- dialog.html  : 画面下部に build: YYYY-MM-DD-… を表示
- 付記: 表記更新はページごとの `BUILD_LABEL` コメント付近を編集

5) 機能フラグ / UX
- 簡潔モード: AI返答は短文＋必要時のみ3択チップ
- 強調: 重要語を約10–20%だけ **太字**（過剰強調はしない）
- 入力支援: iOS対策の入力モーダル（A案）導入済み
- 会話進捗: ブリッジ実装（段階導線）。本実装でメーター表示予定

6) 既知の注意
- iOS Safari: キーボード表示時のレイアウト再計算に差。モーダルで回避中
- PWA: iOS フルスクリーンは当面見送り（通常ブラウザ起動で運用）
- 一部「chip:…」デバッグ表記の露出を順次除去予定

7) 次アクション（共有）
- 会話履歴の永続化検討（Firestore/Storage/Session）とリカバリ導線
- 役割チャット運用: MASTER_PERSONA / ROLE_PRIMERS の整備・配布
- LPの「なぜ効く？」は計測設計とセットで再導入（A/B想定）
