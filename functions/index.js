// functions/index.js  — v2025-10-15-api-mem-1
// Node.js 20 / ESM。Firebase Functions v2 の onRequest を使用。
// 既存の firebase.json は /api/** → function:api (asia-northeast1) なので export 名は api のまま。

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
if (!getApps().length) initializeApp();
const db = getFirestore();

// ---- 設定 ----
const REGION = "asia-northeast1";
const MODEL = "gemini-1.5-flash"; // フロントの文言は“2.0”だが安定版APIはこれでOK。必要なら後で差し替え可。
const MAX_CONTEXT_MESSAGES = 8;   // プロンプトに入れる直近メッセージ数（role混在で合計）
const HARD_REPLY_CHAR_LIMIT = 360; // 返答のハード上限（長文はクライアントでまとめる前提）

// ---- ユーティリティ ----
function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}
function sysPrompt(step) {
  return [
    "あなたは共感的なAIメンター。",
    "原則：短く要点。1〜3文。必要なときだけ3択を提示。",
    "トーン：同調→短く褒める→次の一歩を聞く。",
    "ユーザーが「よく分からない/別の聞き方で」と言ったら、説明→例×3→3択。",
    "だいたい10ターンでユーザー像を掴み、最後に800〜1200字の目標案を出す。",
    `現在の進行ステップ(1-10目安)：${step || 1}`,
  ].join("\n");
}
function clip(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---- Firestore スキーマ ----
// chats/{sessionId} : { uid, createdAt, updatedAt, step }
// chats/{sessionId}/messages/{id} : { role: 'user'|'assistant', content, createdAt }
// chats/{sessionId}/rollup/summary : { text, updatedAt }  // ※将来拡張

export const api = onRequest({ region: REGION, secrets: [GEMINI_API_KEY] }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  // ルーティング（/api/chat だけ対応）
  const path = req.path || req.url || "";
  if (req.method !== "POST" || !/\/chat$/.test(path)) {
    return res.status(404).json({ error: "Not found." });
  }

  try {
    const { message, sessionId: rawSid } = (req.body || {});
    const text = (message || "").toString().trim();
    if (!text) return res.status(400).json({ error: "message is required." });

    // セッションID（未指定なら stateless 応答）
    const sessionId = (rawSid || "").toString().trim() || null;

    let step = 1;
    let history = [];

    if (sessionId) {
      const chatRef = db.collection("chats").doc(sessionId);
      const chatSnap = await chatRef.get();
      if (!chatSnap.exists) {
        await chatRef.set({
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          step: 1,
          uid: null, // いまは未検証。後続で Auth 検証を入れる前提。
        });
      } else {
        step = Number(chatSnap.get("step") || 1);
      }

      // 直近の履歴を取得（role混在で合計 MAX_CONTEXT_MESSAGES 件）
      const msgsSnap = await chatRef
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(MAX_CONTEXT_MESSAGES)
        .get();

      history = msgsSnap.docs
        .map(d => d.data())
        .reverse()
        .map(m => ({ role: m.role, content: (m.content || "").toString() }));
    }

    // ---- プロンプト構築（Gemini generateContent 形式）----
    // system指示は先頭に入れて、続けて history → 今回の user。
    const contents = [];
    contents.push({ role: "user", parts: [{ text: "### System\n" + sysPrompt(step) }] });
    for (const m of history) {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
    contents.push({ role: "user", parts: [{ text }] });

    // ---- 生成 ----
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const gen = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
        },
      }),
    }).then(r => r.json());

    const reply = clip(
      gen?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "（返信を生成できませんでした）",
      HARD_REPLY_CHAR_LIMIT
    );

    // ---- 永続化（sessionId ありのときだけ）----
    if (sessionId) {
      const chatRef = db.collection("chats").doc(sessionId);
      const batch = db.batch();
      const now = Timestamp.now();
      const userMsgRef = chatRef.collection("messages").doc();
      const aiMsgRef = chatRef.collection("messages").doc();

      batch.set(userMsgRef, {
        role: "user",
        content: text,
        createdAt: now,
      });
      batch.set(aiMsgRef, {
        role: "assistant",
        content: reply,
        createdAt: now,
      });

      // “よく分からない/別の聞き方”系は進捗を進めない（応急ルール）
      const lower = text.toLowerCase();
      const holds = /(よく分からない|別の聞き方|help|explain)/.test(lower);
      const nextStep = holds ? step : Math.min(10, step + 1);

      batch.set(chatRef, { updatedAt: now, step: nextStep }, { merge: true });
      await batch.commit();
      step = nextStep;
    }

    return res.json({
      reply,
      step,                  // サーバ側の正
      nextHint: step < 10 ? "次は“情熱”を軽く教えてね" : "ここまでの回答をもとに目標案をまとめるよ",
      model: MODEL,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error", detail: (e && e.message) || String(e) });
  }
});
