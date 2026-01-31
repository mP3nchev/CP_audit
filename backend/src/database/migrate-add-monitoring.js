/**
 * Database Migration: Add Consent Monitoring Columns
 *
 * Adds the following columns:
 * - scan_results.monitoring_data_json
 * - scan_results.monitoring_analysis_json
 * - scan_results.detected_vendors_json
 * - scan_results.vendor_summary_json
 */

const Database = require('better-sqlite3');
const path = require('path');

/**
 * Run database migrations
 * @param {Database} dbConnection - Optional existing database connection
 */
function migrate(dbConnection = null) {
  console.log('📊 Running consent monitoring database migrations...');

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

    // Add monitoring_data_json if it doesn't exist
    if (!columnNames.includes('monitoring_data_json')) {
      console.log('  ✅ Adding column: monitoring_data_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN monitoring_data_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: monitoring_data_json');
    }

    // Add monitoring_analysis_json if it doesn't exist
    if (!columnNames.includes('monitoring_analysis_json')) {
      console.log('  ✅ Adding column: monitoring_analysis_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN monitoring_analysis_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: monitoring_analysis_json');
    }

    // Add detected_vendors_json if it doesn't exist
    if (!columnNames.includes('detected_vendors_json')) {
      console.log('  ✅ Adding column: detected_vendors_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN detected_vendors_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: detected_vendors_json');
    }

    // Add vendor_summary_json if it doesn't exist
    if (!columnNames.includes('vendor_summary_json')) {
      console.log('  ✅ Adding column: vendor_summary_json');
      db.prepare(`
        ALTER TABLE scan_results
        ADD COLUMN vendor_summary_json TEXT
      `).run();
      migrationsApplied++;
    } else {
      console.log('  ⏭️  Column already exists: vendor_summary_json');
    }

    console.log(`✅ Migration complete! ${migrationsApplied} changes applied.\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    throw error;
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
