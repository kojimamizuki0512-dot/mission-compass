// functions/index.js — v2025-10-15-api-mem-gen1-1
// Gen1 関数として動作。Node.js 20 / ESM。既存の Hosting rewrite (/api/** → api) を維持。

import * as functions from "firebase-functions";                // ← Gen1
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();
const db = getFirestore();

// ---- 設定 ----
const REGION = "asia-northeast1";
const MODEL = "gemini-1.5-flash";
const MAX_CONTEXT_MESSAGES = 8;   // 履歴プロンプトに入れる最大件数（role混在）
const HARD_REPLY_CHAR_LIMIT = 360; // 返答の最大文字数（長文はクライアントで最終化）

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
const clip = (s, n) => (!s ? s : (s.length > n ? s.slice(0, n - 1) + "…" : s));

// Firestore スキーマ（参考）
// chats/{sessionId} : { uid, createdAt, updatedAt, step }
// chats/{sessionId}/messages/{id} : { role: 'user'|'assistant', content, createdAt }

export const api = functions
  .region(REGION)                          // ← Gen1 の地域指定
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    // /api/chat のみに対応
    const path = req.path || req.url || "";
    if (req.method !== "POST" || !/\/chat$/.test(path)) {
      return res.status(404).json({ error: "Not found." });
    }

    try {
      const { message, sessionId: rawSid } = (req.body || {});
      const text = (message || "").toString().trim();
      if (!text) return res.status(400).json({ error: "message is required." });

      const sessionId = (rawSid || "").toString().trim() || null;

      // --- 履歴読込 ---
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
            uid: null, // いまは匿名想定。必要に応じて Auth 連携可。
          });
        } else {
          step = Number(chatSnap.get("step") || 1);
        }

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

      // --- プロンプト（Gemini generateContent 形式）---
      const contents = [];
      contents.push({ role: "user", parts: [{ text: "### System\n" + sysPrompt(step) }] });
      for (const m of history) {
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
      }
      contents.push({ role: "user", parts: [{ text }] });

      // --- API キー取得（Gen1 用）---
      // 1) Secret を環境変数として注入している場合
      // 2) または functions:config:set gemini.key="..." を設定している場合
      const apiKey =
        process.env.GEMINI_API_KEY ||
        (functions.config().gemini && functions.config().gemini.key);

      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not set on server." });
      }

      // --- 生成 ---
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
      const gen = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
        }),
      }).then(r => r.json());

      const reply = clip(
        gen?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "（返信を生成できませんでした）",
        HARD_REPLY_CHAR_LIMIT
      );

      // --- 保存（sessionId ありの時だけ）---
      if (sessionId) {
        const chatRef = db.collection("chats").doc(sessionId);
        const batch = db.batch();
        const now = Timestamp.now();

        batch.set(chatRef.collection("messages").doc(), {
          role: "user", content: text, createdAt: now,
        });
        batch.set(chatRef.collection("messages").doc(), {
          role: "assistant", content: reply, createdAt: now,
        });

        // “ヘルプ系”の発話は step を進めない簡易ルール
        const holds = /(よく分からない|別の聞き方|help|explain)/.test(text.toLowerCase());
        const nextStep = holds ? step : Math.min(10, step + 1);

        batch.set(chatRef, { updatedAt: now, step: nextStep }, { merge: true });
        await batch.commit();
        step = nextStep;
      }

      return res.json({
        reply,
        step,  // サーバ側の正
        nextHint: step < 10 ? "次は“情熱”を軽く教えてね" : "ここまでの回答をもとに目標案をまとめるよ",
        model: MODEL,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "internal_error", detail: (e && e.message) || String(e) });
    }
  });
