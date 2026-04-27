'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'zarhost.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT DEFAULT 'user',
      status      TEXT DEFAULT 'active',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS packages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      description   TEXT,
      price_monthly INTEGER NOT NULL,
      disk_gb       INTEGER NOT NULL,
      bandwidth_gb  INTEGER NOT NULL,
      max_sites     INTEGER DEFAULT 1,
      ssl           INTEGER DEFAULT 1,
      backup        INTEGER DEFAULT 0,
      is_active     INTEGER DEFAULT 1,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hostings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id  INTEGER NOT NULL REFERENCES packages(id),
      domain      TEXT NOT NULL,
      status      TEXT DEFAULT 'pending',
      started_at  DATETIME,
      expired_at  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hosting_credentials (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      hosting_id      INTEGER NOT NULL REFERENCES hostings(id) ON DELETE CASCADE,
      site_user       TEXT,
      site_user_pass  TEXT,
      db_name         TEXT,
      db_user         TEXT,
      db_pass         TEXT,
      db_host         TEXT DEFAULT 'localhost',
      db_port         INTEGER DEFAULT 3306,
      ftp_host        TEXT,
      ftp_port        INTEGER DEFAULT 21,
      server_ip       TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hosting_id      INTEGER REFERENCES hostings(id) ON DELETE SET NULL,
      package_id      INTEGER NOT NULL REFERENCES packages(id),
      domain          TEXT,
      trx_id          TEXT UNIQUE,
      type            TEXT DEFAULT 'new',
      duration_months INTEGER DEFAULT 1,
      base_amount     INTEGER NOT NULL,
      ppn_amount      INTEGER NOT NULL,
      total_amount    INTEGER NOT NULL,
      fee             INTEGER DEFAULT 0,
      unique_code     INTEGER DEFAULT 0,
      qr_string       TEXT,
      status          TEXT DEFAULT 'PENDING',
      expiry          INTEGER,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at         DATETIME
    );

    CREATE TABLE IF NOT EXISTS provision_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      hosting_id  INTEGER REFERENCES hostings(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,
      status      TEXT NOT NULL,
      message     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_hostings_user      ON hostings(user_id);
    CREATE INDEX IF NOT EXISTS idx_hostings_status    ON hostings(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_user  ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_trx   ON transactions(trx_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
  `);

  // Forward-migration: tabel lama mungkin masih punya kolom nameserver1/2.
  // Tambahkan server_ip jika belum ada, biarkan kolom lama (tidak fatal).
  const cols = db.prepare("PRAGMA table_info(hosting_credentials)").all().map((c) => c.name);
  if (!cols.includes('server_ip')) {
    db.exec("ALTER TABLE hosting_credentials ADD COLUMN server_ip TEXT");
  }
}

function seed() {
  // Seed packages
  const count = db.prepare('SELECT COUNT(*) AS c FROM packages').get().c;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO packages (name, description, price_monthly, disk_gb, bandwidth_gb, max_sites, ssl, backup)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const data = [
      ['Starter',    'Cocok untuk personal & portofolio',   29000,   5,   50,  1, 1, 0],
      ['Pro',        'Untuk bisnis kecil & blog aktif',     59000,  15,  150,  3, 1, 1],
      ['Business',   'Performa tinggi untuk toko online',  119000,  50,  500, 10, 1, 1],
      ['Enterprise', 'Solusi enterprise tanpa batas',      249000, 150, 2000, 50, 1, 1],
    ];
    const tx = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
    tx(data);
  }

  // Seed admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@zarhost.id';
  const adminName = process.env.ADMIN_NAME || 'Administrator';
  const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    const hashed = bcrypt.hashSync(adminPass, 12);
    db.prepare(`
      INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')
    `).run(adminName, adminEmail, hashed);
    console.log(`[db] Admin user seeded: ${adminEmail}`);
  }
}

migrate();
seed();

module.exports = db;
