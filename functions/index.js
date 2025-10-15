import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const ok = (res, data) => res.status(200).json(data);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

export const api = onRequest(
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

      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const message = (body?.message ?? "").toString();
      const sessionId = (body?.sessionId ?? "").toString();
      if (!message.trim()) return bad(res, "message is required.", 400);

      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) return bad(res, "GEMINI_API_KEY is not set.", 500);

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const sys =
        "役割: 対話コーチ。常に短文。必要な時だけ #chip: 候補を最大3つ。" +
        "太字は全体の1〜2割に抑える（**太字**）。日本語。";

      const prompt = `# system\n${sys}\n# session\nid=${sessionId || "no-session"}\n# user\n${message}`;

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
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
