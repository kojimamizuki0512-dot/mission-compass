// functions/index.js — Firebase Functions 1st Gen（https.onRequest）ESM版
// 既存の関数名 api を維持。/chat と /guided を提供。
// モデル: gemini-2.5-flash（v1beta）
// APIキーは 1) process.env.GEMINI_API_KEY か 2) functions.config().gemini.key のどちらかで取得可能。

import express from 'express';
import * as functions from 'firebase-functions';

const MODEL = 'models/gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const app = express();

// ---- JSON & 簡易CORS ----
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
app.get('/healthz', (_req, res) => res.json({ ok: true, model: MODEL }));

// 安全にAPIキーを読む（2系の Secret でなくてもOKな実装）
function readApiKey() {
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();
  const cfg = functions.config();
  const cfgKey = cfg?.gemini?.key;
  if (cfgKey && cfgKey.trim()) return cfgKey.trim();
  return '';
}

// ---- フリーチャット ----
// 期待: { userText: string }
app.post('/chat', async (req, res) => {
  try {
    const apiKey = readApiKey();
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

    const userText = (req.body && req.body.userText) || '';
    if (!userText.trim()) return res.status(400).json({ error: 'userText is required' });

    const resp = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: userText }] }] })
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

// ---- ガイド付き対話 ----
const GUIDED_QUESTIONS = [
  { id: 'best-moment',  q: 'これまでの人生で「最も充実していた瞬間」はいつ？それはなぜ？' },
  { id: 'strength',     q: '友人や周囲から、どんなことで頼られることが多い？具体例は？' },
  { id: 'values',       q: 'あなたが譲れない「価値観」を3つ挙げると？（例：誠実・挑戦・貢献 など）' },
  { id: 'care-problem', q: '社会や身近な世界で「放っておけない」と感じる課題は？' },
  { id: 'energize',     q: '時間を忘れて没頭できること（ワクワクの源）は？' },
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
`.trim();

app.post('/guided', async (req, res) => {
  try {
    const apiKey = readApiKey();
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

    const { step, answers, personaHint } = req.body || {};
    const s = Number.isInteger(step) ? step : 0;
    const A = Array.isArray(answers) ? answers : [];

    // 次の質問を返す
    if (s < GUIDED_QUESTIONS.length) {
      const nextQ = GUIDED_QUESTIONS[s]?.q || '自己紹介をお願いします。';
      return res.json({ type: 'question', step: s, question: nextQ });
    }

    // 最終: ミッション生成
    const joined = A.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join('\n\n');
    const hint = personaHint ? `\n# 追加ヒント\n${personaHint}\n` : '';
    const prompt = `# これまでの回答\n${joined}\n${hint}\n\n${MASTER_INSTRUCTION}`;

    const resp = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 簡易パース
    const values = (text.match(/私の価値観\s*:\s*\[(.*?)\]/s)?.[1] || '')
      .split(/[、,]/).map(s => s.trim()).filter(Boolean);
    const passions = (text.match(/私の情熱\s*:\s*\[(.*?)\]/s)?.[1] || '')
      .split(/[、,]/).map(s => s.trim()).filter(Boolean);
    const statement = (text.match(/私のミッション\s*:\s*「([^」]+)」/s)?.[1] || '').trim();

    return res.json({ type: 'final', mission: { values, passions, statement }, pretty: text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
});

// ---- 404 ----
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// 1st Gen export（既存名を維持）
export const api = functions.region('asia-northeast1').https.onRequest(app);
