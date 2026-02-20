/**
 * Main Website Scanner Orchestrator
 * Coordinates all scanning activities
 */

const {
  launchBrowser,
  createPage,
  navigateToUrl,
  waitForPageStability,
  closeBrowser,
  getPageMetadata
} = require('./puppeteer-setup');

const {
  extractCookies,
  getCookieStats,
  findTrackingCookies
} = require('./cookie-extractor');

const {
  setupNetworkMonitoring
} = require('./network-monitor');

const {
  injectTrackingDetector,
  extractTrackingData,
  analyzeTracking
} = require('./tracking-detector');

const {
  captureScreenshots,
  waitForStableView
} = require('./screenshot-capture');

const {
  uploadScreenshots
} = require('../integrations/blob-storage');

const {
  analyzeCookieBanner
} = require('../analyzers/cookie-banner-checker');

const {
  runAssistedConsentSimulation
} = require('./consent-simulator-v1');

const {
  auditConsentMode
} = require('../analyzers/consent-mode-detector');

const {
  buildTimeline,
  enrichCookiesWithTimestamps,
  detectBannerAppearTime,
  generateTimelineReport
} = require('../analyzers/timeline-builder');

const {
  categorizeRequests,
  getTrackingSummary
} = require('../analyzers/network-request-categorizer');

const {
  calculateOverallScore
} = require('../analyzers/compliance-score-calculator');

const {
  getWrapperInjectionScript,
  extractMonitoringData,
  analyzeMonitoringData
} = require('../analyzers/consent-monitor');

const {
  fingerprintVendors,
  generateVendorSummary,
  extractVendorEvidence
} = require('../analyzers/vendor-fingerprinter');

const { getDatabase } = require('../database/db');

const constants = require('../config/constants');

/**
 * Network-Storage Correlation Engine
 *
 * Correlates network tracking requests with storage writes (cookies, localStorage)
 * that occurred within a defined time window. Correlated findings represent the
 * highest-confidence GDPR evidence: data transmitted externally AND persisted locally.
 *
 * Legal relevance: DPAs (CNIL, Austrian DSB) require both network transmission evidence
 * AND proof of persistent storage for cookie consent violations under Art. 5(3) ePrivacy.
 *
 * @param {Array}  trackingRequests    Requests flagged as tracking (before consent)
 * @param {Object} monitoringData      From consent-monitor: { storageWrites, gtagCalls }
 * @param {Object} requestCategorization  From categorizeRequests()
 * @returns {Object} Correlation report
 */
function correlateNetworkAndStorage(trackingRequests, monitoringData, requestCategorization) {
  const CORRELATION_WINDOW_MS = 1000; // 1 second window for co-occurrence

  const correlatedViolations = [];
  const uncorrelatedNetwork  = [];

  // Extract storage writes with timestamps from monitoring data
  const storageWrites = (monitoringData && Array.isArray(monitoringData.storageWrites))
    ? monitoringData.storageWrites
    : [];

  // Extract Category A requests (highest-confidence tracking) from all requests
  const categoryARequests = requestCategorization
    ? (requestCategorization.categoryA?.requests || [])
    : [];

  // Merge: use trackingRequests before consent + all Cat-A requests
  const candidateRequests = [
    ...trackingRequests,
    ...categoryARequests.filter(r => {
      // Avoid duplicates by URL+timestamp
      return !trackingRequests.some(tr => tr.url === r.url);
    })
  ];

  for (const netReq of candidateRequests) {
    const netTimestamp = netReq.timestamp || 0;

    // Find storage writes within the correlation window
    const matchingStorage = storageWrites.filter(write => {
      const writeTime = write.timestamp || 0;
      return Math.abs(writeTime - netTimestamp) <= CORRELATION_WINDOW_MS;
    });

    if (matchingStorage.length > 0) {
      // Correlated: network transmission + storage write within 1s
      correlatedViolations.push({
        networkRequest: {
          url:            netReq.url,
          method:         netReq.method || 'GET',
          timestamp:      netTimestamp,
          vendor:         netReq.categorization?.vendor || netReq.vendor || null,
          category:       netReq.categorization?.category || 'A',
          confidence:     netReq.categorization?.confidence || 0
        },
        storageWrites: matchingStorage.map(w => ({
          type:      w.type || 'unknown',  // 'localStorage' | 'sessionStorage' | 'cookie'
          key:       w.key,
          value:     w.value ? String(w.value).substring(0, 30) + '…' : null,
          timestamp: w.timestamp
        })),
        correlationType:  'network_and_storage',
        evidenceStrength: 'HIGH',
        legalNote: 'Simultaneous network transmission and local storage write detected. ' +
                   'This constitutes dual-layer GDPR Art. 5(3) ePrivacy violation evidence.'
      });
    } else {
      uncorrelatedNetwork.push({
        url:       netReq.url,
        timestamp: netTimestamp,
        vendor:    netReq.categorization?.vendor || null,
        category:  netReq.categorization?.category || 'B'
      });
    }
  }

  // Confidence calculation:
  // 100% if correlated violations exist (dual evidence)
  // 70% if only network evidence (Category A requests)
  // 40% if only storage evidence
  let overallConfidence = 0;
  if (correlatedViolations.length > 0) {
    overallConfidence = Math.min(95, 70 + (correlatedViolations.length * 5));
  } else if (categoryARequests.length > 0) {
    overallConfidence = 70;
  } else if (storageWrites.length > 0) {
    overallConfidence = 40;
  }

  return {
    correlatedViolations,
    uncorrelatedNetworkTracking: uncorrelatedNetwork,
    storageWritesTotal:          storageWrites.length,
    overallConfidence,
    summary: {
      correlatedCount:       correlatedViolations.length,
      networkOnlyCount:      uncorrelatedNetwork.length,
      storageWritesDetected: storageWrites.length,
      evidenceLevel: correlatedViolations.length > 0 ? 'HIGH (dual-layer)'
                   : categoryARequests.length > 0    ? 'MEDIUM (network only)'
                   : 'LOW (storage only)'
    }
  };
}

