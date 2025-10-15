// functions/index.js (Gen2 / REST直叩き + ローカルフォールバック内蔵)
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const ok  = (res, data) => res.status(200).json(data);
const bad = (res, msg, code = 500, extra = {}) => res.status(code).json({ error: msg, ...extra });

// v1 で一般的に使われる候補（順に試す）
const CANDIDATES = [
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.0-pro-latest"
];

// ---- REST で v1 を叩く ----
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
      const err = new Error(msg);
      err.kind = is404 ? "model-404" : "gemini-error";
      err.status = r.status;
      throw err;
    }
    const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim() || "";
    if (!text) throw new Error("Empty response from model");
    return text;
  } finally { clearTimeout(to); }
}

// ---- ローカル・フォールバック（外部APIが全滅しても返す）----
function summarize15(m) {
  const s = (m || "").replace(/\s+/g, " ").trim();
  // ざっくり重要語を抽出
  const picked = (s.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\w]{2,}/gu) || []).slice(0, 3).join(" / ");
  const base = picked || s.slice(0, 15);
  return base.length > 15 ? base.slice(0, 15) : base;
}
function chipify(m) {
  const t = (m || "").toLowerCase();
  if (/[a-z]*ai|機械学習|プログラム|コード/.test(t)) return ["方向決め", "学ぶ時間", "作る題材"];
  if (/マーケ|営業|集客|sns|宣伝|売上/.test(t))   return ["誰に売る", "予算感", "目標幅"];
  if (/デザイン|動画|写真|編集|音楽/.test(t))     return ["作風", "道具", "納期感"];
  return ["OK", "もう少し", "別の話題"];
}
function fallbackCoach(message) {
  const head = summarize15(message);
  const chips = chipify(message);
  // 返答は短文＋太字は1〜2割
  const reply = `**いいね。**「${head}」で掘っていこう。いまの気分に近いのはどれ？\n` +
                chips.map(c => `#chip:${c}`).join("\n");
  return { reply, model: "local-fallback" };
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

      // body defensive
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const message   = (body?.message ?? "").toString();
      const sessionId = (body?.sessionId ?? "").toString();
      if (!message.trim()) return bad(res, "message is required.", 400);

      // 診断
      if (message === "__diag__") {
        return ok(res, { ok: true, hasKey: !!GEMINI_API_KEY.value(), runtime: process.version, candidates: CANDIDATES });
      }

      const apiKey = GEMINI_API_KEY.value();

      // 1) キーがある場合は REST で本番モデルを順に試す
      if (apiKey) {
        const sys =
          "役割: 対話コーチ。常に短文で要点のみ。必要なときだけ #chip:候補 を最大3つ。" +
          "太字は全体の1〜2割（**太字**）。絵文字なし。日本語。";
        const prompt =
          `# system\n${sys}\n# session\nid=${sessionId || "no-session"}\n# user\n${message}`;

        const tried = [];
        for (const m of CANDIDATES) {
          tried.push(m);
          try {
            const reply = await callGeminiV1(apiKey, m, prompt);
            return ok(res, { reply, model: m });
          } catch (e) {
            if (e?.kind === "model-404") { continue; }  // 次の候補へ
            // 認可/クォータなど他のエラーは即フォールバック
            console.error("[gemini error]", e);
            const fb = fallbackCoach(message);
            return ok(res, { ...fb, note: "fallback(gemini-error)" });
          }
        }
        // すべて404→フォールバック
        const fb = fallbackCoach(message);
        return ok(res, { ...fb, note: "fallback(model-404-chain)" });
      }

      // 2) キーが無いなら即フォールバック
      const fb = fallbackCoach(message);
      return ok(res, { ...fb, note: "fallback(no-key)" });

    } catch (err) {
      console.error("[/api/chat] error:", err);
      // サーバ側で想定外例外が起きてもフォールバックで返す
      const fb = fallbackCoach((req.body && (typeof req.body === "string" ? req.body : req.body.message)) || "");
      return ok(res, { ...fb, note: "fallback(server-error)" });
    }
  }
);
