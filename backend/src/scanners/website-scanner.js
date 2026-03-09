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

const {
  validateExecutionOrder
} = require('../analyzers/consent-mode-validator');

const { getDatabase } = require('../database/db');
const { validateSchema } = require('../utils/schema-validator');
const { createLogger } = require('../utils/logger');

const constants = require('../config/constants');

const logger = createLogger('scanner');

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
function updateProgress(auditId, currentStepOrInfo, totalSteps, message, startTime = Date.now(), extraMetadata = {}) {
  try {
    const db = getDatabase();
    const now = Date.now();

    // Accept both old format (number args) and new format (step object from runner)
    let currentStep, stepMessage;
    if (typeof currentStepOrInfo === 'object' && currentStepOrInfo !== null) {
      // New format: updateProgress(auditId, { stepNumber, name })
      currentStep = parseFloat(currentStepOrInfo.stepNumber) || 0;
      stepMessage = currentStepOrInfo.name || `Step ${currentStep}`;
      // When called from runner, totalSteps/message/startTime may not be passed
      totalSteps = totalSteps || 17;
      message = message || stepMessage;
      startTime = startTime || Date.now();
    } else {
      // Old format: updateProgress(auditId, currentStep, totalSteps, message, startTime, extraMetadata)
      currentStep = currentStepOrInfo;
    }

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
      SET progress_json = ?
      WHERE id = ?
    `).run(JSON.stringify(progress), auditId);
  } catch (error) {
    logger.warn('progress-update-failed', {
      error: '⚠️ ' + error.message,
      auditId
    });
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
    logger.info('scan-start', {
      auditId: auditUid,
      url: websiteUrl,
      startTime: new Date().toISOString()
    });

    // Step 1: Initialize and Load Target (consolidated infrastructure setup)
    const initStartTime = Date.now();
    logger.info('scan-step-start', { step: 1, name: 'Initialize and Load Target', auditId });
    updateProgress(auditId, 1, 17, 'Initializing browser and loading website...', startTime);

    // Launch browser
    stepStartTime = Date.now();
    logger.debug('scan-substep-start', { substep: 'launch-browser', auditId });
    browser = await launchBrowser();
    logger.debug('scan-substep-complete', { substep: 'launch-browser', durationMs: Date.now() - stepStartTime, auditId });

    // Create page with monitoring
    stepStartTime = Date.now();
    logger.debug('scan-substep-start', { substep: 'create-page', auditId });
    const page = await createPage(browser);
    logger.debug('scan-substep-complete', { substep: 'create-page', durationMs: Date.now() - stepStartTime, auditId });

    // Capture browser console for CMP diagnostics
    page.on('console', msg => {
      const text = msg.text();

      // Only log CMP/Consent Mode related messages
      if (text.includes('consent') || text.includes('CookieScript') ||
          text.includes('google_tag') || text.includes('ics')) {
        logger.debug('browser-console-message', { type: msg.type(), message: text, auditId });
      }
    });

    // Setup network monitoring
    stepStartTime = Date.now();
    logger.debug('scan-substep-start', { substep: 'network-monitoring', auditId });
    const networkMonitor = setupNetworkMonitoring(page);
    logger.debug('scan-substep-complete', { substep: 'network-monitoring', durationMs: Date.now() - stepStartTime, auditId });

    // Inject consent monitor wrappers BEFORE any scripts load
    stepStartTime = Date.now();
    logger.debug('scan-substep-start', { substep: 'consent-monitor-injection', auditId });
    try {
      const wrapperScript = getWrapperInjectionScript();
      await page.evaluateOnNewDocument(wrapperScript);
      logger.debug('scan-substep-complete', { substep: 'consent-monitor-wrappers-injected', auditId });
    } catch (error) {
      logger.error('consent-monitor-injection-failed', {
        error: '⚠️ ' + error.message,
        auditId,
        stack: error.stack
      });
    }
    logger.debug('scan-substep-complete', { substep: 'consent-monitoring-setup', durationMs: Date.now() - stepStartTime, auditId });

    // Inject tracking detector BEFORE navigation
    stepStartTime = Date.now();
    logger.debug('scan-substep-start', { substep: 'tracking-detector-injection', auditId });
    await injectTrackingDetector(page);
    logger.debug('scan-substep-complete', { substep: 'tracking-detector-injection', durationMs: Date.now() - stepStartTime, auditId });

    // Navigate to URL
    stepStartTime = Date.now();
    logger.debug('scan-substep-start', { substep: 'navigation', url: websiteUrl, auditId });
    await navigateToUrl(page, websiteUrl);
    networkMonitor.markPageLoaded();
    logger.debug('scan-substep-complete', { substep: 'navigation', durationMs: Date.now() - stepStartTime, auditId });

    logger.info('scan-step-complete', { step: 1, durationMs: Date.now() - initStartTime, auditId });

    // Step 5.5: IMMEDIATE cookie snapshot (NO delay) - captures already loaded cookies
    stepStartTime = Date.now();
    logger.info('scan-step-start', { step: 5.5, name: 'Taking immediate cookie snapshot (baseline)', auditId });
    const baselineCookies = await extractCookies(page, { skipDelay: true }); // NO delay!
    const baselineTime = await page.evaluate(() => performance.now());
    logger.debug('scan-baseline-snapshot', { cookieCount: baselineCookies.length, timeSeconds: (baselineTime / 1000).toFixed(2), auditId });

    // Step 5.7: INTERMEDIATE snapshot AFTER 5s delay - captures async-loaded cookies (_ga, _gcl_au)
    stepStartTime = Date.now();
    logger.info('scan-step-start', { step: 5.7, name: 'Waiting 5s and taking intermediate snapshot (async cookies)', auditId });
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s for _ga, _gcl_au to load
    const intermediateCookies = await extractCookies(page, { skipDelay: true }); // Immediate after wait
    const intermediateTime = await page.evaluate(() => performance.now());
    logger.debug('scan-progress', { message: `   📸 Intermediate snapshot: ${intermediateCookies.length} cookies at ${(intermediateTime / 1000).toFixed(2)}s`, auditId });

    // Step 6: Wait for page stability
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '⏳ Step 6: Waiting for page stability...', auditId });
    await waitForPageStability(page, 3000);
    logger.debug('scan-progress', { message: `   ✅ Page stable after ${Date.now() - stepStartTime}ms`, auditId });

    // Step 6.6: Universal wait for Consent Mode initialization (CMP-agnostic)
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '   🎯 Waiting for Consent Mode data (google_tag_data.ics)...', auditId });

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
        logger.debug('consent-mode-wait-progress', {
          attempt: attempts,
          perfTimeMs: debugData.perfTime.toFixed(0),
          entries: debugData.entries,
          auditId
        });
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
        // CRITICAL FIX: CookieScript uses BOOLEAN values (false='denied', true='granted')
        // Other CMPs use strings ('denied', 'granted')
        const hasAtLeastOneParam = params.some(param => {
          const entry = entries[param];
          if (!entry) return false;

          const value = entry.default;

          // Value must be defined (not undefined, not null)
          if (value === undefined || value === null) return false;

          // ❌ REJECT transitional 'not_set' (initialization marker)
          if (value === 'not_set') return false;

          // ✅ ACCEPT boolean values: false (denied) or true (granted)
          if (typeof value === 'boolean') return true;

          // ✅ ACCEPT string values: 'denied' or 'granted'
          if (value === 'denied' || value === 'granted') return true;

          // Reject anything else
          return false;
        });

        return hasAtLeastOneParam;
      });

      attempts++;
    }

    if (consentReady) {
      logger.debug('scan-progress', { message: `   ✅ Consent Mode initialized after ${attempts * 500}ms`, auditId });
    } else {
      logger.debug('scan-progress', { message: `   ⚠️  Consent Mode not initialized after ${maxAttempts * 500}ms - proceeding anyway`, auditId });
      logger.debug('scan-progress', { message: `   ℹ️  Note: This is normal if site doesn't use Consent Mode or uses non-standard implementation`, auditId });
    }

    logger.debug('scan-progress', { message: `   ✅ Consent wait completed in ${Date.now() - stepStartTime}ms`, auditId });

    // Step 6.5: Detect cookie banner appearance time
    stepStartTime = Date.now();
    const bannerAppearTime = await detectBannerAppearTime(page);
    if (bannerAppearTime) {
      logger.debug('scan-progress', { message: `   🍪 Cookie banner detected at ${(bannerAppearTime / 1000).toFixed(2)}s after page load`, auditId });
    }

    // Step 7: Extract final cookies (with 3s delay for any remaining async cookies)
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '🍪 Step 7: Extracting final cookies and comparing with snapshots...', auditId });
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

    logger.debug('scan-progress', { message: `   Found ${cookies.length} cookies:`, auditId });
    logger.debug('scan-progress', { message: `   - Essential: ${cookieStats.byCategory.essential || 0}`, auditId });
    logger.debug('scan-progress', { message: `   - Analytics: ${cookieStats.byCategory.analytics || 0}`, auditId });
    logger.debug('scan-progress', { message: `   - Advertising: ${cookieStats.byCategory.advertising || 0}`, auditId });
    logger.debug('scan-progress', { message: `   - Tracking cookies: ${trackingCookies.length}`, auditId });
    logger.debug('scan-progress', { message: `   - Cookies before banner: ${cookiesBeforeBanner.length}`, auditId });
    logger.debug('scan-progress', { message: `   - TRACKING before banner: ${trackingBeforeBanner.length} ⚠️`, auditId });
    if (trackingBeforeBanner.length > 0) {
      trackingBeforeBanner.forEach(c => {
        logger.debug('scan-progress', { message: `      ⚠️  ${c.name} (${c.category})`, auditId });
      });
    }
    logger.debug('scan-progress', { message: `   ✅ Cookie extraction completed in ${Date.now() - stepStartTime}ms`, auditId });

    // Step 8: Get network requests (preliminary counts — will be re-categorized in Step 13.6)
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '📊 Step 8: Analyzing network requests (preliminary)...', auditId });
    const networkStats = networkMonitor.getStats();
    let trackingRequests = networkMonitor.getTrackingRequests();
    let trackingBeforeConsentRequests = networkMonitor.getTrackingBeforeConsent();

    logger.debug('scan-progress', { message: `   Total requests: ${networkStats.totalRequests}`, auditId });
    logger.debug('scan-progress', { message: `   Tracking requests (preliminary, domain-based): ${networkStats.trackingRequests}`, auditId });
    logger.debug('scan-progress', { message: `   Tracking before consent (preliminary): ${networkStats.trackingBeforeConsent}`, auditId });
    logger.debug('scan-progress', { message: `   ℹ️  Note: Final counts after re-categorization in Step 13.6 (excludes blocked requests)`, auditId });
    logger.debug('scan-progress', { message: `   ✅ Network analysis completed in ${Date.now() - stepStartTime}ms`, auditId });

    // Step 9: Analyze tracking before consent
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '🔬 Step 9: Analyzing tracking before consent...', auditId });
    const trackingData = await extractTrackingData(page);
    const trackingAnalysis = analyzeTracking(trackingData, cookies);
    logger.debug('scan-progress', { message: `   ✅ Tracking analysis completed in ${Date.now() - stepStartTime}ms`, auditId });

    // Step 10: Analyze cookie banner for NOYB violations
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '⚖️  Step 10: Analyzing cookie banner for GDPR violations...', auditId });
    updateProgress(auditId, 10, 17, 'Analyzing cookie banner compliance (NOYB checklist)...', startTime);
    const bannerAnalysis = await analyzeCookieBanner(page, auditId, cookies);
    logger.debug('scan-progress', { message: `   ✅ Banner analysis completed in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   📋 Violations found: ${bannerAnalysis.violationCount}/${bannerAnalysis.totalChecks}`, auditId });
    if (bannerAnalysis.skippedCount > 0) {
      logger.debug('scan-progress', { message: `   ⏭️  Checks skipped: ${bannerAnalysis.skippedCount}`, auditId });
    }
    logger.debug('scan-progress', { message: `   ⚠️  Critical violations: ${bannerAnalysis.hasCriticalViolations ? 'YES' : 'NO'}`, auditId });

    // Step 10.4: Extract consent monitoring data + vendor fingerprinting
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '🔬 Step 10.4: Extracting consent monitor data + fingerprinting vendors...', auditId });
    let monitoringData = null;
    let monitoringAnalysis = null;
    let detectedVendors = [];
    let vendorSummary = null;

    try {
      // Extract monitoring data (gtag calls, dataLayer events, storage writes)
      monitoringData = await extractMonitoringData(page);

      if (monitoringData.initialized) {
        logger.debug('scan-progress', { message: `   ✅ Consent monitor active:`, auditId });
        logger.debug('scan-progress', { message: `      - gtag calls: ${monitoringData.gtagCalls.length}`, auditId });
        logger.debug('scan-progress', { message: `      - dataLayer events: ${monitoringData.dataLayerEvents.length}`, auditId });
        logger.debug('scan-progress', { message: `      - Storage writes: ${monitoringData.storageWrites.length}`, auditId });

        if (monitoringData.errors.length > 0) {
          logger.debug('scan-progress', { message: `   ⚠️  Monitor errors: ${monitoringData.errors.length}`, auditId });
        }

        // Analyze for violations
        monitoringAnalysis = analyzeMonitoringData(monitoringData);
        logger.debug('scan-progress', { message: `   📊 Violations: ${monitoringAnalysis.violations.length} (${monitoringAnalysis.summary.criticalViolations} critical)`, auditId });

        // Extract vendor evidence
        const vendorEvidence = await extractVendorEvidence(page, networkMonitor.getRequests());
        vendorEvidence.monitorData = monitoringData; // Add monitoring data for timing correlation

        // Fingerprint vendors
        detectedVendors = fingerprintVendors(vendorEvidence);
        vendorSummary = generateVendorSummary(detectedVendors, monitoringData.consentState);

        logger.debug('scan-progress', { message: `   🏷️  Detected vendors: ${detectedVendors.length}`, auditId });
        if (detectedVendors.length > 0) {
          const topVendors = detectedVendors.slice(0, 5);
          topVendors.forEach(vendor => {
            const violationFlag = vendor.violation ? '⚠️' : '✅';
            logger.debug('scan-progress', { message: `      ${violationFlag} ${vendor.name} (${vendor.category}, ${vendor.confidence}% confidence)`, auditId });
          });
        }

        if (vendorSummary.violations.length > 0) {
          logger.debug('scan-progress', { message: `   ⚠️  Vendor violations: ${vendorSummary.violations.length}`, auditId });
        }
      } else {
        logger.debug('scan-progress', { message: `   ⚠️  Consent monitor not initialized - wrappers may have failed`, auditId });
      }

    } catch (error) {
      logger.error('consent-monitoring-failed', {
        error: '⚠️ ' + error.message,
        auditId,
        stack: error.stack
      });
    }

    logger.debug('scan-progress', { message: `   ✅ Consent monitoring + vendor fingerprinting completed in ${Date.now() - stepStartTime}ms`, auditId });

    // Step 10.5: Audit Google Consent Mode v2 (with monitoring data)
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '🎯 Step 10.5: Checking Google Consent Mode v2...', auditId });
    const consentModeAudit = await auditConsentMode(page, monitoringData);
    logger.debug('scan-progress', { message: `   ✅ Consent Mode audit completed in ${Date.now() - stepStartTime}ms`, auditId });
    if (consentModeAudit.detected) {
      logger.debug('scan-progress', { message: `   📊 Version: ${consentModeAudit.version || 'unknown'}`, auditId });
      logger.debug('scan-progress', { message: `   ${consentModeAudit.compliant ? '✅' : '⚠️'}  GDPR Compliance: ${consentModeAudit.compliant ? 'YES' : 'NO'}`, auditId });
    } else {
      logger.debug('scan-progress', { message: `   ⚠️  Consent Mode not detected`, auditId });
    }

    // Step 10.6: Validate Consent Mode V2 execution order
    const orderValidation = validateExecutionOrder(
      consentModeAudit,
      networkMonitor.getRequests().map(r => ({ url: r.url, timestamp: r.timestamp }))
    );
    if (!orderValidation.valid && !orderValidation.skipped) {
      logger.debug('scan-progress', { message: `   ⚠️  Consent Mode execution order violation: ${orderValidation.violationType}`, auditId });
      logger.debug('scan-progress', { message: `      ${orderValidation.reason}`, auditId });
      consentModeAudit.executionOrderValidation = orderValidation;
      consentModeAudit.hasExecutionOrderViolation = true;
    } else {
      consentModeAudit.executionOrderValidation = orderValidation;
      consentModeAudit.hasExecutionOrderViolation = false;
    }

    // Step 11 & 12: Screenshots (HARD DISABLED - temporary)
    // CRITICAL: Do NOT execute screenshot code to prevent 2.5min blocking
    let screenshotUrls = {};
    logger.debug('scan-progress', { message: '⏭️  Step 11-12: Screenshots DISABLED (temporary) - skipping to maintain fast audit loop', auditId });

    // FUTURE: When screenshots are re-enabled, uncomment below with proper safeguards:
    // - protocolTimeout must be lowered (done: 10s)
    // - Promise.race must use AbortController for real cancellation
    // - Sequential selector loops must be replaced with Promise.race(selectors)
    // - Image loading checks must be removed from waitForStableView
    /*
    if (constants.ENABLE_SCREENSHOTS) {
      stepStartTime = Date.now();
      logger.debug('scan-progress', { message: '📸 Step 11: Capturing screenshots...', auditId });
      await waitForStableView(page);
      const screenshots = await captureScreenshots(page);
      logger.debug('scan-progress', { message: `   ✅ Screenshots captured in ${Date.now() - stepStartTime}ms`, auditId });

      stepStartTime = Date.now();
      logger.debug('scan-progress', { message: '☁️  Step 12: Uploading screenshots to Vercel Blob...', auditId });
      screenshotUrls = await uploadScreenshots(screenshots, auditUid);
      logger.debug('scan-progress', { message: `   ✅ Screenshots uploaded in ${Date.now() - stepStartTime}ms`, auditId });
      logger.debug('scan-progress', { message: `   📎 Full page: ${screenshotUrls.fullPageUrl ? 'Uploaded' : 'Failed'}`, auditId });
      logger.debug('scan-progress', { message: `   📎 Banner: ${screenshotUrls.bannerUrl ? 'Uploaded' : 'Failed'}`, auditId });
    }
    */

    // Step 13: Get page metadata
    stepStartTime = Date.now();
    updateProgress(auditId, 13, 17, 'Building request timeline and capturing screenshots...', startTime);
    const metadata = await getPageMetadata(page);
    logger.debug('scan-progress', { message: `   ✅ Metadata extracted in ${Date.now() - stepStartTime}ms`, auditId });

    // Step 13.5: Build timeline
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '⏱️  Step 13.5: Building request timeline...', auditId });
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
    logger.debug('scan-progress', { message: `   ✅ Timeline built in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   📊 Events: ${timeline.events.length}, Violations: ${timeline.violations?.length || 0}`, auditId });
    logger.debug('scan-progress', { message: `   ⚠️  Before consent: ${timelineReport.beforeConsent.cookies} cookies, ${timelineReport.beforeConsent.requests} requests`, auditId });

    // Step 13.6: Categorize network requests (Problem 5)
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '🔍 Step 13.6: Categorizing network requests...', auditId });
    const requestCategorization = categorizeRequests(networkMonitor.getRequests());
    const trackingSummary = getTrackingSummary(requestCategorization);
    logger.debug('scan-progress', { message: `   ✅ Categorization completed in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   📊 Definite tracking: ${requestCategorization.categoryA.count}`, auditId });
    logger.debug('scan-progress', { message: `   📊 Suspicious: ${requestCategorization.categoryB.count}`, auditId });
    logger.debug('scan-progress', { message: `   📊 Benign: ${requestCategorization.categoryC.count}`, auditId });
    if (Object.keys(requestCategorization.vendorBreakdown).length > 0) {
      logger.debug('scan-progress', { message: `   📊 Top vendors: ${Object.keys(requestCategorization.vendorBreakdown).slice(0, 3).join(', ')}`, auditId });
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

    logger.debug('scan-progress', { message: `   🔄 Tracking requests (re-categorized): ${trackingRequests.length}`, auditId });
    logger.debug('scan-progress', { message: `   🔄 Tracking before consent (re-categorized): ${trackingBeforeConsentRequests.length}`, auditId });

    // Step 13.7: Network-storage correlation
    // Correlates network tracking requests with storage writes within a time window.
    // Correlated findings = highest-confidence GDPR evidence (network transmission + local persistence).
    // NOTE: trackingBeforeConsentRequests now contains re-categorized data (blocked requests excluded).
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '🔗 Step 13.7: Correlating network requests with storage writes...', auditId });

    const networkStorageCorrelations = correlateNetworkAndStorage(
      trackingBeforeConsentRequests,  // ← Re-categorized data (excludes blocked requests via hard override)
      monitoringData,
      requestCategorization
    );

    logger.debug('scan-progress', { message: `   ✅ Correlation completed in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   🔗 Correlated violations: ${networkStorageCorrelations.correlatedViolations.length}`, auditId });
    logger.debug('scan-progress', { message: `   📊 Confidence: ${networkStorageCorrelations.overallConfidence}%`, auditId });

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
    logger.debug('scan-progress', { message: '💾 Step 14: Saving results to database...', auditId });
    await saveScanResults(auditId, results);

    // Step 15: Close browser
    logger.debug('scan-progress', { message: '🧹 Step 15: Cleaning up...', auditId });
    await closeBrowser(browser);

    // Step 16: Consent Simulation (Human-Assisted Accept vs Reject)
    let consentSimulation = null;
    stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '', auditId });
    logger.debug('scan-progress', { message: '🎭 Step 16: Running human-assisted consent simulation...', auditId });
    updateProgress(auditId, 16, 17, 'Consent simulation (human-assisted)...', startTime);

    try {
      consentSimulation = await runAssistedConsentSimulation(websiteUrl, auditId);

      if (consentSimulation.waiting) {
        logger.debug('scan-progress', { message: `   ⏸️  Consent simulation waiting: ${consentSimulation.reason}`, auditId });
        logger.debug('scan-progress', { message: `   📋 Instructions: ${consentSimulation.instructions}`, auditId });

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
          SET status = ?
          WHERE id = ?
        `).run(constants.AUDIT_STATUS.PAUSED, auditId);

        logger.debug('scan-progress', { message: '', auditId });
        logger.debug('scan-progress', { message: '⏸️  === AUDIT PAUSED ===', auditId });
        logger.debug('scan-progress', { message: '   Waiting for manual consent simulation upload from local machine', auditId });
        logger.debug('scan-progress', { message: '   Audit will resume automatically after data upload via /api/audit/:id/resume', auditId });
        logger.debug('scan-progress', { message: '', auditId });

        // Return pause indicator - do NOT continue to Step 17
        return {
          paused: true,
          auditId,
          websiteUrl,
          instructions: consentSimulation.instructions
        };
      } else if (consentSimulation.skipped) {
        logger.debug('scan-progress', { message: `   ⏭️  Consent simulation skipped: ${consentSimulation.reason}`, auditId });
      } else {
        logger.debug('scan-progress', { message: `   ✅ Consent simulation completed in ${consentSimulation.duration}s`, auditId });
        if (consentSimulation.comparison) {
          logger.debug('scan-progress', { message: `   🍪 New cookies after Accept: ${consentSimulation.comparison.cookies.newAfterAccept.length}`, auditId });
          logger.debug('scan-progress', { message: `   📡 New tracking domains after Accept: ${consentSimulation.comparison.network.newDomainsAfterAccept.length}`, auditId });
        }
      }

      // Add consent simulation results to main results
      results.consentSimulation = consentSimulation;
    } catch (error) {
      logger.error('consent-simulation-failed', {
        error: '⚠️ ' + error.message,
        auditId,
        stack: error.stack
      });
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
    logger.debug('scan-progress', { message: '', auditId });
    logger.debug('scan-progress', { message: '📊 Step 17: Calculating overall compliance score...', auditId });
    updateProgress(auditId, 17, 17, 'Calculating compliance score and finalizing report...', startTime);
    const complianceScore = calculateOverallScore(results);
    results.complianceScore = complianceScore;
    logger.debug('scan-progress', { message: `   ✅ Compliance score calculated in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   📊 Overall Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`, auditId });
    logger.debug('scan-progress', { message: `   📋 Components:`, auditId });
    logger.debug('scan-progress', { message: `      - Privacy Policy: ${complianceScore.components.privacyPolicy?.score ?? 0}/100`, auditId });
    logger.debug('scan-progress', { message: `      - Cookie Banner: ${complianceScore.components.cookieBanner?.score ?? 0}/100`, auditId });
    logger.debug('scan-progress', { message: `      - Technical: ${complianceScore.components.technical?.score ?? 0}/100`, auditId });
    logger.debug('scan-progress', { message: `      - Cookie Policy: ${complianceScore.components.cookiePolicy?.score ?? 0}/100`, auditId });
    if (complianceScore.capsApplied.length > 0) {
      logger.debug('scan-progress', { message: `   ⚠️  Score caps applied: ${complianceScore.capsApplied.join(', ')}`, auditId });
    }

    logger.info('scan-complete', {
      auditId: auditUid,
      durationSeconds: scanDuration,
      cookieCount: cookies.length,
      trackingBeforeConsent: results.trackingBeforeConsent,
      complianceScore: complianceScore.overallScore,
      grade: complianceScore.grade,
      screenshotsUploaded: !!screenshotUrls.fullPageUrl,
      consentViolations: consentSimulation?.comparison?.violations?.length || 0
    });

    return results;

  } catch (error) {
    logger.error('scan-failed', {
      auditId: auditUid,
      error: error.message,
      stack: error.stack
    });

    // Close browser if still open
    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    throw error;
  }
}

/**
 * Save scan results to database
 *
 * CONTEXT FIELD MAPPING (generated during refactor — Commit 5a):
 * saveScanResults reads          → context/results key                  → assigned in step
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * auditId                        → context.auditId / param             → createScanContext
 * cookies                        → context.cookies                     → Step 7 (stepFinalCookieExtraction)
 * networkRequests                → networkMonitor.getRequests()         → Step 1.1 (stepInjectMonitoring)
 * trackingBeforeConsent          → trackingAnalysis.trackingBeforeConsent → Step 9 (stepClientSideTracking)
 * bannerViolations               → bannerAnalysis.violations           → Step 10 (stepBannerCompliance)
 * bannerAnalysis                 → context.bannerAnalysis              → Step 10 (stepBannerCompliance)
 * consentModeAudit               → context.consentModeAudit            → Step 10.5 (stepConsentModeDetection)
 * timeline                       → context.timeline                    → Step 13.5 (stepTimelineConstruction)
 * screenshots.full               → context.screenshotUrls.fullPageUrl  → Step 11 (disabled)
 * screenshots.banner             → context.screenshotUrls.bannerUrl    → Step 11 (disabled)
 * scanDuration                   → context.scanDuration                → calculated at persist time
 * complianceScore                → context.complianceScore             → Step 17 (stepComplianceScore)
 * trackingSummary                → context.trackingSummary             → Step 13.6 (stepNetworkCategorization)
 * consentSimulation              → context.consentSimulation           → Step 16 (stepConsentSimulation)
 * monitoringData                 → context.monitoringData              → Step 10.4 (stepConsentMonitorData)
 * monitoringAnalysis             → context.monitoringAnalysis          → Step 10.4 (stepConsentMonitorData)
 * detectedVendors                → context.detectedVendors             → Step 10.4 (stepConsentMonitorData)
 * vendorSummary                  → context.vendorSummary               → Step 10.4 (stepConsentMonitorData)
 * networkStorageCorrelations     → context.networkStorageCorrelations   → Step 13.7 (stepNetworkStorageCorrelation)
 * bannerDetectionStatus          → bannerAnalysis.bannerDetectionStatus → Step 10 (via detectBannerWithRetry)
 *
 * Total: 20 fields mapped (14 JSON blob columns + 6 scalar/derived fields)
 *
 * @param {number} auditId - Audit ID
 * @param {Object} results - Scan results (legacy format or context-derived)
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
    const hasBannerDetection = columnNames.includes('banner_detection_json');

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

    if (hasBannerDetection) {
      insertColumns += ',\n      banner_detection_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.bannerAnalysis?.bannerDetectionStatus || null));
    }

    // Validate critical payload shapes before writing to DB
    validateSchema('scanResult', {
      cookies: results.cookies,
      networkRequests: results.networkRequests,
      trackingBeforeConsent: results.trackingBeforeConsent,
      consentModeAudit: results.consentModeAudit || null
    });

    const stmt = db.prepare(`
      INSERT INTO scan_results (
        ${insertColumns}
      ) VALUES (${insertPlaceholders})
    `);

    try {
      stmt.run(...insertValues);
    } catch (err) {
      if (err.code === 'SCHEMA_VALIDATION_FAILED') {
        logger.error('scan-schema-validation-failed', {
          error: '❌ Schema validation failed',
          auditId,
          validationErrors: err.validationErrors
        });
        throw err;
      }
      throw Object.assign(err, { code: 'DB_WRITE_FAILED' });
    }

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
        logger.warn('score-update-skipped', {
          message: '⚠️ Could not update overall_score (columns may not exist yet)',
          auditId
        });
      }
    }

    logger.debug('scan-progress', { message: '✅ Scan results saved to database', auditId });
  } catch (error) {
    logger.error('scan-save-failed', {
      error: '❌ ' + error.message,
      auditId,
      fullError: error.toString(),
      stack: error.stack
    });
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

    logger.debug('scan-progress', { message: '   ✅ Partial results saved', auditId });
  } catch (error) {
    logger.warn('partial-results-save-failed', {
      error: '⚠️ ' + error.message,
      auditId
    });
  }
}

/**
 * Continue audit from Step 17 (after manual consent upload)
 */
async function continueAuditFromStep17(auditId, websiteUrl) {
  logger.debug('scan-progress', { message: '', auditId });
  logger.debug('scan-progress', { message: '▶️  === RESUMING AUDIT FROM STEP 17 ===', auditId });
  logger.debug('scan-progress', { message: `   Audit ID: ${auditId}`, auditId });
  logger.debug('scan-progress', { message: `   Website: ${websiteUrl}`, auditId });
  logger.debug('scan-progress', { message: '', auditId });

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
    logger.debug('scan-progress', { message: '', auditId });
    logger.debug('scan-progress', { message: '📊 Step 17: Calculating overall compliance score...', auditId });
    updateProgress(auditId, 17, 17, 'Calculating compliance score and finalizing report...', startTime);

    const complianceScore = calculateOverallScore(results);
    results.complianceScore = complianceScore;

    logger.debug('scan-progress', { message: `   ✅ Compliance score calculated in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   📊 Overall Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`, auditId });

    // Update database with compliance score
    db.prepare(`
      UPDATE audits
      SET overall_score = ?,
          score_grade = ?,
          status = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `).run(
      complianceScore.overallScore,
      complianceScore.grade,
      'completed',
      auditId
    );

    logger.debug('scan-progress', { message: '', auditId });
    logger.debug('scan-progress', { message: '✅ === AUDIT RESUMED AND COMPLETED ===', auditId });
    logger.debug('scan-progress', { message: `   Total duration: ${Math.round((Date.now() - startTime) / 1000)}s`, auditId });
    logger.debug('scan-progress', { message: '', auditId });

  } catch (error) {
    logger.error('audit-resume-failed', {
      error: '❌ ' + error.message,
      auditId,
      fullError: error.toString(),
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  scanWebsite,
  saveScanResults,
  continueAuditFromStep17
};
