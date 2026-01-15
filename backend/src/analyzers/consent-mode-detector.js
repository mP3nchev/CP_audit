/**
 * Google Consent Mode v2 Detector
 *
 * Checks for proper implementation of Google Consent Mode v2
 * which is required for Google Analytics 4 and Google Ads in EEA
 *
 * Reference: https://developers.google.com/tag-platform/security/guides/consent
 */

/**
 * Detect and validate Google Consent Mode v2 implementation
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Consent Mode v2 analysis
 */
async function detectConsentMode(page) {
  try {
    console.log('🔍 Checking for Google Consent Mode v2...');

    const analysis = await page.evaluate(() => {
      const results = {
        detected: false,
        version: null,
        defaultConsent: null,
        consentStates: {},
        gtag_present: false,
        dataLayer_present: false,
        issues: [],
        compliant: false
      };

      // Check 1: Does window.dataLayer exist?
      if (typeof window.dataLayer === 'undefined') {
        results.issues.push('dataLayer not found - Google Consent Mode not implemented');
        return results;
      }

      results.dataLayer_present = true;

      // Check 2: Look for gtag function
      if (typeof window.gtag !== 'function') {
        results.issues.push('gtag() function not found - Consent Mode may not be properly configured');
      } else {
        results.gtag_present = true;
      }

      // Check 3: Parse dataLayer for consent commands
      const dataLayer = window.dataLayer || [];

      // Look for consent 'default' command
      const defaultConsentCmd = dataLayer.find(item =>
        Array.isArray(item) &&
        item[0] === 'consent' &&
        item[1] === 'default'
      );

      if (defaultConsentCmd && defaultConsentCmd[2]) {
        results.detected = true;
        results.defaultConsent = defaultConsentCmd[2];

        // Extract consent states
        const consentConfig = defaultConsentCmd[2];
        results.consentStates = {
          ad_storage: consentConfig.ad_storage || 'not_set',
          ad_user_data: consentConfig.ad_user_data || 'not_set',
          ad_personalization: consentConfig.ad_personalization || 'not_set',
          analytics_storage: consentConfig.analytics_storage || 'not_set',
          functionality_storage: consentConfig.functionality_storage || 'not_set',
          personalization_storage: consentConfig.personalization_storage || 'not_set',
          security_storage: consentConfig.security_storage || 'not_set'
        };

        // Check for wait_for_update (recommended for CMP integration)
        if (consentConfig.wait_for_update) {
          results.wait_for_update = consentConfig.wait_for_update;
        }

        // Check for region-specific settings
        if (consentConfig.region) {
          results.region = consentConfig.region;
        }
      } else {
        results.issues.push('consent default command not found in dataLayer');
      }

      // Check 4: Look for consent 'update' commands
      const updateConsentCmds = dataLayer.filter(item =>
        Array.isArray(item) &&
        item[0] === 'consent' &&
        item[1] === 'update'
      );

      if (updateConsentCmds.length > 0) {
        results.hasConsentUpdates = true;
        results.updateCount = updateConsentCmds.length;
        results.latestUpdate = updateConsentCmds[updateConsentCmds.length - 1][2];
      }

      // Check 5: Verify Consent Mode v2 required parameters
      if (results.detected) {
        const requiredParams = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
        const missingParams = requiredParams.filter(param =>
          !results.consentStates[param] || results.consentStates[param] === 'not_set'
        );

        if (missingParams.length > 0) {
          results.issues.push(`Missing Consent Mode v2 parameters: ${missingParams.join(', ')}`);
          results.version = 'v1_or_incomplete';
        } else {
          results.version = 'v2';
        }

        // Check 6: Validate default state is 'denied' (GDPR requirement)
        const gdprViolations = [];
        if (results.consentStates.ad_storage === 'granted') {
          gdprViolations.push('ad_storage defaults to "granted" (should be "denied")');
        }
        if (results.consentStates.ad_user_data === 'granted') {
          gdprViolations.push('ad_user_data defaults to "granted" (should be "denied")');
        }
        if (results.consentStates.ad_personalization === 'granted') {
          gdprViolations.push('ad_personalization defaults to "granted" (should be "denied")');
        }
        if (results.consentStates.analytics_storage === 'granted') {
          gdprViolations.push('analytics_storage defaults to "granted" (should be "denied")');
        }

        if (gdprViolations.length > 0) {
          results.issues.push(...gdprViolations);
          results.compliant = false;
        } else {
          results.compliant = true;
        }
      }

      // Check 7: Look for Google Analytics 4 measurement ID
      const ga4Config = dataLayer.find(item =>
        Array.isArray(item) && item[0] === 'config' && item[1]?.startsWith('G-')
      );

      if (ga4Config) {
        results.ga4_present = true;
        results.ga4_measurement_id = ga4Config[1];
      }

      // Check 8: Look for Google Ads conversion ID
      const adsConfig = dataLayer.find(item =>
        Array.isArray(item) && item[0] === 'config' && item[1]?.startsWith('AW-')
      );

      if (adsConfig) {
        results.google_ads_present = true;
        results.ads_conversion_id = adsConfig[1];
      }

      return results;
    });

    // Log results
    if (analysis.detected) {
      console.log(`   ✅ Google Consent Mode detected (${analysis.version})`);
      console.log(`   📊 Consent states:`);
      console.log(`      - ad_storage: ${analysis.consentStates.ad_storage}`);
      console.log(`      - ad_user_data: ${analysis.consentStates.ad_user_data}`);
      console.log(`      - ad_personalization: ${analysis.consentStates.ad_personalization}`);
      console.log(`      - analytics_storage: ${analysis.consentStates.analytics_storage}`);

      if (analysis.compliant) {
        console.log(`   ✅ Default consent states are GDPR-compliant (all "denied")`);
      } else {
        console.log(`   ⚠️  GDPR violation: Some consent states default to "granted"`);
      }

      if (analysis.hasConsentUpdates) {
        console.log(`   ✅ Consent updates detected (${analysis.updateCount} update commands)`);
      } else {
        console.log(`   ⚠️  No consent update commands found - user consent may not be recorded`);
      }
    } else {
      console.log(`   ❌ Google Consent Mode not detected`);
      if (analysis.issues.length > 0) {
        console.log(`   Issues: ${analysis.issues.join(', ')}`);
      }
    }

    return {
      detected: analysis.detected,
      version: analysis.version,
      compliant: analysis.compliant,
      defaultStates: analysis.consentStates,
      hasUpdates: analysis.hasConsentUpdates,
      ga4Present: analysis.ga4_present,
      googleAdsPresent: analysis.google_ads_present,
      issues: analysis.issues,
      raw: analysis
    };

  } catch (error) {
    console.error('❌ Consent Mode detection failed:', error.message);
    return {
      detected: false,
      error: error.message,
      issues: ['Detection failed: ' + error.message]
    };
  }
}

