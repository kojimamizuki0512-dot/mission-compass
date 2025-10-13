// functions/index.js  ←全文これでOK（1st Gen / ESM / /api/chatも受ける）
import * as functions from "firebase-functions/v1";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

// 許可オリジン（必要に応じて追加）
const allowOrigins = [
  "https://missioncompass-3b58e.web.app",
  "https://missioncompass-3b58e.firebaseapp.com",
  "http://localhost:5000",
  "http://localhost:5173",
];

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ★ 1st Gen の config からキー取得（なければ環境変数）
const GEMINI_API_KEY =
  (functions.config().gemini && functions.config().gemini.api_key) ||
  process.env.GEMINI_API_KEY ||
  "";

// ヘルスチェック（/ と /api の両方で返す）
app.get("/", (_req, res) => res.status(200).json({ ok: true, service: "api" }));
app.get("/api", (_req, res) => res.status(200).json({ ok: true, service: "api" }));

// 共通ハンドラ（/chat と /api/chat の両方にマウント）
async function chatHandler(req, res) {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }
    const { message, system, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required (string)" });
    }

    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`;

    const contents = [
      ...(system ? [{ role: "user", parts: [{ text: system }] }] : []),
      ...(Array.isArray(history) ? history : []),
      { role: "user", parts: [{ text: message }] },
    ];

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.6, topP: 0.9, topK: 32, maxOutputTokens: 1024 },
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: "upstream_error", status: r.status, body: text });
    }

    const data = await r.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      "(応答が取得できませんでした)";
    return res.json({ reply });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error", detail: String(e) });
  }
}

// ★ここがポイント：/chat と /api/chat の両方を受ける
app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

// 1st Gen エクスポート（リージョン固定）
export const api = functions.region("asia-northeast1").https.onRequest(app);
