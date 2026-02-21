/**
 * Google Consent Mode V2 Validator
 * Detects and validates Google Consent Mode V2 implementation
 * Reference: https://support.google.com/analytics/answer/9976101
 */

/**
 * Setup consent mode detection hooks
 * Call this BEFORE page navigation using page.evaluateOnNewDocument()
 * @returns {string} Code to inject
 */
function getConsentModeDetectionCode() {
  return `
    window.__gtagCalls = [];
    window.__consentMode = {
      detected: false,
      isV2: false,
      defaultSettings: {},
      updates: [],
      callSequence: []
    };

    // Hook dataLayer.push
    const originalDataLayer = window.dataLayer || [];
    window.dataLayer = window.dataLayer || [];

    const originalPush = window.dataLayer.push;
    window.dataLayer.push = function() {
      const args = Array.from(arguments);
      const timestamp = Date.now();

      window.__gtagCalls.push({
        args,
        timestamp
      });

      // Parse consent calls
      if (args[0] === 'consent') {
        window.__consentMode.detected = true;
        window.__consentMode.callSequence.push({
          command: args[1],
          timestamp
        });

        if (args[1] === 'default') {
          window.__consentMode.defaultSettings = args[2] || {};

          // Check for V2-specific parameters
          const settings = args[2] || {};
          if (settings.ad_user_data !== undefined ||
              settings.ad_personalization !== undefined) {
            window.__consentMode.isV2 = true;
          }
        }

        if (args[1] === 'update') {
          window.__consentMode.updates.push({
            settings: args[2] || {},
            timestamp
          });
        }
      }

      // Track gtag config calls to verify consent default comes first
      if (args[0] === 'config') {
        window.__consentMode.callSequence.push({
          command: 'config',
          target: args[1],
          timestamp
        });
      }

      return originalPush ? originalPush.apply(this, arguments) : args.length;
    };

    // Also hook direct gtag() calls if gtag is defined
    if (typeof gtag !== 'undefined') {
      const originalGtag = gtag;
      window.gtag = function() {
        const args = Array.from(arguments);
        window.dataLayer.push(args);
        return originalGtag.apply(this, arguments);
      };
    }
  `;
}

/**
 * Extract consent mode data from page
 * Call this AFTER page load
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Consent mode data
 */
async function extractConsentModeData(page) {
  try {
    const consentModeData = await page.evaluate(() => window.__consentMode);
    return consentModeData || {
      detected: false,
      isV2: false,
      defaultSettings: {},
      updates: [],
      callSequence: []
    };
  } catch (error) {
    console.error('Failed to extract consent mode data:', error.message);
    return {
      detected: false,
      isV2: false,
      defaultSettings: {},
      updates: [],
      callSequence: []
    };
  }
}

/**
 * Validate consent mode implementation
 * @param {Object} data - Consent mode data from extractConsentModeData()
 * @returns {Object} Validation result
 */