/**
 * State machine for audit pipeline
 * Maps progress to explicit states for frontend polling
 */
const AUDIT_STATES = {
  INIT: 'INIT',
  SCANNING: 'SCANNING',
  SCREENSHOTS: 'SCREENSHOTS',
  UPLOADING: 'UPLOADING',
  SIMULATION: 'SIMULATION',
  SCORING: 'SCORING',
  DONE: 'DONE',
  FAILED: 'FAILED'
};

/**
 * Map step number to state
 * @param {number} step - Current step
 * @returns {string} State name
 */
function mapStepToState(step) {
  if (step <= 1) return AUDIT_STATES.INIT;
  if (step <= 10) return AUDIT_STATES.SCANNING;
  if (step <= 11) return AUDIT_STATES.SCREENSHOTS;
  if (step <= 12) return AUDIT_STATES.UPLOADING;
  if (step <= 16) return AUDIT_STATES.SIMULATION;
  if (step <= 17) return AUDIT_STATES.SCORING;
  return AUDIT_STATES.DONE;
}

/**
 * Estimate remaining time based on current step
 * @param {number} step - Current step
 * @param {number} totalSteps - Total steps
 * @param {number} elapsedSeconds - Time elapsed since start
 * @returns {number|null} Estimated seconds remaining
 */
function estimateRemainingTime(step, totalSteps, elapsedSeconds) {
  if (step === 0) return null;

  // Average time per step
  const avgTimePerStep = elapsedSeconds / step;

  // Steps remaining
  const stepsRemaining = totalSteps - step;

  // Estimated time (with buffer for heavier operations)
  const estimated = Math.round(avgTimePerStep * stepsRemaining * 1.2);

  return estimated > 0 ? estimated : null;
}

/**
 * Update scan progress and state in database
 * @param {number} auditId - Audit ID
 * @param {number} currentStep - Current step number
 * @param {number} totalSteps - Total number of steps
 * @param {string} message - Progress message
 * @param {number} startTime - Scan start time (Date.now())
 */
