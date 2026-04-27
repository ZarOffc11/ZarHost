'use strict';

const express = require('express');
const db = require('../lib/db');

const router = express.Router();

router.get('/', (req, res) => {
  const packages = db.prepare(
    'SELECT * FROM packages WHERE is_active = 1 ORDER BY price_monthly ASC'
  ).all();
  res.render('pages/index', {
    title: 'Hosting Cepat, Aman & Terpercaya',
    packages,
  });
});

router.get('/pricing', (req, res) => {
  const packages = db.prepare(
    'SELECT * FROM packages WHERE is_active = 1 ORDER BY price_monthly ASC'
  ).all();
  res.render('pages/pricing', {
    title: 'Paket Hosting',
    packages,
  });
});

module.exports = router;
