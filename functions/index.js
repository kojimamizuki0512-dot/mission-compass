// functions/index.js  — ESM版（Firebase Functions v2）
// 既存の「/api」Express に、ガイド付き対話エンドポイントを追加。
// モデル: gemini-2.5-flash（v1beta）

import express from 'express';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const MODEL = 'models/gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const app = express();

// ---- 基本ミドルウェア（JSON + CORSプリフライト簡易対応） ----
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  next();
});

// ---- ヘルスチェック ----
app.get('/healthz', (req, res) => {
  res.json({ ok: true, model: MODEL });
});

// ---- 既存: フリーチャット（最小維持）----
// 期待リクエスト: { userText: string }
app.post('/chat', async (req, res) => {
  try {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });

    const userText = (req.body && req.body.userText) || '';
    if (!userText.trim()) return res.status(400).json({ error: 'userText is required' });

    const resp = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: userText }] }
        ]
      })
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.json({ text, raw: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
});

// ---- 新規: ガイド付き対話（構造化セッション） ----
//
// フロー: クライアントは step と answers を送る。
// - step 0..N-1: サーバーが次の質問を返す（UIはLINE風で出す）
// - step === N: サマリー生成（ミッション・ステートメント）を返す
//
// 期待リクエスト: { step: number, answers: Array<{q:string,a:string}>, personaHint?:string }
// 返却:
//  - { type:'question', step:number, question:string }  … 次の質問
//  - { type:'final', mission:{ values:[], passions:[], statement:string }, pretty:string } … 最終出力
//
const GUIDED_QUESTIONS = [
  { id: 'best-moment', q: 'これまでの人生で「最も充実していた瞬間」はいつ？それはなぜ？' },
  { id: 'strength-trust', q: '友人や周囲から、どんなことで頼られることが多い？具体例は？' },
  { id: 'value-core', q: 'あなたが譲れない「価値観」を3つ挙げると？（例：誠実・挑戦・貢献 など）' },
  { id: 'care-problem', q: '社会や身近な世界で「放っておけない」と感じる課題は？' },
  { id: 'energize', q: '時間を忘れて没頭できること（ワクワクの源）は？' },
];

const MASTER_INSTRUCTION = `
あなたは、若者の自己発見を支援するプロのAIメンターです。
これまでの回答を統合し、下記フォーマットで日本語の出力を生成してください。

# 出力フォーマット
- 私の価値観: [カンマ区切り配列（3〜5語）]
- 私の情熱: [カンマ区切り配列（2〜4語）]
- 私のミッション: 「私は、[情熱]を活かし、[価値観]を大切にしながら、[解決したい社会課題]に挑む」

# ルール
- 抽象語と具体例のバランスを整える
- 受け手が行動に移しやすい一文にする（40〜90文字目安）
- 若者に寄り添う、背中を押すトーンで
- 出力は日本語のみ
`;

app.post('/guided', async (req, res) => {
  try {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });

    const { step, answers, personaHint } = req.body || {};
    const s = Number.isInteger(step) ? step : 0;
    const A = Array.isArray(answers) ? answers : [];

    // まだ質問が残っている → 次の質問を返す
    if (s < GUIDED_QUESTIONS.length) {
      const nextQ = GUIDED_QUESTIONS[s]?.q || '自己紹介をお願いします。';
      return res.json({ type: 'question', step: s, question: nextQ });
    }

    // 最終: サマリー生成
    const joined = A.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join('\n\n');
    const hint = personaHint ? `\n# 追加ヒント\n${personaHint}\n` : '';

    const prompt = `
# これまでの回答
${joined}
${hint}

${MASTER_INSTRUCTION}
`.trim();

    const resp = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: prompt }] }
        ]
      })
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 簡易パース（配列抽出をざっくり）
    const values = (text.match(/私の価値観\s*:\s*\[(.*?)\]/s)?.[1] || '')
      .split(/[、,]/).map(s => s.trim()).filter(Boolean);
    const passions = (text.match(/私の情熱\s*:\s*\[(.*?)\]/s)?.[1] || '')
      .split(/[、,]/).map(s => s.trim()).filter(Boolean);
    const statement = (text.match(/私のミッション\s*:\s*「([^」]+)」/s)?.[1] || '').trim();

    return res.json({
      type: 'final',
      mission: { values, passions, statement },
      pretty: text
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
});

// ---- 404 ----
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ---- export Function（アジア北東・同一URL: /api/*）----
export const api = onRequest(
  { region: 'asia-northeast1', secrets: [GEMINI_API_KEY] },
  app
);