function validateConsentModeV2(data) {
  const validation = {
    detected: data.detected,
    isV2: data.isV2,
    compliant: false,
    issues: [],
    warnings: []
  };

  if (!data.detected) {
    validation.issues.push('Google Consent Mode not detected');
    return validation;
  }

  const defaults = data.defaultSettings;

  // V2 Required Parameters Check
  if (!defaults.ad_user_data) {
    validation.issues.push("Missing 'ad_user_data' parameter (V2 required since March 2024)");
    validation.isV2 = false;
  }

  if (!defaults.ad_personalization) {
    validation.issues.push("Missing 'ad_personalization' parameter (V2 required since March 2024)");
    validation.isV2 = false;
  }

  // Core Parameters Check
  if (!defaults.ad_storage) {
    validation.issues.push("Missing 'ad_storage' parameter");
  }

  if (!defaults.analytics_storage) {
    validation.issues.push("Missing 'analytics_storage' parameter");
  }

  // GDPR Compliance Check (defaults should be 'denied')
  const parametersToCheck = [
    'ad_storage',
    'analytics_storage',
    'ad_user_data',
    'ad_personalization'
  ];

  parametersToCheck.forEach(param => {
    if (defaults[param] && defaults[param] !== 'denied') {
      validation.issues.push(`'${param}' defaults to '${defaults[param]}' but should be 'denied' for GDPR compliance`);
    }
  });

  // Check for update mechanism
  if (data.updates.length === 0) {
    validation.warnings.push('No consent updates detected - users may not be able to grant consent');
  }

  // Check call sequence - consent default should come before gtag config
  const firstConfig = data.callSequence.find(call => call.command === 'config');
  const firstDefault = data.callSequence.find(call => call.command === 'default');

  if (firstConfig && firstDefault && firstConfig.timestamp < firstDefault.timestamp) {
    validation.issues.push("gtag('config') called before consent('default') - consent mode must be initialized first");
  }

  // Check wait_for_update parameter
  if (defaults.wait_for_update === undefined || defaults.wait_for_update === 0) {
    validation.warnings.push("Missing 'wait_for_update' parameter - consider adding a short delay (e.g., 500ms)");
  }

  // Determine compliance
  validation.compliant = validation.isV2 && validation.issues.length === 0;

  return validation;
}

/**
 * Analyze consent mode for a scanned page
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Complete analysis result
 */
async function analyzeConsentMode(page) {
  try {
    console.log('🔍 Analyzing Google Consent Mode V2...');

    const data = await extractConsentModeData(page);
    const validation = validateConsentModeV2(data);

    const result = {
      detected: validation.detected,
      isV2: validation.isV2,
      compliant: validation.compliant,
      defaultSettings: data.defaultSettings,
      issues: validation.issues,
      warnings: validation.warnings,
      updatesDetected: data.updates.length,
      implementationScore: calculateImplementationScore(validation, data)
    };

    // Logging
    if (!validation.detected) {
      console.log('  ⚠️  Google Consent Mode not detected');
    } else if (validation.compliant) {
      console.log('  ✅ Google Consent Mode V2: Compliant');
    } else {
      console.log(`  ❌ Google Consent Mode V2: ${validation.issues.length} issues found`);
      validation.issues.forEach(issue => console.log(`     - ${issue}`));
    }

    return result;
  } catch (error) {
    console.error('❌ Consent Mode analysis failed:', error.message);
    throw error;
  }
}

/**
 * Calculate implementation score (0-100)
 * @param {Object} validation - Validation result
 * @param {Object} data - Consent mode data
 * @returns {number} Score
 */
function calculateImplementationScore(validation, data) {
  if (!validation.detected) return 0;

  let score = 0;

  // V2 parameters present (40 points)
  if (data.defaultSettings.ad_user_data !== undefined) score += 20;
  if (data.defaultSettings.ad_personalization !== undefined) score += 20;

  // Core parameters present (20 points)
  if (data.defaultSettings.ad_storage !== undefined) score += 10;
  if (data.defaultSettings.analytics_storage !== undefined) score += 10;

  // Defaults to 'denied' (20 points)
  const allDeniedByDefault = [
    'ad_storage',
    'analytics_storage',
    'ad_user_data',
    'ad_personalization'
  ].every(param => data.defaultSettings[param] === 'denied');

  if (allDeniedByDefault) score += 20;

  // Update mechanism exists (10 points)
  if (data.updates.length > 0) score += 10;

  // Correct call sequence (10 points)
  const firstConfig = data.callSequence.find(call => call.command === 'config');
  const firstDefault = data.callSequence.find(call => call.command === 'default');

  if (!firstConfig || !firstDefault || firstDefault.timestamp < firstConfig.timestamp) {
    score += 10;
  }

  return Math.min(score, 100);
}

/**
 * Generate recommendations based on validation
 * @param {Object} validation - Validation result
 * @returns {Array<string>} Recommendations
 */
