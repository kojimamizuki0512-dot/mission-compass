// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---- Secret（2nd Gen） ----
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ---- 共通ユーティリティ ----
const ok = (res, data) => res.status(200).json(data);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

/**
 * 2nd Gen handler:
 * - Secret は handler 内で参照
 * - OPTIONS は 200
 * - JSON は文字列/オブジェクト両対応
 * - 返答は短文＋必要時のみ #chip: で候補
 * - 太字は全体の1〜2割
 */
export const api2 = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    secrets: [GEMINI_API_KEY],
    maxInstances: 10,
  },
  async (req, res) => {
    try {
      // Preflight
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        return ok(res, { ok: true });
      }

      if (req.method !== "POST") {
        return bad(res, "Only POST is allowed.", 405);
      }

      // Body パース（string/obj どちらでも）
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const message = (body?.message ?? "").toString();
      const sessionId = (body?.sessionId ?? "").toString();
      if (!message.trim()) return bad(res, "message is required.", 400);

      // ---- Secret はここで読む ----
      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) return bad(res, "GEMINI_API_KEY is not set.", 500);

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const sys =
        "役割: 対話コーチ。常に短文で要点のみ。必要なときだけ #chip:短い候補 を最大3つ付ける。" +
        "太字は全体の1〜2割だけに抑える（**太字**）。絵文字は使わない。日本語。";

      const prompt =
        `# system\n${sys}\n` +
        `# session\nid=${sessionId || "no-session"}\n` +
        `# user\n${message}`;

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      });

      const text = result?.response?.text?.() ?? "";
      if (!text.trim()) throw new Error("Empty response from model.");

      return ok(res, { reply: text });
    } catch (err) {
      console.error("[/api/chat] error:", err);
      return bad(res, err?.message || "Server Error", 500);
    }
  }
);
