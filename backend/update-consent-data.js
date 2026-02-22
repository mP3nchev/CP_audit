#!/usr/bin/env node

/**
 * Updates consent simulation data for a specific audit directly in the database.
 * Designed to run as a pre-start step on Railway.
 * Exits with code 0 even if audit not found (so server still starts).
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const AUDIT_UID = 'aud_51a21fc1aa7574ad';
const DATABASE_PATH = process.env.DATABASE_URL || './audits.db';

const CONSENT_DATA = {
  consentRequired: true,
  howToConsent: {
    requiresInteraction: true,
    steps: [
      'Отваря се cookie banner при първо посещение',
      'Банерът показва бутони "Приемам" и "Отказвам"',
      'Потребителят трябва да кликне на един от бутоните за да даде съгласие'
    ],
    consentMechanism: 'cookie-banner',
    optInRequired: true,
    location: 'bottom-banner'
  }
};

function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('📝 UPDATE CONSENT DATA - Direct Database Update');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Audit UID: ${AUDIT_UID}`);
  console.log(`   Database: ${DATABASE_PATH}`);
  console.log('');

  try {
    const dbPath = path.resolve(DATABASE_PATH);
    console.log(`📂 Opening database: ${dbPath}`);
    const db = new Database(dbPath);

    // Apply schema first so tables exist even before server has started
    const schemaPath = path.join(__dirname, 'src/database/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schema);
      console.log('✅ Schema applied');
    }

    // Look up by audit_uid (TEXT), not id (INTEGER)
    const audit = db.prepare('SELECT * FROM audits WHERE audit_uid = ?').get(AUDIT_UID);

    if (!audit) {
      console.log(`⚠️  Audit ${AUDIT_UID} not found - skipping (normal on fresh deployment)`);
      db.close();
      process.exit(0); // Must be 0 so server still starts
    }

    console.log(`✅ Found audit: ${audit.website_url} (id: ${audit.id})`);
    console.log(`   Status: ${audit.status}`);
    console.log('');

    // Consent data lives in scan_results.consent_simulation_json
    const scanResult = db.prepare('SELECT * FROM scan_results WHERE audit_id = ?').get(audit.id);

    const newConsent = {
      consentRequired: CONSENT_DATA.consentRequired,
      howToConsent: CONSENT_DATA.howToConsent,
      updatedAt: new Date().toISOString()
    };

    if (scanResult) {
      const existing = scanResult.consent_simulation_json
        ? JSON.parse(scanResult.consent_simulation_json)
        : {};
      const merged = { ...existing, ...newConsent };

      db.prepare('UPDATE scan_results SET consent_simulation_json = ? WHERE audit_id = ?')
        .run(JSON.stringify(merged), audit.id);
      console.log('✅ Updated consent_simulation_json in existing scan_results row');
    } else {
      db.prepare(`
        INSERT INTO scan_results
          (audit_id, cookies_json, network_requests_json, consent_simulation_json, scan_duration_seconds, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(audit.id, '[]', '[]', JSON.stringify(newConsent), 0);
      console.log('✅ Inserted new scan_results row with consent data');
    }

    console.log('');
    console.log('🎉 DONE! Consent data updated successfully.');
    db.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
