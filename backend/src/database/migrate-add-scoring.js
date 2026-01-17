/**
 * Database Migration: Add Compliance Scoring Columns
 *
 * Adds the following columns:
 * - scan_results.compliance_score_json
 * - scan_results.request_categorization_json
 */

const Database = require('better-sqlite3');
const path = require('path');

/**
 * Run database migrations
 * @param {Database} dbConnection - Optional existing database connection
 */
function migrate(dbConnection = null) {
  console.log('📊 Running database migrations...');

  // Use provided connection or create new one
  let db = dbConnection;
  let shouldCloseDb = false;

  if (!db) {
    const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../../audits.db');
    console.log(`   Opening database at: ${dbPath}`);
    db = new Database(dbPath);
    shouldCloseDb = true;
  }

  try {
    // Check if columns already exist
    const scanResultsInfo = db.prepare("PRAGMA table_info(scan_results)").all();
    const columnNames = scanResultsInfo.map(col => col.name);

    let migrationsApplied = 0;

    // Add compliance_score_json if it doesn't exist
    if (!columnNames.includes('compliance_score_json')) {
      console.log('  ✅ Adding column: compliance_score_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN compliance_score_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: compliance_score_json');
    }

    // Add request_categorization_json if it doesn't exist
    if (!columnNames.includes('request_categorization_json')) {
      console.log('  ✅ Adding column: request_categorization_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN request_categorization_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: request_categorization_json');
    }

    console.log(`✅ Migration complete! ${migrationsApplied} changes applied.\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    throw error; // Re-throw instead of process.exit(1)
  } finally {
    // Only close if we opened it
    if (shouldCloseDb && db) {
      db.close();
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate();
}

module.exports = { migrate };
