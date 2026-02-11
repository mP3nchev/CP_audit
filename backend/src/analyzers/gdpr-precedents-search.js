/**
 * GDPR Precedents Search - Find Similar Cases from GDPR Hub Database
 *
 * Purpose: Search 1500+ DPA decisions to find similar violation cases
 * Data Source: GDPR Decisions Database - 2023-2025.csv
 * Based on: Script for Filtering GDPR Decision_Database.txt (Python version)
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// CSV file path — check multiple locations for deployment compatibility
const CSV_FILENAME = 'GDPR Decisions Database - 2023-2025.csv';
const CSV_CANDIDATES = [
  path.join(__dirname, '../../data', CSV_FILENAME),    // backend/data/ (Railway)
  path.join(__dirname, '../../..', CSV_FILENAME),       // project root (local dev)
  path.join(process.cwd(), CSV_FILENAME),               // working directory fallback
  path.join(process.cwd(), 'data', CSV_FILENAME),       // cwd/data/ fallback
];
const CSV_PATH = CSV_CANDIDATES.find(p => fs.existsSync(p)) || CSV_CANDIDATES[0];

/**
 * Violation keywords mapping
 * Maps violation types to search keywords
 */
const VIOLATION_KEYWORDS = {
  tracking_without_consent: [
    'tracking', 'analytics', 'cookies', 'without consent', 'before consent',
    'prior consent', 'no consent', 'eprivacy'
  ],
  analytics_before_consent: [
    'analytics', 'google analytics', 'prior consent', 'before consent',
    'tracking before', 'ga', 'measurement'
  ],
  invalid_reject_mechanism: [
    'reject', 'consent banner', 'ineffective', 'withdrawal', 'dark pattern',
    'not equally prominent', 'difficult to refuse'
  ],
  pre_ticked_boxes: [
    'pre-ticked', 'pre-checked', 'default', 'opt-out', 'silence',
    'inactivity', 'checkbox'
  ],
  no_reject_button: [
    'reject button', 'first layer', 'decline', 'banner design',
    'equally prominent', 'consent interface'
  ],
  consent_mode_missing: [
    'google consent mode', 'consent management', 'tag manager',
    'gtag', 'google analytics', 'consent framework'
  ],
  tracking_cookies: [
    'tracking cookies', '_ga', '_gid', 'facebook pixel', 'advertising cookies',
    'marketing cookies', 'analytics cookies'
  ],
  security_breach: [
    'data breach', 'security', 'unauthorized access', 'leaked', 'hacked',
    'compromised', 'article 32', 'article 34'
  ],
  no_privacy_policy: [
    'privacy policy', 'transparency', 'article 13', 'article 14',
    'information', 'disclosure'
  ],
  unlawful_processing: [
    'unlawful processing', 'legal basis', 'article 6', 'consent',
    'legitimate interest', 'contract', 'legal obligation'
  ],
  data_retention: [
    'retention', 'storage limitation', 'article 5', 'excessive',
    'longer than necessary', 'retention period'
  ],
  missing_dpo: [
    'data protection officer', 'dpo', 'article 37', 'contact details'
  ]
};

/**
 * Check if text matches violation keywords
 * @param {string} text - Text to search
 * @param {string} violationType - Violation type key
 * @returns {boolean} True if match found
 */
