/**
 * Database Migration: Add Banner Detection Column
 *
 * Adds the following column:
 * - scan_results.banner_detection_json
 */

const Database = require('better-sqlite3');
const path = require('path');

/**
 * Run database migration
 * @param {Database} dbConnection - Optional existing database connection
 */
function migrate(dbConnection = null) {
  console.log('📊 Running banner detection database migration...');

  let db = dbConnection;
  let shouldCloseDb = false;

  if (!db) {
    const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../../audits.db');
    console.log(`   Opening database at: ${dbPath}`);
    db = new Database(dbPath);
    shouldCloseDb = true;
  }

  try {
    const scanResultsInfo = db.prepare("PRAGMA table_info(scan_results)").all();
    const columnNames = scanResultsInfo.map(col => col.name);

    let migrationsApplied = 0;

    if (!columnNames.includes('banner_detection_json')) {
      console.log('  ✅ Adding column: banner_detection_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN banner_detection_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: banner_detection_json');
    }

    console.log(`✅ Banner detection migration complete! ${migrationsApplied} changes applied.\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    throw error;
  } finally {
    if (shouldCloseDb && db) {
      db.close();
    }
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
