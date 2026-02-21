'use strict';
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;

function log(data) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'db', ...data }) + '\n');
}

/**
 * Initialize the SQLite database and create tables
 */
function initDatabase() {
  try {
    const dbPath = path.resolve(__dirname, '../../audits.db');

    // Create database connection
    db = new Database(dbPath);

    // WAL mode for concurrent reads + safe writes
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');       // Safe with WAL; faster than FULL
    db.pragma('wal_autocheckpoint = 1000');  // Checkpoint every 1000 pages
    db.pragma('busy_timeout = 10000');       // Wait up to 10s before SQLITE_BUSY
    db.pragma('foreign_keys = ON');

    // Integrity check on startup
    const integrityResult = db.pragma('integrity_check');
    if (!integrityResult.length || integrityResult[0].integrity_check !== 'ok') {
      throw new Error(`DB integrity check failed: ${JSON.stringify(integrityResult)}`);
    }

    log({ level: 'info', event: 'db_init', wal: true, path: dbPath });

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema (create tables)
    db.exec(schema);

    log({ level: 'info', event: 'db_schema_applied' });

    return db;
  } catch (error) {
    log({ level: 'error', event: 'db_init_failed', error: error.message });
    throw error;
  }
}

/**
 * Get database instance
 */
function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close database connection
 */
function closeDatabase() {
  if (db) {
    db.close();
    log({ level: 'info', event: 'db_closed' });
  }
}

/**
 * Health check for database
 */
function checkDatabaseHealth() {
  try {
    const result = db.prepare('SELECT 1 as health').get();
    return result.health === 1;
  } catch (error) {
    log({ level: 'error', event: 'db_health_check_failed', error: error.message });
    return false;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  checkDatabaseHealth
};