/**
 * Simulate consent acceptance and check for proper update
 * @param {Page} page - Puppeteer page
 * @param {Function} acceptAction - Function that clicks accept button
 * @returns {Promise<Object>} Post-acceptance analysis
 */
async function checkConsentUpdate(page, acceptAction) {
  try {
    // Get initial state
    const beforeState = await page.evaluate(() => {
      return window.dataLayer?.filter(item =>
        Array.isArray(item) && item[0] === 'consent'
      ) || [];
    });

    // Perform accept action
    if (acceptAction) {
      await acceptAction();
      await page.waitForTimeout(1000); // Wait for consent to propagate
    }

    // Get state after acceptance
    const afterState = await page.evaluate(() => {
      return window.dataLayer?.filter(item =>
        Array.isArray(item) && item[0] === 'consent'
      ) || [];
    });

    const updateDetected = afterState.length > beforeState.length;

    return {
      updateDetected,
      commandsBefore: beforeState.length,
      commandsAfter: afterState.length,
      newCommands: afterState.slice(beforeState.length)
    };

  } catch (error) {
    console.error('Failed to check consent update:', error.message);
    return {
      updateDetected: false,
      error: error.message
    };
  }
}

/**
 * Comprehensive Consent Mode v2 audit
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Full audit results
 */
async function auditConsentMode(page) {
  const startTime = Date.now();

  const detection = await detectConsentMode(page);

  const audit = {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    ...detection,
    recommendations: []
  };

  // Generate recommendations
  if (!detection.detected) {
    audit.recommendations.push('Implement Google Consent Mode v2 for GDPR compliance');
    audit.recommendations.push('Add gtag.js with consent initialization before any tracking');
    audit.severity = 'high';
  } else if (detection.version === 'v1_or_incomplete') {
    audit.recommendations.push('Upgrade to Consent Mode v2 by adding ad_user_data and ad_personalization parameters');
    audit.severity = 'medium';
  } else if (!detection.compliant) {
    audit.recommendations.push('Change default consent states to "denied" for GDPR compliance');
    audit.recommendations.push('Only update to "granted" after explicit user consent');
    audit.severity = 'critical';
  } else {
    audit.recommendations.push('Consent Mode v2 implementation looks good');
    audit.severity = 'none';
  }

  if (detection.detected && !detection.hasUpdates) {
    audit.recommendations.push('Ensure consent "update" commands are fired when user interacts with cookie banner');
  }

  return audit;
}

module.exports = {
  detectConsentMode,
  checkConsentUpdate,
  auditConsentMode
};
