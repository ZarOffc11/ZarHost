'use strict';

/**
 * Wrapper di atas `cloudpanel-sdk` untuk semua aksi provisioning.
 * Setiap fungsi: connect → eksekusi → disconnect.
 *
 * Mode SKIP_CLOUDPANEL=true akan melewatkan semua SSH dan hanya men-generate
 * kredensial dummy supaya alur aplikasi (testing lokal tanpa VPS) tetap berjalan.
 */

const crypto = require('crypto');
const db = require('./db');

let CloudPanel;
try {
  ({ CloudPanel } = require('cloudpanel-sdk'));
} catch (err) {
  console.warn('[cloudpanel] cloudpanel-sdk not installed yet:', err.message);
  CloudPanel = null;
}

function isSkipMode() {
  return String(process.env.SKIP_CLOUDPANEL || '').toLowerCase() === 'true';
}

function sanitize(domain) {
  return String(domain || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'site';
}

function generatePassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const special = '!@#$%^&*';
  let out = '';
  for (let i = 0; i < len - 2; i++) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  out += special[crypto.randomInt(0, special.length)];
  out += String(crypto.randomInt(10, 99));
  return out;
}

function logProvision(hostingId, action, status, message) {
  try {
    db.prepare(
      'INSERT INTO provision_logs (hosting_id, action, status, message) VALUES (?, ?, ?, ?)'
    ).run(hostingId, action, status, String(message || '').slice(0, 2000));
  } catch (err) {
    console.error('[cloudpanel] failed to write provision_logs:', err.message);
  }
}

async function getCP(overrideConfig) {
  if (!CloudPanel) {
    throw new Error('cloudpanel-sdk tidak terpasang. Jalankan `npm install cloudpanel-sdk` lebih dulu.');
  }
  const config = overrideConfig || {
    host: process.env.CLOUDPANEL_HOST,
    username: process.env.CLOUDPANEL_USER || 'root',
    password: process.env.CLOUDPANEL_PASSWORD,
    port: parseInt(process.env.CLOUDPANEL_PORT, 10) || 22,
    timeout: 20000,
  };
  if (!config.host) throw new Error('CLOUDPANEL_HOST tidak diset');
  const cp = new CloudPanel(config);
  await cp.connect();
  return cp;
}

/**
 * Cek koneksi & instalasi CloudPanel di VPS.
 * Optional: pass overrideConfig untuk testing form admin.
 */
async function checkCloudPanel(overrideConfig) {
  if (isSkipMode()) {
    return {
      installed: true,
      version: 'skip-mode',
      details: 'SKIP_CLOUDPANEL=true — koneksi nyata dilewati untuk dev mode.',
    };
  }
  let cp;
  try {
    cp = await getCP(overrideConfig);
    const result = await cp.check();
    cp.disconnect();
    return result;
  } catch (err) {
    if (cp) try { cp.disconnect(); } catch (_) {}
    return { installed: false, version: null, details: err.message };
  }
}

async function provisionHosting(hosting, packageData) {
  const serverIp = process.env.SERVER_IP || process.env.CLOUDPANEL_HOST || '';
  const ftpHost = process.env.CLOUDPANEL_HOST || '';

  const siteUser = sanitize(hosting.domain) + '_u';
  const siteUserPassword = generatePassword(16);
  const dbName = sanitize(hosting.domain) + '_db';
  const dbUser = sanitize(hosting.domain) + '_user';
  const dbPass = generatePassword(16);

  const credentialsRow = {
    site_user: siteUser,
    site_user_pass: siteUserPassword,
    db_name: dbName,
    db_user: dbUser,
    db_pass: dbPass,
    db_host: 'localhost',
    db_port: 3306,
    ftp_host: ftpHost,
    ftp_port: 21,
    server_ip: serverIp,
  };

  if (isSkipMode()) {
    saveCredentials(hosting.id, credentialsRow);
    logProvision(hosting.id, 'provision', 'success', 'SKIP_CLOUDPANEL: dummy credentials only');
    return { success: true, skipped: true, credentials: credentialsRow };
  }

  let cp;
  try {
    cp = await getCP();
    const check = await cp.check();
    if (!check.installed) {
      throw new Error('CloudPanel tidak terdeteksi di VPS: ' + (check.details || ''));
    }

    const vhostTemplate =
      packageData && packageData.name && /pro|business|enterprise/i.test(packageData.name)
        ? 'WordPress'
        : 'Generic';

    const siteRes = await cp.site.addPhp({
      domainName: hosting.domain,
      phpVersion: '8.4',
      vhostTemplate,
      siteUser,
      siteUserPassword,
    });
    if (!siteRes.success) {
      throw new Error('site.addPhp gagal: ' + (siteRes.stderr || siteRes.stdout || 'unknown'));
    }

    const dbRes = await cp.database.add({
      domainName: hosting.domain,
      databaseName: dbName,
      databaseUserName: dbUser,
      databaseUserPassword: dbPass,
    });
    if (!dbRes.success) {
      throw new Error('database.add gagal: ' + (dbRes.stderr || dbRes.stdout || 'unknown'));
    }

    // SSL — tidak fatal jika gagal (mungkin DNS belum di-pointing)
    try {
      const sslRes = await cp.letsEncrypt.installCertificate({
        domainName: hosting.domain,
      });
      if (!sslRes.success) {
        logProvision(
          hosting.id,
          'ssl',
          'failed',
          (sslRes.stderr || '') + (sslRes.stdout || '')
        );
      }
    } catch (sslErr) {
      logProvision(hosting.id, 'ssl', 'failed', sslErr.message);
    }

    cp.disconnect();
    saveCredentials(hosting.id, credentialsRow);
    logProvision(hosting.id, 'provision', 'success', `Site ${hosting.domain} created`);
    return { success: true, credentials: credentialsRow };
  } catch (err) {
    if (cp) try { cp.disconnect(); } catch (_) {}
    logProvision(hosting.id, 'provision', 'failed', err.message);
    throw err;
  }
}