function textMatchesViolation(text, violationType) {
  if (!text) return false;

  const keywords = VIOLATION_KEYWORDS[violationType] || [];
  const lowerText = text.toLowerCase();

  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Parse CSV file and return all rows
 * @returns {Promise<Array>} Array of decision objects
 */
async function loadDecisions() {
  return new Promise((resolve, reject) => {
    const decisions = [];

    if (!fs.existsSync(CSV_PATH)) {
      console.warn(`⚠️  GDPR CSV file not found: ${CSV_PATH}`);
      return resolve([]);
    }

    fs.createReadStream(CSV_PATH, { encoding: 'utf8' })
      .pipe(csv({ skipLines: 1 }))
      .on('data', (row) => {
        decisions.push(row);
      })
      .on('end', () => {
        console.log(`✅ Loaded ${decisions.length} GDPR decisions from database`);
        resolve(decisions);
      })
      .on('error', (error) => {
        console.error(`❌ Error reading CSV: ${error.message}`);
        reject(error);
      });
  });
}

/**
 * Extract fine amount from text (handles various formats)
 * @param {string} fineText - Fine text from CSV (e.g., "27000000 EUR", "€5,000")
 * @returns {number} Fine amount in EUR
 */
function parseFine(fineText) {
  if (!fineText || fineText.trim() === '' || fineText === 'N/A' || fineText === '0') {
    return 0;
  }

  // Remove currency symbols, commas, and spaces
  const cleaned = fineText.replace(/[€EUR,\s]/gi, '').trim();

  // Parse as number
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? 0 : amount;
}

/**
 * Search for similar GDPR precedents
 * @param {Array<string>} detectedViolations - List of violation type keys
 * @param {Object} options - Search options
 * @param {number} options.maxResults - Max results to return (default: 10)
 * @param {boolean} options.requireFine - Only return cases with fines (default: false)
 * @param {string} options.jurisdiction - Filter by jurisdiction (e.g., "France", "Germany")
 * @param {number} options.minYear - Min decision year (e.g., 2023)
 * @returns {Promise<Object>} Search results
 */
async function searchPrecedents(detectedViolations, options = {}) {
  const {
    maxResults = 10,
    requireFine = false,
    jurisdiction = null,
    minYear = null
  } = options;

  console.log('');
  console.log('🔍 Searching GDPR precedents...');
  console.log(`   Violations: ${detectedViolations.join(', ')}`);

  // Load decisions from CSV
  const allDecisions = await loadDecisions();

  if (allDecisions.length === 0) {
    return {
      detected_violations: detectedViolations,
      cases_found: 0,
      cases: []
    };
  }

  // Filter matching decisions
  const matchedWithFines = [];
  const matchedWithoutFines = [];

  allDecisions.forEach(decision => {
    const summary = decision.Summary || '';
    const articles = decision['Relevant GDPR articles'] || '';
    const laws = decision['Relevant EU laws'] || '';
    const combinedText = `${summary} ${articles} ${laws}`;

    // Check if matches any violation
    const matches = detectedViolations.some(violation =>
      textMatchesViolation(combinedText, violation)
    );

    if (!matches) return;

    // Apply jurisdiction filter
    if (jurisdiction && decision.Jurisdiction) {
      if (!decision.Jurisdiction.toLowerCase().includes(jurisdiction.toLowerCase())) {
        return;
      }
    }

    // Apply year filter
    if (minYear && decision['Date of decision']) {
      const decisionYear = parseInt(decision['Date of decision'].split('.')[2]); // DD.MM.YYYY
      if (isNaN(decisionYear) || decisionYear < minYear) {
        return;
      }
    }

    // Parse fine
    const fine = parseFine(decision.Fine);
    const hasFine = fine > 0;

    // Add to appropriate list
    if (hasFine) {
      matchedWithFines.push({
        ...decision,
        fine_eur: fine
      });
    } else {
      matchedWithoutFines.push({
        ...decision,
        fine_eur: 0
      });
    }
  });

  // Prioritize cases with fines
  let finalCases = matchedWithFines.length > 0 ? matchedWithFines : matchedWithoutFines;

  // If requireFine is true, only return cases with fines
  if (requireFine) {
    finalCases = matchedWithFines;
  }

  // Sort by fine amount (descending)
  finalCases.sort((a, b) => b.fine_eur - a.fine_eur);

  // Limit results
  finalCases = finalCases.slice(0, maxResults);

  console.log(`   ✅ Found ${finalCases.length} matching cases`);
  console.log(`   💰 Cases with fines: ${matchedWithFines.length}`);
  console.log(`   ℹ️  Cases without fines: ${matchedWithoutFines.length}`);
  console.log('');

  return {
    detected_violations: detectedViolations,
    cases_found: finalCases.length,
    cases: finalCases.map(c => ({
      dpa: c['Decision by'] || 'Unknown DPA',
      case_number: c['Case number/name'] || 'N/A',
      jurisdiction: c.Jurisdiction || 'Unknown',
      date: c['Date of decision'] || 'Unknown',
      articles: c['Relevant GDPR articles'] || '',
      fine_eur: c.fine_eur,
      fine_formatted: c.fine_eur > 0 ? `€${c.fine_eur.toLocaleString()}` : 'No fine',
      summary: c.Summary || 'No summary available',
      outcome: c['Type of decision & outcome'] || 'Unknown'
    }))
  };
}

/**
 * Get relevant precedents for current audit violations
 * @param {Object} auditData - Audit data with detected violations
 * @returns {Promise<Object>} Precedents search results
 */
async function getRelevantPrecedents(auditData) {
  const detectedViolations = [];

  // Map audit data to violation types
  if (auditData.trackingBeforeConsent) {
    detectedViolations.push('tracking_without_consent');
    detectedViolations.push('analytics_before_consent');
  }

  if (auditData.bannerViolations) {
    auditData.bannerViolations.forEach(v => {
      if (v.id === 'type_a') detectedViolations.push('no_reject_button');
      if (v.id === 'type_b') detectedViolations.push('pre_ticked_boxes');
      if (['type_c', 'type_d', 'type_e', 'type_k'].includes(v.id)) {
        detectedViolations.push('invalid_reject_mechanism');
      }
    });
  }

  if (auditData.consentModeStatus?.detected === false && auditData.consentModeStatus?.ga4Present) {
    detectedViolations.push('consent_mode_missing');
  }

  if (auditData.undeclaredCookies && auditData.undeclaredCookies.length > 0) {
    detectedViolations.push('tracking_cookies');
  }

  // Deduplicate
  const uniqueViolations = [...new Set(detectedViolations)];

  if (uniqueViolations.length === 0) {
    return {
      detected_violations: [],
      cases_found: 0,
      cases: []
    };
  }

  // Search precedents
  return await searchPrecedents(uniqueViolations, {
    maxResults: 10,
    requireFine: false, // Include all cases, but prioritize with fines
    minYear: 2023 // Only recent cases (2023+)
  });
}

module.exports = {
  searchPrecedents,
  getRelevantPrecedents,
  VIOLATION_KEYWORDS
};
