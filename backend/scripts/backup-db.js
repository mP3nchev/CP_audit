'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../audits.db');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '../backups'));
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '30');

function log(data) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'backup', ...data }) + '\n');
}

async function backup() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `audits_${ts}.db`);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(backupPath);
    log({ level: 'info', event: 'backup_created', path: backupPath });
  } finally {
    db.close();
  }

  // Prune old backups — keep MAX_BACKUPS most recent
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('audits_') && f.endsWith('.db'))
    .sort();                               // ISO timestamps sort lexically
  const toDelete = files.slice(0, Math.max(0, files.length - MAX_BACKUPS));
  toDelete.forEach(f => {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    log({ level: 'info', event: 'backup_pruned', file: f });
  });

  return backupPath;
}

// Allow import as module (for periodic backup from server.js)
module.exports = { backup };

// Run directly
if (require.main === module) {
  backup().catch(err => {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'backup_failed', error: err.message }) + '\n');
    process.exit(1);
  });
}
