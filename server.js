import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import expressLayouts from 'express-ejs-layouts';

import { initDb, getUserByEmail, createUser } from './src/db.js';
import { requireAuth, requirePaidAccess } from './src/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

/* ========== View & static ========== */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout'); // src/views/layout.ejs
app.use(express.static(path.join(__dirname, 'public')));

/* ========== Body parser ========== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ========== Session (MVP: MemoryStore) ========== */
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // https 本番なら true
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* ========== locals ========== */
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.hasPaid = req.session.hasPaid || false;
  res.locals.OPENAI_CUSTOM_GPT_URL = process.env.OPENAI_CUSTOM_GPT_URL || '#';
  res.locals.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
  next();
});

/* ========== DB 初期化 ========== */
await initDb();

/* ========== Routes ========== */
app.get('/', (req, res) => {
  res.render('index', { title: 'Mission Compass — 何を学ぶかの前に、なぜ学ぶのかを。' });
});

// CTA: 対話セッションを開始（100円）
app.post('/start', (req, res) => {
  if (!req.session.user) {
    req.session.afterLoginRedirect = '/pay';
    return res.redirect('/signup?next=pay');
  }
  return res.redirect('/pay');
});

/* --- Signup --- */
app.get('/signup', (req, res) => {
  res.render('signup', { title: '新規登録', error: null });
});

app.post('/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).render('signup', { title: '新規登録', error: 'メールとパスワードは必須です。' });
  }
  const existing = await getUserByEmail(email.trim().toLowerCase());
  if (existing) {
    return res.status(400).render('signup', { title: '新規登録', error: 'このメールは既に登録されています。' });
  }
  const id = uuidv4();
  const password_hash = await bcrypt.hash(password, 10);
  await createUser({ id, email: email.trim().toLowerCase(), password_hash });
  req.session.user = { id, email: email.trim().toLowerCase() };
  req.session.hasPaid = false;
  const next = (req.query.next === 'pay' && '/pay') || req.session.afterLoginRedirect || '/';
  delete req.session.afterLoginRedirect;
  return res.redirect(next);
});

/* --- Login --- */
app.get('/login', (req, res) => {
  res.render('login', { title: 'ログイン', error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).render('login', { title: 'ログイン', error: 'メールとパスワードは必須です。' });
  }
  const user = await getUserByEmail(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).render('login', { title: 'ログイン', error: 'メールまたはパスワードが違います。' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).render('login', { title: 'ログイン', error: 'メールまたはパスワードが違います。' });
  }
  req.session.user = { id: user.id, email: user.email };
  req.session.hasPaid = false;
  const next = req.session.afterLoginRedirect || '/';
  delete req.session.afterLoginRedirect;
  return res.redirect(next);
});

/* --- Logout --- */
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

/* --- /pay: 中間ページなしでCheckoutへ --- */
app.get('/pay', requireAuth, (req, res) => res.redirect('/checkout'));

/* --- Checkout（Stripe） --- */
app.get('/checkout', requireAuth, async (req, res) => {
  if (!stripe || !process.env.STRIPE_SECRET_KEY) {
    req.session.hasPaid = true; // dev skip
    return res.redirect('/dialog');
  }
  const YOUR_DOMAIN = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'jpy',
          product_data: { name: 'Mission Compass 対話セッション利用料' },
          unit_amount: 100
        },
        quantity: 1
      }
    ],
    success_url: `${YOUR_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${YOUR_DOMAIN}/payment/cancel`
  });
  return res.redirect(session.url);
});

app.get('/payment/success', requireAuth, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id || !stripe) return res.redirect('/');
  const sessionObj = await stripe.checkout.sessions.retrieve(session_id.toString());
  if (sessionObj && sessionObj.payment_status === 'paid') {
    req.session.hasPaid = true;
    return res.redirect('/dialog');
  }
  return res.redirect('/');
});

app.get('/payment/cancel', requireAuth, (req, res) => {
  res.render('index', { title: 'Mission Compass — 決済がキャンセルされました。' });
});

/* =========================
   対話ページ（TEMP: 公開中）
   ========================= */
