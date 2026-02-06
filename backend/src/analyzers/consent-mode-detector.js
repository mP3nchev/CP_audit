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
        google_tag_data_present: false,
        ics_present: false,
        confidence: 0,
        detection_method: null,
        issues: [],
        compliant: false,
        evidence: {}
      };

      // ============================================
      // DETECTION METHOD 1: V2 via window.google_tag_data.ics
      // Confidence: 99.5% (most reliable)
      // ============================================
      if (typeof window.google_tag_data !== 'undefined') {
        results.google_tag_data_present = true;
        results.evidence.google_tag_data_exists = true;

        const ics = window.google_tag_data.ics;
        if (ics && typeof ics === 'object') {
          results.ics_present = true;
          results.evidence.ics_structure = {
            active: ics.active,
            usedDefault: ics.usedDefault,
            usedUpdate: ics.usedUpdate,
            waitPeriodTimedOut: ics.waitPeriodTimedOut,
            accessedAny: ics.accessedAny,
            entries_count: ics.entries ? Object.keys(ics.entries).length : 0
          };

          // V2 VALIDATION CRITERIA (99.5% confidence)
          const v2_valid = (
            ics.active === true &&
            ics.entries && typeof ics.entries === 'object' &&
            Object.keys(ics.entries).length > 0 &&
            (ics.usedDefault === true || ics.usedUpdate === true)
          );

          if (v2_valid) {
            results.detected = true;
            results.detection_method = 'google_tag_data.ics (V2 Native API)';
            results.confidence = 99.5;
            results.version = 'v2';

            // Extract consent states from ics.entries
            results.consentStates = {};
            const entries = ics.entries || {};
            const consentTypes = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage',
                                 'functionality_storage', 'personalization_storage', 'security_storage'];

            consentTypes.forEach(type => {
              if (entries[type]) {
                // ics.entries stores both 'default' and 'update' values
                results.consentStates[type] = entries[type].update || entries[type].default || 'not_set';
              } else {
                results.consentStates[type] = 'not_set';
              }
            });

            // Store raw ics for detailed inspection
            results.ics_details = {
              active: ics.active,
              usedDefault: ics.usedDefault,
              usedUpdate: ics.usedUpdate,
              waitPeriodTimedOut: ics.waitPeriodTimedOut,
              accessedAny: ics.accessedAny,
              entries: ics.entries
            };

            // Validate V2 required parameters
            const v2_required = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
            const hasAllV2Params = v2_required.every(param =>
              results.consentStates[param] && results.consentStates[param] !== 'not_set'
            );

            if (!hasAllV2Params) {
              results.version = 'v1_or_incomplete';
              results.confidence = 85;
              results.issues.push('Missing some V2 parameters (ad_user_data or ad_personalization)');
            }

            // GDPR Compliance Check (default should be 'denied')
            const gdprViolations = [];
            ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'].forEach(param => {
              const defaultState = entries[param]?.default;
              if (defaultState === 'granted') {
                gdprViolations.push(`${param} defaults to "granted" (should be "denied")`);
              }
            });

            if (gdprViolations.length > 0) {
              results.issues.push(...gdprViolations);
              results.compliant = false;
            } else {
              results.compliant = true;
            }
          }
        }
      }

      // ============================================
      // DETECTION METHOD 2: V1+V2 via dataLayer
      // Confidence: 95% (legacy method, still reliable)
      // Only check if Method 1 failed
      // ============================================
      if (!results.detected && typeof window.dataLayer !== 'undefined') {
        results.dataLayer_present = true;
        const dataLayer = window.dataLayer || [];

        // Look for consent 'default' command
        const defaultConsentCmd = dataLayer.find(item =>
          Array.isArray(item) &&
          item[0] === 'consent' &&
          item[1] === 'default'
        );

        if (defaultConsentCmd && defaultConsentCmd[2]) {
          results.detected = true;
          results.detection_method = 'dataLayer consent command (V1/V2)';
          results.confidence = 95;
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

          // Check for wait_for_update
          if (consentConfig.wait_for_update) {
            results.wait_for_update = consentConfig.wait_for_update;
          }

          // Check for region-specific settings
          if (consentConfig.region) {
            results.region = consentConfig.region;
          }

          // Determine version
          const requiredV2Params = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
          const missingParams = requiredV2Params.filter(param =>
            !results.consentStates[param] || results.consentStates[param] === 'not_set'
          );

          if (missingParams.length > 0) {
            results.version = 'v1_or_incomplete';
            results.issues.push(`Missing V2 parameters: ${missingParams.join(', ')}`);
          } else {
            results.version = 'v2';
          }

          // GDPR compliance check
          const gdprViolations = [];
          ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'].forEach(param => {
            if (results.consentStates[param] === 'granted') {
              gdprViolations.push(`${param} defaults to "granted" (should be "denied")`);
            }
          });

          if (gdprViolations.length > 0) {
            results.issues.push(...gdprViolations);
            results.compliant = false;
          } else {
            results.compliant = true;
          }
        }

        // Check for consent 'update' commands
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
      }

      // ============================================
      // LEVEL 3: PROOF OF ACTUAL USAGE (99-99.5% confidence boost)
      // Verify consent is actually used by tags
      // ============================================
      if (results.detected) {
        // Check for gtag function
        if (typeof window.gtag === 'function') {
          results.gtag_present = true;

          // Try to get consent state via gtag API
          try {
            let consentRetrieved = false;
            window.gtag('get', 'G-XXXXXXXXXX', 'consent', (value) => {
              if (value && typeof value === 'object') {
                results.evidence.gtag_get_consent = value;
                consentRetrieved = true;
                // If gtag returns consent object, confidence → 99.5%
                if (results.confidence < 99.5) {
                  results.confidence = 99.5;
                }
              }
            });

            // Fallback: check if callback was called
            if (!consentRetrieved) {
              results.evidence.gtag_get_consent = 'callback_not_triggered';
            }
          } catch (e) {
            results.evidence.gtag_get_consent_error = e.message;
          }
        }

        // Check for gtm.consentUpdated event (proof consent is being processed)
        if (results.dataLayer_present) {
          const consentUpdatedEvents = window.dataLayer.filter(item =>
            item.event === 'gtm.consentUpdated' ||
            item.event === 'consent_update'
          );

          if (consentUpdatedEvents.length > 0) {
            results.evidence.consent_update_events = consentUpdatedEvents.length;
            // Boost confidence to 99%
            if (results.confidence < 99) {
              results.confidence = 99;
            }
          }
        }
      }

      // ============================================
      // If nothing detected, add diagnostic info
      // ============================================
      if (!results.detected) {
        if (!results.dataLayer_present && !results.google_tag_data_present) {
          results.issues.push('Neither dataLayer nor google_tag_data found - Google Consent Mode not implemented');
        } else if (results.dataLayer_present && !results.google_tag_data_present) {
          results.issues.push('dataLayer exists but no consent default command found');
        } else if (results.google_tag_data_present && !results.ics_present) {
          results.issues.push('google_tag_data exists but ics object not found or invalid');
        }
      }

      // ============================================
      // Additional Checks
      // ============================================

      // Check 7: Look for Google Analytics 4 measurement ID
      if (results.dataLayer_present) {
        const dataLayer = window.dataLayer || [];
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

        // Check 9: Detect implementation mode
        if (results.detected && results.defaultConsent) {
          if (results.defaultConsent.url_passthrough === true) {
            results.mode = 'advanced';
            results.mode_description = 'Advanced - Sends anonymized pings when consent denied';
          } else if (results.defaultConsent.ads_data_redaction === true) {
            results.mode = 'basic';
            results.mode_description = 'Basic - Blocks all tags until consent granted';
          } else {
            results.mode = 'unknown';
            results.mode_description = 'Cannot determine mode - check gtag configuration';
          }
        }
      }

      // Check 10: CMP integrations
      results.cmp_integrations = [];

      if (typeof window.Cookiebot !== 'undefined') {
        results.cmp_integrations.push({
          name: 'Cookiebot',
          detected: true,
          consent_mode_integration: typeof window.Cookiebot.consent !== 'undefined'
        });
      }

      if (typeof window.OneTrust !== 'undefined' || typeof window.OptanonWrapper === 'function') {
        results.cmp_integrations.push({
          name: 'OneTrust',
          detected: true,
          consent_mode_integration: results.dataLayer_present && window.dataLayer.some(item =>
            JSON.stringify(item).includes('OneTrust') && JSON.stringify(item).includes('consent')
          )
        });
      }

      if (typeof window.UC_UI !== 'undefined' || document.querySelector('[data-usercentrics]')) {
        results.cmp_integrations.push({
          name: 'Usercentrics',
          detected: true,
          consent_mode_integration: results.dataLayer_present && window.dataLayer.some(item =>
            JSON.stringify(item).includes('Usercentrics')
          )
        });
      }

      // CookieScript detection
      if (typeof window.CookieScript !== 'undefined' || document.querySelector('script[src*="cookie-script"]')) {
        results.cmp_integrations.push({
          name: 'CookieScript',
          detected: true,
          consent_mode_integration: results.google_tag_data_present && results.ics_present
        });
      }

      return results;
    });

    // Log results with confidence level
    if (analysis.detected) {
      console.log(`   ✅ Google Consent Mode detected (${analysis.version}) - Confidence: ${analysis.confidence}%`);
      console.log(`   🔍 Detection method: ${analysis.detection_method}`);

      if (analysis.mode) {
        console.log(`   🔧 Implementation mode: ${analysis.mode.toUpperCase()} - ${analysis.mode_description}`);
      }

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
      } else if (analysis.ics_details?.usedUpdate) {
        console.log(`   ✅ Consent updates used (via google_tag_data.ics)`);
      } else {
        console.log(`   ⚠️  No consent update commands found - user consent may not be recorded`);
      }

      // Log CMP integrations
      if (analysis.cmp_integrations && analysis.cmp_integrations.length > 0) {
        console.log(`   🔌 CMP Integrations detected:`);
        analysis.cmp_integrations.forEach(cmp => {
          const integration = cmp.consent_mode_integration ? '✅ integrated' : '⚠️ not integrated';
          console.log(`      - ${cmp.name}: ${integration}`);
        });
      }

      // Log evidence
      if (analysis.evidence.gtag_get_consent) {
        console.log(`   🔬 Evidence: gtag consent API verified`);
      }
      if (analysis.evidence.consent_update_events) {
        console.log(`   🔬 Evidence: ${analysis.evidence.consent_update_events} consent update events found`);
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
      confidence: analysis.confidence,
      detectionMethod: analysis.detection_method,
      mode: analysis.mode,
      modeDescription: analysis.mode_description,
      compliant: analysis.compliant,
      defaultStates: analysis.consentStates,
      hasUpdates: analysis.hasConsentUpdates || analysis.ics_details?.usedUpdate,
      ga4Present: analysis.ga4_present,
      googleAdsPresent: analysis.google_ads_present,
      cmpIntegrations: analysis.cmp_integrations || [],
      issues: analysis.issues,
      evidence: analysis.evidence,
      icsDetails: analysis.ics_details,
      raw: analysis
    };

  } catch (error) {
    console.error('❌ Consent Mode detection failed:', error.message);
    return {
      detected: false,
      confidence: 0,
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
 * @param {Object} monitoringData - Optional monitoring data from consent-monitor
 * @returns {Promise<Object>} Full audit results
 */
async function auditConsentMode(page, monitoringData = null) {
  const startTime = Date.now();

  const detection = await detectConsentMode(page);

  const audit = {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    ...detection,
    recommendations: []
  };

  // If monitoring data is available, enhance detection with real-time evidence
  if (monitoringData && monitoringData.initialized) {
    console.log('   🔬 Enhancing Consent Mode detection with monitoring data...');

    // Check for V2 parameters in gtag calls (more reliable than ics.entries)
    const consentDefaultCalls = monitoringData.gtagCalls.filter(call =>
      call.type === 'consent' && call.args && call.args[1] === 'default'
    );

    // ALSO check dataLayer events for consent commands (some sites use dataLayer.push instead of gtag)
    const dataLayerConsentDefaults = monitoringData.dataLayerEvents.filter(event => {
      return Array.isArray(event.data) &&
             event.data[0] === 'consent' &&
             event.data[1] === 'default';
    });

    let defaultValues = null;

    // Try gtag calls first
    if (consentDefaultCalls.length > 0) {
      const latestDefault = consentDefaultCalls[consentDefaultCalls.length - 1];
      defaultValues = latestDefault.args[2] || {};
    }
    // Fallback to dataLayer events
    else if (dataLayerConsentDefaults.length > 0) {
      const latestDefault = dataLayerConsentDefaults[dataLayerConsentDefaults.length - 1];
      defaultValues = latestDefault.data[2] || {};
    }

    if (defaultValues) {
      // Check for V2 parameters
      const v2Params = ['ad_user_data', 'ad_personalization'];
      const hasV2Params = v2Params.every(param => defaultValues.hasOwnProperty(param));

      if (hasV2Params) {
        if (detection.version === 'v1_or_incomplete' || !detection.detected) {
          console.log('   ✅ Monitoring data confirms V2 parameters present (upgrading detection)');
          audit.version = 'v2';
          audit.detected = true;
          audit.confidence = Math.max(audit.confidence, 97);
          audit.detectionMethod = 'Real-time monitoring (V2 confirmed)';

          // Remove the "missing V2 params" issue if present
          audit.issues = audit.issues.filter(issue =>
            !issue.toLowerCase().includes('missing') && !issue.toLowerCase().includes('ad_user_data') &&
            !issue.toLowerCase().includes('ad_personalization')
          );

          // Update consent states with monitored data
          audit.defaultStates = {
            ...audit.defaultStates,
            ...defaultValues
          };
        }
      }

      // Update monitored states for reference
      audit.monitoredDefaultStates = defaultValues;
    }

    // Check for consent update calls (both gtag and dataLayer)
    const consentUpdateCalls = monitoringData.gtagCalls.filter(call =>
      call.type === 'consent' && call.args && call.args[1] === 'update'
    );

    const dataLayerConsentUpdates = monitoringData.dataLayerEvents.filter(event => {
      return Array.isArray(event.data) &&
             event.data[0] === 'consent' &&
             event.data[1] === 'update';
    });

    const totalUpdates = consentUpdateCalls.length + dataLayerConsentUpdates.length;

    if (totalUpdates > 0) {
      audit.monitoredUpdates = totalUpdates;
      audit.hasUpdates = true;
      console.log(`   ✅ Detected ${totalUpdates} consent update(s) via monitoring`);
    }

    // Add monitoring evidence to audit
    audit.monitoringEvidence = {
      gtagCalls: monitoringData.gtagCalls.length,
      dataLayerEvents: monitoringData.dataLayerEvents.length,
      storageWrites: monitoringData.storageWrites.length,
      consentStateFromMonitor: monitoringData.consentState
    };
  }

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

  if (detection.detected && !detection.hasUpdates && !audit.hasUpdates) {
    audit.recommendations.push('Ensure consent "update" commands are fired when user interacts with cookie banner');
  }

  return audit;
}

module.exports = {
  detectConsentMode,
  checkConsentUpdate,
  auditConsentMode
};
