#!/usr/bin/env node

/**
 * Simple script to update consent data for an audit
 * No browser needed - just updates the database directly
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const AUDIT_ID = 'aud_51a21fc1aa7574ad';
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

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('📝 UPDATE CONSENT DATA - Direct Database Update');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Audit ID: ${AUDIT_ID}`);
  console.log(`   Database: ${DATABASE_PATH}`);
  console.log('');

  try {
    // Open database
    const dbPath = path.resolve(DATABASE_PATH);
    console.log(`📂 Opening database: ${dbPath}`);
    const db = new Database(dbPath);

    // Get current audit data
    const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(AUDIT_ID);

    if (!audit) {
      console.error(`❌ Audit ${AUDIT_ID} not found in database!`);
      process.exit(1);
    }

    console.log(`✅ Found audit: ${audit.website}`);
    console.log(`   Status: ${audit.status}`);
    console.log('');

    // Parse current results
    let results = JSON.parse(audit.results || '{}');

    console.log('📝 Current consent data:');
    console.log(`   consentRequired: ${results.consentRequired || 'not set'}`);
    console.log(`   howToConsent: ${results.howToConsent ? 'set' : 'not set'}`);
    console.log('');

    // Update consent data
    results.consentRequired = CONSENT_DATA.consentRequired;
    results.howToConsent = CONSENT_DATA.howToConsent;

    // Update database
    console.log('💾 Updating database...');
    const stmt = db.prepare('UPDATE audits SET results = ?, updated_at = ? WHERE id = ?');
    const info = stmt.run(
      JSON.stringify(results),
      new Date().toISOString(),
      AUDIT_ID
    );

    if (info.changes > 0) {
      console.log('✅ Database updated successfully!');
      console.log('');
      console.log('📊 New consent data:');
      console.log(`   consentRequired: ${results.consentRequired}`);
      console.log(`   howToConsent.requiresInteraction: ${results.howToConsent.requiresInteraction}`);
      console.log(`   howToConsent.optInRequired: ${results.howToConsent.optInRequired}`);
      console.log(`   howToConsent.consentMechanism: ${results.howToConsent.consentMechanism}`);
      console.log(`   howToConsent.steps: ${results.howToConsent.steps.length} steps`);
      console.log('');
      console.log('🎉 DONE! The consent data has been updated in the database.');
      console.log('');
      console.log('ℹ️  To sync this to production (Railway), you need to:');
      console.log('   1. Copy audits.db to Railway, OR');
      console.log('   2. Run this script on Railway directly');
    } else {
      console.error('❌ Failed to update database (no rows changed)');
      process.exit(1);
    }

    db.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
