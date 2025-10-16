/**
 * Mission Compass — Functions (api2) — ESM版
 * Gemini v1 列挙 → 優先順フェイルオーバー（generateContent対応のみ）
 * - GET  /api2/__diag__  : モデル診断（選定結果・対応モデル一覧）
 * - POST /api2/chat      : 通常質問（q または prompt を受付）
 *
 * エラーフォーマット:
 *   { error: string, kind: "config"|"input"|"no_model"|"api_error"|"diag"|"exception", tried: string[] }
 *
 * 前提:
 * - Node.js 20（fetchはグローバル）
 * - Firebase Functions Gen2
 * - package.json に "type": "module"
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import express from "express";
import cors from "cors";

// ---------------------------------------------------------------------------
// 基本設定
// ---------------------------------------------------------------------------
const REGION = "asia-northeast1";
const API_HOST = "https://generativelanguage.googleapis.com";

// 優先順（与件そのまま）
const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
];

// 環境変数（Secret Manager 推奨：GEMINI_API_KEY）
function resolveApiKey(req) {
  // 1) 環境変数（推奨） 2) クエリ key（診断で使える） 3) ヘッダ x-api-key（任意）
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    req.query.key ||
    req.headers["x-api-key"]
  );
}

// ---------------------------------------------------------------------------
// モデル列挙＆選定
// ---------------------------------------------------------------------------
async function listModels(apiKey) {
  const url = `${API_HOST}/v1/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`listModels HTTP ${res.status} ${text}`.trim());
  }
  return await res.json();
}

function filterGenerateContent(listJson) {
  const arr = [];
  for (const m of listJson.models || []) {
    const methods = m.supportedGenerationMethods || [];
    if (Array.isArray(methods) && methods.includes("generateContent")) {
      arr.push(m.name); // e.g. "models/gemini-2.0-flash"
    }
  }
  return arr;
}

function pickPreferred(availableNames /* "models/<id>" の配列 */) {
  for (const pref of MODEL_CANDIDATES) {
    const full = `models/${pref}`;
    if (availableNames.includes(full)) return full;
  }
  return null;
}

// 軽いメモリキャッシュ（コールドスタート対策 10分）
let cachedModel = null;
let cachedAt = 0;
const CACHE_MS = 10 * 60 * 1000;

async function getPreferredModel(apiKey) {
  const now = Date.now();
  if (cachedModel && now - cachedAt < CACHE_MS) {
    return cachedModel;
  }
  const listed = await listModels(apiKey);
  const available = filterGenerateContent(listed);
  const chosen = pickPreferred(available);
  if (chosen) {
    cachedModel = chosen;
    cachedAt = now;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// 推論呼び出し（v1beta :generateContent）
// ---------------------------------------------------------------------------
function buildGenerateBody(promptText) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: String(promptText || "") }],
      },
    ],
  };
}

function extractText(genResp) {
  try {
    const cand = genResp?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const t = parts.map((p) => p.text).filter(Boolean).join("\n");
    return t || "";
  } catch (e) {
    return "";
  }
}

async function callGenerate(apiKey, modelFullName, body) {
  // modelFullName は "models/gemini-2.0-flash" 形式
  const url = `${API_HOST}/v1beta/${modelFullName}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `generateContent(${modelFullName}) HTTP ${res.status} ${text}`.trim()
    );
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Express 構築
// ---------------------------------------------------------------------------
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// 健康＆診断
app.get("/__diag__", async (req, res) => {
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(400).json({
      error: "Missing API key (set GEMINI_API_KEY or pass ?key=)",
      kind: "config",
      tried: MODEL_CANDIDATES,
    });
  }
  try {
    const listed = await listModels(apiKey);
    const available = filterGenerateContent(listed); // "models/<id>" の配列
    const chosen = pickPreferred(available);

    return res.json({
      chosen,
      preferredOrder: MODEL_CANDIDATES,
      availableGenerateContent: available,
      tried: MODEL_CANDIDATES,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.error("diag error", e);
    return res.status(500).json({
      error: String(e?.message || e),
      kind: "diag",
      tried: MODEL_CANDIDATES,
    });
  }
});

// 通常質問
app.post("/chat", async (req, res) => {
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(400).json({
      error: "Missing API key (set GEMINI_API_KEY or pass ?key= or x-api-key)",
      kind: "config",
      tried: MODEL_CANDIDATES,
    });
  }

  const q = (req.body?.q ?? req.body?.prompt ?? "").toString();
  if (!q.trim()) {
    return res.status(400).json({
      error: 'Missing prompt: provide { q: "..."} or { prompt: "..." }',
      kind: "input",
      tried: MODEL_CANDIDATES,
    });
  }

  // 1) まずキャッシュまたは最新列挙から最有力を取得
  let chosen = null;
  try {
    chosen = await getPreferredModel(apiKey);
  } catch (e) {
    // 列挙が失敗 → 下で逐次フェイルオーバー
    logger.warn("model listing failed; will brute-try candidates", e);
  }

  try {
    const body = buildGenerateBody(q);

    // 2) 選ばれたモデルで試す → 失敗したら候補を順にフェイルオーバー
    const triedNames = [];
    const tryQueue = [];

    if (chosen) tryQueue.push(chosen);

    // 列挙が失敗 or 未選定でも優先順で総当たり
    for (const pref of MODEL_CANDIDATES) {
      const full = `models/${pref}`;
      if (!tryQueue.includes(full)) tryQueue.push(full);
    }

    // 実行ループ
    let lastErr = null;
    for (const name of tryQueue) {
      triedNames.push(name.replace(/^models\//, "")); // レポートを見やすく
      try {
        const data = await callGenerate(apiKey, name, body);
        const text = extractText(data);
        // 成功したらキャッシュ更新
        cachedModel = name;
        cachedAt = Date.now();
        return res.json({ model: name, text, raw: data });
      } catch (err) {
        lastErr = err;
        logger.warn(`model failed: ${name}`, err);
      }
    }

    // 全滅
    return res.status(502).json({
      error: `All candidates failed. Last: ${String(lastErr?.message || lastErr)}`,
      kind: "api_error",
      tried: triedNames,
    });
  } catch (e) {
    logger.error("chat exception", e);
    return res.status(500).json({
      error: String(e?.message || e),
      kind: "exception",
      tried: MODEL_CANDIDATES,
    });
  }
});

// Cloud Functions (Gen2) — ESMは名前付きエクスポート
export const api2 = onRequest({ region: REGION, cors: true }, app);
