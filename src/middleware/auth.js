'use strict';

const db = require('../lib/db');

function avatarFor(user) {
  if (!user) return '';
  if (user.avatar_url && /^https?:\/\//i.test(user.avatar_url)) return user.avatar_url;
  const name = encodeURIComponent(user.name || user.email || 'User');
  // ui-avatars: nama → initials, background emerald (brand), color white.
  return `https://ui-avatars.com/api/?name=${name}&background=10B981&color=ffffff&bold=true&size=128&format=svg`;
}

function attachLayoutFlags(req, res, next) {
  const p = req.path || '';
  res.locals.showSidebar = p.startsWith('/dashboard') || p.startsWith('/admin');
  res.locals.path = p;
  next();
}

function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare(
      'SELECT id, name, email, role, status, avatar_url, created_at FROM users WHERE id = ?'
    ).get(req.session.userId);
    if (user) {
      user.avatar = avatarFor(user);
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Stale session
      req.session.destroy(() => {});
    }
  }
  res.locals.brand = process.env.BRAND_NAME || 'ZarHost';
  res.locals.avatarFor = avatarFor;
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
  attachLayoutFlags,
  requireLogin,
  requireAdmin,
  flashConsumer,
  avatarFor,
};
