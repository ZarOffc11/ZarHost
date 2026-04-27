'use strict';

const PPN_RATE = 0.11;

/**
 * Compute pricing breakdown for a hosting purchase / renewal.
 *
 * @param {number} priceMonthly - package price per month (IDR, before PPN)
 * @param {number} months       - number of months (1, 3, 6, 12)
 * @returns {{base: number, ppn: number, total: number, months: number}}
 */
function calc(priceMonthly, months) {
  const m = Math.max(1, parseInt(months, 10) || 1);
  const base = priceMonthly * m;
  const ppn = Math.ceil(base * PPN_RATE);
  const total = base + ppn;
  return { base, ppn, total, months: m };
}

function formatIDR(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return 'Rp 0';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

module.exports = { calc, formatIDR, PPN_RATE };
