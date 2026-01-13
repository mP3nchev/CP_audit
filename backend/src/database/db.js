const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;

/**
 * Initialize the SQLite database and create tables
 */
function initDatabase() {
  try {
    const dbPath = path.resolve(__dirname, '../../audits.db');

    // Create database connection
    db = new Database(dbPath, { verbose: console.log });

    console.log('✅ Database connection established');

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema (create tables)
    db.exec(schema);

    console.log('✅ Database tables created successfully');

    return db;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
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
    console.log('✅ Database connection closed');
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
    console.error('❌ Database health check failed:', error);
    return false;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  checkDatabaseHealth
};