function generateRecommendations(validation) {
  const recommendations = [];

  if (!validation.detected) {
    recommendations.push('Implement Google Consent Mode V2 to comply with Google Analytics and Ads requirements for EEA traffic');
    recommendations.push('Add gtag consent default configuration before loading Google tags');
    return recommendations;
  }

  if (!validation.isV2) {
    recommendations.push("Update to Consent Mode V2 by adding 'ad_user_data' and 'ad_personalization' parameters");
  }

  validation.issues.forEach(issue => {
    if (issue.includes('denied')) {
      const param = issue.match(/'([^']+)'/)[1];
      recommendations.push(`Set '${param}' to 'denied' by default to comply with GDPR requirements`);
    } else if (issue.includes('Missing')) {
      const param = issue.match(/'([^']+)'/)[1];
      recommendations.push(`Add '${param}' parameter to consent default configuration`);
    }
  });

  if (validation.warnings.length > 0 && validation.warnings.some(w => w.includes('wait_for_update'))) {
    recommendations.push("Add 'wait_for_update' parameter (e.g., 500ms) to give your consent banner time to load");
  }

  return recommendations;
}

/**
 * Validates that consent.default() fires BEFORE any GA4/Ads config call.
 * GDPR violation if tracking tags initialize before consent signal.
 *
 * @param {Object} consentData - from extractConsentModeData()
 * @param {Array}  networkRequests - each with { url, timestamp }
 * @returns {{ valid: boolean, reason?: string, violationType?: string, evidence?: Object }}
 */
function validateExecutionOrder(consentData, networkRequests = []) {
  const sequence = consentData?.callSequence || [];

  const defaultCall = sequence.find(c => c.command === 'default');
  const configCalls = sequence.filter(c =>
    c.command === 'config' && (/^G-/.test(c.target || '') || /^AW-/.test(c.target || ''))
  );

  // No consent mode detected at all — not a violation of ORDER (separate check)
  if (!defaultCall && configCalls.length === 0) {
    return { valid: true, skipped: true, reason: 'Consent Mode not detected' };
  }

  // Config calls exist but no default → violation
  if (!defaultCall && configCalls.length > 0) {
    return {
      valid: false,
      violationType: 'CONSENT_DEFAULT_MISSING',
      reason: `GA4/Ads config calls found (${configCalls.map(c => c.target).join(', ')}) but no consent.default() detected`,
      evidence: { configCalls }
    };
  }

  // Check dataLayer sequence order
  const earlyConfig = configCalls.find(c => c.timestamp < defaultCall.timestamp);
  if (earlyConfig) {
    return {
      valid: false,
      violationType: 'CONSENT_ORDER_VIOLATION',
      reason: `${earlyConfig.target} config at ${earlyConfig.timestamp}ms fired BEFORE consent.default at ${defaultCall.timestamp}ms`,
      evidence: { earlyConfig, defaultCall, deltaMs: defaultCall.timestamp - earlyConfig.timestamp }
    };
  }

  // Cross-check with actual network requests: did GA4 collect requests arrive before consent?
  const ga4CollectRequests = networkRequests.filter(r =>
    /google-analytics\.com\/g\/collect/.test(r.url || '') && r.timestamp
  );
  const consentDefaultTime = defaultCall.timestamp;
  const earlyNetworkHit = ga4CollectRequests.find(r => r.timestamp < consentDefaultTime);

  if (earlyNetworkHit) {
    return {
      valid: false,
      violationType: 'GA4_COLLECT_BEFORE_CONSENT',
      reason: `GA4 /g/collect request at ${earlyNetworkHit.timestamp}ms preceded consent.default at ${consentDefaultTime}ms`,
      evidence: { request: earlyNetworkHit.url, requestTime: earlyNetworkHit.timestamp, consentTime: consentDefaultTime }
    };
  }

  return { valid: true };
}

module.exports = {
  getConsentModeDetectionCode,
  extractConsentModeData,
  validateConsentModeV2,
  analyzeConsentMode,
  generateRecommendations,
  validateExecutionOrder
};
