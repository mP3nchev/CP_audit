const { analyzeWithClaude } = require('../integrations/claude-api');
const { extractTextFromBuffer } = require('../utils/text-extractor');

/**
 * Compare Cookie Policy declarations with detected cookies
 * @param {Buffer} policyBuffer - Cookie Policy file buffer
 * @param {string} filename - Original filename
 * @param {Array} detectedCookies - Cookies from scanner
 * @param {number} auditId - Audit ID
 * @returns {Promise<Object>} Comparison result
 */
async function compareCookiePolicy(policyBuffer, filename, detectedCookies, auditId) {
  try {
    console.log('🍪 Comparing Cookie Policy with detected cookies...');

    // Step 1: Extract text from Cookie Policy
    const policyText = await extractTextFromBuffer(policyBuffer, filename);

    if (!policyText || policyText.length < 100) {
      throw new Error('Cookie Policy text extraction failed or document too short');
    }

    console.log(`  📄 Extracted ${policyText.length} characters from Cookie Policy`);

    // Step 2: Extract declared cookies using Claude API
    const declaredCookies = await extractDeclaredCookies(policyText);
    console.log(`  ✅ Found ${declaredCookies.length} declared cookies in policy`);

    // Step 3: Match declared vs detected
    const comparison = matchCookies(declaredCookies, detectedCookies);

    // Step 4: Calculate accuracy score
    const accuracyScore = calculateAccuracyScore(comparison, detectedCookies.length);

    console.log(`  📊 Cookie Policy Accuracy: ${accuracyScore}%`);
    console.log(`     - Correctly declared: ${comparison.matched.length}`);
    console.log(`     - Undeclared: ${comparison.undeclared.length}`);
    console.log(`     - Missing: ${comparison.missing.length}`);

    return {
      declaredCookies,
      detectedCookies,
      matched: comparison.matched,
      undeclared: comparison.undeclared,
      missing: comparison.missing,
      accuracyScore,
      totalDeclared: declaredCookies.length,
      totalDetected: detectedCookies.length
    };
  } catch (error) {
    console.error('❌ Cookie Policy comparison failed:', error.message);
    throw error;
  }
}

/**
 * Extract declared cookies from Cookie Policy using Claude API
 * @param {string} policyText - Cookie Policy text
 * @returns {Promise<Array>} Declared cookies
 */
async function extractDeclaredCookies(policyText) {
  const prompt = `
You are analyzing a Cookie Policy document. Extract ALL cookies mentioned in this policy.

For each cookie, identify:
1. Name (exact cookie name)
2. Domain (if specified)
3. Category (essential, analytics, advertising, social_media, marketing, preferences, or unknown)
4. Purpose (brief description)
5. Expiry (if specified)

Return ONLY a JSON array with this exact structure:
[
  {
    "name": "_ga",
    "domain": ".example.com",
    "category": "analytics",
    "purpose": "Google Analytics - tracks user sessions",
    "expiry": "2 years"
  }
]

IMPORTANT:
- Extract cookie names EXACTLY as written (case-sensitive)
- If domain is not specified, use null
- If expiry is not specified, use null
- Use these categories ONLY: essential, analytics, advertising, social_media, marketing, preferences, unknown
- Return empty array [] if no cookies are listed

Cookie Policy Document:
${policyText}
`;

  try {
    const result = await analyzeWithClaude(prompt, {
      maxTokens: 2048,
      temperature: 0.1,  // Lower temperature for more consistent extraction
      useCache: false     // Don't cache this - each policy is different
    });

    // Parse JSON response
    let declaredCookies;
    try {
      // Try to extract JSON from response
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        declaredCookies = JSON.parse(jsonMatch[0]);
      } else {
        declaredCookies = JSON.parse(result.text);
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', parseError.message);
      console.error('Response:', result.text.substring(0, 500));
      declaredCookies = [];
    }

    // Validate structure
    if (!Array.isArray(declaredCookies)) {
      console.error('Claude response is not an array');
      return [];
    }

    // Normalize declared cookies
    return declaredCookies.map(cookie => ({
      name: cookie.name || 'unknown',
      domain: cookie.domain || null,
      category: normalizeCategory(cookie.category),
      purpose: cookie.purpose || 'Not specified',
      expiry: cookie.expiry || null
    }));
  } catch (error) {
    console.error('Failed to extract declared cookies:', error.message);
    return [];
  }
}

/**
 * Match declared cookies with detected cookies
 * @param {Array} declared - Declared cookies from policy
 * @param {Array} detected - Detected cookies from scanner
 * @returns {Object} Matching result
 */
