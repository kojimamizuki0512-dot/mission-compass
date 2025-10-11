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

// View & static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout'); // src/views/layout.ejs を共通レイアウトにする
app.use(express.static(path.join(__dirname, 'public')));

// Body parser
app.use(express.urlencoded({ extended: true }));

// Session (MVP: MemoryStore)
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

// ★ locals（layout を「関数」で上書きしないこと！）
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.hasPaid = req.session.hasPaid || false;
  res.locals.OPENAI_CUSTOM_GPT_URL = process.env.OPENAI_CUSTOM_GPT_URL || '#';
  res.locals.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
  // res.locals.layout は絶対に設定しない（文字列パスである必要があるため）
  next();
});

// Initialize DB (lowdb JSON; 本番は /tmp を使うように src/db.js 側で制御)
await initDb();

// Routes
app.get('/', (req, res) => {
  res.render('index', { title: 'Mission Compass — 何を学ぶかの前に、なぜ学ぶのかを。' });
});

// CTA: 対話セッションを開始（100円）
app.post('/start', (req, res) => {
  if (!req.session.user) {
    req.session.afterLoginRedirect = '/checkout';
    return res.redirect('/signup');
  }
  return res.redirect('/checkout');
});

// Signup
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
  const next = req.session.afterLoginRedirect || '/';
  delete req.session.afterLoginRedirect;
  return res.redirect(next);
});

// Login
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

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Checkout: Stripe Checkout セッション作成
app.get('/checkout', requireAuth, async (req, res) => {
  if (!stripe || !process.env.STRIPE_SECRET_KEY) {
    // Stripe未設定時は開発確認のためスキップ（ダミー課金）
    req.session.hasPaid = true;
    return res.redirect('/dialog');
  }
  const YOUR_DOMAIN = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'jpy',
        product_data: { name: 'Mission Compass 対話セッション利用料' },
        unit_amount: 100
      },
      quantity: 1
    }],
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

// ゲート付き対話ページ
app.get('/dialog', requireAuth, requirePaidAccess, (req, res) => {
  res.render('dialog', { title: '作戦会議（AIメンター）' });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Mission Compass running on http://localhost:${port}`);
});
