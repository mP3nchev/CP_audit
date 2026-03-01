/**
 * Google Consent Mode v2 Detector
 *
 * Checks for proper implementation of Google Consent Mode v2
 * which is required for Google Analytics 4 and Google Ads in EEA
 *
 * Reference: https://developers.google.com/tag-platform/security/guides/consent
 */

const { createLogger } = require('../utils/logger');
const logger = createLogger('consent-mode-detector');

/**
 * Detect and validate Google Consent Mode v2 implementation
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Consent Mode v2 analysis
 */
async function detectConsentMode(page) {
  try {
    logger.info('consent-mode-detection-start');

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
      // DIAGNOSTIC LOGGING
      // ============================================
      const diagnostics = {
        google_tag_data_exists: typeof window.google_tag_data !== 'undefined',
        ics_exists: window.google_tag_data?.ics !== undefined,
        ics_entries_count: window.google_tag_data?.ics?.entries ? Object.keys(window.google_tag_data.ics.entries).length : 0,
        dataLayer_exists: typeof window.dataLayer !== 'undefined',
        dataLayer_consent_commands: window.dataLayer ? window.dataLayer.filter(item =>
          Array.isArray(item) && item[0] === 'consent'
        ).length : 0,
        cmps_detected: {
          CookieScript: typeof window.CookieScript !== 'undefined',
          OneTrust: typeof window.OneTrust !== 'undefined',
          Cookiebot: typeof window.Cookiebot !== 'undefined',
          CookieYes: typeof window.getCkyConsent === 'function',
          Consentmo: localStorage.getItem('gdprCache') !== null,
          Usercentrics: typeof window.UC_UI !== 'undefined'
        }
      };

      console.log('   🔍 Consent Mode Detection Diagnostics:');
      console.log(`      google_tag_data: ${diagnostics.google_tag_data_exists ? '✅' : '❌'}`);
      console.log(`      ics object: ${diagnostics.ics_exists ? '✅' : '❌'}`);
      console.log(`      ics.entries count: ${diagnostics.ics_entries_count}`);
      console.log(`      dataLayer: ${diagnostics.dataLayer_exists ? '✅' : '❌'}`);
      console.log(`      consent commands: ${diagnostics.dataLayer_consent_commands}`);
      console.log(`      CMPs: ${Object.entries(diagnostics.cmps_detected).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'none'}`);

      // Log ics.entries structure for debugging
      if (window.google_tag_data?.ics?.entries) {
        const entries = window.google_tag_data.ics.entries;
        console.log('      ics.entries structure:');
        Object.keys(entries).forEach(param => {
          const entry = entries[param];
          console.log(`         ${param}: default=${entry.default}, update=${entry.update}`);
        });
      }

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
                let value = entries[type].update || entries[type].default;

                // ✅ CRITICAL FIX: CookieScript uses BOOLEAN values, not strings
                // Convert boolean to string: false → 'denied', true → 'granted'
                if (typeof value === 'boolean') {
                  value = value ? 'granted' : 'denied';
                }

                results.consentStates[type] = value || 'not_set';
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
            // NOTE: 'not_set' is a VALID value for V2 parameters!
            // We only check if the parameter EXISTS, not its value
            const v2_required = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
            const hasAllV2Params = v2_required.every(param =>
              results.consentStates.hasOwnProperty(param) && results.consentStates[param] !== undefined
            );

            if (!hasAllV2Params) {
              // Find which params are actually missing
              const missingParams = v2_required.filter(param =>
                !results.consentStates.hasOwnProperty(param) || results.consentStates[param] === undefined
              );

              results.version = 'v1_or_incomplete';
              results.confidence = 85;
              results.issues.push(`Missing V2 parameters: ${missingParams.join(', ')}`);
              console.log(`   ⚠️  Missing V2 params in static detection: ${missingParams.join(', ')}`);
            } else {
              console.log(`   ✅ All V2 params present in static detection (including not_set values)`);
            }

            // GDPR Compliance Check
            // NOTE: For GDPR compliance, parameters MUST be explicitly set to 'denied', not 'not_set'
            const gdprViolations = [];
            ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'].forEach(param => {
              let defaultState = entries[param]?.default;

              // CookieScript fix: Convert boolean to string
              if (typeof defaultState === 'boolean') {
                defaultState = defaultState ? 'granted' : 'denied';
              }

              // GDPR requires EXPLICIT 'denied' - anything else is non-compliant
              if (defaultState !== 'denied') {
                const actualState = defaultState || 'not_set';
                gdprViolations.push(`${param} defaults to "${actualState}" but must be "denied" for GDPR compliance`);
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
      // DETECTION METHOD 1.5: CMP Native APIs
      // Confidence: 95% (direct CMP state reading)
      // Only used if Method 1 failed or returned 'not_set'
      // ============================================
      if (!results.detected || Object.values(results.consentStates).every(v => v === 'not_set')) {

        // CookieScript Integration
        if (typeof window.CookieScript !== 'undefined' && window.CookieScript.instance) {
          try {
            const csState = window.CookieScript.instance.currentState();

            if (csState && csState.categories) {
              results.detected = true;
              results.detection_method = 'CookieScript native API';
              results.confidence = 95;
              results.version = 'v2'; // CookieScript always uses V2

              // Map CookieScript categories to Consent Mode params
              const targeting = csState.categories.targeting || false;
              const analytics = csState.categories.analytics || false;

              results.consentStates = {
                ad_storage: targeting ? 'granted' : 'denied',
                ad_user_data: targeting ? 'granted' : 'denied',
                ad_personalization: targeting ? 'granted' : 'denied',
                analytics_storage: analytics ? 'granted' : 'denied',
                functionality_storage: csState.categories.functionality ? 'granted' : 'denied',
                personalization_storage: csState.categories.personalization ? 'granted' : 'denied',
                security_storage: 'granted' // Always granted by CookieScript
              };

              // GDPR compliance check
              const allDenied = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']
                .every(param => results.consentStates[param] === 'denied');
              results.compliant = allDenied;
            }
          } catch (error) {
            console.error('   ⚠️  Failed to read CookieScript state:', error.message);
          }
        }

        // OneTrust Integration
        else if (typeof window.OneTrust !== 'undefined' && window.OneTrust.GetDomainData) {
          try {
            const otData = window.OneTrust.GetDomainData();
            const activeGroups = otData.Groups.filter(g => g.Status === 'active');

            // OneTrust uses group IDs - common mappings:
            // C0004 = Performance/Analytics
            // C0002 = Targeting/Advertising
            const hasAnalytics = activeGroups.some(g => g.CustomGroupId === 'C0004');
            const hasTargeting = activeGroups.some(g => g.CustomGroupId === 'C0002');

            results.detected = true;
            results.detection_method = 'OneTrust native API';
            results.confidence = 95;
            results.version = 'v2';

            results.consentStates = {
              ad_storage: hasTargeting ? 'granted' : 'denied',
              ad_user_data: hasTargeting ? 'granted' : 'denied',
              ad_personalization: hasTargeting ? 'granted' : 'denied',
              analytics_storage: hasAnalytics ? 'granted' : 'denied'
            };

            const allDenied = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']
              .every(param => results.consentStates[param] === 'denied');
            results.compliant = allDenied;
          } catch (error) {
            console.error('   ⚠️  Failed to read OneTrust state:', error.message);
          }
        }

        // Cookiebot Integration
        else if (typeof window.Cookiebot !== 'undefined' && window.Cookiebot.consent) {
          try {
            const consent = window.Cookiebot.consent;

            results.detected = true;
            results.detection_method = 'Cookiebot native API';
            results.confidence = 95;
            results.version = 'v2';

            results.consentStates = {
              ad_storage: consent.marketing ? 'granted' : 'denied',
              ad_user_data: consent.marketing ? 'granted' : 'denied',
              ad_personalization: consent.marketing ? 'granted' : 'denied',
              analytics_storage: consent.statistics ? 'granted' : 'denied',
              functionality_storage: consent.preferences ? 'granted' : 'denied',
              security_storage: consent.necessary ? 'granted' : 'denied'
            };

            const allDenied = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']
              .every(param => results.consentStates[param] === 'denied');
            results.compliant = allDenied;
          } catch (error) {
            console.error('   ⚠️  Failed to read Cookiebot state:', error.message);
          }
        }

        // CookieYes Integration
        else if (typeof window.getCkyConsent === 'function') {
          try {
            const consent = window.getCkyConsent();

            if (consent && consent.categories) {
              results.detected = true;
              results.detection_method = 'CookieYes native API';
              results.confidence = 95;
              results.version = 'v2';

              // CookieYes categories: necessary, functional, analytics, advertisement
              const categories = consent.categories;

              results.consentStates = {
                ad_storage: categories.advertisement ? 'granted' : 'denied',
                ad_user_data: categories.advertisement ? 'granted' : 'denied',
                ad_personalization: categories.advertisement ? 'granted' : 'denied',
                analytics_storage: categories.analytics ? 'granted' : 'denied',
                functionality_storage: categories.functional ? 'granted' : 'denied',
                security_storage: categories.necessary ? 'granted' : 'denied'
              };

              const allDenied = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']
                .every(param => results.consentStates[param] === 'denied');
              results.compliant = allDenied;
            }
          } catch (error) {
            console.error('   ⚠️  Failed to read CookieYes state:', error.message);
          }
        }

        // Consentmo Integration (Shopify)
        else if (localStorage.getItem('gdprCache')) {
          try {
            const gdprCache = localStorage.getItem('gdprCache');
            const parsed = JSON.parse(gdprCache);

            if (parsed.getCookieConsentSettings) {
              const settings = JSON.parse(parsed.getCookieConsentSettings);

              // Check if this is actually Consentmo (look for characteristic structure)
              if (settings && (settings.cookie_name !== undefined || settings.gcm_options !== undefined)) {
                results.detected = true;
                results.detection_method = 'Consentmo localStorage API';
                results.confidence = 90; // Slightly lower since we're inferring from localStorage

                // Consentmo uses gcm_options for Google Consent Mode integration
                if (settings.gcm_options && settings.gcm_options.state) {
                  results.version = 'v2';

                  // Read from cookie: cookieconsent_status{cookie_name}
                  const cookieName = `cookieconsent_status${settings.cookie_name || ''}`;
                  const cookieValue = document.cookie.split('; ').find(row => row.startsWith(cookieName));

                  if (cookieValue) {
                    const consentData = cookieValue.split('=')[1];
                    const decoded = decodeURIComponent(consentData);

                    // Consentmo categories: necessary, statistics (analytics), marketing, preferences (functional)
                    // Cookie format: {"necessary":true,"statistics":false,"marketing":false,"preferences":true}
                    try {
                      const categories = JSON.parse(decoded);

                      results.consentStates = {
                        ad_storage: categories.marketing ? 'granted' : 'denied',
                        ad_user_data: categories.marketing ? 'granted' : 'denied',
                        ad_personalization: categories.marketing ? 'granted' : 'denied',
                        analytics_storage: categories.statistics ? 'granted' : 'denied',
                        functionality_storage: categories.preferences ? 'granted' : 'denied',
                        security_storage: categories.necessary ? 'granted' : 'denied'
                      };

                      const allDenied = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']
                        .every(param => results.consentStates[param] === 'denied');
                      results.compliant = allDenied;
                    } catch (cookieParseError) {
                      console.error('   ⚠️  Failed to parse Consentmo cookie:', cookieParseError.message);
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error('   ⚠️  Failed to read Consentmo state:', error.message);
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

          // Helper to convert boolean to string (CookieScript fix)
          const normalizeState = (val) => {
            if (typeof val === 'boolean') return val ? 'granted' : 'denied';
            return val || 'not_set';
          };

          results.consentStates = {
            ad_storage: normalizeState(consentConfig.ad_storage),
            ad_user_data: normalizeState(consentConfig.ad_user_data),
            ad_personalization: normalizeState(consentConfig.ad_personalization),
            analytics_storage: normalizeState(consentConfig.analytics_storage),
            functionality_storage: normalizeState(consentConfig.functionality_storage),
            personalization_storage: normalizeState(consentConfig.personalization_storage),
            security_storage: normalizeState(consentConfig.security_storage)
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
          // NOTE: 'not_set' is a VALID value for V2 parameters!
          const requiredV2Params = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
          const missingParams = requiredV2Params.filter(param =>
            !results.consentStates.hasOwnProperty(param) || results.consentStates[param] === undefined
          );

          if (missingParams.length > 0) {
            results.version = 'v1_or_incomplete';
            results.issues.push(`Missing V2 parameters: ${missingParams.join(', ')}`);
            console.log(`   ⚠️  Missing V2 params (gtag path): ${missingParams.join(', ')}`);
          } else {
            results.version = 'v2';
            console.log(`   ✅ All V2 params present (gtag path)`);
          }

          // GDPR compliance check
          // NOTE: For GDPR compliance, parameters MUST be explicitly set to 'denied', not 'not_set'
          const gdprViolations = [];
          ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'].forEach(param => {
            const currentState = results.consentStates[param];

            // GDPR requires EXPLICIT 'denied' - anything else is non-compliant
            if (currentState !== 'denied') {
              const actualState = currentState || 'not_set';
              gdprViolations.push(`${param} defaults to "${actualState}" but must be "denied" for GDPR compliance`);
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
      logger.info('consent-mode-detected', {
        version: analysis.version,
        confidence: analysis.confidence,
        detectionMethod: analysis.detection_method,
        mode: analysis.mode,
        modeDescription: analysis.mode_description,
        consentStates: analysis.consentStates,
        gdprCompliant: analysis.compliant,
        hasUpdates: analysis.hasConsentUpdates,
        updateCount: analysis.updateCount,
        icsUpdateUsed: analysis.ics_details?.usedUpdate,
        cmpIntegrations: analysis.cmp_integrations?.map(cmp => ({
          name: cmp.name,
          integrated: cmp.consent_mode_integration
        })),
        evidence: {
          gtagApiVerified: analysis.evidence.gtag_get_consent,
          updateEventsCount: analysis.evidence.consent_update_events
        }
      });

      if (!analysis.compliant) {
        logger.warn('consent-mode-gdpr-violation', {
          message: 'Some consent states default to "granted"',
          consentStates: analysis.consentStates
        });
      }

      if (!analysis.hasConsentUpdates && !analysis.ics_details?.usedUpdate) {
        logger.warn('consent-mode-no-updates', {
          message: 'No consent update commands found - user consent may not be recorded'
        });
      }
    } else {
      logger.warn('consent-mode-not-detected', {
        issues: analysis.issues
      });
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
    logger.error('consent-mode-detection-failed', {
      error: '❌ ' + error.message,
      stack: error.stack
    });
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
    logger.error('consent-update-check-failed', {
      error: '❌ ' + error.message,
      stack: error.stack
    });
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
    logger.debug('consent-mode-enhancing-with-monitoring');

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

      logger.debug('consent-mode-v2-params-check', {
        ad_user_data: defaultValues.ad_user_data,
        ad_personalization: defaultValues.ad_personalization,
        hasV2Params
      });

      if (hasV2Params) {
        logger.info('consent-mode-v2-confirmed-by-monitoring');

        // ALWAYS upgrade to v2 if V2 params are present
        audit.version = 'v2';
        audit.detected = true;
        audit.confidence = Math.max(audit.confidence || 0, 97);
        audit.detectionMethod = 'Real-time monitoring (V2 confirmed)';

        // ALWAYS remove the "missing V2 params" issue if present (even if previously detected as v2)
        if (audit.issues && Array.isArray(audit.issues)) {
          const beforeFilter = audit.issues.length;
          audit.issues = audit.issues.filter(issue => {
            const issueText = typeof issue === 'string' ? issue.toLowerCase() : '';
            return !issueText.includes('missing') &&
                   !issueText.includes('ad_user_data') &&
                   !issueText.includes('ad_personalization');
          });
          const afterFilter = audit.issues.length;
          if (beforeFilter !== afterFilter) {
            logger.debug('consent-mode-removed-v2-warnings', {
              removedCount: beforeFilter - afterFilter
            });
          }
        }

        // Update consent states with monitored data
        audit.defaultStates = {
          ...audit.defaultStates,
          ...defaultValues
        };
      } else {
        logger.warn('consent-mode-v2-params-incomplete', {
          params: Object.keys(defaultValues)
        });
      }

      // Update monitored states for reference
      audit.monitoredDefaultStates = defaultValues;
    } else {
      logger.warn('consent-mode-no-monitoring-defaults');
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
      logger.info('consent-mode-updates-detected', { totalUpdates });
    }

    // Add monitoring evidence to audit
    audit.monitoringEvidence = {
      gtagCalls: monitoringData.gtagCalls.length,
      dataLayerEvents: monitoringData.dataLayerEvents.length,
      storageWrites: monitoringData.storageWrites.length,
      consentStateFromMonitor: monitoringData.consentState
    };
  }

  // Final cleanup: Remove obsolete V2 parameter warnings if version is v2
  if (audit.version === 'v2' && audit.issues && Array.isArray(audit.issues)) {
    const beforeCleanup = audit.issues.length;
    audit.issues = audit.issues.filter(issue => {
      const issueText = typeof issue === 'string' ? issue.toLowerCase() : '';
      return !issueText.includes('missing') &&
             !issueText.includes('v2 param') &&
             !issueText.includes('ad_user_data') &&
             !issueText.includes('ad_personalization');
    });
    if (beforeCleanup !== audit.issues.length) {
      logger.debug('consent-mode-cleaned-obsolete-warnings', {
        removedCount: beforeCleanup - audit.issues.length
      });
    }
  }

  // Generate recommendations (use audit.version NOT detection.version after monitoring enhancement!)
  if (!audit.detected) {
    audit.recommendations.push('Implement Google Consent Mode v2 for GDPR compliance');
    audit.recommendations.push('Add gtag.js with consent initialization before any tracking');
    audit.severity = 'high';
  } else if (audit.version === 'v1_or_incomplete') {
    audit.recommendations.push('Upgrade to Consent Mode v2 by adding ad_user_data and ad_personalization parameters');
    audit.severity = 'medium';
  } else if (!audit.compliant) {
    audit.recommendations.push('Change default consent states to "denied" for GDPR compliance');
    audit.recommendations.push('Only update to "granted" after explicit user consent');
    audit.severity = 'critical';
  } else {
    audit.recommendations.push('Consent Mode v2 implementation looks good');
    audit.severity = 'none';
  }

  if (audit.detected && !audit.hasUpdates) {
    audit.recommendations.push('Ensure consent "update" commands are fired when user interacts with cookie banner');
  }

  // Final debug logging
  logger.debug('consent-mode-audit-complete', {
    version: audit.version,
    detected: audit.detected,
    issuesCount: audit.issues?.length || 0,
    issues: audit.issues && audit.issues.length > 0 ? audit.issues : undefined
  });

  return audit;
}

module.exports = {
  detectConsentMode,
  checkConsentUpdate,
  auditConsentMode
};
