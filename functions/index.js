// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const ok  = (res, data) => res.status(200).json(data);
const bad = (res, msg, code = 500, extra = {}) =>
  res.status(code).json({ error: msg, ...extra });

// v1 で利用可能性が高い順にトライ（404/unsupported をフォールバック）
const MODEL_CANDIDATES = [
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.0-pro-latest",
  // 最後の砦（古い環境向け v1beta 遺産）。v1 で弾かれたら SDK 側が 404 扱いにする
  "gemini-pro"
];

export const api2 = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    secrets: [GEMINI_API_KEY],
    maxInstances: 10
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        return ok(res, { ok: true });
      }
      if (req.method !== "POST") return bad(res, "Only POST is allowed.", 405);

      // Defensive parse
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const message   = (body?.message ?? "").toString();
      const sessionId = (body?.sessionId ?? "").toString();
      if (!message.trim()) return bad(res, "message is required.", 400);

      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) return bad(res, "GEMINI_API_KEY is not set.", 500, { hint: "functions:secrets:set 後に再デプロイ" });

      // 簡易ダイアグ
      if (message === "__diag__") {
        return ok(res, {
          ok: true,
          hasKey: true,
          runtime: process.version,
          candidates: MODEL_CANDIDATES
        });
      }

      const genAI = new GoogleGenerativeAI(apiKey);

      const sys =
        "役割: 対話コーチ。常に短文で要点のみ。必要なときだけ #chip:候補 を最大3つ。" +
        "太字は全体の1〜2割に抑える（**太字**）。絵文字なし。日本語。";

      const prompt =
        `# system\n${sys}\n` +
        `# session\nid=${sessionId || "no-session"}\n` +
        `# user\n${message}`;

      // モデルを順に試す（404/unsupported は継続）
      const tried = [];
      let lastErr = null;
      for (const modelName of MODEL_CANDIDATES) {
        tried.push(modelName);
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
          });
          const text = result?.response?.text?.() ?? "";
          if (!text.trim()) throw new Error("Empty response from model.");
          return ok(res, { reply: text, model: modelName });
        } catch (e) {
          const msg = String(e?.message || e);
          if (/404|not\s+found|not\s+supported/i.test(msg)) {
            lastErr = e; // 次の候補へ
            continue;
          }
          console.error("[gemini error non-404]", e);
          return bad(res, msg, 500, { kind: "gemini-error", tried });
        }
      }

      console.error("[gemini model 404 chain]", lastErr);
      return bad(
        res,
        "No available Gemini model for current API version. (All candidates failed)",
        500,
        { kind: "model-not-found", tried }
      );
    } catch (err) {
      const msg = err?.message || "Server Error";
      console.error("[/api/chat] error:", err);
      return bad(res, msg, 500, { kind: "server-error" });
    }
  }
);
