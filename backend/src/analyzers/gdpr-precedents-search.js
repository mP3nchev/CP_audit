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
 * High-profile companies to exclude (users don't believe fines at that scale apply to SMBs)
 */
const EXCLUDED_COMPANIES = [
  'google', 'alphabet', 'facebook', 'meta', 'instagram', 'whatsapp',
  'tiktok', 'bytedance', 'shein', 'amazon', 'apple', 'microsoft',
  'twitter', 'x corp', 'linkedin', 'youtube', 'snapchat', 'uber',
  'airbnb', 'booking.com', 'spotify'
];

/**
 * Max fine to display (€20M — above this users find it unrealistic for SMBs)
 */
const MAX_FINE_EUR = 20_000_000;

/**
 * Approximate EUR conversion rates for non-eurozone EU countries
 * Updated periodically — close enough for risk assessment purposes
 */
const NON_EURO_RATES = {
  'HUF': 400,    // Hungarian Forint  — 1 EUR ≈ 400 HUF
  'SEK': 11.5,   // Swedish Krona     — 1 EUR ≈ 11.5 SEK
  'PLN': 4.3,    // Polish Zloty      — 1 EUR ≈ 4.3 PLN
  'CZK': 25.0,   // Czech Koruna      — 1 EUR ≈ 25 CZK
  'RON': 5.0,    // Romanian Leu      — 1 EUR ≈ 5 RON
  'DKK': 7.46,   // Danish Krone      — 1 EUR ≈ 7.46 DKK
  'GBP': 0.85,   // British Pound (UK post-Brexit, still relevant for precedent amounts)
  'CHF': 0.93,   // Swiss Franc
  'NOK': 11.7,   // Norwegian Krone
};

/**
 * Industry-specific keywords for filtering relevant precedents
 */
const INDUSTRY_KEYWORDS = {
  ecommerce: [
    'e-commerce', 'ecommerce', 'online shop', 'online store', 'retail', 'webshop',
    'marketplace', 'shopping', 'purchase', 'order', 'product', 'customer data',
    'loyalty program', 'newsletter', 'promotional email', 'direct marketing',
    'advertising', 'remarketing', 'tracking pixel', 'cookies', 'analytics',
    'payment', 'checkout', 'cart', 'consumer', 'buyer'
  ],
  b2b: [
    'b2b', 'business to business', 'crm', 'lead generation', 'sales',
    'marketing automation', 'prospecting', 'cold email', 'outreach',
    'linkedin', 'professional', 'corporate client', 'enterprise',
    'service provider', 'supplier', 'vendor', 'contractor'
  ],
  corporate: [
    'corporate', 'employee', 'hr', 'human resources', 'payroll', 'workforce',
    'staff', 'personnel', 'recruitment', 'hiring', 'applicant',
    'monitoring', 'cctv', 'surveillance', 'workplace', 'internal',
    'data breach', 'security incident', 'access control', 'internal data'
  ],
  saas: [
    'saas', 'software', 'platform', 'app', 'application', 'api', 'cloud',
    'subscription', 'user account', 'account data', 'login', 'authentication',
    'analytics', 'tracking', 'cookies', 'consent', 'data processor',
    'data controller', 'third party', 'integration', 'plugin', 'widget'
  ]
};

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
 */
function textMatchesViolation(text, violationType) {
  if (!text) return false;
  const keywords = VIOLATION_KEYWORDS[violationType] || [];
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Check if a decision involves an excluded high-profile company
 */
function isExcludedCompany(decision) {
  const textToCheck = [
    decision['Decision by'] || '',
    decision['Case number/name'] || '',
    decision.Summary || ''
  ].join(' ').toLowerCase();

  return EXCLUDED_COMPANIES.some(company => textToCheck.includes(company));
}

/**
 * Try to extract a EUR amount mentioned explicitly in text
 * e.g., "equivalent to €200,000" or "approximately €50,000"
 * @param {string} text
 * @returns {number|null} EUR amount or null
 */
function extractEurFromText(text) {
  if (!text) return null;

  // Pattern: "equivalent to €X,XXX" or "(approximately €X,XXX)" or "€X,XXX"
  const patterns = [
    /equivalent\s+to[^€]*€\s*([\d,\.]+)/i,
    /approx(?:imately)?\s*€\s*([\d,\.]+)/i,
    /\(€\s*([\d,\.]+)\)/,
    /EUR\s+([\d,\.]+)/i,
    /€\s*([\d,\.]+)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) {
        return amount;
      }
    }
  }
  return null;
}

