'use strict';

const cron = require('node-cron');
const db = require('./db');
const cloudpanel = require('./cloudpanel');

/**
 * Setiap jam:
 *  - Tandai hosting yang expired_at < now AND status='active' → suspended
 *  - Pasang juga di CloudPanel via SSH (best-effort)
 */
function start() {
  const task = cron.schedule('0 * * * *', async () => {
    await runOnce();
  });
  task.start();
  console.log('[cron] auto-expire scheduler started (every hour)');
  return task;
}

async function runOnce() {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT * FROM hostings WHERE status = 'active' AND expired_at IS NOT NULL AND expired_at < ?`
  ).all(now);
  if (!rows.length) return { suspended: 0 };

  let count = 0;
  for (const h of rows) {
    try {
      await cloudpanel.suspendHosting(h);
    } catch (err) {
      console.error('[cron] suspend failed for', h.domain, err.message);
    }
    db.prepare("UPDATE hostings SET status = 'suspended' WHERE id = ?").run(h.id);
    count++;
  }
  console.log(`[cron] suspended ${count} expired hosting(s)`);
  return { suspended: count };
}

module.exports = { start, runOnce };
