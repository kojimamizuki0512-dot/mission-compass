// functions/index.js
import functions from 'firebase-functions';
import cors from 'cors';
import { defineSecret } from 'firebase-functions/params';

const REGION = 'asia-northeast1'; // 東京

// ---- Firebase Secrets（安全管理） ----
// 先に CLI で `firebase functions:secrets:set GEMINI_API_KEY` を設定しておく。
// 取得は key.value() で行う。
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// ---- モデル/バージョンは環境変数 or 既定値 ----
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';

// “薄い土台”は環境変数で差し替え可（空なら実質ナシ）
const DEFAULT_SYSTEM_PROMPT = [
  'あなたはキャリア探索を手伝う汎用アシスタントです。',
  '目的：ユーザーが「なぜ学ぶのか」を言語化し、今日の一歩を決める支援。',
  'スタイル：日本語、落ち着いた口調。先に1つ質問→要点整理→提案は最大3つ。',
  '注意：断定しすぎない／根拠が薄い時は「仮説」と明示／医療・法律などは一般論まで。',
  '出力フォーマット：',
  '1) 質問（短く1つ）',
  '2) 要点（・で3つ以内）',
  '3) 今日の一歩（1文）'
].join('\n');
const SYSTEM_PROMPT = (process.env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT).trim();

const corsHandler = cors({ origin: true });

function geminiUrl(model, ver, key) {
  return `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;
}

async function callGeminiNonStreaming(prompt, apiKey) {
  if (!apiKey) return { ok: false, reply: '（管理者向け）GEMINI_API_KEY が未設定です。' };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);

  // 速さ重視：まず 2.0 を試し、ダメなら 1.5-8b のみフォールバック
  const models = [GEMINI_MODEL, 'gemini-1.5-flash-8b'];
  const versions = [GEMINI_API_VERSION, GEMINI_API_VERSION === 'v1' ? 'v1beta' : 'v1'];

  try {
    for (const ver of versions) {
      for (const model of models) {
        try {
          const resp = await fetch(geminiUrl(model, ver, apiKey), {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt.slice(0, 4000) }]}],
              generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 256
              }
            })
          });

          const raw = await resp.text();
          let data = {};
          try { data = raw ? JSON.parse(raw) : {}; } catch {}

          if (!resp.ok) {
            if (resp.status === 404 || resp.status === 400) continue; // 次候補へ
            return { ok: false, reply: `Gemini API error: HTTP ${resp.status} ${raw}` };
          }

          const blocked = data?.promptFeedback?.blockReason;
          const candidate = data?.candidates?.[0];
          const text =
            candidate?.content?.parts?.map(p => p.text).join('') ||
            candidate?.content?.parts?.[0]?.text ||
            '';

          if (blocked) {
            return { ok: false, reply: `（安全ポリシーでブロック: ${blocked}）言い換えてみてください。` };
          }
          if (text && text.trim()) {
            return { ok: true, reply: text.trim() };
          }
          // 空なら次候補を試す
        } catch (e) {
          if (e?.name === 'AbortError') {
            return { ok: false, reply: '（タイムアウト）少し待って再試行してください。' };
          }
          // 通信エラーは次候補へ
        }
      }
    }
    return { ok: false, reply: '（応答が取得できませんでした）少し時間をおいて再試行してください。' };
  } finally {
    clearTimeout(timeout);
  }
}

// POST /api/chat （非ストリーミング版）
export const api = functions
  .region(REGION)
  .runWith({
    cpu: 1,
    memory: '256MB',
    timeoutSeconds: 25,
    minInstances: 1, // Blaze でコールドスタート緩和
    secrets: [GEMINI_API_KEY] // ← Secrets をバインド
  })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).json({ reply: 'Method Not Allowed' });
        return;
      }

      try {
        const message = (req.body?.message || '').toString().trim();
        if (!message) {
          res.status(400).json({ reply: 'メッセージが空です。' });
          return;
        }

        const apiKey = GEMINI_API_KEY.value(); // ← 安全に取得
        const prompt = SYSTEM_PROMPT ? `${SYSTEM_PROMPT}\n\nユーザー: ${message}` : message;
        const result = await callGeminiNonStreaming(prompt, apiKey);
        res.status(200).json({ reply: result.reply });
      } catch (err) {
        res.status(500).json({ reply: 'サーバーエラーが発生しました。' });
      }
    });
  });
