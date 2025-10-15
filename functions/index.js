// functions/index.js (REST直叩き版・Gen2)
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const ok  = (res, data) => res.status(200).json(data);
const bad = (res, msg, code = 500, extra = {}) => res.status(code).json({ error: msg, ...extra });

// v1で確実に存在する候補を順に試す
const CANDIDATES = [
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.0-pro-latest"
];

async function callGeminiV1(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j?.error?.message || j?.error || r.statusText || "Request failed").toString();
      const is404 = r.status === 404 || /not\s*found|unsupported/i.test(msg);
      const kind = is404 ? "model-404" : "gemini-error";
      const err = new Error(msg);
      err.kind = kind; err.status = r.status;
      throw err;
    }
    const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim() || "";
    if (!text) throw new Error("Empty response from model");
    return text;
  } finally { clearTimeout(to); }
}

export const api2 = onRequest(
  { region: "asia-northeast1", cors: true, secrets: [GEMINI_API_KEY], maxInstances: 10 },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        return ok(res, { ok: true });
      }
      if (req.method !== "POST") return bad(res, "Only POST is allowed.", 405);

      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const message   = (body?.message ?? "").toString();
      const sessionId = (body?.sessionId ?? "").toString();
      if (!message.trim()) return bad(res, "message is required.", 400);

      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) return bad(res, "GEMINI_API_KEY is not set.", 500);

      // 診断用
      if (message === "__diag__") {
        return ok(res, { ok: true, hasKey: true, runtime: process.version, candidates: CANDIDATES });
      }

      const sys =
        "役割: 対話コーチ。常に短文で要点のみ。必要なときだけ #chip:候補 を最大3つ。" +
        "太字は全体の1〜2割（**太字**）。絵文字なし。日本語。";
      const prompt =
        `# system\n${sys}\n# session\nid=${sessionId || "no-session"}\n# user\n${message}`;

      const tried = [];
      let lastErr = null;
      for (const m of CANDIDATES) {
        tried.push(m);
        try {
          const reply = await callGeminiV1(apiKey, m, prompt);
          return ok(res, { reply, model: m });
        } catch (e) {
          if (e?.kind === "model-404") { lastErr = e; continue; }
          console.error("[gemini error]", e);
          return bad(res, e.message || "Gemini error", 500, { kind: "gemini-error", tried, status: e?.status });
        }
      }
      console.error("[model not found chain]", lastErr);
      return bad(res, "No v1 models available (404 chain).", 500, { kind: "model-not-found", tried });
    } catch (err) {
      console.error("[/api/chat] error:", err);
      return bad(res, err?.message || "Server Error", 500, { kind: "server-error" });
    }
  }
);
