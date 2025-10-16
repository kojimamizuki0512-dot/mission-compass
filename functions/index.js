/**
 * Mission Compass — Functions (api2) — ESM版
 * ルート互換対応：/__diag__, /api/__diag__, /api2/__diag__（/chat も同様）
 * Gemini v1 列挙 → 優先順フェイルオーバー（generateContent対応のみ）
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import express from "express";
import cors from "cors";

const REGION = "asia-northeast1";
const API_HOST = "https://generativelanguage.googleapis.com";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
];

function resolveApiKey(req) {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    req.query.key ||
    req.headers["x-api-key"]
  );
}

// ---- model listing / pick ---------------------------------------------------
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

function pickPreferred(availableNames) {
  for (const pref of MODEL_CANDIDATES) {
    const full = `models/${pref}`;
    if (availableNames.includes(full)) return full;
  }
  return null;
}

// ---- tiny cache -------------------------------------------------------------
let cachedModel = null;
let cachedAt = 0;
const CACHE_MS = 10 * 60 * 1000;

async function getPreferredModel(apiKey) {
  const now = Date.now();
  if (cachedModel && now - cachedAt < CACHE_MS) return cachedModel;
  const listed = await listModels(apiKey);
  const available = filterGenerateContent(listed);
  const chosen = pickPreferred(available);
  if (chosen) {
    cachedModel = chosen;
    cachedAt = now;
  }
  return chosen;
}

// ---- generation -------------------------------------------------------------
function buildGenerateBody(promptText) {
  return {
    contents: [{ role: "user", parts: [{ text: String(promptText || "") }] }],
  };
}

function extractText(genResp) {
  try {
    const cand = genResp?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    return parts.map((p) => p.text).filter(Boolean).join("\n") || "";
  } catch {
    return "";
  }
}

async function callGenerate(apiKey, modelFullName, body) {
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

// ---- express ---------------------------------------------------------------
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ルート互換ヘルパ：/foo, /api/foo, /api2/foo をまとめて受ける
const routes = (p) => [p, `/api${p}`, `/api2${p}`];

// __diag__
app.get(routes("/__diag__"), async (req, res) => {
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
    const available = filterGenerateContent(listed);
    const chosen = pickPreferred(available);
    return res.json({
      chosen,
      preferredOrder: MODEL_CANDIDATES,
      availableGenerateContent: available,
      tried: MODEL_CANDIDATES,
      timestamp: new Date().toISOString(),
      pathSeen: req.path,
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

// chat
app.post(routes("/chat"), async (req, res) => {
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

  let chosen = null;
  try {
    chosen = await getPreferredModel(apiKey);
  } catch (e) {
    logger.warn("model listing failed; will brute-try candidates", e);
  }

  try {
    const body = buildGenerateBody(q);
    const triedNames = [];
    const tryQueue = [];
    if (chosen) tryQueue.push(chosen);
    for (const pref of MODEL_CANDIDATES) {
      const full = `models/${pref}`;
      if (!tryQueue.includes(full)) tryQueue.push(full);
    }

    let lastErr = null;
    for (const name of tryQueue) {
      triedNames.push(name.replace(/^models\//, ""));
      try {
        const data = await callGenerate(apiKey, name, body);
        const text = extractText(data);
        cachedModel = name;
        cachedAt = Date.now();
        return res.json({ model: name, text, raw: data, pathSeen: req.path });
      } catch (err) {
        lastErr = err;
        logger.warn(`model failed: ${name}`, err);
      }
    }
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

// Gen2 ESM export
export const api2 = onRequest({ region: REGION, cors: true }, app);