app.get('/dialog', (req, res) => {
  res.render('dialog', { title: '作戦会議（AIメンター）' });
});

/* =========================
   Gemini 連携 API（薄い土台）
   ========================= */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';

const DEFAULT_SYSTEM_PROMPT = [
  'あなたはキャリア探索を手伝う汎用アシスタントです。',
  '目的：ユーザーが「なぜ学ぶのか」を言語化し、今日の一歩を決める支援。',
  'スタイル：日本語、落ち着いた口調。先に1つ質問→要点整理→提案は最大3つ。',
  '注意：断定しすぎない／根拠が薄い時は「仮説」と明示／医療・法律などは一般論まで。',
  '出力フォーマット：',
  '1) 質問（短く1つ）',
  '2) 要点（・で3つ以内）',
  '3) 今日の一歩（1文）'
].join('\n');
const SYSTEM_PROMPT = (process.env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT).trim();

function buildUrl(model, ver) {
  return `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
}

async function callGemini(prompt, { timeoutMs = 20000 } = {}) {
  if (!GEMINI_API_KEY) {
    return { ok: false, reply: '（管理者向け）GEMINI_API_KEY が未設定です。Railway Variables に追加してください。' };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const modelCandidates = [
    GEMINI_MODEL,                                 // 2.5（既定）
    GEMINI_MODEL.endsWith('-latest') ? GEMINI_MODEL.replace(/-latest$/, '') : null,
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash'
  ].filter(Boolean);

  const verCandidates = Array.from(new Set([
    GEMINI_API_VERSION,                           // 既定（v1beta）
    GEMINI_API_VERSION === 'v1' ? 'v1beta' : 'v1' // 相互フォールバック
  ]));

  try {
    for (const ver of verCandidates) {
      for (const model of modelCandidates) {
        try {
          const resp = await fetch(buildUrl(model, ver), {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt.slice(0, 4000) }]}],
              generationConfig: { temperature: 0.5, maxOutputTokens: 512 }
            })
          });

          const raw = await resp.text(); // ← ボディは必ず文字列で確保（デバッグ・分岐用）
          let data = {};
          try { data = raw ? JSON.parse(raw) : {}; } catch { /* JSONでない場合もある */ }

          if (!resp.ok) {
            // 404/400 は次候補へ、それ以外はエラー返す
            if (resp.status === 404 || resp.status === 400) continue;
            return { ok: false, reply: `Gemini API error: HTTP ${resp.status} ${raw}` };
          }

          // OK でも candidates が空のケース（安全ブロック等）をハンドリング
          const blocked = data?.promptFeedback?.blockReason;
          const candidate = data?.candidates?.[0];
          const text =
            candidate?.content?.parts?.map(p => p.text).join('') ||
            candidate?.content?.parts?.[0]?.text ||
            '';

          if (blocked) {
            // ブロックはユーザーに理由を明示
            return { ok: false, reply: `（安全ポリシーでブロックされました: ${blocked}）別の言い回しでお試しください。` };
          }

          if (text && text.trim().length > 0) {
            return { ok: true, reply: text.trim() };
          }

          // テキストが空＝実質失敗とみなして次候補へ
          continue;
        } catch (e) {
          if (e?.name === 'AbortError') {
            return { ok: false, reply: '（タイムアウト）少し待ってもう一度お試しください。' };
          }
          // 通信エラーは次候補を試す
          continue;
        }
      }
    }
    return { ok: false, reply: '（応答を取得できませんでした）モデル/バージョンの組合せを変更して再試行してください。' };
  } finally {
    clearTimeout(t);
  }
}

/* ===== TEMP: 公開API（本来は requireAuth + requirePaidAccess） ===== */
app.post('/api/chat', async (req, res) => {
  const message = (req.body?.message || '').toString().trim();
  if (!message) return res.status(400).json({ reply: 'メッセージが空です。' });

  const userPrompt = `${SYSTEM_PROMPT}\n\nユーザー: ${message}`;
  const result = await callGemini(userPrompt);
  return res.json({ reply: result.reply });
});

/* ========== Start server ========== */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Mission Compass running on http://localhost:${port}`);
});