function matchCookies(declared, detected) {
  const matched = [];
  const undeclared = [];
  const missing = [];

  // Create lookup maps
  const declaredMap = new Map();
  declared.forEach(cookie => {
    const key = cookie.name.toLowerCase();
    declaredMap.set(key, cookie);
  });

  const detectedMap = new Map();
  detected.forEach(cookie => {
    const key = cookie.name.toLowerCase();
    detectedMap.set(key, cookie);
  });

  // Find matched and undeclared cookies
  detected.forEach(detectedCookie => {
    const key = detectedCookie.name.toLowerCase();
    const declaredCookie = declaredMap.get(key);

    if (declaredCookie) {
      // Cookie is declared
      matched.push({
        name: detectedCookie.name,
        domain: detectedCookie.domain,
        category: detectedCookie.category,
        declaredCategory: declaredCookie.category,
        categoryMatch: normalizeCategory(detectedCookie.category) === normalizeCategory(declaredCookie.category),
        declaredPurpose: declaredCookie.purpose
      });
    } else {
      // Cookie is NOT declared (undeclared)
      undeclared.push({
        name: detectedCookie.name,
        domain: detectedCookie.domain,
        category: detectedCookie.category,
        purpose: detectedCookie.purpose || 'Unknown'
      });
    }
  });

  // Find missing cookies (declared but not detected)
  declared.forEach(declaredCookie => {
    const key = declaredCookie.name.toLowerCase();
    if (!detectedMap.has(key)) {
      missing.push({
        name: declaredCookie.name,
        domain: declaredCookie.domain,
        category: declaredCookie.category,
        purpose: declaredCookie.purpose
      });
    }
  });

  return {
    matched,
    undeclared,
    missing
  };
}

/**
 * Calculate accuracy score
 * @param {Object} comparison - Comparison result
 * @param {number} totalDetected - Total detected cookies
 * @returns {number} Accuracy percentage (0-100)
 */
function calculateAccuracyScore(comparison, totalDetected) {
  if (totalDetected === 0) return 100; // No cookies detected = perfect

  const correctlyDeclared = comparison.matched.length;
  const undeclared = comparison.undeclared.length;

  // Score formula: (correctly declared / total detected) * 100
  // Penalty for undeclared cookies
  const accuracy = (correctlyDeclared / totalDetected) * 100;

  return Math.round(accuracy);
}

/**
 * Normalize cookie category
 * @param {string} category - Category name
 * @returns {string} Normalized category
 */
function normalizeCategory(category) {
  if (!category) return 'unknown';

  const normalized = category.toLowerCase().trim();

  const categoryMap = {
    'essential': 'essential',
    'necessary': 'essential',
    'required': 'essential',
    'functional': 'essential',

    'analytics': 'analytics',
    'analytical': 'analytics',
    'performance': 'analytics',
    'statistics': 'analytics',

    'advertising': 'advertising',
    'advertisement': 'advertising',
    'ad': 'advertising',
    'ads': 'advertising',
    'targeting': 'advertising',

    'social': 'social_media',
    'social_media': 'social_media',
    'social media': 'social_media',

    'marketing': 'marketing',

    'preferences': 'preferences',
    'preference': 'preferences',
    'personalization': 'preferences',
    'customization': 'preferences'
  };

  return categoryMap[normalized] || 'unknown';
}

/**
 * Generate recommendations based on comparison
 * @param {Object} comparison - Comparison result
 * @returns {Array<string>} Recommendations
 */
function generateComparisonRecommendations(comparison) {
  const recommendations = [];

  if (comparison.undeclared.length > 0) {
    recommendations.push(
      `Add ${comparison.undeclared.length} undeclared cookie${comparison.undeclared.length > 1 ? 's' : ''} to your Cookie Policy: ${comparison.undeclared.slice(0, 5).map(c => c.name).join(', ')}${comparison.undeclared.length > 5 ? '...' : ''}`
    );
  }

  if (comparison.missing.length > 0) {
    recommendations.push(
      `Remove or verify ${comparison.missing.length} cookie${comparison.missing.length > 1 ? 's' : ''} listed in policy but not detected on site: ${comparison.missing.slice(0, 3).map(c => c.name).join(', ')}${comparison.missing.length > 3 ? '...' : ''}`
    );
  }

  // Check for category mismatches
  const categoryMismatches = comparison.matched.filter(m => !m.categoryMatch);
  if (categoryMismatches.length > 0) {
    recommendations.push(
      `Verify cookie categories in policy - ${categoryMismatches.length} cookie${categoryMismatches.length > 1 ? 's have' : ' has'} category mismatch between policy and actual behavior`
    );
  }

  if (comparison.undeclared.length === 0 && comparison.missing.length === 0) {
    recommendations.push('Cookie Policy is accurate and complete');
  }

  return recommendations;
}

/**
 * Save comparison to database
 * @param {Object} db - Database instance
 * @param {number} auditId - Audit ID
 * @param {Object} comparison - Comparison result
 */
function saveComparison(db, auditId, comparison) {
  try {
    const stmt = db.prepare(`
      INSERT INTO cookie_comparisons (
        audit_id,
        declared_cookies_json,
        undeclared_cookies_json,
        mismatched_retention_json
      ) VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      auditId,
      JSON.stringify(comparison.declaredCookies),
      JSON.stringify(comparison.undeclared),
      JSON.stringify(comparison.missing)  // Using this field for missing cookies
    );

    console.log('✅ Cookie comparison saved to database');
  } catch (error) {
    console.error('❌ Failed to save cookie comparison:', error.message);
    throw error;
  }
}

module.exports = {
  compareCookiePolicy,
  extractDeclaredCookies,
  matchCookies,
  calculateAccuracyScore,
  generateComparisonRecommendations,
  saveComparison
};
