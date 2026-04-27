'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../lib/db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('pages/login', { title: 'Login', errors: [], formData: {} });
});

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email tidak valid').normalizeEmail(),
    body('password').notEmpty().withMessage('Password wajib diisi'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('pages/login', {
        title: 'Login',
        errors: errors.array(),
        formData: req.body,
      });
    }
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).render('pages/login', {
        title: 'Login',
        errors: [{ msg: 'Email atau password salah' }],
        formData: { email },
      });
    }
    if (user.status === 'suspended') {
      return res.status(403).render('pages/login', {
        title: 'Login',
        errors: [{ msg: 'Akun Anda telah di-suspend. Hubungi admin.' }],
        formData: { email },
      });
    }
    req.session.userId = user.id;
    req.session.flash = { type: 'success', message: `Selamat datang, ${user.name}!` };
    if (user.role === 'admin') return res.redirect('/admin');
    return res.redirect('/dashboard');
  }
);

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('pages/register', { title: 'Register', errors: [], formData: {} });
});

router.post(
  '/register',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Nama minimal 2 karakter'),
    body('email').isEmail().withMessage('Email tidak valid').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password minimal 6 karakter'),
    body('confirm_password').custom((v, { req }) => {
      if (v !== req.body.password) throw new Error('Konfirmasi password tidak cocok');
      return true;
    }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('pages/register', {
        title: 'Register',
        errors: errors.array(),
        formData: req.body,
      });
    }
    const { name, email, password } = req.body;
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) {
      return res.status(409).render('pages/register', {
        title: 'Register',
        errors: [{ msg: 'Email sudah terdaftar' }],
        formData: req.body,
      });
    }
    const hashed = bcrypt.hashSync(password, 12);
    const result = db.prepare(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
    ).run(name, email, hashed, 'user');
    req.session.userId = result.lastInsertRowid;
    req.session.flash = { type: 'success', message: 'Pendaftaran berhasil! Selamat datang.' };
    res.redirect('/dashboard');
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