/**
 * Parse fine amount from CSV text (handles various formats + non-euro currencies)
 *
 * @param {string} fineText - Fine text from CSV (e.g., "27000000 EUR", "€5,000", "80000000 HUF")
 * @param {string} summaryText - Decision summary (used to find EUR equivalent)
 * @returns {{ eur: number, originalCurrency: string, originalAmount: number, isConverted: boolean }}
 */
function parseFine(fineText, summaryText = '') {
  const result = { eur: 0, originalCurrency: 'EUR', originalAmount: 0, isConverted: false };

  if (!fineText || fineText.trim() === '' || fineText === 'N/A' || fineText === '0') {
    return result;
  }

  const fineStr = fineText.trim();

  // 1. Check for non-euro currency explicitly in fine text
  for (const [currency, rate] of Object.entries(NON_EURO_RATES)) {
    const pattern = new RegExp(`([\\d\\s,\\.]+)\\s*${currency}|${currency}\\s*([\\d\\s,\\.]+)`, 'i');
    const match = fineStr.match(pattern);
    if (match) {
      const rawAmount = (match[1] || match[2]).replace(/[\s,]/g, '');
      const amount = parseFloat(rawAmount);
      if (!isNaN(amount) && amount > 0) {
        result.originalCurrency = currency;
        result.originalAmount = amount;

        // Prefer explicit EUR equivalent from summary text (more accurate)
        const eurFromSummary = extractEurFromText(summaryText);
        if (eurFromSummary && eurFromSummary > 0) {
          result.eur = eurFromSummary;
          result.isConverted = true;
        } else {
          result.eur = Math.round(amount / rate);
          result.isConverted = true;
        }
        return result;
      }
    }
  }

  // 2. Parse as EUR amount
  // Remove currency symbols but preserve digits, dots, commas, and separators
  const cleaned = fineStr
    .replace(/€/g, '')
    .replace(/\bEUR\b/gi, '')
    .trim();

  // Take only the first number segment (handles "20000 & 30000" type entries)
  // Also handles corrupted entries like "2000030000" that are actually two concatenated amounts
  const firstSegment = cleaned.split(/[&,+\/]/)[0].trim();
  const amount = parseFloat(firstSegment.replace(/\s/g, ''));

  if (isNaN(amount) || amount <= 0) {
    return result;
  }

  // 3. Sanity check: if amount looks suspiciously large (> MAX_FINE_EUR),
  //    try to extract a more realistic EUR amount from the summary
  if (amount > MAX_FINE_EUR && summaryText) {
    const eurFromSummary = extractEurFromText(summaryText);
    if (eurFromSummary && eurFromSummary > 0 && eurFromSummary <= MAX_FINE_EUR) {
      result.eur = eurFromSummary;
      result.originalCurrency = 'EUR';
      result.originalAmount = eurFromSummary;
      return result;
    }
    // Still too large — return 0 so it gets filtered out by the >MAX_FINE_EUR check
    return result;
  }

  result.eur = amount;
  result.originalCurrency = 'EUR';
  result.originalAmount = amount;
  return result;
}

/**
 * Format fine for display (amount only, NO € symbol — frontend adds its own)
 * @param {number} eurAmount
 * @param {string} originalCurrency
 * @param {number} originalAmount
 * @param {boolean} isConverted
 * @returns {string}
 */
function formatFine(eurAmount, originalCurrency, originalAmount, isConverted) {
  if (eurAmount <= 0) return 'No fine';

  const eurFormatted = eurAmount.toLocaleString('de-DE');  // e.g., "200.000"

  if (isConverted && originalCurrency !== 'EUR') {
    const origFormatted = originalAmount.toLocaleString('de-DE');
    return `${eurFormatted} (${origFormatted} ${originalCurrency})`;
  }

  return eurFormatted;
}

/**
 * Parse CSV file and return all rows
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
 * Check if a case is relevant for the given industry
 * @param {string} combinedText - Combined text to search
 * @param {string} industry - Industry key (ecommerce, b2b, corporate, saas)
 * @returns {boolean}
 */
function matchesIndustry(combinedText, industry) {
  if (!industry) return true; // No industry filter — show all

  const keywords = INDUSTRY_KEYWORDS[industry.toLowerCase()] || [];
  if (keywords.length === 0) return true;

  const lowerText = combinedText.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw));
}

