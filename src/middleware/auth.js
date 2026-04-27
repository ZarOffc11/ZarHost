'use strict';

const db = require('../lib/db');

function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = ?'
    ).get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Stale session
      req.session.destroy(() => {});
    }
  }
  res.locals.brand = process.env.BRAND_NAME || 'ZarHost';
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.accepts('html')) {
      req.session.flash = { type: 'error', message: 'Silakan login terlebih dahulu' };
      return res.redirect('/auth/login');
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    if (req.accepts('html')) {
      return res.redirect('/dashboard');
    }
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function flashConsumer(req, res, next) {
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;
  next();
}

module.exports = {
  attachUser,
  requireLogin,
  requireAdmin,
  flashConsumer,
};
