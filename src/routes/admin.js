'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../lib/db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const cloudpanel = require('../lib/cloudpanel');

const router = express.Router();
router.use(requireLogin, requireAdmin);

/* ---------------- Dashboard ---------------- */
router.get('/', (req, res) => {
  const startMonth = new Date();
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);

  const stats = {
    users: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'user'").get().c,
    transactions: db.prepare("SELECT COUNT(*) AS c FROM transactions").get().c,
    revenue: db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS s FROM transactions WHERE status='SUCCESS' AND created_at >= ?`
    ).get(startMonth.toISOString()).s,
    hostingActive: db.prepare("SELECT COUNT(*) AS c FROM hostings WHERE status = 'active'").get().c,
  };

  // 6-month revenue chart
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setMonth(next.getMonth() + 1);
    const sum = db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS s FROM transactions
        WHERE status='SUCCESS' AND created_at >= ? AND created_at < ?`
    ).get(d.toISOString(), next.toISOString()).s;
    months.push({
      label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }),
      revenue: sum,
    });
  }

  const recentTx = db.prepare(
    `SELECT t.*, p.name AS package_name, u.name AS user_name FROM transactions t
       JOIN packages p ON p.id = t.package_id
       JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT 10`
  ).all();

  res.render('pages/admin/index', {
    title: 'Admin Dashboard',
    activeMenu: 'home',
    stats,
    months,
    recentTx,
  });
});

/* ---------------- Users ---------------- */
router.get('/users', (req, res) => {
  const q = (req.query.q || '').trim();
  const users = q
    ? db.prepare(
        `SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC`
      ).all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.render('pages/admin/users', {
    title: 'Manajemen User',
    activeMenu: 'users',
    users,
    q,
  });
});

router.post('/users/:id/toggle', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u || u.id === req.user.id) return res.redirect('/admin/users');
  const next = u.status === 'suspended' ? 'active' : 'suspended';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(next, u.id);
  req.session.flash = { type: 'success', message: `User ${u.email} → ${next}` };
  res.redirect('/admin/users');
});

/* ---------------- Hostings ---------------- */
router.get('/hostings', (req, res) => {
  const status = (req.query.status || '').toLowerCase();
  let rows;
  if (['active', 'expired', 'suspended', 'pending', 'provision_failed'].includes(status)) {
    rows = db.prepare(
      `SELECT h.*, u.email AS user_email, u.name AS user_name, p.name AS package_name
         FROM hostings h
         JOIN users u ON u.id = h.user_id
         JOIN packages p ON p.id = h.package_id
        WHERE h.status = ?
        ORDER BY h.created_at DESC`
    ).all(status);
  } else {
    rows = db.prepare(
      `SELECT h.*, u.email AS user_email, u.name AS user_name, p.name AS package_name
         FROM hostings h
         JOIN users u ON u.id = h.user_id
         JOIN packages p ON p.id = h.package_id
        ORDER BY h.created_at DESC`
    ).all();
  }
  res.render('pages/admin/hostings', {
    title: 'Manajemen Hosting',
    activeMenu: 'hostings',
    hostings: rows,
    filterStatus: status,
  });
});

router.post('/hostings/:id/suspend', async (req, res) => {
  const h = db.prepare('SELECT * FROM hostings WHERE id = ?').get(req.params.id);
  if (!h) return res.redirect('/admin/hostings');
  try { await cloudpanel.suspendHosting(h); } catch (e) { /* logged */ }
  db.prepare("UPDATE hostings SET status = 'suspended' WHERE id = ?").run(h.id);
  req.session.flash = { type: 'success', message: `Hosting ${h.domain} di-suspend` };
  res.redirect('/admin/hostings');
});

router.post('/hostings/:id/activate', (req, res) => {
  const h = db.prepare('SELECT * FROM hostings WHERE id = ?').get(req.params.id);
  if (!h) return res.redirect('/admin/hostings');
  db.prepare("UPDATE hostings SET status = 'active' WHERE id = ?").run(h.id);
  req.session.flash = { type: 'success', message: `Hosting ${h.domain} diaktifkan` };
  res.redirect('/admin/hostings');
});