/**
 * Search for similar GDPR precedents
 * @param {Array<string>} detectedViolations - List of violation type keys
 * @param {Object} options - Search options
 * @param {number} options.maxResults - Max results to return (default: 8)
 * @param {boolean} options.requireFine - Only return cases with fines (default: false)
 * @param {string} options.jurisdiction - Filter by jurisdiction
 * @param {number} options.minYear - Min decision year
 * @param {string} options.industry - Industry filter (ecommerce, b2b, corporate, saas)
 * @returns {Promise<Object>} Search results
 */
async function searchPrecedents(detectedViolations, options = {}) {
  const {
    maxResults = 8,
    requireFine = false,
    jurisdiction = null,
    minYear = null,
    industry = null
  } = options;

  console.log('');
  console.log('🔍 Searching GDPR precedents...');
  console.log(`   Violations: ${detectedViolations.join(', ')}`);
  if (industry) console.log(`   Industry filter: ${industry}`);

  const allDecisions = await loadDecisions();

  if (allDecisions.length === 0) {
    return { detected_violations: detectedViolations, cases_found: 0, cases: [] };
  }

  const matchedWithFines = [];
  const matchedWithoutFines = [];

  allDecisions.forEach(decision => {
    const summary = decision.Summary || '';
    const articles = decision['Relevant GDPR articles'] || '';
    const laws = decision['Relevant EU laws'] || '';
    const combinedText = `${summary} ${articles} ${laws}`;

    // Skip excluded high-profile companies
    if (isExcludedCompany(decision)) return;

    // Check violation match
    const matches = detectedViolations.some(violation =>
      textMatchesViolation(combinedText, violation)
    );
    if (!matches) return;

    // Apply jurisdiction filter
    if (jurisdiction && decision.Jurisdiction) {
      if (!decision.Jurisdiction.toLowerCase().includes(jurisdiction.toLowerCase())) return;
    }

    // Apply year filter
    if (minYear && decision['Date of decision']) {
      const decisionYear = parseInt(decision['Date of decision'].split('.')[2]);
      if (isNaN(decisionYear) || decisionYear < minYear) return;
    }

    // Parse fine (pass summary for EUR equivalent detection)
    const fineResult = parseFine(decision.Fine, summary);

    // Skip fines above maximum threshold
    if (fineResult.eur > MAX_FINE_EUR) return;

    // Apply industry filter — prefer industry-matched, but fall back to all if insufficient
    const industryMatched = matchesIndustry(combinedText, industry);

    const caseData = {
      ...decision,
      fine_eur: fineResult.eur,
      fine_original_currency: fineResult.originalCurrency,
      fine_original_amount: fineResult.originalAmount,
      fine_is_converted: fineResult.isConverted,
      industry_matched: industryMatched
    };

    if (fineResult.eur > 0) {
      matchedWithFines.push(caseData);
    } else {
      matchedWithoutFines.push(caseData);
    }
  });

  // Prioritize cases with fines
  let finalCases = matchedWithFines.length > 0 ? matchedWithFines : matchedWithoutFines;
  if (requireFine) finalCases = matchedWithFines;

  // Sort: industry-matched first, then by fine amount descending
  finalCases.sort((a, b) => {
    if (industry) {
      // Industry-matched cases come first
      if (a.industry_matched && !b.industry_matched) return -1;
      if (!a.industry_matched && b.industry_matched) return 1;
    }
    return b.fine_eur - a.fine_eur;
  });

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
      // NO € prefix here — the frontend <Euro /> icon adds its own symbol
      fine_formatted: c.fine_eur > 0
        ? formatFine(c.fine_eur, c.fine_original_currency, c.fine_original_amount, c.fine_is_converted)
        : 'No fine',
      summary: c.Summary || 'No summary available',
      outcome: c['Type of decision & outcome'] || 'Unknown'
    }))
  };
}

/**
 * Get relevant precedents for current audit violations
 * @param {Object} auditData - Audit data with detected violations
 * @param {string} auditData.industry - Industry key for filtering
 * @returns {Promise<Object>} Precedents search results
 */
async function getRelevantPrecedents(auditData) {
  const detectedViolations = [];

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

  const uniqueViolations = [...new Set(detectedViolations)];

  if (uniqueViolations.length === 0) {
    return { detected_violations: [], cases_found: 0, cases: [] };
  }

  return await searchPrecedents(uniqueViolations, {
    maxResults: 8,
    requireFine: false,
    minYear: 2022,
    industry: auditData.industry || null
  });
}

module.exports = {
  searchPrecedents,
  getRelevantPrecedents,
  VIOLATION_KEYWORDS,
  INDUSTRY_KEYWORDS
};