function saveCredentials(hostingId, c) {
  // Replace existing credentials for this hosting (if retry)
  db.prepare('DELETE FROM hosting_credentials WHERE hosting_id = ?').run(hostingId);
  db.prepare(
    `INSERT INTO hosting_credentials (
      hosting_id, site_user, site_user_pass, db_name, db_user, db_pass,
      db_host, db_port, ftp_host, ftp_port, server_ip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    hostingId,
    c.site_user, c.site_user_pass,
    c.db_name, c.db_user, c.db_pass,
    c.db_host || 'localhost', c.db_port || 3306,
    c.ftp_host || '', c.ftp_port || 21,
    c.server_ip || ''
  );
}

async function renewHosting(hosting) {
  if (isSkipMode()) {
    logProvision(hosting.id, 'renew', 'success', 'SKIP_CLOUDPANEL');
    return { success: true, skipped: true };
  }
  // If hosting was suspended, reactivate
  if (hosting.status !== 'suspended') {
    logProvision(hosting.id, 'renew', 'success', 'Active hosting renewed (DB only)');
    return { success: true, ssh: false };
  }
  let cp;
  try {
    cp = await getCP();
    // CloudPanel doesn't have a built-in enable; we reload nginx as a best-effort
    await cp.exec('clp-nginx --reload || systemctl reload nginx');
    cp.disconnect();
    logProvision(hosting.id, 'renew', 'success', 'Reactivated suspended site');
    return { success: true, ssh: true };
  } catch (err) {
    if (cp) try { cp.disconnect(); } catch (_) {}
    logProvision(hosting.id, 'renew', 'failed', err.message);
    throw err;
  }
}

async function suspendHosting(hosting) {
  if (isSkipMode()) {
    logProvision(hosting.id, 'suspend', 'success', 'SKIP_CLOUDPANEL');
    return { success: true, skipped: true };
  }
  let cp;
  try {
    cp = await getCP();
    // Best-effort suspend: disable nginx site config if found.
    const safe = String(hosting.domain).replace(/[^a-zA-Z0-9.\-_]/g, '');
    const cmd =
      `if [ -f /etc/nginx/sites-enabled/${safe}.conf ]; then ` +
      `mv /etc/nginx/sites-enabled/${safe}.conf /etc/nginx/sites-available/${safe}.conf.suspended 2>/dev/null && ` +
      `(clp-nginx --reload || systemctl reload nginx); fi; echo OK`;
    await cp.exec(cmd);
    cp.disconnect();
    logProvision(hosting.id, 'suspend', 'success', 'Site suspended');
    return { success: true };
  } catch (err) {
    if (cp) try { cp.disconnect(); } catch (_) {}
    logProvision(hosting.id, 'suspend', 'failed', err.message);
    throw err;
  }
}

async function deleteHosting(hosting) {
  if (isSkipMode()) {
    logProvision(hosting.id, 'delete', 'success', 'SKIP_CLOUDPANEL');
    return { success: true, skipped: true };
  }
  let cp;
  try {
    cp = await getCP();
    const res = await cp.site.delete({ domainName: hosting.domain, force: true });
    cp.disconnect();
    if (!res.success) throw new Error(res.stderr || 'site.delete failed');
    logProvision(hosting.id, 'delete', 'success', 'Site deleted');
    return { success: true };
  } catch (err) {
    if (cp) try { cp.disconnect(); } catch (_) {}
    logProvision(hosting.id, 'delete', 'failed', err.message);
    throw err;
  }
}

async function installSSL(domainName) {
  if (isSkipMode()) return { success: true, skipped: true };
  let cp;
  try {
    cp = await getCP();
    const res = await cp.letsEncrypt.installCertificate({ domainName });
    cp.disconnect();
    return { success: !!res.success, message: res.stderr || res.stdout || '' };
  } catch (err) {
    if (cp) try { cp.disconnect(); } catch (_) {}
    return { success: false, message: err.message };
  }
}

module.exports = {
  checkCloudPanel,
  provisionHosting,
  renewHosting,
  suspendHosting,
  deleteHosting,
  installSSL,
  // helpers exposed for tests / advanced use
  _internal: { sanitize, generatePassword },
};
