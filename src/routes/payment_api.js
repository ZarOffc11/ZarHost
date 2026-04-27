'use strict';

const express = require('express');
const db = require('../lib/db');
const payment = require('../lib/payment');
const cloudpanel = require('../lib/cloudpanel');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

/**
 * Polling endpoint — frontend hits this every 5s.
 * Will:
 *  - hit gateway for fresh status
 *  - if SUCCESS and our DB still PENDING → mark transaction success,
 *    activate hosting (or extend expired_at on renew),
 *    fire off cloudpanel provisioning (best effort, async-resilient).
 */
router.get('/status/:trxId', async (req, res) => {
  const trx = db.prepare(
    'SELECT * FROM transactions WHERE trx_id = ? AND user_id = ?'
  ).get(req.params.trxId, req.user.id);
  if (!trx) return res.status(404).json({ error: 'Not found' });

  let gwData = null;
  try {
    gwData = await payment.checkStatus(trx.trx_id);
  } catch (err) {
    // Gateway hiccup — return our current DB status, don't fail the polling
    return res.json({
      status: trx.status,
      type: trx.type,
      domain: trx.domain,
      hosting_id: trx.hosting_id,
      expiry: trx.expiry,
      gatewayError: err.message,
    });
  }

  const newStatus = String(gwData.status || trx.status).toUpperCase();

  if (newStatus !== trx.status && trx.status === 'PENDING') {
    if (newStatus === 'SUCCESS') {
      await handlePaymentSuccess(trx);
    } else if (newStatus === 'EXPIRED' || newStatus === 'CANCELED') {
      db.prepare('UPDATE transactions SET status = ? WHERE id = ?').run(newStatus, trx.id);
      // Tidy up pending hosting
      if (trx.type === 'new' && trx.hosting_id) {
        const h = db.prepare('SELECT status FROM hostings WHERE id = ?').get(trx.hosting_id);
        if (h && h.status === 'pending') {
          db.prepare('DELETE FROM hostings WHERE id = ?').run(trx.hosting_id);
        }
      }
    }
  }

  const fresh = db.prepare('SELECT status, type, domain, hosting_id, expiry FROM transactions WHERE id = ?').get(trx.id);
  res.json({
    status: fresh.status,
    type: fresh.type,
    domain: fresh.domain,
    hosting_id: fresh.hosting_id,
    expiry: fresh.expiry,
  });
});

async function handlePaymentSuccess(trx) {
  const nowIso = new Date().toISOString();
  const months = trx.duration_months || 1;

  if (trx.type === 'new') {
    const hosting = db.prepare('SELECT * FROM hostings WHERE id = ?').get(trx.hosting_id);
    if (!hosting) return;
    const startedAt = new Date();
    const expiredAt = new Date(startedAt.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    db.prepare(
      `UPDATE hostings SET status = 'active', started_at = ?, expired_at = ? WHERE id = ?`
    ).run(startedAt.toISOString(), expiredAt.toISOString(), hosting.id);
    db.prepare(
      `UPDATE transactions SET status = 'SUCCESS', paid_at = ? WHERE id = ?`
    ).run(nowIso, trx.id);

    // Fire-and-forget provisioning. Failures set status = provision_failed.
    setImmediate(async () => {
      try {
        const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(hosting.package_id);
        await cloudpanel.provisionHosting(
          { ...hosting, started_at: startedAt.toISOString(), expired_at: expiredAt.toISOString() },
          pkg
        );
      } catch (err) {
        console.error('[provision] failed:', err.message);
        db.prepare("UPDATE hostings SET status = 'provision_failed' WHERE id = ?").run(hosting.id);
      }
    });
  } else if (trx.type === 'renew') {
    const hosting = db.prepare('SELECT * FROM hostings WHERE id = ?').get(trx.hosting_id);
    if (!hosting) return;
    let baseDate = hosting.expired_at ? new Date(hosting.expired_at) : new Date();
    if (baseDate < new Date()) baseDate = new Date();
    const newExpired = new Date(baseDate.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    db.prepare(
      `UPDATE hostings SET status = 'active', expired_at = ? WHERE id = ?`
    ).run(newExpired.toISOString(), hosting.id);
    db.prepare(
      `UPDATE transactions SET status = 'SUCCESS', paid_at = ? WHERE id = ?`
    ).run(nowIso, trx.id);

    setImmediate(async () => {
      try {
        await cloudpanel.renewHosting({ ...hosting, expired_at: newExpired.toISOString() });
      } catch (err) {
        console.error('[renew-provision] failed:', err.message);
      }
    });
  }
}

module.exports = router;
