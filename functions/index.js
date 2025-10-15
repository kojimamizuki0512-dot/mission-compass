import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const ok  = (res, data)        => res.status(200).json(data);
const bad = (res, msg, code=500, extra={}) =>
  res.status(code).json({ error: msg, ...extra });

export const api2 = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    secrets: [GEMINI_API_KEY],
    maxInstances: 10,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        return ok(res, { ok: true });
      }
      if (req.method !== "POST") {
        return bad(res, "Only POST is allowed.", 405);
      }

      // Body defensive parse
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const message   = (body?.message ?? "").toString();
      const sessionId = (body?.sessionId ?? "").toString();
      if (!message.trim()) return bad(res, "message is required.", 400);

      // 内部ダイアグ（キー在庫・環境）
      const apiKey = GEMINI_API_KEY.value();
      if (message === "__diag__") {
        return ok(res, {
          ok: true,
          hasKey: !!apiKey,
          project: process.env.GOOGLE_CLOUD_PROJECT || null,
          region: "asia-northeast1",
          runtime: process.version
        });
      }

      if (!apiKey) {
        return bad(res, "GEMINI_API_KEY is not set.", 500, { hint: "functions:secrets:set で設定→再デプロイ" });
      }

      // Gemini 呼び出し
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const sys =
        "役割: 対話コーチ。常に短文で要点のみ。必要なときだけ #chip:候補 を最大3つ。" +
        "太字は全体の1〜2割に抑える（**太字**）。絵文字なし。日本語。";

      const prompt =
        `# system\n${sys}\n` +
        `# session\nid=${sessionId || "no-session"}\n` +
        `# user\n${message}`;

      let text = "";
      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
        });
        text = result?.response?.text?.() ?? "";
      } catch (apiErr) {
        // Google API 由来のエラーを見える化
        console.error("[gemini error]", apiErr);
        const msg = apiErr?.message || "Gemini call failed";
        // ライブラリによっては statusCode や response データを持っている場合あり
        return bad(res, msg, 500, {
          kind: "gemini-error",
          note: "APIキー/クォータ/モデル名/ネットワークを確認",
        });
      }

      if (!text.trim()) {
        throw new Error("Empty response from model.");
      }
      return ok(res, { reply: text });
    } catch (err) {
      // 最終ガード
      const msg = err?.message || "Server Error";
      console.error("[/api/chat] error:", err);
      return bad(res, msg, 500, { kind: "server-error" });
    }
  }
);
