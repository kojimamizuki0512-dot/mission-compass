/**
 * Mission Compass — Functions (Gen1 / Node.js 20, ESM)
 * /api/chat: 短文＋最後に3択を強制し、choices もJSONで返す
 */

import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ---- APIキー取得（環境変数 or runtime config 両対応） -------------------------
let runtimeConfig = {};
try { runtimeConfig = functions.config?.() ?? {}; } catch { /* local/older */ }
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ??
  runtimeConfig?.keys?.gemini_api_key ??
  runtimeConfig?.gemini?.api_key ??
  "";

const MODEL = "gemini-2.0-flash";

// ---- Gemini REST -------------------------------------------------------------
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set on server.");

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 256, // 短文＋3択に十分
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
    "";
  return text.trim();
}

// ---- プロンプト（短文＋3択テンプレ） -----------------------------------------
function buildConcisePrompt(userMessage, context = {}) {
  const phase = context.phase || "discovery";
  const goal =
    context.goal ||
    "ユーザーの価値観・情熱・才能のいずれかを一歩深掘りすること";

  return [
    "あなたは、短文で要点だけを返すAIメンターです。",
    "ルール：",
    "1) 返答は 最大3文。長文禁止。",
    "2) 箇条書きが可能なら - を使って簡潔に。",
    "3) 返答の最後に、必ず次の行動の3択を 日本語 で提示（1) 2) 3)）。各行は短く具体的に。",
    "4) タメ口や過剰な共感は避け、落ち着いた丁寧体で。",
    "5) 余計な前置き・まとめ表現は省く。",
    "",
    `【セッション情報】phase=${phase} / goal=${goal}`,
    "【ユーザーの入力】",
    userMessage,
    "",
    "【出力フォーマット（例）】",
    "- まず要点を1〜3文で。",
    "- 余計な接続詞や言い換えは不要。",
    "1) 価値観の候補を3つ書き出す",
    "2) 最近の成功体験を1つ思い出す",
    "3) 得意だった役割を1つ挙げる",
  ].join("\n");
}

// ---- 3択抽出 ---------------------------------------------------------------
function extractChoicesFromText(text) {
  const lines = (text || "").split(/\r?\n/);
  const choices = [];
  for (const ln of lines) {
    const m = ln.match(/^\s*([123１２３])[.)．、)]\s*(.+?)\s*$/);
    if (m && m[2]) choices.push(m[2].trim());
    if (choices.length >= 3) break;
  }
  return choices;
}

// ---- ハンドラ（/chat と /api/chat の両方を受ける） ---------------------------
async function handleChat(req, res) {
  try {
    const { message, context } = req.body || {};
    const userMessage = (message || "").toString().trim();
    if (!userMessage) return res.status(400).json({ error: "empty message" });

    const concisePrompt = buildConcisePrompt(userMessage, context);
    const rawText = await callGemini(concisePrompt);

    let reply = rawText;
    let choices = extractChoicesFromText(reply);
    if (choices.length < 3) {
      const fallback = [
        "価値観を3つ挙げる",
        "最近の成功体験を1つ書く",
        "得意な役割を1つ選ぶ",
      ];
      choices = fallback;
      reply = `${rawText}\n1) ${fallback[0]}\n2) ${fallback[1]}\n3) ${fallback[2]}`;
    }

    return res.json({ reply, choices });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

app.post("/chat", handleChat);
app.post("/api/chat", handleChat);

// ---- Firebase Functions (Gen1) ----------------------------------------------
export const api = functions.region("asia-northeast1").https.onRequest(app);