router.post('/hostings/:id/retry', async (req, res) => {
  const h = db.prepare('SELECT * FROM hostings WHERE id = ?').get(req.params.id);
  if (!h) return res.redirect('/admin/hostings');
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(h.package_id);
  try {
    await cloudpanel.provisionHosting(h, pkg);
    db.prepare("UPDATE hostings SET status = 'active' WHERE id = ?").run(h.id);
    req.session.flash = { type: 'success', message: `Provisioning ${h.domain} berhasil` };
  } catch (err) {
    db.prepare("UPDATE hostings SET status = 'provision_failed' WHERE id = ?").run(h.id);
    req.session.flash = { type: 'error', message: `Retry gagal: ${err.message}` };
  }
  res.redirect('/admin/hostings');
});

/* ---------------- Transactions ---------------- */
router.get('/transactions', (req, res) => {
  const status = (req.query.status || '').toUpperCase();
  let rows;
  if (['SUCCESS', 'PENDING', 'EXPIRED', 'CANCELED'].includes(status)) {
    rows = db.prepare(
      `SELECT t.*, p.name AS package_name, u.email AS user_email, u.name AS user_name
         FROM transactions t
         JOIN packages p ON p.id = t.package_id
         JOIN users u ON u.id = t.user_id
        WHERE t.status = ?
        ORDER BY t.created_at DESC`
    ).all(status);
  } else {
    rows = db.prepare(
      `SELECT t.*, p.name AS package_name, u.email AS user_email, u.name AS user_name
         FROM transactions t
         JOIN packages p ON p.id = t.package_id
         JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC`
    ).all();
  }
  res.render('pages/admin/transactions', {
    title: 'Riwayat Transaksi',
    activeMenu: 'transactions',
    transactions: rows,
    filterStatus: status,
  });
});

/* ---------------- Packages ---------------- */
router.get('/packages', (req, res) => {
  const packages = db.prepare('SELECT * FROM packages ORDER BY price_monthly ASC').all();
  res.render('pages/admin/packages', {
    title: 'Manajemen Paket',
    activeMenu: 'packages',
    packages,
    editing: null,
    errors: [],
    formData: {},
  });
});

router.get('/packages/new', (req, res) => {
  const packages = db.prepare('SELECT * FROM packages ORDER BY price_monthly ASC').all();
  res.render('pages/admin/packages', {
    title: 'Tambah Paket',
    activeMenu: 'packages',
    packages,
    editing: { id: null },
    errors: [],
    formData: { is_active: 1, ssl: 1, backup: 0, max_sites: 1 },
  });
});

router.get('/packages/:id/edit', (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.redirect('/admin/packages');
  const packages = db.prepare('SELECT * FROM packages ORDER BY price_monthly ASC').all();
  res.render('pages/admin/packages', {
    title: `Edit ${pkg.name}`,
    activeMenu: 'packages',
    packages,
    editing: pkg,
    errors: [],
    formData: pkg,
  });
});

const packageValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Nama minimal 2 karakter'),
  body('price_monthly').toInt().isInt({ min: 1000 }).withMessage('Harga minimal Rp 1.000'),
  body('disk_gb').toInt().isInt({ min: 1 }),
  body('bandwidth_gb').toInt().isInt({ min: 1 }),
  body('max_sites').toInt().isInt({ min: 1 }),
];

