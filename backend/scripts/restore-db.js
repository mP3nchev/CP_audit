'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../audits.db');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '../backups'));

function log(data) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'restore', ...data }) + '\n');
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) { console.log('No backups directory found.'); return; }
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('audits_') && f.endsWith('.db'))
    .sort().reverse();
  if (!files.length) { console.log('No backups found.'); return; }
  console.log('Available backups (newest first):');
  files.forEach((f, i) => console.log(`  [${i}] ${f}`));
}

function restore(backupFile) {
  const backupPath = path.isAbsolute(backupFile) ? backupFile : path.join(BACKUP_DIR, backupFile);
  if (!fs.existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);

  // Verify backup integrity before touching production DB
  const check = new Database(backupPath, { readonly: true });
  const result = check.pragma('integrity_check');
  check.close();
  if (!result.length || result[0].integrity_check !== 'ok') {
    throw new Error(`Backup integrity check failed: ${JSON.stringify(result)}`);
  }

  // Preserve current DB
  if (fs.existsSync(DB_PATH)) {
    const bak = `${DB_PATH}.before-restore.${Date.now()}`;
    fs.copyFileSync(DB_PATH, bak);
    log({ level: 'info', event: 'current_db_preserved', path: bak });
  }

  fs.copyFileSync(backupPath, DB_PATH);
  log({ level: 'info', event: 'restore_complete', from: backupPath, to: DB_PATH });
  console.log(`Restored from: ${backupPath}`);
}

const arg = process.argv[2];
if (!arg) { listBackups(); process.exit(0); }
restore(arg);
