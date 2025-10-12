/* Firebase Functions — 1st Gen（asia-northeast1） */
const functions = require("firebase-functions");
const express = require("express");

const app = express();
app.use(express.json());

/** 共通 */
const REGION = "asia-northeast1";
const MODEL = "gemini-2.5-flash"; // ご希望のモデル
const GEMINI_ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

/** ヘルス（GETは405にしておく） */
app.get("/", (_, res) => res.status(405).send("POST only. Use /chat or /guided"));

/** フリーチャット: 既存LPテストやデバッグ用（必要なら残す） */
app.post("/chat", async (req, res) => {
  try {
    const userText = (req.body?.message || "").toString().slice(0, 4000);
    if (!userText) return res.status(400).json({ error: "message is required" });

    const body = {
      contents: [{ role: "user", parts: [{ text: userText }] }],
    };

    const r = await fetch(GEMINI_ENDPOINT(MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();

    const text =
      j?.candidates?.[0]?.content?.parts?.[0]?.text ||
      j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ||
      "(応答が取得できませんでした)";
    return res.json({ reply: text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "chat failed" });
  }
});

/** ガイド付き対話: /api/guided  */
app.post("/guided", async (req, res) => {
  try {
    const step = Number(req.body?.step ?? 0);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    // 5つの設問（MVP用にシンプル）
    const QUESTIONS = [
      "初めまして。どんなキャリアに関心がありますか？（例：教育／起業／研究／クリエイティブ など）",
      "これまでで一番『充実していた瞬間』は？ どんな活動・理由でしたか？",
      "あなたが大事にしている価値観を3つ挙げてください。（例：挑戦・誠実・貢献 など）",
      "人から頼られがちな『強み』は何ですか？（例：整理／説明／前に進める など）",
      "周りや社会に『こう役立ちたい』と思うことは何ですか？",
    ];
    const TOTAL = QUESTIONS.length;

    // まだ質問が残っている
    if (step < TOTAL) {
      return res.json({ type: "question", step, total: TOTAL, question: QUESTIONS[step] });
    }

    // ここから最終サマリ
    // Q&Aをテキストにまとめる
    const qa = answers
      .slice(0, TOTAL)
      .map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`)
      .join("\n\n");

    const prompt = [
      "あなたはキャリア戦略コーチです。以下のQ&Aから、ユーザーの価値観・情熱を発掘し、",
      "最後に心に響く『ミッション・ステートメント』を日本語で1行にまとめてください。",
      "",
      "出力は厳密に次のJSONだけにしてください：",
      '{ "values": ["...","...", "..."], "passions": ["...","..."], "statement": "..." }',
      "",
      "制約：",
      "• valuesは抽象語（例：誠実・挑戦・貢献）。3語を目安に。",
      "• passionsは具体的な興味や活動（例：人の成長を助ける、複雑な課題を解く）。2〜3個まで。",
      "• statementは30〜50字程度。「私は、…」で始める。",
      "",
      "―― 以下、ユーザーの回答 ――",
      qa,
    ].join("\n");

    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };

    const r = await fetch(GEMINI_ENDPOINT(MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();

    const raw =
      j?.candidates?.[0]?.content?.parts?.[0]?.text ||
      j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ||
      "";

    // JSON抽出（コードフェンスが付く場合に備える）
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = m ? JSON.parse(m[0]) : JSON.parse(raw); } catch (_) {}

    const mission = {
      values: Array.isArray(parsed?.values) ? parsed.values : [],
      passions: Array.isArray(parsed?.passions) ? parsed.passions : [],
      statement: typeof parsed?.statement === "string" ? parsed.statement : raw.replace(/\s+/g, " ").trim(),
    };

    return res.json({ type: "final", mission });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "guided failed" });
  }
});

/** エクスポート（1st Gen + Secret） */
exports.api = functions
  .region(REGION)
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .https.onRequest(app);