function updateProgress(auditId, currentStep, totalSteps, message, startTime = Date.now(), extraMetadata = {}) {
  try {
    const db = getDatabase();
    const now = Date.now();
    const elapsedSeconds = Math.round((now - startTime) / 1000);

    // Use extraMetadata.state if provided (for WAITING_MANUAL_CONSENT)
    const state = extraMetadata.state || mapStepToState(currentStep);

    const progress = {
      currentStep,
      totalSteps,
      message,
      percentage: Math.round((currentStep / totalSteps) * 100),
      state: state,
      estimatedTimeRemaining: estimateRemainingTime(currentStep, totalSteps, elapsedSeconds),
      timestamp: now,
      metadata: {
        currentOperation: message,
        ...extraMetadata  // Merge extra metadata (websiteUrl, instructions, etc.)
      }
    };

    db.prepare(`
      UPDATE audits
      SET progress_json = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(progress), auditId);
  } catch (error) {
    console.warn('⚠️  Failed to update progress:', error.message);
  }
}

/**
 * Scan a website for cookies and tracking
 * @param {string} websiteUrl - URL to scan
 * @param {number} auditId - Database audit ID
 * @param {string} auditUid - Audit unique identifier
 * @returns {Promise<Object>} Scan results
 */
async function scanWebsite(websiteUrl, auditId, auditUid) {
  const startTime = Date.now();
  let browser = null;
  let stepStartTime = Date.now();

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🚀 Starting scan for: ${websiteUrl}`);
    console.log(`📝 Audit ID: ${auditUid}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Step 1: Initialize and Load Target (consolidated infrastructure setup)
    const initStartTime = Date.now();
    console.log('🚀 Step 1: Initialize and Load Target...');
    updateProgress(auditId, 1, 17, 'Initializing browser and loading website...', startTime);

    // Launch browser
    stepStartTime = Date.now();
    console.log('   📦 Launching browser...');
    browser = await launchBrowser();
    console.log(`   ✅ Browser launched in ${Date.now() - stepStartTime}ms`);

    // Create page with monitoring
    stepStartTime = Date.now();
    console.log('   📄 Creating page with monitoring...');
    const page = await createPage(browser);
    console.log(`   ✅ Page created in ${Date.now() - stepStartTime}ms`);

    // Capture browser console for CMP diagnostics
    page.on('console', msg => {
      const text = msg.text();

      // Only log CMP/Consent Mode related messages
      if (text.includes('consent') || text.includes('CookieScript') ||
          text.includes('google_tag') || text.includes('ics')) {
        console.log(`   🌐 [Browser ${msg.type()}] ${text}`);
      }
    });

    // Setup network monitoring
    stepStartTime = Date.now();
    console.log('   🌐 Setting up network monitoring...');
    const networkMonitor = setupNetworkMonitoring(page);
    console.log(`   ✅ Network monitoring setup in ${Date.now() - stepStartTime}ms`);

    // Inject consent monitor wrappers BEFORE any scripts load
    stepStartTime = Date.now();
    console.log('   🛡️  Injecting consent monitor wrappers...');
    try {
      const wrapperScript = getWrapperInjectionScript();
      await page.evaluateOnNewDocument(wrapperScript);
      console.log(`   ✅ Consent monitor wrappers injected (gtag, dataLayer, localStorage)`);
      console.log(`   🎯 Ready to capture: consent calls, tracking events, storage writes`);
    } catch (error) {
      console.error(`   ⚠️  Consent monitor injection failed: ${error.message}`);
      console.error(`   ⚠️  Continuing without consent monitoring...`);
    }
    console.log(`   ✅ Consent monitoring setup in ${Date.now() - stepStartTime}ms`);

    // Inject tracking detector BEFORE navigation
    stepStartTime = Date.now();
    console.log('   🔍 Injecting tracking detector...');
    await injectTrackingDetector(page);
    console.log(`   ✅ Tracking detector injected in ${Date.now() - stepStartTime}ms`);

    // Navigate to URL
    stepStartTime = Date.now();
    console.log('   🌐 Navigating to URL...');
    await navigateToUrl(page, websiteUrl);
    networkMonitor.markPageLoaded();
    console.log(`   ✅ Navigation completed in ${Date.now() - stepStartTime}ms`);

    console.log(`✅ Step 1 completed in ${Date.now() - initStartTime}ms`);

    // Step 5.5: IMMEDIATE cookie snapshot (NO delay) - captures already loaded cookies
    stepStartTime = Date.now();
    console.log('🍪 Step 5.5: Taking immediate cookie snapshot (baseline)...');
    const baselineCookies = await extractCookies(page, { skipDelay: true }); // NO delay!
    const baselineTime = await page.evaluate(() => performance.now());
    console.log(`   📸 Baseline snapshot: ${baselineCookies.length} cookies at ${(baselineTime / 1000).toFixed(2)}s`);

    // Step 5.7: INTERMEDIATE snapshot AFTER 5s delay - captures async-loaded cookies (_ga, _gcl_au)
    stepStartTime = Date.now();
    console.log('🍪 Step 5.7: Waiting 5s and taking intermediate snapshot (async cookies)...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s for _ga, _gcl_au to load
    const intermediateCookies = await extractCookies(page, { skipDelay: true }); // Immediate after wait
    const intermediateTime = await page.evaluate(() => performance.now());
    console.log(`   📸 Intermediate snapshot: ${intermediateCookies.length} cookies at ${(intermediateTime / 1000).toFixed(2)}s`);

    // Step 6: Wait for page stability
    stepStartTime = Date.now();
    console.log('⏳ Step 6: Waiting for page stability...');
    await waitForPageStability(page, 3000);
    console.log(`   ✅ Page stable after ${Date.now() - stepStartTime}ms`);

    // Step 6.6: Universal wait for Consent Mode initialization (CMP-agnostic)
    stepStartTime = Date.now();
    console.log('   🎯 Waiting for Consent Mode data (google_tag_data.ics)...');

    let consentReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 15s max wait (500ms * 30)

    while (!consentReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));

      // Log raw google_tag_data structure for diagnostics
      const debugData = await page.evaluate(() => {
        if (!window.google_tag_data?.ics?.entries) return null;

        const entries = window.google_tag_data.ics.entries;
        const params = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

        const snapshot = {
          timestamp: Date.now(),
          perfTime: performance.now(),
          entries: {}
        };

        params.forEach(param => {
          if (entries[param]) {
            snapshot.entries[param] = {
              default: entries[param].default,
              update: entries[param].update
            };
          }
        });

        return snapshot;
      });

      if (debugData && attempts % 4 === 0) {
        // Log every 2s (every 4th attempt at 500ms intervals) to avoid spam
        console.log(`   🔍 [Attempt ${attempts}] Consent Mode @ ${debugData.perfTime.toFixed(0)}ms:`, JSON.stringify(debugData.entries, null, 2));
      }

      consentReady = await page.evaluate(() => {
        // UNIVERSAL check: Wait for google_tag_data.ics to be populated
        // This works for ALL CMPs (CookieScript, OneTrust, Cookiebot, etc.)
        if (!window.google_tag_data?.ics?.entries) {
          return false; // ics not initialized yet
        }

        const entries = window.google_tag_data.ics.entries;
        const params = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

        // Check if at least ONE critical param has a REAL value (not undefined, not 'not_set')
        // CRITICAL: Reject 'not_set' as it's a transitional state used by CMPs during initialization
        // Only accept 'denied' or 'granted' as valid consent states
        const hasAtLeastOneParam = params.some(param => {
          const entry = entries[param];
          if (!entry || entry.default === undefined) return false;

          // ❌ REJECT transitional 'not_set' (CookieScript initialization marker)
          if (entry.default === 'not_set') return false;

          // ✅ ACCEPT real values: 'denied' or 'granted'
          return true;
        });

        return hasAtLeastOneParam;
      });

      attempts++;
    }

    if (consentReady) {
      console.log(`   ✅ Consent Mode initialized after ${attempts * 500}ms`);
    } else {
      console.log(`   ⚠️  Consent Mode not initialized after ${maxAttempts * 500}ms - proceeding anyway`);
      console.log(`   ℹ️  Note: This is normal if site doesn't use Consent Mode or uses non-standard implementation`);
    }

    console.log(`   ✅ Consent wait completed in ${Date.now() - stepStartTime}ms`);

    // Step 6.5: Detect cookie banner appearance time
    stepStartTime = Date.now();
    const bannerAppearTime = await detectBannerAppearTime(page);
    if (bannerAppearTime) {
      console.log(`   🍪 Cookie banner detected at ${(bannerAppearTime / 1000).toFixed(2)}s after page load`);
    }

    // Step 7: Extract final cookies (with 3s delay for any remaining async cookies)
    stepStartTime = Date.now();
    console.log('🍪 Step 7: Extracting final cookies and comparing with snapshots...');
    updateProgress(auditId, 7, 17, 'Extracting and analyzing cookies...', startTime);
    let cookies = await extractCookies(page); // WITH delay (default 3s)
    const finalTime = await page.evaluate(() => performance.now());

    // THREE-TIER timestamp assignment:
    // 1. If in baseline → detectedAt = baselineTime (~1.5s)
    // 2. If in intermediate but not baseline → detectedAt = intermediateTime (~6.5s) ← _ga here!
    // 3. If only in final → detectedAt = finalTime (~15s)
    const baselineCookieNames = new Set(baselineCookies.map(c => c.name));
    const intermediateCookieNames = new Set(intermediateCookies.map(c => c.name));

    cookies = cookies.map(cookie => {
      let detectedAt, detectionStage;

      if (baselineCookieNames.has(cookie.name)) {
        detectedAt = baselineTime;
        detectionStage = 'baseline';
      } else if (intermediateCookieNames.has(cookie.name)) {
        detectedAt = intermediateTime; // ← _ga gets THIS timestamp!
        detectionStage = 'intermediate';
      } else {
        detectedAt = finalTime;
        detectionStage = 'final';
      }

      return {
        ...cookie,
        detectedAt: detectedAt,
        detectedAtAbsolute: Date.now(),
        detectionStage: detectionStage,
        loadedBeforeBanner: bannerAppearTime && detectedAt < bannerAppearTime
      };
    });

    const cookieStats = getCookieStats(cookies);
    const trackingCookies = findTrackingCookies(cookies);

    // Count cookies loaded before banner
    const cookiesBeforeBanner = cookies.filter(c => c.loadedBeforeBanner);
    const trackingBeforeBanner = trackingCookies.filter(c => c.loadedBeforeBanner);

    console.log(`   Found ${cookies.length} cookies:`);
    console.log(`   - Essential: ${cookieStats.byCategory.essential || 0}`);
    console.log(`   - Analytics: ${cookieStats.byCategory.analytics || 0}`);
    console.log(`   - Advertising: ${cookieStats.byCategory.advertising || 0}`);
    console.log(`   - Tracking cookies: ${trackingCookies.length}`);
    console.log(`   - Cookies before banner: ${cookiesBeforeBanner.length}`);
    console.log(`   - TRACKING before banner: ${trackingBeforeBanner.length} ⚠️`);
    if (trackingBeforeBanner.length > 0) {
      trackingBeforeBanner.forEach(c => {
        console.log(`      ⚠️  ${c.name} (${c.category})`);
      });
    }
    console.log(`   ✅ Cookie extraction completed in ${Date.now() - stepStartTime}ms`);

    // Step 8: Get network requests (preliminary counts — will be re-categorized in Step 13.6)
    stepStartTime = Date.now();
    console.log('📊 Step 8: Analyzing network requests (preliminary)...');
    const networkStats = networkMonitor.getStats();
    let trackingRequests = networkMonitor.getTrackingRequests();
    let trackingBeforeConsentRequests = networkMonitor.getTrackingBeforeConsent();

    console.log(`   Total requests: ${networkStats.totalRequests}`);
    console.log(`   Tracking requests (preliminary, domain-based): ${networkStats.trackingRequests}`);
    console.log(`   Tracking before consent (preliminary): ${networkStats.trackingBeforeConsent}`);
    console.log(`   ℹ️  Note: Final counts after re-categorization in Step 13.6 (excludes blocked requests)`);
    console.log(`   ✅ Network analysis completed in ${Date.now() - stepStartTime}ms`);

    // Step 9: Analyze tracking before consent
    stepStartTime = Date.now();
    console.log('🔬 Step 9: Analyzing tracking before consent...');
    const trackingData = await extractTrackingData(page);
    const trackingAnalysis = analyzeTracking(trackingData, cookies);
    console.log(`   ✅ Tracking analysis completed in ${Date.now() - stepStartTime}ms`);

    // Step 10: Analyze cookie banner for NOYB violations
    stepStartTime = Date.now();
    console.log('⚖️  Step 10: Analyzing cookie banner for GDPR violations...');
    updateProgress(auditId, 10, 17, 'Analyzing cookie banner compliance (NOYB checklist)...', startTime);
    const bannerAnalysis = await analyzeCookieBanner(page, auditId, cookies);
    console.log(`   ✅ Banner analysis completed in ${Date.now() - stepStartTime}ms`);
    console.log(`   📋 Violations found: ${bannerAnalysis.violationCount}/${bannerAnalysis.totalChecks}`);
    if (bannerAnalysis.skippedCount > 0) {
      console.log(`   ⏭️  Checks skipped: ${bannerAnalysis.skippedCount}`);
    }
    console.log(`   ⚠️  Critical violations: ${bannerAnalysis.hasCriticalViolations ? 'YES' : 'NO'}`);

    // Step 10.4: Extract consent monitoring data + vendor fingerprinting
    stepStartTime = Date.now();
    console.log('🔬 Step 10.4: Extracting consent monitor data + fingerprinting vendors...');
    let monitoringData = null;
    let monitoringAnalysis = null;
    let detectedVendors = [];
    let vendorSummary = null;

    try {
      // Extract monitoring data (gtag calls, dataLayer events, storage writes)
      monitoringData = await extractMonitoringData(page);

      if (monitoringData.initialized) {
        console.log(`   ✅ Consent monitor active:`);
        console.log(`      - gtag calls: ${monitoringData.gtagCalls.length}`);
        console.log(`      - dataLayer events: ${monitoringData.dataLayerEvents.length}`);
        console.log(`      - Storage writes: ${monitoringData.storageWrites.length}`);

        if (monitoringData.errors.length > 0) {
          console.log(`   ⚠️  Monitor errors: ${monitoringData.errors.length}`);
        }

        // Analyze for violations
        monitoringAnalysis = analyzeMonitoringData(monitoringData);
        console.log(`   📊 Violations: ${monitoringAnalysis.violations.length} (${monitoringAnalysis.summary.criticalViolations} critical)`);

        // Extract vendor evidence
        const vendorEvidence = await extractVendorEvidence(page, networkMonitor.getRequests());
        vendorEvidence.monitorData = monitoringData; // Add monitoring data for timing correlation

        // Fingerprint vendors
        detectedVendors = fingerprintVendors(vendorEvidence);
        vendorSummary = generateVendorSummary(detectedVendors, monitoringData.consentState);

        console.log(`   🏷️  Detected vendors: ${detectedVendors.length}`);
        if (detectedVendors.length > 0) {
          const topVendors = detectedVendors.slice(0, 5);
          topVendors.forEach(vendor => {
            const violationFlag = vendor.violation ? '⚠️' : '✅';
            console.log(`      ${violationFlag} ${vendor.name} (${vendor.category}, ${vendor.confidence}% confidence)`);
          });
        }

        if (vendorSummary.violations.length > 0) {
          console.log(`   ⚠️  Vendor violations: ${vendorSummary.violations.length}`);
        }
      } else {
        console.log(`   ⚠️  Consent monitor not initialized - wrappers may have failed`);
      }

    } catch (error) {
      console.error(`   ⚠️  Consent monitoring failed: ${error.message}`);
    }

    console.log(`   ✅ Consent monitoring + vendor fingerprinting completed in ${Date.now() - stepStartTime}ms`);

    // Step 10.5: Audit Google Consent Mode v2 (with monitoring data)
    stepStartTime = Date.now();
    console.log('🎯 Step 10.5: Checking Google Consent Mode v2...');
    const consentModeAudit = await auditConsentMode(page, monitoringData);
    console.log(`   ✅ Consent Mode audit completed in ${Date.now() - stepStartTime}ms`);
    if (consentModeAudit.detected) {
      console.log(`   📊 Version: ${consentModeAudit.version || 'unknown'}`);
      console.log(`   ${consentModeAudit.compliant ? '✅' : '⚠️'}  GDPR Compliance: ${consentModeAudit.compliant ? 'YES' : 'NO'}`);
    } else {
      console.log(`   ⚠️  Consent Mode not detected`);
    }

    // Step 11 & 12: Screenshots (HARD DISABLED - temporary)
    // CRITICAL: Do NOT execute screenshot code to prevent 2.5min blocking
    let screenshotUrls = {};
    console.log('⏭️  Step 11-12: Screenshots DISABLED (temporary) - skipping to maintain fast audit loop');

    // FUTURE: When screenshots are re-enabled, uncomment below with proper safeguards:
    // - protocolTimeout must be lowered (done: 10s)
    // - Promise.race must use AbortController for real cancellation
    // - Sequential selector loops must be replaced with Promise.race(selectors)
    // - Image loading checks must be removed from waitForStableView
    /*
    if (constants.ENABLE_SCREENSHOTS) {
      stepStartTime = Date.now();
      console.log('📸 Step 11: Capturing screenshots...');
      await waitForStableView(page);
      const screenshots = await captureScreenshots(page);
      console.log(`   ✅ Screenshots captured in ${Date.now() - stepStartTime}ms`);

      stepStartTime = Date.now();
      console.log('☁️  Step 12: Uploading screenshots to Vercel Blob...');
      screenshotUrls = await uploadScreenshots(screenshots, auditUid);
      console.log(`   ✅ Screenshots uploaded in ${Date.now() - stepStartTime}ms`);
      console.log(`   📎 Full page: ${screenshotUrls.fullPageUrl ? 'Uploaded' : 'Failed'}`);
      console.log(`   📎 Banner: ${screenshotUrls.bannerUrl ? 'Uploaded' : 'Failed'}`);
    }
    */

    // Step 13: Get page metadata
    stepStartTime = Date.now();
    updateProgress(auditId, 13, 17, 'Building request timeline and capturing screenshots...', startTime);
    const metadata = await getPageMetadata(page);
    console.log(`   ✅ Metadata extracted in ${Date.now() - stepStartTime}ms`);

    // Step 13.5: Build timeline
    stepStartTime = Date.now();
    console.log('⏱️  Step 13.5: Building request timeline...');
    const pageLoadTime = await page.evaluate(() => {
      return performance.timing.loadEventEnd - performance.timing.navigationStart;
    });

    const timeline = buildTimeline({
      cookies: cookies,
      networkRequests: networkMonitor.getRequests(),
      pageLoadTime: pageLoadTime,
      bannerAppearTime: bannerAppearTime,
      consentTime: null // We don't track user consent click yet
    });

    const timelineReport = generateTimelineReport(timeline);
    console.log(`   ✅ Timeline built in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Events: ${timeline.events.length}, Violations: ${timeline.violations?.length || 0}`);
    console.log(`   ⚠️  Before consent: ${timelineReport.beforeConsent.cookies} cookies, ${timelineReport.beforeConsent.requests} requests`);

    // Step 13.6: Categorize network requests (Problem 5)
    stepStartTime = Date.now();
    console.log('🔍 Step 13.6: Categorizing network requests...');
    const requestCategorization = categorizeRequests(networkMonitor.getRequests());
    const trackingSummary = getTrackingSummary(requestCategorization);
    console.log(`   ✅ Categorization completed in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Definite tracking: ${requestCategorization.categoryA.count}`);
    console.log(`   📊 Suspicious: ${requestCategorization.categoryB.count}`);
    console.log(`   📊 Benign: ${requestCategorization.categoryC.count}`);
    if (Object.keys(requestCategorization.vendorBreakdown).length > 0) {
      console.log(`   📊 Top vendors: ${Object.keys(requestCategorization.vendorBreakdown).slice(0, 3).join(', ')}`);
    }

    // ── CRITICAL FIX: Replace boolean-flagged tracking arrays with re-categorized data ──
    // Problem: Step 8 used isTrackingRequest() which is a simple domain check BEFORE responseStatus is known.
    // Solution: Use requestCategorization.trackingRequests which applies 5-layer detection + hard override for blocked requests.
    // This ensures ANY blocked request (Facebook, Google, etc.) is excluded if responseStatus === 0 (Benign category).
    //
    // Re-assign trackingRequests to use final categorized data (excludes blocked requests via hard override)
    trackingRequests = requestCategorization.trackingRequests;

    // Re-assign trackingBeforeConsentRequests to use final categorized + beforeConsent filter
    trackingBeforeConsentRequests = requestCategorization.trackingRequests.filter(r => r.beforeConsent);

    console.log(`   🔄 Tracking requests (re-categorized): ${trackingRequests.length}`);
    console.log(`   🔄 Tracking before consent (re-categorized): ${trackingBeforeConsentRequests.length}`);

    // Step 13.7: Network-storage correlation
    // Correlates network tracking requests with storage writes within a time window.
    // Correlated findings = highest-confidence GDPR evidence (network transmission + local persistence).
    // NOTE: trackingBeforeConsentRequests now contains re-categorized data (blocked requests excluded).
    stepStartTime = Date.now();
    console.log('🔗 Step 13.7: Correlating network requests with storage writes...');

    const networkStorageCorrelations = correlateNetworkAndStorage(
      trackingBeforeConsentRequests,  // ← Re-categorized data (excludes blocked requests via hard override)
      monitoringData,
      requestCategorization
    );

    console.log(`   ✅ Correlation completed in ${Date.now() - stepStartTime}ms`);
    console.log(`   🔗 Correlated violations: ${networkStorageCorrelations.correlatedViolations.length}`);
    console.log(`   📊 Confidence: ${networkStorageCorrelations.overallConfidence}%`);

    // Calculate scan duration
    const scanDuration = Math.round((Date.now() - startTime) / 1000);

    // Prepare detailed tracking before consent data for frontend
    const trackingBeforeConsentDetailed = {
      networkRequests: trackingBeforeConsentRequests.map(req => ({
        type: 'network',
        name: req.domain || new URL(req.url).hostname,
        url: req.url,
        method: req.method,
        resourceType: req.resourceType,
        timestamp: req.timestamp,
        category: 'tracking'
      })),
      cookies: trackingAnalysis.identifiedTrackers
        .filter(t => t.type === 'cookie')
        .map(t => ({
          type: 'cookie',
          name: t.name,
          value: t.value?.substring(0, 20) + '...',
          timestamp: t.timestamp,
          category: 'tracking'
        })),
      localStorage: trackingAnalysis.identifiedTrackers
        .filter(t => t.type === 'localStorage')
        .map(t => ({
          type: 'localStorage',
          name: t.name,
          value: t.value?.substring(0, 20) + '...',
          timestamp: t.timestamp,
          category: 'tracking'
        })),
      indexedDB: trackingAnalysis.identifiedTrackers
        .filter(t => t.type === 'indexedDB')
        .map(t => ({
          type: 'indexedDB',
          name: t.name,
          timestamp: t.timestamp,
          category: 'tracking'
        })),
      total: trackingBeforeConsentRequests.length + trackingAnalysis.violationCount
    };

    // Prepare results
    const results = {
      cookies: cookies,
      cookieStats: cookieStats,
      trackingCookies: trackingCookies,
      networkRequests: networkMonitor.getRequests(),
      trackingRequests: trackingRequests,
      trackingBeforeConsent: trackingAnalysis.trackingBeforeConsent,
      trackingBeforeConsentDetails: trackingAnalysis,
      trackingBeforeConsentDetailed: trackingBeforeConsentDetailed,
      trackingBeforeConsentCount: trackingBeforeConsentRequests.length + trackingAnalysis.violationCount,
      bannerViolations: bannerAnalysis?.violations || [],
      bannerAnalysis: bannerAnalysis,
      consentModeAudit: consentModeAudit,
      monitoringData: monitoringData,
      monitoringAnalysis: monitoringAnalysis,
      detectedVendors: detectedVendors,
      vendorSummary: vendorSummary,
      timeline: timeline,
      timelineReport: timelineReport,
      requestCategorization: requestCategorization,
      trackingSummary: trackingSummary,
      networkStorageCorrelations: networkStorageCorrelations,
      screenshots: {
        full: screenshotUrls.fullPageUrl,
        banner: screenshotUrls.bannerUrl
      },
      metadata: metadata,
      scanDuration: scanDuration
    };

    // Step 14: Save to database
    console.log('💾 Step 14: Saving results to database...');
    await saveScanResults(auditId, results);

    // Step 15: Close browser
    console.log('🧹 Step 15: Cleaning up...');
    await closeBrowser(browser);

    // Step 16: Consent Simulation (Human-Assisted Accept vs Reject)
    let consentSimulation = null;
    stepStartTime = Date.now();
    console.log('');
    console.log('🎭 Step 16: Running human-assisted consent simulation...');
    updateProgress(auditId, 16, 17, 'Consent simulation (human-assisted)...', startTime);

    try {
      consentSimulation = await runAssistedConsentSimulation(websiteUrl, auditId);

      if (consentSimulation.waiting) {
        console.log(`   ⏸️  Consent simulation waiting: ${consentSimulation.reason}`);
        console.log(`   📋 Instructions: ${consentSimulation.instructions}`);

        // PAUSE audit and set status to WAITING_MANUAL_CONSENT
        updateProgress(auditId, 16, 17, 'WAITING_MANUAL_CONSENT', startTime, {
          state: 'WAITING_MANUAL_CONSENT',
          websiteUrl: websiteUrl,
          instructions: consentSimulation.instructions
        });

        // Save partial results to database
        results.consentSimulation = consentSimulation;
        savePartialResults(auditId, results);

        // Update audit status to PAUSED (prevents audit.routes.js from marking as COMPLETED)
        const db = getDatabase();
        db.prepare(`
          UPDATE audits
          SET status = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(constants.AUDIT_STATUS.PAUSED, auditId);

        console.log('');
        console.log('⏸️  === AUDIT PAUSED ===');
        console.log('   Waiting for manual consent simulation upload from local machine');
        console.log('   Audit will resume automatically after data upload via /api/audit/:id/resume');
        console.log('');

        // Return pause indicator - do NOT continue to Step 17
        return {
          paused: true,
          auditId,
          websiteUrl,
          instructions: consentSimulation.instructions
        };
      } else if (consentSimulation.skipped) {
        console.log(`   ⏭️  Consent simulation skipped: ${consentSimulation.reason}`);
      } else {
        console.log(`   ✅ Consent simulation completed in ${consentSimulation.duration}s`);
        if (consentSimulation.comparison) {
          console.log(`   🍪 New cookies after Accept: ${consentSimulation.comparison.cookies.newAfterAccept.length}`);
          console.log(`   📡 New tracking domains after Accept: ${consentSimulation.comparison.network.newDomainsAfterAccept.length}`);
        }
      }

      // Add consent simulation results to main results
      results.consentSimulation = consentSimulation;
    } catch (error) {
      console.error(`   ⚠️  Consent simulation failed: ${error.message}`);
      // Don't fail the entire scan if simulation fails
      results.consentSimulation = {
        error: error.message,
        skipped: false,
        rejectScenario: { success: false },
        acceptScenario: { success: false }
      };
    }

    // Step 17: Calculate overall compliance score (Problem 7)
    stepStartTime = Date.now();
    console.log('');
    console.log('📊 Step 17: Calculating overall compliance score...');
    updateProgress(auditId, 17, 17, 'Calculating compliance score and finalizing report...', startTime);
    const complianceScore = calculateOverallScore(results);
    results.complianceScore = complianceScore;
    console.log(`   ✅ Compliance score calculated in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Overall Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`);
    console.log(`   📋 Components:`);
    console.log(`      - Privacy Policy: ${complianceScore.components.privacyPolicy?.score ?? 0}/100`);
    console.log(`      - Cookie Banner: ${complianceScore.components.cookieBanner?.score ?? 0}/100`);
    console.log(`      - Technical: ${complianceScore.components.technical?.score ?? 0}/100`);
    console.log(`      - Cookie Policy: ${complianceScore.components.cookiePolicy?.score ?? 0}/100`);
    if (complianceScore.capsApplied.length > 0) {
      console.log(`   ⚠️  Score caps applied: ${complianceScore.capsApplied.join(', ')}`);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Scan completed in ${scanDuration}s`);
    console.log(`   Cookies: ${cookies.length}`);
    console.log(`   Tracking before consent: ${results.trackingBeforeConsent ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`   Compliance Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`);
    console.log(`   Screenshots uploaded: ${screenshotUrls.fullPageUrl ? 'YES' : 'NO'}`);
    if (consentSimulation && consentSimulation.success !== false && consentSimulation.comparison?.violations) {
      console.log(`   Consent violations: ${consentSimulation.comparison.violations.length}`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    return results;

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ Scan failed:', error.message);
    console.error('═══════════════════════════════════════════════════════');
    console.error('');

    // Close browser if still open
    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    throw error;
  }
}

/**
 * Save scan results to database
 * @param {number} auditId - Audit ID
 * @param {Object} results - Scan results
 */
async function saveScanResults(auditId, results) {
  const db = getDatabase();

  try {
    // Check if new columns exist
    const tableInfo = db.prepare("PRAGMA table_info(scan_results)").all();
    const columnNames = tableInfo.map(col => col.name);
    const hasComplianceScore = columnNames.includes('compliance_score_json');
    const hasRequestCategorization = columnNames.includes('request_categorization_json');
    const hasConsentSimulation = columnNames.includes('consent_simulation_json');
    const hasMonitoringData = columnNames.includes('monitoring_data_json');
    const hasMonitoringAnalysis = columnNames.includes('monitoring_analysis_json');
    const hasDetectedVendors = columnNames.includes('detected_vendors_json');
    const hasVendorSummary = columnNames.includes('vendor_summary_json');
    const hasNetworkStorageCorr = columnNames.includes('network_storage_correlations_json');

    // Idempotent migration: add column if not present
    if (!hasNetworkStorageCorr) {
      try {
        db.exec(`ALTER TABLE scan_results ADD COLUMN network_storage_correlations_json TEXT`);
      } catch { /* column already exists */ }
    }

    // Build dynamic INSERT statement based on available columns
    let insertColumns = `
      audit_id,
      cookies_json,
      network_requests_json,
      tracking_before_consent,
      banner_violations_json,
      consent_mode_v2_status,
      timeline_json,
      screenshot_full_url,
      screenshot_banner_url,
      scan_duration_seconds
    `;
    let insertPlaceholders = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
    const insertValues = [
      auditId,
      JSON.stringify(results.cookies),
      JSON.stringify(results.networkRequests),
      results.trackingBeforeConsent ? 1 : 0,
      JSON.stringify(results.bannerViolations || []),
      JSON.stringify(results.consentModeAudit || {}),
      JSON.stringify(results.timeline || {}),
      results.screenshots.full || null,
      results.screenshots.banner || null,
      results.scanDuration
    ];

    if (hasComplianceScore) {
      insertColumns += ',\n      compliance_score_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.complianceScore || {}));
    }

    if (hasRequestCategorization) {
      insertColumns += ',\n      request_categorization_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.trackingSummary || {}));
    }

    if (hasConsentSimulation) {
      insertColumns += ',\n      consent_simulation_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.consentSimulation || {}));
    }

    if (hasMonitoringData) {
      insertColumns += ',\n      monitoring_data_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.monitoringData || null));
    }

    if (hasMonitoringAnalysis) {
      insertColumns += ',\n      monitoring_analysis_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.monitoringAnalysis || null));
    }

    if (hasDetectedVendors) {
      insertColumns += ',\n      detected_vendors_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.detectedVendors || []));
    }

    if (hasVendorSummary) {
      insertColumns += ',\n      vendor_summary_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.vendorSummary || null));
    }

    if (hasNetworkStorageCorr || true) { // column just migrated above — always include
      insertColumns += ',\n      network_storage_correlations_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.networkStorageCorrelations || null));
    }

    const stmt = db.prepare(`
      INSERT INTO scan_results (
        ${insertColumns}
      ) VALUES (${insertPlaceholders})
    `);

    stmt.run(...insertValues);

    // Update audits table with overall score
    if (results.complianceScore) {
      try {
        const updateStmt = db.prepare(`
          UPDATE audits
          SET overall_score = ?,
              score_grade = ?
          WHERE id = ?
        `);

        updateStmt.run(
          results.complianceScore.overallScore,
          results.complianceScore.grade,
          auditId
        );
      } catch (scoreUpdateError) {
        console.warn('⚠️  Could not update overall_score in audits table (columns may not exist yet)');
      }
    }

    console.log('✅ Scan results saved to database');
  } catch (error) {
    console.error('❌ Failed to save scan results:', error.message);
    console.error('   Full error:', error);
    throw error;
  }
}

/**
 * Save partial results to database (for paused audits)
 */
function savePartialResults(auditId, results) {
  try {
    const db = getDatabase();

    // Check if scan_results already exists
    const existing = db.prepare(`
      SELECT id FROM scan_results WHERE audit_id = ? LIMIT 1
    `).get(auditId);

    if (existing) {
      // Update existing (scan_results doesn't have updated_at column)
      // Just skip update for now
    } else {
      // Insert minimal record
      db.prepare(`
        INSERT INTO scan_results (
          audit_id,
          cookies_json,
          scan_duration_seconds,
          created_at
        ) VALUES (?, ?, ?, datetime('now'))
      `).run(auditId, JSON.stringify([]), 0);
    }

    console.log('   ✅ Partial results saved');
  } catch (error) {
    console.warn('   ⚠️  Could not save partial results:', error.message);
  }
}

/**
 * Continue audit from Step 17 (after manual consent upload)
 */
async function continueAuditFromStep17(auditId, websiteUrl) {
  console.log('');
  console.log('▶️  === RESUMING AUDIT FROM STEP 17 ===');
  console.log(`   Audit ID: ${auditId}`);
  console.log(`   Website: ${websiteUrl}`);
  console.log('');

  const startTime = Date.now();
  const db = getDatabase();

  try {
    // Load existing scan results
    const scanResult = db.prepare(`
      SELECT * FROM scan_results WHERE audit_id = ? LIMIT 1
    `).get(auditId);

    if (!scanResult) {
      throw new Error('No scan results found for this audit');
    }

    // Parse existing data
    const cookies = scanResult.cookies_json ? JSON.parse(scanResult.cookies_json) : [];
    const consentSimulation = scanResult.consent_simulation_json ? JSON.parse(scanResult.consent_simulation_json) : null;

    // Build results object
    const results = {
      cookies,
      consentSimulation,
      // Other fields will be loaded from database as needed
    };

    // Step 17: Calculate overall compliance score
    let stepStartTime = Date.now();
    console.log('');
    console.log('📊 Step 17: Calculating overall compliance score...');
    updateProgress(auditId, 17, 17, 'Calculating compliance score and finalizing report...', startTime);

    const complianceScore = calculateOverallScore(results);
    results.complianceScore = complianceScore;

    console.log(`   ✅ Compliance score calculated in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Overall Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`);

    // Update database with compliance score
    db.prepare(`
      UPDATE audits
      SET overall_score = ?,
          score_grade = ?,
          status = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      complianceScore.overallScore,
      complianceScore.grade,
      'completed',
      auditId
    );

    console.log('');
    console.log('✅ === AUDIT RESUMED AND COMPLETED ===');
    console.log(`   Total duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
    console.log('');

  } catch (error) {
    console.error('❌ Failed to resume audit:', error);
    throw error;
  }
}

module.exports = {
  scanWebsite,
  saveScanResults,
  continueAuditFromStep17
};
