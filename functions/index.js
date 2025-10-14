/**
 * Mission Compass — Functions (Gen1 / Node.js 20, ESM)
 * 目的：
 * - /api/chat で「短文優先＋3択提案」を強制
 * - reply の末尾に 1) 2) 3) を含める（前方互換）
 * - choices を JSON でも返す（将来フロントで直接利用）
 *
 * 前提：
 * - functions/package.json に "type": "module"
 * - Node.js 20 なので global fetch が利用可
 * - GEMINI_API_KEY は Secret Manager 等で設定
 */

import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = "gemini-2.0-flash";

// --- Gemini REST 呼び出し ---
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set on server.");

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      topK: 40,
      // 短文＋3択が収まる程度に制限
      maxOutputTokens: 256,
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

// --- プロンプト組み立て（短文＋3択を厳格化） ---
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

// --- 3択抽出（サーバー側でも配列化） ---
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

// --- エンドポイント：/api/chat ---
app.post("/chat", async (req, res) => {
  try {
    const { message, context } = req.body || {};
    const userMessage = (message || "").toString().trim();
    if (!userMessage) return res.status(400).json({ error: "empty message" });

    // “短文＋3択”を強制するプロンプトに変換
    const concisePrompt = buildConcisePrompt(userMessage, context);
    const rawText = await callGemini(concisePrompt);

    // 3択保証（不足時は保険で補完）
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
});

// --- Firebase Functions (Gen1) ---
// CommonJS の `exports.api = ...` ではなく、ESM の named export を使う
export const api = functions.region("asia-northeast1").https.onRequest(app);
