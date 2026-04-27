'use strict';

const axios = require('axios');
const QRCode = require('qrcode');

const BASE_URL = process.env.PAYMENT_BASE_URL || 'https://fr3newera.com/api/v1';

function apiKey() {
  const k = process.env.PAYMENT_API_KEY;
  if (!k) {
    throw new Error('PAYMENT_API_KEY is not set in environment');
  }
  return k;
}

/**
 * Create a QRIS payment.
 * @param {number} nominal - amount in IDR (already includes PPN; this is the amount the gateway receives)
 * @returns {Promise<{trxId, qr_string, totalTransfer, fee, uniqueCode, expiry, amount}>}
 */
async function createPayment(nominal) {
  const { data } = await axios.post(
    `${BASE_URL}/topup`,
    { apikey: apiKey(), nominal },
    { timeout: 20000, headers: { 'Content-Type': 'application/json' } }
  );
  if (data.status !== 200 || !data.data) {
    throw new Error(data.message || 'Gagal membuat pembayaran');
  }
  return data.data;
}

async function cancelPayment(trxId) {
  const { data } = await axios.post(
    `${BASE_URL}/topup/cancel`,
    { apikey: apiKey(), trxId },
    { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
  );
  return {
    success: data.status === 200,
    message: data.message || '',
  };
}

async function checkStatus(trxId) {
  const { data } = await axios.get(`${BASE_URL}/check-status`, {
    params: { apikey: apiKey(), idTransaksi: trxId },
    timeout: 15000,
  });
  if (data.status !== 200 || !data.data) {
    throw new Error(data.message || 'Gagal memeriksa status pembayaran');
  }
  return data.data;
}

/**
 * Render a raw QRIS string into a base64-encoded PNG data URI.
 * @param {string} qrString
 * @returns {Promise<string>}
 */
async function renderQR(qrString) {
  if (!qrString) return null;
  return QRCode.toDataURL(qrString, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360,
    color: { dark: '#0A0A0F', light: '#FFFFFF' },
  });
}

module.exports = {
  createPayment,
  cancelPayment,
  checkStatus,
  renderQR,
};