router.post('/packages', packageValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const packages = db.prepare('SELECT * FROM packages ORDER BY price_monthly ASC').all();
    return res.status(400).render('pages/admin/packages', {
      title: 'Tambah Paket',
      activeMenu: 'packages',
      packages,
      editing: { id: null },
      errors: errors.array(),
      formData: req.body,
    });
  }
  const b = req.body;
  db.prepare(
    `INSERT INTO packages (name, description, price_monthly, disk_gb, bandwidth_gb, max_sites, ssl, backup, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    b.name, b.description || '',
    b.price_monthly, b.disk_gb, b.bandwidth_gb, b.max_sites,
    b.ssl ? 1 : 0, b.backup ? 1 : 0, b.is_active ? 1 : 0
  );
  req.session.flash = { type: 'success', message: 'Paket ditambahkan' };
  res.redirect('/admin/packages');
});

router.post('/packages/:id', packageValidation, (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.redirect('/admin/packages');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const packages = db.prepare('SELECT * FROM packages ORDER BY price_monthly ASC').all();
    return res.status(400).render('pages/admin/packages', {
      title: `Edit ${pkg.name}`,
      activeMenu: 'packages',
      packages,
      editing: pkg,
      errors: errors.array(),
      formData: req.body,
    });
  }
  const b = req.body;
  db.prepare(
    `UPDATE packages SET name=?, description=?, price_monthly=?, disk_gb=?, bandwidth_gb=?,
       max_sites=?, ssl=?, backup=?, is_active=? WHERE id=?`
  ).run(
    b.name, b.description || '',
    b.price_monthly, b.disk_gb, b.bandwidth_gb, b.max_sites,
    b.ssl ? 1 : 0, b.backup ? 1 : 0, b.is_active ? 1 : 0,
    pkg.id
  );
  req.session.flash = { type: 'success', message: 'Paket diperbarui' };
  res.redirect('/admin/packages');
});

router.post('/packages/:id/delete', (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.redirect('/admin/packages');
  // Soft delete: deactivate (keeps FK intact)
  db.prepare('UPDATE packages SET is_active = 0 WHERE id = ?').run(pkg.id);
  req.session.flash = { type: 'success', message: 'Paket dinonaktifkan' };
  res.redirect('/admin/packages');
});

/* ---------------- VPS Config ---------------- */
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

router.get('/vps-config', (req, res) => {
  const cfg = {
    host: getSetting('vps_host') || process.env.CLOUDPANEL_HOST || '',
    user: getSetting('vps_user') || process.env.CLOUDPANEL_USER || 'root',
    port: getSetting('vps_port') || process.env.CLOUDPANEL_PORT || '22',
    has_password: !!(getSetting('vps_password') || process.env.CLOUDPANEL_PASSWORD),
    ns1: getSetting('ns1') || process.env.NS1 || '',
    ns2: getSetting('ns2') || process.env.NS2 || '',
  };
  res.render('pages/admin/vps_config', {
    title: 'Konfigurasi VPS',
    activeMenu: 'vps',
    cfg,
  });
});

router.post('/vps-config', (req, res) => {
  const { host, user, port, password, ns1, ns2 } = req.body;
  if (host) setSetting('vps_host', host.trim());
  if (user) setSetting('vps_user', user.trim());
  if (port) setSetting('vps_port', String(parseInt(port, 10) || 22));
  if (password) setSetting('vps_password', password);
  if (ns1) setSetting('ns1', ns1.trim());
  if (ns2) setSetting('ns2', ns2.trim());

  // also reflect in process.env so subsequent calls in this process pick them up
  if (host) process.env.CLOUDPANEL_HOST = host.trim();
  if (user) process.env.CLOUDPANEL_USER = user.trim();
  if (port) process.env.CLOUDPANEL_PORT = String(parseInt(port, 10) || 22);
  if (password) process.env.CLOUDPANEL_PASSWORD = password;
  if (ns1) process.env.NS1 = ns1.trim();
  if (ns2) process.env.NS2 = ns2.trim();

  req.session.flash = { type: 'success', message: 'Konfigurasi VPS disimpan' };
  res.redirect('/admin/vps-config');
});

router.post('/api/test-vps', async (req, res) => {
  const { host, user, port, password } = req.body || {};
  const config = {
    host: (host || getSetting('vps_host') || process.env.CLOUDPANEL_HOST || '').trim(),
    username: (user || getSetting('vps_user') || process.env.CLOUDPANEL_USER || 'root').trim(),
    port: parseInt(port || getSetting('vps_port') || process.env.CLOUDPANEL_PORT || '22', 10),
    password: password || getSetting('vps_password') || process.env.CLOUDPANEL_PASSWORD,
    timeout: 15000,
  };
  if (!config.host) return res.json({ ok: false, message: 'Host wajib diisi' });
  if (!config.password) return res.json({ ok: false, message: 'Password SSH wajib diisi' });
  try {
    const result = await cloudpanel.checkCloudPanel(config);
    return res.json({
      ok: !!result.installed,
      message: result.details || (result.installed ? 'Terdeteksi' : 'Tidak ditemukan'),
      version: result.version || null,
    });
  } catch (err) {
    return res.json({ ok: false, message: err.message });
  }
});

module.exports = router;
