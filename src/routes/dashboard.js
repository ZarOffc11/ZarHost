'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../lib/db');
const { requireLogin } = require('../middleware/auth');
const { calc } = require('../middleware/ppn');

const router = express.Router();

router.use(requireLogin);

router.get('/', (req, res) => {
  const userId = req.user.id;
  const stats = {
    active: db.prepare(
      `SELECT COUNT(*) AS c FROM hostings WHERE user_id = ? AND status = 'active'`
    ).get(userId).c,
    expired: db.prepare(
      `SELECT COUNT(*) AS c FROM hostings WHERE user_id = ? AND status IN ('expired','suspended')`
    ).get(userId).c,
    transactions: db.prepare(
      'SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?'
    ).get(userId).c,
  };
  const hostings = db.prepare(
    `SELECT h.*, p.name AS package_name, p.price_monthly
       FROM hostings h JOIN packages p ON p.id = h.package_id
      WHERE h.user_id = ?
      ORDER BY h.created_at DESC LIMIT 5`
  ).all(userId);
  const transactions = db.prepare(
    `SELECT t.*, p.name AS package_name FROM transactions t
       JOIN packages p ON p.id = t.package_id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC LIMIT 5`
  ).all(userId);
  res.render('pages/dashboard/index', {
    title: 'Dashboard',
    activeMenu: 'home',
    stats,
    hostings,
    transactions,
  });
});

router.get('/hosting', (req, res) => {
  const hostings = db.prepare(
    `SELECT h.*, p.name AS package_name, p.price_monthly, p.disk_gb, p.bandwidth_gb,
            p.max_sites, p.ssl, p.backup
       FROM hostings h JOIN packages p ON p.id = h.package_id
      WHERE h.user_id = ?
      ORDER BY h.created_at DESC`
  ).all(req.user.id);
  // Attach credentials
  for (const h of hostings) {
    h.credentials = db.prepare('SELECT * FROM hosting_credentials WHERE hosting_id = ?').get(h.id);
  }
  res.render('pages/dashboard/hosting', {
    title: 'Hosting Saya',
    activeMenu: 'hosting',
    hostings,
  });
});

router.get('/renew/:id', (req, res) => {
  const hosting = db.prepare(
    `SELECT h.*, p.name AS package_name, p.price_monthly
       FROM hostings h JOIN packages p ON p.id = h.package_id
      WHERE h.id = ? AND h.user_id = ?`
  ).get(req.params.id, req.user.id);
  if (!hosting) return res.redirect('/dashboard/hosting');
  res.render('pages/dashboard/renew', {
    title: 'Perpanjang Hosting',
    activeMenu: 'hosting',
    hosting,
    calc,
  });
});

router.get('/history', (req, res) => {
  const status = (req.query.status || '').toUpperCase();
  let rows;
  if (['SUCCESS', 'PENDING', 'EXPIRED', 'CANCELED'].includes(status)) {
    rows = db.prepare(
      `SELECT t.*, p.name AS package_name FROM transactions t
         JOIN packages p ON p.id = t.package_id
        WHERE t.user_id = ? AND t.status = ?
        ORDER BY t.created_at DESC`
    ).all(req.user.id, status);
  } else {
    rows = db.prepare(
      `SELECT t.*, p.name AS package_name FROM transactions t
         JOIN packages p ON p.id = t.package_id
        WHERE t.user_id = ?
        ORDER BY t.created_at DESC`
    ).all(req.user.id);
  }
  res.render('pages/dashboard/history', {
    title: 'Riwayat Transaksi',
    activeMenu: 'history',
    transactions: rows,
    filterStatus: status,
  });
});

router.get('/profile', (req, res) => {
  res.render('pages/dashboard/profile', {
    title: 'Profil',
    activeMenu: 'profile',
    errors: [],
    success: null,
  });
});

router.post('/profile/avatar', (req, res) => {
  const raw = String(req.body.avatar_url || '').trim();
  if (raw && !/^https?:\/\/.{4,}/i.test(raw)) {
    req.session.flash = { type: 'error', message: 'URL avatar tidak valid (harus http/https)' };
    return res.redirect('/dashboard/profile');
  }
  if (raw.length > 500) {
    req.session.flash = { type: 'error', message: 'URL terlalu panjang (max 500 karakter)' };
    return res.redirect('/dashboard/profile');
  }
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(raw || null, req.user.id);
  req.session.flash = {
    type: 'success',
    message: raw ? 'Foto profil diperbarui' : 'Foto profil di-reset ke default',
  };
  res.redirect('/dashboard/profile');
});

router.post(
  '/profile',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Nama minimal 2 karakter'),
    body('new_password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password baru minimal 6 karakter'),
  ],
  (req, res) => {
    const errors = validationResult(req).array();
    const { name, current_password, new_password, confirm_password } = req.body;

    if (new_password) {
      const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
      if (!current_password || !bcrypt.compareSync(current_password, user.password)) {
        errors.push({ msg: 'Password lama salah' });
      }
      if (new_password !== confirm_password) {
        errors.push({ msg: 'Konfirmasi password baru tidak cocok' });
      }
    }

    if (errors.length) {
      return res.status(400).render('pages/dashboard/profile', {
        title: 'Profil',
        activeMenu: 'profile',
        errors,
        success: null,
      });
    }

    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    if (new_password) {
      const hashed = bcrypt.hashSync(new_password, 12);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
    }
    req.session.flash = { type: 'success', message: 'Profil berhasil diperbarui' };
    res.redirect('/dashboard/profile');
  }
);

module.exports = router;
