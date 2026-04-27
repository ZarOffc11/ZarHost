'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const fs = require('fs');

const db = require('./src/lib/db');
const cron = require('./src/lib/cron');
const { attachUser, flashConsumer } = require('./src/middleware/auth');
const { formatIDR } = require('./src/middleware/ppn');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Trust proxy (when behind reverse proxy)
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Static
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Session store (better-sqlite3 backed)
const sessionDir = path.join(__dirname, 'data');
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
const sessionDb = new Database(path.join(sessionDir, 'sessions.db'));

app.use(
  session({
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 1000 * 60 * 30 },
    }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    },
  })
);

// Helpers available in every view
app.use((req, res, next) => {
  res.locals.formatIDR = formatIDR;
  res.locals.brand = process.env.BRAND_NAME || 'ZarHost';
  res.locals.year = new Date().getFullYear();
  res.locals.path = req.path;
  res.locals.flash = null;
  res.locals.currentUser = null;
  next();
});

app.use(attachUser);
app.use(flashConsumer);

// Routes
app.use('/', require('./src/routes/index'));
app.use('/auth', require('./src/routes/auth'));
app.use('/dashboard', require('./src/routes/dashboard'));
app.use('/payment', require('./src/routes/payment'));
app.use('/api/payment', require('./src/routes/payment_api'));
app.use('/admin', require('./src/routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('pages/error', {
    title: '404',
    code: 404,
    heading: 'Halaman tidak ditemukan',
    message: 'Halaman yang Anda cari tidak tersedia atau telah dipindahkan.',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).render('pages/error', {
    title: '500',
    code: 500,
    heading: 'Terjadi kesalahan',
    message: process.env.NODE_ENV === 'production'
      ? 'Server sedang sibuk, silakan coba lagi sebentar.'
      : err.message,
  });
});

// Cron
cron.start();

app.listen(PORT, () => {
  console.log(`[zarhost] running on http://localhost:${PORT}`);
});
