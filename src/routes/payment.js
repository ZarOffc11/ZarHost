'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../lib/db');
const payment = require('../lib/payment');
const cloudpanel = require('../lib/cloudpanel');
const { requireLogin } = require('../middleware/auth');
const { calc } = require('../middleware/ppn');

const router = express.Router();
router.use(requireLogin);

const buyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
});

const ALLOWED_DURATIONS = [1, 3, 6, 12];

function ensureDuration(months) {
  const m = parseInt(months, 10);
  return ALLOWED_DURATIONS.includes(m) ? m : 1;
}

function isValidDomain(d) {
  if (!d) return false;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(String(d));
}

/* -------------------- BUY (NEW) -------------------- */

router.get('/buy/:packageId', (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND is_active = 1').get(req.params.packageId);
  if (!pkg) return res.redirect('/pricing');
  res.render('pages/payment/buy', {
    title: 'Beli Hosting',
    activeMenu: null,
    pkg,
    calc,
    errors: [],
    formData: { duration: 1, domain: '' },
  });
});

router.post(
  '/buy/:packageId',
  buyLimiter,
  [
    body('domain').trim().toLowerCase().custom((v) => {
      if (!isValidDomain(v)) throw new Error('Format domain tidak valid (contoh: namasaya.com)');
      return true;
    }),
    body('duration').custom((v) => {
      if (!ALLOWED_DURATIONS.includes(parseInt(v, 10))) throw new Error('Durasi tidak valid');
      return true;
    }),
  ],
  async (req, res, next) => {
    try {
      const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND is_active = 1').get(req.params.packageId);
      if (!pkg) return res.redirect('/pricing');

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('pages/payment/buy', {
          title: 'Beli Hosting',
          activeMenu: null,
          pkg,
          calc,
          errors: errors.array(),
          formData: req.body,
        });
      }

      const months = ensureDuration(req.body.duration);
      const domain = req.body.domain;
      const breakdown = calc(pkg.price_monthly, months);

      // Block duplicate domain
      const dupe = db.prepare(`SELECT id FROM hostings WHERE domain = ? AND status NOT IN ('expired','suspended','deleted')`).get(domain);
      if (dupe) {
        return res.status(409).render('pages/payment/buy', {
          title: 'Beli Hosting',
          activeMenu: null,
          pkg,
          calc,
          errors: [{ msg: 'Domain sudah terdaftar di sistem kami' }],
          formData: req.body,
        });
      }

      // Create payment at gateway
      const gw = await payment.createPayment(breakdown.total);

      // Create pending hosting record
      const hostingResult = db.prepare(
        `INSERT INTO hostings (user_id, package_id, domain, status) VALUES (?, ?, ?, 'pending')`
      ).run(req.user.id, pkg.id, domain);
      const hostingId = hostingResult.lastInsertRowid;

      const totalDisplay = gw.totalTransfer || (breakdown.total + (gw.fee || 0) + (gw.uniqueCode || 0));
      db.prepare(
        `INSERT INTO transactions (
          user_id, hosting_id, package_id, domain, trx_id, type, duration_months,
          base_amount, ppn_amount, total_amount, fee, unique_code, qr_string, status, expiry
        ) VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      ).run(
        req.user.id, hostingId, pkg.id, domain, gw.trxId, months,
        breakdown.base, breakdown.ppn, totalDisplay,
        gw.fee || 0, gw.uniqueCode || 0, gw.qr_string || '', gw.expiry || null
      );

      res.redirect(`/payment/checkout/${gw.trxId}`);
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------- RENEW -------------------- */

router.post(
  '/renew/:hostingId',
  buyLimiter,
  [
    body('duration').custom((v) => {
      if (!ALLOWED_DURATIONS.includes(parseInt(v, 10))) throw new Error('Durasi tidak valid');
      return true;
    }),
  ],
  async (req, res, next) => {
    try {
      const hosting = db.prepare(
        `SELECT h.*, p.price_monthly FROM hostings h
           JOIN packages p ON p.id = h.package_id
          WHERE h.id = ? AND h.user_id = ?`
      ).get(req.params.hostingId, req.user.id);
      if (!hosting) return res.redirect('/dashboard/hosting');

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).redirect(`/dashboard/renew/${hosting.id}`);
      }
      const months = ensureDuration(req.body.duration);
      const breakdown = calc(hosting.price_monthly, months);
      const gw = await payment.createPayment(breakdown.total);

      const totalDisplay = gw.totalTransfer || (breakdown.total + (gw.fee || 0) + (gw.uniqueCode || 0));
      db.prepare(
        `INSERT INTO transactions (
          user_id, hosting_id, package_id, domain, trx_id, type, duration_months,
          base_amount, ppn_amount, total_amount, fee, unique_code, qr_string, status, expiry
        ) VALUES (?, ?, ?, ?, ?, 'renew', ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      ).run(
        req.user.id, hosting.id, hosting.package_id, hosting.domain, gw.trxId, months,
        breakdown.base, breakdown.ppn, totalDisplay,
        gw.fee || 0, gw.uniqueCode || 0, gw.qr_string || '', gw.expiry || null
      );

      res.redirect(`/payment/checkout/${gw.trxId}`);
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------- CHECKOUT -------------------- */

router.get('/checkout/:trxId', async (req, res, next) => {
  try {
    const trx = db.prepare(
      `SELECT t.*, p.name AS package_name FROM transactions t
         JOIN packages p ON p.id = t.package_id
        WHERE t.trx_id = ? AND t.user_id = ?`
    ).get(req.params.trxId, req.user.id);
    if (!trx) return res.redirect('/dashboard');

    const qrDataUrl = await payment.renderQR(trx.qr_string);
    res.render('pages/payment/checkout', {
      title: 'Pembayaran',
      activeMenu: null,
      trx,
      qrDataUrl,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/cancel/:trxId', async (req, res, next) => {
  try {
    const trx = db.prepare(
      'SELECT * FROM transactions WHERE trx_id = ? AND user_id = ?'
    ).get(req.params.trxId, req.user.id);
    if (!trx) return res.redirect('/dashboard');
    if (trx.status === 'PENDING') {
      try { await payment.cancelPayment(trx.trx_id); } catch (e) { /* ignore */ }
      db.prepare("UPDATE transactions SET status = 'CANCELED' WHERE id = ?").run(trx.id);

      // Clean up pending hosting if this was a 'new' purchase
      if (trx.type === 'new' && trx.hosting_id) {
        const h = db.prepare('SELECT status FROM hostings WHERE id = ?').get(trx.hosting_id);
        if (h && h.status === 'pending') {
          db.prepare('DELETE FROM hostings WHERE id = ?').run(trx.hosting_id);
        }
      }
    }
    req.session.flash = { type: 'info', message: 'Pembayaran dibatalkan' };
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
